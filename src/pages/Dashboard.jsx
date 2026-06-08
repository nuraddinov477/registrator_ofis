import { Link } from 'react-router-dom'
import {
  Building2, Landmark, Users, Library, GraduationCap, Home, CalendarDays, ArrowUpRight,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { useCollection } from '../data/store'

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

export default function Dashboard() {
  const faculties = useCollection('faculties')
  const departments = useCollection('departments')
  const teachers = useCollection('teachers')
  const subjects = useCollection('subjects')
  const groups = useCollection('groups')
  const rooms = useCollection('rooms')
  const loads = useCollection('loads')

  const cards = [
    stat('Jami fakultetlar', faculties.length, Building2, 'bg-blue-500', '/faculties'),
    stat('Jami kafedralar', departments.length, Landmark, 'bg-cyan-500', '/departments'),
    stat('Jami oʻqituvchilar', teachers.length, Users, 'bg-emerald-500', '/teachers'),
    stat('Jami fanlar', subjects.length, Library, 'bg-amber-500', '/subjects'),
    stat('Akademik guruhlar', groups.length, GraduationCap, 'bg-purple-500', '/groups'),
    stat('Jami auditoriyalar', rooms.length, Home, 'bg-rose-500', '/rooms'),
    stat('Haftalik darslar', loads.length, CalendarDays, 'bg-indigo-500', '/loads'),
  ]

  const loadByFaculty = faculties.map((f) => ({
    name: f.name.length > 22 ? f.name.slice(0, 22) + '…' : f.name,
    value: departments.filter((d) => d.facultyId === f.id).length,
  }))

  const teachersByDept = departments.map((d) => ({
    name: d.name,
    value: teachers.filter((t) => t.departmentId === d.id).length || 1,
  }))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Universitet boʻyicha umumiy statistika</p>
      </div>

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
              <Tooltip contentStyle={{ background: '#0d1526', border: '1px solid #1e293b', borderRadius: 8, color: '#fff' }} />
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
              <Tooltip contentStyle={{ background: '#0d1526', border: '1px solid #1e293b', borderRadius: 8, color: '#fff' }} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
