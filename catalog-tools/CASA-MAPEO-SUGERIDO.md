# Mapeo sugerido: marca → `casa`  (BORRADOR — revisá y cargá vos)

> ⚠️ **Esto NO es la verdad.** Es una propuesta para acelerar la carga. **No está hardcodeado**
> en ningún script. La fuente de verdad es la columna `casa` del `perfumes.xlsx`, que completás vos.
> Revisá cada fila (varias casas son discutibles) y escribí el valor en el xlsx.

La columna `casa` acepta **solo** estos tres valores (lista cerrada, igual que en `setup-metafields.mjs`):

- `Árabe` — casas de Medio Oriente (Emiratos, Arabia, etc.). Es nuestro diferencial de proveedor.
- `Diseñador` — marcas de moda / mainstream (se consiguen en cualquier perfumería).
- `Nicho` — casas nicho / artesanales / de autor (alta gama, distribución selectiva).

Escribí el valor **exacto** (con tilde en "Árabe"). Un valor fuera de lista rebota la carga
(`INVALID_METAFIELD`) — y `audit-metafield-values.mjs` lo marcaría como "fuera-de-lista".

---

## Marcas que hoy están en la tienda

| Marca | `casa` sugerida | Nota |
|---|---|---|
| Lattafa | Árabe | Casa emiratí (Lattafa Perfumes, Dubái). |
| Armaf | Árabe | Casa árabe (Sterling Parfums). |
| Azzaro | Diseñador | Marca de moda francesa. |
| Dior | Diseñador | Marca de moda / lujo mainstream. |

## Referencia para cuando sumes marcas (revisá igual)

### Árabe
Lattafa · Armaf · Ard Al Zaafaran · Al Haramain · Rasasi · Swiss Arabian · Ajmal · Afnan ·
Maison Alhambra · Khadlaj · Nabeel · Paris Corner · Fragrance World · Al Rehab · Asdaaf ·
Zimaya · Orientica · French Avenue · Bharara

### Diseñador
Dior · Chanel · Rabanne (Paco Rabanne) · Carolina Herrera · Versace · Giorgio Armani ·
Yves Saint Laurent · Jean Paul Gaultier · Dolce & Gabbana · Calvin Klein · Hugo Boss ·
Lacoste · Montblanc · Azzaro · Givenchy · Valentino · Prada · Gucci · Burberry · Bvlgari

### Nicho
Creed · Xerjoff · Parfums de Marly · Maison Francis Kurkdjian (MFK) · Initio · Amouage ·
Le Labo · Byredo · Nishane · Mancera · Montale · Kilian · Roja · Frederic Malle

---

## Casas ambiguas (decisión tuya — te las marco a propósito)

- **Amouage** — nicho de lujo, pero **casa omaní** (Medio Oriente). Puede ir `Nicho` o `Árabe`
  según cómo lo quieras posicionar. Recomiendo `Nicho` (es su percepción de mercado), pero es
  tu llamada de marketing.
- **Orientica / French Avenue** — líneas premium de casas árabes (Al Haramain / Paris Corner).
  Sugerí `Árabe`, pero si las vendés como gama alta podrías querer `Nicho`.
- **Tom Ford** — técnicamente "designer-niche". Lo dejé afuera a propósito: decidí vos si en tu
  tienda va como `Diseñador` o `Nicho`.
- **Mancera / Montale** — misma dueña; se las considera nicho accesible. Si para tu público son
  "diseñador", cambialas.

> Regla práctica: `casa` es un **eje de posicionamiento**, no una verdad objetiva. Elegí la
> categoría con la que el cliente busca/compara, no la ficha técnica de la casa.
