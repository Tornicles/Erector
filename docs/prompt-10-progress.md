# Prompt 10 progress — packets 031 (integrations), 032 (publishing), 033 (exports), 034 (billing), 035–037, plus Constitution 1.2.0

**Status: implementation complete, hosted acceptance green, external provider acceptance deferred by
the owner.** This file records what is delivered, what it proves, and what remains, so a later reader
never mistakes a packet for the whole prompt. The authoritative per-domain completion record is
[prompt-10-completion-handoff.md](prompt-10-completion-handoff.md); this file is the packet-by-packet
history behind it. The packets follow the authoritative Prompt 10 text (§0–104).

## Entry

- Pre-Prompt-10 certification: **BLOCKED** (external prerequisites only, entry gate closed):
  [pre-prompt10-final-certification.md](pre-prompt10-final-certification.md) §7.
- Owner decision 2026-10-08: **Prompt 10 may proceed** while mail capacity, Google sign-in and
  leaked-password protection stay BLOCKED and unclaimed:
  [prompt-10-entry-gate-deferral.md](prompt-10-entry-gate-deferral.md). The deferral waives no
  internal security, RLS, tenant-isolation, authorization, billing, publishing or human-approval
  requirement, and external Auth must be reopened and verified before public production launch.

## Delivered: packet 031 — integrations (§6–14)

[202610050031_prompt10_integrations.sql](../supabase/migrations/202610050031_prompt10_integrations.sql),
forward-only and additive on the migration-001 seam (`tonde.integration_connections` +
`tonde_private.integration_credentials`) and the migration-017 AI catalog — no second interpretation of
either. It adds:

| Piece | What it makes true |
| --- | --- |
| `integration_providers` registry (+4 SQL enums) | Provider identity, category, auth type, media/export types, scopes, restrictions and adapter state — never secrets (`guard_integration_provider` refuses secret-shaped configuration keys). **`enabled` requires an adapter that exists.** |
| `integration_provider_capabilities` | A capability is a declared row with required scopes and input/output contracts; enabling one requires a provider that has an adapter (`guard_integration_capability`). |
| `integration_connections` extensions | Truthful states, `verified_at`, last success/error, `revoked_at`, external account label, requested vs granted scopes, provider FK. **CONNECTED requires a recorded verification and a provider with a verified adapter**; revoked always records when; granted scopes must have been requested. |
| `integration_oauth_states` | Server-only OAuth flow: hashes of state and PKCE verifier only, bound to workspace+user+provider, short window, single-use and expiry enforced in the database (`PT409` on replay or expiry). |
| `tonde.integration_capability_state(...)` | The one server-side answer to "can this workspace use this capability", returning the reason (`UNKNOWN_PROVIDER`, `PROVIDER_NOT_IMPLEMENTED`, `UNKNOWN_CAPABILITY`, `CAPABILITY_DISABLED`, `CONNECTION_NOT_READY`, `MISSING_SCOPE`, `AVAILABLE`) and denying non-members. |
| Exposure | Registry/capabilities are read-only catalog for `authenticated`; connections stay select-only; OAuth state has no client policy and no client grant. |

The AI catalog is **promoted, not duplicated**: every `tonde.ai_providers` key is registered; `manual`
is `implemented`; every external AI provider stays `adapter_state = 'absent'`, `enabled = false`.

## Delivered: packet 032 — publishing (§15–23, §48, §64)

[202610050032_prompt10_publishing.sql](../supabase/migrations/202610050032_prompt10_publishing.sql),
forward-only and additive on migration 001 and packet 031. It adds:

| Piece | What it makes true |
| --- | --- |
| `publications` (+4 SQL enums) | One row is one intended real-world placement of one exact artifact: **`production_revision`, `result_revision`, `media_id` and the media checksum are pinned at creation**, plus provider, connected account, destination label, non-secret settings, visibility and schedule. States: `draft / ready / awaiting_authorization / submitting / submitted / processing / published / failed / cancelled / removed / unknown_remote_state`. |
| State machine + content freeze (`guard_publication`) | Only transitions that actually happened are accepted (`PT409` otherwise); a publication begins as a draft; settings may not carry secrets; **content is frozen from the first submission on**. |
| `publication_authorizations` | The **distinct human publication authorization**: who, what publication, pinned Production/Result revision + media + checksum + content fingerprint, which destination and when. Append-only; a null-auth or service-role writer is refused (`42501`). `withdraw` is its own recorded decision and blocks submission. |
| `publication_attempts` | Idempotent submission: one publication carries **one `operation_id`, one `idempotency_key` and one `request_fingerprint`** that every retry reuses; attempts are numbered in order, start `in_flight`, and a finished attempt is closed evidence. |
| `publication_reconciliations` | Remote-state reconciliation: observed state, the provider's own `remote_state`, the remote resource, the source (`provider_api`/`provider_webhook`/`manual_operator`), the person and the time — append-only. |
| Remote resource laws | `PUBLISHED` requires a remote resource id, confirmation time and last-checked time; `REMOVED` requires a timestamp and resource; `FAILED` requires a normalized `publication_failure_category` plus a time; failure details describe only the current failure. **One remote resource can never be claimed by two publications in a workspace.** |
| Failure taxonomy (§21) | `authentication_failed`, `insufficient_scope`, `rate_limited`, `invalid_media`, `invalid_metadata`, `provider_unavailable`, `quota_exceeded`, `remote_processing_failed`, `destination_rejected`, `policy_violation`, `unknown` — the provider's own code stays in `failure_code`. An accepted HTTP request becomes `submitted`, never `published`. |
| Preview (§19) | `tonde.publication_preview(...)` returns the impact/summary a creator reviews — destination, account label, Production/Result/file with pinned vs current revision, thumbnail when one exists, title/caption/settings, provider constraints, capability state, missing scopes, authorization state, retry classification and `blocked_by` (every reason submission is not possible yet). |
| Retry classification (§64) | `tonde.publication_retry_safety(...)` returns `requires_idempotency_key`, `requires_reconciliation_before_retry` or `must_not_retry` — what Prompt 11 will read before retrying. Publishing is never classified `safe_to_retry`. |
| Audit trail (§48) | Semantic `audit_events`: `provider.connected`, `provider.disconnected`, `provider.needs_attention`, `publication.authorized`, `publication.authorization_withdrawn`, `publication.submitted`, `publication.accepted`, `publication.published`, `publication.failed`, `publication.outcome_unknown`, `publication.reconciled`, `publication.state_changed`. No tokens, secrets or passwords in any payload (asserted). |
| RPC boundary | `publication_create/update/set_state/authorize/reconcile/preview/retry_safety` are authenticated creator APIs (editor enforced, workspace scoped); `publication_submit` and `publication_record_result` are **service-role only** — no client session can record an outbound attempt or a provider outcome. Submission requires the `publish` capability to be `AVAILABLE`, so a provider with no verified adapter cannot be submitted to at all. |
| Exposure | All four tables are tenant-readable so failures are never hidden, and **no client role holds any write grant**; manual reconciliation names the member who observed the destination. |

## Delivered: packet 033 — exports (§24–30, §71)

[202610050033_prompt10_exports.sql](../supabase/migrations/202610050033_prompt10_exports.sql),
forward-only and additive on the canonical export seam that migration 001 already created. It extends
`tonde.exports` instead of adding a parallel export table:

| Piece | What it makes true |
| --- | --- |
| Two distinct products | `export_kind`: **`full_document`** (PDF/DOCX, human-readable) and **`production_package`** (ZIP, or its structured-data JSON). `requested_format` decides the product through a stored **generated column**, so one format can never wear both names, and historical rows keep working with no fabricated identity. |
| Version pinning (§16, §26) | Every export pins `production_revision` (filled from the Production by the guard, never from the caller's opinion) **and** the recorded `production_version_id`. Later Production edits bump the Production's revision; the export still describes what was requested. |
| Lifecycle (§29) | `export_state`: `requested → building → ready | failed`, and `requested | building | ready → expired`. A request is not a build: jumping to ready is refused, failing needs a cause, a finished export cannot restart, and expiry also cancels queued work. |
| Durable boundary (§4, §103) | `export_request` creates the export and a `tonde.jobs` row (`job_type='export'`, `queued`) on the **existing** jobs foundation. `export_mark_building` must name the worker that holds the job lease (the foundation's own law: a `running` job needs a lease holder), so nothing fakes a worker that does not exist. `export_complete` / `export_fail` / `export_expire` are service-role outcomes that clear the lease and finish the job. |
| Manifest law (§28) | A `ready` export requires an uploaded artifact in the private exports bucket **and** a manifest naming exactly this export, workspace, Production, pinned revision and format. Every file has a deterministic relative path (no absolute paths, no `..`), checksums are recorded or omitted but never faked, a file may only reference media of this workspace, a Result may only belong to this Production, and **only an accepted Result ships its media**. |
| Reference/copyright safety (§27, §69) | A Reference TONDE does not own (`third_party_inspiration`, `public_reference`, `unknown`, `rights_classification` …) is refused as copied media and ships as metadata/source linkage instead. |
| Download security (§30) | `tonde.export_download(...)` authorizes per request and returns storage coordinates plus a five-minute window for the server to sign. **`tonde_private.can_read_storage_object` now excludes `tonde-exports` outright**, so export artifacts have no client read path at all (asserted), while normal workspace media stays readable. |
| Historical rows (§83) | Existing exports keep their history: the revision pin is read from the Production version they already name, rows that produced an artifact are `ready`, and their manifest is reconstructed with `reconstructed = true` and an explicit note — file contents stay unknown rather than invented. |
| Audit trail (§48) | `export.requested`, `export.building`, `export.generated`, `export.failed`, `export.expired` (plus `export.download_authorized` on the download path), with kind/format/sizes/checksum and no secrets (asserted). |

Not built in this packet, on purpose: the document/package **builder** itself (backend §55–56 work) and
any durable worker execution (§71's file-level assertions about PDF/ZIP contents therefore cannot run
yet, and §51's export UI does not exist). A requested export is truthfully `requested`; nothing claims
a file exists until `export_complete` records a real artifact.

## Delivered: packet 034 — billing, entitlements, usage and webhooks (§31–47, §74–76)

[202610050034_prompt10_billing.sql](../supabase/migrations/202610050034_prompt10_billing.sql),
forward-only and built on the commercial seam migration 001 already created (`tonde.billing_accounts`,
`tonde.usage_events`) and on the AI cost structures migration 017 already created. No second
commercial model exists.

| Piece | What it makes true |
| --- | --- |
| Commercial authority (§4, §32, §76) | No client role holds any write privilege on any commercial table — catalog included (`has_table_privilege` sweep asserts 0 of 30 grant/table pairs). The browser may open a checkout intent and read status; nothing else. Every writer is a service-role RPC (`billing_apply_subscription`, `usage_record`, `usage_reserve`/`commit`/`release`, `billing_webhook_receive`/`finish`, `billing_grant_entitlement`, `billing_revoke_entitlement`) with `PUBLIC` execute revoked. |
| Subscription truth (§5, §10) | `subscription_state` is a superset of the historical check (8 states), so stored rows survive the conversion. **Only `trialing`, `active` and `cancel_at_period_end` grant entitlements** (`tonde_private.subscription_grants_entitlements`, asserted by enumeration) — `past_due`/`incomplete` are not "active". |
| Verified events only (§6, §33) | `billing_apply_subscription` must name an existing receipt **and** that receipt must have recorded a signature verification (scheme + time) and must not be `failed`/`ignored`. An unsigned or failed event cannot reach commercial state. |
| Out-of-order delivery (§7, §35) | `provider_state_at` is the applied provider state; an event describing an older state is recorded as `applied = false` with reason `STALE_EVENT` and the current state is left alone. Asserted with a deliberately older timestamp. |
| Webhook receipts (§33) | `billing_webhook_events`: unique `(provider, provider_event_id)` dedup, an explicit signature witness (`signature_scheme`, `signature_verified_at` — never the signature value), `received → processing → processed | failed | ignored` with `processing_started_at`/`processed_at`/`failure_message` recorded, what the provider sent immutable, top-level secret-shaped payload keys refused, and receipts unreadable by any client role. A provider-level event that names no workspace is recorded with `audited: false` instead of being attributed to a guessed workspace. |
| Entitlements (§8–10) | `entitlement_definitions` (feature/quota) → `billing_plans` (a plan cannot be `active` without a provider price identity — `plan_sellable_has_price`; **no price is invented**) → `plan_entitlements` → `workspace_entitlements`. One evaluator, `tonde.entitlement_state(workspace, key)`, is member-scoped and reason-bearing: `UNKNOWN_ENTITLEMENT`, `ENTITLEMENT_DISABLED`, `NO_SUBSCRIPTION`, `SUBSCRIPTION_NOT_ACTIVE`, `NOT_INCLUDED`, `EXPIRED`, `EXHAUSTED`, `AVAILABLE`. Server-side derivation (`tonde_private.billing_sync_entitlements`) refreshes plan rows and never clobbers an administrative grant. |
| Grants (§8) | A grant records `source = 'grant'`, its `granted_by` and optional `valid_until`; a grant naming nobody is refused (`42501`) rather than recorded anonymously, and `entitlement_source_names_origin` is a database constraint. |
| Quota concurrency (§18, §47) | `usage_reservations` + `workspace_entitlements.reserved_amount`. `usage_reserve` takes the entitlement row `FOR UPDATE` before reading the balance, and `entitlement_never_overspent` (`consumed + reserved <= limit`) is a constraint, so a read-then-subtract race is refused by the database even when the API is bypassed (asserted). Commit settles at the amount actually used; release returns it; a reservation settles once and only in its own workspace. |
| Usage accounting (§14, §46) | `usage_events` extended with operation, provider, model, production, actor, input/output units, **`provider_cost` / `estimated_cost` / `price_amount` / `credit_units` as separate columns**, currency, `source_event_id`, `attempt_id` and the `cost_basis` (`actual` / `estimated` / `unknown`) that says what the row actually carries. `actual` requires the reported amount; `unknown` may carry no cost at all. `quantity` widened to `numeric(14,4)` so a fractional quota is not rounded away. |
| Usage idempotency (§19) | Both identities are honoured: the caller's `idempotency_key` **and** the provider `source_event_id` (unique index). A retry with either one alone is answered as a duplicate with the original row id instead of double-counting or raising a unique violation. |
| AI cost integration (§15, §16) | `attempt_id` is a composite FK to `(workspace_id, id)` on the migration-017 `ai_generation_attempts`, so a usage row can only account for an attempt of its own workspace. No new AI cost system was created, and the existing human cost-confirmation boundary from 017 is untouched. |
| Commercial history (§20, §34) | `subscription_events` is append-only (`guard_subscription_event` refuses UPDATE/DELETE, asserted), records `from_state`/`to_state`/`actor` (`webhook`/`server`/`admin`)/`actor_user_id`/`applied`/`reason`/`occurred_at`, and cites the webhook receipt it came from (FK). `ACTIVE → PAST_DUE → ACTIVE` stays readable. |
| Read surfaces (§34) | `tonde.billing_status` (administrator-only) returns subscription state, plan, entitlements with remaining amounts and open checkout intents; `tonde.entitlement_state` explains an unavailable feature to any member. `billing_checkout_start` is workspace-**admin**-gated and creates a non-authoritative intent (nothing subscribes). `billing_checkout_intents` cannot be re-pointed at another plan and is terminal once completed. |
| Audit (§37) | `billing.checkout_initiated`, `subscription.changed`, `entitlement.changed` (with the deciding administrator), `usage.recorded`, `webhook.processed`/`failed`/`ignored` — asserted secret-free, and asserted that a receipt stores the verification, never the signature. |

Not built in this packet, on purpose: the provider adapter/HTTP layer with bounded timeouts and retry
classification, the backend routes, the export document/package builders, the billing checkout session
creation against a real provider, and the frontend surfaces. Live billing acceptance is deferred by
owner decision (no payment-provider test account exists); nothing here claims a subscription, a payment
or an invoice ever happened.

## Delivered: packet 035 — the real export builders and the export backend surface (§27–30, §55–56)

No new migration: this packet is the backend half that packet 033 deliberately left out. Files:
[backend/app/services/export_builder.py](../backend/app/services/export_builder.py),
[backend/app/services/exports.py](../backend/app/services/exports.py),
[backend/app/services/entitlements.py](../backend/app/services/entitlements.py),
[backend/app/services/rate_limit.py](../backend/app/services/rate_limit.py),
[backend/app/domain/commercial.py](../backend/app/domain/commercial.py),
[backend/app/routers/exports.py](../backend/app/routers/exports.py).

| Piece | What it makes true |
| --- | --- |
| Real renderers (§27) | A small but valid **PDF 1.4** (Flate-compressed content streams) and a real **.docx** (three OOXML parts), both written with the standard library only — no new dependency. The round trip is proven, not asserted: the generated PDF is read back by TONDE's own `extract_pdf` and the DOCX by `extract_docx`. |
| Deterministic artifacts | Pagination, wrapping, ZIP entry order and entry timestamps are fixed, so the same pinned state always produces the same bytes and the same checksum. |
| Pinned reconstruction (§29) | The Production's own content comes from the **pinned `object_versions` row** the export names. Every child object is reconstructed from its own newest version recorded **at or before the export's `created_at`**; an object created afterwards is excluded, and an object with no version history at all is recorded in `pin.reconstruction_gaps` instead of being passed off as pinned. |
| Truthful failure (§29) | If the pinned Production version is gone, the build **fails** with `EXPORT_VERSION_UNAVAILABLE` and stores nothing — it never falls back to current Production state. A missing migration or credential is reported as an environment fact (`unavailable`), not as the export's failure. |
| Package types (§28) | `complete`, `script`, `shot_list`, `storyboard`, `prompt_pack`, `camera_plan`, `continuity_report`, `audio_plan`, `edit_plan`, `structured_data` each select their own sections; a type narrows the package and never invents a section. A `json` package is one structured JSON document instead of an archive. |
| Media and rights (§28) | Only **accepted** Results copy media, bounded at 64 MiB, read through the member storage path, named by the media they came from, and recorded in the manifest. A Reference TONDE does not own ships as metadata with `media_copied: false`. |
| Manifest (§30) | Export id, workspace, Production, pinned revision **and** version id, created time, generated by, format, kind, package type, artifact object key/bytes, per-file bytes and real sha256 checksums, media, references, results, schema version and the pin block with limitations. |
| Artifact storage | The artifact is uploaded into the private `tonde-exports` bucket with the **server** credential (the client path excludes that bucket by packet 033's law) and registered as media metadata before `export_complete` records it, so `ready` always names a real file. |
| Download (§30) | `export_download` authorizes per request; the route returns a five-minute signed URL, or — when no server storage credential is configured — an explicit `download_url: null` with the reason. A detail read never hands out a link. |
| Build boundary (§4, §103) | A build claims the job's lease by name (`tonde-api:<host>:<pid>`) and is one bounded operation. The response says plainly that Prompt 11 owns the durable worker fleet; there is no auto-retry loop. |
| Server-side entitlement (§8–10) | `tonde.entitlement_state` is asked for every export operation. An undeclared or disabled entitlement is **not** a commercial gate (TONDE invents no restrictions) and the response says `enforced: false`; every other non-`AVAILABLE` reason refuses server-side with 403 and the reason. |
| Rate limits and retry classification (§38–40) | A per-process fixed-window limiter guards the Prompt 10 actions and returns a real retry hint (429), documented as not being Prompt 11's global system. Every operation states `SAFE_TO_RETRY` / `REQUIRES_IDEMPOTENCY_KEY` / `REQUIRES_RECONCILIATION` / `MUST_NOT_RETRY`, and provider responses are normalized into the same failure taxonomy packet 032's publications use. |

Not built in this packet: the integration/publishing/billing routes and provider adapters, the frontend
surfaces, the constitution amendment and the hosted rollout. Nothing here claims a live provider or a
live billing account accepted anything.

## Evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Integrations database suite | **5/5** | `tests/database/prompt10-integrations.test.mjs` |
| Publishing database suite | **6/6** — version pins, human-only authorization, idempotent retry, truthful outcomes and reconciliation, state machine + freeze, preview, retry classification and audit assertions, plus the migration-035 authorization-order regression | `tests/database/prompt10-publishing.test.mjs` |
| Export database suite | **6/6** — two products, version pins and isolation, lifecycle evidence, manifest law, download authorization and artifact privacy, audit | `tests/database/prompt10-exports.test.mjs` |
| Billing/commercial database suite | **7/7** — server-only authority and client write denial, subscription movement with explainable history, entitlement derivation/grants/evaluator reasons and quota accounting, usage idempotency and cost separation, webhook signature/dedup/stale/terminal states, billing administration and cross-workspace isolation, secret-free audit | `tests/database/prompt10-billing.test.mjs` |
| Guard composition | **77 `guard_mutation` + 13 `a_human_acceptance`** (031–034 additions) | `tests/database/prompt1-9-corrections.test.mjs` |
| Root database + product suites | **253/253** (was 235 before Prompt 10; +5 +5 +6 +7) | `test-results/pre-prompt10/p10d-root.log` |
| Generated types | regenerated and `--check` clean — **97 tables, 86 enums** (was 85/71) | `test-results/pre-prompt10/p10d-generator-check.log` |
| Product vocabulary | `publicationStates`, `publicationFailureCategories`, `exportStates`, `subscriptionStates`, `entitlementKinds`, `entitlementSources`, `usageCostBases`, `reservationStates`, `webhookStates`, `checkoutStates`, `commercialActors` added; `export_kind` mapped to the existing `exportActions`; the generator asserts SQL enums equal the vocabulary | `product/vocabulary.json`, `scripts/generate-database-types.mjs` |
| Whole-schema artifact | rebuilt to `001_to_035` (98 tables, 320 RPCs, 86 types, 43 policies, 111 indexes); superseded `001_to_034` artifact removed; `--check` exit 0 (35 migrations, 1535 statements) | `supabase/manual-apply/202610050001_to_035_full_schema_idempotent.sql` |
| Idempotency proof | **3/3** | `test-results/pre-prompt10/p10f-idempotency-035.log` |
| Frontend typecheck / Vitest / build / Playwright | clean / **220/220** / clean / **20/20** (re-run after generated types changed) | `p10d-tsc.log`, `p10d-vitest.log`, `p10d-build.log`, `p10d-playwright.log` |
| Export builder + API suite (packet 035) | **16/16** — PDF/DOCX round trip through TONDE's own extractors, deterministic archives, section/packaging laws, retry taxonomy, entitlement gate, request/build/download contracts, truthful failure on a missing pin, no-lease-without-credentials, 429 | `backend/tests/test_prompt10_exports_api.py` |
| Backend pytest / mypy / ruff | **414 passed** (was 398; +16) / 81 files clean / `All checks passed!` | `p10e-pytest.log`, `p10e-mypy.log`, `p10e-ruff.log` |
| Legacy boundary | pass | `p10d-legacy.log` |

### Final regression on the frozen bytes (migration 035 included)

Every gate below ran after the last code, schema, test and script edit; the only later changes are
documentation, and the whole-tree gates were re-run after those. Evidence: `p10g-*` and `p10h-*.log`
under `test-results/pre-prompt10/`; the numbers above in the packet-era table are kept as history.

| Gate | Result |
| --- | --- |
| Root npm test (all database + product suites) | **260/260 passed, 0 failed** |
| Prompt 10 database suites | integrations 5/5, publishing 6/6, exports 6/6, billing 7/7, authorization-order 5/5 = **29** |
| Backend pytest | **497 passed**, 2 warnings |
| Backend mypy / ruff | **92 source files, no issues** / `All checks passed!` |
| Frontend tsc / Vitest / build | clean / **246/246 in 17 files** / exit 0 |
| Playwright (all specs, Prompt 10 spec included) | **24 passed** |
| Idempotency / artifact `--check` / generated types `--check` / legacy boundary | **3/3** / exit 0 (35 migrations, 1535 statements) / exit 0 (97 tables, 86 enums) / pass |
| Hosted rollout, equivalence, acceptance, advisors | ledger **001–035** / **0 differences over 4791 identities** / **640 PASS, 0 FAIL, 1 BLOCKED** / **0 ERROR** |

## Delivered: migration 035 — the authorization-order repair that hosted acceptance found

The two-user hosted runner (not PGlite) found the one real defect in the Prompt 10 schema:
`tonde.publication_reconcile` resolved the publication row **before** it checked the caller's workspace
authority, so a cross-tenant call surfaced the lookup failure `P0002` — which PostgREST reports as HTTP
500 — instead of the controlled `42501` denial.
[migration 035](../supabase/migrations/202610050035_prompt10_reconcile_guard_order.sql) re-defines only
that function with the authorization decision first, identical behaviour, messages, security mode and
`search_path`, and re-asserts its ACLs.

A static audit of every Prompt 10 RPC for the same class found no other instance.
`billing_apply_subscription` and `billing_grant_entitlement` are service-role-only functions whose early
`P0002` names a missing definition or receipt, not a tenant lookup, and they leak no tenant existence.

| Check | Result | Evidence |
| --- | --- | --- |
| Authorization-order sweep (new) | **5/5** — all 13 client-reachable Prompt 10 RPCs deny a non-member with 42501, never `P0002` or an ambiguous-column failure; the target workspace is unchanged afterwards; a member still gets the controlled not-found answer; client-only and server-only privilege sets hold; and the audited set equals the client-executable set | `tests/database/prompt10-authorization-order.test.mjs` |
| Publishing suite | **6/6** (was 5/5) — the added regression asserts a non-member is refused before the publication is looked up | `tests/database/prompt10-publishing.test.mjs` |
| Whole-schema artifact | rebuilt to `001_to_035` (35 migrations, 1535 statements, 98 tables, 320 RPCs, 86 types, 43 policies, 111 indexes); the superseded `001_to_034` artifact was removed; `--check` exit 0 | `supabase/manual-apply/202610050001_to_035_full_schema_idempotent.sql` |
| Idempotency proof | **3/3** on the rebuilt artifact | `test-results/pre-prompt10/p10f-idempotency-035.log` |

## Delivered: packet 036 — hosted rollout, catalog equivalence, two-user acceptance and advisors

- The ledger read 001–030 applied with 031–034 pending. `supabase db push --linked --yes` applied
  031–034 as one reviewed forward rollout, and 035 after the repair above; the ledger now records
  **001–035**. Nothing was reset, no history was rewritten and no schema was created outside the
  migration lineage.
- Equivalence is re-read from both sides rather than asserted:
  `node scripts/pre-prompt10-catalog-verify.mjs` compared **4791 local and 4791 hosted catalog
  identities with 0 differences**, including function bodies and ACLs
  (`test-results/pre-prompt10/hosted-final-diff.json`). `supabase db diff` is impossible here (no
  Docker), so this Management-API catalog comparison is the verified substitute.
- `node scripts/pre-prompt10-hosted-verify.mjs` — two controlled users in workspaces A and B — ended
  **640 PASS / 0 FAIL / 1 BLOCKED**. The BLOCKED row is real signup/verification/password-reset email
  delivery and Google sign-in, which need external inbox/OAuth credentials. That runner is what found
  the reconcile defect, and its cross-tenant sweep now proves on hosted PostgREST that reconciling a
  real publication from another workspace answers `42501` and never `P0002`/HTTP 500.
- Server-owned operations are exercised positively and separately from client ones: export build →
  complete → download authorization → expiry (the completed artifact is served only through a
  short-lived server-signed URL), commercial grant/revoke on behalf of the named administrator, and
  `billing_status` answering `none` with `provider.configured = false`. A client session is denied every
  one of them, and the service role cannot record a creator publishing authorization.
- Supabase advisors after the rollout: **0 ERROR** (159 WARN + 179 INFO at `--level info`). 158 warnings
  are the project's established, individually reviewed
  `authenticated_security_definer_function_executable` pattern (13 of them the new Prompt 10 RPCs),
  plus the plan-gated `auth_leaked_password_protection`. The three `rls_enabled_no_policy` INFO rows are
  deliberate: `tonde.billing_webhook_events`, `tonde.integration_oauth_states` and
  `tonde_private.integration_credentials` are server-only by design.

## Delivered: packet 037 — Prompt 10 frontend verification

The Prompt 10 frontend was verified rather than rebuilt. `tsc --noEmit` is clean, **Vitest 246/246
across 17 files** (the new `frontend/src/test/prompt10-delivery.test.tsx` is **26/26**), the production
build exits 0 (chunk-size warning only), and the full Playwright suite passed **24/24** including the
new `frontend/e2e/prompt10-delivery.spec.ts`. Repairs made while verifying: the new Prompt 10 test file
uses typed fixtures and workspace-scoped queries instead of `as never` casts and global text matches,
`frontend/src/prompt10/Billing.tsx` no longer assumes `subscription`/`open_checkouts`/`entitlements`
are present, and `frontend/e2e/foundation.spec.ts` accepts the Studio route with its canonicalised
query string.

## Delivered: Constitution 1.2.0 — external publication, export and commercial integrity

`product/vocabulary.json` carries `constitutionVersion 1.2.0` and `effectiveDate 2026-10-08`; the
generator was run and then checked, so the generated Python and TypeScript vocabularies agree.
[constitution.md](product/constitution.md) gained §21 Amendment D with its ten laws (publication pins
exact truth; publication is a creator act and a creative approval is never publishing authority;
external systems are evidence, not truth; unknown stays unknown; retries must not duplicate real-world
actions; no credential lives in TONDE; billing is server-authoritative; the four money meanings stay
apart; exports pin their version and expire; external actions keep provenance and stay auditable), the
[invariants register](product/invariants.md) gained INV-40–INV-48, the
[glossary](product/glossary.md) names the new terms, and [compliance.md](product/compliance.md) records
the amendment. `tests/product/constitution.test.mjs` is **7/7** with the version, the invariant count
and the amendment phrases pinned.

## Remaining after packets 031–037

- **Provider and billing sandbox acceptance** (§93–94): **DEFERRED BY OWNER** — no publishing-provider
  credentials and no payment-provider test account exist. The adapter interfaces and controlled test
  adapters are built and covered by automated tests; nothing anywhere reports a provider as connected
  or a workspace as published to, billed or paid.
- The same owner deferral covers email delivery (a real signup answers `429
  over_email_send_rate_limit`; the project declares no custom SMTP), Google sign-in (disabled, empty
  redirect URI) and leaked-password protection (plan-gated, HTTP 402).
- **Prompt 11** is deliberately not started: the durable worker fleet, the global rate limiter and the
  lifecycle engine that will call `export_expire` are Prompt 11's, and this record names them only as
  boundaries.
- **§97 freeze and §98 handoff**: `docs/prompt-10-completion-handoff.md` and a Prompt 10-specific
  freeze manifest are produced after the last edit; the pre-Prompt-10 freeze does not cover Prompt 10
  bytes.

## Notes for the next packet

- The pre-Prompt-10 freeze (`test-results/pre-prompt10/final-manifest.json`, `gate-coverage.json`) is
  the record of **Prompts 1–9** certification and must not be presented as covering Prompt 10 bytes.
- `supabase db diff` remains impossible without Docker; hosted equivalence stays verified by the
  untruncated Management-API catalog comparison.
- Billing (034) reuses the existing `billing_accounts` / `usage_events` seam and the AI generation cost
  confirmation structures from migration 017 rather than inventing a second commercial model.
