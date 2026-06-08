#!/bin/sh
set -e

echo "→ Sxemani DB'ga qo'llash (prisma db push)..."
npx prisma db push --skip-generate

# Birinchi deployda demo ma'lumot kerak bo'lsa: SEED_ON_START=true
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "→ Seed (demo ma'lumot)..."
  node prisma/seed.js
fi

echo "→ Server ishga tushmoqda..."
exec node src/index.js
