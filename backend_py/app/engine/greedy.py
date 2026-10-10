"""Ochko'z konstruksiya (DSATUR uslubi) — server/src/engine/greedy.js porti. Deterministik."""
from .constraints import TYPE_RANK
from .occupancy import Occupancy
from .timeslots import PAIRS


def greedy_construct(ctx) -> Occupancy:
    occ = Occupancy()
    # JS: rooms.length, slots.length (kamayish), groupSize (kamayish) tartibida
    order = sorted(ctx.events, key=lambda e: (len(e.rooms), len(e.slots), -e.groupSize))

    used_days = {}   # (gid, subjectId) -> set(kun)
    type_slots = {}  # (gid, subjectId) -> [(rank, slot)]
    group_start = ctx.group_start
    day_pairs = {}   # (gid, kun) -> set(juftlik 1..6)

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
            for p_rank, p_slot in type_slots.get((gid, ev.subjectId), []):
                if (p_rank < rank and p_slot > slot) or (p_rank > rank and p_slot < slot):
                    return True
        return False

    def gap_change(ev, slot):
        day, pair = slot // PAIRS, slot % PAIRS + 1
        inner = 0
        lead = 0
        for gid in ev.uniqueGroupIds:
            pairs = day_pairs.get((gid, day))
            start = group_start.get(gid) if group_start.get(gid) is not None else 1
            if not pairs:
                lead += max(0, pair - start)
            elif pair not in pairs:
                lo, hi = min(pairs), max(pairs)
                if lo < pair < hi:
                    inner -= 1
                elif pair > hi:
                    inner += pair - hi - 1
                else:
                    inner += lo - pair - 1
                    lead += max(0, pair - start) - max(0, lo - start)
        return [inner, lead]

    def mark_used(ev):
        day = ev.slot // PAIRS
        rank = TYPE_RANK.get(ev.type)
        for gid in ev.groupIds:
            key = (gid, ev.subjectId)
            used_days.setdefault(key, set()).add(day)
            if rank is not None:
                type_slots.setdefault(key, []).append((rank, ev.slot))
            day_pairs.setdefault((gid, day), set()).add(ev.slot % PAIRS + 1)

    def key_less(a, b):
        for x, y in zip(a, b):
            if x != y:
                return x < y
        return False

    for ev in order:
        if not ev.rooms or not ev.slots:
            continue
        fallback = None  # (slot, room, conflicts)
        clean = None     # (key, slot, room)
        for slot in ev.slots:
            base_busy = 0
            for gid in ev.groupIds:
                if not occ.group_free(gid, slot):
                    base_busy += 1
            if not occ.teacher_free(ev.teacherId, slot):
                base_busy += 1
            if base_busy == 0:
                room = next((r for r in ev.rooms if occ.room_free(r, slot)), None)
                if room is not None:
                    inner, lead = gap_change(ev, slot)
                    key = [inner, day_severity(ev, slot // PAIRS), 1 if has_type_violation(ev, slot) else 0, lead]
                    if clean is None or key_less(key, clean[0]):
                        clean = (key, slot, room)
                        if key[0] <= 0 and key[1] == 0 and key[2] == 0 and key[3] <= 0:
                            break
            if fallback is None or fallback[2] > 0:
                room = ev.rooms[0]
                conflicts = base_busy + (0 if occ.room_free(room, slot) else 1)
                if fallback is None or conflicts < fallback[2]:
                    fallback = (slot, room, conflicts)

        if clean is not None:
            ev.slot, ev.room = clean[1], clean[2]
        else:
            ev.slot, ev.room = fallback[0], fallback[1]
        occ.place(ev)
        mark_used(ev)
    return occ
