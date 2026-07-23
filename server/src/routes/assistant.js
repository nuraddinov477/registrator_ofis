import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { prisma, audit } from '../db.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { scopeWhere, restrictionBlocks } from '../auth/access.js'
import { startGenerateJob } from '../engine/jobRunner.js'
import { DAY_NAMES } from '../engine/timeslots.js'

// ─────────────────── SmartJadval AI yordamchisi ───────────────────
// AI faqat tushuntiradi, ma'lumotni tool orqali O'QIYDI va dvigatelni ishga
// tushiradi. Xonalarni taqsimlashning o'zi deterministik engine'da — AI
// natija o'ylab topmaydi, shuning uchun jadval konfliktsizligi kafolatlanadi.

const MODEL = 'claude-opus-4-8'
const MAX_TOOL_TURNS = 8

const SYSTEM_PROMPT = `Sen — SmartJadval tizimining AI yordamchisisan. SmartJadval — universitetlar uchun dars jadvali tuzish tizimi.

MODULLAR (chap menyu): Dashboard (statistika) · Tuzilma: Fakultetlar, Kafedralar, Mutaxassisliklar · Resurslar: O'qituvchilar, Fanlar bazasi, Akademik guruhlar, Bino va xonalar · Jarayon: O'quv yuklamasi, Talabnomalar, Dars jadvali · Boshqaruv: Foydalanuvchilar, Audit logi.

ROLLAR: Super Admin — hamma narsa, tuzilma va akkauntlar; Fakultet operatori — o'z fakultetida guruh/mutaxassislik/yuklama kiritadi, fanlar va xonalarni tahrirlaydi, jadval generatsiya qiladi; Kafedra mudiri — o'z kafedrasi o'qituvchilari va yuklamalarini boshqaradi, talabnomalarga javob beradi; O'qituvchi — faqat ko'radi.

ISH TARTIBI: 1) Super Admin tuzilmani (fakultet/kafedra/xona) va akkauntlarni yaratadi → 2) operator mutaxassislik, guruh, fan va yuklamani kiritadi → 3) mudir yuklamalarga o'z o'qituvchilarini biriktiradi (kerak bo'lsa talabnoma orqali boshqa kafedradan so'raydi) → 4) operator "Dars jadvali" sahifasida generatsiyani bosadi → 5) hamma o'z jadvalini ko'radi.

JADVAL DVIGATELI (muhim!): darslarni vaqt va xonalarga taqsimlashni AI emas, maxsus optimallashtirish dvigateli (greedy + simulated annealing) bajaradi. QATTIQ cheklovlar hech qachon buzilmaydi: bitta o'qituvchi/guruh/xona bir paytda faqat bitta darsda; xona sig'imi guruhga yetadi; maxsus xonalar faqat ruxsat bilan. YUMSHOQ maqsadlar: qiyin fanlar ertalabki juftliklarga, o'qituvchiga yolg'iz juftlik qoldirmaslik, ish kunlarini ixchamlash. Hafta: 5 kun (Dushanba–Juma), kuniga 6 juftlik. Shuning uchun natija matematik jihatdan konfliktsiz — "xatosiz taqsimlash" shu dvigatel kafolati.

QOIDALAR:
- Ma'lumot haqidagi HAR QANDAY savolda tool ishlat — sondan/nomdan taxmin qilma, o'ylab topma.
- Foydalanuvchi qaysi tilda yozsa, o'sha tilda javob ber (odatda o'zbek yoki rus). Aniq va qisqa yoz.
- Jadval tuzish so'ralsa: avval tayyorlik_tekshir tool'ini chaqir. Nimadir yetishmasa (masalan guruh yoki yuklama 0 ta) — nimani, qaysi bo'limda kiritishni tushuntir. Hammasi tayyor bo'lsa va foydalanuvchi roli ruxsat bersa jadval_yaratish'ni ishlat.
- Foydalanuvchi rolida ruxsat bo'lmagan amalni so'rasa, buni muloyim tushuntir.
- Xatolik yoki muammo aytilsa: avval tool bilan holatni tekshir, keyin aniq yechim ber (qaysi sahifa, qaysi tugma).`

