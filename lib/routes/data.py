"""Horarios de una agrupación: ver/buscar (miembros) y subir/borrar (admins)."""
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from .. import repo
from ..db import Conn
from ..deps import Access, get_conn, group_access, group_admin
from ..parser import ParseError, norm, parse_pdf, person_from_filename
from ..schedule import build_week, merge_ranges

router = APIRouter(prefix="/g/{slug}", tags=["horarios"])

MAX_PDF_BYTES = 4 * 1024 * 1024  # Vercel limita cada petición a ~4,5 MB


class WorkIn(BaseModel):
    name: str            # a quién; si no existe en la agrupación, se crea
    day: int             # 0 = lunes ... 6 = domingo
    start: str           # "14:00"
    end: str             # "18:30"
    place: str = ""


def _minutes(hhmm: str) -> int:
    try:
        h, m = (int(x) for x in hhmm.split(":"))
    except ValueError:
        raise HTTPException(400, f"Hora no válida: «{hhmm}». Usa el formato 14:30.")
    if not (0 <= h < 24 and 0 <= m < 60):
        raise HTTPException(400, f"Hora fuera de rango: «{hhmm}».")
    return h * 60 + m


@router.post("/upload")
def upload(
    files: list[UploadFile] = File(...),
    access: Access = Depends(group_admin), c: Conn = Depends(get_conn),
):
    """Procesa cada PDF por separado; un fallo no bloquea a los demás.

    Ruta síncrona a propósito: leer el PDF bloquea, y así corre en el mismo hilo
    que la conexión de la base (SQLite no admite usarla desde otro hilo).
    """
    results, seen = [], set()
    for f in files:
        filename = f.filename or "(sin nombre)"
        data = f.file.read()
        name = person_from_filename(filename)
        res = {"file": filename, "name": name}
        try:
            if not filename.lower().endswith(".pdf"):
                raise ParseError("No es un archivo .pdf.")
            if not name:
                raise ParseError("El nombre del archivo no da un nombre de persona.")
            if len(data) > MAX_PDF_BYTES:
                raise ParseError("El PDF pesa más de 4 MB.")
            if norm(name) in seen:
                raise ParseError(f"Repetido en esta subida: ya hay otro PDF de «{name}».")
            seen.add(norm(name))
            with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
                tmp.write(data)
                tmp.flush()
                blocks = parse_pdf(Path(tmp.name))
            updated = repo.save_person(c, access.group["id"], name, filename, blocks)
            c.commit()
            res.update(ok=True, blocks=len(blocks), updated=updated)
        except ParseError as e:
            res.update(ok=False, error=str(e))
        except Exception as e:  # cualquier otro fallo también se informa con nombre
            res.update(ok=False, error=f"Error inesperado: {type(e).__name__}: {e}")
        results.append(res)
    return {
        "results": results,
        "ok": sum(r["ok"] for r in results),
        "failed": sum(not r["ok"] for r in results),
    }


@router.get("/schedule")
def schedule(access: Access = Depends(group_access), c: Conn = Depends(get_conn)):
    return build_week(repo.all_blocks(c, access.group["id"]))


@router.get("/people")
def people(access: Access = Depends(group_access), c: Conn = Depends(get_conn)):
    return repo.list_people(c, access.group["id"])


@router.get("/person")
def person(name: str, access: Access = Depends(group_access), c: Conn = Depends(get_conn)):
    p = repo.get_person(c, access.group["id"], name)
    if not p:
        raise HTTPException(404, "Persona no encontrada")
    blocks = sorted(p["blocks"], key=lambda b: (b["day"], b["start"]))
    days = []
    for d in range(7):
        bs = [b for b in blocks if b["day"] == d]
        if bs:
            days.append({"day": d, "ranges": merge_ranges(bs), "blocks": bs})
    return {
        "name": p["name"],
        "days": days,
        "works": any(b["kind"] == "trabajo" for b in blocks),
    }


@router.post("/work")
def add_work(body: WorkIn, access: Access = Depends(group_admin), c: Conn = Depends(get_conn)):
    """Añade una franja de trabajo. Si la persona no está todavía, la crea sin PDF."""
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Falta el nombre de la persona.")
    if not 0 <= body.day <= 6:
        raise HTTPException(400, "Día no válido.")
    start, end = _minutes(body.start), _minutes(body.end)
    if start >= end:
        raise HTTPException(400, "La hora de salida tiene que ser posterior a la de entrada.")

    pid = repo.person_id(c, access.group["id"], name)
    creada = pid is None
    if creada:
        pid = repo.create_person(c, access.group["id"], name)
    block_id = repo.add_work_block(c, pid, body.day, start, end, body.place.strip())
    c.commit()
    return {"id": block_id, "name": name, "created": creada}


@router.delete("/work/{block_id}")
def delete_work(block_id: int, name: str,
                access: Access = Depends(group_admin), c: Conn = Depends(get_conn)):
    pid = repo.person_id(c, access.group["id"], name)
    if pid is None or not repo.delete_block(c, pid, block_id):
        raise HTTPException(404, "Esa franja de trabajo no existe.")
    c.commit()
    return {"deleted": block_id}


@router.delete("/people")
def delete_all_people(access: Access = Depends(group_admin), c: Conn = Depends(get_conn)):
    """Borra todos los horarios de la agrupación. La agrupación se queda."""
    n = repo.delete_all_people(c, access.group["id"])
    c.commit()
    return {"deleted": n}


@router.delete("/person")
def delete_person(name: str, access: Access = Depends(group_admin), c: Conn = Depends(get_conn)):
    if not repo.delete_person(c, access.group["id"], name):
        raise HTTPException(404, "Persona no encontrada")
    c.commit()
    return {"deleted": name}
