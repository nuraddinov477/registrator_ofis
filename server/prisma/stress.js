// Masshtab stress-testi uchun katta sintetik ma'lumot generatori.
// Topshiriq talabi: 400+ guruh, 800+ o'qituvchi, 400+ xona.
//   node --env-file=.env prisma/stress.js
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const rnd = (n) => (Math.random() * n) | 0
const pick = (arr) => arr[rnd(arr.length)]

const N = { faculties: 20, specialties: 40, teachers: 800, subjects: 100, groups: 400, rooms: 420, subjectsPerGroup: 5 }

async function main() {
  console.log('🏗️  Stress ma\'lumot generatsiyasi...')
  // tozalash
  await prisma.scheduleEntry.deleteMany(); await prisma.schedulingRun.deleteMany()
  await prisma.workload.deleteMany(); await prisma.roomPermission.deleteMany()
  await prisma.room.deleteMany(); await prisma.building.deleteMany()
  await prisma.group.deleteMany(); await prisma.subject.deleteMany()
  await prisma.teacher.deleteMany(); await prisma.specialty.deleteMany()
  await prisma.department.deleteMany(); await prisma.faculty.deleteMany()

  await prisma.faculty.createMany({ data: Array.from({ length: N.faculties }, (_, i) => ({ name: `Fakultet ${i + 1}`, code: `F${i + 1}` })) })
  const facs = await prisma.faculty.findMany()

  await prisma.specialty.createMany({ data: Array.from({ length: N.specialties }, (_, i) => ({ name: `Yo'nalish ${i + 1}`, code: `S${i + 1}`, facultyId: pick(facs).id })) })
  const specs = await prisma.specialty.findMany()

  await prisma.teacher.createMany({ data: Array.from({ length: N.teachers }, (_, i) => ({ fullName: `O'qituvchi ${i + 1}` })) })
  const teachers = await prisma.teacher.findMany({ select: { id: true } })

  await prisma.subject.createMany({ data: Array.from({ length: N.subjects }, (_, i) => ({ name: `Fan ${i + 1}`, code: `SUB${i + 1}`, difficulty: 1 + rnd(5) })) })
  const subjects = await prisma.subject.findMany({ select: { id: true } })

  await prisma.group.createMany({ data: Array.from({ length: N.groups }, (_, i) => ({
    name: `G-${i + 1}`, course: 1 + rnd(4), size: 20 + rnd(16), specialtyId: pick(specs).id,
  })) })
  const groups = await prisma.group.findMany({ select: { id: true, specialtyId: true } })

  const building = await prisma.building.create({ data: { name: 'Stress bino', floors: 9 } })
  await prisma.room.createMany({ data: Array.from({ length: N.rooms }, (_, i) => ({
    name: `R-${i + 1}`, capacity: 35 + rnd(20), type: Math.random() < 0.15 ? 'maxsus' : 'umumiy', buildingId: building.id,
  })) })
  const rooms = await prisma.room.findMany({ select: { id: true, type: true } })
  // maxsus xonalarga tasodifiy yo'nalish ruxsati (aks holda foydalanib bo'lmaydi)
  const perms = rooms.filter((r) => r.type === 'maxsus').map((r) => ({ roomId: r.id, specialtyId: pick(specs).id }))
  if (perms.length) await prisma.roomPermission.createMany({ data: perms })

  // Ish yuklamalari: har guruh ~5 fan × 2 soat, tasodifiy o'qituvchi
  const workloads = []
  for (const g of groups) {
    for (let k = 0; k < N.subjectsPerGroup; k++) {
      workloads.push({ groupId: g.id, teacherId: pick(teachers).id, subjectId: pick(subjects).id, weeklyHours: 2 + rnd(2), semester: 1 })
    }
  }
  // partiyalarga bo'lib yozamiz
  for (let i = 0; i < workloads.length; i += 1000) {
    await prisma.workload.createMany({ data: workloads.slice(i, i + 1000) })
  }

  const totalEvents = workloads.reduce((s, w) => s + w.weeklyHours, 0)
  console.log(`✅ Yaratildi: ${N.groups} guruh, ${N.teachers} o'qituvchi, ${N.rooms} xona, ${workloads.length} yuklama → ~${totalEvents} event`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
