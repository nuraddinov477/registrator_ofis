"""To'liq gibrid yechim va tashxis — server/src/engine/solve.js porti.

greedy → anneal → removeConflicts/reinsert → qat'iy anneal davralari → polishGaps → verify.
"""
import math
import time

from .constraints import group_gap_pairs, total_soft
from .greedy import greedy_construct
from .anneal import anneal
from .repair import polish_gaps, rebuild_occupancy, reinsert, remove_conflicts
from .timeslots import DAY_NAMES, PAIR_TIMES, allowed_slots, day_of, pair_of

MIN_WEEKLY_LESSONS = 14
MAX_WEEKLY_LESSONS = 15


def _now_ms():
    return time.perf_counter() * 1000


def _js_round(x: float) -> int:
    return int(math.floor(x + 0.5))


def build_diagnostics(ctx) -> dict:
    g_name, g_course = {}, {}
    for ev in ctx.events:
        for k, gid in enumerate(ev.groupIds):
            if gid not in g_name:
                g_name[gid] = ev.groupNames[k] if k < len(ev.groupNames) and ev.groupNames[k] else f"#{gid}"
            if gid not in g_course:
                g_course[gid] = ev.course if ev.course is not None else 1
    g_start, g_end = ctx.group_start, ctx.group_end

    group_overload = []
    for gid, evs in ctx.by_group.items():
        start = g_start.get(gid) if g_start.get(gid) is not None else 1
        end = g_end.get(gid) if g_end.get(gid) is not None else 6
        capacity = len(allowed_slots(start, end))
        if len(evs) > capacity:
            group_overload.append({
                "groupId": gid, "group": g_name.get(gid), "course": g_course.get(gid, 1),
                "needed": len(evs), "capacity": capacity,
                "shift": f"{start}-{end}-juftlik oralig'i ({PAIR_TIMES[start - 1]} – {PAIR_TIMES[end - 1]})",
            })

    load_warnings = []
    for gid, evs in ctx.by_group.items():
        needed = len(evs)
        if needed > MAX_WEEKLY_LESSONS or needed < MIN_WEEKLY_LESSONS:
            load_warnings.append({
                "groupId": gid, "group": g_name.get(gid) if g_name.get(gid) is not None else f"#{gid}",
                "course": g_course.get(gid, 1), "needed": needed,
                "kind": "kop" if needed > MAX_WEEKLY_LESSONS else "kam",
            })

    teacher_overload = []
    for evs in ctx.by_teacher.values():
        available = set()
        for e in evs:
            available.update(e.slots)
        if len(evs) > len(available):
            teacher_overload.append({
                "teacherId": evs[0].teacherId, "teacher": evs[0].teacherName or f"#{evs[0].teacherId}",
                "needed": len(evs), "capacity": len(available),
            })

    seen = {}
    for e in ctx.infeasible:
        key = f"{e.workloadId}|{e.part}|{e.reason}"
        if key not in seen:
            seen[key] = {
                "group": ", ".join(e.groupNames), "subject": e.subjectName, "teacher": e.teacherName,
                "reason": e.reason, "count": 0, "workloadId": e.workloadId, "groupIds": e.uniqueGroupIds,
                "teacherId": e.teacherId, "subjectId": e.subjectId, "size": e.groupSize, "kind": e.blockKind,
                "suggestions": e.suggestions, "part": e.part,
            }
        seen[key]["count"] += 1
    blocked = list(seen.values())

    unresolved, gaps = [], []
    if any(e.slot >= 0 for e in ctx.events):
        for gid, evs in ctx.by_group.items():
            for day, pairs in group_gap_pairs(evs).items():
                gaps.append({"groupId": gid, "group": g_name.get(gid), "day": day,
                             "dayName": DAY_NAMES[day], "pairs": pairs})
        infeasible_ids = {id(e) for e in ctx.infeasible}
        pending = {}
        for e in ctx.events:
            if (e.slot >= 0 and e.room >= 0) or id(e) in infeasible_ids:
                continue
            key = f"{e.workloadId}|{e.part}"
            if key not in pending:
                pending[key] = {"group": ", ".join(e.groupNames), "subject": e.subjectName,
                                "teacher": e.teacherName, "count": 0, "workloadId": e.workloadId,
                                "groupIds": e.uniqueGroupIds, "teacherId": e.teacherId, "part": e.part}
            pending[key]["count"] += 1
        unresolved = list(pending.values())

    return {"groupOverload": group_overload, "teacherOverload": teacher_overload, "blocked": blocked,
            "unresolved": unresolved, "loadWarnings": load_warnings, "gaps": gaps}


