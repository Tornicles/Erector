PRE-PROMPT-10 CERTIFICATION: BLOCKED

# PRE-PROMPT-10 Certification (Prompts 1–9): implementation complete, two external prerequisites open

> **Later state (dated note, 2026-10-08).** This report certifies **Prompts 1–9** at Constitution **1.1.0** and keeps that meaning. Prompt 10 then completed on top of it and amended the constitution to **1.2.0** (§21 Amendment D, INV-40–INV-48); the current record is the [Prompt 10 completion handoff](prompt-10-completion-handoff.md). The two external prerequisites below (email delivery, Google sign-in) are still open and are now owner-deferred, not repaired here.

**Scope:** Prompts 1–9 (foundation through Prompt 9G) plus the pre-Prompt 10 remediation they require.
Prompt 10 (exporters, media import framework, integrations/billing) and Prompt 11 (durable
queue/outbox, telemetry, deployment hardening) were **not** started, and no attempt was made to start
them.

**Why `BLOCKED` and not `PASS`:** every implementation-side blocker is now closed — both internal
defects found in this pass are repaired, verified locally and hosted, and the expanded hosted
acceptance suite runs green — but the launch-required Auth flows cannot be proven from inside this
checkout. Real signup currently answers `HTTP 429 over_email_send_rate_limit` because the project
requires email confirmation and declares no custom SMTP, Google sign-in is disabled with an empty
`redirect_uri`, and leaked-password protection is refused with `HTTP 402` (plan-gated). Those are
external prerequisites, not code defects. **Nothing here may be read as a claim that real signup,
verification mail, password-reset mail or Google sign-in work.**

**Certified revision.** Branch `main`, HEAD `b1499ae` (no commit, no push, no staging — shared working
tree). The frozen manifest is
[final-manifest.json](../test-results/pre-prompt10/final-manifest.json) and its digest is in
[final-manifest.sha256](../test-results/pre-prompt10/final-manifest.sha256); the digest lives in that
evidence file rather than being restated here so that editing this report cannot silently invalidate
the value it quotes.

## 1. Blocker A — the stale-approval HTTP hang: root cause and repair

**Symptom.** `POST /rest/v1/rpc/approval_decide` with a superseded `expected_revision` never returned
over hosted HTTP (no answer within 20 s, 30 s, 60 s in successive runs), while the identical statement
with identical claims completed in ~2.5 s end-to-end when executed directly through SQL and raised
`40001: That object changed since you loaded it`.

**How the boundary was proven, not assumed.**

1. A raw one-shot connection (`node:http`, `agent:false`, `Connection: close`) hung exactly like the
   pooled `fetch` path, so the hang was not client connection reuse
   (`blocker-a-transport.json`: fresh 260 ms, stale 25 s, raw stale 25 s).
2. Sampling `pg_stat_activity` while the request was outstanding found **no query and no lock wait**
   for it — only the PostgREST listener idling on `LISTEN "pgrst"`. The statement was not blocked; it
   was being **re-issued** (`blocker-a-diagnosis.json`).
