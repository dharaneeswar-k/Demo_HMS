// Barcode labels — print stickers for packs that arrive without a usable barcode.
import { store } from '../data-service.js';
import { batchBalance, batchStatus, medName, isIssuable } from '../calculations.js';
import { barcodeSVG, batchLabelCode } from '../barcode.js';
import { combo, emptyState } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, refreshIcons } from '../utils.js';

const mmYY = (d) => (d ? `${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');

export function render(view, params, query) {
  const s = store.settings();
  const posted = store.all('grns').filter((g) => g.status === 'POSTED').sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  const state = { source: query.batch ? 'batch' : 'grn', grnId: query.grn || posted[0]?.id || '', batchId: query.batch || '', copies: 'fixed', fixed: 5, size: 'std' };
  view.innerHTML = `<p class="page-intro no-print">Print barcode stickers for medicine packs. Stick them on the pack — at the billing counter, scanning the sticker adds that exact batch to the bill.</p>
    <div class="label-layout">
      <section class="card no-print"><header class="card-head"><h2>Label settings</h2></header><div class="card-body"><div class="form-grid">
        <div class="field col-12"><label>Print labels for</label><div class="seg" data-src><button class="seg-btn" data-v="grn">A stock receipt</button><button class="seg-btn" data-v="batch">One batch</button></div></div>
        <div class="field col-12" data-grn-f><label>Stock receipt</label><select class="input" data-grn>${posted.map((g) => `<option value="${g.id}">${g.id} · ${esc(store.get('suppliers', g.supplierId)?.name || '')}</option>`).join('')}</select></div>
        <div class="field col-12" data-batch-f><label>Batch</label><div data-batch></div></div>
        <div class="field col-12"><label>Number of labels</label><select class="input" data-copies><option value="fixed">Fixed number per batch</option><option value="stock">One per unit in stock (max 60 per batch)</option></select></div>
        <div class="field col-6" data-fixed-f><label>Labels per batch</label><input class="input" type="number" min="1" max="200" data-fixed value="5"></div>
        <div class="field col-6"><label>Label size</label><select class="input" data-size><option value="std">50 × 25 mm</option><option value="small">38 × 25 mm</option></select></div>
      </div>
      <div class="label-count mt-2" data-count></div>
      <button class="btn btn-primary btn-block btn-lg mt-2" data-print>${icon('printer')}Print labels</button>
      <p class="muted small mt-1">Use a label printer or A4 sticker sheet. In the print dialog set margins to "None" for best alignment.</p></div></section>
      <section class="label-preview"><div class="label-sheet" data-sheet></div></section>
    </div>`;
  const $ = (q) => view.querySelector(q);
  const batchOpts = () => store.all('batches').filter((b) => batchBalance(b.id) > 0).map((b) => ({ value: b.id, label: `${medName(b.medicineId)} — ${b.batchNo}`, sub: `Exp ${mmYY(b.expiryDate)} · ${batchBalance(b.id)} in stock${isIssuable(b) ? '' : ' · ' + batchStatus(b).toLowerCase()}`, keywords: b.batchNo }));
  combo($('[data-batch]'), { options: batchOpts, value: state.batchId, placeholder: 'Search medicine or batch number…', onChange: (v) => { state.batchId = v; draw(); } });
  const batchesFor = () => {
    if (state.source === 'batch') return state.batchId ? [store.get('batches', state.batchId)].filter(Boolean) : [];
    const g = store.get('grns', state.grnId); if (!g) return [];
    return g.items.map((it) => store.get('batches', it.batchId)).filter(Boolean);
  };
  const copiesFor = (b) => (state.copies === 'fixed' ? Math.max(1, Math.min(200, Number(state.fixed) || 1)) : Math.min(60, Math.max(1, batchBalance(b.id))));
  const label = (b) => { const m = store.get('medicines', b.medicineId); const code = batchLabelCode(b);
    return `<div class="lbl lbl-${state.size}"><div class="lbl-top"><span>${esc(s.hospitalName)} Pharmacy</span><span>MRP ${fmtINR(b.mrp)}</span></div>
      <div class="lbl-name">${esc(m.brandName)} <small>${esc(m.strength)}</small></div>
      <div class="lbl-meta">B.No <b>${esc(b.batchNo)}</b> · Mfg ${mmYY(b.mfgDate)} · Exp <b>${mmYY(b.expiryDate)}</b></div>
      <div class="lbl-bar">${barcodeSVG(code, { height: 34 })}</div><div class="lbl-code">${code}</div></div>`; };
  function draw() {
    view.querySelectorAll('[data-src] .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.v === state.source));
    $('[data-grn-f]').classList.toggle('hidden', state.source !== 'grn');
    $('[data-batch-f]').classList.toggle('hidden', state.source !== 'batch');
    $('[data-fixed-f]').classList.toggle('hidden', state.copies !== 'fixed');
    const list = batchesFor();
    const total = list.reduce((t, b) => t + copiesFor(b), 0);
    $('[data-count]').innerHTML = list.length ? `<strong>${total}</strong> label(s) for <strong>${list.length}</strong> batch(es)` : '';
    $('[data-sheet]').innerHTML = list.length ? list.map((b) => Array.from({ length: copiesFor(b) }, () => label(b)).join('')).join('') : `<div class="no-print">${emptyState('barcode', 'Choose what to print', 'Pick a stock receipt or a batch to preview its labels.')}</div>`;
    $('[data-print]').disabled = !list.length;
    refreshIcons(view);
  }
  view.querySelectorAll('[data-src] .seg-btn').forEach((x) => { x.onclick = () => { state.source = x.dataset.v; draw(); }; });
  $('[data-grn]').value = state.grnId; $('[data-grn]').onchange = (e) => { state.grnId = e.target.value; draw(); };
  $('[data-copies]').onchange = (e) => { state.copies = e.target.value; draw(); };
  $('[data-fixed]').oninput = (e) => { state.fixed = e.target.value; draw(); };
  $('[data-size]').onchange = (e) => { state.size = e.target.value; draw(); };
  $('[data-print]').onclick = () => { document.body.classList.add('printing-labels'); toast('Sending labels to the printer…', 'info'); setTimeout(() => { window.print(); document.body.classList.remove('printing-labels'); }, 300); };
  draw();
}
