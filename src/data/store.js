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

function fetchColl(coll) {
  const ep = ENDPOINTS[coll]
  if (!ep) { cache[coll] = cache[coll] || EMPTY; loaded[coll] = true; return Promise.resolve() }
  if (inflight[coll]) return inflight[coll]
  inflight[coll] = api(ep)
    .then((rows) => { cache[coll] = rows })
    .catch(() => { cache[coll] = cache[coll] || EMPTY })
    .finally(() => { loaded[coll] = true; inflight[coll] = null; emit() })
  return inflight[coll]
}

export function ensureLoaded(coll) { if (!loaded[coll]) fetchColl(coll) }
function refresh(coll) { loaded[coll] = false; return fetchColl(coll) }

export const db = {
  get: (coll) => { ensureLoaded(coll); return cache[coll] || EMPTY },
  async add(coll, item) { const ep = ENDPOINTS[coll]; if (!ep) return; await api(ep, { method: 'POST', body: item }); await refresh(coll); refresh('audit') },
  async update(coll, id, patch) { const ep = ENDPOINTS[coll]; if (!ep) return; await api(`${ep}/${id}`, { method: 'PUT', body: patch }); await refresh(coll); refresh('audit') },
  async remove(coll, id) { const ep = ENDPOINTS[coll]; if (!ep) return; await api(`${ep}/${id}`, { method: 'DELETE' }); await refresh(coll); refresh('audit') },
  reset() { Object.keys(loaded).forEach(refresh) },
}

export function useCollection(coll) {
  const value = useSyncExternalStore(subscribe, () => cache[coll] || EMPTY, () => EMPTY)
  useEffect(() => { ensureLoaded(coll) }, [coll])
  return value
}
