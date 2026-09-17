import { DAYS, PAIRS } from './timeslots.js'

// Dars turi tartibi: ma'ruza → seminar → amaliy (talabaga mantiqan avval nazariya,
// keyin amaliyot). Workload.type / event.type shu qiymatlardan biri (default "Amaliy").
export const TYPE_RANK = { "Maʼruza": 0, Seminar: 1, Amaliy: 2 }

// Yumshoq cheklash vaznlari. Qattiq cheklashlar: to'qnashuv (Occupancy.hard) va OYNA —
// kun ichida darslar ORASIDAGI bo'sh juftlik (groupEval ikkinchi qiymati).
export const WEIGHTS = {
  // teacherGap/groupGap: KVADRATIK — (haftalik jami oyna)^2 * vazn, har ENTITY uchun bir marta.
  // To'planib qolgan oynani qattiqroq jazolab, oynalarni guruh/o'qituvchilar orasida teng taqsimlaydi.
  teacherGap: 20,
  groupGap: 40,
  // Guruh oynasi 1 tadan OSHSA — har qo'shimcha oyna uchun alohida, CHIZIQLI katta jarima
  groupGapOverCap: 150,
  consecutive: 3, // 4 tadan ortiq ketma-ket dars (har ortig'i)
  subjectSpread: 100, // bir fan bir kunda ikkinchi marta kelsa — boshqa kunga ko'chirilishi kerak
  subjectConsecutiveDays: 18, // bir fan ketma-ket kunlarga tushsa (masalan Dush+Sesh)
  subjectAdjacent: 20, // ikki XIL fan bir kunda ketma-ket juftlikda kelsa
  subjectTypeOrder: 16, // fanning ma'ruza/seminar/amaliy turlari haftada teskari tartibda (har juftlik uchun)
  groupDayMax: 15, // guruhning kunlik darslari 4 tadan oshsa — har ortiqchasi uchun
  groupDayMin: 12, // band kunda atigi 1 ta dars — talaba shu 1 soat uchun kelmasin
  assignedRoom: 22, // biriktirilgan xona bor-u, dars boshqa xonaga qo'yilgan
  roomFit: 2, // xona sig'imi guruhdan (+2 tolerantlik) ortiq — har ortiqcha o'rin uchun
  morning: 1, // qiyin fan kechki juftlikda
  groupBalance: 1, // guruh yukini kunlarga teng taqsimlash
  lonePair: 8, // o'qituvchi kuni 1 juftlikdan iborat
  teacherDay: 2, // o'qituvchining har ish kuni — kamroq kun = ixcham hafta
  roomChange: 1, // guruh uchun har xil xona (barqarorlik)
  MAX_CONSEC: 4,
}

const popcount = (x) => { let n = 0; while (x) { x &= x - 1; n++ } return n }
const highBit = (x) => 31 - Math.clz32(x)

export function groupCost(groupEvents, W = WEIGHTS, dayStart = null) {
  return groupEval(groupEvents, dayStart, W)[0]
}

