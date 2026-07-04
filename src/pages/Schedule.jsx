import { useState, useEffect } from 'react'
import { Zap, Loader2, RefreshCw, CalendarDays } from 'lucide-react'
import { api } from '../api/client'
import { Modal, Field, Badge } from '../components/ui'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DAY_COLORS = [
  'bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-300',
  'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-300',
  'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-300',
  'bg-purple-500/15 border-purple-500/30 text-purple-600 dark:text-purple-300',
  'bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-300',
]
const dt = (s) => (s ? new Date(s).toLocaleString('uz') : '')

export default function Schedule() {
  const [runs, setRuns] = useState([])
  const [runId, setRunId] = useState(null)
  const [groups, setGroups] = useState([])
  const [groupId, setGroupId] = useState(null)
  const [grid, setGrid] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [genOpen, setGenOpen] = useState(false)
  const [semester, setSemester] = useState('1')
  const [seconds, setSeconds] = useState(5)
  const [busy, setBusy] = useState('') // generatsiya davom etayotgan bo'lsa — holat matni

  const run = runs.find((r) => r.id === runId) || null

  // Boshlang'ich: run'lar ro'yxati + guruhlar. Eng oxirgi tayyor jadval tanlanadi.
  const loadMeta = async (selectId) => {
    setLoading(true)
    try {
      const [rs, gs] = await Promise.all([api('/schedule/runs'), api('/groups')])
      setRuns(rs); setGroups(gs); setErr('')
      setGroupId((cur) => cur ?? gs[0]?.id ?? null)
      const pick = selectId ?? (rs.find((r) => r.status === 'done') || rs[0])?.id ?? null
      setRunId((cur) => selectId ?? cur ?? pick)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { loadMeta() }, [])

  // Run yoki guruh o'zgarsa — jadvalni qayta yuklaymiz.
  useEffect(() => {
    if (!runId || !groupId) { setGrid(null); return }
    let alive = true
    api(`/schedule/runs/${runId}/grid?groupId=${groupId}`)
      .then((g) => { if (alive) setGrid(g) })
      .catch((e) => { if (alive) { setErr(e.message); setGrid(null) } })
    return () => { alive = false }
  }, [runId, groupId])

  // Jadval yaratish: generate → done bo'lguncha poll → natijani ko'rsatish.
  const generate = async () => {
    setGenOpen(false); setBusy('Boshlanmoqda…'); setErr('')
    try {
      const { runId: newId } = await api('/schedule/generate', {
        method: 'POST', body: { semester: Number(semester), maxMs: Number(seconds) * 1000 },
      })
      let final = null
      for (let i = 0; i < 150; i++) {
        await sleep(1200)
        const r = await api(`/schedule/runs/${newId}`)
        if (r.run.status !== 'running') { final = r.run; break }
        setBusy('Optimallashtirilmoqda…')
      }
      if (final && final.status === 'failed') setErr('Generatsiya xato bilan tugadi')
      await loadMeta(newId)
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  const statusBadge = (s) => s === 'done' ? <Badge color="green">tayyor</Badge>
    : s === 'failed' ? <Badge color="red">xato</Badge>
      : <Badge color="amber">ishlanmoqda</Badge>

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dars jadvali</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Avtomatik optimallashtirish engine — {runs.length} ta yaratilgan jadval
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={() => loadMeta(runId)} title="Yangilash"><RefreshCw size={15} /></button>
          <button className="btn-primary" disabled={!!busy} onClick={() => setGenOpen(true)}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} Jadval yaratish
          </button>
        </div>
      </div>

      {busy && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-brand/10 px-4 py-2 text-sm text-brand">
          <Loader2 size={15} className="animate-spin" /> {busy}
        </div>
      )}
      {err && <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-500">Xatolik: {err}</div>}

      {/* Boshqaruv paneli: jadval + guruh tanlash + statistika */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Jadval (run)">
          <select className="input min-w-[220px]" value={runId ?? ''} onChange={(e) => setRunId(Number(e.target.value))}>
            {runs.length === 0 && <option value="">— hali yo'q —</option>}
            {runs.map((r) => (
              <option key={r.id} value={r.id}>#{r.id} · {r.semester}-semestr · {r.entries} dars · {r.status}</option>
            ))}
          </select>
        </Field>
        <Field label="Guruh">
          <select className="input min-w-[160px]" value={groupId ?? ''} onChange={(e) => setGroupId(Number(e.target.value))}>
            {groups.length === 0 && <option value="">— guruh yo'q —</option>}
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        {run && (
          <div className="flex items-center gap-2 pb-2">
            {statusBadge(run.status)}
            <Badge color="gray">qattiq buzilish: {run.hardScore ?? '—'}</Badge>
            <Badge color="blue">yumshoq: {run.softScore ?? '—'}</Badge>
            <span className="text-xs text-slate-400">{dt(run.createdAt)}</span>
          </div>
        )}
      </div>

      {/* Jadval to'ri */}
      {loading ? (
        <div className="card p-10 text-center text-slate-400">Yuklanmoqda…</div>
      ) : runs.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-12 text-center">
          <CalendarDays size={40} className="text-slate-300 dark:text-slate-600" />
          <div className="text-slate-500 dark:text-slate-400">Hali jadval yaratilmagan.</div>
          <button className="btn-primary" onClick={() => setGenOpen(true)}><Zap size={16} /> Birinchi jadvalni yaratish</button>
        </div>
      ) : !grid ? (
        <div className="card p-10 text-center text-slate-400">Guruh tanlang yoki jadval yuklanmoqda…</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-14 border-b border-r border-slate-200 px-2 py-3 text-slate-400 dark:border-slate-800">Para</th>
                {grid.days.map((d) => (
                  <th key={d} className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.grid.map((row, pi) => (
                <tr key={pi}>
                  <td className="border-b border-r border-slate-200 px-2 py-3 text-center font-medium text-slate-400 dark:border-slate-800">{pi + 1}</td>
                  {row.map((c, di) => (
                    <td key={di} className="h-16 border-b border-l border-slate-200 px-1.5 py-1.5 align-top dark:border-slate-800">
                      {c && (
                        <div className={`rounded-md border px-2 py-1 text-xs ${DAY_COLORS[di % DAY_COLORS.length]}`}>
                          <div className="font-semibold">{c.subject || 'Fan'}</div>
                          <div className="opacity-80">{c.teacher || ''}</div>
                          {c.room && <div className="opacity-70">{c.room}</div>}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Yaratish modali */}
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title="Jadval yaratish">
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Engine barcha guruhlar uchun haftalik jadvalni avtomatik tuzadi (qattiq cheklovlarni buzmasdan, yumshoqlarini optimallashtiradi).
          </p>
          <Field label="Semestr">
            <select className="input" value={semester} onChange={(e) => setSemester(e.target.value)}>
              <option value="1">1-semestr</option>
              <option value="2">2-semestr</option>
            </select>
          </Field>
          <Field label="Optimallashtirish vaqti (soniya)">
            <input className="input" type="number" min="1" max="120" value={seconds} onChange={(e) => setSeconds(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setGenOpen(false)}>Bekor</button>
            <button className="btn-primary" onClick={generate}><Zap size={16} /> Boshlash</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
