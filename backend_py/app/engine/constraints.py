"""Yumshoq cheklashlar va oynalar — server/src/engine/constraints.js ning aniq porti."""
from .timeslots import DAYS, PAIRS

# Dars turi tartibi: ma'ruza → seminar → amaliy
TYPE_RANK = {"Maʼruza": 0, "Seminar": 1, "Amaliy": 2}

WEIGHTS = {
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


def popcount(x: int) -> int:
    return bin(x).count("1")


def group_eval(group_events, day_start=None, W=WEIGHTS):
    """[yumshoq jarima, qattiq oynalar soni] — JS groupEval bilan bir xil."""
    per_day = [None] * DAYS
    rooms = set()
    subject_days = {}
    typed = None
    cost = 0
    guess_start = day_start is None
    if guess_start:
        day_start = 0
    for e in group_events:
        slot = e.slot
        if slot < 0:
            continue
        if guess_start and not day_start:
            day_start = e.startPair
        day, q = slot // PAIRS, slot % PAIRS
        item = [q, e.subjectId, e.difficulty]
        if per_day[day] is None:
            per_day[day] = [item]
        else:
            per_day[day].append(item)
        room = e.room
        rooms.add(room)
        subject_days[e.subjectId] = subject_days.get(e.subjectId, 0) | (1 << day)
        if e.assignedRooms and room >= 0 and room not in e.assignedSet:
            cost += W["assignedRoom"]
        if e.single:
            cap = e.roomCapacities.get(room)
            if cap is not None and cap - e.groupSize > 2:
                cost += (cap - e.groupSize - 2) * W["roomFit"]
        if e.rank is not None:
            if typed is None:
                typed = {}
            typed.setdefault(e.subjectId, []).append([slot, e.rank])

    max_consec = W["MAX_CONSEC"]
    weekly_gap = 0
    inner_gaps = 0
    squares = 0
    for items in per_day:
        if items is None:
            continue
        n = len(items)
        squares += n * n
        if n == 1:
            q, _, difficulty = items[0]
            if q + 1 > day_start:
                weekly_gap += q + 1 - day_start
            cost += W["groupDayMin"]
            if difficulty >= 4 and q > 2:
                cost += (difficulty - 3) * (q - 2) * W["morning"]
            continue
        items.sort(key=lambda a: a[0])
        lo, hi = items[0][0], items[n - 1][0]
        lead = lo + 1 - day_start
        distinct = 1
        for i in range(1, n):
            if items[i][0] != items[i - 1][0]:
                distinct += 1
        inner = hi - lo + 1 - distinct
        inner_gaps += inner
        weekly_gap += (lead if lead > 0 else 0) + inner
        prev_q, prev_subject, difficulty = items[0]
        morning = (difficulty - 3) * (prev_q - 2) if (difficulty >= 4 and prev_q > 2) else 0
        subjects = {prev_subject}
        run, penalty, adjacent = 1, 0, 0
        for i in range(1, n):
            q, subject, diff = items[i]
            if q == prev_q + 1:
                run += 1
                if subject != prev_subject:
                    adjacent += 1
            else:
                if run > max_consec:
                    penalty += run - max_consec
                run = 1
            if diff >= 4 and q > 2:
                morning += (diff - 3) * (q - 2)
            subjects.add(subject)
            prev_q = q
            prev_subject = subject
        if run > max_consec:
            penalty += run - max_consec
        cost += penalty * W["consecutive"] + adjacent * W["subjectAdjacent"] + morning * W["morning"]
        if n > 4:
            cost += (n - 4) * W["groupDayMax"]
        cost += (n - len(subjects)) * W["subjectSpread"]

    cost += weekly_gap * weekly_gap * W["groupGap"]
    if weekly_gap > 1:
        cost += (weekly_gap - 1) * W["groupGapOverCap"]
    cost += squares * W["groupBalance"] * 0.5
    if len(rooms) > 1:
        cost += (len(rooms) - 1) * W["roomChange"]

    for mask in subject_days.values():
        consecutive_days = mask & (mask >> 1)
        if consecutive_days:
            cost += popcount(consecutive_days) * W["subjectConsecutiveDays"]

    if typed is not None:
        for items in typed.values():
            for i in range(len(items)):
                a_slot, a_rank = items[i]
                for j in range(i + 1, len(items)):
                    b_slot, b_rank = items[j]
                    if a_rank == b_rank:
                        continue
                    earlier = a_rank if a_slot < b_slot else b_rank
                    later = b_rank if a_slot < b_slot else a_rank
                    if earlier > later:
                        cost += W["subjectTypeOrder"]
    return [cost, inner_gaps]


def group_cost(group_events, W=WEIGHTS, day_start=None):
    return group_eval(group_events, day_start, W)[0]


def group_gap_pairs(group_events):
    """kun → darslar orasidagi bo'sh juftliklar (1..6), kunlar o'sish tartibida."""
    per_day = {}
    for e in group_events:
        if e.slot < 0:
            continue
        day = e.slot // PAIRS
        per_day.setdefault(day, set()).add((e.slot % PAIRS) + 1)
    gaps = {}
    for day in sorted(per_day):
        pairs = per_day[day]
        lo, hi = min(pairs), max(pairs)
        empty = [p for p in range(lo + 1, hi) if p not in pairs]
        if empty:
            gaps[day] = empty
    return gaps


def teacher_cost(teacher_events, W=WEIGHTS) -> float:
    masks = [0] * DAYS
    for e in teacher_events:
        if e.slot >= 0:
            masks[e.slot // PAIRS] |= 1 << (e.slot % PAIRS)
    cost = 0
    weekly_gap = 0
    for mask in masks:
        if not mask:
            continue
        n = popcount(mask)
        lo = (mask & -mask).bit_length() - 1
        hi = mask.bit_length() - 1
        weekly_gap += lo + (hi - lo + 1 - n)
        cost += W["teacherDay"]
        if n == 1:
            cost += W["lonePair"]
    return cost + weekly_gap * weekly_gap * W["teacherGap"]


def total_soft(ctx) -> float:
    soft = 0
    for gid, events in ctx.by_group.items():
        soft += group_eval(events, ctx.group_start.get(gid))[0]
    for events in ctx.by_teacher.values():
        soft += teacher_cost(events)
    return soft


def total_gaps(ctx) -> int:
    gaps = 0
    for gid, events in ctx.by_group.items():
        gaps += group_eval(events, ctx.group_start.get(gid))[1]
    return gaps
