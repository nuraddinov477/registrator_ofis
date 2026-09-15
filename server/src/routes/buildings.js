import { Router } from 'express'
import { prisma, audit } from '../db.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { schemas } from '../validation/schemas.js'
import { requireRead, requireWrite, scopeWhere, scopeAssert } from '../auth/access.js'

// Bino (Building) — crudRouter'dan alohida: endi fakultet(lar) bilan ko'p-ko'pga
// bog'lanadi (bitta bino bir nechta fakultetga tegishli bo'lishi mumkin), generic
// CRUD relation-connect/set'ni bilmaydi, shuning uchun o'z marshruti (workloads.js bilan bir xil naqsh).
const include = { faculties: true }

export function buildingsRouter() {
  const router = Router()
  const whereFor = (req) => scopeWhere('buildings', req.user) || {}

  router.get('/', requireRead('buildings'), asyncHandler(async (req, res) => {
    const rows = await prisma.building.findMany({ where: scopeWhere('buildings', req.user) || undefined, include, orderBy: { id: 'asc' } })
    res.json(rows)
  }))

  router.get('/:id', requireRead('buildings'), asyncHandler(async (req, res) => {
    const row = await prisma.building.findFirst({ where: { id: Number(req.params.id), ...whereFor(req) }, include })
    if (!row) return res.status(404).json({ error: 'Topilmadi' })
    res.json(row)
  }))

  router.post('/', requireWrite('buildings'), asyncHandler(async (req, res) => {
    const parsed = schemas.building.parse(req.body)
    const { facultyIds, ...rest } = await scopeAssert('buildings', req.user, parsed, null)
    const row = await prisma.building.create({
      data: { ...rest, faculties: { connect: facultyIds.map((id) => ({ id })) } },
      include,
    })
    await audit("Qo'shildi: Bino", row.name, req)
    res.status(201).json(row)
  }))

  router.put('/:id', requireWrite('buildings'), asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const existing = await prisma.building.findFirst({ where: { id, ...whereFor(req) } })
    if (!existing) return res.status(404).json({ error: 'Topilmadi' })
    const parsed = schemas.building.partial().parse(req.body)
    const { facultyIds, ...rest } = await scopeAssert('buildings', req.user, parsed, existing)
    // facultyIds berilgan bo'lsa — to'liq ALMASHTIRAMIZ (set), qisman qo'shish emas
    if (facultyIds) rest.faculties = { set: facultyIds.map((fid) => ({ id: fid })) }
    const row = await prisma.building.update({ where: { id }, data: rest, include })
    await audit('Tahrirlandi: Bino', row.name, req)
    res.json(row)
  }))

  router.delete('/:id', requireWrite('buildings'), asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const existing = await prisma.building.findFirst({ where: { id, ...whereFor(req) } })
    if (!existing) return res.status(404).json({ error: 'Topilmadi' })
    await prisma.building.delete({ where: { id } })
    await audit("O'chirildi: Bino", id, req)
    res.status(204).end()
  }))

  return router
}
