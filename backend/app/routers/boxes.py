import base64
import binascii
import time
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.db import get_session
from app.engine.profiles import PRODUCTS_BY_ID
from app.engine.uncertainty import verdict_confidence
from app.engine.verdict import VERDICT_ORDER, evaluate
from app.engine.vvm import cross_check, open_photo, read_vvm
from app.models import Box, Custody, Facility, LocationPoint, Node, Scan, TextCache, VvmCheck
from app.security import explain_limit, require_operator, vvm_limit
from app.services.auth import signed_in
from app.services.climate import haversine_km
from app.services import learning
from app.services.narrative import build_facts, write_report
from app.services.places import MAX_POINTS, resolve_places
from app.services.report import box_segments, cached_places, counterfactual, evaluate_box, key_points, report_json
from app.services.vvm_vision import gemini_vvm

router = APIRouter(prefix="/api/boxes", tags=["boxes"])


class LoadIn(BaseModel):
    node_id: str = Field(max_length=40)


class UnloadIn(BaseModel):
    note: str = Field("", max_length=200)


class PlaceIn(BaseModel):
    """Where the phone is, from its GPS, when a driver or a clinic scans a box."""

    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    accuracy_m: float | None = Field(None, ge=0, le=100_000)
    facility_id: str | None = Field(None, max_length=40)
    note: str = Field("", max_length=200)


NEAR_KM = 3.0  # a scan this close to a store or clinic is at it


class VvmPhotoIn(BaseModel):
    image: str = Field(description="JPEG/PNG as base64 or a data: URL", max_length=4_000_000)


class VvmConfirmIn(BaseModel):
    # The worker can correct the stage if the camera got it wrong.
    stage: int | None = Field(None, ge=1, le=4)


STAGE_PROGRESS = {1: 0.1, 2: 0.6, 3: 1.0, 4: 1.2}
# A transfer this soon after loading is a mis-tap: undo it rather than keep a
# zero-length leg in the box's history.
RETAP_WINDOW_S = 120


def _box(session: Session, box_id: str) -> Box:
    box = session.get(Box, box_id)
    if box is None:
        raise HTTPException(404, f"no box {box_id}")
    return box


def _open_custody(session: Session, box_id: str) -> Custody | None:
    return session.exec(
        select(Custody).where(Custody.box_id == box_id, Custody.end_ts.is_(None))
    ).first()


def _who(request: Request, session: Session) -> str:
    user = signed_in(request, session)
    return user["name"] if user else "operator code"


def _facility_near(session: Session, body: "PlaceIn") -> Facility | None:
    """The facility named, else the nearest within NEAR_KM of where the phone is."""
    if body.facility_id:
        facility = session.get(Facility, body.facility_id)
        if facility is None:
            raise HTTPException(404, f"no facility {body.facility_id}")
        return facility
    if body.lat is None or body.lon is None:
        return None
    here = (body.lat, body.lon)
    best = min(session.exec(select(Facility)).all(), key=lambda f: haversine_km(here, (f.lat, f.lon)), default=None)
    return best if best and haversine_km(here, (best.lat, best.lon)) <= NEAR_KM else None


def _last_receipt(session: Session, box_id: str) -> Scan | None:
    return session.exec(select(Scan).where(Scan.box_id == box_id, Scan.action == "receive").order_by(Scan.ts.desc())).first()


def _summaries(session: Session) -> list[dict]:
    out = []
    for box in session.exec(select(Box).order_by(Box.id)).all():
        report = evaluate_box(session, box)
        custody = _open_custody(session, box.id)
        # For the shipments map: where the trip started and where the box was
        # last seen (its carrier now, or where it was delivered). None when no
        # reading carried a position.
        located = [s for s in report.segments if s.end_lat is not None]
        received = _last_receipt(session, box.id) if not custody else None
        out.append({
            **box.model_dump(),
            "product_name": PRODUCTS_BY_ID[box.product_id].name,
            "product_kind": PRODUCTS_BY_ID[box.product_id].kind,
            "current_node_id": custody.node_id if custody else None,
            "verdict": report.verdict,
            "budget_used": report.budget_used,
            "mkt_c": report.mkt_c,
            "logger_outcome": report.logger.get("outcome"),
            "status": "In transit" if custody else "Received" if received else "Delivered" if report.segments else "Not dispatched",
            "lat": located[-1].end_lat if located else None,
            "lon": located[-1].end_lon if located else None,
            "from_lat": located[0].start_lat if located else None,
            "from_lon": located[0].start_lon if located else None,
        })
    return out


