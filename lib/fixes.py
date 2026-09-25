"""Limpiezas de datos que se aplican una sola vez, solas, al arrancar.

Existen porque quien administra no puede abrir el puerto de Postgres desde su red:
si un cambio de reglas exige corregir datos ya guardados, tiene que poder hacerlo
la propia app. Cada limpieza se registra en `applied_migrations` para no repetirse.
"""
import time

from . import repo
from .db import Conn


def _borrar_virtuales(c: Conn) -> str:
    n = repo.delete_virtual_blocks(c)
    return f"{n} clase{'s' if n != 1 else ''} virtual{'es' if n != 1 else ''} borrada{'s' if n != 1 else ''}"


# (nombre, función). El nombre no se reutiliza nunca: es lo que impide repetirla.
FIXES = [
    ("2026-09-24-borrar-clases-virtuales", _borrar_virtuales),
]


def run(c: Conn) -> dict[str, str]:
    """Aplica las pendientes y devuelve lo que se hizo en esta llamada."""
    hechas: dict[str, str] = {}
    for nombre, fn in FIXES:
        if c.query("SELECT 1 FROM horarios.applied_migrations WHERE name = ?", (nombre,)):
            continue
        detalle = fn(c)
        # ON CONFLICT: si dos arranques coinciden, el segundo simplemente no anota.
        c.execute(
            "INSERT INTO horarios.applied_migrations (name, applied_at, detail) "
            "VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING",
            (nombre, int(time.time()), detalle),
        )
        hechas[nombre] = detalle
    c.commit()
    return hechas


def aplicadas(c: Conn) -> dict[str, str]:
    """Lo que ya se aplicó alguna vez, con su detalle."""
    try:
        rows = c.query("SELECT name, detail FROM horarios.applied_migrations ORDER BY name")
    except Exception:
        return {}
    return {r["name"]: r["detail"] for r in rows}
