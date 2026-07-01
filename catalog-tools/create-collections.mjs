// Crea colecciones automáticas por METAFIELD (regla PRODUCT_METAFIELD_DEFINITION, no por tag).
// Cubre DOS facets en una pasada: `familia_olfativa` y `casa`. Idempotente: sólo crea las de
// valores EN USO que todavía no tienen colección. Re-correr a medida que crece el catálogo
// agrega los valores nuevos.
//
//   node create-collections.mjs            # crea las que faltan (familia + casa)
//   node create-collections.mjs --dry-run  # muestra qué crearía, sin escribir
//
// Las colecciones por género (Masculino/Femenino/Unisex) y por marca (regla VENDOR) ya existen
// en la tienda; este script no las toca. Requiere que las definiciones existan y tengan la
// capability smartCollectionCondition habilitada → corré antes `npm run setup`.

import { gql, loadDotEnv } from './lib/shopify.mjs';

await loadDotEnv();
const DRY = process.argv.includes('--dry-run');

const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Un metafield facet puede ser lista (JSON array) o texto plano → normalizamos a array de valores.
function parseValues(raw) {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [String(a)];
  } catch {
    return [String(raw)];
  }
}

// Grupos de colección por facet. `title`/`handle` se derivan del valor del metafield.
// familia → título "Perfumes X" y handle derivado por Shopify (comportamiento histórico).
// casa    → títulos y handles fijos (Árabes / Diseñador / Nicho) para linkear estable desde el theme.
const GROUPS = [
  {
    key: 'familia_olfativa',
    label: 'familia olfativa',
    title: (v) => `Perfumes ${v}`,
    handle: null,
  },
  {
    key: 'casa',
    label: 'casa',
    title: (v) => ({ Árabe: 'Árabes', Diseñador: 'Diseñador', Nicho: 'Nicho' }[v] || v),
    handle: (v) => ({ Árabe: 'arabes', Diseñador: 'disenador', Nicho: 'nicho' }[v] || slugify(v)),
  },
];

// 1) GID de cada definición facet (lo necesita la regla por metafield).
const defs = await gql(`{
  metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "custom") { nodes { key id } }
}`);
const gidByKey = {};
for (const n of defs.metafieldDefinitions.nodes) gidByKey[n.key] = n.id;

// 2) Valores EN USO por facet (una sola pasada por el catálogo).
const usage = {}; // key -> Map(valor -> cantidad de productos)
for (const g of GROUPS) usage[g.key] = new Map();
let cursor = null;
do {
  const data = await gql(`query($c: String) {
    products(first: 100, after: $c, query: "product_type:Perfume") {
      pageInfo { hasNextPage endCursor }
      nodes { metafields(first: 50, namespace: "custom") { nodes { key value } } }
    }
  }`, { c: cursor });
  for (const p of data.products.nodes) {
    for (const mf of p.metafields.nodes) {
      if (!usage[mf.key]) continue;
      for (const val of parseValues(mf.value)) usage[mf.key].set(val, (usage[mf.key].get(val) || 0) + 1);
    }
  }
  cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
} while (cursor);

// 3) Condiciones PRODUCT_METAFIELD_DEFINITION ya usadas por alguna colección (dedupe).
// Los valores de familia/casa/género son disjuntos entre sí → un set global alcanza.
const existing = new Set();
let cc = null;
do {
  const data = await gql(`query($c: String) {
    collections(first: 100, after: $c) {
      pageInfo { hasNextPage endCursor }
      nodes { ruleSet { rules { column condition } } }
    }
  }`, { c: cc });
  for (const col of data.collections.nodes) {
    if (!col.ruleSet) continue;
    for (const r of col.ruleSet.rules) if (r.column === 'PRODUCT_METAFIELD_DEFINITION') existing.add(r.condition);
  }
  cc = data.collections.pageInfo.hasNextPage ? data.collections.pageInfo.endCursor : null;
} while (cc);

// 4) Crear las que falten.
const CREATE = `
  mutation($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id title handle }
      userErrors { field message }
    }
  }
`;

let created = 0;
let skipped = 0;
let missing = 0;
for (const g of GROUPS) {
  const gid = gidByKey[g.key];
  console.log(`\n=== ${g.label} (custom.${g.key})${DRY ? ' · DRY-RUN' : ''} ===`);
  if (!gid) {
    console.warn(`  ⚠️ no existe la definición custom.${g.key} → corré 'npm run setup'. Grupo salteado.`);
    missing++;
    continue;
  }
  const values = [...usage[g.key]].sort((a, b) => a[0].localeCompare(b[0]));
  if (!values.length) {
    console.log('  (sin valores en uso todavía)');
    continue;
  }
  for (const [value, count] of values) {
    if (existing.has(value)) {
      console.log(`  · ${value} — ya tiene colección [${count} prod]`);
      skipped++;
      continue;
    }
    const input = {
      title: g.title(value),
      ...(g.handle ? { handle: g.handle(value) } : {}),
      ruleSet: {
        appliedDisjunctively: false,
        rules: [{ column: 'PRODUCT_METAFIELD_DEFINITION', relation: 'EQUALS', condition: value, conditionObjectId: gid }],
      },
    };
    if (DRY) {
      console.log(`  + crearía "${input.title}"${input.handle ? ` {${input.handle}}` : ''} [${count} prod]`);
      created++;
      continue;
    }
    const data = await gql(CREATE, { input });
    const { collection, userErrors } = data.collectionCreate;
    if (collection) {
      console.log(`  ✓ ${collection.title} {${collection.handle}} (${count} prod)`);
      created++;
    } else {
      console.error(`  ✗ ${value}:`, JSON.stringify(userErrors));
      process.exitCode = 1;
    }
  }
}

console.log(`\nListo: ${created} ${DRY ? 'a crear' : 'creadas'}, ${skipped} ya existían${missing ? `, ${missing} grupo(s) sin definición (corré setup)` : ''}.`);