@router.get("")
def list_boxes(session: Session = Depends(get_session)) -> list[dict]:
    return _summaries(session)


@router.get("/fleet/summary")
def fleet_summary(session: Session = Depends(get_session)) -> dict:
    """Verdict counts and what product-aware verdicts change versus a threshold logger."""
    boxes = _summaries(session)
    counts = {v: 0 for v in VERDICT_ORDER}
    for b in boxes:
        counts[b["verdict"]] += 1
    doses = lambda outcome: sum(b["quantity"] for b in boxes if b["logger_outcome"] == outcome)  # noqa: E731
    return {
        "boxes": len(boxes),
        "counts": counts,
        "doses_tracked": sum(b["quantity"] for b in boxes),
        "saved_from_needless_discard": doses("SAVED"),
        "silent_failures_caught": doses("CAUGHT"),
    }


@router.get("/{box_id}/counterfactual")
def box_counterfactual(box_id: str, session: Session = Depends(get_session)) -> list[dict]:
    """Same thermal history, different product."""
    return counterfactual(session, _box(session, box_id))


@router.get("/{box_id}/report")
def box_report(box_id: str, session: Session = Depends(get_session)) -> dict:
    return report_json(session, _box(session, box_id))


# A box's written report is reused this long unless its verdict changes. The
# report's facts move with every reading (hours in the carrier), so without this
# each open or refresh of a box on the road was a new Grok call, plus Gemini
# place lookups: the public page could spend the AI credits for anyone.
REPORT_TTL_S = 30 * 60


@router.post("/{box_id}/explain", dependencies=[Depends(explain_limit)])
async def explain_box(box_id: str, session: Session = Depends(get_session)) -> dict:
    """Gemini names the places, then Grok writes the worker-facing report."""
    box = _box(session, box_id)
    report = await run_in_threadpool(evaluate_box, session, box)
    now = int(time.time())
    recent_key = f"report-box:{box.id}:{report.verdict}"
    recent = session.get(TextCache, recent_key)
    if recent and now - recent.created_at < REPORT_TTL_S:
        points = key_points(report)
        places = cached_places(session, points)
        return {
            "verdict": report.verdict, "text": recent.text, "source": recent.source, "places": places,
            "places_source": "gemini" if places and len(places) >= min(len(points), MAX_POINTS) else "mixed" if places else "coords",
        }
    places, places_source = await resolve_places(session, key_points(report))
    facts = build_facts(box, PRODUCTS_BY_ID[box.product_id], report, places)
    text, source = await write_report(session, facts)
    if source == "grok":  # a fallback template is never kept: the next open retries
        session.merge(TextCache(key=recent_key, kind="report", text=text, source=source, created_at=now))
        session.commit()
    return {
        "verdict": report.verdict,
        "text": text,
        "source": source,
        "places": places,
        "places_source": places_source,
    }


@router.post("/{box_id}/load", dependencies=[Depends(require_operator)])
def load_box(box_id: str, body: LoadIn, session: Session = Depends(get_session)) -> dict:
    """Put a box into a node. Loading into a different node is a transfer."""
    _box(session, box_id)
    if session.get(Node, body.node_id) is None:
        raise HTTPException(404, f"no node {body.node_id}")
    now = int(time.time())
    current = _open_custody(session, box_id)
    if current and current.node_id == body.node_id:
        return {"status": "already_loaded", "node_id": body.node_id}
    action = "load"
    if current and now - current.start_ts <= RETAP_WINDOW_S:
        session.delete(current)  # wrong carrier tapped a moment ago
        session.flush()
        action = "retap"
    elif current:
        current.end_ts = now
        current.end_note = f"transferred to {body.node_id}"
        session.add(current)
        session.flush()
        action = "transfer"
    session.add(Custody(box_id=box_id, node_id=body.node_id, start_ts=now))
    session.add(Scan(box_id=box_id, node_id=body.node_id, action=action, ts=now))
    try:
        session.commit()
    except IntegrityError:
        # Two taps raced (NFC reads twice): the other one already loaded it.
        session.rollback()
        current = _open_custody(session, box_id)
        return {"status": "already_loaded", "node_id": current.node_id if current else body.node_id}
    return {"status": "loaded", "action": action, "node_id": body.node_id}


