from datetime import datetime, time
from statistics import mean
from typing import Optional

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models.tables import MossData, NonMossData
from app.schemas.data import MossDataCreate, NonMossDataCreate


MOSS_VALID_CONDITIONS = [
    MossData.outdoor_temp >= 0,
    MossData.outdoor_humidity >= 0,
    MossData.moss_surface_temp >= 0,
    MossData.near_moss_temp >= 0,
    MossData.near_moss_humidity >= 0,
    MossData.wall_temp >= 0,
]

NON_MOSS_VALID_CONDITIONS = [
    NonMossData.non_moss_surface_temp >= 0,
    NonMossData.near_non_moss_temp >= 0,
    NonMossData.near_non_moss_humidity >= 0,
    NonMossData.wall_temp >= 0,
]

MOSS_VALID_SQL = [
    "m.outdoor_temp >= 0",
    "m.outdoor_humidity >= 0",
    "m.moss_surface_temp >= 0",
    "m.near_moss_temp >= 0",
    "m.near_moss_humidity >= 0",
    "m.wall_temp >= 0",
]

NON_MOSS_VALID_SQL = [
    "n.non_moss_surface_temp >= 0",
    "n.near_non_moss_temp >= 0",
    "n.near_non_moss_humidity >= 0",
    "n.wall_temp >= 0",
]


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
    stmt = select(MossData).where(*MOSS_VALID_CONDITIONS).order_by(desc(MossData.timestamp)).limit(1)
    return db.execute(stmt).scalar_one_or_none()


def get_latest_non_moss(db: Session) -> Optional[NonMossData]:
    stmt = select(NonMossData).where(*NON_MOSS_VALID_CONDITIONS).order_by(desc(NonMossData.timestamp)).limit(1)
    return db.execute(stmt).scalar_one_or_none()


def get_history(
    db: Session,
    start_date,
    end_date,
    start_time: Optional[time] = None,
    end_time: Optional[time] = None,
    min_humidity: Optional[float] = None,
    max_humidity: Optional[float] = None,
):
    from sqlalchemy import cast, Time
    start_dt = datetime.combine(start_date, time.min)
    end_dt = datetime.combine(end_date, time.max)

    moss_stmt = select(MossData).where(MossData.timestamp >= start_dt, MossData.timestamp <= end_dt, *MOSS_VALID_CONDITIONS)
    non_moss_stmt = select(NonMossData).where(NonMossData.timestamp >= start_dt, NonMossData.timestamp <= end_dt, *NON_MOSS_VALID_CONDITIONS)

    if start_time is not None:
        moss_stmt = moss_stmt.where(cast(MossData.timestamp, Time) >= start_time)
        non_moss_stmt = non_moss_stmt.where(cast(NonMossData.timestamp, Time) >= start_time)
    if end_time is not None:
        moss_stmt = moss_stmt.where(cast(MossData.timestamp, Time) <= end_time)
        non_moss_stmt = non_moss_stmt.where(cast(NonMossData.timestamp, Time) <= end_time)
    if min_humidity is not None:
        moss_stmt = moss_stmt.where(MossData.outdoor_humidity >= min_humidity, MossData.near_moss_humidity >= min_humidity)
        non_moss_stmt = non_moss_stmt.where(NonMossData.near_non_moss_humidity >= min_humidity)
    if max_humidity is not None:
        moss_stmt = moss_stmt.where(MossData.outdoor_humidity <= max_humidity, MossData.near_moss_humidity <= max_humidity)
        non_moss_stmt = non_moss_stmt.where(NonMossData.near_non_moss_humidity <= max_humidity)

    moss_stmt = moss_stmt.order_by(MossData.timestamp.asc())
    non_moss_stmt = non_moss_stmt.order_by(NonMossData.timestamp.asc())

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


def get_history_paginated(
    db: Session,
    start_date,
    end_date,
    page: int = 1,
    per_page: int = 30,
    start_time: Optional[time] = None,
    end_time: Optional[time] = None,
    min_humidity: Optional[float] = None,
    max_humidity: Optional[float] = None,
):
    """Return ``(page_rows, total_count)`` of merged history."""
    moss_rows, non_moss_rows = get_history(db, start_date, end_date, start_time, end_time, min_humidity, max_humidity)
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
    ).where(*MOSS_VALID_CONDITIONS)
    non_moss_avg_stmt = select(
        func.avg(NonMossData.non_moss_surface_temp),
        func.avg(NonMossData.near_non_moss_temp),
        func.avg(NonMossData.near_non_moss_humidity),
        func.avg(NonMossData.wall_temp),
    ).where(*NON_MOSS_VALID_CONDITIONS)

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


# ── Analysis report queries (hourly-averaged) ──────────────────────

def _safe_round(v, decimals=3):
    return round(float(v), decimals) if v is not None else None


