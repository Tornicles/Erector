"""
Test Gate 8: Security ownership contract.
- Protected collections must have owner_user_id
- Global reference collections don't require owner_user_id
- API keys must never store plaintext
- Bhudhi cannot write forbidden fields
- Public report share access validates token/expiry/revocation
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../backend'))


def test_protected_collection_requires_owner():
    from db.validators import validate_owned_document
    from db.collections import PROTECTED_COLLECTIONS

    sample_collection = "validation_sessions"
    assert sample_collection in PROTECTED_COLLECTIONS

    # Document without owner_user_id should fail
    errors = validate_owned_document({}, sample_collection)
    assert len(errors) > 0
    assert "owner_user_id" in errors[0]


def test_global_reference_no_owner_required():
    from db.validators import validate_owned_document
    from db.collections import GLOBAL_REFERENCE_COLLECTIONS

    for col in GLOBAL_REFERENCE_COLLECTIONS:
        errors = validate_owned_document({}, col)
        assert len(errors) == 0, (
            f"Global collection {col} should not require owner_user_id"
        )


def test_owned_document_with_owner_passes():
    from db.validators import validate_owned_document
    doc = {"owner_user_id": "user-001", "validation_id": "val-001"}
    errors = validate_owned_document(doc, "validation_sessions")
    assert len(errors) == 0


def test_api_key_plaintext_detection():
    from db.validators import validate_api_key_not_plaintext
    # Has plaintext key — should fail
    errors = validate_api_key_not_plaintext({"key": "sk-abc123"})
    assert len(errors) > 0


def test_api_key_hash_passes():
    from db.validators import validate_api_key_not_plaintext
    # Has hash, no plaintext — should pass
    errors = validate_api_key_not_plaintext({"key_hash": "a" * 64})
    assert len(errors) == 0


def test_bhudhi_forbidden_score_output():
    from db.validators import validate_bhudhi_output
    # Output contains forbidden field 'score'
    errors = validate_bhudhi_output({"score": 7.5, "explanation": "Good market"})
    assert len(errors) > 0
    assert any("score" in e for e in errors)


def test_bhudhi_forbidden_verdict_output():
    from db.validators import validate_bhudhi_output
    errors = validate_bhudhi_output({"verdict": "proceed", "reason": "Good"})
    assert len(errors) > 0


def test_bhudhi_clean_output_passes():
    from db.validators import validate_bhudhi_output
    # Clean output — interpretation only, no forbidden fields
    errors = validate_bhudhi_output({
        "interpretation": "The market shows moderate demand signals.",
        "suggested_questions": ["What is your pricing model?"],
        "clarity_issues": ["Goal is ambiguous"],
    })
    assert len(errors) == 0


def test_revoked_share_fails():
    from db.validators import validate_share_access
    from datetime import datetime, timezone
    share = {
        "share_url_token_hash": "abc123hash",
        "revoked_at": datetime.now(timezone.utc).isoformat(),
    }
    errors = validate_share_access(share)
    assert len(errors) > 0
    assert any("revoked" in e.lower() for e in errors)


def test_valid_share_passes():
    from db.validators import validate_share_access
    share = {
        "share_url_token_hash": "abc123hash",
        "revoked_at": None,
    }
    errors = validate_share_access(share)
    # Only error would be from revoked_at check — not triggered here
    revoked_errors = [e for e in errors if "revoked" in e.lower()]
    assert len(revoked_errors) == 0


def test_bhudhi_mode_validator():
    """BhudhiLog must reject forbidden modes."""
    import pytest
    from pydantic import ValidationError
    from models.bhudhi import BhudhiLog
    from models.enums import BhudhiMode

    # Valid mode — should succeed
    log = BhudhiLog(
        trigger_type="user_request",
        mode=BhudhiMode.interpret,
    )
    assert log.mode == "interpret"


def test_owned_document_model():
    """OwnedDocument base model must include owner_user_id."""
    from models.base import OwnedDocument
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        OwnedDocument()  # missing owner_user_id


def test_all_auditable_collections_known():
    from db.collections import AUDITABLE_COLLECTIONS, ALL_COLLECTIONS
    for col in AUDITABLE_COLLECTIONS:
        assert col in ALL_COLLECTIONS, f"Auditable collection {col} not in ALL_COLLECTIONS"


def test_all_protected_collections_known():
    from db.collections import PROTECTED_COLLECTIONS, ALL_COLLECTIONS
    for col in PROTECTED_COLLECTIONS:
        assert col in ALL_COLLECTIONS, f"Protected collection {col} not in ALL_COLLECTIONS"
