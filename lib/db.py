"""Conexión a la base: Postgres (DATABASE_URL) en producción, SQLite local si no hay URL.

Las consultas se escriben una sola vez, con `?` y tablas `horarios.*`. En SQLite el archivo
se adjunta con el nombre `horarios`, así el mismo SQL funciona en ambos motores.
"""
import os
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_FILE = ROOT / "db" / "schema.sql"
MIGRATIONS_FILE = ROOT / "db" / "migrations.sql"

# Columnas que `migrations.sql` debe haber creado. Si falta alguna, la base viene
# de una versión anterior y hay que aplicarlas. Al añadir una migración nueva, se
# añade aquí su columna.
_ESPERADAS = [("blocks", "kind"), ("groups", "owner_user_id"),
              ("applied_migrations", "name")]
_SENTINEL = (
    "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'horarios' "
    "AND (table_name, column_name) IN (" + ", ".join(["(%s, %s)"] * len(_ESPERADAS)) + ")"
)
_SENTINEL_ARGS = tuple(x for par in _ESPERADAS for x in par)
_migrated = False
_fixed: set[str] = set()      # bases (URL o ruta) cuyas limpiezas ya se aplicaron
# Id fijo del candado: hash() de Python varía entre procesos y no serializaría nada.
_LOCK_ID = 728411


def postgres_url() -> str | None:
    return os.environ.get("DATABASE_URL") or None


def sqlite_path() -> str:
    return os.environ.get("HORARIOS_SQLITE") or str(ROOT / "data.db")


def sqlite_ddl() -> str:
    """Traduce schema.sql (Postgres) a SQLite."""
    sql = SCHEMA_FILE.read_text(encoding="utf-8")
    sql = re.sub(r"create schema[^;]*;", "", sql, flags=re.I)
    sql = re.sub(r"alter table[^;]*row level security;", "", sql, flags=re.I)
    sql = sql.replace("bigint generated always as identity primary key", "INTEGER PRIMARY KEY AUTOINCREMENT")
    sql = sql.replace("references horarios.", "references ")  # SQLite no admite FK calificadas
    sql = re.sub(  # en SQLite el esquema va en el nombre del índice, no en la tabla
        r"create index if not exists (\w+) on horarios\.(\w+)",
        r"create index if not exists horarios.\1 on \2",
        sql, flags=re.I,
    )
    return sql


class Conn:
    def __init__(self, raw, postgres: bool):
        self.raw, self.pg = raw, postgres

    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if self.pg else sql

    def query(self, sql: str, params=()) -> list[dict]:
        cur = self.raw.execute(self._sql(sql), params)
        rows = cur.fetchall() if cur.description else []
        return [dict(r) for r in rows]

    def execute(self, sql: str, params=()) -> int:
        return self.raw.execute(self._sql(sql), params).rowcount

    def executemany(self, sql: str, seq) -> None:
        if self.pg:
            with self.raw.cursor() as cur:
                cur.executemany(self._sql(sql), seq)
        else:
            self.raw.executemany(sql, seq)

    def commit(self) -> None:
        self.raw.commit()


def _apply_migrations(url: str) -> None:
    """Aplica las migraciones pendientes una vez por proceso.

    Hace falta porque quien administra no puede abrir el puerto de Postgres
    desde su red: si no se aplicaran solas, un despliegue con cambios de esquema
    dejaría la app rota sin forma de arreglarla.
    """
    global _migrated
    if _migrated:
        return
    with psycopg.connect(url, prepare_threshold=None, connect_timeout=20, autocommit=True) as con:
        if con.execute(_SENTINEL, _SENTINEL_ARGS).fetchone()[0] == len(_ESPERADAS):
            _migrated = True
            return
        # Un candado para que dos arranques a la vez no se pisen.
        con.execute("SELECT pg_advisory_lock(%s)", (_LOCK_ID,))
        try:
            if con.execute(_SENTINEL, _SENTINEL_ARGS).fetchone()[0] < len(_ESPERADAS):
                con.execute(MIGRATIONS_FILE.read_text(encoding="utf-8"))
        finally:
            con.execute("SELECT pg_advisory_unlock(%s)", (_LOCK_ID,))
    _migrated = True


@contextmanager
def get_conn_raw():
    """Conexión suelta en autocommit, para aplicar el esquema (los CREATE del DDL)."""
    url = postgres_url()
    if not url:
        raise RuntimeError("Solo aplica a Postgres; SQLite crea sus tablas al conectar.")
    con = psycopg.connect(url, prepare_threshold=None, connect_timeout=20, autocommit=True)
    try:
        yield con
    finally:
        con.close()


@contextmanager
def connect():
    """Cierra siempre; lo que no se haya confirmado con commit() se descarta."""
    url = postgres_url()
    if url:
        try:
            _apply_migrations(url)
        except Exception:
            pass  # que un fallo migrando no tumbe la petición; se reintenta luego
        # prepare_threshold=None: el pooler de Supabase (pgbouncer) no admite prepared statements.
        raw = psycopg.connect(url, prepare_threshold=None, row_factory=dict_row, connect_timeout=15)
    else:
        # check_same_thread=False: FastAPI puede abrir y cerrar la dependencia en
        # hilos distintos del pool. Cada petición usa su propia conexión, así que
        # nunca hay dos hilos escribiendo a la vez.
        raw = sqlite3.connect(":memory:", check_same_thread=False)
        raw.row_factory = sqlite3.Row
        raw.execute("ATTACH DATABASE ? AS horarios", (sqlite_path(),))
        raw.execute("PRAGMA foreign_keys = ON")
        raw.executescript(sqlite_ddl())
    conn = Conn(raw, postgres=bool(url))
    _aplicar_limpiezas(conn, url or sqlite_path())
    try:
        yield conn
    finally:
        raw.close()


def _aplicar_limpiezas(conn: "Conn", clave: str) -> None:
    """Corrige datos viejos una vez por base y proceso. Import perezoso: `fixes`
    depende de `repo`, que depende de este módulo."""
    if clave in _fixed:
        return
    try:
        from . import fixes
        fixes.run(conn)
        _fixed.add(clave)
    except Exception:
        conn.raw.rollback()   # que un fallo aquí no tumbe la petición; se reintenta luego
