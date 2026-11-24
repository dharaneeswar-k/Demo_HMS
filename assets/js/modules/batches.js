// Batch Management — batch-level stock, expiry tracking and batch operations
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { PHARMACY, STORE_LOC, batchStatus, batchBalance, daysUntil, medName, supplierName, userName, locationName, ledger, fefoBatches, isIssuable, BATCH_STATUSES } from '../calculations.js';
import { setQuarantine, writeOffExpired, supplierReturn } from '../services.js';
import { badge, dataTable, exportTable, emptyState, card, dl, movementBadge, confirmDialog, openModal, kpi } from '../components.js';
import { validateForm } from '../validation.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtNum, fmtINR, fmtDate, fmtDateTime, ymd, debounce, titleCase } from '../utils.js';
import { setMeta } from '../app.js';
import { navigate } from '../router.js';
import { refLink } from './inventory.js';

export function renderList(view, params, query) {
  const all = store.all('batches');
  const count = (s) => all.filter((b) => batchStatus(b) === s).length;
  view.innerHTML = `
    <div class="page-head"><div><p class="muted">Every batch has its own expiry, MRP and purchase rate. Near-expiry threshold: <strong>${store.settings().expiryThresholdDays} days</strong> (configurable in Settings).</p></div>
      <div class="page-actions"><button class="btn btn-secondary" data-export>${icon('download')}Export CSV</button></div></div>
    <div class="row mb-2" data-chips>${['', ...BATCH_STATUSES].map((s) => `<button class="chip ${s === (query.status || '') ? 'active' : ''}" data-chip="${s}">${s ? titleCase(s) : 'All batches'} <strong>${s ? count(s) : all.length}</strong></button>`).join('')}</div>
    <section class="card"><div class="toolbar">
      <div class="search">${icon('search')}<input class="input" type="search" placeholder="Search batch number or medicine…" data-f="q"></div>
      <select class="input" data-f="med"><option value="">All medicines</option>${[...store.all('medicines')].sort((a, b) => a.brandName.localeCompare(b.brandName)).map((m) => `<option value="${m.id}">${esc(m.brandName)}</option>`).join('')}</select>
      <select class="input" data-f="status"><option value="">All statuses</option>${BATCH_STATUSES.map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('')}</select>
      <select class="input" data-f="exp"><option value="">Any expiry</option><option value="expired">Already expired</option><option value="30">Within 30 days</option><option value="60">Within 60 days</option><option value="90">Within 90 days</option><option value="180">Within 180 days</option><option value="later">After 180 days</option></select>
      <select class="input" data-f="sup"><option value="">All suppliers</option>${store.all('suppliers').map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <label class="check small"><input type="checkbox" data-f="hideEmpty" ${query.status === 'DEPLETED' ? '' : 'checked'}> Hide depleted</label>
    </div><div data-table></div></section>`;
  const columns = [
    { key: 'batchNo', label: 'Batch Number', render: (b) => `<a class="mono strong" href="#/batches/${b.id}">${esc(b.batchNo)}</a>` },
    { key: 'medicine', label: 'Medicine Name', value: (b) => medName(b.medicineId), render: (b) => `<a class="cell-main" href="#/inventory/${b.medicineId}">${esc(medName(b.medicineId))}</a>` },
    { key: 'mfr', label: 'Manufacturer', value: (b) => store.get('medicines', b.medicineId)?.manufacturer, render: (b) => `<span class="cell-sub">${esc(store.get('medicines', b.medicineId)?.manufacturer)}</span>` },
    { key: 'expiryDate', label: 'Expiry Date', render: (b) => { const d = daysUntil(b.expiryDate); return `<strong class="${d < 0 ? 'text-danger' : d <= store.settings().expiryThresholdDays ? 'text-warning' : ''}">${fmtDate(b.expiryDate)}</strong><div class="cell-sub">${d < 0 ? `expired ${-d} d ago` : `${d} days left`}${b.mfgDate ? ` · mfg ${b.mfgDate.slice(5, 7)}/${b.mfgDate.slice(2, 4)}` : ''}</div>`; }, csv: (b) => b.expiryDate },
    { key: 'mrp', label: 'MRP', align: 'right', render: (b) => fmtINR(b.mrp) },
    { key: 'ptr', label: 'Purchase Rate', align: 'right', render: (b) => fmtINR(b.ptr) },
    { key: 'receivedQty', label: 'Received Qty', align: 'right', render: (b) => fmtNum(b.receivedQty) },
    { key: 'avail', label: 'Total', align: 'right', value: (b) => batchBalance(b.id), render: (b) => `<strong>${fmtNum(batchBalance(b.id))}</strong><div class="cell-sub">P ${fmtNum(batchBalance(b.id, PHARMACY()))} · S ${fmtNum(batchBalance(b.id, STORE_LOC()))}</div>` },
    { key: 'supplier', label: 'Supplier', value: (b) => supplierName(b.supplierId), render: (b) => `<span class="cell-sub">${esc(supplierName(b.supplierId))}</span>` },
    { key: 'grnId', label: 'GRN Ref', render: (b) => (b.grnId ? `<a href="#/grn/${b.grnId}" class="mono">${esc(b.grnId)}</a>` : '<span class="cell-sub">Opening</span>'), csv: (b) => b.grnId || 'Opening stock' },
    { key: 'loc', label: 'Location', value: (b) => locationName(b.locationId), render: (b) => `<span class="cell-sub">${esc(locationName(b.locationId))}</span>` },
    { key: 'status', label: 'Batch Status', value: (b) => batchStatus(b), render: (b) => badge(batchStatus(b)) }
  ];
  const table = dataTable({ columns, pageSize: 25, sort: { key: 'expiryDate', dir: 'asc' }, onRowClick: (b) => navigate('#/batches/' + b.id),
    rowClass: (b) => ({ EXPIRED: 'row-danger', NEAR_EXPIRY: 'row-warning' }[batchStatus(b)] || ''), empty: emptyState('layers', 'No batches match the filters') });
  view.querySelector('[data-table]').appendChild(table.el);
  const f = (n) => view.querySelector(`[data-f="${n}"]`);
  if (query.status) f('status').value = query.status;
  if (query.med) f('med').value = query.med;
  const apply = () => {
    const q = f('q').value.trim().toLowerCase(); const st = f('status').value; const ex = f('exp').value;
    view.querySelectorAll('[data-chip]').forEach((c) => c.classList.toggle('active', c.dataset.chip === st));
    table.setRows(all.filter((b) => {
      const s = batchStatus(b); const d = daysUntil(b.expiryDate);
      if (f('hideEmpty').checked && !st && ['DEPLETED', 'RETURNED'].includes(s)) return false;
      if (q && !(b.batchNo.toLowerCase().includes(q) || medName(b.medicineId).toLowerCase().includes(q))) return false;
      if (f('med').value && b.medicineId !== f('med').value) return false;
      if (f('sup').value && b.supplierId !== f('sup').value) return false;
      if (st && s !== st) return false;
      if (ex === 'expired' && d >= 0) return false;
      if (['30', '60', '90', '180'].includes(ex) && !(d >= 0 && d <= +ex)) return false;
      if (ex === 'later' && d <= 180) return false;
      return true;
    }));
  };
  view.querySelectorAll('[data-f]').forEach((el) => el.addEventListener(el.type === 'search' ? 'input' : 'change', debounce(apply, 120)));
  view.querySelectorAll('[data-chip]').forEach((c) => { c.onclick = () => { f('status').value = c.dataset.chip; if (c.dataset.chip === 'DEPLETED' || c.dataset.chip === 'RETURNED') f('hideEmpty').checked = false; apply(); }; });
  view.querySelector('[data-export]').onclick = () => { exportTable(`batches-${ymd()}.csv`, columns, table.getRows()); toast('Batch list exported.'); };
  apply();
}

