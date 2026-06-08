// Tez sinov uchun CLI: HTTP'siz to'g'ridan-to'g'ri solver'ni ishga tushiradi.
//   npm run solve
import { PrismaClient } from '@prisma/client'
import { solve, buildGroupGrid } from './solve.js'
import { persistRun } from './persist.js'
import { DAY_NAMES } from './timeslots.js'

const prisma = new PrismaClient()
const semester = Number(process.argv[2]) || 1
const maxMs = Number(process.argv[3]) || 5000

function printGrid(ctx, groupId) {
  const evs = ctx.byGroup.get(groupId) || []
  if (!evs.length) return
  console.log(`\n  Guruh: ${evs[0].groupName}`)
  const grid = buildGroupGrid(ctx, groupId)
  const head = ['Para', ...DAY_NAMES.map((d) => d.slice(0, 4))]
  console.log('  ' + head.map((h) => h.padEnd(16)).join(''))
  grid.forEach((row, i) => {
    const cells = row.map((c) => (c ? `${(c.subject || '').slice(0, 12)}` : '·'))
    console.log('  ' + [`${i + 1}`, ...cells].map((c) => String(c).padEnd(16)).join(''))
  })
}

const t0 = Date.now()
const result = await solve(prisma, { semester, maxMs })

console.log('═══════════════════ JADVAL NATIJASI ═══════════════════')
console.log(`Eventlar (darslar):  ${result.events ?? 0}`)
console.log(`Greedy:              hard=${result.greedy?.hard}  soft=${result.greedy?.soft}`)
console.log(`Annealing:           hard=${result.report.hard}  soft=${result.report.soft}`)
console.log(`  qattiq taqsim:     ${JSON.stringify(result.report.breakdown)}`)
console.log(`  iteratsiyalar:     ${result.anneal?.iterations}  (qabul: ${result.anneal?.accepted}, ${result.anneal?.ms}ms)`)
console.log(`FEASIBLE (bajarsa):  ${result.report.feasible ? '✅ HA' : '❌ YO\'Q'}`)
if (result.report.infeasibleEvents?.length) {
  console.log(`⚠️  mos xonasiz:      ${result.report.infeasibleEvents.length} ta`)
}

// birinchi 2 guruh jadvalini ko'rsatamiz
for (const gid of [...(result.ctx.byGroup.keys())].slice(0, 2)) printGrid(result.ctx, gid)

const run = await persistRun(prisma, result)
console.log(`\n💾 Saqlandi: SchedulingRun #${run.id}  (jami ${Date.now() - t0}ms)`)
await prisma.$disconnect()
