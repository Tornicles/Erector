# Prompts 1–9 correction handoff — consolidation, defect repair and freeze before Prompt 10

> **Superseded hosted state (dated correction, 2026-10-08).** Every hosted migration
> statement below is the record of the day it was written. As of 2026-10-08 the linked
> project's ledger records **001–030** with matching `tonde` effects, the untruncated
> catalog comparison reports **0 differences over 4087 identities**
> (`test-results/pre-prompt10/hosted-final-diff.json`), and the expanded two-user runner
> reports **538 pass / 1 blocked / 0 fail**. The only remaining blockers are external
> (mail capacity, Google sign-in, plan-gated leaked-password protection). See the
> [Pre-Prompt-10 certification](pre-prompt10-final-certification.md).

Pass scope: inspect the completed Prompt 1–9 system, reconcile the earlier gap audit against the
final Prompt 9 tree, repair genuine internal defects, correct inaccurate/stale documentation, and
freeze the tree with the full regression battery green. **No Prompt 9 work was reopened, no Prompt
10/11 work was started, and no hosted migration was applied.**

Authoritative companion: [system-gap-audit-prompt1-9-final.md](system-gap-audit-prompt1-9-final.md)
(per-prompt verdicts, finding reconciliation, migration matrix). Prompt 9 certification remains
[prompt-9g-handoff.md](prompt-9g-handoff.md).

## REGRESSION VERDICTS

### PROMPT 1 REGRESSION — PASS
Auth, workspace isolation, schema foundation, RLS, Setup, Assets and Media foundation unchanged and
green (`foundation.test.mjs` 21, `constitution.test.mjs` 6, `foundation.spec.ts`, `foundation.test.tsx`).

### PROMPT 2 REGRESSION — PASS
Constitution invariants hold: one Master Production, canonical approvals, locks separate from
approval, Result semantics, evidence labels, human authority, Shot Match loop
(`constitution.test.mjs`, `tests/product/constitution.test.mjs` 6).

### PROMPT 3 REGRESSION — PASS
Application shell, navigation and the seven canonical routes unchanged (`foundation.spec.ts`).

### PROMPT 4 REGRESSION — PASS
Director Intelligence, Reference Analysis, Story, Script, Dialogue, Reality Check, epistemic truth
(`prompt4-intelligence.test.mjs` 8, `intelligence.test.tsx`, `intelligence.spec.ts`).

### PROMPT 5 REGRESSION — PASS
Studio, Scene/Shot editing, timeline, approvals foundation, locks, scoped Director
(`prompt5-studio.test.mjs` 14, `studio.test.tsx` 23, `studio.spec.ts` 2). The reconstructed handoff's
concrete claims were re-verified file-by-file this pass.

### PROMPT 6 REGRESSION — PASS
Real plans, Takes, pickup, Setup-aware execution (`prompt6-real-production.test.mjs` 18,
`test_real_production*.py`) — and 9F's `pickup_needed` write path is unchanged.

### PROMPT 7 REGRESSION — PASS
AI prompts, Character/World/Product Locks, Attempts, Results linkage, Hybrid
(`prompt7-ai-creation.test.mjs` 25, `ai-creation.spec.ts`). Migration **025** touches this layer and
the whole Prompt 7 suite passes against it, including the `ai_creation_surface` document shape.

### PROMPT 8 REGRESSION — PASS
Acts, Sequences, long-form, Series, Episodes, Generate Ahead, Production Line
(`prompt8-long-form.test.mjs` 25, `movie-mode.spec.ts`, `series.spec.ts`).

### PROMPT 9 REGRESSION — PASS
Dependency graph, impact, continuity, memory, search, versioning, branches, restore, merge,
conflicts, approvals, locks, readiness, Results, Take history, Shot Match, FIX THIS SHOT, correction
workflow, creator approval, long-form integration — and the 9G integration seams are explicitly
re-run (`prompt9a` 13, `prompt9b` 16, `prompt9c` 19, `prompt9d` 14, `prompt9e` 11, `prompt9f` 15,
`prompt9g` 10; `prompt9-integration.spec.ts` passes). `MASTER PROMPT 9 — PASS` stands.

## DEFECTS FOUND

