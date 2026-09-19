"""Gemini's second opinion on a VVM photo.

Our own image measurement gives a number; Gemini looks at the same photo
and says, in structured form, whether the inner square is lighter than, the
same as, or darker than the circle. Two independent reads of the label, and
the health worker confirms before anything counts.
"""

import asyncio
import json
import logging

from google import genai
from google.genai import types

from app.config import get_settings

log = logging.getLogger(__name__)

PROMPT = (
    "This photo should show a vaccine vial monitor (VVM): a coloured circle with a smaller square inside. "
    "Compare the inner square with the outer circle. Stage 1: square much lighter. Stage 2: square darker "
    "than new but still lighter than the circle. Stage 3: square matches the circle (discard point). "
    "Stage 4: square darker than the circle. If there is no VVM, set found to false."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean"},
        "inner_vs_outer": {"type": "string", "enum": ["lighter", "same", "darker"]},
        "stage": {"type": "integer", "minimum": 1, "maximum": 4},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "note": {"type": "string"},
    },
    "required": ["found", "inner_vs_outer", "stage", "confidence"],
}


async def gemini_vvm(jpeg: bytes) -> dict | None:
    settings = get_settings()
    if not settings.gemini_api_key:
        return None
    client = genai.Client(api_key=settings.gemini_api_key)
    try:
        resp = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=settings.gemini_model,
                contents=[types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"), PROMPT],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json", response_schema=SCHEMA, temperature=0.0
                ),
            ),
            settings.ai_timeout_s,
        )
        data = json.loads(resp.text or "{}")
        return data if data.get("found") else {**data, "stage": None}
    except Exception as exc:
        log.warning("gemini VVM read failed: %r", exc)
        return None
