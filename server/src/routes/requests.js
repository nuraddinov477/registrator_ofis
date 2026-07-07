import { Router } from 'express'
import { prisma, audit } from '../db.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { requireRole } from '../auth/middleware.js'
import { AccessError, isSuperAdmin, restrictionBlocks } from '../auth/access.js'

// Ariza yarata/javob bera oladigan rollar (o'qituvchi arizalar bilan ishlamaydi)
const CAN_ACT = ['Super Admin', 'Fakultet operatori', 'Kafedra mudiri']
const requireActor = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' })
  if (!CAN_ACT.includes(req.user.role)) return res.status(403).json({ error: 'Ruxsat yetarli emas' })
  // Super Admin qo'ygan shaxsiy cheklov (readOnly yoki "requests" taqiqi)
  if (restrictionBlocks(req.user, 'requests', 'write')) return res.status(403).json({ error: 'Ruxsat yetarli emas (cheklangan)' })
  next()
}

// Kafedra user qamrovida ekanini tekshiradi: mudir → o'z kafedrasi, operator → o'z fakulteti kafedrasi
async function assertDeptInScope(user, departmentId, label) {
  if (isSuperAdmin(user)) return
  if (departmentId == null) throw new AccessError(`${label} kafedra ko'rsatilmagan`, 400)
  if (user.role === 'Kafedra mudiri') {
    if (user.departmentId == null) throw new AccessError('Sizga kafedra biriktirilmagan')
    if (Number(departmentId) !== user.departmentId) throw new AccessError(`${label} sizning kafedrangiz emas`)
  } else if (user.role === 'Fakultet operatori') {
    if (user.facultyId == null) throw new AccessError('Sizga fakultet biriktirilmagan')
    const dept = await prisma.department.findUnique({ where: { id: Number(departmentId) } })
    if (!dept || dept.facultyId !== user.facultyId) throw new AccessError(`${label} sizning fakultetingizda emas`)
  }
}

// Kafedralararo ariza (o'qituvchi/dars so'rovi) marshrutlari.
// Butun tarix bazada saqlanadi — hech narsa o'chmaydi (o'chirish faqat Super Admin).
export function requestsRouter() {
  const router = Router()

  const include = {
    fromDepartment: true,
    toDepartment: true,
    teacher: true,
    subject: true,
    room: true,
  }

  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
  const str = (v) => (v === undefined || v === null || v === '' ? null : String(v).trim())
  // URL'dagi id ni butun songa aylantiradi; noto'g'ri bo'lsa null (→ 400)
  const id = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null }

  // Ro'yxat — eng yangisi yuqorida. ?status= va ?q= filtrlash mumkin.
  router.get('/', asyncHandler(async (req, res) => {
    const where = {}
    const status = (req.query.status ?? '').toString().trim()
    if (status && status !== 'all') where.status = status
    const rows = await prisma.teachingRequest.findMany({ where, include, orderBy: { createdAt: 'desc' } })
    const q = (req.query.q ?? '').toString().toLowerCase().trim()
    const filtered = q ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)) : rows
    res.json(filtered)
  }))

  // Bitta ariza
  router.get('/:id', asyncHandler(async (req, res) => {
    const rid = id(req.params.id)
    if (!rid) return res.status(400).json({ error: "Noto'g'ri id" })
    const row = await prisma.teachingRequest.findUnique({ where: { id: rid }, include })
    if (!row) return res.status(404).json({ error: 'Topilmadi' })
    res.json(row)
  }))

  // Yangi ariza — status doim "pending", kim yaratgani saqlanadi
  router.post('/', requireActor, asyncHandler(async (req, res) => {
    const b = req.body || {}
    const from = num(b.fromDepartmentId)
    const to = num(b.toDepartmentId)
    if (!from || !to) {
      return res.status(400).json({ error: 'Yuboruvchi va qabul qiluvchi kafedra majburiy' })
    }
    if (from === to) {
      return res.status(400).json({ error: "Kafedra o'ziga ariza yubora olmaydi" })
    }
    // Yuboruvchi kafedra user qamrovida bo'lishi kerak (mudir → o'z kafedrasi)
    await assertDeptInScope(req.user, from, 'Yuboruvchi')
    const row = await prisma.teachingRequest.create({
      data: {
        fromDepartmentId: from,
        toDepartmentId: to,
        teacherId: num(b.teacherId),
        subjectId: num(b.subjectId),
        roomId: num(b.roomId),
        course: num(b.course),
        targetGroups: str(b.targetGroups),
        weeklyHours: num(b.weeklyHours),
        message: str(b.message),
        status: 'pending',
        createdBy: req.user?.login ?? null,
      },
      include,
    })
    await audit('Ariza: yangi', `${row.fromDepartment?.name ?? '—'} → ${row.toDepartment?.name ?? '—'}`, req)
    res.status(201).json(row)
  }))

  // Javob berish — qabul yoki rad. Tarix uchun: kim, qachon, izoh.
  router.post('/:id/respond', requireActor, asyncHandler(async (req, res) => {
    const rid = id(req.params.id)
    if (!rid) return res.status(400).json({ error: "Noto'g'ri id" })
    const b = req.body || {}
    const decision = String(b.status ?? '').trim()
    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: "Holat 'accepted' yoki 'rejected' bo'lishi kerak" })
    }
    const existing = await prisma.teachingRequest.findUnique({ where: { id: rid } })
    if (!existing) return res.status(404).json({ error: 'Topilmadi' })
    // Faqat qabul qiluvchi kafedra (yoki uning fakulteti operatori/Super Admin) javob bera oladi
    await assertDeptInScope(req.user, existing.toDepartmentId, 'Qabul qiluvchi')
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'Bu arizaga allaqachon javob berilgan' })
    }
    const row = await prisma.teachingRequest.update({
      where: { id: rid },
      data: {
        status: decision,
        responseNote: str(b.note),
        respondedBy: req.user?.login ?? null,
        respondedAt: new Date(),
      },
      include,
    })
    const label = decision === 'accepted' ? 'qabul qilindi' : 'rad etildi'
    await audit('Ariza: javob', `#${row.id} ${label} (${row.toDepartment?.name ?? '—'})`, req)
    res.json(row)
  }))

  // O'chirish — tarixni saqlash uchun faqat Super Admin
  router.delete('/:id', requireRole('Super Admin'), asyncHandler(async (req, res) => {
    const rid = id(req.params.id)
    if (!rid) return res.status(400).json({ error: "Noto'g'ri id" })
    try {
      await prisma.teachingRequest.delete({ where: { id: rid } })
    } catch {
      return res.status(404).json({ error: 'Topilmadi' })
    }
    await audit("Ariza: o'chirildi", `#${rid}`, req)
    res.status(204).end()
  }))

  return router
}
