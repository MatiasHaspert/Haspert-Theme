// Setea el STOCK (cantidades) de cada variante desde perfumes.xlsx.
// SEPARADO del repricing a propósito: setea cantidades ABSOLUTAS (pisa lo que haya).
// Corré esto solo para carga inicial o reset deliberado — NO en cada repricing,
// porque sobrescribiría el stock ya vendido.
//
//   node set-stock.mjs --dry-run   # muestra qué setearía, sin escribir
//   node set-stock.mjs             # setea las cantidades
//
// Modelo mixto: solo Frasco y Tester llevan stock real. Los Decants son tracked=false
// (siempre disponibles) → no se les setea cantidad.
// Columnas en perfumes.xlsx: stock_frasco, stock_tester.
// Location: toma la primera activa, o la que fijes en LOCATION_ID del .env.
// Requiere scopes: read_locations, write_inventory.

import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { gql, loadDotEnv, sleep } from './lib/shopify.mjs';

await loadDotEnv();
const DRY = process.argv.includes('--dry-run');

// Sufijo de SKU → columna de stock en el xlsx (solo variantes trackeadas).
const STOCK_COLS = { FRASCO: 'stock_frasco', TESTER: 'stock_tester' };

const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const toInt = (v) => { const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : 0; };

function readSheet(ws) {
  const headers = {};
  ws.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.text).trim(); });
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
    if (hasVal) out.push(obj);
  }
  return out;
}

async function getLocationId() {
  if (process.env.LOCATION_ID) return process.env.LOCATION_ID;
  const data = await gql(`{ locations(first: 10) { nodes { id name isActive } } }`);
  const active = data.locations.nodes.find((l) => l.isActive) || data.locations.nodes[0];
  if (!active) throw new Error('No hay locations en la tienda.');
  console.log(`Location: ${active.name} (${active.id})\n`);
  return active.id;
}

// La API 2026-04 exige la directiva @idempotent(key:) en mutaciones de inventario.
// Usamos un UUID fresco por llamada para que un re-run sí vuelva a aplicar.
const SET = `
  mutation SetQty($input: InventorySetQuantitiesInput!, $key: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $key) {
      userErrors { field message }
    }
  }
`;

// ---- main ----
const xlsxPath = fileURLToPath(new URL('./perfumes.xlsx', import.meta.url));
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlsxPath);
const ws = wb.worksheets[0];
const rows = readSheet(ws);

const locationId = await getLocationId();
console.log(`${rows.length} fila(s)${DRY ? ' · DRY-RUN (no escribe)' : ''}\n`);
console.log('⚠️  set-stock setea cantidades ABSOLUTAS (pisa el stock actual).\n');

let setCount = 0;
let failed = 0;

for (const row of rows) {
  const marca = (row.marca || '').trim();
  const nombre = (row.nombre || '').trim();
  const handle = (row.handle || '').trim() || slugify(`${marca}-${nombre}`);

  const data = await gql(`query($q: String!, $loc: ID!) {
    products(first: 1, query: $q) {
      nodes {
        title
        variants(first: 10) {
          nodes {
            sku
            inventoryItem {
              id
              inventoryLevel(locationId: $loc) {
                quantities(names: ["available"]) { name quantity }
              }
            }
          }
        }
      }
    }
  }`, { q: `handle:${handle}`, loc: locationId });
  const p = data.products.nodes[0];
  if (!p) { console.error(`  ✗ ${handle}: no encontrado`); failed++; continue; }

  const quantities = [];
  const parts = [];
  for (const v of p.variants.nodes) {
    const suffix = (v.sku || '').split('-').pop();
    const col = STOCK_COLS[suffix];
    if (!col) continue;
    if (row[col] === '' || row[col] == null) continue; // sin valor → no tocar
    const target = toInt(row[col]);
    // changeFromQuantity = cantidad actual (compare-and-swap exigido por la API 2026-04).
    const lvl = v.inventoryItem.inventoryLevel;
    const current = lvl?.quantities?.find((x) => x.name === 'available')?.quantity ?? 0;
    quantities.push({ inventoryItemId: v.inventoryItem.id, locationId, quantity: target, changeFromQuantity: current });
    parts.push(`${suffix} ${current}→${target}`);
  }

  if (!quantities.length) { console.log(`  · ${handle}: sin columnas de stock, salteado`); continue; }

  if (DRY) { console.log(`  + ${handle}: ${parts.join(' ')}`); setCount++; continue; }

  const res = await gql(SET, {
    input: { name: 'available', reason: 'correction', quantities },
    key: crypto.randomUUID(),
  });
  const errs = res.inventorySetQuantities.userErrors;
  if (errs.length) { console.error(`  ✗ ${handle}:`, JSON.stringify(errs)); failed++; }
  else { console.log(`  ✓ ${handle}: ${parts.join(' ')}`); setCount++; }

  await sleep(350);
}

console.log(`\nListo: ${setCount} ${DRY ? 'a setear' : 'seteadas'}, ${failed} con error.`);
if (failed) process.exitCode = 1;
