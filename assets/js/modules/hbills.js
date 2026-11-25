// Hospital bills (BRD 08): register, bill detail with department status, balance collection, credit decision,
// cancellation with owner approval and the printable receipt that unlocks department services.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { userName } from '../calculations.js';
import { hbillPaid, hbillRefunded, hbillBalance, hbillModes, collectHospitalPayment, decideCredit, requestHospitalCancel, decideHospitalCancel, cancelBlockers, catLabel, catIcon, orderAccess, ORDER_LABEL, ORDER_TONE, hospitalDaySummary, CATS } from '../hospital.js';
import { businessDate } from '../pharmacy-calc.js';
import { badge, dataTable, emptyState, openModal, confirmDialog, kpi, exportTable } from '../components.js';
import { toast } from '../notifications.js';
import { letterhead, docMeta } from '../docs.js';
import { setMeta } from '../app.js';
import { esc, icon, fmtINR, fmtNum, fmtDateTime, relTime, refreshIcons, ymd } from '../utils.js';

const STATUS_TXT = { PAID: 'Paid', PARTIALLY_PAID: 'Part paid', UNPAID: 'Unpaid', CANCELLED: 'Cancelled' };
const creditBadge = (b) => (!b.credit ? '' : badge(b.credit.status === 'PENDING' ? 'PENDING' : b.credit.status === 'REJECTED' ? 'REJECTED' : b.credit.status === 'EMERGENCY' ? 'critical' : 'APPROVED', b.credit.type === 'EMERGENCY' ? (b.credit.status === 'EMERGENCY' ? 'Emergency' : `Emergency · ${b.credit.status.toLowerCase()}`) : `Credit · ${b.credit.status === 'PENDING' ? 'awaiting owner' : b.credit.status.toLowerCase()}`));
const orderBadge = (o) => `<span class="badge badge-${ORDER_TONE[o.status]}"><span class="dot"></span>${ORDER_LABEL[o.status]}</span>`;

