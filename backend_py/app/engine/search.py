"""Occupancy + greedy (DSATUR uslubi) + simulated annealing — occupancy.js, greedy.js, anneal.js porti."""
import math
import random
import time

from .constraints import TYPE_RANK, group_cost, teacher_cost, total_soft
from .timeslots import SLOTS, day_of, pair_of


class Occupancy:
    """Guruh / o'qituvchi / xona bandligi; qattiq konfliktlar (hard) O(1) inkremental yangilanadi."""

    def __init__(self):
        self.group = {}
        self.teacher = {}
        self.room = {}
        self.hard = 0

    @staticmethod
    def _cells(mp, key):
        arr = mp.get(key)
        if arr is None:
            arr = [0] * SLOTS
            mp[key] = arr
        return arr

    def _inc(self, mp, key, slot):
        cells = self._cells(mp, key)
        if cells[slot] >= 1:
            self.hard += 1
        cells[slot] += 1

    def _dec(self, mp, key, slot):
        cells = self._cells(mp, key)
        cells[slot] -= 1
        if cells[slot] >= 1:
            self.hard -= 1

    def place(self, ev):
        for gid in ev.groupIds:
            self._inc(self.group, gid, ev.slot)
        self._inc(self.teacher, ev.teacherId, ev.slot)
        self._inc(self.room, ev.room, ev.slot)

    def remove(self, ev):
        for gid in ev.groupIds:
            self._dec(self.group, gid, ev.slot)
        self._dec(self.teacher, ev.teacherId, ev.slot)
        self._dec(self.room, ev.room, ev.slot)

    def group_free(self, gid, slot):
        arr = self.group.get(gid)
        return (arr[slot] if arr else 0) == 0

    def teacher_free(self, tid, slot):
        arr = self.teacher.get(tid)
        return (arr[slot] if arr else 0) == 0

    def room_free(self, rid, slot):
        arr = self.room.get(rid)
        return (arr[slot] if arr else 0) == 0


def greedy_construct(ctx) -> Occupancy:
    occ = Occupancy()
    order = sorted(ctx.events, key=lambda e: (len(e.rooms), len(e.slots), -e.groupSize))

    used_days = {}   # (gid, subjectId) -> set(day)
    type_slots = {}  # (gid, subjectId) -> [(rank, slot)]

    def day_severity(ev, day):
        worst = 0
        for gid in ev.groupIds:
            days = used_days.get((gid, ev.subjectId))
            if not days:
                continue
            for d in days:
                if d == day:
                    worst = 2
                elif worst < 1 and abs(d - day) == 1:
                    worst = 1
        return worst

    def has_type_violation(ev, slot):
        rank = TYPE_RANK.get(ev.type)
        if rank is None:
            return False
        for gid in ev.groupIds:
            placed = type_slots.get((gid, ev.subjectId))
            if not placed:
                continue
            for (p_rank, p_slot) in placed:
                if (p_rank < rank and p_slot > slot) or (p_rank > rank and p_slot < slot):
                    return True
        return False

    def mark_used(ev):
        day = day_of(ev.slot)
        rank = TYPE_RANK.get(ev.type)
        for gid in ev.groupIds:
            key = (gid, ev.subjectId)
            used_days.setdefault(key, set()).add(day)
            if rank is not None:
                type_slots.setdefault(key, []).append((rank, ev.slot))

    for ev in order:
        if not ev.rooms or not ev.slots:
            continue
        fallback = None
        clean = None
        clean_sev = math.inf
        clean_type_viol = True

        for slot in ev.slots:
            base_busy = sum(0 if occ.group_free(gid, slot) else 1 for gid in ev.groupIds) \
                + (0 if occ.teacher_free(ev.teacherId, slot) else 1)
            if base_busy == 0:
                room = next((r for r in ev.rooms if occ.room_free(r, slot)), None)
                if room is not None:
                    sev = day_severity(ev, day_of(slot))
                    type_viol = has_type_violation(ev, slot)
                    if sev == 0 and not type_viol:
                        clean = (slot, room)
                        break
                    if sev < clean_sev or (sev == clean_sev and clean_type_viol and not type_viol):
                        clean_sev = sev
                        clean_type_viol = type_viol
                        clean = (slot, room)
            if fallback is None or fallback[2] > 0:
                room = ev.rooms[0]
                conflicts = base_busy + (0 if occ.room_free(room, slot) else 1)
                if fallback is None or conflicts < fallback[2]:
                    fallback = (slot, room, conflicts)

        chosen = clean if clean is not None else (fallback[0], fallback[1])
        ev.slot, ev.room = chosen
        occ.place(ev)
        mark_used(ev)
    return occ


