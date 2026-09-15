import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler.js'
import { prisma, audit } from '../db.js'
import { requireRole } from '../auth/middleware.js'

export const siteSettingsRouter = Router()

// Yagona qator (id=1) keshi — har so'rovda DB'ga urilmaslik uchun qisqa TTL bilan.
let cache = null // { maintenanceMode, message, cachedAt }
const CACHE_MS = 5000

async function getSettings() {
  if (cache && Date.now() - cache.cachedAt < CACHE_MS) return cache
  let row = await prisma.siteSetting.findUnique({ where: { id: 1 } })
  if (!row) row = await prisma.siteSetting.create({ data: { id: 1 } })
  cache = { maintenanceMode: row.maintenanceMode, message: row.maintenanceMessage, cachedAt: Date.now() }
  return cache
}

// maintenanceGate (app.js) shundan foydalanadi — qattiq bog'liqlikni oldini olish
// uchun shu faylda, tashqariga eksport qilingan.
export async function isMaintenanceOn() {
  return (await getSettings()).maintenanceMode
}

// GET — istalgan avtorizatsiyalangan foydalanuvchi (frontend "sayt yopiq" ekranini
// ko'rsatish uchun) o'qiy oladi. Texnik xizmat rejimida ham ishlaydi (blоklanmaydi).
siteSettingsRouter.get('/', asyncHandler(async (req, res) => {
  const s = await getSettings()
  res.json({ maintenanceMode: s.maintenanceMode, message: s.message })
}))

// PUT — FAQAT Super Admin yoqadi/o'chiradi. Oshkora: Audit jurnaliga yoziladi,
// har qanday Super Admin hisobi buni ko'radi va boshqaradi (yashirin emas).
siteSettingsRouter.put('/', requireRole('Super Admin'), asyncHandler(async (req, res) => {
  const maintenanceMode = !!req.body?.maintenanceMode
  const message = req.body?.message ? String(req.body.message).slice(0, 500) : null
  const row = await prisma.siteSetting.upsert({
    where: { id: 1 },
    update: { maintenanceMode, maintenanceMessage: message },
    create: { id: 1, maintenanceMode, maintenanceMessage: message },
  })
  cache = null // keshni bekor qilish — keyingi so'rov yangisini oladi
  await audit(maintenanceMode ? 'Sayt texnik xizmatga yopildi' : 'Sayt qayta ochildi', message || '', req)
  res.json({ maintenanceMode: row.maintenanceMode, message: row.maintenanceMessage })
}))
