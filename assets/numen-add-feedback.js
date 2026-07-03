/*
 * numen-add-feedback.js — Feedback "Agregado ✓" en el botón de la card (PLP/related/featured).
 * -----------------------------------------------------------------------------
 * Al enviar el form de una card (add-to-cart), muta el botón .card-perfume__add a
 * su estado is-added (el CSS hace el swap "Agregar" → "Agregado ✓") y lo revierte
 * a los ~1.6s. NO toca plp-card.js ni product-form.js: solo agrega/quita una clase.
 * Se dispara en captura para no depender del handler AJAX de Dawn.
 */
document.addEventListener(
  'submit',
  function (e) {
    var f = e.target.closest && e.target.closest('form[data-type="add-to-cart-form"]');
    if (!f) return;
    var b = f.querySelector('.card-perfume__add');
    if (!b) return;
    b.classList.add('is-added');
    setTimeout(function () {
      b.classList.remove('is-added');
    }, 1600);
  },
  true
);
