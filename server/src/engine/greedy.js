import { Occupancy } from './occupancy.js'

// Ochko'z (greedy) konstruksiya — DSATUR uslubi: eng "qiyin" eventlar birinchi.
// Maqsad: qattiq cheklovlarni buzmaydigan boshlang'ich jadval (keyin SA yaxshilaydi).
//
// Tartib: kam nomzod xonali + katta guruh + kam slotli eventlar oldinda joylanadi —
// chunki ularni keyin joylash qiyinroq.
export function greedyConstruct(ctx) {
  const occ = new Occupancy()
  const order = [...ctx.events].sort((a, b) => {
    if (a.rooms.length !== b.rooms.length) return a.rooms.length - b.rooms.length
    if (a.slots.length !== b.slots.length) return a.slots.length - b.slots.length
    return b.groupSize - a.groupSize
  })

  for (const ev of order) {
    if (ev.rooms.length === 0) continue // nomzod xona yo'q — joylab bo'lmaydi
    let best = null // { slot, room, conflicts }

    for (const slot of ev.slots) {
      // guruh va o'qituvchi shu slotda band bo'lsa — bu slot foydasiz, o'tkazib yuboramiz
      const baseBusy = (occ.groupFree(ev.groupId, slot) ? 0 : 1) + (occ.teacherFree(ev.teacherId, slot) ? 0 : 1)
      if (baseBusy === 0) {
        // bo'sh xona qidiramiz; topilsa — konfliktsiz joylashuv
        const room = ev.rooms.find((r) => occ.roomFree(r, slot))
        if (room != null) { best = { slot, room, conflicts: 0 }; break }
      }
      // konfliktsiz topilmasa — eng kam konfliktli variantni eslab qolamiz
      if (!best || best.conflicts > 0) {
        const room = ev.rooms[0]
        const conflicts = baseBusy + (occ.roomFree(room, slot) ? 0 : 1)
        if (!best || conflicts < best.conflicts) best = { slot, room, conflicts }
      }
    }

    ev.slot = best.slot
    ev.room = best.room
    occ.place(ev)
  }

  return occ
}
