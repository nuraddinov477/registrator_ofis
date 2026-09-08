import { useState } from 'react'
import { Trash2, Pencil, Plus, X } from 'lucide-react'
import { db, useCollection } from '../data/store'
import { Modal, Field, SearchableSelect, Badge } from './ui'

// O'qituvchi istisnolari — jadval generatsiyasida QAT'IY hisobga olinadi:
//   1. Qaysi kunlarda dars qo'ymaslik kerak (blockedDays)
//   2. Darslarini aynan qaysi paralarga qo'yish kerak (allowedPairs — bo'sh = cheklovsiz)
const DAY_NAMES = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma']
const PAIRS = [1, 2, 3, 4, 5, 6]

const parseArr = (s) => { try { return s ? JSON.parse(s) : [] } catch { return [] } }

export default function TeacherConstraintsModal({ open, onClose }) {
  const items = useCollection('teacherConstraints')
  const teachers = useCollection('teachers')
  const [editing, setEditing] = useState(null) // null = ro'yxat, {} = yangi, {...} = tahrirlash
  const [form, setForm] = useState({})
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const teacherName = (id) => teachers.find((t) => t.id === id)?.fullName || '—'
  const usedTeacherIds = new Set(items.map((x) => x.teacherId))

  const openAdd = () => { setEditing({}); setForm({ teacherId: '', blockedDays: [], allowedPairs: [] }); setErr('') }
  const openEdit = (row) => {
    setEditing(row)
    setForm({ teacherId: row.teacherId, blockedDays: parseArr(row.blockedDays), allowedPairs: parseArr(row.allowedPairs) })
    setErr('')
  }
  const closeForm = () => { setEditing(null); setErr('') }

  const toggleDay = (d) => setForm((f) => ({ ...f, blockedDays: f.blockedDays.includes(d) ? f.blockedDays.filter((x) => x !== d) : [...f.blockedDays, d] }))
  const togglePair = (p) => setForm((f) => ({ ...f, allowedPairs: f.allowedPairs.includes(p) ? f.allowedPairs.filter((x) => x !== p) : [...f.allowedPairs, p] }))

  const save = async (e) => {
    e.preventDefault()
    if (!form.teacherId) { setErr("O'qituvchini tanlang"); return }
    setSaving(true); setErr('')
    const payload = { teacherId: Number(form.teacherId), blockedDays: form.blockedDays, allowedPairs: form.allowedPairs }
    try {
      if (editing?.id) await db.update('teacherConstraints', editing.id, payload)
      else await db.add('teacherConstraints', payload)
      closeForm()
    } catch (e2) { setErr(e2.message || 'Saqlashda xatolik') } finally { setSaving(false) }
  }

  const remove = async (row) => {
    if (!confirm(`${teacherName(row.teacherId)} uchun istisno o'chirilsinmi?`)) return
    try { await db.remove('teacherConstraints', row.id) } catch (e) { alert(e.message || "O'chirishda xatolik") }
  }

  return (
    <Modal open={open} onClose={onClose} title="O'qituvchi istisnolari">
      {editing ? (
        <form onSubmit={save} className="space-y-4">
          <Field label="O'qituvchi">
            <SearchableSelect
              value={form.teacherId || ''}
              onChange={(v) => setForm({ ...form, teacherId: v })}
              options={teachers
                .filter((t) => !usedTeacherIds.has(t.id) || t.id === editing.teacherId)
                .map((t) => ({ value: t.id, label: t.fullName }))}
              placeholder="F.I.Sh. qidirish..."
            />
          </Field>
          <Field label="Qaysi kunlari dars qo'ymaslik kerak">
            <div className="flex flex-wrap gap-2">
              {DAY_NAMES.map((d, i) => {
                const on = form.blockedDays.includes(i)
                return (
                  <button key={i} type="button" onClick={() => toggleDay(i)}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition ${on ? 'border-red-400 bg-red-500/10 text-red-500' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>
                    {d}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label="Darslarini aynan qaysi paralarga qo'yish kerak (bo'sh = cheklovsiz)">
            <div className="flex flex-wrap gap-2">
              {PAIRS.map((p) => {
                const on = form.allowedPairs.includes(p)
                return (
                  <button key={p} type="button" onClick={() => togglePair(p)}
                    className={`h-9 w-9 rounded-lg border text-sm transition ${on ? 'border-brand bg-brand/10 text-brand' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>
                    {p}
                  </button>
                )
              })}
            </div>
          </Field>
          {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={closeForm}>Bekor</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saqlanmoqda…' : 'Saqlash'}</button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Jadval generatsiyasida qat'iy hisobga olinadi: belgilangan kunlarga hech qanday dars qo'yilmaydi, "faqat shu paralarga" belgilangan bo'lsa boshqa paralar ishlatilmaydi.
          </p>
          {items.length === 0 ? (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-400 dark:bg-slate-800/60">Hali istisno qo'shilmagan.</p>
          ) : (
            <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {items.map((row) => (
                <div key={row.id} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{teacherName(row.teacherId)}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(row)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-800"><Pencil size={14} /></button>
                      <button onClick={() => remove(row)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {parseArr(row.blockedDays).map((d) => <Badge key={`d${d}`} color="red">{DAY_NAMES[d]} — yo'q</Badge>)}
                    {parseArr(row.allowedPairs).length > 0 && <Badge color="blue">faqat {parseArr(row.allowedPairs).join(', ')}-para</Badge>}
                    {parseArr(row.blockedDays).length === 0 && parseArr(row.allowedPairs).length === 0 && <Badge color="gray">cheklovsiz</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={onClose}><X size={15} /> Yopish</button>
            <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Istisno qo'shish</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
