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
    get_history_paginated,
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
    MergedRow,
    MossDataCreate,
    MossDataRead,
    NonMossDataCreate,
    NonMossDataRead,
    PaginatedHistoryResponse,
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
    if (
        moss is not None
        and non_moss is not None
        and moss.moss_surface_temp is not None
        and non_moss.non_moss_surface_temp is not None
    ):
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


@router.get("/history/paginated", response_model=PaginatedHistoryResponse)
def paginated_history(
    start: str = Query(..., description="Start date in YYYY-MM-DD"),
    end: str = Query(..., description="End date in YYYY-MM-DD"),
    page: int = Query(1, ge=1, description="Page number (1-based)"),
    per_page: int = Query(30, ge=1, description="Rows per page"),
    db: Session = Depends(get_db),
):
    try:
        params = HistoryQuery(start=start, end=end)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        rows, total = get_history_paginated(db, params.start, params.end, page, per_page)
        total_pages = max(1, -(-total // per_page))  # ceil division

        # Convert timestamps to IST
        mapped_rows = []
        for row in rows:
            r = dict(row)
            if r.get("timestamp"):
                r["timestamp"] = _to_ist(r["timestamp"])
            mapped_rows.append(MergedRow(**r))

        return PaginatedHistoryResponse(
            rows=mapped_rows,
            page=page,
            perPage=per_page,
            totalRows=total,
            totalPages=total_pages,
        )
    except SQLAlchemyError as exc:
        logger.exception("Database error while reading paginated history")
        raise HTTPException(status_code=500, detail="Unable to fetch historical data") from exc


@router.get("/compare", response_model=CompareResponse)
def compare_data(db: Session = Depends(get_db)):
    try:
        payload = get_comparison_metrics(db)
        return CompareResponse(**payload)
    except SQLAlchemyError as exc:
        logger.exception("Database error while comparing data")
        raise HTTPException(status_code=500, detail="Unable to compare data") from exc
