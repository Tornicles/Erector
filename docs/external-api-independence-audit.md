# External-API independence audit — system works without external APIs

Relay artifact from the verification/peer session, 2026-10-07. Request from the creator:
*"remove the blockers, make sure the system doesn't depend on the external APIs because we
want the system to work first then add the APIs."*

**Verdict: the architecture already satisfies this. No code changes were required.** Every
AI/provider-touching flow has an explicit, honest no-provider path; nothing crashes, hangs or
fabricates when providers are absent. The two reported "BLOCKED" items are external *actions*
(creator-side), not system dependencies. Suggested reporting language is at the end.

## Evidence

| Surface | No-provider behaviour | Proof |
|---|---|---|
| Boot | Zero network calls at startup; all external settings optional (`supabase_url`, `director_*` all `None`-defaulted; only `APP_ENV=production` requires Supabase) | Live boot with **zero external config**: `/api/health` → `{"status":"alive","configured":false}`, OpenAPI 200 |
| AI provider selection | `build_provider` degrades missing/unknown/incomplete configs to `UnconfiguredDirectorProvider` — "Explicit absence of a provider. Never returns canned creative analysis." | `backend/app/services/ai/provider.py` |
| Director operations | Unconfigured provider → deterministic domain fallback labelled `producer='deterministic'` with limitation "No AI provider is configured…", or honest 503 `DIRECTOR_PROVIDER_UNAVAILABLE` ("Your saved work is unchanged and manual editing stays available"). No hang, no retry storm. | `backend/app/services/ai/orchestration.py` (run_operation) |
| AI Creation engine | Deterministic and provider-neutral; no vendor SDK; capability truth comes from declared model profiles, never inferred; unverified provider callbacks are validated and reported but **never applied** (an unverified callback is not evidence) | `backend/app/services/ai_creation.py`, `routers/ai_creation.py` callback route |
| Media analysis | FFmpeg optional: deterministic frame *selection* always available; *extraction* has an explicit unavailable state. "No pixels are ever invented." | `backend/app/services/media/frames.py` |
| Reference/intelligence | Catch `ProviderUnavailable`/`ProviderFailed` → degraded states, not errors | `services/reference.py`, `services/intelligence.py` |
| Frontend | Talks only to the backend API + the Supabase data plane (auth/DB/storage). No third-party API calls; Studio AI surfaces use creator-driven submission ("Run the prompt yourself, then report what came back") | `frontend/src` sweep |
| Whole test battery | Root DB suites, backend pytest, vitest and Playwright E2E all run with **zero external API keys** (PGlite in-process; full app E2E boots the real stack) | Every pass verification, incl. 9C/9D |

Live boot proofs (both clean, this session):

- Zero external config (no Supabase, no provider): `/api/health` 200 `configured:false`.
- The creator's normal `.env` (Supabase data plane, **no `DIRECTOR_PROVIDER` set**): `/api/health`
  200 `configured:true` — the deployment already runs with the AI provider unconfigured, and the
  16 Playwright E2E specs pass against it.

## The two remaining items — actions, not blockers

1. **Hosted Supabase migrations 018–022 unapplied.** Deployment reconciliation, not a system
   dependency: local/dev runs on 001→022 and is fully functional. Fix is the queued manual-apply
   packages (`supabase/manual-apply/09_*` through `12_*` + their verify scripts), pasted in order
   in the Supabase dashboard by the creator. **Do not replay 009–019.** I cannot perform this
   (no hosted credentials, no Docker); it stays a creator action.

2. **Live AI provider acceptance — deferred by creator decision.** The creator explicitly wants
   the system working first and providers added later; that is what the architecture does.
   When ready, no code changes are needed: set in `backend/.env`
   `DIRECTOR_PROVIDER=openai_compatible`, `DIRECTOR_BASE_URL`, `DIRECTOR_API_KEY`,
   `DIRECTOR_MODEL` (optional `DIRECTOR_TRANSCRIPTION_MODEL`, and an entry in
   `ai_callback_secrets` for signature-verified completion callbacks). Everything else —
   fallbacks, capability gating, honest degraded states — already exists.

## Suggested reporting language

In pass handoffs, replace the blanket "live AI/provider generation BLOCKED — REAL EXTERNAL
DEPENDENCY" framing with the accurate scope:

- System operation without external APIs: **verified working** (deterministic paths + honest
  degraded states; audit of 2026-10-07).
- Live provider acceptance: **DEFERRED — creator will add providers after the system milestone**
  (not an internal failure, not a system dependency).
- Hosted migrations: **creator manual action** (packages queued; apply in order, never replay).

This keeps §239/§241 truthfulness: nothing is claimed as provider-verified, and no internal
failure is hidden.
