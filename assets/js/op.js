// Outpatient (BRD module 02) — visits, tokens and queue, vitals, consultation (case sheet + prescription),
// OP bills (consultation fee, investigations/services), cancellations and refunds. Each action is one store transaction.
import { store } from './data-service.js';
import { can } from './auth.js';
import { audit } from './services.js';
import { notify } from './notifications.js';
import { businessDate } from './pharmacy-calc.js';
import { r2 } from './pricing.js';
import { opVisitPolicy, priceServices, bmi, vitalFlags } from './clinical-rules.js';
import { createVisitForOpBill, syncOpBillLab } from './labflow.js';
import { cs, doctor, department, service, patient, addReceipt, netReceived, createRequest, discountNeedsApproval, discountLimit, pendingRequestFor, yearOf, label } from './clinical.js';

const now = () => new Date().toISOString();
const pad = (n, l = 3) => String(n).padStart(l, '0');
export const ACTIVE_STATES = ['WAITING', 'VITALS_DONE', 'IN_CONSULTATION'];
export { vitalFlags, bmi };

// ---------------- reads ----------------
export const visit = (id) => store.get('opVisits', id);
export const visitsOn = (date = businessDate()) => store.all('opVisits').filter((v) => v.businessDate === date);
export const visitBills = (v) => (v.billIds || []).map((id) => store.get('opBills', id)).filter(Boolean);
export const opBillPaid = (b) => netReceived(b.id);
export const opBillDue = (b) => (['CANCELLED', 'REFUNDED', 'REFUND_PENDING', 'REFUND_APPROVED', 'DISCOUNT_PENDING'].includes(b.status) ? 0 : r2(Math.max(0, b.total - opBillPaid(b))));
export const visitDue = (v) => r2(visitBills(v).reduce((t, b) => t + opBillDue(b), 0));
export const visitBilled = (v) => r2(visitBills(v).filter((b) => !['CANCELLED', 'REFUNDED'].includes(b.status)).reduce((t, b) => t + b.total, 0));
export const patientVisits = (patientId) => store.all('opVisits').filter((v) => v.patientId === patientId).sort((a, b) => b.at.localeCompare(a.at));

/** Visit type and fee for a patient + doctor today (free follow-up window, revisit, new, emergency). */
export function visitPolicy(patientId, doctorId, emergency = false) {
  const d = doctor(doctorId); if (!d) return null;
  const history = store.all('opVisits').filter((v) => v.patientId === patientId && v.status !== 'CANCELLED').map((v) => ({ doctorId: v.doctorId, date: v.businessDate, visitType: v.visitType }));
  return opVisitPolicy({ history, doctor: d, today: businessDate(), emergency, emergencyFee: cs().op.emergencyFee });
}

