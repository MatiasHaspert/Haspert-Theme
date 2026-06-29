// Loader del catálogo: lee perfumes.xlsx, computa las 4 presentaciones + precios + metafields,
// y hace UPSERT por handle vía `productSet` (idempotente → re-correr repreciá, no duplica).
//
//   node load-catalog.mjs --dry-run            # imprime el payload sin escribir nada
//   node load-catalog.mjs --dry-run --limit 1
//   node load-catalog.mjs --limit 2            # carga real (primeras 2 filas)
//   node load-catalog.mjs                      # carga real (todas)
//
// Precios: ver lib/pricing.mjs. Contrato de datos del theme: ver README / setup-metafields.mjs.

import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { gql, loadDotEnv, sleep } from './lib/shopify.mjs';
import { computePrices } from './lib/pricing.mjs';

await loadDotEnv();

// ---- args ----
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity;

// ---- helpers ----
const slugify = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const splitList = (cell) =>
  (cell || '')
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);

const toInt = (v) => {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

const truthy = (v) =>
  ['true', '1', 'si', 'sí', 'x', 'verdadero'].includes(String(v ?? '').trim().toLowerCase());

const PRODUCT_SET = `
  mutation Upsert($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
    productSet(synchronous: true, identifier: $identifier, input: $input) {
      product {
        id
        handle
        variants(first: 10) { nodes { title price sku } }
      }
      userErrors { field message code }
    }
  }
`;

// productSet crea el producto ACTIVE pero NO lo publica en ningún canal → no aparece
// en el storefront. Hay que publicarlo en Online Store aparte (scope write_publications).
const PUBLISH = `
  mutation Publish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

let _onlineStorePubId; // cache
async function getOnlineStorePublicationId() {
  if (_onlineStorePubId !== undefined) return _onlineStorePubId;
  const data = await gql(`{ publications(first: 25) { nodes { id name } } }`);
  const node = data.publications.nodes.find((n) => /online store|tienda online/i.test(n.name));
  if (!node) {
    throw new Error(
      'No encontré el canal Online Store en publications. Canales: ' +
        data.publications.nodes.map((n) => n.name).join(', ')
    );
  }
  _onlineStorePubId = node.id;
  return _onlineStorePubId;
}

/** Arma el array de metafields, omitiendo los vacíos (listas y textos). */
function buildMetafields(row) {
  const mf = [];
  const list = (key, cell) => {
    const arr = splitList(cell);
    if (arr.length) mf.push({ namespace: 'custom', key, type: 'list.single_line_text_field', value: JSON.stringify(arr) });
  };
  const text = (key, val) => {
    if (val && String(val).trim()) mf.push({ namespace: 'custom', key, type: 'single_line_text_field', value: String(val).trim() });
  };

  list('familia_olfativa', row.familia_olfativa);
  list('notas_salida', row.notas_salida);
  list('notas_corazon', row.notas_corazon);
  list('notas_fondo', row.notas_fondo);
  text('genero', row.genero);
  text('concentracion', row.concentracion);
  text('longevidad', row.longevidad);
  text('estela', row.estela);
  text('pais_origen', row.pais_origen);
  text('inspirado_en', row.inspirado_en); // LEGAL: cargar con criterio

  // boolean: en blanco asume true (garantía de originalidad por defecto)
  const garantizado = row.original_garantizado === '' || row.original_garantizado == null ? true : truthy(row.original_garantizado);
  mf.push({ namespace: 'custom', key: 'original_garantizado', type: 'boolean', value: String(garantizado) });

  return mf;
}

/** Convierte una fila del CSV en el ProductSetInput + el handle identificador. */
function buildProduct(row) {
  const marca = (row.marca || '').trim();
  const nombre = (row.nombre || '').trim();
  if (!marca || !nombre) throw new Error('faltan marca y/o nombre');

  const handle = (row.handle || '').trim() || slugify(`${marca}-${nombre}`);
  const ml = toInt(row.frasco_ml);
  const precioFrasco = toInt(row.precio_frasco);
  const prices = computePrices(precioFrasco, ml);

  const SKU = handle.toUpperCase();
  const anterior = toInt(row.precio_frasco_anterior); // ancla REAL opcional

  // tags = solo familia (utilidad de búsqueda en el storefront). Las colecciones se arman
  // por metafield (PRODUCT_METAFIELD_DEFINITION), no por tag → género/concentración eran ruido.
  const tags = splitList(row.familia_olfativa);

  // Modelo MIXTO de stock:
  //  - Frasco y Tester → tracked=true + DENY (stock real, se agotan a 0 unidades).
  //  - Decants → tracked=false + CONTINUE (se arman a pedido desde el frasco → siempre disponibles).
  // NO seteamos inventoryQuantities acá (eso lo hace set-stock.mjs) para que un re-run de
  // repricing no pise el stock vendido.
  const variant = (name, price, suffix, { tracked, compareAt } = {}) => ({
    optionValues: [{ optionName: 'Tamaño', name }],
    price: String(price),
    ...(compareAt && compareAt > price ? { compareAtPrice: String(compareAt) } : {}),
    inventoryPolicy: tracked ? 'DENY' : 'CONTINUE',
    inventoryItem: { tracked, sku: `${SKU}-${suffix}` },
  });

  const input = {
    handle,
    title: `${marca} ${nombre}`,
    vendor: marca,
    productType: 'Perfume',
    status: 'ACTIVE',
    tags,
    productOptions: [
      {
        name: 'Tamaño',
        values: [
          { name: `Frasco ${ml}ml` },
          { name: 'Decant 10ml' },
          { name: 'Decant 5ml' },
          { name: `Tester ${ml}ml` },
        ],
      },
    ],
    variants: [
      variant(`Frasco ${ml}ml`, prices.frasco, 'FRASCO', { tracked: true, compareAt: anterior }),
      variant('Decant 10ml', prices.decant10, 'D10', { tracked: false }),
      variant('Decant 5ml', prices.decant5, 'D5', { tracked: false }),
      variant(`Tester ${ml}ml`, prices.tester, 'TESTER', { tracked: true }),
    ],
    metafields: buildMetafields(row),
  };

  if (row.descripcion && row.descripcion.trim()) input.descriptionHtml = row.descripcion.trim();
  if (row.imagen_url && row.imagen_url.trim()) {
    input.files = [{ originalSource: row.imagen_url.trim(), contentType: 'IMAGE' }];
  }

  return { handle, input, prices };
}

/** Lee la primera hoja del xlsx como array de objetos keyeados por el header (fila 1). */
function readSheet(ws) {
  const headers = {};
  ws.getRow(1).eachCell((cell, col) => {
    headers[col] = String(cell.text).trim();
  });

  const out = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = {};
    let hasVal = false;
    for (const col of Object.keys(headers)) {
      const key = headers[col];
      if (!key) continue;
      const text = row.getCell(Number(col)).text;
      const val = (text == null ? '' : String(text)).trim();
      obj[key] = val;
      if (val) hasVal = true;
    }
    if (hasVal) out.push(obj); // saltea filas totalmente vacías
  }
  return out;
}

// ---- main ----
const xlsxPath = fileURLToPath(new URL('./perfumes.xlsx', import.meta.url));
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlsxPath);
const ws = wb.worksheets[0];
if (!ws) throw new Error('perfumes.xlsx no tiene hojas');
const rows = readSheet(ws);

console.log(`${rows.length} fila(s) en perfumes.xlsx${DRY ? ' · DRY-RUN (no escribe)' : ''}`);

let done = 0;
let failed = 0;

for (const row of rows) {
  if (done >= LIMIT) break;
  let built;
  try {
    built = buildProduct(row);
  } catch (e) {
    console.error(`  ✗ "${row.marca} ${row.nombre}": ${e.message}`);
    failed++;
    continue;
  }

  const { handle, input, prices } = built;
  const priceLine = `frasco ${prices.frasco} · d10 ${prices.decant10} · d5 ${prices.decant5} · tester ${prices.tester}`;

  if (DRY) {
    console.log(`\n── ${input.title}  [${handle}]`);
    console.log(`   ${priceLine}  ($/ml ${Math.round(prices.pml)})`);
    console.log(JSON.stringify(input, null, 2));
    done++;
    continue;
  }

  try {
    const data = await gql(PRODUCT_SET, { identifier: { handle }, input });
    const { product, userErrors } = data.productSet;
    if (userErrors.length) {
      console.error(`  ✗ ${input.title}:`, JSON.stringify(userErrors));
      failed++;
    } else {
      // Publicar en Online Store (idempotente: re-publicar no rompe).
      const pubId = await getOnlineStorePublicationId();
      const pub = await gql(PUBLISH, { id: product.id, input: [{ publicationId: pubId }] });
      const pubErr = pub.publishablePublish.userErrors;
      const flag = pubErr.length ? ` ⚠️ publish: ${JSON.stringify(pubErr)}` : ' · publicado';
      console.log(`  ✓ ${product.handle}  (${priceLine})${flag}`);
      done++;
    }
  } catch (e) {
    console.error(`  ✗ ${input.title}: ${e.message}`);
    failed++;
  }

  await sleep(350); // cortesía con el rate limit
}

console.log(`\nListo: ${done} cargado(s), ${failed} con error.`);
if (failed) process.exitCode = 1;
