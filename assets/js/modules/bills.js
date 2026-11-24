// Pharmacy bill history, bill details (payments, returns, cancellation) and printable receipt
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { userName, medName } from '../calculations.js';
import { billItems, billPayments, billPaid, billBalance, billModeLabel, returnedQty, pendingReturnQty, modeLabel, BILL_STATUSES, PAY_MODES } from '../pharmacy-calc.js';
import { collectPayment, requestCancellation, approveCancellation, rejectCancellation, canCancelBill } from '../pharmacy-services.js';
import { badge, dataTable, exportTable, emptyState, card, dl, openModal, confirmDialog, kpi } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, fmtDate, fmtDateTime, ymd, debounce, titleCase, refreshIcons } from '../utils.js';
import { setMeta } from '../app.js';
import { navigate } from '../router.js';
import { r2 } from '../pricing.js';

const typeLabel = (t) => (t === 'WALKIN' ? 'Walk-in' : 'Patient');

export function renderList(view, params, query) {
  const all = () => [...store.all('bills')].sort((a, b) => b.at.localeCompare(a.at));
  view.innerHTML = `
    <div class="page-head"><div><p class="muted">Completed bills are never deleted. Cancellations and returns are separate, audited transactions.</p></div>
      <div class="page-actions"><button class="btn btn-secondary" data-export>${icon('download')}Export CSV</button>${can('pharmacy.bill') ? `<a class="btn btn-primary" href="#/pharmacy/bill">${icon('plus')}Pharmacy Sale</a>` : ''}</div></div>
    <div class="kpis mb-2" data-kpis></div>
    <section class="card"><div class="toolbar">
      <div class="search">${icon('search')}<input class="input" type="search" placeholder="Bill number, patient, UHID or phone…" data-f="q"></div>
      <span class="filter-label">From</span><input type="date" class="input" data-f="from"><span class="filter-label">To</span><input type="date" class="input" data-f="to">
      <select class="input" data-f="mode"><option value="">All payment modes</option>${PAY_MODES.map((m) => `<option value="${m}">${esc(modeLabel(m))}</option>`).join('')}<option value="SPLIT">Split payment</option><option value="UNPAID">Unpaid</option></select>
      <select class="input" data-f="cashier"><option value="">All cashiers</option>${store.all('users').map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
      <select class="input" data-f="status"><option value="">All statuses</option>${BILL_STATUSES.map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('')}</select>
      <select class="input" data-f="type"><option value="">All customers</option><option value="PATIENT">Registered patients</option><option value="WALKIN">Walk-in customers</option></select>
      <button class="btn btn-ghost btn-sm" data-clear>${icon('x')}Clear</button></div><div data-table></div></section>`;
  const columns = [
    { key: 'id', label: 'Bill Number', render: (b) => `<a class="cell-main mono" href="#/pharmacy/bills/${b.id}">${esc(b.id)}</a>` },
    { key: 'at', label: 'Date & Time', render: (b) => fmtDateTime(b.at), csv: (b) => fmtDateTime(b.at) },
    { key: 'patientName', label: 'Patient / Customer', render: (b) => `${esc(b.patientName)}<div class="cell-sub">${esc(b.uhid || b.phone || '')}</div>` },
    { key: 'saleType', label: 'Customer', render: (b) => `<span class="tag ${b.saleType === 'WALKIN' ? 'tag-neutral' : 'tag-info'}">${typeLabel(b.saleType)}</span>`, csv: (b) => typeLabel(b.saleType) },
    { key: 'cashier', label: 'Cashier', value: (b) => userName(b.cashierId), render: (b) => esc(userName(b.cashierId)) },
    { key: 'lineCount', label: 'Items', align: 'right' },
    { key: 'grandTotal', label: 'Bill Amount', align: 'right', render: (b) => `<strong>${fmtINR(b.grandTotal)}</strong>` },
    { key: 'paid', label: 'Amount Paid', align: 'right', value: (b) => billPaid(b), render: (b) => fmtINR(billPaid(b)) },
    { key: 'mode', label: 'Payment Mode', value: (b) => billModeLabel(b), render: (b) => `<span class="small">${esc(billModeLabel(b))}</span>` },
    { key: 'paymentStatus', label: 'Payment Status', render: (b) => (b.status === 'CANCELLED' ? badge('CANCELLED', 'Refunded') : badge(b.paymentStatus)) },
    { key: 'status', label: 'Bill Status', render: (b) => badge(b.status) + (b.cancellationId && store.get('cancellations', b.cancellationId)?.status === 'PENDING' ? ' <span class="tag tag-warning">Cancel requested</span>' : '') },
    { key: '', label: '', sortable: false, csv: false, align: 'right', render: (b) => `<div class="row-actions"><a class="btn btn-ghost btn-sm" href="#/pharmacy/bills/${b.id}" title="View">${icon('eye')}</a><a class="btn btn-ghost btn-sm" href="#/pharmacy/bills/${b.id}/receipt" title="Receipt">${icon('printer')}</a></div>` }
  ];
  const t = dataTable({ columns, pageSize: 25, sort: { key: 'at', dir: 'desc' }, onRowClick: (b) => navigate('#/pharmacy/bills/' + b.id), rowClass: (b) => (b.status === 'CANCELLED' ? 'row-danger' : billBalance(b) > 0 ? 'row-warning' : ''), empty: emptyState('receipt', 'No bills match the filters') });
  view.querySelector('[data-table]').appendChild(t.el);
  const f = (n) => view.querySelector(`[data-f="${n}"]`);
  if (query.status) f('status').value = query.status;
  if (query.date) { f('from').value = query.date; f('to').value = query.date; }
  if (query.cashier) f('cashier').value = query.cashier;
  const apply = () => {
    const q = f('q').value.trim().toLowerCase();
    const rows = all().filter((b) => (!q || [b.id, b.patientName, b.uhid, b.phone].join(' ').toLowerCase().includes(q)) && (!f('from').value || b.businessDate >= f('from').value) && (!f('to').value || b.businessDate <= f('to').value)
      && (!f('cashier').value || b.cashierId === f('cashier').value) && (!f('status').value || b.status === f('status').value) && (!f('type').value || b.saleType === f('type').value)
      && (!f('mode').value || (f('mode').value === 'SPLIT' ? billModeLabel(b).startsWith('SPLIT') : f('mode').value === 'UNPAID' ? billBalance(b) > 0 : billModeLabel(b) === f('mode').value)));
    t.setRows(rows);
    const live = rows.filter((b) => b.status !== 'CANCELLED');
    view.querySelector('[data-kpis]').innerHTML = kpi({ label: 'Bills', value: fmtNum(rows.length), iconName: 'receipt', tone: 'navy', sub: `${rows.length - live.length} cancelled` })
      + kpi({ label: 'Bill Amount', value: fmtINR(live.reduce((s, b) => s + b.grandTotal, 0), true), iconName: 'indian-rupee', tone: 'teal' })
      + kpi({ label: 'Amount Paid', value: fmtINR(live.reduce((s, b) => s + billPaid(b), 0), true), iconName: 'wallet', tone: 'success' })
      + kpi({ label: 'Pending', value: fmtINR(live.reduce((s, b) => s + billBalance(b), 0), true), iconName: 'hourglass', tone: 'warning' });
    refreshIcons(view.querySelector('[data-kpis]'));
  };
  view.querySelectorAll('[data-f]').forEach((el) => el.addEventListener(el.type === 'search' ? 'input' : 'change', debounce(apply, 120)));
  view.querySelector('[data-clear]').onclick = () => { view.querySelectorAll('[data-f]').forEach((el) => { el.value = ''; }); apply(); };
  view.querySelector('[data-export]').onclick = () => { exportTable(`pharmacy-bills-${ymd()}.csv`, columns, t.getRows()); toast('Bill history exported.'); };
  apply();
}

