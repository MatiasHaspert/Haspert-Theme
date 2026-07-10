# catalog-tools — carga del catálogo de perfumes

Tooling **fuera del theme** para cargar el catálogo en Shopify de forma dinámica y repetible.
No es parte del theme (está en `.shopifyignore`, no se sube con `shopify theme push`).

Una **fuente de verdad** (`perfumes.xlsx`) + un script que crea cada perfume con sus 4
presentaciones (Frasco / Decant 10ml / Decant 5ml / Tester) y **calcula** los precios de decants y
tester desde el precio del frasco. Idempotente por `handle`: re-correr **repreciá**, no duplica.

## Requisitos

- Node 18+ (usa `fetch` nativo).
- Una app del **Dev Dashboard** (dev.shopify.com) instalada en la tienda, **o** una custom app
  clásica con token `shpat_` (ver más abajo).

## 1. Crear la app y autenticar (una vez)

Esta tienda usa el **Dev Dashboard** (al apretar "Desarrollar apps" en el admin redirige ahí). Esas
apps **no dan un token estático `shpat_`**: se autentica con **client credentials** (Client ID +
Client secret → access token de 24h que el script pide solo). El `atkn_` ("Token de automatización")
es para el deploy del CLI, **no** sirve para la Admin API.

Pasos:
1. En el Dev Dashboard, abrí (o creá) la app. En **Versiones**, en **Acceso → Alcances** poné
   (y **publicá** la versión):
   `write_products,read_products,write_inventory,read_inventory,write_files,read_files,write_publications,read_publications,read_locations`
2. **Instalá la app en la tienda** (Calmi). La app y la tienda deben estar en la **misma organización**
   (las apps creadas desde el botón "Desarrollar apps" del admin del store ya lo están).
3. En **Settings** de la app, copiá **Client ID** y **Client secret**.

```bash
cp .env.example .env
# editar .env con SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, API_VERSION
npm install
```

> Alternativa (custom app clásica): si en algún momento tenés un token `shpat_` (admin →
> Settings → Apps → Develop apps), poné `ADMIN_TOKEN=shpat_...` en el `.env` y tiene prioridad
> sobre client_credentials. La versión de la API la fija `API_VERSION` (hoy `2026-04`).

## 2. Definir / sincronizar los metafields

```bash
npm run setup      # node setup-metafields.mjs
```

`setup-metafields.mjs` es la **fuente de verdad del schema**: crea las definiciones que faltan y
**actualiza las opciones (choices)** de las que ya existen. Idempotente. Verificá en
`Admin → Settings → Custom data → Products`.

**Listas cerradas (choices).** Estos campos solo aceptan valores de una lista fija — el `perfumes.xlsx`
debe usar exactamente esos textos o `productSet` rebota con `INVALID_METAFIELD`:

| campo | valores válidos |
|---|---|
| `familia_olfativa` | Amaderado · Oriental/Ámbar · Floral · Cítrico · Aromático · Especiado · Dulce/Gourmand · Frutal · Fresco/Acuático · Cuero · Chipre · Fougère · Almizclado |
| `casa` | Árabe · Diseñador · Nicho |
| `genero` | Masculino · Femenino · Unisex |
| `ocasion` | Diario · Oficina · Casual/Fin de semana · Noche · Formal/Evento · Cita romántica · Deporte |
| `estacion` | Primavera · Verano · Otoño · Invierno · Todo el año |
| `concentracion` | Eau Fraîche · Eau de Cologne (EDC) · Eau de Toilette (EDT) · Eau de Parfum (EDP) · Eau de Parfum Intense · Parfum/Extrait · Attar / Aceite |
| `longevidad` | Baja (2–4h) · Moderada (4–6h) · Larga (6–8h) · Muy larga (8–12h) · Eterna (12h+) |
| `estela` | Íntima · Moderada · Notable · Enorme |

Para cambiar estas listas, editá `PRODUCT_FIELDS` en `setup-metafields.mjs` y re-corré `npm run setup`.
`familia_olfativa` y `genero` están en uso en smart collections; el script re-envía las
`capabilities` para poder editarlos (sin eso rebota con `CAPABILITY_CANNOT_BE_DISABLED`).

