"""Bhudhi input sanitizer tests — Prompt A5."""

from app.bhudhi.input_sanitizer import build_input_hash, sanitize_user_text


def test_control_chars_removed():
    assert "\x00" not in sanitize_user_text("hi\x00there")


def test_script_tags_removed():
    out = sanitize_user_text("<script>alert(1)</script>hello")
    assert "script" not in out.lower()
    assert "hello" in out.lower()


def test_bearer_masked():
    out = sanitize_user_text("Bearer abc.def.ghi")
    assert "REDACTED" in out


def test_hash_stable():
    a = build_input_hash({"x": 1, "y": 2})
    b = build_input_hash({"y": 2, "x": 1})
    assert a == b

