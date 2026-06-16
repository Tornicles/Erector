# Erector — Master Schema & Data Contracts PRD

## Project Overview
**Erector** is a mobile-first reality simulation, validation, and execution intelligence platform. Users validate business ideas against 30 economy types, 25 Civilization DNA dimensions, 27 engines, 6 simulation systems, and generate 5 report packages, managed through a Reality Framework with 26 layers and 10 Business Climate states.

## Architecture

### Tech Stack
- **Backend**: Python 3.11, FastAPI 0.110, Pydantic v2, Motor (async MongoDB), MongoDB
- **Frontend**: React 18, TypeScript, Tailwind CSS, Zustand-ready types
- **Mobile**: React Native, Expo, TypeScript types
- **Auth**: Supabase magic link + JWT bridge (schema only — not integrated yet)

### Prompts Completed
| Prompt | Status | Date |
|--------|--------|------|
| PROMPT 0 — Master Schema Lock | ✅ Complete | 2026-06-16 |

## Collections Defined (46 total)

### User & Auth
- `erector_users`, `erector_sessions`, `magic_link_attempts`

### Teams
- `teams`

### Economy
- `economies`, `country_economy_mappings`, `economic_stacks`

### Validation
- `validation_sessions`, `validation_contexts`

### Engines & Scoring
- `engine_outputs`, `validation_scores`

### Assumptions / Evidence / Dependencies
- `assumptions`, `evidences`, `dependencies`

### Simulation
- `simulation_runs`, `simulation_savepoints`, `simulation_logs`

### World Library (global reference)
- `organization_world_entities`, `human_world_personas`

### Paths / Verdicts / Frameworks / Climate
- `validation_paths`, `verdicts`, `reality_frameworks`, `business_climates`
- `resistance_forces`, `failure_architectures`

### Reports & Sharing
- `validation_reports`, `report_shares`

### Launch
- `launch_packages`

### Revalidation & Readiness
- `revalidation_events`, `execution_readiness`

### Events & Notifications
- `world_events`, `notifications`, `notification_tokens`
- `system_events`, `dead_letter_queue`

### Developer API
- `erector_api_keys`, `developer_webhooks`, `webhook_deliveries`

### Billing
- `erector_subscriptions`, `erector_payments`, `usage_counters`

### Governance & Admin
- `bhudhi_logs`, `audit_logs`, `analytics_events`, `system_errors`, `admin_actions`

## Enums Defined (38 total)
All centralized in `backend/models/enums.py` and mirrored to TypeScript.

Key counts:
- **30 EconomyTypes** (consumer_capitalist → cybercrime_dark_web)
- **25 CivilizationDnaDimensions** (trust_index → future_change_velocity_index)
- **27 EngineNames** (economy_resolution → meta_validation)
- **16 ValidationStatuses** with legal state machine transitions
- **6 VerdictTypes**, **5 PathTypes**, **10 ClimateStates**, **10 ReportPackageTypes**

## Files Created

### Backend Models (40 files)
```
backend/models/__init__.py, enums.py, base.py, api.py, auth.py, users.py, teams.py,
economy.py, validation.py, context.py, engines.py, scoring.py, assumptions.py,
dependencies.py, evidence.py, simulations.py, canvas.py, worlds.py, resistance.py,
failure.py, paths.py, verdicts.py, frameworks.py, climates.py, reports.py,
sharing.py, launch.py, revalidation.py, readiness.py, events.py, notifications.py,
developer.py, billing.py, admin.py, analytics.py, audit.py, bhudhi.py, security.py
```

### Backend DB (5 files)
```
backend/db/__init__.py, collections.py, indexes.py, validators.py, migrations.py
```

### Frontend TypeScript Types (15 files)
```
frontend/src/types/api.ts, enums.ts, auth.ts, users.ts, teams.ts, economy.ts,
validation.ts, engines.ts, scoring.ts, simulations.ts, canvas.ts, framework.ts,
climate.ts, reports.ts, launch.ts
```

### Mobile TypeScript Types (6 files)
```
mobile/types/api.ts, enums.ts, validation.ts, simulation.ts, canvas.ts, framework.ts
```

### Test Files (8 files)
```
tests/schema/test_model_imports.py, test_enum_integrity.py, test_mongo_indexes.py,
test_api_envelope.py, test_engine_output_contract.py, test_score_contract.py,
test_torgima_payload_contract.py, test_security_ownership_contract.py
```

## Test Results
**100/100 tests passing** across all 8 test gates.

## Security Contracts Enforced
1. All protected documents require `owner_user_id` (46 protected collections)
2. Global reference collections exempt: economies, country_economy_mappings, organizations, personas
3. Team documents require `team_id` and membership validation
4. Public report share access: token hash + expiry + password + revoked_at only
5. API keys: hash stored only, never plaintext
6. Bhudhi governance: cannot write score/verdict/climate/economy_profile fields
7. Audit log required for all create/update/delete operations
8. Soft delete before hard purge

## API Endpoints (Schema Layer)
- `GET /api/health` — Server health + schema version
- `GET /api/schema/collections` — All 46 registered collections
- `GET /api/schema/enums` — All 38 enums with value counts
- `GET /api/schema/indexes` — All 43 MongoDB indexes

## P0 Backlog (Next Prompts A1–J4)
- A1: Economy world seeding (30 economies × 25 DNA dimensions)
- A2: Context collection question engine
- A3: Economic stack resolution logic
- B1–B27: 27 validation engines implementation
- C1: Scoring engine (all 27 deterministic scores)
- D1: Simulation engine
- E1: Reality Framework generator
- F1: Business Climate engine
- G1: Report generation (5 packages)
- H1: Torgima launch integration
- I1: Supabase auth integration
- J1: Developer API + webhooks
- J2: Admin console
- J3: Team Mode
- J4: Notification system

## Unresolved Assumptions
- Supabase magic link bridge implementation deferred to auth prompt
- Torgima API endpoint/credentials not yet provided
- Bhudhi/Claude actual API integration deferred to AI prompt
- Mobile Expo project scaffold not created (types only)
