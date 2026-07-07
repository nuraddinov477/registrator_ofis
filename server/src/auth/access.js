import { prisma } from '../db.js'

// ─────────────────────────── Rol-huquq va qamrov (RBAC) markazi ───────────────────────────
// Bitta manba: qaysi rol qaysi resursni yoza oladi (WRITE), har rol faqat o'z birligini
// ko'rishi (scoping), delegatsiya (quyi rollar akkaunt yaratishi) va Super Admin qo'ygan
// shaxsiy cheklovlar (restrictions). Super Admin har doim to'liq ruxsatga ega va cheklanmaydi.

export const ROLES = {
  SUPER: 'Super Admin',
  OPERATOR: 'Fakultet operatori',
  MUDIR: 'Kafedra mudiri',
  TEACHER: 'Oʻqituvchi',
}
const { SUPER, OPERATOR, MUDIR, TEACHER } = ROLES

export const isSuperAdmin = (user) => user?.role === SUPER

// Aniq HTTP status bilan tashlanadigan ruxsat xatosi (errorHandler 403 qaytaradi)
export class AccessError extends Error {
  constructor(message, status = 403) { super(message); this.status = status }
}

// Resurs (URL path) → YOZISH ruxsati bo'lgan rollar. Super Admin bypass (bu ro'yxatlarga kirmaydi).
// Bo'sh = faqat Super Admin. `users` — delegatsiya: operator/mudir ham (qamrov bilan) yaratadi.
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
  users: [OPERATOR, MUDIR],
}

// Resurs → o'qiy oladigan rollar (ko'rsatilmagan → har kirgan user o'qiydi)
const READ_ROLES = { users: [OPERATOR, MUDIR] } // (+ Super doim)

// Resursni "bo'lim" kalitiga moslash (cheklovlar shu kalitlar bilan ishlaydi)
const SECTION = { workloads: 'loads', buildings: 'rooms', 'room-permissions': 'rooms' }
export const sectionOf = (resource) => SECTION[resource] ?? resource

// Yaratuvchi qaysi rollarni bera oladi (delegatsiya ierarxiyasi)
export function assignableRoles(user) {
  if (isSuperAdmin(user)) return [SUPER, OPERATOR, MUDIR, TEACHER]
  if (user?.role === OPERATOR) return [MUDIR, TEACHER]
  if (user?.role === MUDIR) return [TEACHER]
  return []
}

// Super Admin qo'ygan shaxsiy cheklovlarni o'qiydi (Super Admin hech qachon cheklanmaydi)
export function parseRestrictions(user) {
  const empty = { readOnly: false, denyWrite: [], denyRead: [] }
  if (isSuperAdmin(user) || !user?.restrictions) return empty
  try {
    const r = typeof user.restrictions === 'string' ? JSON.parse(user.restrictions) : user.restrictions
    return {
      readOnly: !!r?.readOnly,
      denyWrite: Array.isArray(r?.denyWrite) ? r.denyWrite : [],
      denyRead: Array.isArray(r?.denyRead) ? r.denyRead : [],
    }
  } catch { return empty }
}

// Shaxsiy cheklov shu bo'limda amalni bloklaydimi? (requests/schedule kabi maxsus marshrutlar uchun)
export function restrictionBlocks(user, section, kind = 'write') {
  if (isSuperAdmin(user)) return false
  const r = parseRestrictions(user)
  if (kind === 'write') return r.readOnly || r.denyWrite.includes(section)
  return r.denyRead.includes(section)
}

// Bu rol resursni yoza oladimi? (rol ruxsati + shaxsiy cheklov)
export function canWrite(resource, user) {
  if (isSuperAdmin(user)) return true
  if (!(WRITE[resource] ?? []).includes(user?.role)) return false
  const r = parseRestrictions(user)
  return !r.readOnly && !r.denyWrite.includes(sectionOf(resource))
}

// ── Middleware: yozish ruxsati ──
export const requireWrite = (resource) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' })
  if (canWrite(resource, req.user)) return next()
  res.status(403).json({ error: 'Ruxsat yetarli emas' })
}

