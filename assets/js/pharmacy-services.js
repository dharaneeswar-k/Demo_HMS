// Module 3 — Pharmacy transactions. Each public function runs inside ONE store.transaction(), so a failure
// (e.g. insufficient stock discovered on the last line) rolls back every bill, payment and stock movement.
import { store } from './data-service.js';
import { can, roleLabel } from './auth.js';
import { PHARMACY, batchBalance, batchStatus, isIssuable, medicineStock, stockStatus, medName, daysUntil } from './calculations.js';
import { createMovement, audit } from './services.js';
import { notify } from './notifications.js';
import { priceBill, lineRefund, r2 } from './pricing.js';
import { businessDate, billItems, billPayments, billPaid, billBalance, eligibleReturnQty, refreshBill, daySummary, closingFor, PAY_MODES } from './pharmacy-calc.js';
import { fmtINR } from './utils.js';

const now = () => new Date().toISOString();
const ph = () => store.ph();
const OWNER_ROLES = ['SUPER_ADMIN'];

// ---------------- discount authority ----------------
export function discountLimit(user) {
  if (user && can('pharmacy.discount.owner', user)) return 100;
  // One hospital-wide ceiling (default 10%) for staff and managers; only the owner can approve more.
  return Number(ph().discountLimits.staffPct) || 0;
}
/** Supervisor override at the counter. Returns the authorising user or throws. */
export function verifyAuthorizer(username, password, neededPct) {
  const u = store.all('users').find((x) => x.username === String(username).trim().toLowerCase());
  if (!u || u.password !== password || !u.active) throw new Error('Authoriser credentials are not valid.');
  if (!can('pharmacy.discount.owner', u)) throw new Error(`Only the Hospital Owner can approve a discount above ${discountLimit(null)}%. ${u.name} (${roleLabel(u)}) cannot.`);
  return u;
}

// ---------------- pricing a draft ----------------
/** Builds priced lines from a draft (unit price = batch MRP, GST rate from the medicine master). */
export function priceDraft(draft) {
  const lines = draft.lines.map((l) => {
    const b = store.get('batches', l.batchId); const m = store.get('medicines', l.medicineId);
    return { ...l, batchNo: b?.batchNo, expiryDate: b?.expiryDate, unitPrice: b ? b.mrp : 0, gstPct: m ? m.gstPct : 0, unit: m?.unit };
  });
  return priceBill(lines, draft.billDiscountPct || 0, { roundToRupee: ph().roundToRupee !== false });
}
export const effectiveDiscountPct = (t) => (t.gross ? r2(t.discountTotal / t.gross * 100) : 0);

/** All checks a bill must pass before completion. Returns { errors, warnings, priced }. */
export function validateBillDraft(draft, user) {
  const errors = []; const warnings = [];
  if (!draft.lines.length) errors.push('Add at least one medicine.');
  if (draft.saleType === 'PATIENT' && !draft.patientId) errors.push('Select the registered patient (search by name, Patient ID or mobile), or switch to Walk-in customer.');
  const perBatch = {};
  draft.lines.forEach((l, i) => {
    const b = store.get('batches', l.batchId); const n = medName(l.medicineId);
    if (!b) { errors.push(`Line ${i + 1}: select a batch for ${n}.`); return; }
    if (!Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0) errors.push(`Line ${i + 1} (${n}): quantity must be a whole number above 0.`);
    if (!isIssuable(b)) errors.push(`Line ${i + 1} (${n}): batch ${b.batchNo} is ${batchStatus(b).replace('_', ' ').toLowerCase()} and cannot be dispensed.`);
    const d = Number(l.discountPct) || 0; if (d < 0 || d > 100) errors.push(`Line ${i + 1}: discount must be 0–100%.`);
    perBatch[b.id] = (perBatch[b.id] || 0) + Number(l.qty || 0);
    if (daysUntil(b.expiryDate) <= (store.settings().criticalExpiryDays || 30)) warnings.push(`${n} batch ${b.batchNo} expires in ${daysUntil(b.expiryDate)} day(s) — counsel the patient on use-before date.`);
  });
  Object.entries(perBatch).forEach(([bid, q]) => { const b = store.get('batches', bid); const av = batchBalance(bid, PHARMACY()); if (q > av) errors.push(`${medName(b.medicineId)} batch ${b.batchNo}: only ${av} on the pharmacy shelf, ${q} requested.`); });
  const bd = Number(draft.billDiscountPct) || 0; if (bd < 0 || bd > 100) errors.push('Bill discount must be 0–100%.');
  const priced = draft.lines.length ? priceDraft(draft) : null;
  if (priced) {
    const eff = effectiveDiscountPct(priced.totals);
    const lim = discountLimit(user);
    const req = draft.discountRequestId && store.get('discountRequests', draft.discountRequestId);
    const reqOk = req && req.status === 'APPROVED' && req.requestedPct + 0.001 >= eff && Math.abs(req.snapshot.gross - priced.totals.gross) < 1;
    if (eff > lim + 0.001 && !(draft.authorizer && discountLimit(draft.authorizer) >= eff) && !reqOk) {
      errors.push(req && req.status === 'PENDING' ? `Waiting for the owner to approve the ${req.requestedPct}% discount.` : req && req.status === 'APPROVED' ? 'The bill changed after the discount was approved. Send a new request or reduce the discount.' : `Discount ${eff}% is above the ${lim}% limit. Owner approval is required.`);
    }
    const pay = paymentPlan(draft, priced.totals.grandTotal);
    errors.push(...pay.errors); warnings.push(...pay.warnings);
  }
  return { errors, warnings, priced };
}

