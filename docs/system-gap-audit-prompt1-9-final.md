# System gap audit — Prompts 1 through 9 (authoritative)

Prompts 1–9 correction pass, 2026-10-07. This report **replaces**
[system-gap-audit-prompt1-9.md](system-gap-audit-prompt1-9.md) as the authoritative gap record. That
earlier audit was written while Prompt 9F/9G were still in flight; this one reconciles every finding
it raised against the completed Prompt 9 tree, repairs what was genuinely broken, and separates
implementation status from hosted/external acceptance status.

Companion documents: [correction handoff](prompt-1-9-correction-handoff.md) (the pass result),
[Prompt 9G handoff](prompt-9g-handoff.md) (Prompt 9 certification),
[manual-apply README](../supabase/manual-apply/README.md) (the forward rollout package).

## A. Executive verdict

| Prompt | Scope | Implementation | Regression | Hosted status | External blockers | Known future-scope items |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Auth, workspace isolation, schema/RLS foundation, Setup, Assets, Media foundation | PASS (local) | PASS | Ledger 001–010 present; 001–010 effects present | Google OAuth disabled; email/SMTP unverified; six-bucket/full-resource hosted acceptance incomplete | — |
| 2 | Constitution, canonical approvals/locks, Result semantics, evidence labels, human authority | PASS (local) | PASS | 002/007 effects verified in the Prompt 2 correction record; 009–010 effects verified and ledger-repaired | Hosted security-advisor re-run after rollout; complete schema semantic diff | — |
| 3 | Application shell, navigation, seven routes, visual system | PASS | PASS | n/a (browser only) | — | — |
| 4 | Director Intelligence, Reference Analysis, Story/Script/Dialogue, Reality Check | PASS (local) | PASS | 011–014 **effects are live hosted but the ledger has no rows** | — (see C) | Reference identity+purpose model and first-class Audio Plan are constitutional amendments recorded in E |
| 5 | Studio, Scene/Shot editing, timeline, approvals foundation, locks | PASS (local) | PASS | 015 **not applied** | — | — |
| 6 | Real plans, Takes, pickup, Setup-aware execution | PASS (local) | PASS | 016 **not applied** | — | — |
| 7 | AI prompts, Character/World/Product Locks, Attempts, Results linkage, Hybrid | PASS (local) | PASS | 017 **not applied** | Live AI/multimodal provider generation (REAL EXTERNAL DEPENDENCY) | — |
| 8 | Acts, Sequences, long-form, Series, Episodes, Generate Ahead, Production Line | PASS (local) | PASS | 018 **not applied** | — | — |
| 9A–9G | Dependency graph, impact, continuity, memory, search, versioning, branches, merge, approvals, locks, readiness, Results, Shot Match, FIX THIS SHOT, integration | PASS (`MASTER PROMPT 9 — PASS`) | PASS | 019–024 **not applied** | Live provider-backed Shot Match analysis (REAL EXTERNAL DEPENDENCY) | — |

No prompt is FAIL. Every internal defect found in this pass was repaired (see B and the correction
handoff). No implementation work from Prompt 10 or Prompt 11 was started.

## B. Previous finding reconciliation

