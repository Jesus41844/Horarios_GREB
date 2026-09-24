# Horarios

Cada agrupación sube los PDF de horario de su gente y la web responde la pregunta real:
**¿cuándo estamos todos libres?** Muestra, tramo a tramo, quién está en clase, marca los
huecos y deja buscar a cualquier persona por su nombre.

El nombre del archivo es el nombre de la persona: `Juan Pérez.pdf` → Juan Pérez.
Acepta **PDF** (lectura exacta) e **imágenes** (con OCR y revisión obligatoria), y también
se puede teclear el horario a mano.

## Cómo funciona

- **Semana** — rejilla de lunes a viernes, como la tabla del horario impreso: cada bloque es
  un tramo ocupado y el blanco es tiempo libre. Al pulsar un bloque se abre ese día.
- **Pista del día** — una regla horaria con una barra por tramo (más alta cuanta más gente
  en clase), los huecos etiquetados en ámbar y una línea que marca la hora actual.
- **Horario laboral** — desde la ficha de una persona se le añaden franjas de trabajo, que
  cuentan como ocupación igual que las clases. También se puede dar de alta a alguien que
  solo trabaja, sin PDF.
- **Tramos** — los bloques seguidos de una persona se unen si la pausa es de 10 min o menos,
  así un horario de 7:00 a 11:55 sale como un solo rango y no como seis bloques.
- **Detalle** — al pulsar un nombre se abre su semana con materia, aula y marcas `(L)`, `(B)`.
- **Informe de subida** — cada archivo se procesa por separado. Los que fallan salen primero,
  con su nombre exacto y el motivo; uno roto no bloquea a los demás.
- **Imágenes** — una captura del horario se lee con OCR **en el navegador** de quien la sube
  (Tesseract desde CDN; el servidor de Vercel no tiene el binario). Lo que sale es una
  propuesta editable: no se guarda nada hasta que el admin la revisa. Al guardar reemplaza
  las clases de esa persona y deja intacto su horario de trabajo.
- **A mano** — desde la ficha de una persona se añade, **edita** y borra cualquier bloque, da
  igual si vino de un PDF, de una imagen o se tecleó. Editar permite corregir la hora, el día,
  la materia, el aula, o convertir una clase en trabajo.
- **Borrar horarios** — Ajustes → Horarios lista a todo el mundo con su archivo y su fecha,
  para borrar uno a uno o vaciar la agrupación entera. También desde el detalle de la persona.

## Cuentas y permisos

| Quién | Puede |
|---|---|
| **Superadmin** | Crear y eliminar agrupaciones, aprobar solicitudes; las ve todas |
| **Cuenta principal** de una agrupación | Todo lo de admin, y además es la única que añade, quita y da permisos a la gente |
| **Admin** | Subir y borrar horarios. No toca a las personas |
| **Solo ver** | Consultar y buscar dentro de su agrupación |

La cuenta principal es la del **correo inicial**: el primer admin que aprobó el superadmin
para esa agrupación. No se puede quitar ni degradar. El superadmin puede reasignarla desde
Ajustes → Agrupaciones, que también sirve para las agrupaciones creadas antes de esta regla. Quien añade a alguien entra como
**solo ver** por defecto; ascender a admin lo decide únicamente la cuenta principal.

Cualquiera puede pedir acceso desde la web, pero queda esperando a que el superadmin lo
apruebe. La cuenta principal también puede dar de alta a gente directamente. Una persona
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
db/migrations.sql  cambios sobre bases ya creadas; la app los aplica sola al arrancar
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
- **El OCR no es exacto** y por eso la revisión es obligatoria: en la prueba con una captura
  del PDF de ejemplo leyó 17 de 18 bloques y confundió alguna marca `(L)`. Sirve para no
  teclearlo todo, no para confiar a ciegas.
- **Migraciones**: `db/migrations.sql` se aplica solo, una vez por proceso, cuando la app
  detecta que falta algún cambio. Es así porque quien administra no puede abrir el puerto de
  Postgres desde su red. `GET /api/setup` devuelve `migrated` para comprobarlo desde fuera.

## Primera cuenta

Al abrir la web por primera vez, cuando la base todavía no tiene ninguna cuenta,
aparece una pantalla para crear la tuya: crea las tablas si faltan y te deja como
superadmin. **Se cierra sola** en cuanto existe una cuenta, y a partir de ahí las
demás se crean desde Ajustes → Miembros.
