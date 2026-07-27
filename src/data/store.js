import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../api/client'

// Backend API'ga ulangan ma'lumot do'koni — eski interfeys (db, useCollection) saqlanadi,
// shuning uchun sahifalar o'zgarmaydi. Lokal kesh + avtomatik qayta yuklash.
const ENDPOINTS = {
  faculties: '/faculties', departments: '/departments', specialties: '/specialties',
  teachers: '/teachers', subjects: '/subjects', groups: '/groups', buildings: '/buildings',
  rooms: '/rooms', users: '/users', audit: '/audit', loads: '/workloads',
  // 'requests' va 'schedule' — backendda boshqacha (engine API), hozircha lokal/bo'sh
}

const EMPTY = []
const cache = {}
const loaded = {}
const inflight = {}
const listeners = new Set()

const emit = () => listeners.forEach((l) => l())
const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb) }

// Backend (Render bepul) uxlab qolgan bo'lishi mumkin — birinchi so'rov muvaffaqiyatsiz
// bo'lsa, ma'lumotni "bo'sh" deb ko'rsatmaymiz, balki backend uyg'onguncha qayta urinamiz.
const RETRY_DELAYS = [0, 2000, 5000, 10000, 20000]

function fetchColl(coll) {
  const ep = ENDPOINTS[coll]
  if (!ep) { cache[coll] = cache[coll] || EMPTY; loaded[coll] = true; return Promise.resolve() }
  if (inflight[coll]) return inflight[coll]
  inflight[coll] = (async () => {
    emit() // "yuklanmoqda" holatini ko'rsatish uchun
    for (let i = 0; i < RETRY_DELAYS.length; i++) {
      if (RETRY_DELAYS[i]) await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]))
      try { cache[coll] = await api(ep); loaded[coll] = true; return }
      catch { /* keyingi urinish; hammasi tugasa loaded=false qoladi → keyin qayta yuklanadi */ }
    }
    cache[coll] = cache[coll] || EMPTY
  })().finally(() => { inflight[coll] = null; emit() })
  return inflight[coll]
}

// Kolleksiya hozir yuklanяptimi (birinchi marta, hali muvaffaqiyatli bo'lmagan)
export const isLoading = (coll) => !!inflight[coll] && !loaded[coll]

export function ensureLoaded(coll) { if (!loaded[coll]) fetchColl(coll) }
function refresh(coll) { loaded[coll] = false; return fetchColl(coll) }

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
