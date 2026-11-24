// Pharmacy returns & refunds — always against an original bill item; the original bill is never edited.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { batchStatus, medName, userName } from '../calculations.js';
import { billItems, billBalance, billPaid, returnedQty, pendingReturnQty, eligibleReturnQty, RETURN_REASONS, modeLabel } from '../pharmacy-calc.js';
import { createReturn, approveReturn, rejectReturn, canDecideReturn, allowedDispositions, returnNeedsOwner } from '../pharmacy-services.js';
import { badge, dataTable, tabs, emptyState, openModal, confirmDialog, kpi } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtDate, fmtDateTime, refreshIcons } from '../utils.js';
import { lineRefund, r2 } from '../pricing.js';

const CONDITIONS = [['GOOD', 'Unopened / good'], ['OPENED', 'Opened / partly used'], ['DAMAGED', 'Damaged'], ['EXPIRED', 'Expired']];
const DISP = { RESTOCK: 'Restock (sellable)', QUARANTINE: 'Quarantine (hold)', WRITE_OFF: 'Write off' };

export function render(view, params, query) {
  const user = currentUser();
  const pendingForMe = () => store.all('pReturns').filter((r) => canDecideReturn(r, user));
  let tab = query.bill ? 'new' : query.focus || pendingForMe().length ? 'list' : 'new';
  view.innerHTML = `
    <div class="page-head"><div><p class="muted">Returns reference the original bill item. Returned medicines go back to sellable stock only after a verified <strong>Restock</strong> decision; damaged, opened or expired units are quarantined or written off.</p></div></div>
    <div class="kpis mb-2">
      ${kpi({ label: 'Awaiting your decision', value: pendingForMe().length, iconName: 'inbox', tone: pendingForMe().length ? 'warning' : 'success' })}
      ${kpi({ label: 'Pending (all)', value: store.all('pReturns').filter((r) => r.status === 'PENDING_APPROVAL').length, iconName: 'hourglass', tone: 'purple' })}
      ${kpi({ label: 'Refunded (completed)', value: fmtINR(store.all('pReturns').filter((r) => r.status === 'COMPLETED').reduce((s, r) => s + r.refundAmount, 0), true), iconName: 'undo-2', tone: 'teal' })}
      ${kpi({ label: 'Owner approval above', value: fmtINR(store.ph().refund.ownerApprovalAbove, true), iconName: 'shield-alert', tone: 'navy', sub: 'Configurable in Settings' })}
    </div>
    <section class="card"><div data-tabs></div><div data-body></div></section>`;
  const body = view.querySelector('[data-body]');
  const draw = () => {
    tabs(view.querySelector('[data-tabs]'), [{ id: 'new', label: 'New Return', icon: 'plus' }, { id: 'list', label: 'Return Requests', icon: 'list', count: store.all('pReturns').length }], tab, (t) => { tab = t; draw(); });
    tab === 'new' ? newReturn(body, user, query.bill, () => { tab = 'list'; query.bill = ''; draw(); }) : list(body, user, query.focus, draw);
    refreshIcons(view);
  };
  draw();
}

