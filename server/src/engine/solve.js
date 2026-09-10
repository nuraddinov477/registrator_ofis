import { loadData } from './loadData.js'
import { greedyConstruct } from './greedy.js'
import { anneal } from './anneal.js'
import { totalSoft } from './constraints.js'
import { dayOf, pairOf, allowedSlots } from './timeslots.js'

// Aniq, tushunarli tashxis — nima uchun jadval to'liq tuzilmadi (UI'da ko'rsatiladi).
// Har bir muammoni ANIQ manzili bilan qaytaradi: qaysi guruh/o'qituvchi/dars va nega.
export function buildDiagnostics(ctx) {
  const afternoonCourses = ctx.afternoonCourses || [1]
  const gName = new Map(), gCourse = new Map()
  for (const ev of ctx.events) {
    ev.groupIds.forEach((gid, k) => {
      if (!gName.has(gid)) gName.set(gid, ev.groupNames?.[k] || `#${gid}`)
      if (!gCourse.has(gid)) gCourse.set(gid, ev.course ?? 1)
    })
  }

  // 1) Guruh yuklamasi haftalik bo'sh joydan oshib ketgan
  const groupOverload = []
  for (const [gid, evs] of ctx.byGroup) {
    const course = gCourse.get(gid) ?? 1
    const capacity = allowedSlots(course, afternoonCourses).length // haftalik mavjud slot
    const needed = evs.length
    if (needed > capacity) {
      groupOverload.push({
        group: gName.get(gid), course, needed, capacity,
        shift: afternoonCourses.includes(course) ? '2-smena (4,5,6-juftlik)' : '1-smena (1,2,3,4-juftlik)',
      })
    }
  }

  // 2) O'qituvchi yuklamasi mavjud bo'sh vaqtdan oshgan
  const teacherOverload = []
  for (const [, evs] of ctx.byTeacher) {
    const avail = new Set()
    for (const e of evs) for (const s of e.slots) avail.add(s)
    if (evs.length > avail.size) {
      teacherOverload.push({ teacher: evs[0].teacherName || `#${evs[0].teacherId}`, needed: evs.length, capacity: avail.size })
    }
  }

  // 3) Xonasiz / vaqtsiz qolgan darslar — yuklama bo'yicha guruhlab, sababi bilan
  const seen = new Map()
  for (const e of ctx.infeasible) {
    const key = `${e.workloadId}|${e.reason}`
    if (!seen.has(key)) {
      seen.set(key, { group: e.groupNames?.join(', '), subject: e.subjectName, teacher: e.teacherName, reason: e.reason, count: 0 })
    }
    seen.get(key).count++
  }
  const blocked = [...seen.values()]

  // 4) Nomzodi bor, lekin solver joylay olmagan (haqiqiy "toza" o'ta yuklama / to'qnashuv).
  //    Faqat solve BAJARILGANDAN keyin ma'noli — yaratishdan oldingi tekshiruvda o'tkazib yuboriladi.
  const unresolved = []
  const solved = ctx.events.some((e) => e.slot >= 0)
  if (solved) {
    const un = new Map()
    for (const e of ctx.events) {
      if (e.slot >= 0 && e.room >= 0) continue
      if (ctx.infeasible.includes(e)) continue // sababi yuqorida ko'rsatilgan
      const key = `${e.workloadId}`
      if (!un.has(key)) un.set(key, { group: e.groupNames?.join(', '), subject: e.subjectName, teacher: e.teacherName, count: 0 })
      un.get(key).count++
    }
    for (const v of un.values()) unresolved.push(v)
  }

  return { groupOverload, teacherOverload, blocked, unresolved }
}

// Mustaqil tekshiruv — occupancy'ga ishonmasdan, noldan qattiq cheklovlarni sanaydi.
function verify(ctx) {
  const gm = new Map(), tm = new Map(), rm = new Map()
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1)
  let unplaced = 0
  for (const e of ctx.events) {
    if (e.slot < 0 || e.room < 0) { unplaced++; continue }
    for (const gid of e.groupIds) bump(gm, `${gid}|${e.slot}`)
    bump(tm, `${e.teacherId}|${e.slot}`)
    bump(rm, `${e.room}|${e.slot}`)
  }
  const excess = (m) => { let x = 0; for (const v of m.values()) if (v > 1) x += v - 1; return x }
  const breakdown = { group: excess(gm), teacher: excess(tm), room: excess(rm) }
  const hard = breakdown.group + breakdown.teacher + breakdown.room
  return {
    hard,
    breakdown,
    soft: Math.round(totalSoft(ctx)),
    feasible: hard === 0 && unplaced === 0,
    unplaced,
    infeasibleEvents: ctx.infeasible.map((e) => ({ group: e.groupNames?.join(', '), subject: e.subjectName, reason: e.reason || 'mos xona yo\'q' })),
  }
}

// To'liq gibrid yechim: yuklash → greedy → simulated annealing → tekshirish
export async function solve(prisma, options = {}) {
  const { semester = 1, maxMs = 5000, afternoonCourses = [1], ...annealOpts } = options
  const ctx = await loadData(prisma, semester, { afternoonCourses })

  if (ctx.events.length === 0) {
    return { ctx, semester, empty: true, report: { hard: 0, soft: 0, feasible: true, unplaced: 0, breakdown: { group: 0, teacher: 0, room: 0 }, infeasibleEvents: [] }, diagnostics: { groupOverload: [], teacherOverload: [], blocked: [], unresolved: [] }, entries: [] }
  }

  greedyConstruct(ctx)
  const greedy = { hard: verify(ctx).hard, soft: Math.round(totalSoft(ctx)) }

  // SA uchun occupancy'ni qayta quramiz (greedy occ'dan foydalansak ham bo'lardi)
  const { Occupancy } = await import('./occupancy.js')
  const occ = new Occupancy()
  for (const e of ctx.events) if (e.slot >= 0 && e.room >= 0) occ.place(e)

  const annealStats = anneal(ctx, occ, { maxMs, ...annealOpts })
  const report = verify(ctx)
  const diagnostics = buildDiagnostics(ctx)

  // Potok: bitta event bir nechta guruhga tegishli bo'lsa ham, ScheduleEntry (chiqish)
  // HAR GURUH uchun alohida qator bo'lib yoziladi — har guruh o'z jadvalini avvalgidek ko'radi
  const entries = ctx.events
    .filter((e) => e.slot >= 0 && e.room >= 0)
    .flatMap((e) => e.groupIds.map((groupId) => ({
      groupId, teacherId: e.teacherId, subjectId: e.subjectId,
      roomId: e.room, day: dayOf(e.slot), pair: pairOf(e.slot), type: e.type,
    })))

  return { ctx, semester, report, diagnostics, greedy, anneal: annealStats, entries, events: ctx.events.length }
}

// Bitta guruh uchun 6×5 jadval matritsasi (CLI/preview uchun)
export function buildGroupGrid(ctx, groupId) {
  const evs = ctx.byGroup.get(groupId) || []
  const grid = Array.from({ length: 6 }, () => Array(5).fill(null))
  for (const e of evs) {
    if (e.slot < 0) continue
    grid[pairOf(e.slot) - 1][dayOf(e.slot)] = {
      subject: e.subjectName, teacher: e.teacherName, room: e.room, type: e.type,
    }
  }
  return grid
}
