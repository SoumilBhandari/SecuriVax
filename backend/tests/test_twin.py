import time

import numpy as np
import pytest

from app.engine import twin
from app.engine.history import Reading, Segment
from app.engine.profiles import PRODUCTS_BY_ID
from app.engine.uncertainty import verdict_confidence
from simulator.backfill import backfill

T0 = 1_790_000_000


def carrier(cold_life_h, outside, hours=24, leak=1.0, step_s=180, seed=0):
    """A known carrier: the same physics the twin assumes, plus sensor noise."""
    rng = np.random.default_rng(seed)
    truth = twin.Particles(*(np.array([v]) for v in (5.0, cold_life_h * 38 * leak, 5.0, leak, 0.0, 1.5, 0.0, 1.0)))
    out = []
    for i in range(int(hours * 3600 / step_s)):
        if i:
            twin.step(truth, outside, step_s / 3600, None)
        out.append((T0 + i * step_s, float(truth.temp[0] + rng.normal(0, 0.15)), 1.0))
    return out


@pytest.mark.parametrize("life,leak", [(2, 1.0), (4, 1.0), (3, 2.0), (8, 0.7), (5, 1.5)])
def test_twin_recovers_cold_life_from_a_finished_trip(life, leak):
    res = twin.run_filter(carrier(life, 30.0, leak=leak), lambda ts: 30.0)
    _, mid, _ = twin.weighted_quantiles(twin.effective_cold_life(res.particles), res.particles.weight, (0.1, 0.5, 0.9))
    assert mid == pytest.approx(life, rel=0.25)
    assert res.one_step_rmse_c < 1.5


def test_forecast_says_when_the_ice_runs_out():
    series = carrier(4, 30.0)
    breach = next(ts for ts, c, _ in series if c > 8)
    seen = [s for s in series if s[0] <= T0 + 3 * 3600]
    res = twin.run_filter(seen, lambda ts: 30.0, known_cold_life_h=4.0)
    fc = twin.forecast(res, [lambda ts, d=d: 30.0 + d for d in (-1, 0, 1)], 12, 8.0)
    assert fc.breach_prob > 0.9
    assert fc.breach_p10 <= breach + 3600 and fc.breach_p90 >= breach - 3600
    assert all(lo <= mid <= hi for lo, mid, hi in zip(fc.p10, fc.p50, fc.p90))


def test_a_well_packed_carrier_is_not_forecast_to_fail():
    seen = carrier(30, 25.0, hours=3)
    res = twin.run_filter(seen, lambda ts: 25.0, known_cold_life_h=30.0)
    assert twin.forecast(res, [lambda ts: 25.0], 12, 8.0).breach_prob < 0.1


def segment(temps, step=3600):
    return [Segment("CAR-01", "Carrier CAR-01", T0, T0 + (len(temps) - 1) * step,
                    [Reading(T0 + i * step, t) for i, t in enumerate(temps)])]


def test_confidence_is_high_far_from_thresholds_and_low_near_them():
    penta = PRODUCTS_BY_ID["penta"]
    safe = verdict_confidence(penta, segment([5.0] * 24), 0.1, "USE", False)
    assert safe.confidence > 0.99 and not safe.borderline
    # 67.5 of 90 days at 25 C: budget exactly at the 0.75 line.
    edge = verdict_confidence(penta, segment([25.0] * (67 * 24 + 13)), 0.0, "QUARANTINE", False)
    assert 0.3 < edge.confidence < 0.8 and edge.borderline
    assert edge.budget_p10 < 0.75 < edge.budget_p90


def test_confidence_accounts_for_sensor_bias_on_freezes():
    penta = PRODUCTS_BY_ID["penta"]
    clear = verdict_confidence(penta, segment([5.0] + [-3.0] * 3 + [5.0], step=1800), 0.1, "QUARANTINE", False)
    assert clear.confidence > 0.99
    marginal = verdict_confidence(penta, segment([5.0] + [-0.6] * 3 + [5.0], step=1800), 0.1, "QUARANTINE", False)
    assert marginal.borderline


# --- API ---------------------------------------------------------------------

def test_live_forecast_for_a_carrier_on_the_road(client, session):
    backfill(session, int(time.time()))
    body = client.get("/api/nodes/CAR-02/forecast").json()
    assert body["available"]
    assert body["prior"]["cold_life_h"] == pytest.approx(3.2, rel=0.3)  # learnt from its last trips
    assert body["breach"]["prob"] > 0.8
    assert body["fit"]["one_step_rmse_c"] < 0.4
    assert {b["box_id"] for b in body["boxes"]} == {"BOX-0006", "BOX-0007"}
    lo, mid, hi = body["state"]["effective_cold_life_h"]
    assert lo <= 2.8 <= hi


def test_forecast_is_withheld_on_demo_time(client):
    body = client.get("/api/nodes/DEMO-01/forecast").json()
    assert body["available"] is False


def test_report_carries_verdict_confidence(client, session):
    backfill(session, int(time.time()))
    conf = client.get("/api/boxes/BOX-0002/report").json()["confidence"]
    assert conf["borderline"] and conf["p_use"] + conf["p_quarantine"] + conf["p_discard"] == pytest.approx(1, abs=0.01)
