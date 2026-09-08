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
  // band qilingan kunlarni kuzatib boramiz. Ikki darajali "yomonlik": SHU KUN (2 —
  // og'irrog'i, subjectSpread) qo'shni kundan (1 — subjectConsecutiveDays) YOMONROQ —
  // haftalik soat ko'p bo'lib hammasiga toza kun yetmasa, greedy shu kun EMAS, qo'shni
  // kunni tanlaydi (constraints.js'dagi vazn tartibiga mos: 25 > 18).
  const usedDays = new Map() // "groupId|subjectId" -> Set(day)
  const daySeverity = (ev, day) => {
    let worst = 0
    for (const gid of ev.groupIds) {
      const days = usedDays.get(`${gid}|${ev.subjectId}`)
      if (!days) continue
      for (const d of days) {
        if (d === day) worst = 2
        else if (worst < 1 && Math.abs(d - day) === 1) worst = 1
      }
    }
    return worst
  }

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
    let fallback = null // { slot, room, conflicts>0 } — qattiq konflikt bo'lsa oxirgi zaxira
    let clean = null // { slot, room, conflicts:0 } — konfliktsiz eng yaxshi topilgan (sev,tur) bo'yicha
    let cleanSev = Infinity, cleanTypeViol = true

    for (const slot of ev.slots) {
      // guruh(lar) va o'qituvchi shu slotda band bo'lsa — bu slot foydasiz, o'tkazib yuboramiz
      const baseBusy = ev.groupIds.reduce((s, gid) => s + (occ.groupFree(gid, slot) ? 0 : 1), 0)
        + (occ.teacherFree(ev.teacherId, slot) ? 0 : 1)
      if (baseBusy === 0) {
        // bo'sh xona qidiramiz; topilsa — konfliktsiz joylashuv, kun-yomonligi eng
        // kichigini (0=toza, 1=qo'shni kun, 2=xuddi shu kun) tanlaymiz
        const room = ev.rooms.find((r) => occ.roomFree(r, slot))
        if (room != null) {
          const sev = daySeverity(ev, dayOf(slot))
          const typeViol = hasTypeViolation(ev, slot)
          if (sev === 0 && !typeViol) { clean = { slot, room, conflicts: 0 }; break } // mukammal — darhol
          if (sev < cleanSev || (sev === cleanSev && cleanTypeViol && !typeViol)) {
            cleanSev = sev; cleanTypeViol = typeViol
            clean = { slot, room, conflicts: 0 }
          }
        }
      }
      // konfliktsiz topilmasa — eng kam konfliktli variantni eslab qolamiz
      if (!fallback || fallback.conflicts > 0) {
        const room = ev.rooms[0]
        const conflicts = baseBusy + (occ.roomFree(room, slot) ? 0 : 1)
        if (!fallback || conflicts < fallback.conflicts) fallback = { slot, room, conflicts }
      }
    }

    const chosen = clean || fallback
    ev.slot = chosen.slot
    ev.room = chosen.room
    occ.place(ev)
    markUsed(ev)
  }

  return occ
}
