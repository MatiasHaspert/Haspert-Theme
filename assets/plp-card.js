/*
 * plp-card.js — Precio dinámico por presentación en la card de perfume (PLP).
 * -----------------------------------------------------------------------------
 * Un ÚNICO listener delegado para toda la grilla (no uno por card). Al tocar un
 * badge de presentación:
 *   - marca el badge seleccionado (clase + aria-pressed);
 *   - actualiza el precio, el precio tachado, la línea "sin impuestos" y la
 *     pista "desde $X en decant" — todo con strings YA formateados por Liquid
 *     que viajan en data-* (cero formateo de moneda en JS, cero fetch);
 *   - apunta el <input> del product-form a la variante elegida, para que
 *     "Agregar" sume esa presentación al cart drawer.
 *
 * No depende de ningún otro asset. Deferido.
 */
(function () {
  'use strict';

  function selectPresentation(btn) {
    var card = btn.closest('.product-card-wrapper');
    if (!card) return;

    var buttons = card.querySelectorAll('.card-perfume__pres-btn');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i] === btn;
      buttons[i].classList.toggle('is-selected', on);
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    var data = btn.dataset;

    var now = card.querySelector('.card-perfume__price-now');
    if (now && data.priceDisplay) now.textContent = data.priceDisplay;

    var was = card.querySelector('.card-perfume__price-was');
    if (was) {
      if (data.compareDisplay) {
        was.textContent = data.compareDisplay;
        was.hidden = false;
      } else {
        was.textContent = '';
        was.hidden = true;
      }
    }

    var net = card.querySelector('.card-perfume__net-amount');
    if (net && data.netDisplay) net.textContent = data.netDisplay;

    // La pista "desde $X en decant" no aplica cuando ya se eligió un decant.
    var from = card.querySelector('.card-perfume__from');
    if (from) from.hidden = data.kind === 'decant';

    // "Agregar" suma la variante del badge elegido.
    var input = card.querySelector('.product-variant-id');
    if (input && data.variantId) input.value = data.variantId;

    // Tracking (Fase 5): dataLayer + Meta Pixel vía numen-tracking.js.
    if (data.variantId) {
      if (window.numenTrack) {
        window.numenTrack(
          'select_presentation',
          { kind: data.kind, variant_id: data.variantId, price: Number(data.price) },
          { event: 'SelectPresentation', standard: false, data: { kind: data.kind, variant_id: data.variantId } }
        );
      } else if (window.dataLayer) {
        window.dataLayer.push({
          event: 'select_presentation',
          kind: data.kind,
          variant_id: data.variantId,
          price: Number(data.price)
        });
      }
    }
  }

  document.addEventListener('click', function (event) {
    if (!event.target.closest) return;
    var btn = event.target.closest('.card-perfume__pres-btn');
    if (btn) selectPresentation(btn);
  });
})();
