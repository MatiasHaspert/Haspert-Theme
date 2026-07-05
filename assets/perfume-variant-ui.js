/*
 * Parche variante-aware para la tira de confianza, que vive FUERA de las dos zonas
 * que product-info.js actualiza solo (#price-{section} y <variant-selects>).
 * Se cuelga del evento que ya publica product-info.js (PUB_SUB_EVENTS.variantChange)
 * y copia el HTML re-renderizado server-side (el `variant` del evento no trae metafields).
 */
(function () {
  if (typeof subscribe !== 'function' || typeof PUB_SUB_EVENTS === 'undefined') return;

  subscribe(PUB_SUB_EVENTS.variantChange, function (event) {
    var data = event && event.data;
    if (!data || !data.html) return;
    var sectionId = data.sectionId;

    var liveTrust = document.getElementById('PerfumeTrust-' + sectionId);
    var newTrust = data.html.getElementById('PerfumeTrust-' + sectionId);
    if (liveTrust && newTrust) {
      liveTrust.innerHTML = newTrust.innerHTML;
      liveTrust.dataset.tipo = newTrust.dataset.tipo || '';
    }

    // Badge de descuento de la galería (fuera de #price-{section}): copiamos el
    // re-render server-side y su estado hidden (aparece/desaparece según la oferta de la variante).
    var liveBadge = document.getElementById('GalleryDiscountBadge-' + sectionId);
    var newBadge = data.html.getElementById('GalleryDiscountBadge-' + sectionId);
    if (liveBadge && newBadge) {
      liveBadge.innerHTML = newBadge.innerHTML;
      liveBadge.hidden = newBadge.hidden;
    }
  });
})();
