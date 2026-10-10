"""Jadval marshrutlari — server/src/routes/schedule.js porti."""
import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..access import OPERATOR, SUPER, restriction_blocks
from ..auth import CurrentUser, current_user, require_roles
from ..crud import client_ip, get_body
from ..db import audit, get_db
from ..serial import iso, to_json
from ..engine.jobs import start_generate_job
from ..engine.loaddata import LARGE_ROOM_CAPACITY, MAIN_HALL_MAX, MAIN_HALL_MIN, load_data
from ..engine.solve import build_diagnostics
from ..engine.timeslots import DAY_NAMES, DAYS, PAIRS
from ..models import Group, Subject, Teacher, Room, RoomPermission, ScheduleEntry, SchedulingRun

TEACHER_ROLE = "Oʻqituvchi"  # U+02BB — schedule.js'dagi bilan bir xil


def _parse_pair_map(body, key):
    src = body.get(key)
    if not isinstance(src, dict):
        return {}
    out = {}
    for gid, v in src.items():
        try:
            g, p = int(gid), int(v)
        except (TypeError, ValueError):
            continue
        if g > 0 and 1 <= p <= PAIRS:
            out[g] = p
    return out


def _num(v, default):
    try:
        n = int(float(v))
        return n if n else default
    except (TypeError, ValueError):
        return default


def _report(run) -> object:
    try:
        return json.loads(run.report) if run.report else None
    except ValueError:
        return None


def _empty_grid():
    return [[None] * DAYS for _ in range(PAIRS)]


def _names(db, model, ids, attr="name"):
    if not ids:
        return {}
    return {x.id: getattr(x, attr) for x in db.scalars(select(model).where(model.id.in_(list(ids)))).all()}


def _all_names(db, model, attr="name"):
    return {x.id: getattr(x, attr) for x in db.scalars(select(model)).all()}


def _valid_slot(day, pair):
    return isinstance(day, int) and 0 <= day < DAYS and isinstance(pair, int) and 1 <= pair <= PAIRS


def _slot_conflicts(db, run_id, day, pair, group_id, teacher_id, room_id, exclude_id=None):
    stmt = select(ScheduleEntry).where(ScheduleEntry.runId == run_id, ScheduleEntry.day == day, ScheduleEntry.pair == pair)
    if exclude_id:
        stmt = stmt.where(ScheduleEntry.id != exclude_id)
    clashes = db.scalars(stmt).all()
    reasons = []
    if any(c.groupId == group_id for c in clashes):
        reasons.append("guruh")
    if any(c.teacherId == teacher_id for c in clashes):
        reasons.append("o'qituvchi")
    if any(c.roomId == room_id for c in clashes):
        reasons.append("xona")
    return reasons


def _room_eligibility(db, room_id, group_id, teacher_id, type_, subject_id):
    room = db.get(Room, room_id)
    group = db.get(Group, group_id)
    if room is None:
        return "Xona topilmadi"
    if group is None:
        return "Guruh topilmadi"
    if room.capacity < (group.size or 0):
        return f'Xona sig\'imi yetarli emas: "{room.name}" {room.capacity} o\'rinli, guruhda {group.size} talaba'
    bfac = [f.id for f in room.building.faculties] if room.building else []
    if room.capacity > LARGE_ROOM_CAPACITY:
        if not bfac:
            if subject_id is not None:
                dedicated = db.scalar(select(func.count()).select_from(RoomPermission)
                                      .join(Room, RoomPermission.roomId == Room.id)
                                      .where(RoomPermission.subjectId == subject_id, Room.type == "maxsus"))
                if dedicated:
                    return (f'"{room.name}" — asosiy binodagi katta zal, bu fanga boshqa joyda maxsus xona '
                            f'biriktirilgan (masalan sport zali) — bu yerdan foydalanmaydi')
            size = group.size or 0
            if size < MAIN_HALL_MIN or size > MAIN_HALL_MAX:
                return (f'"{room.name}" — asosiy binodagi katta zal ({room.capacity} o\'rin), faqat '
                        f'{MAIN_HALL_MIN}-{MAIN_HALL_MAX} talabali guruh/potok uchun ajratilgan (bu guruhda {size} talaba)')
        elif type_ == "Maʼruza" and (group.size or 0) <= LARGE_ROOM_CAPACITY:
            return (f'"{room.name}" — katta auditoriya ({room.capacity} o\'rin), ma\'ruzada faqat '
                    f'{LARGE_ROOM_CAPACITY} dan ortiq talabali guruh/potok uchun ajratilgan (bu guruhda {group.size} talaba)')
    perms = room.permissions
    has_perm = any(
        p.teacherId == teacher_id or p.groupId == group_id
        or (group.specialtyId is not None and p.specialtyId == group.specialtyId)
        or (subject_id is not None and p.subjectId == subject_id)
        for p in perms)
    if bfac and group.facultyId is not None and group.facultyId not in bfac and not has_perm:
        return f'"{room.name}" boshqa fakultet binosida — bu guruh u yerdan foydalana olmaydi'
    if room.type == "maxsus" and not has_perm:
        return f'"{room.name}" — maxsus xona, bu guruh/o\'qituvchi/yo\'nalish/fanga kirish ruxsati berilmagan'
    ex = db.scalars(select(RoomPermission).where(RoomPermission.groupId == group_id, RoomPermission.exclusive == True)).all()  # noqa: E712
    if ex and not any(p.roomId == room_id for p in ex):
        names = [p.room.name for p in ex if p.room]
        return f"Bu guruh FAQAT \"{', '.join(names)}\" xonasiga biriktirilgan — boshqa xonaga qo'yib bo'lmaydi"
    return None


