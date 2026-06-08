import { useSyncExternalStore } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './layout/Layout'
import Dashboard from './pages/Dashboard'
import Rooms from './pages/Rooms'
import Schedule from './pages/Schedule'
import { Faculties, Departments, Specialties, Teachers, Subjects, Groups } from './pages/resources'
import { Loads, Requests, UsersPage, Audit } from './pages/Misc'
import Login from './auth/Login'
import { auth } from './api/client'

function useAuthed() {
  return useSyncExternalStore(auth.subscribe, auth.isAuthed, () => false)
}

export default function App() {
  const authed = useAuthed()
  if (!authed) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="loads" element={<Loads />} />
        <Route path="requests" element={<Requests />} />
        <Route path="faculties" element={<Faculties />} />
        <Route path="departments" element={<Departments />} />
        <Route path="specialties" element={<Specialties />} />
        <Route path="teachers" element={<Teachers />} />
        <Route path="subjects" element={<Subjects />} />
        <Route path="groups" element={<Groups />} />
        <Route path="rooms" element={<Rooms />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="audit" element={<Audit />} />
      </Route>
    </Routes>
  )
}