export function renderDetails(view, params) {
  const b = store.get('bills', params.id);
  if (!b) { view.innerHTML = emptyState('receipt', 'Bill not found', '', '<a class="btn btn-primary" href="#/pharmacy/bills">Pharmacy Bills</a>'); return; }
  const user = currentUser();
  setMeta({ title: b.id, crumbs: [{ label: 'Billing' }, { label: 'Pharmacy Bills', href: '#/pharmacy/bills' }, b.id] });
  const items = billItems(b.id); const pays = billPayments(b.id);
  const rets = store.all('pReturns').filter((r) => r.billId === b.id);
  const canc = b.cancellationId && store.get('cancellations', b.cancellationId);
  const pendingCanc = canc && canc.status === 'PENDING' ? canc : null;
  const bal = billBalance(b);
  const actions = [`<a class="btn btn-secondary" href="#/pharmacy/bills/${b.id}/receipt">${icon('printer')}Receipt</a>`];
  if (bal > 0 && can('pharmacy.payment.collect')) actions.push(`<button class="btn btn-primary" data-a="collect">${icon('wallet')}Collect ${fmtINR(bal)}</button>`);
  if (b.status !== 'CANCELLED' && bal <= 0 && can('pharmacy.return.request') && items.some((i) => i.qty - returnedQty(i.id) - pendingReturnQty(i.id) > 0)) actions.push(`<a class="btn btn-secondary" href="#/pharmacy/returns?bill=${b.id}">${icon('undo-2')}Return items</a>`);
  if (pendingCanc && can('pharmacy.cancel')) actions.push(`<button class="btn btn-danger-outline" data-a="rejcanc">Reject cancellation</button><button class="btn btn-danger" data-a="appcanc">${icon('circle-slash')}Approve cancellation</button>`);
  else if (!pendingCanc && b.status !== 'CANCELLED' && canCancelBill(b) && (can('pharmacy.cancel') || can('pharmacy.cancel.request'))) actions.push(`<button class="btn btn-danger-outline" data-a="cancel">${icon('circle-slash')}${can('pharmacy.cancel') ? 'Cancel bill' : 'Request cancellation'}</button>`);

  view.innerHTML = `
    <div class="page-head"><div><div class="row"><h1 class="mono">${esc(b.id)}</h1>${badge(b.status)}${b.status !== 'CANCELLED' ? badge(b.paymentStatus) : ''}</div>
      <p class="muted">${fmtDateTime(b.at)} · business date ${fmtDate(b.businessDate)} · cashier ${esc(userName(b.cashierId))}</p></div><div class="page-actions">${actions.join('')}</div></div>
    ${b.status === 'CANCELLED' ? `<div class="alert alert-danger mb-2">${icon('circle-slash')}<div><strong>Cancelled</strong> on ${fmtDateTime(b.cancelledAt)} by ${esc(userName(canc?.approvedBy))}. Reason: ${esc(canc?.reason)}. Stock was reversed and ${fmtINR(billPaid(b))} refunded. The bill is kept for audit.</div></div>` : ''}
    ${pendingCanc ? `<div class="alert alert-warning mb-2">${icon('hourglass')}<div><strong>Cancellation requested</strong> by ${esc(userName(pendingCanc.requestedBy))} on ${fmtDateTime(pendingCanc.requestedAt)}: ${esc(pendingCanc.reason)}</div></div>` : ''}
    <div class="kpis">
      ${kpi({ label: 'Grand Total', value: fmtINR(b.grandTotal), iconName: 'receipt', tone: 'navy', sub: `${b.lineCount} line(s)` })}
      ${kpi({ label: 'Paid', value: fmtINR(billPaid(b)), iconName: 'wallet', tone: 'success', sub: esc(billModeLabel(b)) })}
      ${kpi({ label: 'Balance Due', value: fmtINR(bal), iconName: 'hourglass', tone: bal > 0 ? 'warning' : 'teal' })}
      ${kpi({ label: 'Refunded', value: fmtINR(pays.filter((p) => p.kind === 'REFUND').reduce((s, p) => s + p.amount, 0)), iconName: 'undo-2', tone: 'purple' })}
    </div>
    <div class="grid grid-3-1">
      ${card('Items', `<div class="table-scroll"><table class="table dense"><thead><tr><th>#</th><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="ta-right">Qty</th><th class="ta-right">Returned</th><th class="ta-right">MRP</th><th class="ta-right">Disc</th><th class="ta-right">GST</th><th class="ta-right">Amount</th></tr></thead><tbody>
        ${items.map((i) => `<tr><td>${i.lineNo}</td><td><a class="cell-main" href="#/inventory/${i.medicineId}">${esc(medName(i.medicineId))}</a></td><td><a class="mono" href="#/batches/${i.batchId}">${esc(i.batchNo)}</a></td><td>${fmtDate(i.expiryDate)}</td>
          <td class="ta-right">${i.qty}</td><td class="ta-right">${returnedQty(i.id) ? `<span class="text-warning">${returnedQty(i.id)}</span>` : '—'}${pendingReturnQty(i.id) ? `<div class="cell-sub">${pendingReturnQty(i.id)} pending</div>` : ''}</td>
          <td class="ta-right">${fmtINR(i.unitPrice)}</td><td class="ta-right">${i.itemDiscount + i.billDiscountShare ? fmtINR(i.itemDiscount + i.billDiscountShare) : '—'}</td><td class="ta-right">${i.gstPct}%<div class="cell-sub">${fmtINR(i.gstAmount)}</div></td><td class="ta-right strong">${fmtINR(i.netAmount)}</td></tr>`).join('')}</tbody></table></div>
        <div class="bt-sum" style="padding:14px 20px;max-width:360px;margin-left:auto">${totalsBlock(b)}</div>`, { cls: 'flush' })}
      ${card('Patient & Bill', dl([['Patient / Customer', esc(b.patientName)], ['UHID', esc(b.uhid || '—')], ['Phone', esc(b.phone || '—')], ['Customer type', b.saleType === 'WALKIN' ? 'Walk-in customer' : 'Registered patient'], ['Doctor', esc(b.doctor || '—')], ['Prescription', esc(b.prescriptionRef || '—')],
        ['Discount authorised by', b.discountAuthorizedBy ? esc(userName(b.discountAuthorizedBy)) : '—'], ['Remarks', esc(b.remarks || '—')]]))}
    </div>
    ${card('Payment Transactions', `<table class="table dense"><thead><tr><th>Txn</th><th>Date & Time</th><th>Type</th><th>Mode</th><th>Reference</th><th class="ta-right">Amount</th><th class="ta-right">Tendered / Change</th><th>By</th><th>Note</th></tr></thead><tbody>
      ${pays.map((p) => `<tr><td class="mono">${p.id}</td><td>${fmtDateTime(p.at)}</td><td>${p.kind === 'REFUND' ? '<span class="tag tag-danger">REFUND</span>' : '<span class="tag tag-success">PAYMENT</span>'}</td><td>${esc(modeLabel(p.mode))}</td><td class="mono small">${esc(p.reference || '—')}</td>
        <td class="ta-right strong ${p.kind === 'REFUND' ? 'text-danger' : ''}">${p.kind === 'REFUND' ? '−' : ''}${fmtINR(p.amount)}</td><td class="ta-right small">${p.tendered != null ? `${fmtINR(p.tendered)} / ${fmtINR(p.change)}` : '—'}</td><td>${esc(userName(p.userId))}</td><td class="cell-sub">${esc(p.note || '')}</td></tr>`).join('') || `<tr><td colspan="9">${emptyState('wallet', 'No payments recorded')}</td></tr>`}</tbody></table>`, { cls: 'flush mt-2' })}
    ${rets.length ? card('Returns', `<table class="table dense"><thead><tr><th>Return</th><th>Date</th><th>Reason</th><th class="ta-right">Refund</th><th>Mode</th><th>Status</th></tr></thead><tbody>${rets.map((r) => `<tr><td><a class="mono" href="#/pharmacy/returns?focus=${r.id}">${r.id}</a></td><td>${fmtDateTime(r.at)}</td><td>${esc(r.reason)}</td><td class="ta-right">${fmtINR(r.refundAmount)}</td><td>${esc(r.refundMode)}</td><td>${badge(r.status)}</td></tr>`).join('')}</tbody></table>`, { cls: 'flush mt-2' }) : ''}`;

  const rerender = () => renderDetails(view, params);
  view.querySelectorAll('[data-a]').forEach((btn) => { btn.onclick = async () => {
    try {
      const a = btn.dataset.a;
      if (a === 'collect') collectDialog(b, user, rerender);
      if (a === 'cancel') {
        const r = await confirmDialog({ title: can('pharmacy.cancel') ? `Cancel ${b.id}?` : `Request cancellation of ${b.id}?`, tone: 'danger', iconName: 'circle-slash', reason: true, reasonLabel: 'Cancellation reason', confirmLabel: can('pharmacy.cancel') ? 'Cancel bill' : 'Send request',
          message: can('pharmacy.cancel') ? `Stock of all ${b.lineCount} line(s) will be reversed into the original batches and ${fmtINR(billPaid(b))} refunded in the original payment mode(s). The bill stays in history as CANCELLED.` : 'A Pharmacy Manager must approve the cancellation. The owner will be notified.' });
        if (!r) return; requestCancellation(b.id, r.reason, user); toast(can('pharmacy.cancel') ? `${b.id} cancelled. Stock reversed and refund recorded.` : 'Cancellation request sent for approval.', can('pharmacy.cancel') ? 'success' : 'info'); rerender();
      }
      if (a === 'appcanc') { if (!(await confirmDialog({ title: 'Approve cancellation?', tone: 'danger', iconName: 'circle-slash', confirmLabel: 'Approve & cancel bill', message: `Reverse stock and refund ${fmtINR(billPaid(b))}. Reason given: ${esc(pendingCanc.reason)}` }))) return; approveCancellation(pendingCanc.id, user); toast(`${b.id} cancelled.`); rerender(); }
      if (a === 'rejcanc') { const r = await confirmDialog({ title: 'Reject cancellation request?', reason: true, confirmLabel: 'Reject', iconName: 'x-circle', message: 'The bill remains valid.' }); if (!r) return; rejectCancellation(pendingCanc.id, r.reason, user); toast('Cancellation request rejected.', 'info'); rerender(); }
    } catch (e) { toast(e.message, 'error'); }
  }; });
}

