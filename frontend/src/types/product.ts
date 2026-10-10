// Generated from PostgreSQL migrations and product/vocabulary.json; do not hand-edit.
import type { Database } from "./database";
export const PRODUCT = {
  "constitutionVersion": "1.3.0",
  "effectiveDate": "2026-10-09",
  "identity": {
    "name": "TONDE",
    "positioning": "TONDE — Your AI Production Director",
    "promise": "Show TONDE what you want to make. TONDE tells you exactly how to make it."
  },
  "defaultExecutionFace": "real",
  "executionFaces": {
    "real": "Real Production",
    "ai": "AI Creation"
  },
  "executionAssignments": {
    "real": "SHOOT",
    "ai": "AI PLAYBOOK",
    "hybrid": "SHOOT + AI"
  },
  "concepts": {
    "productionKit": "Production Kit",
    "audioPlan": "Audio Plan",
    "musicDirection": "Music Direction",
    "soundDirection": "Sound Direction",
    "referenceIdentity": "Reference Identity",
    "creatorPurpose": "Creator Purpose",
    "director": "Director",
    "playbook": "AI Playbook",
    "toolKnowledge": "AI Tool Knowledge",
    "resultCheck": "Result Check",
    "externalToolCost": "External Tool Cost",
    "tondeCost": "TONDE Cost"
  },
  "seriesKinds": {
    "narrative": "Narrative Series",
    "recurring": "Creator Series"
  },
  "planningDepths": {
    "idea": "Idea",
    "outlined": "Outlined",
    "story_defined": "Story Defined",
    "scripted": "Scripted",
    "scenes_planned": "Scenes Planned",
    "shots_planned": "Shots Planned",
    "execution_planned": "Execution Planned",
    "in_progress": "Capture / Generation In Progress"
  },
  "sequenceKinds": {
    "narrative": "Narrative Movement",
    "mission": "Mission",
    "location": "Location Progression",
    "topic": "Topic Block",
    "montage": "Montage",
    "action": "Action Sequence",
    "documentary": "Documentary Section",
    "thematic": "Thematic Unit",
    "custom": "Custom"
  },
  "structureLevels": {
    "production": "Production",
    "act": "Act",
    "sequence": "Sequence",
    "scene": "Scene",
    "shot": "Shot"
  },
  "generateHorizons": {
    "tomorrow": "Tomorrow",
    "next_7": "Next 7",
    "next_14": "Next 14",
    "next_30": "Next 30",
    "entire_series": "Entire Series",
    "custom": "Custom"
  },
  "generateDepths": {
    "ideas_only": "Ideas Only",
    "briefs": "Briefs",
    "story": "Story",
    "script": "Script",
    "complete_plan": "Complete Production Plan"
  },
  "cadenceKinds": {
    "daily": "Daily",
    "weekdays": "Weekdays",
    "weekly": "Weekly",
    "selected_weekdays": "Selected Weekdays",
    "custom": "Custom Cadence",
    "none": "No Fixed Cadence"
  },
  "productionLineStates": {
    "idea": "Idea",
    "brief": "Brief",
    "story": "Story",
    "script": "Script",
    "scene_plan": "Scene Plan",
    "shot_plan": "Shot Plan",
    "ready_to_execute": "Ready to Execute",
    "in_production": "In Production",
    "review": "Review",
    "approved": "Approved",
    "complete": "Complete"
  },
  "productionTypes": {
    "social_video": "Social Video",
    "commercial": "Commercial",
    "advertisement": "Advertisement",
    "product_film": "Product Film",
    "youtube": "YouTube",
    "interview": "Interview",
    "documentary": "Documentary",
    "music_video": "Music Video",
    "short_film": "Short Film",
    "long_form_film": "Long-Form Film",
    "trailer": "Trailer",
    "photography": "Photography",
    "portrait": "Portrait",
    "product_photography": "Product Photography",
    "fashion": "Fashion",
    "food": "Food",
    "automotive": "Automotive",
    "architecture": "Architecture",
    "campaign": "Campaign",
    "thumbnail": "Thumbnail",
    "poster": "Poster",
    "series": "Series",
    "recurring_content": "Recurring Content",
    "custom": "Custom"
  },
  "approvals": {
    "draft": "Draft",
    "needs_review": "Needs Review",
    "approved": "Approved",
    "changed_after_approval": "Changed After Approval"
  },
  "resultStates": {
    "raw": "Raw",
    "needs_review": "Needs Review",
    "approved": "Approved",
    "rejected": "Rejected",
    "final": "Final"
  },
  "assetTypes": {
    "character": "Characters / Talent",
    "voice": "Voices",
    "product": "Products",
    "environment": "Environments / Worlds",
    "wardrobe": "Wardrobe",
    "prop": "Props",
    "vehicle": "Vehicles",
    "style_bible": "Style Bibles",
    "brand": "Brand Assets"
  },
  "referenceRights": {
    "user_owned": "User owned",
    "licensed": "Licensed",
    "brand_owned": "Brand owned",
    "authorized_identity": "User-authorized identity",
    "public_reference": "Public reference",
    "third_party_inspiration": "Third-party inspiration",
    "unknown": "Unknown / unconfirmed"
  },
  "claimKinds": [
    "observed",
    "estimated",
    "recommended"
  ],
  "mediaModalities": [
    "metadata",
    "thumbnail",
    "image",
    "video_frames",
    "audio",
    "text"
  ],
  "accessStates": [
    "available",
    "inaccessible",
    "not_requested"
  ],
  "collaborationModes": {
    "guide_step_by_step": "Guide Me Step-by-Step",
    "stop_at_major_decisions": "Build It, Stop at Major Decisions",
    "complete_first_draft": "Build Complete First Draft"
  },
  "operationOutcomes": [
    "complete",
    "partial"
  ],
  "mutationActions": [
    "revise",
    "reorder",
    "bind",
    "assign_execution",
    "lock",
    "unlock"
  ],
  "dependencyStrengths": {
    "hard": "Hard",
    "soft": "Soft",
    "advisory": "Advisory"
  },
  "dependencyOrigins": {
    "explicit": "Declared",
    "derived": "Derived from your Production",
    "inferred": "Inferred (proposal)"
  },
  "impactClasses": {
    "direct": "Direct",
    "downstream": "Downstream",
    "potential": "Potential",
    "unaffected": "Unaffected",
    "unknown": "Unknown"
  },
  "impactModes": {
    "preview": "Preview",
    "update_all": "UPDATE ALL",
    "review_changes": "REVIEW CHANGES",
    "change_only_this": "CHANGE ONLY THIS"
  },
  "artifactKinds": {
    "real_plan": "Real Production plan",
    "ai_plan": "AI Generation plan",
    "prompt": "Compiled prompt",
    "first_frame": "First frame",
    "last_frame": "Last frame",
    "generation_context": "Generation context",
    "result_comparison": "Result comparison",
    "derived_summary": "Derived summary",
    "continuity_state": "Continuity state",
    "continuity_analysis": "Continuity analysis",
    "deliverable": "Deliverable",
    "dependent_object": "Dependent object",
    "other": "Other"
  },
  "staleStates": {
    "current": "Current",
    "stale": "Stale",
    "conflicted": "Conflicted"
  },
  "continuityDomains": {
    "character": "Character",
    "wardrobe": "Wardrobe",
    "prop": "Prop",
    "product": "Product",
    "vehicle": "Vehicle",
    "injury": "Injury",
    "hair_makeup": "Hair and makeup",
    "weather": "Weather",
    "time_of_day": "Time of day",
    "environment": "Environment or World",
    "lighting": "Lighting",
    "story_knowledge": "Story knowledge",
    "dialogue_fact": "Dialogue fact",
    "screen_direction": "Screen direction",
    "eyeline": "Eyeline",
    "camera_geography": "Camera geography",
    "position": "Physical position",
    "product_condition": "Product condition",
    "other": "Other"
  },
  "continuityAnchors": {
    "production": "Whole Production",
    "scene_opening": "Scene opening",
    "scene_ending": "Scene ending",
    "shot": "Shot"
  },
  "continuityTransitions": {
    "baseline": "First statement",
    "continuous": "Continues unchanged",
    "changed": "Declared change"
  },
  "continuityOrigins": {
    "declared": "Declared by you",
    "derived": "Derived from your statements",
    "inferred": "Inferred (proposal)"
  },
  "continuityFindingKinds": {
    "unexplained_change": "Unexplained change",
    "boundary_break": "Break across a Scene boundary",
    "missing_reason": "Change without a reason",
    "lock_conflict": "Touches a locked trait",
    "unverified_after": "Unknown after this point"
  },
  "continuityFindingStates": {
    "open": "Open",
    "acknowledged": "Acknowledged",
    "resolved": "Resolved",
    "waived": "Waived"
  },
  "memoryScopes": {
    "production": "This Production",
    "series": "This Series",
    "workspace": "Entire workspace"
  },
  "memoryKinds": {
    "preference": "Preference",
    "decision": "Production decision",
    "pattern": "Production pattern",
    "technique": "Successful technique",
    "setup_fact": "Setup fact",
    "asset_usage": "Reusable Asset use",
    "model_outcome": "Model or provider outcome",
    "series_rule": "Series rule",
    "correction": "Your correction",
    "other": "Other"
  },
  "memorySources": {
    "creator_instruction": "Your current instruction",
    "production_decision": "Current Production decision",
    "saved_preference": "Saved preference",
    "historical_pattern": "Historical pattern",
    "inference": "Inferred by TONDE"
  },
  "memoryOrigins": {
    "declared": "You said it",
    "accepted": "You accepted a candidate",
    "inferred": "Inferred and unconfirmed"
  },
  "branchStates": {
    "open": "Open alternative",
    "merged": "Merged",
    "abandoned": "Abandoned"
  },
  "branchChangeStates": {
    "pending": "Ready to merge",
    "applied": "Merged",
    "conflicted": "Conflicted, needs your edit",
    "rejected": "Discarded"
  },
  "mergeStates": {
    "proposed": "Waiting for your decision",
    "merged": "Merged",
    "rejected": "Rejected"
  },
  "accessActions": {
    "approve": "Approved",
    "request_review": "Waiting for review",
    "reopen": "Reopened for editing",
    "lock": "Locked",
    "unlock": "Unlocked"
  },
  "readinessStates": {
    "ready": "Ready",
    "ready_with_warnings": "Ready with warnings",
    "needs_review": "Needs review",
    "blocked": "Blocked",
    "unknown": "Not enough planned state"
  },
  "readinessDimensions": {
    "decisions": "Decisions",
    "story": "Story",
    "script": "Script",
    "scene_plan": "Scene plan",
    "shots": "Shots",
    "continuity": "Continuity",
    "resources": "Resources",
    "real_execution": "Real execution",
    "ai_execution": "AI execution",
    "approvals": "Approvals",
    "dependencies": "Dependencies",
    "results": "Results",
    "delivery": "Delivery"
  },
  "matchVerdicts": {
    "matches_intent": "Matches intent",
    "acceptable_variation": "Acceptable variation",
    "needs_attention": "Needs attention",
    "mismatch": "Mismatch",
    "unknown": "Not enough evidence"
  },
  "correctionStates": {
    "proposed": "Proposed",
    "applied": "Applied",
    "rejected": "Rejected"
  },
  "correctionRecommendations": {
    "none": "No fix required",
    "pickup_required": "Pickup required",
    "regeneration_recommended": "Regeneration recommended",
    "both": "Pickup and regeneration"
  },
  "matchOrigins": {
    "deterministic": "Deterministic comparison",
    "creator": "Creator statement",
    "ai_proposal": "AI proposal"
  },
  "exportActions": {
    "full_document": "Download Full Document",
    "production_package": "Export Production Package"
  },
  "exportStates": {
    "requested": "Requested",
    "building": "Building",
    "ready": "Ready to download",
    "failed": "Failed",
    "expired": "Expired"
  },
  "publicationStates": {
    "draft": "Draft",
    "ready": "Ready to publish",
    "awaiting_authorization": "Waiting for your authorization",
    "submitting": "Submitting",
    "submitted": "Submitted",
    "processing": "Processing at the destination",
    "published": "Published",
    "failed": "Failed",
    "cancelled": "Cancelled",
    "removed": "Removed from the destination",
    "unknown_remote_state": "Destination state unknown"
  },
  "publicationFailureCategories": {
    "authentication_failed": "The destination sign-in failed",
    "insufficient_scope": "TONDE is missing a permission this destination requires",
    "rate_limited": "Rate limited by the destination",
    "invalid_media": "The destination rejected the media",
    "invalid_metadata": "The destination rejected the title or description",
    "provider_unavailable": "The destination could not be reached",
    "quota_exceeded": "The destination account is over quota",
    "remote_processing_failed": "The destination failed while processing",
    "destination_rejected": "Rejected by the destination's own rules",
    "policy_violation": "Blocked by the destination's policy",
    "unknown": "Cause not established"
  },
  "subscriptionStates": {
    "none": "No subscription",
    "trialing": "Trial",
    "active": "Active",
    "past_due": "Payment past due",
    "incomplete": "Setup incomplete",
    "cancel_at_period_end": "Cancels at period end",
    "cancelled": "Cancelled",
    "suspended": "Suspended"
  },
  "entitlementKinds": {
    "feature": "Feature access",
    "quota": "Consumable quota"
  },
  "entitlementSources": {
    "plan": "Granted by the plan",
    "grant": "Administrative grant"
  },
  "usageCostBases": {
    "actual": "Actual provider cost",
    "estimated": "Estimated provider cost",
    "unknown": "Cost not established"
  },
  "reservationStates": {
    "reserved": "Reserved",
    "committed": "Committed",
    "released": "Released"
  },
  "webhookStates": {
    "received": "Received",
    "processing": "Processing",
    "processed": "Processed",
    "failed": "Failed",
    "ignored": "Ignored"
  },
  "checkoutStates": {
    "started": "Started",
    "completed": "Completed",
    "abandoned": "Abandoned",
    "expired": "Expired"
  },
  "commercialActors": {
    "webhook": "Billing provider event",
    "server": "Trusted server operation",
    "admin": "Administrative action"
  },
  "areas": {
    "home": {
      "path": "/home",
      "title": "Home",
      "responsibility": "Start + Action Queue"
    },
    "studio": {
      "path": "/studio",
      "title": "Studio",
      "responsibility": "Create, debate, revise, direct, approve"
    },
    "projects": {
      "path": "/projects",
      "title": "Projects",
      "responsibility": "Find and manage Productions"
    },
    "discover": {
      "path": "/discover",
      "title": "Discover",
      "responsibility": "Production knowledge, techniques and references"
    },
    "assets": {
      "path": "/assets",
      "title": "Assets",
      "responsibility": "Reusable production entities"
    },
    "setup": {
      "path": "/setup",
      "title": "Production Kit",
      "responsibility": "Everything the creator can create with: equipment, operational software and configured AI capabilities"
    },
    "settings": {
      "path": "/settings",
      "title": "Settings",
      "responsibility": "Application and account configuration"
    }
  }
} as const;
export const DATABASE_VALUES = {
  "access_action": [
    "approve",
    "request_review",
    "reopen",
    "lock",
    "unlock"
  ],
  "ai_attempt_mode": [
    "live",
    "manual"
  ],
  "ai_attempt_status": [
    "planned",
    "queued",
    "submitted",
    "processing",
    "succeeded",
    "partial",
    "failed",
    "cancelled",
    "expired"
  ],
  "ai_batch_item_state": [
    "pending",
    "blocked",
    "submitted",
    "succeeded",
    "failed",
    "skipped"
  ],
  "ai_batch_scope": [
    "shot",
    "scene",
    "selection",
    "production"
  ],
  "ai_batch_state": [
    "confirmed",
    "running",
    "partial",
    "succeeded",
    "failed",
    "cancelled"
  ],
  "ai_capability_state": [
    "SUPPORTED",
    "PARTIALLY SUPPORTED",
    "UNSUPPORTED",
    "UNKNOWN",
    "REQUIRES CONNECTION"
  ],
  "ai_connection_state": [
    "not_connected",
    "connected",
    "unavailable"
  ],
  "ai_continuity_priority": [
    "MUST PRESERVE",
    "SHOULD PRESERVE",
    "FLEXIBLE"
  ],
  "ai_lock_scope": [
    "character",
    "world",
    "product",
    "style"
  ],
  "ai_operation": [
    "image",
    "video",
    "image_to_video",
    "video_to_video",
    "voice",
    "speech",
    "music",
    "sound_effect",
    "upscale",
    "background_removal",
    "image_edit",
    "frame_interpolation",
    "lipsync",
    "compositing"
  ],
  "ai_readiness": [
    "unplanned",
    "stale",
    "needs_reference",
    "needs_model",
    "needs_decision",
    "unsupported",
    "provider_not_connected",
    "cost_confirmation",
    "ready_to_generate",
    "manual_export"
  ],
  "ai_reference_role": [
    "face",
    "full_body",
    "profile",
    "wardrobe",
    "expression",
    "pose",
    "lighting_neutral",
    "environment",
    "product",
    "style",
    "first_frame",
    "last_frame",
    "storyboard",
    "plate",
    "voice"
  ],
  "alternative_kind": [
    "best_quality",
    "fastest",
    "solo",
    "lowest_equipment",
    "safest",
    "available_light",
    "substitute",
    "ai_foundation"
  ],
  "approval": [
    "draft",
    "needs_review",
    "approved",
    "changed_after_approval"
  ],
  "artifact_kind": [
    "real_plan",
    "ai_plan",
    "prompt",
    "first_frame",
    "last_frame",
    "generation_context",
    "result_comparison",
    "derived_summary",
    "continuity_state",
    "continuity_analysis",
    "deliverable",
    "dependent_object",
    "other"
  ],
  "asset_type": [
    "character",
    "voice",
    "product",
    "environment",
    "wardrobe",
    "prop",
    "vehicle",
    "style_bible",
    "brand"
  ],
  "binding_role": [
    "style",
    "character",
    "world",
    "wardrobe",
    "product",
    "prop",
    "pose",
    "voice",
    "brand",
    "vehicle"
  ],
  "branch_change_state": [
    "pending",
    "applied",
    "conflicted",
    "rejected"
  ],
  "branch_state": [
    "open",
    "merged",
    "abandoned"
  ],
  "capture_status": [
    "not_started",
    "setup",
    "shooting",
    "captured",
    "pickup_needed"
  ],
  "checkout_state": [
    "started",
    "completed",
    "abandoned",
    "expired"
  ],
  "commercial_actor": [
    "webhook",
    "server",
    "admin"
  ],
  "continuity_anchor": [
    "production",
    "scene_opening",
    "scene_ending",
    "shot"
  ],
  "continuity_domain": [
    "character",
    "wardrobe",
    "prop",
    "product",
    "vehicle",
    "injury",
    "hair_makeup",
    "weather",
    "time_of_day",
    "environment",
    "lighting",
    "story_knowledge",
    "dialogue_fact",
    "screen_direction",
    "eyeline",
    "camera_geography",
    "position",
    "product_condition",
    "other"
  ],
  "continuity_finding_kind": [
    "unexplained_change",
    "boundary_break",
    "missing_reason",
    "lock_conflict",
    "unverified_after"
  ],
  "continuity_finding_state": [
    "open",
    "acknowledged",
    "resolved",
    "waived"
  ],
  "continuity_origin": [
    "declared",
    "derived",
    "inferred"
  ],
  "continuity_transition": [
    "baseline",
    "continuous",
    "changed"
  ],
  "correction_recommendation": [
    "none",
    "pickup_required",
    "regeneration_recommended",
    "both"
  ],
  "correction_state": [
    "proposed",
    "applied",
    "rejected"
  ],
  "deletion_scope": [
    "workspace",
    "account"
  ],
  "deletion_state": [
    "scheduled",
    "frozen",
    "revoking",
    "purging",
    "verifying",
    "completed",
    "failed",
    "cancelled"
  ],
  "dependency_origin": [
    "explicit",
    "derived",
    "inferred"
  ],
  "dependency_strength": [
    "hard",
    "soft",
    "advisory"
  ],
  "dialogue_kind": [
    "dialogue",
    "voiceover",
    "narration",
    "pause",
    "reaction"
  ],
  "entitlement_kind": [
    "feature",
    "quota"
  ],
  "entitlement_source": [
    "plan",
    "grant"
  ],
  "epistemic": [
    "REQUIRED",
    "RECOMMENDED",
    "STARTING POINT",
    "OPTIONAL",
    "UNKNOWN"
  ],
  "execution_method": [
    "real",
    "ai",
    "hybrid"
  ],
  "export_kind": [
    "full_document",
    "production_package"
  ],
  "export_state": [
    "requested",
    "building",
    "ready",
    "failed",
    "expired"
  ],
  "generate_depth": [
    "ideas_only",
    "briefs",
    "story",
    "script",
    "complete_plan"
  ],
  "generate_horizon": [
    "tomorrow",
    "next_7",
    "next_14",
    "next_30",
    "entire_series",
    "custom"
  ],
  "impact_class": [
    "direct",
    "downstream",
    "potential",
    "unaffected",
    "unknown"
  ],
  "impact_mode": [
    "preview",
    "update_all",
    "review_changes",
    "change_only_this"
  ],
  "integration_adapter_state": [
    "absent",
    "implemented",
    "verified"
  ],
  "integration_auth_type": [
    "oauth",
    "api_key",
    "service_account",
    "none"
  ],
  "integration_connection_status": [
    "disconnected",
    "pending",
    "connected",
    "reauth_required",
    "expired",
    "revoked",
    "error",
    "disabled"
  ],
  "integration_provider_category": [
    "social_publishing",
    "ai_generation",
    "storage_delivery",
    "communication",
    "billing",
    "analytics_metadata"
  ],
  "job_state": [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "retrying",
    "leased",
    "waiting",
    "cancel_requested",
    "timed_out",
    "dead_letter"
  ],
  "lifecycle": [
    "active",
    "archived",
    "deleted"
  ],
  "match_origin": [
    "deterministic",
    "creator",
    "ai_proposal"
  ],
  "match_verdict": [
    "matches_intent",
    "acceptable_variation",
    "needs_attention",
    "mismatch",
    "unknown"
  ],
  "member_role": [
    "owner",
    "admin",
    "editor",
    "viewer"
  ],
  "memory_kind": [
    "preference",
    "decision",
    "pattern",
    "technique",
    "setup_fact",
    "asset_usage",
    "model_outcome",
    "series_rule",
    "correction",
    "other"
  ],
  "memory_origin": [
    "declared",
    "accepted",
    "inferred"
  ],
  "memory_scope": [
    "production",
    "series",
    "workspace"
  ],
  "memory_source": [
    "creator_instruction",
    "production_decision",
    "saved_preference",
    "historical_pattern",
    "inference"
  ],
  "merge_state": [
    "proposed",
    "merged",
    "rejected"
  ],
  "message_role": [
    "user",
    "tonde",
    "system",
    "tool"
  ],
  "planning_depth": [
    "idea",
    "outlined",
    "story_defined",
    "scripted",
    "scenes_planned",
    "shots_planned",
    "execution_planned",
    "in_progress"
  ],
  "production_type": [
    "social_video",
    "commercial",
    "advertisement",
    "youtube",
    "interview",
    "documentary",
    "music_video",
    "photography",
    "portrait",
    "product_photography",
    "fashion",
    "food",
    "automotive",
    "architecture",
    "campaign",
    "thumbnail",
    "poster",
    "short_film",
    "long_form_film",
    "series",
    "recurring_content",
    "custom",
    "product_film",
    "trailer"
  ],
  "proposal_state": [
    "proposed",
    "applied",
    "rejected"
  ],
  "publication_attempt_state": [
    "in_flight",
    "accepted",
    "processing",
    "succeeded",
    "failed",
    "unknown"
  ],
  "publication_authorization_decision": [
    "authorize",
    "withdraw"
  ],
  "publication_failure_category": [
    "authentication_failed",
    "insufficient_scope",
    "rate_limited",
    "invalid_media",
    "invalid_metadata",
    "provider_unavailable",
    "quota_exceeded",
    "remote_processing_failed",
    "destination_rejected",
    "policy_violation",
    "unknown"
  ],
  "publication_reconciliation_source": [
    "provider_api",
    "provider_webhook",
    "manual_operator"
  ],
  "publication_state": [
    "draft",
    "ready",
    "awaiting_authorization",
    "submitting",
    "submitted",
    "processing",
    "published",
    "failed",
    "cancelled",
    "removed",
    "unknown_remote_state"
  ],
  "readiness_dimension": [
    "decisions",
    "story",
    "script",
    "scene_plan",
    "shots",
    "continuity",
    "resources",
    "real_execution",
    "ai_execution",
    "approvals",
    "dependencies",
    "results",
    "delivery"
  ],
  "readiness_state": [
    "ready",
    "ready_with_warnings",
    "needs_review",
    "blocked",
    "unknown"
  ],
  "reference_rights": [
    "user_owned",
    "licensed",
    "brand_owned",
    "authorized_identity",
    "public_reference",
    "third_party_inspiration",
    "unknown"
  ],
  "reference_source": [
    "upload",
    "url",
    "social_url",
    "cloud_import",
    "recording",
    "asset",
    "movie",
    "description",
    "generated_result",
    "previous_production"
  ],
  "reference_state": [
    "received",
    "metadata_available",
    "media_available",
    "processing",
    "analyzed",
    "partially_analyzed",
    "inaccessible",
    "failed"
  ],
  "requirement_kind": [
    "camera",
    "lens",
    "stabilization",
    "light",
    "modifier",
    "stand",
    "microphone",
    "recorder",
    "wireless_audio",
    "filter",
    "monitor",
    "rigging",
    "accessory",
    "power",
    "space",
    "sound",
    "talent",
    "crew",
    "product",
    "prop",
    "wardrobe",
    "environment",
    "runtime"
  ],
  "requirement_status": [
    "owned",
    "substitute",
    "missing",
    "unverified",
    "not_required"
  ],
  "reservation_state": [
    "reserved",
    "committed",
    "released"
  ],
  "resource_type": [
    "camera",
    "phone_camera",
    "lens",
    "light",
    "modifier",
    "stand",
    "microphone",
    "recorder",
    "wireless_audio",
    "gimbal",
    "tripod",
    "monopod",
    "slider",
    "drone",
    "action_camera",
    "filter",
    "monitor",
    "rigging",
    "accessory",
    "editing_software",
    "photo_software",
    "ai_tool"
  ],
  "result_state": [
    "raw",
    "needs_review",
    "approved",
    "rejected",
    "final"
  ],
  "scope_inheritance": [
    "inherit",
    "override",
    "exclude"
  ],
  "sequence_kind": [
    "narrative",
    "mission",
    "location",
    "topic",
    "montage",
    "action",
    "documentary",
    "thematic",
    "custom"
  ],
  "series_kind": [
    "narrative",
    "recurring"
  ],
  "stale_state": [
    "current",
    "stale",
    "conflicted"
  ],
  "structure_level": [
    "production",
    "act",
    "sequence",
    "scene",
    "shot"
  ],
  "subscription_state": [
    "none",
    "trialing",
    "active",
    "past_due",
    "incomplete",
    "cancel_at_period_end",
    "cancelled",
    "suspended"
  ],
  "take_status": [
    "recorded",
    "review",
    "good",
    "preferred",
    "unusable",
    "pickup_required"
  ],
  "usage_cost_basis": [
    "actual",
    "estimated",
    "unknown"
  ],
  "webhook_state": [
    "received",
    "processing",
    "processed",
    "failed",
    "ignored"
  ]
} as const;
export const DEFAULT_EXECUTION_FACE = PRODUCT.defaultExecutionFace;
export type ExecutionFace = keyof typeof PRODUCT.executionFaces;
export type ExecutionMethod = Database["tonde"]["Enums"]["execution_method"];
export type ProductionType = Database["tonde"]["Enums"]["production_type"];
export type ApprovalStatus = Database["tonde"]["Enums"]["approval"];
export type ResultStatus = Database["tonde"]["Enums"]["result_state"];
export type ReferenceRights = Database["tonde"]["Enums"]["reference_rights"];
export type DependencyStrength = Database["tonde"]["Enums"]["dependency_strength"];
export type DependencyOrigin = Database["tonde"]["Enums"]["dependency_origin"];
export type ImpactClass = Database["tonde"]["Enums"]["impact_class"];
export type ImpactMode = Database["tonde"]["Enums"]["impact_mode"];
export type ArtifactKind = Database["tonde"]["Enums"]["artifact_kind"];
export type StaleState = Database["tonde"]["Enums"]["stale_state"];
export type ContinuityDomain = Database["tonde"]["Enums"]["continuity_domain"];
export type ContinuityAnchor = Database["tonde"]["Enums"]["continuity_anchor"];
export type ContinuityTransition = Database["tonde"]["Enums"]["continuity_transition"];
export type ContinuityOrigin = Database["tonde"]["Enums"]["continuity_origin"];
export type ContinuityFindingKind = Database["tonde"]["Enums"]["continuity_finding_kind"];
export type ContinuityFindingState = Database["tonde"]["Enums"]["continuity_finding_state"];
export type ClaimKind = typeof PRODUCT.claimKinds[number];
