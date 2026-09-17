import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, DoorClosed, Hourglass, ExternalLink, KeyRound, UserCog, CalendarSearch, Lightbulb, Loader2 } from 'lucide-react'
import { db } from '../data/store'
import { canWrite } from '../lib/access'

// Tuzatish sahifasi YANGI oynada ochiladi — tashxis ro'yxati shu yerda qoladi,
// tuzatib bo'lgach "Tekshirish"ni qayta bosish kifoya.
function FixLink({ to, children }) {
  return (
    <a href={to} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-md border border-black/10 px-1.5 py-0.5 text-xs font-medium opacity-90 hover:bg-white/40 hover:opacity-100 dark:border-white/15 dark:hover:bg-white/5">
      {children} <ExternalLink size={11} />
    </a>
  )
}

function FixButton({ onClick, icon: Icon, children, busy }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className="inline-flex items-center gap-1 rounded-md border border-black/10 px-1.5 py-0.5 text-xs font-medium opacity-90 hover:bg-white/40 hover:opacity-100 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/5">
      {busy ? <Loader2 size={11} className="animate-spin" /> : Icon && <Icon size={11} />} {children}
    </button>
  )
}

// Ikkiga bo'lingan katta seminar sinfining qaysi yarmi
const partLabel = (item) => (item.part ? ` (seminar sinfining ${item.part.split('/')[0]}-yarmi)` : '')

const Actions = ({ children }) => <div className="mt-1 flex flex-wrap items-center gap-1.5">{children}</div>

const Section = ({ icon: Icon, title, color, children }) => (
  <div className={`rounded-lg border px-3 py-2.5 ${color}`}>
    <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><Icon size={15} /> {title}</div>
    <ul className="space-y-2 text-sm">{children}</ul>
  </div>
)

