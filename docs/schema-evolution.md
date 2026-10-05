# Persistence extension checklist — Prompts 2–11

First read the authoritative [Product Constitution](product/constitution.md), [glossary](product/glossary.md) and stable [invariants](product/invariants.md). Cite affected invariants before extending persistence; product conflicts require explicit amendment or implementation repair.

Every prompt modifying persisted state must record:

- Schema impact: added/changed/retired entities, typed fields and JSONB justification.
- Ownership: workspace/user boundary; actor and relationship integrity.
- Hierarchy/scope: production/parent semantics, optional levels and durable UUID identity.
- Status/approval/lock: use canonical enums; do not conflate approval with locking.
- Timing: integer milliseconds only; safe bounds, overflow and exact child sums.
- Revision/history: expected-revision writes; source action, parent version, approved-change detection.
- Relationships/deletion: FK targets, cross-production checks, restrict/cascade rationale, archival/retention recovery.
- Access: explicit grants, new RLS policies/helper scope, role behavior, two-user tests and viewer-denial tests.
- Storage: new bucket privacy/type/size, explicit publication vs private access, signed URL expiry, policy interaction with existing hosted policies.
- Indexes: identify the actual bounded query; avoid indexing every field.
- Backfill/compatibility: deployment order, old/new clients, nullable transition, locking/time cost and rollback plan.
- Tests: clean migration, upgrade from previous migration set, data constraints, authenticated isolation, end-user API/browser behavior.

## How to add a migration

Create `supabase/migrations/YYYYMMDDHHMM_<domain>.sql` with a transaction where compatible. Do not edit an already applied migration; follow it with a repair/backfill migration. Test against an isolated database, not unknown production. Do not introduce unconditional DROP/TRUNCATE. Explicitly grant intended operations and enable RLS before exposing a table.

Regenerate database types, frontend product constants and Python vocabulary via `node scripts/generate-database-types.mjs`; validate their diffs. `--check` fails on stale generated artifacts or display labels that disagree with SQL enum values. Change software labels/non-persistence product codes in `product/vocabulary.json`, not generated files. That generator intentionally produces simple table interfaces from source migrations; hosted CLI generated types can add relationship metadata after reconciliation but must correspond to the same migrations.

## How to add private storage safely

Use a unique namespaced bucket, declare MIME/size constraints and private status, and add metadata-backed policies. Test anonymous, another workspace, viewer and editor access. Review existing hosted permissive policies; policy addition alone cannot revoke a broad old grant. Do not put application credentials or provider tokens into media metadata. Publication is an explicit audited copy/link operation, not a blanket public bucket.

## Extension targets

- Prompt 2: canonical terms/product flow; retain Project vs Production and Settings vs Setup.
- Prompt 3: visual system; preserve accessibility, responsive boundaries and truthfulness.
- Prompt 4: Director/model routing; implement contracts, structured validation and proposals with version IDs.
- Prompt 5: Studio OS; hierarchy/pagination, autosave/mutation contracts and named panel boundaries already exist.
- Prompts 6–7: extend execution plans rather than duplicate shots/scenes.
- Prompt 8: long-form/series intelligence uses the same Production and optional hierarchy.
- Prompt 9: branch/approval/continuity/Shot Match; extend object registry/history/dependencies and explicit conflict handling.
- Prompt 10: integrations/billing; encrypted secret adapter, server authorization, idempotent webhooks, no user-managed billing rows.
- Prompt 11: durable queue/outbox/leases, telemetry, scanning/large video, retention/account deletion, deployment hardening.

## Prompt 2 compatibility notes

Migrations 006–007 extend classifications, convert CHECK-constrained workflow codes into enums without changing values, and add human-acceptance guards. Type conversion requires table locks: review existing row counts and schedule the migration appropriately. No existing tables/data are dropped, imported or renamed. The Director-message INSERT policy is recreated within the transaction with the same authorization. Existing main-line versions and identities are preserved in upgrade tests. No bucket/RLS permission expansion occurs.

Future background services must NOT approve via service-role even when they know a user's UUID. Apply creative proposals with authorization and preserve separate creator acceptance of the reviewed version. Do not combine content changes with a new approval. Existing approved versions are retained; editing a final/approved Result requires fresh review.

## Existing intentional limits

Initial main-line snapshots are automatic; branches/merges are contracts only. Job execution and exporters are not active. No realtime subscriptions are installed. CRUD lists are bounded, but future conversations/history must introduce keyset cursor services. All media is private; large files above 50 MB and public publication are disabled. Profile/preferences have persistence but full settings UI is later work. Team models exist, but membership management must use a future authorized server operation.
