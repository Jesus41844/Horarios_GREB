import { ApiError, api } from "./api.js";
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
  view: "semana",   // "semana" (rejilla L-V) o "dia"
  day: todayIndex(),
  query: "",
  report: null,
  pending: 0,     // solicitudes por aprobar (solo superadmin)
  waiting: null,  // agrupaciones que esta cuenta pidió y aún no le aprueban
};

const group = () => S.groups.find((g) => g.slug === S.slug) || null;
const isAdmin = () => group()?.role === "admin";
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
}

function header() {
  const picker = S.groups.length > 1
    ? el("select", {
      ariaLabel: "Agrupación",
      onchange: (e) => { S.slug = e.target.value; remember(S.slug); S.report = null; load(); },
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
      el("button", {
        className: "btn", type: "button",
        onclick: () => openSettings(S.pending ? "solicitudes" : "cuenta"),
      }, "Ajustes", S.pending ? el("span", { className: "badge", textContent: String(S.pending) }) : null),
      el("button", {
        className: "btn", type: "button", textContent: "Salir",
        onclick: async () => { await api.logout(); showLogin(); },
      })));
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
  if (isAdmin()) out.push(dropzone());
  if (S.report) out.push(reportCard(S.report));

  if (!S.roster.length) {
    out.push(el("div", { className: "empty" },
      el("strong", { textContent: "Aún no hay horarios" }),
      isAdmin()
        ? "Sube los PDF: el nombre del archivo es el nombre de la persona."
        : "Quien administra la agrupación todavía no ha subido ninguno."));
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

function viewBar() {
  return el("div", { className: "viewbar", role: "tablist", ariaLabel: "Vista" },
    ...[["semana", "Semana"], ["dia", "Por día"]].map(([id, label]) =>
      el("button", {
        type: "button", role: "tab", textContent: label,
        ariaSelected: String(S.view === id),
        onclick: () => { S.view = id; render(); },
      })));
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
  const PPH = 46;                                     // píxeles por hora
  const alto = ((to - from) / 60) * PPH;
  const y = (min) => ((min - from) / 60) * PPH;

  const grid = el("div", { className: "week-grid" });
  grid.append(el("div", { className: "week-head" }));
  DIAS.forEach((d) => grid.append(el("div", {
    className: d === todayIndex() ? "week-head today" : "week-head",
    textContent: DAYS[d],
  })));

  const horas = el("div", { className: "hours" });
  horas.style.height = `${alto}px`;
  for (let h = from / 60; h <= to / 60; h++) {
    const marca = el("b", { textContent: hourLabel(h) });
    marca.style.top = `${y(h * 60)}px`;
    horas.append(marca);
  }
  grid.append(horas);

  DIAS.forEach((d) => {
    const col = el("div", { className: "daycol" });
    col.style.height = `${alto}px`;
    col.style.setProperty("--hour-px", `${PPH}px`);
    (S.week[d]?.segments || []).forEach((seg) => {
      const alturaPx = y(seg.end) - y(seg.start);
      const todosTrabajan = seg.working.length === seg.people.length;
      const b = el("button", {
        type: "button",
        className: todosTrabajan ? "wblock work" : "wblock",
        title: `${DAYS[d]} ${fmtRange(seg.start, seg.end)}\n${seg.people.join(", ")}`,
        onclick: () => { S.view = "dia"; S.day = d; render(); },
      }, el("b", { textContent: `${seg.people.length}` }));
      // Los nombres solo cuando el bloque es lo bastante alto para leerlos.
      if (alturaPx >= 34) {
        b.append(el("span", {
          textContent: seg.people.length <= 3
            ? seg.people.join(", ")
            : `${seg.people.slice(0, 2).join(", ")} y ${seg.people.length - 2} más`,
        }));
      }
      b.style.top = `${y(seg.start)}px`;
      b.style.height = `${Math.max(alturaPx - 2, 14)}px`;
      col.append(b);
    });
    if (d === todayIndex()) {
      const ahora = minutesNow();
      if (ahora >= from && ahora <= to) {
        const linea = el("div", { className: "wnow" });
        linea.style.top = `${y(ahora)}px`;
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

  return el("section", { className: "week" }, cabecera, grid,
    finde.length
      ? el("p", { className: "weekend-note" },
        `Hay gente ocupada también el ${finde.map((d) => DAYS[d].toLowerCase()).join(" y el ")}. `,
        el("button", {
          className: "link", type: "button", textContent: "Verlo por día",
          onclick: () => { S.view = "dia"; S.day = finde[0]; render(); },
        }))
      : null);
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

function dropzone() {
  // sr-only y no `hidden`: así el campo sigue recibiendo el foco del teclado.
  const input = el("input", {
    type: "file", accept: ".pdf,application/pdf", multiple: true, className: "sr-only",
  });
  const zone = el("label", { className: "drop" },
    "Suelta aquí los PDF o haz clic para elegirlos. El nombre del archivo es el nombre de la persona.", input);

  input.addEventListener("change", () => { const f = [...input.files]; input.value = ""; upload(f); });
  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", (e) => upload([...e.dataTransfer.files]));
  return zone;
}

async function upload(files) {
  if (!files.length) return;
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
        el("span", { className: "why", textContent: ` → ${r.name}, ${r.blocks} bloques${r.updated ? ", actualizado" : ""}` }))
      : el("li", { className: "fail" },
        el("span", { className: "f", textContent: `✕ ${r.file}` }),
        el("span", { className: "why", textContent: ` — ${r.error}` })));
  });
  return el("div", { className: "report" },
    el("h2", { textContent: failed ? `${ok} leídos · ${failed} con fallo` : `${ok} leídos, todo bien` }),
    list);
}

// --- panel lateral --------------------------------------------------------

function openPanel(...content) {
  // append() convertiría un null o undefined en el texto "null"/"undefined".
  clear(panel).append(...content.filter((n) => n != null && n !== false));
  panel.hidden = false;
  requestAnimationFrame(() => { panel.classList.add("on"); scrim.classList.add("on"); });
  panel.querySelector("button, input")?.focus();
}

function closePanel() {
  panel.classList.remove("on");
  scrim.classList.remove("on");
  setTimeout(() => { if (!panel.classList.contains("on")) panel.hidden = true; }, 220);
}

scrim.addEventListener("click", closePanel);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });

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
            b.room ? el("div", { className: "room", textContent: b.room }) : null)))))));

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
    isAdmin() ? workSection(p) : null,
    ...days,
    remove);
}