/** Validates the payment split for a bill total. */
export function paymentPlan(draft, total) {
  const errors = []; const warnings = [];
  const pays = (draft.payments || []).filter((p) => Number(p.amount) > 0);
  let applied = 0; let change = 0;
  pays.forEach((p) => {
    const amt = r2(p.amount);
    if (!PAY_MODES.includes(p.mode)) errors.push(`Unknown payment mode ${p.mode}.`);
    if (!ph().paymentModes.find((m) => m.code === p.mode)?.active) errors.push(`${p.mode} payments are disabled in settings.`);
    if (p.mode === 'CASH' && p.tendered != null && p.tendered !== '' && Number(p.tendered) < amt) errors.push('Cash tendered is less than the cash amount.');
    if (p.mode === 'CASH' && Number(p.tendered) > amt) change = r2(change + Number(p.tendered) - amt);
    if (p.mode === 'UPI' && !String(p.reference || '').trim()) warnings.push('UPI transaction reference not entered.');
    applied = r2(applied + amt);
  });
  if (applied > total + 0.005) errors.push(`Payments (${fmtINR(applied)}) exceed the bill total (${fmtINR(total)}). Record cash tendered separately to give change.`);
  const due = r2(total - applied);
  if (due > 0.005) {
    const credit = ph().allowCredit && !!draft.patientId;
    if (!credit) errors.push(`Balance ${fmtINR(due)} is unpaid. ${ph().allowCredit ? 'Credit is only given to registered patients' : 'Credit sales are turned off'} — collect the full amount.`);
    else if (!draft.patientName?.trim() || !(draft.phone?.trim() || draft.uhid?.trim())) errors.push('Credit / pending bills need the patient name and a phone number or UHID.');
    else warnings.push(`${fmtINR(due)} will remain pending (${applied ? 'partially paid' : 'unpaid'}).`);
  }
  return { errors, warnings, applied, due, change };
}

