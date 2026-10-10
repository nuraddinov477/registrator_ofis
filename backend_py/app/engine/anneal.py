"""Simulated annealing — server/src/engine/anneal.js porti (delta-baholash, qat'iy rejim, swap)."""
import math
import random
import time

from .constraints import group_eval, teacher_cost, total_soft
from .timeslots import PAIRS


def _busy_days(events, exclude_id):
    busy = {}
    for e in events:
        if e.id == exclude_id or e.slot < 0:
            continue
        busy.setdefault(e.slot // PAIRS, set()).add((e.slot % PAIRS) + 1)
    return busy


def _attractive_for(ev, busy):
    if not busy:
        return None
    bounds = {day: (min(pairs), max(pairs), pairs) for day, pairs in busy.items()}
    attractive = []
    for slot in ev.slots:
        bound = bounds.get(slot // PAIRS)
        if bound is None:
            continue
        lo, hi, pairs = bound
        p = (slot % PAIRS) + 1
        if (lo < p < hi and p not in pairs) or p == lo - 1 or p == hi + 1:
            attractive.append(slot)
    return attractive or None


def _attractive_slots(ev, ctx):
    for gid in ev.groupIds:
        found = _attractive_for(ev, _busy_days(ctx.by_group.get(gid, []), ev.id))
        if found:
            return found
    return _attractive_for(ev, _busy_days(ctx.by_teacher.get(ev.teacherId, []), ev.id))


def _same_list(a, b):
    return len(a) == len(b) and all(x == y for x, y in zip(a, b))


def _swap_partner(ev, by_group, rand):
    candidates = by_group.get(ev.uniqueGroupIds[0]) if ev.uniqueGroupIds else None
    if not candidates:
        return None
    for _ in range(3):
        other = candidates[int(rand() * len(candidates))]
        if (other is not ev and other.slot >= 0 and other.slot != ev.slot and other.rooms
                and _same_list(other.uniqueGroupIds, ev.uniqueGroupIds)
                and other.slots.count(ev.slot) and ev.slots.count(other.slot)):
            return other
    return None


def _key_less(a, b):
    if a[0] != b[0]:
        return a[0] < b[0]
    if a[1] != b[1]:
        return a[1] < b[1]
    return a[2] < b[2]


def anneal(ctx, occ, max_ms=5000, hard_weight=1000, max_iters=None, T0=2.0, Tmin=0.01,
           rand=None, strict=False):
    if rand is None:
        rand = random.random
    events = ctx.events
    n = len(events)
    if max_iters is None:
        max_iters = min(2_000_000, max(50_000, n * 3000))
    alpha = (Tmin / T0) ** (1 / max_iters)

    by_group, by_teacher = ctx.by_group, ctx.by_teacher
    group_start = ctx.group_start
    group_cache = {}
    for gid, evs in by_group.items():
        group_cache[gid] = group_eval(evs, group_start.get(gid))
    teacher_cache = {tid: teacher_cost(evs) for tid, evs in by_teacher.items()}
    current_soft = total_soft(ctx)
    gap_total = 0
    for _, gaps in group_cache.values():
        gap_total += gaps
    # to'qnashuv (occ.hard) ustuvorligi — oynadan ANCHA og'ir
    conflict_weight = hard_weight * 100

    best_slot = [e.slot for e in events]
    best_room = [e.room for e in events]
    best_key = [occ.hard, gap_total, current_soft]
    moved = []

    started = time.perf_counter()
    T = T0
    accepted = 0
    iters = 0
    gap_groups = []

    def first_free_room(ev, slot):
        for r in ev.rooms:
            if occ.room_free(r, slot):
                return r
        return None

    def eval_groups(gids):
        return [group_eval(by_group.get(gid), group_start.get(gid)) for gid in gids]

    def commit_best():
        nonlocal best_key, moved
        current_key = [occ.hard, gap_total, current_soft]
        if _key_less(current_key, best_key):
            best_key = current_key
            for eid in moved:
                best_slot[eid] = events[eid].slot
                best_room[eid] = events[eid].room
            moved = []

    def try_swap(a, b):
        nonlocal current_soft, gap_total, accepted
        groups = a.uniqueGroupIds
        teachers = list(dict.fromkeys([a.teacherId, b.teacherId]))
        old_groups = [group_cache[gid] for gid in groups]
        old_local = sum(c for c, _ in old_groups) + sum(teacher_cache[t] for t in teachers)
        old_gaps = sum(g for _, g in old_groups)
        slot_a, room_a, slot_b, room_b = a.slot, a.room, b.slot, b.room
        occ.remove(a)
        occ.remove(b)

        def restore():
            a.slot, a.room, b.slot, b.room = slot_a, room_a, slot_b, room_b
            occ.place(a)
            occ.place(b)

        if not (occ.teacher_free(a.teacherId, slot_b) and occ.teacher_free(b.teacherId, slot_a)
                and all(occ.group_free(g, slot_a) and occ.group_free(g, slot_b) for g in a.groupIds)):
            restore()
            return
        new_room_a = first_free_room(a, slot_b)
        if new_room_a is None:
            restore()
            return
        a.slot, a.room = slot_b, new_room_a
        occ.place(a)
        new_room_b = first_free_room(b, slot_a)
        if new_room_b is None:
            occ.remove(a)
            restore()
            return
        b.slot, b.room = slot_a, new_room_b
        occ.place(b)

        new_groups = eval_groups(groups)
        new_teachers = [(t, teacher_cost(by_teacher.get(t))) for t in teachers]
        new_gaps = sum(g for _, g in new_groups)
        delta_soft = (sum(c for c, _ in new_groups) + sum(c for _, c in new_teachers) - old_local)
        delta = (new_gaps - old_gaps) * hard_weight + delta_soft
        if delta <= 0 or rand() < math.exp(-delta / T):
            current_soft += delta_soft
            gap_total += new_gaps - old_gaps
            accepted += 1
            for gid, val in zip(groups, new_groups):
                group_cache[gid] = val
            for t, c in new_teachers:
                teacher_cache[t] = c
            moved.append(a.id)
            moved.append(b.id)
            commit_best()
        else:
            occ.remove(a)
            occ.remove(b)
            restore()

    while iters < max_iters:
        if (iters & 1023) == 0:
            if (time.perf_counter() - started) * 1000 > max_ms:
                break
            gap_groups = [by_group.get(gid) for gid, (_, gaps) in group_cache.items() if gaps > 0]

        if gap_groups and rand() < 0.5:
            group_events = gap_groups[int(rand() * len(gap_groups))]
            ev = group_events[int(rand() * len(group_events))]
        else:
            ev = events[int(rand() * n)]
        if not ev.rooms or not ev.slots or (strict and ev.slot < 0):
            iters += 1
            continue
        if strict and rand() < 0.35:
            partner = _swap_partner(ev, by_group, rand)
            if partner is not None:
                try_swap(ev, partner)
                T = max(Tmin, T * alpha)
                iters += 1
                continue

        group_ids = ev.uniqueGroupIds
        old_groups = [group_cache[gid] for gid in group_ids]
        old_local = sum(c for c, _ in old_groups) + teacher_cache[ev.teacherId]
        old_gaps = sum(g for _, g in old_groups)
        old_conflicts = occ.hard
        old_slot, old_room = ev.slot, ev.room

        occ.remove(ev)
        smart = _attractive_slots(ev, ctx) if rand() < 0.9 else None
        pool = smart or ev.slots
        ev.slot = pool[int(rand() * len(pool))]
        if strict:
            room = None
            if occ.teacher_free(ev.teacherId, ev.slot) and all(occ.group_free(g, ev.slot) for g in ev.groupIds):
                room = first_free_room(ev, ev.slot)
            if room is None:
                ev.slot, ev.room = old_slot, old_room
                occ.place(ev)
                T = max(Tmin, T * alpha)
                iters += 1
                continue
            ev.room = room
        else:
            ev.room = ev.rooms[int(rand() * len(ev.rooms))]
        occ.place(ev)

        new_groups = eval_groups(group_ids)
        new_teacher = teacher_cost(by_teacher.get(ev.teacherId))
        new_gaps = sum(g for _, g in new_groups)
        delta_soft = sum(c for c, _ in new_groups) + new_teacher - old_local
        delta = ((occ.hard - old_conflicts) * conflict_weight + (new_gaps - old_gaps) * hard_weight + delta_soft)

        if delta <= 0 or rand() < math.exp(-delta / T):
            current_soft += delta_soft
            gap_total += new_gaps - old_gaps
            accepted += 1
            for gid, val in zip(group_ids, new_groups):
                group_cache[gid] = val
            teacher_cache[ev.teacherId] = new_teacher
            moved.append(ev.id)
            commit_best()
        else:
            occ.remove(ev)
            ev.slot, ev.room = old_slot, old_room
            occ.place(ev)

        T = max(Tmin, T * alpha)
        iters += 1

    for e in events:
        e.slot = best_slot[e.id]
        e.room = best_room[e.id]
    return {
        "iterations": iters, "accepted": accepted,
        "bestHard": best_key[0] + best_key[1], "bestConflicts": best_key[0],
        "bestGaps": best_key[1], "bestSoft": best_key[2],
        "ms": round((time.perf_counter() - started) * 1000),
    }
