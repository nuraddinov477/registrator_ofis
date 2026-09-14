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

// Har bir GURUH o'z BOSHLANISH juftligini (1..6, ya'ni real soatini) tanlaydi —
// superadmin loadData.js'ga uzatiladigan groupStartPairs orqali belgilaydi (standart: 1).
// QAT'IY: guruh tanlangan juftlikdan OLDINGI vaqtga hech qachon qo'yilmaydi (masalan
// 12:00'ni tanlagan guruh 8:00/9:30'ga tushmaydi) — shu sabab "to'kilish" yo'q, faqat
// [startPair..6] oralig'i ishlatiladi. Kunlik 2-4 juftlik qoidasi (groupDayMin/Max,
// constraints.js) bu bilan birga ishlaydi.
export function pairsForStart(startPair) {
  const pairs = []
  for (let p = startPair; p <= PAIRS; p++) pairs.push(p)
  return pairs
}

// Guruhning boshlanish juftligiga ruxsat etilgan slotlar.
export function allowedSlots(startPair) {
  const slots = []
  for (const pair of pairsForStart(startPair)) {
    for (let day = 0; day < DAYS; day++) {
      slots.push(slotIndex(day, pair))
    }
  }
  return slots
}
