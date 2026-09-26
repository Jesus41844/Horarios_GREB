"""Une bloques seguidos por persona y calcula quién está ocupado en cada tramo."""

# Pausa máxima entre dos bloques para considerarlos seguidos (los PDF traen 5 min).
MAX_GAP = 10


def merge_ranges(blocks) -> list[tuple[int, int]]:
    """[(inicio, fin)] con los bloques seguidos unidos."""
    spans = sorted((b["start"], b["end"]) for b in blocks)
    merged: list[list[int]] = []
    for s, e in spans:
        if merged and s - merged[-1][1] <= MAX_GAP:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    return [(s, e) for s, e in merged]


def day_segments(ranges_by_person: dict[str, list[tuple[int, int]]],
                 work_by_person: dict[str, list[tuple[int, int]]]) -> list[dict]:
    """Corta el día en cada entrada/salida; une tramos contiguos con los mismos presentes.

    `working` es quién, en ese tramo, está ahí por trabajo y no por clase: se marca
    aparte porque un horario laboral suele ser menos movible que una clase.
    """
    points = sorted({p for rs in ranges_by_person.values() for r in rs for p in r})
    segs: list[dict] = []
    for a, b in zip(points, points[1:]):
        people, working = [], []
        for name, rs in ranges_by_person.items():
            if not any(s <= a and b <= e for s, e in rs):
                continue
            people.append(name)
            if any(s <= a and b <= e for s, e in work_by_person.get(name, [])):
                working.append(name)
        if not people:
            continue
        people.sort()
        working.sort()
        if segs and segs[-1]["end"] == a and segs[-1]["people"] == people \
                and segs[-1]["working"] == working:
            segs[-1]["end"] = b
        else:
            segs.append({"start": a, "end": b, "people": people, "working": working})
    return segs


def build_week(rows) -> list[dict]:
    """rows: filas con name, day, start, end y kind. Devuelve 7 días con sus tramos."""
    per_day: dict[int, dict[str, list]] = {d: {} for d in range(7)}
    work_day: dict[int, dict[str, list]] = {d: {} for d in range(7)}
    for r in rows:
        per_day[r["day"]].setdefault(r["name"], []).append(r)
        if r.get("kind") == "trabajo":
            work_day[r["day"]].setdefault(r["name"], []).append(r)
    week = []
    for d in range(7):
        ranges = {n: merge_ranges(bs) for n, bs in per_day[d].items()}
        work = {n: merge_ranges(bs) for n, bs in work_day[d].items()}
        week.append({"day": d, "segments": day_segments(ranges, work)})
    return week


def _solapa(rango: tuple[int, int], ventana: tuple[int, int]) -> bool:
    return rango[0] < ventana[1] and ventana[0] < rango[1]


def free_windows(rows, roster, days, desde: int, hasta: int, duracion: int,
                 paso: int = 15) -> list[dict]:
    """Los tramos en los que se puede convocar a más gente, con huecos de `duracion`.

    Es lo contrario de la rejilla: allí se ve quién está ocupado, aquí se busca la
    hora. Se recorre la franja pedida de `paso` en `paso` minutos contando quién
    está libre en cada ventana de `duracion`, y de cada día sale su mejor tramo,
    junto y no en cuarenta filas iguales.

    Unir ventanas contiguas en un solo tramo no agranda la promesa: si A, B y C
    están libres en cada una de ellas, están libres en todo el hueco que las
    cubre. Los que quedan en `ocupados` son los que no pueden el tramo entero,
    que es justo lo que hay que saber antes de escribir la convocatoria.

    `roster` son todas las personas de la agrupación, también las que no tienen
    bloques: quien no aparece en ninguna fila está libre siempre, y cuenta.
    """
    nombres = sorted(roster)
    por_dia: dict[int, dict[str, list]] = {d: {} for d in range(7)}
    for r in rows:
        por_dia[r["day"]].setdefault(r["name"], []).append(r)

    huecos: list[dict] = []
    for d in days:
        merged = {n: merge_ranges(bs) for n, bs in por_dia[d].items()}

        def libres_de(a: int, b: int) -> list[str]:
            return [n for n in nombres
                    if not any(_solapa(r, (a, b)) for r in merged.get(n, []))]

        ventanas = [(a, a + duracion, len(libres_de(a, a + duracion)))
                    for a in range(desde, hasta - duracion + 1, paso)]
        if not ventanas:
            continue
        mejor = max(w[2] for w in ventanas)
        if not mejor:
            continue    # en toda la franja no cabe ni un hueco con alguien libre

        # Tramos continuos donde se alcanza el mejor resultado del día.
        tramo: list[int] | None = None
        for a, b, n in ventanas:
            if n < mejor:                  # aquí el tramo bueno se cierra
                if tramo is not None:
                    huecos.append(_tramo(d, tramo, nombres, libres_de))
                    tramo = None
                continue
            if tramo is None:
                tramo = [a, b]
            elif a <= tramo[1]:             # solapa o toca: es el mismo hueco
                tramo[1] = b
            else:                           # hay un corte entre medias: hueco nuevo
                huecos.append(_tramo(d, tramo, nombres, libres_de))
                tramo = [a, b]
        if tramo is not None:
            huecos.append(_tramo(d, tramo, nombres, libres_de))

    # Primero quien más se libra; a igualdad, el tramo más largo.
    huecos.sort(key=lambda h: (-h["libres"], -h["minutes"], h["day"], h["start"]))
    return huecos


def _tramo(day: int, tramo, nombres, libres_de) -> dict:
    a, b = tramo
    libres = libres_de(a, b)
    return {
        "day": day,
        "start": a,
        "end": b,
        "minutes": b - a,
        "libres": len(libres),
        "total": len(nombres),
        "ocupados": [n for n in nombres if n not in libres],
    }

