// Prisma datasource provider'ini almashtiradi (lokal SQLite ↔ deploy PostgreSQL).
//   node scripts/use-db.js sqlite
//   node scripts/use-db.js postgresql
import { readFileSync, writeFileSync } from 'fs'

const target = process.argv[2]
if (!['sqlite', 'postgresql'].includes(target)) {
  console.error('Foydalanish: node scripts/use-db.js <sqlite|postgresql>')
  process.exit(1)
}

const path = new URL('../prisma/schema.prisma', import.meta.url)
let s = readFileSync(path, 'utf8')
const re = /(datasource\s+db\s*\{[\s\S]*?provider\s*=\s*)"(sqlite|postgresql)"/
if (!re.test(s)) { console.error('❌ datasource provider topilmadi'); process.exit(1) }
s = s.replace(re, `$1"${target}"`)
writeFileSync(path, s)
console.log(`✓ Prisma provider → ${target}`)