export function renderList(view, params, query) {
  const today = businessDate(); const s = hospitalDaySummary(today);
  view.innerHTML = `<div class="kpis mb-2">
      ${kpi({ label: 'Billed today', value: fmtINR(s.billed, true), iconName: 'receipt', tone: 'teal', sub: `${s.bills} bill(s)` })}
      ${kpi({ label: 'Collected today', value: fmtINR(s.collected - s.refunds, true), iconName: 'wallet', tone: 'navy', sub: `Cash ${fmtINR(s.byMode.CASH, true)} · UPI ${fmtINR(s.byMode.UPI, true)} · Card ${fmtINR(s.byMode.CARD, true)}` })}
      ${kpi({ label: 'Outstanding (all days)', value: fmtINR(store.all('hbills').reduce((t, b) => t + hbillBalance(b), 0), true), iconName: 'hourglass', tone: 'warning', sub: 'Credit & part-paid bills', href: '#/hbills?status=DUE' })}
      ${kpi({ label: 'Discount given today', value: fmtINR(s.discounts, true), iconName: 'percent', tone: 'info' })}</div>
    <section class="card"><div class="toolbar">
      <div class="input-icon grow">${icon('search')}<input class="input" data-f="q" placeholder="Bill no, patient, Patient ID or phone"></div>
      <input type="date" class="input" data-f="from"><input type="date" class="input" data-f="to">
      <select class="input" data-f="cat"><option value="">All categories</option>${CATS().map((c) => `<option value="${c.code}">${esc(c.label)}</option>`).join('')}</select>
      <select class="input" data-f="status"><option value="">All statuses</option><option value="PAID">Paid</option><option value="DUE">Balance due</option><option value="CREDIT">Credit / emergency</option><option value="CANCELLED">Cancelled</option></select>
      <button class="btn btn-secondary" data-csv>${icon('download')}CSV</button>${can('hbill.create') ? `<a class="btn btn-primary" href="#/hbill">${icon('plus')}New bill</a>` : ''}</div><div data-t></div></section>`;
  const f = (k) => view.querySelector(`[data-f="${k}"]`);
  if (query.status) f('status').value = query.status;
  const cols = [
    { key: 'id', label: 'Bill', render: (b) => `<span class="mono strong">${b.id}</span><div class="cell-sub">${fmtDateTime(b.at)}</div>`, csv: (b) => b.id },
    { key: 'patientName', label: 'Patient', render: (b) => `${esc(b.patientName)}<div class="cell-sub mono">${esc(b.uhid)}</div>` },
    { key: 'items', label: 'Services', sortable: false, render: (b) => `<span class="small">${esc(b.items.map((x) => x.name).slice(0, 3).join(', '))}${b.items.length > 3 ? ` +${b.items.length - 3}` : ''}</span>`, csv: (b) => b.items.map((x) => x.name).join('; ') },
    { key: 'counterUserId', label: 'Billed by', value: (b) => userName(b.counterUserId), render: (b) => esc(userName(b.counterUserId)) },
    { key: 'grandTotal', label: 'Total', align: 'right', render: (b) => `<strong>${fmtINR(b.grandTotal)}</strong>${b.discountTotal ? `<div class="cell-sub">−${fmtINR(b.discountTotal)} disc.</div>` : ''}` },
    { key: 'balance', label: 'Balance', align: 'right', value: (b) => hbillBalance(b), render: (b) => (hbillBalance(b) ? `<strong class="text-danger">${fmtINR(hbillBalance(b))}</strong>` : '—') },
    { key: 'status', label: 'Status', render: (b) => `${badge(b.status, STATUS_TXT[b.status])} ${creditBadge(b)}${b.cancellation?.status === 'PENDING' ? ' ' + badge('PENDING', 'Cancel requested') : ''}`, csv: (b) => b.status }];
  const t = dataTable({ rows: [], pageSize: 15, sort: { key: 'id', dir: 'desc' }, columns: cols, onRowClick: (b) => { location.hash = `#/hbills/${b.id}`; } });
  view.querySelector('[data-t]').appendChild(t.el);
  const apply = () => {
    const q = f('q').value.trim().toLowerCase();
    t.setRows(store.all('hbills').filter((b) => (!q || [b.id, b.patientName, b.uhid, b.phone].join(' ').toLowerCase().includes(q)) && (!f('from').value || b.businessDate >= f('from').value) && (!f('to').value || b.businessDate <= f('to').value)
      && (!f('cat').value || b.items.some((x) => x.category === f('cat').value))
      && (!f('status').value || (f('status').value === 'DUE' ? hbillBalance(b) > 0 : f('status').value === 'CREDIT' ? !!b.credit : b.status === f('status').value))));
  };
  view.querySelectorAll('[data-f]').forEach((i) => i.addEventListener('input', apply));
  view.querySelector('[data-csv]').onclick = () => exportTable(`hospital-bills-${ymd()}.csv`, cols, t.getRows());
  apply(); refreshIcons(view);
}

