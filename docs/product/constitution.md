# TONDE Product Constitution

**Version:** 1.2.0  
**Effective date:** 2026-10-08  
**Status:** Authoritative product specification; not a claim that future features are shipped.  
**Owner:** TONDE product/engineering maintainers. Amendments require an explicit product decision, recorded rationale, migration/compatibility assessment and regression review.

> When implementation behavior, UX terminology, feature design, schema naming, AI behavior, or future requirements conflict with this constitution, the conflict must be explicitly resolved rather than silently introducing a second interpretation.

This is the permanent product authority for Prompts 3–11 and later engineering. This document and its [glossary](glossary.md), [invariant register](invariants.md), and [compliance record](compliance.md) form one constitution, not competing PRDs. SQL migrations implement persistence; generated constants implement vocabulary; neither silently redefines product meaning. Security/legal/platform obligations remain binding. Contradictions require an amendment or an implementation repair, not a convenient alternate interpretation.

## 1. Identity, category and success

**Product:** TONDE.  
**Positioning:** TONDE — Your AI Production Director.  
**Promise:** Show TONDE what you want to make. TONDE tells you exactly how to make it.  
**Question answered:** How do I actually create this?  
**Category:** AI Production Director / Production Intelligence System.

The defining interaction is **“Show me what you want to achieve,”** not “Tell me what you want to generate.” Users can arrive with an idea, description, photograph, video, social reference, advertisement, product, script, movie reference, visual style, previous production, filmed/generated result, voice, character, environment, or recurring-series concept. TONDE converts intent into executable production direction. Execution can use cameras/people, AI tools or both. TONDE is the intelligence/directing layer above those tools.

Users experience **one coherent Director**, coordinating director, DP, producer, story/script advisor, performance director, production designer, sound director, editor, color/visual-language advisor, AI generation specialist, continuity supervisor and production-assistant responsibilities. These are specialized responsibilities, not necessarily visible personalities or disconnected bots.

The ultimate success criterion is **“Can the creator actually produce the intended work using this output?”** Optimize executability, continuity, feasibility, clarity, quality, consistency, adaptation to resources and efficient iteration. Text quantity and arbitrary vanity scores are not success.

## 2. Product loops and workflows

**Core loop:** UNDERSTAND → DIRECT → EXECUTE → CHECK → FIX.

**Full lifecycle:** Idea/Reference → Understand → Intelligent Brief → Production Plan → Story/Script → Scenes → Shots → Real/AI/Hybrid Execution → Create → Result → Shot Match → Fix → Approve → Final.

**Shot Match production loop:** REFERENCE → DIRECT → CREATE → UPLOAD RESULT → CHECK → FIX → APPROVE. Understand why the reference works; direct an original plan; create a physical/generated shot; upload execution evidence; compare against intent/plan; explain differences; propose corrected instructions; create another version; explicitly approve. Preserve iteration history. Prompt 9 implements the full loop; Prompt 2 establishes its meaning.

### Direct a Reference

Accept authorized uploads, written descriptions, movie references, pasted/social URLs and cloud imports. Social sources may include TikTok, YouTube, Instagram, Facebook, X and Vimeo. API-permitted metadata retrieval and available-media analysis are distinct. An upload is not proof of ownership; a URL is not proof of access. A Reference may be saved while incomplete, but it must have an identity and creator purpose before TONDE may use it to shape a Production. Capture reliable source metadata automatically; ask only for missing high-impact context. Keep Reference Truth (what the source is, and the provenance/status of that claim) separate from Creator Intent (why it was supplied and what to learn). A URL alone is metadata-only, never proof that audiovisual content was analyzed. “Best” always means best for this creator’s stated objective. Extract the principle, not the scene: references inform original production reasoning, not scene cloning.

Canonical use flow: PASTE / UPLOAD / IMPORT → IDENTIFY REFERENCE → UNDERSTAND WHY → ANALYZE AVAILABLE EVIDENCE → FIND WHAT MATTERS → RANK FOR THE CREATOR’S OBJECTIVE → ADAPT → CREATE ORIGINAL PRODUCTION → STORY → SCENES → SHOTS → REAL / AI / HYBRID. Local adaptation uses creator-supplied location, people, Production Kit, constraints, audience, format and execution mode; do not localize by stereotype.

Video understanding eventually covers concept/hook, story/scenes/shots, composition, angles/position, estimated lens/look, camera/subject movement, lighting, blocking/performance, environment, wardrobe/props, transitions/edit pacing, sound/music/SFX/voiceover, titles/CTA and color. The purpose is production reasoning, not a generic description.

Images are first-class. Analyze visible subject, pose/expression, wardrobe/hair, environment, composition/position, perspective/estimated focal-length look, depth of field, lighting direction/quality, reflections/materials, color/texture/aspect ratio. Provide physical photography direction or AI instructions for an original composition. High fidelity is an aim, not a mathematical reconstruction guarantee.

**Replace Subject** uses a target composition and authorized character/person/product reference, preserves requested production characteristics, and adapts the subject without promising exact identity replication or bypassing consent rules.

### Create from Scratch

