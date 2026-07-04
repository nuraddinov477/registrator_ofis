import { Router } from 'express'
import { crudRouter } from '../lib/crudRouter.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { schemas } from '../validation/schemas.js'
import { prisma } from '../db.js'
import { scheduleRouter } from './schedule.js'
import { requestsRouter } from './requests.js'
import { requireRole } from '../auth/middleware.js'

const stripPassword = (u) => { const { passwordHash, ...rest } = u; return rest }

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
  // Foydalanuvchilar: faqat Super Admin o'zgartiradi, parol hech qachon qaytarilmaydi
  { path: 'users', model: 'user', label: 'Foydalanuvchi', schema: schemas.user, mutationGuard: [requireRole('Super Admin')], sanitize: stripPassword },
]

export function buildRoutes() {
  const router = Router()

  for (const r of resources) {
    router.use(
      `/${r.path}`,
      crudRouter({
        model: r.model, label: r.label,
        createSchema: r.schema, updateSchema: r.schema.partial(),
        include: r.include, mutationGuard: r.mutationGuard, sanitize: r.sanitize,
      }),
    )
  }

  // Jadval optimallashtirish engine
  router.use('/schedule', scheduleRouter)

  // Kafedralararo ariza (o'qituvchi/dars so'rovi)
  router.use('/requests', requestsRouter())

  // Audit logi — faqat o'qish uchun
  router.get('/audit', asyncHandler(async (req, res) => {
    res.json(await prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: 200 }))
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
