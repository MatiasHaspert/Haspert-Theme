// Crea colecciones automáticas para los ejes de navegación, en una pasada:
//   - `familia_olfativa` y `casa` → regla por METAFIELD (PRODUCT_METAFIELD_DEFINITION, no por tag)
//   - marca → regla por VENDOR (campo nativo del producto)
// Idempotente: sólo crea las de valores EN USO que todavía no tienen colección — más los
// `ensure` de cada grupo, que se crean SIEMPRE (haya o no productos: son estructurales,
// la navegación los linkea). Re-correr a medida que crece el catálogo agrega valores/marcas nuevos.
//
//   node create-collections.mjs            # crea las que faltan (familia + casa + marca)
//   node create-collections.mjs --dry-run  # muestra qué crearía, sin escribir
//
// Las colecciones por género (Masculino/Femenino/Unisex) ya existen en la tienda; este script
// no las toca. Los grupos por metafield requieren que las definiciones existan y tengan la
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

// Grupos de colección. `title`/`handle` se derivan del valor (metafield o vendor).
// familia → título "Perfumes X" y handle derivado por Shopify (comportamiento histórico).
// casa    → títulos y handles fijos (Árabes / Diseñador / Nicho) para linkear estable desde el theme.
// marca   → vendor tal cual como título, handle slugificado (Maison Alhambra → maison-alhambra).
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
    // Estructurales: el menú principal linkea las tres casas → deben existir aunque
    // todavía no haya productos de esa casa (la colección queda vacía hasta cargarlos).
    ensure: ['Árabe', 'Diseñador', 'Nicho'],
    title: (v) => ({ Árabe: 'Árabes', Diseñador: 'Diseñador', Nicho: 'Nicho' }[v] || v),
    handle: (v) => ({ Árabe: 'arabes', Diseñador: 'disenador', Nicho: 'nicho' }[v] || slugify(v)),
  },
  {
    key: 'vendor',
    label: 'marca',
    vendor: true, // regla VENDOR (campo nativo del producto), no metafield
    title: (v) => v,
    handle: (v) => slugify(v),
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
      nodes { vendor metafields(first: 50, namespace: "custom") { nodes { key value } } }
    }
  }`, { c: cursor });
  for (const p of data.products.nodes) {
    if (usage.vendor && p.vendor) usage.vendor.set(p.vendor, (usage.vendor.get(p.vendor) || 0) + 1);
    for (const mf of p.metafields.nodes) {
      if (!usage[mf.key]) continue;
      for (const val of parseValues(mf.value)) usage[mf.key].set(val, (usage[mf.key].get(val) || 0) + 1);
    }
  }
  cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
} while (cursor);

// 3) Condiciones ya usadas por alguna colección (dedupe), separadas por tipo de regla:
// metafield (familia/casa/género: valores disjuntos entre sí → un set alcanza) y VENDOR.
const existing = new Set();
const existingVendor = new Set();
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
    for (const r of col.ruleSet.rules) {
      if (r.column === 'PRODUCT_METAFIELD_DEFINITION') existing.add(r.condition);
      if (r.column === 'VENDOR') existingVendor.add(r.condition);
    }
  }
  cc = data.collections.pageInfo.hasNextPage ? data.collections.pageInfo.endCursor : null;
} while (cc);

// 3.5) Publicaciones (canales de venta): una colección creada por API nace SIN publicar
// (404 en el storefront) → tras crearla se publica a todos los canales, como hace el
// Admin al crear a mano. Si falta el scope read_publications, avisar y publicar a mano.
let publications = [];
if (!DRY) {
  try {
    const p = await gql(`{ publications(first: 20) { nodes { id name } } }`);
    publications = p.publications.nodes;
  } catch (e) {
    console.warn(`⚠️ No pude leer los canales de venta (¿scope read_publications?): ${e.message}`);
    console.warn('   → publicá las colecciones nuevas a mano en Admin → Colecciones.');
  }
}

const PUBLISH = `
  mutation($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) { userErrors { field message } }
  }
`;

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
  const source = g.vendor ? 'vendor' : `custom.${g.key}`;
  console.log(`\n=== ${g.label} (${source})${DRY ? ' · DRY-RUN' : ''} ===`);
  if (!g.vendor && !gid) {
    console.warn(`  ⚠️ no existe la definición custom.${g.key} → corré 'npm run setup'. Grupo salteado.`);
    missing++;
    continue;
  }
  if (g.ensure) {
    for (const v of g.ensure) if (!usage[g.key].has(v)) usage[g.key].set(v, 0);
  }
  const values = [...usage[g.key]].sort((a, b) => a[0].localeCompare(b[0]));
  if (!values.length) {
    console.log('  (sin valores en uso todavía)');
    continue;
  }
  const seen = g.vendor ? existingVendor : existing;
  for (const [value, count] of values) {
    if (seen.has(value)) {
      console.log(`  · ${value} — ya tiene colección [${count} prod]`);
      skipped++;
      continue;
    }
    const rule = g.vendor
      ? { column: 'VENDOR', relation: 'EQUALS', condition: value }
      : { column: 'PRODUCT_METAFIELD_DEFINITION', relation: 'EQUALS', condition: value, conditionObjectId: gid };
    const input = {
      title: g.title(value),
      ...(g.handle ? { handle: g.handle(value) } : {}),
      ruleSet: {
        appliedDisjunctively: false,
        rules: [rule],
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
      let pubNote = '';
      if (publications.length) {
        const pub = await gql(PUBLISH, {
          id: collection.id,
          input: publications.map((p) => ({ publicationId: p.id })),
        });
        const pubErrs = pub.publishablePublish.userErrors;
        pubNote = pubErrs.length
          ? ` · ⚠️ sin publicar: ${JSON.stringify(pubErrs)}`
          : ` · publicada (${publications.length} canales)`;
      }
      console.log(`  ✓ ${collection.title} {${collection.handle}} (${count} prod)${pubNote}`);
      created++;
    } else {
      console.error(`  ✗ ${value}:`, JSON.stringify(userErrors));
      process.exitCode = 1;
    }
  }
}

console.log(`\nListo: ${created} ${DRY ? 'a crear' : 'creadas'}, ${skipped} ya existían${missing ? `, ${missing} grupo(s) sin definición (corré setup)` : ''}.`);
