import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { db, useCollection } from '../data/store'
import { SearchBar, Table, Modal, Field, Badge } from '../components/ui'

export default function Rooms() {
  const buildings = useCollection('buildings')
  const rooms = useCollection('rooms')
  const [tab, setTab] = useState('buildings')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})

  const isB = tab === 'buildings'
  const coll = isB ? 'buildings' : 'rooms'
  const list = (isB ? buildings : rooms).filter((r) => Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase()))

  const openAdd = () => { setEditing(null); setForm(isB ? { name: '', floors: 1, address: '' } : { name: '', buildingId: '', capacity: 30, type: 'Maʼruza' }); setOpen(true) }
  const openEdit = (r) => { setEditing(r); setForm(r); setOpen(true) }
  const save = (e) => {
    e.preventDefault()
    const p = { ...form }
    if (isB) p.floors = Number(p.floors) || 1
    else { p.capacity = Number(p.capacity) || 0; p.buildingId = Number(p.buildingId) || '' }
    editing ? db.update(coll, editing.id, p) : db.add(coll, p)
    setOpen(false)
  }
  const bName = (id) => buildings.find((b) => b.id === id)?.name || '—'

  const TabBtn = ({ id, children }) => (
    <button onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === id ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{children}</button>
  )

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Bino va xonalar</h1>
        <button className="btn-primary" onClick={openAdd}><Plus size={16} /> {isB ? 'Bino' : 'Xona'} qo'shish</button>
      </div>
      <SearchBar value={q} onChange={setQ} />
      <div className="mb-4 inline-flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/60">
        <TabBtn id="buildings">Binolar ({buildings.length})</TabBtn>
        <TabBtn id="rooms">Xonalar ({rooms.length})</TabBtn>
      </div>

      <Table
        columns={isB ? ['Nomi', 'Qavatlar', 'Manzil', 'Amallar'] : ['Nomi', 'Bino', 'Sigʻim', 'Turi', 'Amallar']}
        rows={list}
        renderRow={(r) => (
          <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30">
            <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{r.name}</td>
            {isB ? <>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{r.floors}</td>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{r.address || '—'}</td>
            </> : <>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{bName(r.buildingId)}</td>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{r.capacity}</td>
              <td className="px-4 py-3"><Badge>{r.type}</Badge></td>
            </>}
            <td className="px-4 py-3">
              <div className="flex gap-1">
                <button onClick={() => openEdit(r)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-800"><Pencil size={15} /></button>
                <button onClick={() => confirm("O'chirilsinmi?") && db.remove(coll, r.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"><Trash2 size={15} /></button>
              </div>
            </td>
          </tr>
        )}
      />

      <Modal open={open} onClose={() => setOpen(false)} title={`${isB ? 'Bino' : 'Xona'} ${editing ? 'tahrirlash' : "qo'shish"}`}>
        <form onSubmit={save} className="space-y-4">
          <Field label="Nomi"><input className="input" required value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          {isB ? <>
            <Field label="Qavatlar"><input className="input" type="number" value={form.floors || 1} onChange={(e) => setForm({ ...form, floors: e.target.value })} /></Field>
            <Field label="Manzil"><input className="input" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          </> : <>
            <Field label="Bino"><select className="input" value={form.buildingId || ''} onChange={(e) => setForm({ ...form, buildingId: e.target.value })}><option value="">—</option>{buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            <Field label="Sigʻim"><input className="input" type="number" value={form.capacity || 0} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
            <Field label="Turi"><select className="input" value={form.type || ''} onChange={(e) => setForm({ ...form, type: e.target.value })}>{['Maʼruza', 'Amaliy', 'Laboratoriya', 'Kompyuter'].map((v) => <option key={v}>{v}</option>)}</select></Field>
          </>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Bekor</button>
            <button type="submit" className="btn-primary">Saqlash</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