// ── Middleware: o'qish ruxsati (maxfiy resurs + shaxsiy "yashirish" cheklovi) ──
export const requireRead = (resource) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' })
  const roles = READ_ROLES[resource]
  if (roles && !isSuperAdmin(req.user) && !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Ruxsat yetarli emas' })
  }
  if (restrictionBlocks(req.user, sectionOf(resource), 'read')) {
    return res.status(403).json({ error: "Bu bo'lim siz uchun yopilgan" })
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
    if (resource === 'users') return F ? { facultyId: F } : NONE
    return null // boshqa (reference) resurslarni o'qiy oladi
  }

  if (role === MUDIR) {
    const D = user?.departmentId ?? null
    if (resource === 'teachers') return D ? { departmentId: D } : NONE
    if (resource === 'workloads') return D ? { teacher: { departmentId: D } } : NONE
    if (resource === 'users') return D ? { departmentId: D } : NONE
    return null
  }

  // Oʻqituvchi va boshqalar: reference ma'lumotni o'qiy oladi (yozish baribir bloklangan)
  return null
}

// Yangi/yangilangan user'ning `facultyId`sini rol birligidan hosil qiladi (visibility uchun)
async function deriveFacultyId(data, existing) {
  const role = data?.role ?? existing?.role
  if (role === MUDIR) {
    const did = data?.departmentId ?? existing?.departmentId
    if (did != null) { const d = await prisma.department.findUnique({ where: { id: Number(did) } }); return d?.facultyId ?? null }
  } else if (role === TEACHER) {
    const tid = data?.teacherId ?? existing?.teacherId
    if (tid != null) {
      const t = await prisma.teacher.findUnique({ where: { id: Number(tid) } })
      if (t?.departmentId != null) { const d = await prisma.department.findUnique({ where: { id: t.departmentId } }); return d?.facultyId ?? null }
    }
  }
  return undefined
}

// `users` resursi uchun yozish qamrovi: rol-limiti, cheklov himoyasi, birlikka majburlash
async function scopeAssertUsers(user, data, existing) {
  const allowed = assignableRoles(user)
  if (data?.role && !allowed.includes(data.role)) {
    throw new AccessError(`Siz "${data.role}" rolini bera olmaysiz`)
  }

  if (isSuperAdmin(user)) {
    // Super Admin: cheklov qo'yadi; ko'rinish uchun facultyId derivatsiyasi (agar berilmagan)
    if (data && data.facultyId == null) {
      const fac = await deriveFacultyId(data, existing)
      if (fac !== undefined) data.facultyId = fac
    }
    return data
  }

  // Operator/Mudir cheklov qo'ya olmaydi
  if (data) delete data.restrictions
  const targetRole = data?.role ?? existing?.role
  const role = user.role

  if (role === OPERATOR) {
    const F = user.facultyId ?? null
    if (F == null) throw new AccessError('Sizga fakultet biriktirilmagan')
    if (targetRole === MUDIR) {
      const did = data?.departmentId ?? existing?.departmentId
      const dep = did != null ? await prisma.department.findUnique({ where: { id: Number(did) } }) : null
      if (!dep || dep.facultyId !== F) throw new AccessError('Kafedra sizning fakultetingizda emas')
    } else if (targetRole === TEACHER) {
      const tid = data?.teacherId ?? existing?.teacherId
      const tea = tid != null ? await prisma.teacher.findUnique({ where: { id: Number(tid) } }) : null
      const dep = tea?.departmentId != null ? await prisma.department.findUnique({ where: { id: tea.departmentId } }) : null
      if (!dep || dep.facultyId !== F) throw new AccessError("O'qituvchi sizning fakultetingizda emas")
    }
    if (data) data.facultyId = F
  } else if (role === MUDIR) {
    const D = user.departmentId ?? null
    if (D == null) throw new AccessError('Sizga kafedra biriktirilmagan')
    const tid = data?.teacherId ?? existing?.teacherId
    const tea = tid != null ? await prisma.teacher.findUnique({ where: { id: Number(tid) } }) : null
    if (!tea || tea.departmentId !== D) throw new AccessError("O'qituvchi sizning kafedrangizda emas")
    if (data) {
      data.departmentId = D
      const dep = await prisma.department.findUnique({ where: { id: D } })
      data.facultyId = dep?.facultyId ?? null
    }
  }
  return data
}

// ── YOZISHda qamrovni majburlash/tekshirish. data'ni (masalan facultyId) o'zgartirib qaytaradi ──
export async function scopeAssert(resource, user, data, existing) {
  if (resource === 'users') return scopeAssertUsers(user, data, existing)
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
