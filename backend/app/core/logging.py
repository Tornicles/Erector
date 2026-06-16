"""
Structured logging setup for the Erector API.
Logs include request_id, method, path, status, processing_time_ms, user_id.
Sensitive data (tokens, secrets, raw goal text) is NEVER logged.
"""

import logging
import sys
from typing import Optional


_configured = False

SENSITIVE_KEYS = frozenset({
    "password", "token", "secret", "key", "jwt", "access_token",
    "refresh_token", "authorization", "supabase_service_role_key",
    "raw_goal", "email",  # personally identifiable
})


class SensitiveFilter(logging.Filter):
    """Strip sensitive fields from log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        if hasattr(record, "extra"):
            for key in list(record.extra.keys()):
                if any(s in key.lower() for s in SENSITIVE_KEYS):
                    record.extra[key] = "***REDACTED***"
        return True


def setup_logging(log_level: str = "INFO") -> None:
    global _configured
    if _configured:
        return

    level = getattr(logging, log_level.upper(), logging.INFO)

    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    handler.setFormatter(formatter)
    handler.addFilter(SensitiveFilter())

    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    root_logger.handlers.clear()
    root_logger.addHandler(handler)

    # Quiet noisy libs
    logging.getLogger("motor").setLevel(logging.WARNING)
    logging.getLogger("pymongo").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    _configured = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def log_request(
    logger: logging.Logger,
    *,
    request_id: str,
    method: str,
    path: str,
    status_code: int,
    processing_time_ms: int,
    user_id: Optional[str] = None,
    error_type: Optional[str] = None,
) -> None:
    """Structured request log — no sensitive data."""
    parts = [
        f"request_id={request_id}",
        f"method={method}",
        f"path={path}",
        f"status={status_code}",
        f"time_ms={processing_time_ms}",
    ]
    if user_id:
        parts.append(f"user_id={user_id}")
    if error_type:
        parts.append(f"error={error_type}")

    log_fn = logger.warning if status_code >= 400 else logger.info
    log_fn(" | ".join(parts))
