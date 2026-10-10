"""Gibrid yechim: yuklash → greedy → annealing → tekshirish; diagnostika — solve.js porti."""
import math

from sqlalchemy.orm import Session

from .constraints import total_soft
from .loaddata import MAIN_HALL_MAX, MAIN_HALL_MIN, load_data  # noqa: F401
from .search import Occupancy, anneal, greedy_construct
from .timeslots import DAY_NAMES, PAIR_TIMES, allowed_slots, day_of, pair_of


def _js_round(x: float) -> int:
    # JavaScript Math.round: .5 ni yuqoriga (manfiy emas deb hisoblaymiz)
    return int(math.floor(x + 0.5))


def build_diagnostics(ctx) -> dict:
    g_name, g_course, g_start, g_end = {}, {}, {}, {}
    for ev in ctx.events:
        for k, gid in enumerate(ev.groupIds):
            if gid not in g_name:
                g_name[gid] = ev.groupNames[k] if k < len(ev.groupNames) and ev.groupNames[k] else f"#{gid}"
                g_course[gid] = ev.course if ev.course is not None else 1
                g_start[gid] = ev.startPair if ev.startPair is not None else 1
                g_end[gid] = ev.endPair if ev.endPair is not None else 6

    # 1) Guruh yuklamasi haftalik bo'sh joydan oshgan
    group_overload = []
    for gid, evs in ctx.by_group.items():
        course = g_course.get(gid, 1)
        sp = g_start.get(gid, 1)
        ep = g_end.get(gid, 6)
        capacity = len(allowed_slots(sp, ep))
        needed = len(evs)
        if needed > capacity:
            group_overload.append({
                "group": g_name.get(gid), "course": course, "needed": needed, "capacity": capacity,
                "shift": f"{sp}-{ep}-juftlik oralig'i ({PAIR_TIMES[sp - 1]} – {PAIR_TIMES[ep - 1]})",
            })

    # 1.5) Guruh haftalik dars soni sog'lom me'yordan tashqarida (ogohlantirish)
    MIN_W, MAX_W = 14, 15
    load_warnings = []
    for gid, evs in ctx.by_group.items():
        needed = len(evs)
        if needed > MAX_W or needed < MIN_W:
            load_warnings.append({
                "group": g_name.get(gid, f"#{gid}"), "course": g_course.get(gid, 1), "needed": needed,
                "kind": "kop" if needed > MAX_W else "kam",
            })

    # 2) O'qituvchi yuklamasi mavjud bo'sh vaqtdan oshgan
    teacher_overload = []
    for evs in ctx.by_teacher.values():
        avail = set()
        for e in evs:
            avail.update(e.slots)
        if len(evs) > len(avail):
            teacher_overload.append({
                "teacher": evs[0].teacherName or f"#{evs[0].teacherId}",
                "needed": len(evs), "capacity": len(avail),
            })

    # 3) Xonasiz / vaqtsiz qolgan darslar — yuklama bo'yicha guruhlab
    seen = {}
    for e in ctx.infeasible:
        key = (e.workloadId, e.reason)
        if key not in seen:
            seen[key] = {"group": ", ".join(e.groupNames), "subject": e.subjectName,
                         "teacher": e.teacherName, "reason": e.reason, "count": 0}
        seen[key]["count"] += 1
    blocked = list(seen.values())

    # 4) Nomzodi bor, lekin solver joylay olmagan
    unresolved = []
    if any(e.slot >= 0 for e in ctx.events):
        un = {}
        infeasible_ids = {id(e) for e in ctx.infeasible}
        for e in ctx.events:
            if e.slot >= 0 and e.room >= 0:
                continue
            if id(e) in infeasible_ids:
                continue
            if e.workloadId not in un:
                un[e.workloadId] = {"group": ", ".join(e.groupNames), "subject": e.subjectName,
                                    "teacher": e.teacherName, "count": 0}
            un[e.workloadId]["count"] += 1
        unresolved = list(un.values())

    return {"groupOverload": group_overload, "teacherOverload": teacher_overload,
            "blocked": blocked, "unresolved": unresolved, "loadWarnings": load_warnings}


def verify(ctx) -> dict:
    gm, tm, rm = {}, {}, {}
    unplaced = 0

    def bump(m, k):
        m[k] = m.get(k, 0) + 1

    for e in ctx.events:
        if e.slot < 0 or e.room < 0:
            unplaced += 1
            continue
        for gid in e.groupIds:
            bump(gm, (gid, e.slot))
        bump(tm, (e.teacherId, e.slot))
        bump(rm, (e.room, e.slot))

    def excess(m):
        return sum(v - 1 for v in m.values() if v > 1)

    breakdown = {"group": excess(gm), "teacher": excess(tm), "room": excess(rm)}
    hard = breakdown["group"] + breakdown["teacher"] + breakdown["room"]
    return {
        "hard": hard,
        "breakdown": breakdown,
        "soft": _js_round(total_soft(ctx)),
        "feasible": hard == 0 and unplaced == 0,
        "unplaced": unplaced,
        "infeasibleEvents": [
            {"group": ", ".join(e.groupNames), "subject": e.subjectName,
             "reason": e.reason or "mos xona yo'q"} for e in ctx.infeasible
        ],
    }


def solve(db: Session, semester: int = 1, max_ms: int = 5000,
          group_start_pairs=None, group_end_pairs=None) -> dict:
    ctx = load_data(db, semester, group_start_pairs, group_end_pairs)

    if not ctx.events:
        return {
            "ctx": ctx, "semester": semester, "empty": True,
            "report": {"hard": 0, "soft": 0, "feasible": True, "unplaced": 0,
                       "breakdown": {"group": 0, "teacher": 0, "room": 0}, "infeasibleEvents": []},
            "diagnostics": {"groupOverload": [], "teacherOverload": [], "blocked": [], "unresolved": []},
            "entries": [], "events": 0,
        }

    greedy_construct(ctx)
    greedy = {"hard": verify(ctx)["hard"], "soft": _js_round(total_soft(ctx))}

    occ = Occupancy()
    for e in ctx.events:
        if e.slot >= 0 and e.room >= 0:
            occ.place(e)

    anneal_stats = anneal(ctx, occ, max_ms=max_ms)
    report = verify(ctx)
    diagnostics = build_diagnostics(ctx)

    # Potok: bir event bir nechta guruhga tegishli bo'lsa, HAR guruh uchun alohida qator
    entries = []
    for e in ctx.events:
        if e.slot < 0 or e.room < 0:
            continue
        for gid in e.groupIds:
            entries.append({
                "groupId": gid, "teacherId": e.teacherId, "subjectId": e.subjectId,
                "roomId": e.room, "day": day_of(e.slot), "pair": pair_of(e.slot), "type": e.type,
            })

    return {"ctx": ctx, "semester": semester, "report": report, "diagnostics": diagnostics,
            "greedy": greedy, "anneal": anneal_stats, "entries": entries, "events": len(ctx.events)}
