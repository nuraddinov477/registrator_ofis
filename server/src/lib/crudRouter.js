import { Router } from 'express'
import { prisma, audit } from '../db.js'
import { asyncHandler } from './asyncHandler.js'

const identity = (x) => x

// Bitta entity uchun to'liq CRUD marshrutlarini hosil qiluvchi generic factory.
//   readGuard   — GET oldidan middleware (masalan maxfiy resurs faqat Super Admin'ga)
//   writeGuard  — POST/PUT/DELETE oldidan middleware (rol tekshiruvi)
//   sanitize    — javobdan maxfiy maydonlarni olib tashlash (masalan passwordHash)
//   transform   — parse'dan keyin, DB'ga yozishdan oldin ma'lumotni o'zgartirish (parolni hash qilish)
//   scopeWhere  — (user) => Prisma `where` | null. Har rol faqat o'z birligi yozuvlarini ko'radi
//   scopeAssert — (user, data, existing) => data. Yozishda qamrovni majburlaydi/tekshiradi
export function crudRouter({
  model, label, createSchema, updateSchema, include, orderBy = { id: 'asc' },
  readGuard = [], writeGuard = [], sanitize = identity, transform = async (d) => d,
  scopeWhere = () => null, scopeAssert = async (_u, d) => d,
}) {
  const router = Router()
  const delegate = prisma[model]
  const labelOf = (row) => row?.name ?? row?.fullName ?? row?.login ?? row?.id
  const clean = (row) => (row ? sanitize(row) : row)
  // Joriy user qamrovidagi qo'shimcha where (null → filtrsiz)
  const whereFor = (req) => scopeWhere(req.user) || {}

  router.get('/', ...readGuard, asyncHandler(async (req, res) => {
    const where = scopeWhere(req.user) || undefined
    const rows = await delegate.findMany({ where, include, orderBy })
    const q = (req.query.q ?? '').toString().toLowerCase().trim()
    const filtered = q ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)) : rows
    res.json(filtered.map(clean))
  }))

  router.get('/:id', ...readGuard, asyncHandler(async (req, res) => {
    const row = await delegate.findFirst({ where: { id: Number(req.params.id), ...whereFor(req) }, include })
    if (!row) return res.status(404).json({ error: 'Topilmadi' })
    res.json(clean(row))
  }))

  router.post('/', ...writeGuard, asyncHandler(async (req, res) => {
    let data = await transform(createSchema.parse(req.body))
    data = await scopeAssert(req.user, data, null)
    const row = await delegate.create({ data, include })
    await audit(`Qo'shildi: ${label}`, labelOf(row), req)
    res.status(201).json(clean(row))
  }))

  router.put('/:id', ...writeGuard, asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    // Faqat qamrovdagi yozuvni tahrirlash mumkin (aks holda 404)
    const existing = await delegate.findFirst({ where: { id, ...whereFor(req) } })
    if (!existing) return res.status(404).json({ error: 'Topilmadi' })
    let data = await transform(updateSchema.parse(req.body))
    data = await scopeAssert(req.user, data, existing)
    const row = await delegate.update({ where: { id }, data, include })
    await audit(`Tahrirlandi: ${label}`, labelOf(row), req)
    res.json(clean(row))
  }))

  router.delete('/:id', ...writeGuard, asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    const existing = await delegate.findFirst({ where: { id, ...whereFor(req) } })
    if (!existing) return res.status(404).json({ error: 'Topilmadi' })
    await delegate.delete({ where: { id } })
    await audit(`O'chirildi: ${label}`, id, req)
    res.status(204).end()
  }))

  return router
}
