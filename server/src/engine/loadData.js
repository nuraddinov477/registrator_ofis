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
      include: { group: true, teacher: true, subject: true },
    }),
    prisma.room.findMany({ include: { permissions: true } }),
  ])

  // Har bir xona uchun ruxsat to'plamlari (maxsus xonalar uchun)
  const roomMeta = rooms.map((r) => {
    const teachers = new Set(), groups = new Set(), specialties = new Set()
    for (const p of r.permissions) {
      if (p.teacherId != null) teachers.add(p.teacherId)
      if (p.groupId != null) groups.add(p.groupId)
      if (p.specialtyId != null) specialties.add(p.specialtyId)
    }
    return { id: r.id, name: r.name, capacity: r.capacity, type: r.type, teachers, groups, specialties }
  })

  // Event uchun xona mosligi: sig'im yetarli VA kirish ruxsati bor
  const roomAllowed = (room, ev) => {
    if (room.capacity < ev.groupSize) return false // qattiq cheklash 5
    if (room.type === 'umumiy') return true // hamma foydalanishi mumkin
    // maxsus: o'qituvchi / guruh / yo'nalish ruxsati (qattiq cheklash 6,7)
    return room.teachers.has(ev.teacherId)
      || room.groups.has(ev.groupId)
      || (ev.specialtyId != null && room.specialties.has(ev.specialtyId))
  }

  const events = []
  const infeasible = [] // nomzod xonasi yo'q — ma'lumot muammosi
  let eid = 0

  for (const w of workloads) {
    for (let i = 0; i < (w.weeklyHours || 1); i++) {
      const ev = {
        id: eid++,
        workloadId: w.id,
        groupId: w.groupId,
        teacherId: w.teacherId,
        subjectId: w.subjectId,
        groupName: w.group?.name,
        teacherName: w.teacher?.fullName,
        subjectName: w.subject?.name,
        course: w.group?.course ?? 1,
        groupSize: w.group?.size ?? 25,
        specialtyId: w.group?.specialtyId ?? null,
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

  // Indekslar — delta-baholash uchun (guruh/o'qituvchi bo'yicha eventlar)
  const byGroup = new Map(), byTeacher = new Map()
  for (const ev of events) {
    if (!byGroup.has(ev.groupId)) byGroup.set(ev.groupId, [])
    if (!byTeacher.has(ev.teacherId)) byTeacher.set(ev.teacherId, [])
    byGroup.get(ev.groupId).push(ev)
    byTeacher.get(ev.teacherId).push(ev)
  }

  return { events, byGroup, byTeacher, rooms: roomMeta, infeasible, semester }
}
