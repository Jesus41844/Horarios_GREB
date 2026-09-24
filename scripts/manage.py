"""Administración desde la terminal (usa DATABASE_URL, o data.db si no está definida).

  python -m scripts.manage migrate
  python -m scripts.manage create-user correo@ejemplo.com "Nombre" --superadmin
  python -m scripts.manage create-group "Eurus"

La contraseña se pide por teclado (o en la variable HORARIOS_PASSWORD).
"""
import argparse
import getpass
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg  # noqa: E402

from lib import repo, security  # noqa: E402
from lib.db import SCHEMA_FILE, connect, postgres_url  # noqa: E402


def migrate() -> None:
    url = postgres_url()
    if not url:
        print("Sin DATABASE_URL: SQLite crea sus tablas sola. Nada que migrar.")
        return
    with psycopg.connect(url, prepare_threshold=None, connect_timeout=15) as con:
        con.execute(SCHEMA_FILE.read_text(encoding="utf-8"))
    print("Esquema `horarios` aplicado.")


def create_user(email: str, name: str, superadmin: bool) -> None:
    password = os.environ.get("HORARIOS_PASSWORD") or getpass.getpass("Contraseña: ")
    if len(password) < security.MIN_PASSWORD:
        sys.exit(f"La contraseña necesita al menos {security.MIN_PASSWORD} caracteres.")
    with connect() as c:
        email = email.strip().lower()
        if repo.user_by_email(c, email):
            sys.exit(f"Ya existe una cuenta con {email}.")
        repo.create_user(c, email, name, password, superadmin)
        c.commit()
    print(f"Cuenta creada: {email}" + (" (superadmin)" if superadmin else ""))


def create_group(name: str) -> None:
    slug = repo.slugify(name)
    with connect() as c:
        if repo.group_by_slug(c, slug):
            sys.exit(f"Ya existe la agrupación «{slug}».")
        repo.create_group(c, slug, name)
        c.commit()
    print(f"Agrupación creada: {name} ({slug})")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate")
    u = sub.add_parser("create-user")
    u.add_argument("email")
    u.add_argument("name")
    u.add_argument("--superadmin", action="store_true")
    g = sub.add_parser("create-group")
    g.add_argument("name")
    a = p.parse_args()
    if a.cmd == "migrate":
        migrate()
    elif a.cmd == "create-user":
        create_user(a.email, a.name, a.superadmin)
    else:
        create_group(a.name)


if __name__ == "__main__":
    main()
