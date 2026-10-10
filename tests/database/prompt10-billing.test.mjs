import { PGlite } from '@electric-sql/pglite';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Prompt 10 packet 034 — billing, entitlements, usage and webhooks, on real embedded PostgreSQL over
// one 001->034 stack. These tests pin the laws the migration claims: commercial state is
// server-authoritative and a client cannot write one byte of it; a subscription moves only because a
// *verified* provider event said so; plans grant entitlements and one evaluator answers for them; a
// consumable entitlement can never be overspent; usage is idempotent and never collapses actual,
// estimated and charged amounts into one number; and a replay or an out-of-order event cannot
// double-count or resurrect an older provider state. No live billing credentials exist, so the
// adapter contract is exercised through the database's own verified-event seam.
let db;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const PROVIDER = 'fixture-billing';
let wa, wb;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const failure = async action => { try { await action(); } catch (error) { return error; } throw new Error('expected a failure'); };
async function asUser(user, action) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
async function asService(action) {
  await db.exec('begin; set local role service_role;');
  await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
  try { const result = await action(); await db.exec('commit'); return result; }
  catch (error) { await db.exec('rollback'); throw error; }
}
const asEditor = action => asUser(A, action);
const asOther = action => asUser(B, action);

// An independent commercial owner per scenario, so one test's subscription cannot make another's
// assertions pass. The catalog itself is global and seeded once.
const newWorkspace = async (owner, label) => {
  const id = randomUUID();
  await db.query("insert into tonde.workspaces(id,name,owner_user_id,kind) values($1,$2,$3,'team')", [id, `Probe ${label}`, owner]);
  await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'owner')", [id, owner]);
  return id;
};
const seedProduction = (workspace, owner, label) => (async () => {
  const project = await db.query("insert into tonde.projects(workspace_id,title,created_by) values($1,$2,$3) returning id", [workspace, `Probe ${label}`, owner]);
  const production = await db.query("insert into tonde.productions(workspace_id,project_id,title,created_by) values($1,$2,$3,$4) returning id", [workspace, project.rows[0].id, `Probe Production ${label}`, owner]);
  return production.rows[0].id;
})();

const receive = (fields = {}) => asService(() => rows(
  'select tonde.billing_webhook_receive($1,$2,$3,$4,$5,$6,$7) as result',
  [fields.provider ?? PROVIDER, fields.eventId ?? `evt_${randomUUID()}`, fields.type ?? 'customer.subscription.updated',
   fields.createdAt === undefined ? new Date().toISOString() : fields.createdAt, fields.scheme ?? 'fixture-hmac-sha256',
   fields.verifiedAt === undefined ? new Date().toISOString() : fields.verifiedAt,
   JSON.stringify(fields.payload ?? { id: fields.eventId, type: fields.type })]
).then(result => result[0].result));
const finish = (event, state, message = null, workspace = null) => asService(() => rows(
  'select tonde.billing_webhook_finish($1,$2,$3,$4) as result', [event, state, message, workspace]).then(result => result[0].result));
const applySubscription = (fields) => asService(() => rows(
  'select tonde.billing_apply_subscription($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
  [fields.workspace, fields.event, fields.state, fields.plan === undefined ? 'studio' : fields.plan,
   fields.customer ?? 'cus_probe_1', fields.subscription === undefined ? null : fields.subscription, fields.periodEnd ?? null,
   fields.stateAt ?? null, fields.reason ?? '']).then(result => result[0].result));
const recordUsage = (fields = {}) => asService(() => rows(
  'select tonde.usage_record($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) as result',
  [fields.workspace, fields.metric ?? 'generation', fields.quantity ?? 1, fields.unit ?? 'credit',
   fields.key ?? null, fields.operation ?? 'ai.generate.image', fields.provider ?? 'fixture-ai',
   fields.model ?? 'fixture-model-1', fields.production ?? null, fields.actor ?? null,
   fields.providerCost ?? null, fields.estimatedCost ?? null, fields.price ?? null,
   fields.credits ?? 0, fields.currency ?? 'USD', fields.basis ?? 'unknown',
   fields.sourceEventId ?? null, fields.attempt ?? null]).then(result => result[0].result));
const reserve = (workspace, key, amount, operation = `op_${randomUUID()}`) => asService(() => rows(
  'select tonde.usage_reserve($1,$2,$3,$4,$5) as result', [workspace, key, amount, operation, '']).then(result => result[0].result));
const commit = (workspace, reservation, actual = null) => asService(() => rows(
  'select tonde.usage_commit($1,$2,$3,$4) as result', [workspace, reservation, actual, '']).then(result => result[0].result));
const release = (workspace, reservation) => asService(() => rows(
  'select tonde.usage_release($1,$2,$3) as result', [workspace, reservation, '']).then(result => result[0].result));
