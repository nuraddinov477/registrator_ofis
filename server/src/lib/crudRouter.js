import { Router } from 'express'
import { prisma, audit } from '../db.js'
import { asyncHandler } from './asyncHandler.js'

const identity = (x) => x

// Bitta entity uchun to'liq CRUD marshrutlarini hosil qiluvchi generic factory.
//   mutationGuard — POST/PUT/DELETE oldidan qo'shimcha middleware (masalan rol tekshiruvi)
//   sanitize      — javobdan maxfiy maydonlarni olib tashlash (masalan passwordHash)
//   transform     — parse'dan keyin, DB'ga yozishdan oldin ma'lumotni o'zgartirish (masalan parolni hash qilish)
export function crudRouter({ model, label, createSchema, updateSchema, include, orderBy = { id: 'asc' }, mutationGuard = [], sanitize = identity, transform = async (d) => d }) {
  const router = Router()
  const delegate = prisma[model]
  const labelOf = (row) => row?.name ?? row?.fullName ?? row?.login ?? row?.id
  const clean = (row) => (row ? sanitize(row) : row)

  router.get('/', asyncHandler(async (req, res) => {
    const rows = await delegate.findMany({ include, orderBy })
    const q = (req.query.q ?? '').toString().toLowerCase().trim()
    const filtered = q ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)) : rows
    res.json(filtered.map(clean))
  }))

  router.get('/:id', asyncHandler(async (req, res) => {
    const row = await delegate.findUnique({ where: { id: Number(req.params.id) }, include })
    if (!row) return res.status(404).json({ error: 'Topilmadi' })
    res.json(clean(row))
  }))

  router.post('/', ...mutationGuard, asyncHandler(async (req, res) => {
    const data = await transform(createSchema.parse(req.body))
    const row = await delegate.create({ data, include })
    await audit(`Qo'shildi: ${label}`, labelOf(row), req)
    res.status(201).json(clean(row))
  }))

  router.put('/:id', ...mutationGuard, asyncHandler(async (req, res) => {
    const data = await transform(updateSchema.parse(req.body))
    const row = await delegate.update({ where: { id: Number(req.params.id) }, data, include })
    await audit(`Tahrirlandi: ${label}`, labelOf(row), req)
    res.json(clean(row))
  }))

  router.delete('/:id', ...mutationGuard, asyncHandler(async (req, res) => {
    await delegate.delete({ where: { id: Number(req.params.id) } })
    await audit(`O'chirildi: ${label}`, req.params.id, req)
    res.status(204).end()
  }))

  return router
}