export function renderDetails(view, params) {
  const b = store.get('batches', params.id);
  if (!b) { view.innerHTML = emptyState('layers', 'Batch not found', '', '<a class="btn btn-primary" href="#/batches">Back to batches</a>'); return; }
  const user = currentUser();
  const m = store.get('medicines', b.medicineId);
  setMeta({ title: `Batch ${b.batchNo}`, crumbs: [{ label: 'Inventory', href: '#/inventory' }, { label: 'Batch Management', href: '#/batches' }, b.batchNo] });
  const st = batchStatus(b); const bal = batchBalance(b.id); const d = daysUntil(b.expiryDate);
  const fefo = fefoBatches(b.medicineId); const rank = fefo.findIndex((x) => x.id === b.id);
  const moves = ledger().filter((x) => x.batchId === b.id);
  const issued = moves.filter((x) => x.type === 'PHARMACY_SALE').reduce((s, x) => s + x.qtyOut, 0);
  const manage = can('batch.manage');

  view.innerHTML = `
    <div class="page-head"><div><div class="row"><h1 class="mono">${esc(b.batchNo)}</h1>${badge(st)}${isIssuable(b) ? '<span class="tag tag-success">Issuable</span>' : '<span class="tag tag-danger">Blocked from issue</span>'}</div>
      <p class="muted"><a href="#/inventory/${m.id}">${esc(m.brandName)}</a> · ${esc(m.genericName)} · ${esc(m.strength)} · ${esc(m.manufacturer)}</p></div>
      <div class="page-actions">
        ${isIssuable(b) && can('pharmacy.bill') ? `<a class="btn btn-secondary" href="#/pharmacy/bill?med=${m.id}">${icon('shopping-bag')}Bill this medicine</a>` : ''}
        ${can('adjustment.request') && bal >= 0 && !b.returned ? `<a class="btn btn-secondary" href="#/adjustments?new=1&batch=${b.id}">${icon('scale')}Adjust</a>` : ''}
        ${manage && bal > 0 && !['EXPIRED'].includes(st) ? `<button class="btn btn-secondary" data-a="quar">${icon(b.quarantined ? 'shield-check' : 'shield-off')}${b.quarantined ? 'Release quarantine' : 'Quarantine'}</button>` : ''}
        ${manage && bal > 0 ? `<button class="btn btn-secondary" data-a="return">${icon('undo-2')}Supplier return</button>` : ''}
        ${can('labels.print') && bal > 0 ? `<a class="btn btn-secondary" href="#/labels?batch=${b.id}">${icon('barcode')}Print labels</a>` : ''}
        ${manage && st === 'EXPIRED' ? `<button class="btn btn-danger" data-a="writeoff">${icon('trash-2')}Write off expired</button>` : ''}
      </div></div>
    ${st === 'EXPIRED' ? `<div class="alert alert-danger mb-2">${icon('calendar-x')}<div><strong>Expired ${-d} day(s) ago.</strong> This batch is blocked from normal issue. Segregate the ${fmtNum(bal)} remaining unit(s) and ${manage ? 'write them off' : 'ask the Pharmacy Manager to write them off'}.</div></div>` : ''}
    ${st === 'NEAR_EXPIRY' ? `<div class="alert alert-warning mb-2">${icon('calendar-clock')}<div><strong>Expires in ${d} day(s).</strong> Prioritise this batch for issue (FEFO) or arrange a supplier return.</div></div>` : ''}
    ${st === 'QUARANTINED' ? `<div class="alert alert-info mb-2">${icon('shield-off')}<div><strong>Quarantined.</strong> ${esc(b.notes)}</div></div>` : ''}
    <div class="kpis">
      ${kpi({ label: 'Pharmacy / Store', value: `${fmtNum(batchBalance(b.id, PHARMACY()))} / ${fmtNum(batchBalance(b.id, STORE_LOC()))}`, iconName: 'package', tone: 'teal', sub: `${fmtNum(bal)} ${esc(m.unit)}(s) in total` })}
      ${kpi({ label: 'Received', value: fmtNum(b.receivedQty), iconName: 'package-plus', tone: 'navy' })}
      ${kpi({ label: 'Sold (pharmacy bills)', value: fmtNum(issued), iconName: 'shopping-bag', tone: 'info' })}
      ${kpi({ label: 'Expiry', value: fmtDate(b.expiryDate), iconName: 'calendar', tone: d < 0 ? 'danger' : d <= store.settings().expiryThresholdDays ? 'warning' : 'success', sub: d < 0 ? 'Expired' : `${d} days left` })}
      ${kpi({ label: 'FEFO position', value: rank >= 0 ? `#${rank + 1} of ${fefo.length}` : '—', iconName: 'list-ordered', tone: 'purple', sub: rank === 0 ? 'Issue this batch first' : rank > 0 ? 'Issue after earlier expiries' : 'Not issuable' })}
    </div>
    <div class="grid grid-3-1">
      ${card('Batch Information', dl([['Batch Number', `<span class="mono">${esc(b.batchNo)}</span>`], ['Medicine', `<a href="#/inventory/${m.id}">${esc(m.brandName)}</a>`], ['Manufacturer', esc(m.manufacturer)], ['Manufacturing Date', b.mfgDate ? fmtDate(b.mfgDate) : '—'], ['Expiry Date', fmtDate(b.expiryDate)],
        ['MRP', fmtINR(b.mrp)], ['Purchase Rate (PTR)', fmtINR(b.ptr)], ['Value on hand', fmtINR(bal * b.ptr)], ['Location', esc(locationName(b.locationId))],
        ['Supplier', `<a href="#/suppliers/${b.supplierId}">${esc(supplierName(b.supplierId))}</a>`], ['GRN Reference', b.grnId ? `<a href="#/grn/${b.grnId}">${esc(b.grnId)}</a>` : 'Opening stock'], ['Received On', fmtDateTime(b.receivedAt)], ['Notes', esc(b.notes || '—')]]))}
      ${card('Other batches of this medicine', `<ul class="list-plain">${store.all('batches').filter((x) => x.medicineId === m.id && x.id !== b.id && batchBalance(x.id) > 0).sort((a, c) => a.expiryDate.localeCompare(c.expiryDate)).map((x) => `<li class="list-row"><div><a class="mono strong" href="#/batches/${x.id}">${esc(x.batchNo)}</a><div class="cell-sub">Exp ${fmtDate(x.expiryDate)}</div></div><div class="ta-right">${fmtNum(batchBalance(x.id))}<div>${badge(batchStatus(x))}</div></div></li>`).join('') || '<li class="muted small">No other batches in stock.</li>'}</ul>`)}
    </div>
    ${card('Stock Movement History', moves.length ? `<div class="table-scroll"><table class="table dense"><thead><tr><th>Movement</th><th>Date & Time</th><th>Location</th><th>Type</th><th class="ta-right">Qty In</th><th class="ta-right">Qty Out</th><th class="ta-right">Previous</th><th class="ta-right">New Balance</th><th>Reference</th><th>Performed By</th><th>Reason</th></tr></thead><tbody>
      ${[...moves].reverse().map((x) => `<tr><td class="mono">${x.id}</td><td>${fmtDateTime(x.at)}</td><td>${esc(locationName(x.locationId))}</td><td>${movementBadge(x.type)}</td><td class="ta-right text-success">${x.qtyIn ? '+' + fmtNum(x.qtyIn) : ''}</td><td class="ta-right text-danger">${x.qtyOut ? '−' + fmtNum(x.qtyOut) : ''}</td><td class="ta-right">${fmtNum(x.prevBalance)}</td><td class="ta-right strong">${fmtNum(x.newBalance)}</td><td>${refLink(x.reference)}</td><td>${esc(userName(x.userId))}</td><td class="cell-sub">${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('arrow-left-right', 'No movements'), { cls: 'flush mt-2', sub: 'Running balance is calculated from the ledger' })}`;

  const rerender = () => renderDetails(view, params);
  view.querySelectorAll('[data-a]').forEach((btn) => { btn.onclick = async () => {
    try {
      if (btn.dataset.a === 'quar') {
        const r = await confirmDialog({ title: b.quarantined ? 'Release from quarantine?' : 'Quarantine batch?', message: b.quarantined ? 'The batch becomes available for issue again.' : 'Quarantined stock is excluded from available stock and cannot be issued.', confirmLabel: b.quarantined ? 'Release' : 'Quarantine', reason: true, iconName: 'shield-off', tone: b.quarantined ? 'primary' : 'danger' });
        if (!r) return; setQuarantine(b.id, !b.quarantined, r.reason, user); toast(b.quarantined ? 'Batch quarantined.' : 'Batch released.'); rerender();
      }
      if (btn.dataset.a === 'writeoff') {
        const r = await confirmDialog({ title: 'Write off expired stock?', message: `${fmtNum(bal)} unit(s) worth ${fmtINR(bal * b.ptr)} will be removed via an EXPIRED_WRITE_OFF movement. This cannot be undone.`, confirmLabel: 'Write off', tone: 'danger', reason: true, reasonPlaceholder: 'e.g. Sent for destruction via authorised agency', iconName: 'trash-2' });
        if (!r) return; writeOffExpired(b.id, user, r.reason); toast('Expired stock written off. Ledger updated.'); rerender();
      }
      if (btn.dataset.a === 'return') {
        const stQ = batchBalance(b.id, STORE_LOC()); const phQ = batchBalance(b.id, PHARMACY());
        openModal({ title: 'Return to supplier', subtitle: `${esc(supplierName(b.supplierId))} · Store ${fmtNum(stQ)} · Pharmacy ${fmtNum(phQ)}`, size: 'sm',
          body: `<form class="form-grid" data-f><div class="field col-12"><label>Return from</label><select class="input" name="loc">${stQ ? `<option value="${STORE_LOC()}">Central Store (${stQ})</option>` : ''}${phQ ? `<option value="${PHARMACY()}">Pharmacy (${phQ})</option>` : ''}</select></div><div class="field col-12"><label>Quantity <span class="req">*</span></label><input class="input" type="number" name="qty" min="1" max="${bal}" step="1" value="${bal}" data-rules="required,positive"></div><div class="field col-12"><label>Reason <span class="req">*</span></label><textarea class="input" name="reason" data-rules="required" placeholder="e.g. Near expiry, damaged packs"></textarea></div></form>`,
          footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Record return', cls: 'btn-primary', onClick: (close, wrap) => {
            const form = wrap.querySelector('[data-f]'); if (!validateForm(form)) return;
            const d2 = Object.fromEntries(new FormData(form));
            try { supplierReturn(b.id, Number(d2.qty), d2.reason, user, d2.loc); toast('Supplier return recorded.'); close(); rerender(); } catch (e) { toast(e.message, 'error'); }
          } }] });
      }
    } catch (e) { toast(e.message, 'error'); }
  }; });
}
