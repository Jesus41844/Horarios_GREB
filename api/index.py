import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi import APIRouter, FastAPI  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from lib.routes import auth, data, groups  # noqa: E402

api = APIRouter(prefix="/api")
for module in (auth, groups, data):
    api.include_router(module.router)

app = FastAPI(title="Horarios", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(api)

# En Vercel, public/ lo sirve el CDN; en local lo sirve esta app.
if not os.environ.get("VERCEL"):
    app.mount("/", StaticFiles(directory=ROOT / "public", html=True), name="public")