1. **Model-profile foreign-key integrity (Prompt 7 / migration 017).** `execution_plans.model_profile_id`
   and `fallback_model_profile_id` were bare `uuid` columns. Only the `save_ai_plan` RPC enforced
   membership, so a direct write could reference a nonexistent profile or another workspace's
   profile. Reproduced in SQL: such a write succeeded before the repair.
2. **Per-Shot readiness recomputation (Prompt 7 / migration 017).** `ai_creation_surface` evaluated
   `ai_readiness_state` up to four times per Shot (scene lateral, Shot list, and three summary
   filters) plus `ai_selected_attempt` twice. Reproduced by counting invocations: 24+ evaluations on
   a 6-Shot Production where 6 are needed.

Both are internal, both were repaired additively, neither required rewriting migration 017.

## DEFECTS FIXED

**Migration `supabase/migrations/202610050025_prompt7_integrity_readiness.sql` (161 lines, additive).**

* Two tenant-safe composite foreign keys on `tonde.execution_plans` —
  `(workspace_id, model_profile_id)` and `(workspace_id, fallback_model_profile_id)` — referencing
  `tonde.ai_model_profiles(workspace_id, id)` with `on delete restrict`, matching the key
  `ai_generation_attempts` already carries. Both columns stay nullable; a null profile remains valid
  in either position. Two partial indexes added for the referencing columns.
* `create or replace tonde.ai_creation_surface(...)` now derives each active Shot's readiness and
  selected Attempt **once** in a `base` CTE and reuses the value in the scene rollup, the Shot list
  and the summary. The returned document keeps exactly its previous shape, every readiness reason is
  unchanged, and the ACLs are re-asserted as migration 017 established them (authenticated only, not
  anon/service_role).

**Tests.** `tests/database/prompt1-9-corrections.test.mjs` (4 tests) proves: the two constraints exist
and target `ai_model_profiles`; a valid primary and fallback profile are accepted; a nonexistent
profile is rejected (`23503`); another workspace's profile is rejected (`23503`); a null profile
stays valid; a referenced profile cannot be deleted (`23001`, restrict); re-declaring a model moves
the revision exactly once; the readiness bound is exactly one evaluation per active Shot at 6 Shots
**and** at 30 Shots; and the `ai_creation_surface` document keeps every key.

**Manual-apply package.** `supabase/manual-apply/16_202610050025_prompt7_integrity_readiness.sql`
(140 lines, the byte-identical executable tail, pure ASCII) plus `16_verify.sql` (**12 rows, every
one `OK`** against a 001→025 stack). `15_verify.sql` also re-run: **102 rows, all `OK`**.

**Documentation corrected.** The hosted migration record contradicted itself across AGENTS.md, the
runbook, the 9G handoff, the Prompt 1/2 handoffs, the migration audit, the acceptance log and the
manual-apply README. All now state the two verified facts separately (ledger vs effect) and point at
the single matrix.

## STALE/FALSE AUDIT FINDINGS

* **"No jobs/outbox table exists." — FALSE.** `tonde.jobs` has existed since migration 001, hardened
  by 005 and extended by 018; the partial `jobs_claimable` index is the worker-queue foundation. The
  missing pieces (outbox, dispatcher, worker claiming, lease lifecycle, retries, telemetry) are
  Prompt 11 work, not a missing foundation. A DB test now pins the foundation so the claim cannot
  recur.
* **"`docs/prompt-5-handoff.md` is missing." — ALREADY FIXED**, and verified this pass (13 RPCs, 3
  helpers, `shots_live_order`, 14 DB tests, 12 backend tests all match).
* **Migration-017 items #1, #2, #3, #4 — ALREADY FIXED** in 017 and re-proven (capability
  correctability, one-edit-one-revision, real per-Shot operation in batches, a preserved creator
  decision on re-selection).
* **Generated-types check failing — ALREADY FIXED.** `--check` is green at 80 tables / 67 enums.
* **Hosted state claims — WRONG in several places.** The ledger reads 001–010 while the effect state
  is 001–014 present and 015–025 absent: 011–014 were applied by hand without ledger rows. Recorded
  as a documentation/certification gap and corrected; see HOSTED STATUS.

## MIGRATIONS ADDED

* `202610050025_prompt7_integrity_readiness.sql` — the only new migration in this pass. Additive:
  no table, column, enum, row, approval, lock, Result, Take or history is altered; RLS and tenant
  boundaries are untouched. Forward/rollback consideration: the FK constraints can be dropped and
  the previous `ai_creation_surface` body restored from migration 017 if a rollback is ever needed;
  nothing depends on 025's presence for earlier behaviour except the repaired integrity guarantee.