**Facets (capabilities).** Los campos facetables (`FACET_KEYS` en el script: `familia_olfativa`,
`casa`, `genero`, `ocasion`, `estacion`, `longevidad`, `concentracion`) se crean/actualizan con las
capabilities `smartCollectionCondition` (armar colecciones automáticas por regla) y `adminFilterable`
(filtrar en el admin) **habilitadas**. Verificado en 2026-04: crear una definición **no** las
auto-habilita → sin esto, `create-collections` / `create-landing` rebotan al armar la regla.
`npm run setup` también soporta `--dry-run` (no escribe; muestra qué crearía/actualizaría y qué
capabilities habilitaría).

## 3. Cargar el catálogo

Editá `perfumes.xlsx` en Excel (o Google Sheets / LibreOffice). Primera hoja, fila 1 = headers
(no la cambies de orden ni de nombre), una fila por perfume.

- Listas (familia, notas, `ocasion`, `estacion`) → separá con `;` dentro de la celda: `Amaderado;Oriental`.
- `casa` → **facet primario** (`Árabe` / `Diseñador` / `Nicho`). Lista cerrada; escribí el valor exacto.
  Ver `CASA-MAPEO-SUGERIDO.md` para un borrador marca→casa (revisá y cargá vos; no está hardcodeado).
- `ocasion` / `estacion` → listas cerradas (ver tabla de arriba). Alimentan las colecciones landing
  "Para la noche" (`ocasion` = Noche) y "Frescos para el verano" (`estacion` = Verano).
- `precio_frasco` y `frasco_ml` → números. Sin separadores de miles (`38000`, no `38.000`).
  (`frasco_ml` también se guarda como metafield `tamano_frasco_ml`.)
- `anio_lanzamiento` → opcional, año de lanzamiento (número). Se guarda como metafield.
- `precio_frasco_anterior` → opcional. **Ancla REAL previa** para el precio tachado. Vacío = sin
  tachado. Nunca inventes un "antes" más alto (Defensa del Consumidor + quema confianza).
- `inspirado_en` → opcional y **legalmente sensible**. Copy prudente; nunca afirma ser la marca.
- `handle` → dejalo vacío para que se derive de `marca-nombre`; o fijalo para controlar la URL.

```bash
npm run dry                       # node load-catalog.mjs --dry-run  (imprime, no escribe)
node load-catalog.mjs --dry-run --limit 1
node load-catalog.mjs --limit 2   # carga real, primeras 2 filas
npm run load                      # carga real, todas
```

Empezá con `--dry-run` y revisá los precios calculados y los títulos de variante antes de escribir.

## Reglas de precio (`lib/pricing.mjs`)

```
$/ml frasco = precio_frasco / frasco_ml
Decant 10ml = $/ml × 10 × 2,0   (redondeado a $100)
Decant 5ml  = $/ml × 5  × 2,3   (redondeado a $100)
Tester      = precio_frasco × 0,90
```

Ejemplo (frasco $38.000 / 100ml → $/ml 380): decant10 $7.600 · decant5 $4.400 · tester $34.200.
Cambiás `precio_frasco`, re-corrés `npm run load` y se repreciá todo (flujo anti-inflación).

## Después de cargar

Las colecciones de esta tienda son **automáticas por metafield** (`PRODUCT_METAFIELD_DEFINITION`),
**no por tag**. El orden importa (las capabilities las habilita `setup`):

```bash
npm run setup        # 1. definiciones + capabilities de facets (incluye casa). Soporta --dry-run
npm run load         # 2. carga/repreciá el catálogo desde el xlsx (incluye casa/ocasion/estacion)
npm run collections  # 3. colecciones por familia_olfativa + casa (idempotente). --dry-run
npm run landing      # 4. colecciones landing por ángulo de campaña (smart/manual). --dry-run
npm run audit        # 5. auditoría de valores (solo lectura) — corré antes de escalar
```

### Colecciones por facet (`create-collections.mjs`)

Crea una colección por cada valor **en uso** de `familia_olfativa` y `casa` que todavía no tenga
una (no crea vacías; idempotente por condición de regla). Las de género (Masculino/Femenino/Unisex)
y por marca (regla `VENDOR`) ya existen y no se tocan.

- familia → `Perfumes {familia}` (handle derivado por Shopify).
- casa → `Árabes` {`arabes`} · `Diseñador` {`disenador`} · `Nicho` {`nicho`} (handles fijos para
  linkear estable desde el theme). Requiere que `casa` esté cargado en ≥1 producto.

