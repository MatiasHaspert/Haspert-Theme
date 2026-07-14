// Scrape del catálogo de perfumería de Star Company (PrestaShop) → snapshot CSV datado
// en proveedor/snapshots/ + actualización del master catalogo-proveedor.csv.
// Solo lectura del sitio público; NO toca Shopify ni necesita .env.
// Parte 1 del pipeline; la parte 2 es diff-proveedor.mjs. Ver README §"Sincronización con proveedor".
//
//   node pull-proveedor.mjs            # corrida completa: cat 121 + cat 100 (marcas del catálogo)
//   node pull-proveedor.mjs --dry-run  # 1 request: parsea la página 1 y muestra 5 registros
//   node pull-proveedor.mjs --cat 121  # debug: una sola categoría → proveedor/debug-cat121.csv
//
// Cortesía (obligatoria, no aflojar): 1 request/segundo con jitter ±300ms, concurrencia 1,
// User-Agent identificable, 3 reintentos con backoff, timeout 20s. Si el sitio responde
// 403/429/challenge, se ABORTA y se reporta: no escalar a headless sin decisión explícita.
//
// robots.txt del sitio (10-jul-2026) prohíbe `?order=` / `&order=` → las URLs de paginación
// van SIN order (el orden por defecto ya es "position"). No usar las URLs con &order= del
// paginador del sitio.
//
// Reglas de master:
//   - catalogo-proveedor.csv = último snapshot + filas ausentes UNA corrida (gracia de 1:
//     recién caen del master tras 2 corridas consecutivas sin aparecer). fecha_snapshot
//     hace de "última vista": filas con fecha vieja están en gracia.
//   - Comentario es sticky: se hereda por id_star de corrida a corrida; la lista
//     proveedor/marcas-clones.txt lo re-impone por marca. En la primera corrida (master
//     legacy sin id_star) se hereda por nombre normalizado.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_URL, CAT_PERFUMES, CAT_COSMETICOS, COLUMNAS, FLAG_CLON,
  normalizar, limpiarTexto, extraerMl, clasificarCategoria,
  leerCsvObjetos, escribirCsv, parseListado, fetchHtml, urlListado,
  pausaCortesia, fechaLocalISO, ErrorBloqueo,
} from './lib/proveedor.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RUTA_MASTER = path.join(DIR, 'catalogo-proveedor.csv');
const DIR_PROV = path.join(DIR, 'proveedor');
const DIR_SNAPSHOTS = path.join(DIR_PROV, 'snapshots');
const DIR_REPORTES = path.join(DIR_PROV, 'reportes');
const RUTA_MARCAS_CAT = path.join(DIR_PROV, 'marcas-categoria.csv');
const RUTA_CLONES = path.join(DIR_PROV, 'marcas-clones.txt');
const RUTA_LEGACY = path.join(DIR_PROV, 'legacy-catalogo-proveedor.csv');

const MINIMO_FILAS = 1850; // validación dura del brief: menos que esto = algo se rompió

// ---- args ----
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const catIdx = args.indexOf('--cat');
const SOLO_CAT = catIdx !== -1 ? String(args[catIdx + 1]) : null;
if (SOLO_CAT && ![CAT_PERFUMES, CAT_COSMETICOS].includes(SOLO_CAT)) {
  console.error(`--cat ${SOLO_CAT}: categoría desconocida (usar ${CAT_PERFUMES} o ${CAT_COSMETICOS})`);
  process.exit(1);
}

const FECHA = fechaLocalISO();
const inicio = Date.now();

// ---- seeds (obligatorios) ----
if (!fs.existsSync(RUTA_MARCAS_CAT) || !fs.existsSync(RUTA_CLONES)) {
  console.error(
    'Faltan seeds en proveedor/: marcas-categoria.csv (generar con `node seed-marcas-categoria.mjs`) ' +
    'y/o marcas-clones.txt (está commiteado; restauralo de git).',
  );
  process.exit(1);
}
const mapaMarcas = new Map(
  leerCsvObjetos(RUTA_MARCAS_CAT).filas.map((f) => [normalizar(f.Marca), f['Categoría']]),
);
const clones = new Set(
  fs.readFileSync(RUTA_CLONES, 'utf8').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map(normalizar),
);

