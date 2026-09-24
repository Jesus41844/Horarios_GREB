# Horarios GREB

Sube PDF de horarios (el nombre del archivo es el nombre de la persona) y ve quién está en clase en cada tramo. Búsqueda por nombre.

- `public/index.html` — interfaz (la sirve Vercel como estática)
- `api/index.py` — API FastAPI (función Python de Vercel)
- `lib/` — lector de PDF, cálculo de tramos, acceso a datos
- `supabase/schema.sql` — tablas (esquema `greb`)

## Desplegar

1. **Base de datos**: ejecuta `supabase/schema.sql` una vez (Supabase > SQL Editor). Crea el esquema `greb`, aparte de las demás tablas.
2. **Vercel**: importa el repo y define estas variables de entorno:
   - `DATABASE_URL` (cadena de conexión de Supabase, *transaction pooler* `:6543`)
   - `APP_PASSWORD` (clave de acceso a la web; si no se define, queda abierta)
3. Despliega (`vercel --prod`).

## Desarrollo local

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn api.index:app --port 8765   # http://localhost:8765
```

Sin `DATABASE_URL` usa un `data.db` SQLite local. Con ella definida usa Postgres (Supabase).
