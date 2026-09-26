import { ApiError, api } from "./api.js";
import { aulaDudosa, leerImagen } from "./ocr.js";
import {
  DAYS, clear, el, fmt, fmtRange, highlight, hourLabel, minutesNow, norm, people, todayIndex,
} from "./dom.js";

const root = document.getElementById("root");
const panel = document.getElementById("panel");
const scrim = document.getElementById("scrim");

const S = {
  user: null,
  groups: [],
  slug: null,
  week: [],
  roster: [],
  view: "semana",   // "semana" (rejilla L-V) o "dia"; lo demás vive en Ajustes
  day: todayIndex(),
  query: "",
  report: null,
  flash: null,    // aviso que debe sobrevivir a un redibujado del panel
  pending: 0,     // solicitudes por aprobar (solo superadmin)
  waiting: null,  // agrupaciones que esta cuenta pidió y aún no le aprueban
  libres: {       // lo que se ha pedido en la vista "Libres"
    dias: [0, 1, 2, 3, 4],
    duracion: 60, paso: 15, resultados: null, cargando: false, error: null,
  },
  ruleta: null,   // datos de /ruleta: padrón, strikes y participaciones
  ruletaError: null,
  ajustes: "cuenta",   // sección del sidebar de Ajustes que está abierta
  girando: null,  // id de la actividad que se está girando ahora
  ultimo: null,   // último sorteo, para enseñarlo debajo de la actividad
  editando: null, // id de la actividad abierta en el formulario de edición
  borrador: null, // lo que se está escribiendo: vive aquí para que al repintar
                 // no se pierdan ni el nombre ni los días ya escritos
};

const group = () => S.groups.find((g) => g.slug === S.slug) || null;
const isAdmin = () => group()?.role === "admin";
const isOwner = () => group()?.is_owner === true;
const remember = (slug) => { try { localStorage.setItem("grupo", slug); } catch { /* modo privado */ } };
const remembered = () => { try { return localStorage.getItem("grupo"); } catch { return null; } };

// --- arranque -------------------------------------------------------------

boot();

async function boot() {
  try {
    enter(await api.me());
    return;
  } catch { /* sin sesión: puede que la instalación esté pendiente */ }
  try {
    const s = await api.setupStatus();
    if (s.needed) return showSetup();
  } catch { /* si no se puede consultar, se pide entrar */ }
  showLogin();
}

/** Primera cuenta: solo aparece mientras no hay ninguna. */
function showSetup(message) {
  const name = el("input", { type: "text", required: true, autocomplete: "name" });
  const email = el("input", { type: "email", required: true, autocomplete: "username" });
  const pass = el("input", {
    type: "password", required: true, autocomplete: "new-password", minLength: 8,
  });
  const submit = el("button", { className: "btn btn-primary", type: "submit", textContent: "Crear cuenta y entrar" });

  const form = el("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        enter(await api.setup({
          name: name.value, email: email.value, password: pass.value,
        }));
      } catch (err) {
        showSetup(err.message);
      }
    },
  },
    el("label", { className: "field" }, el("span", { textContent: "Tu nombre" }), name),
    el("label", { className: "field" }, el("span", { textContent: "Correo" }), email),
    el("label", { className: "field" }, el("span", { textContent: "Contraseña (mín. 8)" }), pass),
    message ? el("p", { className: "note err", textContent: message }) : null,
    submit);

  clear(root).append(
    el("div", { className: "login" },
      el("div", { className: "login-card" },
        el("h1", {}, "Primera ", el("span", { textContent: "cuenta" })),
        el("p", { className: "lede", textContent: "Todavía no hay ninguna cuenta. Crea la tuya y quedarás como administrador." }),
        form)));
  name.focus();
}

/** Pedir acceso: crea la cuenta y deja la solicitud esperando aprobación. */
async function showRegister(message, groups) {
  if (!groups) {
    try {
      groups = await api.publicGroups();
    } catch {
      return showLogin("No se pudo cargar la lista de agrupaciones.");
    }
  }
  if (!groups.length) {
    return showLogin("Todavía no hay ninguna agrupación a la que pedir acceso.");
  }

  const name = el("input", { type: "text", required: true, autocomplete: "name" });
  const email = el("input", { type: "email", required: true, autocomplete: "username" });
  const pass = el("input", { type: "password", required: true, autocomplete: "new-password", minLength: 8 });
  const group = el("select", { required: true },
    ...groups.map((g) => el("option", { value: g.slug, textContent: g.name })));
  const submit = el("button", { className: "btn btn-primary", type: "submit", textContent: "Pedir acceso" });

  const form = el("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        enter(await api.register({
          name: name.value, email: email.value, password: pass.value, group: group.value,
        }));
      } catch (err) {
        showRegister(err.message, groups);
      }
    },
  },
    el("label", { className: "field" }, el("span", { textContent: "Tu nombre" }), name),
    el("label", { className: "field" }, el("span", { textContent: "Correo" }), email),
    el("label", { className: "field" }, el("span", { textContent: "Contraseña (mín. 8)" }), pass),
    el("label", { className: "field" }, el("span", { textContent: "Agrupación" }), group),
    message ? el("p", { className: "note err", textContent: message }) : null,
    submit);

  clear(root).append(
    el("div", { className: "login" },
      el("div", { className: "login-card" },
        el("h1", {}, "Pedir ", el("span", { textContent: "acceso" })),
        el("p", { className: "lede", textContent: "Creas tu cuenta y queda esperando a que te aprueben." }),
        form,
        el("p", { className: "alt" },
          "¿Ya tienes cuenta? ",
          el("button", { className: "link", type: "button", textContent: "Entrar", onclick: () => showLogin() })))));
  name.focus();
}

function showLogin(message) {
  closePanel();
  const email = el("input", { type: "email", required: true, autocomplete: "username", autofocus: true });
  const pass = el("input", { type: "password", required: true, autocomplete: "current-password" });
  const note = message ? el("p", { className: "note err", textContent: message }) : null;
  const submit = el("button", { className: "btn btn-primary", type: "submit", textContent: "Entrar" });

  const form = el("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        enter(await api.login(email.value, pass.value));
      } catch (err) {
        showLogin(err.message);
      }
    },
  },
    el("label", { className: "field" }, el("span", { textContent: "Correo" }), email),
    el("label", { className: "field" }, el("span", { textContent: "Contraseña" }), pass),
    note,
    submit);

  clear(root).append(
    el("div", { className: "login" },
      el("div", { className: "login-card" },
        el("h1", {}, "Horari", el("span", { textContent: "os" })),
        el("p", { className: "lede", textContent: "Entra para ver los horarios de tu agrupación." }),
        form,
        el("p", { className: "alt" },
          "¿Aún no tienes cuenta? ",
          el("button", { className: "link", type: "button", textContent: "Pedir acceso", onclick: () => showRegister() })))));
  email.focus();
}

function enter(me) {
  S.user = me.user;
  S.groups = me.groups;
  S.pending = me.pending || 0;
  S.waiting = me.waiting || null;
  const saved = remembered();
  S.slug = S.groups.some((g) => g.slug === saved) ? saved : S.groups[0]?.slug || null;
  S.report = null;
  load();
}

async function load() {
  if (!S.slug) return render();
  try {
    const [week, roster] = await Promise.all([api.schedule(S.slug), api.people(S.slug)]);
    S.week = week;
    S.roster = roster;
    render();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return showLogin("La sesión caducó. Entra otra vez.");
    render(err.message);
  }
}

// --- estructura de la página ---------------------------------------------

function render(error) {
  clear(root).append(header(), el("main", { className: "wrap" }, ...body(error)));
  requestAnimationFrame(ajustarRejilla);
}

function header() {
  const picker = S.groups.length > 1
    ? el("select", {
      ariaLabel: "Agrupación",
      onchange: (e) => {
        S.slug = e.target.value; remember(S.slug); S.report = null;
        S.ruleta = null; S.ruletaError = null; ruletaPeticion = null;
        load();
      },
    }, ...S.groups.map((g) => el("option", { value: g.slug, textContent: g.name, selected: g.slug === S.slug })))
    : el("strong", { textContent: group()?.name || "" });

  const search = el("input", {
    type: "search", placeholder: "Buscar persona", value: S.query,
    ariaLabel: "Buscar persona", autocomplete: "off",
    oninput: (e) => { S.query = e.target.value; render(); },
    onkeydown: (e) => {
      if (e.key !== "Enter") return;
      const hit = S.roster.find((p) => norm(p.name).includes(norm(S.query.trim())));
      if (hit) openPerson(hit.name);
    },
  });

  return el("header", { className: "top" },
    el("div", { className: "top-in" },
      el("div", { className: "brand" }, "Horari", el("span", { textContent: "os" })),
      S.slug ? picker : null,
      el("div", { className: "search" }, search),
      el("div", { className: "spacer" }),
      // El botón que abre la columna. Tres líneas, como siempre se ha dibujado.
      el("button", {
        className: "btn btn-menu", type: "button", ariaLabel: "Ajustes", title: "Ajustes",
        onclick: () => openSettings(S.pending ? "solicitudes" : S.ajustes),
      },
        el("span", { className: "hamb", ariaHidden: "true" }),
        S.pending ? el("span", { className: "badge", textContent: String(S.pending) }) : null)));
}

function body(error) {
  if (error) return [el("div", { className: "empty" }, el("strong", { textContent: "No se pudo cargar" }), error)];

  if (!S.slug) {
    if (S.waiting?.length) {
      return [el("div", { className: "empty" },
        el("strong", { textContent: "Tu solicitud está esperando aprobación" }),
        `Pediste acceso a ${S.waiting.map((g) => g.name).join(", ")}. Te avisarán en cuanto te aprueben; vuelve a entrar más tarde.`)];
    }
    return [el("div", { className: "empty" },
      el("strong", { textContent: "Todavía no hay una agrupación para ti" }),
      S.user.is_superadmin
        ? "Crea la primera desde Ajustes → Agrupaciones."
        : "Pide a quien administra tu agrupación que añada tu correo.")];
  }

  const out = [];
  if (S.report) out.push(reportCard(S.report));

  if (!S.roster.length) {
    out.push(el("div", { className: "empty" },
      el("strong", { textContent: "Aún no hay horarios" }),
      isAdmin()
        ? "Sube los PDF: el nombre del archivo es el nombre de la persona."
        : "Quien administra la agrupación todavía no ha subido ninguno."),
      isAdmin() ? dropzone() : null);
    return out;
  }

  if (S.query.trim()) {
    out.push(...searchResults());
    return out;
  }

  out.push(viewBar());
  if (S.view === "semana") {
    out.push(weekGrid());
    return out;
  }

  out.push(dayTabs());
  const segments = S.week[S.day]?.segments || [];
  if (!segments.length) {
    out.push(el("div", { className: "empty" },
      el("strong", { textContent: `Nadie está ocupado el ${DAYS[S.day].toLowerCase()}` }),
      "Todo el día está libre para reunirse."));
  } else {
    out.push(track(segments), ...segments.map((s, i) => segmentRow(s, i)));
  }
  return out;
}

