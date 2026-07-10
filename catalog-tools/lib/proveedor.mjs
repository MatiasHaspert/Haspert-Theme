// Parseo y normalización del catálogo del proveedor (Star Company, PrestaShop + módulo
// custom `starcategorypremium`). Compartido por pull-proveedor.mjs, diff-proveedor.mjs y
// seed-marcas-categoria.mjs. NO toca Shopify ni necesita .env.
//
// Contrato del sitio (verificado 10-jul-2026; ver README §"Sincronización con proveedor"):
//   - Listado server-rendered (sin JS). No hay endpoint JSON: con `X-Requested-With` y
//     `from-xhr=1` responde el mismo HTML completo; `ajax=1` responde vacío.
//   - Tiles: <article class="scp-card"> con .scp-brand / h2>a / .scp-price / .scp-stock.
//   - Paginación: nav.scp-pagination, 24 por página. robots.txt prohíbe `?order=`/`&order=`
//     → las URLs propias van SIN order (el orden por defecto ya es "position").
//   - Sidebar de marcas: a.scp-brand-link[data-brand] con id_manufacturer y conteo en <b>.
//   - Precio en formato pt-BR: "U$ 1.136,00" (punto = miles, coma = decimal).
//   - Los productos sin stock NO aparecen en el listado (PrestaShop oculta agotados):
//     por eso un tile sin "N In Stock" se registra como stock 0 y se avisa por consola.

import fs from 'node:fs';
import * as cheerio from 'cheerio';

export const BASE_URL = 'https://www.starcompany-py.com';
export const USER_AGENT = 'HaspertCatalogSync/1.0 (+https://github.com/MatiasHaspert/Haspert-Theme)';
export const CAT_PERFUMES = '121';
export const CAT_COSMETICOS = '100';
export const FLAG_CLON = 'clon/genérico';

// Schema v2: las 6 columnas del CSV original (mismo nombre y orden) + las nuevas al final.
export const COLUMNAS = [
  'Marca', 'Producto', 'ml', 'Categoría', 'Costo USD', 'Comentario',
  'id_star', 'url_star', 'stock_star', 'imagen_url', 'fecha_snapshot',
];

// ---------- normalización ----------

