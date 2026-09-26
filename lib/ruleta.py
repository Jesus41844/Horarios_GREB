"""La ruleta: a quién le toca en cada actividad.

Dos reglas y ninguna más. Quien tiene strikes sale con más probabilidad, porque
es la forma de que quien faltó sin avisar aparezca antes la siguiente vez. Y
quien ya participó en la actividad anterior descansa una: si no, la misma
persona acaba cubriendo todas.
"""
import random

PESO_BASE = 1.0
PESO_POR_STRIKE = 1.5   # con una strike se duplica la probabilidad de salir


def peso(strikes: int) -> float:
    return PESO_BASE + PESO_POR_STRIKE * max(0, strikes)


def disponibles(rows, roster, dia: int, inicio: int, fin: int) -> list[str]:
    """Quién no tiene ni clase ni trabajo en ese tramo.

    En una actividad con hora fija solo puede salir quien esté libre: es la razón
    de tener los horarios en la misma aplicación. Las ventas, que ocupan todo el
    día, no miran esto.
    """
    por_persona: dict[str, list[tuple[int, int]]] = {}
    for r in rows:
        if r["day"] == dia:
            por_persona.setdefault(r["name"], []).append((r["start"], r["end"]))
    libres = []
    for nombre in roster:
        franjas = por_persona.get(nombre, [])
        if not any(s < fin and inicio < e for s, e in franjas):
            libres.append(nombre)
    return libres


def sortear(candidatos, cuantas: int, rng=random) -> list[dict]:
    """Saca `cuantas` personas distintas, con más probabilidad quien más strikes tiene.

    `candidatos` son dicts con key, name y strikes. El sorteo va sin reemplazo: el
    que sale en la ronda 1 no puede volver a salir en la 2, que es lo que hace
    falta cuando una venta necesita a dos personas.
    """
    bolsa = [{"key": c["key"], "name": c["name"], "peso": peso(c["strikes"])}
             for c in candidatos if c.get("strikes") is not None]
    elegidos: list[dict] = []
    for _ in range(min(cuantas, len(bolsa))):
        total = sum(x["peso"] for x in bolsa)
        alvo = rng.random() * total
        recorrido = 0.0
        for i, x in enumerate(bolsa):
            recorrido += x["peso"]
            if alvo <= recorrido:
                elegidos.append(x)
                bolsa.pop(i)
                break
    return elegidos
