"""A probabilistic digital twin of a passive vaccine carrier.

We can't see inside the ice packs, but we can watch what they do. A particle
filter (sequential Monte Carlo) tracks a cloud of candidate carriers, each
with its own hidden state:

    E     ice left, in degree-hours (WHO rates carriers at +43 C, so a carrier
          rated L hours starts with L x 38 degree-hours)
    hold  the temperature the packs hold the inside at (about +5 C when packed
          right, below 0 C when packs go in straight from the freezer)
    g     how fast heat leaks in (a worn seal or open lid leaks faster)
    gain  extra heat on top of the outside air (sun on the box, closed vehicle)
    tau   how fast the inside drifts to outside once the ice is gone

Every reading re-weights the cloud by how well each candidate predicted it;
unlikely candidates die and likely ones multiply. What survives is a
posterior over the carrier's hidden state, which we then roll forward
through every member of a weather ensemble to forecast when the carrier will
leave the safe range, with honest uncertainty.
"""

from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

from app.engine.profiles import FREEZE_THRESHOLD_C

RATED_AT_C = 43.0
HOLD_NOMINAL_C = 5.0
DEG_PER_RATED_HOUR = RATED_AT_C - HOLD_NOMINAL_C
OBS_SIGMA_C = 0.4  # SHT31 noise plus model error
OBS_DOF = 4  # Student-t: one surprising reading shouldn't wipe out the cloud
LIU_WEST_A = 0.95  # kernel shrinkage when resampling (Liu & West, 2001)
HOLD_RELAX_H = 0.25  # how fast the inside settles to the pack temperature
MAX_STEP_H = 0.25
N_PARTICLES = 1000


@dataclass
class Particles:
    temp: np.ndarray
    ice: np.ndarray
    hold: np.ndarray
    leak: np.ndarray
    gain: np.ndarray
    tau: np.ndarray
    # Degree-hours of heat pushed at the ice so far (independent of leak), so
    # starting ice / leak = ice / leak + exposure stays consistent under resampling.
    exposure: np.ndarray
    weight: np.ndarray

    def __len__(self) -> int:
        return len(self.temp)

    def take(self, idx: np.ndarray) -> "Particles":
        n = len(idx)
        return Particles(
            self.temp[idx].copy(), self.ice[idx].copy(), self.hold[idx].copy(), self.leak[idx].copy(),
            self.gain[idx].copy(), self.tau[idx].copy(), self.exposure[idx].copy(), np.full(n, 1.0 / n),
        )


def prior(
    first_temp: float, n: int, rng: np.random.Generator, known_cold_life_h: float | None = None,
    spread: float = 0.35,
) -> Particles:
    """known_cold_life_h: what this carrier (or, for a new carrier, the fleet)
    showed on earlier trips; spread is the log-sd around it. Without it the
    prior is wide (log-uniform 0.3-40 h)."""
    if known_cold_life_h:
        cold_life = np.exp(rng.normal(np.log(known_cold_life_h), spread, n))
    else:
        cold_life = np.exp(rng.uniform(np.log(0.3), np.log(40.0), n))
    heat_source = rng.random(n) < 0.15
    leak = np.exp(rng.normal(0, 0.6, n))
    return Particles(
        temp=first_temp + rng.normal(0, 0.3, n),
        ice=cold_life * DEG_PER_RATED_HOUR * leak,  # so that ice / leak = rated hours x 38
        hold=np.clip(rng.normal(HOLD_NOMINAL_C, 2.5, n), -6, 9),
        leak=leak,
        gain=np.where(heat_source, rng.uniform(2, 14, n), np.abs(rng.normal(0, 0.8, n))),
        tau=rng.uniform(0.5, 3.0, n),
        exposure=np.zeros(n),
        weight=np.full(n, 1.0 / n),
    )


def step(p: Particles, outside: np.ndarray | float, dt_h: float, rng: np.random.Generator | None) -> None:
    """Advance every particle by dt_h hours of product time, in place."""
    remaining = dt_h
    while remaining > 1e-9:
        h = min(remaining, MAX_STEP_H)
        remaining -= h
        driving = outside + p.gain
        melting = p.ice > 0
        # Ice spends degree-hours at a rate set by the gradient across the walls.
        push = np.maximum(driving - p.temp, 0) * h
        p.exposure = np.where(melting, p.exposure + np.minimum(push, p.ice / p.leak), p.exposure)
        p.ice = np.where(melting, np.maximum(p.ice - p.leak * push, 0), 0)
        settled = p.hold + (p.temp - p.hold) * np.exp(-h / HOLD_RELAX_H)
        drifted = driving + (p.temp - driving) * np.exp(-h * p.leak / p.tau)
        p.temp = np.where(melting, settled, drifted)
        if rng is not None:
            p.temp += rng.normal(0, 0.12 * np.sqrt(h), len(p))