def get_analysis_data(
    db: Session,
    start_date=None,
    end_date=None,
    start_time: Optional[time] = None,
    end_time: Optional[time] = None,
    min_humidity: Optional[float] = None,
    max_humidity: Optional[float] = None,
):
    """
    Return hourly-averaged, merged analysis data.

    Each row represents one clock-hour, with averages of all sensor
    readings that fell within that hour.  Optionally filtered by date
    range (inclusive) and by outdoor-humidity range.
    """
    from sqlalchemy import text

    # ── Build WHERE fragments ──────────────────────────────────────
    moss_wheres, nm_wheres = list(MOSS_VALID_SQL), list(NON_MOSS_VALID_SQL)
    params: dict = {}

    if start_date is not None:
        moss_wheres.append("m.[timestamp] >= :start_dt")
        nm_wheres.append("n.[timestamp] >= :start_dt")
        params["start_dt"] = datetime.combine(start_date, time.min)

    if end_date is not None:
        moss_wheres.append("m.[timestamp] <= :end_dt")
        nm_wheres.append("n.[timestamp] <= :end_dt")
        params["end_dt"] = datetime.combine(end_date, time.max)

    if start_time is not None:
        moss_wheres.append("CAST(m.[timestamp] AS TIME) >= :start_tm")
        nm_wheres.append("CAST(n.[timestamp] AS TIME) >= :start_tm")
        params["start_tm"] = start_time
    if end_time is not None:
        moss_wheres.append("CAST(m.[timestamp] AS TIME) <= :end_tm")
        nm_wheres.append("CAST(n.[timestamp] AS TIME) <= :end_tm")
        params["end_tm"] = end_time

    if min_humidity is not None:
        moss_wheres.append("m.outdoor_humidity >= :min_hum")
        moss_wheres.append("m.near_moss_humidity >= :min_hum")
        nm_wheres.append("n.near_non_moss_humidity >= :min_hum")
        params["min_hum"] = min_humidity

    if max_humidity is not None:
        moss_wheres.append("m.outdoor_humidity <= :max_hum")
        moss_wheres.append("m.near_moss_humidity <= :max_hum")
        nm_wheres.append("n.near_non_moss_humidity <= :max_hum")
        params["max_hum"] = max_humidity

    if min_humidity is not None or max_humidity is not None:
        sub_wheres = []
        if min_humidity is not None:
            sub_wheres.append("m_sub.outdoor_humidity >= :min_hum")
        if max_humidity is not None:
            sub_wheres.append("m_sub.outdoor_humidity <= :max_hum")
        sub_where_sql = " AND ".join(sub_wheres)
        nm_wheres.append(f"EXISTS (SELECT 1 FROM dbo.moss_data m_sub WHERE CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, m_sub.[timestamp]), 0) AS DATETIME) = CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, n.[timestamp]), 0) AS DATETIME) AND {sub_where_sql})")

    moss_where_sql = ("WHERE " + " AND ".join(moss_wheres)) if moss_wheres else ""
    nm_where_sql = ("WHERE " + " AND ".join(nm_wheres)) if nm_wheres else ""

    # ── Moss hourly averages ───────────────────────────────────────
    # NOTE: CASE WHEN col > 1 filters out sensor dropout artefacts
    moss_sql = text(f"""
        SELECT
            CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, m.[timestamp]), 0) AS DATETIME) AS hour_bucket,
            AVG(CASE WHEN m.outdoor_temp > 1 THEN m.outdoor_temp END)             AS avg_outdoor_temp,
            AVG(CASE WHEN m.outdoor_humidity > 1 THEN m.outdoor_humidity END)       AS avg_outdoor_humidity,
            AVG(CASE WHEN m.moss_surface_temp > 1 THEN m.moss_surface_temp END)    AS avg_moss_surface_temp,
            AVG(CASE WHEN m.near_moss_temp > 1 THEN m.near_moss_temp END)          AS avg_near_moss_temp,
            AVG(CASE WHEN m.near_moss_humidity > 1 THEN m.near_moss_humidity END)   AS avg_near_moss_humidity,
            AVG(CASE WHEN m.wall_temp > 1 THEN m.wall_temp END)                    AS avg_moss_wall_temp,
            COUNT(*)                  AS record_count
        FROM dbo.moss_data m
        {moss_where_sql}
        GROUP BY CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, m.[timestamp]), 0) AS DATETIME)
        ORDER BY hour_bucket ASC
    """)

    # ── Non-moss hourly averages ───────────────────────────────────
    nm_sql = text(f"""
        SELECT
            CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, n.[timestamp]), 0) AS DATETIME) AS hour_bucket,
            AVG(CASE WHEN n.non_moss_surface_temp > 1 THEN n.non_moss_surface_temp END)    AS avg_non_moss_surface_temp,
            AVG(CASE WHEN n.near_non_moss_temp > 1 THEN n.near_non_moss_temp END)          AS avg_near_non_moss_temp,
            AVG(CASE WHEN n.near_non_moss_humidity > 1 THEN n.near_non_moss_humidity END)   AS avg_near_non_moss_humidity,
            AVG(CASE WHEN n.wall_temp > 1 THEN n.wall_temp END)                            AS avg_non_moss_wall_temp,
            COUNT(*)                      AS record_count
        FROM dbo.non_moss_data n
        {nm_where_sql}
        GROUP BY CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, n.[timestamp]), 0) AS DATETIME)
        ORDER BY hour_bucket ASC
    """)

    moss_rows = db.execute(moss_sql, params).mappings().all()
    nm_rows = db.execute(nm_sql, params).mappings().all()

    # ── Merge on hour_bucket ───────────────────────────────────────
    nm_by_hour = {row["hour_bucket"]: row for row in nm_rows}
    all_hours = set()
    for r in moss_rows:
        all_hours.add(r["hour_bucket"])
    for r in nm_rows:
        all_hours.add(r["hour_bucket"])

    moss_by_hour = {row["hour_bucket"]: row for row in moss_rows}

    merged = []
    for h in sorted(all_hours):
        m = moss_by_hour.get(h)
        n = nm_by_hour.get(h)
        merged.append({
            "timestamp": h.isoformat() if h else None,
            "outdoorTemp": _safe_round(m["avg_outdoor_temp"]) if m else None,
            "outdoorHumidity": _safe_round(m["avg_outdoor_humidity"]) if m else None,
            "mossSurfaceTemp": _safe_round(m["avg_moss_surface_temp"]) if m else None,
            "nearMossTemp": _safe_round(m["avg_near_moss_temp"]) if m else None,
            "nearMossHumidity": _safe_round(m["avg_near_moss_humidity"]) if m else None,
            "mossWallTemp": _safe_round(m["avg_moss_wall_temp"]) if m else None,
            "nonMossSurfaceTemp": _safe_round(n["avg_non_moss_surface_temp"]) if n else None,
            "nearNonMossTemp": _safe_round(n["avg_near_non_moss_temp"]) if n else None,
            "nearNonMossHumidity": _safe_round(n["avg_near_non_moss_humidity"]) if n else None,
            "nonMossWallTemp": _safe_round(n["avg_non_moss_wall_temp"]) if n else None,
        })

    return merged


