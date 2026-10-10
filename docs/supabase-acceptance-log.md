# Supabase hosted acceptance log — TONDE

> Note: the original version of this log was accidentally overwritten during an
> editing mistake on 2026-10-05. This file is a faithful reconstruction from the
> preserved command outputs (`scripts/hosted-acceptance.mjs` run logs, Management
> API responses) of the same day. All PASS rows below come from executed checks,
> not assumptions.

## Environment (historical run, 2026-10-05)

The historical account and configuration details below are retained for audit, not current proof. A new read-only/hosted acceptance run appears in the [Prompt 2 correction handoff](prompt-2-correction-handoff.md). **Current state (2026-10-08): the hosted ledger records 001–030, the untruncated catalog comparison against a rebuilt local catalog reports 0 differences, and the expanded two-user runner reports 538 pass / 1 blocked / 0 fail — see the [Pre-Prompt-10 certification](pre-prompt10-final-certification.md).** Everything below states the run that wrote it: local migration versions were 001–010 at the time; hosted history was rechecked at 001–008 when this log was written, and a later read-only recheck on 2026-10-07 reported the hosted ledger at 001–010 after the 009–010 repairs were applied by hand and the ledger repaired, with the hosted effect state at 001–014 — so 011–014 were applied without ledger rows and only 015–025 were then unapplied (see the [Prompts 1–9 audit](system-gap-audit-prompt1-9-final.md)). Authorship of the earlier remote migrations is not inferred. Historical advisor results are captured in the correction handoff; the current advisor run (0 ERROR) is in the certification report.

- Project: `cryujrhdnvofexzceosr` ("Tonde"), region `us-east-1`, status `ACTIVE_HEALTHY`, Postgres 17.
- Earlier log claimed migrations 001–007 were applied. At the time of this entry `supabase migration list --linked` showed versions 001–008 both local and remote; a later read-only recheck reported the ledger at 001–010 with the effect state at 001–014, so 011–014 were also applied without ledger rows. All of those readings are superseded by the 2026-10-08 record of 001–030. Versions/name alignment is not checksum/semantic equality. `supabase db diff --linked` was blocked by missing Docker/Podman, so equivalence is now compared untruncated (every table, column, constraint, index, policy, trigger, function body, type and ACL identity) through the Management API instead — 4087 identities and 0 differences.
- Current requests negotiate `Accept-Profile: tonde`; historical PGRST106 did not reproduce. `tonde_private` remains unexposed. Full migration-semantic equivalence is now established by the untruncated Management-API catalog comparison (4087 identities, 0 differences); the linked `db diff` route still needs Docker/Podman and was never used.
- Local/hosted version 008 `202610050008_tonde_schema_usage.sql` grants schema-level
  `USAGE ON SCHEMA tonde TO anon`; current catalog inspection confirms no anon table
  privileges, and current HTTP workspace read returns 401. No table/sequence/routine
  privileges are granted by 008.
- Grants: authenticated has intended table grants; `anon` has schema USAGE but no table grants on `tonde`; HTTP anon workspace read returns 401. `tonde_private` currently denies anon/authenticated schema USAGE. The local-only migration 010 proposes authenticated schema usage for policy helper execution while keeping the schema unexposed and tables ungranted; hosted grants are unchanged.
- Auth: Site URL and redirect allow-list configured for local origins
  (`/auth/callback`, `/auth/reset` on localhost and 127.0.0.1);
  `mailer_autoconfirm=false` (restored after a temporary acceptance enablement);
  email provider enabled; Google provider disabled.

## Live acceptance run (`npm run verify:hosted`, scripts/hosted-acceptance.mjs)

Two genuinely separate authenticated accounts A and B; real hosted Auth/Data API/Storage; exit 0. Latest run output is recorded in the [correction handoff](prompt-2-correction-handoff.md); temporary user/object identifiers are deliberately omitted.

| Check | Result | Detail |
|---|---|---|
| Anonymous cannot read tonde.workspaces | PASS | HTTP 401 |
| A has exactly one profile | PASS | single row |
| A has exactly one personal workspace | PASS | owner_user_id = A |
| A is owner member of that workspace | PASS | role owner |
| Repeat login creates no duplicate workspace | PASS | count=1 |
| B sees only own workspace | PASS | distinct id |
| A creates a production (Projects→Studio) | PASS | rpc HTTP 200 |
| Real is the default execution method | PASS | `real` |
| Title save persists after reload | PASS | value round-trips |
| A can archive a production | PASS | HTTP 200 |
| Hard deletion is rejected | PASS | delete HTTP 403 |
| B cannot read A's production by ID | PASS | empty result |
| B cannot mutate A's production | PASS | no effect |
| B cannot create inside A's workspace | PASS | HTTP 403 |
| A registers media metadata | PASS | HTTP 201 |
| A uploads directly to private Storage | PASS | HTTP 200 |
| Anonymous denied for private Storage objects | PASS (historical run) | list/sign/public denied |
| B cannot sign/read A's Storage path | PASS | sign HTTP 400 |
| B cannot upload against A's metadata | PASS | HTTP 400 |
| Backend `/api/ready` for A | PASS | HTTP 200 |
| Backend `/access` rejects B | PASS | HTTP 403 |

Result: the historical runner was **20/20**. A later scoped runner returned **39/39** after adding caller-scoped helper RPC checks, limited approval checks, anonymous target non-visibility, and reciprocal A/B private-object read, sign, upsert and delete denial probes; see the correction handoff for exact scope. Both are superseded by the expanded 2026-10-08 runner (**538 pass / 1 blocked / 0 fail**, populated fixtures, ten approval sets, all six buckets); see the certification report. None of these is full per-resource/all-bucket/approval-matrix/Auth-provider acceptance; cleanup is best-effort and should be independently rechecked after any run. The latest runner exits nonzero if it records failures or blocked checks; it does not count BLOCKED as passed.

## Blockers / not verifiable without external credentials

- Google OAuth PKCE callback: provider disabled, no OAuth client. BLOCKED per AGENTS.md.
- Email verification/password-reset delivery: no SMTP/inbox configured. BLOCKED per AGENTS.md.
- The earlier gate deferral allowed Prompt 3 work to proceed, but it does not imply full acceptance. Current overall gate is BLOCKED; see [correction handoff](prompt-2-correction-handoff.md). A named follow-up must verify these providers before full acceptance.
