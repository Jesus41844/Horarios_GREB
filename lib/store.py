"""Almacén de datos: Postgres (Supabase) si hay DATABASE_URL, SQLite local si no."""
import os
import sqlite3
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from .parser import Block, norm


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


class PostgresStore:
    """Tablas en el esquema `greb`, separado del resto de tablas de la base."""

    def __init__(self, url: str):
        self.url = url

    def _con(self):
        # prepare_threshold=None: el pooler de Supabase (pgbouncer) no admite prepared statements.
        return psycopg.connect(self.url, prepare_threshold=None, row_factory=dict_row, connect_timeout=15)

    def save_person(self, name, filename, blocks: list[Block]) -> bool:
        key = norm(name)
        with self._con() as con:  # una transacción: o se guarda todo o nada
            existed = con.execute("DELETE FROM greb.people WHERE key = %s", (key,)).rowcount > 0
            pid = con.execute(
                "INSERT INTO greb.people (name, key, filename) VALUES (%s, %s, %s) RETURNING id",
                (name, key, filename),
            ).fetchone()["id"]
            with con.cursor() as cur:
                cur.executemany(
                    "INSERT INTO greb.blocks (person_id, day, start_min, end_min, subject, room, tags) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    [(pid, b.day, b.start, b.end, b.subject, b.room, b.tags) for b in blocks],
                )
        return existed

    def all_blocks(self) -> list[dict]:
        with self._con() as con:
            return con.execute(
                'SELECT p.name, b.day, b.start_min AS start, b.end_min AS "end" '
                "FROM greb.blocks b JOIN greb.people p ON p.id = b.person_id"
            ).fetchall()

    def list_people(self) -> list[dict]:
        with self._con() as con:
            return con.execute(
                "SELECT name, filename, uploaded_at FROM greb.people ORDER BY key"
            ).fetchall()

    def get_person(self, name):
        with self._con() as con:
            p = con.execute(
                "SELECT id, name FROM greb.people WHERE key = %s", (norm(name),)
            ).fetchone()
            if not p:
                return None
            blocks = con.execute(
                'SELECT day, start_min AS start, end_min AS "end", subject, room, tags '
                "FROM greb.blocks WHERE person_id = %s",
                (p["id"],),
            ).fetchall()
        return {"name": p["name"], "blocks": blocks}

    def delete_person(self, name) -> bool:
        with self._con() as con:
            return con.execute("DELETE FROM greb.people WHERE key = %s", (norm(name),)).rowcount > 0


def get_store():
    url = os.environ.get("DATABASE_URL")
    if url:
        return PostgresStore(url)
    return SqliteStore(Path(__file__).resolve().parent.parent / "data.db")
