// Store → Pharmacy transfers (BRD module 05): Store −qty, Pharmacy +qty in one transaction, with full history.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { STORE_LOC, medicineStock, batchBalance, batchStatus, fefoBatches, medName, userName } from '../calculations.js';
import { transferStock } from '../services.js';
import { tabs, emptyState, combo, dataTable, openModal, confirmDialog, kpi, badge } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, fmtDate, fmtDateTime, refreshIcons } from '../utils.js';

const storeBatches = (mid) => fefoBatches(mid, STORE_LOC()).filter((b) => batchStatus(b) !== 'EXPIRED');
export function refillSuggestions() {
  return store.all('medicines').filter((m) => m.active).map((m) => { const s = medicineStock(m.id); return { m, s, qty: Math.min(s.store, Math.max(m.reorderLevel * 2, 20) - s.pharmacy) }; })
    .filter((x) => x.s.store > 0 && x.s.pharmacy <= x.m.reorderLevel && x.qty > 0).sort((a, b) => a.s.pharmacy / a.m.reorderLevel - b.s.pharmacy / b.m.reorderLevel);
}

export function render(view, params, query) {
  const user = currentUser();
  const canMove = can('store.transfer');
  let tab = query.focus ? 'history' : canMove ? 'new' : 'history';
  const sug = refillSuggestions();
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = store.all('transfers').filter((t) => t.at.slice(0, 7) === month);
  view.innerHTML = `<p class="page-intro">All supplier stock arrives in the <strong>Central Store</strong>. Transfer it to the <strong>Pharmacy</strong> shelf — the store quantity goes down and the pharmacy quantity goes up in one step. Only pharmacy stock can be billed.</p>
    <div class="kpis mb-2">
      ${kpi({ label: 'Medicines to refill', value: fmtNum(sug.length), iconName: 'arrow-right-left', tone: sug.length ? 'warning' : 'success', sub: 'Low on the pharmacy shelf, available in store' })}
      ${kpi({ label: 'Transfers this month', value: fmtNum(thisMonth.length), iconName: 'truck', tone: 'teal', sub: `${fmtNum(thisMonth.reduce((t, x) => t + x.totalQty, 0))} units` })}
      ${kpi({ label: 'Units in central store', value: fmtNum(store.all('medicines').reduce((t, m) => t + medicineStock(m.id).store, 0)), iconName: 'warehouse', tone: 'navy' })}
      ${kpi({ label: 'Units on pharmacy shelf', value: fmtNum(store.all('medicines').reduce((t, m) => t + medicineStock(m.id).pharmacy, 0)), iconName: 'store', tone: 'info' })}
    </div>
    <section class="card"><div data-tabs></div><div data-body></div></section>`;
  const body = view.querySelector('[data-body]');
  const draw = () => {
    tabs(view.querySelector('[data-tabs]'), [...(canMove ? [{ id: 'new', label: 'New transfer', icon: 'plus' }] : []), { id: 'history', label: 'Transfer history', icon: 'history', count: store.all('transfers').length }], tab, (t) => { tab = t; draw(); });
    tab === 'new' ? newTransfer(body, user, () => { tab = 'history'; draw(); }) : history(body, query.focus);
    refreshIcons(view);
  };
  draw();
}

