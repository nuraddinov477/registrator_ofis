import { config } from './config.js'
import { createApp } from './app.js'
import { prisma } from './db.js'

// Bir martalik "bootstrap": isOwner ustuni yangi qo'shilgan bo'lsa (migratsiyadan
// keyin standart holatda false), "developer" login'li hisobga avtomatik isOwner=true
// beriladi — bu API orqali sozlanmaydigan maydon (ataylab), shu sabab har server
// ishga tushganda o'zini tekshirib qo'yadi. Allaqachon true bo'lsa — hech narsa qilmaydi.
await prisma.user.updateMany({ where: { login: 'developer', isOwner: false }, data: { isOwner: true } })
  .then((r) => { if (r.count) console.log(`→ Bootstrap: "developer" hisobiga isOwner=true berildi (${r.count})`) })
  .catch((e) => console.error('Bootstrap xatosi (isOwner):', e.message))

// Bir martalik "bootstrap": Building.facultyId (ESKI, yagona egalik) → Building.faculties
// (YANGI, ko'p-ko'pga) ga bir martalik ko'chirish. `prisma db push` sxemani DARHOL
// qo'llaydi (bu kod ishga tushishidan OLDIN, docker-entrypoint.sh'da) — shu sabab eski
// ustun hali OLIB TASHLANMAGAN (ma'lumot yo'qolmasligi uchun): shu yerda uni o'qib,
// yangi jadvalga ko'chiramiz. Idempotent — allaqachon bog'langan bino qayta tegilmaydi.
await prisma.building.findMany({ where: { facultyId: { not: null } }, select: { id: true, facultyId: true, faculties: { select: { id: true } } } })
  .then(async (rows) => {
    const todo = rows.filter((b) => !b.faculties.some((f) => f.id === b.facultyId))
    for (const b of todo) {
      await prisma.building.update({ where: { id: b.id }, data: { faculties: { connect: { id: b.facultyId } } } })
    }
    if (todo.length) console.log(`→ Bootstrap: ${todo.length} ta bino eski facultyId'dan yangi faculties'ga ko'chirildi`)
  })
  .catch((e) => console.error('Bootstrap xatosi (Building.faculties backfill):', e.message))

const app = createApp()

const server = app.listen(config.port, () => {
  console.log(`✅ UniSchedule API [${config.env}]:  http://localhost:${config.port}`)
  console.log(`   Health:  http://localhost:${config.port}/health`)
})

async function shutdown(signal) {
  console.log(`\n${signal} — to'xtatilmoqda...`)
  await prisma.$disconnect()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref() // majburiy chiqish
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