/** Queue for one doctor and day: emergencies first, then token order (a skipped token drops N places). */
export function doctorQueue(doctorId, date = businessDate()) {
  const all = visitsOn(date).filter((v) => v.doctorId === doctorId);
  const step = Number(cs().op.skipPlaces) || 3;
  const order = (v) => (v.priority === 'EMERGENCY' ? -1000 : 0) + v.tokenNo + (v.skips || 0) * step + (v.status === 'VITALS_DONE' ? -0.5 : 0);
  const waiting = all.filter((v) => v.status === 'WAITING' || v.status === 'VITALS_DONE').sort((a, b) => order(a) - order(b));
  const current = all.filter((v) => v.status === 'IN_CONSULTATION').sort((a, b) => (b.calledAt || '').localeCompare(a.calledAt || ''));
  const done = all.filter((v) => ['COMPLETED', 'REFERRED_IP'].includes(v.status)).sort((a, b) => (b.consultation?.completedAt || b.at).localeCompare(a.consultation?.completedAt || a.at));
  const other = all.filter((v) => ['NO_SHOW', 'CANCELLED'].includes(v.status));
  return { all, waiting, current, done, other, total: all.length };
}
export function avgConsultMinutes(doctorId) {
  const xs = store.all('opVisits').filter((v) => v.doctorId === doctorId && v.consultation?.completedAt && v.consultation?.startedAt).slice(-40)
    .map((v) => (new Date(v.consultation.completedAt) - new Date(v.consultation.startedAt)) / 60000).filter((m) => m > 0 && m < 60);
  return xs.length ? Math.round(xs.reduce((t, m) => t + m, 0) / xs.length) : Number(cs().op.avgConsultMin) || 8;
}
export function opDaySummary(date = businessDate()) {
  const vs = visitsOn(date);
  const rec = store.all('hospitalReceipts').filter((r) => r.source === 'OP' && r.businessDate === date);
  return {
    visits: vs.filter((v) => v.status !== 'CANCELLED').length, waiting: vs.filter((v) => v.status === 'WAITING' || v.status === 'VITALS_DONE').length,
    inConsult: vs.filter((v) => v.status === 'IN_CONSULTATION').length, completed: vs.filter((v) => v.status === 'COMPLETED' || v.status === 'REFERRED_IP').length,
    newPatients: vs.filter((v) => v.visitType === 'NEW').length, emergency: vs.filter((v) => v.priority === 'EMERGENCY').length,
    collected: r2(rec.reduce((t, r) => t + (r.kind === 'REFUND' ? -r.amount : r.amount), 0)),
    due: r2(vs.reduce((t, v) => t + visitDue(v), 0))
  };
}

// ---------------- writes ----------------
function nextToken(doctorId, date) { return visitsOn(date).filter((v) => v.doctorId === doctorId).reduce((m, v) => Math.max(m, v.tokenNo), 0) + 1; }
function refreshBill(b) {
  if (['CANCELLED', 'REFUNDED', 'REFUND_PENDING', 'REFUND_APPROVED', 'DISCOUNT_PENDING'].includes(b.status)) { syncOpBillLab(b); return b; }
  const paid = netReceived(b.id); b.paid = paid;
  b.status = b.total <= 0 || paid >= b.total - 0.005 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
  syncOpBillLab(b);
  return b;
}
const svcLine = (s, qty = 1) => ({ serviceId: s.id, code: s.code, name: s.name, category: s.category, qty, rate: s.rate, labServiceId: s.labServiceId || null });
/** Lab tests on an OP bill go to the lab at once (on hold until the bill is paid). */
const sendToLab = (b, v, user) => createVisitForOpBill(b, { doctor: doctor(v.doctorId)?.name || '', opVisitId: v.id }, user);
function newBill(v, kind, lines, discountPct, user) {
  const p = priceServices(lines, discountPct);
  const id = store.nextId('opBills', `OB-${yearOf()}-`, 5);
  const b = store.insert('opBills', { id, visitId: v.id, patientId: v.patientId, kind, at: now(), businessDate: businessDate(), lines: p.lines, gross: p.gross, discountPct: p.discountPct, discount: p.discount,
    roundOff: p.roundOff, total: p.total, paid: 0, status: 'UNPAID', createdBy: user.id, requestId: null, cancelled: null });
  v.billIds.push(id);
  return b;
}
function applyDiscountRule(b, v, discountPct, reason, user) {
  if (!(Number(discountPct) > 0)) return;
  if (discountNeedsApproval(discountPct, user)) {
    const rq = createRequest({ type: 'DISCOUNT', source: 'OP', refType: 'OP_BILL', refId: b.id, patientId: v.patientId, pct: Number(discountPct), base: b.gross, amount: b.discount, reason }, user);
    b.status = 'DISCOUNT_PENDING'; b.requestId = rq.id;
  } else if (!String(reason || '').trim()) throw new Error('Give a reason for the discount.');
  else b.discountReason = reason.trim();
}
function collect(b, pay, user) {
  if (!pay || !(Number(pay.amount) > 0)) return null;
  const due = opBillDue(b);
  if (Number(pay.amount) > due + 0.005) throw new Error(`Amount is more than the balance due (₹${due}).`);
  const rec = addReceipt({ kind: 'PAYMENT', source: 'OP', refType: 'OP_BILL', refId: b.id, patientId: b.patientId, mode: pay.mode, amount: pay.amount, tendered: pay.tendered, reference: pay.reference || '' }, user);
  refreshBill(b);
  return rec;
}

