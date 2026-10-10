from datetime import datetime, timezone

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import DATABASE_URL

_is_sqlite = DATABASE_URL.startswith("sqlite")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    pool_pre_ping=True,
)

if _is_sqlite:
    # Prisma kabi: SQLite'da tashqi kalit cheklovlari yoqilgan bo'lsin (SET NULL / CASCADE ishlashi uchun)
    @event.listens_for(engine, "connect")
    def _sqlite_foreign_keys_on(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def now() -> datetime:
    """UTC, tz'siz (Prisma'ning TIMESTAMP(3) ustunlari bilan mos)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def audit(action, detail, user_login="tizim", ip="127.0.0.1"):
    """Har o'zgartirishni audit logiga yozadi. Audit xatosi asosiy amalni to'xtatmaydi."""
    from .models import AuditLog

    db = SessionLocal()
    try:
        db.add(AuditLog(
            time=now(), action=action, detail="" if detail is None else str(detail),
            user=user_login or "tizim", ip=ip or "127.0.0.1",
        ))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
