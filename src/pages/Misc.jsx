import { useState } from 'react'
import { BookOpen, FileText, UserCog, ShieldCheck, Plus, Download, Pencil, Trash2 } from 'lucide-react'
import { db, useCollection } from '../data/store'
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

/* ---------- Talabnomalar ---------- */
export function Requests() {
  const requests = useCollection('requests')
  const [tab, setTab] = useState('all')
  const tabs = [['all', 'Hammasi'], ['sent', 'Yuborilgan'], ['incoming', 'Kelgan (tasdiqlash)']]
  return (
    <div>
      <PageHeader title="Talabnomalar" subtitle="Kafedra oʻrtasidagi oʻquv yuklamasi soʻrovlari" icon={FileText}
        action={<button className="btn-ghost"><Download size={15} /> Excel yuklab olish</button>} />
      <div className="mb-4 inline-flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/60">
        {tabs.map(([id, l]) => <button key={id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === id ? 'bg-brand text-white' : 'text-slate-500'}`}>{l}</button>)}
      </div>
      <Table columns={['Yuboruvchi kafedra', 'Qabul qiluvchi kafedra', 'Fan', 'Semestr', 'Holat', 'Sana']} rows={requests} empty="Talabnomalar yoʻq" renderRow={(r) => (
        <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800/60"><td className="px-4 py-3">{r.from}</td><td className="px-4 py-3">{r.to}</td><td className="px-4 py-3">{r.subject}</td><td className="px-4 py-3">{r.semester}</td><td className="px-4 py-3"><Badge>{r.status}</Badge></td><td className="px-4 py-3">{r.date}</td></tr>
      )} />
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
  const openAdd = () => { setEditing(null); setForm({ login: '', fullName: '', email: '', role: 'Fakultet operatori', active: true }); setOpen(true) }
  const openEdit = (u) => { setEditing(u); setForm(u); setOpen(true) }
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
