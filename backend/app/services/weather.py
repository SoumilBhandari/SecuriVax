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
# One pooled client: no new TLS handshake per call, and a short connect timeout
# so a dead network fails fast instead of holding a request for seconds.
_client = httpx.Client(timeout=httpx.Timeout(6.0, connect=2.0), transport=httpx.HTTPTransport(retries=1))


def clear_cache() -> None:
    global _down_until
    _cache.clear()
    _ensembles.clear()
    _down_until = 0.0


def model_at(lat: float, lon: float, ts: float) -> tuple[float, float]:
    """The offline model's temperature and humidity at any time: a smooth daily
    cycle for a warm, humid lowland. Never runs out, unlike a forecast."""
    solar_hour = (ts / 3600 + lon / 15) % 24
    day = math.cos((solar_hour - 15) / 24 * 2 * math.pi)
    return round(18 + 6.5 * (day + 1) + 1.5 * math.sin(ts / 86400 / 3), 1), round(72 - 20 * day, 0)


def model_weather(lat: float, lon: float, now: int | None = None) -> Weather:
    """Offline stand-in for the forecast, hourly over the usual window."""
    now = int(time.time()) if now is None else now
    start = (now // 3600 - PAST_DAYS * 24) * 3600
    times = [start + h * 3600 for h in range((PAST_DAYS + FORECAST_DAYS) * 24)]
    temps, rhs = zip(*(model_at(lat, lon, t) for t in times))
    return Weather(lat, lon, times, list(temps), list(rhs), "model")


def _fetch(cells: list[tuple[float, float]]) -> list[Weather]:
    res = _client.get(
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


# ------------------------------------------------------------ ensembles -----

ENSEMBLE_URL = "https://ensemble-api.open-meteo.com/v1/ensemble"
ENSEMBLE_MODEL = "icon_seamless"  # ~40 members
_ensembles: dict[tuple[float, float], tuple[float, list[Weather], str]] = {}


def _fetch_ensemble(c: tuple[float, float]) -> list[Weather]:
    res = _client.get(
        ENSEMBLE_URL,
        params={
            "latitude": c[0], "longitude": c[1], "hourly": "temperature_2m",
            "models": ENSEMBLE_MODEL, "past_days": 1, "forecast_days": 3, "timeformat": "unixtime",
        },
        timeout=8,
    )
    res.raise_for_status()
    hourly = res.json()["hourly"]
    members = []
    for key, temps in hourly.items():
        if not key.startswith("temperature_2m"):
            continue
        rows = [(t, v) for t, v in zip(hourly["time"], temps) if v is not None]
        if len(rows) > 24:
            members.append(Weather(c[0], c[1], [r[0] for r in rows], [r[1] for r in rows], [None] * len(rows), "open-meteo"))
    if len(members) < 5:
        raise ValueError("ensemble too small")
    return members


def _perturbed(base: Weather, n: int = 24, seed: int = 5) -> list[Weather]:
    """Offline stand-in for an ensemble: the forecast plus correlated noise
    that grows with lead time, like real forecast error does."""
    import random

    rng = random.Random(seed)
    members = []
    for _ in range(n):
        err, temps = 0.0, []
        for c in base.temp_c:
            err = 0.93 * err + rng.gauss(0, 0.45)
            temps.append(round(c + err, 2))
        members.append(Weather(base.lat, base.lon, base.times, temps, base.rh, "model"))
    return members


def ensemble_for(lat: float, lon: float) -> tuple[list[Weather], str]:
    """(members, source) for the cell around a point. Source says what it is:
    'open-meteo ensemble (N members)' or 'perturbed forecast' when offline."""
    global _down_until
    c = cell(lat, lon)
    now = time.time()
    if c in _ensembles and now - _ensembles[c][0] <= TTL_S:
        return _ensembles[c][1], _ensembles[c][2]
    if not get_settings().weather_offline and now >= _down_until:
        try:
            members = _fetch_ensemble(c)
            label = f"open-meteo ensemble ({len(members)} members)"
            _ensembles[c] = (now, members, label)
            return members, label
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            log.warning("ensemble unavailable, perturbing the forecast: %r", exc)
            _down_until = now + RETRY_AFTER_S
    base = weather_for([c])[c]
    members = _perturbed(base)
    label = "perturbed forecast (offline)" if base.source == "model" else "perturbed open-meteo forecast"
    _ensembles[c] = (now - TTL_S + 120, members, label)  # retry in 2 minutes
    return members, label


def warm(points: list[tuple[float, float]]) -> None:
    """Fetch weather for the known sites in the background at startup."""
    import threading

    def run():
        try:
            weather_for(points)
        except Exception as exc:  # never let a warm-up take the app down
            log.warning("weather warm-up failed: %r", exc)

    threading.Thread(target=run, daemon=True).start()
