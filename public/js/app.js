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
  day: todayIndex(),
  query: "",
  report: null,
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
        form)));
  email.focus();
}

function enter(me) {
  S.user = me.user;
  S.groups = me.groups;
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
      el("button", { className: "btn", type: "button", textContent: "Ajustes", onclick: openSettings }),
      el("button", {
        className: "btn", type: "button", textContent: "Salir",
        onclick: async () => { await api.logout(); showLogin(); },
      })));
}

function body(error) {
  if (error) return [el("div", { className: "empty" }, el("strong", { textContent: "No se pudo cargar" }), error)];

  if (!S.slug) {
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

  out.push(dayTabs());
  const segments = S.week[S.day]?.segments || [];
  if (!segments.length) {
    out.push(el("div", { className: "empty" },
      el("strong", { textContent: `Nadie tiene clase el ${DAYS[S.day].toLowerCase()}` }),
      "Todo el día está libre para reunirse."));
  } else {
    out.push(track(segments), ...segments.map((s, i) => segmentRow(s, i)));
  }
  return out;
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
    el("div", { className: "who" }, ...s.people.map(chip)));
  row.style.animationDelay = `${Math.min(i, 8) * 30}ms`;
  return row;
}

function chip(name) {
  return el("button", {
    className: "chip", type: "button", onclick: () => openPerson(name),
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
      el("div", { className: "who" }, ...s.people.map(chip)))));
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
  const total = p.days.reduce((n, d) => n + d.blocks.length, 0);
  const days = p.days.map((d) =>
    el("section", { className: "pday" },
      el("h3", { textContent: DAYS[d.day] }),
      el("div", { className: "ranges", textContent: d.ranges.map(([a, b]) => fmtRange(a, b)).join("  ·  ") }),
      el("table", {}, el("tbody", {}, ...d.blocks.map((b) =>
        el("tr", {},
          el("td", { textContent: `${fmt(b.start)} – ${fmt(b.end)}` }),
          el("td", {},
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

  openPanel(...panelHead(p.name, `${total} bloques de clase en ${p.days.length} días`), ...days, remove);
}

// --- ajustes --------------------------------------------------------------

function openSettings(tab = "cuenta") {
  const tabs = [["cuenta", "Cuenta"]];
  if (isAdmin()) tabs.push(["miembros", "Miembros"]);
  if (S.user.is_superadmin) tabs.push(["grupos", "Agrupaciones"]);
  if (!tabs.some(([id]) => id === tab)) tab = "cuenta";

  const bar = el("div", { className: "tabs", role: "tablist" },
    ...tabs.map(([id, label]) => el("button", {
      type: "button", role: "tab", textContent: label, ariaSelected: String(id === tab),
      onclick: () => openSettings(id),
    })));

  const views = { cuenta: accountView, miembros: membersView, grupos: groupsView };
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
