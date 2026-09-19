"""Guards for a public deployment.

- Writes that change custody or verdicts need the site's operator code
  (OPERATOR_TOKEN) when one is configured. Node uploads use per-node keys.
- Endpoints that call paid AI APIs or heavy models are rate limited per client.
"""

import hmac
import threading
import time
from collections import defaultdict, deque

from fastapi import Header, HTTPException, Request

from app.config import get_settings


def require_operator(x_operator_token: str = Header(default="")) -> None:
    token = get_settings().operator_token
    if token and not hmac.compare_digest(token.encode(), x_operator_token.encode()):
        raise HTTPException(401, "operator code required")


class RateLimit:
    """Sliding window: at most `limit` calls per `window_s` per client IP."""

    def __init__(self, name: str, limit: int, window_s: int = 60):
        self.name, self.limit, self.window_s = name, limit, window_s
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def __call__(self, request: Request) -> None:
        client = request.client.host if request.client else "unknown"
        now = time.monotonic()
        with self._lock:
            hits = self._hits[client]
            while hits and now - hits[0] > self.window_s:
                hits.popleft()
            if len(hits) >= self.limit:
                raise HTTPException(429, f"too many {self.name} requests, try again in a minute")
            hits.append(now)
            if len(self._hits) > 10_000:  # don't let a scan of IPs grow memory forever
                self._hits.clear()

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


explain_limit = RateLimit("report", 30)
agent_limit = RateLimit("agent", 12)
vvm_limit = RateLimit("photo", 20)
plan_limit = RateLimit("plan", 20)
ALL_LIMITS = (explain_limit, agent_limit, vvm_limit, plan_limit)
