// Hospital cash counter (OP fees, IP deposits, settlements, refunds): my day & closing, the owner's closing report,
// and Billing Approvals (discounts above the limit, OP refunds). Separate from the pharmacy counter closing.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { businessDate } from '../pharmacy-calc.js';
import { counterDay, hospitalClosingFor, submitHospitalClosing, verifyHospitalClosing, reopenHospitalClosing, pendingHospitalClosings, modeLabel, patient, cbadge, label, cs } from '../clinical.js';
import { pendingHospitalRequests, decideHospitalRequest } from '../hospital-approvals.js';
import { userName } from '../calculations.js';
import { kpi, tabs, emptyState, confirmDialog, dataTable } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, fmtDate, fmtDateTime, relTime, refreshIcons, debounce } from '../utils.js';

const MODES = ['CASH', 'UPI', 'CARD', 'OTHER'];
const refLink = (r) => r.refType === 'OP_BILL' ? `#/op/visits/${store.get('opBills', r.refId)?.visitId}` : r.refType === 'IP_BILL' ? `#/ip/admissions/${store.get('ipBills', r.refId)?.admissionId}/discharge` : `#/ip/admissions/${r.refId}`;

export function renderClosing(view, params, query) {
  const u = currentUser();
  let tab = query.tab || (can('hospital.closing.verify') && !store.all('hospitalReceipts').some((r) => r.userId === u.id) ? 'report' : 'mine');
  let date = query.date || businessDate();
  const draw = () => {
    view.innerHTML = `<div class="page-head"><div><p class="muted">The hospital cash counter covers OP fees, IP deposits, final settlements and refunds. It is closed separately from the pharmacy counter.</p></div></div>
      <section class="card flush"><div data-tabs></div><div class="card-body" data-body></div></section>`;
    const items = [{ id: 'mine', label: 'My counter', icon: 'wallet' }, ...(can('hospital.closing.verify') ? [{ id: 'report', label: 'Closing report', icon: 'clipboard-list', count: store.all('hospitalClosings').filter((c) => c.status === 'SUBMITTED').length }] : [])];
    tabs(view.querySelector('[data-tabs]'), items, tab, (x) => { tab = x; body(); });
    const body = () => (tab === 'mine' ? mine(view.querySelector('[data-body]')) : report(view.querySelector('[data-body]')));
    body();
  };
  const mine = (h) => {
    const pend = pendingHospitalClosings().filter((p) => p.cashierId === u.id);
    const d = counterDay(date, u.id); const closed = hospitalClosingFor(date, u.id);
    h.innerHTML = `<div class="row-between mb-2"><div class="row"><label class="filter-label">Business date <input class="input" type="date" data-date value="${date}" max="${businessDate()}"></label>
        ${pend.length ? `<span class="tag tag-warning">${pend.length} earlier day(s) not closed: ${pend.slice(0, 3).map((p) => `<a href="#" data-goto="${p.date}">${fmtDate(p.date)}</a>`).join(', ')}</span>` : ''}</div>${closed ? cbadge(closed.status === 'VERIFIED' ? 'VERIFIED' : 'SUBMITTED_CLOSING', closed.status === 'VERIFIED' ? 'Verified' : 'Closed — waiting for verification') : ''}</div>
      <div class="kpis">${kpi({ label: 'Collected', value: fmtINR(d.totals.collected, true), iconName: 'indian-rupee', tone: 'teal', sub: `${d.totals.receipts} receipt(s)` })}
        ${kpi({ label: 'OP fees & services', value: fmtINR(d.totals.op, true), iconName: 'stethoscope', tone: 'info' })}
        ${kpi({ label: 'IP deposits', value: fmtINR(d.totals.deposits, true), iconName: 'wallet', tone: 'navy' })}
        ${kpi({ label: 'IP settlements', value: fmtINR(d.totals.settlements, true), iconName: 'receipt-text', tone: 'purple' })}
        ${kpi({ label: 'Refunds paid', value: fmtINR(d.totals.refunds, true), iconName: 'undo-2', tone: d.totals.refunds ? 'warning' : 'success' })}</div>
      <div class="grid grid-3-1 mt-2"><section class="card"><header class="card-head"><h2>Receipts on ${fmtDate(date)}</h2></header><div class="table-scroll"><table class="table dense"><thead><tr><th>Receipt</th><th>Time</th><th>For</th><th>Patient</th><th>Mode</th><th class="ta-right">Amount</th></tr></thead><tbody>
        ${d.tx.slice().sort((a, b) => b.at.localeCompare(a.at)).map((r) => `<tr><td class="mono">${esc(r.id)}</td><td class="small">${fmtDateTime(r.at).split(', ')[1]}</td><td><a href="${refLink(r)}">${r.source} ${r.kind === 'DEPOSIT' ? 'deposit' : r.kind === 'REFUND' ? 'refund' : 'payment'}</a><div class="cell-sub mono">${esc(r.refId)}</div></td>
          <td>${esc(patient(r.patientId)?.name || '')}</td><td>${esc(modeLabel(r.mode))}</td><td class="ta-right ${r.kind === 'REFUND' ? 'text-warning' : ''}">${r.kind === 'REFUND' ? '− ' : ''}${fmtINR(r.amount)}</td></tr>`).join('') || `<tr><td colspan="6">${emptyState('receipt', 'No receipts on this day')}</td></tr>`}</tbody></table></div></section>
        <section class="card"><header class="card-head"><h2>${closed ? 'Closing' : 'Count & close'}</h2></header><div class="card-body">
          ${closed ? closingView(closed) : d.tx.length ? `<form data-close><table class="table dense"><thead><tr><th>Mode</th><th class="ta-right">Expected</th><th style="width:120px">Counted</th></tr></thead><tbody>
            ${d.rows.map((r) => `<tr><td>${esc(modeLabel(r.mode).split(' (')[0])}${r.mode === 'CASH' ? `<div class="cell-sub">incl. float ${fmtINR(d.float, true)}</div>` : ''}</td><td class="ta-right">${fmtINR(r.expected)}</td><td><input class="input input-sm" type="number" step="0.01" min="0" name="${r.mode}" value="${r.expected}"></td></tr>`).join('')}</tbody></table>
            <div class="kv strong mt-1"><span>Difference</span><span data-diff>₹0.00</span></div><div class="field mt-1"><label>Remarks</label><textarea class="input" rows="2" name="remarks" placeholder="Required if there is a difference"></textarea></div>
            <button class="btn btn-primary btn-block mt-1" type="submit">${icon('lock')}Submit closing</button><p class="muted small mt-1">After closing, you cannot take receipts for this date. The Super Admin verifies it.</p></form>` : '<p class="muted">Nothing to close.</p>'}</div></section></div>`;
    h.querySelector('[data-date]').onchange = (e) => { date = e.target.value; mine(h); };
    h.querySelectorAll('[data-goto]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); date = a.dataset.goto; mine(h); }; });
    const f = h.querySelector('[data-close]');
    if (f) {
      const upd = () => { const diff = MODES.reduce((t, m) => t + (Number(f[m].value) || 0) - d.expected[m], 0); const el = h.querySelector('[data-diff]'); el.textContent = fmtINR(diff); el.className = Math.abs(diff) > 0.005 ? 'text-danger' : 'text-success'; };
      f.addEventListener('input', upd);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!(await confirmDialog({ title: `Close counter for ${fmtDate(date)}?`, message: 'The closing is sent to the Super Admin and locked.', confirmLabel: 'Submit closing', iconName: 'lock' }))) return;
        try { submitHospitalClosing({ date, actual: Object.fromEntries(MODES.map((m) => [m, Number(f[m].value) || 0])), remarks: f.remarks.value }, u); toast('Counter closed.', 'success'); mine(h); } catch (err) { toast(err.message, 'error'); }
      });
    }
    refreshIcons(h);
  };
  const closingView = (c) => `${MODES.map((m) => `<div class="kv"><span>${esc(modeLabel(m).split(' (')[0])}</span><span>${fmtINR(c.actual[m])} <small class="muted">/ ${fmtINR(c.expected[m])}</small></span></div>`).join('')}
    <div class="kv strong"><span>Difference</span><span class="${c.difference ? 'text-danger' : 'text-success'}">${fmtINR(c.difference)}</span></div><p class="small mt-1">${esc(c.remarks)}</p><p class="tiny muted">Submitted ${fmtDateTime(c.submittedAt)}${c.verifiedBy ? ` · verified by ${esc(userName(c.verifiedBy))}` : ''}</p>`;
  const report = (h) => {
    const rows = [...store.all('hospitalClosings')].sort((a, b) => b.businessDate.localeCompare(a.businessDate) || a.cashierId.localeCompare(b.cashierId));
    const pend = pendingHospitalClosings();
    h.innerHTML = `${pend.length ? `<div class="alert alert-warning mb-2">${icon('calendar-x')}<div><strong>${pend.length} counter day(s) not closed</strong><div class="small">${pend.slice(0, 6).map((p) => `${fmtDate(p.date)} · ${esc(userName(p.cashierId))}`).join(' · ')}</div></div></div>` : ''}<div data-t></div>`;
    const tol = Number(cs().cashier.varianceTolerance) || 0;
    const t = dataTable({ columns: [
      { key: 'businessDate', label: 'Date', render: (c) => fmtDate(c.businessDate) }, { key: 'cashier', label: 'Cashier', value: (c) => userName(c.cashierId), render: (c) => esc(userName(c.cashierId)) },
      { key: 'col', label: 'Collected', align: 'right', value: (c) => c.totals.collected, render: (c) => fmtINR(c.totals.collected) }, { key: 'ref', label: 'Refunds', align: 'right', value: (c) => c.totals.refunds, render: (c) => fmtINR(c.totals.refunds) },
      { key: 'cash', label: 'Cash diff.', align: 'right', value: (c) => c.cashDifference, render: (c) => `<span class="${Math.abs(c.cashDifference) > tol ? 'text-danger strong' : c.cashDifference ? 'text-warning' : 'text-success'}">${fmtINR(c.cashDifference)}</span>` },
      { key: 'status', label: 'Status', value: (c) => c.status, render: (c) => cbadge(c.status === 'VERIFIED' ? 'VERIFIED' : 'SUBMITTED_CLOSING', c.status === 'VERIFIED' ? 'Verified' : 'To verify') },
      { key: 'act', label: '', sortable: false, render: (c) => c.status === 'SUBMITTED' ? `<button class="btn btn-primary btn-sm" data-verify="${c.id}">Verify</button> <button class="btn btn-ghost btn-sm" data-reopen="${c.id}">Re-open</button>` : '' }
    ], rows, pageSize: 15 });
    h.querySelector('[data-t]').appendChild(t.el);
    h.onclick = async (e) => {
      const v = e.target.closest('[data-verify]'); const r = e.target.closest('[data-reopen]');
      try {
        if (v) { verifyHospitalClosing(v.dataset.verify, u); toast('Closing verified.', 'success'); report(h); }
        if (r) { const x = await confirmDialog({ title: 'Re-open this closing?', message: 'The cashier can take receipts for that day again and must close it again.', confirmLabel: 'Re-open', tone: 'danger', reason: true }); if (x) { reopenHospitalClosing(r.dataset.reopen, x.reason, u); toast('Closing re-opened.', 'success'); report(h); } }
      } catch (err) { toast(err.message, 'error'); }
    };
    refreshIcons(h);
  };
  draw();
}