def get_analysis_descriptive_stats(
    db: Session,
    start_date=None,
    end_date=None,
    start_time: Optional[time] = None,
    end_time: Optional[time] = None,
    min_humidity: Optional[float] = None,
    max_humidity: Optional[float] = None,
):
    """Compute descriptive statistics (mean, stdev, min, max) for each sensor."""
    from sqlalchemy import text

    moss_wheres, nm_wheres = list(MOSS_VALID_SQL), list(NON_MOSS_VALID_SQL)
    params: dict = {}

    if start_date is not None:
        moss_wheres.append("m.[timestamp] >= :start_dt")
        nm_wheres.append("n.[timestamp] >= :start_dt")
        params["start_dt"] = datetime.combine(start_date, time.min)

    if end_date is not None:
        moss_wheres.append("m.[timestamp] <= :end_dt")
        nm_wheres.append("n.[timestamp] <= :end_dt")
        params["end_dt"] = datetime.combine(end_date, time.max)

    if start_time is not None:
        moss_wheres.append("CAST(m.[timestamp] AS TIME) >= :start_tm")
        nm_wheres.append("CAST(n.[timestamp] AS TIME) >= :start_tm")
        params["start_tm"] = start_time
    if end_time is not None:
        moss_wheres.append("CAST(m.[timestamp] AS TIME) <= :end_tm")
        nm_wheres.append("CAST(n.[timestamp] AS TIME) <= :end_tm")
        params["end_tm"] = end_time

    if min_humidity is not None:
        moss_wheres.append("m.outdoor_humidity >= :min_hum")
        moss_wheres.append("m.near_moss_humidity >= :min_hum")
        nm_wheres.append("n.near_non_moss_humidity >= :min_hum")
        params["min_hum"] = min_humidity

    if max_humidity is not None:
        moss_wheres.append("m.outdoor_humidity <= :max_hum")
        moss_wheres.append("m.near_moss_humidity <= :max_hum")
        nm_wheres.append("n.near_non_moss_humidity <= :max_hum")
        params["max_hum"] = max_humidity

    if min_humidity is not None or max_humidity is not None:
        sub_wheres = []
        if min_humidity is not None:
            sub_wheres.append("m_sub.outdoor_humidity >= :min_hum")
        if max_humidity is not None:
            sub_wheres.append("m_sub.outdoor_humidity <= :max_hum")
        sub_where_sql = " AND ".join(sub_wheres)
        nm_wheres.append(f"EXISTS (SELECT 1 FROM dbo.moss_data m_sub WHERE CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, m_sub.[timestamp]), 0) AS DATETIME) = CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, n.[timestamp]), 0) AS DATETIME) AND {sub_where_sql})")

    moss_where = ("WHERE " + " AND ".join(moss_wheres)) if moss_wheres else ""
    nm_where = ("WHERE " + " AND ".join(nm_wheres)) if nm_wheres else ""

    # NOTE: CASE WHEN col > 1 filters out sensor dropout artefacts
    moss_sql = text(f"""
        SELECT
            AVG(CASE WHEN m.outdoor_temp > 1 THEN m.outdoor_temp END)         AS mean_outdoor_temp,
            STDEV(CASE WHEN m.outdoor_temp > 1 THEN m.outdoor_temp END)       AS std_outdoor_temp,
            MIN(CASE WHEN m.outdoor_temp > 1 THEN m.outdoor_temp END)         AS min_outdoor_temp,
            MAX(CASE WHEN m.outdoor_temp > 1 THEN m.outdoor_temp END)         AS max_outdoor_temp,

            AVG(CASE WHEN m.outdoor_humidity > 1 THEN m.outdoor_humidity END)     AS mean_outdoor_humidity,
            STDEV(CASE WHEN m.outdoor_humidity > 1 THEN m.outdoor_humidity END)   AS std_outdoor_humidity,
            MIN(CASE WHEN m.outdoor_humidity > 1 THEN m.outdoor_humidity END)     AS min_outdoor_humidity,
            MAX(CASE WHEN m.outdoor_humidity > 1 THEN m.outdoor_humidity END)     AS max_outdoor_humidity,

            AVG(CASE WHEN m.wall_temp > 1 THEN m.wall_temp END)              AS mean_moss_wall_temp,
            STDEV(CASE WHEN m.wall_temp > 1 THEN m.wall_temp END)            AS std_moss_wall_temp,
            MIN(CASE WHEN m.wall_temp > 1 THEN m.wall_temp END)              AS min_moss_wall_temp,
            MAX(CASE WHEN m.wall_temp > 1 THEN m.wall_temp END)              AS max_moss_wall_temp,

            AVG(CASE WHEN m.moss_surface_temp > 1 THEN m.moss_surface_temp END)    AS mean_moss_surface_temp,
            STDEV(CASE WHEN m.moss_surface_temp > 1 THEN m.moss_surface_temp END)  AS std_moss_surface_temp,
            MIN(CASE WHEN m.moss_surface_temp > 1 THEN m.moss_surface_temp END)    AS min_moss_surface_temp,
            MAX(CASE WHEN m.moss_surface_temp > 1 THEN m.moss_surface_temp END)    AS max_moss_surface_temp,

            AVG(CASE WHEN m.near_moss_humidity > 1 THEN m.near_moss_humidity END)     AS mean_near_moss_humidity,
            STDEV(CASE WHEN m.near_moss_humidity > 1 THEN m.near_moss_humidity END)   AS std_near_moss_humidity,
            MIN(CASE WHEN m.near_moss_humidity > 1 THEN m.near_moss_humidity END)     AS min_near_moss_humidity,
            MAX(CASE WHEN m.near_moss_humidity > 1 THEN m.near_moss_humidity END)     AS max_near_moss_humidity
        FROM dbo.moss_data m
        {moss_where}
    """)

    nm_sql = text(f"""
        SELECT
            AVG(CASE WHEN n.wall_temp > 1 THEN n.wall_temp END)                    AS mean_non_moss_wall_temp,
            STDEV(CASE WHEN n.wall_temp > 1 THEN n.wall_temp END)                  AS std_non_moss_wall_temp,
            MIN(CASE WHEN n.wall_temp > 1 THEN n.wall_temp END)                    AS min_non_moss_wall_temp,
            MAX(CASE WHEN n.wall_temp > 1 THEN n.wall_temp END)                    AS max_non_moss_wall_temp,

            AVG(CASE WHEN n.non_moss_surface_temp > 1 THEN n.non_moss_surface_temp END)    AS mean_non_moss_surface_temp,
            STDEV(CASE WHEN n.non_moss_surface_temp > 1 THEN n.non_moss_surface_temp END)  AS std_non_moss_surface_temp,
            MIN(CASE WHEN n.non_moss_surface_temp > 1 THEN n.non_moss_surface_temp END)    AS min_non_moss_surface_temp,
            MAX(CASE WHEN n.non_moss_surface_temp > 1 THEN n.non_moss_surface_temp END)    AS max_non_moss_surface_temp,

            AVG(CASE WHEN n.near_non_moss_humidity > 1 THEN n.near_non_moss_humidity END)     AS mean_near_non_moss_humidity,
            STDEV(CASE WHEN n.near_non_moss_humidity > 1 THEN n.near_non_moss_humidity END)   AS std_near_non_moss_humidity,
            MIN(CASE WHEN n.near_non_moss_humidity > 1 THEN n.near_non_moss_humidity END)     AS min_near_non_moss_humidity,
            MAX(CASE WHEN n.near_non_moss_humidity > 1 THEN n.near_non_moss_humidity END)     AS max_near_non_moss_humidity
        FROM dbo.non_moss_data n
        {nm_where}
    """)

    mr = db.execute(moss_sql, params).mappings().one()
    nr = db.execute(nm_sql, params).mappings().one()

    def stat_row(sensor, mean_key, std_key, min_key, max_key, source):
        return {
            "sensor": sensor,
            "mean": _safe_round(source[mean_key]),
            "std": _safe_round(source[std_key]),
            "min": _safe_round(source[min_key]),
            "max": _safe_round(source[max_key]),
        }

    return [
        stat_row("Outdoor Temp (°C)", "mean_outdoor_temp", "std_outdoor_temp", "min_outdoor_temp", "max_outdoor_temp", mr),
        stat_row("Outdoor Humidity (%)", "mean_outdoor_humidity", "std_outdoor_humidity", "min_outdoor_humidity", "max_outdoor_humidity", mr),
        stat_row("Moss Wall Temp (°C)", "mean_moss_wall_temp", "std_moss_wall_temp", "min_moss_wall_temp", "max_moss_wall_temp", mr),
        stat_row("Non-Moss Wall Temp (°C)", "mean_non_moss_wall_temp", "std_non_moss_wall_temp", "min_non_moss_wall_temp", "max_non_moss_wall_temp", nr),
        stat_row("Moss Surface Temp (°C)", "mean_moss_surface_temp", "std_moss_surface_temp", "min_moss_surface_temp", "max_moss_surface_temp", mr),
        stat_row("Non-Moss Surface Temp (°C)", "mean_non_moss_surface_temp", "std_non_moss_surface_temp", "min_non_moss_surface_temp", "max_non_moss_surface_temp", nr),
        stat_row("Near-Moss Humidity (%)", "mean_near_moss_humidity", "std_near_moss_humidity", "min_near_moss_humidity", "max_near_moss_humidity", mr),
        stat_row("Near Non-Moss Humidity (%)", "mean_near_non_moss_humidity", "std_near_non_moss_humidity", "min_near_non_moss_humidity", "max_near_non_moss_humidity", nr),
    ]


