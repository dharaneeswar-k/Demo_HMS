import { store } from '../data-service.js';
import { currentUser, can, roleLabel } from '../auth.js';
import { inventoryKPIs, grnKPIs, monthlyInOut, categoryDistribution, fastMovers, medicineStockMap, stockStatus, batchStatus, batchBalance, daysUntil, medName, supplierName, userName, grnTotals, ledger } from '../calculations.js';
import { kpi, card, badge, chart, PALETTE, movementBadge, emptyState } from '../components.js';
import { esc, icon, fmtNum, fmtCompactINR, fmtINR, fmtDate, relTime } from '../utils.js';
import { daySummary, businessDate, pendingClosings } from '../pharmacy-calc.js';

export function render(view) {
  const u = currentUser();
  const k = inventoryKPIs();
  const g = grnKPIs();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // role-specific tasks
  const tasks = [];
  const myDrafts = store.all('grns').filter((x) => ['DRAFT', 'VALIDATION_REQUIRED'].includes(x.status) && (x.receivedBy === u.id || can('grn.verify')));
  if (myDrafts.length) tasks.push({ n: myDrafts.length, t: 'GRN draft(s) to complete', href: '#/grn?status=DRAFT', ic: 'file-pen-line' });
  if (can('grn.verify') && g.pendingVerification) tasks.push({ n: g.pendingVerification, t: 'GRN(s) awaiting verification', href: '#/grn?status=SUBMITTED', ic: 'clipboard-check' });
  if (can('grn.approve.exceptional') && g.pendingApproval) tasks.push({ n: g.pendingApproval, t: 'exceptional GRN(s) need your approval', href: '#/grn?status=PENDING_APPROVAL', ic: 'shield-alert' });
  const pendAdj = store.all('adjustments').filter((a) => a.status.startsWith('PENDING') && (a.requiresOwner ? can('adjustment.approve.exceptional') : can('adjustment.approve')) && a.requestedBy !== u.id);
  if (pendAdj.length) tasks.push({ n: pendAdj.length, t: 'stock adjustment(s) to approve', href: '#/adjustments?status=PENDING', ic: 'scale' });
  if (k.expired) tasks.push({ n: k.expired, t: 'expired batch(es) to segregate', href: '#/batches?status=EXPIRED', ic: 'calendar-x' });

  view.innerHTML = `
    <div class="callout mb-2">
      <div class="grow">
        <h2>${greet}, ${esc(u.name.split(' ').slice(0, u.name.startsWith('Dr') ? 2 : 1).join(' '))}</h2>
        <p class="small" style="color:#b9d0e0">${esc(roleLabel())} · ${tasks.length ? `You have <strong style="color:#fff">${tasks.reduce((s, t) => s + t.n, 0)}</strong> item(s) needing attention.` : 'Everything is up to date. 🎉'}</p>
      </div>
      <div class="row">
        ${can('pharmacy.bill') ? `<a class="btn btn-primary" href="#/pharmacy/bill">${icon('receipt')}Pharmacy Sale</a>` : ''}
        ${can('grn.create') ? `<a class="btn btn-secondary" href="#/grn/new">${icon('plus')}Create New GRN</a>` : ''}
        <a class="btn btn-secondary" href="#/inventory">${icon('boxes')}Stock Overview</a>
      </div>
    </div>
    ${tasks.length ? `<div class="row mb-2">${tasks.map((t) => `<a class="chip" href="${t.href}">${icon(t.ic)}<strong>${t.n}</strong> ${esc(t.t)}</a>`).join('')}</div>` : ''}
    <div class="kpis">
      ${kpi({ label: 'Total Medicines', value: fmtNum(k.medicines), iconName: 'pill', tone: 'navy', sub: 'Active in medicine master', href: '#/medicines' })}
      ${kpi({ label: 'Total Stock Units', value: fmtNum(k.onHand), iconName: 'package', tone: 'teal', sub: 'On hand incl. expired/quarantined', href: '#/inventory' })}
      ${kpi({ label: 'Available Stock', value: fmtNum(k.available), iconName: 'package-check', tone: 'success', sub: 'Issuable units', href: '#/inventory' })}
      ${kpi({ label: 'Inventory Value', value: fmtCompactINR(k.value), iconName: 'indian-rupee', tone: 'info', sub: 'At purchase rate (PTR)', href: '#/reports?r=current-stock' })}
      ${kpi({ label: 'Low Stock Items', value: fmtNum(k.low), iconName: 'trending-down', tone: 'warning', sub: 'At/below reorder level', href: '#/inventory?status=LOW_STOCK' })}
      ${kpi({ label: 'Out of Stock', value: fmtNum(k.out), iconName: 'ban', tone: 'danger', sub: 'No issuable stock', href: '#/inventory?status=OUT_OF_STOCK' })}
      ${kpi({ label: 'Near Expiry Batches', value: fmtNum(k.near), iconName: 'calendar-clock', tone: 'warning', sub: `Within ${store.settings().expiryThresholdDays} days`, href: '#/batches?status=NEAR_EXPIRY' })}
      ${kpi({ label: 'Expired Batches', value: fmtNum(k.expired), iconName: 'calendar-x', tone: 'danger', sub: 'Blocked from issue', href: '#/batches?status=EXPIRED' })}
    </div>
    <div class="kpis mt-2">
      ${kpi({ label: "Today's GRNs", value: fmtNum(g.today), iconName: 'calendar-check', tone: 'teal', href: '#/grn' })}
      ${kpi({ label: 'Pending Verification', value: fmtNum(g.pendingVerification), iconName: 'clipboard-check', tone: 'info', href: '#/grn?status=SUBMITTED' })}
      ${kpi({ label: 'Pending Owner Approval', value: fmtNum(g.pendingApproval), iconName: 'shield-alert', tone: 'purple', href: '#/grn?status=PENDING_APPROVAL' })}
      ${kpi({ label: 'Posted Receipts Value', value: fmtCompactINR(g.receivedValue), iconName: 'receipt-indian-rupee', tone: 'success', sub: `${g.posted} posted GRNs`, href: '#/grn?status=POSTED' })}
    </div>
    ${can('pharmacy.dashboard') ? (() => { const ps = daySummary(businessDate()); const pc = pendingClosings(); const last = [...store.all('closings')].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
      return `<div class="section-title mt-3">Pharmacy today · ${fmtDate(businessDate())}</div><div class="kpis">
      ${kpi({ label: 'Pharmacy Sales', value: fmtINR(ps.sales, true), iconName: 'receipt', tone: 'teal', sub: `${ps.liveBills} bills`, href: '#/pharmacy' })}
      ${kpi({ label: 'Net Collection', value: fmtINR(ps.netCollection, true), iconName: 'wallet', tone: 'success', sub: `Cash ${fmtINR(ps.byMode.CASH.net, true)} · UPI ${fmtINR(ps.byMode.UPI.net, true)}`, href: '#/pharmacy' })}
      ${kpi({ label: 'Pending Closings', value: fmtNum(pc.length), iconName: 'calendar-x', tone: pc.length ? 'warning' : 'success', sub: 'Earlier business days', href: can('pharmacy.closing.report') ? '#/pharmacy/closing-report' : '#/pharmacy/closing' })}
      ${kpi({ label: 'Latest Closing', value: last ? fmtDate(last.businessDate) : '—', iconName: 'lock', tone: last && Math.abs(last.cashDifference) > store.ph().cashVarianceTolerance ? 'danger' : 'navy', sub: last ? `${esc(userName(last.cashierId))} · variance ${fmtINR(last.cashDifference)}` : '', href: can('pharmacy.closing.report') ? '#/pharmacy/closing-report?focus=' + (last?.id || '') : '#/pharmacy/closing' })}
      </div>`; })() : ''}
    <div class="grid grid-3-1">
      ${card('Stock In vs Stock Out', '<div class="chart-box"><canvas id="ch-inout"></canvas></div>', { sub: 'Units moved per month (from the stock ledger)', actions: `<a class="btn btn-ghost btn-sm" href="#/movements">View ledger ${icon('arrow-right')}</a>` })}
      ${card('Stock Value by Category', '<div class="chart-box"><canvas id="ch-cat"></canvas></div>', { sub: 'Purchase value of on-hand stock' })}
    </div>
    <div class="grid grid-2">
      ${card('Low Stock Medicines', '<div id="tb-low"></div>', { cls: 'flush', actions: `<a class="btn btn-ghost btn-sm" href="#/inventory?status=LOW_STOCK">View all ${icon('arrow-right')}</a>` })}
      ${card('Near Expiry & Expired Batches', '<div id="tb-exp"></div>', { cls: 'flush', actions: `<a class="btn btn-ghost btn-sm" href="#/reports?r=near-expiry">Expiry report ${icon('arrow-right')}</a>` })}
    </div>
    <div class="grid grid-3-1">
      ${card('Recent Stock Movements', '<div id="tb-mov"></div>', { cls: 'flush', actions: `<a class="btn btn-ghost btn-sm" href="#/movements">All movements ${icon('arrow-right')}</a>` })}
      ${card('Fast Moving Medicines', '<div id="fast"></div>', { sub: 'Units issued in the last 30 days' })}
    </div>
    <div class="grid grid-1-2">
      ${card('GRN Status', '<div class="chart-box sm"><canvas id="ch-grn"></canvas></div>')}
      ${card('Recent Stock Receipts', '<div id="tb-grn"></div>', { cls: 'flush', actions: `<a class="btn btn-ghost btn-sm" href="#/grn">All GRNs ${icon('arrow-right')}</a>` })}
    </div>`;

  // charts
  const io = monthlyInOut(6);
  chart(view.querySelector('#ch-inout'), { type: 'bar', data: { labels: io.labels, datasets: [
    { label: 'Stock In', data: io.inn, backgroundColor: '#049794', borderRadius: 6, maxBarThickness: 28 },
    { label: 'Stock Out', data: io.out, backgroundColor: '#023459', borderRadius: 6, maxBarThickness: 28 }] },
  options: { scales: { y: { beginAtZero: true, grid: { color: '#EEF2F5' } }, x: { grid: { display: false } } }, plugins: { legend: { position: 'top', align: 'end' } } } });
  const cat = categoryDistribution();
  chart(view.querySelector('#ch-cat'), { type: 'doughnut', data: { labels: cat.map((c) => c[0]), datasets: [{ data: cat.map((c) => Math.round(c[1])), backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }] },
    options: { cutout: '62%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmtINR(c.raw, true)}` } } } } });
  const sc = grnKPIs().statusCounts;
  const order = ['DRAFT', 'VALIDATION_REQUIRED', 'SUBMITTED', 'PENDING_APPROVAL', 'POSTED', 'REJECTED', 'CANCELLED'];
  chart(view.querySelector('#ch-grn'), { type: 'bar', data: { labels: order.map((s) => s.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())), datasets: [{ data: order.map((s) => sc[s]), backgroundColor: ['#8FA3B3', '#E8A23A', '#3685C5', '#6E56CF', '#16A36A', '#D9534F', '#C3CED6'], borderRadius: 5 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#EEF2F5' } }, y: { grid: { display: false } } } } });

  // low stock
  const map = medicineStockMap();
  const low = store.all('medicines').filter((m) => m.active && stockStatus(m, map[m.id].available) !== 'IN_STOCK')
    .sort((a, b) => map[a.id].available / a.reorderLevel - map[b.id].available / b.reorderLevel).slice(0, 7);
  view.querySelector('#tb-low').innerHTML = low.length ? `<table class="table dense"><thead><tr><th>Medicine</th><th class="ta-right">Available</th><th>Level</th><th>Status</th></tr></thead><tbody>
    ${low.map((m) => { const a = map[m.id].available; const pct = Math.min(100, a / m.reorderLevel * 100); return `<tr class="clickable" onclick="location.hash='#/inventory/${m.id}'"><td><div class="cell-main">${esc(m.brandName)}</div><div class="cell-sub">${esc(m.genericName)}</div></td>
      <td class="ta-right"><span class="qty-pill">${fmtNum(a)}<small>/ ${m.reorderLevel} ${esc(m.unit)}</small></span></td><td style="width:110px"><div class="bar ${a === 0 ? 'danger' : 'warning'}"><span style="width:${pct}%"></span></div></td><td>${badge(stockStatus(m, a))}</td></tr>`; }).join('')}</tbody></table>`
    : emptyState('check-circle-2', 'No low-stock medicines', 'All medicines are above their reorder levels.');

  // expiry
  const exp = store.all('batches').filter((b) => ['NEAR_EXPIRY', 'EXPIRED'].includes(batchStatus(b))).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).slice(0, 7);
  view.querySelector('#tb-exp').innerHTML = exp.length ? `<table class="table dense"><thead><tr><th>Batch</th><th>Expiry</th><th class="ta-right">Qty</th><th>Status</th></tr></thead><tbody>
    ${exp.map((b) => { const d = daysUntil(b.expiryDate); return `<tr class="clickable" onclick="location.hash='#/batches/${b.id}'"><td><div class="cell-main mono">${esc(b.batchNo)}</div><div class="cell-sub">${esc(medName(b.medicineId))}</div></td>
      <td>${fmtDate(b.expiryDate)}<div class="cell-sub ${d < 0 ? 'text-danger' : 'text-warning'}">${d < 0 ? `${-d} days ago` : `in ${d} days`}</div></td><td class="ta-right">${fmtNum(batchBalance(b.id))}</td><td>${badge(batchStatus(b))}</td></tr>`; }).join('')}</tbody></table>`
    : emptyState('calendar-check', 'No expiry risks', 'No batch is within the expiry threshold.');

  // movements
  const mv = ledger().slice(-8).reverse();
  view.querySelector('#tb-mov').innerHTML = `<table class="table dense"><thead><tr><th>When</th><th>Medicine / Batch</th><th>Type</th><th class="ta-right">In</th><th class="ta-right">Out</th><th class="ta-right">Balance</th></tr></thead><tbody>
    ${mv.map((m) => `<tr><td class="cell-sub">${relTime(m.at)}</td><td><div class="cell-main">${esc(medName(m.medicineId))}</div><div class="cell-sub mono">${esc(store.get('batches', m.batchId)?.batchNo || '')} · ${esc(m.reference)}</div></td><td>${movementBadge(m.type)}</td>
      <td class="ta-right text-success">${m.qtyIn ? '+' + fmtNum(m.qtyIn) : ''}</td><td class="ta-right text-danger">${m.qtyOut ? '−' + fmtNum(m.qtyOut) : ''}</td><td class="ta-right strong">${fmtNum(m.newBalance)}</td></tr>`).join('')}</tbody></table>`;

  // fast movers
  const fm = fastMovers(30, 8); const max = fm[0]?.[1] || 1;
  view.querySelector('#fast').innerHTML = fm.length ? `<ul class="list-plain">${fm.map(([id, q]) => { const m = store.get('medicines', id); return `<li class="list-row"><div style="flex:1;min-width:0"><a href="#/inventory/${id}" class="cell-main">${esc(m.brandName)}</a><div class="bar mt-1"><span style="width:${q / max * 100}%"></span></div></div><span class="qty-pill">${fmtNum(q)}<small>${esc(m.unit)}</small></span></li>`; }).join('')}</ul>`
    : emptyState('activity', 'No issues in the last 30 days');

  // recent GRNs
  const rg = [...store.all('grns')].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 6);
  view.querySelector('#tb-grn').innerHTML = `<table class="table dense"><thead><tr><th>GRN</th><th>Supplier</th><th>Received</th><th class="ta-right">Value</th><th>Status</th></tr></thead><tbody>
    ${rg.map((x) => `<tr class="clickable" onclick="location.hash='#/grn/${x.id}'"><td class="cell-main">${esc(x.id)}</td><td>${esc(supplierName(x.supplierId))}<div class="cell-sub">by ${esc(userName(x.receivedBy))}</div></td><td>${fmtDate(x.receivedAt)}</td><td class="ta-right">${fmtINR(grnTotals(x).grand)}</td><td>${badge(x.status)}</td></tr>`).join('')}</tbody></table>`;
}
