import sys
import re
from pathlib import Path

file_path = Path(__file__).resolve().parent / 'app' / 'crud' / 'data.py'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace get_history
old_history = '''def get_history(db: Session, start_date, end_date):
    start_dt = datetime.combine(start_date, time.min)
    end_dt = datetime.combine(end_date, time.max)

    moss_stmt = (
        select(MossData)
        .where(MossData.timestamp >= start_dt, MossData.timestamp <= end_dt, *MOSS_VALID_CONDITIONS)
        .order_by(MossData.timestamp.asc())
    )
    non_moss_stmt = (
        select(NonMossData)
        .where(NonMossData.timestamp >= start_dt, NonMossData.timestamp <= end_dt, *NON_MOSS_VALID_CONDITIONS)
        .order_by(NonMossData.timestamp.asc())
    )

    moss_rows = list(db.execute(moss_stmt).scalars().all())
    non_moss_rows = list(db.execute(non_moss_stmt).scalars().all())

    return moss_rows, non_moss_rows'''

new_history = '''def get_history(
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

    return moss_rows, non_moss_rows'''

content = content.replace(old_history, new_history)

# Replace get_history_paginated
old_paginated = '''def get_history_paginated(db: Session, start_date, end_date, page: int = 1, per_page: int = 30):
    """Return ``(page_rows, total_count)`` of merged history."""
    moss_rows, non_moss_rows = get_history(db, start_date, end_date)'''

new_paginated = '''def get_history_paginated(
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
    moss_rows, non_moss_rows = get_history(db, start_date, end_date, start_time, end_time, min_humidity, max_humidity)'''

content = content.replace(old_paginated, new_paginated)

# For all analysis functions, add start_time and end_time to signature
sig_pattern = r'''(def get_analysis_[a-z_]+\(
    db: Session,
    start_date=None,
    end_date=None,)(
    min_humidity: Optional\[float\] = None,
    max_humidity: Optional\[float\] = None,
\):)'''

sig_replacement = r'''\1
    start_time: Optional[time] = None,
    end_time: Optional[time] = None,\2'''

content = re.sub(sig_pattern, sig_replacement, content)

# For all analysis functions, add start_time and end_time condition logic
# Note: we find the end_date logic and insert right after it
where_pattern = r'''(    if end_date is not None:
        moss_wheres\.append\("m\.\[timestamp\] <= :end_dt"\)
        (nm_wheres|n_wheres)\.append\("n\.\[timestamp\] <= :end_dt"\)
        params\["end_dt"\] = datetime\.combine\(end_date, time\.max\))'''

where_replacement = r'''\1

    if start_time is not None:
        moss_wheres.append("CAST(m.[timestamp] AS TIME) >= :start_tm")
        nm_wheres.append("CAST(n.[timestamp] AS TIME) >= :start_tm")
        params["start_tm"] = start_time
    if end_time is not None:
        moss_wheres.append("CAST(m.[timestamp] AS TIME) <= :end_tm")
        nm_wheres.append("CAST(n.[timestamp] AS TIME) <= :end_tm")
        params["end_tm"] = end_time'''

content = re.sub(where_pattern, where_replacement, content)

# Wait, `get_analysis_cooling` line 629 handles it differently:
cooling_pattern = r'''(    if end_date is not None:
        wheres\.append\("m\.\[timestamp\] <= :end_dt"\)
        params\["end_dt"\] = datetime\.combine\(end_date, time\.max\))'''

cooling_replacement = r'''\1
    if start_time is not None:
        wheres.append("CAST(m.[timestamp] AS TIME) >= :start_tm")
        params["start_tm"] = start_time
    if end_time is not None:
        wheres.append("CAST(m.[timestamp] AS TIME) <= :end_tm")
        params["end_tm"] = end_time'''

content = re.sub(cooling_pattern, cooling_replacement, content)

cooling_nm_pattern = r'''(    if end_date is not None:
        nm_wheres\.append\("n\.\[timestamp\] <= :end_dt"\)
        nm_params\["end_dt"\] = datetime\.combine\(end_date, time\.max\))'''

cooling_nm_replacement = r'''\1
    if start_time is not None:
        nm_wheres.append("CAST(n.[timestamp] AS TIME) >= :start_tm")
        nm_params["start_tm"] = start_time
    if end_time is not None:
        nm_wheres.append("CAST(n.[timestamp] AS TIME) <= :end_tm")
        nm_params["end_tm"] = end_time'''

content = re.sub(cooling_nm_pattern, cooling_nm_replacement, content)

# Write back
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Replaced!")
