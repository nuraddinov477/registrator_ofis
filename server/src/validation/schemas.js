import { z } from 'zod'

// Yordamchilar: '' yoki null/undefined -> null; raqamlar avtomatik o'giriladi
const optStr = z.preprocess((v) => (v === '' || v == null ? null : String(v)), z.string().nullable())
const optInt = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().nullable())
const reqInt = z.preprocess((v) => Number(v), z.number().int())
const intDef = (d) => z.preprocess((v) => (v === '' || v == null ? d : Number(v)), z.number().int())
const bool = z.preprocess((v) => (typeof v === 'string' ? v === 'true' : Boolean(v)), z.boolean())
const name = z.string().trim().min(1, 'Bo\'sh bo\'lishi mumkin emas')

export const schemas = {
  faculty: z.object({ name, code: optStr, description: optStr }),

  department: z.object({ name, code: optStr, head: optStr, facultyId: optInt }),

  specialty: z.object({ name, code: optStr, form: optStr, years: intDef(4), facultyId: optInt }),

  teacher: z.object({
    fullName: name, position: optStr, degree: optStr, email: optStr, departmentId: optInt,
    status: z.preprocess((v) => (v === '' || v == null ? 'faol' : v), z.enum(['faol', 'dekret', "ta'til"])),
  }),

  subject: z.object({
    name, code: optStr, type: optStr,
    credit: intDef(3), lecture: intDef(30), practice: intDef(30), semester: intDef(1),
    difficulty: intDef(3),
  }),

  group: z.object({ name, course: intDef(1), size: intDef(25), form: optStr, facultyId: optInt, specialtyId: optInt }),

  building: z.object({ name, floors: intDef(1), address: optStr }),

  room: z.object({
    name,
    capacity: intDef(30),
    type: z.preprocess((v) => (v === '' || v == null ? 'umumiy' : v), z.enum(['umumiy', 'maxsus'])),
    kind: optStr,
    buildingId: optInt,
  }),

  roomPermission: z.object({ roomId: reqInt, teacherId: optInt, groupId: optInt, specialtyId: optInt }),

  workload: z.object({ groupId: reqInt, teacherId: reqInt, subjectId: reqInt, weeklyHours: intDef(2), semester: intDef(1) }),

  // password: yaratishda/parolni o'zgartirishda beriladi; bo'sh bo'lsa passwordHash tegilmaydi
  // facultyId/departmentId/teacherId: rol qamrovi — userni o'z birligiga biriktiradi
  // restrictions: Super Admin qo'yadigan shaxsiy cheklovlar — obyekt kelsa JSON-string'ga o'giriladi
  user: z.object({
    login: name, fullName: name, email: optStr, role: optStr, active: bool, password: optStr,
    facultyId: optInt, departmentId: optInt, teacherId: optInt,
    restrictions: z.preprocess(
      (v) => (v == null || v === '' ? null : (typeof v === 'string' ? v : JSON.stringify(v))),
      z.string().nullable(),
    ),
  }),
}