3. `Supabase`'s own troubleshooting page states the mechanism: a custom `raise ... using errcode =
   '40001'` tells PostgREST the failure is transient, so it retries the transaction indefinitely —
   present in PostgREST 14, fixed in 16 — and the documented remedy is a code that maps to the
   intended HTTP status (`PTxxx` → HTTP xxx).

**Root cause.** TONDE raised SQLSTATE `40001` for optimistic-concurrency conflicts in **53 places
across 15 migrations**. That is correct product semantics and the wrong transport signal: over
PostgREST the conflict became an infinite retry loop, one API call became several transactions, and
the request never returned. Every stale-revision path in the product was affected, not only approval.

**Repair — `supabase/migrations/202610050030_conflict_sqlstate.sql`** (forward-only; 029 and every
earlier migration untouched). Generated mechanically by
[scripts/build-conflict-sqlstate-migration.mjs](../scripts/build-conflict-sqlstate-migration.mjs) from
the applied definitions, never hand-assembled: **44 functions re-defined, 51 conflict raises
converted to `PT409`**, with bodies, messages, security mode, `search_path` and ACLs otherwise byte for
byte identical. Product law is unchanged — a stale revision is still refused, nothing is applied, no
newer state is overwritten, and the caller is told to reload.

| Evidence | Before | After |
| --- | --- | --- |
| Hosted stale approval over HTTP | no response in 60 s (`stale-approval-timing.json`) | **HTTP 409 `PT409` in 187 ms / 137 ms** (`stale-approval-timing.json`, re-run) |
| Hosted fresh approval / reopen | 144 ms / 426 ms | 145 ms / 278 ms (unchanged) |
| Looping `authenticator` backends | retry loop per request | none (only the idle listener) |
| `21_verify.sql` hosted | — | 5/5 `OK`, 0 `MISSING` |
| Expanded hosted acceptance | 34 PASS / 1 FAIL (aborted at the hang) | **538 PASS / 1 BLOCKED / 0 FAIL** |
| Local regression | — | `no live function raises the retryable conflict code and a stale write is refused as PT409` |

Clients follow the code: `backend/app/db/client.py` maps `PT409` (and the historical `40001`) to
`STUDIO_CONFLICT`/409, and `frontend/src/services/errors.ts` now classifies `PT409`, `40001` and
status 409 as a conflict so the Studio offers "Reload latest" instead of a generic failure.

## 2. What this pass also repaired

| # | Change | Why | Evidence |
| --- | --- | --- | --- |
| 1 | `202610050029_guard_definer_repair.sql` | `guard_mutation` and `guard_human_acceptance` were the only `SECURITY INVOKER` trigger functions calling `tonde_private` helpers, which only `authenticated` may execute; because PostgreSQL may evaluate an `AND` operand out of order, **every write by any other role failed** with `permission denied for function is_workspace_member` on 81 guarded tables, so the server role could not write the durable-jobs foundation at all | new local regression; `20_verify.sql` 7/7 `OK`; server-role probe 403 → 201 |
| 2 | Reference identity/purpose, versioned Audio Plan, per-Scene Music/Sound Direction (026) | Constitution 1.1.0 Amendments A–C must be real persistence, not vocabulary | `prompt4-intelligence.test.mjs`, `prompt1-9-corrections.test.mjs` |
| 3 | Reference history capture, enclosing-scope locks, own-lock-only derived artifacts, observed-evidence media checks (027) | a Reference edit left no version row; a locked Scene/Production did not protect direct hierarchy or audio writes; derived plans could hide source staleness; a citation could turn unavailable media into an `observed` claim | `prompt1-9-corrections.test.mjs`, `prompt9g-integration.test.mjs` |
| 4 | Analysis completion pin (028) | a slow worker could complete against a superseded identity revision | `prompt1-9-corrections.test.mjs`, `prompt4-intelligence.test.mjs` |
| 5 | `scripts/pre-prompt10-catalog-verify.mjs` | the earlier comparison concatenated PostgreSQL `name` types, silently truncating function identities to 63 characters — a truncated comparison proves nothing | 4087 untruncated identities, `hosted-final-diff.json` |
| 6 | Expanded acceptance runner: populated fixtures, ten approval sets, signed-URL downloads, anonymous storage denial | the earlier table probes ran against **empty** tenant tables and covered one approval object | `hosted-acceptance-030.log` |

## 3. Final gate results

| Gate | Result | Evidence |
| --- | --- | --- |
| Root `npm test` (database + product) | **230/230 pass** (was 229; +1 new transport regression), re-run after the final documentation edit | `g030-root.log`, `final-root.log` |
| `generate-database-types.mjs --check` | pass — 82 tables, 67 enums | `final-generator-check.log` |
| `build-idempotent-schema.mjs --check` | pass — `001_to_030`, 83 tables, 270 functions | `g030-artifact-check.exit` = 0 |
| Idempotency proof (complete, historical 001–014, empty, populated 001–018 upgrade, artefact query) | **3/3 pass** | `g030-idempotency.log` |
| `verify:legacy` | pass | `final-legacy.log` |
| Frontend typecheck / build / Vitest | pass / pass / **220/220** | `g030-fe-typecheck.exit`, `g030-fe-build.exit`, `g030-fe-vitest.log` |
| Playwright (Chromium) | **20/20 pass** | `g030-playwright.log` |
| Backend pytest | **398 passed** | `g030-pytest.log` |
| Backend mypy / ruff | pass — 75 files / `All checks passed!` | `g030-mypy.log`, `g030-ruff.log` |
| Hosted ledger | **001–030** | `hosted-ledger-030.log` |
| Hosted catalog equivalence (untruncated, incl. bodies, security mode and ACLs) | **4087 identities, 0 differences** | `g030-catalog.log`, `hosted-final-diff.json` = `[]` |
| Hosted `21_verify.sql` | **5/5 `OK`, 0 `MISSING`** | `hosted-verify030.log` |
| Hosted advisors | **0 ERROR**; 145 WARN `authenticated_security_definer_function_executable`, 1 WARN leaked-password protection, 125 INFO unindexed FKs, 21 INFO unused indexes, 1 INFO `rls_enabled_no_policy` | `g030-advisors.json` |
| Expanded hosted acceptance | **538 pass, 1 blocked, 0 fail** | `hosted-acceptance-030.log` (re-executed for the Prompt 10 entry check, same result) |
| Auth contract that needs no inbox | **5 pass, 2 blocked, 0 fail** | `auth-acceptance-4.log`, `auth-acceptance.json` |
| Manifest | re-taken after the last edit of any kind; delta from the gate-bearing state is documentation plus re-run verification scripts, recorded per gate in `gate-coverage.json` | `final-manifest.sha256` |

## 4. Advisors: reviewed, not mass-fixed

* **145 `authenticated_security_definer_function_executable`** — all are TONDE's own RPC surface,
  reachable only by `authenticated`, each performing its own workspace authorization, with `anon`
  denied and `search_path` pinned. Verified per family: no `anon` EXECUTE, no service-role EXECUTE on
  the approval or audio RPCs (`20_verify.sql`, `21_verify.sql`), cross-tenant calls denied across all
  145 RPCs, and the server role still cannot manufacture an approval. **Intentional warning, not a
  defect.**
* **125 INFO unindexed foreign keys** — reviewed against the real access paths (Studio loading,
  Scene/Shot ordering, Director operations, Real Production, AI Creation, series/long-form, Results,
  continuity, dependencies, approval/history, Shot Match). Every Prompt 1–9 query path is
  workspace-and-production scoped through indexed keys; adding 125 indexes would be unjustified churn
  before Prompt 10, and the acceptance run demonstrably exercised three previously unused indexes
  (24 → 21 unused). **No index added; the finding stands as reviewed.**
* **1 INFO `rls_enabled_no_policy`** — `tonde_private.integration_credentials`, intentionally
  unreachable (no client grants, no PostgREST exposure).
* **1 WARN leaked-password protection** — see below; **external**.

## 5. Blocking prerequisites (external only)

1. **Mail capacity.** The project requires email confirmation (`auth.email.enable_confirmations = true`)
   and declares **no custom SMTP**, so a real signup is normally stopped with
   `HTTP 429 over_email_send_rate_limit` (shared-mailer budget, observed again in `auth-acceptance-4.log`).
   When the budget is available the request proceeds and is instead refused by the provider's address
   validation (`HTTP 400 email_address_invalid` for a reserved probe domain, observed in
   `entry-auth.log`) — both are external limits, and neither delivers mail. Required: SMTP
   host/port/user/password and a verified sender identity, then a delivered
   verification email, a delivered reset email, and the corresponding callback completions.
2. **Google sign-in.** `external_google_enabled = false` with an empty `redirect_uri`. Required: OAuth
   client id/secret plus the Supabase and application callback URLs registered, then a full
   callback round-trip including duplicate-workspace protection on a returning login.
3. **Leaked-password protection.** `PATCH /v1/projects/{ref}/config/auth {"password_hibp_enabled": true}`
   is refused with **HTTP 402** (plan-gated), and the setting is outside the CLI's compared config
   schema. Required: a plan that includes it, or an explicit acceptance of the warning.

Verified meanwhile, so that "blocked" is precise rather than blanket: signup is rate-limited by mail
capacity and hands out no session before verification; an unverified or absent address obtains no
session; password reset answers identically for known and unknown addresses; a forged recovery token
cannot change a password; Google is genuinely disabled rather than silently misconfigured; and a
confirmed account signs in and is bootstrapped to exactly one workspace.

## 6. Retained failures, disproved hypotheses and superseded claims

Kept deliberately; earlier passes are not passes for these files.

1. **The guard defect (repaired).** First seen as `Controlled jobs fixture HTTP 403 42501`. Two
   hypotheses were recorded and disproved: that the server key was misconfigured, and that
   `guard_mutation` could only reach the `profiles` branch. Evidence retained:
   `hosted-populated.log`, `hosted-populated-retry.log`, `jobs-privilege-probe.log`,
   `jobs-trigger-probe.log`, `invoker-guard-audit.log`, local reproduction `local-service-probe.mjs`.
2. **The hang (repaired).** Four wrong turns are on record: client connection reuse (disproved by the
   raw-socket run), PostgreSQL lock contention (disproved by `pg_stat_activity`), a database-semantics
   defect (disproved by the fast SQL run), and a Supabase platform bug in general — the last one was
   only half right, and the vendor page named the exact mechanism and remedy.
3. **My own generator bug.** The first two runs of the 030 generator silently skipped functions: a
   global-flag regex leaked `lastIndex` between statements, and comment stripping ran before `trim()`
   so a blank line defeated it. Both are why the output went from 17 functions to the correct 44 —
   the counts and the affected-function list are in `build-conflict-sqlstate-migration` output.
4. **Truncated comparison (repaired).** An intermediate catalog comparison reported `0 differences`
   while function identities were truncated; it became convincing only after the `::text` casts.
5. **Trigger-count error (corrected).** A first draft of the new guard test asserted 82 guarded
   triggers; the real number is 81 (68 `guard_mutation` + 13 `a_human_acceptance`), and the test now
   pins that composition.
6. **Workspace-archive cleanup (repaired).** The first expanded runner tried to archive a workspace,
   which the product does not permit for `authenticated` (403); the repair archives the controlled
   Production, and the two earlier `FAIL` runs are retained (`hosted-expanded.log`,
   `hosted-expanded-retry.log`).
7. **Auth probe noise.** The first signup probe recorded a bare `HTTP 400` and then a transient
   `fetch failed`; both runs are retained (`auth-acceptance.log`, `auth-acceptance-2.log`) because the
   clean third run is what established the `429 over_email_send_rate_limit` finding.
8. **Baseline defects repaired earlier in the pass:** stale generated artefacts and three missing
   functions, two frontend type errors, and Director reference-pinning gaps
   (`focused-python-reference.log`, `repaired-root.log`).
9. **Stale freeze (repaired).** The first capture at the end of the 030 work predated migration 030
   (it still listed the removed `001_to_029` artefact and none of the 030-era files), its recorded
   digest did not match its own bytes, and it was never re-taken after the gates; two evidence logs
   (`final-generator-check.log`, `final-legacy.log`) were likewise pre-030. The checks were re-run,
   the pre-030 capture is retained as `superseded-final-manifest-pre030.json`, and the manifest was
   re-taken last — after every edit — with `gate-coverage.json` recording which files changed after
   each gate and why that is safe. It was caught by re-deriving the capture rather than trusting its
   name; an earlier read of the same file did not reveal it.
10. **Present-tense hosted claims in earlier documents (repaired additively).** A final scan found
   documents still describing the hosted project in the present tense with pre-030 readings: the
   compliance report (ledger 001–008, 009–010 unapplied, the Prompt 2 reading of "Overall is
   BLOCKED"), the acceptance log ("current local migration versions are 001–010"), and the Prompt 1,
   Prompt 2, Prompt 2-correction, Prompts 1–9 correction, 9D, 9E, 9F and 9G handoffs, the
   pre-Prompt 10 amendment handoff and the consolidated migration directive (001–010 / effects
   001–014 / 015–025 outstanding). Their history was **not rewritten**: each received the same dated
   supersession banner naming the verified 001–030 state, and the two documents the documentation
   test and the current runbook treat as live (the compliance report and the acceptance log) had
   their current-state sentences corrected while keeping every numbered requirement row, the
   `BLOCKED hosted` label and the two-real-authenticated-user gate text the document test pins. In
   the same way the Prompts 1–9 audit's dated C0 section already superseded its migration matrix,
   but its section F still listed the hosted rollout and the semantic diff as outstanding; both are
   now marked done or superseded in place with the evidence named. The   earlier decision to leave these documents untouched is exactly what made this a defect rather than a known
   absence.
11. **Auth probe misclassification (repaired).** The Prompt 10 entry re-check ran the Auth contract
   script and got a **FAIL** on its signup probe: the probe address used a reserved probe domain, and
   with the shared-mailer budget available the provider validates the address and refuses it
   (`HTTP 400 email_address_invalid`) before the mail path runs. The probe treated that provider-side
   refusal as a product failure. Both responses were retained as evidence (`entry-auth.log`: 400
   `email_address_invalid`; `auth-acceptance-4.log`: 429 `over_email_send_rate_limit` for the same
   reserved address minutes later), which shows the ordering is decided by external mailer state, not
   by TONDE. The probe now uses a deliverable-shaped address for the mail-path assertion and records
   the reserved-domain response as a scored-exempt observation; the product assertions are unchanged.
   Re-run result: **5 pass, 2 blocked, 0 fail** (`auth-acceptance-4.log`, exit 2 = blocked-only).

## 7. Prompt 10 entry re-verification (2026-10-08, independent re-run)

Re-derived for the Prompt 10 entry gate rather than trusted from the previous summary. Every row is a
fresh execution; the tree was already frozen when these ran (`gate-coverage.json`, 19 gates, 0 stale).

| Fact | Re-run result | Evidence |
| --- | --- | --- |
| Stale approval over hosted HTTP | **409 `PT409` in 171 ms**, second stale attempt 135 ms — no hang, deterministic | `entry-timing.log`, `stale-approval-timing.json` |
| Fresh approval / reopen | 200 in 338 ms / 200 in 122 ms | same |
| Migration 029 behaviour intact | service role inserts server-owned jobs **201** (minimal + representation); `authenticated` insert denied **403 42501**; `21_verify.sql` **5/5 OK** | `entry-service-role.log`, `entry-verify21.json` |
| Human authority, no retryable conflict code | **8/8** incl. 81 guards, server role cannot manufacture an approval, no live function raises `40001` | `entry-corrections.log` |
| Hosted ledger | **001–030** | `entry-ledger.log` |
| Hosted schema drift | **4087 local = 4087 hosted, 0 differences** (untruncated, incl. bodies and ACLs) | `entry-catalog.log`, `hosted-final-diff.json` |
| Expanded hosted acceptance | **538 PASS / 1 BLOCKED / 0 FAIL** (exit 2 = blocked-only) | `hosted-acceptance-030.log` |
| Generated types / full-schema artifact | `--check` clean — 82 tables, 67 enums; 270 functions | `entry-generator.log`, `entry-artifact.log` |
| Backend pytest / mypy / ruff | **398 passed**; mypy clean over **75 source files** (the config-correct `mypy` invocation — `mypy app` alone scans 74 and would under-report); ruff `All checks passed!` | `entry-pytest.log`, `entry-mypy.log`, `entry-ruff.log` |
| Frontend typecheck / build / Vitest | clean / clean / **220/220** (16 files) | `entry-tsc.log`, `entry-build.log`, `entry-vitest.log` |
| Playwright (Chromium) | **20/20** | `entry-playwright.log` |
| Auth contract without an inbox | **5 PASS / 2 BLOCKED / 0 FAIL** (exit 2 = blocked-only) | `auth-acceptance-4.log` |
| Root database + product suites | **230/230** | `final-root.log` |
| Freeze integrity | 19 gates, 0 stale, 0 unclassified post-gate changes | `gate-coverage.json` |

The staged-files check found nothing staged and HEAD unchanged (`b1499ae`). No internal defect
remains; the entry gate is blocked by the three external prerequisites in section 5.

## 8. What would move this to PASS

SMTP credentials and a controlled inbox proving delivered verification and reset messages; Google
credentials proving the callback round-trip; and a plan that permits leaked-password protection (or a
recorded product decision to accept the warning). Then re-run every gate in section 3 against a frozen
revision with no later edits and re-take the manifest — a pass computed before an edit does not cover
the edited bytes. **READY FOR PROMPT 10: NO** until those are met.