const entitlement = (workspace, key, user = A) => asUser(user, () => scalar('select tonde.entitlement_state($1,$2)', [workspace, key]));
const activate = async (workspace, label = 'probe') => {
  const receipt = await receive({});
  const applied = await applySubscription({ workspace, event: receipt.event_id, state: 'active', customer: `cus_${label}_${workspace.slice(0, 8)}`, subscription: `sub_${label}_${workspace.slice(0, 8)}` });
  return { receipt, applied };
};

before(async () => {
  db = new PGlite();
  await db.exec(`
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
  `);
  for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  }
  for (const id of [A, B]) await db.query('insert into auth.users(id) values ($1)', [id]);
  wa = await asEditor(() => scalar('select tonde.bootstrap_workspace()'));
  wb = await asOther(() => scalar('select tonde.bootstrap_workspace()'));
  // The commercial catalog: two sellable plans, feature and quota entitlements, and one entitlement
  // that is deliberately not enabled. No price is invented — the plan names a provider price identity
  // that a real checkout would have to be configured with.
  await db.exec(`
    insert into tonde.entitlement_definitions(key,name,kind,unit,description,enabled) values
      ('generation.credits','AI generation credits','quota','credit','Consumable generation credits.',true),
      ('publishing.advanced','Advanced publishing destinations','feature','','Destinations beyond the base set.',true),
      ('exports.documents','Full document exports','feature','','PDF and DOCX downloads.',true),
      ('experiments.beta','Experimental beta capabilities','feature','','Not launched, so not grantable.',false);
    insert into tonde.billing_plans(key,name,state,provider,provider_price_id,billing_interval,note) values
      ('studio','Studio','active','${PROVIDER}','price_studio_monthly','month','Test-mode price identity, not a live price.'),
      ('draft-plan','Draft plan','draft','','','','No provider price is approved for this plan yet.');
    insert into tonde.plan_entitlements(plan_key,entitlement_key,limit_amount) values
      ('studio','generation.credits',100), ('studio','publishing.advanced',null);
  `);
});

after(async () => { await db?.close(); });

test('commercial state is server-authoritative and no client role can write it', async () => {
  // The vocabulary is part of the contract: the SQL enums and the shared product vocabulary agree.
  const vocabulary = JSON.parse(await readFile('product/vocabulary.json', 'utf8'));
  const expected = [
    ['subscription_state', 'subscriptionStates', ['none', 'trialing', 'active', 'past_due', 'incomplete', 'cancel_at_period_end', 'cancelled', 'suspended']],
    ['entitlement_kind', 'entitlementKinds', ['feature', 'quota']],
    ['entitlement_source', 'entitlementSources', ['plan', 'grant']],
    ['usage_cost_basis', 'usageCostBases', ['actual', 'estimated', 'unknown']],
    ['reservation_state', 'reservationStates', ['reserved', 'committed', 'released']],
    ['webhook_state', 'webhookStates', ['received', 'processing', 'processed', 'failed', 'ignored']],
    ['checkout_state', 'checkoutStates', ['started', 'completed', 'abandoned', 'expired']],
    ['commercial_actor', 'commercialActors', ['webhook', 'server', 'admin']],
  ];
  for (const [sqlName, key, values] of expected) {
    const actual = (await rows(`select unnest(enum_range(null::tonde.${sqlName}))::text as value`)).map(row => row.value);
    assert.deepEqual(actual, values, `${sqlName} states are exactly the agreed commercial vocabulary`);
    assert.deepEqual(Object.keys(vocabulary[key]).sort(), [...values].sort(), `${key} in the product vocabulary matches ${sqlName}`);
  }
  // The subscription vocabulary is a superset of the historical check, so no stored row was invalidated.
  assert.equal(await scalar("select count(*) from tonde.billing_accounts where subscription_status is null"), 0);

  // No client role holds a write privilege on any commercial table, catalog included.
  const tables = ['billing_accounts', 'entitlement_definitions', 'billing_plans', 'plan_entitlements',
    'workspace_entitlements', 'subscription_events', 'billing_checkout_intents', 'billing_webhook_events',
    'usage_reservations', 'usage_events'];
  const writable = await scalar(`select count(*) from (values ${tables.map(name => `('${name}')`).join(',')}) as t(name)
    cross join unnest(array['insert','update','delete']) as privilege(priv)
    where has_table_privilege('authenticated','tonde.'||t.name,privilege.priv)
      or has_table_privilege('anon','tonde.'||t.name,privilege.priv)`);
  assert.equal(Number(writable), 0, 'the browser cannot write commercial state directly');
  // ...and it is not merely ungranted: an actual write is refused.
  const forgedAccount = await failure(() => asEditor(() => db.query(
    "insert into tonde.billing_accounts(workspace_id,provider,provider_customer_id) values($1,'forged','cus_forged')", [wa])));
  assert.match(forgedAccount.message, /permission denied/);
  const forgedEntitlement = await failure(() => asEditor(() => db.query(
    "insert into tonde.workspace_entitlements(workspace_id,entitlement_key,source,plan_key) values($1,'generation.credits','plan','studio')", [wa])));
  assert.match(forgedEntitlement.message, /permission denied/);
  const forgedReceipt = await failure(() => asEditor(() => db.query(
    "insert into tonde.billing_webhook_events(provider,provider_event_id,event_type,signature_scheme,signature_verified_at,event_created_at) values('forged','evt_forged','x','none',now(),now())")));
  assert.match(forgedReceipt.message, /permission denied/);
  const forgedUsage = await failure(() => asEditor(() => db.query(
    "insert into tonde.usage_events(workspace_id,metric,quantity,unit,idempotency_key,provider_cost,cost_basis) values($1,'generation',9999,'credit','forged',0,'actual')", [wa])));
  assert.match(forgedUsage.message, /permission denied/);
  const forgedCheckout = await failure(() => asEditor(() => db.query(
    "insert into tonde.billing_checkout_intents(workspace_id,plan_key,created_by) values($1,'studio',$2)", [wa, A])));
  assert.match(forgedCheckout.message, /permission denied/);
  const forgedHistory = await failure(() => asEditor(() => db.query(
    "insert into tonde.subscription_events(workspace_id,to_state,actor,applied) values($1,'active','admin',true)", [wa])));
  assert.match(forgedHistory.message, /permission denied/);

  // The commercial catalog is readable so a surface can explain itself...
  assert.ok(Number(await asEditor(() => scalar('select count(*) from tonde.billing_plans'))) >= 2);
  assert.ok(Number(await asEditor(() => scalar('select count(*) from tonde.entitlement_definitions'))) >= 4);
  assert.ok(Number(await asEditor(() => scalar('select count(*) from tonde.plan_entitlements'))) >= 2);
  // ...while webhook receipts, which are provider evidence, are not client-readable at all.
  const receipts = await failure(() => asEditor(() => scalar('select count(*) from tonde.billing_webhook_events')));
  assert.match(receipts.message, /permission denied/);
  const anonCatalog = await failure(() => db.exec('begin; set local role anon; select count(*) from tonde.billing_plans;'));
  assert.match(anonCatalog.message, /permission denied/);
  await db.exec('rollback');

  // Server-only functions stay server-only, and the authenticated surfaces stay authenticated-only.
  const serverOnly = ['billing_apply_subscription', 'usage_record', 'usage_reserve', 'usage_commit', 'usage_release',
    'billing_webhook_receive', 'billing_webhook_finish', 'billing_grant_entitlement', 'billing_revoke_entitlement'];
  assert.equal(Number(await scalar(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tonde' and p.proname = any($1) and (has_function_privilege('authenticated', p.oid, 'execute')
      or has_function_privilege('anon', p.oid, 'execute'))`, [serverOnly])), 0, 'no client role can call a commercial write RPC');
  const clientSurfaces = ['billing_checkout_start', 'billing_status', 'entitlement_state'];
  assert.equal(Number(await scalar(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tonde' and p.proname = any($1) and (not has_function_privilege('authenticated', p.oid, 'execute')
      or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))`, [clientSurfaces])), 0);
});