function newTransfer(host, user, done) {
  const lines = []; // { batchId, qty }
  const pharmacyStaff = store.all('users').filter((u) => u.active && u.role === 'PHARMACY_STAFF');
  host.innerHTML = `<div class="card-body">
    <div class="tr-grid">
      <div>
        <h3 class="section-title">Refill suggestions</h3>
        <div data-sug></div>
      </div>
      <div>
        <div class="row-between mb-2"><h3 class="section-title" style="margin:0">Transfer note</h3><div data-add style="width:280px"></div></div>
        <div data-lines></div>
        <div class="form-grid mt-2"><div class="field col-6"><label>Received at pharmacy by</label><select class="input" data-rcv><option value="">Select pharmacy staff…</option>${pharmacyStaff.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>
          <div class="field col-6"><label>Remarks</label><input class="input" data-remarks placeholder="e.g. Weekly refill"></div></div>
        <div class="row-between mt-2"><div class="muted small" data-total></div><button class="btn btn-primary btn-lg" data-go>${icon('arrow-right-left')}Transfer to Pharmacy</button></div>
      </div>
    </div></div>`;
  const addMed = (mid, qty) => {
    let want = qty ?? 0;
    const bs = storeBatches(mid);
    if (!bs.length) { toast(`${medName(mid)} has no usable stock in the central store.`, 'error'); return; }
    if (!want) { lines.push({ batchId: bs[0].id, qty: '' }); return; }
    for (const b of bs) { if (want <= 0) break; if (lines.some((l) => l.batchId === b.id)) continue; const q = Math.min(want, batchBalance(b.id, STORE_LOC())); lines.push({ batchId: b.id, qty: q }); want -= q; }
  };
  const drawSug = () => {
    const sug = refillSuggestions().filter((x) => !lines.some((l) => store.get('batches', l.batchId).medicineId === x.m.id));
    host.querySelector('[data-sug]').innerHTML = sug.length ? `<div class="todo-list sug-list">${sug.map((x) => `<div class="todo"><span class="todo-txt"><strong>${esc(x.m.brandName)}</strong><small>Shelf ${fmtNum(x.s.pharmacy)} · Store ${fmtNum(x.s.store)} · reorder at ${x.m.reorderLevel}</small></span><button class="btn btn-secondary btn-sm" data-sug-add="${x.m.id}" data-q="${x.qty}">${icon('plus')}${fmtNum(x.qty)}</button></div>`).join('')}</div>
      <button class="btn btn-ghost btn-sm mt-1" data-sug-all>${icon('list-plus')}Add all suggestions</button>` : emptyState('check-circle-2', 'Pharmacy shelf is well stocked', 'No medicine is below its reorder level on the shelf.');
    host.querySelectorAll('[data-sug-add]').forEach((b) => { b.onclick = () => { addMed(b.dataset.sugAdd, Number(b.dataset.q)); drawAll(); }; });
    host.querySelector('[data-sug-all]')?.addEventListener('click', () => { sug.forEach((x) => addMed(x.m.id, x.qty)); drawAll(); });
  };
  const drawLines = () => {
    const el = host.querySelector('[data-lines]');
    el.innerHTML = lines.length ? `<div class="table-scroll"><table class="table dense"><thead><tr><th>Medicine</th><th>Batch (store, FEFO)</th><th class="ta-right">In store</th><th class="ta-right">On shelf</th><th style="width:120px">Transfer qty</th><th></th></tr></thead><tbody>
      ${lines.map((l, i) => { const b = store.get('batches', l.batchId); const s = medicineStock(b.medicineId);
        return `<tr data-i="${i}"><td class="cell-main">${esc(medName(b.medicineId))}</td><td><select class="input input-sm" data-batch>${storeBatches(b.medicineId).map((x) => `<option value="${x.id}" ${x.id === b.id ? 'selected' : ''}>${esc(x.batchNo)} · exp ${fmtDate(x.expiryDate)}</option>`).join('')}</select></td>
          <td class="ta-right">${fmtNum(batchBalance(b.id, STORE_LOC()))}</td><td class="ta-right">${fmtNum(s.pharmacy)}</td><td><input class="input input-sm ta-right" type="number" min="1" step="1" data-qty value="${l.qty}"></td><td><button class="btn btn-ghost btn-sm" data-rm>${icon('x')}</button></td></tr>`; }).join('')}</tbody></table></div>`
      : emptyState('package-open', 'No medicines added', 'Use the suggestions or search to add medicines to this transfer.');
    const units = lines.reduce((t, l) => t + (Number(l.qty) || 0), 0); const value = lines.reduce((t, l) => t + (Number(l.qty) || 0) * store.get('batches', l.batchId).ptr, 0);
    host.querySelector('[data-total]').innerHTML = lines.length ? `<strong>${lines.length}</strong> batch line(s) · <strong>${fmtNum(units)}</strong> units · value ${fmtINR(value)} at PTR` : '';
    refreshIcons(el);
  };
  const drawAll = () => { drawSug(); drawLines(); refreshIcons(host); };
  host.querySelector('[data-lines]').addEventListener('input', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr && e.target.matches('[data-qty]')) { lines[+tr.dataset.i].qty = e.target.value; const units = lines.reduce((t, l) => t + (Number(l.qty) || 0), 0); host.querySelector('[data-total]').innerHTML = `<strong>${lines.length}</strong> batch line(s) · <strong>${fmtNum(units)}</strong> units`; } });
  host.querySelector('[data-lines]').addEventListener('change', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr && e.target.matches('[data-batch]')) { lines[+tr.dataset.i].batchId = e.target.value; drawLines(); } });
  host.querySelector('[data-lines]').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr && e.target.closest('[data-rm]')) { lines.splice(+tr.dataset.i, 1); drawAll(); } });
  combo(host.querySelector('[data-add]'), { options: () => store.all('medicines').filter((m) => m.active && medicineStock(m.id).store > 0).map((m) => ({ value: m.id, label: m.brandName, sub: `Store ${medicineStock(m.id).store} · Shelf ${medicineStock(m.id).pharmacy}`, keywords: m.genericName + ' ' + m.barcode })), placeholder: 'Add medicine from store…', onChange: (v) => { addMed(v); drawAll(); } });
  host.querySelector('[data-go]').onclick = async () => {
    const items = lines.map((l) => ({ batchId: l.batchId, qty: Number(l.qty) || 0 }));
    if (!items.some((x) => x.qty > 0)) { toast('Enter the quantity to transfer.', 'error'); return; }
    const units = items.reduce((t, x) => t + x.qty, 0);
    if (!(await confirmDialog({ title: 'Transfer to Pharmacy?', iconName: 'arrow-right-left', confirmLabel: 'Transfer', message: `<strong>${fmtNum(units)}</strong> unit(s) across ${items.filter((x) => x.qty > 0).length} batch line(s) will move from the Central Store to the Pharmacy shelf.` }))) return;
    try { const t = transferStock({ items, remarks: host.querySelector('[data-remarks]').value, receivedBy: host.querySelector('[data-rcv]').value }, user); toast(`${t.id} completed. Pharmacy stock updated.`); showNote(t); done(); } catch (e) { toast(e.message, 'error'); }
  };
  drawAll();
}

