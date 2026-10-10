# TONDE Full-Lifecycle Coverage Matrix

Certified against commit `48bb8c9` (Studio 8-view migration on top of the Prompt 11 freeze).
Measured values in this document come from commands run in this session; nothing is inferred.

## Verification evidence (this session)

| Gate | Result |
| --- | --- |
| Root `node --test --test-concurrency=2` | 366 pass / 5 fail — the 5 failures are `frontend/src/**/*.test.ts` files executed by plain node; byte-identical split on the clean `5883ff6` tree, so pre-existing and unrelated |
| Frontend `vitest run` | 320/320 across 23 files (includes 7 new `studio-eight` tests) |
| Frontend `tsc --noEmit` | exit 0 |
| Frontend `npm run build` | exit 0 |
| `node scripts/generate-database-types.mjs --check` | exit 0 — 133 tables, 88 SQL enums |
| Playwright `e2e/foundation.spec.ts` | 8/8 |
| Playwright `e2e/studio.spec.ts` | 2/2 |
| Secret scan (key-shaped patterns over `frontend/src`, `.env*` gitignored) | clean |
| Backend `pytest` / `ruff` / `mypy` | BLOCKED — no Python runtime in this environment (same as prior sessions) |
| Hosted Supabase / Vercel / live OpenAI checks | BLOCKED — no credentials in this environment (see Owner-blocked) |

Migration lineage in repo: `supabase/migrations` 001–049 (049 `team_invites` landed after the
Prompt 11 hosted certification at 001–048; hosted equivalence past 048 is unverified from here).

## Status key

- COMPLETE — schema → RLS → API → frontend → tests all present and regression-verified.
- PARTIAL — real capability exists but narrower than the full lifecycle text; no fake UI claims more.
- DEFERRED — not V1 core per constitution §16 ("Core V1 identity") and AGENTS.md scope discipline
  ("Do not build later engines just because the constitution defines them"); honestly absent, no fake UI.
- OWNER-BLOCKED — needs owner credentials/access unavailable here.

## Lifecycle coverage (§§4–90 of the audit prompt)

