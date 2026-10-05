# Canonical TONDE Product Glossary

Part of [Product Constitution 1.0.0](constitution.md). Product meaning is authoritative; storage codes are compatibility mappings, not competing terminology.

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
| Reference | Source material describing desired characteristics; access and rights are separate | `production_references`; source, rights, state, media association |
| Asset | Durable reusable production identity, not an upload | `assets`, `asset_media`, bindings |
| Environment / World | Production setting; World is its consistency definition, not a second location silo | environment Asset or production reference/binding; never Setup |
| Setup | Creator's physical/software/AI-tool production capabilities | `production_resources`, compatibility, kits |
| Settings | Application/account preferences, connections/privacy/data/billing/help | profiles/preferences and privileged account service views; not equipment |
| Lock | Protected decision requiring explicit unlock to change | `locked_at`, scoped binding / future versioned lock data |
| Character / World / Product Lock | Protected reusable identity/consistency at a defined scope | Asset + binding + version; later specialized fields, not duplicated master objects |
| Approval | Explicit creator acceptance of a particular version | `approval` plus versions; human authority, distinct from lock |
| Version | Attributed saved state; preserve history/parent for alternatives | `object_versions`; main-line now, branches later |
| Result | Actually produced visual/audio/rendered evidence, not planned directions | `results`, media; Raw/Needs Review/Approved/Rejected/Final |
| Shot Match | Reference → Plan → Result comparison and corrected direction | `shot_match_reports`; vision engine later |
| Real Production | Default Studio execution face for physical directing | UI face `real`; never a separate master |
| AI Creation | Studio face for model-specific compiled directions | UI face `ai`; generation API optional |
| Real Execution | Physical plan attached to canonical Shot | `execution_plans.execution_method = real` |
| AI Execution | Generated execution instructions attached to canonical Shot | `execution_plans.execution_method = ai` |
| Hybrid | Per-Shot SHOOT + AI strategy, potentially both execution plans | `shots.execution_method = hybrid`; no third required face |
| Production Bible | Persistent structured production knowledge for consistency | Creative documents/Assets/versions; not a giant production JSON blob |
| Style Bible | Visual-language component reusable as Asset | `asset_type = style_bible`; subset of Production Bible |
| Production Technique | Reusable production knowledge that alters directions | Discover/future typed plan associations; not decorative effects |
| Prompt | Compiled model-specific execution artifact with pinned source versions | AI execution artifact; never master creative truth |
| Media | Independent storage/file metadata and derivatives | `media_files`; Assets/References/Results attach it |
| Job | Background processing record, not creative work | `jobs`; leases/state, execution deferred |
| Export | Pinned-version deliverable; full document vs execution package | `exports`, job, generated media |
| Provenance | Origin/rights/context; origin does not grant consent/license | Reference rights classification + source/provenance |
| Observed | Claim directly supported by analyzed evidence | `claim_kind = observed` in shared contracts |
| Estimated | Inference with assumptions and uncertainty | `claim_kind = estimated` |
| Recommended | Proposed execution choice, not source fact | `claim_kind = recommended` |
| Readiness | Criteria-based production executability/completeness, not arbitrary progress | Future criteria/blockers; job progress is unrelated |

## Terminology audit decisions

- Keep relational `production_resources`; UI/domain calls this Setup. `resource_type` excludes environments.
- Keep `series_collections`; Season/Collection is optional display language, not a mandatory rename.
- Keep `asset_type = environment`; World Lock enriches the same identity. Do not create a locations table just because a source calls it a location.
- Keep `real` / `ai` / `hybrid` storage codes; faces are **Real Production** / **AI Creation**, assignments are **SHOOT** / **GENERATE** / **SHOOT + AI**.
- Keep Project distinct from Production and Job. “Clip” describes imported/generated media if needed, never canonical Shot identity.
- Rights codes `authorized_identity` and `unknown` display **User-authorized identity** and **Unknown / unconfirmed**. Generated origin is not a new ownership classification.
- Add missing `product_film` and `trailer` classifications additively; no independent schemas.
- Promote CHECK-constrained reference/provenance and user-visible workflow codes to PostgreSQL enums and generated shared constants, instead of maintaining loose parallel string unions.
- Do not introduce a generic `production_status` mixing archive, approval, readiness, execution face and job state. Those are independent typed dimensions.
