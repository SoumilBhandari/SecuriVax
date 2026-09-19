"""VVM camera reader: accuracy on realistic, messy phone photos.

What matters most: a label that is past its end point must not read as
usable, and a fresh label must not read as spent.
"""

import io
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from app.engine.vvm import ENDPOINT_AT, read_vvm, stage_for
from evals.core import Metric, SuiteResult


def photo(rng: np.random.Generator, progress: float | None, hard: bool = True, flags: dict | None = None) -> Image.Image:
    """A synthetic phone photo of a VVM label (progress None: no VVM at all).
    flags, if given, records whether glare fell across the label."""
    flags = {} if flags is None else flags
    flags["label_glare"] = False
    size = 480
    paper = np.array(rng.choice([[238, 234, 224], [245, 245, 245], [226, 226, 214], [235, 228, 210]]), dtype=float)
    circle = np.array([rng.uniform(55, 95), rng.uniform(35, 70), rng.uniform(95, 140)])
    if hard and rng.random() < 0.25:  # faded print: a lighter, low-contrast circle
        circle = circle + (paper - circle) * rng.uniform(0.3, 0.5)
    img = Image.new("RGB", (size, size), tuple(int(v) for v in paper))
    d = ImageDraw.Draw(img)
    for _ in range(rng.integers(2, 6)):  # printed text and lines on the label
        y = rng.integers(0, size)
        d.text((rng.integers(0, size - 120), y), "LOT OP-2604 EXP 2027", fill=(40, 40, 40))
    if rng.random() < 0.5:
        d.line([(0, rng.integers(0, size)), (size, rng.integers(0, size))], fill=(90, 90, 90), width=2)
    vvm = None
    if progress is not None:
        r = rng.uniform(40, 150) if hard else rng.uniform(70, 150)
        cx, cy = size / 2 + rng.uniform(-40, 40), size / 2 + rng.uniform(-40, 40)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=tuple(int(v) for v in circle))
        half = r * rng.uniform(0.5, 0.64)
        # The indicator darkens non-linearly with heat.
        shade = progress ** rng.uniform(0.8, 1.25) if hard else progress
        sq = np.clip(paper + (circle - paper) * shade, 0, 255)
        d.rectangle([cx - half, cy - half, cx + half, cy + half], fill=tuple(int(v) for v in sq))
        vvm = (cx, cy, r)
    angle = rng.uniform(-45, 45)
    img = img.rotate(angle, resample=Image.BICUBIC, fillcolor=tuple(int(v) for v in paper))
    if vvm:  # where the VVM ended up after rotation (PIL turns counter-clockwise about the centre)
        a, c0 = np.radians(angle), size / 2
        dx, dy = vvm[0] - c0, vvm[1] - c0
        vvm = (c0 + dx * np.cos(a) + dy * np.sin(a), c0 - dx * np.sin(a) + dy * np.cos(a), vvm[2])
    if rng.random() < 0.5:  # perspective: the phone isn't square-on
        k = rng.uniform(0, 40)
        img = img.transform((size, size), Image.QUAD, (k, 0, 0, size, size, size - k * 0.5, size - k, 0), Image.BICUBIC)
    if hard and rng.random() < 0.4:  # label wrapped round a vial: squashed toward the edges
        a0 = np.asarray(img)
        u = np.linspace(-1, 1, size)
        src = np.clip(((np.arcsin(u * 0.95) / np.arcsin(0.95)) + 1) / 2 * (size - 1), 0, size - 1).astype(int)
        img = Image.fromarray(a0[:, src])
    if rng.random() < 0.4:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.5, 2.0)))
    if hard and rng.random() < 0.15:  # hand shake: motion blur
        img = img.filter(ImageFilter.BoxBlur(int(rng.integers(2, 5))))
    a = np.asarray(img, dtype=float)
    yy, xx = np.mgrid[0:size, 0:size] / size
    light = 1 - rng.uniform(0, 0.3) * (np.cos(rng.uniform(0, np.pi)) * xx + np.sin(rng.uniform(0, np.pi)) * yy)  # shadow
    cast = np.array([rng.uniform(0.9, 1.1), 1.0, rng.uniform(0.85, 1.1)])  # warm or cool light
    a = a * light[..., None] * cast
    if rng.random() < 0.3:  # glare spot away from the centre
        gx, gy = rng.uniform(0.05, 0.3), rng.uniform(0.05, 0.95)
        a += 120 * np.exp(-(((xx - gx) ** 2 + (yy - gy) ** 2) / 0.004))[..., None]
        if vvm and np.hypot(gx * size - vvm[0], gy * size - vvm[1]) < vvm[2] + 0.1 * size:
            flags["label_glare"] = True  # it landed on the label after all
    if hard and rng.random() < 0.2:  # glare right across the label: the dangerous one
        flags["label_glare"] = True
        gx, gy = 0.5 + rng.uniform(-0.08, 0.08), 0.5 + rng.uniform(-0.08, 0.08)
        a += rng.uniform(80, 200) * np.exp(-(((xx - gx) ** 2 + (yy - gy) ** 2) / rng.uniform(0.002, 0.01)))[..., None]
    a += rng.normal(0, rng.uniform(2, 8), a.shape)  # sensor noise, worse in low light
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=int(rng.uniform(40, 92)))
    return Image.open(io.BytesIO(buf.getvalue()))


