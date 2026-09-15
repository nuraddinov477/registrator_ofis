import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler.js'
import { prisma, audit } from '../db.js'
import { requireDeveloper } from '../auth/middleware.js'

// Egalik hisobidan boshqa BARCHA akkauntni bitta amalda bloklaydi/blokdan chiqaradi.
// OSHKORA: faqat isOwner=true hisob bilan ishlaydi, har chaqiriq Audit jurnaliga
// yoziladi (necha ta akkaunt ta'sirlangani bilan birga).
export function usersBulkRouter() {
  const router = Router()

  router.post('/block-all', requireDeveloper, asyncHandler(async (req, res) => {
    const { count } = await prisma.user.updateMany({ where: { isOwner: false }, data: { active: false } })
    await audit('Barcha akkauntlar bloklandi', `${count} ta akkaunt`, req)
    res.json({ blocked: count })
  }))

  router.post('/unblock-all', requireDeveloper, asyncHandler(async (req, res) => {
    const { count } = await prisma.user.updateMany({ where: { isOwner: false }, data: { active: true } })
    await audit('Barcha akkauntlar blokdan chiqarildi', `${count} ta akkaunt`, req)
    res.json({ unblocked: count })
  }))

  return router
}
