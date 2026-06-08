import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seed boshlandi...')

  // Tozalash (bog'liqlik tartibida)
  await prisma.scheduleEntry.deleteMany()
  await prisma.schedulingRun.deleteMany()
  await prisma.workload.deleteMany()
  await prisma.roomPermission.deleteMany()
  await prisma.room.deleteMany()
  await prisma.building.deleteMany()
  await prisma.group.deleteMany()
  await prisma.subject.deleteMany()
  await prisma.teacher.deleteMany()
  await prisma.specialty.deleteMany()
  await prisma.department.deleteMany()
  await prisma.faculty.deleteMany()
  await prisma.user.deleteMany()
  await prisma.auditLog.deleteMany()

  // ── Fakultetlar ──
  const fac = {}
  for (const f of [
    ['AF', 'Amaliy fanlar fakulteti'],
    ['SHSF', 'Sharq sivilizatsiyasi va falsafa fakulteti'],
    ['SHXTAI', 'Sharq xalqlari tillari va adabiyoti instituti'],
    ['TSXIMI', 'Tashqi siyosat va xalqaro iqtisodiy munosabatlar instituti'],
  ]) {
    const row = await prisma.faculty.create({ data: { name: f[1], code: f[0] } })
    fac[f[0]] = row.id
  }

  // ── Kafedralar ──
  await prisma.department.createMany({
    data: [
      { name: 'Arabshunoslik oliy maktabi', code: 'arab', facultyId: fac.SHXTAI, head: 'Bultakov Ikrom Yusupovich' },
      { name: "G'arb tillari kafedrasi", code: 'Garb-tillari', facultyId: fac.AF, head: 'Saidabarova Saodat Parxadjanovna' },
      { name: 'Iqtisodiyot va menejment kafedrasi', code: 'Iqtisod', facultyId: fac.TSXIMI, head: 'Kadirova Zulayho Abduxalimovna' },
      { name: 'Pedagogika va psixologiya kafedrasi', code: 'Ped', facultyId: fac.AF, head: 'Abdullayeva Shoira Xamidovna' },
    ],
  })

  // ── Yo'nalishlar (direction) ──
  const spec = {}
  for (const s of [
    ['Arab tili va adabiyoti', 'AR-01', fac.SHXTAI],
    ['Xalqaro iqtisodiy munosabatlar', 'XIM-01', fac.TSXIMI],
  ]) {
    const row = await prisma.specialty.create({ data: { name: s[0], code: s[1], facultyId: s[2], form: 'Kunduzgi', years: 4 } })
    spec[s[1]] = row.id
  }

  // ── O'qituvchilar ──
  const tch = {}
  for (const t of [
    ['Karimov Akbar', 'Dotsent', 'PhD'],
    ['Yusupova Dilnoza', 'Katta o\'qituvchi', '—'],
    ['Rashidov Sardor', 'Professor', 'DSc'],
    ['Olimova Malika', 'Assistent', '—'],
  ]) {
    const row = await prisma.teacher.create({ data: { fullName: t[0], position: t[1], degree: t[2] } })
    tch[t[0]] = row.id
  }

  // ── Fanlar (difficulty: 1..5 — qiyin fanlar ertalabki juftliklarga) ──
  const sub = {}
  for (const s of [
    ['Arab tili grammatikasi', 'AR-GR', 4],
    ['Makroiqtisodiyot', 'ECO-MAC', 5],
    ['Pedagogika', 'PED-01', 2],
    ['Jismoniy tarbiya', 'PE-01', 1],
  ]) {
    const row = await prisma.subject.create({ data: { name: s[0], code: s[1], type: 'Majburiy', difficulty: s[2] } })
    sub[s[1]] = row.id
  }

  // ── Guruhlar (size = talabalar soni) ──
  const grp = {}
  for (const g of [
    ['AR-101', 1, 28, spec['AR-01']],
    ['AR-401', 4, 22, spec['AR-01']],
    ['XIM-201', 2, 30, spec['XIM-01']],
  ]) {
    const row = await prisma.group.create({ data: { name: g[0], course: g[1], size: g[2], specialtyId: g[3], form: 'Kunduzgi' } })
    grp[g[0]] = row.id
  }

  // ── Bino va xonalar ──
  const building = await prisma.building.create({ data: { name: 'Asosiy bino', floors: 4, address: 'Toshkent' } })
  const room = {}
  for (const r of [
    ['101', 30, 'umumiy', "Ma'ruza"],
    ['102', 25, 'umumiy', 'Amaliy'],
    ['Lingafon-1', 20, 'maxsus', 'Laboratoriya'], // maxsus xona
    ['Sport zali', 60, 'umumiy', 'Amaliy'],
  ]) {
    const row = await prisma.room.create({ data: { name: r[0], capacity: r[1], type: r[2], kind: r[3], buildingId: building.id } })
    room[r[0]] = row.id
  }

  // ── Maxsus xona ruxsati: Lingafon faqat AR-01 yo'nalishiga ──
  await prisma.roomPermission.create({ data: { roomId: room['Lingafon-1'], specialtyId: spec['AR-01'] } })

  // ── Ish yuklamalari (weeklyHours = haftalik juftliklar soni) ──
  await prisma.workload.createMany({
    data: [
      { groupId: grp['AR-101'], teacherId: tch['Karimov Akbar'], subjectId: sub['AR-GR'], weeklyHours: 3 },
      { groupId: grp['AR-101'], teacherId: tch['Olimova Malika'], subjectId: sub['PE-01'], weeklyHours: 2 },
      { groupId: grp['AR-401'], teacherId: tch['Karimov Akbar'], subjectId: sub['AR-GR'], weeklyHours: 2 },
      { groupId: grp['XIM-201'], teacherId: tch['Rashidov Sardor'], subjectId: sub['ECO-MAC'], weeklyHours: 3 },
      { groupId: grp['XIM-201'], teacherId: tch['Yusupova Dilnoza'], subjectId: sub['PED-01'], weeklyHours: 2 },
    ],
  })

  // ── Foydalanuvchilar (parollar bilan) ──
  const adminHash = await bcrypt.hash('admin123', 10)
  const opHash = await bcrypt.hash('operator123', 10)
  await prisma.user.createMany({
    data: [
      { login: 'admin', fullName: 'Admin Super', email: 'admin@university.uz', role: 'Super Admin', active: true, passwordHash: adminHash },
      { login: 'operator', fullName: 'Egamberdiyev Abduvahob', role: 'Fakultet operatori', active: true, passwordHash: opHash },
    ],
  })

  const counts = {
    faculties: await prisma.faculty.count(),
    departments: await prisma.department.count(),
    specialties: await prisma.specialty.count(),
    teachers: await prisma.teacher.count(),
    subjects: await prisma.subject.count(),
    groups: await prisma.group.count(),
    rooms: await prisma.room.count(),
    workloads: await prisma.workload.count(),
  }
  console.log('✅ Seed tugadi:', counts)
}

main()
  .catch((e) => {
    console.error('❌ Seed xatosi:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
