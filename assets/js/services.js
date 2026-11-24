// Business transactions. Every stock change goes through createMovement() — balances are never overwritten.
import { store } from './data-service.js';
import { PHARMACY, STORE_LOC, locationName, batchBalance, batchStatus, fefoBatches, grnTotals, IN_TYPES, isIssuable, medicineStock, medName, stockStatus, supplierName } from './calculations.js';
import { validateGrn } from './validation.js';
import { notify } from './notifications.js';
import { can } from './auth.js';
import { round2 } from './utils.js';

const now = () => new Date().toISOString();

export function audit(user, action, entity, entityId, details = '') {
  store.insert('audit', { id: store.nextId('audit', 'AUD-', 5), at: now(), userId: user?.id || null, action, entity, entityId, details });
}

export function createMovement({ batchId, type, qty, reference, user, reason, at, locationId }) {
  qty = Number(qty);
  if (!(qty > 0) || !Number.isInteger(qty)) throw new Error('Movement quantity must be a positive whole number.');
  if (!reason) throw new Error('A reason is required for every stock movement.');
  const b = store.get('batches', batchId);
  if (!b) throw new Error('Batch not found.');
  const loc = locationId || PHARMACY();
  const prev = batchBalance(batchId, loc);
  const isIn = IN_TYPES.includes(type);
  const next = isIn ? prev + qty : prev - qty;
  if (next < 0) throw new Error(`Insufficient stock in batch ${b.batchNo} at ${locationName(loc)}: ${prev} available, ${qty} requested.`);
  const mv = { id: store.nextId('movements', 'MOV-', 5), at: at || now(), medicineId: b.medicineId, batchId, type,
    qtyIn: isIn ? qty : 0, qtyOut: isIn ? 0 : qty, prevBalance: prev, newBalance: next, reference, userId: user.id, reason, locationId: loc };
  store.insert('movements', mv);
  store.touch(); // bump version so derived balances refresh for the next movement in the same transaction
  return mv;
}

// ---------------- GRN ----------------
const history = (g, status, user, note) => { g.history = g.history || []; g.history.push({ status, by: user.id, at: now(), note }); };

export function newGrnDraft(user) {
  const s = store.settings();
  return {
    id: store.nextId('grns', `GRN-${new Date().getFullYear()}-`), supplierId: '', invoiceNo: '', invoiceDate: '', invoiceAmount: '', poRef: '',
    locationId: s.defaultLocationId, receivedAt: now(), receivedBy: user.id, remarks: '', status: 'DRAFT', items: [],
    attachments: { invoice: null, photos: [] }, verifiedBy: null, verifiedAt: null, approvedBy: null, approvedAt: null, postedBy: null, postedAt: null,
    rejectedReason: null, requiresOwnerApproval: false, exceptionReasons: [], history: [], createdBy: user.id, createdAt: now(), updatedAt: now(), isNew: true
  };
}

export function saveGrn(g, user, note = 'Draft saved') {
  return store.transaction(() => {
    const existing = store.get('grns', g.id);
    if (existing && !['DRAFT', 'VALIDATION_REQUIRED', 'SUBMITTED'].includes(existing.status)) throw new Error(`${g.id} is ${existing.status} and can no longer be edited.`);
    const rec = { ...g, grnNumber: g.id, updatedAt: now() };
    delete rec.isNew;
    if (!existing) {
      // guard against id collision when two drafts are started in parallel tabs
      if (store.get('grns', rec.id)) rec.id = rec.grnNumber = store.nextId('grns', `GRN-${new Date().getFullYear()}-`);
      history(rec, 'DRAFT', user, 'GRN created');
      store.insert('grns', rec);
      audit(user, 'GRN_CREATED', 'GRN', rec.id, `Supplier ${supplierName(rec.supplierId)}, invoice ${rec.invoiceNo || '—'}`);
    } else {
      if (existing.status === 'SUBMITTED') rec.status = 'SUBMITTED';
      store.update('grns', rec.id, rec);
      audit(user, 'GRN_UPDATED', 'GRN', rec.id, note);
    }
    store.all('attachments').forEach((a) => { if (a.grnId === 'PENDING' && (rec.attachments.invoice === a.id || rec.attachments.photos.includes(a.id))) a.grnId = rec.id; });
    return store.get('grns', rec.id);
  });
}

