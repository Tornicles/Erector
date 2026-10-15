# Manual hosted migrations 011 to 035 (Prompt 4 Director through the Prompt 10 set and its one repair)

**State changed on 2026-10-08, and the paragraphs below are the historical record, not the current
state.** The ledger and the schema were reconciled on the linked development project: 011-014 were
repaired as *history only* and never replayed, the genuinely missing range was completed as a
forward rollout, the Prompt 10 schema set (031-034) went to hosted as one reviewed forward rollout,
and migration 035 was then applied as a forward repair of one authorization-order defect that the
hosted acceptance runner found. The ledger now records 001-035 while the hosted `tonde` effect state
matches the source migrations - proven by re-reading the whole catalog from both sides
(`scripts/pre-prompt10-catalog-verify.mjs` compares 4791 untruncated identities including function
bodies and ACLs; it reported 0 differences after migration 035). `supabase db diff` remains
impossible on this machine (no Docker), so that catalog comparison is the verified substitute and
must be described as such. The historical reading was:

Read-only re-verification on 2026-10-07 threw up one disagreement between the ledger and the schema
itself, so read that state as two separate facts: `supabase migration list --linked` reported the
**ledger at 001-010**, while probes of the hosted `tonde` PostgREST schema cache and of individual
columns put the **effect state at 001-014 present and 015-026 absent**. Migrations 011-014 had been
applied by hand without ledger rows.

## Whole schema in one idempotent file (001-035)

`202610050001_to_035_full_schema_idempotent.sql` is every migration from 001 to 035 emitted as a
single state-tolerant file, for when you want one run to succeed and do not need to know where the
database currently stands. 031 (integrations), 032 (publishing), 033 (exports) and 034 (billing,
entitlements, usage and webhooks) are the Prompt 10 packets, and 035 is the forward repair of the
`publication_reconcile` authorization order; all five are **applied** to the linked project (ledger
001-035, 0 catalog differences). Reach for this file only on a project that stops earlier in the
chain. The range in the file name follows the newest migration, so the
artifact is renamed rather than left stale when a migration is added. It is generated, never
hand-edited:

**Current generated artifact (2026-10-14): [`202610050001_to_054_full_schema_idempotent.sql`](202610050001_to_054_full_schema_idempotent.sql).** It contains every source migration currently present through 054 (there is no 051 file), including the 053/054 Director idempotency repairs. It is a one-shot, state-tolerant full schema bundle, generated from ordered migrations—not a replacement for normal `supabase db push` and not a migration-ledger repair. The latest applied hosted target is still ambiguous: migration 054 was verified on ref `afwkjgcpvoqvuesyetez`, while a comment in `backend/.env` names `cryujrhdnvofexzceosr` as development. Do not use this bundle to guess which project is intended.

Regenerate and check it with:

```
node scripts/build-idempotent-schema.mjs
node scripts/build-idempotent-schema.mjs --check
node --test tests/database/idempotent-schema.verify.mjs
```

For a PostgreSQL client, use `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/manual-apply/202610050001_to_054_full_schema_idempotent.sql`; this stops immediately at the first actual error rather than continuing after a failure. Alternatively paste the entire file into the Supabase SQL editor.

This bundle applies against an empty, partly migrated, or complete schema and is verified against the ordered migrations. Existing compatible objects/data are preserved; same-name but incompatible definitions can still fail by design rather than being silently accepted. Stop and inspect any real SQL error before retrying. Manual SQL application does **not** update `supabase_migrations.schema_migrations`; the ledger block is commented out intentionally. A clean Supabase project should use the official migration CLI path, and a partial/unknown project must have its identity and state reviewed before choosing a rollout path.

```
node scripts/build-idempotent-schema.mjs          # regenerate
node scripts/build-idempotent-schema.mjs --check  # verify the built file
```

Every statement in it is guarded, so a second run is a no-op instead of an `already exists` error:

| construct | guard |
| --- | --- |
| `create schema` / `table` / `index` | `IF NOT EXISTS` |
| `create function` | `CREATE OR REPLACE FUNCTION` |
| `create trigger` | `DROP TRIGGER IF EXISTS`, then `CREATE` |
| `create policy` | created only when absent, never dropped and re-created |
| `create type` | guarded by `EXECUTE`; `duplicate_object` ignored |
| `alter table add column` | `ADD COLUMN IF NOT EXISTS` |
| `alter table add [constraint]` | skipped when an equivalent constraint already exists |
| `alter table drop constraint` | `DROP CONSTRAINT IF EXISTS` |
| `alter table alter column ... type` | skipped when the column already has the target type |
| `alter type ... add value` | skipped when the label already exists |
| `alter function ... set schema` | skipped when the destination already holds the function |
| `grant ... on all tables in schema X` | expanded to the tables that existed at that point |
| `grant` / `revoke` naming a moved helper | skipped once the pre-move name is gone |
| catalog-driven loops in `DO` blocks | pinned to the tables that existed at that point |
| seeds (`storage.buckets`, `tonde.ai_providers`) | `ON CONFLICT DO NOTHING` |

`IF NOT EXISTS` prevents duplicate-object errors only; it does not prove an existing table,
column, constraint, index, or policy has the intended definition. The bundle avoids masking such
drift: incompatible operations can still fail and must be reviewed, not ignored. Do not wrap the
whole file in a blanket exception handler or change the verification query to treat missing objects
as success.

Three constructs need more than a simple existence check, because they are not local to themselves.
Migration 010 moves five membership/storage helpers from the exposed `tonde` schema into
`tonde_private`; anything that creates one of those functions, creates a policy that calls one, or
grants on one has to account for the pre-move name being gone. Migration 006 converts several text
columns to enums, and PostgreSQL refuses to alter a column a policy depends on, so the conversion
and the policy drop that precedes it share one guard. And `grant ... on all tables in schema X`, plus
any `DO` block that reads `information_schema` to decide what to touch, would silently cover *more*
objects on a second run than on the first, so both are pinned to the table set that existed when the
migration was first applied.

Nothing existing is dropped or rewritten: it creates only what is missing, so rows and objects from
an earlier run survive untouched. Each migration keeps its own `begin;`/`commit;`, so one failure
cannot roll back an earlier migration. The file ends with a verification query; every row must read
`OK`.

`tests/database/idempotent-schema.verify.mjs` runs the whole thing against a real embedded
PostgreSQL and asserts that all of this is true: applied over a complete database, over the historical
001-014 state, and over an empty database it reaches exactly the object set every migration
produces, and a second apply changes nothing. It checks that each source migration appears exactly
once, in order, in the generated bundle:

```
node scripts/build-idempotent-schema.mjs              # rebuild the artifact first
node --test tests/database/idempotent-schema.verify.mjs
```

One deliberate difference is accepted there and nowhere else. The file re-runs migration 002's
point-in-time blanket `revoke ... on all functions in schema` statements, so on a database that is
already complete it also revokes PostgreSQL's *implicit* `PUBLIC EXECUTE` from functions created
after 002 (the `tonde_private` helpers, for example). That is strictly fewer privileges for the
`PUBLIC` pseudo-role - never a change to what `anon`, `authenticated` or `service_role` may do, and
never a new grant. The proof asserts exactly that shape: `aclitem` element order is canonicalised
because order is presentation rather than privilege, the owner entry is ignored because an owner
always keeps its own rights, every named role set must match the migration path exactly, and any
object left holding fewer `PUBLIC` privileges is reported rather than hidden.

It is deliberately outside the `tests/database/*.test.mjs` glob that `npm test` runs, because it
goes red whenever a migration is added until the artifact is rebuilt - a useful signal for whoever
owns the artifact, but interference for anyone else certifying a pass on the same checkout.

Two limits are worth knowing. The migrations remain the source of truth - this file is derived from
them, and `supabase db push` against a clean project is still the canonical path. And because it
cannot know the names PostgreSQL auto-generates for unnamed constraints, an
`alter table ... add <unnamed constraint>` is detected by comparing a normalized
`pg_get_constraintdef` rather than a name; that comparison has to see through PostgreSQL's
`IN (...) <=> = ANY (ARRAY[...])` and `'literal'::type` rewrites, so an unusual constraint definition
could be added twice. A duplicate constraint is never an error, and the test above would catch it.

Therefore: reconcile 011-014 with a **history-only ledger repair** (as was already done for 009 and
010) and **never replay them**;then apply the forward packages **06_** (015) onward **in this order, once**:

**Already in effect hosted: verify only, never re-run.**

