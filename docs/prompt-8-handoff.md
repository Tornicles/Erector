# Prompt 8 handoff — TONDE Long-Form, Movie Mode, Series & Production-Line Engine

Status: **MASTER PROMPT 8 — PASS** (internal scope complete; hosted migration 018 is not yet
applied to the linked Supabase project, and live AI/provider generation remains externally
blocked by missing credentials).

## PASS RESULTS

| Pass | Result | Scope |
|---|---|---|
| 8A — Long-form hierarchy & Movie Mode foundation | PASS | Production → Act → Sequence → Scene → Shot, lazy levels, breadcrumbs, structured search, semantic zoom |
| 8B — Story/Script/progressive planning depth | PASS | planning depth per scope, derived summaries with real staleness, progressive planning without fabrication |
| 8C — Series / Season / Episode | PASS | one canonical Production per Episode; Series context referenced, never copied |
| 8D — Generate Ahead + Production Line | PASS | preview → confirm, shell-only creation, idempotent slots, per-slot blockers and real readiness |
| 8E — Backend HTTP surface | PASS | 422 validation envelope, RBAC, error translation, 503 missing migration |
| 8F — Studio integration, E2E and certification | PASS | Movie Mode + Series Studio in Studio, React tests, Playwright §156/§157 |

## LONG-FORM HIERARCHY

`tonde.acts` and `tonde.sequences` became first-class structural levels and `tonde.scenes`
gained `act_id` (FK `scenes_act_scope`) so Production → Act → Scene is a real path. A Scene
belongs to at most one Sequence and one Act, enforced by a trigger
(`zz_scene_parent_guard`) that rejects an Act/Sequence mismatch and lets the foreign key
report a missing Sequence. Acts and Sequences are **optional**: a 3-minute YouTube video can
have none, and archiving is the only removal (nothing is deleted).

- Indexes: `acts_live_order`, `sequences_live_order`, `scenes_live_act_order`.
- Every level carries `lifecycle`, `approval`, `locked_at`, `revision`, `planned_duration_ms`.
- `tonde.objects.kind` gained `episode`; `a_register_object` registers Episodes,
  `b_capture_revision` snapshots Series/Collections/Episodes into `object_versions`.

## MOVIE MODE

`tonde.long_form_structure(workspace, production, level::tonde.structure_level, scope, limit, offset, expected_revision)`
returns **one bounded level at a time**: Acts for the Production, Sequences + orphan Scenes
for an Act, Scenes for a Sequence, Shots for a Scene. Every page carries `breadcrumb`,
`breadcrumb_line`, `total/limit/offset/truncated`, a `lazy` note and the Production
`timing`. The Studio's `MovieModeCanvas` renders that page as a proportional semantic
timeline plus a list, with drill-down, zoom (Act/Sequence/Scene/Shot), creates, approval,
lock/unlock, reorder and split — all against explicit revisions.

## ACTS & SEQUENCES

- `create_long_form_act/update_long_form_act`, `create_long_form_sequence/update_long_form_sequence`.
- `move_long_form_scene` moves a Scene between Sequences/Acts; `move_long_form_sequence`
  moves a Sequence between Acts. **The Scene/Sequence UUID and its Shots are preserved** —
  proven by the DB test that re-reads the same Scene id after the move.
- `split_long_form_structure` splits an Act or Sequence at a declared `sort_order`; no child
  is duplicated and the new object gets its own revision.
- `reorder_long_form` reorders Acts (or the Sequences of one Act) as a **complete ordered
  list** against `structure_revision`; a stale structure raises `40001`.
- `set_long_form_approval` is creator-only acceptance of one revision and accepts only
  `draft | needs_review | approved` at the API boundary (`changed_after_approval` is derived
  by the domain, never declared by a caller). `set_long_form_lock` is independent of
  approval, and a locked Act/Sequence rejects incidental writes.

## STORY / SCRIPT

`long_form_script_index` returns paginated script navigation with measured `characters`,
`lines`, `line_duration_ms` and a bounded excerpt per scope. `long_form_context` builds
scope-bounded Director context (path, siblings, Assets, documents, dialogue, timing) inside
an explicit character budget, so no model call ever receives the whole 120-minute
Production. `save_structure_summary` + `long_form_summaries` store derived summaries pinned
to the revision they describe; when the object changes they become **STALE with the source
revision shown**, never silently wrong.

## RUNTIME ROLLUPS

Runtime is computed at read time from real children
(`lf_scene_duration`, `lf_scope_duration`, `lf_label`, `lf_status`) and is always reported
separately from the planned target, with the real delta:

- Scene total only counts Shots when **every** Shot has an exact duration, otherwise the
  Scene is `unresolved`.
