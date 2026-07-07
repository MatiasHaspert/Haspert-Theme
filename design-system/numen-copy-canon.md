# NUMEN — Canon de copy y marca

Fuente única de verdad para el copy de la tienda. Antes de editar cualquier texto (theme editor, admin, políticas, locale), chequeá contra este doc. Fue creado para frenar el problema recurrente de toda la auditoría: una decisión tomada en un lado que no se propaga a los demás ("curada" que revivía, "video del frasco", "30 días", "10 vs 15 días", "verano en invierno").

- **Versión:** v1 — 7 de julio de 2026
- **Alcance:** copy, voz, términos, políticas y normativa. No es un doc de diseño visual ni de arquitectura de theme.
- **Leyenda:** ✅ cerrado y aplicable · ⏳ pendiente de definir (bloquea o condiciona copy)

---

## 1. Voz

✅ **Registro:** rioplatense, voseo **siempre** (podés, elegí, escribinos). Nada de español neutro ni de "tú".

✅ **Tono:** preciso / curado / calmo. Ultramar v2 es un sistema frío-elegante — el copy acompaña esa temperatura, **no** fuerza calidez. Curador honesto, no vendedor: NUMEN elige, no lista todo. Seguridad tranquila, sin gritar. Frases cortas; el lujo respira.

✅ **Eje de marca:** la objeción #1 del comprador es **autenticidad**. Donde sea natural, reforzar que son originales verificables (lote, video, garantía) — sin repetirlo robóticamente en cada superficie.

✅ **Prohibido:**
- "curada" / "curado" como descriptor de la perfumería (calco de *curated*, no se usa en el rubro AR). La idea de curaduría vive en el editorial y en "Los más elegidos", no en labels.
- Superlativos y hype: "el mejor", "increíble", "imperdible", cadenas de exclamación, urgencia falsa ("¡últimas horas!").
- "sin interés" fuera de las 6 cuotas (ver §5).
- Nombrar marcas de terceros como equivalencia ("huele como X") — ⏳ política "inspirado en" sin definir (ver §9 y Pendientes).
- Emojis, salvo casos muy puntuales.
- Imperativos de "tú" en cualquier texto ("Revisa", "Usa", "Elige") → voseo ("Revisá", "Usá", "Elegí"). Ojo: no confundir con 3ª persona presente ("se abre", "se actualiza"), que se deja.

---

## 2. Sistema visual (referencia)

✅ **Paleta — Ultramar v2:** fondo `#F7F8F9` · ink `#14161A` · acento `#1E34A8`. Fuente de verdad en `base.css`. (⏳ co-firma de Ciro pendiente.)

✅ **Tipografía:** Bebas Neue (display, precios, botones, números grandes) + Montserrat (UI, cuerpo, itálica de acento).

---

## 3. Términos canónicos (decí esto / no esto)

| Concepto | ✅ Decir | ❌ No decir |
|---|---|---|
| El video de prueba | **video del lote** | video del frasco |
| Eyebrow del hero | **Perfumería importada** | Perfumería curada · Perfumería (solo) |
| Tagline del footer | **Perfumería importada. Originales que verificás frasco por frasco.** | Perfumería curada… |
| CTA WhatsApp de autenticidad | **Pedir video del lote por WhatsApp** | — |
| Ítem de menú de autenticidad | **Autenticidad** + badge **Cómo lo verificamos** | — |
| Recurso retórico | "frasco por frasco" (OK como frase) | — |

✅ **H1 del hero (cerrado, no tocar):** *Originales que podés verificar frasco por frasco.*
✅ **Subtítulo del hero:** *Importados árabes, de diseñador y nicho. Lote visible y video del lote antes de comprar.*
✅ **Microcopy del hero:** *Originalidad garantizada · Video del lote por WhatsApp.*

---

## 4. Garantías, cambios y devoluciones (CRÍTICO)

Fue el error más repetido de toda la auditoría. Tres promesas distintas, no las mezcles:

| Promesa | ✅ Regla | Dónde vive |
|---|---|---|
| **Garantía de originalidad** | 100% **sin vencimiento**. Si no es original, devolución del 100% + envío, sin límite de tiempo. | PDP, FAQ, tabla original-vs-réplica, políticas |
| **Arrepentimiento (legal)** | **10 días corridos**, art. 34 Ley 24.240 **+ art. 1.110 CCyC** | Botón de arrepentimiento, FAQ, políticas |
| **Cambio voluntario** | **15 días** sellado (distinto del arrepentimiento) | Chip del carrito, FAQ, políticas |
| **Decants abiertos** | **excluidos** del arrepentimiento (art. 1.116 CCyC), respaldado por Disp. 954/2025 | PDP, carrito, políticas |

❌ **NO existe** "cambio gratis 30 días" ni ningún cap de "30 días" sobre la garantía de originalidad.

⚠️ **Correcciones a aplicar (el "30 días" apareció mal en 3 lugares):**
- `qa_original` (PDP + FAQ + página autenticidad): sacar "dentro de los 30 días" → "sin límite de tiempo".
- Tabla `original-vs-replica`, fila Garantía: sacar "(hasta 30 días)".
- Chip del carrito `trust_returns`: "Cambios 10 días" → **"Cambios 15 días"** (es el cambio voluntario; los 10 son el arrepentimiento y viven en el copy legal).
- Revisar que el "30 días" no esté también en la política escrita de Cambios (admin) — ahí sería un compromiso contractual.

---

## 5. Pagos y precios

✅ **Cuotas:** hasta **6 cuotas sin interés (CFTA 0%)** — "sin interés" solo acá. Hasta 12 con interés.

✅ **Transferencia — 20%:** código **`TRANSFERENCIA20`**, se carga en el checkout, **no se autoaplica**. El copy nunca puede sugerir que el precio ya lo trae.
- Anuncio (barra): **"20% de descuento por transferencia"** (tono-dato).
- PDP/carrito: dejar claro el "cómo" ("Elegí Transferencia y aplicá el código… al pagar").
- ⚠️ Prerequisito: los precios se cargan **netos del 20%** (que el post-transferencia cubra costo + margen) antes de que el banner permanente esté live. Si no, los árabes finos se venden en pérdida.

---

## 6. Envíos y entrega

✅ **Envío gratis desde $200.000** (sobre el subtotal de productos). Sale de **un setting global** — misma fuente para barra, PDP, carrito y página Envíos. Se setea una vez.

✅ **Rosario — entrega en el día:** **coordinada por WhatsApp**, sin corte de horario para el cliente.
- Copy: *"Rosario: entregamos en el día. Coordinamos por WhatsApp el horario que te quede cómodo (días hábiles, según disponibilidad)."*
- Mecanismo = **Uber**. ❌ **No se nombra Uber** en ningún copy al cliente (es el cómo, no lo que se vende; y ata a un tercero). Uber además requiere que haya alguien para recibir → la coordinación por WhatsApp es requisito, no solo cautela.

✅ **Despacho nacional — el corte de 16 hs SÍ queda:** es sobre cuándo el paquete sale para Correo, no sobre la entrega. Sacarlo sería prometer un imposible.
- Copy: *"Tarjeta o Mercado Pago: despachamos el mismo día hábil si la compra entra antes de las 16 hs; si no, el siguiente día hábil."*
- Transferencia: *"el plazo corre desde la acreditación del pago en nuestra cuenta (no desde el envío del comprobante)."*

✅ **Retiro en persona — sin costo:** gancho = **autenticidad**, no ahorro. *"Revisá el frasco y el lote en persona antes de llevártelo."* Elegís "Retiro en persona" en el checkout.
- Es acelerador de confianza + margen cero, **no** un canal de volumen. No posicionarlo como reemplazo del envío.
- ✅ **Retiro solo en Rosario.** ⏳ Dirección a definir.

✅ **Embalaje:** reforzado para vidrio. Daño en transporte → fotos sin descartar el embalaje, contacto dentro de 48 hs, se resuelve con reposición o devolución.

⏳ **Plazos de Correo por tramo:** sin confirmar. Hoy hay incoherencia (PDP dice 3–6 días, FAQ dice 2–4 / 4–7). Usar **dos tramos** (cercanías vs resto) con techo más alto (destinos lejanos se van a 7+ días) y **una sola fuente** replicada en PDP + FAQ + Envíos.

---

## 7. Cumplimiento normativo (Argentina) — verificado