def verify(ctx) -> dict:
    gm, tm, rm = {}, {}, {}
    unplaced = 0
    for e in ctx.events:
        if e.slot < 0 or e.room < 0:
            unplaced += 1
            continue
        for gid in e.groupIds:
            gm[(gid, e.slot)] = gm.get((gid, e.slot), 0) + 1
        tm[(e.teacherId, e.slot)] = tm.get((e.teacherId, e.slot), 0) + 1
        rm[(e.room, e.slot)] = rm.get((e.room, e.slot), 0) + 1

    def excess(m):
        return sum(v - 1 for v in m.values() if v > 1)

    gap_count = 0
    for evs in ctx.by_group.values():
        for pairs in group_gap_pairs(evs).values():
            gap_count += len(pairs)
    breakdown = {"group": excess(gm), "teacher": excess(tm), "room": excess(rm), "gap": gap_count}
    hard = breakdown["group"] + breakdown["teacher"] + breakdown["room"] + breakdown["gap"]
    return {
        "hard": hard,
        "breakdown": breakdown,
        "soft": _js_round(total_soft(ctx)),
        "feasible": hard == 0 and unplaced == 0,
        "unplaced": unplaced,
        "infeasibleEvents": [{"group": ", ".join(e.groupNames), "subject": e.subjectName,
                              "reason": e.reason or "mos xona yo'q"} for e in ctx.infeasible],
    }


def solve_context(ctx, max_ms=5000, rand=None):
    if not ctx.events:
        return {
            "ctx": ctx, "semester": ctx.semester, "empty": True,
            "report": {"hard": 0, "soft": 0, "feasible": True, "unplaced": 0,
                       "breakdown": {"group": 0, "teacher": 0, "room": 0, "gap": 0}, "infeasibleEvents": []},
            "diagnostics": {"groupOverload": [], "teacherOverload": [], "blocked": [], "unresolved": [],
                            "loadWarnings": [], "gaps": []},
            "entries": [],
        }

    started = _now_ms()

    def left_until(share):
        return max(0, math.floor(started + max_ms * share - _now_ms()))

    greedy_construct(ctx)
    greedy = {"hard": verify(ctx)["hard"], "soft": _js_round(total_soft(ctx))}

    first = anneal(ctx, rebuild_occupancy(ctx), max_ms=left_until(0.5), rand=rand)
    occ = rebuild_occupancy(ctx)
    removed = remove_conflicts(ctx, occ)
    placed = reinsert(ctx, occ, started + max_ms * 0.6)
    rounds = []
    for share in (0.7, 0.8, 0.9):
        rounds.append(anneal(ctx, occ, max_ms=left_until(share), rand=rand, strict=True))
        occ = rebuild_occupancy(ctx)
        placed += reinsert(ctx, occ, _now_ms() + max(300, max_ms * 0.03))
    polished = polish_gaps(ctx, occ, max(started + max_ms * 0.99, _now_ms() + 300))
    removed += remove_conflicts(ctx, occ)
    anneal_stats = dict(first, strict=rounds, removed=removed, reinserted=placed, polished=polished)
    report = verify(ctx)
    diagnostics = build_diagnostics(ctx)

    entries = []
    for e in ctx.events:
        if e.slot < 0 or e.room < 0:
            continue
        for gid in e.groupIds:
            entries.append({"groupId": gid, "teacherId": e.teacherId, "subjectId": e.subjectId,
                            "roomId": e.room, "day": day_of(e.slot), "pair": pair_of(e.slot), "type": e.type})
    return {"ctx": ctx, "semester": ctx.semester, "report": report, "diagnostics": diagnostics,
            "greedy": greedy, "anneal": anneal_stats, "entries": entries, "events": len(ctx.events)}
