# Supabase reconciliation and rollout runbook

## Stop condition: hosted application acceptance is incomplete

Current correction evidence is recorded in the [Prompt 2 correction handoff](prompt-2-correction-handoff.md). The linked project and read-only SQL access are available. `tonde` Data API access now negotiates in the hosted request; the historical PGRST106 condition did not reproduce and anon workspace reads return HTTP 401. Migration history is 001–008; local security corrections 009–010 are not deployed. A scoped 39-check two-user acceptance passes, including limited creator/service-role approval probes; complete resource, all-bucket, approval-matrix, OAuth/email, advisor-after-correction and schema-diff gates are not accepted. Never interpret the scoped test as full hosted acceptance.

Required access: correct development project URL/ref and public key; authorized database/CLI or dashboard inspection access. A service-role/secret key is server-only and is needed only for privileged services/verification, not for browser CRUD. Do not paste production secrets into source or screenshots. Prefer local ignored environment files.

## Inspect before applying

1. Confirm organization/project identity and environment (development vs production).
2. List existing schemas/tables/views/functions/triggers, migration history and row counts. Export schema metadata using Supabase CLI; export existing business data only with retention authorization and protected storage.
3. Inspect Auth email/password/signup/verification/SMTP and Google enabled state, project Site URL, allowed redirects, and existing users. Never dump passwords/provider tokens.
4. Inspect every bucket's privacy/MIME/size configuration and existing `storage.objects` policies. Broad existing policies applying to all buckets can bypass new narrow TONDE policies; reconcile those before rollout.
5. Inspect RLS and grants on exposed schemas/tables and policies. Keep `tonde_private` unexposed.
6. Check for externally created `tonde`, `tonde_private`, `tonde_*` buckets and `tonde_user_created` trigger. Migrations deliberately fail on collisions; compare, adopt with a reviewed migration/baseline, or choose a migration plan—not DROP.
7. Compare hosted migration history with source. Preserve data; do not mark migrations applied merely to silence errors.

Useful read-only SQL (run through authorized SQL access):

```sql
select schemaname, tablename from pg_tables where schemaname not in ('pg_catalog','information_schema');
select schemaname, tablename, policyname, roles, cmd from pg_policies;
select n.nspname, c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r';
select id,name,public,file_size_limit,allowed_mime_types from storage.buckets;
select version from supabase_migrations.schema_migrations order by version;
```

## Apply only to the reviewed development project

1. Take a protected backup/snapshot and establish recovery steps.
2. Review all source migrations in order (001–010); linked hosted history currently reports 001–008, and corrections 009–010 remain local-only. The reconciliation report contains the per-version matrix and outstanding drift. Local migration 010 proposes authenticated USAGE on `tonde_private` solely so RLS/Storage expressions can execute private helpers; keep the schema out of PostgREST and do not grant clients table access. Hosted grants have not changed. Prompt 2 enum casts take table locks and must be scheduled against reviewed row counts. Do not assume matching history labels prove SQL equivalence. Existing Auth users are bootstrapped only on new-user trigger or their own authenticated RPC.
3. Link using the official Supabase CLI to the confirmed project. Check migration dry-run and schema diff; then apply reviewed migrations. **Never use a remote reset.**
4. Reconfirm Data API exposure before rollout: `tonde` currently negotiates and is used by the browser client; `tonde_private` must remain unexposed. Schema exposure, SQL grants and RLS are distinct. If migration 010 is reviewed and applied, authenticated needs narrowly scoped schema access to run private policy functions, but no direct credentials-table privilege.
5. Set frontend public URL/publishable or anon key; set backend matching URL/public key. Restart dev servers after changing environments.
6. Set Auth Site URL and exact callbacks: `/auth/callback` and `/auth/reset` under the appropriate application origin. Local origins are development-only; production uses HTTPS. Configure hosting to serve the SPA entry on app routes.
7. Enable email/password, signup/verification according to policy; configure production SMTP to send verification/reset email. Enable Google with authorized OAuth app client ID/secret and the Supabase provider callback URI.

## Bucket rules

Private by default: `tonde-uploads`, `tonde-asset-references`, `tonde-production-media`, `tonde-results`, `tonde-exports`, `tonde-avatars`. No public read policy exists. Signed URLs expire after 60 seconds in the browser service. Every object must match an existing media metadata record and membership. Uploads are direct browser-to-Storage and upsert is disabled. Browser export writes are prohibited; no normal client deletion/overwrite policy exists.

Important: existing broad permissive Storage policies can grant additional access because PostgreSQL ORs permissive policies. A hosted project audit is essential; local tests cannot prove unknown hosted policies are absent.

## Mandatory live integration checklist

Use two genuinely separate authenticated accounts A and B, not just service-role queries.

- [ ] Signup/login/verification deliver email and create exactly one profile/personal workspace/owner membership.
- [ ] Repeat login/refresh/restoration never creates duplicates.
- [ ] Google returns through the configured PKCE callback; logout restores route protection.
- [ ] Password reset opens a recovery session and changes the password; ordinary sessions cannot be confused with expired recovery links.
- [ ] A creates a production through Projects and opens Studio; title save persists after reload, Real is default, AI face is selectable.
- [ ] A can archive a production; hard deletion remains rejected.
- [ ] Approval is a separate authenticated creator action; service-role/system cannot auto-approve or finalize, and content edits of accepted work require fresh review.
- [ ] B cannot read or mutate A's project/production/assets/media/references/messages/results/exports by manually changing IDs.
- [ ] Anonymous users cannot read TONDE schema records or private Storage objects.
- [ ] A uploads an allowed small file directly; A and B cannot read/sign/upsert/delete each other's private production-media objects; each owner retains access afterward. Test the other five buckets before acceptance.
- [ ] Oversize/executable MIME uploads are rejected by Storage, not just browser validation.
- [ ] Service-role/server secrets are absent from production browser bundles.
- [ ] Backend `/api/ready` succeeds for A; cross-workspace `/access` rejects B.
- [ ] Existing unrelated schemas/data and policies remain intact; rollout has no critical runtime errors.

Record project/environment/date and outcomes without secrets. Only after this gate should the legacy quarantine be deleted and Prompt 1 be declared fully accepted.
