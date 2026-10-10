"""Rol-huquq va qamrov (RBAC) — server/src/auth/access.js ning Python nusxasi.

scope_where() → SQLAlchemy shart (yoki None = filtrsiz). NONE — hech narsaga mos kelmaydigan filtr.
"""
import json
from typing import Optional

from fastapi import Depends, HTTPException
from sqlalchemy import and_, false
from sqlalchemy.orm import Session

from .auth import CurrentUser, current_user
from .models import Group, Specialty, Teacher, User, Workload, WorkloadGroup

SUPER = "Super Admin"
OPERATOR = "Fakultet operatori"
MUDIR = "Kafedra mudiri"
TEACHER = "Oʻqituvchi"  # U+02BB — access.js'dagi bilan bir xil

# Resurs → YOZISH ruxsati bo'lgan rollar. Super Admin bypass. users — delegatsiya.
WRITE = {
    "faculties": [], "departments": [], "buildings": [],
    "specialties": [OPERATOR], "groups": [OPERATOR], "teachers": [MUDIR],
    "subjects": [OPERATOR, MUDIR], "rooms": [OPERATOR], "room-permissions": [OPERATOR],
    "teacher-constraints": [OPERATOR], "workloads": [OPERATOR, MUDIR], "users": [OPERATOR, MUDIR],
}
READ_ROLES = {"users": [OPERATOR, MUDIR]}
SECTION = {"workloads": "loads", "buildings": "rooms", "room-permissions": "rooms", "teacher-constraints": "schedule"}


def section_of(resource: str) -> str:
    return SECTION.get(resource, resource)


def is_super_admin(user: CurrentUser) -> bool:
    return user.role == SUPER


class AccessError(Exception):
    def __init__(self, message: str, status: int = 403):
        super().__init__(message)
        self.message = message
        self.status = status


def assignable_roles(user: CurrentUser):
    if is_super_admin(user):
        return [SUPER, OPERATOR, MUDIR]
    if user.role == OPERATOR:
        return [MUDIR]
    return []


def is_unrestrictable(user: CurrentUser) -> bool:
    # "developer" (isOwner) hisobi hech qachon cheklanmaydi
    return bool(user.isOwner)


_EMPTY_RESTRICTIONS = {"readOnly": False, "denyWrite": [], "denyRead": []}


def parse_restrictions(user: CurrentUser) -> dict:
    if is_unrestrictable(user) or not user.restrictions:
        return dict(_EMPTY_RESTRICTIONS, denyWrite=[], denyRead=[])
    try:
        r = json.loads(user.restrictions) if isinstance(user.restrictions, str) else user.restrictions
    except (ValueError, TypeError):
        return dict(_EMPTY_RESTRICTIONS, denyWrite=[], denyRead=[])
    r = r if isinstance(r, dict) else {}
    return {
        "readOnly": bool(r.get("readOnly")),
        "denyWrite": r.get("denyWrite") if isinstance(r.get("denyWrite"), list) else [],
        "denyRead": r.get("denyRead") if isinstance(r.get("denyRead"), list) else [],
    }


def restriction_blocks(user: CurrentUser, section: str, kind: str = "write") -> bool:
    if is_unrestrictable(user):
        return False
    r = parse_restrictions(user)
    if kind == "write":
        return r["readOnly"] or section in r["denyWrite"]
    return section in r["denyRead"]


def can_write(resource: str, user: CurrentUser) -> bool:
    if is_unrestrictable(user):
        return True
    if is_super_admin(user):
        r = parse_restrictions(user)
        return not r["readOnly"] and section_of(resource) not in r["denyWrite"]
    if user.role not in WRITE.get(resource, []):
        return False
    r = parse_restrictions(user)
    return not r["readOnly"] and section_of(resource) not in r["denyWrite"]


