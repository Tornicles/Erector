# TONDE Constitutional Invariant Register

Part of [Product Constitution 1.3.0](constitution.md). IDs are stable. Tests protect the present foundation; policy entries are mandatory design/output review, not claims of completed engines. Product Constitution 1.1.0 added INV-33–39; 1.2.0 adds INV-40–48 (Amendment D); 1.3.0 adds INV-49–54 (Amendment E, the Director correction).

| ID | Non-negotiable rule | Enforcement / review |
|---|---|---|
| INV-01 | One canonical Production | Relational Production, shared plan FKs; DB compliance tests |
| INV-02 | Real/AI are execution representations | Two plans share one Shot; no duplicated master |
| INV-03 | Real Production is Studio default | Shared constant + real browser/component regression |
| INV-04 | Hybrid is per-Shot execution strategy | `hybrid` assignment, only real/ai faces/plans |
| INV-05 | Production Kit means everything the creator can create with; adapt to actual resources, never make expensive gear a prerequisite | One `production_resources` inventory, actual availability/use references, Reality/Real plan regressions |
| INV-33 | Assets are reusable creative-world entities; Production Kit is creator execution capability; Settings is application/account configuration | Asset/resource category separation + generated area vocabulary/UI navigation |
| INV-34 | Reference Truth and Creator Purpose are separate; both are required before a Reference shapes Production | Additive Reference fields/provenance and Director shaping guard; incomplete rows remain savable but excluded |
| INV-35 | Metadata-only access is not media analysis; identity provenance never upgrades inferred/unknown to verified | Evidence/access tests, Reference API and Director contract tests |
| INV-36 | Extract the principle, not the scene; best means best for the creator's stated objective | Constitutional wording tests + Reference/Director policy review |
| INV-37 | Every timed audiovisual Production has an Audio Plan; intentional silence is valid; non-audiovisual work is not forced to have one | Conditional Audio Plan model and database/product regression |
| INV-38 | Music Direction and Sound Direction are distinct first-class Scene directions inside one versioned Production graph | Relational Audio/Scene direction rows, same-production FK, revision/dependency/approval tests |
| INV-39 | Supplied master music is separate from recommended music and audio rights/provenance; provider capability is never guessed | Audio contracts and Prompt Compiler capability-truth tests |
| INV-40 | A publication pins exact Production/Result revisions, media checksum and destination; content that moved invalidates the authorization instead of travelling under it | `publications` pin columns, fingerprint/authorization-staleness guards and API tests |
| INV-41 | Publishing requires an explicit recorded creator authorization naming that exact version and destination; a creative approval is not publishing authority and no service, scheduler or AI may record one | `publication_authorize` human-authority guard; backend/browser tests that AI/service writes cannot authorize |
| INV-42 | An ambiguous destination answer is destination state unknown, never published and never failed, until a reconciliation records what the destination shows | `publication_state` transition guards, `publication_reconcile`, retry-safety classification |
| INV-43 | Retries and repeat submissions must not duplicate a real-world action; submission identity is idempotent per pinned version and destination | Operation/idempotency identity on `publication_attempts`; duplicate-submission regression |
| INV-44 | TONDE stores no provider credential: a connection names the vault reference, the deployment vault owns refresh, and a credential the provider stops accepting moves to reauth_required | `integration_connections` vault-reference contract, literal-secret refusal, provider-verified state tests |
| INV-45 | Billing is server-authoritative: a subscription moves only from a verified provider event, and the browser cannot subscribe, grant an entitlement or record usage | Signature-verified `billing_webhook_*` receipt plus service-role-only commercial writes; browser route-absence test |
| INV-46 | Actual provider cost, estimated cost, the creator charge and credits consumed are four separate facts, never summed into one figure and never presented as revenue or invoice | `usage_events` cost bases; `cost_summary` separate totals with row counts |
| INV-47 | An export is built from the version it pins; an unreconstructable version fails truthfully, current state is never substituted, and artifact access is authorized per request and expires | `exports` pin/state guard, manifest and download-authorization tests |
| INV-48 | External actions preserve provenance and stay auditable: every authorization, attempt, webhook receipt and reconciliation records actor, time, provider identity and observation | Audit/actor columns on publication, integration and billing receipts; acceptance tests |
| INV-49 | TONDE is the production Director; final image/video generation is not required for core value and is never presented as a capability TONDE holds | `tonde.ai_director_boundary()` law surface, absence of any media-generation provider client/worker class and the Prompt 11 Director regression |
| INV-50 | AI Creation is an execution strategy TONDE directs: the playbook and the tool-specific production-ready prompt are TONDE's deliverable, and the creator executes them in the external tool they chose | `ai_tool_profiles`, `production_ai_tools`, `ai_playbook_for_shot`, `ai_playbook_prompt_compile` account/adaptation tests |
| INV-51 | AI Tool Knowledge is documented, sourced, reviewed knowledge; it is never an API connection, and a draft is reported but never applied | Tool-profile draft/review/version rules, `TOOL_PROFILE_VERSION_REQUIRED`, catalog `tonde_connection: none` |
| INV-52 | Media is executed outside TONDE: external tools are execution destinations and never Production truth, and TONDE never claims an execution it did not perform | Zero-generation-credential acceptance test (no connected provider, no recorded attempt) plus attempt/history reads |
| INV-53 | Every Result returns to TONDE, which checks it against the playbook over the closed criteria set and returns ACCEPT or FIX with instructions; a FIX produces the next prompt and the iteration records what changed | `ai_result_check` verdict/criteria guards, criterion-closure refusal, `ai_playbook_history` and the iteration regression |
| INV-54 | TONDE bills for the TONDE service only: it does not resell third-party generation, external tool cost stays the creator's own, and an estimate is never presented as an actual or an invented figure | Playbook cost block (`resold_by_tonde: false`, estimate vs actual, separate TONDE and external costs) and the cost-split regression |
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
