import { Occupancy } from './occupancy.js'
import { dayOf } from './timeslots.js'
import { TYPE_RANK } from './constraints.js'

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

  // Bir xil fan/guruh eventlari greedy tartibida ko'pincha ketma-ket keladi (bir xil
  // xona/slot soniga ega) — hech narsa aralashmasa, hammasi birinchi bo'sh kunga
  // "uyumlashib" qolishga moyil. Shuni oldini olish uchun har guruh+fan uchun allaqachon
  // band qilingan kunlarni kuzatib boramiz va SHU kun (yoki qo'shni kun)ni, boshqa
  // teng darajadagi (qattiq konfliktsiz) variant bo'lsa, afzal ko'rmaymiz.
  const usedDays = new Map() // "groupId|subjectId" -> Set(day)
  const isBadDay = (gid, subjectId, day) => {
    const days = usedDays.get(`${gid}|${subjectId}`)
    if (!days) return false
    for (const d of days) if (d === day || Math.abs(d - day) === 1) return true
    return false
  }
  const hasBadDay = (ev, slot) => ev.groupIds.some((gid) => isBadDay(gid, ev.subjectId, dayOf(slot)))

  // Dars turi tartibi (ma'ruza→seminar→amaliy): bir fan+guruh uchun allaqachon
  // joylangan boshqa turdagi darslarga nisbatan kandidat slot noto'g'ri tomonda
  // bo'lsa (masalan seminar ma'ruzadan oldinroq slotga tushsa) — bu "yomon" hisoblanadi.
  const typeSlots = new Map() // "groupId|subjectId" -> [{ rank, slot }]
  const hasTypeViolation = (ev, slot) => {
    const rank = TYPE_RANK[ev.type]
    if (rank == null) return false
    return ev.groupIds.some((gid) => {
      const placed = typeSlots.get(`${gid}|${ev.subjectId}`)
      if (!placed) return false
      return placed.some((p) => (p.rank < rank && p.slot > slot) || (p.rank > rank && p.slot < slot))
    })
  }
  const markUsed = (ev) => {
    const day = dayOf(ev.slot)
    const rank = TYPE_RANK[ev.type]
    for (const gid of ev.groupIds) {
      const key = `${gid}|${ev.subjectId}`
      if (!usedDays.has(key)) usedDays.set(key, new Set())
      usedDays.get(key).add(day)
      if (rank != null) {
        if (!typeSlots.has(key)) typeSlots.set(key, [])
        typeSlots.get(key).push({ rank, slot: ev.slot })
      }
    }
  }

  for (const ev of order) {
    if (ev.rooms.length === 0 || ev.slots.length === 0) continue // nomzod xona/slot yo'q — joylab bo'lmaydi
    let best = null // { slot, room, conflicts } — zaxira (qattiq konfliktsiz, lekin kun/tur jihatidan yomon bo'lishi mumkin)
    let ok = null // qattiq konfliktsiz VA kun-toqnashuvsiz, lekin tur-tartibi buzilishi mumkin
    let goodDay = null // hammasi to'g'ri — topilsa darhol tanlanadi

    for (const slot of ev.slots) {
      // guruh(lar) va o'qituvchi shu slotda band bo'lsa — bu slot foydasiz, o'tkazib yuboramiz
      const baseBusy = ev.groupIds.reduce((s, gid) => s + (occ.groupFree(gid, slot) ? 0 : 1), 0)
        + (occ.teacherFree(ev.teacherId, slot) ? 0 : 1)
      if (baseBusy === 0) {
        // bo'sh xona qidiramiz; topilsa — konfliktsiz joylashuv
        const room = ev.rooms.find((r) => occ.roomFree(r, slot))
        if (room != null) {
          const candidate = { slot, room, conflicts: 0 }
          const badDay = hasBadDay(ev, slot)
          if (!badDay && !hasTypeViolation(ev, slot)) { goodDay = candidate; break }
          if (!badDay && !ok) ok = candidate
          if (!best) best = candidate
        }
      }
      // konfliktsiz topilmasa — eng kam konfliktli variantni eslab qolamiz
      if (!best || best.conflicts > 0) {
        const room = ev.rooms[0]
        const conflicts = baseBusy + (occ.roomFree(room, slot) ? 0 : 1)
        if (!best || conflicts < best.conflicts) best = { slot, room, conflicts }
      }
    }

    const chosen = goodDay || ok || best
    ev.slot = chosen.slot
    ev.room = chosen.room
    occ.place(ev)
    markUsed(ev)
  }

  return occ
}
