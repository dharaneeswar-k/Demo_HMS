// OP / IP shared core: masters lookups, the hospital receipt ledger (OP fees, IP deposits, settlements, refunds),
// approval requests (discounts above the limit, OP refunds) and the hospital cash-counter closing.
// Hospital money is kept OUT of the pharmacy payment ledger, so pharmacy counter closings are never affected.
import { store } from './data-service.js';
import { can } from './auth.js';
import { audit } from './services.js';
import { notify } from './notifications.js';
import { businessDate, modeLabel } from './pharmacy-calc.js';
import { r2 } from './pricing.js';
import { badge } from './components.js';
import { ymd } from './utils.js';

const now = () => new Date().toISOString();
export const cs = () => store.all('clinicalSettings');
export const yearOf = (d = businessDate()) => String(d).slice(0, 4);

// ---------------- masters ----------------
export const doctor = (id) => store.get('doctors', id);
export const doctorName = (id) => doctor(id)?.name || '—';
export const department = (id) => store.get('departments', id);
export const deptName = (id) => department(id)?.name || '—';
export const activeDoctors = () => store.all('doctors').filter((d) => d.active);
export const doctorForUser = (user) => (user ? store.all('doctors').find((d) => d.userId === user.id) || null : null);
export const service = (id) => store.get('tariff', id);
export const servicesFor = (where) => store.all('tariff').filter((s) => s.active && s.applicableIn.includes(where));
export const patient = (id) => store.get('patients', id);
export const patientLabel = (p) => (p ? `${p.name} · ${p.uhid}` : '—');
export const ward = (id) => store.get('wards', id);
export const bed = (id) => store.get('beds', id);
export const bedCode = (id) => bed(id)?.code || '—';
export const bedCategories = () => cs().ip.bedCategories;
export const categoryLabel = (c) => bedCategories()[c]?.label || c;
export const tpaName = (id) => cs().tpas.find((t) => t.id === id)?.name || '—';
export const discountLimit = () => Number(store.ph().discountLimits?.staffPct ?? 10);
/** True when this discount needs the Super Admin (above the hospital-wide limit and the user cannot approve). */
export const discountNeedsApproval = (pct, user) => Number(pct) > discountLimit() && !can('hospital.approve', user);
export const dayKey = (ts) => ymd(new Date(ts));
export const hourOf = (ts) => new Date(ts).getHours();
export const doctorWorksOn = (d, date = businessDate()) => d.days.includes(new Date(date + 'T12:00:00').getDay());

// ---------------- status labels ----------------
export const LABEL = {
  WAITING: 'Waiting', VITALS_DONE: 'Vitals done', IN_CONSULTATION: 'In consultation', COMPLETED: 'Completed', REFERRED_IP: 'Referred to IP', NO_SHOW: 'No-show', CANCELLED: 'Cancelled',
  NEW: 'New', REVISIT: 'Revisit', FOLLOW_UP: 'Free follow-up', EMERGENCY: 'Emergency',
  PAID: 'Paid', UNPAID: 'Unpaid', PARTIALLY_PAID: 'Part paid', DISCOUNT_PENDING: 'Discount awaiting approval', REFUND_PENDING: 'Refund awaiting approval', REFUND_APPROVED: 'Refund to pay', REFUNDED: 'Refunded',
  ADMITTED: 'Admitted', DISCHARGE_INITIATED: 'Discharge initiated', BILL_FINALISED: 'Final bill ready', DISCHARGED: 'Discharged',
  AWAITING_TPA: 'Awaiting TPA final approval', PENDING_SETTLEMENT: 'Awaiting settlement', SETTLED: 'Settled',
  RAISED: 'Waiting for pharmacy', ISSUED: 'Issued', PARTIAL: 'Part issued',
  AVAILABLE: 'Available', OCCUPIED: 'Occupied', CLEANING: 'Cleaning', BLOCKED: 'Blocked', RESERVED: 'Reserved', READY: 'Available',
  PREAUTH_PENDING: 'Pre-auth pending', APPROVED: 'Approved', REJECTED: 'Rejected', ENHANCEMENT_PENDING: 'Enhancement pending', FINAL_APPROVED: 'Final approval received',
  NOT_SUBMITTED: 'Claim not submitted', SUBMITTED: 'Claim submitted', PENDING: 'Pending', VERIFIED: 'Verified', STAT: 'STAT', ROUTINE: 'Routine',
  SELF: 'Self-pay', INSURANCE: 'Insurance / TPA', CORPORATE: 'Corporate',
  NORMAL: 'Normal discharge', LAMA: 'LAMA / DAMA', REFERRED: 'Referred to higher centre', DEATH: 'Death',
  PLANNED: 'Planned', FROM_OP: 'From OP'
};
export const label = (s) => LABEL[s] || s;
export const cbadge = (status, text) => badge(status, text || label(status));
export const CLAIM_LABEL = { NOT_SUBMITTED: 'Claim not submitted', SUBMITTED: 'Claim submitted', SETTLED: 'Claim settled' };