test('a subscription moves only because a verified provider event said so, and history stays explainable', async () => {
  const w = await newWorkspace(A, 'subscription');
  // Commercial state cannot be invented: a movement must name a receipt that exists.
  const orphan = await failure(() => applySubscription({ workspace: w, event: randomUUID(), state: 'active' }));
  assert.match(orphan.message, /verified webhook receipt/);
  // A first subscription must carry the provider customer identity (a placeholder would collide).
  const first = await receive({});
  const nameless = await failure(() => applySubscription({ workspace: w, event: first.event_id, state: 'active', customer: '' }));
  assert.match(nameless.message, /provider customer identity/);
  const unknownState = await failure(() => applySubscription({ workspace: w, event: first.event_id, state: 'mostly_fine', customer: 'cus_x1' }));
  assert.match(unknownState.message, /not a subscription state/);

  const t1 = new Date(Date.now() - 30000).toISOString();
  const active = await applySubscription({ workspace: w, event: first.event_id, state: 'active', customer: 'cus_x1', subscription: 'sub_x1', stateAt: t1, periodEnd: new Date(Date.now() + 2592000000).toISOString() });
  assert.equal(active.applied, true);
  assert.equal(active.state, 'active');
  assert.equal(active.entitlements.granted, 2, 'the active plan granted exactly its two entitlements');
  assert.equal(await scalar('select subscription_status::text from tonde.billing_accounts where workspace_id = $1', [w]), 'active');
  assert.equal(await scalar("select count(*) from tonde.workspace_entitlements where workspace_id = $1 and source = 'plan'", [w]), 2);

  // Only trialing, active and cancel_at_period_end grant plan entitlements — not every non-cancelled state.
  const allStates = (await rows('select unnest(enum_range(null::tonde.subscription_state))::text as value')).map(row => row.value);
  const grants = [];
  for (const state of allStates) {
    const decision = await scalar('select tonde_private.subscription_grants_entitlements($1::tonde.subscription_state)', [state]);
    if (decision) grants.push(state);
  }
  assert.deepEqual(grants, ['trialing', 'active', 'cancel_at_period_end']);

  // A lapse revokes the plan entitlements; recovery restores them. Nothing was overwritten.
  const t2 = new Date(Date.now() - 20000).toISOString();
  const lapsed = await applySubscription({ workspace: w, event: (await receive({})).event_id, state: 'past_due', customer: 'cus_x1', stateAt: t2 });
  assert.equal(lapsed.applied, true);
  assert.equal(lapsed.entitlements.revoked, 2);
  assert.equal(await scalar("select count(*) from tonde.workspace_entitlements where workspace_id = $1 and source = 'plan'", [w]), 0);
  assert.equal(await entitlement(w, 'generation.credits'), 'SUBSCRIPTION_NOT_ACTIVE');
  const t3 = new Date(Date.now() - 10000).toISOString();
  const recovered = await applySubscription({ workspace: w, event: (await receive({})).event_id, state: 'active', customer: 'cus_x1', stateAt: t3 });
  assert.equal(recovered.applied, true);
  assert.equal(await entitlement(w, 'generation.credits'), 'AVAILABLE');

  // An older event cannot resurrect an older provider state.
  const t0 = new Date(Date.now() - 60000).toISOString();
  const stale = await applySubscription({ workspace: w, event: (await receive({})).event_id, state: 'cancelled', customer: 'cus_x1', stateAt: t0 });
  assert.equal(stale.applied, false);
  assert.equal(stale.reason, 'STALE_EVENT');
  assert.equal(stale.state, 'active');
  assert.equal(await scalar('select subscription_status::text from tonde.billing_accounts where workspace_id = $1', [w]), 'active');

  // Cancelling at period end is a distinct state: it keeps entitlement while it waits.
  const t4 = new Date().toISOString();
  const ending = await applySubscription({ workspace: w, event: (await receive({})).event_id, state: 'cancel_at_period_end', customer: 'cus_x1', stateAt: t4 });
  assert.equal(ending.applied, true);
  assert.equal(await scalar('select cancel_at_period_end from tonde.billing_accounts where workspace_id = $1', [w]), true);
  assert.equal(await entitlement(w, 'generation.credits'), 'AVAILABLE');
  const t5 = new Date(Date.now() + 5000).toISOString();
  await applySubscription({ workspace: w, event: (await receive({})).event_id, state: 'cancelled', customer: 'cus_x1', stateAt: t5 });
  assert.equal(await scalar("select count(*) from tonde.workspace_entitlements where workspace_id = $1 and source = 'plan'", [w]), 0);

  // The whole path is explainable in order, with the stale event recorded as NOT applied. Rows are
  // ordered by the provider state they describe, which is why the rejected older event sorts first.
  const history = await rows(`select from_state::text as from_state, to_state::text as to_state, actor::text as actor,
      applied, reason from tonde.subscription_events where workspace_id = $1 order by occurred_at, id`, [w]);
  assert.deepEqual(history.map(row => [row.from_state, row.to_state, row.applied]), [
    ['active', 'cancelled', false], ['none', 'active', true], ['active', 'past_due', true],
    ['past_due', 'active', true], ['active', 'cancel_at_period_end', true], ['cancel_at_period_end', 'cancelled', true],
  ]);
  assert.match(history[0].reason, /STALE_EVENT/);
  assert.ok(history.every(row => row.actor === 'webhook'), 'every movement cites the trusted provider channel');
  // History is append-only: not even the server can rewrite what happened.
  const rewritten = await failure(() => asService(() => db.query(`update tonde.subscription_events set to_state = 'active' where workspace_id = $1`, [w])));
  assert.match(rewritten.message, /append-only/);
  const deleted = await failure(() => asService(() => db.query('delete from tonde.subscription_events where workspace_id = $1', [w])));
  assert.match(deleted.message, /append-only/);
});

