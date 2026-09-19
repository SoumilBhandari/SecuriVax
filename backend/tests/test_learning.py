"""Crowdsourced calibration: confirmed VVM photos teach the stability model."""

import numpy as np
import pytest
from sqlalchemy import create_engine, inspect, text

from app.engine.learning import Observation, posterior
from app.engine.profiles import PRODUCTS_BY_ID


def photos(k: float, n: int, seed: int = 0, sigma: float = 0.06) -> list[Observation]:
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(n):
        initial, dose = rng.uniform(0, 0.3), rng.uniform(0.1, 0.7)
        truth = initial + rng.normal(0, 0.03) + k * dose
        out.append(Observation(initial, dose, progress=float(truth + rng.normal(0, sigma)), sigma=sigma))
    return out


def test_no_photos_keeps_the_label_curve():
    post = posterior([])
    assert post.photos == 0 and post.scale_used == 1.0
    assert post.sd_log == pytest.approx(0.15, abs=0.005)


@pytest.mark.parametrize("k", [0.8, 1.0, 1.3])
def test_recovers_the_real_speed(k):
    post = posterior(photos(k, 60))
    assert post.median == pytest.approx(k, rel=0.08)
    assert post.p10 < k < post.p90
    assert post.sd_log < 0.06  # far tighter than the 0.15 prior


def test_uses_faster_at_once_and_slower_only_when_sure():
    assert posterior(photos(1.3, 8)).scale_used > 1.1
    weak = posterior(photos(0.9, 2))
    assert weak.scale_used >= 1.0  # a hint of "slower" isn't enough to relax
    strong = posterior(photos(0.75, 60))
    assert 0.75 < strong.scale_used < 1.0 and strong.scale_used >= strong.median


def test_stage_only_answers_count_as_intervals():
    obs = [Observation(0.1, 0.5, stage=3) for _ in range(10)]  # stage 3 means 1.0-1.15: k about 1.9-2.1
    assert posterior(obs).median > 1.6


def test_barely_monitored_boxes_teach_nothing():
    assert posterior([Observation(0.5, 0.01, progress=1.0)]).photos == 0


def test_learned_speed_reaches_the_verdict_engine():
    from dataclasses import replace

    from app.engine.history import Reading, Segment
    from app.engine.verdict import evaluate

    penta = PRODUCTS_BY_ID["penta"]
    seg = [Segment("CAR-01", "Carrier", 0, 48 * 3600, [Reading(t, 30.0) for t in range(0, 48 * 3600 + 1, 1800)])]
    slow = evaluate(penta, seg, now=48 * 3600).budget_used
    fast = evaluate(replace(penta, rate_scale=1.5), seg, now=48 * 3600).budget_used
    assert fast == pytest.approx(slow * 1.5, rel=1e-6)


def test_confirmed_photo_updates_the_product(client):
    from tests.test_vvm import photo_payload

    before = client.get("/api/boxes/learning/summary").json()
    res = client.post("/api/boxes/BOX-0004/vvm", json=photo_payload(1.05)).json()
    done = client.post(f"/api/boxes/BOX-0004/vvm/{res['check_id']}/confirm", json={}).json()
    assert "learned_rate" in done
    after = client.get("/api/boxes/learning/summary").json()
    assert after["photos"] >= before["photos"]


def test_new_columns_are_added_to_an_existing_database(tmp_path):
    from app.db import init_db

    eng = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with eng.begin() as conn:  # a VvmCheck table from before crowdsourced calibration
        conn.execute(text(
            "CREATE TABLE vvmcheck (id INTEGER PRIMARY KEY, box_id VARCHAR, ts INTEGER, progress FLOAT, stage INTEGER,"
            " past_endpoint BOOLEAN, sensor_budget FLOAT, agreement VARCHAR, gemini_stage INTEGER,"
            " gemini_confidence FLOAT, gemini_note VARCHAR, confirmed BOOLEAN, worker_stage INTEGER)"
        ))
    init_db(eng)
    cols = {c["name"] for c in inspect(eng).get_columns("vvmcheck")}
    assert {"rho", "flagged", "nominal_dose", "initial_budget", "sensor_p10"} <= cols


def test_an_agreeing_label_narrows_the_confidence():
    from app.engine.history import Reading, Segment
    from app.engine.uncertainty import verdict_confidence

    spv = PRODUCTS_BY_ID["spikevax"]
    seg = [Segment("N", "Carrier", 0, 3600 * 30, [Reading(t, 5.0) for t in range(0, 3600 * 30 + 1, 900)])]
    alone = verdict_confidence(spv, seg, 0.74, "USE_FIRST", False, now=3600 * 30)
    fused = verdict_confidence(spv, seg, 0.74, "USE_FIRST", False, now=3600 * 30, label_progress=0.70, label_sigma=0.04)
    assert fused.label_fused and fused.confidence > alone.confidence
    assert fused.budget_p90 - fused.budget_p10 < alone.budget_p90 - alone.budget_p10
    # A label far outside every simulated world is a disagreement, not evidence.
    far = verdict_confidence(spv, seg, 0.74, "USE_FIRST", False, now=3600 * 30, label_progress=0.05, label_sigma=0.04)
    assert not far.label_fused