/** Horario laboral de una persona: añadir franjas y quitarlas. */
function workSection(p) {
  const bloques = p.days.flatMap((d) =>
    d.blocks.filter((b) => b.kind === "trabajo").map((b) => ({ ...b, day: d.day })));
  const note = el("div");

  const lista = bloques.length
    ? el("ul", { className: "work-list" }, ...bloques.map((b) =>
      el("li", {},
        el("div", { className: "w" },
          el("b", { textContent: `${DAYS[b.day]}, ${fmt(b.start)} – ${fmt(b.end)}` }),
          b.room ? el("span", { textContent: b.room }) : null),
        el("button", {
          className: "btn btn-danger", type: "button", textContent: "Quitar",
          onclick: async () => {
            await api.deleteWork(S.slug, b.id, p.name);
            await load();
            openPerson(p.name);
          },
        }))))
    : el("p", { className: "sub", textContent: "No tiene horario de trabajo registrado." });

  const day = el("select", {}, ...DAYS.map((d, i) => el("option", { value: String(i), textContent: d })));
  const desde = el("input", { type: "time", required: true, value: "14:00" });
  const hasta = el("input", { type: "time", required: true, value: "18:00" });
  const lugar = el("input", { type: "text", placeholder: "Dónde (opcional)" });

  const form = el("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api.addWork(S.slug, {
          name: p.name, day: Number(day.value),
          start: desde.value, end: hasta.value, place: lugar.value,
        });
        await load();
        openPerson(p.name);
      } catch (err) {
        clear(note).append(el("p", { className: "note err", textContent: err.message }));
      }
    },
  },
    el("div", { className: "three" },
      el("label", { className: "field" }, el("span", { textContent: "Día" }), day),
      el("label", { className: "field" }, el("span", { textContent: "Entra" }), desde),
      el("label", { className: "field" }, el("span", { textContent: "Sale" }), hasta)),
    el("label", { className: "field" }, el("span", { textContent: "Lugar" }), lugar),
    el("button", { className: "btn btn-primary", type: "submit", textContent: "Añadir franja de trabajo" }));

  return el("div", { className: "form-card" },
    el("h3", { textContent: "Trabajo" }), note, lista, form);
}

