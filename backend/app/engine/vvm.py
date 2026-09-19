"""Read a vaccine vial monitor (VVM) from a photo, and cross-check it.

A VVM is a coloured circle with a heat-sensitive square inside. The square
starts lighter than the circle and darkens with cumulative heat; when it
matches the circle, the vial has reached its discard point. That is the same
quantity our sensor budget estimates, so the label is a second, independent
witness to the box's heat history.

The measurement is a ratio:

    rho = L_s / L_r

L_s is the mean brightness of the inner square, L_r of the outer ring, as the
camera records them. Brighter or dimmer light scales every pixel by about the
same factor (camera brightness is a power of the light, so a scale stays a
scale), and the ratio cancels it: the same label reads the same rho in shade
or sun. Glare is different: it adds light, so it is detected and refused.

rho > 1 (square lighter than the ring) is usable; rho <= 1 is the discard
point. The cutoffs are calibrated from labelled photos (evals/calibrate_vvm.py
writes vvm_calibration.json), and the discard cutoff is never closer to 1
than photo noise allows (1.02).

Cross-check: our temperature record predicts where the label should be
(budget used = VVM progress, since the budget uses the VVM's own Arrhenius
curve). If the camera and the logger disagree by more than both of their
uncertainties allow, the check is flagged.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

MAX_SIDE = 400
# Refuse anything bigger than a very large phone photo before decoding it.
MAX_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
# Used by the backtest's camera model: progress at which the label reads spent.
ENDPOINT_AT = 0.92
MIN_CONTRAST = 35.0  # grey levels between label paper and circle
GLARE_SHARE = 0.02  # saturated pixels on the label above this: ask for a retake
TRIM = 0.2  # trimmed mean: drop this share at each end (specks, the square's corners)

# Stage boundaries in progress (0 fresh, 1 = square matches the circle).
STAGE_1_BELOW = 0.25
STAGE_4_FROM = 1.15
LABEL_SATURATES = 1.2  # beyond this a label looks the same however much more heat it takes

CALIBRATION_FILE = Path(__file__).with_name("vvm_calibration.json")


@dataclass
class Calibration:
    """Stage cutoffs on rho, fitted from labelled photos."""

    stage12: float = 2.2  # rho at or above: stage 1 (when the paper isn't visible)
    stage12_progress: float = 0.25  # paper-normalised progress below: stage 1
    discard: float = 1.02  # rho at or below: discard point (stage 3 or 4)
    stage34: float = 0.85  # rho at or below: stage 4
    rho_fresh: float = 3.5  # typical rho of an unheated label (paper-white square)
    rho_sigma: float = 0.05  # spread of rho for one label across photos
    progress_sigma: float = 0.08  # camera progress error, for the cross-check
    progress_bias: float = 0.0  # raw progress reads p + bias x (1 - p): paper read slightly bright
    source: str = "defaults (not calibrated)"
    photos: int = 0
    held_out: dict = field(default_factory=dict)


def load_calibration(path: Path = CALIBRATION_FILE) -> Calibration:
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return Calibration()
    known = Calibration.__dataclass_fields__
    return Calibration(**{k: v for k, v in data.items() if k in known})


CALIBRATION = load_calibration()


@dataclass
class VvmReading:
    found: bool
    message: str
    rho: float | None = None  # L_s / L_r
    progress: float | None = None  # 0 fresh .. 1 discard point
    stage: int | None = None  # 1 fresh, 2 in use, 3 discard point, 4 beyond
    past_endpoint: bool | None = None
    near_cutoff: bool | None = None  # within 2 sigma of the discard cutoff
    square_l: float | None = None  # mean brightness, 0..255
    ring_l: float | None = None
    paper_l: float | None = None
    center: tuple[float, float] | None = None
    radius_px: float | None = None


def stage_for(progress: float) -> int:
    """Stage from progress (the logger's prediction, or a known truth)."""
    if progress < STAGE_1_BELOW:
        return 1
    if progress < 1.0:
        return 2
    if progress < STAGE_4_FROM:
        return 3
    return 4


def stage_for_rho(rho: float, cal: Calibration = CALIBRATION, raw_progress: float | None = None) -> int:
    """Stage from the ratio. The discard side is rho alone; within the usable
    side, fresh vs in-use is graded on paper-normalised progress when the
    paper is visible (faded print squeezes rho; the paper undoes that)."""
    if rho > cal.discard:
        if raw_progress is not None:
            return 1 if raw_progress < cal.stage12_progress else 2
        return 1 if rho >= cal.stage12 else 2
    if rho > cal.stage34:
        return 3
    return 4


def rho_for(progress: float, cal: Calibration = CALIBRATION) -> float:
    """The rho a label at this progress should show (inverse of the progress map)."""
    return cal.rho_fresh - progress * (cal.rho_fresh - 1)


def unbias(raw: float, cal: Calibration = CALIBRATION) -> float:
    """Undo the calibrated bias: raw = p + b(1 - p), so p = (raw - b) / (1 - b)."""
    return (raw - cal.progress_bias) / (1 - cal.progress_bias)


def _otsu(values: np.ndarray) -> float:
    hist, edges = np.histogram(values, bins=64, range=(0, 255))
    centers = (edges[:-1] + edges[1:]) / 2
    w = np.cumsum(hist)
    m = np.cumsum(hist * centers)
    total, mean_all = w[-1], m[-1]
    w0, w1 = w[:-1], total - w[:-1]
    valid = (w0 > 0) & (w1 > 0)
    between = np.zeros_like(w0, dtype=float)
    between[valid] = (mean_all * w0[valid] - m[:-1][valid] * total) ** 2 / (w0[valid] * w1[valid])
    return float(centers[np.argmax(between)])


def _trimmed_mean(values: np.ndarray, trim: float = TRIM) -> float:
    v = np.sort(values.ravel())
    k = int(len(v) * trim)
    return float(v[k : len(v) - k].mean()) if len(v) > 2 * k else float(v.mean())


def open_photo(data: bytes) -> Image.Image:
    """Decode an uploaded photo safely: known formats only, size checked from
    the header before any pixels are decoded, shrunk while decoding."""
    import io

    image = Image.open(io.BytesIO(data), formats=["JPEG", "PNG", "WEBP"])
    w, h = image.size
    if w * h > MAX_PIXELS or max(w, h) > 12_000:
        raise ValueError("photo too large")
    if image.format == "JPEG":
        image.draft("RGB", (MAX_SIDE * 2, MAX_SIDE * 2))
    image.load()
    return image


def read_vvm(image: Image.Image, cal: Calibration | None = None) -> VvmReading:
    cal = cal or CALIBRATION
    img = image.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    img = ImageOps.exif_transpose(img)
    rgb = np.asarray(img, dtype=float)
    lum = rgb @ np.array([0.299, 0.587, 0.114])  # brightness as the camera records it
    h, w = lum.shape

    border = max(2, int(min(h, w) * 0.06))
    edge = np.concatenate([lum[:border].ravel(), lum[-border:].ravel(), lum[:, :border].ravel(), lum[:, -border:].ravel()])
    background = float(np.median(edge))
    # Clip at the paper level so a bright glare spot can't hijack the threshold.
    dark = lum < _otsu(np.minimum(lum, background + 5))
    if background - float(np.median(lum[dark])) < MIN_CONTRAST if dark.any() else True:
        return VvmReading(False, "Couldn't find a VVM: line the label up inside the circle and hold steady.")

    # Centre: centroid of dark pixels, re-centred inside a shrinking window so
    # text elsewhere on the label doesn't pull it away.
    ys, xs = np.nonzero(dark)
    cy, cx, win = h / 2, w / 2, min(h, w) * 0.45
    for _ in range(4):
        near = (ys - cy) ** 2 + (xs - cx) ** 2 <= win**2
        if near.sum() < 50:
            return VvmReading(False, "Couldn't find a VVM near the centre of the circle.")
        cy, cx = ys[near].mean(), xs[near].mean()
        win *= 0.85

    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.hypot(yy - cy, xx - cx)
    angle = np.degrees(np.arctan2(yy - cy, xx - cx)) % 90
    # Radius: walk outward along the axes (clear of the square's corners). The
    # dark band starts at the centre (dark square) or at the square's edge
    # (light square); the circle ends where the band does.
    on_axis = (angle < 15) | (angle > 75)
    radius, in_band = None, False
    for r in np.arange(2, min(h, w) / 2, 1.0):
        ring = on_axis & (np.abs(dist - r) < 1.0)
        if ring.sum() < 8:
            continue
        is_dark = dark[ring].mean() >= 0.5
        if is_dark:
            in_band = True
        elif in_band:
            radius = r
            break
    if radius is None or radius < 15:
        return VvmReading(False, "The VVM is too small or cut off: move closer so it fills the circle.")

    # Glare adds light instead of multiplying it, so the ratio can't cancel it,
    # and it makes a spent square look fresh: never measure through it.
    disc = dist <= radius
    saturated = rgb.min(axis=2) >= 245  # glare is white: every channel clipped
    if saturated[disc].mean() > GLARE_SHARE:
        return VvmReading(False, "Glare on the label: tilt the phone a little and try again.")

    # The two regions of the ratio. The square's core (inside the square at any
    # rotation) and a thin ring just inside the circle's edge; the trimmed mean
    # drops the few ring pixels a rotated square's corners reach.
    square = (np.abs(yy - cy) <= 0.28 * radius) & (np.abs(xx - cx) <= 0.28 * radius)
    ring = (dist >= 0.84 * radius) & (dist <= 0.94 * radius)
    paper = (dist >= 1.2 * radius) & (dist <= 1.6 * radius)
    if paper.sum() > 200:  # paper right around the circle (upper percentile: a squashed circle can dip in)
        background = float(np.percentile(lum[paper], 75))
    circle_lum = float(np.median(lum[ring & on_axis])) if (ring & on_axis).any() else float(np.median(lum[ring]))
    contrast = background - circle_lum
    if (np.mean(lum[square] > background + 25) > 0.15 or _uneven(lum, yy, xx, cy, cx, radius, contrast)
            or _domed(lum, square, dist, radius, contrast)):
        return VvmReading(False, "Glare on the label: tilt the phone a little and try again.")
    if contrast < MIN_CONTRAST:
        return VvmReading(False, "Not enough contrast: move to better light or avoid glare.")

    l_s = _trimmed_mean(lum[square])
    l_r = _trimmed_mean(lum[ring])
    rho = l_s / max(l_r, 1.0)
    l_p = background if paper.sum() > 200 else None
    rho0 = l_p / max(l_r, 1.0) if l_p is not None else None
    raw = (rho0 - rho) / (rho0 - 1) if rho0 is not None and rho0 >= 1.2 and rho0 > rho else None
    if raw is not None:
        raw = unbias(raw, cal)
    if raw is None:  # paper not usable: fall back to the calibrated fresh ratio
        rho0 = max(cal.rho_fresh, rho + 1e-3)
    progress = raw if raw is not None else (rho0 - rho) / (rho0 - 1)

    stage = stage_for_rho(rho, cal, raw)
    past = rho <= cal.discard
    # The ratio decides which side of the discard point the label is on; the
    # paper-referenced progress only grades it within that side.
    progress = max(progress, 1.0) if past else min(progress, 0.99)
    if stage == 1:
        progress = min(progress, cal.stage12_progress)
    elif stage == 2:
        progress = max(progress, cal.stage12_progress)
    return VvmReading(
        found=True,
        message="Read the VVM.",
        rho=round(rho, 3),
        progress=round(max(progress, 0.0), 3),
        stage=stage,
        past_endpoint=past,
        near_cutoff=abs(rho - cal.discard) < 2 * cal.rho_sigma,
        square_l=round(l_s, 1),
        ring_l=round(l_r, 1),
        paper_l=None if l_p is None else round(l_p, 1),
        center=(round(float(cx), 1), round(float(cy), 1)),
        radius_px=round(float(radius), 1),
    )


UNEVEN_AT = 0.35  # brightness spread across the square, as a share of the contrast
# A glare blob centred on the square lifts it evenly, so the quadrants agree,
# but it is brightest in the middle. Flat ink never is: on clean photos the
# centre is at most ~1.4% of the contrast brighter than the square's edge.
DOME_AT = 0.04


def _domed(lum, square, dist, radius, contrast) -> bool:
    if contrast <= 0:
        return True
    core = dist <= 0.1 * radius
    rim = square & (dist >= 0.2 * radius)
    if core.sum() < 5 or rim.sum() < 5:
        return False
    return (float(np.median(lum[core])) - float(np.median(lum[rim]))) / contrast > DOME_AT


def _uneven(lum, yy, xx, cy, cx, radius, contrast) -> bool:
    """The heat-sensitive square is one flat colour. If its four quarters differ a
    lot in brightness, glare or a shadow is lying across it: don't trust it.
    (The core sampled here stays inside the square at any rotation.)"""
    if contrast <= 0:
        return True
    half = 0.28 * radius
    core = (np.abs(yy - cy) <= half) & (np.abs(xx - cx) <= half)
    quads = []
    for sy in (-1, 1):
        for sx in (-1, 1):
            m = core & (np.sign(yy - cy) == sy) & (np.sign(xx - cx) == sx)
            if m.sum() > 4:
                quads.append(float(np.median(lum[m])))
    return len(quads) == 4 and (max(quads) - min(quads)) / contrast > UNEVEN_AT


# --- Cross-check: camera vs logger ------------------------------------------------


@dataclass
class Witnesses:
    code: str  # AGREE | LABEL_AHEAD | SENSOR_AHEAD
    flagged: bool
    text: str
    label: float  # camera progress
    sensor: float  # logger budget (P50)
    camera_stage: int
    predicted_stage: int
    predicted_stages: tuple[int, int]  # stages the logger's P10..P90 budget spans
    sensor_range: tuple[float, float]  # logger budget P10..P90
    rho: float | None = None
    predicted_rho: float | None = None
    predicted_rho_range: tuple[float, float] | None = None  # what the record's P90..P10 budget would show
    cutoff: float | None = None  # rho at or below: discard point


def cross_check(
    camera_progress: float,
    camera_stage: int,
    sensor_budget: float,
    sensor_p10: float | None = None,
    sensor_p90: float | None = None,
    rho: float | None = None,
    cal: Calibration = CALIBRATION,
) -> Witnesses:
    """Predict the label's stage from the temperature record, compare with what
    the camera saw, and flag a disagreement bigger than both witnesses' errors."""
    lo = sensor_budget if sensor_p10 is None else min(sensor_p10, sensor_budget)
    hi = sensor_budget if sensor_p90 is None else max(sensor_p90, sensor_budget)
    tol = 2 * cal.progress_sigma
    # Past stage 4 the square barely darkens further: a label can't tell 150%
    # from 300%. Compare both witnesses on the scale the label can show.
    cap = lambda x: min(x, LABEL_SATURATES)  # noqa: E731
    shown, lo_c, hi_c = cap(camera_progress), cap(lo), cap(hi)
    predicted = stage_for(sensor_budget)
    span = (stage_for(lo), stage_for(hi))
    label, sensor = f"{camera_progress * 100:.0f}%", f"{sensor_budget * 100:.0f}%"
    common = dict(
        label=camera_progress, sensor=sensor_budget, camera_stage=camera_stage, predicted_stage=predicted,
        predicted_stages=span, sensor_range=(round(lo, 3), round(hi, 3)), rho=rho,
        predicted_rho=round(rho_for(min(sensor_budget, LABEL_SATURATES), cal), 3),
        predicted_rho_range=(round(rho_for(hi_c, cal), 3), round(rho_for(lo_c, cal), 3)), cutoff=cal.discard,
    )
    if shown > hi_c + tol:
        return Witnesses(
            "LABEL_AHEAD", True,
            f"Flag: the label shows more heat (stage {camera_stage}, {label}) than the temperature record predicts "
            f"(stage {predicted}, {sensor}). The box was probably warm before our monitoring, or the record has a "
            "hole. The label counts.",
            **common,
        )
    if shown < lo_c - tol:
        return Witnesses(
            "SENSOR_AHEAD", True,
            f"Flag: the temperature record predicts more heat (stage {predicted}, {sensor}) than the label shows "
            f"(stage {camera_stage}, {label}). Check the sensor, and that this label belongs to this product. "
            "Until then the record counts.",
            **common,
        )
    return Witnesses(
        "AGREE", False,
        f"The camera (stage {camera_stage}, {label}) and the temperature record (stage {predicted}, {sensor}) agree.",
        **common,
    )
