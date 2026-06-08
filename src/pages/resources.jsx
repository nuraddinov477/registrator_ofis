import { Building2, Landmark, GraduationCap, Users, Library, Network } from 'lucide-react'
import CrudPage from '../components/CrudPage'
import { db } from '../data/store'
import { Badge } from '../components/ui'

const facultyName = (id) => db.get('faculties').find((f) => f.id === id)?.name || '—'
const deptName = (id) => db.get('departments').find((d) => d.id === id)?.name || '—'
const facultyOptions = () => db.get('faculties').map((f) => ({ value: f.id, label: f.name }))
const deptOptions = () => db.get('departments').map((d) => ({ value: d.id, label: d.name }))

const cell = (v) => <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{v}</td>
const codeCell = (v) => <td className="px-4 py-3"><Badge color="gray">{v || '—'}</Badge></td>

export function Faculties() {
  return (
    <CrudPage
      title="Fakultetlar" icon={Building2} collection="faculties"
      columns={['Nomi', 'Kodi', 'Tavsif']}
      fields={[
        { name: 'name', label: 'Nomi', required: true },
        { name: 'code', label: 'Kodi' },
        { name: 'description', label: 'Tavsif' },
      ]}
      renderCells={(r) => <>{cell(<span className="font-medium">{r.name}</span>)}{codeCell(r.code)}{cell(r.description || '—')}</>}
    />
  )
}

export function Departments() {
  return (
    <CrudPage
      title="Kafedralar" icon={Landmark} collection="departments"
      columns={['Nomi', 'Kodi', 'Fakultet', 'Mudiri']}
      fields={[
        { name: 'name', label: 'Nomi', required: true },
        { name: 'code', label: 'Kodi' },
        { name: 'facultyId', label: 'Fakultet', type: 'select', numeric: true, options: facultyOptions },
        { name: 'head', label: 'Mudiri' },
      ]}
      renderCells={(r) => <>{cell(<span className="font-medium">{r.name}</span>)}{codeCell(r.code)}{cell(facultyName(r.facultyId))}{cell(r.head)}</>}
    />
  )
}

export function Specialties() {
  return (
    <CrudPage
      title="Mutaxassisliklar" icon={GraduationCap} collection="specialties"
      columns={['Nomi', 'Kodi', 'Fakultet', 'Taʼlim shakli', 'Muddat']}
      fields={[
        { name: 'name', label: 'Nomi', required: true },
        { name: 'code', label: 'Kodi' },
        { name: 'facultyId', label: 'Fakultet', type: 'select', numeric: true, options: facultyOptions },
        { name: 'form', label: "Ta'lim shakli", type: 'select', options: () => ['Kunduzgi', 'Sirtqi', 'Kechki'].map((v) => ({ value: v, label: v })) },
        { name: 'years', label: 'Muddat (yil)', type: 'number', default: 4 },
      ]}
      renderCells={(r) => <>{cell(<span className="font-medium">{r.name}</span>)}{codeCell(r.code)}{cell(facultyName(r.facultyId))}{cell(r.form)}{cell(r.years ? `${r.years} yil` : '—')}</>}
    />
  )
}

export function Teachers() {
  return (
    <CrudPage
      title="O'qituvchilar" icon={Users} collection="teachers"
      columns={['F.I.Sh', 'Lavozim', 'Ilmiy daraja', 'Kafedra', 'Email']}
      fields={[
        { name: 'fullName', label: 'F.I.Sh', required: true },
        { name: 'position', label: 'Lavozim', type: 'select', options: () => ['Assistent', 'Katta oʻqituvchi', 'Dotsent', 'Professor'].map((v) => ({ value: v, label: v })) },
        { name: 'degree', label: 'Ilmiy daraja', type: 'select', options: () => ['—', 'PhD', 'DSc'].map((v) => ({ value: v, label: v })) },
        { name: 'departmentId', label: 'Kafedra', type: 'select', numeric: true, options: deptOptions },
        { name: 'email', label: 'Email' },
      ]}
      renderCells={(r) => <>{cell(<span className="font-medium">{r.fullName}</span>)}{cell(r.position)}{cell(r.degree || '—')}{cell(deptName(r.departmentId))}{cell(r.email || '—')}</>}
    />
  )
}

export function Subjects() {
  return (
    <CrudPage
      title="Fanlar bazasi" icon={Library} collection="subjects"
      columns={['Nomi', 'Kodi', 'Turi', 'Kredit', 'Maʼruza', 'Amaliy', 'Semestr']}
      fields={[
        { name: 'name', label: 'Nomi', required: true },
        { name: 'code', label: 'Kodi' },
        { name: 'type', label: 'Turi', type: 'select', options: () => ['Majburiy', 'Tanlov'].map((v) => ({ value: v, label: v })) },
        { name: 'credit', label: 'Kredit', type: 'number', default: 3 },
        { name: 'lecture', label: 'Maʼruza (soat)', type: 'number', default: 30 },
        { name: 'practice', label: 'Amaliy (soat)', type: 'number', default: 30 },
        { name: 'semester', label: 'Semestr', type: 'number', default: 1 },
      ]}
      renderCells={(r) => <>{cell(<span className="font-medium">{r.name}</span>)}{codeCell(r.code)}{cell(r.type)}{cell(r.credit)}{cell(r.lecture)}{cell(r.practice)}{cell(r.semester)}</>}
    />
  )
}

export function Groups() {
  return (
    <CrudPage
      title="Akademik guruhlar" icon={Network} collection="groups"
      columns={['Guruh nomi', 'Fakultet', 'Kurs', 'Talabalar soni', 'Taʼlim shakli']}
      fields={[
        { name: 'name', label: 'Guruh nomi', required: true },
        { name: 'facultyId', label: 'Fakultet', type: 'select', numeric: true, options: facultyOptions },
        { name: 'course', label: 'Kurs', type: 'number', default: 1 },
        { name: 'students', label: 'Talabalar soni', type: 'number', default: 25 },
        { name: 'form', label: "Ta'lim shakli", type: 'select', options: () => ['Kunduzgi', 'Sirtqi', 'Kechki'].map((v) => ({ value: v, label: v })) },
      ]}
      renderCells={(r) => <>{cell(<span className="font-medium">{r.name}</span>)}{cell(facultyName(r.facultyId))}{cell(`${r.course}-kurs`)}{cell(r.students)}{cell(r.form)}</>}
    />
  )
}
