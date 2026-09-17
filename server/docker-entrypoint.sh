#!/bin/sh
set -e

echo "→ Sxemani DB'ga qo'llash (prisma db push)..."
# --accept-data-loss: konteynerda interaktiv tasdiq imkoni yo'q — flag bo'lmasa Prisma
# har qanday "ma'lumot yo'qotish xavfi bor" o'zgarishda (masalan ustun o'chirishda) shu
# yerda to'xtab qoladi va `set -e` tufayli butun server ishga tushmay qoladi.
npx prisma db push --skip-generate --accept-data-loss

# Birinchi deployda demo ma'lumot kerak bo'lsa: SEED_ON_START=true. Seed jadvallarni tozalaydi —
# shu sabab FAQAT bo'sh bazaga (foydalanuvchi yo'q) yoziladi, qayta ishga tushganda ma'lumot o'chmaydi
if [ "${SEED_ON_START:-false}" = "true" ]; then
  if node scripts/has-users.js; then
    echo "→ SEED_ON_START: bazada foydalanuvchilar bor — demo ma'lumot yozilmadi"
  else
    echo "→ Seed (demo ma'lumot)..."
    node prisma/seed.js
  fi
fi

echo "→ Server ishga tushmoqda..."
exec node src/index.js
