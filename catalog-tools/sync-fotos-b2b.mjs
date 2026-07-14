// Re-host de las fotos del universo B2B: se descargan del sitio de Star UNA vez
// (incremental después) y se suben a Shopify Files → el payload mayorista queda 100%
// servido por el CDN de Shopify, sin ninguna mención al proveedor en el HTML (Sprint 3.1).
// Separado de build-json-b2b.mjs a propósito: esto es lento (~12 min la primera corrida)
// y corre poco; el build queda rápido y frecuente, y lee el estado de acá como única
// fuente de imagen.
//
//   node sync-fotos-b2b.mjs --dry-run          # pendientes + 5 ejemplos, sin tocar la red
//   node sync-fotos-b2b.mjs --limit 5          # smoke test real
//   node sync-fotos-b2b.mjs                    # corrida completa (~700 la primera vez)
//   node sync-fotos-b2b.mjs --force 8100,9226  # re-subir ids puntuales (pisa el archivo en Files)
//
// Estado persistente (COMMITEADO): proveedor/fotos-b2b.json
//   { "<id_star>": { url, src, fecha } }
//   url = CDN de Shopify (la que emite el build) · src = path original en Star (para
//   detectar fotos cambiadas en una futura v2) · fecha = día de subida.
//
// Cortesía con Star (las mismas reglas del pull, obligatorias): descargas EN SERIE a
// 1 req/s con jitter, User-Agent identificado, 3 reintentos con backoff, timeout 20s.
// Ante 403/429/challenge se corta la corrida (lo ya subido queda en el estado).
// Subidas a Shopify: hasta 4 en paralelo (stagedUploadsCreate → PUT → fileCreate).
//
// Idempotencia / reanudable:
//   - estado: un id con url no se vuelve a procesar (salvo --force);
//   - adopción: si Files ya tiene b2b-{id} READY (corrida interrumpida antes de
//     escribir el estado), se adopta su URL sin re-descargar ni re-subir;
//   - fileCreate va con duplicateResolutionMode REPLACE: si algo se re-sube igual
//     (ej. el duplicado quedó PROCESSING y no se pudo adoptar), pisa el archivo en vez
//     de acumular b2b-{id}_uuid.jpg basura.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_URL, USER_AGENT, dormir, pausaCortesia, fechaLocalISO, limpiarTexto,
  ultimoSnapshot, esFilaB2B, ErrorBloqueo,
} from './lib/proveedor.mjs';
import { gql, loadDotEnv } from './lib/shopify.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIR_SNAPSHOTS = path.join(DIR, 'proveedor', 'snapshots');
const RUTA_ESTADO = path.join(DIR, 'proveedor', 'fotos-b2b.json');

const MIN_BYTES = 3 * 1024;             // menos que esto no es una foto de producto
const MAX_BYTES = 2 * 1024 * 1024;      // más que esto tampoco (el listado sirve ~150 KB)
const SUBIDAS_PARALELAS = 4;
const POLL_INTENTOS = 10;               // ~55 s de espera total por archivo

