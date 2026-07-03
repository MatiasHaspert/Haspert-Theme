/*
 * numen-drawer-accordion.js — Convierte el drawer del menú (Sense/Dawn) de
 * DRILL-DOWN a ACORDEÓN, sin tocar global.js ni el custom element <header-drawer>.
 * -----------------------------------------------------------------------------
 * Sense/Dawn maneja los submenús del drawer como drill-down con focus-trap:
 * global.js (MenuDrawer.onSummaryClick) al tocar el <summary> de un grupo desliza
 * un panel absoluto y atrapa el foco ahí. Para el diseño NUMEN queremos un
 * acordeón multi-open inline.
 *
 * MISMA técnica que numen-facets-accordion.js (la PLP), scopeada a OTRO contenedor
 * (.menu-drawer__navigation — NO tocar los facets):
 *   1) Listener en CAPTURA a nivel document intercepta el click en los <summary>
 *      DENTRO del nav del drawer y corta la propagación (stopImmediatePropagation)
 *      ANTES de que corra onSummaryClick (que está en bubble). NO se hace
 *      preventDefault → el toggle NATIVO del <details> abre/cierra el grupo. Al ser
 *      document + captura, sobrevive a cualquier re-bindeo de global.js.
 *      IMPORTANTE: sólo los summaries del NAV. El <summary> de la hamburguesa
 *      (.header__icon--menu) queda intacto porque está FUERA del nav, así que
 *      openMenuDrawer/closeMenuDrawer (abrir/cerrar la hoja) siguen funcionando.
 *   2) aria-expanded se sincroniza con el estado open vía el evento 'toggle'
 *      (que NO burbujea → se escucha en fase de captura a nivel document).
 *   3) closeMenuDrawer() de Dawn borra el atributo open de TODOS los <details> al
 *      cerrar la hoja, así que el open server-side sólo sirve para el primer paint.
 *      Reabrimos el grupo por defecto [data-numen-open] cada vez que la hoja se
 *      abre (mismo patrón que numen-facets-accordion §3).
 *
 * Guardrail ante updates del theme base: revisar que sigan existiendo
 * .menu-drawer__navigation (scope del acordeón) y summary.header__icon--menu
 * (hamburguesa). El scrim (.mdrawer__scrim) cierra la hoja vía el
 * onCloseButtonClick nativo de Dawn (es un <button>), no necesita JS acá.
 */
(function () {
  'use strict';

  // 1) Neutralizar el drill-down SOLO en los summaries del nav del drawer.
  document.addEventListener(
    'click',
    function (event) {
      var summary = event.target.closest('summary');
      if (summary && summary.closest('.menu-drawer__navigation')) {
        event.stopImmediatePropagation();
      }
    },
    true // captura: corre antes que onSummaryClick (bubble) de menu-drawer
  );

  // 2) Sincronizar aria-expanded con el toggle nativo ('toggle' no burbujea → captura).
  document.addEventListener(
    'toggle',
    function (event) {
      var details = event.target;
      if (!details.classList || !details.classList.contains('mgroup')) return;
      var summary = details.querySelector('summary');
      if (summary) summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
    },
    true
  );

  // 3) Reabrir el grupo por defecto cada vez que se abre la hoja.
  document.addEventListener('click', function (event) {
    var burger = event.target.closest('summary.header__icon--menu');
    if (!burger) return;
    var toggle = burger.parentNode; // <details> principal (mainDetailsToggle)
    if (!toggle || !toggle.querySelector) return;
    setTimeout(function () {
      if (!toggle.hasAttribute('open')) return; // se estaba cerrando
      var def = toggle.querySelector('.mgroup[data-numen-open]');
      if (def) def.setAttribute('open', '');
    }, 0);
  });
})();
