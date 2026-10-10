# Peer review — migration 017 (AI Creation) · independent verification

Written by a second agent session while the Prompt 7 implementer was mid-turn (7B).
Nothing in the implementer's working set was edited. This is a relay artifact.

## Independent verification results

Run while 7B was in flight:

| Check | Result |
| --- | --- |
| Root suite (`npm test`, DB + product) | **95/95 pass** — includes prompt5/prompt6/prompt7 DB suites exercising migrations 015–017 |
| Backend `pytest` | **139/139 pass** |
| Backend `mypy` / `ruff` | Failing **only** in `backend/app/services/ai_creation.py` (21 mypy, 54→7 ruff during the run) — the file actively being edited; transient, not a done-surface regression |
| Frontend `vitest` | **103/103 pass** |
| Frontend `tsc --noEmit` | Clean |
| `generate-database-types.mjs --check` | Fails **only** because `frontend/src/types/database.ts` has not yet been regenerated after migration 017. Generation itself succeeded, which independently proves **017 applies cleanly over the full 001→017 chain in PGlite**. |

**Action before 7A is called PASS:** run `node scripts/generate-database-types.mjs` (no flag) so `database.ts` / `product.ts` / `vocabulary.py` pick up the 017 tables and `ai_*` enums, then re-run `--check`.

## Review notes on migration 017 (all minor; none block the pass)

1. **`tonde.declare_ai_model` — update branch misses two capability columns.**
   The insert sets `supports_image_edit` and `supports_lipsync`; the re-declaration
   update branch never assigns them. Once declared, those two facts cannot be
   corrected via the RPC. Add them to the `update ... set` list.

2. **`declare_ai_model` update path bumps revision twice.**
   The main `update` runs, then a second `update ... set cost_known` runs (guard
   trigger bumps revision on each). Consider computing `cost_known` inside the first
   update expression so one edit = one revision.

3. **`tonde.create_ai_batch` hardcodes `'video'` as the attempt operation.**
   `tonde_private.ai_primary_operation(workspace, production, shot)` exists for
   exactly this and is unused here. A narration/speech Shot batched through this
   path is recorded as a `video` attempt.

4. **`tonde.select_ai_result` overwrites a prior decision.**
   Deselecting the previously selected attempt sets `creator_decision = 'reject'`,
   which clobbers a `needs_review` decision. Consider leaving the prior decision
   untouched and only clearing `selected`.

5. **`ai_creation_surface` calls `ai_readiness_state` ~3× per Shot.**
   The scenes lateral calls it once per shot, the shots aggregate once more, and the
   summary calls it up to three times per shot (ready / manual_export / blocked).
   Correct but O(3N) plpgsql invocations per load; a single-computation CTE would
   scale better on large productions.

6. **`execution_plans.model_profile_id` / `fallback_model_profile_id` have no FK.**
   Integrity is enforced only by `save_ai_plan`. Acceptable for RPC-only writes;
   note it so a future direct-write path doesn't bypass it.

## Handoff checklist items observed

- `.tmp-017check.mjs` is a scratch validator in the repo root — delete before handoff.
- `supabase/manual-apply/` currently carries bundles 06 (015) and 07 (016). Migration
  017 still needs its `08_*017*.sql` + verify script when the hosted bundle is prepared.
