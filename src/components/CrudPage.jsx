import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { db, useCollection } from '../data/store'
import { PageHeader, SearchBar, Table, Modal, Field } from './ui'

const empty = (fields) => Object.fromEntries(fields.map((f) => [f.name, f.default ?? '']))

export default function CrudPage({ title, subtitle, icon, collection, fields, columns, renderCells }) {
  const rows = useCollection(collection)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(empty(fields))

  const filtered = rows.filter((r) =>
    Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase())
  )

  const openAdd = () => { setEditing(null); setForm(empty(fields)); setOpen(true) }
  const openEdit = (row) => { setEditing(row); setForm(row); setOpen(true) }

  const save = (e) => {
    e.preventDefault()
    const payload = { ...form }
    fields.forEach((f) => { if (f.type === 'number') payload[f.name] = Number(payload[f.name]) || 0 })
    if (editing) db.update(collection, editing.id, payload)
    else db.add(collection, payload)
    setOpen(false)
  }

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        count={rows.length}
        action={<button className="btn-primary" onClick={openAdd}><Plus size={16} /> Qo'shish</button>}
      />
      <SearchBar value={q} onChange={setQ} />
      <Table
        columns={[...columns, 'Amallar']}
        rows={filtered}
        renderRow={(row) => (
          <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30">
            {renderCells(row)}
            <td className="px-4 py-3">
              <div className="flex items-center gap-1">
                <button onClick={() => openEdit(row)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-800">
                  <Pencil size={15} />
                </button>
                <button onClick={() => confirm("O'chirishni tasdiqlaysizmi?") && db.remove(collection, row.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40">
                  <Trash2 size={15} />
                </button>
              </div>
            </td>
          </tr>
        )}
      />

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `${title} — tahrirlash` : `${title} — qo'shish`}>
        <form onSubmit={save} className="space-y-4">
          {fields.map((f) => (
            <Field key={f.name} label={f.label}>
              {f.type === 'select' ? (
                <select className="input" value={form[f.name]} onChange={(e) => setForm({ ...form, [f.name]: f.numeric ? Number(e.target.value) : e.target.value })}>
                  <option value="">—</option>
                  {f.options().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  className="input"
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={form[f.name]}
                  required={f.required}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                />
              )}
            </Field>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Bekor</button>
            <button type="submit" className="btn-primary">Saqlash</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
