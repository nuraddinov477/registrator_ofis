import { Router } from 'express'
import { prisma } from '../db.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { requireRole } from '../auth/middleware.js'
import { MAIN_HALL_MIN, MAIN_HALL_MAX } from '../engine/loadData.js'

export const potokRouter = Router()

// Berilgan (o'lchamli) guruhlar ro'yxatidan [MAIN_HALL_MIN..MAIN_HALL_MAX] oralig'iga
// (markazga yaqinroq) tushadigan ENG YAXSHI qism to'plamni topadi — subset-sum, DP
// (yig'indi bo'yicha, elementlar soniga bog'liq emas — kattaroq guruh ro'yxatlarida ham tez).
// Topilmasa (hech qanday qism to'plam oraliqqa tushmasa) — eng yaqin muqobilni qaytaradi:
// max'dan oshmaydigan eng katta yig'indi, u ham bo'lmasa — barcha guruhlar yig'indisi.
function bestCombo(items, min, max) {
  if (items.length === 0) return null
  const CAP = max + 50
  const dp = new Map([[0, []]]) // sum -> item indekslari (ENG KAM elementli variant saqlanadi)
  for (let idx = 0; idx < items.length; idx++) {
    const size = items[idx].size ?? 0
    if (size <= 0) continue
    for (const [sum, combo] of [...dp.entries()]) {
      const ns = sum + size
      if (ns > CAP) continue
      if (!dp.has(ns) || dp.get(ns).length > combo.length + 1) dp.set(ns, [...combo, idx])
    }
  }
  const mid = (min + max) / 2
  let chosen = null
  for (const [sum, combo] of dp) {
    if (sum < min || sum > max || sum === 0) continue
    if (!chosen || Math.abs(sum - mid) < Math.abs(chosen.sum - mid)) chosen = { sum, combo }
  }
  const fits = !!chosen
  if (!chosen) {
    let bestSum = -1
    for (const sum of dp.keys()) if (sum <= max && sum > bestSum) bestSum = sum
    if (bestSum <= 0) bestSum = Math.max(...dp.keys())
    chosen = { sum: bestSum, combo: dp.get(bestSum) }
  }
  return { fits, sum: chosen.sum, items: chosen.combo.map((i) => items[i]) }
}

