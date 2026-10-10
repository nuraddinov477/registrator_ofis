"""Markazlashgan konfiguratsiya — muhit o'zgaruvchilari (server/src/config.js bilan bir xil)."""
import os
import sys

ENV = os.environ.get("NODE_ENV", "development")
IS_PROD = ENV == "production"


def _required(key, fallback=None):
    value = os.environ.get(key, fallback)
    if value is None or value == "":
        print(f"❌ Majburiy muhit o'zgaruvchisi yetishmayapti: {key}", file=sys.stderr)
        raise SystemExit(1)
    return value


def _db_url(raw: str) -> str:
    # Prisma uslubi: file:./dev.db → SQLAlchemy: sqlite:///./dev.db
    if raw.startswith("file:"):
        return "sqlite:///" + raw[len("file:"):]
    # Neon / Render: postgres:// yoki postgresql:// → psycopg (v3) drayveri
    for prefix in ("postgres://", "postgresql://"):
        if raw.startswith(prefix):
            return "postgresql+psycopg://" + raw[len(prefix):]
    return raw


DATABASE_URL = _db_url(_required("DATABASE_URL", "file:./dev.db"))
PORT = int(os.environ.get("PORT", "4000") or 4000)
# Bir nechta domen vergul bilan: "https://a.uz,https://b.uz"
CLIENT_ORIGINS = [s.strip() for s in os.environ.get("CLIENT_ORIGIN", "http://localhost:5173").split(",") if s.strip()]
JWT_SECRET = _required("JWT_SECRET") if IS_PROD else os.environ.get("JWT_SECRET", "dev-secret-change-me")
JWT_EXPIRES_IN = os.environ.get("JWT_EXPIRES_IN", "7d")
RATE_WINDOW_S = 15 * 60
RATE_MAX = int(os.environ.get("RATE_LIMIT_MAX", "300") or 300)
RATE_AUTH_MAX = int(os.environ.get("RATE_LIMIT_AUTH_MAX", "20") or 20)


def jwt_seconds(value: str) -> int:
    """'7d', '12h', '30m', '45s' yoki sof son (soniya) → soniyalar (jsonwebtoken expiresIn kabi)."""
    units = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    v = value.strip()
    if v and v[-1] in units:
        return int(float(v[:-1]) * units[v[-1]])
    return int(float(v))
