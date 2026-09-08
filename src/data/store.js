import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../api/client'

// Backend API'ga ulangan ma'lumot do'koni — eski interfeys (db, useCollection) saqlanadi,
// shuning uchun sahifalar o'zgarmaydi. Lokal kesh + avtomatik qayta yuklash.
const ENDPOINTS = {
  faculties: '/faculties', departments: '/departments', specialties: '/specialties',
  teachers: '/teachers', subjects: '/subjects', groups: '/groups', buildings: '/buildings',
  rooms: '/rooms', users: '/users', audit: '/audit', loads: '/workloads',
  roomPermissions: '/room-permissions', teacherConstraints: '/teacher-constraints',
  // 'requests' va 'schedule' — backendda boshqacha (engine API), hozircha lokal/bo'sh
}

const EMPTY = []
const cache = {}
const loaded = {}
const attempted = {} // hech bo'lmasa bitta urinish qilinganmi (birinchi render'da "xato" ko'rsatib yubormaslik uchun)
const inflight = {}
const listeners = new Set()

const emit = () => listeners.forEach((l) => l())
const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb) }

// Backend (Render bepul) uxlab qolgan yoki tarmoq beqaror bo'lishi mumkin — birinchi
// so'rov muvaffaqiyatsiz bo'lsa, ma'lumotni "bo'sh" deb ko'rsatmaymiz, balki qayta urinamiz.
const RETRY_DELAYS = [0, 2000, 5000, 10000, 20000]

function fetchColl(coll) {
  const ep = ENDPOINTS[coll]
  if (!ep) { cache[coll] = cache[coll] || EMPTY; loaded[coll] = true; attempted[coll] = true; return Promise.resolve() }
  if (inflight[coll]) return inflight[coll]
  attempted[coll] = true
  inflight[coll] = (async () => {
    emit() // "yuklanmoqda" holatini ko'rsatish uchun
    for (let i = 0; i < RETRY_DELAYS.length; i++) {
      if (RETRY_DELAYS[i]) await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]))
      try { cache[coll] = await api(ep); loaded[coll] = true; return }
      catch { /* keyingi urinish; hammasi tugasa loaded=false qoladi → "yuklab bo'lmadi" holati ko'rsatiladi */ }
    }
  })().finally(() => { inflight[coll] = null; emit() })
  return inflight[coll]
}

// Kolleksiya hozir yuklanяptimi (birinchi marta, hali muvaffaqiyatli bo'lmagan)
export const isLoading = (coll) => !!inflight[coll] && !loaded[coll]
// Barcha qayta urinishlar tugadi, lekin muvaffaqiyatsiz — internet/server bilan muammo
// (haqiqiy bo'sh ro'yxatdan farqi: loaded=true bo'lganda rows.length===0 "bo'sh", bu esa "xato")
export const hasFailed = (coll) => !!attempted[coll] && !inflight[coll] && !loaded[coll]

export function ensureLoaded(coll) { if (!loaded[coll]) fetchColl(coll) }
function refresh(coll) { loaded[coll] = false; return fetchColl(coll) }
// Foydalanuvchi "Qayta urinish" tugmasini bossa — muvaffaqiyatsizlikdan keyin qo'lda qayta yuklash
export const retry = refresh

export const db = {
  get: (coll) => { ensureLoaded(coll); return cache[coll] || EMPTY },
  async add(coll, item) { const ep = ENDPOINTS[coll]; if (!ep) return; await api(ep, { method: 'POST', body: item }); await refresh(coll); refresh('audit') },
  async update(coll, id, patch) { const ep = ENDPOINTS[coll]; if (!ep) return; await api(`${ep}/${id}`, { method: 'PUT', body: patch }); await refresh(coll); refresh('audit') },
  async remove(coll, id) { const ep = ENDPOINTS[coll]; if (!ep) return; await api(`${ep}/${id}`, { method: 'DELETE' }); await refresh(coll); refresh('audit') },
  async clear(coll) { const ep = ENDPOINTS[coll]; if (!ep) return null; const r = await api(ep, { method: 'DELETE' }); await refresh(coll); return r },
  reset() { Object.keys(loaded).forEach(refresh) },
}

export function useCollection(coll) {
  const value = useSyncExternalStore(subscribe, () => cache[coll] || EMPTY, () => EMPTY)
  useEffect(() => { ensureLoaded(coll) }, [coll])
  return value
}

// Kolleksiya birinchi marta yuklanяptimi (spinner ko'rsatish uchun)
export function useIsLoading(coll) {
  return useSyncExternalStore(subscribe, () => isLoading(coll), () => false)
}

// Barcha qayta urinishlar tugadi-yu muvaffaqiyatsiz bo'ldi (xato holati, "Qayta urinish" tugmasi uchun)
export function useLoadFailed(coll) {
  return useSyncExternalStore(subscribe, () => hasFailed(coll), () => false)
}
