import pytest

from app.engine.arrhenius import activation_energy_kj, t_life_hours
from app.engine.history import MAX_GAP_S, Reading, Segment
from app.engine.profiles import DAY, PRODUCTS_BY_ID, VVM_ANCHORS
from app.engine.verdict import DISCARD, QUARANTINE, USE, evaluate

T0 = 1_780_000_000
PENTA = PRODUCTS_BY_ID["penta"]
OPV = PRODUCTS_BY_ID["opv"]
RDT = PRODUCTS_BY_ID["rdt-malaria"]


def readings(temps, start=T0, step=60, scale=1.0, rh=None):
    return [Reading(start + i * step, t, rh, -0.1, 34.7 + i * 1e-4, scale) for i, t in enumerate(temps)]


def seg(rs, node="CAR-01", start=None, end="last"):
    start = rs[0].ts if start is None else start
    end_ts = rs[-1].ts if end == "last" else end
    return Segment(node, f"Carrier {node}", start, end_ts, rs)


def codes(report):
    return {r.code for r in report.reasons}


# --- Arrhenius ---------------------------------------------------------------

@pytest.mark.parametrize("ref", ["VVM30", "VVM14", "VVM7", "VVM2"])
def test_anchors_reproduce_exactly(ref):
    for temp, hours in VVM_ANCHORS[ref]:
        assert t_life_hours(VVM_ANCHORS[ref], temp) == pytest.approx(hours)


def test_vvm_30_14_7_share_one_activation_energy():
    energies = [activation_energy_kj(VVM_ANCHORS[r]) for r in ("VVM30", "VVM14", "VVM7")]
    assert energies == pytest.approx([energies[0]] * 3, rel=1e-3)
    assert energies[0] == pytest.approx(119, abs=2)


def test_vvm14_lasts_at_least_three_years_in_the_fridge():
    assert t_life_hours(VVM_ANCHORS["VVM14"], 5) >= 3 * 365 * DAY


# --- Verdicts ----------------------------------------------------------------

def test_cold_chain_kept_is_use():
    r = evaluate(PENTA, [seg(readings([5.0] * 12 * 60))], now=T0 + 12 * 3600)
    assert r.verdict == USE
    assert r.budget_used < 0.01
    assert codes(r) == {"ALL_CLEAR"}


def test_budget_exhausted_is_discard():
    # 15 days at 37 C against a 14-day VVM14 budget.
    rs = readings([37.0] * (15 * 24 + 1), step=3600)
    r = evaluate(PENTA, [seg(rs)], now=rs[-1].ts)
    assert r.verdict == DISCARD
    assert r.budget_used == pytest.approx(15 / 14, rel=1e-3)
    assert "BUDGET_EXHAUSTED" in codes(r)


def test_budget_low_is_quarantine_with_vvm_check():
    rs = readings([25.0] * (70 * 24 + 1), step=3600)  # 70 of 90 days at 25 C
    r = evaluate(PENTA, [seg(rs)], now=rs[-1].ts)
    assert r.verdict == QUARANTINE
    assert "BUDGET_LOW" in codes(r)
    assert "VVM" in r.action


def test_initial_budget_carries_over():
    r = evaluate(PENTA, [seg(readings([5.0] * 10))], now=T0 + 600, initial_budget_used=0.8)
    assert r.verdict == QUARANTINE


def test_freeze_quarantines_freeze_sensitive_with_shake_test():
    rs = readings([4.0] * 10 + [-2.0] * 90 + [4.0] * 10)
    r = evaluate(PENTA, [seg(rs)], now=rs[-1].ts)
    assert r.verdict == QUARANTINE
    assert "FREEZE" in codes(r)
    assert "shake test" in r.action


def test_short_freeze_is_below_the_who_alarm():
    rs = readings([4.0] * 10 + [-2.0] * 30 + [4.0] * 10)
    assert evaluate(PENTA, [seg(rs)], now=rs[-1].ts).verdict == USE


def test_freeze_is_tolerated_by_opv():
    rs = readings([4.0] * 10 + [-2.0] * 90 + [4.0] * 10)
    r = evaluate(OPV, [seg(rs)], now=rs[-1].ts)
    assert r.verdict == USE
    assert "FREEZE_TOLERATED" in codes(r)


def test_rdt_freeze_asks_for_positive_control():
    rs = readings([20.0] * 10 + [-3.0] * 120 + [20.0] * 10)
    r = evaluate(RDT, [seg(rs)], now=rs[-1].ts)
    assert r.verdict == QUARANTINE
    assert "positive control" in r.action


def test_gap_in_history_is_quarantine():
    before = readings([5.0] * 10)
    after = readings([5.0] * 10, start=before[-1].ts + 2 * 3600)
    r = evaluate(PENTA, [seg(before + after)], now=after[-1].ts)
    assert r.verdict == QUARANTINE
    assert "HISTORY_GAP" in codes(r)


