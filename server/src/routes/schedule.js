import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler.js'
import { prisma, audit } from '../db.js'
import { requireRole } from '../auth/middleware.js'
import { restrictionBlocks } from '../auth/access.js'
import { startGenerateJob } from '../engine/jobRunner.js'
import { loadData, LARGE_ROOM_CAPACITY, MAIN_HALL_MIN, MAIN_HALL_MAX } from '../engine/loadData.js'
import { buildDiagnostics } from '../engine/solve.js'
import { DAY_NAMES, DAYS, PAIRS } from '../engine/timeslots.js'

export const scheduleRouter = Router()

// req.body.groupStartPairs / groupEndPairs — { [groupId]: pair } (superadmin har bir
// guruhning [boshlanish..tugash] juftlik oralig'ini alohida tanlaydi). Yaroqsiz/
// chegaradan tashqari qiymatlar e'tiborsiz qoldiriladi (loadData.js'da ham standart
// 1..6'ga tushadi).
const parsePairMap = (body, key) => {
  const src = body?.[key]
  if (!src || typeof src !== 'object' || Array.isArray(src)) return {}
  const out = {}
  for (const [gid, v] of Object.entries(src)) {
    const g = Number(gid), p = Number(v)
    if (Number.isInteger(g) && g > 0 && Number.isInteger(p) && p >= 1 && p <= PAIRS) out[g] = p
  }
  return out
}

// POST /api/schedule/generate  — fon jobni boshlaydi, darhol runId qaytaradi.
// Faqat Super Admin va Fakultet operatori jadval yaratadi.
// Holatni /runs/:id orqali kuzating (status: running → done/failed).
scheduleRouter.post('/generate', requireRole('Super Admin', 'Fakultet operatori'), asyncHandler(async (req, res) => {
  if (restrictionBlocks(req.user, 'schedule', 'write')) return res.status(403).json({ error: 'Ruxsat yetarli emas (cheklangan)' })
  const semester = Number(req.body?.semester) || 1
  const maxMs = Math.min(120_000, Number(req.body?.maxMs) || 5000)
  const groupStartPairs = parsePairMap(req.body, 'groupStartPairs')
  const groupEndPairs = parsePairMap(req.body, 'groupEndPairs')

  const run = await prisma.schedulingRun.create({ data: { semester, status: 'running' } })
  startGenerateJob({ runId: run.id, semester, maxMs, groupStartPairs, groupEndPairs })
  await audit('Jadval generatsiyasi boshlandi', `run #${run.id}`, req)

  res.status(202).json({
    runId: run.id,
    status: 'running',
    semester,
    poll: `/api/schedule/runs/${run.id}`,
  })
}))

// POST /api/schedule/diagnose  — jadval YARATMASDAN, joriy ma'lumotdagi muammolarni
// aniqlaydi: qaysi guruhga/o'qituvchiga yuklama oshib ketgan, qaysi dars xonasiz/vaqtsiz
// qolishi mumkin va nega. "Jadval yaratish" dan oldin tekshirish uchun.
scheduleRouter.post('/diagnose', requireRole('Super Admin', 'Fakultet operatori'), asyncHandler(async (req, res) => {
  const semester = Number(req.body?.semester) || 1
  const groupStartPairs = parsePairMap(req.body, 'groupStartPairs')
  const groupEndPairs = parsePairMap(req.body, 'groupEndPairs')
  const ctx = await loadData(prisma, semester, { groupStartPairs, groupEndPairs })
  const diagnostics = buildDiagnostics(ctx)
  const totalEvents = ctx.events.length
  const problems = diagnostics.groupOverload.length + diagnostics.teacherOverload.length + diagnostics.blocked.length
  res.json({ semester, groupStartPairs, groupEndPairs, totalEvents, ok: problems === 0, diagnostics })
}))

