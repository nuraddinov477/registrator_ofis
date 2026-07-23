// Neon bazasiga to'g'ridan-to'g'ri ulanib holatni ko'rsatadi. HECH NARSA O'ZGARTIRMAYDI.
// Ishlatish: node diagnose-db.mjs "postgresql://...neon.tech/...?sslmode=require"
import { PrismaClient } from '@prisma/client'

const url = process.argv[2]
if (!url || !url.startsWith('postgres')) {
  console.log('XATO: DATABASE_URL argument sifatida bering')
  process.exit(1)
}

const prisma = new PrismaClient({ datasources: { db: { url } } })

const counts = {}
for (const t of ['user', 'faculty', 'department', 'teacher', 'subject', 'group', 'room', 'workload', 'scheduleEntry', 'auditLog']) {
  try { counts[t] = await prisma[t].count() } catch (e) { counts[t] = `XATO: ${e.message.split('\n')[0]}` }
}
console.log('── Jadval qatorlari ──')
for (const [t, c] of Object.entries(counts)) console.log(`  ${t}: ${c}`)

console.log('── Userlar ──')
try {
  const users = await prisma.user.findMany({ orderBy: { id: 'asc' } })
  for (const u of users) {
    console.log(`  #${u.id} ${u.login} | ${u.role} | active=${u.active} | yaratilgan=${u.createdAt.toISOString().slice(0, 16)} | o'zgargan=${u.updatedAt.toISOString().slice(0, 16)} | hash=${(u.passwordHash || '').slice(0, 10)}...`)
  }
} catch (e) { console.log('  XATO:', e.message.split('\n')[0]) }

console.log("── Audit oxirgi 25 ta ──")
try {
  const logs = await prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: 25 })
  for (const l of logs.reverse()) {
    console.log(`  ${l.time.toISOString().slice(0, 16)} | ${l.user} | ${l.action} | ${(l.detail || '').slice(0, 80)} | ip=${l.ip}`)
  }
} catch (e) { console.log('  XATO:', e.message.split('\n')[0]) }

await prisma.$disconnect()
