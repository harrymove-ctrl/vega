from fastapi import APIRouter, HTTPException, Query

from ..services.sosovalue_client import SoSoValueClient, SoSoValueError

router = APIRouter(prefix="/sosovalue", tags=["sosovalue"])


@router.get("/etf")
async def etf_overview() -> dict[str, object]:
    try:
        data = await SoSoValueClient().etf_overview()
    except SoSoValueError as exc:
        raise HTTPException(status_code=exc.status, detail={"body": exc.body}) from exc
    return {"data": data}


@router.get("/news")
async def featured_news(currency: str = Query("BTC")) -> dict[str, object]:
    try:
        data = await SoSoValueClient().featured_news(currency)
    except SoSoValueError as exc:
        raise HTTPException(status_code=exc.status, detail={"body": exc.body}) from exc
    return {"data": data}
