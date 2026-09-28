"""Fixture de tests: el PDF de ejemplo que usan las pruebas de API.

El horario real de un estudiante no puede estar en el repo (`.gitignore` excluye
`*.pdf`), pero casi toda la suite necesita uno para probar la subida y el
parseo. Aquí se genera en cada carrera un PDF sintético con la misma forma que
produce la UTP, de modo que las pruebas no dependan de un archivo que nadie
tiene.

La tabla está elegida para que cada prueba encuentre lo que espera:
18 casillas, 2 de ellas virtuales, el lunes corrido de 7:00 a 11:55 y el
jueves solo con la clase virtual.
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

PDF = ROOT / "HorarioClase.pdf"

DIAS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"]

# (horario, {día: (asignatura, aula)}). El lunes va de corrido con pausas de
# cinco minutos, que es justo lo que el agrupador tiene que fusionar.
FILAS = [
    ("7:00-7:55A.M", {0: ("HER. PROG. AP.", "aula 3-405")}),
    ("8:00-8:55A.M", {0: ("MATEMÁTICA II", "aula 1-213"),
                     1: ("FÍSICA I", "aula 2-301")}),
    ("9:00-9:55A.M", {0: ("LAB. FÍSICA (L)", "aula 2-301"),
                     1: ("HISTORIA DE PANAMÁ", "aula 1-118"),
                     2: ("INGLÉS III", "aula 4-205")}),
    ("10:00-10:55A.M", {0: ("DISEÑO (T)", "aula 5-102"),
                       2: ("QUÍMICA I", "aula 3-310"),
                       3: ("CÁLCULO (V)", "aula 3-N03")}),
    ("11:00-11:55A.M", {0: ("DISEÑO (T)", "aula 5-102"),
                       1: ("PROGR. II", "aula 3-419"),
                       2: ("LAB. QUÍMICA (L)", "aula 3-310")}),
    ("1:00-1:55P.M", {1: ("ESTRUCTURAS (T)", "aula 3-419"),
                      2: ("HISTORIA DE PANAMÁ", "aula 1-118"),
                      4: ("PROGRAMACIÓN (P)", "aula 3-419")}),
    ("2:00-2:55P.M", {1: ("LAB. ESTRUCTURAS (L)", "aula 3-419")}),
    ("3:00-3:55P.M", {3: ("CÁLCULO II (V)", "aula 3-N03"),
                      4: ("PROGRAMACIÓN (P)", "aula 3-419")}),
]


def _escribir_pdf(destino: Path) -> None:
    from reportlab.lib.pagesizes import landscape, letter
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle
    from reportlab.lib import colors

    doc = SimpleDocTemplate(
        str(destino), pagesize=landscape(letter),
        leftMargin=0.4 * inch, rightMargin=0.4 * inch,
        topMargin=0.4 * inch, bottomMargin=0.4 * inch,
    )
    celda = ParagraphStyle("celda", fontSize=8, leading=9.5)
    cabecera = ParagraphStyle("cabecera", fontSize=8, leading=9.5,
                              fontName="Helvetica-Bold")

    datos = [[Paragraph("HORAS", cabecera)] +
             [Paragraph(d, cabecera) for d in DIAS]]
    for hora, celdas in FILAS:
        fila = [Paragraph(hora, celda)]
        for i in range(len(DIAS)):
            if i in celdas:
                asignatura, aula = celdas[i]
                fila.append(Paragraph(f"{asignatura}<br/>{aula}", celda))
            else:
                fila.append("")
        datos.append(fila)

    tabla = Table(datos, colWidths=[1.0 * inch] + [1.35 * inch] * len(DIAS))
    tabla.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    doc.build([tabla])


@pytest.fixture(scope="session", autouse=True)
def pdf_de_ejemplo():
    """Genera `HorarioClase.pdf` si no está, para que la suite no dependa de él."""
    if not PDF.exists():
        _escribir_pdf(PDF)
    yield PDF
