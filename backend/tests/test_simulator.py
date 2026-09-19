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
