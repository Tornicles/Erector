# Prompt 9D handoff — TONDE Versioning, Branches, Restore, Merge & Change Impact

> **Superseded hosted state (dated correction, 2026-10-08).** Every hosted migration
> statement below is the record of the day it was written. As of 2026-10-08 the linked
> project's ledger records **001–030** with matching `tonde` effects, the untruncated
> catalog comparison reports **0 differences over 4087 identities**
> (`test-results/pre-prompt10/hosted-final-diff.json`), and the expanded two-user runner
> reports **538 pass / 1 blocked / 0 fail**. The only remaining blockers are external
> (mail capacity, Google sign-in, plan-gated leaked-password protection). See the
> [Pre-Prompt-10 certification](pre-prompt10-final-certification.md).

Status: **PASS 9D** (internal scope complete). This is **not** `MASTER PROMPT 9 — PASS`: passes
9E, 9F and 9G are not started. Hosted migrations 018, 019, 020, 021 and 022 are not applied to the
linked Supabase project, and live AI/provider generation remains externally blocked by missing
credentials.

## PASS RESULTS

| Pass | Result | Scope |
|---|---|---|
| 9D — Versioning, branches, restore, merge & change impact | PASS | Immutable, pinned version history; meaningful compare; restore as a new revision; object-level creative branches; a merge as a reviewed proposal with real conflicts; dependency-aware impact computed but never applied; RLS, backend HTTP surface, Studio surface, manual-apply package |

## WHAT 9D IS

Migration 022 is **additive**. It does not touch `object_versions` shape or the 9A dependency
engine; it reads them. Versioning answers four questions honestly:

- *What version am I looking at?* — the immutable history of one object, each version pinned to a
  parent, a revision, a source action and a snapshot.
- *What changed?* — the meaningful creative fields that differ, not a raw JSON diff.
- *Can I try an alternative?* — yes, as an object-level branch that changes nothing on the
  mainline until an explicit reviewed merge.
- *What will happen if I accept it?* — the dependency-aware impact is computed for the preview,
  and applying propagates through the Prompt 9A impact engine.

## HISTORY IS HISTORY

- **A mainline edit adds a revision; it never overwrites one.** The pre-existing
  `capture_revision` trigger already writes `object_versions`; 9D adds a `versions_immutable`
  before-update-or-delete trigger on `tonde.object_versions` so a historical snapshot or delete is
  rejected (`23514` semantics / permission-denied on delete).
- **A restore creates a NEW current revision**, it does not rewind: `version_restore` reads the
  old snapshot, applies it through the guarded patch path, and records `source_action='restore'`.
  The intervening history stays readable and nothing is deleted.
- **The source action is told the truth.** A private `tonde.version_action` GUC is set by the
  guarded patch path (`capture_revision` reads it and defaults to `update`), so a restore-produced
  version says `restore` and a merge-produced version says `merge` — the version does not lie about
  how it came to be.

## COMPARE IS MEANINGFUL

`version_compare` diffs only the writable creative fields of that object kind through
`tonde_private.vb_fields` / `vb_field_label` / `vb_diff`: each change names the field, its display
label and the before/after values. Derived/run-down fields (`revision`, `updated_at`, identity)
never appear as changes. Comparing versions of *different* objects is rejected.

## A BRANCH IS AN ALTERNATIVE, NOT A DRAFT OF THE MAINLINE

- **Three enums:** `branch_state` (open / merged / abandoned), `branch_change_state`
  (pending / applied / conflicted / rejected) and `merge_state` (proposed / merged / rejected).
- **Three tables:** `tonde.object_branches` (the alternative, its origin version + revision and its
  state), `tonde.branch_changes` (one field patch per target object per branch) and
  `tonde.merge_proposals` (the classified proposal, its conflicts, counts and computed impact).
- **A branch records its origin.** A branch pins `source_version_id` and `source_revision`, and a
  branch must originate from a version of *its own* scope object.
- **The declared scope must match the object it branches.** `branch_create` rejects a scope that
  describes a different object kind (`scene` on a Shot, `shot` on a Scene, an unknown scope) with
  `22023` rather than recording a false scope.
- **A branch edit touches nothing on the mainline.** `branch_change_set` writes a field patch onto
  the branch; the canonical Scene/Shot/Asset is untouched, and a field that cannot change on a
  branch (`sort_order`, identity) is refused with `22023`.
- **One change per object per branch.** A partial unique index keeps the open change set coherent.
- **Abandoning closes the branch; reopening is explicit.** A closed branch refuses further changes
  (`23514`); merging happens only through a merge decision, never by editing the branch.
- **Clearing a change keeps it as history.** A discarded change is marked `rejected`, not deleted.

## A MERGE IS A REVIEWED PROPOSAL

