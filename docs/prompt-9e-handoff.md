# Prompt 9E handoff — TONDE Approval, Locks & Production Readiness

> **Superseded hosted state (dated correction, 2026-10-08).** Every hosted migration
> statement below is the record of the day it was written. As of 2026-10-08 the linked
> project's ledger records **001–030** with matching `tonde` effects, the untruncated
> catalog comparison reports **0 differences over 4087 identities**
> (`test-results/pre-prompt10/hosted-final-diff.json`), and the expanded two-user runner
> reports **538 pass / 1 blocked / 0 fail**. The only remaining blockers are external
> (mail capacity, Google sign-in, plan-gated leaked-password protection). See the
> [Pre-Prompt-10 certification](pre-prompt10-final-certification.md).

Status: **PASS 9E** (internal scope complete). This is **not** `MASTER PROMPT 9 — PASS`: passes 9F
and 9G are not started. Hosted migrations 018–023 are not applied to the linked Supabase project,
and live AI/provider generation remains externally blocked by missing credentials.

## PASS RESULTS

| Pass | Result | Scope |
|---|---|---|
| 9E — Approval, locks & Production readiness | PASS | Approval that names the exact revision a creator accepted, an append-only decision record with actor/time/reason, explicit unlock, lock and approval kept independent, and a derived readiness category with navigable blockers instead of a score; RLS, backend HTTP surface, Studio surface, manual-apply package |

## WHAT 9E IS

Migration 023 is **additive**. It does not introduce a second approval vocabulary and it does not
replace the canonical `locked_at` column. What was missing was the *record* and the *derived
judgement*:

- **The record** — who decided, when, why, and which revision the decision named.
- **The derived judgement** — what prevents this Production from moving forward, expressed as a
  category with actionable, navigable blockers.

## APPROVAL IS A CREATOR DECISION ABOUT A SPECIFIC REVISION

- **The four canonical states are unchanged** (`draft` → `needs_review` → `approved` →
  `changed_after_approval`). 9E adds no parallel vocabulary, and the pre-existing
  `guard_human_acceptance` trigger still refuses an approval that no authenticated creator made
  (`42501`), including a `service_role` write.
- **Approval names the revision.** `approval_decide` writes the new approval and records
  `pinned_revision`, the actor and the time, so "approved" can be read back as *this exact
  revision*.
- **A later change is reported, not silently approved.** `guard_mutation` already flips approved
  content to `changed_after_approval` on a material edit; `access_state` reports
  `changed_since_approval` from that canonical signal and keeps showing the revision the earlier
  approval named.
- **A stale approval is rejected.** An `expected_revision` that no longer matches returns `40001`,
  so an approval never lands on content the creator did not see (§163).
- **An AI or service-role operation cannot manufacture approval.** The RPC requires a workspace
  editor and the database trigger requires a real creator; both are proven in the tests.

## LOCK AND APPROVAL ARE INDEPENDENT

- **Locked but draft is valid. Approved but unlocked is valid.** The database tests assert both.
- **Lock protects content.** Editing a locked object is refused by the pre-existing guard
  (`23514`), and the readiness engine reports a locked object that needs review instead of
  unlocking it.
- **Unlock is explicit.** It needs a reason at the surface, and the lock/unlock decision — actor,
  time, reason — is recorded. Locking an already-locked object is a conflict, not a silent no-op.
- **§94 propagation and locks was already honoured** by the 9A impact engine (locked objects are
  reported, approved content is flagged for review); 9E does not weaken it and the verifier asserts
  `apply_impact`'s lock reporting is still present.

## READINESS IS A CATEGORY, NOT A SCORE

- **One enum for the state:** `ready`, `ready_with_warnings`, `needs_review`, `blocked`, `unknown`.
- **Thirteen real dimensions:** decisions, story, script, scene plan, shots, continuity, resources,
  real execution, AI execution, approvals, dependencies, results, delivery. A dimension is reported
  only when it has real underlying state or a real blocker.
- **No percentage and no arbitrary score.** The response carries counts by severity and a headline;
  the only place the word "score" appears is the note that says readiness is *not* one.
- **Every blocker is actionable and navigable:** problem, affected scope (object id + label + kind),
  why it matters, required action, and the action source. Clicking one navigates to the real object.
- **Blockers are derived from real columns only**, for example: a blocking intake decision still on
  a TONDE default, no scene plan, a Scene with no Shots, a Shot with no duration or no plan, an open
  critical continuity finding, a missing or unverified Real requirement, an unresolved safety flag,
  an AI plan that is not approved, approved content that changed, an open stale artifact, a locked
  object that needs review, a Result that is still raw or was rejected, an unfinished export.