No source media is required. A 45-second crime trailer, 30-minute original science-fiction film or 15-second coffee commercial all resolve to the same production model. Film/director/movement/cultural references inform broad genre, visual language, lighting, sound, pacing and storytelling techniques for **original work**; copying protected scripts/scenes shot-for-shot is not the product workflow.

## 3. Users and production classifications

Filmmakers, content creators, commercial creators, photographers, AI creators and hybrid creators use the same product. Cover narrative/long films, documentaries/interviews/trailers/episodes; TikToks/Shorts/Reels/YouTube/educational series; advertisements/product films/UGC/branded campaigns; portrait/product/fashion/food/architecture/automotive/editorial photography; AI advertisements/films/images/music videos; and practical actors/products with generated worlds/inserts/effects. Do not fork architectures by audience.

Canonical classifications are Social Video, Commercial, Advertisement, Product Film, YouTube, Interview, Documentary, Music Video, Short Film, Long-Form Film, Trailer, Photography, Portrait, Product Photography, Fashion, Food, Automotive, Architecture, Campaign, Thumbnail, Poster, Series, Recurring Content and Custom. Stable storage codes and display labels live in generated product vocabulary.

Type influences relevant intake, story/dialogue expectations, shot/runtime logic, assets, formats, AI behavior and execution recommendations. It does not create separate production tables/Studios. Custom classifications remain possible. `series` as a Production classification does not replace the relational Series/Episode grouping.

## 4. One Master Production; separate execution truth

There is exactly one conceptual creative source: **MASTER PRODUCTION**. It owns concept, brief, target runtime, story/script/dialogue, characters/environments/wardrobe/props/products, scene/shot order, action/emotional progression, goals, continuity and visual style.

Project is an organizational container. Production is the thing directed. “Master Production” is a role/name for the canonical Production, not another table or a clone.

| Shared creative state | Real Execution | AI Execution |
|---|---|---|
| Marcus confronts Maya in the apartment; dialogue/action/runtime | Camera/lens/OTS height, blocking, practical lighting, performer direction | Character/World Locks, model target, generated camera/performance instruction |
| Shared story, scene/shot UUIDs, continuity, approval/history | Physical lens/focal length/exposure starting ranges/crew | Model-specific prompt/settings, start/end frame artifacts |

A lens change does not rewrite story; a model change does not rewrite dialogue. Shared dialogue changes may invalidate both plans/artifacts. Execution plans attach to the **same Shot**. Hybrid is per-Shot strategy, not a third master or a third mandatory tab. `real` = SHOOT, `ai` = GENERATE, `hybrid` = SHOOT + AI; Real and AI plan records may both exist for a hybrid shot.

**Real Production is the default Studio face.** Normal opening selects Real before AI Creation. A later deliberate context-based exception requires explicit product reasoning and tests; Prompt 2 introduces none. Faces are views of shared creative truth, not persisted execution assignment.

### Real Production direction

Answer “How do actual people execute this?” Direct cast/talent/host/interview subject/extras; expression, gaze, emotion/intensity, body language, reactions, pauses, movement/dialogue delivery; starting/ending positions, prop interactions, eyelines and relationships; camera body/lens/framing/angle/height/distance/tilt/motion/support/stabilization/focus; suggested frame rate/shutter/aperture/ISO/white balance; fixtures/position/direction/softness/modifiers/intensity relationships/practicals/ambient strategy; microphone/placement/dialogue/room tone/ambience/Foley/SFX/music timing; crew/preparation/shoot order/equipment/alternatives.

Technical settings are context-based starting recommendations, **not physically guaranteed exposure measurements**. Do not imply unseen light levels, exact camera distance or hidden camera settings are known. Prompt 6 builds the complete Director.

### AI Creation direction

Answer “How do I generate this consistently?” Compile model-specific instructions from characters/worlds/wardrobe/props/products/style/camera/motion/performance/dialogue/audio and previous/required end state. Veo, Sora, Kling, Runway and future models are possible targets, not required integrations or promised capabilities. Do not reduce this face to one giant manual prompt field.

V1 core can deliver copyable instructions without generation-provider APIs. Direct generation later is convenience, not identity. TONDE need not generate video to be useful.

### Hybrid planning

Future Convert to AI / Convert to Real Shoot translates execution requirements while retaining creative identity. Consider equipment, crew, budget/time, access, safety, feasibility/quality, product accuracy/continuity, AI identity consistency, practical-effect complexity, cost and generation suitability. Prompt 7 builds this strategy; do not fake conversion in the current shell.

## 5. Hierarchy, timing, story and Series

- Simple production: Production → Scene → Shot.
- Long-form: Production → optional Act → optional Sequence → Scene → Shot.
- Photograph: Production → one or more Shot concepts; no artificial narrative scene required.
- Creator/recurring Series: Series → Episode/Day → Production → Scene → Shot.
- Narrative Series: Series → optional Season/Collection → Episode/Production → optional Act/Sequence → Scene → Shot.

Season is optional. Episode is the association of a recurring unit with the **same canonical Production**, not an alternate Studio. Counts are derived. Never prescribe always three acts/eight sequences/24 scenes/180 shots. Hierarchical lazy queries and future zoom levels must handle hundreds of shots without a flat expanded-card graph.

