"""Backtest: 90 days of outreach trips on real weather, four ways of deciding.

Every trip is simulated once as ground truth: a carrier with some real cold
life leaves a store, drives to a clinic, runs a session and comes back,
while the actual ERA5 temperature at that clinic heats it. Some trips go
wrong the way they do in the field: packs straight from the freezer, a
carrier left in a hot vehicle, a worn carrier. Each box on board ends the
day truly fine, heat-damaged (VVM end point reached) or freeze-damaged.

Then four policies decide, from what each could actually observe, whether
the box's doses are used at the next session:

  status_quo    no monitoring on the last mile; the worker reads the VVM by
                eye; freezing goes unseen; rapid tests are never checked
  alarm_logger  a threshold logger in the carrier; any alarm and the box is
                thrown away (what alarm-only monitoring leads to)
  vialtality    our verdict from the sensor record; QUARANTINE goes to a
                shake test or the camera VVM check
  vialtality_planned  the same, plus the forecast: leave in the cool
                morning, and repack carriers once the twin shows their cold
                life is short

Every number the model assumes is listed in ASSUMPTIONS with a note, and
the whole run is seeded: the same inputs give the same results.
"""

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

from app.engine import twin
from app.engine.profiles import FREEZE_ALARM_MINUTES, FREEZE_THRESHOLD_C, PRODUCTS_BY_ID
from app.engine.uncertainty import _rates
from app.engine.vvm import ENDPOINT_AT
from app.seed import demo_facilities

DATA = Path(__file__).resolve().parents[2] / "data" / "era5_kisumu_90d.json"
RESULTS = DATA.parent / "impact.json"
STEP_H = 1 / 6
LOCAL_UTC_OFFSET_H = 3


@dataclass(frozen=True)
class Assumption:
    value: float
    note: str


ASSUMPTIONS: dict[str, Assumption] = {
    "trips_per_day": Assumption(4, "Outreach trips from the two stores, every day."),
    "boxes_per_trip": Assumption(4, "Boxes of vaccine or rapid tests per carrier."),
    "good_cold_life_h": Assumption(16, "Median cold life (rated hours at +43 C) of a well-packed carrier."),
    "worn_share": Assumption(0.35, "Share of the fleet with worn seals or badly frozen packs."),
    "worn_cold_life_h": Assumption(3.5, "Median cold life of those carriers."),
    "frozen_packs_p": Assumption(0.12, "Trips packed with ice packs straight from the freezer (no conditioning)."),
    "frozen_packs_h": Assumption(1.8, "Hours the inside sits below 0 C when that happens."),
    "hot_vehicle_p": Assumption(0.06, "Trips where the carrier waits in a closed vehicle in the sun."),
    "hot_vehicle_gain_c": Assumption(14, "Extra heat on top of outside air while in the vehicle."),
    "session_h": Assumption(6, "Hours at the outreach site."),
    "depart_earliest_h": Assumption(7, "Status quo departures: uniformly 07:00 to 12:00 local."),
    "depart_latest_h": Assumption(12, ""),
    "planned_depart_h": Assumption(6, "Planned departures: the forecast's cool morning slot."),
    "vvm_eye_sd": Assumption(0.15, "Error when a person judges the VVM by eye (fraction of the way to the end point)."),
    "vvm_camera_sd": Assumption(0.07, "Error of the camera VVM measurement (from our synthetic-image tests)."),
    "sensor_bias_sd_c": Assumption(0.2, "SHT31 calibration bias."),
    "shake_test_sensitivity": Assumption(0.9, "Shake test catches a truly frozen box."),
    "shake_test_specificity": Assumption(0.95, "Shake test passes a box that didn't freeze."),
    "start_budget_max": Assumption(0.6, "Budget already used before the trip: uniform 0 to this."),
    "pack_alert_acted_p": Assumption(0.8, "Workers who re-condition packs when warned they're below 0 C at departure."),
}

PRODUCT_MIX = {"opv": 0.25, "penta": 0.25, "mr": 0.15, "hpv": 0.1, "rdt-malaria": 0.25}
DOSES = {"opv": 20, "penta": 10, "mr": 10, "hpv": 10, "rdt-malaria": 25}
# Approximate per-dose prices in US$ (UNICEF supply catalogue order of magnitude).
PRICE = {"opv": 0.15, "penta": 0.9, "mr": 0.6, "hpv": 4.5, "rdt-malaria": 0.35}

