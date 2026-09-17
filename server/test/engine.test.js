// Engine testlari — qat'iy qoidalar, tashxis va annealing izchilligi.
//   npm test  (server papkasida)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { anneal } from '../src/engine/anneal.js'
import { groupCost, groupEval, groupGapPairs, teacherCost, totalGaps, totalSoft } from '../src/engine/constraints.js'
import { greedyConstruct } from '../src/engine/greedy.js'
import { buildContext } from '../src/engine/loadData.js'
import { Occupancy } from '../src/engine/occupancy.js'
import { polishGaps, rebuildOccupancy, reinsert, removeConflicts } from '../src/engine/repair.js'
import { buildDiagnostics, solveContext, verify } from '../src/engine/solve.js'
import { dayOf, pairOf } from '../src/engine/timeslots.js'

// Takrorlanadigan tasodifiy sonlar (mulberry32)
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
const pick = (rand, list) => list[Math.floor(rand() * list.length)]
const randInt = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))

const group = (id, { size = 25, faculty = null, specialty = null, course = 1 } = {}) =>
  ({ id, name: `G${id}`, course, size, facultyId: faculty, specialtyId: specialty })

const room = (id, capacity = 30, { faculties = [], type = 'umumiy', permissions = [] } = {}) => {
  const base = { teacherId: null, groupId: null, specialtyId: null, subjectId: null, exclusive: false }
  return {
    id, name: `R${id}`, capacity, type,
    permissions: permissions.map((p) => ({ ...base, ...p })),
    building: { faculties: faculties.map((f) => ({ id: f })) },
  }
}

let nextId = 1
const workload = (groups, { teacher = 1, subject = 1, hours = 1, type = 'Amaliy', difficulty = 3 } = {}) => ({
  id: nextId++, teacherId: teacher, subjectId: subject, weeklyHours: hours, type,
  groups: groups.map((g) => ({ groupId: g.id, group: g })),
  teacher: { fullName: `T${teacher}` }, subject: { name: `S${subject}`, difficulty },
})

const build = (workloads, rooms, constraints = [], starts = {}, ends = {}) =>
  buildContext(workloads, rooms, constraints, 1, starts, ends)

const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)

test("sig'im va maxsus xona qoidalari", () => {
  const g = group(1, { size: 28, specialty: 7 })
  const ctx = build([workload([g])], [
    room(1, 20), room(2, 30, { type: 'maxsus' }),
    room(3, 30, { type: 'maxsus', permissions: [{ specialtyId: 7 }] }), room(4, 40),
  ])
  assert.deepEqual(ctx.events[0].rooms, [3, 4]) // sig'imi yetmaydigan va ruxsatsiz maxsus xona chiqib ketadi
})

test('fakultet binosi va ruxsat bilan chetlab o\'tish', () => {
  const g = group(1, { faculty: 1 })
  const other = room(1, 30, { faculties: [2] })
  const allowed = room(2, 30, { faculties: [2], permissions: [{ groupId: 1 }] })
  const ctx = build([workload([g])], [other, allowed, room(3, 30, { faculties: [1, 3] })])
  assert.deepEqual(ctx.events[0].rooms, [2, 3]) // aniq ruxsat bino egaligini chetlab o'tadi va ustuvor
})

