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
- Difficulty multipliers: ALL deterministic from Civilization DNA (NO AI). Range 0.5–1.5.

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

### PROMPT A2 — Economy World Data & API ✅ (2026-06-16)
**Data:**
- `economy-data/economies.json` — 30 economies × 25 Civilization DNA dimensions (generated)
- `economy-data/country-economy-mappings.json` — 138 countries with ISO codes, primary + secondary economies

**Backend Models (already in Prompt 0/A1 base):**
- `backend/app/models/economy.py` — Economy, EconomySummary, EconomyDetail, EconomyResolveResponse, EconomyCompareRequest/Response, EconomicStackBuildRequest, EconomicStack, DifficultyMultipliers

**Seeders (idempotent):**
- `backend/app/seeders/seed_economies.py` — upserts all 30 economies on startup
- `backend/app/seeders/seed_country_mappings.py` — upserts all 138 mappings on startup

**Services:**
- `backend/app/services/economy_service.py` — list/get economies from MongoDB
- `backend/app/services/economy_resolution_service.py` — country → economy (ISO code, name, alias matching)
- `backend/app/services/economic_stack_service.py` — builds 6-layer EconomicStack with deterministic multipliers
- `backend/app/services/economy_comparison_service.py` — compares economies via 12 DNA-formula dimensions

**Indexes (A2):**
- `economies.economy_id` (unique)
- `economies.economy_type`
- `country_economy_mappings.country_code` (unique)
- `country_economy_mappings.country_code_alpha3` (sparse)
- `country_economy_mappings.primary_economy_id`
- `country_economy_mappings.primary_economy_type`

**Tests (68/68 A2 passing):**
- `backend/tests/test_economy_seed.py` (8 tests)
- `backend/tests/test_country_resolution.py` (25 tests — parametrized)
- `backend/tests/test_economy_api.py` (14 tests)
- `backend/tests/test_economic_stack_builder.py` (11 tests)
- `backend/tests/test_economy_comparison.py` (7 tests)

**Frontend/Mobile Types:**
- `frontend/src/types/economy.ts` — full A2 TypeScript types
- `frontend/src/services/economyClient.ts` — typed API client for all A2 endpoints

### PROMPT A3 — Validation Lifecycle and State Machine ✅ (2026-06-16)
**Backend:**
- `backend/app/models/validation.py` — ValidationSession, request/response models
- `backend/app/models/events.py` — SystemEvent, DeadLetterQueueItem
- `backend/app/models/audit.py` — AuditLog with request_id
- `backend/app/services/validation_state_machine.py` — legal transitions, transition_validation
- `backend/app/services/idempotency_service.py` — concurrency-safe idempotency
- `backend/app/services/validation_service.py` — create/get/list/transition/fail/archive
- `backend/app/services/event_service.py` — emit, process, retry backoff
- `backend/app/services/dead_letter_service.py` — DLQ move/retry/resolve/ignore
- `backend/app/services/validation_health_service.py` — stuck detection
- `backend/app/services/audit_service.py` — immutable audit trail
- `backend/app/routers/validations.py` — 8 lifecycle API routes
- `backend/app/workers/validation_health_monitor.py` — stuck validation worker
- `backend/app/workers/event_retry_worker.py` — event retry worker

**Tests (A3):**
- `test_validation_model.py`, `test_validation_state_machine.py`, `test_validation_api.py`
- `test_idempotency.py`, `test_event_service.py`, `test_dead_letter_queue.py`
- `test_validation_health_monitor.py`

**Frontend/Mobile:**
- `frontend/src/types/validation.ts`, `frontend/src/services/validationClient.ts`
- `mobile/types/validation.ts`, `mobile/services/validationClient.ts`

### PROMPT A4 — Context Collection and Dynamic Question Engine ✅ (2026-06-16)
**Backend:**
- `backend/app/models/context.py`, `questions.py`, `evidence.py`, `assumptions.py`
- `backend/app/services/goal_interpretation_service.py` — deterministic goal parsing (A5 hook)
- `backend/app/services/question_catalog.py` — 8 category question definitions
- `backend/app/services/question_branching_service.py` — regulated industry, team, revenue branches
- `backend/app/services/question_engine_service.py` — batches, submission, state integration
- `backend/app/services/answer_quality_service.py`
- `backend/app/services/preliminary_anti_gaming_service.py`
- `backend/app/services/preliminary_knowledge_gap_service.py`
- `backend/app/services/context_gate_service.py`
- `backend/app/services/engine_input_builder_service.py`
- `backend/app/routers/context.py` — questions, context submit, get, reset

**Tests (A4):** 11 test modules covering models, interpretation, engine, branching, quality, gaming, gaps, gate, API, engine input

**Frontend/Mobile:**
- `frontend/src/types/context.ts`, `questions.ts`, `services/contextClient.ts`
- `mobile/types/context.ts`, `questions.ts`, `services/contextClient.ts`

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

### A2 Implemented
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | /api/v1/economies | None | List all 30 economy summaries (paginated) |
| GET | /api/v1/economies/{economy_id} | None | Full economy profile with DNA |
| GET | /api/v1/economies/resolve/{country} | None | Country name/ISO → primary + secondary economy |
| POST | /api/v1/economies/compare | None | Compare economies with dimension scores |
| POST | /api/v1/stack/build | None | Build 6-layer Economic Stack |

### A3 Implemented
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | /api/v1/validations | Bearer | Create validation (idempotent) |
| GET | /api/v1/validations | Bearer | List user validations |
| GET | /api/v1/validations/{id} | Bearer | Detail + allowed transitions + health |
| PATCH | /api/v1/validations/{id}/state | Bearer | Legal state transition |
| POST | /api/v1/validations/{id}/fail | Bearer | Mark failed |
| POST | /api/v1/validations/{id}/archive | Bearer | Archive validation |
| GET | /api/v1/validations/{id}/events | Bearer | Lifecycle events |
| GET | /api/v1/validations/{id}/health | Bearer | Stuck detection status |

### A4 Implemented
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | /api/v1/validations/{id}/questions | Bearer | Dynamic question batch |
| POST | /api/v1/validations/{id}/context | Bearer | Submit answers, gate evaluation |
| GET | /api/v1/validations/{id}/context | Bearer | Context state + engine input |
| POST | /api/v1/validations/{id}/context/reset | Bearer | Dev context reset |

---

## DB Schema

### A1 Core
- `erector_users`: {user_id, email, full_name, user_type, status, subscription_tier, onboarding_completed}
- `erector_sessions`: {session_id, user_id, access_token_hash, refresh_token_hash, expires_at, revoked_at}
- `magic_link_attempts`: {attempt_id, email_hash, token_hash, email(mock), expires_at, consumed_at}

### A2 Economy World
- `economies`: {economy_id, economy_type, display_name, civilization_dna[25], resistance_patterns, opportunity_patterns, ...}
- `country_economy_mappings`: {country_code, country_name, aliases, primary_economy_id, secondary_economy_ids, confidence}

---

## P0 Backlog — Remaining Prompts
| Priority | Prompt | Description |
|----------|--------|-------------|
| P0 | A5 | Bhudhi INTERPRET mode integration |
| P0 | A6 | Economic stack persistence (deeper) |
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
- **Economic Stacks persistence**: `POST /api/v1/stack/build` builds stacks in-memory; persistence to `economic_stacks` collection deferred to A4.
