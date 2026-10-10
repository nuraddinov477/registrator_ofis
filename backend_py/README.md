# UniSchedule — backend (Python / FastAPI)

`server/` (Node.js + Express) ning Python versiyasi. API yo'llari, javob shakllari va jadval
algoritmi (greedy + simulated annealing) o'sha bilan bir xil, shuning uchun React frontend
o'zgarishsiz ishlaydi (`VITE_API_URL` shu API'ga qaratiladi).

Stek: FastAPI · SQLAlchemy 2 · PyJWT · bcrypt · Anthropic SDK · PostgreSQL (psycopg 3).

## Mahalliy ishga tushirish

```bash
cd backend_py
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                  # qiymatlarni to'ldiring
export DATABASE_URL="file:./dev.db"                   # yoki postgresql://...
python seed.py                                        # demo ma'lumot (developer / admin / operator)
uvicorn app.main:app --port 4000
```

Health: `GET /health`, DB tekshiruvi: `GET /health/ready`.

## Ma'lumotlar bazasi

- Jadval va ustun nomlari Prisma sxemasi bilan AYNAN bir xil (`"Faculty"`, `"Workload"`, `facultyId` ...).
  Shu sabab mavjud Neon PostgreSQL bazasiga to'g'ridan-to'g'ri ulanish mumkin.
- `file:./dev.db` (SQLite) mahalliy test uchun. Prisma'ning eski SQLite faylini bu versiya
  o'qimaydi — ma'lumot kerak bo'lsa PostgreSQL'ga ko'chiring.
- Jadvallar startup'da `create_all` bilan yaratiladi (mavjudlarini o'zgartirmaydi).

## Muhit o'zgaruvchilari

| Nom | Vazifa |
|---|---|
| `DATABASE_URL` | `postgresql://...` (Neon) yoki `file:./dev.db` |
| `JWT_SECRET` | production'da majburiy |
| `JWT_EXPIRES_IN` | masalan `7d` |
| `CLIENT_ORIGIN` | CORS, vergul bilan bir nechta domen |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | AI yordamchi (Claude asosiy, Gemini zaxira) |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_AUTH_MAX` | so'rov limiti (standart 300 / 20 — 15 daqiqada) |

## Sinov (Node engine bilan bit-bit solishtirish)

Jadval algoritmi `server/src/engine/` (Node) bilan AYNAN bir xil natija beradi. Buni tekshirish:

```bash
cd backend_py/tests/parity
node gen.mjs 20 1 ./out                 # 20 ta tasodifiy instance → Node natijalari
PARITY_DIR=./out python compare.py 1 $(seq 1 20)   # Python port bilan bit-bit solishtirish
```

`ENGINE_DIR` bilan boshqa Node engine papkasini ko'rsatish mumkin. Natija: `OK` (bir xil) yoki `DIFF`.

## Deploy (Render)

`render.yaml` `backend_py/Dockerfile` ga qaratilgan. `autoDeploy: true` bo'lgani uchun `main` ga
push qilinganda deploy avtomatik boshlanadi. Birinchi ishga tushirishda demo ma'lumot kerak bo'lsa
`SEED_ON_START=true` qo'ying (faqat bo'sh bazaga yozadi). Production'da `SEED_<LOGIN>_PASSWORD`
bilan demo parollarni almashtiring.

## Farqlar (Node versiyasiga nisbatan)

- `helmet` / `compression` / `morgan` o'rniga: minimal xavfsizlik sarlavhalari, GZip va konsol log.
- Swagger/OpenAPI o'chirilgan (production xavfsizligi uchun).
- Fon jarayoni `worker_threads` o'rniga `threading.Thread` da; `--workers 1` bilan ishlatiladi
  (jadval holati xotirada emas, DB'da saqlanadi, lekin bir nechta worker kerak emas).
- CLI: `python -m app.engine.cli [semester] [maxMs]` — HTTP'siz jadval generatsiyasi (Node'dagi `npm run solve` o'rniga).
- Jadval algoritmi (`app/engine/`): greedy → anneal → removeConflicts/reinsert → qat'iy anneal → polishGaps. Node bilan bit-bit mos.