def get_analysis_diurnal(
    db: Session,
    start_date=None,
    end_date=None,
    start_time: Optional[time] = None,
    end_time: Optional[time] = None,
    min_humidity: Optional[float] = None,
    max_humidity: Optional[float] = None,
):
    """Average wall temps split by daytime (06-18) vs night (18-06)."""
    from sqlalchemy import text

    moss_wheres, nm_wheres = list(MOSS_VALID_SQL), list(NON_MOSS_VALID_SQL)
    params: dict = {}

    if start_date is not None:
        moss_wheres.append("m.[timestamp] >= :start_dt")
        nm_wheres.append("n.[timestamp] >= :start_dt")
        params["start_dt"] = datetime.combine(start_date, time.min)

    if end_date is not None:
        moss_wheres.append("m.[timestamp] <= :end_dt")
        nm_wheres.append("n.[timestamp] <= :end_dt")
        params["end_dt"] = datetime.combine(end_date, time.max)

    if start_time is not None:
        moss_wheres.append("CAST(m.[timestamp] AS TIME) >= :start_tm")
        nm_wheres.append("CAST(n.[timestamp] AS TIME) >= :start_tm")
        params["start_tm"] = start_time
    if end_time is not None:
        moss_wheres.append("CAST(m.[timestamp] AS TIME) <= :end_tm")
        nm_wheres.append("CAST(n.[timestamp] AS TIME) <= :end_tm")
        params["end_tm"] = end_time

    if min_humidity is not None:
        moss_wheres.append("m.outdoor_humidity >= :min_hum")
        moss_wheres.append("m.near_moss_humidity >= :min_hum")
        nm_wheres.append("n.near_non_moss_humidity >= :min_hum")
        params["min_hum"] = min_humidity

    if max_humidity is not None:
        moss_wheres.append("m.outdoor_humidity <= :max_hum")
        moss_wheres.append("m.near_moss_humidity <= :max_hum")
        nm_wheres.append("n.near_non_moss_humidity <= :max_hum")
        params["max_hum"] = max_humidity

    if min_humidity is not None or max_humidity is not None:
        sub_wheres = []
        if min_humidity is not None:
            sub_wheres.append("m_sub.outdoor_humidity >= :min_hum")
        if max_humidity is not None:
            sub_wheres.append("m_sub.outdoor_humidity <= :max_hum")
        sub_where_sql = " AND ".join(sub_wheres)
        nm_wheres.append(f"EXISTS (SELECT 1 FROM dbo.moss_data m_sub WHERE CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, m_sub.[timestamp]), 0) AS DATETIME) = CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, n.[timestamp]), 0) AS DATETIME) AND {sub_where_sql})")

    moss_where = ("AND " + " AND ".join(moss_wheres)) if moss_wheres else ""
    nm_where = ("AND " + " AND ".join(nm_wheres)) if nm_wheres else ""

    moss_sql = text(f"""
        SELECT
            CASE WHEN DATEPART(HOUR, m.[timestamp]) >= 6 AND DATEPART(HOUR, m.[timestamp]) < 18
                 THEN 'Daytime (06:00-18:00)' ELSE 'Night-time (18:00-06:00)' END AS period,
            AVG(CASE WHEN m.wall_temp > 1 THEN m.wall_temp END) AS avg_moss_wall
        FROM dbo.moss_data m
        WHERE 1=1 {moss_where}
        GROUP BY CASE WHEN DATEPART(HOUR, m.[timestamp]) >= 6 AND DATEPART(HOUR, m.[timestamp]) < 18
                      THEN 'Daytime (06:00-18:00)' ELSE 'Night-time (18:00-06:00)' END
    """)

    nm_sql = text(f"""
        SELECT
            CASE WHEN DATEPART(HOUR, n.[timestamp]) >= 6 AND DATEPART(HOUR, n.[timestamp]) < 18
                 THEN 'Daytime (06:00-18:00)' ELSE 'Night-time (18:00-06:00)' END AS period,
            AVG(CASE WHEN n.wall_temp > 1 THEN n.wall_temp END) AS avg_non_moss_wall
        FROM dbo.non_moss_data n
        WHERE 1=1 {nm_where}
        GROUP BY CASE WHEN DATEPART(HOUR, n.[timestamp]) >= 6 AND DATEPART(HOUR, n.[timestamp]) < 18
                      THEN 'Daytime (06:00-18:00)' ELSE 'Night-time (18:00-06:00)' END
    """)

    moss_rows = {r["period"]: r["avg_moss_wall"] for r in db.execute(moss_sql, params).mappings().all()}
    nm_rows = {r["period"]: r["avg_non_moss_wall"] for r in db.execute(nm_sql, params).mappings().all()}

    result = []
    for period in ["Daytime (06:00-18:00)", "Night-time (18:00-06:00)"]:
        m_val = _safe_round(moss_rows.get(period))
        n_val = _safe_round(nm_rows.get(period))
        diff = round(n_val - m_val, 3) if m_val is not None and n_val is not None else None
        result.append({"period": period, "mossWall": m_val, "nonMossWall": n_val, "diff": diff})

    return result


