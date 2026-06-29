// Crea colecciones automáticas por FAMILIA OLFATIVA (regla por metafield, no por tag).
// Idempotente: solo crea las de familias que tienen ≥1 producto y todavía no tienen colección.
// Re-correr a medida que crece el catálogo agrega las familias nuevas.
//
//   node create-collections.mjs            # crea las que faltan
//   node create-collections.mjs --dry-run  # muestra qué crearía, sin escribir
//
// Las colecciones por género (Masculino/Femenino/Unisex) y por marca ya existen en la tienda;
// este script solo cubre familia_olfativa.

import { gql, loadDotEnv } from './lib/shopify.mjs';

await loadDotEnv();
const DRY = process.argv.includes('--dry-run');

// 1) GID de la definición familia_olfativa (lo necesita la regla por metafield).
const defs = await gql(`{
  metafieldDefinitions(first: 50, ownerType: PRODUCT, namespace: "custom") { nodes { key id } }
}`);
const familiaGid = defs.metafieldDefinitions.nodes.find((d) => d.key === 'familia_olfativa')?.id;
if (!familiaGid) throw new Error('No existe la definición custom.familia_olfativa (corré npm run setup).');

// 2) Familias EN USO (recorre todos los perfumes y junta los valores del metafield).
const familiesInUse = new Map(); // familia -> cantidad de productos
let cursor = null;
do {
  const data = await gql(`query($c: String) {
    products(first: 100, after: $c, query: "product_type:Perfume") {
      pageInfo { hasNextPage endCursor }
      nodes { metafield(namespace: "custom", key: "familia_olfativa") { value } }
    }
  }`, { c: cursor });
  for (const p of data.products.nodes) {
    if (!p.metafield?.value) continue;
    let arr = [];
    try { arr = JSON.parse(p.metafield.value); } catch {}
    for (const f of arr) familiesInUse.set(f, (familiesInUse.get(f) || 0) + 1);
  }
  cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
} while (cursor);

// 3) Familias que YA tienen colección (regla por metafield).
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
    for (const r of col.ruleSet.rules) {
      if (r.column === 'PRODUCT_METAFIELD_DEFINITION') existing.add(r.condition);
    }
  }
  cc = data.collections.pageInfo.hasNextPage ? data.collections.pageInfo.endCursor : null;
} while (cc);

// 4) Crear las que faltan.
const CREATE = `
  mutation($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id title handle }
      userErrors { field message }
    }
  }
`;

console.log(`Familias en uso: ${[...familiesInUse.keys()].join(', ') || '(ninguna)'}${DRY ? ' · DRY-RUN' : ''}\n`);

let created = 0;
let skipped = 0;
for (const [familia, count] of [...familiesInUse].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (existing.has(familia)) {
    console.log(`  · ${familia} — ya tiene colección [${count} prod]`);
    skipped++;
    continue;
  }
  const input = {
    title: `Perfumes ${familia}`,
    ruleSet: {
      appliedDisjunctively: false,
      rules: [{ column: 'PRODUCT_METAFIELD_DEFINITION', relation: 'EQUALS', condition: familia, conditionObjectId: familiaGid }],
    },
  };
  if (DRY) {
    console.log(`  + crearía "Perfumes ${familia}" [${count} prod]`);
    created++;
    continue;
  }
  const data = await gql(CREATE, { input });
  const { collection, userErrors } = data.collectionCreate;
  if (collection) {
    console.log(`  ✓ ${collection.title} [${collection.handle}] (${count} prod)`);
    created++;
  } else {
    console.error(`  ✗ ${familia}:`, JSON.stringify(userErrors));
    process.exitCode = 1;
  }
}

console.log(`\nListo: ${created} ${DRY ? 'a crear' : 'creadas'}, ${skipped} ya existían.`);
