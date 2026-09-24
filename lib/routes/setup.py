"""Primera cuenta: crea las tablas y la cuenta principal desde la propia web.

Existe porque la red desde la que se administra puede tener bloqueado el puerto
de Postgres, mientras que el servidor sí alcanza la base.

Se cierra sola: en cuanto existe una cuenta, deja de funcionar para siempre.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .. import repo, security
from ..db import SCHEMA_FILE, Conn, get_conn_raw
from ..deps import COOKIE, get_conn
from .auth import me_payload

router = APIRouter(prefix="/setup", tags=["setup"])


class SetupIn(BaseModel):
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
    """Hace falta si no hay tablas todavía o si no existe ninguna cuenta."""
    if _users_table_missing(c):
        return True
    return c.query("SELECT COUNT(*) AS n FROM horarios.users")[0]["n"] == 0


@router.get("")
def status(c: Conn = Depends(get_conn)):
    return {"needed": _needed(c)}


@router.post("")
def run(body: SetupIn, request: Request, response: Response, c: Conn = Depends(get_conn)):
    if not _needed(c):
        raise HTTPException(409, "Ya existe una cuenta. Entra con tu correo.")

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
