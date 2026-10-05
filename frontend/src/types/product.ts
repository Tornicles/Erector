// Generated from PostgreSQL migrations and product/vocabulary.json; do not hand-edit.
import type { Database } from "./database";
export const PRODUCT = {
  "constitutionVersion": "1.0.0",
  "effectiveDate": "2026-10-05",
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
    "ai": "GENERATE",
    "hybrid": "SHOOT + AI"
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
  "exportActions": {
    "full_document": "Download Full Document",
    "production_package": "Export Production Package"
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
      "title": "Setup",
      "responsibility": "Production equipment, software and AI-tool capabilities"
    },
    "settings": {
      "path": "/settings",
      "title": "Settings",
      "responsibility": "Application and account configuration"
    }
  }
} as const;
export const DATABASE_VALUES = {
  "approval": [
    "draft",
    "needs_review",
    "approved",
    "changed_after_approval"
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
  "dialogue_kind": [
    "dialogue",
    "voiceover",
    "narration",
    "pause",
    "reaction"
  ],
  "execution_method": [
    "real",
    "ai",
    "hybrid"
  ],
  "job_state": [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "retrying"
  ],
  "lifecycle": [
    "active",
    "archived",
    "deleted"
  ],
  "member_role": [
    "owner",
    "admin",
    "editor",
    "viewer"
  ],
  "message_role": [
    "user",
    "tonde",
    "system",
    "tool"
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
  ]
} as const;
export const DEFAULT_EXECUTION_FACE = PRODUCT.defaultExecutionFace;
export type ExecutionFace = keyof typeof PRODUCT.executionFaces;
export type ExecutionMethod = Database["tonde"]["Enums"]["execution_method"];
export type ProductionType = Database["tonde"]["Enums"]["production_type"];
export type ApprovalStatus = Database["tonde"]["Enums"]["approval"];
export type ResultStatus = Database["tonde"]["Enums"]["result_state"];
export type ReferenceRights = Database["tonde"]["Enums"]["reference_rights"];
export type ClaimKind = typeof PRODUCT.claimKinds[number];
