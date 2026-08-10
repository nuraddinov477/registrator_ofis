import { useState } from 'react'
import { GraduationCap, LogIn } from 'lucide-react'
import { auth } from '../api/client'

// Faqat shu qurilma/brauzerda "eslab qolish" — kodga yozilmagan, boshqa hech kim
// ko'rmaydi. Login muvaffaqiyatli o'tgach shu yerga yoziladi, forma keyingi safar
// avtomatik to'ldiriladi (baribir "Kirish" bosish kerak — sayt ochiq bo'lgani uchun).
const REMEMBER_KEY = 'smartjadval-remember'
const loadRemembered = () => { try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null') } catch { return null } }

export default function Login() {
  const remembered = loadRemembered()
  const [login, setLogin] = useState(remembered?.login || '')
  const [password, setPassword] = useState(remembered?.password || '')
  const [remember, setRemember] = useState(!!remembered)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await auth.login(login.trim(), password)
      if (remember) localStorage.setItem(REMEMBER_KEY, JSON.stringify({ login: login.trim(), password }))
      else localStorage.removeItem(REMEMBER_KEY)
    } catch (err) {
      setError(err.message || 'Kirishda xatolik')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 dark:bg-[#0b1220]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-white">
            <GraduationCap size={26} />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">SmartJadval</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Tizimga kirish</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</div>
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Login</span>
            <input className="input" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Parol</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded" />
            Bu qurilmada eslab qolish
          </label>
          <button type="submit" disabled={busy} className="btn-primary w-full justify-center disabled:opacity-60">
            <LogIn size={16} /> {busy ? 'Kirilmoqda...' : 'Kirish'}
          </button>
        </form>
      </div>
    </div>
  )
}