## MIGRATIONS NOT APPLIED

* Nothing was applied in this pass — no hosted SQL, no ledger repair, no reset.
* Hosted **effect** state: 001–014 present. Hosted **ledger**: 001–010 recorded.
* Genuinely unapplied forward range: **015, 016, 017, 018, 019, 020, 021, 022, 023, 024, 025**.
* 011–014 are already in effect and must be **reconciled by history-only ledger repair, never
  replayed**. 001–010 must never be replayed either.

## TEST RESULTS

| Suite | Result |
| --- | --- |
| `backend` pytest | **397 passed**, exit 0 |
| `backend` ruff | `All checks passed!` |
| `backend` mypy | no issues in **74 source files** |
| `frontend` vitest | **220 passed (16 files)** |
| `frontend` typecheck | clean |
| `frontend` production build | succeeds |
| Playwright (Chromium) | **20 passed** (includes `prompt9-integration.spec.ts`) |
| Root `npm test` | **225 passed**, 0 failed |
| `prompt1-9-corrections.test.mjs` (new) | 4 passed |
| `15_verify.sql` / `16_verify.sql` | 102/102 OK · 12/12 OK |
| `generate-database-types --check` | 80 tables / 67 enums verified |
| `verify-boundaries.mjs` | clean |
| `git diff --check` | clean |

## DATABASE

25 local migrations (001–025). Prompt 9 spans 019–024; this pass adds 025. Generated types are
unchanged by 025 (no new table, column or enum), and `--check` confirms it. The hosted forward
package in `supabase/manual-apply/` runs `06_`–`16_` for the genuinely unapplied range; `05_verify.sql`
confirms the already-in-effect 011–014.

## SECURITY / RLS

The correction migration adds only foreign keys and two partial indexes on an existing table, plus a
`create or replace` of one guarded RPC. No policy, grant, role or schema-exposure change was made.
The repaired `ai_creation_surface` is re-revoked from `public, anon, authenticated, service_role` and
re-granted to `authenticated` only; `16_verify.sql` asserts that (`anon` and `service_role` cannot
execute it). `tonde_private` remains unexposed and unqueryable by clients; a cross-workspace profile
reference is now impossible at the database level rather than only in the RPC.

## GENERATED TYPES

`scripts/generate-database-types.mjs --check` → **80 tables, 67 SQL enums and shared product
vocabulary** verified. No generated artifact was hand-edited, and nothing is stale.

## BACKEND

397 tests pass; ruff clean; mypy clean across 74 source files. The correction migration is
database-only — the backend HTTP surface is unchanged, so no backend change was required or made.

## FRONTEND

220 vitest tests pass across 16 files; `tsc --noEmit` clean; production build succeeds. No frontend
change was required: the repaired `ai_creation_surface` keeps its exact document shape, which the
existing AI Creation surface and its tests already assert.

## PLAYWRIGHT

**20 passed** in Chromium, including the Prompt 9 integration spec (`§224` impact → `§227`
Results/Shot Match/FIX THIS SHOT → `§96` readiness across surfaces, with a reload-persistence check)
and every earlier Prompt 1–8 spec.

## CROSS-PROMPT INTEGRATION

| Boundary | Check | Result |
| --- | --- | --- |
| P1 → P2 | Foundation schema + generated vocabulary still match the Constitution | PASS (`constitution.test.mjs`, `tests/product/constitution.test.mjs`) |
| P2 → P3 | Canonical language used by the application UI | PASS (`foundation.spec.ts` routes/labels) |
| P3 → P4 | Director intake and Studio navigation still work | PASS (`prompt4-intelligence.test.mjs`, `intelligence.spec.ts`) |
| P4 → P5 | Brief/Story/Script/Reference/Reality state enters Studio | PASS (`prompt5-studio.test.mjs`, `studio.spec.ts`) |
| P5 → P6 | Real Production uses the canonical Scene/Shot structure | PASS (`prompt6-real-production.test.mjs`) |
| P5 → P7 | AI Creation uses the same canonical Scene/Shot structure | PASS (`prompt7-ai-creation.test.mjs`) |
| P6 ↔ P7 | Hybrid does not fork the Master Production | PASS (one Production; per-Shot `execution_method = 'hybrid'`) |
| P5–P7 → P8 | Long-form and Series preserve the same production semantics | PASS (`prompt8-long-form.test.mjs`, `movie-mode.spec.ts`, `series.spec.ts`) |
| P4–P8 → P9 | Memory/versioning/continuity/approvals/Results operate on the same objects | PASS (`prompt9g-integration.test.mjs` + `prompt9-integration.spec.ts`) |