def _attractive_for(ev, busy_by_day):
    if not busy_by_day:
        return None
    attractive = []
    for slot in ev.slots:
        d, p = day_of(slot), pair_of(slot)
        pairs = busy_by_day.get(d)
        if not pairs:
            continue
        lo, hi = min(pairs), max(pairs)
        if (lo < p < hi and p not in pairs) or p == lo - 1 or p == hi + 1:
            attractive.append(slot)
    return attractive or None


def _busy_days_of(events, exclude_id):
    m = {}
    for e in events:
        if e.id == exclude_id or e.slot < 0:
            continue
        m.setdefault(day_of(e.slot), set()).add(pair_of(e.slot))
    return m


def _attractive_slots(ev, ctx):
    for gid in ev.groupIds:
        found = _attractive_for(ev, _busy_days_of(ctx.by_group.get(gid, []), ev.id))
        if found:
            return found
    return _attractive_for(ev, _busy_days_of(ctx.by_teacher.get(ev.teacherId, []), ev.id))


def anneal(ctx, occ, max_ms=5000, hard_weight=1000, T0=2.0, Tmin=0.01, max_iters=None):
    n = len(ctx.events)
    if max_iters is None:
        max_iters = min(2_000_000, max(50_000, n * 3000))
    alpha = (Tmin / T0) ** (1 / max_iters)

    current_soft = total_soft(ctx)
    best_slot = [e.slot for e in ctx.events]
    best_room = [e.room for e in ctx.events]

    def snapshot():
        for e in ctx.events:
            best_slot[e.id] = e.slot
            best_room[e.id] = e.room

    def restore():
        for e in ctx.events:
            e.slot = best_slot[e.id]
            e.room = best_room[e.id]

    best_hard, best_soft = occ.hard, current_soft
    snapshot()

    t0 = time.time()
    T = T0
    it = 0
    accepted = 0
    while it < max_iters:
        if (it & 1023) == 0 and (time.time() - t0) * 1000 > max_ms:
            break
        ev = ctx.events[random.randrange(n)] if n else None
        if ev is None or not ev.rooms or not ev.slots:
            it += 1
            continue

        group_lists = [ctx.by_group.get(gid, []) for gid in ev.groupIds]
        t_events = ctx.by_teacher.get(ev.teacherId, [])
        old_local = sum(group_cost(g) for g in group_lists) + teacher_cost(t_events)
        old_hard = occ.hard
        old_slot, old_room = ev.slot, ev.room

        occ.remove(ev)
        smart = _attractive_slots(ev, ctx) if random.random() < 0.9 else None
        pool = smart or ev.slots
        ev.slot = pool[random.randrange(len(pool))]
        ev.room = ev.rooms[random.randrange(len(ev.rooms))]
        occ.place(ev)

        new_local = sum(group_cost(g) for g in group_lists) + teacher_cost(t_events)
        delta_soft = new_local - old_local
        delta = (occ.hard - old_hard) * hard_weight + delta_soft

        if delta <= 0 or random.random() < math.exp(-delta / T):
            current_soft += delta_soft
            accepted += 1
            if occ.hard < best_hard or (occ.hard == best_hard and current_soft < best_soft):
                best_hard, best_soft = occ.hard, current_soft
                snapshot()
        else:
            occ.remove(ev)
            ev.slot, ev.room = old_slot, old_room
            occ.place(ev)

        T *= alpha
        if T < Tmin:
            T = Tmin
        it += 1

    restore()
    return {"iterations": it, "accepted": accepted, "bestHard": best_hard,
            "bestSoft": best_soft, "ms": int((time.time() - t0) * 1000)}
