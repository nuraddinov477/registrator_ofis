import { TYPE_RANK } from './constraints.js'
import { allowedSlots, dayOf, pairOf, PAIRS } from './timeslots.js'

// Katta auditoriya: sig'imi shundan katta xona (asosiy yoki fakultet binosida) — "katta zal"
export const LARGE_ROOM_CAPACITY = 60
// Katta zallar faqat shu hajmdagi sinf uchun (QAT'IY): 70-100 talaba ± 5 tolerantlik. Talaba kam
// bo'lsa — katta zal band qilinmaydi (fanning o'z xonasi — masalan sport zali — bundan mustasno)
export const MAIN_HALL_MIN = 65
export const MAIN_HALL_MAX = 105
const SEMINAR = 'Seminar'

// Xona nega mos kelmasligi (tashxis tavsiyalari uchun). FIXABLE — xonaga ruxsat berilsa yechiladi.
export const ROOM_PROBLEMS = {
  capacity: "sig'imi yetmaydi",
  hall_dedicated: "asosiy binodagi katta zal — bu fanning o'z maxsus xonasi bor",
  hall_size: `katta zal — faqat ${MAIN_HALL_MIN}-${MAIN_HALL_MAX} talabali sinf uchun`,
  faculty: 'boshqa fakultet binosida',
  special: "maxsus xona, kirish ruxsati yo'q",
  exclusive: "guruh boshqa xona(lar)ga qat'iy biriktirilgan",
  two_para: "2 para potok faqat asosiy binodagi katta zalga qo'yiladi",
}
const FIXABLE_ROOM_PROBLEMS = new Set(['faculty', 'special'])

// Darsning guruhlari qanday qismlarga bo'linib o'tiladi. Seminar potoki oddiy xonaga sig'masa
// (LARGE_ROOM_CAPACITY dan ko'p talaba) — sinf IKKIGA bo'linadi: guruhlar tartibi saqlanib, talaba
// soni eng teng chiqadigan joydan. Har yarmi o'z darsini alohida o'tadi (katta zal seminarga
// berilmaydi). Boshqa hollarda — bitta qism.
export function lessonParts(members, lessonType, sizeOf) {
  const sizes = members.map(sizeOf)
  const total = sizes.reduce((s, x) => s + x, 0)
  if (lessonType !== SEMINAR || members.length < 2 || total <= LARGE_ROOM_CAPACITY) return [members]
  let best = 1, bestDiff = Infinity, prefix = 0
  for (let k = 1; k < members.length; k++) {
    prefix += sizes[k - 1]
    const diff = Math.abs(total - 2 * prefix)
    if (diff < bestDiff) { bestDiff = diff; best = k }
  }
  return [members.slice(0, best), members.slice(best)]
}

const memberSize = (member) => member?.group?.size || 0

