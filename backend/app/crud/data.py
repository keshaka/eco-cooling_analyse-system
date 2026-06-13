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


# ── Server-side merge + pagination ──────────────────────────────────

_MAX_MERGE_GAP_MS = 2 * 60 * 1000  # 2 minutes


def _ts_ms(value):
    """Return milliseconds since epoch for a datetime, or None."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.timestamp() * 1000
    return None


def _lower_bound(rows, target_ms):
    lo, hi = 0, len(rows)
    while lo < hi:
        mid = (lo + hi) // 2
        mid_ms = _ts_ms(rows[mid].timestamp)
        if mid_ms is None or mid_ms < target_ms:
            lo = mid + 1
        else:
            hi = mid
    return lo


def _find_nearest_unmatched(rows, used, target_ms):
    if not rows or target_ms is None:
        return -1
    pivot = _lower_bound(rows, target_ms)
    left, right = pivot - 1, pivot
    best_idx, best_diff = -1, float("inf")

    while left >= 0 or right < len(rows):
        checked = False
        if left >= 0:
            checked = True
            if left not in used:
                ms = _ts_ms(rows[left].timestamp)
                if ms is not None:
                    d = abs(ms - target_ms)
                    if d < best_diff:
                        best_diff, best_idx = d, left
            left -= 1
        if right < len(rows):
            checked = True
            if right not in used:
                ms = _ts_ms(rows[right].timestamp)
                if ms is not None:
                    d = abs(ms - target_ms)
                    if d < best_diff:
                        best_diff, best_idx = d, right
            right += 1

        l_ms = _ts_ms(rows[left].timestamp) if left >= 0 else None
        r_ms = _ts_ms(rows[right].timestamp) if right < len(rows) else None
        l_gap = float("inf") if l_ms is None else abs(target_ms - l_ms)
        r_gap = float("inf") if r_ms is None else abs(r_ms - target_ms)
        if not checked or (best_idx != -1 and l_gap > best_diff and r_gap > best_diff):
            break

    return -1 if best_idx == -1 or best_diff > _MAX_MERGE_GAP_MS else best_idx


def _to_merged_dict(moss, non, ts):
    return {
        "timestamp": (ts or (moss.timestamp if moss else None)
                      or (non.timestamp if non else None)),
        "outdoorTemp": moss.outdoor_temp if moss else None,
        "outdoorHumidity": moss.outdoor_humidity if moss else None,
        "mossSurfaceTemp": moss.moss_surface_temp if moss else None,
        "nearMossTemp": moss.near_moss_temp if moss else None,
        "nearMossHumidity": moss.near_moss_humidity if moss else None,
        "mossWallTemp": moss.wall_temp if moss else None,
        "nonMossSurfaceTemp": non.non_moss_surface_temp if non else None,
        "nearNonMossTemp": non.near_non_moss_temp if non else None,
        "nearNonMossHumidity": non.near_non_moss_humidity if non else None,
        "nonMossWallTemp": non.wall_temp if non else None,
    }


def _merge_rows(moss_rows, non_moss_rows):
    """Merge moss and non-moss ORM rows by nearest timestamp."""
    if not moss_rows:
        return [_to_merged_dict(None, n, n.timestamp) for n in non_moss_rows]
    if not non_moss_rows:
        return [_to_merged_dict(m, None, m.timestamp) for m in moss_rows]

    primary_is_moss = len(moss_rows) >= len(non_moss_rows)
    primary = moss_rows if primary_is_moss else non_moss_rows
    secondary = non_moss_rows if primary_is_moss else moss_rows
    used: set[int] = set()
    merged = []

    for row in primary:
        row_ms = _ts_ms(row.timestamp)
        idx = _find_nearest_unmatched(secondary, used, row_ms)
        nearest = secondary[idx] if idx >= 0 else None
        if idx >= 0:
            used.add(idx)
        moss = row if primary_is_moss else nearest
        non = nearest if primary_is_moss else row
        merged.append(_to_merged_dict(moss, non, row.timestamp))

    for i, row in enumerate(secondary):
        if i in used:
            continue
        moss = None if primary_is_moss else row
        non = row if primary_is_moss else None
        merged.append(_to_merged_dict(moss, non, row.timestamp))

    merged.sort(key=lambda r: r["timestamp"] or datetime.min)
    return merged


def get_history_paginated(db: Session, start_date, end_date, page: int = 1, per_page: int = 30):
    """Return ``(page_rows, total_count)`` of merged history."""
    moss_rows, non_moss_rows = get_history(db, start_date, end_date)
    merged = _merge_rows(moss_rows, non_moss_rows)
    total = len(merged)
    start_idx = (page - 1) * per_page
    return merged[start_idx:start_idx + per_page], total


# ── Comparison metrics ──────────────────────────────────────────────

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
