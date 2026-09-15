import { lazy, Suspense, useSyncExternalStore, useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import Layout from './layout/Layout'
import Login from './auth/Login'
import { auth, api } from './api/client'
import { canSeeRoute } from './lib/access'

// Har sahifa alohida "chunk" sifatida — faqat o'sha sahifaga o'tilganda yuklanadi
// (bitta katta bundle o'rniga). resources.jsx/Misc.jsx bir nechta sahifani eksport
// qiladi — shu fayl darhol yuklanadi, lekin faqat shu guruh sahifalariga kirilganda.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Rooms = lazy(() => import('./pages/Rooms'))
const Schedule = lazy(() => import('./pages/Schedule'))
const Faculties = lazy(() => import('./pages/resources').then((m) => ({ default: m.Faculties })))
const Departments = lazy(() => import('./pages/resources').then((m) => ({ default: m.Departments })))
const Specialties = lazy(() => import('./pages/resources').then((m) => ({ default: m.Specialties })))
const Teachers = lazy(() => import('./pages/resources').then((m) => ({ default: m.Teachers })))
const Subjects = lazy(() => import('./pages/resources').then((m) => ({ default: m.Subjects })))
const Groups = lazy(() => import('./pages/resources').then((m) => ({ default: m.Groups })))
const Loads = lazy(() => import('./pages/Misc').then((m) => ({ default: m.Loads })))
const Requests = lazy(() => import('./pages/Misc').then((m) => ({ default: m.Requests })))
const UsersPage = lazy(() => import('./pages/Misc').then((m) => ({ default: m.UsersPage })))
const Audit = lazy(() => import('./pages/Misc').then((m) => ({ default: m.Audit })))

function useAuthed() {
  return useSyncExternalStore(auth.subscribe, auth.isAuthed, () => false)
}

// Rol ruxsati bo'lmagan yo'lni Dashboard'ga yo'naltiradi (backend baribir bloklaydi)
const Guard = ({ path, children }) => (canSeeRoute(path) ? children : <Navigate to="/" replace />)

const PageLoading = () => (
  <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-400">Yuklanmoqda…</div>
)

// Texnik xizmat rejimi yoqilsa (Dashboard'dagi developer boshqaruvi orqali) —
// "developer"dan boshqa HAMMA (Super Admin'lar ham) uchun to'liq ekranli xabar
// (backend baribir bloklaydi, bu shunchaki qulay ko'rinish). Har 20 soniyada
// tekshiriladi — yoqilsa/o'chirilsa tez ko'rinsin.
function useMaintenanceLock() {
  const [state, setState] = useState(null)
  useEffect(() => {
    if (auth.user()?.login === 'developer') return
    let alive = true
    const check = () => api('/site-settings').then((s) => { if (alive) setState(s) }).catch(() => {})
    check()
    const id = setInterval(check, 20000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  return state?.maintenanceMode ? state : null
}

function MaintenanceLock({ message }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center dark:bg-slate-950">
      <ShieldAlert size={40} className="text-amber-500" />
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Sayt vaqtincha yopiq</h1>
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
        {message || "Sayt hozir texnik xizmat ko'rsatish tufayli vaqtincha ishlamaydi. Iltimos, keyinroq qayta urinib ko'ring."}
      </p>
    </div>
  )
}

export default function App() {
  const authed = useAuthed()
  const maintenance = useMaintenanceLock()
  if (!authed) return <Login />
  if (maintenance) return <MaintenanceLock message={maintenance.message} />

  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="loads" element={<Guard path="/loads"><Loads /></Guard>} />
          <Route path="requests" element={<Guard path="/requests"><Requests /></Guard>} />
          <Route path="faculties" element={<Guard path="/faculties"><Faculties /></Guard>} />
          <Route path="departments" element={<Guard path="/departments"><Departments /></Guard>} />
          <Route path="specialties" element={<Guard path="/specialties"><Specialties /></Guard>} />
          <Route path="teachers" element={<Guard path="/teachers"><Teachers /></Guard>} />
          <Route path="subjects" element={<Guard path="/subjects"><Subjects /></Guard>} />
          <Route path="groups" element={<Guard path="/groups"><Groups /></Guard>} />
          <Route path="rooms" element={<Guard path="/rooms"><Rooms /></Guard>} />
          <Route path="schedule" element={<Guard path="/schedule"><Schedule /></Guard>} />
          <Route path="users" element={<Guard path="/users"><UsersPage /></Guard>} />
          <Route path="audit" element={<Guard path="/audit"><Audit /></Guard>} />
        </Route>
      </Routes>
    </Suspense>
  )
}
