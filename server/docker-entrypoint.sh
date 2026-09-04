#!/bin/sh
set -e

echo "→ Sxemani DB'ga qo'llash (prisma db push)..."
# --accept-data-loss: konteynerda interaktiv tasdiq imkoni yo'q — flag bo'lmasa Prisma
# har qanday "ma'lumot yo'qotish xavfi bor" o'zgarishda (masalan ustun o'chirishda) shu
# yerda to'xtab qoladi va `set -e` tufayli butun server ishga tushmay qoladi.
npx prisma db push --skip-generate --accept-data-loss

# Birinchi deployda demo ma'lumot kerak bo'lsa: SEED_ON_START=true
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "→ Seed (demo ma'lumot)..."
  node prisma/seed.js
fi

echo "→ Server ishga tushmoqda..."
exec node src/index.js
