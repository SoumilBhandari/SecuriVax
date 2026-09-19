"""Guards for a public deployment.

- Writes that change custody or verdicts need an operator when the site has
  an operator code (OPERATOR_TOKEN): someone signed in with an operator
  account, or a script sending the code itself. Node uploads use per-node keys.
- Endpoints that call paid AI APIs or heavy models, and sign-in, are rate
  limited per client.
"""

import hmac
import threading
import time
from collections import defaultdict, deque

from fastapi import Depends, Header, HTTPException, Request
from sqlmodel import Session

from app.config import get_settings
from app.db import get_session


def require_operator(request: Request, x_operator_token: str = Header(default=""), session: Session = Depends(get_session)) -> None:
    from app.services.auth import signed_in

    token = get_settings().operator_token
    if not token:
        return  # a laptop with no code set: open
    if x_operator_token and hmac.compare_digest(token.encode(), x_operator_token.encode()):
        return  # scripts and tools
    user = signed_in(request, session)
    if user and user["role"] == "operator":
        return
    if user:
        raise HTTPException(403, "only operators can change this: sign in with an operator account")
    raise HTTPException(401, "sign in as an operator to change this")


class RateLimit:
    """Sliding window: at most `limit` calls per `window_s` per client IP, or
    across everyone with per_client=False (a cap on a paid API's total use)."""

    def __init__(self, name: str, limit: int, window_s: int = 60, per_client: bool = True):
        self.name, self.limit, self.window_s, self.per_client = name, limit, window_s, per_client
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def __call__(self, request: Request) -> None:
        client = (request.client.host if request.client else "unknown") if self.per_client else "everyone"
        now = time.monotonic()
        with self._lock:
            hits = self._hits[client]
            while hits and now - hits[0] > self.window_s:
                hits.popleft()
            if len(hits) >= self.limit:
                wait = "a minute" if self.window_s <= 60 else "a while"
                raise HTTPException(429, f"too many {self.name} requests, try again in {wait}")
            hits.append(now)
            if len(self._hits) > 10_000:  # don't let a scan of IPs grow memory forever
                self._hits.clear()

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


explain_limit = RateLimit("report", 30)
agent_limit = RateLimit("agent", 12)
# The agent is open to anyone (it only advises), so Gemini's total use is capped too.
agent_hourly_limit = RateLimit("dispatch agent", 60, 3600, per_client=False)
vvm_limit = RateLimit("photo", 20)
plan_limit = RateLimit("plan", 20)
sign_in_limit = RateLimit("sign-in", 10)
sign_up_limit = RateLimit("sign-up", 5)
ALL_LIMITS = (explain_limit, agent_limit, agent_hourly_limit, vvm_limit, plan_limit, sign_in_limit, sign_up_limit)
