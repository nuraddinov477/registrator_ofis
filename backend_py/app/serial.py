"""ORM obyektini JSON'ga aylantirish — Prisma'ning `include` natijasiga o'xshash shakl.

include — {relation: sub_include_or_None}. Masalan: {"groups": {"group": None}} →
{..., "groups": [{..., "group": {...}}]}.
"""
from datetime import datetime


def iso(dt: datetime) -> str:
    # JavaScript Date.toISOString() kabi: 2024-01-01T00:00:00.000Z
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def to_json(obj, include=None):
    if obj is None:
        return None
    if isinstance(obj, (list, tuple)):
        return [to_json(x, include) for x in obj]
    out = {}
    for col in obj.__table__.columns:
        value = getattr(obj, col.key)
        out[col.key] = iso(value) if isinstance(value, datetime) else value
    if include:
        for name, sub in include.items():
            out[name] = to_json(getattr(obj, name), sub)
    return out
