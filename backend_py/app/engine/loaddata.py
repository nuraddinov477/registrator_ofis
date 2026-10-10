"""DB'dan ma'lumotni o'qib, optimallashtirish konteksti (events + nomzod xonalar) tuzadi.

server/src/engine/loadData.js ning aniq port'i. Har bir Workload(weeklyHours=N) → N ta "event".
"""
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Room, TeacherConstraint, Workload
from .timeslots import PAIRS, allowed_slots, day_of, pair_of

LARGE_ROOM_CAPACITY = 60
MAIN_HALL_MIN = 65
MAIN_HALL_MAX = 105

TYPE_MAARUZA = "Maʼruza"  # U+02BC — loadData.js bilan bir xil


class Event:
    """Jadvalga joylanadigan eng kichik birlik (bitta haftalik juftlik)."""

    def __init__(self, **kw):
        self.reason = None
        self.__dict__.update(kw)


class RoomMeta:
    def __init__(self, room, facultyIds):
        self.id = room.id
        self.name = room.name
        self.capacity = room.capacity
        self.type = room.type
        self.facultyIds = facultyIds
        self.teachers = set()
        self.groups = set()
        self.specialties = set()
        self.exclusiveGroups = set()
        self.subjects = set()


class Ctx:
    def __init__(self):
        self.events = []
        self.by_group = {}
        self.by_teacher = {}
        self.rooms = []
        self.infeasible = []
        self.semester = 1
        self.group_start_pairs = {}


