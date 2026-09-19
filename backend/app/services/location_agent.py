"""Gemini as a dispatch agent for a carrier on the road.

The agent can't see the world directly. It calls our tools: where the
carrier is and what its twin forecasts; which facilities with a fridge are
nearby, and how far; the chance the carrier leaves 2-8 C before it could
reach each one. It then files a structured recommendation (continue,
divert or hold) that a supervisor accepts or rejects. Every tool call is
kept, so the page can show what the agent looked at.

With no Gemini key, or if Gemini fails, the same tools drive a
deterministic rule, so the demo never depends on the network.
"""

import json
import logging
import time

from google import genai
from google.genai import types
from sqlmodel import Session, select

from app.config import get_settings
from app.engine.profiles import PRODUCTS_BY_ID
from app.models import Box, Custody, Facility, Node, TextCache
from app.services import twin as twin_service
from app.services.climate import ROAD_FACTOR, haversine_km, stores_at_risk
from app.services.report import evaluate_box, place_key

log = logging.getLogger(__name__)

SPEED_KMH = 30.0
MAX_TURNS = 6
SAFE_BREACH_P = 0.2
DEADLINE_S = 25  # the whole Gemini conversation, not each turn

SYSTEM = """You dispatch vaccine carriers for a district health office in western Kenya.
Decide what the driver of one carrier should do right now: CONTINUE to the destination,
DIVERT to a nearby facility with a working fridge, or HOLD (stop and keep the carrier in
shade while help comes). Use the tools; never invent facilities, distances or numbers.
Plan on the pessimistic end of the forecast (P10 minutes until it leaves 2-8 C).
Prefer CONTINUE when the chance of leaving 2-8 C before arriving is low (< 20%), and name
the nearest fridge as a fallback. Otherwise DIVERT to the closest facility the carrier is
likely to reach in range. Explain in plain words a driver understands. Finish by calling
submit_recommendation."""

DECLARATIONS = [
    types.FunctionDeclaration(
        name="get_carrier_status",
        description="Where the carrier is, what it holds, and its digital-twin forecast.",
        parameters_json_schema={"type": "object", "properties": {}, "required": []},
    ),
    types.FunctionDeclaration(
        name="find_facilities",
        description="Stores and clinics with fridges near the carrier, nearest first, with drive time and today's heat risk.",
        parameters_json_schema={
            "type": "object",
            "properties": {"max_km": {"type": "number", "description": "Search radius in km (default 60)"}},
        },
    ),
    types.FunctionDeclaration(
        name="breach_chance_before_arrival",
        description="Chance the carrier leaves 2-8 C before it could reach a facility.",
        parameters_json_schema={
            "type": "object",
            "properties": {"facility_id": {"type": "string"}},
            "required": ["facility_id"],
        },
    ),
    types.FunctionDeclaration(
        name="submit_recommendation",
        description="File the final recommendation for the supervisor.",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["CONTINUE", "DIVERT", "HOLD", "UNKNOWN"]},
                "facility_id": {"type": "string", "description": "Where to go (destination or diversion); empty for HOLD"},
                "summary": {"type": "string", "description": "One or two sentences for the driver"},
                "reasons": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["action", "summary", "reasons"],
        },
    ),
]


