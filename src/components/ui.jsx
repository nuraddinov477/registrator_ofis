import { useEffect, useRef, useState } from 'react'
import { X, Search, ChevronDown, Check } from 'lucide-react'

export function PageHeader({ title, subtitle, icon: Icon, count, action }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-lg bg-brand/15 text-brand">
            <Icon size={20} />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          {count != null && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Jami: {count}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

export function SearchBar({ value, onChange, placeholder = 'Qidirish...' }) {
  return (
    <div className="relative mb-4">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        className="input pl-9"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function Table({ columns, rows, renderRow, empty = 'Maʼlumot topilmadi' }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
              {columns.map((c) => (
                <th key={c} className="px-4 py-3 font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-400">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map(renderRow)
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// Qidiruvli tanlov — ro'yxat uzun bo'lganda (o'qituvchi, fan, guruh) oddiy
// <select>'dan qulayroq: matn kiritib filtrlaydi, sichqoncha bilan tanlaydi.
// options: [{ value, label }]. `multi` — bir nechta tanlash (potok guruhlari kabi):
// `value` massiv bo'ladi, tanlanganlar chip (✕ bilan) ko'rinadi, ro'yxat yopilmay turadi.
export function SearchableSelect({ value, onChange, options, placeholder = 'Qidirish...', multi = false, emptyLabel = '—' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)
  const selectedValues = multi ? (Array.isArray(value) ? value.map(String) : []) : null
  const selected = !multi ? options.find((o) => String(o.value) === String(value)) : null

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const filtered = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))

  const toggle = (v) => {
    const cur = Array.isArray(value) ? value : []
    const has = cur.some((x) => String(x) === String(v))
    onChange(has ? cur.filter((x) => String(x) !== String(v)) : [...cur, v])
  }
  const removeChip = (v) => onChange((Array.isArray(value) ? value : []).filter((x) => String(x) !== String(v)))

  return (
    <div className="relative" ref={ref}>
      {multi && selectedValues.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {selectedValues.map((v) => {
            const o = options.find((x) => String(x.value) === v)
            return (
              <span key={v} className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-xs text-brand">
                {o?.label ?? v}
                <button type="button" onClick={() => removeChip(v)} className="hover:text-red-500"><X size={12} /></button>
              </span>
            )
          })}
        </div>
      )}
      <button
        type="button"
        className="input flex items-center justify-between text-left"
        onClick={() => { setOpen((o) => !o); setQ('') }}
      >
        {multi ? (
          <span className="text-slate-400">{selectedValues.length ? `${selectedValues.length} ta tanlandi — qo'shish uchun bosing` : '—'}</span>
        ) : (
          <span className={`truncate ${selected ? '' : 'text-slate-400'}`}>{selected ? selected.label : emptyLabel}</span>
        )}
        <ChevronDown size={16} className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <div className="relative p-1.5">
            <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              className="input py-1.5 pl-8 text-sm"
              placeholder={placeholder}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {!multi && (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={() => { onChange(''); setOpen(false) }}
              >{emptyLabel}</button>
            )}
            {filtered.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">Topilmadi</div>}
            {filtered.map((o) => {
              const isSel = multi ? selectedValues.includes(String(o.value)) : String(o.value) === String(value)
              return (
                <button
                  key={o.value}
                  type="button"
                  className={`flex w-full items-center justify-between gap-2 truncate px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 ${isSel ? 'bg-brand/10 text-brand' : ''}`}
                  onClick={() => { if (multi) toggle(o.value); else { onChange(o.value); setOpen(false) } }}
                >
                  <span className="truncate">{o.label}</span>
                  {multi && isSel && <Check size={14} className="shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// Ro'yxat hali yuklanayotgan yoki qayta urinishlar tugab muvaffaqiyatsiz bo'lgan holat.
// Ikkisi orasidagi farq muhim: "loading" — kuting, "failed" — internetni tekshirib qayta urining.
export function DataState({ loading, onRetry }) {
  if (loading) {
    return <div className="card p-10 text-center text-slate-400">Yuklanmoqda… (server uxlab qolgan bo'lishi mumkin, biroz kuting)</div>
  }
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <p className="text-slate-400">Ma'lumotlarni yuklab bo'lmadi — internet aloqasini tekshiring yoki qayta urinib ko'ring.</p>
      <button onClick={onRetry} className="btn-primary">Qayta urinish</button>
    </div>
  )
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  )
}

export function Badge({ children, color = 'blue' }) {
  const map = {
    blue: 'bg-brand/15 text-brand',
    green: 'bg-emerald-500/15 text-emerald-500',
    gray: 'bg-slate-500/15 text-slate-400',
    amber: 'bg-amber-500/15 text-amber-500',
    red: 'bg-red-500/15 text-red-500',
  }
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${map[color]}`}>{children}</span>
}