// GET /api/potok-report?semester=1 — potok (bir nechta guruh birga) fanlar bo'yicha
// hisob-kitob: (1) mavjud potoklar va ular Katta zalga (70-100) mos keladimi, (2) umumiy
// statistika, (3) hozircha ALOHIDA o'qiladigan, lekin BIRLASHTIRILSA Katta zalga mos
// tushadigan guruh to'plamlari bo'yicha tavsiyalar. Faqat O'QISH — hech narsani o'zgartirmaydi.
potokRouter.get('/', requireRole('Super Admin', 'Fakultet operatori', 'Kafedra mudiri'), asyncHandler(async (req, res) => {
  const semester = Number(req.query.semester) || 1
  const workloads = await prisma.workload.findMany({
    where: { semester, archived: false },
    include: { groups: { include: { group: true } }, teacher: true, subject: true },
  })

  const existing = []
  const singles = [] // hali potok bo'lmagan (bitta guruhli) yuklamalar — tavsiya uchun
  for (const w of workloads) {
    const groups = w.groups.map((x) => x.group).filter(Boolean)
    if (groups.length > 1) {
      const totalSize = groups.reduce((s, g) => s + (g.size ?? 0), 0)
      const fits = totalSize >= MAIN_HALL_MIN && totalSize <= MAIN_HALL_MAX
      let note
      if (fits) note = `Katta zalga mos (${MAIN_HALL_MIN}-${MAIN_HALL_MAX} oralig'ida)`
      else if (totalSize < MAIN_HALL_MIN) note = `Katta zal uchun ${MAIN_HALL_MIN - totalSize} talaba yetishmaydi`
      else note = `Katta zal sig'imidan ${totalSize - MAIN_HALL_MAX} talaba ortiqcha`
      existing.push({
        workloadId: w.id, subject: w.subject?.name, teacher: w.teacher?.fullName, type: w.type,
        weeklyHours: w.weeklyHours, groups: groups.map((g) => ({ id: g.id, name: g.name, size: g.size })),
        totalSize, fits, note,
      })
    } else if (groups.length === 1) {
      singles.push({ workloadId: w.id, subjectId: w.subjectId, subject: w.subject?.name, teacherId: w.teacherId, teacher: w.teacher?.fullName, type: w.type, weeklyHours: w.weeklyHours, group: groups[0] })
    }
  }

  // Statistika: potok soni, jami haftalik potok-soat, va "tejalgan" xona/o'qituvchi-slot
  // soni — agar bu darslar ALOHIDA o'tilganda, har qo'shimcha guruh uchun yana bir marta
  // shu haftalik soat kerak bo'lar edi (N guruh birlashtirilsa, (N-1)*haftalikSoat tejaladi).
  const potokCount = existing.length
  const totalPotokWeeklyHours = existing.reduce((s, e) => s + e.weeklyHours, 0)
  const slotsSaved = existing.reduce((s, e) => s + (e.groups.length - 1) * e.weeklyHours, 0)
  const studentsInPotok = existing.reduce((s, e) => s + e.totalSize, 0)

  // Tavsiyalar: hali ALOHIDA o'qiladigan (bitta guruhli) yuklamalarni fan+o'qituvchi+tur
  // bo'yicha guruhlab (faqat shular jismonan BITTA darsda birlashtirilishi mumkin — xuddi
  // shu o'qituvchi bir vaqtning o'zida faqat bitta joyda bo'ladi), har klaster uchun eng
  // яхши birlashma qidiramiz.
  const clusters = new Map() // "subjectId|teacherId|type" -> singles[]
  for (const s of singles) {
    const key = `${s.subjectId}|${s.teacherId}|${s.type}`
    if (!clusters.has(key)) clusters.set(key, [])
    clusters.get(key).push(s)
  }

  const suggestions = []
  for (const [, items] of clusters) {
    if (items.length < 2) continue
    const groupItems = items.map((s) => ({ id: s.group.id, name: s.group.name, size: s.group.size ?? 0 }))
    const combo = bestCombo(groupItems, MAIN_HALL_MIN, MAIN_HALL_MAX)
    if (!combo || combo.items.length < 2) continue // yolg'iz guruh — birlashtirishga hojat yo'q
    const first = items[0]
    let note
    if (combo.fits) note = `Bu ${combo.items.length} ta guruhni birlashtirsangiz jami ${combo.sum} talaba — Katta zalga mos.`
    else if (combo.sum < MAIN_HALL_MIN) note = `Eng yaxshi birlashma ${combo.sum} talaba — Katta zal minimumi (${MAIN_HALL_MIN}) ga ${MAIN_HALL_MIN - combo.sum} yetmaydi, baribir xona/vaqt tejaydi.`
    else note = `Eng yaxshi birlashma ${combo.sum} talaba — Katta zal sig'imidan (${MAIN_HALL_MAX}) ${combo.sum - MAIN_HALL_MAX} ortiqcha, qolgan guruh(lar)ni alohida qoldiring.`
    suggestions.push({
      subject: first.subject, teacher: first.teacher, type: first.type,
      availableGroups: groupItems, suggestedGroups: combo.items, suggestedTotal: combo.sum, fits: combo.fits, note,
    })
  }
  suggestions.sort((a, b) => (b.fits - a.fits) || (b.suggestedTotal - a.suggestedTotal))

  res.json({
    semester,
    stats: { potokCount, totalPotokWeeklyHours, slotsSaved, studentsInPotok, suggestionCount: suggestions.length },
    existing,
    suggestions,
  })
}))
