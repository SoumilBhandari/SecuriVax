"""Calibrate the VVM reader's stage cutoffs on rho = L_s / L_r from labelled photos.

    python -m evals.calibrate_vvm                  # synthetic phone photos
    python -m evals.calibrate_vvm --photos DIR     # real photos, plus synthetic

Real photos are labelled by name or folder: stage3_0012.jpg, or DIR/stage3/*.jpg.
Photograph real VVMs at known stages (WHO's reference card, or vials kept warm
on purpose) under different light, and drop them in a folder.

The fit:
- discard cutoff: the smallest rho at which at most 3% of spent calibration
  labels read as usable, and never closer to 1 (the physical end point) than
  1.02: the same label moves about 1% between photos, so a label exactly at
  its end point must not read usable on a lucky photo. A bigger margin buys
  little and costs a lot of good labels read as spent;
- stage 1|2: fewest misclassified photos, on paper-normalised progress when the
  paper around the label is visible (faded print squeezes rho, the
  normalisation undoes it), else on rho;
- stage 3|4: fewest misclassified photos on rho (both are discard anyway);
- progress bias: the paper around the label reads a little bright (noise
  lifts an upper percentile), so raw progress = p + b(1 - p); b is fitted by
  least squares and the reader undoes it;
- rho_fresh: median rho of unheated labels (for the progress estimate);
- rho_sigma, progress_sigma: robust spreads, used by the cross-check.

It fits on one set of photos and reports accuracy on a separate held-out set,
and writes app/engine/vvm_calibration.json, which the reader loads.
"""

import argparse
import json
import re
import time
from dataclasses import asdict
from pathlib import Path

import numpy as np
from PIL import Image

from app.engine.vvm import CALIBRATION_FILE, Calibration, read_vvm, stage_for, stage_for_rho
from evals.vvm import photo

MAX_SPENT_AS_USABLE = 0.03
MIN_MARGIN = 0.02  # photo-to-photo noise of rho for one label is about 1%


def synthetic(seed: int, n: int) -> list[dict]:
    """Photos at known progress, spread across all four stages."""
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(n):
        truth = float(rng.choice([rng.uniform(0, 0.25), rng.uniform(0.25, 1.0), rng.uniform(1.0, 1.15), rng.uniform(1.15, 1.4)]))
        r = read_vvm(photo(rng, truth), Calibration())
        if r.found:
            out.append({"rho": r.rho, "raw": _raw_progress(r), "stage": stage_for(truth), "progress": truth})
    return out


def from_folder(folder: Path) -> list[dict]:
    out = []
    for path in sorted(folder.rglob("*")):
        m = re.search(r"stage[_-]?([1-4])", str(path.relative_to(folder)).lower())
        if not m or path.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
            continue
        r = read_vvm(Image.open(path), Calibration())
        if r.found:
            out.append({"rho": r.rho, "raw": _raw_progress(r), "stage": int(m.group(1)), "progress": None, "file": path.name})
    return out


def _raw_progress(r) -> float | None:
    """Progress from rho and this photo's own paper (before any stage clamping)."""
    if r.paper_l is None:
        return None
    rho0 = r.paper_l / max(r.ring_l, 1.0)
    return None if rho0 < 1.2 or rho0 <= r.rho else (rho0 - r.rho) / (rho0 - 1)


def _best_cut(rho: np.ndarray, upper: np.ndarray, candidates: np.ndarray, cost_upper_below: float = 1.0) -> float:
    """Cutoff c classifying rho >= c as the 'upper' class; minimum weighted error."""
    best, best_cost = candidates[0], np.inf
    for c in candidates:
        cost = cost_upper_below * np.sum(upper & (rho < c)) + np.sum(~upper & (rho >= c))
        if cost < best_cost:
            best, best_cost = c, cost
    return float(best)


def fit_bias(rows: list[dict]) -> float:
    pairs = [(r["raw"], r["progress"]) for r in rows if r["raw"] is not None and r["progress"] is not None and r["progress"] < 1]
    if len(pairs) < 20:
        return 0.0
    raw, p = np.array(pairs).T
    return float(np.sum((raw - p) * (1 - p)) / np.sum((1 - p) ** 2))


