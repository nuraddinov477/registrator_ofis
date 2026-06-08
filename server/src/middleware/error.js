import { ZodError } from 'zod'
import pkg from '@prisma/client'
const { Prisma } = pkg

export function notFound(req, res) {
  res.status(404).json({ error: `Marshrut topilmadi: ${req.method} ${req.path}` })
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validatsiya xatosi', issues: err.flatten().fieldErrors })
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Yozuv topilmadi' })
    if (err.code === 'P2002') return res.status(409).json({ error: 'Bunday qiymat allaqachon mavjud', fields: err.meta?.target })
    if (err.code === 'P2003') return res.status(409).json({ error: "Bog'liq yozuv mavjud (foreign key cheklovi)" })
  }
  console.error('[ERROR]', err)
  res.status(500).json({ error: 'Ichki server xatosi' })
}
