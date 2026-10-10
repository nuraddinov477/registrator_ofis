"""Yumshoq cheklashlar (jarimalar) — server/src/engine/constraints.js ning aniq porti."""
from .timeslots import DAYS, day_of, pair_of

# Dars turi tartibi: ma'ruza → seminar → amaliy
TYPE_RANK = {"Maʼruza": 0, "Seminar": 1, "Amaliy": 2}

# Yumshoq cheklash vaznlari (sozlanadigan)
W = {
    "teacherGap": 20,
    "groupGap": 40,
    "groupGapOverCap": 150,
    "consecutive": 3,
    "subjectSpread": 100,
    "subjectConsecutiveDays": 18,
    "subjectAdjacent": 20,
    "subjectTypeOrder": 16,
    "groupDayMax": 15,
    "groupDayMin": 12,
    "assignedRoom": 22,
    "roomFit": 2,
    "morning": 1,
    "groupBalance": 1,
    "lonePair": 8,
    "teacherDay": 2,
    "roomChange": 1,
    "MAX_CONSEC": 4,
}


def gaps_in_day(pairs, day_start=1):
    if not pairs:
        return 0
    lo, hi = min(pairs), max(pairs)
    leading = max(0, lo - day_start)
    internal = (hi - lo + 1) - len(pairs)
    return leading + internal


def consecutive_penalty(pairs):
    if len(pairs) < 2:
        return 0
    srt = sorted(pairs)
    run, penalty = 1, 0
    for i in range(1, len(srt)):
        if srt[i] == srt[i - 1] + 1:
            run += 1
        else:
            if run > W["MAX_CONSEC"]:
                penalty += run - W["MAX_CONSEC"]
            run = 1
    if run > W["MAX_CONSEC"]:
        penalty += run - W["MAX_CONSEC"]
    return penalty


def group_cost(group_events) -> float:
    per_day = [[] for _ in range(DAYS)]
    rooms = set()
    subject_days = {}
    cost = 0.0
    # guruhning tanlangan boshlanish juftligi
    day_start = next((e.startPair for e in group_events if e.slot >= 0), 1)
    for e in group_events:
        if e.slot < 0:
            continue
        per_day[day_of(e.slot)].append(e)
        rooms.add(e.room)
        subject_days.setdefault(e.subjectId, set()).add(day_of(e.slot))

        if e.assignedRooms and e.room >= 0 and e.room not in e.assignedRooms:  # noqa: E501 (JS: length && ...)
            cost += W["assignedRoom"]
        cap = e.roomCapacities.get(e.room) if e.roomCapacities else None
        if cap is not None and cap - e.groupSize > 2 and len(e.groupIds) == 1:
            cost += (cap - e.groupSize - 2) * W["roomFit"]

    counts = []
    weekly_gap = 0
    for day in per_day:
        pairs = [pair_of(e.slot) for e in day]
        counts.append(len(day))
        weekly_gap += gaps_in_day(pairs, day_start)
        cost += consecutive_penalty(pairs) * W["consecutive"]
        if len(day) > 4:
            cost += (len(day) - 4) * W["groupDayMax"]
        elif len(day) == 1:
            cost += W["groupDayMin"]

        by_subject = {}
        for e in day:
            by_subject[e.subjectId] = by_subject.get(e.subjectId, 0) + 1
        for count in by_subject.values():
            if count > 1:
                cost += (count - 1) * W["subjectSpread"]

        day_sorted = sorted(day, key=lambda e: pair_of(e.slot))
        for i in range(1, len(day_sorted)):
            p1, p2 = pair_of(day_sorted[i - 1].slot), pair_of(day_sorted[i].slot)
            if p2 - p1 == 1 and day_sorted[i - 1].subjectId != day_sorted[i].subjectId:
                cost += W["subjectAdjacent"]

        for e in day:
            p = pair_of(e.slot)
            if e.difficulty >= 4 and p > 3:
                cost += (e.difficulty - 3) * (p - 3) * W["morning"]

    cost += weekly_gap * weekly_gap * W["groupGap"]
    if weekly_gap > 1:
        cost += (weekly_gap - 1) * W["groupGapOverCap"]
    cost += sum(c * c for c in counts) * W["groupBalance"] * 0.5
    if len(rooms) > 1:
        cost += (len(rooms) - 1) * W["roomChange"]

    for days in subject_days.values():
        srt = sorted(days)
        for i in range(1, len(srt)):
            if srt[i] - srt[i - 1] == 1:
                cost += W["subjectConsecutiveDays"]

    by_subject_typed = {}
    for e in group_events:
        if e.slot < 0:
            continue
        rank = TYPE_RANK.get(e.type)
        if rank is None:
            continue
        by_subject_typed.setdefault(e.subjectId, []).append((e.slot, rank))
    for evs in by_subject_typed.values():
        for i in range(len(evs)):
            for j in range(i + 1, len(evs)):
                a, b = evs[i], evs[j]
                if a[1] == b[1]:
                    continue
                earlier, later = (a, b) if a[0] < b[0] else (b, a)
                if earlier[1] > later[1]:
                    cost += W["subjectTypeOrder"]

    return cost


def teacher_cost(teacher_events) -> float:
    per_day = [[] for _ in range(DAYS)]
    for e in teacher_events:
        if e.slot < 0:
            continue
        per_day[day_of(e.slot)].append(e)
    cost = 0.0
    weekly_gap = 0
    for day in per_day:
        if not day:
            continue
        pairs = [pair_of(e.slot) for e in day]
        weekly_gap += gaps_in_day(pairs)
        cost += W["teacherDay"]
        if len(day) == 1:
            cost += W["lonePair"]
    cost += weekly_gap * weekly_gap * W["teacherGap"]
    return cost


def total_soft(ctx) -> float:
    soft = 0.0
    for evs in ctx.by_group.values():
        soft += group_cost(evs)
    for evs in ctx.by_teacher.values():
        soft += teacher_cost(evs)
    return soft
