import { Router } from 'express'
import { prisma } from '../db.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { requireRole } from '../auth/middleware.js'
import { LARGE_ROOM_CAPACITY, MAIN_HALL_MIN, MAIN_HALL_MAX, lessonParts } from '../engine/loadData.js'

export const potokRouter = Router()

// GET /api/potok-report?semester=1 — potok (bir nechta guruh birga) fanlar bo'yicha
// hisob-kitob: FAQAT mavjud Yuklamaga asoslanadi (tavsiya/taxmin YO'Q) — har bir potok
// va u Katta zalga (65-105 talaba) mos keladimi, va umumiy statistika. Faqat O'QISH —
// hech narsani o'zgartirmaydi.
potokRouter.get('/', requireRole('Super Admin', 'Fakultet operatori', 'Kafedra mudiri'), asyncHandler(async (req, res) => {
  const semester = Number(req.query.semester) || 1
  const workloads = await prisma.workload.findMany({
    where: { semester, archived: false },
    include: { groups: { include: { group: true }, orderBy: { groupId: 'asc' } }, teacher: true, subject: true },
    orderBy: { id: 'asc' },
  })

  const existing = []
  for (const w of workloads) {
    const groups = w.groups.map((x) => x.group).filter(Boolean)
    if (groups.length <= 1) continue
    const totalSize = groups.reduce((s, g) => s + (g.size ?? 0), 0)
    // Qayerda o'tadi (generatsiya qoidalari bilan bir xil): katta zal faqat 65-105 talabali sinfga,
    // katta seminar sinfi ikkiga bo'linadi, kichik potok — oddiy xonada
    const sizeOf = (g) => g.size ?? 0
    const parts = lessonParts(groups, w.type || 'Amaliy', sizeOf)
    let placement, note
    if (parts.length > 1) {
      placement = 'split'
      const halves = parts.map((p) => `${p.length} guruh, ${p.reduce((s, g) => s + sizeOf(g), 0)} talaba`).join(' va ')
      note = `Seminar — sinf ikkiga bo'linadi (${halves}), har yarmi oddiy xonada`
    } else if (totalSize >= MAIN_HALL_MIN && totalSize <= MAIN_HALL_MAX) {
      placement = 'hall'
      note = `Katta zalda o'tadi (${MAIN_HALL_MIN}-${MAIN_HALL_MAX} oralig'ida)`
    } else if (totalSize <= LARGE_ROOM_CAPACITY) {
      placement = 'regular'
      note = `Oddiy xonada o'tadi — katta zal uchun ${MAIN_HALL_MIN - totalSize} talaba kam`
    } else if (totalSize < MAIN_HALL_MIN) {
      placement = 'between'
      note = `${totalSize} talaba: oddiy xonaga ko'p (${LARGE_ROOM_CAPACITY} gacha), katta zal uchun ${MAIN_HALL_MIN - totalSize} talaba kam — potok tarkibini o'zgartiring`
    } else {
      placement = 'too_big'
      note = `Katta zal sig'imidan ${totalSize - MAIN_HALL_MAX} talaba ortiqcha — potokni bo'ling`
    }
    existing.push({
      workloadId: w.id, subject: w.subject?.name, teacher: w.teacher?.fullName, type: w.type,
      weeklyHours: w.weeklyHours, groups: groups.map((g) => ({ id: g.id, name: g.name, size: g.size })),
      totalSize, fits: placement === 'hall', placement,
      split: parts.length > 1 ? parts.map((p) => p.map((g) => g.id)) : null,
      note,
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