test('plans grant entitlements, grants are explicit, and one evaluator answers for all of them', async () => {
  const w = await newWorkspace(A, 'entitlements');
  // A plan that cannot name a provider price is not sellable.
  const unpriced = await failure(() => db.query("insert into tonde.billing_plans(key,name,state,provider,provider_price_id) values('broken','Broken','active','','')"));
  assert.match(unpriced.message, /plan_sellable_has_price/);
  const priced = await failure(() => db.query("insert into tonde.billing_plans(key,name,state) values('broken','Broken','active')"));
  assert.match(priced.message, /plan_sellable_has_price/);

  // Without a subscription the reason is stated, not merely false.
  assert.equal(await entitlement(w, 'generation.credits'), 'NO_SUBSCRIPTION');
  assert.equal(await entitlement(w, 'not.a.real.entitlement'), 'UNKNOWN_ENTITLEMENT');
  assert.equal(await entitlement(w, 'experiments.beta'), 'ENTITLEMENT_DISABLED');

  await activate(w, 'entitlements');
  assert.equal(await entitlement(w, 'generation.credits'), 'AVAILABLE');
  assert.equal(await entitlement(w, 'publishing.advanced'), 'AVAILABLE', 'a feature entitlement with no limit is available');
  assert.equal(await entitlement(w, 'exports.documents'), 'NOT_INCLUDED', 'a catalog entitlement the plan does not include stays unavailable');

  // A grant is an explicit administrative decision with an actor, not a second plan.
  // A grant without an actor is refused: the trusted server has no session, so it must say who it
  // is acting for rather than writing an anonymous commercial decision.
  const anonymous = await failure(() => asService(() => scalar("select tonde.billing_grant_entitlement($1,'exports.documents')", [w])));
  assert.match(anonymous.message, /name the administrator who approved it/);
  const granted = await asService(() => rows("select tonde.billing_grant_entitlement($1,'exports.documents',null,'approved by hand',$2,$3) as result",
    [w, new Date(Date.now() + 86400000).toISOString(), A]).then(result => result[0].result));
  assert.equal(granted.source, 'grant');
  assert.equal(granted.granted_by, A);
  assert.equal(await entitlement(w, 'exports.documents'), 'AVAILABLE');
  const originless = await failure(() => db.query("insert into tonde.workspace_entitlements(workspace_id,entitlement_key,source) values($1,'experiments.beta','grant')", [w]));
  assert.match(originless.message, /entitlement_source_names_origin/);
  // Resyncing the plan refreshes plan rows and leaves the grant alone.
  const before = await scalar("select count(*) from tonde.workspace_entitlements where workspace_id = $1 and source = 'grant'", [w]);
  await activate(w, 'entitlements-resync');
  assert.equal(await scalar("select count(*) from tonde.workspace_entitlements where workspace_id = $1 and source = 'grant'", [w]), before);
  assert.equal(await scalar("select count(*) from tonde.workspace_entitlements where workspace_id = $1 and source = 'plan'", [w]), 2);

  // Quota consumption: reserve holds the amount, commit settles it, release returns it.
  const first = await reserve(w, 'generation.credits', 60);
  assert.equal(Number(first.remaining_after_reservation), 40);
  assert.equal(await entitlement(w, 'generation.credits'), 'AVAILABLE');
  const overReserve = await failure(() => reserve(w, 'generation.credits', 45));
  assert.match(overReserve.message, /ENTITLEMENT_EXHAUSTED/);
  assert.equal(await scalar('select reserved_amount from tonde.workspace_entitlements where workspace_id = $1 and entitlement_key = \'generation.credits\'', [w]), '60.0000');
  // A read-then-subtract race cannot overspend: the constraint refuses it even bypassing the API.
  const raced = await failure(() => asService(() => db.query("update tonde.workspace_entitlements set reserved_amount = reserved_amount + 60 where workspace_id = $1 and entitlement_key = 'generation.credits'", [w])));
  assert.match(raced.message, /entitlement_never_overspent/);
  const settled = await commit(w, first.reservation_id, 30);
  assert.equal(settled.state, 'committed');
  assert.equal(await scalar('select consumed_amount from tonde.workspace_entitlements where workspace_id = $1 and entitlement_key = \'generation.credits\'', [w]), '30.0000');
  assert.equal(Number(await scalar('select limit_amount - consumed_amount - reserved_amount from tonde.workspace_entitlements where workspace_id = $1 and entitlement_key = \'generation.credits\'', [w])), 70);

  const second = await reserve(w, 'generation.credits', 70);
  const returned = await release(w, second.reservation_id);
  assert.equal(returned.state, 'released');
  assert.equal(Number(returned.released_amount), 70);
  assert.equal(await entitlement(w, 'generation.credits'), 'AVAILABLE');
  // A reservation is settled once, and never in another workspace's name.
  const twice = await failure(() => commit(w, second.reservation_id, 1));
  assert.match(twice.message, /cannot be committed/);
  const foreign = await failure(() => release(wb, first.reservation_id));
  assert.match(foreign.message, /does not exist in this workspace/);
  // Reserving an entitlement the workspace does not hold, and reserving a nonsense amount.
  const missing = await failure(() => reserve(w, 'experiments.beta', 1));
  assert.match(missing.message, /holds no entitlement/);
  const nonsense = await failure(() => reserve(w, 'generation.credits', 0));
  assert.match(nonsense.message, /positive amount/);
  // Draining the quota reports exhaustion rather than a silent overdraft.
  await reserve(w, 'generation.credits', 70);
  assert.equal(await entitlement(w, 'generation.credits'), 'EXHAUSTED');
});

