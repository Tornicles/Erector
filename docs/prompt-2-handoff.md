# Prompt 2 engineering handoff

## Gate (historical record; superseded by correction review)

**Historical internal Prompt 2 implementation report: PASS.**  
**Current combined Prompt 1–3 acceptance: BLOCKED.** See the [Prompt 2 correction + Prompt 3 reconciliation handoff](prompt-2-correction-handoff.md) for current evidence, migration discrepancy, hosted status, repairs and remaining gates. This historical document is not proof of current hosted state.

Historical narrative: local project configuration appeared concurrently during earlier verification. Earlier handoffs conflict about whether remote migration changes were made. Current CLI evidence lists hosted versions 001–008; authorship is unknown. Do not rely on this prior narrative in place of the correction report.

Current hosted evidence is in the [correction handoff](prompt-2-correction-handoff.md), not in this historical narrative. The latest 39/39 runner is limited-scope. Local repairs 009–010 are not applied; hosted security advisor warnings remain. Data API `tonde` negotiation works and anon reads are denied (HTTP 401), but the former PGRST106 condition is not present. Google is disabled and email delivery is not verified. Do not treat this record's historic claim or gate deferral as full hosted acceptance.

### Gate deferral (owner decision, 2026-10-05)

The product owner directed that Google OAuth and email/SMTP be **deferred (BLOCKED, not verified)** so Prompt 3 may begin and the items be added later. Rationale: the Google and email flows are already implemented in Prompt 1 (`/auth/callback`, `/auth/reset`, `signInWithOAuth`, `resetPasswordForEmail`); only external credentials are missing, and no Prompt 3 work supplies them. This is a process/gate deferral, not a change to product meaning, so no constitution version change is recorded.

Recorded effect:

- Prompt 3 (visual system) may proceed.
- The two items stay **BLOCKED**, never reported as PASS; a named follow-up re-runs them before any claim of full Prompt 1/2 acceptance.
- The `legacy/` quarantine is **not** removed and Prompt 1 is **not** declared fully accepted.
- Runtime behavior is unchanged and truthful: Google sign-in fails closed with an explicit "unavailable" message; email verification stays required (`mailer_autoconfirm=false`) and is simply undeliverable until SMTP is configured.

Named follow-up (required before full acceptance): add a Google OAuth client and an SMTP sender, then run the Google callback and email verification/recovery checks in the [runbook](supabase-runbook.md) and record results without secrets.

## Product Constitution

The permanent authority is [TONDE Product Constitution v1.0.0](product/constitution.md), dated 2026-10-05, with explicit conflict resolution, amendment process and meaningful revision history. Its [glossary](product/glossary.md), [32 invariants](product/invariants.md), and [all-110-requirement compliance report](product/compliance.md) form one source of product meaning. README, AGENTS, architecture and migration guidance reference it.

## Constitutional decisions

- One Master Production; Real/AI attach execution instructions to its same Shots; Hybrid is per-Shot strategy; Real Production remains default.
- Shot Match loop: Reference → Direct → Create → Upload Result → Check → Fix → Approve.
- Home = Start + Action Queue; Studio = production creation/iteration; Projects = finding/managing work; Discover = production knowledge; Assets = reusable entities; Setup = production capabilities; Settings = account/application.
- Optional hierarchy/seasons; exact timing; first-class dialogue; canonical information lives once, historical artifacts pin source versions.
- Explicit human acceptance; locks independent; consequential proposals preview impact before applying; reversible history.
- Accessible/analyzed evidence controls media claims; distinguish Observed/Estimated/Recommended, partial success and failure.
- Voice direction is not cloning; cloning needs current scoped consent verified by future services. Rights/real-person/originality policies and non-goals are explicit.
- Specialized intelligence, not a giant model call; deterministic application facts remain deterministic; generation APIs optional.
- V1 target identity is distinguished from shipped foundation and optional conveniences. No later engines built.

## Terminology and application changes

Added Product Film/Trailer to the existing production type vocabulary. Kept established Project/Production/Series Collection/Environment/Resource storage names and documented exact mappings instead of risky renames. Generated shared labels replace underscore-derived production/approval text; YouTube and Changed After Approval render canonically. Studio and navigation use shared constitutional constants; normal Real default and all routes remain unchanged.

`product/vocabulary.json` is the source for display/non-persistence product codes; migrations remain the source for database enums. `scripts/generate-database-types.mjs` produces typed frontend database/product vocabulary and Python enums, checks exact SQL-label coverage, and has `--check` for CI drift detection. Generated artifacts must not be hand-edited.

