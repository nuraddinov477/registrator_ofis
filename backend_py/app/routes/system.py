"""Auth, sayt sozlamalari (texnik xizmat), sog'liq tekshiruvi — auth.js, siteSettings.js, maintenance.js."""
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..auth import CurrentUser, current_user, require_developer, sign_token, token_user, verify_password
from ..crud import client_ip, get_body
from ..db import SessionLocal, audit, engine, get_db
from ..models import SiteSetting, User

# ── Sayt sozlamalari (keshli, 5 soniya) ──
_cache = {"value": None, "at": 0.0}
CACHE_S = 5.0


def _read_settings():
    db = SessionLocal()
    try:
        row = db.get(SiteSetting, 1)
        if row is None:
            row = SiteSetting(id=1, maintenanceMode=False)
            db.add(row)
            db.commit()
        return {"maintenanceMode": bool(row.maintenanceMode), "message": row.maintenanceMessage}
    finally:
        db.close()


def get_settings():
    if _cache["value"] is not None and time.time() - _cache["at"] < CACHE_S:
        return _cache["value"]
    value = _read_settings()
    _cache["value"] = value
    _cache["at"] = time.time()
    return value


def is_maintenance_on() -> bool:
    return get_settings()["maintenanceMode"]


def maintenance_gate(user: CurrentUser = Depends(current_user)):
    """Texnik xizmat yoqilgan bo'lsa, faqat egalik (isOwner) hisobi kira oladi."""
    if user.isOwner:
        return user
    if is_maintenance_on():
        raise HTTPException(503, detail={"error": "Sayt hozir texnik xizmat ko'rsatish tufayli vaqtincha yopiq", "maintenance": True})
    return user


# ── Auth ──
auth_router = APIRouter(prefix="/api/auth")


@auth_router.post("/login")
async def login(request: Request, body: dict = Depends(get_body), db: Session = Depends(get_db)):
    login_v, password_v = body.get("login"), body.get("password")
    if not isinstance(login_v, str) or not login_v or not isinstance(password_v, str) or not password_v:
        raise HTTPException(400, detail={"error": "Validatsiya xatosi", "issues": {
            "login": ["Majburiy"] if not login_v else [],
            "password": ["Majburiy"] if not password_v else [],
        }})
    user = db.query(User).filter(User.login == login_v).first()
    if user is None or not user.active or not verify_password(password_v, user.passwordHash):
        raise HTTPException(401, "Login yoki parol noto'g'ri")
    # Texnik xizmatda FAQAT egalik hisobi kiradi (login bosqichida tekshiriladi)
    if not user.isOwner and is_maintenance_on():
        return JSONResponse(status_code=503, content={
            "error": "Sayt hozir texnik xizmat ko'rsatish tufayli vaqtincha yopiq", "maintenance": True})
    audit("Tizimga kirdi", login_v, "tizim", client_ip(request))
    return {
        "token": sign_token(user),
        "user": {
            "id": user.id, "login": user.login, "fullName": user.fullName, "role": user.role,
            "facultyId": user.facultyId, "departmentId": user.departmentId, "teacherId": user.teacherId,
            "restrictions": user.restrictions, "isOwner": bool(user.isOwner),
        },
    }


@auth_router.get("/me")
def me(user: CurrentUser = Depends(token_user)):
    return {
        "id": user.sub, "login": user.login, "fullName": user.fullName, "role": user.role,
        "facultyId": user.facultyId, "departmentId": user.departmentId, "teacherId": user.teacherId,
        "isOwner": bool(user.isOwner),
    }


# ── Sayt sozlamalari (gate'dan OLDIN — yopiq paytda ham o'qiladi) ──
site_router = APIRouter(prefix="/api/site-settings")


@site_router.get("")
def get_site_settings():
    s = get_settings()
    return {"maintenanceMode": s["maintenanceMode"], "message": s["message"]}


@site_router.put("")
def put_site_settings(request: Request, body: dict = Depends(get_body),
                      user: CurrentUser = Depends(require_developer), db: Session = Depends(get_db)):
    maintenance = bool(body.get("maintenanceMode"))
    message = str(body["message"])[:500] if body.get("message") else None
    row = db.get(SiteSetting, 1)
    if row is None:
        row = SiteSetting(id=1)
        db.add(row)
    row.maintenanceMode = maintenance
    row.maintenanceMessage = message
    db.commit()
    _cache["value"] = None  # keshni bekor qilish
    audit("Sayt texnik xizmatga yopildi" if maintenance else "Sayt qayta ochildi", message or "", user.login, client_ip(request))
    return {"maintenanceMode": maintenance, "message": message}


# ── Health ──
health_router = APIRouter()


@health_router.get("/health")
def health():
    from ..config import ENV
    from datetime import datetime, timezone
    return {"ok": True, "env": ENV, "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")}


@health_router.get("/health/ready")
def health_ready():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"ok": True, "db": "up"}
    except Exception:
        return JSONResponse(status_code=503, content={"ok": False, "db": "down"})