- `long_form_timing` returns `production` (target, calculated, delta, labels) plus
  `conflicts[]` naming each Act whose planned target and current child total differ, with
  `over_by_label` (e.g. `3:20`) and the reason.
- The target is never overwritten by the calculated total, and the UI rule text states it.

## SCALE

A 90-minute film with thousands of objects stays bounded: every read is paged
(`lf_bounded`, hard caps), totals come from per-branch `COUNT(*)` rather than the page, the
Studio requests one level at a time, and search/timing are index-backed. The large-Production
DB test builds a 24-Scene/72-Shot film and asserts the paged shape, not an expanded graph.

## SERIES, SEASONS / COLLECTIONS, EPISODES

- `create_series/update_series/save_series_collection/series_overview` with
  `series_kind = narrative | recurring`, explicit `timezone`, `cadence_metadata`
  (daily, weekdays, weekly, selected_weekdays, custom, none), `format` (production type,
  execution method, runtime target, title pattern, planned episodes, and Asset **ids** for
  style/host/characters/environments/products/wardrobe/props/voices).
- One canonical Production per Episode: `create_series_episode` creates or attaches a
  `series_episodes` row plus a Production shell; `update_series_episode` edits association
  fields only (creative content stays on the Production). Episodes are unique by
  `slot_key` and are `a_register_object('episode')` registered.
- Seasons/Collections are optional grouping rows; an Episode may live outside one.
- `series_overview` reports real counts, reused canonical Assets (`reuse[]`), upcoming
  Episodes and the last Generate Ahead job, and states that context is *referenced, never
  copied*.

## GENERATE AHEAD — HORIZONS AND DEPTH

`series_slots` computes future slots from the Series cadence **in the Series timezone**
(daily / weekdays / weekly / selected_weekdays / custom counts, with `tomorrow`, `next_7`,
`next_14`, `next_30`, `entire_series` and `custom` horizons). `entire_series` is rejected
with `23514` when the Series has no finite end — no unbounded loop is ever started.

`generate_ahead_preview` and `generate_ahead` share one deterministic planner
(`lf_generate_plan`). Applying requires `confirm = true` in the request; the preview strips
confirmation entirely, so previewing can never create anything. Depth is recorded
(`ideas_only | briefs | story | script | complete_plan`) and the RPC **creates only the
Production shell + Episode association** — it never fabricates Story, Script, Scenes, Shots
or plans, and says so in `depth_note`.

## PRODUCTION LINE

`series_production_line` returns, per Episode: requested depth vs actual `depth`, real
`line_state`, execution summary (real/ai/hybrid counts), timing, and `blockers[]` with
`code`, `severity`, `message` and the required `action` (for example
`requested_depth_missing`: "The Story is not written yet."). `readiness` is a count of real
blocking/warning criteria with a state of READY / READY WITH WARNINGS / NEEDS REVIEW /
BLOCKED / UNKNOWN. **No percentage is ever invented**, and the API decorates each row with
display labels and asserts `readiness_is_criteria_based`.

## DURABLE JOBS & IDEMPOTENCY

`generate_ahead_jobs` + `generate_ahead_items` give Generate Ahead durable per-slot state
(`created/preserved/blocked/failed`) so partial success is truthful: 7 of 9 slots created
reports 7 created and 2 blocked with reasons. `retry_generate_ahead` retries **only** the
blocked/failed slots of one job and never touches created Episodes. An existing Episode at a
slot is preserved (`state = preserved`, "nothing was overwritten"), a held slot is reported
as `blocked`, and repeating the same request is idempotent per `slot_key`/`planned_date`.

## DIRECTOR

`POST .../long-form/director/scope` resolves a command to **one explicit scope** via
`resolve_long_form_scope` over the loaded structure index; an unnamed scope is reported as
`ambiguous: true` with `scope_is_explicit: false` instead of being widened to the whole
Production, and the rule text states no other Act is rewritten. The answer carries the
resolved scope's bounded context and a breadcrumb line built from Production → … → scope.
`series_director_context` bounds Series reasoning to titles, dates, states and the avoid
list (no full historical scripts).

## REAL / AI / HYBRID

All three execution faces share one Production, one Scene list and one Shot list; the DB
test builds identical hierarchies for `real`, `ai` and `hybrid` and asserts the
photography-style path stays simple (no forced Acts/Sequences). Movie Mode is neutral about
execution method and shows the method per Shot.

## DATABASE

Migration `202610050018_long_form_series.sql` (additive; ~2.3k lines) adds:

- **Enums:** `series_kind`, `planning_depth`, `sequence_kind`, `structure_level`,
  `generate_horizon`, `generate_depth`.