// ── Tool ta'riflari ──
const TOOLS = [
  {
    name: 'malumot_qidir',
    description: "Bazadagi ro'yxatlarni o'qiydi (fakultet, kafedra, mutaxassislik, o'qituvchi, fan, guruh, xona, yuklama). Nom bo'yicha qidirish mumkin. Foydalanuvchi ko'ra oladigan doiradagina qaytaradi.",
    input_schema: {
      type: 'object',
      properties: {
        resource: { type: 'string', enum: ['faculties', 'departments', 'specialties', 'teachers', 'subjects', 'groups', 'rooms', 'workloads'], description: 'Qaysi turdagi maʼlumot' },
        search: { type: 'string', description: "Nom bo'yicha qidiruv (ixtiyoriy)" },
        limit: { type: 'integer', description: 'Nechta qaytarish (standart 15, max 40)' },
      },
      required: ['resource'],
    },
  },
  {
    name: 'tayyorlik_tekshir',
    description: "Jadval generatsiyasiga tayyorlikni tekshiradi: har jadvaldagi yozuvlar soni, nima yetishmayotgani va oxirgi generatsiya holati.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'jadval_korish',
    description: "Tayyor dars jadvalini ko'rsatadi — guruh nomi yoki o'qituvchi nomi bo'yicha (oxirgi muvaffaqiyatli generatsiyadan).",
    input_schema: {
      type: 'object',
      properties: {
        groupName: { type: 'string', description: 'Guruh nomi (qismi ham boʻladi)' },
        teacherName: { type: 'string', description: "O'qituvchi nomi (qismi ham bo'ladi)" },
      },
    },
  },
  {
    name: 'bosh_xonalar',
    description: "Berilgan kun va juftlikda bo'sh xonalarni topadi (oxirgi tayyor jadvalga ko'ra).",
    input_schema: {
      type: 'object',
      properties: {
        day: { type: 'integer', description: '0=Dushanba .. 4=Juma' },
        pair: { type: 'integer', description: 'Juftlik 1..6' },
        minCapacity: { type: 'integer', description: "Minimal sig'im (ixtiyoriy)" },
      },
      required: ['day', 'pair'],
    },
  },
  {
    name: 'jadval_yaratish',
    description: "Jadval generatsiyasini ishga tushiradi (faqat Super Admin va Fakultet operatori). Darhol runId qaytaradi, jarayon fonda boradi — holatini jarayon_holati bilan tekshirish mumkin.",
    input_schema: {
      type: 'object',
      properties: {
        semester: { type: 'integer', description: 'Semestr (standart 1)' },
        maxMs: { type: 'integer', description: 'Optimallashtirish vaqti ms (standart 5000, max 120000)' },
      },
    },
  },
  {
    name: 'jarayon_holati',
    description: 'Generatsiya jarayoni holatini qaytaradi: running/done/failed, ballar va darslar soni.',
    input_schema: {
      type: 'object',
      properties: { runId: { type: 'integer', description: 'Generatsiya raqami' } },
      required: ['runId'],
    },
  },
]

// ── Tool bajaruvchilar ──

const listConfig = {
  faculties: { model: 'faculty', map: (r) => ({ id: r.id, nom: r.name, kod: r.code }) },
  departments: { model: 'department', include: { faculty: true }, map: (r) => ({ id: r.id, nom: r.name, fakultet: r.faculty?.name ?? null }) },
  specialties: { model: 'specialty', include: { faculty: true }, map: (r) => ({ id: r.id, nom: r.name, kod: r.code, fakultet: r.faculty?.name ?? null }) },
  teachers: { model: 'teacher', field: 'fullName', include: { department: true }, map: (r) => ({ id: r.id, nom: r.fullName, lavozim: r.position, kafedra: r.department?.name ?? null, holat: r.status }) },
  subjects: { model: 'subject', map: (r) => ({ id: r.id, nom: r.name, kredit: r.credit, semestr: r.semester, qiyinlik: r.difficulty }) },
  groups: { model: 'group', include: { faculty: true, specialty: true }, map: (r) => ({ id: r.id, nom: r.name, kurs: r.course, talabalar: r.size, fakultet: r.faculty?.name ?? null }) },
  rooms: { model: 'room', include: { building: true }, map: (r) => ({ id: r.id, nom: r.name, sigim: r.capacity, turi: r.type, bino: r.building?.name ?? null }) },
  workloads: { model: 'workload', include: { group: true, teacher: true, subject: true }, map: (r) => ({ id: r.id, guruh: r.group?.name, fan: r.subject?.name, oqituvchi: r.teacher?.fullName, soat: r.weeklyHours, semestr: r.semester }) },
}

