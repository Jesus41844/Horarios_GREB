"""Ruleta de actividades: a quién le toca, con strikes por ausencia.

Es una decisión social, no un horario, así que la gestiona quien administra la
agrupación: quien solo ve la consulta pero no gira ni lleva el conteo.

Dos modos de actividad, y la diferencia es si se mira el horario: las ventas
ocupan todo el día, así que cualquiera puede salir; una actividad con hora fija
solo ofrece a quien esté libre en ese tramo.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import repo, ruleta
from ..db import Conn
from ..deps import Access, get_conn, group_access, group_admin
from ..parser import norm
from .data import minutos_de

router = APIRouter(prefix="/g/{slug}", tags=["actividades"])

CUANTAS_MAX = 6


class ActividadIn(BaseModel):
    nombre: str
    modo: Literal["ventas", "horario"] = "horario"
    dia: int = 0                 # solo en modo 'horario'
    inicio: str = "18:00"
    fin: str = "20:00"
    cuantas: int = 1


class GirarIn(BaseModel):
    cuantas: int | None = None         # por defecto, las que pide la actividad
    excluir_activos: bool = True       # quien salió en la anterior descansa esta


class StrikeIn(BaseModel):
    name: str
    delta: int = 1
    detalle: str = ""


class ParticipacionIn(BaseModel):
    name: str
    participa: bool


def _nombres(c: Conn, group_id: int) -> dict[str, str]:
    """clave -> nombre, tal y como están guardados."""
    return {norm(p["name"]): p["name"] for p in repo.list_people(c, group_id)}


def _clave_de(nombres: dict[str, str], nombre: str) -> str:
    """La clave de una persona del padrón. Las strikes y las participaciones se
    guardan por clave, así que hace falta que el nombre sea el de alguien que
    está: si no, la fila quedaría huérfana y nadie la volvería a ver."""
    key = norm(nombre)
    if key not in nombres:
        raise HTTPException(404, f"{nombre} no está en la agrupación.")
    return key


@router.get("/ruleta")
def ver_ruleta(access: Access = Depends(group_access), c: Conn = Depends(get_conn)):
    """El estado de la ruleta: el padrón con strikes y participaciones de cada uno,
    y las actividades con quién salió en cada una.

    Lo ve cualquiera de la agrupación, también quien solo consulta: el conteo es
    información, no gestión. Girar y cambiar strikes es lo que es de admins.
    """
    nombres = _nombres(c, access.group["id"])
    strikes = {s["person_key"]: s for s in repo.strikes_de(c, access.group["id"])}
    cuenta = repo.participaciones_por_persona(c, access.group["id"])
    personas = []
    for key, nombre in nombres.items():
        veces = (strikes.get(key) or {}).get("veces", 0)
        cta = cuenta.get(key, {"total": 0, "ventas": 0, "horario": 0})
        personas.append({
            "key": key,
            "name": nombre,
            "strikes": veces,
            "detalle": (strikes.get(key) or {}).get("detalle", ""),
            "peso": ruleta.peso(veces),
            **cta,
        })
    # Primero quien más strikes tiene, que es quien más urge que salga.
    personas.sort(key=lambda p: (-p["strikes"], -p["total"], p["name"]))
    actividades = repo.actividades_de(c, access.group["id"])
    for a in actividades:
        a["participantes"] = [nombres.get(k, k) for k in a["participantes"]]
    return {"personas": personas, "actividades": actividades, "cuantas_max": CUANTAS_MAX}


@router.post("/actividades")
def crear_actividad(body: ActividadIn, access: Access = Depends(group_admin),
                    c: Conn = Depends(get_conn)):
    nombre = body.nombre.strip()
    if not nombre:
        raise HTTPException(400, "La actividad necesita un nombre.")
    inicio, fin = (0, 0)
    if body.modo == "horario":
        if not 0 <= body.dia <= 6:
            raise HTTPException(400, "Día no válido.")
        inicio, fin = minutos_de(body.inicio), minutos_de(body.fin)
        if inicio >= fin:
            raise HTTPException(400, "La hora de salida tiene que ser posterior a la de entrada.")
    if not 1 <= body.cuantas <= CUANTAS_MAX:
        raise HTTPException(400, f"Hacen falta entre 1 y {CUANTAS_MAX} personas.")
    nuevo_id = repo.crear_actividad(
        c, access.group["id"], nombre, body.modo, body.dia, inicio, fin, body.cuantas
    )
    c.commit()
    return {"id": nuevo_id, "nombre": nombre, "modo": body.modo}


@router.delete("/actividad/{actividad_id}")
def borrar_actividad(actividad_id: int, access: Access = Depends(group_admin),
                     c: Conn = Depends(get_conn)):
    if not repo.borrar_actividad(c, access.group["id"], actividad_id):
        raise HTTPException(404, "Esa actividad no existe.")
    c.commit()
    return {"deleted": actividad_id}


@router.post("/actividad/{actividad_id}/girar")
def girar(actividad_id: int, body: GirarIn, access: Access = Depends(group_admin),
          c: Conn = Depends(get_conn)):
    """Reparte la actividad y lo deja anotado.

    El sorteo lo hace el servidor, que es quien guarda el resultado: el nombre
    que sale es el que cuenta como participación aunque el navegador se cierre a
    medias. Se puede pedir el número de personas aparte del que dice la
    actividad, por si al final hacen falta más manos.
    """
    act = repo.actividad(c, access.group["id"], actividad_id)
    if not act:
        raise HTTPException(404, "Esa actividad no existe.")
    nombres = _nombres(c, access.group["id"])
    if not nombres:
        raise HTTPException(400, "No hay nadie en la agrupación todavía.")

    cuantas = body.cuantas or act["cuantas"]
    if not 1 <= cuantas <= CUANTAS_MAX:
        raise HTTPException(400, f"Se eligen entre 1 y {CUANTAS_MAX} personas.")

    ya_salieron = set(repo.participantes(c, actividad_id))
    # Los activos: quien salió en la actividad anterior del mismo modo descansa
    # esta, salvo que quien gira lo decida otra vez.
    descansan = set(repo.participantes_de_la_anterior(
        c, access.group["id"], act["modo"], actividad_id
    )) if body.excluir_activos else set()

    if act["modo"] == "horario":
        # Con hora fija solo sale quien esté libre; las ventas miran al padrón entero.
        libres = set(ruleta.disponibles(
            repo.all_blocks(c, access.group["id"]), list(nombres.values()),
            act["dia"], act["inicio"], act["fin"],
        ))
    else:
        libres = set(nombres.values())

    strike = {s["person_key"]: s["veces"] for s in repo.strikes_de(c, access.group["id"])}
    candidatos = [
        {"key": key, "name": nombre, "strikes": strike.get(key, 0)}
        for key, nombre in nombres.items()
        if key not in ya_salieron and key not in descansan and nombre in libres
    ]
    if not candidatos:
        raise HTTPException(400, "No queda nadie disponible para esta actividad.")

    elegidos = ruleta.sortear(candidatos, cuantas)
    for e in elegidos:
        repo.registrar_participacion(c, actividad_id, e["key"])
    c.commit()
    return {
        "actividad": act["nombre"],
        "elegidos": [{"key": e["key"], "name": e["name"]} for e in elegidos],
        "pool": [{"name": x["name"], "strikes": x["strikes"], "peso": ruleta.peso(x["strikes"])}
                 for x in candidatos],
        "descansan": [nombres.get(k, k) for k in sorted(descansan)],
        "ocupados": sorted(n for n in nombres.values() if n not in libres),
        "ya_salieron": [nombres[k] for k in sorted(ya_salieron) if k in nombres],
    }


@router.post("/actividad/{actividad_id}/participacion")
def anotar_participacion(actividad_id: int, body: ParticipacionIn,
                         access: Access = Depends(group_admin), c: Conn = Depends(get_conn)):
    """Corrige el reparto a mano: quien no llegó, o al que se le olvidó apuntar."""
    if not repo.actividad(c, access.group["id"], actividad_id):
        raise HTTPException(404, "Esa actividad no existe.")
    key = _clave_de(_nombres(c, access.group["id"]), body.name)
    if body.participa:
        repo.registrar_participacion(c, actividad_id, key)
    else:
        repo.quitar_participacion(c, actividad_id, key)
    c.commit()
    return {"name": body.name, "participa": body.participa}


@router.put("/strike")
def mover_strike(body: StrikeIn, access: Access = Depends(group_admin), c: Conn = Depends(get_conn)):
    """Suma o quita una strike. El total que queda es el que pesa en la ruleta."""
    if not -5 <= body.delta <= 5 or body.delta == 0:
        raise HTTPException(400, "La strike se suma o se quita de uno en uno.")
    key = _clave_de(_nombres(c, access.group["id"]), body.name)
    total = repo.mover_strike(c, access.group["id"], key, body.delta, body.detalle.strip())
    c.commit()
    return {"name": body.name, "strikes": total, "peso": ruleta.peso(total)}
