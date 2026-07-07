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
  users: [],
}
// store'dagi kolleksiya nomi ↔ backend resurs nomi
const ALIAS = { loads: 'workloads' }

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
  '/users': [SUPER],
  '/audit': [SUPER],
}

export const currentUser = () => auth.user()
export const roleOf = (user) => (user ?? auth.user())?.role
export const isSuperAdmin = (user) => roleOf(user) === SUPER

// Bu rol resursni yoza oladimi?
export function canWrite(resource, user) {
  const u = user ?? auth.user()
  if (isSuperAdmin(u)) return true
  const res = ALIAS[resource] ?? resource
  return (WRITE[res] ?? []).includes(u?.role)
}

// Bu yo'l shu rolga ko'rinadimi?
export function canSeeRoute(path, user) {
  const u = user ?? auth.user()
  if (isSuperAdmin(u)) return true
  return (ROUTE_ROLES[path] ?? [SUPER]).includes(u?.role)
}

// Scoped rol (operator/mudir) birlikka bog'lanmaganmi? → banner ko'rsatiladi
export function unassignedScope(user) {
  const u = user ?? auth.user()
  if (u?.role === OPERATOR && u?.facultyId == null) return 'fakultet'
  if (u?.role === MUDIR && u?.departmentId == null) return 'kafedra'
  if (u?.role === TEACHER && u?.teacherId == null) return "o'qituvchi yozuvi"
  return null
}
