import { loadData } from './loadData.js'
import { greedyConstruct } from './greedy.js'
import { anneal } from './anneal.js'
import { groupGapPairs, totalSoft } from './constraints.js'
import { polishGaps, rebuildOccupancy, reinsert, removeConflicts } from './repair.js'
import { dayOf, pairOf, allowedSlots, DAY_NAMES, PAIR_TIMES } from './timeslots.js'

// To'liq gibrid yechim: yuklash → greedy → simulated annealing → to'qnashuvlarni tozalash va qayta joylash →
// qat'iy annealing (faqat to'qnashuvsiz harakatlar) → oynalarni sayqallash → tekshirish + aniq tashxis.
//
// Yakuniy jadvalda guruh / o'qituvchi / xona to'qnashuvi BO'LMAYDI: joy topilmagan dars joylanmagan qoladi.

export const MIN_WEEKLY_LESSONS = 14
export const MAX_WEEKLY_LESSONS = 15

// Aniq, tushunarli tashxis — nima uchun jadval to'liq tuzilmadi (UI'da ko'rsatiladi).
// Har bir muammoni ANIQ manzili bilan qaytaradi: qaysi guruh/o'qituvchi/dars va nega.
export function buildDiagnostics(ctx) {
  const gName = new Map(), gCourse = new Map()
  for (const ev of ctx.events) {
    ev.groupIds.forEach((gid, k) => {
      if (!gName.has(gid)) gName.set(gid, ev.groupNames?.[k] || `#${gid}`)
      if (!gCourse.has(gid)) gCourse.set(gid, ev.course ?? 1)
    })
  }
  const gStart = ctx.groupStart, gEnd = ctx.groupEnd

  // 1) Guruh yuklamasi haftalik bo'sh joydan oshib ketgan
  const groupOverload = []
  for (const [gid, evs] of ctx.byGroup) {
    const start = gStart.get(gid) ?? 1
    const end = gEnd.get(gid) ?? 6
    const capacity = allowedSlots(start, end).length // haftalik mavjud slot
    if (evs.length > capacity) {
      groupOverload.push({
        groupId: gid, group: gName.get(gid), course: gCourse.get(gid) ?? 1, needed: evs.length, capacity,
        shift: `${start}-${end}-juftlik oralig'i (${PAIR_TIMES[start - 1]} – ${PAIR_TIMES[end - 1]})`,
      })
    }
  }

  // 1.5) Guruhning haftalik dars soni sog'lom me'yordan (14-15) tashqarida — bu SLOT sig'imidan
  // (groupOverload) farqli ABSOLYUT me'yor: jadval yaratishga to'sqinlik qilmaydi, faqat OGOHLANTIRADI
  // (Yuklama noto'g'ri kiritilgan bo'lishi mumkin: juda ko'p yoki juda kam fan/soat biriktirilgan)
  const loadWarnings = []
  for (const [gid, evs] of ctx.byGroup) {
    const needed = evs.length
    if (needed > MAX_WEEKLY_LESSONS || needed < MIN_WEEKLY_LESSONS) {
      loadWarnings.push({
        groupId: gid, group: gName.get(gid) ?? `#${gid}`, course: gCourse.get(gid) ?? 1, needed,
        kind: needed > MAX_WEEKLY_LESSONS ? 'kop' : 'kam',
      })
    }
  }

  // 2) O'qituvchi yuklamasi mavjud bo'sh vaqtdan oshgan
  const teacherOverload = []
  for (const evs of ctx.byTeacher.values()) {
    const available = new Set()
    for (const e of evs) for (const s of e.slots) available.add(s)
    if (evs.length > available.size) {
      teacherOverload.push({
        teacherId: evs[0].teacherId, teacher: evs[0].teacherName || `#${evs[0].teacherId}`,
        needed: evs.length, capacity: available.size,
      })
    }
  }

  // 3) Xonasiz / vaqtsiz qolgan darslar — yuklama bo'yicha guruhlab, sababi bilan
  const seen = new Map()
  for (const e of ctx.infeasible) {
    const key = `${e.workloadId}|${e.part}|${e.reason}`
    if (!seen.has(key)) {
      seen.set(key, {
        group: e.groupNames.join(', '), subject: e.subjectName, teacher: e.teacherName, reason: e.reason,
        count: 0, workloadId: e.workloadId, groupIds: e.uniqueGroupIds, teacherId: e.teacherId,
        subjectId: e.subjectId, size: e.groupSize, kind: e.blockKind, suggestions: e.suggestions,
        part: e.part,
      })
    }
    seen.get(key).count++
  }
  const blocked = [...seen.values()]

  // 4) Nomzodi bor, lekin solver joylay olmagan — faqat solve BAJARILGANDAN keyin ma'noli
  //    (yaratishdan oldingi tekshiruvda o'tkazib yuboriladi)
  const unresolved = []
  const gaps = []
  if (ctx.events.some((e) => e.slot >= 0)) {
    // 5) Yo'qotib bo'lmagan oynalar (darslar orasidagi bo'sh juftlik, QAT'IY taqiqlangan)
    for (const [gid, evs] of ctx.byGroup) {
      for (const [day, pairs] of groupGapPairs(evs)) {
        gaps.push({ groupId: gid, group: gName.get(gid), day, dayName: DAY_NAMES[day], pairs })
      }
    }
    const infeasibleIds = new Set(ctx.infeasible.map((e) => e.id))
    const pending = new Map()
    for (const e of ctx.events) {
      if ((e.slot >= 0 && e.room >= 0) || infeasibleIds.has(e.id)) continue
      const key = `${e.workloadId}|${e.part}`
      if (!pending.has(key)) {
        pending.set(key, {
          group: e.groupNames.join(', '), subject: e.subjectName, teacher: e.teacherName, count: 0,
          workloadId: e.workloadId, groupIds: e.uniqueGroupIds, teacherId: e.teacherId, part: e.part,
        })
      }
      pending.get(key).count++
    }
    unresolved.push(...pending.values())
  }

  return { groupOverload, teacherOverload, blocked, unresolved, loadWarnings, gaps }
}

