import pytest

from app.backtest import simulate


@pytest.fixture(scope="module")
def result():
    return simulate.run(days=20, seed=7)


def by_id(result, policy):
    return next(p for p in result["policies"] if p["id"] == policy)


def test_backtest_is_deterministic(result):
    assert simulate.run(days=20, seed=7) == result


def test_every_policy_sees_the_same_trips(result):
    doses = {p["doses"] for p in result["policies"]}
    assert len(doses) == 1
    base = by_id(result, "status_quo")
    for policy in ("alarm_logger", "vialtality"):
        p = by_id(result, policy)
        assert (p["damaged_heat"], p["damaged_freeze"]) == (base["damaged_heat"], base["damaged_freeze"])


def test_alarm_logger_is_safe_but_wasteful_and_vialtality_is_neither(result):
    alarm, ours, today = (by_id(result, p) for p in ("alarm_logger", "vialtality", "status_quo"))
    assert alarm["unsafe_used"] == 0 and alarm["good_discarded"] > 0
    assert ours["good_discarded"] <= alarm["good_discarded"] / 5
    assert ours["unsafe_used"] < today["unsafe_used"]


def test_planning_prevents_damage(result):
    planned, ours = by_id(result, "vialtality_planned"), by_id(result, "vialtality")
    assert planned["damaged_freeze"] < ours["damaged_freeze"]
    assert planned["trips_breached"] < ours["trips_breached"]
    assert planned["road_budget_used"] < ours["road_budget_used"]


def test_every_assumption_is_documented(result):
    assert all(a["note"] or a["name"] == "depart_latest_h" for a in result["assumptions"])
    assert result["weather"]["source"].startswith("Open-Meteo")


def test_impact_endpoint(client):
    body = client.get("/api/impact").json()
    assert {"run", "sweep"} <= body.keys()
    assert body["sweep"]["seeds"] >= 10
