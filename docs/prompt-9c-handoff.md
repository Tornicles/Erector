# Prompt 9C handoff — TONDE Production Memory & Structured Search

Status: **PASS 9C** (internal scope complete). This is **not** `MASTER PROMPT 9 — PASS`:
passes 9D–9G are not started. Hosted migrations 018, 019, 020 and 021 are not applied to the
linked Supabase project, and live AI/provider generation remains externally blocked by missing
credentials.

## PASS RESULTS

| Pass | Result | Scope |
|---|---|---|
| 9C — Production memory & structured search | PASS | Inspectable memory with real provenance and an authority hierarchy, pattern candidates that stay proposals, the memory policy, structured relational search returning real object references, RLS, backend HTTP surface, Studio surface, manual-apply package |

## WHAT 9C IS

Migration 021 is **additive**. Production Memory is not a second copy of canonical state and not a
hidden conversational profile: it is a small set of remembered statements, each pointing at the
real object and revision it was drawn from, with its scope, its authority tier, its origin and
whether it is still in force.

- **Four new enums:** `memory_scope` (production / series / workspace), `memory_kind`
  (preference / decision / pattern / technique / setup_fact / asset_usage / model_outcome /
  series_rule / correction / other), `memory_source` (creator_instruction / production_decision /
  saved_preference / historical_pattern / inference — the source *is* the authority tier) and
  `memory_origin` (declared / accepted / inferred).
- **Three new tables:** `tonde.memory_policies` (one policy per scope), `tonde.memory_candidates`
  (successful-pattern proposals drawn from real evidence) and `tonde.memory_items` (the remembered
  record itself).

## THERE IS NO DIRECT WRITE PATH

`memory_items`, `memory_candidates` and `memory_policies` carry only read policies for
`authenticated`; a direct `insert`/`update` returns `42501`. Every write goes through a guarded
`security definer` RPC behind `studio_guard` (an authenticated workspace **editor**), so memory
cannot be written behind the creator's back and cannot be edited in place.

## THE AUTHORITY HIERARCHY IS THE SOURCE

The tier is not a separate field that can drift from the source; the ordering is fixed by the
constitution and implemented once:

| Tier | Source | Rank |
|---|---|---|
| 1 | A current creator instruction | strongest |
| 2 | A current Production decision | |
| 3 | An explicit saved preference | |
| 4 | A historical pattern | |
| 5 | An inference | weakest |

- **Restating the same tier** replaces the older statement of that tier: the old row is retired
  with a reason, the new row points at it through `supersedes_id`, and both stay readable. An
  identical restatement refreshes the row in place and reports `updated: true`.
- **A stronger tier does not delete a weaker one.** It outranks it. Every item carries
  `in_force` and an `authority_line`, and an outranked item is labelled outranked rather than
  hidden, so the creator can see what is being overruled.
- **A correction becomes authoritative** by being recorded as a current creator instruction: it is
  a new tier-1 statement for the subject, and the older pattern or preference stays readable as
  history. This is what turns a correction into the thing TONDE actually uses.
- **`memory_resolve` explains the choice**: it names the winning item, lists everything it
  considered, and says what it outranked and why.

## TRUTHFULNESS

- **An inference is labelled an inference everywhere** — in the item, in the candidate, in search
  results and in the resolver — including when a policy accepted it automatically.
- **An inference cannot claim human authority.** The database rejects `origin='inferred'` with a
  source of `creator_instruction` or `production_decision`, and it rejects an inference with no
  evidence: an inference discloses the basis it came from, or it is not recorded. The application
  rejects it first (422), the database rejects it again.
- **`origin='accepted'` can never be typed in.** Only accepting a candidate creates accepted
  knowledge; `memory_item_set` refuses to write it.
- **Nothing becomes reusable memory from a single Shot.** A candidate is a *proposal* drawn from
  real evidence, and it is recorded only when the memory policy allows capture — never
  automatically, and never as a creator preference until the creator accepts it.

## CANDIDATES PIN EVIDENCE

