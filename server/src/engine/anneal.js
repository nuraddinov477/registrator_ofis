import { groupCost, teacherCost, totalSoft } from './constraints.js'

const randInt = (n) => (Math.random() * n) | 0

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
    if (ev.rooms.length === 0) continue

    const g = ctx.byGroup.get(ev.groupId)
    const t = ctx.byTeacher.get(ev.teacherId)
    const oldLocal = groupCost(g) + teacherCost(t)
    const oldHard = occ.hard
    const oldSlot = ev.slot, oldRoom = ev.room

    // qo'shni yechim: tasodifiy yangi slot + xona
    occ.remove(ev)
    ev.slot = ev.slots[randInt(ev.slots.length)]
    ev.room = ev.rooms[randInt(ev.rooms.length)]
    occ.place(ev)

    const newLocal = groupCost(g) + teacherCost(t)
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