- **Nothing unavailable is fabricated.** AI provider availability is an external dependency and is
  never guessed; "Shot Match pickup" is only reported when a completed Shot Match report actually
  requires a decision; a Production is only called "blocked" on a real signal.

## DATABASE

- Public RPCs granted to `authenticated` (5): `approval_decide`, `lock_set`, `access_state`,
  `access_history`, `production_readiness`.
- Private helpers in `tonde_private`, all revoked from
  `public, anon, authenticated, service_role` (6): `ax_approval` (canonical approval read by kind),
  `ax_locked_at`, `ax_set_approval`, `ax_set_lock` (the guarded dispatchers that write the owning
  table), `rd_blocker` (one blocker shape) and `access_decisions_immutable` (the trigger).
- `tonde.access_decisions` is the append-only record. A `before update or delete` trigger rejects
  any change, and the table has **only** a `tenant_read` policy for `authenticated` — no insert,
  update or delete policy exists — so the only path that writes a decision is the guarded
  security-definer RPC.
- Indexes: `access_decisions_by_object`, `access_decisions_recent`.

## RLS AND SECURITY

- RLS is enabled explicitly on the new table with the established tenant read policy
  (`is_workspace_member`). Reads run behind `pi_read_guard` (any member, including a viewer); every
  write runs behind `studio_guard` (owner/admin/editor).
- A cross-workspace call returns `42501` and the API translates it to 403. The database test proves
  Workspace B cannot read readiness, state or decisions, and that RLS hides A's decisions from a
  direct table read.

## BACKEND HTTP SURFACE

- [domain/readiness.py](backend/app/domain/readiness.py) — bounded request contracts with the
  canonical access-action vocabulary. `LockRequest` refuses an unlock with no reason, and
  `ApprovalDecideRequest` refuses a decision that is not one of the three the database accepts, so
  a product-rule mistake is a clean 422 before the database sees it.
- [services/readiness.py](backend/app/services/readiness.py) — `LAYER = 'Production readiness'` and
  `ReadinessRepository`, calling every guarded RPC through `rpc_detailed(..., layer=LAYER)` and
  carrying the display vocabulary, the approval rule and the readiness limitation. It recomputes no
  approval state and computes no readiness itself.
- [routers/production_readiness.py](backend/app/routers/production_readiness.py) — under
  `/api/v1/workspaces/{workspace_id}/productions/{production_id}`: `GET /readiness/vocabulary`,
  `GET /readiness`, `GET /access/{object_id}`, `GET /access/{object_id}/history`,
  `POST /access/{object_id}/decide`, `POST /access/{object_id}/lock`. Registered in
  [main.py](backend/app/main.py).
- Error translation is the shared one: `42501` → 403, `40001`/`23514`/`23505` → 409,
  `22023`/`22001` → 422, `PGRST202`/`42883` → 503 `STUDIO_SCHEMA_MISSING` naming this layer.

## STUDIO SURFACE

- [services/productionReadiness.ts](frontend/src/services/productionReadiness.ts) — the typed client
  with the access actions, the reviewable kinds and the readiness vocabulary, so the browser cannot
  offer a decision or a kind the API will not accept.
- [studio/ProductionReadiness.tsx](frontend/src/studio/ProductionReadiness.tsx) — the `Readiness`
  tool in Studio: the readiness category with its headline, counts and dimensions, the blocker list
  with severity, why it matters, the next action and an **Open** button that navigates to the real
  object, and the per-object approval/lock panel showing the revision approved, the decider, the
  time, whether content changed since, the lock reason, the decision form (Approve / Request review
  / Reopen / Lock / Unlock) and the append-only decision history. Wired into
  [StudioPage.tsx](frontend/src/pages/StudioPage.tsx) as an execution-group tool with the
  `ClipboardCheck` icon, and styled by `.rd*` rules in [index.css](frontend/src/index.css).
- The surface refuses what the product refuses: unlocking without a reason is blocked, there is no
  score or percentage anywhere, and there is no control that could manufacture an approval.

## MANUAL HOSTED APPLY

- `supabase/manual-apply/14_202610050023_approval_lock_readiness.sql` is the executable tail of the
  migration, byte-for-byte (byte-compared during this pass), ASCII-only, `begin;` … `commit;`
  (677 lines).
- `supabase/manual-apply/14_verify.sql` reports **64 checks** — the table and its every column, the
  three enums with their exact label order, every product-rule constraint, RLS, the read policy and
  the deliberate *absence* of update/delete policies, the append-only trigger, the human-acceptance
  trigger still mounted on the approval-bearing tables, the honest `capture_revision` hook, the
  Prompt 9A impact engine still reporting locked dependents instead of rewriting them, both
  indexes, all 5 RPCs, all 6 private helpers, that those helpers are unreachable, and that each
  public RPC is granted to `authenticated`. Every row reads `OK` against a full 001→023 database.
  Steps 22–23 are in [supabase/manual-apply/README.md](supabase/manual-apply/README.md).