export function submitGrn(g, user) {
  const v = validateGrn(g);
  const saved = saveGrn(g, user, 'Saved before submission');
  return store.transaction(() => {
    if (!v.ok) {
      saved.status = 'VALIDATION_REQUIRED';
      history(saved, 'VALIDATION_REQUIRED', user, `Submission blocked: ${v.errors.length} issue(s)`);
      audit(user, 'GRN_VALIDATION_REQUIRED', 'GRN', saved.id, v.errors.map((e) => e.msg).join(' | '));
      return { ok: false, grn: saved, validation: v };
    }
    saved.status = 'SUBMITTED';
    history(saved, 'SUBMITTED', user, 'Submitted for verification');
    audit(user, 'GRN_SUBMITTED', 'GRN', saved.id, `${grnTotals(saved).lines} lines`);
    if (!can('grn.verify', user)) notify({ type: 'GRN_PENDING_VERIFICATION', category: 'GRN Pending Verification', severity: 'warning', title: `GRN awaiting verification — ${saved.id}`,
      message: `Submitted by ${user.name}. Supplier: ${supplierName(saved.supplierId)}.`, refType: 'GRN', refId: saved.id, targetRoles: ['STORE_INCHARGE', 'SUPER_ADMIN'], assignedTo: 'USR-0002' });
    return { ok: true, grn: saved, validation: v };
  });
}

/** Manager verification. Routine receipts are posted immediately; exceptional ones go to the owner. */
export function verifyAndPost(id, user) {
  if (!can('grn.post', user)) throw new Error('You do not have permission to post stock.');
  const g = store.get('grns', id);
  if (!['SUBMITTED', 'DRAFT', 'VALIDATION_REQUIRED'].includes(g.status)) throw new Error(`Cannot post a GRN in ${g.status} status.`);
  const v = validateGrn(g);
  if (!v.ok) throw new Error('GRN has validation errors: ' + v.errors[0].msg);
  return store.transaction(() => {
    g.verifiedBy = user.id; g.verifiedAt = now();
    if (g.status !== 'SUBMITTED') history(g, 'SUBMITTED', user, 'Submitted for verification');
    if (v.exceptions.length && !can('grn.approve.exceptional', user)) {
      g.status = 'PENDING_APPROVAL'; g.requiresOwnerApproval = true; g.exceptionReasons = v.exceptions;
      history(g, 'PENDING_APPROVAL', user, 'Verified. Escalated to owner: ' + v.exceptions.join('; '));
      audit(user, 'GRN_ESCALATED', 'GRN', g.id, v.exceptions.join('; '));
      notify({ type: 'GRN_APPROVAL_REQUIRED', category: 'GRN Discrepancy', severity: 'critical', title: `Owner approval required — ${g.id}`,
        message: v.exceptions.join('; '), refType: 'GRN', refId: g.id, targetRoles: ['SUPER_ADMIN'], assignedTo: 'USR-0003' });
      return { posted: false, grn: g, exceptions: v.exceptions };
    }
    if (v.exceptions.length) { g.exceptionReasons = v.exceptions; g.approvedBy = user.id; g.approvedAt = now(); history(g, 'APPROVED', user, 'Exceptions reviewed and approved by owner'); }
    postStock(g, user);
    return { posted: true, grn: g };
  });
}

export function approveGrn(id, user) {
  if (!can('grn.approve.exceptional', user)) throw new Error('Only the hospital owner can approve exceptional receipts.');
  return store.transaction(() => {
    const g = store.get('grns', id);
    if (g.status !== 'PENDING_APPROVAL') throw new Error('GRN is not awaiting approval.');
    g.approvedBy = user.id; g.approvedAt = now();
    history(g, 'APPROVED', user, 'Approved by owner');
    audit(user, 'GRN_APPROVED', 'GRN', g.id, (g.exceptionReasons || []).join('; '));
    postStock(g, user);
    return g;
  });
}

