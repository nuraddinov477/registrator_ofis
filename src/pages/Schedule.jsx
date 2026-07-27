import { useState, useEffect } from 'react'
import { Zap, Loader2, RefreshCw, CalendarDays, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { roleOf, ROLES } from '../lib/access'
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
  const [avail, setAvail] = useState(null) // o'qituvchilar bandlik matritsasi
  const [viewMode, setViewMode] = useState('group') // 'group' | 'teachers'
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // Qo'lda tahrirlash (faqat Super Admin)
  const [refs, setRefs] = useState({ subjects: [], teachers: [], rooms: [] })
  const [editCell, setEditCell] = useState(null) // { id|null, day, pair }
  const [editForm, setEditForm] = useState(null) // { subjectId, teacherId, roomId, day, pair }
  const [editErr, setEditErr] = useState('')
  const [saving, setSaving] = useState(false)

  const [genOpen, setGenOpen] = useState(false)
  const [semester, setSemester] = useState('1')
  const [seconds, setSeconds] = useState(5)
  const [busy, setBusy] = useState('') // generatsiya davom etayotgan bo'lsa — holat matni
  // Jadval amal qilish sana oralig'i (dan — gacha) — lokalda saqlanadi
  const [date, setDate] = useState(() => localStorage.getItem('smartjadval-schedule-date') || new Date().toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(() => localStorage.getItem('smartjadval-schedule-date-to') || '')

  const role = roleOf()
  const isTeacher = role === ROLES.TEACHER
  const isSuper = role === ROLES.SUPER
  const canGenerate = role === ROLES.SUPER || role === ROLES.OPERATOR

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

  // Tahrirlash uchun ma'lumotnomalar (fan/o'qituvchi/xona) — faqat Super Admin
  useEffect(() => {
    if (!isSuper) return
    Promise.all([api('/subjects'), api('/teachers'), api('/rooms')])
      .then(([subjects, teachers, rooms]) => setRefs({ subjects, teachers, rooms }))
      .catch(() => {})
  }, [isSuper])

  // Run yoki guruh o'zgarsa — jadvalni qayta yuklaymiz.
  // O'qituvchi rolida: o'z jadvali (teacher-grid, teacherId token'dan). Boshqalar: guruh jadvali.
  useEffect(() => {
    if (!runId) { setGrid(null); setAvail(null); return }
    let alive = true
    // O'qituvchilar bandligi ko'rinishi (faqat o'qituvchi bo'lmagan rollar uchun)
    if (!isTeacher && viewMode === 'teachers') {
      api(`/schedule/runs/${runId}/teacher-availability`)
        .then((a) => { if (alive) { setAvail(a); setErr('') } })
        .catch((e) => { if (alive) { setErr(e.message); setAvail(null) } })
      return () => { alive = false }
    }
    if (!isTeacher && !groupId) { setGrid(null); return }
    const url = isTeacher
      ? `/schedule/runs/${runId}/teacher-grid`
      : `/schedule/runs/${runId}/grid?groupId=${groupId}`
    api(url)
      .then((g) => { if (alive) setGrid(g) })
      .catch((e) => { if (alive) { setErr(e.message); setGrid(null) } })
    return () => { alive = false }
  }, [runId, groupId, isTeacher, viewMode])

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

  // ── Qo'lda tahrirlash: katakni ochish / saqlash / o'chirish ──
  const reloadGroupGrid = async () => {
    const g = await api(`/schedule/runs/${runId}/grid?groupId=${groupId}`)
    setGrid(g)
  }
  const openCellEdit = (cell, pairIndex, dayIndex) => {
    setEditErr('')
    setEditCell({ id: cell?.id ?? null, day: dayIndex, pair: pairIndex + 1 })
    setEditForm({
      subjectId: cell?.subjectId ?? '', teacherId: cell?.teacherId ?? '', roomId: cell?.roomId ?? '',
      day: dayIndex, pair: pairIndex + 1,
    })
  }
  const saveCell = async () => {
    if (!editForm.subjectId || !editForm.teacherId || !editForm.roomId) {
      setEditErr("Fan, o'qituvchi va xonani tanlang"); return
    }
    setSaving(true); setEditErr('')
    const body = {
      groupId: Number(groupId), subjectId: Number(editForm.subjectId), teacherId: Number(editForm.teacherId),
      roomId: Number(editForm.roomId), day: Number(editForm.day), pair: Number(editForm.pair),
    }
    try {
      if (editCell.id) await api(`/schedule/runs/${runId}/entries/${editCell.id}`, { method: 'PUT', body })
      else await api(`/schedule/runs/${runId}/entries`, { method: 'POST', body })
      await reloadGroupGrid()
      setEditCell(null)
    } catch (e) { setEditErr(e.message) } finally { setSaving(false) }
  }
  const deleteCell = async () => {
    if (!editCell?.id) return
    setSaving(true); setEditErr('')
    try {
      await api(`/schedule/runs/${runId}/entries/${editCell.id}`, { method: 'DELETE' })
      await reloadGroupGrid()
      setEditCell(null)
    } catch (e) { setEditErr(e.message) } finally { setSaving(false) }
  }

  // Butun jadvalni (run) o'chirish
  const deleteRun = async () => {
    if (!runId) return
    if (!confirm(`#${runId} jadval butunlay o'chirilsinmi? Barcha darslari bilan o'chadi.`)) return
    try {
      await api(`/schedule/runs/${runId}`, { method: 'DELETE' })
      const rs = await api('/schedule/runs')
      setRuns(rs)
      setRunId((rs.find((r) => r.status === 'done') || rs[0])?.id ?? null)
      setGrid(null); setAvail(null)
    } catch (e) { setErr(e.message) }
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
          <div className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            <span>Sana:</span>
            <input type="date" className="input h-9 w-auto py-1" value={date}
              onChange={(e) => { setDate(e.target.value); localStorage.setItem('smartjadval-schedule-date', e.target.value) }} title="Boshlanish sanasi" />
            <span>—</span>
            <input type="date" className="input h-9 w-auto py-1" value={dateTo} min={date}
              onChange={(e) => { setDateTo(e.target.value); localStorage.setItem('smartjadval-schedule-date-to', e.target.value) }} title="Tugash sanasi" />
          </div>
          <button className="btn-ghost" onClick={() => loadMeta(runId)} title="Yangilash"><RefreshCw size={15} /></button>
          {canGenerate && (
            <button className="btn-primary" disabled={!!busy} onClick={() => setGenOpen(true)}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} Jadval yaratish
            </button>
          )}
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
        {canGenerate && runId && (
          <button onClick={deleteRun} title="Tanlangan jadvalni o'chirish"
            className="mb-0.5 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-red-500 hover:bg-red-500/10">
            <Trash2 size={15} /> O'chirish
          </button>
        )}
        {isTeacher && <div className="pb-2"><Badge color="blue">Mening jadvalim</Badge></div>}
        {!isTeacher && (
          <div className="pb-2">
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
              {[['group', 'Guruh jadvali'], ['teachers', "O'qituvchilar bandligi"]].map(([v, label]) => (
                <button key={v} onClick={() => setViewMode(v)}
                  className={`rounded-md px-3 py-1 text-sm font-medium transition ${viewMode === v ? 'bg-brand text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {!isTeacher && viewMode === 'group' && (
          <Field label="Guruh">
            <select className="input min-w-[160px]" value={groupId ?? ''} onChange={(e) => setGroupId(Number(e.target.value))}>
              {groups.length === 0 && <option value="">— guruh yo'q —</option>}
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
        )}
        {run && (
          <div className="flex items-center gap-2 pb-2">
            {statusBadge(run.status)}
            <Badge color="gray">qattiq buzilish: {run.hardScore ?? '—'}</Badge>
            <Badge color="blue">yumshoq: {run.softScore ?? '—'}</Badge>
            <span className="text-xs text-slate-400">{dt(run.createdAt)}</span>
          </div>
        )}
      </div>

      {isSuper && viewMode === 'group' && grid && (
        <p className="mb-2 text-xs text-slate-400">
          💡 Katakni bosib darsni tahrirlang yoki bo'sh katakka yangi dars qo'shing. Tizim to'qnashuvni (band guruh / o'qituvchi / xona) taqiqlaydi.
        </p>
      )}

      {/* Jadval to'ri */}
      {loading ? (
        <div className="card p-10 text-center text-slate-400">Yuklanmoqda…</div>
      ) : runs.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-12 text-center">
          <CalendarDays size={40} className="text-slate-300 dark:text-slate-600" />
          <div className="text-slate-500 dark:text-slate-400">Hali jadval yaratilmagan.</div>
          {canGenerate && <button className="btn-primary" onClick={() => setGenOpen(true)}><Zap size={16} /> Birinchi jadvalni yaratish</button>}
        </div>
      ) : (!isTeacher && viewMode === 'teachers') ? (
        !avail ? (
          <div className="card p-10 text-center text-slate-400">Yuklanmoqda…</div>
        ) : (
          <TeacherAvailability avail={avail} />
        )
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
                    <td key={di} onClick={isSuper ? () => openCellEdit(c, pi, di) : undefined}
                      className={`group h-16 border-b border-l border-slate-200 px-1.5 py-1.5 align-top dark:border-slate-800 ${isSuper ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40' : ''}`}>
                      {c ? (
                        <div className={`rounded-md border px-2 py-1 text-xs ${DAY_COLORS[di % DAY_COLORS.length]}`}>
                          <div className="font-semibold">{c.subject || 'Fan'}</div>
                          <div className="opacity-80">{c.teacher || c.group || ''}</div>
                          {c.room && <div className="opacity-70">{c.room}</div>}
                        </div>
                      ) : isSuper ? (
                        <div className="flex h-full items-center justify-center text-xs text-slate-300 opacity-0 transition group-hover:opacity-100 dark:text-slate-600">+ dars</div>
                      ) : null}
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

      {/* Qo'lda tahrirlash modali (Super Admin) */}
      <Modal open={!!editCell} onClose={() => setEditCell(null)} title={editCell?.id ? 'Darsni tahrirlash' : "Dars qo'shish"}>
        {editForm && (
          <div className="space-y-3">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {run?.semester}-semestr · <span className="font-medium text-slate-700 dark:text-slate-200">{groups.find((g) => g.id === Number(groupId))?.name}</span>
            </div>
            <Field label="Fan">
              <select className="input" value={editForm.subjectId} onChange={(e) => setEditForm({ ...editForm, subjectId: e.target.value })}>
                <option value="">— tanlang —</option>
                {refs.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="O'qituvchi">
              <select className="input" value={editForm.teacherId} onChange={(e) => setEditForm({ ...editForm, teacherId: e.target.value })}>
                <option value="">— tanlang —</option>
                {refs.teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
              </select>
            </Field>
            <Field label="Xona">
              <select className="input" value={editForm.roomId} onChange={(e) => setEditForm({ ...editForm, roomId: e.target.value })}>
                <option value="">— tanlang —</option>
                {refs.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kun">
                <select className="input" value={editForm.day} onChange={(e) => setEditForm({ ...editForm, day: Number(e.target.value) })}>
                  {(grid?.days || []).map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </Field>
              <Field label="Juftlik">
                <select className="input" value={editForm.pair} onChange={(e) => setEditForm({ ...editForm, pair: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6].map((p) => <option key={p} value={p}>{p}-juft</option>)}
                </select>
              </Field>
            </div>
            {editErr && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{editErr}</div>}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div>
                {editCell?.id && (
                  <button className="btn-ghost text-red-500 hover:bg-red-500/10" onClick={deleteCell} disabled={saving}>O'chirish</button>
                )}
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => setEditCell(null)} disabled={saving}>Bekor</button>
                <button className="btn-primary" onClick={saveCell} disabled={saving}>{saving ? 'Saqlanmoqda…' : 'Saqlash'}</button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// O'qituvchilar bandlik matritsasi: qatorlar = o'qituvchilar, ustunlar = kun×juftlik.
// Yashil = bo'sh, qizil = band. Hover'da (title) fan/guruh/xona ko'rinadi.
function TeacherAvailability({ avail }) {
  // Ustunlar ro'yxati: har kun uchun `pairs` ta juftlik
  const cols = []
  avail.days.forEach((day, di) => {
    for (let p = 0; p < avail.pairs; p++) cols.push({ di, p, day, first: p === 0 })
  })

  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const filtered = query
    ? avail.teachers.filter((t) =>
        t.name.toLowerCase().includes(query) ||
        t.grid.some((row) => row.some((c) => c && (c.subject || '').toLowerCase().includes(query))))
    : avail.teachers

  if (!avail.teachers.length) {
    return <div className="card p-10 text-center text-slate-400">O'qituvchilar topilmadi.</div>
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3 dark:border-slate-800">
        <input
          className="input max-w-xs"
          placeholder="Qidirish: o'qituvchi ismi yoki fan…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-xs text-slate-400">{filtered.length} / {avail.teachers.length} o'qituvchi</span>
      </div>
      <div className="overflow-x-auto">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th rowSpan={2} className="sticky left-0 z-10 border-b border-slate-200 bg-white px-3 py-2 text-left font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              O'qituvchi
            </th>
            {avail.days.map((d) => (
              <th key={d} colSpan={avail.pairs} className="border-b border-l border-slate-300 px-2 py-2 text-center font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                {d}
              </th>
            ))}
          </tr>
          <tr>
            {cols.map((c) => (
              <th key={`${c.di}-${c.p}`} className={`w-7 border-b border-slate-200 py-1 text-center font-normal text-slate-400 dark:border-slate-800 ${c.first ? 'border-l border-slate-300 dark:border-slate-700' : ''}`}>
                {c.p + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((t) => (
            <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
              <td className="sticky left-0 z-10 whitespace-nowrap border-b border-slate-100 bg-white px-3 py-1.5 dark:border-slate-800/60 dark:bg-slate-900">
                <span className="font-medium text-slate-700 dark:text-slate-200">{t.name}</span>
                <span className="ml-2 text-[10px] text-emerald-500">{t.free} bo'sh</span>
              </td>
              {cols.map((c) => {
                const cell = t.grid[c.p][c.di]
                const label = `${c.day} ${c.p + 1}-juft — ${cell
                  ? `band: ${cell.subject || ''}${cell.group ? ' · ' + cell.group : ''}${cell.room ? ' · ' + cell.room : ''}`
                  : "bo'sh"}`
                return (
                  <td key={`${c.di}-${c.p}`} className={`border-b border-slate-100 dark:border-slate-800/60 ${c.first ? 'border-l border-slate-300 dark:border-slate-700' : ''}`}>
                    <div title={label} className={`mx-auto my-0.5 h-5 w-5 rounded-[3px] ${cell ? 'bg-rose-500/80 hover:bg-rose-500' : 'bg-emerald-500/60 hover:bg-emerald-500/80'}`} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 && (
        <div className="p-6 text-center text-sm text-slate-400">"{q}" bo'yicha o'qituvchi topilmadi</div>
      )}
      </div>
      <div className="flex flex-wrap items-center gap-4 px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-[3px] bg-emerald-500/60" /> bo'sh vaqt</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-[3px] bg-rose-500/80" /> band (dars bor)</span>
        <span className="text-slate-400">Hujayra ustiga borsangiz — fan / guruh / xona ko'rinadi</span>
      </div>
    </div>
  )
}