export function renderApprovals(view, params, query) {
  const u = currentUser();
  const draw = () => {
    const pend = pendingHospitalRequests(); const done = store.all('hospitalRequests').filter((r) => r.status !== 'PENDING').sort((a, b) => (b.decidedAt || '').localeCompare(a.decidedAt || '')).slice(0, 20);
    view.innerHTML = `<div class="page-head"><div><p class="muted">OP and IP discounts above ${store.ph().discountLimits?.staffPct ?? 10}% and refunds of paid OP fees wait here for your decision. The bill stays on hold until you decide.</p></div></div>
      <div class="kpis">${kpi({ label: 'Waiting for you', value: fmtNum(pend.length), iconName: 'inbox', tone: pend.length ? 'danger' : 'success' })}
        ${kpi({ label: 'Discount value waiting', value: fmtINR(pend.filter((r) => r.type === 'DISCOUNT').reduce((t, r) => t + r.amount, 0), true), iconName: 'percent', tone: 'warning' })}</div>
      <div class="ind-grid mt-2">${pend.map((r) => { const p = patient(r.patientId); return `<div class="ind-card ${query.focus === r.id ? 'stat' : ''}"><div class="ind-head"><div><strong>${r.type === 'DISCOUNT' ? `${r.pct}% discount` : 'Refund'} · ${esc(r.source)}</strong><div class="small muted">${esc(r.id)} · ${relTime(r.requestedAt)} by ${esc(userName(r.requestedBy))}</div></div><span class="tag tag-${r.type === 'DISCOUNT' ? 'purple' : 'warning'}">${r.type === 'DISCOUNT' ? 'Discount' : 'Refund'}</span></div>
        <div class="kv"><span>Patient</span><span>${esc(p?.name || '')} · <span class="mono">${esc(p?.uhid || '')}</span></span></div><div class="kv"><span>Bill</span><span><a href="${refLink(r)}" class="mono">${esc(r.refId)}</a></span></div>
        ${r.type === 'DISCOUNT' ? `<div class="kv"><span>Bill amount</span><span>${fmtINR(r.base)}</span></div><div class="kv strong"><span>Discount</span><span>${fmtINR(r.amount)}</span></div>` : `<div class="kv strong"><span>Refund</span><span>${fmtINR(r.amount)}</span></div>`}
        <div class="alert alert-info">${icon('message-square')}<div>${esc(r.reason)}</div></div>
        <div class="row"><button class="btn btn-danger-outline btn-sm" data-rej="${r.id}">${icon('x')}Reject</button><span class="grow"></span><button class="btn btn-primary btn-sm" data-app="${r.id}">${icon('check')}Approve</button></div></div>`; }).join('') || `<div class="card" style="grid-column:1/-1">${emptyState('party-popper', 'Nothing waiting', 'Billing requests from OP and IP appear here.')}</div>`}</div>
      ${done.length ? `<section class="card mt-2"><header class="card-head"><h2>Recently decided</h2></header><div class="table-scroll"><table class="table dense"><thead><tr><th>Request</th><th>Type</th><th>Patient</th><th class="ta-right">Amount</th><th>Decision</th><th>By</th></tr></thead><tbody>
        ${done.map((r) => `<tr><td class="mono">${esc(r.id)}</td><td>${r.type === 'DISCOUNT' ? `${r.pct}% discount` : 'Refund'} · ${esc(r.source)}</td><td>${esc(patient(r.patientId)?.name || '')}</td><td class="ta-right">${fmtINR(r.amount)}</td><td>${cbadge(r.status)}${r.decisionNote ? `<div class="cell-sub">${esc(r.decisionNote)}</div>` : ''}</td><td class="small">${esc(userName(r.decidedBy))} · ${relTime(r.decidedAt)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
    refreshIcons(view);
  };
  view.onclick = async (e) => {
    const a = e.target.closest('[data-app]'); const r = e.target.closest('[data-rej]');
    try {
      if (a) { const x = await confirmDialog({ title: 'Approve this request?', message: 'The bill is released at the approved amount.', confirmLabel: 'Approve', iconName: 'check' }); if (!x) return; decideHospitalRequest(a.dataset.app, true, '', u); toast('Approved.', 'success'); draw(); }
      if (r) { const x = await confirmDialog({ title: 'Reject this request?', message: 'Discount: the bill goes back to the full amount. Refund: the fee stays paid.', confirmLabel: 'Reject', tone: 'danger', reason: true }); if (!x) return; decideHospitalRequest(r.dataset.rej, false, x.reason, u); toast('Rejected.', 'success'); draw(); }
    } catch (err) { toast(err.message, 'error'); }
  };
  draw();
  const off = store.subscribe(debounce(() => { if (!document.querySelector('.modal-backdrop')) draw(); }, 400));
  return () => { off(); view.onclick = null; };
}