> El loader escribe solo `familia` como `tag` (utilidad de búsqueda); las colecciones leen los
> metafields directamente, no los tags.

### Colecciones landing (`create-landing-collections.mjs`)

Colecciones por **ángulo de campaña** para la PLP. Cada una decide **smart vs manual** en runtime:
si el metafield de la regla existe y tiene la capability habilitada → **smart** (regla); si no →
**manual** con aviso. Idempotente por handle. Cada una lleva un `descriptionHtml` placeholder de 1
línea (editable en el Admin).

| colección | handle | tipo | regla / motivo |
|---|---|---|---|
| Rinden todo el día | `rinden-todo-el-dia` | smart | `longevidad` = Eterna (12h+) |
| Para la noche | `para-la-noche` | smart | `ocasion` = Noche |
| Frescos para el verano | `frescos-para-el-verano` | smart | `estacion` = Verano (fallback: familia Cítrico/Fresco-Acuático) |
| Alternativas a los clásicos | `alternativas-a-los-clasicos` | **manual** | LEGAL (equivalencias): curaduría 100% manual a propósito |
| Los más elegidos | `los-mas-elegidos` | **manual** | sin data de ventas todavía |
| Para regalar | `para-regalar` | **manual** | curaduría editorial |
| Para arrancar: probá con decants | `arranca-con-decants` | **manual** | `VARIANT_PRICE` no aísla el frasco → manual (falta umbral) |

> "Rinden todo el día" usa **solo** el valor tope `Eterna (12h+)`. Para ampliar a "8h+", agregá
> `'Muy larga (8–12h)'` al array `values` de esa entrada en el script (queda OR automático).

### Auditoría de valores (`audit-metafield-values.mjs`) — solo lectura

Lista, por facet, los valores distintos en uso + su conteo, y marca inconsistencias que crean
**facets fantasma** (espacios sobrantes, valores fuera de la lista cerrada, duplicados por
mayúsculas/acentos). No escribe nada. Corré `npm run audit` antes de una carga grande y normalizá
en el Admin/xlsx lo que marque.

### Filtros del storefront (Search & Discovery)

`catalog-tools` **solo garantiza que los metafields existan** y tengan `adminFilterable`
habilitado. Los **filtros que ve el comprador** en la colección se configuran a mano en
**Admin → Settings → Search & discovery → Filtros** (no hay API estable de Admin para gestionarlos).
Activá ahí, en este orden de prioridad: **casa, familia_olfativa, género, precio, marca** (primarios)
y **longevidad, ocasión** (secundarios).

### Apuntar colecciones en el theme

En el editor del theme, apuntá las colecciones en:
- `kit-decants` (Colección de decants) — toma la variante "Decant 5ml".
- `related-by-family` (Colección) — cross-sell en PDP.
- `Theme settings → Cross-sell en carrito` (`cart_xsell_collection`).

## Disponibilidad y stock

Dos capas independientes:

1. **Publicación.** `productSet` crea el producto `ACTIVE` pero **no lo publica** en ningún canal →
   no aparece en el storefront. El loader lo **publica en Online Store** automáticamente
   (`publishablePublish`, scope `write_publications`).
2. **Stock (modelo MIXTO).**
   - **Frasco y Tester:** `tracked: true` + `inventoryPolicy: DENY` → a 0 unidades quedan **agotados**.
   - **Decants (5/10ml):** `tracked: false` + `CONTINUE` → **siempre disponibles** (se arman a pedido
     desde el frasco), no llevan cantidad.

   Las **cantidades** de frasco/tester se setean aparte:

```bash
npm run stock                   # node set-stock.mjs  (setea cantidades absolutas)
node set-stock.mjs --dry-run
```

`set-stock.mjs` lee las columnas `stock_frasco` y `stock_tester` y setea la cantidad **absoluta** por
variante en la location (la primera activa, o `LOCATION_ID` del `.env`). Usa el compare-and-swap de la
API 2026-04 (`changeFromQuantity` + directiva `@idempotent`).

> ⚠️ **`set-stock` PISA el stock actual.** El loader (`npm run load`) **nunca** toca cantidades, así
> que repreciar es seguro. Pero `set-stock` es para carga inicial / reset deliberado: si lo corrés
> después de ventas, resetea las cantidades a las del xlsx. Para el día a día, ajustá el stock en el
> admin de Shopify (que es la fuente de verdad del stock; el xlsx lo es del catálogo y los precios).

