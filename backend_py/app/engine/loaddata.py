"""Kontekst tuzish — server/src/engine/loadData.js (buildContext) ning aniq porti.

Kirish: Prisma javobiga o'xshash dict'lar (workloads / rooms / teacherConstraints). DB'dan o'qish
load_data_db() da; testlar uchun to'g'ridan-to'g'ri buildContext() ishlatiladi.
"""
import json
import math

from ..models import Room, TeacherConstraint, Workload  # noqa: F401  (DB adapter uchun)
from .timeslots import PAIRS, allowed_slots, day_of, pair_of

LARGE_ROOM_CAPACITY = 60
MAIN_HALL_MIN = 65
MAIN_HALL_MAX = 105
SEMINAR = "Seminar"

ROOM_PROBLEMS = {
    "capacity": "sig'imi yetmaydi",
    "hall_dedicated": "asosiy binodagi katta zal — bu fanning o'z maxsus xonasi bor",
    "hall_size": f"katta zal — faqat {MAIN_HALL_MIN}-{MAIN_HALL_MAX} talabali sinf uchun",
    "faculty": "boshqa fakultet binosida",
    "special": "maxsus xona, kirish ruxsati yo'q",
    "exclusive": "guruh boshqa xona(lar)ga qat'iy biriktirilgan",
    "two_para": "2 para potok faqat asosiy binodagi katta zalga qo'yiladi",
}
FIXABLE_ROOM_PROBLEMS = {"faculty", "special"}


def js_number(v) -> float:
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


def js_int(value):
    """Number(v) butun son bo'lsa — int, aks holda None (boolean ham None)."""
    if value is None or isinstance(value, bool):
        return None
    n = js_number(value)
    if math.isfinite(n) and n.is_integer():
        return int(n)
    return None


def lesson_parts(members, lesson_type, size_of):
    """Seminar potoki sig'imdan katta bo'lsa — ikkiga bo'linadi (talaba soni eng teng joydan)."""
    sizes = [size_of(m) for m in members]
    total = sum(sizes)
    if lesson_type != SEMINAR or len(members) < 2 or total <= LARGE_ROOM_CAPACITY:
        return [members]
    best, best_diff, prefix = 1, math.inf, 0
    for k in range(1, len(members)):
        prefix += sizes[k - 1]
        diff = abs(total - 2 * prefix)
        if diff < best_diff:
            best_diff = diff
            best = k
    return [members[:best], members[best:]]


def _member_size(member):
    g = member.get("group") if member else None
    return (g.get("size") or 0) if g else 0


class Event:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class Ctx:
    def __init__(self):
        self.events = []
        self.by_group = {}
        self.by_teacher = {}
        self.rooms = []
        self.infeasible = []
        self.semester = 1
        self.group_start_pairs = {}
        self.group_start = {}
        self.group_end = {}


def _uniq(items):
    return list(dict.fromkeys(items))


