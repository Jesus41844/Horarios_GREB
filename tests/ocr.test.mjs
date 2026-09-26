// Comprobaciones del analizador del OCR.  Ejecutar:  node tests/ocr.test.mjs
import { parseHoras, construirBloques } from "../public/js/ocr.js";
let fallos = 0;
const eq = (a, b, nombre) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { console.log(`FALLA ${nombre}:`, JSON.stringify(a), "≠", JSON.stringify(b)); fallos++; }
};

// --- horas
eq(parseHoras("7:00-7:45A.M."), { start: 420, end: 465 }, "mañana");
eq(parseHoras("10:20-11:05 A.M"), { start: 620, end: 665 }, "sin punto final");
eq(parseHoras("2:00-3:30P.M."), { start: 840, end: 930 }, "tarde");
eq(parseHoras("7:00-745AM."), { start: 420, end: 465 }, "el OCR se come el segundo dos puntos");
eq(parseHoras("11:10-1155A.M."), { start: 670, end: 715 }, "los dos dos puntos perdidos");
eq(parseHoras("16:00-17:40"), { start: 960, end: 1060 }, "sin meridiano, de tarde");
eq(parseHoras("1:00-2:00"), null, "a la una de la madrugada nadie tiene clases");
eq(parseHoras("7:00-8:00"), { start: 420, end: 480 }, "sin meridiano, a primera hora");
eq(parseHoras("11:10-12:55 P.M."), { start: 670, end: 775 }, "cruza el mediodía");
eq(parseHoras("12:00-12:45P.M."), { start: 720, end: 765 }, "mediodía");
eq(parseHoras("basura"), null, "texto sin horas");
eq(parseHoras("25:00-26:00A.M."), null, "hora imposible");

// --- rejilla: dos días, dos franjas
const w = (text, x, y) => ({ text, bbox: { x0: x - 20, x1: x + 20, y0: y - 8, y1: y + 8 } });
const palabras = [
  w("LUNES", 200, 50), w("MARTES", 400, 50),
  w("HER.", 190, 110), w("PROG.", 215, 110), w("aula", 185, 128), w("3-405", 212, 128),
  w("ING.SOFT.II", 400, 110), w("aula", 385, 128), w("3-420", 412, 128),
  w("MET.", 195, 190), w("INV.ING.", 225, 190),
];
const lineas = [
  { text: "7:00-7:45A.M.", bbox: { x0: 20, x1: 120, y0: 100, y1: 120 } },
  { text: "7:50-8:35A.M.", bbox: { x0: 20, x1: 120, y0: 180, y1: 200 } },
];
const bloques = construirBloques(palabras, lineas);
eq(bloques.length, 3, "número de bloques");
eq(bloques[0], { day: 0, start: 420, end: 465, subject: "HER. PROG.", room: "aula 3-405", kind: "clase" }, "celda lunes 1");
eq(bloques[1], { day: 0, start: 470, end: 515, subject: "MET. INV.ING.", room: "", kind: "clase" }, "celda lunes 2");
eq(bloques[2], { day: 1, start: 420, end: 465, subject: "ING.SOFT.II", room: "aula 3-420", kind: "clase" }, "celda martes");

// --- sin días reconocibles
try { construirBloques([w("hola", 10, 10)], lineas); console.log("FALLA: debería quejarse"); fallos++; }
catch (e) { if (!/no aparecen los días/.test(e.message)) { console.log("FALLA mensaje:", e.message); fallos++; } }


// --- códigos de aula
import { aulaDudosa } from "../public/js/ocr.js";
const dudas = { "aula 3-405": false, "SALON 1-213": false, "AULA: 3-405": false,
                "AULA:3-422": false, "aula 3-N0?": true, "Salon ?-N03": true,
                "aula 3421": true, "AULA: 3422": true, "": false };
for (const [texto, esperado] of Object.entries(dudas)) eq(aulaDudosa(texto), esperado, `dudosa(${texto})`);

// --- el OCR se come el guion del código: cuatro dígitos se parten solos
import { normalizarAula } from "../public/js/ocr.js";
for (const [texto, esperado] of Object.entries({
  "aula 3-405": "aula 3-405", "AULA: 3-422": "AULA: 3-422", "AULA:3-422": "AULA: 3-422",
  "AULA:3422": "AULA: 3-422", "aula 3421": "aula 3-421", "AULA: 3422": "AULA: 3-422",
  "Salon 1234": "Salon 1-234", "aula 3 422": "aula 3-422", "aula 3n03": "aula 3n03",
  "aula 3-N03": "aula 3-N03", "aula 13422": "aula 13422", "": "" }))
  eq(normalizarAula(texto), esperado, `normalizarAula(${texto})`);
// Y una vez normalizado, el código ya no se marca para revisar.
for (const texto of ["AULA:3422", "aula 3421"]) eq(aulaDudosa(normalizarAula(texto)), false, `dudosa tras normalizar(${texto})`);

// --- el OCR reconoce Salón y deja fuera las virtuales
import { esVirtual } from "../public/js/ocr.js";
for (const [t, e] of Object.entries({
  "Salón 2-N01": true, "aula 3-N03": true, "aula 3-N09": true, "aula 4-N01": true,
  "aula 3-405": false, "Salón 2-301": false, "aula 1-213": false }))
  eq(esVirtual(t), e, `esVirtual(${t})`);

