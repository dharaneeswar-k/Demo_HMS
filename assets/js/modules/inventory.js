// Module 2 — Stock Overview and medicine-level inventory detail
import { store } from '../data-service.js';
import { can } from '../auth.js';
import { PHARMACY, STORE_LOC, inventoryKPIs, medicineStockMap, stockStatus, batchStatus, batchBalance, daysUntil, fefoBatches, supplierName, userName, ledger, isIssuable } from '../calculations.js';
import { kpi, card, badge, dataTable, exportTable, emptyState, chart, movementBadge, dl } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtNum, fmtINR, fmtCompactINR, fmtDate, fmtDateTime, ymd, debounce } from '../utils.js';
import { setMeta } from '../app.js';
import { navigate } from '../router.js';

export function renderOverview(view, params, query) {
  const k = inventoryKPIs();
  const map = medicineStockMap();
  view.innerHTML = `
    <div class="page-head"><div><p class="muted">How much of each medicine you can sell right now. Expired or held-back stock is not counted.</p></div>
      <div class="page-actions"><button class="btn btn-secondary" data-export>${icon('download')}Export CSV</button>
      ${can('pharmacy.bill') ? `<a class="btn btn-secondary" href="#/pharmacy/bill">${icon('shopping-bag')}Pharmacy Sale</a>` : ''}${can('grn.create') ? `<a class="btn btn-primary" href="#/grn/new">${icon('plus')}Receive Stock</a>` : ''}</div></div>
    <div class="chip-row">
      <a class="chip" data-st="" href="#/inventory">All medicines <strong>${fmtNum(k.medicines)}</strong></a>
      <a class="chip" data-st="LOW_STOCK" href="#/inventory?status=LOW_STOCK">Low stock <strong>${fmtNum(k.low)}</strong></a>
      <a class="chip" data-st="OUT_OF_STOCK" href="#/inventory?status=OUT_OF_STOCK">Out of stock <strong>${fmtNum(k.out)}</strong></a>
      <a class="chip" href="#/batches?status=NEAR_EXPIRY">${icon('calendar-clock')}Expiring soon <strong>${fmtNum(k.near)}</strong></a>
      <a class="chip" href="#/batches?status=EXPIRED">${icon('calendar-x')}Expired <strong>${fmtNum(k.expired)}</strong></a>
    </div>
    <section class="card"><div class="toolbar">
      <div class="search">${icon('search')}<input class="input" type="search" placeholder="Search name, generic name or code…" data-f="q"></div>
      <select class="input" data-f="category"><option value="">All categories</option>${store.all('categories').map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <select class="input" data-f="status"><option value="">Any stock level</option><option value="IN_STOCK">In stock</option><option value="LOW_STOCK">Low stock</option><option value="OUT_OF_STOCK">Out of stock</option></select>
      <input type="hidden" data-f="form"><input type="checkbox" class="hidden" data-f="inactive">
      <button class="btn btn-ghost btn-sm" data-clear>${icon('x')}Clear</button>
    </div><div data-table></div></section>`;

  const columns = [
    { key: 'brandName', label: 'Medicine', render: (m) => `<a class="cell-main" href="#/inventory/${m.id}">${esc(m.brandName)}</a>${m.active ? '' : ' <span class="tag tag-neutral">Inactive</span>'}<div class="cell-sub">${esc(m.genericName)} · ${esc(m.strength)} · ${esc(m.form)}</div>`, csv: (m) => m.brandName },
    { key: 'genericName', label: 'Generic', csv: (m) => m.genericName, render: (m) => `<span class="cell-sub">${esc(m.category)}</span>`, sortable: false },
    { key: 'pharmacy', label: 'Pharmacy', align: 'right', value: (m) => map[m.id].pharmacy, render: (m) => `<strong>${fmtNum(map[m.id].pharmacy)}</strong>${map[m.id].pharmacy <= m.reorderLevel && map[m.id].store ? '<div class="cell-sub text-warning">refill</div>' : ''}` },
    { key: 'storeQty', label: 'Store', align: 'right', value: (m) => map[m.id].store, render: (m) => fmtNum(map[m.id].store) },
    { key: 'available', label: 'Total available', align: 'right', value: (m) => map[m.id].available, render: (m) => `<strong style="font-size:15px">${fmtNum(map[m.id].available)}</strong> <span class="cell-sub">${esc(m.unit)}</span>${map[m.id].expired + map[m.id].quarantined ? `<div class="cell-sub" title="Expired or held-back units that cannot be sold">+${fmtNum(map[m.id].expired + map[m.id].quarantined)} not sellable</div>` : ''}` },
    { key: 'reorderLevel', label: 'Reorder at', align: 'right', value: (m) => m.reorderLevel },
    { key: 'status', label: 'Status', value: (m) => stockStatus(m, map[m.id].available), render: (m) => badge(stockStatus(m, map[m.id].available)) },
    { key: '', label: 'Actions', sortable: false, csv: false, align: 'right', render: (m) => `<div class="row-actions"><a class="btn btn-ghost btn-sm" href="#/inventory/${m.id}" title="View details">${icon('eye')}</a>${can('pharmacy.bill') && map[m.id].available ? `<a class="btn btn-secondary btn-sm" href="#/pharmacy/bill?med=${m.id}" title="Add to a new bill">${icon('receipt')}Bill</a>` : ''}</div>` }
  ];
  const table = dataTable({ columns, pageSize: 25, sort: { key: 'brandName', dir: 'asc' }, onRowClick: (m) => navigate('#/inventory/' + m.id),
    rowClass: (m) => ({ OUT_OF_STOCK: 'row-danger', LOW_STOCK: 'row-warning' }[stockStatus(m, map[m.id].available)] || '') });
  view.querySelector('[data-table]').appendChild(table.el);
  const f = (n) => view.querySelector(`[data-f="${n}"]`);
  if (query.status) f('status').value = query.status;
  if (query.category) f('category').value = query.category;
  const apply = () => {
    const q = f('q').value.trim().toLowerCase();
    table.setRows(store.all('medicines').filter((m) => (f('inactive').checked || m.active)
      && (!q || [m.brandName, m.genericName, m.code, m.composition, m.barcode].join(' ').toLowerCase().includes(q))
      && (!f('category').value || m.category === f('category').value) && (!f('form').value || m.form === f('form').value)
      && (!f('status').value || stockStatus(m, map[m.id].available) === f('status').value)));
  };
  view.querySelectorAll('[data-f]').forEach((el) => el.addEventListener(el.type === 'search' ? 'input' : 'change', debounce(apply, 120)));
  view.querySelector('[data-clear]').onclick = () => { view.querySelectorAll('[data-f]').forEach((el) => { if (el.type === 'checkbox') el.checked = false; else el.value = ''; }); apply(); };
  view.querySelector('[data-export]').onclick = () => { exportTable(`stock-overview-${ymd()}.csv`, columns, table.getRows()); toast('Stock overview exported.'); };
  apply();
  view.querySelectorAll('[data-st]').forEach((c) => c.classList.toggle('active', (query.status || '') === c.dataset.st));
}

