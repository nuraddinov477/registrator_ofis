import { verifyToken } from './jwt.js'

// Authorization: Bearer <token> ni tekshiradi, req.user ni o'rnatadi
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' })
  try {
    req.user = verifyToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'Token yaroqsiz yoki muddati o\'tgan' })
  }
}

// Faqat ruxsat etilgan rollar
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' })
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Ruxsat yetarli emas' })
  next()
}
