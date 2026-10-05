# Generated from PostgreSQL migrations and product/vocabulary.json; do not hand-edit.
from enum import StrEnum

class ExecutionMethod(StrEnum):
    real = "real"
    ai = "ai"
    hybrid = "hybrid"


class ProductionType(StrEnum):
    social_video = "social_video"
    commercial = "commercial"
    advertisement = "advertisement"
    youtube = "youtube"
    interview = "interview"
    documentary = "documentary"
    music_video = "music_video"
    photography = "photography"
    portrait = "portrait"
    product_photography = "product_photography"
    fashion = "fashion"
    food = "food"
    automotive = "automotive"
    architecture = "architecture"
    campaign = "campaign"
    thumbnail = "thumbnail"
    poster = "poster"
    short_film = "short_film"
    long_form_film = "long_form_film"
    series = "series"
    recurring_content = "recurring_content"
    custom = "custom"
    product_film = "product_film"
    trailer = "trailer"


class Lifecycle(StrEnum):
    active = "active"
    archived = "archived"
    deleted = "deleted"


class ApprovalStatus(StrEnum):
    draft = "draft"
    needs_review = "needs_review"
    approved = "approved"
    changed_after_approval = "changed_after_approval"


class ResultStatus(StrEnum):
    raw = "raw"
    needs_review = "needs_review"
    approved = "approved"
    rejected = "rejected"
    final = "final"


class AssetCategory(StrEnum):
    character = "character"
    voice = "voice"
    product = "product"
    environment = "environment"
    wardrobe = "wardrobe"
    prop = "prop"
    vehicle = "vehicle"
    style_bible = "style_bible"
    brand = "brand"


class ResourceCategory(StrEnum):
    camera = "camera"
    phone_camera = "phone_camera"
    lens = "lens"
    light = "light"
    modifier = "modifier"
    stand = "stand"
    microphone = "microphone"
    recorder = "recorder"
    wireless_audio = "wireless_audio"
    gimbal = "gimbal"
    tripod = "tripod"
    monopod = "monopod"
    slider = "slider"
    drone = "drone"
    action_camera = "action_camera"
    filter = "filter"
    monitor = "monitor"
    rigging = "rigging"
    accessory = "accessory"
    editing_software = "editing_software"
    photo_software = "photo_software"
    ai_tool = "ai_tool"


class ReferenceRights(StrEnum):
    user_owned = "user_owned"
    licensed = "licensed"
    brand_owned = "brand_owned"
    authorized_identity = "authorized_identity"
    public_reference = "public_reference"
    third_party_inspiration = "third_party_inspiration"
    unknown = "unknown"


class ReferenceState(StrEnum):
    received = "received"
    metadata_available = "metadata_available"
    media_available = "media_available"
    processing = "processing"
    analyzed = "analyzed"
    partially_analyzed = "partially_analyzed"
    inaccessible = "inaccessible"
    failed = "failed"


class ReferenceSource(StrEnum):
    upload = "upload"
    url = "url"
    social_url = "social_url"
    cloud_import = "cloud_import"
    recording = "recording"
    asset = "asset"
    movie = "movie"
    description = "description"
    generated_result = "generated_result"
    previous_production = "previous_production"


class DialogueKind(StrEnum):
    dialogue = "dialogue"
    voiceover = "voiceover"
    narration = "narration"
    pause = "pause"
    reaction = "reaction"


class ScopeInheritance(StrEnum):
    inherit = "inherit"
    override = "override"
    exclude = "exclude"


class ProposalState(StrEnum):
    proposed = "proposed"
    applied = "applied"
    rejected = "rejected"


class ClaimKind(StrEnum):
    observed = "observed"
    estimated = "estimated"
    recommended = "recommended"


class MediaModality(StrEnum):
    metadata = "metadata"
    thumbnail = "thumbnail"
    image = "image"
    video_frames = "video_frames"
    audio = "audio"
    text = "text"


class AccessState(StrEnum):
    available = "available"
    inaccessible = "inaccessible"
    not_requested = "not_requested"


class CollaborationMode(StrEnum):
    guide_step_by_step = "guide_step_by_step"
    stop_at_major_decisions = "stop_at_major_decisions"
    complete_first_draft = "complete_first_draft"


class OperationOutcome(StrEnum):
    complete = "complete"
    partial = "partial"


class MutationAction(StrEnum):
    revise = "revise"
    reorder = "reorder"
    bind = "bind"
    assign_execution = "assign_execution"
    lock = "lock"
    unlock = "unlock"


CONSTITUTION_VERSION = "1.0.0"
DEFAULT_EXECUTION_FACE = ExecutionMethod.real
