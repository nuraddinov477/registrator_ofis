import { loadData } from './loadData.js'
import { greedyConstruct } from './greedy.js'
import { anneal } from './anneal.js'
import { totalSoft } from './constraints.js'
import { dayOf, pairOf } from './timeslots.js'

// Mustaqil tekshiruv — occupancy'ga ishonmasdan, noldan qattiq cheklovlarni sanaydi.
function verify(ctx) {
  const gm = new Map(), tm = new Map(), rm = new Map()
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1)
  let unplaced = 0
  for (const e of ctx.events) {
    if (e.slot < 0 || e.room < 0) { unplaced++; continue }
    bump(gm, `${e.groupId}|${e.slot}`)
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
    infeasibleEvents: ctx.infeasible.map((e) => ({ group: e.groupName, subject: e.subjectName, reason: 'mos xona yo\'q' })),
  }
}

// To'liq gibrid yechim: yuklash → greedy → simulated annealing → tekshirish
export async function solve(prisma, options = {}) {
  const { semester = 1, maxMs = 5000, ...annealOpts } = options
  const ctx = await loadData(prisma, semester)

  if (ctx.events.length === 0) {
    return { ctx, semester, empty: true, report: { hard: 0, soft: 0, feasible: true, unplaced: 0, breakdown: { group: 0, teacher: 0, room: 0 }, infeasibleEvents: [] }, entries: [] }
  }

  greedyConstruct(ctx)
  const greedy = { hard: verify(ctx).hard, soft: Math.round(totalSoft(ctx)) }

  // SA uchun occupancy'ni qayta quramiz (greedy occ'dan foydalansak ham bo'lardi)
  const { Occupancy } = await import('./occupancy.js')
  const occ = new Occupancy()
  for (const e of ctx.events) if (e.slot >= 0 && e.room >= 0) occ.place(e)

  const annealStats = anneal(ctx, occ, { maxMs, ...annealOpts })
  const report = verify(ctx)

  const entries = ctx.events
    .filter((e) => e.slot >= 0 && e.room >= 0)
    .map((e) => ({
      groupId: e.groupId, teacherId: e.teacherId, subjectId: e.subjectId,
      roomId: e.room, day: dayOf(e.slot), pair: pairOf(e.slot),
    }))

  return { ctx, semester, report, greedy, anneal: annealStats, entries, events: ctx.events.length }
}

// Bitta guruh uchun 6×5 jadval matritsasi (CLI/preview uchun)
export function buildGroupGrid(ctx, groupId) {
  const evs = ctx.byGroup.get(groupId) || []
  const grid = Array.from({ length: 6 }, () => Array(5).fill(null))
  for (const e of evs) {
    if (e.slot < 0) continue
    grid[pairOf(e.slot) - 1][dayOf(e.slot)] = {
      subject: e.subjectName, teacher: e.teacherName, room: e.room,
    }
  }
  return grid
}
