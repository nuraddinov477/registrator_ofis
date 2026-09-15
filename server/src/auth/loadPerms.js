import { prisma } from '../db.js'
import { asyncHandler } from '../lib/asyncHandler.js'

// requireAuth'dan keyin ishlaydi: joriy foydalanuvchini DB'dan qayta o'qib,
// rol / qamrov (faculty·department·teacher) / cheklovlarni YANGILAYDI.
// Shu tufayli Super Admin qo'ygan cheklov yoki deaktivatsiya token yangilanishini
// kutmasdan DARHOL kuchga kiradi. Faol bo'lmagan/o'chirilgan user → 401 (fail-closed).
export const loadPerms = asyncHandler(async (req, res, next) => {
  const u = await prisma.user.findUnique({ where: { id: req.user.sub } })
  if (!u || !u.active) return res.status(401).json({ error: 'Akkaunt faol emas yoki topilmadi' })
  req.user = {
    ...req.user,
    login: u.login, // token eskirgan bo'lsa ham (masalan login o'zgartirilgan bo'lsa) yangisini oladi
    role: u.role,
    facultyId: u.facultyId,
    departmentId: u.departmentId,
    teacherId: u.teacherId,
    restrictions: u.restrictions,
    isOwner: u.isOwner,
  }
  next()
})
