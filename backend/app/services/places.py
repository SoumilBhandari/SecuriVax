"""Turn GPS points into place names with Gemini + Google Maps grounding.

Names are cached per ~100 m bucket, so each spot costs one call ever. With no
key, or if Gemini fails, the place is shown as coordinates.
"""

import asyncio
import logging
import re

from google import genai
from google.genai import types
from sqlmodel import Session

from app.config import get_settings
from app.models import TextCache
from app.services.report import place_key

log = logging.getLogger(__name__)

# Each new place is a Maps-grounded Gemini request, billed per request: name the
# first few key points (handoffs, then incidents) and show the rest as coordinates.
MAX_POINTS = 4

PROMPT = (
    "Name the place at latitude {lat:.5f}, longitude {lon:.5f} using Google Maps. "
    "Reply with only a short name a local health worker would recognise, at most "
    "7 words: a facility, village or town, or a road with the nearest town "
    "(e.g. 'Kisumu-Bondo road near Holo'). No coordinates, no extra words."
)


def coords_label(lat: float, lon: float) -> str:
    return f"{lat:.3f}, {lon:.3f}"


def _clean(text: str) -> str:
    text = text.strip().splitlines()[0] if text and text.strip() else ""
    text = re.sub(r"[*_`\"]", "", text).strip().rstrip(".")
    return text[:80]


async def _ask_gemini(client: genai.Client, model: str, lat: float, lon: float) -> str:
    config = types.GenerateContentConfig(
        tools=[types.Tool(google_maps=types.GoogleMaps())],
        tool_config=types.ToolConfig(
            retrieval_config=types.RetrievalConfig(lat_lng=types.LatLng(latitude=lat, longitude=lon))
        ),
        temperature=0.1,
    )
    resp = await client.aio.models.generate_content(
        model=model, contents=PROMPT.format(lat=lat, lon=lon), config=config
    )
    return _clean(resp.text or "")


async def resolve_places(
    session: Session, points: list[tuple[float, float]]
) -> tuple[dict[str, str], str]:
    """Map place_key -> name for each point. Returns (places, source)."""
    settings = get_settings()
    places: dict[str, str] = {}
    missing: list[tuple[float, float]] = []
    for lat, lon in points[:MAX_POINTS]:
        cached = session.get(TextCache, place_key(lat, lon))
        if cached:
            places[place_key(lat, lon)] = cached.text
        else:
            missing.append((lat, lon))

    source = "gemini" if settings.gemini_api_key else "coords"
    if missing and settings.gemini_api_key:
        client = genai.Client(api_key=settings.gemini_api_key)
        results = await asyncio.gather(
            *(
                asyncio.wait_for(_ask_gemini(client, settings.gemini_model, lat, lon), settings.ai_timeout_s)
                for lat, lon in missing
            ),
            return_exceptions=True,
        )
        for (lat, lon), name in zip(missing, results):
            key = place_key(lat, lon)
            if isinstance(name, str) and name:
                places[key] = name
                session.merge(TextCache(key=key, kind="place", text=name, source="gemini"))
            else:
                log.warning("gemini place lookup failed for %s: %r", key, name)
                places[key] = coords_label(lat, lon)
                source = "mixed"
        session.commit()
    else:
        for lat, lon in missing:
            places[place_key(lat, lon)] = coords_label(lat, lon)
    return places, source
