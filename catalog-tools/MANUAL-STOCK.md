# 📦 Manual de stock — Calmi Perfumes

Guía rápida para **gestionar el stock** desde el panel de Shopify. No hace falta saber nada de
programación: todo se hace clickeando en el admin.

> **En 30 segundos:**
> - Cada perfume tiene 4 presentaciones: **Frasco, Tester, Decant 10ml y Decant 5ml**.
> - El **Frasco** y el **Tester** llevan stock contado (se agotan).
> - Los **Decants** están **siempre disponibles** (se arman a pedido), no llevan número.
> - Cuando hay una venta, Shopify **descuenta solo**. Vos solo cargás stock cuando **entra mercadería**.
> - El stock se maneja **solo desde el admin de Shopify**. ⚠️ No toques el Excel ni nada técnico.

---

## 1. Cómo está armado cada perfume

Cada perfume tiene una opción **"Tamaño"** con 4 variantes:

| Presentación | ¿Lleva stock? | Qué pasa cuando se agota |
|---|---|---|
| **Frasco** (el envase completo) | ✅ Sí, número contado | Aparece **"Agotado"** y no se puede comprar |
| **Tester** | ✅ Sí, número contado | Aparece **"Agotado"** y no se puede comprar |
| **Decant 10ml** | ❌ No | **Siempre disponible** (se arma a pedido) |
| **Decant 5ml** | ❌ No | **Siempre disponible** (se arma a pedido) |

👉 Es **normal** que en el admin los decants digan *"No se hace seguimiento del inventario"*. Está bien
así: se preparan a pedido desde un frasco, por eso nunca figuran "agotados".

> ⚠️ **Ojo importante:** para armar decants necesitás un **frasco físico**. Aunque el sistema muestre
> el decant siempre disponible, si te quedaste sin frascos para fraccionar, no vas a poder prepararlo.
> Mantené siempre al menos un frasco de cada perfume del que vendas decants.

---

## 2. Ver el stock que tenés

**Camino corto (todos los perfumes juntos):**
1. Entrá al admin de Shopify.
2. En el menú de la izquierda: **Productos → Inventario**.
3. Vas a ver una lista con cada presentación y la columna **"Disponible"** (la cantidad que te queda).

**Camino por producto (uno solo):**
1. **Productos** → hacé clic en el perfume.
2. Bajá hasta la sección **Inventario**.
3. Ahí ves la cantidad de **Frasco** y **Tester**.

---

## 3. Cargar o actualizar stock (cuando entra mercadería)

Esto es lo que vas a hacer más seguido: **cuando llegan frascos nuevos** o cuando **contás stock y
querés corregir** un número.

1. Andá a **Productos → Inventario**.
2. Buscá el perfume (podés usar el buscador de arriba).
3. En la fila del **Frasco** (o **Tester**), hacé clic en el número de la columna **"Disponible"**.
4. Escribí la **cantidad real** que tenés ahora (el total, no lo que sumás).
5. Hacé clic en **Guardar**.

> 💡 Tip: el número que cargás es el **total disponible**. Si el sistema dice 3 y te llegaron 5 más,
> poné **8**, no 5.

Y listo. No hay que tocar nada más.

---

## 4. ¿Qué pasa cuando alguien compra?

- Shopify **descuenta el stock automáticamente**. No tenés que hacer nada.
- Cuando el **Frasco** o el **Tester** llega a **0**, se marca **"Agotado"** y deja de venderse solo.
- Los **Decants** nunca se agotan en el sistema (pero acordate de tener frascos para armarlos 👆).

---

## 5. Situaciones comunes

| Situación | Qué hacer |
|---|---|
| 📥 **Llegó mercadería** | Productos → Inventario → poné la cantidad total nueva en "Disponible" → Guardar. |
| 🔢 **Conté el stock y no coincide** | Igual que arriba: corregí el número al real. |
| 🚫 **No quiero vender más un perfume por un tiempo** | Poné su stock en **0** (queda "Agotado"). |
| ❌ **Quiero sacar un perfume del todo** | No lo borres: avisale al dev (puede pasarlo a "Borrador"). |
| 😵 **Aparece "Agotado" pero tengo stock** | Cargá la cantidad real en "Disponible". Se arregla al instante. |
| 🆕 **Quiero agregar un perfume nuevo** | Eso lo carga el dev (precios, fotos, datos). Vos después le ponés el stock. |

---

## 6. Reglas de oro ✅ / 🚫

✅ **SÍ:**
- Manejá el stock **siempre desde el admin de Shopify** (Productos → Inventario).
- Cargá la cantidad **real** cuando entra o contás mercadería.
- Mantené frascos físicos de lo que vendas en decant.

🚫 **NO:**
- ❌ No toques el archivo **Excel** (`perfumes.xlsx`) ni nada que diga "script" / "terminal". Eso es del
  dev y puede pisar el stock real si se usa mal.
- ❌ No inventes precios "antes/después" ni descuentos falsos (es ilegal en Argentina y quema confianza).
- ❌ No borres productos para "limpiar". Si algo no va más, avisá.

---

## 7. ¿Cuándo llamar al dev (Matías)?

Llamalo para:
- **Precios** (los maneja el sistema, no se tocan a mano).
- **Cargar perfumes nuevos** o cambiar fotos/descripciones.
- **Sacar un producto** de la tienda.
- Si algo se ve **raro** (precios mal, productos que no aparecen, stock que no cuadra).

Para el **stock del día a día (reponer, corregir), lo hacés vos** con este manual. 💪

---

## ❓ Preguntas frecuentes

**¿Por qué los decants no tienen número de stock?**
Porque se arman a pedido desde un frasco. Por eso están siempre disponibles. Solo cuidá de tener
frascos para poder prepararlos.

**Cargué stock y sigue diciendo "Agotado".**
Fijate que hayas tocado el número de la presentación correcta (**Frasco** o **Tester**) y que le hayas
dado **Guardar**. Refrescá la página.

**Vendí un perfume y el stock no bajó.**
El descuento es automático cuando la venta se completa. Si pasó tiempo y no bajó, avisá al dev.

**¿El stock está en un solo lugar?**
Sí, en el depósito/sucursal configurado en Shopify. Si en el futuro suman otro punto, lo coordinan
con el dev.
