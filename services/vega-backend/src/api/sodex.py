from fastapi import APIRouter, HTTPException, Query

from ..services.sodex_client import SoDEXClient, SoDEXError

router = APIRouter(prefix="/sodex", tags=["sodex"])


@router.get("/markets")
async def markets() -> dict[str, object]:
    try:
        data = await SoDEXClient().markets()
    except SoDEXError as exc:
        raise HTTPException(status_code=exc.status, detail={"body": exc.body}) from exc
    return {"data": data}


@router.get("/orderbook")
async def orderbook(symbol: str = Query(...)) -> dict[str, object]:
    try:
        data = await SoDEXClient().orderbook(symbol)
    except SoDEXError as exc:
        raise HTTPException(status_code=exc.status, detail={"body": exc.body}) from exc
    return {"data": data}
