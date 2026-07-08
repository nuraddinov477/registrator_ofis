# SmartJadval — Deploy qo'llanmasi

To'liq stek: **React (Vite)** frontend + **Express/Prisma** backend + **gibrid jadval engine**.

## Demo hisoblar
- `admin` / `admin123` — Super Admin
- `operator` / `operator123` — Fakultet operatori

---

## 1. Lokal ishga tushirish (dev)

```bash
# Backend
cd server
cp .env.example .env
npm install
npm run db:migrate        # SQLite + jadval + seed
npm run dev               # http://localhost:4000

# Frontend (yangi terminal)
cd ..
cp .env.example .env      # VITE_API_URL=http://localhost:4000/api
npm install
npm run dev               # http://localhost:5173
```

---

## 2. Docker Compose — to'liq stek (PostgreSQL bilan)

Eng oson yo'l (Docker kerak):

```bash
docker compose up --build
```

Ishga tushadi:
- **PostgreSQL** (5433 portda)
- **API** → http://localhost:4000  (birinchi marta `SEED_ON_START=true` bilan seed qiladi)
- **Web** → http://localhost:8080

> Production'da `docker-compose.yml` ichidagi `JWT_SECRET`ni almashtiring:
> `openssl rand -hex 32`

---

## 3. Bulutga deploy (Docker'siz)

### Frontend → Vercel / Netlify / GitHub Pages (statik)
```bash
npm run build      # dist/ hosil bo'ladi
```
Build muhitiga `VITE_API_URL=https://api.sizning-domen.uz/api` o'zgaruvchisini bering.

### Backend → Railway / Render / Fly.io
1. PostgreSQL qo'shing (platforma beradi → `DATABASE_URL`)
2. Muhit o'zgaruvchilari:
   - `DATABASE_URL` (Postgres)
   - `NODE_ENV=production`
   - `JWT_SECRET` (kuchli, majburiy)
   - `CLIENT_ORIGIN=https://sizning-frontend-domen.uz`
   - `SEED_ON_START=true` (faqat birinchi deployda)
3. Build/Start:
   - Build: `npm install && node scripts/use-db.js postgresql && npx prisma generate`
   - Release: `npx prisma db push`
   - Start: `node src/index.js`

   (Docker ishlatilsa — `server/Dockerfile` shularni avtomatik bajaradi.)

---

## SQLite ↔ PostgreSQL almashtirish
```bash
cd server
node scripts/use-db.js postgresql   # deploy uchun
node scripts/use-db.js sqlite       # lokal dev uchun
```

## Muhim endpointlar
- `GET  /health`, `GET /health/ready`
- `POST /api/auth/login`
- `POST /api/schedule/generate` → `{runId}` (async), `GET /api/schedule/runs/:id` (status)
- Barcha `/api/*` — JWT token talab qiladi (login'dan tashqari)

## Production tekshiruv ro'yxati
- [x] JWT auth + rol nazorati
- [x] helmet, CORS, rate-limit, body-limit
- [x] Async engine (worker threads — so'rovni bloklamaydi)
- [x] Health/readiness probe
- [x] Docker + Compose + Postgres
- [ ] HTTPS/TLS (platforma yoki reverse-proxy darajasida)
- [ ] Monitoring/loglar (keyingi bosqich)
- [ ] DB backup strategiyasi (keyingi bosqich)
