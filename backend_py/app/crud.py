"""Umumiy CRUD marshrutlari — server/src/lib/crudRouter.js ning Python nusxasi.

GET /  (?q=) · GET /{id} · POST / · PUT /{id} · DELETE /{id}
"""
import json
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .access import require_read, require_write, scope_assert, scope_where
from .auth import CurrentUser, current_user
from .db import audit, get_db
from .schemas import parse
from .serial import to_json


async def get_body(request: Request) -> dict:
    """JSON body (yaroqsiz yoki yo'q bo'lsa — bo'sh obyekt; validatsiya o'zi xato beradi)."""
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def client_ip(request: Request) -> str:
    # trust proxy: reverse-proxy (Render) orqasida birinchi IP
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"


def label_of(row) -> str:
    for attr in ("name", "fullName", "login"):
        v = getattr(row, attr, None)
        if v is not None:
            return str(v)
    return str(row.id)


def crud_router(
    path: str,
    resource: str,
    model,
    label: str,
    schema: str,
    include: Optional[dict] = None,
    sanitize: Optional[Callable[[dict, CurrentUser], dict]] = None,
    transform: Optional[Callable[[dict], dict]] = None,
    pre_write: Optional[Callable[[Session, CurrentUser, int], None]] = None,
) -> APIRouter:
    router = APIRouter(prefix=f"/{path}")
    read_dep = Depends(require_read(resource))
    write_dep = Depends(require_write(resource))

    def find(db: Session, row_id: int, user: CurrentUser):
        clause = scope_where(resource, user)
        stmt = select(model).where(model.id == row_id)
        if clause is not None:
            stmt = stmt.where(clause)
        return db.scalars(stmt).first()

    def clean(row, user: CurrentUser) -> dict:
        data = to_json(row, include)
        return sanitize(data, user) if sanitize else data

    @router.get("", dependencies=[read_dep])
    def list_rows(q: str = Query(""), user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        clause = scope_where(resource, user)
        stmt = select(model).order_by(model.id)
        if clause is not None:
            stmt = stmt.where(clause)
        # Qidiruv sanitize'dan KEYIN emas, undan OLDIN emas — cleaned bo'yicha (maxfiy maydon qidirilmaydi)
        cleaned = [clean(r, user) for r in db.scalars(stmt).all()]
        needle = q.strip().lower()
        if needle:
            cleaned = [r for r in cleaned
                       if needle in json.dumps(r, ensure_ascii=False, separators=(",", ":")).lower()]
        return cleaned

    @router.get("/{row_id}", dependencies=[read_dep])
    def get_row(row_id: int, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        row = find(db, row_id, user)
        if row is None:
            raise HTTPException(404, "Topilmadi")
        return clean(row, user)

    @router.post("", status_code=201, dependencies=[write_dep])
    def create_row(request: Request, body: dict = Depends(get_body),
                   user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        data = parse(schema, body)
        if transform:
            data = transform(data)
        data = scope_assert(db, resource, user, data, None)
        row = model(**data)
        db.add(row)
        db.commit()
        db.expire(row)
        audit(f"Qo'shildi: {label}", label_of(row), user.login, client_ip(request))
        return clean(row, user)

    @router.put("/{row_id}", dependencies=[write_dep])
    def update_row(row_id: int, request: Request, body: dict = Depends(get_body),
                   user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        if pre_write:
            pre_write(db, user, row_id)
        existing = find(db, row_id, user)
        if existing is None:
            raise HTTPException(404, "Topilmadi")
        data = parse(schema, body, partial=True)
        if transform:
            data = transform(data)
        data = scope_assert(db, resource, user, data, existing)
        for key, value in data.items():
            setattr(existing, key, value)
        db.commit()
        db.expire(existing)
        audit(f"Tahrirlandi: {label}", label_of(existing), user.login, client_ip(request))
        return clean(existing, user)

    @router.delete("/{row_id}", status_code=204, dependencies=[write_dep])
    def delete_row(row_id: int, request: Request,
                   user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
        if pre_write:
            pre_write(db, user, row_id)
        existing = find(db, row_id, user)
        if existing is None:
            raise HTTPException(404, "Topilmadi")
        db.delete(existing)
        db.commit()
        audit(f"O'chirildi: {label}", row_id, user.login, client_ip(request))
        return Response(status_code=204)

    return router
