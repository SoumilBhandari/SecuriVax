"""A verdict allows for the error of the sensor that took the readings."""

import time
from dataclasses import replace

import pytest

from app.engine.history import Reading, Segment
from app.engine.profiles import FREEZE_GUARD_C, PRODUCTS_BY_ID, freeze_guard, sensor_spec
from app.engine.uncertainty import verdict_confidence
from app.engine.verdict import QUARANTINE, USE, evaluate
from app.models import Node
from app.routers import live

T0 = 1_780_000_000
PENTA = PRODUCTS_BY_ID["penta"]
KEY = {"X-Node-Key": "dev-node-key"}


def leg(temps, sensor=None, step=60):
    rs = [Reading(T0 + i * step, t) for i, t in enumerate(temps)]
    return Segment("DEMO-01", "Demo carrier", rs[0].ts, rs[-1].ts, rs, sensor=sensor)


def codes(report):
    return {r.code for r in report.reasons}


def test_unknown_or_missing_sensor_is_the_designs_sht31():
    assert sensor_spec(None) == sensor_spec("sht31") == sensor_spec("mystery")
    assert freeze_guard(sensor_spec(None).sigma_c) == FREEZE_GUARD_C


def test_a_coarse_sensor_cant_rule_out_freezing_a_degree_above_zero():
    s = leg([4.0] * 10 + [0.8] * 90 + [4.0] * 10)
    fine = evaluate(PENTA, [s], now=s.end_ts)
    coarse = evaluate(PENTA, [replace(s, sensor="dht11")], now=s.end_ts)
    assert fine.verdict == USE and "FREEZE_POSSIBLE" not in codes(fine)
    assert coarse.verdict == QUARANTINE and "FREEZE_POSSIBLE" in codes(coarse)
    text = next(r.text for r in coarse.reasons if r.code == "FREEZE_POSSIBLE")
    assert "DHT11" in text and "±2 °C" in text
    assert coarse.segments[0].sensor == "DHT11" and coarse.segments[0].freeze_guard_c == pytest.approx(1.15)


def test_a_coarse_sensor_holds_in_fewer_scenarios():
    # About a third of the budget used at a steady 30 C: USE, not far from USE_FIRST.
    s = leg([30.0] * 400, step=3000)
    report = evaluate(PENTA, [s], now=s.end_ts)
    assert report.verdict == USE
    fine = verdict_confidence(PENTA, [s], 0.0, report.verdict, False, now=s.end_ts)
    coarse = verdict_confidence(PENTA, [replace(s, sensor="dht11")], 0.0, report.verdict, False, now=s.end_ts)
    assert coarse.confidence < fine.confidence
    assert coarse.budget_p90 - coarse.budget_p10 > 1.2 * (fine.budget_p90 - fine.budget_p10)


def test_an_explicit_bias_overrides_every_legs_sensor():
    s = leg([20.0] * 400, sensor="dht11", step=600)
    report = evaluate(PENTA, [s], now=s.end_ts)
    none = verdict_confidence(PENTA, [s], 0.0, report.verdict, False, now=s.end_ts, bias_c=0, rate_spread=0, initial_spread=0)
    assert none.confidence == 1.0


def test_ingest_records_the_sensor_the_node_reports(client, session):
    now = int(time.time())
    body = {"node_id": "DEMO-01", "boot_id": 1, "sensor": "DHT11", "readings": [{"seq": 1, "ts": now, "temp_c": 0.9}]}
    assert client.post("/api/ingest/readings", json=body, headers=KEY).status_code == 200
    session.expire_all()
    assert session.get(Node, "DEMO-01").sensor == "dht11"
    r = client.get("/api/live/recent", params={"node": "DEMO-01"}).json()["readings"][-1]
    assert (r["sensor"], r["sensor_accuracy_c"], r["band"]) == ("DHT11", 2.0, "freeze")
    assert live.band(0.9) == "cold"  # the same reading from an SHT31


def test_ingest_refuses_a_malformed_sensor_name(client):
    body = {"node_id": "DEMO-01", "boot_id": 1, "sensor": "dht11; drop", "readings": []}
    assert client.post("/api/ingest/readings", json=body, headers=KEY).status_code == 422
