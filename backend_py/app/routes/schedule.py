"""Jadval marshrutlari — server/src/routes/schedule.js ning aniq porti."""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..access import SUPER, OPERATOR, restriction_blocks
from ..auth import CurrentUser, current_user, require_roles
from ..crud import client_ip, get_body
from ..db import audit, get_db
from ..engine.jobs import start_generate_job
from ..engine.loaddata import LARGE_ROOM_CAPACITY, MAIN_HALL_MAX, MAIN_HALL_MIN
from ..engine.timeslots import DAY_NAMES, DAYS, PAIRS
from ..models import Group, Room, RoomPermission, ScheduleEntry, SchedulingRun, Subject, Teacher, TeacherConstraint
from ..serial import iso

TEACHER_ROLE = "Oʻqituvchi"
MAARUZA = "Maʼruza"


# ── yordamchilar ──

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


def _report(run):
    try:
        return json.loads(run.report) if run.report else None
    except ValueError:
        return None


def _empty_grid():
    return [[None] * DAYS for _ in range(PAIRS)]


def _all_names(db, model, attr="name"):
    return {x.id: getattr(x, attr) for x in db.scalars(select(model)).all()}


def _valid_slot(day, pair):
    return isinstance(day, int) and not isinstance(day, bool) and 0 <= day < DAYS \
        and isinstance(pair, int) and not isinstance(pair, bool) and 1 <= pair <= PAIRS


def _entry_json(e):
    return {"id": e.id, "runId": e.runId, "groupId": e.groupId, "teacherId": e.teacherId,
            "subjectId": e.subjectId, "roomId": e.roomId, "day": e.day, "pair": e.pair, "type": e.type}


def _entry_dict(e):
    return {"id": e.id, "groupId": e.groupId, "teacherId": e.teacherId, "subjectId": e.subjectId,
            "roomId": e.roomId, "day": e.day, "pair": e.pair, "type": e.type}


def _slot_conflicts(db, run_id, day, pair, group_id, teacher_id, room_id, exclude_id=None):
    stmt = select(ScheduleEntry).where(ScheduleEntry.runId == run_id, ScheduleEntry.day == day, ScheduleEntry.pair == pair)
    clashes = [c for c in db.scalars(stmt).all() if exclude_id is None or c.id != exclude_id]
    clashes = [c for c in clashes if c.groupId == group_id or c.teacherId == teacher_id or c.roomId == room_id]
    reasons = []
    if any(c.groupId == group_id for c in clashes):
        reasons.append("guruh")
    if any(c.teacherId == teacher_id for c in clashes):
        reasons.append("o'qituvchi")
    if any(c.roomId == room_id for c in clashes):
        reasons.append("xona")
    return reasons


def _room_eligibility(db, room_id, group_id, teacher_id, subject_id):
    room = db.get(Room, room_id)
    group = db.get(Group, group_id)
    if room is None:
        return "Xona topilmadi"
    if group is None:
        return "Guruh topilmadi"
    size = group.size or 0
    if room.capacity < size:
        return f'Xona sig\'imi yetarli emas: "{room.name}" {room.capacity} o\'rinli, guruhda {group.size} talaba'
    bfac = [f.id for f in room.building.faculties] if room.building else []
    own_room = subject_id is not None and any(p.subjectId == subject_id for p in room.permissions)
    if room.capacity > LARGE_ROOM_CAPACITY and not own_room:
        if not bfac and subject_id is not None:
            dedicated = db.scalar(select(func.count()).select_from(RoomPermission)
                                  .where(RoomPermission.subjectId == subject_id))
            if dedicated:
                return (f'"{room.name}" — asosiy binodagi katta zal, bu fanga boshqa joyda maxsus xona '
                        f'biriktirilgan (masalan sport zali) — bu yerdan foydalanmaydi')
        if size < MAIN_HALL_MIN or size > MAIN_HALL_MAX:
            return (f'"{room.name}" — katta zal ({room.capacity} o\'rin), faqat {MAIN_HALL_MIN}-{MAIN_HALL_MAX} '
                    f'talabali sinf uchun (bu guruhda {size} talaba) — talaba kam bo\'lsa katta zal band qilinmaydi')
    has_perm = any(
        p.teacherId == teacher_id or p.groupId == group_id
        or (group.specialtyId is not None and p.specialtyId == group.specialtyId)
        or (subject_id is not None and p.subjectId == subject_id)
        for p in room.permissions)
    if bfac and group.facultyId is not None and group.facultyId not in bfac and not has_perm:
        return f'"{room.name}" boshqa fakultet binosida — bu guruh u yerdan foydalana olmaydi'
    if room.type == "maxsus" and not has_perm:
        return f'"{room.name}" — maxsus xona, bu guruh/o\'qituvchi/yo\'nalish/fanga kirish ruxsati berilmagan'
    ex = db.scalars(select(RoomPermission).where(RoomPermission.groupId == group_id,
                                                 RoomPermission.exclusive == True)).all()  # noqa: E712
    if ex and not any(p.roomId == room_id for p in ex):
        names = [p.room.name for p in ex if p.room]
        return f"Bu guruh FAQAT \"{', '.join(names)}\" xonasiga biriktirilgan — boshqa xonaga qo'yib bo'lmaydi"
    return None