// ---------------- receipt ledger ----------------
let rv = -1; let rIdx = null;
function rIndex() {
  if (rv === store.version && rIdx) return rIdx;
  rv = store.version; rIdx = {};
  store.all('hospitalReceipts').forEach((r) => { (rIdx[r.refId] ||= []).push(r); });
  return rIdx;
}
export const receiptsFor = (refId) => rIndex()[refId] || [];
/** Money held against a reference: payments + deposits − refunds. */
export const netReceived = (refId) => r2(receiptsFor(refId).reduce((t, r) => t + (r.kind === 'REFUND' ? -r.amount : r.amount), 0));
export const payModes = () => store.ph().paymentModes.filter((m) => m.active).map((m) => m.code);
export { modeLabel };

export function hospitalClosingFor(date, cashierId) { return store.all('hospitalClosings').find((c) => c.businessDate === date && c.cashierId === cashierId) || null; }

/** Insert one receipt (must be called inside a store transaction). */
export function addReceipt({ kind = 'PAYMENT', source, refType, refId, patientId, mode, amount, tendered = null, reference = '', note = '' }, user) {
  amount = r2(amount);
  if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
  if (!mode) throw new Error('Choose how the money was paid.');
  const date = businessDate();
  if (hospitalClosingFor(date, user.id)) throw new Error(`Your hospital cash counter is already closed for ${date}. Ask the Super Admin to re-open it.`);
  if (mode === 'CASH' && kind !== 'REFUND' && tendered != null && tendered !== '' && Number(tendered) < amount) throw new Error('Cash received is less than the amount.');
  const id = store.nextId('hospitalReceipts', `HR-${yearOf(date)}-`, 6);
  const rec = { id, kind, source, refType, refId, patientId, mode, amount, tendered: mode === 'CASH' && kind !== 'REFUND' ? (tendered === '' || tendered == null ? amount : r2(tendered)) : null,
    change: mode === 'CASH' && kind !== 'REFUND' ? r2((tendered === '' || tendered == null ? amount : Number(tendered)) - amount) : null, reference, note, at: now(), businessDate: date, userId: user.id };
  store.insert('hospitalReceipts', rec);
  store.touch();
  return rec;
}

// ---------------- approval requests ----------------
export const pendingRequestFor = (refId) => store.all('hospitalRequests').find((r) => r.refId === refId && r.status === 'PENDING') || null;
export function createRequest({ type, source, refType, refId, patientId, pct = null, base = 0, amount = 0, reason }, user) {
  if (!String(reason || '').trim()) throw new Error('Give a reason for the request.');
  const id = store.nextId('hospitalRequests', `HRQ-${yearOf()}-`);
  const rq = store.insert('hospitalRequests', { id, type, source, refType, refId, patientId, pct, base: r2(base), amount: r2(amount), reason: reason.trim(), status: 'PENDING',
    requestedBy: user.id, requestedAt: now(), decidedBy: null, decidedAt: null, decisionNote: '' });
  const p = patient(patientId);
  notify({ type: type === 'DISCOUNT' ? 'HOSPITAL_DISCOUNT_REQUEST' : 'HOSPITAL_REFUND_REQUEST', category: type === 'DISCOUNT' ? 'Discount Approval' : 'Refund Approval', severity: 'critical',
    title: type === 'DISCOUNT' ? `Approve ${pct}% ${source} discount` : `Approve ${source} refund`, message: `${p?.name || ''}: ₹${rq.amount}${type === 'DISCOUNT' ? ` off ₹${rq.base}` : ''}. Reason: ${rq.reason}`,
    refType: 'HOSP_REQUEST', refId: id, targetRoles: ['SUPER_ADMIN'], assignedTo: null });
  audit(user, `HOSPITAL_${type}_REQUESTED`, 'HOSP_REQUEST', id, `${refId} · ${rq.reason}`);
  return rq;
}

