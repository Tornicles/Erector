# Creator directive — one consolidated, idempotent Supabase migration file

> **Superseded hosted state (dated correction, 2026-10-08).** Every hosted migration
> statement below is the record of the day it was written. As of 2026-10-08 the linked
> project's ledger records **001–030** with matching `tonde` effects, the untruncated
> catalog comparison reports **0 differences over 4087 identities**
> (`test-results/pre-prompt10/hosted-final-diff.json`), and the expanded two-user runner
> reports **538 pass / 1 blocked / 0 fail**. The only remaining blockers are external
> (mail capacity, Google sign-in, plan-gated leaked-password protection). See the
> [Pre-Prompt-10 certification](pre-prompt10-final-certification.md).

Relayed 2026-10-07 by the verification/peer session on the creator's explicit instruction:
when the correction pass is done, also produce **one giant consolidated Supabase migration**
covering the whole chain, with instructions that **anything already present in Supabase is
ignored and only what is missing is applied**.

This fits entirely inside correction-pass §7 ("must produce a safe forward deployment path,
but must not perform the deployment") and conflicts with none of §22's constraints: the
migration **sources stay immutable** — this is a *generated deployment artifact*, not a rewrite
of 009–025, and it is still the creator who pastes it into the Supabase dashboard.

## What to build

`supabase/manual-apply/<first>_to_<last>_full_schema_idempotent.sql`, where the range follows the
newest migration in `supabase/migrations/` (currently
`202610050001_to_026_full_schema_idempotent.sql`, built by `scripts/build-idempotent-schema.mjs`).
Keep the incremental packages and their verifiers in place; this file is an additional single-file
path, not a replacement.

## Content rules

1. **One executable file**, wrapped `begin; … commit;`, with a clearly labeled section per
   source migration (`-- ==== 001 tonde_core ====`, …) so it stays reviewable.
2. **Never destructive.** No `drop table`, `drop column`, `truncate`, no data rewrites. Existing
   hosted rows, UUID identities, approvals, history, Results/Takes, versions and branches must
   survive untouched.
3. **Idempotent per object kind — "ignore what's there, create what's missing":**
   - tables: `create table if not exists`;
   - columns on existing tables: `alter table … add column if not exists`;
   - enums: create new types with their full value list; for existing types use
     `alter type … add value if not exists`;
   - functions: `create or replace function` — one **final-state** definition per function
     (consolidation removes the intermediate churn of the incremental chain);
   - indexes: `create index if not exists` (no `concurrently` inside the transaction);
   - policies: `drop policy if exists` + `create policy` (dropping a policy never drops data —
     this guarantees the final-state policy even on already-initialized projects; Postgres has
     no `create policy if not exists`);
   - triggers: `drop trigger if exists` + `create trigger`;
   - RLS: `alter table … enable row level security` is idempotent (apply FORCE only where the
     source chain does);
   - grants: plain `grant`/`revoke` statements are naturally idempotent;
   - extensions/domains/other catalog objects: `if not exists` forms or catalog-guarded
     `do $$ … $$` blocks.
4. **Header instruction block inside the file** (human-readable, at the top) stating:
   - purpose: initialize a fresh Supabase project in one paste, OR bring the current hosted
     project (001–010 applied) up to the certified chain by applying only what is missing;
   - safe on the existing hosted project: already-present objects are skipped or replaced in
     place, no data is touched;
   - running it via the dashboard SQL editor does **not** write
     `supabase_migrations.schema_migrations` — ledger state stays separate from schema state;
     record what you applied; never rerun historical SQL to repair the ledger (a history-only
     `supabase migration repair` remains the optional ledger path);
   - it is transactional: if any statement fails, nothing is applied — fix the cause and re-run
     (safe because idempotent);
   - do not run it while an incremental package application is half-finished — finish or roll
     back that attempt first;
   - after the commit, run the trailing verification block.
5. **Tail: consolidated verification.** Union of the per-package verify checks as one result
   set — every row must read `OK`; a `MISSING` row names the object and the source migration
   that owns it. A creator who sees `MISSING` investigates that object; nothing is re-run
   destructively.

## Timing and registration

Produce it at the correction-pass **freeze**, after the final battery, so it reflects the exact
certified chain — then register it in the §7 migration matrix and the §19 correction handoff as
the single-file deployment path. Byte-compare or generate it mechanically from the source chain
the same way the per-package tails are extracted; hand-assembling invites drift.