// --- ajustes --------------------------------------------------------------

function openSettings(tab = "cuenta") {
  const tabs = [["cuenta", "Cuenta"]];
  if (isAdmin()) tabs.push(["horarios", "Horarios"], ["miembros", "Miembros"]);
  if (S.user.is_superadmin) {
    tabs.push(["grupos", "Agrupaciones"]);
    tabs.push(["solicitudes", S.pending ? `Solicitudes (${S.pending})` : "Solicitudes"]);
  }
  if (!tabs.some(([id]) => id === tab)) tab = "cuenta";

  const bar = el("div", { className: "tabs", role: "tablist" },
    ...tabs.map(([id, label]) => el("button", {
      type: "button", role: "tab", textContent: label, ariaSelected: String(id === tab),
      onclick: () => openSettings(id),
    })));

  const views = {
    cuenta: accountView, horarios: schedulesView, miembros: membersView,
    grupos: groupsView, solicitudes: requestsView,
  };
  openPanel(...panelHead("Ajustes", S.user.email), bar, el("div", { id: "settings-body" }));
  views[tab]();
}

const settingsBody = () => clear(document.getElementById("settings-body"));

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
          await api.addWork(S.slug, { name: quien, day: 0, start: "08:00", end: "12:00" });
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
    el("option", { value: "member", textContent: "Miembro — solo ve y busca" }),
    el("option", { value: "admin", textContent: "Administrador — sube y borra" }));

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
    el("p", { className: "sub", textContent: "Si el correo ya tiene cuenta, basta con el correo." }),
    form));

  try {
    const list = await api.members(S.slug);
    box.append(el("ul", { className: "rows" }, ...list.map((m) =>
      el("li", {},
        el("div", { className: "who-n" },
          el("b", { textContent: m.name }),
          el("span", { textContent: m.email })),
        el("span", { className: `role ${m.role}`, textContent: m.role === "admin" ? "admin" : "miembro" }),
        m.id === S.user.id ? null : el("button", {
          className: "btn btn-danger", type: "button", textContent: "Quitar",
          onclick: async () => {
            if (!confirm(`¿Quitar a ${m.name} de ${group().name}?`)) return;
            await api.removeMember(S.slug, m.id);
            membersView();
          },
        })))));
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

function groupsView() {
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
          clear(note).append(el("p", { className: "note ok", textContent: `Agrupación «${g.name}» creada.` }));
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
    el("ul", { className: "rows" }, ...S.groups.map((g) =>
      el("li", {},
        el("div", { className: "who-n" }, el("b", { textContent: g.name }), el("span", { textContent: g.slug })),
        el("button", {
          className: "btn btn-danger", type: "button", textContent: "Eliminar",
          onclick: async () => {
            if (!confirm(`¿Eliminar «${g.name}» con todos sus horarios? No se puede deshacer.`)) return;
            await api.deleteGroup(g.slug);
            enter(await api.me());
            openSettings("grupos");
          },
        })))));
}
