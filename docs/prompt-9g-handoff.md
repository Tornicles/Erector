# Prompt 9G handoff — Full Integration & Certification

> **Superseded hosted state (dated correction, 2026-10-08).** Every hosted migration
> statement below is the record of the day it was written. As of 2026-10-08 the linked
> project's ledger records **001–030** with matching `tonde` effects, the untruncated
> catalog comparison reports **0 differences over 4087 identities**
> (`test-results/pre-prompt10/hosted-final-diff.json`), and the expanded two-user runner
> reports **538 pass / 1 blocked / 0 fail**. The only remaining blockers are external
> (mail capacity, Google sign-in, plan-gated leaked-password protection). See the
> [Pre-Prompt-10 certification](pre-prompt10-final-certification.md).

# **MASTER PROMPT 9 — PASS**

9G is the only pass permitted to declare this. 9A → 9F were each PASS on their own; this pass
audits them as one system, runs the full technical gate, and certifies Prompt 9 complete.

## MASTER PROMPT 9 STATUS

**PASS.**

## PASS RESULTS

| Pass | Scope | Status |
| --- | --- | --- |
| 9A | Dependency Graph & Impact | PASS |
| 9B | Continuity Engine | PASS |
| 9C | Production Memory & Structured Search | PASS |
| 9D | Versioning, Branches, Restore, Merge & Change Impact | PASS |
| 9E | Approval, Locks & Readiness | PASS |
| 9F | Results, Shot Match & FIX THIS SHOT | PASS |
| 9G | Full Integration & Certification | PASS |

## WHAT 9G PROVES

Each 9A–9F pass proves its own semantics in isolation. 9G proves the **seams** — the places a system
composed of several engines actually breaks — in two places:

* `tests/database/prompt9g-integration.test.mjs` — 10 tests on real embedded PostgreSQL (PGlite)
  against one 001→024 stack, exercising the seams between engines as a workspace editor, a second
  workspace and an outside viewer.
* `frontend/e2e/prompt9-integration.spec.ts` — 1 browser test that walks the whole loop across the
  real Studio tools with the API stubbed at the network boundary, proving the browser decides
  nothing and that state persists across a reload.

The seams exercised:

* dependency graph → impact → locks/approvals → stale artifacts (9A + 9E + 9D);
* Shot Match finding → the same continuity finding the continuity engine resolves (9F + 9B);
* Shot Match correction → versioning → memory candidate → structured search (9F + 9D + 9C);
* versioning → branch → merge → mainline, with old versions immutable (9D);
* Results → Shot Match → FIX THIS SHOT → new Take → second analysis → creator approval (9F);
* readiness unblocked by a creator's decision on an analysis (9E + 9F);
* a Prompt 8 long-form Episode Shot carrying a Result and an analysis (9F + Prompt 8).

The browser walk follows §224 (a Character wardrobe change is previewed, REVIEW CHANGES applies only
what was selected, a locked Shot stays untouched and is reported, the affected prompt is marked
stale, and a reload keeps it all), §227 (a Result is analyzed, FIX THIS SHOT previews and applies one
scoped correction, a new Take produces a second Result and a second analysis, and the Result only
becomes approved through the creator's own decision) and §96 (readiness is the same Production's
category with real blockers and never a score).

## DEPENDENCY GRAPH

Implemented (migration 019, 9A). `tonde.dependency_graph` returns typed nodes and edges over the real
objects of one Production — Scenes, Shots, execution plans, Results, Takes, Attempts, continuity
findings/state, memory items and assets — with one declared meaning: an edge means the source is
relied upon and the target depends on it. The graph is computed from stored state, never inferred
from prose, and it is workspace-scoped and read-guarded (`pi_read_guard`).

## IMPACT ENGINE

Implemented (migration 019, 9A). `tonde.impact_preview` computes affected dependents, stale
artifacts, locked objects and approval consequences without changing anything; `apply_impact` marks
only what the creator selected. Modes are `update_all`, `review_changes` and `change_only_this`.
Impact is **computed, never applied by computing it**; a locked object is reported instead of
rewritten; an approved dependent is flagged for review rather than silently rewritten. Consumed by
9F's FIX THIS SHOT (`match_correction_preview` reuses `impact_preview`) and by the Studio's
Production Intelligence surface (`Affected objects`, `Dependency graph`, `Dependents to change`,
`Stale artifacts`).

## CONTINUITY ENGINE

