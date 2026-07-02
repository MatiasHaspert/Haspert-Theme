/*
 * numen-tracking.js — Instrumentación de la PLP (esto es CAC, no cosmética).
 * -----------------------------------------------------------------------------
 * Manda eventos a dataLayer (GTM) Y a Meta Pixel (fbq), ambos guardados: si falta
 * GTM o el Pixel, no rompe nada. Eventos (brief §5):
 *   - select_collection_angle : clic en un chip de la barra de ángulos.
 *   - select_presentation     : selección de presentación en la card
 *                               (lo dispara plp-card.js llamando a window.numenTrack).
 *   - add_to_cart             : "Agregar" desde la card de la PLP.
 *
 * Objetivo: saber qué ÁNGULO y qué PRESENTACIÓN traccionan antes de escalar pauta.
 */
(function () {
  'use strict';

  // Helper único. dlData → dataLayer; fb = { event, standard, data } → fbq.
  function numenTrack(eventName, dlData, fb) {
    window.dataLayer = window.dataLayer || [];
    var payload = { event: eventName };
    if (dlData) {
      for (var k in dlData) {
        if (Object.prototype.hasOwnProperty.call(dlData, k)) payload[k] = dlData[k];
      }
    }
    window.dataLayer.push(payload);

    if (typeof window.fbq === 'function' && fb && fb.event) {
      window.fbq(fb.standard ? 'track' : 'trackCustom', fb.event, fb.data || {});
    }
  }
  window.numenTrack = numenTrack;

  function activeCurrency() {
    return (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || '';
  }

  // 1) Barra de ángulos: clic en un chip. El link navega → dataLayer.push es
  //    síncrono (llega antes de salir); fbq es best-effort (usa beacon).
  document.addEventListener('click', function (event) {
    if (!event.target.closest) return;
    var link = event.target.closest('.collnav__link');
    if (!link) return;

    var angle = link.dataset.angle || '';
    var collection = link.dataset.collection || '';
    numenTrack(
      'select_collection_angle',
      { angle: angle, collection: collection },
      { event: 'SelectCollectionAngle', standard: false, data: { angle: angle, collection: collection } }
    );
  });

  // 3) add_to_cart desde la card de la PLP. En el submit (captura) leo la
  //    presentación elegida ANTES de que Dawn haga el AJAX. Scopeado a las cards.
  document.addEventListener(
    'submit',
    function (event) {
      if (!event.target.closest) return;
      var form = event.target.closest('.product-card-wrapper form[data-type="add-to-cart-form"]');
      if (!form) return;

      var card = form.closest('.product-card-wrapper');
      var selected = card && card.querySelector('.card-perfume__pres-btn.is-selected');
      var idInput = card && card.querySelector('.product-variant-id');
      var variantId = idInput ? idInput.value : '';
      var kind = selected ? selected.dataset.kind : '';
      var priceCents = selected ? Number(selected.dataset.price) : null;
      var currency = activeCurrency();

      numenTrack(
        'add_to_cart',
        { variant_id: variantId, presentation: kind, price: priceCents, currency: currency },
        {
          event: 'AddToCart',
          standard: true,
          data: {
            content_ids: variantId ? [variantId] : [],
            content_type: 'product_variant',
            // price viene en centavos (ARS 2 decimales) → value en pesos.
            value: priceCents != null ? priceCents / 100 : undefined,
            currency: currency
          }
        }
      );
    },
    true
  );
})();