/** La rejilla, y al final el botón de subir. Lo demás está en Ajustes, en la
 *  columna de la izquierda. */
function viewBar() {
  return el("div", { className: "viewbar" },
    el("div", { className: "tabs-group", role: "tablist", ariaLabel: "Vista" },
      ...[["semana", "Semana"], ["dia", "Por día"]].map(([id, label]) =>
        el("button", {
          type: "button", role: "tab", textContent: label,
          ariaSelected: String(S.view === id),
          onclick: () => { S.view = id; render(); },
        }))),
    el("span", { className: "spacer" }),
    isAdmin() ? dropzone() : null);
}

// --- quién está libre -------------------------------------------------------
// Las tres secciones siguientes (Libres, Más activos y Ruleta) viven dentro del
// sidebar de Ajustes, así que se pintan en el panel y no en la página. Sus
// acciones repintan el panel con repintarAjustes() en lugar de render().

const DURACIONES = [[30, "30 min"], [45, "45 min"], [60, "1 h"], [90, "1 h 30"], [120, "2 h"], [180, "3 h"]];
const PASOS = [[5, "5 min"], [10, "10 min"], [15, "15 min"], [30, "30 min"]];

/** "Libres": la pregunta al revés de la rejilla. Busca los huecos donde más
 *  gente está libre y dice **quién puede venir** en cada uno. No hay franjas que
 *  elegir: se mira el día entero y solo se decide cuánto tiene que durar el
 *  hueco, que es lo único que cambia la pregunta. */
function viewLibres() {
  const q = S.libres;
  const out = [];

  const marcar = (d) => {
    q.dias = q.dias.includes(d) ? q.dias.filter((x) => x !== d) : [...q.dias, d];
    repintarAjustes();
  };
  const num = (clave, opciones) => el("select", {
    ariaLabel: clave,
    onchange: (e) => { q[clave] = Number(e.target.value); },
  }, ...opciones.map(([v, t]) => el("option", { value: String(v), textContent: t, selected: q[clave] === v })));

  out.push(el("form", {
    className: "card panel-form",
    onsubmit: async (e) => {
      e.preventDefault();
      if (!q.dias.length) { q.error = "Elige al menos un día."; return repintarAjustes(); }
      q.cargando = true; q.error = null; repintarAjustes();
      try {
        // Sin franja: el servidor barre el día entero y ordena por gente libre.
        q.resultados = await api.libres(S.slug, {
          dias: q.dias.join(","), duracion: q.duracion, paso: q.paso,
        });
      } catch (err) {
        q.error = err.message; q.resultados = null;
      }
      q.cargando = false;
      repintarAjustes();
    },
  },
    el("div", { className: "campo" },
      el("span", { className: "rot", textContent: "Días" }),
      el("div", { className: "chips" }, ...DAYS.map((d, n) => el("button", {
        type: "button", className: `chip${q.dias.includes(n) ? " on" : ""}`,
        textContent: d.slice(0, 3), ariaPressed: String(q.dias.includes(n)),
        ariaLabel: d, onclick: () => marcar(n),
      })))),
    el("div", { className: "campo" },
      el("span", { className: "rot", textContent: "Hueco de" }),
      el("div", { className: "linea" }, num("duracion", DURACIONES), "libres cada", num("paso", PASOS))),
    el("button", {
      className: "btn btn-primary", type: "submit",
      textContent: q.cargando ? "Buscando…" : "Buscar quién está libre",
    })));

  if (q.error) out.push(el("div", { className: "note err", textContent: q.error }));
  if (q.cargando) return out;

  if (q.resultados === null) {
    out.push(el("p", { className: "hint", textContent:
      "Elige los días y cuánto tiene que durar el hueco. Salen primero los tramos con más gente libre." }));
    return out;
  }
  if (!q.resultados.length) {
    out.push(el("div", { className: "empty" },
      el("strong", { textContent: "No hay ningún hueco con esa duración" }),
      `En los días pedidos nadie se libra ${q.duracion} minutos seguidos. Prueba con menos minutos o con más días.`));
    return out;
  }

  out.push(el("p", { className: "hint", textContent:
    `${q.resultados.length} ${q.resultados.length === 1 ? "tramo" : "tramos"}, de mejor a peor.` }));
  out.push(...q.resultados.slice(0, 25).map((h) => el("section", { className: "card hueco" },
    el("div", { className: "hueco-cab" },
      el("b", { textContent: `${DAYS[h.day]} ${fmtRange(h.start, h.end)}` }),
      el("span", { className: "hueco-n", textContent: `${h.libres} de ${h.total} libres` })),
    // Quién puede venir, que es lo que se busca; el que no puede, aparte.
    h.libres
      ? el("div", { className: "chips" },
        ...h.disponibles.map((n) => el("span", { className: "chip ok", textContent: n })))
      : el("p", { className: "hint", textContent: "No se libra nadie el tramo entero." }),
    h.ocupados.length
      ? el("details", { className: "fuera" },
        el("summary", { textContent: `No pueden: ${h.ocupados.length}` }),
        el("div", { className: "chips" },
          ...h.ocupados.map((n) => el("span", { className: "chip fuera", textContent: n }))))
      : null)));
  return out;
}

/** Quién más ha salido, contando ventas y actividades con hora por separado. */
function viewActivos() {
  if (S.ruletaError) return [el("div", { className: "note err", textContent: S.ruletaError })];
  if (!S.ruleta) return [el("p", { className: "hint", textContent: "Cargando…" })];

  const personas = [...S.ruleta.personas].sort((a, b) =>
    b.total - a.total || b.ventas - a.ventas || b.horario - a.horario || a.name.localeCompare(b.name, "es"));
  const conGente = personas.filter((p) => p.total > 0);
  const total = conGente.reduce((n, p) => n + p.total, 0);
  const out = [];

  if (!conGente.length) {
    out.push(el("div", { className: "empty" },
      el("strong", { textContent: "Todavía nadie ha salido" }),
      isAdmin() ? "Gira la ruleta desde la pestaña Ruleta y aquí irá saliendo el who's who."
        : "Cuando empiece a haber actividades, aquí aparecerá quién más ha salido."));
    return out;
  }

  out.push(el("p", { className: "hint", textContent:
    `${total} ${total === 1 ? "salida" : "salidas"} de ${conGente.length} ${conGente.length === 1 ? "persona" : "personas"}.` }));
  out.push(el("ol", { className: "rank" }, ...conGente.map((p, i) => el("li", { className: "rank-fila" },
    el("span", { className: "rank-n", textContent: String(i + 1) }),
    el("span", { className: "rank-who" },
      el("b", { textContent: p.name }),
      el("span", { className: "rank-det" },
        `${p.ventas} ${p.ventas === 1 ? "venta" : "ventas"}`,
        " · ",
        `${p.horario} ${p.horario === 1 ? "actividad" : "actividades"}`)),
    p.strikes ? el("span", { className: "strikes", textContent: `⚑ ${p.strikes}` }) : null,
    el("b", { className: "rank-t", textContent: String(p.total) })))));

  const sinSalir = personas.filter((p) => !p.total);
  if (sinSalir.length) {
    out.push(el("p", { className: "hint", textContent:
      `Todavía no ha salido: ${sinSalir.map((p) => p.name).join(", ")}.` }));
  }
  return out;
}

// --- ruleta -----------------------------------------------------------------

/** Las tres secciones, llevadas al panel de Ajustes. */
function libresView() { appendTodo(settingsBody(), viewLibres()); }
function activosView() { appendTodo(settingsBody(), viewActivos()); }
function ruletaView() { appendTodo(settingsBody(), viewRuleta()); }

/** append() pondría "null" en el texto si alguna vista devuelve un hueco vacío. */
function appendTodo(box, nodos) {
  return box.append(...nodos.filter((n) => n != null && n !== false));
}

let ruletaPeticion = null;   // agrupación que se está pidiendo, para no duplicar

async function cargarRuleta({ force = false } = {}) {
  const slug = S.slug;
  if (!slug) return;
  if (force) ruletaPeticion = null;
  else if (ruletaPeticion === slug) return;
  ruletaPeticion = slug;
  try {
    const datos = await api.ruleta(slug);
    if (slug !== S.slug) return;         // mientras cargaba, se cambió de agrupación
    S.ruleta = datos;
    S.ruletaError = null;
  } catch (err) {
    if (slug !== S.slug) return;
    S.ruleta = null;
    S.ruletaError = err.message;
  }
  // Los datos se ven dentro del sidebar de Ajustes, así que quien hay que
  // redibujar es el panel; la página de detrás solo si el panel está cerrado.
  if (panel.classList.contains("on")) repintarAjustes();
  else render();
}

function viewRuleta() {
  if (!isAdmin()) {
    return [el("div", { className: "empty" },
      el("strong", { textContent: "La ruleta es de quienes administran" }),
      "Se puede mirar el who's who en Más activos.")];
  }
  if (S.ruletaError) return [el("div", { className: "note err", textContent: S.ruletaError })];
  if (!S.ruleta) return [el("p", { className: "hint", textContent: "Cargando…" })];

  const tarjetas = S.ruleta.actividades
    .filter((a) => S.editando !== a.id)
    .map((a) => tarjetaActividad(a));
  const editando = S.ruleta.actividades.find((a) => a.id === S.editando);
  return [
    editando ? formActividad(editando) : formActividad(),
    ...tarjetas,
    padronStrikes(),
  ];
}

/** Formulario de alta y de edición, el mismo para las dos cosas.

 * Una venta da igual el horario (es gente que está ahí todo el día) y puede
 * ocupar varios días. Una actividad tiene un día exacto y una franja: solo
 * puede salir quien esté libre entonces, que es la razón de tener los horarios
 * en la misma aplicación. `cuántas` es cuántas manos hacen falta de una vez.
 */
