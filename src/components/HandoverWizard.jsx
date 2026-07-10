import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, CalendarClock } from 'lucide-react'
import { api } from '../api/client'
import { db } from '../data/store'
import { Modal, Field, Badge } from './ui'

// ─────────────────── Almashtirish ustasi (dekret / ta'til) ───────────────────
// O'qituvchining barcha yuklamalarini bir oynada hamkasblarga taqsimlaydi.
// Har yuklamaga tizim eng mos nomzodni oldindan tanlab qo'yadi:
// shu fanni o'qitadigan va yuklamasi eng kam bo'lgan faol kafedradosh.

const STATUS_LABELS = { dekret: 'Dekret', "ta'til": "Ta'til" }

export default function HandoverWizard({ teacher, onClose }) {
  const [plan, setPlan] = useState(null)
  const [picks, setPicks] = useState({}) // workloadId -> toTeacherId
  const [status, setStatus] = useState('dekret')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => {
    if (!teacher) return
    setPlan(null); setError(''); setDone(null); setStatus('dekret')
    api(`/teachers/${teacher.id}/handover-plan`)
      .then((p) => {
        setPlan(p)
        setPicks(Object.fromEntries(p.workloads.map((w) => [w.id, w.suggestedTeacherId || ''])))
      })
      .catch((e) => setError(e.message))
  }, [teacher])

  if (!teacher) return null

  // Har yuklama uchun nomzodlar: shu fanni o'qitadiganlar oldinda, soati kami birinchi
  const optionsFor = (w) =>
    [...(plan?.candidates || [])].sort((a, b) => {
      const at = a.subjectIds.includes(w.subjectId) ? 0 : 1
      const bt = b.subjectIds.includes(w.subjectId) ? 0 : 1
      return at - bt || a.totalHours - b.totalHours
    })

  const allPicked = plan && plan.workloads.every((w) => picks[w.id])

  const submit = async () => {
    setBusy(true); setError('')
    try {
      const r = await api(`/teachers/${teacher.id}/handover`, {
        method: 'POST',
        body: {
          status,
          assignments: plan.workloads.map((w) => ({ workloadId: w.id, toTeacherId: Number(picks[w.id]) })),
        },
      })
      setDone(r)
      db.reset() // teachers, loads, audit yangilansin
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!teacher} onClose={onClose} title={`Almashtirish — ${teacher.fullName}`}>
      {done ? (
        <div className="space-y-4 text-center">
          <CheckCircle2 size={44} className="mx-auto text-emerald-500" />
          <p className="text-slate-700 dark:text-slate-200">
            <b>{done.moved} ta yuklama</b> hamkasblarga o'tkazildi, holat:{' '}
            <Badge color="amber">{STATUS_LABELS[done.status]}</Badge>
          </p>
          <p className="text-sm text-slate-500">Endi jadvalni qayta generatsiya qiling — yangi taqsimot kuchga kirsin.</p>
          <div className="flex justify-center gap-2">
            <button className="btn-ghost" onClick={onClose}>Yopish</button>
            <Link to="/schedule" className="btn-primary" onClick={onClose}>
              <CalendarClock size={16} /> Jadvalni qayta generatsiya
            </Link>
          </div>
        </div>
      ) : !plan ? (
        <p className="py-6 text-center text-sm text-slate-500">{error || 'Yuklanmoqda...'}</p>
      ) : (
        <div className="space-y-4">
          <Field label="Yangi holat">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>

          {plan.workloads.length === 0 ? (
            <p className="text-sm text-slate-500">Yuklamalari yo'q — faqat holat o'zgaradi.</p>
          ) : plan.candidates.length === 0 ? (
            <p className="text-sm text-red-500">Kafedrada boshqa faol o'qituvchi yo'q — avval o'qituvchi qo'shing.</p>
          ) : (
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {plan.workloads.map((w) => (
                <div key={w.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{w.subject}</span>
                    <span className="text-slate-500">{w.group} · {w.weeklyHours} juftlik/hafta</span>
                  </div>
                  <select className="input" value={picks[w.id] || ''} onChange={(e) => setPicks({ ...picks, [w.id]: e.target.value })}>
                    <option value="">— qabul qiluvchini tanlang —</option>
                    {optionsFor(w).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName} · {c.totalHours} soat{c.subjectIds.includes(w.subjectId) ? " · shu fanni o'qitadi ✓" : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={onClose}>Bekor</button>
            <button
              className="btn-primary"
              disabled={busy || !allPicked || (plan.workloads.length > 0 && plan.candidates.length === 0)}
              onClick={submit}
            >
              {busy ? 'Bajarilmoqda...' : "Tasdiqlash — yuklamalarni o'tkazish"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
