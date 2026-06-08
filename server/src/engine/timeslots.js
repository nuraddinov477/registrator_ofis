// Vaqt modeli: 5 kun (Dushanba..Juma) × 6 juftlik = 30 slot
// slot = day*PAIRS + (pair-1),  day: 0..4,  pair: 1..6

export const DAYS = 5
export const PAIRS = 6
export const SLOTS = DAYS * PAIRS

export const DAY_NAMES = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma']

export const slotIndex = (day, pair) => day * PAIRS + (pair - 1)
export const dayOf = (slot) => Math.floor(slot / PAIRS)
export const pairOf = (slot) => (slot % PAIRS) + 1

// Qattiq cheklash 8: 4-kurs → 1..4 juftlik, 1-3 kurs → 1..5 juftlik
export const maxPairForCourse = (course) => (course >= 4 ? 4 : 5)

// Kursga ruxsat etilgan slotlar, ertalabki juftliklar oldinda (greedy/morning uchun)
export function allowedSlots(course) {
  const maxPair = maxPairForCourse(course)
  const slots = []
  for (let pair = 1; pair <= maxPair; pair++) {
    for (let day = 0; day < DAYS; day++) {
      slots.push(slotIndex(day, pair))
    }
  }
  return slots // (pair asc, day asc) — ertalab birinchi
}
