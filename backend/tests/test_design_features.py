import time

import pytest

from app.engine.history import Reading, Segment
from app.engine.profiles import PRODUCTS_BY_ID
from app.engine.verdict import evaluate
from simulator.backfill import backfill

T0 = 1_780_000_000
PENTA, OPV = PRODUCTS_BY_ID["penta"], PRODUCTS_BY_ID["opv"]


def seg(temps, step=3600):
    rs = [Reading(T0 + i * step, t, 60.0) for i, t in enumerate(temps)]
    return [Segment("CAR-01", "Carrier CAR-01", T0, rs[-1].ts, rs)]


def test_use_first_between_40_and_75_percent():
    r = evaluate(PENTA, seg([5.0] * 10), now=T0 + 9 * 3600, initial_budget_used=0.5)
    assert r.verdict == "USE_FIRST" and "first" in r.action
    assert evaluate(PENTA, seg([5.0] * 10), now=T0 + 9 * 3600, initial_budget_used=0.2).verdict == "USE"


def test_mean_kinetic_temperature_matches_the_usp_formula():
    # Constant temperature: MKT equals it. Excursions pull MKT above the arithmetic mean.
    assert evaluate(PENTA, seg([5.0] * 25), now=T0 + 24 * 3600).mkt_c == pytest.approx(5.0, abs=0.01)
    r = evaluate(PENTA, seg([5.0] * 20 + [25.0] * 5), now=T0 + 24 * 3600)
    mean = (5 * 19.5 + 25 * 4.5) / 24  # trapezoid-free: interval start temps weighted by 1 h
    assert r.mkt_c > mean
    assert r.peak_c == 25.0 and r.hours_out_of_range == pytest.approx(4, abs=1)


def test_threshold_logger_would_condemn_what_the_budget_saves():
    # 12 h at 9 C: the 30-day-recorder heat alarm fires, but VVM14 barely notices.
    r = evaluate(PENTA, seg([5.0] + [9.0] * 12 + [5.0]), now=T0 + 13 * 3600)
    assert r.logger["alarm"] and r.verdict in ("USE", "USE_FIRST")
    assert r.logger["outcome"] == "SAVED"


def test_silent_failure_no_alarm_fires():
    # Short hot spells, never 10 h in a row: no alarm, but OPV's budget runs out.
    temps = ([5.0] * 3 + [36.0] * 8) * 8
    r = evaluate(OPV, seg(temps), now=T0 + (len(temps) - 1) * 3600, initial_budget_used=0.3)
    assert not r.logger["alarm"] and r.verdict == "DISCARD"
    assert r.logger["outcome"] == "CAUGHT"


def test_scrubber_budget_is_cumulative_and_ends_at_the_total(client, session):
    backfill(session, int(time.time()))
    report = client.get("/api/boxes/BOX-0002/report").json()
    points = [p for s in report["segments"] for p in s["series"]]
    budgets = [p["budget"] for p in points]
    assert budgets == sorted(budgets)
    assert budgets[0] == pytest.approx(report["initial_budget_used"], abs=0.01)
    assert budgets[-1] == pytest.approx(report["budget_used"], abs=0.02)


def test_same_history_different_product(client, session):
    backfill(session, int(time.time()))
    rows = {r["product_id"]: r for r in client.get("/api/boxes/BOX-0005/counterfactual").json()}
    assert rows["opv"]["this_box"] and rows["opv"]["budget_used"] > rows["hpv"]["budget_used"]
    assert len({r["verdict"] for r in rows.values()}) > 1  # the verdict depends on the product


def test_fleet_summary(client, session):
    backfill(session, int(time.time()))
    body = client.get("/api/boxes/fleet/summary").json()
    assert sum(body["counts"].values()) == body["boxes"]
    assert body["doses_tracked"] > 0
    assert body["saved_from_needless_discard"] >= 0 and body["silent_failures_caught"] >= 0