function postStock(g, user) {
  for (const it of g.items) {
    const qty = Number(it.receivedQty) + Number(it.freeQty || 0);
    let b = store.all('batches').find((x) => x.medicineId === it.medicineId && x.batchNo.toUpperCase() === it.batchNo.trim().toUpperCase() && x.expiryDate === it.expiryDate && Number(x.mrp) === Number(it.mrp) && !x.returned);
    if (b) b.receivedQty += qty;
    else {
      b = store.insert('batches', { id: store.nextId('batches', 'BAT-'), batchNo: it.batchNo.trim().toUpperCase(), medicineId: it.medicineId, expiryDate: it.expiryDate,
        mfgDate: it.mfgDate || null, mrp: Number(it.mrp), ptr: Number(it.ptr), receivedQty: qty, supplierId: g.supplierId, grnId: g.id, locationId: g.locationId,
        receivedAt: now(), quarantined: false, returned: false, notes: it.remarks || '' });
    }
    it.batchId = b.id;
    createMovement({ batchId: b.id, type: 'PURCHASE_RECEIPT', qty, reference: g.id, user, reason: `Goods receipt against invoice ${g.invoiceNo}`, locationId: g.locationId || STORE_LOC() });
  }
  g.status = 'POSTED'; g.postedBy = user.id; g.postedAt = now(); g.updatedAt = now();
  history(g, 'POSTED', user, 'Stock posted to inventory');
  audit(user, 'GRN_POSTED', 'GRN', g.id, `${g.items.length} lines, ${grnTotals(g).totalQty} units, value ₹${grnTotals(g).grand}`);
  if (store.settings().approval?.notifyOwnerOnPost !== false) {
    notify({ type: 'GRN_POSTED', category: 'GRN', severity: 'success', title: `Stock receipt posted — ${g.id}`,
      message: `${g.items.length} line(s) worth ₹${grnTotals(g).grand.toLocaleString('en-IN')} from ${supplierName(g.supplierId)} posted by ${user.name}.`,
      refType: 'GRN', refId: g.id, targetRoles: ['SUPER_ADMIN'], assignedTo: 'USR-0003' });
  }
  // notify the submitter
  if (g.receivedBy !== user.id) notify({ type: 'GRN_POSTED', category: 'GRN', severity: 'success', title: `${g.id} posted`, message: `Your GRN was verified and posted by ${user.name}.`, refType: 'GRN', refId: g.id, targetRoles: [], assignedTo: g.receivedBy });
}

