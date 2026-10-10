# TONDE live Director path — architecture and configuration

**Status:** authoritative for the Vercel + Supabase + OpenAI launch architecture.
No secrets are recorded here; presence and contracts only.

## Architecture

```text
Frontend hosting:      Vercel static build of frontend/ (Vite), same deployment.
Server-side/API hosting: Vercel Python Functions, backend/vercel_app.py, same
                       deployment and domain. No separate backend host exists.
Supabase usage:        database, Auth (PKCE sessions, RLS-scoped reads/writes),
                       Storage. Reached server-side through SupabaseGateway with
                       the caller's bearer JWT; RLS enforced on every read.
OpenAI invocation location: server-side only, in OpenAICompatibleProvider
                       (backend/app/services/ai/openai_compatible.py), called
                       from Director intelligence services. Never the browser.
Director request route: POST /api/v1/workspaces/{workspace_id}/productions/{production_id}/director/plan
                       (backend/app/routers/director_intelligence.py).
```

## Request path

```text
HOME → DIRECT THIS → productionService.directorPlan (frontend/src/services/productions.ts)
→ same-origin /api/* → Vercel rewrite → FastAPI director_plan
→ StudioRepository.intelligence_context (plain RLS reads)
→ interpret_goal (deterministic baseline; model refinement when configured)
→ build_production_plan (deterministic Brief/Story/Script/Scenes)
→ generate_story (model refinement when configured)
→ BUILD PRODUCTION → apply_director_operation (guarded RPC, revision-checked)
→ Studio loads the persisted Production.
```

## Director provider

```text
DIRECTOR_PROVIDER:  openai_compatible (the only implemented provider string)
DIRECTOR_BASE_URL:  https://api.openai.com/v1 (the adapter appends /chat/completions;
                    never set the base URL to the full endpoint path)
DIRECTOR_MODEL:     gpt-4o-mini (kept until the flow is proven; benchmark later)
DIRECTOR_API_KEY:   server secret, preferred credential (never VITE_*, never logged)
OPENAI_API_KEY:     server secret, accepted as a fallback when DIRECTOR_API_KEY
                    is unset; an explicit DIRECTOR_API_KEY always wins.
```

The OpenAI adapter uses Chat Completions with `messages` plus strict
`response_format: json_schema`. It never uses the Responses API shape, so the
two contracts cannot mix. Provider schemas are normalised for strict mode
(every object forbids extras, every property required) in
`app/services/ai/orchestration.py::json_schema`; the regression suite walks
the exact intent/story/analysis schemas. The 2026-10-10 live 400 was a
non-strict schema rejected by OpenAI before any reasoning ran.

## Failure semantics

- Provider failure changes nothing: no Production content is written.
- The creator-facing error names the provider's own reason (bad key, unknown
  model, rate limit, timeout) plus the unchanged retry/manually guidance.
- A configured-provider failure never degrades into a fake deterministic
  success: LIVE SUCCESS, PROVIDER UNAVAILABLE, and DETERMINISTIC MODE stay
  distinct in operation outcomes and UI copy.
- Startup logs report Director configuration presence only, never values.

## Classification

```text
DIRECTOR_PROVIDER / DIRECTOR_BASE_URL / DIRECTOR_MODEL: SERVER CONFIG
DIRECTOR_API_KEY / OPENAI_API_KEY:                       SERVER SECRET
SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (backend):       SERVER CONFIG
SUPABASE_SERVICE_ROLE_KEY:                               SERVER SECRET
VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY:       CLIENT-PUBLIC CONFIG
```

After any environment change, redeploy: Vercel bakes values at build time.
