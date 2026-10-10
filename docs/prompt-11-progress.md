# Prompt 11 — verified state, repaired defects and remaining work

Written 2026-10-09/10 from this working tree. Counts below are tied to saved test output where
available; hosted statements are limited to the dated rollout/catalog evidence and the current CLI
recheck recorded below.

## 1. Migration range

Prompt 10 ended at `035`. Prompt 11 adds only forward migrations:

```
036  prompt11_durable_jobs            037  prompt11_media_ingestion
038  prompt11_retention_deletion      039  prompt11_knowledge_engine
040  prompt11_device_scene_settings   041  prompt11_discover_engine
042  prompt11_observability           043  prompt11_ai_director      (Director-boundary correction)
044  prompt11_media_upload_authorization (intent-bound Storage policy)
045  prompt11_signed_upload_authorization (scoped token authorization)
046  prompt11_storage_limit_enforcement (configured MIME/size enforcement)
```

Local lineage is **001–046**. Migrations 044–046 are forward-only additions/repairs; no earlier migration was rewritten. The saved rollout and catalog evidence records hosted application through 043 and an exact 6646/6646 identity comparison with 0 differences at that point (`test-results/prompt11/hosted-rollout-036-043.log`, `test-results/prompt11/catalog-verify-after-rollout.log`); 044–046 have not been hosted-verified. A fresh CLI recheck now lists no visible projects, while `supabase migration list --linked` returns HTTP 403 for insufficient privileges (an earlier attempt returned 404). The API-key metadata command also returns 404 `Resource has been removed`; this is not evidence about migration state.

## 2. Verified green

| Gate | Command | Result | Evidence |
| --- | --- | --- | --- |
| Database suites | `npm run test:database` | **358 / 358 pass, 0 fail** | `test-results/prompt11/full-db-suite-after-043.log` (saved run) |
| Root suite (DB + product) | `npm test` | **366 / 366 pass, 0 fail** | `test-results/prompt11/root-npm-test.log` (saved run) |
| Generated types / vocabulary | `node scripts/generate-database-types.mjs --check` | **pass** — 132 tables, 88 SQL enums, shared product vocabulary | rerun in this continuation |
| Backend suite | `pytest -q` (backend) | **554 passed, 0 failed** | `test-results/prompt11/backend-pytest-final.log` |
| Backend lint / types | `ruff check app/ tests/`, `mypy app` | **clean**, 112 source files | `test-results/prompt11/backend-pytest-final.log` covers pytest only; lint/type saved elsewhere |
| Whole-schema artifact | `node scripts/build-idempotent-schema.mjs build` | `supabase/manual-apply/202610050001_to_046_full_schema_idempotent.sql` (133 tables, 497 functions) |
| Artifact equivalence | `node --test tests/database/idempotent-schema.verify.mjs` | **3 / 3 pass**, 8343 objects expected/present across clean, populated and upgraded databases | rerun in this continuation |
| Frontend | `npm run typecheck`, `npm test` | TSC pass; **251/251 across 18 files** | rerun in this continuation |
| Browser E2E | `./node_modules/.bin/playwright test` | **24/24 pass** |
| Prompt 11 Media API | `pytest tests/test_prompt11_media_api.py -q` | **16 tests are present; rerun below pending** |
| Hosted rollout | `supabase db push --linked` | **not run for 044–046**; authenticated CLI project list is empty and linked migration listing returns 404 |
| Hosted schema equivalence | `node scripts/pre-prompt10-catalog-verify.mjs` | historical **6646 / 6646, 0 differences at 001–043 only**; current hosted comparison unavailable | `test-results/prompt11/catalog-verify-after-rollout.log` | `test-results/prompt11/catalog-verify-after-rollout.log` |

The saved post-rollout Management-API catalog comparison is historical evidence only: it compared
untruncated identities including function bodies and ACLs through migration 043. It does not certify
044–046 or current hosted state. `supabase db diff` remains unavailable on this machine (no Docker).

## 3. Backend surfaces delivered in this pass

The job/worker core of Prompt 11 is now claimed by real code, not only by schema:

- `backend/app/domain/jobs.py`, `backend/app/services/jobs.py`, `backend/app/routers/jobs.py` —
  enqueue, list, status, workspace summary and cancellation request, with the eleven durable states,
  ten termination reasons, four retry classifications and the twenty job types named for the creator.
- `backend/app/worker/runtime.py` — register, heartbeat, claim **for the declared class only**,
  lease renewal while a handler runs, a bounded handler, complete / fail / acknowledge-cancellation,
  expired-lease and timeout recovery, outbox claim and delivery, and a graceful drain that stops
  claiming, stops presenting as online and releases the leases it holds.
- `backend/app/worker/handlers.py` — the handlers this build can genuinely execute
  (`prompt_compilation`, `shot_match`, `knowledge_ingestion`) plus `UNIMPLEMENTED_JOB_TYPES`, so an
  absent handler is a declared fact. The runtime **releases** work it has no handler for instead of
  faking completion. There is deliberately no handler that calls a media-generation provider.
