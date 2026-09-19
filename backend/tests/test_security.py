import pytest
import base64
import io

from PIL import Image

from app.config import get_settings


def png_b64(w: int, h: int, mode: str = "1") -> str:
    buf = io.BytesIO()
    Image.new(mode, (w, h)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_decompression_bomb_is_refused_not_decoded(client):
    body = {"image": png_b64(13000, 13000)}  # ~50 KB on the wire, 169 megapixels
    res = client.post("/api/boxes/BOX-0001/vvm", json=body)
    assert res.status_code == 400


def test_unexpected_image_format_is_refused(client):
    buf = io.BytesIO()
    Image.new("RGB", (64, 64)).save(buf, "BMP")
    res = client.post("/api/boxes/BOX-0001/vvm", json={"image": base64.b64encode(buf.getvalue()).decode()})
    assert res.status_code == 400


def test_validation_errors_do_not_echo_input(client):
    res = client.post("/api/boxes/BOX-0001/unload", json={"note": "x" * 5000})
    assert res.status_code == 422
    assert "xxxx" not in res.text


def test_oversized_body_is_refused(client):
    res = client.post("/api/ingest/readings", content=b"x" * 10, headers={"content-length": str(20 * 1024 * 1024)})
    assert res.status_code == 413


def test_operator_code_guards_writes_when_set(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "operator_token", "site-1234")
    assert client.post("/api/boxes/BOX-0001/load", json={"node_id": "CAR-01"}).status_code == 401
    ok = client.post("/api/boxes/BOX-0001/load", json={"node_id": "CAR-01"}, headers={"X-Operator-Token": "site-1234"})
    assert ok.status_code == 200
    assert client.get("/api/boxes/BOX-0001/report").status_code == 200  # reads stay open


def test_decisions_validate_action_and_node(client):
    assert client.post("/api/nodes/CAR-01/decisions", json={"action": "LAUNCH"}).status_code == 422
    assert client.post("/api/nodes/NOPE/decisions", json={"action": "HOLD"}).status_code == 404


def test_ai_endpoints_are_rate_limited(client):
    codes = [client.post("/api/boxes/BOX-0004/explain").status_code for _ in range(32)]
    assert codes[0] == 200 and codes[-1] == 429


def test_responses_are_compressed(client):
    res = client.get("/api/boxes", headers={"Accept-Encoding": "gzip"})
    assert res.headers.get("content-encoding") == "gzip"


def test_admin_reset_refuses_without_a_configured_token(client):
    assert client.post("/api/admin/reset-demo").status_code == 403


def test_admin_reset_needs_the_right_code(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "operator_token", "s3cret")
    assert client.post("/api/admin/reset-demo", headers={"X-Operator-Token": "nope"}).status_code == 401


def test_health_reports_configuration_not_secrets(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["database"] == "ok"
    assert set(body["ai"]) == {"grok", "gemini"} and all(isinstance(v, bool) for v in body["ai"].values())


def test_stage_reset_clears_only_the_stage(client, session):
    from sqlmodel import select

    from app.models import Custody, Reading

    client.post("/api/boxes/BOX-9001/load", json={"node_id": "DEMO-01"})
    before_other = len(session.exec(select(Custody).where(Custody.box_id != "BOX-9001")).all())
    res = client.post("/api/admin/reset-stage")
    assert res.status_code == 200 and "BOX-9001" in res.json()["boxes"]
    session.expire_all()
    assert not session.exec(select(Custody).where(Custody.box_id == "BOX-9001")).all()
    assert not session.exec(select(Reading).where(Reading.node_id == "DEMO-01")).all()
    assert len(session.exec(select(Custody).where(Custody.box_id != "BOX-9001")).all()) == before_other


def test_a_node_with_an_empty_key_accepts_nothing(client, session):
    from app.models import Node

    node = session.get(Node, "DEMO-01")
    node.key = ""
    session.add(node)
    session.commit()
    body = {"node_id": "DEMO-01", "boot_id": 1, "readings": [{"seq": 1, "ts": 1_789_000_000, "temp_c": 5.0}]}
    assert client.post("/api/ingest/readings", json=body).status_code == 401
    assert client.post("/api/ingest/readings", json=body, headers={"X-Node-Key": ""}).status_code == 401


def test_a_node_key_set_after_seeding_reaches_every_node(session, monkeypatch):
    from sqlmodel import select

    from app.config import get_settings
    from app.models import Node
    from app.seed import sync_node_keys

    monkeypatch.setattr(get_settings(), "node_key", "a-real-secret")
    assert sync_node_keys(session) > 0
    assert {n.key for n in session.exec(select(Node)).all()} == {"a-real-secret"}
    assert sync_node_keys(session) == 0


@pytest.mark.parametrize("pasted", ["xai-abc", "  xai-abc \n", '"xai-abc"', "XAI_API_KEY=xai-abc", " XAI_API_KEY='xai-abc'\n"])
def test_a_pasted_key_is_tidied_to_the_key_itself(pasted):
    from app.config import Settings

    assert Settings(_env_file=None, xai_api_key=pasted).xai_api_key == "xai-abc"
