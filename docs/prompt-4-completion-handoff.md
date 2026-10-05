# Prompt 4 completion handoff — TONDE Director Intelligence

Scope of this correction: finish the Prompt 4 Director Intelligence systems that were
still missing after the foundation pass — the config-driven provider adapter plus AI
orchestration, multimodal Reference preprocessing and analysis, evidence and epistemic
labels, Technique and Style DNA extraction, causal "what makes this work" analysis, the
substantive Intelligent Brief, adaptive questions, Story, Script, Dialogue, Characters,
Environments, Products, the full Reality Check, the five Studio surfaces, structured
Director commands and their persistence/RLS.

Nothing in this correction restarts Prompt 4, starts Prompt 5, or presents a
deterministic placeholder as finished AI intelligence. Every deterministic output is
labelled `producer: deterministic`; model output is only used when a provider is
configured and passes the validated orchestration contract.

## PROMPT 4 STATUS — PASS (internal scope complete)

All implementable internal Prompt 4 requirements are implemented and verified. Four
capabilities remain externally blocked and are listed verbatim in
[External blockers](#external-blockers). No internal failure remains open.

## Implemented systems

| # | System | Status | Where |
|---|---|---|---|
| 1 | Director provider/orchestration architecture | PASS | `backend/app/services/ai/provider.py`, `ai/openai_compatible.py`, `ai/orchestration.py`, `dependencies/ai.py` — capability report, schema validation, bounded repair, revision guard, idempotency key |
| 2 | Intelligent Brief | PASS | `backend/app/domain/brief.py`; Studio **Brief** canvas writes through `POST /director/brief` with a brief-revision guard |
| 3 | Adaptive questions | PASS | `plan_questions` / `MissingDecision`; Home re-plans after each answer and records the decision ledger |
| 4 | Reference capability truth | PASS | `CapabilityReport` is attached before any analysis runs and is displayed even for `not_started` references |
| 5 | Video preprocessing and analysis | PASS (implementation) | `services/media/{probe,decode,frames,audio,storage}.py`; container metadata, decode probe, measured pauses. Real frame extraction is externally blocked |
| 6 | Image reverse engineering | PASS | image decode/probe path with synthetic PNG fixtures |
| 7 | Audio/transcription analysis | PASS (measured audio) | audio decode, duration and loudness measurement; speech transcription needs a provider |
| 8 | Document/Script analysis | PASS | `services/media/documents.py` (text/DOCX extraction) |
| 9 | Evidence/timecode findings | PASS | `EvidenceRef` timecode/time-range/frame/measurement; rendered in the Reference canvas and refused in SQL when `observed` has no evidence |
| 10 | OBSERVED / ESTIMATED / RECOMMENDED / UNKNOWN | PASS | `EpistemicClass` end-to-end, incl. the `observed`-without-evidence insert refusal |
| 11 | Technique extraction | PASS | `Technique` + `creative_techniques` / `reference_technique_links` |
| 12 | "What makes this work?" causal analysis | PASS | `CausalExplanation`; "Why does this feel premium?" answers from measured evidence |
| 13 | Style DNA foundation | PASS | `StyleDNA` sections/palette persisted and rendered |
| 14 | Multiple Reference roles and conflicts | PASS | `ReferenceRole` assignment per reference + `StyleConflict` |
| 15 | Structured Story generation | PASS | `StoryPlan`/`StoryBeat`; Studio **Story** canvas + alternatives endpoint |
| 16 | Structured Script generation | PASS | `ScriptPlan`/`ScriptScenePlan`; readable Script document + structured lines |
| 17 | First-class Dialogue | PASS | `dialogue_lines` (no `text` kind), dialogue operations endpoint, Studio dialogue table |
| 18 | Characters | PASS | `Character` + `tonde.assets` / `scene_participants` |
| 19 | Environments | PASS | `Environment` + `environment_asset_id` |
| 20 | Products | PASS | `ProductRequirement`, category-aware identity confirmation |
| 21 | Runtime fit and validation | PASS | `RuntimeFit` + exact-sum scene validation in `apply_director_operation` |
| 22 | Complete Reality Check | PASS | `RealityReport` domains/items/conflicts/adaptations/mode; Studio **Reality Check** canvas |
| 23 | Director commands on real Production scopes | PASS | `route_command`/`execute_command` scoped to Story/Script/Scenes/References/Reality, applied through the guarded RPC |
| 24 | Studio Brief surface | PASS | `frontend/src/components/StudioCanvases.tsx` `BriefCanvas` — editable, revision-guarded |
| 25 | Studio Reference Analysis surface | PASS | `ReferenceCanvas` — capability, findings, evidence, techniques, Style DNA, causal, limits, re-analysis, role assignment |
| 26 | Studio Story surface | PASS | `StoryCanvas` — beats, structure, alternatives, "use this direction" |
| 27 | Studio Script surface | PASS | `ScriptCanvas` — persisted Script document plus structured dialogue, dialogue operations |
| 28 | Studio Reality Check surface | PASS | `RealityCanvas` — feasibility, complexity, items, conflicts, adaptations, Setup truthfulness |
| 29 | Home → Director → Production → Studio persistence | PASS | Home plans, answers and commits one Production; Playwright drives the whole path |
| 30 | Database/RLS/security for all new Prompt 4 resources | PASS | migrations 012–014; PGlite suite asserts SELECT-only policies and RPC EXECUTE grants |

## Migrations

Local migration files (additive; applied migrations 001–010 were never rewritten):

- `supabase/migrations/202610050011_director_intake.sql` — director intake/plan persistence (local only).
- `supabase/migrations/202610050012_director_intelligence.sql` — Brief, Story, Reality, decisions, operations, reference analyses (local only).
- `supabase/migrations/202610050013_director_reference_and_apply.sql` — reference findings/techniques/links, claim + save RPCs (local only).
- `supabase/migrations/202610050014_director_apply_operation.sql` — `apply_director_operation` plus `tonde_private.director_apply_assets` / `director_guard` (local only).

Repairs made to 012–014 during this correction (local files only, never applied to hosted):

1. `target_operation` parameter renamed so the upsert is no longer ambiguous with `director_operations.operation_id`.
2. Script text aggregation alias disambiguated (`script_line`).
3. Dialogue line `kind` validated against `tonde.dialogue_kind` before insert.
4. `production_references.state` cast to the `reference_state` enum instead of text.
5. `scene_participants` insert guarded by `not exists` instead of an ambiguous `on conflict`.
6. `<<assets>>` block labelled before `DECLARE`; `technique_id`/`asset_id` ambiguity removed.
7. Style Bible asset deduplicated by name instead of inserting a row per operation.

Migrations 009 and 010 were applied to the hosted project by the operator earlier and
were **not** reapplied or modified.

### Manual hosted apply files

`supabase/manual-apply/` holds the exact SQL the hosted project still needs, outside
`supabase/migrations/` so the generator/boundary scripts never execute it twice:

- `01_202610050011_director_intake.sql`
- `02_202610050012_director_intelligence.sql`
- `03_202610050013_director_reference_and_apply.sql`
- `04_202610050014_director_apply_operation.sql`
- `05_verify.sql` — every row must read `OK`
- `202610050011_to_014_director_intelligence.sql` — the same four files concatenated
- `README.md` — apply order, never-rules and clipboard-safe copy commands

Every file is ASCII-only and starts with executable SQL (`begin;`), never with a comment:
a paste path that drops the first character turned a leading `--` line into `- …` and
failed with `syntax error at or near "-"`. The single files are also small enough
(21–30 KB) to paste one at a time.

Verified locally in an embedded PostgreSQL on top of migrations 001–010: both the
per-file route and the combined route applied cleanly and `05_verify.sql` returned 22/22
objects `OK`; a second run failed with `relation "director_intakes" already exists` (the
documented non-idempotency); and the privilege check confirmed `authenticated` may
execute `tonde.apply_director_operation` while `anon` may not and
`tonde_private.director_guard` / `director_apply_assets` are not executable by
`authenticated`.

## Exact test counts

| Gate | Command | Result |
|---|---|---|
| Backend unit + API + integration | `python -m pytest -q` (backend) | **96 passed** |
| — Director domain (`test_director_intelligence.py`) | | 21 |
| — Provider/media/reference (`test_director_provider_and_media.py`) | | 27 |
| — Director HTTP surfaces (`test_director_intelligence_api.py`) | | 21 |
| — Preserved Prompt 3 Director (`test_director.py`, `test_director_api.py`) | | 8 + 2 |
| Backend static analysis | `ruff check .` | **All checks passed** |
| Backend types | `mypy app` | **Success: no issues found in 44 source files** |
| Database + RLS + security | `node --test tests/database/*.test.mjs tests/product/*.test.mjs` | **41 passed** (foundation 21, Prompt 4 intelligence 8, constitution 6 + 6) |
| Constitution | `npm run test:constitution` | **12 passed** |
| Frontend unit | `npx vitest run` | **65 passed** in 5 files |
| Frontend types | `npm run typecheck` | clean |
| Frontend build | `npm run build` | built (1320 modules) |
| Browser E2E | `npx playwright test` | **8 passed** |
| Generated types | `node scripts/generate-database-types.mjs --check` | `Verified 50 tables, 17 SQL enums and shared product vocabulary.` |
| Boundary verification | `npm run verify:legacy` | `Active runtime has no legacy database/auth/product imports; seven routes and source migrations exist.` |
| Whitespace | `git diff --check` | clean |

`npm run lint` does not exist in this repository — no ESLint/Biome configuration is
present — so a frontend lint gate could not be run and is reported as not configured
rather than as passing.

New Prompt 4 test assets in this correction:

- `backend/tests/test_director_intelligence.py` (substance: 30 s commercial sums to
  exactly 30000 ms, 45 s trailer grammar, overfilled Script detection, command routing,
  injection handling, metadata-only refusal).
- `backend/tests/test_director_provider_and_media.py` (provider contract, repair,
  revision guard, idempotency, unconfigured provider; synthetic PNG/WAV/DOCX fixtures;
  media probe/decode/audio/documents/frames; reference pipeline).
- `backend/tests/test_director_intelligence_api.py` (MockTransport platform with full
  plan → commit round-trip, command, reference analysis, Brief, decisions, alternatives,
  dialogue, persisted readable documents, RLS boundary).
- `tests/database/prompt4-intelligence.test.mjs` (PGlite: policies, cross-workspace
  denial, confirmation and operation-type gates, exactly-once apply, idempotent replay,
  conflicting replay refusal, stale revision and non-exact sum rejection, archived prior
  Scenes, Brief revision conflict, decision ledger upsert, operation log, analysis claim
  and save validation, RPC EXECUTE grants).
- `frontend/src/test/foundation.test.tsx` (Director plan/commit flow, Studio Brief /
  References / Story / Script / Reality surfaces, Director preview → apply, unavailable
  service truthfulness) and `frontend/e2e/foundation.spec.ts` (Home → Studio E2E).

## Prompt 1 regression

PASS — seven-area shell and routing, Supabase Auth authority (session restore, logout
event, token refresh without re-bootstrap), no legacy route, Home upload/URL gating,
Settings sections, duration/upload validation: `foundation.test.tsx` + `product-areas.test.tsx`
(38 tests), `tests/database/foundation.test.mjs` (21), `tests/product` vocabulary checks,
Playwright shell/mobile/auth/command-search tests — all green.

## Prompt 2 regression

PASS — envelope, error taxonomy, workspace bootstrap, RLS/storage boundaries and the
security migrations: `tests/database/*.test.mjs`, backend `test_director_api.py`,
Playwright auth tests. No regression introduced. Hosted semantic diff remains externally
blocked (below), unchanged from the Prompt 2 correction handoff.

## Prompt 3 regression

PASS — Studio shell (Real default, AI switch, autosave, conflict handling, selection
persistence), Projects/Discover/Assets/Setup terminology separation, Director
foundation: `test_director.py` (8) + `test_director_api.py` (2) preserved; autosave and
route tests preserved and green; `verify:legacy` passes.

## Internal failures

INTERNAL FAILURES: NONE

All failures found during this correction were repaired at the cause and re-verified:

- Router import/dependency corrections and `main.py` cleanup (Ruff/mypy regressions).
- `director_commands.py` shadowed loop variables and missing imports (mypy).
- Deterministic intelligence callback returning the correct payload model.
- `STORY_APPROACH` mapping lookup for uncategorised production types.
- Production-constraint extraction (single camera / single light / solo / implied Product).
- Category-aware Product handling and implied-identity confirmation.
- `runtime_fit` reporting `over` when dialogue exceeds the assigned runtime.
- Seven real defects in migrations 013/014 (ambiguous columns/parameters, text→enum
  assignment, dialogue-kind validation, Style Bible duplication).
- Studio Script surface now returns the persisted readable Script document from
  `creative_documents` (found while wiring the canvas, fixed in the repository + surface).
- Home's plan failure is now surfaced to the creator instead of being silent.

## External blockers

BLOCKED — REAL EXTERNAL DEPENDENCY (no internal workaround exists):

1. **Live AI provider calls.** No AI provider credentials are configured
   (`provider: unconfigured`). The adapter, orchestration, repair and validation paths
   pass against mocks; a real model smoke test cannot run. Required: set
   `DIRECTOR_PROVIDER`, `DIRECTOR_BASE_URL`, `DIRECTOR_API_KEY` and `DIRECTOR_MODEL`
   for the deployment. The endpoint must be HTTPS outside local development.
2. **Real frame extraction.** `ffmpeg`/`ffprobe` are not installed on this machine, so
   `UnavailableFrameExtractor` is the local reality. Both the available and unavailable
   paths are tested, and video References report metadata-only capability rather than
   fabricated frame observations. Required: install `ffmpeg` and point `FFMPEG_PATH`
   at it (or put it on `PATH`) in the runtime image.
3. **Hosted Supabase application of migrations 011–014.** These four migrations are
   local-only. They must be applied to the linked hosted project, by hand, by the
   operator:
   ```
   supabase migration up --linked        # applies 202610050011 … 202610050014
   ```
   Do not reapply 009 or 010 — they were already applied by hand. The hosted semantic
   schema diff still cannot be produced here because neither Docker nor Podman is
   available, and broad real-user resource/six-bucket Storage/approval acceptance
   remains incomplete.
4. **Google OAuth and email delivery.** Google sign-in is disabled and email delivery is
   unverified in the hosted project (pre-existing, unchanged by this correction).

## READY FOR PROMPT 5 — YES

Structurally and behaviorally Prompt 4 is complete: the Director plans, asks, answers,
writes, persists and re-opens one Master Production with real Structured Story, Script,
Dialogue, Characters, Environments, Products, Style DNA, Reference intelligence,
causal analysis, Reality Check and RPC-scoped Director commands — all verified with
internal evidence and no fabricated certainty.

Two conditions travel with that YES and must be closed before hosted acceptance is
claimed for Prompt 4: apply migrations 011–014 to the hosted project (item 3 above) and
configure AI provider credentials so a real provider smoke test exists (item 1).
