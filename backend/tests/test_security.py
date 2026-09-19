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
