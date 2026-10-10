"""Kiruvchi ma'lumot validatsiyasi — server/src/validation/schemas.js (zod) ning nusxasi.

Har bir maydon: funksiya (qiymat → tozalangan qiymat), xato bo'lsa FieldError.
Kalit yo'q bo'lsa (partial=False) qiymat None sifatida tekshiriladi — zod preprocess kabi.
"""
import json
import math


class FieldError(Exception):
    pass


class ValidationFailed(Exception):
    def __init__(self, issues):
        super().__init__("Validatsiya xatosi")
        self.issues = issues


def js_number(v) -> float:
    """JavaScript Number() semantikasi: '' → 0, null → 0, true → 1, noto'g'ri matn → NaN."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            return 0.0
        try:
            return float(s)
        except ValueError:
            return math.nan
    return math.nan


def _as_int(n: float) -> int:
    if math.isfinite(n) and float(n).is_integer():
        return int(n)
    raise FieldError("Butun son bo'lishi kerak")


def js_truthy(v) -> bool:
    if v is None or v is False:
        return False
    if isinstance(v, str):
        return v != ""
    if isinstance(v, (int, float)):
        return v != 0 and not (isinstance(v, float) and math.isnan(v))
    return True


# ── Maydon validatorlari ──

def v_name(v):
    s = "" if v is None else str(v).strip()
    if s == "":
        raise FieldError("Bo'sh bo'lishi mumkin emas")
    return s


def v_opt_str(v):
    if v is None or v == "":
        return None
    return str(v)


def v_opt_int(v):
    if v is None or v == "":
        return None
    n = js_number(v)
    if n == 0:
        return None  # 0 hech qachon haqiqiy id emas (FK buzilishini oldini oladi)
    return _as_int(n)


def v_req_int(v):
    return _as_int(js_number(v))


def int_def(default):
    def f(v):
        if v is None or v == "":
            return default
        return _as_int(js_number(v))
    return f


def v_bool(v):
    if isinstance(v, str):
        return v == "true"
    return js_truthy(v)


def enum_def(values, default):
    def f(v):
        if v is None or v == "":
            return default
        if v not in values:
            raise FieldError("Ruxsat etilgan qiymatlardan biri bo'lishi kerak")
        return v
    return f


def json_str(empty_array_is_null=False):
    """Massiv/obyekt kelsa JSON-string'ga o'giriladi (Room.features, User.restrictions ...)."""
    def f(v):
        if v is None or v == "":
            return None
        if empty_array_is_null and isinstance(v, list) and len(v) == 0:
            return None
        if isinstance(v, str):
            return v
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    return f


def v_id_list(v):
    """Bino fakultetlari: massiv bo'lmasa bo'sh; raqam bo'lmaganlar tashlanadi."""
    if not isinstance(v, list):
        return []
    out = []
    for x in v:
        n = js_number(x)
        if math.isfinite(n) and float(n).is_integer():
            out.append(int(n))
    return out


def v_group_ids(v):
    if v is None:
        arr = []
    elif isinstance(v, list):
        arr = v
    else:
        arr = [v]
    out = [_as_int(js_number(x)) for x in arr]
    if not out:
        raise FieldError("Kamida bitta guruh tanlanishi kerak")
    return out


WORKLOAD_TYPES = ("Maʼruza", "Seminar", "Amaliy")  # U+02BC — Prisma/engine bilan bir xil

SCHEMAS = {
    "faculty": {"name": v_name, "code": v_opt_str, "description": v_opt_str},
    "department": {"name": v_name, "code": v_opt_str, "head": v_opt_str, "facultyId": v_opt_int},
    "specialty": {"name": v_name, "code": v_opt_str, "form": v_opt_str, "years": int_def(4), "facultyId": v_opt_int},
    "teacher": {
        "fullName": v_name, "position": v_opt_str, "degree": v_opt_str, "email": v_opt_str,
        "departmentId": v_opt_int,
        "status": enum_def(("faol", "dekret", "ta'til"), "faol"),
    },
    "subject": {
        "name": v_name, "code": v_opt_str, "type": v_opt_str,
        "credit": int_def(3), "lecture": int_def(30), "practice": int_def(30),
        "semester": int_def(1), "difficulty": int_def(3),
    },
    "group": {"name": v_name, "course": int_def(1), "size": int_def(25), "form": v_opt_str,
              "facultyId": v_opt_int, "specialtyId": v_opt_int},
    "building": {"name": v_name, "floors": int_def(1), "address": v_opt_str, "facultyIds": v_id_list},
    "room": {
        "name": v_name, "capacity": int_def(30),
        "type": enum_def(("umumiy", "maxsus"), "umumiy"),
        "kind": v_opt_str, "features": json_str(), "buildingId": v_opt_int,
    },
    "roomPermission": {
        "roomId": v_req_int, "teacherId": v_opt_int, "groupId": v_opt_int,
        "specialtyId": v_opt_int, "subjectId": v_opt_int, "exclusive": v_bool,
    },
    "teacherConstraint": {
        "teacherId": v_req_int,
        "blockedDays": json_str(empty_array_is_null=True),
        "allowedPairs": json_str(empty_array_is_null=True),
    },
    "workload": {
        "groupIds": v_group_ids, "teacherId": v_req_int, "subjectId": v_req_int,
        "weeklyHours": int_def(2), "semester": int_def(1),
        "type": enum_def(WORKLOAD_TYPES, "Amaliy"),
    },
    "user": {
        "login": v_name, "fullName": v_name, "email": v_opt_str, "role": v_opt_str,
        "active": v_bool, "password": v_opt_str,
        "facultyId": v_opt_int, "departmentId": v_opt_int, "teacherId": v_opt_int,
        "restrictions": json_str(),
    },
}


def parse(schema_name: str, body, partial: bool = False) -> dict:
    """zod .parse() / .partial().parse() o'rnini bosadi. Faqat sxemadagi kalitlarni qaytaradi."""
    spec = SCHEMAS[schema_name]
    if not isinstance(body, dict):
        body = {}
    out, issues = {}, {}
    for key, fn in spec.items():
        if partial and key not in body:
            continue
        try:
            out[key] = fn(body.get(key))
        except FieldError as e:
            issues.setdefault(key, []).append(str(e))
    if issues:
        raise ValidationFailed(issues)
    return out
