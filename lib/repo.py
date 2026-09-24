"""Todas las consultas SQL. Cada función recibe la conexión (`Conn`) y no confirma nada:
quien llama decide cuándo hacer commit()."""
import re
import time

from . import security
from .db import Conn
from .parser import Block, norm

SESSION_TTL = 7 * 24 * 3600
LOGIN_MAX_FAILURES = 5
LOGIN_WINDOW = 15 * 60


def now() -> int:
    return int(time.time())


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", norm(text)).strip("-")


# --- usuarios -------------------------------------------------------------

_USER_COLS = "id, email, name, password_hash, is_superadmin"


def user_by_email(c: Conn, email: str) -> dict | None:
    rows = c.query(f"SELECT {_USER_COLS} FROM horarios.users WHERE email = ?", (email,))
    return rows[0] if rows else None


def create_user(c: Conn, email: str, name: str, password: str, is_superadmin: bool = False) -> int:
    return c.query(
        "INSERT INTO horarios.users (email, name, password_hash, is_superadmin, created_at) "
        "VALUES (?, ?, ?, ?, ?) RETURNING id",
        (email, name, security.hash_password(password), int(is_superadmin), now()),
    )[0]["id"]


def set_password(c: Conn, user_id: int, password: str) -> None:
    c.execute(
        "UPDATE horarios.users SET password_hash = ? WHERE id = ?",
        (security.hash_password(password), user_id),
    )


# --- sesiones -------------------------------------------------------------

def create_session(c: Conn, user_id: int) -> str:
    token = security.new_token()
    c.execute(
        "INSERT INTO horarios.sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
        (security.hash_token(token), user_id, now() + SESSION_TTL),
    )
    c.execute("DELETE FROM horarios.sessions WHERE expires_at < ?", (now(),))
    return token


def user_for_token(c: Conn, token: str) -> dict | None:
    rows = c.query(
        "SELECT u.id, u.email, u.name, u.is_superadmin FROM horarios.sessions s "
        "JOIN horarios.users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?",
        (security.hash_token(token), now()),
    )
    return rows[0] if rows else None


def delete_session(c: Conn, token: str) -> None:
    c.execute("DELETE FROM horarios.sessions WHERE id = ?", (security.hash_token(token),))


def delete_other_sessions(c: Conn, user_id: int, keep_token: str | None) -> None:
    c.execute(
        "DELETE FROM horarios.sessions WHERE user_id = ? AND id <> ?",
        (user_id, security.hash_token(keep_token or "")),
    )


# --- intentos fallidos de login ---------------------------------------------

def recent_failures(c: Conn, email: str) -> int:
    return c.query(
        "SELECT COUNT(*) AS n FROM horarios.login_failures WHERE email = ? AND at > ?",
        (email, now() - LOGIN_WINDOW),
    )[0]["n"]


def record_failure(c: Conn, email: str) -> None:
    c.execute("DELETE FROM horarios.login_failures WHERE at < ?", (now() - LOGIN_WINDOW,))
    c.execute("INSERT INTO horarios.login_failures (email, at) VALUES (?, ?)", (email, now()))


def clear_failures(c: Conn, email: str) -> None:
    c.execute("DELETE FROM horarios.login_failures WHERE email = ?", (email,))


# --- agrupaciones y miembros ---------------------------------------------

def create_group(c: Conn, slug: str, name: str) -> int:
    return c.query(
        "INSERT INTO horarios.groups (slug, name, created_at) VALUES (?, ?, ?) RETURNING id",
        (slug, name, now()),
    )[0]["id"]


def group_by_slug(c: Conn, slug: str) -> dict | None:
    rows = c.query("SELECT id, slug, name FROM horarios.groups WHERE slug = ?", (slug,))
    return rows[0] if rows else None


def delete_group(c: Conn, slug: str) -> bool:
    return c.execute("DELETE FROM horarios.groups WHERE slug = ?", (slug,)) > 0


def groups_for_user(c: Conn, user: dict) -> list[dict]:
    """Superadmin: todas (como admin). El resto: solo aquellas de las que es miembro."""
    if user["is_superadmin"]:
        return c.query("SELECT id, slug, name, 'admin' AS role FROM horarios.groups ORDER BY name")
    return c.query(
        "SELECT g.id, g.slug, g.name, m.role FROM horarios.memberships m "
        "JOIN horarios.groups g ON g.id = m.group_id WHERE m.user_id = ? ORDER BY g.name",
        (user["id"],),
    )


def member_role(c: Conn, group_id: int, user_id: int) -> str | None:
    rows = c.query(
        "SELECT role FROM horarios.memberships WHERE group_id = ? AND user_id = ?",
        (group_id, user_id),
    )
    return rows[0]["role"] if rows else None


