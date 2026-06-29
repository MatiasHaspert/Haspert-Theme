// Lee el stock ACTUAL de Shopify y lo vuelca en una hoja "Stock (Shopify)" de perfumes.xlsx.
// Es read-only contra Shopify y NO toca las columnas stock_* de la hoja principal (esas son el
// INPUT de set-stock y conviene dejarlas en blanco). Sirve para tener el XLSX como master legible
// / backup, on-demand. Shopify sigue siendo la fuente de verdad del stock.
//
//   node pull-stock.mjs
//
// Requiere scope read_inventory (ya concedido).

import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { gql, loadDotEnv, sleep } from './lib/shopify.mjs';

await loadDotEnv();

const REPORT_SHEET = 'Stock (Shopify)';
const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function readMain(ws) {
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
      const val = String(row.getCell(Number(col)).text ?? '').trim();
      obj[key] = val;
      if (val) hasVal = true;
    }
    if (hasVal) out.push(obj);
  }
  return out;
}

const xlsxPath = fileURLToPath(new URL('./perfumes.xlsx', import.meta.url));
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlsxPath);
const main = wb.worksheets[0];
const rows = readMain(main);
console.log(`${rows.length} producto(s) · leyendo stock de Shopify…\n`);

// Sufijo de SKU → etiqueta en el reporte
const reportRows = [];
for (const row of rows) {
  const marca = (row.marca || '').trim();
  const nombre = (row.nombre || '').trim();
  const handle = (row.handle || '').trim() || slugify(`${marca}-${nombre}`);

  const data = await gql(`query($q: String!) {
    products(first: 1, query: $q) {
      nodes {
        title
        variants(first: 10) {
          nodes { sku title inventoryQuantity inventoryItem { tracked } }
        }
      }
    }
  }`, { q: `handle:${handle}` });
  const p = data.products.nodes[0];
  if (!p) { console.error(`  ✗ ${handle}: no encontrado`); continue; }

  const bySuffix = {};
  for (const v of p.variants.nodes) {
    const suffix = (v.sku || '').split('-').pop();
    bySuffix[suffix] = v;
  }
  const qtyOf = (suf) => {
    const v = bySuffix[suf];
    if (!v) return '';
    return v.inventoryItem.tracked ? Number(v.inventoryQuantity) : 'siempre';
  };

  reportRows.push({
    handle,
    producto: p.title,
    frasco: qtyOf('FRASCO'),
    tester: qtyOf('TESTER'),
    decants: 'siempre', // D10/D5 no trackeados
  });
  console.log(`  ✓ ${handle}: frasco=${qtyOf('FRASCO')} tester=${qtyOf('TESTER')}`);
  await sleep(200);
}

// Re-crear la hoja del reporte (read-only; no se vuelve a importar).
const prev = wb.getWorksheet(REPORT_SHEET);
if (prev) wb.removeWorksheet(prev.id);
const ws = wb.addWorksheet(REPORT_SHEET);
ws.columns = [
  { header: 'handle', key: 'handle', width: 28 },
  { header: 'producto', key: 'producto', width: 32 },
  { header: 'frasco (disp.)', key: 'frasco', width: 14 },
  { header: 'tester (disp.)', key: 'tester', width: 14 },
  { header: 'decants', key: 'decants', width: 12 },
  { header: 'actualizado', key: 'actualizado', width: 22 },
];
ws.getRow(1).font = { bold: true };
ws.views = [{ state: 'frozen', ySplit: 1 }];
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
for (const r of reportRows) ws.addRow({ ...r, actualizado: stamp });

await wb.xlsx.writeFile(xlsxPath);
console.log(`\n✔ Hoja "${REPORT_SHEET}" actualizada en perfumes.xlsx (${reportRows.length} filas · ${stamp}).`);
console.log('  (Las columnas stock_* de la hoja principal NO se tocaron.)');
