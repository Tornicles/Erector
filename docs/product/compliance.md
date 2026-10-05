# Master Prompt 02 — Requirement Compliance

**Constitution:** 1.0.0 (2026-10-05).  
**Internal Prompt 2 requirements:** PASS as a locally implemented contract/test foundation, not complete hosted/runtime capability; historical dispositions below are superseded by the [current correction handoff](../prompt-2-correction-handoff.md).  
**Current hosted Prompt 1/2/3 acceptance / sequence advancement:** BLOCKED; see the [correction handoff](../prompt-2-correction-handoff.md). Older requirement dispositions below are the historical Prompt 2 report, not proof of current hosted readiness.  
**Meaning of PASS:** the requested Prompt 2 definition/contract/test foundation is implemented, not that every described future intelligence feature works.

## Complete requirement coverage

Each numbered Master Prompt 02 requirement is accounted for below. The grouped ranges cover every requirement 1–110 without omission. Policy-only obligations are deliberately identified; no future engine is falsely reported as implemented.

| Requirements | Status | Evidence / resolution |
|---|---|---|
| 1 | PASS local / BLOCKED hosted | Current correction reran local foundation suites and a scoped live two-user runner (39/39, scoped). Hosted history lists 001–008, but full semantic equivalence is unproven; local 009–010 are unapplied. `tonde` is exposed and anon table reads are denied; all six observed buckets are private, but only one bucket/resource slice is live-tested. Google is disabled and email delivery unverified; see the [correction handoff](../prompt-2-correction-handoff.md). |
| 2 | PASS | `constitution.md` is authoritative, conflict rule explicit; README/AGENTS/architecture reference it. |
| 3–5 | PASS | Constitution §1–2: canonical identity/promise/category/one Director, SHOW/UNDERSTAND/direct/execute/check/fix lifecycle. |
| 6 | PASS | §2 and §12 define Shot Match loop and future Prompt 9 implementation boundary. |
| 7–8 | PASS | §3 covers all target user categories and 24 production classifications; additive Product Film/Trailer and generated labels tested. |
| 9–13 | PASS | §4 defines one master/Real/AI/Hybrid separation; shared constants, DB/shared-plan/browser tests; no cloned master or third required face. |
| 14–19 | PASS | §2: reference sources, video/image/replacement/from-scratch/cultural workflows and original-work policy; no analyzer shipped. |
| 20–21 | PASS | §6: relevant material decisions only, three canonical collaboration choices; shared codes and application-confirmation tests. |
| 22–26 | PASS | §5/7: semantic Studio/timeline, reversible operations, granular timed dialogue/adaptive story; stable scene/shot/order tests. |
| 27–34 | PASS | §8: character/world/product/wardrobe/style locks, inheritance, compiled prompts and first/last frame; policy/dependency-version contract, future engine deferred. |
| 35–38 | PASS | §9: voice direction versus cloning, sound/performance/edit techniques; explicit voice consent contracts tested. |
| 39–44 | PASS | §10 responsibility matrix, glossary, generated areas and Setup/Asset categories; Settings excludes inventory; shell uses canonical labels. |
| 45–47 | PASS | §6: constraints, reality check and feasible alternatives; future reasoning policy, no invented recommendations. |
| 48–50 | PASS | §5: optional seasons/creator vocabulary, generate-ahead depth/horizons and scalable long-form; nullable hierarchy and 300-shot tests. |
| 51–53 | PASS | §9/11: performance, continuity, impact scope/actions; stable identities/contracts support later engines. |
| 54–56 | PASS | §11: human acceptance, independent locks, reversible history/branches. New DB guards reject system/service-role approval; preserve versions and detect accepted changes. |
| 57–61 | PASS | §4/12: actual Results, Reference/Plan/Result, two export actions, routing/optional generation; shared types and relational tests. Export/generation engines not built. |
| 62–64 | PASS | §13: modality/evidence truth, Observed/Estimated/Recommended, no false precision; grounded analysis/partial/uncertainty tests. Semantic truth still requires output evaluation. |
| 65–69 | PASS | §14: original-work, legitimate rights-controlled use, real-person/privacy/voice and source provenance; enum/consent contracts. Actual rights validity requires later service verification. |
| 70–72 | PASS | §12: accessibility readiness deliverables, real criteria not vanity percentage, structured inspectable production memory. Future implementation policy. |
| 73–74 | PASS | §16: explicit non-goals and production feature admission; decision checklist. |
| 75–79 | PASS | §6/11/15: specialized operations, structured scoped results, proposals/application, creator authority/evidence-based disagreement; backend contracts/tests. |
| 80–83 | PASS | Canonical glossary and §4/8/10; explicit storage mappings resolve job/production, shot/clip, world/environment, Setup/tool, Project/Production, Real/AI faces. Canonical information lives once. |
| 84–86 | PASS | §8/7/12: source-version/model snapshots, explicit mutation scope, searchable relational identities/query fields; operation result/proposal tests. |
| 87–88 | PASS | §10 area matrix and §1 executability success criterion; one Home input/action-queue policy. No later full Home UI introduced. |
| 89–90 | PASS | SQL enums + `product/vocabulary.json` generate TS/Python shared values; label coverage/staleness checks. Missing classifications and approval boundary fixed additively. No domain table renames. |
| 91–94 | PASS | Stable 32-invariant register, automated suites for enforceable current rules; §16 non-goals and V1 target versus optional/later. Policy-only rules labeled. |
| 95–99 | PASS | §13/15/17: eight-question decision framework, deterministic versus AI logic, structured state contracts, honest failure/partial behavior. |
| 100–101 | PASS | Version/date/revision history and amendment process; README/AGENTS/architecture/evolution links make authority discoverable. |
| 102 | PASS | No complete later UX or intelligence engine implemented. Only vocabulary/domain/guard/compliance alignment changes. |
| 103 | PASS | A–I: constitution/glossary/invariants/matrix/model/hierarchy/safety/non-goals/decisions in product docs. J: generated constants/types. K: database/frontend/backend/doc compliance tests. L: additive schema and shell-label/approval fixes. |
| 104–107 | PASS local / BLOCKED live regression | Implementation/test/root-cause/retest/regression executed. Clean and populated-upgrade migrations, RLS/Storage policy tests, frontend/backend checks, browser routes/Studio all pass. External checks not falsely passed. |
| 108 | PASS | Exact credential/provider blocker and subsequent verification steps documented below. Coding/type/schema errors repaired rather than designated blockers. |
| 109 | PASS handoff / Prompt 3 gate DEFERRED by owner decision (2026-10-05) | Prompt 2 handoff records locations/decisions/changes/schema/tests, local Prompt 1 regression and the gate deferral. Internal Prompt 2 is ready for Prompt 3; Google OAuth and email delivery stay BLOCKED and must be re-verified before full acceptance. |
| 110 | PASS | Constitution ends with the exact governing loop/principle and explicit conflict/amendment rule. |

