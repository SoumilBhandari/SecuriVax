import time

from sqlmodel import select

from app.models import Box
from app.services.report import evaluate_box
from simulator.backfill import backfill

EXPECTED = {
    "BOX-0001": "QUARANTINE",
    "BOX-0002": "QUARANTINE",
    "BOX-0003": "USE",
    "BOX-0004": "USE",
    "BOX-0005": "DISCARD",
    "BOX-0101": "USE",
    "BOX-0102": "USE",
}


def test_backfill_tells_each_boxs_story(session):
    now = int(time.time())
    backfill(session, now)
    verdicts = {b.id: evaluate_box(session, b, now) for b in session.exec(select(Box)).all()}
    assert {k: verdicts[k].verdict for k in EXPECTED} == EXPECTED
    # Delivered two hours ago: the freeze decides, and the report says monitoring stopped.
    assert {r.code for r in verdicts["BOX-0001"].reasons} == {"FREEZE", "UNMONITORED"}
    assert "FREEZE_TOLERATED" in {r.code for r in verdicts["BOX-0003"].reasons}
    assert "BUDGET_LOW" in {r.code for r in verdicts["BOX-0002"].reasons}
    assert {"HUMIDITY", "HEAT_EXCURSION"} <= {r.code for r in verdicts["BOX-0101"].reasons}

    seg = verdicts["BOX-0004"].segments[0]
    assert seg.located_by == "smarttag" and len(seg.route) > 30


def test_demo_lanes_stay_live():
    """An hour after seeding, keep_alive brings every lane carrier holding a box
    up to date, and leaves the stage carrier (a real node) alone."""
    import random

    from sqlmodel import Session, select

    from app.db import init_db, make_engine
    from app.models import Node, Reading
    from app.seed import seed
    from simulator.backfill import backfill
    from simulator.lanes import keep_alive

    eng = make_engine("sqlite://")
    init_db(eng)
    with Session(eng) as session:
        seed(session, "lanes")
        now = int(time.time())
        backfill(session, now, "lanes")
        later = now + 3600
        written = keep_alive(session, later, random.Random(1))
        assert written > 0
        truck = session.get(Node, "TZ-TRK")
        assert later - truck.last_seen_at < 600  # online again
        assert not session.exec(select(Reading).where(Reading.node_id == "DEMO-01")).all()
        assert keep_alive(session, later, random.Random(1)) == 0  # nothing new to add