test('katta zallar faqat 65-105 talaba uchun', () => {
  const small = group(1, { size: 40, faculty: 1 })
  const potok = [group(2, { size: 40, faculty: 1 }), group(3, { size: 40, faculty: 1 })]
  const rooms = [room(1, 90), room(2, 80, { faculties: [1] }), room(3, 45, { faculties: [1] })]
  const ctx = build([
    workload([small]),
    workload(potok, { subject: 2, hours: 3 }),
    workload([group(4, { size: 30, faculty: 1 })], { subject: 3, type: 'Maʼruza' }),
    workload([group(5, { size: 50, faculty: 1 })], { subject: 4 }),
    workload([group(6, { size: 110, faculty: 1 })], { subject: 5 }),
  ], rooms)
  const byWorkload = new Map()
  for (const e of ctx.events) byWorkload.set(e.workloadId, e)
  const rows = [...byWorkload.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e)
  assert.deepEqual(rows[0].rooms, [3]) // 40 talaba — hech qaysi katta zalga tushmaydi
  assert.deepEqual(rows[1].rooms, [1, 2]) // 80 talabali potok — katta zallar, eng kattasi oldinda
  assert.deepEqual(rows[2].rooms, [3]) // kichik ma'ruza ham faqat oddiy xonada
  assert.deepEqual(rows[3].rooms, [])
  assert.match(rows[3].reason, /katta zallar esa faqat 65-105/)
  assert.equal(rows[3].blockKind, 'between')
  assert.deepEqual(rows[3].suggestions.map((x) => x.code), ['hall_size', 'hall_size', 'capacity'])
  assert.deepEqual(rows[4].rooms, []) // 105 dan ko'p — katta zal ham berilmaydi

  // fanning o'z xonasi (sport zali) — hajm qoidasi qo'llanilmaydi
  const gym = room(9, 65, { type: 'maxsus', faculties: [1], permissions: [{ subjectId: 7 }] })
  const ctx2 = build([
    workload([group(7, { size: 25, faculty: 1 })], { subject: 7 }),
    workload([group(8, { size: 62, faculty: 1 })], { subject: 8 }),
  ], [gym])
  assert.deepEqual(ctx2.events[0].rooms, [9])
  assert.deepEqual(ctx2.events[1].rooms, [])
  assert.deepEqual(ctx2.events[1].suggestions, []) // boshqa fanning sport zali tavsiya qilinmaydi
})

test('katta seminar potoki ikkiga bo\'linadi', () => {
  const groups = [[1, 25], [2, 25], [3, 20], [4, 22]].map(([id, size]) => group(id, { size, faculty: 1 }))
  const rooms = [room(1, 55, { faculties: [1] }), room(2, 100)]
  const seminar = workload(groups, { subject: 1, hours: 2, type: 'Seminar' })
  const lecture = workload(groups, { subject: 1, hours: 1, type: 'Maʼruza' })
  const small = workload(groups.slice(0, 2), { subject: 2, hours: 1, type: 'Seminar' }) // 50 talaba — bo'linmaydi
  const ctx = build([seminar, lecture, small], rooms)
  const halves = ctx.events.filter((e) => e.workloadId === seminar.id)
  assert.equal(halves.length, 4)
  assert.deepEqual(new Set(halves.map((e) => e.part)), new Set(['1/2', '2/2']))
  assert.deepEqual([...new Set(halves.map((e) => e.groupIds.join(',')))].sort(), ['1,2', '3,4'])
  assert.ok(halves.every((e) => e.rooms.length === 1 && e.rooms[0] === 1)) // seminar katta zalga tushmaydi
  const whole = ctx.events.filter((e) => e.workloadId === lecture.id)
  assert.equal(whole.length, 1)
  assert.deepEqual(whole[0].groupIds, [1, 2, 3, 4])
  assert.equal(whole[0].part, null)
  assert.deepEqual(whole[0].rooms, [2])
  const kept = ctx.events.filter((e) => e.workloadId === small.id)
  assert.deepEqual(kept[0].groupIds, [1, 2])
  assert.equal(kept[0].part, null)

  const result = solveContext(ctx, { maxMs: 300 })
  assert.equal(result.report.hard, 0)
  assert.equal(result.report.unplaced, 0)
  const seminarRows = result.entries.filter((x) => x.subjectId === 1 && x.type === 'Seminar')
  assert.equal(seminarRows.length, 2 * 4) // har guruh haftasiga 2 ta seminar — o'z yarmi bilan
  const perSlot = new Map()
  for (const x of seminarRows) {
    const key = `${x.day}|${x.pair}`
    if (!perSlot.has(key)) perSlot.set(key, new Set())
    perSlot.get(key).add(x.groupId)
  }
  const sets = [...perSlot.values()].map((s) => [...s].sort().join(',')).sort()
  assert.deepEqual(sets, ['1,2', '1,2', '3,4', '3,4'])
})

