// Diff entre dos snapshots del catálogo del proveedor → reporte Markdown en
// proveedor/reportes/{to}-diff.md. Parte 2 del pipeline (la 1 es pull-proveedor.mjs).
// No toca la red ni Shopify: lee solo archivos de proveedor/snapshots/.
//
//   node diff-proveedor.mjs                            # último snapshot vs el anterior
//   node diff-proveedor.mjs --from 2026-07-10 --to 2026-07-17
//   node diff-proveedor.mjs --to 2026-07-17-2          # sufijo -N para corridas del mismo día
//
// Primera corrida (hay un solo snapshot): compara contra la copia del CSV legacy
// (proveedor/legacy-catalogo-proveedor.csv) matcheando por nombre normalizado; los no
// matcheados van a "Sin correspondencia" (deuda de matching, no son altas ni bajas).
// Matching normal: por id_star (clave primaria estable del sitio).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerCsvObjetos, normalizar, FLAG_CLON, fechaLocalISO } from './lib/proveedor.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIR_PROV = path.join(DIR, 'proveedor');
const DIR_SNAPSHOTS = path.join(DIR_PROV, 'snapshots');
const DIR_REPORTES = path.join(DIR_PROV, 'reportes');
const RUTA_LEGACY = path.join(DIR_PROV, 'legacy-catalogo-proveedor.csv');

const UMBRAL_PRECIO_PCT = 3;   // §8.4: reportar |Δ| ≥ 3%
const UMBRAL_STOCK = 15;       // §8.5: mínimo mayorista 10 + colchón

// ---- args ----
const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? String(args[i + 1] ?? '') : null;
};
const FROM_ARG = argVal('--from');
const TO_ARG = argVal('--to');

// ---- resolver snapshots ----
const RE_BASE = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.csv$/;
const bases = fs.existsSync(DIR_SNAPSHOTS)
  ? fs.readdirSync(DIR_SNAPSHOTS)
      .map((f) => f.match(RE_BASE))
      .filter(Boolean)
      .map((m) => ({ base: m[0].slice(0, -4), fecha: m[1], corrida: m[2] ? parseInt(m[2], 10) : 1 }))
      .sort((a, b) => (a.fecha === b.fecha ? a.corrida - b.corrida : a.fecha < b.fecha ? -1 : 1))
      .map((x) => x.base)
  : [];

if (!bases.length) {
  console.error('No hay snapshots en proveedor/snapshots/. Corré primero: node pull-proveedor.mjs');
  process.exit(1);
}
const validarBase = (b) => {
  if (!bases.includes(b)) {
    console.error(`Snapshot "${b}" inexistente. Disponibles: ${bases.join(', ')}`);
    process.exit(1);
  }
  return b;
};

const toBase = TO_ARG ? validarBase(TO_ARG) : bases[bases.length - 1];
let fromBase = FROM_ARG ? validarBase(FROM_ARG) : bases[bases.indexOf(toBase) - 1] ?? null;
const modoLegacy = !fromBase;
if (modoLegacy && !fs.existsSync(RUTA_LEGACY)) {
  console.error('Hay un solo snapshot y no existe proveedor/legacy-catalogo-proveedor.csv para comparar.');
  process.exit(1);
}
if (fromBase === toBase) {
  console.error('--from y --to apuntan al mismo snapshot.');
  process.exit(1);
}

const rutaSnapshot = (b) => path.join(DIR_SNAPSHOTS, `${b}.csv`);
const de = modoLegacy ? leerCsvObjetos(RUTA_LEGACY) : leerCsvObjetos(rutaSnapshot(fromBase));
const a = leerCsvObjetos(rutaSnapshot(toBase));
const etiquetaFrom = modoLegacy ? 'CSV legacy (pre-pipeline, sin id_star)' : fromBase;