Implemented (migration 020, 9B). Declared continuity state propagates across the Production; a
declared change is checked against inherited state and a conflict is raised as a finding, not
silently accepted. Integration with 9F is proven: the finding a Shot Match analysis raises is the
same row the continuity engine lists (`origin = 'derived'` for observed), and
`continuity_finding_update` can resolve it.

## CONTINUITY ISSUE MODEL

Implemented (migration 020, 9B). Issues carry category, the expected and observed state, severity,
epistemic state and evidence; a creator may mark an issue intentional or resolve it, and resolving
one updates downstream state truthfully. Nothing is fabricated: an issue that cannot be derived from
stored state is `unknown`, not asserted.

## PRODUCTION MEMORY

Implemented (migration 021, 9C). Reusable learnings are opt-in and gated. `memory_candidate_list`
surfaces candidate items; `memory_candidate_decide(id, 'accept'|'reject')` applies a decision and
returns `state = 'applied'`. Nothing becomes memory automatically, and 9F adds the stronger rule that
a correction becomes a memory candidate only when a later Shot Match report for the same Shot exists
— and the refusal happens before anything is applied.

## STRUCTURED SEARCH

Implemented (migration 021, 9C). `production_search(workspace, production, jsonb)` returns `results`
with `entity_type` ∈ `shot | scene | execution_plan | result | continuity_finding | continuity_state
| memory_item | asset`. A memory query uses `{ text, kinds: [...] }` and memory hits carry an
`in_force` boolean. An unresolved `asset_name` returns `total = 0` and says so rather than guessing.
The 9G integration test proves a memory item created from a correction is findable through search.

## OBJECT VERSIONING

**Status: implemented and immutable (migration 022, 9D).** Every content edit through
`vb_patch_apply` records a version with an honest `source_action` label
(`edit`, `branch`, `merge`, `restore`, `correction`, …). `version_list` returns
`items[].version_id / source_action / snapshot` plus `current_revision`; `version_compare(workspace,
production, left_version_id, right_version_id)` compares two version ids and returns per-field
`field / label / before / after` changes. `object_versions` refuses client update and delete
(`42501` / `23514`): history cannot be rewritten.

## BRANCHES

**Status: implemented (migration 022, 9D).** A branch is a named alternative line from a revision.
`branch_change_set` records a scoped change against a branch and **requires a `target_object_id`** in
its payload. A branch stays an alternative and does not touch the mainline until it is merged.

## RESTORE

**Status: implemented (migration 022, 9D).** Restoring an earlier version produces a **new** revision
(previous versions remain immutable); it never rewinds history or deletes the versions in between.

## MERGE

**Status: implemented (migration 022, 9D).** `merge_preview` returns `{ state: 'proposed',
proposal_id }` without changing anything; `merge_decide(proposal_id, 'merge'|'reject', selected,
propagation, note)` applies a merge as an explicit creator decision and returns `state = 'merged'`
(the decision value for a merge is `'merge'`, not `'apply'`). A merge creates a new mainline revision.

## MERGE CONFLICTS

**Status: implemented and reviewed (migration 022, 9D).** A conflict is surfaced by the preview and
must be decided by the creator per selected change; a merge never overwrites the mainline blindly,
and a locked object is reported instead of rewritten.

## APPROVALS