test("2 para potok qoidasi", () => {
  const potok = [group(1, { size: 40 }), group(2, { size: 40 })]
  const rooms = [room(1, 90), room(2, 90, { faculties: [1] }), room(3, 100), room(4, 45)]
  let event = build([workload(potok, { hours: 2 })], rooms).events[0]
  assert.deepEqual(new Set(event.slots.map(dayOf)), new Set([0, 1, 2])) // faqat Dushanba–Chorshanba
  assert.deepEqual(event.rooms, [3, 1]) // faqat asosiy binodagi katta zal

  // katta zal uchun kichik potok — qoida qo'llanmaydi: istalgan kun, oddiy xona
  event = build([workload([group(5, { size: 20 }), group(6, { size: 20 })], { hours: 2 })], rooms).events[0]
  assert.deepEqual(new Set(event.slots.map(dayOf)), new Set([0, 1, 2, 3, 4]))
  assert.deepEqual(event.rooms, [4])
})

test("qat'iy biriktirilgan xona va to'qnashgan potok", () => {
  const a = group(1), b = group(2)
  const rooms = [
    room(1, 30, { permissions: [{ groupId: 1, exclusive: true }] }),
    room(2, 30, { permissions: [{ groupId: 2, exclusive: true }] }),
    room(3),
  ]
  const ctx = build([workload([a]), workload([a, b], { subject: 2 })], rooms)
  assert.deepEqual(ctx.events[0].rooms, [1])
  assert.deepEqual(ctx.events[1].rooms, [])
  assert.match(ctx.events[1].reason, /har xil xonaga/)
})

test("o'qituvchi istisnolari va guruh oralig'i", () => {
  const g = group(5)
  const constraints = [{ teacherId: 1, blockedDays: '[0, 4]', allowedPairs: '[2, 3, 4]' }]
  const slots = build([workload([g])], [room(1)], constraints, { 5: 3 }, { 5: 5 }).events[0].slots
  assert.deepEqual(new Set(slots.map(dayOf)), new Set([1, 2, 3]))
  assert.deepEqual(new Set(slots.map(pairOf)), new Set([3, 4]))

  const blocked = build([workload([g])], [room(1)], [{ teacherId: 1, blockedDays: '[0,1,2,3,4]', allowedPairs: null }])
  assert.ok(blocked.infeasible.length)
  assert.match(blocked.events[0].reason, /istisnolari/)
})

test("0 soat — bitta dars, manfiy — yo'q", () => {
  const ctx = build([workload([group(1)], { hours: 0 }), workload([group(2)], { hours: -1 })], [room(1)])
  assert.equal(ctx.events.length, 1)
})

test('tashxis', () => {
  const g = group(1)
  // 1-juftlik oralig'i: haftada 5 ta joy — 5 dars sig'adi, lekin haftalik me'yordan (14-15) kam
  const diag = buildDiagnostics(build([workload([g], { hours: 5 })], [room(1)], [], { 1: 1 }, { 1: 1 }))
  assert.deepEqual(diag.groupOverload, [])
  assert.deepEqual(diag.teacherOverload, [])
  assert.deepEqual(diag.loadWarnings, [{ groupId: 1, group: 'G1', course: 1, needed: 5, kind: 'kam' }])

  const over = buildDiagnostics(build([workload([g], { hours: 6 })], [room(1)], [], { 1: 1 }, { 1: 1 }))
  assert.equal(over.groupOverload[0].needed, 6)
  assert.equal(over.groupOverload[0].capacity, 5)
  assert.ok(over.groupOverload[0].shift.startsWith("1-1-juftlik oralig'i"))
  assert.equal(over.teacherOverload[0].capacity, 5)
  assert.equal(over.groupOverload[0].groupId, 1)
  assert.equal(over.teacherOverload[0].teacherId, 1)
})

