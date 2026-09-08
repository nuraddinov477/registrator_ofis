import { DAYS, dayOf, pairOf } from './timeslots.js'

// Dars turi tartibi: ma'ruza → seminar → amaliy (talabaga mantiqan avval nazariya,
// keyin amaliyot). Workload.type / event.type shu qiymatlardan biri (default "Amaliy").
export const TYPE_RANK = { "Maʼruza": 0, Seminar: 1, Amaliy: 2 }

// Yumshoq cheklash vaznlari (sozlanadigan). Qattiq cheklash Occupancy.hard orqali.
export const WEIGHTS = {
  teacherGap: 7, // o'qituvchi "derazasi" — bo'sh keyin band, keyin yana bo'sh bo'lib qolmasin
  groupGap: 7, // guruh (talaba) "derazasi" — o'qituvchi bilan bir xil darajada muhim
  consecutive: 3, // 4 tadan ortiq ketma-ket dars (har ortig'i)
  subjectSpread: 100, // bir fan bir kunda ikkinchi marta kelsa (ketma-ket bo'lsa ham, orada tanaffus bo'lsa ham) — boshqa kunga ko'chirilishi kerak. Vazn ATAYIN baland: teacherGap/lonePair/groupDayMin kabi "kunlarni siqish" tendensiyasidan HAR DOIM ustun turishi kerak (bir fan kuni muhimroq)
  subjectConsecutiveDays: 18, // bir fan ketma-ket kunlarga tushsa (masalan Dush+Sesh) — 1 kun oralik yetarli, ortiqcha tanaffus shart emas
  subjectAdjacent: 20, // ikki XIL fan bir kunda ketma-ket juftlikda kelsa (masalan 2-juftlik va 3-juftlik) — talabalarga og'ir, ayniqsa til fanlarida
  subjectTypeOrder: 16, // bir fanning ma'ruza/seminar/amaliy turlari haftada noto'g'ri tartibda kelsa (masalan seminar ma'ruzadan oldin) — har teskari juftlik uchun
  groupDayMax: 15, // guruh uchun kunlik darslar soni 4 tadan oshsa — har ortiqcha dars uchun
  groupDayMin: 12, // guruh uchun band kunda atigi 1 ta dars bo'lsa (2 tadan kam) — talaba shu 1 soat uchun kelmasin
  assignedRoom: 22, // guruhga maxsus biriktirilgan xona bor-u, dars boshqa xonaga qo'yilgan bo'lsa
  roomFit: 2, // xona sig'imi guruh sonidan (+2 tolerantlik bilan) ortiqcha bo'lsa — har ortiqcha o'rin uchun
  morning: 1, // qiyin fan kechki juftlikda
  groupBalance: 1, // guruh yukini kunlarga teng taqsimlash
  lonePair: 8, // o'qituvchi kuni 1 juftlikdan iborat — 1 soat uchun qatnamasin
  teacherDay: 2, // o'qituvchining har ish kuni — kamroq kun = ixcham hafta
  roomChange: 1, // guruh uchun har xil xona (barqarorlik)
  MAX_CONSEC: 4,
}

// Bir kundagi band juftliklar bo'yicha "oyna" (gap) soni = (max-min+1) - count
function gapsInDay(pairs) {
  if (pairs.length < 2) return 0
  const min = Math.min(...pairs), max = Math.max(...pairs)
  return (max - min + 1) - pairs.length
}

// Eng uzun ketma-ketlikdan 4 dan ortig'i uchun jazo
function consecutivePenalty(pairs) {
  if (pairs.length < 2) return 0
  const sorted = [...pairs].sort((a, b) => a - b)
  let run = 1, penalty = 0
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) run++
    else { if (run > WEIGHTS.MAX_CONSEC) penalty += run - WEIGHTS.MAX_CONSEC; run = 1 }
  }
  if (run > WEIGHTS.MAX_CONSEC) penalty += run - WEIGHTS.MAX_CONSEC
  return penalty
}

