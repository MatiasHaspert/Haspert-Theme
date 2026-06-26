if (!customElements.get('kit-decants')) {
  customElements.define(
    'kit-decants',
    class KitDecants extends HTMLElement {
      connectedCallback() {
        this.maxSize = parseInt(this.dataset.kitSize, 10) || 3;
        this.currency = this.dataset.currency || 'ARS';
        this.selected = new Map();
        this.buttons = Array.from(this.querySelectorAll('.kit__select'));
        this.countEl = this.querySelector('[data-kit-count]');
        this.totalEl = this.querySelector('[data-kit-total]');
        this.addBtn = this.querySelector('[data-kit-add]');

        this.buttons.forEach((btn) => btn.addEventListener('click', () => this.toggle(btn)));
        if (this.addBtn) this.addBtn.addEventListener('click', () => this.addToCart());
      }

      toggle(btn) {
        const id = btn.dataset.variantId;
        if (this.selected.has(id)) {
          this.selected.delete(id);
          btn.setAttribute('aria-pressed', 'false');
        } else {
          if (this.selected.size >= this.maxSize) return;
          this.selected.set(id, parseInt(btn.dataset.price, 10) || 0);
          btn.setAttribute('aria-pressed', 'true');
        }
        this.render();
      }

      render() {
        const count = this.selected.size;
        if (this.countEl) this.countEl.textContent = count + ' / ' + this.maxSize;

        let total = 0;
        this.selected.forEach((price) => (total += price));
        if (this.totalEl) this.totalEl.textContent = total > 0 ? this.formatMoney(total) : '';

        if (this.addBtn) this.addBtn.disabled = count === 0;

        const full = count >= this.maxSize;
        this.buttons.forEach((btn) => {
          if (!this.selected.has(btn.dataset.variantId)) {
            btn.classList.toggle('kit__select--disabled', full);
          }
        });
      }

      formatMoney(cents) {
        try {
          return new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency: this.currency,
            maximumFractionDigits: 0,
          }).format(cents / 100);
        } catch (e) {
          return '$' + (cents / 100).toLocaleString('es-AR');
        }
      }

      addToCart() {
        if (this.selected.size === 0) return;
        const items = Array.from(this.selected.keys()).map((id) => ({ id: Number(id), quantity: 1 }));
        const root = (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';

        this.addBtn.setAttribute('aria-busy', 'true');
        this.addBtn.disabled = true;

        fetch(root + 'cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ items }),
        })
          .then((response) => {
            if (!response.ok) throw new Error('cart/add failed');
            return response.json();
          })
          .then(() => {
            window.location.href = root + 'cart';
          })
          .catch((error) => {
            console.error(error);
            this.addBtn.removeAttribute('aria-busy');
            this.addBtn.disabled = false;
          });
      }
    }
  );
}
