"""Guruh / o'qituvchi / xona bandligi — server/src/engine/occupancy.js porti (O(1) delta)."""
from .timeslots import SLOTS


class Occupancy:
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

    def conflicts_of(self, ev):
        slot = ev.slot
        count = self.teacher[ev.teacherId][slot] - 1 + self.room[ev.room][slot] - 1
        for gid in ev.groupIds:
            count += self.group[gid][slot] - 1
        return count

    def group_free(self, gid, slot):
        arr = self.group.get(gid)
        return (arr[slot] if arr is not None else 0) == 0

    def teacher_free(self, tid, slot):
        arr = self.teacher.get(tid)
        return (arr[slot] if arr is not None else 0) == 0

    def room_free(self, rid, slot):
        arr = self.room.get(rid)
        return (arr[slot] if arr is not None else 0) == 0
