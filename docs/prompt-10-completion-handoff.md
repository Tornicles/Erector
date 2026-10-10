# Prompt 10 completion handoff — integrations, exports, publishing, billing, commercial operations

**Date:** 2026-10-08. **Constitution:** 1.2.0 (2026-10-08). **Migration range:** 001–035.
**Status:**

```
PROMPT 10 IMPLEMENTATION: PASS
EXTERNAL PROVIDER ACCEPTANCE: DEFERRED BY OWNER
INTERNAL DEFECTS REMAINING: 0
HOSTED SCHEMA DIFFERENCES: 0
READY FOR PROMPT 11: YES
```

This document is the authoritative completion record for Prompt 10. The packet-by-packet history is in
[prompt-10-progress.md](prompt-10-progress.md); the shared product laws are in the
[constitution](product/constitution.md), the [invariant register](product/invariants.md), the
[glossary](product/glossary.md) and [compliance.md](product/compliance.md).

## 1. Packets completed

| Packet | Scope | Migration | Record |
| --- | --- | --- | --- |
| 031 | Integrations: provider registry, declared capabilities, connection truth, server-only OAuth state, capability-state answer | `202610050031_prompt10_integrations.sql` | §1–14 |
| 032 | Publishing: publications pinned to an exact version, append-only creator authorizations, idempotent submission attempts, `UNKNOWN_REMOTE_STATE` reconciliation | `202610050032_prompt10_publishing.sql` | §15–23 |
| 033 | Exports: two distinct products, the REQUESTED→BUILDING→READY\|FAILED→EXPIRED lifecycle, the manifest law, closed client read path for `tonde-exports` | `202610050033_prompt10_exports.sql` | §24–30 |
| 034 | Billing: entitlements and grants, plans and checkout intents, subscription events from verified receipts, usage reservations/commit/release, separated cost meanings, webhook receipts | `202610050034_prompt10_billing.sql` | §31–47 |
| 035 (backend) | Real export builders (PDF 1.4 / OOXML DOCX), pinned reconstruction, manifest, entitlement gate, rate limiter, retry taxonomy | none (backend code) | §27–30, §55–56 |
| 035 (migration, repair) | `publication_reconcile` authorization before lookup — the one real defect found, repaired forward | `202610050035_prompt10_reconcile_guard_order.sql` | this document §10 |
| 036 | Hosted rollout 031–035, catalog equivalence, two-user acceptance, advisors | — | §11–13 |
| 037 | Prompt 10 frontend verification (typecheck, Vitest, build, Playwright) | — | §5 |

Plus the versioned constitutional amendment (Constitution 1.2.0, §21 Amendment D) described in §9.

## 2. Final migration range and artifacts

- Ledger and lineage: **001–035**, applied in order, nothing replayed, nothing reset. 011–014 stay the
  history-only reconciliation described in the [runbook](supabase-runbook.md).
- `supabase/manual-apply/202610050001_to_035_full_schema_idempotent.sql` — the whole schema in one
  state-tolerant file: **35 migrations, 1535 statements, 98 tables, 320 RPCs, 86 types, 43 policies,
  111 indexes**; `--check` exit 0. The superseded `_to_034` artifact was removed, not left stale.
- Idempotency proof `tests/database/idempotent-schema.verify.mjs`: **3/3** on the rebuilt artifact.
- Migration 035 is a forward repair of an applied migration's function, never a rewrite: only
  `tonde.publication_reconcile` is re-defined, with identical behaviour, messages, security mode,
  `search_path` and ACLs, then its grants are re-asserted.

## 3. Backend

- New Prompt 10 routers registered in [main.py](../backend/app/main.py): integrations (11 routes),
  publishing (11), billing (14), exports (7) — **43 client routes**, all under
  `/api/v1/workspaces/{workspace_id}`.
- Services: [integration_adapters.py](../backend/app/services/integration_adapters.py),
  [integrations.py](../backend/app/services/integrations.py),
  [publishing.py](../backend/app/services/publishing.py),
  [billing_providers.py](../backend/app/services/billing_providers.py),
  [billing.py](../backend/app/services/billing.py),
  [export_builder.py](../backend/app/services/export_builder.py),
  [exports.py](../backend/app/services/exports.py),
  [entitlements.py](../backend/app/services/entitlements.py),
  [rate_limit.py](../backend/app/services/rate_limit.py), with domain vocabulary and laws in
  [integrations.py](../backend/app/domain/integrations.py),
  [publishing.py](../backend/app/domain/publishing.py),
  [commercial.py](../backend/app/domain/commercial.py),
  [billing.py](../backend/app/domain/billing.py).
