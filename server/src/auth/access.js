import { prisma } from '../db.js'

// ─────────────────────────── Rol-huquq va qamrov (RBAC) markazi ───────────────────────────
// Bitta manba: qaysi rol qaysi resursni yoza oladi (WRITE) va har rol faqat o'z
// birligining ma'lumotini ko'rishi (scoping). Super Admin har doim to'liq ruxsatga ega.

export const ROLES = {
  SUPER: 'Super Admin',
  OPERATOR: 'Fakultet operatori',
  MUDIR: 'Kafedra mudiri',
  TEACHER: 'Oʻqituvchi',
}
const { SUPER, OPERATOR, MUDIR } = ROLES

export const isSuperAdmin = (user) => user?.role === SUPER

// Aniq HTTP status bilan tashlanadigan ruxsat xatosi (errorHandler 403 qaytaradi)
export class AccessError extends Error {
  constructor(message, status = 403) { super(message); this.status = status }
}

// Resurs (URL path) → YOZISH (create/update/delete) ruxsati bo'lgan rollar.
// Super Admin bu ro'yxatlarga kirmaydi — u kod ichida bypass qilinadi.
// Bo'sh ro'yxat = faqat Super Admin yozadi.
export const WRITE = {
  faculties: [],
  departments: [],
  buildings: [],
  specialties: [OPERATOR],
  groups: [OPERATOR],
  teachers: [MUDIR],
  subjects: [OPERATOR, MUDIR],
  rooms: [OPERATOR],
  'room-permissions': [OPERATOR],
  workloads: [OPERATOR, MUDIR],
  users: [],
}

// Faqat Super Admin O'QIY oladigan resurslar (maxfiy). Qolganini har kirgan user o'qiydi.
const READ_SUPER_ONLY = new Set(['users'])

export const canWrite = (resource, user) =>
  isSuperAdmin(user) || (WRITE[resource] ?? []).includes(user?.role)

// ── Middleware: yozish ruxsati ──
export const requireWrite = (resource) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' })
  if (canWrite(resource, req.user)) return next()
  res.status(403).json({ error: 'Ruxsat yetarli emas' })
}

// ── Middleware: o'qish ruxsati (faqat maxfiy resurslar uchun cheklaydi) ──
export const requireRead = (resource) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' })
  if (READ_SUPER_ONLY.has(resource) && !isSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Ruxsat yetarli emas' })
  }
  next()
}

const NONE = { id: -1 } // hech narsaga mos kelmaydigan filtr (birlik biriktirilmagan holat)

// ── LIST/GET uchun Prisma `where` filtri (null = filtrsiz, hammasini ko'radi) ──
export function scopeWhere(resource, user) {
  if (isSuperAdmin(user)) return null
  const role = user?.role

  if (role === OPERATOR) {
    const F = user?.facultyId ?? null
    if (resource === 'groups' || resource === 'specialties') return F ? { facultyId: F } : NONE
    if (resource === 'workloads') return F ? { group: { facultyId: F } } : NONE
    return null // boshqa (reference) resurslarni o'qiy oladi
  }

  if (role === MUDIR) {
    const D = user?.departmentId ?? null
    if (resource === 'teachers') return D ? { departmentId: D } : NONE
    if (resource === 'workloads') return D ? { teacher: { departmentId: D } } : NONE
    return null
  }

  // Oʻqituvchi va boshqalar: reference ma'lumotni o'qiy oladi (yozish baribir bloklangan)
  return null
}

// ── YOZISHda qamrovni majburlash/tekshirish. data'ni (masalan facultyId) o'zgartirib qaytaradi ──
//   existing berilsa (update/delete): mavjud yozuv user qamrovida ekani tekshiriladi.
export async function scopeAssert(resource, user, data, existing) {
  if (isSuperAdmin(user)) return data
  const role = user?.role

  if (role === OPERATOR) {
    const F = user?.facultyId ?? null
    if (resource === 'groups' || resource === 'specialties') {
      if (F == null) throw new AccessError('Sizga fakultet biriktirilmagan')
      if (existing && existing.facultyId !== F) throw new AccessError("Bu yozuv boshqa fakultetga tegishli")
      if (data) data.facultyId = F // o'z fakultetiga majburlash
    } else if (resource === 'workloads') {
      if (F == null) throw new AccessError('Sizga fakultet biriktirilmagan')
      const gid = data?.groupId ?? existing?.groupId
      const g = gid != null ? await prisma.group.findUnique({ where: { id: Number(gid) } }) : null
      if (!g || g.facultyId !== F) throw new AccessError('Guruh sizning fakultetingizda emas')
    }
    // subjects / rooms / room-permissions: umumiy (global), qamrov yo'q
    return data
  }

  if (role === MUDIR) {
    const D = user?.departmentId ?? null
    if (resource === 'teachers') {
      if (D == null) throw new AccessError('Sizga kafedra biriktirilmagan')
      if (existing && existing.departmentId !== D) throw new AccessError("Bu o'qituvchi boshqa kafedraga tegishli")
      if (data) data.departmentId = D
    } else if (resource === 'workloads') {
      if (D == null) throw new AccessError('Sizga kafedra biriktirilmagan')
      const tid = data?.teacherId ?? existing?.teacherId
      const t = tid != null ? await prisma.teacher.findUnique({ where: { id: Number(tid) } }) : null
      if (!t || t.departmentId !== D) throw new AccessError("O'qituvchi sizning kafedrangizda emas")
    }
    // subjects: umumiy
    return data
  }

  return data
}
