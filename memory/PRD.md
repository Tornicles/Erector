# Erector — Master PRD

## Project Overview
**Erector** is a mobile-first reality simulation, validation, and execution intelligence platform.
Users validate business ideas against 30 economy types, 25 Civilization DNA dimensions, 27 engines, 6 simulation systems, and generate 5 report packages.

## Architecture

### Tech Stack
- **Backend**: Python 3.11, FastAPI 0.110, Pydantic v2, Motor (async MongoDB)
- **Frontend**: React 18, TypeScript, Tailwind CSS (CRA)
- **Mobile**: React Native, Expo Router (scaffold only — not runnable in cloud)
- **Auth**: Mock magic-link + JWT bridge (Supabase integration deferred)

### Key Technical Constraints
- Backend runs on port 8001 via supervisor (`server:app`)
- All API routes prefixed with `/api`
- Standard API envelope: `{success, data, errors, metadata}` on ALL responses
- No datetime/ObjectId serialization issues: always use `model_dump(mode='json')` in JSONResponse contexts

---

## Completed Prompts

### PROMPT 0 — Master Schema Lock ✅ (2026-06-16)
- 40+ Pydantic models, 38 enums, 46 MongoDB collections, 43 indexes
- 100/100 schema tests passing
- Frontend + Mobile TypeScript types auto-generated

### PROMPT A1 — Scaffold & Environment Setup ✅ (2026-06-16)
**Backend:**
- `backend/app/core/` — config (Pydantic Settings), logging, CORS, errors, security
- `backend/app/db/` — Motor client, collections registry, A1 indexes, health check
- `backend/app/models/` — re-exports from Prompt 0 + auth/user request-response models
- `backend/app/services/` — token_service (JWT), auth_service (magic-link mock)
- `backend/app/middleware/` — RequestIDMiddleware (X-Request-ID header)
- `backend/app/dependencies/` — get_current_user (JWT → session → user)
- `backend/app/routers/` — health, auth (5 routes), schema (Prompt 0 routes)
- `backend/app/main.py` — full FastAPI app (lifespan, CORS, error handlers, all routers)
- `backend/server.py` — thin shim importing from app.main (supervisor compat)

**Tests (46/46 A1 + 100/100 Prompt 0 = 146 total):**
- `backend/tests/test_health.py` (11 tests)
- `backend/tests/test_config.py` (10 tests)
- `backend/tests/test_api_envelope.py` (10 tests)
- `backend/tests/test_auth_stub.py` (15 tests — full mock auth flow)

**Frontend scaffold:**
- Dark/green aesthetic (`--bg-primary: #0a0f0d`, `--accent: #22c55e`)
- `WelcomePage.tsx` — hero, stat strip, CTAs
- `HealthPage.tsx` — API health view with endpoint list
- `HealthCheckCard.tsx` — live DB/version/env status
- `services/api.ts` — typed API client

**Mobile scaffold (Expo file structure — reference only):**
- `mobile/app/_layout.tsx`, `index.tsx`, `health.tsx`
- `mobile/package.json`, `app.json`, `tsconfig.json`

**DevOps:**
- `backend/Dockerfile`
- `docker-compose.yml`
- `.github/workflows/ci.yml`

---

## API Endpoints

### A1 Implemented
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | /api/health | None | DB status, version, mock_auth flag |
| POST | /api/v1/auth/magic-link | None | Returns mock_token in debug mode |
| GET | /api/v1/auth/verify | None | ?token=xxx → JWT pair |
| POST | /api/v1/auth/refresh | None | Exchanges refresh token |
| POST | /api/v1/auth/logout | Bearer | Revokes session |
| GET | /api/v1/auth/me | Bearer | Current user profile |
| GET | /api/schema/collections | None | Prompt 0 — 46 collections |
| GET | /api/schema/enums | None | Prompt 0 — 38 enums |
| GET | /api/schema/indexes | None | Prompt 0 — indexes |

---

## DB Schema (Core A1)
- `erector_users`: {user_id, email, full_name, user_type, status, subscription_tier, onboarding_completed}
- `erector_sessions`: {session_id, user_id, access_token_hash, refresh_token_hash, expires_at, revoked_at}
- `magic_link_attempts`: {attempt_id, email_hash, token_hash, email(mock), expires_at, consumed_at}

---

## P0 Backlog — Remaining Prompts
| Priority | Prompt | Description |
|----------|--------|-------------|
| P0 | A2 | Economy world seeding (30 economies × 25 DNA dimensions) |
| P0 | A3 | Context collection question engine |
| P0 | A4 | Economic stack resolution logic |
| P1 | B1–B27 | 27 validation engines |
| P1 | C1 | Scoring engine (27 deterministic scores) |
| P1 | D1 | Simulation engine (6 simulation systems) |
| P2 | E1 | Reality Framework generator |
| P2 | F1 | Business Climate engine (10 states) |
| P2 | G1 | Report generation (5 packages) |
| P2 | H1 | Torgima launch integration |
| P2 | I1 | Supabase real auth integration |
| P3 | J1 | Developer API + webhooks |
| P3 | J2 | Admin console |
| P3 | J3 | Team Mode |
| P3 | J4 | Notification system |

---

## Known Deferred Items
- **Supabase**: Mock auth only. Real Supabase integration deferred to Prompt I1.
- **Torgima API**: Credentials/endpoint not yet provided.
- **Bhudhi/Claude**: AI integration deferred to Prompt B-series.
- **Mobile Expo**: File structure created but not runnable in cloud container.
