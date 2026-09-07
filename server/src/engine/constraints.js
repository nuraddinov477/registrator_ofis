import { DAYS, dayOf, pairOf } from './timeslots.js'

// Yumshoq cheklash vaznlari (sozlanadigan). Qattiq cheklash Occupancy.hard orqali.
export const WEIGHTS = {
  teacherGap: 6, // o'qituvchi "derazasi" (eng og'riqli)
  groupGap: 3, // guruh oynalari
  consecutive: 3, // 4 tadan ortiq ketma-ket dars (har ortig'i)
  subjectSpread: 4, // bir fan bir kunda takror
  subjectConsecutiveDays: 5, // bir fan ketma-ket kunlarga tushsa (masalan Dush+Sesh) — talabalarga qulay bo'lishi uchun oralatib qo'yish kerak
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
  for (const e of groupEvents) {
    if (e.slot < 0) continue
    perDay[dayOf(e.slot)].push(e)
    rooms.add(e.room)
    if (!subjectDays.has(e.subjectId)) subjectDays.set(e.subjectId, new Set())
    subjectDays.get(e.subjectId).add(dayOf(e.slot))
  }

  let cost = 0
  const counts = []
  for (const day of perDay) {
    const pairs = day.map((e) => pairOf(e.slot))
    counts.push(day.length)
    cost += gapsInDay(pairs) * W.groupGap
    cost += consecutivePenalty(pairs) * W.consecutive

    // bir fan bir kunda takrorlansa
    const seen = new Map()
    for (const e of day) seen.set(e.subjectId, (seen.get(e.subjectId) || 0) + 1)
    for (const n of seen.values()) if (n > 1) cost += (n - 1) * W.subjectSpread

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
