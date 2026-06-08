// Backend API klienti — VITE_API_URL, JWT token, xatolik boshqaruvi.
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
const TOKEN_KEY = 'unischedule-token'

let token = localStorage.getItem(TOKEN_KEY) || null
const authListeners = new Set()

export const auth = {
  get token() { return token },
  isAuthed: () => !!token,
  user: () => { try { return JSON.parse(localStorage.getItem('unischedule-user') || 'null') } catch { return null } },
  subscribe(cb) { authListeners.add(cb); return () => authListeners.delete(cb) },
  _set(t, user) {
    token = t
    if (t) { localStorage.setItem(TOKEN_KEY, t); localStorage.setItem('unischedule-user', JSON.stringify(user || null)) }
    else { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem('unischedule-user') }
    authListeners.forEach((l) => l())
  },
  clear() { auth._set(null) },
  async login(login, password) {
    const r = await api('/auth/login', { method: 'POST', body: { login, password }, noAuth: true })
    auth._set(r.token, r.user)
    return r.user
  },
}

export async function api(path, { method = 'GET', body, noAuth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (!noAuth && token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined })

  if (res.status === 401 && !noAuth) auth.clear() // token eskirgan → chiqarib yuboramiz
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const j = await res.json(); msg = j.error || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  if (res.status === 204) return null
  return res.json()
}
