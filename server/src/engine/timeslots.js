// Vaqt modeli: 5 kun (Dushanba..Juma) × 6 juftlik = 30 slot
// slot = day*PAIRS + (pair-1),  day: 0..4,  pair: 1..6

export const DAYS = 5
export const PAIRS = 6
export const SLOTS = DAYS * PAIRS

export const DAY_NAMES = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma']

// Har bir juftlikning real soat oralig'i (1-indeksli: PAIR_TIMES[pair-1]).
// Frontenddagi src/pages/Schedule.jsx'dagi PAIR_TIMES bilan bir xil bo'lishi shart.
export const PAIR_TIMES = ['8:00–9:20', '9:30–10:50', '11:30–12:50', '13:00–14:20', '14:30–15:50', '16:00–17:20']

export const slotIndex = (day, pair) => day * PAIRS + (pair - 1)
export const dayOf = (slot) => Math.floor(slot / PAIRS)
export const pairOf = (slot) => (slot % PAIRS) + 1

// Har bir GURUH o'z BOSHLANISH VA TUGASH juftligini (1..6, real soatlar uchun
// PAIR_TIMES'ga qarang) tanlaydi — superadmin loadData.js'ga uzatiladigan
// groupStartPairs/groupEndPairs orqali belgilaydi (standart: 1 va 6 — to'liq kun).
// QAT'IY: guruh [startPair..endPair] oralig'idan TASHQARIGA hech qachon qo'yilmaydi
// (na oldinroq, na keyinroq) — shu sabab "to'kilish" yo'q. Kunlik 2-4 juftlik qoidasi
// (groupDayMin/Max, constraints.js) bu bilan birga ishlaydi, oraliq shundan kichik
// bo'lsa (masalan 1-3, atigi 3 juftlik) tabiiy ravishda kamroq dars sig'adi.
export function pairsForRange(startPair, endPair) {
  const pairs = []
  for (let p = startPair; p <= endPair; p++) pairs.push(p)
  return pairs
}

// Guruhning [startPair..endPair] oralig'iga ruxsat etilgan slotlar.
export function allowedSlots(startPair, endPair = PAIRS) {
  const slots = []
  for (const pair of pairsForRange(startPair, endPair)) {
    for (let day = 0; day < DAYS; day++) {
      slots.push(slotIndex(day, pair))
    }
  }
  return slots
}
