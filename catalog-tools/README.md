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
| `genero` | Masculino · Femenino · Unisex |
| `concentracion` | Eau Fraîche · Eau de Cologne (EDC) · Eau de Toilette (EDT) · Eau de Parfum (EDP) · Eau de Parfum Intense · Parfum/Extrait · Attar / Aceite |
| `longevidad` | Baja (2–4h) · Moderada (4–6h) · Larga (6–8h) · Muy larga (8–12h) · Eterna (12h+) |
| `estela` | Íntima · Moderada · Notable · Enorme |

Para cambiar estas listas, editá `FIELDS` en `setup-metafields.mjs` y re-corré `npm run setup`.
`familia_olfativa` y `genero` están en uso en smart collections; el script re-envía las
`capabilities` para poder editarlos (sin eso rebota con `CAPABILITY_CANNOT_BE_DISABLED`).

## 3. Cargar el catálogo

Editá `perfumes.xlsx` en Excel (o Google Sheets / LibreOffice). Primera hoja, fila 1 = headers
(no la cambies de orden ni de nombre), una fila por perfume.

- Listas (familia, notas) → separá con `;` dentro de la celda: `Amaderado;Oriental`.
- `precio_frasco` y `frasco_ml` → números. Sin separadores de miles (`38000`, no `38.000`).
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

Las colecciones de esta tienda son **automáticas por metafield** (`PRODUCT_METAFIELD_DEFINITION`
sobre `familia_olfativa` / `genero`), **no por tag**.

```bash
npm run collections             # crea las colecciones por familia que falten (idempotente)
node create-collections.mjs --dry-run
```

`create-collections.mjs` crea una colección por cada familia **en uso** que todavía no tenga una
(no crea vacías). Las de género (Masculino/Femenino/Unisex) y por marca ya existen.

> El loader escribe solo `familia` como `tag` (utilidad de búsqueda); las colecciones leen los
> metafields directamente, no los tags.

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

## Notas / límites

- **Inventario (mixto):** frasco/tester `tracked: true` + `DENY` (se agotan); decants `tracked: false`
  + `CONTINUE` (siempre disponibles). Las cantidades las maneja `set-stock` / el admin, no el
  repricing (verificado: re-correr `npm run load` NO pisa el stock). Frasco/tester sin cantidad
  cargada aparecen **agotados**.
- **Reviews:** `reviews.rating` lo provee la app de reviews; los productos nuevos arrancan sin
  estrellas hasta tener reseñas. El loader no toca ese namespace.
- **Tope ~50 productos** en los loops Liquid de cross-sell/related/kit: apuntá esas secciones a
  colecciones acotadas, no a "todos los perfumes".
- **`perfumes.xlsx` es binario:** se versiona en git pero no se puede diff-ear en un PR. Si querés
  ver cambios línea a línea, exportá la hoja a CSV aparte como respaldo legible.
- El `.env` tiene secretos: **no lo commitees**.
