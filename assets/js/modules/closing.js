// Daily pharmacy closing (counter reconciliation) and the owner's Daily Closing Report.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { userName } from '../calculations.js';
import { daySummary, businessDate, closingFor, pendingClosings, modeLabel, billModeLabel, PAY_MODES } from '../pharmacy-calc.js';
import { submitClosing, correctClosing, verifyClosing, closingExpected } from '../pharmacy-services.js';
import { badge, card, kpi, dataTable, tabs, emptyState, openModal, confirmDialog, downloadCSV } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, fmtDate, fmtDateTime, ymd, refreshIcons } from '../utils.js';
import { r2 } from '../pricing.js';

const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

export function render(view, params, query) {
  const user = currentUser();
  const all = can('pharmacy.closing.all');
  let date = query.date || businessDate();
  let cashier = query.cashier && all ? query.cashier : user.id;
  const draw = () => {
    const existing = closingFor(date, cashier);
    view.innerHTML = `
      <div class="page-head"><div><p class="muted">Totals are calculated from the business day's actual bills and payment transactions. Business day starts at <strong>${String(store.ph().businessDayStartHour).padStart(2, '0')}:00</strong> (configurable).</p></div>
        <div class="page-actions"><div class="row"><span class="filter-label">Business date</span><input type="date" class="input" data-date value="${date}" max="${businessDate()}">
        <span class="filter-label">Cashier</span><select class="input" data-cashier ${all ? '' : 'disabled'}>${store.all('users').filter((u) => u.role !== 'SUPER_ADMIN' || u.id === cashier).map((u) => `<option value="${u.id}" ${u.id === cashier ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div></div></div>
      ${pendingBanner(user, all)}
      <div data-body></div>`;
    view.querySelector('[data-date]').onchange = (e) => { date = e.target.value || businessDate(); draw(); };
    view.querySelector('[data-cashier]').onchange = (e) => { cashier = e.target.value; draw(); };
    view.querySelectorAll('[data-jump]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); [date, cashier] = a.dataset.jump.split('|'); draw(); }; });
    const body = view.querySelector('[data-body]');
    existing ? closedView(body, existing, user, draw) : openForm(body, date, cashier, user, draw);
    refreshIcons(view);
  };
  draw();
}

function pendingBanner(user, all) {
  const p = pendingClosings().filter((x) => all || x.cashierId === user.id).slice(0, 6);
  if (!p.length) return '';
  return `<div class="alert alert-warning mb-2">${icon('calendar-x')}<div><strong>${p.length} earlier counter(s) not closed:</strong> ${p.map((x) => `<a href="#" data-jump="${x.date}|${x.cashierId}">${fmtDate(x.date)} · ${esc(userName(x.cashierId))}</a>`).join(' · ')}</div></div>`;
}

function summaryKPIs(s) {
  return `<div class="kpis">
    ${kpi({ label: 'Total Bills', value: fmtNum(s.billCount), iconName: 'receipt', tone: 'navy', sub: `${s.liveBills} active` })}
    ${kpi({ label: 'Total Sales', value: fmtINR(s.sales), iconName: 'indian-rupee', tone: 'teal', sub: `Gross ${fmtINR(s.gross, true)} · disc ${fmtINR(s.discounts, true)}` })}
    ${kpi({ label: 'Cash Sales', value: fmtINR(s.byMode.CASH.payments), iconName: 'banknote', tone: 'success' })}
    ${kpi({ label: 'UPI Sales', value: fmtINR(s.byMode.UPI.payments), iconName: 'smartphone', tone: 'info' })}
    ${kpi({ label: 'Card Sales', value: fmtINR(s.byMode.CARD.payments), iconName: 'credit-card', tone: 'purple' })}
    ${kpi({ label: 'Other Payments', value: fmtINR(s.byMode.OTHER.payments), iconName: 'wallet', tone: 'navy' })}
    ${kpi({ label: 'Split Payments', value: `${s.splitBills} bill(s)`, iconName: 'split', tone: 'teal', sub: fmtINR(s.splitValue) })}
    ${kpi({ label: 'Pending Payments', value: fmtINR(s.pending), iconName: 'hourglass', tone: 'warning' })}
    ${kpi({ label: 'Cancelled Bills', value: fmtNum(s.cancelledBills), iconName: 'circle-slash', tone: 'danger', sub: fmtINR(s.cancelledValue) })}
    ${kpi({ label: 'Returns', value: fmtINR(s.returns), iconName: 'undo-2', tone: 'warning', sub: `${s.returnCount} return(s)` })}
    ${kpi({ label: 'Refunds Paid', value: fmtINR(s.refunds), iconName: 'arrow-up-from-line', tone: 'danger', sub: 'Incl. cancellations' })}
    ${kpi({ label: 'Net Collection', value: fmtINR(s.netCollection), iconName: 'sigma', tone: 'success', sub: 'Payments − refunds' })}
  </div>
  <div class="type-split mt-2">${[['PATIENT', 'Registered patients', 'id-card'], ['WALKIN', 'Walk-in customers', 'footprints']].map(([k, l, ic]) => `<div class="ts-item">${icon(ic)}<div><span>${l}</span><strong>${fmtINR(s.bySale[k].sales)}</strong><small>${s.bySale[k].bills} bill(s)</small></div></div>`).join('')}</div>`;
}
function txnTable(s) {
  if (!s.transactions.length && !s.bills.length) return emptyState('receipt', 'No transactions on this business day');
  return `<div class="table-scroll" style="max-height:360px"><table class="table dense"><thead><tr><th>Time</th><th>Txn</th><th>Bill</th><th>Type</th><th>Mode</th><th>Reference</th><th class="ta-right">Amount</th></tr></thead><tbody>
    ${[...s.transactions].sort((a, b) => a.at.localeCompare(b.at)).map((p) => `<tr><td>${new Date(p.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td><td class="mono small">${p.id}</td><td><a class="mono" href="#/pharmacy/bills/${p.billId}">${p.billId}</a></td>
      <td>${p.kind === 'REFUND' ? `<span class="tag tag-danger">REFUND</span><div class="cell-sub">${esc(p.note)}</div>` : '<span class="tag tag-success">PAYMENT</span>'}</td><td>${esc(modeLabel(p.mode))}</td><td class="mono small">${esc(p.reference || '')}</td><td class="ta-right strong ${p.kind === 'REFUND' ? 'text-danger' : ''}">${p.kind === 'REFUND' ? '−' : ''}${fmtINR(p.amount)}</td></tr>`).join('')}</tbody></table></div>
    ${s.bills.some((b) => b.paymentStatus !== 'PAID' && b.status !== 'CANCELLED') ? `<div class="alert alert-warning" style="margin:12px">${icon('hourglass')}<div>Bills with pending balance: ${s.bills.filter((b) => b.paymentStatus !== 'PAID' && b.status !== 'CANCELLED').map((b) => `<a href="#/pharmacy/bills/${b.id}">${b.id}</a> (${esc(billModeLabel(b))})`).join(', ')}</div></div>` : ''}`;
}

function openForm(host, date, cashier, user, redraw) {
  const s0 = daySummary(date, cashier);
  const mine = cashier === user.id || can('pharmacy.closing.all');
  const isToday = date === businessDate();
  let float = store.ph().openingCashFloat;
  host.innerHTML = `${summaryKPIs(s0)}
    <div class="grid grid-3-1 mt-2">
      ${card(`Day's Transactions — ${esc(userName(cashier))}, ${fmtDate(date)}`, txnTable(s0), { cls: 'flush', actions: `<a class="btn btn-ghost btn-sm" href="#/pharmacy/bills?date=${date}&cashier=${cashier}">Bills ${icon('arrow-right')}</a>` })}
      ${card('Cash Denomination Counter', `<div class="denoms">${DENOMS.map((d) => `<div class="denom"><span>₹${d}</span><span>×</span><input class="input input-sm" type="number" min="0" step="1" data-den="${d}" placeholder="0"><span class="ta-right" data-dv="${d}">₹0</span></div>`).join('')}</div>
        <div class="kv mt-1"><span>Counted total</span><strong data-dtotal>₹0</strong></div><button class="btn btn-secondary btn-sm btn-block mt-1" data-usecount>${icon('arrow-down')}Use as actual cash</button>`)}
    </div>
    <section class="card mt-2"><header class="card-head"><div><h2>Closing Reconciliation</h2><p class="muted small">Enter what was physically counted and confirmed against the UPI app / card terminal settlement.</p></div>${isToday ? '<span class="tag tag-warning">Closing today locks further billing for this counter</span>' : ''}</header>
      <div class="card-body"><div class="table-scroll"><table class="table recon"><thead><tr><th>Mode</th><th class="ta-right">Recorded payments</th><th class="ta-right">Refunds</th><th class="ta-right">Opening float</th><th class="ta-right">Expected</th><th style="width:180px">Actual / Confirmed</th><th class="ta-right">Difference</th></tr></thead><tbody>
        ${PAY_MODES.map((m) => `<tr><td class="strong">${m === 'CASH' ? 'Cash' : m === 'UPI' ? 'UPI' : m === 'CARD' ? 'Card' : 'Other'}<div class="cell-sub">${m === 'CASH' ? 'Actual cash counted' : m === 'OTHER' ? 'Other recorded collections' : `Confirmed ${m} amount`}</div></td>
          <td class="ta-right">${fmtINR(s0.byMode[m].payments)}</td><td class="ta-right text-danger">${s0.byMode[m].refunds ? '−' + fmtINR(s0.byMode[m].refunds) : '—'}</td>
          <td class="ta-right">${m === 'CASH' ? `<input class="input input-sm ta-right" style="width:100px" type="number" min="0" step="1" data-float value="${float}">` : '—'}</td>
          <td class="ta-right strong" data-exp="${m}"></td><td><input class="input ta-right" type="number" min="0" step="0.01" data-act="${m}" placeholder="0.00"></td><td class="ta-right strong" data-diff="${m}">—</td></tr>`).join('')}
        <tr class="recon-total"><td>Total</td><td class="ta-right">${fmtINR(s0.collections)}</td><td class="ta-right text-danger">${s0.refunds ? '−' + fmtINR(s0.refunds) : '—'}</td><td></td><td class="ta-right" data-texp></td><td class="ta-right" data-tact></td><td class="ta-right" data-tdiff></td></tr></tbody></table></div>
        <div class="form-grid mt-2"><div class="field col-8"><label>Closing remarks <span class="muted small">(required when there is a difference)</span></label><textarea class="input" rows="2" data-remarks placeholder="e.g. Counter balanced / ₹50 short — recounted twice"></textarea></div>
          <div class="col-4"><div class="summary-box"><div class="summary-row"><span>Total expected</span><b data-sexp></b></div><div class="summary-row"><span>Total actual</span><b data-sact></b></div><div class="summary-row total"><span>Difference</span><span data-sdiff></span></div></div></div></div>
        <div class="row mt-2" style="justify-content:flex-end"><button class="btn btn-secondary" data-fill>${icon('copy-check')}Fill confirmed = recorded (non-cash)</button><button class="btn btn-primary btn-lg" data-submit ${mine ? '' : 'disabled'}>${icon('lock')}Submit Daily Closing</button></div></div></section>`;
  const $ = (q) => host.querySelector(q);
  const recalc = () => {
    const { expected } = closingExpected(date, cashier, float);
    let te = 0; let ta = 0; let allEntered = true;
    PAY_MODES.forEach((m) => {
      te = r2(te + expected[m]); host.querySelector(`[data-exp="${m}"]`).textContent = fmtINR(expected[m]);
      const v = host.querySelector(`[data-act="${m}"]`).value; if (v === '') allEntered = false;
      const a = r2(v || 0); ta = r2(ta + a);
      const dEl = host.querySelector(`[data-diff="${m}"]`); const diff = r2(a - expected[m]);
      dEl.textContent = v === '' ? '—' : (diff > 0 ? '+' : '') + fmtINR(diff); dEl.className = 'ta-right strong ' + (v === '' ? '' : Math.abs(diff) < 0.005 ? 'text-success' : 'text-danger');
    });
    const td = r2(ta - te);
    $('[data-texp]').textContent = fmtINR(te); $('[data-tact]').textContent = fmtINR(ta); $('[data-tdiff]').textContent = (td > 0 ? '+' : '') + fmtINR(td);
    $('[data-sexp]').textContent = fmtINR(te); $('[data-sact]').textContent = fmtINR(ta); $('[data-sdiff]').textContent = allEntered ? (td > 0 ? '+' : '') + fmtINR(td) : 'enter all amounts';
  };
  host.querySelectorAll('[data-act]').forEach((i) => { i.oninput = recalc; });
  $('[data-float]').oninput = (e) => { float = Number(e.target.value) || 0; recalc(); };
  const dcount = () => { let t = 0; host.querySelectorAll('[data-den]').forEach((i) => { const v = (Number(i.value) || 0) * Number(i.dataset.den); t += v; host.querySelector(`[data-dv="${i.dataset.den}"]`).textContent = fmtINR(v, true); }); $('[data-dtotal]').textContent = fmtINR(t, true); return t; };
  host.querySelectorAll('[data-den]').forEach((i) => { i.oninput = dcount; });
  $('[data-usecount]').onclick = () => { $('[data-act="CASH"]').value = dcount(); recalc(); };
  $('[data-fill]').onclick = () => { const { expected } = closingExpected(date, cashier, float); ['UPI', 'CARD', 'OTHER'].forEach((m) => { $(`[data-act="${m}"]`).value = expected[m]; }); recalc(); };
  $('[data-submit]').onclick = async () => {
    const actual = Object.fromEntries(PAY_MODES.map((m) => [m, $(`[data-act="${m}"]`).value]));
    if (PAY_MODES.some((m) => actual[m] === '')) { toast('Enter the actual / confirmed amount for every mode (0 if none).', 'error'); return; }
    const { expected } = closingExpected(date, cashier, float);
    const cd = r2(Number(actual.CASH) - expected.CASH);
    if (!(await confirmDialog({ title: `Submit closing for ${fmtDate(date)}?`, iconName: 'lock', confirmLabel: 'Submit Daily Closing',
      message: `Cashier <strong>${esc(userName(cashier))}</strong>. Cash expected ${fmtINR(expected.CASH)}, counted ${fmtINR(actual.CASH)} (${cd >= 0 ? '+' : ''}${fmtINR(cd)}).<br>The closing will be locked; corrections need a manager and are audited. The owner will be notified.${date === businessDate() ? '<br><strong>Billing for this counter will be locked for today.</strong>' : ''}` }))) return;
    try { const c = submitClosing({ date, cashierId: cashier, openingFloat: float, actual, remarks: $('[data-remarks]').value }, user); toast(`Daily closing ${c.id} submitted. Owner notified.`); redraw(); } catch (e) { toast(e.message, 'error'); }
  };
  recalc();
}

function closingRows(c) { return store.all('closingPayments').filter((p) => p.closingId === c.id); }
function closingDetail(c) {
  const rows = closingRows(c); const live = daySummary(c.businessDate, c.cashierId);
  const liveNet = PAY_MODES.map((m) => live.byMode[m].net); const snapNet = rows.map((r) => r2(r.recorded - r.refunds));
  const drift = PAY_MODES.some((m, i) => Math.abs(liveNet[i] - snapNet[i]) > 0.005);
  return `<div class="row mb-2">${badge(c.status, c.status === 'SUBMITTED' ? 'Submitted' : undefined)}${Math.abs(c.cashDifference) > store.ph().cashVarianceTolerance ? '<span class="tag tag-danger">Cash variance</span>' : ''}<span class="muted small">Submitted by ${esc(userName(c.submittedBy))} on ${fmtDateTime(c.submittedAt)}${c.verifiedBy ? ` · verified by ${esc(userName(c.verifiedBy))}` : ''}</span></div>
    <div class="alert ${drift ? 'alert-danger' : 'alert-success'} mb-2">${icon(drift ? 'alert-octagon' : 'check-circle-2')}<div>${drift ? 'Transactions for this day have changed since the closing was submitted — review required.' : 'Reconciles: the recorded totals match the current payment transactions for this day.'}</div></div>
    <table class="table dense recon"><thead><tr><th>Mode</th><th class="ta-right">Recorded</th><th class="ta-right">Refunds</th><th class="ta-right">Expected</th><th class="ta-right">Actual</th><th class="ta-right">Difference</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="strong">${esc(modeLabel(r.mode))}</td><td class="ta-right">${fmtINR(r.recorded)}</td><td class="ta-right">${r.refunds ? '−' + fmtINR(r.refunds) : '—'}</td><td class="ta-right">${fmtINR(r.expected)}${r.mode === 'CASH' ? `<div class="cell-sub">incl. float ${fmtINR(c.openingFloat)}</div>` : ''}</td><td class="ta-right strong">${fmtINR(r.actual)}</td><td class="ta-right strong ${Math.abs(r.difference) > 0.005 ? 'text-danger' : 'text-success'}">${r.difference > 0 ? '+' : ''}${fmtINR(r.difference)}</td></tr>`).join('')}
      <tr class="recon-total"><td>Total</td><td></td><td></td><td class="ta-right">${fmtINR(c.totalExpected)}</td><td class="ta-right">${fmtINR(c.totalActual)}</td><td class="ta-right">${c.totalDifference > 0 ? '+' : ''}${fmtINR(c.totalDifference)}</td></tr></tbody></table>
    <div class="grid grid-2 mt-2"><div>${[...(c.summary.bySale ? [['Registered patient sales', fmtINR(c.summary.bySale.PATIENT.sales)], ['Walk-in sales', fmtINR(c.summary.bySale.WALKIN.sales)]] : []), ['Bills', c.summary.bills], ['Cancelled bills', c.summary.cancelledBills], ['Gross sales', fmtINR(c.summary.gross)], ['Discounts', fmtINR(c.summary.discounts)], ['Sales', fmtINR(c.summary.sales)], ['Returns', fmtINR(c.summary.returns)], ['Refunds', fmtINR(c.summary.refunds)], ['Net sales', fmtINR(c.summary.netSales)], ['Pending', fmtINR(c.summary.pending)]].map(([k, v]) => `<div class="kv"><span>${k}</span><strong>${v}</strong></div>`).join('')}</div>
      <div><div class="section-title">Remarks</div><p>${esc(c.remarks || '—')}</p>${c.corrections.length ? `<div class="section-title mt-2">Correction history</div>${c.corrections.map((x) => `<div class="small mb-2"><strong>${esc(userName(x.by))}</strong> · ${fmtDateTime(x.at)}<br>${esc(x.reason)}<br><span class="muted">${PAY_MODES.filter((m) => x.before[m] !== x.after[m]).map((m) => `${m}: ${fmtINR(x.before[m])} → ${fmtINR(x.after[m])}`).join(', ')}</span></div>`).join('')}` : ''}</div></div>`;
}

function closedView(host, c, user, redraw) {
  const s = daySummary(c.businessDate, c.cashierId);
  host.innerHTML = `<div class="alert alert-teal mb-2">${icon('lock')}<div><strong>Counter closed — ${esc(c.id)}.</strong> This closing is locked. ${can('pharmacy.closing.correct') ? 'Authorised corrections are recorded in the audit log.' : 'Contact the Pharmacy Manager for corrections.'}</div></div>
    ${summaryKPIs(s)}
    <section class="card mt-2"><header class="card-head"><h2>Submitted Reconciliation</h2><div class="card-actions">${can('pharmacy.closing.correct') ? `<button class="btn btn-secondary btn-sm" data-correct>${icon('pencil')}Authorised correction</button>` : ''}${can('pharmacy.closing.verify') && c.status !== 'VERIFIED' ? `<button class="btn btn-primary btn-sm" data-verify>${icon('shield-check')}Verify</button>` : ''}<button class="btn btn-ghost btn-sm" onclick="window.print()">${icon('printer')}Print</button></div></header><div class="card-body">${closingDetail(c)}</div></section>`;
  host.querySelector('[data-correct]')?.addEventListener('click', () => correctionDialog(c, user, redraw));
  host.querySelector('[data-verify]')?.addEventListener('click', async () => { if (await confirmDialog({ title: 'Verify closing?', message: 'Marks the reconciliation as reviewed by the owner.', confirmLabel: 'Verify', iconName: 'shield-check' })) { verifyClosing(c.id, user); toast('Closing verified.'); redraw(); } });
}
function correctionDialog(c, user, done) {
  const rows = closingRows(c);
  openModal({ title: `Authorised correction — ${c.id}`, subtitle: 'Only actual / confirmed amounts can be corrected. Expected values come from transactions and cannot be edited.', size: 'md',
    body: `<div class="form-grid">${rows.map((r) => `<div class="field col-6"><label>${esc(modeLabel(r.mode))} actual (expected ${fmtINR(r.expected)})</label><input class="input" type="number" step="0.01" min="0" data-m="${r.mode}" value="${r.actual}"></div>`).join('')}
      <div class="field col-12"><label>Reason <span class="req">*</span></label><textarea class="input" rows="2" data-reason placeholder="e.g. ₹100 note found in the UPI scanner tray during next-day audit"></textarea></div></div>`,
    footer: [{ label: 'Cancel', onClick: (x) => x() }, { label: 'Save correction', cls: 'btn-primary', onClick: (close, w) => {
      try { correctClosing(c.id, { actual: Object.fromEntries([...w.querySelectorAll('[data-m]')].map((i) => [i.dataset.m, i.value])), reason: w.querySelector('[data-reason]').value }, user); toast('Correction saved and audited. Owner notified.'); close(); done(); } catch (e) { toast(e.message, 'error'); }
    } }] });
}

// =====================================================================
// DAILY CLOSING REPORT (owner / manager)
// =====================================================================
export function renderReport(view, params, query) {
  const user = currentUser();
  let tab = query.focus ? 'all' : 'all';
  const f = { from: '', to: '', staff: '' };
  view.innerHTML = `<div class="page-head"><div><p class="muted">Every closing is compared live with the recorded payment transactions so variances and late changes are visible.</p></div>
      <div class="page-actions"><button class="btn btn-secondary" data-csv>${icon('download')}Export CSV</button><button class="btn btn-secondary" onclick="window.print()">${icon('printer')}Print</button></div></div>
    <div class="kpis mb-2" data-kpis></div>
    <section class="card"><div data-tabs></div><div class="toolbar"><span class="filter-label">From</span><input type="date" class="input" data-f="from"><span class="filter-label">To</span><input type="date" class="input" data-f="to">
      <select class="input" data-f="staff"><option value="">All staff</option>${store.all('users').map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div><div data-body></div></section>`;
  const tol = store.ph().cashVarianceTolerance;
  const inRange = (d) => (!f.from || d >= f.from) && (!f.to || d <= f.to);
  const rowsAll = () => [...store.all('closings')].filter((c) => inRange(c.businessDate) && (!f.staff || c.cashierId === f.staff)).sort((a, b) => b.businessDate.localeCompare(a.businessDate) || a.cashierId.localeCompare(b.cashierId));
  const pm = (c, m) => closingRows(c).find((r) => r.mode === m);
  const cols = [
    { key: 'businessDate', label: 'Closing Date', render: (c) => `<button class="link strong" data-view="${c.id}">${fmtDate(c.businessDate)}</button><div class="cell-sub mono">${c.id}</div>`, csv: (c) => c.businessDate },
    { key: 'staff', label: 'Pharmacy Staff', value: (c) => userName(c.cashierId), render: (c) => esc(userName(c.cashierId)) },
    { key: 'bills', label: 'Bills', align: 'right', value: (c) => c.summary.bills, render: (c) => c.summary.bills },
    { key: 'gross', label: 'Gross Sales', align: 'right', value: (c) => c.summary.gross, render: (c) => fmtINR(c.summary.gross, true) },
    { key: 'disc', label: 'Discounts', align: 'right', value: (c) => c.summary.discounts, render: (c) => fmtINR(c.summary.discounts, true) },
    { key: 'ret', label: 'Returns', align: 'right', value: (c) => c.summary.returns, render: (c) => fmtINR(c.summary.returns, true) },
    { key: 'ref', label: 'Refunds', align: 'right', value: (c) => c.summary.refunds, render: (c) => fmtINR(c.summary.refunds, true) },
    { key: 'net', label: 'Net Sales', align: 'right', value: (c) => c.summary.netSales, render: (c) => `<strong>${fmtINR(c.summary.netSales, true)}</strong>` },
    { key: 'optype', label: 'Patients / Walk-in', sortable: false, render: (c) => (c.summary.bySale ? `<span class="small">${fmtINR(c.summary.bySale.PATIENT.sales, true)} / ${fmtINR(c.summary.bySale.WALKIN.sales, true)}</span>` : '—') },
    ...PAY_MODES.map((m) => ({ key: m, label: m === 'OTHER' ? 'Other' : m === 'CASH' ? 'Cash' : m === 'CARD' ? 'Card' : 'UPI', align: 'right', value: (c) => pm(c, m)?.recorded || 0, render: (c) => fmtINR(pm(c, m)?.recorded || 0, true) })),
    { key: 'expectedCash', label: 'Expected Cash', align: 'right', render: (c) => fmtINR(c.expectedCash, true) },
    { key: 'actualCash', label: 'Actual Cash', align: 'right', render: (c) => fmtINR(c.actualCash, true) },
    { key: 'cashDifference', label: 'Cash Variance', align: 'right', render: (c) => `<strong class="${Math.abs(c.cashDifference) > tol ? 'text-danger' : Math.abs(c.cashDifference) > 0 ? 'text-warning' : 'text-success'}">${c.cashDifference > 0 ? '+' : ''}${fmtINR(c.cashDifference)}</strong>` },
    { key: 'status', label: 'Status', render: (c) => badge(c.status, c.status === 'SUBMITTED' ? 'Submitted' : undefined) }
  ];
  const draw = () => {
    const rows = rowsAll(); const pend = pendingClosings().filter((p) => inRange(p.date) && (!f.staff || p.cashierId === f.staff));
    const variance = rows.filter((c) => Math.abs(c.cashDifference) > 0.005);
    tabs(view.querySelector('[data-tabs]'), [{ id: 'all', label: 'All Closings', count: rows.length }, { id: 'pending', label: 'Pending', count: pend.length }, { id: 'completed', label: 'Completed', count: rows.filter((c) => c.status !== 'SUBMITTED').length },
      { id: 'variance', label: 'Variance', count: variance.length }, { id: 'staff', label: 'Staff-wise Summary' }], tab, (t) => { tab = t; draw(); });
    view.querySelector('[data-kpis]').innerHTML = kpi({ label: 'Closings', value: fmtNum(rows.length), iconName: 'lock', tone: 'navy' }) + kpi({ label: 'Pending closings', value: fmtNum(pend.length), iconName: 'calendar-x', tone: pend.length ? 'warning' : 'success' })
      + kpi({ label: 'Net sales', value: fmtINR(rows.reduce((s, c) => s + c.summary.netSales, 0), true), iconName: 'indian-rupee', tone: 'teal' })
      + kpi({ label: 'Net cash variance', value: fmtINR(rows.reduce((s, c) => s + c.cashDifference, 0)), iconName: 'scale', tone: rows.some((c) => Math.abs(c.cashDifference) > tol) ? 'danger' : 'success', sub: `${variance.length} closing(s) with variance` });
    const body = view.querySelector('[data-body]');
    if (tab === 'pending') {
      body.innerHTML = pend.length ? `<table class="table dense"><thead><tr><th>Business Date</th><th>Cashier</th><th class="ta-right">Bills</th><th class="ta-right">Net collection</th><th></th></tr></thead><tbody>${pend.map((p) => { const s = daySummary(p.date, p.cashierId); return `<tr><td>${fmtDate(p.date)}</td><td>${esc(userName(p.cashierId))}</td><td class="ta-right">${s.billCount}</td><td class="ta-right">${fmtINR(s.netCollection)}</td><td class="ta-right">${badge('NOT_SUBMITTED', 'Not submitted')} ${can('pharmacy.closing.all') ? `<a class="btn btn-secondary btn-sm" href="#/pharmacy/closing?date=${p.date}&cashier=${p.cashierId}">Close counter</a>` : ''}</td></tr>`; }).join('')}</tbody></table>` : emptyState('check-circle-2', 'No pending closings');
    } else if (tab === 'staff') {
      const by = {}; rows.forEach((c) => { const x = (by[c.cashierId] ||= { n: 0, bills: 0, net: 0, cash: 0, upi: 0, card: 0, other: 0, var: 0, varDays: 0 }); x.n++; x.bills += c.summary.bills; x.net += c.summary.netSales; x.cash += pm(c, 'CASH').recorded; x.upi += pm(c, 'UPI').recorded; x.card += pm(c, 'CARD').recorded; x.other += pm(c, 'OTHER').recorded; x.var += c.cashDifference; if (Math.abs(c.cashDifference) > 0.005) x.varDays++; });
      body.innerHTML = `<table class="table dense"><thead><tr><th>Staff</th><th class="ta-right">Closings</th><th class="ta-right">Bills</th><th class="ta-right">Net Sales</th><th class="ta-right">Cash</th><th class="ta-right">UPI</th><th class="ta-right">Card</th><th class="ta-right">Other</th><th class="ta-right">Net Cash Variance</th><th class="ta-right">Days with variance</th></tr></thead><tbody>
        ${Object.entries(by).map(([u, x]) => `<tr><td class="cell-main">${esc(userName(u))}</td><td class="ta-right">${x.n}</td><td class="ta-right">${x.bills}</td><td class="ta-right strong">${fmtINR(x.net, true)}</td><td class="ta-right">${fmtINR(x.cash, true)}</td><td class="ta-right">${fmtINR(x.upi, true)}</td><td class="ta-right">${fmtINR(x.card, true)}</td><td class="ta-right">${fmtINR(x.other, true)}</td><td class="ta-right ${x.var < 0 ? 'text-danger' : ''}">${fmtINR(x.var)}</td><td class="ta-right">${x.varDays}</td></tr>`).join('')}</tbody></table>`;
    } else {
      const list = tab === 'completed' ? rows.filter((c) => c.status !== 'SUBMITTED') : tab === 'variance' ? variance : rows;
      const t = dataTable({ columns: cols, rows: list, pageSize: 25, sort: { key: 'businessDate', dir: 'desc' }, dense: true, rowClass: (c) => (c.id === query.focus ? 'row-warning' : Math.abs(c.cashDifference) > tol ? 'row-danger' : ''), empty: emptyState('lock', 'No closings') });
      body.innerHTML = ''; body.appendChild(t.el);
      view._rows = { cols, list: t.getRows };
    }
    refreshIcons(view);
  };
  view.querySelectorAll('[data-f]').forEach((el) => { el.onchange = () => { f[el.dataset.f] = el.value; draw(); }; });
  view.addEventListener('click', (e) => { const v = e.target.closest('[data-view]'); if (v) showClosing(store.get('closings', v.dataset.view), user, draw); });
  view.querySelector('[data-csv]').onclick = () => {
    const list = rowsAll();
    downloadCSV(`daily-closing-report-${ymd()}.csv`, ['Closing ID', 'Closing Date', 'Pharmacy Staff', 'Bills', 'Gross Sales', 'Discounts', 'Returns', 'Refunds', 'Net Sales', 'Registered Patient Sales', 'Walk-in Sales', 'Cash', 'UPI', 'Card', 'Other', 'Expected Cash', 'Actual Cash', 'Cash Variance', 'Status'],
      list.map((c) => [c.id, c.businessDate, userName(c.cashierId), c.summary.bills, c.summary.gross, c.summary.discounts, c.summary.returns, c.summary.refunds, c.summary.netSales, c.summary.bySale?.PATIENT.sales ?? '', c.summary.bySale?.WALKIN.sales ?? '', ...PAY_MODES.map((m) => pm(c, m).recorded), c.expectedCash, c.actualCash, c.cashDifference, c.status]));
    toast('Daily closing report exported.');
  };
  draw();
  if (query.focus && store.get('closings', query.focus)) showClosing(store.get('closings', query.focus), user, draw);
}
function showClosing(c, user, done) {
  openModal({ title: `Daily closing ${c.id}`, subtitle: `${fmtDate(c.businessDate)} · ${esc(userName(c.cashierId))}`, size: 'lg', body: closingDetail(c),
    footer: [...(can('pharmacy.closing.correct') ? [{ label: 'Correct', icon: 'pencil', onClick: (close) => { close(); correctionDialog(c, user, done); } }] : []),
      ...(can('pharmacy.closing.verify') && c.status !== 'VERIFIED' ? [{ label: 'Verify', cls: 'btn-success', icon: 'shield-check', onClick: (close) => { verifyClosing(c.id, user); toast('Closing verified.'); close(); done(); } }] : []),
      { label: 'Close', cls: 'btn-primary', onClick: (x) => x() }] });
}
