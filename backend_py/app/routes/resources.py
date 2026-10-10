"""Resurs marshrutlari — routes/index.js, buildings.js, workloads.js, handover.js, usersBulk.js."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..access import (
    MUDIR, SUPER, protect_super_admin_target, require_read, require_write,
    restriction_blocks, scope_assert, scope_where,
)
from ..auth import CurrentUser, current_user, hash_password, require_developer, require_roles
from ..crud import client_ip, crud_router, get_body, label_of
from ..db import audit, get_db
from ..models import (
    Building, Department, Faculty, Group, Room, RoomPermission, Subject, Teacher,
    TeacherConstraint, User, Workload, WorkloadGroup, AuditLog,
)
from ..schemas import parse
from ..serial import to_json


# ── Foydalanuvchi: parol hech qachon qaytarilmaydi ──
def strip_password(data: dict, _user) -> dict:
    data.pop("passwordHash", None)
    return data


def user_transform(data: dict) -> dict:
    if data.get("password"):
        data["passwordHash"] = hash_password(data["password"])
    data.pop("password", None)
    return data


def _protect(db: Session, user: CurrentUser, row_id: int) -> None:
    protect_super_admin_target(db, user, row_id)


# (path, resource, model, label, schema, include, sanitize, transform, pre_write)
CRUD_RESOURCES = [
    ("faculties", "faculties", Faculty, "Fakultet", "faculty", None, None, None, None),
    ("departments", "departments", Department, "Kafedra", "department", {"faculty": None}, None, None, None),
    ("specialties", "specialties", None, "Yo'nalish", "specialty", {"faculty": None}, None, None, None),
    ("teachers", "teachers", Teacher, "O'qituvchi", "teacher", {"department": None}, None, None, None),
    ("subjects", "subjects", Subject, "Fan", "subject", None, None, None, None),
    ("groups", "groups", Group, "Guruh", "group", {"faculty": None, "specialty": None}, None, None, None),
    ("rooms", "rooms", Room, "Xona", "room", {"building": None}, None, None, None),
    ("room-permissions", "room-permissions", RoomPermission, "Xona ruxsati", "roomPermission",
     {"room": None, "teacher": None, "group": None, "specialty": None, "subject": None}, None, None, None),
    ("teacher-constraints", "teacher-constraints", TeacherConstraint, "O'qituvchi istisnosi", "teacherConstraint",
     {"teacher": None}, None, None, None),
    ("users", "users", User, "Foydalanuvchi", "user", None, strip_password, user_transform, _protect),
]


def _model_for(path):
    from ..models import Specialty
    return {"specialties": Specialty}.get(path)


def build_crud_routers():
    routers = []
    for path, resource, model, label, schema, include, sanitize, transform, pre_write in CRUD_RESOURCES:
        model = model or _model_for(path)
        routers.append(crud_router(path, resource, model, label, schema, include, sanitize, transform, pre_write))
    return routers


# ── Bino: ko'p-ko'pga fakultet bog'lanishi ──
BUILDING_INCLUDE = {"faculties": None}


def buildings_router() -> APIRouter:
    r = APIRouter(prefix="/buildings")

    def find(db, row_id, user):
        clause = scope_where("buildings", user)
        stmt = select(Building).where(Building.id == row_id)
        if clause is not None:
            stmt = stmt.where(clause)
        return db.scalars(stmt).first()

    @r.get("", dependencies=[Depends(require_read("buildings"))])
    def list_buildings(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        clause = scope_where("buildings", user)
        stmt = select(Building).order_by(Building.id)
        if clause is not None:
            stmt = stmt.where(clause)
        return to_json(db.scalars(stmt).all(), BUILDING_INCLUDE)

    @r.get("/{row_id}", dependencies=[Depends(require_read("buildings"))])
    def get_building(row_id: int, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        row = find(db, row_id, user)
        if row is None:
            raise HTTPException(404, "Topilmadi")
        return to_json(row, BUILDING_INCLUDE)

    @r.post("", status_code=201, dependencies=[Depends(require_write("buildings"))])
    def create_building(request: Request, body: dict = Depends(get_body),
                        user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        parsed = parse("building", body)
        data = scope_assert(db, "buildings", user, parsed, None)
        faculty_ids = data.pop("facultyIds", [])
        row = Building(**data)
        row.faculties = _load_faculties(db, faculty_ids)
        db.add(row)
        db.commit()
        db.expire(row)
        audit("Qo'shildi: Bino", row.name, user.login, client_ip(request))
        return to_json(row, BUILDING_INCLUDE)

    @r.put("/{row_id}", dependencies=[Depends(require_write("buildings"))])
    def update_building(row_id: int, request: Request, body: dict = Depends(get_body),
                        user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        existing = find(db, row_id, user)
        if existing is None:
            raise HTTPException(404, "Topilmadi")
        parsed = parse("building", body, partial=True)
        data = scope_assert(db, "buildings", user, parsed, existing)
        faculty_ids = data.pop("facultyIds", None)
        for k, v in data.items():
            setattr(existing, k, v)
        if faculty_ids is not None:
            # to'liq ALMASHTIRAMIZ (set), qisman qo'shish emas
            existing.faculties = _load_faculties(db, faculty_ids)
        db.commit()
        db.expire(existing)
        audit("Tahrirlandi: Bino", existing.name, user.login, client_ip(request))
        return to_json(existing, BUILDING_INCLUDE)

    @r.delete("/{row_id}", status_code=204, dependencies=[Depends(require_write("buildings"))])
    def delete_building(row_id: int, request: Request,
                        user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        existing = find(db, row_id, user)
        if existing is None:
            raise HTTPException(404, "Topilmadi")
        db.delete(existing)
        db.commit()
        audit("O'chirildi: Bino", row_id, user.login, client_ip(request))
        return Response(status_code=204)

    return r


def _load_faculties(db: Session, ids):
    ids = [int(x) for x in ids]
    if not ids:
        return []
    found = db.scalars(select(Faculty).where(Faculty.id.in_(ids))).all()
    if len(found) != len(set(ids)):
        # Prisma connect: mavjud bo'lmagan id → "Yozuv topilmadi"
        raise HTTPException(404, "Yozuv topilmadi")
    return list(found)


# ── Yuklama (ko'p-guruhli, arxivlanadi) ──
WORKLOAD_INCLUDE = {"groups": {"group": None}, "teacher": None, "subject": None}


def _wl_label(row) -> str:
    subj = row.subject.name if row.subject else row.subjectId
    teach = row.teacher.fullName if row.teacher else row.teacherId
    return f"{subj} — {teach}"


def workloads_router() -> APIRouter:
    r = APIRouter(prefix="/workloads")

    def find(db, row_id, user):
        clause = scope_where("workloads", user)
        stmt = select(Workload).where(Workload.id == row_id)
        if clause is not None:
            stmt = stmt.where(clause)
        return db.scalars(stmt).first()

    @r.get("", dependencies=[Depends(require_read("workloads"))])
    def list_workloads(all: str = "", user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        stmt = select(Workload).order_by(Workload.id)
        clause = scope_where("workloads", user)
        if clause is not None:
            stmt = stmt.where(clause)
        if all not in ("1", "true"):
            stmt = stmt.where(Workload.archived == False)  # noqa: E712
        return to_json(db.scalars(stmt).all(), WORKLOAD_INCLUDE)

    @r.get("/{row_id}", dependencies=[Depends(require_read("workloads"))])
    def get_workload(row_id: int, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        row = find(db, row_id, user)
        if row is None:
            raise HTTPException(404, "Topilmadi")
        return to_json(row, WORKLOAD_INCLUDE)

    @r.post("", status_code=201, dependencies=[Depends(require_write("workloads"))])
    def create_workload(request: Request, body: dict = Depends(get_body),
                        user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        parsed = parse("workload", body)
        data = scope_assert(db, "workloads", user, parsed, None)
        group_ids = data.pop("groupIds")
        row = Workload(**data)
        row.groups = [WorkloadGroup(groupId=int(g)) for g in group_ids]
        db.add(row)
        db.commit()
        db.expire(row)
        audit("Qo'shildi: Yuklama", _wl_label(row), user.login, client_ip(request))
        return to_json(row, WORKLOAD_INCLUDE)

    @r.put("/{row_id}", dependencies=[Depends(require_write("workloads"))])
    def update_workload(row_id: int, request: Request, body: dict = Depends(get_body),
                        user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        existing = find(db, row_id, user)
        if existing is None:
            raise HTTPException(404, "Topilmadi")
        parsed = parse("workload", body, partial=True)
        data = scope_assert(db, "workloads", user, parsed, existing)
        group_ids = data.pop("groupIds", None)
        if group_ids is not None:
            # eski bog'lanishlar delete-orphan orqali o'chadi, yangilari qo'shiladi
            existing.groups = [WorkloadGroup(groupId=int(g)) for g in group_ids]
        for k, v in data.items():
            setattr(existing, k, v)
        db.commit()
        db.expire(existing)
        audit("Tahrirlandi: Yuklama", _wl_label(existing), user.login, client_ip(request))
        return to_json(existing, WORKLOAD_INCLUDE)

    @r.delete("/{row_id}", status_code=204, dependencies=[Depends(require_write("workloads"))])
    def archive_workload(row_id: int, request: Request,
                         user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        existing = find(db, row_id, user)
        if existing is None:
            raise HTTPException(404, "Topilmadi")
        existing.archived = True
        db.commit()
        audit("Arxivlandi: Yuklama", row_id, user.login, client_ip(request))
        return Response(status_code=204)

    @r.post("/{row_id}/restore", dependencies=[Depends(require_write("workloads"))])
    def restore_workload(row_id: int, request: Request,
                         user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        existing = find(db, row_id, user)
        if existing is None:
            raise HTTPException(404, "Topilmadi")
        existing.archived = False
        db.commit()
        db.expire(existing)
        audit("Arxivdan tiklandi: Yuklama", _wl_label(existing), user.login, client_ip(request))
        return to_json(existing, WORKLOAD_INCLUDE)

    return r


# ── Almashtirish ustasi (dekret / ta'til) ──
GONE_STATUSES = ("dekret", "ta'til")


def _in_scope(user: CurrentUser, teacher: Teacher) -> bool:
    if user.role != MUDIR:
        return True
    return user.departmentId is not None and teacher.departmentId == user.departmentId


def _active_workloads(db: Session, teacher_id: int):
    return db.scalars(select(Workload).where(Workload.teacherId == teacher_id, Workload.archived == False)).all()  # noqa: E712


def _colleagues(db: Session, teacher: Teacher):
    rows = db.scalars(select(Teacher).where(
        Teacher.departmentId == teacher.departmentId, Teacher.id != teacher.id, Teacher.status == "faol")).all()
    out = []
    for t in rows:
        wls = _active_workloads(db, t.id)
        out.append({
            "id": t.id, "fullName": t.fullName, "position": t.position,
            "totalHours": sum(w.weeklyHours for w in wls),
            "subjectIds": list(dict.fromkeys(w.subjectId for w in wls)),
        })
    return out


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def handover_router() -> APIRouter:
    r = APIRouter(prefix="/teachers")

    @r.get("/{row_id}/handover-plan", dependencies=[Depends(require_write("teachers"))])
    def handover_plan(row_id: int, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        teacher = db.get(Teacher, row_id)
        if teacher is None or not _in_scope(user, teacher):
            raise HTTPException(404, "O'qituvchi topilmadi")
        colleagues = _colleagues(db, teacher)
        workloads = []
        for w in _active_workloads(db, teacher.id):
            ranked = sorted(colleagues, key=lambda c: (0 if w.subjectId in c["subjectIds"] else 1, c["totalHours"]))
            groups = ", ".join(x.group.name for x in w.groups if x.group and x.group.name)
            workloads.append({
                "id": w.id, "group": groups, "subject": w.subject.name if w.subject else None,
                "subjectId": w.subjectId, "weeklyHours": w.weeklyHours, "semester": w.semester,
                "suggestedTeacherId": ranked[0]["id"] if ranked else None,
            })
        return {
            "teacher": {"id": teacher.id, "fullName": teacher.fullName, "status": teacher.status,
                        "department": teacher.department.name if teacher.department else None},
            "workloads": workloads,
            "candidates": colleagues,
        }

    @r.post("/{row_id}/handover", dependencies=[Depends(require_write("teachers"))])
    def handover(row_id: int, request: Request, body: dict = Depends(get_body),
                 user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        status = body.get("status")
        assignments = body.get("assignments") if isinstance(body.get("assignments"), list) else []
        if status not in GONE_STATUSES:
            raise HTTPException(400, f'status "{GONE_STATUSES[0]}" yoki "{GONE_STATUSES[1]}" bo\'lishi kerak')

        teacher = db.get(Teacher, row_id)
        if teacher is None or not _in_scope(user, teacher):
            raise HTTPException(404, "O'qituvchi topilmadi")
        workloads = _active_workloads(db, teacher.id)

        by_workload = {}
        for a in assignments:
            if not isinstance(a, dict):
                continue
            wid, tid = _to_int(a.get("workloadId")), _to_int(a.get("toTeacherId"))
            if wid is not None and tid is not None:
                by_workload[wid] = tid
        leftover = [w for w in workloads if not by_workload.get(w.id)]
        if leftover:
            raise HTTPException(400, f"Taqsimlanmagan yuklamalar bor ({len(leftover)} ta) — har biriga qabul qiluvchi tanlang")

        target_ids = list(dict.fromkeys(by_workload.values()))
        targets = {t.id: t for t in db.scalars(select(Teacher).where(Teacher.id.in_(target_ids))).all()} if target_ids else {}
        for tid in target_ids:
            t = targets.get(tid)
            if not t or t.id == teacher.id or t.status != "faol" or not _in_scope(user, t):
                raise HTTPException(400, f"Qabul qiluvchi noto'g'ri (id={tid}): faol kafedradosh bo'lishi kerak")

        detail_parts = []
        for w in workloads:
            new_tid = by_workload[w.id]
            detail_parts.append(f"#{w.id}→{targets[new_tid].fullName}")
            w.teacherId = new_tid
        teacher.status = status
        db.commit()

        audit(f"Almashtirish ({status})",
              f"{teacher.fullName}: {len(workloads)} ta yuklama taqsimlandi: {', '.join(detail_parts)}",
              user.login, client_ip(request))
        return {"moved": len(workloads), "teacherId": row_id, "status": status}

    return r


# ── Foydalanuvchilar: bulk blok / blokdan chiqarish (faqat developer) ──
def users_bulk_router() -> APIRouter:
    r = APIRouter(prefix="/users")

    @r.post("/block-all")
    def block_all(request: Request, user: CurrentUser = Depends(require_developer), db: Session = Depends(get_db)):
        count = db.query(User).filter(User.isOwner == False).update({User.active: False}, synchronize_session=False)  # noqa: E712
        db.commit()
        audit("Barcha akkauntlar bloklandi", f"{count} ta akkaunt", user.login, client_ip(request))
        return {"blocked": count}

    @r.post("/unblock-all")
    def unblock_all(request: Request, user: CurrentUser = Depends(require_developer), db: Session = Depends(get_db)):
        count = db.query(User).filter(User.isOwner == False).update({User.active: True}, synchronize_session=False)  # noqa: E712
        db.commit()
        audit("Barcha akkauntlar blokdan chiqarildi", f"{count} ta akkaunt", user.login, client_ip(request))
        return {"unblocked": count}

    return r


# ── Audit logi (faqat Super Admin) va statistika ──
def audit_router() -> APIRouter:
    r = APIRouter(prefix="/audit")
    super_only = Depends(require_roles(SUPER))

    @r.get("", dependencies=[super_only])
    def list_audit(db: Session = Depends(get_db)):
        return to_json(db.scalars(select(AuditLog).order_by(AuditLog.id.desc())).all())

    @r.delete("/{row_id}", status_code=204, dependencies=[super_only])
    def delete_audit(row_id: int, db: Session = Depends(get_db)):
        row = db.get(AuditLog, row_id)
        if row is None:
            raise HTTPException(404, "Yozuv topilmadi")
        db.delete(row)
        db.commit()
        return Response(status_code=204)

    @r.delete("", dependencies=[super_only])
    def clear_audit(request: Request, user: CurrentUser = Depends(require_roles(SUPER)), db: Session = Depends(get_db)):
        count = db.query(AuditLog).delete()
        db.commit()
        audit("Tozalandi: Audit logi", f"{count} ta yozuv o'chirildi", user.login, client_ip(request))
        return {"deleted": count}

    return r


def stats_router() -> APIRouter:
    r = APIRouter()

    @r.get("/stats")
    def stats(db: Session = Depends(get_db)):
        def cnt(model, *where):
            return db.scalar(select(func.count()).select_from(model).where(*where)) or 0
        return {
            "faculties": cnt(Faculty), "departments": cnt(Department), "teachers": cnt(Teacher),
            "subjects": cnt(Subject), "groups": cnt(Group), "rooms": cnt(Room),
            "workloads": cnt(Workload, Workload.archived == False),  # noqa: E712
        }

    return r