// ---------------- complete bill ----------------
export function completeBill(draft, user) {
  const date = businessDate();
  if (closingFor(date, user.id)) throw new Error(`Your counter for ${date} has already been closed. Billing is locked for this business day.`);
  const v = validateBillDraft(draft, user);
  if (v.errors.length) throw new Error(v.errors[0]);
  const { lines, totals } = v.priced;
  const medsBefore = Object.fromEntries([...new Set(lines.map((l) => l.medicineId))].map((id) => [id, stockStatus(store.get('medicines', id))]));
  return store.transaction(() => {
    const year = new Date().getFullYear();
    const id = store.nextId('bills', `${ph().billPrefix || 'PB'}-${year}-`, 5);
    const at = now();
    const patient = draft.patientId ? store.get('patients', draft.patientId) : null;
    const bill = store.insert('bills', {
      id, billNo: id, at, businessDate: date, saleType: patient ? 'PATIENT' : 'WALKIN', patientId: patient?.id || null, patientName: draft.patientName?.trim() || 'Walk-in Customer',
      uhid: draft.uhid || '', phone: draft.phone || '', doctor: draft.doctor || '', prescriptionRef: draft.prescriptionRef || '', cashierId: user.id,
      billDiscountPct: Number(draft.billDiscountPct) || 0, ...totals, lineCount: lines.length, discountAuthorizedBy: effectiveDiscountPct(totals) > discountLimit(user) ? (draft.authorizer?.id || store.get('discountRequests', draft.discountRequestId)?.decidedBy || null) : null,
      discountRequestId: effectiveDiscountPct(totals) > discountLimit(user) && !draft.authorizer ? draft.discountRequestId || null : null,
      status: 'COMPLETED', paymentStatus: 'PAID', paymentMode: '', amountPaid: 0, balanceDue: 0, remarks: draft.remarks || '', createdAt: at
    });
    lines.forEach((l, i) => {
      store.insert('billItems', { id: store.nextId('billItems', 'PBI-', 6), billId: id, lineNo: i + 1, medicineId: l.medicineId, batchId: l.batchId, batchNo: l.batchNo, expiryDate: l.expiryDate,
        qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, discountPct: Number(l.discountPct) || 0, gstPct: l.gstPct, gross: l.gross, itemDiscount: l.itemDiscount,
        billDiscountShare: l.billDiscountShare, taxableValue: l.taxableValue, gstAmount: l.gstAmount, netAmount: l.netAmount });
      // Throws (and rolls back everything) if the batch no longer has enough stock.
      createMovement({ batchId: l.batchId, type: 'PHARMACY_SALE', qty: l.qty, reference: id, user, reason: `Pharmacy sale ${id}`, at });
    });
    (draft.payments || []).filter((p) => Number(p.amount) > 0).forEach((p) => {
      const amt = r2(p.amount);
      store.insert('payments', { id: store.nextId('payments', 'PAY-', 6), billId: id, kind: 'PAYMENT', mode: p.mode, amount: amt,
        tendered: p.mode === 'CASH' ? (Number(p.tendered) || amt) : null, change: p.mode === 'CASH' ? r2((Number(p.tendered) || amt) - amt) : null,
        reference: p.reference || '', at, businessDate: date, userId: user.id, note: p.note || '', returnId: null, cancellationId: null });
    });
    store.touch(); refreshBill(bill);
    audit(user, 'BILL_COMPLETED', 'BILL', id, `${lines.length} lines, ${fmtINR(totals.grandTotal)}, ${bill.paymentMode || 'unpaid'}`);
    if (bill.discountRequestId) { const r = store.get('discountRequests', bill.discountRequestId); r.status = 'USED'; r.billId = id; audit(user, 'DISCOUNT_APPLIED', 'DISCOUNT', r.id, `${r.requestedPct}% applied on ${id}`); }
    const eff = effectiveDiscountPct(totals);
    if (eff >= ph().largeDiscountNotifyPct) {
      notify({ type: 'LARGE_DISCOUNT', category: 'Large Discount', severity: 'warning', title: `Large discount ${eff}% — ${id}`,
        message: `Discount ${fmtINR(totals.discountTotal)} on ${fmtINR(totals.gross)}${bill.discountAuthorizedBy ? ` authorised by ${store.get('users', bill.discountAuthorizedBy).name}` : ''}.`,
        refType: 'BILL', refId: id, targetRoles: OWNER_ROLES, assignedTo: 'USR-0003' });
    }
    Object.entries(medsBefore).forEach(([mid, before]) => {
      const m = store.get('medicines', mid); const after = stockStatus(m);
      if (after !== before && after !== 'IN_STOCK') notify({ type: after, category: after === 'OUT_OF_STOCK' ? 'Out of Stock' : 'Low Stock', severity: after === 'OUT_OF_STOCK' ? 'critical' : 'warning',
        title: `${m.brandName} is now ${after === 'OUT_OF_STOCK' ? 'out of stock' : 'low on stock'}`, message: `Available ${medicineStock(mid).available} ${m.unit}(s) after bill ${id}; reorder level ${m.reorderLevel}.`,
        refType: 'MEDICINE', refId: mid, targetRoles: ['PHARMACY_STAFF', 'STORE_INCHARGE', 'SUPER_ADMIN'], assignedTo: 'USR-0002' });
    });
    return bill;
  });
}

export function collectPayment(billId, pays, user) {
  const bill = store.get('bills', billId);
  if (bill.status === 'CANCELLED') throw new Error('Cannot collect payment on a cancelled bill.');
  const due = billBalance(bill);
  const plan = paymentPlan({ ...bill, payments: pays }, due);
  const applied = plan.applied;
  if (!(applied > 0)) throw new Error('Enter an amount to collect.');
  if (applied > due + 0.005) throw new Error(`Only ${fmtINR(due)} is due.`);
  return store.transaction(() => {
    const date = businessDate();
    pays.filter((p) => Number(p.amount) > 0).forEach((p) => store.insert('payments', { id: store.nextId('payments', 'PAY-', 6), billId, kind: 'PAYMENT', mode: p.mode, amount: r2(p.amount),
      tendered: p.mode === 'CASH' ? (Number(p.tendered) || r2(p.amount)) : null, change: p.mode === 'CASH' ? r2((Number(p.tendered) || p.amount) - p.amount) : null,
      reference: p.reference || '', at: now(), businessDate: date, userId: user.id, note: 'Balance collected', returnId: null, cancellationId: null }));
    store.touch(); refreshBill(bill);
    audit(user, 'BILL_PAYMENT_COLLECTED', 'BILL', billId, `${fmtINR(applied)} collected; balance ${fmtINR(bill.balanceDue)}`);
    return bill;
  });
}