export function rejectGrn(id, user, reason) {
  if (!reason?.trim()) throw new Error('A rejection reason is required.');
  return store.transaction(() => {
    const g = store.get('grns', id);
    if (g.status === 'PENDING_APPROVAL' && !can('grn.approve.exceptional', user)) throw new Error('Only the owner can decide on this GRN.');
    if (!['SUBMITTED', 'PENDING_APPROVAL', 'VALIDATION_REQUIRED'].includes(g.status)) throw new Error(`Cannot reject a ${g.status} GRN.`);
    g.status = 'REJECTED'; g.rejectedReason = reason; g.updatedAt = now();
    history(g, 'REJECTED', user, reason);
    audit(user, 'GRN_REJECTED', 'GRN', g.id, reason);
    notify({ type: 'GRN_REJECTED', category: 'GRN', severity: 'info', title: `GRN rejected — ${g.id}`, message: reason, refType: 'GRN', refId: g.id, targetRoles: [], assignedTo: g.receivedBy });
    return g;
  });
}
export function cancelGrn(id, user, reason) {
  if (!reason?.trim()) throw new Error('A cancellation reason is required.');
  return store.transaction(() => {
    const g = store.get('grns', id);
    if (!['DRAFT', 'VALIDATION_REQUIRED', 'SUBMITTED'].includes(g.status)) throw new Error(`A ${g.status} GRN cannot be cancelled. Use a supplier return or stock adjustment for corrections.`);
    g.status = 'CANCELLED'; g.updatedAt = now(); g.remarks = (g.remarks ? g.remarks + ' | ' : '') + 'Cancelled: ' + reason;
    history(g, 'CANCELLED', user, reason);
    audit(user, 'GRN_CANCELLED', 'GRN', g.id, reason);
    return g;
  });
}
export function sendBackGrn(id, user, reason) {
  return store.transaction(() => {
    const g = store.get('grns', id);
    if (g.status !== 'SUBMITTED') throw new Error('Only submitted GRNs can be returned for correction.');
    g.status = 'VALIDATION_REQUIRED'; g.updatedAt = now();
    history(g, 'VALIDATION_REQUIRED', user, 'Returned for correction: ' + reason);
    audit(user, 'GRN_RETURNED_FOR_CORRECTION', 'GRN', g.id, reason);
    notify({ type: 'GRN_CORRECTION', category: 'GRN Discrepancy', severity: 'warning', title: `Correction requested — ${g.id}`, message: reason, refType: 'GRN', refId: g.id, targetRoles: [], assignedTo: g.receivedBy });
    return g;
  });
}

// ---------------- adjustments ----------------
export function adjustmentNeedsOwner(batch, diff) {
  const ap = store.settings().approval || {};
  return Math.abs(diff) > (ap.adjustmentQtyThreshold ?? 50) || Math.abs(diff) * batch.ptr > (ap.adjustmentValueThreshold ?? 5000);
}

