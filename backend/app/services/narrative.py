"""Plain-language report for the health worker, written by Grok.

Grok only explains: it gets the engine's facts (verdict, action, reasons,
place names) and must not change the verdict. With no key, or if the call
fails, a deterministic template is used instead.
"""

import hashlib
import json
import logging
import re
from datetime import datetime, timezone

import httpx
from sqlmodel import Session

from app.config import get_settings
from app.engine.profiles import ProductProfile
from app.engine.verdict import Report, fmt_minutes
from app.models import Box, TextCache
from app.services.places import coords_label
from app.services.report import place_key

log = logging.getLogger(__name__)

XAI_URL = "https://api.x.ai/v1/responses"

SYSTEM = """You write short reports for community health workers about whether a box of \
vaccines or rapid diagnostic tests is still safe to use.
A validated rule engine has already decided the verdict. Never change it, never soften \
or override it, and never add medical advice beyond the action you are given.
Write plain English a busy nurse can read in 20 seconds: at most 90 words, two short \
paragraphs. First: what happened to this box, where and when, using the place names \
given. Second: exactly what to do now. No headings, no bullet points, no markdown. \
If demo_time is true, add a final sentence noting the timeline is accelerated for a demo."""


def _iso(ts: int | None) -> str | None:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%d %b %H:%M UTC") if ts else None


def _place(places: dict[str, str], lat: float | None, lon: float | None) -> str | None:
    if lat is None:
        return None
    return places.get(place_key(lat, lon), coords_label(lat, lon))


# How a health worker reads each verdict: never the code (USE_FIRST).
VERDICT_WORDS = {"USE": "USE", "USE_FIRST": "USE FIRST", "QUARANTINE": "QUARANTINE", "DISCARD": "DISCARD"}


def build_facts(box: Box, profile: ProductProfile, report: Report, places: dict[str, str]) -> dict:
    return {
        "box": box.id,
        "product": profile.name,
        "verdict": VERDICT_WORDS[report.verdict],
        "action": report.action,
        "budget_used_pct": round(report.budget_used * 100),
        "reasons": [r.text for r in report.reasons],
        "legs": [
            {
                "node": s.node_label,
                "from": _place(places, s.start_lat, s.start_lon),
                "to": _place(places, s.end_lat, s.end_lon),
                "start": _iso(s.start_ts),
                "end": _iso(s.end_ts) or "still inside",
                "hours": round(((s.end_ts or report.computed_at) - s.start_ts) / 3600, 1),
                "min_temp_c": s.min_temp_c,
                "max_temp_c": s.max_temp_c,
                "budget_used_pct": round(s.budget_used * 100, 1),
                "events": [
                    {
                        "kind": run.kind,
                        "where": _place(places, run.lat, run.lon),
                        "when": _iso(run.start_ts),
                        "for": fmt_minutes(run.minutes),
                        "extreme": round(run.extreme, 1),
                    }
                    for run in s.runs
                ],
            }
            for s in report.segments
        ],
        "demo_time": report.demo_time,
    }


def _duration(hours: float) -> str:
    if hours < 1:
        return f"{max(hours * 60, 1):.0f} min"
    return f"{hours:.0f} h" if hours < 48 else f"{hours / 24:.1f} days"


COORDS = re.compile(r"^-?\d+\.\d+, -?\d+\.\d+$")


def template_text(facts: dict) -> str:
    """Used when Grok is unavailable: the engine's own words, lightly joined."""
    legs = []
    for leg in facts["legs"]:
        line = f"{leg['node']} ({_duration(leg['hours'])}{', still inside' if leg['end'] == 'still inside' else ''})"
        if leg["from"] and leg["to"] and not COORDS.match(leg["from"]) and not COORDS.match(leg["to"]):
            line += f", {leg['from']} to {leg['to']}"
        legs.append(line)
    rode = f" It rode in {'; then '.join(legs)}." if legs else ""
    demo = " (Demo: time is accelerated.)" if facts["demo_time"] else ""
    return (
        f"{facts['product']}, box {facts['box']}, has used {facts['budget_used_pct']}% of its heat budget."
        f"{rode} {' '.join(facts['reasons'])}\n\n{facts['verdict']}: {facts['action']}{demo}"
    )


def _output_text(data: dict) -> str:
    if isinstance(data.get("output_text"), str):
        return data["output_text"]
    parts = []
    for item in data.get("output", []):
        for content in item.get("content", []) or []:
            if content.get("type") in ("output_text", "text") and content.get("text"):
                parts.append(content["text"])
    return "".join(parts)


async def _ask_grok(facts: dict) -> str:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=settings.report_timeout_s) as client:
        res = await client.post(
            XAI_URL,
            headers={"Authorization": f"Bearer {settings.xai_api_key}"},
            json={
                "model": settings.grok_model,
                "input": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": json.dumps(facts)},
                ],
                "temperature": 0.2,
                "max_output_tokens": 400,
            },
        )
        if res.is_error:  # xAI says why (a bad key, no credits, a model name); keep that in the log
            raise RuntimeError(f"xAI {res.status_code}: {res.text[:300]}")
        return _output_text(res.json()).strip()


async def write_report(session: Session, facts: dict) -> tuple[str, str]:
    """Returns (text, source) where source is grok | template."""
    digest = hashlib.sha256(json.dumps(facts, sort_keys=True).encode()).hexdigest()[:32]
    key = f"report:{digest}"
    if cached := session.get(TextCache, key):
        return cached.text, cached.source

    text, source = "", "template"
    if get_settings().xai_api_key:
        try:
            text, source = await _ask_grok(facts), "grok"
        except Exception as exc:
            log.warning("grok report failed: %r", exc)
    if not text:
        text, source = template_text(facts), "template"
    else:
        session.merge(TextCache(key=key, kind="report", text=text, source=source))
        session.commit()
    return text, source