// GET /api/schedule/runs  — yaratilgan jadvallar ro'yxati.
// Standart: faqat faol (arxivlanmagan). ?all=1 — arxivdagilarni ham qaytaradi.
scheduleRouter.get('/runs', asyncHandler(async (req, res) => {
  const all = req.query.all === '1' || req.query.all === 'true'
  const runs = await prisma.schedulingRun.findMany({
    where: all ? undefined : { archived: false },
    orderBy: { id: 'desc' },
    include: { _count: { select: { entries: true } } },
  })
  res.json(runs.map((r) => {
    let report = null
    try { report = r.report ? JSON.parse(r.report) : null } catch { report = null }
    return {
      id: r.id, semester: r.semester, status: r.status, archived: r.archived,
      hardScore: r.hardScore, softScore: r.softScore,
      entries: r._count.entries, createdAt: r.createdAt, report,
    }
  }))
}))

// GET /api/schedule/runs/:id  — topshiriq formatidagi yakuniy jadval
scheduleRouter.get('/runs/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const run = await prisma.schedulingRun.findUnique({ where: { id } })
  if (!run) return res.status(404).json({ error: 'Run topilmadi' })
  const entries = await prisma.scheduleEntry.findMany({ where: { runId: id }, orderBy: { id: 'asc' } })
  // report — JSON-string sifatida saqlanadi; frontend uchun obyektga aylantiramiz
  let report = null
  try { report = run.report ? JSON.parse(run.report) : null } catch { report = null }
  // Topshiriq chiqish formati: { group_id, teacher_id, subject_id, room_id, day, pair }
  res.json({
    run: { ...run, report },
    schedule: entries.map((e) => ({
      group_id: e.groupId, teacher_id: e.teacherId, subject_id: e.subjectId,
      room_id: e.roomId, day: e.day, pair: e.pair,
    })),
  })
}))

// GET /api/schedule/runs/:id/grid?groupId=  — bitta guruh jadvali (nomlar bilan)
// Bir yoki bir nechta guruhning 6×5 jadval matritsasi. Faqat yozuvlarda UCHRAGAN
// fan/o'qituvchi/xona nomlari o'qiladi (butun jadvallar emas) — jami 4 ta so'rov,
// guruhlar soniga bog'liq emas.
async function buildGrids(runId, groupIds) {
  const entries = await prisma.scheduleEntry.findMany({ where: { runId, groupId: { in: groupIds } } })
  const ids = (key) => [...new Set(entries.map((e) => e[key]))]
  const [subjects, teachers, rooms] = await Promise.all([
    prisma.subject.findMany({ where: { id: { in: ids('subjectId') } }, select: { id: true, name: true } }),
    prisma.teacher.findMany({ where: { id: { in: ids('teacherId') } }, select: { id: true, fullName: true } }),
    prisma.room.findMany({ where: { id: { in: ids('roomId') } }, select: { id: true, name: true } }),
  ])
  const sName = new Map(subjects.map((x) => [x.id, x.name]))
  const tName = new Map(teachers.map((x) => [x.id, x.fullName]))
  const rName = new Map(rooms.map((x) => [x.id, x.name]))

  const grids = Object.fromEntries(groupIds.map((gid) => [gid, Array.from({ length: PAIRS }, () => Array(DAYS).fill(null))]))
  for (const e of entries) {
    grids[e.groupId][e.pair - 1][e.day] = {
      id: e.id,
      subject: sName.get(e.subjectId), teacher: tName.get(e.teacherId), room: rName.get(e.roomId),
      subjectId: e.subjectId, teacherId: e.teacherId, roomId: e.roomId, type: e.type,
    }
  }
  return grids
}

scheduleRouter.get('/runs/:id/grid', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const groupId = Number(req.query.groupId)
  if (!groupId) return res.status(400).json({ error: 'groupId kerak' })
  const grids = await buildGrids(id, [groupId])
  res.json({ days: DAY_NAMES, grid: grids[groupId] })
}))