test('usage is idempotent and never collapses provider cost, estimate and charge into one number', async () => {
  const w = await newWorkspace(A, 'usage');
  const first = await recordUsage({ workspace: w, key: 'gen-1' });
  assert.equal(first.recorded, true);
  assert.equal(first.cost_basis, 'unknown');
  const again = await recordUsage({ workspace: w, key: 'gen-1' });
  assert.equal(again.duplicate, true);
  assert.equal(again.usage_event_id, first.usage_event_id);
  assert.equal(await scalar("select count(*) from tonde.usage_events where workspace_id = $1 and idempotency_key = 'gen-1'", [w]), 1);

  // The same provider event is recognised even when the caller passed no key at all.
  const event = randomUUID();
  const once = await recordUsage({ workspace: w, sourceEventId: event, basis: 'actual', providerCost: 0.42, key: `auto-a-${event}` });
  const twice = await recordUsage({ workspace: w, sourceEventId: event, basis: 'actual', providerCost: 0.42, key: `auto-b-${event}` });
  assert.equal(twice.duplicate, true);
  assert.equal(twice.usage_event_id, once.usage_event_id);
  assert.equal(await scalar('select count(*) from tonde.usage_events where workspace_id = $1 and source_event_id = $2', [w, event]), 1);

  // A cost is never invented and never hidden: the basis says what the number is.
  const actualWithoutAmount = await failure(() => recordUsage({ workspace: w, key: 'bad-actual', basis: 'actual' }));
  assert.match(actualWithoutAmount.message, /amount the provider reported/);
  const unknownWithAmount = await failure(() => recordUsage({ workspace: w, key: 'bad-unknown', basis: 'unknown', providerCost: 1 }));
  assert.match(unknownWithAmount.message, /cannot carry a cost/);
  const impossibleBasis = await failure(() => recordUsage({ workspace: w, key: 'bad-basis', basis: 'roughly' }));
  assert.match(impossibleBasis.message, /actual, estimated or unknown/);
  const negative = await failure(() => recordUsage({ workspace: w, key: 'bad-quantity', quantity: -1 }));
  assert.match(negative.message, /cannot be negative/);
  // The CHECK constraints hold even for a direct server write.
  const directActual = await failure(() => asService(() => db.query(
    "update tonde.usage_events set cost_basis = 'actual', provider_cost = null where id = $1", [once.usage_event_id])));
  assert.match(directActual.message, /usage_actual_cost_is_reported/);

  const priced = await recordUsage({ workspace: w, key: 'gen-2', basis: 'estimated', estimatedCost: 0.11, price: 0.2, credits: 3, quantity: 1.5, unit: 'megapixel' });
  const row = (await rows('select provider_cost, estimated_cost, price_amount, credit_units, cost_basis::text as cost_basis, quantity, currency from tonde.usage_events where id = $1', [priced.usage_event_id]))[0];
  assert.equal(row.provider_cost, null, 'an estimate is not an actual provider cost');
  assert.equal(Number(row.estimated_cost), 0.11);
  assert.equal(Number(row.price_amount), 0.2, 'what the customer would be charged is its own column');
  assert.equal(Number(row.credit_units), 3);
  assert.equal(Number(row.quantity), 1.5, 'a fractional quota is preserved rather than rounded away');
  assert.equal(row.currency, 'USD');
  assert.equal(row.cost_basis, 'estimated');

  // Usage is attributed to a Production of the same workspace, or it is refused.
  const mine = await seedProduction(w, A, 'usage');
  const foreignProduction = await seedProduction(wb, B, 'usage-foreign');
  const linked = await recordUsage({ workspace: w, key: 'gen-3', production: mine });
  assert.equal(await scalar('select production_id from tonde.usage_events where id = $1', [linked.usage_event_id]), mine);
  const crossTenant = await failure(() => recordUsage({ workspace: w, key: 'gen-4', production: foreignProduction }));
  assert.equal(crossTenant.code, '23503');
  // The AI-attempt linkage is the same composite-FK mechanism, scoped by workspace.
  const attemptKeys = await rows(`select a.attname from pg_constraint c join unnest(c.conkey) as k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conname = 'usage_attempt_same_workspace' order by k.attnum`);
  assert.deepEqual(attemptKeys.map(row => row.attname), ['workspace_id', 'attempt_id']);
  const missingAttempt = await failure(() => recordUsage({ workspace: w, key: 'gen-5', attempt: randomUUID() }));
  assert.equal(missingAttempt.code, '23503');
  // A client can read its own usage as an administrator, and none of another workspace's.
  // gen-1, the provider-event row, gen-2 and gen-3 — and nothing was written by any refused call.
  assert.equal(Number(await asEditor(() => scalar('select count(*) from tonde.usage_events where workspace_id = $1', [w]))), 4);
  assert.equal(Number(await asOther(() => scalar('select count(*) from tonde.usage_events where workspace_id = $1', [w]))), 0);
});

