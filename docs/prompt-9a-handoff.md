# Prompt 9A handoff — TONDE Dependency Graph, Impact Engine & Stale Artifacts

Status: **PASS 9A** (internal scope complete). This is **not** `MASTER PROMPT 9 — PASS`:
passes 9B–9G are not started. Hosted migration 019 is not yet applied to the linked Supabase
project, and live AI/provider generation remains externally blocked by missing credentials.

## PASS RESULTS

| Pass | Result | Scope |
|---|---|---|
| 9A — Dependency graph, impact engine & stale artifacts | PASS | One directed canonical graph, derived edges from real Production state, bounded/cycle-safe traversal, preview→apply separation, the three propagation choices, lock/approval protection, revision staleness, stale markers, RLS, backend HTTP surface, Studio surface, manual-apply package |

## WHAT 9A IS

Migration 019 is **additive**. The canonical `tonde.object_dependencies` table is *extended*,
never replaced, and no second graph system exists.

- **One direction only.** An edge means exactly one thing: the SOURCE is relied upon, the
  TARGET depends on it. `dependency_graph` traverses `forward` ("what this affects") or
  `reverse` ("what this depends on") from that same row.
- **Six new enums:** `dependency_strength` (hard/soft/advisory), `dependency_origin`
  (explicit/derived/inferred), `impact_class` (direct/downstream/potential/unaffected/unknown),
  `impact_mode` (preview/update_all/review_changes/change_only_this), `artifact_kind`
  (13 values), `stale_state` (current/stale/conflicted).
- **`object_dependencies` gained 13 columns** (`reason`, `strength`, `origin`,
  `affected_fields`, `source_version`, `target_version`, `active`, `note`, `evidence`,
  `created_by`, `created_at`, `updated_at`, `revision`) and its relation CHECK was widened to
  `creative, continuity, execution, reference, derived_from, runtime, asset, result, state`.
  Two partial indexes (`object_dependencies_source`, `object_dependencies_target`).
- **Two new tables:** `tonde.stale_artifacts` (markers, with an expression unique index so the
  same artifact cannot be marked twice) and `tonde.impact_analyses` (recorded previews pinning
  the root revision and a structure revision).

## DERIVED EDGES COME FROM REAL STATE, NOT FROM A MODEL

`tonde.dependency_sync` derives edges the Production already knows and records nothing else:
scope bindings that name an Asset become `asset` edges (a binding with `inheritance = exclude`
deactivates its edge instead of deleting it), scope bindings that name a Reference become
`reference` edges, an `execution_plans` row becomes an `execution` edge from its Shot, and a
`dialogue_lines` row becomes a `runtime` edge into its Scene. **No AI inference is involved.**
An `inferred` edge can only be written by a caller that supplies its own rationale, and the
graph always reports it as `potential` — one hop away or not — because a proposal is not
certainty.

## IMPACT IS COMPUTED, NEVER APPLIED BY COMPUTING IT

- `tonde.impact_preview` computes and **records** an analysis and changes no Production object.
  It pins the root object revision and a structure revision, names the locked and approved
