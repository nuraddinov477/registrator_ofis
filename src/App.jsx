import { lazy, Suspense, useSyncExternalStore } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './layout/Layout'
import Login from './auth/Login'
import { auth } from './api/client'
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

export default function App() {
  const authed = useAuthed()
  if (!authed) return <Login />

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
