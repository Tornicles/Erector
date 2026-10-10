# Pre-Prompt 10 Product Amendment Handoff

> **Superseded hosted state (dated correction, 2026-10-08).** Every hosted migration
> statement below is the record of the day it was written. As of 2026-10-08 the linked
> project's ledger records **001–030** with matching `tonde` effects, the untruncated
> catalog comparison reports **0 differences over 4087 identities**
> (`test-results/pre-prompt10/hosted-final-diff.json`), and the expanded two-user runner
> reports **538 pass / 1 blocked / 0 fail**. The only remaining blockers are external
> (mail capacity, Google sign-in, plan-gated leaked-password protection). See the
> [Pre-Prompt-10 certification](pre-prompt10-final-certification.md).

**Date:** 2026-10-07  
**Status:** Local implementation pending final regression verification; hosted acceptance remains blocked and is not claimed.  
**Scope:** Focused amendment only. Prompt 10 and Prompt 11 have not started.

## Creator-approved product decisions

1. **Setup is Production Kit in creator-facing language.** The existing `production_resources`, `resource_compatibility`, `equipment_kits`, and `kit_resources` inventory remains canonical. The `/setup` route and SQL identifiers remain compatible; expensive gear is never a prerequisite for creativity.
2. **Reference identity and creator purpose are separate.** A Reference remains savable while incomplete, but neither Director evidence nor Production shaping may use it until source identity has verified provenance and the creator has supplied a purpose. Metadata-only URLs remain metadata-only; source description does not acquire a new meaning.
3. **Audio is first-class production direction.** Each relevant timed audiovisual Production has one Audio Plan. Each Scene has distinct Music Direction and Sound Direction, with integer-millisecond cues, intentional silence, recording considerations, provenance and the existing history/approval/lock/dependency model. Dialogue remains in the Script.

## Delivered locally

- Constitution, glossary, invariant register, compliance record and generated vocabulary are versioned together as Product Constitution 1.1.0, effective 2026-10-07.
  *(Later state, 2026-10-08: the constitution is now **1.2.0** — Prompt 10 added external publication, export and commercial integrity, INV-40–INV-48; see the [Prompt 10 completion handoff](prompt-10-completion-handoff.md). The 1.1.0 statements in this document remain the record of this handoff.)*
- Additive migration `202610050026_pre_prompt10_product_amendment.sql` preserves existing identifiers and legacy rows, adds verified Reference fields and guarded shaping constraints, and adds conditional Production/Scene Audio Plan persistence through scoped RPCs.
- Backend Director contexts filter incomplete References from shaping/evidence. Studio keeps saved References visible and reports incomplete state without inventing analysis. Audio routes use authenticated reads and editor-only revision-checked RPC writes.
- Frontend captures identity/purpose, saves incomplete References without analysis, and enables analysis only when ready. Audio presents a Production Plan plus separate per-Scene Music and Sound editors. Production Kit replaces Setup in visible naming while retaining `/setup`.
- Generated Supabase types are produced only by `node scripts/generate-database-types.mjs`; the `--check` command is the source-of-truth consistency check.

## Verification required before amendment PASS

Run and record the final results for:

- `node scripts/generate-database-types.mjs` and `node scripts/generate-database-types.mjs --check`
- Full PGlite migration replay, focused amendment tests, and the idempotent whole-schema verifier after regenerating its artifact
- Root product/database/security regressions: `npm test`
- Backend tests from the project virtual environment
- Frontend typecheck, tests and build
- The creator-facing interface: saved-but-incomplete Reference, verified/purpose-complete Reference, blocked analysis before completion, audio-plan conditionality, intentional silence and per-Scene Music/Sound save/reload

An internal failure is not a PASS and must be repaired. Do not weaken assertions to force a pass.

## Hosted boundary

No hosted SQL was executed as part of this amendment. The repository's known hosted baseline remains: migration ledger 001–010; schema effects 001–014; migrations 011–014 applied by hand without ledger rows and therefore history-only reconciliation is required (never replay); 015–026 are not established as hosted. Semantic diff remains blocked without Docker/Podman. Google OAuth/email delivery and broad authenticated-user/Storage acceptance are separately incomplete. Local PGlite, mocked API, generated types and browser tests do not prove hosted acceptance.

## Repairs applied during final regression verification

Four failures blocked the root suite. Each was reproduced on a real embedded PostgreSQL stack and re-verified after the repair:

- `202610050026` declared `tonde_private.validate_reference_revision()` and its trigger twice, so the migration aborted with `42723` and every migration-applying test failed before it ran. The duplicated block was removed; the file applies cleanly over 001-025.
- `202610050026` widened `tonde_private.pi_is_locked()` so a derived artifact inherited the lock of the source it was derived from. Impact propagation then classified a locked Shot's execution plan as locked, skipped it, and never marked it stale, silently hiding that the plan no longer matched its source. Four 9A/9E certification tests pin the opposite: a locked source is skipped for rewriting while its artifact is marked and reported. Execution plans, creative documents, dialogue lines and Results are again locked only by their own lock; enclosing scopes are still inherited.
- `docs/product/constitution.md` replaced the `SETUP` row of the application responsibility matrix with a `PRODUCTION KIT` row, losing the canonical area id that `product/vocabulary.json` still carries (`areas.setup.title = Production Kit`). The row is `SETUP` again, titled Production Kit, so the seven responsibility boundaries remain pinned.
- `tests/database/prompt4-intelligence.test.mjs` predates Amendment B and analysed a Reference with no identity or creator purpose. Its fixture now establishes both through the scoped `tonde.reference_identity_save` attestation action before analysing it. No assertion was changed.

Recorded after the repairs: root `npm test` 225/225, `generate-database-types.mjs --check` clean, and the rebuilt whole-schema artifact passing its idempotency proof (2/2). The `supabase/manual-apply` README records the one deliberate difference the artifact's ACL comparison tolerates.

## Sequence boundary

This amendment does not begin Prompt 10 or Prompt 11. Do not auto-start a later prompt when amendment work is complete. The amendment's final certification is only `PRE PROMPT 10 PRODUCT AMENDMENT — PASS` or `PRE PROMPT 10 PRODUCT AMENDMENT — FAIL` after final checks.
