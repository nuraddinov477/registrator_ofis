import { Router } from 'express'
import { prisma } from '../db.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { requireRole } from '../auth/middleware.js'
import { MAIN_HALL_MIN, MAIN_HALL_MAX } from '../engine/loadData.js'

export const potokRouter = Router()

// GET /api/potok-report?semester=1 — potok (bir nechta guruh birga) fanlar bo'yicha
// hisob-kitob: FAQAT mavjud Yuklamaga asoslanadi (tavsiya/taxmin YO'Q) — har bir potok
// va u Katta zalga (65-105 talaba) mos keladimi, va umumiy statistika. Faqat O'QISH —
// hech narsani o'zgartirmaydi.
potokRouter.get('/', requireRole('Super Admin', 'Fakultet operatori', 'Kafedra mudiri'), asyncHandler(async (req, res) => {
  const semester = Number(req.query.semester) || 1
  const workloads = await prisma.workload.findMany({
    where: { semester, archived: false },
    include: { groups: { include: { group: true } }, teacher: true, subject: true },
  })

  const existing = []
  for (const w of workloads) {
    const groups = w.groups.map((x) => x.group).filter(Boolean)
    if (groups.length <= 1) continue
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
  }

  // Statistika: potok soni, jami haftalik potok-soat, va "tejalgan" xona/o'qituvchi-slot
  // soni — agar bu darslar ALOHIDA o'tilganda, har qo'shimcha guruh uchun yana bir marta
  // shu haftalik soat kerak bo'lar edi (N guruh birlashtirilsa, (N-1)*haftalikSoat tejaladi).
  const potokCount = existing.length
  const totalPotokWeeklyHours = existing.reduce((s, e) => s + e.weeklyHours, 0)
  const slotsSaved = existing.reduce((s, e) => s + (e.groups.length - 1) * e.weeklyHours, 0)
  const studentsInPotok = existing.reduce((s, e) => s + e.totalSize, 0)

  res.json({
    semester,
    stats: { potokCount, totalPotokWeeklyHours, slotsSaved, studentsInPotok },
    existing,
  })
}))
