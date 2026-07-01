/*
  numen-cart-add.js — "+ Sumar" del cross-sell del carrito (AJAX).

  Agrega la variante decant sin salir del carrito y re-renderiza las MISMAS regiones que usa
  Dawn, para que la barra, los totales, el beneficio/cuotas, la nota legal y el propio cross-sell
  (que excluye lo ya agregado) se actualicen en vivo:
    - Drawer: replaceWith de ['cart-drawer-items', '.cart-drawer__footer'] (patrón de cart.js
      onCartUpdate) + el contador del header, que vive fuera de esas dos regiones.
    - /cart:  innerHTML de '#main-cart-items .js-contents' y '#main-cart-footer .js-contents'.
  Pide las secciones ya renderizadas en la misma llamada de /cart/add (param `sections`, patrón de
  product-form.js). Sin librerías: window.routes + DOMParser + FormData.
*/
(function () {
  'use strict';

  var routes = window.routes || {};
  if (!routes.cart_add_url || !routes.cart_url) return;

  function parseHTML(text) {
    return new DOMParser().parseFromString(text, 'text/html');
  }

  function sectionInner(text, selector) {
    var el = parseHTML(text).querySelector(selector);
    return el ? el.innerHTML : '';
  }

  function showError(onCartPage, msg) {
    var el = document.getElementById(onCartPage ? 'cart-errors' : 'CartDrawer-CartErrors');
    if (el) el.textContent = msg || '';
  }

  function renderSections(sections, onCartPage) {
    if (!sections) return;

    if (onCartPage) {
      var items = document.querySelector('#main-cart-items .js-contents');
      if (items && sections['main-cart-items']) {
        items.innerHTML = sectionInner(sections['main-cart-items'], '.js-contents');
      }
      var footer = document.querySelector('#main-cart-footer .js-contents');
      if (footer && sections['main-cart-footer']) {
        footer.innerHTML = sectionInner(sections['main-cart-footer'], '.js-contents');
      }
    } else if (sections['cart-drawer']) {
      var doc = parseHTML(sections['cart-drawer']);
      ['cart-drawer-items', '.cart-drawer__footer'].forEach(function (sel) {
        var target = document.querySelector(sel);
        var source = doc.querySelector(sel);
        if (target && source) target.replaceWith(source);
      });
      // El contador del header del drawer vive fuera de las dos regiones re-renderizadas.
      var newCount = doc.querySelector('.nc-head__count');
      var curCount = document.querySelector('.nc-head__count');
      if (newCount && curCount) curCount.textContent = newCount.textContent;
    }

    // Burbuja de carrito del header (ambas superficies).
    var bubble = document.getElementById('cart-icon-bubble');
    if (bubble && sections['cart-icon-bubble']) {
      bubble.innerHTML = sectionInner(sections['cart-icon-bubble'], '.shopify-section');
    }
  }

  function addVariant(btn) {
    if (btn.disabled || btn.classList.contains('is-loading')) return;

    var variantId = btn.dataset.cartAdd;
    if (!variantId) return;

    var onCartPage = !!btn.closest('#main-cart-items');
    var sections = onCartPage
      ? ['main-cart-items', 'main-cart-footer', 'cart-icon-bubble']
      : ['cart-drawer', 'cart-icon-bubble'];

    var label = btn.querySelector('.nc-xcard__add-label');
    var original = label ? label.textContent : '';
    if (label && btn.dataset.addingLabel) label.textContent = btn.dataset.addingLabel;
    btn.classList.add('is-loading');
    btn.disabled = true;
    showError(onCartPage, '');

    var body = new FormData();
    body.append('id', variantId);
    body.append('quantity', 1);
    body.append('sections', sections.join(','));
    body.append('sections_url', window.location.pathname);

    fetch(routes.cart_add_url, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/javascript' },
      body: body,
    })
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        if (data && data.status) {
          // Error de carrito (p. ej. sin stock suficiente).
          showError(onCartPage, data.description || data.message || '');
          if (label) label.textContent = original;
          btn.classList.remove('is-loading');
          btn.disabled = false;
          return;
        }
        // Éxito: check breve y después re-render (la card del candidato desaparece sola).
        btn.classList.remove('is-loading');
        btn.classList.add('is-added');
        setTimeout(function () {
          renderSections(data.sections, onCartPage);
        }, 150);
      })
      .catch(function (e) {
        console.error(e);
        showError(onCartPage, (window.cartStrings && window.cartStrings.error) || '');
        if (label) label.textContent = original;
        btn.classList.remove('is-loading');
        btn.disabled = false;
      });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cart-add]');
    if (!btn) return;
    e.preventDefault();
    addVariant(btn);
  });
})();