// Mustaqil tekshiruv — occupancy'ga ishonmasdan, noldan qattiq cheklovlarni sanaydi
export function verify(ctx) {
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
  // Oyna (guruhda darslar orasidagi bo'sh juftlik) ham qattiq buzilish
  let gapCount = 0
  for (const evs of ctx.byGroup.values()) for (const pairs of groupGapPairs(evs).values()) gapCount += pairs.length
  const breakdown = { group: excess(gm), teacher: excess(tm), room: excess(rm), gap: gapCount }
  const hard = breakdown.group + breakdown.teacher + breakdown.room + breakdown.gap
  return {
    hard,
    breakdown,
    soft: Math.round(totalSoft(ctx)),
    feasible: hard === 0 && unplaced === 0,
    unplaced,
    infeasibleEvents: ctx.infeasible.map((e) => ({
      group: e.groupNames.join(', '), subject: e.subjectName, reason: e.reason || "mos xona yo'q",
    })),
  }
}

export function solveContext(ctx, options = {}) {
  const { maxMs = 5000, ...annealOpts } = options
  if (ctx.events.length === 0) {
    return {
      ctx, semester: ctx.semester, empty: true,
      report: {
        hard: 0, soft: 0, feasible: true, unplaced: 0,
        breakdown: { group: 0, teacher: 0, room: 0, gap: 0 }, infeasibleEvents: [],
      },
      diagnostics: { groupOverload: [], teacherOverload: [], blocked: [], unresolved: [], loadWarnings: [], gaps: [] },
      entries: [],
    }
  }

  const started = performance.now()
  const leftUntil = (share) => Math.max(0, Math.floor(started + maxMs * share - performance.now()))

  greedyConstruct(ctx)
  const greedy = { hard: verify(ctx).hard, soft: Math.round(totalSoft(ctx)) }

  // 1) to'qnashuvlar katta jarima bilan kamaytiriladi (anneal eng yaxshi holatni qaytaradi — bandlik qayta quriladi)
  const firstRound = anneal(ctx, rebuildOccupancy(ctx), { ...annealOpts, maxMs: leftUntil(0.5) })
  // 2) qolgan to'qnashuvlardagi darslar olinadi va to'qnashuvsiz qayta joylanadi
  let occ = rebuildOccupancy(ctx)
  let removed = removeConflicts(ctx, occ)
  let placed = reinsert(ctx, occ, started + maxMs * 0.6)
  // 3) qat'iy rejim: to'qnashuvsiz jadval saqlanib, oynalar va jarima kamaytiriladi. Bir necha davra —
  //    darslar surilgach bo'sh joy ochilishi mumkin, har davradan keyin joysiz darslar qayta joylanadi
  const rounds = []
  for (const share of [0.7, 0.8, 0.9]) {
    rounds.push(anneal(ctx, occ, { ...annealOpts, maxMs: leftUntil(share), strict: true }))
    occ = rebuildOccupancy(ctx)
    placed += reinsert(ctx, occ, performance.now() + Math.max(300, maxMs * 0.03))
  }
  // 4) qolgan oynalarni tasodifiy bo'lmagan usulda yopishga urinish (to'qnashuvsiz)
  const polished = polishGaps(ctx, occ, Math.max(started + maxMs * 0.99, performance.now() + 300))
  removed += removeConflicts(ctx, occ) // kafolat: bu yerda doim 0
  const annealStats = { ...firstRound, strict: rounds, removed, reinserted: placed, polished }
  const report = verify(ctx)
  const diagnostics = buildDiagnostics(ctx)

  // Potok: bitta event bir nechta guruhga tegishli bo'lsa ham, ScheduleEntry (chiqish)
  // HAR GURUH uchun alohida qator bo'lib yoziladi — har guruh o'z jadvalini ko'radi
  const entries = ctx.events
    .filter((e) => e.slot >= 0 && e.room >= 0)
    .flatMap((e) => e.groupIds.map((groupId) => ({
      groupId, teacherId: e.teacherId, subjectId: e.subjectId,
      roomId: e.room, day: dayOf(e.slot), pair: pairOf(e.slot), type: e.type,
    })))

  return {
    ctx, semester: ctx.semester, report, diagnostics, greedy, anneal: annealStats, entries,
    events: ctx.events.length,
  }
}

export async function solve(prisma, options = {}) {
  const { semester = 1, groupStartPairs = {}, groupEndPairs = {}, ...rest } = options
  const ctx = await loadData(prisma, semester, { groupStartPairs, groupEndPairs })
  return solveContext(ctx, rest)
}

// Bitta guruh uchun 6×5 jadval matritsasi (CLI/preview uchun)
export function buildGroupGrid(ctx, groupId) {
  const grid = Array.from({ length: 6 }, () => Array(5).fill(null))
  for (const e of ctx.byGroup.get(groupId) || []) {
    if (e.slot < 0) continue
    grid[pairOf(e.slot) - 1][dayOf(e.slot)] = {
      subject: e.subjectName, teacher: e.teacherName, room: e.room, type: e.type,
    }
  }
  return grid
}
