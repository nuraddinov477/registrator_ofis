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

  const byFaculty = facultyId ? groups.filter((g) => String(g.facultyId) === String(facultyId)) : groups
  const courses = [...new Set(byFaculty.map((g) => g.course))].sort((a, b) => a - b)
  const byCourse = course ? byFaculty.filter((g) => String(g.course) === String(course)) : byFaculty

  const reset = () => { setFacultyId(''); setCourse(''); setGroupId(''); setErr('') }
  const close = () => { reset(); onClose() }

  const groupName = groups.find((g) => g.id === Number(groupId))?.name || ''
  // Guruh tanlanmasa — joriy filtrga mos guruhlarning HAMMASI (kamida 1 tasi bo'lishi kerak)
  const targetGroups = groupId ? groups.filter((g) => g.id === Number(groupId)) : byCourse

  const fetchGrids = async () => {
    if (!runId) throw new Error('Jadval tanlanmagan')
    if (targetGroups.length === 0) throw new Error('Mos guruh topilmadi')
    return Promise.all(targetGroups.map(async (g) => ({
      group: g, ...(await api(`/schedule/runs/${runId}/grid?groupId=${g.id}`)),
    })))
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
      const results = await fetchGrids()
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const usedNames = new Set()
      results.forEach(({ group, days, grid }, i) => {
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
    } catch (e) { setErr(e.message || 'Yuklab bo\'lmadi') } finally { setBusy('') }
  }

  // jsPDF standart shrifti maxsus belgini (ʻ/ʼ) chizmaydi — oddiy apostrofga almashtiramiz
  const asciiFy = (s) => (s || '').replace(/[ʻʼ]/g, "'")

  const downloadPdf = async () => {
    setBusy('pdf'); setErr('')
    try {
      const results = await fetchGrids()
      const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
      const doc = new jsPDF({ orientation: 'landscape' })
      results.forEach(({ group, days, grid }, i) => {
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
    } catch (e) { setErr(e.message || 'Yuklab bo\'lmadi') } finally { setBusy('') }
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
        {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={close}>Bekor</button>
          <button type="button" className="btn-ghost" disabled={targetGroups.length === 0 || !!busy} onClick={downloadPdf}>
            <FileText size={16} /> {busy === 'pdf' ? 'Tayyorlanmoqda…' : 'PDF'}
          </button>
          <button type="button" className="btn-primary" disabled={targetGroups.length === 0 || !!busy} onClick={downloadExcel}>
            <FileSpreadsheet size={16} /> {busy === 'xlsx' ? 'Tayyorlanmoqda…' : 'Excel'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