// ---------------- cancellation ----------------
function cancellationBlockers(bill) {
  if (bill.status === 'CANCELLED') return 'This bill is already cancelled.';
  if (store.all('pReturns').some((r) => r.billId === bill.id && r.status !== 'REJECTED')) return 'This bill has returns recorded — use Returns & Refunds instead of cancellation.';
  if (closingFor(bill.businessDate, bill.cashierId)) return `The counter for ${bill.businessDate} is already closed — cancellation would change a reconciled day. Record a return instead.`;
  return null;
}
export const canCancelBill = (bill) => !cancellationBlockers(bill);

export function requestCancellation(billId, reason, user) {
  const bill = store.get('bills', billId);
  if (!reason?.trim()) throw new Error('A cancellation reason is required.');
  const block = cancellationBlockers(bill); if (block) throw new Error(block);
  if (store.all('cancellations').some((c) => c.billId === billId && c.status === 'PENDING')) throw new Error('A cancellation request is already pending for this bill.');
  if (can('pharmacy.cancel', user)) return cancelBill(billId, reason, user);
  return store.transaction(() => {
    const c = store.insert('cancellations', { id: store.nextId('cancellations', `BC-${new Date().getFullYear()}-`), billId, requestedBy: user.id, requestedAt: now(), reason, status: 'PENDING', approvedBy: null, approvedAt: null, rejectionReason: null, movementIds: [], refundTxnIds: [] });
    bill.cancellationId = c.id;
    audit(user, 'BILL_CANCEL_REQUESTED', 'BILL', billId, reason);
    notify({ type: 'CANCELLATION_REQUEST', category: 'Bill Cancellation', severity: 'warning', title: `Bill cancellation requested — ${billId}`, message: `${fmtINR(bill.grandTotal)} · ${reason}`,
      refType: 'BILL', refId: billId, targetRoles: ['SUPER_ADMIN'], assignedTo: 'USR-0003' });
    return c;
  });
}
export function cancelBill(billId, reason, user, existing) {
  if (!can('pharmacy.cancel', user)) throw new Error('Only a Pharmacy Manager or the Owner can cancel bills.');
  const bill = store.get('bills', billId);
  const block = cancellationBlockers(bill); if (block) throw new Error(block);
  return store.transaction(() => {
    const at = now();
    const c = existing || store.insert('cancellations', { id: store.nextId('cancellations', `BC-${new Date().getFullYear()}-`), billId, requestedBy: user.id, requestedAt: at, reason, status: 'PENDING', approvedBy: null, approvedAt: null, rejectionReason: null, movementIds: [], refundTxnIds: [] });
    billItems(billId).forEach((i) => { c.movementIds.push(createMovement({ batchId: i.batchId, type: 'SALE_CANCELLATION', qty: i.qty, reference: billId, user, reason: `Bill ${billId} cancelled — stock reversed`, at }).id); });
    billPayments(billId).filter((p) => p.kind === 'PAYMENT').forEach((p) => {
      c.refundTxnIds.push(store.insert('payments', { id: store.nextId('payments', 'PAY-', 6), billId, kind: 'REFUND', mode: p.mode, amount: p.amount, tendered: null, change: null, reference: p.reference,
        at, businessDate: businessDate(), userId: c.requestedBy, note: 'Refund on cancellation', returnId: null, cancellationId: c.id }).id);
    });
    Object.assign(c, { status: 'APPROVED', approvedBy: user.id, approvedAt: at });
    store.touch();
    bill.status = 'CANCELLED'; bill.cancellationId = c.id; bill.cancelledAt = at; refreshBill(bill);
    audit(user, 'BILL_CANCELLED', 'BILL', billId, `${reason} · stock reversed, ${fmtINR(billPaid(bill))} refunded`);
    notify({ type: 'BILL_CANCELLED', category: 'Bill Cancellation', severity: 'info', title: `Bill cancelled — ${billId}`, message: `${fmtINR(bill.grandTotal)} cancelled by ${user.name}: ${reason}`,
      refType: 'BILL', refId: billId, targetRoles: OWNER_ROLES, assignedTo: c.requestedBy !== user.id ? c.requestedBy : 'USR-0003' });
    return c;
  });
}
export const approveCancellation = (cid, user) => { const c = store.get('cancellations', cid); if (c.status !== 'PENDING') throw new Error('Request is not pending.'); return cancelBill(c.billId, c.reason, user, c); };
export function rejectCancellation(cid, reason, user) {
  if (!can('pharmacy.cancel', user)) throw new Error('Not permitted.');
  if (!reason?.trim()) throw new Error('A reason is required.');
  return store.transaction(() => {
    const c = store.get('cancellations', cid);
    Object.assign(c, { status: 'REJECTED', approvedBy: user.id, approvedAt: now(), rejectionReason: reason });
    audit(user, 'BILL_CANCEL_REJECTED', 'BILL', c.billId, reason);
    notify({ type: 'CANCELLATION_DECIDED', category: 'Bill Cancellation', severity: 'info', title: `Cancellation rejected — ${c.billId}`, message: reason, refType: 'BILL', refId: c.billId, targetRoles: [], assignedTo: c.requestedBy });
    return c;
  });
}