class Tools:
    """What the agent (or the fallback rule) can look at."""

    def __init__(self, session: Session, node_id: str, destination_id: str | None):
        self.session, self.node_id, self.destination_id = session, node_id, destination_id
        self._forecast = twin_service.carrier_forecast(session, node_id)
        self.steps: list[dict] = []

    def position(self) -> tuple[float, float] | None:
        readings = twin_service.carrier_readings(self.session, self.node_id, int(time.time()) - 6 * 3600, int(time.time()))
        located = [r for r in readings if r.lat is not None]
        return (located[-1].lat, located[-1].lon) if located else None

    def _log(self, tool: str, args: dict, result):
        self.steps.append({"tool": tool, "args": args, "result": result})
        return result

    def get_carrier_status(self) -> dict:
        node = self.session.get(Node, self.node_id)
        pos = self.position()
        place = self.session.get(TextCache, place_key(*pos)) if pos else None
        boxes = []
        for c in self.session.exec(select(Custody).where(Custody.node_id == self.node_id, Custody.end_ts.is_(None))).all():
            box = self.session.get(Box, c.box_id)
            report = evaluate_box(self.session, box)
            boxes.append({"box": box.id, "product": PRODUCTS_BY_ID[box.product_id].name, "verdict": report.verdict,
                          "budget_used_pct": round(report.budget_used * 100)})
        f = self._forecast
        now = time.time()
        minutes = lambda ts: None if ts is None else round((ts - now) / 60)  # noqa: E731
        status = {
            "carrier": node.label,
            "position": {"lat": pos[0], "lon": pos[1], "place": place.text if place else None} if pos else None,
            "boxes": boxes,
            "destination_id": self.destination_id,
        }
        if not f.get("available"):
            status["forecast_unavailable"] = f.get("reason", "no forecast")
        else:
            status["forecast"] = {
                "inside_now_c": f["state"]["inside_c"], "outside_now_c": f["state"]["outside_c"],
                "ice_left_hours_p10_p50_p90": f["state"]["ice_left_h"],
                "chance_leaves_2_8C_within_12h": f["breach"]["prob"],
                "minutes_until_it_leaves_2_8C_p10_p50_p90": [minutes(f["breach"][k]) for k in ("p10", "p50", "p90")],
            }
        return self._log("get_carrier_status", {}, status)

    def find_facilities(self, max_km: float = 60.0) -> list[dict]:
        pos = self.position()
        risk = {f["id"]: f for f in stores_at_risk(self.session)["facilities"]}
        rows = []
        for f in self.session.exec(select(Facility)).all():
            # Only somewhere with a fridge can take the boxes; the destination is
            # listed either way, with the truth about its fridge.
            if not f.has_fridge and f.id != self.destination_id:
                continue
            km = haversine_km(pos, (f.lat, f.lon)) * ROAD_FACTOR if pos else None
            if km is not None and km > max_km:
                continue
            rows.append({
                "facility_id": f.id, "name": f.name, "kind": f.kind, "has_fridge": f.has_fridge,
                "road_km": round(km, 1) if km is not None else None,
                "drive_minutes": round(km / SPEED_KMH * 60) if km is not None else None,
                "heat_risk_today": risk.get(f.id, {}).get("risk"),
                "is_destination": f.id == self.destination_id,
            })
        rows.sort(key=lambda r: (r["drive_minutes"] is None, r["drive_minutes"] or 0))
        return self._log("find_facilities", {"max_km": max_km}, rows)

    def breach_chance_before_arrival(self, facility_id: str) -> dict:
        f = self.session.get(Facility, facility_id)
        pos = self.position()
        if f is None or pos is None:
            return self._log("breach_chance_before_arrival", {"facility_id": facility_id}, {"error": "unknown facility or position"})
        minutes = haversine_km(pos, (f.lat, f.lon)) * ROAD_FACTOR / SPEED_KMH * 60
        p = twin_service.p_breach_within(self.session, self.node_id, minutes)
        return self._log(
            "breach_chance_before_arrival", {"facility_id": facility_id},
            {"facility": f.name, "drive_minutes": round(minutes), "chance_leaves_2_8C_first": p},
        )


def _chance(result: dict) -> float:
    p = result.get("chance_leaves_2_8C_first")
    return 1.0 if p is None else p