export function requestAdjustment({ batchId, physicalQty, reason, notes, attachmentId, locationId }, user) {
  if (!reason) throw new Error('Select a reason for the adjustment.');
  if (!notes?.trim()) throw new Error('Describe the reason for the adjustment.');
  const pq = Number(physicalQty);
  if (!Number.isInteger(pq) || pq < 0) throw new Error('Physical quantity must be a whole number ≥ 0.');
  const b = store.get('batches', batchId);
  const loc = locationId || PHARMACY();
  const sys = batchBalance(batchId, loc);
  const diff = pq - sys;
  if (diff === 0) throw new Error('Physical quantity equals system quantity — no adjustment needed.');
  const requiresOwner = adjustmentNeedsOwner(b, diff);
  return store.transaction(() => {
    const a = store.insert('adjustments', { id: store.nextId('adjustments', 'ADJ-'), medicineId: b.medicineId, batchId, systemQty: sys, physicalQty: pq, difference: diff,
      type: diff > 0 ? 'IN' : 'OUT', locationId: loc, reason, notes, attachmentId: attachmentId || null, requestedBy: user.id, requestedAt: now(),
      status: requiresOwner ? 'PENDING_OWNER_APPROVAL' : 'PENDING_APPROVAL', requiresOwner, approvedBy: null, approvedAt: null, rejectionReason: null, movementId: null });
    audit(user, 'ADJUSTMENT_REQUESTED', 'ADJUSTMENT', a.id, `${medName(b.medicineId)} ${b.batchNo}: ${diff} (${reason})`);
    // Routine adjustments raised by an approver are approved in the same step (still recorded as a separate approval).
    const selfApprove = !requiresOwner ? can('adjustment.approve', user) : can('adjustment.approve.exceptional', user);
    if (selfApprove) { applyAdjustment(a, user); return a; }
    notify({ type: 'ADJUSTMENT_APPROVAL', category: 'Stock Adjustment Approval', severity: requiresOwner ? 'critical' : 'warning', title: `Adjustment approval — ${a.id}`,
      message: `${medName(b.medicineId)} (${b.batchNo}): ${diff > 0 ? '+' : ''}${diff}. Reason: ${reason}. Requested by ${user.name}.`, refType: 'ADJUSTMENT', refId: a.id,
      targetRoles: requiresOwner ? ['SUPER_ADMIN'] : ['STORE_INCHARGE', 'SUPER_ADMIN'], assignedTo: requiresOwner ? 'USR-0003' : 'USR-0002' });
    return a;
  });
}
function applyAdjustment(a, user) {
  const mv = createMovement({ batchId: a.batchId, type: a.difference > 0 ? 'STOCK_ADJUSTMENT_IN' : 'STOCK_ADJUSTMENT_OUT', qty: Math.abs(a.difference), reference: a.id, user, reason: `${a.reason} — ${a.notes}`, locationId: a.locationId || PHARMACY() });
  a.status = 'APPROVED'; a.approvedBy = user.id; a.approvedAt = now(); a.movementId = mv.id;
  audit(user, 'ADJUSTMENT_APPROVED', 'ADJUSTMENT', a.id, `Movement ${mv.id}`);
}
export function canDecideAdjustment(a, user) {
  if (!a.status.startsWith('PENDING')) return false;
  if (a.requestedBy === user.id && !can('adjustment.approve.exceptional', user)) return false; // no self-approval
  return a.requiresOwner ? can('adjustment.approve.exceptional', user) : can('adjustment.approve', user);
}
export function approveAdjustment(id, user) {
  return store.transaction(() => {
    const a = store.get('adjustments', id);
    if (!canDecideAdjustment(a, user)) throw new Error('You are not allowed to approve this adjustment.');
    applyAdjustment(a, user);
    notify({ type: 'ADJUSTMENT_DECIDED', category: 'Stock Adjustment Approval', severity: 'success', title: `${a.id} approved`, message: `Approved by ${user.name}. Stock updated.`, refType: 'ADJUSTMENT', refId: a.id, targetRoles: [], assignedTo: a.requestedBy });
    return a;
  });
}
export function rejectAdjustment(id, user, reason) {
  if (!reason?.trim()) throw new Error('A rejection reason is required.');
  return store.transaction(() => {
    const a = store.get('adjustments', id);
    if (!canDecideAdjustment(a, user)) throw new Error('You are not allowed to reject this adjustment.');
    Object.assign(a, { status: 'REJECTED', approvedBy: user.id, approvedAt: now(), rejectionReason: reason });
    audit(user, 'ADJUSTMENT_REJECTED', 'ADJUSTMENT', a.id, reason);
    notify({ type: 'ADJUSTMENT_DECIDED', category: 'Stock Adjustment Approval', severity: 'info', title: `${a.id} rejected`, message: reason, refType: 'ADJUSTMENT', refId: a.id, targetRoles: [], assignedTo: a.requestedBy });
    return a;
  });
}

// ---------------- batch operations ----------------
export function supplierReturn(batchId, qty, reason, user, locationId = STORE_LOC()) {
  return store.transaction(() => {
    const b = store.get('batches', batchId);
    const mv = createMovement({ batchId, type: 'SUPPLIER_RETURN', qty, reference: 'SRN-' + String(store.all('movements').filter((m) => m.type === 'SUPPLIER_RETURN').length + 1).padStart(4, '0'), user, reason, locationId });
    if (batchBalance(batchId) === 0) b.returned = true;
    audit(user, 'SUPPLIER_RETURN', 'BATCH', batchId, `${qty} returned to ${supplierName(b.supplierId)}: ${reason}`);
    return mv;
  });
}
export function writeOffExpired(batchId, user, reason) {
  return store.transaction(() => {
    const b = store.get('batches', batchId);
    if (batchStatus(b) !== 'EXPIRED') throw new Error('Only expired batches can be written off here.');
    const q = batchBalance(batchId);
    const ref = 'WO-' + String(store.all('movements').filter((m) => m.type === 'EXPIRED_WRITE_OFF').length + 1).padStart(4, '0');
    let mv;
    for (const loc of [PHARMACY(), STORE_LOC()]) { const lq = batchBalance(batchId, loc); if (lq > 0) mv = createMovement({ batchId, type: 'EXPIRED_WRITE_OFF', qty: lq, reference: ref, user, reason: reason || 'Expired stock removed for destruction', locationId: loc }); }
    audit(user, 'EXPIRED_WRITE_OFF', 'BATCH', batchId, `${q} units written off (value ₹${round2(q * b.ptr)})`);
    return mv;
  });
}
export function setQuarantine(batchId, on, reason, user) {
  return store.transaction(() => {
    const b = store.get('batches', batchId);
    b.quarantined = on; b.notes = on ? 'Quarantined: ' + reason : (b.notes ? b.notes + ' | ' : '') + 'Released from quarantine: ' + reason;
    audit(user, on ? 'BATCH_QUARANTINED' : 'BATCH_RELEASED', 'BATCH', batchId, reason);
    return b;
  });
}