| # | Original claim (earlier audit / peer review) | Current status | Evidence | Action taken | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | **G1 — "No jobs/outbox table exists in any of the 24 migrations."** | **Wrong.** `tonde.jobs` has existed since migration 001 | `202610050001_tonde_core.sql:399` creates `tonde.jobs` with `job_state`, `progress`, `attempts`/`max_attempts`, `available_at`, `lease_owner`/`lease_expires_at`, `input_object_id`/`output_object_id`, `input_metadata`, `requested_by`, workspace/Production identity; `005` adds six lease/completion checks and the `validate_job_links` trigger; `018` extends `job_type` and writes real Generate Ahead jobs; indexes `jobs_workspace` and the partial `jobs_claimable` | Corrected the audit language; added a DB test pinning the foundation | **FALSE / STALE FINDING** |
| 2 | **G2 — `docs/prompt-5-handoff.md` is missing.** | Already fixed | The file exists and was reconstructed on 2026-10-07; its concrete claims were re-verified this pass (13 public RPCs with the listed names, 3 private helpers, `shots_live_order`, 14 DB tests, 12 backend tests) | None needed | **ALREADY FIXED** |
| 3 | **017 #6 — `execution_plans.model_profile_id` / `fallback_model_profile_id` have no FK.** | **Confirmed defect.** 017 added both as bare `uuid`; only `save_ai_plan` validated membership | `202610050017_ai_creation.sql:148-149`; the only `(workspace_id, model_profile_id)` FK in 017 is on `ai_generation_attempts`, not `execution_plans` | **Fixed** by additive migration 025: two tenant-safe composite FKs to `ai_model_profiles(workspace_id, id)` with `on delete restrict`, plus two partial indexes; six new DB assertions | **CONFIRMED DEFECT → FIXED** |
| 4 | **017 #2 — `declare_ai_model` update path bumps the revision twice.** | Already fixed in 017 | `cost_known` is computed inside the same single `UPDATE` expression; `prompt7-ai-creation.test.mjs` asserts one edit = one revision | Re-proven in the correction suite | **ALREADY FIXED** |
| 5 | **017 #1 — `supports_image_edit` / `supports_lipsync` not correctable.** | Already fixed in 017 | Both appear in the update branch's `set` list with the "every declared capability must be correctable" comment | Re-proven in the correction suite + prompt7 | **ALREADY FIXED** |
| 6 | **017 #3 — `create_ai_batch` hardcodes `'video'`.** | Already fixed in 017 | `create_ai_batch` now inserts `tonde_private.ai_primary_operation(...)` | None needed | **ALREADY FIXED** |
| 7 | **017 #4 — `select_ai_result` overwrites a prior creator decision.** | Already fixed in 017 | The deselect statement clears `selected` only; the select preserves an existing `creator_decision` | None needed | **ALREADY FIXED** |
| 8 | **017 #5 — `ai_creation_surface` calls `ai_readiness_state` ~3×/Shot (O(3N)).** | **Confirmed inefficiency** (measured at up to 4 readiness evaluations plus 2 selection lookups per Shot) | Scene lateral + Shot list + three summary filters + the summary's selection count | **Fixed** by migration 025: one `base` CTE computes readiness and selection once per active Shot; a counting-wrapper test proves exactly one readiness call per Shot at 6 Shots and at 30 Shots, and the document shape is unchanged | **CONFIRMED → FIXED** |
| 9 | **Generated types `--check` failing** (audit snapshot) | Already fixed | `--check` verifies 80 tables / 67 SQL enums | Re-run this pass | **ALREADY FIXED** |
| 10 | **9F/9G in flight; no 9F E2E spec** | Already fixed | 9F/9G both PASS; `shot-match.spec.ts` and `prompt9-integration.spec.ts` exist and pass | Re-run this pass | **ALREADY FIXED** |
| 11 | **Hosted migration statements across the docs** | Partly wrong and mutually contradictory | Read-only inspection: the **ledger** is 001–010 while the **effect state** is 001–014 present / 015–025 absent. AGENTS.md said 001–008 (and that 009–010 were unapplied); the 9G handoff said 001–017; several handoffs implied only 018+ were missing | Corrected AGENTS.md, the runbook, the 9G handoff, the Prompt 1/2 handoffs, the migration audit, the acceptance log and the manual-apply README; the matrix in C is now the single authority | **DOCUMENTATION/CERTIFICATION GAP → CORRECTED** |
| 12 | **Prompt 4 completion overstated** (Reference identity/purpose) | Recorded, not a defect | Prompt 4 ships reference kind/role/state, not a first-class per-Reference identity + creator-purpose model | Recorded in E as a pending constitutional amendment | **INTENTIONAL LATER-PROMPT RESPONSIBILITY** |
| 13 | **"No outbox"** | True, but not a defect | There is no outbox/dispatcher/worker-claim lifecycle; §165's durable-jobs *persistence* exists | Recorded in E as Prompt 11 work | **INTENTIONAL LATER-PROMPT RESPONSIBILITY** |

## C0. Post-audit reconciliation (2026-10-08, dated correction — section C below is the 2026-10-07 reading)

Section C records what was true on 2026-10-07 and is kept as history. On 2026-10-08 the linked
development project was reconciled and the forward range applied, so the two rows of that table that
disagree (the ledger at 001–010 and the effect state at 001–014 / 015–025 absent) no longer describe
the hosted project: **the ledger now records 001–030 and the hosted `tonde` effect state matches the
source migrations.** 011–014 were repaired as history only and never replayed; 015–027 were applied
forward (including a reconciled completion of the interrupted 018), 028 added the analysis
completion pin, and 029 repaired the `SECURITY INVOKER` guard defect that the catalog comparison
detected — with `guard_mutation` and `guard_human_acceptance` as invoker functions, every write by a
role other than `authenticated` had failed with `permission denied for function
is_workspace_member`, which made the durable-jobs foundation unwritable by the server role the
matrix's D-table describes as a passing foundation.

