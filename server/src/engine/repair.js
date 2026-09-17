import { groupEval, groupGapPairs, teacherCost } from './constraints.js'
import { Occupancy } from './occupancy.js'
import { PAIRS, SLOTS } from './timeslots.js'

// Yakuniy jadvalda to'qnashuv bo'lmasligini KAFOLATLAYDI.
//
// Bitta slotda bitta guruh, bitta o'qituvchi va bitta xona faqat bitta darsda — bu qoida QAT'IY. Annealing
// to'qnashuvlarni katta jarima bilan kamaytiradi, lekin nolga tushishiga kafolat bermaydi, shu sabab:
//
// 1. removeConflicts — hali to'qnashuvda qatnashayotgan darslar joyidan olinadi (eng ko'p to'qnashgani
//    birinchi), toki birorta to'qnashuv qolmaguncha;
// 2. reinsert — joysiz darslar to'qnashuvsiz bo'sh joyga qaytariladi (kam oyna, kam jarima oldinda). Bo'sh joy
//    bo'lmasa — bitta xalaqit berayotgan darsni shu vaqtdagi boshqa xonaga yoki boshqa vaqtga surib ko'riladi.
//
// Joy topilmagan dars joylanmagan bo'lib qoladi va tashxisda "joylashtirib bo'lmadi" deb ko'rsatiladi.
//
// polishGaps — oxirgi, tasodifiy bo'lmagan bosqich: har bir oynaga guruhning chekka darslari ko'chirib
// ko'riladi (kerak bo'lsa band xona yoki o'qituvchining boshqa darsi surilib), faqat yaxshilansa qabul qilinadi.

const roomKey = (room, slot) => room * SLOTS + slot
const keyLess = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])

// Bandlik + (xona, slot) → dars va slot → darslar indekslari (to'qnashuvsiz jadval uchun)
class Board {
  constructor(ctx, occ) {
    this.ctx = ctx
    this.occ = occ
    this.atRoom = new Map()
    this.atSlot = new Map()
    for (const e of ctx.events) if (e.slot >= 0) this._index(e)
  }

  _index(ev) {
    this.atRoom.set(roomKey(ev.room, ev.slot), ev)
    let set = this.atSlot.get(ev.slot)
    if (!set) this.atSlot.set(ev.slot, (set = new Set()))
    set.add(ev)
  }

  place(ev, slot, room) {
    ev.slot = slot
    ev.room = room
    this.occ.place(ev)
    this._index(ev)
  }

  unplace(ev) {
    this.occ.remove(ev)
    const key = roomKey(ev.room, ev.slot)
    if (this.atRoom.get(key) === ev) this.atRoom.delete(key)
    this.atSlot.get(ev.slot)?.delete(ev)
    ev.slot = -1
    ev.room = -1
  }

  roomOccupant(room, slot) { return this.atRoom.get(roomKey(room, slot)) ?? null }

  // Shu slotda o'qituvchisi yoki guruhi mos keladigan (xalaqit beradigan) boshqa darslar
  blockersAt(ev, slot) {
    const groups = new Set(ev.groupIds)
    const found = []
    for (const e of this.atSlot.get(slot) || []) {
      if (e !== ev && (e.teacherId === ev.teacherId || e.groupIds.some((g) => groups.has(g)))) found.push(e)
    }
    return found
  }

  peopleFree(ev, slot) {
    const occ = this.occ
    return occ.teacherFree(ev.teacherId, slot) && ev.groupIds.every((g) => occ.groupFree(g, slot))
  }

  freeRoom(ev, slot, skip = null) {
    return ev.rooms.find((r) => r !== skip && this.occ.roomFree(r, slot)) ?? null
  }

  // Dars ta'sir qiladigan guruh(lar) va o'qituvchining [oynalar, jarima] — joy tanlash mezoni
  localKey(ev) {
    const ctx = this.ctx
    let gaps = 0
    let cost = teacherCost(ctx.byTeacher.get(ev.teacherId))
    for (const gid of ev.uniqueGroupIds) {
      const [groupCost, groupGaps] = groupEval(ctx.byGroup.get(gid), ctx.groupStart.get(gid) ?? null)
      gaps += groupGaps
      cost += groupCost
    }
    return [gaps, cost]
  }

