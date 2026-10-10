# Prompt 7 handoff — TONDE AI Creation & Hybrid Director

Status: **MASTER PROMPT 7 — PASS** (internal scope complete; hosted migration 017 not yet
applied to the linked Supabase project, and live provider generation is externally
blocked by missing provider credentials).

## PASS RESULTS

| Pass | Result | Scope |
|---|---|---|
| 7A — AI Creation domain + migration 017 schema | PASS | providers, model profiles, connections, references, continuity locks, attempts, batches, cost confirmations |
| 7B — Capability truth and readiness | PASS | declared capability only; UNKNOWN/REQUIRES CONNECTION never presented as working |
| 7C — Prompt compiler + model routing | PASS | compiled artifact from canonical state, never master truth |
| 7D — References, locks, first/last frames, continuity | PASS | Character/World/Product/Style locks, frame + continuity requirements |
| 7E — Attempts, results, cost confirmation, idempotency | PASS | manual mode fully functional without credentials |
| 7F — Batch planning, Hybrid decision, Studio AI face | PASS | per-Shot SHOOT/GENERATE/SHOOT + AI on one Master Production |
| 7G — Certification and gates | PASS | see verification table |

## CAPABILITY MATRIX

TONDE stores **no vendor capability facts**. `tonde.ai_providers` is only a catalog of
known/possible tools (manual, runway, kling, veo, sora, midjourney, flux, elevenlabs, …)
with **no capability column**. Everything a routing decision uses comes from a workspace's
own declaration in `tonde.ai_model_profiles`:

| Declared state | Meaning | Routing effect |
|---|---|---|
| SUPPORTED | declared/observed capable for the operation | eligible, preferred |
| PARTIALLY SUPPORTED | capable with limits | eligible, limits stated, never preferred over a capable model |
| UNSUPPORTED | declared not capable | excluded, reason recorded |
| UNKNOWN | not declared | excluded from routing; shown as UNKNOWN, never guessed |
| REQUIRES CONNECTION | capable but no connection reference | blocking until a connection reference exists |

`capability_state = 'SUPPORTED'` requires `source in ('declared','provider')` — a database
check, not a UI convention. Per-model declarations include modalities, image-reference
support and `max_reference_images`, first/last frame, seed, negative prompt, camera control,
audio, image edit, lipsync, `max_duration_ms`, aspect ratios, resolutions, cost unit/amount/
currency/known, speed note, identity note, product-fidelity note, availability, safety note,
capability notes, lifecycle and revision.

## PROMPT COMPILER

`save_ai_plan` + `backend/app/services/ai_creation.py` compile a model-specific execution
artifact from canonical state: Master Style + Character/World/Product locks + wardrobe +
Scene context + previous Shot state + current Shot direction + model requirements. The
compiled prompt pins the source revisions it was built from. A final prompt is an
execution artifact, never the creative truth, and is never stored on the Production.

## LOCKS, FRAMES, CONTINUITY

- `set_ai_lock` records Character/World/Product/Style locks at Production/Act/Sequence/
  Scene/Shot scope with `MUST PRESERVE` / `SHOULD PRESERVE` / `FLEXIBLE` priority.
- Locked Character/Product locks force `identity_importance`/`product_importance =
  'critical'` in the plan, so the compiler cannot quietly drop them.
- `ai_shot_references` supports reference roles incl. first frame and last frame; a
  required frame the chosen model cannot use is reported, never silently dropped.
- `ai_continuity_locks` carry required start/end/next-shot state so intentional
  transitions survive regeneration.

## ATTEMPTS, JOBS, RESULTS, BATCH, MANUAL MODE

- `ai_generation_attempts`: operation, mode (`live`/`manual`), status, attempt number per
  Shot, idempotency key (`unique (workspace_id, idempotency_key)`), provider payload
  reference, creator decision (`keep`/`reject`/`needs_review`), `selected`,
  `result_state`.
- **Manual mode is complete and credential-free:** export the compiled prompt, record the
  Attempt, report the Result. Nothing about that path needs a provider.
- Results attach to the same canonical Shot; selection never overwrites the creator's
  decision (selecting defaults to `keep` only when the decision is still empty).
- `create_ai_batch` / `ai_batch_preview` / `record_ai_batch_item` plan work in confirmed
  batches with per-item state and partial success; the operation is derived from the Shot
  (`tonde_private.ai_primary_operation`) instead of a blanket `video`.
- Cost is `known` or `unknown` only — the schema forbids `unknown` with an amount and
  `known` without an amount + currency. **No plan or batch ever presents unknown cost
  as $0**, and no batch bills without an explicit confirmation row.
- Callback application requires a configured per-provider secret
  (`AI_CALLBACK_SECRETS`); without one the payload is validated and declined, not applied.

## HYBRID / ONE PRODUCTION EVIDENCE

One Master Production, one Scene set, one Shot set, one Shot UUID shared by Real and AI.
`switch_execution_method` writes `execution_method` on the canonical Shot through
`update_studio_shot`, so REAL → AI → HYBRID → REAL never creates a second Shot. Advice
without a revision changes nothing; the router returns `already` / `override_recorded` /
`identifier_unchanged` so the UI can state exactly what happened. Faces are Real
Production (`real`, SHOOT) and AI Creation (`ai`, GENERATE); Hybrid is per-Shot
(`hybrid`, SHOOT + AI) and is not a third mandatory tab.