def build_context(workloads, rooms, teacher_constraints, semester=1, group_start_pairs=None, group_end_pairs=None):
    group_start_pairs = group_start_pairs or {}
    group_end_pairs = group_end_pairs or {}

    def start_pair_of(gid):
        v = js_int(group_start_pairs.get(gid)) if gid is not None else None
        return v if v is not None and 1 <= v <= PAIRS else 1

    def end_pair_of(gid, start):
        v = js_int(group_end_pairs.get(gid)) if gid is not None else None
        return v if v is not None and start <= v <= PAIRS else PAIRS

    # xona metama'lumoti (JS: roomMeta). Tartibli to'plamlar — dict kalitlari sifatida
    room_meta = []
    for r in rooms:
        bld = r.get("building")
        meta = {
            "id": r["id"], "name": r.get("name"), "capacity": r.get("capacity"), "type": r.get("type"),
            "facultyIds": [f["id"] for f in ((bld or {}).get("faculties") or [])],
            "teachers": set(), "groups": set(), "specialties": set(), "exclusiveGroups": set(), "subjects": set(),
        }
        meta = _Room(meta)
        for p in r.get("permissions") or []:
            if p.get("teacherId") is not None:
                meta.teachers.add(p["teacherId"])
            if p.get("groupId") is not None:
                meta.groups.add(p["groupId"])
                if p.get("exclusive"):
                    meta.exclusiveGroups.add(p["groupId"])
            if p.get("specialtyId") is not None:
                meta.specialties.add(p["specialtyId"])
            if p.get("subjectId") is not None:
                meta.subjects.add(p["subjectId"])
        room_meta.append(meta)

    group_room_map, group_only_room_map, teacher_room_map, subject_room_map = {}, {}, {}, {}

    def add_to(mp, key, room_id):
        mp.setdefault(key, {})[room_id] = None  # tartibli to'plam

    for r in room_meta:
        for gid in r.groups:
            add_to(group_room_map, gid, r.id)
        for gid in r.exclusiveGroups:
            add_to(group_only_room_map, gid, r.id)
        for tid in r.teachers:
            add_to(teacher_room_map, tid, r.id)
        for sid in r.subjects:
            add_to(subject_room_map, sid, r.id)

    tc_map = {}
    for tc in teacher_constraints:
        try:
            blocked = json.loads(tc["blockedDays"]) if tc.get("blockedDays") else []
        except ValueError:
            blocked = []
        try:
            allowed = json.loads(tc["allowedPairs"]) if tc.get("allowedPairs") else []
        except ValueError:
            allowed = []
        tc_map[tc["teacherId"]] = {"blocked": set(blocked), "allowed": set(allowed)}

    def has_room_permission(room, ev):
        return (ev.teacherId in room.teachers
                or any(gid in room.groups for gid in ev.groupIds)
                or any(sid in room.specialties for sid in ev.specialtyIds)
                or ev.subjectId in room.subjects)

    def room_rejection(room, ev):
        if room.capacity < ev.groupSize:
            return "capacity"
        is_own = ev.subjectId in room.subjects
        if not is_own and room.capacity > LARGE_ROOM_CAPACITY:
            if len(room.facultyIds) == 0 and ev.subjectId is not None and ev.subjectId in subject_room_map:
                return "hall_dedicated"
            if ev.groupSize < MAIN_HALL_MIN or ev.groupSize > MAIN_HALL_MAX:
                return "hall_size"
        if room.facultyIds and not any(fid in ev.facultyIds for fid in room.facultyIds) and not has_room_permission(room, ev):
            return "faculty"
        if room.type == "umumiy":
            return None
        return None if has_room_permission(room, ev) else "special"

    def room_suggestions(ev, exclusive_rooms, is_two_para, limit=3):
        if exclusive_rooms is not None:
            pool = [r for r in room_meta if r.id in exclusive_rooms]
        elif is_two_para:
            pool = [r for r in room_meta if len(r.facultyIds) == 0 and r.capacity > LARGE_ROOM_CAPACITY]
        else:
            pool = room_meta
        pool = [r for r in pool if len(r.subjects) == 0 or ev.subjectId in r.subjects]
        rejected = []
        for r in pool:
            code = room_rejection(r, ev)
            if code is not None:
                rejected.append((r, code))

        def collapse(rows, count):
            items = {}
            for r, code in rows:
                key = f"{code}|{r.capacity}"
                if key in items:
                    items[key]["more"] += 1
                elif len(items) < count:
                    items[key] = {
                        "roomId": r.id, "room": r.name, "capacity": r.capacity, "code": code,
                        "problem": (f"{r.capacity} o'rin — {ev.groupSize} talabaga sig'maydi" if code == "capacity"
                                    else ROOM_PROBLEMS[code]),
                        "fixable": code in FIXABLE_ROOM_PROBLEMS, "more": 0,
                    }
            return list(items.values())

        by_capacity = sorted
        fixable = collapse(by_capacity([x for x in rejected if x[1] in FIXABLE_ROOM_PROBLEMS], key=lambda x: x[0].capacity), limit)
        if fixable:
            return fixable
        other = collapse(by_capacity([x for x in rejected if x[1] != "capacity"], key=lambda x: x[0].capacity), limit - 1)
        biggest = sorted([x for x in rejected if x[1] == "capacity"], key=lambda x: -x[0].capacity)
        return other + collapse(biggest, limit - len(other))

    def apply_teacher_constraint(slots, teacher_id):
        tc = tc_map.get(teacher_id)
        if not tc or (len(tc["blocked"]) == 0 and len(tc["allowed"]) == 0):
            return slots
        return [s for s in slots if day_of(s) not in tc["blocked"]
                and (len(tc["allowed"]) == 0 or pair_of(s) in tc["allowed"])]

    events, infeasible = [], []
    group_start, group_end = {}, {}
    counter = [0]

    def add_events(w, members, part):
        wgroups = [m["group"] for m in members if m.get("group")]
        group_ids = [m["groupId"] for m in members]
        teacher_id, subject_id = w["teacherId"], w["subjectId"]
        assigned = _uniq([
            *[rid for gid in group_ids for rid in group_room_map.get(gid, {})],
            *teacher_room_map.get(teacher_id, {}),
            *subject_room_map.get(subject_id, {}),
        ])
        assigned_set = set(assigned)
        ex_sets = [group_only_room_map[gid] for gid in group_ids if gid in group_only_room_map]
        exclusive_rooms = ([rid for rid in ex_sets[0] if all(rid in s for s in ex_sets)] if ex_sets else None)

        first = wgroups[0] if wgroups else None
        first_id = first["id"] if first else None
        is_potok = len(group_ids) > 1
        potok_size = sum((g.get("size") or 0) for g in wgroups)
        is_two_para = (is_potok and w.get("weeklyHours") == 2 and subject_id not in subject_room_map
                       and MAIN_HALL_MIN <= potok_size <= MAIN_HALL_MAX)
        member_starts = [start_pair_of(g["id"]) for g in wgroups]
        member_ends = [end_pair_of(g["id"], member_starts[i]) for i, g in enumerate(wgroups)]
        for i, g in enumerate(wgroups):
            group_start[g["id"]] = member_starts[i]
            group_end[g["id"]] = member_ends[i]
        slot_lo = max(member_starts) if wgroups else 1
        slot_hi = min(member_ends) if wgroups else PAIRS

        template = None
        for _ in range(w.get("weeklyHours") or 1):
            start = start_pair_of(first_id)
            lesson_type = w.get("type") or "Amaliy"
            ev = Event(
                id=counter[0], workloadId=w["id"], groupIds=group_ids, uniqueGroupIds=_uniq(group_ids),
                teacherId=teacher_id, subjectId=subject_id, type=lesson_type,
                rank=_rank(lesson_type), single=len(group_ids) == 1,
                groupNames=[g.get("name") for g in wgroups],
                teacherName=(w.get("teacher") or {}).get("fullName"),
                subjectName=(w.get("subject") or {}).get("name"),
                course=first.get("course") if first and first.get("course") is not None else 1,
                startPair=start, endPair=end_pair_of(first_id, start),
                groupSize=sum((g.get("size") or 0) for g in wgroups),
                specialtyIds=_uniq([g["specialtyId"] for g in wgroups if g.get("specialtyId") is not None]),
                facultyIds=_uniq([g["facultyId"] for g in wgroups if g.get("facultyId") is not None]),
                difficulty=_diff(w), assignedRooms=assigned, assignedSet=assigned_set,
                slot=-1, room=-1, slots=[], rooms=[], roomCapacities={}, reason=None, blockKind=None,
                suggestions=[], part=part,
            )
            counter[0] += 1
            if template is not None:
                ev.slots = template.slots
                ev.rooms = template.rooms
                ev.roomCapacities = template.roomCapacities
                ev.reason = template.reason
                ev.blockKind = template.blockKind
                ev.suggestions = template.suggestions
                if ev.reason is not None:
                    infeasible.append(ev)
                events.append(ev)
                continue
            template = ev
            if not wgroups:
                ev.blockKind = "no_group"
                ev.reason = "yuklamaga guruh biriktirilmagan — yuklamani ochib, guruh tanlang"
                infeasible.append(ev)
                events.append(ev)
                continue
            ev.slots = apply_teacher_constraint(allowed_slots(slot_lo, slot_hi) if slot_lo <= slot_hi else [], teacher_id)
            if is_two_para:
                ev.slots = [s for s in ev.slots if day_of(s) <= 2]
            candidates = [r for r in room_meta
                          if room_rejection(r, ev) is None
                          and (exclusive_rooms is None or r.id in exclusive_rooms)
                          and (not is_two_para or (len(r.facultyIds) == 0 and r.capacity > LARGE_ROOM_CAPACITY))]
            candidates.sort(key=lambda r: (0 if r.id in assigned_set else 1,
                                           -r.capacity if is_potok else r.capacity))
            ev.rooms = [r.id for r in candidates]
            ev.roomCapacities = {r.id: r.capacity for r in candidates}

            if not ev.slots:
                ev.blockKind = "potok_range" if slot_lo > slot_hi else "time"
                if slot_lo > slot_hi:
                    ev.reason = "potokdagi guruhlarning juftlik oraliqlari kesishmaydi — birga o'tiladigan dars uchun umumiy vaqt yo'q"
                elif is_two_para:
                    ev.reason = "2 para potok qoidasi: Dushanba/Seshanba/Chorshanba kunlarida (yoki o'qituvchining istisnolari tufayli) bo'sh vaqt qolmadi"
                else:
                    ev.reason = "o'qituvchining istisnolari (bloklangan kunlar / faqat ayrim juftliklar) tufayli bo'sh vaqt qolmadi"
                infeasible.append(ev)
            elif not ev.rooms:
                ev.blockKind = "two_para" if is_two_para else "room"
                ev.suggestions = room_suggestions(ev, exclusive_rooms, is_two_para)
                fit_by_cap = [r for r in room_meta if r.capacity >= ev.groupSize]
                fit_by_faculty = [r for r in fit_by_cap
                                  if len(r.facultyIds) == 0 or any(fid in ev.facultyIds for fid in r.facultyIds)]
                if is_two_para:
                    ev.reason = "2 para potok qoidasi: faqat asosiy binodagi Katta zalga qo'yiladi (qat'iy), lekin mos/bo'sh Katta zal topilmadi"
                elif exclusive_rooms is not None:
                    names = [r.name for r in room_meta if r.id in exclusive_rooms]
                    if len(exclusive_rooms) == 0:
                        ev.reason = "potokdagi guruhlar har xil xonaga QAT'IY biriktirilgan — bitta darsga umumiy xona yo'q"
                    else:
                        ev.reason = (f"guruh FAQAT \"{', '.join(names)}\" xonasiga biriktirilgan, lekin u sig'maydi "
                                     f"yoki band ({ev.groupSize} kishi)")
                elif not fit_by_cap:
                    max_cap = max((r.capacity for r in room_meta), default=0)
                    ev.reason = f"guruh {ev.groupSize} kishilik — sig'imi yetarli xona yo'q (eng katta xona {max_cap} o'rin)"
                elif not fit_by_faculty:
                    ev.reason = "fakultet binosida (yoki asosiy binoda) sig'imi mos xona yo'q — boshqa fakultet binosidan foydalanib bo'lmaydi"
                elif subject_id in subject_room_map and all(r.capacity > LARGE_ROOM_CAPACITY and len(r.facultyIds) == 0 for r in fit_by_faculty):
                    ev.reason = "bu fanga maxsus xona biriktirilgan (masalan sport zali) — asosiy binodagi katta zaldan foydalanmaydi, lekin o'ziga tegishli xona yetarli emas yoki band"
                elif all(r.capacity > LARGE_ROOM_CAPACITY for r in fit_by_faculty):
                    if ev.groupSize < MAIN_HALL_MIN:
                        ev.blockKind = "between"
                    ev.reason = (f"{ev.groupSize} talaba — oddiy xonalarga sig'maydi, katta zallar esa faqat "
                                 f"{MAIN_HALL_MIN}-{MAIN_HALL_MAX} talabali sinf uchun (talaba kam bo'lsa katta zal band qilinmaydi)")
                else:
                    ev.reason = "faqat maxsus xonalar mos keladi, lekin bu guruh/o'qituvchi/yo'nalish/fanga kirish ruxsati berilmagan"
                infeasible.append(ev)
            events.append(ev)

    for w in workloads:
        parts = lesson_parts(w.get("groups") or [], w.get("type") or "Amaliy", _member_size)
        for i, members in enumerate(parts):
            add_events(w, members, f"{i + 1}/{len(parts)}" if len(parts) > 1 else None)

    by_group, by_teacher = {}, {}
    for ev in events:
        by_teacher.setdefault(ev.teacherId, []).append(ev)
        for gid in ev.groupIds:
            by_group.setdefault(gid, []).append(ev)

    ctx = Ctx()
    ctx.events = events
    ctx.by_group = by_group
    ctx.by_teacher = by_teacher
    ctx.rooms = room_meta
    ctx.infeasible = infeasible
    ctx.semester = semester
    ctx.group_start_pairs = group_start_pairs
    ctx.group_start = group_start
    ctx.group_end = group_end
    return ctx


