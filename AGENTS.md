# TONDE contributor instructions

Before product/UX/domain/AI/persistence changes, read the authoritative [TONDE Product Constitution](docs/product/constitution.md), [glossary](docs/product/glossary.md) and [invariant register](docs/product/invariants.md). A conflict requires explicit repair or versioned amendment; never introduce a second product interpretation.

- One Master Production; Real/AI plans attach to its same Shots. Real Production is the default Studio face. Hybrid is per-Shot assignment.
- Setup = production equipment/software/tools; Assets = reusable entities; Settings = account/application preferences. Preserve the seven responsibility boundaries.
- Never fabricate unavailable-media analysis, false certainty, completed AI features, human approvals or hosted verification.
- Keep exact timing/authorization/order/status logic deterministic. AI reasoning returns scoped, validated proposals; consequential application requires creator authority and impact preview.
- Edit `product/vocabulary.json` and additive SQL migrations, then run `node scripts/generate-database-types.mjs`. Do not hand-edit generated frontend/Python vocabulary. Verify with `--check`.
- Run constitution and Prompt 1 foundation/security regressions. Record internally failed checks as failures and repair them; external credentials/provider configuration may be BLOCKED.
- Read [schema evolution](docs/schema-evolution.md) before schema changes. Do not rewrite applied migrations, bypass RLS or expose service-role credentials.
- Historical `legacy/` is not runtime, a fallback auth implementation or product documentation.
- Live Supabase acceptance is still blocked: linked hosted migrations 001–008 are present, but semantic schema diff is blocked by missing Docker/Podman; the old PGRST106 condition did not reproduce and anon `tonde.workspaces` reads return 401. Local repairs 009–010 remain unapplied; Google is disabled, email delivery is unverified, and broad real-user resource/six-bucket Storage/approval acceptance is incomplete. See [correction handoff](docs/prompt-2-correction-handoff.md) and [runbook](docs/supabase-runbook.md); passing local/mocked tests do not prove hosted acceptance.
- Do not build later engines just because the constitution defines them. V1 identity describes the complete build-sequence target, not the current release.
