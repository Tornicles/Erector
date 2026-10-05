# TONDE architecture decisions

These technical decisions implement the authoritative [TONDE Product Constitution](product/constitution.md). The [glossary](product/glossary.md) resolves storage/product terminology. Any conflict requires a documented repair or constitutional amendment, never silent reinterpretation.

## ADR 001 — Supabase is the canonical application data platform

**Accepted.** Relational identity, hierarchy, ownership and security are PostgreSQL concerns. Supabase supplies PostgreSQL, Auth, private object storage and a policy-aware Data API. Tables live in an explicit `tonde` schema; `tonde_private` is not exposed. New migrations, not out-of-band SQL or application startup seeders, are the schema authority. JSONB is limited to flexible metadata, snapshots, findings and structured messages—not the production graph.

## ADR 002 — One authentication authority: Supabase Auth

**Accepted.** `auth.users` owns authentication. Browser sessions use the official Supabase client with PKCE, refresh and restoration. Application profiles contain no passwords or auth secrets. FastAPI validates bearer sessions against Supabase Auth; no custom JWT issuer, mock login or debug bypass exists. Bootstrap uses a trigger plus a recoverable authenticated RPC, advisory serialization and a unique personal-workspace constraint. Hosted OAuth/email settings must be verified separately.

## ADR 003 — Master Production with execution representations

**Accepted.** Project is the organizational container; Production is creative truth. Optional Acts/Sequences lead to Scenes/Shots; a photograph can have shots without a scene. `execution_plans` attach Real or AI data to the same shot; hybrid is assignment, not cloned creative objects. UUIDs identify objects; positive-gap bigint order values are reorderable display positions. Deferrable unique ordering supports atomic swaps; future reorder RPCs must lock the relevant parent and handle concurrent edits.

All critical time values are integer milliseconds capped at JavaScript's exact integer range. Parent targets and calculated child sums remain distinct; future planning operations validate sums using integer arithmetic. No floating-point timeline seconds are persisted.

## ADR 004 — Workspace is the security/ownership boundary

**Accepted.** Every workspace-owned record includes workspace identity, and composite foreign keys prevent cross-tenant joins. Hierarchy keys also include production identity. Non-recursive membership helpers use a fixed empty search path and the authenticated `auth.uid()` only. Viewers read; editors/admins/owners edit allowed creative data. Membership, billing, jobs, exports, generated findings and credentials are server-managed. There is no user self-promotion API. Archived/deleted workspaces disable normal membership access.

Important objects are archived/logically deleted, not freely hard-deleted. FK restrictions preserve history. Trivial join removal is allowed to editors; permanent account/media purge requires a later audited retention service.

## ADR 005 — Media is independent of creative identity

**Accepted.** Assets, references and results link to media records, not filenames. Media records identify provider/bucket/object, ownership, MIME/size, lifecycle, retention and derivatives. Supabase object paths use `workspace/media/source`; path predictability does not authorize reads. All initial TONDE buckets are private; short-lived signed URLs require RLS-visible metadata. Public publication is intentionally unavailable until explicit opt-in and a separate policy are added.

The current direct-upload boundary is 50 MB (avatars 5 MB). Browser MIME validation is only UX; bucket MIME/size constraints enforce the upload boundary. Content sniffing/scanning must precede future processing. Large-video multipart/provider-specific ingest is not routed through FastAPI or enabled yet. S3/R2 adapters can preserve media UUIDs.

## ADR 006 — Privileged AI/media services remain server-side

**Accepted.** FastAPI is an execution boundary, not an alternative persistence/auth application. Its gateway forwards verified user JWTs to Supabase, preserving RLS. Future service-role operations must explicitly authorize the user's membership/role before privileged access. Secrets are server-only `SecretStr`; provider tokens require encrypted ciphertext in a non-exposed schema. No encryption adapter, billing provider, AI provider or worker is claimed configured.

`backend/app/domain/product.py` enforces evidence access/analysis versus claimed modalities, estimates/recommendations, explicit partial outcomes, scoped proposals versus confirmed consequential application, and a separate consent-controlled voice cloning request. Services must verify supplied evidence/consent IDs against persistence; validation alone is not legal authorization or a guarantee of statement accuracy. Opaque `structured_output` is explanation/analysis, not mutation authority; only validated scoped proposals enter application services. Every result pins source versions and production identity.

`backend/app/services/contracts.py` exposes separate Director, planning, story/script, Real planning, AI compilation, Hybrid, continuity, impact, media analysis, Shot Match, export, production memory and routing operations. They share production/object/version IDs and typed output schemas. There is no catch-all prompt engine or fabricated AI response.

## ADR 007 — Practical history, not a database Git clone

**Accepted.** A relational object registry provides real targets for versions, scopes, conversations and dependency edges. Main-line updates automatically increment revision and append immutable snapshots with actor, timestamp and parent version. Approval and lock are independent; creative changes after approval mark `changed_after_approval`; locked content requires explicit unlock. Prompt 2 adds a database guard: new Approved/Final acceptance requires an authenticated creator-authorized write, cannot be issued by service-role/system execution, and cannot combine changed content with approval. Editing an accepted Result resets its result state to Needs Review. Optimistic browser writes filter by the loaded revision and report missing writes as conflicts. Branch fields and parent versions anticipate Prompt 9; branch creation/merge behavior is not implemented.

Autosave is local to the loaded Studio production: debounced, serialized and revision-aware. Only resolved persistence reports Saved. Offline/error/conflict states retain dirty input; beforeunload and route blockers protect unsaved changes. Reloading on conflict deliberately discards local input after user-directed recovery; there is no silent merge.

## ADR 008 — Bounded queries and honest asynchronous work

**Accepted.** Production lists and hierarchy slices are capped at 40 rows. The Studio loads production metadata plus one scene page, not every shot. Conversation/version access must use indexed cursor boundaries (`created_at`, `id`) in future services. Realtime subscriptions are not enabled globally.

Jobs persist input/output identities, state, progress, attempt counts, available time and lease metadata. Dispatcher/worker contracts exist but no synchronous request masquerades as a background job. Prompt 11 must choose a durable queue, transactional enqueue/outbox, atomic lease claim, idempotent completion, cancellation and retry semantics. No job is queued by the current UI.

## Active surface and limitations

- Functional authenticated route wiring, atomic project/production creation, archive, Studio title persistence, selection and Real/AI face state.
- Foundation-only Discover/Assets/Setup/Settings views; schema/service foundations exist, full feature forms come in their later prompts.
- Disabled exports/Director messages are explicitly labeled, not fake functionality.
- Structured logging is allowlisted: correlation IDs, event codes, request status/time and exception type; no tokens, SQL, raw creative content, media or arbitrary exception messages.
- Donor code is isolated under `legacy`, outside runtime/tests/deployment. Delete it only after actual hosted rollout/data-retention checks.
