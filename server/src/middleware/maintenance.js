import { isMaintenanceOn } from '../routes/siteSettings.js'

// Texnik xizmat rejimi: yoqilgan bo'lsa, Super Admin'dan boshqa hech kim /api'dan
// (site-settings'dan tashqari — u oldinroq, shu gate'dan OLDIN ro'yxatga olingan)
// foydalana olmaydi. OSHKORA: istalgan Super Admin hisobi buni yoqadi/o'chiradi,
// har bir o'zgarish Audit jurnaliga yoziladi (server/src/routes/siteSettings.js).
export async function maintenanceGate(req, res, next) {
  if (req.user?.role === 'Super Admin') return next()
  if (await isMaintenanceOn()) {
    return res.status(503).json({
      error: "Sayt hozir texnik xizmat ko'rsatish tufayli vaqtincha yopiq",
      maintenance: true,
    })
  }
  next()
}
