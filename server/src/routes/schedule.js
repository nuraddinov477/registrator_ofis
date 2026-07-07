import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler.js'
import { prisma, audit } from '../db.js'
import { requireRole } from '../auth/middleware.js'
import { restrictionBlocks } from '../auth/access.js'
import { startGenerateJob } from '../engine/jobRunner.js'
import { DAY_NAMES, DAYS, PAIRS } from '../engine/timeslots.js'

export const scheduleRouter = Router()

// POST /api/schedule/generate  — fon jobni boshlaydi, darhol runId qaytaradi.
// Faqat Super Admin va Fakultet operatori jadval yaratadi.
// Holatni /runs/:id orqali kuzating (status: running → done/failed).
scheduleRouter.post('/generate', requireRole('Super Admin', 'Fakultet operatori'), asyncHandler(async (req, res) => {
  if (restrictionBlocks(req.user, 'schedule', 'write')) return res.status(403).json({ error: 'Ruxsat yetarli emas (cheklangan)' })
  const semester = Number(req.body?.semester) || 1
  const maxMs = Math.min(120_000, Number(req.body?.maxMs) || 5000)

  const run = await prisma.schedulingRun.create({ data: { semester, status: 'running' } })
  startGenerateJob({ runId: run.id, semester, maxMs })
  await audit('Jadval generatsiyasi boshlandi', `run #${run.id}`, req)

  res.status(202).json({
    runId: run.id,
    status: 'running',
    semester,
    poll: `/api/schedule/runs/${run.id}`,
  })
}))

// GET /api/schedule/runs  — yaratilgan jadvallar ro'yxati
scheduleRouter.get('/runs', asyncHandler(async (req, res) => {
  const runs = await prisma.schedulingRun.findMany({
    orderBy: { id: 'desc' },
    include: { _count: { select: { entries: true } } },
  })
  res.json(runs.map((r) => ({
    id: r.id, semester: r.semester, status: r.status,
    hardScore: r.hardScore, softScore: r.softScore,
    entries: r._count.entries, createdAt: r.createdAt,
  })))
}))

// GET /api/schedule/runs/:id  — topshiriq formatidagi yakuniy jadval
scheduleRouter.get('/runs/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const run = await prisma.schedulingRun.findUnique({ where: { id } })
  if (!run) return res.status(404).json({ error: 'Run topilmadi' })
  const entries = await prisma.scheduleEntry.findMany({ where: { runId: id }, orderBy: { id: 'asc' } })
  // Topshiriq chiqish formati: { group_id, teacher_id, subject_id, room_id, day, pair }
  res.json({
    run,
    schedule: entries.map((e) => ({
      group_id: e.groupId, teacher_id: e.teacherId, subject_id: e.subjectId,
      room_id: e.roomId, day: e.day, pair: e.pair,
    })),
  })
}))

// GET /api/schedule/runs/:id/grid?groupId=  — bitta guruh jadvali (nomlar bilan)
scheduleRouter.get('/runs/:id/grid', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const groupId = Number(req.query.groupId)
  if (!groupId) return res.status(400).json({ error: 'groupId kerak' })

  const entries = await prisma.scheduleEntry.findMany({ where: { runId: id, groupId } })
  const [subjects, teachers, rooms] = await Promise.all([
    prisma.subject.findMany(), prisma.teacher.findMany(), prisma.room.findMany(),
  ])
  const sName = new Map(subjects.map((x) => [x.id, x.name]))
  const tName = new Map(teachers.map((x) => [x.id, x.fullName]))
  const rName = new Map(rooms.map((x) => [x.id, x.name]))

  const grid = Array.from({ length: PAIRS }, () => Array(DAYS).fill(null))
  for (const e of entries) {
    grid[e.pair - 1][e.day] = { subject: sName.get(e.subjectId), teacher: tName.get(e.teacherId), room: rName.get(e.roomId) }
  }
  res.json({ days: DAY_NAMES, grid })
}))

// GET /api/schedule/runs/:id/teacher-grid?teacherId=  — o'qituvchining o'z jadvali.
// Oʻqituvchi rolida teacherId doim o'ziniki (query e'tiborsiz) — faqat o'z jadvalini ko'radi.
scheduleRouter.get('/runs/:id/teacher-grid', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const isTeacher = req.user?.role === 'Oʻqituvchi'
  const teacherId = isTeacher ? req.user?.teacherId : Number(req.query.teacherId)
  if (!teacherId) return res.status(400).json({ error: "teacherId kerak (yoki akkauntingiz o'qituvchiga bog'lanmagan)" })

  const entries = await prisma.scheduleEntry.findMany({ where: { runId: id, teacherId: Number(teacherId) } })
  const [subjects, groups, rooms] = await Promise.all([
    prisma.subject.findMany(), prisma.group.findMany(), prisma.room.findMany(),
  ])
  const sName = new Map(subjects.map((x) => [x.id, x.name]))
  const gName = new Map(groups.map((x) => [x.id, x.name]))
  const rName = new Map(rooms.map((x) => [x.id, x.name]))

  const grid = Array.from({ length: PAIRS }, () => Array(DAYS).fill(null))
  for (const e of entries) {
    grid[e.pair - 1][e.day] = { subject: sName.get(e.subjectId), group: gName.get(e.groupId), room: rName.get(e.roomId) }
  }
  res.json({ days: DAY_NAMES, grid })
}))
