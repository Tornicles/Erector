# Prompt 9F handoff — TONDE Results, Shot Match & FIX THIS SHOT

> **Superseded hosted state (dated correction, 2026-10-08).** Every hosted migration
> statement below is the record of the day it was written. As of 2026-10-08 the linked
> project's ledger records **001–030** with matching `tonde` effects, the untruncated
> catalog comparison reports **0 differences over 4087 identities**
> (`test-results/pre-prompt10/hosted-final-diff.json`), and the expanded two-user runner
> reports **538 pass / 1 blocked / 0 fail**. The only remaining blockers are external
> (mail capacity, Google sign-in, plan-gated leaked-password protection). See the
> [Pre-Prompt-10 certification](pre-prompt10-final-certification.md).

Pass: **PASS 9F**.

This is an intermediate pass result. It does **not** read `MASTER PROMPT 9 — PASS`. Only 9G may
declare that, after full integration and certification.

## PASS RESULTS

| Pass | Status |
| --- | --- |
| 9A Dependency Graph & Impact | PASS |
| 9B Continuity Engine | PASS |
| 9C Production Memory & Structured Search | PASS |
| 9D Versioning, Branches, Restore, Merge & Change Impact | PASS |
| 9E Approval, Locks & Readiness | PASS |
| 9F Results, Shot Match & FIX THIS SHOT | PASS |
| 9G Full Integration & Certification | not started |

## WHAT 9F IS

9F closes the production loop from *"something was actually created"* to *"fix only this Shot"*:

WHAT WAS CREATED → WHAT THE MEDIA CAN SUPPORT → WHAT IS DIFFERENT → WHAT MATTERS MOST →
HOW TO FIX THIS SHOT → APPLY A SCOPED CORRECTION → COMPARE AGAIN.

It is built on the existing foundation rather than beside it: `tonde.results` and
`tonde.shot_match_reports` already existed as the review artifact, `tonde.object_versions` already
captured history, and Prompt 9A's impact engine and the Prompt 9C memory policy already owned
propagation and memory. 9F extends all four.

## A RESULT IS WHAT WAS ACTUALLY CREATED

A Result links to its Production, Scene, Shot, execution plan, Real Take or AI Attempt and media,
and keeps its provenance: which Take and its number and status, which Attempt, provider and model,
and the media's own upload/processing state. `result_register` refuses a Result that names no real
source (a Real Take Result without its Take, an AI Result with neither Attempt nor media), refuses a
Take or Attempt that belongs to another Shot, and always inserts `state = 'needs_review'` — a new
Result is never created approved and never created Final.