def get_analysis_cooling(
    db: Session,
    start_date=None,
    end_date=None,
    start_time: Optional[time] = None,
    end_time: Optional[time] = None,
    min_humidity: Optional[float] = None,
    max_humidity: Optional[float] = None,
):
    """Compute cooling effect: outdoor temp minus wall temp."""
    from sqlalchemy import text

    wheres = list(MOSS_VALID_SQL)
    params: dict = {}

    if start_date is not None:
        wheres.append("m.[timestamp] >= :start_dt")
        params["start_dt"] = datetime.combine(start_date, time.min)
    if end_date is not None:
        wheres.append("m.[timestamp] <= :end_dt")
        params["end_dt"] = datetime.combine(end_date, time.max)
    if start_time is not None:
        wheres.append("CAST(m.[timestamp] AS TIME) >= :start_tm")
        params["start_tm"] = start_time
    if end_time is not None:
        wheres.append("CAST(m.[timestamp] AS TIME) <= :end_tm")
        params["end_tm"] = end_time
    if min_humidity is not None:
        wheres.append("m.outdoor_humidity >= :min_hum")
        wheres.append("m.near_moss_humidity >= :min_hum")
        params["min_hum"] = min_humidity
    if max_humidity is not None:
        wheres.append("m.outdoor_humidity <= :max_hum")
        wheres.append("m.near_moss_humidity <= :max_hum")
        params["max_hum"] = max_humidity

    where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""

    # Average cooling = avg(outdoor_temp - wall_temp), filtering out values <= 1
    sql = text(f"""
        SELECT
            AVG(CASE WHEN m.outdoor_temp > 1 AND m.wall_temp > 1 THEN m.outdoor_temp - m.wall_temp END)  AS avg_moss_cooling,
            AVG(CASE WHEN m.outdoor_temp > 1 AND n.wall_temp > 1 THEN m.outdoor_temp - n.wall_temp END)  AS avg_non_moss_cooling
        FROM dbo.moss_data m
        INNER JOIN dbo.non_moss_data n
            ON CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, m.[timestamp]), 0) AS DATETIME)
             = CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, n.[timestamp]), 0) AS DATETIME)
        {where_sql}
    """)

    # Fallback: compute separately if join yields nothing
    moss_sql = text(f"""
        SELECT AVG(CASE WHEN m.outdoor_temp > 1 AND m.wall_temp > 1 THEN m.outdoor_temp - m.wall_temp END) AS avg_moss_cooling
        FROM dbo.moss_data m
        {where_sql}
    """)

    nm_wheres = list(NON_MOSS_VALID_SQL)
    nm_params: dict = {}
    if start_date is not None:
        nm_wheres.append("n.[timestamp] >= :start_dt")
        nm_params["start_dt"] = datetime.combine(start_date, time.min)
    if end_date is not None:
        nm_wheres.append("n.[timestamp] <= :end_dt")
        nm_params["end_dt"] = datetime.combine(end_date, time.max)
    if start_time is not None:
        nm_wheres.append("CAST(n.[timestamp] AS TIME) >= :start_tm")
        nm_params["start_tm"] = start_time
    if end_time is not None:
        nm_wheres.append("CAST(n.[timestamp] AS TIME) <= :end_tm")
        nm_params["end_tm"] = end_time

    if min_humidity is not None:
        nm_wheres.append("n.near_non_moss_humidity >= :min_hum")
        nm_params["min_hum"] = min_humidity
    if max_humidity is not None:
        nm_wheres.append("n.near_non_moss_humidity <= :max_hum")
        nm_params["max_hum"] = max_humidity

    if min_humidity is not None or max_humidity is not None:
        sub_wheres = []
        if min_humidity is not None:
            sub_wheres.append("m_sub.outdoor_humidity >= :min_hum")
        if max_humidity is not None:
            sub_wheres.append("m_sub.outdoor_humidity <= :max_hum")
        sub_where_sql = " AND ".join(sub_wheres)
        nm_wheres.append(f"EXISTS (SELECT 1 FROM dbo.moss_data m_sub WHERE CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, m_sub.[timestamp]), 0) AS DATETIME) = CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, n.[timestamp]), 0) AS DATETIME) AND {sub_where_sql})")

    nm_where_sql = ("WHERE " + " AND ".join(nm_wheres)) if nm_wheres else ""

    # For non-moss cooling, we need outdoor temp from moss table
    # Use a simpler approach: get avg outdoor_temp from moss, avg wall from non-moss
    outdoor_sql = text(f"""
        SELECT AVG(CASE WHEN m.outdoor_temp > 1 THEN m.outdoor_temp END) AS avg_outdoor
        FROM dbo.moss_data m
        {where_sql}
    """)

    nm_wall_sql = text(f"""
        SELECT AVG(CASE WHEN n.wall_temp > 1 THEN n.wall_temp END) AS avg_nm_wall
        FROM dbo.non_moss_data n
        {nm_where_sql}
    """)

    moss_cooling_row = db.execute(moss_sql, params).mappings().one()
    outdoor_row = db.execute(outdoor_sql, params).mappings().one()
    nm_wall_row = db.execute(nm_wall_sql, nm_params).mappings().one()

    moss_cooling = _safe_round(moss_cooling_row["avg_moss_cooling"])
    avg_outdoor = _safe_round(outdoor_row["avg_outdoor"])
    avg_nm_wall = _safe_round(nm_wall_row["avg_nm_wall"])

    non_moss_cooling = round(avg_outdoor - avg_nm_wall, 3) if avg_outdoor is not None and avg_nm_wall is not None else None
    advantage = round(moss_cooling - non_moss_cooling, 3) if moss_cooling is not None and non_moss_cooling is not None else None

    return {
        "mossCooling": moss_cooling,
        "nonMossCooling": non_moss_cooling,
        "mossAdvantage": advantage,
    }


