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
