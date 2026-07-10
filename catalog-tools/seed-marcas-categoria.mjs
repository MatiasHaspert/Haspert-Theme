// One-off: genera proveedor/marcas-categoria.csv (marca → categoría dominante) desde el
// catalogo-proveedor.csv vigente. Es el seed del paso 3 de la cascada de clasificación
// de pull-proveedor.mjs (los pasos 1-2, Tester/Nicho por nombre y slug, corren antes).
//
//   node seed-marcas-categoria.mjs
//
// Reglas:
//   - Las filas Tester se excluyen del conteo (el tester es presentación, no posicionamiento
//     de marca). Marcas que SOLO tienen testers no entran al mapa: un producto nuevo no-tester
//     de esas marcas cae a REVISAR, que es lo correcto (decisión humana).
//   - Empates de categoría dominante: gana la de más filas; si empatan, se avisa y se elige
//     la primera alfabéticamente. Revisar a mano.
//   - REVISAR nunca se seedea (es el fallback de la cascada, no una categoría real).
//
// Se conserva en el repo por trazabilidad. Re-correrlo PISA proveedor/marcas-categoria.csv:
// si editaste el archivo a mano (altas de marcas nuevas), mergeá antes de pisar.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerCsvObjetos, escribirCsv, normalizar, FLAG_CLON } from './lib/proveedor.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RUTA_CATALOGO = path.join(DIR, 'catalogo-proveedor.csv');
const DIR_PROV = path.join(DIR, 'proveedor');
const RUTA_SALIDA = path.join(DIR_PROV, 'marcas-categoria.csv');
const RUTA_CLONES = path.join(DIR_PROV, 'marcas-clones.txt');

const { filas } = leerCsvObjetos(RUTA_CATALOGO);
console.log(`Leídas ${filas.length} filas de ${path.basename(RUTA_CATALOGO)}`);

// marca (normalizada) → { display, conteos: {categoría: n}, testers: n, clones: n }
const marcas = new Map();
for (const f of filas) {
  const clave = normalizar(f.Marca);
  if (!clave) continue;
  if (!marcas.has(clave)) marcas.set(clave, { display: f.Marca, conteos: {}, testers: 0, clones: 0 });
  const m = marcas.get(clave);
  const cat = f['Categoría'];
  if (cat === 'Tester') m.testers++;
  else if (cat && cat !== 'REVISAR') m.conteos[cat] = (m.conteos[cat] || 0) + 1;
  if (f.Comentario === FLAG_CLON) m.clones++;
}

const salida = [];
const soloTester = [];
const empates = [];
for (const [, m] of [...marcas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const cats = Object.entries(m.conteos).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!cats.length) { soloTester.push(m.display); continue; }
  if (cats.length > 1 && cats[0][1] === cats[1][1]) {
    empates.push(`${m.display}: ${cats.map(([c, n]) => `${c}=${n}`).join(' ')}`);
  }
  salida.push({ Marca: m.display, 'Categoría': cats[0][0] });
}

fs.mkdirSync(DIR_PROV, { recursive: true });
escribirCsv(RUTA_SALIDA, ['Marca', 'Categoría'], salida);
console.log(`Escrito ${RUTA_SALIDA}: ${salida.length} marcas`);

if (soloTester.length) {
  console.log(`\nMarcas SOLO-tester (fuera del mapa; sus no-testers nuevos caerán a REVISAR): ${soloTester.join(', ')}`);
}
if (empates.length) {
  console.log(`\n⚠️ Empates de categoría dominante (elegida la primera alfabética, revisá a mano):\n  ${empates.join('\n  ')}`);
}

// Cross-check contra la lista de clones: flags por fila en marcas fuera de la lista.
const clonesLista = new Set(
  fs.readFileSync(RUTA_CLONES, 'utf8').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map(normalizar),
);
const flagFueraDeLista = [...marcas.values()].filter((m) => m.clones > 0 && !clonesLista.has(normalizar(m.display)));
const totalFlags = [...marcas.values()].reduce((a, m) => a + m.clones, 0);
console.log(`\nFilas con flag "${FLAG_CLON}": ${totalFlags}`);
if (flagFueraDeLista.length) {
  console.log('Marcas con flag por-fila FUERA de marcas-clones.txt (el pull las preserva por matching de nombre):');
  for (const m of flagFueraDeLista) console.log(`  ${m.display}: ${m.clones} filas flageadas`);
}