- **Tables:** `structure_summaries`, `generate_ahead_jobs`, `generate_ahead_items`.
- **Columns:** Acts (purpose, narrative_goal, opening/ending state, summary, lifecycle),
  Sequences (purpose, kind, summary, lifecycle), Scenes (`act_id`), Series (kind, format,
  timezone, revision, summary), `series_collections` (purpose, lifecycle, revision),
  `series_episodes` (title, slot_key, requested_depth, brief, lifecycle, revision).
- **Guards:** `guard_mutation` on the new tables, `b_capture_revision` on
  Series/Collections/Episodes, `jobs_job_type_check` extended with `long_form_generation`,
  `zz_scene_parent_guard`, and the immutable-identity rule respected by naming mutable
  Episode/Production references `created_episode_id` / `created_production_id`.
- **30 public RPCs** granted to `authenticated` (structure, timing, search, script index,
  context, summaries, act/sequence writes, moves, split, reorder, approval, lock, Series,
  Episode, slots, preview, generate, retry, jobs, production line, Series Director), all
  private helpers revoked from `public/anon/authenticated/service_role`.
- `structure_revision` is the **sum** of Production + Act + Sequence + Scene + Shot
  revisions, so it is monotonic and stale reorders are detected (no `greatest()` masking).

Applied cleanly over 001–018 in embedded PostgreSQL (PGlite harness).

## MIGRATIONS + HOSTED STATE

- Local: 001–018, all additive, applied in order by the DB test harness.
- Hosted: **001–017 applied; 018 not yet applied** (no Docker/Podman, no hosted
  credentials in this environment → hosted apply + semantic diff BLOCKED).
- Manual forward reconciliation package: `supabase/manual-apply/09_202610050018_long_form_series.sql`
  with `09_verify.sql` (129 checks, 0 MISSING when run against a freshly migrated database),
  documented as steps 12–13 in `supabase/manual-apply/README.md`. Do not replay 009–017.

## SECURITY / RLS

- RLS is enabled explicitly on every new table with the established tenant policies
  (`tenant_read` = workspace member, `tenant_insert/update` = editor), and the RPCs run
  `security definer` behind `lf_read_guard` / `studio_guard` / `director_guard`.
- A cross-workspace call returns `42501` and the API translates it to 403; the DB and API
  tests both prove Workspace A cannot read Workspace B's structure, Series, Episodes, jobs
  or Production Line.
- Approval, locks and Generate Ahead are creator/editor-only; a `viewer` gets 403 on every
  write route, and `changed_after_approval` cannot be set by hand.

## ACCESSIBILITY

Movie Mode and Series Studio use labelled regions, `aria-pressed` zoom/toggle buttons,
labelled timeline bars (`Act 2: Act 2 - The break, 29:00, Draft`), breadcrumb navigation
with `aria-current`, captions on the Production Line table, `role="status"`/`role="alert"`
for notes and failures, and a single-column layout below 760px. Keyboard-only reordering is
available (Move earlier/later buttons), so drag is never the only path.

## TEST COUNTS

| Suite | Result |
|---|---|
| `npm test` (root, embedded-PostgreSQL database tests incl. 25 Prompt 8 tests) | **123 passed / 0 failed** |
| Backend `pytest` (unit + API incl. 21 engine + 40 API Prompt 8 tests) | **272 passed** |
| Frontend `vitest` (incl. 9 Movie Mode + 7 Series Studio) | **137 passed** |
| Playwright E2E (incl. §156 movie, §157 series) | **13 passed** |
| `ruff check app tests` | clean |
| `mypy app` | clean (56 source files) |
| `npm run typecheck` / `npm run build` | clean / built |
| `node scripts/generate-database-types.mjs --check` | 67 tables, 41 SQL enums, vocabulary current |

## PROMPT 1–7 REGRESSIONS

PASS — the DB suite, backend suite and browser suite that cover Prompts 1–7 all ran in the
same batch as the Prompt 8 tests (auth/workspace/RLS foundation, Director intelligence,
Studio Scene/Shot editing, Real Production takes/pickup, AI Creation locks/Attempts/Hybrid,
generated types and migrations), with no failures.

## INTERNAL FAILURES

**NONE.** Defects found during 8E/8F were repaired, not skipped: an ambiguous plpgsql
identifier set, a `greatest()` revision mask, a page-only `total`, missing job lease
columns, a broken `$$` patch, a non-ASCII character in the manual-apply copy, an
`IndexError`/`TypeError` in the API test harness (wrong `create_app` signature), a
Director breadcrumb that dropped the resolved leaf, an approval vocabulary that accepted
`final`, a reorder button disabled for the wrong item, and a stale test assertion about the
word "percentage" in a truthful note.

## EXTERNAL BLOCKERS

- **Hosted migration 018 not applied** — BLOCKED (manual Supabase action documented; no
  credentials or Docker in this environment).
- **Live AI/provider generation** — BLOCKED — REAL EXTERNAL DEPENDENCY.

## READY FOR PROMPT 9

**YES.**