@router.post("/{box_id}/unload", dependencies=[Depends(require_operator)])
def unload_box(box_id: str, body: UnloadIn, session: Session = Depends(get_session)) -> dict:
    _box(session, box_id)
    current = _open_custody(session, box_id)
    if current is None:
        return {"status": "not_loaded"}
    now = int(time.time())
    current.end_ts = now
    current.end_note = body.note
    session.add(current)
    session.add(Scan(box_id=box_id, node_id=current.node_id, action="unload", ts=now, note=body.note))
    session.commit()
    return {"status": "unloaded", "node_id": current.node_id}


@router.post("/{box_id}/checkpoint", dependencies=[Depends(require_operator)])
def checkpoint(box_id: str, body: PlaceIn, request: Request, session: Session = Depends(get_session)) -> dict:
    """A driver taps the box's NFC sticker on the way: where it is, when, and who
    saw it. The position also counts as the carrier's, so the route and the map
    follow the box even when its node has no GPS."""
    _box(session, box_id)
    now = int(time.time())
    custody = _open_custody(session, box_id)
    facility = _facility_near(session, body)
    session.add(Scan(box_id=box_id, node_id=custody.node_id if custody else None, action="checkpoint", ts=now,
                     note=body.note, lat=body.lat, lon=body.lon, facility_id=facility.id if facility else None,
                     by=_who(request, session)))
    if custody and body.lat is not None and body.lon is not None:
        session.add(LocationPoint(node_id=custody.node_id, ts=now, lat=body.lat, lon=body.lon,
                                  accuracy_m=body.accuracy_m, source="checkpoint"))
    session.commit()
    return {"status": "logged", "facility": facility.name if facility else None, "node_id": custody.node_id if custody else None}


@router.post("/{box_id}/receive", dependencies=[Depends(require_operator)])
def receive(box_id: str, body: PlaceIn, request: Request, session: Session = Depends(get_session)) -> dict:
    """The clinic scans the box's QR code to pick it up: its trip ends here, and
    the pickup (where, when, who) goes into its history."""
    _box(session, box_id)
    now = int(time.time())
    facility = _facility_near(session, body)
    where = facility.name if facility else "the clinic"
    custody = _open_custody(session, box_id)
    if custody:
        custody.end_ts = now
        custody.end_note = f"picked up at {where}"
        session.add(custody)
    session.add(Scan(box_id=box_id, node_id=custody.node_id if custody else None, action="receive", ts=now,
                     note=body.note, lat=body.lat, lon=body.lon, facility_id=facility.id if facility else None,
                     by=_who(request, session)))
    session.commit()
    return {"status": "received", "facility": facility.name if facility else None, "from_node": custody.node_id if custody else None}