export function createVisit({ patientId, doctorId, emergency = false, mlc = false, referredBy = '', complaint = '', discountPct = 0, discountReason = '', pay }, user) {
  if (!can('op.register', user)) throw new Error('You are not allowed to create OP visits.');
  const p = patient(patientId); if (!p) throw new Error('Select a registered patient.');
  const d = doctor(doctorId); if (!d || !d.active) throw new Error('Select a doctor.');
  const date = businessDate();
  const dup = visitsOn(date).find((v) => v.patientId === patientId && v.doctorId === doctorId && ['WAITING', 'VITALS_DONE', 'IN_CONSULTATION'].includes(v.status));
  if (dup) throw new Error(`${p.name} already has token ${dup.token} with ${d.name} today.`);
  const pol = visitPolicy(patientId, doctorId, emergency);
  const pct = Number(discountPct) || 0;
  if (pct < 0 || pct > 100) throw new Error('Discount must be between 0 and 100%.');
  return store.transaction(() => {
    const tokenNo = nextToken(doctorId, date);
    const id = store.nextId('opVisits', `OPV-${yearOf(date)}-`, 5);
    const v = store.insert('opVisits', { id, patientId, doctorId, departmentId: d.departmentId, businessDate: date, at: now(), tokenNo, token: `${department(d.departmentId).code}-${pad(tokenNo)}`,
      visitType: pol.visitType, priority: emergency ? 'EMERGENCY' : 'NORMAL', mlc: !!mlc, referredBy: referredBy.trim(), chiefComplaint: complaint.trim(), status: 'WAITING', skips: 0, calledAt: null,
      vitals: null, consultation: null, billIds: [], createdBy: user.id, cancel: null, admissionId: null });
    const b = newBill(v, 'CONSULTATION', [{ serviceId: null, code: 'CONSULT', name: `Consultation — ${d.name} (${label(pol.visitType)})`, category: 'CONSULTATION', qty: 1, rate: pol.fee }], pct, user);
    applyDiscountRule(b, v, pct, discountReason, user);
    refreshBill(b);
    if (b.status !== 'DISCOUNT_PENDING') collect(b, pay, user);
    if (emergency) notify({ type: 'OP_EMERGENCY', category: 'Emergency', severity: 'critical', title: `Emergency patient — ${v.token}`, message: `${p.name} (${p.age ?? ''}${p.gender}) waiting for ${d.name}. ${v.chiefComplaint}`, refType: 'OP_VISIT', refId: id, targetRoles: ['DOCTOR', 'NURSE'] });
    audit(user, 'OP_VISIT_CREATED', 'OP_VISIT', id, `${v.token} · ${p.uhid} · ${pol.visitType} · ₹${b.total}`);
    return { visit: v, bill: b };
  });
}

export function collectOpBill(billId, pay, user) {
  if (!can('op.bill', user)) throw new Error('You are not allowed to collect OP payments.');
  return store.transaction(() => { const b = store.get('opBills', billId); const r = collect(b, pay, user); if (!r) throw new Error('Enter the amount received.'); audit(user, 'OP_PAYMENT', 'OP_BILL', billId, `₹${r.amount} ${r.mode}`); return r; });
}

