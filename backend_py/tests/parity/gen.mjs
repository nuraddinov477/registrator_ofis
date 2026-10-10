// Differensial sinov (1/2): tasodifiy instance'lar → JS engine natijalari (Python port uchun etalon).
// Ishga tushirish: node gen.mjs <soni> <base_seed> <chiqish_papkasi>
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
// Etalon JS engine papkasi: ENGINE_DIR (mutlaq yo'l) yoki shu repodagi server/src/engine/
const ROOT = (process.env.ENGINE_DIR || new URL('../../../server/src/engine/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).replace(/\/?$/, '/')
const { buildContext } = await import(pathToFileURL(ROOT + 'loadData.js').href)
const { greedyConstruct } = await import(pathToFileURL(ROOT + 'greedy.js').href)
const { solveContext } = await import(pathToFileURL(ROOT + 'solve.js').href)
const { Occupancy } = await import(pathToFileURL(ROOT + 'occupancy.js').href)

function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const N = Number(process.argv[2] || 12)
const SEED0 = Number(process.argv[3] || 1)
const OUT = process.argv[4]
const pickR = (r, l) => l[Math.floor(r() * l.length)]
const ri = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1))
const TYPES = ['Ma\u02bcruza', 'Seminar', 'Amaliy']

function makeInstance(seed) {
  const R = seeded(seed)
  const nG = ri(R, 3, 8)
  const groups = []
  for (let g = 1; g <= nG; g++) groups.push({ id: g, name: `G${g}`, size: ri(R, 15, 115), course: ri(R, 1, 4),
    facultyId: pickR(R, [1, 2, null]), specialtyId: pickR(R, [1, 2, null]) })
  const nR = ri(R, 4, 10)
  const rooms = []
  for (let r = 1; r <= nR; r++) {
    const type = pickR(R, ['umumiy', 'umumiy', 'maxsus'])
    const permissions = []
    if (type === 'maxsus' || R() < 0.3) {
      const k = ri(R, 0, 2)
      for (let p = 0; p < k; p++) permissions.push({ teacherId: pickR(R, [null, 1, 2, 3]), groupId: pickR(R, [null, 1, 2, 3, nG]),
        specialtyId: pickR(R, [null, 1]), subjectId: pickR(R, [null, 1, 2, 3]), exclusive: R() < 0.3 })
    }
    const fac = pickR(R, [[], [1], [2], [1, 2]])
    rooms.push({ id: r, name: `R${r}`, capacity: pickR(R, [20, 30, 40, 60, 70, 90, 100, 120]), type, permissions,
      building: { faculties: fac.map((id) => ({ id })) } })
  }
  const workloads = []
  const nW = ri(R, 6, 18)
  for (let w = 1; w <= nW; w++) {
    const gk = ri(R, 1, Math.min(3, nG))
    const gs = []
    while (gs.length < gk) { const g = ri(R, 1, nG); if (!gs.includes(g)) gs.push(g) }
    gs.sort((a, b) => a - b)
    const groupsArr = gs.map((g) => ({ groupId: g, group: groups[g - 1] }))
    const subj = ri(R, 1, 6)
    workloads.push({ id: w, teacherId: ri(R, 1, 4), subjectId: subj, weeklyHours: pickR(R, [1, 2, 2, 3]),
      type: pickR(R, TYPES), semester: 1, archived: false, groups: groupsArr,
      teacher: { fullName: `T${w}` }, subject: { name: `S${subj}`, difficulty: ri(R, 1, 5) } })
  }
  const constraints = []
  for (let t = 1; t <= 4; t++) if (R() < 0.4) {
    constraints.push({ teacherId: t, blockedDays: R() < 0.5 ? JSON.stringify([ri(R, 0, 4)]) : null,
      allowedPairs: R() < 0.4 ? JSON.stringify([1, 2, 3, 4, 5]) : null })
  }
  const starts = {}, ends = {}
  for (let g = 1; g <= nG; g++) if (R() < 0.3) starts[g] = ri(R, 1, 3)
  for (let g = 1; g <= nG; g++) if (R() < 0.3) ends[g] = ri(R, 4, 6)
  return { workloads, rooms, constraints, starts, ends, groups }
}

function evSummary(ctx) {
  return ctx.events.map((e) => ({ id: e.id, workloadId: e.workloadId, groupIds: e.groupIds, teacherId: e.teacherId,
    subjectId: e.subjectId, type: e.type, part: e.part, slots: e.slots, rooms: e.rooms, roomCapacities: e.roomCapacities,
    reason: e.reason, blockKind: e.blockKind, suggestions: e.suggestions, slot: e.slot, room: e.room,
    groupSize: e.groupSize, facultyIds: e.facultyIds, assignedRooms: e.assignedRooms }))
}

const results = []
for (let k = 0; k < N; k++) {
  const seed = SEED0 + k
  const inst = makeInstance(seed)
  const ctx0 = buildContext(inst.workloads, inst.rooms, inst.constraints, 1, inst.starts, inst.ends)
  const build = { events: evSummary(ctx0), infeasible: ctx0.infeasible.map((e) => e.id) }
  greedyConstruct(ctx0)
  const greedySlots = ctx0.events.map((e) => [e.slot, e.room])
  const ctx = buildContext(inst.workloads, inst.rooms, inst.constraints, 1, inst.starts, inst.ends)
  const rand = seeded(seed + 1000)
  const res = solveContext(ctx, { maxMs: 1e8, rand })
  results.push({ seed, build, greedySlots, entries: res.entries, report: res.report,
    diagnostics: res.diagnostics, greedy: res.greedy, empty: !!res.empty,
    annealIters: res.anneal ? { first: res.anneal.iterations, first_acc: res.anneal.accepted,
      strict: res.anneal.strict.map((s) => [s.iterations, s.accepted]), removed: res.anneal.removed,
      reinserted: res.anneal.reinserted, polished: res.anneal.polished } : null })
  writeFileSync(`${OUT}/inst_${seed}.json`, JSON.stringify(inst))
  process.stdout.write(`seed ${seed}: events=${ctx.events.length} hard=${res.report.hard} soft=${res.report.soft} entries=${res.entries.length} feasible=${res.report.feasible}\n`)
}
writeFileSync(`${OUT}/expected_${SEED0}.json`, JSON.stringify(results))
console.log('done')