def _find_violations(entries):
    """Qattiq buzilishlar: guruh/o'qituvchi/xona to'qnashuvi va guruh oynalari (JS findViolations)."""
    lesson_map = {}
    for e in entries:
        k = (e["day"], e["pair"], e["teacherId"], e["roomId"], e["subjectId"], e["type"])
        if k not in lesson_map:
            lesson_map[k] = dict(e, groupIds=[])
        lesson_map[k]["groupIds"].append(e["groupId"])
    lessons = list(lesson_map.values())

    found = []

    def section(type_, items, entity):
        buckets = {}
        for item in items:
            buckets.setdefault((item[entity], item["day"], item["pair"]), []).append(item)
        for clash in buckets.values():
            if len(clash) < 2:
                continue
            first = clash[0]
            found.append({"type": type_, "entityId": first[entity], "day": first["day"], "pair": first["pair"],
                          "items": clash, "weight": len(clash) - 1})

    section("group", [dict(e, groupIds=[e["groupId"]]) for e in entries], "groupId")
    section("teacher", lessons, "teacherId")
    section("room", lessons, "roomId")

    by_group_day = {}
    for e in entries:
        by_group_day.setdefault((e["groupId"], e["day"]), []).append(dict(e, groupIds=[e["groupId"]]))
    for items in by_group_day.values():
        busy = {x["pair"] for x in items}
        lo, hi = min(busy), max(busy)
        empty = [p for p in range(lo + 1, hi) if p not in busy]
        if empty:
            found.append({"type": "gap", "entityId": items[0]["groupId"], "day": items[0]["day"], "pair": empty[0],
                          "gapPairs": empty, "items": sorted(items, key=lambda x: x["pair"]), "weight": len(empty)})
    return found


def _breakdown_of(violations):
    out = {"group": 0, "teacher": 0, "room": 0, "gap": 0}
    for v in violations:
        out[v["type"]] += v["weight"]
    return out


def _refresh_score(db, run_id):
    run = db.get(SchedulingRun, run_id)
    entries = [_entry_dict(e) for e in db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id)
                                                  .order_by(ScheduleEntry.id)).all()]
    breakdown = _breakdown_of(_find_violations(entries))
    parsed = _report(run)
    report = parsed if isinstance(parsed, dict) else {}
    report["breakdown"] = breakdown
    report["editedAt"] = iso(datetime.now(timezone.utc).replace(tzinfo=None))
    hard = breakdown["group"] + breakdown["teacher"] + breakdown["room"] + breakdown["gap"]
    run.hardScore = hard
    run.report = json.dumps(report, ensure_ascii=False, separators=(",", ":"))
    db.commit()
    return {"hardScore": hard, "breakdown": breakdown}


def _grids(db, run_id, group_ids):
    entries = db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id,
                                                     ScheduleEntry.groupId.in_(group_ids))).all()
    s_name = _all_names(db, Subject)
    t_name = _all_names(db, Teacher, "fullName")
    r_name = _all_names(db, Room)
    grids = {gid: _empty_grid() for gid in group_ids}
    for e in entries:
        grids[e.groupId][e.pair - 1][e.day] = {
            "id": e.id, "subject": s_name.get(e.subjectId), "teacher": t_name.get(e.teacherId),
            "room": r_name.get(e.roomId), "subjectId": e.subjectId, "teacherId": e.teacherId,
            "roomId": e.roomId, "type": e.type,
        }
    return grids


