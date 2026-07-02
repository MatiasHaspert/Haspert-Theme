/*
 * numen-facets-accordion.js — Convierte el drawer de filtros de Sense en acordeón.
 * -----------------------------------------------------------------------------
 * Sense/Dawn maneja los filtros mobile como un DRILL-DOWN con focus-trap
 * (menu-drawer.js: al tocar un facet, mete el foco en su submenú y desliza).
 * Para el acordeón del mockup necesitamos:
 *   1) que tocar un facet solo haga el toggle NATIVO del <details> (multi-open),
 *      sin el drill-down/focus-trap;
 *   2) cerrar la hoja tocando el scrim.
 *
 * Estrategia SIN tocar facets.js ni global.js (menu-drawer sigue manejando la
 * apertura/cierre de la hoja y facets.js el re-render/contador):
 *   - Un listener en CAPTURA a nivel document intercepta el click en los
 *     <summary> de facet dentro del drawer y corta la propagación
 *     (stopImmediatePropagation) ANTES de que corra el handler de menu-drawer.
 *     El toggle nativo del <details> NO se cancela (no hay preventDefault), así
 *     que el acordeón abre/cierra. Al ser a nivel document + captura, sobrevive
 *     a los re-render de facets.js (que re-bindea los summaries en bubble).
 *
 * El CSS (component-numen-facets.css) hace el resto: submenú inline + hoja
 * inferior + chips.
 */
(function () {
  'use strict';

  // 1) Neutralizar el drill-down SOLO en los summaries de facet del drawer.
  document.addEventListener(
    'click',
    function (event) {
      var summary = event.target.closest('summary.mobile-facets__summary');
      if (summary && summary.closest('.facets-container-drawer')) {
        event.stopImmediatePropagation();
      }
    },
    true // captura: corre antes que el listener (en bubble) de menu-drawer
  );

  // 2) Cerrar la hoja al tocar el scrim (fuera del panel), como el mockup.
  document.addEventListener('click', function (event) {
    var overlay = event.target.closest('.facets-container-drawer .mobile-facets');
    if (!overlay) return;
    if (event.target.closest('.mobile-facets__inner')) return; // click dentro del panel

    var wrapper = overlay.closest('.mobile-facets__wrapper');
    var trigger = wrapper && wrapper.querySelector('summary.mobile-facets__open-wrapper');
    if (trigger) trigger.click(); // menu-drawer cierra la hoja
  });

  // 3) Re-aplicar el pre-abierto de Casa/Familia/Precio cada vez que se abre la
  //    hoja: menu-drawer.closeMenuDrawer() borra los `open` de TODOS los <details>
  //    al cerrar, así que el server-side solo sirve para el primer paint.
  //    Los facets por defecto llevan [data-numen-open] (facets.liquid) y no se
  //    borra al cerrar, así que lo usamos para restaurarlos.
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('.facets-container-drawer summary.mobile-facets__open-wrapper');
    if (!trigger) return;
    var disclosure = trigger.closest('details');
    if (!disclosure) return;

    // Tras el toggle nativo: si la hoja quedó ABIERTA, reabrir los facets default.
    setTimeout(function () {
      if (!disclosure.hasAttribute('open')) return; // se estaba cerrando
      var defaults = disclosure.querySelectorAll('.mobile-facets__details[data-numen-open]');
      for (var i = 0; i < defaults.length; i++) defaults[i].setAttribute('open', '');
    }, 0);
  });
})();
