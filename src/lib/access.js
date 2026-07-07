import { auth } from '../api/client'

// ─────────── Frontend rol-huquq (backend server/src/auth/access.js nusxasi) ───────────
// Faqat qulaylik uchun (tugma/menyu yashirish). Asl himoya backendda (403/scoped where).

export const ROLES = {
  SUPER: 'Super Admin',
  OPERATOR: 'Fakultet operatori',
  MUDIR: 'Kafedra mudiri',
  TEACHER: 'Oʻqituvchi',
}
const { SUPER, OPERATOR, MUDIR, TEACHER } = ROLES

// Resurs → YOZISH ruxsati bo'lgan rollar (Super Admin har doim yozadi). Bo'sh = faqat Super Admin.
const WRITE = {
  faculties: [], departments: [], buildings: [],
  specialties: [OPERATOR], groups: [OPERATOR],
  teachers: [MUDIR],
  subjects: [OPERATOR, MUDIR], rooms: [OPERATOR], 'room-permissions': [OPERATOR],
  workloads: [OPERATOR, MUDIR],
  users: [OPERATOR, MUDIR], // delegatsiya: o'z doirasida akkaunt yaratadi
}
// store'dagi kolleksiya nomi ↔ backend resurs nomi
const ALIAS = { loads: 'workloads' }
// resurs/kolleksiya → "bo'lim" kaliti (cheklovlar shu kalitlar bilan)
const SECTION = { loads: 'loads', workloads: 'loads', buildings: 'rooms', 'room-permissions': 'rooms' }
export const sectionOf = (key) => SECTION[key] ?? key

// Menyu/route ko'rinishi: har yo'l qaysi rollarga ko'rinadi
const ROUTE_ROLES = {
  '/': [SUPER, OPERATOR, MUDIR, TEACHER],
  '/loads': [SUPER, OPERATOR, MUDIR],
  '/requests': [SUPER, OPERATOR, MUDIR],
  '/faculties': [SUPER],
  '/departments': [SUPER],
  '/specialties': [SUPER, OPERATOR],
  '/teachers': [SUPER, OPERATOR, MUDIR],
  '/subjects': [SUPER, OPERATOR, MUDIR],
  '/groups': [SUPER, OPERATOR],
  '/rooms': [SUPER, OPERATOR],
  '/schedule': [SUPER, OPERATOR, MUDIR, TEACHER],
  '/users': [SUPER, OPERATOR, MUDIR], // delegatsiya
  '/audit': [SUPER],
}

// Cheklov UI uchun bo'lim nomlari
export const SECTION_LABELS = {
  loads: "O'quv yuklamasi", requests: 'Talabnomalar', specialties: 'Mutaxassisliklar',
  teachers: "O'qituvchilar", subjects: 'Fanlar', groups: 'Guruhlar', rooms: 'Bino va xonalar',
  schedule: 'Dars jadvali', users: 'Foydalanuvchilar', faculties: 'Fakultetlar', departments: 'Kafedralar', audit: 'Audit',
}

export const currentUser = () => auth.user()
export const roleOf = (user) => (user ?? auth.user())?.role
export const isSuperAdmin = (user) => roleOf(user) === SUPER

// Super Admin qo'ygan shaxsiy cheklovlar (Super Admin cheklanmaydi)
export function restrictionsOf(user) {
  const u = user ?? auth.user()
  const empty = { readOnly: false, denyWrite: [], denyRead: [] }
  if (isSuperAdmin(u) || !u?.restrictions) return empty
  try {
    const r = typeof u.restrictions === 'string' ? JSON.parse(u.restrictions) : u.restrictions
    return { readOnly: !!r?.readOnly, denyWrite: r?.denyWrite || [], denyRead: r?.denyRead || [] }
  } catch { return empty }
}

// Bu rol resursni yoza oladimi? (rol ruxsati + shaxsiy cheklov)
export function canWrite(resource, user) {
  const u = user ?? auth.user()
  if (isSuperAdmin(u)) return true
  const res = ALIAS[resource] ?? resource
  if (!(WRITE[res] ?? []).includes(u?.role)) return false
  const r = restrictionsOf(u)
  return !r.readOnly && !r.denyWrite.includes(sectionOf(resource))
}

// Bu yo'l shu rolga ko'rinadimi? (rol + shaxsiy "yashirish" cheklovi)
export function canSeeRoute(path, user) {
  const u = user ?? auth.user()
  if (isSuperAdmin(u)) return true
  if (!(ROUTE_ROLES[path] ?? [SUPER]).includes(u?.role)) return false
  const section = path.replace('/', '')
  if (!section) return true // Dashboard doim ko'rinadi
  return !restrictionsOf(u).denyRead.includes(section)
}

// Yaratuvchi qaysi rollarni bera oladi (delegatsiya ierarxiyasi)
export function assignableRoles(user) {
  const u = user ?? auth.user()
  if (isSuperAdmin(u)) return [SUPER, OPERATOR, MUDIR, TEACHER]
  if (u?.role === OPERATOR) return [MUDIR, TEACHER]
  if (u?.role === MUDIR) return [TEACHER]
  return []
}

// Shu rol yoza oladigan bo'limlar (cheklov "yozishni taqiqlash" checkboxlari uchun)
export function writableSections(role) {
  const out = []
  for (const [res, roles] of Object.entries(WRITE)) if (roles.includes(role)) out.push(sectionOf(res))
  if (role === OPERATOR || role === MUDIR) out.push('requests')
  if (role === OPERATOR) out.push('schedule')
  return [...new Set(out)]
}

// Shu rol ko'ra oladigan bo'limlar (cheklov "yashirish" checkboxlari uchun) — Dashboard'dan tashqari
export function visibleSections(role) {
  return Object.keys(ROUTE_ROLES)
    .filter((p) => (ROUTE_ROLES[p] || []).includes(role))
    .map((p) => p.replace('/', ''))
    .filter((s) => s)
}

// Scoped rol (operator/mudir) birlikka bog'lanmaganmi? → banner ko'rsatiladi
export function unassignedScope(user) {
  const u = user ?? auth.user()
  if (u?.role === OPERATOR && u?.facultyId == null) return 'fakultet'
  if (u?.role === MUDIR && u?.departmentId == null) return 'kafedra'
  if (u?.role === TEACHER && u?.teacherId == null) return "o'qituvchi yozuvi"
  return null
}