// Jadval tashxisi — nima uchun jadval to'liq tuzilmadi (yoki tuzilmasligi mumkin):
// har bir muammoni ANIQ manzili (qaysi guruh/o'qituvchi/dars) va sababi bilan ko'rsatadi,
// yoniga tuzatish havolasi va (xonasiz darslar uchun) mos xona tavsiyasini qo'yadi.
//   onTeacherConstraints(teacherId) — o'qituvchi istisnolari oynasini shu o'qituvchi bilan ochish
//   onShowGroup(groupId)            — guruh jadvalini ko'rsatish (oynalar uchun)
//   onChanged()                     — tavsiya qo'llangach (masalan ruxsat berilgach) tekshiruvni yangilash
export default function ScheduleDiagnostics({ diagnostics, dense = false, onTeacherConstraints, onShowGroup, onChanged }) {
  const [granted, setGranted] = useState({}) // "yuklama:xona" → true
  const [grantErr, setGrantErr] = useState({})
  const [busyKey, setBusyKey] = useState('')
  if (!diagnostics) return null
  const { groupOverload = [], teacherOverload = [], blocked = [], unresolved = [], loadWarnings = [], gaps = [] } = diagnostics
  const total = groupOverload.length + teacherOverload.length + blocked.length + unresolved.length + loadWarnings.length + gaps.length
  const canGrant = canWrite('room-permissions')

  if (total === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-600 dark:text-emerald-300">
        <CheckCircle2 size={16} /> Ma'lumotda cheklov buzilishi topilmadi — jadval to'liq tuzilishi mumkin.
      </div>
    )
  }

  // Xonaga shu darsning guruh(lar)iga kirish ruxsatini berish — "boshqa fakultet binosi" va
  // "maxsus xona" sabablarini bir bosishda yechadi
  const grant = async (item, room) => {
    const key = `${item.workloadId}:${room.roomId}`
    if (!confirm(`"${room.room}" xonasiga ${item.group} guruh(lar)iga kirish ruxsati berilsinmi?`)) return
    setBusyKey(key)
    setGrantErr((x) => ({ ...x, [key]: '' }))
    try {
      for (const groupId of item.groupIds || []) await db.add('roomPermissions', { roomId: room.roomId, groupId })
      setGranted((x) => ({ ...x, [key]: true }))
      onChanged?.()
    } catch (e) {
      setGrantErr((x) => ({ ...x, [key]: e.message || "Ruxsat berib bo'lmadi" }))
    } finally { setBusyKey('') }
  }

  const groupLoadsLink = (groupId) => groupId != null && <FixLink to={`/loads?group=${groupId}`}>Guruh yuklamalari</FixLink>
  const workloadLink = (workloadId) => workloadId != null && <FixLink to={`/loads?edit=${workloadId}`}>Yuklamani ochish</FixLink>
  const constraintButton = (teacherId) => teacherId != null && onTeacherConstraints && (
    <FixButton icon={UserCog} onClick={() => onTeacherConstraints(teacherId)}>O'qituvchi istisnosi</FixButton>
  )

  const suggestionList = (item) => {
    const list = item.suggestions || []
    if (!['room', 'two_para', 'between'].includes(item.kind) || list.length === 0) return null
    const fixable = list.some((s) => s.fixable)
    return (
      <div className="mt-1.5 rounded-md bg-white/50 px-2 py-1.5 text-xs dark:bg-slate-900/40">
        <div className="mb-1 flex items-center gap-1 font-semibold">
          <Lightbulb size={12} /> {fixable ? "Tavsiya: ruxsat berilsa shu xonalar sig'adi" : 'Eng yaqin xonalar va nega mos emasligi'}
        </div>
        <ul className="space-y-1">
          {list.map((s) => {
            const key = `${item.workloadId}:${s.roomId}`
            return (
              <li key={s.roomId} className="flex flex-wrap items-center gap-1.5">
                <span>
                  <b>{s.room}</b>{s.more > 0 && <> va yana {s.more} ta shunday xona</>} ({s.capacity} o'rin) — {s.problem}
                </span>
                {granted[key] ? (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={12} /> ruxsat berildi
                  </span>
                ) : s.fixable && canGrant && item.groupIds?.length ? (
                  <FixButton icon={KeyRound} busy={busyKey === key} onClick={() => grant(item, s)}>Ruxsat berish</FixButton>
                ) : (
                  <FixLink to={`/rooms?room=${s.roomId}`}>Xonani ochish</FixLink>
                )}
                {grantErr[key] && <span className="text-red-500">{grantErr[key]}</span>}
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <div className={`space-y-2 ${dense ? '' : 'mb-4'}`}>
      {loadWarnings.length > 0 && (
        <Section icon={AlertTriangle} title={`Guruh haftalik yuklamasi me'yordan tashqarida (${loadWarnings.length})`}
          color="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300">
          {loadWarnings.map((w, i) => (
            <li key={i}>
              <b>{w.group}</b> ({w.course}-kurs): haftada <b>{w.needed}</b> ta dars —
              {' '}{w.kind === 'kop' ? <>me'yordan (14-15) <b>ko'p</b> ({w.needed - 15} ta ortiqcha)</> : <>me'yordan (14-15) <b>kam</b> ({14 - w.needed} ta yetishmaydi)</>}.
              <Actions>{groupLoadsLink(w.groupId)}</Actions>
            </li>
          ))}
        </Section>
      )}

      {groupOverload.length > 0 && (
        <Section icon={AlertTriangle} title={`Guruh yuklamasi oshib ketgan (${groupOverload.length})`}
          color="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300">
          {groupOverload.map((g, i) => (
            <li key={i}>
              <b>{g.group}</b> ({g.course}-kurs): haftada <b>{g.needed}</b> ta dars belgilangan, lekin {g.shift}da atigi <b>{g.capacity}</b> ta joy bor.
              {' '}<span className="opacity-80">— {g.needed - g.capacity} ta darsni kamaytiring yoki "Jadval yaratish" oynasida bu guruhning juftlik oralig'ini kengaytiring.</span>
              <Actions>{groupLoadsLink(g.groupId)}</Actions>
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
              <Actions>
                {constraintButton(t.teacherId)}
                {t.teacherId != null && <FixLink to={`/loads?teacher=${t.teacherId}`}>O'qituvchi yuklamalari</FixLink>}
              </Actions>
            </li>
          ))}
        </Section>
      )}

      {blocked.length > 0 && (
        <Section icon={DoorClosed} title={`Xonasiz / vaqtsiz qolgan darslar (${blocked.length})`}
          color="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
          {blocked.map((b, i) => (
            <li key={i}>
              <b>{b.subject}</b> — {b.group}{partLabel(b)}{b.teacher ? ` · ${b.teacher}` : ''}{b.count > 1 ? ` (${b.count} ta dars)` : ''}: {b.reason}.
              {b.kind === 'potok_range' && (
                <span className="opacity-80"> — "Jadval yaratish" oynasida bu guruhlarning juftlik oraliqlarini moslang.</span>
              )}
              {b.kind === 'between' && (
                <span className="opacity-80">
                  {' '}— Potok tarkibini o'zgartiring: yana guruh qo'shib 65 talabaga yetkazing yoki potokni ikkiga bo'ling (har biri 60 talabagacha).
                </span>
              )}
              {b.kind === 'two_para' && (
                <span className="opacity-80">
                  {' '}— Haftasiga 2 soatlik katta potok{b.size != null && <> ({b.size} talaba)</>} faqat Dushanba–Chorshanba kunlari
                  asosiy binodagi katta zalda o'tadi. Katta zal qo'shing yoki yuklamaning haftalik soatini o'zgartiring.
                </span>
              )}
              <Actions>
                {workloadLink(b.workloadId)}
                {b.kind === 'time' && constraintButton(b.teacherId)}
              </Actions>
              {suggestionList(b)}
            </li>
          ))}
        </Section>
      )}

      {unresolved.length > 0 && (
        <Section icon={Clock} title={`Joylashtirib bo'lmagan darslar (${unresolved.length})`}
          color="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
          {unresolved.map((u, i) => (
            <li key={i}>
              <b>{u.subject}</b> — {u.group}{partLabel(u)}{u.teacher ? ` · ${u.teacher}` : ''}{u.count > 1 ? ` (${u.count} ta)` : ''}: to'qnashuvsiz bo'sh o'rin qolmadi (umumiy o'ta yuklama). Optimallashtirish vaqtini oshiring yoki yuklamani kamaytiring.
              <Actions>
                {workloadLink(u.workloadId)}
                {constraintButton(u.teacherId)}
              </Actions>
            </li>
          ))}
        </Section>
      )}

      {gaps.length > 0 && (
        <Section icon={Hourglass} title={`Yo'qotib bo'lmagan oynalar (${gaps.length})`}
          color="border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-300">
          {gaps.map((g, i) => (
            <li key={i}>
              <b>{g.group}</b>, {g.dayName}: {g.pairs.join(', ')}-juftlik darslar orasida bo'sh qoldi.
              {' '}<span className="opacity-80">— Darsni jadvalda sudrab boshqa katakka o'tkazing, yoki optimallashtirish vaqtini oshiring / o'qituvchi istisnolarini yoki guruhning juftlik oralig'ini kengaytiring.</span>
              {g.groupId != null && onShowGroup && (
                <Actions>
                  <FixButton icon={CalendarSearch} onClick={() => onShowGroup(g.groupId)}>Jadvalda ko'rsatish</FixButton>
                </Actions>
              )}
            </li>
          ))}
        </Section>
      )}
    </div>
  )
}
