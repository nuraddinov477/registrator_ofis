import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler.js'
import { prisma, audit } from '../db.js'
import { requireWrite } from '../auth/access.js'

// ─────────────────────── Almashtirish ustasi (dekret/ta'til) ───────────────────────
// O'qituvchi dekret/ta'tilga chiqqanda uning BARCHA yuklamalari bir amalda
// kafedradoshlariga o'tkaziladi. Tizim har yuklama uchun eng mos hamkasbni taklif
// qiladi: shu fanni o'qitadigan va yuklamasi eng kam bo'lgan (faol) o'qituvchi.
// Ruxsat: Super Admin va Kafedra mudiri (faqat o'z kafedrasi — chetga 404).

const GONE_STATUSES = ['dekret', "ta'til"]

// Mudir faqat o'z kafedrasidagi o'qituvchini almashtira oladi
function inScope(user, teacher) {
  if (user.role !== 'Kafedra mudiri') return true
  return user.departmentId != null && teacher.departmentId === user.departmentId
}

// Kafedradosh faol o'qituvchilar + ularning jami soatlari va fanlar to'plami
async function loadColleagues(teacher) {
  const list = await prisma.teacher.findMany({
    where: { departmentId: teacher.departmentId, id: { not: teacher.id }, status: 'faol' },
    include: { workloads: { select: { weeklyHours: true, subjectId: true } } },
  })
  return list.map((t) => ({
    id: t.id,
    fullName: t.fullName,
    position: t.position,
    totalHours: t.workloads.reduce((s, w) => s + w.weeklyHours, 0),
    subjectIds: [...new Set(t.workloads.map((w) => w.subjectId))],
  }))
}

export function handoverRouter() {
  const router = Router()

  // GET /api/teachers/:id/handover-plan — yuklamalar ro'yxati + har biriga tavsiya
  router.get('/:id/handover-plan', requireWrite('teachers'), asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const teacher = await prisma.teacher.findUnique({
      where: { id },
      include: { department: true, workloads: { include: { group: true, subject: true } } },
    })
    if (!teacher || !inScope(req.user, teacher)) return res.status(404).json({ error: "O'qituvchi topilmadi" })

    const colleagues = await loadColleagues(teacher)
    const workloads = teacher.workloads.map((w) => {
      // Tavsiya tartibi: shu fanni o'qitadiganlar oldinda, ichida — soati eng kami
      const ranked = [...colleagues].sort((a, b) => {
        const at = a.subjectIds.includes(w.subjectId) ? 0 : 1
        const bt = b.subjectIds.includes(w.subjectId) ? 0 : 1
        return at - bt || a.totalHours - b.totalHours
      })
      return {
        id: w.id,
        group: w.group?.name,
        subject: w.subject?.name,
        subjectId: w.subjectId,
        weeklyHours: w.weeklyHours,
        semester: w.semester,
        suggestedTeacherId: ranked[0]?.id ?? null,
      }
    })

    res.json({
      teacher: { id: teacher.id, fullName: teacher.fullName, status: teacher.status, department: teacher.department?.name },
      workloads,
      candidates: colleagues,
    })
  }))

  // POST /api/teachers/:id/handover — { status, assignments: [{ workloadId, toTeacherId }] }
  // Hammasi bitta tranzaksiyada: yuklamalar to'liq taqsimlanmasa — hech narsa o'zgarmaydi.
  router.post('/:id/handover', requireWrite('teachers'), asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const status = req.body?.status
    const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : []
    if (!GONE_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status "${GONE_STATUSES.join('" yoki "')}" bo'lishi kerak` })
    }

    const teacher = await prisma.teacher.findUnique({ where: { id }, include: { workloads: true } })
    if (!teacher || !inScope(req.user, teacher)) return res.status(404).json({ error: "O'qituvchi topilmadi" })

    // Kamchiliksiz taqsimlash: har bir mavjud yuklamaga qabul qiluvchi ko'rsatilishi shart
    const byWorkload = new Map(assignments.map((a) => [Number(a.workloadId), Number(a.toTeacherId)]))
    const leftover = teacher.workloads.filter((w) => !byWorkload.get(w.id))
    if (leftover.length > 0) {
      return res.status(400).json({ error: `Taqsimlanmagan yuklamalar bor (${leftover.length} ta) — har biriga qabul qiluvchi tanlang` })
    }

    // Qabul qiluvchilar: faol, o'zi emas, mudir uchun — o'z kafedrasidan
    const targetIds = [...new Set([...byWorkload.values()])]
    const targets = await prisma.teacher.findMany({ where: { id: { in: targetIds } } })
    const targetMap = new Map(targets.map((t) => [t.id, t]))
    for (const tid of targetIds) {
      const t = targetMap.get(tid)
      if (!t || t.id === teacher.id || t.status !== 'faol' || !inScope(req.user, t)) {
        return res.status(400).json({ error: `Qabul qiluvchi noto'g'ri (id=${tid}): faol kafedradosh bo'lishi kerak` })
      }
    }

    await prisma.$transaction([
      ...teacher.workloads.map((w) =>
        prisma.workload.update({ where: { id: w.id }, data: { teacherId: byWorkload.get(w.id) } })),
      prisma.teacher.update({ where: { id }, data: { status } }),
    ])

    const detail = teacher.workloads
      .map((w) => `#${w.id}→${targetMap.get(byWorkload.get(w.id))?.fullName}`)
      .join(', ')
    await audit(`Almashtirish (${status})`, `${teacher.fullName}: ${teacher.workloads.length} ta yuklama taqsimlandi: ${detail}`, req)

    res.json({ moved: teacher.workloads.length, teacherId: id, status })
  }))

  return router
}