def get_analysis_humidity_buffering(
    db: Session,
    start_date=None,
    end_date=None,
    start_time: Optional[time] = None,
    end_time: Optional[time] = None,
    min_humidity: Optional[float] = None,
    max_humidity: Optional[float] = None,
):
    """Standard deviation of humidity readings for buffering comparison."""
    from sqlalchemy import text

    moss_wheres, nm_wheres = list(MOSS_VALID_SQL), list(NON_MOSS_VALID_SQL)
    params: dict = {}

    if start_date is not None:
        moss_wheres.append("m.[timestamp] >= :start_dt")
        nm_wheres.append("n.[timestamp] >= :start_dt")
        params["start_dt"] = datetime.combine(start_date, time.min)
    if end_date is not None:
        moss_wheres.append("m.[timestamp] <= :end_dt")
        nm_wheres.append("n.[timestamp] <= :end_dt")
        params["end_dt"] = datetime.combine(end_date, time.max)

    if start_time is not None:
        moss_wheres.append("CAST(m.[timestamp] AS TIME) >= :start_tm")
        nm_wheres.append("CAST(n.[timestamp] AS TIME) >= :start_tm")
        params["start_tm"] = start_time
    if end_time is not None:
        moss_wheres.append("CAST(m.[timestamp] AS TIME) <= :end_tm")
        nm_wheres.append("CAST(n.[timestamp] AS TIME) <= :end_tm")
        params["end_tm"] = end_time
    if min_humidity is not None:
        moss_wheres.append("m.outdoor_humidity >= :min_hum")
        moss_wheres.append("m.near_moss_humidity >= :min_hum")
        nm_wheres.append("n.near_non_moss_humidity >= :min_hum")
        params["min_hum"] = min_humidity
    if max_humidity is not None:
        moss_wheres.append("m.outdoor_humidity <= :max_hum")
        moss_wheres.append("m.near_moss_humidity <= :max_hum")
        nm_wheres.append("n.near_non_moss_humidity <= :max_hum")
        params["max_hum"] = max_humidity

    if min_humidity is not None or max_humidity is not None:
        sub_wheres = []
        if min_humidity is not None:
            sub_wheres.append("m_sub.outdoor_humidity >= :min_hum")
        if max_humidity is not None:
            sub_wheres.append("m_sub.outdoor_humidity <= :max_hum")
        sub_where_sql = " AND ".join(sub_wheres)
        nm_wheres.append(f"EXISTS (SELECT 1 FROM dbo.moss_data m_sub WHERE CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, m_sub.[timestamp]), 0) AS DATETIME) = CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, n.[timestamp]), 0) AS DATETIME) AND {sub_where_sql})")

    moss_where = ("WHERE " + " AND ".join(moss_wheres)) if moss_wheres else ""
    nm_where = ("WHERE " + " AND ".join(nm_wheres)) if nm_wheres else ""

    moss_sql = text(f"""
        SELECT
            STDEV(CASE WHEN m.outdoor_humidity > 1 THEN m.outdoor_humidity END)     AS std_outdoor,
            STDEV(CASE WHEN m.near_moss_humidity > 1 THEN m.near_moss_humidity END) AS std_near_moss
        FROM dbo.moss_data m
        {moss_where}
    """)
    nm_sql = text(f"""
        SELECT STDEV(CASE WHEN n.near_non_moss_humidity > 1 THEN n.near_non_moss_humidity END) AS std_near_non_moss
        FROM dbo.non_moss_data n
        {nm_where}
    """)

    mr = db.execute(moss_sql, params).mappings().one()
    nr = db.execute(nm_sql, params).mappings().one()

    return [
        {"location": "Outdoor", "stdDev": _safe_round(mr["std_outdoor"]), "interpretation": "Reference (uncontrolled)"},
        {"location": "Near Moss Wall", "stdDev": _safe_round(mr["std_near_moss"]), "interpretation": "Moss-side microclimate"},
        {"location": "Near Non-Moss Wall", "stdDev": _safe_round(nr["std_near_non_moss"]), "interpretation": "Bare-wall microclimate"},
    ]