A candidate stores the object it was observed on, the observation count and the real basis, and it
pins `source_object_id` + `source_revision`. If the object's revision has moved since the
candidate was recorded, deciding it returns `40001` (a conflict, not a silent application) — the
creator is told the evidence changed. Re-recording from the current revision retires the stale
candidate as `rejected` with a "Superseded" decision note, so the history stays readable and the
partial unique index on open candidates is never violated. (The supersede path selects the open
candidate, retires it, then inserts — it never relies on `ON CONFLICT` against a partial index.)

## SCOPE

Production memory stays local to its Production. Series memory follows that Series only.
Workspace memory applies everywhere in the workspace. A `scope='production'` filter excludes
workspace knowledge, and a query resolves against the scopes that actually contain the subject.

## STRUCTURED SEARCH — NO EMBEDDINGS, NO MEDIA

`production_search` reads real columns in fixed, named lanes and returns real object references
with the reason each one matched. There is no stemming, no fuzzy matching and no embedding, and it
does not read media. The lanes are: `shot`, `scene`, `plan`, `result`, `continuity_finding`,
`continuity_state`, `memory`, `asset`. Facets are real fields (text, Asset, approval, execution
method, provider, lens, continuity state, severity, Result state, memory kind, kinds), and every
response carries the limitation out loud. Memory results say whether the remembered item is
currently in force, so what TONDE is reusing is visible rather than implied.

## DATABASE

- Public RPCs granted to `authenticated` (11): `memory_policy_set`, `memory_policy_get`,
  `memory_item_set`, `memory_item_retire`, `memory_item_list`, `memory_resolve`,
  `memory_candidate_record`, `memory_candidate_list`, `memory_candidate_decide`, `memory_summary`,
  `production_search`.
- Private helpers in `tonde_private`, all revoked from `public, anon, authenticated, service_role`
  (6): `mi_rank` (the authority rank of a source), `mi_uuid` (rejects a malformed id with `22023`
  rather than an unhandled cast error), `mi_patterns` (deterministic lower-cased, whitespace-split,
  ≤6 terms of ≤80 chars — no stemming, no fuzzy matching), `mi_series_of`, `mi_policy` (returns
  which of explicit/default it resolved, so "capture is on" is never a guess) and `mi_search_lane`
  (one fixed template chosen by name — no caller text ever becomes SQL).
- `guard_mutation` is mounted on all three tables: identity stays immutable, revisions auto-bump,
  and a retired item is never rewritten into a live one.
- The live-identity index is a partial unique index on
  `(workspace_id, scope, coalesce(production_id…), coalesce(series_id…), subject_key, source) where
  retired_at is null and state='active'`: one live item per subject, per scope key, per tier.
- Real constraints enforce the product rules: only an inference may be unconfirmed, an inference
  must disclose a basis, an inference cannot claim human authority, a pinned version names its
  object, a candidate may not propose creator authority, and scope is coherent with its key.

## RLS AND SECURITY

- RLS is enabled explicitly on all three tables with the established tenant policies
  (`tenant_read` = workspace member, `tenant_insert` / `tenant_update` = editor).
- Reads run behind the member guard; every write runs behind `studio_guard`, which requires an
  authenticated workspace **editor**. A viewer may read memory; a viewer cannot write it.
- A cross-workspace call returns `42501` and the API translates it to 403. The database test
  proves Workspace B cannot read A's items, candidates or summary, cannot write, and that RLS
  hides A's memory from a direct table read entirely.

## BACKEND HTTP SURFACE

- [domain/memory.py](../backend/app/domain/memory.py) — bounded request contracts with the canonical
  memory vocabulary. `MemoryItemRequest`'s validator rejects an inference that claims creator
  authority or carries no basis, so a product rule is a clean 422 before the database sees it.
- [services/memory.py](../backend/app/services/memory.py) — `LAYER = 'Production memory'` and
  `MemoryRepository`, calling every guarded RPC through `rpc_detailed(..., layer=LAYER)` and
  carrying the display vocabulary, the authority rule and the limitation. It recomputes no
  authority value.