UUIDs are identity; scene/shot numbers and gap ordering are display positions. Reordering must preserve relationships/history. All critical durations/positions use exact integer milliseconds; reject negative/unsafe values and overflow. Planned/required parent runtime and calculated child runtime remain distinct. Exact checks account for dialogue/audio overlap rules rather than inventing floating-point totals.

Story can progress Idea → Premise → Story → Structure → Beats → Acts/Sequences → Scenes → Script → Dialogue; irrelevant levels are optional. A product photograph is not forced into screenplay structure.

Dialogue is first-class: character lines/conversations, voiceover, narration, pauses, interruptions, reactions, silence, delivery/emotion/subtext/timing. It consumes runtime and affects performance, shot planning, editing and generation. Line UUIDs and document/scene/shot associations remain structured; timing is not inferred by parsing arbitrary paragraphs.

Series supports daily finance videos, weekly shows, TikToks, drama and ongoing YouTube. **Generate Ahead** may use Tomorrow, Next 7/14/30, Entire Series or Custom horizons. Planning depth can differ: 365 ideas, 30 stories, 14 scripts, seven complete productions, today's approved episode. Do not eagerly generate every detail of every episode.

## 6. Intelligent Brief, creator control and feasible production

Before a giant plan, identify missing decisions that materially affect production. Ask only relevant questions: drama dialogue/characters/tone/ending/relationships; commercial product/audience/platform/CTA/method; series cadence/host/runtime/recurring structure/horizon. No universal giant form. Prompt 4 builds this reasoning.

Canonical collaboration choices: **Guide Me Step-by-Step**, **Build It, Stop at Major Decisions**, **Build Complete First Draft**. These control when TONDE asks/proposes/applies routine work; they never transfer final human approval or change ownership/model.

Persistent constraints may include budget, deadline, crew, shooting time, platform/runtime/aspect ratio, location/equipment limitations and accessibility. Reality Check compares requirements with the Production Kit and other available resources, distinguishing owned, available, missing, substituted, simplified, optional rental/purchase, AI replacement, Hybrid alternative and unrealistic constraint. Feasibility recommendations expose assumptions and remain recommendations, not observed facts. TONDE adapts execution to what the creator actually has; expensive gear is never a prerequisite for creativity. Preserve the creative goal and offer the strongest feasible camera, framing, movement, exposure starting point, light, blocking, sound, shoot order and practical substitutions. Offer Original/Cheaper/Solo/Practical/AI/Hybrid alternatives when useful—not only the expensive interpretation.

The Director may disagree with evidence: dialogue cannot fit the scene; unsafe equipment movement; generated product accuracy risks; conflicting wardrobe. Challenge is useful diagnosis, not blind agreement or performative argument.

## 7. Studio and semantic timeline

Studio is where **the creator and TONDE argue, revise, generate alternatives, move production elements, lock decisions and approve work until a complete production line exists**. It is not a dashboard, generic form, static-card collection or traditional NLE.

Combine manipulable workspace/timeline interaction, generate/variation/remix iteration and one persistent Director. Manipulate story/script/dialogue/scenes/shots/characters/environments/products/wardrobe/props, techniques/prompts/camera/performance/audio/edit/continuity/decisions. Prompt 5 builds depth without replacing the domain boundaries.

Production becomes a **semantic production timeline**, not fundamentally footage tracks. Levels can be Production/Act/Sequence/Scene/Shot/Audio. Moving a Scene changes narrative order; shortening a Shot changes action/performance/dialogue fit/edit/prompt; splitting creates meaningful production units. Do not silently treat semantic manipulation as a UI rectangle operation.

Future iteration actions include Generate Another, More Like This, Create Alternatives, Extend, Shorten, Replace, Remix, Continue From Here, Ask TONDE, Lock and Approve. Prefer alternatives/branches and previews over destroying accepted work.

Every Director mutation has explicit scope: production, act, sequence, scene, shot/range, character/environment, script/audio/edit. Ask when consequential scope is ambiguous; never guess broad propagation.

## 8. Reusable state, locks and compiled artifacts

Canonical information lives once and is referenced. Do not paste Marcus's identity into every shot, duplicate camera inventory into each production, or maintain independent world text in each prompt. Assets/Setup/domain state are canonical; generated historical artifacts may snapshot dependencies for reproducibility.

**Character Lock:** editable production definition from front/three-quarter/side/full-body/expression/wardrobe references; one image is enough to start, not proof of full identity or consent. Applicable shots inherit it.

**World Lock:** environment layout, walls/windows/furniture/objects, palette/light/atmosphere/geography. **Wardrobe/Props/Vehicles:** state changes, ownership/holding, condition and location. **Product Lock:** shape/proportions/material/color/branding/logo/packaging/label/surface details. **Style Bible:** aspect ratio, visual language/contrast/grain/color/lighting/lens/composition/motion/edit rhythm/typography/production design.

Scope inheritance: Production → Act/Sequence → Scene → Shot. A more specific binding inherits, supplements, overrides or excludes broader context explicitly; do not silently duplicate canonical assets. The current persistence codes are `inherit`, `override`, `exclude`; multiple role bindings can supplement. A World is the consistency definition of an Environment, not a new location silo.