def get_analysis_hourly_pattern(
    db: Session,
    start_date=None,
    end_date=None,
    start_time: Optional[time] = None,
    end_time: Optional[time] = None,
    min_humidity: Optional[float] = None,
    max_humidity: Optional[float] = None,
):
    """Average temperature by hour of day (0-23) for diurnal chart."""
    from sqlalchemy import text

    moss_wheres, nm_wheres = list(MOSS_VALID_SQL), list(NON_MOSS_VALID_SQL)
    params: dict = {}

    if start_date is not None:
        moss_wheres.append("m.[timestamp] >= :start_dt")
        nm_wheres.append("n.[timestamp] >= :start_dt")
        params["start_dt"] = datetime.combine(start_date, time.min)
    if end_date is not None:
        moss_wheres.append("m.[timestamp] <= :end_dt")
        nm_wheres.append("n.[timestamp] <= :end_dt")
        params["end_dt"] = datetime.combine(end_date, time.max)

    if start_time is not None:
        moss_wheres.append("CAST(m.[timestamp] AS TIME) >= :start_tm")
        nm_wheres.append("CAST(n.[timestamp] AS TIME) >= :start_tm")
        params["start_tm"] = start_time
    if end_time is not None:
        moss_wheres.append("CAST(m.[timestamp] AS TIME) <= :end_tm")
        nm_wheres.append("CAST(n.[timestamp] AS TIME) <= :end_tm")
        params["end_tm"] = end_time
    if min_humidity is not None:
        moss_wheres.append("m.outdoor_humidity >= :min_hum")
        moss_wheres.append("m.near_moss_humidity >= :min_hum")
        nm_wheres.append("n.near_non_moss_humidity >= :min_hum")
        params["min_hum"] = min_humidity
    if max_humidity is not None:
        moss_wheres.append("m.outdoor_humidity <= :max_hum")
        moss_wheres.append("m.near_moss_humidity <= :max_hum")
        nm_wheres.append("n.near_non_moss_humidity <= :max_hum")
        params["max_hum"] = max_humidity

    if min_humidity is not None or max_humidity is not None:
        sub_wheres = []
        if min_humidity is not None:
            sub_wheres.append("m_sub.outdoor_humidity >= :min_hum")
        if max_humidity is not None:
            sub_wheres.append("m_sub.outdoor_humidity <= :max_hum")
        sub_where_sql = " AND ".join(sub_wheres)
        nm_wheres.append(f"EXISTS (SELECT 1 FROM dbo.moss_data m_sub WHERE CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, m_sub.[timestamp]), 0) AS DATETIME) = CAST(DATEADD(HOUR, DATEDIFF(HOUR, 0, n.[timestamp]), 0) AS DATETIME) AND {sub_where_sql})")

    moss_where = ("WHERE " + " AND ".join(moss_wheres)) if moss_wheres else ""
    nm_where = ("WHERE " + " AND ".join(nm_wheres)) if nm_wheres else ""

    moss_sql = text(f"""
        SELECT
            DATEPART(HOUR, m.[timestamp]) AS hour_of_day,
            AVG(CASE WHEN m.wall_temp > 1 THEN m.wall_temp END) AS avg_moss_wall,
            AVG(CASE WHEN m.outdoor_temp > 1 THEN m.outdoor_temp END) AS avg_outdoor
        FROM dbo.moss_data m
        {moss_where}
        GROUP BY DATEPART(HOUR, m.[timestamp])
        ORDER BY hour_of_day
    """)

    nm_sql = text(f"""
        SELECT
            DATEPART(HOUR, n.[timestamp]) AS hour_of_day,
            AVG(CASE WHEN n.wall_temp > 1 THEN n.wall_temp END) AS avg_non_moss_wall
        FROM dbo.non_moss_data n
        {nm_where}
        GROUP BY DATEPART(HOUR, n.[timestamp])
        ORDER BY hour_of_day
    """)

    moss_rows = {r["hour_of_day"]: r for r in db.execute(moss_sql, params).mappings().all()}
    nm_rows = {r["hour_of_day"]: r for r in db.execute(nm_sql, params).mappings().all()}

    hours = []
    for h in range(24):
        m = moss_rows.get(h)
        n = nm_rows.get(h)
        hours.append({
            "hour": h,
            "mossWall": _safe_round(m["avg_moss_wall"]) if m else None,
            "nonMossWall": _safe_round(n["avg_non_moss_wall"]) if n else None,
            "outdoor": _safe_round(m["avg_outdoor"]) if m else None,
        })

    return hours