Equivalence is re-read rather than asserted: `node scripts/pre-prompt10-catalog-verify.mjs` compares
every untruncated table/column/constraint/index/policy/trigger/function-body/type/ACL identity from
both sides and reported **0 differences over 4087 identities** after package 21
(`test-results/pre-prompt10/hosted-final-diff.json`). The verdict, the retained failures and the two
remaining prerequisites are in the [pre-Prompt 10 certification report](pre-prompt10-final-certification.md).

## C. Migration matrix

Two facts are recorded separately, because they disagree: the **ledger** (what
`supabase_migrations.schema_migrations` records) and the **effect state** (what the hosted `tonde`
schema actually contains). Both were read read-only on 2026-10-07 — the ledger via
`supabase migration list --linked`, the effect state via the hosted PostgREST schema cache
(OpenAPI path list) plus per-column probes. No hosted SQL was executed and no migration was applied
by this pass.

| Version | Purpose | Local source | Manual package | Hosted ledger | Hosted effect | Action |
| --- | --- | --- | --- | --- | --- | --- |
| 001 | Core schema, enums, registry, **`tonde.jobs`**, exports | present | — (pre-package era) | recorded | present (controls: `productions`, `shots`, `object_versions`) | none |
| 002 | Membership helpers, RLS, history/audit | present | — | recorded | verified subset (Prompt 2 correction record) | none |
| 003 | Six private buckets, Storage policies/helpers | present | — | recorded | verified subset | none |
| 004 | Media/integrity rules, bucket+key checks | present | — | recorded | implied by a working hosted schema | none |
| 005 | Job/attempt integrity checks, `validate_job_links` | present | — | recorded | implied | none |
| 006 | Product vocabulary pins | present | — | recorded | implied | none |
| 007 | Human-acceptance guard trigger | present | — | recorded | hosted function/trigger observed | none |
| 008 | `tonde` schema usage for anon (no table grants) | present | — | recorded | verified (anon read 401) | none |
| 009 | Revoke public RLS-admin execution | present | — (hand-applied, ledger repaired) | recorded | **effect verified** | none |
| 010 | Relocate policy helpers to `tonde_private`, rewrite policies | present | — (hand-applied, ledger repaired) | recorded | **effect verified** | none |
| 011 | Director intake tables | present | `01_` | **not recorded** | **PRESENT** (`director_intakes`, `director_plan_proposals` in the schema cache) | **history-only ledger repair; never replay** |
| 012 | Director intelligence columns + RPCs | present | `02_` | **not recorded** | **PRESENT** (`scenes.story_beat`, `scenes.scene_detail`, `scenes.opening_state`, `dialogue_lines.delivery`) | same |
| 013 | Reference analysis + apply RPCs | present | `03_` | **not recorded** | **PRESENT** (`save_reference_analysis`, `claim_reference_analysis` cached) | same |
| 014 | `apply_director_operation` RPC | present | `04_` | **not recorded** | **PRESENT** (`apply_director_operation` cached) | same |
| 015 | Studio Scenes/Shots/timeline/approvals/locks | present | `06_` (step 6, `06_verify.sql`) | not applied | **ABSENT** (`create_studio_scene` not cached; `shots.purpose` → 42703) | **apply forward** |
| 016 | Real plans, Takes, capture state, deviations | present | `07_` (step 8) | not applied | **ABSENT** (`shot_takes`, `shot_capture_state` → PGRST205) | apply forward |
| 017 | AI Creation & Hybrid Director | present | `08_` (step 10) | not applied | **ABSENT** (`ai_model_profiles`, `ai_generation_attempts` → PGRST205) | apply forward |
| 018 | Acts/Sequences/Series/Episodes/Generate Ahead | present | `09_` (step 12) | not applied | **ABSENT** (`structure_summaries`, `generate_ahead_jobs`) | apply forward |
| 019 | Dependency graph, impact engine, stale artifacts | present | `10_` (step 14) | not applied | **ABSENT** (`stale_artifacts`, `impact_analyses`) | apply forward |
| 020 | Continuity engine | present | `11_` (step 16) | not applied | **ABSENT** (`continuity_states`, `continuity_findings`) | apply forward |
| 021 | Production Memory & structured search | present | `12_` (step 18) | not applied | **ABSENT** (`memory_items`, `memory_candidates`) | apply forward |
| 022 | Versioning, branches, restore, merge | present | `13_` (step 20) | not applied | **ABSENT** (`object_branches`, `merge_proposals`) | apply forward |
| 023 | Approval, locks, readiness + decision ledger | present | `14_` (step 22) | not applied | **ABSENT** (`access_decisions`) | apply forward |
| 024 | Results, Shot Match, FIX THIS SHOT | present | `15_` (step 24) | not applied | **ABSENT** (`match_corrections`) | apply forward |
| 025 | Prompts 1–9 correction: model-profile FKs + single-computation readiness | present | `16_` (step 26) | not applied | **ABSENT** (created by this pass) | apply forward, after 015–024 |

