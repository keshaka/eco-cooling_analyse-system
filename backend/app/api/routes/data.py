import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.crud.data import (
    create_moss_data,
    create_non_moss_data,
    get_comparison_metrics,
    get_history,
    get_latest_moss,
    get_latest_non_moss,
)
from app.core.database import get_db
from app.models.tables import MossData, NonMossData
from app.schemas.data import (
    CompareResponse,
    HistoryQuery,
    HistoryResponse,
    LatestDataResponse,
    MossDataCreate,
    MossDataRead,
    NonMossDataCreate,
    NonMossDataRead,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/data", tags=["Data"])

IST = timezone(timedelta(hours=5, minutes=30))


def _to_ist(timestamp: datetime) -> datetime:
    # Treat naive DB timestamps as UTC and return timezone-aware IST.
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(IST)


def _map_moss(row: MossData) -> MossDataRead:
    return MossDataRead(
        id=row.id,
        outdoorTemp=row.outdoor_temp,
        outdoorHumidity=row.outdoor_humidity,
        mossSurfaceTemp=row.moss_surface_temp,
        nearMossTemp=row.near_moss_temp,
        nearMossHumidity=row.near_moss_humidity,
        wallTemp=row.wall_temp,
        timestamp=_to_ist(row.timestamp),
    )


def _map_non_moss(row: NonMossData) -> NonMossDataRead:
    return NonMossDataRead(
        id=row.id,
        nonMossSurfaceTemp=row.non_moss_surface_temp,
        nearNonMossTemp=row.near_non_moss_temp,
        nearNonMossHumidity=row.near_non_moss_humidity,
        wallTemp=row.wall_temp,
        timestamp=_to_ist(row.timestamp),
    )


@router.post("/moss", response_model=MossDataRead, status_code=201)
def ingest_moss_data(payload: MossDataCreate, db: Session = Depends(get_db)):
    try:
        created = create_moss_data(db, payload)
        logger.info("Stored moss data at %s", created.timestamp)
        return _map_moss(created)
    except SQLAlchemyError as exc:
        logger.exception("Database error while storing moss data")
        raise HTTPException(status_code=500, detail="Unable to store moss data") from exc


@router.post("/non-moss", response_model=NonMossDataRead, status_code=201)
def ingest_non_moss_data(payload: NonMossDataCreate, db: Session = Depends(get_db)):
    try:
        created = create_non_moss_data(db, payload)
        logger.info("Stored non-moss data at %s", created.timestamp)
        return _map_non_moss(created)
    except SQLAlchemyError as exc:
        logger.exception("Database error while storing non-moss data")
        raise HTTPException(status_code=500, detail="Unable to store non-moss data") from exc


@router.get("/latest", response_model=LatestDataResponse)
def latest_data(db: Session = Depends(get_db)):
    moss = get_latest_moss(db)
    non_moss = get_latest_non_moss(db)

    cooling_delta = None
    if moss is not None and non_moss is not None:
        cooling_delta = round(non_moss.non_moss_surface_temp - moss.moss_surface_temp, 3)

    return LatestDataResponse(
        moss=_map_moss(moss) if moss else None,
        nonMoss=_map_non_moss(non_moss) if non_moss else None,
        coolingDeltaSurface=cooling_delta,
    )


@router.get("/history", response_model=HistoryResponse)
def historical_data(
    start: str = Query(..., description="Start date in YYYY-MM-DD"),
    end: str = Query(..., description="End date in YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    try:
        params = HistoryQuery(start=start, end=end)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        moss_rows, non_moss_rows = get_history(db, params.start, params.end)
        return HistoryResponse(
            moss=[_map_moss(row) for row in moss_rows],
            nonMoss=[_map_non_moss(row) for row in non_moss_rows],
        )
    except SQLAlchemyError as exc:
        logger.exception("Database error while reading history")
        raise HTTPException(status_code=500, detail="Unable to fetch historical data") from exc


@router.get("/compare", response_model=CompareResponse)
def compare_data(db: Session = Depends(get_db)):
    try:
        payload = get_comparison_metrics(db)
        return CompareResponse(**payload)
    except SQLAlchemyError as exc:
        logger.exception("Database error while comparing data")
        raise HTTPException(status_code=500, detail="Unable to compare data") from exc