  // To'qnashuvsiz [kalit, slot, xona] variantlari — eng yaxshisi (kam oyna, kam jarima) oldinda
  options(ev) {
    const found = []
    for (const slot of ev.slots) {
      if (!this.peopleFree(ev, slot)) continue
      const room = this.freeRoom(ev, slot)
      if (room === null) continue
      ev.slot = slot // faqat baholash uchun (bandlikka yozilmaydi)
      ev.room = room
      found.push([this.localKey(ev), slot, room])
      ev.slot = -1
      ev.room = -1
    }
    // barqaror saralash — teng kalitlarda slot tartibi saqlanadi
    found.sort((a, b) => (keyLess(a[0], b[0]) ? -1 : keyLess(b[0], a[0]) ? 1 : 0))
    return found
  }
}

export function rebuildOccupancy(ctx) {
  const occ = new Occupancy()
  for (const e of ctx.events) if (e.slot >= 0 && e.room >= 0) occ.place(e)
  return occ
}

// To'qnashuv qolmaguncha eng ko'p to'qnashgan darsni joyidan oladi. Olingan darslar soni qaytadi
export function removeConflicts(ctx, occ) {
  let removed = 0
  while (occ.hard > 0) {
    let worst = null, worstCount = -1, worstSpread = -1
    for (const e of ctx.events) {
      if (e.slot < 0) continue
      const count = occ.conflictsOf(e)
      if (count === 0) continue
      // teng bo'lsa — boshqa joyga qo'yish osonrog'i (nomzodlari ko'prog'i) olinadi
      const spread = e.slots.length * e.rooms.length
      if (count > worstCount || (count === worstCount && spread > worstSpread)) {
        worst = e
        worstCount = count
        worstSpread = spread
      }
    }
    if (worst === null) break // himoya: bandlik hisobi eventlardan farq qilsa cheksiz sikl bo'lmasin
    occ.remove(worst)
    worst.slot = -1
    worst.room = -1
    removed++
  }
  return removed
}

// Guruh va o'qituvchi bo'sh, lekin nomzod xonalar band: band xonadagi darsni shu vaqtning boshqa bo'sh xonasiga
function tryRoomSwap(board, ev, slot) {
  for (const room of ev.rooms) {
    const other = board.roomOccupant(room, slot)
    if (other === null) continue
    const alternative = board.freeRoom(other, slot, room)
    if (alternative === null) continue
    board.unplace(other)
    board.place(other, slot, alternative)
    board.place(ev, slot, room)
    return true
  }
  return false
}

// Shu vaqtda faqat BITTA dars xalaqit bersa — uni boshqa vaqtga surib, o'rniga shu darsni qo'yish
function tryEject(board, ev, slot) {
  const blockers = board.blockersAt(ev, slot)
  if (blockers.length !== 1) return false
  const blocker = blockers[0]
  const oldSlot = blocker.slot, oldRoom = blocker.room
  board.unplace(blocker)
  const room = board.peopleFree(ev, slot) ? board.freeRoom(ev, slot) : null
  if (room !== null) {
    board.place(ev, slot, room)
    const moves = board.options(blocker)
    if (moves.length) {
      board.place(blocker, moves[0][1], moves[0][2])
      return true
    }
    board.unplace(ev)
  }
  board.place(blocker, oldSlot, oldRoom)
  return false
}

// Joysiz (lekin nomzodi bor) darslarni to'qnashuvsiz joylaydi. Joylangan darslar soni qaytadi.
// deadline — performance.now() bo'yicha (ms)
export function reinsert(ctx, occ, deadline = null) {
  const board = new Board(ctx, occ)
  let placed = 0
  for (let pass = 0; pass < 2; pass++) { // surishlar yangi bo'sh joy ochishi mumkin — ikkinchi o'tish
    const pending = ctx.events.filter((e) => e.slot < 0 && e.rooms.length && e.slots.length)
    pending.sort((a, b) => a.slots.length * a.rooms.length - b.slots.length * b.rooms.length) // eng cheklangani birinchi
    let progress = 0
    for (const ev of pending) {
      if (deadline !== null && performance.now() > deadline) return placed
      const moves = board.options(ev)
      if (moves.length) {
        board.place(ev, moves[0][1], moves[0][2])
        progress++
        continue
      }
      for (const slot of ev.slots) {
        const done = board.peopleFree(ev, slot) ? tryRoomSwap(board, ev, slot) : tryEject(board, ev, slot)
        if (done) { progress++; break }
      }
    }
    placed += progress
    if (!progress) break
  }
  return placed
}