async function latestDoneRun() {
  return prisma.schedulingRun.findFirst({ where: { status: 'done' }, orderBy: { id: 'desc' } })
}

async function runTool(name, input, user, req) {
  if (name === 'malumot_qidir') {
    const cfg = listConfig[input.resource]
    if (!cfg) return { xato: `Noma'lum resurs: ${input.resource}` }
    const scoped = scopeWhere(input.resource, user)
    const field = cfg.field || 'name'
    const where = { ...(scoped || {}) }
    if (input.search) where[field] = { contains: input.search }
    const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 40)
    const [rows, total] = await Promise.all([
      prisma[cfg.model].findMany({ where, include: cfg.include, take: limit }),
      prisma[cfg.model].count({ where }),
    ])
    return { jami: total, korsatilgan: rows.length, royxat: rows.map(cfg.map) }
  }

  if (name === 'tayyorlik_tekshir') {
    const [faculties, departments, teachers, subjects, groups, rooms, workloads] = await Promise.all([
      prisma.faculty.count(), prisma.department.count(), prisma.teacher.count(),
      prisma.subject.count(), prisma.group.count(), prisma.room.count(), prisma.workload.count(),
    ])
    const lastRun = await prisma.schedulingRun.findFirst({ orderBy: { id: 'desc' } })
    const yetishmaydi = []
    if (!faculties) yetishmaydi.push('fakultetlar (Tuzilma → Fakultetlar)')
    if (!subjects) yetishmaydi.push('fanlar (Resurslar → Fanlar bazasi)')
    if (!groups) yetishmaydi.push('guruhlar (Resurslar → Akademik guruhlar)')
    if (!rooms) yetishmaydi.push('xonalar (Resurslar → Bino va xonalar)')
    if (!workloads) yetishmaydi.push("yuklamalar (Jarayon → O'quv yuklamasi: guruh+fan+o'qituvchi+soat)")
    return {
      sonlar: { fakultet: faculties, kafedra: departments, oqituvchi: teachers, fan: subjects, guruh: groups, xona: rooms, yuklama: workloads },
      generatsiyaga_tayyor: yetishmaydi.length === 0,
      yetishmaydi,
      oxirgi_generatsiya: lastRun ? { runId: lastRun.id, holat: lastRun.status, qattiq_buzilish: lastRun.hardScore, yumshoq_ball: lastRun.softScore } : null,
    }
  }

  if (name === 'jadval_korish') {
    const run = await latestDoneRun()
    if (!run) return { xato: "Hali tayyor jadval yo'q — avval generatsiya qilish kerak" }
    const where = { runId: run.id }
    let title = ''
    if (input.groupName) {
      const g = await prisma.group.findFirst({ where: { name: { contains: input.groupName } } })
      if (!g) return { xato: `Guruh topilmadi: ${input.groupName}` }
      where.groupId = g.id; title = `Guruh: ${g.name}`
    } else if (input.teacherName) {
      const t = await prisma.teacher.findFirst({ where: { fullName: { contains: input.teacherName } } })
      if (!t) return { xato: `O'qituvchi topilmadi: ${input.teacherName}` }
      where.teacherId = t.id; title = `O'qituvchi: ${t.fullName}`
    } else {
      return { xato: 'groupName yoki teacherName bering' }
    }
    const entries = await prisma.scheduleEntry.findMany({ where, orderBy: [{ day: 'asc' }, { pair: 'asc' }] })
    const [groups, teachers, subjects, rooms] = await Promise.all([
      prisma.group.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.groupId))] } } }),
      prisma.teacher.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.teacherId))] } } }),
      prisma.subject.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.subjectId))] } } }),
      prisma.room.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.roomId))] } } }),
    ])
    const nm = (list, id, f = 'name') => list.find((x) => x.id === id)?.[f] ?? `#${id}`
    return {
      runId: run.id, kim: title, darslar_soni: entries.length,
      darslar: entries.map((e) => ({
        kun: DAY_NAMES[e.day], juftlik: e.pair,
        fan: nm(subjects, e.subjectId), guruh: nm(groups, e.groupId),
        oqituvchi: nm(teachers, e.teacherId, 'fullName'), xona: nm(rooms, e.roomId),
      })),
    }
  }

  if (name === 'bosh_xonalar') {
    const day = Number(input.day), pair = Number(input.pair)
    if (day < 0 || day > 4 || pair < 1 || pair > 6) return { xato: 'day 0..4, pair 1..6 bo‘lishi kerak' }
    const run = await latestDoneRun()
    const busyIds = run
      ? (await prisma.scheduleEntry.findMany({ where: { runId: run.id, day, pair }, select: { roomId: true } })).map((e) => e.roomId)
      : []
    const rooms = await prisma.room.findMany({
      where: { id: { notIn: busyIds }, ...(input.minCapacity ? { capacity: { gte: Number(input.minCapacity) } } : {}) },
      include: { building: true }, orderBy: { capacity: 'desc' }, take: 30,
    })
    return {
      kun: DAY_NAMES[day], juftlik: pair,
      eslatma: run ? `Run #${run.id} bo'yicha` : "Hali tayyor jadval yo'q — barcha xonalar bo'sh hisoblanadi",
      bosh_xonalar: rooms.map((r) => ({ nom: r.name, sigim: r.capacity, turi: r.type, bino: r.building?.name ?? null })),
    }
  }

  if (name === 'jadval_yaratish') {
    const allowed = ['Super Admin', 'Fakultet operatori']
    if (!allowed.includes(user.role)) return { xato: `Sizning rolingiz (${user.role}) jadval generatsiya qila olmaydi — bu faqat Super Admin va Fakultet operatoriga ruxsat etilgan` }
    if (restrictionBlocks(user, 'schedule', 'write')) return { xato: 'Sizga jadval bo‘limiga yozish cheklangan' }
    const semester = Number(input.semester) || 1
    const maxMs = Math.min(120_000, Number(input.maxMs) || 5000)
    const run = await prisma.schedulingRun.create({ data: { semester, status: 'running' } })
    startGenerateJob({ runId: run.id, semester, maxMs })
    await audit('Jadval generatsiyasi boshlandi (AI yordamchi)', `run #${run.id}`, req)
    return { runId: run.id, holat: 'running', xabar: 'Generatsiya boshlandi — bir necha soniyadan keyin jarayon_holati bilan tekshiring' }
  }

  if (name === 'jarayon_holati') {
    const run = await prisma.schedulingRun.findUnique({ where: { id: Number(input.runId) } })
    if (!run) return { xato: `Run #${input.runId} topilmadi` }
    const count = await prisma.scheduleEntry.count({ where: { runId: run.id } })
    return { runId: run.id, holat: run.status, qattiq_buzilish: run.hardScore, yumshoq_ball: run.softScore, darslar_soni: count }
  }

  return { xato: `Noma'lum tool: ${name}` }
}