def run(quick: bool) -> SuiteResult:
    started = time.time()
    rng = np.random.default_rng(11)
    n = 120 if quick else 300
    errs, stage_ok, found = [], 0, 0
    spent_total = spent_missed = fresh_total = fresh_flagged = 0
    clear_total = clear_found = glare_total = glare_safe = 0
    for _ in range(n):
        truth = float(rng.choice([rng.uniform(0, 0.7), rng.uniform(0.7, 1.0), rng.uniform(1.0, 1.3)]))
        flags: dict = {}
        r = read_vvm(photo(rng, truth, flags=flags))
        if flags["label_glare"]:
            glare_total += 1
            glare_safe += (not r.found) or abs(r.progress - truth) <= 0.15
        else:
            clear_total += 1
            clear_found += r.found
        if truth >= 1.0:
            spent_total += 1
        if truth <= 0.6:
            fresh_total += 1
        if not r.found:
            continue
        found += 1
        errs.append(abs(r.progress - truth))
        stage_ok += r.stage == stage_for(truth)
        spent_missed += truth >= 1.0 and not r.past_endpoint
        fresh_flagged += truth <= 0.6 and r.past_endpoint
    false_found = sum(read_vvm(photo(rng, None)).found for _ in range(n // 4))
    metrics = [
        Metric("labels read, no glare on them", clear_found / max(clear_total, 1), 0.95, unit="%"),
        Metric("glare on label: retake asked or read right", glare_safe / max(glare_total, 1), 0.9, unit="%"),
        Metric("labels read, all photos", found / n, None, note="retakes are asked for glare"),
        Metric("median progress error", float(np.median(errs)), 0.08, higher_is_better=False),
        Metric("progress within 0.15", float(np.mean(np.array(errs) <= 0.15)), 0.85, unit="%"),
        Metric("stage correct", stage_ok / max(found, 1), 0.8, unit="%"),
        Metric("spent labels read as usable", spent_missed / max(spent_total, 1), 0.05, higher_is_better=False, unit="%",
               note="the dangerous error"),
        Metric("fresh labels read as spent", fresh_flagged / max(fresh_total, 1), 0.03, higher_is_better=False, unit="%"),
        Metric("VVM 'found' on photos with no VVM", false_found / max(n // 4, 1), 0.1, higher_is_better=False, unit="%"),
    ]
    return SuiteResult(
        "vvm", "Camera VVM reader on synthetic phone photos (rotation, perspective, blur, glare, shadow, colour cast, JPEG)",
        metrics, time.time() - started, {"photos": n},
    )