def list_members(c: Conn, group_id: int) -> list[dict]:
    return c.query(
        "SELECT u.id, u.email, u.name, m.role FROM horarios.memberships m "
        "JOIN horarios.users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.name",
        (group_id,),
    )


def set_member(c: Conn, group_id: int, user_id: int, role: str) -> None:
    if c.execute(
        "UPDATE horarios.memberships SET role = ? WHERE group_id = ? AND user_id = ?",
        (role, group_id, user_id),
    ) == 0:
        c.execute(
            "INSERT INTO horarios.memberships (user_id, group_id, role) VALUES (?, ?, ?)",
            (user_id, group_id, role),
        )


def remove_member(c: Conn, group_id: int, user_id: int) -> bool:
    return c.execute(
        "DELETE FROM horarios.memberships WHERE group_id = ? AND user_id = ?", (group_id, user_id)
    ) > 0


# --- solicitudes de acceso -------------------------------------------------

def list_public_groups(c: Conn) -> list[dict]:
    """Para el formulario de registro: solo nombre y slug, sin datos de nadie."""
    return c.query("SELECT slug, name FROM horarios.groups ORDER BY name")


def create_request(c: Conn, user_id: int, group_id: int) -> None:
    c.execute(
        "INSERT INTO horarios.requests (user_id, group_id, created_at) VALUES (?, ?, ?)",
        (user_id, group_id, now()),
    )


def pending_requests(c: Conn) -> list[dict]:
    return c.query(
        "SELECT r.id, u.name, u.email, g.name AS group_name, g.slug, r.created_at "
        "FROM horarios.requests r "
        "JOIN horarios.users u ON u.id = r.user_id "
        "JOIN horarios.groups g ON g.id = r.group_id "
        "ORDER BY r.created_at"
    )


def request_by_id(c: Conn, request_id: int) -> dict | None:
    rows = c.query(
        "SELECT id, user_id, group_id FROM horarios.requests WHERE id = ?", (request_id,)
    )
    return rows[0] if rows else None


def delete_request(c: Conn, request_id: int) -> bool:
    return c.execute("DELETE FROM horarios.requests WHERE id = ?", (request_id,)) > 0


def requests_of_user(c: Conn, user_id: int) -> list[dict]:
    return c.query(
        "SELECT g.name, g.slug FROM horarios.requests r "
        "JOIN horarios.groups g ON g.id = r.group_id WHERE r.user_id = ?",
        (user_id,),
    )


def group_has_admin(c: Conn, group_id: int) -> bool:
    return bool(c.query(
        "SELECT 1 FROM horarios.memberships WHERE group_id = ? AND role = 'admin'",
        (group_id,),
    ))


# --- personas y horarios (siempre dentro de una agrupación) ---------------------

def save_person(c: Conn, group_id: int, name: str, filename: str, blocks: list[Block]) -> bool:
    """Guarda o reemplaza a la persona. Devuelve True si ya existía (actualizada)."""
    key = norm(name)
    existed = c.execute(
        "DELETE FROM horarios.people WHERE group_id = ? AND key = ?", (group_id, key)
    ) > 0
    pid = c.query(
        "INSERT INTO horarios.people (group_id, name, key, filename, uploaded_at) "
        "VALUES (?, ?, ?, ?, ?) RETURNING id",
        (group_id, name, key, filename, now()),
    )[0]["id"]
    c.executemany(
        "INSERT INTO horarios.blocks (person_id, day, start_min, end_min, subject, room, tags) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(pid, b.day, b.start, b.end, b.subject, b.room, b.tags) for b in blocks],
    )
    return existed


def all_blocks(c: Conn, group_id: int) -> list[dict]:
    return c.query(
        'SELECT p.name, b.day, b.start_min AS start, b.end_min AS "end" '
        "FROM horarios.blocks b JOIN horarios.people p ON p.id = b.person_id "
        "WHERE p.group_id = ?",
        (group_id,),
    )


def list_people(c: Conn, group_id: int) -> list[dict]:
    return c.query(
        "SELECT name, filename, uploaded_at FROM horarios.people WHERE group_id = ? ORDER BY key",
        (group_id,),
    )


def get_person(c: Conn, group_id: int, name: str) -> dict | None:
    rows = c.query(
        "SELECT id, name FROM horarios.people WHERE group_id = ? AND key = ?",
        (group_id, norm(name)),
    )
    if not rows:
        return None
    blocks = c.query(
        'SELECT day, start_min AS start, end_min AS "end", subject, room, tags '
        "FROM horarios.blocks WHERE person_id = ?",
        (rows[0]["id"],),
    )
    return {"name": rows[0]["name"], "blocks": blocks}


def delete_person(c: Conn, group_id: int, name: str) -> bool:
    return c.execute(
        "DELETE FROM horarios.people WHERE group_id = ? AND key = ?", (group_id, norm(name))
    ) > 0