function totalsBlock(b) {
  return `<div class="kv"><span>Subtotal (MRP)</span><span>${fmtINR(b.gross)}</span></div>${b.itemDiscount ? `<div class="kv"><span>Item discounts</span><span>− ${fmtINR(b.itemDiscount)}</span></div>` : ''}${b.billDiscount ? `<div class="kv"><span>Bill discount (${b.billDiscountPct}%)</span><span>− ${fmtINR(b.billDiscount)}</span></div>` : ''}
    <div class="kv"><span>Taxable value</span><span>${fmtINR(b.taxable)}</span></div><div class="kv"><span>GST (included)</span><span>${fmtINR(b.gst)}</span></div>${b.roundOff ? `<div class="kv"><span>Round off</span><span>${fmtINR(b.roundOff)}</span></div>` : ''}<div class="kv bt-grand"><span>Grand Total</span><span>${fmtINR(b.grandTotal)}</span></div>`;
}

function collectDialog(b, user, done) {
  const due = billBalance(b);
  openModal({ title: `Collect balance — ${b.id}`, subtitle: `Balance due ${fmtINR(due)}`, size: 'sm',
    body: `<div class="form-grid"><div class="field col-6"><label>Mode</label><select class="input" data-m>${store.ph().paymentModes.filter((m) => m.active).map((m) => `<option value="${m.code}">${esc(m.label)}</option>`).join('')}</select></div>
      <div class="field col-6"><label>Amount</label><input class="input" type="number" min="1" step="0.01" data-amt value="${due}"></div><div class="field col-12"><label>Reference</label><input class="input" data-ref placeholder="UPI UTR / card last 4 (optional for cash)"></div></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Record payment', cls: 'btn-primary', onClick: (close, w) => {
      try { const amt = r2(w.querySelector('[data-amt]').value); collectPayment(b.id, [{ mode: w.querySelector('[data-m]').value, amount: amt, tendered: amt, reference: w.querySelector('[data-ref]').value }], user); toast(`${fmtINR(amt)} collected.`); close(); done(); } catch (e) { toast(e.message, 'error'); }
    } }] });
}

export function renderReceipt(view, params, query) {
  const b = store.get('bills', params.id);
  if (!b) { view.innerHTML = emptyState('receipt', 'Bill not found'); return; }
  setMeta({ title: `Receipt ${b.id}`, crumbs: [{ label: 'Billing' }, { label: 'Pharmacy Bills', href: '#/pharmacy/bills' }, b.id, 'Receipt'] });
  const s = store.settings(); const rc = store.ph().receipt; const items = billItems(b.id); const pays = billPayments(b.id).filter((p) => p.kind === 'PAYMENT');
  const tendered = r2(pays.reduce((t, p) => t + (p.mode === 'CASH' ? Number(p.tendered || p.amount) : p.amount), 0)); const change = r2(pays.reduce((t, p) => t + (Number(p.change) || 0), 0));
  view.innerHTML = `
    ${query.new ? `<div class="alert alert-success mb-2 no-print">${icon('check-circle-2')}<div><strong>Bill completed.</strong> Stock has been deducted from the selected batches and the payment is recorded.</div></div>` : ''}
    <div class="row mb-2 no-print" style="justify-content:center"><button class="btn btn-primary" data-print>${icon('printer')}Print Receipt</button><button class="btn btn-secondary" data-pdf>${icon('file-down')}Save as PDF</button>
      <a class="btn btn-secondary" href="#/pharmacy/bills/${b.id}">${icon('eye')}View Bill</a><a class="btn btn-ghost" href="#/pharmacy/bill">${icon('arrow-left')}Return to Billing</a></div>
    <article class="receipt">
      <header class="rc-head"><div class="rc-brand">${s.logo ? `<img src="${esc(s.logo)}" alt="" style="max-height:44px">` : `<div class="rc-mark">${esc(s.hospitalName.slice(0, 1))}</div>`}<div><h2>${esc(s.hospitalName)} — Pharmacy</h2><p>${esc(rc.address)}</p>${[rc.phone && 'Ph: ' + esc(rc.phone), rc.gstin && 'GSTIN: ' + esc(rc.gstin)].filter(Boolean).length ? `<p>${[rc.phone && 'Ph: ' + esc(rc.phone), rc.gstin && 'GSTIN: ' + esc(rc.gstin)].filter(Boolean).join(' · ')}</p>` : ''}${rc.drugLicense ? `<p>DL No: ${esc(rc.drugLicense)}</p>` : ''}</div></div>
        <div class="rc-title">${b.status === 'CANCELLED' ? 'CANCELLED BILL' : 'TAX INVOICE / CASH BILL'}</div></header>
      <div class="rc-meta"><div><span>Bill No</span><strong class="mono">${esc(b.id)}</strong></div><div><span>Date & Time</span><strong>${fmtDateTime(b.at)}</strong></div><div><span>${b.uhid ? 'Patient ID' : 'Customer'}</span><strong>${esc(b.uhid || 'Walk-in')}</strong></div><div><span>Cashier</span><strong>${esc(userName(b.cashierId))}</strong></div>
        <div><span>Patient</span><strong>${esc(b.patientName)}</strong></div><div><span>UHID / Phone</span><strong>${esc(b.uhid || '—')} ${b.phone ? '· ' + esc(b.phone) : ''}</strong></div><div><span>Doctor</span><strong>${esc(b.doctor || '—')}</strong></div><div><span>Prescription</span><strong>${esc(b.prescriptionRef || '—')}</strong></div></div>
      <table class="rc-table"><thead><tr><th>#</th><th>Medicine</th><th>Batch</th><th>Exp</th><th class="r">Qty</th><th class="r">MRP</th><th class="r">Disc</th><th class="r">GST</th><th class="r">Amount</th></tr></thead><tbody>
        ${items.map((i) => `<tr><td>${i.lineNo}</td><td>${esc(medName(i.medicineId))}</td><td class="mono">${esc(i.batchNo)}</td><td>${esc(i.expiryDate.slice(5, 7) + '/' + i.expiryDate.slice(2, 4))}</td><td class="r">${i.qty}</td><td class="r">${i.unitPrice.toFixed(2)}</td><td class="r">${(i.itemDiscount + i.billDiscountShare).toFixed(2)}</td><td class="r">${i.gstPct}%<br><small>${i.gstAmount.toFixed(2)}</small></td><td class="r">${i.netAmount.toFixed(2)}</td></tr>`).join('')}</tbody></table>
      <div class="rc-foot"><div class="rc-gst"><strong>GST summary (included in MRP)</strong>${[...new Set(items.map((i) => i.gstPct))].map((g) => { const L = items.filter((i) => i.gstPct === g); return `<div>${g}%: taxable ${fmtINR(L.reduce((t, i) => t + i.taxableValue, 0))} · CGST ${fmtINR(L.reduce((t, i) => t + i.gstAmount, 0) / 2)} · SGST ${fmtINR(L.reduce((t, i) => t + i.gstAmount, 0) / 2)}</div>`; }).join('')}</div>
        <div class="rc-totals">${totalsBlock(b)}
          <div class="kv"><span>Payment</span><span>${pays.map((p) => `${esc(modeLabel(p.mode))} ${fmtINR(p.amount)}`).join(' + ') || 'Unpaid'}</span></div>
          <div class="kv"><span>Amount received</span><span>${fmtINR(tendered)}</span></div><div class="kv"><span>${billBalance(b) > 0 ? 'Balance due' : 'Change returned'}</span><span>${fmtINR(billBalance(b) > 0 ? billBalance(b) : change)}</span></div></div></div>
      <p class="rc-thanks">${esc(rc.footer)}</p><p class="rc-small">Medicines once sold are returnable only as per pharmacy policy with this bill. This is a computer-generated receipt.</p>
    </article>`;
  view.querySelector('[data-print]').onclick = () => window.print();
  view.querySelector('[data-pdf]').onclick = () => { toast('In the print dialog choose “Save as PDF” as the destination.', 'info', 'Export PDF'); setTimeout(() => window.print(), 400); };
}