def _busy_reasons(others, entry, group_ids, day, pair, group_names):
    at_slot = [e for e in others if e["day"] == day and e["pair"] == pair]
    reasons = []
    busy_groups = sorted({e["groupId"] for e in at_slot if e["groupId"] in group_ids})
    if busy_groups:
        if len(group_ids) == 1:
            reasons.append("guruh band")
        else:
            reasons.append("guruh band: " + ", ".join(group_names.get(g, f"#{g}") for g in busy_groups))
    if any(e["teacherId"] == entry["teacherId"] for e in at_slot):
        reasons.append("o'qituvchi band")
    if any(e["roomId"] == entry["roomId"] for e in at_slot):
        reasons.append("xona band")
    return reasons


def _inner_gaps(pairs):
    return (max(pairs) - min(pairs) + 1 - len(pairs)) if pairs else 0


def _lesson_of(db, run_id, entry_id):
    entries = [_entry_dict(e) for e in db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id)
                                                  .order_by(ScheduleEntry.id)).all()]
    entry = next((e for e in entries if entry_id and e["id"] == entry_id), None)
    if entry is None:
        return None

    def same(e):
        return (e["day"] == entry["day"] and e["pair"] == entry["pair"] and e["teacherId"] == entry["teacherId"]
                and e["subjectId"] == entry["subjectId"] and e["roomId"] == entry["roomId"] and e["type"] == entry["type"])

    siblings = [e for e in entries if same(e)]
    others = [e for e in entries if not same(e)]
    return {"entry": entry, "siblings": siblings, "others": others}


