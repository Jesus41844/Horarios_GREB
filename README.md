# Horarios

Cada agrupación sube los PDF de horario de su gente y la web responde la pregunta real:
**¿cuándo estamos todos libres?** Muestra, tramo a tramo, quién está en clase, marca los
huecos y deja buscar a cualquier persona por su nombre.

El nombre del archivo es el nombre de la persona: `Juan Pérez.pdf` → Juan Pérez.

## Cómo funciona

- **Pista del día** — una regla horaria con una barra por tramo (más alta cuanta más gente
  en clase), los huecos etiquetados en ámbar y una línea que marca la hora actual.
- **Tramos** — los bloques seguidos de una persona se unen si la pausa es de 10 min o menos,
  así un horario de 7:00 a 11:55 sale como un solo rango y no como seis bloques.
- **Detalle** — al pulsar un nombre se abre su semana con materia, aula y marcas `(L)`, `(B)`.
- **Informe de subida** — cada archivo se procesa por separado. Los que fallan salen primero,
  con su nombre exacto y el motivo; uno roto no bloquea a los demás.
- **Borrar horarios** — Ajustes → Horarios lista a todo el mundo con su archivo y su fecha,
  para borrar uno a uno o vaciar la agrupación entera. También desde el detalle de la persona.

## Cuentas y permisos

| Quién | Puede |
|---|---|
| **Superadmin** | Crear y eliminar agrupaciones; las ve todas |
| **Admin** de una agrupación | Subir y borrar horarios, gestionar sus miembros |
| **Miembro** | Ver y buscar dentro de su agrupación |

No hay registro abierto: las cuentas las crea un admin desde Ajustes → Miembros. Una persona
puede estar en varias agrupaciones. Los datos de cada una están separados: a quien no es
miembro, la agrupación le responde 404 y ni siquiera sabe que existe.

## Estructura

```
public/            interfaz (Vercel la sirve como estática)
api/index.py       punto de entrada de la función Python
lib/
  parser.py        lee la tabla del PDF
  schedule.py      une bloques y calcula los tramos del día
  repo.py          todas las consultas SQL
  db.py            Postgres si hay DATABASE_URL, SQLite si no
  routes/          auth, groups, data
db/schema.sql      esquema `horarios` (fuente única)
scripts/manage.py  migrar y crear la primera cuenta
tests/             pruebas de la API
```

## Desplegar

1. **Base de datos** (Supabase u otro Postgres): aplica el esquema.
   ```
   export DATABASE_URL='postgresql://…?sslmode=require'
   python -m scripts.manage migrate
   ```
   También sirve pegar `db/schema.sql` en el SQL Editor de Supabase. Es idempotente.
2. **Primera cuenta** (la contraseña se pide por teclado):
   ```
   python -m scripts.manage create-user tu@correo.com "Tu Nombre" --superadmin
   ```
   Si tu red bloquea el puerto de Postgres (5432/6543), añade `--sql`: no conecta,
   calcula el hash en local e imprime el `INSERT` para pegarlo en el SQL Editor.
3. **Vercel**: importa el repo y define `DATABASE_URL`. Despliega con `vercel --prod`.

Desde la web, el superadmin crea las agrupaciones (GREB, Eurus…) y cada admin añade a su gente.

## Desarrollo local

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn api.index:app --port 8765        # http://localhost:8765
.venv/bin/python -m pytest tests -q
```

Sin `DATABASE_URL` usa un `data.db` SQLite y crea las tablas solo. Con ella, habla con Postgres.

## Notas

- Las contraseñas se guardan con scrypt. La sesión va en una cookie `httpOnly` de 7 días y en
  la base solo queda su hash. Cinco intentos fallidos bloquean el correo 15 minutos.
- Cambiar la contraseña cierra las demás sesiones.
- Cada subida va en su propia petición: Vercel limita cada una a ~4,5 MB.
- El lector espera la tabla `HORAS × días` de los horarios de la UTP (Crystal Reports), con
  texto seleccionable. Un PDF escaneado se rechaza con ese motivo en vez de adivinar.

## Primera cuenta

Al abrir la web por primera vez, cuando la base todavía no tiene ninguna cuenta,
aparece una pantalla para crear la tuya: crea las tablas si faltan y te deja como
superadmin. **Se cierra sola** en cuanto existe una cuenta, y a partir de ahí las
demás se crean desde Ajustes → Miembros.

Esto evita depender del puerto de Postgres desde tu máquina: el servidor sí alcanza
la base aunque tu red bloquee el 5432/6543.