test('an unsigned webhook can never reach commercial state, and replays and stale events do not fire twice', async () => {
  const w = await newWorkspace(A, 'webhooks');
  // Without a recorded signature verification there is no receipt at all.
  const unsigned = await failure(() => receive({ scheme: '   ' }));
  assert.match(unsigned.message, /signature verification/);
  const unverified = await failure(() => receive({ verifiedAt: null }));
  assert.match(unverified.message, /signature verification/);
  const undated = await failure(() => receive({ createdAt: null }));
  assert.match(undated.message, /when the provider created the event/);
  // A receipt is evidence, not a place to keep credentials.
  const secret = await failure(() => receive({ payload: { client_secret: 'sk_live_not_a_thing' } }));
  assert.match(secret.message, /must not store secrets/);
  const eventId = `evt_${randomUUID()}`;
  const receipt = await receive({ eventId });
  assert.equal(receipt.duplicate, false);
  assert.equal(receipt.state, 'received');
  const replay = await receive({ eventId });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.event_id, receipt.event_id);
  assert.equal(await scalar('select count(*) from tonde.billing_webhook_events where provider = $1 and provider_event_id = $2', [PROVIDER, eventId]), 1, 'a repeated delivery has one receipt');

  // What the provider sent cannot be rewritten, and the processing state machine only moves forward.
  const rewritten = await failure(() => asService(() => db.query("update tonde.billing_webhook_events set event_type = 'replaced' where id = $1", [receipt.event_id])));
  assert.match(rewritten.message, /cannot be rewritten/);
  const processing = await finish(receipt.event_id, 'processing', null, w);
  assert.equal(processing.state, 'processing');
  assert.equal(await scalar('select processing_started_at is not null from tonde.billing_webhook_events where id = $1', [receipt.event_id]), true);
  const processed = await finish(receipt.event_id, 'processed', null, w);
  assert.equal(processed.state, 'processed');
  assert.equal(processed.audited, true);
  assert.equal(await scalar('select processed_at is not null from tonde.billing_webhook_events where id = $1', [receipt.event_id]), true);
  const backwards = await failure(() => finish(receipt.event_id, 'processing', null, w));
  assert.equal(backwards.code, 'PT409');
  const nonsense = await failure(() => finish(receipt.event_id, 'reopened', null, w));
  assert.match(nonsense.message, /processed, failed or ignored/);
  const missingReceipt = await failure(() => finish(randomUUID(), 'processed', null, w));
  assert.match(missingReceipt.message, /does not exist/);

  // A failed receipt keeps its cause rather than being discarded, and failure is terminal.
  const failing = await receive({});
  await finish(failing.event_id, 'processing', null, w);
  const failed = await finish(failing.event_id, 'failed', 'provider payload rejected', w);
  assert.equal(failed.state, 'failed');
  assert.equal(await scalar("select failure_message from tonde.billing_webhook_events where id = $1", [failing.event_id]), 'provider payload rejected');
  const terminal = await failure(() => finish(failing.event_id, 'processed', null, w));
  assert.equal(terminal.code, 'PT409');
  // ...and a receipt that failed cannot be used to move commercial state.
  const fromFailed = await failure(() => applySubscription({ workspace: w, event: failing.event_id, state: 'active', customer: 'cus_failed_1' }));
  assert.equal(fromFailed.code, 'PT409');
  assert.equal(await scalar('select count(*) from tonde.billing_accounts where workspace_id = $1', [w]), 0);

  // A provider-level event that names no TONDE workspace is still recorded, and is not attributed to
  // some unrelated workspace just because it shares a provider.
  const orphan = await receive({ type: 'invoice.created' });
  const noted = await finish(orphan.event_id, 'ignored', 'not a TONDE workspace event');
  assert.equal(noted.audited, false);
  assert.equal(noted.state, 'ignored');
  assert.equal(await scalar("select count(*) from tonde.audit_events where object_id = $1", [orphan.event_id]), 0);

  // The subscription path reads the same receipt, so an applied movement always has a witness.
  const applied = await applySubscription({ workspace: w, event: receipt.event_id, state: 'active', customer: 'cus_hook_1', stateAt: new Date().toISOString() });
  assert.equal(applied.applied, true);
  assert.equal(await scalar('select webhook_event_id from tonde.subscription_events where workspace_id = $1 and applied', [w]), receipt.event_id);
});