function formActividad(act = null) {
  // El borrador se guarda en el estado y no en esta función: cambiar el tipo de
  // actividad repinta el formulario, y si el texto viviera aquí se borraría.
  if (!S.borrador || S.borrador.id !== (act?.id ?? null)) {
    S.borrador = {
      id: act?.id ?? null,
      nombre: act?.nombre || "",
      modo: act?.modo || "ventas",
      dias: [...(act?.dias || [todayIndex()])],
      inicio: act?.modo === "horario" ? hhmm(act.inicio) : "18:00",
      fin: act?.modo === "horario" ? hhmm(act.fin) : "20:00",
      cuantas: act?.cuantas || 1,
    };
  }
  const c = S.borrador;
  const aviso = el("div");

  const chipDia = (n) => el("button", {
    type: "button", className: `chip${c.dias.includes(n) ? " on" : ""}`,
    textContent: DAYS[n].slice(0, 3), ariaPressed: String(c.dias.includes(n)),
    ariaLabel: DAYS[n],
    onclick: () => {
      if (c.modo === "horario") c.dias = [n];          // con hora fija, un solo día
      else c.dias = c.dias.includes(n) ? c.dias.filter((x) => x !== n) : [...c.dias, n].sort();
      repintarAjustes();
    },
  });

  const tipo = el("select", {
    ariaLabel: "Tipo de actividad",
    onchange: (e) => {
      c.modo = e.target.value;
      if (c.modo === "horario") c.dias = [c.dias[0] ?? todayIndex()];   // solo uno
      repintarAjustes();
    },
  },
    el("option", { value: "ventas", textContent: "Venta (todo el día)", selected: c.modo === "ventas" }),
    el("option", { value: "horario", textContent: "Actividad", selected: c.modo === "horario" }));

  const num = (min, max) => el("input", {
    type: "number", min: String(min), max: String(max), value: String(c.cuantas),
    ariaLabel: "Cuántas personas",
    oninput: (e) => { c.cuantas = Number(e.target.value); },
  });

  return el("form", {
    className: "card panel-form",
    onsubmit: async (e) => {
      e.preventDefault();
      if (!c.dias.length) {
        clear(aviso).append(el("div", { className: "note err", textContent: "Elige al menos un día." }));
        return;
      }
      const envio = {
        nombre: c.nombre.trim(), modo: c.modo, dias: c.dias,
        inicio: c.inicio, fin: c.fin, cuantas: c.cuantas,
      };
      try {
        if (act) await api.editarActividad(S.slug, act.id, envio);
        else await api.crearActividad(S.slug, envio);
        S.editando = null;
        S.borrador = null;      // la siguiente empieza en blanco
        S.ultimo = null;
        await cargarRuleta({ force: true });
      } catch (err) {
        clear(aviso).append(el("div", { className: "note err", textContent: err.message }));
      }
    },
  },
    el("h2", { textContent: act ? `Editar ${act.nombre}` : "Nueva actividad" }),
    el("div", { className: "campo" },
      el("span", { className: "rot", textContent: "Cómo es" }), tipo),
    el("div", { className: "campo" },
      el("span", { className: "rot", textContent: "Nombre" }),
      el("input", {
        type: "text", placeholder: "Venta del viernes", ariaLabel: "Nombre de la actividad", required: true,
        value: c.nombre,
        oninput: (e) => { c.nombre = e.target.value; },
      })),
    el("div", { className: "campo" },
      el("span", { className: "rot", textContent: c.modo === "ventas" ? "Días" : "Día" }),
      el("div", { className: "chips" }, ...DAYS.map((d, n) => chipDia(n)))),
    c.modo === "horario"
      ? el("div", { className: "campo" },
        el("span", { className: "rot", textContent: "De qué hora" }),
        el("div", { className: "linea" },
          el("input", {
            type: "time", value: c.inicio, ariaLabel: "Empieza",
            onchange: (e) => { c.inicio = e.target.value; },
          }),
          el("span", { textContent: "a" }),
          el("input", {
            type: "time", value: c.fin, ariaLabel: "Acaba",
            onchange: (e) => { c.fin = e.target.value; },
          })))
      : null,
    el("div", { className: "campo" },
      el("span", { className: "rot", textContent: "Personas" }),
      el("div", { className: "linea" }, num(1, S.ruleta?.cuantas_max || 6),
        "a la vez, sin repetir")),
    aviso,
    el("div", { className: "linea" },
      el("button", { className: "btn btn-primary", type: "submit", textContent: act ? "Guardar" : "Crear" }),
      act
        ? el("button", {
          className: "btn", type: "button", textContent: "Cancelar",
          onclick: () => { S.editando = null; S.borrador = null; repintarAjustes(); },
        })
        : null));
}

function tarjetaActividad(a) {
  const participo = (name, participa) => api.participacion(S.slug, a.id, name, participa)
    .then(() => { S.ultimo = null; return cargarRuleta({ force: true }); })
    .catch((err) => alert(err.message));

  const cuando = a.dias.length
    ? a.dias.map((d) => DAYS[d].slice(0, 3)).join(", ")
    : "sin día";

  return el("section", { className: "card act" },
    el("div", { className: "act-cab" },
      el("b", { textContent: a.nombre }),
      el("span", { className: "tag", textContent: cuando }),
      el("span", { className: "tag", textContent: a.modo === "ventas" ? "todo el día" : fmtRange(a.inicio, a.fin) }),
      el("span", { className: "tag", textContent: `${a.cuantas} ${a.cuantas === 1 ? "persona" : "personas"}` }),
      el("span", { className: "spacer" }),
      el("button", {
        className: "btn btn-primary", type: "button",
        textContent: S.girando === a.id ? "Girando…" : "Girar",
        disabled: S.girando != null,
        onclick: () => girar(a),
      }),
      el("button", {
        className: "btn", type: "button", textContent: "✎", ariaLabel: `Editar ${a.nombre}`,
        onclick: () => {
          S.editando = a.id;
          S.borrador = null;    // se rellena con los datos de esa actividad
          S.ultimo = null;
          repintarAjustes();
        },
      }),
      el("button", {
        className: "btn btn-danger", type: "button", textContent: "×",
        ariaLabel: `Eliminar ${a.nombre}`,
        onclick: async () => {
          if (!confirm(`¿Eliminar «${a.nombre}» y su conteo?`)) return;
          await api.borrarActividad(S.slug, a.id);
          if (S.editando === a.id) S.borrador = null;
          S.editando = null;
          S.ultimo = null;
          cargarRuleta({ force: true });
        },
      })),
    a.participantes.length
      ? el("div", { className: "chips" }, ...a.participantes.map((n) => el("span", { className: "chip on" },
        n,
        el("button", {
          type: "button", className: "x", textContent: "×", ariaLabel: `Quitar a ${n}`,
          onclick: () => participo(n, false),
        }))))
      : el("p", { className: "hint", textContent: "Todavía no ha salido nadie." }),
    S.ultimo?.id === a.id ? resultadoSorteo(S.ultimo) : null);
}

/** Gira la ruleta. El sorteo lo decide el servidor y llega ya hecho: aquí solo
 *  se enseña, parando la rueda en quien salió. Si el sistema pide menos
 *  movimiento, sale el resultado sin girar. */
async function girar(a) {
  S.girando = a.id;
  const capa = abrirSorteo(a);
  capa.rueda.arrancar();          // empieza a girar antes de que conteste el servidor
  let r;
  try {
    // Sin mandar cuántas: se usan las que pide la actividad, que es lo escrito.
    r = await api.girar(S.slug, a.id, {});
  } catch (err) {
    S.girando = null;
    cerrarSorteo();
    return alert(err.message);
  }
  await capa.rueda.aterrizar(r);  // se para con el ganador bajo el puntero
  // Un momento de parada: la rueda ya está quieta y aún está en pantalla.
  await new Promise((listo) => setTimeout(listo, sinMovimiento() ? 0 : 900));
  const nombres = salidaSorteo(r);
  capa.salida.replaceWith(nombres);
  capa.rueda.desvanecer();
  capa.boton.hidden = false;      // ya se puede cerrar
  capa.boton.focus();
  S.girando = null;
  S.ultimo = { id: a.id, ...r };
  // El reparto ya está en el servidor (por eso salvan las Participation). Al
  // volver, quien sale deja de estar en el bombo y su strike se queda a cero.
  await cargarRuleta({ force: true });
  repintarAjustes();
}

const NS = "http://www.w3.org/2000/svg";
const nodoSvg = (tag, attrs, texto) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (texto) n.textContent = texto;
  return n;
};
const sinMovimiento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** El bombo, con un sector por persona. **Sin nombres dentro**: en la mitad de
 *  abajo quedarían del revés y con mucha gente no caben. Los nombres se leen en
 *  la lista de debajo, todos del mismo tamaño y derechos, y el sector que está
 *  bajo el puntero se resalta. `data-centro` guarda el ángulo del centro del
 *  sector ya con el origen en el puntero (arriba), que es lo que hace falta
 *  para parar encima. */
