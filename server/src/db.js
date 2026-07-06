import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
})

// Har bir o'zgartirishni audit logiga yozadi. Audit xatosi asosiy amalni to'xtatmaydi.
export async function audit(action, detail, req) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        detail: String(detail ?? ''),
        ip: req?.ip ?? '127.0.0.1',
        // Kim o'zgartirdi — autentifikatsiyadan kelgan haqiqiy foydalanuvchi (login)
        user: req?.user?.login ?? req?.headers?.['x-user'] ?? 'tizim',
      },
    })
  } catch {
    /* ignore */
  }
}