// POST /api/schedule/runs/:id/grids  { groupIds: [...] } — ko'p guruhning jadvalini
// BITTA so'rovda qaytaradi (yuklab olishda har guruhga alohida so'rov yuborish
// rate-limit va DB ulanishlar hovuzini to'ldirib yuborardi). Faqat o'qish.
const MAX_BULK_GROUPS = 1000
scheduleRouter.post('/runs/:id/grids', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const raw = Array.isArray(req.body?.groupIds) ? req.body.groupIds : []
  const groupIds = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
  if (groupIds.length === 0) return res.status(400).json({ error: 'groupIds kerak' })
  if (groupIds.length > MAX_BULK_GROUPS) return res.status(400).json({ error: `Bir so'rovda ko'pi bilan ${MAX_BULK_GROUPS} ta guruh` })
  const grids = await buildGrids(id, groupIds)
  res.json({ days: DAY_NAMES, grids })
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
    grid[e.pair - 1][e.day] = { subject: sName.get(e.subjectId), group: gName.get(e.groupId), room: rName.get(e.roomId), type: e.type }
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

// GET /api/schedule/runs/:id/room-availability
// Barcha xonalarning bandlik matritsasi (bino bo'yicha): har biri uchun PAIRS×DAYS grid.
// Hujayra null → bo'sh, aks holda { group, subject, teacher } → band (qaysi guruh kirishi bilan).
scheduleRouter.get('/runs/:id/room-availability', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const run = await prisma.schedulingRun.findUnique({ where: { id } })
  if (!run) return res.status(404).json({ error: 'Run topilmadi' })

  const [entries, rooms, subjects, groups, teachers] = await Promise.all([
    prisma.scheduleEntry.findMany({ where: { runId: id } }),
    prisma.room.findMany({ include: { building: true }, orderBy: [{ buildingId: 'asc' }, { name: 'asc' }] }),
    prisma.subject.findMany(), prisma.group.findMany(), prisma.teacher.findMany(),
  ])
  const sName = new Map(subjects.map((x) => [x.id, x.name]))
  const gName = new Map(groups.map((x) => [x.id, x.name]))
  const tName = new Map(teachers.map((x) => [x.id, x.fullName]))

  const byRoom = new Map(rooms.map((r) => [r.id, {
    id: r.id, name: r.name, building: r.building?.name || 'Bino belgilanmagan', capacity: r.capacity, busy: 0,
    grid: Array.from({ length: PAIRS }, () => Array(DAYS).fill(null)),
  }]))
  for (const e of entries) {
    const r = byRoom.get(e.roomId)
    if (!r) continue
    if (r.grid[e.pair - 1][e.day] == null) r.busy++
    r.grid[e.pair - 1][e.day] = { group: gName.get(e.groupId), subject: sName.get(e.subjectId), teacher: tName.get(e.teacherId) }
  }
  const total = PAIRS * DAYS
  const result = [...byRoom.values()].map((r) => ({ ...r, free: total - r.busy }))
  res.json({ days: DAY_NAMES, pairs: PAIRS, rooms: result })
}))

const parseReport = (raw) => {
  try { return raw ? JSON.parse(raw) : null } catch { return null }
}