**Status: implemented (migration 023, 9E).** An approval names the exact revision it was granted
against; a material change to an approved object flips it to `changed_after_approval` via
`guard_mutation` rather than leaving a stale "approved" behind, and the prompt 9E readiness criteria
surface that. `ax_set_approval` re-asserts an approval on the exact revision just decided; a
creator's acceptance is also recorded in the append-only Prompt 9E decision ledger. `guard_human_
acceptance` (prompt 4) still refuses a single statement that both changes content and approves it —
so every RPC that records content and then approves does so in two statements.

## LOCKS

**Status: implemented (migration 023, 9E).** Locking is separate from approval. A locked object is
refused for edit (FIX THIS SHOT included: "Unlock it deliberately before applying a correction"),
refused for a blind write, and reported — never silently skipped — during impact application and
merge.

## READINESS

Criteria and output: implemented (migration 023, 9E, extended by 9F). Readiness is a **category with
real named blockers**, never a score. Dimensions are enumerated (`readiness_dimension`) with a
`readiness_state`; blockers are derived from stored state. 9F adds the `shot_match_pickup` blocker,
which appears only while a completed Shot Match report has severity in `(warning, critical)` and
`approval in (draft, needs_review)`; a creator's decision on the report sets its own
`approval = 'approved'`, which is what unblocks readiness. The 9G integration test proves a decision
on an analysis clears the blocker.

## RESULTS

Status: implemented (migration 024, 9F). A Result links its Production, Scene, Shot, execution plan,
Real Take or AI Attempt and media, keeping provenance (Take and its number/status, Attempt, provider,
model, media upload/processing state). `result_register` refuses a Result with no real source, refuses
a Take or Attempt from another Shot, and always inserts `state = 'needs_review'`. `result_state_set`
enforces a transition table and refuses Final unless a creator approved the Result.

## SHOT MATCH

Dimensions/capability: implemented (migration 024, 9F). Modalities are derived in the database from
real `media_files` rows (`ms_capabilities`); a caller claiming a modality the database cannot
substantiate is refused (`23514`). Findings carry category, expected, observed, difference, epistemic
state, confidence, evidence, severity and a suggested correction; an observed difference must cite
evidence, a measured focal length is refused, and any key naming a person, face or identity is
refused. `ms_summary` produces the four-part prioritised summary ordered by production impact — **no
percentage, no similarity number, no aggregate score** is computed or rendered anywhere. The
recommendation follows the execution method: Real → `pickup_required`, AI → `regeneration_recommended`,
Hybrid → `both`, clean → `none`.

## FIX THIS SHOT

Real / AI / Hybrid correction behavior: implemented (migration 024, 9F). A correction is scoped to
one real object with a validated field patch, a root cause, a reason, an affected scope and an impact
previewed by 9A's `impact_preview` — never applied by proposing it. Applying is a separate explicit
decision:

* **Real**: the correction writes a new revision through `vb_patch_apply(..., 'correction')` and the
  recommendation is a pickup; `pickup` writes `pickup_needed` into the Prompt 6 On-Set capture state,
  and a new Take produces a new Result to analyze again.
* **AI**: the recommendation is regeneration, and **nothing is launched** — the response says so in
  words and the 9F test proves no `ai_generation_attempts` row is created.
* **Hybrid**: the recommendation is `both`, following the execution method behind the Result.
* A locked target is refused (`23514`); a moved target is a `40001` conflict, not a blind write.
* The previous plan, the Result, the earlier Take/Attempt and every earlier analysis are preserved —
  the earlier revision's snapshot is proven untouched.
* Impact then propagates through the existing `apply_impact` with the creator's chosen mode.
* Reusable memory is opt-in and gated (see Production Memory). Rejecting a correction changes nothing.

## ITERATION HISTORY

**Status: implemented (migration 024, 9F).** `match_report_get` returns the Shot's whole chain of
analyses in order with each severity, recommendation and decision; `result_detail` returns the
Result's analyses and corrections. Take 1 → analysis → correction → Take 2 → analysis → approval
stays readable, and the Result's own revision history is available through `version_list`.

## STALE ARTIFACTS

**Status: implemented (migration 019, 9A; enforced across 9E/9F).** Applying impact marks the derived
artifacts a change invalidated as stale via `pi_mark_stale`; a stale artifact stays visible as stale
and is never reported as current. The 9G e2e proves the affected prompt is marked stale after a
scoped apply and that the stale state persists across a reload; the 9G db test proves a locked object
is not marked stale-and-rewritten but reported.

## LONG-FORM

Integration status: intact. Prompt 8's Acts / Sequences / long-form structure is preserved and
integrated — a long-form Episode Shot can carry a Result and a Shot Match analysis (proven in the 9G
db test), and the prompt 8 lazy-loading and rollup behavior still passes (`prompt8-long-form.test.mjs`,
`movie-mode.spec.ts`).

## SERIES

Integration status: intact. Series / Episode / Generate Ahead / Production Line behavior from Prompt 8
still passes (`prompt8-long-form.test.mjs`, `series.spec.ts`) and no Prompt 9 engine breaks the one
Master Production rule.

## DATABASE

Prompt 9 adds six additive migrations:

| Migration | Pass | Contents |
| --- | --- | --- |
| `202610050019_dependencies_impact.sql` | 9A | dependency graph, impact preview/apply, stale marking |
| `202610050020_continuity_engine.sql` | 9B | continuity state propagation and the issue/finding model |
| `202610050021_production_memory.sql` | 9C | memory items, candidates, structured search |
| `202610050022_versioning_branches.sql` | 9D | object versions, branches, restore, merge, conflicts |
| `202610050023_approval_lock_readiness.sql` | 9E | approval naming, locks, readiness criteria + decision ledger |
| `202610050024_results_shot_match.sql` | 9F | Results, Shot Match, FIX THIS SHOT (**963 lines**, additive) |

Migration 024 (the 9F package) in detail, since it is the newest: four enums (`match_verdict`,
`correction_state`, `correction_recommendation`, `match_origin`); new table `tonde.match_corrections`
(28 columns, 5 workspace-scoped `restrict` foreign keys, `unique (workspace_id, id)`, checks, 3
indexes, RLS enabled with a `tenant_read` policy only and a `guard_mutation` trigger); `ALTER`s on
`tonde.shot_match_reports` adding `capabilities`, `dimensions`, `summary`, `limitations`, `origin`,
`recommendation`, `decision`, `decision_note`, `decided_by`, `decided_at` plus a workspace-identity
unique key and one index; `tonde_private.vb_fields` replaced by an opt-in superset; 8 private helpers
(`ms_*`) and 11 public RPCs. All private helpers are revoked from `public, anon, authenticated,
service_role`. Generated-type check (`scripts/generate-database-types.mjs --check`) reports
**80 tables, 67 SQL enums** verified against the shared product vocabulary.

## HOSTED MIGRATIONS

**Exact state — corrected by read-only inspection, 2026-10-07.** This section originally reported
hosted history as 001–017; that was wrong, and the corrected picture needs two separate facts.
`supabase migration list --linked` reports the remote **ledger at 001–010**, while probes of the
hosted `tonde` PostgREST schema cache and of individual columns put the **effect state at 001–014
present and 015–025 absent**: `director_intakes` and `director_plan_proposals` are live, the 013/014
RPCs `save_reference_analysis`, `claim_reference_analysis` and `apply_director_operation` are in the
schema cache, and 012's `scenes.story_beat`, `scenes.scene_detail`, `scenes.opening_state` and
`dialogue_lines.delivery` exist — while `create_studio_scene`, `log_shot_take`, `declare_ai_model`
and every table introduced by 015–024 are absent. **Migrations 011–014 were therefore applied by
hand without ledger rows.** The genuinely unapplied forward range is **015–025** (015 = Prompt 5
Studio; 016 = Prompt 6 Real Production; 017 = Prompt 7 AI Creation; 018 = Prompt 8 long-form/Series;
019–024 = the six Prompt 9 migrations; 025 = the Prompts 1–9 correction pass). The local
repository's latest migration is **025**. The authoritative per-version matrix is in
`docs/system-gap-audit-prompt1-9-final.md`.

A safe forward reconciliation package exists in `supabase/manual-apply/`. The packages that must be
**pasted** are `06_` (015) through `16_` (025), steps 6–27 of `supabase/manual-apply/README.md`, each
the byte-identical executable tail (`begin;` … `commit;`) of its migration plus a `NN_verify.sql`
verification query. Packages `01_`–`04_` (011–014) are already in effect hosted and must **not** be
replayed: reconcile their ledger rows by history-only repair (as was done for 009–010), optionally
confirming them first with `05_verify.sql`.
The 9F package `15_202610050024_results_shot_match.sql` is 956 lines, pure ASCII, and verified against
a full 001→024 stack: `15_verify.sql` returns **102 rows, every one `OK`**. The correction package
`16_202610050025_prompt7_integrity_readiness.sql` is 140 lines, pure ASCII, and `16_verify.sql`
returns **12 rows, every one `OK`** against a 001→025 stack.

**Historical migrations 001–010 must never be replayed.** Only the unapplied forward packages are to
be pasted, by the creator, in order. Hosted verification of 011–025 remains a manual action and is
still outstanding — see EXTERNAL BLOCKERS.

## SECURITY / RLS

Exact verification:

* Every Prompt 9 table is workspace-isolated: policies use
  `tonde_private.is_workspace_member(workspace_id)`, and a second workspace reads zero rows (proven
  in SQL in the 9F and 9G db tests).
* Every write RPC runs `studio_guard` (workspace editor + revision); every read runs `pi_read_guard`
  (any member). A non-member and another workspace get `42501` / 403.
* Client write paths are absent: tables have no insert/update/delete policy, and a direct
  authenticated insert into `shot_match_reports` is denied (`42501`). Only guarded security-definer
  RPCs write.
* Private helpers are unreachable: calling one directly is a permission error, and no grant exists to
  `authenticated`, `anon`, `service_role` or `PUBLIC`.
* Identity columns are immutable (`guard_mutation`); revisions auto-bump and an explicit revision
  change is refused; locked rows are refused for edit.
* No provider credential, service-role key or hosted secret is read or stored anywhere in this layer.
* The reserved workspace boundary holds across all engines: the 9G integration test runs a second
  workspace and an outside viewer against every cross-engine seam and each is refused.

## PERFORMANCE

Large graph / Production behavior: existing scale guarantees still pass. `tests/database/
foundation.test.mjs` proves large Production queries remain bounded at 40 rows with exact duration
sums, and `tests/database/prompt8-long-form.test.mjs` §124 proves a large Production is read lazily
(Acts paginated, Shots never loaded eagerly). The dependency graph and structured search are bounded
and workspace-scoped; the 9G integration test builds a multi-Shot Production with a real dependency
chain and an applied correction and completes inside the suite's normal budget.

No dedicated performance-benchmark tool is configured in this repository, so no separate benchmark
figure is claimed. Performance is asserted through those bounded-read and lazy-loading database
tests, which all pass.

## ACCESSIBILITY

No automated axe/accessibility-tooling is configured in this repository, so no tooling pass is
claimed. Accessibility is asserted behaviorally through the Playwright specs, which pass:

* the global command search dialog traps focus and restores it on close;
* the asset detail and archive dialogs trap focus and restore their invoker;
* the Studio keeps Scene, Shot and Director usable at a narrow viewport and reorders with the
  keyboard;
* the mobile shell collapses navigation deliberately with no horizontal overflow;
* every Prompt 9 surface is driven through accessible roles/names (the 9G spec reaches
  `Affected objects`, `Dependency graph`, `Dependents to change` and `Stale artifacts` by their
  accessible names).

## RESPONSIVE BEHAVIOR

Covered by the foundation and studio specs (narrow viewport keeps Scene, Shot and Director usable;
mobile shell has no horizontal overflow). Passing.

## TEST COUNTS

Final sweep, after the 024 `::text` fix and with the 9G test files present:

| Suite | Result |
| --- | --- |
| `backend` pytest | **397 passed**, 0 failed |
| `backend` ruff | clean (`All checks passed!`) |
| `backend` mypy | clean (**74 source files**) |
| `frontend` vitest | **220 passed (16 files)** |
| `frontend` typecheck (`tsc --noEmit`) | clean |
| `frontend` production build | succeeds (1340 modules) |
| Playwright (Chromium) | **20 passed** |
| Root `npm test` (database + product) | **221 passed, 0 failed** |
| `tests/database/prompt9f-shot-match.test.mjs` | 15 passed |
| `tests/database/prompt9g-integration.test.mjs` | 10 passed |
| `generate-database-types --check` | **80 tables, 67 enums** verified |
| `verify-boundaries.mjs` | clean |
| `15_verify.sql` (001→024 stack) | **102 rows, all OK** |
| `git diff --check` | clean |

## PROMPT 1 REGRESSION

**PASS.** Auth, workspace isolation, schema foundation, RLS, Setup, Assets and Media foundation are
unchanged and green (`tests/database/foundation.test.mjs`, `tests/database/constitution.test.mjs`,
`frontend/e2e/foundation.spec.ts`, `frontend/src/test/foundation.test.tsx`).

## PROMPT 2 REGRESSION

**PASS.** The Constitution invariants hold: one Master Production; canonical approvals; locks separate
from approval; Result semantics; evidence labels; the Production Memory definition; human authority;
and the Shot Match loop. (`tests/database/constitution.test.mjs`, `tests/product/constitution.test.mjs`.)

## PROMPT 3 REGRESSION

**PASS.** Application shell, navigation and the seven canonical routes are unchanged
(`frontend/e2e/foundation.spec.ts`: all seven destinations render, back/forward retain routes).

## PROMPT 4 REGRESSION

**PASS.** Director Intelligence, Reference Analysis, Story, Script, Dialogue, Reality Check and
epistemic truth are intact (`tests/database/prompt4-intelligence.test.mjs`,
`frontend/src/test/intelligence.test.tsx`, `frontend/e2e/intelligence.spec.ts`).

## PROMPT 5 REGRESSION

**PASS.** Studio, Scene/Shot editing, timeline, approvals foundation, locks and scoped Director are
intact (`tests/database/prompt5-studio.test.mjs`, `frontend/src/test/studio.test.tsx`,
`frontend/e2e/studio.spec.ts`).

## PROMPT 6 REGRESSION

**PASS.** Real plans, Takes, pickup and Setup-aware execution are intact
(`tests/database/prompt6-real-production.test.mjs`, `backend/tests/test_real_production*.py`) — and 9F
now writes `pickup_needed` into the Prompt 6 capture state without redefining it.

## PROMPT 7 REGRESSION

**PASS.** AI prompts, Character/World/Product Locks, Attempts, Results linkage and Hybrid are intact
(`tests/database/prompt7-ai-creation.test.mjs`, `frontend/e2e/ai-creation.spec.ts`) — and 9F refuses to
launch an AI regeneration, keeping the Prompt 7 boundary.

## PROMPT 8 REGRESSION

**PASS.** Acts, Sequences, long-form, Series, Episodes, Generate Ahead and the Production Line are
intact (`tests/database/prompt8-long-form.test.mjs`, `frontend/e2e/movie-mode.spec.ts`,
`frontend/e2e/series.spec.ts`).

## REPAIRS MADE IN THIS PASS (all fixed, none skipped)

1. **Latent `match_analyze` runtime bug (22P02), found by the 9G integration test.** When a Result has
   no execution plan, `limitations := limitations || '<literal>'` was parsed as array concatenation of
   an untyped literal and failed with `malformed array literal`. Repaired in SQL with an explicit
   `::text` cast. Migration 024 and its manual-apply copy were both re-verified afterward (migration
   963 lines; manual-apply tail byte-identical; `15_verify.sql` 102/102 OK).
2. **9G database-integration test authoring defects** were reproduced and repaired while writing the
   seams (media fixture id/key, finding identity across engines, version-id vs revision arguments to
   `version_compare`, requiring `target_object_id` for `branch_change_set`, and reading the memory
   candidate's `state` after a decision). The final counts are from the re-run sweep.

No test was skipped, weakened, or suppressed, and no lint/type suppression was added to make a check
pass.

## INTERNAL FAILURES

# **NONE.**

Every internal failure found in this pass was reproduced, diagnosed to its root cause, fixed, and
re-tested; the counts above are from the final, fully re-run sweep.

## EXTERNAL BLOCKERS

* **Hosted migrations 015–025 remain unapplied — manual Supabase action, BLOCKED.** Read-only
  inspection proves the ledger state (001–010 recorded) and the effect state (001–014 in effect), and
  semantic schema diff is blocked by missing Docker/Podman, so the forward packages cannot be applied
  here. Steps 6–27 of the manual-apply README are the forward package; migrations 011–014 need a
  history-only ledger repair and must not be replayed; 001–010 must never be replayed. Hosted
  verification of 015–025 is outstanding.
* **Live AI/multimodal provider analysis — BLOCKED — REAL EXTERNAL DEPENDENCY.** No model produced a
  finding in Prompt 9. The reasoning path takes validated findings; the deterministic path
  (capability, order, eligibility, propagation, evidence discipline) is fully implemented and tested
  against real embedded PostgreSQL with creator-authored findings. Provider-backed analysis is
  un-exercised and no analysis is fabricated to stand in for it.

These two are the only blockers. Both are genuine external/manual dependencies, not internal defects.

## WHAT PROMPT 9 DOES NOT CLAIM

* No analysis was produced by a model; the multimodal path is proven only through creator-authored
  findings and contract tests.
* No similarity score, percentage or confidence aggregate exists anywhere.
* No lens, focal length, person or identity is measured or identified from imagery.
* No generation was launched, and none can be launched from the Shot Match surface.
* Hosted verification of migrations 018–024 has not happened.

## §245 ACCEPTANCE STANDARD

TONDE can now answer, from actual structured Production state: *If I change this, what else changes?
Does this still match continuity? What version did we approve? Show me the previous version. Try
another ending without destroying this one. What did we learn from earlier productions? What is
blocking readiness? Did this Shot actually match the plan? What went wrong? How do I fix only this
Shot?* — and the full loop **UNDERSTAND → DIRECT → EXECUTE → RESULT → CHECK → DIAGNOSE → FIX →
ITERATE → APPROVE** works while preserving history, dependencies, continuity, human authority, locks,
approvals, evidence, versions, uncertainty and one Master Production.

## READY FOR PROMPT 10

**YES.**
