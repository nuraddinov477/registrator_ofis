import { useState, useEffect, useRef } from 'react'
import { Zap, Loader2, RefreshCw, CalendarDays, Trash2, UserCog, Download, ClipboardCheck, XCircle, Archive, RotateCcw, Move } from 'lucide-react'
import { api } from '../api/client'
import { roleOf, ROLES } from '../lib/access'
import { Modal, Field, Badge, SearchableSelect } from '../components/ui'
import TeacherConstraintsModal from '../components/TeacherConstraintsModal'
import ScheduleExportModal from '../components/ScheduleExportModal'
import ScheduleDiagnostics from '../components/ScheduleDiagnostics'
import ScheduleViolations from '../components/ScheduleViolations'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DAY_COLORS = [
  'bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-300',
  'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-300',
  'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-300',
  'bg-purple-500/15 border-purple-500/30 text-purple-600 dark:text-purple-300',
  'bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-300',
]
const dt = (s) => (s ? new Date(s).toLocaleString('uz') : '')
// Guruh jadvalidagi oynalar: kun ichida birinchi va oxirgi dars ORASIDAGI bo'sh katak (qat'iy taqiqlangan)
const gapCells = (grid) => {
  const cells = new Set()
  grid.days.forEach((_, di) => {
    const busy = grid.grid.map((row, pi) => (row[di] ? pi : -1)).filter((pi) => pi >= 0)
    for (let pi = busy[0] + 1; pi < busy[busy.length - 1]; pi++) {
      if (!grid.grid[pi][di]) cells.add(`${pi}:${di}`)
    }
  })
  return cells
}
// Darsni ko'chirishda katak holati: ok — mumkin, warn — mumkin, lekin ogohlantirish bilan
// (oyna paydo bo'ladi / o'qituvchi istisnosiga zid), busy — band (tashlab bo'lmaydi)
const HINT_STYLES = {
  ok: 'bg-emerald-500/10 ring-2 ring-inset ring-emerald-500/50',
  warn: 'bg-amber-500/10 ring-2 ring-inset ring-amber-500/50',
  busy: 'bg-red-500/5 cursor-not-allowed',
  current: 'ring-2 ring-inset ring-brand/60',
}
const HINT_TARGET = {
  ok: 'bg-emerald-500/25 ring-emerald-500',
  warn: 'bg-amber-500/25 ring-amber-500',
}
// Har bir juftlikning real soati — server/src/engine/timeslots.js'dagi PAIR_TIMES bilan
// bir xil bo'lishi shart (1-indeksli: PAIR_TIMES[pair-1]).
const PAIR_TIMES = ['8:00–9:20', '9:30–10:50', '11:30–12:50', '13:00–14:20', '14:30–15:50', '16:00–17:20']