AI prompt assembly: Master Style + Character Locks + Environment Lock + Wardrobe + Product/Prop Locks + Scene Context + Previous Shot State + Current Shot Direction + Model Requirements → Final Model-Specific Prompt.

Compiled artifacts record production/object/lock/style versions and model target. Current state and historical execution snapshots are different. A final prompt is an execution artifact, never sole creative truth. First/last-frame references and required start/end/next-shot state support intentional transitions in Prompt 7.

Production Bible is persistent structured production knowledge; Style Bible is its visual-language component, not a synonym for all creative records.

## 9. Audio, performance, editing and techniques

**Every timed audiovisual Production has an Audio Plan.** Audio planning is conditional: still photography, text-only writing and intentionally non-audiovisual work do not get artificial runtime or audio rows. If an audiovisual Production is intentionally silent, silence is its explicit Audio Plan decision. Music and sound are planned with story, Scenes, Shots, performance and execution—not bolted on after visuals.

The Production-level Audio Plan expresses overall intent, dialogue, music, sound design, ambience, recording, silence, recurring motifs, continuity and delivery considerations as relevant. Scene-level **Music Direction** and **Sound Direction** are independent, first-class directions; Shot execution adds only the capture, dialogue dependency, sound event, music relationship and continuity detail needed there. This is production direction, not a DAW session model.

Music Direction states whether music is used and why, cue start/end/duration against exact Production timing when useful, narrative/emotional purpose, rhythmic quality, instrumentation and dynamics where meaningful, diegetic status, interactions with dialogue/action, recurring motifs, and intentional rises/drops/stops/stings/silence. A creator-supplied/bound master song is distinct from recommended/original music. For a Music Video, the supplied song is the master timing source where appropriate: map its accessible intro/verse/chorus/bridge/drop/outro, beats, energy changes and authorized lyrics/performance moments to the existing Story/Scenes/Shots; do not replace it just because TONDE can recommend music. Do not claim instrumentation without accessible evidence.

Sound Direction covers room tone, ambience/environment, Foley, impacts, crowds, weather, vehicles, transitions, practical sounds, recording/microphone needs, voice treatment and intentional silence. Real Production directs what to capture with actual Production Kit resources and honest alternatives. AI Creation consumes audio direction only where the selected workspace-declared model capability supports it; unknown capability remains unknown. Hybrid keeps real dialogue, generated visuals/ambience, location sound and supplied music on the same Production/Scene/Shot. Documentary audio remains reality-preserving: do not invent dialogue or captured sound; plan interviews, room tone, ambience, archival use, creator-chosen voiceover, music and silence without claiming unobserved facts.

Audio rights/provenance are separate from creative direction. A supplied song does not imply permission. Where modeled, distinguish creator-supplied, licensed, original, generated, external Reference and unknown; the later rights system remains authoritative.

Voice direction/analysis can describe apparent pitch/range, cadence/tempo/energy, pauses/rhythm/accent/emotion/delivery. It is not reconstruction of an unseen voice prompt. **Voice cloning is a separate consent-controlled provider capability.** Never silently retain analysis uploads as cloning assets.

Performance includes expression/body/gaze/emotional progression/intensity/timing/pauses/reactions/physical action/delivery/relationship dynamics and translates into both execution forms.

TONDE directs editing without becoming Premiere/DaVinci: shot order/cut timing, J/L/match cuts, transitions/speed/B-roll/dialogue/music/SFX/color/titles/captions/graphics/CTA/delivery. Tailor direction to operational software in the Production Kit.

**Production Techniques** (e.g. Dolly Zoom, Product Orbit, Handheld Tension, Silhouette Reveal, Overhead Food Shot, Motion Match, Whip Transition, Match Cut) alter instructions: camera/lens/blocking/movement/light/prompt/transition/edit. They are not decorative effects or marketplace stock. Discover exposes reusable production knowledge later.

## 10. Application responsibility matrix

| Area | Own responsibility | Must not become |
|---|---|---|
| HOME | Start something + understand attention; one Director input (Describe/Upload/Paste URL/Import/Record → DIRECT THIS) and one Your Work action queue | Duplicated Quick Start/Continue/Needs Attention/Recent systems |
| STUDIO | Create, debate, revise, direct, maintain consistency, lock, approve | Dashboard, generic chat wrapper or NLE |
| PROJECTS | Find/manage productions: search/filter/locate/open/rename/duplicate/archive/delete/manage | Another Studio or “Project Intelligence” silo |
| DISCOVER | Production knowledge, techniques, references/examples/templates/movie references/saved inspiration/collections; DIRECT THIS / USE THIS TECHNIQUE / SAVE REFERENCE | Mere image gallery, stock marketplace |
| ASSETS | Reusable Characters/Talent, Voices, Products, Environments/Worlds, Wardrobe, Props, Vehicles, Style Bibles, Brand Assets—things that exist inside the Production or creative world | Equipment inventory or filenames mistaken for identities |
| SETUP | Production Kit: everything the creator can create with: cameras/phones/webcams, lenses/optics/adapters/filters, lighting/modifiers/stands, audio gear, stabilization/movement, drones/specialty capture, monitoring/rigging/power/storage/accessories, operational editing/photo/audio software, provider-neutral configured AI tool/model capabilities and reusable Kits | Characters, talent identities, voices, Products appearing in the Production, environments/locations, wardrobe, props, vehicles, Style/Brand Assets, or account configuration |
| SETTINGS | Account, appearance, notifications, connections, storage/data, privacy/security/consent, billing, help | AI-tool/editing-software inventory or production resources |