POLICIES = {
    "status_quo": "Today: VVM read by eye at the next session, no last-mile monitoring.",
    "alarm_logger": "Threshold logger in the carrier; any alarm and the box is discarded.",
    "vialtality": "Vialtality verdicts; QUARANTINE goes to a shake test or the camera VVM check.",
    "vialtality_planned": "Vialtality verdicts plus forecast-based departures and carrier repacking.",
}


class Weather:
    def __init__(self, path: Path = DATA):
        raw = json.loads(path.read_text())
        self.source, self.start, self.end = raw["source"], raw["start"], raw["end"]
        self.cells = {
            tuple(map(float, k.split(","))): (np.array(v["time"], dtype=float), np.array(v["temp_c"], dtype=float))
            for k, v in raw["cells"].items()
        }

    def at(self, cell: tuple[float, float], ts: np.ndarray) -> np.ndarray:
        times, temps = self.cells[cell]
        return np.interp(ts, times, temps)

    @property
    def first_day(self) -> int:
        return int(min(t[0] for t, _ in self.cells.values()) // 86400 * 86400)


@dataclass
class Trip:
    depart: int
    clinic: str
    cell: tuple[float, float]
    travel_h: float
    cold_life_h: float
    frozen_packs: bool
    hot_vehicle: bool
    carrier: int


def inside_temps(trip: Trip, weather: Weather, a: dict[str, float]) -> tuple[np.ndarray, np.ndarray]:
    """Ground-truth inside temperature every 10 minutes for the whole trip."""
    hours = 2 * trip.travel_h + a["session_h"]
    ts = trip.depart + np.arange(0, hours + STEP_H / 2, STEP_H) * 3600
    outside = weather.at(trip.cell, ts)
    p = twin.Particles(*(np.array([v]) for v in (5.0, trip.cold_life_h * twin.DEG_PER_RATED_HOUR, 4.5, 1.0, 1.0, 1.2, 0.0, 1.0)))
    temps = [5.0]
    for i in range(1, len(ts)):
        h = (ts[i] - trip.depart) / 3600
        p.hold = np.array([-3.0 if trip.frozen_packs and h < a["frozen_packs_h"] else 4.5])
        in_vehicle = trip.hot_vehicle and trip.travel_h <= h < trip.travel_h + 3
        p.gain = np.array([1.0 + (a["hot_vehicle_gain_c"] if in_vehicle else 0.0)])
        twin.step(p, float(outside[i]), STEP_H, None)
        temps.append(float(p.temp[0]))
    return ts, np.array(temps)


def budget(product: str, temps: np.ndarray) -> float:
    """The same integral as the verdict engine: sum of dt / t_life(T), trapezoid rule."""
    rates = _rates(PRODUCTS_BY_ID[product], temps)
    return float(np.sum(0.5 * (rates[1:] + rates[:-1])) * STEP_H)


def froze(temps: np.ndarray) -> bool:
    run = longest = 0.0
    for t in temps[:-1]:
        run = run + STEP_H * 60 if t <= FREEZE_THRESHOLD_C else 0.0
        longest = max(longest, run)
    return longest >= FREEZE_ALARM_MINUTES


def heat_alarm(temps: np.ndarray) -> bool:
    """30-day-recorder style: 10 h continuously above +8 C."""
    run = longest = 0.0
    for t in temps[:-1]:
        run = run + STEP_H if t > 8.0 else 0.0
        longest = max(longest, run)
    return longest >= 10


@dataclass
class Outcome:
    doses: int = 0
    damaged_heat: int = 0
    damaged_freeze: int = 0
    unsafe_used: int = 0
    unsafe_rdt_used: int = 0
    good_discarded: int = 0
    value_lost_usd: float = 0.0
    boxes: int = 0
    trips_breached: int = 0
    road_budget_used: float = 0.0  # heat budget spent on the road, summed over boxes
    by_product: dict = field(default_factory=dict)


def run(days: int = 90, seed: int = 2026, overrides: dict[str, float] | None = None, weather: Weather | None = None) -> dict:
    a = {k: v.value for k, v in ASSUMPTIONS.items()} | (overrides or {})
    weather = weather or Weather()
    rng = np.random.default_rng(seed)
    facilities = {f.id: f for f in demo_facilities()}
    stores = [facilities["KSM-STORE"], facilities["SIA-STORE"]]
    clinics = [f for f in facilities.values() if f.kind == "clinic"]
    from app.services.climate import ROAD_FACTOR, haversine_km
    from app.services.weather import cell as cell_of

    fleet_worn = rng.random(8) < a["worn_share"]
    fleet_life = np.where(fleet_worn, a["worn_cold_life_h"], a["good_cold_life_h"]) * np.exp(rng.normal(0, 0.2, 8))
    repacked = np.zeros(8, dtype=bool)  # planned policy: fixed once the twin flags them

    outcomes = {p: Outcome() for p in POLICIES}
    products = list(PRODUCT_MIX)
    weights = np.array([PRODUCT_MIX[p] for p in products])
    day0 = weather.first_day + 86400

    for day in range(days):
        for _ in range(int(a["trips_per_day"])):
            store = stores[rng.integers(len(stores))]
            clinic = clinics[rng.integers(len(clinics))]
            travel_h = max(0.3, haversine_km((store.lat, store.lon), (clinic.lat, clinic.lon)) * ROAD_FACTOR / 30)
            carrier = int(rng.integers(8))
            base = dict(
                clinic=clinic.id, cell=cell_of(clinic.lat, clinic.lon), travel_h=travel_h,
                frozen_packs=bool(rng.random() < a["frozen_packs_p"]),
                hot_vehicle=bool(rng.random() < a["hot_vehicle_p"]), carrier=carrier,
            )
            life = float(fleet_life[carrier] * np.exp(rng.normal(0, 0.15)))
            depart_h = rng.uniform(a["depart_earliest_h"], a["depart_latest_h"])
            local_midnight = day0 + day * 86400 - LOCAL_UTC_OFFSET_H * 3600
            as_is = Trip(depart=int(local_midnight + depart_h * 3600), cold_life_h=life, **base)
            planned_life = a["good_cold_life_h"] if repacked[carrier] else life
            # The departure pack check (PACKS_TOO_COLD) catches frozen packs if the worker acts on it.
            caught = base["frozen_packs"] and rng.random() < a["pack_alert_acted_p"]
            planned = Trip(
                depart=int(local_midnight + a["planned_depart_h"] * 3600), cold_life_h=planned_life,
                **(base | {"frozen_packs": base["frozen_packs"] and not caught}),
            )

            _, true_temps = inside_temps(as_is, weather, a)
            _, planned_temps = inside_temps(planned, weather, a)
            if np.any(planned_temps > 8.0) and fleet_worn[carrier]:
                repacked[carrier] = True  # the twin learns this carrier's short cold life

            # One sensor per carrier: its bias and noise are shared by every box on board.
            sensor_error = rng.normal(0, a["sensor_bias_sd_c"]) + rng.normal(0, 0.15, len(true_temps))
            for _ in range(int(a["boxes_per_trip"])):
                product = products[rng.choice(len(products), p=weights)]
                profile = PRODUCTS_BY_ID[product]
                start = rng.uniform(0.1 if profile.kind == "rapid_test" else 0.0, a["start_budget_max"])
                eye, camera = rng.normal(0, a["vvm_eye_sd"]), rng.normal(0, a["vvm_camera_sd"])
                shake = rng.random()
                for policy in POLICIES:
                    temps = planned_temps if policy == "vialtality_planned" else true_temps
                    b_true = start + budget(product, temps)
                    frozen_true = profile.freeze_sensitive and froze(temps)
                    heat_damaged = b_true >= 1.0
                    damaged = heat_damaged or frozen_true
                    measured = temps + sensor_error
                    discard = _decide(policy, profile, a, b_true, frozen_true, measured, eye, camera, shake, start, product)
                    o = outcomes[policy]
                    o.road_budget_used += b_true - start
                    doses = DOSES[product]
                    o.boxes += 1
                    o.doses += doses
                    o.damaged_heat += doses if heat_damaged else 0
                    o.damaged_freeze += doses if frozen_true and not heat_damaged else 0
                    if damaged and not discard:
                        o.unsafe_used += doses
                        o.unsafe_rdt_used += doses if profile.kind == "rapid_test" else 0
                    if discard and not damaged:
                        o.good_discarded += doses
                    if discard or damaged:
                        o.value_lost_usd += doses * PRICE[product]
                    bp = o.by_product.setdefault(product, {"unsafe_used": 0, "good_discarded": 0})
                    bp["unsafe_used"] += doses if damaged and not discard else 0
                    bp["good_discarded"] += doses if discard and not damaged else 0
            for policy in POLICIES:
                temps = planned_temps if policy == "vialtality_planned" else true_temps
                outcomes[policy].trips_breached += int(np.any(temps > 8.0) or froze(temps))

    for o in outcomes.values():
        o.road_budget_used = round(o.road_budget_used / max(o.boxes, 1), 5)  # mean per box
    return {
        "weather": {"source": weather.source, "start": weather.start, "end": weather.end},
        "days": days,
        "trips": days * int(a["trips_per_day"]),
        "seed": seed,
        "assumptions": [
            {"name": k, "value": a[k], "note": v.note} for k, v in ASSUMPTIONS.items()
        ],
        "policies": [
            {"id": p, "description": POLICIES[p], **{k: (round(v, 6) if isinstance(v, float) else v) for k, v in asdict(o).items()}}
            for p, o in outcomes.items()
        ],
    }


METRICS = ("unsafe_used", "good_discarded", "damaged_freeze", "damaged_heat", "value_lost_usd", "trips_breached", "road_budget_used")


def sweep(seeds: int = 20, days: int = 90) -> dict:
    """The same backtest over many random seeds: mean and P10-P90 of each metric,
    so no headline number rests on one lucky draw."""
    weather = Weather()
    runs = [run(days=days, seed=1000 + i, weather=weather) for i in range(seeds)]
    summary = {}
    for p in POLICIES:
        rows = [next(x for x in r["policies"] if x["id"] == p) for r in runs]
        summary[p] = {
            m: {
                "mean": round(float(np.mean([row[m] for row in rows])), 4),
                "p10": round(float(np.percentile([row[m] for row in rows], 10)), 4),
                "p90": round(float(np.percentile([row[m] for row in rows], 90)), 4),
            }
            for m in METRICS
        }
    return {"seeds": seeds, "days": days, "summary": summary}


def _decide(policy, profile, a, b_true, frozen_true, measured, eye, camera, shake, start, product) -> bool:
    """True if this policy throws the box away before the next use."""
    vaccine = profile.kind == "vaccine"
    if policy in ("status_quo", "alarm_logger"):
        by_eye = vaccine and b_true + eye >= 1.0  # visibly past the VVM end point
        if policy == "status_quo":
            return by_eye
        return by_eye or froze(measured) or heat_alarm(measured)

    # Vialtality: the engine on the measured record, then the check QUARANTINE asks for.
    b_meas = start + budget(product, measured)
    if b_meas >= 1.0:
        return True
    if profile.freeze_sensitive and froze(measured):
        # Shake test (vaccines) or positive control (rapid tests) settles it.
        if frozen_true:
            return shake < a["shake_test_sensitivity"]
        return shake > a["shake_test_specificity"]
    if b_meas >= 0.75 and vaccine:
        return b_true + camera >= ENDPOINT_AT  # camera VVM check
    return False


if __name__ == "__main__":
    import sys

    result = run()
    print(f"{result['trips']} trips on {result['weather']['source']}, {result['weather']['start']} to {result['weather']['end']}")
    print(f"{'policy':<20}{'unsafe used':>12}{'good wasted':>12}{'damaged':>9}{'heat':>6}{'freeze':>7}{'lost $':>8}{'breached':>9}{'road %':>8}")
    for p in result["policies"]:
        print(
            f"{p['id']:<20}{p['unsafe_used']:>12}{p['good_discarded']:>12}{p['damaged_heat'] + p['damaged_freeze']:>9}"
            f"{p['damaged_heat']:>6}{p['damaged_freeze']:>7}{p['value_lost_usd']:>8.0f}{p['trips_breached']:>9}"
            f"{p['road_budget_used'] * 100:>7.3f}%"
        )
    if "--sweep" in sys.argv:
        sw = sweep()
        print(f"\nacross {sw['seeds']} seeds (mean, P10-P90)")
        for p, m in sw["summary"].items():
            u, g, d = m["unsafe_used"], m["good_discarded"], m["damaged_freeze"]
            print(f"{p:<20} unsafe {u['mean']:>7.0f} ({u['p10']:.0f}-{u['p90']:.0f})  wasted {g['mean']:>6.0f} ({g['p10']:.0f}-{g['p90']:.0f})  "
                  f"frozen {d['mean']:>6.0f}  breached {m['trips_breached']['mean']:>5.0f}  lost ${m['value_lost_usd']['mean']:>5.0f}")
    if "--json" in sys.argv:
        print(json.dumps(result, indent=1))
    if "--write" in sys.argv:
        RESULTS.write_text(json.dumps({"run": result, "sweep": sweep()}, separators=(",", ":")))
        print(f"wrote {RESULTS}")


def load_results() -> dict:
    """Saved results (python -m app.backtest.simulate --write), else compute now."""
    if RESULTS.exists():
        return json.loads(RESULTS.read_text())
    return {"run": run(), "sweep": sweep(seeds=10)}
