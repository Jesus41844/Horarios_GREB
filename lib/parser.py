"""Lee un PDF de horario (tabla HORAS x días) y devuelve bloques de clase."""
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import pdfplumber

DAYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]

TIME_RE = re.compile(r"(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})([AP])\.?M", re.I)
TAG_RE = re.compile(r"\(([A-Za-z])\)")


class ParseError(Exception):
    """Fallo al leer un PDF; el mensaje es el motivo mostrado al usuario."""


@dataclass
class Block:
    day: int  # 0 = lunes
    start: int  # minutos desde medianoche
    end: int
    subject: str
    room: str
    tags: str


def norm(text: str) -> str:
    text = unicodedata.normalize("NFD", text or "")
    return "".join(c for c in text if not unicodedata.combining(c)).lower().strip()


def person_from_filename(filename: str) -> str:
    stem = Path(filename).stem
    name = re.sub(r"[_\-]+", " ", stem)
    return re.sub(r"\s+", " ", name).strip()


def _parse_time(cell: str):
    """'10:20-11:05A.M' (con basura de saltos de línea) -> (inicio, fin) en minutos."""
    m = TIME_RE.search(re.sub(r"\s+", "", cell or ""))
    if not m:
        return None
    h1, m1, h2, m2, mer = int(m[1]), int(m[2]), int(m[3]), int(m[4]), m[5].upper()
    if h1 > 12 or h2 > 12 or m1 > 59 or m2 > 59:
        return None
    end_h = h2 % 12 + (12 if mer == "P" else 0)
    end = end_h * 60 + m2
    start = (h1 % 12 + (12 if mer == "P" else 0)) * 60 + m1
    if start >= end:  # p. ej. 11:10-12:55 P.M.: el inicio es de la mañana
        start -= 12 * 60
    if start < 0 or start >= end:
        return None
    return start, end


def _parse_cell(cell: str):
    lines = [re.sub(r"\s+", " ", l).strip() for l in (cell or "").split("\n")]
    lines = [l for l in lines if l]
    if not lines:
        return None
    room_lines = [l for l in lines if norm(l).startswith("aula")]
    subj_lines = [l for l in lines if l not in room_lines]
    subject = " ".join(subj_lines)
    tags = "".join(t.upper() for t in TAG_RE.findall(subject))
    subject = re.sub(r"\s+", " ", TAG_RE.sub("", subject)).strip()
    room = " ".join(room_lines).strip()
    return subject or "(sin nombre)", room, tags


def parse_pdf(path: Path) -> list[Block]:
    try:
        pdf = pdfplumber.open(path)
    except Exception:  # corrupto, cifrado, o no es un PDF de verdad
        raise ParseError("No se pudo abrir el PDF. Puede estar dañado o protegido con contraseña.")

    blocks: list[Block] = []
    has_text = False
    found_table = False
    with pdf:
        for page in pdf.pages:
            if (page.extract_text() or "").strip():
                has_text = True
            for table in page.extract_tables():
                header_i = next(
                    (i for i, row in enumerate(table)
                     if sum(norm(c or "") in DAYS for c in row) >= 3),
                    None,
                )
                if header_i is None:
                    continue
                found_table = True
                cols = {
                    j: DAYS.index(norm(c))
                    for j, c in enumerate(table[header_i])
                    if norm(c or "") in DAYS
                }
                for row in table[header_i + 1:]:
                    span = _parse_time(row[0] if row else "")
                    if not span:
                        continue
                    for j, day in cols.items():
                        if j >= len(row):
                            continue
                        cell = _parse_cell(row[j])
                        if cell:
                            blocks.append(Block(day, span[0], span[1], *cell))

    if not has_text:
        raise ParseError("El PDF no tiene texto seleccionable (parece un escaneo).")
    if not found_table:
        raise ParseError("No se encontró la tabla de horarios (fila con LUNES, MARTES...).")
    if not blocks:
        raise ParseError("Se encontró la tabla pero no hay clases (¿horario vacío?).")
    return blocks