Screens are views over domain state, not independent data stores. A Camera belongs to the Production Kit; Character belongs to an Asset/production binding; Apartment is a production Environment or reusable Environment Asset; theme belongs to Settings; a prompt belongs to execution; filmed shot media belongs to a Result; movie material is a Reference. Locations are production context or Environments, never generic inventory. Internal `production_resources` / `equipment_kits` and the legacy `/setup` URL may remain compatibility names; creators see Production Kit. Saving an analyzed Apartment to Assets makes a reusable identity; production-specific context need not automatically become an Asset.

Settings/account controls may link to Supabase authentication, deletion, sessions, privacy, consent, retention, invoices/usage/subscription. Their scope is normal account/application management—not client invoicing. Profile-menu shortcuts are views of that account state; Settings remains first-class navigation.

## 11. Continuity, impact, approval and history

Continuity tracks position/screen direction/eyelines, wardrobe/props/vehicles/injuries, weather/time/environment/light, story/dialogue knowledge, camera geography and start/end states. It influences creation, not only an end report.

Impact predicts downstream changes (e.g. Marcus injured in Scene 4 affects later wardrobe/performance/blocking/dialogue/prompts/references). Consequential propagation offers UPDATE ALL / REVIEW CHANGES / CHANGE ONLY THIS. Prompt 9 implements it; stable objects/dependency edges must make it possible.

**Approval:** Draft → Needs Review → Approved → Changed After Approval. Approval is explicit human acceptance of a specific version. Successful generation is never approval. No AI/system/service-role write may manufacture approved work or Final results. Authenticated creator-authorized edits can approve; software cannot prove an HTTP request originated from a human gesture, so future UI/service action contracts must preserve that intent.

**Lock:** protects a decision against incidental edits. It is independent of approval; explicit authorized unlocking is separate from changing content. AI proposals do not overwrite protected work.

**Versions/branches:** preserve accepted endings/scripts/versions, support alternatives/comparison/restore/merge later; attribute revisions to user/TONDE/system with time/source action/parent versions. Approved-work changes preserve history and trigger changed-after-approval. Consequential AI changes follow PROPOSE → PREVIEW IMPACT → APPLY. Routine application depends on collaboration mode but never auto-approves.

## 12. Results, Shot Match, exports, readiness and memory

Result = what was actually filmed/generated/photographed/rendered, not a duplicate plan. State: Raw, Needs Review, Approved, Rejected, Final. Link execution evidence to production/scene/shot and media. Results can represent video/image/audio/rendered sequences.

Shot Match compares Reference → Plan → Result: framing/position/height/composition/light/background/wardrobe/identity/product/movement/timing/continuity. FIX THIS SHOT proposes physical reshoot/camera/performance/light corrections or AI prompt/reference/settings/lock corrections. It preserves evidence and prior plans. Do not claim vision checks before they run.

Two distinct export actions: **DOWNLOAD FULL DOCUMENT** (human-readable PDF/DOCX) and **EXPORT PRODUCTION PACKAGE** (separate execution files/assets, e.g. ZIP). A full document can include overview/brief/story/synopsis, characters/relationships/environments/style, script/dialogue, scene/shot breakdown, AI prompts/camera/equipment/audio/edit/continuity/timeline/post/deliverables/Director notes. Both export a pinned production version; document and package are not interchangeable. Prompt 10 implements exporters (pinned version, manifest, authorized expiring access, truthful failure) and, separately, publication to an external destination under the creator's own recorded authorization (Amendment D); no fake downloads and no silent publishing.

Readiness derives from real criteria: missing approvals/references/resources, continuity problems, overlong dialogue, unresolved shots/inaccessible sources/incomplete deliverables. Any percentage must expose its denominator/blockers/unknowns; no arbitrary confidence/vanity completion metric. Accessibility deliverables—captions/subtitles/transcripts/readable text/audio-description planning—become readiness criteria when requested.

Production Memory is structured, inspectable data about Setup, reusable assets, patterns/preferences and successful production approaches, not unrestricted hidden conversational memory. Search eventually locates every Marcus shot, 50mm plan, Veo assignment, unresolved continuity issue, apartment scene or unapproved shot using structured relationships/queryable fields.

## 13. Media truthfulness, uncertainty and failure

Every operation records accessible modalities: Metadata, Thumbnail, Image, Video Frames, Audio, Text, with evidence and analyzed/available/inaccessible/not-requested state. Availability is not proof of analysis. Metadata/thumbnail-only access cannot support claims about unseen shot motion, audio, exact timing or lighting. A pasted URL does not grant arbitrary retrieval, bypass access controls or justify claiming frames were seen.