// ── Provayder 1: Claude (asosiy — ANTHROPIC_API_KEY bo'lsa) ──
async function chatClaude(clean, userCtx, u, req) {
  const client = new Anthropic()
  const system = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: userCtx },
  ]
  const messages = [...clean]
  let response
  for (let i = 0; i < MAX_TOOL_TURNS; i++) {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system,
      tools: TOOLS,
      messages,
    })
    if (response.stop_reason !== 'tool_use') break
    messages.push({ role: 'assistant', content: response.content })
    const results = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      let result
      try { result = await runTool(block.name, block.input || {}, u, req) }
      catch (e) { result = { xato: `Tool xatosi: ${e.message}` } }
      results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
    }
    messages.push({ role: 'user', content: results })
  }
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
}

// ── Provayder 2: Gemini (bepul test rejimi — GEMINI_API_KEY bo'lsa) ──
// REST orqali, qo'shimcha paket kerak emas. Tool'lar xuddi shu runTool'dan o'tadi.
const GEMINI_MODEL = 'gemini-flash-latest'

// Gemini bo'sh `properties`li OBJECT sxemani rad etadi — unda parameters umuman yuborilmaydi
const geminiTools = [{
  functionDeclarations: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    ...(Object.keys(t.input_schema.properties || {}).length ? { parameters: t.input_schema } : {}),
  })),
}]

