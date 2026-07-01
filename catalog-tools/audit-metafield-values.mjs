// AUDITORÍA de valores de metafields facetables — SOLO LECTURA (no escribe nada).
// Recorre todos los productos Perfume y, por cada facet, lista los valores DISTINTOS en uso
// con su conteo, y marca inconsistencias que crean "facets fantasma" y rompen filtros al escalar:
//   - espacios sobrantes    ("Amaderado " vs "Amaderado")
//   - fuera de lista cerrada (valor que no está en las choices de la definición)
//   - duplicados por forma   (misma forma normalizada: mayúsculas/acentos → "amaderado" vs "Amaderado")
//
//   node audit-metafield-values.mjs
//
// Las choices (lista cerrada) se leen EN VIVO de las validations de cada definición → siempre
// sincronizado con setup-metafields. Corré esto antes de una carga grande para normalizar primero.

import { gql, loadDotEnv } from './lib/shopify.mjs';

await loadDotEnv();

// Facets a auditar (= FACET_KEYS de setup-metafields).
const FACETS = ['familia_olfativa', 'casa', 'genero', 'ocasion', 'estacion', 'longevidad', 'concentracion'];

const normalize = (s) =>
  String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function parseValues(raw) {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [String(a)];
  } catch {
    return [String(raw)];
  }
}

// 1) choices (lista cerrada) por facet, desde las validations de la definición.
const defsData = await gql(`{
  metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "custom") {
    nodes { key validations { name value } }
  }
}`);
const choicesByKey = {};
const existsByKey = {};
for (const n of defsData.metafieldDefinitions.nodes) {
  existsByKey[n.key] = true;
  const ch = n.validations.find((v) => v.name === 'choices');
  if (ch) {
    try { choicesByKey[n.key] = JSON.parse(ch.value); } catch { choicesByKey[n.key] = []; }
  }
}

// 2) Recorrer catálogo y tallar valores por facet.
const tally = {}; // key -> Map(valorRaw -> cantidad)
for (const k of FACETS) tally[k] = new Map();
let cursor = null;
let productCount = 0;
do {
  const data = await gql(`query($c: String) {
    products(first: 100, after: $c, query: "product_type:Perfume") {
      pageInfo { hasNextPage endCursor }
      nodes { metafields(first: 50, namespace: "custom") { nodes { key value } } }
    }
  }`, { c: cursor });
  for (const p of data.products.nodes) {
    productCount++;
    for (const mf of p.metafields.nodes) {
      if (!tally[mf.key]) continue;
      for (const v of parseValues(mf.value)) tally[mf.key].set(v, (tally[mf.key].get(v) || 0) + 1);
    }
  }
  cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
} while (cursor);

// 3) Reporte.
console.log(`Auditoría de valores · ${productCount} producto(s) Perfume · SOLO LECTURA\n`);
let totalWarn = 0;
for (const key of FACETS) {
  const map = tally[key];
  const choices = choicesByKey[key] || null;
  const choiceSet = new Set(choices || []);
  const header = `### custom.${key}` +
    (existsByKey[key] ? '' : '  ⚠️ definición NO existe (corré setup)') +
    (choices ? ` · lista cerrada (${choices.length})` : '  (sin lista cerrada)');
  console.log(`\n${header}`);
  if (!map.size) {
    console.log('  (sin valores en uso todavía)');
    continue;
  }

  const rows = [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [val, count] of rows) {
    const flags = [];
    if (val !== val.trim()) flags.push('espacios');
    if (choices && !choiceSet.has(val)) flags.push('fuera-de-lista');
    const mark = flags.length ? `  ⚠️ ${flags.join(', ')}` : '';
    if (flags.length) totalWarn++;
    console.log(`  ${String(count).padStart(3)} × "${val}"${mark}`);
  }

  // Duplicados por forma normalizada (case/acentos/espacios).
  const byNorm = new Map();
  for (const val of map.keys()) {
    const n = normalize(val);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(val);
  }
  for (const [n, variants] of byNorm) {
    if (variants.length > 1) {
      console.log(`  ⚠️ posible duplicado (misma forma "${n}"): ${variants.map((v) => `"${v}"`).join(' vs ')}`);
      totalWarn++;
    }
  }
}

console.log(
  `\n${totalWarn
    ? `⚠️ ${totalWarn} inconsistencia(s) a revisar/normalizar antes de escalar el catálogo.`
    : '✅ Sin inconsistencias: valores limpios y dentro de la lista cerrada.'}`
);
