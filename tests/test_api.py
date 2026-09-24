import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lib import repo  # noqa: E402

PDF = ROOT / "HorarioClase.pdf"
PW = "clave-larga-1"


@pytest.fixture()
def client(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.setenv("HORARIOS_SQLITE", str(Path(tmp) / "test.db"))
        from api.index import app
        from lib import repo
        from lib.db import connect

        with connect() as c:
            root = repo.create_user(c, "root@x.com", "Root", PW, True)
            greb_admin = repo.create_user(c, "greb@x.com", "Greb Admin", PW)
            eurus_admin = repo.create_user(c, "eurus@x.com", "Eurus Admin", PW)
            viewer = repo.create_user(c, "ve@x.com", "Viewer", PW)
            greb = repo.create_group(c, "greb", "GREB")
            eurus = repo.create_group(c, "eurus", "Eurus")
            repo.set_member(c, greb, greb_admin, "admin")
            repo.set_member(c, eurus, eurus_admin, "admin")
            repo.set_member(c, greb, viewer, "member")
            repo.set_owner(c, greb, greb_admin)     # como al aprobar el primer admin
            repo.set_owner(c, eurus, eurus_admin)
            c.commit()
        assert root
        yield TestClient(app)


def login(client, email):
    r = client.post("/api/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    return r


def upload(client, slug, person_name, path=PDF):
    with open(path, "rb") as fh:
        return client.post(
            f"/api/g/{slug}/upload", files={"files": (f"{person_name}.pdf", fh.read(), "application/pdf")}
        )


def test_login_requerido(client):
    assert client.get("/api/g/greb/schedule").status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_login_malo_y_bloqueo(client):
    for _ in range(5):
        assert client.post("/api/auth/login", json={"email": "greb@x.com", "password": "malo"}).status_code == 401
    # Al sexto intento bloquea, incluso con la contraseña correcta.
    r = client.post("/api/auth/login", json={"email": "greb@x.com", "password": PW})
    assert r.status_code == 429


def test_grupos_visibles_segun_membresia(client):
    assert [g["slug"] for g in login(client, "greb@x.com").json()["groups"]] == ["greb"]
    client.post("/api/auth/logout")
    grupos = login(client, "root@x.com").json()["groups"]
    assert {g["slug"] for g in grupos} == {"greb", "eurus"}  # superadmin las ve todas


def test_datos_separados_por_agrupacion(client):
    login(client, "greb@x.com")
    assert upload(client, "greb", "Juan Pérez").json()["ok"] == 1
    assert [p["name"] for p in client.get("/api/g/greb/people").json()] == ["Juan Pérez"]
    # La agrupación ajena no existe para este usuario.
    assert client.get("/api/g/eurus/people").status_code == 404
    client.post("/api/auth/logout")

    login(client, "eurus@x.com")
    assert client.get("/api/g/eurus/people").json() == []  # Eurus no ve a la gente de GREB
    assert upload(client, "eurus", "Juan Pérez").json()["ok"] == 1  # mismo nombre, sin chocar
    assert len(client.get("/api/g/eurus/people").json()) == 1


def test_miembro_no_puede_subir_ni_borrar(client):
    login(client, "greb@x.com")
    upload(client, "greb", "Juan Pérez")
    client.post("/api/auth/logout")

    login(client, "ve@x.com")
    assert client.get("/api/g/greb/schedule").status_code == 200  # ver sí puede
    assert upload(client, "greb", "Otro").status_code == 403
    assert client.delete("/api/g/greb/person", params={"name": "Juan Pérez"}).status_code == 403
    assert client.get("/api/g/greb/members").status_code == 403


def test_solo_superadmin_crea_agrupaciones(client):
    login(client, "greb@x.com")
    assert client.post("/api/groups", json={"name": "Nueva"}).status_code == 403
    client.post("/api/auth/logout")
    login(client, "root@x.com")
    assert client.post("/api/groups", json={"name": "Nueva"}).json()["slug"] == "nueva"
    assert client.post("/api/groups", json={"name": "Nueva"}).status_code == 409


def test_admin_agrega_miembro_creando_cuenta(client):
    login(client, "greb@x.com")
    r = client.put("/api/g/greb/members", json={
        "email": "Nuevo@X.com", "name": "Nuevo", "password": PW, "role": "member"})
    assert r.json()["created"] is True
    assert r.json()["email"] == "nuevo@x.com"  # correo normalizado
    client.post("/api/auth/logout")
    assert [g["slug"] for g in login(client, "nuevo@x.com").json()["groups"]] == ["greb"]


def test_upload_informa_fallos_con_nombre(client, tmp_path):
    roto = tmp_path / "Ana Rota.pdf"
    roto.write_text("no soy un pdf")
    login(client, "greb@x.com")
    r = upload(client, "greb", "Ana Rota", roto).json()
    assert r["failed"] == 1 and r["results"][0]["file"] == "Ana Rota.pdf"
    assert "dañado o protegido" in r["results"][0]["error"]

    with open(PDF, "rb") as fh:
        data = fh.read()
    r = client.post("/api/g/greb/upload", files={"files": ("notas.txt", data, "text/plain")}).json()
    assert r["results"][0]["error"] == "No es un archivo .pdf."


def test_horario_agrupa_y_une_bloques(client):
    login(client, "greb@x.com")
    upload(client, "greb", "Juan Pérez")
    upload(client, "greb", "Ana Gómez")
    week = client.get("/api/g/greb/schedule").json()
    lunes = week[0]["segments"]
    assert len(lunes) == 1  # los bloques seguidos (pausas de 5 min) se unen en uno
    assert lunes[0]["people"] == ["Ana Gómez", "Juan Pérez"]
    assert (lunes[0]["start"], lunes[0]["end"]) == (7 * 60, 11 * 60 + 55)

    p = client.get("/api/g/greb/person", params={"name": "juan perez"}).json()  # sin tildes
    assert p["name"] == "Juan Pérez"
    assert p["days"][0]["ranges"] == [[420, 715]]
    assert p["days"][0]["blocks"][0]["subject"] == "HER. PROG. AP."


def test_cambio_de_password_cierra_otras_sesiones(client):
    # Dos sesiones distintas del mismo usuario, por ejemplo dos dispositivos.
    otra = TestClient(client.app)
    login(otra, "greb@x.com")
    login(client, "greb@x.com")

    assert client.post("/api/auth/password", json={"current": PW, "new": "clave-nueva-1"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 200  # la sesión que cambió sigue viva
    assert otra.get("/api/auth/me").status_code == 401  # la otra se cerró
    assert client.post("/api/auth/login", json={"email": "greb@x.com", "password": PW}).status_code == 401


def test_borrar_agrupacion_borra_sus_datos(client):
    login(client, "greb@x.com")
    upload(client, "greb", "Juan Pérez")
    client.post("/api/auth/logout")
    login(client, "root@x.com")
    assert client.delete("/api/groups/greb").status_code == 200
    assert client.get("/api/g/greb/people").status_code == 404
    from lib.db import connect
    with connect() as c:
        assert c.query("SELECT COUNT(*) AS n FROM horarios.blocks")[0]["n"] == 0


def test_setup_crea_primera_cuenta_y_se_cierra(monkeypatch, tmp_path):
    """El alta inicial funciona solo mientras no existe ninguna cuenta."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("HORARIOS_SQLITE", str(tmp_path / "setup.db"))
    from api.index import app
    c = TestClient(app)

    assert c.get("/api/setup").json() == {"needed": True, "migrated": True}
    datos = {"email": "Jefe@X.com", "name": "Jefe", "password": PW}

    assert c.post("/api/setup", json={**datos, "password": "corta"}).status_code == 400
    assert c.post("/api/setup", json={**datos, "email": "sin-arroba"}).status_code == 400

    r = c.post("/api/setup", json=datos)
    assert r.status_code == 200
    assert r.json()["user"] == {"id": 1, "email": "jefe@x.com", "name": "Jefe", "is_superadmin": True}
    assert c.get("/api/auth/me").status_code == 200  # queda la sesión iniciada

    # Ya hay cuenta: el alta se cierra para siempre.
    assert c.get("/api/setup").json()["needed"] is False
    assert c.post("/api/setup", json={"email": "otro@x.com", "name": "Otro", "password": PW}).status_code == 409


def test_setup_cerrado_cuando_ya_hay_cuentas(client):
    """Con la base ya poblada, nadie puede colarse como superadmin."""
    assert client.get("/api/setup").json()["needed"] is False
    assert client.post("/api/setup", json={
        "email": "intruso@x.com", "name": "Intruso", "password": PW}).status_code == 409


def test_registro_queda_pendiente_y_sin_acceso(client):
    """Registrarse crea la cuenta pero no da acceso a nada hasta la aprobación."""
    nuevo = TestClient(client.app)
    assert {g["slug"] for g in nuevo.get("/api/auth/groups").json()} == {"greb", "eurus"}

    r = nuevo.post("/api/auth/register", json={
        "name": "Sofía Ng", "email": "Sofia@X.com", "password": PW, "group": "greb"})
    assert r.status_code == 200
    assert r.json()["groups"] == []                       # todavía no ve nada
    assert [g["slug"] for g in r.json()["waiting"]] == ["greb"]

    assert nuevo.get("/api/g/greb/schedule").status_code == 404   # ni existe para él
    assert nuevo.get("/api/requests").status_code == 403          # no es superadmin
    assert nuevo.post("/api/auth/register", json={
        "name": "Otra", "email": "sofia@x.com", "password": PW, "group": "greb"}).status_code == 409
    assert nuevo.post("/api/auth/register", json={
        "name": "X", "email": "x@x.com", "password": PW, "group": "inexistente"}).status_code == 404


def test_superadmin_aprueba_y_queda_de_admin(client):
    nuevo = TestClient(client.app)
    nuevo.post("/api/auth/register", json={
        "name": "Sofía Ng", "email": "sofia@x.com", "password": PW, "group": "eurus"})

    login(client, "root@x.com")
    assert client.get("/api/auth/me").json()["pending"] == 1      # aviso en el panel
    pend = client.get("/api/requests").json()
    assert len(pend) == 1
    assert (pend[0]["email"], pend[0]["group_name"]) == ("sofia@x.com", "Eurus")

    assert client.post(f"/api/requests/{pend[0]['id']}/approve").status_code == 200
    assert client.get("/api/requests").json() == []
    assert client.get("/api/auth/me").json()["pending"] == 0

    me = nuevo.get("/api/auth/me").json()                          # ya tiene acceso
    assert [(g["slug"], g["role"]) for g in me["groups"]] == [("eurus", "admin")]
    assert nuevo.get("/api/g/eurus/schedule").status_code == 200
    assert nuevo.get("/api/g/greb/schedule").status_code == 404    # la otra sigue vedada


def test_superadmin_rechaza_solicitud(client):
    nuevo = TestClient(client.app)
    nuevo.post("/api/auth/register", json={
        "name": "Intruso", "email": "int@x.com", "password": PW, "group": "greb"})
    login(client, "root@x.com")
    rid = client.get("/api/requests").json()[0]["id"]

    assert client.delete(f"/api/requests/{rid}").status_code == 200
    assert client.delete(f"/api/requests/{rid}").status_code == 404   # ya no existe
    me = nuevo.get("/api/auth/me").json()
    assert me["groups"] == [] and me["waiting"] == []                 # sin acceso ni espera


def test_admin_de_grupo_no_ve_ni_aprueba_solicitudes(client):
    TestClient(client.app).post("/api/auth/register", json={
        "name": "Sofía", "email": "sofia@x.com", "password": PW, "group": "greb"})
    login(client, "greb@x.com")            # admin de GREB, no superadmin
    assert client.get("/api/requests").status_code == 403
    assert client.post("/api/requests/1/approve").status_code == 403
    assert "pending" not in client.get("/api/auth/me").json()


def test_borrar_horarios_uno_a_uno_y_de_golpe(client):
    login(client, "greb@x.com")
    for nombre in ("Juan Pérez", "Ana Gómez", "Luis Ramos"):
        upload(client, "greb", nombre)
    assert len(client.get("/api/g/greb/people").json()) == 3

    # Uno a uno, sin tildes ni mayúsculas.
    assert client.delete("/api/g/greb/person", params={"name": "juan perez"}).status_code == 200
    assert client.delete("/api/g/greb/person", params={"name": "juan perez"}).status_code == 404
    assert len(client.get("/api/g/greb/people").json()) == 2

    # De golpe.
    assert client.delete("/api/g/greb/people").json() == {"deleted": 2}
    assert client.get("/api/g/greb/people").json() == []
    assert all(not d["segments"] for d in client.get("/api/g/greb/schedule").json())

    from lib.db import connect
    with connect() as c:  # los bloques caen con la persona
        assert c.query("SELECT COUNT(*) AS n FROM horarios.blocks")[0]["n"] == 0


def test_borrado_masivo_solo_afecta_a_su_agrupacion(client):
    login(client, "greb@x.com")
    upload(client, "greb", "Juan Pérez")
    client.post("/api/auth/logout")
    login(client, "eurus@x.com")
    upload(client, "eurus", "Pedro Ruiz")

    assert client.delete("/api/g/eurus/people").json() == {"deleted": 1}
    assert client.delete("/api/g/greb/people").status_code == 404   # ajena: ni existe

    client.post("/api/auth/logout")
    login(client, "greb@x.com")
    assert [p["name"] for p in client.get("/api/g/greb/people").json()] == ["Juan Pérez"]


def test_miembro_no_puede_vaciar_la_agrupacion(client):
    login(client, "greb@x.com")
    upload(client, "greb", "Juan Pérez")
    client.post("/api/auth/logout")

    login(client, "ve@x.com")            # miembro, no admin
    assert client.delete("/api/g/greb/people").status_code == 403
    assert len(client.get("/api/g/greb/people").json()) == 1

def _bloque(**kw):
    base = {"day": 0, "start": "14:00", "end": "18:00", "kind": "trabajo"}
    return {**base, **kw}


def test_horario_laboral(client):
    login(client, "greb@x.com")
    upload(client, "greb", "Juan Pérez")   # tiene clases lunes 7:00–11:55

    r = client.post("/api/g/greb/blocks", json={
        "name": "Juan Pérez", "blocks": [_bloque(room="FabLab")]})
    assert r.status_code == 200 and r.json()["created"] is False

    p = client.get("/api/g/greb/person", params={"name": "Juan Pérez"}).json()
    assert p["works"] is True
    lunes = next(d for d in p["days"] if d["day"] == 0)
    trabajo = [b for b in lunes["blocks"] if b["kind"] == "trabajo"]
    assert len(trabajo) == 1
    assert (trabajo[0]["start"], trabajo[0]["end"], trabajo[0]["room"]) == (840, 1080, "FabLab")
    assert lunes["ranges"] == [[420, 715], [840, 1080]]   # clase y trabajo, separados

    lunes_sem = client.get("/api/g/greb/schedule").json()[0]["segments"]
    tarde = [s for s in lunes_sem if s["start"] == 840][0]
    assert tarde["people"] == ["Juan Pérez"] and tarde["working"] == ["Juan Pérez"]
    manana = [s for s in lunes_sem if s["start"] == 420][0]
    assert manana["people"] == ["Juan Pérez"] and manana["working"] == []


def test_trabajo_crea_persona_sin_pdf(client):
    login(client, "greb@x.com")
    r = client.post("/api/g/greb/blocks", json={
        "name": "Rosa Batista",
        "blocks": [{"day": 2, "start": "8:00", "end": "12:00", "kind": "trabajo"}]})
    assert r.json()["created"] is True

    gente = client.get("/api/g/greb/people").json()
    assert [(p["name"], p["filename"], p["work_blocks"]) for p in gente] == [("Rosa Batista", "", 1)]
    p = client.get("/api/g/greb/person", params={"name": "rosa batista"}).json()
    assert p["works"] is True and len(p["days"]) == 1


def test_alta_manual_de_clases(client):
    """Cuando solo hay una imagen, el horario se teclea y queda igual que un PDF."""
    login(client, "greb@x.com")
    r = client.post("/api/g/greb/blocks", json={
        "name": "Sofía Ng",
        "blocks": [
            {"day": 0, "start": "7:00", "end": "7:45",
             "subject": "HER. PROG. AP.", "room": "aula 3-405", "kind": "clase"},
            {"day": 0, "start": "7:50", "end": "8:35",
             "subject": "HER. PROG. AP.", "room": "aula 3-405", "kind": "clase"},
        ]})
    assert r.json()["created"] is True and len(r.json()["ids"]) == 2

    p = client.get("/api/g/greb/person", params={"name": "sofia ng"}).json()
    assert p["works"] is False                     # son clases, no trabajo
    assert p["days"][0]["ranges"] == [[420, 515]]   # los dos bloques seguidos se unen
    assert p["days"][0]["blocks"][0]["subject"] == "HER. PROG. AP."

    lunes = client.get("/api/g/greb/schedule").json()[0]["segments"]
    assert lunes[0]["people"] == ["Sofía Ng"] and lunes[0]["working"] == []


def test_replace_kind_sustituye_solo_ese_tipo(client):
    """Guardar un OCR revisado reemplaza las clases y respeta el trabajo."""
    login(client, "greb@x.com")
    upload(client, "greb", "Juan Pérez")
    client.post("/api/g/greb/blocks", json={"name": "Juan Pérez", "blocks": [_bloque()]})

    client.post("/api/g/greb/blocks", json={
        "name": "Juan Pérez", "replace_kind": "clase",
        "blocks": [{"day": 4, "start": "9:00", "end": "10:00",
                    "subject": "NUEVA", "kind": "clase"}]})

    p = client.get("/api/g/greb/person", params={"name": "Juan Pérez"}).json()
    clases = [b for d in p["days"] for b in d["blocks"] if b["kind"] == "clase"]
    trabajo = [b for d in p["days"] for b in d["blocks"] if b["kind"] == "trabajo"]
    assert [b["subject"] for b in clases] == ["NUEVA"]   # las 18 del PDF se fueron
    assert len(trabajo) == 1                              # el trabajo sigue intacto


def test_bloques_validan_y_se_borran(client):
    login(client, "greb@x.com")
    malos = [
        {"name": "X", "blocks": [_bloque(start="18:00", end="14:00")]},
        {"name": "X", "blocks": [_bloque(start="25:00", end="26:00")]},
        {"name": "X", "blocks": [_bloque(start="ocho")]},
        {"name": "", "blocks": [_bloque()]},
        {"name": "X", "blocks": [_bloque(day=9)]},
        {"name": "X", "blocks": [_bloque(kind="siesta")]},
        {"name": "X", "blocks": []},
        {"name": "X", "blocks": [_bloque()], "replace_kind": "todo"},
    ]
    for cuerpo in malos:
        assert client.post("/api/g/greb/blocks", json=cuerpo).status_code == 400, cuerpo

    bid = client.post("/api/g/greb/blocks", json={
        "name": "Ana Gómez", "blocks": [_bloque()]}).json()["ids"][0]
    assert client.delete(f"/api/g/greb/block/{bid}", params={"name": "Ana Gómez"}).status_code == 200
    assert client.delete(f"/api/g/greb/block/{bid}", params={"name": "Ana Gómez"}).status_code == 404


def test_miembro_no_puede_tocar_los_bloques(client):
    login(client, "greb@x.com")
    bid = client.post("/api/g/greb/blocks", json={
        "name": "Ana Gómez", "blocks": [_bloque()]}).json()["ids"][0]
    client.post("/api/auth/logout")

    login(client, "ve@x.com")   # miembro
    assert client.post("/api/g/greb/blocks", json={
        "name": "Otro", "blocks": [_bloque()]}).status_code == 403
    assert client.delete(f"/api/g/greb/block/{bid}", params={"name": "Ana Gómez"}).status_code == 403


def test_solo_el_dueno_gestiona_a_la_gente(client):
    """El correo inicial manda: los demás admins tocan horarios, no personas."""
    login(client, "greb@x.com")          # dueño de GREB
    r = client.put("/api/g/greb/members", json={
        "email": "seg@x.com", "name": "Segundo", "password": PW, "role": "admin"})
    assert r.json()["created"] is True
    client.post("/api/auth/logout")

    # Ese segundo admin puede con los horarios...
    login(client, "seg@x.com")
    assert upload(client, "greb", "Juan Pérez").json()["ok"] == 1
    # ...pero no con la gente.
    assert client.get("/api/g/greb/members").status_code == 403
    assert client.put("/api/g/greb/members", json={
        "email": "otro@x.com", "name": "Otro", "password": PW}).status_code == 403
    assert client.delete("/api/g/greb/members/1").status_code == 403


def test_quien_se_anade_entra_como_miembro(client):
    login(client, "greb@x.com")
    client.put("/api/g/greb/members", json={
        "email": "nuevo@x.com", "name": "Nuevo", "password": PW})   # sin rol
    fila = [m for m in client.get("/api/g/greb/members").json() if m["email"] == "nuevo@x.com"][0]
    assert fila["role"] == "member" and fila["is_owner"] is False
    client.post("/api/auth/logout")

    login(client, "nuevo@x.com")
    assert client.get("/api/g/greb/schedule").status_code == 200   # ve
    assert upload(client, "greb", "X").status_code == 403          # no sube


def test_el_dueno_asciende_y_degrada(client):
    login(client, "greb@x.com")
    client.put("/api/g/greb/members", json={
        "email": "nuevo@x.com", "name": "Nuevo", "password": PW})
    client.put("/api/g/greb/members", json={"email": "nuevo@x.com", "role": "admin"})
    fila = [m for m in client.get("/api/g/greb/members").json() if m["email"] == "nuevo@x.com"][0]
    assert fila["role"] == "admin"
    client.post("/api/auth/logout")

    login(client, "nuevo@x.com")
    assert upload(client, "greb", "Juan Pérez").json()["ok"] == 1   # ya sube


def test_el_dueno_no_se_puede_quitar_ni_degradar(client):
    login(client, "greb@x.com")
    yo = [m for m in client.get("/api/g/greb/members").json() if m["is_owner"]][0]
    assert yo["email"] == "greb@x.com"
    assert client.delete(f"/api/g/greb/members/{yo['id']}").status_code == 409
    assert client.put("/api/g/greb/members", json={
        "email": "greb@x.com", "role": "member"}).status_code == 409


def test_aprobar_una_solicitud_nombra_dueno_solo_la_primera_vez(client):
    from lib.db import connect
    with connect() as c:                      # agrupación nueva, todavía sin dueño
        gid = repo.create_group(c, "nueva", "Nueva")
        c.commit()
    assert gid

    primero = TestClient(client.app)
    primero.post("/api/auth/register", json={
        "name": "Primero", "email": "uno@x.com", "password": PW, "group": "nueva"})
    segundo = TestClient(client.app)
    segundo.post("/api/auth/register", json={
        "name": "Segundo", "email": "dos@x.com", "password": PW, "group": "nueva"})

    login(client, "root@x.com")
    pendientes = {r["email"]: r["id"] for r in client.get("/api/requests").json()}
    client.post(f"/api/requests/{pendientes['uno@x.com']}/approve")   # este se queda la agrupación
    client.post(f"/api/requests/{pendientes['dos@x.com']}/approve")

    assert [g["is_owner"] for g in primero.get("/api/auth/me").json()["groups"]] == [True]
    assert [g["is_owner"] for g in segundo.get("/api/auth/me").json()["groups"]] == [False]
    # El segundo es admin, pero la gente la gestiona el primero.
    assert segundo.get("/api/g/nueva/members").status_code == 403
    assert primero.get("/api/g/nueva/members").status_code == 200
