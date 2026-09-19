import time

import pytest

from app.engine import carrier_model as cm
from app.engine.environment import analyze_leg, sensor_noise
from app.services import weather as wx
from simulator.backfill import backfill

T0 = 1_780_000_000


# --- engine ------------------------------------------------------------------

def test_carrier_holds_while_ice_lasts_then_drifts_to_ambient():
    sim = cm.simulate(lambda ts: 43.0, T0, T0 + 30 * 3600, cm.CarrierSpec(cold_life_h=20))
    held = [c for ts, c in sim if ts <= T0 + 19.8 * 3600]
    assert set(held) == {5.0}
    assert sim[-1][1] > 40  # ten hours after the ice ran out
    assert cm.first_breach(sim, 8.0) == pytest.approx(T0 + 20.5 * 3600, abs=3600)


def test_effective_cold_life_from_a_real_breach():
    # Outside 43 C; inside held 6 h, then warmed: a "6 h" carrier.
    measured = [(T0 + m * 60, 5.0 if m < 360 else 5.0 + (m - 360) * 0.1) for m in range(600)]
    hours, how = cm.effective_cold_life(measured, lambda ts: 43.0, 8.0)
    assert how == "fitted" and hours == pytest.approx(6.3, abs=0.5)
    held, how = cm.effective_cold_life([(T0 + m * 60, 5.0) for m in range(120)], lambda ts: 43.0, 8.0)
    assert how == "held" and held == pytest.approx(2.0, abs=0.1)


@pytest.mark.parametrize("inside,outside,code", [
    (5.0, 30.0, "PROTECTED"),
    (29.0, 30.0, "TRACKING_AMBIENT"),
    (40.0, 30.0, "HEAT_SOURCE"),
    (-3.0, 25.0, "FROZEN_PACKS"),
    (5.0, 6.0, "CALM"),
])
def test_leg_is_explained_by_inside_vs_outside(inside, outside, code):
    pairs = [(T0 + i * 300, inside, outside) for i in range(24)]
    assert analyze_leg(pairs, 2, 8, "model").code == code


def test_sensor_noise_ignores_slow_trends():
    trend = [5 + i * 0.05 for i in range(100)]
    assert sensor_noise(trend) == 0
    jitter = [5 + (0.3 if i % 2 else -0.3) for i in range(100)]
    assert sensor_noise(jitter) > 0.3


def test_offline_weather_is_labelled_model():
    w = wx.weather_for([(-0.09, 34.77)])[wx.cell(-0.09, 34.77)]
    assert w.source == "model"
    temp, rh = w.at(int(time.time()))
    assert 15 < temp < 35 and 0 < rh <= 100


# --- API ---------------------------------------------------------------------

def test_stores_at_risk(client, session):
    backfill(session, int(time.time()))
    body = client.get("/api/climate/stores").json()
    assert body["source"] == "model"
    assert len(body["facilities"]) == 7
    first = body["facilities"][0]
    assert {"risk", "peak_c", "forecast", "actions", "stock"} <= first.keys()
    kombewa = next(f for f in body["facilities"] if f["id"] == "KOMBEWA")
    assert {b["id"] for b in kombewa["stock"]} >= {"BOX-0001", "BOX-0003", "BOX-0004"}


def test_carrier_performance_calls_out_the_bad_carriers(client, session):
    backfill(session, int(time.time()))
    perf = {c["node_id"]: c for c in client.get("/api/climate/carriers").json()}
    assert perf["CAR-01"]["rating"] == "failing"  # the parked-car trip
    assert "froze" in perf["CAR-01"]["note"]
    assert perf["CAR-02"]["rating"] in ("underperforming", "failing")  # hot outreach days
    assert "DEMO-01" not in perf  # demo time isn't real time: never rated
    assert "RDT-01" not in perf  # store-room box, not an ice-pack carrier


def test_trip_plan_uses_the_carriers_measured_cold_life(client, session):
    backfill(session, int(time.time()))
    rated = client.post("/api/climate/plan", json={"product_id": "opv"}).json()
    measured = client.post("/api/climate/plan", json={"product_id": "opv", "carrier_id": "CAR-02"}).json()
    assert rated["cold_life_h"] == 20 and measured["cold_life_h"] < 20
    assert "CAR-02's measured" in measured["assumptions"]
    dest = measured["destinations"][0]
    hours = {(o["depart_ts"] // 3600 + 3) % 24 for o in dest["options"]}
    assert hours and min(hours) >= 5 and max(hours) <= 15  # daylight departures only
    assert dest["rated_best"] is not None
    assert len(measured["destinations"]) == 5 and len(measured["recommendations"]) >= 5
    short = client.post("/api/climate/plan", json={"product_id": "opv", "cold_life_h": 1, "session_h": 8}).json()
    assert any(d["worst"]["breach_ts"] for d in short["destinations"])


def test_plan_validates_input(client):
    assert client.post("/api/climate/plan", json={"product_id": "nope"}).status_code == 404
    assert client.post("/api/climate/plan", json={"product_id": "opv", "origin_id": "X"}).status_code == 404


def test_box_report_explains_each_leg_with_the_weather(client, session):
    backfill(session, int(time.time()))
    seg = client.get("/api/boxes/BOX-0001/report").json()["segments"][0]
    env = seg["environment"]
    assert env["code"] == "FROZEN_PACKS"
    outside = [c for _, c in env["ambient"]]
    assert outside and min(outside) >= env["ambient_min_c"] - 0.1  # outside air, not the frozen inside
    assert seg["environment"]["noise_c"] < 0.5
    hot_car = client.get("/api/boxes/BOX-0005/report").json()["segments"][0]["environment"]
    assert hot_car["code"] in ("HEAT_SOURCE", "TRACKING_AMBIENT")


def test_planning_a_long_lane_trip_never_runs_out_of_weather():
    """Accra to Bolgatanga with a real truck, departures two days out: the
    trip ends past the forecast window, which used to crash the planner."""
    import time

    from sqlmodel import Session

    from app.db import init_db, make_engine
    from app.seed import seed
    from app.services.climate import plan_trips
    from simulator.backfill import backfill

    eng = make_engine("sqlite://")
    init_db(eng)
    with Session(eng) as session:
        seed(session, "lanes")
        backfill(session, int(time.time()), "lanes")
        plan = plan_trips(session, product_id="opv", origin_id="ACC-CMS", carrier_id="GH-TRK", session_h=8)
    assert plan["destinations"]


def test_planner_departs_in_daylight_on_the_origins_own_clock(session):
    # An origin on Accra time (GMT): daylight is 05:00-15:00 there, not in Kenya.
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from app.models import Facility
    from app.services.climate import FIRST_DEPARTURE_H, LAST_DEPARTURE_H, plan_trips

    store = session.get(Facility, "KSM-STORE")
    store.timezone = "Africa/Accra"
    session.add(store)
    session.commit()
    plan = plan_trips(session, product_id="opv", origin_id="KSM-STORE", carrier_id=None, session_h=6)
    hours = {datetime.fromtimestamp(o["depart_ts"], ZoneInfo("Africa/Accra")).hour
             for d in plan["destinations"] for o in d["options"]}
    assert hours and all(FIRST_DEPARTURE_H <= h <= LAST_DEPARTURE_H for h in hours)
    assert all("local (GMT)" in line for line in plan["recommendations"] if "leave" in line)
    assert plan["origin"]["timezone"] == "Africa/Accra"



