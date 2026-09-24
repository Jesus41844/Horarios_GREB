import hmac
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi import APIRouter, Depends, FastAPI, File, Header, HTTPException, UploadFile  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from lib.parser import ParseError, norm, parse_pdf, person_from_filename  # noqa: E402
from lib.schedule import build_week, merge_ranges  # noqa: E402
from lib.store import get_store  # noqa: E402


def require_password(x_app_password: str = Header(default="")):
    """Si APP_PASSWORD está definida, toda la API exige esa clave."""
    expected = os.environ.get("APP_PASSWORD")
    if expected and not hmac.compare_digest(x_app_password.encode(), expected.encode()):
        raise HTTPException(401, "Clave incorrecta")


api = APIRouter(prefix="/api", dependencies=[Depends(require_password)])


@api.get("/check")
def check():
    return {"ok": True}


@api.post("/upload")
async def upload(files: list[UploadFile] = File(...)):
    """Procesa cada PDF por separado; un fallo no bloquea a los demás."""
    store = get_store()
    results, seen = [], set()
    for f in files:
        filename = f.filename or "(sin nombre)"
        data = await f.read()
        name = person_from_filename(filename)
        res = {"file": filename, "name": name}
        try:
            if not filename.lower().endswith(".pdf"):
                raise ParseError("No es un archivo .pdf.")
            if not name:
                raise ParseError("El nombre del archivo no da un nombre de persona.")
            if norm(name) in seen:
                raise ParseError(f"Repetido en esta subida: ya hay otro PDF de «{name}».")
            seen.add(norm(name))
            with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
                tmp.write(data)
                tmp.flush()
                blocks = parse_pdf(Path(tmp.name))
            updated = store.save_person(name, filename, blocks)
            res.update(ok=True, blocks=len(blocks), updated=updated)
        except ParseError as e:
            res.update(ok=False, error=str(e))
        except Exception as e:  # cualquier otro fallo también se informa con nombre
            res.update(ok=False, error=f"Error inesperado: {type(e).__name__}: {e}")
        results.append(res)
    return {
        "results": results,
        "ok": sum(r["ok"] for r in results),
        "failed": sum(not r["ok"] for r in results),
    }


@api.get("/schedule")
def schedule():
    return build_week(get_store().all_blocks())


@api.get("/people")
def people():
    return get_store().list_people()


@api.get("/person")
def person(name: str):
    p = get_store().get_person(name)
    if not p:
        raise HTTPException(404, "Persona no encontrada")
    blocks = sorted(p["blocks"], key=lambda b: (b["day"], b["start"]))
    days = []
    for d in range(7):
        bs = [b for b in blocks if b["day"] == d]
        if bs:
            days.append({"day": d, "ranges": merge_ranges(bs), "blocks": bs})
    return {"name": p["name"], "days": days}


@api.delete("/person")
def delete_person(name: str):
    if not get_store().delete_person(name):
        raise HTTPException(404, "Persona no encontrada")
    return {"deleted": name}


app = FastAPI(title="Horarios GREB")
app.include_router(api)

# En Vercel, public/ lo sirve el CDN; en local lo sirve esta app.
if not os.environ.get("VERCEL"):
    app.mount("/", StaticFiles(directory=ROOT / "public", html=True), name="public")
