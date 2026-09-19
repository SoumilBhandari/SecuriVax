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


def test_time_between_carriers_is_not_invisible():
    from app.engine.history import Reading, Segment
    from app.engine.profiles import PRODUCTS_BY_ID
    from app.engine.verdict import evaluate

    penta = PRODUCTS_BY_ID["penta"]
    a = Segment("A", "Carrier A", 0, 3600, [Reading(t, 5.0) for t in range(0, 3601, 600)])
    later = lambda start: Segment("B", "Carrier B", start, None, [Reading(t, 5.0) for t in range(start, start + 3601, 600)])  # noqa: E731
    table = evaluate(penta, [a, later(3600 + 3 * 3600)], now=3600 + 4 * 3600)
    gap = next(r for r in table.reasons if r.code == "UNMONITORED")
    assert "3.0 h" in gap.text and "Carrier A" in gap.text  # shown, not silently counted as cold
    brief = evaluate(penta, [a, later(3600 + 30 * 60)], now=3600 + 90 * 60)
    assert brief.verdict == "USE" and any(r.code == "UNMONITORED" for r in brief.reasons)
    handoff = evaluate(penta, [a, later(3600 + 5 * 60)], now=3600 + 65 * 60)
    assert not any(r.code == "UNMONITORED" for r in handoff.reasons)


def test_pack_check_runs_on_product_time():
    """On a demo carrier (time x60) the 45-minute pack check is 45 product
    minutes: a freeze an hour of real time in isn't blamed on the packs."""
    from app.engine.history import Reading, Segment
    from app.engine.profiles import PRODUCTS_BY_ID
    from app.engine.verdict import evaluate

    penta = PRODUCTS_BY_ID["penta"]
    reads = [Reading(t, 5.0, time_scale=60.0) for t in range(0, 600, 30)]
    reads += [Reading(t, -3.0, time_scale=60.0) for t in range(600, 900, 30)]
    r = evaluate(penta, [Segment("D", "Demo", 0, None, reads)], now=900)
    codes = [x.code for x in r.reasons]
    assert "FREEZE" in codes and "PACKS_TOO_COLD" not in codes
