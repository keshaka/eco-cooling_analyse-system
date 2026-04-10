from datetime import datetime, time
from statistics import mean
from typing import Optional

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models.tables import MossData, NonMossData
from app.schemas.data import MossDataCreate, NonMossDataCreate


def create_moss_data(db: Session, payload: MossDataCreate) -> MossData:
    current_time = datetime.now()
    row = MossData(
        outdoor_temp=payload.outdoorTemp,
        outdoor_humidity=payload.outdoorHumidity,
        moss_surface_temp=payload.mossSurfaceTemp,
        near_moss_temp=payload.nearMossTemp,
        near_moss_humidity=payload.nearMossHumidity,
        wall_temp=payload.wallTemp,
        timestamp=current_time,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def create_non_moss_data(db: Session, payload: NonMossDataCreate) -> NonMossData:
    current_time = datetime.now()
    row = NonMossData(
        non_moss_surface_temp=payload.nonMossSurfaceTemp,
        near_non_moss_temp=payload.nearNonMossTemp,
        near_non_moss_humidity=payload.nearNonMossHumidity,
        wall_temp=payload.wallTemp,
        timestamp=current_time,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_latest_moss(db: Session) -> Optional[MossData]:
    stmt = select(MossData).order_by(desc(MossData.timestamp)).limit(1)
    return db.execute(stmt).scalar_one_or_none()


def get_latest_non_moss(db: Session) -> Optional[NonMossData]:
    stmt = select(NonMossData).order_by(desc(NonMossData.timestamp)).limit(1)
    return db.execute(stmt).scalar_one_or_none()


def get_history(db: Session, start_date, end_date):
    start_dt = datetime.combine(start_date, time.min)
    end_dt = datetime.combine(end_date, time.max)

    moss_stmt = (
        select(MossData)
        .where(MossData.timestamp >= start_dt, MossData.timestamp <= end_dt)
        .order_by(MossData.timestamp.asc())
    )
    non_moss_stmt = (
        select(NonMossData)
        .where(NonMossData.timestamp >= start_dt, NonMossData.timestamp <= end_dt)
        .order_by(NonMossData.timestamp.asc())
    )

    moss_rows = list(db.execute(moss_stmt).scalars().all())
    non_moss_rows = list(db.execute(non_moss_stmt).scalars().all())

    return moss_rows, non_moss_rows


def _avg_or_none(values: list[float]) -> Optional[float]:
    if not values:
        return None
    return round(mean(values), 3)


def get_comparison_metrics(db: Session):
    # Pull averages directly from SQL Server for efficiency.
    moss_avg_stmt = select(
        func.avg(MossData.moss_surface_temp),
        func.avg(MossData.near_moss_temp),
        func.avg(MossData.near_moss_humidity),
        func.avg(MossData.wall_temp),
    )
    non_moss_avg_stmt = select(
        func.avg(NonMossData.non_moss_surface_temp),
        func.avg(NonMossData.near_non_moss_temp),
        func.avg(NonMossData.near_non_moss_humidity),
        func.avg(NonMossData.wall_temp),
    )

    moss_avgs = db.execute(moss_avg_stmt).one()
    non_moss_avgs = db.execute(non_moss_avg_stmt).one()

    moss_surface, moss_air_temp, moss_air_humidity, moss_wall = [
        float(v) if v is not None else None for v in moss_avgs
    ]
    non_surface, non_air_temp, non_air_humidity, non_wall = [
        float(v) if v is not None else None for v in non_moss_avgs
    ]

    def metric_block(moss_value: Optional[float], non_value: Optional[float]):
        diff = None
        if moss_value is not None and non_value is not None:
            diff = round(non_value - moss_value, 3)
        return {
            "mossAverage": round(moss_value, 3) if moss_value is not None else None,
            "nonMossAverage": round(non_value, 3) if non_value is not None else None,
            "difference": diff,
        }

    return {
        "surfaceTemperature": metric_block(moss_surface, non_surface),
        "nearAirTemperature": metric_block(moss_air_temp, non_air_temp),
        "nearAirHumidity": metric_block(moss_air_humidity, non_air_humidity),
        "wallTemperature": metric_block(moss_wall, non_wall),
    }
