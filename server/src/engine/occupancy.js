import { SLOTS } from './timeslots.js'

// Guruh / o'qituvchi / xona bandligini kuzatadi va qattiq konfliktlar sonini
// O(1) inkremental (delta) yangilab boradi — masshtablanish uchun kalit.
//
// Bir slotdagi cell qiymati = shu resursga qo'yilgan darslar soni.
// "Ortiqcha" (excess) = max(0, count-1) — aynan shu konflikt soni.
export class Occupancy {
  constructor() {
    this.group = new Map() // id -> Uint16Array(SLOTS)
    this.teacher = new Map()
    this.room = new Map()
    this.hard = 0 // jami qattiq konfliktlar (excess yig'indisi)
  }

  _cells(map, id) {
    let arr = map.get(id)
    if (!arr) { arr = new Uint16Array(SLOTS); map.set(id, arr) }
    return arr
  }

  // cellni +1 — yangi excess qo'shilsa hard oshadi
  _inc(map, id, slot) {
    const cells = this._cells(map, id)
    if (cells[slot] >= 1) this.hard++ // 0->1 konflikt bermaydi, >=1 -> qo'shiladi
    cells[slot]++
  }

  // cellni -1 — excess kamaysa hard kamayadi
  _dec(map, id, slot) {
    const cells = this._cells(map, id)
    cells[slot]--
    if (cells[slot] >= 1) this.hard-- // >=2 dan kelganda excess yo'qoladi
  }

  place(ev) {
    this._inc(this.group, ev.groupId, ev.slot)
    this._inc(this.teacher, ev.teacherId, ev.slot)
    this._inc(this.room, ev.room, ev.slot)
  }

  remove(ev) {
    this._dec(this.group, ev.groupId, ev.slot)
    this._dec(this.teacher, ev.teacherId, ev.slot)
    this._dec(this.room, ev.room, ev.slot)
  }

  // Berilgan slot resurs uchun bo'shmi? (event qo'yilmagan deb hisoblab)
  groupFree(groupId, slot) { return (this.group.get(groupId)?.[slot] ?? 0) === 0 }
  teacherFree(teacherId, slot) { return (this.teacher.get(teacherId)?.[slot] ?? 0) === 0 }
  roomFree(roomId, slot) { return (this.room.get(roomId)?.[slot] ?? 0) === 0 }

  // (slot, room) ga qo'yilsa nechta yangi konflikt qo'shiladi (event hozir joyda EMAS)
  conflictsIfPlaced(ev, slot, room) {
    return (this.groupFree(ev.groupId, slot) ? 0 : 1)
      + (this.teacherFree(ev.teacherId, slot) ? 0 : 1)
      + (this.roomFree(room, slot) ? 0 : 1)
  }
}