**Safe forward path (documentation only — this pass did not deploy anything).**

1. Confirm 011–014 are in effect with `05_verify.sql` (every row `OK`).
2. Reconcile 011–014 in the ledger with a **history-only** repair, exactly as was done for 009–010.
   Do not replay 011–014: they are not idempotent and are already in effect.
3. Apply packages `06_` (015) → `16_` (025) **in order**, running each `NN_verify.sql` and requiring
   every row to read `OK` before moving on.
4. Never replay 001–010. Never use a remote reset.
5. After the rollout, re-run the hosted security advisors and the hosted acceptance runner.

**Drift summary.** The only ledger/effect divergence found is the 011–014 gap above. Every other
version's ledger state and effect state agree. Full semantic equality is still unproven for 001–010
— version/name alignment is not a checksum, and `supabase db diff --linked` remains blocked by the
missing Docker/Podman.

## D. Test matrix (final frozen counts)

| Suite | Count | Result |
| --- | --- | --- |
| `backend` pytest | 397 | passed |
| `backend` ruff | — | `All checks passed!` |
| `backend` mypy | 74 source files | no issues |
| `frontend` vitest | 220 tests / 16 files | passed |
| `frontend` typecheck (`tsc --noEmit`) | — | clean |
| `frontend` production build | — | succeeds |
| Playwright (Chromium) | 20 | passed |
| Root `npm test` (database + product) | 225 | passed |
| `tests/database/foundation.test.mjs` | 21 | passed |
| `tests/database/constitution.test.mjs` | 6 | passed |
| `tests/database/prompt1-9-corrections.test.mjs` | 4 | passed (**new this pass**) |
| `tests/database/prompt4-intelligence.test.mjs` | 8 | passed |
| `tests/database/prompt5-studio.test.mjs` | 14 | passed |
| `tests/database/prompt6-real-production.test.mjs` | 18 | passed |
| `tests/database/prompt7-ai-creation.test.mjs` | 25 | passed |
| `tests/database/prompt8-long-form.test.mjs` | 25 | passed |
| `tests/database/prompt9a-dependencies.test.mjs` | 13 | passed |
| `tests/database/prompt9b-continuity.test.mjs` | 16 | passed |
| `tests/database/prompt9c-memory.test.mjs` | 19 | passed |
| `tests/database/prompt9d-versioning.test.mjs` | 14 | passed |
| `tests/database/prompt9e-approval-readiness.test.mjs` | 11 | passed |
| `tests/database/prompt9f-shot-match.test.mjs` | 15 | passed |
| `tests/database/prompt9g-integration.test.mjs` | 10 | passed |
| `tests/product/constitution.test.mjs` | 6 | passed |
| `generate-database-types.mjs --check` | 80 tables / 67 enums | verified |
| `verify-boundaries.mjs` | — | clean |
| `git diff --check` | — | clean |
| `15_verify.sql` against 001→025 | 102 rows | every row `OK` |
| `16_verify.sql` against 001→025 | 12 rows | every row `OK` |

## E. Deferred future work

Legitimate future scope — **not** defects, and deliberately not implemented here.

**Prompt 10 (do not begin early):** PDF/DOCX/ZIP Production exporter; the media import framework;
final Asset-library expansion; deliverable generation; integration marketplace; external publishing.

**Prompt 11 (do not begin early):** transactional enqueue/outbox; dispatcher selection; atomic worker
claiming; full lease lifecycle; retry orchestration; crash recovery; idempotent completion;
cancellation propagation; operational telemetry; production worker deployment; scanning
infrastructure; large-video processing; CI/CD hardening. The `tonde.jobs` **persistence foundation**
these will build on already exists (see B1) — do not build a second jobs system.

**Constitutional amendments recorded, not implemented here (product-direction decisions):**

