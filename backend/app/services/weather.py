"""Hourly outside temperature and humidity from Open-Meteo (free, no key).

Weather never changes a verdict. It is context: what a carrier was up
against, which stores are about to be hit, and when to travel. With no
internet (or if Open-Meteo is down) a simple climate model stands in, and
everything built on it says "model" instead of "open-meteo".
"""

import bisect
import logging
import math
import time
from dataclasses import dataclass

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

URL = "https://api.open-meteo.com/v1/forecast"
CELL = 0.1  # degrees, ~11 km: points in one cell share weather
TTL_S = 60 * 60
RETRY_AFTER_S = 2 * 60
PAST_DAYS, FORECAST_DAYS = 7, 3


@dataclass
class Weather:
    lat: float
    lon: float
    times: list[int]
    temp_c: list[float]
    rh: list[float | None]
    source: str  # open-meteo | model

    def at(self, ts: int) -> tuple[float, float | None] | None:
        """Linear interpolation between hourly values."""
        i = bisect.bisect_left(self.times, ts)
        if i < len(self.times) and self.times[i] == ts:
            return self.temp_c[i], self.rh[i]
        if i == 0 or i >= len(self.times):
            return None
        t0, t1 = self.times[i - 1], self.times[i]
        f = (ts - t0) / (t1 - t0)
        temp = self.temp_c[i - 1] + (self.temp_c[i] - self.temp_c[i - 1]) * f
        r0, r1 = self.rh[i - 1], self.rh[i]
        return temp, None if r0 is None or r1 is None else r0 + (r1 - r0) * f

    def between(self, start: int, end: int) -> list[tuple[int, float, float | None]]:
        return [(t, c, h) for t, c, h in zip(self.times, self.temp_c, self.rh) if start <= t <= end]


def cell(lat: float, lon: float) -> tuple[float, float]:
    return round(round(lat / CELL) * CELL, 1), round(round(lon / CELL) * CELL, 1)


_cache: dict[tuple[float, float], tuple[float, Weather]] = {}
_down_until = 0.0


def clear_cache() -> None:
    global _down_until
    _cache.clear()
    _down_until = 0.0


def model_weather(lat: float, lon: float, now: int | None = None) -> Weather:
    """Offline stand-in: a smooth daily cycle for a warm, humid lowland."""
    now = int(time.time()) if now is None else now
    start = (now // 3600 - PAST_DAYS * 24) * 3600
    times = [start + h * 3600 for h in range((PAST_DAYS + FORECAST_DAYS) * 24)]
    temps, rhs = [], []
    for t in times:
        solar_hour = (t / 3600 + lon / 15) % 24
        day = math.cos((solar_hour - 15) / 24 * 2 * math.pi)
        temps.append(round(18 + 6.5 * (day + 1) + 1.5 * math.sin(t / 86400 / 3), 1))
        rhs.append(round(72 - 20 * day, 0))
    return Weather(lat, lon, times, temps, rhs, "model")


def _fetch(cells: list[tuple[float, float]]) -> list[Weather]:
    res = httpx.get(
        URL,
        params={
            "latitude": ",".join(str(c[0]) for c in cells),
            "longitude": ",".join(str(c[1]) for c in cells),
            "hourly": "temperature_2m,relative_humidity_2m",
            "past_days": PAST_DAYS,
            "forecast_days": FORECAST_DAYS,
            "timeformat": "unixtime",
        },
        timeout=6,
    )
    res.raise_for_status()
    data = res.json()
    locations = data if isinstance(data, list) else [data]
    out = []
    for (lat, lon), loc in zip(cells, locations):
        hourly = loc["hourly"]
        rows = [
            (t, c, h)
            for t, c, h in zip(hourly["time"], hourly["temperature_2m"], hourly["relative_humidity_2m"])
            if c is not None
        ]
        out.append(Weather(lat, lon, [r[0] for r in rows], [r[1] for r in rows], [r[2] for r in rows], "open-meteo"))
    return out


def weather_for(points: list[tuple[float, float]]) -> dict[tuple[float, float], Weather]:
    """Weather for each ~11 km cell the points fall in, keyed by cell()."""
    global _down_until
    now = time.time()
    cells = list(dict.fromkeys(cell(lat, lon) for lat, lon in points))
    missing = [c for c in cells if c not in _cache or now - _cache[c][0] > TTL_S]
    online = not get_settings().weather_offline and now >= _down_until
    if missing and online:
        try:
            for i in range(0, len(missing), 50):
                chunk = missing[i : i + 50]
                for c, w in zip(chunk, _fetch(chunk)):
                    _cache[c] = (now, w)
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            log.warning("open-meteo unavailable, using the climate model: %r", exc)
            _down_until = now + RETRY_AFTER_S
    out = {}
    for c in cells:
        if c in _cache and now - _cache[c][0] <= TTL_S:
            out[c] = _cache[c][1]
        else:
            out[c] = model_weather(*c)
    return out


def ambient_at(weather: dict[tuple[float, float], Weather], lat: float, lon: float, ts: int):
    w = weather.get(cell(lat, lon))
    return w.at(ts) if w else None