Claims distinguish:

- **Observed:** directly supported by identified evidence (e.g. subject is frame-left).
- **Estimated:** inference with uncertainty/assumptions (e.g. moderate telephoto look).
- **Recommended:** proposed choice (e.g. start with your 50mm at about 2.5 m), not a fact about the source.

Observations reference actually analyzed evidence. Estimates disclose basis and uncertainty; recommendations disclose relevant assumptions. Specificity is useful, false precision is not. “Start at ISO 800 and adjust after exposure check” is appropriate; “correct ISO is exactly 812” is not. “Telephoto-looking framing; try 50mm” is appropriate; “definitely 52.7mm” without source measurement is not. Generation behavior is also uncertain, not guaranteed.

Partial success is valuable: metadata/thumbnail available, frames/audio inaccessible → explain what is known and request authorized media for deeper analysis. Never fabricate complete analysis or silently return unrelated fallback content. Failures expose understandable cause: inaccessible reference, unsupported file, processing/provider failure, insufficient quality, missing decision, continuity conflict, permission denial or storage limit. Incomplete output stays incomplete; technical logs retain correlation without revealing secrets/private prompts/media.

## 14. Rights, people, voice and privacy

Record provenance as product data: user-owned, licensed, brand-owned, authorized identity, public reference, third-party inspiration or unknown. Source types (upload/URL/social/cloud/recording/asset/movie/description/generated result/previous production) are separate from legal rights. Generated asset is origin, not automatic ownership clearance. Public availability is not a license; upload alone is not consent.

Analyze copyrighted production techniques to create original works, not automatic scene/script reproduction. Legitimate user-owned footage/photos/scripts, licensed assets, brand imagery/ads and authorized talent remain supported; do not impose unnecessary restrictions on rights-cleared work. Ask for clarification when rights/use materially matter; classify unknown honestly.

Real-person references require appropriate authorization/privacy/consent and attention to misleading impersonation. An image cannot promise exact identity replication. Analysis of visible production-relevant characteristics is distinct from identity-sensitive generation.

Voice direction is not cloning. Actual cloning requires explicit appropriate authorization, consent/provenance and a supported secure provider workflow. Do not repurpose uploads or persist cloning identities implicitly. Consent is scoped/revocable; later services must verify current permission and protect provider secrets. A rights-classification string alone is not sufficient proof of valid cloning consent.

Workspace isolation, private media, signed access and server-only secrets remain mandatory. Future integrations must respect source access/API permissions and environment-specific auth callbacks. Never weaken RLS/auth to make creative functionality appear complete.

## 15. Deterministic application versus AI reasoning

Deterministic software owns identity/authorization/permissions, exact duration arithmetic/order/status transitions, file limits, known equipment compatibility, billing/database relationships and job state. Do not ask a model to decide facts the application knows exactly.

AI owns creative interpretation, reference/story/performance/visual reasoning, alternatives, prompt composition and production diagnosis. Do not hardcode genuine creative reasoning.

Specialized operations share structured production state: intake understanding, reference analysis, story/script reasoning, planning, Real direction, AI compilation/model routing, continuity, impact, Shot Match and export compilation. Never collapse into one giant user prompt → model request → response. Human-readable explanation accompanies validated structured results; never parse prose to invent UUIDs/order/duration/relationships/assignments/status.

Every software-consumed AI result is scoped, grounded, attributable, versionable/editable/reviewable/reversible and explicit about uncertainty. Validate output schemas and source version IDs before proposals/applications. Compiled artifacts pin source versions/model. Provider failures do not become fake completed output.

## 16. Non-goals, V1 scope and admission

TONDE is not a complete generation engine, Premiere/CapCut/NLE replacement, CRM, invoicing/client billing/client manager, broad team/task/project management, social scheduler, unrelated business analytics, cloud-drive replacement, generic AI chat wrapper, prompt marketplace or stock-media marketplace. Delivering one authorized version of one Production to one destination (Amendment D) is production delivery, not a social scheduler, content calendar, engagement/analytics tool or campaign manager.

A feature must materially help understand, plan, execute, maintain consistency, evaluate, revise or deliver a creative production. Camera inventory and recurring production calendars pass; customer invoices and employee PTO do not. Reject/challenge unrelated requests unless the constitution is intentionally amended.

**Core V1 identity (build sequence target, not currently shipped):** reference understanding/planning, Real direction, AI prompts/Hybrid strategy, Studio iteration, assets/locks, long-form/series, continuity, result review/Shot Match and exports.

**Optional/later convenience:** direct generation APIs, every social provider, advanced collaboration, broad provider marketplaces and sophisticated automated post-production execution. Core production value must not depend on these. Availability must be described honestly; contracts/schema do not mean capability completion.

## 17. Decision and amendment framework

For every ambiguous feature:

1. Does it directly contribute to production? If no, challenge/reject.
2. Does canonical data already exist? Reference it, do not duplicate.
3. Is it Master Production or execution-specific truth? Place it explicitly.
4. Is it reusable beyond this production? Consider Asset or Production Kit, not a new screen silo.
5. Is it deterministic logic or genuine AI reasoning? Choose accordingly.
6. What if AI is uncertain? Represent evidence, estimates, assumptions and partial success.
7. What approved/locked work is affected? Preserve versions and scoped impact/consent.
8. Can core value work without a third-party generation API? Generally yes.

An amendment must record version/date, owner decision/rationale, affected invariants/terms, schema/API/UX changes, migrations/backfill/compatibility, safety/rights effects and new regression evidence. No prompt silently edits protected rules. Use the [invariant register](invariants.md) in every subsequent prompt review. Automated compliance covers only enforceable present behavior; future policy checks require human/AI-output review and must not be reported as implemented engines.

## 18. Amendment A — Setup becomes Production Kit

**Decision:** “Production Kit” is the canonical creator-facing name and means everything the creator can create with. Assets remain the reusable things that exist inside the Production or creative world; Settings remain account/application configuration. Maintain one resource inventory and the existing equipment-kit relationships—no duplicate inventory. Adapt direction to actual owned/available resources rather than making expensive gear a prerequisite. Reality Check distinguishes facts, substitutions and optional choices and exposes recommendation assumptions. Resource categories exclude Characters, voices, Products in the Production, Environments/locations, Wardrobe, Props, Vehicles, Style Bibles and Brand Assets.

## 19. Amendment B — Reference Identity and Creator Purpose

**Decision:** Every Reference requires source identity and creator purpose before it may influence Production shaping. Reference Truth (source title/name, URL, provider/platform, source type, accessible/imported media identity, reliable metadata and per-value provenance/status) remains separate from Creator Intent (why supplied, what the creator is making, what to learn, and structured learning targets). Unknown, inferred, creator-supplied and source-metadata values are not interchangeable. Adaptive intake asks only for missing high-impact context; incomplete References may be saved but are not shaping evidence. Metadata access is not media analysis. “Best” means best for the creator’s objective. **Extract the principle, not the scene.** Localize using creator-supplied context and produce original work.

## 20. Amendment C — First-Class Audio Plan

**Decision:** Every timed audiovisual Production has Audio Plan semantics; non-audiovisual photography/text is not forced to have audio. Silence can be an intentional plan. Production-level Audio Plan, Scene-level Music Direction and Sound Direction, and relevant Shot execution requirements share the canonical production hierarchy, version/dependency/approval/lock/history semantics. A supplied master song is distinct from recommended music and, for music videos where appropriate, is the timing source. Audio rights/provenance remain distinct. Real, AI and Hybrid consume the same direction subject to actual resources and declared model capabilities. Studio remains a contextual production workspace, not a DAW.

## 21. Amendment D — External publication, export and commercial integrity

**Decision (2026-10-08, Prompt 10):** publication to an external destination, export delivery and commercial state become first-class TONDE capabilities under ten non-negotiable laws. Deterministic software owns all of them; a model may prepare work but never performs a consequential external act.

1. **A publication pins exact truth.** A publication names the exact Production revision, Result revision, media checksum and destination it would send. Content that moved after the authorization cannot travel under it: the authorization goes stale and a creator must authorize the new version explicitly.
2. **Publication is a creator act.** Publishing requires an explicit recorded creator authorization naming that exact version and destination. A creative approval of the Result is a different decision and is never publishing authority; no service, scheduler, retry or AI may record one, and no generation completion may publish anything.
3. **External systems are evidence, not truth.** A destination's answer describes the destination. It never rewrites, approves, locks or version-bumps canonical creative work, and a remote resource is never Master Production truth.
4. **Unknown stays unknown.** An ambiguous destination answer is **destination state unknown** — never “published” and never “failed” — until a recorded reconciliation states what the destination actually shows. TONDE never upgrades an uncertainty into success.
5. **Retries must not duplicate real-world actions.** A submission is idempotent per pinned version and destination: a retry reuses the identity of the operation it repeats, and retry safety is a classified property of the action rather than a guess.
6. **No credential lives in TONDE.** A connection records the provider account, the granted scopes and the vault reference that holds the credential; a literal secret is refused. The deployment vault owns token refresh, and a credential the provider stops accepting moves the connection to **reauth_required** — the word “connected” is used only after the provider itself confirmed the account.
7. **Billing is server-authoritative.** A subscription state moves only because a verified provider event says so. A browser can open a checkout intent and read status; it cannot subscribe a workspace, grant an entitlement or record usage, and an unverified payload is never commercial evidence.
8. **Money keeps its meanings apart.** Actual provider cost, estimated provider cost, the charge recorded for the creator and entitlement credits consumed are four separate facts with four separate meanings — never summed into one figure and never presented as revenue or an invoice.
9. **Exports pin their version.** Both export products are built from the Production version the export pins; if that version cannot be reconstructed the export fails truthfully instead of exporting current state, and artifact access is authorized per request and expires.
10. **External actions keep provenance and stay auditable.** Every authorization, attempt, webhook receipt and reconciliation records who or what acted, when, with which provider identity and what was observed, so a real-world action can be reconstructed after the fact.