// ---------------- returns & refunds ----------------
export const returnNeedsOwner = (amount) => amount > (ph().refund.ownerApprovalAbove ?? 1000);
export function canDecideReturn(r, user) {
  if (r.status !== 'PENDING_APPROVAL') return false;
  return r.requiresOwner ? can('pharmacy.refund.exceptional', user) : can('pharmacy.return.approve', user);
}
/** RESTOCK is only allowed for unopened, good-condition units whose batch is still sellable. */
export function allowedDispositions(ri) {
  const b = store.get('batches', ri.batchId);
  const out = ['QUARANTINE', 'WRITE_OFF'];
  if (ri.condition === 'GOOD' && b && isIssuable(b)) out.unshift('RESTOCK');
  return out;
}

export function createReturn({ billId, items, reason, notes, refundMode, decisions }, user) {
  const bill = store.get('bills', billId);
  if (!bill || bill.status === 'CANCELLED') throw new Error('Returns can only be made against an active bill.');
  if (billBalance(bill) > 0) throw new Error('This bill has an unpaid balance. Settle the balance before processing a refund.');
  if (!reason) throw new Error('Select a return reason.');
  if (!store.ph().refundModes.includes(refundMode)) throw new Error('Select a refund mode.');
  const sel = items.filter((x) => Number(x.qty) > 0);
  if (!sel.length) throw new Error('Enter a return quantity for at least one item.');
  sel.forEach((x) => {
    const it = store.get('billItems', x.billItemId);
    if (!Number.isInteger(Number(x.qty))) throw new Error('Return quantities must be whole numbers.');
    if (Number(x.qty) > eligibleReturnQty(it)) throw new Error(`${medName(it.medicineId)}: only ${eligibleReturnQty(it)} unit(s) are eligible for return.`);
  });
  const amount = r2(sel.reduce((s, x) => s + lineRefund(store.get('billItems', x.billItemId), Number(x.qty)), 0));
  const refundable = r2(billPaid(bill) - billPayments(billId).filter((p) => p.kind === 'REFUND').reduce((s, p) => s + p.amount, 0));
  if (amount > refundable + 0.005) throw new Error(`Refund ${fmtINR(amount)} exceeds the refundable amount ${fmtINR(refundable)}.`);
  const requiresOwner = returnNeedsOwner(amount);
  const r = store.transaction(() => {
    const at = now();
    const ret = store.insert('pReturns', { id: store.nextId('pReturns', `PR-${new Date().getFullYear()}-`), billId, at, businessDate: businessDate(), requestedBy: user.id, reason, notes: notes || '',
      refundMode, refundAmount: amount, status: 'PENDING_APPROVAL', requiresOwner, approvedBy: null, approvedAt: null, rejectionReason: null, refundTxnId: null });
    sel.forEach((x) => { const it = store.get('billItems', x.billItemId); store.insert('pReturnItems', { id: store.nextId('pReturnItems', 'PRI-', 5), returnId: ret.id, billItemId: it.id, medicineId: it.medicineId, batchId: it.batchId, qty: Number(x.qty), refundAmount: lineRefund(it, Number(x.qty)), condition: x.condition || 'GOOD', disposition: null, movementId: null }); });
    audit(user, 'RETURN_REQUESTED', 'RETURN', ret.id, `${billId}: ${reason}, ${fmtINR(amount)}`);
    return ret;
  });
  // decisions are keyed by bill item id; an approver with sufficient authority completes the return in one step
  if (decisions && canDecideReturn(r, user)) {
    const ris = store.all('pReturnItems').filter((x) => x.returnId === r.id);
    return approveReturn(r.id, Object.fromEntries(ris.map((ri) => [ri.id, decisions[ri.billItemId]])), user);
  }
  store.transaction(() => notify({ type: 'REFUND_APPROVAL', category: 'Refund Approval', severity: requiresOwner ? 'critical' : 'warning', title: `Refund approval requested — ${r.id}`,
    message: `${fmtINR(amount)} against ${billId} (${reason}). Requested by ${user.name}.`, refType: 'RETURN', refId: r.id,
    targetRoles: OWNER_ROLES, assignedTo: 'USR-0003' }));
  return r;
}

