// Vaqt modeli: 5 kun (Dushanba..Juma) × 6 juftlik = 30 slot
// slot = day*PAIRS + (pair-1),  day: 0..4,  pair: 1..6

export const DAYS = 5
export const PAIRS = 6
export const SLOTS = DAYS * PAIRS

export const DAY_NAMES = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma']

export const slotIndex = (day, pair) => day * PAIRS + (pair - 1)
export const dayOf = (slot) => Math.floor(slot / PAIRS)
export const pairOf = (slot) => (slot % PAIRS) + 1

// Smenalar:
//   1-smena (ertalabki)      — 1,2,3,4-juftlik
//   2-smena (obeddan keyingi) — asosan 4,5,6-juftlik; agar o'qituvchi/guruh yuklamasi
//     15 juftlikdan oshib, sig'masa — 2 va 3-juftlikка ham "to'kiladi" (lekin 1-juftlik
//     hech qachon 2-smenaga qo'yilmaydi). SOFT jarima (afternoonEarly) 4,5,6'ni afzal ko'radi.
export const MORNING_PAIRS = [1, 2, 3, 4]
export const AFTERNOON_PREFERRED = [4, 5, 6]
export const AFTERNOON_PAIRS = [4, 5, 6, 2, 3] // ustuvorlar oldinda — greedy shu tartibda to'ldiradi

// Smena guruh darajasida tanlanadi (superadmin har bir guruhni alohida 1- yoki
// 2-smenaga biriktiradi — loadData.js'da afternoonGroups ro'yxati orqali).
export function pairsForShift(isAfternoon) {
  return isAfternoon ? AFTERNOON_PAIRS : MORNING_PAIRS
}

// Shu smenaga ruxsat etilgan slotlar. Juftliklar ustuvorlik tartibida (greedy shu
// tartibda birinchi bo'sh joyni tanlaydi): 2-smena uchun avval 4,5,6, keyin 2,3.
export function allowedSlots(isAfternoon) {
  const slots = []
  for (const pair of pairsForShift(isAfternoon)) {
    for (let day = 0; day < DAYS; day++) {
      slots.push(slotIndex(day, pair))
    }
  }
  return slots
}
