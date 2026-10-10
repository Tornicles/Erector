# TONDE deployment readiness — Vercel + Supabase

**Assessment date:** 2026-10-10  
**Status:** PARTIALLY FUNCTIONAL — BLOCKERS REMAIN. This is local readiness evidence, not a hosted deployment certification.

## Repository and topology

The local working branch is `feat/vercel-supabase-production-completion`, based on `origin/main` at `71f5d85de73712ed8b8e0cafd8f49b1b6d60116c`. Current HEAD `693e2aff9152f6d172ee53e22fd3da96da53bd1b` includes the native marketing migration commit; that commit is already on this branch and is not part of my uncommitted deployment-readiness changes.

A single Vercel Services project is configured at repository root in [`vercel.json`](../vercel.json). It builds `frontend/` with Vite and routes `/api` and `/api/*` to the Python service; the catch-all routes public website paths to Vite so direct navigation and refreshes use the SPA. The FastAPI service entrypoint is [`backend/vercel_app.py`](../backend/vercel_app.py), importing the existing app through the supported Python runtime. Its worker loop is forcibly disabled in the Vercel entrypoint. The repository-root configuration is the only Vercel Services config in the current worktree. Do not configure a second frontend-only project from a separate root unless the Vercel Services build is shown to be unsuitable.