async function chatGemini(clean, userCtx, u, req) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
  const contents = clean.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))

  for (let i = 0; i < MAX_TOOL_TURNS; i++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n${userCtx}` }] },
        contents,
        tools: geminiTools,
      }),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      if (r.status === 400 || r.status === 403) throw Object.assign(new Error('AI kaliti noto‘g‘ri yoki muddati o‘tgan — GEMINI_API_KEY tekshirilsin'), { status: 503 })
      if (r.status === 429) throw Object.assign(new Error('Bepul AI limiti vaqtincha tugadi — bir daqiqadan keyin qayta urinib ko‘ring'), { status: 503 })
      throw Object.assign(new Error(`AI xatosi (HTTP ${r.status}): ${body.slice(0, 200)}`), { status: 502 })
    }
    const data = await r.json()
    const parts = data.candidates?.[0]?.content?.parts || []
    const calls = parts.filter((p) => p.functionCall)
    if (!calls.length) {
      return parts.filter((p) => p.text).map((p) => p.text).join('\n').trim()
    }
    contents.push({ role: 'model', parts })
    const responses = []
    for (const c of calls) {
      let result
      try { result = await runTool(c.functionCall.name, c.functionCall.args || {}, u, req) }
      catch (e) { result = { xato: `Tool xatosi: ${e.message}` } }
      responses.push({ functionResponse: { name: c.functionCall.name, response: { natija: result } } })
    }
    contents.push({ role: 'user', parts: responses })
  }
  return ''
}

// ── Marshrut ──
export function assistantRouter() {
  const router = Router()

  router.post('/chat', asyncHandler(async (req, res) => {
    const provider = process.env.ANTHROPIC_API_KEY ? 'claude' : process.env.GEMINI_API_KEY ? 'gemini' : null
    if (!provider) {
      return res.status(503).json({ error: "AI yordamchi hali sozlanmagan (serverda ANTHROPIC_API_KEY yoki GEMINI_API_KEY yo'q)" })
    }
    const history = Array.isArray(req.body?.messages) ? req.body.messages : []
    const clean = history
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    if (!clean.length || clean[clean.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'messages oxiri user xabari bo‘lishi kerak' })
    }

    const u = req.user
    const userCtx = `Hozirgi foydalanuvchi: ${u.fullName || u.login} (login: ${u.login}), roli: ${u.role}.`

    let reply
    try {
      reply = provider === 'claude'
        ? await chatClaude(clean, userCtx, u, req)
        : await chatGemini(clean, userCtx, u, req)
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'AI kaliti noto‘g‘ri — ANTHROPIC_API_KEY tekshirilsin' })
      if (e instanceof Anthropic.RateLimitError) return res.status(503).json({ error: 'AI hozir band — bir ozdan keyin qayta urinib ko‘ring' })
      if (e instanceof Anthropic.APIError) return res.status(502).json({ error: `AI xatosi: ${e.message}` })
      if (e.status) return res.status(e.status).json({ error: e.message })
      throw e
    }

    res.json({ reply: reply || 'Javob topilmadi — savolni boshqacha yozib ko‘ring.' })
  }))

  return router
}
