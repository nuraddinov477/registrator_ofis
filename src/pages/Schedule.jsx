import { useState } from 'react'
import { Zap, X } from 'lucide-react'
import { useCollection, db } from '../data/store'
import { Modal, Field } from '../components/ui'

const DAYS = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba']
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8]
const COLORS = ['bg-blue-500/20 border-blue-500/40 text-blue-300', 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300', 'bg-amber-500/20 border-amber-500/40 text-amber-300', 'bg-purple-500/20 border-purple-500/40 text-purple-300']

export default function Schedule() {
  const lessons = useCollection('schedule')
  const subjects = useCollection('subjects')
  const teachers = useCollection('teachers')
  const groups = useCollection('groups')
  const [sem, setSem] = useState('1')
  const [cell, setCell] = useState(null)
  const [form, setForm] = useState({})

  const find = (day, period) => lessons.find((l) => l.day === day && l.period === period)
  const openCell = (day, period) => {
    const ex = find(day, period)
    setForm(ex || { day, period, subjectId: '', teacherId: '', groupId: '', room: '' })
    setCell({ day, period, existing: ex })
  }
  const save = (e) => {
    e.preventDefault()
    const p = { ...form, period: Number(form.period) }
    cell.existing ? db.update('schedule', cell.existing.id, p) : db.add('schedule', p)
    setCell(null)
  }
  const name = (coll, id) => db.get(coll).find((x) => x.id === Number(id))

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dars jadvali</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Jami: {lessons.length} dars</p>
        </div>
        <button className="btn-primary"><Zap size={16} /> Jadval yaratish</button>
      </div>

      <div className="mb-4 flex gap-3">
        <select className="input max-w-[180px]" value={sem} onChange={(e) => setSem(e.target.value)}>
          <option value="1">1-semestr</option>
          <option value="2">2-semestr</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-12 border-b border-r border-slate-200 px-2 py-3 text-slate-400 dark:border-slate-800">#</th>
              {DAYS.map((d) => <th key={d} className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200">{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERIODS.map((p) => (
              <tr key={p}>
                <td className="border-b border-r border-slate-200 px-2 py-3 text-center text-slate-400 dark:border-slate-800">{p}</td>
                {DAYS.map((d, di) => {
                  const l = find(d, p)
                  return (
                    <td key={d} onClick={() => openCell(d, p)} className="h-16 cursor-pointer border-b border-l border-slate-200 px-1.5 py-1.5 align-top transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                      {l && (
                        <div className={`rounded-md border px-2 py-1 text-xs ${COLORS[di % COLORS.length]}`}>
                          <div className="font-semibold">{name('subjects', l.subjectId)?.name || 'Fan'}</div>
                          <div className="opacity-80">{name('groups', l.groupId)?.name || ''} {l.room && `· ${l.room}`}</div>
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!cell} onClose={() => setCell(null)} title={cell ? `${cell.day}, ${cell.period}-para` : ''}>
        <form onSubmit={save} className="space-y-4">
          <Field label="Fan"><select className="input" value={form.subjectId || ''} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}><option value="">—</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Oʻqituvchi"><select className="input" value={form.teacherId || ''} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}><option value="">—</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}</select></Field>
          <Field label="Guruh"><select className="input" value={form.groupId || ''} onChange={(e) => setForm({ ...form, groupId: e.target.value })}><option value="">—</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
          <Field label="Xona"><input className="input" value={form.room || ''} onChange={(e) => setForm({ ...form, room: e.target.value })} /></Field>
          <div className="flex justify-between pt-2">
            {cell?.existing ? <button type="button" className="btn-ghost text-red-500" onClick={() => { db.remove('schedule', cell.existing.id); setCell(null) }}><X size={15} /> O'chirish</button> : <span />}
            <button type="submit" className="btn-primary">Saqlash</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