// ---- helpers ----
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const filaTabla = (cols) => `| ${cols.map(esc).join(' | ')} |`;
const seccionTabla = (headers, filas, vacio = '_ninguna_') =>
  filas.length
    ? [filaTabla(headers), `|${headers.map(() => '---').join('|')}|`, ...filas.map((f) => filaTabla(f))].join('\n')
    : vacio;
const esClon = (f) => f.Comentario === FLAG_CLON;
const esCatB2B = (f) => ['ARABE', 'DISENADOR'].includes(normalizar(f['Categoría']));

// ---- matching ----
// pares: [filaFrom, filaTo] · altas: solo en to · bajasOSinCorr: solo en from
const pares = [];
const altas = [];
let bajas = [];
let sinCorrespondencia = [];

if (modoLegacy) {
  // multiset por nombre normalizado (consume de a uno por si hay nombres repetidos)
  const porNombre = new Map();
  for (const f of de.filas) {
    const k = normalizar(f.Producto);
    if (!porNombre.has(k)) porNombre.set(k, []);
    porNombre.get(k).push(f);
  }
  for (const f of a.filas) {
    const cola = porNombre.get(normalizar(f.Producto));
    if (cola?.length) pares.push([cola.shift(), f]);
    else altas.push(f);
  }
  sinCorrespondencia = [...porNombre.values()].flat();
} else {
  const porId = new Map(de.filas.map((f) => [f.id_star, f]));
  for (const f of a.filas) {
    const prev = porId.get(f.id_star);
    if (prev) { pares.push([prev, f]); porId.delete(f.id_star); }
    else altas.push(f);
  }
  bajas = [...porId.values()];
}

// ---- Δ precio ----
const cambiosPrecio = [];
for (const [p, q] of pares) {
  const antes = num(p['Costo USD']);
  const despues = num(q['Costo USD']);
  if (antes === despues) continue;
  const pct = antes > 0 ? ((despues - antes) / antes) * 100 : Infinity;
  if (Math.abs(pct) >= UMBRAL_PRECIO_PCT) cambiosPrecio.push({ f: q, antes, despues, pct });
}
cambiosPrecio.sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct));

// ---- stock crítico (§8.5): no-clon, Árabe/Diseñador, cruzó de ≥15 a <15 ----
const stockCritico = modoLegacy
  ? null // el CSV legacy no tiene stock
  : pares
      .filter(([p, q]) => num(p.stock_star) >= UMBRAL_STOCK && num(q.stock_star) < UMBRAL_STOCK && !esClon(q) && esCatB2B(q))
      .map(([p, q]) => ({ f: q, antes: num(p.stock_star), despues: num(q.stock_star) }))
      .sort((x, y) => x.despues - y.despues);

// ---- censo de marcas ----
const leerCenso = (b) => {
  const ruta = path.join(DIR_SNAPSHOTS, `${b}-marcas.csv`);
  if (!fs.existsSync(ruta)) return null;
  const m = new Map();
  for (const f of leerCsvObjetos(ruta).filas) {
    m.set(`${f.cat_star}·${normalizar(f.Marca)}`, { ...f, conteo: num(f.conteo) });
  }
  return m;
};
const censoTo = leerCenso(toBase);
const censoFrom = modoLegacy ? null : leerCenso(fromBase);

// ---- resumen por categoría ----
const porCategoria = (filas) => {
  const t = new Map();
  for (const f of filas) t.set(f['Categoría'], (t.get(f['Categoría']) || 0) + 1);
  return t;
};
const catFrom = porCategoria(de.filas);
const catTo = porCategoria(a.filas);
const categorias = [...new Set([...catFrom.keys(), ...catTo.keys()])].sort();

// ---- armar Markdown ----
const md = [];
md.push(`# Diff proveedor — ${etiquetaFrom} → ${toBase}`);
md.push('');
md.push(`Generado: ${fechaLocalISO()} · \`diff-proveedor.mjs\` · umbral precio ±${UMBRAL_PRECIO_PCT}% · umbral stock B2B ${UMBRAL_STOCK}`);
md.push('');