def load_data(db: Session, semester: int = 1, group_start_pairs=None, group_end_pairs=None) -> Ctx:
    group_start_pairs = group_start_pairs or {}
    group_end_pairs = group_end_pairs or {}

    def start_pair_of(gid):
        v = group_start_pairs.get(gid) if gid is not None else None
        return v if isinstance(v, int) and 1 <= v <= PAIRS else 1

    def end_pair_of(gid, start):
        v = group_end_pairs.get(gid) if gid is not None else None
        return v if isinstance(v, int) and start <= v <= PAIRS else PAIRS

    workloads = db.scalars(select(Workload).where(Workload.semester == semester, Workload.archived == False)).all()  # noqa: E712
    rooms = db.scalars(select(Room)).all()
    teacher_constraints = db.scalars(select(TeacherConstraint)).all()

    room_meta = []
    for r in rooms:
        fac_ids = [f.id for f in r.building.faculties] if r.building else []
        meta = RoomMeta(r, fac_ids)
        for p in r.permissions:
            if p.teacherId is not None:
                meta.teachers.add(p.teacherId)
            if p.groupId is not None:
                meta.groups.add(p.groupId)
                if p.exclusive:
                    meta.exclusiveGroups.add(p.groupId)
            if p.specialtyId is not None:
                meta.specialties.add(p.specialtyId)
            if p.subjectId is not None:
                meta.subjects.add(p.subjectId)
        room_meta.append(meta)

    group_room_map, group_only_room_map, teacher_room_map, subject_room_map = {}, {}, {}, {}
    for r in room_meta:
        for gid in r.groups:
            group_room_map.setdefault(gid, set()).add(r.id)
        for gid in r.exclusiveGroups:
            group_only_room_map.setdefault(gid, set()).add(r.id)
        for tid in r.teachers:
            teacher_room_map.setdefault(tid, set()).add(r.id)
        for sid in r.subjects:
            subject_room_map.setdefault(sid, set()).add(r.id)

    tc_map = {}
    for tc in teacher_constraints:
        try:
            blocked = json.loads(tc.blockedDays) if tc.blockedDays else []
        except ValueError:
            blocked = []
        try:
            allowed = json.loads(tc.allowedPairs) if tc.allowedPairs else []
        except ValueError:
            allowed = []
        tc_map[tc.teacherId] = {"blockedDays": set(blocked), "allowedPairs": set(allowed)}

    def has_room_permission(room, ev):
        return (ev.teacherId in room.teachers
                or any(gid in room.groups for gid in ev.groupIds)
                or any(sid in room.specialties for sid in ev.specialtyIds)
                or ev.subjectId in room.subjects)

    def room_allowed(room, ev):
        if room.capacity < ev.groupSize:
            return False
        if room.capacity > LARGE_ROOM_CAPACITY:
            if len(room.facultyIds) == 0:
                # Asosiy binodagi katta zal — QAT'IY: fanga maxsus xona bo'lsa taqiqlanadi,
                # faqat MAIN_HALL_MIN..MAIN_HALL_MAX talabali potok
                if ev.subjectId in subject_room_map:
                    return False
                if ev.groupSize < MAIN_HALL_MIN or ev.groupSize > MAIN_HALL_MAX:
                    return False
            elif ev.groupSize <= LARGE_ROOM_CAPACITY and ev.type == TYPE_MAARUZA:
                return False
        if (len(room.facultyIds) > 0
                and not any(fid in ev.facultyIds for fid in room.facultyIds)
                and not has_room_permission(room, ev)):
            return False
        if room.type == "umumiy":
            return True
        return has_room_permission(room, ev)

    def apply_teacher_constraint(slots, teacher_id):
        tc = tc_map.get(teacher_id)
        if not tc or (len(tc["blockedDays"]) == 0 and len(tc["allowedPairs"]) == 0):
            return slots
        out = []
        for s in slots:
            if day_of(s) in tc["blockedDays"]:
                continue
            if tc["allowedPairs"] and pair_of(s) not in tc["allowedPairs"]:
                continue
            out.append(s)
        return out

    ctx = Ctx()
    ctx.semester = semester
    ctx.group_start_pairs = group_start_pairs
    events = []
    infeasible = []
    eid = 0

    for w in workloads:
        wgroups = [x.group for x in w.groups if x.group]
        group_ids = [x.groupId for x in w.groups]
        assigned = []
        for gid in group_ids:
            for rid in sorted(group_room_map.get(gid, set())):
                if rid not in assigned:
                    assigned.append(rid)
        for rid in sorted(teacher_room_map.get(w.teacherId, set())):
            if rid not in assigned:
                assigned.append(rid)
        for rid in sorted(subject_room_map.get(w.subjectId, set())):
            if rid not in assigned:
                assigned.append(rid)

        ex_sets = [group_only_room_map[gid] for gid in group_ids if gid in group_only_room_map]
        exclusive_rooms = None
        if ex_sets:
            exclusive_rooms = [rid for rid in sorted(ex_sets[0]) if all(rid in s for s in ex_sets)]

        first = wgroups[0] if wgroups else None
        first_id = first.id if first else None
        start = start_pair_of(first_id)
        end = end_pair_of(first_id, start)
        group_size = sum((g.size or 0) for g in wgroups)
        specialty_ids = list(dict.fromkeys(g.specialtyId for g in wgroups if g.specialtyId is not None))
        faculty_ids = list(dict.fromkeys(g.facultyId for g in wgroups if g.facultyId is not None))

        for _ in range(w.weeklyHours or 1):
            ev = Event(
                id=eid, workloadId=w.id, groupIds=group_ids, teacherId=w.teacherId, subjectId=w.subjectId,
                type=w.type or "Amaliy",
                groupNames=[g.name for g in wgroups],
                teacherName=w.teacher.fullName if w.teacher else None,
                subjectName=w.subject.name if w.subject else None,
                course=first.course if first and first.course is not None else 1,
                startPair=start, endPair=end, groupSize=group_size,
                specialtyIds=specialty_ids, facultyIds=faculty_ids,
                difficulty=w.subject.difficulty if w.subject and w.subject.difficulty is not None else 3,
                assignedRooms=assigned, slot=-1, room=-1,
            )
            eid += 1
            ev.slots = apply_teacher_constraint(allowed_slots(ev.startPair, ev.endPair), ev.teacherId)
            # "2 para" POTOK QOIDASI: potok + haftalik 2 soat → faqat Dush/Sesh/Chor, asosiy binodagi katta zal
            is_two_para = len(group_ids) > 1 and w.weeklyHours == 2
            if is_two_para:
                ev.slots = [s for s in ev.slots if day_of(s) <= 2]
            is_potok = len(group_ids) > 1
            candidates = [r for r in room_meta
                          if room_allowed(r, ev)
                          and (exclusive_rooms is None or r.id in exclusive_rooms)
                          and (not is_two_para or (len(r.facultyIds) == 0 and r.capacity > LARGE_ROOM_CAPACITY))]
            candidates.sort(key=lambda r: (0 if r.id in assigned else 1,
                                           -r.capacity if is_potok else r.capacity))
            ev.rooms = [r.id for r in candidates]
            ev.roomCapacities = {r.id: r.capacity for r in candidates}

            if not ev.slots:
                ev.reason = ("2 para potok qoidasi: Dushanba/Seshanba/Chorshanba kunlarida (yoki o'qituvchining istisnolari tufayli) bo'sh vaqt qolmadi"
                             if is_two_para else
                             "o'qituvchining istisnolari (bloklangan kunlar / faqat ayrim juftliklar) tufayli bo'sh vaqt qolmadi")
                infeasible.append(ev)
            elif not ev.rooms:
                fit_by_cap = [r for r in room_meta if r.capacity >= ev.groupSize]
                fit_by_faculty = [r for r in fit_by_cap
                                  if len(r.facultyIds) == 0 or any(f in ev.facultyIds for f in r.facultyIds)]
                if is_two_para:
                    ev.reason = "2 para potok qoidasi: faqat asosiy binodagi Katta zalga qo'yiladi (qat'iy), lekin mos/bo'sh Katta zal topilmadi"
                elif exclusive_rooms is not None:
                    names = [r.name for r in room_meta if r.id in exclusive_rooms]
                    if len(exclusive_rooms) == 0:
                        ev.reason = "potokdagi guruhlar har xil xonaga QAT'IY biriktirilgan — bitta darsga umumiy xona yo'q"
                    else:
                        ev.reason = f'guruh FAQAT "{", ".join(names)}" xonasiga biriktirilgan, lekin u sig\'maydi yoki band ({ev.groupSize} kishi)'
                elif not fit_by_cap:
                    max_cap = max((r.capacity for r in room_meta), default=0)
                    ev.reason = f"guruh {ev.groupSize} kishilik — sig'imi yetarli xona yo'q (eng katta xona {max_cap} o'rin)"
                elif not fit_by_faculty:
                    ev.reason = "fakultet binosida (yoki asosiy binoda) sig'imi mos xona yo'q — boshqa fakultet binosidan foydalanib bo'lmaydi"
                elif ev.subjectId in subject_room_map and all(r.capacity > LARGE_ROOM_CAPACITY and len(r.facultyIds) == 0 for r in fit_by_faculty):
                    ev.reason = "bu fanga maxsus xona biriktirilgan (masalan sport zali) — asosiy binodagi katta zaldan foydalanmaydi, lekin o'ziga tegishli xona yetarli emas yoki band"
                elif all(r.capacity > LARGE_ROOM_CAPACITY for r in fit_by_faculty):
                    ev.reason = (f"guruh {ev.groupSize} kishilik — mos sig'imli xonalarning barchasi katta zal: asosiy binoda faqat "
                                 f"{MAIN_HALL_MIN}-{MAIN_HALL_MAX} talabali potok (tur — Ma'ruza/Amaliy/Seminar — farqi yo'q), "
                                 f"fakultet binosida faqat Ma'ruzada {LARGE_ROOM_CAPACITY}+ talabaga ajratiladi")
                else:
                    ev.reason = "faqat maxsus xonalar mos keladi, lekin bu guruh/o'qituvchi/yo'nalish/fanga kirish ruxsati berilmagan"
                infeasible.append(ev)
            events.append(ev)

    by_group, by_teacher = {}, {}
    for ev in events:
        by_teacher.setdefault(ev.teacherId, []).append(ev)
        for gid in ev.groupIds:
            by_group.setdefault(gid, []).append(ev)

    ctx.events = events
    ctx.by_group = by_group
    ctx.by_teacher = by_teacher
    ctx.rooms = room_meta
    ctx.infeasible = infeasible
    return ctx