// Clave de matching (marca o producto): sin BOM, sin acentos, sin puntuación débil
// (. , ! y apóstrofes), "&" sin espacios alrededor, MAYÚSCULAS, espacios colapsados.
// Solo para comparar; nunca se persiste. La puntuación se dropea porque el sitio y el
// CSV legacy escriben las mismas marcas distinto (verificado corrida 2026-07-10):
// D.HERMOSA / D'Hermosa · DOLCE&GABBANA / Dolce & Gabbana · BOND NO 9 / Bond No. 9 ·
// VIKTOR&ROLF / Viktor & Rolf. Cero colisiones de nombres de producto con esta regla.
export const normalizar = (s) =>
  String(s ?? '')
    .replace(/﻿/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,!'’‘´`]/g, '')
    .toUpperCase()
    .replace(/\s*&\s*/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export const limpiarTexto = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// ---------- parsers de campo ----------

// "U$ 1.136,00" → "1136.00" · "U$ 2,75" → "2.75". String con 2 decimales, '' si no hay número.
export function parsePrecioPtBR(txt) {
  const t = String(txt ?? '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(t)) return '';
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n.toFixed(2) : '';
}

// Primer "(\d+)ML" del nombre. Kits tipo "4PCS X 5ML" y nombres sin ml → ''.
export function extraerMl(nombre) {
  const n = String(nombre ?? '');
  if (/\d\s*PCS/i.test(n)) return '';
  const m = n.match(/(\d+)\s?ML/i);
  return m ? m[1] : '';
}

// "171 In Stock" → 171. Sin match → 0 (el listado oculta agotados, ver header).
export function parseStock(txt) {
  const m = String(txt ?? '').match(/(\d+)\s*in\s*stock/i);
  return m ? parseInt(m[1], 10) : 0;
}

// URL de ficha: /{slug-categoria}/{id}-{slug}.html → { slugCategoria, idStar }.
// El id numérico es estable → clave primaria del pipeline.
export function parseUrlProducto(href) {
  const m = String(href ?? '').match(/\/([^/]+)\/(\d+)-[^/]*\.html(?:[?#]|$)/);
  return m ? { slugCategoria: m[1], idStar: m[2] } : null;
}

// ---------- parseo del listado ----------

// Placeholder de PrestaShop para productos sin foto (img/p/br.jpg y variantes por idioma).
const esPlaceholder = (src) => /\/img\/p\//.test(String(src ?? ''));

// Devuelve { productos, totalDeclarado, ultimaPagina, marcasSidebar } de una página de listado.
export function parseListado(html) {
  const $ = cheerio.load(html);

  const productos = [];
  $('article.scp-card').each((_, el) => {
    const $el = $(el);
    const $link = $el.find('h2 a').first();
    const href = $link.attr('href') || $el.find('a.scp-img').attr('href') || '';
    const url = parseUrlProducto(href);
    const imagen = $el.find('a.scp-img img').attr('src') || '';
    const stockCrudo = limpiarTexto($el.find('.scp-stock').first().text());
    productos.push({
      marca: limpiarTexto($el.find('.scp-brand').first().text()),
      nombre: limpiarTexto($link.text()),
      urlStar: href,
      idStar: url?.idStar ?? '',
      slugCategoria: url?.slugCategoria ?? '',
      costoUsd: parsePrecioPtBR($el.find('.scp-price').first().text()),
      stock: parseStock(stockCrudo),
      stockCrudo,
      imagenUrl: esPlaceholder(imagen) ? '' : imagen,
    });
  });

  const totalDeclarado = parseInt(($('.scp-count').first().text().match(/\d+/) || ['0'])[0], 10);

  let ultimaPagina = 1;
  $('.scp-pagination a').each((_, a) => {
    const m = ($(a).attr('href') || '').match(/[?&]p=(\d+)/);
    if (m) ultimaPagina = Math.max(ultimaPagina, parseInt(m[1], 10));
  });

  // "TODAS AS MARCAS" no lleva data-brand, así que queda afuera sola.
  const marcasSidebar = [];
  $('a.scp-brand-link[data-brand]').each((_, a) => {
    const $a = $(a);
    marcasSidebar.push({
      marca: limpiarTexto($a.find('span').first().text()),
      idManufacturer: ((($a.attr('href') || '').match(/id_manufacturer=(\d+)/)) || [])[1] || '',
      conteo: parseInt(limpiarTexto($a.find('b').first().text()) || '0', 10),
    });
  });

  return { productos, totalDeclarado, ultimaPagina, marcasSidebar };
}

// ---------- clasificación ----------

// Cascada del brief (gana la primera): TESTER → slug nicho → mapa marca→categoría → REVISAR.
export function clasificarCategoria({ nombre, slugCategoria, marca }, mapaMarcas) {
  if (/^TESTER/i.test(limpiarTexto(nombre)) || slugCategoria === 'perfume-tester') return 'Tester';
  if (slugCategoria === 'perfumes-de-nicho') return 'Nicho';
  return mapaMarcas.get(normalizar(marca)) || 'REVISAR';
}

// ---------- CSV (RFC 4180: coma, comillas dobles, CRLF; UTF-8 con BOM como el original) ----------

export function parseCsv(texto) {
  const t = String(texto ?? '').replace(/^﻿/, '');
  const filas = [];
  let fila = [];
  let campo = '';
  let enComillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else enComillas = false;
      } else campo += c;
    } else if (c === '"') {
      enComillas = true;
    } else if (c === ',') {
      fila.push(campo); campo = '';
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.length > 1 || fila[0] !== '') filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

const escaparCampo = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const aCsv = (filas) => filas.map((f) => f.map(escaparCampo).join(',')).join('\r\n') + '\r\n';

// Lee un CSV como array de objetos {header: valor}. Devuelve { headers, filas }.
export function leerCsvObjetos(ruta) {
  const crudas = parseCsv(fs.readFileSync(ruta, 'utf8'));
  const headers = crudas[0] ?? [];
  const filas = crudas.slice(1).map((f) => Object.fromEntries(headers.map((h, i) => [h, f[i] ?? ''])));
  return { headers, filas };
}

export function escribirCsv(ruta, headers, filasObj) {
  const data = [headers, ...filasObj.map((o) => headers.map((h) => o[h] ?? ''))];
  fs.writeFileSync(ruta, '﻿' + aCsv(data), 'utf8');
}

// ---------- HTTP cortés ----------

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// 1 request/segundo con jitter ±300ms (concurrencia 1 la garantiza el caller: await secuencial).
export const pausaCortesia = () => dormir(1000 + Math.round(Math.random() * 600 - 300));

const pareceChallenge = (html) =>
  /just a moment|cf-challenge|attention required|cf_chl_/i.test(String(html).slice(0, 3000));

// 403/429/challenge: tipado aparte para que el caller aborte la corrida y reporte,
// sin escalar a headless (decisión explícita del brief).
export class ErrorBloqueo extends Error {
  constructor(msg, status) {
    super(msg);
    this.name = 'ErrorBloqueo';
    this.status = status;
  }
}

// GET con UA identificable, timeout 20s y 3 intentos con backoff exponencial (2s/4s/8s).
export async function fetchHtml(url) {
  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(20_000),
        redirect: 'follow',
      });
      if (res.status === 403 || res.status === 429) {
        throw new ErrorBloqueo(`HTTP ${res.status} en ${url}`, res.status);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
      const html = await res.text();
      if (pareceChallenge(html)) throw new ErrorBloqueo(`challenge anti-bot en ${url}`, res.status);
      return html;
    } catch (e) {
      ultimoError = e;
      if (intento < 3) await dormir(2000 * 2 ** (intento - 1));
    }
  }
  throw ultimoError;
}

// URL de listado robots-safe: sin &order= (prohibido por robots.txt del sitio).
export function urlListado(idCategoria, { pagina = 1, idManufacturer = null } = {}) {
  const params = ['fc=module'];
  if (idManufacturer) params.push(`id_manufacturer=${idManufacturer}`);
  if (pagina > 1) params.push(`p=${pagina}`);
  return `${BASE_URL}/categoria-premium/${idCategoria}?${params.join('&')}`;
}

// ---------- fecha ----------

export function fechaLocalISO(d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}