This topology follows the current Vercel Services and Python runtime docs: [Services](https://vercel.com/docs/services), [routing](https://vercel.com/docs/services/routing), [service configuration](https://vercel.com/docs/services/config-reference), [Python runtime](https://vercel.com/docs/functions/runtimes/python), and [FastAPI](https://vercel.com/docs/frameworks/backend/fastapi). The Python bundle uses runtime-only requirements; test tooling remains in [`backend/requirements-dev.txt`](../backend/requirements-dev.txt).

**Not verified:** a Vercel build/deploy, project link/repository settings, environment variables, preview, live routing, URL/domain mapping, DNS, or TLS. The Vercel CLI and `VERCEL_TOKEN` are unavailable in this workspace.

## Environment manifest

Set the values through Vercel's environment-variable UI or integration. Never place secrets in client-exposed `VITE_*` variables. Use separate Preview and Production values where URLs, keys, callbacks, or allowed origins differ.

| Variable | Scope | Required? | Secret? | Purpose / validation |
|---|---|---:|---:|---|
| `VITE_SUPABASE_URL` | Frontend; Preview and Production | Yes for live auth/data | No | HTTPS Supabase project URL; checked by browser config validation. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend; Preview and Production | Yes for live auth/data | Public publishable/anon key only | Never use a service-role or `sb_secret_` key. |
| `VITE_API_URL` | Frontend; Preview and Production | Optional | No | Leave unset/empty for same-origin Vercel Services (`/api/...`). Set an HTTPS origin only if deploying frontend and API separately; then allow that exact origin in backend CORS. |
| `VITE_TONDE_LOCAL_PREVIEW` | Local development only | No | No | `1` permits the frontend shell when Supabase config is absent; it does not enable authentication or data. Do not set for live Preview/Production. |
| `APP_ENV` | Backend; Preview/Production | Yes in deployment | No | `production` for production. Enables HTTPS/origin guards and hides docs/OpenAPI. |
| `APP_VERSION` | Backend; all environments | No | No | Defaults to `0.1.0`; deployment/build identifier for envelopes and worker records. |
| `SUPABASE_URL` | Backend; Preview/Production | Yes | No | HTTPS URL for the matching Supabase project. |
| `SUPABASE_PUBLISHABLE_KEY` | Backend; Preview/Production | Yes | Public key | Public key for server requests; user bearer JWT continues to enforce RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend only; only where server-owned paths require it | Conditional | **Yes** | Privileged server-only key. Never expose in browser or `VITE_*`. Needed by server-side media verification/export/billing/integration paths; guard each operation and do not treat presence as proof of use. |
| `CORS_ALLOWED_ORIGINS` | Backend; Preview/Production | Yes when cross-origin; otherwise exact app origins still recommended | No | Comma-separated HTTPS origins, no `*`. Include each exact deployed frontend origin; CORS is not authorization. |
| `LOG_LEVEL` | Backend; all environments | No | No | Defaults to `INFO`. Structured logs exclude credential/prompt fields. |
| `DIRECTOR_PROVIDER` | Backend; all environments | No | No | Defaults `unconfigured`. `openai_compatible` selects the implemented structured-text adapter, not a media renderer. |
| `DIRECTOR_BASE_URL` | Backend; provider-enabled environments | Conditional | No | HTTPS endpoint for the configured OpenAI-compatible inference provider. |
| `DIRECTOR_API_KEY` | Backend only; provider-enabled environments | Conditional | **Yes** | Provider credential. Never browser-visible. Preferred over `OPENAI_API_KEY` when both are set. |
| `OPENAI_API_KEY` | Backend only; provider-enabled environments | No | **Yes** | Standard OpenAI credential name, accepted as a fallback when `DIRECTOR_API_KEY` is unset. Never browser-visible. Setting the same key in both is acceptable. |
| `DIRECTOR_MODEL` | Backend; provider-enabled environments | Conditional | No | Required when `DIRECTOR_PROVIDER=openai_compatible`. |
| `DIRECTOR_LONG_CONTEXT_MODEL` | Backend; optional provider tuning | No | No | Current setting is available for provider configuration but `build_provider` does not pass this value into the adapter; do not rely on it until wired and tested. |
| `DIRECTOR_TRANSCRIPTION_MODEL` | Backend; optional provider capability | No | No | Enables provider transcription only if supported by the chosen adapter/configuration. |
| `DIRECTOR_MODEL_PROFILE` | Backend; all environments | No | No | Defaults to `default`, descriptive profile identity. |
| `DIRECTOR_TIMEOUT_SECONDS` | Backend; all environments | No | No | Defaults 30s, positive and no greater than `DIRECTOR_MAX_TIMEOUT_SECONDS`. |
| `DIRECTOR_MAX_TIMEOUT_SECONDS` | Backend; all environments | No | No | Defaults 180s; provider-level upper bound. Must be set within the Vercel Function duration for synchronous API calls. |
| `DIRECTOR_MAX_REPAIR_ATTEMPTS` | Backend; all environments | No | No | Defaults 1; validated between 0 and 2. |
| `FFMPEG_PATH` | Backend; decoder-enabled environments | No | No | Optional path to an installed FFmpeg binary. Not bundled by the current Vercel config; without it, video frame extraction reports unavailable. |
| `AI_CALLBACK_SECRETS` | Backend only; callback-enabled environments | No | **Yes** | JSON object keyed by provider; only configure for implemented callbacks. The value must be valid JSON parseable by settings. |
| `PROVIDER_TIMEOUT_SECONDS` | Backend; all environments | No | No | Defaults 15s, bounded by max timeout. |
| `PROVIDER_MAX_TIMEOUT_SECONDS` | Backend; all environments | No | No | Defaults 60s, bounded at 60s. |
| `INTEGRATION_REDIRECT_URI_BASE` | Backend; integration-enabled environments | No | No | HTTPS application base URL in production; provider integration remains unavailable until provider setup and callback allowlisting are verified. |
| `BILLING_WEBHOOK_SECRETS` | Backend only; configured billing providers | No | **Yes** | JSON object of provider signing secrets. No unconfigured/unsigned webhook is accepted. |
| `TONDE_SERVER_TOKEN` | Backend only; trusted internal integrations | No | **Yes** | Shared bearer for specific server-to-server callback seams. Rotate only by an authorized operator; not needed for ordinary browser RLS requests. |
| `WORKER_ENABLED` | Backend; only persistent local worker (not Vercel) | No | No | Defaults false. Must remain false in Vercel Functions; a process-local infinite loop is not durable there. |
| `WORKER_ID` | Persistent worker only | No | No | Optional stable worker identity. |
| `WORKER_CLASS` | Persistent worker only | No | No | Defaults `media`; must be one of the registered durable classes. |
| `WORKER_INSTANCE` | Persistent worker only | No | No | Optional deployment instance label. |
| `WORKER_POLL_SECONDS` | Persistent worker only | No | No | Defaults 2 seconds; positive and no longer than idle wait. |
| `WORKER_IDLE_SECONDS` | Persistent worker only | No | No | Defaults 5 seconds. |
| `WORKER_BATCH_LIMIT` | Persistent worker only | No | No | Defaults 1; valid 1–25. |
| `WORKER_LEASE_SECONDS` | Persistent worker only | No | No | Defaults 300; 30–3600 seconds. |
| `WORKER_HEARTBEAT_SECONDS` | Persistent worker only | No | No | Defaults 60; at least 30 and below lease. |
| `WORKER_JOB_TIMEOUT_SECONDS` | Persistent worker only | No | No | Defaults 1800; 30–86400 seconds. Must respect actual processing runtime limits. |
| `WORKER_SHUTDOWN_GRACE_SECONDS` | Persistent worker only | No | No | Defaults 20; nonnegative. |
| `OUTBOX_ENABLED` | Backend/persistent worker | No | No | Defaults true; outbox is only delivered when a worker is actually running. |
| `OUTBOX_BATCH_LIMIT` | Persistent worker only | No | No | Defaults 10; valid 1–100. |
| `OUTBOX_LEASE_SECONDS` | Persistent worker only | No | No | Defaults 120; validated 30–3600 seconds. |

`TONDE_BACKEND_URL` is read only by the local hosted-acceptance runner, not by application runtime. Legacy `legacy/` environment variables are not runtime configuration.

## Product capabilities and honest limitations

The frontend's authentication uses Supabase JS PKCE, session restoration, real login/signup/password-reset pages, and a protected authenticated application subtree. API bearer tokens are verified by Supabase Auth; workspace membership is checked, and creator JWTs are used for RLS-scoped work. Mock/unit tests do not verify live OAuth, email delivery, or tenant isolation on the target hosted project.

The FastAPI backend exposes the implemented Studio, Real Production, AI-playbook direction, Shot Match/result-check, continuity, readiness, versioning, knowledge/Discover, media-upload, jobs, export, integration, publishing, and billing contracts. These are not all equivalent to live enabled features: provider credentials, supported job handlers, and current database migrations are required. TONDE is the Director, not a media-generation provider; it compiles creator-run external-tool directions. AI inference is optional and separately configured. This is consistent with Constitution Amendment E.

Durable jobs are represented in Supabase, with leases/retries/history, but the current runtime is an infinite worker loop, not a Vercel request handler. Implemented worker handlers are limited to prompt compilation, Shot Match, and knowledge ingestion. Many registry types remain explicitly unimplemented. No worker/cron is configured in this repo. Vercel Cron availability/duration depends on plan (Hobby has at most one daily invocation); it is not a drop-in continuously running worker. Do not enable `WORKER_ENABLED` in the Vercel app. Persistent or long-running media processing, FFmpeg frame extraction, scanning/derivation, and absent handlers remain blocked; use bounded work only where a tested request/job can fit actual function limits, otherwise retain durable pending/blocked status and human/provider execution.

## Verification performed in this workspace

- Frontend `npm run typecheck`: PASS.
- Frontend Vitest: PASS, 303 tests across 20 files.
- Frontend Vite production build: PASS; output contains separate marketing runner chunks. Vite warns that the main JS bundle is 966.37 kB minified (262.74 kB gzip); review further split points before public traffic.
- Marketing manually exercised via the local Vite interface: homepage renders native marketing shell and content; public routes are native and app routes remain protected. Full local Playwright suite: PASS, 33/33 (including all 9 marketing browser tests, app routes, responsive layout, auth gate and Studio flows). This is local browser evidence, not hosted acceptance.
- Root `npm test`: PASS, 366 tests.
- Root `npm run test:constitution`: PASS, 14 tests.
- `npm run verify:legacy`: PASS; active runtime boundaries and vocabulary checks.
- `node scripts/generate-database-types.mjs --check`: PASS (132 tables, 88 enums; generated artifacts unchanged).
- Hosted catalog comparison command: BLOCKED, not PASS. The script's historical saved log showed 4,087/4,087 and zero differences at the earlier certified revision, but the current invocation failed because Supabase returned 403 for linked catalog queries. Do not use the historical report as proof for this current checkout.
- Backend full pytest: PASS, 579 tests, 2 upstream Starlette/httpx deprecation warnings. `ruff check app tests`: PASS. `mypy app server.py vercel_app.py`: PASS, 114 files.
- Root database/product suite: PASS, 366 tests (including Prompt 1–11 regressions); constitution suite: PASS, 14 tests. Idempotent schema artifact verification: PASS, 3/3; generated types: PASS, 132 tables and 88 enums. Hosted catalog comparison is separately BLOCKED (403), and these local checks do not certify Supabase.
- The jsdom `window.scrollTo` diagnostic was removed by stubbing the unsupported browser API in test setup; the suite now reports clean completion. CSS scoping check: 0 unscoped rules. Frontend `npm audit --omit=dev`: 0 vulnerabilities.

## External blockers / exact next actions

1. **Vercel project/deploy:** no `vercel` CLI or `VERCEL_TOKEN`; project settings cannot be read. Owner/operator must link the existing `tonde-webapp` project to `Tornicles/Erector`, root config at repository root, production branch `main`; run a preview build and inspect `/`, `/api/health`, `/api/v1/me`, and SPA refresh paths. Do not use production deployment/traffic changes without approval.
2. **Supabase access and current schema:** `supabase projects list` returned an empty list; `supabase migration list --linked` returned HTTP 403. `SUPABASE_ACCESS_TOKEN` and DB password are missing. A maintainer must restore least-privilege project access; then compare ledger/catalog/advisors and run isolated two-user acceptance. Do not apply migrations or claim current hosted schema here.
3. **Frontend live project values:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are absent. Set Preview/Production values for their matching projects in Vercel; never set privileged keys in frontend environment.
4. **Backend Supabase values:** `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must match the frontend environment. `SUPABASE_SERVICE_ROLE_KEY` is required only for privileged server-owned operations; set only in backend service environment if authorized. Verify RLS remains enabled.
5. **Email and Google auth:** historical platform acceptance reported real email delivery blocked by provider/rate limits and Google disabled/missing OAuth redirect configuration. Reverify current project configuration and run real controlled signup/reset/OAuth acceptance only after inbox and credentials are configured.
6. **AI/media providers:** no live provider config was found in this workspace; core Director contracts may function without a generation key. If configuring inference, set server-only `DIRECTOR_*` values for a supported text/analysis provider; do not claim media generation. FFmpeg absent/unconfirmed; provider-backed scan, heavy media analysis, exports/publication delivery, and remaining job types need capability-specific verification.
7. **Domain:** `tonde.io`, `www.tonde.io`, and optional API subdomain/DNS/TLS are not verified. Add/validate in Vercel only after authorized account access; include exact domains in Supabase Auth redirect allowlist and backend CORS as applicable.
8. **Jobs:** decide an allowed Vercel+Supabase-compatible bounded invocation/dispatch process for currently implemented, short jobs, with retries/idempotency/concurrency measured. Long tasks and missing handlers remain BLOCKED. Do not start an infinite worker from FastAPI lifespan on Vercel.

A fresh Vercel deployment is required for root routing and backend entrypoint changes, Python dependency changes, and any changed environment values. Domain/Auth callback setting changes require corresponding dashboard configuration and usually a frontend redeploy when embedded public environment values changed.