direct dependents, and returns the rule verbatim: *impact is computed, never applied*.
- `tonde.apply_impact` is a separate RPC and refuses to run against a moved source: if any
  pinned revision no longer matches, it raises `40001` (*"changed since this impact was
  computed — preview the impact again"*) instead of applying against newer content. The same
  guard rejects applying one analysis twice, so a preview is **single-use**.
- `update_all` marks every affected dependent, **skips locked objects and reports them**, and
  flags approved dependents as `conflicted` for creator review **without rewriting them**.
- `review_changes` marks only the ids the creator selected.
- `change_only_this` keeps the change local: direct dependents stop claiming to be current and
  the remaining downstream impact is recorded as `unresolved_count`.

## DATABASE

- Public RPCs granted to `authenticated` (11): `dependency_sync`, `dependency_edge`,
  `dependency_active`, `dependency_graph`, `dependency_edges`, `impact_preview`,
  `impact_history`, `apply_impact`, `stale_artifact_list`, `resolve_stale_artifact`,
  `mark_stale_artifact`.
- Private helpers in `tonde_private`, all revoked from `public, anon, authenticated,
  service_role` (9): `pi_read_guard`, `pi_label`, `pi_object_revision`, `pi_is_locked`,
  `pi_is_approved`, `pi_walk` (cycle-safe depth-bounded recursive CTE with a `seen` path
  array), `pi_explain`, `pi_mark_stale`, `pi_stale_on_source_change`.
- **Traversal is bounded and cycle-safe by construction.** The database test proves a valid
  creative cycle (Shot 13 ↔ Shot 14) terminates, that the root is never reported as its own
  dependent, and that a truncated page says so (`truncated: true`).
- Stale markers follow real source changes: `zz_stale_on_shot_change`,
  `zz_stale_on_scene_change`, `zz_stale_on_document_change`, `zz_stale_on_plan_change`.
- `guard_mutation` is mounted on all three tables; the added identity columns are still
  immutable and `revision` still auto-bumps.

## RLS AND SECURITY

- RLS is enabled explicitly on `stale_artifacts`, `impact_analyses` and `object_dependencies`,
  with the established tenant policies (`tenant_read` = workspace member, `tenant_insert` /
  `tenant_update` = editor).
- Reads (`dependency_graph`, `dependency_edges`, `impact_history`, `stale_artifact_list`) run
  `security definer` behind `pi_read_guard` (workspace member); every write runs behind
  `studio_guard`, which requires an authenticated workspace **editor**.
- A cross-workspace call returns `42501` and the API translates it to 403. The database test
  proves Workspace B cannot read Workspace A's graph, impact or markers, and that RLS hides
  Workspace A's `object_dependencies` rows entirely.
- Knowing an object id is not authorization: every read re-checks membership in the database.

## BACKEND HTTP SURFACE

- [domain/dependencies.py](backend/app/domain/dependencies.py) — bounded request contracts for
  edges, edge activation, preview, apply, stale marking and resolution, with the canonical
  relation/strength/origin/mode/kind vocabularies. A malformed request is rejected by the
  application (422 `INVALID_INTELLIGENCE_INPUT`) rather than by the database.
- [services/dependencies.py](backend/app/services/dependencies.py) — `LAYER =
  'Production intelligence'` and `DependencyRepository`, which calls every guarded RPC through
  `rpc_detailed(..., layer=LAYER)`. It also carries the display vocabulary and deterministic
  summary lines; it recomputes no graph value.
- [routers/production_intelligence.py](backend/app/routers/production_intelligence.py) — under
  `/api/v1/workspaces/{workspace_id}/productions/{production_id}/intelligence`:
  `GET /modes`, `POST /dependencies/sync`, `POST /dependencies`, `PATCH /dependencies/active`,
  `GET /dependencies`, `GET /graph`, `POST /impact/preview`, `GET /impact/history`,
  `POST /impact/apply`, `GET /stale`, `POST /stale`, `POST /stale/{artifact_id}/resolve`.
  Registered in [main.py](backend/app/main.py).
- **Preview and apply are different requests.** `POST /impact/apply` returns 409
  `IMPACT_CONFIRMATION_REQUIRED` when `confirm` is not set — and does not reach the database at
  all — and 422 `IMPACT_REVIEW_SELECTION_REQUIRED` when `REVIEW CHANGES` carries no selection.
  `review_changes` is the only mode that requires a selection; `change_only_this` deliberately
  ignores it because its whole meaning is that the change stays local.
- Error translation is the shared one: `42501` → 403, `40001`/`23514`/`23505` → 409,
  `22023`/`22001` → 422, `PGRST202`/`42883` → 503 `STUDIO_SCHEMA_MISSING` naming this layer.

## STUDIO SURFACE

- [services/productionIntelligence.ts](frontend/src/services/productionIntelligence.ts) — the
  typed client, including `apply({ analysisId, mode, selectedIds, expectedRootRevision })`,
  which always sends `confirm: true` so an apply is never implicit.
- [studio/ProductionIntelligence.tsx](frontend/src/studio/ProductionIntelligence.tsx) — the
  `Impact` tool in Studio: a source picker (the selected Shot, the selected Scene, the
  Production, or a reusable Asset), a forward/reverse direction toggle, 1–4 level depth, sync,
  preview, the recorded graph and stored relationships, the three propagation choices with
  their real meaning, a REVIEW CHANGES dependent picker, the applied result (including
  *REPORTED, NOT CHANGED* and *NEEDS YOUR REVIEW*), the stale-artifact queue with cause and
  explicit resolution, a manual stale marker, and impact history.
- **A potential dependency is never applicable.** The REVIEW CHANGES picker offers only direct
  and downstream dependents and says so, so a proposal can never be turned into a change.

## MANUAL HOSTED APPLY

- `supabase/manual-apply/10_202610050019_dependencies_impact.sql` is the executable tail of the
  migration, byte-for-byte (asserted by a scratch check during this pass).
- `supabase/manual-apply/10_verify.sql` reports **116 checks** — tables, enums, columns, the
  widened relation CHECK, RLS, policies, triggers, indexes, all 11 RPCs, all 9 private helpers,
  that those helpers are unreachable, and that each public RPC is granted to `authenticated`.
  Every row reads `OK` against a full 001→019 database. Steps 14–15 and the description are in
  `supabase/manual-apply/README.md`.

## TEST COUNTS

| Suite | Result |
|---|---|
| `npm test` (root, embedded-PostgreSQL database tests incl. 13 Prompt 9A tests) | **136 passed / 0 failed** |
| Backend `pytest` (incl. 30 Prompt 9A API tests) | **302 passed** |
| Frontend `vitest` (incl. 14 Prompt 9A tests) | **151 passed** (11 files) |
| Playwright E2E (incl. the §169–§173 prompt 9A spec, with a 390 px pass) | **14 passed** |
| `ruff check app tests` | clean |
| `mypy app` | clean (59 source files) |
| `npm run typecheck` / `npm run build` | clean / built |
| `node scripts/generate-database-types.mjs --check` | Verified 69 tables, 47 SQL enums, vocabulary current |
| `npm run verify:legacy` | clean |
| `git diff --check` | clean |

## SHARED VOCABULARY

The six new enums are mapped in `product/vocabulary.json`
(`dependencyStrengths`, `dependencyOrigins`, `impactClasses`, `impactModes`, `artifactKinds`,
`staleStates`) and wired into [scripts/generate-database-types.mjs](scripts/generate-database-types.mjs),
which now emits generated TS type aliases (`DependencyStrength`, `DependencyOrigin`,
`ImpactClass`, `ImpactMode`, `ArtifactKind`, `StaleState`) and Python `StrEnum` classes. The
stored codes remain the SQL enum labels, so display labels and storage codes cannot drift.

## ACCESSIBILITY / RESPONSIVE

The Impact surface uses labelled regions and controls (`aria-label` on the source object,
filter, artifact kind and reason inputs), `aria-pressed` direction buttons, a real `<fieldset>`
with `<legend>` plus radio inputs for the three propagation choices, a captioned table for
stored relationships, `role="status"` for computed notes and `role="alert"` for failures, and
real `<button>` elements for every action. Below 760 px the controls stack to a single column,
the relationship table scrolls inside its own box, and the apply row becomes full width — the
browser test asserts `documentElement.scrollWidth <= innerWidth` at a 390 px viewport.

## REPAIRS MADE IN THIS PASS (all fixed, none skipped)

1. `tests/database/prompt9a-dependencies.test.mjs` used an **assignment** inside a `.filter()`
   (`item.state = 'stale'`) twice, so the predicate was always truthy and the lock-protection
   assertion could not have failed honestly. Corrected to `===`; the test then proved the real
   behaviour. 13/13 pass.
2. `node scripts/generate-database-types.mjs --check` was failing: the generated artifacts were
   stale against migrations 015–019 (and prompts 5–9 had added enums without regenerating).
   Regenerated; `--check` now verifies 69 tables and 47 SQL enums.
3. The Studio Impact controls row was a fixed 5-column grid that **overflowed into the Director
   panel**, so the rightmost buttons were covered and unclickable at a normal viewport. Replaced
   with a wrapping flex row (single column below 760 px). Found by the browser test, not by
   reasoning.
4. Two of my own new test expectations were wrong and were corrected against the real
   contract, not the other way round: a body `depth` outside 1–8 is **rejected** (422) rather
   than clamped the way a query parameter is, and the mocked graph must echo the requested
   direction.

## INTERNAL FAILURES

**NONE** outstanding.

## EXTERNAL BLOCKERS

- **Hosted migration 019 not applied** — BLOCKED. No Docker/Podman and no hosted credentials in
  this environment, so the semantic schema diff and the hosted apply are a manual Supabase
  action. The package is ready: `10_202610050019_dependencies_impact.sql` then `10_verify.sql`
  (steps 14–15). **Do not replay 009–018.**
- **Hosted migration 018 also still unapplied** (carried over from Prompt 8, steps 12–13).
- **Live AI/provider generation** — BLOCKED — REAL EXTERNAL DEPENDENCY.

## WHAT 9A DOES NOT CLAIM

- `tonde.impact_class` includes `unaffected` and `unknown`, which are **reserved**: no current
  code path produces them, and nothing reports them as if it had.
- `change_only_this` records unresolved downstream impact; it does not resolve it. A later
  preview is required to act on it.
- No AI inference creates an edge. Writing an `inferred` edge without a rationale is possible
  through `dependency_edge`, but its origin is stored and it is always surfaced as a proposal.

## READY FOR 9B

**YES.** 9B (continuity) can build on the graph, the dependency vocabulary, the propagation
modes and the stale-marker lifecycle without a competing mechanism. Prompt 9 is **not** at
`MASTER PROMPT 9 — PASS` until 9B–9G are complete; Prompt 10 must not start before then.
