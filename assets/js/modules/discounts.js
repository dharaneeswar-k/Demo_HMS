// Discount approvals (BRD module 09) — the Super Admin approves or rejects discounts above the limit, from anywhere.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { medName, userName } from '../calculations.js';
import { decideDiscount } from '../pharmacy-services.js';
import { badge, dataTable, tabs, emptyState, openModal, confirmDialog, kpi } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, fmtDateTime, relTime, refreshIcons } from '../utils.js';

const STATUS = { PENDING: ['OPEN', 'Waiting for you'], APPROVED: ['APPROVED', 'Approved'], USED: ['COMPLETED', 'Applied on bill'], REJECTED: ['REJECTED', 'Rejected'], WITHDRAWN: ['CANCELLED', 'Withdrawn'] };
const st = (r) => badge(STATUS[r.status][0], STATUS[r.status][1]);

export function render(view, params, query) {
  const user = currentUser();
  const all = () => store.all('discountRequests');
  let tab = query.focus ? 'all' : 'pending';
  const lim = store.ph().discountLimits.staffPct;
  const month = new Date().toISOString().slice(0, 7);
  const used = all().filter((r) => r.status === 'USED' && r.decidedAt?.slice(0, 7) === month);
  view.innerHTML = `<p class="page-intro">Staff can give up to <strong>${lim}%</strong> discount on their own. Anything higher comes here with a reason. The bill stays on hold at the counter until you approve or reject it.</p>
    <div class="kpis mb-2">
      ${kpi({ label: 'Waiting for you', value: fmtNum(all().filter((r) => r.status === 'PENDING').length), iconName: 'inbox', tone: all().some((r) => r.status === 'PENDING') ? 'warning' : 'success' })}
      ${kpi({ label: 'Approved this month', value: fmtNum(used.length + all().filter((r) => r.status === 'APPROVED').length), iconName: 'check-check', tone: 'teal' })}
      ${kpi({ label: 'Discount given (approved)', value: fmtINR(used.reduce((t, r) => t + r.snapshot.discount, 0), true), iconName: 'indian-rupee', tone: 'navy', sub: 'This month' })}
      ${kpi({ label: 'Rejected', value: fmtNum(all().filter((r) => r.status === 'REJECTED').length), iconName: 'x-circle', tone: 'danger' })}
    </div>
    <section class="card"><div data-tabs></div><div data-body></div></section>`;
  const draw = () => {
    const pending = all().filter((r) => r.status === 'PENDING');
    tabs(view.querySelector('[data-tabs]'), [{ id: 'pending', label: 'Waiting for approval', icon: 'hourglass', count: pending.length }, { id: 'all', label: 'All requests', icon: 'list', count: all().length }], tab, (t) => { tab = t; draw(); });
    const body = view.querySelector('[data-body]');
    if (tab === 'pending') {
      body.innerHTML = pending.length ? `<div class="todo-list">${pending.map((r) => `<div class="todo dr-item"><span class="todo-ic sev-warning">${icon('percent')}</span>
        <span class="todo-txt"><strong>${r.requestedPct}% on ${fmtINR(r.snapshot.gross)} — ${esc(r.snapshot.patientName)}</strong><small>“${esc(r.reason)}”</small><small>${esc(userName(r.requestedBy))} · ${relTime(r.requestedAt)} · ${r.snapshot.lines.length} medicine(s)</small></span>
        <span class="todo-amt">−${fmtINR(r.snapshot.discount)}</span><button class="btn btn-danger-outline btn-sm" data-rej="${r.id}">Reject</button><button class="btn btn-primary btn-sm" data-app="${r.id}">${icon('check')}Approve</button><button class="btn btn-ghost btn-sm" data-view="${r.id}">${icon('eye')}</button></div>`).join('')}</div>`
        : emptyState('check-circle-2', 'Nothing waiting', 'No discount requests need your decision.');
    } else {
      body.innerHTML = '<div data-t></div>';
      const t = dataTable({ rows: all(), pageSize: 15, sort: { key: 'requestedAt', dir: 'desc' }, onRowClick: (r) => show(r), rowClass: (r) => (r.id === query.focus ? 'row-warning' : ''),
        columns: [
          { key: 'id', label: 'Request', render: (r) => `<span class="mono strong">${r.id}</span>` },
          { key: 'requestedAt', label: 'Requested', render: (r) => fmtDateTime(r.requestedAt) },
          { key: 'patient', label: 'Patient', value: (r) => r.snapshot.patientName, render: (r) => esc(r.snapshot.patientName) },
          { key: 'requestedPct', label: 'Discount', align: 'right', render: (r) => `<strong>${r.requestedPct}%</strong><div class="cell-sub">${fmtINR(r.snapshot.discount)}</div>` },
          { key: 'reason', label: 'Reason', render: (r) => `<span class="small">${esc(r.reason)}</span>` },
          { key: 'by', label: 'Requested by', value: (r) => userName(r.requestedBy), render: (r) => esc(userName(r.requestedBy)) },
          { key: 'decided', label: 'Decided', value: (r) => r.decidedAt || '', render: (r) => (r.decidedAt ? `${esc(userName(r.decidedBy))}<div class="cell-sub">${fmtDateTime(r.decidedAt)}</div>` : '—') },
          { key: 'bill', label: 'Bill', render: (r) => (r.billId ? `<a class="mono" href="#/pharmacy/bills/${r.billId}">${r.billId}</a>` : '—') },
          { key: 'status', label: 'Status', render: st }
        ] });
      body.querySelector('[data-t]').appendChild(t.el);
    }
    body.querySelectorAll('[data-app]').forEach((b) => { b.onclick = () => decide(store.get('discountRequests', b.dataset.app), true); });
    body.querySelectorAll('[data-rej]').forEach((b) => { b.onclick = () => decide(store.get('discountRequests', b.dataset.rej), false); });
    body.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => show(store.get('discountRequests', b.dataset.view)); });
    refreshIcons(view);
  };
  const decide = async (r, approve) => {
    const res = await confirmDialog({ title: approve ? `Approve ${r.requestedPct}% discount?` : `Reject ${r.requestedPct}% discount?`, iconName: approve ? 'check-circle-2' : 'x-circle', tone: approve ? 'primary' : 'danger',
      confirmLabel: approve ? 'Approve' : 'Reject', reason: !approve, reasonLabel: 'Reason for rejecting', message: `${esc(r.snapshot.patientName)} · ${fmtINR(r.snapshot.discount)} off ${fmtINR(r.snapshot.gross)}<br><span class="muted">Requested by ${esc(userName(r.requestedBy))}: “${esc(r.reason)}”</span>` });
    if (!res) return;
    try { decideDiscount(r.id, approve, res.reason, user); toast(approve ? 'Discount approved. The counter can complete the bill.' : 'Discount rejected. The counter has been told.', approve ? 'success' : 'info'); draw(); } catch (e) { toast(e.message, 'error'); }
  };
  const show = (r) => {
    openModal({ title: `Discount request ${r.id}`, subtitle: `${esc(r.snapshot.patientName)} · ${(r.snapshot.saleType || r.snapshot.billType) === 'WALKIN' ? 'Walk-in customer' : 'Registered patient'}`, size: 'md',
      body: `<div class="row mb-2">${st(r)}</div>
        <table class="table dense"><thead><tr><th>Medicine</th><th class="ta-right">Qty</th></tr></thead><tbody>${r.snapshot.lines.map((l) => `<tr><td>${esc(medName(l.medicineId))}</td><td class="ta-right">${l.qty}</td></tr>`).join('')}</tbody></table>
        <div class="kv mt-2"><span>Bill amount (MRP)</span><strong>${fmtINR(r.snapshot.gross)}</strong></div><div class="kv"><span>Discount requested</span><strong>${r.requestedPct}% · ${fmtINR(r.snapshot.discount)}</strong></div><div class="kv"><span>Patient pays</span><strong>${fmtINR(r.snapshot.grandTotal)}</strong></div>
        <div class="divider"></div><div class="kv"><span>Reason</span><span>${esc(r.reason)}</span></div><div class="kv"><span>Requested by</span><span>${esc(userName(r.requestedBy))} · ${fmtDateTime(r.requestedAt)}</span></div>
        ${r.decidedAt ? `<div class="kv"><span>Decided by</span><span>${esc(userName(r.decidedBy))} · ${fmtDateTime(r.decidedAt)}</span></div>${r.decisionNote ? `<div class="kv"><span>Note</span><span>${esc(r.decisionNote)}</span></div>` : ''}` : ''}`,
      footer: r.status === 'PENDING' && can('discount.approve') ? [{ label: 'Reject', cls: 'btn-danger-outline', onClick: (c) => { c(); decide(r, false); } }, { label: 'Approve', cls: 'btn-primary', icon: 'check', onClick: (c) => { c(); decide(r, true); } }] : [{ label: 'Close', cls: 'btn-primary', onClick: (c) => c() }] });
  };
  draw();
  if (query.focus && store.get('discountRequests', query.focus)) show(store.get('discountRequests', query.focus));
}