// Qattiq buzilishlar (nomlarsiz): guruh/o'qituvchi/xona to'qnashuvlari va oynalar.
// Har biri: type, entityId, day, pair, items (darslar), weight (qattiq ballga hissasi) [, gapPairs].
function findViolations(entries) {
  // Potok: bitta dars bir nechta guruhga BIRGA o'tiladi — ScheduleEntry'da har guruh uchun alohida
  // qator bo'ladi (day/pair/teacher/room/subject bir xil, faqat groupId farq qiladi). Bu haqiqiy
  // to'qnashuv EMAS — o'qituvchi/xona tekshiruvidan oldin BITTA "dars"ga birlashtiriladi.
  const lessonMap = new Map()
  for (const e of entries) {
    const k = `${e.day}|${e.pair}|${e.teacherId}|${e.roomId}|${e.subjectId}|${e.type}`
    if (!lessonMap.has(k)) lessonMap.set(k, { ...e, groupIds: [] })
    lessonMap.get(k).groupIds.push(e.groupId)
  }
  const lessons = [...lessonMap.values()]

  const found = []
  const section = (type, items, entity) => {
    const buckets = new Map()
    for (const item of items) {
      const k = `${item[entity]}|${item.day}|${item.pair}`
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(item)
    }
    for (const clash of buckets.values()) {
      if (clash.length < 2) continue
      const { day, pair } = clash[0]
      found.push({ type, entityId: clash[0][entity], day, pair, items: clash, weight: clash.length - 1 })
    }
  }
  // Guruh: har qatorning o'zi (bitta guruh ikkita alohida darsga tushib qolsa — real xato)
  section('group', entries.map((e) => ({ ...e, groupIds: [e.groupId] })), 'groupId')
  // O'qituvchi va xona: potok birlashtirilgan darslar
  section('teacher', lessons, 'teacherId')
  section('room', lessons, 'roomId')

  // Oyna (guruhda darslar orasidagi bo'sh juftlik) — QAT'IY taqiqlangan; qo'lda tahrirdan keyin ham ko'rinadi
  const byGroupDay = new Map()
  for (const e of entries) {
    const k = `${e.groupId}|${e.day}`
    if (!byGroupDay.has(k)) byGroupDay.set(k, [])
    byGroupDay.get(k).push({ ...e, groupIds: [e.groupId] })
  }
  for (const items of byGroupDay.values()) {
    const busy = new Set(items.map((x) => x.pair))
    const empty = []
    for (let p = Math.min(...busy) + 1; p < Math.max(...busy); p++) if (!busy.has(p)) empty.push(p)
    if (empty.length) {
      found.push({
        type: 'gap', entityId: items[0].groupId, day: items[0].day, pair: empty[0], gapPairs: empty,
        items: [...items].sort((a, b) => a.pair - b.pair), weight: empty.length,
      })
    }
  }
  return found
}

function breakdownOf(violations) {
  const out = { group: 0, teacher: 0, room: 0, gap: 0 }
  for (const v of violations) out[v.type] += v.weight
  return out
}

// Qo'lda tahrirdan keyin qattiq buzilishlarni qayta sanaydi va jadvalga yozadi
async function refreshScore(runId) {
  const [run, entries] = await Promise.all([
    prisma.schedulingRun.findUnique({ where: { id: runId } }),
    prisma.scheduleEntry.findMany({ where: { runId }, orderBy: { id: 'asc' } }),
  ])
  const breakdown = breakdownOf(findViolations(entries))
  const parsed = parseReport(run?.report)
  const report = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  report.breakdown = breakdown
  report.editedAt = new Date().toISOString()
  const hardScore = breakdown.group + breakdown.teacher + breakdown.room + breakdown.gap
  await prisma.schedulingRun.update({ where: { id: runId }, data: { hardScore, report: JSON.stringify(report) } })
  return { hardScore, breakdown }
}

// GET /api/schedule/runs/:id/score — joriy qattiq buzilish soni (qo'lda tahrirdan keyin yangilanadi)
scheduleRouter.get('/runs/:id/score', asyncHandler(async (req, res) => {
  const run = await prisma.schedulingRun.findUnique({ where: { id: Number(req.params.id) } })
  if (!run) return res.status(404).json({ error: 'Run topilmadi' })
  const report = parseReport(run.report)
  res.json({ hardScore: run.hardScore, breakdown: report && typeof report === 'object' ? report.breakdown ?? null : null })
}))

