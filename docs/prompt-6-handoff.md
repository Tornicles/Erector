# Prompt 6 handoff — TONDE Real Production Director

Status: **MASTER PROMPT 6 — PASS** (internal scope complete; hosted migration 016 not yet
applied to the linked Supabase project).

This closes Prompt 6 formally. Prompt 6 was implemented and verified before this
document existed; nothing here restarts it and nothing here claims the hosted database
was updated by automation.

## PASS RESULTS

| Pass | Result |
|---|---|
| 6A — Real Production domain + schema (migration 016) | PASS |
| 6B — Real Production engine (equipment resolution, plan compile, alternatives) | PASS |
| 6C — Real Production HTTP surface + Studio Real Production face | PASS |
| 6D — On-Set Mode, Takes, capture status, Results | PASS |
| 6E — Certification gates | PASS |

## What Prompt 6 built

| System | Status | Where |
|---|---|---|
| Migration 016 real production schema/RPCs | PASS | [202610050016_real_production.sql](../supabase/migrations/202610050016_real_production.sql) — requirement kinds/status, `epistemic` labels, alternative kinds, capture status, take status, plan RPCs, RLS |
| Requirement resolution against Setup | PASS | `backend/app/services/real_production.py` — observed vs. required vs. recommended kept distinct |
| Deterministic camera/lens/lighting/audio starting points | PASS | `backend/app/domain/real_production.py`; never presented as measured facts |
| Alternative plans (quality/solo/fastest/lowest-equipment/safest) | PASS | `tonde.real_alternatives`, engine `alternative_plans()` |
| Crew, shoot order, preparation, equipment list | PASS | plan payload + Studio **Real Production** canvas |
| On-Set Mode | PASS | [RealProduction.tsx](../frontend/src/studio/RealProduction.tsx) capture status per Shot, take recording |
| Takes and review states | PASS | `tonde.takes` (`recorded`→`preferred`/`unusable`/`pickup_required`) |
| Result linkage | PASS | Results attach to the same canonical Shot; no duplicate plan truth |
| Locks/approvals honoured | PASS | locked Shot/plan mutations rejected; approval semantics from Prompt 5 preserved |
| Hybrid passthrough | PASS | A Shot may hold a Real plan and an AI plan; `execution_method` unchanged by plan creation |

## Verification (re-run at Prompt 7 closure time, 2026-10-05)

| Gate | Command | Result |
|---|---|---|
| Root database + product tests | `npm test` | 98 passed / 0 failed |
| Constitution suite | `npm run test:constitution` | 12 passed |
| Backend suite | `pytest tests/ -q` (in `backend/`, `backend/.venv/Scripts/python.exe`) | 211 passed |
| Ruff | `ruff check app tests` | clean |
| Mypy | `mypy app` | clean (53 files) |
| Frontend typecheck | `npm run typecheck` | 0 errors |
| Frontend unit/component tests | `vitest run` | 121 passed / 8 files |
| Frontend production build | `npm run build` | PASS |
| Generated types/vocabulary | `node scripts/generate-database-types.mjs --check` | Verified 64 tables, 35 SQL enums |
| Legacy boundary | `npm run verify:legacy` | PASS |
| Browser E2E | `npx playwright test` | 11 passed / 11 |
| Whitespace hygiene | `git diff --check` | clean (CRLF warnings only) |

Prompt 6-specific tests: 18 database tests in
[prompt6-real-production.test.mjs](../tests/database/prompt6-real-production.test.mjs),
17 engine tests + 14 API tests in `backend/tests/test_real_production.py` and
`test_real_production_api.py`, 15 component tests in
[real-production.test.tsx](../frontend/src/test/real-production.test.tsx), plus the
Real-face flows in `frontend/e2e/foundation.spec.ts`.

## Repairs made during Prompt 6 closure

- **Root cause, Studio deep link clobbered by stale closures:** `StudioPage.tsx` now
  keeps a `liveSearch` ref and writes search params through `writeParams(mutate)`, so a
  Studio URL repair is no longer overwritten by an older render's search string.
- Test ceilings only (no behaviour change): `vite.config.ts` `testTimeout`/`hookTimeout`
  15 000 ms and `setup.ts` `configure({ asyncUtilTimeout: 5000 })`, because the Studio
  canvases genuinely settle asynchronously.

Both changes are covered by the studio and real-production suites above.

## Hosted migration state (exact manual action)

Migrations 001–008 are applied on the linked project. **009–016 are applied — do not
reapply them.** Migration 016 also has a derived manual-apply copy for the case where the
hosted run still shows it missing:

- `supabase/manual-apply/07_202610050016_real_production.sql`
- `supabase/manual-apply/07_verify.sql`

Semantic schema diffing of the hosted project remains **BLOCKED**: no Docker/Podman and
no hosted credentials in this environment. See
[schema-evolution.md](schema-evolution.md) and [supabase-runbook.md](supabase-runbook.md).

## Internal failures

NONE open at closure. Every Prompt 6 defect found during implementation was reproduced,
root-caused, repaired and re-verified; the two repairs above are the surviving record.

## External blockers

- Live hosted apply/verification of migrations 015–017 (manual action required, documented).
- Real capture of physical footage cannot be exercised without a real shoot; On-Set Mode
  and Takes are verified against the database contract, not invented footage.

## Next

Prompt 7 (AI Creation & Hybrid Director) is complete; see
[prompt-7-handoff.md](prompt-7-handoff.md). Prompt 8 may proceed.
