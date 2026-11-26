// Management Dashboard (BRD 13): one screen for the Super Admin — patients & beds, doctor statistics, pharmacy & store,
// lab & MRD, and finance across every counter, with reconciliation alerts that point to leakage.
import { store } from '../data-service.js';
import { userName, inventoryKPIs, batchStatus, batchBalance } from '../calculations.js';
import { daySummary, businessDate, dailySalesSeries } from '../pharmacy-calc.js';
import { hospitalDaySummary, hbillBalance, serviceReconciliation, kitReconciliation, CATS, catLabel, isCritical } from '../hospital.js';
import { outsideShift } from '../shifts.js';
import { codingOverdue } from '../mrd.js';
import { kpi, chart, destroyCharts, PALETTE, emptyState } from '../components.js';
import { esc, icon, fmtINR, fmtNum, fmtDate, refreshIcons, ymd } from '../utils.js';

const shiftDay = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return ymd(x); };

export function render(view, params, query) {
  let date = query.date || businessDate();
  const draw = () => {
    destroyCharts();
    const ph = daySummary(date); const hb = hospitalDaySummary(date);
    const week = shiftDay(date, -6);
    const totalBilled = ph.sales + hb.billed;
    const cash = ph.byMode.CASH.net + hb.byMode.CASH; const upi = ph.byMode.UPI.net + hb.byMode.UPI; const card = ph.byMode.CARD.net + hb.byMode.CARD; const other = ph.byMode.OTHER.net + hb.byMode.OTHER;
    const credit = store.all('hbills').reduce((t, b) => t + hbillBalance(b), 0) + store.all('bills').filter((b) => b.status !== 'CANCELLED').reduce((t, b) => t + (b.balanceDue || 0), 0);
    const regToday = store.all('patients').filter((p) => (p.registeredAt || '').slice(0, 10) === date).length;
    const visitors = new Set([...store.all('hbills').filter((b) => b.businessDate === date).map((b) => b.patientId), ...store.all('bills').filter((b) => b.businessDate === date && b.patientId).map((b) => b.patientId)]).size;
    const admitted = store.all('medicalRecords').filter((r) => !r.dischargedAt).length;
    const discharges = store.all('medicalRecords').filter((r) => r.dischargedAt && businessDate(r.dischargedAt) === date).length;
    // doctor-wise
    const docs = {};
    store.all('hbills').filter((b) => b.businessDate >= week && b.businessDate <= date && b.status !== 'CANCELLED').forEach((b) => { const k = b.doctor || 'Self / walk-in'; (docs[k] ||= { svc: 0, rx: 0, n: 0, ph: 0 }); docs[k].svc += b.grandTotal; docs[k].n += 1; });
    store.all('bills').filter((b) => b.businessDate >= week && b.businessDate <= date && b.status !== 'CANCELLED' && b.doctor).forEach((b) => { (docs[b.doctor] ||= { svc: 0, rx: 0, n: 0, ph: 0 }); docs[b.doctor].ph += b.grandTotal; docs[b.doctor].rx += 1; });
    const docRows = Object.entries(docs).sort((a, b) => (b[1].svc + b[1].ph) - (a[1].svc + a[1].ph)).slice(0, 7);
    // lab & MRD
    const labToday = store.all('orders').filter((o) => o.category === 'LAB' && o.billId && businessDate(o.billedAt) === date);
    const labDone = labToday.filter((o) => o.status === 'COMPLETED').length;
    const kits = kitReconciliation(week, date); const kitGap = kits.reduce((t, r) => t + Math.max(0, r.unexplained) + r.countLoss, 0);
    const svcR = serviceReconciliation(week, date); const unbilled = svcR.unbilled.length;
    const crit = store.all('orders').filter((o) => o.category === 'LAB' && o.status === 'RESULTED' && isCritical(o)).length;
    const dsPending = store.all('dischargeSummaries').filter((d) => d.status !== 'FINAL').length; const coding = store.all('medicalRecords').filter(codingOverdue).length;
    // pharmacy & store
    const inv = inventoryKPIs();
    const nearExp = store.all('batches').filter((b) => batchStatus(b) === 'NEAR_EXPIRY' && batchBalance(b.id) > 0).length;
    const counts = store.all('stockCounts').filter((c) => c.businessDate >= week); const stockShort = counts.reduce((t, c) => t + (c.totals?.shortUnits || 0), 0);
    const shortCash = store.all('shifts').filter((s) => s.closedAt && s.startAt.slice(0, 10) >= week && s.difference < 0).reduce((t, s) => t - s.difference, 0);
    const outside = outsideShift(week, date).length;
    const alerts = [
      unbilled && { t: `${unbilled} service(s) advised but not billed`, s: 'Possible revenue leakage — bill or withdraw them', h: '#/services/reconciliation', tone: 'danger', ic: 'receipt' },
      kitGap && { t: `${kitGap} lab kit(s) not matched to a bill (7 days)`, s: 'Count shortage or tests run without a bill', h: '#/lab/stock?tab=recon', tone: 'danger', ic: 'flask-conical' },
      stockShort && { t: `${stockShort} medicine unit(s) short in daily counts (7 days)`, s: 'Medicine given without a bill?', h: '#/stock-count', tone: 'danger', ic: 'clipboard-x' },
      shortCash && { t: `Cash short ${fmtINR(shortCash)} across shifts (7 days)`, s: 'See the shift register', h: '#/shifts/register', tone: 'warning', ic: 'banknote' },
      outside && { t: `${outside} payment(s) taken outside a shift`, s: 'Every collection must belong to a shift', h: '#/shifts/register', tone: 'warning', ic: 'timer-off' },
      crit && { t: `${crit} critical lab result(s) waiting for verification`, s: 'Inform the doctor', h: '#/lab?stage=verify', tone: 'danger', ic: 'siren' },
      coding && { t: `${coding} medical record(s) overdue for coding`, s: `Due within ${store.hs().mrd.codingDueDays} days of discharge`, h: '#/mrd', tone: 'warning', ic: 'file-code-2' }
    ].filter(Boolean);

    view.innerHTML = `
      <div class="callout mb-2"><div class="grow"><h2>${fmtDate(date)} — whole hospital</h2><p class="small" style="color:#b9d0e0">Pharmacy, main counter, lab, services and records in one view. OP and IP figures appear when those modules go live.</p></div>
        <input type="date" class="input" style="width:auto" data-date value="${date}" max="${businessDate()}"></div>
      <div class="kpis kpis-5">
        ${kpi({ label: 'Total billed today', value: fmtINR(totalBilled, true), iconName: 'indian-rupee', tone: 'teal', sub: `Pharmacy ${fmtINR(ph.sales, true)} · Main counter ${fmtINR(hb.billed, true)}` })}
        ${kpi({ label: 'Cash', value: fmtINR(cash, true), iconName: 'banknote', tone: 'success', sub: 'Net of refunds' })}
        ${kpi({ label: 'UPI / online', value: fmtINR(upi + other, true), iconName: 'smartphone', tone: 'info' })}
        ${kpi({ label: 'Card', value: fmtINR(card, true), iconName: 'credit-card', tone: 'purple' })}
        ${kpi({ label: 'Credit outstanding', value: fmtINR(credit, true), iconName: 'hourglass', tone: 'warning', sub: 'All counters, all days', href: '#/hbills?status=DUE' })}</div>
      ${alerts.length ? `<section class="card mt-2"><header class="card-head"><h2>${icon('shield-alert')} Reconciliation alerts</h2><span class="muted small">Things that do not tally</span></header><div class="todo-list">${alerts.map((a) => `<a class="todo" href="${a.h}"><span class="todo-ic sev-${a.tone === 'danger' ? 'critical' : 'warning'}">${icon(a.ic)}</span><span class="todo-txt"><strong>${esc(a.t)}</strong><small>${esc(a.s)}</small></span><span class="btn btn-secondary btn-sm">Open</span></a>`).join('')}</div></section>` : `<div class="alert alert-success mt-2">${icon('shield-check')}<div><strong>Everything tallies.</strong> Stock, kits, services and cash match the bills for the last 7 days.</div></div>`}
      <div class="mgmt-grid mt-2">
        <section class="card"><header class="card-head"><h2>${icon('users-round')} Patients & beds</h2></header><div class="card-body mgmt-nums">
          <div><span>New registrations</span><strong>${fmtNum(regToday)}</strong></div><div><span>Patients billed today</span><strong>${fmtNum(visitors)}</strong></div>
          <div><span>OP visits</span><strong class="muted">—</strong><small>OP module</small></div><div><span>Admitted now</span><strong>${fmtNum(admitted)}</strong><small>from MRD files</small></div>
          <div><span>Discharges today</span><strong>${fmtNum(discharges)}</strong></div><div><span>Bed occupancy</span><strong class="muted">—</strong><small>IP module</small></div></div></section>
        <section class="card"><header class="card-head"><h2>${icon('stethoscope')} Doctor-wise (7 days)</h2></header>${docRows.length ? `<table class="table dense"><thead><tr><th>Doctor</th><th class="ta-right">Services billed</th><th class="ta-right">Prescriptions → pharmacy</th></tr></thead><tbody>${docRows.map(([d, x]) => `<tr><td>${esc(d)}</td><td class="ta-right">${fmtINR(x.svc, true)}<div class="cell-sub">${x.n} bill(s)</div></td><td class="ta-right">${fmtINR(x.ph, true)}<div class="cell-sub">${x.rx} bill(s)</div></td></tr>`).join('')}</tbody></table>` : emptyState('stethoscope', 'No data')}<p class="muted small card-pad">Consultation fees join this table when the OP module goes live.</p></section>
        <section class="card"><header class="card-head"><h2>${icon('pill')} Pharmacy & store</h2><a class="btn btn-ghost btn-sm" href="#/pharmacy">Details</a></header><div class="card-body mgmt-nums">
          <div><span>Purchases received</span><strong>${fmtINR(ph.purchases, true)}</strong></div><div><span>Sales (MRP)</span><strong>${fmtINR(ph.sales, true)}</strong></div>
          <div><span>Margin</span><strong>${fmtINR(ph.margin, true)}</strong><small>${ph.marginPct}%</small></div><div><span>Low / out of stock</span><strong>${fmtNum(inv.low + inv.out)}</strong></div>
          <div><span>Expiring soon</span><strong>${fmtNum(nearExp)}</strong><small>batches</small></div><div><span>Stock variance (7 days)</span><strong class="${stockShort ? 'text-danger' : ''}">${stockShort ? '−' + stockShort : '0'}</strong><small>units</small></div></div></section>
        <section class="card"><header class="card-head"><h2>${icon('flask-conical')} Lab & MRD</h2><a class="btn btn-ghost btn-sm" href="#/lab">Lab</a></header><div class="card-body mgmt-nums">
          <div><span>Tests billed today</span><strong>${fmtNum(labToday.length)}</strong></div><div><span>Reports released</span><strong>${fmtNum(labDone)}</strong></div>
          <div><span>Kits not matched (7 d)</span><strong class="${kitGap ? 'text-danger' : ''}">${fmtNum(kitGap)}</strong></div><div><span>Kit efficiency</span><strong>${kits.reduce((t, r) => t + r.total, 0) ? Math.round(kits.reduce((t, r) => t + r.performed, 0) / kits.reduce((t, r) => t + r.total, 0) * 100) : 100}%</strong></div>
          <div><span>Discharge summaries pending</span><strong>${fmtNum(dsPending)}</strong></div><div><span>Records to code</span><strong class="${coding ? 'text-danger' : ''}">${fmtNum(store.all('medicalRecords').filter((r) => r.dischargedAt && r.status !== 'FILED').length)}</strong></div></div></section>
      </div>
      <div class="grid grid-2 mt-2">
        <section class="card"><header class="card-head"><h2>Billing by category — today</h2><span class="muted small">9 BRD categories</span></header><div class="card-body">
          <table class="table dense"><tbody>${[['OP', 'OP consultation', 0, true], ['IP', 'IP billing', 0, true], ['PHARMACY', 'Pharmacy', ph.sales], ...CATS().map((c) => [c.code, c.label, hb.byCat[c.code] || 0])].map(([k, l, v, pend]) => `<tr><td>${esc(l)}</td><td class="ta-right">${pend ? '<span class="tag tag-neutral">Module pending</span>' : `<strong>${fmtINR(v, true)}</strong>`}</td></tr>`).join('')}
          <tr class="recon-total"><td>Total</td><td class="ta-right">${fmtINR(totalBilled, true)}</td></tr><tr><td class="muted">Discounts given</td><td class="ta-right">${fmtINR(ph.discounts + hb.discounts, true)}</td></tr><tr><td class="muted">Refunds</td><td class="ta-right">${fmtINR(ph.refunds + hb.refunds, true)}</td></tr></tbody></table></div></section>
        <section class="card"><header class="card-head"><h2>Last 14 days — billed</h2></header><div class="card-body"><div style="height:250px"><canvas data-c></canvas></div></div></section></div>`;
    const days = Array.from({ length: 14 }, (_, i) => shiftDay(date, i - 13));
    const phS = dailySalesSeries(14, date);
    chart(view.querySelector('[data-c]'), { type: 'bar', data: { labels: days.map((d) => d.slice(5)), datasets: [
      { label: 'Pharmacy', data: days.map((d) => phS.find((x) => x.date === d)?.sales ?? daySummary(d).sales), backgroundColor: PALETTE[0], stack: 's' },
      { label: 'Main counter', data: days.map((d) => hospitalDaySummary(d).billed), backgroundColor: PALETTE[1], stack: 's' }] }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } });
    view.querySelector('[data-date]').onchange = (e) => { date = e.target.value || businessDate(); draw(); };
    refreshIcons(view);
  };
  draw();
  return () => destroyCharts();
}
