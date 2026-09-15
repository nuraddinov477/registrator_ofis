import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2, Landmark, Users, Library, GraduationCap, Home, CalendarDays, ArrowUpRight, ShieldAlert,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { useCollection } from '../data/store'
import { api } from '../api/client'
import { roleOf, ROLES } from '../lib/access'

// Texnik xizmat rejimi — FAQAT Super Admin ko'radi/boshqaradi. Yoqilsa, boshqa
// hech kim saytdan foydalana olmaydi (backend: maintenanceGate). To'liq OSHKORA —
// istalgan Super Admin hisobi bu yerdan boshqaradi, har o'zgarish Audit jurnaliga yoziladi.
function MaintenanceToggle() {
  const [state, setState] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('/site-settings').then((s) => { setState(s); setMsg(s.message || '') }).catch(() => {})
  }, [])

  const toggle = async () => {
    setBusy(true)
    try {
      const s = await api('/site-settings', { method: 'PUT', body: { maintenanceMode: !state.maintenanceMode, message: msg } })
      setState(s)
    } catch (e) { alert(e.message || 'Xatolik yuz berdi') } finally { setBusy(false) }
  }

  if (!state) return null
  return (
    <div className={`card mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${state.maintenanceMode ? 'border-red-500/40 bg-red-500/5' : ''}`}>
      <div className="flex items-start gap-3">
        <ShieldAlert size={20} className={state.maintenanceMode ? 'text-red-500' : 'text-slate-400'} />
        <div>
          <p className="font-semibold text-slate-800 dark:text-slate-200">
            Texnik xizmat rejimi{state.maintenanceMode
              ? <span className="ml-1.5 text-red-500">— YOQILGAN, sayt yopiq</span>
              : <span className="ml-1.5 text-emerald-500">— o'chirilgan</span>}
          </p>
          <p className="text-xs text-slate-400">Yoqilsa, Super Admin'dan boshqa hech kim saytdan foydalana olmaydi. Bu — oshkora funksiya, Audit jurnaliga yoziladi.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input className="input w-56" placeholder="Xabar (ixtiyoriy)…" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <button onClick={toggle} disabled={busy}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${state.maintenanceMode ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>
          {state.maintenanceMode ? 'Qayta ochish' : 'Saytni yopish'}
        </button>
      </div>
    </div>
  )
}

const stat = (label, value, icon, color, to) => ({ label, value, icon, color, to })

function Card({ label, value, icon: Icon, color, to }) {
  return (
    <Link to={to} className="card group relative flex items-center justify-between p-5 transition hover:border-brand/60 hover:shadow-md">
      <ArrowUpRight size={15} className="absolute right-3 top-3 text-slate-300 opacity-0 transition group-hover:opacity-100 dark:text-slate-600" />
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">{value}</p>
      </div>
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-white ${color}`}>
        <Icon size={22} />
      </div>
    </Link>
  )
}

const PIE_COLORS = ['#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6']

// Hover'da rang ostidagi fakultet/kafedra haqida to'liq ma'lumot ko'rsatadi
function InfoTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="max-w-[260px] rounded-lg border border-slate-700 bg-[#0d1526]/95 px-3 py-2 text-xs text-white shadow-xl">
      <p className="mb-1.5 font-semibold">{d.fullName}</p>
      {d.info.map(([label, val]) => (
        <p key={label} className="flex justify-between gap-4 text-slate-300">
          <span>{label}</span><span className="font-medium text-white">{val}</span>
        </p>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const faculties = useCollection('faculties')
  const departments = useCollection('departments')
  const teachers = useCollection('teachers')
  const subjects = useCollection('subjects')
  const groups = useCollection('groups')
  const rooms = useCollection('rooms')
  const loads = useCollection('loads')
  const specialties = useCollection('specialties')

  const cards = [
    stat('Jami fakultetlar', faculties.length, Building2, 'bg-blue-500', '/faculties'),
    stat('Jami kafedralar', departments.length, Landmark, 'bg-cyan-500', '/departments'),
    stat('Jami oʻqituvchilar', teachers.length, Users, 'bg-emerald-500', '/teachers'),
    stat('Jami fanlar', subjects.length, Library, 'bg-amber-500', '/subjects'),
    stat('Akademik guruhlar', groups.length, GraduationCap, 'bg-purple-500', '/groups'),
    stat('Jami auditoriyalar', rooms.length, Home, 'bg-rose-500', '/rooms'),
    stat('Haftalik darslar', loads.length, CalendarDays, 'bg-indigo-500', '/loads'),
  ]

  const groupFacultyId = new Map(groups.map((g) => [g.id, g.facultyId]))

  const loadByFaculty = faculties.map((f) => {
    const deptIds = new Set(departments.filter((d) => d.facultyId === f.id).map((d) => d.id))
    const teacherCount = teachers.filter((t) => deptIds.has(t.departmentId)).length
    const groupCount = groups.filter((g) => g.facultyId === f.id).length
    const loadCount = loads.filter((l) => l.groups?.some((x) => groupFacultyId.get(x.groupId) === f.id)).length
    const specCount = specialties.filter((s) => s.facultyId === f.id).length
    const studentCount = groups.filter((g) => g.facultyId === f.id).reduce((sum, g) => sum + (g.size || 0), 0)
    return {
      name: f.name.length > 22 ? f.name.slice(0, 22) + '…' : f.name,
      fullName: f.name,
      value: deptIds.size,
      info: [
        ['Kafedralar', deptIds.size],
        ['Mutaxassisliklar', specCount],
        ['Oʻqituvchilar', teacherCount],
        ['Guruhlar', groupCount],
        ['Talabalar', studentCount],
        ['Haftalik darslar', loadCount],
      ],
    }
  })

  const teachersByDept = departments.map((d) => {
    const deptTeacherIds = new Set(teachers.filter((t) => t.departmentId === d.id).map((t) => t.id))
    const deptLoads = loads.filter((l) => deptTeacherIds.has(l.teacherId))
    const subjectCount = new Set(deptLoads.map((l) => l.subjectId)).size
    const weeklyHours = deptLoads.reduce((sum, l) => sum + (l.weeklyHours || 0), 0)
    return {
      name: d.name,
      fullName: d.name,
      value: deptTeacherIds.size || 1,
      info: [
        ['Fakultet', faculties.find((f) => f.id === d.facultyId)?.name || '—'],
        ['Oʻqituvchilar', deptTeacherIds.size],
        ['Dars beriladigan fanlar', subjectCount],
        ['Haftalik darslar', deptLoads.length],
        ['Haftalik soatlar', weeklyHours],
      ],
    }
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Universitet boʻyicha umumiy statistika</p>
      </div>

      {roleOf() === ROLES.SUPER && <MaintenanceToggle />}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {cards.map((c) => <Card key={c.label} {...c} />)}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-4 font-semibold text-slate-800 dark:text-slate-200">Fakultetlar boʻyicha kafedralar</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={loadByFaculty}>
              <CartesianGrid strokeDasharray="3 3" stroke="#33415544" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip content={<InfoTooltip />} cursor={{ fill: '#3b82f622' }} />
              <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="mb-4 font-semibold text-slate-800 dark:text-slate-200">Kafedralar boʻyicha oʻqituvchilar</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={teachersByDept} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={45}>
                {teachersByDept.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip content={<InfoTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
