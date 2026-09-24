"""Almacén de datos: Supabase en producción, SQLite local si no hay credenciales."""
import os
import sqlite3
from pathlib import Path

import httpx

from .parser import Block, norm

PAGE = 1000  # PostgREST devuelve como máximo 1000 filas por petición


class SqliteStore:
    """Solo para desarrollo local (en Vercel el disco no persiste)."""

    def __init__(self, path: Path):
        self.path = path
        with self._con() as con:
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS people (
                    id INTEGER PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE,
                    filename TEXT NOT NULL, uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE IF NOT EXISTS blocks (
                    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
                    day INTEGER, start INTEGER, "end" INTEGER, subject TEXT, room TEXT, tags TEXT);
                """
            )

    def _con(self):
        con = sqlite3.connect(self.path)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        return con

    def save_person(self, name, filename, blocks: list[Block]) -> bool:
        key = norm(name)
        with self._con() as con:
            existed = con.execute("DELETE FROM people WHERE key = ?", (key,)).rowcount > 0
            pid = con.execute(
                "INSERT INTO people (name, key, filename) VALUES (?, ?, ?)", (name, key, filename)
            ).lastrowid
            con.executemany(
                "INSERT INTO blocks VALUES (?, ?, ?, ?, ?, ?, ?)",
                [(pid, b.day, b.start, b.end, b.subject, b.room, b.tags) for b in blocks],
            )
        return existed

    def all_blocks(self) -> list[dict]:
        with self._con() as con:
            rows = con.execute(
                'SELECT p.name, b.day, b.start, b."end" FROM blocks b '
                "JOIN people p ON p.id = b.person_id"
            ).fetchall()
        return [dict(r) for r in rows]

    def list_people(self) -> list[dict]:
        with self._con() as con:
            rows = con.execute("SELECT name, filename, uploaded_at FROM people ORDER BY key")
            return [dict(r) for r in rows]

    def get_person(self, name):
        with self._con() as con:
            p = con.execute("SELECT id, name FROM people WHERE key = ?", (norm(name),)).fetchone()
            if not p:
                return None
            rows = con.execute(
                'SELECT day, start, "end", subject, room, tags FROM blocks WHERE person_id = ?',
                (p["id"],),
            ).fetchall()
        return {"name": p["name"], "blocks": [dict(r) for r in rows]}

    def delete_person(self, name) -> bool:
        with self._con() as con:
            return con.execute("DELETE FROM people WHERE key = ?", (norm(name),)).rowcount > 0


class SupabaseStore:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def _req(self, method, path, **kw) -> httpx.Response:
        r = httpx.request(
            method, self.base + path, headers={**self.headers, **kw.pop("headers", {})},
            timeout=20, **kw,
        )
        r.raise_for_status()
        return r

    def save_person(self, name, filename, blocks: list[Block]) -> bool:
        payload = {
            "p_name": name, "p_key": norm(name), "p_filename": filename,
            "p_blocks": [
                {"day": b.day, "start": b.start, "end": b.end,
                 "subject": b.subject, "room": b.room, "tags": b.tags}
                for b in blocks
            ],
        }
        return self._req("POST", "/rpc/replace_person", json=payload).json()

    def all_blocks(self) -> list[dict]:
        out, offset = [], 0
        while True:
            rows = self._req("GET", "/blocks", params={
                "select": "day,start:start_min,end:end_min,person:people(name)",
                "order": "id", "limit": PAGE, "offset": offset,
            }).json()
            out += [{"name": r["person"]["name"], "day": r["day"],
                     "start": r["start"], "end": r["end"]} for r in rows]
            if len(rows) < PAGE:
                return out
            offset += PAGE

    def list_people(self) -> list[dict]:
        return self._req("GET", "/people", params={
            "select": "name,filename,uploaded_at", "order": "key"}).json()

    def get_person(self, name):
        rows = self._req("GET", "/people", params={
            "key": f"eq.{norm(name)}",
            "select": "name,blocks(day,start:start_min,end:end_min,subject,room,tags)",
        }).json()
        return rows[0] if rows else None

    def delete_person(self, name) -> bool:
        r = self._req("DELETE", "/people", params={"key": f"eq.{norm(name)}"},
                      headers={"Prefer": "return=representation"})
        return bool(r.json())


def get_store():
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if url and key:
        return SupabaseStore(url, key)
    return SqliteStore(Path(__file__).resolve().parent.parent / "data.db")
