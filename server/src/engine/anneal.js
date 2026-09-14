import { groupCost, teacherCost, totalSoft } from './constraints.js'
import { dayOf, pairOf } from './timeslots.js'

const randInt = (n) => (Math.random() * n) | 0

// To'liq TASODIFIY slot tanlash katta masalada (yuzlab guruh) "oyna"ni to'ldiruvchi
// joyni deyarli hech qachon duch kelmaydi — millionlab iteratsiyada ham. Shu sabab
// ev.slots ichidan berilgan "band juftliklar" (busyByDay) UCHUN "jozibali" (band
// kundagi bo'shliqni to'ldiradigan yoki mavjud blokni davom ettiradigan) slotlarni
// ajratib beramiz.
function attractiveFor(ev, busyByDay) {
  if (busyByDay.size === 0) return null
  const attractive = []
  for (const slot of ev.slots) {
    const d = dayOf(slot), p = pairOf(slot)
    const pairs = busyByDay.get(d)
    if (!pairs || pairs.size === 0) continue
    const min = Math.min(...pairs), max = Math.max(...pairs)
    // band oralig'idagi bo'sh juftlik (oynani to'ldiradi) YOKI blokka tutash (davom ettiradi)
    if ((p > min && p < max && !pairs.has(p)) || p === min - 1 || p === max + 1) {
      attractive.push(slot)
    }
  }
  return attractive.length ? attractive : null
}

const busyDaysOf = (events, excludeId) => {
  const m = new Map() // day -> Set(pair)
  for (const e of events) {
    if (e.id === excludeId || e.slot < 0) continue
    const d = dayOf(e.slot), p = pairOf(e.slot)
    if (!m.has(d)) m.set(d, new Set())
    m.get(d).add(p)
  }
  return m
}

// Ustuvorlik: AVVAL guruh (talaba) oynasini to'ldiradigan joy qidiriladi — topilsa
// shu ishlatiladi. Topilmasa (guruh hali bo'sh yoki mos joy yo'q), O'QITUVCHI oynasini
// to'ldiradigan joy qidiriladi. Ikkisi ham bo'lmasa — null (chaqiruvchi tasodifiyga o'tadi).
function attractiveSlots(ev, ctx) {
  for (const gid of ev.groupIds) {
    const busy = busyDaysOf(ctx.byGroup.get(gid) || [], ev.id)
    const found = attractiveFor(ev, busy)
    if (found) return found
  }
  const tBusy = busyDaysOf(ctx.byTeacher.get(ev.teacherId) || [], ev.id)
  return attractiveFor(ev, tBusy)
}

// Simulated Annealing — yumshoq jarimani minimallashtiradi, qolgan qattiq
// konfliktlarni nolga tushiradi. Har harakatda faqat ta'sirlangan guruh va
// o'qituvchining jarimasi qayta hisoblanadi (delta-baholash) — bu masshtab kaliti.
export function anneal(ctx, occ, opts = {}) {
  const n = ctx.events.length
  const {
    hardWeight = 1000,
    maxMs = 5000,
    maxIters = Math.min(2_000_000, Math.max(50_000, n * 3000)),
    T0 = 2.0,
    Tmin = 0.01,
  } = opts

  const alpha = Math.pow(Tmin / T0, 1 / maxIters) // geometrik sovish

  let currentSoft = totalSoft(ctx)
  const cost = () => occ.hard * hardWeight + currentSoft

  // Eng yaxshi yechim snapshot'i (event.id bo'yicha indekslangan)
  const bestSlot = new Int16Array(n)
  const bestRoom = new Int32Array(n)
  const snapshot = () => { for (const e of ctx.events) { bestSlot[e.id] = e.slot; bestRoom[e.id] = e.room } }
  const restore = () => {
    for (const e of ctx.events) { e.slot = bestSlot[e.id]; e.room = bestRoom[e.id] }
  }
  let bestHard = occ.hard, bestSoft = currentSoft
  snapshot()

  const t0 = Date.now()
  let T = T0, iters = 0, accepted = 0

  for (; iters < maxIters; iters++) {
    if ((iters & 1023) === 0 && Date.now() - t0 > maxMs) break // vaqt byudjeti

    const ev = ctx.events[randInt(n)]
    if (ev.rooms.length === 0 || ev.slots.length === 0) continue

    // Potok: shu event bir nechta guruhga tegishli bo'lishi mumkin — ko'chirilsa
    // BARCHA shu guruhlarning narxi bir vaqtda o'zgaradi, hammasi yig'indiga qo'shiladi
    const groupLists = ev.groupIds.map((gid) => ctx.byGroup.get(gid))
    const t = ctx.byTeacher.get(ev.teacherId)
    const oldLocal = groupLists.reduce((s, g) => s + groupCost(g), 0) + teacherCost(t)
    const oldHard = occ.hard
    const oldSlot = ev.slot, oldRoom = ev.room

    // qo'shni yechim: yangi slot + xona. ~90% holatda "jozibali" (oyna to'ldiruvchi/
    // blok davom ettiruvchi — avval guruh, keyin o'qituvchi) slotlar orasidan, aks
    // holda to'liq tasodifiy (lokal optimumga qotib qolmaslik uchun ozgina saqlanadi).
    occ.remove(ev)
    const smart = Math.random() < 0.9 ? attractiveSlots(ev, ctx) : null
    const slotPool = smart || ev.slots
    ev.slot = slotPool[randInt(slotPool.length)]
    ev.room = ev.rooms[randInt(ev.rooms.length)]
    occ.place(ev)

    const newLocal = groupLists.reduce((s, g) => s + groupCost(g), 0) + teacherCost(t)
    const deltaSoft = newLocal - oldLocal
    const delta = (occ.hard - oldHard) * hardWeight + deltaSoft

    if (delta <= 0 || Math.random() < Math.exp(-delta / T)) {
      currentSoft += deltaSoft
      accepted++
      // eng yaxshini yangilash (avval qattiq, keyin yumshoq)
      if (occ.hard < bestHard || (occ.hard === bestHard && currentSoft < bestSoft)) {
        bestHard = occ.hard; bestSoft = currentSoft; snapshot()
      }
    } else {
      // rad — eski holatga qaytaramiz
      occ.remove(ev)
      ev.slot = oldSlot; ev.room = oldRoom
      occ.place(ev)
    }

    T *= alpha
    if (T < Tmin) T = Tmin
  }

  restore() // eng yaxshi topilgan yechimni qo'yamiz
  return { iterations: iters, accepted, bestHard, bestSoft, ms: Date.now() - t0 }
}