// GET /api/schedule/runs/:id/violations
// "Qattiq buzilish" (hardScore) sonining ORQASIDAGI aniq manzillari: qaysi kun/juftlikda
// qaysi guruh/o'qituvchi/xona uchun 2+ dars bir vaqtga to'qnashib qolgan va qaysi guruhda
// oyna qolgan (har biri — fan/guruh/o'qituvchi/xona/juftlik bilan birga).
scheduleRouter.get('/runs/:id/violations', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const run = await prisma.schedulingRun.findUnique({ where: { id } })
  if (!run) return res.status(404).json({ error: 'Run topilmadi' })

  const [entries, subjects, groups, teachers, rooms] = await Promise.all([
    prisma.scheduleEntry.findMany({ where: { runId: id }, orderBy: { id: 'asc' } }),
    prisma.subject.findMany(), prisma.group.findMany(), prisma.teacher.findMany(), prisma.room.findMany(),
  ])
  const sName = new Map(subjects.map((x) => [x.id, x.name]))
  const gName = new Map(groups.map((x) => [x.id, x.name]))
  const tName = new Map(teachers.map((x) => [x.id, x.fullName]))
  const rName = new Map(rooms.map((x) => [x.id, x.name]))
  const names = { group: gName, teacher: tName, room: rName, gap: gName }

  const lessonInfo = (l) => ({
    subject: sName.get(l.subjectId) || `#${l.subjectId}`,
    group: l.groupIds.map((gid) => gName.get(gid) || `#${gid}`).join(', '),
    teacher: tName.get(l.teacherId) || `#${l.teacherId}`,
    room: rName.get(l.roomId) || `#${l.roomId}`,
    type: l.type, pair: l.pair,
  })

  const violations = findViolations(entries).map((v) => ({
    type: v.type, entityId: v.entityId,
    entityName: names[v.type].get(v.entityId) || `#${v.entityId}`,
    day: v.day, dayName: DAY_NAMES[v.day], pair: v.pair,
    ...(v.type === 'gap' ? { gapPairs: v.gapPairs } : {}),
    lessons: v.items.map(lessonInfo),
  }))
  violations.sort((a, b) => a.day - b.day || a.pair - b.pair || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
  res.json({ hardScore: run.hardScore, violations })
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

// Qo'lda tahrirlashda ham xona qoidalari qat'iy tekshiriladi (generatsiyadagi kabi):
// sig'im, katta zal hajmi, fakultet binosi egaligi, MAXSUS xona ruxsati, qat'iy biriktirish.
// Mos bo'lsa null, aks holda aniq sabab matni qaytadi.
async function roomEligibility({ roomId, groupId, teacherId, subjectId }) {
  const [room, group] = await Promise.all([
    prisma.room.findUnique({ where: { id: roomId }, include: { permissions: true, building: { include: { faculties: true } } } }),
    prisma.group.findUnique({ where: { id: groupId } }),
  ])
  if (!room) return 'Xona topilmadi'
  if (!group) return 'Guruh topilmadi'
  const size = group.size ?? 0
  if (room.capacity < size) {
    return `Xona sig'imi yetarli emas: "${room.name}" ${room.capacity} o'rinli, guruhda ${group.size} talaba`
  }
  const bFacIds = room.building?.faculties?.map((f) => f.id) ?? []
  // Katta zal (60+ o'rin, qaysi binoda bo'lmasin) — generatsiyadagi kabi QAT'IY faqat 65-105 talabali
  // sinf; xonaning o'zi shu fanga biriktirilgan bo'lsa (masalan sport zali) — hajm qoidasi qo'llanilmaydi
  const ownRoom = subjectId != null && room.permissions.some((p) => p.subjectId === subjectId)
  if (room.capacity > LARGE_ROOM_CAPACITY && !ownRoom) {
    if (bFacIds.length === 0 && subjectId != null) {
      const dedicated = await prisma.roomPermission.count({ where: { subjectId } })
      if (dedicated > 0) return `"${room.name}" — asosiy binodagi katta zal, bu fanga boshqa joyda maxsus xona biriktirilgan (masalan sport zali) — bu yerdan foydalanmaydi`
    }
    if (size < MAIN_HALL_MIN || size > MAIN_HALL_MAX) {
      return `"${room.name}" — katta zal (${room.capacity} o'rin), faqat ${MAIN_HALL_MIN}-${MAIN_HALL_MAX} talabali sinf uchun (bu guruhda ${size} talaba) — talaba kam bo'lsa katta zal band qilinmaydi`
    }
  }
  // ISTISNO: xonaga aniq ruxsat (o'qituvchi/guruh/yo'nalish/fan) berilgan bo'lsa —
  // bino-fakultet egaligi chetlab o'tiladi (loadData.js bilan bir xil)
  const hasPermission = room.permissions.some((p) =>
    p.teacherId === teacherId || p.groupId === groupId
    || (group.specialtyId != null && p.specialtyId === group.specialtyId)
    || (subjectId != null && p.subjectId === subjectId))
  if (bFacIds.length > 0 && group.facultyId != null && !bFacIds.includes(group.facultyId) && !hasPermission) {
    return `"${room.name}" boshqa fakultet binosida — bu guruh u yerdan foydalana olmaydi`
  }
  if (room.type === 'maxsus' && !hasPermission) {
    return `"${room.name}" — maxsus xona, bu guruh/o'qituvchi/yo'nalish/fanga kirish ruxsati berilmagan`
  }
  // QAT'IY biriktirish: bu guruh faqat exclusive xonalarida dars o'tishi mumkin
  const exPerms = await prisma.roomPermission.findMany({ where: { groupId, exclusive: true }, include: { room: true } })
  if (exPerms.length && !exPerms.some((p) => p.roomId === roomId)) {
    return `Bu guruh FAQAT "${exPerms.map((p) => p.room?.name).filter(Boolean).join(', ')}" xonasiga biriktirilgan — boshqa xonaga qo'yib bo'lmaydi`
  }
  return null
}

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
  const type = req.body?.type || 'Amaliy'
  const reasons = await slotConflicts({ runId, day, pair, groupId, teacherId, roomId })
  if (reasons.length) return res.status(409).json({ error: conflictMsg(reasons) })
  const roomErr = await roomEligibility({ roomId, groupId, teacherId, subjectId })
  if (roomErr) return res.status(409).json({ error: roomErr })
  const entry = await prisma.scheduleEntry.create({ data: { runId, groupId, subjectId, teacherId, roomId, day, pair, type } })
  await refreshScore(runId)
  await audit("Jadvalga dars qo'shildi", `run #${runId} · ${DAY_NAMES[day]} ${pair}-juft`, req)
  res.status(201).json(entry)
}))

