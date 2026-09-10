// Vaqt modeli: 5 kun (Dushanba..Juma) × 6 juftlik = 30 slot
// slot = day*PAIRS + (pair-1),  day: 0..4,  pair: 1..6

export const DAYS = 5
export const PAIRS = 6
export const SLOTS = DAYS * PAIRS

export const DAY_NAMES = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma']

export const slotIndex = (day, pair) => day * PAIRS + (pair - 1)
export const dayOf = (slot) => Math.floor(slot / PAIRS)
export const pairOf = (slot) => (slot % PAIRS) + 1

// Smenalar: 1-smena (ertalabki) 1..4-juftlik, 2-smena (obeddan keyingi) 4..6-juftlik.
// 4-juftlik ikkala smenaning chegarasi — ikkalasida ham bor.
export const MORNING_PAIRS = [1, 2, 3, 4]
export const AFTERNOON_PAIRS = [4, 5, 6]

// Kurs qaysi smenada: afternoonCourses ro'yxatidagi kurslar 2-smenada (4,5,6-juftlik),
// qolganlari 1-smenada (1,2,3,4-juftlik). Standart: 1-kurs → 2-smena.
export function pairsForCourse(course, afternoonCourses = [1]) {
  return afternoonCourses.includes(course) ? AFTERNOON_PAIRS : MORNING_PAIRS
}

// Kursga ruxsat etilgan slotlar, ertalabki juftliklar oldinda (greedy/morning uchun)
export function allowedSlots(course, afternoonCourses = [1]) {
  const slots = []
  for (const pair of pairsForCourse(course, afternoonCourses)) {
    for (let day = 0; day < DAYS; day++) {
      slots.push(slotIndex(day, pair))
    }
  }
  return slots // (pair asc, day asc) — ertalab birinchi
}
