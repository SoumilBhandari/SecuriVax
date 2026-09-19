"""Sign up, sign in, the demo viewer, sign out."""

import hmac
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.config import get_settings
from app.db import get_session
from app.models import Account
from app.security import sign_in_limit, sign_up_limit
from app.services import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8


class SignUpIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)
    name: str = Field("", max_length=80)
    # The site's operator code makes the account an operator; without it, a viewer.
    operator_code: str = Field("", max_length=200)


class SignInIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


def _public(a: Account) -> dict:
    return {"id": a.id, "email": a.email, "name": a.name or a.email.split("@")[0], "role": a.role}


def _start(request: Request, response: Response, user: dict) -> dict:
    https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(auth.COOKIE, auth.issue(user), max_age=auth.MAX_AGE_S, httponly=True, samesite="lax", secure=https, path="/")
    return {"user": user}


@router.post("/register", status_code=201, dependencies=[Depends(sign_up_limit)])
def register(body: SignUpIn, request: Request, response: Response, session: Session = Depends(get_session)) -> dict:
    email = body.email.strip().lower()
    if not EMAIL.match(email):
        raise HTTPException(422, "that doesn't look like an email address")
    if len(body.password) < MIN_PASSWORD:
        raise HTTPException(422, f"use at least {MIN_PASSWORD} characters for the password")
    if session.exec(select(Account).where(Account.email == email)).first():
        raise HTTPException(409, "there's already an account with that email: sign in instead")
    code = get_settings().operator_token
    given = body.operator_code.strip()
    if given and code and not hmac.compare_digest(code.encode(), given.encode()):
        raise HTTPException(403, "that operator code isn't right (leave it empty to sign up as a viewer)")
    # No code configured (a laptop): everyone can change things anyway.
    role = "operator" if (not code or given) else "viewer"
    account = Account(email=email, name=body.name.strip(), role=role, password_hash=auth.hash_password(body.password))
    session.add(account)
    session.commit()
    session.refresh(account)
    return _start(request, response, _public(account))


@router.post("/login", dependencies=[Depends(sign_in_limit)])
def login(body: SignInIn, request: Request, response: Response, session: Session = Depends(get_session)) -> dict:
    account = session.exec(select(Account).where(Account.email == body.email.strip().lower())).first()
    if not account or not auth.check_password(body.password, account.password_hash):
        raise HTTPException(401, "wrong email or password")
    return _start(request, response, _public(account))


@router.post("/demo", dependencies=[Depends(sign_in_limit)])
def demo(request: Request, response: Response) -> dict:
    """Look around without an account: a viewer that can't change anything."""
    return _start(request, response, dict(auth.DEMO))


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(auth.COOKIE, path="/")
    return {"user": None}


@router.get("/me")
def me(request: Request, session: Session = Depends(get_session)) -> dict:
    user = auth.signed_in(request, session)
    if not user:
        raise HTTPException(401, "not signed in")
    return {"user": user}