// ---------------- hospital cash closing ----------------
export function counterDay(date, cashierId) {
  const tx = store.all('hospitalReceipts').filter((r) => r.businessDate === date && r.userId === cashierId);
  const modes = ['CASH', 'UPI', 'CARD', 'OTHER'];
  const by = (m, kind) => r2(tx.filter((r) => r.mode === m && (kind ? r.kind === kind : r.kind !== 'REFUND')).reduce((t, r) => t + r.amount, 0));
  const float = Number(cs().cashier.openingFloat) || 0;
  const rows = modes.map((m) => ({ mode: m, received: by(m), refunded: by(m, 'REFUND'), expected: r2(by(m) - by(m, 'REFUND') + (m === 'CASH' ? float : 0)) }));
  return {
    date, cashierId, tx, float, rows,
    expected: Object.fromEntries(rows.map((r) => [r.mode, r.expected])),
    totals: { receipts: tx.filter((r) => r.kind !== 'REFUND').length, collected: r2(tx.filter((r) => r.kind !== 'REFUND').reduce((t, r) => t + r.amount, 0)), refunds: r2(tx.filter((r) => r.kind === 'REFUND').reduce((t, r) => t + r.amount, 0)),
      op: r2(tx.filter((r) => r.source === 'OP' && r.kind !== 'REFUND').reduce((t, r) => t + r.amount, 0)), deposits: r2(tx.filter((r) => r.kind === 'DEPOSIT').reduce((t, r) => t + r.amount, 0)),
      settlements: r2(tx.filter((r) => r.source === 'IP' && r.kind === 'PAYMENT').reduce((t, r) => t + r.amount, 0)) }
  };
}
/** Cashier-days with receipts before today that were never closed. */
export function pendingHospitalClosings() {
  const today = businessDate(); const keys = new Set();
  store.all('hospitalReceipts').forEach((r) => { if (r.businessDate < today) keys.add(r.businessDate + '|' + r.userId); });
  return [...keys].filter((k) => { const [d, c] = k.split('|'); return !hospitalClosingFor(d, c); }).map((k) => { const [date, cashierId] = k.split('|'); return { date, cashierId }; }).sort((a, b) => b.date.localeCompare(a.date));
}
export function submitHospitalClosing({ date, actual, remarks }, user) {
  if (!can('hospital.closing', user)) throw new Error('You are not allowed to close the hospital cash counter.');
  if (hospitalClosingFor(date, user.id)) throw new Error(`The counter is already closed for ${date}.`);
  const d = counterDay(date, user.id);
  if (!d.tx.length) throw new Error('There are no receipts to close for this day.');
  const act = Object.fromEntries(Object.keys(d.expected).map((m) => [m, r2(actual[m] ?? 0)]));
  if (Object.values(act).some((v) => v < 0)) throw new Error('Amounts cannot be negative.');
  const diff = r2(Object.values(act).reduce((t, v) => t + v, 0) - Object.values(d.expected).reduce((t, v) => t + v, 0));
  const cashDiff = r2(act.CASH - d.expected.CASH);
  const tol = Number(cs().cashier.varianceTolerance) || 0;
  if (Math.abs(diff) > 0 && !String(remarks || '').trim()) throw new Error('Explain the difference in the remarks.');
  return store.transaction(() => {
    const id = store.nextId('hospitalClosings', `HCL-${yearOf(date)}-`);
    const c = store.insert('hospitalClosings', { id, businessDate: date, cashierId: user.id, submittedAt: now(), openingFloat: d.float, expected: d.expected, actual: act, difference: diff, cashDifference: cashDiff,
      totals: d.totals, remarks: String(remarks || '').trim() || 'Counter balanced.', status: 'SUBMITTED', verifiedBy: null, verifiedAt: null });
    notify({ type: 'HOSPITAL_CLOSING_SUBMITTED', category: 'Cash Closing', severity: Math.abs(cashDiff) > tol ? 'critical' : cashDiff ? 'warning' : 'success', title: `Hospital cash closing — ${date}`,
      message: `${user.name} closed the OP/IP counter. Collected ₹${d.totals.collected}, refunds ₹${d.totals.refunds}. Cash ${cashDiff ? 'difference ₹' + cashDiff : 'matched'}.`,
      refType: 'HOSP_CLOSING', refId: id, targetRoles: ['SUPER_ADMIN'] });
    audit(user, 'HOSPITAL_CLOSING_SUBMITTED', 'HOSP_CLOSING', id, `${date} · cash difference ${cashDiff}`);
    return c;
  });
}
export function verifyHospitalClosing(id, user) {
  if (!can('hospital.closing.verify', user)) throw new Error('Only the Super Admin can verify closings.');
  return store.transaction(() => { const c = store.get('hospitalClosings', id); if (c.status === 'VERIFIED') throw new Error('Already verified.'); Object.assign(c, { status: 'VERIFIED', verifiedBy: user.id, verifiedAt: now() }); audit(user, 'HOSPITAL_CLOSING_VERIFIED', 'HOSP_CLOSING', id, c.businessDate); return c; });
}
export function reopenHospitalClosing(id, reason, user) {
  if (!can('hospital.closing.verify', user)) throw new Error('Only the Super Admin can re-open a closing.');
  return store.transaction(() => { const c = store.get('hospitalClosings', id); store.all('hospitalClosings').splice(store.all('hospitalClosings').indexOf(c), 1); audit(user, 'HOSPITAL_CLOSING_REOPENED', 'HOSP_CLOSING', id, `${c.businessDate} ${c.cashierId}: ${reason}`); });
}
