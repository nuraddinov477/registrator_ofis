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
    grid[e.pair - 1][e.day] = {
      id: e.id,
      subject: sName.get(e.subjectId), teacher: tName.get(e.teacherId), room: rName.get(e.roomId),
      subjectId: e.subjectId, teacherId: e.teacherId, roomId: e.roomId,
    }
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

// GET /api/schedule/runs/:id/teacher-availability
// Barcha o'qituvchilarning bandlik matritsasi: har biri uchun PAIRS×DAYS grid.
// Hujayra null → bo'sh (dars yo'q), aks holda { subject, group, room } → band.
scheduleRouter.get('/runs/:id/teacher-availability', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const run = await prisma.schedulingRun.findUnique({ where: { id } })
  if (!run) return res.status(404).json({ error: 'Run topilmadi' })

  const [entries, teachers, subjects, groups, rooms] = await Promise.all([
    prisma.scheduleEntry.findMany({ where: { runId: id } }),
    prisma.teacher.findMany({ orderBy: { fullName: 'asc' } }),
    prisma.subject.findMany(), prisma.group.findMany(), prisma.room.findMany(),
  ])
  const sName = new Map(subjects.map((x) => [x.id, x.name]))
  const gName = new Map(groups.map((x) => [x.id, x.name]))
  const rName = new Map(rooms.map((x) => [x.id, x.name]))

  // Har o'qituvchi uchun bo'sh grid tayyorlaymiz (band = dars kiritilgan slot)
  const byTeacher = new Map(teachers.map((t) => [t.id, {
    id: t.id, name: t.fullName, busy: 0,
    grid: Array.from({ length: PAIRS }, () => Array(DAYS).fill(null)),
  }]))
  for (const e of entries) {
    const t = byTeacher.get(e.teacherId)
    if (!t) continue
    if (t.grid[e.pair - 1][e.day] == null) t.busy++
    t.grid[e.pair - 1][e.day] = { subject: sName.get(e.subjectId), group: gName.get(e.groupId), room: rName.get(e.roomId) }
  }
  const total = PAIRS * DAYS
  const result = [...byTeacher.values()].map((t) => ({ ...t, free: total - t.busy }))
  res.json({ days: DAY_NAMES, pairs: PAIRS, teachers: result })
}))

// ─────────────────────────── Qo'lda tahrirlash (faqat Super Admin) ───────────────────────────
// Tizim avval avtomatik jadval tuzadi; keyin Super Admin xatolarni qo'lda to'g'irlaydi.
// Qattiq qoida: bitta slotda (day,pair) bitta guruh / o'qituvchi / xona faqat bitta darsda
// bo'la oladi. To'qnashuv bo'lsa 409 "Bu mumkin emas" qaytariladi (saqlanmaydi).

const isValidSlot = (day, pair) =>
  Number.isInteger(day) && day >= 0 && day < DAYS && Number.isInteger(pair) && pair >= 1 && pair <= PAIRS

// Shu slotda guruh/o'qituvchi/xona bandmi? Band bo'lganlarning ro'yxatini (sabab) qaytaradi.
async function slotConflicts({ runId, day, pair, groupId, teacherId, roomId, excludeId }) {
  const clashes = await prisma.scheduleEntry.findMany({
    where: {
      runId, day, pair,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ groupId }, { teacherId }, { roomId }],
    },
  })
  const reasons = []
  if (clashes.some((c) => c.groupId === groupId)) reasons.push('guruh')
  if (clashes.some((c) => c.teacherId === teacherId)) reasons.push("o'qituvchi")
  if (clashes.some((c) => c.roomId === roomId)) reasons.push('xona')
  return reasons
}

const conflictMsg = (reasons) => `Bu mumkin emas: shu vaqtda ${reasons.join(', ')} band`

// POST /api/schedule/runs/:id/entries  — bo'sh slotga yangi dars qo'shish
scheduleRouter.post('/runs/:id/entries', requireRole('Super Admin'), asyncHandler(async (req, res) => {
  const runId = Number(req.params.id)
  const run = await prisma.schedulingRun.findUnique({ where: { id: runId } })
  if (!run) return res.status(404).json({ error: 'Run topilmadi' })
  const { groupId, subjectId, teacherId, roomId, day, pair } = req.body || {}
  for (const [k, v] of Object.entries({ groupId, subjectId, teacherId, roomId })) {
    if (!Number.isInteger(v)) return res.status(400).json({ error: `Maydon kerak: ${k}` })
  }
  if (!isValidSlot(day, pair)) return res.status(400).json({ error: "Kun/juftlik noto'g'ri" })
  const reasons = await slotConflicts({ runId, day, pair, groupId, teacherId, roomId })
  if (reasons.length) return res.status(409).json({ error: conflictMsg(reasons) })
  const entry = await prisma.scheduleEntry.create({ data: { runId, groupId, subjectId, teacherId, roomId, day, pair } })
  await audit("Jadvalga dars qo'shildi", `run #${runId} · ${DAY_NAMES[day]} ${pair}-juft`, req)
  res.status(201).json(entry)
}))

// PUT /api/schedule/runs/:id/entries/:entryId  — darsni o'zgartirish yoki boshqa slotga ko'chirish
scheduleRouter.put('/runs/:id/entries/:entryId', requireRole('Super Admin'), asyncHandler(async (req, res) => {
  const runId = Number(req.params.id)
  const entryId = Number(req.params.entryId)
  const existing = await prisma.scheduleEntry.findFirst({ where: { id: entryId, runId } })
  if (!existing) return res.status(404).json({ error: 'Dars topilmadi' })
  const merged = {
    groupId: req.body?.groupId ?? existing.groupId,
    subjectId: req.body?.subjectId ?? existing.subjectId,
    teacherId: req.body?.teacherId ?? existing.teacherId,
    roomId: req.body?.roomId ?? existing.roomId,
    day: req.body?.day ?? existing.day,
    pair: req.body?.pair ?? existing.pair,
  }
  if (!isValidSlot(merged.day, merged.pair)) return res.status(400).json({ error: "Kun/juftlik noto'g'ri" })
  const reasons = await slotConflicts({ runId, ...merged, excludeId: entryId })
  if (reasons.length) return res.status(409).json({ error: conflictMsg(reasons) })
  const entry = await prisma.scheduleEntry.update({ where: { id: entryId }, data: merged })
  await audit('Jadval darsi tahrirlandi', `run #${runId} · ${DAY_NAMES[merged.day]} ${merged.pair}-juft`, req)
  res.json(entry)
}))

// DELETE /api/schedule/runs/:id/entries/:entryId  — darsni o'chirish
scheduleRouter.delete('/runs/:id/entries/:entryId', requireRole('Super Admin'), asyncHandler(async (req, res) => {
  const runId = Number(req.params.id)
  const entryId = Number(req.params.entryId)
  const existing = await prisma.scheduleEntry.findFirst({ where: { id: entryId, runId } })
  if (!existing) return res.status(404).json({ error: 'Dars topilmadi' })
  await prisma.scheduleEntry.delete({ where: { id: entryId } })
  await audit("Jadvaldan dars o'chirildi", `run #${runId}`, req)
  res.status(204).end()
}))
