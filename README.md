# TONDE — Your AI Production Director

**Show TONDE what you want to make. TONDE tells you exactly how to make it.**

TONDE is production intelligence, not a generic generator or editor. Prompt 1 establishes one creative Production model, Supabase identity/data/storage, an authenticated seven-area shell, and server-side extension boundaries. Intelligence, full timeline editing, exporters, billing plans and worker execution are intentionally **not implemented** yet.

## Authoritative product definition

Read the **[TONDE Product Constitution v1.0.0](docs/product/constitution.md)** before changing UX, terminology, persistence or AI behavior. It is the permanent product authority; conflicts require explicit resolution, not a second interpretation. Its [canonical glossary](docs/product/glossary.md), [invariant register](docs/product/invariants.md), and [Prompt 2 compliance report](docs/product/compliance.md) guide Prompts 3–11.

The product loop is **Reference → Direct → Create → Upload Result → Check → Fix → Approve**. One Master Production owns creative truth; Real Production (default face) and AI Creation represent how its same Shots execute. Hybrid is per-Shot strategy. Setup owns production capabilities, Assets own reusable entities, Settings own account/application preferences. Public source access is not ownership; observed/estimated/recommended claims remain distinct. Provider generation APIs are optional.

## Current status

The frontend and FastAPI server boot independently. Current hosted checks confirm `tonde` negotiates through the Data API and anon workspace reads are denied (HTTP 401); the previously reported PGRST106 was not reproduced. Hosted migration versions 001–008 are present; local corrections 009–010 are not applied and schema-equivalence verification is blocked by missing Docker/Podman. A limited real-user suite passes 39/39, including scoped helper and approval probes, but the full resource, comprehensive approval, six-bucket, Auth-provider and post-correction security checks remain BLOCKED. Google is disabled and email delivery is unverified. See the current [Prompt 2 correction handoff](docs/prompt-2-correction-handoff.md), [runbook](docs/supabase-runbook.md), and historical [Prompt 1 audit](docs/migration-audit.md).

## Stack and boundaries

- React 18 + strict TypeScript + Vite + Tailwind + existing Lucide icons.
- Supabase PostgreSQL / Auth / private Storage; exposed application schema `tonde`.
- FastAPI/Python 3.12 for future privileged AI/media/integration/worker/export work.
- Direct browser CRUD is centralized in services and authorized by RLS. Backend requests verify the session against Supabase Auth and forward the **user token**, retaining RLS. Service-role configuration is optional and never sent to the browser.

```text
Supabase User → Workspace → Project → Production
  → optional Act → optional Sequence → Scene → Shot
  → Real / AI execution plans → Results → Shot Match → Revision → Approval → Export
Series → optional Collection/Season → Episode → same Production
```

## Local development

Requirements: Node 22.12+ and Python 3.12. Docker/Supabase CLI are optional for full platform integration; policy tests run embedded PostgreSQL without Docker. No legacy platform is needed.

```bash
npm ci
cd frontend
npm ci
cp .env.example .env.local
# Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to a reviewed dev project.
npm start
# http://127.0.0.1:5173 (strict port; do not displace another thread's server)
```

```bash
cd backend
python -m venv .venv
# Windows Git Bash:
.venv/Scripts/python.exe -m pip install -r requirements.txt
cp .env.example .env
.venv/Scripts/python.exe -m uvicorn server:app --host 127.0.0.1 --port 8001 --no-access-log
# macOS/Linux: use .venv/bin/python instead
```

`/api/health` is liveness and reports configuration, **not database readiness**. `/api/ready` requires a real bearer session and verifies Auth/Data API reachability. No auth bypass exists in development. Production server startup requires configured Supabase and HTTPS origin allowlists.

Alternatively, with Docker and configured environment files: `docker compose up --build`. The compose file contains only application services; it does not create or modify a hosted database.

## Supabase setup and migrations

