import time

import pytest

from app.config import get_settings
from app.models import Custody
from app.services import narrative, places

KEY = {"X-Node-Key": "dev-node-key"}


@pytest.fixture(autouse=True)
def no_ai_keys(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "")
    monkeypatch.setattr(get_settings(), "xai_api_key", "")


def load_freeze_history(client, session):
    now = int(time.time())
    session.add(Custody(box_id="BOX-0001", node_id="CAR-01", start_ts=now - 7200))
    session.commit()
    readings = [
        {"seq": i, "ts": now - 7200 + i * 60, "temp_c": -2.0 if 30 <= i < 110 else 5.0,
         "lat": -0.09, "lon": 34.76 - i * 1e-3}
        for i in range(119)
    ]
    client.post("/api/ingest/readings", json={"node_id": "CAR-01", "boot_id": 1, "readings": readings}, headers=KEY)


def test_explain_without_keys_uses_template_and_coordinates(client, session):
    load_freeze_history(client, session)
    body = client.post("/api/boxes/BOX-0001/explain").json()
    assert body["verdict"] == "QUARANTINE"
    assert body["source"] == "template" and body["places_source"] == "coords"
    assert body["text"].startswith("QUARANTINE")
    assert "shake test" in body["text"]
    assert all("," in name for name in body["places"].values())


def test_explain_uses_gemini_places_and_grok_text(client, session, monkeypatch):
    load_freeze_history(client, session)
    monkeypatch.setattr(get_settings(), "gemini_api_key", "g")
    monkeypatch.setattr(get_settings(), "xai_api_key", "x")
    seen = {}

    async def fake_gemini(client_, model, lat, lon):
        return "Kisumu-Bondo road near Holo"

    async def fake_grok(facts):
        seen["facts"] = facts
        return "This box froze on the road. Run the shake test."

    monkeypatch.setattr(places, "_ask_gemini", fake_gemini)
    monkeypatch.setattr(narrative, "_ask_grok", fake_grok)
    body = client.post("/api/boxes/BOX-0001/explain").json()
    assert body["source"] == "grok" and body["places_source"] == "gemini"
    assert set(body["places"].values()) == {"Kisumu-Bondo road near Holo"}
    assert seen["facts"]["verdict"] == "QUARANTINE"
    assert seen["facts"]["legs"][0]["events"][0]["where"] == "Kisumu-Bondo road near Holo"
    # Cached: the report now shows the names, and a second call hits no model.
    assert set(client.get("/api/boxes/BOX-0001/report").json()["places"].values()) == {"Kisumu-Bondo road near Holo"}
    monkeypatch.setattr(narrative, "_ask_grok", None)
    assert client.post("/api/boxes/BOX-0001/explain").json()["source"] == "grok"


def test_model_failures_fall_back(client, session, monkeypatch):
    load_freeze_history(client, session)
    monkeypatch.setattr(get_settings(), "gemini_api_key", "g")
    monkeypatch.setattr(get_settings(), "xai_api_key", "x")

    async def boom(*_):
        raise RuntimeError("down")

    monkeypatch.setattr(places, "_ask_gemini", boom)
    monkeypatch.setattr(narrative, "_ask_grok", boom)
    body = client.post("/api/boxes/BOX-0001/explain").json()
    assert body["source"] == "template" and body["places_source"] == "mixed"


def test_grok_response_parsing():
    assert narrative._output_text({"output_text": "hi"}) == "hi"
    data = {"output": [{"type": "reasoning"}, {"type": "message", "content": [{"type": "output_text", "text": "a"}, {"type": "output_text", "text": "b"}]}]}
    assert narrative._output_text(data) == "ab"


def test_place_names_are_cleaned():
    assert places._clean('**Kombewa Health Centre**.\nextra') == "Kombewa Health Centre"