export function approveReturn(returnId, decisions, user) {
  const r = store.get('pReturns', returnId);
  if (!canDecideReturn(r, user)) throw new Error(r.requiresOwner ? 'This refund needs the Hospital Owner’s approval.' : 'You are not allowed to approve returns.');
  const its = store.all('pReturnItems').filter((x) => x.returnId === returnId);
  its.forEach((ri) => { const d = decisions[ri.id]; if (!d) throw new Error(`Choose what to do with returned ${medName(ri.medicineId)}.`); if (!allowedDispositions(ri).includes(d)) throw new Error(`${medName(ri.medicineId)} cannot be restocked (condition ${ri.condition}, batch ${batchStatus(store.get('batches', ri.batchId)).toLowerCase()}).`); });
  return store.transaction(() => {
    const at = now();
    its.forEach((ri) => {
      ri.disposition = decisions[ri.id];
      if (ri.disposition === 'RESTOCK') ri.movementId = createMovement({ batchId: ri.batchId, type: 'PATIENT_RETURN', qty: ri.qty, reference: returnId, user, reason: `Return ${returnId} verified — restocked (${r.reason})`, at }).id;
    });
    const bill = store.get('bills', r.billId);
    r.refundTxnId = store.insert('payments', { id: store.nextId('payments', 'PAY-', 6), billId: r.billId, kind: 'REFUND', mode: r.refundMode, amount: r.refundAmount, tendered: null, change: null, reference: '',
      at, businessDate: businessDate(), userId: r.requestedBy, note: 'Refund for ' + returnId + ' (approved by ' + user.name + ')', returnId, cancellationId: null }).id;
    Object.assign(r, { status: 'COMPLETED', approvedBy: user.id, approvedAt: at });
    store.touch(); refreshBill(bill);
    audit(user, 'RETURN_APPROVED', 'RETURN', returnId, `Refund ${fmtINR(r.refundAmount)} (${r.refundMode}); ${its.map((x) => `${medName(x.medicineId)} ×${x.qty} → ${x.disposition}`).join(', ')}`);
    if (r.requestedBy !== user.id) notify({ type: 'RETURN_DECIDED', category: 'Refund Approval', severity: 'success', title: `${returnId} approved`, message: `Refund ${fmtINR(r.refundAmount)} via ${r.refundMode} approved by ${user.name}.`, refType: 'RETURN', refId: returnId, targetRoles: [], assignedTo: r.requestedBy });
    return r;
  });
}
export function rejectReturn(returnId, reason, user) {
  const r = store.get('pReturns', returnId);
  if (!canDecideReturn(r, user)) throw new Error('Not permitted.');
  if (!reason?.trim()) throw new Error('A reason is required.');
  return store.transaction(() => {
    Object.assign(r, { status: 'REJECTED', approvedBy: user.id, approvedAt: now(), rejectionReason: reason });
    audit(user, 'RETURN_REJECTED', 'RETURN', returnId, reason);
    notify({ type: 'RETURN_DECIDED', category: 'Refund Approval', severity: 'info', title: `${returnId} rejected`, message: reason, refType: 'RETURN', refId: returnId, targetRoles: [], assignedTo: r.requestedBy });
    return r;
  });
}

