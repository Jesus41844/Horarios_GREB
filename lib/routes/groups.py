"""Agrupaciones (solo superadmin) y sus miembros (admin de la agrupación)."""
from typing import Literal

import sqlite3

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import repo, security
from ..db import Conn
from ..deps import Access, get_conn, group_admin, superadmin

router = APIRouter(tags=["groups"])

_UNIQUE_ERRORS = (sqlite3.IntegrityError, psycopg.errors.UniqueViolation)


class GroupIn(BaseModel):
    name: str


class MemberIn(BaseModel):
    email: str
    name: str = ""
    password: str = ""
    role: Literal["admin", "member"] = "member"


@router.post("/groups")
def create_group(body: GroupIn, _: dict = Depends(superadmin), c: Conn = Depends(get_conn)):
    name = body.name.strip()
    slug = repo.slugify(name)
    if not slug:
        raise HTTPException(400, "El nombre no es válido")
    try:
        repo.create_group(c, slug, name)
        c.commit()
    except _UNIQUE_ERRORS:
        raise HTTPException(409, f"Ya existe una agrupación «{slug}»")
    return {"slug": slug, "name": name}


@router.delete("/groups/{slug}")
def delete_group(slug: str, _: dict = Depends(superadmin), c: Conn = Depends(get_conn)):
    if not repo.delete_group(c, slug):
        raise HTTPException(404, "Agrupación no encontrada")
    c.commit()
    return {"deleted": slug}


@router.get("/requests")
def list_requests(_: dict = Depends(superadmin), c: Conn = Depends(get_conn)):
    """Solicitudes pendientes de aprobación, para el panel del superadmin."""
    return repo.pending_requests(c)


@router.post("/requests/{request_id}/approve")
def approve_request(request_id: int, _: dict = Depends(superadmin), c: Conn = Depends(get_conn)):
    """Aprueba: la persona pasa a administrar esa agrupación."""
    req = repo.request_by_id(c, request_id)
    if not req:
        raise HTTPException(404, "Esa solicitud ya no existe.")
    repo.set_member(c, req["group_id"], req["user_id"], "admin")
    repo.delete_request(c, request_id)
    c.commit()
    return {"approved": request_id}


@router.delete("/requests/{request_id}")
def reject_request(request_id: int, _: dict = Depends(superadmin), c: Conn = Depends(get_conn)):
    """Rechaza: se descarta la solicitud, la cuenta se queda sin acceso."""
    if not repo.delete_request(c, request_id):
        raise HTTPException(404, "Esa solicitud ya no existe.")
    c.commit()
    return {"rejected": request_id}


@router.get("/g/{slug}/members")
def list_members(access: Access = Depends(group_admin), c: Conn = Depends(get_conn)):
    return repo.list_members(c, access.group["id"])


@router.put("/g/{slug}/members")
def put_member(body: MemberIn, access: Access = Depends(group_admin), c: Conn = Depends(get_conn)):
    """Añade a la agrupación (o cambia el rol). Si el correo no tiene cuenta, la crea."""
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Correo no válido")
    user = repo.user_by_email(c, email)
    created = user is None
    if created:
        if not body.name.strip() or len(body.password) < security.MIN_PASSWORD:
            raise HTTPException(
                400, f"Cuenta nueva: hacen falta nombre y contraseña (mín. {security.MIN_PASSWORD} caracteres)"
            )
        user_id = repo.create_user(c, email, body.name.strip(), body.password)
    else:
        user_id = user["id"]
    repo.set_member(c, access.group["id"], user_id, body.role)
    c.commit()
    return {"id": user_id, "email": email, "role": body.role, "created": created}


@router.delete("/g/{slug}/members/{user_id}")
def remove_member(user_id: int, access: Access = Depends(group_admin), c: Conn = Depends(get_conn)):
    if not repo.remove_member(c, access.group["id"], user_id):
        raise HTTPException(404, "Ese usuario no es miembro")
    c.commit()
    return {"removed": user_id}