def _group_names(db, group_ids):
    return {g.id: g.name for g in db.scalars(select(Group).where(Group.id.in_(list(group_ids)))).all()} if group_ids else {}


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

    @r.post("/diagnose")
    def diagnose(body: dict = Depends(get_body), user: CurrentUser = Depends(require_roles(SUPER, OPERATOR)),
                 db: Session = Depends(get_db)):
        from ..engine.loaddata import load_data_db
        from ..engine.solve import build_diagnostics
        semester = _num(body.get("semester"), 1)
        gsp = _parse_pair_map(body, "groupStartPairs")
        gep = _parse_pair_map(body, "groupEndPairs")
        ctx = load_data_db(db, semester, gsp, gep)
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
                "createdAt": iso(run.createdAt) if run.createdAt else None, "report": _report(run),
            })
        return out

    @r.get("/runs/{run_id}")
    def get_run(run_id: int, db: Session = Depends(get_db)):
        run = db.get(SchedulingRun, run_id)
        if run is None:
            raise HTTPException(404, "Run topilmadi")
        entries = db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id).order_by(ScheduleEntry.id)).all()
        from ..serial import to_json
        run_json = to_json(run)
        run_json["report"] = _report(run)
        return {"run": run_json, "schedule": [
            {"group_id": e.groupId, "teacher_id": e.teacherId, "subject_id": e.subjectId,
             "room_id": e.roomId, "day": e.day, "pair": e.pair} for e in entries]}

    @r.get("/runs/{run_id}/score")
    def run_score(run_id: int, db: Session = Depends(get_db)):
        run = db.get(SchedulingRun, run_id)
        if run is None:
            raise HTTPException(404, "Run topilmadi")
        report = _report(run)
        return {"hardScore": run.hardScore,
                "breakdown": report.get("breakdown") if isinstance(report, dict) else None}

    @r.get("/runs/{run_id}/grid")
    def run_grid(run_id: int, groupId: str = "", db: Session = Depends(get_db)):
        gid = _num(groupId, 0)
        if not gid:
            raise HTTPException(400, "groupId kerak")
        grids = _grids(db, run_id, [gid])
        return {"days": DAY_NAMES, "grid": grids[gid]}

    @r.post("/runs/{run_id}/grids")
    def run_grids(run_id: int, body: dict = Depends(get_body), db: Session = Depends(get_db)):
        raw = body.get("groupIds") if isinstance(body.get("groupIds"), list) else []
        group_ids = []
        for x in raw:
            try:
                n = int(x)
            except (TypeError, ValueError):
                continue
            if n > 0 and n not in group_ids:
                group_ids.append(n)
        if not group_ids:
            raise HTTPException(400, "groupIds kerak")
        if len(group_ids) > 1000:
            raise HTTPException(400, "Bir so'rovda ko'pi bilan 1000 ta guruh")
        grids = _grids(db, run_id, group_ids)
        return {"days": DAY_NAMES, "grids": {str(k): v for k, v in grids.items()}}

    @r.get("/runs/{run_id}/teacher-grid")
    def teacher_grid(run_id: int, teacherId: str = "", user: CurrentUser = Depends(current_user),
                     db: Session = Depends(get_db)):
        is_teacher = user.role == TEACHER_ROLE
        tid = user.teacherId if is_teacher else _num(teacherId, 0)
        if not tid:
            raise HTTPException(400, "teacherId kerak (yoki akkauntingiz o'qituvchiga bog'lanmagan)")
        entries = db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id,
                                                         ScheduleEntry.teacherId == int(tid))).all()
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
        return {"days": DAY_NAMES, "pairs": PAIRS,
                "teachers": [dict(t, free=total - t["busy"]) for t in by_t.values()]}

    @r.get("/runs/{run_id}/room-availability")
    def room_availability(run_id: int, db: Session = Depends(get_db)):
        if db.get(SchedulingRun, run_id) is None:
            raise HTTPException(404, "Run topilmadi")
        entries = db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id)).all()
        rooms = db.scalars(select(Room).order_by(Room.buildingId, Room.name)).all()
        s_name, g_name, t_name = _all_names(db, Subject), _all_names(db, Group), _all_names(db, Teacher, "fullName")
        by_r = {rm.id: {"id": rm.id, "name": rm.name, "building": (rm.building.name if rm.building else None) or "Bino belgilanmagan",
                        "capacity": rm.capacity, "busy": 0, "grid": _empty_grid()} for rm in rooms}
        for e in entries:
            rm = by_r.get(e.roomId)
            if rm is None:
                continue
            if rm["grid"][e.pair - 1][e.day] is None:
                rm["busy"] += 1
            rm["grid"][e.pair - 1][e.day] = {"group": g_name.get(e.groupId), "subject": s_name.get(e.subjectId),
                                             "teacher": t_name.get(e.teacherId)}
        total = PAIRS * DAYS
        return {"days": DAY_NAMES, "pairs": PAIRS, "rooms": [dict(x, free=total - x["busy"]) for x in by_r.values()]}

    @r.get("/runs/{run_id}/violations")
    def violations(run_id: int, db: Session = Depends(get_db)):
        run = db.get(SchedulingRun, run_id)
        if run is None:
            raise HTTPException(404, "Run topilmadi")
        entries = [_entry_dict(e) for e in db.scalars(select(ScheduleEntry).where(ScheduleEntry.runId == run_id)
                                                      .order_by(ScheduleEntry.id)).all()]
        s_name = _all_names(db, Subject)
        g_name = _all_names(db, Group)
        t_name = _all_names(db, Teacher, "fullName")
        r_name = _all_names(db, Room)
        names = {"group": g_name, "teacher": t_name, "room": r_name, "gap": g_name}

        def lesson_info(l):
            return {
                "subject": s_name.get(l["subjectId"]) or f"#{l['subjectId']}",
                "group": ", ".join(g_name.get(g) or f"#{g}" for g in l["groupIds"]),
                "teacher": t_name.get(l["teacherId"]) or f"#{l['teacherId']}",
                "room": r_name.get(l["roomId"]) or f"#{l['roomId']}",
                "type": l["type"], "pair": l["pair"],
            }

        out = []
        for v in _find_violations(entries):
            item = {
                "type": v["type"], "entityId": v["entityId"],
                "entityName": names[v["type"]].get(v["entityId"]) or f"#{v['entityId']}",
                "day": v["day"], "dayName": DAY_NAMES[v["day"]], "pair": v["pair"],
                "lessons": [lesson_info(x) for x in v["items"]],
            }
            if v["type"] == "gap":
                item["gapPairs"] = v["gapPairs"]
            out.append(item)
        out.sort(key=lambda x: (x["day"], x["pair"], x["type"]))
        return {"hardScore": run.hardScore, "violations": out}

    @r.post("/runs/{run_id}/entries", status_code=201, dependencies=[super_only])
    def add_entry(run_id: int, request: Request, body: dict = Depends(get_body),
                  user: CurrentUser = Depends(require_roles(SUPER)), db: Session = Depends(get_db)):
        if db.get(SchedulingRun, run_id) is None:
            raise HTTPException(404, "Run topilmadi")
        for k in ("groupId", "subjectId", "teacherId", "roomId"):
            v = body.get(k)
            if not isinstance(v, int) or isinstance(v, bool):
                raise HTTPException(400, f"Maydon kerak: {k}")
        day, pair = body.get("day"), body.get("pair")
        if not _valid_slot(day, pair):
            raise HTTPException(400, "Kun/juftlik noto'g'ri")
        type_ = body.get("type") or "Amaliy"
        reasons = _slot_conflicts(db, run_id, day, pair, body["groupId"], body["teacherId"], body["roomId"])
        if reasons:
            raise HTTPException(409, f"Bu mumkin emas: shu vaqtda {', '.join(reasons)} band")
        room_err = _room_eligibility(db, body["roomId"], body["groupId"], body["teacherId"], body["subjectId"])
        if room_err:
            raise HTTPException(409, room_err)
        entry = ScheduleEntry(runId=run_id, groupId=body["groupId"], subjectId=body["subjectId"],
                              teacherId=body["teacherId"], roomId=body["roomId"], day=day, pair=pair, type=type_)
        db.add(entry)
        db.commit()
        db.expire(entry)
        _refresh_score(db, run_id)
        audit("Jadvalga dars qo'shildi", f"run #{run_id} · {DAY_NAMES[day]} {pair}-juft", user.login, client_ip(request))
        return _entry_json(entry)

    @r.put("/runs/{run_id}/entries/{entry_id}", dependencies=[super_only])
    def update_entry(run_id: int, entry_id: int, request: Request, body: dict = Depends(get_body),
                     user: CurrentUser = Depends(require_roles(SUPER)), db: Session = Depends(get_db)):
        existing = db.scalars(select(ScheduleEntry).where(ScheduleEntry.id == entry_id, ScheduleEntry.runId == run_id)).first()
        if existing is None:
            raise HTTPException(404, "Dars topilmadi")
        merged = {"day": body.get("day") if body.get("day") is not None else existing.day,
                  "pair": body.get("pair") if body.get("pair") is not None else existing.pair,
                  "type": body.get("type") if body.get("type") is not None else existing.type}
        for key in ("groupId", "subjectId", "teacherId", "roomId"):
            value = body.get(key)
            if value is not None and (not isinstance(value, int) or isinstance(value, bool)):
                raise HTTPException(400, f"Maydon noto'g'ri: {key}")
            merged[key] = value if value is not None else getattr(existing, key)
        if not _valid_slot(merged["day"], merged["pair"]):
            raise HTTPException(400, "Kun/juftlik noto'g'ri")
        reasons = _slot_conflicts(db, run_id, merged["day"], merged["pair"], merged["groupId"], merged["teacherId"],
                                  merged["roomId"], exclude_id=entry_id)
        if reasons:
            raise HTTPException(409, f"Bu mumkin emas: shu vaqtda {', '.join(reasons)} band")
        room_err = _room_eligibility(db, merged["roomId"], merged["groupId"], merged["teacherId"], merged["subjectId"])
        if room_err:
            raise HTTPException(409, room_err)
        for k, v in merged.items():
            setattr(existing, k, v)
        db.commit()
        db.expire(existing)
        _refresh_score(db, run_id)
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
        _refresh_score(db, run_id)
        audit("Jadvaldan dars o'chirildi", f"run #{run_id}", user.login, client_ip(request))
        return Response(status_code=204)

    @r.get("/runs/{run_id}/entries/{entry_id}/moves", dependencies=[super_only])
    def entry_moves(run_id: int, entry_id: int, db: Session = Depends(get_db)):
        if db.get(SchedulingRun, run_id) is None:
            raise HTTPException(404, "Run topilmadi")
        lesson = _lesson_of(db, run_id, entry_id)
        if lesson is None:
            raise HTTPException(404, "Dars topilmadi")
        entry, siblings, others = lesson["entry"], lesson["siblings"], lesson["others"]
        group_ids = {e["groupId"] for e in siblings}
        group_names = _group_names(db, group_ids)
        base = {g: {} for g in group_ids}
        for e in others:
            if e["groupId"] in base:
                base[e["groupId"]].setdefault(e["day"], set()).add(e["pair"])
        blocked_days, allowed_pairs = set(), set()
        tc = db.scalars(select(TeacherConstraint).where(TeacherConstraint.teacherId == entry["teacherId"])).first()
        if tc is not None:
            for raw, target in ((tc.blockedDays, blocked_days), (tc.allowedPairs, allowed_pairs)):
                try:
                    values = json.loads(raw) if raw else []
                except ValueError:
                    values = []
                if isinstance(values, list):
                    for v in values:
                        if isinstance(v, int) and not isinstance(v, bool):
                            target.add(v)
        empty = set()
        cells = []
        for pair in range(1, PAIRS + 1):
            row = []
            for day in range(DAYS):
                if day == entry["day"] and pair == entry["pair"]:
                    row.append({"status": "current", "reasons": [], "gapDelta": 0})
                    continue
                reasons = _busy_reasons(others, entry, group_ids, day, pair, group_names)
                warnings = []
                against = day in blocked_days or (len(allowed_pairs) > 0 and pair not in allowed_pairs)
                if against:
                    warnings.append("o'qituvchi istisnosiga zid")
                delta = 0
                for days in base.values():
                    src = days.get(entry["day"], empty)
                    dst = days.get(day, empty)
                    if day == entry["day"]:
                        delta += _inner_gaps(src | {pair}) - _inner_gaps(src | {entry["pair"]})
                    else:
                        delta += (_inner_gaps(src) + _inner_gaps(dst | {pair})
                                  - _inner_gaps(src | {entry["pair"]}) - _inner_gaps(dst))
                if delta > 0:
                    warnings.append(f"{delta} ta oyna paydo bo'ladi")
                elif delta < 0 and not reasons:
                    warnings.append(f"{-delta} ta oynani yopadi")
                status = "busy" if reasons else ("warn" if (delta > 0 or against) else "ok")
                row.append({"status": status, "reasons": reasons + warnings, "gapDelta": delta})
            cells.append(row)
        return {"entryId": entry["id"], "day": entry["day"], "pair": entry["pair"],
                "groups": [group_names.get(g) or f"#{g}" for g in sorted(group_ids)], "cells": cells}

    @r.post("/runs/{run_id}/entries/{entry_id}/move", dependencies=[super_only])
    def move_entry(run_id: int, entry_id: int, request: Request, body: dict = Depends(get_body),
                   user: CurrentUser = Depends(require_roles(SUPER)), db: Session = Depends(get_db)):
        if db.get(SchedulingRun, run_id) is None:
            raise HTTPException(404, "Run topilmadi")
        day, pair = body.get("day"), body.get("pair")
        if not _valid_slot(day, pair):
            raise HTTPException(400, "Kun/juftlik noto'g'ri")
        lesson = _lesson_of(db, run_id, entry_id)
        if lesson is None:
            raise HTTPException(404, "Dars topilmadi")
        entry, siblings, others = lesson["entry"], lesson["siblings"], lesson["others"]
        if day != entry["day"] or pair != entry["pair"]:
            group_ids = {e["groupId"] for e in siblings}
            reasons = _busy_reasons(others, entry, group_ids, day, pair, _group_names(db, group_ids))
            if reasons:
                raise HTTPException(409, f"Bu mumkin emas: shu vaqtda {', '.join(reasons)}")
            source = f"{DAY_NAMES[entry['day']]} {entry['pair']}-juft"
            sib_ids = [e["id"] for e in siblings]
            for row in db.scalars(select(ScheduleEntry).where(ScheduleEntry.id.in_(sib_ids))).all():
                row.day, row.pair = day, pair
            db.commit()
            audit("Jadval darsi ko'chirildi",
                  f"run #{run_id} · {source} → {DAY_NAMES[day]} {pair}-juft ({len(siblings)} ta guruh)",
                  user.login, client_ip(request))
        score = _refresh_score(db, run_id)
        return {"moved": len(siblings), "day": day, "pair": pair, **score}

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
