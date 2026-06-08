import { config } from './config.js'
import { createApp } from './app.js'
import { prisma } from './db.js'

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