## DATABASE

Additive migration [202610050017_ai_creation.sql](../supabase/migrations/202610050017_ai_creation.sql),
2 084 lines, applying cleanly over 001→017 in PGlite:

- 9 tables: `ai_providers`, `ai_model_profiles`, `ai_provider_connections`,
  `ai_shot_references`, `ai_continuity_locks`, `ai_generation_attempts`,
  `ai_generation_batches`, `ai_generation_batch_items`, `ai_cost_confirmations`.
- 16 public RPCs: `ai_creation_surface`, `ai_model_catalog`, `ai_shot_detail`,
  `declare_ai_model`, `set_ai_connection`, `ai_capability_verdict`, `save_ai_plan`,
  `set_ai_plan_approval`, `set_ai_plan_lock`, `confirm_ai_cost`, `set_ai_lock`,
  `create_ai_attempt`, `update_ai_attempt`, `select_ai_result`, `ai_batch_preview`,
  `create_ai_batch`, `record_ai_batch_item`.
- Private helpers in `tonde_private` (`ai_primary_operation`, readiness, scoring support).
- Generated types/vocabulary regenerated: **64 tables, 35 SQL enums**; `--check` passes.

## MIGRATIONS (exact hosted state)

Hosted project: 001–008 present. **009–017 have been applied — do not reapply 009–016.**
Migration **017 is not applied by automation.** Manual action, in order:

1. `supabase/manual-apply/08_202610050017_ai_creation.sql` (derived with
   `sed -n '/^begin;/,$p'` from the migration, ASCII-only).
2. `supabase/manual-apply/08_verify.sql`.

Semantic diff of hosted state is **BLOCKED** here (no Docker/Podman, no hosted
credentials). Steps 10–11 of [manual-apply/README.md](../supabase/manual-apply/README.md)
record this.

## SECURITY / RLS

Every AI table has RLS enabled explicitly, with workspace-scoped read/insert/update policies
and the shared `tenant_*` + `guard_mutation` contract. Credential handling stores a
**reference** only; values matching `sk-`, `secret`, `password` or `bearer ` are rejected by
a validator. All AI mutations require an authenticated member with edit permission plus a
matching revision; locked plans refuse edits; `select_ai_result`, `update_ai_attempt` and
`record_ai_batch_item` re-check Shot/Plan/Attempt ownership so a Workspace A user cannot
reach Workspace B attempts or results.

## TEST COUNTS

| Suite | Result |
|---|---|
| `npm test` (root, database + product) | 98 passed / 0 failed |
| `tests/database/prompt7-ai-creation.test.mjs` | 25 passed (incl. 3 peer-review repair proofs) |
| `backend/tests` | 211 passed (35 `test_ai_creation_api.py`, 39 `test_ai_creation_engine.py`) |
| `ruff check app tests` | clean |
| `mypy app` | clean (53 files) |
| `vitest run` | 121 passed / 8 files (18 AI Creation cases in `ai-creation.test.tsx`) |
| `npx playwright test` | 11 passed (stubbed stateful AI Creation flow in `e2e/ai-creation.spec.ts`) |
| `npm run build` | PASS |
| `generate-database-types.mjs --check` | PASS |
| `verify:legacy`, `git diff --check` | PASS |

## PROMPT 1–6 REGRESSIONS

| Regression | Result |
|---|---|
| Prompt 1 — foundation/auth/workspace/RLS/schema | PASS |
| Prompt 2 — constitution/vocabulary/one Production | PASS (12 constitution tests) |
| Prompt 3 — shell/routes/navigation | PASS |
| Prompt 4 — Director/Brief/Story/Script/Dialogue/Reference/Reality | PASS |
| Prompt 5 — Studio/Scene/Shot/timeline/selection/approval/locks | PASS |
| Prompt 6 — Real execution/Setup matching/On-Set/Takes | PASS |

## PEER REVIEW

[peer-review-017-ai-creation.md](peer-review-017-ai-creation.md) raised six notes. Notes
1–4 are repaired and proved by tests (capability re-declaration on update, single revision
bump, per-Shot operation derivation, selection not clobbering the creator decision). Notes
5–6 are recorded, non-blocking, and remain open for later scale work (a per-Shot readiness
call repeated three times in `ai_creation_surface`, and no FK on
`execution_plans.model_profile_id`).

## INTERNAL FAILURES

**NONE.** Defects found during implementation (capability verdict blocking, unknown
capability excluded from routing, `REQUIRES CONNECTION` reported as `connection_required`,
cost tie-break no longer won by unknown prices, Character identity facts reaching the
compiled prompt, audio intent read per modality, word-boundary prompt truncation, locked
locks forcing critical importance, creator direction overranking price, and the final
`ruff`/`mypy` findings in `ModelRouter.route`) were reproduced, root-caused, repaired and
re-verified.

## EXTERNAL BLOCKERS

- Hosted apply of migration 015/016/017 requires manual action (documented above).
- **No AI provider credentials:** live generation, provider-specific capability
  observation and real callback delivery cannot be exercised. Report as
  `BLOCKED — REAL EXTERNAL DEPENDENCY`. Deterministic planning, manual mode, batch
  confirmation and the entire Studio face work without them.

## READY FOR PROMPT 8

**YES.**