function noteHTML(t) {
  const s = store.settings();
  return `<div class="transfer-note"><div class="row-between"><div><strong>${esc(s.hospitalName)}</strong><div class="muted small">Stock Transfer Note</div></div><div class="ta-right"><div class="mono strong">${t.id}</div><div class="muted small">${fmtDateTime(t.at)}</div></div></div>
    <div class="row mt-2" style="gap:24px"><span><span class="muted small">From</span><br><strong>Central Store</strong></span>${icon('arrow-right')}<span><span class="muted small">To</span><br><strong>Pharmacy</strong></span></div>
    <table class="table dense mt-2"><thead><tr><th>#</th><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="ta-right">Qty</th></tr></thead><tbody>
    ${t.items.map((x, i) => { const b = store.get('batches', x.batchId); return `<tr><td>${i + 1}</td><td>${esc(medName(x.medicineId))}</td><td class="mono">${esc(b.batchNo)}</td><td>${fmtDate(b.expiryDate)}</td><td class="ta-right strong">${fmtNum(x.qty)}</td></tr>`; }).join('')}
    <tr class="recon-total"><td colspan="4">Total units</td><td class="ta-right">${fmtNum(t.totalQty)}</td></tr></tbody></table>
    <div class="row-between mt-3"><div><span class="muted small">Issued by (Store)</span><br><strong>${esc(userName(t.performedBy))}</strong></div><div><span class="muted small">Received by (Pharmacy)</span><br><strong>${t.receivedBy ? esc(userName(t.receivedBy)) : '________________'}</strong></div></div>
    ${t.remarks ? `<p class="muted small mt-2">Remarks: ${esc(t.remarks)}</p>` : ''}</div>`;
}
function showNote(t) {
  openModal({ title: `Transfer ${t.id}`, size: 'lg', body: noteHTML(t), footer: [{ label: 'Print', icon: 'printer', onClick: () => window.print() }, { label: 'Close', cls: 'btn-primary', onClick: (c) => c() }] });
}
function history(host, focus) {
  host.innerHTML = '<div data-t></div>';
  const t = dataTable({ rows: store.all('transfers'), pageSize: 15, sort: { key: 'at', dir: 'desc' }, onRowClick: showNote, empty: emptyState('truck', 'No transfers yet'),
    columns: [
      { key: 'id', label: 'Transfer', render: (x) => `<span class="mono strong">${x.id}</span>` },
      { key: 'at', label: 'Date & Time', render: (x) => fmtDateTime(x.at) },
      { key: 'route', label: 'From → To', sortable: false, render: () => `Central Store ${icon('arrow-right', 'ic-inline')} Pharmacy` },
      { key: 'lines', label: 'Medicines', value: (x) => x.items.length, render: (x) => `<span class="small">${x.items.slice(0, 3).map((i) => esc(medName(i.medicineId))).join(', ')}${x.items.length > 3 ? ` +${x.items.length - 3} more` : ''}</span>` },
      { key: 'totalQty', label: 'Units', align: 'right', render: (x) => `<strong>${fmtNum(x.totalQty)}</strong>` },
      { key: 'value', label: 'Value (PTR)', align: 'right', render: (x) => fmtINR(x.value, true) },
      { key: 'by', label: 'Issued by', value: (x) => userName(x.performedBy), render: (x) => esc(userName(x.performedBy)) },
      { key: 'rcv', label: 'Received by', value: (x) => userName(x.receivedBy), render: (x) => (x.receivedBy ? esc(userName(x.receivedBy)) : '—') },
      { key: 'status', label: 'Status', render: () => badge('COMPLETED', 'Completed') }
    ] });
  host.querySelector('[data-t]').appendChild(t.el);
  if (focus && store.get('transfers', focus)) showNote(store.get('transfers', focus));
}
