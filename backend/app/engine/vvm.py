"""Read a vaccine vial monitor (VVM) from a photo.

A VVM is a coloured circle with a heat-sensitive square inside. The square
starts lighter than the circle and darkens with cumulative heat; when it
matches the circle, the vial has reached its discard point. That is the same
quantity our sensor budget estimates, so the label is a second, independent
witness to the box's heat history.

We measure it rather than eyeball it:
    progress = (background - square) / (background - circle)
0 = square as light as the label paper, 1 = square matches the circle
(discard point), >1 = darker than the circle.
"""

from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps

MAX_SIDE = 400
# Refuse anything bigger than a very large phone photo before decoding it.
MAX_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
# Measurement noise near "matches": treat anything this close as at the end point.
ENDPOINT_AT = 0.92
MIN_CONTRAST = 35.0  # grey levels between label paper and circle
GLARE_SHARE = 0.02  # saturated pixels on the label above this: ask for a retake


@dataclass
class VvmReading:
    found: bool
    message: str
    progress: float | None = None
    stage: int | None = None  # 1 fresh, 2 in use, 3 discard point, 4 beyond
    past_endpoint: bool | None = None
    square_l: float | None = None
    circle_l: float | None = None
    background_l: float | None = None
    center: tuple[float, float] | None = None
    radius_px: float | None = None


def stage_for(progress: float) -> int:
    if progress < 0.25:
        return 1
    if progress < ENDPOINT_AT:
        return 2
    if progress < 1.1:
        return 3
    return 4


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


def read_vvm(image: Image.Image) -> VvmReading:
    img = image.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    img = ImageOps.exif_transpose(img)
    rgb = np.asarray(img, dtype=float)
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    h, w = lum.shape

    border = max(2, int(min(h, w) * 0.06))
    edge = np.concatenate([lum[:border].ravel(), lum[-border:].ravel(), lum[:, :border].ravel(), lum[:, -border:].ravel()])
    background = float(np.median(edge))
    # Clip at the paper level so a bright glare spot can't hijack the threshold.
    dark = lum < _otsu(np.minimum(lum, background + 5))
    if background - float(np.median(lum[dark])) < MIN_CONTRAST if dark.any() else True:
        return VvmReading(False, "Couldn't find a VVM: fill the circle guide with the label and hold steady.")

    # Centre: centroid of dark pixels, re-centred inside a shrinking window so
    # text elsewhere on the label doesn't pull it away.
    ys, xs = np.nonzero(dark)
    cy, cx, win = h / 2, w / 2, min(h, w) * 0.45
    for _ in range(4):
        near = (ys - cy) ** 2 + (xs - cx) ** 2 <= win**2
        if near.sum() < 50:
            return VvmReading(False, "Couldn't find a VVM near the centre of the guide.")
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
        return VvmReading(False, "The VVM is too small or cut off: move closer so it fills the guide.")

    # Glare turns the square white and makes a spent label look fresh: never
    # measure through it, ask for another photo instead.
    disc = dist <= radius
    saturated = rgb.min(axis=2) >= 245  # glare is white: every channel clipped, not just red under warm light
    if saturated[disc].mean() > GLARE_SHARE:
        return VvmReading(False, "Glare on the label: tilt the phone a little and try again.")

    # Paper colour right around the circle, not at the photo's edge, so
    # shadows and print elsewhere on the label don't skew the reference.
    # (Upper percentile: a circle squashed into an ellipse by perspective can dip
    # into the ring and would drag a median down.)
    ring = (dist >= 1.2 * radius) & (dist <= 1.6 * radius)
    if ring.sum() > 200:
        background = float(np.percentile(lum[ring], 75))

    square = (np.abs(yy - cy) <= 0.28 * radius) & (np.abs(xx - cx) <= 0.28 * radius)
    circle = on_axis & (dist >= 0.80 * radius) & (dist <= 0.93 * radius)
    square_l = float(np.median(lum[square]))
    circle_l = float(np.median(lum[circle]))
    contrast = background - circle_l
    if np.mean(lum[square] > background + 25) > 0.15 or _uneven(lum, yy, xx, cy, cx, radius, dist, contrast):
        return VvmReading(False, "Glare on the label: tilt the phone a little and try again.")
    if contrast < MIN_CONTRAST:
        return VvmReading(False, "Not enough contrast: move to better light or avoid glare.")

    progress = round(max(0.0, (background - square_l) / contrast), 3)
    return VvmReading(
        found=True,
        message="Read the VVM.",
        progress=progress,
        stage=stage_for(progress),
        past_endpoint=progress >= ENDPOINT_AT,
        square_l=round(square_l, 1),
        circle_l=round(circle_l, 1),
        background_l=round(background, 1),
        center=(round(float(cx), 1), round(float(cy), 1)),
        radius_px=round(float(radius), 1),
    )


UNEVEN_AT = 0.35  # brightness spread across the square, as a share of the contrast


def _uneven(lum, yy, xx, cy, cx, radius, dist, contrast) -> bool:
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


@dataclass
class Witnesses:
    code: str  # AGREE | LABEL_AHEAD | SENSOR_AHEAD
    text: str
    label: float
    sensor: float


AGREE_WITHIN = 0.25


def compare(label_progress: float, sensor_budget: float) -> Witnesses:
    """The two witnesses: the vial's own label vs our black-box record."""
    gap = label_progress - sensor_budget
    label, sensor = f"{label_progress * 100:.0f}%", f"{sensor_budget * 100:.0f}%"
    if abs(gap) <= AGREE_WITHIN:
        return Witnesses("AGREE", f"The label ({label}) and the sensor record ({sensor}) agree.", label_progress, sensor_budget)
    if gap > 0:
        return Witnesses(
            "LABEL_AHEAD",
            f"The label shows more heat ({label}) than we recorded ({sensor}). The box was probably warmer "
            "before our monitoring than assumed. The label counts.",
            label_progress, sensor_budget,
        )
    return Witnesses(
        "SENSOR_AHEAD",
        f"We recorded more heat ({sensor}) than the label shows ({label}). Check the sensor, and that this "
        "label belongs to this product.",
        label_progress, sensor_budget,
    )