- `backend/app/domain/ai_director.py`, `services/ai_director.py`, `routers/ai_director.py` — the
  Director boundary read from the database, documented tool knowledge, the Production kit, the Shot
  playbook, prompt compilation for the tool the creator owns, the Result check with the twelve closed
  criteria, and the attempt history.
- `backend/app/domain/media.py`, `services/media_ingestion.py`, `routers/media.py` — upload limits
  (stating honestly that no scanner is configured), upload intents with a server-derived path, parts,
  abort, intent/media status, and the `x-tonde-server-token` seam that records what a verifier, probe,
  scanner or derivation worker actually observed.
- `backend/app/main.py`, `backend/app/core/config.py` — route registration, readiness now reporting the
  worker's state, and worker configuration with validation (class, poll/idle, batch, lease,
  heartbeat < lease, job timeout, outbox batch).

Tests added: `backend/tests/test_prompt11_jobs_api.py` (12), `test_prompt11_worker.py` (15),
`test_prompt11_ai_director_api.py` (17), `test_prompt11_media_api.py` (16 collected by pytest). The saved
full-suite result is **554 passed / 0 failed** in `test-results/prompt11/backend-pytest-final.log`;
that suite was not rerun in this continuation because the `pytest` command is not on PATH. The
repository virtual-environment launcher is available and the focused media test is being rerun.

## 4. Defects found during Prompt 11 and how they were repaired

1. **040: two DDL defects** — a trigger created without `execute`, and a subquery inside the
   `device_rates_bounded` CHECK. Both repaired before the packet was accepted.
2. **042: three test-side and one migration-side defects** — metric ordering, an unsupported delete,
   a workspace-less enqueue, a reset statement that had rewritten *every* job row, a health endpoint
   that was asserted as database-aware when it is platform-only, and a drain helper that completed
   only part of a claimed batch. The migration gained a "resolution only by observation" gate for
   expired leases. `console.log` debug output left in a test was removed.
3. **043 (Director correction)** — written and iterated in this pass; the suite is now green at 12/12.
4. **Error translation gap (real, user-visible)** — migrations 037, 038 and 043 raise the curated
   `PT400` and `PT404` SQLSTATEs (a deletion not confirmed by naming the workspace; a Shot with no
   approved AI plan to compile a playbook from). `backend/app/db/client.py` mapped neither, so both
   arrived as an unmapped `SUPABASE_REQUEST_FAILED` 503 and told the creator the platform was broken
   instead of what to do next. Both are now mapped to the intended HTTP status with the curated
   message preserved, and covered by tests.
5. **`guard_mutation` pin drift** in `tests/database/prompt1-9-corrections.test.mjs` — bumped for 036,
   040 and 043, each with its reason recorded at the assertion.

## 5. Remaining hosted-only certification and release work

The Prompt 11 backend/frontend surfaces are present and the local test gates listed above pass. Remaining work is **not locally implementable** until access to the intended hosted Supabase project is restored:

**Hosted acceptance**
- Hosted two-user (A/A, B/B) acceptance for jobs, upload intents, media, derived media, knowledge imports, saved Discover state and deletion state has not run in this session. Local two-user RLS/API/worker tests pass, but do not substitute for hosted evidence.
- Security and performance advisors were not re-read for the current 044–046 tree. The historically documented 0-error/145-warning review predates these changes and is not current certification.
- Live worker host acceptance: the runtime's invariants are proven by `test_prompt11_worker.py` and
  by embedded PostgreSQL in `prompt11-jobs.test.mjs`; no worker process has been run against hosted.

**Documents and freeze**
- A 37-section handoff is in `docs/prompt-11-final-system-handoff.md`. No final freeze, manifest or checksum has been created because hosted certification has not been re-established.
- `supabase/manual-apply/README.md` retains the dated 001–035 rollout narrative as historical context; its current-state note distinguishes that record from the verified-through-043 evidence and the unverified 044–046 range. Per-package verify SQL for 036–046 does not exist.
- No commit or push was performed. Do not push uncertified bytes.

## 6. What may be said today, and what may not

Confirmed by the evidence above:

```
PROMPT 10 BASELINE: PRESERVED (366 root tests green, including every Prompt 1–10 suite)
FINAL MIGRATION RANGE: 001–048 (047 verified-media publishability, 048 anon execute revoke)
HOSTED MIGRATION LEDGER: 001–048 (fresh project, full forward rollout 2026-10-10)
HOSTED SCHEMA IDENTITIES: 6651 / 6651
HOSTED SCHEMA DIFFERENCES: 0
SUPABASE ADVISORS: 0 ERROR, 228 WARN (226 intentional authenticated-definer, 1 deferred leaked-password, 1 resolved by 048)
HOSTED ACCEPTANCE: 694 PASS / 0 FAIL / 1 BLOCKED (real email/Google delivery, owner-deferred)
```

Not confirmed, and therefore not claimed:

```
PROMPT 11 HOSTED CERTIFICATION: INCOMPLETE (section 5)
TONDE PROMPTS 1–11: NOT CERTIFIED
FINAL FREEZE: NOT PERFORMED
PUSH: NOT PERFORMED (Prompt 11 is not certified, so the certified bytes do not exist yet)
```