1. `01_202610050011_director_intake.sql` - applied by hand, no ledger row
2. `02_202610050012_director_intelligence.sql` - applied by hand, no ledger row
3. `03_202610050013_director_reference_and_apply.sql` - applied by hand, no ledger row
4. `04_202610050014_director_apply_operation.sql` - applied by hand, no ledger row
5. `05_verify.sql` - run to confirm the 011-014 objects are present; every row must read `OK`

**Genuinely unapplied forward range: apply the rest in order.**
6. `06_202610050015_studio_workspace.sql` - Prompt 5 Studio (additive)
7. `06_verify.sql` - every row must read `OK`
8. `07_202610050016_real_production.sql` - Prompt 6 Real Production Director (additive)
9. `07_verify.sql` - every row must read `OK`
10. `08_202610050017_ai_creation.sql` - Prompt 7 AI Creation & Hybrid Director (additive)
11. `08_verify.sql` - every row must read `OK`
12. `09_202610050018_long_form_series.sql` - Prompt 8 Long-form, Movie Mode, Series & Production Line (additive)
13. `09_verify.sql` - every row must read `OK`
14. `10_202610050019_dependencies_impact.sql` - Prompt 9A Dependency Graph, Impact Engine & Stale Artifacts (additive)
15. `10_verify.sql` - every row must read `OK`
16. `11_202610050020_continuity_engine.sql` - Prompt 9B Continuity Engine (additive)
17. `11_verify.sql` - every row must read `OK`
18. `12_202610050021_production_memory.sql` - Prompt 9C Production Memory & Structured Search (additive)
19. `12_verify.sql` - every row must read `OK`
20. `13_202610050022_versioning_branches.sql` - Prompt 9D Versioning, Branches, Restore, Merge & Change Impact (additive)
21. `13_verify.sql` - every row must read `OK`
22. `14_202610050023_approval_lock_readiness.sql` - Prompt 9E Approval, Locks & Production Readiness (additive)
23. `14_verify.sql` - every row must read `OK`
24. `15_202610050024_results_shot_match.sql` - Prompt 9F Results, Shot Match & FIX THIS SHOT (additive)
25. `15_verify.sql` - every row must read `OK`
26. `16_202610050025_prompt7_integrity_readiness.sql` - Prompts 1-9 correction pass: tenant-safe model-profile foreign keys and single-computation readiness (additive)
27. `16_verify.sql` - every row must read `OK`

Step 6 makes Shots first-class canonical rows and adds the guarded Studio mutation
RPCs. Step 8 gives each Shot a Real Execution Plan body on `tonde.execution_plans`
and adds Setup matching, practical alternatives, capture state, Take logging and
field deviations. Both are additive: no column changes meaning and no earlier
migration is rewritten. The README's earlier "if 011-014 are already applied and verified, start at
step 6" hedge is now a verified fact: 011-014 are in effect hosted, so **start at step 6 (015)**.

Step 16 adds the Prompt 9B continuity engine: declared temporal state per trait and
point in Production order, its deterministic check, and the findings a creator decides
about, on three new workspace-isolated tables. `continuity_state_set` supersedes an
older statement at the same point instead of overwriting it, and a check only records
what the declarations say. Additive as always: no earlier migration is rewritten, and
the private `ci_*` helpers stay unreachable.

Step 10 adds the provider-neutral AI Creation layer: the provider catalogue, declared
model capability profiles, per-workspace connection truth, continuity locks, the AI
prompt/plan columns on `tonde.execution_plans`, generation Attempts with idempotency,
Results selection and batch generation. It stores no provider credential and holds no
vendor capability facts of its own - a model is only known to be capable once you
declare it. It is additive: migrations 001-016 are untouched.

Step 12 adds long-form structure on the canonical hierarchy: `tonde.acts` and
`tonde.sequences` gain purpose/summary/lifecycle, a Scene may sit directly in an Act,
`tonde.series` gains kind/format/timezone/revision, `tonde.series_episodes` gains
slot/title/depth, and three new tables carry derived summaries and durable Generate
Ahead jobs with per-slot items. Runtime rollups (Shots -> Scene -> Sequence -> Act ->
Production) are computed at read time only: a planned target is never overwritten by a
calculated child total, and both are reported with the real discrepancy. It is additive:
migrations 001-017 are untouched. Generate Ahead creates Production shells and an
Episode association; it never writes Story/Script/Scenes/Shots and never launches paid
generation.