def test_gap_is_filled_when_offline_data_syncs():
    rs = readings([5.0] * 200)
    r = evaluate(PENTA, [seg(rs[:10] + rs[150:])], now=rs[-1].ts)
    assert "HISTORY_GAP" in codes(r)
    assert evaluate(PENTA, [seg(rs)], now=rs[-1].ts).verdict == USE


def test_silent_node_goes_from_provisional_to_offline():
    rs = readings([5.0] * 10)
    fresh = evaluate(PENTA, [seg(rs, end=None)], now=rs[-1].ts + 5 * 60)
    assert fresh.verdict == USE and fresh.provisional
    stale = evaluate(PENTA, [seg(rs, end=None)], now=rs[-1].ts + MAX_GAP_S + 60)
    assert stale.verdict == QUARANTINE
    assert "NODE_OFFLINE" in codes(stale)


def test_history_is_stitched_across_nodes():
    a = readings([37.0] * 25, step=3600)  # one day at 37 C in the carrier
    b = readings([37.0] * 27, start=a[-1].ts + 3600, step=3600)
    r = evaluate(OPV, [seg(a, "CAR-01"), seg(b, "CAR-02")], now=b[-1].ts)
    assert [s.node_id for s in r.segments] == ["CAR-01", "CAR-02"]
    assert r.segments[0].budget_used == pytest.approx(0.5, rel=1e-3)
    assert r.verdict == DISCARD


def test_reading_just_before_load_covers_the_segment_start():
    rs = readings([5.0] * 10)
    r = evaluate(PENTA, [seg(rs, start=rs[0].ts + 30)], now=rs[-1].ts)
    assert r.segments[0].gaps == []


def test_demo_time_scale_speeds_up_the_budget():
    # 10 real minutes at 1 min = 144 min, i.e. 24 h of product time at 37 C.
    rs = readings([37.0] * 11, scale=144)
    r = evaluate(OPV, [seg(rs)], now=rs[-1].ts)
    assert r.budget_used == pytest.approx(0.5, rel=1e-3)
    assert r.demo_time and r.time_scale == 144


def test_heat_excursion_is_reported_as_advisory():
    rs = readings([5.0] * 10 + [15.0] * 60 + [5.0] * 10)
    r = evaluate(PENTA, [seg(rs)], now=rs[-1].ts)
    assert r.verdict == USE
    assert "HEAT_EXCURSION" in codes(r)


def test_humidity_advisory_only_for_rapid_tests():
    rs = readings([22.0] * (7 * 60), rh=85.0)
    assert "HUMIDITY" in codes(evaluate(RDT, [seg(rs)], now=rs[-1].ts))
    assert "HUMIDITY" not in codes(evaluate(PENTA, [seg(rs)], now=rs[-1].ts))


def test_route_marks_excursion_points():
    rs = readings([5.0, 5.0, 12.0, -1.0])
    route = evaluate(PENTA, [seg(rs)], now=rs[-1].ts).segments[0].route
    assert [p.status for p in route] == ["ok", "ok", "heat", "freeze"]


def test_just_loaded_box_waits_for_first_reading():
    waiting = evaluate(PENTA, [Segment("CAR-01", "Carrier CAR-01", T0, None, [])], now=T0 + 30)
    assert waiting.verdict == USE and waiting.provisional
    silent = evaluate(PENTA, [Segment("CAR-01", "Carrier CAR-01", T0, None, [])], now=T0 + MAX_GAP_S + 1)
    assert "NODE_OFFLINE" in codes(silent)


def test_frozen_packs_are_flagged_right_after_packing():
    rs = readings([4.0, 1.0, -0.4, -1.2, -1.5])
    r = evaluate(PENTA, [seg(rs, end=None)], now=rs[-1].ts + 60)
    assert "PACKS_TOO_COLD" in codes(r)
    assert r.verdict == USE  # a warning, not a verdict: nothing has frozen for an hour yet


def test_guard_band_holds_a_box_that_may_have_frozen_within_sensor_error():
    rs = readings([4.0] * 10 + [-0.3] * 90 + [4.0] * 10)
    r = evaluate(PENTA, [seg(rs)], now=rs[-1].ts)
    assert r.verdict == QUARANTINE and "FREEZE_POSSIBLE" in codes(r)
    assert "shake test" in r.action
    assert evaluate(OPV, [seg(rs)], now=rs[-1].ts).verdict == USE  # OPV isn't freeze-sensitive


def test_guard_band_needs_an_hour_too():
    rs = readings([4.0] * 10 + [-0.3] * 40 + [4.0] * 10)
    assert evaluate(PENTA, [seg(rs)], now=rs[-1].ts).verdict == USE