// ---- args ----
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const limIdx = args.indexOf('--limit');
const LIMIT = limIdx !== -1 ? parseInt(args[limIdx + 1], 10) : Infinity;
if (limIdx !== -1 && (!Number.isFinite(LIMIT) || LIMIT < 1)) {
  console.error('--limit necesita un número ≥ 1');
  process.exit(1);
}
const forceIdx = args.indexOf('--force');
const FORCE = forceIdx !== -1
  ? new Set(String(args[forceIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean))
  : null;
if (FORCE && !FORCE.size) {
  console.error('--force necesita ids separados por coma: --force 8100,9226');
  process.exit(1);
}

// ---- estado ----
const estado = fs.existsSync(RUTA_ESTADO) ? JSON.parse(fs.readFileSync(RUTA_ESTADO, 'utf8')) : {};
// Una línea por id, ordenado numéricamente: diffs de git legibles aunque haya 700 entradas.
function guardarEstado() {
  const ids = Object.keys(estado).sort((a, b) => Number(a) - Number(b));
  const lineas = ids.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(estado[id])}`);
  fs.writeFileSync(RUTA_ESTADO, `{\n${lineas.join(',\n')}\n}\n`, 'utf8');
}

// ---- universo B2B y pendientes ----
const snap = ultimoSnapshot(DIR_SNAPSHOTS);
if (!snap) {
  console.error('ABORTADO: no hay snapshots en proveedor/snapshots/. Corré primero: node pull-proveedor.mjs');
  process.exit(1);
}
const universo = snap.filas.filter(esFilaB2B);
const conFoto = universo.filter((f) => f.imagen_url);
const yaEnEstado = conFoto.filter((f) => estado[f.id_star]).length;

let pendientes;
if (FORCE) {
  pendientes = conFoto.filter((f) => FORCE.has(f.id_star));
  const hallados = new Set(pendientes.map((f) => f.id_star));
  for (const id of FORCE) {
    if (!hallados.has(id)) console.log(`⚠️ --force ${id}: no está en el universo B2B del snapshot (o no tiene foto en Star) — ignorado`);
  }
} else {
  pendientes = conFoto.filter((f) => !estado[f.id_star]);
}
const totalPendientes = pendientes.length;
pendientes = pendientes.slice(0, LIMIT);

const srcRelativo = (imagenUrl) => imagenUrl.replace(`${BASE_URL}/`, '');

console.log(`Snapshot ${snap.base}: ${universo.length} ítems B2B · ${conFoto.length} con foto en Star · ${universo.length - conFoto.length} sin foto (monograma)`);
console.log(`Estado: ${Object.keys(estado).length} fotos re-hosteadas (${yaEnEstado} del universo actual)`);
console.log(`${FORCE ? 'Forzados' : 'Pendientes'}: ${totalPendientes}${pendientes.length < totalPendientes ? ` (se procesan ${pendientes.length} por --limit)` : ''}`);

if (DRY) {
  console.log('\n--dry-run: primeros 5 pendientes (no se toca la red):');
  for (const f of pendientes.slice(0, 5)) {
    console.log(`  [${f.id_star}] ${f.Marca} — ${f.Producto}\n      ${srcRelativo(f.imagen_url)} → b2b-${f.id_star}.{jpg|png}`);
  }
  process.exit(0);
}
if (!pendientes.length) {
  console.log('Nada que hacer.');
  process.exit(0);
}

await loadDotEnv();

// ---- adopción: inventario de Files b2b-* en un solo paginado ----
// Cubre corridas interrumpidas ENTRE el fileCreate y la escritura del estado: el archivo
// existe en Shopify pero el estado no lo sabe. El filename se saca del path de image.url
// (el File de la API no expone filename) y se mapea POR ID, no por nombre exacto:
// Shopify corrige la extensión según el contenido real (Star sirve PNGs nombrados .jpg),
// así que b2b-8614 puede ser .jpg o .png. Solo se adoptan READY; un duplicado PROCESSING
// que no se pueda adoptar lo resuelve el REPLACE del fileCreate.
async function listarFilesB2B() {
  const porId = new Map();
  let cursor = null;
  while (true) {
    const data = await gql(
      `query FilesB2B($cursor: String) {
        files(first: 250, after: $cursor, query: "filename:b2b") {
          pageInfo { hasNextPage endCursor }
          nodes { id fileStatus ... on MediaImage { image { url } } }
        }
      }`,
      { cursor },
    );
    for (const n of data.files.nodes) {
      const url = n.image && n.image.url;
      if (n.fileStatus !== 'READY' || !url) continue;
      const nombre = decodeURIComponent(new URL(url).pathname.split('/').pop());
      const m = nombre.match(/^b2b-(\d+)\.[a-z0-9]+$/i);
      if (m) porId.set(m[1], url);
    }
    if (!data.files.pageInfo.hasNextPage) break;
    cursor = data.files.pageInfo.endCursor;
  }
  return porId;
}

const filesExistentes = await listarFilesB2B();
if (filesExistentes.size) console.log(`Files: ${filesExistentes.size} b2b-* ya en Shopify (candidatos a adopción)`);

// ---- descarga desde Star (cortesía) ----
class ErrorValidacion extends Error {}

async function descargarFoto(url) {
  let ultimo;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
        signal: AbortSignal.timeout(20_000),
        redirect: 'follow',
      });
      if (res.status === 403 || res.status === 429) throw new ErrorBloqueo(`HTTP ${res.status} en ${url}`, res.status);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mimeType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const buf = Buffer.from(await res.arrayBuffer());
      if (!mimeType.startsWith('image/')) throw new ErrorValidacion(`content-type "${mimeType || '?'}" no es imagen`);
      if (buf.length < MIN_BYTES) throw new ErrorValidacion(`muy chica (${buf.length} bytes < ${MIN_BYTES})`);
      if (buf.length > MAX_BYTES) throw new ErrorValidacion(`muy grande (${(buf.length / 1024 / 1024).toFixed(1)} MB > 2 MB)`);
      return { buf, mimeType };
    } catch (e) {
      if (e instanceof ErrorBloqueo || e instanceof ErrorValidacion) throw e; // no reintentar
      ultimo = e;
      if (intento < 3) await dormir(2000 * 2 ** (intento - 1));
    }
  }
  throw ultimo;
}

// ---- subida a Shopify (staged upload → PUT → fileCreate → poll READY) ----
const STAGED = `
  mutation Staged($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;
const FILE_CREATE = `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus }
      userErrors { field message code }
    }
  }
`;
const POLL = `
  query Poll($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        fileStatus
        image { url }
        fileErrors { code message }
      }
    }
  }
`;

async function subirFoto(f, { buf, mimeType }) {
  // La extensión sale del mime REAL: Shopify la corrige igual por contenido (verificado:
  // un PNG subido como .jpg se guarda .png) — mejor mandarla bien y que REPLACE apunte
  // al filename definitivo.
  const EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const filename = `b2b-${f.id_star}.${EXT[mimeType] || 'jpg'}`;
  const alt = limpiarTexto(`${f.Marca} ${f.Producto}`);

  const staged = await gql(STAGED, {
    input: [{ filename, mimeType, resource: 'FILE', httpMethod: 'PUT', fileSize: String(buf.length) }],
  });
  if (staged.stagedUploadsCreate.userErrors.length) {
    throw new Error(`stagedUploadsCreate: ${JSON.stringify(staged.stagedUploadsCreate.userErrors)}`);
  }
  const target = staged.stagedUploadsCreate.stagedTargets[0];

  const headers = { 'Content-Type': mimeType };
  for (const p of target.parameters) headers[p.name] = p.value;
  const put = await fetch(target.url, { method: 'PUT', headers, body: buf, signal: AbortSignal.timeout(60_000) });
  if (!put.ok) throw new Error(`PUT staged upload: HTTP ${put.status}`);

  const created = await gql(FILE_CREATE, {
    files: [{
      originalSource: target.resourceUrl,
      contentType: 'IMAGE',
      filename,
      alt,
      duplicateResolutionMode: 'REPLACE',
    }],
  });
  if (created.fileCreate.userErrors.length) {
    throw new Error(`fileCreate: ${JSON.stringify(created.fileCreate.userErrors)}`);
  }
  const fileId = created.fileCreate.files[0].id;

  // fileCreate procesa async: poll hasta READY para capturar image.url. Si no llega,
  // queda para la próxima corrida (la adopción lo levanta) — no se bloquea el lote.
  for (let intento = 1; intento <= POLL_INTENTOS; intento++) {
    await dormir(1000 * intento);
    const { node } = await gql(POLL, { id: fileId });
    if (!node) continue;
    if (node.fileStatus === 'FAILED') {
      throw new Error(`fileStatus FAILED: ${JSON.stringify(node.fileErrors || [])}`);
    }
    if (node.fileStatus === 'READY' && node.image && node.image.url) return node.image.url;
  }
  return null; // sigue PROCESSING: pendiente, no error
}

// ---- corrida: descargas en serie (cortesía) + subidas en paralelo (≤4) ----
const HOY = fechaLocalISO();
const resultados = { subidas: 0, adoptadas: 0, fallidas: [], sinReady: [] };
const enVuelo = new Set();
let bloqueo = null;

function lanzarSubida(f, foto) {
  const tarea = (async () => {
    try {
      const url = await subirFoto(f, foto);
      if (url) {
        estado[f.id_star] = { url, src: srcRelativo(f.imagen_url), fecha: HOY };
        guardarEstado();
        resultados.subidas++;
        console.log(`  ✓ [${f.id_star}] ${f.Marca} — subida (${(foto.buf.length / 1024).toFixed(0)} KB)`);
      } else {
        resultados.sinReady.push(f.id_star);
        console.log(`  … [${f.id_star}] quedó PROCESSING; se adopta en la próxima corrida`);
      }
    } catch (e) {
      resultados.fallidas.push({ id: f.id_star, motivo: e.message });
      console.log(`  ✗ [${f.id_star}] ${e.message}`);
    } finally {
      enVuelo.delete(tarea);
    }
  })();
  enVuelo.add(tarea);
  return tarea;
}

let primera = true;
for (const f of pendientes) {
  // Adopción (salvo --force, que existe justamente para re-subir).
  const adoptada = !FORCE && filesExistentes.get(f.id_star);
  if (adoptada) {
    estado[f.id_star] = { url: adoptada, src: srcRelativo(f.imagen_url), fecha: HOY };
    guardarEstado();
    resultados.adoptadas++;
    console.log(`  ↺ [${f.id_star}] ${f.Marca} — adoptada de Files (sin re-subir)`);
    continue;
  }

  if (!primera) await pausaCortesia();
  primera = false;

  let foto;
  try {
    foto = await descargarFoto(f.imagen_url);
  } catch (e) {
    if (e instanceof ErrorBloqueo) { bloqueo = e; break; }
    resultados.fallidas.push({ id: f.id_star, motivo: `descarga: ${e.message}` });
    console.log(`  ✗ [${f.id_star}] descarga: ${e.message}`);
    continue;
  }

  while (enVuelo.size >= SUBIDAS_PARALELAS) await Promise.race(enVuelo);
  lanzarSubida(f, foto);
}
await Promise.all(enVuelo);

// ---- reporte ----
if (bloqueo) {
  console.error(`\n⚠️ Corrida CORTADA por bloqueo del sitio (${bloqueo.message}). Lo subido quedó en el estado.`);
  console.error('No escalar a headless. Reintentar más tarde; si persiste, avisar a Star (somos cliente).');
}
const restantes = conFoto.filter((f) => !estado[f.id_star]).length;
console.log(`\n─── Resultado ───`);
console.log(`Subidas: ${resultados.subidas} · Adoptadas: ${resultados.adoptadas} · Fallidas: ${resultados.fallidas.length} · Sin READY: ${resultados.sinReady.length}`);
for (const x of resultados.fallidas) console.log(`  fallida [${x.id}]: ${x.motivo}`);
if (resultados.sinReady.length) console.log(`  sin READY (re-correr y se adoptan): ${resultados.sinReady.join(', ')}`);
console.log(`Estado: ${Object.keys(estado).length} fotos en proveedor/fotos-b2b.json (commitealo) · faltan ${restantes} del universo actual`);
if (!restantes) console.log('Siguiente paso: node build-json-b2b.mjs (regenera el payload con las URLs del CDN propio)');
process.exit(bloqueo ? 1 : 0);