def _rank(lesson_type):
    from .constraints import TYPE_RANK
    return TYPE_RANK.get(lesson_type)


def _diff(w):
    s = w.get("subject")
    if s and s.get("difficulty") is not None:
        return s["difficulty"]
    return 3


class _Room:
    """Xona metama'lumoti: attribut sifatida kirish (room.capacity, room.teachers ...)."""

    def __init__(self, d):
        self.__dict__.update(d)


def load_data_db(db, semester=1, group_start_pairs=None, group_end_pairs=None):
    """DB (SQLAlchemy) dan kirishni tuzib, build_context() ni chaqiradi."""
    from sqlalchemy import select
    from ..serial import to_json

    wl_rows = db.scalars(select(Workload).where(Workload.semester == semester, Workload.archived == False)  # noqa: E712
                         .order_by(Workload.id)).all()
    room_rows = db.scalars(select(Room).order_by(Room.id)).all()
    tc_rows = db.scalars(select(TeacherConstraint).order_by(TeacherConstraint.id)).all()
    workloads = []
    for w in wl_rows:
        d = {"id": w.id, "teacherId": w.teacherId, "subjectId": w.subjectId, "weeklyHours": w.weeklyHours,
             "type": w.type, "semester": w.semester,
             "groups": [{"groupId": x.groupId, "group": _group_dict(x.group)} for x in sorted(w.groups, key=lambda x: x.groupId)],
             "teacher": {"fullName": w.teacher.fullName} if w.teacher else None,
             "subject": {"name": w.subject.name, "difficulty": w.subject.difficulty} if w.subject else None}
        workloads.append(d)
    rooms = []
    for r in room_rows:
        rooms.append({
            "id": r.id, "name": r.name, "capacity": r.capacity, "type": r.type,
            "permissions": [{"teacherId": p.teacherId, "groupId": p.groupId, "specialtyId": p.specialtyId,
                             "subjectId": p.subjectId, "exclusive": bool(p.exclusive)}
                            for p in sorted(r.permissions, key=lambda p: p.id)],
            "building": ({"faculties": [{"id": f.id} for f in sorted(r.building.faculties, key=lambda f: f.id)]}
                         if r.building else {"faculties": []}),
        })
    constraints = [{"teacherId": t.teacherId, "blockedDays": t.blockedDays, "allowedPairs": t.allowedPairs}
                   for t in tc_rows]
    return build_context(workloads, rooms, constraints, semester, group_start_pairs, group_end_pairs)


def _group_dict(g):
    if g is None:
        return None
    return {"id": g.id, "name": g.name, "size": g.size, "course": g.course,
            "facultyId": g.facultyId, "specialtyId": g.specialtyId}
