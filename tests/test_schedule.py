# Cálculos de la rejilla: qué se une, qué huecos son de verdad y qué gente hay en
# cada tramo. Ejecutar:  .venv/bin/python -m pytest tests -q
from lib.schedule import MAX_GAP, day_segments, merge_ranges


def hhmm(m):
    return f"{m // 60:02d}:{m % 60:02d}"


def b(nombre, ini, fin, kind="clase"):
    return {"name": nombre, "day": 3, "start": ini, "end": fin, "kind": kind}


def tramos(filas):
    return [(hhmm(s["start"]), hhmm(s["end"]), s["people"])
            for s in day_segments(*_partir(filas))]


def _partir(filas):
    clases: dict[str, list] = {}
    trabajo: dict[str, list] = {}
    for f in filas:
        destino = trabajo if f["kind"] == "trabajo" else clases
        destino.setdefault(f["name"], []).append(f)
    return clases, trabajo


def test_cinco_minutos_de_pausa_siguen_siendo_seguidos():
    assert MAX_GAP == 5
    # Los cinco minutos que deja la UTP entre una clase y la siguiente: seguidos.
    assert merge_ranges([b("A", 720, 765), b("A", 770, 815)]) == [(720, 815)]
    # Seis ya no: es tiempo libre de verdad y tiene que verse.
    assert merge_ranges([b("A", 720, 765), b("A", 771, 815)]) == [(720, 765), (771, 815)]
    # Diez, menos todavía.
    assert merge_ranges([b("A", 720, 765), b("A", 775, 815)]) == [(720, 765), (775, 815)]


def test_un_descanso_tragado_no_sale_como_clase():
    """El descanso de Ana y Beto existe aunque al unirlos desaparezca.

    Ana y Beto tienen clase en las dos franjas, así que la unión de sus bloques
    se come el hueco de cinco minutos; Caro sale a las 12:45 y Dan entra a las
    12:50, y sus cortes son los que parten el día. Si se pinta quién está en cada
    tramo con los bloques ya unidos, ese hueco sale como un tramo de cinco
    minutos con dos personas que en realidad estaban libres.
    """
    filas = [b("Ana", 720, 765), b("Ana", 770, 815),
             b("Beto", 720, 765), b("Beto", 770, 815),
             b("Caro", 720, 765), b("Dan", 770, 815)]
    assert tramos(filas) == [("12:00", "12:45", ["Ana", "Beto", "Caro"]),
                             ("12:50", "13:35", ["Ana", "Beto", "Dan"])]


def test_quien_no_esta_no_aparece_aunque_el_hueco_se_haya_tragado():
    """Con un hueco de diez minutos dentro de una unión, solo se lista a quien
    de verdad tiene algo en ese rato."""
    filas = [b("Ana", 720, 765), b("Ana", 775, 815),      # hueco de 10 min
             b("Luis", 720, 765), b("Luis", 775, 815)]
    assert tramos(filas) == [("12:00", "12:45", ["Ana", "Luis"]),
                             ("12:55", "13:35", ["Ana", "Luis"])]


def test_el_horario_laboral_no_marca_clase():
    """Quién está por trabajo se marca aparte: es un dato, no una ocupación más."""
    filas = [b("Ana", 720, 765), b("Ana", 770, 815, kind="trabajo")]
    (seg,) = day_segments(*_partir(filas))
    assert seg["people"] == ["Ana"] and seg["working"] == []   # el trabajo no llena la clase
    filas = [b("Ana", 720, 765), b("Ana", 720, 765, kind="trabajo")]
    (seg,) = day_segments(*_partir(filas))
    assert seg["people"] == ["Ana"] and seg["working"] == ["Ana"]
