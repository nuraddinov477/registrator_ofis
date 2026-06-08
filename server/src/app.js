import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import { config } from './config.js'
import { prisma } from './db.js'
import { buildRoutes } from './routes/index.js'
import { authRouter } from './routes/auth.js'
import { requireAuth } from './auth/middleware.js'
import { notFound, errorHandler } from './middleware/error.js'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1) // reverse-proxy orqasida to'g'ri IP

  // Xavfsizlik
  app.use(helmet())
  app.use(compression())
  app.use(cors({ origin: config.clientOrigin, credentials: true }))
  app.use(express.json({ limit: config.bodyLimit }))
  app.use(morgan(config.isProd ? 'combined' : 'dev'))
  app.use(rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max, standardHeaders: true, legacyHeaders: false }))

  // Sog'liq tekshiruvi (liveness / readiness)
  app.get('/health', (req, res) => res.json({ ok: true, env: config.env, ts: new Date().toISOString() }))
  app.get('/health/ready', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      res.json({ ok: true, db: 'up' })
    } catch {
      res.status(503).json({ ok: false, db: 'down' })
    }
  })

  // Auth (login uchun qattiqroq rate-limit)
  const authLimiter = rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.authMax, standardHeaders: true, legacyHeaders: false })
  app.use('/api/auth', authLimiter, authRouter)

  // Qolgan barcha /api — autentifikatsiya talab qiladi
  app.use('/api', requireAuth, buildRoutes())

  app.use(notFound)
  app.use(errorHandler)
  return app
}
