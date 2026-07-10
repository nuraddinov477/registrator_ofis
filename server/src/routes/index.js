import { Router } from 'express'
import { crudRouter } from '../lib/crudRouter.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { schemas } from '../validation/schemas.js'
import { prisma, audit } from '../db.js'
import { scheduleRouter } from './schedule.js'
import { requestsRouter } from './requests.js'
import { handoverRouter } from './handover.js'
import { requireRole } from '../auth/middleware.js'
import { requireWrite, requireRead, scopeWhere as accessScopeWhere, scopeAssert as accessScopeAssert } from '../auth/access.js'
import { hashPassword } from '../auth/password.js'

const stripPassword = (u) => { const { passwordHash, ...rest } = u; return rest }

// Foydalanuvchi yozishdan oldin: password berilgan bo'lsa hash qilib passwordHash'ga o'tkazamiz,
// password maydonini olib tashlaymiz (u DB ustuni emas). Bo'sh parolda passwordHash tegilmaydi.
const userTransform = async (data) => {
  if (data.password) data.passwordHash = await hashPassword(data.password)
  delete data.password
  return data
}

// Resurslar konfiguratsiyasi — har bir entity bitta qatorda
const resources = [
  { path: 'faculties', model: 'faculty', label: 'Fakultet', schema: schemas.faculty },
  { path: 'departments', model: 'department', label: 'Kafedra', schema: schemas.department, include: { faculty: true } },
  { path: 'specialties', model: 'specialty', label: "Yo'nalish", schema: schemas.specialty, include: { faculty: true } },
  { path: 'teachers', model: 'teacher', label: "O'qituvchi", schema: schemas.teacher, include: { department: true } },
  { path: 'subjects', model: 'subject', label: 'Fan', schema: schemas.subject },
  { path: 'groups', model: 'group', label: 'Guruh', schema: schemas.group, include: { faculty: true, specialty: true } },
  { path: 'buildings', model: 'building', label: 'Bino', schema: schemas.building },
  { path: 'rooms', model: 'room', label: 'Xona', schema: schemas.room, include: { building: true } },
  { path: 'room-permissions', model: 'roomPermission', label: 'Xona ruxsati', schema: schemas.roomPermission, include: { room: true, teacher: true, group: true, specialty: true } },
  { path: 'workloads', model: 'workload', label: 'Yuklama', schema: schemas.workload, include: { group: true, teacher: true, subject: true } },
  // Foydalanuvchilar: faqat Super Admin ko'radi va o'zgartiradi, parol hech qachon qaytarilmaydi
  { path: 'users', model: 'user', label: 'Foydalanuvchi', schema: schemas.user, sanitize: stripPassword, transform: userTransform },
]

export function buildRoutes() {
  const router = Router()

  // Almashtirish ustasi (dekret/ta'til) — /teachers/:id/handover-plan va /handover.
  // CRUD marshrutlaridan oldin: yo'llar 2 segmentli, to'qnashuv yo'q.
  router.use('/teachers', handoverRouter())

  for (const r of resources) {
    router.use(
      `/${r.path}`,
      crudRouter({
        model: r.model, label: r.label,
        createSchema: r.schema, updateSchema: r.schema.partial(),
        include: r.include, sanitize: r.sanitize, transform: r.transform,
        // Rol-huquq: o'qish/yozish ruxsati + har rol faqat o'z birligi ma'lumotini ko'radi
        readGuard: [requireRead(r.path)],
        writeGuard: [requireWrite(r.path)],
        scopeWhere: (user) => accessScopeWhere(r.path, user),
        scopeAssert: (user, data, existing) => accessScopeAssert(r.path, user, data, existing),
      }),
    )
  }

  // Jadval optimallashtirish engine
  router.use('/schedule', scheduleRouter)

  // Kafedralararo ariza (o'qituvchi/dars so'rovi)
  router.use('/requests', requestsRouter())

  // Audit logi — tizimdagi barcha o'zgarishlar tarixi.
  // Faqat Super Admin ko'radi. Tarix hech qachon avtomatik o'chmaydi —
  // faqat Super Admin qo'lda o'chirsagina o'chadi (butun tarix qaytariladi, cheklovsiz).
  router.get('/audit', requireRole('Super Admin'), asyncHandler(async (req, res) => {
    res.json(await prisma.auditLog.findMany({ orderBy: { id: 'desc' } }))
  }))

  // Bitta yozuvni o'chirish — faqat Super Admin
  router.delete('/audit/:id', requireRole('Super Admin'), asyncHandler(async (req, res) => {
    await prisma.auditLog.delete({ where: { id: Number(req.params.id) } })
    res.status(204).end()
  }))

  // Butun tarixni tozalash — faqat Super Admin. Tozalash amali izi qoladi (hisobdorlik uchun).
  router.delete('/audit', requireRole('Super Admin'), asyncHandler(async (req, res) => {
    const { count } = await prisma.auditLog.deleteMany({})
    await audit('Tozalandi: Audit logi', `${count} ta yozuv o'chirildi`, req)
    res.json({ deleted: count })
  }))

  // Statistika — Dashboard uchun
  router.get('/stats', asyncHandler(async (req, res) => {
    const [faculties, departments, teachers, subjects, groups, rooms, workloads] = await Promise.all([
      prisma.faculty.count(), prisma.department.count(), prisma.teacher.count(),
      prisma.subject.count(), prisma.group.count(), prisma.room.count(), prisma.workload.count(),
    ])
    res.json({ faculties, departments, teachers, subjects, groups, rooms, workloads })
  }))

  return router
}
