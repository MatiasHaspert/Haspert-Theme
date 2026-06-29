// Cliente GraphQL mínimo para la Admin API de Shopify (sin dependencias).
// Lee credenciales de variables de entorno (cargadas desde .env por los scripts).

// Leemos el entorno en el momento de la llamada (no al importar): los scripts
// corren `loadDotEnv()` en su cuerpo, DESPUÉS de que se evalúan los imports.
const store = () => process.env.SHOPIFY_STORE; // ej: tu-tienda.myshopify.com
const directToken = () => process.env.ADMIN_TOKEN; // token clásico shpat_ (opcional)
const clientId = () => process.env.SHOPIFY_CLIENT_ID; // app del Dev Dashboard
const clientSecret = () => process.env.SHOPIFY_CLIENT_SECRET;
const version = () => process.env.API_VERSION || '2026-04';

function hasDirectToken() {
  const t = directToken();
  return Boolean(t && t.startsWith('shpat_'));
}

export function assertEnv() {
  const missing = [];
  if (!store()) missing.push('SHOPIFY_STORE');
  // Dos caminos de auth: token clásico shpat_, o client_credentials (Dev Dashboard).
  if (!hasDirectToken() && !(clientId() && clientSecret())) {
    missing.push('ADMIN_TOKEN (shpat_) o SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET');
  }
  if (missing.length) {
    throw new Error(
      `Faltan variables de entorno: ${missing.join(', ')}. ` +
        `Copiá .env.example a .env y completalas.`
    );
  }
}

// Cache en memoria del access token obtenido por client_credentials.
let cached = null; // { value, expiresAt, scope }

/**
 * Devuelve un Admin API access token.
 * - Si hay ADMIN_TOKEN clásico (shpat_), lo usa directo.
 * - Si no, hace el client_credentials grant con Client ID + Secret del Dev Dashboard
 *   y cachea el token (válido ~24h) hasta 60s antes de que venza.
 */
export async function getAccessToken() {
  assertEnv();
  if (hasDirectToken()) return directToken();

  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const res = await fetch(`https://${store()}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId(),
      client_secret: clientSecret(),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `No se pudo obtener access token (client_credentials): HTTP ${res.status}: ${text}. ` +
        `Verificá que la app esté instalada en ${store()}, que la versión con scopes esté publicada, ` +
        `y que Client ID/Secret sean los de esa app.`
    );
  }

  const json = await res.json();
  const ttlMs = (Number(json.expires_in) || 86399) * 1000;
  cached = {
    value: json.access_token,
    scope: json.scope || '',
    expiresAt: Date.now() + ttlMs - 60_000,
  };
  return cached.value;
}

/** Scope concedido en el último token obtenido (para diagnóstico). */
export function lastGrantedScope() {
  return cached ? cached.scope : null;
}

const endpoint = () => `https://${store()}/admin/api/${version()}/graphql.json`;

/**
 * Ejecuta una operación GraphQL. Lanza si hay errores de transporte o `errors` de GraphQL.
 * Los `userErrors` de cada mutación se chequean en el caller (son específicos del payload).
 */
export async function gql(query, variables = {}) {
  const accessToken = await getAccessToken();
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  // 429 / rate limit: respetá el Retry-After y reintentá una vez.
  if (res.status === 429) {
    const wait = Number(res.headers.get('Retry-After') || 2) * 1000;
    await sleep(wait);
    return gql(query, variables);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} de Shopify: ${text}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors, null, 2)}`);
  }
  return json.data;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Carga pares CLAVE=valor de un archivo .env al process.env (sin dependencias). */
export async function loadDotEnv(path = new URL('../.env', import.meta.url)) {
  const { readFile } = await import('node:fs/promises');
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return; // sin .env: se asume que las vars ya están en el entorno
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
