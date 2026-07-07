import { useSyncExternalStore } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './layout/Layout'
import Dashboard from './pages/Dashboard'
import Rooms from './pages/Rooms'
import Schedule from './pages/Schedule'
import { Faculties, Departments, Specialties, Teachers, Subjects, Groups } from './pages/resources'
import { Loads, Requests, UsersPage, Audit } from './pages/Misc'
import Login from './auth/Login'
import { auth } from './api/client'
import { canSeeRoute } from './lib/access'

function useAuthed() {
  return useSyncExternalStore(auth.subscribe, auth.isAuthed, () => false)
}

// Rol ruxsati bo'lmagan yo'lni Dashboard'ga yo'naltiradi (backend baribir bloklaydi)
const Guard = ({ path, children }) => (canSeeRoute(path) ? children : <Navigate to="/" replace />)

export default function App() {
  const authed = useAuthed()
  if (!authed) return <Login />

  return (
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
  )
}
