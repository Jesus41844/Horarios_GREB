from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .. import repo, security
from ..db import Conn
from ..deps import COOKIE, current_user, get_conn, session_token

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class PasswordIn(BaseModel):
    current: str
    new: str


def me_payload(c: Conn, user: dict) -> dict:
    return {
        "user": {
            "id": user["id"], "email": user["email"], "name": user["name"],
            "is_superadmin": bool(user["is_superadmin"]),
        },
        "groups": repo.groups_for_user(c, user),
    }


def _secure(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, c: Conn = Depends(get_conn)):
    email = body.email.strip().lower()
    if repo.recent_failures(c, email) >= repo.LOGIN_MAX_FAILURES:
        raise HTTPException(429, "Demasiados intentos fallidos. Espera 15 minutos.")
    user = repo.user_by_email(c, email)
    if not security.verify_password(body.password, user["password_hash"] if user else None):
        repo.record_failure(c, email)
        c.commit()  # el fallo debe quedar registrado aunque respondamos con error
        raise HTTPException(401, "Correo o contraseña incorrectos")
    repo.clear_failures(c, email)
    token = repo.create_session(c, user["id"])
    c.commit()
    response.set_cookie(
        COOKIE, token, max_age=repo.SESSION_TTL, httponly=True, samesite="lax",
        secure=_secure(request), path="/",
    )
    return me_payload(c, user)


@router.post("/logout")
def logout(request: Request, response: Response, c: Conn = Depends(get_conn)):
    token = session_token(request)
    if token:
        repo.delete_session(c, token)
        c.commit()
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(current_user), c: Conn = Depends(get_conn)):
    return me_payload(c, user)


@router.post("/password")
def change_password(
    body: PasswordIn, request: Request,
    user: dict = Depends(current_user), c: Conn = Depends(get_conn),
):
    full = repo.user_by_email(c, user["email"])
    if not security.verify_password(body.current, full["password_hash"]):
        raise HTTPException(400, "La contraseña actual no es correcta")
    if len(body.new) < security.MIN_PASSWORD:
        raise HTTPException(400, f"La nueva contraseña necesita al menos {security.MIN_PASSWORD} caracteres")
    repo.set_password(c, user["id"], body.new)
    repo.delete_other_sessions(c, user["id"], session_token(request))  # cierra las demás sesiones
    c.commit()
    return {"ok": True}