| Area | Schema | Backend/API | Frontend | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| Master Production (§4) | productions + hierarchy | studio/director routers | Studio 8 views, Projects | vitest + e2e | COMPLETE |
| Lifecycle states (§5) | `active/archived/deleted` + approval/result/publication/export states (deliberately no duplicate stage enum) | readiness gates, publication guards | status pills, readiness canvas | e2e + unit | COMPLETE as designed |
| Home → DIRECT THIS (§6) | intake via director plan/commit | director plan/decisions/commit | FoundationPages intake (text/upload/URL/script) | e2e Home→Studio | COMPLETE |
| Director intake (§7) | brief/intent models | brief + director domains | intake + Brief canvas | unit + e2e | COMPLETE |
| High-value questions (§8) | blocking questions model | director plan questions | blocking-gated BUILD | e2e | COMPLETE |
| Early production + jobs (§9, §95) | jobs tables, worker invariants | jobs router, Prompt 11 worker | Jobs page (durable state, no fake progress) | db + api tests | COMPLETE |
| Studio entry context (§10) | — (routing) | — | URL `tool/scene/shot` state, survives reload | e2e | COMPLETE |
| Studio shell/topbox/drawer/canvas/Director/timeline (§§11–16) | read model/timing | studio surface + director command | StudioEight + StudioPage | 7 new + suite + e2e | COMPLETE |
| Idea (§17) | brief | story alternatives | IdeaLabCanvas (real alternatives, apply) | new tests | COMPLETE |
| Research/evidence (§18) | reference provenance, knowledge items | knowledge/reference routers | Knowledge page, reference lab (honest access limits) | api tests | PARTIAL (no dedicated research board) |
| References (§19) | references + identity/purpose (Amend B) | reference analyze/shape | Reference canvas + lab | unit + e2e | COMPLETE |
| Story adaptive (§20) | story/beats/dialogue | director story reasoning | Story canvas, beats timeline | unit | COMPLETE (type-specific grammars lean on Director, not separate engines) |
| Hooks/moments (§21) | story beats as moments | timeline moments | semantic timeline Moments row | new tests | COMPLETE (basic) |
| Script (§22) | script scenes/lines | script ops + proposals | Script canvas, proposal/apply | unit | COMPLETE |
| People/assets (§§23–25) | assets + bindings + locks | assets/binding APIs | Assets page, AssetCanvas, usage + archive | unit + e2e | COMPLETE for reusable identities; event-role management PARTIAL |
| Locations/world (§24) | environments as assets + bindings | asset/environment binding | AssetCanvas (World), scene environment | unit | PARTIAL (no logistics fields) |
| Scenes/Shots (§§26–27) | scenes/shots + history | studio workspace writes | Scene/Shot canvases, reorder/duplicate/approve | unit + e2e | COMPLETE |
| Production Kit + gear paths (§§28–30) | setup inventory + kits | setup/device-scene guidance | Kit page, Reality Check, Real plans from owned gear | unit + e2e | COMPLETE |
| Substitution/impact (§§31, 52) | dependencies/impact edges | intelligence/impact preview + UPDATE ALL/REVIEW/CHANGE-ONLY | impact preview UI | api + e2e | COMPLETE |
| Budget (§32) | — | intake constraint + reality domain only | honest: no budget UI, no estimates fabricated | — | DEFERRED |
| Crew/collaboration/comments (§§33–34) | team workspace + invites (049) | team router | Team page | api tests | PARTIAL (no per-object assignments/comments) |
| Rights (§35) | rights classification on references | reference rights | shown, never claimed as legal proof | unit | PARTIAL |
| Scheduling/tasks (§§36–37) | — | — | honestly absent | — | DEFERRED |
| Readiness + gates (§§38–39) | readiness blockers/warnings | readiness router | Readiness canvas, blockers exposed | api + unit | COMPLETE |
| Real/AI/Hybrid (§§40, 45) | per-shot execution | real/ai routers, hybrid decision | faces + Hybrid board, On-Set page | unit + e2e | COMPLETE |
| On-set/takes/coverage (§§41–43) | plans/requirements/takes/capture/deviations | real production router | RealProduction + On-Set | unit | COMPLETE |
| AI playbooks (§44) | prompts/locks/routing | ai creation router | AICreation canvas, copy/export | unit + e2e | COMPLETE |
| Media ingest/results/shot match (§§46–50) | media/results/reports/corrections | media + shot-match routers | Results canvas, compare/approve/retry | api + unit + e2e | COMPLETE |
| Continuity (§51) | states/findings/checks | continuity router | Continuity panel + canvas, scoped | unit + e2e | COMPLETE |
| Locks (§53) | locked_at + AI locks | lock APIs | lock toggles, proposals respect locks | unit + e2e | COMPLETE |
| Post/edit/audio/color/VFX/picture-lock (§§54–60) | audio plan/music/sound direction (Amend C), edit via scenes/shots/timing | audio + studio timing | Audio canvas, edit-structure, Style Bible (look guidance) | unit | PARTIAL (no picture-lock object, no VFX renderer — direction only, honestly scoped) |
| Master QC/approval/client review (§§61–63) | approvals (draft→review→approved→changed-after) | approval APIs | approval controls, history | e2e | PARTIAL (no separate client-reviewer role) |
| Derivatives/specs/packaging (§§64–66) | — | — | honestly absent | — | DEFERRED |
| Delivery/publishing (§67) | publications + Amend D laws | publishing router | Publishing canvas (pin/authorize/reconcile) | api tests | COMPLETE (single authorized destination; scheduler explicitly out of scope) |
| Series/campaigns/events/sports/photo (§§68–72) | series/seasons/episodes/generate-ahead | long-form router | SeriesStudio, MovieMode; photography conditional (no forced narrative) | api + unit + e2e | COMPLETE for series/photo; campaigns/event/sports templates DEFERRED |
| Command center/notifications (§§73–74) | — | Your Work reads productions | Home action queue (real data); notifications dialog is an honest empty state | e2e | PARTIAL |
| Autosave/recovery/history/health (§§75–77) | revisions/history/branches | versioning router, autosave | title autosave, Versions canvas, readiness summary | unit + e2e | COMPLETE except Undo/Redo, which is DEFERRED (revision history is the recovery mechanism; the canonical design's undo was toast-only and was honestly omitted, not faked) |
| Delivery gate/book/exports/versions/archive (§§78–85) | exports (pinned, manifest), versions, archive lifecycle | exports + versioning routers | Exports canvas (full document + package, versioned filenames), archive actions | api + unit | COMPLETE (Production Book = pinned full document; adaptive sections per available state) |
| Performance learning (§86) | — | — | honestly absent; no fake analytics | — | DEFERRED (future-ready; no invented data) |
| Templates (§87) | production types vocabulary | director intake per type | Discover techniques/knowledge | unit | PARTIAL |
| Stage-aware Studio (§88) | — | readiness/status summary | same shell; views selectable, not stage-forced | e2e | PARTIAL (no forced stage gating — deliberate) |
| Director's eight questions (§90) | status summary/timing/readiness/impact | surfaces above | Studio answers via status/readiness/impact/continuity | e2e | COMPLETE (who-does-it is PARTIAL without task assignment) |
| No fake frontend (§91) | — | — | swept: only honest loading/empty/error/disabled states; notifications empty-state is explicit | suite | COMPLETE |
| Auth/RLS/two-user (§92) | RLS everywhere, 048 anon revoke | service/RLS tests | workspace-scoped clients | db tests + prior hosted 694 PASS | COMPLETE locally; hosted re-run OWNER-BLOCKED |
| Backend/frontend completeness (§§93–94) | chain rule enforced per feature |Amend D/E preserved | all user features have route/loading/empty/error/real-data | suite | COMPLETE for shipped scope |
| Media safety (§96) | scanner seam | unconfigured reported | "not configured" shown, never safe=true | tests | COMPLETE |
| OpenAI Director (§§97–98) | provider config server-side | strict-schema repair, fallback, diagnostics | deterministic-only banner when unconfigured | unit | COMPLETE |
| Supabase/Vercel/a11y/perf/errors (§§99–104) | 001–049 forward-only | build clean | responsive Studio, keyboard, honest errors | build + e2e | COMPLETE locally; hosted equivalence past 048 OWNER-BLOCKED |

## Owner-blocked / owner-deferred items (truthful, isolated)

1. Hosted acceptance re-run (RLS/hosted DB/Vercel routing/live Director/exports/jobs) — no credentials in this environment.
2. Real signup email delivery + Google sign-in — pre-existing deferral (no inbox/OAuth).
3. Backend pytest/ruff/mypy — no Python runtime here.
4. Later-engine scope (budget, scheduling, tasks, derivatives, campaigns, client roles, undo/redo, performance learning, VFX rendering, social-provider fleet, generation connectors) — constitutionally deferred (§16), not faked anywhere.