def _resample(p: Particles, rng: np.random.Generator) -> Particles:
    """Systematic resampling with Liu-West kernel smoothing of the parameters.

    Plain resampling copies particles until they are all identical (sample
    impoverishment). Liu-West shrinks each copy toward the cloud mean and adds
    matching noise, which keeps the cloud's mean and spread but refreshes it.
    """
    n = len(p)
    positions = (rng.random() + np.arange(n)) / n
    idx = np.minimum(np.searchsorted(np.cumsum(p.weight), positions), n - 1)
    a = LIU_WEST_A
    h = np.sqrt(1 - a**2)

    def smooth(values: np.ndarray, log: bool = False, among: np.ndarray | None = None) -> np.ndarray:
        """Liu-West: shrink toward the cloud mean, add matching noise.
        `among` restricts the mean/spread to some particles (e.g. those with ice)."""
        x = np.log(np.maximum(values, 1e-6)) if log else values
        w = p.weight if among is None else p.weight * among
        w = w / w.sum() if w.sum() > 0 else p.weight
        mean = np.sum(w * x)
        sd = np.sqrt(np.sum(w * (x - mean) ** 2))
        out = a * x[idx] + (1 - a) * mean + rng.normal(0, h * sd + 1e-6, n)
        return np.exp(out) if log else out

    # Smooth ice-per-leak (what's identifiable), then rebuild ice from it.
    ice_positive = p.ice[idx] > 0
    leak = np.clip(smooth(p.leak, log=True), 0.2, 5)
    # Mean and spread over particles that still have ice: the melted ones sit at
    # log(0) and would drag every survivor's estimate toward nothing.
    per_leak = np.where(ice_positive, smooth(p.ice / p.leak + 1e-9, log=True, among=(p.ice > 0).astype(float)), 0.0)
    return Particles(
        temp=p.temp[idx] + rng.normal(0, 0.05, n),
        ice=per_leak * leak,
        hold=np.clip(smooth(p.hold), -6, 9),
        leak=leak,
        gain=np.maximum(smooth(p.gain), 0),
        tau=np.clip(smooth(p.tau, log=True), 0.2, 5),
        exposure=p.exposure[idx].copy(),
        weight=np.full(n, 1.0 / n),
    )


@dataclass
class FilterResult:
    particles: Particles
    readings: int
    one_step_rmse_c: float | None  # how well the twin predicted each reading (None: too few yet)
    min_ess: float  # effective sample size; low means the data surprised the model
    last_ts: int


