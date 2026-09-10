import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { db, useCollection } from '../data/store'
import { Modal, Field, SearchableSelect, Badge } from './ui'

// Maxsus xona uchun ruxsatnoma boshqaruvi — kimga (o'qituvchi/guruh/mutaxassislik)
// bu xonaga kirish ruxsati berilganini ko'rsatadi va qo'shish/o'chirish imkonini beradi.
// Guruh uchun: Fakultet → Kurs → Guruh ketma-ketligida tanlab, "faqat shu xonada" (exclusive)
// belgilash mumkin. Faqat "Kirish turi: Maxsus" xonalar uchun ochiladi (Rooms.jsx tugmasi).
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
  const faculties = useCollection('faculties')
  const [kind, setKind] = useState('teacher')
  const [targetId, setTargetId] = useState('')
  const [facultyId, setFacultyId] = useState('')
  const [course, setCourse] = useState('')
  const [groupId, setGroupId] = useState('')
  const [exclusive, setExclusive] = useState(false)
  const [err, setErr] = useState('')

  if (!room) return null
  const permissions = all.filter((p) => p.roomId === room.id)

  const nonGroupOptions = (k) => (k === 'teacher'
    ? teachers.map((t) => ({ value: t.id, label: t.fullName }))
    : specialties.map((s) => ({ value: s.id, label: s.name })))

  // Guruh uchun kaskad: fakultet → kurs → guruh
  const byFac = facultyId ? groups.filter((g) => String(g.facultyId) === String(facultyId)) : groups
  const courses = [...new Set(byFac.map((g) => g.course))].sort((a, b) => a - b)
  const byCourse = course ? byFac.filter((g) => String(g.course) === String(course)) : byFac

  const labelOf = (p) => {
    if (p.teacherId != null) return { kind: "O'qituvchi", name: p.teacher?.fullName ?? teachers.find((t) => t.id === p.teacherId)?.fullName }
    if (p.groupId != null) return { kind: 'Guruh', name: p.group?.name ?? groups.find((g) => g.id === p.groupId)?.name }
    return { kind: 'Mutaxassislik', name: p.specialty?.name ?? specialties.find((s) => s.id === p.specialtyId)?.name }
  }

  const resetForm = () => { setTargetId(''); setFacultyId(''); setCourse(''); setGroupId(''); setExclusive(false) }

  const add = async (e) => {
    e.preventDefault()
    setErr('')
    const payload = { roomId: room.id, exclusive: kind === 'group' && exclusive }
    if (kind === 'teacher') { if (!targetId) return setErr('O\'qituvchini tanlang'); payload.teacherId = targetId }
    else if (kind === 'specialty') { if (!targetId) return setErr('Yo\'nalishni tanlang'); payload.specialtyId = targetId }
    else { if (!groupId) return setErr('Guruhni tanlang'); payload.groupId = groupId }
    try {
      await db.add('roomPermissions', payload)
      resetForm()
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
          Bu xona <b>maxsus</b> — faqat quyida ro'yxatga kiritilganlar jadval tuzishda undan foydalanadi.
          Guruh uchun <b>"faqat shu xonada"</b> belgilansa — o'sha guruh <b>barcha</b> darslarini shu xonada o'tadi (boshqa xona nomzod bo'lmaydi).
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
                    {p.exclusive && <Badge color="amber">faqat shu xonada</Badge>}
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
            <select className="input" value={kind} onChange={(e) => { setKind(e.target.value); resetForm() }}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </Field>

          {kind === 'group' ? (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <SearchableSelect value={facultyId} onChange={(v) => { setFacultyId(v); setCourse(''); setGroupId('') }}
                  options={faculties.map((f) => ({ value: f.id, label: f.name }))} emptyLabel="Barcha fakultetlar" placeholder="Fakultet..." />
                <SearchableSelect value={course} onChange={(v) => { setCourse(v); setGroupId('') }}
                  options={courses.map((c) => ({ value: c, label: `${c}-kurs` }))} emptyLabel="Barcha kurslar" placeholder="Kurs..." />
                <SearchableSelect value={groupId} onChange={setGroupId}
                  options={byCourse.map((g) => ({ value: g.id, label: g.name }))} emptyLabel="— guruh —" placeholder="Guruh..." />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" className="h-4 w-4 rounded" checked={exclusive} onChange={(e) => setExclusive(e.target.checked)} />
                Bu guruh <b>faqat shu xonada</b> dars o'tadi (to'liq biriktirish)
              </label>
            </>
          ) : (
            <SearchableSelect value={targetId} onChange={setTargetId} options={nonGroupOptions(kind)} placeholder="Qidirish..." />
          )}

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
