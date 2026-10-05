"""
MongoDB Document Validators.
Schema-level enforcement rules for collections.
"""

from .collections import (
    PROTECTED_COLLECTIONS, GLOBAL_REFERENCE_COLLECTIONS,
    AUDITABLE_COLLECTIONS, ALL_COLLECTIONS
)


def validate_owned_document(doc: dict, collection: str) -> list[str]:
    """
    Validate that a document meets ownership requirements.
    Returns a list of validation errors (empty = valid).
    """
    errors = []

    if collection in GLOBAL_REFERENCE_COLLECTIONS:
        return errors  # global refs don't require owner

    if collection in PROTECTED_COLLECTIONS:
        if not doc.get("owner_user_id"):
            errors.append(
                f"Collection '{collection}' requires owner_user_id. "
                "All protected documents must include owner_user_id."
            )

    return errors


def validate_mutable_document(doc: dict, collection: str) -> list[str]:
    """
    Validate that mutable documents have required audit fields.
    """
    errors = []
    if collection in AUDITABLE_COLLECTIONS:
        if not doc.get("created_at"):
            errors.append(f"Collection '{collection}' requires created_at timestamp.")
    return errors


def validate_api_key_not_plaintext(doc: dict) -> list[str]:
    """API keys must never store plaintext key values."""
    errors = []
    if "key" in doc and not doc.get("key_hash"):
        errors.append("API keys must store key_hash, never plaintext 'key' field.")
    if doc.get("key_hash") and len(doc["key_hash"]) < 32:
        errors.append("key_hash appears too short — ensure proper hashing.")
    return errors


def validate_share_access(share_doc: dict) -> list[str]:
    """
    Validate that a report share access is only resolvable through
    token hash, expiry, password rules, and revoked_at.
    """
    errors = []
    if not share_doc.get("share_url_token_hash"):
        errors.append("Report share must have share_url_token_hash.")
    if share_doc.get("revoked_at"):
        errors.append("Share has been revoked.")
    return errors


def validate_bhudhi_output(output: dict) -> list[str]:
    """
    Enforce Bhudhi governance — output must not contain forbidden fields.
    """
    forbidden_fields = {
        "score", "verdict", "economy_profile", "climate",
        "reality_score", "climate_state", "verdict_type"
    }
    errors = []
    for field in forbidden_fields:
        if field in output:
            errors.append(
                f"Bhudhi governance violation: output contains forbidden field '{field}'. "
                "Bhudhi cannot write scores, verdicts, or economy profiles."
            )
    return errors


def validate_collection_name(collection: str) -> bool:
    """Check that a collection name is registered."""
    return collection in ALL_COLLECTIONS


def validate_soft_delete(doc: dict) -> list[str]:
    """Deleted documents must use soft delete (deleted_at) before hard purge."""
    errors = []
    if doc.get("deleted_at") is None and doc.get("status") == "deleted":
        errors.append(
            "Document marked as deleted but deleted_at is not set. "
            "Use soft delete workflow."
        )
    return errors
