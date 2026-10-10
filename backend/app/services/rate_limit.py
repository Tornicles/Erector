"""Bounded per-process rate limiting for Prompt 10 actions (§38).

Prompt 10 must stop one caller from hammering an expensive or externally-visible action, and must not
pretend to own Prompt 11's global system. So this is deliberately small and truthful:

* it is **per API process**, in memory, and a fixed window - it is not a distributed limit and nothing
  claims it survives a restart;
* it is keyed by action and by the authenticated user, so one workspace member cannot spend another
  member's budget;
* the reset timestamp is returned with every rejection, so a caller can wait instead of guessing.

Prompt 11 replaces this with the durable, shared limiter. The interface is the part Prompt 10 owns.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from app.core.errors import AppError

# Actions that need protection, with the window and how many calls fit inside it. These are guards
# against abuse and accidents, not commercial limits - quotas live in the entitlement layer.
ACTION_LIMITS: dict[str, tuple[int, int]] = {
    'export.request': (20, 60),
    'export.build': (20, 60),
    'export.download': (120, 60),
    'oauth.initiate': (20, 60),
    'oauth.callback': (20, 60),
    'provider.connect': (20, 60),
    'provider.disconnect': (20, 60),
    'provider.verify': (20, 60),
    'publication.preview': (240, 60),
    'publication.submit': (20, 60),
    'publication.refresh': (60, 60),
    'publication.reconcile': (60, 60),
    'billing.checkout': (10, 60),
    'billing.portal': (20, 60),
    'billing.status': (120, 60),
    'usage.read': (240, 60),
    'usage.record': (600, 60),
    'webhook.receive': (600, 60),
}
DEFAULT_LIMIT = (30, 60)


@dataclass
class _Window:
    count: int = 0
    reset_at: float = 0.0


@dataclass
class RateLimiter:
    """A fixed-window limiter. `allow` answers whether the call may proceed, and when to try again."""

    limits: dict[str, tuple[int, int]] = field(default_factory=lambda: dict(ACTION_LIMITS))
    _windows: dict[tuple[str, str], _Window] = field(default_factory=dict)

    def allow(self, action: str, subject: str, *, now: float | None = None) -> tuple[bool, int]:
        limit, window_seconds = self.limits.get(action, DEFAULT_LIMIT)
        moment = time.monotonic() if now is None else now
        key = (action, subject)
        window = self._windows.get(key)
        if window is None or moment >= window.reset_at:
            window = _Window(count=0, reset_at=moment + window_seconds)
            self._windows[key] = window
        window.count += 1
        if window.count > limit:
            return False, max(1, int(window.reset_at - moment) + 1)
        return True, 0

    def enforce(self, action: str, subject: str) -> None:
        allowed, retry_after = self.allow(action, subject)
        if not allowed:
            raise AppError('RATE_LIMITED', 'conflict',
                f'Too many {action.replace(".", " ")} attempts. Try again in {retry_after} seconds.', 429)

    def reset(self) -> None:
        self._windows.clear()
