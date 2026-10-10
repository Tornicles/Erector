# Prompt 5 handoff — TONDE Studio Workspace (Scenes, Shots, Timeline, Approvals, Locks)

> **Reconstructed record.** No handoff was written when Prompt 5 completed; every later pass
> regressed its suites green, but the document itself is absent. This file was reconstructed on
> 2026-10-07 by the verification/peer session **from the verified artifacts** — migration 015,
> `tests/database/prompt5-studio.test.mjs`, the backend Studio layer, and the Studio frontend —
> so the 9G certification (§244 "PROMPT 5 REGRESSION") has its record. Every claim below is
> checkable against those files; scoped re-runs this session are marked with exit codes.

Status: **PASS 5** (internal scope complete; superseded in capability by later passes that
extend it). Prompt 6 and the whole of Prompt 9 were built on this foundation.

## PASS RESULTS

| Area | Result |
|---|---|
| Scenes and Shots as canonical, workspace-scoped rows with persisted order | PASS |
| Guarded Studio mutation RPCs (revision-pinned, creator-authority preserving) | PASS |
| Derived Scene timing from Shot durations, with honest runtime reporting | PASS |
| Runtime reconciliation onto the Production target, rejectable by the creator | PASS |
| Approvals foundation and locks (independent of each other) | PASS |
| Archiving without hard deletion | PASS |
| Cross-workspace denial on every Studio path | PASS |
| Studio frontend surface (tool bar, canvases, timeline) | PASS |

## WHAT PROMPT 5 IS

Migration `202610050015_studio_workspace.sql` made **Shots first-class canonical rows** in the
object registry with `lifecycle` and `sort_order`, and added the guarded Studio mutation RPCs.
Editing is revision-pinned end to end: every mutation carries `expected_revision`, a stale
revision is a conflict (40001 → 409), and the pre-existing `guard_mutation` semantics (approved
content flips to `changed_after_approval` on material edit; a locked object refuses edits with
23514) apply identically to the UI path and the Director path — proven by the same test.

## DATABASE (migration 015)

- **13 public RPCs** (granted to `authenticated`): `studio_timing`, `create_studio_scene`,
  `update_studio_scene`, `reorder_studio_scenes`, `archive_studio_scene`, `create_studio_shot`,
  `update_studio_shot`, `move_studio_shot`, `reorder_studio_shots`, `archive_studio_shot`,
  `set_studio_approval`, `set_studio_lock`, `reconcile_studio_runtime`.
- **Private helpers in `tonde_private`** (revoked from client roles):
  `studio_guard`, `studio_revision_guard`, `studio_timing`.
- `shots_live_order` index on `(workspace_id, production_id, scene_id, lifecycle, sort_order)`.
- Reorder paths require the **complete live set** of that Scene (or of Scenes) — a partial list
  is refused, so order can never be silently truncated.
- Approvals and locks are recorded through `set_studio_approval` / `set_studio_lock`, which the
  canonical `guard_human_acceptance` trigger (007) still backs: only an authenticated creator
  can approve; service-role approval is refused.

## BACKEND HTTP SURFACE

[routers/studio.py](../backend/app/routers/studio.py) under
`/api/v1/workspaces/{workspace_id}/productions/{production_id}/studio`, served through
[services/studio.py](../backend/app/services/studio.py),
[studio_repository.py](../backend/app/services/studio_repository.py) and
[studio_workspace.py](../backend/app/services/studio_workspace.py):
`GET /` (context), `GET /timing`, `POST /scenes`, `PATCH /scenes/{id}`,
`POST /scenes/reorder`, `POST /scenes/{id}/archive`, `POST /shots`, `PATCH /shots/{id}`,
`POST /shots/{id}/move`, `POST /scenes/{id}/shots/reorder`, `POST /shots/{id}/archive`,
`POST /approval`, `POST /lock`, `POST /runtime/reconcile`.

## STUDIO SURFACE

[StudioPage.tsx](../frontend/src/pages/StudioPage.tsx) hosts the tool bar with deep-linkable
tool state and the Real/AI face switch; [StudioCanvases5.tsx](../frontend/src/studio/StudioCanvases5.tsx)
provides `SceneCanvas`, `ShotCanvas`, `AssetCanvas`, `FoundationCanvas` and `TimingInspector`;
[StudioTimeline.tsx](../frontend/src/studio/StudioTimeline.tsx) renders the zoomable timeline
with approval labels and duration formatting. The timeline hierarchy follows a Shot moved
between Scenes (proven in the DB suite).

## MANUAL HOSTED APPLY

`supabase/manual-apply/06_202610050015_studio_workspace.sql` + `06_verify.sql` (steps 6–7 of
`supabase/manual-apply/README.md`). The DB suite's final test asserts the hosted verification
query reports every Studio object present against a full chain.

## TEST COUNTS (re-verified 2026-10-07, scoped runs)

| Suite | Count | Result |
|---|---|---|
| `tests/database/prompt5-studio.test.mjs` | 14 tests | green in every full-sweep regression; last full sweep at PASS 9E |
| `backend/tests/test_studio_workspace_api.py` | 12 tests | **12 passed, exit 0** (scoped run this session, 23.4s) |
| `frontend/src/test/studio.test.tsx` | 23 tests | **exit 0** (scoped run this session, 16.3s) |
| `frontend/e2e/studio.spec.ts` | 2 tests | green in the last full Playwright run (16 passed) |

## WHAT PROMPT 5 DOES NOT CLAIM

- Full hosted acceptance (external gates unchanged; see the Prompt 1/2 handoffs).
- Version/branch history (9D), readiness derivation (9E), continuity (9B) — those are later
  passes that extend, never replace, this layer.
- The counts above are from the current tree: later passes grew the shared service files while
  keeping this surface's contracts intact (every later regression re-proves them).

## STANDING IN THE 9G CERTIFICATION

§232 requires verifying: Studio; Scene/Shot editing; timeline; approvals foundation; locks;
scoped Director. Each of these is directly covered by the DB suite tests listed above, the
scoped backend/component runs, and the `studio` E2E spec.