// Bitta guruhning yumshoq jarimasi (faqat shu guruh eventlari kerak — delta uchun)
export function groupCost(groupEvents, W = WEIGHTS) {
  const perDay = Array.from({ length: DAYS }, () => [])
  const rooms = new Set()
  const subjectDays = new Map() // subjectId -> Set(day) — kunlar oralig'ini tekshirish uchun
  let cost = 0
  for (const e of groupEvents) {
    if (e.slot < 0) continue
    perDay[dayOf(e.slot)].push(e)
    rooms.add(e.room)
    if (!subjectDays.has(e.subjectId)) subjectDays.set(e.subjectId, new Set())
    subjectDays.get(e.subjectId).add(dayOf(e.slot))

    // Guruhga maxsus biriktirilgan xona(lar) bor-u, dars boshqa xonaga qo'yilgan bo'lsa
    if (e.assignedRooms && e.assignedRooms.length && e.room >= 0 && !e.assignedRooms.includes(e.room)) {
      cost += W.assignedRoom
    }
    // Xona sig'imi guruh sonidan ancha ortiq bo'lmasin (+2 tolerantlik) — mos xona afzal
    const cap = e.roomCapacities ? e.roomCapacities[e.room] : null
    if (cap != null && cap - e.groupSize > 2) cost += (cap - e.groupSize - 2) * W.roomFit
  }

  const counts = []
  for (const day of perDay) {
    const pairs = day.map((e) => pairOf(e.slot))
    counts.push(day.length)
    cost += gapsInDay(pairs) * W.groupGap
    cost += consecutivePenalty(pairs) * W.consecutive
    // Kunlik darslar soni: 4 tadan oshmasin, band kunda 1 tadan iborat bo'lmasin (2 tadan kam)
    if (day.length > 4) cost += (day.length - 4) * W.groupDayMax
    else if (day.length === 1) cost += W.groupDayMin

    // Bir fan bir kunda ikkinchi (yoki undan ortiq) marta kelsa — ketma-ket bo'lsa ham,
    // orada tanaffus bo'lsa ham — talabalar uchun noqulay, boshqa kunga ko'chirilishi kerak.
    const bySubject = new Map()
    for (const e of day) bySubject.set(e.subjectId, (bySubject.get(e.subjectId) || 0) + 1)
    for (const count of bySubject.values()) {
      if (count > 1) cost += (count - 1) * W.subjectSpread
    }

    // Ikki XIL fan ketma-ket juftlikda kelmasin (masalan 2-juftlik boshqa fan,
    // 3-juftlik yana boshqa fan — talabalarga og'ir, ayniqsa til fanlarida).
    const daySorted = [...day].sort((a, b) => pairOf(a.slot) - pairOf(b.slot))
    for (let i = 1; i < daySorted.length; i++) {
      const p1 = pairOf(daySorted[i - 1].slot), p2 = pairOf(daySorted[i].slot)
      if (p2 - p1 === 1 && daySorted[i - 1].subjectId !== daySorted[i].subjectId) cost += W.subjectAdjacent
    }

    // qiyin fan (difficulty>=4) kechki juftlikda — ertalabni rag'batlantirish
    for (const e of day) {
      const p = pairOf(e.slot)
      if (e.difficulty >= 4 && p > 3) cost += (e.difficulty - 3) * (p - 3) * W.morning
    }
  }

  // kunlar bo'yicha muvozanat (kvadratlar yig'indisi minimal bo'lsa teng taqsimlanadi)
  cost += counts.reduce((s, c) => s + c * c, 0) * W.groupBalance * 0.5
  // guruh uchun xona barqarorligi
  if (rooms.size > 1) cost += (rooms.size - 1) * W.roomChange

  // Fan ketma-ket kunlarga tushmasin (masalan Dushanba+Seshanba) — kamida bitta
  // kun oralatib joylashsin (Dushanba+Chorshanba va h.k.), talabalarga qulay bo'lsin
  for (const days of subjectDays.values()) {
    const sorted = [...days].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] === 1) cost += W.subjectConsecutiveDays
    }
  }

  // Dars turi tartibi: bir fanning ma'ruza/seminar/amaliy darslari HAFTA davomida
  // to'g'ri tartibda kelsin (avval ma'ruza, keyin seminar, keyin amaliy). Slot raqami
  // (day*PAIRS+pair) haftadagi xronologik tartibga to'g'ridan-to'g'ri mos keladi.
  const bySubjectTyped = new Map() // subjectId -> [{ slot, rank }]
  for (const e of groupEvents) {
    if (e.slot < 0) continue
    const rank = TYPE_RANK[e.type]
    if (rank == null) continue
    if (!bySubjectTyped.has(e.subjectId)) bySubjectTyped.set(e.subjectId, [])
    bySubjectTyped.get(e.subjectId).push({ slot: e.slot, rank })
  }
  for (const evs of bySubjectTyped.values()) {
    for (let i = 0; i < evs.length; i++) {
      for (let j = i + 1; j < evs.length; j++) {
        const a = evs[i], b = evs[j]
        if (a.rank === b.rank) continue
        const earlier = a.slot < b.slot ? a : b, later = a.slot < b.slot ? b : a
        if (earlier.rank > later.rank) cost += W.subjectTypeOrder // teskari tartib
      }
    }
  }

  return cost
}

// Bitta o'qituvchining yumshoq jarimasi.
// Maqsad: IXCHAM hafta — kamroq ish kuni, kunda kamida 2 juftlik, derazasiz.
// (Oldingi teacherBalance darslarni kunlarga tekis yoyar edi — bu ish kunlarini
// ko'paytirib, "1 soat uchun kelish" muammosini keltirib chiqarardi.)
export function teacherCost(teacherEvents, W = WEIGHTS) {
  const perDay = Array.from({ length: DAYS }, () => [])
  for (const e of teacherEvents) {
    if (e.slot < 0) continue
    perDay[dayOf(e.slot)].push(e)
  }
  let cost = 0
  for (const day of perDay) {
    if (day.length === 0) continue
    const pairs = day.map((e) => pairOf(e.slot))
    cost += gapsInDay(pairs) * W.teacherGap // derazalar
    cost += W.teacherDay // har faol kun — kunlar soni kamaysin
    if (day.length === 1) cost += W.lonePair // yolg'iz juftlik kuni — eng yomoni
  }
  return cost
}

// Jami yumshoq jarima (to'liq o'tish — boshlang'ich qiymat va hisobot uchun)
export function totalSoft(ctx) {
  let soft = 0
  for (const evs of ctx.byGroup.values()) soft += groupCost(evs)
  for (const evs of ctx.byTeacher.values()) soft += teacherCost(evs)
  return soft
}
