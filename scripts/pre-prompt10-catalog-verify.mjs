// Read-only hosted catalog verification; no schema/data writes or credentials in output.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = 'test-results/pre-prompt10';
const proof = readFileSync('tests/database/idempotent-schema.verify.mjs', 'utf8');
const prelude = proof.match(/const PLATFORM_PRELUDE = `([\s\S]*?)`;/)[1];
const querySource = proof.match(/const SNAPSHOT_QUERIES = \[([\s\S]*?)\n\];/)[1];
const queries = [...querySource.matchAll(/`([\s\S]*?)`/g)].map(match => match[1]);
assert.equal(queries.length, 10);
const db = new PGlite();
let local = [];
try {
  await db.exec(prelude);
  for (const file of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  for (const sql of queries) local.push(...(await db.query(sql)).rows);
} finally { await db.close(); }
writeFileSync(`${dir}/local-final-catalog.json`, JSON.stringify(local, null, 2));
const sql = `select jsonb_agg(to_jsonb(catalog) order by k,v) as catalog from (${queries.map(query =>
  `select k,v,d,${query.includes("select 'acl_schema'") ? 'o' : 'null::text as o'} from (${query}) q`).join('\nunion all\n')}) catalog;`;
writeFileSync(`${dir}/catalog-query.sql`, sql);
const captured = spawnSync('bash', ['-lc', `supabase db query --linked --file ${dir}/catalog-query.sql -o json`], { encoding: 'utf8', timeout: 60000, maxBuffer: 20 * 1024 * 1024 });
writeFileSync(`${dir}/hosted-final-catalog.log`, captured.stdout ?? '');
writeFileSync(`${dir}/hosted-final-catalog.exit`, `${captured.status ?? 1}\n`);
if (captured.error || captured.status !== 0) throw new Error('Hosted catalog query failed; inspect retained log');
const hosted = JSON.parse(captured.stdout)[0].catalog;
writeFileSync(`${dir}/hosted-final-catalog.json`, JSON.stringify(hosted, null, 2));
function acl(row) {
  const roles = new Map();
  if (!row.d && row.k === 'acl_function') roles.set('PUBLIC', 'X');
  for (const item of row.d.replace(/^\{/, '').replace(/\}$/, '').split(',')) {
    if (!item) continue;
    const [grantee, rest] = item.split('=');
    if (grantee === row.o) continue;
    roles.set(grantee || 'PUBLIC', [...rest.split('/')[0]].sort().join(''));
  }
  if (!roles.has('PUBLIC')) roles.set('PUBLIC', '');
  return [...roles].sort(([a], [b]) => a.localeCompare(b)).map(([role, rights]) => `${role}:${rights}`).join(';');
}
function catalog(rows, remote) {
  const entries = new Map();
  for (const row of rows) {
    // PostgreSQL 17 exposes NOT NULL catalog constraints that embedded PG does not;
    // column nullability is independently compared exactly above.
    if (row.k === 'constraint' && row.d.startsWith('n ')) continue;
    // Hosted platform defaults are outside TONDE; compare only application defaults.
    if (row.k === 'defacl' && !['tonde', 'tonde_private'].includes(row.v)) continue;
    // Hosted platform Storage policies not owned by TONDE are reviewed separately.
    if (remote && row.k === 'policy' && row.v.startsWith('storage.') && !local.some(x => x.k === row.k && x.v === row.v)) continue;
    const key = `${row.k}|${row.v}`;
    assert.ok(!entries.has(key), `Catalog identity collision: ${key}`);
    if (row.k === 'function' || row.k === 'acl_function') assert.ok(row.v.endsWith(')'), `Truncated function identity: ${row.v}`);
    entries.set(key, row.k.startsWith('acl_') ? acl(row) : row.d.replace(/\r/g, ''));
  }
  return entries;
}
const expected = catalog(local, false), actual = catalog(hosted, true), differences = [];
for (const key of new Set([...expected.keys(), ...actual.keys()]))
  if (expected.get(key) !== actual.get(key)) differences.push({ key, local: expected.get(key), hosted: actual.get(key) });
writeFileSync(`${dir}/hosted-final-diff.json`, JSON.stringify(differences, null, 2));
console.log(`Compared ${expected.size} local and ${actual.size} hosted catalog identities; ${differences.length} differences.`);
assert.deepEqual(differences, [], 'Hosted semantic/ACL differences remain; inspect hosted-final-diff.json');
