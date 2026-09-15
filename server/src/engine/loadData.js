import { allowedSlots, dayOf, pairOf, PAIRS } from './timeslots.js'

// Katta auditoriya chegarasi: bundan katta sig'imli xonalar faqat shuncha (yoki undan
// ortiq) talabali guruh/potokka ajratiladi — kichik guruhlar band qilmaydi.
export const LARGE_ROOM_CAPACITY = 60
// Asosiy (fakultetsiz) binodagi katta zallar ("Katta zal 1-7" va h.k.) uchun QAT'IY
// diapazon (dars turidan qat'i nazar) — asosiy 70-100 talabali potok, ± 5 talaba
// tolerantlik bilan (ya'ni 65-105) — chegaraga yaqin guruhlar butunlay joysiz qolib
// ketmasligi uchun.
export const MAIN_HALL_MIN = 65
export const MAIN_HALL_MAX = 105

// DB'dan ma'lumotni o'qib, optimallashtirish konteksti (events + nomzod xonalar) tuzadi.
//
// Har bir Workload(weeklyHours=N) → N ta "event" (har biri haftada bitta darsga).
// Event = jadvalga joylanadigan eng kichik birlik. Guruh/o'qituvchi/fan QAT'IY,
// faqat slot va xona o'zgaradi (qidiruv fazosi shu).
export async function loadData(prisma, semester = 1, opts = {}) {
  // groupStartPairs/groupEndPairs — har bir guruhning [boshlanish..tugash] juftlik
  // oralig'i (1..6, real soatlar uchun timeslots.js'dagi PAIR_TIMES'ga qarang):
  // { [groupId]: pair }. Superadmin har bir guruhni ALOHIDA tanlaydi. Ko'rsatilmagan
  // guruhlar uchun standart — 1 (8:00) dan 6 (tugash, 17:20) gacha, ya'ni to'liq kun.
  const { groupStartPairs = {}, groupEndPairs = {} } = opts
  const startPairOf = (gid) => {
    const v = Number(groupStartPairs[gid])
    return Number.isInteger(v) && v >= 1 && v <= PAIRS ? v : 1
  }
  const endPairOf = (gid, start) => {
    const v = Number(groupEndPairs[gid])
    return Number.isInteger(v) && v >= start && v <= PAIRS ? v : PAIRS
  }
  const [workloads, rooms, teacherConstraints] = await Promise.all([
    prisma.workload.findMany({
      where: { semester, archived: false }, // arxivlangan yuklama jadval tuzishda hisobga olinmaydi
      include: { groups: { include: { group: true } }, teacher: true, subject: true },
    }),
    prisma.room.findMany({ include: { permissions: true, building: { include: { faculties: true } } } }),
    prisma.teacherConstraint.findMany(),
  ])

  // Har bir xona uchun ruxsat to'plamlari (maxsus xonalar uchun) + qaysi fakultet(lar)ning
  // binosida joylashgani (bino.faculties=[] → "asosiy/umumiy" bino, hamma foydalanadi;
  // bino BIR NECHTA fakultetga tegishli bo'lishi mumkin — ko'p-ko'pga)
  const roomMeta = rooms.map((r) => {
    const teachers = new Set(), groups = new Set(), specialties = new Set(), exclusiveGroups = new Set(), subjects = new Set()
    for (const p of r.permissions) {
      if (p.teacherId != null) teachers.add(p.teacherId)
      if (p.groupId != null) { groups.add(p.groupId); if (p.exclusive) exclusiveGroups.add(p.groupId) }
      if (p.specialtyId != null) specialties.add(p.specialtyId)
      if (p.subjectId != null) subjects.add(p.subjectId)
    }
    const facultyIds = r.building?.faculties?.map((f) => f.id) ?? []
    return { id: r.id, name: r.name, capacity: r.capacity, type: r.type, facultyIds, teachers, groups, specialties, exclusiveGroups, subjects }
  })

  // Guruhga MAXSUS biriktirilgan xona(lar) — RoomPermission'da shu guruhga aniq ruxsat
  // berilgan xonalar (Auditoriyaga biriktirilgan guruh — darslari o'sha xonaga qo'yilishi kerak).
  // groupRoomMap — yumshoq ustuvorlik (assignedRoom). groupOnlyRoomMap — QAT'IY (exclusive):
  // guruh FAQAT shu xona(lar)da dars o'tadi, boshqa xona nomzod bo'lmaydi.
  // teacherRoomMap — o'qituvchiga MAXSUS biriktirilgan xona(lar): shu o'qituvchining
  // darsi bo'lsa, o'sha xona unga ham ustuvor (assignedRoom). O'qituvchining darsi
  // yo'q/boshqa vaqtda bo'lsa — xona band emas, shu bino/xona ruxsati bor GURUHLAR
  // (groupRoomMap) ham xuddi shu ustuvorlik bilan tortiladi — ikkalasi ham "tekshiriladi".
  const groupRoomMap = new Map() // groupId -> Set(roomId)  (barcha ruxsatlar)
  const groupOnlyRoomMap = new Map() // groupId -> Set(roomId)  (faqat exclusive)
  const teacherRoomMap = new Map() // teacherId -> Set(roomId)
  // Fanga MAXSUS biriktirilgan xona(lar) — masalan "Jismoniy tarbiya" → sport zali.
  // Qaysi guruh/o'qituvchi bo'lishidan qat'i nazar, shu FAN darsi bo'lsa ustuvor (va
  // maxsus xona bo'lsa — kirish ruxsati ham shu orqali beriladi, roomAllowed'ga qarang).
  const subjectRoomMap = new Map() // subjectId -> Set(roomId)
  for (const r of roomMeta) {
    for (const gid of r.groups) {
      if (!groupRoomMap.has(gid)) groupRoomMap.set(gid, new Set())
      groupRoomMap.get(gid).add(r.id)
    }
    for (const gid of r.exclusiveGroups) {
      if (!groupOnlyRoomMap.has(gid)) groupOnlyRoomMap.set(gid, new Set())
      groupOnlyRoomMap.get(gid).add(r.id)
    }
    for (const tid of r.teachers) {
      if (!teacherRoomMap.has(tid)) teacherRoomMap.set(tid, new Set())
      teacherRoomMap.get(tid).add(r.id)
    }
    for (const sid of r.subjects) {
      if (!subjectRoomMap.has(sid)) subjectRoomMap.set(sid, new Set())
      subjectRoomMap.get(sid).add(r.id)
    }
  }

  // O'qituvchi istisnolari (qaysi kunlarda dars qo'yilmasin / faqat qaysi paralarga qo'yilsin)
  const tcMap = new Map() // teacherId -> { blockedDays: Set<int>, allowedPairs: Set<int> }
  for (const tc of teacherConstraints) {
    let blockedDays = [], allowedPairs = []
    try { blockedDays = tc.blockedDays ? JSON.parse(tc.blockedDays) : [] } catch { /* noto'g'ri JSON — e'tiborsiz */ }
    try { allowedPairs = tc.allowedPairs ? JSON.parse(tc.allowedPairs) : [] } catch { /* noto'g'ri JSON — e'tiborsiz */ }
    tcMap.set(tc.teacherId, { blockedDays: new Set(blockedDays), allowedPairs: new Set(allowedPairs) })
  }

  // Xonaga aniq (o'qituvchi/guruh/yo'nalish/fan) ruxsat berilganmi? — maxsus xona
  // uchun kirish sharti VA bino-fakultet egaligini chetlab o'tish sababi (pastga q.)
  const hasRoomPermission = (room, ev) =>
    room.teachers.has(ev.teacherId)
    || ev.groupIds.some((gid) => room.groups.has(gid))
    || ev.specialtyIds.some((sid) => room.specialties.has(sid))
    || room.subjects.has(ev.subjectId)

  // Event uchun xona mosligi: sig'im yetarli VA kirish ruxsati bor
  const roomAllowed = (room, ev) => {
    if (room.capacity < ev.groupSize) return false // qattiq cheklash 5
    if (room.capacity > LARGE_ROOM_CAPACITY) {
      if (room.facultyIds.length === 0) {
        // Asosiy (fakultetsiz) binodagi katta zal ("Katta zal 1-7" va h.k.) — QAT'IY,
        // TUR (Ma'ruza/Amaliy/Seminar)DAN QAT'I NAZAR: faqat MAIN_HALL_MIN-MAIN_HALL_MAX
        // (65-105, ya'ni 70-100 ± 5 tolerantlik) talabali potok.
        // Boshqa hech narsa — Amaliy/Seminar ham — "oxirgi chora" sifatida bu yerga
        // TUSHMAYDI; mos joy topilmasa, bo'sh qoladi (boshqa yechim keyin ko'riladi).
        // 1) Fanga maxsus xona biriktirilgan bo'lsa (masalan Jismoniy tarbiya — sport
        //    zali) — bu fan katta zaldan UMUMAN foydalanmaydi (subjectRoomMap).
        if (subjectRoomMap.has(ev.subjectId)) return false
        // 2) QAT'IY: faqat MAIN_HALL_MIN-MAIN_HALL_MAX talabali potok (qattiq cheklash 8)
        if (ev.groupSize < MAIN_HALL_MIN || ev.groupSize > MAIN_HALL_MAX) return false
      } else if (ev.groupSize <= LARGE_ROOM_CAPACITY && ev.type === 'Maʼruza') {
        // Fakultetga tegishli katta xona (kamdan-kam) — oddiy 60+ qoidasi. Amaliy/
        // Seminar (kichik guruh) darslarga qattiq taqiqlanmaydi — aks holda kichik
        // xonasi umuman yo'q fakultetlar hech qanday dars o'tkaza olmay qoladi.
        // Bunday holatda ham ortiqcha sig'im roomFit yumshoq jarimasi bilan kamroq
        // afzal qilinadi, lekin oxirgi chora sifatida ishlatilishi mumkin.
        return false
      }
    }
    // Fakultet bino egaligi — "asosiy" bino (faculties=[]) hammaga ochiq, boshqa
    // fakultetning binosiga aralashmaydi (qattiq cheklash — bino BIR YOKI BIR NECHTA
    // fakultetga tegishli bo'lishi mumkin; shu fakultet(lar)dan BIRIGA tegishli guruh
    // shu bino xonalaridan foydalana oladi).
    // ISTISNO: xonaga aniq ruxsat (o'qituvchi/guruh/yo'nalish/fan) berilgan bo'lsa —
    // masalan boshqa fakultetning binosidagi xonani biror guruhga maxsus biriktirilsa
    // (xona sig'imi yetarli bo'lib, o'z binosi yetishmayotgan fakultetlar uchun) —
    // bino-fakultet egaligi chetlab o'tiladi. Bu ATAYLAB shunday: aniq ruxsat umumiy
    // qoidadan ustun turadi, qaysi binoda joylashganidan qat'i nazar.
    if (room.facultyIds.length > 0 && !room.facultyIds.some((fid) => ev.facultyIds.includes(fid)) && !hasRoomPermission(room, ev)) return false
    if (room.type === 'umumiy') return true // hamma foydalanishi mumkin
    // maxsus: o'qituvchi / guruh(lar) / yo'nalish(lar) / FAN ruxsati (qattiq cheklash 6,7) —
    // potokda tanlangan guruhlardan BIRIGA (yoki darsning fani) ruxsat bo'lsa yetarli
    return hasRoomPermission(room, ev)
  }

  // O'qituvchi istisnolariga mos ravishda ruxsat etilgan slotlarni toraytiradi
  const applyTeacherConstraint = (slots, teacherId) => {
    const tc = tcMap.get(teacherId)
    if (!tc || (tc.blockedDays.size === 0 && tc.allowedPairs.size === 0)) return slots
    return slots.filter((s) => {
      if (tc.blockedDays.has(dayOf(s))) return false
      if (tc.allowedPairs.size > 0 && !tc.allowedPairs.has(pairOf(s))) return false
      return true
    })
  }

  const events = []
  const infeasible = [] // nomzod xonasi/slot yo'q — ma'lumot muammosi
  let eid = 0

  for (const w of workloads) {
    // Potok: bitta yuklama bir nechta guruhga bog'langan bo'lishi mumkin —
    // hammasi BIRGA bitta darsda ishtirok etadi (fan soati guruhlar soniga ko'paytirilmaydi)
    const wgroups = w.groups.map((x) => x.group).filter(Boolean)
    const groupIds = w.groups.map((x) => x.groupId)
    // Shu potokdagi guruh(lar)ga VA/YOKI shu o'qituvchiga VA/YOKI shu FANGA maxsus
    // biriktirilgan xona(lar) — bo'lsa, jadval tuzishda ustuvor (barchasi tekshiriladi,
    // natijalar birlashtiriladi)
    const assignedRooms = [...new Set([
      ...groupIds.flatMap((gid) => [...(groupRoomMap.get(gid) || [])]),
      ...(teacherRoomMap.get(w.teacherId) || []),
      ...(subjectRoomMap.get(w.subjectId) || []),
    ])]
    // QAT'IY biriktirish (exclusive): guruh(lar) faqat shu xona(lar)da dars o'tadi.
    // Bir nechta guruh bo'lsa — kesishma (hammasiga mos xona). Kesishma bo'sh bo'lsa — ziddiyat.
    const exSets = groupIds.map((gid) => groupOnlyRoomMap.get(gid)).filter(Boolean)
    const exclusiveRooms = exSets.length
      ? [...exSets[0]].filter((rid) => exSets.every((s) => s.has(rid)))
      : null
    for (let i = 0; i < (w.weeklyHours || 1); i++) {
      const ev = {
        id: eid++,
        workloadId: w.id,
        groupIds,
        teacherId: w.teacherId,
        subjectId: w.subjectId,
        type: w.type || 'Amaliy', // Maʼruza / Seminar / Amaliy — haftalik tartib uchun (constraints.js)
        groupNames: wgroups.map((g) => g.name),
        teacherName: w.teacher?.fullName,
        subjectName: w.subject?.name,
        course: wgroups[0]?.course ?? 1,
        startPair: startPairOf(wgroups[0]?.id), // guruhning boshlanish juftligi (constraints.js dayStart uchun)
        endPair: endPairOf(wgroups[0]?.id, startPairOf(wgroups[0]?.id)), // guruhning tugash juftligi
        groupSize: wgroups.reduce((s, g) => s + (g.size ?? 0), 0), // barcha guruh talabalari yig'indisi
        specialtyIds: [...new Set(wgroups.map((g) => g.specialtyId).filter((v) => v != null))],
        facultyIds: [...new Set(wgroups.map((g) => g.facultyId).filter((v) => v != null))],
        difficulty: w.subject?.difficulty ?? 3,
        assignedRooms,
        slot: -1,
        room: -1,
      }
      ev.slots = applyTeacherConstraint(allowedSlots(ev.startPair, ev.endPair), ev.teacherId) // ruxsat etilgan slotlar
      // Nomzod xonalar: biriktirilgan xona(lar) oldinda, keyin sig'imi bo'yicha saralanadi —
      // greedy shulardan birinchi bo'sh topganini tanlaydi. ODATIY (bitta guruh) darsda ENG
      // KICHIK mos xona afzal (roomFit soft cheklashiga mos, katta xonani behuda band qilmaslik).
      // POTOK (bir nechta guruh BIRGA, groupIds.length>1) darsda ESA — teskarisi: ENG KATTA
      // (katta zal) xona afzal — chunki potok guruhlarni BITTA xonaga jamlaydi, shu bilan
      // ularning ALOHIDA kichik xonalari o'sha vaqt uchun BO'SHAB QOLADI (boshqa, potok
      // bo'lmagan darslar uchun ishlatiladi) — roomFit bu holatda constraints.js'da
      // qo'llanilmaydi (groupCost'ga qarang), shu sabab bu ustuvorlik SA davomida ham saqlanadi.
      const isPotok = groupIds.length > 1
      const candidateRooms = roomMeta.filter((r) =>
        roomAllowed(r, ev) && (exclusiveRooms == null || exclusiveRooms.includes(r.id)))
      candidateRooms.sort((a, b) => {
        const aA = assignedRooms.includes(a.id) ? 0 : 1, bA = assignedRooms.includes(b.id) ? 0 : 1
        if (aA !== bA) return aA - bA
        return isPotok ? b.capacity - a.capacity : a.capacity - b.capacity
      })
      ev.rooms = candidateRooms.map((r) => r.id)
      ev.roomCapacities = Object.fromEntries(candidateRooms.map((r) => [r.id, r.capacity]))
      // Nega joylab bo'lmaydi — aniq sabab (UI'da ko'rsatiladi)
      if (ev.slots.length === 0) {
        ev.reason = "o'qituvchining istisnolari (bloklangan kunlar / faqat ayrim juftliklar) tufayli bo'sh vaqt qolmadi"
        infeasible.push(ev)
      } else if (ev.rooms.length === 0) {
        const fitByCap = roomMeta.filter((r) => r.capacity >= ev.groupSize)
        const fitByFaculty = fitByCap.filter((r) => r.facultyIds.length === 0 || r.facultyIds.some((fid) => ev.facultyIds.includes(fid)))
        if (exclusiveRooms != null) {
          const names = exclusiveRooms.map((rid) => roomMeta.find((r) => r.id === rid)?.name).filter(Boolean)
          ev.reason = exclusiveRooms.length === 0
            ? 'potokdagi guruhlar har xil xonaga QAT\'IY biriktirilgan — bitta darsga umumiy xona yo\'q'
            : `guruh FAQAT "${names.join(', ')}" xonasiga biriktirilgan, lekin u sig'maydi yoki band (${ev.groupSize} kishi)`
        } else if (fitByCap.length === 0) {
          const maxCap = roomMeta.reduce((m, r) => Math.max(m, r.capacity), 0)
          ev.reason = `guruh ${ev.groupSize} kishilik — sig'imi yetarli xona yo'q (eng katta xona ${maxCap} o'rin)`
        } else if (fitByFaculty.length === 0) {
          ev.reason = "fakultet binosida (yoki asosiy binoda) sig'imi mos xona yo'q — boshqa fakultet binosidan foydalanib bo'lmaydi"
        } else if (subjectRoomMap.has(ev.subjectId)
          && fitByFaculty.every((r) => r.capacity > LARGE_ROOM_CAPACITY && r.facultyIds.length === 0)) {
          ev.reason = "bu fanga maxsus xona biriktirilgan (masalan sport zali) — asosiy binodagi katta zaldan foydalanmaydi, lekin o'ziga tegishli xona yetarli emas yoki band"
        } else if (fitByFaculty.every((r) => r.capacity > LARGE_ROOM_CAPACITY)) {
          ev.reason = `guruh ${ev.groupSize} kishilik — mos sig'imli xonalarning barchasi katta zal: asosiy binoda faqat ${MAIN_HALL_MIN}-${MAIN_HALL_MAX} talabali potok (tur — Ma'ruza/Amaliy/Seminar — farqi yo'q), fakultet binosida faqat Ma'ruzada ${LARGE_ROOM_CAPACITY}+ talabaga ajratiladi`
        } else {
          ev.reason = "faqat maxsus xonalar mos keladi, lekin bu guruh/o'qituvchi/yo'nalish/fanga kirish ruxsati berilmagan"
        }
        infeasible.push(ev)
      }
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

  return { events, byGroup, byTeacher, rooms: roomMeta, infeasible, semester, groupStartPairs }
}
