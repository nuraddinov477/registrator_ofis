# UniSchedule

Universitet boshqaruv tizimi (dars jadvali, fakultetlar, kafedralar, oʻqituvchilar va h.k.) — rasmlardagi saytga oʻxshash klon.

## Texnologiyalar
- **React 18** + **Vite** — SPA
- **Tailwind CSS** — dark/light dizayn
- **React Router** — sahifalar navigatsiyasi
- **Lucide React** — ikonkalar
- **Recharts** — Dashboard grafiklari
- Maʼlumotlar **localStorage**'da saqlanadi (backend talab qilinmaydi)

## Ishga tushirish
```bash
npm install
npm run dev
```
Soʻng brauzerda `http://localhost:5173` oching.

## Bo'limlar
Dashboard · Oʻquv yuklamasi · Talabnomalar · Fakultetlar · Kafedralar ·
Mutaxassisliklar · Oʻqituvchilar · Fanlar bazasi · Akademik guruhlar ·
Bino va xonalar · Dars jadvali · Foydalanuvchilar · Audit logi

Har bir boʻlimda qo'shish / tahrirlash / oʻchirish (CRUD) ishlaydi, oʻzgarishlar
**Audit logi**da qayd etiladi. Tepadagi ☀️ tugmasi orqali dark/light rejim almashadi.
```
