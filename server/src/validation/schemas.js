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

  teacher: z.object({ fullName: name, position: optStr, degree: optStr, email: optStr, departmentId: optInt }),

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

  user: z.object({ login: name, fullName: name, email: optStr, role: optStr, active: bool }),
}
