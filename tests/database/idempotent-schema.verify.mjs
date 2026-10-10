import { PGlite } from '@electric-sql/pglite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { outputRelative, splitStatements } from '../../scripts/build-idempotent-schema.mjs';

// Proves the single-file, whole-system apply in
// the generated supabase/manual-apply/*_full_schema_idempotent.sql artifact.
//
// Run it explicitly:
//   node scripts/build-idempotent-schema.mjs    # rebuild the artifact first
//   node --test tests/database/idempotent-schema.verify.mjs
//
// The name deliberately does not match the `tests/database/*.test.mjs` glob that
// `npm test` uses. This file compares the built artifact against a snapshot of the
// migration-built database, so it goes red the moment any new migration is added until
// the artifact is rebuilt. That is the right signal for whoever owns the artifact, but
// it is interference for anyone else certifying a pass on a checkout they are still
// editing - so it is a separate, explicit check rather than part of the default suite.
//
// Real embedded PostgreSQL with the minimal Supabase platform schemas used by
// the rest of tests/database. This does NOT emulate Auth HTTP, Storage HTTP or
// PostgREST.
//
// Three scenarios are checked, all against the SAME expected end state:
//   A. a database that already has every migration applied (already complete)
//   B. the historical 001-014 baseline plus a populated 001-018 upgrade
//   C. a completely empty database
// In every scenario the file must apply without error, and a second run must
// change nothing.

const IDEMPOTENT_FILE = outputRelative();
// The number of migrations the built file is expected to cover is read from its own
// name, so adding a migration renames the artifact and this expectation follows.
const COVERED_THROUGH = Number(IDEMPOTENT_FILE.match(/_to_(\d+)_full_schema_idempotent\.sql$/)[1]);

const PLATFORM_PRELUDE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key, raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''), current_user) $$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant execute on function auth.uid(), auth.role() to authenticated, anon, service_role;
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon,authenticated,service_role;
  grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