const lineas2 = [
  { text: "8:40-9:25A.M.", bbox: { x0: 20, x1: 120, y0: 100, y1: 120 } },
  { text: "9:30-10:15A.M.", bbox: { x0: 20, x1: 120, y0: 180, y1: 200 } },
];
const palabras2 = [
  w("LUNES", 200, 50),
  // Virtual: se descarta.
  w("MET.", 190, 110), w("INV.ING.", 220, 110), w("Salón", 185, 128), w("3-N03", 215, 128),
  // Presencial en un «Salón»: debe salir, con el salón como sitio.
  w("ING.SOFT.II", 200, 190), w("Salón", 185, 208), w("1-213", 215, 208),
];
const b2 = construirBloques(palabras2, lineas2);
eq(b2.length, 1, "solo queda la presencial");
eq(b2.virtuales, 1, "se cuenta la virtual descartada");
eq(b2[0].subject, "ING.SOFT.II", "materia sin el salón");
eq(b2[0].room, "Salón 1-213", "el salón cuenta como sitio");

// Si todas son virtuales, se avisa en vez de devolver una lista vacía.
try {
  construirBloques(palabras2.slice(0, 5), [lineas2[0]]);
  console.log("FALLA: debería avisar de que todas son virtuales"); fallos++;
} catch (e) {
  if (!/virtuales/.test(e.message)) { console.log("FALLA mensaje:", e.message); fallos++; }
}

// --- Una captura real de la UTP: los títulos de los días salen como basura, las
// horas pierden el segundo ":" y las celdas van de un «AULA:» al siguiente.
// Cada aula lleva un código distinto, así que si algo se cuela de una celda a
// otra el test lo nota.
const palabra = (t, x0, x1, y) => ({ text: t, bbox: { x0, x1, y0: y - 8, y1: y + 8 } });
const aula = (x0, codigo, y) => [palabra("AULA:", x0, x0 + 44, y), palabra(codigo, x0 + 50, x0 + 88, y)];
const utp = [
  // Cabecera ilegible, con una caja enorme que el OCR inventó.
  palabra("[roma", 52, 118, 229), palabra("[mesas", 56, 999, 234),
  palabra("menos", 466, 574, 229), palabra("nes", 634, 718, 229),
  palabra("ven", 754, 808, 229), palabra("mo]", 898, 1000, 229),
  // 7:00-7:45.
  palabra("7:00-745AM.", 62, 157, 264),
  palabra("|MATEMSUPE", 204, 303, 266), palabra("RING", 233, 274, 287),
  ...aula(209, "3-422", 308),
  palabra("SISTEMAS", 350, 427, 265), palabra("COLAB.", 363, 418, 288),
  ...aula(346, "3-425", 308),
  palabra("MET.", 487, 522, 266), palabra("NUM.", 528, 566, 266), palabra("ING.", 514, 543, 287),
  ...aula(484, "3-431", 308),
  palabra("LENG.", 629, 669, 266), palabra("DE", 679, 699, 266), palabra("PRO", 632, 664, 288),
  ...aula(622, "3-404", 308),
  palabra("LENG.", 755, 795, 266), palabra("DE", 805, 826, 266), palabra("PRO", 770, 802, 288),
  ...aula(748, "3-437", 308),
  // 7:50-8:35: el lunes es una clase virtual y el OCR la leyó toda junta.
  palabra("7:50-835AM.", 62, 157, 330),
  palabra("MATEMSUPE", 214, 313, 332), palabra("RING", 233, 274, 353),
  palabra("AULA: 3-N02 |", 208, 320, 374),
  palabra("SISTEMAS", 350, 427, 331), palabra("COLAB.", 363, 418, 354),
  ...aula(346, "3-426", 374),
];
const lineasUtp = [
  { text: "7:00-745AM.", bbox: { x0: 62, x1: 157, y0: 256, y1: 272 } },
  { text: "7:50-835AM.", bbox: { x0: 62, x1: 157, y0: 322, y1: 338 } },
];
const b3 = construirBloques(utp, lineasUtp);
eq(b3.length, 6, "las seis clases que no son virtuales");
eq(b3.virtuales, 1, "la clase virtual del lunes se descarta");
eq(b3[0], { day: 0, start: 420, end: 465, subject: "MATEMSUPE RING", room: "AULA: 3-422", kind: "clase" },
   "el lunes de 7:00 con el aula de su propia fila");
eq(b3[1], { day: 1, start: 420, end: 465, subject: "SISTEMAS COLAB.", room: "AULA: 3-425", kind: "clase" },
   "el martes de 7:00");
eq(b3[2], { day: 1, start: 470, end: 515, subject: "SISTEMAS COLAB.", room: "AULA: 3-426", kind: "clase" },
   "el martes de 7:50, con el aula de esa fila y no el de la de arriba");
eq(b3[3], { day: 2, start: 420, end: 465, subject: "MET. NUM. ING.", room: "AULA: 3-431", kind: "clase" },
   "el miércoles sin restos de la cabecera");
eq(b3[4], { day: 3, start: 420, end: 465, subject: "LENG. DE PRO", room: "AULA: 3-404", kind: "clase" },
   "el jueves");
eq(b3[5], { day: 4, start: 420, end: 465, subject: "LENG. DE PRO", room: "AULA: 3-437", kind: "clase" },
   "el viernes, en su propia columna");
for (const bloque of b3) {
  if (/7:00|7:50|mesas|roma/.test(bloque.subject)) {
    console.log("FALLA: la materia se tragó otra cosa:", bloque.subject); fallos++;
  }
}

console.log(fallos ? `${fallos} fallos` : "todas las comprobaciones del OCR pasan");
