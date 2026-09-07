import { allowedSlots } from './timeslots.js'

// DB'dan ma'lumotni o'qib, optimallashtirish konteksti (events + nomzod xonalar) tuzadi.
//
// Har bir Workload(weeklyHours=N) → N ta "event" (har biri haftada bitta darsga).
// Event = jadvalga joylanadigan eng kichik birlik. Guruh/o'qituvchi/fan QAT'IY,
// faqat slot va xona o'zgaradi (qidiruv fazosi shu).
export async function loadData(prisma, semester = 1) {
  const [workloads, rooms] = await Promise.all([
    prisma.workload.findMany({
      where: { semester },
      include: { groups: { include: { group: true } }, teacher: true, subject: true },
    }),
    prisma.room.findMany({ include: { permissions: true, building: true } }),
  ])

  // Har bir xona uchun ruxsat to'plamlari (maxsus xonalar uchun) + qaysi fakultetning
  // binosida joylashgani (bino.facultyId=null → "asosiy/umumiy" bino, hamma foydalanadi)
  const roomMeta = rooms.map((r) => {
    const teachers = new Set(), groups = new Set(), specialties = new Set()
    for (const p of r.permissions) {
      if (p.teacherId != null) teachers.add(p.teacherId)
      if (p.groupId != null) groups.add(p.groupId)
      if (p.specialtyId != null) specialties.add(p.specialtyId)
    }
    return { id: r.id, name: r.name, capacity: r.capacity, type: r.type, facultyId: r.building?.facultyId ?? null, teachers, groups, specialties }
  })

  // Event uchun xona mosligi: sig'im yetarli VA kirish ruxsati bor
  const roomAllowed = (room, ev) => {
    if (room.capacity < ev.groupSize) return false // qattiq cheklash 5
    // Fakultet bino egaligi — "asosiy" bino (facultyId=null) hammaga ochiq, boshqa
    // fakultetning binosiga aralashmaydi (qattiq cheklash — bino qaysi fakultetniki
    // bo'lsa, faqat o'sha fakultet guruhlari shu bino xonalaridan foydalanadi)
    if (room.facultyId != null && !ev.facultyIds.includes(room.facultyId)) return false
    if (room.type === 'umumiy') return true // hamma foydalanishi mumkin
    // maxsus: o'qituvchi / guruh(lar) / yo'nalish(lar) ruxsati (qattiq cheklash 6,7) —
    // potokda tanlangan guruhlardan BIRIGA ruxsat bo'lsa yetarli
    return room.teachers.has(ev.teacherId)
      || ev.groupIds.some((gid) => room.groups.has(gid))
      || ev.specialtyIds.some((sid) => room.specialties.has(sid))
  }

  const events = []
  const infeasible = [] // nomzod xonasi yo'q — ma'lumot muammosi
  let eid = 0

  for (const w of workloads) {
    // Potok: bitta yuklama bir nechta guruhga bog'langan bo'lishi mumkin —
    // hammasi BIRGA bitta darsda ishtirok etadi (fan soati guruhlar soniga ko'paytirilmaydi)
    const wgroups = w.groups.map((x) => x.group).filter(Boolean)
    const groupIds = w.groups.map((x) => x.groupId)
    for (let i = 0; i < (w.weeklyHours || 1); i++) {
      const ev = {
        id: eid++,
        workloadId: w.id,
        groupIds,
        teacherId: w.teacherId,
        subjectId: w.subjectId,
        groupNames: wgroups.map((g) => g.name),
        teacherName: w.teacher?.fullName,
        subjectName: w.subject?.name,
        course: wgroups[0]?.course ?? 1,
        groupSize: wgroups.reduce((s, g) => s + (g.size ?? 0), 0), // barcha guruh talabalari yig'indisi
        specialtyIds: [...new Set(wgroups.map((g) => g.specialtyId).filter((v) => v != null))],
        facultyIds: [...new Set(wgroups.map((g) => g.facultyId).filter((v) => v != null))],
        difficulty: w.subject?.difficulty ?? 3,
        slot: -1,
        room: -1,
      }
      ev.slots = allowedSlots(ev.course) // ruxsat etilgan slotlar
      ev.rooms = roomMeta.filter((r) => roomAllowed(r, ev)).map((r) => r.id) // nomzod xonalar
      if (ev.rooms.length === 0) infeasible.push(ev)
      events.push(ev)
    }
  }

  // Indekslar — delta-baholash uchun (guruh/o'qituvchi bo'yicha eventlar). Potok event'i
  // HAR BIR o'ziga tegishli guruh ro'yxatiga qo'shiladi — shu bilan groupCost/anneal
  // barcha guruhlarga birdek ta'sirini avtomatik hisoblaydi.
  const byGroup = new Map(), byTeacher = new Map()
  for (const ev of events) {
    if (!byTeacher.has(ev.teacherId)) byTeacher.set(ev.teacherId, [])
    byTeacher.get(ev.teacherId).push(ev)
    for (const gid of ev.groupIds) {
      if (!byGroup.has(gid)) byGroup.set(gid, [])
      byGroup.get(gid).push(ev)
    }
  }

  return { events, byGroup, byTeacher, rooms: roomMeta, infeasible, semester }
}
