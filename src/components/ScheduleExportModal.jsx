import { useState } from 'react'
import { FileSpreadsheet, FileText } from 'lucide-react'
import { api } from '../api/client'
import { useCollection } from '../data/store'
import { Modal, Field, SearchableSelect } from './ui'

// Tayyor jadvalni yuklab olish — Fakultet → Kurs → Guruh ketma-ketligida filtrlab,
// tanlangan guruhning jadvalini Excel (.xlsx) yoki PDF sifatida yuklab beradi.
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

  const fetchGrid = async () => {
    if (!runId || !groupId) throw new Error('Guruhni tanlang')
    return api(`/schedule/runs/${runId}/grid?groupId=${groupId}`)
  }

  const cellText = (c) => (c ? [c.subject, c.teacher, c.room].filter(Boolean).join('\n') : '')

  const downloadExcel = async () => {
    setBusy('xlsx'); setErr('')
    try {
      const g = await fetchGrid()
      const XLSX = await import('xlsx')
      const rows = [['Para', ...g.days]]
      g.grid.forEach((row, pi) => rows.push([pi + 1, ...row.map(cellText)]))
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [{ wch: 6 }, ...g.days.map(() => ({ wch: 24 }))]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Jadval')
      XLSX.writeFile(wb, `jadval-${groupName || groupId}.xlsx`)
    } catch (e) { setErr(e.message || 'Yuklab bo\'lmadi') } finally { setBusy('') }
  }

  // jsPDF standart shrifti maxsus belgini (ʻ/ʼ) chizmaydi — oddiy apostrofga almashtiramiz
  const asciiFy = (s) => (s || '').replace(/[ʻʼ]/g, "'")

  const downloadPdf = async () => {
    setBusy('pdf'); setErr('')
    try {
      const g = await fetchGrid()
      const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
      const doc = new jsPDF({ orientation: 'landscape' })
      doc.setFontSize(14)
      doc.text(asciiFy(`Dars jadvali — ${groupName || groupId}`), 14, 12)
      autoTable(doc, {
        head: [['Para', ...g.days.map(asciiFy)]],
        body: g.grid.map((row, pi) => [String(pi + 1), ...row.map((c) => asciiFy(cellText(c)))]),
        startY: 18, styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [37, 99, 235] },
      })
      doc.save(`jadval-${groupName || groupId}.pdf`)
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
        <Field label="Guruh">
          <SearchableSelect value={groupId} onChange={setGroupId}
            options={byCourse.map((g) => ({ value: g.id, label: g.name }))}
            emptyLabel="— guruhni tanlang —" placeholder="Guruh qidirish..." />
        </Field>
        {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={close}>Bekor</button>
          <button type="button" className="btn-ghost" disabled={!groupId || !!busy} onClick={downloadPdf}>
            <FileText size={16} /> {busy === 'pdf' ? 'Tayyorlanmoqda…' : 'PDF'}
          </button>
          <button type="button" className="btn-primary" disabled={!groupId || !!busy} onClick={downloadExcel}>
            <FileSpreadsheet size={16} /> {busy === 'xlsx' ? 'Tayyorlanmoqda…' : 'Excel'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