- Providers live behind adapter interfaces. A provider whose adapter exists in code but was never
  exercised against the real service is `adapter_state = 'implemented'`; enabling a capability requires
  an adapter, and a **connected** destination account requires an enabled provider with a `verified`
  adapter, enforced by trigger `tonde_private.guard_integration_connection`.
- No credential is stored in TONDE: provider configuration refuses secret-shaped keys, and the private
  credential table lives in `tonde_private`, unreachable from clients.
- Export builders are deterministic (pagination, wrapping, ZIP entry order and timestamps fixed), and
  the generated PDF/DOCX round-trip through TONDE's own extractors.
- Prompt 10 backend API tests: **99 tests** across `backend/tests/test_prompt10_{integrations,publishing,billing,exports}_api.py`.

## 4. Domain behaviour

- **Integrations.** The registry declares reality, not wishes: capability state answers one of the
  honest readiness values; a capability that cannot be attempted is declared but unavailable; OAuth
  state and PKCE verifiers are stored only as hashes and the table has no client grant. Live provider
  acceptance is deferred (§14).
- **Publishing.** `publication_create` pins the Production revision, the Result revision and the media
  checksum it will publish. A creator decision is a separate, append-only authorization naming that
  exact version and destination. A creative approval is never publishing authority: the certified
  publication chain was authorized with the pinned Result still unapproved. Submission is a
  service-role RPC with an idempotent fingerprint, so a retry cannot become a second post; an ambiguous
  destination answer becomes `UNKNOWN_REMOTE_STATE` and stays unknown until reconciled. Content that has
  been submitted is frozen.
- **Exports.** Full document and production package are distinct products derived from the requested
  format. Every export pins the Production revision and the recorded version it names; `ready` names a
  real uploaded artifact in the private bucket plus a manifest that describes exactly that
  export/version/format, with real per-file checksums. Export artifacts have no client storage read
  path at all: a download is an authorization decision plus a short-lived server-signed URL, and an
  expired export authorizes nothing.
- **Billing, entitlements, usage, webhooks.** Billing is server-authoritative: a client can open a
  checkout intent (administrator authority) and read status and entitlements; it cannot subscribe the
  workspace, grant or revoke an entitlement, or record usage. Subscription state moves only from a
  verified provider receipt whose signature and freshness are checked, never backwards, and every move
  is explainable from its recorded events. Usage reservations hold quota before a job, commit settles
  once, and a repeat with the same identity is recognised rather than double-counted. The four money
  meanings — provider cost, estimated cost, price charged, credits consumed — are stored and reported
  separately.

## 5. Frontend

- Surfaces: [Integrations.tsx](../frontend/src/prompt10/Integrations.tsx),
  [Publishing.tsx](../frontend/src/prompt10/Publishing.tsx),
  [Exports.tsx](../frontend/src/prompt10/Exports.tsx), [Billing.tsx](../frontend/src/prompt10/Billing.tsx),
  services [integrations.ts](../frontend/src/services/integrations.ts),
  [publishing.ts](../frontend/src/services/publishing.ts), [exports.ts](../frontend/src/services/exports.ts),
  [billing.ts](../frontend/src/services/billing.ts) — all through the TONDE backend (`/api/...`), never
  PostgREST directly.
- Verified, not rebuilt: `tsc --noEmit` clean; **Vitest 246/246 across 17 files** with the new
  [prompt10-delivery.test.tsx](../frontend/src/test/prompt10-delivery.test.tsx) at **26/26**; production
  build exit 0; full Playwright **24 passed / 0 failed**, including
  [prompt10-delivery.spec.ts](../frontend/e2e/prompt10-delivery.spec.ts) (4 scenarios: integrations
  connect/disconnect and failure honesty, export product distinction, publishing authorization and
  unknown-state handling, billing/usage entitlement display and cost transparency).
- Accessibility and layout are covered by the suite's role-based queries, the billing fieldset labels,
  the scoped alert assertions and the narrow-viewport foundation specs.
- Repairs made while verifying: typed fixtures and workspace-scoped queries replaced `as never` casts
  and global text matches; `Billing.tsx` no longer assumes `subscription`/`open_checkouts`/`entitlements`
  are present; `foundation.spec.ts` accepts the Studio route with its canonicalised query string.

## 6. Security

