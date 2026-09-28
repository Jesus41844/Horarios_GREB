# Horarios

[![tests](https://github.com/Jesus41844/Horarios_GREB/actions/workflows/tests.yml/badge.svg)](https://github.com/Jesus41844/Horarios_GREB/actions/workflows/tests.yml)
[![licencia](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)

Aplicación web para consultar, en un solo lugar, **quién está ocupado y cuándo** dentro de una
agrupación estudiantil. Cada miembro aporta su horario de clases (PDF, imagen o captura) y,
opcionalmente, su horario laboral; la aplicación los consolida y responde a la pregunta que
realmente importa al coordinar reuniones: **¿cuándo estamos todos libres?**

Diseñada para varias agrupaciones en una misma instalación, con datos aislados entre sí.

## Contenido

- [Características](#características)
- [Roles y permisos](#roles-y-permisos)
- [Arquitectura](#arquitectura)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Puesta en marcha local](#puesta-en-marcha-local)
- [Despliegue](#despliegue)
- [Operación](#operación)
- [Modelo de datos](#modelo-de-datos)
- [API](#api)
- [Seguridad](#seguridad)
- [Pruebas](#pruebas)
- [Limitaciones conocidas](#limitaciones-conocidas)

## Características

**Consulta**

- **Vista semanal** de lunes a viernes, con la disposición de la tabla de horario impreso. Cada
  bloque indica cuántas personas están ocupadas y quiénes; el espacio en blanco es tiempo libre.
  La rejilla se ajusta al alto de la ventana.
- **Vista por día**, con una regla horaria que destaca los huecos libres y marca la hora actual.
- **Ficha por persona**, con su semana completa, materia, aula y marcas de laboratorio o grupo.
- **Búsqueda por nombre**, insensible a tildes y mayúsculas.
- **Bloques seguidos**: los consecutivos de una misma persona se unen cuando la pausa es de **5
  minutos o menos**, los que deja la UTP entre una clase y la siguiente, para que la rejilla salga
  limpia. A partir de seis minutos el hueco es tiempo libre de verdad y se ve.
- **Barra de secciones** debajo de la cabecera, con lo que se mira a diario: *Horario*, *Libres*,
  *Más activos* y *Ruleta* (esta última solo para quien administra). La sección abierta se marca.
- **Ajustes en columna**: un botón con el símbolo de menú abre el panel; allí queda lo que se
  configura (Horarios, Miembros, Agrupaciones, Solicitudes y Cuenta) y al pie la cuenta con el botón
  de salir.
- **Subir PDF o imagen** con un botón compacto al final de la barra de vistas, junto a *Semana* y
  *Por día*. Sigue aceptando soltar los archivos encima. Al lado hay una casilla, *Repetir los que
  ya están*, para desactivar el filtro de los que ya se habían subido.

**Quién está libre**

La pregunta al revés de la rejilla. En lugar de quién está ocupado, la vista **Libres** coge un
intervalo escrito —de 12:00 a 13:00 por defecto— y contesta **quién está libre en ese rato**:

- Se elige el intervalo y los días, y nada más. El hueco es el intervalo entero, que es lo que se
  ha preguntado; el parámetro `duracion` existe por si se quiere partir en trozos más cortos.
- Si del intervalo entero no se libra nadie, no se responde con un "nada", sino con lo que sí se
  puede: se parte en huecos de media hora y salen los mejores tramos primero, cada uno con sus
  propias horas, para que se vea de qué sí se puede.
- Los tramos contiguos con el mismo resultado se unen en uno solo: si A, B y C están libres en cada
  ventana, lo están en todo el hueco que las cubre.
- Cada tramo enseña **quién puede venir** (los nombres libres del tramo entero) y el recuento
  "X de Y libres". Quien no puede se esconde detrás de un "No pueden: N", para no tener que leerlo
  todo: lo que se busca es a quién se convoca.
- Quien no tiene ningún bloque cuenta como libre siempre, y entra en el cómputo.

**Carga de horarios**

- **PDF**: lectura exacta de la tabla del horario, celda por celda.
- **Imagen**: reconocimiento óptico (OCR) ejecutado en el navegador. Admite capturas de la tabla
  de la UTP aunque el OCR monte mal los títulos de los días y pierda algún dos puntos de las horas:
  las columnas se sacan de dónde está cada `AULA:` y los días se numeran por orden. El código
  del aula también se recompone: si el OCR lee cuatro números seguidos (`AULA:3422`) se vuelve a
  partir por su cuenta (`3-422`), que es como lo escribe la UTP. El resultado es una propuesta
  editable y **nunca se guarda sin revisión**.
- **Entrada manual**: alta, edición y borrado de cualquier bloque, sea cual sea su origen.
- **Horario laboral**: franjas de trabajo que cuentan como ocupación igual que una clase.
- **La rejilla no inventa clases**: unir los bloques seguidos se come el hueco que había entre
  ellos, así que quién está en cada tramo se decide con los bloques sin unir. Si a alguien no lo
  ocupa ningún bloque de verdad, ese tramo no se pinta.
- **Informe de subida** por archivo, con el nombre exacto y el motivo de cada fallo; un archivo
  defectuoso no bloquea al resto.
- **No se vuelve a subir lo que ya está**: al soltar varios archivos, los de quien ya tiene clases
  guardadas se apartan y se listan aparte con su número de clases, porque al subirlos se le
  reemplazarían todas. La casilla **Repetir los que ya están** los deja pasar.
- **Clases virtuales excluidas**: las que no ocupan físicamente a nadie no cuentan como tiempo
  ocupado (véase [Limitaciones conocidas](#limitaciones-conocidas)).

**Ruleta de actividades**

Para repartir turnos y ponencias sin que siempre salga la misma cara. Cada actividad guarda su propio
conteo, y hay dos modos:

| Modo | Días | Qué mira al sortear |
|---|---|---|
| **Venta** | Los que se elijan, varios si hace falta | El padrón entero, sin mirar el horario: es gente que está ahí todo el día |
| **Actividad** | Uno solo, exacto | Solo quien esté libre ese día en esa franja, como en el resto de la aplicación |

- **Ficha completa**: nombre, días exactos, hora si la tiene y **cuántas personas** salen de una vez.
  Una venta puede ocupar varios días; una actividad con hora fija no, porque el horario no alcanza
  para decir quién está libre en dos días a la vez.
- **Editar y eliminar**: la ✎ corrige la ficha sin tocar el reparto ya hecho; la ✕ borra la actividad
  y su conteo.
- **Rueda de verdad**: un sector por persona del bombo. Los nombres **no** van dentro del sector
  (en la mitad de abajo se leerían del revés y con mucha gente no caben): se leen en la lista de
  debajo, todos del mismo tamaño, y el sector que pasa por el puntero se resalta junto al nombre en
  el centro. El bombo que se ve es el mismo que se sortea, y con menos movimiento (si el sistema lo
  pide) sale el resultado sin girar.
- **A pantalla completa**: al darle al botón, la rueda ocupa la pantalla y el fondo se difumina. Al
  pararse, la rueda se va y quedan solo los nombres de quien salió, grandes; mientras gira no se puede
  cerrar, y con `Esc` o con "Listo" se vuelve a los ajustes. El reparto ya está guardado en el
  servidor, así que se registra aunque se cierre la pantalla.
- **Strikes**: botones rápidos de `+1` y `−1` por persona, con un motivo opcional. El peso en la
  sorteo es `1 + 1,5 × strikes` (y nunca baja de 1, aunque se resten), así que quien más tiene,
  más urge que salga.
- **Descanso**: quien salió en la actividad anterior del mismo modo no entra en la siguiente. Se puede
  desactivar por sorteo (`excluir_activos: false`) cuando de verdad haga falta.
- Sorteo **sin reemplazo**, de 1 a 6 personas de una vez, con el resultado siempre en el servidor.
  Si se piden varias, salen todas juntas en el mismo sorteo.
- **Corrección manual**: quien no llegó, o a quien se le olvidó apuntar, se quita con un clic, y el
  conteo se ajusta solo.
- **Más activos**: clasificación de quién más ha salido, con el reparto entre ventas y actividades con
  hora por separado. La ve todo el mundo de la agrupación; la ruleta, solo quien administra.

**Administración**

- Cuentas propias, agrupaciones aisladas y flujo de solicitud de acceso con aprobación.
- **Corrección de nombres** del padrón, tal y como sale en el PDF. Las participaciones y las strikes
  están detrás de la persona, no del texto, así que sobreviven al cambio.
- Gestión de miembros restringida a la cuenta principal de cada agrupación.
- Alta inicial desde la propia web, sin acceso a la base de datos.

## Roles y permisos

| Rol | Horarios | Personas y accesos |
|---|---|---|
| **Superadmin** | Todas las agrupaciones | Crea y elimina agrupaciones, aprueba solicitudes y reasigna la cuenta principal |
| **Cuenta principal** | Subir, editar y borrar | **Única** que añade, quita y da permisos a los miembros |
| **Administrador** | Subir, editar y borrar | Sin acceso a la gestión de personas |
| **Solo ver** | Consultar y buscar | — |

- Las solicitudes de acceso las aprueba el superadmin, no la cuenta principal.
- La **cuenta principal** de una agrupación es la del correo inicial: la primera persona que el
  superadmin aprueba como administradora de ella. No puede ser eliminada ni degradada, y el
  superadmin puede reasignarla.
- Quien se añade a una agrupación entra como **solo ver**; ascenderlo a administrador es decisión
  exclusiva de la cuenta principal.
- Cualquier persona puede solicitar acceso desde la web, pero no ve nada hasta ser aprobada.
- Una cuenta puede pertenecer a varias agrupaciones.
- Para quien no es miembro, una agrupación responde `404`: no revela su existencia.

## Arquitectura

```mermaid
flowchart LR
    B["Navegador<br/>JavaScript nativo (ES modules)<br/>Tesseract.js para OCR"]
    C["CDN de Vercel<br/>public/"]
    F["Función Python en Vercel<br/>FastAPI"]
    P[("PostgreSQL<br/>esquema horarios")]

    B -- "HTML · CSS · JS" --> C
    B -- "HTTPS + cookie de sesión" --> F
    F -- "psycopg · DATABASE_URL" --> P
```

| Capa | Tecnología |
|---|---|
| Interfaz | HTML, CSS y JavaScript nativo (ES modules); sin paso de compilación |
| API | Python · FastAPI |
| Lectura de PDF | pdfplumber |
| OCR | Tesseract.js, cargado desde CDN y ejecutado en el navegador |
| Base de datos | PostgreSQL (Supabase u otro) · SQLite en desarrollo |
| Acceso a datos | psycopg 3, SQL escrito una sola vez para ambos motores |
| Alojamiento | Vercel (contenido estático + función Python) |

**Decisiones de diseño relevantes**

- **Un único SQL para dos motores.** Las consultas usan `?` y tablas `horarios.*`; en SQLite el
  archivo se adjunta con ese mismo nombre de esquema. El esquema de SQLite se deriva de
  `db/schema.sql`, que es la fuente única.
- **OCR en el cliente.** El entorno de funciones de Vercel no incluye el binario de Tesseract, y
  vendorizarlo sería pesado. Correr en el navegador evita esa dependencia y mantiene los datos
  fuera del servidor hasta que el usuario los confirma.
- **Cada archivo, una petición.** Vercel limita el tamaño de cada petición; subirlos por
  separado además aísla los fallos.

## Estructura del repositorio

```
api/index.py         Punto de entrada de la función Python
lib/
  parser.py          Lectura de la tabla del PDF y regla de clases virtuales
  schedule.py        Unión de bloques, tramos por día y búsqueda de huecos libres
  ruleta.py          Pesos, quién está disponible y el sorteo en sí
  repo.py            Todas las consultas SQL
  db.py              Conexión: Postgres si hay DATABASE_URL, SQLite si no
  security.py        Contraseñas (scrypt) y tokens de sesión
  deps.py            Dependencias de FastAPI: sesión y permisos por agrupación
  fixes.py           Correcciones de datos de una sola aplicación
  routes/            auth · setup · groups · data · actividades
public/
  index.html         Documento de entrada
  css/app.css        Estilos
  js/
    app.js           Interfaz y estado
    api.js           Cliente de la API
    dom.js           Utilidades de DOM y formato
    ocr.js           Lectura de imágenes y reparto en celdas
db/
  schema.sql         Esquema completo (fuente única)
  migrations.sql     Cambios sobre bases ya creadas
scripts/manage.py    Administración desde la terminal
tests/               Pruebas de API, de la rejilla y del analizador del OCR
```

## Puesta en marcha local

Requisitos: Python 3.12 o superior y Node.js (solo para la prueba del OCR).

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn api.index:app --port 8765     # http://localhost:8765
```

Sin `DATABASE_URL`, la aplicación usa un archivo `data.db` (SQLite) y crea las tablas sola. Con
esa variable definida se conecta a PostgreSQL.

## Despliegue

1. **Base de datos.** Cualquier PostgreSQL con conexión estándar. En Supabase, usar el
   *transaction pooler* (puerto `6543`).
2. **Vercel.** Importar el repositorio y definir la variable de entorno de la tabla siguiente.
3. **Desplegar** con `vercel --prod` o mediante la integración con GitHub.
4. **Primera cuenta.** Al abrir la web por primera vez, con la base todavía sin cuentas, aparece
   una pantalla para crear la cuenta principal. Crea las tablas si faltan y otorga el rol de
   superadmin. **Se cierra sola** en cuanto existe una cuenta.

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí (producción) | Cadena de conexión de PostgreSQL |
| `HORARIOS_SQLITE` | No | Ruta del archivo SQLite en desarrollo (por defecto `data.db`) |
| `HORARIOS_PASSWORD` | No | Contraseña para `manage.py create-user`, en lugar de pedirla por teclado |

Configuración de la función (`vercel.json`): duración máxima de 30 s e inclusión de `db/**`
en el paquete, necesaria para aplicar el esquema desde la propia aplicación.

## Operación

### Migraciones y correcciones de datos

Pensado para entornos donde quien administra **no puede alcanzar el puerto de PostgreSQL** desde
su red:

- **`db/migrations.sql`** contiene cambios de esquema idempotentes. La aplicación los aplica sola,
  con un candado de base de datos, cuando detecta que falta alguno.
- **`lib/fixes.py`** contiene correcciones de datos que se ejecutan **una sola vez** y quedan
  registradas en `horarios.applied_migrations`.
- `GET /api/setup` devuelve `migrated` y `applied`, lo que permite comprobar desde fuera qué se
  aplicó y con qué resultado.

Al añadir una migración de esquema, hay que incorporar su columna a `_ESPERADAS` en `lib/db.py`.

### Administración desde la terminal

```bash
python -m scripts.manage migrate                                       # aplica db/schema.sql
python -m scripts.manage create-user correo@ejemplo.com "Nombre" --superadmin
python -m scripts.manage create-group "Nombre de la agrupación"
```

Con `--sql`, `create-user` no se conecta: calcula el hash localmente e imprime la sentencia
`INSERT` para ejecutarla en el editor SQL del proveedor.

## Modelo de datos

Todo vive en el esquema `horarios`.

| Tabla | Contenido |
|---|---|
| `users` | Cuentas: correo, nombre, hash de contraseña, marca de superadmin |
| `sessions` | Sesiones activas; guarda el hash del token, nunca el token |
| `login_failures` | Intentos fallidos, para el bloqueo temporal |
| `groups` | Agrupaciones y su cuenta principal (`owner_user_id`) |
| `memberships` | Pertenencia de cuentas a agrupaciones y rol (`admin` / `member`) |
| `requests` | Solicitudes de acceso pendientes de aprobación |
| `people` | Personas cuyo horario se gestiona, por agrupación |
| `blocks` | Bloques de horario; `kind` distingue `clase` de `trabajo` |
| `actividades` | Actividades de la ruleta: nombre, modo (`ventas` / `horario`), días exactos, hora y cuántas salen |
| `participaciones` | Quién salió en cada actividad; enlaza con `person_key`, no con el nombre |
| `strikes` | Strikes por persona y agrupación, con su motivo y fecha |
| `applied_migrations` | Correcciones de datos ya aplicadas |

Al eliminar una agrupación se van en cascada sus personas, sus bloques, sus actividades, sus
participaciones, sus strikes, sus membresías y sus solicitudes.

**Identidad social.** `people.name` es la clave de la agenda, pero cambiarla de verdad (por ejemplo,
«Pérez, Ana» → «Ana Gómez») no puede perder participaciones ni strikes. Por eso ambas tablas
sociales guardan un `person_key` propio —el nombre normalizado, sin tildes ni mayúsculas— que se
mueve con el renombrado. Sobrevive también a que alguien vuelva a subir su PDF, porque el alta
conserva la clave que ya tenía.

## API

Todas las rutas cuelgan de `/api`. Salvo las marcadas como públicas, exigen sesión.

| Método y ruta | Rol requerido | Función |
|---|---|---|
| `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` | Público / sesión | Sesión |
| `POST /auth/register` · `GET /auth/groups` | Público | Solicitar acceso |
| `POST /auth/password` | Sesión | Cambiar contraseña |
| `GET /setup` · `POST /setup` | Público | Estado de instalación y alta inicial |
| `GET /groups` · `POST /groups` | Superadmin | Listar y crear agrupaciones |
| `PUT /groups/{slug}/owner` · `DELETE /groups/{slug}` | Superadmin | Cuenta principal · eliminar |
| `GET /requests` · `POST /requests/{id}/approve` · `DELETE /requests/{id}` | Superadmin | Solicitudes |
| `GET /g/{slug}/members` · `PUT` · `DELETE …/{user_id}` | Cuenta principal | Gestión de personas |
| `GET /g/{slug}/schedule` · `/people` · `/person` | Miembro | Consulta |
| `GET /g/{slug}/libre` | Miembro | Quién está libre en el intervalo pedido, y si no hay nadie, los mejores tramos de dentro |
| `GET /g/{slug}/ruleta` | Miembro | Padrón con strikes y participaciones, actividades y el bombo de cada una |
| `PUT /g/{slug}/person` | Administrador | Corregir el nombre del padrón |
| `POST /g/{slug}/actividades` · `PUT` · `DELETE /g/{slug}/actividad/{id}` | Administrador | Alta, edición y borrado de actividades |
| `POST /g/{slug}/actividad/{id}/girar` | Administrador | Sortear, en el servidor |
| `POST /g/{slug}/actividad/{id}/participacion` | Administrador | Corregir el reparto a mano |
| `PUT /g/{slug}/strike` | Administrador | Sumar o quitar una strike |
| `POST /g/{slug}/upload` | Administrador | Subir PDF |
| `POST /g/{slug}/blocks` · `PUT` · `DELETE /g/{slug}/block/{id}` | Administrador | Bloques manuales |
| `DELETE /g/{slug}/person` · `DELETE /g/{slug}/people` | Administrador | Borrar horarios |

## Seguridad

- **Contraseñas**: scrypt (`n=2¹⁴`, `r=8`, `p=1`) con sal aleatoria; mínimo de 8 caracteres.
- **Sesiones**: cookie `HttpOnly`, `SameSite=Lax` y `Secure` bajo HTTPS, con caducidad de 7 días.
  En la base solo se almacena el hash SHA-256 del token.
- **Fuerza bruta**: cinco intentos fallidos bloquean el correo durante 15 minutos. Si el correo no
  existe, se realiza el mismo cálculo de hash para no revelarlo por el tiempo de respuesta.
- **Aislamiento**: cada consulta de horarios se filtra por agrupación; el acceso se comprueba en
  el servidor en cada petición.
- **Cambio de contraseña**: cierra las demás sesiones de la cuenta.
- **Base de datos**: RLS activado en todas las tablas por si el esquema llegara a exponerse.
- **Interfaz**: el contenido de archivos y nombres se inserta siempre como texto, nunca como HTML.

## Pruebas

```bash
.venv/bin/python -m pytest tests -q         # API, rejilla y correcciones de datos
node tests/ocr.test.mjs                     # analizador del OCR
```

Las pruebas de API usan SQLite y cubren, entre otros aspectos: permisos por rol, aislamiento entre
agrupaciones, bloqueo por intentos fallidos, flujo de solicitud y aprobación, edición de bloques,
exclusión de clases virtuales, correcciones de datos, búsqueda de huecos libres, renombrado con
arrastre de participaciones y strikes, y la ruleta completa (modos, descanso, pesos, correcciones y
aislamiento entre agrupaciones). `tests/test_schedule.py` comprueba los cálculos de la rejilla por
separado: qué pausas se consideran seguidas (cinco minutos) y que un descanso tragado por la unión
no llegue a pintarse como una clase.

> **Nota.** Varias pruebas cargan un horario de ejemplo llamado `HorarioClase.pdf` en la raíz del
> proyecto. El archivo no se versiona, porque `*.pdf` está excluido para no publicar horarios
> reales. Para ejecutarlas hace falta colocar allí un horario del mismo formato.

## Limitaciones conocidas

- **Formato del PDF.** El lector espera la tabla `HORAS × días` de los horarios de la UTP, con
  texto seleccionable. Un PDF escaneado se rechaza con ese motivo en lugar de adivinar.
- **OCR no exacto.** Es la parte más frágil de la carga: el texto se reconoce bien pero las
  palabras llegan desordenadas y el OCR confunde letras. En una captura real de la UTP leyó las 26
  clases presenciales de 29 (las 3 virtuales se descartan solas) con el día, la hora, la materia y
  el aula correctos, aunque alguna palabra quedó mal (una abreviatura de materia, partida o con una
  letra cambiada).
  Aun así marca para revisar los códigos de aula que no encajan en `3-405` (por ejemplo `aula 3`,
  donde el OCR partió el código), que es justo lo que hay que mirar antes de guardar.
- **Clases virtuales.** Se descartan las que tienen la letra **N** donde iría el primer dígito de
  un aula física: `Salón 2-N01` es virtual, `aula 3-405` no. Los números que rodean a la N no
  importan. Se aplica a PDF, imágenes y entrada manual, y también se corrigieron los datos que ya
  estaban guardados.
- **Tamaño de subida.** Cada PDF puede pesar hasta 4 MB por el límite de peticiones de Vercel.
- **Primera carga del OCR.** El lector se descarga la primera vez (unos 12 MB) y luego queda en
  caché del navegador.