// PUT /api/schedule/runs/:id/entries/:entryId  — darsni o'zgartirish yoki boshqa slotga ko'chirish
scheduleRouter.put('/runs/:id/entries/:entryId', requireRole('Super Admin'), asyncHandler(async (req, res) => {
  const runId = Number(req.params.id)
  const entryId = Number(req.params.entryId)
  const existing = await prisma.scheduleEntry.findFirst({ where: { id: entryId, runId } })
  if (!existing) return res.status(404).json({ error: 'Dars topilmadi' })
  const body = req.body || {}
  const merged = { day: body.day ?? existing.day, pair: body.pair ?? existing.pair, type: body.type ?? existing.type }
  for (const key of ['groupId', 'subjectId', 'teacherId', 'roomId']) {
    const value = body[key]
    if (value != null && !Number.isInteger(value)) return res.status(400).json({ error: `Maydon noto'g'ri: ${key}` })
    merged[key] = value ?? existing[key]
  }
  if (!isValidSlot(merged.day, merged.pair)) return res.status(400).json({ error: "Kun/juftlik noto'g'ri" })
  const reasons = await slotConflicts({ runId, ...merged, excludeId: entryId })
  if (reasons.length) return res.status(409).json({ error: conflictMsg(reasons) })
  const roomErr = await roomEligibility(merged)
  if (roomErr) return res.status(409).json({ error: roomErr })
  const entry = await prisma.scheduleEntry.update({ where: { id: entryId }, data: merged })
  await refreshScore(runId)
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
  await refreshScore(runId)
  await audit("Jadvaldan dars o'chirildi", `run #${runId}`, req)
  res.status(204).end()
}))

// Dars va uning potok "egizaklari" (shu run, shu vaqt, o'qituvchi, fan, xona, tur) + qolgan yozuvlar.
// Dars topilmasa null
async function lessonOf(runId, entryId) {
  const entries = await prisma.scheduleEntry.findMany({ where: { runId }, orderBy: { id: 'asc' } })
  const entry = Number.isInteger(entryId) && entryId > 0 ? entries.find((e) => e.id === entryId) : null
  if (!entry) return null
  const same = (e) => e.day === entry.day && e.pair === entry.pair && e.teacherId === entry.teacherId
    && e.subjectId === entry.subjectId && e.roomId === entry.roomId && e.type === entry.type
  const siblings = entries.filter(same)
  const others = entries.filter((e) => !same(e))
  return { entry, siblings, others }
}

