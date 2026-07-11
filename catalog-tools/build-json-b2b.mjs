// Publica el catálogo mayorista como metafields del SHOP (namespace numen_b2b) a partir
// del último snapshot del proveedor. Los lee sections/mayorista-catalogo.liquid, que solo
// los inyecta al HTML dentro de la rama `customer.tags contains 'mayorista'`.
//
//   node build-json-b2b.mjs --demo            # precios placeholder (marca meta.demo=true)
//   node build-json-b2b.mjs --demo --dry-run  # imprime meta + 5 ítems + tamaño por chunk, no escribe
//   node build-json-b2b.mjs                   # requiere proveedor/precios-b2b.csv (Sprint 2)
//
// ⚠️ SEGURIDAD DE PRECIOS (la razón de esta arquitectura): los precios B2B NUNCA viajan en
// un asset del theme ni en ningún recurso público (las URLs de CDN son adivinables sin
// login). Van en metafields del shop y el gate es server-side en Liquid. Tampoco se emite
// stock crudo del proveedor: solo el tier de disponibilidad `s` (2 = alto, 1 = disponible).
//
// Gate de lanzamiento: sin proveedor/precios-b2b.csv este script SOLO corre con --demo
// (placeholder (usd × 1510 + 5000) × 1.18 redondeado a $100, marcado meta.demo). Si el CSV
// de precios existe, --demo se rechaza para no pisar precios reales con inventados.
//
// Contrato de escritura (lo lee la sección vía shop.metafields.numen_b2b):
//   numen_b2b.catalogo_meta   (json)  { fecha, total, demo, chunks, min }
//   numen_b2b.catalogo_1..N   (json)  array de ítems { i, m, p, l?, c, a, s }
//     i id_star · m marca · p nombre SIN marca repetida (shortName) · l ml · c A/D ·
//     a precio ARS entero · s tier de stock
// Chunks ≤ 60 KB (límite vigente del tipo json: 128 KB por valor — verificado en
// shopify.dev/docs/apps/build/metafields/metafield-limits, jul 2026 — se chunkea con
// margen y para N chunks aunque hoy entre en uno). Se escriben primero los chunks y al
// final el meta (los lectores recién ven el catálogo nuevo cuando el meta apunta a él);
// después se borran chunks viejos sobrantes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL, leerCsvObjetos, normalizar, FLAG_CLON, resolverSnapshots } from './lib/proveedor.mjs';
import { gql, loadDotEnv } from './lib/shopify.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIR_SNAPSHOTS = path.join(DIR, 'proveedor', 'snapshots');
const RUTA_PRECIOS = path.join(DIR, 'proveedor', 'precios-b2b.csv');

const NAMESPACE = 'numen_b2b';
const KEY_META = 'catalogo_meta';
const MAX_CHUNK_BYTES = 60_000; // margen amplio bajo el límite de 128 KB del tipo json
const STOCK_MINIMO = 15;        // umbral B2B (mínimo mayorista 10 + colchón)
const STOCK_ALTO = 100;         // tier s=2
const MIN_UNIDADES = 10;

// Placeholder demo (mismo modelo que el mockup). El pricing real sale del Sprint 2.
const DEMO_FX = 1510;
const DEMO_FEE = 5000;
const DEMO_MARGEN = 1.18;
const precioDemo = (usd) => Math.round((usd * DEMO_FX + DEMO_FEE) * DEMO_MARGEN / 100) * 100;

// ---- args ----
const args = process.argv.slice(2);
const DEMO = args.includes('--demo');
const DRY = args.includes('--dry-run');

// ---- fuente de precio (gate de lanzamiento) ----
const hayPreciosReales = fs.existsSync(RUTA_PRECIOS);
if (!hayPreciosReales && !DEMO) {
  console.error(
    'ABORTADO: no existe proveedor/precios-b2b.csv (lo genera el Sprint 2) y no pasaste --demo.\n' +
    'Sin lista de precios real este build solo corre en modo demo:\n' +
    '  node build-json-b2b.mjs --demo\n' +
    'Prohibido publicar precios "reales" inventados.',
  );
  process.exit(1);
}
if (hayPreciosReales && DEMO) {
  console.error(
    'ABORTADO: existe proveedor/precios-b2b.csv (precios reales) y pasaste --demo.\n' +
    'Corré sin --demo para publicar la lista real; no piso precios reales con placeholder.',
  );
  process.exit(1);
}
const preciosReales = hayPreciosReales
  ? new Map(leerCsvObjetos(RUTA_PRECIOS).filas.map((f) => [f.id_star, Math.round(Number(f.precio_ars))]))
  : null;

