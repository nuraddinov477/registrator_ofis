import { Router } from 'express'
import { prisma, audit } from '../db.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { schemas } from '../validation/schemas.js'
import { requireRead, requireWrite, scopeWhere, scopeAssert } from '../auth/access.js'

// Yuklama (Workload) — crudRouter'dan alohida: guruh endi ko'p-ko'pga (potok),
// generic CRUD nested create/delete'ni bilmaydi, shuning uchun o'z marshruti.
const include = { groups: { include: { group: true } }, teacher: true, subject: true }
const labelOf = (row) => `${row.subject?.name ?? row.subjectId} — ${row.teacher?.fullName ?? row.teacherId}`

export function workloadsRouter() {
  const router = Router()
  const whereFor = (req) => scopeWhere('workloads', req.user) || {}

  // Standart: faqat faol (arxivlanmagan). ?all=1 — arxivdagilarni ham qaytaradi.
  router.get('/', requireRead('workloads'), asyncHandler(async (req, res) => {
    const all = req.query.all === '1' || req.query.all === 'true'
    const where = { ...(scopeWhere('workloads', req.user) || {}), ...(all ? {} : { archived: false }) }
    const rows = await prisma.workload.findMany({ where, include, orderBy: { id: 'asc' } })
    res.json(rows)
  }))

  router.get('/:id', requireRead('workloads'), asyncHandler(async (req, res) => {
    const row = await prisma.workload.findFirst({ where: { id: Number(req.params.id), ...whereFor(req) }, include })
    if (!row) return res.status(404).json({ error: 'Topilmadi' })
    res.json(row)
  }))

  router.post('/', requireWrite('workloads'), asyncHandler(async (req, res) => {
    const parsed = schemas.workload.parse(req.body)
    const { groupIds, ...rest } = await scopeAssert('workloads', req.user, parsed, null)
    const row = await prisma.workload.create({
      data: { ...rest, groups: { create: groupIds.map((groupId) => ({ groupId })) } },
      include,
    })
    await audit("Qo'shildi: Yuklama", labelOf(row), req)
    res.status(201).json(row)
  }))

  router.put('/:id', requireWrite('workloads'), asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    // Qamrov tekshiruvi uchun mavjud guruhlar bilan birga olamiz (scopeAssert shundan foydalanadi)
    const existing = await prisma.workload.findFirst({ where: { id, ...whereFor(req) }, include: { groups: true } })
    if (!existing) return res.status(404).json({ error: 'Topilmadi' })
    const parsed = schemas.workload.partial().parse(req.body)
    const { groupIds, ...rest } = await scopeAssert('workloads', req.user, parsed, existing)

    const row = await prisma.$transaction(async (tx) => {
      if (groupIds) {
        await tx.workloadGroup.deleteMany({ where: { workloadId: id } })
        rest.groups = { create: groupIds.map((groupId) => ({ groupId })) }
      }
      return tx.workload.update({ where: { id }, data: rest, include })
    })
    await audit('Tahrirlandi: Yuklama', labelOf(row), req)
    res.json(row)
  }))

  // Yuklamani ARXIVGA ko'chiradi (butunlay O'CHIRMAYDI) — guruh bog'lanishlari saqlanadi,
  // jadval generatsiyasi va almashtirish ustasida hisobga olinmaydi, /restore bilan tiklanadi.
  router.delete('/:id', requireWrite('workloads'), asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const existing = await prisma.workload.findFirst({ where: { id, ...whereFor(req) } })
    if (!existing) return res.status(404).json({ error: 'Topilmadi' })
    await prisma.workload.update({ where: { id }, data: { archived: true } })
    await audit('Arxivlandi: Yuklama', id, req)
    res.status(204).end()
  }))

  router.post('/:id/restore', requireWrite('workloads'), asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const existing = await prisma.workload.findFirst({ where: { id, ...whereFor(req) } })
    if (!existing) return res.status(404).json({ error: 'Topilmadi' })
    const row = await prisma.workload.update({ where: { id }, data: { archived: false }, include })
    await audit('Arxivdan tiklandi: Yuklama', labelOf(row), req)
    res.json(row)
  }))

  return router
}
