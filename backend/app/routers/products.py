from dataclasses import asdict

from fastapi import APIRouter

from app.engine.profiles import PRODUCTS

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("")
def list_products() -> list[dict]:
    return [asdict(p) for p in PRODUCTS]
