import { useEffect, useState } from 'react'
import { Layers, GitMerge, CheckCircle2, TrendingUp, Users } from 'lucide-react'
import { api } from '../api/client'
import { PageHeader, Badge, DataState } from '../components/ui'

const Tile = ({ label, value, icon: Icon, color }) => (
  <div className="card flex items-center justify-between p-4">
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1.5 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white ${color}`}>
      <Icon size={18} />
    </div>
  </div>
)

// Potok qayerda o'tadi (jadval tuzish qoidalari bilan bir xil)
const PLACEMENT = {
  hall: { color: 'green', label: 'Katta zalda' },
  split: { color: 'blue', label: 'Ikkiga bo\'linadi' },
  regular: { color: 'gray', label: 'Oddiy xonada' },
  between: { color: 'amber', label: 'Hech qayerga sig\'maydi' },
  too_big: { color: 'red', label: 'Katta zalga sig\'maydi' },
}
const placementBadge = (e) => {
  const p = PLACEMENT[e.placement] || (e.fits ? PLACEMENT.hall : PLACEMENT.between)
  return <Badge color={p.color}>{p.label}</Badge>
}

// Potok (bir nechta guruh birga o'qiydigan) fanlar bo'yicha hisob-kitob — FAQAT mavjud
// Yuklamaga asoslanadi (tavsiya/taxmin YO'Q): mavjud potoklar va ularning Katta zalga
// (65-105 talaba) mosligi, umumiy statistika. Faqat ko'rsatuv — hech narsani
// o'zgartirmaydi (yuklamalarni "O'quv yuklamasi" bo'limida tahrirlang).
export default function Potok() {
  const [semester, setSemester] = useState('1')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true); setErr('')
    api(`/potok-report?semester=${semester}`)
      .then((r) => { if (alive) setData(r) })
      .catch((e) => { if (alive) setErr(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [semester, reloadKey])

  return (
    <div>
      <PageHeader title="Potok fanlar hisob-kitobi" icon={Layers}
        subtitle="Bir nechta guruh birga o'qiydigan (potok) fanlar va ular qayerda o'tishi: katta zal faqat 65-105 talabali sinfga, katta seminar sinfi ikkiga bo'linadi — mavjud yuklamaga asosan" />

      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-slate-500 dark:text-slate-400">Semestr:</span>
        <select className="input h-9 w-auto py-1" value={semester} onChange={(e) => setSemester(e.target.value)}>
          <option value="1">1-semestr</option>
          <option value="2">2-semestr</option>
        </select>
      </div>

      {(loading || err) && !data ? (
        <DataState loading={loading} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : err ? (
        <p className="text-sm text-red-500">{err}</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Potoklar soni" value={data.stats.potokCount} icon={GitMerge} color="bg-blue-500" />
            <Tile label="Haftalik potok-soat" value={data.stats.totalPotokWeeklyHours} icon={TrendingUp} color="bg-cyan-500" />
            <Tile label="Tejalgan xona/vaqt" value={data.stats.slotsSaved} icon={CheckCircle2} color="bg-emerald-500" />
            <Tile label="Potokdagi talabalar" value={data.stats.studentsInPotok} icon={Users} color="bg-violet-500" />
          </div>

          <div>
            <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
              Mavjud potoklar ({data.existing.length})
            </h2>
            {data.existing.length === 0 ? (
              <p className="text-sm text-slate-400">Bu semestrda potok (bir nechta guruh birga) fan yo'q.</p>
            ) : (
              <div className="space-y-2">
                {data.existing.map((e) => (
                  <div key={e.workloadId} className="card p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium text-slate-800 dark:text-slate-100">{e.subject}</span>
                        <span className="ml-2 text-xs text-slate-400">{e.teacher} · {e.type} · {e.weeklyHours} soat/hafta</span>
                      </div>
                      {placementBadge(e)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {e.groups.map((g) => <Badge key={g.id} color="gray">{g.name} ({g.size})</Badge>)}
                      <Badge color="blue">jami: {e.totalSize}</Badge>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{e.note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