def _rejuvenate(p: Particles, y: float, rng: np.random.Generator) -> None:
    """Re-seed the least likely particles around a surprising reading.

    A carrier's inside can jump regimes (the last ice melts, a lid opens)
    faster than the cloud can follow, especially with sparse readings. When
    that happens, the worst 15% of candidates restart near the observation,
    in both regimes, with parameters drawn around the cloud's current belief.
    """
    n = len(p)
    k = max(1, n // 7)
    idx = np.argsort(p.weight)[:k]
    mean = lambda x: float(np.sum(p.weight * x))  # noqa: E731
    melted = rng.random(k) < 0.5
    p.temp[idx] = y + rng.normal(0, 0.2, k)
    p.ice[idx] = np.where(melted, 0.0, p.ice[idx] * rng.uniform(0.0, 1.0, k))
    p.hold[idx] = np.clip(mean(p.hold) + rng.normal(0, 1.0, k), -6, 9)
    p.leak[idx] = np.clip(np.exp(np.log(mean(p.leak)) + rng.normal(0, 0.4, k)), 0.2, 5)
    p.gain[idx] = np.maximum(mean(p.gain) + rng.normal(0, 1.5, k), 0)
    p.tau[idx] = np.clip(mean(p.tau) * np.exp(rng.normal(0, 0.4, k)), 0.2, 5)
    p.exposure[idx] = mean(p.exposure)
    p.weight[idx] = np.median(p.weight)
    p.weight /= p.weight.sum()


def run_filter(
    series: list[tuple[int, float, float]],
    outside: Callable[[int], float],
    n: int = N_PARTICLES,
    seed: int = 7,
    known_cold_life_h: float | None = None,
    spread: float = 0.35,
) -> FilterResult | None:
    """series: (ts, inside_c, time_scale) in time order."""
    if len(series) < 3:
        return None
    rng = np.random.default_rng(seed)
    p = prior(series[0][1], n, rng, known_cold_life_h, spread)
    errors, min_ess = [], float(n)
    for (t0, _, scale), (t1, y, _) in zip(series, series[1:]):
        dt_h = (t1 - t0) / 3600 * scale
        if dt_h <= 0:
            continue
        step(p, outside(t1), dt_h, rng)
        predicted = float(np.sum(p.weight * p.temp))
        errors.append(y - predicted)
        if abs(y - predicted) > 4 * OBS_SIGMA_C:
            _rejuvenate(p, y, rng)
        z = (y - p.temp) / OBS_SIGMA_C
        like = (1 + z**2 / OBS_DOF) ** (-(OBS_DOF + 1) / 2) + 1e-300
        w = p.weight * like
        p.weight = w / w.sum()
        ess = 1.0 / np.sum(p.weight**2)
        if ess < 0.05 * n:
            _rejuvenate(p, y, rng)
        min_ess = min(min_ess, ess)
        if ess < n / 2:
            p = _resample(p, rng)
    rmse = float(np.sqrt(np.mean(np.square(errors[5:])))) if len(errors) > 5 else None
    return FilterResult(p, len(series), rmse, min_ess, series[-1][0])


def effective_cold_life(p: Particles) -> np.ndarray:
    """What the data can actually pin down: how long the starting ice would
    hold the inside at +43 C (ice and leak are only identifiable as a ratio)."""
    return (p.ice / p.leak + p.exposure) / DEG_PER_RATED_HOUR


def weighted_quantiles(values: np.ndarray, weights: np.ndarray, qs: tuple[float, ...]) -> list[float]:
    order = np.argsort(values)
    cum = np.cumsum(weights[order])
    cum /= cum[-1]
    return [float(values[order][min(np.searchsorted(cum, q), len(values) - 1)]) for q in qs]


@dataclass
class Forecast:
    times: list[int]
    p10: list[float]
    p50: list[float]
    p90: list[float]
    outside_p50: list[float]
    breach_prob: float
    breach_p10: int | None
    breach_p50: int | None
    breach_p90: int | None
    trajectories: np.ndarray = field(repr=False)  # (samples, steps) inside temps
    dt_h: float = 1 / 6


def forecast(
    result: FilterResult,
    ensemble: list[Callable[[int], float]],
    horizon_h: float,
    storage_max_c: float,
    samples: int = 400,
    step_h: float = 1 / 6,
    seed: int = 11,
) -> Forecast:
    """Roll the posterior forward through the weather ensemble (real time, scale 1)."""
    rng = np.random.default_rng(seed)
    p = result.particles
    idx = rng.choice(len(p), size=samples, p=p.weight)
    cloud = p.take(idx)
    member = rng.integers(0, len(ensemble), samples)
    start = result.last_ts
    steps = int(round(horizon_h / step_h))
    times = [start + int(i * step_h * 3600) for i in range(1, steps + 1)]
    traj = np.empty((samples, steps))
    out_mid = []
    for i, ts in enumerate(times):
        outs = np.array([ensemble[m](ts) for m in range(len(ensemble))])
        out_mid.append(float(np.median(outs)))
        step(cloud, outs[member], step_h, rng)
        traj[:, i] = cloud.temp

    out_of_range = (traj > storage_max_c) | (traj <= FREEZE_THRESHOLD_C)
    first = np.where(out_of_range.any(axis=1), out_of_range.argmax(axis=1), -1)
    breached = first >= 0
    prob = float(breached.mean())

    def breach_q(q: float) -> int | None:
        # Quantile over all trajectories; ones that never breach count as "later than the horizon".
        k = int(np.ceil(q * samples)) - 1
        ordered = np.sort(np.where(breached, first, steps + 1))
        return times[ordered[k]] if ordered[k] < steps else None

    return Forecast(
        times=times,
        p10=np.percentile(traj, 10, axis=0).round(2).tolist(),
        p50=np.percentile(traj, 50, axis=0).round(2).tolist(),
        p90=np.percentile(traj, 90, axis=0).round(2).tolist(),
        outside_p50=[round(o, 1) for o in out_mid],
        breach_prob=round(prob, 3),
        breach_p10=breach_q(0.1),
        breach_p50=breach_q(0.5),
        breach_p90=breach_q(0.9),
        trajectories=traj,
        dt_h=step_h,
    )
