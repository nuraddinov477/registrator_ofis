// Worker thread — jadval generatsiyasini asosiy event-loopdan tashqarida bajaradi,
// shunda 5000+ eventli og'ir ish HTTP so'rovni bloklamaydi.
import { workerData, parentPort } from 'worker_threads'
import { PrismaClient } from '@prisma/client'
import { solve } from './solve.js'

const prisma = new PrismaClient()
const { runId, semester, maxMs, afternoonCourses } = workerData

try {
  const result = await solve(prisma, { semester, maxMs, afternoonCourses })

  if (result.entries.length) {
    await prisma.scheduleEntry.createMany({ data: result.entries.map((e) => ({ ...e, runId })) })
  }
  const reportJson = JSON.stringify({
    unplaced: result.report.unplaced,
    breakdown: result.report.breakdown,
    infeasibleEvents: result.report.infeasibleEvents,
    diagnostics: result.diagnostics,
  })
  await prisma.schedulingRun.update({
    where: { id: runId },
    data: {
      status: result.report.feasible ? 'done' : 'failed',
      hardScore: result.report.hard,
      softScore: result.report.soft,
      report: reportJson,
    },
  })
  parentPort?.postMessage({ ok: true, runId, hard: result.report.hard, soft: result.report.soft })
} catch (err) {
  await prisma.schedulingRun.update({
    where: { id: runId },
    data: { status: 'failed', report: JSON.stringify({ error: String(err?.message || err) }) },
  }).catch(() => {})
  parentPort?.postMessage({ ok: false, runId, error: String(err?.message || err) })
} finally {
  await prisma.$disconnect()
}
