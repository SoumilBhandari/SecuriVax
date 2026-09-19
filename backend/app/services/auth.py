"""Accounts and sign-in: scrypt password hashes and a signed session cookie.

Standard library only. The cookie carries the account id, role and name,
signed with HMAC-SHA256, and expires after 30 days; it's HttpOnly and
SameSite=Lax, so page scripts can't read it and other sites can't post with it.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from functools import lru_cache

from fastapi import Request

from app.config import get_settings

COOKIE = "sv_session"
MAX_AGE_S = 30 * 24 * 3600

_N, _R, _P = 2**14, 8, 1  # scrypt cost: ~16 MB and a few tens of ms per hash


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(digest)}"


def check_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        got = hashlib.scrypt(password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), dklen=len(_unb64(digest)))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got, _unb64(digest))


@lru_cache
def _random_dev_secret() -> bytes:
    return secrets.token_bytes(32)


def _secret() -> bytes:
    s = get_settings()
    if s.session_secret:
        return s.session_secret.encode()
    if s.operator_token:
        # A deploy already has these two secrets; changing either signs everyone out.
        return hashlib.sha256(f"securivax-session|{s.operator_token}|{s.node_key}".encode()).digest()
    return _random_dev_secret()


def issue(user: dict, now: float | None = None) -> str:
    payload = {"id": user["id"], "name": user["name"], "role": user["role"], "email": user.get("email"),
               "exp": int((now or time.time()) + MAX_AGE_S)}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read(token: str, now: float | None = None) -> dict | None:
    try:
        body, sig = token.split(".")
        want = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, want):
            return None
        payload = json.loads(_unb64(body))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if payload.get("exp", 0) < (now or time.time()):
        return None
    return {k: payload.get(k) for k in ("id", "name", "role", "email")}


def signed_in(request: Request, session) -> dict | None:
    """Who the cookie says, checked against the accounts table: a deleted
    account is signed out, and a changed role applies at once."""
    from app.models import Account

    token = request.cookies.get(COOKIE)
    user = read(token) if token else None
    if not user:
        return None
    account = session.get(Account, user["id"])
    if account is None:
        return None
    return {**user, "role": account.role, "name": account.name or account.email.split("@")[0], "email": account.email}
