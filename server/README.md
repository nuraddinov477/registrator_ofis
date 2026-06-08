# UniSchedule — Backend (API + jadval engine poydevori)

Node.js + Express + Prisma. Hozir **SQLite** (parolsiz, darhol ishlaydi), kod **PostgreSQL-ready**.

## Ishga tushirish

```bash
cd server
npm install
npm run db:migrate     # sxema + jadval yaratish
npm run db:seed        # demo ma'lumot (migrate avtomatik chaqiradi)
npm run dev            # http://localhost:4000
```

## Muhim skriptlar

| Skript | Vazifa |
|--------|--------|
| `npm run dev` | API'ni watch rejimida ishga tushiradi |
| `npm run db:migrate` | Migratsiya yaratish/qo'llash |
| `npm run db:reset` | Bazani tozalab qayta seed qiladi |
| `npm run db:studio` | Prisma Studio (vizual DB) |

## PostgreSQL'ga o'tish (1 qadam)

1. `prisma/schema.prisma` → `datasource db { provider = "postgresql" }`
2. `.env` → `DATABASE_URL="postgresql://user:parol@localhost:5432/unischedule?schema=public"`
3. `npm run db:migrate`

## API endpointlar

Asos: `http://localhost:4000/api`

| Resurs | Marshrut |
|--------|----------|
| Fakultetlar | `/faculties` |
| Kafedralar | `/departments` |
| Yo'nalishlar | `/specialties` |
| O'qituvchilar | `/teachers` |
| Fanlar | `/subjects` |
| Guruhlar | `/groups` |
| Binolar | `/buildings` |
| Xonalar | `/rooms` |
| Xona ruxsatlari | `/room-permissions` |
| Ish yuklamalari | `/workloads` |
| Foydalanuvchilar | `/users` |
| Audit logi (GET) | `/audit` |
| Statistika (GET) | `/stats` |

Har bir resurs: `GET /` (`?q=` qidiruv) · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id`.
Barcha o'zgartirishlar **audit logiga** yoziladi.

## Keyingi qadam — jadval engine

`workloads` + `rooms` + `room-permissions` ma'lumotlari engine kirishidir.
Engine `SchedulingRun` + `ScheduleEntry` jadvallariga natija yozadi
(format: `{ group_id, teacher_id, subject_id, room_id, day, pair }`).
