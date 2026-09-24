// Ayudas de DOM y formato. Todo el texto se inserta como nodo de texto, nunca
// como HTML: los nombres vienen de archivos subidos y no son de fiar.

export function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** Índice del día de hoy en nuestra escala (0 = lunes). */
export const todayIndex = () => (new Date().getDay() + 6) % 7;

export const minutesNow = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

/** 450 -> "7:30 a.m." */
export function fmt(min) {
  const h = Math.floor(min / 60);
  const mm = String(min % 60).padStart(2, "0");
  return `${h % 12 || 12}:${mm} ${h < 12 ? "a.m." : "p.m."}`;
}

export const fmtRange = (a, b) => `${fmt(a)} – ${fmt(b)}`;

/** Etiqueta corta para la regla horaria: 7, 11, 12p, 1p… */
export function hourLabel(h) {
  if (h < 12) return String(h);
  return h === 12 ? "12p" : `${h - 12}p`;
}

/** "2 personas" / "1 persona" */
export const people = (n) => `${n} ${n === 1 ? "persona" : "personas"}`;

/** Nombre con la coincidencia de la búsqueda resaltada. */
export function highlight(name, query) {
  const q = norm(query.trim());
  const i = q ? norm(name).indexOf(q) : -1;
  if (i < 0) return name;
  const frag = document.createDocumentFragment();
  frag.append(
    name.slice(0, i),
    el("mark", { textContent: name.slice(i, i + q.length) }),
    name.slice(i + q.length),
  );
  return frag;
}