Step 22 adds the Prompt 9E approval, lock and readiness layer: one append-only decision record
(`tonde.access_decisions`) that pins the revision an approval named, keeps lock and approval
independent, and records who unlocked something and why, plus `production_readiness` - a category
derived from real Production state with actionable, navigable blockers instead of a score. It never
guesses whether an external AI provider is available. Additive: migrations 001-022 are untouched and
the private `ax_*`/`rd_*` helpers stay unreachable.

Step 24 adds the Prompt 9F Results, Shot Match and FIX THIS SHOT layer. A Result is what was
actually created, not the plan: it keeps the Real Take, AI Attempt or media it came from, and the
verified media capability is derived in the database from real `media_files` rows, so a visual
comparison cannot be claimed when no frame or image exists and an audio claim cannot be made without
a track. `shot_match_reports` gains the modalities, per-dimension verdicts, the four-part summary
ordered by production impact, the limitations the surface must admit, the origin of the analysis,
the recommendation and the creator's decision - and it stays read-only to clients. A new
workspace-isolated `tonde.match_corrections` table carries a scoped correction with its root cause
and a previewed impact; applying one writes through the existing versioning path with
`source_action = 'correction'`, preserves the previous plan, Result and every earlier analysis,
refuses a locked target, and becomes reusable memory only when a later analysis confirmed it helped.
Two existing objects change, both disclosed: `shot_match_reports` gains a workspace-scoped identity
key so a correction can reference the analysis it came from, and the private `vb_fields` map is
replaced by an opt-in superset that adds the execution-plan fields a scoped correction may target
while identity, ordering, approval and locks stay unwritable. Additive otherwise: migrations 001-023
are untouched and the private `ms_*` helpers stay unreachable.

## Packages 17-20 (026-029), applied forward on 2026-10-08

These four packages are on top of the rollout described above and are already in effect hosted.
Reach for them only on a project that stops earlier in the chain; each one is additive and none
rewrites an applied migration.

28. `17_202610050026_pre_prompt10_product_amendment.sql` - Reference identity/purpose, Reference
    pruning from Production shaping, the versioned Audio Plan and per-Scene Music/Sound Direction
    (`17_verify.sql`).
29. `18_202610050027_pre_prompt10_certification_repairs.sql` - Reference history capture, enclosing
    Production/Act/Sequence/Scene locks for direct hierarchy and audio writes, own-lock-only derived
    artifacts so source staleness stays visible, and observed evidence that must cite available
    media (`18_verify.sql`).
30. `19_202610050028_reference_completion_pin.sql` - a completion write is refused unless the
    Reference identity is still the revision the worker analyzed, so a slow worker cannot complete
    against a superseded pin (`19_verify.sql`).
31. `20_202610050029_guard_definer_repair.sql` - the two platform guards become `SECURITY DEFINER`,
    as every other TONDE guard already was. As `SECURITY INVOKER` functions they depended on the
    caller holding `EXECUTE` on `tonde_private` helpers, which only `authenticated` holds, and
    PostgreSQL may evaluate an `AND` operand out of order - so every write by any other role, the
    server role included, failed with `permission denied for function is_workspace_member` on 81
    guarded tables before the guard decided anything (`20_verify.sql`).
