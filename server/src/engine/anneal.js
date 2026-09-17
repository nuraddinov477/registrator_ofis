import { groupEval, teacherCost, totalSoft } from './constraints.js'
import { PAIRS } from './timeslots.js'

// Simulated Annealing — yumshoq jarimani minimallashtiradi, qattiq konfliktlarni nolga tushiradi.
// Har harakatda faqat ta'sirlangan guruh(lar) va o'qituvchining jarimasi qayta hisoblanadi (delta-baholash).
// strict=true — to'qnashuvsiz jadvalni saqlagan holda (to'qnashuv yaratadigan harakat darhol rad etiladi)
// faqat oynalar va yumshoq jarimani kamaytiradi; joylanmagan darslarga tegmaydi.

const busyDays = (events, excludeId) => {
  const busy = new Map() // kun → Set(juftlik 1..6)
  for (const e of events) {
    if (e.id === excludeId || e.slot < 0) continue
    const day = Math.floor(e.slot / PAIRS)
    if (!busy.has(day)) busy.set(day, new Set())
    busy.get(day).add((e.slot % PAIRS) + 1)
  }
  return busy
}

// Band kundagi oynani to'ldiradigan yoki mavjud blokni davom ettiradigan slotlar
const attractiveFor = (ev, busy) => {
  if (busy.size === 0) return null
  const bounds = new Map()
  for (const [day, pairs] of busy) bounds.set(day, [Math.min(...pairs), Math.max(...pairs), pairs])
  const attractive = []
  for (const slot of ev.slots) {
    const bound = bounds.get(Math.floor(slot / PAIRS))
    if (!bound) continue
    const [lo, hi, pairs] = bound
    const p = (slot % PAIRS) + 1
    if ((lo < p && p < hi && !pairs.has(p)) || p === lo - 1 || p === hi + 1) attractive.push(slot)
  }
  return attractive.length ? attractive : null
}

// Ustuvorlik: AVVAL guruh (talaba) oynasi, keyin o'qituvchi oynasi. Ikkisi ham bo'lmasa — null
const attractiveSlots = (ev, ctx) => {
  for (const gid of ev.groupIds) {
    const found = attractiveFor(ev, busyDays(ctx.byGroup.get(gid) || [], ev.id))
    if (found) return found
  }
  return attractiveFor(ev, busyDays(ctx.byTeacher.get(ev.teacherId) || [], ev.id))
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

// Qat'iy rejimdagi almashtirish uchun sherik: aynan shu guruh(lar)ning boshqa vaqtdagi darsi.
// Guruhlar bir xil bo'lgani uchun almashtirish guruh bandligini o'zgartirmaydi — faqat o'qituvchi va
// xonalar tekshiriladi (bitta darsni surish mumkin bo'lmagan oynalarni shunday yopish mumkin).
const swapPartner = (ev, byGroup, rand) => {
  const candidates = ev.uniqueGroupIds.length ? byGroup.get(ev.uniqueGroupIds[0]) : null
  if (!candidates || !candidates.length) return null
  for (let i = 0; i < 3; i++) {
    const other = candidates[Math.floor(rand() * candidates.length)]
    if (other !== ev && other.slot >= 0 && other.slot !== ev.slot && other.rooms.length
      && sameList(other.uniqueGroupIds, ev.uniqueGroupIds)
      && other.slots.includes(ev.slot) && ev.slots.includes(other.slot)) return other
  }
  return null
}

// [to'qnashuvlar, oynalar, yumshoq] — leksikografik
const keyLess = (a, b) => (a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2])

