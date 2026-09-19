import time
from types import SimpleNamespace

import pytest

from app.config import get_settings
from app.services import location_agent
from simulator.backfill import backfill


@pytest.fixture
def on_the_road(session):
    backfill(session, int(time.time()))


def test_rules_keep_a_carrier_going_while_it_has_cold_and_name_a_fallback(client, on_the_road, monkeypatch):
    # Pin the forecast: with the offline weather model, how much cold is left
    # depends on the hour the test runs. The rule is what's under test.
    real_status = location_agent.Tools.get_carrier_status
    real_chance = location_agent.Tools.breach_chance_before_arrival

    def plenty_of_cold(self):
        out = real_status(self)
        out["forecast"]["minutes_until_it_leaves_2_8C_p10_p50_p90"] = [240, 400, 600]
        return out

    def safe_everywhere(self, facility_id):
        out = real_chance(self, facility_id)
        out["chance_leaves_2_8C_first"] = 0.0
        return out

    monkeypatch.setattr(location_agent.Tools, "get_carrier_status", plenty_of_cold)
    monkeypatch.setattr(location_agent.Tools, "breach_chance_before_arrival", safe_everywhere)
    body = client.post("/api/nodes/CAR-02/agent", json={}).json()
    rec = body["recommendation"]
    assert body["source"] == "rules"
    assert [s["tool"] for s in body["steps"]][:2] == ["get_carrier_status", "find_facilities"]
    assert rec["action"] == "CONTINUE"
    assert "nearest fridge is Kisumu district vaccine store" in rec["summary"]


def test_rules_divert_when_the_destination_is_out_of_reach(client, on_the_road, monkeypatch):
    # Make Bondo unreachable in range, and every closer fridge safe.
    real = location_agent.Tools.breach_chance_before_arrival

    def fake(self, facility_id):
        out = real(self, facility_id)
        out["chance_leaves_2_8C_first"] = 0.9 if facility_id == "BONDO" else 0.0
        return out

    monkeypatch.setattr(location_agent.Tools, "breach_chance_before_arrival", fake)
    rec = client.post("/api/nodes/CAR-02/agent", json={"destination_id": "BONDO"}).json()["recommendation"]
    assert rec["action"] == "DIVERT" and rec["facility_id"] == "KSM-STORE"
    assert rec["eta_min"] is not None


def test_rules_continue_when_the_destination_is_reachable(client, on_the_road):
    # Kisumu store is right where CAR-02 is: it will arrive in range.
    rec = client.post("/api/nodes/CAR-02/agent", json={"destination_id": "KSM-STORE"}).json()["recommendation"]
    assert rec["action"] == "CONTINUE" and rec["facility_id"] == "KSM-STORE"


def test_unknown_inputs(client):
    assert client.post("/api/nodes/NOPE/agent", json={}).status_code == 404
    assert client.post("/api/nodes/CAR-02/agent", json={"destination_id": "X"}).status_code == 404


def test_gemini_agent_loop_calls_tools_then_submits(client, on_the_road, monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "g")
    script = iter([
        [("get_carrier_status", {})],
        [("find_facilities", {"max_km": 40})],
        [("breach_chance_before_arrival", {"facility_id": "MASENO"})],
        [("submit_recommendation", {"action": "DIVERT", "facility_id": "MASENO",
                                    "summary": "Divert to Maseno.", "reasons": ["Ice runs out soon."]})],
    ])

    class FakeModels:
        def generate_content(self, model, contents, config):
            calls = next(script)
            parts = [SimpleNamespace(function_call=SimpleNamespace(name=n, args=a)) for n, a in calls]
            return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=parts, role="model"))])

    class FakeClient:
        def __init__(self, api_key):
            self.models = FakeModels()

    monkeypatch.setattr(location_agent.genai, "Client", FakeClient)
    monkeypatch.setattr(location_agent.types, "Content", lambda role, parts: SimpleNamespace(role=role, parts=parts))
    monkeypatch.setattr(location_agent.types.Part, "from_text", staticmethod(lambda text: SimpleNamespace(text=text)))
    monkeypatch.setattr(location_agent.types.Part, "from_function_response",
                        staticmethod(lambda name, response: SimpleNamespace(name=name, response=response)))
    body = client.post("/api/nodes/CAR-02/agent", json={}).json()
    assert body["source"] == "gemini"
    assert body["recommendation"]["action"] == "DIVERT" and body["recommendation"]["facility_name"].startswith("Maseno")
    assert [s["tool"] for s in body["steps"]] == ["get_carrier_status", "find_facilities", "breach_chance_before_arrival"]


def test_accepting_a_recommendation_is_logged(client, on_the_road):
    res = client.post("/api/nodes/CAR-02/decisions", json={"action": "DIVERT", "facility_id": "MASENO"}).json()
    assert res["logged"] == 2


def test_rules_say_so_when_there_is_no_forecast(client, on_the_road, session):
    # DEMO-01 runs on demo time: no forecast, so no made-up recommendation.
    from app.models import Custody
    import time as _t

    session.add(Custody(box_id="BOX-9001", node_id="DEMO-01", start_ts=int(_t.time()) - 60))
    session.commit()
    rec = client.post("/api/nodes/DEMO-01/agent", json={"destination_id": "KOMBEWA"}).json()["recommendation"]
    assert rec["action"] == "UNKNOWN" and "Can't forecast" in rec["summary"]
