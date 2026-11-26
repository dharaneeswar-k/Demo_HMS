// Hospital-side business rules: Central Billing (BRD 08), Packages (10), Service orders (07) and Laboratory (06).
// Every transaction runs in one store.transaction() so a failure never leaves half a bill, order or kit movement.
import { store } from './data-service.js';
import { can } from './auth.js';
import { audit } from './services.js';
import { notify } from './notifications.js';
import { r2 } from './pricing.js';
import { businessDate } from './pharmacy-calc.js';
import { openShiftFor } from './shifts.js';
import { fmtINR } from './utils.js';
import { validateLabRequest, createVisitForBill, onOrderVerified, visitOfOrder, visitAccess } from './labflow.js';

const now = () => new Date().toISOString();
const OWNER = ['SUPER_ADMIN'];
let paySeq = 0;
function nextPayId() {
  const max = store.all('hbills').flatMap((b) => b.payments).reduce((m, p) => Math.max(m, +String(p.id).replace(/\D/g, '') || 0), 0);
  paySeq = Math.max(paySeq, max) + 1;
  return 'HPY-' + String(paySeq).padStart(6, '0');
}

// ---------------- catalog helpers ----------------
export const hs = () => store.hs();
export const svc = (id) => store.get('services', id);
export const pkg = (id) => store.get('packages', id);
export const CATS = () => hs().categories;
export const catLabel = (code) => CATS().find((c) => c.code === code)?.label || code;
export const catIcon = (code) => CATS().find((c) => c.code === code)?.icon || 'circle';
export const patientOf = (id) => store.get('patients', id);
export const ORDER_LABEL = { REQUESTED: 'Not billed yet', ON_HOLD: 'Payment pending', READY: 'Ready', SAMPLE_COLLECTED: 'Sample collected', RESULTED: 'Awaiting verification', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
export const ORDER_TONE = { REQUESTED: 'danger', ON_HOLD: 'warning', READY: 'info', SAMPLE_COLLECTED: 'purple', RESULTED: 'warning', COMPLETED: 'success', CANCELLED: 'muted' };

// ---------------- bill maths ----------------
export const hbillPaid = (b) => r2(b.payments.filter((p) => p.kind === 'PAYMENT').reduce((t, p) => t + p.amount, 0));
export const hbillRefunded = (b) => r2(b.payments.filter((p) => p.kind === 'REFUND').reduce((t, p) => t + p.amount, 0));
export const hbillBalance = (b) => (b.status === 'CANCELLED' ? 0 : r2(Math.max(0, b.grandTotal - hbillPaid(b))));
export const creditOk = (b) => ['APPROVED', 'EMERGENCY'].includes(b.credit?.status);
/** Department services may be delivered only when the bill is paid or credit/emergency is approved (BRD rule). */
export const billClears = (b) => b && b.status !== 'CANCELLED' && (hbillBalance(b) <= 0.005 || creditOk(b));
export function hbillStatus(b) {
  if (b.status === 'CANCELLED') return 'CANCELLED';
  const paid = hbillPaid(b);
  return b.grandTotal - paid <= 0.005 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
}
export const hbillModes = (b) => [...new Set(b.payments.filter((p) => p.kind === 'PAYMENT').map((p) => p.mode))];

export function discountLimit(user) { return can('discount.approve', user) ? 100 : Number(store.ph().discountLimits.staffPct) || 10; }

// ---------------- packages ----------------
export const enrolmentsFor = (patientId) => store.all('patientPackages').filter((p) => p.patientId === patientId);
export const activeEnrolments = (patientId, at = now()) => enrolmentsFor(patientId).filter((p) => p.status === 'ACTIVE' && p.validUntil >= at.slice(0, 10));
export function packageUsage(pp) {
  const p = pkg(pp.packageId);
  const used = {};
  store.all('hbills').filter((b) => b.status !== 'CANCELLED').forEach((b) => b.items.forEach((x) => { if (x.coveredBy === pp.id) used[x.serviceId] = (used[x.serviceId] || 0) + x.qty; }));
  return p.includes.map((i) => ({ serviceId: i.serviceId, name: svc(i.serviceId)?.name, included: i.qty, used: used[i.serviceId] || 0, remaining: Math.max(0, i.qty - (used[i.serviceId] || 0)) }));
}
export function packageExtras(pp) {
  return store.all('hbills').filter((b) => b.status !== 'CANCELLED' && b.patientId === pp.patientId && b.at >= pp.startAt && b.businessDate <= pp.validUntil && b.id !== pp.billId)
    .flatMap((b) => b.items.filter((x) => !x.coveredBy && x.category !== 'PACKAGE').map((x) => ({ ...x, billId: b.id, at: b.at })));
}

/**
 * Price a draft. Lines covered by an active package of the patient become ₹0 lines (split when only part is covered).
 * draft = { patientId, lines: [{ serviceId | packageId, qty, orderIds? }], discountPct }
 */
export function priceHospitalDraft(draft) {
  const remaining = {};
  activeEnrolments(draft.patientId).forEach((pp) => packageUsage(pp).forEach((u) => { if (u.remaining > 0) (remaining[u.serviceId] ||= []).push({ pp: pp.id, left: u.remaining }); }));
  const items = [];
  draft.lines.forEach((l, li) => {
    const qty = Math.max(1, Math.floor(Number(l.qty) || 1));
    if (l.packageId) { const p = pkg(l.packageId); items.push({ line: li, serviceId: null, packageId: p.id, category: 'PACKAGE', name: p.name, qty: 1, rate: p.price, listRate: p.price, gross: p.price, coveredBy: null }); return; }
    const sv = svc(l.serviceId); let left = qty;
    for (const slot of remaining[sv.id] || []) {
      if (!left) break;
      const take = Math.min(left, slot.left); if (!take) continue;
      slot.left -= take; left -= take;
      items.push({ line: li, serviceId: sv.id, packageId: null, category: sv.category, name: sv.name, qty: take, rate: 0, listRate: sv.price, gross: 0, coveredBy: slot.pp });
    }
    if (left) items.push({ line: li, serviceId: sv.id, packageId: null, category: sv.category, name: sv.name, qty: left, rate: sv.price, listRate: sv.price, gross: r2(sv.price * left), coveredBy: null });
  });
  const gross = r2(items.reduce((t, x) => t + x.gross, 0));
  const pct = Math.max(0, Math.min(100, Number(draft.discountPct) || 0));
  const discountTotal = r2(gross * pct / 100);
  const net = r2(gross - discountTotal); const grandTotal = Math.round(net);
  const covered = r2(items.filter((x) => x.coveredBy).reduce((t, x) => t + x.listRate * x.qty, 0));
  return { items, gross, discountPct: pct, discountTotal, roundOff: r2(grandTotal - net), grandTotal, covered };
}

export function validateHospitalDraft(draft, user) {
  const errors = []; const warnings = [];
  const t = priceHospitalDraft(draft);
  if (!draft.patientId) errors.push('Select the registered patient. Hospital bills are always raised against a Patient ID.');
  if (!draft.lines.length) errors.push('Add at least one service, test or package.');
  validateLabRequest(draft.lab || {}, draft.lines.filter((l) => l.serviceId).map((l) => l.serviceId)).forEach((e) => errors.push(e));
  if (!can('discount.approve', user) && !openShiftFor(user)) errors.push('Start your shift before billing (opening cash in the drawer).');
  const req = draft.discountRequestId && store.get('discountRequests', draft.discountRequestId);
  const approvedPct = req && req.status === 'APPROVED' ? req.requestedPct : 0;
  if (t.discountPct > discountLimit(user) && t.discountPct > approvedPct) errors.push(`Discount above ${discountLimit(user)}% needs Super Admin approval. Send a request with a reason.`);
  const paid = r2((draft.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  if (paid > t.grandTotal + 0.005) errors.push(`Payments (${fmtINR(paid)}) are more than the bill (${fmtINR(t.grandTotal)}).`);
  (draft.payments || []).forEach((p) => { if ((p.mode === 'UPI' || p.mode === 'CARD') && Number(p.amount) > 0 && !String(p.reference || '').trim()) warnings.push(`${p.mode} reference not entered.`); });
  const due = r2(t.grandTotal - paid);
  if (due > 0.005) {
    if (draft.credit?.type === 'EMERGENCY' && !hs().credit.emergencyAllowed) errors.push('Emergency billing is switched off in Hospital Setup.');
    if (!draft.credit?.type) errors.push(`${fmtINR(due)} is unpaid. Collect it, or mark the bill as Credit / Emergency with a reason.`);
    else if (!draft.credit.reason?.trim()) errors.push('Give the reason for credit / emergency.');
    else warnings.push(draft.credit.type === 'EMERGENCY' ? `Emergency: services start now, ${fmtINR(due)} to be collected later. The owner is told.` : `Credit of ${fmtINR(due)} goes to the owner for approval. Services stay on hold until approved.`);
  }
  return { errors, warnings, totals: t, paid, due };
}

function makeOrder(bill, item, user, existing) {
  const sv = svc(item.serviceId);
  const o = existing || { id: store.nextId('orders', 'ORD-', 5), requestedBy: user.id, requestedAt: bill.at, notes: '', doctor: bill.doctor };
  Object.assign(o, { billId: bill.id, itemId: item.id, patientId: bill.patientId, serviceId: sv.id, category: sv.category, name: sv.name, billedAt: bill.at, coveredBy: item.coveredBy,
    status: billClears(bill) ? 'READY' : 'ON_HOLD', performedBy: null, performedAt: null, accession: null, lab: null, doctor: o.doctor || bill.doctor });
  if (sv.category === 'LAB') {
    o.accession = `${hs().lab.accessionPrefix}-${bill.businessDate.replace(/-/g, '').slice(2)}-${o.id.replace(/\D/g, '').slice(-4)}`;
    o.lab = { sampleType: sv.lab.sample, collectedAt: null, collectedBy: null, receivedAt: null, receivedBy: null, rejected: null, results: [], enteredBy: null, enteredAt: null, verifiedBy: null, verifiedAt: null, reportNo: null, printedAt: null, printCount: 0 };
  }
  if (!existing) store.insert('orders', o);
  return o;
}

export function completeHospitalBill(draft, user) {
  const v = validateHospitalDraft(draft, user);
  if (v.errors.length) throw new Error(v.errors.join(' '));
  const p = patientOf(draft.patientId);
  return store.transaction(() => {
    const at = now(); const id = store.nextId('hbills', `${hs().billPrefix}-${new Date().getFullYear()}-`, 5);
    const t = v.totals;
    const bill = { id, at, businessDate: businessDate(), patientId: p.id, patientName: p.name, uhid: p.uhid, phone: p.phone, doctor: draft.doctor || '', counterUserId: user.id,
      items: t.items.map((x, i) => ({ id: `${id}-${i + 1}`, serviceId: x.serviceId, packageId: x.packageId, category: x.category, name: x.name, qty: x.qty, rate: x.rate, listRate: x.listRate, gross: x.gross, coveredBy: x.coveredBy })),
      gross: t.gross, discountPct: t.discountPct, discountTotal: t.discountTotal, roundOff: t.roundOff, grandTotal: t.grandTotal, discountRequestId: draft.discountRequestId || null,
      payments: [], credit: null, status: 'PAID', cancellation: null, remarks: draft.remarks || '', shiftId: openShiftFor(user)?.id || null };
    (draft.payments || []).filter((q) => Number(q.amount) > 0).forEach((q) => bill.payments.push({ id: nextPayId(), kind: 'PAYMENT', mode: q.mode, amount: r2(q.amount), at, userId: user.id, reference: q.reference || '', tendered: q.tendered || null }));
    if (v.due > 0.005) {
      const emergency = draft.credit.type === 'EMERGENCY';
      bill.credit = { type: draft.credit.type, reason: draft.credit.reason.trim(), requestedBy: user.id, requestedAt: at, status: can('credit.approve', user) ? 'APPROVED' : emergency ? 'EMERGENCY' : 'PENDING', decidedBy: can('credit.approve', user) ? user.id : null, decidedAt: can('credit.approve', user) ? at : null, note: '' };
    }
    bill.status = hbillStatus(bill);
    store.insert('hbills', bill);
    // orders: re-use doctor requests raised before billing, create the rest
    const pool = [...(draft.lines.flatMap((l) => l.orderIds || []))].map((oid) => store.get('orders', oid)).filter((o) => o && o.status === 'REQUESTED');
    const made = [];
    bill.items.filter((x) => x.serviceId).forEach((x) => { for (let n = 0; n < x.qty; n++) { const i = pool.findIndex((o) => o.serviceId === x.serviceId); made.push(makeOrder(bill, x, user, i >= 0 ? pool.splice(i, 1)[0] : null)); } });
    const labVisit = createVisitForBill(bill, made.filter((o) => o.category === 'LAB'), { ...(draft.lab || {}), source: draft.lab?.source || (pool.length || draft.lines.some((l) => l.orderIds?.length) ? 'OP' : 'OP') }, user);
    if (labVisit) bill.labVisitId = labVisit.id;
    // package sold → enrolment starts now
    bill.items.filter((x) => x.packageId).forEach((x) => {
      const pk = pkg(x.packageId); const until = new Date(Date.now() + (pk.validityDays - 1) * 86400000);
      store.insert('patientPackages', { id: store.nextId('patientPackages', 'PP-'), packageId: pk.id, patientId: p.id, billId: id, startAt: at, validUntil: businessDate(until), status: 'ACTIVE', settledAt: null, settledBy: null, settlement: null });
    });
    if (bill.discountRequestId) store.update('discountRequests', bill.discountRequestId, { status: 'USED', billId: id });
    audit(user, 'HOSPITAL_BILL_CREATED', 'HBILL', id, `${p.name} · ${bill.items.length} item(s) · ${fmtINR(bill.grandTotal)}${bill.credit ? ' · ' + bill.credit.type : ''}`);
    if (bill.credit?.status === 'PENDING') notify({ type: 'CREDIT_REQUEST', category: 'Credit approval', severity: 'warning', title: `Credit requested — ${p.name}`, message: `${id}: ${fmtINR(v.due)} · ${bill.credit.reason}. Services are on hold until you decide.`, refType: 'HBILL', refId: id, targetRoles: OWNER, assignedTo: 'USR-0003' });
    if (bill.credit?.status === 'EMERGENCY') notify({ type: 'EMERGENCY_CREDIT', category: 'Credit approval', severity: 'critical', title: `Emergency credit — ${p.name}`, message: `${id}: ${fmtINR(v.due)} unpaid · ${bill.credit.reason}. Services started; please review.`, refType: 'HBILL', refId: id, targetRoles: OWNER, assignedTo: 'USR-0003' });
    if (t.discountPct > 0 && t.discountPct >= store.ph().largeDiscountNotifyPct) notify({ type: 'LARGE_DISCOUNT', category: 'Discount', severity: 'info', title: `${t.discountPct}% discount on ${id}`, message: `${p.name}: ${fmtINR(t.discountTotal)} off ${fmtINR(t.gross)} by ${user.name}.`, refType: 'HBILL', refId: id, targetRoles: OWNER });
    return bill;
  });
}

export function syncOrders(bill) {
  store.all('orders').filter((o) => o.billId === bill.id).forEach((o) => {
    if (o.status === 'ON_HOLD' && billClears(bill)) o.status = 'READY';
    else if (o.status === 'READY' && !billClears(bill)) o.status = 'ON_HOLD';
  });
}

export function collectHospitalPayment(billId, pays, user) {
  if (!can('hbill.collect', user)) throw new Error('You cannot collect payments.');
  const b = store.get('hbills', billId);
  const due = hbillBalance(b); const amt = r2(pays.reduce((t, p) => t + (Number(p.amount) || 0), 0));
  if (!(amt > 0)) throw new Error('Enter the amount received.');
  if (amt > due + 0.005) throw new Error(`Only ${fmtINR(due)} is due.`);
  if (!can('discount.approve', user) && !openShiftFor(user)) throw new Error('Start your shift before collecting money.');
  return store.transaction(() => {
    pays.filter((p) => Number(p.amount) > 0).forEach((p, i) => b.payments.push({ id: nextPayId(), kind: 'PAYMENT', mode: p.mode, amount: r2(p.amount), at: now(), userId: user.id, reference: p.reference || '', note: 'Balance collected' }));
    b.status = hbillStatus(b); syncOrders(b);
    audit(user, 'HOSPITAL_PAYMENT_COLLECTED', 'HBILL', billId, fmtINR(amt));
    return b;
  });
}

export function decideCredit(billId, approve, note, user) {
  if (!can('credit.approve', user)) throw new Error('Only the Super Admin can approve credit.');
  if (!approve && !note?.trim()) throw new Error('Give a reason for rejecting.');
  return store.transaction(() => {
    const b = store.get('hbills', billId);
    if (!b.credit || !['PENDING', 'EMERGENCY'].includes(b.credit.status)) throw new Error('Nothing to decide on this bill.');
    Object.assign(b.credit, { status: approve ? 'APPROVED' : 'REJECTED', decidedBy: user.id, decidedAt: now(), note: note || '' });
    syncOrders(b);
    audit(user, approve ? 'CREDIT_APPROVED' : 'CREDIT_REJECTED', 'HBILL', billId, note || '');
    notify({ type: 'CREDIT_DECIDED', category: 'Credit approval', severity: approve ? 'success' : 'warning', title: `Credit ${approve ? 'approved' : 'rejected'} — ${b.patientName}`,
      message: approve ? `${b.id}: services can go ahead. Collect ${fmtINR(hbillBalance(b))} later.` : `${b.id}: collect the payment before services. ${note}`, refType: 'HBILL', refId: billId, targetRoles: ['RECEPTION'], assignedTo: b.counterUserId });
    return b;
  });
}

export function cancelBlockers(b) {
  const os = store.all('orders').filter((o) => o.billId === b.id);
  if (os.some((o) => ['COMPLETED', 'RESULTED'].includes(o.status))) return 'Some services on this bill are already done. Completed services cannot be cancelled.';
  if (b.items.some((x) => x.packageId) && store.all('hbills').some((x) => x.status !== 'CANCELLED' && x.items.some((i) => i.coveredBy && store.get('patientPackages', i.coveredBy)?.billId === b.id))) return 'This package has already been used. Settle the package instead.';
  return null;
}
export function requestHospitalCancel(billId, reason, refundMode, user) {
  const b = store.get('hbills', billId);
  if (!can('hbill.cancel.request', user) && !can('hbill.cancel', user)) throw new Error('You cannot cancel bills.');
  if (!reason?.trim()) throw new Error('Give the reason for cancelling.');
  const block = cancelBlockers(b); if (block) throw new Error(block);
  if (b.cancellation?.status === 'PENDING') throw new Error('A cancellation is already waiting for approval.');
  return store.transaction(() => {
    b.cancellation = { status: 'PENDING', reason: reason.trim(), requestedBy: user.id, requestedAt: now(), decidedBy: null, decidedAt: null, refundMode: refundMode || 'CASH', note: '' };
    audit(user, 'HOSPITAL_BILL_CANCEL_REQUESTED', 'HBILL', billId, reason);
    notify({ type: 'HBILL_CANCEL', category: 'Bill cancellation', severity: 'warning', title: `Cancel hospital bill ${billId}?`, message: `${b.patientName} · ${fmtINR(b.grandTotal)} · ${reason}`, refType: 'HBILL', refId: billId, targetRoles: OWNER, assignedTo: 'USR-0003' });
    return b;
  });
}
export function decideHospitalCancel(billId, approve, note, user) {
  if (!can('hbill.cancel', user)) throw new Error('Only the Super Admin can approve a cancellation.');
  const b = store.get('hbills', billId);
  if (b.cancellation?.status !== 'PENDING') throw new Error('No cancellation is waiting on this bill.');
  if (approve) { const block = cancelBlockers(b); if (block) throw new Error(block); }
  if (!approve && !note?.trim()) throw new Error('Give a reason for rejecting.');
  return store.transaction(() => {
    Object.assign(b.cancellation, { status: approve ? 'APPROVED' : 'REJECTED', decidedBy: user.id, decidedAt: now(), note: note || '' });
    if (approve) {
      const paid = hbillPaid(b) - hbillRefunded(b);
      if (paid > 0) b.payments.push({ id: nextPayId(), kind: 'REFUND', mode: b.cancellation.refundMode, amount: r2(paid), at: now(), userId: b.cancellation.requestedBy, reference: '', note: 'Refund on cancellation' });
      b.status = 'CANCELLED';
      store.all('orders').filter((o) => o.billId === b.id).forEach((o) => { o.status = 'CANCELLED'; });
      store.all('patientPackages').filter((pp) => pp.billId === b.id).forEach((pp) => { pp.status = 'CANCELLED'; });
    }
    audit(user, approve ? 'HOSPITAL_BILL_CANCELLED' : 'HOSPITAL_BILL_CANCEL_REJECTED', 'HBILL', billId, note || b.cancellation.reason);
    notify({ type: 'HBILL_CANCEL_DECIDED', category: 'Bill cancellation', severity: approve ? 'info' : 'warning', title: `Cancellation ${approve ? 'approved' : 'rejected'} — ${billId}`,
      message: approve ? `Refund ${fmtINR(hbillRefunded(b))} by ${b.cancellation.refundMode}.` : note, refType: 'HBILL', refId: billId, targetRoles: [], assignedTo: b.cancellation.requestedBy });
    return b;
  });
}

// ---------------- service orders (BRD 07) ----------------
export function orderAccess(o) {
  if (o.status === 'CANCELLED') return { ok: false, label: 'Cancelled', tone: 'muted' };
  if (o.labVisitId && visitOfOrder(o)) return visitAccess(visitOfOrder(o));
  if (!o.billId) return { ok: false, label: 'Not billed', tone: 'danger' };
  const b = store.get('hbills', o.billId);
  if (o.coveredBy) return { ok: true, label: 'In package', tone: 'purple' };
  if (b.credit?.status === 'EMERGENCY') return { ok: true, label: 'Emergency', tone: 'danger' };
  if (b.credit?.status === 'APPROVED' && hbillBalance(b) > 0) return { ok: true, label: 'Credit approved', tone: 'purple' };
  if (hbillBalance(b) <= 0.005) return { ok: true, label: 'Paid', tone: 'success' };
  if (b.credit?.status === 'PENDING') return { ok: false, label: 'Credit awaiting owner', tone: 'warning' };
  return { ok: false, label: 'Payment pending', tone: 'warning' };
}
export function requestServices({ patientId, serviceIds, doctor, note }, user) {
  if (!can('service.request', user)) throw new Error('You cannot record service requests.');
  if (!patientId) throw new Error('Select the patient.');
  if (!serviceIds.length) throw new Error('Select at least one service.');
  const p = patientOf(patientId);
  return store.transaction(() => {
    const made = serviceIds.map((sid) => { const sv = svc(sid); return store.insert('orders', { id: store.nextId('orders', 'ORD-', 5), billId: null, itemId: null, patientId, serviceId: sid, category: sv.category, name: sv.name, doctor: doctor || '',
      requestedBy: user.id, requestedAt: now(), billedAt: null, status: 'REQUESTED', accession: null, performedBy: null, performedAt: null, notes: note || '', lab: null, coveredBy: null }); });
    audit(user, 'SERVICE_REQUESTED', 'ORDER', made.map((o) => o.id).join(','), `${p.name}: ${made.map((o) => o.name).join(', ')}`);
    notify({ type: 'SERVICE_REQUEST', category: 'Services', severity: 'info', title: `Bill needed — ${p.name}`, message: `${made.map((o) => o.name).join(', ')} advised${doctor ? ' by ' + doctor : ''}. Raise the bill at the main counter.`, refType: 'PATIENT', refId: patientId, targetRoles: ['RECEPTION'] });
    return made;
  });
}
export function completeService(orderId, notes, user) {
  if (!can('service.work', user)) throw new Error('Only the service counter can mark services done.');
  const o = store.get('orders', orderId);
  if (!orderAccess(o).ok) throw new Error('Payment is not cleared. Send the patient to the main counter.');
  if (o.status !== 'READY') throw new Error('This service is not waiting.');
  return store.transaction(() => { Object.assign(o, { status: 'COMPLETED', performedBy: user.id, performedAt: now(), notes: notes || o.notes || 'Done' }); audit(user, 'SERVICE_COMPLETED', 'ORDER', orderId, `${o.name} · ${patientOf(o.patientId)?.name}`); return o; });
}
export function cancelRequest(orderId, reason, user) {
  const o = store.get('orders', orderId);
  if (o.status !== 'REQUESTED') throw new Error('Only unbilled requests can be withdrawn here.');
  return store.transaction(() => { o.status = 'CANCELLED'; o.notes = 'Withdrawn: ' + reason; audit(user, 'SERVICE_REQUEST_WITHDRAWN', 'ORDER', orderId, reason); return o; });
}

/** Requested → billed → cleared → completed, per category, for a date range (BRD 07 leakage control). */
export function serviceReconciliation(from, to, categories = ['ECG', 'INJECTION', 'NEBULIZATION', 'OTHER', 'LAB']) {
  const inRange = (iso) => { const d = iso ? businessDate(iso) : null; return d && (!from || d >= from) && (!to || d <= to); };
  const rows = categories.map((c) => {
    const os = store.all('orders').filter((o) => o.category === c && inRange(o.requestedAt) && o.status !== 'CANCELLED');
    const billed = os.filter((o) => o.billId || o.ipCharge); const cleared = billed.filter((o) => orderAccess(o).ok); const done = os.filter((o) => o.status === 'COMPLETED');
    return { category: c, requested: os.length, unbilled: os.length - billed.length, billed: billed.length, cleared: cleared.length, completed: done.length, pending: cleared.length - done.length, value: r2(billed.reduce((t, o) => t + (svc(o.serviceId)?.price || 0), 0)) };
  });
  const unbilled = store.all('orders').filter((o) => o.status === 'REQUESTED' && inRange(o.requestedAt));
  return { rows, unbilled };
}

// ---------------- laboratory (BRD 06) ----------------
export function flagFor(p, value) {
  if (value == null || value === '') return '';
  if (p.ref !== undefined) return String(value).trim().toLowerCase() === String(p.ref).toLowerCase() ? '' : 'A';
  const v = Number(value); if (Number.isNaN(v)) return '';
  if (p.critLow != null && v < p.critLow) return 'LL';
  if (p.critHigh != null && v > p.critHigh) return 'HH';
  if (v < p.low) return 'L';
  if (v > p.high) return 'H';
  return '';
}
export const refText = (p) => (p.ref !== undefined ? p.ref : `${p.low} – ${p.high}`);
export function labParams(o) { return svc(o.serviceId)?.lab?.parameters || []; }
export const isCritical = (o) => (o.lab?.results || []).some((r) => { const p = labParams(o).find((x) => x.name === r.param); return p && ['LL', 'HH'].includes(flagFor(p, r.value)); });

function mustLab(user) { if (!can('lab.work', user)) throw new Error('Only lab staff can do this.'); }
export function collectSample(orderId, user) {
  mustLab(user);
  const o = store.get('orders', orderId);
  if (!orderAccess(o).ok) throw new Error('Payment is not cleared at the main counter. Do not collect the sample.');
  if (o.status !== 'READY') throw new Error('The sample is already collected.');
  const sv = svc(o.serviceId);
  return store.transaction(() => {
    const at = now();
    Object.assign(o.lab, { collectedAt: at, collectedBy: user.id, receivedAt: at, receivedBy: user.id });
    o.status = 'SAMPLE_COLLECTED';
    sv.lab.kits.forEach((k) => kitMove(k.kitId, 'USED_TEST', -k.qty, o.id, user, sv.code));
    audit(user, 'LAB_SAMPLE_COLLECTED', 'ORDER', orderId, `${o.accession} · ${sv.name}`);
    return o;
  });
}
export function rejectSample(orderId, reason, user) {
  mustLab(user);
  if (!reason?.trim()) throw new Error('Give the reason for rejecting the sample.');
  const o = store.get('orders', orderId);
  return store.transaction(() => {
    o.lab.rejected = { at: now(), by: user.id, reason: reason.trim(), count: (o.lab.rejected?.count || 0) + 1 };
    if (o.status === 'SAMPLE_COLLECTED') { o.status = 'READY'; Object.assign(o.lab, { collectedAt: null, collectedBy: null, receivedAt: null, receivedBy: null }); kitMoveRepeat(o, user); }
    audit(user, 'LAB_SAMPLE_REJECTED', 'ORDER', orderId, reason);
    return o;
  });
}
function kitMoveRepeat(o, user) {
  // the kit used on a rejected sample is not refunded — it is relabelled as a repeat so the reconciliation stays honest
  const last = store.all('kitMovements').filter((m) => m.ref === o.id && m.type === 'USED_TEST');
  last.forEach((m) => { m.type = 'REPEAT'; m.note = 'Sample rejected — test repeated'; });
}
export function enterResults(orderId, results, user) {
  mustLab(user);
  const o = store.get('orders', orderId);
  if (!['SAMPLE_COLLECTED', 'RESULTED'].includes(o.status)) throw new Error('Collect the sample first.');
  if (!o.lab.receivedAt) throw new Error('Receive the tube in the lab (scan its label) before entering results.');
  const params = labParams(o);
  const missing = params.filter((p) => !String(results[p.name] ?? '').trim());
  if (missing.length) throw new Error(`Enter all results: ${missing.map((p) => p.name).join(', ')}.`);
  return store.transaction(() => {
    o.lab.results = params.map((p) => ({ param: p.name, value: String(results[p.name]).trim() }));
    Object.assign(o.lab, { enteredBy: user.id, enteredAt: now(), verifiedBy: null, verifiedAt: null });
    o.status = 'RESULTED';
    audit(user, 'LAB_RESULTS_ENTERED', 'ORDER', orderId, o.accession);
    if (isCritical(o)) notify({ type: 'CRITICAL_RESULT', category: 'Laboratory', severity: 'critical', title: `Critical result — ${patientOf(o.patientId)?.name}`, message: `${o.name} (${o.accession}): value in the critical range. Inform ${o.doctor || 'the doctor'} now.`, refType: 'LABORDER', refId: orderId, targetRoles: ['SUPER_ADMIN', 'LAB'] });
    return o;
  });
}
export function verifyReport(orderId, user) {
  if (!can('lab.verify', user)) throw new Error('You cannot verify reports.');
  const o = store.get('orders', orderId);
  if (o.status !== 'RESULTED') throw new Error('Results are not entered yet.');
  if (hs().lab.requireSecondPersonVerification && o.lab.enteredBy === user.id) throw new Error('A second person must verify this report.');
  return store.transaction(() => {
    const yr = new Date().getFullYear();
    const no = store.all('orders').map((x) => x.lab?.reportNo).filter(Boolean).reduce((m, r) => Math.max(m, +String(r).split('-').pop() || 0), 0) + 1;
    Object.assign(o.lab, { verifiedBy: user.id, verifiedAt: now(), reportNo: `${hs().lab.reportPrefix}-${yr}-${String(no).padStart(5, '0')}` });
    Object.assign(o, { status: 'COMPLETED', performedBy: o.lab.enteredBy, performedAt: now() });
    audit(user, 'LAB_REPORT_VERIFIED', 'ORDER', orderId, o.lab.reportNo);
    onOrderVerified(o, user);
    return o;
  });
}
export function markPrinted(orderId) { const o = store.get('orders', orderId); if (o?.lab) { o.lab.printedAt = now(); o.lab.printCount = (o.lab.printCount || 0) + 1; store.commit(); } }

// ---------------- reagent kits ----------------
function kitMove(kitId, type, qty, ref, user, note = '') { return store.insert('kitMovements', { id: store.nextId('kitMovements', 'KMV-', 5), at: now(), kitId, type, qty, ref, by: user.id, note }); }
export const kitBalance = (kitId) => store.all('kitMovements').filter((m) => m.kitId === kitId).reduce((t, m) => t + m.qty, 0);
export const kitStatus = (k) => { const b = kitBalance(k.id); return b <= 0 ? 'OUT_OF_STOCK' : b <= k.reorderLevel ? 'LOW_STOCK' : 'IN_STOCK'; };
export function receiveKits({ kitId, qty, lot, expiry }, user) {
  if (!can('lab.kits', user)) throw new Error('You cannot receive kits.');
  qty = Math.floor(Number(qty)); if (!(qty > 0)) throw new Error('Enter the quantity received.');
  return store.transaction(() => { const m = kitMove(kitId, 'RECEIVED', qty, 'KIT-RCV', user, `Lot ${lot || '—'}${expiry ? ' · exp ' + expiry : ''}`); audit(user, 'LAB_KIT_RECEIVED', 'KIT', kitId, `${qty} · ${m.note}`); return m; });
}
export function recordKitUsage({ kitId, qty, type, note }, user) {
  if (!can('lab.kits', user)) throw new Error('You cannot record kit usage.');
  qty = Math.floor(Number(qty)); if (!(qty > 0)) throw new Error('Enter the quantity used.');
  if (!note?.trim()) throw new Error('Give the reason (QC level, repeat reason or wastage).');
  if (qty > kitBalance(kitId)) throw new Error('More than the kits in stock.');
  return store.transaction(() => { const m = kitMove(kitId, type, -qty, type + '-' + businessDate(), user, note.trim()); audit(user, 'LAB_KIT_' + type, 'KIT', kitId, `${qty} · ${note}`); return m; });
}
export function submitKitCount(counted, user) {
  if (!can('lab.kits', user)) throw new Error('You cannot submit kit counts.');
  const kits = store.all('labKits').filter((k) => k.active);
  const lines = kits.filter((k) => counted[k.id] !== '' && counted[k.id] != null).map((k) => { const sys = kitBalance(k.id); const c = Math.floor(Number(counted[k.id])); return { kitId: k.id, system: sys, counted: c, diff: c - sys }; });
  if (!lines.length) throw new Error('Enter the counted quantity for at least one kit.');
  return store.transaction(() => {
    const id = store.nextId('kitCounts', 'KC-');
    const short = lines.filter((l) => l.diff < 0);
    const c = store.insert('kitCounts', { id, at: now(), businessDate: businessDate(), countedBy: user.id, lines, status: short.length ? 'SUBMITTED' : 'MATCHED', reviewedBy: null, reviewedAt: null, reviewNote: '' });
    lines.filter((l) => l.diff).forEach((l) => kitMove(l.kitId, 'COUNT_ADJUST', l.diff, id, user, l.diff < 0 ? 'Physical count shortage' : 'Physical count excess'));
    audit(user, 'LAB_KIT_COUNT', 'KITCOUNT', id, short.length ? `${short.length} kit(s) short` : 'All matched');
    if (short.length) notify({ type: 'KIT_VARIANCE', category: 'Lab kits', severity: 'critical', title: `Lab kit shortage — ${short.length} kit(s)`, message: short.map((l) => `${store.get('labKits', l.kitId).name}: ${l.diff}`).join('; ') + '. Check for tests run without a bill.', refType: 'KITCOUNT', refId: id, targetRoles: OWNER, assignedTo: 'USR-0003' });
    return c;
  });
}
export function reviewKitCount(id, note, user) {
  if (!can('credit.approve', user)) throw new Error('Only the Super Admin reviews kit counts.');
  if (!note?.trim()) throw new Error('Write what was found.');
  return store.transaction(() => { const c = store.get('kitCounts', id); Object.assign(c, { status: 'REVIEWED', reviewedBy: user.id, reviewedAt: now(), reviewNote: note.trim() }); audit(user, 'LAB_KIT_COUNT_REVIEWED', 'KITCOUNT', id, note); return c; });
}
/** Kits billed vs used, per kit (BRD 06: compare kits used against billed tests). */
export function kitReconciliation(from, to) {
  const inR = (iso) => { const d = businessDate(iso); return (!from || d >= from) && (!to || d <= to); };
  return store.all('labKits').map((k) => {
    const tests = store.all('services').filter((s) => s.category === 'LAB' && s.lab.kits.some((x) => x.kitId === k.id));
    const per = (sid) => tests.find((t) => t.id === sid)?.lab.kits.find((x) => x.kitId === k.id)?.qty || 0;
    const os = store.all('orders').filter((o) => (o.billId || o.ipCharge) && o.status !== 'CANCELLED' && tests.some((t) => t.id === o.serviceId) && inR(o.billedAt));
    const billed = os.reduce((t, o) => t + per(o.serviceId), 0);
    const performed = os.filter((o) => o.lab?.collectedAt).reduce((t, o) => t + per(o.serviceId), 0);
    const mv = store.all('kitMovements').filter((m) => m.kitId === k.id && inR(m.at));
    const sum = (type) => -mv.filter((m) => m.type === type).reduce((t, m) => t + m.qty, 0);
    const used = sum('USED_TEST'); const qc = sum('USED_QC'); const repeat = sum('REPEAT'); const waste = sum('WASTAGE'); const countLoss = sum('COUNT_ADJUST');
    const total = used + qc + repeat + waste + countLoss;
    return { kit: k, tests: tests.map((t) => t.code).join(', '), billed, performed, used, qc, repeat, waste, countLoss, total, unexplained: r2(used - performed), efficiency: total ? Math.round(performed / total * 100) : 100, balance: kitBalance(k.id) };
  });
}

// ---------------- patient-level views ----------------
export const patientBills = (pid) => store.all('hbills').filter((b) => b.patientId === pid);
export const patientOrders = (pid) => store.all('orders').filter((o) => o.patientId === pid);
export function settlePackage(ppId, user) {
  if (!can('package.manage', user) && !can('hbill.create', user)) throw new Error('You cannot settle packages.');
  const pp = store.get('patientPackages', ppId);
  if (pp.status !== 'ACTIVE') throw new Error('This package is already closed.');
  const extras = packageExtras(pp);
  const unpaid = extras.map((x) => store.get('hbills', x.billId)).filter((b, i, a) => b && a.indexOf(b) === i && hbillBalance(b) > 0.005);
  if (unpaid.length) throw new Error(`Collect the balance on ${unpaid.map((b) => b.id).join(', ')} before final settlement.`);
  return store.transaction(() => {
    Object.assign(pp, { status: 'COMPLETED', settledAt: now(), settledBy: user.id, settlement: { packagePrice: pkg(pp.packageId).price, extras: r2(extras.reduce((t, x) => t + x.gross, 0)), usage: packageUsage(pp) } });
    audit(user, 'PACKAGE_SETTLED', 'PACKAGE', ppId, `${pkg(pp.packageId).name} · extras ${fmtINR(pp.settlement.extras)}`);
    return pp;
  });
}

/** Collections by the 9 BRD billing categories for a day (OP / IP show zero until those modules post bills). */
export function hospitalDaySummary(date, userId = null) {
  const bills = store.all('hbills').filter((b) => b.businessDate === date && (!userId || b.counterUserId === userId));
  const live = bills.filter((b) => b.status !== 'CANCELLED');
  const byCat = {}; CATS().forEach((c) => { byCat[c.code] = 0; });
  live.forEach((b) => { const f = b.gross ? (b.grandTotal / b.gross) : 0; b.items.forEach((x) => { byCat[x.category] = r2((byCat[x.category] || 0) + x.gross * f); }); });
  const pays = store.all('hbills').flatMap((b) => b.payments).filter((p) => businessDate(p.at) === date && (!userId || p.userId === userId));
  const byMode = {}; ['CASH', 'UPI', 'CARD', 'OTHER'].forEach((m) => { byMode[m] = r2(pays.filter((p) => p.mode === m).reduce((t, p) => t + (p.kind === 'REFUND' ? -p.amount : p.amount), 0)); });
  return { bills: live.length, cancelled: bills.length - live.length, gross: r2(live.reduce((t, b) => t + b.gross, 0)), discounts: r2(live.reduce((t, b) => t + b.discountTotal, 0)), billed: r2(live.reduce((t, b) => t + b.grandTotal, 0)),
    collected: r2(pays.filter((p) => p.kind === 'PAYMENT').reduce((t, p) => t + p.amount, 0)), refunds: r2(pays.filter((p) => p.kind === 'REFUND').reduce((t, p) => t + p.amount, 0)), byMode, byCat,
    credit: r2(live.filter((b) => b.credit && creditOk(b)).reduce((t, b) => t + hbillBalance(b), 0)), outstanding: r2(live.reduce((t, b) => t + hbillBalance(b), 0)) };
}

/** Discount above the staff limit → request to the Super Admin (BRD 09), same register as pharmacy requests. */
export function requestHospitalDiscount(draft, reason, user) {
  if (!can('discount.request', user)) throw new Error('You are not allowed to request discounts.');
  if (!reason?.trim()) throw new Error('Give a reason for the discount.');
  const t = priceHospitalDraft(draft);
  if (t.discountPct <= discountLimit(user)) throw new Error(`Discounts up to ${discountLimit(user)}% do not need approval.`);
  const p = patientOf(draft.patientId);
  return store.transaction(() => {
    const r = store.insert('discountRequests', { id: store.nextId('discountRequests', `DR-${new Date().getFullYear()}-`), source: 'HOSPITAL', status: 'PENDING', requestedBy: user.id, requestedAt: now(), reason: reason.trim(), requestedPct: t.discountPct,
      snapshot: { patientName: p?.name || '—', saleType: 'PATIENT', lines: t.items.map((x) => ({ name: x.name, qty: x.qty })), gross: t.gross, discount: t.discountTotal, grandTotal: t.grandTotal }, decidedBy: null, decidedAt: null, decisionNote: '', billId: null });
    audit(user, 'DISCOUNT_REQUESTED', 'DISCOUNT', r.id, `Hospital bill · ${t.discountPct}% (${fmtINR(t.discountTotal)} on ${fmtINR(t.gross)}): ${reason}`);
    notify({ type: 'DISCOUNT_REQUEST', category: 'Discount Approval', severity: 'warning', title: `Discount approval requested — ${t.discountPct}%`, message: `${r.snapshot.patientName} (main counter): ${fmtINR(t.discountTotal)} off ${fmtINR(t.gross)}. Reason: ${reason}`, refType: 'DISCOUNT', refId: r.id, targetRoles: OWNER, assignedTo: 'USR-0003' });
    return r;
  });
}
