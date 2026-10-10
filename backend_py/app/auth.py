"""JWT, parol va joriy foydalanuvchi (server/src/auth/{jwt,password,middleware,loadPerms}.js)."""
import time
from dataclasses import dataclass
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .config import JWT_EXPIRES_IN, JWT_SECRET, jwt_seconds
from .db import get_db
from .models import User

ROUNDS = 10


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(ROUNDS)).decode("utf-8")


def verify_password(plain: str, hashed: Optional[str]) -> bool:
    # Node'dagi bcryptjs bilan yaratilgan $2a$/$2b$ hashlar ham shu yerda ishlaydi
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def sign_token(user: User) -> str:
    issued = int(time.time())
    payload = {
        "sub": str(user.id),
        "login": user.login,
        "role": user.role,
        "name": user.fullName,
        "facultyId": user.facultyId,
        "departmentId": user.departmentId,
        "teacherId": user.teacherId,
        "isOwner": bool(user.isOwner),
        "iat": issued,
        "exp": issued + jwt_seconds(JWT_EXPIRES_IN),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


@dataclass
class CurrentUser:
    sub: int
    login: Optional[str]
    role: Optional[str]
    fullName: Optional[str]
    facultyId: Optional[int] = None
    departmentId: Optional[int] = None
    teacherId: Optional[int] = None
    isOwner: bool = False
    restrictions: Optional[str] = None


def token_user(request: Request) -> CurrentUser:
    """Authorization: Bearer <token> → tokendagi ma'lumot (DB'ga murojaatsiz)."""
    header = request.headers.get("authorization", "")
    token = header[7:] if header.startswith("Bearer ") else ""
    if not token:
        raise HTTPException(401, "Avtorizatsiya talab qilinadi")
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Token yaroqsiz yoki muddati o'tgan")
    return CurrentUser(
        sub=int(p["sub"]), login=p.get("login"), role=p.get("role"), fullName=p.get("name"),
        facultyId=p.get("facultyId"), departmentId=p.get("departmentId"),
        teacherId=p.get("teacherId"), isOwner=bool(p.get("isOwner")),
    )


def current_user(request: Request, db: Session = Depends(get_db)) -> CurrentUser:
    """requireAuth + loadPerms: rol/qamrov/cheklovlarni HAR so'rovda DB'dan qayta o'qiydi.
    Faol bo'lmagan yoki o'chirilgan hisob → 401 (fail-closed)."""
    user = token_user(request)
    u = db.get(User, user.sub)
    if u is None or not u.active:
        raise HTTPException(401, "Akkaunt faol emas yoki topilmadi")
    user.login = u.login
    user.role = u.role
    user.facultyId = u.facultyId
    user.departmentId = u.departmentId
    user.teacherId = u.teacherId
    user.restrictions = u.restrictions
    user.isOwner = bool(u.isOwner)
    return user


def require_roles(*roles):
    def dep(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(403, "Ruxsat yetarli emas")
        return user
    return dep


def require_developer(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if not user.isOwner:
        raise HTTPException(403, "Bu amal faqat egalik huquqiga ega hisob uchun")
    return user