def fit(rows: list[dict], source: str) -> Calibration:
    bias = fit_bias(rows)
    for r in rows:  # stage cutoffs are fitted on the corrected progress the reader will use
        if r["raw"] is not None:
            r["raw"] = (r["raw"] - bias) / (1 - bias)
    rho = np.array([r["rho"] for r in rows])
    stage = np.array([r["stage"] for r in rows])
    usable = stage <= 2
    grid = np.round(np.arange(1.0 + MIN_MARGIN, 1.4, 0.005), 3)
    missed = np.array([np.mean(rho[~usable] > c) for c in grid])
    ok = np.nonzero(missed <= MAX_SPENT_AS_USABLE)[0]
    discard = float(grid[ok[0]] if len(ok) else grid[int(np.argmin(missed))])
    spent = rho <= discard
    stage34 = _best_cut(rho[spent & (stage >= 3)], stage[spent & (stage >= 3)] == 3, np.round(np.arange(0.4, discard, 0.01), 3)) if (spent & (stage >= 3)).sum() > 5 else 0.85
    live = ~spent & (stage <= 2)
    stage12 = _best_cut(rho[live], stage[live] == 1, np.round(np.arange(discard + 0.05, 5.0, 0.02), 3)) if live.sum() > 5 else 2.2
    raw = np.array([r["raw"] if r["raw"] is not None else np.nan for r in rows])
    has = live & ~np.isnan(raw)
    # Fresh (stage 1) is the *lower* progress class: fit on -progress.
    stage12_progress = -_best_cut(-raw[has], stage[has] == 1, -np.round(np.arange(0.5, 0.05, -0.01), 3)) if has.sum() > 5 else 0.25

    known = np.array([r["progress"] is not None for r in rows])
    prog = np.array([r["progress"] if r["progress"] is not None else np.nan for r in rows])
    fresh = known & (prog < 0.1)
    rho_fresh = float(np.median(rho[fresh])) if fresh.sum() >= 5 else float(np.median(rho[stage == 1]))
    near = known & (np.abs(prog - 1) < 0.15)
    rho_sigma = float(1.4826 * np.median(np.abs(rho[near] - (rho_fresh - prog[near] * (rho_fresh - 1))))) if near.sum() >= 5 else 0.05
    cal = Calibration(
        stage12=round(stage12, 3), stage12_progress=round(stage12_progress, 3), discard=round(discard, 3), stage34=round(stage34, 3),
        rho_fresh=round(rho_fresh, 3), rho_sigma=round(max(rho_sigma, 0.02), 3), progress_bias=round(bias, 4),
        source=source, photos=len(rows),
    )
    return cal


def progress_sigma(cal: Calibration, seed: int, n: int) -> float:
    rng = np.random.default_rng(seed)
    errs = []
    for _ in range(n):
        truth = float(rng.uniform(0, 1.3))
        r = read_vvm(photo(rng, truth), cal)
        if r.found:
            errs.append(r.progress - truth)
    errs = np.array(errs)
    return float(np.percentile(np.abs(errs), 68))  # includes any bias, unlike a MAD


def evaluate(cal: Calibration, rows: list[dict]) -> dict:
    stage = np.array([r["stage"] for r in rows])
    pred = np.array([stage_for_rho(r["rho"], cal, r["raw"]) for r in rows])
    spent, fresh = stage >= 3, stage <= 2
    confusion = [[int(np.sum((stage == t) & (pred == p))) for p in range(1, 5)] for t in range(1, 5)]
    return {
        "photos": len(rows),
        "stage_accuracy": round(float(np.mean(pred == stage)), 3),
        "spent_read_as_usable": round(float(np.mean(pred[spent] <= 2)) if spent.any() else 0.0, 3),
        "usable_read_as_spent": round(float(np.mean(pred[fresh] >= 3)) if fresh.any() else 0.0, 3),
        "confusion_true_by_read": confusion,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos", type=Path, help="folder of real labelled photos (stageN in the name or folder)")
    ap.add_argument("--n", type=int, default=600, help="synthetic photos to fit on")
    ap.add_argument("--out", type=Path, default=CALIBRATION_FILE)
    args = ap.parse_args()
    started = time.time()

    train = synthetic(101, args.n)
    test = synthetic(202, args.n // 2)
    source = f"synthetic phone photos ({len(train)} fit, {len(test)} held out)"
    if args.photos:
        real = from_folder(args.photos)
        if real:
            half = len(real) // 2
            rng = np.random.default_rng(0)
            order = rng.permutation(len(real))
            train += [real[i] for i in order[half:]]
            test += [real[i] for i in order[:half]]
            source += f" + {len(real)} real photos from {args.photos.name}"
    cal = fit(train, source)
    cal.progress_sigma = round(max(progress_sigma(cal, 303, 200), 0.03), 3)
    for r in test:
        if r["raw"] is not None:
            r["raw"] = (r["raw"] - cal.progress_bias) / (1 - cal.progress_bias)
    cal.held_out = evaluate(cal, test)
    args.out.write_text(json.dumps(asdict(cal), indent=2) + "\n")
    print(json.dumps(asdict(cal), indent=2))
    print(f"wrote {args.out} in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