export function anneal(ctx, occ, opts = {}) {
  const events = ctx.events
  const n = events.length
  const {
    maxMs = 5000,
    hardWeight = 1000,
    maxIters = Math.min(2_000_000, Math.max(50_000, n * 3000)),
    T0 = 2.0,
    Tmin = 0.01,
    rand = Math.random,
    strict = false,
  } = opts
  const alpha = Math.pow(Tmin / T0, 1 / maxIters) // geometrik sovish

  const { byGroup, byTeacher, groupStart } = ctx
  // Har guruhning [jarima, oynalar] va o'qituvchining jarimasi keshlanadi — "eski" qiymatni qayta
  // hisoblash shart emas (u faqat o'sha entity eventlariga bog'liq, shu sabab kesh har doim to'g'ri)
  const groupCache = new Map()
  for (const [gid, evs] of byGroup) groupCache.set(gid, groupEval(evs, groupStart.get(gid) ?? null))
  const teacherCache = new Map()
  for (const [tid, evs] of byTeacher) teacherCache.set(tid, teacherCost(evs))
  let currentSoft = totalSoft(ctx)
  // Qattiq buzilish = to'qnashuvlar (occ.hard) + guruhlardagi oynalar (oyna QAT'IY taqiqlangan)
  let gapTotal = 0
  for (const [, gaps] of groupCache.values()) gapTotal += gaps

  const bestSlot = events.map((e) => e.slot)
  const bestRoom = events.map((e) => e.room)
  // Ustuvorlik qat'iy tartibda: to'qnashuvlar → oynalar → yumshoq jarima. To'qnashuv oynadan ANCHA
  // og'ir — aks holda optimallashtiruvchi oynani to'qnashuvga "almashtirib" yuborishi mumkin.
  const conflictWeight = hardWeight * 100
  let bestKey = [occ.hard, gapTotal, currentSoft]
  let moved = [] // oxirgi snapshot'dan beri qabul qilingan harakatlar (event.id == indeks)

  const started = performance.now()
  let T = T0
  let accepted = 0
  let iters = 0
  let gapGroups = [] // oynasi bor guruhlar (har 1024 iteratsiyada yangilanadi)

  const firstFreeRoom = (ev, slot) => ev.rooms.find((r) => occ.roomFree(r, slot)) ?? null
  const evalGroups = (gids) => gids.map((gid) => groupEval(byGroup.get(gid), groupStart.get(gid) ?? null))
  const commitBest = () => {
    const currentKey = [occ.hard, gapTotal, currentSoft]
    if (keyLess(currentKey, bestKey)) {
      bestKey = currentKey
      for (const eid of moved) {
        bestSlot[eid] = events[eid].slot
        bestRoom[eid] = events[eid].room
      }
      moved = []
    }
  }

  // Ikki darsning vaqtini almashtirish (qat'iy rejim) — qabul qilinmasa yoki mumkin bo'lmasa, holat tiklanadi
  const trySwap = (a, b) => {
    const groups = a.uniqueGroupIds
    const teachers = [...new Set([a.teacherId, b.teacherId])]
    const oldGroups = groups.map((gid) => groupCache.get(gid))
    const oldLocal = oldGroups.reduce((s, [cost]) => s + cost, 0) + teachers.reduce((s, t) => s + teacherCache.get(t), 0)
    const oldGaps = oldGroups.reduce((s, [, gaps]) => s + gaps, 0)
    const slotA = a.slot, roomA = a.room, slotB = b.slot, roomB = b.room
    occ.remove(a)
    occ.remove(b)
    const restore = () => {
      a.slot = slotA; a.room = roomA; b.slot = slotB; b.room = roomB
      occ.place(a)
      occ.place(b)
    }
    if (!(occ.teacherFree(a.teacherId, slotB) && occ.teacherFree(b.teacherId, slotA)
      && a.groupIds.every((g) => occ.groupFree(g, slotA) && occ.groupFree(g, slotB)))) {
      restore()
      return
    }
    const newRoomA = firstFreeRoom(a, slotB)
    if (newRoomA === null) { restore(); return }
    a.slot = slotB; a.room = newRoomA
    occ.place(a)
    const newRoomB = firstFreeRoom(b, slotA)
    if (newRoomB === null) { occ.remove(a); restore(); return }
    b.slot = slotA; b.room = newRoomB
    occ.place(b)

    const newGroups = evalGroups(groups)
    const newTeachers = teachers.map((t) => [t, teacherCost(byTeacher.get(t))])
    const newGaps = newGroups.reduce((s, [, gaps]) => s + gaps, 0)
    const deltaSoft = newGroups.reduce((s, [cost]) => s + cost, 0) + newTeachers.reduce((s, [, c]) => s + c, 0) - oldLocal
    const delta = (newGaps - oldGaps) * hardWeight + deltaSoft
    if (delta <= 0 || rand() < Math.exp(-delta / T)) {
      currentSoft += deltaSoft
      gapTotal += newGaps - oldGaps
      accepted++
      groups.forEach((gid, i) => groupCache.set(gid, newGroups[i]))
      for (const [t, c] of newTeachers) teacherCache.set(t, c)
      moved.push(a.id, b.id)
      commitBest()
    } else {
      occ.remove(a)
      occ.remove(b)
      restore()
    }
  }

  while (iters < maxIters) {
    if ((iters & 1023) === 0) {
      if (performance.now() - started > maxMs) break // vaqt byudjeti
      gapGroups = []
      for (const [gid, [, gaps]] of groupCache) if (gaps > 0) gapGroups.push(byGroup.get(gid))
    }

    // Yarim holatda — oynasi bor guruhning darsi (jozibali slot aynan shu oynani yopishga urinadi)
    let ev
    if (gapGroups.length && rand() < 0.5) {
      const groupEvents = gapGroups[Math.floor(rand() * gapGroups.length)]
      ev = groupEvents[Math.floor(rand() * groupEvents.length)]
    } else {
      ev = events[Math.floor(rand() * n)]
    }
    if (!ev.rooms.length || !ev.slots.length || (strict && ev.slot < 0)) { iters++; continue }
    if (strict && rand() < 0.35) {
      const partner = swapPartner(ev, byGroup, rand)
      if (partner !== null) {
        trySwap(ev, partner)
        T = Math.max(Tmin, T * alpha)
        iters++
        continue
      }
    }

    // Potok: ko'chirilsa BARCHA guruhlarning narxi bir vaqtda o'zgaradi
    const groupIds = ev.uniqueGroupIds
    const oldGroups = groupIds.map((gid) => groupCache.get(gid))
    const oldLocal = oldGroups.reduce((s, [cost]) => s + cost, 0) + teacherCache.get(ev.teacherId)
    const oldGaps = oldGroups.reduce((s, [, gaps]) => s + gaps, 0)
    const oldConflicts = occ.hard
    const oldSlot = ev.slot, oldRoom = ev.room

    // Qo'shni yechim: ~90% "jozibali" slotlar orasidan, aks holda to'liq tasodifiy
    occ.remove(ev)
    const smart = rand() < 0.9 ? attractiveSlots(ev, ctx) : null
    const pool = smart || ev.slots
    ev.slot = pool[Math.floor(rand() * pool.length)]
    if (strict) {
      // qat'iy rejim: guruh/o'qituvchi band bo'lsa yoki bo'sh xona bo'lmasa — harakat yo'q
      let room = null
      if (occ.teacherFree(ev.teacherId, ev.slot) && ev.groupIds.every((g) => occ.groupFree(g, ev.slot))) {
        room = firstFreeRoom(ev, ev.slot)
      }
      if (room === null) {
        ev.slot = oldSlot
        ev.room = oldRoom
        occ.place(ev)
        T = Math.max(Tmin, T * alpha)
        iters++
        continue
      }
      ev.room = room
    } else {
      ev.room = ev.rooms[Math.floor(rand() * ev.rooms.length)]
    }
    occ.place(ev)

    const newGroups = evalGroups(groupIds)
    const newTeacher = teacherCost(byTeacher.get(ev.teacherId))
    const newGaps = newGroups.reduce((s, [, gaps]) => s + gaps, 0)
    const deltaSoft = newGroups.reduce((s, [cost]) => s + cost, 0) + newTeacher - oldLocal
    const delta = (occ.hard - oldConflicts) * conflictWeight + (newGaps - oldGaps) * hardWeight + deltaSoft

    if (delta <= 0 || rand() < Math.exp(-delta / T)) {
      currentSoft += deltaSoft
      gapTotal += newGaps - oldGaps
      accepted++
      groupIds.forEach((gid, i) => groupCache.set(gid, newGroups[i]))
      teacherCache.set(ev.teacherId, newTeacher)
      moved.push(ev.id)
      // eng yaxshini yangilash — faqat oxirgi snapshot'dan beri ko'chgan eventlar yoziladi
      commitBest()
    } else {
      // rad — eski holatga qaytaramiz
      occ.remove(ev)
      ev.slot = oldSlot
      ev.room = oldRoom
      occ.place(ev)
    }

    T = Math.max(Tmin, T * alpha)
    iters++
  }

  for (const e of events) { // eng yaxshi topilgan yechim
    e.slot = bestSlot[e.id]
    e.room = bestRoom[e.id]
  }
  return {
    iterations: iters, accepted, bestHard: bestKey[0] + bestKey[1],
    bestConflicts: bestKey[0], bestGaps: bestKey[1], bestSoft: bestKey[2],
    ms: Math.round(performance.now() - started),
  }
}
