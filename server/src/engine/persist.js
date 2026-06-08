// Yechimni DB'ga saqlash: SchedulingRun + ScheduleEntry[]
export async function persistRun(prisma, { semester, report, entries }) {
  const run = await prisma.schedulingRun.create({
    data: {
      semester,
      status: report.feasible ? 'done' : 'failed',
      hardScore: report.hard,
      softScore: Math.round(report.soft),
    },
  })
  if (entries.length) {
    await prisma.scheduleEntry.createMany({
      data: entries.map((e) => ({ ...e, runId: run.id })),
    })
  }
  return run
}