- **Authorization before lookup.** Every client-reachable Prompt 10 RPC checks workspace authority
  before it resolves any resource, so a cross-tenant call is a controlled `42501` (HTTP 403) and never a
  lookup failure or another workspace's row. The durable audit
  [prompt10-authorization-order.test.mjs](../tests/database/prompt10-authorization-order.test.mjs) sweeps
  all **13** client-reachable Prompt 10 RPCs from a non-member workspace, asserts the denial, asserts no
  `P0002` and no ambiguous-column failure, asserts the target workspace is byte-for-byte unchanged, and
  fails if a future Prompt 10 RPC becomes client-reachable without being audited. It also pins the
  client-only set (creator decisions, including `publication_authorize`) and the server-only set (15
  functions).
- **Human authority is not a service privilege.** `publication_create/update/set_state/authorize/preview/retry_safety`
  are executable by `authenticated` only; the service role cannot manufacture a creator publishing
  authorization, and `anonymous` cannot execute any Prompt 10 function.
- **Tenant isolation** is enforced by RLS plus the guarded RPCs, and the hosted acceptance runner
  exercises it as two real authenticated users across every Prompt 10 domain, including populated
  cross-tenant reads, writes and deletes.
- **Storage.** `tonde-exports` has no client read or signing path; the server mints short-lived signed
  URLs. Uploads require a `pending` metadata row created by the caller in a writable bucket.
- **Advisors** (§13) show 0 ERROR; every new warning was reviewed individually rather than silenced.
- Secret-shaped keys are refused in provider configuration and in publication destination settings;
  the private credential store stays in `tonde_private` with no client policy.

## 7. Constitution amendment (1.2.0)

- `product/vocabulary.json`: `constitutionVersion` **1.2.0**, `effectiveDate` **2026-10-08**; the
  generator was run and then checked so the generated Python and TypeScript vocabularies agree
  (97 tables, 86 SQL enums).
- [constitution.md](product/constitution.md) §21 **Amendment D — External publication, export and
  commercial integrity** with ten laws: publication pins exact truth; publication is a creator act and
  a creative approval is never publishing authority; external systems are evidence not truth; unknown
  stays unknown; retries must not duplicate real-world actions; no credential lives in TONDE; billing is
  server-authoritative; money keeps its four meanings apart; exports pin their version and expire;
  external actions keep provenance and stay auditable. §16 non-goals and §12 exports were extended, and
  the revision history gained the 1.2.0 row.
- [invariants.md](product/invariants.md) gained **INV-40–INV-48**, [glossary.md](product/glossary.md)
  gained the Prompt 10 terms, [compliance.md](product/compliance.md) records the amendment.
- `tests/product/constitution.test.mjs` is **7/7** with the version, the invariant count (48) and the
  amendment phrases pinned. No unrelated constitutional law was rewritten.

## 8. Local regression on the final bytes

Every gate below ran after the last code, schema, test and script edit; the only later changes are
documentation (§15).

| Gate | Result | Evidence |
| --- | --- | --- |
| Root npm test (all database + product suites) | **260/260 passed, 0 failed** | `test-results/pre-prompt10/p10h-root.log` |
| Prompt 10 database suites | integrations **5/5**, publishing **6/6**, exports **6/6**, billing **7/7**, authorization-order **5/5** = **29** | `tests/database/prompt10-*.test.mjs` |
| Idempotency proof | **3/3** | `p10g-idempotency.log` |
| Whole-schema artifact `--check` | exit 0 (35 migrations, 1535 statements, 98 tables, 320 RPCs, 86 types, 43 policies, 111 indexes) | `p10h-artifact.log` |
| Generated types `--check` | exit 0 — 97 tables, 86 SQL enums, shared vocabulary verified | `p10h-generator.log` |
| Legacy boundary (`verify:legacy`) | pass | `p10h-legacy.log` |
| Backend pytest | **497 passed**, 2 warnings | `p10g-pytest.log` |
| Backend mypy | **92 source files, no issues** | `p10g-mypy.log` |
| Backend ruff | `All checks passed!` | `p10g-ruff.log` |
| Frontend typecheck | clean | `p10g-tsc.log` |
| Frontend Vitest | **246/246 in 17 files** | `p10g-vitest.log` |
| Frontend production build | exit 0 (chunk-size advisory only) | `p10g-build.log` |
| Playwright (all specs) | **24 passed** | `p10g-playwright.log` |

## 9. Hosted rollout