// ---- último snapshot ----
const bases = resolverSnapshots(DIR_SNAPSHOTS);
if (!bases.length) {
  console.error('ABORTADO: no hay snapshots en proveedor/snapshots/. Corré primero: node pull-proveedor.mjs');
  process.exit(1);
}
const base = bases[bases.length - 1];
const fechaLista = base.slice(0, 10); // '2026-07-10-2' → '2026-07-10'
const { filas } = leerCsvObjetos(path.join(DIR_SNAPSHOTS, `${base}.csv`));

// ---- filtro de inclusión + payload ----
// Nombre corto: saca la marca repetida del principio (portado del mockup; corre acá,
// en el build, para no pagar el costo en el front).
function shortName(marca, producto) {
  let n = producto;
  const M = marca.toUpperCase();
  const pref = M.split(' ')[0];
  if (n.toUpperCase().startsWith(M)) n = n.slice(M.length).trim();
  else if (pref && n.toUpperCase().startsWith(pref)) n = n.slice(pref.length).trim();
  n = n.replace(/^[-–·\s]+/, '');
  return n || producto;
}
// El payload va inline en un <script>: nunca dejamos pasar < ni > (los nombres del
// proveedor no los usan; esto es defensa en profundidad, además del escape <\/ de abajo).
const sanear = (s) => String(s ?? '').replace(/[<>]/g, '').trim();

const CAT_LETRA = new Map([['ARABE', 'A'], ['DISENADOR', 'D']]);
const items = [];
let sinPrecio = 0;
for (const f of filas) {
  const letra = CAT_LETRA.get(normalizar(f['Categoría']));
  if (!letra) continue;
  if (f.Comentario === FLAG_CLON) continue;
  if (Number(f.stock_star) < STOCK_MINIMO) continue;
  if (!f.id_star) continue;

  let precio;
  if (preciosReales) {
    precio = preciosReales.get(f.id_star);
    if (!Number.isFinite(precio) || precio <= 0) { sinPrecio++; continue; }
  } else {
    const usd = Number(f['Costo USD']);
    if (!Number.isFinite(usd) || usd <= 0) { sinPrecio++; continue; }
    precio = precioDemo(usd);
  }

  const item = {
    i: Number(f.id_star),
    m: sanear(f.Marca),
    p: sanear(shortName(f.Marca, f.Producto)),
    ...(f.ml ? { l: Number(f.ml) } : {}),
    // g: path de la foto relativo a meta.img_base (el host viaja una sola vez).
    // El front la hotlinkea lazy desde el sitio del proveedor, con fallback a
    // monograma si no carga. Sin foto (placeholder del sitio) → sin clave.
    ...(f.imagen_url ? { g: sanear(f.imagen_url.replace(`${BASE_URL}/`, '')) } : {}),
    c: letra,
    a: precio,
    s: Number(f.stock_star) >= STOCK_ALTO ? 2 : 1,
  };
  if (!item.m || !item.p) continue; // sin marca no entra al B2B (tiles rotos del sitio)
  items.push(item);
}
items.sort((a, b) => (a.m === b.m ? (a.p < b.p ? -1 : a.p > b.p ? 1 : 0) : a.m < b.m ? -1 : 1));

