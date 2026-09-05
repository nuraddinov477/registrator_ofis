import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { db, useCollection, useIsLoading, useLoadFailed, retry } from '../data/store'
import { canWrite } from '../lib/access'
import { PageHeader, SearchBar, Table, Modal, Field, DataState } from './ui'

const empty = (fields) => Object.fromEntries(fields.map((f) => [f.name, f.default ?? '']))

// extraActions(row) — amallar katagiga qo'shimcha tugmalar (masalan, almashtirish ustasi)
// filters — [{ name, label, options: () => [{value,label}] }] — hammasi to'ldirilganini
// tekshirish uchun (masalan fakultet/kurs bo'yicha filtrlab sonini ko'rish)
export default function CrudPage({ title, subtitle, icon, collection, fields, columns, renderCells, extraActions, filters }) {
  const rows = useCollection(collection)
  const loading = useIsLoading(collection)
  const failed = useLoadFailed(collection)
  const writable = canWrite(collection)
  const [q, setQ] = useState('')
  const [fv, setFv] = useState({}) // filtr qiymatlari: { [filterName]: value }
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(empty(fields))
  const [err, setErr] = useState('')

  const filtered = rows.filter((r) => {
    if (q && !Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase())) return false
    if (filters) {
      for (const f of filters) {
        const v = fv[f.name]
        if (v !== undefined && v !== '' && String(r[f.name]) !== String(v)) return false
      }
    }
    return true
  })
  const filtersActive = filters && Object.values(fv).some((v) => v !== undefined && v !== '')

  const openAdd = () => { setEditing(null); setForm(empty(fields)); setErr(''); setOpen(true) }
  const openEdit = (row) => { setEditing(row); setForm(row); setErr(''); setOpen(true) }

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    const payload = { ...form }
    fields.forEach((f) => { if (f.type === 'number') payload[f.name] = Number(payload[f.name]) || 0 })
    try {
      if (editing) await db.update(collection, editing.id, payload)
      else await db.add(collection, payload)
      setOpen(false)
    } catch (e) { setErr(e.message || 'Saqlashda xatolik') }
  }

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        count={rows.length}
        action={writable ? <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Qo'shish</button> : null}
      />
      <SearchBar value={q} onChange={setQ} />
      {filters && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <select
              key={f.name}
              className="input h-9 w-auto py-1"
              value={fv[f.name] ?? ''}
              onChange={(e) => setFv({ ...fv, [f.name]: e.target.value })}
            >
              <option value="">{f.label}</option>
              {f.options().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ))}
          {filtersActive && (
            <button className="text-sm text-slate-500 hover:text-brand" onClick={() => setFv({})}>Tozalash</button>
          )}
          <span className="text-xs text-slate-400">{filtered.length} ta natija</span>
        </div>
      )}
      {(loading || failed) && rows.length === 0 ? (
        <DataState loading={loading} onRetry={() => retry(collection)} />
      ) : (
      <Table
        columns={writable ? [...columns, 'Amallar'] : columns}
        rows={filtered}
        renderRow={(row) => (
          <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30">
            {renderCells(row)}
            {writable && (
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  {extraActions?.(row)}
                  <button onClick={() => openEdit(row)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-800">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => confirm("O'chirishni tasdiqlaysizmi?") && db.remove(collection, row.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40">
                    <Trash2 size={15} />
                  </button>
                </div>
              </td>
            )}
          </tr>
        )}
      />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `${title} — tahrirlash` : `${title} — qo'shish`}>
        <form onSubmit={save} className="space-y-4">
          {fields.map((f) => (
            <Field key={f.name} label={f.label}>
              {f.type === 'select' ? (
                <select className="input" value={form[f.name] ?? ''} onChange={(e) => setForm({ ...form, [f.name]: f.numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })}>
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
          {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Bekor</button>
            <button type="submit" className="btn-primary">Saqlash</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