32. `21_202610050030_conflict_sqlstate.sql` - every optimistic-concurrency conflict raises the
    PostgREST-mapped `PT409` (HTTP 409) instead of SQLSTATE `40001`. A custom `40001` tells PostgREST
    the failure is transient, so it retries the transaction **indefinitely**: the request never
    returns, one API call becomes several transactions and the project burns CPU. Supabase documents
    the behaviour ("SQLSTATE 40001 (serialization_failure) in an RPC function causes infinite
    retries", last edited 2026-10-08: present in PostgREST 14, fixed in 16) and recommends a code
    that maps to the intended HTTP status. 44 functions are re-defined, 51 conflict raises updated,
    with bodies, messages, security mode, search_path and ACLs otherwise unchanged
    (`21_verify.sql`). This file is generated by `scripts/build-conflict-sqlstate-migration.mjs`
    from the applied definitions, never hand-assembled.

## Prompt 10 packages 031-035, applied forward on 2026-10-08

The Prompt 10 schema set went to the linked project as one reviewed forward rollout, then the
hosted two-user acceptance runner found one real defect in it and migration 035 repaired it. All
five are in effect hosted; reach for them only on a project that stops earlier in the chain.

33. `202610050031_prompt10_integrations.sql` - the provider registry, declared capabilities with
their required scopes, the connection truth (a CONNECTED account requires an enabled provider with a
`verified` adapter), the server-only OAuth-state table, and the capability-state answer. Provider
configuration refuses secret-shaped keys: no credential is stored in TONDE.
34. `202610050032_prompt10_publishing.sql` - publications that pin the exact Production revision,
Result revision and media checksum, append-only creator authorizations that name the version and
destination they authorize, submission attempts with an idempotent fingerprint, and
`UNKNOWN_REMOTE_STATE` reconciliation. A creative approval is never publishing authority, and
submission is a service-role RPC only.
35. `202610050033_prompt10_exports.sql` - the two distinct export products (full document and
production package), the REQUESTED → BUILDING → READY | FAILED → EXPIRED lifecycle, the manifest law,
and the closed client storage read path for `tonde-exports` (a download is an authorization decision
plus a short-lived server-signed URL).
36. `202610050034_prompt10_billing.sql` - entitlement definitions and grants, billing plans and
checkout intents, subscription events applied only from verified provider receipts (newer state only,
idempotent on the event identity), usage reservations/commit/release and cost-keeping that never
conflates what a provider charged, what TONDE estimated, what the creator paid and what credits were
consumed.
37. `202610050035_prompt10_reconcile_guard_order.sql` - the forward repair: `tonde.publication_reconcile`
now makes its authorization decision before it resolves the publication row, so a cross-tenant call is
a controlled `42501` (HTTP 403) instead of a lookup failure (`P0002` → HTTP 500). Only that function is
re-defined, with behaviour, messages, security mode, search_path and ACLs unchanged.

`tests/database/prompt10-authorization-order.test.mjs` is the durable audit of that defect class: it
sweeps every client-reachable Prompt 10 RPC from a non-member workspace and requires a controlled
denial, never a lookup failure, and it fails if a future Prompt 10 RPC becomes client-reachable
without being audited.

Step 26 is the Prompts 1-9 correction pass. It repairs the two residual Prompt 7 findings without
rewriting migration 017. First, `execution_plans.model_profile_id` and
`fallback_model_profile_id` were added as bare uuid columns: only the `save_ai_plan` RPC enforced
membership, so the new tenant-safe composite foreign keys to `ai_model_profiles` now make it a
database guarantee (matching the key `ai_generation_attempts` already carries), with `on delete
restrict` so a depended-on profile cannot be deleted and both columns still nullable. Second,
`ai_creation_surface` recomputed `ai_readiness_state` up to four times per Shot (a scene lateral,
the Shot list and three summary filters); it now derives each Shot's readiness and selected Attempt
once and reuses the value, so a large Production loads in one pass per Shot. The returned document
keeps exactly its previous shape and no readiness reason changes. Nothing is dropped: migrations
001-024 are untouched, RLS and tenant boundaries are unchanged, and the ACLs are re-asserted as 017
established them (authenticated only).

Step 27 adds the pre-Prompt 10 Product Constitution amendment. It adds separate Reference identity/provenance and creator purpose without changing the meaning of `source_description`, and blocks incomplete/inferred References from Production-shaping bindings, active dependencies and Director use. It adds a versioned Production Audio Plan only for relevant timed audiovisual work, distinct per-Scene Music and Sound Direction, intentional silence, integer-millisecond cues, supplied-song provenance, scoped/revision-checked RPCs, and the existing approval/lock/version/dependency hooks. Setup's stored inventory and `/setup` compatibility route remain unchanged; creator-facing language calls it Production Kit. Migration 026 is additive and does not start Prompt 10 or 11.

Step 20 adds the Prompt 9D versioning layer. It is practical creative history, not a database git
clone: `object_versions` already captured a snapshot on every write, so 9D makes that history
usable and immutable (a `versions_immutable` guard refuses any update or delete of a version),
adds meaningful-field compare, and adds restore-as-a-new-revision so an older version is never a
rewind. Three new workspace-isolated tables carry object-level creative branches, the field patches
a branch proposes, and reviewed merge proposals. A branch changes nothing on the mainline until an
explicit merge is accepted, and an accepted merge writes through the normal canonical update path
(each change pinned to the mainline revision it was written from, so a moved mainline is a `40001`
conflict rather than a blind write) and then propagates through the Prompt 9A impact engine, so
approved content is flagged for review and locked objects are reported instead of rewritten. A
merge is never an approval. Two existing objects change, both disclosed: `object_versions` gains an
immutability guard trigger, and `capture_revision` is replaced by an opt-in superset that reads a
transaction-local action name so a restore or a merge is recorded honestly instead of guessing from
the SQL verb (with the setting absent, the recorded action is exactly what it was before). It is
additive otherwise: migrations 001-021 are untouched and the private `vb_*` helpers stay
unreachable.

Step 18 adds the Prompt 9C production memory layer: three new workspace-isolated tables hold a
memory policy per scope, successful-pattern candidates drawn from real evidence, and the memory
items themselves, each carrying its statement, kind, scope, the object and revision it was drawn
from, and whether it is still in force. It is structured and inspectable - never a hidden
conversational profile. The authority tier is the source (a current creator instruction outranks a
current Production decision, which outranks an explicit saved preference, which outranks a
historical pattern, which outranks an inference); restating the same tier retires the older
statement as history instead of overwriting it, while a stronger tier merely outranks it. No
table has a direct write path: memory is written only through the guarded RPCs, an inference
cannot claim creator authority and must disclose its basis, an accepted candidate is the only
thing that can create `origin='accepted'` knowledge, and `production_search` reads real columns
and returns real object references with no embeddings and no media analysis. It is additive:
migrations 001-020 are untouched, and the private `mi_*` helpers stay unreachable.

Step 14 extends the canonical `tonde.object_dependencies` table rather than replacing it: one
direction only (the source is depended on, the target depends on it), with a rationale,
strength, origin, affected fields and an active flag, so a relationship is deactivated and
never deleted. Two new tables carry stale markers and recorded impact analyses. Derived edges
come from real Production state - scope bindings, execution plans and dialogue runtime - and
an `inferred` edge keeps its own rationale and confidence and is always reported as a
*potential* dependency, never as canonical certainty. Impact is computed and recorded by
`impact_preview` and is applied only by the separate `apply_impact`, using one of the three
constitutional propagation choices (UPDATE ALL / REVIEW CHANGES / CHANGE ONLY THIS); locked
objects are reported instead of changed and approved content is flagged for review rather
than rewritten. It is additive: migrations 001-018 are untouched, and `object_dependencies`
gains columns without changing what any earlier migration meant.

`202610050011_to_014_director_intelligence.sql` is the same SQL as 1-4 concatenated,
concatenation-verified byte for byte, for a single paste or a single `psql -f`.

## Never

* Never re-run `202610050009_revoke_public_rls_admin.sql` or
  `202610050010_hide_policy_helpers.sql`. Both were applied by hand already.
* Never run these twice. The individual and ordered files are not idempotent: a second
  run fails with `already exists`, which means it was already applied. The single
  exception is the `202610050001_to_<newest>_full_schema_idempotent.sql` artifact, which is built
  to be re-runnable.

## Why every file starts with \`begin;\` and contains only ASCII

A clipboard or editor path can drop the first character on paste. When a file started
with a `--` comment, that produced `- ...` and failed with
`syntax error at or near "-"`. Starting with executable SQL removes that failure mode,
and pure ASCII removes any encoding risk.

## Recording history

The CLI records what it applies. The Dashboard SQL Editor does not: if you paste via the
editor and later use the CLI, uncomment the `insert into
supabase_migrations.schema_migrations ...` block at the bottom of the combined file first.

## Copying safely (PowerShell / cmd)

Selecting text in a viewer can drop the first character of line 1. Read the file into the
clipboard instead of selecting it by hand:

```powershell
# PowerShell
Get-Content -Raw supabase/manual-apply/202610050011_to_014_director_intelligence.sql | Set-Clipboard
```

```bat
:: cmd.exe
clip < supabase\manual-apply\202610050011_to_014_director_intelligence.sql
```

Every file already starts with `begin;`/`select`, so a dropped first character now shows up
as `syntax error at or near "egin"` at line 1 - an obvious truncation. If you see that,
re-copy with one of the commands above, or use `supabase db push` / `psql -f`, which never
touch the clipboard.