export function recordVitals(visitId, data, user) {
  if (!can('op.vitals', user) && !can('op.consult', user)) throw new Error('You are not allowed to record vitals.');
  const v = visit(visitId);
  if (!ACTIVE_STATES.includes(v.status)) throw new Error('Vitals can be recorded only for patients still in the queue.');
  const vit = { bp: String(data.bp || '').trim(), pulse: num(data.pulse), temp: num(data.temp), spo2: num(data.spo2), rr: num(data.rr), weight: num(data.weight), height: num(data.height), grbs: num(data.grbs) };
  if (vit.bp && !/^\d{2,3}\/\d{2,3}$/.test(vit.bp)) throw new Error('Enter BP as systolic/diastolic, e.g. 120/80.');
  if (!vit.bp && vit.pulse == null && vit.temp == null && vit.spo2 == null && vit.weight == null) throw new Error('Enter at least one vital sign.');
  if (vit.spo2 != null && (vit.spo2 < 50 || vit.spo2 > 100)) throw new Error('SpO₂ must be between 50 and 100.');
  if (vit.temp != null && (vit.temp < 90 || vit.temp > 110)) throw new Error('Temperature is in °F (90–110).');
  vit.bmi = bmi(vit.weight, vit.height);
  return store.transaction(() => { v.vitals = { ...vit, by: user.id, at: now() }; if (v.status === 'WAITING') v.status = 'VITALS_DONE'; audit(user, 'OP_VITALS', 'OP_VISIT', v.id, `${v.token} BP ${vit.bp || '—'}`); return v; });
}
const num = (x) => (x === '' || x == null || isNaN(Number(x)) ? null : Number(x));

export function callVisit(visitId, user) {
  if (!can('op.consult', user)) throw new Error('Only the doctor can call a patient in.');
  const v = visit(visitId);
  if (!['WAITING', 'VITALS_DONE'].includes(v.status)) throw new Error('This patient is not waiting.');
  return store.transaction(() => {
    Object.assign(v, { status: 'IN_CONSULTATION', calledAt: now() });
    v.consultation ||= { startedAt: now(), completedAt: null, complaints: v.chiefComplaint || '', history: '', examination: '', diagnosis: [], prescription: [], investigations: [], advice: '', followUpDate: '', doctorId: v.doctorId, addenda: [] };
    audit(user, 'OP_CALLED', 'OP_VISIT', v.id, v.token);
    return v;
  });
}
export function skipVisit(visitId, user) {
  if (!can('op.consult', user) && !can('op.register', user)) throw new Error('You are not allowed to change the queue.');
  const v = visit(visitId);
  return store.transaction(() => {
    v.skips = (v.skips || 0) + 1;
    if (v.skips > (Number(cs().op.maxSkips) || 2)) { v.status = 'NO_SHOW'; audit(user, 'OP_NO_SHOW', 'OP_VISIT', v.id, v.token); }
    else { if (v.status === 'IN_CONSULTATION') v.status = v.vitals ? 'VITALS_DONE' : 'WAITING'; audit(user, 'OP_SKIPPED', 'OP_VISIT', v.id, `${v.token} skip ${v.skips}`); }
    return v;
  });
}
export function backToQueue(visitId, user) {
  const v = visit(visitId);
  if (!can('op.consult', user) && !can('op.register', user)) throw new Error('Not allowed.');
  if (v.status !== 'NO_SHOW') throw new Error('Only a no-show can be put back in the queue.');
  return store.transaction(() => { Object.assign(v, { status: v.vitals ? 'VITALS_DONE' : 'WAITING', skips: 0 }); audit(user, 'OP_REQUEUED', 'OP_VISIT', v.id, v.token); return v; });
}

