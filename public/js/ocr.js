// Lee una imagen de horario (idealmente una captura) y propone bloques de clase.
//
// El OCR corre en el navegador de quien sube la imagen: el servidor de Vercel no
// tiene Tesseract y añadirlo sería pesado y frágil. Lo que sale de aquí es una
// propuesta: la interfaz obliga a revisarla antes de guardar nada.

import { norm } from "./dom.js";

const CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

const DIAS = [
  [/^lunes$/, 0], [/^martes$/, 1], [/^miercoles$/, 2], [/^jueves$/, 3],
  [/^viernes$/, 4], [/^sabado$/, 5], [/^domingo$/, 6],
];

// "7:00-7:45A.M." y sus variantes, ya sin espacios.
const HORA = /(\d{1,2}):(\d{2})[-–—](\d{1,2}):(\d{2})\s*\.?\s*([ap])\.?\s*m/i;

let cargando = null;

/** Carga Tesseract una sola vez, desde el CDN. */
function cargarTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!cargando) {
    cargando = new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = CDN;
      s.onload = () => ok(window.Tesseract);
      s.onerror = () => { cargando = null; fail(new Error("No se pudo cargar el lector de imágenes.")); };
      document.head.append(s);
    });
  }
  return cargando;
}

const centro = (b) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

/** "7:00-7:45A.M." -> {start, end} en minutos, resolviendo el cruce del mediodía. */
export function parseHoras(texto) {
  const m = HORA.exec((texto || "").replace(/\s+/g, ""));
  if (!m) return null;
  const [h1, m1, h2, m2] = [+m[1], +m[2], +m[3], +m[4]];
  const pm = m[5].toLowerCase() === "p";
  if (h1 > 12 || h2 > 12 || m1 > 59 || m2 > 59) return null;
  const end = ((h2 % 12) + (pm ? 12 : 0)) * 60 + m2;
  let start = ((h1 % 12) + (pm ? 12 : 0)) * 60 + m1;
  // 11:10-12:55 p.m.: el inicio es de la mañana aunque el meridiano diga p.m.
  if (start >= end) start -= 12 * 60;
  return start >= 0 && start < end ? { start, end } : null;
}

/** Reparte las palabras reconocidas en la rejilla días × franjas horarias. */
export function construirBloques(palabras, lineas) {
  const columnas = [];
  for (const w of palabras) {
    const t = norm(w.text).replace(/[^a-z]/g, "");
    const dia = DIAS.find(([re]) => re.test(t));
    if (dia && !columnas.some((c) => c.day === dia[1])) {
      columnas.push({ day: dia[1], x: centro(w.bbox).x });
    }
  }
  const filas = [];
  for (const l of lineas) {
    const horas = parseHoras(l.text);
    if (horas) filas.push({ ...horas, y: centro(l.bbox).y, x: centro(l.bbox).x });
  }
  columnas.sort((a, b) => a.x - b.x);
  filas.sort((a, b) => a.y - b.y);
  if (!columnas.length || !filas.length) {
    throw new Error("No se reconoció la tabla: no aparecen los días o las horas.");
  }

  // Bordes de cada celda: a mitad de camino entre columnas, y entre filas. En los
  // extremos no hay vecino, así que se usa el ancho medio de las demás columnas.
  const medio = (a, b) => (a + b) / 2;
  const separaciones = columnas.slice(1).map((c, i) => c.x - columnas[i].x);
  const ancho = separaciones.length
    ? separaciones.reduce((a, b) => a + b, 0) / separaciones.length
    : 150;
  const bordeX = columnas.map((c, i) => [
    i === 0 ? c.x - ancho / 2 : medio(columnas[i - 1].x, c.x),
    i === columnas.length - 1 ? c.x + ancho / 2 : medio(c.x, columnas[i + 1].x),
  ]);
  const altoFila = filas.length > 1 ? filas[1].y - filas[0].y : 40;
  const bordeY = filas.map((f, i) => [
    i === 0 ? f.y - altoFila / 2 : medio(filas[i - 1].y, f.y),
    i === filas.length - 1 ? f.y + altoFila / 2 : medio(f.y, filas[i + 1].y),
  ]);

  const celdas = new Map();
  for (const w of palabras) {
    const texto = w.text.trim();
    if (!texto) continue;
    const { x, y } = centro(w.bbox);
    const ci = bordeX.findIndex(([a, b]) => x >= a && x < b);
    const fi = bordeY.findIndex(([a, b]) => y >= a && y < b);
    if (ci < 0 || fi < 0) continue;
    const clave = `${fi}|${ci}`;
    celdas.set(clave, (celdas.get(clave) || []).concat(texto));
  }

  const bloques = [];
  for (const [clave, trozos] of celdas) {
    const [fi, ci] = clave.split("|").map(Number);
    // Los bordes de la tabla se cuelan como |, [ o ] pegados al texto.
    const texto = trozos.join(" ")
      .replace(/[|\[\]{}<>_~^"'`]/g, " ")
      .replace(/\(\s*\)/g, " ")     // paréntesis vacío: el "(L)" que no se leyó
      .replace(/\(\s*$/, "")        // y el que quedó a medias al final
      .replace(/\s+/g, " ")
      .trim();
    if (texto.length < 2) continue;
    const aula = /aula\s*[\w-]+/i.exec(texto);
    const materia = texto.replace(/aula\s*[\w-]+/ig, "").trim();
    if (!materia) continue;
    bloques.push({
      day: columnas[ci].day,
      start: filas[fi].start,
      end: filas[fi].end,
      subject: materia,
      room: aula ? aula[0] : "",
      kind: "clase",
    });
  }
  bloques.sort((a, b) => a.day - b.day || a.start - b.start);
  if (!bloques.length) throw new Error("Se reconoció la tabla pero no se leyó ninguna clase.");
  return bloques;
}

/** Lee la imagen y devuelve los bloques propuestos. `onProgress` va de 0 a 1. */
export async function leerImagen(file, onProgress = () => {}) {
  const Tesseract = await cargarTesseract();
  const { data } = await Tesseract.recognize(file, "spa", {
    logger: (m) => m.status === "recognizing text" && onProgress(m.progress),
  });
  const palabras = data.words || [];
  const lineas = data.lines || [];
  if (!palabras.length) throw new Error("No se leyó texto en la imagen.");
  return construirBloques(palabras, lineas);
}