1. **Production Kit terminology.** The creator's direction is "Production Kit" rather than the
   generic "Setup". The shipped vocabulary, schema and UI still use Setup. This is
   constitution/vocabulary territory, so it needs a deliberate amendment pass that updates
   `product/vocabulary.json`, the Constitution/glossary, a migration where the name is persisted,
   and the tests together — not a silent rename. **Recorded as pending, not hidden.**
2. **Music & Sound first-class direction.** For timed audiovisual work every relevant Production
   should have an Audio Plan (music purpose, cues, instrumentation, tempo, dynamics,
   diegetic/non-diegetic, silence, ambience, room tone, Foley, recording requirements), and for an
   existing song the production should map sections/energy/lyrics without casually replacing the
   song. Prompt 1–9 ships generic `sound`/`audio` fields on plans (including AI `audio.needed` and
   narration), but **not** a first-class canonical Audio Plan. The presence of `audio` jsonb does not
   mean this exists. **Recorded as a pending additive implementation.**
3. **Reference identity + creator purpose.** Every Reference should carry a first-class identity and
   the creator's stated purpose ("best reference moment" = best for *this creator's objective*), and
   TONDE must not invent title/identity metadata it cannot verify. Prompt 4 ships reference
   kind/role/state and Prompt 5–9 use references for understanding; the per-Reference
   identity/purpose model is **not** fully implemented. Recorded so Prompt 4 completion is not
   overstated.

## F. Creator actions

**2026-10-08 update: items 1, 3 and 5 were completed by the pre-Prompt 10 remediation and are no
longer outstanding. See the [Pre-Prompt 10 certification](pre-prompt10-final-certification.md).**

Genuine external/manual actions only. Nothing else is required for Prompts 1–9 to be internally
coherent.

1. **Hosted rollout of 015–025 — DONE (2026-10-08).** 015–027 were applied forward, 028 added the
   analysis completion pin, 029 repaired the `SECURITY INVOKER` guard defect the catalog comparison
   found, and 030 replaced the retryable conflict signal; 011–014 were reconciled as **history only**
   and never replayed. The ledger records **001–030** and the untruncated catalog comparison reports
   **0 differences over 4087 identities** (`hosted-ledger-030.log`, `hosted-final-diff.json`).
2. **Google OAuth and email/SMTP delivery** — implemented in code, unverifiable without provider
   credentials. BLOCKED. Real signup currently answers `HTTP 429 over_email_send_rate_limit` because
   the project requires email confirmation and declares no custom SMTP; Google is disabled with an
   empty `redirect_uri`.
3. **Complete hosted acceptance matrix — DELIVERED (2026-10-08), scoped to what needs no external
   provider.** The expanded two-user runner covers populated cross-tenant reads/writes/deletes, all
   145 RPCs, ten approval sets, the six private buckets and Auth session behaviour: **538 pass /
   1 blocked / 0 fail** (`hosted-acceptance-030.log`), with advisors re-run after the rollout at
   **0 ERROR**. What stays unaccepted inside this item is provider-backed behaviour (item 2) and
   live AI generation (item 4).
4. **Live AI/multimodal provider analysis** — a real external dependency. No model has ever produced
   a Shot Match finding; the deterministic path is fully implemented and tested. BLOCKED — REAL
   EXTERNAL DEPENDENCY.
5. **Hosted semantic schema diff — SUPERSEDED (2026-10-08).** Docker/Podman remain unavailable, so
   equivalence is established instead by rebuilding the local catalog in PGlite and comparing every
   **untruncated** identity (tables, columns, constraints, indexes, policies, triggers, function
   bodies, types, ACLs) against the hosted catalog through the Management API: **4087 identities,
   0 differences**, re-read from both sides rather than asserted
   (`scripts/pre-prompt10-catalog-verify.mjs`).

## Bottom line

Prompts 1–9 are internally coherent, regression-clean and migration-safe. One real database
integrity defect (model-profile foreign keys) was found and repaired additively in migration 025, one
genuine performance defect (per-Shot readiness recomputation) was measured and repaired in the same
migration with a bounded-behaviour test, one audit finding (missing `jobs` persistence) was proven
false, and the hosted migration record was reconciled into one authoritative matrix after the
contradictory statements were traced to their evidence. The pre-Prompt 10 pass then found and
repaired the guard defect (029) and the conflict transport (030), rolled the ledger forward to
001–030, and expanded hosted acceptance to 538 pass / 1 blocked / 0 fail. What remains is external:
real mail delivery, Google credentials, a plan that permits leaked-password protection, and a live
AI provider.