`result_state_set` enforces a real transition table and refuses Final unless a creator approved the
Result; asking for Final before accepting is answered with what is actually missing ("A Result
becomes Final only after a creator approved it") rather than only that the move is unavailable. The
creator's approve/finalize decision writes the approval against the exact revision just decided on,
so an accepted Result is never reported as merely *changed after approval* — and that decision is
recorded in the Prompt 9E append-only decision ledger.

## MEDIA CAPABILITY TRUTH

Modalities are derived in the database from real `media_files` rows (`ms_capabilities`): metadata
from the row, a thumbnail only when a thumbnail row exists, an image only when an image row exists,
frame-level comparison only when a keyframe was actually extracted, audio only when the media is
audio or an extracted track exists, text from `text/plain`. A caller that claims a modality the
database cannot substantiate is refused (`23514`), and the surface states what it could not compare
instead of implying it saw everything.

## FINDINGS KEEP THE EVIDENCE DISCIPLINE

A finding carries the category, expected, observed, difference, epistemic state, confidence,
evidence, severity and a suggested correction.

* an observed difference must cite the evidence it was seen on (refused otherwise, in SQL and in the
  request contract);
* epistemic must be one of observed / estimated / recommended / unknown, confidence high / medium /
  low, severity info / warning / critical, and the verdict one of the canonical five;
* a measured focal length is refused outright ("Report an estimated look, never a measured focal
  length"), and any finding key naming a person, face or identity is refused ("Shot Match never
  identifies a person by name or by face");
* an unknown finding field is refused against a whitelist.

## PRIORITISATION, NOT A SCORE

`ms_summary` produces the four-part summary from the findings themselves — what worked, what
drifted, what matters most, what to fix next — ordered by a production-impact weight (an unreadable
Product mark outranks a slight background colour variation), and its own note says the order is by
impact "not by a similarity score". No percentage, no similarity number and no aggregate score is
computed or rendered anywhere in the SQL, the API or the Studio surface.

## REAL, AI AND HYBRID RECOMMENDATIONS

The recommendation follows the execution method behind the Result: a Real mismatch recommends
`pickup_required`, an AI mismatch recommends `regeneration_recommended`, a Hybrid Result recommends
`both`, and a clean result recommends `none`. Deciding an analysis is a separate creator decision
(`pickup` / `regeneration` / `accepted` / `dismiss`) that records actor and time; `pickup` writes
`pickup_needed` into the Prompt 6 On-Set capture state, and `regeneration` launches nothing — the
response says so in words and the database test proves no `ai_generation_attempts` row is created.
A decided report stops blocking Prompt 9E readiness, because the report's own approval *is* its
review state.

## FIX THIS SHOT

`match_correction_propose` records a scoped correction on one real object: the target and its kind,
the source revision, a validated field patch (only fields the object kind may change), the root
cause, the reason, the affected scope, and the impact — computed by Prompt 9A's `impact_preview`,
never applied. Applying is a separate explicit decision:

* a locked target is refused (`23514`, "Unlock it deliberately before applying a correction");
* a moved target is a `40001` conflict, not a blind write;
* the patch is written through `vb_patch_apply(..., 'correction')`, so the new revision is versioned
  and honestly labelled `source_action = 'correction'`;
* the previous plan, the Result, the earlier Take/Attempt and every earlier analysis are preserved —
  the earlier revision's snapshot is untouched and is proven to be;
* impact then propagates through the existing `apply_impact` with the creator's chosen mode, so
  approved content is flagged for review and locked objects are reported instead of rewritten;
* reusable memory is opt-in and gated: a correction becomes a Prompt 9C memory candidate only when a
  later Shot Match report for the same Shot exists, and the refusal happens **before** anything is
  applied, so a refused memory request never changes the plan. Nothing becomes memory from one Shot,
  and no item is created automatically.

Rejecting a correction changes nothing and overwrites nothing.

## ITERATION HISTORY

`match_report_get` returns the Shot's whole chain of analyses in order, each with its severity,
recommendation and decision, and `result_detail` returns the Result's analyses and corrections. Take
1 → analysis → correction → Take 2 → analysis → approved stays readable, with the Result's own
revision history available through the existing `version_list`.

## DATABASE

Migration `supabase/migrations/202610050024_results_shot_match.sql` (955 lines, additive).

New enums: `match_verdict`, `correction_state`, `correction_recommendation`, `match_origin`.

New table `tonde.match_corrections` (28 columns, 5 workspace-scoped `restrict` foreign keys, checks
for a non-empty object patch and bounded text, `unique (workspace_id, id)`, three indexes) with
`enable row level security`, a `tenant_read` policy, `grant select` to `authenticated`, no
insert/update/delete policy, and the standard `guard_mutation` trigger.

Changed, both disclosed:

* `tonde.shot_match_reports` gains `capabilities`, `dimensions`, `summary`, `limitations`, `origin`,
  `recommendation`, `decision`, `decision_note`, `decided_by`, `decided_at`, a
  `shot_match_reports_workspace_identity` unique key (the table had none, so nothing could reference
  an analysis) and one index. It remains read-only to clients.
* `tonde_private.vb_fields` is replaced by an opt-in superset: the execution-plan fields a scoped
  correction legitimately targets (`performance`, `blocking`, `product_direction`, `provider_prompt`,
  `canonical_prompt`, `first_frame`, `last_frame`, `motion`) plus a `result` kind. Identity, ordering,
  approval and locks stay out of every map, and branching/versioning keep their existing fields.

11 public RPCs (`result_register`, `result_list`, `result_detail`, `result_state_set`,
`match_analyze`, `match_reports`, `match_report_get`, `match_report_decide`,
`match_correction_propose`, `match_correction_apply`, `match_correction_reject`), 8 new private
helpers (`ms_result`, `ms_dimension`, `ms_capabilities`, `ms_available`, `ms_severity_verdict`,
`ms_impact_weight`, `ms_summary`, `ms_method`), all revoked from `public, anon, authenticated,
service_role` and granted to `authenticated` only for the public RPCs.

## RLS AND SECURITY

* `tonde.match_corrections` is workspace-isolated: `tenant_read` uses
  `tonde_private.is_workspace_member(workspace_id)`, and a second workspace reads zero rows
  (proven in SQL).
* The table has no client write path at all: only the guarded security-definer RPCs write it, and a
  direct authenticated insert into `shot_match_reports` is denied (`42501`).
* Every write RPC requires a workspace editor (`require_workspace_editor`), every read accepts any
  member, and a non-member or another workspace is `42501` / 403.
* Reads run through `pi_read_guard`; every mutation runs through `studio_guard`.
* The private helpers are unreachable: `ms_capabilities` called directly is a permission error, and
  no grant exists to `authenticated`, `anon`, `service_role` or `PUBLIC`.
* No provider credential, service-role key or hosted secret is read or stored anywhere in this layer.

## BACKEND HTTP SURFACE

`backend/app/domain/shot_match.py`, `backend/app/services/shot_match.py` (`LAYER = 'Shot match'`)
and `backend/app/routers/production_shot_match.py`, registered in `backend/app/main.py`:

* `GET  …/shot-match/vocabulary`
* `GET  …/results`, `POST …/results`, `GET …/results/{result_id}`,
  `POST …/results/{result_id}/state`
* `GET  …/shot-match`, `POST …/shots/{shot_id}/shot-match`, `GET …/shot-match/{report_id}`,
  `POST …/shot-match/{report_id}/decide`
* `POST …/shot-match/{report_id}/corrections`,
  `POST …/shot-match/corrections/{correction_id}/apply`,
  `POST …/shot-match/corrections/{correction_id}/reject`

The service attaches product vocabulary and recomputes nothing: legality, staleness, locks, verified
capability and memory eligibility are decided in the database. The domain contracts bound what may
be asked for and turn a product mistake into a clean 422 with a reason (an observed finding without
evidence, an unsupported verdict/severity/confidence/epistemic, an unsupported continuity domain, a
correction with no real cause, an unsupported state, decision or propagation mode). Missing
migrations report `STUDIO_SCHEMA_MISSING` through the shared RPC helper.

## STUDIO SURFACE

`frontend/src/services/productionShotMatch.ts` and
`frontend/src/studio/ProductionShotMatch.tsx`, wired into the Studio's existing **Results** tool in
`frontend/src/pages/StudioPage.tsx` (which replaces the Prompt 1 placeholder that said *"Shot Match
arrives with Prompt 9"*; the stale caption was removed from `StudioCanvases5.tsx`) and styled by
`.ms*` rules in `frontend/src/index.css`.

The surface shows the Shot, the Results that exist for it with their provenance and verified
capability line, the selected Result's revision, plan and media state, the review decisions with the
reason, an explicit *Record this analysis* form (dimension, severity, what is different, the
evidence, a suggested correction), the analysis with its severity, recommendation, dimension
verdicts, evidence, four-part summary, what it could not see, the iteration history, the decision
row, and FIX THIS SHOT — target, field, corrected value, root cause and affected scope, followed by
the previewed impact and the apply/reject decision with the opt-in *Remember this fix* choice.

The correction target list always offers the execution plan the Result was actually made against,
because the Result itself names it, even when the caller cannot list plans. One decision produces
exactly one message.

## SHARED VOCABULARY

`product/vocabulary.json` gains `matchVerdicts`, `correctionStates`, `correctionRecommendations` and
`matchOrigins`, mapped in `scripts/generate-database-types.mjs` to
`match_verdict` / `correction_state` / `correction_recommendation` / `match_origin`. The generator
asserts the SQL enums equal the vocabulary exactly and was re-run; `--check` is clean at 80 tables
and 67 SQL enums. Nothing generated is hand-edited.

## MANUAL HOSTED APPLY

`supabase/manual-apply/15_202610050024_results_shot_match.sql` is the executable tail of migration
024 (`begin;` … `commit;`), byte-identical by `diff`, pure ASCII, 956 lines. It starts with
executable SQL so a clipboard that drops the first character fails visibly instead of subtly.

`supabase/manual-apply/15_verify.sql` is the verification query. Against a full 001→024 stack it
returns **102 rows, every one `OK`** (tables, enums and their labels, every new column and its enum
type, the workspace-identity constraint, the five workspace-scoped foreign keys, the patch check,
three indexes, all 8 private helpers and 11 public RPCs, the private-helper lockout, the public
grants, RLS enablement, the read-only policy set and the mutation guard).

`supabase/manual-apply/README.md` is retitled "011 to 024" and extended with steps 24–25 plus the
9F description (and the missing 9E description, which the 9E pass had left out).

## TEST COUNTS

| Suite | Result |
| --- | --- |
| `tests/database/prompt9f-shot-match.test.mjs` | 15 passed |
| Root `npm test` | 211 passed, 0 failed |
| `backend` pytest | 397 passed |
| `backend` ruff / mypy | clean / clean (74 files) |
| `frontend` vitest | 220 passed (16 files) |
| `frontend` typecheck / build | clean / succeeds |
| Playwright (Chromium) | 19 passed |
| `generate-database-types --check` | 80 tables, 67 enums verified |
| `verify-boundaries.mjs` | clean |
| `15_verify.sql` (001→024 stack) | 102 rows, all OK |

## REPAIRS MADE IN THIS PASS (all fixed, none skipped)

1. **`media_files_check1` blocked every 9F fixture.** Root cause: the test's media helper inserted a
   bucket outside the allowed set and an object key that did not match the
   `<workspace>/<row>/…` pattern. Repaired in the test with an explicit id, a valid
   `tonde-production-media` bucket and a well-formed key.
2. **`result_state_set` returned `23514` for Final after an approval.** Root cause: `state` and
   `approval` are separate columns; `guard_mutation` flips an approved row to
   `changed_after_approval` on any other-column change, and Final was gated on `approval` staying
   `approved`. Repaired in SQL: the creator's accept/finalize decision now re-asserts the approval on
   the exact revision it just decided, and records the accept in the Prompt 9E decision ledger. The
   Final refusal is also answered before the transition table, so the creator is told what is
   actually missing.
3. **`match_report_decide` raised "Review the changed version before approving it".** Root cause: the
   Prompt 4 `guard_human_acceptance` trigger refuses a statement that changes content *and* sets
   `approval = 'approved'` at once. Repaired in SQL: the decision is written first and the report's
   review approval is written in its own statement — which is also what makes a decided report stop
   blocking Prompt 9E readiness.
4. **A refused memory request applied the correction first.** Root cause: the
   "a later analysis must confirm it helped" check ran after `vb_patch_apply`. Repaired in SQL: the
   eligibility refusal now happens before anything is applied.
5. **Test-side defects**: an AI Result was registered without its Attempt or media and asserted to
   succeed (the API contract is right; the test was repaired), the iteration count over-counted, a
   historical snapshot was read from a surface that does not return snapshots (now read from
   `object_versions`), and a two-column query was read with a single-value helper.
6. **A duplicated capability line** rendered the same sentence in both the Result and the analysis.
   Repaired in the Studio surface: the analysis states its own basis as "This analysis was based on
   …" once.
7. **`ResultDetail` was an unsatisfiable intersection** (`match_reports: number & Array`). Repaired in
   the client types with `Omit<…, 'match_reports'>`, plus the `changed_fields` / `candidate` fields
   the apply response actually returns.
8. **A missing 9E description in the manual-apply README** was added while documenting 9F.
9. **A latent runtime bug in `match_analyze`**, found by the 9G integration test: when a Result has
   no execution plan, `limitations := limitations || '<literal>'` was resolved as array
   concatenation of an untyped literal and failed with `malformed array literal` (22P02). Repaired
   with an explicit `::text` cast. The manual-apply copy was regenerated after this edit, because a
   post-extraction edit invalidates it.

## INTERNAL FAILURES

**NONE.** Every failure found in this pass was reproduced, diagnosed to its root cause, fixed, and
re-tested; the counts above are from the final, fully re-run sweep.

## EXTERNAL BLOCKERS

> Hosted-state note added by the Prompts 1–9 correction pass (2026-10-07, read-only inspection):
> the hosted project is at 001–010, so 011–017 were unapplied as well, not only 018–024. The bullets
> below record what this pass believed at the time; the authoritative per-version matrix is in
> `docs/system-gap-audit-prompt1-9-final.md`.

* Hosted migrations 018–024 remain unapplied: a manual Supabase action, still blocked with no
  Docker/Podman and no hosted credentials. Step 24–25 of the manual-apply README is the forward
  package; verification against the hosted project is still outstanding. Migrations 009–023 must
  never be replayed.
* Live AI/multimodal provider analysis is a real external dependency and was never exercised: no
  model produced a finding in this pass. Shot Match is proven against real embedded PostgreSQL with
  creator-authored findings; a provider-backed analysis remains **BLOCKED — REAL EXTERNAL
  DEPENDENCY**.

## WHAT 9F DOES NOT CLAIM

* No analysis was produced by a model. The reasoning path takes findings and validates them; the
  deterministic path (capability, order, eligibility, propagation) is fully implemented and tested.
* No similarity score, percentage or confidence aggregate exists.
* No lens, focal length, person or identity is measured or identified from imagery.
* No generation was launched, and none can be launched from this surface.
* Hosted verification of migration 024 has not happened.

## READY FOR 9G

Yes. 9A → 9F are all PASS with the full suite green, and 9G is the only pass that may declare
`MASTER PROMPT 9 — PASS`.