## Schema impact (historical Prompt 2 implementation record)

At initial Prompt 2 implementation only additive migrations 006–007 were introduced. The current forward security corrections also include migrations 009–010; linked hosted state is 001–008, so both corrections are pending. See the current [reconciliation matrix](prompt-2-correction-handoff.md#3-migration-reconciliation). Earlier Prompt 1 migrations remain unchanged. Table count remains 39. Classification adds `product_film`/`trailer`; eight bounded text/check workflows become typed enums (reference source/rights/state, dialogue kind, binding role/inheritance, message role, proposal state), bringing the SQL enum count to 17. Values/defaults/identities/history are preserved; no data import, table/bucket rename or deletion.

Human-acceptance triggers reject automatic system/service-role Approved/Final transitions, reject simultaneous content-change/new-approval requests, and reset accepted Result evidence edits to Needs Review. The initial Prompt 2 migration recreated the Director message INSERT policy with identical authorization and made no Storage change. Subsequent local-only migration 010 relocates policy helpers and rewrites dependent policies/trigger/RPC bodies; it has not been applied remotely. Casts require table locks; review hosted counts/external schema and schedule safely. Reversing enum changes is a reviewed new migration, not deleting migration history.

## Contract impact

Backend product contracts validate accessible/analyzed modalities and cited evidence, estimates/uncertainty, partial limitations, distinct consent-controlled voice capability, scoped/versioned proposals, prohibited hidden acceptance and consequential confirmation. OperationResult now requires workspace/production/scope identity, source versions and grounding; future providers must implement this stricter contract. No existing runtime provider endpoint consumes it. Supplied IDs/consent still require authorized database verification; validation cannot prove legal consent, human intent or real semantic truth.

## Historical verification snapshot

The counts below in this section are historical only and are superseded by the current correction report. Pre-change Prompt 1 reported 47 tests passed, frontend build/typecheck, backend mypy/Ruff passed.

Historical test snapshot only: those reported 73 tests are not current evidence and the original counts have since changed. Final rerun for this correction is recorded in the [correction handoff](prompt-2-correction-handoff.md): root 30/30, frontend Vitest 47/47 and Playwright 7/7, backend pytest 17, plus frontend typecheck/build, mypy, Ruff, generated artifact check and legacy-boundary check. The hosted 39/39 result remains scoped, not full hosted acceptance. Limited creator/service-role approval probes passed; comprehensive approval, full migration semantic reconciliation, hosted provider and all-bucket acceptance remain BLOCKED.

Historical commands and coverage:

- Root `npm test`: real PostgreSQL clean/upgrade migrations, Prompt 1 RLS/bootstrap/storage-policy/history/hierarchy and new constitution/domain/document compliance.
- `node scripts/generate-database-types.mjs --check`: generated schema/vocabulary and labels match sources.
- `npm run verify:legacy`: no active legacy runtime imports.
- Frontend `npm run typecheck`, `npm test`, `npm run build`, `npx playwright test`: canonical types/terms plus original routes/Studio/autosave/security/browser regressions.
- Backend pytest/mypy/Ruff: original server auth/boundaries and new grounding/consent/proposal contracts.

Browser/transport tests use explicit fixtures; PostgreSQL fixtures include minimal Supabase platform schemas. These do not prove hosted signup/email/Google or Storage HTTP. Upstream TestClient deprecation warnings remain visible, not suppressed. The current frontend build reports a non-failing 554.66 kB chunk-size warning (162.55 kB gzip); route splitting is later optimization, not a claimed performance result.

## External blocker and exact follow-up

Outstanding hosted follow-up: review and safely apply the forward-only local corrections 009–010 to the confirmed project, verify PostgREST policies and security advisor output, run complete two-user resource/RPC/approval/six-bucket Storage acceptance, and resolve email/Google configuration if required. The hosted migration list currently reports 001–008; local 009–010 are not hosted. Full schema semantic diff is blocked by missing Docker/Podman. See the [runbook](supabase-runbook.md) and current [correction handoff](prompt-2-correction-handoff.md); do not reset or infer hosted acceptance from mocks.

## Current correction status

Prompt 3 work is preserved and its local visual-system regression is re-run as part of correction. Prompt 4 is **not authorized by verification status**: hosted security corrections and required hosted/Auth gates remain BLOCKED. See [correction handoff](prompt-2-correction-handoff.md).