test('joylanmagan darslarga xona tavsiyalari', () => {
  const g = group(1, { size: 30, faculty: 1 })
  const rooms = [
    room(1, 20), // kichik
    room(2, 35, { faculties: [2] }), // boshqa fakultet — ruxsat bilan yechiladi
    room(3, 32, { type: 'maxsus' }), // maxsus — ruxsat bilan yechiladi
    room(4, 90), // asosiy binodagi katta zal — 30 talabaga emas
  ]
  const row = workload([g])
  let blocked = buildDiagnostics(build([row], rooms)).blocked[0]
  assert.equal(blocked.kind, 'room')
  assert.equal(blocked.workloadId, row.id)
  assert.deepEqual(blocked.groupIds, [1])
  assert.deepEqual(blocked.suggestions.map((x) => [x.roomId, x.code, x.fixable]), [[3, 'special', true], [2, 'faculty', true]])

  // ruxsat bilan yechib bo'lmasa — boshqa sabablar va eng katta xonalar
  let suggestions = buildDiagnostics(build([workload([group(2, { size: 120 })])], rooms)).blocked[0].suggestions
  assert.deepEqual(suggestions.map((x) => x.code), ['capacity', 'capacity', 'capacity'])
  assert.deepEqual(suggestions.map((x) => x.roomId), [4, 2, 3])
  assert.match(suggestions[0].problem, /120 talabaga sig'maydi/)

  // bir xil sabab va sig'imdagi xonalar bitta qatorga yig'iladi
  suggestions = buildDiagnostics(build([workload([group(8, { size: 40 })])], [...rooms, room(5, 90)])).blocked[0].suggestions
  assert.deepEqual([suggestions[0].roomId, suggestions[0].code, suggestions[0].more], [4, 'hall_size', 1])

  // "2 para" potok (65-105 talaba) — asosiy binoda katta zal yo'q bo'lsa
  const bigPotok = [group(5, { size: 35 }), group(6, { size: 35 })]
  blocked = buildDiagnostics(build([workload(bigPotok, { hours: 2 })], [room(1, 30), room(6, 90, { faculties: [2] })])).blocked[0]
  assert.equal(blocked.kind, 'two_para')
  assert.equal(blocked.size, 70)
  assert.deepEqual(blocked.suggestions, [])

  // guruhsiz yuklama — joylanmaydi, sababi aniq
  let ctx = build([workload([])], rooms)
  blocked = buildDiagnostics(ctx).blocked[0]
  assert.equal(blocked.kind, 'no_group')
  assert.deepEqual(blocked.suggestions, [])
  assert.match(blocked.reason, /guruh biriktirilmagan/)
  assert.ok(solveContext(ctx, { maxMs: 50 }).ctx.events.every((e) => e.slot < 0))

  // vaqt yetmasa — xona tavsiyasi yo'q, sabab turi "time"
  ctx = build([workload([g])], rooms, [{ teacherId: 1, blockedDays: '[0,1,2,3,4]', allowedPairs: null }])
  blocked = buildDiagnostics(ctx).blocked[0]
  assert.equal(blocked.kind, 'time')
  assert.deepEqual(blocked.suggestions, [])
  assert.equal(blocked.teacherId, 1)
})

const placed = (ctx, layout) => {
  ctx.events.forEach((e, i) => { if (i < layout.length) [e.slot, e.room] = layout[i] })
  return ctx
}

const placedAt = (ctx, layout) => {
  const occ = new Occupancy()
  ctx.events.forEach((e, i) => {
    if (i >= layout.length) return
    ;[e.slot, e.room] = layout[i]
    occ.place(e)
  })
  return occ
}

test('jarima: oynalar va limitdan oshgan oyna', () => {
  const g = group(1, { size: 28 }) // 30 o'rinli xonada roomFit jarimasi yo'q (+2 tolerantlik)
  const ctx = build([workload([g], { subject: 1 }), workload([g], { subject: 2 })], [room(1)])
  // Dushanba 1- va 4-juftlik: 2 ta oyna → 2² × 40 + (2−1) × 150; kunlik 2 dars → 2² × 0.5
  placed(ctx, [[0, 1], [3, 1]])
  assert.equal(groupCost(ctx.byGroup.get(1)), 4 * 40 + 150 + 2)
  // Ikkala dars bitta o'qituvchida: bitta ish kuni (2) + 2 ta oyna → 2² × 20
  assert.equal(teacherCost(ctx.byTeacher.get(1)), 2 + 4 * 20)
  // ketma-ket ikki xil fan (1- va 2-juftlik): subjectAdjacent 20
  placed(ctx, [[0, 1], [1, 1]])
  assert.equal(groupCost(ctx.byGroup.get(1)), 20 + 2)
  assert.equal(teacherCost(ctx.byTeacher.get(1)), 2)
})

test('oyna — faqat darslar orasidagi bo\'sh juftlik', () => {
  const g = group(1, { size: 28 })
  const ctx = build([1, 2, 3].map((k) => workload([g], { subject: k })), [room(1)])
  // Dushanba 1-, 4- va 5-juftlik: 2- va 3-juftlik oyna (qattiq)
  placed(ctx, [[0, 1], [3, 1], [4, 1]])
  assert.equal(groupEval(ctx.byGroup.get(1), 1)[1], 2)
  assert.deepEqual([...groupGapPairs(ctx.byGroup.get(1))], [[0, [2, 3]]])
  assert.equal(verify(ctx).breakdown.gap, 2)
  assert.equal(verify(ctx).hard, 2)
  // Seshanba 3-5-juftlik: kech boshlanish oyna EMAS (faqat yumshoq jarima)
  placed(ctx, [[8, 1], [9, 1], [10, 1]])
  assert.equal(groupEval(ctx.byGroup.get(1), 1)[1], 0)
  assert.equal(totalGaps(ctx), 0)
  assert.ok(groupCost(ctx.byGroup.get(1), undefined, 1) > groupCost(ctx.byGroup.get(1), undefined, 3))
  assert.equal(verify(ctx).hard, 0)
  // To'qnashuv oynani "yopib" qo'ymaydi: 1-, 1-, 3-juftlik → 2-juftlik baribir oyna
  placed(ctx, [[0, 1], [0, 1], [2, 1]])
  assert.equal(groupEval(ctx.byGroup.get(1), 1)[1], 1)
})

test("potok guruhlar oraliqlarining kesishmasidan foydalanadi", () => {
  const a = group(1), b = group(2)
  const ctx = build([workload([a, b])], [room(1, 60)], [], { 1: 1, 2: 3 }, { 1: 3, 2: 6 })
  assert.deepEqual(new Set(ctx.events[0].slots.map(pairOf)), new Set([3]))
  const apart = build([workload([a, b])], [room(1, 60)], [], { 1: 1, 2: 4 }, { 1: 2, 2: 6 })
  assert.ok(apart.infeasible.length)
  assert.match(apart.events[0].reason, /kesishmaydi/)
})

const runAnneal = (ctx, opts) => {
  const occ = new Occupancy()
  for (const e of ctx.events) if (e.slot >= 0) occ.place(e)
  return anneal(ctx, occ, { rand: seeded(7), ...opts })
}

test('annealing oynalarni yopadi', () => {
  const g = group(1, { size: 28 })
  const ctx = build([1, 2, 3].map((k) => workload([g], { teacher: k, subject: k })), [room(1)])
  placed(ctx, [[0, 1], [3, 1], [5, 1]])
  const stats = runAnneal(ctx, { maxMs: 300 })
  assert.equal(stats.bestGaps, 0)
  assert.equal(stats.bestConflicts, 0)
  assert.equal(verify(ctx).hard, 0)
})

test("to'qnashuv oynadan yomonroq", () => {
  // Ikkala o'qituvchi faqat Dushanba 1- yoki 3-juftlikda: oynasiz yechim faqat to'qnashuv evaziga bor
  const g = group(1, { size: 28 })
  const only = { blockedDays: '[1, 2, 3, 4]', allowedPairs: '[1, 3]' }
  const ctx = build([1, 2].map((k) => workload([g], { teacher: k, subject: k })), [room(1), room(2)],
    [{ teacherId: 1, ...only }, { teacherId: 2, ...only }])
  placed(ctx, [[0, 1], [0, 2]]) // boshlanish: to'qnashuv, oyna yo'q
  const stats = runAnneal(ctx, { maxMs: 300 })
  const report = verify(ctx)
  assert.equal(stats.bestConflicts, 0)
  assert.equal(report.breakdown.group, 0)
  assert.equal(report.breakdown.gap, 1)
  assert.deepEqual(buildDiagnostics(ctx).gaps[0].pairs, [2])
})

test('greedy guruh kunlarini oynasiz joylaydi', () => {
  const g = group(1, { size: 28 })
  const ctx = build(range(1, 7).map((k) => workload([g], { teacher: k, subject: k, hours: 2 })), [room(1)])
  greedyConstruct(ctx)
  assert.ok(ctx.events.every((e) => e.slot >= 0))
  assert.equal(verify(ctx).hard, 0)
})

test('jarima: dars turi tartibi va ketma-ket kunlar', () => {
  const g = group(1, { size: 28 })
  const ctx = build([workload([g], { type: 'Amaliy' }), workload([g], { type: 'Maʼruza' })], [room(1)])
  // Amaliy dushanba, ma'ruza seshanba — teskari tartib (16) va fan ketma-ket kunlarda (18), har kuni 1 dars (12×2)
  placed(ctx, [[0, 1], [6, 1]])
  assert.equal(groupCost(ctx.byGroup.get(1)), 16 + 18 + 24 + 1)
})

test('oson masala to\'liq yechiladi', () => {
  const groups = range(1, 5).map((i) => group(i))
  const workloads = groups.flatMap((g) => [1, 2, 3].map((k) => workload([g], { teacher: g.id * 10 + k, subject: k, hours: 2 })))
  workloads.push(workload(groups.slice(0, 2), { teacher: 99, subject: 50, hours: 1 }))
  const result = solveContext(build(workloads, [...range(1, 3).map((i) => room(i)), room(9, 60)]), { maxMs: 500 })
  assert.ok(result.report.feasible)
  assert.equal(result.report.hard, 0)
  // potok darsi har guruh uchun alohida qator bo'lib chiqadi
  assert.equal(result.entries.filter((e) => e.subjectId === 50).length, 2)
  assert.equal(result.entries.length, 5 * 3 * 2 + 2)
})

test('annealing keshi to\'liq qayta hisob bilan mos', () => {
  const rand = seeded(3)
  const groups = range(1, 15).map((i) => group(i, { size: pick(rand, [20, 25, 30]) }))
  const workloads = groups.flatMap((g) => [0, 1, 2].map(() => workload([g], {
    teacher: randInt(rand, 1, 8), subject: randInt(rand, 1, 10), hours: pick(rand, [1, 2, 3]),
    type: pick(rand, ['Maʼruza', 'Seminar', 'Amaliy']), difficulty: randInt(rand, 1, 5),
  })))
  const ctx = build(workloads, range(1, 4).map((i) => room(i, pick(rand, [25, 30, 35]))))
  greedyConstruct(ctx)
  const stats = anneal(ctx, rebuildOccupancy(ctx), { maxMs: 300, rand: seeded(1) })
  assert.ok(Math.abs(totalSoft(ctx) - stats.bestSoft) < 1e-6)
  assert.equal(verify(ctx).hard, stats.bestHard)
})

const conflicts = (report) => ({ group: report.breakdown.group, teacher: report.breakdown.teacher, room: report.breakdown.room })
const NO_CONFLICTS = { group: 0, teacher: 0, room: 0 }

test("chetlab bo'lmaydigan to'qnashuvda dars joylanmay qoladi", () => {
  // guruhga faqat 1-juftlik (5 ta slot), lekin 7 ta dars — 2 tasi joylanmaydi, to'qnashuv yo'q
  const g = group(1)
  let ctx = build(range(1, 7).map((k) => workload([g], { teacher: k, subject: k })), range(1, 7).map((k) => room(k)), [], { 1: 1 }, { 1: 1 })
  let result = solveContext(ctx, { maxMs: 300, rand: seeded(1) })
  assert.deepEqual(conflicts(result.report), NO_CONFLICTS)
  assert.equal(result.report.unplaced, 2)
  assert.equal(result.diagnostics.unresolved.reduce((s, u) => s + u.count, 0), 2)

  // o'qituvchi faqat Dushanba 1-juftlikda — ikki guruhdan biri qoladi
  const onlyFirst = { teacherId: 1, blockedDays: '[1, 2, 3, 4]', allowedPairs: '[1]' }
  ctx = build([workload([group(1)], { subject: 1 }), workload([group(2)], { subject: 2 })], [room(1), room(2)], [onlyFirst])
  result = solveContext(ctx, { maxMs: 200, rand: seeded(1) })
  assert.deepEqual(conflicts(result.report), NO_CONFLICTS)
  assert.equal(result.report.unplaced, 1)

  // bitta xona, ikki o'qituvchi ham faqat Dushanba 1-juftlikda — biri qoladi
  const constraints = [1, 2].map((t) => ({ ...onlyFirst, teacherId: t }))
  ctx = build([workload([group(1)], { teacher: 1 }), workload([group(2)], { teacher: 2 })], [room(1)], constraints)
  result = solveContext(ctx, { maxMs: 200, rand: seeded(1) })
  assert.deepEqual(conflicts(result.report), NO_CONFLICTS)
  assert.equal(result.report.unplaced, 1)
  assert.equal(result.report.feasible, false)
})

test('qayta joylash xonani almashtiradi va xalaqit beruvchini suradi', () => {
  const onlyFirst = { blockedDays: '[1, 2, 3, 4]', allowedPairs: '[1]' }
  // xona almashtirish: kichik guruh katta xonada o'tiribdi, katta guruh uchun esa faqat shu xona
  let ctx = build([workload([group(1, { size: 25 })], { teacher: 1 }), workload([group(2, { size: 50 })], { teacher: 2 })],
    [room(1, 30), room(2, 60)], [{ teacherId: 2, ...onlyFirst }])
  const [small, big] = ctx.events
  let occ = placedAt(ctx, [[0, 2]])
  assert.equal(reinsert(ctx, occ), 1)
  assert.deepEqual([small.slot, small.room, big.slot, big.room], [0, 1, 0, 2])
  assert.equal(occ.hard, 0)

  // surish: guruhning boshqa darsi yagona mumkin bo'lgan vaqtni egallagan
  const g = group(3)
  ctx = build([workload([g], { teacher: 1, subject: 1 }), workload([g], { teacher: 2, subject: 2 })],
    [room(1)], [{ teacherId: 2, ...onlyFirst }])
  const [flexible, fixed] = ctx.events
  occ = placedAt(ctx, [[0, 1]])
  assert.equal(reinsert(ctx, occ), 1)
  assert.equal(fixed.slot, 0)
  assert.ok(flexible.slot !== -1 && flexible.slot !== 0)
  assert.equal(occ.hard, 0)
})

test("qat'iy annealing hech qachon to'qnashuv yaratmaydi", () => {
  const rand = seeded(5)
  const groups = range(1, 12).map((i) => group(i, { size: pick(rand, [20, 25]) }))
  const workloads = groups.flatMap((g) => [0, 1, 2].map(() => workload([g], {
    teacher: randInt(rand, 1, 5), subject: randInt(rand, 1, 8), hours: pick(rand, [2, 3]),
  })))
  const ctx = build(workloads, range(1, 3).map((i) => room(i, 30)))
  greedyConstruct(ctx)
  const occ = rebuildOccupancy(ctx)
  removeConflicts(ctx, occ)
  assert.equal(occ.hard, 0)
  const before = verify(ctx)
  const stats = anneal(ctx, occ, { maxMs: 300, rand: seeded(2), strict: true })
  const after = verify(ctx)
  assert.deepEqual(conflicts(after), NO_CONFLICTS)
  assert.equal(after.unplaced, before.unplaced)
  assert.ok(after.breakdown.gap <= before.breakdown.gap)
  assert.equal(stats.bestConflicts, 0)
})

test("zich tasodifiy ma'lumotda ham natijada to'qnashuv yo'q", () => {
  for (let seed = 0; seed < 4; seed++) {
    const rand = seeded(seed + 100)
    const groups = range(1, 20).map((i) => group(i, { size: randInt(rand, 15, 30), faculty: pick(rand, [1, 2]) }))
    const workloads = []
    for (const g of groups) {
      const count = randInt(rand, 4, 7)
      for (let k = 0; k < count; k++) {
        const members = [g]
        if (rand() < 0.15) {
          const other = pick(rand, groups)
          if (other.id !== g.id) members.push(other)
        }
        workloads.push(workload(members, { teacher: randInt(rand, 1, 12), subject: randInt(rand, 1, 30), hours: pick(rand, [1, 2, 3]) }))
      }
    }
    const rooms = range(1, 8).map((i) => room(i, pick(rand, [20, 30, 40, 60]), { faculties: pick(rand, [[], [1], [2]]) }))
    const constraints = [1, 2].map((t) => ({ teacherId: t, blockedDays: '[0, 1]', allowedPairs: null }))
    const result = solveContext(build(workloads, rooms, constraints), { maxMs: 400, rand: seeded(seed) })
    assert.deepEqual(conflicts(result.report), NO_CONFLICTS, `seed ${seed}`)
  }
})

test("sayqallash o'qituvchining boshqa darsini surib oynani yopadi", () => {
  const g = group(1), h = group(2)
  const ctx = build([
    workload([g], { teacher: 1, subject: 1 }), workload([g], { teacher: 2, subject: 2 }),
    workload([h], { teacher: 2, subject: 3 }),
  ], [room(1), room(2)])
  // G: 1- va 3-juftlik (oyna), o'qituvchi 2 esa 2-juftlikda H bilan
  const occ = placedAt(ctx, [[0, 1], [2, 1], [1, 2]])
  assert.equal(verify(ctx).breakdown.gap, 1)
  assert.ok(polishGaps(ctx, occ, Infinity) >= 1)
  const report = verify(ctx)
  assert.equal(report.breakdown.gap, 0)
  assert.deepEqual(conflicts(report), NO_CONFLICTS)
  assert.equal(occ.hard, 0)
})

test('sayqallash xonani almashtirib oynani yopadi', () => {
  const big = group(1, { size: 35 }), h = group(2, { size: 20 }), k = group(3, { size: 20 })
  const ctx = build([
    workload([big], { teacher: 1, subject: 1 }), workload([big], { teacher: 2, subject: 2 }),
    workload([h], { teacher: 3, subject: 3 }), workload([k], { teacher: 4, subject: 4 }),
  ], [room(1, 40), room(2, 40), room(3, 30)])
  // G oynasi 2-juftlikda, u vaqtda ikkala katta xona band; H ning darsi kichik xonaga o'tsa joy ochiladi
  const occ = placedAt(ctx, [[0, 1], [2, 1], [1, 1], [1, 2]])
  assert.ok(polishGaps(ctx, occ, Infinity) >= 1)
  const report = verify(ctx)
  assert.equal(report.breakdown.gap, 0)
  assert.deepEqual(conflicts(report), NO_CONFLICTS)
  assert.equal(ctx.events[2].room, 3)
  assert.equal(ctx.events[2].slot, 1)
})
