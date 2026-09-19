from sqlmodel import select

from app.config import get_settings
from app.models import Account, KEEP_ON_RESET
from app.services import auth


def test_passwords_are_hashed_and_checked():
    stored = auth.hash_password("correct horse")
    assert stored.startswith("scrypt$") and "correct horse" not in stored
    assert auth.check_password("correct horse", stored)
    assert not auth.check_password("wrong horse", stored)
    assert not auth.check_password("x", "garbage")


def test_session_tokens_are_signed_and_expire():
    token = auth.issue({"id": 3, "name": "Amina", "role": "operator", "email": "a@b.co"}, now=1000)
    assert auth.read(token, now=1001)["role"] == "operator"
    body, sig = token.split(".")
    forged = auth._b64(auth._unb64(body).replace(b'"operator"', b'"operatorX"')) + "." + sig
    assert auth.read(forged, now=1001) is None
    assert auth.read(token, now=1000 + auth.MAX_AGE_S + 1) is None
    assert auth.read("nonsense", now=1001) is None


def test_sign_up_sign_in_and_out(client, session):
    res = client.post("/api/auth/register", json={"email": " Amina@Clinic.org ", "password": "cold-chain-8", "name": "Amina"})
    assert res.status_code == 201
    assert res.json()["user"] == {"id": 1, "email": "amina@clinic.org", "name": "Amina", "role": "operator"}  # no code set: open
    assert "httponly" in res.headers["set-cookie"].lower()
    assert client.get("/api/auth/me").json()["user"]["email"] == "amina@clinic.org"
    stored = session.exec(select(Account)).one()
    assert stored.password_hash != "cold-chain-8"

    assert client.post("/api/auth/register", json={"email": "amina@clinic.org", "password": "another-one"}).status_code == 409
    assert client.post("/api/auth/register", json={"email": "not-an-email", "password": "long-enough"}).status_code == 422
    assert client.post("/api/auth/register", json={"email": "b@c.org", "password": "short"}).status_code == 422

    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "amina@clinic.org", "password": "nope-nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "AMINA@clinic.org", "password": "cold-chain-8"}).status_code == 200
    assert client.get("/api/auth/me").json()["user"]["name"] == "Amina"


def test_operator_code_decides_the_role(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "operator_token", "site-1234")
    viewer = client.post("/api/auth/register", json={"email": "v@x.org", "password": "viewer-pass"})
    assert viewer.json()["user"]["role"] == "viewer"
    assert client.post("/api/auth/register", json={"email": "w@x.org", "password": "viewer-pass", "operator_code": "guess"}).status_code == 403
    op = client.post("/api/auth/register", json={"email": "o@x.org", "password": "operator-pass", "operator_code": "site-1234"})
    assert op.json()["user"]["role"] == "operator"


def test_only_operators_change_things(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "operator_token", "site-1234")
    load = lambda: client.post("/api/boxes/BOX-0001/load", json={"node_id": "CAR-01"})  # noqa: E731
    assert load().status_code == 401  # nobody signed in

    client.post("/api/auth/register", json={"email": "v@x.org", "password": "viewer-pass"})
    assert client.get("/api/auth/me").json()["user"]["role"] == "viewer"
    assert load().status_code == 403  # a viewer can look, not change
    client.post("/api/auth/logout")

    client.post("/api/auth/register", json={"email": "o@x.org", "password": "operator-pass", "operator_code": "site-1234"})
    assert load().status_code == 200

    client.post("/api/auth/logout")
    header = client.post("/api/boxes/BOX-0001/unload", json={}, headers={"X-Operator-Token": "site-1234"})
    assert header.status_code == 200  # scripts still work with the code


def test_a_deleted_account_is_signed_out(client, session, monkeypatch):
    monkeypatch.setattr(get_settings(), "operator_token", "site-1234")
    client.post("/api/auth/register", json={"email": "gone@x.org", "password": "operator-pass", "operator_code": "site-1234"})
    assert client.get("/api/auth/me").status_code == 200
    session.delete(session.exec(select(Account)).one())
    session.commit()
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/boxes/BOX-0001/load", json={"node_id": "CAR-01"}).status_code == 401


def test_sign_in_is_rate_limited(client):
    codes = [client.post("/api/auth/login", json={"email": "a@b.org", "password": "whatever1"}).status_code for _ in range(12)]
    assert codes[:10] == [401] * 10 and codes[-1] == 429


def test_demo_reset_keeps_accounts(engine):
    from sqlmodel import Session

    from app.db import drop_demo_tables, init_db

    with Session(engine) as s:
        s.add(Account(email="keep@x.org", password_hash=auth.hash_password("keep-me-1")))
        s.commit()
    drop_demo_tables(engine)
    init_db(engine)
    with Session(engine) as s:
        assert [a.email for a in s.exec(select(Account)).all()] == ["keep@x.org"]
    assert KEEP_ON_RESET == {"account"}


def test_looking_needs_no_sign_in_and_the_agent_is_open(client, monkeypatch):
    """A judge's own phone: every read works signed out, and so does asking the
    dispatch agent (advice only). Acting on its advice needs an operator."""
    monkeypatch.setattr(get_settings(), "operator_token", "site-1234")
    assert client.get("/api/boxes").status_code == 200
    assert client.get("/api/boxes/BOX-0001/report").status_code == 200
    assert client.get("/api/nodes/CAR-02").status_code == 200
    first = client.post("/api/nodes/CAR-02/agent", json={"question": "what now?"})
    assert first.status_code == 200 and first.json()["source"] == "rules"  # no key in tests
    again = client.post("/api/nodes/CAR-02/agent", json={"question": "what now?"})
    assert again.json() == first.json()  # the same answer, reused
    assert client.post("/api/nodes/CAR-02/decisions", json={"action": "CONTINUE"}).status_code == 401

