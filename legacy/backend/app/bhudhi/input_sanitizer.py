"""
Input sanitizer — Prompt A5
Masks secrets, strips dangerous content, and produces stable hashes for logging.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any


SECRET_PATTERNS = [
    # Bearer tokens
    (re.compile(r"Bearer\s+[A-Za-z0-9\-\._~\+/]+=*", re.IGNORECASE), "Bearer [REDACTED]"),
    # JWT-like
    (re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b"), "[JWT_REDACTED]"),
    # API keys (generic)
    (re.compile(r"\b(sk|rk|pk)_[A-Za-z0-9]{16,}\b"), "[KEY_REDACTED]"),
    # Private key blocks
    (re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |)PRIVATE KEY-----"), "[PRIVATE_KEY_REDACTED]"),
]


def strip_control_characters(text: str) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)


def remove_html_script_tags(text: str) -> str:
    text = re.sub(r"<script[\s\S]*?>[\s\S]*?</script>", "", text, flags=re.IGNORECASE)
    return re.sub(r"</?[^>]+>", "", text)


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def mask_secrets(text: str) -> str:
    masked = text
    for pat, repl in SECRET_PATTERNS:
        masked = pat.sub(repl, masked)
    return masked


def limit_text_length(text: str, max_length: int) -> str:
    if len(text) <= max_length:
        return text
    return text[:max_length]


def sanitize_user_text(text: str, max_length: int = 8000) -> str:
    t = strip_control_characters(text)
    t = remove_html_script_tags(t)
    t = mask_secrets(t)
    t = normalize_whitespace(t)
    return limit_text_length(t, max_length=max_length)


def sanitize_payload(payload: Any, max_length: int = 8000) -> Any:
    if isinstance(payload, str):
        return sanitize_user_text(payload, max_length=max_length)
    if isinstance(payload, dict):
        return {k: sanitize_payload(v, max_length=max_length) for k, v in payload.items()}
    if isinstance(payload, list):
        return [sanitize_payload(v, max_length=max_length) for v in payload]
    return payload


def build_input_hash(payload: Any) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

