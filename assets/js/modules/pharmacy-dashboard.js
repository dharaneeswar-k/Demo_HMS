// Pharmacy Dashboard — counter KPIs from bills/payments plus stock alerts from inventory.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { medicineStockMap, stockStatus, batchStatus, batchBalance, daysUntil, medName, userName } from '../calculations.js';
import { daySummary, businessDate, dailySalesSeries, hourlySeries, topSelling, outstandingBills, billModeLabel, closingFor, pendingClosings } from '../pharmacy-calc.js';
import { kpi, card, badge, chart, emptyState, destroyCharts } from '../components.js';
import { esc, icon, fmtINR, fmtNum, fmtDate, refreshIcons } from '../utils.js';
import { canDecideReturn } from '../pharmacy-services.js';

export function render(view, params, query) {
  const user = currentUser();
  let date = query.date || businessDate();
  const draw = () => {
    destroyCharts();
    const s = daySummary(date);
    const outstanding = outstandingBills();
    const myClose = closingFor(date, user.id);
    const tasks = [];
    const pc = store.all('cancellations').filter((c) => c.status === 'PENDING');
    const pr = store.all('pReturns').filter((r) => canDecideReturn(r, user));
    if (can('pharmacy.cancel') && pc.length) tasks.push(`<a class="chip" href="#/pharmacy/bills/${pc[0].billId}">${icon('circle-slash')}<strong>${pc.length}</strong> cancellation request(s)</a>`);
    if (pr.length) tasks.push(`<a class="chip" href="#/pharmacy/returns?focus=${pr[0].id}">${icon('undo-2')}<strong>${pr.length}</strong> refund(s) to verify</a>`);
    const myPend = pendingClosings().filter((p) => can('pharmacy.closing.all') || p.cashierId === user.id);
    if (myPend.length) tasks.push(`<a class="chip" href="#/pharmacy/closing?date=${myPend[0].date}&cashier=${myPend[0].cashierId}">${icon('calendar-x')}<strong>${myPend.length}</strong> pending closing(s)</a>`);
    view.innerHTML = `
      <div class="callout mb-2"><div class="grow"><h2>Pharmacy counter — ${fmtDate(date)}</h2><p class="small" style="color:#b9d0e0">${date === businessDate() ? 'Live business day' : 'Historical business day'} · ${myClose ? `your counter closed (${myClose.id})` : 'your counter is open'}</p></div>
        <div class="row"><input type="date" class="input" style="width:auto" data-date value="${date}" max="${businessDate()}">${can('pharmacy.bill') ? `<a class="btn btn-primary" href="#/pharmacy/bill">${icon('plus')}Pharmacy Sale</a>` : ''}<a class="btn btn-secondary" href="#/pharmacy/closing?date=${date}">${icon('lock')}Daily Closing</a></div></div>
      ${tasks.length ? `<div class="row mb-2">${tasks.join('')}</div>` : ''}
      <div class="kpis">
        ${kpi({ label: 'Total Pharmacy Sales', value: fmtINR(s.sales), iconName: 'indian-rupee', tone: 'teal', sub: `Net of returns ${fmtINR(s.netSales)}`, href: `#/pharmacy/bills?date=${date}` })}
        ${kpi({ label: 'Total Bills', value: fmtNum(s.liveBills), iconName: 'receipt', tone: 'navy', sub: `${s.billCount} incl. cancelled`, href: `#/pharmacy/bills?date=${date}` })}
        ${kpi({ label: 'Cash Collections', value: fmtINR(s.byMode.CASH.net), iconName: 'banknote', tone: 'success', sub: s.byMode.CASH.refunds ? `after ${fmtINR(s.byMode.CASH.refunds)} refunds` : '' })}
        ${kpi({ label: 'UPI / Online', value: fmtINR(s.byMode.UPI.net), iconName: 'smartphone', tone: 'info' })}
        ${kpi({ label: 'Card Collections', value: fmtINR(s.byMode.CARD.net), iconName: 'credit-card', tone: 'purple', sub: s.byMode.OTHER.net ? `Other ${fmtINR(s.byMode.OTHER.net)}` : '' })}
        ${kpi({ label: 'Pending Payments', value: fmtINR(s.pending), iconName: 'hourglass', tone: 'warning', sub: `All outstanding ${fmtINR(outstanding.reduce((t, b) => t + b.balanceDue, 0))}`, href: '#/pharmacy/bills?status=PENDING' })}
        ${kpi({ label: 'Medicines Dispensed', value: fmtNum(s.unitsDispensed), iconName: 'pill', tone: 'teal', sub: 'Units on active bills' })}
        ${kpi({ label: 'Cancelled Bills', value: fmtNum(s.cancelledBills), iconName: 'circle-slash', tone: 'danger', sub: fmtINR(s.cancelledValue), href: '#/pharmacy/bills?status=CANCELLED' })}
        ${kpi({ label: 'Returns & Refunds', value: fmtINR(s.refunds), iconName: 'undo-2', tone: 'warning', sub: `${s.returnCount} return(s) · ${fmtINR(s.returns)}`, href: '#/pharmacy/returns' })}
      </div>
      <section class="card mt-2"><header class="card-head"><div><h2>Purchase cost vs sales value</h2><p class="muted small">What the medicines sold today cost us (PTR) against what they were sold for — net of returns.</p></div><a class="btn btn-ghost btn-sm" href="#/reports?r=purchase-vs-sales">Daily report ${icon('arrow-right')}</a></header>
        <div class="card-body"><div class="pvs">
          <div><span>Stock received today</span><strong>${fmtINR(s.purchases, true)}</strong><small>Posted supplier invoices</small></div>
          <div><span>Cost of medicines sold</span><strong>${fmtINR(s.cost, true)}</strong><small>At purchase rate (PTR)</small></div>
          <div class="pvs-arrow">${icon('arrow-right')}</div>
          <div><span>Sold for (MRP)</span><strong>${fmtINR(s.salesIncGst, true)}</strong><small>${fmtINR(s.salesExGst, true)} excl. GST</small></div>
          <div class="pvs-margin"><span>Margin</span><strong>${fmtINR(s.margin, true)}</strong><small>${s.marginPct}% of sales excl. GST</small></div>
        </div>
        <div class="type-split mt-2">${[['PATIENT', 'Registered patients', 'id-card'], ['WALKIN', 'Walk-in customers', 'footprints']].map(([k, l, ic]) => `<div class="ts-item">${icon(ic)}<div><span>${l}</span><strong>${fmtINR(s.bySale[k].sales)}</strong><small>${s.bySale[k].bills} bill(s)</small></div></div>`).join('')}</div></div></section>
      <div class="grid grid-3-1">${card('Daily Sales — last 14 days', '<div class="chart-box"><canvas id="ph-daily"></canvas></div>')}${card('Payment Mode Distribution', '<div class="chart-box"><canvas id="ph-modes"></canvas></div>', { sub: 'Net collections for the day' })}</div>
      <div class="grid grid-3-1">${card('Hourly Billing Trend', '<div class="chart-box sm"><canvas id="ph-hour"></canvas></div>')}${card('Top-selling Medicines', '<div data-top></div>', { sub: 'Last 30 days by value' })}</div>
      ${card('Recent Pharmacy Bills', '<div data-recent></div>', { cls: 'flush mt-2', actions: `<a class="btn btn-ghost btn-sm" href="#/pharmacy/bills">All bills ${icon('arrow-right')}</a>` })}
      <div class="grid grid-3">${card('Low-stock Medicines', '<div data-low></div>', { cls: 'flush' })}${card('Out-of-stock Medicines', '<div data-oos></div>', { cls: 'flush' })}${card('Near-expiry Batch Alerts', '<div data-nex></div>', { cls: 'flush' })}</div>`;
    view.querySelector('[data-date]').onchange = (e) => { date = e.target.value || businessDate(); draw(); };
    const ds = dailySalesSeries(14, date);
    chart(view.querySelector('#ph-daily'), { type: 'bar', data: { labels: ds.map((x) => fmtDate(x.date).slice(0, 6)), datasets: [
      { type: 'bar', label: 'Sales (₹)', data: ds.map((x) => x.sales), backgroundColor: ds.map((x) => (x.date === date ? '#023459' : '#049794')), borderRadius: 6, yAxisID: 'y' },
      { type: 'line', label: 'Bills', data: ds.map((x) => x.bills), borderColor: '#E8A23A', backgroundColor: '#E8A23A', tension: 0.3, yAxisID: 'y1', pointRadius: 3 }] },
    options: { scales: { y: { beginAtZero: true, ticks: { callback: (v) => '₹' + fmtNum(v) } }, y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { precision: 0 } }, x: { grid: { display: false } } }, plugins: { legend: { position: 'top', align: 'end' } } } });
    const modes = ['CASH', 'UPI', 'CARD', 'OTHER'].filter((m) => s.byMode[m].net > 0);
    chart(view.querySelector('#ph-modes'), { type: 'doughnut', data: { labels: modes.map((m) => m[0] + m.slice(1).toLowerCase()), datasets: [{ data: modes.map((m) => s.byMode[m].net), backgroundColor: ['#16A36A', '#3685C5', '#6E56CF', '#E8A23A'], borderColor: '#fff', borderWidth: 2 }] },
      options: { cutout: '60%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmtINR(c.raw)}` } } } } });
    const hs = hourlySeries(date); const hrs = Array.from({ length: 15 }, (_, i) => i + 8);
    chart(view.querySelector('#ph-hour'), { type: 'line', data: { labels: hrs.map((h) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`), datasets: [{ label: 'Bills', data: hrs.map((h) => hs[h].bills), borderColor: '#049794', backgroundColor: 'rgba(4,151,148,.12)', fill: true, tension: 0.3 }, { label: 'Sales ₹', data: hrs.map((h) => hs[h].sales), borderColor: '#023459', yAxisID: 'y1', tension: 0.3, pointRadius: 2 }] },
      options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, y1: { beginAtZero: true, position: 'right', grid: { display: false } }, x: { grid: { display: false } } }, plugins: { legend: { position: 'top', align: 'end' } } } });
    const top = topSelling(30, 8); const max = top[0]?.[1].value || 1;
    view.querySelector('[data-top]').innerHTML = top.length ? `<ul class="list-plain">${top.map(([id, x]) => `<li class="list-row"><div style="flex:1;min-width:0"><a class="cell-main" href="#/inventory/${id}">${esc(medName(id))}</a><div class="bar mt-1"><span style="width:${x.value / max * 100}%"></span></div></div><div class="ta-right"><strong>${fmtINR(x.value, true)}</strong><div class="cell-sub">${fmtNum(x.qty)} units</div></div></li>`).join('')}</ul>` : emptyState('pill', 'No sales yet');
    const recent = [...store.all('bills')].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
    view.querySelector('[data-recent]').innerHTML = `<table class="table dense"><thead><tr><th>Bill</th><th>Time</th><th>Customer</th><th>Patient ID</th><th>Cashier</th><th>Mode</th><th class="ta-right">Amount</th><th>Status</th></tr></thead><tbody>${recent.map((b) => `<tr class="clickable" onclick="location.hash='#/pharmacy/bills/${b.id}'"><td class="mono strong">${b.id}</td><td>${new Date(b.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(b.patientName)}</td><td class="mono small">${esc(b.uhid || 'Walk-in')}</td><td>${esc(userName(b.cashierId))}</td><td class="small">${esc(billModeLabel(b))}</td><td class="ta-right strong">${fmtINR(b.grandTotal)}</td><td>${badge(b.status)}</td></tr>`).join('')}</tbody></table>`;
    const map = medicineStockMap(); const meds = store.all('medicines').filter((m) => m.active);
    const list = (rows, empty) => (rows.length ? `<ul class="list-plain" style="padding:0 16px">${rows.join('')}</ul>` : emptyState('check-circle-2', empty));
    view.querySelector('[data-low]').innerHTML = list(meds.filter((m) => stockStatus(m, map[m.id].available) === 'LOW_STOCK').map((m) => `<li class="list-row"><a href="#/inventory/${m.id}">${esc(m.brandName)}</a><span class="text-warning strong">${map[m.id].available} / ${m.reorderLevel}</span></li>`), 'No low-stock medicines');
    view.querySelector('[data-oos]').innerHTML = list(meds.filter((m) => stockStatus(m, map[m.id].available) === 'OUT_OF_STOCK').map((m) => `<li class="list-row"><a href="#/inventory/${m.id}">${esc(m.brandName)}</a>${badge('OUT_OF_STOCK')}</li>`), 'Nothing out of stock');
    view.querySelector('[data-nex]').innerHTML = list(store.all('batches').filter((b) => ['NEAR_EXPIRY', 'EXPIRED'].includes(batchStatus(b))).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).slice(0, 8).map((b) => `<li class="list-row"><div><a class="mono" href="#/batches/${b.id}">${esc(b.batchNo)}</a><div class="cell-sub">${esc(medName(b.medicineId))} · ${batchBalance(b.id)} units</div></div><span class="${daysUntil(b.expiryDate) < 0 ? 'text-danger' : 'text-warning'} small strong">${daysUntil(b.expiryDate) < 0 ? 'Expired' : daysUntil(b.expiryDate) + ' d'}</span></li>`), 'No expiry risks');
    refreshIcons(view);
  };
  draw();
}
