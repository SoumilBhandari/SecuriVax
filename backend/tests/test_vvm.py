import base64
import io
import time

import numpy as np
import pytest
from PIL import Image, ImageDraw

from app.engine.history import Reading, Segment
from app.engine.profiles import PRODUCTS_BY_ID
from app.engine.verdict import LabelCheck, evaluate
from app.engine.vvm import compare, read_vvm

PAPER = np.array([236, 231, 220])
CIRCLE = np.array([72, 52, 112])


def vvm_photo(progress: float, size=320, radius=80, offset=(12, -9), glare=0.12, seed=0) -> Image.Image:
    """A VVM label photographed on a phone: off-centre, uneven light, noise, JPEG."""
    rng = np.random.default_rng(seed)
    img = Image.new("RGB", (size, size), tuple(PAPER))
    d = ImageDraw.Draw(img)
    cx, cy = size / 2 + offset[0], size / 2 + offset[1]
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=tuple(CIRCLE))
    # Linear in progress, past the circle's shade for progress > 1.
    square = np.clip(PAPER + (CIRCLE - PAPER) * progress, 0, 255)
    half = 0.6 * radius
    d.rectangle([cx - half, cy - half, cx + half, cy + half], fill=tuple(int(v) for v in square))
    d.text((8, size - 24), "OPV lot OP-2604", fill=(30, 30, 30))
    arr = np.asarray(img, dtype=float)
    light = 1 - glare * np.linspace(0, 1, size)[None, :, None]  # light falls off across the label
    arr = np.clip(arr * light + rng.normal(0, 4, arr.shape), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "JPEG", quality=80)
    return Image.open(io.BytesIO(buf.getvalue()))


@pytest.mark.parametrize("truth", [0.0, 0.3, 0.6, 0.85, 1.0, 1.2])
def test_reads_vvm_progress_from_a_messy_photo(truth):
    r = read_vvm(vvm_photo(truth))
    assert r.found
    assert r.progress == pytest.approx(truth, abs=0.1)


def test_stage_and_end_point():
    assert read_vvm(vvm_photo(0.1)).stage == 1
    assert read_vvm(vvm_photo(0.6)).stage == 2
    fresh, spent = read_vvm(vvm_photo(0.5)), read_vvm(vvm_photo(1.0))
    assert not fresh.past_endpoint and spent.past_endpoint


def test_works_at_different_scales_and_positions():
    for radius, offset in ((45, (0, 0)), (110, (-20, 15)), (70, (30, 25))):
        r = read_vvm(vvm_photo(0.6, radius=radius, offset=offset))
        assert r.found and r.progress == pytest.approx(0.6, abs=0.1)


def test_no_vvm_in_the_picture():
    blank = Image.new("RGB", (300, 300), (230, 228, 220))
    assert not read_vvm(blank).found


def test_two_witnesses():
    assert compare(0.55, 0.5).code == "AGREE"
    assert compare(0.9, 0.3).code == "LABEL_AHEAD"
    assert compare(0.1, 0.7).code == "SENSOR_AHEAD"


def test_label_at_discard_point_overrides_a_clean_sensor_record():
    seg = [Segment("CAR-01", "Carrier CAR-01", 0, 3600, [Reading(0, 5.0), Reading(3600, 5.0)])]
    penta = PRODUCTS_BY_ID["penta"]
    assert evaluate(penta, seg, now=3600).verdict == "USE"
    spent = evaluate(penta, seg, now=3600, label=LabelCheck(3600, 1.0, True))
    assert spent.verdict == "DISCARD" and spent.reasons[0].code == "VVM_PAST_ENDPOINT"
    close = evaluate(penta, seg, now=3600, label=LabelCheck(3600, 0.8, False))
    assert close.verdict == "QUARANTINE"


# --- API ---------------------------------------------------------------------

def photo_payload(progress: float) -> dict:
    buf = io.BytesIO()
    vvm_photo(progress).save(buf, "JPEG")
    return {"image": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}


def test_camera_check_then_confirm_changes_the_verdict(client, session):
    res = client.post("/api/boxes/BOX-0004/vvm", json=photo_payload(1.05)).json()
    assert res["found"] and res["reading"]["past_endpoint"]
    assert res["witnesses"]["code"] == "LABEL_AHEAD"
    # Not confirmed yet: the verdict doesn't move.
    assert client.get("/api/boxes/BOX-0004/report").json()["verdict"] == "USE"
    client.post(f"/api/boxes/BOX-0004/vvm/{res['check_id']}/confirm", json={})
    report = client.get("/api/boxes/BOX-0004/report").json()
    assert report["verdict"] == "DISCARD" and report["label_check"]["confirmed"]
    assert report["confidence"]["confidence"] == 1.0


def test_worker_can_correct_the_camera(client):
    res = client.post("/api/boxes/BOX-0004/vvm", json=photo_payload(1.05)).json()
    client.post(f"/api/boxes/BOX-0004/vvm/{res['check_id']}/confirm", json={"stage": 2})
    assert client.get("/api/boxes/BOX-0004/report").json()["verdict"] == "USE"


def test_bad_uploads(client):
    assert client.post("/api/boxes/BOX-0004/vvm", json={"image": "bm90IGFuIGltYWdl"}).status_code == 400
    blank = io.BytesIO()
    Image.new("RGB", (200, 200), (230, 230, 230)).save(blank, "JPEG")
    body = client.post("/api/boxes/BOX-0004/vvm", json={"image": base64.b64encode(blank.getvalue()).decode()}).json()
    assert body["found"] is False

