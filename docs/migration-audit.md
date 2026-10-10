# Prompt 1 migration audit

> **Superseded hosted state (dated correction, 2026-10-08).** Every hosted migration
> statement below is the record of the day it was written. As of 2026-10-08 the linked
> project's ledger records **001–030** with matching `tonde` effects, the untruncated
> catalog comparison reports **0 differences over 4087 identities**
> (`test-results/pre-prompt10/hosted-final-diff.json`), and the expanded two-user runner
> reports **538 pass / 1 blocked / 0 fail**. The only remaining blockers are external
> (mail capacity, Google sign-in, plan-gated leaked-password protection). See the
> [Pre-Prompt-10 certification](pre-prompt10-final-certification.md).

## Verified starting point

- Checkout remote: `https://github.com/Tornicles/Erector.git`, branch `main`, starting commit `26db26c`. The prompt's `Tornicles/theerector` is not this checkout's remote; no remote is changed.
- 271 indexed files; tracked source/config/test inventory spans approximately 41,819 lines, including 16,772 lines of economic reference data. Backend imports, models, routes, services, workers, and frontend/mobile consumers were mapped before design decisions.
- React 18/TypeScript frontend has only Welcome and Health screens; navigation is component-local state, not URLs. Tailwind config exists. No Shadcn config, AppLayout, AIChat, ProjectSelector, StateComponents, generic dialogs, or established application authentication context exists.
- FastAPI starts Motor, creates indexes, seeds economy data and registers validation/context/economy/Bhudhi/live-feed APIs. Authentication is custom JWT/magic-link mock with database sessions. Supabase settings fields are placeholders, not a connection.
- Bhudhi directly calls Anthropic via HTTP and returns domain-specific deterministic fallbacks. No working Stripe, email, or external OAuth integration exists; billing and notifications are domain-specific models only.
- Storage has no file/object abstraction or bucket configuration. Deployment assumes a MongoDB container and platform-specific supervisor port. CI requires MongoDB and refers to a missing yarn lockfile.
- Mobile is an Expo scaffold tied to the old business APIs, not a production mobile application.
- No configured Supabase environment variable names, project link, migration directory, local credentials, database URL, or accessible signed-in Supabase session was found. The existing local backend environment example was unreadable through the file tool and was not inspected by another means.
- No Python runtime, PostgreSQL CLI, Supabase CLI, or Docker executable was available initially. Node 22/npm are available. Port 3000 is already occupied and is not touched.
- Initial untracked `.freebuff/` belongs to the client and is left untouched. No Git commits, pushes or deployments are authorized.

## Hosted Supabase verification: later correction supersedes initial uncertainty

This is a historical Prompt 1 starting audit. The linked Supabase project has since been inspected directly; current evidence, including the limited hosted acceptance and still-blocked gates, is in the [Prompt 2 correction handoff](prompt-2-correction-handoff.md). Do not read the original unknown-state list or its Data API setup note as current status. The hosted ledger reads 001–010 — 009–010 were applied by hand and the ledger repaired — and a read-only recheck on 2026-10-07 confirms the ledger at 001–010 with the hosted effect state at 001–014, so 011–014 were applied without ledger rows and 015–025 are the genuinely unapplied range (see the [Prompts 1–9 audit](system-gap-audit-prompt1-9-final.md)). Semantic diff is blocked by missing Docker/Podman, `tonde` Data API negotiation works, and broader hosted acceptance remains BLOCKED.

The forward rollout still requires a reviewed project/environment, data/dependency inspection, backup/recovery plan and explicit authorization. Never reset unknown hosted data or blindly apply migrations. New tables use the explicit `tonde` schema, and `tonde_private` remains outside Data API exposure.

## Donor classification

| Area | Classification | Treatment |
|---|---|---|
| React 18, TypeScript, React root | KEEP / ADAPT | Preserve frontend platform and strict typing |
| Tailwind, dark CSS variable pattern | ADAPT | Semantic TONDE tokens and accessible responsive layout |
| Lucide icons | KEEP | Existing icon dependency |
| Zustand pattern | REFACTOR | Avoid legacy global live-feed state; Studio state stays local |
| API response envelope | ADAPT | Typed, sanitized TONDE errors and request metadata |
| Request ID middleware | ADAPT | Validate supplied ID; correlate structured logs |
| CORS helper | REFACTOR | Explicit origin allowlist; no wildcard credentials |
| Token hashing/security utilities | KEEP / RENAME | Portable utilities in server core |
| Input sanitizer | REFACTOR / RENAME | Portable secret redaction; no claim it solves prompt injection |
| Bhudhi contracts/provider/client | REPLACE | Provider-neutral typed server contracts, no fake reasoning |
| Welcome/Health pages | REPLACE | Authentication, canonical shell, dedicated readiness reporting |
| All business validation/economy APIs and schemas | DELETE from active runtime / ISOLATE | Quarantine under legacy until external/data verification is possible |
| Custom auth, Motor/database indexes/seeders | REPLACE / ISOLATE | Supabase Auth/PostgreSQL only in active application |
| Expo scaffold | ISOLATE | No second auth or Studio implementation |
| Old schema/API tests | REPLACE / ISOLATE | New foundation tests; retain portable security/envelope intent |
| Mock credentials, product PRD, test reports | ISOLATE | Historical only; not setup instructions |
| Platform-specific deployment/config | REPLACE / ISOLATE | Portable backend and frontend configuration |

## Safety and rollout

1. Preserve old tracked runtime under `legacy/`, outside active package/import/test roots. Preserve untracked files and do not inspect or export any unknown database.
2. Build additive, source-controlled TONDE migrations and locally exercise actual PostgreSQL constraints/RLS with two independent authenticated identities. Local PostgreSQL tests do not verify hosted Supabase Auth/Storage.
3. Build a real Supabase client integration, protected routes and honest configuration/error states; never substitute fake login or fake saved data.
4. Verify frontend/backend interfaces, clean schema migration, tenant isolation and UI behavior locally. Use mocked transport only for clearly labeled UI unit tests.
5. Before hosted rollout: inspect project, export metadata/schema, confirm retention, expose schema, apply reviewed migrations, configure callbacks/providers, verify two real users and private uploads. Keep legacy quarantine until this gate is passed.
6. No automatic import of business data. If retained user data matters, use an explicit audited export/mapping; do not read or change the old database during this task.

The quarantine is intentional migration debt, not a competing runtime. It can be removed after live rollout verification; historical commit `26db26c` remains the donor reference.