- [routers/production_memory.py](../backend/app/routers/production_memory.py) — under
  `/api/v1/workspaces/{workspace_id}/productions/{production_id}/memory`: `GET /vocabulary`,
  `GET /summary`, `GET /items`, `POST /items`, `POST /items/{item_id}/retire`, `GET /resolve`,
  `GET /policies`, `PUT /policies`, `GET /candidates`, `POST /candidates`,
  `POST /candidates/{candidate_id}/decide`, `GET /search`. Registered in
  [main.py](../backend/app/main.py).
- Error translation is the shared one: `42501` → 403, `40001`/`23514`/`23505` → 409,
  `22023`/`22001` → 422, `PGRST202`/`42883` → 503 `STUDIO_SCHEMA_MISSING` naming this layer.

## STUDIO SURFACE

- [services/productionMemory.ts](../frontend/src/services/productionMemory.ts) — the typed client
  with `SEARCH_KINDS`, `WRITABLE_ORIGINS` and `CANDIDATE_SOURCES`, so the browser cannot offer an
  origin the API will not accept or ask for a facet the API does not support.
- [studio/ProductionMemory.tsx](../frontend/src/studio/ProductionMemory.tsx) — the `Memory` tool in
  Studio: the recorded summary, the authority tier list as a visible ruleset, the remember form
  (scope, kind, subject, source, origin, drawn-from object, statement and — for an inference — the
  basis), the item table with in-force/outranked labels and the source-change line, "Why TONDE is
  using this" resolver, the policy controls, candidate accept/dismiss, and the structured search
  fieldset with result list. Wired into [StudioPage.tsx](../frontend/src/pages/StudioPage.tsx) as a
  creative-group tool with the `Library` icon, and styled by `.mem*` rules in
  [index.css](../frontend/src/index.css).
- The surface refuses what the product refuses: a submission with no subject or statement is
  blocked, an inference without a basis cannot be submitted, and there is no `Approve` control —
  accepting a candidate is knowledge, not an approval.

## MANUAL HOSTED APPLY

- `supabase/manual-apply/12_202610050021_production_memory.sql` is the executable tail of the
  migration, byte-for-byte (byte-compared during this pass), ASCII-only, `begin;` … `commit;`.
- `supabase/manual-apply/12_verify.sql` reports **132 checks** — tables, enums, every column,
  every product-rule constraint, RLS, policies per table, the three table guards, all 8 indexes,
  all 11 RPCs, all 6 private helpers, that those helpers are unreachable, and that each public RPC
  is granted to `authenticated`. Every row reads `OK` against a full 001→021 database. Steps 18–19
  are in `supabase/manual-apply/README.md`.
- Hosted 018, 019 and 020 remain unapplied as well: the packages `09_*`, `10_*`, `11_*` and `12_*`
  are queued in order. **Do not replay 009–020.**

## TEST COUNTS

| Suite | Result |
|---|---|
| `npm test` (root, embedded-PostgreSQL database tests incl. 19 Prompt 9C tests) | **171 passed / 0 failed** |
| Backend `pytest` (incl. 23 Prompt 9C API tests) | **341 passed** |
| Frontend `vitest` (incl. 13 Prompt 9C tests) | **178 passed** (13 files) |
| Playwright E2E (incl. the Prompt 9C spec, with a 390 px pass) | **16 passed** |
| `ruff check app tests` | clean |
| `mypy app` | clean (65 source files) |
| `npm run typecheck` / `npm run build` | clean / built |
| `node scripts/generate-database-types.mjs --check` | Verified 75 tables, 57 SQL enums, vocabulary current |
| `npm run verify:legacy` | clean |
| `git diff --check` | clean |

## SHARED VOCABULARY

The four new enums are mapped in `product/vocabulary.json` (`memoryScopes`, `memoryKinds`,
`memorySources`, `memoryOrigins`) and wired into
[scripts/generate-database-types.mjs](../scripts/generate-database-types.mjs), which now emits the
generated TS aliases and Python `StrEnum`s for them. Stored codes remain the SQL enum labels, so
display labels and storage codes cannot drift.

## ACCESSIBILITY / RESPONSIVE

