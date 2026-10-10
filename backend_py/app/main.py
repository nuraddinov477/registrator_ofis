"""FastAPI ilovasi — server/src/app.js + index.js ning Python nusxasi.

Ishga tushirish:  uvicorn app.main:app --host 0.0.0.0 --port 4000
"""
import json
import time
import traceback
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .access import AccessError
from .auth import current_user
from .config import CLIENT_ORIGINS, RATE_AUTH_MAX, RATE_MAX, RATE_WINDOW_S
from .crud import client_ip
from .db import Base, SessionLocal, engine
from .models import Building, User
from .routes.assistant import assistant_router
from .routes.collab import potok_router, requests_router
from .routes.resources import (
    audit_router, buildings_router, build_crud_routers, handover_router, stats_router,
    users_bulk_router, workloads_router,
)
from .routes.schedule import schedule_router
from .routes.system import auth_router, health_router, maintenance_gate, site_router
from .schemas import ValidationFailed


def bootstrap():
    """Ishga tushganda: jadvallar, developer → isOwner, eski Building.facultyId → faculties backfill."""
    Base.metadata.create_all(engine)
    _seed_if_requested()
    db = SessionLocal()
    try:
        res = db.execute(update(User).where(User.login == "developer", User.isOwner == False)  # noqa: E712
                         .values(isOwner=True))
        if res.rowcount:
            print(f"→ Bootstrap: \"developer\" hisobiga isOwner=true berildi ({res.rowcount})")
        db.commit()

        buildings = db.scalars(select(Building).where(Building.facultyId.isnot(None))).all()
        moved = 0
        for b in buildings:
            if b.facultyId not in [f.id for f in b.faculties]:
                from .models import Faculty
                fac = db.get(Faculty, b.facultyId)
                if fac is not None:
                    b.faculties.append(fac)
                    moved += 1
        if moved:
            db.commit()
            print(f"→ Bootstrap: {moved} ta bino eski facultyId'dan yangi faculties'ga ko'chirildi")

        # Server qayta ishga tushganda to'xtab qolgan generatsiyalar abadiy "running" bo'lib qolmasin
        from datetime import timedelta
        from .db import now
        from .models import SchedulingRun
        stale = db.scalars(select(SchedulingRun).where(
            SchedulingRun.status == "running", SchedulingRun.updatedAt < now() - timedelta(minutes=10))).all()
        for run in stale:
            run.status = "failed"
            run.report = json.dumps({"error": "Generatsiya yakunlanmadi (server qayta ishga tushgan) — jadvalni qayta yarating"},
                                    ensure_ascii=False)
        if stale:
            db.commit()
            print(f"→ Bootstrap: {len(stale)} ta to'xtab qolgan generatsiya 'failed' deb belgilandi")
    except Exception as e:  # noqa: BLE001
        db.rollback()
        print(f"Bootstrap xatosi: {e}")
    finally:
        db.close()


def _seed_if_requested():
    """SEED_ON_START=true va baza BO'SH (foydalanuvchi yo'q) bo'lsa — demo ma'lumot (docker-entrypoint.sh kabi).
    Seed jadvallarni tozalaydi, shuning uchun faqat bo'sh bazada ishlaydi."""
    import os
    if os.environ.get("SEED_ON_START", "false").lower() != "true":
        return
    db = SessionLocal()
    try:
        has_users = db.query(User).first() is not None
    finally:
        db.close()
    if has_users:
        print("→ SEED_ON_START: bazada foydalanuvchilar bor — demo ma'lumot yozilmadi")
        return
    print("→ Seed (demo ma'lumot)...")
    import seed  # backend_py/seed.py (Docker'da /app ichida)
    seed.main()


@asynccontextmanager
async def lifespan(_app):
    bootstrap()
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

app.add_middleware(CORSMiddleware, allow_origins=CLIENT_ORIGINS, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1024)

_hits: dict = {}


def _over_limit(key: str, limit: int) -> bool:
    now = time.time()
    start, count = _hits.get(key, (now, 0))
    if now - start >= RATE_WINDOW_S:
        start, count = now, 0
    count += 1
    _hits[key] = (start, count)
    return count > limit


@app.middleware("http")
async def security_and_rate_limit(request: Request, call_next):
    ip = client_ip(request)
    limited = (request.url.path.startswith("/api/auth") and _over_limit(f"auth:{ip}", RATE_AUTH_MAX)) \
        or _over_limit(f"all:{ip}", RATE_MAX)
    if limited:
        return JSONResponse(status_code=429, content={"error": "Juda ko'p so'rov. Keyinroq urinib ko'ring."})
    response = await call_next(request)
    # helmet'ga o'xshash minimal sarlavhalar
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


# ── Xato ishlovchilari: JS API'dagi bilan bir xil {error: ...} shakli ──

@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404 and exc.detail == "Not Found":
        return JSONResponse(status_code=404, content={"error": f"Marshrut topilmadi: {request.method} {request.url.path}"})
    if isinstance(exc.detail, dict):
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(RequestValidationError)
async def request_validation_error(_request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=400, content={"error": "Noto'g'ri so'rov", "issues": exc.errors()})


@app.exception_handler(ValidationFailed)
async def validation_failed(_request: Request, exc: ValidationFailed):
    return JSONResponse(status_code=400, content={"error": "Validatsiya xatosi", "issues": exc.issues})


@app.exception_handler(AccessError)
async def access_error(_request: Request, exc: AccessError):
    return JSONResponse(status_code=exc.status, content={"error": exc.message})


@app.exception_handler(IntegrityError)
async def integrity_error(_request: Request, exc: IntegrityError):
    text = str(exc.orig).lower() if exc.orig else str(exc).lower()
    if "unique" in text or "duplicate" in text:
        return JSONResponse(status_code=409, content={"error": "Bunday qiymat allaqachon mavjud"})
    return JSONResponse(status_code=409, content={"error": "Bog'liq yozuv mavjud (foreign key cheklovi)"})


@app.exception_handler(Exception)
async def unhandled(_request: Request, exc: Exception):
    print("[ERROR]", "".join(traceback.format_exception(exc)))
    return JSONResponse(status_code=500, content={"error": "Ichki server xatosi"})


# ── Marshrutlar ──

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(site_router, dependencies=[Depends(current_user)])

api = APIRouter(prefix="/api")
gated = APIRouter(dependencies=[Depends(maintenance_gate)])
gated.include_router(handover_router())
gated.include_router(users_bulk_router())
gated.include_router(buildings_router())
for _router in build_crud_routers():
    gated.include_router(_router)
gated.include_router(workloads_router())
gated.include_router(schedule_router())
gated.include_router(potok_router())
gated.include_router(requests_router())
gated.include_router(assistant_router())
gated.include_router(audit_router())
gated.include_router(stats_router())
api.include_router(gated)
app.include_router(api, dependencies=[Depends(current_user)])
