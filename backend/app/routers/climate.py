from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.db import get_session
from app.engine.profiles import PRODUCTS_BY_ID
from app.models import Facility, Node
from app.security import plan_limit
from app.services import climate

router = APIRouter(prefix="/api", tags=["climate"])


class PlanIn(BaseModel):
    product_id: str
    origin_id: str | None = None  # default: the first store
    destination_ids: list[str] | None = None
    carrier_id: str | None = None
    cold_life_h: float | None = Field(None, gt=0, le=200)
    session_h: float = Field(6.0, ge=0, le=24)
    speed_kmh: float = Field(30.0, gt=0, le=120)


@router.get("/facilities")
def facilities(session: Session = Depends(get_session)) -> list[dict]:
    return [f.model_dump() for f in session.exec(select(Facility).order_by(Facility.kind, Facility.name)).all()]


@router.get("/climate/stores")
def stores_at_risk(session: Session = Depends(get_session)) -> dict:
    return climate.stores_at_risk(session)


@router.get("/climate/carriers")
def carriers(session: Session = Depends(get_session)) -> list[dict]:
    return climate.carrier_performance(session)


@router.post("/climate/plan", dependencies=[Depends(plan_limit)])
def plan(body: PlanIn, session: Session = Depends(get_session)) -> dict:
    if body.product_id not in PRODUCTS_BY_ID:
        raise HTTPException(404, f"no product {body.product_id}")
    if body.origin_id is None:
        first = session.exec(select(Facility).where(Facility.kind == "store").order_by(Facility.id)).first()
        if first is None:
            raise HTTPException(404, "no stores to plan from")
        body.origin_id = first.id
    if session.get(Facility, body.origin_id) is None:
        raise HTTPException(404, f"no facility {body.origin_id}")
    if body.carrier_id and session.get(Node, body.carrier_id) is None:
        raise HTTPException(404, f"no node {body.carrier_id}")
    return climate.plan_trips(session, **body.model_dump())


_impact: dict | None = None


@router.get("/impact")
def impact() -> dict:
    """The 90-day backtest on real ERA5 weather: today vs alarm logger vs Vialtality."""
    global _impact
    if _impact is None:
        from app.backtest.simulate import load_results

        _impact = load_results()
    return _impact