## Evidence locations

- Human product authority: [Constitution](constitution.md), [Glossary](glossary.md), [Invariant register](invariants.md).
- Persistence: [vocabulary migration](../../supabase/migrations/202610050006_product_vocabulary.sql), [human acceptance migration](../../supabase/migrations/202610050007_human_acceptance.sql). Earlier migrations unchanged.
- Shared vocabulary: [source labels/codes](../../product/vocabulary.json), [generator](../../scripts/generate-database-types.mjs), generated TS and Python.
- Domain contracts: [product contracts](../../backend/app/domain/product.py), [service contracts](../../backend/app/services/contracts.py).
- Enforceable tests: [DB constitution](../../tests/database/constitution.test.mjs), [frontend constitution](../../frontend/src/test/constitution.test.ts), [backend constitution](../../backend/tests/test_constitution.py), [document coverage](../../tests/product/constitution.test.mjs); original foundation suites remain enabled.
- Final commands/results/limitations: [Prompt 2 handoff](../prompt-2-handoff.md).

## External acceptance gate — precise requirement and verification

A current read-only pass found hosted history 001–008 and canonical `product_film`/`trailer` enum values, but semantic migration equivalence/schema diff is blocked by missing Docker/Podman. Hosted authenticated acceptance is **39/39 for its stated narrow runner scope only**. It includes limited creator/service-role approval probes, but not comprehensive resource/bucket/approval-matrix acceptance. All six TONDE buckets are private; Google is disabled; email delivery is unverified. Local repair migrations 009–010 are not hosted; security advisor warnings remain. Overall is BLOCKED; see the [correction handoff](../prompt-2-correction-handoff.md). Do not treat previous gate deferral as acceptance.

After authorized configuration access is supplied:

1. Follow [Supabase reconciliation runbook](../supabase-runbook.md); inspect existing tables/policies/buckets/Auth/users/migration history and data retention before applying migrations.
2. Review hosted/local lineage 001–008 and locally tested pending repairs 009–010. Reconcile full schema drift/checksums, collisions and data impact before any authorized rollout. Keep `tonde_private` out of PostgREST exposure (migration 010 grants authenticated schema usage for policy execution, not API exposure or table privileges). Test clean AND populated upgrade migration paths; schedule any locking operations.
3. Preserve/review the now-existing ignored frontend/server environment files (matching dev URL/public key); never put service-role/secret in browser. Restart services after environment/configuration changes.
4. Confirm email/signup/verification/recovery and Google OAuth callbacks for the chosen application origin. No account provisioning is performed here.
5. With two real authenticated users, test bootstrap idempotence, user-token Data API CRUD/isolation, private uploads/signed access, approval guard, Studio default/save and backend `/api/ready`. Check anonymous/other-workspace rejection through actual Supabase HTTP.
6. Record results without secrets. Only then mark full Prompt 1/2 hosted precondition and unconditional Prompt 3 gate PASS.

## What tests cannot prove

Types/contracts cannot prove originality, legal consent/identity, a genuinely human gesture, exact reference optics, safe real-world execution, estimate quality or future AI correctness. The server must verify supplied evidence/version/authorization IDs and roles before future actions. `structured_output` is not authorized mutation state. Policy-only principles remain mandatory output/workflow review criteria as engines ship; contracts must not be mistaken for completed analysis/cloning/planning/export systems.
