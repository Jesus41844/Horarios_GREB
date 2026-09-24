"""Instalación inicial: crea las tablas y la primera cuenta desde la propia web.

Existe porque la red desde la que se administra puede tener bloqueado el puerto
de Postgres, mientras que el servidor sí alcanza la base.

Se cierra sola: en cuanto hay una cuenta, deja de funcionar. Además exige el
token de `SETUP_TOKEN`; si esa variable no está definida, la instalación está
deshabilitada.
"""
import hmac
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .. import repo, security
from ..db import SCHEMA_FILE, Conn, get_conn_raw
from ..deps import COOKIE, get_conn
from .auth import me_payload

router = APIRouter(prefix="/setup", tags=["setup"])


class SetupIn(BaseModel):
    token: str
    email: str
    name: str
    password: str


def _users_table_missing(c: Conn) -> bool:
    if not c.pg:
        return False  # en SQLite las tablas se crean solas al conectar
    return not c.query(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = 'horarios' AND table_name = 'users'"
    )


def _needed(c: Conn) -> bool:
    """Hace falta instalar si no hay tablas o si no hay ninguna cuenta."""
    if _users_table_missing(c):
        return True
    return c.query("SELECT COUNT(*) AS n FROM horarios.users")[0]["n"] == 0


@router.get("")
def status(c: Conn = Depends(get_conn)):
    return {"needed": _needed(c), "enabled": bool(os.environ.get("SETUP_TOKEN"))}


@router.post("")
def run(body: SetupIn, request: Request, response: Response, c: Conn = Depends(get_conn)):
    expected = os.environ.get("SETUP_TOKEN")
    if not expected:
        raise HTTPException(403, "La instalación está deshabilitada.")
    if not hmac.compare_digest(body.token.strip().encode(), expected.encode()):
        raise HTTPException(403, "Token de instalación incorrecto.")
    if not _needed(c):
        raise HTTPException(409, "Ya hay una cuenta: la instalación está cerrada.")

    email = body.email.strip().lower()
    if "@" not in email or not body.name.strip():
        raise HTTPException(400, "Hacen falta un correo válido y un nombre.")
    if len(body.password) < security.MIN_PASSWORD:
        raise HTTPException(400, f"La contraseña necesita al menos {security.MIN_PASSWORD} caracteres.")

    if _users_table_missing(c):
        # El esquema es idempotente, pero necesita autocommit para los CREATE.
        with get_conn_raw() as raw:
            raw.execute(SCHEMA_FILE.read_text(encoding="utf-8"))

    user_id = repo.create_user(c, email, body.name.strip(), body.password, is_superadmin=True)
    token = repo.create_session(c, user_id)
    c.commit()
    response.set_cookie(
        COOKIE, token, max_age=repo.SESSION_TTL, httponly=True, samesite="lax",
        secure=request.url.scheme == "https"
        or request.headers.get("x-forwarded-proto") == "https",
        path="/",
    )
    return me_payload(c, repo.user_by_email(c, email))
