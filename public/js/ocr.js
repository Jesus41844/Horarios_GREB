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

// "7:00-7:45A.M." y sus variantes, ya sin espacios. El segundo ":" es opcional
// porque en las capturas el OCR se lo come: se leía "7:00-745AM.".
const HORA = /(\d{1,2}):(\d{2})[-–—](\d{1,2}):?(\d{2})\s*\.?\s*([ap])\.?\s*m/i;
// Y sin meridiano, que ya es un horario de 24 horas: "16:00-17:40".
const HORA24 = /(\d{1,2}):(\d{2})[-–—](\d{1,2}):(\d{2})/;

// El sitio se escribe «aula 3-405», «AULA: 3-405» o «Salón 3-N03». La UTP lo
// pone con dos puntos detrás de la palabra, y el OCR también se los come.
const AULA = /(aula|sal[oó]n)\s*:?\s*([\w?-]+)/i;

// Clase virtual: donde iría el primer dígito de un aula física (3-405) hay una N
// (3-N03). Los números que la rodean no importan. No ocupa a nadie y no entra.
const VIRTUAL = /\b\d\s*-\s*N0\d\b/i;
export const esVirtual = (texto) => VIRTUAL.test(texto || "");

/** Un código de aula con la forma esperada: 3-405. */
export function aulaDudosa(texto) {
  const codigo = (texto || "").replace(/^(aula|sal[oó]n)\s*:?\s*/i, "").trim();
  if (!codigo) return false;                       // sin aula no hay nada que dudar
  return !/^\d-\d{3}$/i.test(codigo);
}

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

/** "7:00-7:45A.M." -> {start, end} en minutos, resolviendo el cruce del mediodía.
 *  Sin meridiano se entiende que son las 24 horas. */
export function parseHoras(texto) {
  const limpio = (texto || "").replace(/\s+/g, "");
  const m = HORA.exec(limpio);
  if (m) {
    const h1 = +m[1], m1 = +m[2], h2 = +m[3], m2 = +m[4];
    if (h1 > 12 || h2 > 12 || m1 > 59 || m2 > 59) return null;
    const pm = m[5].toLowerCase() === "p";
    let end = ((h2 % 12) + (pm ? 12 : 0)) * 60 + m2;
    let start = ((h1 % 12) + (pm ? 12 : 0)) * 60 + m1;
    // 11:10-12:55 p.m.: el inicio es de la mañana aunque el meridiano diga p.m.
    if (start >= end) start -= 12 * 60;
    return start >= 0 && start < end ? { start, end } : null;
  }
  const b = HORA24.exec(limpio);
  if (!b) return null;
  const h1 = +b[1], m1 = +b[2], h2 = +b[3], m2 = +b[4];
  if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  const start = h1 * 60 + m1, end = h2 * 60 + m2;
  // Sin meridiano, "1:00-2:00" podría ser la una de la tarde o de la madrugada.
  // En la UTP las clases empiezan a las 7:00, así que antes de esa hora el
  // horario no tiene sentido y se descarta en vez de apuntar en la madrugada.
  return start >= 7 * 60 && start < end ? { start, end } : null;
}

/** Una columna por día, con su posición en la imagen.
 *
 * El cuerpo de la tabla se lee bien, pero los títulos de los días no: en una
 * captura de la UTP salía «[roma [mesas menos | nes ven | mo]» donde debería
 * poner lunes a viernes. Como la tabla siempre va en orden de calendario
 * (lunes, martes, miércoles...), cuando los nombres no se reconocen se sacan
 * las columnas de la geometría —la etiqueta «AULA: 3-422» se repite una vez
 * por columna y su sitio sí es fiel— y se les asignan los días por orden.
 *
 * `anclaje` dice de dónde sale cada x: del centro del nombre del día (va
 * centrado en su celda, así que el límite entre dos celdas es el punto medio)
 * o del borde izquierdo de su «AULA:» (va pegado al borde, así que el límite
 * es justo el de la columna siguiente).
 */
function detectarColumnas(palabras) {
  // 1) Los nombres de los días, si se han leído bien.
  const leidas = [];
  for (const w of palabras) {
    const t = norm(w.text).replace(/[^a-z]/g, "");
    const dia = DIAS.find(([re]) => re.test(t));
    if (dia && !leidas.some((c) => c.day === dia[1])) {
      leidas.push({ day: dia[1], x: centro(w.bbox).x, anclaje: "centro" });
    }
  }
  leidas.sort((a, b) => a.x - b.x);

  // 2) La geometría de las celdas: el borde izquierdo de cada columna es donde
  // empieza su «AULA:». Se agrupan las que caen en la misma columna, que están
  // a unos pocos píxeles, y se dejan fuera las que están en columnas distintas.
  // El sitio se ancla por su borde izquierdo, no por su centro: unas celdas se
  // leen "AULA: 3-422" (dos palabras) y otras "AULA:3-422" (una), y el centro
  // cae en sitios distintos, pero el borde izquierdo es el mismo siempre.
  const etiqueta = (w) => /^(aulas?|sal[oó]n)\b/.test(norm(w.text));
  const xs = palabras.filter(etiqueta).map((w) => w.bbox.x0).sort((a, b) => a - b);
  const margen = Math.max(10, (xs[xs.length - 1] - xs[0]) * 0.02);
  const grupos = xs.length ? [[xs[0]]] : [];
  for (const x of xs.slice(1)) {
    const g = grupos[grupos.length - 1];
    if (x - g[g.length - 1] > margen) grupos.push([x]);
    else g.push(x);
  }
  const geometria = grupos.length >= 3 && grupos.length <= 7
    ? grupos.map((g, i) => ({ day: i, x: g.reduce((a, b) => a + b, 0) / g.length, anclaje: "borde" }))
    : [];

  // Con tres días o más leídos la cabecera está buena: se usan sus nombres. Si
  // no, manda la geometría, que siempre acierta con las columnas pero no sabe
  // qué día es cada una: en el horario de la UTP van de lunes a viernes, así
  // que se numeran por orden. Un solo día no basta para fiarse —un «mar» suelto
  // de «marzo» colaría un martes de mentira—, salvo que cuadre con las columnas.
  if (leidas.length >= 3) return leidas;
  if (geometria.length) return geometria;
  if (leidas.length && leidas.length === grupos.length) return leidas;
  if (leidas.length >= 2) return leidas;
  return [];
}

