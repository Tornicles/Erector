# System gap audit — Prompts 1 through 9

> **Superseded.** This audit was written while Prompt 9F/9G were still in flight. Its findings have
> been reconciled against the completed Prompt 9 tree by the Prompts 1–9 correction pass; the
> authoritative report is [system-gap-audit-prompt1-9-final.md](system-gap-audit-prompt1-9-final.md),
> which also records which findings here were confirmed, already fixed, or false/stale (notably the
> jobs finding, which was wrong: `tonde.jobs` has existed since migration 001).

Verification/peer session audit, 2026-10-07. Question from the creator: *"check the whole
system from prompt 1 to prompt 9 if anything is missing."* Method: every handoff's own claims
and limitations, the authoritative pass requirements in `docs/prompt-9-spec.md` (§217–§245),
the live repo (migrations, suites, surfaces), and a fresh non-colliding check snapshot.

> **STATUS UPDATE (2026-10-07, later the same day).** Prompt 9 has since **completed**:
> `MASTER PROMPT 9 — PASS` (full §236 gate green — pytest 397, vitest 220, Playwright 20, root
> 221, verifier 102/102). The creator then issued a consolidated Prompts 1–9 correction pass
> that reconciles this audit; **G1 below was a false finding and is corrected in place**, and
> G2 is resolved. The correction pass's own final audit
> (`docs/system-gap-audit-prompt1-9-final.md`) and correction handoff supersede this document
> where they disagree with it.
>
> **ADDITIONAL CREATOR DIRECTIVE (2026-10-07):** once the correction pass completes, also
> produce **one consolidated, idempotent Supabase migration file** (full chain, ignore-what-
> exists / apply-what's-missing semantics). Full spec: `docs/consolidated-migration-directive.md`
> — it slots into the §7 forward-deployment deliverable.

## Current snapshot (this session, exit codes captured)

| Check | Result |
|---|---|
| Backend `pytest` | **378 passed**, exit 0 (2 warnings) |
| Frontend `vitest run` | exit 0, all suites green |
| `tsc --noEmit` | exit 0 |
| `npm run verify:legacy` | clean, exit 0 |
| `git diff --check` | clean |
| `generate-database-types.mjs --check` | **exit 1 — failing** (expected: 9F in flight regenerates types as part of its DB pass; must be green at 9G per §236) |
| Root DB harness `npm test` | **not run this session** — Prompt 9F migration 024 + its test were being written during the audit; a concurrent run would collide with the pass harness. Last full green: 9E's sweep |
| Playwright E2E | not re-run (10 specs present; last full run 16 passed at 9D/9E sweep) |

## Per-prompt status

| Pass | Scope | Migration(s) | DB suite | E2E | Handoff | State |
|---|---|---|---|---|---|---|
| 1 | Auth, workspace isolation, schema/RLS, Setup, Assets, Media foundation | 001–008 (+009/010 hardening) | `foundation` | `foundation` | prompt-1 | **PASS local**; hosted scoped 39/39 + 40/40 |
| 2 | Constitution, canonical approvals/locks, result semantics, evidence labels, human authority | 001–007 | `constitution` | `foundation` | prompt-2 + correction | **PASS local**; hosted approval-matrix partial |
| 3 | Application shell, navigation, routes, visual system | — | (frontend) | `foundation` | prompt-3 | **PASS** (foundation scope) |
| 4 | Director Intelligence, Reference Analysis, Story/Script/Dialogue, Reality Check | 011–014 | `prompt4-intelligence` | `intelligence` | prompt-4-completion | **PASS local** |
| 5 | Studio, Scene/Shot editing, timeline, approvals foundation, locks | 015 | `prompt5-studio` | `studio` | **MISSING** (see gap G2) | **PASS local** (code + suites verified) |
| 6 | Real plans, Takes, pickup, Setup-aware execution | 016 | `prompt6-real-production` | `studio` | prompt-6 | **PASS local** |
| 7 | AI prompts, Character/World/Product Locks, Attempts, Results linkage, Hybrid | 017 | `prompt7-ai-creation` | `ai-creation` | prompt-7 | **PASS local**; 3 of my 6 review findings fixed (#2/#5 minor open, #6 open — see G3) |
| 8 | Acts, Sequences, long-form, Series, Episodes, Generate Ahead, Production Line | 018 | `prompt8-long-form` | `movie-mode` + `series` | prompt-8 | **PASS local** |
| 9A | Dependency graph, impact engine, stale artifacts | 019 | `prompt9a-dependencies` | `intelligence` | prompt-9a | **PASS** |
| 9B | Continuity engine | 020 | `prompt9b-continuity` | `continuity` | prompt-9b | **PASS** |
| 9C | Production Memory & structured search | 021 | `prompt9c-memory` | `memory` | prompt-9c | **PASS** |
| 9D | Versioning, branches, restore, merge, change impact | 022 | `prompt9d-versioning` | `versioning` | prompt-9d | **PASS** |
| 9E | Approvals, locks, readiness | 023 | `prompt9e-approval-readiness` | `readiness` | prompt-9e | **PASS** |
| 9F | Results, Shot Match, FIX THIS SHOT | 024 | `prompt9f-shot-match` | (spec pending) | — | **IN FLIGHT** (migration + DB test being written during this audit) |
| 9G | Full integration & certification | — | — | — | — | **NOT STARTED** — only 9G may declare `MASTER PROMPT 9 — PASS` (§243) |

Studio surfaces exist for every completed pass (`ProductionIntelligence`, `ProductionContinuity`,
`ProductionMemory`, `ProductionVersioning`, `ProductionReadiness`, plus Prompts 5–8's canvases);
9F adds Shot Match and 9G audits the full §142–§149 Studio integration.

## Concrete gaps

**Worth acting on before 9G certification:**

- **G1 — ~~§165 durable jobs do not exist~~ FALSE FINDING — CORRECTED.** The original claim
  ("No `jobs`/`outbox`/`queue` table exists in any of the 24 migrations") was wrong: my search
  pattern was case-sensitive (`CREATE TABLE`) while the migrations are lowercase SQL.
  **`tonde.jobs` exists from the foundation migration** (`202610050001_tonde_core.sql:399`) with
  the durable persistence foundation: job identity, 11 typed job kinds (incl. `shot_match`,
  `reference_analysis`, `transcription`, `export`), `job_state` status, progress 0–100,
  `attempts`/`max_attempts`, lease fields (`lease_owner`, `lease_expires_at`), scheduling
  (`available_at`), input/output object linkage and tenant-safe composite FKs — plus
  `tonde.exports` and `tonde.integration_connections` alongside it. What Prompt 9 §165/§223
  actually require of the shipped passes is honest synchronous labeling (verified — no pass
  pretends in-request compute is background work) against this persistence foundation.
  Transactional enqueue/outbox, dispatcher selection, atomic claiming, full lease lifecycle,
  retry orchestration, crash recovery and worker deployment remain **Prompt 11 scope by
  design** — do not build them early and do not create a duplicate jobs system.
- **G2 — ~~`docs/prompt-5-handoff.md` is missing~~ RESOLVED.** The handoff was reconstructed
  from the verified artifacts (migration 015, `prompt5-studio` suite, backend Studio layer,
  Studio frontend) with fresh scoped re-runs (backend 12 passed exit 0, frontend exit 0) — see
  `docs/prompt-5-handoff.md`.
- **G3 — migration 017 residual findings** (from `docs/peer-review-017-ai-creation.md`; three of
  six already repaired by the thread): **#6** `execution_plans.model_profile_id` /
  `fallback_model_profile_id` still lack foreign keys to `ai_model_profiles` (referential
  integrity); **#2** the `declare_ai_model` update path bumps the revision twice (separate
  `cost_known` update); **#5** `ai_creation_surface` calls `ai_readiness_state` ~3×/Shot
  (O(3N)). Package `08_` (017) is **still unapplied hosted** (hosted is at 001–010), so an
  amend-before-apply or additive-025 decision is available — the thread's call, per its
  forward-additive discipline.

**Minor / self-healing:**

- `generate-database-types.mjs --check` currently fails — repaired by each pass's regeneration;
  must be green in the 9G freeze (§236).
- `tests/database/prompt9f-shot-match.test.mjs` + migration 024 are mid-write; their pass is the
  thread's current work, not a gap.

## Creator-side external actions (no code can close these)

1. **Hosted migrations 011–023 unapplied** — packages `01_`–`14_` in `supabase/manual-apply/`,
   in order, each followed by its `verify` (every row `OK`); the 024 package follows 9F.
   Never replay 001–010. (Hosted apply is required before any hosted-acceptance claim.)
2. **Google OAuth + email/SMTP delivery** — implemented in code, unverifiable without provider
   credentials (BLOCKED per handoffs; never reported as PASS).
3. **Full hosted acceptance matrices** — all six buckets, all resources, comprehensive approval
   matrix: scoped runners (39/39, 40/40) cover a subset only.
4. **Live AI provider acceptance** — deferred by creator decision (system verified working
   without providers; see `docs/external-api-independence-audit.md`).

## Bottom line

Nothing material was missing from the implemented system through 9E; Prompt 9 has since been
certified complete (`MASTER PROMPT 9 — PASS`). Of this audit's original findings: G1 was a
false finding (corrected above — the jobs foundation exists), G2 is resolved (handoff written),
and G3's residual 017 items are being reconciled by the creator's correction pass
(§4A–§4C: additive 025+ for the model-profile FKs if confirmed, reproduction for the double
revision bump and the O(3N) readiness surface). Creator-side external actions are unchanged.
