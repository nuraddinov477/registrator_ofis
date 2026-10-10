"""Kafedralararo arizalar (requests.js) va potok hisoboti (potok.js)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import MUDIR, OPERATOR, SUPER, AccessError, is_super_admin, restriction_blocks
from ..auth import CurrentUser, current_user, require_roles
from ..crud import client_ip, get_body
from ..db import audit, get_db
from ..engine.loaddata import MAIN_HALL_MAX, MAIN_HALL_MIN
from ..models import Department, TeachingRequest, Workload
from ..serial import to_json

CAN_ACT = [SUPER, OPERATOR, MUDIR]
REQUEST_INCLUDE = {"fromDepartment": None, "toDepartment": None, "teacher": None, "subject": None, "room": None}


def require_actor(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if user.role not in CAN_ACT:
        raise HTTPException(403, "Ruxsat yetarli emas")
    if restriction_blocks(user, "requests", "write"):
        raise HTTPException(403, "Ruxsat yetarli emas (cheklangan)")
    return user


def _num(v):
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _str(v):
    if v is None or v == "":
        return None
    return str(v).strip()


def _assert_dept_in_scope(db: Session, user: CurrentUser, dept_id, label: str):
    if is_super_admin(user):
        return
    if dept_id is None:
        raise AccessError(f"{label} kafedra ko'rsatilmagan", 400)
    if user.role == MUDIR:
        if user.departmentId is None:
            raise AccessError("Sizga kafedra biriktirilmagan")
        if int(dept_id) != user.departmentId:
            raise AccessError(f"{label} sizning kafedrangiz emas")
    elif user.role == OPERATOR:
        if user.facultyId is None:
            raise AccessError("Sizga fakultet biriktirilmagan")
        dept = db.get(Department, int(dept_id))
        if not dept or dept.facultyId != user.facultyId:
            raise AccessError(f"{label} sizning fakultetingizda emas")


def requests_router() -> APIRouter:
    r = APIRouter(prefix="/requests")

    def _id(v):
        try:
            n = int(v)
            return n if n > 0 else None
        except (TypeError, ValueError):
            return None

    @r.get("")
    def list_requests(status: str = "", q: str = "", db: Session = Depends(get_db)):
        stmt = select(TeachingRequest).order_by(TeachingRequest.createdAt.desc())
        status = status.strip()
        if status and status != "all":
            stmt = stmt.where(TeachingRequest.status == status)
        rows = to_json(db.scalars(stmt).all(), REQUEST_INCLUDE)
        needle = q.strip().lower()
        if needle:
            import json
            rows = [x for x in rows if needle in json.dumps(x, ensure_ascii=False, separators=(",", ":")).lower()]
        return rows

    @r.get("/{row_id}")
    def get_request(row_id: str, db: Session = Depends(get_db)):
        rid = _id(row_id)
        if not rid:
            raise HTTPException(400, "Noto'g'ri id")
        row = db.get(TeachingRequest, rid)
        if row is None:
            raise HTTPException(404, "Topilmadi")
        return to_json(row, REQUEST_INCLUDE)

    @r.post("", status_code=201)
    def create_request(request: Request, body: dict = Depends(get_body),
                       user: CurrentUser = Depends(require_actor), db: Session = Depends(get_db)):
        frm, to = _num(body.get("fromDepartmentId")), _num(body.get("toDepartmentId"))
        if not frm or not to:
            raise HTTPException(400, "Yuboruvchi va qabul qiluvchi kafedra majburiy")
        if frm == to:
            raise HTTPException(400, "Kafedra o'ziga ariza yubora olmaydi")
        _assert_dept_in_scope(db, user, frm, "Yuboruvchi")
        row = TeachingRequest(
            fromDepartmentId=frm, toDepartmentId=to,
            teacherId=_num(body.get("teacherId")), subjectId=_num(body.get("subjectId")),
            roomId=_num(body.get("roomId")), course=_num(body.get("course")),
            targetGroups=_str(body.get("targetGroups")), weeklyHours=_num(body.get("weeklyHours")),
            message=_str(body.get("message")), status="pending", createdBy=user.login,
        )
        db.add(row)
        db.commit()
        db.expire(row)
        audit("Ariza: yangi", f"{row.fromDepartment.name if row.fromDepartment else '—'} → "
                              f"{row.toDepartment.name if row.toDepartment else '—'}", user.login, client_ip(request))
        return to_json(row, REQUEST_INCLUDE)

    @r.post("/{row_id}/respond")
    def respond_request(row_id: str, request: Request, body: dict = Depends(get_body),
                        user: CurrentUser = Depends(require_actor), db: Session = Depends(get_db)):
        rid = _id(row_id)
        if not rid:
            raise HTTPException(400, "Noto'g'ri id")
        decision = str(body.get("status") or "").strip()
        if decision not in ("accepted", "rejected"):
            raise HTTPException(400, "Holat 'accepted' yoki 'rejected' bo'lishi kerak")
        existing = db.get(TeachingRequest, rid)
        if existing is None:
            raise HTTPException(404, "Topilmadi")
        _assert_dept_in_scope(db, user, existing.toDepartmentId, "Qabul qiluvchi")
        if existing.status != "pending":
            raise HTTPException(409, "Bu arizaga allaqachon javob berilgan")
        existing.status = decision
        existing.responseNote = _str(body.get("note"))
        existing.respondedBy = user.login
        existing.respondedAt = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        db.expire(existing)
        label = "qabul qilindi" if decision == "accepted" else "rad etildi"
        audit("Ariza: javob", f"#{existing.id} {label} ({existing.toDepartment.name if existing.toDepartment else '—'})",
              user.login, client_ip(request))
        return to_json(existing, REQUEST_INCLUDE)

    @r.delete("/{row_id}", status_code=204)
    def delete_request(row_id: str, request: Request,
                       user: CurrentUser = Depends(require_roles(SUPER)), db: Session = Depends(get_db)):
        rid = _id(row_id)
        if not rid:
            raise HTTPException(400, "Noto'g'ri id")
        row = db.get(TeachingRequest, rid)
        if row is None:
            raise HTTPException(404, "Topilmadi")
        db.delete(row)
        db.commit()
        audit("Ariza: o'chirildi", f"#{rid}", user.login, client_ip(request))
        return Response(status_code=204)

    return r


def potok_router() -> APIRouter:
    r = APIRouter(prefix="/potok-report")

    @r.get("")
    def potok_report(semester: str = "1", user: CurrentUser = Depends(require_roles(SUPER, OPERATOR, MUDIR)),
                     db: Session = Depends(get_db)):
        sem = _num(semester) or 1
        workloads = db.scalars(select(Workload).where(Workload.semester == sem, Workload.archived == False)).all()  # noqa: E712
        existing = []
        for w in workloads:
            groups = [x.group for x in w.groups if x.group]
            if len(groups) <= 1:
                continue
            total = sum((g.size or 0) for g in groups)
            fits = MAIN_HALL_MIN <= total <= MAIN_HALL_MAX
            if fits:
                note = f"Katta zalga mos ({MAIN_HALL_MIN}-{MAIN_HALL_MAX} oralig'ida)"
            elif total < MAIN_HALL_MIN:
                note = f"Katta zal uchun {MAIN_HALL_MIN - total} talaba yetishmaydi"
            else:
                note = f"Katta zal sig'imidan {total - MAIN_HALL_MAX} talaba ortiqcha"
            existing.append({
                "workloadId": w.id, "subject": w.subject.name if w.subject else None,
                "teacher": w.teacher.fullName if w.teacher else None, "type": w.type,
                "weeklyHours": w.weeklyHours,
                "groups": [{"id": g.id, "name": g.name, "size": g.size} for g in groups],
                "totalSize": total, "fits": fits, "note": note,
            })
        potok_count = len(existing)
        return {
            "semester": sem,
            "stats": {
                "potokCount": potok_count,
                "totalPotokWeeklyHours": sum(e["weeklyHours"] for e in existing),
                "slotsSaved": sum((len(e["groups"]) - 1) * e["weeklyHours"] for e in existing),
                "studentsInPotok": sum(e["totalSize"] for e in existing),
            },
            "existing": existing,
        }

    return r
