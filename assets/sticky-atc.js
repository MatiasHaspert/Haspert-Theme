if (!customElements.get('sticky-atc')) {
  customElements.define(
    'sticky-atc',
    class StickyAtc extends HTMLElement {
      connectedCallback() {
        this.sectionId = this.dataset.section;
        this.button = this.querySelector('.sticky-atc__button');
        this.priceEl = this.querySelector('.sticky-atc__price');

        // Mostrar la barra recién cuando el botón de compra principal quedó arriba del viewport.
        const mainButton = document.getElementById('ProductSubmitButton-' + this.sectionId);
        if (mainButton && 'IntersectionObserver' in window) {
          this.observer = new IntersectionObserver(
            (entries) => {
              const entry = entries[0];
              const scrolledPast = entry.boundingClientRect.top < 0;
              this.classList.toggle('sticky-atc--visible', !entry.isIntersecting && scrolledPast);
            },
            { threshold: 0 }
          );
          this.observer.observe(mainButton);
        } else {
          this.classList.add('sticky-atc--visible');
        }

        // Sincronizar precio y disponibilidad al cambiar de variante.
        if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
          this.unsubscribe = subscribe(PUB_SUB_EVENTS.variantChange, (event) => {
            if (!event.data || event.data.sectionId !== this.sectionId) return;
            const variant = event.data.variant;
            const newPrice = event.data.html && event.data.html.getElementById('price-' + this.sectionId);
            if (newPrice && this.priceEl) this.priceEl.innerHTML = newPrice.innerHTML;
            if (this.button) this.button.disabled = !variant || variant.available === false;
          });
        }
      }

      disconnectedCallback() {
        if (this.observer) this.observer.disconnect();
        if (this.unsubscribe) this.unsubscribe();
      }
    }
  );
}