// 1. Resumen
md.push('## 1. Resumen');
md.push('');
md.push(seccionTabla(
  ['Categoría', 'antes', 'ahora', 'Δ'],
  categorias.map((c) => {
    const x = catFrom.get(c) || 0;
    const y = catTo.get(c) || 0;
    return [c, String(x), String(y), (y - x >= 0 ? '+' : '') + (y - x)];
  }),
));
md.push('');
md.push(`Total: ${de.filas.length} → ${a.filas.length} filas · **altas: ${altas.length}** · **bajas: ${modoLegacy ? 'n/a (ver Sin correspondencia)' : bajas.length}** · **Δ precio ≥${UMBRAL_PRECIO_PCT}%: ${cambiosPrecio.length}** · **stock crítico: ${stockCritico ? stockCritico.length : 'n/a'}**`);
md.push('');

// 2. Altas
const altasRevisar = altas.filter((f) => f['Categoría'] === 'REVISAR');
const altasResto = altas.filter((f) => f['Categoría'] !== 'REVISAR');
md.push(`## 2. Altas${modoLegacy ? ' (sin correspondencia en el CSV viejo)' : ' (id_star nuevo)'}`);
md.push('');
if (altasRevisar.length) {
  md.push(`### ⚠️ Marcas nuevas sin categoría (REVISAR) — sumarlas a \`proveedor/marcas-categoria.csv\``);
  md.push('');
  md.push(seccionTabla(
    ['Marca', 'Producto', 'Costo USD', 'Stock'],
    altasRevisar.map((f) => [f.Marca, f.Producto, f['Costo USD'], f.stock_star]),
  ));
  md.push('');
}
md.push(seccionTabla(
  ['Marca', 'Producto', 'Categoría', 'Costo USD', 'Stock'],
  altasResto.map((f) => [f.Marca, f.Producto, f['Categoría'], f['Costo USD'], f.stock_star]),
));
md.push('');

// 3. Bajas / Sin correspondencia
if (modoLegacy) {
  md.push('## 3. Sin correspondencia (deuda de matching, no son bajas)');
  md.push('');
  md.push('Filas del CSV legacy que el snapshot no matcheó por nombre. Ver también el reporte de reconciliación de la corrida.');
  md.push('');
  md.push(seccionTabla(
    ['Marca', 'Producto', 'Categoría', 'Costo USD'],
    sinCorrespondencia.map((f) => [f.Marca, f.Producto, f['Categoría'], f['Costo USD']]),
  ));
} else {
  md.push('## 3. Bajas (id_star desaparecido del listado)');
  md.push('');
  md.push('Pueden ser descatalogados **o** fuera de listado temporal (sin stock no se lista). El master las retiene una corrida de gracia; caen recién tras 2 corridas consecutivas ausentes.');
  md.push('');
  md.push(seccionTabla(
    ['Marca', 'Producto', 'Categoría', 'Costo USD', 'Último stock'],
    bajas.map((f) => [f.Marca, f.Producto, f['Categoría'], f['Costo USD'], f.stock_star]),
  ));
}
md.push('');

// 4. Δ precio
const TOPE_PRECIO = 200;
md.push(`## 4. Δ Precio (|Δ| ≥ ${UMBRAL_PRECIO_PCT}%, orden |Δ%| desc)`);
md.push('');
md.push(seccionTabla(
  ['Marca', 'Producto', 'antes', 'después', 'Δ%'],
  cambiosPrecio.slice(0, TOPE_PRECIO).map(({ f, antes, despues, pct }) => [
    f.Marca, f.Producto, antes.toFixed(2), despues.toFixed(2),
    pct === Infinity ? 'n/a (antes 0)' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
  ]),
  '_sin cambios sobre el umbral_',
));
if (cambiosPrecio.length > TOPE_PRECIO) md.push(`\n_… y ${cambiosPrecio.length - TOPE_PRECIO} cambios más bajo el tope de ${TOPE_PRECIO} filas._`);
md.push('');