**Boundary resolved:** publication delivers one authorized version of one Production to one destination. It is not a social-media scheduler, content calendar, engagement/analytics tool or marketing campaign manager; those remain outside the product (see §16). This amendment changes no V1 execution-face, approval, lock or versioning rule.

## 22. Amendment E — TONDE is the Director, not the media generator

**Decision (2026-10-09, owner product-direction correction during Prompt 11):** TONDE is the production Director, not the final media-generation engine. Its product role is the **production Director**. It analyses, plans, recommends, compiles the playbook and the production-ready prompt for the tool the creator owns, and evaluates the Result the creator uploads. It does not host final image or video generation, and the core product must not require a media-generation credential.

1. **The product loop ends in a check, not a render.** IDEA / REFERENCE → TONDE DIRECTOR → PRODUCTION PLAN → SHOT/SCENE PLAYBOOK → EXECUTION (REAL, EXTERNAL AI TOOL, or HYBRID) → THE CREATOR EXECUTES → RESULT UPLOADED TO TONDE → TONDE CHECKS THE RESULT → FIX, ACCEPT or CONTINUE. Media is produced on the creator's camera or in the creator's external tool.
2. **AI Creation is an execution strategy TONDE directs**, not media TONDE generates: TONDE produces the playbook, names a recommended tool class and, where the creator has tools, the tool, explains why, and compiles the production-ready prompt the creator runs externally. Direct image/video generation is **not required** for core value.
3. **Documented knowledge is not a connection.** TONDE may hold AI Tool Knowledge — capability type, input types, reference support, documented limits, prompt behaviour, strengths, limitations, workflow guidance, version and source — as reviewed, sourced production knowledge. Holding it never implies TONDE can run that tool, and a tool's capabilities are never fabricated.
4. **External AI tools are execution destinations, not TONDE Production truth.** Their capabilities, costs and outputs never rewrite canonical creative work, and TONDE never claims a provider execution it did not perform.
5. **Every Result returns to TONDE.** TONDE compares the uploaded Result against the playbook across the named criteria and returns ACCEPT or FIX with instructions; a FIX produces the next prompt, and the iteration records what changed between attempts.
6. **TONDE bills for the TONDE service only.** External tool usage on the creator's own account is the creator's cost with that external service; TONDE does not resell generation, and it distinguishes TONDE cost from external tool cost and an estimate from an actual rather than inventing a figure.
7. **The optional connector stays optional.** A future direct-generation connector may be added by a separate owner decision; it must remain optional and may never become a requirement of the core contract. The generalized Prompt 10 provider architecture remains intact for publishing, billing, OAuth, email and integrations.

**Boundary resolved:** this amendment does not reduce camera, lens, Scene, lighting, audio or Production Kit intelligence, and it does not remove AI used for analysis, direction, planning, prompt compilation, knowledge extraction or Result evaluation. It fixes where the media is made.

## Revision history

| Version | Date | Meaningful change |
|---|---|---|
| 1.0.0 | 2026-10-05 | Initial constitution from Master Prompt 02; locks one Production, execution semantics, area responsibilities, human authority, honest media/evidence rules and production-only admission. Adds Product Film/Trailer to classification, typed shared vocabulary and software contract/approval guards without building later engines. |
| 1.1.0 | 2026-10-07 | Creator-approved pre-Prompt 10 amendment: Amendment A makes Production Kit canonical while preserving one inventory and separating Assets/Settings; Amendment B requires separately persisted Reference identity and creator purpose before shaping, with honest provenance/access and originality; Amendment C makes Audio Plan, Scene Music Direction and Sound Direction first class for timed audiovisual work while preserving conditional photography, human approvals and shared Production/version/dependency semantics. |
| 1.3.0 | 2026-10-09 | Owner product-direction correction during Prompt 11: Amendment E makes TONDE the production Director. AI Creation becomes an execution strategy TONDE directs with a tool-specific playbook and prompt; AI Tool Knowledge is documented, sourced, reviewed knowledge rather than a connection; external tools are execution destinations and never Production truth; every Result returns to TONDE for an ACCEPT/FIX check that produces the next prompt; TONDE bills for the TONDE service only and does not resell generation; direct media generation is not required and a future connector stays optional. Adds INV-49–54. Leaves Prompt 10's generalized provider architecture and all camera/Scene/audio intelligence intact. |
| 1.2.0 | 2026-10-08 | Prompt 10 amendment D: publication pins exact revisions/checksum/destination and needs the creator's own recorded authorization; external answers are evidence, an ambiguous answer stays unknown until reconciled, and retries never duplicate a real-world action; TONDE stores no provider credential; billing is server-authoritative from verified provider events; the four money meanings stay apart; exports pin their version with expiring authorized access; every external action keeps provenance and audit. Resolves the social-scheduler boundary in §16 without changing execution/approval/lock rules. |

## Governing principle

> TONDE understands what the creator wants to achieve, converts that intent into one coherent production model, directs how to execute it with real production, AI creation or both, preserves consistency as the production evolves, and helps the creator evaluate and correct the result until it is ready.

If a system strengthens this loop it belongs; if it distracts, challenge it. Fix conflicts or explicitly amend the constitution. Do not let ambiguity accumulate.
