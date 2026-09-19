"""Crowdsourced calibration, wired to the database: confirmed VVM photos in,
a learned degradation speed per product out (see app.engine.learning)."""

import dataclasses
import threading
import time

from sqlmodel import Session, select

from app.engine import learning
from app.engine.profiles import PRODUCTS, PRODUCTS_BY_ID, ProductProfile
from app.engine.vvm import CALIBRATION
from app.models import Box, VvmCheck

TTL_S = 300
_cache: dict[str, tuple[float, learning.RatePosterior]] = {}
_lock = threading.Lock()


def observations(session: Session, product_id: str) -> list[learning.Observation]:
    rows = session.exec(
        select(VvmCheck)
        .join(Box, Box.id == VvmCheck.box_id)
        .where(Box.product_id == product_id, VvmCheck.confirmed, VvmCheck.nominal_dose.is_not(None))
    ).all()
    out = []
    for c in rows:
        if c.worker_stage is not None:  # the worker corrected the camera: trust their stage
            out.append(learning.Observation(c.initial_budget, c.nominal_dose, stage=c.worker_stage))
        else:
            out.append(learning.Observation(c.initial_budget, c.nominal_dose, progress=c.progress, sigma=CALIBRATION.progress_sigma))
    return out


def rate_posterior(session: Session, product_id: str) -> learning.RatePosterior:
    with _lock:
        hit = _cache.get(product_id)
        if hit and time.time() - hit[0] < TTL_S:
            return hit[1]
    post = learning.posterior(observations(session, product_id))
    with _lock:
        _cache[product_id] = (time.time(), post)
    return post


def learned_profile(session: Session, profile: ProductProfile) -> ProductProfile:
    """The product's curve, sped up or slowed down by what field photos taught us."""
    scale = rate_posterior(session, profile.id).scale_used
    return profile if scale == 1.0 else dataclasses.replace(profile, rate_scale=scale)


def profile_for(session: Session, product_id: str) -> ProductProfile:
    return learned_profile(session, PRODUCTS_BY_ID[product_id])


def invalidate(product_id: str | None = None) -> None:
    with _lock:
        if product_id is None:
            _cache.clear()
        else:
            _cache.pop(product_id, None)


def summary(session: Session) -> dict:
    products = []
    for p in PRODUCTS:
        if p.kind != "vaccine":
            continue  # rapid tests have no VVM to learn from
        post = rate_posterior(session, p.id)
        products.append({"product_id": p.id, "name": p.name, **dataclasses.asdict(post)})
    return {
        "products": products,
        "photos": sum(p["photos"] for p in products),
        "prior_sd_log": learning.PRIOR_SD,
        "camera": {"progress_sigma": CALIBRATION.progress_sigma, "calibration": CALIBRATION.source},
    }