- Before: ledger **001–030**, effect state matching, 031–034 pending.
- `supabase db push --linked --yes` applied **031–034** as one reviewed forward rollout; after the
  repair below, **035** was applied the same way. Ledger now records **001–035**.
- Nothing was reset, no history was rewritten, and no schema object was created outside the migration
  lineage. Evidence: `p10f-push.log`, `p10f-push-035.log`.

## 10. The one real defect found, and its repair

The two-user hosted runner — not the local PGlite suites — found it:
`tonde.publication_reconcile` resolved the publication row **before** it checked the caller's workspace
authority, so a cross-tenant call surfaced the lookup failure `P0002`, which PostgREST reports as HTTP
500, instead of the controlled `42501` denial.

- Repair: migration **035** re-defines only that function with the authorization decision first,
  identical behaviour, messages, security mode, `search_path` and ACLs (not a replay of 032).
- Regression: [prompt10-publishing.test.mjs](../tests/database/prompt10-publishing.test.mjs) asserts a
  non-member is refused before the publication is looked up, and a member's genuinely missing id still
  answers `P0002`.
- Class audit: every Prompt 10 RPC was checked for the same shape. No other instance exists:
  `billing_apply_subscription` and `billing_grant_entitlement` are service-role-only and their early
  `P0002` names a missing definition or receipt, with no tenant lookup before authorization and no
  tenant existence exposed.
- Hosted proof after the repair: reconciling a real publication from another workspace answers
  `403 / 42501`, never `P0002` (`p10f-hosted-verify-7.log`).

## 11. Hosted schema equivalence

`node scripts/pre-prompt10-catalog-verify.mjs` rebuilds the local catalog from `supabase/migrations`,
queries the hosted catalog through the Management API, and compares every untruncated identity —
tables, columns, constraints, indexes, policies, triggers, function bodies, enum labels and ACLs:

**4791 local identities vs 4791 hosted identities, 0 differences**
(`test-results/pre-prompt10/hosted-final-diff.json`, `p10f-catalog-verify-035.log`).

`supabase db diff` remains **impossible on this machine (no Docker)**; the Management-API catalog
comparison is the verified substitute and is never described as `supabase db diff`.

## 12. Hosted two-user acceptance

`node scripts/pre-prompt10-hosted-verify.mjs` with two freshly created controlled users in two
workspaces: **640 PASS / 0 FAIL / 1 BLOCKED** (`p10f-hosted-verify-7.log`). Highlights:

- Cross-tenant denial across every Prompt 10 RPC, including publications, authorizations,
  reconciliation, preview, retry safety, state changes, exports, downloads, capability state,
  entitlement state, subscription state, checkout and publication create/update.
- The migration-035 defect is verified fixed **on hosted PostgREST**, not merely in PGlite.
- Creator path positively exercised: register an artifact with the checksum of its real bytes, upload
  them, record the completed upload the product path records, create the publication pinned to that
  version and checksum, mark it ready, authorize it as the recording human, and read the destination's
  honest `PROVIDER_NOT_IMPLEMENTED` answer; the pinned Result was never creatively approved.
- Server-owned operations positively exercised and separately asserted: export build → complete →
  download authorization → expiry, and entitlement grant/revoke naming the administrator it is for.
  A client session is denied every one of them.
- Append-only laws proved under service role: a recorded authorization cannot be erased (`23514`), the
  publication that carries it cannot be deleted (`23503`), and it still stands unchanged afterwards.
  Service role cannot record a creator publishing authorization (`403 / 42501`).
- The BLOCKED row is external: real signup/verification/password-reset email delivery and Google
  sign-in.

## 13. Hosted advisors

`supabase db advisors --linked --type all --level info` after the rollout: **338 findings, 0 ERROR**
(179 INFO + 159 WARN; `p10f-advisors-all.json`). Reviewed individually:

- 158 `authenticated_security_definer_function_executable` WARN — the project's established, reviewed
  guard pattern (13 are the new Prompt 10 RPCs). Not changed blindly: the functions are the
  authorization layer, they check workspace authority first, and the 13 new ones are covered by the
  hosted cross-tenant sweep.
- 1 `auth_leaked_password_protection` — plan-gated by Supabase (HTTP 402 when attempted); owner-deferred.
- 3 `rls_enabled_no_policy` INFO — deliberate: `tonde.billing_webhook_events`,
  `tonde.integration_oauth_states` and `tonde_private.integration_credentials` are server-only by design.
