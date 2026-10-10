# Prompt 10 entry gate — owner decision (2026-10-08)

## Decision

The product owner directed that the three remaining **external** prerequisites of the
pre-Prompt-10 certification stay **BLOCKED (not verified)** so **Prompt 10 may begin**, and be added
later under a named follow-up. Format follows the 2026-10-05 Prompt 3 deferral recorded in
[prompt-2-handoff.md](prompt-2-handoff.md#gate-deferral-owner-decision-2026-10-05).

## Deferred items

1. **Mail capacity** — SMTP credentials and a controlled inbox. Verified status: the project requires
   email confirmation, declares no custom SMTP, and a real signup is refused externally
   (`HTTP 429 over_email_send_rate_limit` while the shared-mailer budget is spent;
   `HTTP 400 email_address_invalid` for a reserved probe address when the request reaches address
   validation). No session is issued before verification.
2. **Google sign-in** — OAuth client id/secret plus registered callbacks. Verified status: provider
   disabled, `redirect_uri` empty, authorize answers `HTTP 400`.
3. **Leaked-password protection** — plan-gated. Verified status: `PATCH
   /v1/projects/{ref}/config/auth {"password_hibp_enabled": true}` is refused with `HTTP 402`.

These are configuration/plan facts, not code defects: the Auth flows are implemented in Prompt 1 and
fail closed with truthful messages.

## Recorded effect

- Prompt 10 (integrations, exports, publishing, billing, entitlements, usage accounting) **may
  proceed**.
- The three items stay **BLOCKED**, never reported as PASS, and a named follow-up re-runs them before
  any claim of full Prompt 1–9 acceptance.
- **Prompt 10 may not claim PASS on any provider-backed or billing-backed capability it cannot
  actually verify.** Provider sandbox acceptance and billing sandbox acceptance are recorded as
  BLOCKED with exact unverified items while credentials/test-mode access are absent; architecture and
  server-authoritative contracts are implemented and verified locally and on hosted data that needs
  no external provider.
- Runtime behaviour stays truthful: sign-up requires confirmation and is undeliverable until SMTP is
  configured; Google sign-in fails closed; no unverified provider is shown as CONNECTED.
- No product meaning changes, so **this deferral itself** records no constitution version change (the
  constitution stood at 1.1.0 when this entry decision was made); no invariant is weakened. Publishing,
  billing and external providers never become creative authority.

  *Superseding note (same day):* Prompt 10 then added real product meaning — publication, export and
  commercial integrity — so the constitution was amended to **1.2.0** (§21 Amendment D, INV-40–INV-48).
  That amendment is recorded in the [completion handoff](prompt-10-completion-handoff.md) and does not
  reopen or widen this deferral: email delivery, Google sign-in and leaked-password protection remain
  owner-deferred and unclaimed.

## Named follow-ups (required before full acceptance)

1. Add an SMTP sender and a controlled inbox, then run the delivered verification/reset checks from
   the [runbook](supabase-runbook.md) and record results without secrets.
2. Register a Google OAuth client, then run the callback round-trip including duplicate-workspace
   protection on a returning login.
3. Enable leaked-password protection, or record an explicit product decision to accept the advisor
   warning.
4. Since Prompt 10 needs its own external access for verification: publishing-provider test
   credentials and a payment-provider test-mode account. Until then those acceptances are BLOCKED.

## Authority trail

- Pre-Prompt-10 certification (verdict BLOCKED, entry gate closed):
  [pre-prompt10-final-certification.md](pre-prompt10-final-certification.md), section 7.
- This decision is the explicitly recorded owner gate decision required by the Prompt 10 entry rule;
  it defers external prerequisites only and does not convert any BLOCKED item into PASS.