@router.post("/{box_id}/vvm", dependencies=[Depends(require_operator), Depends(vvm_limit)])
async def check_vvm(box_id: str, body: VvmPhotoIn, session: Session = Depends(get_session)) -> dict:
    """Read the vial's VVM from a photo and compare it with our sensor record."""
    box = _box(session, box_id)
    raw = body.image.split(",", 1)[1] if body.image.startswith("data:") else body.image
    try:
        jpeg = base64.b64decode(raw, validate=True)
        image = await run_in_threadpool(open_photo, jpeg)
    except (ValueError, binascii.Error, UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise HTTPException(400, "not a usable photo (JPEG, PNG or WebP, under 40 megapixels)") from exc

    reading = await run_in_threadpool(read_vvm, image)
    gemini = await gemini_vvm(jpeg)
    if not reading.found:
        _save_photo(jpeg, f"notfound_{int(time.time())}_{box_id}", {"reading": asdict(reading), "gemini": gemini})
        return {"found": False, "message": reading.message, "gemini": gemini}

    record = await run_in_threadpool(_record_prediction, session, box)
    witnesses = cross_check(
        reading.progress, reading.stage, record["budget"], record["p10"], record["p90"], rho=reading.rho
    )
    check = VvmCheck(
        box_id=box_id, progress=reading.progress, stage=reading.stage, past_endpoint=reading.past_endpoint,
        sensor_budget=round(record["budget"], 4), agreement=witnesses.code, rho=reading.rho,
        flagged=witnesses.flagged, predicted_stage=witnesses.predicted_stage,
        sensor_p10=record["p10"], sensor_p90=record["p90"],
        initial_budget=box.initial_budget_used, nominal_dose=record["nominal_dose"],
        gemini_stage=(gemini or {}).get("stage"), gemini_confidence=(gemini or {}).get("confidence"),
        gemini_note=(gemini or {}).get("note", "")[:200],
    )
    session.add(check)
    session.commit()
    session.refresh(check)
    _save_photo(jpeg, f"check{check.id}_{box_id}", {"reading": asdict(reading), "witnesses": asdict(witnesses), "gemini": gemini})
    return {"found": True, "check_id": check.id, "reading": asdict(reading), "witnesses": asdict(witnesses), "gemini": gemini}


def _save_photo(jpeg: bytes, name: str, meta: dict) -> None:
    """Dev only (VVM_SAVE_DIR): keep the photo and what the reader made of it."""
    folder = get_settings().vvm_save_dir
    if not folder:
        return
    import json
    from pathlib import Path

    out = Path(folder)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{name}.jpg").write_bytes(jpeg)
    (out / f"{name}.json").write_text(json.dumps(meta, indent=1, default=str))


def _label_saved_photo(check_id: int, box_id: str, stage: int) -> None:
    """Once a person confirms the stage, file a copy as labelled data."""
    folder = get_settings().vvm_save_dir
    if not folder:
        return
    import shutil
    from pathlib import Path

    src = Path(folder) / f"check{check_id}_{box_id}.jpg"
    if src.is_file():
        (Path(folder) / "labelled").mkdir(exist_ok=True)
        shutil.copyfile(src, Path(folder) / "labelled" / f"stage{stage}_{check_id}.jpg")


def _record_prediction(session: Session, box: Box) -> dict:
    """What the temperature record predicts the label shows: the budget (with
    its Monte Carlo range), plus the dose at the label's nominal speed, which a
    confirmed photo turns into a lesson about the real speed."""
    now = int(time.time())
    segments = box_segments(session, box.id, now)
    profile = learning.profile_for(session, box.product_id)
    report = evaluate(profile, segments, now, box.initial_budget_used)
    conf = verdict_confidence(
        profile, segments, box.initial_budget_used, report.verdict, False, now=now,
        rate_spread=learning.rate_posterior(session, box.product_id).sd_log,
    )
    nominal = evaluate(PRODUCTS_BY_ID[box.product_id], segments, now, box.initial_budget_used)
    return {
        "budget": report.budget_used,
        "p10": conf.budget_p10,
        "p90": conf.budget_p90,
        # Demo-time boxes run on accelerated clocks: their labels teach nothing.
        "nominal_dose": None if report.demo_time else round(nominal.budget_used - box.initial_budget_used, 5),
    }


@router.post("/{box_id}/vvm/{check_id}/confirm", dependencies=[Depends(require_operator)])
def confirm_vvm(box_id: str, check_id: int, body: VvmConfirmIn, session: Session = Depends(get_session)) -> dict:
    """A person confirms (or corrects) the reading; only then does it count."""
    check = session.get(VvmCheck, check_id)
    if check is None or check.box_id != box_id:
        raise HTTPException(404, "no such check")
    if body.stage is not None and body.stage != check.stage:
        check.worker_stage = body.stage
        check.stage = body.stage
        check.progress = STAGE_PROGRESS[body.stage]
        check.past_endpoint = body.stage >= 3
        w = cross_check(check.progress, check.stage, check.sensor_budget, check.sensor_p10, check.sensor_p90)
        check.agreement, check.flagged, check.predicted_stage = w.code, w.flagged, w.predicted_stage
    check.confirmed = True
    session.add(check)
    session.commit()
    _label_saved_photo(check.id, box_id, check.stage)
    # Crowdsourced calibration: this photo is now evidence about the product's real speed.
    product_id = session.get(Box, box_id).product_id
    learning.invalidate(product_id)
    learned = learning.rate_posterior(session, product_id)
    return {
        "confirmed": True, "stage": check.stage, "past_endpoint": check.past_endpoint,
        "flagged": check.flagged, "learned_rate": asdict(learned),
    }


@router.get("/learning/summary")
def learning_summary(session: Session = Depends(get_session)) -> dict:
    """What confirmed VVM photos have taught the stability model so far."""
    return learning.summary(session)
