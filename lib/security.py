"""Contraseñas (scrypt, sin dependencias externas) y tokens de sesión."""
import base64
import hashlib
import hmac
import os
import secrets

MIN_PASSWORD = 8
_N, _R, _P = 2**14, 8, 1


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def _scrypt(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    return f"scrypt${_b64(salt)}${_b64(_scrypt(password, salt))}"


# Hash de relleno: si el correo no existe, gastamos el mismo tiempo que con uno real.
_DUMMY = hash_password(secrets.token_urlsafe(8))


def verify_password(password: str, stored: str | None) -> bool:
    try:
        _, salt, digest = (stored or _DUMMY).split("$")
        expected = base64.b64decode(digest)
        ok = hmac.compare_digest(_scrypt(password, base64.b64decode(salt)), expected)
    except ValueError:
        return False
    return ok and stored is not None


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
