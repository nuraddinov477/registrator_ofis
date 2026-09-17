import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Pencil, Trash2, X, KeyRound } from 'lucide-react'
import { db, useCollection, useIsLoading, useLoadFailed, useHasLoaded, retry } from '../data/store'
import { canWrite } from '../lib/access'
import { SearchBar, Table, Modal, Field, Badge, DataState, SearchableSelect } from '../components/ui'
import RoomPermissionsModal from '../components/RoomPermissionsModal'

export default function Rooms() {
  const buildings = useCollection('buildings')
  const rooms = useCollection('rooms')
  const faculties = useCollection('faculties')
  const groups = useCollection('groups')
  const subjects = useCollection('subjects')
  const roomPerms = useCollection('roomPermissions')
  const [tab, setTab] = useState('buildings')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [fBuilding, setFBuilding] = useState('') // xona filtri: bino
  const [fType, setFType] = useState('')          // xona filtri: turi
  const [fCap, setFCap] = useState('')            // xona filtri: minimal sig'im
  const [fFaculty, setFFaculty] = useState('')    // xona filtri: fakultet → kurs → guruh kaskadi
  const [fCourse, setFCourse] = useState('')
  const [fGroup, setFGroup] = useState('')        // tanlansa — faqat shu guruhga ruxsat berilgan xonalar
  const [subjectPick, setSubjectPick] = useState('') // fan qo'shish uchun tanlov
  const [permRoom, setPermRoom] = useState(null) // ruxsatlar oynasi ochilgan xona (maxsus)

  const isB = tab === 'buildings'
  const coll = isB ? 'buildings' : 'rooms'
  const writable = canWrite(coll)
  const loading = useIsLoading(coll)
  const failed = useLoadFailed(coll)
  const roomTypes = [...new Set(rooms.map((r) => r.kind).filter(Boolean))]

  // Fakultet → kurs → guruh kaskadi (xona filtri uchun)
  const facGroups = fFaculty ? groups.filter((g) => String(g.facultyId) === String(fFaculty)) : groups
  const courseOpts = [...new Set(facGroups.map((g) => g.course))].sort((a, b) => a - b)
  const groupOpts = fCourse ? facGroups.filter((g) => String(g.course) === String(fCourse)) : facGroups
  const selGroup = fGroup ? groups.find((g) => g.id === Number(fGroup)) : null
  // Shu guruhga ruxsat berilgan xona id'lari (guruh yoki uning yo'nalishi orqali)
  const groupRoomIds = selGroup
    ? new Set(roomPerms.filter((p) => p.groupId === selGroup.id || (selGroup.specialtyId != null && p.specialtyId === selGroup.specialtyId)).map((p) => p.roomId))
    : null

  const list = (isB ? buildings : rooms).filter((r) => {
    if (q && !Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase())) return false
    if (!isB && fBuilding && Number(r.buildingId) !== Number(fBuilding)) return false
    if (!isB && fType && r.kind !== fType) return false
    if (!isB && fCap && Number(r.capacity) < Number(fCap)) return false
    if (!isB && groupRoomIds && !groupRoomIds.has(r.id)) return false
    return true
  })

  // Xona → biriktirilgan guruh/yo'nalish/o'qituvchi/fan nomlari (jadval ustuni uchun)
  const roomAssignees = (roomId) => roomPerms.filter((p) => p.roomId === roomId).map((p) => {
    if (p.groupId != null) return { name: p.group?.name || groups.find((g) => g.id === p.groupId)?.name || `guruh #${p.groupId}`, ex: !!p.exclusive }
    if (p.specialtyId != null) return { name: p.specialty?.name || `yo'nalish #${p.specialtyId}`, ex: false }
    if (p.teacherId != null) return { name: p.teacher?.fullName || `o'qituvchi #${p.teacherId}`, ex: false }
    if (p.subjectId != null) return { name: p.subject?.name || subjects.find((s) => s.id === p.subjectId)?.name || `fan #${p.subjectId}`, ex: false }
    return null
  }).filter(Boolean)
  // Xona → unga biriktirilgan fan ID'lari (forma uchun)
  const roomSubjectIds = (roomId) => roomPerms.filter((p) => p.roomId === roomId && p.subjectId != null).map((p) => p.subjectId)

  const [facultyPick, setFacultyPick] = useState('') // bino qo'shish/tahrirlashda fakultet tanlash
  const openAdd = () => { setEditing(null); setForm(isB ? { name: '', floors: 1, address: '', facultyIds: [] } : { name: '', buildingId: '', capacity: 30, kind: 'Maʼruza', type: 'umumiy', subjectIds: [] }); setSubjectPick(''); setFacultyPick(''); setOpen(true) }
  const openEdit = (r) => { setEditing(r); setForm(isB ? { ...r, facultyIds: (r.faculties || []).map((f) => f.id) } : { ...r, subjectIds: roomSubjectIds(r.id) }); setSubjectPick(''); setFacultyPick(''); setOpen(true) }

  // Tashxis havolasidan: ?room=<id> — "Xonalar" bo'limida shu xonani topib, tahrirlash oynasini ochadi
  const [params, setParams] = useSearchParams()
  const roomsReady = useHasLoaded('rooms')
  const focusRoom = Number(params.get('room')) || null
  useEffect(() => { if (focusRoom) setTab('rooms') }, [focusRoom])
  useEffect(() => {
    if (!focusRoom || tab !== 'rooms' || !roomsReady) return
    const row = rooms.find((r) => r.id === focusRoom)
    if (row) { setQ(row.name); if (writable) openEdit(row) }
    const next = new URLSearchParams(params)
    next.delete('room')
    setParams(next, { replace: true })
  }, [focusRoom, tab, roomsReady, rooms])
  const save = async (e) => {
    e.preventDefault()
    const subjectIds = form.subjectIds || []
    const p = { ...form }
    delete p.subjectIds
    if (isB) { p.floors = Number(p.floors) || 1; delete p.faculties; delete p.facultyId }
    else { p.capacity = Number(p.capacity) || 0; p.buildingId = Number(p.buildingId) || '' }
    const saved = editing ? await db.update(coll, editing.id, p) : await db.add(coll, p)
    if (!isB) {
      // Fan ruxsatlarini forma bilan moslashtirish: yo'qlarini o'chirish, yangilarini qo'shish
      const roomId = editing ? editing.id : saved?.id
      if (roomId) {
        const existing = roomPerms.filter((rp) => rp.roomId === roomId && rp.subjectId != null)
        const selected = new Set(subjectIds)
        const existingIds = new Set(existing.map((rp) => rp.subjectId))
        for (const rp of existing) { if (!selected.has(rp.subjectId)) await db.remove('roomPermissions', rp.id) }
        for (const sid of selected) { if (!existingIds.has(sid)) await db.add('roomPermissions', { roomId, subjectId: sid }) }
      }
    }
    setOpen(false)
  }
  const addSubject = () => {
    if (!subjectPick) return
    const cur = form.subjectIds || []
    const sid = Number(subjectPick)
    if (!cur.includes(sid)) setForm({ ...form, subjectIds: [...cur, sid] })
    setSubjectPick('')
  }
  const removeSubject = (sid) => {
    setForm({ ...form, subjectIds: (form.subjectIds || []).filter((x) => x !== sid) })
  }
  const addFaculty = () => {
    if (!facultyPick) return
    const cur = form.facultyIds || []
    const fid = Number(facultyPick)
    if (!cur.includes(fid)) setForm({ ...form, facultyIds: [...cur, fid] })
    setFacultyPick('')
  }
  const removeFaculty = (fid) => {
    setForm({ ...form, facultyIds: (form.facultyIds || []).filter((x) => x !== fid) })
  }
  const bName = (id) => buildings.find((b) => b.id === id)?.name || '—'

  const TabBtn = ({ id, children }) => (
    <button onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === id ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{children}</button>
  )

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Bino va xonalar</h1>
        {writable && <button className="btn-primary" onClick={openAdd}><Plus size={16} /> {isB ? 'Bino' : 'Xona'} qo'shish</button>}
      </div>
      <SearchBar value={q} onChange={setQ} />
      <div className="mb-4 inline-flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/60">
        <TabBtn id="buildings">Binolar ({buildings.length})</TabBtn>
        <TabBtn id="rooms">Xonalar ({rooms.length})</TabBtn>
      </div>

      {!isB && (
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-auto min-w-[12rem]">
              <SearchableSelect value={fBuilding} onChange={setFBuilding}
                options={buildings.map((b) => ({ value: b.id, label: b.name }))}
                emptyLabel="Barcha binolar" placeholder="Bino qidirish..." />
            </div>
            <select className="input h-9 w-auto py-1" value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="">Barcha turlar</option>
              {roomTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="number" min="0" className="input h-9 w-36 py-1" placeholder="Sigʻim ≥" value={fCap}
              onChange={(e) => setFCap(e.target.value)} title="Minimal sigʻim (o'rin soni)" />
          </div>
          {/* Fakultet → Kurs → Guruh: tanlangan guruhga ruxsat berilgan xonalarni ko'rsatadi */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Guruh bo'yicha:</span>
            <div className="w-auto min-w-[11rem]">
              <SearchableSelect value={fFaculty} onChange={(v) => { setFFaculty(v); setFCourse(''); setFGroup('') }}
                options={faculties.map((f) => ({ value: f.id, label: f.name }))} emptyLabel="Barcha fakultetlar" placeholder="Fakultet..." />
            </div>
            <div className="w-auto min-w-[8rem]">
              <SearchableSelect value={fCourse} onChange={(v) => { setFCourse(v); setFGroup('') }}
                options={courseOpts.map((c) => ({ value: c, label: `${c}-kurs` }))} emptyLabel="Barcha kurslar" placeholder="Kurs..." />
            </div>
            <div className="w-auto min-w-[11rem]">
              <SearchableSelect value={fGroup} onChange={setFGroup}
                options={groupOpts.map((g) => ({ value: g.id, label: g.name }))} emptyLabel="— guruh —" placeholder="Guruh..." />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(fBuilding || fType || fCap || fFaculty || fCourse || fGroup) && (
              <button className="text-sm text-slate-500 hover:text-brand"
                onClick={() => { setFBuilding(''); setFType(''); setFCap(''); setFFaculty(''); setFCourse(''); setFGroup('') }}>Tozalash</button>
            )}
            <span className="text-xs text-slate-400">
              {list.length} ta xona
              {selGroup && ` — "${selGroup.name}" guruhiga ruxsat berilgan`}
            </span>
          </div>
        </div>
      )}

      {(loading || failed) && list.length === 0 ? (
        <DataState loading={loading} onRetry={() => retry(coll)} />
      ) : (
      <Table
        columns={[...(isB ? ['Nomi', 'Qavatlar', 'Manzil', "Fakultet(lar)"] : ['Nomi', 'Bino', 'Sigʻim', 'Turi', 'Kirish', 'Biriktirilgan']), ...(writable ? ['Amallar'] : [])]}
        rows={list}
        renderRow={(r) => (
          <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30">
            <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{r.name}</td>
            {isB ? <>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{r.floors}</td>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{r.address || '—'}</td>
              <td className="px-4 py-3">
                {(r.faculties || []).length
                  ? <div className="flex flex-wrap gap-1">{r.faculties.map((f) => <Badge key={f.id} color="blue">{f.name}</Badge>)}</div>
                  : <Badge color="gray">Asosiy (umumiy)</Badge>}
              </td>
            </> : <>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{bName(r.buildingId)}</td>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{r.capacity}</td>
              <td className="px-4 py-3">{r.kind ? <Badge>{r.kind}</Badge> : <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-3">
                <Badge color={r.type === 'maxsus' ? 'amber' : 'green'}>{r.type === 'maxsus' ? 'Maxsus' : 'Ochiq'}</Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {roomAssignees(r.id).length
                    ? roomAssignees(r.id).map((a, i) => <Badge key={i} color={a.ex ? 'amber' : 'blue'}>{a.name}{a.ex ? ' · faqat' : ''}</Badge>)
                    : <span className="text-slate-400">{r.type === 'maxsus' ? 'ruxsat yo‘q' : 'hammaga ochiq'}</span>}
                </div>
              </td>
            </>}
            {writable && (
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  {!isB && r.type === 'maxsus' && (
                    <button onClick={() => setPermRoom(r)} title="Kirish ruxsatlari" className="rounded-md p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-950/40"><KeyRound size={15} /></button>
                  )}
                  <button onClick={() => openEdit(r)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-800"><Pencil size={15} /></button>
                  <button onClick={() => confirm("O'chirilsinmi?") && db.remove(coll, r.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"><Trash2 size={15} /></button>
                </div>
              </td>
            )}
          </tr>
        )}
      />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={`${isB ? 'Bino' : 'Xona'} ${editing ? 'tahrirlash' : "qo'shish"}`}>
        <form onSubmit={save} className="space-y-4">
          <Field label="Nomi"><input className="input" required value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          {isB ? <>
            <Field label="Qavatlar"><input className="input" type="number" value={form.floors || 1} onChange={(e) => setForm({ ...form, floors: e.target.value })} /></Field>
            <Field label="Manzil"><input className="input" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label="Fakultet(lar)">
              <div className="space-y-2.5">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <SearchableSelect value={facultyPick} onChange={setFacultyPick}
                      options={faculties.filter((f) => !(form.facultyIds || []).includes(f.id)).map((f) => ({ value: f.id, label: f.name }))}
                      placeholder="Fakultet qidirish..." />
                  </div>
                  <button type="button" className="btn-ghost shrink-0" onClick={addFaculty}>Qo'shish</button>
                </div>
                {(form.facultyIds || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(form.facultyIds || []).map((fid) => (
                      <span key={fid} className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-xs text-brand">
                        {faculties.find((f) => f.id === fid)?.name || `#${fid}`}
                        <button type="button" onClick={() => removeFaculty(fid)} className="hover:text-red-500"><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Field>
            <p className="text-xs text-slate-400">
              Fakultet(lar) tanlansa, jadval tuzishda bu binoning xonalarini FAQAT shu fakultet(lar) guruhlari egallaydi — boshqalarga berilmaydi.
              Bir nechta fakultet tanlansa, bino ular o'rtasida bo'lishiladi. Hech qaysi tanlanmasa — "asosiy" bino, hamma fakultet foydalanadi.
            </p>
          </> : <>
            <Field label="Bino">
              <SearchableSelect value={form.buildingId || ''} onChange={(v) => setForm({ ...form, buildingId: v })}
                options={buildings.map((b) => ({ value: b.id, label: b.name }))} placeholder="Bino qidirish..." />
            </Field>
            <Field label="Sigʻim"><input className="input" type="number" value={form.capacity || 0} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
            <Field label="Turi"><select className="input" value={form.kind || ''} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{['Maʼruza', 'Amaliy', 'Laboratoriya', 'Kompyuter'].map((v) => <option key={v}>{v}</option>)}</select></Field>
            <Field label="Kirish turi">
              <select className="input" value={form.type || 'umumiy'} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="umumiy">Ochiq — hamma foydalana oladi</option>
                <option value="maxsus">Maxsus — faqat ruxsat berilganlar</option>
              </select>
            </Field>
            {editing && form.type === 'maxsus' && (
              <p className="text-xs text-slate-400">
                Kimlarga ruxsat berilganini saqlagach, jadvaldagi <KeyRound size={12} className="mb-0.5 inline" /> tugmasidan boshqarasiz.
              </p>
            )}
            <Field label="Fan">
              <div className="space-y-2.5">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <SearchableSelect value={subjectPick} onChange={setSubjectPick}
                      options={subjects.filter((s) => !(form.subjectIds || []).includes(s.id)).map((s) => ({ value: s.id, label: s.name }))}
                      placeholder="Fan qidirish..." />
                  </div>
                  <button type="button" className="btn-ghost shrink-0" onClick={addSubject}>Qo'shish</button>
                </div>
                {(form.subjectIds || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(form.subjectIds || []).map((sid) => (
                      <span key={sid} className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-xs text-brand">
                        {subjects.find((s) => s.id === sid)?.name || `#${sid}`}
                        <button type="button" onClick={() => removeSubject(sid)} className="hover:text-red-500"><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                Fan tanlansa, shu fanning darslari (qaysi guruh/o'qituvchi bo'lishidan qat'i nazar) bu xonaga ustuvor bo'ladi — "Maxsus" turida FAQAT shu fan(lar) kira oladi.
              </p>
            </Field>
          </>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Bekor</button>
            <button type="submit" className="btn-primary">Saqlash</button>
          </div>
        </form>
      </Modal>

      <RoomPermissionsModal room={permRoom} onClose={() => setPermRoom(null)} />
    </div>
  )
}
