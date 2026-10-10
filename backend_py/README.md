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

## Deploy (Render)

`render.yaml` endi `backend_py/Dockerfile` ga qaratilgan (eski `server/` deploy'ni almashtiradi).
`autoDeploy: true` bo'lgani uchun `main` ga push qilinganda deploy avtomatik boshlanadi.

## Farqlar (Node versiyasiga nisbatan)

- `helmet` / `compression` / `morgan` o'rniga: minimal xavfsizlik sarlavhalari, GZip va konsol log.
- Swagger/OpenAPI o'chirilgan (production xavfsizligi uchun).
- Fon jarayoni `worker_threads` o'rniga `threading.Thread` da; `--workers 1` bilan ishlatiladi
  (jadval holati xotirada emas, DB'da saqlanadi, lekin bir nechta worker kerak emas).
- CLI: `python -m app.engine.cli [semester] [maxMs]` — HTTP'siz jadval generatsiyasi (Node'dagi `npm run solve` o'rniga).
