import { useState, useEffect } from 'react'
import { BookOpen, FileText, UserCog, ShieldCheck, Plus, Pencil, Trash2 } from 'lucide-react'
import { db, useCollection } from '../data/store'
import { api, auth } from '../api/client'
import { PageHeader, SearchBar, Table, Modal, Field, Badge } from '../components/ui'

/* ---------- O'quv yuklamasi ---------- */
export function Loads() {
  const loads = useCollection('loads')
  const subjects = useCollection('subjects')
  const teachers = useCollection('teachers')
  const groups = useCollection('groups')
  const [tab, setTab] = useState('list')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({})

  const save = (e) => {
    e.preventDefault()
    db.add('loads', { ...form, lecture: Number(form.lecture) || 0, practice: Number(form.practice) || 0, rating: Number(form.rating) || 0 })
    setOpen(false); setForm({})
  }
  const nm = (coll, id) => db.get(coll).find((x) => x.id === Number(id))?.name || db.get(coll).find((x) => x.id === Number(id))?.fullName || '—'

  return (
    <div>
      <PageHeader title="O'quv yuklamasi" count={loads.length}
        action={<button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Qo'shish</button>} />
      <SearchBar value={q} onChange={setQ} />
      <div className="mb-4 inline-flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/60">
        {[['list', "Yuklama ro'yxati"], ['teacher', "O'qituvchi yuklamasi"]].map(([id, l]) => (
          <button key={id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === id ? 'bg-brand text-white' : 'text-slate-500'}`}>{l}</button>
        ))}
      </div>
      <Table
        columns={['Oʻqituvchi', 'Fan', 'Guruh', 'Sem', "Ma'ruza", 'Amaliy', 'Reyting', 'Jami']}
        rows={loads.filter((l) => Object.values(l).join(' ').toLowerCase().includes(q.toLowerCase()))}
        empty="Maʼlumot topilmadi"
        renderRow={(l) => (
          <tr key={l.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
            <td className="px-4 py-3">{nm('teachers', l.teacherId)}</td>
            <td className="px-4 py-3">{nm('subjects', l.subjectId)}</td>
            <td className="px-4 py-3">{nm('groups', l.groupId)}</td>
            <td className="px-4 py-3">{l.semester}</td>
            <td className="px-4 py-3">{l.lecture}</td>
            <td className="px-4 py-3">{l.practice}</td>
            <td className="px-4 py-3">{l.rating}</td>
            <td className="px-4 py-3 font-semibold">{(l.lecture || 0) + (l.practice || 0) + (l.rating || 0)}</td>
          </tr>
        )}
      />
      <Modal open={open} onClose={() => setOpen(false)} title="Yuklama qo'shish">
        <form onSubmit={save} className="space-y-4">
          <Field label="Oʻqituvchi"><select className="input" value={form.teacherId || ''} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}><option value="">—</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}</select></Field>
          <Field label="Fan"><select className="input" value={form.subjectId || ''} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}><option value="">—</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Guruh"><select className="input" value={form.groupId || ''} onChange={(e) => setForm({ ...form, groupId: e.target.value })}><option value="">—</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Semestr"><input className="input" value={form.semester || ''} onChange={(e) => setForm({ ...form, semester: e.target.value })} /></Field>
            <Field label="Maʼruza"><input className="input" type="number" value={form.lecture || ''} onChange={(e) => setForm({ ...form, lecture: e.target.value })} /></Field>
            <Field label="Amaliy"><input className="input" type="number" value={form.practice || ''} onChange={(e) => setForm({ ...form, practice: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Bekor</button><button type="submit" className="btn-primary">Saqlash</button></div>
        </form>
      </Modal>
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
              <select className="input" required value={form.fromDepartmentId || ''} onChange={(e) => setForm({ ...form, fromDepartmentId: e.target.value })}>
                <option value="">—</option>{refs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Qabul qiluvchi kafedra *">
              <select className="input" required value={form.toDepartmentId || ''} onChange={(e) => setForm({ ...form, toDepartmentId: e.target.value })}>
                <option value="">—</option>{refs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fan">
              <select className="input" value={form.subjectId || ''} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
                <option value="">—</option>{refs.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="O'qituvchi">
              <select className="input" value={form.teacherId || ''} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}>
                <option value="">—</option>{refs.teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Xona">
              <select className="input" value={form.roomId || ''} onChange={(e) => setForm({ ...form, roomId: e.target.value })}>
                <option value="">—</option>{refs.rooms.map((rm) => <option key={rm.id} value={rm.id}>{rm.name}</option>)}
              </select>
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

/* ---------- Foydalanuvchilar ---------- */
export function UsersPage() {
  const users = useCollection('users')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const openAdd = () => { setEditing(null); setForm({ login: '', fullName: '', email: '', role: 'Fakultet operatori', active: true, password: '' }); setOpen(true) }
  const openEdit = (u) => { setEditing(u); setForm({ ...u, password: '' }); setOpen(true) }
  const save = (e) => { e.preventDefault(); editing ? db.update('users', editing.id, form) : db.add('users', form); setOpen(false) }

  return (
    <div>
      <PageHeader title="Foydalanuvchilar" count={users.length}
        action={<button className="btn-primary" onClick={openAdd}><Plus size={16} /> Qo'shish</button>} />
      <SearchBar value={q} onChange={setQ} />
      <Table columns={['Login', 'F.I', 'Email', 'Rol', 'Holat', 'Amallar']}
        rows={users.filter((u) => Object.values(u).join(' ').toLowerCase().includes(q.toLowerCase()))}
        renderRow={(u) => (
          <tr key={u.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
            <td className="px-4 py-3"><Badge color="gray">{u.login}</Badge></td>
            <td className="px-4 py-3 font-medium">{u.fullName}</td>
            <td className="px-4 py-3">{u.email || '—'}</td>
            <td className="px-4 py-3">{u.role === 'Super Admin' ? <Badge>Super Admin</Badge> : u.role}</td>
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
          <Field label="Rol"><select className="input" value={form.role || ''} onChange={(e) => setForm({ ...form, role: e.target.value })}>{['Super Admin', 'Fakultet operatori', 'Kafedra mudiri', 'Oʻqituvchi'].map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field label={editing ? 'Yangi parol' : 'Parol'}>
            <input className="input" type="password" required={!editing} value={form.password || ''}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={editing ? "bo'sh qoldirsangiz o'zgarmaydi" : 'kamida 4 belgi'} />
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Faol</label>
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
  return (
    <div>
      <PageHeader title="Audit logi" subtitle={`Tizimda qilingan barcha oʻzgartirishlar tarixi — ${audit.length} ta yozuv`} icon={ShieldCheck} />
      <SearchBar value={q} onChange={setQ} placeholder="Foydalanuvchi yoki maʼlumot..." />
      <Table columns={['Vaqt', 'Foydalanuvchi', 'Amal', "Bo'lim", 'Tafsilot', 'IP']}
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
          </tr>
        )} />
    </div>
  )
}
