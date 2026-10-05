# TONDE Constitutional Invariant Register

Part of [Product Constitution 1.0.0](constitution.md). IDs are stable. Tests protect the present foundation; policy entries are mandatory design/output review, not claims of completed engines.

| ID | Non-negotiable rule | Enforcement / review |
|---|---|---|
| INV-01 | One canonical Production | Relational Production, shared plan FKs; DB compliance tests |
| INV-02 | Real/AI are execution representations | Two plans share one Shot; no duplicated master |
| INV-03 | Real Production is Studio default | Shared constant + real browser/component regression |
| INV-04 | Hybrid is per-Shot execution strategy | `hybrid` assignment, only real/ai faces/plans |
| INV-05 | Setup means production capabilities | Resource enum excludes environment |
| INV-06 | Assets mean reusable production entities | Independent Asset/media identity and versioned bindings |
| INV-07 | Settings means application/account config | Preferences separate from resource inventory; area matrix |
| INV-08 | Scene/Shot have durable identities | UUID constraints; both reorder tests preserve IDs |
| INV-09 | AI prompt is compiled artifact, not master truth | Execution contracts pin versions; no production prompt field |
| INV-10 | Dialogue consumes runtime | Exact line durations; plan/runtime review in future engine |
| INV-11 | Approval requires human acceptance | Authenticated human-authority DB guard; AI result cannot approve |
| INV-12 | Lock protects decisions, independently of approval | Separate fields; locked mutations rejected |
| INV-13 | Results are actual execution evidence | Result/media relationships; no duplicate plan truth |
| INV-14 | Shot Match compares intent/Plan/Result | FKs + policy; analysis engine later |
| INV-15 | Analysis claims reflect actual accessible/analyzed media | Evidence modality contract; unavailable/unanalysed claims rejected |
| INV-16 | Never fake inaccessible-media analysis | Same contract; partial success explicit, no fabricated fallback |
| INV-17 | Distinguish Observed/Estimated/Recommended | Typed claim kinds, evidence/basis/uncertainty/recommendation checks |
| INV-18 | Generation APIs are optional | No provider requirement for core boot/planning contracts |
| INV-19 | Series Seasons are optional | Nullable collection; no-season DB fixture |
| INV-20 | Copyright inspiration produces original work | Rights/source types + mandatory policy/output review |
| INV-21 | Voice cloning requires authorization | Explicit scoped consent contract; direction is not cloning |
| INV-22 | Hierarchy scales to long form | Optional acts/sequences and bounded 300-shot regression |
| INV-23 | Important changes preserve history | Automatic immutable snapshots/parents/revisions; branches later |
| INV-24 | Canonical information lives once | Resource/Asset FKs; compiled source-version snapshots |
| INV-25 | Future features must serve production | Decision/admission framework; PR review requirement |
| INV-26 | Mutations have explicit scope and human authority | Required object/production/version scope, proposal vs apply |
| INV-27 | Exact deterministic application facts stay outside AI | Integer timing, ownership/status/order/file limits enforced by software |
| INV-28 | Partial completion/failure stays truthful | Scoped partial result contract; errors not complete output |
| INV-29 | Private workspace/media boundaries are mandatory | Existing RLS/Auth/storage regressions; hosted gate separate |
| INV-30 | Readiness derives from actual criteria | Future engine/output review; no fake percentage in shell |
| INV-31 | Full document and production package are distinct | Shared export-action contract; PDF/DOCX vs ZIP artifacts |
| INV-32 | Software-mutating AI output is structured/validated | Shared request/result schemas and no-prose-state policy |

## Review procedure for every future prompt

1. Cite affected invariant IDs and constitutional version.
2. Decide deterministic enforcement versus AI reasoning or policy review.
3. Reuse canonical current state; pin versions for historical artifacts.
4. Record migration/RLS/storage/compatibility impact and scoped approved/locked effects.
5. Add tests for implemented behavior and failure cases; rerun foundation/security regression.
6. Record PASS or externally BLOCKED per requirement; internal failures are repaired, never relabeled as blockers.
7. Explicitly amend version/history before intentionally changing a rule.

Rights/consent validity, actual human intent, safe physical execution, originality, estimate accuracy, accessibility completeness, readiness and future intelligence quality require workflow/output evaluation as they ship. Type validation alone cannot establish those facts.