/** Reparte las palabras reconocidas en la rejilla días × franjas horarias. */
export function construirBloques(palabras, lineas) {
  const columnas = detectarColumnas(palabras);
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
  const bordeX = columnas.map((c, i) => {
    if (c.anclaje === "borde") {
      // La celda va desde su «AULA:» hasta el «AULA:» de la columna siguiente.
      return [
        i === 0 ? c.x - Math.max(10, ancho * 0.15) : c.x,
        i === columnas.length - 1 ? c.x + ancho : columnas[i + 1].x,
      ];
    }
    return [
      i === 0 ? c.x - ancho / 2 : medio(columnas[i - 1].x, c.x),
      i === columnas.length - 1 ? c.x + ancho / 2 : medio(c.x, columnas[i + 1].x),
    ];
  });
  // Cada fila empieza por su hora, así que la banda de una fila llega hasta
  // casi la hora siguiente: el "AULA: 3-422" de una fila va por debajo de la
  // materia y, si se parte la fila por la mitad, se iba a la fila de abajo.
  const altoFila = filas.length > 1 ? filas[1].y - filas[0].y : 40;
  const bordeY = filas.map((f, i) => [
    i === 0 ? f.y - altoFila / 2 : medio(filas[i - 1].y, f.y),
    i === filas.length - 1 ? f.y + altoFila * 0.85 : filas[i + 1].y - altoFila * 0.15,
  ]);

  const celdas = new Map();
  for (const w of palabras) {
    const texto = w.text.trim();
    if (!texto) continue;
    // El OCR de vez en cuando devuelve una caja gigante para un trozo de línea
    // ("[mesas" iba de x=56 a x=999). Si no cabe en una celda, no es de ninguna.
    if (w.bbox.x1 - w.bbox.x0 > ancho * 1.6) continue;
    const { x, y } = centro(w.bbox);
    const ci = bordeX.findIndex(([a, b]) => x >= a && x < b);
    const fi = bordeY.findIndex(([a, b]) => y >= a && y < b);
    if (ci < 0 || fi < 0) continue;
    const clave = `${fi}|${ci}`;
    const trozo = celdas.get(clave) || [];
    trozo.push({ y, x, texto });
    celdas.set(clave, trozo);
  }

  const bloques = [];
  let virtuales = 0;
  for (const [clave, trozos] of celdas) {
    const [fi, ci] = clave.split("|").map(Number);
    // El orden en que arrive el OCR no es el de la tabla: "AULA: 3-422" puede
    // llegar con el código antes que con la palabra. Se lee por filas y de
    // izquierda a derecha, que es como está en el horario.
    const texto = trozos
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((t) => t.texto)
      .join(" ")
      // La columna de las horas se cuela en la primera celda si el borde queda
      // un poco a la izquierda: "7:00-745AM." no es una materia.
      .split(HORA).join(" ").split(HORA24).join(" ")
      // Los bordes de la tabla se cuelan como |, [ o ], o como un guion suelto.
      .replace(/[|\[\]{}<>_~^"'`–—]/g, " ")
      .replace(/\(\s*\)/g, " ")     // paréntesis vacío: el "(L)" que no se leyó
      .replace(/\(\s*$/, "")        // y el que quedó a medias al final
      .replace(/\s+/g, " ")
      .trim();
    if (texto.length < 2) continue;
    const aula = AULA.exec(texto);
    const materia = texto
      .replace(new RegExp(AULA.source, "ig"), " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!materia) continue;
    if (esVirtual(aula ? aula[0] : texto)) { virtuales += 1; continue; }
    bloques.push({
      day: columnas[ci].day,
      start: filas[fi].start,
      end: filas[fi].end,
      subject: materia,
      // "AULA: 3-422" y "AULA:3-422" son la misma aula: se deja con dos puntos
      // y un espacio, que es como lo escribe también el lector de PDF.
      room: aula ? aula[0].replace(/\s*:\s*/, ": ").replace(/\s+/g, " ").replace(/\bn0/i, "N0") : "",
      kind: "clase",
    });
  }
  bloques.sort((a, b) => a.day - b.day || a.start - b.start);
  if (!bloques.length) {
    throw new Error(virtuales
      ? "Todas las clases que se leyeron son virtuales."
      : "Se reconoció la tabla pero no se leyó ninguna clase.");
  }
  bloques.virtuales = virtuales;   // para avisar de cuántas se dejaron fuera
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