- ✅ **Botón de arrepentimiento:** obligatorio, visible en el primer acceso, sin exigir registro/login. Norma vigente: **Disposición 954/2025** (derogó las Resoluciones 316/2018 y 424/2020). Citar art. 34 Ley 24.240 + art. 1.110 CCyC. (Feb 2026: se permite verificación de identidad razonable — el "no necesitás registrarte" sigue OK.)
- ✅ **Data Fiscal (AFIP):** obligatorio en el footer, va como está.
- ⏳ **Atención al consumidor (954/2025):** hay que publicar canal de contacto **+ horario** (mínimo 8 hs, días hábiles) + área responsable. Hoy falta el horario declarado. Agregar línea "Atención: [días/horas]".
- ⏳ **"Inspirado en":** define política A/B (ver §9) antes del load — hoy el theme nombra marcas ajenas con disclaimer, contra la regla de voz.

---

## 8. Barra de anuncios (cerrada)

✅ Cuatro ítems, en este orden:
1. **Originalidad garantizada**
2. **20% de descuento por transferencia** (ícono neutro, no el de tarjeta; linkea a la página que explica el código)
3. **Hasta 6 cuotas sin interés**
4. **Envío gratis desde $200.000**

---

## 9. Colecciones y catálogo (notas)

- ✅ **Decants = 4 variantes por producto** (frasco / tester / decant 5 / decant 10). Los decants siguen como variantes, no productos aparte.
- ✅ **165 SKUs clones excluidos** (Iscents, Mini Brand Collection, L'Affair, D'Hermosa, Smart Collection, Paris Corner, etc.) — fuera de todos los pipelines.
- ✅ **Estacionalidad:** no destacar "Frescos para el verano" en invierno. Rotar la vidriera (barra de ángulos + índice) por estación; en invierno subir cálidos / orientales / gourmands / "Para la noche".
- ✅ **`los-mas-elegidos` está vacía** → curar en admin antes de linkearla en nav o hero. Un gancho sobre una grilla vacía es peor que nada.
- ✅ **`alternativas-a-los-clasicos`** = la versión brand-safe del "inspirado en" a nivel colección (Opción A). Si se elige A, su gancho puede jugar con "el perfil que buscás, sin el precio del diseñador", sin nombrar marcas.
- **Índice `/collections`:** en la tarjeta de diseñador, "al mejor precio" → "a buen precio" (antihype).

---

## Pendientes de definir (bloquean o condicionan copy)

| # | Pendiente | Qué desbloquea |
|---|---|---|
| 1 | ⏳ **Decisión A/B "inspirado en"** (perfil sin marca vs. marca con disclaimer) | Catálogo árabe, disclaimers de PDP, colección `alternativas-a-los-clasicos` |
| 2 | ⏳ **Confirmar 15 días de cambio voluntario** firmes | Chip del carrito, FAQ, políticas |
| 3 | ⏳ **SLA real de Correo por tramo** | PDP + FAQ + Envíos (reconciliar 3 superficies) |
| 4 | ⏳ **Dirección del punto de retiro** en Rosario | Página Envíos, checkout, FAQ |
| 5 | ⏳ **Costo promedio del Uber en Rosario** + si el envío gratis cubre el same-day | Tarifa de envío local, decisión de margen |
| 6 | ⏳ **Co-firma de Ciro de la paleta Ultramar v2** | Cierre del sistema visual |

---

## Decisiones de negocio abiertas (fuera del copy, para no perderlas)

- **Breakeven del 20%** por transferencia vs. 6 cuotas (con fees vigentes de Mercado Pago) — define qué SKU aguanta el descuento permanente. Análisis pendiente.
- **Lista mayorista de Star Company** — gatea el modelo de margen B2C y la viabilidad B2B.
- **Modelo de márgenes** (rebuild de 6 solapas) — requiere: cotización USD real, packaging, flete, % de pedidos sobre el umbral, tasa de devolución, unidades por pedido, mix de medios de pago, tratamiento de IIBB.
- **Techo de monotributo 2026** (~AR$613.492 por unidad) excluye a la mayoría de los SKU de nicho (costo > ~USD 160) — choca con usar nicho como motor de margen bajo monotributo.

---

*Este doc es vivo. Cada decisión nueva que afecte copy, términos o políticas se agrega acá primero, y recién después se propaga a las superficies.*
