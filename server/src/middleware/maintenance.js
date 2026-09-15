import { isMaintenanceOn } from '../routes/siteSettings.js'

// Texnik xizmat rejimi: yoqilgan bo'lsa, egalik (isOwner) hisobidan boshqa HECH
// KIM — Super Admin'lar ham — /api'dan (site-settings'dan tashqari, u oldinroq, shu
// gate'dan OLDIN ro'yxatga olingan) foydalana olmaydi. OSHKORA: faqat egasi yoqadi/
// o'chiradi (requireDeveloper), har o'zgarish Audit jurnaliga yoziladi.
export async function maintenanceGate(req, res, next) {
  if (req.user?.isOwner) return next()
  if (await isMaintenanceOn()) {
    return res.status(503).json({
      error: "Sayt hozir texnik xizmat ko'rsatish tufayli vaqtincha yopiq",
      maintenance: true,
    })
  }
  next()
}
