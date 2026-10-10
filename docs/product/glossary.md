# Canonical TONDE Product Glossary

Part of [Product Constitution 1.2.0](constitution.md). Product meaning is authoritative; storage codes are compatibility mappings, not competing terminology.

| Term | Canonical meaning / home | Existing persistence or contract |
|---|---|---|
| Project | Organizational container for finding/managing work; no separate intelligence | `projects`; one or many Productions |
| Production / Master Production | The canonical creative thing TONDE directs; Master denotes shared truth, not another object | `productions` |
| Series | Recurring grouping of canonical Productions; not necessarily television | `series`, `series_episodes` |
| Season / Collection | Optional grouping inside Series; display wording follows creator context | `series_collections`; nullable `collection_id` |
| Episode / Day | A recurring production association with number/date/runtime | `series_episodes.production_id`; same Production/Studio |
| Act | Optional high-level narrative division | `acts` |
| Sequence | Related group of Scenes; optional | `sequences` |
| Scene | Coherent production/story unit with stable identity | `scenes`; optional sequence; no requirement for photographs |
| Shot | Smallest principal visual execution unit, not its order or a media file | `shots`; optional scene for photo concepts |
| Dialogue | First-class spoken/nonspoken line, pause/reaction/voiceover/narration with timing | `dialogue_lines`, creative documents |
| Reference | Source material with separate Reference Truth (what it is) and Creator Intent (why supplied/what to learn); both are required before it shapes a Production | `production_references`; identity/purpose fields, per-value provenance, access evidence and rights |
| Asset | Durable reusable production identity, not an upload | `assets`, `asset_media`, bindings |
| Environment / World | Production setting; World is its consistency definition, not a second location silo | environment Asset or production reference/binding; never Setup |
| Production Kit | Everything the creator can create with; TONDE adapts to actual resources instead of requiring expensive gear | Existing single inventory `production_resources`, `resource_compatibility`, `equipment_kits`, `kit_resources`; legacy `/setup` route only |
| Settings | Application/account preferences, connections/privacy/data/billing/help | profiles/preferences and privileged account service views; not equipment |
| Lock | Protected decision requiring explicit unlock to change | `locked_at`, scoped binding / future versioned lock data |
| Character / World / Product Lock | Protected reusable identity/consistency at a defined scope | Asset + binding + version; later specialized fields, not duplicated master objects |
| Approval | Explicit creator acceptance of a particular version | `approval` plus versions; human authority, distinct from lock |
| Version | Attributed saved state; preserve history/parent for alternatives | `object_versions`; main-line now, branches later |
| Result | Actually produced visual/audio/rendered evidence, not planned directions | `results`, media; Raw/Needs Review/Approved/Rejected/Final |
| Shot Match | Reference → Plan → Result comparison and corrected direction | `shot_match_reports`; vision engine later |
| Real Production | Default Studio execution face for physical directing | UI face `real`; never a separate master |
| Director | TONDE's product role: analyse, plan, recommend, compile the playbook and prompt, and evaluate the Result. Not the media generator | Constitution §22; `tonde.ai_director_boundary()` |
| AI Creation | Execution strategy TONDE directs for a Shot executed in an external AI tool: playbook + tool-specific prompt + Result check | UI face `ai` (labeled AI PLAYBOOK); `execution_plans.execution_method = ai`, `ai_playbook_for_shot` |
| AI Playbook | The structured direction for one AI-executed Shot: objective, execution, recommended tool and why, prompt, reference inputs, continuity, settings, expected Result and how TONDE will evaluate it | `save_ai_plan` plan document; `tonde.ai_playbook_for_shot()` |
| AI Tool Knowledge | Documented, sourced, reviewed knowledge of how an external tool reads a prompt: capability type, inputs, limits, prompt characteristics, strengths, limitations, workflow guidance, version and source. Never an API connection | `ai_tool_profiles`, `ai_tool_catalog`, `ai_tool_profile_save`/`_review` |
| External AI tool | An execution destination the creator owns and runs. Its capabilities, costs and outputs are evidence, never TONDE Production truth | `ai_providers` (identity), `production_ai_tools` (the creator's kit), `ai_provider_connections` (optional execution) |
| Result check | TONDE comparing an uploaded Result against the playbook over the named criteria and returning ACCEPT or FIX with instructions; a FIX produces the next prompt | `tonde.ai_result_check()`, `shot_match_reports` verdict/criteria/instructions |
| External tool cost | What the creator's own external tool may charge them. Separate from the TONDE charge, and never resold by TONDE | Playbook cost block (`cost.external_tool_cost`, `resold_by_tonde: false`) |
| TONDE cost | What TONDE charges for directing the Shot. An estimate stays an estimate and is never presented as an actual or as the tool's cost | `execution_plans.cost_*`, `usage_events`, playbook cost block |
| Real Execution | Physical plan attached to canonical Shot | `execution_plans.execution_method = real` |
| AI Execution | The playbook TONDE compiles for a canonical Shot that will be executed in the creator's own external tool | `execution_plans.execution_method = ai` |
| Hybrid | Per-Shot SHOOT + AI strategy, potentially both execution plans | `shots.execution_method = hybrid`; no third required face |
| Production Bible | Persistent structured production knowledge for consistency | Creative documents/Assets/versions; not a giant production JSON blob |
| Style Bible | Visual-language component reusable as Asset | `asset_type = style_bible`; subset of Production Bible |
| Production Technique | Reusable production knowledge that alters directions | Discover/future typed plan associations; not decorative effects |
| Prompt | Compiled model-specific execution artifact with pinned source versions | AI execution artifact; never master creative truth |
| Media | Independent storage/file metadata and derivatives | `media_files`; Assets/References/Results attach it |
| Job | Background processing record, not creative work | `jobs`; leases/state, execution deferred |
| Export | Pinned-version deliverable; full document vs execution package | `exports`, job, generated media |
| Reference Truth | Source title/name, URL, provider/type and reliable metadata/media identity, each with honest origin/status; never creator intent | Additive `production_references` identity fields and provenance |
| Creator Purpose | Why a Reference was supplied and what the creator wants TONDE to learn; separate from source metadata | Additive `production_references.creator_purpose` and learning targets |
| Audio Plan | Production-level direction for timed audiovisual audio, including dialogue, music, sound, ambience, silence and continuity; conditional for non-audiovisual work | First-class Production row; dependencies/versioning on the same Master Production |
| Music Direction | Scene-level musical purpose and cue behavior, including relation to a master song and Production timing | First-class direction within the Production's Audio Plan graph |
| Sound Direction | Scene-level sound design and capture/creation direction, independent of music | First-class direction within the Production's Audio Plan graph |
| Provenance | Origin/rights/context; origin does not grant consent/license | Reference identity provenance and separate audio rights/provenance |
| Observed | Claim directly supported by analyzed evidence | `claim_kind = observed` in shared contracts |
| Estimated | Inference with assumptions and uncertainty | `claim_kind = estimated` |
| Recommended | Proposed execution choice, not source fact | `claim_kind = recommended` |
| Readiness | Criteria-based production executability/completeness, not arbitrary progress | Future criteria/blockers; job progress is unrelated |
| Publication | One pinned version of one Production prepared for one external destination, with its own authorizations, attempts and reconciliations | `publications`, `publication_authorizations`, `publication_attempts`, `publication_reconciliations`; state `draft`→`ready`→`awaiting_authorization`→`submitting`→`submitted`→`processing`→`published`, plus `failed`, `cancelled`, `removed`, `unknown_remote_state` |
| Publishing authorization | The creator's recorded decision that this exact Production revision, Result revision, media checksum and destination may be sent; never the Result's creative approval | `publication_authorizations`; `publication_authorize` human-authority guard |
| Destination connection | A provider account TONDE may act through, described as connected only after the provider itself confirmed it; TONDE stores the vault reference, never the credential | `integration_connections`, `integration_providers`, `integration_provider_capabilities`, `integration_oauth_states` |
| Destination state unknown | The honest state of an ambiguous external answer; it is never reported as published or failed until a reconciliation records what the destination shows | `publication_state = unknown_remote_state`, `publication_reconciliations` |
| Reconciliation | A recorded statement of what the destination actually shows, by source (provider API or a human observing it) | `publication_reconciliations.remote_state`/`remote_resource_id` |
| Export artifact | The deliverable a build produces from the exact Production version the export pins, delivered through authorized expiring access | `exports` (`kind`, `state`, `production_version_id`, manifest), generated `media_files` in the private `tonde-exports` bucket |
| Entitlement | Server-authoritative commercial permission or limit for a capability, decided by the server before a paid operation and only explained in the browser | `entitlement_definitions`, `plan_entitlements`, `workspace_entitlements`; `entitlement_state` |
| Usage event | One metered fact with its cost basis: what the provider reported, what TONDE estimated, what the workspace was charged, or credits consumed | `usage_events` (`cost_basis`), `usage_reservations`; quantity is exact decimal, never inferred |
| Subscription | Provider-authoritative state of the workspace's plan; it moves only because a verified provider event says so | `billing_accounts`, `subscription_events`, `billing_plans` |
| Webhook receipt | A provider event recorded with its verification outcome before it can change commercial state; an unverified payload is never evidence | `billing_webhook_events` (state, signature verification, dedup identity), `billing_checkout_intents` |

## Terminology audit decisions

- Keep relational `production_resources`, `resource_compatibility`, `equipment_kits` and `kit_resources` as the single inventory. UI/domain calls this Production Kit; `resource_type` excludes environments. `/setup` is a compatibility URL, not creator-facing language.
- Reference Truth and Creator Purpose are separately persisted. Existing `source_description` retains its legacy semantics; it is never silently reinterpreted as title or purpose.
- Audio Plan is conditional on timed audiovisual intent, not a mandatory row for photography/text-only work. Music, sound and shot execution direction remain distinct fields in the same versioned Production graph.
- Keep `series_collections`; Season/Collection is optional display language, not a mandatory rename.
- New canonical creator terms: **Production Kit**, **Reference Identity**, **Creator Purpose**, **Audio Plan**, **Music Direction** and **Sound Direction**.
- Prompt 10 (Amendment D) canonical terms: **Publication**, **Publishing authorization**, **Destination connection**, **Destination state unknown**, **Reconciliation**, **Export artifact**, **Entitlement**, **Usage event**, **Subscription** and **Webhook receipt**. “Connected” is reserved for an account the provider itself confirmed; “published” is reserved for a state the destination actually confirmed, and an unconfigured deployment names the dependency it is missing instead of looking available.
- Keep `asset_type = environment`; World Lock enriches the same identity. Do not create a locations table just because a source calls it a location.
- Keep `real` / `ai` / `hybrid` storage codes; faces are **Real Production** / **AI Creation**, assignments are **SHOOT** / **GENERATE** / **SHOOT + AI**.
- Keep Project distinct from Production and Job. “Clip” describes imported/generated media if needed, never canonical Shot identity.
- Rights codes `authorized_identity` and `unknown` display **User-authorized identity** and **Unknown / unconfirmed**. Generated origin is not a new ownership classification.
- Add missing `product_film` and `trailer` classifications additively; no independent schemas.
- Promote CHECK-constrained reference/provenance and user-visible workflow codes to PostgreSQL enums and generated shared constants, instead of maintaining loose parallel string unions.
- Do not introduce a generic `production_status` mixing archive, approval, readiness, execution face and job state. Those are independent typed dimensions.