// 5. Stock crítico
md.push(`## 5. Stock crítico (no-clon, Árabe/Diseñador, cruzó de ≥${UMBRAL_STOCK} a <${UMBRAL_STOCK})`);
md.push('');
if (stockCritico === null) {
  md.push('_n/a: el CSV legacy no tiene stock; disponible a partir del segundo snapshot._');
} else {
  md.push('Insumo para despublicar del catálogo mayorista (mínimo B2B 10 + colchón).');
  md.push('');
  md.push(seccionTabla(
    ['Marca', 'Producto', 'Categoría', 'stock antes', 'stock ahora'],
    stockCritico.map(({ f, antes, despues }) => [f.Marca, f.Producto, f['Categoría'], String(antes), String(despues)]),
    '_ninguno_',
  ));
}
md.push('');

// 6. Censo de marcas (sidebar)
md.push('## 6. Censo de marcas (sidebar del sitio)');
md.push('');
if (!censoTo) {
  md.push(`_No hay censo ${toBase}-marcas.csv._`);
} else if (modoLegacy) {
  const marcasLegacy = new Set(de.filas.map((f) => normalizar(f.Marca)));
  const nuevas = [...censoTo.values()].filter((m) => !marcasLegacy.has(normalizar(m.Marca)));
  md.push(`Marcas en sidebar: ${censoTo.size} (cat 121 + cat 100). Sin censo anterior (primera corrida); se listan las marcas que **no existían** en el CSV legacy:`);
  md.push('');
  md.push(seccionTabla(
    ['cat', 'Marca', 'productos'],
    nuevas.sort((x, y) => y.conteo - x.conteo).map((m) => [m.cat_star, m.Marca, String(m.conteo)]),
  ));
} else if (!censoFrom) {
  md.push(`_Falta ${fromBase}-marcas.csv; sin comparación._`);
} else {
  const claves = [...new Set([...censoFrom.keys(), ...censoTo.keys()])];
  const cambios = [];
  for (const k of claves) {
    const x = censoFrom.get(k);
    const y = censoTo.get(k);
    if ((x?.conteo ?? 0) === (y?.conteo ?? 0)) continue;
    cambios.push([
      (y ?? x).cat_star,
      (y ?? x).Marca,
      x ? String(x.conteo) : '—(nueva)',
      y ? String(y.conteo) : '—(desapareció)',
      String((y?.conteo ?? 0) - (x?.conteo ?? 0)),
    ]);
  }
  cambios.sort((p, q) => Math.abs(Number(q[4])) - Math.abs(Number(p[4])));
  md.push(seccionTabla(['cat', 'Marca', 'antes', 'ahora', 'Δ'], cambios, '_sin cambios_'));
  md.push('');
  md.push(`_Marcas sin cambios: ${claves.length - cambios.length}._`);
}
md.push('');

// ---- escribir + resumen consola ----
fs.mkdirSync(DIR_REPORTES, { recursive: true });
const rutaReporte = path.join(DIR_REPORTES, `${toBase}-diff.md`);
fs.writeFileSync(rutaReporte, md.join('\n'), 'utf8');

console.log(`Diff ${etiquetaFrom} → ${toBase}`);
console.log(`  altas: ${altas.length} (REVISAR: ${altasRevisar.length}) · bajas: ${modoLegacy ? `n/a · sin correspondencia: ${sinCorrespondencia.length}` : bajas.length}`);
console.log(`  Δ precio ≥${UMBRAL_PRECIO_PCT}%: ${cambiosPrecio.length} · stock crítico: ${stockCritico ? stockCritico.length : 'n/a'}`);
console.log(`  → ${rutaReporte}`);