### Flujo de stock recomendado

**Shopify = fuente de verdad del stock** (se descuenta solo en cada venta). El xlsx es un canal para
*empujar* valores a propósito, no un espejo en vivo.

- **Día a día:** dejá las columnas `stock_frasco`/`stock_tester` **en blanco**. `set-stock` ignora las
  celdas vacías, así que re-correrlo no pisa nada. Las ventas las descuenta Shopify; ajustás/reponés
  en el admin.
- **Carga inicial / reposición puntual:** poné el número solo en esa fila, `npm run stock`, y volvé a
  dejar la celda en blanco.
- **Backup legible / master:** `npm run pull` (read-only) vuelca el stock actual de Shopify en una
  hoja aparte **"Stock (Shopify)"** del xlsx, sin tocar las columnas input. Correlo cuando quieras un
  snapshot.

```bash
npm run pull                    # node pull-stock.mjs  (Shopify → hoja "Stock (Shopify)")
```

## Sincronización con proveedor (Star Company)

Pipeline **read-only del sitio público** del proveedor (PrestaShop): saca snapshots datados del
catálogo de perfumería y los compara entre corridas. No toca Shopify ni necesita `.env`.
Alimenta después el Excel B2B (Sprint 2) y el catálogo mayorista en Shopify (Sprint 3).

```bash
npm run proveedor:pull            # corrida completa (~90 requests, ~4 min)
node pull-proveedor.mjs --dry-run # 1 request: página 1 + 5 registros derivados, no escribe
node pull-proveedor.mjs --cat 121 # debug: una categoría → proveedor/debug-cat121.csv (gitignoreado)
npm run proveedor:diff            # último snapshot vs anterior → reporte Markdown
node diff-proveedor.mjs --from 2026-07-10 --to 2026-07-17   # (sufijo -N para corridas del mismo día)
```

**Alcance del crawl:** categoría 121 (PERFUMES) completa + categoría 100 (COSMÉTICOS) filtrada a
las marcas que existen en `proveedor/marcas-categoria.csv` (intersección con la sidebar; hoy 8:
Ard al Zaafaran, Armaf, Carolina Herrera, Chanel, Lattafa, Maison Alhambra, Thierry Mugler,
Xerjoff). Verificado en la reconciliación inicial: el resto de las filas del CSV viejo que no
aparecen son churn real del sitio, no categorías sin cubrir.

**Contrato de archivos (`proveedor/`):**

- `snapshots/{fecha}.csv` — un snapshot por corrida (schema abajo), commiteado (git = historial).
- `snapshots/{fecha}-marcas.csv` — censo de la sidebar (cat, marca, id_manufacturer, conteo).
- `reportes/{fecha}-diff.md` — altas / bajas / Δ precio ±3% / stock crítico (≥15→<15, no-clon,
  Árabe/Diseñador; insumo para despublicar del B2B) / censo de marcas.
- `reportes/{fecha}-reconciliacion.md` — solo primera corrida: matching contra el CSV legacy.
- `legacy-catalogo-proveedor.csv` — copia byte a byte del CSV pre-pipeline (referencia).
- `marcas-categoria.csv` — seed marca→categoría (paso 3 de la cascada). **Editable a mano**: las
  marcas nuevas que el pull lista como REVISAR se agregan acá (también sirve para aliases de
  grafía, ej. `Hermes Paris`). Ojo: `node seed-marcas-categoria.mjs` lo REGENERA desde el
  catálogo y pisa los agregados manuales.
- `marcas-clones.txt` — marcas excluidas de B2C/B2B; sus filas llevan `Comentario=clon/genérico`
  (el flag además es sticky por `id_star` corrida a corrida, y cubre flags por-fila heredados
  del CSV viejo en marcas fuera de la lista, ej. Attracione).

**Master `catalogo-proveedor.csv`** = último snapshot **+ 1 corrida de gracia**: una fila ausente
se retiene con su `fecha_snapshot` vieja (hace de "última vista") y recién cae tras 2 corridas
consecutivas sin aparecer (sin stock no se lista → una ausencia puede ser temporal). Schema v2 =
las 6 columnas originales (mismo orden) + `id_star` (clave primaria, id numérico estable de la
URL de producto), `url_star`, `stock_star`, `imagen_url` (vacía si es el placeholder `img/p/`),
`fecha_snapshot`. UTF-8 con BOM, coma, CRLF.