test('billing administration needs the workspace authority, and a member sees only the workspace answer', async () => {
  const w = await newWorkspace(A, 'admin');
  await activate(w, 'admin');
  // Another workspace owner cannot act on this one, and is told nothing about it.
  const deniedStatus = await failure(() => asOther(() => scalar('select tonde.billing_status($1)', [w])));
  assert.equal(deniedStatus.code, '42501');
  const deniedCheckout = await failure(() => asOther(() => scalar("select tonde.billing_checkout_start($1,'studio','upgrade')", [w])));
  assert.equal(deniedCheckout.code, '42501');
  const deniedEntitlement = await failure(() => asOther(() => scalar("select tonde.entitlement_state($1,'generation.credits')", [w])));
  assert.equal(deniedEntitlement.code, '42501');
  // Even a member of the workspace sees no commercial row: those are administrator surfaces.
  await db.query("insert into tonde.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')", [w, B]);
  for (const table of ['billing_accounts', 'workspace_entitlements', 'subscription_events', 'billing_checkout_intents', 'usage_reservations', 'usage_events']) {
    assert.equal(Number(await asOther(() => scalar(`select count(*) from tonde.${table} where workspace_id = $1`, [w]))), 0, `${table} is administrator-readable only`);
  }
  const memberStatus = await failure(() => asOther(() => scalar('select tonde.billing_status($1)', [w])));
  assert.equal(memberStatus.code, '42501');
  // ...but the entitlement answer is member-scoped, so a surface can explain an unavailable feature.
  assert.equal(await entitlement(w, 'generation.credits', B), 'AVAILABLE');

  // An administrator may open a checkout intent; nothing is subscribed by doing so.
  const intent = await asEditor(() => rows("select tonde.billing_checkout_start($1,'studio','upgrade') as result", [w]).then(result => result[0].result));
  assert.equal(intent.state, 'started');
  assert.equal(intent.provider, PROVIDER);
  assert.equal(await scalar('select state::text from tonde.billing_checkout_intents where id = $1', [intent.intent_id]), 'started');
  assert.equal(await scalar('select count(*) from tonde.billing_checkout_intents where id = $1 and provider_session_id is null', [intent.intent_id]), 1, 'the provider session is the backend\'s job');
  // A plan that is not sellable cannot be checked out, and an unknown plan is not invented.
  const draft = await failure(() => asEditor(() => scalar("select tonde.billing_checkout_start($1,'draft-plan')", [w])));
  assert.equal(draft.code, 'PT409');
  const unknown = await failure(() => asEditor(() => scalar("select tonde.billing_checkout_start($1,'invented-plan')", [w])));
  assert.match(unknown.message, /does not exist/);
  // Authority is not permission to grant: only the trusted server may write commercial state.
  const adminGrant = await failure(() => asEditor(() => scalar("select tonde.billing_grant_entitlement($1,'experiments.beta')", [w])));
  assert.match(adminGrant.message, /permission denied/);
  const adminUsage = await failure(() => asEditor(() => scalar("select tonde.usage_record($1,'generation',1)", [w])));
  assert.match(adminUsage.message, /permission denied/);
  // A checkout intent cannot be re-pointed at another plan, and only the server moves its state.
  const moved = await failure(() => asService(() => db.query("update tonde.billing_checkout_intents set plan_key = 'draft-plan' where id = $1", [intent.intent_id])));
  assert.match(moved.message, /names the plan and workspace it was opened for/);
  const clientMove = await failure(() => asEditor(() => db.query("update tonde.billing_checkout_intents set state = 'completed', completed_at = now() where id = $1", [intent.intent_id])));
  assert.match(clientMove.message, /permission denied/);
  // A completion must record when it happened, only the trusted server may record it, and a finished
  // intent is terminal — there is no path back to 'started'.
  const secondIntent = await asEditor(() => rows("select tonde.billing_checkout_start($1,'studio','second') as result", [w]).then(result => result[0].result));
  const unstamped = await failure(() => asService(() => db.query("update tonde.billing_checkout_intents set state = 'completed' where id = $1", [secondIntent.intent_id])));
  assert.match(unstamped.message, /checkout_completed_records_when/);
  await asService(() => db.query("update tonde.billing_checkout_intents set state = 'completed', completed_at = now() where id = $1", [secondIntent.intent_id]));
  const reopened = await failure(() => asService(() => db.query("update tonde.billing_checkout_intents set state = 'started' where id = $1", [secondIntent.intent_id])));
  assert.equal(reopened.code, 'PT409');
});