The Memory surface uses labelled regions and controls (`aria-label` on scope, kind, subject,
source, origin, drawn-from, statement, basis, the state filter, and every search facet), a
`<fieldset>` for the search facets, a captioned table for items, `role="status"` for computed
notes and `role="alert"` for failures, and real `<button>` elements for every action. A blocked
submission explains itself ("an inference without a basis is refused") instead of failing silently.
State is never colour-only: every item and candidate carries a text label (In force / Not in
force, Inferred and unconfirmed, Waiting for your decision). Below 760 px the controls stack to a
single column and the tables scroll inside their own boxes — the browser test asserts
`documentElement.scrollWidth <= innerWidth` at a 390 px viewport.

## REPAIRS MADE IN THIS PASS (all fixed, none skipped)

1. `source_label` was used for two different things — the authority tier's label and the label of
   the object the memory was drawn from. Renamed the second to `source_object_label` so the
   surface can never confuse "Saved preference" with "Marcus".
2. `memory_item_list` and `memory_candidate_list` wrote `count(*)` into the same variable that held
   the page total, so a truncated page reported the wrong total. Removed the overwrite.
3. A malformed uuid raised an unhandled cast error instead of a clean rejection. Added
   `mi_uuid`, which regex-validates before casting and raises `22023`.
4. The supersede path used `ON CONFLICT` against the partial unique index, which needs the full
   `where` predicate and cannot re-record a candidate whose evidence moved. Replaced with
   select-then-retire-then-insert on both paths.
5. Six of my own test expectations were corrected against the real contract, not the other way
   round: `production_search` on an unknown Production is `P0002`; a `scope='production'` filter
   excludes workspace knowledge; the memory tables reject a direct write with `42501`;
   moved-evidence detection compares real revisions; `summary.limitations` matches on the hidden-
   profile sentence; and the frontend `AppError` uses the two-argument form.
6. **Migration 021 was not ASCII.** Eleven middle dots and one em dash had reached the SQL string
   literals. Every migration the manual-apply README ships is ASCII-only (a paste can drop or
   mangle the first byte, and the README promises it), so the separators were replaced with `-`,
   the migration and its byte-compared manual-apply tail were re-emitted, and the 001→021 stack
   was re-run to prove it still executes and the 19 database tests still pass.
7. Four strict-mode violations in the new browser spec: `'inferred'` matched five nodes (scoped to
   the exact pill), `'Memory source'` matched `'Memory source object'` (scoped with `exact`),
   `'Marcus close-up'` and the search notes matched several nodes (scoped to the search region),
   and the basis-gate assertion ran after a successful remember had cleared the form — it now
   refills the statement so only the basis varies.

## INTERNAL FAILURES

**NONE** outstanding.

## EXTERNAL BLOCKERS

- **Hosted migration 021 not applied** — BLOCKED. No Docker/Podman and no hosted credentials in
  this environment, so the semantic schema diff and the hosted apply are a manual Supabase action.
  The package is ready: `12_202610050021_production_memory.sql` then `12_verify.sql` (steps
  18–19). **Do not replay 009–020.**
- **Hosted migrations 018, 019 and 020 also still unapplied** (carried over from Prompts 8, 9A and
  9B, steps 12–17).
- **Live AI/provider generation** — BLOCKED — REAL EXTERNAL DEPENDENCY. The candidate-recording
  path is a contract with a guarded write, exercised through the API and database tests; no model
  produced a candidate in this pass.

## WHAT 9C DOES NOT CLAIM

- Search does not use embeddings and does not read media, motion or audio. It reads structured
  production state and returns real object references, and it says so on every response.
- Memory does not profile the creator. Nothing is inferred and remembered in the background; an
  inference must be recorded by a creator with a disclosed basis, and the surface says the
  limitation out loud.
- Recording a candidate is not a working model. The pattern-detection path is a contract with a
  guarded write: it was exercised through the API and database tests, not by a provider, so 9C
  does not claim TONDE *discovered* a pattern.
- Accepting a candidate is knowledge, not an approval, and it changes no object's approval state.

## READY FOR 9D

**YES** — the remembered statements, the authority hierarchy and the structured search are a
foundation 9D (versioning, branches, restore, merge and change impact) can read, and they do not
compete with `object_versions` or the 9A impact engine. Prompt 9 is **not** at
`MASTER PROMPT 9 — PASS` until 9D–9G are complete.
