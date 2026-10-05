# Prompt 1 engineering handoff

## Status

**Local foundation is present; current combined acceptance is BLOCKED.** On 2026-10-05 the linked hosted project was re-inspected read-only. The migration list reports versions 001–008 locally/remotely; 009–010 are pending local corrections. The latest scoped hosted runner passed 39/39. Its cleanup is best-effort in `finally`; a separate post-run read-only audit found zero matching temporary users, profiles, workspaces, memberships, acceptance projects/productions, media records, or registered test objects. This is not complete tenant/resource, six-bucket Storage, approval-matrix, email/Google or schema-diff proof. See the [correction handoff](prompt-2-correction-handoff.md) and [acceptance log](supabase-acceptance-log.md). No hosted migration was applied.

## What changed

React/TypeScript/Tailwind now run a TONDE shell with Home, Studio, Projects, Discover, Assets, Setup and first-class Settings. Supabase is the sole configured session/data authority; no mock auth exists. Projects creates a Project and Production atomically. Studio loads an identified production, defaults to Real Production, switches to AI Creation, persists selected production per workspace, and exposes header/tools/canvas/Director/timeline composition. Title autosave is debounced, serialized, revision-aware and truthful about offline/failure/conflict. Remaining areas clearly identify foundation-only functionality.

FastAPI now boots without an external database connection and uses Supabase user-token forwarding and verified Auth sessions. Liveness and readiness are distinct. Typed specialized intelligence/job/media/secret contracts exist without fabricated results or fake queue execution.

## What was reused

React root, strict TypeScript, Tailwind/CSS token pattern, Lucide icons, request correlation, generic token hashing and the API envelope concept. Generic logging/CORS were strengthened. The claimed donor AppLayout/AIChat/Shadcn/StateComponents were absent, so those were not falsely reported as reused.

## What was removed from the active runtime

Mongo connection/index/seed boot; custom JWT/magic-link mock/session database; economic/business validation/context/Bhudhi/live-feed routes; old pages/types/mobile scaffold; obsolete dependency and hosting configuration. Tracked donor files are deliberately quarantined under `legacy` until external-data/rollout verification is possible. There is no legacy runtime fallback. Original client metadata was left untouched.

## Supabase foundation

Seven source migrations establish 39 relational tables and 9 canonical enums in `tonde`, plus private encrypted-credential persistence in `tonde_private`. Identity/membership/profile/preferences, Projects/Productions/Series/Collections/Episodes, optional Acts/Sequences/Scenes/Shots, Setup/resources/kits, Assets/media/references, documents/dialogue, execution plans/scoped bindings, versions/dependencies, Director threads/messages, Results/Shot Match, exports/jobs, integration connections, billing usage and audits are represented.

All app/private tables enable RLS. Membership helpers are non-recursive. Composite FKs protect workspace and production boundaries. Important hard deletes are restricted; approval/lock/history behavior is separate. All six initial buckets are private with metadata-backed authenticated policies, MIME/size limits, signed read boundaries and no browser export/overwrite/delete access.

Generated TypeScript reflects migrations, not a competing handwritten persistence schema.

## Tests at current checkpoint

- 16 actual embedded-PostgreSQL migration/RLS/integrity/bootstrap/history/storage-policy tests passed, including a 300-shot integer-duration/query-boundary case.
- 18 React/DOM tests passed after adding token-refresh and in-flight autosave regression coverage.
- 9 backend tests passed; mypy and Ruff passed.
- Production frontend build passed.
- 4 real Chromium interface tests passed with explicitly mocked Supabase HTTP fixtures; no fake auth is shipped in the app.
- Active legacy boundary check passed.

Final verification also passed full npm dependency audits (frontend and root), Python dependency audit, and Git whitespace checks. Tool dependencies were updated after advisories were detected. Backend tests emit upstream TestClient deprecation warnings; they are not suppressed. The local database tests supply minimal Supabase platform schemas; they do not verify hosted Auth/Storage/PostgREST. Browser tests verify the real application interface with transport fixtures, not real Google OAuth or email delivery.

## Remaining external configuration

1. Linked development project is confirmed by CLI ref/host URL; no secret values are included in this report.
2. Read-only hosted schemas, policies, functions, grants, buckets, enum/type shape and versions were inspected. Full semantic schema diff remains BLOCKED by absent Docker/Podman.
3. `tonde` schema use and hosted HTTP data behavior are verified; anon workspace read is denied. `tonde_private` remains unexposed.
4. Google OAuth is disabled; email confirmation is required and SMTP delivery is unverified. Both remain BLOCKED.
5. Latest scoped live two-user run passed 39/39, including limited creator/service-role approval checks; the broad tenant-resource, all-bucket, comprehensive approval and provider acceptance remain BLOCKED.

A server service-role key is never needed by the browser and is not used for normal CRUD. It is optional until authorized privileged services are implemented.

## Schema evolution / technical debt

Use new additive migrations with explicit grants/RLS/storage tests and regenerate types. Keep one Production and attach execution-specific plans. Branch/merge intelligence, durable queue/outbox/worker, malware scanning, large-video ingest, encryption adapter, account purge and actual AI/export/billing/integration providers remain explicitly deferred to their later prompts. No pricing, fake AI output or demo production data is installed.

The large donor quarantine is intentional safety debt; remove after hosted validation/retention review. Settings/Assets/Setup/Discover are foundation views, not their final experiences. Initial media upload ceiling is 50 MB and all initial media stays private. Hosted migration/security reconciliation, broad live acceptance and Auth provider setup remain external blockers; these are not the sole unresolved release gates.