`;

async function freshDatabase() {
  const db = new PGlite();
  await db.exec(PLATFORM_PRELUDE);
  return db;
}

async function migrationFiles() {
  return (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
}

async function applyMigrations(db, files) {
  for (const file of files) {
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
}

// A deterministic, order-independent description of every object the schema owns.
// Compared as a set, so it proves two apply paths reach the same database.
const SNAPSHOT_QUERIES = [
  // columns: name, type, nullability and default
  `select 'column' as k, n.nspname::text||'.'||c.relname::text||'.'||a.attname::text as v,
          format_type(a.atttypid,a.atttypmod)
            ||case when a.attnotnull then ' not null' else '' end
            ||coalesce(' default '||pg_get_expr(d.adbin,d.adrelid),'') as d
   from pg_class c
   join pg_namespace n on n.oid=c.relnamespace
   join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
   left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
   where n.nspname in ('tonde','tonde_private') and c.relkind='r'`,
  // tables and their row level security flags
  `select 'table' as k, n.nspname::text||'.'||c.relname::text as v, c.relrowsecurity::text as d
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('tonde','tonde_private') and c.relkind='r'`,
  // every constraint, by name and deparsed definition
  `select 'constraint' as k, n.nspname::text||'.'||c.relname::text||'.'||con.conname::text as v,
          con.contype::text||' '||pg_get_constraintdef(con.oid) as d
   from pg_constraint con
   join pg_class c on c.oid=con.conrelid
   join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('tonde','tonde_private')`,
  // every index, by deparsed definition
  `select 'index' as k, n.nspname::text||'.'||i.indexrelid::regclass::text as v, pg_get_indexdef(i.indexrelid) as d
   from pg_index i
   join pg_class c on c.oid=i.indrelid
   join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('tonde','tonde_private')`,
  // policies, including those the migrations install on storage.objects
  `select 'policy' as k, schemaname::text||'.'||tablename::text||'.'||policyname::text as v,
          cmd||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') as d
   from pg_policies where schemaname in ('tonde','tonde_private','storage')`,
  // triggers, excluding the internal FK triggers
  `select 'trigger' as k, n.nspname::text||'.'||c.relname::text||'.'||t.tgname::text as v, pg_get_triggerdef(t.oid) as d
   from pg_trigger t
   join pg_class c on c.oid=t.tgrelid
   join pg_namespace n on n.oid=c.relnamespace
   where not t.tgisinternal and n.nspname in ('tonde','tonde_private','auth')`,
  // functions: signature, security, search_path and the body itself
  `select 'function' as k, n.nspname::text||'.'||p.proname::text||'('||pg_get_function_identity_arguments(p.oid)||')' as v,
          pg_get_function_identity_arguments(p.oid)||'|'||p.prosecdef::text||'|'
            ||coalesce(array_to_string(p.proconfig,','),'')||'|'||coalesce(p.prosrc,'') as d
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('tonde','tonde_private')`,
  // enum types and their labels in order
  `select 'type' as k, n.nspname::text||'.'||t.typname::text as v,
          coalesce(string_agg(e.enumlabel,',' order by e.enumsortorder), t.typtype::text) as d
   from pg_type t
   join pg_namespace n on n.oid=t.typnamespace
   left join pg_enum e on e.enumtypid=t.oid
   where n.nspname in ('tonde','tonde_private')
   group by 1,2,t.typtype`,
  // schema, table and function ACLs, so GRANT/REVOKE differences cannot hide. The owner is read
  // alongside them so the comparison can ignore it: an owner always keeps its own privileges.
  `select 'acl_schema' as k, nspname::text as v, coalesce(nspacl::text,'') as d, pg_get_userbyid(nspowner) as o
   from pg_namespace where nspname in ('tonde','tonde_private')
   union all
   select 'acl_table', n.nspname::text||'.'||c.relname::text, coalesce(c.relacl::text,''), pg_get_userbyid(c.relowner)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('tonde','tonde_private') and c.relkind in ('r','S')
   union all
   select 'acl_function', n.nspname::text||'.'||p.proname::text||'('||pg_get_function_identity_arguments(p.oid)||')', coalesce(p.proacl::text,''), pg_get_userbyid(p.proowner)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('tonde','tonde_private')`,
  // default privileges installed by migration 002
  `select 'defacl' as k, coalesce(n.nspname::text,'') as v, d.defaclobjtype::text||'|'||d.defaclacl::text as d
   from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace`,
];

// ACL text is an aclitem array. Element order and the implicit-default representation are
// presentation, not privilege, so they are canonicalised here as role:privileges sorted by role
// with PUBLIC made explicit. A NULL ACL on a function means the PostgreSQL default, which really
// does grant PUBLIC EXECUTE; that must never be mistaken for an explicitly revoked function.
function canonicalAcl(raw, kind, owner) {
  const roles = new Map();
  if (raw === '') {
    if (kind === 'acl_function') roles.set('PUBLIC', 'X');
  } else {
    for (const item of raw.replace(/^\{/, '').replace(/\}$/, '').split(',')) {
      if (!item) continue;
      const equals = item.indexOf('=');
      const role = equals === 0 ? 'PUBLIC' : item.slice(0, equals);
      if (role === owner) continue;
      const privileges = item.slice(equals + 1).split('/')[0];
      roles.set(role, [...privileges].sort().join(''));
    }
  }
  if (!roles.has('PUBLIC')) roles.set('PUBLIC', '');
  return [...roles.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, privileges]) => `${role}:${privileges}`)
    .join(';');
}

function publicRights(value) {
  return new Set((value.split(';').find((part) => part.startsWith('PUBLIC:')) ?? 'PUBLIC:').slice(7));
}

// Applying the single file re-runs migration 002's point-in-time blanket revokes, so on a database
// that is already complete, functions created after 002 end up explicitly owner-only instead of
// keeping PostgreSQL's implicit PUBLIC EXECUTE. That is strictly fewer privileges for the PUBLIC
// pseudo-role and it is reported, not hidden. No other privilege difference is tolerated: a role
// may not gain or lose anything, and arg roles must match exactly.
function aclNarrowing(expected, actual) {
  const withoutPublic = (value) => value.split(';').filter((part) => !part.startsWith('PUBLIC:')).join(';');
  if (withoutPublic(expected) !== withoutPublic(actual)) return false;
  const baseline = publicRights(expected);
  return [...publicRights(actual)].every((right) => baseline.has(right));
}

async function snapshot(db) {
  const entries = new Map();
  for (const sql of SNAPSHOT_QUERIES) {
    for (const row of (await db.query(sql)).rows) {
      assert.ok(!entries.has(`${row.k}\u0000${row.v}`), `duplicate snapshot identity: ${row.k} ${row.v}`);
      entries.set(
        `${row.k}\u0000${row.v}`,
        row.k.startsWith('acl_') ? canonicalAcl(row.d, row.k, row.o) : row.d,
      );
    }
  }
  return entries;
}

function compareSnapshots(expected, actual, label) {
  const problems = [];
  const narrowed = [];
  for (const key of new Set([...expected.keys(), ...actual.keys()])) {
    const left = expected.get(key);
    const right = actual.get(key);
    const show = key.replace(/\u0000/g, ' | ');
    if (left === undefined) { problems.push(`only in actual:   ${show}`); continue; }
    if (right === undefined) { problems.push(`only in expected: ${show}`); continue; }
    if (left === right) continue;
    if (key.startsWith('acl_function\u0000') && publicRights(left).has('X')
      && publicRights(right).size === 0 && aclNarrowing(left, right)) { narrowed.push(show); continue; }
    problems.push(`changed: ${show}\n      expected ${left}\n      actual   ${right}`);
  }
  return {
    ok: problems.length === 0,
    narrowed,
    message: [
      `${label}: ${expected.size} objects expected, ${actual.size} present`,
      ...(narrowed.length
        ? [`  ${narrowed.length} object(s) hold strictly fewer PUBLIC privileges: ${narrowed.slice(0, 6).join(', ')}`]
        : []),
      ...problems.slice(0, 12),
    ].join('\n'),
  };
}

async function assertMatches(db, canonical, label) {
  const verdict = compareSnapshots(canonical, await snapshot(db), label);
  assert.ok(verdict.ok, verdict.message);
  if (verdict.narrowed.length) console.log(verdict.message);
  return verdict;
}

test('ACL comparison tolerates ordering and only documented function PUBLIC narrowing', () => {
  assert.equal(canonicalAcl('{authenticated=X/postgres,postgres=X/postgres,=X/postgres}', 'acl_function', 'postgres'),
    canonicalAcl('{=X/postgres,authenticated=X/postgres}', 'acl_function', 'postgres'));
  const key = 'acl_function\u0000tonde.example()';
  const baseline = new Map([[key, 'PUBLIC:X;authenticated:X']]);
  assert.ok(compareSnapshots(baseline, new Map([[key, 'PUBLIC:;authenticated:X']]), 'narrow').ok);
  for (const rights of ['PUBLIC:X;authenticated:', 'PUBLIC:X;authenticated:X;anon:X', 'PUBLIC:X*;authenticated:X'])
    assert.equal(compareSnapshots(baseline, new Map([[key, rights]]), 'reject').ok, false);
  assert.equal(compareSnapshots(new Map([['acl_table\u0000tonde.example', 'PUBLIC:r']]),
    new Map([['acl_table\u0000tonde.example', 'PUBLIC:']]), 'not historical function revoke').ok, false);
});

test('idempotent single-file apply reaches the same schema as the migrations', async () => {
  const files = await migrationFiles();
  assert.equal(files.length, COVERED_THROUGH, `the built file must cover all ${COVERED_THROUGH} migrations`);

  const idempotentSql = await readFile(IDEMPOTENT_FILE, 'utf8');
  let canonical;

  // Baseline: the canonical path, every migration applied in order.
  {
    const db = await freshDatabase();
    try {
      await applyMigrations(db, files);
      canonical = await snapshot(db);
      assert.ok(canonical.size > 500, `baseline snapshot looks too small (${canonical.size})`);

      // Scenario A: the file is applied to a database that is already complete.
      await db.exec(idempotentSql);
      await assertMatches(db, canonical, 'applying over a complete database');
      // and a second time, proving the run itself is repeat-safe.
      await db.exec(idempotentSql);
      await assertMatches(db, canonical, 'second apply over a complete database');
    } finally {
      await db.close();
    }
  }

  // Scenario B: the historical 001-014 baseline.
  {
    const db = await freshDatabase();
    try {
      await applyMigrations(db, files.slice(0, 14));
      await db.exec(idempotentSql);
      await assertMatches(db, canonical, 'applying after 001-014');
      await db.exec(idempotentSql);
      await assertMatches(db, canonical, 'second apply after 001-014');
    } finally {
      await db.close();
    }
  }

  // Populated upgrade from the reconciled historical 001-018 baseline. Compare the data too,
  // including protected history, not only the catalog of an empty installation.
  {
    const upgrade = await freshDatabase();
    const manual = await freshDatabase();
    try {
      for (const db of [upgrade, manual]) {
        await applyMigrations(db, files.slice(0, 18));
        await db.exec(`insert into auth.users(id) values('00000000-0000-4000-8000-000000000001');
          begin; set local role authenticated;
          select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
          select set_config('request.jwt.claim.role','authenticated',true);
          do $$ declare workspace uuid; production uuid; scene uuid; shot uuid; begin
            workspace := tonde.bootstrap_workspace();
            production := tonde.create_project_with_production(workspace,'Populated upgrade','short_film');
            update tonde.productions set planned_duration_ms=8000 where id=production;
            scene := (tonde.create_studio_scene(workspace,production,null,'{"title":"Retained Scene","duration_ms":8000}')->>'scene_id')::uuid;
            shot := (tonde.create_studio_shot(workspace,production,scene,null,'{"title":"Retained Shot","duration_ms":8000}')->>'shot_id')::uuid;
            insert into tonde.production_references(workspace_id,production_id,source_type,source_description)
              values(workspace,production,'description','Legacy incomplete Reference');
            insert into tonde.execution_plans(workspace_id,production_id,shot_id,execution_method,plan_metadata)
              values(workspace,production,shot,'real','{"retained":true}');
            insert into tonde.assets(workspace_id,asset_type,name) values(workspace,'prop','Retained prop');
          end $$; commit;`);
      }
      const preserved = async db => {
        const out = {};
        for (const table of ['productions','scenes','shots','production_references','execution_plans','assets'])
          out[table] = (await db.query(`select to_jsonb(t)-array['created_at','updated_at'] as row from tonde.${table} t order by id`)).rows.map(x=>x.row);
        return out;
      };
      const before = await preserved(manual);
      await applyMigrations(upgrade, files.slice(18));
      await manual.exec(idempotentSql);
      await assertMatches(manual, await snapshot(upgrade), 'populated upgrade after 001-018');
      const after = await preserved(manual);
      for (const table of Object.keys(before)) {
        assert.equal(after[table].length, before[table].length, `${table} rows retained`);
        for (let index=0;index<before[table].length;index++)
          for (const [key,value] of Object.entries(before[table][index]))
            assert.deepEqual(after[table][index][key], value, `${table}.${key} must not be silently rewritten`);
      }
      const once = await preserved(manual);
      const history = (await manual.query('select count(*)::integer as count from tonde.object_versions')).rows[0].count;
      await manual.exec(idempotentSql);
      assert.deepEqual(await preserved(manual), once, 'second apply preserves every populated row');
      assert.equal((await manual.query('select count(*)::integer as count from tonde.object_versions')).rows[0].count, history, 'second apply creates no duplicate history');
      await assertMatches(manual, await snapshot(upgrade), 'second populated upgrade apply');
    } finally { await upgrade.close(); await manual.close(); }
  }

  // Scenario C: a completely empty database.
  {
    const db = await freshDatabase();
    try {
      await db.exec(idempotentSql);
      await assertMatches(db, canonical, 'applying to an empty database');
      await db.exec(idempotentSql);
      await assertMatches(db, canonical, 'second apply on an empty database');
    } finally {
      await db.close();
    }
  }
});

test('the built file reports every object as OK through its own verification query', async () => {
  const db = await freshDatabase();
  try {
    await db.exec(await readFile(IDEMPOTENT_FILE, 'utf8'));

    // Execute the actual generated query, not a hand-maintained subset.
    const sql = await readFile(IDEMPOTENT_FILE, 'utf8');
    const ownQuery = splitStatements(sql, IDEMPOTENT_FILE).find(statement => /select kind, name, case when present/.test(statement.text));
    assert.ok(ownQuery, 'the artifact must include its verification query');
    const ownVerdict = await db.query(ownQuery.text);
    assert.ok(ownVerdict.rows.length > 300, 'verify the full object inventory');
    assert.ok(ownVerdict.rows.every(row => row.result === 'OK'), JSON.stringify(ownVerdict.rows.filter(row => row.result !== 'OK')));
    const verdict = await db.query(`
      select kind, name, case when present then 'OK' else 'MISSING' end as result
      from (
        select 'table' as kind, n as name, to_regclass(n) is not null as present
        from unnest(array[
          'tonde.workspaces', 'tonde.productions', 'tonde.shots', 'tonde.results',
          'tonde.match_corrections', 'tonde.execution_plans', 'tonde.object_versions',
          'tonde.access_decisions', 'tonde.memory_items', 'tonde.continuity_states'
        ]) as n
        union all
        select 'function', n, exists (
          select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
          where ns.nspname = split_part(n, '.', 1) and p.proname = split_part(n, '.', 2)
        )
        from unnest(array[
          'tonde.bootstrap_workspace', 'tonde.create_project_with_production',
          'tonde.ai_creation_surface', 'tonde.production_readiness',
          'tonde.impact_preview', 'tonde.production_search'
        ]) as n
      ) checks
      where not present
      order by kind, name
    `);
    assert.deepEqual(
      verdict.rows,
      [],
      `verification query reported missing objects: ${JSON.stringify(verdict.rows)}`,
    );
  } finally {
    await db.close();
  }
});