// Darslar ta'sir qiladigan barcha guruh va o'qituvchilarning [oynalar, jarima] yig'indisi
function combinedKey(ctx, events) {
  const groups = new Set()
  const teachers = new Set()
  for (const e of events) {
    for (const gid of e.uniqueGroupIds) groups.add(gid)
    teachers.add(e.teacherId)
  }
  let gaps = 0, cost = 0
  for (const t of teachers) cost += teacherCost(ctx.byTeacher.get(t))
  for (const gid of groups) {
    const [groupCost, groupGaps] = groupEval(ctx.byGroup.get(gid), ctx.groupStart.get(gid) ?? null)
    gaps += groupGaps
    cost += groupCost
  }
  return [gaps, cost]
}

// Darsni target slotga ko'chirishga urinadi; oynalar (so'ng jarima) kamaymasa — hammasi joyiga qaytadi
function moveTo(board, ev, target) {
  if (target === ev.slot || !ev.slots.includes(target)) return false
  const blockers = board.blockersAt(ev, target)
  if (blockers.length > 1) return false
  const involved = [ev, ...blockers]
  const origins = new Map(involved.map((e) => [e, [e.slot, e.room]]))
  let before = combinedKey(board.ctx, involved)

  const revert = () => {
    for (const e of origins.keys()) if (e.slot >= 0) board.unplace(e)
    for (const [e, [slot, room]] of origins) board.place(e, slot, room)
    return false
  }

  board.unplace(ev)
  for (const blocker of blockers) board.unplace(blocker)
  if (!board.peopleFree(ev, target)) return revert()
  let room = board.freeRoom(ev, target)
  if (room === null) {
    // xona band: egallab turgan darsni shu vaqtning boshqa bo'sh xonasiga
    for (const candidate of ev.rooms) {
      const occupant = board.roomOccupant(candidate, target)
      const alternative = occupant ? board.freeRoom(occupant, target, candidate) : null
      if (alternative !== null) {
        // band xonadagi dars shu vaqtda turibdi — guruh/o'qituvchisi yuqoridagilardan alohida,
        // shu sabab uning oldingi bahosi (hali joyida) qo'shib qo'yiladi
        const extra = combinedKey(board.ctx, [occupant])
        before = [before[0] + extra[0], before[1] + extra[1]]
        origins.set(occupant, [occupant.slot, occupant.room])
        involved.push(occupant)
        board.unplace(occupant)
        board.place(occupant, target, alternative)
        room = candidate
        break
      }
    }
    if (room === null) return revert()
  }
  board.place(ev, target, room)
  for (const blocker of blockers) { // o'qituvchining boshqa darsi — to'qnashuvsiz yangi joyga
    const moves = board.options(blocker)
    if (!moves.length) return revert()
    board.place(blocker, moves[0][1], moves[0][2])
  }
  const after = combinedKey(board.ctx, involved)
  if (after[0] < before[0] || (after[0] === before[0] && after[1] < before[1] - 1e-9)) return true
  return revert()
}

// Qolgan oynalarni yopishga urinadi (to'qnashuvsiz). Yopilgan/yaxshilangan holatlar soni qaytadi.
// deadline — performance.now() bo'yicha (ms)
export function polishGaps(ctx, occ, deadline) {
  const board = new Board(ctx, occ)
  let improved = 0
  for (const events of ctx.byGroup.values()) {
    let changed = true
    while (changed) {
      changed = false
      if (performance.now() > deadline) return improved
      for (const [day, pairs] of groupGapPairs(events)) {
        const byDay = new Map()
        for (const e of events) {
          if (e.slot < 0) continue
          const d = Math.floor(e.slot / PAIRS)
          if (!byDay.has(d)) byDay.set(d, [])
          byDay.get(d).push(e)
        }
        // nomzodlar: har kunning chekka darslari (chekkadan olish o'sha kunda oyna ochmaydi)
        const edges = []
        for (const items of byDay.values()) {
          let lo = Infinity, hi = -Infinity
          for (const e of items) { lo = Math.min(lo, e.slot); hi = Math.max(hi, e.slot) }
          for (const e of items) if (e.slot === lo || e.slot === hi) edges.push(e)
        }
        for (const pair of pairs) {
          const target = day * PAIRS + pair - 1
          if (edges.some((e) => moveTo(board, e, target))) {
            improved++
            changed = true
            break
          }
        }
        if (changed) break
      }
    }
  }
  return improved
}