export function renderDetail(view, params) {
  const user = currentUser();
  const b = store.get('hbills', params.id);
  if (!b) { view.innerHTML = emptyState('receipt', 'Bill not found'); return; }
  setMeta({ title: b.id, crumbs: [{ label: 'Billing' }, { label: 'Hospital Bills', href: '#/hbills' }, b.id] });
  const orders = store.all('orders').filter((o) => o.billId === b.id);
  const bal = hbillBalance(b);
  const pp = store.all('patientPackages').filter((x) => x.billId === b.id);
  const canCancelReq = b.status !== 'CANCELLED' && !b.cancellation?.status?.match(/PENDING|APPROVED/) && (can('hbill.cancel.request') || can('hbill.cancel'));
  view.innerHTML = `
    <div class="page-actions-row mb-2"><a class="btn btn-primary" href="#/hbills/${b.id}/receipt">${icon('printer')}Receipt</a>
      ${bal > 0 && can('hbill.collect') && b.status !== 'CANCELLED' ? `<button class="btn btn-secondary" data-collect>${icon('wallet')}Collect ${fmtINR(bal)}</button>` : ''}
      ${b.credit && ['PENDING', 'EMERGENCY'].includes(b.credit.status) && can('credit.approve') ? `<button class="btn btn-secondary" data-credit="1">${icon('check')}Approve credit</button><button class="btn btn-danger-outline" data-credit="0">Reject credit</button>` : ''}
      ${b.cancellation?.status === 'PENDING' && can('hbill.cancel') ? `<button class="btn btn-danger" data-cdec="1">${icon('circle-slash')}Approve cancellation</button><button class="btn btn-secondary" data-cdec="0">Keep the bill</button>` : ''}
      ${canCancelReq ? `<button class="btn btn-ghost" data-cancel>${icon('circle-slash')}Cancel bill</button>` : ''}</div>
    ${b.cancellation ? `<div class="alert ${b.cancellation.status === 'APPROVED' ? 'alert-danger' : b.cancellation.status === 'PENDING' ? 'alert-warning' : 'alert-info'} mb-2">${icon('circle-slash')}<div><strong>Cancellation ${b.cancellation.status === 'PENDING' ? 'requested' : b.cancellation.status.toLowerCase()}</strong> — ${esc(b.cancellation.reason)} · ${esc(userName(b.cancellation.requestedBy))}, ${fmtDateTime(b.cancellation.requestedAt)}${b.cancellation.decidedBy ? ` · decided by ${esc(userName(b.cancellation.decidedBy))}${b.cancellation.note ? ': ' + esc(b.cancellation.note) : ''}` : ''}</div></div>` : ''}
    ${b.credit ? `<div class="alert ${b.credit.status === 'PENDING' ? 'alert-warning' : b.credit.status === 'REJECTED' ? 'alert-danger' : b.credit.type === 'EMERGENCY' ? 'alert-danger' : 'alert-info'} mb-2">${icon(b.credit.type === 'EMERGENCY' ? 'siren' : 'hand-coins')}<div><strong>${b.credit.type === 'EMERGENCY' ? 'Emergency' : 'Credit'} — ${b.credit.status === 'PENDING' ? 'waiting for the owner' : b.credit.status.toLowerCase()}</strong> · ${esc(b.credit.reason)}${b.credit.decidedBy ? ` · ${esc(userName(b.credit.decidedBy))}, ${fmtDateTime(b.credit.decidedAt)}` : ''}</div></div>` : ''}
    <div class="grid grid-3-1">
      <div>
        <section class="card"><header class="card-head"><h2>Services on this bill</h2>${badge(b.status, STATUS_TXT[b.status])}</header>
          <table class="table"><thead><tr><th>Service</th><th class="ta-right">Qty</th><th class="ta-right">Rate</th><th class="ta-right">Amount</th></tr></thead><tbody>
            ${b.items.map((x) => `<tr><td><strong>${esc(x.name)}</strong><div class="cell-sub">${icon(catIcon(x.category), 'ic-inline')} ${catLabel(x.category)}${x.coveredBy ? ` · <a href="#/packages/enrolments/${x.coveredBy}">in package ${x.coveredBy}</a>` : ''}</div></td><td class="ta-right">${x.qty}</td><td class="ta-right">${x.coveredBy ? `<s class="muted">${fmtINR(x.listRate)}</s> ₹0` : fmtINR(x.rate)}</td><td class="ta-right strong">${fmtINR(x.gross)}</td></tr>`).join('')}
            <tr><td colspan="3" class="ta-right">Sub-total</td><td class="ta-right">${fmtINR(b.gross)}</td></tr>
            ${b.discountTotal ? `<tr><td colspan="3" class="ta-right">Discount ${b.discountPct}%${b.discountRequestId ? ` <a href="#/discounts?focus=${b.discountRequestId}">(approved ${b.discountRequestId})</a>` : ''}</td><td class="ta-right">−${fmtINR(b.discountTotal)}</td></tr>` : ''}
            ${b.roundOff ? `<tr><td colspan="3" class="ta-right">Round off</td><td class="ta-right">${fmtINR(b.roundOff)}</td></tr>` : ''}
            <tr class="recon-total"><td colspan="3" class="ta-right">Grand total</td><td class="ta-right">${fmtINR(b.grandTotal)}</td></tr></tbody></table></section>
        <section class="card mt-2"><header class="card-head"><h2>Department status</h2><span class="muted small">Services are released only after payment or approved credit</span></header>
          ${orders.length ? `<table class="table"><thead><tr><th>Order</th><th>Service</th><th>Payment check</th><th>Status</th><th>Done by</th></tr></thead><tbody>${orders.map((o) => { const a = orderAccess(o); return `<tr><td class="mono small">${o.id}${o.accession ? `<div class="cell-sub">${o.accession}</div>` : ''}</td><td>${esc(o.name)}</td><td><span class="tag tag-${a.tone}">${a.label}</span></td><td>${orderBadge(o)}${o.lab?.reportNo ? ` <a class="small" href="#/lab/report/${o.id}">${o.lab.reportNo}</a>` : ''}</td><td class="small">${o.performedBy ? esc(userName(o.performedBy)) + '<div class="cell-sub">' + fmtDateTime(o.performedAt) + '</div>' : '—'}</td></tr>`; }).join('')}</tbody></table>` : `<div class="card-body muted">${pp.length ? 'This bill sells a package. Services are billed against it as they are used.' : 'No department services.'}</div>`}
          ${pp.map((x) => `<div class="card-body"><a class="pkg-chip" href="#/packages/enrolments/${x.id}">${icon('package-check')}<div class="grow"><strong>Package enrolment ${x.id}</strong><span>Valid till ${x.validUntil} · ${x.status.toLowerCase()}</span></div>${icon('chevron-right')}</a></div>`).join('')}</section>
      </div>
      <div>
        <section class="card"><header class="card-head"><h2>Patient</h2></header><div class="card-body"><a class="strong" href="#/patients/${b.patientId}">${esc(b.patientName)}</a><div class="mono small">${esc(b.uhid)}</div><div class="small muted">${esc(b.phone || '')}</div>${b.doctor ? `<div class="small mt-1">Doctor: ${esc(b.doctor)}</div>` : ''}</div></section>
        <section class="card mt-2"><header class="card-head"><h2>Payments</h2></header><div class="card-body">
          ${b.payments.length ? b.payments.map((p) => `<div class="kv"><span>${p.kind === 'REFUND' ? '<span class="text-danger">Refund</span>' : p.mode} <small class="muted">${fmtDateTime(p.at)} · ${esc(userName(p.userId))}${p.reference ? ' · ' + esc(p.reference) : ''}</small></span><strong class="${p.kind === 'REFUND' ? 'text-danger' : ''}">${p.kind === 'REFUND' ? '−' : ''}${fmtINR(p.amount)}</strong></div>`).join('') : '<p class="muted">No payment received.</p>'}
          <div class="divider"></div><div class="kv"><span>Paid</span><strong>${fmtINR(hbillPaid(b))}</strong></div>${hbillRefunded(b) ? `<div class="kv"><span>Refunded</span><strong>${fmtINR(hbillRefunded(b))}</strong></div>` : ''}<div class="kv"><span>Balance</span><strong class="${bal ? 'text-danger' : ''}">${fmtINR(bal)}</strong></div></div></section>
        <section class="card mt-2"><div class="card-body small muted">Billed by ${esc(userName(b.counterUserId))} · ${fmtDateTime(b.at)}${b.shiftId ? ` · shift <a href="#/shifts/${b.shiftId}">${b.shiftId}</a>` : ''}</div></section>
      </div></div>`;
  const again = () => renderDetail(view, params);
  view.querySelector('[data-collect]')?.addEventListener('click', () => {
    openModal({ title: `Collect balance — ${b.id}`, size: 'sm', body: `<div class="field"><label>Mode</label><select class="input" data-m><option>CASH</option><option>UPI</option><option>CARD</option></select></div><div class="field mt-1"><label>Amount</label><input class="input" type="number" data-a value="${bal}"></div><div class="field mt-1"><label>Reference</label><input class="input" data-r placeholder="UTR / card approval"></div>`,
      footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Collect', cls: 'btn-primary', onClick: (c, w) => { try { collectHospitalPayment(b.id, [{ mode: w.querySelector('[data-m]').value, amount: w.querySelector('[data-a]').value, reference: w.querySelector('[data-r]').value }], user); c(); toast('Payment recorded.'); again(); } catch (e) { toast(e.message, 'error'); } } }] });
  });
  view.querySelectorAll('[data-credit]').forEach((btn) => { btn.onclick = async () => { const ap = btn.dataset.credit === '1'; const r = await confirmDialog({ title: ap ? 'Approve credit?' : 'Reject credit?', message: `${esc(b.patientName)} · balance ${fmtINR(bal)}<br><span class="muted">${esc(b.credit.reason)}</span>`, confirmLabel: ap ? 'Approve' : 'Reject', tone: ap ? 'primary' : 'danger', reason: !ap, reasonLabel: 'Reason' }); if (!r) return; try { decideCredit(b.id, ap, r.reason, user); toast(ap ? 'Credit approved. Departments can go ahead.' : 'Credit rejected.'); again(); } catch (e) { toast(e.message, 'error'); } }; });
  view.querySelectorAll('[data-cdec]').forEach((btn) => { btn.onclick = async () => { const ap = btn.dataset.cdec === '1'; const r = await confirmDialog({ title: ap ? 'Cancel this bill and refund?' : 'Reject the cancellation?', message: ap ? `${fmtINR(hbillPaid(b) - hbillRefunded(b))} will be refunded by ${b.cancellation.refundMode}. All services are cancelled.` : 'The bill stays as it is.', confirmLabel: ap ? 'Cancel bill' : 'Keep bill', tone: ap ? 'danger' : 'primary', reason: !ap, reasonLabel: 'Reason' }); if (!r) return; try { decideHospitalCancel(b.id, ap, r.reason, user); toast(ap ? 'Bill cancelled and refund recorded.' : 'Cancellation rejected.'); again(); } catch (e) { toast(e.message, 'error'); } }; });
  view.querySelector('[data-cancel]')?.addEventListener('click', () => {
    const block = cancelBlockers(b); if (block) return toast(block, 'error', 'Cannot cancel');
    openModal({ title: `Cancel bill ${b.id}`, size: 'sm', body: `<p class="muted">${can('hbill.cancel') ? 'You can approve it straight away after this.' : 'The owner approves cancellations. Nothing changes until then.'}</p><div class="field mt-1"><label>Reason <span class="req">*</span></label><textarea class="input" rows="3" data-r placeholder="e.g. Doctor cancelled the test"></textarea></div><div class="field mt-1"><label>Refund by</label><select class="input" data-m><option>CASH</option><option>UPI</option><option>CARD</option></select></div>`,
      footer: [{ label: 'Close', onClick: (c) => c() }, { label: 'Request cancellation', cls: 'btn-danger', onClick: (c, w) => { try { requestHospitalCancel(b.id, w.querySelector('[data-r]').value, w.querySelector('[data-m]').value, user); c(); toast('Cancellation sent for approval.', 'info'); again(); } catch (e) { toast(e.message, 'error'); } } }] });
  });
  refreshIcons(view);
}

export function renderReceipt(view, params, query) {
  const b = store.get('hbills', params.id);
  if (!b) { view.innerHTML = emptyState('receipt', 'Bill not found'); return; }
  setMeta({ title: `Receipt ${b.id}`, crumbs: [{ label: 'Billing' }, { label: 'Hospital Bills', href: '#/hbills' }, b.id, 'Receipt'] });
  const orders = store.all('orders').filter((o) => o.billId === b.id);
  const pays = b.payments.filter((p) => p.kind === 'PAYMENT');
  view.innerHTML = `
    ${query.new ? `<div class="alert alert-success mb-2 no-print">${icon('check-circle-2')}<div><strong>Bill saved.</strong> ${orders.length ? `${orders.length} service order(s) are now visible to the lab / service counter${orders.some((o) => o.status === 'ON_HOLD') ? ' — on hold until credit is approved' : ''}.` : ''}</div></div>` : ''}
    <div class="row mb-2 no-print" style="justify-content:center"><button class="btn btn-primary" data-print>${icon('printer')}Print receipt</button><a class="btn btn-secondary" href="#/hbills/${b.id}">${icon('eye')}View bill</a>${can('hbill.create') ? `<a class="btn btn-ghost" href="#/hbill">${icon('plus')}New bill</a>` : ''}</div>
    <article class="doc doc-receipt">${letterhead(b.status === 'CANCELLED' ? 'CANCELLED BILL' : 'BILL / RECEIPT', { sub: 'Main billing counter', code: b.id })}
      ${docMeta([['Bill no', `<span class="mono">${esc(b.id)}</span>`], ['Date & time', fmtDateTime(b.at)], ['Patient', esc(b.patientName)], ['Patient ID', `<span class="mono">${esc(b.uhid)}</span>`], ['Phone', esc(b.phone || '—')], ['Doctor', esc(b.doctor || '—')], ['Billed by', esc(userName(b.counterUserId))], ['Payment', b.credit ? (b.credit.type === 'EMERGENCY' ? 'Emergency' : 'Credit') + (pays.length ? ' + part paid' : '') : hbillModes(b).join(' + ') || '—']])}
      <table class="rc-table"><thead><tr><th>#</th><th>Service</th><th>Department</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
        ${b.items.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}${x.coveredBy ? ' <small>(package)</small>' : ''}</td><td>${catLabel(x.category)}</td><td class="r">${x.qty}</td><td class="r">${x.rate.toFixed(2)}</td><td class="r">${x.gross.toFixed(2)}</td></tr>`).join('')}</tbody></table>
      <div class="rc-foot"><div class="rc-gst">${orders.length ? `<strong>Take this receipt to:</strong>${[...new Set(orders.map((o) => o.category))].map((c) => `<div>${catLabel(c)} — ${orders.filter((o) => o.category === c).map((o) => esc(o.name) + (o.accession ? ` (${o.accession})` : '')).join(', ')}</div>`).join('')}` : ''}<div class="mt-1">Hospital services are exempt from GST.</div></div>
        <div class="rc-totals"><div class="kv"><span>Sub-total</span><span>${fmtINR(b.gross)}</span></div>${b.discountTotal ? `<div class="kv"><span>Discount (${b.discountPct}%)</span><span>−${fmtINR(b.discountTotal)}</span></div>` : ''}${b.roundOff ? `<div class="kv"><span>Round off</span><span>${fmtINR(b.roundOff)}</span></div>` : ''}
          <div class="kv grand"><span>Total</span><strong>${fmtINR(b.grandTotal)}</strong></div><div class="kv"><span>Received</span><span>${fmtINR(hbillPaid(b))}</span></div>${hbillRefunded(b) ? `<div class="kv"><span>Refunded</span><span>${fmtINR(hbillRefunded(b))}</span></div>` : ''}<div class="kv"><span>Balance</span><span>${fmtINR(hbillBalance(b))}</span></div></div></div>
      <p class="rc-thanks">Thank you. Wishing you good health.</p><p class="rc-small">Computer-generated receipt. Please keep it for your records.</p></article>`;
  view.querySelector('[data-print]').onclick = () => window.print();
  refreshIcons(view);
}