See [Supabase runbook](docs/supabase-runbook.md) before touching a hosted project. Never blindly reset a remote project.

For an isolated local Supabase stack with Docker and the official CLI:

```bash
supabase start
supabase db reset --local
supabase status
```

Copy the local API URL and publishable/anon key into the frontend and backend environments. The configured CLI API exposes `tonde`; hosted projects must add `tonde` to exposed schemas. Migrations intentionally do not expose the private credentials schema.

On an existing hosted project: inspect tables, RLS, policies, users, providers, bucket privacy, migrations and retention first. Export schema/metadata, choose the correct dev environment, and review migration collisions. Only then link/push through the official CLI. No migration automatically drops or imports preexisting tables/data.

Supabase email/password, verification, recovery and Google OAuth use the same session authority. Enable Google in Supabase with your own client ID/secret; register the callback URLs for each environment. Local config disables Google until real credentials exist. Hosted verification/SMTP/provider approval are account actions, not source-code configuration.

## Tests and checks

```bash
# Root: actual PostgreSQL migration/RLS/constraints; minimal platform table fixtures
npm test
npm run verify:legacy
node scripts/generate-database-types.mjs
node scripts/generate-database-types.mjs --check
npm run test:constitution

cd frontend
npm run typecheck
npm test
npm run build
npx playwright install chromium
npx playwright test

cd ../backend
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m mypy app server.py
.venv/Scripts/python.exe -m ruff check app tests
```

Unit and browser auth tests use explicitly mocked network transport. They prove application wiring, not hosted OAuth, email delivery, or Storage service behavior. Database tests use real PostgreSQL authenticated roles with two separate UUID identities and real RLS enforcement; platform Auth/Storage schemas are minimal fixtures. Live integration remains a rollout gate in the runbook.

## Repository map

- `frontend/src/contexts`: sole session/bootstrap authority.
- `frontend/src/services`: typed Supabase CRUD, auth, private uploads, privileged HTTP.
- `frontend/src/hooks`: local Studio autosave and unsaved-navigation handling.
- `frontend/src/components`: canonical layout, protected routes, error/loading/empty states.
- `frontend/src/pages`: seven destinations plus auth/account/help; production-aware Studio.
- `product/vocabulary.json`: canonical software display labels and non-persistence product codes.
- `frontend/src/types/database.ts`, `frontend/src/types/product.ts`, `backend/app/domain/vocabulary.py`: generated from migrations/vocabulary; do not hand-edit. The generator verifies exact label coverage.
- `backend/app/domain/product.py`: evidence/uncertainty, scoped proposal/application and voice-use contracts; no intelligence engine.
- `backend/app/core`, `db`, `dependencies`: server configuration/errors/logging/platform authorization.
- `backend/app/services/contracts.py`: specialized future intelligence/storage/job contracts, no fake implementation.
- `supabase/migrations`: normalized relational foundation, RLS/bootstrap/history, Storage, integrity.
- `tests/database`, `frontend/src/test`, `frontend/e2e`, `backend/tests`: active test suites.
- `legacy`: deliberate donor quarantine, excluded from runtime/deployment/tests; remove after hosted rollout and retention gate.
- `.freebuff`: local client metadata, ignored and untouched.

## Schema evolution

Prompt 2 adds classifications/typed vocabulary and human-acceptance guards through additive migrations; the 39-table model remains intact. Product Constitution compliance is tested alongside Prompt 1 regression. Live Supabase verification remains externally blocked; locally passing checks are not a claim of hosted acceptance.

Every persistence change needs a new timestamped migration, ownership/relationship constraints, explicit grants, RLS tests and generated-type refresh. Do not rewrite already-applied migrations. See [architecture decisions](docs/architecture.md) and [evolution checklist](docs/schema-evolution.md). Do not use JSONB to avoid modeling identity, hierarchy, security or frequent query fields.

No demo data is installed in production. Tests create ephemeral fixtures; users create real productions through the Projects screen.
