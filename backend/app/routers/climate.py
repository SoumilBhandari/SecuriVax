from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.db import get_session
from app.models import Facility
from app.services import climate

router = APIRouter(prefix="/api", tags=["climate"])


@router.get("/facilities")
def facilities(session: Session = Depends(get_session)) -> list[dict]:
    return [f.model_dump() for f in session.exec(select(Facility).order_by(Facility.kind, Facility.name)).all()]


@router.get("/climate/stores")
def stores_at_risk(session: Session = Depends(get_session)) -> dict:
    return climate.stores_at_risk(session)


@router.get("/climate/carriers")
def carriers(session: Session = Depends(get_session)) -> list[dict]:
    return climate.carrier_performance(session)




_impact: dict | None = None


@router.get("/impact")
def impact() -> dict:
    """The 90-day backtest on real ERA5 weather: today vs alarm logger vs SecuriVax."""
    global _impact
    if _impact is None:
        from app.backtest.simulate import load_results

        _impact = load_results()
    return _impact