- Performance INFO rows (`unindexed_foreign_keys`, `unused_index`) are pre-existing and were not
  mass-applied; index suggestions for low-cardinality policy columns are not taken blindly.

## 14. External provider acceptance — DEFERRED BY OWNER

| Provider surface | Implementation | Automated tests | Credentials | Live acceptance | Remaining prerequisite |
| --- | --- | --- | --- | --- | --- |
| Social publishing providers | Adapter interface + controlled test adapter; submission refuses unimplemented destinations with `PT409 PROVIDER_NOT_IMPLEMENTED` | Hosted + local suites assert the refusal and that no post is faked | **None** | **NOT RUN** | Provider OAuth app credentials, then an adapter exercised to `verified` |
| AI/media generation providers | Unchanged by Prompt 10; the provider catalogue is promoted into the registry | Existing Prompt 7 suites | **None** | **NOT RUN** | Provider credentials (pre-existing deferral) |
| Payment/billing provider | Adapter interface + controlled adapter; checkout intent path, webhook receipt verification and idempotent application | Local database and backend suites cover the authorized and refusal paths | **None** | **NOT RUN** | A payment-provider test account |
| Transactional email | Project capability only | External | **None** | **BLOCKED**: a real signup answers `429 over_email_send_rate_limit`; no custom SMTP declared | SMTP configuration |
| Google sign-in | Configured but disabled | External | **None** | **BLOCKED**: disabled, empty redirect URI | OAuth client credentials |
| Leaked-password protection | n/a | External | Plan-gated | **BLOCKED**: HTTP 402 | Supabase plan capability |

No connection, publication, payment, subscription or OAuth success is reported anywhere in this
project. Where a real provider is unavailable, the database and the API refuse rather than pretend.

## 15. Freeze and evidence

- `test-results/pre-prompt10/build-freeze-prompt10.mjs` hashes every tracked and non-ignored untracked
  file, checks each gate's inputs against that gate's evidence, classifies every later change, and
  refuses to write a manifest when a gate is stale or a change has no coverage argument.
- Outputs: `test-results/pre-prompt10/prompt10-final-manifest.json`,
  `prompt10-final-manifest.sha256`, `prompt10-gate-coverage.json`.
- The last edits after the code/schema gates are documentation only; the whole-tree gates (root npm
  test, generated types, artifact, legacy boundary) were re-run after them, and the coverage
  certificate proves **0 stale gates and 0 unexplained post-gate changes**.

## 16. Known limitations (stated, not hidden)

1. `P0002` is TONDE's long-established "does not exist in this workspace" SQLSTATE. The TONDE backend
   maps it to HTTP 404 (`backend/app/db/client.py`), so a product client never sees it; a *direct*
   PostgREST caller sees HTTP 500 for a not-found product decision. Every cross-tenant path in Prompt 10
   answers `42501`/403 **before** any lookup, which is the security-relevant half and is asserted by
   tests and by hosted acceptance; the mapping itself is systemic (001–035), not new to Prompt 10.
2. `supabase db diff` cannot run without Docker; equivalence is proven by the Management-API catalog
   comparison instead.
3. Durable work is not in this release: export builds claim a job lease by name, and Prompt 11 owns the
   worker fleet, retry scheduling and the lifecycle engine that will call `export_expire`.
4. The hosted project carries controlled certification fixtures: one declared destination provider
   whose adapter was never exercised, its capability, one entitlement definition (removed at run end),
   and one published-authorized publication chain on an archived "Certification-only Production". They
   are deliberately retained because the publishing law makes that chain append-only, and they are
   labeled as controlled acceptance furniture in their own notes.
5. Hosted Auth email delivery, Google sign-in and leaked-password protection remain unverified
   (owner-deferred); admin-confirmed users prove nothing about delivery.

## 17. Prompt 11 boundaries

Prompt 11 is **not started**. Explicitly left to it: the durable worker fleet and its leases, the
global/durable rate limiter (this release has a documented per-process limiter), scheduled retention
and the export lifecycle engine, hosted provider credential provisioning and the exercised adapters
that make a destination `verified`, and any billing-provider sandbox wiring. Nothing in Prompt 10
claims those exist.

---

**Verdicts:** `PROMPT 10 IMPLEMENTATION: PASS` · `EXTERNAL PROVIDER ACCEPTANCE: DEFERRED BY OWNER` ·
`INTERNAL DEFECTS REMAINING: 0` · `HOSTED SCHEMA DIFFERENCES: 0` · `READY FOR PROMPT 11: YES`.
