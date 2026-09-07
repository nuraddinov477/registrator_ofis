import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { db, useCollection } from '../data/store'
import { Modal, Field, SearchableSelect, Badge } from './ui'

// Maxsus xona uchun ruxsatnoma boshqaruvi — kimga (o'qituvchi/guruh/mutaxassislik)
// bu xonaga kirish ruxsati berilganini ko'rsatadi va qo'shish/o'chirish imkonini beradi.
// Faqat "Kirish turi: Maxsus" bo'lgan xonalar uchun ochiladi (Rooms.jsx'dagi tugma orqali).
const KINDS = [
  { value: 'teacher', label: "O'qituvchi" },
  { value: 'group', label: 'Guruh' },
  { value: 'specialty', label: 'Mutaxassislik' },
]

export default function RoomPermissionsModal({ room, onClose }) {
  const all = useCollection('roomPermissions')
  const teachers = useCollection('teachers')
  const groups = useCollection('groups')
  const specialties = useCollection('specialties')
  const [kind, setKind] = useState('teacher')
  const [targetId, setTargetId] = useState('')
  const [err, setErr] = useState('')

  if (!room) return null
  const permissions = all.filter((p) => p.roomId === room.id)

  const optionsFor = (k) => (k === 'teacher' ? teachers.map((t) => ({ value: t.id, label: t.fullName }))
    : k === 'group' ? groups.map((g) => ({ value: g.id, label: g.name }))
      : specialties.map((s) => ({ value: s.id, label: s.name })))

  const labelOf = (p) => {
    if (p.teacherId != null) return { kind: "O'qituvchi", name: p.teacher?.fullName ?? teachers.find((t) => t.id === p.teacherId)?.fullName }
    if (p.groupId != null) return { kind: 'Guruh', name: p.group?.name ?? groups.find((g) => g.id === p.groupId)?.name }
    return { kind: 'Mutaxassislik', name: p.specialty?.name ?? specialties.find((s) => s.id === p.specialtyId)?.name }
  }

  const add = async (e) => {
    e.preventDefault()
    setErr('')
    if (!targetId) { setErr('Kimga ruxsat berishni tanlang'); return }
    const payload = { roomId: room.id }
    if (kind === 'teacher') payload.teacherId = targetId
    if (kind === 'group') payload.groupId = targetId
    if (kind === 'specialty') payload.specialtyId = targetId
    try {
      await db.add('roomPermissions', payload)
      setTargetId('')
    } catch (e) { setErr(e.message || 'Saqlashda xatolik') }
  }

  const remove = async (id) => {
    if (!confirm("Ruxsatni bekor qilasizmi?")) return
    try { await db.remove('roomPermissions', id) } catch (e) { alert(e.message || "O'chirishda xatolik") }
  }

  return (
    <Modal open={!!room} onClose={onClose} title={`${room.name} — kirish ruxsatlari`}>
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          Bu xona <b>maxsus</b> — faqat pastda ro'yxatga kiritilgan o'qituvchi/guruh/mutaxassislik jadval tuzishda shu xonadan foydalana oladi.
        </p>

        {permissions.length === 0 ? (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-400 dark:bg-slate-800/60">Hali ruxsat berilmagan — hech kim kira olmaydi.</p>
        ) : (
          <div className="space-y-1.5">
            {permissions.map((p) => {
              const l = labelOf(p)
              return (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <Badge color="gray">{l.kind}</Badge>
                    <span className="text-sm">{l.name ?? '—'}</span>
                  </div>
                  <button onClick={() => remove(p.id)} className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40">
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <form onSubmit={add} className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
          <Field label="Ruxsat qo'shish">
            <div className="flex gap-2">
              <select className="input w-auto" value={kind} onChange={(e) => { setKind(e.target.value); setTargetId('') }}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <div className="flex-1">
                <SearchableSelect value={targetId} onChange={setTargetId} options={optionsFor(kind)} placeholder="Qidirish..." />
              </div>
            </div>
          </Field>
          {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{err}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Yopish</button>
            <button type="submit" className="btn-primary">Qo'shish</button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