export function renderMedicine(view, params) {
  const m = store.get('medicines', params.id);
  if (!m) { view.innerHTML = emptyState('pill-off', 'Medicine not found', '', '<a class="btn btn-primary" href="#/inventory">Back to Stock Overview</a>'); return; }
  setMeta({ title: m.brandName, crumbs: [{ label: 'Inventory', href: '#/inventory' }, { label: 'Stock Overview', href: '#/inventory' }, m.brandName] });
  const s = medicineStockMap()[m.id];
  const st = stockStatus(m, s.available);
  const batches = store.all('batches').filter((b) => b.medicineId === m.id).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const fefo = fefoBatches(m.id);
  const moves = ledger().filter((x) => x.medicineId === m.id);

  view.innerHTML = `
    <div class="page-head"><div><div class="row"><h1>${esc(m.brandName)}</h1>${badge(st)}${m.active ? '' : badge('INACTIVE')}</div>
      <p class="muted">${esc(m.genericName)} · ${esc(m.strength)} · ${esc(m.form)} · ${esc(m.manufacturer)} · <span class="mono">${esc(m.code)}</span></p></div>
      <div class="page-actions"><a class="btn btn-secondary" href="#/movements?med=${m.id}">${icon('arrow-left-right')}Ledger</a>
      ${can('adjustment.request') ? `<a class="btn btn-secondary" href="#/adjustments?new=1&med=${m.id}">${icon('scale')}Adjust stock</a>` : ''}
      ${can('pharmacy.bill') ? `<a class="btn btn-secondary" href="#/pharmacy/bill?med=${m.id}">${icon('shopping-bag')}Bill this medicine</a>` : ''}
      ${can('grn.create') ? `<a class="btn btn-primary" href="#/grn/new">${icon('plus')}Receive stock</a>` : ''}</div></div>
    ${st !== 'IN_STOCK' ? `<div class="alert ${st === 'OUT_OF_STOCK' ? 'alert-danger' : 'alert-warning'} mb-2">${icon('alert-triangle')}<div><strong>${st === 'OUT_OF_STOCK' ? 'Out of stock.' : 'Low stock.'}</strong> Available ${fmtNum(s.available)} ${esc(m.unit)}(s) against a reorder level of ${m.reorderLevel}. Raise a purchase order with the supplier.</div></div>` : ''}
    <div class="kpis">
      ${kpi({ label: 'On pharmacy shelf', value: `${fmtNum(s.pharmacy)} <small class="muted" style="font-size:13px">${esc(m.unit)}</small>`, iconName: 'store', tone: 'success', sub: 'Available for billing' })}
      ${kpi({ label: 'In central store', value: fmtNum(s.store), iconName: 'warehouse', tone: 'navy', sub: can('store.transfer') && s.store ? '<a href="#/transfers">Transfer to pharmacy</a>' : 'Transferred to pharmacy as needed' })}
      ${kpi({ label: 'Total on hand', value: fmtNum(s.onHand), iconName: 'package', tone: 'teal', sub: `${fmtNum(s.expired)} expired · ${fmtNum(s.quarantined)} quarantined` })}
      ${kpi({ label: 'Reorder / Minimum', value: `${m.reorderLevel} / ${m.minStockLevel}`, iconName: 'gauge', tone: 'navy' })}
      ${kpi({ label: 'Active batches', value: fmtNum(s.batchCount), iconName: 'layers', tone: 'info', sub: s.nearestExpiry ? 'Next expiry ' + fmtDate(s.nearestExpiry) : 'No issuable batch' })}
      ${kpi({ label: 'Stock value (PTR)', value: fmtINR(s.value, true), iconName: 'indian-rupee', tone: 'purple' })}
    </div>
    <div class="grid grid-3-1">
      ${card('Pharmacy shelf — FEFO order', fefo.length ? `<p class="muted small mb-2">Bill from the batch that expires first. Expired and quarantined batches are excluded automatically.</p><div class="grid" style="gap:8px">${fefo.map((b, i) => `<div class="fefo-pick ${i === 0 ? 'first' : ''}"><div><div class="row"><span class="mono strong">${esc(b.batchNo)}</span>${i === 0 ? '<span class="tag tag-success">Issue first</span>' : ''}${badge(batchStatus(b))}</div><div class="cell-sub">Expiry ${fmtDate(b.expiryDate)} (${daysUntil(b.expiryDate)} days) · MRP ${fmtINR(b.mrp)}</div></div><span class="qty-pill">${fmtNum(batchBalance(b.id, PHARMACY()))}<small>${esc(m.unit)}</small></span></div>`).join('')}</div>`
        : emptyState('package-x', 'No issuable batch', 'All batches are depleted, expired or quarantined.'))}
      ${card('Medicine Master', dl([['Composition', esc(m.composition)], ['Category', esc(m.category)], ['Pack Size', esc(m.packSize)], ['Purchase Unit', esc(m.purchaseUnit)], ['Dispensing Unit', esc(m.dispensingUnit)], ['Conversion', `1 purchase unit = ${m.conversion} ${esc(m.dispensingUnit)}`], ['HSN / GST', `${esc(m.hsnCode)} · ${m.gstPct}%`], ['Storage', esc(m.storage)], ['Barcode', `<span class="mono">${esc(m.barcode || '—')}</span>`]]), { actions: can('medicine.manage') ? `<a class="btn btn-ghost btn-sm" href="#/medicines?edit=${m.id}">${icon('pencil')}Edit</a>` : '' })}
    </div>
    ${card('Stock Balance Trend', '<div class="chart-box sm"><canvas id="ch-trend"></canvas></div>', { cls: 'mt-2', sub: 'Total on-hand units after each movement' })}
    ${card('All Batches', '<div data-batches></div>', { cls: 'flush mt-2', sub: 'Batch-level expiry, prices and balances' })}
    ${card('Recent Stock Movements', '<div data-moves></div>', { cls: 'flush mt-2', actions: `<a class="btn btn-ghost btn-sm" href="#/movements?med=${m.id}">Full ledger ${icon('arrow-right')}</a>` })}`;

  const bt = dataTable({ pageSize: 10, sort: { key: 'expiryDate', dir: 'asc' }, onRowClick: (b) => navigate('#/batches/' + b.id), rows: batches,
    rowClass: (b) => ({ EXPIRED: 'row-danger', NEAR_EXPIRY: 'row-warning' }[batchStatus(b)] || ''),
    columns: [
      { key: 'batchNo', label: 'Batch', render: (b) => `<a class="mono strong" href="#/batches/${b.id}">${esc(b.batchNo)}</a>${isIssuable(b) ? '' : ' <span class="tag tag-danger">Blocked</span>'}` },
      { key: 'expiryDate', label: 'Expiry', render: (b) => { const d = daysUntil(b.expiryDate); return `${fmtDate(b.expiryDate)}<div class="cell-sub ${d < 0 ? 'text-danger' : ''}">${d < 0 ? `${-d} d ago` : `${d} d left`}</div>`; } },
      { key: 'mrp', label: 'MRP', align: 'right', render: (b) => fmtINR(b.mrp) },
      { key: 'ptr', label: 'PTR', align: 'right', render: (b) => fmtINR(b.ptr) },
      { key: 'receivedQty', label: 'Received', align: 'right', render: (b) => fmtNum(b.receivedQty) },
      { key: 'ph', label: 'Pharmacy', align: 'right', value: (b) => batchBalance(b.id, PHARMACY()), render: (b) => `<strong>${fmtNum(batchBalance(b.id, PHARMACY()))}</strong>` },
      { key: 'st', label: 'Store', align: 'right', value: (b) => batchBalance(b.id, STORE_LOC()), render: (b) => fmtNum(batchBalance(b.id, STORE_LOC())) },
      { key: 'supplier', label: 'Supplier', value: (b) => supplierName(b.supplierId), render: (b) => esc(supplierName(b.supplierId)) },
      { key: 'grnId', label: 'GRN', render: (b) => (b.grnId ? `<a href="#/grn/${b.grnId}">${esc(b.grnId)}</a>` : '<span class="cell-sub">Opening stock</span>') },
      { key: 'status', label: 'Status', value: (b) => batchStatus(b), render: (b) => badge(batchStatus(b)) }
    ] });
  view.querySelector('[data-batches]').appendChild(bt.el);
  const recent = [...moves].reverse().slice(0, 12);
  view.querySelector('[data-moves]').innerHTML = recent.length ? `<div class="table-scroll"><table class="table dense"><thead><tr><th>Date</th><th>Batch</th><th>Type</th><th class="ta-right">In</th><th class="ta-right">Out</th><th class="ta-right">Batch Balance</th><th>Reference</th><th>By</th></tr></thead><tbody>
    ${recent.map((x) => `<tr><td>${fmtDateTime(x.at)}</td><td class="mono">${esc(store.get('batches', x.batchId)?.batchNo)}</td><td>${movementBadge(x.type)}</td><td class="ta-right text-success">${x.qtyIn ? '+' + fmtNum(x.qtyIn) : ''}</td><td class="ta-right text-danger">${x.qtyOut ? '−' + fmtNum(x.qtyOut) : ''}</td><td class="ta-right strong">${fmtNum(x.newBalance)}</td><td>${refLink(x.reference)}</td><td>${esc(userName(x.userId))}</td></tr>`).join('')}</tbody></table></div>` : emptyState('arrow-left-right', 'No movements yet');

  // trend
  let run = 0; const pts = moves.map((x) => { run += x.qtyIn - x.qtyOut; return { x: x.at, y: run }; });
  const days = {}; pts.forEach((p) => { days[ymd(p.x)] = p.y; });
  const labels = Object.keys(days);
  chart(view.querySelector('#ch-trend'), { type: 'line', data: { labels: labels.map((d) => fmtDate(d).slice(0, 6)), datasets: [
    { label: 'On hand', data: labels.map((d) => days[d]), borderColor: '#049794', backgroundColor: 'rgba(4,151,148,.1)', fill: true, tension: .25, pointRadius: 0, borderWidth: 2 },
    { label: 'Reorder level', data: labels.map(() => m.reorderLevel), borderColor: '#E8A23A', borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5 }] },
  options: { interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true, grid: { color: '#EEF2F5' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } }, plugins: { legend: { position: 'top', align: 'end' } } } });
}

export function refLink(ref) {
  if (!ref) return '—';
  if (/^GRN-/.test(ref)) return `<a href="#/grn/${ref}" class="mono">${esc(ref)}</a>`;
  if (/^PB-/.test(ref)) return `<a href="#/pharmacy/bills/${ref}" class="mono">${esc(ref)}</a>`;
  if (/^PR-/.test(ref)) return `<a href="#/pharmacy/returns?focus=${ref}" class="mono">${esc(ref)}</a>`;
  if (/^ADJ-/.test(ref)) return `<a href="#/adjustments?focus=${ref}" class="mono">${esc(ref)}</a>`;
  return `<span class="mono">${esc(ref)}</span>`;
}
