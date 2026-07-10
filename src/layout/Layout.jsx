import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutGrid, BookOpen, FileText, Building2, Landmark, GraduationCap,
  Users, Library, Network, Home, CalendarDays, UserCog, ShieldCheck,
  Sun, Moon, ChevronLeft, ChevronRight, Menu, LogOut,
} from 'lucide-react'
import { auth } from '../api/client'
import { canSeeRoute, unassignedScope, roleOf } from '../lib/access'

// Menyu 4 blokka guruhlangan — har rol faqat o'ziga ko'rinadigan bo'limlarni oladi,
// bo'sh qolgan blok sarlavhasi bilan birga yashirinadi
const navGroups = [
  { title: null, items: [{ to: '/', label: 'Dashboard', icon: LayoutGrid, end: true }] },
  {
    title: 'Tuzilma',
    items: [
      { to: '/faculties', label: 'Fakultetlar', icon: Building2 },
      { to: '/departments', label: 'Kafedralar', icon: Landmark },
      { to: '/specialties', label: 'Mutaxassisliklar', icon: GraduationCap },
    ],
  },
  {
    title: 'Resurslar',
    items: [
      { to: '/teachers', label: "O'qituvchilar", icon: Users },
      { to: '/subjects', label: 'Fanlar bazasi', icon: Library },
      { to: '/groups', label: 'Akademik guruhlar', icon: Network },
      { to: '/rooms', label: 'Bino va xonalar', icon: Home },
    ],
  },
  {
    title: 'Jarayon',
    items: [
      { to: '/loads', label: "O'quv yuklamasi", icon: BookOpen },
      { to: '/requests', label: 'Talabnomalar', icon: FileText },
      { to: '/schedule', label: 'Dars jadvali', icon: CalendarDays },
    ],
  },
  {
    title: 'Boshqaruv',
    items: [
      { to: '/users', label: 'Foydalanuvchilar', icon: UserCog },
      { to: '/audit', label: 'Audit logi', icon: ShieldCheck },
    ],
  },
]

const nav = navGroups.flatMap((g) => g.items)

function useTheme() {
  const [dark, setDark] = useState(() => !document.documentElement.classList.contains('light'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.classList.toggle('light', !dark)
  }, [dark])
  return [dark, () => setDark((d) => !d)]
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const [dark, toggleTheme] = useTheme()
  const location = useLocation()
  // Har rol faqat o'ziga ruxsat etilgan bo'limlarni ko'radi; bo'sh bloklar yashirinadi
  const visibleGroups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((n) => canSeeRoute(n.to)) }))
    .filter((g) => g.items.length > 0)
  const unassigned = unassignedScope()
  const role = roleOf()
  const current = nav.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to) && n.to !== '/'))?.label || 'Dashboard'

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900 dark:bg-[#0b1220] dark:text-slate-100">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-[68px]' : 'w-64'} sticky top-0 hidden h-screen flex-col border-r border-slate-200 bg-white transition-all dark:border-slate-800 dark:bg-[#0d1526] md:flex`}>
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-4 dark:border-slate-800">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
            <GraduationCap size={18} />
          </div>
          {!collapsed && <span className="text-lg font-bold">SmartJadval</span>}
        </div>

        <nav className="flex-1 space-y-3 overflow-y-auto p-3">
          {visibleGroups.map((group) => (
            <div key={group.title || 'asosiy'} className="space-y-1">
              {group.title && (collapsed
                ? <div className="mx-2 border-t border-slate-200 dark:border-slate-800" />
                : <div className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{group.title}</div>
              )}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={item.label}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-brand text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
                    }`
                  }
                >
                  <item.icon size={18} className="shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-500 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800/70"
        >
          {collapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /> Yig'ish</>}
        </button>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur dark:border-slate-800 dark:bg-[#0d1526]/80">
          <div className="flex items-center gap-3">
            <Menu size={18} className="text-slate-400 md:hidden" />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{current}</span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={toggleTheme} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                {(auth.user()?.fullName || 'AD').slice(0, 2).toUpperCase()}
              </div>
              <span className="hidden flex-col leading-tight sm:flex">
                <span className="text-sm font-medium">{auth.user()?.fullName || auth.user()?.login || 'Admin'}</span>
                {role && <span className="text-xs font-normal text-slate-400">{role}</span>}
              </span>
            </div>
            <button onClick={() => auth.clear()} title="Chiqish" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-800">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">
          {unassigned && (
            <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              Sizga {unassigned} biriktirilmagan — ma'lumotlar to'liq ko'rinmasligi mumkin. Administratorga murojaat qiling.
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  )
}