// ---- chunking (por bytes reales del JSON serializado) ----
const escaparScript = (s) => s.replace(/<\//g, '<\\/'); // el JSON vive inline en un <script>
const chunks = [];
let actual = [];
let actualBytes = 2; // los corchetes
for (const item of items) {
  const pieza = JSON.stringify(item);
  const bytes = Buffer.byteLength(pieza, 'utf8') + 1; // + coma
  if (actual.length && actualBytes + bytes > MAX_CHUNK_BYTES) {
    chunks.push(actual);
    actual = [];
    actualBytes = 2;
  }
  actual.push(item);
  actualBytes += bytes;
}
if (actual.length) chunks.push(actual);

const meta = {
  fecha: fechaLista,
  total: items.length,
  demo: !preciosReales,
  chunks: chunks.length,
  min: MIN_UNIDADES,
  img_base: `${BASE_URL}/`,
};
const metaStr = escaparScript(JSON.stringify(meta));
const chunkStrs = chunks.map((c) => escaparScript(JSON.stringify(c)));

// ---- reporte ----
const conFoto = items.filter((it) => it.g).length;
console.log(`Snapshot ${base} → ${items.length} ítems B2B (de ${filas.length} filas)`);
console.log(`  filtro: Árabe/Diseñador · no-clon · stock ≥ ${STOCK_MINIMO} · con precio${sinPrecio ? ` (${sinPrecio} excluidos sin precio)` : ''}`);
console.log(`  con foto: ${conFoto}/${items.length} (los sin foto muestran monograma)`);
console.log(`  meta: ${metaStr}`);
chunkStrs.forEach((c, i) => console.log(`  chunk ${i + 1}/${chunkStrs.length}: ${(Buffer.byteLength(c, 'utf8') / 1024).toFixed(1)} KB · ${chunks[i].length} ítems`));

if (DRY) {
  console.log('\n--dry-run: primeros 5 ítems (no se escribe nada):');
  for (const it of items.slice(0, 5)) console.log(' ', JSON.stringify(it));
  process.exit(0);
}

// ---- escritura: chunks primero, meta al final, limpieza de sobrantes ----
await loadDotEnv();

const { shop } = await gql('{ shop { id } }');

const SET = `
  mutation Set($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key }
      userErrors { field message code }
    }
  }
`;
async function setMetafields(defs) {
  const data = await gql(SET, {
    metafields: defs.map(({ key, value }) => ({
      ownerId: shop.id,
      namespace: NAMESPACE,
      key,
      type: 'json',
      value,
    })),
  });
  const errs = data.metafieldsSet.userErrors;
  if (errs.length) {
    const msg = JSON.stringify(errs, null, 2);
    if (/access|scope|permission/i.test(msg)) {
      console.error(
        'La app no tiene permiso para escribir metafields del shop. Ampliá los scopes de la ' +
        'versión publicada de la app en el Dev Dashboard (ver README §Canal mayorista) — no crear app nueva.',
      );
    }
    throw new Error(`metafieldsSet userErrors: ${msg}`);
  }
}

await setMetafields(chunkStrs.map((value, i) => ({ key: `catalogo_${i + 1}`, value })));
await setMetafields([{ key: KEY_META, value: metaStr }]);
console.log(`Escritos ${chunkStrs.length} chunks + ${KEY_META} en ${NAMESPACE} (shop ${shop.id})`);

// Chunks viejos que sobran (una corrida anterior con más chunks): se borran para no
// dejar datos stale; el meta ya no los referencia, es solo higiene.
const viejos = await gql(
  `{ shop { metafields(first: 100, namespace: "${NAMESPACE}") { nodes { key } } } }`,
);
const aBorrar = viejos.shop.metafields.nodes
  .map((n) => n.key)
  .filter((k) => /^catalogo_\d+$/.test(k) && parseInt(k.split('_')[1], 10) > chunks.length);
if (aBorrar.length) {
  const DEL = `
    mutation Del($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields { key }
        userErrors { field message }
      }
    }
  `;
  const del = await gql(DEL, {
    metafields: aBorrar.map((key) => ({ ownerId: shop.id, namespace: NAMESPACE, key })),
  });
  if (del.metafieldsDelete.userErrors.length) {
    throw new Error(`metafieldsDelete userErrors: ${JSON.stringify(del.metafieldsDelete.userErrors)}`);
  }
  console.log(`Limpieza: borrados chunks sobrantes ${aBorrar.join(', ')}`);
}

console.log(meta.demo
  ? '\n⚠️ MODO DEMO: la página va a mostrar el badge "Precios de demostración".'
  : '\nLista real publicada. Verificá la página /pages/mayorista logueado con un cliente con tag mayorista.');
