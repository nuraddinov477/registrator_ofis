import { useState } from 'react'
import { FileSpreadsheet, FileText } from 'lucide-react'
import { api } from '../api/client'
import { useCollection } from '../data/store'
import { Modal, Field, SearchableSelect } from './ui'

// Tayyor jadvalni yuklab olish — Fakultet → Kurs → Guruh ketma-ketligida filtrlab,
// tanlangan guruhning jadvalini Excel (.xlsx) yoki PDF sifatida yuklab beradi. Guruh
// ixtiyoriy: tanlanmasa, joriy Fakultet/Kurs filtriga mos BARCHA guruhlar (yoki
// hech biri tanlanmagan bo'lsa — mutlaqo barcha guruhlar) bitta faylga yig'ib yuklanadi.
export default function ScheduleExportModal({ open, onClose, runId }) {
  const faculties = useCollection('faculties')
  const groups = useCollection('groups')
  const [facultyId, setFacultyId] = useState('')
  const [course, setCourse] = useState('')
  const [groupId, setGroupId] = useState('')
  const [busy, setBusy] = useState('') // '' | 'xlsx' | 'pdf'
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState(null) // { done, total } | null — ko'p guruhli yuklashda

  const byFaculty = facultyId ? groups.filter((g) => String(g.facultyId) === String(facultyId)) : groups
  const courses = [...new Set(byFaculty.map((g) => g.course))].sort((a, b) => a - b)
  const byCourse = course ? byFaculty.filter((g) => String(g.course) === String(course)) : byFaculty

  const reset = () => { setFacultyId(''); setCourse(''); setGroupId(''); setErr('') }
  const close = () => { reset(); onClose() }

  const groupName = groups.find((g) => g.id === Number(groupId))?.name || ''
  // Guruh tanlanmasa — joriy filtrga mos guruhlarning HAMMASI (kamida 1 tasi bo'lishi kerak)
  const targetGroups = groupId ? groups.filter((g) => g.id === Number(groupId)) : byCourse

  // Bitta guruhning jadvalini yuklaydi — vaqtinchalik tarmoq xatosida (masalan ko'p
  // so'rov bir vaqtda ketganda "Failed to fetch") 2 marta qayta urinadi.
  const fetchOne = async (g, attempt = 1) => {
    try {
      return { group: g, ...(await api(`/schedule/runs/${runId}/grid?groupId=${g.id}`)) }
    } catch (e) {
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 400 * attempt)); return fetchOne(g, attempt + 1) }
      return { group: g, error: e.message || 'Yuklab bo\'lmadi' }
    }
  }

  // Ko'p guruh bo'lsa (masalan 300+) BARCHASINI bir vaqtda so'rasak brauzer/server
  // ortiqcha yuklanib "Failed to fetch" beradi — shu sabab CHEKLANGAN parallel (navbat
  // bilan, bir vaqtda atigi 6 tasi) yuklaymiz, progress ko'rsatib boramiz.
  const fetchGrids = async () => {
    if (!runId) throw new Error('Jadval tanlanmagan')
    if (targetGroups.length === 0) throw new Error('Mos guruh topilmadi')
    const CONCURRENCY = 6
    const results = new Array(targetGroups.length)
    let doneCount = 0, idx = 0
    setProgress({ done: 0, total: targetGroups.length })
    const worker = async () => {
      while (idx < targetGroups.length) {
        const i = idx++
        results[i] = await fetchOne(targetGroups[i])
        doneCount++
        setProgress({ done: doneCount, total: targetGroups.length })
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targetGroups.length) }, worker))
    setProgress(null)
    const ok = results.filter((r) => !r.error)
    const failed = results.filter((r) => r.error)
    if (ok.length === 0) throw new Error('Hech qanday guruh jadvalini yuklab bo\'lmadi — internet aloqasini tekshiring')
    return { ok, failed }
  }

  const cellText = (c) => (c ? [c.subject, c.teacher, c.room].filter(Boolean).join('\n') : '')
  // Bir nechta guruh bo'lsa — fayl nomi umumiylashtiriladi (fakultet/kurs nomi bilan)
  const bundleLabel = () => {
    if (groupId) return groupName || groupId
    const fac = faculties.find((f) => String(f.id) === String(facultyId))?.name
    if (fac && course) return `${fac}-${course}-kurs`
    if (fac) return fac
    if (course) return `${course}-kurs`
    return 'barcha-guruhlar'
  }
  // Excel varaq nomi — 31 belgidan oshmasligi va taqiqlangan belgilarsiz bo'lishi kerak
  const sheetName = (name, i) => (name || `Guruh${i}`).replace(/[[\]*/\\?:]/g, ' ').slice(0, 31) || `Guruh${i}`

  const downloadExcel = async () => {
    setBusy('xlsx'); setErr('')
    try {
      const { ok, failed } = await fetchGrids()
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const usedNames = new Set()
      ok.forEach(({ group, days, grid }, i) => {
        const rows = [['Para', ...days]]
        grid.forEach((row, pi) => rows.push([pi + 1, ...row.map(cellText)]))
        const ws = XLSX.utils.aoa_to_sheet(rows)
        ws['!cols'] = [{ wch: 6 }, ...days.map(() => ({ wch: 24 }))]
        let name = sheetName(group?.name, i)
        while (usedNames.has(name)) name = `${name.slice(0, 28)}_${i}`
        usedNames.add(name)
        XLSX.utils.book_append_sheet(wb, ws, name)
      })
      XLSX.writeFile(wb, `jadval-${bundleLabel()}.xlsx`)
      if (failed.length) setErr(`${failed.length} ta guruh yuklab bo'lmadi: ${failed.map((f) => f.group?.name).join(', ')} — qolganlari yuklandi, shularni alohida qayta urinib ko'ring.`)
    } catch (e) { setErr(e.message || 'Yuklab bo\'lmadi') } finally { setBusy(''); setProgress(null) }
  }

  // jsPDF standart shrifti maxsus belgini (ʻ/ʼ) chizmaydi — oddiy apostrofga almashtiramiz
  const asciiFy = (s) => (s || '').replace(/[ʻʼ]/g, "'")

  const downloadPdf = async () => {
    setBusy('pdf'); setErr('')
    try {
      const { ok, failed } = await fetchGrids()
      const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
      const doc = new jsPDF({ orientation: 'landscape' })
      ok.forEach(({ group, days, grid }, i) => {
        if (i > 0) doc.addPage()
        doc.setFontSize(14)
        doc.text(asciiFy(`Dars jadvali — ${group?.name || group?.id}`), 14, 12)
        autoTable(doc, {
          head: [['Para', ...days.map(asciiFy)]],
          body: grid.map((row, pi) => [String(pi + 1), ...row.map((c) => asciiFy(cellText(c)))]),
          startY: 18, styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [37, 99, 235] },
        })
      })
      doc.save(`jadval-${bundleLabel()}.pdf`)
      if (failed.length) setErr(`${failed.length} ta guruh yuklab bo'lmadi: ${failed.map((f) => f.group?.name).join(', ')} — qolganlari yuklandi, shularni alohida qayta urinib ko'ring.`)
    } catch (e) { setErr(e.message || 'Yuklab bo\'lmadi') } finally { setBusy(''); setProgress(null) }
  }

  return (
    <Modal open={open} onClose={close} title="Jadvalni yuklab olish">
      <div className="space-y-4">
        <Field label="Fakultet">
          <SearchableSelect value={facultyId} onChange={(v) => { setFacultyId(v); setCourse(''); setGroupId('') }}
            options={faculties.map((f) => ({ value: f.id, label: f.name }))}
            emptyLabel="Barcha fakultetlar" placeholder="Fakultet qidirish..." />
        </Field>
        <Field label="Kurs">
          <SearchableSelect value={course} onChange={(v) => { setCourse(v); setGroupId('') }}
            options={courses.map((c) => ({ value: c, label: `${c}-kurs` }))}
            emptyLabel="Barcha kurslar" placeholder="Kurs qidirish..." />
        </Field>
        <Field label="Guruh (ixtiyoriy)">
          <SearchableSelect value={groupId} onChange={setGroupId}
            options={byCourse.map((g) => ({ value: g.id, label: g.name }))}
            emptyLabel="— barcha guruhlar (yuqoridagi filtrga mos) —" placeholder="Guruh qidirish..." />
        </Field>
        <p className="text-xs text-slate-400">
          {groupId
            ? `"${groupName}" guruhining jadvali yuklanadi.`
            : `Guruh tanlanmasa — mos ${targetGroups.length} ta guruhning jadvali bitta faylga (Excel'da alohida varaq, PDF'da alohida sahifa) yig'ib yuklanadi.`}
        </p>
        {progress && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span>Guruhlar yuklanmoqda…</span>
              <span>{progress.done} / {progress.total}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full bg-brand transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        )}
        {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={close}>Bekor</button>
          <button type="button" className="btn-ghost" disabled={targetGroups.length === 0 || !!busy} onClick={downloadPdf}>
            <FileText size={16} /> {busy === 'pdf' ? (progress ? `${progress.done}/${progress.total}…` : 'Tayyorlanmoqda…') : 'PDF'}
          </button>
          <button type="button" className="btn-primary" disabled={targetGroups.length === 0 || !!busy} onClick={downloadExcel}>
            <FileSpreadsheet size={16} /> {busy === 'xlsx' ? (progress ? `${progress.done}/${progress.total}…` : 'Tayyorlanmoqda…') : 'Excel'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
