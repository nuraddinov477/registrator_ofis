"""Tuzatish bosqichlari — server/src/engine/repair.js porti.

removeConflicts → reinsert → polishGaps. Yakunda to'qnashuv bo'lmasligini kafolatlaydi.
"""
import time

from .constraints import group_eval, group_gap_pairs, teacher_cost
from .occupancy import Occupancy
from .timeslots import PAIRS, SLOTS


def _room_key(room, slot):
    return room * SLOTS + slot


def _key_less(a, b):
    return a[0] < b[0] or (a[0] == b[0] and a[1] < b[1])


class Board:
    """Bandlik + (xona, slot) → dars va slot → darslar indeksi."""

    def __init__(self, ctx, occ):
        self.ctx = ctx
        self.occ = occ
        self.at_room = {}
        self.at_slot = {}
        for e in ctx.events:
            if e.slot >= 0:
                self._index(e)

    def _index(self, ev):
        self.at_room[_room_key(ev.room, ev.slot)] = ev
        self.at_slot.setdefault(ev.slot, {})[id(ev)] = ev

    def place(self, ev, slot, room):
        ev.slot = slot
        ev.room = room
        self.occ.place(ev)
        self._index(ev)

    def unplace(self, ev):
        self.occ.remove(ev)
        key = _room_key(ev.room, ev.slot)
        if self.at_room.get(key) is ev:
            del self.at_room[key]
        bucket = self.at_slot.get(ev.slot)
        if bucket is not None:
            bucket.pop(id(ev), None)
        ev.slot = -1
        ev.room = -1

    def room_occupant(self, room, slot):
        return self.at_room.get(_room_key(room, slot))

    def blockers_at(self, ev, slot):
        groups = set(ev.groupIds)
        found = []
        for e in list(self.at_slot.get(slot, {}).values()):
            if e is not ev and (e.teacherId == ev.teacherId or any(g in groups for g in e.groupIds)):
                found.append(e)
        return found

    def people_free(self, ev, slot):
        occ = self.occ
        return occ.teacher_free(ev.teacherId, slot) and all(occ.group_free(g, slot) for g in ev.groupIds)

    def free_room(self, ev, slot, skip=None):
        for r in ev.rooms:
            if r != skip and self.occ.room_free(r, slot):
                return r
        return None

    def local_key(self, ev):
        ctx = self.ctx
        gaps = 0
        cost = teacher_cost(ctx.by_teacher.get(ev.teacherId))
        for gid in ev.uniqueGroupIds:
            group_cost, group_gaps = group_eval(ctx.by_group.get(gid), ctx.group_start.get(gid))
            gaps += group_gaps
            cost += group_cost
        return [gaps, cost]

    def options(self, ev):
        found = []
        for slot in ev.slots:
            if not self.people_free(ev, slot):
                continue
            room = self.free_room(ev, slot)
            if room is None:
                continue
            ev.slot, ev.room = slot, room
            found.append([self.local_key(ev), slot, room])
            ev.slot, ev.room = -1, -1
        found.sort(key=lambda x: (x[0][0], x[0][1]))
        return found


def rebuild_occupancy(ctx):
    occ = Occupancy()
    for e in ctx.events:
        if e.slot >= 0 and e.room >= 0:
            occ.place(e)
    return occ


def remove_conflicts(ctx, occ):
    removed = 0
    while occ.hard > 0:
        worst, worst_count, worst_spread = None, -1, -1
        for e in ctx.events:
            if e.slot < 0:
                continue
            count = occ.conflicts_of(e)
            if count == 0:
                continue
            spread = len(e.slots) * len(e.rooms)
            if count > worst_count or (count == worst_count and spread > worst_spread):
                worst, worst_count, worst_spread = e, count, spread
        if worst is None:
            break
        occ.remove(worst)
        worst.slot = -1
        worst.room = -1
        removed += 1
    return removed


def _try_room_swap(board, ev, slot):
    for room in ev.rooms:
        other = board.room_occupant(room, slot)
        if other is None:
            continue
        alternative = board.free_room(other, slot, room)
        if alternative is None:
            continue
        board.unplace(other)
        board.place(other, slot, alternative)
        board.place(ev, slot, room)
        return True
    return False