// Bitta guruhning [yumshoq jarima, haftalik oynalar soni] — faqat shu guruh eventlari kerak
// (delta-baholash). OYNA = kun ichida darslar ORASIDAGI bo'sh juftlik, takrorlanmas juftliklar
// bo'yicha sanaladi (bir juftlikka tushgan ikki dars oynani "yopib" qo'ymaydi). Kun boshidagi bo'sh
// vaqt (guruhning boshlanish juftligidan birinchi darsgacha) oyna EMAS, faqat yumshoq jarima.
// dayStart berilmasa — birinchi joylangan eventning boshlanish juftligi olinadi.
export function groupEval(groupEvents, dayStart = null, W = WEIGHTS) {
  const perDay = new Array(DAYS).fill(null) // kun → [[juftlik 0..5, fan, qiyinlik]]
  const rooms = new Set()
  const subjectDays = new Map() // fan → kunlar bit-niqobi
  let typed = null
  let cost = 0
  const guessStart = dayStart == null
  if (guessStart) dayStart = 0
  for (const e of groupEvents) {
    const slot = e.slot
    if (slot < 0) continue
    if (guessStart && !dayStart) dayStart = e.startPair
    const day = Math.floor(slot / PAIRS), q = slot % PAIRS
    const item = [q, e.subjectId, e.difficulty]
    if (perDay[day] === null) perDay[day] = [item]
    else perDay[day].push(item)
    const room = e.room
    rooms.add(room)
    subjectDays.set(e.subjectId, (subjectDays.get(e.subjectId) || 0) | (1 << day))
    if (e.assignedRooms.length && room >= 0 && !e.assignedSet.has(room)) cost += W.assignedRoom
    // POTOK (bir nechta guruh) ATAYLAB katta xonani band qiladi — roomFit unga tegishli emas
    if (e.single) {
      const cap = e.roomCapacities[room]
      if (cap != null && cap - e.groupSize > 2) cost += (cap - e.groupSize - 2) * W.roomFit
    }
    if (e.rank != null) {
      if (typed === null) typed = new Map()
      let list = typed.get(e.subjectId)
      if (!list) typed.set(e.subjectId, (list = []))
      list.push([slot, e.rank])
    }
  }

  const maxConsec = W.MAX_CONSEC
  let weeklyGap = 0 // yumshoq: kun boshidagi bo'sh vaqt + oynalar
  let innerGaps = 0 // qattiq: faqat darslar orasidagi oynalar
  let squares = 0
  for (const items of perDay) {
    if (items === null) continue
    const n = items.length
    squares += n * n
    if (n === 1) {
      const [q, , difficulty] = items[0]
      if (q + 1 > dayStart) weeklyGap += q + 1 - dayStart
      cost += W.groupDayMin
      if (difficulty >= 4 && q > 2) cost += (difficulty - 3) * (q - 2) * W.morning
      continue
    }
    items.sort((a, b) => a[0] - b[0])
    const lo = items[0][0], hi = items[n - 1][0]
    const lead = lo + 1 - dayStart
    let distinct = 1
    for (let i = 1; i < n; i++) if (items[i][0] !== items[i - 1][0]) distinct++
    const inner = hi - lo + 1 - distinct
    innerGaps += inner
    weeklyGap += (lead > 0 ? lead : 0) + inner
    let [prevQ, prevSubject, difficulty] = items[0]
    let morning = difficulty >= 4 && prevQ > 2 ? (difficulty - 3) * (prevQ - 2) : 0
    const subjects = new Set([prevSubject])
    let run = 1, penalty = 0, adjacent = 0
    for (let i = 1; i < n; i++) {
      const [q, subject, diff] = items[i]
      if (q === prevQ + 1) {
        run++
        if (subject !== prevSubject) adjacent++ // ikki XIL fan ketma-ket juftlikda
      } else {
        if (run > maxConsec) penalty += run - maxConsec
        run = 1
      }
      if (diff >= 4 && q > 2) morning += (diff - 3) * (q - 2) // qiyin fan kechki juftlikda
      subjects.add(subject)
      prevQ = q
      prevSubject = subject
    }
    if (run > maxConsec) penalty += run - maxConsec
    cost += penalty * W.consecutive + adjacent * W.subjectAdjacent + morning * W.morning
    if (n > 4) cost += (n - 4) * W.groupDayMax
    cost += (n - subjects.size) * W.subjectSpread // bir fan bir kunda ikkinchi (yoki undan ortiq) marta
  }

  cost += weeklyGap * weeklyGap * W.groupGap
  if (weeklyGap > 1) cost += (weeklyGap - 1) * W.groupGapOverCap
  cost += squares * W.groupBalance * 0.5 // kunlar bo'yicha muvozanat
  if (rooms.size > 1) cost += (rooms.size - 1) * W.roomChange // xona barqarorligi

  // Fan ketma-ket kunlarga tushmasin — kamida bir kun oralatib
  for (const mask of subjectDays.values()) {
    const consecutiveDays = mask & (mask >> 1)
    if (consecutiveDays) cost += popcount(consecutiveDays) * W.subjectConsecutiveDays
  }

  // Dars turi tartibi: fanning ma'ruza/seminar/amaliy darslari hafta davomida to'g'ri tartibda
  if (typed !== null) {
    for (const items of typed.values()) {
      for (let i = 0; i < items.length; i++) {
        const [aSlot, aRank] = items[i]
        for (let j = i + 1; j < items.length; j++) {
          const [bSlot, bRank] = items[j]
          if (aRank === bRank) continue
          const earlier = aSlot < bSlot ? aRank : bRank
          const later = aSlot < bSlot ? bRank : aRank
          if (earlier > later) cost += W.subjectTypeOrder
        }
      }
    }
  }
  return [cost, innerGaps]
}

// Guruhning oynalari: kun → darslar orasida bo'sh qolgan juftliklar (1..6). Kunlar o'sish tartibida.
export function groupGapPairs(groupEvents) {
  const perDay = new Map()
  for (const e of groupEvents) {
    if (e.slot < 0) continue
    const day = Math.floor(e.slot / PAIRS)
    if (!perDay.has(day)) perDay.set(day, new Set())
    perDay.get(day).add((e.slot % PAIRS) + 1)
  }
  const gaps = new Map()
  for (const day of [...perDay.keys()].sort((a, b) => a - b)) {
    const pairs = perDay.get(day)
    const lo = Math.min(...pairs), hi = Math.max(...pairs)
    const empty = []
    for (let p = lo + 1; p < hi; p++) if (!pairs.has(p)) empty.push(p)
    if (empty.length) gaps.set(day, empty)
  }
  return gaps
}

// O'qituvchining yumshoq jarimasi. Maqsad: IXCHAM hafta — kamroq ish kuni, kunda 2+ juftlik, derazasiz.
export function teacherCost(teacherEvents, W = WEIGHTS) {
  const masks = new Array(DAYS).fill(0) // kun → band juftliklar bit-niqobi (takrorlanmas)
  for (const e of teacherEvents) {
    if (e.slot >= 0) masks[Math.floor(e.slot / PAIRS)] |= 1 << (e.slot % PAIRS)
  }
  let cost = 0
  let weeklyGap = 0
  for (const mask of masks) {
    if (!mask) continue
    const n = popcount(mask)
    const lo = highBit(mask & -mask)
    const hi = highBit(mask)
    weeklyGap += lo + (hi - lo + 1 - n) // kun boshi (1-juftlik) + ichki oynalar
    cost += W.teacherDay
    if (n === 1) cost += W.lonePair
  }
  return cost + weeklyGap * weeklyGap * W.teacherGap
}

export function totalSoft(ctx) {
  let soft = 0
  for (const [gid, events] of ctx.byGroup) soft += groupEval(events, ctx.groupStart.get(gid) ?? null)[0]
  for (const events of ctx.byTeacher.values()) soft += teacherCost(events)
  return soft
}

// Barcha guruhlardagi oynalar (darslar orasidagi bo'sh juftliklar) soni — qattiq buzilish
export function totalGaps(ctx) {
  let gaps = 0
  for (const [gid, events] of ctx.byGroup) gaps += groupEval(events, ctx.groupStart.get(gid) ?? null)[1]
  return gaps
}
