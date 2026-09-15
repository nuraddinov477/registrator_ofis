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