// ---------------- Store → Pharmacy transfer (BRD module 05) ----------------
/** Moves stock from the central store to the pharmacy in ONE transaction: Store −qty, Pharmacy +qty for every batch line. */
export function transferStock({ items, remarks, receivedBy }, user) {
  if (!can('store.transfer', user)) throw new Error('Only the Store can transfer stock to the pharmacy.');
  const lines = items.filter((x) => Number(x.qty) > 0);
  if (!lines.length) throw new Error('Enter a quantity for at least one batch.');
  const from = STORE_LOC(); const to = PHARMACY();
  lines.forEach((x) => {
    const b = store.get('batches', x.batchId);
    if (!Number.isInteger(Number(x.qty))) throw new Error('Quantities must be whole numbers.');
    if (batchStatus(b) === 'EXPIRED' || b.quarantined) throw new Error(`${medName(b.medicineId)} batch ${b.batchNo} is ${b.quarantined ? 'quarantined' : 'expired'} and cannot be sent to the pharmacy.`);
    if (Number(x.qty) > batchBalance(b.id, from)) throw new Error(`${medName(b.medicineId)} batch ${b.batchNo}: only ${batchBalance(b.id, from)} in the store.`);
  });
  return store.transaction(() => {
    const at = now();
    const id = store.nextId('transfers', `TRF-${new Date().getFullYear()}-`);
    lines.forEach((x) => {
      createMovement({ batchId: x.batchId, type: 'STOCK_TRANSFER_OUT', qty: Number(x.qty), reference: id, user, reason: 'Transfer to Pharmacy', at, locationId: from });
      createMovement({ batchId: x.batchId, type: 'STOCK_TRANSFER_IN', qty: Number(x.qty), reference: id, user, reason: 'Received from Central Store', at, locationId: to });
    });
    const t = store.insert('transfers', { id, at, businessDate: at.slice(0, 10), fromLocationId: from, toLocationId: to,
      items: lines.map((x) => ({ batchId: x.batchId, medicineId: store.get('batches', x.batchId).medicineId, qty: Number(x.qty) })),
      totalQty: lines.reduce((t2, x) => t2 + Number(x.qty), 0), value: round2(lines.reduce((t2, x) => t2 + Number(x.qty) * store.get('batches', x.batchId).ptr, 0)),
      performedBy: user.id, receivedBy: receivedBy || null, status: 'COMPLETED', remarks: remarks || '' });
    audit(user, 'STOCK_TRANSFERRED', 'TRANSFER', id, `${t.items.length} batch line(s), ${t.totalQty} units Store → Pharmacy`);
    notify({ type: 'STOCK_TRANSFER', category: 'Stock Transfer', severity: 'info', title: `Stock sent to pharmacy — ${id}`,
      message: `${t.totalQty} unit(s) across ${t.items.length} batch line(s): ${t.items.slice(0, 3).map((x) => `${medName(x.medicineId)} ×${x.qty}`).join(', ')}${t.items.length > 3 ? '…' : ''}`,
      refType: 'TRANSFER', refId: id, targetRoles: ['PHARMACY_STAFF', 'SUPER_ADMIN'], assignedTo: null });
    return t;
  });
}