**Clasificación (cascada, gana la primera):** nombre empieza con `TESTER` o slug `perfume-tester`
→ Tester · slug `perfumes-de-nicho` → Nicho · marca en `marcas-categoria.csv` → esa categoría ·
si no → `REVISAR` (el pull las lista al final; agregarlas al seed y re-correr).

**Contrato del sitio (verificado 10-jul-2026):**

- Server-rendered, módulo custom `starcategorypremium` (tiles `article.scp-card`). **No hay
  endpoint JSON**: el listado con `X-Requested-With: XMLHttpRequest` o `&from-xhr=1` devuelve el
  mismo HTML completo y `&ajax=1` devuelve vacío → se parsea HTML con cheerio.
- `robots.txt` prohíbe `?order=`/`&order=` → las URLs de paginación van **sin** `order=`
  (el orden por defecto ya es "position"). No hay sitemap público (403).
- Cortesía obligatoria: 1 req/s con jitter ±300ms, concurrencia 1, User-Agent identificable
  (`HaspertCatalogSync/1.0`), 3 reintentos con backoff, timeout 20s. Ante 403/429/challenge el
  script **aborta y reporta**; no escalar a headless sin decisión explícita.
- **El listado oculta los productos sin stock** (nunca aparece "0 In Stock"): un agotado se ve
  como "baja" temporal, no como stock 0 — por eso la gracia de 1 corrida en el master.
- Hay tiles **sin marca** (línea NEW NOTES): quedan con `Marca` vacía y categoría REVISAR/Nicho
  según slug; es un faltante del sitio, no del parseo.

**Validación dura antes de escribir** (si falla, aborta sin pisar nada): 0 filas sin `id_star` o
sin `Costo USD`, y total ≥ 1.850 en corrida completa.

> ⚠️ `Costo USD` es el **precio de vidriera minorista-PY** del storefront, no la lista mayorista
> (pedida a Star). Cuando llegue la lista oficial, esa será la fuente de **costo** y este pipeline
> queda como fuente de **stock + altas/novedades**. El `stock_star` es orientativo (umbrales
> disponible / <15 / sin stock), nunca cantidad prometible.

> Pendiente (a propósito): GitHub Actions para la corrida programada — recién cuando el flujo
> manual esté validado 2-3 corridas.

## Notas / límites

- **Inventario (mixto):** frasco/tester `tracked: true` + `DENY` (se agotan); decants `tracked: false`
  + `CONTINUE` (siempre disponibles). Las cantidades las maneja `set-stock` / el admin, no el
  repricing (verificado: re-correr `npm run load` NO pisa el stock). Frasco/tester sin cantidad
  cargada aparecen **agotados**.
- **⚠️ `productSet` BORRA los metafields `custom` que no le mandás.** Al cargar un producto, el
  loader es la **fuente de verdad** de sus metafields custom: todo lo que no esté en `buildMetafields`
  se pierde. Por eso el loader escribe también `anio_lanzamiento` y `tamano_frasco_ml`. Si agregás un
  metafield custom nuevo que quieras conservar, agregalo a `buildMetafields` (si no, el próximo
  `npm run load` lo borra). Verificado en 2026-04. Otros namespaces (ej. `reviews`) no se tocan.
- **Reestructurar un producto resetea su stock.** Si `productSet` cambia las variantes de un producto
  existente (opción/estructura distinta), el inventario de las variantes nuevas arranca en 0 → corré
  `set-stock` (con `stock_frasco`/`stock_tester` cargados) después de la carga. Repreciar un producto
  que YA está en el modelo (mismas variantes) **no** toca el stock.
- **Reviews:** `reviews.rating` lo provee la app de reviews; los productos nuevos arrancan sin
  estrellas hasta tener reseñas. El loader no toca ese namespace.
- **Tope ~50 productos** en los loops Liquid de cross-sell/related/kit: apuntá esas secciones a
  colecciones acotadas, no a "todos los perfumes".
- **`perfumes.xlsx` es binario:** se versiona en git pero no se puede diff-ear en un PR. Si querés
  ver cambios línea a línea, exportá la hoja a CSV aparte como respaldo legible.
- El `.env` tiene secretos: **no lo commitees**.