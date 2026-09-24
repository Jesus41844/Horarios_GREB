import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi import APIRouter, FastAPI  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from lib.routes import auth, data, groups, setup  # noqa: E402

api = APIRouter(prefix="/api")
for module in (auth, setup, groups, data):
    api.include_router(module.router)

app = FastAPI(title="Horarios", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(api)

# En Vercel el CDN sirve public/ y la carpeta no viaja dentro de la función, así
# que solo se monta cuando existe: en local, para servir la interfaz.
if (ROOT / "public").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "public", html=True), name="public")
