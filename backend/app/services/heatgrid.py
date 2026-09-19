"""The forecast heat field under the Climate map: Open-Meteo's 2 m air
temperature on a grid over every region with a site, every 3 hours for the
next 3 days.

The sites' own forecasts (weather.py) keep a week of history for each point;
the grid needs none, so it has its own lean fetch. Open-Meteo's free tier
counts each grid point as a call (10,000 a day per address, shared with the
sites' own forecasts), so the grid is coarse (2.5 degrees), only covers land
near a site (not the open ocean or empty desert), and is refreshed every 6
hours: about a thousand calls a day. Points outside it are null: no data, drawn
as nothing. Offline, the climate model stands in, and the field
says so. Like all weather here, it never changes a verdict.
"""

import bisect
import logging
import math
import threading
import time

import httpx
from sqlmodel import Session, select

from app.config import get_settings
from app.models import Facility
from app.services import weather as wx

log = logging.getLogger(__name__)

STEP_DEG = 2.5
MARGIN_DEG = 4.0
FRAME_STEP_H = 3
HORIZON_H = 72
TTL_S = 6 * 3600
NEAR_KM = 900  # a grid point is fetched only within this of some site
CHUNK = 50  # locations per Open-Meteo request
MAX_POINTS = 900  # a guard on the free tier if the sites ever spread further

_lock = threading.Lock()
_cache: dict[str, tuple[float, dict]] = {}


def _axis(lo: float, hi: float) -> list[float]:
    start = math.floor((lo - MARGIN_DEG) / STEP_DEG) * STEP_DEG
    stop = math.ceil((hi + MARGIN_DEG) / STEP_DEG) * STEP_DEG
    return [round(start + i * STEP_DEG, 2) for i in range(int(round((stop - start) / STEP_DEG)) + 1)]


def _fetch(points: list[tuple[float, float]]) -> list[tuple[list[int], list[float]]]:
    out = []
    for i in range(0, len(points), CHUNK):
        chunk = points[i : i + CHUNK]
        res = wx._client.get(wx.URL, params={
            "latitude": ",".join(f"{p[0]:.2f}" for p in chunk),
            "longitude": ",".join(f"{p[1]:.2f}" for p in chunk),
            "hourly": "temperature_2m", "forecast_days": 4, "past_days": 0, "timeformat": "unixtime",
        })
        res.raise_for_status()
        body = res.json()
        for loc in body if isinstance(body, list) else [body]:
            out.append((loc["hourly"]["time"], loc["hourly"]["temperature_2m"]))
    return out


def _at(times: list[int], temps: list[float | None], ts: int) -> float | None:
    i = bisect.bisect_left(times, ts)
    if i < len(times) and times[i] == ts:
        return temps[i]
    if i == 0 or i >= len(times) or temps[i - 1] is None or temps[i] is None:
        return None
    t0, t1 = times[i - 1], times[i]
    return temps[i - 1] + (temps[i] - temps[i - 1]) * (ts - t0) / (t1 - t0)


def build(session: Session, now: int | None = None) -> dict:
    """The grid over the sites, row 0 in the north, one frame every 3 hours."""
    now = int(time.time()) if now is None else now
    sites = session.exec(select(Facility)).all()
    if not sites:
        return {"available": False, "reason": "No sites yet."}
    lats = _axis(min(f.lat for f in sites), max(f.lat for f in sites))[::-1]  # north first
    lons = _axis(min(f.lon for f in sites), max(f.lon for f in sites))
    from app.services.climate import haversine_km

    grid_points = [(la, lo) for la in lats for lo in lons]
    near = [any(haversine_km(p, (f.lat, f.lon)) <= NEAR_KM for f in sites) for p in grid_points]
    points = [p for p, keep in zip(grid_points, near) if keep][:MAX_POINTS]
    first = (now // 3600 + 1) * 3600
    times = list(range(first, first + HORIZON_H * 3600 + 1, FRAME_STEP_H * 3600))

    source = "model"
    series: list[tuple[list[int], list[float]]] | None = None
    if not get_settings().weather_offline:
        try:
            series = _fetch(points)
            source = "open-meteo"
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            log.warning("heat grid: open-meteo unavailable, using the climate model: %r", exc)
    frames = []
    for ts in times:
        values = iter(
            round(got if (got := _at(*series[k], ts) if series else None) is not None else wx.model_at(la, lo, ts)[0], 1)
            for k, (la, lo) in enumerate(points)
        )
        frames.append([next(values) if keep else None for keep in near])
    half = STEP_DEG / 2
    return {
        "available": True,
        "source": source,
        "generated_at": now,
        "step_deg": STEP_DEG,
        "points": len(points),
        "rows": len(lats),
        "cols": len(lons),
        # Cell edges, for drawing: row 0 is the northernmost row of centres.
        "bounds": [[lats[-1] - half, lons[0] - half], [lats[0] + half, lons[-1] + half]],
        "lats": lats,
        "lons": lons,
        "times": times,
        "frames": frames,
    }


def grid(session: Session) -> dict:
    """The cached grid, rebuilt every few hours (one caller at a time)."""
    with _lock:
        hit = _cache.get("grid")
        if hit and time.time() - hit[0] < TTL_S:
            return hit[1]
        result = build(session)
        if result.get("available"):
            _cache["grid"] = (time.time(), result)
        return result


def clear_cache() -> None:
    _cache.clear()
