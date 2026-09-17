import { CheckCircle2, Users, UserCog, DoorClosed, Hourglass } from 'lucide-react'

const TYPE_META = {
  group: { icon: Users, title: 'Guruh to\'qnashuvi', color: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300' },
  teacher: { icon: UserCog, title: 'O\'qituvchi to\'qnashuvi', color: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300' },
  room: { icon: DoorClosed, title: 'Xona to\'qnashuvi', color: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300' },
  gap: { icon: Hourglass, title: 'Oyna (bo\'sh juftlik)', color: 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-300' },
}

// "Qattiq buzilish" (hardScore) ning ORQASIDAGI aniq manzillari: qaysi kun/juftlikda
// qaysi guruh/o'qituvchi/xona uchun 2+ dars bir vaqtga to'qnashib qolgan, yoki guruh
// kunida darslar orasida bo'sh juftlik (oyna) qolgan.
export default function ScheduleViolations({ violations }) {
  if (!violations) return null
  if (violations.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-600 dark:text-emerald-300">
        <CheckCircle2 size={16} /> Qattiq buzilish topilmadi — vaqt to'qnashuvi ham, oyna ham yo'q.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {violations.map((v, i) => {
        const meta = TYPE_META[v.type] || TYPE_META.group
        const Icon = meta.icon
        return (
          <div key={i} className={`rounded-lg border px-3 py-2.5 ${meta.color}`}>
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
              <Icon size={15} /> {meta.title}: <b>{v.entityName}</b>
              <span className="font-normal opacity-80">
                — {v.dayName}, {v.type === 'gap' ? `${v.gapPairs.join(', ')}-juftlik bo'sh (darslar orasida)` : `${v.pair}-juftlik`}
              </span>
            </div>
            <ul className="space-y-0.5 text-sm">
              {v.lessons.map((l, j) => (
                <li key={j} className="opacity-90">
                  {v.type === 'gap' && <span className="mr-1 opacity-70">{l.pair}-juftlik:</span>}
                  <b>{l.subject}</b> ({l.type}) — {l.group} · {l.teacher} · {l.room}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