No cross-prompt suite creates a second incompatible interpretation of Production; the 9G integration
test asserts one Master Production across the whole loop.

## HOSTED STATUS

Read-only inspection only (no hosted SQL executed, no migration applied, no ledger repair performed
in this pass):

* **Ledger:** `supabase migration list --linked` reports remote history **001–010**.
* **Effect state:** hosted PostgREST schema-cache and column probes put the hosted `tonde` schema at
  **001–014 present and 015–025 absent**. `director_intakes`, `director_plan_proposals`,
  `save_reference_analysis`, `claim_reference_analysis`, `apply_director_operation`,
  `scenes.story_beat`, `scenes.scene_detail`, `scenes.opening_state` and `dialogue_lines.delivery`
  are live; `create_studio_scene`, `log_shot_take`, `declare_ai_model` and every 015–024 table are
  absent.
* **Divergence:** 011–014 were applied by hand without ledger rows — the same pattern as 009–010,
  which were later reconciled with a history-only repair.
* **Not proven:** semantic equality of 001–010 (`supabase db diff --linked` is blocked by missing
  Docker/Podman), and hosted acceptance of 015–025.

## EXTERNAL BLOCKERS

1. **Hosted rollout of 015–025 — manual Supabase action, BLOCKED.** Apply packages `06_`–`16_` in
   order with their verify scripts, and reconcile 011–014 by history-only repair (never replay).
2. **Live AI/multimodal provider analysis — BLOCKED — REAL EXTERNAL DEPENDENCY.** No model has ever
   produced a Shot Match finding; the deterministic path is fully implemented and tested against real
   embedded PostgreSQL with creator-authored findings.
3. **Google OAuth and email/SMTP delivery — BLOCKED.** Implemented in code, unverifiable without
   provider credentials.
4. **Complete hosted acceptance matrix — BLOCKED.** All six Storage buckets, all resources, the
   approval matrix and post-rollout advisor runs are incomplete; scoped runners cover a subset only.
5. **Hosted semantic schema diff — BLOCKED** by missing Docker/Podman.

None of these is an internal code defect, and none of them blocks Prompt 10 on internal grounds.

## INTERNAL FAILURES

# NONE.

Every internal failure found in this pass was reproduced, diagnosed to its root cause, fixed and
re-tested. Two — model-profile referential integrity and per-Shot readiness recomputation — were real
defects and are repaired additively in migration 025 with new regression tests. The remaining audit
items were proven already fixed or false. (During the pass the documentation-link test failed solely
because `AGENTS.md` referenced the final audit before it had been written; the file was created and
the check is green in the frozen run.)

## DEFERRED PROMPT 10 ITEMS

Exporter implementation (PDF/DOCX/ZIP), the complete media import framework, final Asset-library
expansion, deliverable generation, integration marketplace, external publishing. Not started.

## DEFERRED PROMPT 11 ITEMS

Outbox/transactional enqueue, dispatcher selection, atomic worker claiming, full lease lifecycle,
retry orchestration, crash recovery, idempotent completion, cancellation propagation, operational
telemetry, worker deployment, scanning infrastructure, large-video processing, CI/CD hardening. Not
started. The `tonde.jobs` persistence foundation these build on already exists — do not build a second
jobs system.

**Also recorded for a deliberate later pass (constitutional amendments, not defects):** Production
Kit terminology in place of generic Setup; a first-class canonical Audio Plan for timed audiovisual
work; and per-Reference identity + creator purpose. All three are pending amendments with real
vocabulary/schema/UI/test consequences, recorded in the audit so they are not hidden and not silently
"solved" by a partial rename.

## READY FOR PROMPT 10

**YES.** Prompts 1–9 are internally coherent, regression-clean, migration-safe and frozen, with the
only remaining gaps external (hosted rollout and credential-gated providers).

# **PROMPTS 1–9 CORRECTION PASS — CLEARED FOR PROMPT 10**