- **`merge_preview` classifies every pending change** as `clean` or `conflicted` against the
  current mainline revision and records a real, readable proposal. A change whose target revision
  moved after the branch change was written is a **conflict**, and it says why ("the mainline moved
  after this branch change was written") with the per-field conflicts.
- **A conflict is shown, never resolved automatically.** `merge_decide` applies only selected
  `clean` changes; a conflicted change is never applied. Applying writes a **new mainline
  revision** per changed field (never an in-place overwrite).
- **Impact is computed, never applied, by the preview.** The proposal carries a dependency-aware
  impact summary per target object — direct / downstream / potential / total, and whether the graph
  walk was truncated — computed through the Prompt 9A `dependency_graph(..., 'forward', ...)`.
- **Rejecting changes nothing at all.** The mainline stays exactly as it was and the branch stays
  open for later.
- **Alternate endings are preserved side by side.** Two branches of the same Story can both exist;
  merging one closes only that branch and leaves the other open.

## DATABASE

- Public RPCs granted to `authenticated` (12): `version_list`, `version_get`, `version_compare`,
  `version_restore`, `branch_create`, `branch_list`, `branch_detail`, `branch_change_set`,
  `branch_change_clear`, `branch_state_set`, `merge_preview`, `merge_decide`.
- Private helpers in `tonde_private`, all revoked from `public, anon, authenticated, service_role`
  (9): `versions_immutable` (the trigger), `vb_fields` (the writable field map per object kind),
  `vb_field_label`, `vb_version`, `vb_object`, `vb_latest_version`, `vb_diff` (meaningful field
  diff), `vb_patch_apply` (the guarded revision-writing patch), `vb_structure_revision`.
- `guard_mutation` is mounted on all three new tables: identity stays immutable, revisions
  auto-bump, and merged/abandoned branches are never rewritten back into open ones.
- Real constraints enforce the product rules: a branch scope is one of the real scopes,
  `branch_changes` holds one change per object per branch, a patch is an object of fields,
  `merge_proposals.items` stays a list, and `source_version_id` names a real `object_versions` row.
- Indexes: `object_branches_open` (partial unique), `object_branches_by_production`,
  `branch_changes_by_branch`, `merge_proposals_recent`.

## RLS AND SECURITY

- RLS is enabled explicitly on all three new tables with the established tenant policies
  (`tenant_read` = workspace member, `tenant_insert` / `tenant_update` = editor).
- Reads run behind the member guard; every write runs behind `studio_guard`, which requires an
  authenticated workspace **editor**. A viewer may read version and branch history; a viewer cannot
  create a branch or change. Every RPC validates workspace, Production, scope and revision in the
  database.
- A cross-workspace call returns `42501` and the API translates it to 403. The database test proves
  Workspace B cannot list A's versions, cannot open a branch in A, and that a direct insert into
  `object_branches` for A is refused by RLS.

## BACKEND HTTP SURFACE

- [domain/versioning.py](backend/app/domain/versioning.py) — bounded request contracts with the
  canonical versioning vocabulary (`BRANCH_STATES`, branch scopes, propagation modes).
- [services/versioning.py](backend/app/services/versioning.py) — `LAYER = 'Versioning'` and
  `VersionRepository`, calling every guarded RPC through `rpc_detailed(..., layer=LAYER)` and
  carrying the display vocabulary, conflict wording and limitation. It recomputes no version state.
- [routers/production_versioning.py](backend/app/routers/production_versioning.py) — under
  `/api/v1/workspaces/{workspace_id}/productions/{production_id}/versions`: `GET /vocabulary`,
  `GET /` (history), `GET /compare`, `GET /branches`, `POST /branches`,
  `GET /branches/{branch_id}`, `POST /branches/{branch_id}/changes`,
  `POST /branches/{branch_id}/changes/{change_id}/clear`, `POST /branches/{branch_id}/state`,
  `POST /branches/{branch_id}/merge-preview`, `POST /merges/{proposal_id}/decide`,
  `GET /{version_id}`, `POST /{version_id}/restore`. Registered in [main.py](backend/app/main.py).
- Error translation is the shared one: `42501` → 403, `40001`/`23514`/`23505` → 409,
  `22023`/`22001` → 422, `PGRST202`/`42883` → 503 `STUDIO_SCHEMA_MISSING` naming this layer.

## STUDIO SURFACE

- [services/productionVersioning.ts](frontend/src/services/productionVersioning.ts) — the typed
  client with `BRANCH_STATES`, `BRANCH_SCOPES` and `PROPAGATION_MODES`, so the browser cannot offer
  a scope or decision the API will not accept.
- [studio/ProductionVersioning.tsx](frontend/src/studio/ProductionVersioning.tsx) — the `Versions`
  tool in Studio: the version timeline with source actions and current/pinned labels, the compare
  panel, "Restore this version" (creating a new revision), the branch list and detail with the
  branch change form, abandon/reopen, the merge preview with clean/conflicted changes and their
  impact, and the merge decision (accept selected clean changes or reject). Wired into
  [StudioPage.tsx](frontend/src/pages/StudioPage.tsx) as a creative-group tool with the `GitCompare`
  icon, and styled by `.ver*` rules in [index.css](frontend/src/index.css).
- The surface refuses what the product refuses: a conflicted change cannot be selected for a merge,
  rejecting a merge changes nothing, and restore never claims to rewind history.

## MANUAL HOSTED APPLY

- `supabase/manual-apply/13_202610050022_versioning_branches.sql` is the executable tail of the
  migration, byte-for-byte (byte-compared during this pass), ASCII-only, `begin;` … `commit;`
  (777 lines).
- `supabase/manual-apply/13_verify.sql` reports **126 checks** — tables, enums, every column,
  every product-rule constraint, RLS, policies per table, the three table guards, the versions
  immutability trigger, the honest `capture_revision` action hook, all 4 indexes, all 12 RPCs, all
  9 private helpers, that those helpers are unreachable, and that each public RPC is granted to
  `authenticated`. Every row reads `OK` against a full 001→022 database. Steps 20–21 are in
  [supabase/manual-apply/README.md](supabase/manual-apply/README.md).
- Hosted 018, 019, 020 and 021 remain unapplied as well: the packages `09_*`, `10_*`, `11_*`,
  `12_*` and `13_*` are queued in order. **Do not replay 009–021.**

## TEST COUNTS

| Suite | Result |
|---|---|
| `npm test` (root, embedded-PostgreSQL database tests incl. 14 Prompt 9D tests) | **185 passed / 0 failed** |
| Backend `pytest` (incl. 25 Prompt 9D API tests) | **366 passed** |
| Frontend `vitest` (incl. 14 Prompt 9D tests) | **192 passed** (14 files) |
| Playwright E2E (incl. the Prompt 9D spec) | **17 passed** |
| `ruff check app tests` | clean |
| `mypy app` | clean (68 source files) |
| `npm run typecheck` / `npm run build` | clean / built |
| `node scripts/generate-database-types.mjs --check` | Verified 78 tables, 60 SQL enums, vocabulary current |
| `node scripts/verify-boundaries.mjs` | clean |
| `git diff --check` | clean |

## SHARED VOCABULARY

The three new enums are mapped in `product/vocabulary.json` (`branchStates`,
`branchChangeStates`, `mergeStates`) and wired into
[scripts/generate-database-types.mjs](scripts/generate-database-types.mjs), which emits the
generated TS aliases and Python `StrEnum`s for them. Stored codes remain the SQL enum labels, so
display labels and storage codes cannot drift.

## REPAIRS MADE IN THIS PASS (all fixed, none skipped)

1. plpgsql variable/column collisions in the new RPCs (`reason_text`, `explanation_text`,
   `note_text`, `kind_value`, `subject_text`, `statement_text`, `critical_count`, `explanation`)
   were renamed so an assignment could never bind to a table column by accident.
2. A variable named `found` shadowed PL/pgSQL's special `FOUND`, so a loop-termination check read
   the wrong flag. Renamed.
3. Impact counts were computed against the wrong node set; they are now derived from the real
   `dependency_graph(...)->'nodes'` classifications (direct / downstream / potential / total, plus
   truncation).
4. The merge preview originally compared the wrong revision to decide a conflict; it now compares
   each change's `base_revision` against the current mainline revision and records per-field
   conflicts.
5. **The branch scope was recorded but never checked against the branched object's kind** (§167).
   Added the scope↔kind validation so a branch cannot report a scope that is not true; the
   database test now covers a Scene branched as a Shot, a Shot branched as a Scene, an unknown
   scope, and a matching scope that is still accepted.

## INTERNAL FAILURES

**NONE** outstanding.

## EXTERNAL BLOCKERS

> Hosted-state note added by the Prompts 1–9 correction pass (2026-10-07, read-only inspection):
> the hosted project is at 001–010, so 011–017 were unapplied as well, not only the later migrations
> listed below. The bullets below record what this pass believed at the time; the authoritative
> per-version matrix is in `docs/system-gap-audit-prompt1-9-final.md`.

- **Hosted migration 022 not applied** — BLOCKED. No Docker/Podman and no hosted credentials in
  this environment, so the semantic schema diff and the hosted apply are a manual Supabase action.
  The package is ready: `13_202610050022_versioning_branches.sql` then `13_verify.sql` (steps
  20–21). **Do not replay 009–021.**
- **Hosted migrations 018, 019, 020 and 021 also still unapplied** (carried over from Prompts 8,
  9A, 9B and 9C, steps 12–19).
- **Live AI/provider generation** — BLOCKED — REAL EXTERNAL DEPENDENCY. The merge/impact path is a
  deterministic contract exercised through the database and API tests; no model produced a merge
  or an impact interpretation in this pass.

## WHAT 9D DOES NOT CLAIM

- Impact is computed by the deterministic dependency graph, not by AI reasoning. 9D records the
  impact a merge *would* have; it does not interpret creative consequence.
- A merge applies only the clean, explicitly selected changes. It never auto-resolves a conflict
  and never edits approved content behind the creator.
- Version history, branches and merges are not approvals. 9D changes no object's approval state;
  approval, locks and readiness are 9E.

## READY FOR 9E

**YES** — immutable versions, object-level branches and reviewed merges sit on top of the 9A
impact engine and the 9B/9C continuity-memory layers without competing with them. Prompt 9 is
**not** at `MASTER PROMPT 9 — PASS` until 9E, 9F and 9G are complete.