function cleanConsult(c) {
  return {
    complaints: String(c.complaints || '').trim(), history: String(c.history || '').trim(), examination: String(c.examination || '').trim(),
    diagnosis: (c.diagnosis || []).map((x) => String(x).trim()).filter(Boolean),
    prescription: (c.prescription || []).filter((r) => String(r.name || '').trim()).map((r) => ({ medicineId: r.medicineId || null, name: r.name.trim(), generic: r.generic || '', dose: r.dose || '', frequency: r.frequency || '',
      days: Number(r.days) || 0, timing: r.timing || '', route: r.route || 'Oral', qty: Number(r.qty) || 0, unit: r.unit || '', instructions: r.instructions || '' })),
    investigations: (c.investigations || []).map((i) => ({ serviceId: i.serviceId, code: service(i.serviceId)?.code || '', name: service(i.serviceId)?.name || i.name, status: i.status || 'ORDERED' })),
    advice: String(c.advice || '').trim(), followUpDate: c.followUpDate || ''
  };
}
export function saveConsultation(visitId, data, user) {
  if (!can('op.consult', user)) throw new Error('Only the doctor can write the case sheet.');
  const v = visit(visitId);
  if (v.status !== 'IN_CONSULTATION') throw new Error('Call the patient in before writing the case sheet.');
  return store.transaction(() => { Object.assign(v.consultation, cleanConsult(data)); v.consultation.savedAt = now(); return v; });
}
/** Complete the consultation. Ordered investigations become an unpaid OP services bill for the billing counter. */
export function completeVisit(visitId, data, user, { referToIp = false, referReason = '' } = {}) {
  if (!can('op.consult', user)) throw new Error('Only the doctor can complete a consultation.');
  const v = visit(visitId);
  if (v.status !== 'IN_CONSULTATION') throw new Error('This consultation is not in progress.');
  const c = cleanConsult(data);
  if (!c.diagnosis.length && !referToIp) throw new Error('Add at least one diagnosis (or provisional diagnosis).');
  for (const r of c.prescription) if (!r.dose || !r.frequency || !(r.days > 0)) throw new Error(`Complete dose, frequency and days for ${r.name}.`);
  return store.transaction(() => {
    Object.assign(v.consultation, c, { completedAt: now() });
    const already = new Set(visitBills(v).flatMap((b) => b.lines.map((l) => l.serviceId)).filter(Boolean));
    const toBill = c.investigations.filter((i) => !already.has(i.serviceId)).map((i) => service(i.serviceId)).filter(Boolean);
    if (toBill.length) sendToLab(newBill(v, 'SERVICES', toBill.map((s) => svcLine(s)), 0, user), v, user);
    v.status = referToIp ? 'REFERRED_IP' : 'COMPLETED';
    if (referToIp) v.referral = { reason: referReason.trim() || 'Admission advised', at: now(), by: user.id };
    audit(user, referToIp ? 'OP_REFERRED_IP' : 'OP_COMPLETED', 'OP_VISIT', v.id, `${v.token} · ${c.diagnosis.join('; ')}`);
    if (referToIp) notify({ type: 'OP_REFERRED_IP', category: 'Admission', severity: 'warning', title: `Admission advised — ${v.token}`, message: `${patient(v.patientId).name}: ${v.referral.reason}. Allot a bed and admit.`, refType: 'OP_VISIT', refId: v.id, targetRoles: ['RECEPTION', 'BILLING'] });
    return v;
  });
}
export function addAddendum(visitId, text, user) {
  if (!can('op.consult', user)) throw new Error('Only the doctor can add an addendum.');
  if (!String(text || '').trim()) throw new Error('Write the addendum.');
  const v = visit(visitId);
  return store.transaction(() => { v.consultation.addenda ||= []; v.consultation.addenda.push({ at: now(), by: user.id, text: text.trim() }); audit(user, 'OP_ADDENDUM', 'OP_VISIT', v.id, text.slice(0, 80)); return v; });
}

/** Extra OP services (dressing, ECG, injection…) billed on a separate bill for the same visit. */
export function addServicesBill(visitId, { items, discountPct = 0, discountReason = '', pay }, user) {
  if (!can('op.bill', user)) throw new Error('You are not allowed to bill OP services.');
  const v = visit(visitId);
  if (v.status === 'CANCELLED') throw new Error('This visit is cancelled.');
  const lines = items.filter((i) => i.serviceId && Number(i.qty) > 0).map((i) => svcLine(service(i.serviceId), Number(i.qty)));
  if (!lines.length) throw new Error('Add at least one service.');
  return store.transaction(() => {
    const b = newBill(v, 'SERVICES', lines, Number(discountPct) || 0, user);
    applyDiscountRule(b, v, discountPct, discountReason, user); refreshBill(b);
    if (b.status !== 'DISCOUNT_PENDING') collect(b, pay, user);
    sendToLab(b, v, user);
    audit(user, 'OP_SERVICES_BILLED', 'OP_BILL', b.id, `${lines.length} service(s) · ₹${b.total}`);
    return b;
  });
}