def require_write(resource: str):
    def dep(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if can_write(resource, user):
            return user
        raise HTTPException(403, "Ruxsat yetarli emas")
    return dep


def require_read(resource: str):
    def dep(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        roles = READ_ROLES.get(resource)
        if roles and not is_super_admin(user) and user.role not in roles:
            raise HTTPException(403, "Ruxsat yetarli emas")
        if restriction_blocks(user, section_of(resource), "read"):
            raise HTTPException(403, "Bu bo'lim siz uchun yopilgan")
        return user
    return dep


# Hech narsaga mos kelmaydigan filtr (birlik biriktirilmagan holat)
NONE = false()


def _without_owner(clause):
    # Egalik (isOwner) hisobi hech kimning "Foydalanuvchilar" ro'yxatida ko'rinmasin
    if clause is NONE:
        return NONE
    return and_(clause, User.isOwner == False)  # noqa: E712 (SQL uchun)


def scope_where(resource: str, user: CurrentUser):
    """LIST/GET uchun SQLAlchemy shart. None = filtrsiz (hammasini ko'radi)."""
    if is_super_admin(user):
        if resource == "users" and not is_unrestrictable(user):
            return User.isOwner == False  # noqa: E712
        return None
    role = user.role

    if role == OPERATOR:
        F = user.facultyId
        if resource == "groups":
            return Group.facultyId == F if F else NONE
        if resource == "specialties":
            return Specialty.facultyId == F if F else NONE
        if resource == "workloads":
            return Workload.groups.any(WorkloadGroup.group.has(Group.facultyId == F)) if F else NONE
        if resource == "users":
            return _without_owner(User.facultyId == F if F else NONE)
        return None

    if role == MUDIR:
        D = user.departmentId
        if resource == "teachers":
            return Teacher.departmentId == D if D else NONE
        if resource == "workloads":
            return Workload.teacher.has(Teacher.departmentId == D) if D else NONE
        if resource == "users":
            return _without_owner(User.departmentId == D if D else NONE)
        return None

    return None


def _derive_faculty_id(db: Session, data: dict, existing):
    """Yangi/yangilangan user'ning facultyId'sini rol birligidan hosil qiladi (visibility uchun)."""
    from .models import Department

    role = data.get("role") if data.get("role") is not None else (existing.role if existing else None)
    if role == MUDIR:
        did = data.get("departmentId") if data.get("departmentId") is not None else (existing.departmentId if existing else None)
        if did is not None:
            d = db.get(Department, int(did))
            return d.facultyId if d else None
    elif role == TEACHER:
        tid = data.get("teacherId") if data.get("teacherId") is not None else (existing.teacherId if existing else None)
        if tid is not None:
            t = db.get(Teacher, int(tid))
            if t and t.departmentId is not None:
                d = db.get(Department, t.departmentId)
                return d.facultyId if d else None
    return None  # undefined — o'zgartirilmaydi


def _scope_assert_users(db: Session, user: CurrentUser, data: Optional[dict], existing):
    from .models import Department

    if data is not None:
        data.pop("isOwner", None)

    allowed = assignable_roles(user)
    if data and data.get("role") and data["role"] not in allowed:
        raise AccessError(f'Siz "{data["role"]}" rolini bera olmaysiz')

    if is_super_admin(user):
        if existing is not None and existing.role == SUPER and existing.id != user.sub and not is_unrestrictable(user):
            raise AccessError("Boshqa Super Admin hisobini faqat egasi boshqaradi")
        if data is not None and data.get("facultyId") is None:
            fac = _derive_faculty_id(db, data, existing)
            if fac is not None:
                data["facultyId"] = fac
        return data

    if data is not None:
        data.pop("restrictions", None)
    target_role = (data.get("role") if data else None) or (existing.role if existing else None)
    role = user.role

    if role == OPERATOR:
        F = user.facultyId
        if F is None:
            raise AccessError("Sizga fakultet biriktirilmagan")
        if target_role == MUDIR:
            did = (data.get("departmentId") if data else None)
            if did is None and existing is not None:
                did = existing.departmentId
            dep = db.get(Department, int(did)) if did is not None else None
            if not dep or dep.facultyId != F:
                raise AccessError("Kafedra sizning fakultetingizda emas")
        elif target_role == TEACHER:
            tid = (data.get("teacherId") if data else None)
            if tid is None and existing is not None:
                tid = existing.teacherId
            tea = db.get(Teacher, int(tid)) if tid is not None else None
            dep = db.get(Department, tea.departmentId) if tea and tea.departmentId is not None else None
            if not dep or dep.facultyId != F:
                raise AccessError("O'qituvchi sizning fakultetingizda emas")
        if data is not None:
            data["facultyId"] = F
    elif role == MUDIR:
        D = user.departmentId
        if D is None:
            raise AccessError("Sizga kafedra biriktirilmagan")
        tid = (data.get("teacherId") if data else None)
        if tid is None and existing is not None:
            tid = existing.teacherId
        tea = db.get(Teacher, int(tid)) if tid is not None else None
        if not tea or tea.departmentId != D:
            raise AccessError("O'qituvchi sizning kafedrangizda emas")
        if data is not None:
            data["departmentId"] = D
            dep = db.get(Department, D)
            data["facultyId"] = dep.facultyId if dep else None
    return data


def scope_assert(db: Session, resource: str, user: CurrentUser, data: Optional[dict], existing):
    """YOZISHda qamrovni majburlash/tekshirish. data'ni (masalan facultyId) o'zgartirib qaytaradi."""
    if resource == "users":
        return _scope_assert_users(db, user, data, existing)
    if is_super_admin(user):
        return data
    role = user.role

    if role == OPERATOR:
        F = user.facultyId
        if resource in ("groups", "specialties"):
            if F is None:
                raise AccessError("Sizga fakultet biriktirilmagan")
            if existing is not None and existing.facultyId != F:
                raise AccessError("Bu yozuv boshqa fakultetga tegishli")
            if data is not None:
                data["facultyId"] = F
        elif resource == "workloads":
            if F is None:
                raise AccessError("Sizga fakultet biriktirilmagan")
            gids = data.get("groupIds") if data and data.get("groupIds") is not None else (
                [g.groupId for g in existing.groups] if existing is not None else [])
            if not gids:
                raise AccessError("Kamida bitta guruh tanlanishi kerak")
            groups = db.query(Group).filter(Group.id.in_([int(x) for x in gids])).all()
            if len(groups) != len(gids) or any(g.facultyId != F for g in groups):
                raise AccessError("Guruh(lar) sizning fakultetingizda emas")
        return data

    if role == MUDIR:
        D = user.departmentId
        if resource == "teachers":
            if D is None:
                raise AccessError("Sizga kafedra biriktirilmagan")
            if existing is not None and existing.departmentId != D:
                raise AccessError("Bu o'qituvchi boshqa kafedraga tegishli")
            if data is not None:
                data["departmentId"] = D
        elif resource == "workloads":
            if D is None:
                raise AccessError("Sizga kafedra biriktirilmagan")
            tid = data.get("teacherId") if data and data.get("teacherId") is not None else (
                existing.teacherId if existing is not None else None)
            t = db.get(Teacher, int(tid)) if tid is not None else None
            if not t or t.departmentId != D:
                raise AccessError("O'qituvchi sizning kafedrangizda emas")
        return data

    return data


def protect_super_admin_target(db: Session, user: CurrentUser, target_id: int) -> None:
    """Boshqa Super Admin hisobini o'chirish/tahrirlashdan himoya (faqat egasi qila oladi)."""
    if not is_super_admin(user) or is_unrestrictable(user):
        return
    if not target_id:
        return
    target = db.get(User, target_id)
    if target is not None and target.role == SUPER and target.id != user.sub:
        raise HTTPException(403, "Boshqa Super Admin hisobini faqat egasi boshqaradi")