function newReturn(host, user, billId, done) {
  host.innerHTML = `<div class="card-body"><div class="row"><div class="input-icon grow" style="max-width:460px">${icon('search')}<input class="input" data-find placeholder="Bill number, patient name or phone" value="${esc(billId || '')}"></div><button class="btn btn-secondary" data-go>Find bill</button></div><div data-matches class="mt-2"></div><div data-form class="mt-2"></div></div>`;
  const find = () => {
    const q = host.querySelector('[data-find]').value.trim().toLowerCase(); if (!q) return;
    const exact = store.get('bills', q.toUpperCase());
    if (exact) { host.querySelector('[data-matches]').innerHTML = ''; return showBill(exact); }
    const m = store.all('bills').filter((b) => [b.id, b.patientName, b.phone, b.uhid].join(' ').toLowerCase().includes(q)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
    host.querySelector('[data-matches]').innerHTML = m.length ? `<div class="list-plain">${m.map((b) => `<button class="report-link" data-pick="${b.id}"><span class="mono strong">${b.id}</span><span class="grow">${esc(b.patientName)} · ${fmtDateTime(b.at)}</span>${badge(b.status)}<strong>${fmtINR(b.grandTotal)}</strong></button>`).join('')}</div>` : '<p class="muted">No matching bills.</p>';
    host.querySelectorAll('[data-pick]').forEach((x) => { x.onclick = () => showBill(store.get('bills', x.dataset.pick)); });
  };
  host.querySelector('[data-go]').onclick = find;
  host.querySelector('[data-find]').onkeydown = (e) => { if (e.key === 'Enter') find(); };
  function showBill(b) {
    const f = host.querySelector('[data-form]');
    if (b.status === 'CANCELLED') { f.innerHTML = `<div class="alert alert-danger">${icon('circle-slash')}<div>${b.id} is cancelled — nothing can be returned.</div></div>`; refreshIcons(f); return; }
    if (billBalance(b) > 0) { f.innerHTML = `<div class="alert alert-warning">${icon('hourglass')}<div>${b.id} has an unpaid balance of ${fmtINR(billBalance(b))}. Settle it on the <a href="#/pharmacy/bills/${b.id}">bill</a> before processing a refund.</div></div>`; refreshIcons(f); return; }
    const items = billItems(b.id);
    const approverNow = can('pharmacy.return.approve', user);
    f.innerHTML = `<div class="alert alert-teal mb-2">${icon('receipt')}<div><strong>Original bill <a href="#/pharmacy/bills/${b.id}">${b.id}</a></strong> · ${esc(b.patientName)} · ${fmtDateTime(b.at)} · paid ${fmtINR(billPaid(b))} via ${esc(b.paymentMode)}. The original bill will not be modified.</div></div>
      <div class="table-scroll"><table class="table dense"><thead><tr><th>Medicine</th><th>Batch</th><th class="ta-right">Purchased</th><th class="ta-right">Already returned</th><th class="ta-right">Eligible</th><th>Return Qty</th><th>Condition</th>${approverNow ? '<th>Decision</th>' : ''}<th class="ta-right">Refund</th></tr></thead><tbody>
      ${items.map((i) => { const el = eligibleReturnQty(i); const bt = store.get('batches', i.batchId); return `<tr data-item="${i.id}"><td class="cell-main">${esc(medName(i.medicineId))}<div class="cell-sub">${fmtINR(i.netAmount / i.qty)} per unit paid</div></td><td class="mono">${esc(i.batchNo)}<div class="cell-sub">${badge(batchStatus(bt))}</div></td>
        <td class="ta-right">${i.qty}</td><td class="ta-right">${returnedQty(i.id)}${pendingReturnQty(i.id) ? `<div class="cell-sub">+${pendingReturnQty(i.id)} pending</div>` : ''}</td><td class="ta-right strong">${el}</td>
        <td><input class="input input-sm" style="width:76px" type="number" min="0" max="${el}" step="1" value="0" data-q ${el ? '' : 'disabled'}></td>
        <td><select class="input input-sm" data-c ${el ? '' : 'disabled'}>${CONDITIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></td>
        ${approverNow ? `<td><select class="input input-sm" data-d ${el ? '' : 'disabled'}></select></td>` : ''}<td class="ta-right strong" data-r>—</td></tr>`; }).join('')}</tbody></table></div>
      <div class="form-grid mt-2"><div class="field col-4"><label>Return reason <span class="req">*</span></label><select class="input" data-reason><option value="">Select…</option>${RETURN_REASONS.map((r) => `<option>${r}</option>`).join('')}</select></div>
        <div class="field col-4"><label>Refund mode <span class="req">*</span></label><select class="input" data-mode>${store.ph().refundModes.map((m) => `<option value="${m}" ${b.paymentMode.startsWith(m) ? 'selected' : ''}>${esc(modeLabel(m))}</option>`).join('')}</select></div>
        <div class="field col-4"><label>Total refund</label><input class="input strong" data-total readonly value="${fmtINR(0)}"></div>
        <div class="field col-12"><label>Notes</label><input class="input" data-notes placeholder="Pack condition, who verified, etc."></div><div class="col-12" data-policy></div></div>
      <div class="row mt-2" style="justify-content:flex-end"><button class="btn btn-primary" data-submit>${icon('undo-2')}Submit return</button></div>`;
    const rows = [...f.querySelectorAll('[data-item]')];
    const fillDisp = (tr) => { const d = tr.querySelector('[data-d]'); if (!d) return; const ri = { batchId: store.get('billItems', tr.dataset.item).batchId, condition: tr.querySelector('[data-c]').value }; const opts = allowedDispositions(ri); const cur = d.value; d.innerHTML = opts.map((o) => `<option value="${o}" ${o === cur ? 'selected' : ''}>${DISP[o]}</option>`).join(''); };
    const recalc = () => {
      let total = 0;
      rows.forEach((tr) => { const it = store.get('billItems', tr.dataset.item); const q = Math.max(0, Math.floor(Number(tr.querySelector('[data-q]').value) || 0)); const v = q ? lineRefund(it, q) : 0; total = r2(total + v); tr.querySelector('[data-r]').textContent = q ? fmtINR(v) : '—'; tr.querySelector('[data-q]').classList.toggle('invalid', q > eligibleReturnQty(it)); });
      f.querySelector('[data-total]').value = fmtINR(total);
      const owner = returnNeedsOwner(total);
      const immediate = approverNow && (!owner || can('pharmacy.refund.exceptional', user));
      f.querySelector('[data-policy]').innerHTML = total ? `<div class="alert ${immediate ? 'alert-success' : owner ? 'alert-info' : 'alert-warning'}">${icon(immediate ? 'check-circle-2' : 'hourglass')}<div>${immediate ? 'You can approve this return — the refund and any restock movement are recorded immediately.' : owner ? `Refund above ${fmtINR(store.ph().refund.ownerApprovalAbove)} — needs the <strong>Hospital Owner's</strong> approval.` : 'Will be sent to the <strong>Pharmacy Manager</strong> for verification and refund approval.'}</div></div>` : '';
      refreshIcons(f.querySelector('[data-policy]'));
    };
    rows.forEach((tr) => { fillDisp(tr); tr.querySelector('[data-q]').oninput = recalc; tr.querySelector('[data-c]').onchange = () => fillDisp(tr); });
    f.querySelector('[data-submit]').onclick = async () => {
      const its = rows.map((tr) => ({ billItemId: tr.dataset.item, qty: Math.floor(Number(tr.querySelector('[data-q]').value) || 0), condition: tr.querySelector('[data-c]').value, decision: tr.querySelector('[data-d]')?.value })).filter((x) => x.qty > 0);
      const reason = f.querySelector('[data-reason]').value; const refundMode = f.querySelector('[data-mode]').value;
      if (!its.length) { toast('Enter a return quantity for at least one item.', 'error'); return; }
      if (!reason) { toast('Select a return reason.', 'error'); return; }
      const total = r2(its.reduce((s, x) => s + lineRefund(store.get('billItems', x.billItemId), x.qty), 0));
      if (!(await confirmDialog({ title: 'Submit return?', iconName: 'undo-2', confirmLabel: 'Submit', message: `${its.length} item(s) from ${b.id}. Refund <strong>${fmtINR(total)}</strong> via ${esc(modeLabel(refundMode))}.` }))) return;
      try {
        const decisions = approverNow ? Object.fromEntries(its.map((x) => [x.billItemId, x.decision])) : null;
        const r = createReturn({ billId: b.id, items: its, reason, notes: f.querySelector('[data-notes]').value, refundMode, decisions }, user);
        toast(r.status === 'COMPLETED' ? `${r.id} completed. Refund ${fmtINR(r.refundAmount)} recorded.` : `${r.id} sent for approval.`, r.status === 'COMPLETED' ? 'success' : 'info');
        done();
      } catch (e) { toast(e.message, 'error'); }
    };
    refreshIcons(f); recalc();
  }
  if (billId) find();
}

function list(host, user, focus, redraw) {
  host.innerHTML = '<div data-t></div>';
  const t = dataTable({ pageSize: 15, sort: { key: 'at', dir: 'desc' }, rowClass: (r) => (r.id === focus ? 'row-warning' : ''), empty: emptyState('undo-2', 'No returns yet'),
    rows: store.all('pReturns'),
    columns: [
      { key: 'id', label: 'Return', render: (r) => `<button class="link mono strong" data-view="${r.id}">${r.id}</button>` },
      { key: 'at', label: 'Date', render: (r) => fmtDateTime(r.at) },
      { key: 'billId', label: 'Original Bill', render: (r) => `<a class="mono" href="#/pharmacy/bills/${r.billId}">${r.billId}</a><div class="cell-sub">${esc(store.get('bills', r.billId)?.patientName)}</div>` },
      { key: 'items', label: 'Items', value: (r) => store.all('pReturnItems').filter((x) => x.returnId === r.id).length, render: (r) => store.all('pReturnItems').filter((x) => x.returnId === r.id).map((x) => `${esc(medName(x.medicineId))} ×${x.qty}${x.disposition ? ` <span class="tag tag-${x.disposition === 'RESTOCK' ? 'success' : x.disposition === 'WRITE_OFF' ? 'danger' : 'purple'}">${x.disposition.replace('_', ' ')}</span>` : ''}`).join('<br>') },
      { key: 'reason', label: 'Reason' },
      { key: 'refundAmount', label: 'Refund', align: 'right', render: (r) => `<strong>${fmtINR(r.refundAmount)}</strong><div class="cell-sub">${esc(r.refundMode)}</div>` },
      { key: 'requestedBy', label: 'Requested By', value: (r) => userName(r.requestedBy), render: (r) => esc(userName(r.requestedBy)) },
      { key: 'approvedBy', label: 'Decided By', value: (r) => userName(r.approvedBy), render: (r) => (r.approvedBy ? esc(userName(r.approvedBy)) : `<span class="cell-sub">${r.requiresOwner ? 'Owner' : 'Manager'}</span>`) },
      { key: 'status', label: 'Status', render: (r) => badge(r.status) },
      { key: '', label: '', sortable: false, align: 'right', render: (r) => (canDecideReturn(r, user) ? `<button class="btn btn-primary btn-sm" data-decide="${r.id}">${icon('clipboard-check')}Verify</button>` : '') }
    ] });
  host.querySelector('[data-t]').appendChild(t.el);
  host.onclick = (e) => {
    const d = e.target.closest('[data-decide]'); const v = e.target.closest('[data-view]');
    if (d) decide(store.get('pReturns', d.dataset.decide), user, redraw);
    if (v) { const r = store.get('pReturns', v.dataset.view); canDecideReturn(r, user) ? decide(r, user, redraw) : viewReturn(r); }
  };
  if (focus && store.get('pReturns', focus)) { const r = store.get('pReturns', focus); canDecideReturn(r, user) ? decide(r, user, redraw) : viewReturn(r); }
}

const itemsTable = (r, editable) => `<table class="table dense"><thead><tr><th>Medicine</th><th>Batch</th><th class="ta-right">Qty</th><th>Condition</th><th>${editable ? 'Decision' : 'Disposition'}</th><th class="ta-right">Refund</th></tr></thead><tbody>
  ${store.all('pReturnItems').filter((x) => x.returnId === r.id).map((ri) => { const b = store.get('batches', ri.batchId); return `<tr><td>${esc(medName(ri.medicineId))}</td><td class="mono">${esc(b.batchNo)}<div class="cell-sub">exp ${fmtDate(b.expiryDate)} · ${batchStatus(b).replace('_', ' ').toLowerCase()}</div></td><td class="ta-right">${ri.qty}</td><td>${esc(CONDITIONS.find((c) => c[0] === ri.condition)?.[1] || ri.condition)}</td>
    <td>${editable ? `<select class="input input-sm" data-disp="${ri.id}">${allowedDispositions(ri).map((o) => `<option value="${o}">${DISP[o]}</option>`).join('')}</select>` : ri.disposition ? `${DISP[ri.disposition]}${ri.movementId ? ` <a class="mono small" href="#/movements?ref=${r.id}">${ri.movementId}</a>` : ''}` : '—'}</td><td class="ta-right">${fmtINR(ri.refundAmount)}</td></tr>`; }).join('')}</tbody></table>`;

function viewReturn(r) {
  openModal({ title: `Return ${r.id}`, subtitle: `Against ${r.billId} · ${fmtDateTime(r.at)}`, size: 'lg',
    body: `<div class="row mb-2">${badge(r.status)}<span class="muted small">Reason: <strong>${esc(r.reason)}</strong> · requested by ${esc(userName(r.requestedBy))}</span></div>${itemsTable(r, false)}
      <div class="kv mt-2"><span>Refund</span><strong>${fmtINR(r.refundAmount)} via ${esc(modeLabel(r.refundMode))}${r.refundTxnId ? ` (${r.refundTxnId})` : ''}</strong></div>${r.notes ? `<p class="muted small">${esc(r.notes)}</p>` : ''}${r.rejectionReason ? `<div class="alert alert-danger mt-1">${icon('x-circle')}<div>${esc(r.rejectionReason)}</div></div>` : ''}`,
    footer: [{ label: 'Close', cls: 'btn-primary', onClick: (c) => c() }] });
}
function decide(r, user, done) {
  openModal({ title: `Verify return ${r.id}`, subtitle: `Bill ${r.billId} · ${esc(r.reason)} · requested by ${esc(userName(r.requestedBy))}`, size: 'lg',
    body: `<div class="alert alert-info mb-2">${icon('info')}<div>Inspect each returned item. <strong>Restock</strong> is offered only for unopened items from a batch that is still sellable — it creates a PATIENT_RETURN stock movement. Quarantine and write-off do not add stock.</div></div>${itemsTable(r, true)}
      <div class="kv mt-2"><span>Refund to pay</span><strong>${fmtINR(r.refundAmount)} via ${esc(modeLabel(r.refundMode))}</strong></div>${r.notes ? `<p class="muted small">${esc(r.notes)}</p>` : ''}`,
    footer: [{ label: 'Reject', cls: 'btn-danger-outline', onClick: async (close) => { close(); const x = await confirmDialog({ title: 'Reject return?', reason: true, confirmLabel: 'Reject', tone: 'danger', iconName: 'x-circle', message: 'No refund will be paid and no stock will move.' }); if (!x) return; try { rejectReturn(r.id, x.reason, user); toast(`${r.id} rejected.`, 'info'); done(); } catch (e) { toast(e.message, 'error'); } } },
      { label: 'Approve & refund', cls: 'btn-primary', icon: 'check', onClick: (close, w) => {
        const decisions = Object.fromEntries([...w.querySelectorAll('[data-disp]')].map((s) => [s.dataset.disp, s.value]));
        try { approveReturn(r.id, decisions, user); toast(`${r.id} approved. Refund ${fmtINR(r.refundAmount)} recorded.`); close(); done(); } catch (e) { toast(e.message, 'error'); }
      } }] });
}
