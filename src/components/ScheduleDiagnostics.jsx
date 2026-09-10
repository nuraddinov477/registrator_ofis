import { AlertTriangle, CheckCircle2, XCircle, Clock, DoorClosed } from 'lucide-react'

// Jadval tashxisi — nima uchun jadval to'liq tuzilmadi (yoki tuzilmasligi mumkin):
// har bir muammoni ANIQ manzili (qaysi guruh/o'qituvchi/dars) va sababi bilan ko'rsatadi.
export default function ScheduleDiagnostics({ diagnostics, dense = false }) {
  if (!diagnostics) return null
  const { groupOverload = [], teacherOverload = [], blocked = [], unresolved = [] } = diagnostics
  const total = groupOverload.length + teacherOverload.length + blocked.length + unresolved.length

  if (total === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-600 dark:text-emerald-300">
        <CheckCircle2 size={16} /> Ma'lumotda cheklov buzilishi topilmadi — jadval to'liq tuzilishi mumkin.
      </div>
    )
  }

  const Section = ({ icon: Icon, title, color, children }) => (
    <div className={`rounded-lg border px-3 py-2.5 ${color}`}>
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><Icon size={15} /> {title}</div>
      <ul className="space-y-1 text-sm">{children}</ul>
    </div>
  )

  return (
    <div className={`space-y-2 ${dense ? '' : 'mb-4'}`}>
      {groupOverload.length > 0 && (
        <Section icon={AlertTriangle} title={`Guruh yuklamasi oshib ketgan (${groupOverload.length})`}
          color="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300">
          {groupOverload.map((g, i) => (
            <li key={i}>
              <b>{g.group}</b> ({g.course}-kurs): haftada <b>{g.needed}</b> ta dars belgilangan, lekin {g.shift}da atigi <b>{g.capacity}</b> ta joy bor.
              {' '}<span className="opacity-80">— {g.needed - g.capacity} ta darsni kamaytiring yoki bu kursni boshqa smenaga o'tkazing.</span>
            </li>
          ))}
        </Section>
      )}

      {teacherOverload.length > 0 && (
        <Section icon={AlertTriangle} title={`O'qituvchi yuklamasi oshib ketgan (${teacherOverload.length})`}
          color="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300">
          {teacherOverload.map((t, i) => (
            <li key={i}>
              <b>{t.teacher}</b>: haftada <b>{t.needed}</b> ta dars, lekin bo'sh vaqti <b>{t.capacity}</b> ta juftlik (istisnolarni hisobga olganda).
            </li>
          ))}
        </Section>
      )}

      {blocked.length > 0 && (
        <Section icon={DoorClosed} title={`Xonasiz / vaqtsiz qolgan darslar (${blocked.length})`}
          color="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300">
          {blocked.map((b, i) => (
            <li key={i}>
              <b>{b.subject}</b> — {b.group}{b.teacher ? ` · ${b.teacher}` : ''}{b.count > 1 ? ` (${b.count} ta dars)` : ''}: {b.reason}.
            </li>
          ))}
        </Section>
      )}

      {unresolved.length > 0 && (
        <Section icon={Clock} title={`Joylashtirib bo'lmagan darslar (${unresolved.length})`}
          color="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300">
          {unresolved.map((u, i) => (
            <li key={i}>
              <b>{u.subject}</b> — {u.group}{u.teacher ? ` · ${u.teacher}` : ''}{u.count > 1 ? ` (${u.count} ta)` : ''}: to'qnashuvsiz bo'sh o'rin qolmadi (umumiy o'ta yuklama). Optimallashtirish vaqtini oshiring yoki yuklamani kamaytiring.
            </li>
          ))}
        </Section>
      )}
    </div>
  )
}