def _try_eject(board, ev, slot):
    blockers = board.blockers_at(ev, slot)
    if len(blockers) != 1:
        return False
    blocker = blockers[0]
    old_slot, old_room = blocker.slot, blocker.room
    board.unplace(blocker)
    room = board.free_room(ev, slot) if board.people_free(ev, slot) else None
    if room is not None:
        board.place(ev, slot, room)
        moves = board.options(blocker)
        if moves:
            board.place(blocker, moves[0][1], moves[0][2])
            return True
        board.unplace(ev)
    board.place(blocker, old_slot, old_room)
    return False


def reinsert(ctx, occ, deadline=None):
    board = Board(ctx, occ)
    placed = 0
    for _ in range(2):
        pending = [e for e in ctx.events if e.slot < 0 and e.rooms and e.slots]
        pending.sort(key=lambda e: len(e.slots) * len(e.rooms))
        progress = 0
        for ev in pending:
            if deadline is not None and time.perf_counter() > deadline:
                return placed
            moves = board.options(ev)
            if moves:
                board.place(ev, moves[0][1], moves[0][2])
                progress += 1
                continue
            for slot in ev.slots:
                done = _try_room_swap(board, ev, slot) if board.people_free(ev, slot) else _try_eject(board, ev, slot)
                if done:
                    progress += 1
                    break
        placed += progress
        if not progress:
            break
    return placed


def _combined_key(ctx, events):
    groups, teachers = {}, {}
    for e in events:
        for gid in e.uniqueGroupIds:
            groups[gid] = None
        teachers[e.teacherId] = None
    gaps, cost = 0, 0
    for t in teachers:
        cost += teacher_cost(ctx.by_teacher.get(t))
    for gid in groups:
        group_cost, group_gaps = group_eval(ctx.by_group.get(gid), ctx.group_start.get(gid))
        gaps += group_gaps
        cost += group_cost
    return [gaps, cost]


def _move_to(board, ev, target):
    if target == ev.slot or target not in ev.slots:
        return False
    blockers = board.blockers_at(ev, target)
    if len(blockers) > 1:
        return False
    involved = [ev] + blockers
    origins = {id(e): (e, e.slot, e.room) for e in involved}
    before = _combined_key(board.ctx, involved)

    def revert():
        for e, _, _ in list(origins.values()):
            if e.slot >= 0:
                board.unplace(e)
        for e, slot, room in list(origins.values()):
            board.place(e, slot, room)
        return False

    board.unplace(ev)
    for blocker in blockers:
        board.unplace(blocker)
    if not board.people_free(ev, target):
        return revert()
    room = board.free_room(ev, target)
    if room is None:
        for candidate in ev.rooms:
            occupant = board.room_occupant(candidate, target)
            alternative = board.free_room(occupant, target, candidate) if occupant is not None else None
            if alternative is not None:
                extra = _combined_key(board.ctx, [occupant])
                before = [before[0] + extra[0], before[1] + extra[1]]
                origins[id(occupant)] = (occupant, occupant.slot, occupant.room)
                involved.append(occupant)
                board.unplace(occupant)
                board.place(occupant, target, alternative)
                room = candidate
                break
        if room is None:
            return revert()
    board.place(ev, target, room)
    for blocker in blockers:
        moves = board.options(blocker)
        if not moves:
            return revert()
        board.place(blocker, moves[0][1], moves[0][2])
    after = _combined_key(board.ctx, involved)
    if after[0] < before[0] or (after[0] == before[0] and after[1] < before[1] - 1e-9):
        return True
    return revert()


def polish_gaps(ctx, occ, deadline):
    board = Board(ctx, occ)
    improved = 0
    for events in ctx.by_group.values():
        changed = True
        while changed:
            changed = False
            if time.perf_counter() > deadline:
                return improved
            for day, pairs in group_gap_pairs(events).items():
                by_day = {}
                for e in events:
                    if e.slot < 0:
                        continue
                    by_day.setdefault(e.slot // PAIRS, []).append(e)
                edges = []
                for items in by_day.values():
                    lo = min(e.slot for e in items)
                    hi = max(e.slot for e in items)
                    for e in items:
                        if e.slot == lo or e.slot == hi:
                            edges.append(e)
                for pair in pairs:
                    target = day * PAIRS + pair - 1
                    if any(_move_to(board, e, target) for e in edges):
                        improved += 1
                        changed = True
                        break
                if changed:
                    break
    return improved