// Number(v), butun son bo'lsa — aks holda null (boolean ham null)
const jsInt = (value) => {
  if (value == null || typeof value === 'boolean') return null
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

const uniq = (list) => [...new Set(list)]

// Kirish — Prisma javobi ko'rinishidagi obyektlar (loadData'da DB'dan o'qiladi).
// groupStartPairs / groupEndPairs — har bir guruhning [boshlanish..tugash] juftligi ({ [groupId]: pair }).
// Ko'rsatilmagan guruh uchun standart — 1 dan 6 gacha (to'liq kun).
export function buildContext(workloads, rooms, teacherConstraints, semester = 1, groupStartPairs = {}, groupEndPairs = {}) {
  groupStartPairs = groupStartPairs || {}
  groupEndPairs = groupEndPairs || {}
  const startPairOf = (gid) => {
    const v = gid == null ? null : jsInt(groupStartPairs[gid])
    return v != null && v >= 1 && v <= PAIRS ? v : 1
  }
  const endPairOf = (gid, start) => {
    const v = gid == null ? null : jsInt(groupEndPairs[gid])
    return v != null && v >= start && v <= PAIRS ? v : PAIRS
  }

  // Har bir xona uchun ruxsat to'plamlari + qaysi fakultet(lar)ning binosida joylashgani
  // (faculties=[] → "asosiy/umumiy" bino, hamma foydalanadi)
  const roomMeta = rooms.map((r) => {
    const meta = {
      id: r.id, name: r.name, capacity: r.capacity, type: r.type,
      facultyIds: (r.building?.faculties || []).map((f) => f.id),
      teachers: new Set(), groups: new Set(), specialties: new Set(), exclusiveGroups: new Set(), subjects: new Set(),
    }
    for (const p of r.permissions || []) {
      if (p.teacherId != null) meta.teachers.add(p.teacherId)
      if (p.groupId != null) {
        meta.groups.add(p.groupId)
        if (p.exclusive) meta.exclusiveGroups.add(p.groupId)
      }
      if (p.specialtyId != null) meta.specialties.add(p.specialtyId)
      if (p.subjectId != null) meta.subjects.add(p.subjectId)
    }
    return meta
  })

  // groupRoomMap — yumshoq ustuvorlik (assignedRoom); groupOnlyRoomMap — QAT'IY (exclusive);
  // teacherRoomMap / subjectRoomMap — o'qituvchiga / fanga (masalan sport zali) biriktirilgan xonalar
  const groupRoomMap = new Map(), groupOnlyRoomMap = new Map(), teacherRoomMap = new Map(), subjectRoomMap = new Map()
  const addTo = (map, key, roomId) => {
    if (!map.has(key)) map.set(key, new Set())
    map.get(key).add(roomId)
  }
  for (const r of roomMeta) {
    for (const gid of r.groups) addTo(groupRoomMap, gid, r.id)
    for (const gid of r.exclusiveGroups) addTo(groupOnlyRoomMap, gid, r.id)
    for (const tid of r.teachers) addTo(teacherRoomMap, tid, r.id)
    for (const sid of r.subjects) addTo(subjectRoomMap, sid, r.id)
  }

  // O'qituvchi istisnolari (qaysi kunlarda dars qo'yilmasin / faqat qaysi juftliklarga)
  const tcMap = new Map()
  for (const tc of teacherConstraints) {
    let blocked = [], allowed = []
    try { blocked = tc.blockedDays ? JSON.parse(tc.blockedDays) : [] } catch { /* noto'g'ri JSON — e'tiborsiz */ }
    try { allowed = tc.allowedPairs ? JSON.parse(tc.allowedPairs) : [] } catch { /* noto'g'ri JSON — e'tiborsiz */ }
    tcMap.set(tc.teacherId, { blocked: new Set(blocked), allowed: new Set(allowed) })
  }

  // Xonaga aniq (o'qituvchi/guruh/yo'nalish/fan) ruxsat berilganmi? — maxsus xonaga kirish sharti
  // VA bino-fakultet egaligini chetlab o'tish sababi
  const hasRoomPermission = (room, ev) =>
    room.teachers.has(ev.teacherId)
    || ev.groupIds.some((gid) => room.groups.has(gid))
    || ev.specialtyIds.some((sid) => room.specialties.has(sid))
    || room.subjects.has(ev.subjectId)

  // Xona darsga nega mos emas (ROOM_PROBLEMS kaliti) — mos bo'lsa null
  const roomRejection = (room, ev) => {
    if (room.capacity < ev.groupSize) return 'capacity'
    // Xonaning O'ZI shu fanga biriktirilgan bo'lsa (masalan sport zali) — hajm qoidalari qo'llanilmaydi
    const isOwnDedicatedRoom = room.subjects.has(ev.subjectId)
    if (!isOwnDedicatedRoom && room.capacity > LARGE_ROOM_CAPACITY) {
      // Asosiy binodagi katta zal: fanga boshqa joyda maxsus xona biriktirilgan bo'lsa — bu yerdan foydalanmaydi
      if (room.facultyIds.length === 0 && subjectRoomMap.has(ev.subjectId)) return 'hall_dedicated'
      // Har qanday katta zal (asosiy yoki fakultet binosida), dars turidan qat'i nazar — QAT'IY
      // MAIN_HALL_MIN-MAIN_HALL_MAX talabali sinf; talaba kam bo'lsa katta zal band qilinmaydi
      if (ev.groupSize < MAIN_HALL_MIN || ev.groupSize > MAIN_HALL_MAX) return 'hall_size'
    }
    // Fakultet bino egaligi — aniq ruxsat (o'qituvchi/guruh/yo'nalish/fan) bo'lsa chetlab o'tiladi
    if (room.facultyIds.length && !room.facultyIds.some((fid) => ev.facultyIds.includes(fid)) && !hasRoomPermission(room, ev)) {
      return 'faculty'
    }
    if (room.type === 'umumiy') return null
    // maxsus: potokdagi guruhlardan BIRIGA (yoki darsning faniga) ruxsat bo'lsa yetarli
    return hasRoomPermission(room, ev) ? null : 'special'
  }

  // Xonasiz qolgan dars uchun eng yaqin xonalar va ular nega mos emasligi. Qat'iy biriktirilgan
  // guruhda — faqat o'sha xonalar, "2 para" potokda — faqat asosiy binodagi katta zallar. Avval ruxsat
  // berilsa sig'adigan xonalar (eng kichigi oldinda); bo'lmasa — boshqa sabab bilan rad etilgan eng
  // yaqinlari va sig'imi yetmaydigan eng kattalari. Sababi va sig'imi bir xil xonalar bitta qatorga.
  const roomSuggestions = (ev, exclusiveRooms, isTwoParaPotok, limit = 3) => {
    let pool
    if (exclusiveRooms != null) pool = roomMeta.filter((r) => exclusiveRooms.includes(r.id))
    else if (isTwoParaPotok) pool = roomMeta.filter((r) => r.facultyIds.length === 0 && r.capacity > LARGE_ROOM_CAPACITY)
    else pool = roomMeta
    // boshqa fanning o'z xonasi (masalan sport zali) tavsiya qilinmaydi
    pool = pool.filter((r) => r.subjects.size === 0 || r.subjects.has(ev.subjectId))
    const rejected = []
    for (const r of pool) {
      const code = roomRejection(r, ev)
      if (code !== null) rejected.push([r, code])
    }
    const collapse = (rows, count) => {
      const items = new Map()
      for (const [r, code] of rows) {
        const key = `${code}|${r.capacity}`
        if (items.has(key)) items.get(key).more++
        else if (items.size < count) {
          items.set(key, {
            roomId: r.id, room: r.name, capacity: r.capacity, code,
            problem: code === 'capacity' ? `${r.capacity} o'rin — ${ev.groupSize} talabaga sig'maydi` : ROOM_PROBLEMS[code],
            fixable: FIXABLE_ROOM_PROBLEMS.has(code), more: 0,
          })
        }
      }
      return [...items.values()]
    }
    const byCapacity = (a, b) => a[0].capacity - b[0].capacity
    const fixable = collapse(rejected.filter((x) => FIXABLE_ROOM_PROBLEMS.has(x[1])).sort(byCapacity), limit)
    if (fixable.length) return fixable
    const other = collapse(rejected.filter((x) => x[1] !== 'capacity').sort(byCapacity), limit - 1)
    const biggest = rejected.filter((x) => x[1] === 'capacity').sort((a, b) => b[0].capacity - a[0].capacity)
    return [...other, ...collapse(biggest, limit - other.length)]
  }

  const applyTeacherConstraint = (slots, teacherId) => {
    const tc = tcMap.get(teacherId)
    if (!tc || (tc.blocked.size === 0 && tc.allowed.size === 0)) return slots
    return slots.filter((s) => !tc.blocked.has(dayOf(s)) && (tc.allowed.size === 0 || tc.allowed.has(pairOf(s))))
  }

  const events = []
  const infeasible = []
  const groupStart = new Map()
  const groupEnd = new Map()
  let eid = 0

  // Yuklamaning bitta qismi (odatda butun sinf; bo'lingan seminarda — yarmi) uchun eventlar
  const addEvents = (w, members, part) => {
    // Potok: yuklama bir nechta guruhga — hammasi BIRGA bitta darsda (soat guruhlar soniga ko'paytirilmaydi)
    const wgroups = members.map((x) => x.group).filter(Boolean)
    const groupIds = members.map((x) => x.groupId)
    const teacherId = w.teacherId, subjectId = w.subjectId
    const assignedRooms = uniq([
      ...groupIds.flatMap((gid) => [...(groupRoomMap.get(gid) || [])]),
      ...(teacherRoomMap.get(teacherId) || []),
      ...(subjectRoomMap.get(subjectId) || []),
    ])
    const assignedSet = new Set(assignedRooms)
    // QAT'IY biriktirish: bir nechta guruh bo'lsa — kesishma (bo'sh bo'lsa — ziddiyat)
    const exSets = groupIds.filter((gid) => groupOnlyRoomMap.has(gid)).map((gid) => groupOnlyRoomMap.get(gid))
    const exclusiveRooms = exSets.length ? [...exSets[0]].filter((rid) => exSets.every((s) => s.has(rid))) : null

    const first = wgroups[0] || null
    const firstId = first ? first.id : null
    const isPotok = groupIds.length > 1
    // "2 para" qoidasi faqat katta zalga mos (MAIN_HALL_MIN-MAIN_HALL_MAX) potokka — kichigi oddiy xonada
    const potokSize = wgroups.reduce((s, g) => s + (g.size || 0), 0)
    const isTwoParaPotok = isPotok && w.weeklyHours === 2 && !subjectRoomMap.has(subjectId)
      && potokSize >= MAIN_HALL_MIN && potokSize <= MAIN_HALL_MAX
    // Potok: dars BARCHA guruhlarning juftlik oralig'iga sig'ishi kerak — oraliqlar kesishmasi
    const memberStarts = wgroups.map((g) => startPairOf(g.id))
    const memberEnds = wgroups.map((g, i) => endPairOf(g.id, memberStarts[i]))
    wgroups.forEach((g, i) => { groupStart.set(g.id, memberStarts[i]); groupEnd.set(g.id, memberEnds[i]) })
    const slotLo = wgroups.length ? Math.max(...memberStarts) : 1
    const slotHi = wgroups.length ? Math.min(...memberEnds) : PAIRS

    let template = null // yuklamaning birinchi eventi — slot/xona nomzodlari hamma eventlari uchun bir xil
    for (let i = 0; i < (w.weeklyHours || 1); i++) {
      const start = startPairOf(firstId)
      const lessonType = w.type || 'Amaliy'
      const ev = {
        id: eid++,
        workloadId: w.id,
        groupIds,
        uniqueGroupIds: uniq(groupIds),
        teacherId,
        subjectId,
        type: lessonType,
        rank: TYPE_RANK[lessonType] ?? null,
        single: groupIds.length === 1,
        groupNames: wgroups.map((g) => g.name),
        teacherName: w.teacher?.fullName,
        subjectName: w.subject?.name,
        course: first?.course ?? 1,
        startPair: start,
        endPair: endPairOf(firstId, start),
        groupSize: wgroups.reduce((s, g) => s + (g.size || 0), 0),
        specialtyIds: uniq(wgroups.map((g) => g.specialtyId).filter((v) => v != null)),
        facultyIds: uniq(wgroups.map((g) => g.facultyId).filter((v) => v != null)),
        difficulty: w.subject?.difficulty ?? 3,
        assignedRooms,
        assignedSet,
        slot: -1,
        room: -1,
        slots: [],
        rooms: [],
        roomCapacities: {},
        reason: null,
        blockKind: null,
        suggestions: [],
        part,
      }
      if (template !== null) {
        ev.slots = template.slots
        ev.rooms = template.rooms
        ev.roomCapacities = template.roomCapacities
        ev.reason = template.reason
        ev.blockKind = template.blockKind
        ev.suggestions = template.suggestions
        if (ev.reason !== null) infeasible.push(ev)
        events.push(ev)
        continue
      }
      template = ev
      if (wgroups.length === 0) {
        // guruhsiz yuklama — dars hech kimga yozilmaydi, faqat o'qituvchi/xonani band qilardi
        ev.blockKind = 'no_group'
        ev.reason = "yuklamaga guruh biriktirilmagan — yuklamani ochib, guruh tanlang"
        infeasible.push(ev)
        events.push(ev)
        continue
      }
      ev.slots = applyTeacherConstraint(slotLo <= slotHi ? allowedSlots(slotLo, slotHi) : [], teacherId)
      // "2 para" POTOK QOIDASI: haftalik 2 soatli potok — FAQAT Dushanba/Seshanba/Chorshanba
      // va FAQAT asosiy binodagi Katta zal (fallback yo'q)
      if (isTwoParaPotok) ev.slots = ev.slots.filter((s) => dayOf(s) <= 2)
      // Nomzod xonalar: biriktirilganlar oldinda; oddiy darsda ENG KICHIK mos xona, potokda ENG KATTA
      const candidates = roomMeta.filter((r) =>
        roomRejection(r, ev) === null
        && (exclusiveRooms === null || exclusiveRooms.includes(r.id))
        && (!isTwoParaPotok || (r.facultyIds.length === 0 && r.capacity > LARGE_ROOM_CAPACITY)))
      candidates.sort((a, b) => {
        const aA = assignedSet.has(a.id) ? 0 : 1, bA = assignedSet.has(b.id) ? 0 : 1
        if (aA !== bA) return aA - bA
        return isPotok ? b.capacity - a.capacity : a.capacity - b.capacity
      })
      ev.rooms = candidates.map((r) => r.id)
      ev.roomCapacities = Object.fromEntries(candidates.map((r) => [r.id, r.capacity]))

      // Nega joylab bo'lmaydi — aniq sabab (UI'da ko'rsatiladi)
      if (ev.slots.length === 0) {
        ev.blockKind = slotLo > slotHi ? 'potok_range' : 'time'
        if (slotLo > slotHi) {
          ev.reason = "potokdagi guruhlarning juftlik oraliqlari kesishmaydi — birga o'tiladigan dars uchun umumiy vaqt yo'q"
        } else if (isTwoParaPotok) {
          ev.reason = "2 para potok qoidasi: Dushanba/Seshanba/Chorshanba kunlarida (yoki o'qituvchining istisnolari tufayli) bo'sh vaqt qolmadi"
        } else {
          ev.reason = "o'qituvchining istisnolari (bloklangan kunlar / faqat ayrim juftliklar) tufayli bo'sh vaqt qolmadi"
        }
        infeasible.push(ev)
      } else if (ev.rooms.length === 0) {
        ev.blockKind = isTwoParaPotok ? 'two_para' : 'room'
        ev.suggestions = roomSuggestions(ev, exclusiveRooms, isTwoParaPotok)
        const fitByCap = roomMeta.filter((r) => r.capacity >= ev.groupSize)
        const fitByFaculty = fitByCap.filter((r) => r.facultyIds.length === 0 || r.facultyIds.some((fid) => ev.facultyIds.includes(fid)))
        if (isTwoParaPotok) {
          ev.reason = "2 para potok qoidasi: faqat asosiy binodagi Katta zalga qo'yiladi (qat'iy), lekin mos/bo'sh Katta zal topilmadi"
        } else if (exclusiveRooms !== null) {
          const names = exclusiveRooms.map((rid) => roomMeta.find((r) => r.id === rid)?.name).filter(Boolean)
          ev.reason = exclusiveRooms.length === 0
            ? "potokdagi guruhlar har xil xonaga QAT'IY biriktirilgan — bitta darsga umumiy xona yo'q"
            : `guruh FAQAT "${names.join(', ')}" xonasiga biriktirilgan, lekin u sig'maydi yoki band (${ev.groupSize} kishi)`
        } else if (fitByCap.length === 0) {
          const maxCap = roomMeta.reduce((m, r) => Math.max(m, r.capacity), 0)
          ev.reason = `guruh ${ev.groupSize} kishilik — sig'imi yetarli xona yo'q (eng katta xona ${maxCap} o'rin)`
        } else if (fitByFaculty.length === 0) {
          ev.reason = "fakultet binosida (yoki asosiy binoda) sig'imi mos xona yo'q — boshqa fakultet binosidan foydalanib bo'lmaydi"
        } else if (subjectRoomMap.has(subjectId)
          && fitByFaculty.every((r) => r.capacity > LARGE_ROOM_CAPACITY && r.facultyIds.length === 0)) {
          ev.reason = "bu fanga maxsus xona biriktirilgan (masalan sport zali) — asosiy binodagi katta zaldan foydalanmaydi, lekin o'ziga tegishli xona yetarli emas yoki band"
        } else if (fitByFaculty.every((r) => r.capacity > LARGE_ROOM_CAPACITY)) {
          if (ev.groupSize < MAIN_HALL_MIN) ev.blockKind = 'between' // oddiy xonaga ko'p, katta zalga kam
          ev.reason = `${ev.groupSize} talaba — oddiy xonalarga sig'maydi, katta zallar esa faqat `
            + `${MAIN_HALL_MIN}-${MAIN_HALL_MAX} talabali sinf uchun (talaba kam bo'lsa katta zal band qilinmaydi)`
        } else {
          ev.reason = "faqat maxsus xonalar mos keladi, lekin bu guruh/o'qituvchi/yo'nalish/fanga kirish ruxsati berilmagan"
        }
        infeasible.push(ev)
      }
      events.push(ev)
    }
  }

  for (const w of workloads) {
    const parts = lessonParts(w.groups || [], w.type || 'Amaliy', memberSize)
    parts.forEach((members, i) => addEvents(w, members, parts.length > 1 ? `${i + 1}/${parts.length}` : null))
  }

  // Indekslar — delta-baholash uchun. Potok event'i HAR BIR guruh ro'yxatiga qo'shiladi.
  const byGroup = new Map(), byTeacher = new Map()
  for (const ev of events) {
    if (!byTeacher.has(ev.teacherId)) byTeacher.set(ev.teacherId, [])
    byTeacher.get(ev.teacherId).push(ev)
    for (const gid of ev.groupIds) {
      if (!byGroup.has(gid)) byGroup.set(gid, [])
      byGroup.get(gid).push(ev)
    }
  }

  return { events, byGroup, byTeacher, rooms: roomMeta, infeasible, semester, groupStartPairs, groupStart, groupEnd }
}

// DB'dan (arxivlanmagan, shu semestr) yuklamalar, xonalar va istisnolarni o'qib kontekst tuzadi.
export async function loadData(prisma, semester = 1, opts = {}) {
  const { groupStartPairs = {}, groupEndPairs = {} } = opts
  const [workloads, rooms, teacherConstraints] = await Promise.all([
    prisma.workload.findMany({
      where: { semester, archived: false },
      include: { groups: { include: { group: true }, orderBy: { groupId: 'asc' } }, teacher: true, subject: true },
      orderBy: { id: 'asc' },
    }),
    prisma.room.findMany({
      include: {
        permissions: { orderBy: { id: 'asc' } },
        building: { include: { faculties: { orderBy: { id: 'asc' } } } },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.teacherConstraint.findMany({ orderBy: { id: 'asc' } }),
  ])
  return buildContext(workloads, rooms, teacherConstraints, semester, groupStartPairs, groupEndPairs)
}
