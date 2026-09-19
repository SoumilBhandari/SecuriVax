"""Carrier twin: does it recover the truth, and are its forecasts calibrated?

Synthetic carriers with known hidden parameters, driven by real ERA5
outside temperatures, observed through a noisy sensor at various rates.
"""

import time

import numpy as np

from app.backtest.simulate import Weather
from app.engine import twin
from evals.core import Metric, SuiteResult

STORAGE_MAX = 8.0


def make_carrier(rng, weather: Weather):
    cell = list(weather.cells)[rng.integers(len(weather.cells))]
    times, _ = weather.cells[cell]
    start = float(times[0] + 86400 * rng.integers(1, 80) + 3600 * rng.uniform(4, 12))
    step = int(rng.choice([60, 180, 300, 600]))
    hours = 30.0
    ts = start + np.arange(0, hours * 3600, step)
    outside = weather.at(cell, ts)
    life = float(np.exp(rng.uniform(np.log(1.5), np.log(20))))
    leak = float(np.clip(np.exp(rng.normal(0, 0.4)), 0.5, 2.5))
    gain = float(rng.uniform(0, 4))
    truth = twin.Particles(*(np.array([v]) for v in (5.0, life * 38 * leak, rng.normal(4.5, 0.8), leak, gain, rng.uniform(0.7, 2.2), 0.0, 1.0)))
    temps = [5.0]
    for i in range(1, len(ts)):
        twin.step(truth, float(outside[i]), step / 3600, None)
        temps.append(float(truth.temp[0]))
    noise = rng.uniform(0.1, 0.35)
    measured = np.array(temps) + rng.normal(0, 0.2) + rng.normal(0, noise, len(temps))
    return dict(cell=cell, ts=ts, outside=outside, temps=np.array(temps), measured=measured, life=life, step=step)


def outside_fn(c):
    return lambda t: float(np.interp(t, c["ts"], c["outside"]))


def ensemble_for(c, rng, members=20):
    """A forecast with realistic error: truth plus correlated noise growing with lead time."""
    fns = []
    for _ in range(members):
        err = np.cumsum(rng.normal(0, 0.35, len(c["ts"]))) * 0.5 + rng.normal(0, 0.8)
        series = c["outside"] + err
        fns.append(lambda t, s=series: float(np.interp(t, c["ts"], s)))
    return fns


def run(quick: bool) -> SuiteResult:
    started = time.time()
    rng = np.random.default_rng(7)
    weather = Weather()
    n = 30 if quick else 90
    ape, rmses, fails = [], [], 0
    covered = brier = 0.0
    p50_err, cases, outcomes = [], 0, []
    probs = {"fleet": [], "known": []}
    covered_known = brier_known = 0.0
    covered_fleet = brier_fleet = 0.0
    fleet_median = float(np.exp((np.log(1.5) + np.log(20)) / 2))  # the synthetic fleet's median cold life
    for _ in range(n):
        c = make_carrier(rng, weather)
        series = [(int(t), float(m), 1.0) for t, m in zip(c["ts"], c["measured"])]
        breach_i = next((i for i, t in enumerate(c["temps"]) if t > STORAGE_MAX), None)

        # 1. Recovery from a finished trip (only identifiable if it breached).
        res = twin.run_filter(series, outside_fn(c), n=600)
        rmses.append(res.one_step_rmse_c)
        fails += res.one_step_rmse_c > 1.0
        if breach_i is not None:
            est = twin.weighted_quantiles(twin.effective_cold_life(res.particles), res.particles.weight, (0.5,))[0]
            ape.append(abs(est - c["life"]) / c["life"])

        # 2. Forecast from part-way through the trip.
        cut_h = rng.uniform(1.0, 4.0)
        seen = [s for s in series if s[0] <= c["ts"][0] + cut_h * 3600]
        truth_breach = c["ts"][breach_i] if breach_i is not None else None
        in_window = truth_breach is not None and truth_breach <= seen[-1][0] + 12 * 3600
        if truth_breach is not None and truth_breach <= seen[-1][0]:
            continue  # already breached when we looked
        cases += 1
        outcomes.append(float(in_window))
        own = c["life"] * np.exp(rng.normal(0, 0.3))
        for known, spread, label in ((None, 0.35, "wide"), (fleet_median, 1.0, "fleet"), (own, 0.35, "known")):
            r = twin.run_filter(seen, outside_fn(c), n=600, known_cold_life_h=known, spread=spread)
            fc = twin.forecast(r, ensemble_for(c, rng), 12, STORAGE_MAX, samples=300)
            lo = fc.breach_p10
            hi = fc.breach_p90
            if in_window:
                ok = (lo is not None and lo <= truth_breach) and (hi is None or truth_breach <= hi)
            else:
                ok = hi is None
            b = (fc.breach_prob - float(in_window)) ** 2
            if label in probs:
                probs[label].append((fc.breach_prob, float(in_window)))
            if label == "wide":
                covered += ok
                brier += b
            elif label == "fleet":
                covered_fleet += ok
                brier_fleet += b
            else:
                covered_known += ok
                brier_known += b
                if in_window and fc.breach_p50:
                    p50_err.append(abs(fc.breach_p50 - truth_breach) / 3600)

    base = float(np.mean(outcomes)) if outcomes else 0.5
    ref = max(base * (1 - base), 1e-9)  # Brier of always forecasting the fleet's base rate

    def skill(total: float) -> float:
        return 1 - (total / max(cases, 1)) / ref

    def calibration_error(pairs) -> float:
        """Expected calibration error over 5 probability bins."""
        if not pairs:
            return 0.0
        p, y = np.array(pairs).T
        bins = np.minimum((p * 5).astype(int), 4)
        return float(sum(abs(p[bins == k].mean() - y[bins == k].mean()) * (bins == k).mean() for k in range(5) if (bins == k).any()))

    metrics = [
        Metric("cold life within 25% (finished trips)", float(np.mean(np.array(ape) <= 0.25)), 0.8, unit="%"),
        Metric("median cold-life error", float(np.median(ape)), 0.15, higher_is_better=False, unit="%"),
        Metric("median one-step tracking error", float(np.median(rmses)), 0.4, higher_is_better=False, unit="°C"),
        Metric("filter failures (tracking error > 1 °C)", fails / n, 0.05, higher_is_better=False, unit="%"),
        Metric("80% interval coverage, new carrier (fleet prior)", covered_fleet / max(cases, 1), 0.7, unit="%", note="target about 80%"),
        Metric("80% interval coverage, known carrier", covered_known / max(cases, 1), 0.7, unit="%"),
        Metric("calibration error, new carrier (fleet prior)", calibration_error(probs["fleet"]), 0.1,
               higher_is_better=False, unit="%", note="says 70%, happens about 70% of the time"),
        Metric("calibration error, known carrier", calibration_error(probs["known"]), 0.1, higher_is_better=False, unit="%"),
        Metric("Brier skill vs base rate, new carrier", skill(brier_fleet), None,
               note="near 0: calibrated but not sharp until the ice starts to go"),
        Metric("Brier skill vs base rate, known carrier", skill(brier_known), 0.5, note="learning a carrier's history pays"),
        Metric("Brier skill with no prior at all", skill(brier), None, note="why the priors matter"),
        Metric("median P50 breach-time error, known carrier", float(np.median(p50_err)) if p50_err else 0.0, 1.5, higher_is_better=False, unit="h"),
    ]
    return SuiteResult(
        "twin", "Carrier twin on synthetic carriers driven by real ERA5 weather: recovery and forecast calibration",
        metrics, time.time() - started, {"carriers": n, "forecast_cases": cases},
    )