/** Cancel a visit. A paid fee is refunded: directly by an approver, otherwise through a Super Admin refund request. */
export function cancelVisit(visitId, reason, user) {
  if (!can('op.cancel', user)) throw new Error('You are not allowed to cancel visits.');
  if (!String(reason || '').trim()) throw new Error('Give a reason for cancelling.');
  const v = visit(visitId);
  if (!ACTIVE_STATES.includes(v.status) || v.status === 'IN_CONSULTATION') throw new Error('Only a waiting visit can be cancelled.');
  return store.transaction(() => {
    v.status = 'CANCELLED'; v.cancel = { at: now(), by: user.id, reason: reason.trim() };
    for (const b of visitBills(v)) {
      const paid = netReceived(b.id);
      if (b.status === 'DISCOUNT_PENDING') { const rq = pendingRequestFor(b.id); if (rq) Object.assign(rq, { status: 'REJECTED', decidedBy: user.id, decidedAt: now(), decisionNote: 'Visit cancelled' }); }
      if (paid > 0) {
        b.cancelled = v.cancel;
        if (can('hospital.approve', user)) { b.status = 'REFUND_APPROVED'; }
        else { const rq = createRequest({ type: 'REFUND', source: 'OP', refType: 'OP_BILL', refId: b.id, patientId: v.patientId, base: paid, amount: paid, reason: `Visit ${v.token} cancelled — ${reason.trim()}` }, user); b.status = 'REFUND_PENDING'; b.requestId = rq.id; }
      } else { b.status = 'CANCELLED'; b.cancelled = v.cancel; }
      syncOpBillLab(b);
    }
    audit(user, 'OP_VISIT_CANCELLED', 'OP_VISIT', v.id, `${v.token}: ${reason}`);
    return v;
  });
}
/** Pay out an approved refund from the cashier's own counter. */
export function payOpRefund(billId, mode, user) {
  if (!can('op.bill', user)) throw new Error('You are not allowed to pay refunds.');
  const b = store.get('opBills', billId);
  if (b.status !== 'REFUND_APPROVED') throw new Error('This refund is not approved yet.');
  return store.transaction(() => {
    const amt = netReceived(b.id);
    const orig = store.all('hospitalReceipts').find((r) => r.refId === b.id && r.kind === 'PAYMENT');
    addReceipt({ kind: 'REFUND', source: 'OP', refType: 'OP_BILL', refId: b.id, patientId: b.patientId, mode: mode || orig?.mode || 'CASH', amount: amt, note: 'Visit cancelled — fee refunded' }, user);
    b.status = 'REFUNDED'; b.paid = 0; syncOpBillLab(b);
    audit(user, 'OP_REFUND_PAID', 'OP_BILL', b.id, `₹${amt}`);
    return b;
  });
}

// ---------------- decisions (called from hospital approvals) ----------------
export function applyOpDecision(rq, approve, user) {
  const b = store.get('opBills', rq.refId); if (!b) return;
  if (rq.type === 'DISCOUNT') {
    if (!approve) { const p = priceServices(b.lines, 0); Object.assign(b, { discountPct: 0, discount: 0, roundOff: p.roundOff, total: p.total }); }
    b.status = 'UNPAID'; refreshBill(b);
  } else if (rq.type === 'REFUND') {
    b.status = approve ? 'REFUND_APPROVED' : 'PAID';
    refreshBill(b);
  }
}
export { discountLimit };
