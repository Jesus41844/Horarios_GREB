import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

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

    assert c.get("/api/setup").json() == {"needed": True}
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
