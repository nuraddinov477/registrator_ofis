import { useState, useEffect } from 'react'
import { BookOpen, FileText, UserCog, ShieldCheck, Plus, Pencil, Trash2, Archive, RotateCcw } from 'lucide-react'
import { db, useCollection, useIsLoading, useLoadFailed, retry } from '../data/store'
import { api, auth } from '../api/client'
import { canWrite, assignableRoles, writableSections, visibleSections, SECTION_LABELS } from '../lib/access'
import { PageHeader, SearchBar, Table, Modal, Field, Badge, SearchableSelect, DataState } from '../components/ui'

/* ---------- O'quv yuklamasi ---------- */
export function Loads() {
  const loads = useCollection('loads')
  const subjects = useCollection('subjects')
  const teachers = useCollection('teachers')
  const groups = useCollection('groups')
  const loading = useIsLoading('loads')
  const failed = useLoadFailed('loads')
  const [tab, setTab] = useState('list')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [err, setErr] = useState('')
  const [archived, setArchived] = useState([]) // arxivdagi yuklamalar (kerak bo'lganda yuklanadi)
  const [showArchived, setShowArchived] = useState(false)
  const writable = canWrite('loads')

  const loadArchived = async () => {
    try { setArchived((await api('/workloads?all=1')).filter((w) => w.archived)) } catch { /* jim */ }
  }
  const toggleArchived = () => { if (!showArchived) loadArchived(); setShowArchived((v) => !v) }

  const openAdd = () => { setEditing(null); setForm({}); setErr(''); setOpen(true) }
  const openEdit = (l) => { setEditing(l); setForm({ teacherId: l.teacherId, subjectId: l.subjectId, groupIds: l.groups?.map((x) => x.groupId) || [], semester: l.semester, weeklyHours: l.weeklyHours, type: l.type || 'Amaliy' }); setErr(''); setOpen(true) }
  const save = async (e) => {
    e.preventDefault()
    setErr('')
    try {
      if (editing) await db.update('loads', editing.id, form)
      else await db.add('loads', form)
      setOpen(false); setForm({}); setEditing(null)
    } catch (e) { setErr(e.message || 'Saqlashda xatolik') }
  }
  // Yuklama HECH QACHON butunlay o'chmaydi — faqat arxivga ko'chadi, kerak bo'lsa tiklanadi
  const archive = async (l) => {
    if (!confirm("Bu yuklama arxivga ko'chirilsinmi? Butunlay o'chmaydi, keyin tiklash mumkin.")) return
    try { await db.remove('loads', l.id); if (showArchived) loadArchived() } catch (e) { alert(e.message || "Arxivlashda xatolik") }
  }
  const restore = async (l) => {
    try { await api(`/workloads/${l.id}/restore`, { method: 'POST' }); retry('loads'); loadArchived() } catch (e) { alert(e.message || "Tiklashda xatolik") }
  }
  const nm = (coll, id) => db.get(coll).find((x) => x.id === Number(id))?.name || db.get(coll).find((x) => x.id === Number(id))?.fullName || '—'
  const filteredLoads = loads.filter((l) => Object.values(l).join(' ').toLowerCase().includes(q.toLowerCase()))
  const filteredArchived = showArchived ? archived.filter((l) => Object.values(l).join(' ').toLowerCase().includes(q.toLowerCase())) : []
  const displayRows = [...filteredLoads, ...filteredArchived]
  const typeColor = (t) => (t === 'Maʼruza' ? 'blue' : t === 'Seminar' ? 'amber' : 'gray')

  return (
    <div>
      <PageHeader title="O'quv yuklamasi" count={loads.length}
        action={writable ? <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Qo'shish</button> : null} />
      <SearchBar value={q} onChange={setQ} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/60">
          {[['list', "Yuklama ro'yxati"], ['teacher', "O'qituvchi yuklamasi"]].map(([id, l]) => (
            <button key={id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === id ? 'bg-brand text-white' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
        {tab === 'list' && writable && (
          <button onClick={toggleArchived} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <Archive size={15} /> {showArchived ? 'Arxivni yashirish' : 'Arxivni ko\'rsatish'}
          </button>
        )}
      </div>
      {(loading || failed) && loads.length === 0 ? (
        <DataState loading={loading} onRetry={() => retry('loads')} />
      ) : tab === 'teacher' ? (
        <TeacherLoadsView loads={filteredLoads} nm={nm} />
      ) : (
      <Table
        columns={writable ? ['Oʻqituvchi', 'Fan', 'Turi', 'Guruh', 'Sem', 'Fan soati', 'Reyting', 'Jami', 'Amallar'] : ['Oʻqituvchi', 'Fan', 'Turi', 'Guruh', 'Sem', 'Fan soati', 'Reyting', 'Jami']}
        rows={displayRows}
        empty="Maʼlumot topilmadi"
        renderRow={(l) => {
          // Fan soati — shu yuklamaning o'zida (weeklyHours, guruhlar soniga qaramasdan BIR MARTA);
          // Reyting — potokdagi BARCHA guruhlar talabalari YIG'INDISI × 0.8
          const lgroups = l.groups || []
          const totalStudents = lgroups.reduce((s, x) => s + (x.group?.size || 0), 0)
          const rating = lgroups.length ? Math.round(totalStudents * 0.8 * 10) / 10 : null
          const total = Math.round(((l.weeklyHours || 0) + (rating || 0)) * 10) / 10
          return (
          <tr key={l.id} className={`border-b border-slate-100 last:border-0 dark:border-slate-800/60 ${l.archived ? 'opacity-60' : ''}`}>
            <td className="px-4 py-3">{nm('teachers', l.teacherId)}</td>
            <td className="px-4 py-3">{nm('subjects', l.subjectId)}</td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-1">
                <Badge color={typeColor(l.type)}>{l.type || 'Amaliy'}</Badge>
                {l.archived && <Badge color="gray">Arxiv</Badge>}
              </div>
            </td>
            <td className="px-4 py-3">{lgroups.map((x) => x.group?.name).filter(Boolean).join(', ') || '—'}</td>
            <td className="px-4 py-3">{l.semester}</td>
            <td className="px-4 py-3">{l.weeklyHours ?? '—'}</td>
            <td className="px-4 py-3">{rating ?? '—'}</td>
            <td className="px-4 py-3 font-semibold">{total}</td>
            {writable && (
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  {l.archived ? (
                    <button onClick={() => restore(l)} title="Arxivdan tiklash" className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/40"><RotateCcw size={15} /></button>
                  ) : (
                    <>
                      <button onClick={() => openEdit(l)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-800"><Pencil size={15} /></button>
                      <button onClick={() => archive(l)} title="Arxivlash (butunlay o'chmaydi)" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"><Trash2 size={15} /></button>
                    </>
                  )}
                </div>
              </td>
            )}
          </tr>
          )
        }}
      />
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Yuklamani tahrirlash' : "Yuklama qo'shish"}>
        <form onSubmit={save} className="space-y-4">
          <Field label="Oʻqituvchi">
            <SearchableSelect value={form.teacherId || ''} onChange={(v) => setForm({ ...form, teacherId: v })}
              options={teachers.map((t) => ({ value: t.id, label: t.fullName }))} placeholder="O'qituvchi qidirish..." />
          </Field>
          <Field label="Fan">
            <SearchableSelect value={form.subjectId || ''} onChange={(v) => setForm({ ...form, subjectId: v })}
              options={subjects.map((s) => ({ value: s.id, label: s.name }))} placeholder="Fan qidirish..." />
          </Field>
          <Field label="Guruh(lar) — potok uchun bir nechtasini tanlash mumkin">
            <SearchableSelect multi value={form.groupIds || []} onChange={(v) => setForm({ ...form, groupIds: v })}
              options={groups.map((g) => ({ value: g.id, label: g.name }))} placeholder="Guruh qidirish..." />
          </Field>
          <Field label="Semestr"><input className="input" type="number" value={form.semester || ''} onChange={(e) => setForm({ ...form, semester: e.target.value })} /></Field>
          <Field label="Fan soati (haftalik)"><input className="input" type="number" value={form.weeklyHours ?? ''} onChange={(e) => setForm({ ...form, weeklyHours: e.target.value })} /></Field>
          <Field label="Dars turi">
            <select className="input" value={form.type || 'Amaliy'} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {['Maʼruza', 'Seminar', 'Amaliy'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <p className="text-xs text-slate-400">Fan soati guruhlar soniga ko'paytirilmaydi (bir dars, birga o'tiladi). Reyting — tanlangan barcha guruhlar talabalari yig'indisidan avtomatik hisoblanadi (× 0.8). Bitta fan alohida ma'ruza va seminar yuklamasiga bo'linishi mumkin — jadval tuzishda ma'ruza doim seminardan oldin, seminar amaliydan oldin joylashtiriladi.</p>
          {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{err}</div>}
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Bekor</button><button type="submit" className="btn-primary">Saqlash</button></div>
        </form>
      </Modal>
    </div>
  )
}

// O'qituvchi bo'yicha guruhlangan ko'rinish — kim qancha band ekanini bir qarashda ko'rish uchun
function TeacherLoadsView({ loads, nm }) {
  const byTeacher = new Map()
  for (const l of loads) {
    if (!byTeacher.has(l.teacherId)) byTeacher.set(l.teacherId, [])
    byTeacher.get(l.teacherId).push(l)
  }
  const teachers = [...byTeacher.entries()]
    .map(([teacherId, items]) => ({
      teacherId, items,
      name: nm('teachers', teacherId),
      totalHours: items.reduce((s, l) => s + (l.weeklyHours || 0), 0),
    }))
    .sort((a, b) => b.totalHours - a.totalHours || a.name.localeCompare(b.name))

  if (teachers.length === 0) {
    return <div className="card p-10 text-center text-slate-400">Maʼlumot topilmadi</div>
  }

  const loadColor = (h) => (h >= 20 ? 'red' : h >= 14 ? 'amber' : 'green')

  return (
    <div className="space-y-3">
      {teachers.map((t) => (
        <div key={t.teacherId} className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-slate-800 dark:text-slate-100">{t.name}</span>
            <Badge color={loadColor(t.totalHours)}>{t.totalHours} soat/hafta</Badge>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {t.items.map((l) => (
              <div key={l.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  {nm('subjects', l.subjectId)}
                  <Badge color={l.type === 'Maʼruza' ? 'blue' : l.type === 'Seminar' ? 'amber' : 'gray'}>{l.type || 'Amaliy'}</Badge>
                  <span className="text-slate-400"> — {(l.groups || []).map((x) => x.group?.name).filter(Boolean).join(', ') || '—'}</span>
                </span>
                <span className="shrink-0 text-slate-400">{l.weeklyHours ?? '—'} soat</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- Talabnomalar (kafedralararo ariza — real backend) ---------- */
export function Requests() {
  const me = auth.user()
  const [items, setItems] = useState([])
  const [refs, setRefs] = useState({ departments: [], teachers: [], subjects: [], rooms: [] })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('all')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({})
  const [respond, setRespond] = useState(null) // javob beriladigan ariza
  const [note, setNote] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [reqs, departments, teachers, subjects, rooms] = await Promise.all([
        api('/requests'), api('/departments'), api('/teachers'), api('/subjects'), api('/rooms'),
      ])
      setItems(reqs); setRefs({ departments, teachers, subjects, rooms }); setErr('')
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    if (!form.fromDepartmentId || !form.toDepartmentId) return alert('Kafedralarni tanlang')
    if (form.fromDepartmentId === form.toDepartmentId) return alert("Kafedra o'ziga ariza yubora olmaydi")
    try {
      await api('/requests', { method: 'POST', body: form })
      setOpen(false); setForm({}); load()
    } catch (e) { alert(e.message) }
  }

  const sendResponse = async (decision) => {
    try {
      await api(`/requests/${respond.id}/respond`, { method: 'POST', body: { status: decision, note } })
      setRespond(null); setNote(''); load()
    } catch (e) { alert(e.message) }
  }

  const del = async (r) => {
    if (!confirm(`#${r.id} arizani o'chirilsinmi? (tarixdan ham yo'qoladi)`)) return
    try { await api(`/requests/${r.id}`, { method: 'DELETE' }); load() } catch (e) { alert(e.message) }
  }

  const tabs = [['all', 'Hammasi'], ['pending', 'Kutilmoqda'], ['accepted', 'Qabul qilingan'], ['rejected', 'Rad etilgan']]
  const counts = (s) => items.filter((r) => r.status === s).length
  const shown = tab === 'all' ? items : items.filter((r) => r.status === tab)
  const stBadge = (s) => s === 'accepted' ? <Badge color="green">Qabul qilindi</Badge>
    : s === 'rejected' ? <Badge color="red">Rad etildi</Badge>
      : <Badge color="amber">Kutilmoqda</Badge>
  const dt = (s) => (s ? new Date(s).toLocaleString('uz') : '—')

  return (
    <div>
      <PageHeader title="Talabnomalar" subtitle="Kafedralararo o'qituvchi/dars so'rovlari — butun tarix saqlanadi" icon={FileText}
        count={items.length}
        action={<button className="btn-primary" onClick={() => { setForm({}); setOpen(true) }}><Plus size={16} /> Yangi ariza</button>} />

      {err && <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-500">Xatolik: {err}</div>}

      <div className="mb-4 inline-flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/60">
        {tabs.map(([id, l]) => (
          <button key={id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === id ? 'bg-brand text-white' : 'text-slate-500'}`}>
            {l}{id !== 'all' && counts(id) > 0 ? ` (${counts(id)})` : ''}
          </button>
        ))}
      </div>

      <Table
        columns={['#', 'Kimdan', 'Kimga', "Fan / O'qituvchi", 'Xona', 'Guruhlar', 'Holat', 'Sana', 'Amal']}
        rows={shown}
        empty={loading ? 'Yuklanmoqda...' : "Talabnomalar yo'q"}
        renderRow={(r) => (
          <tr key={r.id} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800/60">
            <td className="px-4 py-3 text-slate-400">#{r.id}</td>
            <td className="px-4 py-3 font-medium">{r.fromDepartment?.name || '—'}</td>
            <td className="px-4 py-3">{r.toDepartment?.name || '—'}</td>
            <td className="px-4 py-3">
              <div>{r.subject?.name || '—'}</div>
              {r.teacher?.fullName && <div className="text-xs text-slate-400">{r.teacher.fullName}</div>}
            </td>
            <td className="px-4 py-3">{r.room?.name || '—'}</td>
            <td className="px-4 py-3">{r.targetGroups || (r.course ? `${r.course}-kurs` : '—')}</td>
            <td className="px-4 py-3">
              {stBadge(r.status)}
              {r.respondedBy && <div className="mt-1 text-xs text-slate-400">{r.respondedBy}{r.responseNote ? `: ${r.responseNote}` : ''}</div>}
            </td>
            <td className="px-4 py-3 text-slate-400">{dt(r.createdAt)}</td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-1">
                {r.status === 'pending'
                  ? <button onClick={() => { setRespond(r); setNote('') }} className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white">Javob</button>
                  : <span className="text-xs text-slate-400">—</span>}
                {me?.role === 'Super Admin' && (
                  <button onClick={() => del(r)} title="O'chirish" className="rounded-md p-1.5 text-slate-400 hover:text-red-500"><Trash2 size={15} /></button>
                )}
              </div>
            </td>
          </tr>
        )}
      />

      {/* Yangi ariza */}
      <Modal open={open} onClose={() => setOpen(false)} title="Yangi ariza — kafedraga so'rov">
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Yuboruvchi kafedra *">
              <SearchableSelect value={form.fromDepartmentId || ''} onChange={(v) => setForm({ ...form, fromDepartmentId: v })}
                options={refs.departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="Kafedra qidirish..." />
            </Field>
            <Field label="Qabul qiluvchi kafedra *">
              <SearchableSelect value={form.toDepartmentId || ''} onChange={(v) => setForm({ ...form, toDepartmentId: v })}
                options={refs.departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="Kafedra qidirish..." />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fan">
              <SearchableSelect value={form.subjectId || ''} onChange={(v) => setForm({ ...form, subjectId: v })}
                options={refs.subjects.map((s) => ({ value: s.id, label: s.name }))} placeholder="Fan qidirish..." />
            </Field>
            <Field label="O'qituvchi">
              <SearchableSelect value={form.teacherId || ''} onChange={(v) => setForm({ ...form, teacherId: v })}
                options={refs.teachers.map((t) => ({ value: t.id, label: t.fullName }))} placeholder="F.I.Sh. qidirish..." />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Xona">
              <SearchableSelect value={form.roomId || ''} onChange={(v) => setForm({ ...form, roomId: v })}
                options={refs.rooms.map((rm) => ({ value: rm.id, label: rm.name }))} placeholder="Xona qidirish..." />
            </Field>
            <Field label="Kurs"><input className="input" type="number" value={form.course || ''} onChange={(e) => setForm({ ...form, course: e.target.value })} /></Field>
            <Field label="Haftalik soat"><input className="input" type="number" value={form.weeklyHours || ''} onChange={(e) => setForm({ ...form, weeklyHours: e.target.value })} /></Field>
          </div>
          <Field label="Guruhlar"><input className="input" placeholder="masalan: IT-21, IT-22" value={form.targetGroups || ''} onChange={(e) => setForm({ ...form, targetGroups: e.target.value })} /></Field>
          <Field label="Izoh / so'rov matni"><textarea className="input" rows={3} value={form.message || ''} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Bekor</button>
            <button type="submit" className="btn-primary">Yuborish</button>
          </div>
        </form>
      </Modal>

      {/* Javob berish */}
      <Modal open={!!respond} onClose={() => setRespond(null)} title={`Arizaga javob — #${respond?.id || ''}`}>
        {respond && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800/60">
              <div><b>{respond.fromDepartment?.name}</b> → <b>{respond.toDepartment?.name}</b></div>
              {respond.subject?.name && <div className="mt-1">Fan: {respond.subject.name}{respond.teacher?.fullName ? ` · ${respond.teacher.fullName}` : ''}</div>}
              <div className="mt-1 text-slate-500 dark:text-slate-400">{respond.message || '—'}</div>
            </div>
            <Field label="Javob izohi (ixtiyoriy)"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setRespond(null)}>Bekor</button>
              <button className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600" onClick={() => sendResponse('rejected')}>Rad etish</button>
              <button className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600" onClick={() => sendResponse('accepted')}>Qabul qilish</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ---------- Foydalanuvchilar (rol delegatsiyasi + per-user cheklovlar) ---------- */
const emptyRestr = () => ({ readOnly: false, denyWrite: [], denyRead: [] })
const parseRestr = (raw) => {
  if (!raw) return emptyRestr()
  try { const r = typeof raw === 'string' ? JSON.parse(raw) : raw; return { readOnly: !!r.readOnly, denyWrite: r.denyWrite || [], denyRead: r.denyRead || [] } }
  catch { return emptyRestr() }
}

export function UsersPage() {
  const users = useCollection('users')
  const faculties = useCollection('faculties')
  const departments = useCollection('departments')
  const teachers = useCollection('teachers')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})

  const me = auth.user()
  const isSuper = me?.role === 'Super Admin'
  const assignable = assignableRoles(me)
  // Birlik tanlovlari — yaratuvchi doirasiga cheklangan
  const deptOptions = isSuper ? departments : departments.filter((d) => d.facultyId === me?.facultyId)
  const teacherOptions = isSuper ? teachers
    : me?.role === 'Kafedra mudiri' ? teachers.filter((t) => t.departmentId === me?.departmentId)
      : teachers.filter((t) => t.department?.facultyId === me?.facultyId)

  const openAdd = () => { setEditing(null); setForm({ login: '', fullName: '', email: '', role: assignable[0] || 'Oʻqituvchi', active: true, password: '', facultyId: '', departmentId: '', teacherId: '', restrictions: emptyRestr() }); setOpen(true) }
  const openEdit = (u) => { setEditing(u); setForm({ ...u, password: '', restrictions: parseRestr(u.restrictions) }); setOpen(true) }
  const save = (e) => { e.preventDefault(); editing ? db.update('users', editing.id, form) : db.add('users', form); setOpen(false) }

  // Cheklov yordamchilari
  const setR = (patch) => setForm((f) => ({ ...f, restrictions: { ...emptyRestr(), ...(f.restrictions || {}), ...patch } }))
  const toggleR = (key, val) => setForm((f) => {
    const cur = f.restrictions || emptyRestr()
    const set = new Set(cur[key] || [])
    set.has(val) ? set.delete(val) : set.add(val)
    return { ...f, restrictions: { ...cur, [key]: [...set] } }
  })
  const restr = form.restrictions || emptyRestr()
  const hasRestr = (u) => { const r = parseRestr(u.restrictions); return r.readOnly || r.denyWrite.length || r.denyRead.length }

  // Ro'yxat: Super Admin hammani, boshqalar faqat o'zi boshqara oladigan rollarni ko'radi
  const manageable = isSuper ? users : users.filter((u) => assignable.includes(u.role))
  const rows = manageable.filter((u) => Object.values(u).join(' ').toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <PageHeader title="Foydalanuvchilar" count={manageable.length}
        action={canWrite('users') ? <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Qo'shish</button> : null} />
      <SearchBar value={q} onChange={setQ} />
      <Table columns={['Login', 'F.I', 'Email', 'Rol', 'Holat', 'Amallar']}
        rows={rows}
        renderRow={(u) => (
          <tr key={u.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
            <td className="px-4 py-3"><Badge color="gray">{u.login}</Badge></td>
            <td className="px-4 py-3 font-medium">{u.fullName}</td>
            <td className="px-4 py-3">{u.email || '—'}</td>
            <td className="px-4 py-3">
              {u.role === 'Super Admin' ? <Badge>Super Admin</Badge> : u.role}
              {hasRestr(u) ? <Badge color="amber">cheklangan</Badge> : null}
            </td>
            <td className="px-4 py-3"><Badge color={u.active ? 'green' : 'gray'}>{u.active ? 'Faol' : 'Nofaol'}</Badge></td>
            <td className="px-4 py-3"><div className="flex gap-1">
              <button onClick={() => openEdit(u)} className="rounded-md p-1.5 text-slate-400 hover:text-brand"><Pencil size={15} /></button>
              <button onClick={() => confirm("O'chirilsinmi?") && db.remove('users', u.id)} className="rounded-md p-1.5 text-slate-400 hover:text-red-500"><Trash2 size={15} /></button>
            </div></td>
          </tr>
        )} />
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Foydalanuvchi tahrirlash' : "Foydalanuvchi qo'shish"}>
        <form onSubmit={save} className="space-y-4">
          <Field label="Login"><input className="input" required value={form.login || ''} onChange={(e) => setForm({ ...form, login: e.target.value })} /></Field>
          <Field label="F.I"><input className="input" required value={form.fullName || ''} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <Field label="Email"><input className="input" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Rol"><select className="input" value={form.role || ''} onChange={(e) => setForm({ ...form, role: e.target.value, facultyId: '', departmentId: '', teacherId: '' })}>{assignable.map((r) => <option key={r}>{r}</option>)}</select></Field>
          {/* Rol qamrovi: userni o'z birligiga biriktirish (scoping shu asosda ishlaydi) */}
          {form.role === 'Fakultet operatori' && isSuper && (
            <Field label="Fakultet (biriktirish)">
              <SearchableSelect value={form.facultyId || ''} onChange={(v) => setForm({ ...form, facultyId: v })}
                options={faculties.map((f) => ({ value: f.id, label: f.name }))} placeholder="Fakultet qidirish..." />
            </Field>
          )}
          {form.role === 'Kafedra mudiri' && (
            <Field label="Kafedra (biriktirish)">
              <SearchableSelect value={form.departmentId || ''} onChange={(v) => setForm({ ...form, departmentId: v })}
                options={deptOptions.map((d) => ({ value: d.id, label: d.faculty ? `${d.name} — ${d.faculty.name}` : d.name }))} placeholder="Kafedra qidirish..." />
            </Field>
          )}
          {form.role === 'Oʻqituvchi' && (
            <Field label="O'qituvchi yozuvi (biriktirish)">
              <SearchableSelect value={form.teacherId || ''} onChange={(v) => setForm({ ...form, teacherId: v })}
                options={teacherOptions.map((t) => ({ value: t.id, label: t.department ? `${t.fullName} — ${t.department.name}` : t.fullName }))} placeholder="F.I.Sh. qidirish..." />
            </Field>
          )}
          <Field label={editing ? 'Yangi parol' : 'Parol'}>
            <input className="input" type="password" required={!editing} value={form.password || ''}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={editing ? "bo'sh qoldirsangiz o'zgarmaydi" : 'kamida 4 belgi'} />
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Faol</label>

          {/* Shaxsiy cheklovlar — faqat Super Admin, Super Admin bo'lmagan userlar uchun */}
          {isSuper && form.role && form.role !== 'Super Admin' && (
            <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Cheklovlar (ixtiyoriy)</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!restr.readOnly} onChange={(e) => setR({ readOnly: e.target.checked })} />
                Faqat ko'rish — hech narsa o'zgartira olmaydi
              </label>
              {!restr.readOnly && writableSections(form.role).length > 0 && (
                <div>
                  <div className="mb-1 text-xs text-slate-500">Yozishni taqiqlash:</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {writableSections(form.role).map((s) => (
                      <label key={s} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={restr.denyWrite.includes(s)} onChange={() => toggleR('denyWrite', s)} />
                        {SECTION_LABELS[s] || s}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="mb-1 text-xs text-slate-500">Bo'limlarni butunlay yashirish:</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {visibleSections(form.role).map((s) => (
                    <label key={s} className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={restr.denyRead.includes(s)} onChange={() => toggleR('denyRead', s)} />
                      {SECTION_LABELS[s] || s}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Bekor</button><button type="submit" className="btn-primary">Saqlash</button></div>
        </form>
      </Modal>
    </div>
  )
}

/* ---------- Audit logi ---------- */
export function Audit() {
  const audit = useCollection('audit')
  const [q, setQ] = useState('')
  const me = auth.user()
  const isSuperAdmin = me?.role === 'Super Admin'

  const clearAll = async () => {
    if (!confirm(`Butun tarix (${audit.length} ta yozuv) o'chiriladi. Bu amalni qaytarib bo'lmaydi. Davom etilsinmi?`)) return
    try { await db.clear('audit') } catch (e) { alert(e.message) }
  }

  const columns = ['Vaqt', 'Foydalanuvchi', 'Amal', "Bo'lim", 'Tafsilot', 'IP']
  if (isSuperAdmin) columns.push('Amal')

  return (
    <div>
      <PageHeader title="Audit logi" subtitle={`Tizimda qilingan barcha oʻzgartirishlar tarixi — ${audit.length} ta yozuv`} icon={ShieldCheck}
        action={isSuperAdmin && audit.length > 0
          ? <button onClick={clearAll} className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"><Trash2 size={16} /> Tarixni tozalash</button>
          : null} />
      <SearchBar value={q} onChange={setQ} placeholder="Foydalanuvchi yoki maʼlumot..." />
      <Table columns={columns}
        rows={audit.filter((a) => (a.action + a.detail + a.user).toLowerCase().includes(q.toLowerCase()))}
        empty="Yozuvlar topilmadi"
        renderRow={(a) => (
          <tr key={a.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
            <td className="px-4 py-3 text-slate-400">{new Date(a.time).toLocaleString('uz')}</td>
            <td className="px-4 py-3 font-medium">{a.user}</td>
            <td className="px-4 py-3">{a.action.split(':')[0]}</td>
            <td className="px-4 py-3"><Badge color="gray">{a.action.split(':')[1]?.trim() || '—'}</Badge></td>
            <td className="px-4 py-3 text-slate-400">{a.detail}</td>
            <td className="px-4 py-3 text-slate-400">{a.ip}</td>
            {isSuperAdmin && (
              <td className="px-4 py-3">
                <button onClick={() => confirm("Bu yozuv o'chirilsinmi?") && db.remove('audit', a.id)}
                  className="rounded-md p-1.5 text-slate-400 hover:text-red-500"><Trash2 size={15} /></button>
              </td>
            )}
          </tr>
        )} />
    </div>
  )
}
