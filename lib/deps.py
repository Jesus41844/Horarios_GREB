"""Dependencias de FastAPI: conexión, usuario de la sesión y permisos por agrupación."""
from typing import NamedTuple

from fastapi import Depends, HTTPException, Request

from . import repo
from .db import Conn, connect

COOKIE = "horarios_session"


def get_conn():
    with connect() as c:
        yield c


def session_token(request: Request) -> str | None:
    return request.cookies.get(COOKIE)


def current_user(request: Request, c: Conn = Depends(get_conn)) -> dict:
    token = session_token(request)
    user = repo.user_for_token(c, token) if token else None
    if not user:
        raise HTTPException(401, "Sesión no iniciada")
    return user


def superadmin(user: dict = Depends(current_user)) -> dict:
    if not user["is_superadmin"]:
        raise HTTPException(403, "Solo el superadmin puede hacer esto")
    return user


class Access(NamedTuple):
    group: dict
    role: str  # 'admin' | 'member'
    user: dict


def group_access(slug: str, user: dict = Depends(current_user), c: Conn = Depends(get_conn)) -> Access:
    """Miembro de la agrupación (o superadmin). A quien no lo es le respondemos 404,
    para no revelar qué agrupaciones existen."""
    group = repo.group_by_slug(c, slug)
    if not group:
        raise HTTPException(404, "Agrupación no encontrada")
    if user["is_superadmin"]:
        return Access(group, "admin", user)
    role = repo.member_role(c, group["id"], user["id"])
    if not role:
        raise HTTPException(404, "Agrupación no encontrada")
    return Access(group, role, user)


def group_admin(access: Access = Depends(group_access)) -> Access:
    if access.role != "admin":
        raise HTTPException(403, "Hace falta ser administrador de la agrupación")
    return access


def group_owner(access: Access = Depends(group_access)) -> Access:
    """La cuenta del correo inicial de la agrupación. Solo ella decide quién entra,
    quién sale y quién es administrador. El superadmin también pasa."""
    if not (access.user["is_superadmin"] or access.group["owner_user_id"] == access.user["id"]):
        raise HTTPException(403, "Solo la cuenta principal de la agrupación puede hacer esto.")
    return access