def schedule_router() -> APIRouter:
    r = APIRouter(prefix="/schedule")
    super_only = Depends(require_roles(SUPER))

    @r.post("/generate", status_code=202)
    def generate(request: Request, body: dict = Depends(get_body),
                 user: CurrentUser = Depends(require_roles(SUPER, OPERATOR)), db: Session = Depends(get_db)):
        if restriction_blocks(user, "schedule", "write"):
            raise HTTPException(403, "Ruxsat yetarli emas (cheklangan)")
        semester = _num(body.get("semester"), 1)
        max_ms = min(120_000, _num(body.get("maxMs"), 5000))
        gsp = _parse_pair_map(body, "groupStartPairs")
        gep = _parse_pair_map(body, "groupEndPairs")
        run = SchedulingRun(semester=semester, status="running")
        db.add(run)
        db.commit()
        start_generate_job(run.id, semester, max_ms, gsp, gep)
        audit("Jadval generatsiyasi boshlandi", f"run #{run.id}", user.login, client_ip(request))
        return {"runId": run.id, "status": "running", "semester": semester, "poll": f"/api/schedule/runs/{run.id}"}

    @r.post("/diagnose", dependencies=[Depends(require_roles(SUPER, OPERATOR))])
    def diagnose(body: dict = Depends(get_body), db: Session = Depends(get_db)):
        semester = _num(body.get("semester"), 1)
        gsp = _parse_pair_map(body, "groupStartPairs")
        gep = _parse_pair_map(body, "groupEndPairs")
        ctx = load_data(db, semester, gsp, gep)
        diagnostics = build_diagnostics(ctx)
        problems = len(diagnostics["groupOverload"]) + len(diagnostics["teacherOverload"]) + len(diagnostics["blocked"])
        return {"semester": semester, "groupStartPairs": gsp, "groupEndPairs": gep,
                "totalEvents": len(ctx.events), "ok": problems == 0, "diagnostics": diagnostics}

    @r.get("/runs")
    def list_runs(all: str = "", db: Session = Depends(get_db)):
        stmt = select(SchedulingRun).order_by(SchedulingRun.id.desc())
        if all not in ("1", "true"):
            stmt = stmt.where(SchedulingRun.archived == False)  # noqa: E712
        out = []
        for run in db.scalars(stmt).all():
            out.append({
                "id": run.id, "semester": run.semester, "status": run.status, "archived": run.archived,
                "hardScore": run.hardScore, "softScore": run.softScore,
                "entries": db.query(ScheduleEntry).filter(ScheduleEntry.runId == run.id).count(),
                "createdAt": _iso(run.createdAt), "report": _report(run),
            })
        return out

    @r.get("/runs/{run_id}")
    def get_run(run_id: int, db: Session = Depends(get_db)):
        run = db.get(SchedulingRun, run_id)
        if run is None:
            raise HTTPException(404, "Run topilmadi")
        entries = db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id).order_by(ScheduleEntry.id)).all()
        run_json = to_json(run)
        run_json["report"] = _report(run)
        return {"run": run_json, "schedule": [
            {"group_id": e.groupId, "teacher_id": e.teacherId, "subject_id": e.subjectId,
             "room_id": e.roomId, "day": e.day, "pair": e.pair} for e in entries]}

    @r.get("/runs/{run_id}/grid")
    def run_grid(run_id: int, groupId: str = "", db: Session = Depends(get_db)):
        gid = _num(groupId, 0)
        if not gid:
            raise HTTPException(400, "groupId kerak")
        entries = db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id, ScheduleEntry.groupId == gid)).all()
        s_name, t_name, r_name = _all_names(db, Subject), _all_names(db, Teacher, "fullName"), _all_names(db, Room)
        grid = _empty_grid()
        for e in entries:
            grid[e.pair - 1][e.day] = {
                "id": e.id, "subject": s_name.get(e.subjectId), "teacher": t_name.get(e.teacherId),
                "room": r_name.get(e.roomId), "subjectId": e.subjectId, "teacherId": e.teacherId,
                "roomId": e.roomId, "type": e.type,
            }
        return {"days": DAY_NAMES, "grid": grid}

    @r.get("/runs/{run_id}/teacher-grid")
    def teacher_grid(run_id: int, teacherId: str = "", user: CurrentUser = Depends(current_user),
                     db: Session = Depends(get_db)):
        if user.role == TEACHER_ROLE:
            tid = user.teacherId
        else:
            tid = _num(teacherId, 0)
        if not tid:
            raise HTTPException(400, "teacherId kerak (yoki akkauntingiz o'qituvchiga bog'lanmagan)")
        entries = db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id, ScheduleEntry.teacherId == tid)).all()
        s_name, g_name, r_name = _all_names(db, Subject), _all_names(db, Group), _all_names(db, Room)
        grid = _empty_grid()
        for e in entries:
            grid[e.pair - 1][e.day] = {"subject": s_name.get(e.subjectId), "group": g_name.get(e.groupId),
                                       "room": r_name.get(e.roomId), "type": e.type}
        return {"days": DAY_NAMES, "grid": grid}

    @r.get("/runs/{run_id}/teacher-availability")
    def teacher_availability(run_id: int, db: Session = Depends(get_db)):
        if db.get(SchedulingRun, run_id) is None:
            raise HTTPException(404, "Run topilmadi")
        entries = db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id)).all()
        teachers = db.scalars(select(Teacher).order_by(Teacher.fullName)).all()
        s_name, g_name, r_name = _all_names(db, Subject), _all_names(db, Group), _all_names(db, Room)
        by_t = {t.id: {"id": t.id, "name": t.fullName, "busy": 0, "grid": _empty_grid()} for t in teachers}
        for e in entries:
            t = by_t.get(e.teacherId)
            if t is None:
                continue
            if t["grid"][e.pair - 1][e.day] is None:
                t["busy"] += 1
            t["grid"][e.pair - 1][e.day] = {"subject": s_name.get(e.subjectId), "group": g_name.get(e.groupId),
                                            "room": r_name.get(e.roomId)}
        total = PAIRS * DAYS
        result = [dict(t, free=total - t["busy"]) for t in by_t.values()]
        return {"days": DAY_NAMES, "pairs": PAIRS, "teachers": result}

    @r.get("/runs/{run_id}/room-availability")
    def room_availability(run_id: int, db: Session = Depends(get_db)):
        if db.get(SchedulingRun, run_id) is None:
            raise HTTPException(404, "Run topilmadi")
        entries = db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id)).all()
        rooms = db.scalars(select(Room).order_by(Room.buildingId, Room.name)).all()
        s_name, g_name, t_name = _all_names(db, Subject), _all_names(db, Group), _all_names(db, Teacher, "fullName")
        by_r = {}
        for rm in rooms:
            by_r[rm.id] = {"id": rm.id, "name": rm.name,
                           "building": rm.building.name if rm.building and rm.building.name else "Bino belgilanmagan",
                           "capacity": rm.capacity, "busy": 0, "grid": _empty_grid()}
        for e in entries:
            rm = by_r.get(e.roomId)
            if rm is None:
                continue
            if rm["grid"][e.pair - 1][e.day] is None:
                rm["busy"] += 1
            rm["grid"][e.pair - 1][e.day] = {"group": g_name.get(e.groupId), "subject": s_name.get(e.subjectId),
                                             "teacher": t_name.get(e.teacherId)}
        total = PAIRS * DAYS
        result = [dict(x, free=total - x["busy"]) for x in by_r.values()]
        return {"days": DAY_NAMES, "pairs": PAIRS, "rooms": result}

    @r.get("/runs/{run_id}/violations")
    def violations(run_id: int, db: Session = Depends(get_db)):
        run = db.get(SchedulingRun, run_id)
        if run is None:
            raise HTTPException(404, "Run topilmadi")
        entries = db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id)).all()
        s_name, g_name = _all_names(db, Subject), _all_names(db, Group)
        t_name, r_name = _all_names(db, Teacher, "fullName"), _all_names(db, Room)

        # Potok: bir dars guruhlar uchun bir nechta qator — o'qituvchi/xona tekshiruvida BITTA dars
        lesson_map = {}
        for e in entries:
            k = (e.day, e.pair, e.teacherId, e.roomId, e.subjectId, e.type)
            lesson_map.setdefault(k, {"day": e.day, "pair": e.pair, "teacherId": e.teacherId, "roomId": e.roomId,
                                      "subjectId": e.subjectId, "type": e.type, "groupIds": []})["groupIds"].append(e.groupId)
        lessons = list(lesson_map.values())

        def lesson_info(l):
            return {"subject": s_name.get(l["subjectId"]) or f"#{l['subjectId']}",
                    "group": ", ".join(g_name.get(g) or f"#{g}" for g in l["groupIds"]),
                    "teacher": t_name.get(l["teacherId"]) or f"#{l['teacherId']}",
                    "room": r_name.get(l["roomId"]) or f"#{l['roomId']}", "type": l["type"]}

        def section(type_, items, key_fn, name_of, out):
            m = {}
            for it in items:
                m.setdefault(key_fn(it), []).append(it)
            for (entity_id, day, pair), es in m.items():
                if len(es) < 2:
                    continue
                out.append({"type": type_, "entityId": entity_id, "entityName": name_of(entity_id),
                            "day": day, "dayName": DAY_NAMES[day], "pair": pair,
                            "lessons": [lesson_info(x) for x in es]})

        out = []
        section("group", [{"day": e.day, "pair": e.pair, "groupId": e.groupId, "teacherId": e.teacherId,
                           "roomId": e.roomId, "subjectId": e.subjectId, "type": e.type, "groupIds": [e.groupId]}
                          for e in entries],
                lambda x: (x["groupId"], x["day"], x["pair"]), lambda i: g_name.get(i) or f"#{i}", out)
        section("teacher", lessons, lambda l: (l["teacherId"], l["day"], l["pair"]), lambda i: t_name.get(i) or f"#{i}", out)
        section("room", lessons, lambda l: (l["roomId"], l["day"], l["pair"]), lambda i: r_name.get(i) or f"#{i}", out)
        out.sort(key=lambda v: (v["day"], v["pair"], v["type"]))
        return {"hardScore": run.hardScore, "violations": out}

    @r.post("/runs/{run_id}/entries", status_code=201, dependencies=[super_only])
    def add_entry(run_id: int, request: Request, body: dict = Depends(get_body),
                  user: CurrentUser = Depends(require_roles(SUPER)), db: Session = Depends(get_db)):
        if db.get(SchedulingRun, run_id) is None:
            raise HTTPException(404, "Run topilmadi")
        vals = {k: body.get(k) for k in ("groupId", "subjectId", "teacherId", "roomId", "day", "pair", "type")}
        for k in ("groupId", "subjectId", "teacherId", "roomId"):
            if not isinstance(vals[k], int):
                raise HTTPException(400, f"Maydon kerak: {k}")
        if not _valid_slot(vals["day"], vals["pair"]):
            raise HTTPException(400, "Kun/juftlik noto'g'ri")
        reasons = _slot_conflicts(db, run_id, vals["day"], vals["pair"], vals["groupId"], vals["teacherId"], vals["roomId"])
        if reasons:
            raise HTTPException(409, f"Bu mumkin emas: shu vaqtda {', '.join(reasons)} band")
        room_err = _room_eligibility(db, vals["roomId"], vals["groupId"], vals["teacherId"],
                                     vals["type"] or "Amaliy", vals["subjectId"])
        if room_err:
            raise HTTPException(409, room_err)
        entry = ScheduleEntry(runId=run_id, groupId=vals["groupId"], subjectId=vals["subjectId"],
                              teacherId=vals["teacherId"], roomId=vals["roomId"], day=vals["day"],
                              pair=vals["pair"], type=vals["type"] or "Amaliy")
        db.add(entry)
        db.commit()
        audit("Jadvalga dars qo'shildi", f"run #{run_id} · {DAY_NAMES[vals['day']]} {vals['pair']}-juft",
              user.login, client_ip(request))
        return _entry_json(entry)

    @r.put("/runs/{run_id}/entries/{entry_id}", dependencies=[super_only])
    def update_entry(run_id: int, entry_id: int, request: Request, body: dict = Depends(get_body),
                     user: CurrentUser = Depends(require_roles(SUPER)), db: Session = Depends(get_db)):
        existing = db.scalars(select(ScheduleEntry).where(ScheduleEntry.id == entry_id, ScheduleEntry.runId == run_id)).first()
        if existing is None:
            raise HTTPException(404, "Dars topilmadi")
        merged = {
            "groupId": body.get("groupId") if body.get("groupId") is not None else existing.groupId,
            "subjectId": body.get("subjectId") if body.get("subjectId") is not None else existing.subjectId,
            "teacherId": body.get("teacherId") if body.get("teacherId") is not None else existing.teacherId,
            "roomId": body.get("roomId") if body.get("roomId") is not None else existing.roomId,
            "day": body.get("day") if body.get("day") is not None else existing.day,
            "pair": body.get("pair") if body.get("pair") is not None else existing.pair,
            "type": body.get("type") if body.get("type") is not None else existing.type,
        }
        if not _valid_slot(merged["day"], merged["pair"]):
            raise HTTPException(400, "Kun/juftlik noto'g'ri")
        reasons = _slot_conflicts(db, run_id, merged["day"], merged["pair"], merged["groupId"],
                                  merged["teacherId"], merged["roomId"], exclude_id=entry_id)
        if reasons:
            raise HTTPException(409, f"Bu mumkin emas: shu vaqtda {', '.join(reasons)} band")
        room_err = _room_eligibility(db, merged["roomId"], merged["groupId"], merged["teacherId"],
                                     merged["type"], merged["subjectId"])
        if room_err:
            raise HTTPException(409, room_err)
        for k, v in merged.items():
            setattr(existing, k, v)
        db.commit()
        audit("Jadval darsi tahrirlandi", f"run #{run_id} · {DAY_NAMES[merged['day']]} {merged['pair']}-juft",
              user.login, client_ip(request))
        return _entry_json(existing)

    @r.delete("/runs/{run_id}/entries/{entry_id}", status_code=204, dependencies=[super_only])
    def delete_entry(run_id: int, entry_id: int, request: Request,
                     user: CurrentUser = Depends(require_roles(SUPER)), db: Session = Depends(get_db)):
        existing = db.scalars(select(ScheduleEntry).where(ScheduleEntry.id == entry_id, ScheduleEntry.runId == run_id)).first()
        if existing is None:
            raise HTTPException(404, "Dars topilmadi")
        db.delete(existing)
        db.commit()
        audit("Jadvaldan dars o'chirildi", f"run #{run_id}", user.login, client_ip(request))
        return Response(status_code=204)

    @r.delete("/runs/{run_id}", status_code=204)
    def archive_run(run_id: int, request: Request,
                    user: CurrentUser = Depends(require_roles(SUPER, OPERATOR)), db: Session = Depends(get_db)):
        run = db.get(SchedulingRun, run_id)
        if run is None:
            raise HTTPException(404, "Jadval topilmadi")
        run.archived = True
        db.commit()
        audit("Arxivlandi: Jadval", f"run #{run_id}", user.login, client_ip(request))
        return Response(status_code=204)

    @r.post("/runs/{run_id}/restore")
    def restore_run(run_id: int, request: Request,
                    user: CurrentUser = Depends(require_roles(SUPER, OPERATOR)), db: Session = Depends(get_db)):
        run = db.get(SchedulingRun, run_id)
        if run is None:
            raise HTTPException(404, "Jadval topilmadi")
        run.archived = False
        db.commit()
        audit("Arxivdan tiklandi: Jadval", f"run #{run_id}", user.login, client_ip(request))
        return {"ok": True, "id": run_id}

    return r


def _entry_json(e):
    return {"id": e.id, "runId": e.runId, "groupId": e.groupId, "teacherId": e.teacherId,
            "subjectId": e.subjectId, "roomId": e.roomId, "day": e.day, "pair": e.pair, "type": e.type}


def _iso(dt):
    return iso(dt) if dt else None