// ---- master vigente (para carry de Comentario, scope y retención) ----
const master = fs.existsSync(RUTA_MASTER) ? leerCsvObjetos(RUTA_MASTER) : null;
const esLegacy = !!master && !master.headers.includes('id_star');
const comentarioPorId = new Map();      // v2: id_star → Comentario (sticky)
const comentarioPorNombre = new Map();  // legacy: nombre normalizado → Comentario
if (master) {
  for (const f of master.filas) {
    if (!f.Comentario) continue;
    if (esLegacy) {
      const k = normalizar(f.Producto);
      if (!comentarioPorNombre.has(k)) comentarioPorNombre.set(k, f.Comentario);
    } else {
      comentarioPorId.set(f.id_star, f.Comentario);
    }
  }
}

// ---- HTTP secuencial con pausa de cortesía ----
let requests = 0;
let primeraRequest = true;
async function traer(url) {
  if (!primeraRequest) await pausaCortesia();
  primeraRequest = false;
  requests++;
  return fetchHtml(url);
}

// Crawlea un listado completo (categoría, opcionalmente filtrada por marca) siguiendo
// su propio paginador. Devuelve { meta (página 1), productos (todas las páginas) }.
async function crawlListado(idCategoria, { idManufacturer = null, etiqueta = '' } = {}) {
  const meta = parseListado(await traer(urlListado(idCategoria, { idManufacturer })));
  const productos = [...meta.productos];
  for (let p = 2; p <= meta.ultimaPagina; p++) {
    const r = parseListado(await traer(urlListado(idCategoria, { idManufacturer, pagina: p })));
    productos.push(...r.productos);
    if (p % 10 === 0 || p === meta.ultimaPagina) {
      console.log(`  ${etiqueta}: página ${p}/${meta.ultimaPagina} · ${productos.length} tiles`);
    }
  }
  return { meta, productos };
}

// ---- registro con dedup por id_star ----
const porId = new Map(); // id_star → producto crudo + fuente ('121' | '100')
const sinId = [];
let duplicados = 0;
function registrar(productos, fuente) {
  for (const p of productos) {
    if (!p.idStar) { sinId.push(p); continue; }
    if (porId.has(p.idStar)) { duplicados++; continue; }
    porId.set(p.idStar, { ...p, fuente });
  }
}

// ---- fila del schema v2 desde un producto crudo ----

// Overrides puntuales de Categoría por id_star para errores de carga DEL SITIO de Star
// (no nuestros). 11898: nombre "LATTAFA PETRA EDP 100ML" pero marca EMPER y slug
// emper-phatom-my-hero → identidad ambigua; se fuerza REVISAR para que no entre al B2B
// hasta que Star lo corrija.
const CATEGORIA_OVERRIDE_POR_ID = new Map([['11898', 'REVISAR']]);

// Tile sin link de marca (hoy: la línea NEW NOTES sale sin .scp-brand): la marca se
// deriva de las primeras palabras del nombre. Si dos palabras (o una) matchean una marca
// del seed, se confía y la cascada clasifica normal; si no, queda la adivinanza de dos
// palabras con Categoría = REVISAR (ni el slug la salva: la marca es un invento nuestro).
// El prefijo TESTER se salta al derivar, pero la regla Tester de la cascada sigue ganando.
function derivarMarca(nombre) {
  const palabras = limpiarTexto(nombre).replace(/^TESTER\s+/i, '').split(' ');
  const dos = palabras.slice(0, 2).join(' ');
  if (mapaMarcas.has(normalizar(dos))) return { marca: dos, enSeed: true };
  if (mapaMarcas.has(normalizar(palabras[0]))) return { marca: palabras[0], enSeed: true };
  return { marca: dos, enSeed: false };
}

function filaDesde(p) {
  let marca = p.marca;
  let categoria;
  if (marca) {
    categoria = clasificarCategoria({ nombre: p.nombre, slugCategoria: p.slugCategoria, marca }, mapaMarcas);
  } else {
    const fb = derivarMarca(p.nombre);
    marca = fb.marca;
    categoria = clasificarCategoria({ nombre: p.nombre, slugCategoria: p.slugCategoria, marca }, mapaMarcas);
    if (!fb.enSeed && categoria !== 'Tester') categoria = 'REVISAR';
  }
  categoria = CATEGORIA_OVERRIDE_POR_ID.get(p.idStar) || categoria;

  let comentario = '';
  if (clones.has(normalizar(marca))) comentario = FLAG_CLON;
  else comentario = comentarioPorId.get(p.idStar) || comentarioPorNombre.get(normalizar(p.nombre)) || '';
  return {
    Marca: marca,
    Producto: p.nombre,
    ml: extraerMl(p.nombre),
    'Categoría': categoria,
    'Costo USD': p.costoUsd,
    Comentario: comentario,
    id_star: p.idStar,
    url_star: p.urlStar,
    stock_star: String(p.stock),
    imagen_url: p.imagenUrl,
    fecha_snapshot: FECHA,
  };
}

