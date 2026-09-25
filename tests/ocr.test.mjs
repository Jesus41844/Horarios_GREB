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
const dudas = { "aula 3-405": false, "SALON 1-213": false,
                "aula 3-N0?": true, "Salon ?-N03": true, "aula 3421": true, "": false };
for (const [texto, esperado] of Object.entries(dudas)) eq(aulaDudosa(texto), esperado, `dudosa(${texto})`);

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

console.log(fallos ? `${fallos} fallos` : "todas las comprobaciones del OCR pasan");
