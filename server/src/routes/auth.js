import { Router } from 'express'
import { z } from 'zod'
import { prisma, audit } from '../db.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { verifyPassword } from '../auth/password.js'
import { signToken } from '../auth/jwt.js'
import { requireAuth } from '../auth/middleware.js'

export const authRouter = Router()

const loginSchema = z.object({ login: z.string().min(1), password: z.string().min(1) })

// POST /api/auth/login
authRouter.post('/login', asyncHandler(async (req, res) => {
  const { login, password } = loginSchema.parse(req.body)
  const user = await prisma.user.findUnique({ where: { login } })
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' })
  }
  await audit('Tizimga kirdi', login, req)
  res.json({
    token: signToken(user),
    user: { id: user.id, login: user.login, fullName: user.fullName, role: user.role },
  })
}))

// GET /api/auth/me — joriy foydalanuvchi
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.sub, login: req.user.login, fullName: req.user.name, role: req.user.role })
})