export default function Schedule() {
  const [runs, setRuns] = useState([])
  const [runId, setRunId] = useState(null)
  const [groups, setGroups] = useState([])
  const [groupId, setGroupId] = useState(null)
  const [grid, setGrid] = useState(null)
  const [avail, setAvail] = useState(null) // o'qituvchilar bandlik matritsasi
  const [roomAvail, setRoomAvail] = useState(null) // xonalar bandlik matritsasi
  const [viewMode, setViewMode] = useState('group') // 'group' | 'teachers' | 'rooms'
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // Qo'lda tahrirlash (faqat Super Admin)
  const [refs, setRefs] = useState({ subjects: [], teachers: [], rooms: [] })
  const [editCell, setEditCell] = useState(null) // { id|null, day, pair }
  const [editForm, setEditForm] = useState(null) // { subjectId, teacherId, roomId, day, pair }
  const [editErr, setEditErr] = useState('')
  const [saving, setSaving] = useState(false)
  // Darsni ko'chirish: sichqoncha bilan sudrash (mode 'drag') yoki tahrirlash oynasidagi
  // "Boshqa katakka ko'chirish" tugmasi (mode 'pick' — keyin katak bosiladi)
  const [moving, setMoving] = useState(null) // { entryId, from: 'pi:di', mode, label, hints }
  const [dropTarget, setDropTarget] = useState(null) // sudralayotgan dars ustidagi katak 'pi:di'
  const [moveBusy, setMoveBusy] = useState(false)
  const dropping = useRef(false) // tashlandi, so'rov ketmoqda — dragend ko'chirish holatini tozalamasin
  const gridRef = useRef(null)

  const [tcOpen, setTcOpen] = useState(false) // o'qituvchi istisnolari oynasi
  const [tcFocus, setTcFocus] = useState(null) // tashxisdan ochilganda — shu o'qituvchi
  const [exportOpen, setExportOpen] = useState(false) // jadvalni yuklab olish oynasi
  const [genOpen, setGenOpen] = useState(false)
  const [semester, setSemester] = useState('1')
  const [seconds, setSeconds] = useState(5)
  // Har bir guruhning [BOSHLANISH..TUGASH] juftlik oralig'i: { [groupId]: 1..6 } (real
  // soatlar — PAIR_TIMES). Superadmin har bir guruhni ALOHIDA tanlaydi. null = hali ishga
  // tushmagan (guruhlar yuklangach standart qiymatlar qo'yiladi: 1,2,3-kurs → 1-6 oralig'i
  // to'liq kun, 4-kurs → 1-3 oralig'i).
  const [groupStartPairs, setGroupStartPairs] = useState(null)
  const [groupEndPairs, setGroupEndPairs] = useState(null)
  const [groupFilter, setGroupFilter] = useState('') // guruh ro'yxatida qidirish
  const [diag, setDiag] = useState(null) // "Tekshirish" natijasi (jadval yaratmasdan)
  const [diagBusy, setDiagBusy] = useState(false)
  const [violations, setViolations] = useState(null) // "qattiq buzilish" bosilganda — aniq manzillar
  const [violBusy, setViolBusy] = useState(false)
  const [busy, setBusy] = useState('') // generatsiya davom etayotgan bo'lsa — holat matni
  // Jadval amal qilish sana oralig'i (dan — gacha) — lokalda saqlanadi
  const [date, setDate] = useState(() => localStorage.getItem('smartjadval-schedule-date') || new Date().toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(() => localStorage.getItem('smartjadval-schedule-date-to') || '')

  const role = roleOf()
  const isTeacher = role === ROLES.TEACHER
  const isSuper = role === ROLES.SUPER
  const canGenerate = role === ROLES.SUPER || role === ROLES.OPERATOR

  const run = runs.find((r) => r.id === runId) || null
  const startPairs = groupStartPairs || {}
  const endPairs = groupEndPairs || {}
  const startPairOf = (gid) => startPairs[gid] ?? 1
  const endPairOf = (gid) => endPairs[gid] ?? 6
  const courseNumbers = [...new Set(groups.map((g) => g.course))].sort((a, b) => a - b)
  const filteredGroups = groups
    .filter((g) => !groupFilter || g.name.toLowerCase().includes(groupFilter.toLowerCase()))
    .sort((a, b) => a.course - b.course || a.name.localeCompare(b.name))

  // Boshlang'ich: run'lar ro'yxati + guruhlar. Eng oxirgi tayyor jadval tanlanadi.
  const loadMeta = async (selectId) => {
    setLoading(true)
    try {
      const [rs, gs] = await Promise.all([api('/schedule/runs?all=1'), api('/groups')])
      setRuns(rs); setGroups(gs); setErr('')
      setGroupId((cur) => cur ?? gs[0]?.id ?? null)
      // Standart: 1,2,3-kurs — 1-6 juftlik oralig'i (to'liq kun, ertalabdan), 4-kurs —
      // 1-3 oralig'i (faqat ertalabki qism). Superadmin kerak bo'lsa har birini (yoki
      // butun kursni) o'zi o'zgartiradi.
      setGroupStartPairs((cur) => cur ?? Object.fromEntries(gs.map((g) => [g.id, 1])))
      setGroupEndPairs((cur) => cur ?? Object.fromEntries(gs.map((g) => [g.id, g.course === 4 ? 3 : 6])))
      const active = rs.filter((r) => !r.archived)
      const pick = selectId ?? (active.find((r) => r.status === 'done') || active[0] || rs[0])?.id ?? null
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
    setViolations(null)
    setMoving(null)
    if (!runId) { setGrid(null); setAvail(null); setRoomAvail(null); return }
    let alive = true
    // O'qituvchilar bandligi ko'rinishi (faqat o'qituvchi bo'lmagan rollar uchun)
    if (!isTeacher && viewMode === 'teachers') {
      api(`/schedule/runs/${runId}/teacher-availability`)
        .then((a) => { if (alive) { setAvail(a); setErr('') } })
        .catch((e) => { if (alive) { setErr(e.message); setAvail(null) } })
      return () => { alive = false }
    }
    // Xonalar bandligi ko'rinishi
    if (!isTeacher && viewMode === 'rooms') {
      api(`/schedule/runs/${runId}/room-availability`)
        .then((a) => { if (alive) { setRoomAvail(a); setErr('') } })
        .catch((e) => { if (alive) { setErr(e.message); setRoomAvail(null) } })
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

  // Jadval YARATMASDAN joriy ma'lumotdagi cheklov buzilishlarini tekshirish
  const runDiagnose = async () => {
    setDiagBusy(true); setErr('')
    try {
      const r = await api('/schedule/diagnose', {
        method: 'POST', body: { semester: Number(semester), groupStartPairs: startPairs, groupEndPairs: endPairs },
      })
      setDiag(r)
    } catch (e) { setErr(e.message) } finally { setDiagBusy(false) }
  }

  // "qattiq buzilish: N" bosilganda — aniq qaysi kun/juftlikda guruh/o'qituvchi/xona
  // to'qnashganini ko'rsatadi (yopiq bo'lsa ochadi, ochiq bo'lsa yopadi)
  const toggleViolations = async () => {
    if (violations) { setViolations(null); return }
    if (!runId) return
    setViolBusy(true); setErr('')
    try {
      const r = await api(`/schedule/runs/${runId}/violations`)
      setViolations(r.violations)
    } catch (e) { setErr(e.message) } finally { setViolBusy(false) }
  }

  // Bitta guruhning boshlanish juftligini o'zgartiradi
  const setGroupStart = (gid, pair) => {
    setGroupStartPairs((prev) => ({ ...(prev || {}), [gid]: pair }))
  }
  // Butun kursdagi barcha guruhlarni bir zumda shu juftlikка qo'yish (tezkor ko'p tanlov)
  const setCourseStart = (course, pair) => {
    const courseGroups = groups.filter((g) => g.course === course)
    setGroupStartPairs((prev) => {
      const next = { ...(prev || {}) }
      for (const g of courseGroups) next[g.id] = pair
      return next
    })
  }
  // Bitta guruhning tugash juftligini o'zgartiradi
  const setGroupEnd = (gid, pair) => {
    setGroupEndPairs((prev) => ({ ...(prev || {}), [gid]: pair }))
  }
  // Butun kursdagi barcha guruhlarni bir zumda shu juftlikда tugatish (tezkor ko'p tanlov)
  const setCourseEnd = (course, pair) => {
    const courseGroups = groups.filter((g) => g.course === course)
    setGroupEndPairs((prev) => {
      const next = { ...(prev || {}) }
      for (const g of courseGroups) next[g.id] = pair
      return next
    })
  }

  // Jadval yaratish: generate → done bo'lguncha poll → natijani ko'rsatish.
  const generate = async () => {
    setGenOpen(false); setBusy('Boshlanmoqda…'); setErr('')
    try {
      const { runId: newId } = await api('/schedule/generate', {
        method: 'POST', body: { semester: Number(semester), maxMs: Number(seconds) * 1000, groupStartPairs: startPairs, groupEndPairs: endPairs },
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
  // Har tahrirdan keyin: jadval, "qattiq buzilish" soni va (ochiq bo'lsa) buzilishlar ro'yxati yangilanadi
  const afterEdit = async (score) => {
    await reloadGroupGrid()
    try {
      const s = score || await api(`/schedule/runs/${runId}/score`)
      setRuns((rs) => rs.map((r) => (r.id === runId
        ? { ...r, hardScore: s.hardScore, report: { ...(r.report || {}), breakdown: s.breakdown } }
        : r)))
      if (violations) setViolations((await api(`/schedule/runs/${runId}/violations`)).violations)
    } catch { /* ball keyingi yangilashda ko'rinadi */ }
  }

  const startMove = async (entryId, pi, di, mode, label) => {
    setMoving({ entryId, from: `${pi}:${di}`, mode, label, hints: null })
    try {
      const hints = await api(`/schedule/runs/${runId}/entries/${entryId}/moves`)
      setMoving((m) => (m && m.entryId === entryId ? { ...m, hints } : m))
    } catch (e) {
      setErr(e.message)
      setMoving(null)
    }
  }
  const hintAt = (pi, di) => moving?.hints?.cells?.[pi]?.[di]
  const canDropAt = (pi, di) => {
    const hint = hintAt(pi, di)
    // maslahat hali kelmagan bo'lsa ham urinib ko'ramiz — server baribir tekshiradi
    return !!moving && moving.from !== `${pi}:${di}` && hint?.status !== 'busy'
  }
  const doMove = async (pi, di) => {
    const m = moving
    if (!m || !canDropAt(pi, di)) return
    dropping.current = true
    setMoveBusy(true); setErr('')
    try {
      const r = await api(`/schedule/runs/${runId}/entries/${m.entryId}/move`, { method: 'POST', body: { day: di, pair: pi + 1 } })
      setMoving(null)
      await afterEdit(r)
    } catch (e) {
      setErr(e.message)
      if (m.mode === 'drag') setMoving(null) // sudrash tugadi — "tanlash" rejimida esa qayta urinish mumkin
    } finally {
      dropping.current = false
      setMoveBusy(false)
      setDropTarget(null)
    }
  }
  const onCellClick = (cell, pi, di) => {
    if (moving?.mode === 'pick') { doMove(pi, di); return }
    if (isSuper) openCellEdit(cell, pi, di)
  }
  useEffect(() => {
    if (!moving) return
    const onKey = (e) => { if (e.key === 'Escape') setMoving(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moving])

  // Tashxisdan: guruh jadvalini ko'rsatish / o'qituvchi istisnosini ochish
  const showGroup = (gid) => {
    setViewMode('group')
    setGroupId(gid)
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const openTeacherConstraints = (teacherId) => { setTcFocus(teacherId ?? null); setTcOpen(true) }
  const openCellEdit = (cell, pairIndex, dayIndex) => {
    setEditErr('')
    setEditCell({ id: cell?.id ?? null, day: dayIndex, pair: pairIndex + 1 })
    setEditForm({
      subjectId: cell?.subjectId ?? '', teacherId: cell?.teacherId ?? '', roomId: cell?.roomId ?? '',
      day: dayIndex, pair: pairIndex + 1, type: cell?.type ?? 'Amaliy',
    })
  }
  const saveCell = async () => {
    if (!editForm.subjectId || !editForm.teacherId || !editForm.roomId) {
      setEditErr("Fan, o'qituvchi va xonani tanlang"); return
    }
    setSaving(true); setEditErr('')
    const body = {
      groupId: Number(groupId), subjectId: Number(editForm.subjectId), teacherId: Number(editForm.teacherId),
      roomId: Number(editForm.roomId), day: Number(editForm.day), pair: Number(editForm.pair), type: editForm.type || 'Amaliy',
    }
    try {
      if (editCell.id) await api(`/schedule/runs/${runId}/entries/${editCell.id}`, { method: 'PUT', body })
      else await api(`/schedule/runs/${runId}/entries`, { method: 'POST', body })
      await afterEdit()
      setEditCell(null)
    } catch (e) { setEditErr(e.message) } finally { setSaving(false) }
  }
  const deleteCell = async () => {
    if (!editCell?.id) return
    setSaving(true); setEditErr('')
    try {
      await api(`/schedule/runs/${runId}/entries/${editCell.id}`, { method: 'DELETE' })
      await afterEdit()
      setEditCell(null)
    } catch (e) { setEditErr(e.message) } finally { setSaving(false) }
  }

  // Jadvalni ARXIVGA ko'chirish — butunlay o'chmaydi, darslari saqlanadi, tiklash mumkin
  const archiveRun = async () => {
    if (!runId) return
    if (!confirm(`#${runId} jadval arxivga ko'chirilsinmi? Butunlay o'chmaydi — barcha darslari saqlanadi, keyin tiklash mumkin.`)) return
    try {
      await api(`/schedule/runs/${runId}`, { method: 'DELETE' })
      await loadMeta()
      setGrid(null); setAvail(null); setRoomAvail(null)
    } catch (e) { setErr(e.message) }
  }

  // Arxivdan tiklash
  const restoreRun = async () => {
    if (!runId) return
    try {
      await api(`/schedule/runs/${runId}/restore`, { method: 'POST' })
      await loadMeta(runId)
    } catch (e) { setErr(e.message) }
  }

  const statusBadge = (s) => s === 'done' ? <Badge color="green">tayyor</Badge>
    : s === 'failed' ? <Badge color="red">xato</Badge>
      : <Badge color="amber">ishlanmoqda</Badge>

  // O'qituvchi jadvalida oyna yumshoq jarima — qat'iy qoida faqat guruhlar uchun
  const gridGaps = grid && !isTeacher ? gapCells(grid) : new Set()

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
          <select className="input min-w-[240px]" value={runId ?? ''} onChange={(e) => setRunId(Number(e.target.value))}>
            {runs.length === 0 && <option value="">— hali yo'q —</option>}
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.id} · {r.semester}-semestr · {r.entries} dars · {r.status}{r.archived ? ' · ARXIV' : ''}
              </option>
            ))}
          </select>
        </Field>
        {canGenerate && runId && run && (
          run.archived ? (
            <button onClick={restoreRun} title="Arxivdan tiklash"
              className="mb-0.5 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-emerald-600 hover:bg-emerald-500/10">
              <RotateCcw size={15} /> Arxivdan tiklash
            </button>
          ) : (
            <button onClick={archiveRun} title="Jadvalni arxivga ko'chirish (butunlay o'chmaydi)"
              className="mb-0.5 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-slate-500 hover:bg-slate-500/10">
              <Archive size={15} /> Arxivlash
            </button>
          )
        )}
        {isTeacher && <div className="pb-2"><Badge color="blue">Mening jadvalim</Badge></div>}
        {!isTeacher && (
          <div className="pb-2">
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
              {[['group', 'Guruh jadvali'], ['teachers', "O'qituvchilar bandligi"], ['rooms', 'Xonalar bandligi']].map(([v, label]) => (
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
            <div className="min-w-[200px]">
              <SearchableSelect value={groupId ?? ''} onChange={(v) => setGroupId(Number(v))}
                options={groups.map((g) => ({ value: g.id, label: g.name }))}
                emptyLabel="— guruh yo'q —" placeholder="Guruh qidirish..." />
            </div>
          </Field>
        )}
        {canGenerate && (
          <button onClick={() => openTeacherConstraints(null)} title="O'qituvchi istisnolari (kunlar/paralar)"
            className="mb-0.5 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <UserCog size={15} /> O'qituvchi istisnolari
          </button>
        )}
        {canGenerate && (
          <button onClick={runDiagnose} disabled={diagBusy} title="Jadval yaratmasdan ma'lumotdagi cheklov buzilishlarini tekshirish"
            className="mb-0.5 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            {diagBusy ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />} Tekshirish
          </button>
        )}
        {runId && (
          <button onClick={() => setExportOpen(true)} title="Jadvalni yuklab olish"
            className="mb-0.5 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <Download size={15} /> Yuklab olish
          </button>
        )}
        {run && (
          <div className="flex items-center gap-2 pb-2">
            {statusBadge(run.status)}
            <button onClick={toggleViolations} disabled={violBusy} title="Qattiq buzilishlar qayerda ekanini ko'rsatish"
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
                run.hardScore ? 'bg-red-500/15 text-red-500 hover:bg-red-500/25' : 'bg-slate-500/15 text-slate-400 hover:bg-slate-500/25'
              }`}>
              {violBusy && <Loader2 size={11} className="animate-spin" />} qattiq buzilish: {run.hardScore ?? '—'}
            </button>
            <Badge color="blue">yumshoq: {run.softScore ?? '—'}</Badge>
            <span className="text-xs text-slate-400">{dt(run.createdAt)}</span>
          </div>
        )}
      </div>

      {/* "qattiq buzilish" bosilganda — aniq qayerda to'qnashuv borligi */}
      {violations && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Qattiq buzilishlar ({violations.length})
            </span>
            <button onClick={() => setViolations(null)} className="text-xs text-slate-400 hover:text-brand">Yopish</button>
          </div>
          <ScheduleViolations violations={violations} />
        </div>
      )}

      {/* "Tekshirish" natijasi — jadval yaratmasdan ma'lumotdagi muammolar */}
      {diag && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Ma'lumot tekshiruvi ({diag.totalEvents} ta dars · {diag.semester}-semestr)
            </span>
            <button onClick={() => setDiag(null)} className="text-xs text-slate-400 hover:text-brand">Yopish</button>
          </div>
          <ScheduleDiagnostics diagnostics={diag.diagnostics} onTeacherConstraints={openTeacherConstraints}
            onShowGroup={showGroup} onChanged={runDiagnose} />
        </div>
      )}

      {/* Tugagan run "failed" bo'lsa yoki muammolari bo'lsa — aniq sabab */}
      {run && run.report?.diagnostics && (run.status === 'failed' || run.report.unplaced > 0) && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-red-500">
            <XCircle size={15} /> #{run.id} jadval to'liq tuzilmadi — sabablari:
          </div>
          <ScheduleDiagnostics diagnostics={run.report.diagnostics} onTeacherConstraints={openTeacherConstraints}
            onShowGroup={showGroup} />
        </div>
      )}

      {isSuper && viewMode === 'group' && grid && !moving && (
        <p className="mb-2 text-xs text-slate-400">
          💡 Darsni sichqoncha bilan boshqa katakka sudrang — bo'sh joylar rang bilan ko'rsatiladi. Katakni bosib darsni tahrirlang yoki bo'sh katakka yangi dars qo'shing. Tizim to'qnashuvni (band guruh / o'qituvchi / xona) taqiqlaydi.
        </p>
      )}
      {moving && viewMode === 'group' && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
          <span className="inline-flex items-center gap-1.5 font-medium text-brand">
            {moveBusy || !moving.hints ? <Loader2 size={13} className="animate-spin" /> : <Move size={13} />}
            {moving.mode === 'pick' ? "Ko'chirish: yangi katakni bosing" : "Darsni kerakli katakka tashlang"}
            {moving.label && <span className="font-normal text-slate-500">— {moving.label}</span>}
          </span>
          {moving.hints?.groups?.length > 1 && (
            <span className="font-medium text-amber-600 dark:text-amber-400">Potok: {moving.hints.groups.join(', ')} birga ko'chadi</span>
          )}
          <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-emerald-500/40 ring-1 ring-emerald-500" /> bo'sh, oynasiz</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-amber-500/40 ring-1 ring-amber-500" /> mumkin, lekin ogohlantirish bor</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-red-500/20" /> band</span>
          <span className="text-slate-400">Katak ustida turing — sababi ko'rinadi</span>
          <button onClick={() => setMoving(null)} className="ml-auto rounded-md px-2 py-0.5 font-medium text-slate-500 hover:bg-slate-500/10">Bekor (Esc)</button>
        </div>
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
      ) : (!isTeacher && viewMode === 'rooms') ? (
        !roomAvail ? (
          <div className="card p-10 text-center text-slate-400">Yuklanmoqda…</div>
        ) : (
          <RoomAvailability avail={roomAvail} />
        )
      ) : !grid ? (
        <div className="card p-10 text-center text-slate-400">Guruh tanlang yoki jadval yuklanmoqda…</div>
      ) : (
        <div ref={gridRef} className="card scroll-mt-4 overflow-x-auto">
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
                  {row.map((c, di) => {
                    const key = `${pi}:${di}`
                    const hint = moving && hintAt(pi, di)
                    const editable = isSuper && !isTeacher
                    const canDrag = editable && !!c?.id && !moveBusy
                    const hintClass = !hint ? '' : `${HINT_STYLES[hint.status] || ''} ${dropTarget === key ? HINT_TARGET[hint.status] || '' : ''}`
                    return (
                    <td key={di} onClick={editable ? () => onCellClick(c, pi, di) : undefined}
                      title={hint?.reasons?.length ? hint.reasons.join(' · ') : undefined}
                      onDragOver={moving ? (e) => {
                        if (!canDropAt(pi, di)) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        if (dropTarget !== key) setDropTarget(key)
                      } : undefined}
                      onDragLeave={moving ? () => setDropTarget((t) => (t === key ? null : t)) : undefined}
                      onDrop={moving ? (e) => { e.preventDefault(); doMove(pi, di) } : undefined}
                      className={`group h-16 border-b border-l border-slate-200 px-1.5 py-1.5 align-top transition dark:border-slate-800 ${editable && !moving ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40' : ''} ${moving?.mode === 'pick' && hint && hint.status !== 'busy' && hint.status !== 'current' ? 'cursor-pointer' : ''} ${hintClass}`}>
                      {c ? (
                        <div draggable={canDrag}
                          onDragStart={canDrag ? (e) => {
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', String(c.id))
                            startMove(c.id, pi, di, 'drag', `${c.subject || 'Fan'} (${grid.days[di]}, ${pi + 1}-juft)`)
                          } : undefined}
                          onDragEnd={canDrag ? () => {
                            setDropTarget(null)
                            if (!dropping.current) setMoving((m) => (m?.mode === 'drag' ? null : m))
                          } : undefined}
                          className={`rounded-md border px-2 py-1 text-xs ${DAY_COLORS[di % DAY_COLORS.length]} ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} ${moving?.from === key ? 'opacity-60' : ''}`}>
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-semibold">{c.subject || 'Fan'}</span>
                            {c.type && c.type !== 'Amaliy' && (
                              <span className="shrink-0 rounded px-1 text-[10px] font-medium opacity-80" title={c.type}>
                                {c.type === 'Maʼruza' ? "Ma'r" : 'Sem'}
                              </span>
                            )}
                          </div>
                          <div className="opacity-80">{c.teacher || c.group || ''}</div>
                          {c.room && <div className="opacity-70">{c.room}</div>}
                        </div>
                      ) : hint ? (
                        <div className={`flex h-full items-center justify-center text-center text-[11px] leading-tight ${
                          hint.status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : hint.status === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-red-400/80'
                        }`}>
                          {hint.status === 'ok' ? (hint.reasons[0] || "bo'sh") : hint.reasons[0]}
                        </div>
                      ) : gridGaps.has(key) ? (
                        <div className="flex h-full items-center justify-center rounded-md border border-dashed border-orange-500/50 bg-orange-500/10 text-xs font-medium text-orange-600 dark:text-orange-300"
                          title="Darslar orasidagi bo'sh juftlik — oyna bo'lmasligi kerak">
                          oyna{isSuper && !moving && <span className="ml-1 opacity-0 transition group-hover:opacity-100">· + dars</span>}
                        </div>
                      ) : isSuper && !moving ? (
                        <div className="flex h-full items-center justify-center text-xs text-slate-300 opacity-0 transition group-hover:opacity-100 dark:text-slate-600">+ dars</div>
                      ) : null}
                    </td>
                    )
                  })}
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
            Engine barcha guruhlar uchun haftalik jadvalni avtomatik tuzadi. To'qnashuv hech qachon bo'lmaydi: bir vaqtda bitta xonada bitta
            dars, o'qituvchi bitta guruh va xonada, guruh bitta darsda. To'qnashuvsiz joy topilmagan dars jadvalga qo'yilmaydi va sababi
            ko'rsatiladi. Keyingi ustuvorlik — oynalarni imkon qadar kamaytirish, so'ng yumshoq qoidalar.
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
          <Field label="Juftlik oralig'i — kurs bo'yicha tezkor tanlash">
            <div className="space-y-1.5">
              {courseNumbers.map((c) => {
                const courseGroups = groups.filter((g) => g.course === c)
                const uniformStart = new Set(courseGroups.map((g) => startPairOf(g.id)))
                const uniformEnd = new Set(courseGroups.map((g) => endPairOf(g.id)))
                const startValue = uniformStart.size === 1 ? [...uniformStart][0] : ''
                const endValue = uniformEnd.size === 1 ? [...uniformEnd][0] : ''
                return (
                  <div key={c} className="flex items-center gap-2">
                    <span className="w-16 text-sm text-slate-500 dark:text-slate-400">{c}-kurs</span>
                    <select className="input" value={startValue}
                      onChange={(e) => setCourseStart(c, Number(e.target.value))}>
                      {startValue === '' && <option value="" disabled>— turlicha —</option>}
                      {PAIR_TIMES.map((t, i) => (
                        <option key={i} value={i + 1}>{i + 1}-juftlikdan ({t})</option>
                      ))}
                    </select>
                    <span className="text-xs text-slate-400">—</span>
                    <select className="input" value={endValue}
                      onChange={(e) => setCourseEnd(c, Number(e.target.value))}>
                      {endValue === '' && <option value="" disabled>— turlicha —</option>}
                      {PAIR_TIMES.map((t, i) => (
                        <option key={i} value={i + 1}>{i + 1}-juftlikkacha ({t})</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Guruh tanlangan oraliqdan TASHQARIGA hech qachon qo'yilmaydi (qat'iy). Oyna — kun ichida darslar orasidagi bo'sh juftlik — QAT'IY taqiqlangan (to'qnashuvdan keyingi eng yuqori ustuvorlik); kun kechroq boshlanishi faqat jarima bilan cheklanadi. Kunlik dars soni 2 tadan kam, 4 tadan ko'p bo'lmaydi. Kurs qatori shu kursdagi barcha guruhlarni birdan belgilaydi — pastda har bir guruhni alohida ham o'zgartirish mumkin.
            </p>
          </Field>
          <Field label="Guruh bo'yicha alohida">
            <input className="input mb-2" placeholder="Guruh qidirish…" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} />
            <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5 dark:border-slate-700">
              {filteredGroups.length === 0 && <p className="px-2 py-1 text-xs text-slate-400">Guruh topilmadi</p>}
              {filteredGroups.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span>{g.name} <span className="text-xs text-slate-400">({g.course}-kurs)</span></span>
                  <div className="flex items-center gap-1">
                    <select className="input h-8 w-auto py-0 text-xs" value={startPairOf(g.id)}
                      onChange={(e) => setGroupStart(g.id, Number(e.target.value))}>
                      {PAIR_TIMES.map((t, i) => (
                        <option key={i} value={i + 1}>{t}</option>
                      ))}
                    </select>
                    <span className="text-xs text-slate-400">—</span>
                    <select className="input h-8 w-auto py-0 text-xs" value={endPairOf(g.id)}
                      onChange={(e) => setGroupEnd(g.id, Number(e.target.value))}>
                      {PAIR_TIMES.map((t, i) => (
                        <option key={i} value={i + 1}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
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
              <SearchableSelect value={editForm.subjectId} onChange={(v) => setEditForm({ ...editForm, subjectId: v })}
                options={refs.subjects.map((s) => ({ value: s.id, label: s.name }))}
                emptyLabel="— tanlang —" placeholder="Fan qidirish..." />
            </Field>
            <Field label="O'qituvchi">
              <SearchableSelect value={editForm.teacherId} onChange={(v) => setEditForm({ ...editForm, teacherId: v })}
                options={refs.teachers.map((t) => ({ value: t.id, label: t.fullName }))}
                emptyLabel="— tanlang —" placeholder="F.I.Sh. qidirish..." />
            </Field>
            <Field label="Xona">
              <SearchableSelect value={editForm.roomId} onChange={(v) => setEditForm({ ...editForm, roomId: v })}
                options={refs.rooms.map((r) => ({ value: r.id, label: r.name }))}
                emptyLabel="— tanlang —" placeholder="Xona qidirish..." />
            </Field>
            <Field label="Dars turi">
              <select className="input" value={editForm.type || 'Amaliy'} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                {['Maʼruza', 'Seminar', 'Amaliy'].map((v) => <option key={v} value={v}>{v}</option>)}
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
              <div className="flex items-center gap-1">
                {editCell?.id && (
                  <button className="btn-ghost text-red-500 hover:bg-red-500/10" onClick={deleteCell} disabled={saving}>O'chirish</button>
                )}
                {editCell?.id && (
                  <button className="btn-ghost" disabled={saving} title="Bo'sh joylarni ko'rsatib, darsni boshqa katakka o'tkazish"
                    onClick={() => {
                      const cell = grid?.grid?.[editCell.pair - 1]?.[editCell.day]
                      setEditCell(null)
                      startMove(editCell.id, editCell.pair - 1, editCell.day, 'pick', `${cell?.subject || 'Fan'} (${grid?.days?.[editCell.day]}, ${editCell.pair}-juft)`)
                    }}>
                    <Move size={15} /> Ko'chirish
                  </button>
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

      <TeacherConstraintsModal open={tcOpen} focusTeacherId={tcFocus} onClose={() => { setTcOpen(false); setTcFocus(null) }} />
      <ScheduleExportModal open={exportOpen} onClose={() => setExportOpen(false)} runId={runId} />
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

// Xonalar bandlik jadvali (bino bo'yicha): qatorlar = xonalar, ustunlar = kun×juftlik.
// Band hujayrada QAYSI GURUH kirishi ko'rinib turadi; hover'da fan + o'qituvchi ham chiqadi.
function RoomAvailability({ avail }) {
  const cols = []
  avail.days.forEach((day, di) => {
    for (let p = 0; p < avail.pairs; p++) cols.push({ di, p, day, first: p === 0 })
  })

  const buildings = [...new Set(avail.rooms.map((r) => r.building))].sort()
  const [q, setQ] = useState('')
  const [bld, setBld] = useState('')
  const query = q.trim().toLowerCase()

  const filtered = avail.rooms.filter((r) => {
    if (bld && r.building !== bld) return false
    if (!query) return true
    return r.name.toLowerCase().includes(query)
      || r.grid.some((row) => row.some((c) => c && (c.group || '').toLowerCase().includes(query)))
  })

  // Bino bo'yicha guruhlash
  const grouped = []
  for (const b of buildings) {
    const rr = filtered.filter((r) => r.building === b)
    if (rr.length) grouped.push({ building: b, rooms: rr })
  }

  if (!avail.rooms.length) {
    return <div className="card p-10 text-center text-slate-400">Xonalar topilmadi.</div>
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3 dark:border-slate-800">
        <input className="input max-w-xs" placeholder="Qidirish: xona nomi yoki guruh…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input h-9 w-auto py-1" value={bld} onChange={(e) => setBld(e.target.value)}>
          <option value="">Barcha binolar</option>
          {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="text-xs text-slate-400">{filtered.length} / {avail.rooms.length} xona</span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th rowSpan={2} className="sticky left-0 z-10 border-b border-slate-200 bg-white px-3 py-2 text-left font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                Xona
              </th>
              {avail.days.map((d) => (
                <th key={d} colSpan={avail.pairs} className="border-b border-l border-slate-300 px-2 py-2 text-center font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">{d}</th>
              ))}
            </tr>
            <tr>
              {cols.map((c) => (
                <th key={`${c.di}-${c.p}`} className={`w-16 border-b border-slate-200 py-1 text-center font-normal text-slate-400 dark:border-slate-800 ${c.first ? 'border-l border-slate-300 dark:border-slate-700' : ''}`}>
                  {c.p + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.flatMap((grp) => [
              (
                <tr key={`b-${grp.building}`}>
                  <td colSpan={1 + cols.length} className="sticky left-0 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                    {grp.building} · {grp.rooms.length} xona
                  </td>
                </tr>
              ),
              ...grp.rooms.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="sticky left-0 z-10 whitespace-nowrap border-b border-slate-100 bg-white px-3 py-1.5 dark:border-slate-800/60 dark:bg-slate-900">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{r.name}</span>
                      <span className="ml-1.5 text-[10px] text-slate-400">{r.capacity} o'rin</span>
                      <span className="ml-1.5 text-[10px] text-emerald-500">{r.free} bo'sh</span>
                    </td>
                    {cols.map((c) => {
                      const cell = r.grid[c.p][c.di]
                      const label = `${c.day} ${c.p + 1}-juft — ${cell
                        ? `${cell.group || ''} · ${cell.subject || ''}${cell.teacher ? ' · ' + cell.teacher : ''}`
                        : "bo'sh"}`
                      return (
                        <td key={`${c.di}-${c.p}`} className={`border-b border-slate-100 p-0.5 dark:border-slate-800/60 ${c.first ? 'border-l border-slate-300 dark:border-slate-700' : ''}`}>
                          <div title={label}
                            className={`flex h-6 items-center justify-center truncate rounded-[3px] px-1 text-[10px] font-medium ${cell ? 'bg-rose-500/85 text-white hover:bg-rose-500' : 'bg-emerald-500/40 hover:bg-emerald-500/60'}`}>
                            {cell ? cell.group || '•' : ''}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
              )),
            ])}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-6 text-center text-sm text-slate-400">"{q}" bo'yicha xona topilmadi</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-[3px] bg-emerald-500/40" /> bo'sh</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-[3px] bg-rose-500/85" /> band — ichida qaysi guruh kirishi yozilgan</span>
        <span className="text-slate-400">Hujayra ustiga borsangiz — guruh + fan + o'qituvchi ko'rinadi</span>
      </div>
    </div>
  )
}