function busyReasons(others, entry, groupIds, day, pair, groupNames) {
  const atSlot = others.filter((e) => e.day === day && e.pair === pair)
  const reasons = []
  const busyGroups = [...new Set(atSlot.filter((e) => groupIds.has(e.groupId)).map((e) => e.groupId))].sort((a, b) => a - b)
  if (busyGroups.length) {
    reasons.push(groupIds.size === 1
      ? 'guruh band'
      : `guruh band: ${busyGroups.map((g) => groupNames.get(g) || `#${g}`).join(', ')}`)
  }
  if (atSlot.some((e) => e.teacherId === entry.teacherId)) reasons.push("o'qituvchi band")
  if (atSlot.some((e) => e.roomId === entry.roomId)) reasons.push('xona band')
  return reasons
}

// Kun ichidagi oynalar soni (band juftliklar to'plami bo'yicha)
const innerGaps = (pairs) => (pairs.size ? Math.max(...pairs) - Math.min(...pairs) + 1 - pairs.size : 0)
const withPair = (pairs, pair) => new Set([...pairs, pair])

const groupNamesOf = async (groupIds) => new Map(
  (await prisma.group.findMany({ where: { id: { in: [...groupIds] } }, select: { id: true, name: true } }))
    .map((g) => [g.id, g.name]),
)

// GET /api/schedule/runs/:id/entries/:entryId/moves — darsni qaysi kataklarga ko'chirish mumkin (sudrash uchun)
scheduleRouter.get('/runs/:id/entries/:entryId/moves', requireRole('Super Admin'), asyncHandler(async (req, res) => {
  const runId = Number(req.params.id)
  const run = await prisma.schedulingRun.findUnique({ where: { id: runId } })
  if (!run) return res.status(404).json({ error: 'Run topilmadi' })
  const lesson = await lessonOf(runId, Number(req.params.entryId))
  if (!lesson) return res.status(404).json({ error: 'Dars topilmadi' })
  const { entry, siblings, others } = lesson
  const groupIds = new Set(siblings.map((e) => e.groupId))
  const groupNames = await groupNamesOf(groupIds)
  // har guruhning (potok darsisiz) band juftliklari: guruh → kun → Set(juftlik)
  const base = new Map([...groupIds].map((g) => [g, new Map()]))
  for (const e of others) {
    const days = base.get(e.groupId)
    if (!days) continue
    if (!days.has(e.day)) days.set(e.day, new Set())
    days.get(e.day).add(e.pair)
  }
  const blockedDays = new Set(), allowedPairs = new Set()
  const tc = await prisma.teacherConstraint.findUnique({ where: { teacherId: entry.teacherId } })
  if (tc) {
    for (const [raw, target] of [[tc.blockedDays, blockedDays], [tc.allowedPairs, allowedPairs]]) {
      let values = []
      try { values = raw ? JSON.parse(raw) : [] } catch { values = [] } // noto'g'ri JSON — generatsiyadagi kabi e'tiborsiz
      if (Array.isArray(values)) for (const v of values) if (Number.isInteger(v)) target.add(v)
    }
  }

  const empty = new Set()
  const cells = []
  for (let pair = 1; pair <= PAIRS; pair++) {
    const row = []
    for (let day = 0; day < DAYS; day++) {
      if (day === entry.day && pair === entry.pair) {
        row.push({ status: 'current', reasons: [], gapDelta: 0 })
        continue
      }
      const reasons = busyReasons(others, entry, groupIds, day, pair, groupNames)
      const warnings = []
      const againstConstraint = blockedDays.has(day) || (allowedPairs.size > 0 && !allowedPairs.has(pair))
      if (againstConstraint) warnings.push("o'qituvchi istisnosiga zid")
      // oyna: shu darsning guruhlarida ko'chirishdan oldin va keyin (manba va nishon kunida)
      let delta = 0
      for (const days of base.values()) {
        const src = days.get(entry.day) || empty
        const dst = days.get(day) || empty
        if (day === entry.day) {
          delta += innerGaps(withPair(src, pair)) - innerGaps(withPair(src, entry.pair))
        } else {
          delta += innerGaps(src) + innerGaps(withPair(dst, pair)) - innerGaps(withPair(src, entry.pair)) - innerGaps(dst)
        }
      }
      if (delta > 0) warnings.push(`${delta} ta oyna paydo bo'ladi`)
      else if (delta < 0 && !reasons.length) warnings.push(`${-delta} ta oynani yopadi`)
      const status = reasons.length ? 'busy' : (delta > 0 || againstConstraint ? 'warn' : 'ok')
      row.push({ status, reasons: [...reasons, ...warnings], gapDelta: delta })
    }
    cells.push(row)
  }
  res.json({
    entryId: entry.id, day: entry.day, pair: entry.pair,
    groups: [...groupIds].sort((a, b) => a - b).map((g) => groupNames.get(g) || `#${g}`), cells,
  })
}))

// POST /api/schedule/runs/:id/entries/:entryId/move — darsni (potok bo'lsa BARCHA guruhlari bilan) boshqa slotga
scheduleRouter.post('/runs/:id/entries/:entryId/move', requireRole('Super Admin'), asyncHandler(async (req, res) => {
  const runId = Number(req.params.id)
  const run = await prisma.schedulingRun.findUnique({ where: { id: runId } })
  if (!run) return res.status(404).json({ error: 'Run topilmadi' })
  const { day, pair } = req.body || {}
  if (!isValidSlot(day, pair)) return res.status(400).json({ error: "Kun/juftlik noto'g'ri" })
  const lesson = await lessonOf(runId, Number(req.params.entryId))
  if (!lesson) return res.status(404).json({ error: 'Dars topilmadi' })
  const { entry, siblings, others } = lesson
  if (day !== entry.day || pair !== entry.pair) {
    const groupIds = new Set(siblings.map((e) => e.groupId))
    const reasons = busyReasons(others, entry, groupIds, day, pair, await groupNamesOf(groupIds))
    if (reasons.length) return res.status(409).json({ error: `Bu mumkin emas: shu vaqtda ${reasons.join(', ')}` })
    const source = `${DAY_NAMES[entry.day]} ${entry.pair}-juft`
    await prisma.scheduleEntry.updateMany({ where: { id: { in: siblings.map((e) => e.id) } }, data: { day, pair } })
    await audit("Jadval darsi ko'chirildi",
      `run #${runId} · ${source} → ${DAY_NAMES[day]} ${pair}-juft (${siblings.length} ta guruh)`, req)
  }
  const score = await refreshScore(runId)
  res.json({ moved: siblings.length, day, pair, ...score })
}))

// DELETE /api/schedule/runs/:id  — jadvalni ARXIVGA ko'chiradi (butunlay O'CHIRMAYDI).
// Barcha darslari (ScheduleEntry) saqlanadi, kerak bo'lsa /restore orqali tiklanadi.
// Tarix hech qachon yo'qolmaydi.
scheduleRouter.delete('/runs/:id', requireRole('Super Admin', 'Fakultet operatori'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const run = await prisma.schedulingRun.findUnique({ where: { id } })
  if (!run) return res.status(404).json({ error: 'Jadval topilmadi' })
  await prisma.schedulingRun.update({ where: { id }, data: { archived: true } })
  await audit('Arxivlandi: Jadval', `run #${id}`, req)
  res.status(204).end()
}))

// POST /api/schedule/runs/:id/restore  — arxivdan qaytaradi
scheduleRouter.post('/runs/:id/restore', requireRole('Super Admin', 'Fakultet operatori'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const run = await prisma.schedulingRun.findUnique({ where: { id } })
  if (!run) return res.status(404).json({ error: 'Jadval topilmadi' })
  await prisma.schedulingRun.update({ where: { id }, data: { archived: false } })
  await audit('Arxivdan tiklandi: Jadval', `run #${id}`, req)
  res.json({ ok: true, id })
}))