- Hosted 018–022 remain unapplied as well: the packages `09_*` … `14_*` are queued in order.
  **Do not replay 009–022.**

## TEST COUNTS

| Suite | Result |
|---|---|
| `npm test` (root, embedded-PostgreSQL database tests incl. 11 Prompt 9E tests) | **196 passed / 0 failed** |
| Backend `pytest` (incl. 12 Prompt 9E API tests) | **378 passed** |
| Frontend `vitest` (incl. 11 Prompt 9E tests) | **203 passed** (15 files) |
| Playwright E2E (incl. the Prompt 9E spec) | **18 passed** |
| `ruff check app tests` | clean |
| `mypy app` | clean (71 source files) |
| `npm run typecheck` / `npm run build` | clean / built |
| `node scripts/generate-database-types.mjs --check` | Verified 79 tables, 63 SQL enums, vocabulary current |
| `node scripts/verify-boundaries.mjs` | clean |
| `git diff --check` | clean |

## SHARED VOCABULARY

The three new enums are mapped in `product/vocabulary.json` (`accessActions`, `readinessStates`,
`readinessDimensions`) and wired into
[scripts/generate-database-types.mjs](scripts/generate-database-types.mjs), which emits the
generated TS aliases and Python `StrEnum`s for them. Stored codes remain the SQL enum labels, so
display labels and storage codes cannot drift.

## REPAIRS MADE IN THIS PASS (all fixed, none skipped)

1. Six of my own test expectations were corrected against the real contract rather than the other
   way round: `23514` translates to `STUDIO_RULE_VIOLATION`, a service-role approval is refused
   before the trigger body runs, the decision record is unreachable for a service-role write through
   privileges as well as the trigger, a `director_decisions` row is not insertable through the
   client role, a Real plan's `plan_status` is one of the real values (`planned` is not one), and a
   cross-workspace read is hidden by RLS rather than raising.
2. The component rendered the same lock/unlock outcome twice (as a notice *and* as a redundant
   status line); the duplicate was removed so one decision produces one message.
3. Three strict-mode violations in the new browser spec (`Blocked` and `Continuity` each matched
   both the state badge and a dimension label, `4` matched more than one node, and the object
   picker defaulted to the Production rather than the Scene) were fixed by scoping and by selecting
   the Scene explicitly.
4. **Readiness must not invent a "critical Shot" or a provider outage.** Reviewing §98 while
   implementing it, the unapproved-Shot and provider-availability criteria could not be derived
   from real columns; the engine reports an aggregate "planned Shots are not approved" warning
   instead of calling any Shot critical, and it states out loud that provider availability is an
   external dependency it does not guess.

## INTERNAL FAILURES

**NONE** outstanding.

## EXTERNAL BLOCKERS

> Hosted-state note added by the Prompts 1–9 correction pass (2026-10-07, read-only inspection):
> the hosted project is at 001–010, so 011–017 were unapplied as well, not only the later migrations
> listed below. The bullets below record what this pass believed at the time; the authoritative
> per-version matrix is in `docs/system-gap-audit-prompt1-9-final.md`.

- **Hosted migration 023 not applied** — BLOCKED. No Docker/Podman and no hosted credentials in
  this environment, so the semantic schema diff and the hosted apply are a manual Supabase action.
  The package is ready: `14_202610050023_approval_lock_readiness.sql` then `14_verify.sql`
  (steps 22–23). **Do not replay 009–022.**
- **Hosted migrations 018, 019, 020, 021 and 022 also still unapplied** (carried over from Prompts
  8, 9A, 9B, 9C and 9D, steps 12–21).
- **Live AI/provider generation** — BLOCKED — REAL EXTERNAL DEPENDENCY. Nothing in 9E depends on a
  model: readiness is deterministic and approval is a creator decision.

## WHAT 9E DOES NOT CLAIM

- Readiness is not a score, a percentage or a prediction. It is a category derived from real
  production state, and every blocker it reports is inspectable.
- 9E does not check whether an external AI provider is actually reachable; provider availability is
  an external dependency and the surface says so.
- Approval is not a generation result, a validation pass or a model opinion, and readiness never
  turns into approval: a Production can be `ready` while content is still `draft`.

## READY FOR 9F

**YES** — approval, locks and readiness now read the 9A dependency graph, the 9B continuity findings
and the 9C/9D layers without competing with them, and the `Readiness` surface gives 9F (Results,
Shot Match and FIX THIS SHOT) a place to report a pickup requirement that already exists in
`shot_match_reports`. Prompt 9 is **not** at `MASTER PROMPT 9 — PASS` until 9F and 9G are complete.