def rule_based(tools: Tools) -> dict:
    """The fallback: the same tools, a fixed decision rule.

    Plan on the pessimistic end of the forecast (P10: 90% of forecast runs
    keep the carrier in range at least this long).
    """
    status = tools.get_carrier_status()
    if "forecast" not in status:
        # No twin forecast (demo time, too few readings, not a carrier): say so
        # rather than guess. The node page still shows the live temperature.
        return {"action": "UNKNOWN", "facility_id": "",
                "summary": f"Can't forecast this carrier: {status.get('forecast_unavailable', 'no data')}. "
                           "Check its temperature on the node page before deciding.",
                "reasons": ["No forecast available, so no recommendation either way."]}
    near = tools.find_facilities()
    forecast = status["forecast"]
    p10 = (forecast.get("minutes_until_it_leaves_2_8C_p10_p50_p90") or [None])[0]

    def nearest_safe(exclude: str | None = None) -> tuple[dict, dict] | None:
        for f in near:
            if f["facility_id"] == exclude or not f["has_fridge"]:
                continue
            check = tools.breach_chance_before_arrival(f["facility_id"])
            if _chance(check) < SAFE_BREACH_P:
                return f, check
        return None

    if tools.destination_id:
        dest = tools.breach_chance_before_arrival(tools.destination_id)
        if _chance(dest) < SAFE_BREACH_P:
            return {"action": "CONTINUE", "facility_id": tools.destination_id,
                    "summary": f"Keep going to {dest['facility']} ({dest['drive_minutes']} min): it should arrive in range.",
                    "reasons": [f"{round(_chance(dest) * 100)}% chance of leaving 2-8 C before arriving."]}
    elif p10 is None or p10 > 90:
        safe = nearest_safe()
        fallback = f" If you're delayed, the nearest fridge is {safe[0]['name']} ({safe[0]['drive_minutes']} min)." if safe else ""
        cold = "no breach expected in the next 12 h" if p10 is None else f"at least {p10} min of reliable cold left"
        return {"action": "CONTINUE", "facility_id": "",
                "summary": f"Carry on: {cold}.{fallback}",
                "reasons": [f"Twin forecast: {cold} (90% of forecast runs)."]}

    safe = nearest_safe(exclude=tools.destination_id)
    if safe:
        f, check = safe
        why_not = ("the destination is too far for the ice that's left" if tools.destination_id
                   else f"the carrier may leave 2-8 C within {p10} min")
        return {"action": "DIVERT", "facility_id": f["facility_id"],
                "summary": f"Divert to {f['name']} ({f['drive_minutes']} min) and put the boxes in its fridge.",
                "reasons": [f"Divert because {why_not}.",
                            f"{f['name']} is the closest fridge it should reach in range "
                            f"({round(_chance(check) * 100)}% risk)."]}
    return {"action": "HOLD", "facility_id": "",
            "summary": "No fridge is reachable in time: stop in shade and call for a cold box.",
            "reasons": ["Every nearby facility is further than the carrier's remaining cold."]}


def _gemini_agent(tools: Tools, question: str) -> dict | None:
    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)
    started = time.monotonic()
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM,
        tools=[types.Tool(function_declarations=DECLARATIONS)],
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        temperature=0.2,
    )
    prompt = json.dumps({"carrier": tools.node_id, "destination_id": tools.destination_id, "question": question})
    contents: list[types.Content] = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
    handlers = {
        "get_carrier_status": lambda **_: tools.get_carrier_status(),
        "find_facilities": lambda **a: tools.find_facilities(float(a.get("max_km", 60))),
        "breach_chance_before_arrival": lambda **a: tools.breach_chance_before_arrival(str(a.get("facility_id", ""))),
    }
    for _ in range(MAX_TURNS):
        if time.monotonic() - started > DEADLINE_S:
            log.warning("gemini agent ran out of time")
            return None
        resp = client.models.generate_content(model=settings.gemini_model, contents=contents, config=config)
        content = resp.candidates[0].content
        contents.append(content)
        calls = [p.function_call for p in content.parts or [] if p.function_call]
        if not calls:
            contents.append(types.Content(role="user", parts=[types.Part.from_text(text="Call submit_recommendation now.")]))
            continue
        replies = []
        for call in calls:
            args = dict(call.args or {})
            if call.name == "submit_recommendation":
                return args
            result = handlers[call.name](**args) if call.name in handlers else {"error": "unknown tool"}
            replies.append(types.Part.from_function_response(name=call.name, response={"result": result}))
        contents.append(types.Content(role="user", parts=replies))
    return None


def recommend(session: Session, node_id: str, destination_id: str | None, question: str) -> dict:
    """Synchronous on purpose: FastAPI runs it in the threadpool, so the particle
    filter, database and Gemini calls never block other requests."""
    tools = Tools(session, node_id, destination_id)
    rec, source = None, "rules"
    if get_settings().gemini_api_key:
        try:
            rec = _gemini_agent(tools, question)
            source = "gemini" if rec else "rules"
        except Exception as exc:
            log.warning("gemini location agent failed: %r", exc)
    if rec is None:
        tools.steps.clear()
        rec = rule_based(tools)
    facility = session.get(Facility, rec.get("facility_id") or "") if rec.get("facility_id") else None
    pos = tools.position()
    eta = round(haversine_km(pos, (facility.lat, facility.lon)) * ROAD_FACTOR / SPEED_KMH * 60) if facility and pos else None
    return {
        "node_id": node_id,
        "source": source,
        "recommendation": {
            "action": rec.get("action", "HOLD"),
            "facility_id": facility.id if facility else None,
            "facility_name": facility.name if facility else None,
            "eta_min": eta,
            "summary": rec.get("summary", ""),
            "reasons": rec.get("reasons", []),
        },
        "steps": tools.steps,
    }