// ---------------- daily closing ----------------
export function closingExpected(date, cashierId, openingFloat = ph().openingCashFloat) {
  const s = daySummary(date, cashierId);
  const expected = Object.fromEntries(PAY_MODES.map((m) => [m, m === 'CASH' ? r2(Number(openingFloat) + s.byMode.CASH.net) : s.byMode[m].net]));
  return { s, expected };
}
export function submitClosing({ date, cashierId, openingFloat, actual, remarks }, user) {
  if (cashierId !== user.id && !can('pharmacy.closing.all', user)) throw new Error('You can only close your own counter.');
  if (closingFor(date, cashierId)) throw new Error('This counter is already closed for ' + date + '.');
  if (date > businessDate()) throw new Error('Cannot close a future business date.');
  PAY_MODES.forEach((m) => { if (actual[m] === '' || actual[m] == null || Number(actual[m]) < 0 || isNaN(Number(actual[m]))) throw new Error(`Enter the confirmed ${m} amount (0 if none).`); });
  const { s, expected } = closingExpected(date, cashierId, openingFloat);
  const act = Object.fromEntries(PAY_MODES.map((m) => [m, r2(actual[m])]));
  const cashDiff = r2(act.CASH - expected.CASH);
  const tol = ph().cashVarianceTolerance;
  const anyDiff = PAY_MODES.some((m) => Math.abs(act[m] - expected[m]) > 0.005);
  if (anyDiff && !remarks?.trim()) throw new Error('Explain the variance in the closing remarks.');
  return store.transaction(() => {
    const id = store.nextId('closings', `DC-${date.slice(0, 4)}-`);
    const totalExpected = r2(PAY_MODES.reduce((t, m) => t + expected[m], 0)); const totalActual = r2(PAY_MODES.reduce((t, m) => t + act[m], 0));
    const c = store.insert('closings', { id, businessDate: date, cashierId, submittedBy: user.id, submittedAt: now(), openingFloat: Number(openingFloat),
      summary: { bills: s.billCount, cancelledBills: s.cancelledBills, gross: s.gross, discounts: s.discounts, sales: s.sales, returns: s.returns, refunds: s.refunds, netSales: s.netSales, splitBills: s.splitBills, pending: s.pending, collections: s.collections, bySale: s.bySale, cost: s.cost, margin: s.margin },
      expectedCash: expected.CASH, actualCash: act.CASH, cashDifference: cashDiff, totalExpected, totalActual, totalDifference: r2(totalActual - totalExpected),
      remarks: remarks || '', status: 'SUBMITTED', verifiedBy: null, verifiedAt: null, corrections: [] });
    PAY_MODES.forEach((m) => store.insert('closingPayments', { id: store.nextId('closingPayments', 'DCP-', 5), closingId: id, mode: m, recorded: s.byMode[m].payments, refunds: s.byMode[m].refunds, expected: expected[m], actual: act[m], difference: r2(act[m] - expected[m]) }));
    audit(user, 'DAILY_CLOSING_SUBMITTED', 'CLOSING', id, `${date} · ${store.get('users', cashierId).name} · expected ${fmtINR(totalExpected)}, actual ${fmtINR(totalActual)}`);
    notify({ type: 'DAILY_CLOSING_SUBMITTED', category: 'Daily Closing', severity: Math.abs(cashDiff) > tol ? 'warning' : 'info', title: `Daily closing submitted — ${date}`,
      message: `${store.get('users', cashierId).name}: registered patients ${fmtINR(s.bySale.PATIENT.sales)} · walk-in ${fmtINR(s.bySale.WALKIN.sales)} · Cash ${fmtINR(s.byMode.CASH.net)} · Online ${fmtINR(s.byMode.UPI.net + s.byMode.CARD.net + s.byMode.OTHER.net)} · cash variance ${fmtINR(cashDiff)}.`, refType: 'CLOSING', refId: id, targetRoles: OWNER_ROLES, assignedTo: 'USR-0003' });
    if (Math.abs(cashDiff) > tol) notify({ type: 'CASH_VARIANCE', category: 'Cash Variance', severity: 'critical', title: `Cash variance ${fmtINR(cashDiff)} — ${date}`,
      message: `Expected cash ${fmtINR(expected.CASH)}, counted ${fmtINR(act.CASH)} (tolerance ${fmtINR(tol)}).`, refType: 'CLOSING', refId: id, targetRoles: ['SUPER_ADMIN'], assignedTo: 'USR-0003' });
    return c;
  });
}
export function correctClosing(id, { actual, reason }, user) {
  if (!can('pharmacy.closing.correct', user)) throw new Error('Only a Pharmacy Manager or the Owner can correct a submitted closing.');
  if (!reason?.trim()) throw new Error('A correction reason is required.');
  return store.transaction(() => {
    const c = store.get('closings', id);
    const rows = store.all('closingPayments').filter((p) => p.closingId === id);
    const before = Object.fromEntries(rows.map((p) => [p.mode, p.actual]));
    rows.forEach((p) => { if (actual[p.mode] !== undefined && actual[p.mode] !== '') { p.actual = r2(actual[p.mode]); p.difference = r2(p.actual - p.expected); } });
    const after = Object.fromEntries(rows.map((p) => [p.mode, p.actual]));
    c.actualCash = after.CASH; c.cashDifference = r2(c.actualCash - c.expectedCash);
    c.totalActual = r2(rows.reduce((t, p) => t + p.actual, 0)); c.totalDifference = r2(c.totalActual - c.totalExpected);
    c.corrections.push({ at: now(), by: user.id, reason, before, after });
    c.status = 'CORRECTED'; c.verifiedBy = null; c.verifiedAt = null;
    audit(user, 'DAILY_CLOSING_CORRECTED', 'CLOSING', id, `${reason} · ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    notify({ type: 'CLOSING_CORRECTED', category: 'Daily Closing', severity: 'warning', title: `Closing corrected — ${c.businessDate}`, message: `${user.name}: ${reason}`, refType: 'CLOSING', refId: id, targetRoles: OWNER_ROLES, assignedTo: 'USR-0003' });
    return c;
  });
}
export function verifyClosing(id, user) {
  if (!can('pharmacy.closing.verify', user)) throw new Error('Only the owner can verify closings.');
  return store.transaction(() => { const c = store.get('closings', id); c.status = 'VERIFIED'; c.verifiedBy = user.id; c.verifiedAt = now(); audit(user, 'DAILY_CLOSING_VERIFIED', 'CLOSING', id, c.businessDate); return c; });
}

/** Once a day: raise owner notifications for batches entering the critical expiry window. */
export function runDailyChecks() {
  const crit = store.settings().criticalExpiryDays || 30;
  const have = new Set(store.all('notifications').filter((n) => n.type === 'CRITICAL_EXPIRY').map((n) => n.refId));
  const due = store.all('batches').filter((b) => !have.has(b.id) && batchBalance(b.id) > 0 && batchStatus(b) === 'NEAR_EXPIRY' && daysUntil(b.expiryDate) <= crit);
  if (!due.length) return;
  store.transaction(() => due.forEach((b) => notify({ type: 'CRITICAL_EXPIRY', category: 'Critical Expiry', severity: 'critical', title: `Critical expiry — ${medName(b.medicineId)} ${b.batchNo}`,
    message: `Expires on ${b.expiryDate} (${daysUntil(b.expiryDate)} days) with ${batchBalance(b.id)} unit(s) in stock. Prioritise issue or return to supplier.`, refType: 'BATCH', refId: b.id,
    targetRoles: ['PHARMACY_STAFF', 'STORE_INCHARGE', 'SUPER_ADMIN'], assignedTo: 'USR-0002', performedBy: null })));
}

// ---------------- discount approval (BRD module 09) ----------------
/** Staff ask the Super Admin for a discount above the limit. The bill is held until the owner decides. */
export function requestDiscount(draft, reason, user) {
  if (!can('discount.request', user)) throw new Error('You are not allowed to request discounts.');
  if (!reason?.trim()) throw new Error('Give a reason for the discount.');
  const { lines, totals } = priceDraft(draft);
  const pct = effectiveDiscountPct(totals);
  if (pct <= discountLimit(user)) throw new Error(`Discounts up to ${discountLimit(user)}% do not need approval.`);
  return store.transaction(() => {
    const r = store.insert('discountRequests', { id: store.nextId('discountRequests', `DR-${new Date().getFullYear()}-`), status: 'PENDING', requestedBy: user.id, requestedAt: now(), reason: reason.trim(),
      requestedPct: pct, snapshot: { patientName: draft.patientName || 'Walk-in Customer', saleType: draft.patientId ? 'PATIENT' : 'WALKIN', lines: lines.map((l) => ({ medicineId: l.medicineId, qty: l.qty })), gross: totals.gross, discount: totals.discountTotal, grandTotal: totals.grandTotal },
      decidedBy: null, decidedAt: null, decisionNote: '', billId: null });
    audit(user, 'DISCOUNT_REQUESTED', 'DISCOUNT', r.id, `${pct}% (${fmtINR(totals.discountTotal)} on ${fmtINR(totals.gross)}): ${reason}`);
    notify({ type: 'DISCOUNT_REQUEST', category: 'Discount Approval', severity: 'warning', title: `Discount approval requested — ${pct}%`,
      message: `${r.snapshot.patientName}: ${fmtINR(totals.discountTotal)} off ${fmtINR(totals.gross)}. Reason: ${reason}`, refType: 'DISCOUNT', refId: r.id, targetRoles: OWNER_ROLES, assignedTo: 'USR-0003' });
    return r;
  });
}
export function decideDiscount(id, approve, note, user) {
  if (!can('discount.approve', user)) throw new Error('Only the Super Admin can approve discounts above the limit.');
  if (!approve && !note?.trim()) throw new Error('Give a reason for rejecting.');
  return store.transaction(() => {
    const r = store.get('discountRequests', id);
    if (r.status !== 'PENDING') throw new Error('This request has already been decided.');
    Object.assign(r, { status: approve ? 'APPROVED' : 'REJECTED', decidedBy: user.id, decidedAt: now(), decisionNote: note || '' });
    audit(user, approve ? 'DISCOUNT_APPROVED' : 'DISCOUNT_REJECTED', 'DISCOUNT', id, `${r.requestedPct}% · ${note || ''}`);
    notify({ type: 'DISCOUNT_DECIDED', category: 'Discount Approval', severity: approve ? 'success' : 'warning', title: `Discount ${approve ? 'approved' : 'rejected'} — ${r.requestedPct}%`,
      message: approve ? `You can complete the bill for ${r.snapshot.patientName} with ${r.requestedPct}% discount.` : `Rejected: ${note}`, refType: 'DISCOUNT', refId: id, targetRoles: [], assignedTo: r.requestedBy });
    return r;
  });
}
export function cancelDiscountRequest(id, user) {
  return store.transaction(() => { const r = store.get('discountRequests', id); if (r.status === 'PENDING') { r.status = 'WITHDRAWN'; audit(user, 'DISCOUNT_WITHDRAWN', 'DISCOUNT', id, ''); } return r; });
}
