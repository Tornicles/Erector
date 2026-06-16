"""
Security utilities — hashing and verification.
No plaintext tokens are ever stored.
"""

import hashlib
import secrets
from typing import Optional


def hash_token(token: str) -> str:
    """SHA-256 hash a token string for safe storage."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_token_hash(token: str, hashed: str) -> bool:
    """Constant-time comparison of token against its hash."""
    return secrets.compare_digest(hash_token(token), hashed)


def generate_secure_token(nbytes: int = 32) -> str:
    """Generate a cryptographically secure URL-safe token."""
    return secrets.token_urlsafe(nbytes)


def hash_ip(ip: Optional[str]) -> Optional[str]:
    """One-way hash an IP address for privacy-safe storage."""
    if not ip:
        return None
    return hashlib.sha256(ip.encode("utf-8")).hexdigest()[:16]
