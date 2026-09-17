// Bazada kamida bitta foydalanuvchi bormi? Bor bo'lsa 0, yo'q bo'lsa 1 bilan chiqadi (docker-entrypoint.sh).
// Ulanib bo'lmasa ham 0 — ishonchsiz holatda seed (jadvallarni tozalaydi) ishga tushmasin.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
let code = 0
try {
  code = (await prisma.user.findFirst({ select: { id: true } })) ? 0 : 1
} catch (e) {
  console.error('Foydalanuvchilarni tekshirib bo\'lmadi:', e.message)
} finally {
  await prisma.$disconnect()
}
process.exit(code)
