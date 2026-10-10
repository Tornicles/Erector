# Prompt 9B handoff — TONDE Continuity Engine

Status: **PASS 9B** (internal scope complete). This is **not** `MASTER PROMPT 9 — PASS`:
passes 9C–9G are not started. Hosted migrations 018, 019 and 020 are not applied to the linked
Supabase project, and live AI/provider generation remains externally blocked by missing
credentials.

## PASS RESULTS

| Pass | Result | Scope |
|---|---|---|
| 9B — Continuity engine | PASS | Temporal declared state per trait and point in Production order, five deterministic rules, findings a creator decides about, lock interaction, analysis staleness, RLS, backend HTTP surface, Studio surface, manual-apply package |

## WHAT 9B IS

Migration 020 is **additive**. Continuity is not a new copy of the Production and not an end
report: it is a small set of declared facts about real canonical objects, compared in Production
order.

- **Six new enums:** `continuity_domain` (19 values from the constitution's continuity list),
  `continuity_anchor` (production / scene_opening / scene_ending / shot), `continuity_transition`
  (baseline / continuous / changed), `continuity_origin` (declared / derived / inferred),
  `continuity_finding_kind` (5 values) and `continuity_finding_state` (open / acknowledged /
  resolved / waived).
- **Three new tables:** `tonde.continuity_states` (statements), `tonde.continuity_checks` (recorded
  analyses) and `tonde.continuity_findings` (what a check found).

## CONTINUITY IS TEMPORAL

A statement is a claim about **one trait of one subject at one point in Production order**. It is
never a rewrite of the Scene, the Shot or the Asset.

- **One live statement per trait per point** is a partial unique index, not a convention.
  Recording a different value at the same point **supersedes** the older statement: the old row is
  retired with a reason, the new row points at it through `supersedes_id`, and both stay readable.
  An identical restatement refreshes the row in place and reports `updated: true`.
- **Retiring without a replacement is a first-class action** (`continuity_state_retire`): the
  creator may say a statement no longer applies and nothing is deleted.
- **The order is computed from the real hierarchy**, not from a caller-supplied number:
  `ci_scene_rank` orders Scenes by Act, then Sequence, then Scene order; `ci_shot_rank` places
  Shots inside their Scene. A Scene's opening state sorts before its Shots and its ending state
  after them, so the timeline reads the way the film plays. A Shot statement's position comes from
  the Shot itself, so a caller cannot place a statement anywhere else.

## THE FIVE DETERMINISTIC RULES

Every rule compares recorded declarations and nothing else. Each one is reachable and each one is
proven in the database test.

| Rule | Severity | What it means |
|---|---|---|
| `boundary_break` | critical | A trait changes **across a Scene boundary** and no change was declared: the state did not carry over |
| `unexplained_change` | warning | A trait's value changes **inside one Scene** while the statement says it continues unchanged |
| `lock_conflict` | critical | A declared change touches a subject protected by a real `ai_continuity_locks` row, cited in the finding's evidence |
| `missing_reason` | warning | A change was declared with no reason, so later Shots cannot be checked against it |
| `unverified_after` | info | The last statement for a trait is a declared change and later work has none: continuity there is **unknown** |

`unexplained_change` and `boundary_break` are mutually exclusive by construction (same Scene vs
different Scene), so one problem is never reported twice as two kinds.

## TRUTHFULNESS

- A check compares **declarations**. It does not analyse media. That limitation is stored on the
  check row and returned with every check, summary and findings page, and the Studio surface says
  it out loud.
- An unrecorded trait is **unknown**, never "consistent": a check with nothing recorded says there
  was nothing to compare, and `unverified_after` is an `info` finding rather than a silent pass.
- A verified run of the rules produces findings with `origin = 'derived'`, `epistemic =
  'observed'` and the real statements in `evidence`. The database test asserts that no finding
  from a deterministic check claims any other origin.
- An **inferred proposal** is `origin = 'inferred'`, may only be `estimated`, `recommended` or
  `unknown`, must disclose a basis and a rationale, and can never resolve itself or claim an
  observation. The app layer rejects `observed` before the database sees it, and the database
  constraint rejects it again.

## DATABASE

- Public RPCs granted to `authenticated` (9): `continuity_state_set`, `continuity_state_retire`,
  `continuity_state_list`, `continuity_chain`, `continuity_check`, `continuity_finding_list`,
  `continuity_finding_update`, `continuity_finding_record`, `continuity_summary`.
- Private helpers in `tonde_private`, all revoked from `public, anon, authenticated, service_role`
  (6): `ci_text` (rejects rather than truncates), `ci_scene_rank`, `ci_shot_rank`, `ci_timeline`
  (the ordered live statements), `ci_mark_stale` (marks the Production's recorded
  `continuity_analysis` artifact, naming the Scene or Shot that caused it - never a statement id,
  which is not an object in the registry) and `ci_stale_on_change` (trigger body).
- `guard_mutation` is mounted on all three tables: identity stays immutable, revisions auto-bump,
  and a retired statement is never rewritten into a live one.
- Real source changes make the recorded analysis out of date: `zz_continuity_on_scene_change` and
  `zz_continuity_on_shot_change` mark the Production's `continuity_analysis` artifact stale, a new
  statement does too, and a fresh check closes the marker it addresses. Nothing is deleted.
- **Is the last check still true?** `continuity_checks` pins the Production revision, the live
  statement count and the statement watermark it was computed from, so `is_current` is a
  comparison against real rows rather than a guess. Writing a statement flips it to false.
- **A finding cannot be approved.** The finding vocabulary has no `approved` state; resolving,
  waiving, acknowledging and reopening are the only decisions, and resolving changes no statement
  and no approval.

## RLS AND SECURITY

- RLS is enabled explicitly on all three tables with the established tenant policies
  (`tenant_read` = workspace member, `tenant_insert` / `tenant_update` = editor).
- Reads run `security definer` behind `pi_read_guard` (workspace member); every write runs behind
  `studio_guard`, which requires an authenticated workspace **editor**.
- A cross-workspace call returns `42501` and the API translates it to 403. The database test
  proves Workspace B cannot read A's summary, findings or chain, cannot write a statement, cannot
  run a check, and that RLS hides A's statements from a direct table read entirely.
- Knowing an object id is not authorization: every statement write validates that the subject, the
  Scene and the Shot really belong to that workspace and that Production, and rejects anything
  else with `22023`.

## BACKEND HTTP SURFACE

- [domain/continuity.py](backend/app/domain/continuity.py) — bounded request contracts for
  statements, retirement, checks, finding decisions and proposals, with the canonical continuity
  vocabulary. A malformed request is rejected by the application (422
  `INVALID_CONTINUITY_INPUT`) rather than by the database, and `anchor_is_coherent()` refuses a
  Shot statement without a Shot, a Scene statement without a Scene, and a Production statement
  that names either.
- [services/continuity.py](backend/app/services/continuity.py) — `LAYER = 'Production
  continuity'` and `ContinuityRepository`, which calls every guarded RPC through
  `rpc_detailed(..., layer=LAYER)`. It carries the display vocabulary, the five rules as the
  creator reads them, and the limitation; it recomputes no continuity value.
- [routers/production_continuity.py](backend/app/routers/production_continuity.py) — under
  `/api/v1/workspaces/{workspace_id}/productions/{production_id}/continuity`: `GET /vocabulary`,
  `GET /summary`, `GET /states`, `POST /states`, `POST /states/{state_id}/retire`, `GET /chain`,
  `POST /check`, `GET /findings`, `PATCH /findings/{finding_id}`, `POST /findings`. Registered in
  [main.py](backend/app/main.py).
- Error translation is the shared one: `42501` → 403, `40001`/`23514`/`23505` → 409,
  `22023`/`22001` → 422, `PGRST202`/`42883` → 503 `STUDIO_SCHEMA_MISSING` naming this layer.

## STUDIO SURFACE

- [services/productionContinuity.ts](frontend/src/services/productionContinuity.ts) — the typed
  client. `recordStatement` names the anchor target explicitly, and `recordProposal` sends the
  basis, so the browser cannot invent a point in the timeline or a piece of evidence.
- [studio/ProductionContinuity.tsx](frontend/src/studio/ProductionContinuity.tsx) — the
  `Continuity` tool in Studio: the recorded summary with whether the last check still matches the
  statements, the five rules as a visible ruleset, the declaration form (subject, domain, trait,
  value, anchor, transition, reason) with the anchor target named in the button, the statement
  table with superseded history on request, one subject's timeline in Production order, the check
  with its verdict and findings, the proposal labelled INFERRED and carrying its basis, and the
  creator decisions (acknowledge / resolve / waive). Wired into
  [StudioPage.tsx](frontend/src/pages/StudioPage.tsx) as a creative-group tool with the
  `ShieldCheck` icon, and styled by `.cont*` rules in [index.css](frontend/src/index.css).
- The surface refuses what the product refuses: a statement cannot be submitted for an anchor that
  names nothing, there is no `Approve` control for a finding, and the proposal's epistemic options
  exclude `observed`.

## MANUAL HOSTED APPLY

- `supabase/manual-apply/11_202610050020_continuity_engine.sql` is the executable tail of the
  migration, byte-for-byte (byte-compared during this pass), ASCII-only, `begin;` … `commit;`.
- `supabase/manual-apply/11_verify.sql` reports **128 checks** — tables, enums, every column, both
  anchor constraints, the partial unique index, RLS, policies, the three table guards, the two
  staleness triggers, all 7 indexes, all 9 RPCs, all 6 private helpers, that those helpers are
  unreachable, and that each public RPC is granted to `authenticated`. Every row reads `OK`
  against a full 001→020 database. Steps 16–17 are in `supabase/manual-apply/README.md`.
- Hosted 018 and 019 remain unapplied as well: the packages `09_*`, `10_*` and `11_*` are queued
  in order. **Do not replay 009–019.**

## TEST COUNTS

| Suite | Result |
|---|---|
| `npm test` (root, embedded-PostgreSQL database tests incl. 16 Prompt 9B tests) | **152 passed / 0 failed** |
| Backend `pytest` (incl. 16 Prompt 9B API tests) | **318 passed** |
| Frontend `vitest` (incl. 14 Prompt 9B tests) | **165 passed** (12 files) |
| Playwright E2E (incl. the Prompt 9B spec, with a 390 px pass) | **15 passed** |
| `ruff check app tests` | clean |
| `mypy app` | clean (62 source files) |
| `npm run typecheck` / `npm run build` | clean / built |
| `node scripts/generate-database-types.mjs --check` | Verified 72 tables, 53 SQL enums, vocabulary current |
| `npm run verify:legacy` | clean |
| `git diff --check` | clean |

## SHARED VOCABULARY

The six new enums are mapped in `product/vocabulary.json` (`continuityDomains`,
`continuityAnchors`, `continuityTransitions`, `continuityOrigins`, `continuityFindingKinds`,
`continuityFindingStates`) and wired into
[scripts/generate-database-types.mjs](scripts/generate-database-types.mjs), which now emits the
generated TS aliases and Python `StrEnum`s for them. Stored codes remain the SQL enum labels, so
display labels and storage codes cannot drift.

## ACCESSIBILITY / RESPONSIVE

The Continuity surface uses labelled regions and controls (`aria-label` on the subject, domain,
trait, value, anchor, transition, reason, severity filter and the retired toggle), a `<fieldset>`
legend for the ruleset in plain list form, a captioned table for statements, `role="status"` for
computed notes and `role="alert"` for failures, and real `<button>` elements for every action. A
blocked submission explains itself ("a Shot statement names a real Shot") instead of failing
silently. State is never colour-only: every finding and statement carries a text label
(Conflict/Caution/Note, Inferred (proposal), Estimated). Below 760 px the declaration controls
stack to a single column, the statement table scrolls inside its own box, and action rows become
full width — the browser test asserts `documentElement.scrollWidth <= innerWidth` at a 390 px
viewport.

## REPAIRS MADE IN THIS PASS (all fixed, none skipped)

1. Two ambiguous-column failures in `continuity_check` (`critical_count`, then `explanation` were
   both a plpgsql variable and a column of the row being updated). Renamed the variables; the rule
   counts are unchanged.
2. `pi_mark_stale` was being handed a **statement id** as `caused_by`, which violates the
   `stale_artifacts` → `tonde.objects` foreign key: a continuity statement is not an object in the
   registry. The marker now names the Scene or Shot that caused it, or nothing.
3. The supersede path inserted the new statement before retiring the old one, which the partial
   unique index correctly refused. Retire-then-insert is now the order; the history row cannot be
   lost.
4. A proposal with no evidence was reaching the database and coming back as a 409. The contract
   now requires a basis (`evidence` min length 1), so it is a clean 422 before anything is
   written.
5. The findings list filtered strictly on the latest check, which would have **hidden every
   proposal** (a proposal belongs to no check). The default page is now the latest check's
   findings *plus* proposals.
6. Three of my own test expectations were wrong and were corrected against the real contract, not
   the other way round: a lock is reported for **every** declared change to the locked subject (not
   just the newest), `unverified_after` fires **per trait** (not once), and an info-only check is
   still `consistent` with a finding that says the trait is unknown from there on. The
   `unverified_after` case also exposed that a `consistent` verdict needed its own explanation
   text instead of borrowing the warning one.
7. The e2e assertion matched the limitation text in three places at once; scoped to `.first()`.
8. `Route` is not a lucide-react export; the timeline action uses `GitCompare`.
9. A component test set the domain select before the vocabulary had loaded, so the select could
   not hold the value. The test now waits for a real option — which also proved the form is
   correctly gated on the single source of truth for domain labels.

## INTERNAL FAILURES

**NONE** outstanding.

## EXTERNAL BLOCKERS

- **Hosted migration 020 not applied** — BLOCKED. No Docker/Podman and no hosted credentials in
  this environment, so the semantic schema diff and the hosted apply are a manual Supabase action.
  The package is ready: `11_202610050020_continuity_engine.sql` then `11_verify.sql`
  (steps 16–17). **Do not replay 009–019.**
- **Hosted migrations 018 and 019 also still unapplied** (carried over from Prompts 8 and 9A,
  steps 12–15).
- **Live AI/provider generation** — BLOCKED — REAL EXTERNAL DEPENDENCY. Continuity proposals can
  be recorded and displayed, but no model produced one in this pass.

## WHAT 9B DOES NOT CLAIM

- A check does not look at media, motion, audio or timing. It compares declarations, and it says
  so on every response.
- No AI inference runs in this pass. The proposal path is a contract with a guarded write, not a
  working model: it was exercised through the API and database tests, not by a provider.
- `continuity_finding_record` accepts a proposal from any authenticated editor; nothing here proves
  a human wrote it. Consequential application continues to require explicit creator authority,
  which is why a proposal can never become a resolved fact on its own.

## SPECIFICATION NOTE

The Prompt 9 text supplied for this run was truncated at §28 ("Scene ending state"). 9B was
implemented from §26–§28 plus the authoritative constitution (§11 continuity/impact/approval,
§12 memory, §13 media truthfulness). Passes **9C–9F** (memory and structured search, versioning
and merge, approval/locks/readiness, Results/Shot Match/FIX THIS SHOT) need the remainder of the
Prompt 9 text to avoid inventing a second product interpretation.

## READY FOR 9C

**YES** — the continuity statements, the recorded checks and the staleness protocol are a
foundation 9C can search and 9E can read readiness from, with no competing mechanism. Prompt 9 is
**not** at `MASTER PROMPT 9 — PASS` until 9C–9G are complete.
