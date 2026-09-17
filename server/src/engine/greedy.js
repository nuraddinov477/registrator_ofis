import { Occupancy } from './occupancy.js'
import { dayOf, pairOf } from './timeslots.js'
import { TYPE_RANK } from './constraints.js'

// Ochko'z (greedy) konstruksiya — DSATUR uslubi: eng "qiyin" eventlar birinchi.
// Maqsad: qattiq cheklovlarni buzmaydigan boshlang'ich jadval (keyin SA yaxshilaydi).
// Tartib: kam nomzod xonali, kam slotli, katta guruhli eventlar oldinda.
export function greedyConstruct(ctx) {
  const occ = new Occupancy()
  const order = [...ctx.events].sort((a, b) =>
    (a.rooms.length - b.rooms.length) || (a.slots.length - b.slots.length) || (b.groupSize - a.groupSize))

  // Bir xil fan/guruh eventlari bir kunga "uyumlashib" qolmasligi uchun band kunlarni kuzatamiz.
  // Yomonlik: 2 — shu kun (subjectSpread), 1 — qo'shni kun (subjectConsecutiveDays), 0 — toza
  const usedDays = new Map() // "guruh|fan" → Set(kun)
  const typeSlots = new Map() // "guruh|fan" → [[rank, slot]]
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

  // Dars turi tartibi (ma'ruza→seminar→amaliy): kandidat slot noto'g'ri tomondami?
  const hasTypeViolation = (ev, slot) => {
    const rank = TYPE_RANK[ev.type]
    if (rank == null) return false
    return ev.groupIds.some((gid) => (typeSlots.get(`${gid}|${ev.subjectId}`) || [])
      .some(([pRank, pSlot]) => (pRank < rank && pSlot > slot) || (pRank > rank && pSlot < slot)))
  }

  // Oyna (darslar orasidagi bo'sh juftlik) QAT'IY taqiqlangan: guruhning har kunidagi band juftliklari
  // kuzatiladi va oyna ochmaydigan (yoki mavjudini yopadigan) slot afzal ko'riladi; ikkinchi darajada —
  // kunni kechroq boshlatmaydigan slot
  const groupStart = ctx.groupStart
  const dayPairs = new Map() // "guruh|kun" → Set(juftlik 1..6)
  // [oynalar o'zgarishi, kun boshidagi bo'sh vaqt o'zgarishi]
  const gapChange = (ev, slot) => {
    const day = dayOf(slot), pair = pairOf(slot)
    let inner = 0, lead = 0
    for (const gid of ev.uniqueGroupIds) {
      const pairs = dayPairs.get(`${gid}|${day}`)
      const start = groupStart.get(gid) ?? 1
      if (!pairs || pairs.size === 0) {
        lead += Math.max(0, pair - start)
      } else if (!pairs.has(pair)) {
        const lo = Math.min(...pairs), hi = Math.max(...pairs)
        if (lo < pair && pair < hi) inner -= 1 // oynani yopadi
        else if (pair > hi) inner += pair - hi - 1
        else {
          inner += lo - pair - 1
          lead += Math.max(0, pair - start) - Math.max(0, lo - start) // kun erta boshlanadi (<= 0)
        }
      }
    }
    return [inner, lead]
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
        typeSlots.get(key).push([rank, ev.slot])
      }
      const dk = `${gid}|${day}`
      if (!dayPairs.has(dk)) dayPairs.set(dk, new Set())
      dayPairs.get(dk).add(pairOf(ev.slot))
    }
  }

  // kalit = [oyna, kun takrori, tur tartibi (0/1), kech boshlanish] — leksikografik
  const keyLess = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
    return false
  }

  for (const ev of order) {
    if (!ev.rooms.length || !ev.slots.length) continue // nomzod xona/slot yo'q — joylab bo'lmaydi
    let fallback = null // [slot, room, conflicts] — qattiq konflikt bo'lsa oxirgi zaxira
    let clean = null // [kalit, slot, room] — konfliktsiz eng yaxshisi

    for (const slot of ev.slots) {
      let baseBusy = 0
      for (const gid of ev.groupIds) if (!occ.groupFree(gid, slot)) baseBusy++
      if (!occ.teacherFree(ev.teacherId, slot)) baseBusy++
      if (baseBusy === 0) {
        const room = ev.rooms.find((r) => occ.roomFree(r, slot))
        if (room !== undefined) {
          const [inner, lead] = gapChange(ev, slot)
          const key = [inner, daySeverity(ev, dayOf(slot)), hasTypeViolation(ev, slot) ? 1 : 0, lead]
          if (clean === null || keyLess(key, clean[0])) {
            clean = [key, slot, room]
            // oyna ochmaydi (yoki yopadi) va boshqa qoidalar ham toza — darhol
            if (key[0] <= 0 && key[1] === 0 && key[2] === 0 && key[3] <= 0) break
          }
        }
      }
      // konfliktsiz topilmasa — eng kam konfliktli variantni eslab qolamiz
      if (fallback === null || fallback[2] > 0) {
        const room = ev.rooms[0]
        const conflicts = baseBusy + (occ.roomFree(room, slot) ? 0 : 1)
        if (fallback === null || conflicts < fallback[2]) fallback = [slot, room, conflicts]
      }
    }

    if (clean !== null) { ev.slot = clean[1]; ev.room = clean[2] } else { ev.slot = fallback[0]; ev.room = fallback[1] }
    occ.place(ev)
    markUsed(ev)
  }

  return occ
}