const cmpFila = (a, b) => {
  const ka = [normalizar(a.Marca), normalizar(a.Producto), a.id_star];
  const kb = [normalizar(b.Marca), normalizar(b.Producto), b.id_star];
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
};

const tabla = (filas) => {
  const t = {};
  for (const f of filas) t[f['Categoría']] = (t[f['Categoría']] || 0) + 1;
  return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}: ${n}`).join(' · ');
};

async function main() {
  // ---------- dry-run: 1 request, 5 registros derivados, sin escrituras ----------
  if (DRY) {
    const idCat = SOLO_CAT || CAT_PERFUMES;
    console.log(`--dry-run: página 1 de la categoría ${idCat} (1 request, no se escribe nada)\n`);
    const r = parseListado(await traer(urlListado(idCat)));
    console.log(`declarados: ${r.totalDeclarado} productos · última página: ${r.ultimaPagina} · marcas en sidebar: ${r.marcasSidebar.length}\n`);
    for (const p of r.productos.slice(0, 5)) {
      const f = filaDesde({ ...p, fuente: idCat });
      for (const col of COLUMNAS) console.log(`  ${col}: ${f[col]}`);
      console.log('');
    }
    return;
  }

  // ---------- crawl ----------
  let meta121 = null;
  let meta100 = null;
  const marcasScope100 = [];

  if (!SOLO_CAT || SOLO_CAT === CAT_PERFUMES) {
    console.log(`Categoría ${CAT_PERFUMES} (PERFUMES) completa…`);
    const { meta, productos } = await crawlListado(CAT_PERFUMES, { etiqueta: 'cat 121' });
    meta121 = meta;
    registrar(productos, '121');
    console.log(`  → ${porId.size} únicos (declarados: ${meta.totalDeclarado})`);
  }

  if (!SOLO_CAT || SOLO_CAT === CAT_COSMETICOS) {
    console.log(`Categoría ${CAT_COSMETICOS} (COSMÉTICOS), filtrada a marcas del catálogo…`);
    meta100 = parseListado(await traer(urlListado(CAT_COSMETICOS)));
    for (const m of meta100.marcasSidebar) {
      if (mapaMarcas.has(normalizar(m.marca))) marcasScope100.push(m);
    }
    console.log(`  marcas en scope: ${marcasScope100.length}/${meta100.marcasSidebar.length} → ${marcasScope100.map((m) => m.marca).join(', ')}`);
    for (const m of marcasScope100) {
      const antes = porId.size;
      const { productos } = await crawlListado(CAT_COSMETICOS, { idManufacturer: m.idManufacturer, etiqueta: `cat 100 · ${m.marca}` });
      registrar(productos, '100');
      console.log(`  cat 100 · ${m.marca}: ${productos.length} listados, +${porId.size - antes} nuevos`);
    }
  }

  // ---------- derivar filas + validación dura (aborta SIN escribir) ----------
  const filas = [...porId.values()].map(filaDesde).sort(cmpFila);

  const stockRaro = [...porId.values()].filter((p) => !/in\s*stock/i.test(p.stockCrudo));
  if (stockRaro.length) {
    console.log(`\n⚠️ ${stockRaro.length} tiles sin "N In Stock" (quedaron stock 0). Markup nuevo a estudiar:`);
    for (const p of stockRaro.slice(0, 5)) console.log(`  [${p.idStar}] ${p.nombre} → "${p.stockCrudo}"`);
  }

  const sinCosto = filas.filter((f) => !f['Costo USD']);
  if (sinId.length || sinCosto.length) {
    console.error(`\nABORTADO (validación): ${sinId.length} tiles sin id_star, ${sinCosto.length} filas sin Costo USD. No se escribió nada.`);
    for (const p of sinId.slice(0, 5)) console.error(`  sin id: "${p.nombre}" ← ${p.urlStar}`);
    for (const f of sinCosto.slice(0, 5)) console.error(`  sin costo: [${f.id_star}] ${f.Producto}`);
    process.exit(1);
  }
  if (!SOLO_CAT && filas.length < MINIMO_FILAS) {
    console.error(`\nABORTADO (validación): ${filas.length} filas < mínimo ${MINIMO_FILAS}. El sitio o el parseo cambiaron; no se pisó el CSV.`);
    process.exit(1);
  }
  if (meta121) {
    const unicos121 = [...porId.values()].filter((p) => p.fuente === '121').length;
    if (Math.abs(unicos121 - meta121.totalDeclarado) > 25) {
      console.log(`\n⚠️ cat 121: ${unicos121} únicos vs ${meta121.totalDeclarado} declarados (Δ > 25; posible reordenamiento durante el crawl).`);
    }
  }
  if (duplicados) console.log(`  (dedup: ${duplicados} tiles repetidos entre páginas/categorías)`);

  // ---------- modo debug --cat: un solo archivo, no toca master/snapshots ----------
  if (SOLO_CAT) {
    fs.mkdirSync(DIR_PROV, { recursive: true });
    const rutaDebug = path.join(DIR_PROV, `debug-cat${SOLO_CAT}.csv`);
    escribirCsv(rutaDebug, COLUMNAS, filas);
    console.log(`\n[debug] ${filas.length} filas → ${rutaDebug} (gitignoreado; master y snapshots intactos)`);
    console.log(`Por categoría: ${tabla(filas)}`);
    return;
  }

  // ---------- escrituras ----------
  fs.mkdirSync(DIR_SNAPSHOTS, { recursive: true });
  fs.mkdirSync(DIR_REPORTES, { recursive: true });

  let base = FECHA;
  for (let i = 2; fs.existsSync(path.join(DIR_SNAPSHOTS, `${base}.csv`)); i++) base = `${FECHA}-${i}`;

  escribirCsv(path.join(DIR_SNAPSHOTS, `${base}.csv`), COLUMNAS, filas);

  // Censo de marcas (sidebar de ambas categorías): insumo del diff (§8.6) y radar de altas.
  const censo = [];
  for (const [cat, meta] of [[CAT_PERFUMES, meta121], [CAT_COSMETICOS, meta100]]) {
    for (const m of meta?.marcasSidebar ?? []) {
      censo.push({ cat_star: cat, Marca: m.marca, id_manufacturer: m.idManufacturer, conteo: String(m.conteo) });
    }
  }
  escribirCsv(path.join(DIR_SNAPSHOTS, `${base}-marcas.csv`), ['cat_star', 'Marca', 'id_manufacturer', 'conteo'], censo);

  // ---------- master: primera corrida (reconciliación) o retención ----------
  let masterFinal = filas;
  let retenidas = [];
  let caidas = [];

  if (master && esLegacy) {
    // Archivo legacy → se preserva una copia byte a byte y se reconcilia por nombre.
    if (!fs.existsSync(RUTA_LEGACY)) fs.writeFileSync(RUTA_LEGACY, fs.readFileSync(RUTA_MASTER));

    const nombreAFuente = new Map();
    for (const p of porId.values()) {
      const k = normalizar(p.nombre);
      if (!nombreAFuente.has(k)) nombreAFuente.set(k, p.fuente);
    }
    let en121 = 0;
    let en100 = 0;
    const sinCorr = [];
    const via100PorMarca = new Map();
    for (const f of master.filas) {
      const fuente = nombreAFuente.get(normalizar(f.Producto));
      if (fuente === '121') en121++;
      else if (fuente === '100') {
        en100++;
        via100PorMarca.set(f.Marca, (via100PorMarca.get(f.Marca) || 0) + 1);
      } else sinCorr.push(f);
    }

    const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
    const md = [
      `# Reconciliación primera corrida — ${base}`,
      '',
      `CSV legacy: **${master.filas.length} filas** → matcheadas por nombre normalizado contra el scrape:`,
      '',
      `| bucket | filas |`,
      `|---|---:|`,
      `| en cat 121 (PERFUMES) | ${en121} |`,
      `| en cat 100 (COSMÉTICOS) | ${en100} |`,
      `| **sin correspondencia** | **${sinCorr.length}** |`,
      '',
      '## Matcheadas vía cat 100 (por marca)',
      '',
      via100PorMarca.size
        ? ['| Marca | filas |', '|---|---:|', ...[...via100PorMarca.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `| ${esc(m)} | ${n} |`)].join('\n')
        : '_ninguna_',
      '',
      '## Sin correspondencia (deuda de matching)',
      '',
      'No son altas ni bajas: son filas del CSV viejo que el scrape de hoy no encontró por nombre.',
      'Causas típicas: producto descatalogado desde la extracción original, **sin stock al momento del',
      'crawl** (el listado oculta agotados), renombrado en el sitio, o producto de una categoría no',
      'cubierta por el alcance (cat 121 + cat 100 de marcas del catálogo).',
      '',
      sinCorr.length
        ? ['| Marca | Producto | Categoría | Costo USD |', '|---|---|---|---:|', ...sinCorr.map((f) => `| ${esc(f.Marca)} | ${esc(f.Producto)} | ${esc(f['Categoría'])} | ${f['Costo USD']} |`)].join('\n')
        : '_ninguna_',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(DIR_REPORTES, `${base}-reconciliacion.md`), md, 'utf8');

    console.log(`\nReconciliación legacy: ${en121} en cat 121 · ${en100} en cat 100 · ${sinCorr.length} sin correspondencia`);
    console.log(`  → detalle en proveedor/reportes/${base}-reconciliacion.md (copia legacy en proveedor/legacy-catalogo-proveedor.csv)`);
  } else if (master && !esLegacy) {
    // Retención: 1 corrida de gracia antes de caer del master.
    const fechaPrev = master.filas.reduce((mx, f) => (f.fecha_snapshot > mx ? f.fecha_snapshot : mx), '');
    retenidas = master.filas.filter((f) => f.id_star && !porId.has(f.id_star) && f.fecha_snapshot === fechaPrev);
    caidas = master.filas.filter((f) => f.id_star && !porId.has(f.id_star) && f.fecha_snapshot < fechaPrev);
    masterFinal = [...filas, ...retenidas].sort(cmpFila);
  }

  escribirCsv(RUTA_MASTER, COLUMNAS, masterFinal);

  // ---------- resumen ----------
  const clonesN = filas.filter((f) => f.Comentario === FLAG_CLON).length;
  const revisar = new Map();
  for (const f of filas) {
    if (f['Categoría'] === 'REVISAR') revisar.set(f.Marca, (revisar.get(f.Marca) || 0) + 1);
  }

  console.log(`\n─── Corrida ${base} ───`);
  console.log(`Snapshot: ${filas.length} filas → proveedor/snapshots/${base}.csv (+ censo ${base}-marcas.csv)`);
  console.log(`Por categoría: ${tabla(filas)}`);
  console.log(`Flags clon/genérico: ${clonesN}`);
  if (revisar.size) {
    console.log(`⚠️ Categoría REVISAR (marcas nuevas; sumalas a proveedor/marcas-categoria.csv y re-corré):`);
    for (const [m, n] of [...revisar.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${m || '(sin marca — tiles sin .scp-brand en el sitio)'}: ${n} productos`);
    }
  }
  if (retenidas.length || caidas.length) {
    console.log(`Master: ${retenidas.length} filas retenidas (ausentes hoy, caen si faltan de nuevo) · ${caidas.length} caídas (2 corridas ausentes)`);
    for (const f of caidas.slice(0, 10)) console.log(`  caída: ${f.Marca} — ${f.Producto} (última vista ${f.fecha_snapshot})`);
  }
  console.log(`Master: ${masterFinal.length} filas → catalogo-proveedor.csv`);
  console.log(`${requests} requests en ${Math.round((Date.now() - inicio) / 1000)}s`);
  console.log(`Siguiente paso: node diff-proveedor.mjs`);
}

main().catch((e) => {
  if (e instanceof ErrorBloqueo) {
    console.error(`\nABORTADO por bloqueo del sitio (${e.message}).`);
    console.error('No escalar a headless sin decisión explícita. Reintentar más tarde; si persiste, avisar a Star (somos cliente).');
  } else {
    console.error('\nERROR:', e.stack || e.message);
  }
  process.exit(1);
});
