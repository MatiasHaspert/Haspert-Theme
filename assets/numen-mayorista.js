/* Catálogo mayorista (/pages/mayorista) — comportamiento portado de
   design-system/mockup-mayorista-v1_1.html con los deltas de producción del brief:
   · render progresivo: 60 filas + IntersectionObserver en lotes de 60 (payload 700-900);
   · búsqueda sobre marca+nombre normalizados sin tildes (NFD);
   · select de marca dependiente de la categoría (solo marcas con ítems en la
     categoría activa; si la marca elegida queda afuera, vuelve a "Todas");
   · el precio YA viene calculado del build (a = ARS entero) y el stock crudo no existe
     acá: solo el tier s (2 = alta disponibilidad, 1 = disponible);
   · si el mensaje codificado supera ~1800 caracteres, el CTA primario pasa a
     "Copiar mensaje" y el link abre el chat vacío.
   Datos: #b2b-data (inyectado server-side SOLO para clientes con tag mayorista).
   Config: #b2b-cfg { wa, min, cliente, tienda, fecha }. Sin datos válidos muestra
   #myrError (fail-soft, sin errores de consola). Sin dependencias. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const leerJson = (id) => {
    const el = $(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  };

  const rowsEl = $('myrRows');
  if (!rowsEl) return; // la sección no está en modo catálogo

  const fallar = () => {
    const err = $('myrError');
    if (err) err.hidden = false;
    ['myrEmpty', 'myrSentinel', 'myrOrderbar'].forEach((id) => { const el = $(id); if (el) el.hidden = true; });
    document.querySelectorAll('.myr-toolbar-wrap, .myr-list-head').forEach((el) => { el.style.display = 'none'; });
  };

  const cfg = leerJson('b2b-cfg') || {};
  const data = leerJson('b2b-data');
  const meta = data && data.meta;
  const ITEMS = data && Array.isArray(data.chunks)
    ? data.chunks.filter(Array.isArray).flat().filter((d) => d && d.i && d.m && d.p && d.a > 0)
    : [];
  if (!meta || !ITEMS.length) return fallar();

  const MIN = Number(cfg.min) > 0 ? Number(cfg.min) : Number(meta.min) || 10;
  const WA = String(cfg.wa || '').replace(/\D/g, '');
  const CLIENTE = String(cfg.cliente || '').trim();
  const TIENDA = String(cfg.tienda || '').trim() || 'Numen';
  const FECHA_LISTA = String(cfg.fecha || meta.fecha || '');
  const WA_MAX = 1800; // límite práctico de wa.me?text= antes de que se corte
  const LOTE = 60;

  const fmt = (n) => '$' + Number(n).toLocaleString('es-AR');
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const mono = (m) => m.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('');

  const porId = new Map();
  for (const d of ITEMS) { d._q = norm(d.m + ' ' + d.p); porId.set(d.i, d); }

  // Fotos: path relativo a meta.img_base (hotlink al sitio del proveedor, lazy).
  // Para el thumb se usa la variante small_default de PrestaShop (~12KB vs ~150KB);
  // si no existe, el onerror reintenta con la original y recién después cae al monograma.
  const IMG_BASE = String(meta.img_base || '');
  const imgSrc = (d) => (d.g ? (/^https?:/.test(d.g) ? d.g : IMG_BASE + d.g) : '');
  const imgThumb = (src) => src.replace('-home_default/', '-small_default/');

  /* ============ Estado ============ */
  const cart = new Map(); // i -> qty
  let cat = '*';
  let brand = '*';
  let sort = 'brand';
  let q = '';
  let listaActual = [];
  let visibles = 0;

  /* ============ Lista con render progresivo ============ */
  const emptyEl = $('myrEmpty');
  const countEl = $('myrCount');
  const sentinel = $('myrSentinel');

  function filtrar() {
    const qn = norm(q);
    const list = ITEMS.filter((d) => (cat === '*' || d.c === cat)
      && (brand === '*' || d.m === brand)
      && (qn === '' || d._q.indexOf(qn) !== -1));
    const by = {
      brand: (a, b) => a.m.localeCompare(b.m) || a.p.localeCompare(b.p),
      priceAsc: (a, b) => a.a - b.a,
      priceDesc: (a, b) => b.a - a.a,
      stock: (a, b) => (b.s - a.s) || a.m.localeCompare(b.m) || a.p.localeCompare(b.p),
    };
    return list.sort(by[sort] || by.brand);
  }

  function filaHtml(d, i) {
    const qty = cart.get(d.i) || 0;
    const hi = d.s >= 2;
    const img = imgSrc(d);
    return `<div class="myr-row ${qty > 0 ? 'picked' : ''}" style="--i:${Math.min(i, 8)}" data-id="${d.i}">
      <div class="myr-thumb" aria-hidden="true">${esc(mono(d.m))}${img ? `<img class="myr-thumb__img" src="${esc(imgThumb(img))}" data-full="${esc(img)}" alt="" loading="lazy" decoding="async" width="56" height="56">` : ''}</div>
      <div class="myr-pinfo">
        <div class="myr-pbrand">${esc(d.m)}</div>
        <div class="myr-pname">${esc(d.p)}</div>
        <div class="myr-pmeta">${d.l ? d.l + ' ml<span class="myr-sep">·</span>' : ''}Cód. ${d.i}<span class="myr-sep">·</span>${d.c === 'A' ? 'Árabe' : 'Diseñador'}</div>
      </div>
      <div class="myr-avail ${hi ? 'hi' : 'ok'}"><span class="myr-led"></span>${hi ? 'Alta disponibilidad' : 'Disponible'}</div>
      <div class="myr-price"><span class="myr-price__ars">${fmt(d.a)}</span><span class="myr-price__unit">por unidad · transf.</span></div>
      <div class="myr-stepper">
        <button type="button" aria-label="Quitar una unidad" data-dec="${d.i}" ${qty === 0 ? 'disabled' : ''}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>
        </button>
        <input type="number" min="0" inputmode="numeric" value="${qty}" data-qty="${d.i}" aria-label="Cantidad de ${esc(d.m)} ${esc(d.p)}">
        <button type="button" aria-label="Agregar una unidad" data-inc="${d.i}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
    </div>`;
  }

  function renderLote() {
    if (visibles >= listaActual.length) return;
    const fin = Math.min(visibles + LOTE, listaActual.length);
    let html = '';
    for (let i = visibles; i < fin; i++) html += filaHtml(listaActual[i], i - visibles);
    rowsEl.insertAdjacentHTML('beforeend', html);
    visibles = fin;
  }

  function render() {
    listaActual = filtrar();
    if (countEl) countEl.textContent = listaActual.length + ' de ' + ITEMS.length + ' referencias';
    if (emptyEl) emptyEl.hidden = listaActual.length > 0;
    rowsEl.innerHTML = '';
    visibles = 0;
    renderLote();
  }

  if (sentinel && 'IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) renderLote();
    }, { rootMargin: '600px 0px' }).observe(sentinel);
  } else {
    // Sin IO: render completo de una (no dejamos filas inalcanzables).
    const renderLoteOriginal = renderLote;
    renderLote = () => { while (visibles < listaActual.length) renderLoteOriginal(); };
  }

  /* ============ Carrito ============ */
  function setQty(id, qty) {
    qty = Math.max(0, Math.min(999, qty | 0));
    if (qty === 0) cart.delete(id); else cart.set(id, qty);
    syncRow(id);
    updateBar();
    renderDrawer();
  }
  function syncRow(id) {
    const row = rowsEl.querySelector(`.myr-row[data-id="${id}"]`);
    if (!row) return;
    const qty = cart.get(id) || 0;
    row.classList.toggle('picked', qty > 0);
    row.querySelector('[data-qty]').value = qty;
    row.querySelector('[data-dec]').disabled = qty === 0;
  }
  const totals = () => {
    let units = 0;
    let total = 0;
    cart.forEach((qty, id) => {
      const d = porId.get(id);
      if (!d) return;
      units += qty;
      total += qty * d.a;
    });
    return { units, total, items: cart.size };
  };

  /* ============ Barra de pedido ============ */
  const orderbar = $('myrOrderbar');
  const ticksEl = $('myrTicks');
  if (ticksEl) ticksEl.innerHTML = Array.from({ length: MIN }, () => '<span class="myr-tick"></span>').join('');

  function updateBar() {
    const { units, total, items } = totals();
    orderbar.classList.toggle('show', units > 0);
    $('myrBarN').textContent = units;
    $('myrBarTotal').textContent = fmt(total);
    $('myrBadge').textContent = items;
    const min = $('myrBarMin');
    if (units >= MIN) { min.textContent = 'Mínimo alcanzado'; min.classList.add('met'); }
    else { min.textContent = `Mínimo ${MIN} surtidas`; min.classList.remove('met'); }
    if (ticksEl) ticksEl.querySelectorAll('.myr-tick').forEach((t, i) => t.classList.toggle('on', i < Math.min(units, MIN)));
  }

  /* ============ Drawer ============ */
  const drawer = $('myrDrawer');
  const scrim = $('myrScrim');
  const modal = $('myrModal');
  const sheet = $('myrSheet');
  let ultimoFoco = null;

  function renderDrawer() {
    const list = [...cart.entries()].map(([id, qty]) => {
      const d = porId.get(id);
      if (!d) return '';
      return `<div class="myr-ditem">
        <div class="myr-dname">${esc(d.m)} — ${esc(d.p)}<small>${fmt(d.a)} c/u · Cód. ${d.i}</small></div>
        <div class="myr-dctl">
          <div class="myr-stepper">
            <button type="button" aria-label="Quitar una unidad" data-dec="${d.i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button>
            <input type="number" min="0" inputmode="numeric" value="${qty}" data-qty="${d.i}" aria-label="Cantidad">
            <button type="button" aria-label="Agregar una unidad" data-inc="${d.i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
          </div>
          <span class="myr-dsub">${fmt(qty * d.a)}</span>
        </div>
        <button type="button" class="myr-dremove" data-remove="${d.i}">Quitar</button>
      </div>`;
    }).join('');
    $('myrDrawerList').innerHTML = list || '<p class="myr-dempty">Todavía no agregaste productos.</p>';
    const { units, total } = totals();
    $('myrDCount').textContent = units + (units === 1 ? ' unidad' : ' unidades');
    $('myrDTotal').textContent = fmt(total);
  }

  const abrir = (el, foco) => {
    ultimoFoco = document.activeElement;
    el.classList.add('show');
    scrim.classList.add('show');
    if (foco) foco.focus();
  };
  const closeAll = () => {
    [drawer, modal, sheet].forEach((el) => el && el.classList.remove('show'));
    scrim.classList.remove('show');
    if (ultimoFoco && document.contains(ultimoFoco)) { ultimoFoco.focus(); ultimoFoco = null; }
  };

  /* ============ Mensaje WhatsApp ============ */
  function buildMsg() {
    const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const lines = [...cart.entries()].map(([id, qty]) => {
      const d = porId.get(id);
      return `${qty} × ${d.m} ${d.p} — Cód. ${d.i}`;
    });
    const { units, total } = totals();
    let msg = `PEDIDO MAYORISTA · ${TIENDA}\nFecha: ${hoy}`;
    if (CLIENTE) msg += `\nCliente: ${CLIENTE}`;
    msg += `\n\n${lines.join('\n')}\n\nTotal: ${units} unidades · Estimado ${fmt(total)} (transferencia)\n`;
    if (units < MIN) msg += `\nNota: el pedido tiene menos de ${MIN} unidades, ¿lo revisamos juntos?\n`;
    if (FECHA_LISTA) msg += `\nLista del ${FECHA_LISTA}, sujeta a confirmación de stock.`;
    msg += ` Quedo a la espera de los datos para transferir. ¡Gracias!`;
    return msg;
  }

  function openMsgModal() {
    if (cart.size === 0) return;
    const msg = buildMsg();
    $('myrMsgPreview').textContent = msg;
    const enc = encodeURIComponent(msg);
    const metaEl = $('myrMsgMeta');
    const wa = $('myrWaLink');
    const copyBtn = $('myrCopyMsg');
    const esLargo = enc.length > WA_MAX;

    if (!WA) {
      // Sin número configurado (placeholder X): solo copiar.
      wa.hidden = true;
      copyBtn.classList.add('myr-btn--primary');
      copyBtn.classList.remove('myr-btn--ghost');
      metaEl.textContent = 'Copiá el mensaje y envianoslo por WhatsApp.';
      metaEl.classList.remove('warn');
    } else if (esLargo) {
      // CTA primario pasa a "Copiar mensaje"; el link abre el chat vacío.
      metaEl.textContent = 'Pedido largo: copialo y pegalo en el chat para que no se corte.';
      metaEl.classList.add('warn');
      wa.hidden = false;
      wa.href = 'https://wa.me/' + WA;
      copyBtn.classList.add('myr-btn--primary');
      copyBtn.classList.remove('myr-btn--ghost');
      wa.classList.add('myr-btn--ghost');
      wa.classList.remove('myr-btn--primary');
    } else {
      metaEl.textContent = msg.length + ' caracteres · se abre con el mensaje ya escrito';
      metaEl.classList.remove('warn');
      wa.hidden = false;
      wa.href = 'https://wa.me/' + WA + '?text=' + enc;
      copyBtn.classList.add('myr-btn--ghost');
      copyBtn.classList.remove('myr-btn--primary');
      wa.classList.add('myr-btn--primary');
      wa.classList.remove('myr-btn--ghost');
    }
    drawer.classList.remove('show');
    abrir(modal, copyBtn);
  }

  /* ============ Toast / copiar ============ */
  const toast = $('myrToast');
  let toastT;
  function showToast(t) {
    toast.textContent = t;
    toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toast.classList.remove('show'), 2200);
  }
  async function copiar(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* sin clipboard: el preview queda seleccionable */ }
      ta.remove();
    }
    showToast(okMsg);
  }

  /* ============ Eventos ============ */
  // Foto que no carga: primero se reintenta con la imagen original (por si la
  // variante small no existe); si también falla, se saca el <img> y queda el
  // monograma. `error` no burbujea → listener en fase de captura.
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('myr-thumb__img')) return;
    if (t.dataset.full && t.src !== t.dataset.full) {
      t.src = t.dataset.full;
      t.removeAttribute('data-full');
    } else {
      t.remove();
    }
  }, true);

  document.addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    if (inc) return setQty(+inc.dataset.inc, (cart.get(+inc.dataset.inc) || 0) + 1);
    const dec = e.target.closest('[data-dec]');
    if (dec) return setQty(+dec.dataset.dec, (cart.get(+dec.dataset.dec) || 0) - 1);
    const rem = e.target.closest('[data-remove]');
    if (rem) return setQty(+rem.dataset.remove, 0);
  });
  document.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-qty]');
    if (inp) setQty(+inp.dataset.qty, +inp.value);
  });

  $('myrQ').addEventListener('input', (e) => { q = e.target.value.trim(); render(); });

  document.querySelectorAll('[data-seg] button').forEach((b) => b.addEventListener('click', () => {
    cat = b.dataset.cat;
    document.querySelectorAll('[data-seg] button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.cat === cat)));
    poblarMarcas();
    render();
  }));

  const brandSel = $('myrBrand');
  const brandM = $('myrBrandM');
  const catsPorMarca = new Map(); // marca -> Set de categorías donde tiene ítems
  for (const d of ITEMS) {
    if (!catsPorMarca.has(d.m)) catsPorMarca.set(d.m, new Set());
    catsPorMarca.get(d.m).add(d.c);
  }
  const MARCAS = [...catsPorMarca.keys()].sort((a, b) => a.localeCompare(b));

  // El select de marca depende de la categoría activa: solo marcas con ítems
  // en esa categoría. Si la marca elegida queda afuera, vuelve a "Todas".
  function poblarMarcas() {
    const lista = cat === '*' ? MARCAS : MARCAS.filter((m) => catsPorMarca.get(m).has(cat));
    if (brand !== '*' && lista.indexOf(brand) === -1) brand = '*';
    const html = '<option value="*">Todas las marcas</option>'
      + lista.map((m) => `<option>${esc(m)}</option>`).join('');
    [brandSel, brandM].forEach((sel) => { sel.innerHTML = html; sel.value = brand; });
  }
  poblarMarcas();
  brandSel.addEventListener('change', (e) => { brand = e.target.value; brandM.value = brand; render(); });
  brandM.addEventListener('change', (e) => { brand = e.target.value; brandSel.value = brand; render(); });
  $('myrSort').addEventListener('change', (e) => { sort = e.target.value; $('myrSortM').value = sort; render(); });
  $('myrSortM').addEventListener('change', (e) => { sort = e.target.value; $('myrSort').value = sort; render(); });

  $('myrOpenDrawer').addEventListener('click', () => { renderDrawer(); abrir(drawer, $('myrCloseDrawer')); });
  $('myrCloseDrawer').addEventListener('click', closeAll);
  scrim.addEventListener('click', closeAll);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAll(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  $('myrOpenModal').addEventListener('click', openMsgModal);
  $('myrOpenModal2').addEventListener('click', openMsgModal);
  $('myrCopyMsg').addEventListener('click', () => copiar(buildMsg(), 'Mensaje copiado'));
  $('myrCopyOrder').addEventListener('click', () => copiar(buildMsg(), 'Pedido copiado'));
  $('myrClearOrder').addEventListener('click', () => {
    cart.clear();
    render();
    updateBar();
    renderDrawer();
    closeAll();
  });
  $('myrOpenSheet').addEventListener('click', () => abrir(sheet, $('myrApplySheet')));
  $('myrApplySheet').addEventListener('click', closeAll);

  render();
  updateBar();
})();