test('commercial movements are audited without secrets', async () => {
  const events = (await rows('select distinct event_type from tonde.audit_events')).map(row => row.event_type);
  for (const expected of ['billing.checkout_initiated', 'subscription.changed', 'entitlement.changed', 'usage.recorded', 'webhook.processed']) {
    assert.ok(events.includes(expected), `expected audit event ${expected}`);
  }
  // A webhook-driven movement names the provider channel, not a person.
  const movement = (await rows("select actor::text as actor, actor_user_id, reason from tonde.subscription_events where actor = 'webhook' limit 1"))[0];
  assert.equal(movement.actor, 'webhook');
  assert.equal(movement.actor_user_id, null);
  // An administrative grant names the administrator the server acted for, so a commercial decision is
  // never anonymous — and no actor is ever invented when none was given (that path is refused instead).
  const grant = (await rows("select metadata from tonde.audit_events where event_type = 'entitlement.changed' limit 1"))[0];
  assert.equal(grant.metadata.action, 'grant');
  assert.equal(grant.metadata.actor_user_id, A);
  // No audit payload carries a credential of any kind.
  assert.equal(Number(await scalar("select count(*) from tonde.audit_events where metadata::text ~* '(token|secret|password|bearer|refresh|api[_-]?key)'")), 0);
  assert.equal(Number(await scalar("select count(*) from tonde.billing_webhook_events where payload::text ~* '(token|secret|password|bearer|refresh|api[_-]?key)'")), 0);
  // A receipt stores the verification that was performed, never the signature value itself.
  const signatureColumns = await rows(`select column_name from information_schema.columns
    where table_schema = 'tonde' and table_name = 'billing_webhook_events' and column_name like '%signature%' order by column_name`);
  assert.deepEqual(signatureColumns.map(row => row.column_name), ['signature_scheme', 'signature_verified_at']);
});
