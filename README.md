# Horarios GREB

Sube PDF de horarios (el nombre del archivo es el nombre de la persona) y ve quién está en clase en cada tramo. Búsqueda por nombre.

- `public/index.html` — interfaz (la sirve Vercel como estática)
- `api/index.py` — API FastAPI (función Python de Vercel)
- `lib/` — lector de PDF, cálculo de tramos, acceso a datos
- `supabase/schema.sql` — tablas y función `replace_person`

## Desplegar

1. **Supabase**: crea un proyecto, abre *SQL Editor* y ejecuta `supabase/schema.sql`.
   Copia la *Project URL* y la clave `service_role` (Settings > API).
2. **Vercel**: importa la carpeta/repo y define estas variables de entorno:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY` (la `service_role`; nunca en el frontend)
   - `APP_PASSWORD` (clave de acceso a la web; si no se define, queda abierta)
3. Despliega (`vercel --prod`).

## Desarrollo local

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn api.index:app --port 8765   # http://localhost:8765
```

Sin `SUPABASE_URL` usa un `data.db` SQLite local. Con las variables definidas usa Supabase.
