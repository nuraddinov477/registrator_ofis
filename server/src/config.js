// Markazlashgan konfiguratsiya — muhit o'zgaruvchilarini tekshiradi (fail-fast).
const isProd = process.env.NODE_ENV === 'production'

function required(key, fallback) {
  const v = process.env[key] ?? fallback
  if (v === undefined || v === '') {
    console.error(`❌ Majburiy muhit o'zgaruvchisi yetishmayapti: ${key}`)
    process.exit(1)
  }
  return v
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd,
  port: Number(process.env.PORT) || 4000,
  databaseUrl: required('DATABASE_URL', 'file:./dev.db'),
  // Bir nechta domen vergul bilan: "https://a.uz,https://b.uz"
  clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  jwt: {
    // Production'da JWT_SECRET majburiy, dev'da default
    secret: isProd ? required('JWT_SECRET') : (process.env.JWT_SECRET || 'dev-secret-change-me'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 300, // 15 daqiqada
    authMax: Number(process.env.RATE_LIMIT_AUTH_MAX) || 20, // login uchun qattiqroq
  },
  bodyLimit: process.env.BODY_LIMIT || '1mb',
}
