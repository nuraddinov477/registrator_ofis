import { useState } from 'react'
import { GraduationCap, LogIn } from 'lucide-react'
import { auth } from '../api/client'

export default function Login() {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await auth.login(login.trim(), password)
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
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">UniSchedule</h1>
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
          <button type="submit" disabled={busy} className="btn-primary w-full justify-center disabled:opacity-60">
            <LogIn size={16} /> {busy ? 'Kirilmoqda...' : 'Kirish'}
          </button>
          <p className="text-center text-xs text-slate-400">
            Demo: <b>admin / admin123</b> yoki <b>operator / operator123</b>
          </p>
        </form>
      </div>
    </div>
  )
}