function rueda(pool) {
  const n = pool.length;
  const R = 100, C = 110, rint = 42;
  const svg = nodoSvg("svg", {
    viewBox: "0 0 220 220", class: "rueda", role: "img",
    "aria-label": `Ruleta con ${n} ${n === 1 ? "persona" : "personas"} del bombo`,
  });
  const g = nodoSvg("g", { class: "rueda-giro" });
  g.style.transformOrigin = `${C}px ${C}px`;
  const ancho = 360 / n;
  const rad = (x) => (x * Math.PI) / 180;
  pool.forEach((p, i) => {
    // El primer sector arranca en el puntero, arriba, y no a la derecha.
    const desde = i * ancho - 90, hasta = desde + ancho;
    const x0 = C + R * Math.cos(rad(desde)), y0 = C + R * Math.sin(rad(desde));
    const x1 = C + R * Math.cos(rad(hasta)), y1 = C + R * Math.sin(rad(hasta));
    const d = `M ${C} ${C} L ${x0.toFixed(2)} ${y0.toFixed(2)}`
      + ` A ${R} ${R} 0 ${ancho > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
    g.append(nodoSvg("path", {
      d, fill: i % 2 ? "var(--accent-soft)" : "var(--card)",
      stroke: "var(--card)", "stroke-width": 1.5,
      "data-nombre": p.name,
      "data-centro": String(desde + ancho / 2),
    }));
  });
  svg.append(g,
    nodoSvg("circle", { cx: C, cy: C, r: R, fill: "none", stroke: "var(--line)", "stroke-width": 1.5 }),
    nodoSvg("circle", { cx: C, cy: C, r: rint, fill: "var(--card)", stroke: "var(--line)", "stroke-width": 1.5 }));
  return svg;
}

/** La rueda con su lista y su animación: se pone a girar antes de que conteste
 *  el servidor, va marcando lo que va pasando por el puntero y para encima de
 *  quien salió. */
function rodar(pool) {
  const n = pool.length;
  const ancho = 360 / n;
  const marco = el("div", { className: "rueda-marco" });
  const hub = el("div", { className: "rueda-hub" }, el("span", { className: "rueda-hub-n", textContent: "Girando…" }));
  const svg = rueda(pool);
  marco.append(svg, el("span", { className: "rueda-flecha" }), hub);
  const g = svg.querySelector(".rueda-giro");
  const sector = (i) => g.querySelector(`path[data-nombre="${CSS.escape(pool[i % n].name)}"]`);
  const lista = el("div", { className: "rueda-bombo" },
    ...pool.map((p) => el("span", { className: "chip bomba", "data-nombre": p.name }, p.name)));

  let actual = null;
  const api = {
    actual: null,
    nodo: el("div", { className: "ruleta-caja girando" }, marco,
      el("p", { className: "rueda-pie", textContent: "Girando…" }),
      lista),
    /** El nombre que está bajo el puntero: el del sector resaltado, el del medio
     *  y el de la lista. Los tres cuentan lo mismo. */
    marcar(i) {
      const nombre = pool[((i % n) + n) % n]?.name;
      if (nombre === actual) return;
      actual = nombre;
      g.querySelectorAll("path[data-nombre]").forEach((s) =>
        s.classList.toggle("bajo", s.dataset.nombre === nombre));
      lista.querySelectorAll(".chip").forEach((c) =>
        c.classList.toggle("bajo", c.dataset.nombre === nombre));
      hub.firstElementChild.textContent = nombre || "";
    },
    /** El movimiento de partida: sin transición, a un ángulo cualquiera, y con
     *  un par de vueltas de mentira para que se vea pasar gente mientras el
     *  servidor contesta. */
    arrancar() {
      api.nodo.classList.add("girando");
      g.style.transition = "none";
      g.style.transform = "rotate(-97deg)";
      // Sin esto el navegador no llega a pintar el ángulo inicial y no anima
      // nada: la transición necesita un valor anterior que pueda interpolar.
      void g.getBoundingClientRect();
      let falsa = 0;
      api.tocando = requestAnimationFrame(function prever() {
        if (!api.tocando) return;
        falsa += 23;
        api.marcar(Math.floor(((-falsa) / ancho)));   // el mismo cálculo de abajo
        api.tocando = requestAnimationFrame(prever);
      });
    },
    /** Las vueltas de verdad y el alto encima del ganador. El puntero está a
     *  -90°, así que el centro del sector tiene que acabar ahí. */
    aterrizar(r) {
      const elegida = r.elegidos[0];
      const i = pool.findIndex((p) => p.name === elegida?.name);
      if (i < 0) return Promise.resolve();
      const destino = -90 - Number(sector(i).dataset.centro);
      const vueltas = sinMovimiento() ? 0 : 6 + Math.floor(Math.random() * 3);
      const total = 360 * vueltas + destino;
      const salida = Number((g.style.transform.match(/-?[\d.]+/) || [0])[0]) || 0;
      void g.getBoundingClientRect();
      g.style.transition = sinMovimiento() ? "none" : "transform 4.2s cubic-bezier(.11, .78, .12, 1)";
      g.style.transform = `rotate(${total}deg)`;
      // Mientras dura el frenado se va viendo el sector que pasa por el
      // puntero, que es la gracia de una ruleta de verdad.
      const fin = sinMovimiento() ? Date.now() : Date.now() + 4400;
      const ver = () => {
        const a = g.getAnimations?.()[0];
        const p = a?.effect.getComputedTiming().progress;
        const ang = p == null ? total : salida + (total - salida) * p;
        api.marcar(Math.floor(-ang / ancho));
        if (Date.now() < fin) api.tocando = requestAnimationFrame(ver);
        else api.marcar(i);
      };
      ver();
      api.nodo.classList.remove("girando");
      const pie = api.nodo.querySelector(".rueda-pie");
      if (pie) pie.textContent = `${r.elegidos.length} ${r.elegidos.length === 1 ? "persona" : "personas"}`;
      if (sinMovimiento()) { api.tocando = 0; return Promise.resolve(); }
      return new Promise((listo) => {
        // Los sectores también tienen transición de relleno, y esa sube hasta
        // aquí: sin mirar la propiedad, saltaba la rueda a la primera.
        g.addEventListener("transitionend", (e) => {
          if (e.target === g && e.propertyName === "transform") listo();
        });
        setTimeout(() => { api.tocando = 0; listo(); }, 4700);
      });
    },
    /** Ya está: la rueda se va y solo quedan los nombres. */
    desvanecer() {
      api.tocando = 0;
      const n = api.nodo;
      n.classList.add("saliendo");
      setTimeout(() => n.remove(), sinMovimiento() ? 0 : 480);
    },
  };
  return api;
}

/** Los nombres, ya parado el reparto. */
function salidaSorteo(r) {
  const cuantos = r.elegidos.length;
  return el("div", { className: "sorteo-salida" },
    el("p", { className: "sorteo-quien" },
      el("b", { textContent: r.elegidos[0]?.name || "nadie" }),
      cuantos > 1
        ? el("span", { textContent: ` y ${r.elegidos.slice(1).map((e) => e.name).join(", ")}` })
        : null,
      el("span", { textContent: cuantos > 1 ? " salen esta vez." : " sale esta vez." })),
    r.descansan?.length
      ? el("p", { className: "hint", textContent: `Descansan: ${r.descansan.join(", ")}.` })
      : null,
    r.ocupados?.length
      ? el("p", { className: "hint", textContent: `Con el turno no pueden: ${r.ocupados.join(", ")}.` })
      : null);
}

// --- la capa a pantalla completa -------------------------------------------

let capaSorteo = null;      // el nodo abierto, el botón que lo abrió y su tecla
let teclaSorteo = null;

/** El sorteo se hace a pantalla completa, con el fondo difuminado: es un
 *  momento de la vida de la agrupación y se ve de lejos. */
function abrirSorteo(a) {
  const antes = document.activeElement;
  const ruedaGirando = rodar(a.pool || []);
  const salida = el("div", { className: "sorteo-salida" });
  // Mientras gira no se puede cerrar: el reparto ya está hecho y a medias se
  // queda sin mostrar. El botón aparece con los nombres.
  const cerrar = el("button", {
    className: "btn", type: "button", textContent: "Listo", hidden: true,
    onclick: () => cerrarSorteo(),
  });
  const caja = el("div", { className: "sorteo-caja", role: "dialog", "aria-modal": "true",
    "aria-label": `Sorteo de ${a.nombre}` },
    el("div", { className: "sorteo-cab" },
      el("b", { textContent: a.nombre }),
      el("span", { className: "tag", textContent: a.modo === "ventas" ? "todo el día" : fmtRange(a.inicio, a.fin) }),
      el("span", { className: "tag", textContent: `${a.cuantas} ${a.cuantas === 1 ? "persona" : "personas"}` })),
    ruedaGirando.nodo,
    salida,
    el("div", { className: "sorteo-pie" }, cerrar));
  const capa = el("div", { className: "sorteo-fondo" },
    el("div", { className: "sorteo-tap", onclick: () => cerrarSorteo() }), caja);
  document.body.append(capa);
  document.body.classList.add("con-sorteo");
  capaSorteo = { capa, antes };
  teclaSorteo = (e) => { if (e.key === "Escape") cerrarSorteo(); };
  document.addEventListener("keydown", teclaSorteo);
  requestAnimationFrame(() => capa.classList.add("abierta"));
  return { rueda: ruedaGirando, salida, boton: cerrar };
}

function cerrarSorteo() {
  if (!capaSorteo || S.girando) return;   // girando, la capa no se cierra
  const { capa, antes } = capaSorteo;
  capaSorteo = null;
  if (teclaSorteo) document.removeEventListener("keydown", teclaSorteo);
  teclaSorteo = null;
  document.body.classList.remove("con-sorteo");
  capa.classList.remove("abierta");
  capa.addEventListener("transitionend", () => capa.remove(), { once: true });
  setTimeout(() => capa.remove(), 600);
  antes?.focus?.();
}

/** La tarjeta se queda con el reparto y con un botón para volver a girar. */
function resultadoSorteo(r) {
  const act = S.ruleta.actividades.find((a) => a.id === r.id);
  return el("div", { className: "sorteo" },
    salidaSorteo(r),
    act ? el("button", {
      className: "btn", type: "button", textContent: "Girar otra vez",
      onclick: () => girar(act),
    }) : null);
}

/** El padrón con las strikes: el +1 y el −1 de cada uno, que es lo único que se
 *  toca a mano. Quien más tiene, más peso sale. */
function padronStrikes() {
  return el("section", { className: "card" },
    el("h2", { textContent: "Strikes" }),
    el("p", { className: "hint", textContent: "Cada strike pesa más en la ruleta. Van a cero por sí solas cuando alguien sale." }),
    el("ul", { className: "rows" }, ...S.ruleta.personas.map((p) => el("li", {},
      el("span", { className: "who-n" },
        el("b", { textContent: p.name }),
        el("span", { textContent: p.total ? `${p.total} salidas · peso ${p.peso}` : `peso ${p.peso}` }),
        p.detalle ? el("span", { className: "room", textContent: p.detalle }) : null),
      el("button", {
        className: "btn", type: "button", textContent: "−", ariaLabel: `Quitar una strike a ${p.name}`,
        disabled: !p.strikes,
        onclick: async () => {
          await api.strike(S.slug, p.name, -1).catch((e) => alert(e.message));
          cargarRuleta({ force: true });
        },
      }),
      el("b", { className: "strike-n", textContent: String(p.strikes) }),
      el("button", {
        className: "btn", type: "button", textContent: "+", ariaLabel: `Poner una strike a ${p.name}`,
        onclick: async () => {
          const detalle = S.girando ? "" : (prompt(`¿Por qué? (opcional)`, p.detalle || "") ?? "");
          if (detalle === null) return;
          await api.strike(S.slug, p.name, 1, detalle).catch((e) => alert(e.message));
          cargarRuleta({ force: true });
        },
      })))));
}

/** Rejilla semanal de lunes a viernes, como la tabla del horario impreso. */
function weekGrid() {
  const DIAS = [0, 1, 2, 3, 4];                       // sábado y domingo quedan fuera
  const segs = DIAS.flatMap((d) => S.week[d]?.segments || []);
  if (!segs.length) {
    return el("div", { className: "empty" },
      el("strong", { textContent: "Nadie está ocupado de lunes a viernes" }),
      "Toda la semana está libre para reunirse.");
  }

  const from = Math.floor(Math.min(...segs.map((s) => s.start)) / 60) * 60;
  const to = Math.ceil(Math.max(...segs.map((s) => s.end)) / 60) * 60;
  // El alto por hora vive en la variable CSS --pph: se pone una estimación y
  // ajustarRejilla() la corrige midiendo el hueco real, sin volver a dibujar.
  const cuantasHoras = (to - from) / 60;
  const alto = `calc(var(--pph) * ${cuantasHoras})`;
  const y = (min) => `calc(var(--pph) * ${(min - from) / 60})`;

  const grid = el("div", { className: "week-grid" });
  grid.append(el("div", { className: "week-head" }));
  DIAS.forEach((d) => grid.append(el("div", {
    className: d === todayIndex() ? "week-head today" : "week-head",
    textContent: DAYS[d],
  })));

  const horas = el("div", { className: "hours" });
  horas.style.height = alto;
  for (let h = from / 60; h <= to / 60; h++) {
    const marca = el("b", { textContent: hourLabel(h) });
    marca.style.top = y(h * 60);
    horas.append(marca);
  }
  grid.append(horas);

  DIAS.forEach((d) => {
    const col = el("div", { className: "daycol" });
    col.style.height = alto;
    (S.week[d]?.segments || []).forEach((seg, idx) => {
      const duracion = (seg.end - seg.start) / 60;     // en horas
      const todosTrabajan = seg.working.length === seg.people.length;
      const b = el("button", {
        type: "button",
        className: todosTrabajan ? "wblock work" : "wblock",
        title: `${DAYS[d]} ${fmtRange(seg.start, seg.end)}\n${seg.people.join(", ")}`,
        // Al tocarlo, abre ese día y deja señalado ese tramo, no solo el día.
        onclick: () => {
          S.view = "dia";
          S.day = d;
          render();
          requestAnimationFrame(() => focusSegment(idx));
        },
      }, el("b", { textContent: `${seg.people.length}` }));
      // Cuántos y quiénes, seguido en la misma línea. Los nombres solo cuando el
      // bloque da de sí: en uno muy corto no cabría ni el número.
      if (duracion >= 0.35) {
        b.append(el("span", {
          textContent: ` · ${seg.people.length <= 4
            ? seg.people.join(", ")
            : `${seg.people.slice(0, 3).join(", ")} y ${seg.people.length - 3} más`}`,
        }));
      }
      b.style.top = y(seg.start);
      b.style.height = `max(14px, calc(var(--pph) * ${duracion} - 2px))`;
      col.append(b);
    });
    if (d === todayIndex()) {
      const ahora = minutesNow();
      if (ahora >= from && ahora <= to) {
        const linea = el("div", { className: "wnow" });
        linea.style.top = y(ahora);
        col.append(linea);
      }
    }
    grid.append(col);
  });

  const finde = [5, 6].filter((d) => (S.week[d]?.segments || []).length);
  const hayTrabajo = segs.some((sg) => sg.working.length);
  const cabecera = el("div", { className: "track-head" },
    el("h2", { textContent: `Lunes a viernes · ${fmt(from)} a ${fmt(to)}` }),
    el("div", { className: "legend" },
      el("i", {}, "ocupado"),
      hayTrabajo ? el("i", { className: "w" }, "trabajando") : null,
      el("i", { className: "empty-key" }, "libre")));

  const seccion = el("section", { className: "week" }, cabecera, grid,
    finde.length
      ? el("p", { className: "weekend-note" },
        `Hay gente ocupada también el ${finde.map((d) => DAYS[d].toLowerCase()).join(" y el ")}. `,
        el("button", {
          className: "link", type: "button", textContent: "Verlo por día",
          onclick: () => { S.view = "dia"; S.day = finde[0]; render(); },
        }))
      : null);
  seccion.style.setProperty("--pph", "56px");   // estimación; se ajusta al medir
  seccion.dataset.horas = String(cuantasHoras);
  return seccion;
}

/** Estira la rejilla hasta el borde de la ventana, midiendo dónde empieza. */
function ajustarRejilla() {
  const week = document.querySelector(".week");
  const col = week?.querySelector(".daycol");
  if (!col) return;
  const horas = Number(week.dataset.horas);
  const limita = (px) => Math.max(38, Math.min(110, px / horas));
  const poner = (pph) => week.style.setProperty("--pph", `${pph.toFixed(1)}px`);

  const disponible = window.innerHeight - col.getBoundingClientRect().top - 16;
  poner(limita(disponible));
  // Segunda pasada: descuenta lo que quede fuera (márgenes, nota de fin de semana).
  const sobra = document.documentElement.scrollHeight - window.innerHeight;
  if (sobra > 1) poner(limita(disponible - sobra));
}

function dayTabs() {
  return el("div", { className: "days", role: "tablist", ariaLabel: "Día de la semana" },
    ...DAYS.map((name, i) => {
      const n = S.week[i]?.segments.length || 0;
      return el("button", {
        type: "button", role: "tab", ariaSelected: String(i === S.day),
        onclick: () => { S.day = i; render(); },
      }, name, n ? el("span", { className: "n", textContent: String(n) }) : null);
    }));
}

// --- pista del día: ocupación y, sobre todo, los huecos libres ------------

function track(segments) {
  const from = Math.floor(Math.min(...segments.map((s) => s.start)) / 60) * 60;
  const to = Math.ceil(Math.max(...segments.map((s) => s.end)) / 60) * 60;
  const span = Math.max(to - from, 60);
  const pct = (m) => ((m - from) / span) * 100;
  const max = Math.max(...segments.map((s) => s.people.length));

  const rule = el("div", { className: "rule" });
  const lastHour = to / 60;
  for (let h = from / 60; h <= lastHour; h++) {
    const tick = el("div", {
      className: h === lastHour ? "tick last" : "tick",
    }, el("b", { textContent: hourLabel(h) }));
    tick.style.left = `${pct(h * 60)}%`;
    rule.append(tick);
  }

  const bars = el("div", { className: "bars" });
  segments.forEach((s, i) => {
    const count = s.people.length;
    const width = Math.max(pct(s.end) - pct(s.start), 1.2);
    const bar = el("button", {
      type: "button",
      className: "bar",
      title: `${fmtRange(s.start, s.end)} · ${people(count)}`,
      onclick: () => focusSegment(i),
    }, width > 3 ? el("b", { textContent: String(count) }) : null);  // en barras finas no cabe
    bar.style.left = `${pct(s.start)}%`;
    bar.style.width = `${width}%`;
    // La altura codifica cuánta gente está ocupada; el color se mantiene sólido
    // para que el número encima siga legible. En px, para no invadir el carril
    // superior donde van las etiquetas de los huecos.
    bar.style.height = `${16 + 24 * (count / max)}px`;
    bar.style.animationDelay = `${i * 40}ms`;
    bars.append(bar);
  });

  // Los huecos son el dato que se busca: se etiquetan igual que las clases.
  segments.forEach((s, i) => {
    const next = segments[i + 1];
    if (!next || next.start - s.end < 20) return;
    const gap = el("div", { className: "gap" },
      el("b", { textContent: `${Math.round((next.start - s.end) / 5) * 5} min libres` }));
    gap.style.left = `${pct(s.end)}%`;
    gap.style.width = `${pct(next.start) - pct(s.end)}%`;
    bars.append(gap);
  });

  if (S.day === todayIndex()) {
    const now = minutesNow();
    if (now >= from && now <= to) {
      const line = el("div", { className: "now" });
      line.style.left = `${pct(now)}%`;
      bars.append(line);
    }
  }

  return el("section", { className: "track" },
    el("div", { className: "track-head" },
      el("h2", { textContent: `${DAYS[S.day]} · ${fmt(from)} a ${fmt(to)}` }),
      el("div", { className: "legend" },
        el("i", {}, "en clase"),
        el("i", { className: "free" }, "hueco libre"))),
    rule, bars);
}

function focusSegment(i) {
  const row = document.getElementById(`seg-${i}`);
  if (!row) return;
  document.querySelectorAll(".seg.on").forEach((n) => n.classList.remove("on"));
  row.classList.add("on");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
}

function segmentRow(s, i) {
  const row = el("article", { className: "seg", id: `seg-${i}` },
    el("div", { className: "when" }, fmtRange(s.start, s.end),
      el("span", { className: "count", textContent: people(s.people.length) })),
    el("div", { className: "who" }, ...s.people.map((n) => chip(n, s.working.includes(n)))));
  row.style.animationDelay = `${Math.min(i, 8) * 30}ms`;
  return row;
}

function chip(name, working = false) {
  return el("button", {
    className: working ? "chip work" : "chip", type: "button",
    title: working ? `${name} está trabajando` : name,
    onclick: () => openPerson(name),
  }, highlight(name, S.query));
}

function searchResults() {
  const q = norm(S.query.trim());
  const out = [];
  const hits = S.roster.filter((p) => norm(p.name).includes(q));
  if (!hits.length) {
    return [el("div", { className: "empty" },
      el("strong", { textContent: `Nadie se llama así` }),
      `Ninguna persona de la agrupación coincide con «${S.query.trim()}».`)];
  }
  out.push(el("div", { className: "who", style: "margin-bottom:18px" }, ...hits.map((p) => chip(p.name))));
  S.week.forEach((d) => {
    const segs = d.segments.filter((s) => s.people.some((n) => norm(n).includes(q)));
    if (!segs.length) return;
    out.push(el("h2", { className: "day-title", textContent: DAYS[d.day] }));
    segs.forEach((s) => out.push(el("article", { className: "seg" },
      el("div", { className: "when" }, fmtRange(s.start, s.end),
        el("span", { className: "count", textContent: people(s.people.length) })),
      el("div", { className: "who" },
        ...s.people.map((n) => chip(n, s.working.includes(n)))))));
  });
  return out;
}

// --- subida ---------------------------------------------------------------

/** El botón de subir, al final de la barra de vistas. Sigue aceptando soltar
 *  archivos encima, que es como se subían antes. */
function dropzone() {
  // sr-only y no `hidden`: así el campo sigue recibiendo el foco del teclado.
  const input = el("input", {
    type: "file", accept: ".pdf,application/pdf,image/*", multiple: true, className: "sr-only",
  });
  const zone = el("label", {
    className: "drop",
    title: "Suelta aquí los PDF o las imágenes. El nombre del archivo es el nombre de la persona.",
  },
    el("span", { className: "drop-t", textContent: "Subir PDF" }),
    input);

  input.addEventListener("change", () => { const f = [...input.files]; input.value = ""; upload(f); });
  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", (e) => upload([...e.dataTransfer.files]));
  return zone;
}

const esImagen = (f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);

async function upload(files) {
  if (!files.length) return;
  const imagenes = files.filter(esImagen);
  files = files.filter((f) => !esImagen(f));
  // Las imágenes no se guardan directamente: se leen y se revisan antes.
  if (imagenes.length) {
    if (files.length) await upload(files);
    return revisarImagen(imagenes[0], imagenes.slice(1));
  }
  const results = [];
  // Un archivo por petición: Vercel limita el tamaño de cada una y así un
  // archivo roto no se lleva por delante a los demás.
  for (const [i, file] of files.entries()) {
    S.report = { progress: `Leyendo ${i + 1} de ${files.length}: ${file.name}` };
    render();
    try {
      const data = await api.upload(S.slug, file);
      results.push(...data.results);
    } catch (err) {
      results.push({ file: file.name, ok: false, error: err.message });
    }
  }
  S.report = { results };
  await load();
}

/** Lee la imagen y abre la revisión. Nada se guarda hasta que el admin confirma. */
async function revisarImagen(file, pendientes = []) {
  S.report = { progress: `Leyendo ${file.name}… la primera vez tarda, descarga el lector.` };
  render();
  let bloques;
  try {
    bloques = await leerImagen(file, (p) => {
      S.report = { progress: `Leyendo ${file.name}… ${Math.round(p * 100)} %` };
      render();
    });
  } catch (err) {
    S.report = { results: [{ file: file.name, ok: false, error: err.message }] };
    render();
    if (pendientes.length) await revisarImagen(pendientes[0], pendientes.slice(1));
    return;
  }
  S.report = null;
  render();
  panelRevision(person_from_filename(file.name), bloques, pendientes, bloques.virtuales || 0);
}

const person_from_filename = (nombre) =>
  nombre.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

/** Tabla editable con lo que se leyó. El OCR se equivoca: esto es el filtro. */
function panelRevision(nombre, bloques, pendientes = [], virtuales = 0) {
  const filas = bloques.map((b) => ({ ...b }));
  const note = el("div");
  const cuerpo = el("div");

  const nombreInput = el("input", { type: "text", value: nombre, required: true });

  const pintar = () => {
    clear(cuerpo);
    if (!filas.length) {
      cuerpo.append(el("p", { className: "sub", textContent: "No queda ninguna fila." }));
      return;
    }
    filas.forEach((f, i) => {
      const dia = el("select", { className: "dia", ariaLabel: "Día" }, ...DAYS.map((d, n) =>
        el("option", { value: String(n), textContent: d.slice(0, 3), selected: n === f.day })));
      dia.onchange = () => { f.day = Number(dia.value); };
      const desde = el("input", { type: "time", className: "t1", value: hhmm(f.start), ariaLabel: "Entra" });
      desde.onchange = () => { f.start = deHhmm(desde.value); };
      const hasta = el("input", { type: "time", className: "t2", value: hhmm(f.end), ariaLabel: "Sale" });
      hasta.onchange = () => { f.end = deHhmm(hasta.value); };
      const materia = el("input", {
        type: "text", className: "mat", value: f.subject, placeholder: "Materia", ariaLabel: "Materia",
      });
      materia.oninput = () => { f.subject = materia.value; };
      const aula = el("input", {
        type: "text", className: "aula", value: f.room, placeholder: "Aula", ariaLabel: "Aula",
      });
      // Los códigos son 3-405 o 3-N03: lo que no encaje se marca para revisarlo.
      const marcarAula = () => aula.classList.toggle("dudoso", aulaDudosa(aula.value));
      aula.oninput = () => { f.room = aula.value; marcarAula(); };
      marcarAula();

      cuerpo.append(el("div", { className: "ocr-row" },
        dia, desde, hasta,
        el("button", {
          className: "btn btn-danger x", type: "button", textContent: "×",
          ariaLabel: `Quitar la fila ${i + 1}`,
          onclick: () => { filas.splice(i, 1); pintar(); },
        }),
        materia, aula));
    });
  };
  pintar();

  const guardar = el("button", {
    className: "btn btn-primary", type: "button",
    textContent: "Guardar el horario",
    onclick: async () => {
      const quien = nombreInput.value.trim();
      if (!quien) return clear(note).append(
        el("p", { className: "note err", textContent: "Falta el nombre de la persona." }));
      if (!filas.length) return clear(note).append(
        el("p", { className: "note err", textContent: "No hay ninguna fila que guardar." }));
      try {
        await api.addBlocks(S.slug, {
          name: quien, replace_kind: "clase",
          blocks: filas.map((f) => ({
            day: f.day, start: hhmm(f.start), end: hhmm(f.end),
            subject: f.subject, room: f.room, kind: "clase",
          })),
        });
        closePanel();
        S.report = { results: [{ file: `imagen de ${quien}`, ok: true, name: quien, blocks: filas.length }] };
        await load();
        if (pendientes.length) await revisarImagen(pendientes[0], pendientes.slice(1));
      } catch (err) {
        clear(note).append(el("p", { className: "note err", textContent: err.message }));
      }
    },
  });

  openPanel(
    ...panelHead("Revisa lo que se leyó",
      "El lector de imágenes se equivoca. Corrige lo que haga falta antes de guardar."),
    virtuales
      ? el("p", { className: "note ok",
        textContent: `${virtuales} clase${virtuales > 1 ? "s virtuales quedaron" : " virtual quedó"} fuera.` })
      : null,
    note,
    el("label", { className: "field" }, el("span", { textContent: "¿De quién es este horario?" }), nombreInput),
    cuerpo,
    el("button", {
      className: "btn", type: "button", textContent: "Añadir una fila",
      onclick: () => { filas.push({ day: 0, start: 420, end: 465, subject: "", room: "", kind: "clase" }); pintar(); },
    }),
    el("p", { className: "sub", textContent: "Al guardar se reemplazan las clases que ya tuviera. Su horario de trabajo no se toca." }),
    guardar);
}

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const deHhmm = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

function reportCard(report) {
  if (report.progress) {
    return el("div", { className: "report" }, el("h2", { textContent: report.progress }));
  }
  const failed = report.results.filter((r) => !r.ok).length;
  const ok = report.results.length - failed;
  const list = el("ul");
  // Los fallos van primero y con el nombre exacto del archivo.
  [...report.results].sort((a, b) => a.ok - b.ok).forEach((r) => {
    list.append(r.ok
      ? el("li", { className: "good" },
        el("span", { className: "f", textContent: `✓ ${r.file}` }),
        el("span", { className: "why", textContent:
          ` → ${r.name}, ${r.blocks} bloques`
          + (r.virtual ? `, ${r.virtual} virtual${r.virtual > 1 ? "es" : ""} fuera` : "")
          + (r.updated ? ", actualizado" : "") }))
      : el("li", { className: "fail" },
        el("span", { className: "f", textContent: `✕ ${r.file}` }),
        el("span", { className: "why", textContent: ` — ${r.error}` })));
  });
  return el("div", { className: "report" },
    el("h2", { textContent: failed ? `${ok} leídos · ${failed} con fallo` : `${ok} leídos, todo bien` }),
    list);
}

// --- panel lateral --------------------------------------------------------

function openPanel({ foco = true, ancho = null } = {}, ...content) {
  // append() convertiría un null o undefined en el texto "null"/"undefined".
  clear(panel).append(...content.filter((n) => n != null && n !== false));
  panel.hidden = false;
  panel.classList.toggle("side-panel", ancho === "side");
  requestAnimationFrame(() => { panel.classList.add("on"); scrim.classList.add("on"); });
  // Al repintar lo que ya estaba abierto no se roba el foco, que si no el
  // navegador se lo lleva a otro lado mientras se escribe.
  if (foco) panel.querySelector("button, input")?.focus();
}

function closePanel() {
  panel.classList.remove("on");
  scrim.classList.remove("on");
  setTimeout(() => { if (!panel.classList.contains("on")) panel.hidden = true; }, 220);
}

window.addEventListener("resize", ajustarRejilla);

scrim.addEventListener("click", closePanel);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || capaSorteo) return;   // con la capa abierta es ella
  closePanel();
});

function panelHead(title, subtitle, extra) {
  return [
    el("div", { className: "panel-head" },
      el("h2", { textContent: title }),
      el("button", { className: "btn", type: "button", textContent: "Cerrar", onclick: closePanel })),
    subtitle ? el("p", { className: "sub", textContent: subtitle }) : null,
    extra,
  ];
}

async function openPerson(name) {
  let p;
  try {
    p = await api.person(S.slug, name);
  } catch (err) {
    return openPanel(...panelHead(name, null, el("p", { className: "note err", textContent: err.message })));
  }
  const clases = p.days.reduce((n, d) => n + d.blocks.filter((b) => b.kind !== "trabajo").length, 0);
  const days = p.days.map((d) =>
    el("section", { className: "pday" },
      el("h3", { textContent: DAYS[d.day] }),
      el("div", { className: "ranges", textContent: d.ranges.map(([a, b]) => fmtRange(a, b)).join("  ·  ") }),
      el("table", {}, el("tbody", {}, ...d.blocks.map((b) =>
        el("tr", {},
          el("td", { textContent: `${fmt(b.start)} – ${fmt(b.end)}` }),
          el("td", {},
            b.kind === "trabajo" ? el("span", { className: "tag", textContent: "trabajo" }) : null,
            b.kind === "trabajo" ? " " : null,
            b.subject,
            b.tags ? el("span", { className: "tag", textContent: b.tags.split("").join(" ") }) : null,
            b.room ? el("div", { className: "room", textContent: b.room }) : null),
          isAdmin()
            ? el("td", { className: "del" },
              el("button", {
                className: "btn", type: "button", textContent: "✎",
                ariaLabel: `Editar ${b.subject}`,
                onclick: (e) => editarBloque(e.target.closest("tr"), b, p.name),
              }),
              el("button", {
                className: "btn btn-danger", type: "button", textContent: "×",
                ariaLabel: `Quitar ${b.subject}`,
                onclick: async () => {
                  if (!confirm(`¿Quitar «${b.subject}» de ${DAYS[d.day]}?`)) return;
                  await api.deleteBlock(S.slug, b.id, p.name);
                  await load();
                  openPerson(p.name);
                },
              }))
            : null))))));

  const remove = isAdmin()
    ? el("button", {
      className: "btn btn-danger", type: "button", textContent: "Eliminar de la agrupación",
      onclick: async () => {
        if (!confirm(`¿Eliminar el horario de ${p.name}?`)) return;
        await api.deletePerson(S.slug, p.name);
        closePanel();
        load();
      },
    })
    : null;

  const resumen = [
    clases ? `${clases} bloques de clase` : "sin clases",
    p.works ? "y horario de trabajo" : null,
  ].filter(Boolean).join(" ");

  openPanel(
    ...panelHead(p.name, resumen),
    isAdmin() ? renombrarSection(p) : null,
    isAdmin() ? addBlockSection(p) : null,
    ...days,
    remove);
}

/** Corregir el nombre con el que se subió el PDF. Las participaciones y las
 *  strikes van detrás de la persona, no del texto, así que sobreviven al cambio. */
function renombrarSection(p) {
  const input = el("input", { type: "text", value: p.name, ariaLabel: "Nombre en el padrón" });
  const aviso = el("div");
  return el("form", {
    className: "card panel-form",
    onsubmit: async (e) => {
      e.preventDefault();
      const nuevo = input.value.trim();
      if (!nuevo || nuevo === p.name) return;
      try {
        await api.renamePerson(S.slug, p.name, nuevo);
        closePanel();
        await load();
        openPerson(nuevo);
      } catch (err) {
        clear(aviso).append(el("div", { className: "note err", textContent: err.message }));
      }
    },
  },
    el("span", { className: "rot", textContent: "Nombre en el padrón" }),
    el("div", { className: "linea" },
      input,
      el("button", { className: "btn btn-primary", type: "submit", textContent: "Guardar" })),
    el("p", { className: "hint", textContent: "Tal y como sale en el PDF. Al corregirlo se mantienen participaciones y strikes." }),
    aviso);
}

/** Convierte una fila del horario en un formulario para corregirla. */
function editarBloque(fila, b, nombre) {
  const tipo = el("select", { ariaLabel: "Tipo" },
    el("option", { value: "clase", textContent: "Clase", selected: b.kind !== "trabajo" }),
    el("option", { value: "trabajo", textContent: "Trabajo", selected: b.kind === "trabajo" }));
  const dia = el("select", { ariaLabel: "Día" }, ...DAYS.map((d, n) =>
    el("option", { value: String(n), textContent: d.slice(0, 3), selected: n === b.day })));
  const desde = el("input", { type: "time", value: hhmm(b.start), ariaLabel: "Entra" });
  const hasta = el("input", { type: "time", value: hhmm(b.end), ariaLabel: "Sale" });
  const materia = el("input", { type: "text", value: b.subject, placeholder: "Materia", ariaLabel: "Materia" });
  const aula = el("input", { type: "text", value: b.room, placeholder: "Aula o lugar", ariaLabel: "Aula" });
  const aviso = el("div");

  const edicion = el("tr", {}, el("td", { colSpan: 3 },
    el("div", { className: "edit-box" },
      aviso,
      el("div", { className: "ocr-row" }, dia, desde, hasta, el("span"), materia, aula),
      el("div", { className: "two" },
        el("button", {
          className: "btn btn-primary", type: "button", textContent: "Guardar",
          onclick: async () => {
            try {
              await api.updateBlock(S.slug, b.id, nombre, {
                day: Number(dia.value), start: desde.value, end: hasta.value,
                subject: materia.value, room: aula.value, kind: tipo.value,
              });
              await load();
              openPerson(nombre);
            } catch (err) {
              clear(aviso).append(el("p", { className: "note err", textContent: err.message }));
            }
          },
        }),
        el("button", {
          className: "btn", type: "button", textContent: "Cancelar",
          onclick: () => { edicion.replaceWith(fila); },
        })),
      el("label", { className: "field" }, el("span", { textContent: "Tipo" }), tipo))));

  fila.replaceWith(edicion);
  materia.focus();
}

/** Añadir un bloque a mano: una clase (cuando solo hay una imagen) o trabajo. */
function addBlockSection(p) {
  const note = el("div");
  const tipo = el("select", {},
    el("option", { value: "clase", textContent: "Clase" }),
    el("option", { value: "trabajo", textContent: "Trabajo" }));
  const day = el("select", {}, ...DAYS.map((d, i) => el("option", { value: String(i), textContent: d })));
  const desde = el("input", { type: "time", required: true, value: "07:00" });
  const hasta = el("input", { type: "time", required: true, value: "07:45" });
  const materia = el("input", { type: "text", placeholder: "Materia" });
  const lugar = el("input", { type: "text", placeholder: "Aula o lugar" });

  // El trabajo no lleva materia: se etiqueta solo.
  tipo.onchange = () => { materia.parentElement.hidden = tipo.value === "trabajo"; };

  const form = el("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api.addBlocks(S.slug, {
          name: p.name,
          blocks: [{
            day: Number(day.value), start: desde.value, end: hasta.value,
            subject: tipo.value === "trabajo" ? "" : materia.value,
            room: lugar.value, kind: tipo.value,
          }],
        });
        await load();
        openPerson(p.name);
      } catch (err) {
        clear(note).append(el("p", { className: "note err", textContent: err.message }));
      }
    },
  },
    el("div", { className: "three" },
      el("label", { className: "field" }, el("span", { textContent: "Tipo" }), tipo),
      el("label", { className: "field" }, el("span", { textContent: "Día" }), day),
      el("label", { className: "field" }, el("span", { textContent: "Entra" }), desde)),
    el("div", { className: "three" },
      el("label", { className: "field" }, el("span", { textContent: "Sale" }), hasta),
      el("label", { className: "field" }, el("span", { textContent: "Materia" }), materia),
      el("label", { className: "field" }, el("span", { textContent: "Aula o lugar" }), lugar)),
    el("button", { className: "btn btn-primary", type: "submit", textContent: "Añadir al horario" }));

  return el("div", { className: "form-card" },
    el("h3", { textContent: "Añadir a mano" }),
    el("p", { className: "sub", textContent: "Para completar lo que falte, o cuando el horario viene en una imagen." }),
    note, form);
}

// --- ajustes --------------------------------------------------------------

const SECCIONES_AJUSTES = () => {
  const t = [["libres", "Libres"], ["activos", "Más activos"]];
  if (isAdmin()) t.push(["ruleta", "Ruleta"]);
  if (isAdmin()) t.push(["horarios", "Horarios"]);
  if (isOwner()) t.push(["miembros", "Miembros"]);
  if (S.user.is_superadmin) {
    t.push(["grupos", "Agrupaciones"]);
    t.push(["solicitudes", S.pending ? `Solicitudes (${S.pending})` : "Solicitudes"]);
  }
  t.push(["cuenta", "Cuenta"]);
  return t;
};

/** Las secciones van en una columna, como el menú de cualquier aplicación, y
 *  abajo la cuenta con el botón de salir: es lo último que se hace, no lo
 *  primero que se pisa por error al ir con el dedo por la parte de arriba. */
function openSettings(tab = S.ajustes, { foco = true } = {}) {
  const tabs = SECCIONES_AJUSTES();
  if (!tabs.some(([id]) => id === tab)) tab = "cuenta";
  S.ajustes = tab;
  // Ruleta y Más activos necesitan datos que aún no están: se piden al abrirlos,
  // no solo cuando se redibuja la página de detrás.
  const pide = ["ruleta", "activos"].includes(tab) && !S.ruleta && !S.ruletaError;

  const vistas = {
    libres: libresView, activos: activosView, ruleta: ruletaView,
    cuenta: accountView, horarios: schedulesView, miembros: membersView,
    grupos: groupsView, solicitudes: requestsView,
  };

  const nav = el("div", { className: "side-nav", role: "tablist", ariaLabel: "Ajustes" },
    ...tabs.map(([id, label]) => el("button", {
      type: "button", role: "tab", textContent: label, ariaSelected: String(id === tab),
      onclick: () => openSettings(id),
    })),
    el("div", { className: "side-foot" },
      el("p", { className: "side-mail", textContent: S.user.email }),
      el("button", {
        className: "btn btn-danger", type: "button", textContent: "Salir",
        onclick: async () => { closePanel(); await api.logout(); showLogin(); },
      })));

  openPanel({ foco, ancho: "side" }, ...panelHead("Ajustes"),
    el("div", { className: "side" },
      nav,
      el("div", { className: "side-body", id: "settings-body" })));
  vistas[tab]();
  if (pide) cargarRuleta();
}

/** Vuelve a pintar la sección abierta sin cerrarla: los datos llegan después y
 *  hay que enseñarlos donde están, no en la página de detrás. */
function repintarAjustes() {
  if (panel.classList.contains("on") && S.slug) openSettings(S.ajustes, { foco: false });
}

function settingsBody() {
  const box = clear(document.getElementById("settings-body"));
  if (S.flash) {
    box.append(el("p", { className: `note ${S.flash.tipo}`, textContent: S.flash.texto }));
    S.flash = null;   // se enseña una vez y se va
  }
  return box;
}

function accountView() {
  const current = el("input", { type: "password", required: true, autocomplete: "current-password" });
  const next = el("input", { type: "password", required: true, autocomplete: "new-password", minLength: 8 });
  const note = el("div");

  settingsBody().append(
    el("div", { className: "form-card" },
      el("h3", { textContent: "Cambiar contraseña" }),
      note,
      el("form", {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await api.changePassword(current.value, next.value);
            clear(note).append(el("p", { className: "note ok", textContent: "Contraseña cambiada. Las demás sesiones se cerraron." }));
            e.target.reset();
          } catch (err) {
            clear(note).append(el("p", { className: "note err", textContent: err.message }));
          }
        },
      },
        el("label", { className: "field" }, el("span", { textContent: "Contraseña actual" }), current),
        el("label", { className: "field" }, el("span", { textContent: "Nueva contraseña (mín. 8)" }), next),
        el("button", { className: "btn btn-primary", type: "submit", textContent: "Cambiar contraseña" }))));
}

/** Gestión de horarios: la lista completa, con borrado uno a uno o de golpe. */
function schedulesView() {
  const box = settingsBody();
  const note = el("div");
  box.append(note);

  const aviso = (texto, clase) =>
    clear(note).append(el("p", { className: `note ${clase}`, textContent: texto }));

  // Alta de alguien que no tiene PDF pero sí horario laboral.
  const nombre = el("input", { type: "text", required: true, placeholder: "Nombre y apellido" });
  const altaTrabajo = el("div", { className: "form-card" },
    el("h3", { textContent: "Añadir a alguien que solo trabaja" }),
    el("p", { className: "sub", textContent: "Sin PDF. Después le pones sus franjas desde su ficha." }),
    el("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        const quien = nombre.value.trim();
        if (!quien) return;
        try {
          await api.addBlocks(S.slug, {
            name: quien,
            blocks: [{ day: 0, start: "08:00", end: "12:00", kind: "trabajo" }],
          });
          await load();
          closePanel();
          openPerson(quien);
        } catch (err) {
          aviso(err.message, "err");
        }
      },
    },
      el("label", { className: "field" }, el("span", { textContent: "Nombre" }), nombre),
      el("button", { className: "btn btn-primary", type: "submit", textContent: "Crear y abrir su ficha" })));

  if (!S.roster.length) {
    box.append(el("div", { className: "empty" },
      el("strong", { textContent: "No hay horarios todavía" }),
      "Sube los PDF desde la pantalla principal."));
    return box.append(altaTrabajo);
  }

  const fecha = (segundos) =>
    new Date(segundos * 1000).toLocaleDateString("es-PA", { day: "numeric", month: "short" });

  box.append(
    el("p", { className: "sub", textContent: `${S.roster.length} ${S.roster.length === 1 ? "persona" : "personas"} en ${group().name}. Borrar un horario no borra la cuenta de nadie.` }),
    el("ul", { className: "rows" }, ...S.roster.map((p) =>
      el("li", {},
        el("div", { className: "who-n" },
          el("b", { textContent: p.name }),
          el("span", { textContent: p.filename
            ? `${p.filename} · subido el ${fecha(p.uploaded_at)}`
            : "solo horario de trabajo" })),
        p.work_blocks ? el("span", { className: "role", textContent: "trabaja" }) : null,
        el("button", {
          className: "btn btn-danger", type: "button", textContent: "Eliminar",
          onclick: async () => {
            if (!confirm(`¿Eliminar el horario de ${p.name}?`)) return;
            try {
              await api.deletePerson(S.slug, p.name);
              await load();
              openSettings("horarios");
            } catch (err) {
              aviso(err.message, "err");
            }
          },
        })))),
    altaTrabajo,
    el("div", { className: "form-card" },
      el("h3", { textContent: "Vaciar la agrupación" }),
      el("p", { className: "sub", textContent: "Borra los horarios de todo el mundo de una vez. No se puede deshacer." }),
      el("button", {
        className: "btn btn-danger", type: "button",
        textContent: `Eliminar los ${S.roster.length} horarios`,
        onclick: async () => {
          if (!confirm(`¿Eliminar los ${S.roster.length} horarios de ${group().name}? No se puede deshacer.`)) return;
          if (!confirm("Confirma otra vez: se borran todos.")) return;
          try {
            const r = await api.deleteAllPeople(S.slug);
            await load();
            openSettings("horarios");
            aviso(`Se borraron ${r.deleted} horarios.`, "ok");
          } catch (err) {
            aviso(err.message, "err");
          }
        },
      })));
}

async function membersView() {
  const box = settingsBody();
  const note = el("div");
  const email = el("input", { type: "email", required: true, placeholder: "correo@ejemplo.com" });
  const name = el("input", { type: "text", placeholder: "Ana Gómez" });
  const pass = el("input", { type: "password", placeholder: "mín. 8 caracteres", autocomplete: "new-password" });
  const role = el("select", {},
    el("option", { value: "member", textContent: "Solo ver — consulta los horarios" }),
    el("option", { value: "admin", textContent: "Administrar — además sube y borra horarios" }));

  const form = el("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await api.putMember(S.slug, {
          email: email.value, name: name.value, password: pass.value, role: role.value,
        });
        clear(note).append(el("p", { className: "note ok", textContent: r.created ? `Cuenta creada para ${r.email}.` : `${r.email} añadido.` }));
        e.target.reset();
        membersView();
      } catch (err) {
        clear(note).append(el("p", { className: "note err", textContent: err.message }));
      }
    },
  },
    el("label", { className: "field" }, el("span", { textContent: "Correo" }), email),
    el("div", { className: "two" },
      el("label", { className: "field" }, el("span", { textContent: "Nombre (cuenta nueva)" }), name),
      el("label", { className: "field" }, el("span", { textContent: "Contraseña inicial" }), pass)),
    el("label", { className: "field" }, el("span", { textContent: "Puede" }), role),
    el("button", { className: "btn btn-primary", type: "submit", textContent: "Añadir a la agrupación" }));

  box.append(note, el("div", { className: "form-card" },
    el("h3", { textContent: `Añadir a ${group().name}` }),
    el("p", { className: "sub", textContent: "Si el correo ya tiene cuenta, basta con el correo. Gestionar a la gente es cosa tuya: los administradores solo tocan horarios." }),
    form));

  try {
    const list = await api.members(S.slug);
    box.append(el("ul", { className: "rows" }, ...list.map((m) => {
      if (m.is_owner) {
        // La cuenta principal no se toca: ni cambia de rol ni se quita.
        return el("li", {},
          el("div", { className: "who-n" },
            el("b", { textContent: m.name }),
            el("span", { textContent: m.email })),
          el("span", { className: "role admin", textContent: "cuenta principal" }));
      }
      const rol = el("select", { ariaLabel: `Permisos de ${m.name}` },
        el("option", { value: "member", textContent: "Solo ver", selected: m.role === "member" }),
        el("option", { value: "admin", textContent: "Administrar", selected: m.role === "admin" }));
      rol.onchange = async () => {
        try {
          await api.putMember(S.slug, { email: m.email, role: rol.value });
          membersView();
        } catch (err) {
          clear(note).append(el("p", { className: "note err", textContent: err.message }));
        }
      };
      return el("li", {},
        el("div", { className: "who-n" },
          el("b", { textContent: m.name }),
          el("span", { textContent: m.email })),
        rol,
        el("button", {
          className: "btn btn-danger", type: "button", textContent: "Quitar",
          onclick: async () => {
            if (!confirm(`¿Quitar a ${m.name} de ${group().name}?`)) return;
            await api.removeMember(S.slug, m.id);
            membersView();
          },
        }));
    })));
  } catch (err) {
    box.append(el("p", { className: "note err", textContent: err.message }));
  }
}

async function requestsView() {
  const box = settingsBody();
  const note = el("div");
  box.append(note);

  const refrescar = async () => {
    const me = await api.me();       // vuelve a contar las pendientes
    S.pending = me.pending || 0;
    openSettings("solicitudes");
    render();
  };

  let lista;
  try {
    lista = await api.requests();
  } catch (err) {
    return box.append(el("p", { className: "note err", textContent: err.message }));
  }

  if (!lista.length) {
    return box.append(el("div", { className: "empty" },
      el("strong", { textContent: "No hay solicitudes" }),
      "Cuando alguien pida acceso a una agrupación, aparecerá aquí."));
  }

  box.append(el("p", { className: "sub", textContent: "Al aprobar, la persona pasa a administrar esa agrupación." }));
  box.append(el("ul", { className: "rows" }, ...lista.map((r) =>
    el("li", {},
      el("div", { className: "who-n" },
        el("b", { textContent: r.name }),
        el("span", { textContent: `${r.email} · pide ${r.group_name}` })),
      el("button", {
        className: "btn btn-primary", type: "button", textContent: "Aprobar",
        onclick: async () => {
          try {
            await api.approveRequest(r.id);
            await refrescar();
          } catch (err) {
            clear(note).append(el("p", { className: "note err", textContent: err.message }));
          }
        },
      }),
      el("button", {
        className: "btn btn-danger", type: "button", textContent: "Rechazar",
        onclick: async () => {
          if (!confirm(`¿Rechazar la solicitud de ${r.name}?`)) return;
          await api.rejectRequest(r.id);
          await refrescar();
        },
      })))));
}

async function groupsView() {
  const box = settingsBody();
  const note = el("div");
  const name = el("input", { type: "text", required: true, placeholder: "Eurus" });

  box.append(note, el("div", { className: "form-card" },
    el("h3", { textContent: "Nueva agrupación" }),
    el("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const g = await api.createGroup(name.value);
          S.flash = { tipo: "ok", texto: `Agrupación «${g.name}» creada.` };
          e.target.reset();
          enter(await api.me());
          openSettings("grupos");
        } catch (err) {
          clear(note).append(el("p", { className: "note err", textContent: err.message }));
        }
      },
    },
      el("label", { className: "field" }, el("span", { textContent: "Nombre" }), name),
      el("button", { className: "btn btn-primary", type: "submit", textContent: "Crear agrupación" }))),
  );

  let lista;
  try {
    lista = await api.groupsWithOwner();
  } catch (err) {
    return box.append(el("p", { className: "note err", textContent: err.message }));
  }

  lista.forEach((g) => {
    const correo = el("input", {
      type: "email", placeholder: "correo@ejemplo.com", value: g.owner_email || "",
    });
    const nombre = el("input", { type: "text", placeholder: "Nombre (si la cuenta es nueva)" });
    const clave = el("input", { type: "password", placeholder: "Contraseña inicial", autocomplete: "new-password" });

    box.append(el("div", { className: "form-card" },
      el("h3", { textContent: g.name }),
      el("p", { className: "sub" },
        g.owner_email
          ? `Cuenta principal: ${g.owner_name} (${g.owner_email}).`
          : "Todavía no tiene cuenta principal."),
      el("form", {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const r = await api.setOwner(g.slug, {
              email: correo.value, name: nombre.value, password: clave.value,
            });
            S.flash = { tipo: "ok", texto: `${r.owner_email} es ahora la cuenta principal de ${g.name}.` };
            enter(await api.me());
            openSettings("grupos");
          } catch (err) {
            clear(note).append(el("p", { className: "note err", textContent: err.message }));
          }
        },
      },
        el("label", { className: "field" },
          el("span", { textContent: "Cuenta principal" }), correo),
        el("div", { className: "two" },
          el("label", { className: "field" }, el("span", { textContent: "Nombre" }), nombre),
          el("label", { className: "field" }, el("span", { textContent: "Contraseña" }), clave)),
        el("div", { className: "two" },
          el("button", { className: "btn btn-primary", type: "submit", textContent: "Nombrar principal" }),
          el("button", {
            className: "btn btn-danger", type: "button", textContent: "Eliminar agrupación",
            onclick: async () => {
              if (!confirm(`¿Eliminar «${g.name}» con todos sus horarios? No se puede deshacer.`)) return;
              await api.deleteGroup(g.slug);
              enter(await api.me());
              openSettings("grupos");
            },
          })))));
  });
}
