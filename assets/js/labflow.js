// Hospital lab flow (BRD 06) — one pipeline, many entry points.
//
//   Entry  : OP doctor order · IP ward order · Emergency · Outside referral (prescription) · Self request · Package
//   Visit  : one SID per visit / episode, priority Routine / Urgent / STAT, tests grouped into tubes by container
//   Gate   : counter payment, IP account, emergency credit or package — nothing is collected before it clears
//   Collect: OPD token queue · ward bedside list · casualty — barcode label per tube, scan to confirm
//   Lab    : receive tube (scan) → accept / reject & recollect → results with flags → verification
//   Report : one combined report per SID → WhatsApp / SMS / email / counter hand-over / IP record / referring doctor
import { store } from './data-service.js';
import { can } from './auth.js';
import { audit } from './services.js';
import { notify } from './notifications.js';
import { r2 } from './pricing.js';
import { businessDate } from './pharmacy-calc.js';
import { svc, billClears, hbillBalance, isCritical, hs, freshParams } from './hospital.js';
import { isConfidential, mayBePregnant, hasPregnancyBand } from './labrules.js';
import { useForTest, useTube, markRepeat } from './labstock.js';
import { fill, sendWhatsApp, logMessage, smsLink, mailLink, ms } from './messaging.js';

const now = () => new Date().toISOString();
export const SOURCE = {
  OP: { label: 'OP — hospital doctor', short: 'OP', icon: 'stethoscope', tone: 'info' },
  IP: { label: 'In-patient (ward)', short: 'IP', icon: 'bed-double', tone: 'purple' },
  EMERGENCY: { label: 'Emergency / casualty', short: 'Emergency', icon: 'siren', tone: 'danger' },
  REFERRAL: { label: 'Outside doctor (prescription)', short: 'Referral', icon: 'file-text', tone: 'warning' },
  SELF: { label: 'Self request (no prescription)', short: 'Self', icon: 'user-round', tone: 'neutral' },
  PACKAGE: { label: 'Health package', short: 'Package', icon: 'package', tone: 'success' }
};
export const PRIORITY = { STAT: { label: 'STAT', tone: 'danger', rank: 0 }, URGENT: { label: 'Urgent', tone: 'warning', rank: 1 }, ROUTINE: { label: 'Routine', tone: 'neutral', rank: 2 } };
export const VSTATUS = {
  ON_HOLD: ['Payment pending', 'warning'], WAITING: ['Waiting for sample', 'info'], COLLECTING: ['Partly collected', 'info'], IN_LAB: ['In the lab', 'purple'],
  PARTIAL: ['Partial report', 'warning'], READY: ['Report ready', 'success'], SENT: ['Report sent', 'success'], HANDED_OVER: ['Handed over', 'success'], CANCELLED: ['Cancelled', 'muted']
};
export const containers = () => hs().lab.containers;

export const visit = (id) => store.get('labVisits', id);
export const visitOrders = (v) => store.all('orders').filter((o) => o.labVisitId === v.id);
export const visitOfOrder = (o) => (o?.labVisitId ? visit(o.labVisitId) : null);
export const tubeOf = (code) => { for (const v of store.all('labVisits')) { const t = v.tubes.find((x) => x.code.toLowerCase() === String(code).trim().toLowerCase()); if (t) return { v, t }; } return null; };
export const findBySid = (sid) => store.all('labVisits').find((v) => v.sid === String(sid).trim());

/** Is the visit cleared for sample collection? */
export function visitAccess(v) {
  if (visitOrders(v).every((o) => o.status === 'CANCELLED')) return { ok: false, label: 'Cancelled', tone: 'muted' };
  if (v.billingRoute === 'IP_ACCOUNT') return { ok: true, label: 'IP account', tone: 'purple' };
  if (v.billingRoute === 'PACKAGE') return { ok: true, label: 'In package', tone: 'purple' };
  const b = v.billId && store.get('hbills', v.billId);
  if (!b) return { ok: false, label: 'Not billed', tone: 'danger' };
  if (b.credit?.status === 'EMERGENCY') return { ok: true, label: 'Emergency', tone: 'danger' };
  if (b.credit?.status === 'APPROVED' && hbillBalance(b) > 0) return { ok: true, label: 'Credit approved', tone: 'purple' };
  if (billClears(b)) return { ok: true, label: 'Paid', tone: 'success' };
  return { ok: false, label: b.credit?.status === 'PENDING' ? 'Credit awaiting owner' : 'Payment pending', tone: 'warning' };
}
export const reportReadyAt = (v) => { const os = visitOrders(v).filter((o) => o.status !== 'CANCELLED'); return os.length && os.every((o) => o.status === 'COMPLETED') ? os.map((o) => o.lab.verifiedAt).sort().at(-1) : null; };
export function visitStatus(v) {
  const os = visitOrders(v).filter((o) => o.status !== 'CANCELLED');
  if (!os.length) return 'CANCELLED';
  if (v.handover) return 'HANDED_OVER';
  if (reportReadyAt(v)) return v.deliveries.some((d) => ['WHATSAPP', 'EMAIL', 'SMS', 'WARD'].includes(d.channel) && !d.toDoctor) ? 'SENT' : 'READY';
  if (os.some((o) => o.status === 'COMPLETED')) return 'PARTIAL';
  if (!visitAccess(v).ok) return 'ON_HOLD';
  const live = v.tubes.filter((t) => t.orderIds.some((id) => store.get('orders', id)?.status !== 'CANCELLED'));
  if (live.every((t) => t.collectedAt)) return 'IN_LAB';
  return live.some((t) => t.collectedAt) ? 'COLLECTING' : 'WAITING';
}
export const isUncollected = (v) => { const r = reportReadyAt(v); return r && v.source !== 'IP' && !v.handover && (Date.now() - new Date(r)) / 86400000 > (hs().lab.reportCollectDays || 15); };
export const tubesFor = (v) => v.tubes.map((t) => ({ ...t, orders: t.orderIds.map((id) => store.get('orders', id)).filter(Boolean) }));
export const priorityRank = (v) => PRIORITY[v.priority]?.rank ?? 2;

// ---------------- creating visits ----------------
function nextSid() { const max = store.all('labVisits').reduce((m, v) => Math.max(m, +v.sid || 0), 4010000); return String(max + 1).padStart(8, '0'); }
function nextToken(day) { return store.all('labVisits').filter((v) => v.tokenDay === day && v.token).reduce((m, v) => Math.max(m, v.token), 0) + 1; }
function groupTubes(sid, orders) {
  const groups = {}; orders.forEach((o) => (groups[svc(o.serviceId).lab.container] ||= []).push(o));
  return Object.entries(groups).map(([c, os], k) => { const code = `${sid}-${k + 1}`; os.forEach((o) => { o.accession = code; o.lab.tube = code; }); return { code, container: c, orderIds: os.map((o) => o.id), collectedAt: null, collectedBy: null, receivedAt: null, receivedBy: null, rejected: null }; });
}
/** Validation for the lab part of a counter bill. */
export function validateLabRequest(lab, serviceIds) {
  const errs = [];
  const tests = serviceIds.map(svc).filter((s) => s?.category === 'LAB');
  if (!tests.length) return errs;
  if (lab.source === 'REFERRAL' && !lab.prescription) errs.push('Attach the outside prescription (photo, scan or the WhatsApp copy).');
  if (lab.source === 'REFERRAL' && !lab.referralDoctorId && !lab.doctor) errs.push('Choose the referring doctor.');
  if (lab.source === 'SELF') { const rx = tests.filter((t) => t.lab.rxRequired); if (rx.length) errs.push(`${rx.map((t) => t.name).join(', ')} cannot be done on a self request — a doctor's prescription is needed.`); }
  const cons = tests.filter((t) => t.lab.consentRequired);
  const c = lab.consent || {};
  if (cons.length && !(c.signed && c.preTest && String(c.counsellor || '').trim())) errs.push(`${cons.map((t) => t.name).join(', ')}: fill the consent form — counsellor's name, pre-test counselling done and the signed consent form received.`);
  return errs;
}
/** Called inside completeHospitalBill's transaction once the lab orders exist. */
export function createVisitForBill(bill, labOrders, lab, user) {
  if (!labOrders.length) return null;
  const sid = nextSid(); const at = bill.at;
  const source = bill.credit?.type === 'EMERGENCY' ? 'EMERGENCY' : labOrders.every((o) => o.coveredBy) ? 'PACKAGE' : lab.source || 'OP';
  const opd = source !== 'EMERGENCY'; const day = businessDate();
  const rd = lab.referralDoctorId && store.get('referralDoctors', lab.referralDoctorId);
  const doctor = rd ? `${rd.name}, ${rd.qualification}` : source === 'SELF' ? 'Self' : bill.doctor || '';
  labOrders.forEach((o) => { o.doctor = doctor; });
  const v = store.insert('labVisits', { id: store.nextId('labVisits', 'LV-', 5), sid, patientId: bill.patientId, source, priority: source === 'EMERGENCY' ? 'STAT' : lab.priority || 'ROUTINE', billId: bill.id,
    billingRoute: source === 'EMERGENCY' ? 'EMERGENCY' : source === 'PACKAGE' ? 'PACKAGE' : 'COUNTER', doctor, referralDoctorId: rd?.id || null,
    rxBasis: { OP: 'DOCTOR_ORDER', EMERGENCY: 'DOCTOR_ORDER', REFERRAL: 'OUTSIDE_PRESCRIPTION', SELF: 'SELF_REQUEST', PACKAGE: 'PACKAGE' }[source], prescription: lab.prescription || null, consent: lab.consent?.signed ? { at, by: user.id, counsellor: String(lab.consent.counsellor || '').trim(), preTest: !!lab.consent.preTest, signed: true } : null, pregnant: lab.pregnant ?? null,
    token: opd ? nextToken(day) : null, tokenDay: opd ? day : null, tokenStatus: 'WAITING', calledAt: null, collectionPoint: source === 'EMERGENCY' ? 'CASUALTY' : 'OPD', ipNo: null, ward: null, bed: null, clinicalNotes: lab.notes || '',
    createdAt: at, createdBy: user.id, reportDueAt: new Date(Math.max(...labOrders.map((o) => new Date(at).getTime() + svc(o.serviceId).lab.tatHours * 3600000))).toISOString(), tubes: [], deliveries: [], handover: null });
  labOrders.forEach((o) => { o.labVisitId = v.id; });
  v.tubes = groupTubes(sid, labOrders);
  audit(user, 'LAB_VISIT_CREATED', 'LABVISIT', v.id, `SID ${sid} · ${SOURCE[source].short} · ${labOrders.length} test(s)${v.token ? ' · token ' + v.token : ''}`);
  if (v.priority === 'STAT') notify({ type: 'STAT_LAB', category: 'Laboratory', severity: 'critical', title: `STAT lab request — SID ${sid}`, message: `${bill.patientName}: ${labOrders.map((o) => o.name).join(', ')}`, refType: 'LABVISIT', refId: v.id, targetRoles: ['LAB'] });
  return v;
}

/** IP ward order (until the IP module posts orders itself): no counter payment — charged to the IP account. */
export function createIpOrder({ recordId, serviceIds, doctor, priority = 'ROUTINE', notes = '', sendToPatient = false }, user) {
  if (!can('lab.order.ip', user)) throw new Error('You cannot place ward lab orders.');
  const rec = store.get('medicalRecords', recordId);
  if (!rec || rec.dischargedAt) throw new Error('Choose an admitted patient.');
  const tests = serviceIds.map(svc).filter((s) => s?.category === 'LAB');
  if (!tests.length) throw new Error('Select at least one test.');
  const off = tests.find((s) => !s.active); if (off) throw new Error(`${off.name} has been stopped in the master list.`);
  return store.transaction(() => {
    const at = now(); const sid = nextSid();
    const os = tests.map((s) => store.insert('orders', { id: store.nextId('orders', 'ORD-', 5), billId: null, itemId: null, patientId: rec.patientId, serviceId: s.id, category: 'LAB', name: s.name, doctor: doctor || rec.doctor,
      requestedBy: user.id, requestedAt: at, billedAt: at, status: 'READY', accession: null, performedBy: null, performedAt: null, notes, coveredBy: null, labVisitId: null,
      ipCharge: { amount: s.price, ipNo: rec.ipNo, posted: false },
      lab: { sampleType: s.lab.sample, collectedAt: null, collectedBy: null, receivedAt: null, receivedBy: null, rejected: null, results: [], enteredBy: null, enteredAt: null, verifiedBy: null, verifiedAt: null, reportNo: null, printedAt: null, printCount: 0 } }));
    const [ward, bed] = String(rec.ward || '').split(/\s*[—-]\s*Bed\s*/i);
    const v = store.insert('labVisits', { id: store.nextId('labVisits', 'LV-', 5), sid, patientId: rec.patientId, source: 'IP', priority, billId: null, billingRoute: 'IP_ACCOUNT', doctor: doctor || rec.doctor, referralDoctorId: null,
      rxBasis: 'DOCTOR_ORDER', prescription: null, consent: null, token: null, tokenDay: null, tokenStatus: 'WAITING', calledAt: null, collectionPoint: 'WARD', ipNo: rec.ipNo, ward: ward || rec.ward, bed: bed || '', recordId,
      clinicalNotes: notes, createdAt: at, createdBy: user.id, reportDueAt: new Date(Math.max(...tests.map((s) => Date.now() + s.lab.tatHours * 3600000))).toISOString(), tubes: [], deliveries: [], handover: null, sendToPatient: !!sendToPatient });
    os.forEach((o) => { o.labVisitId = v.id; });
    v.tubes = groupTubes(sid, os);
    audit(user, 'LAB_IP_ORDER', 'LABVISIT', v.id, `SID ${sid} · ${rec.ipNo} · ${tests.map((t) => t.code).join(', ')} · charged to IP account`);
    notify({ type: 'WARD_LAB', category: 'Laboratory', severity: priority === 'STAT' ? 'critical' : 'info', title: `${priority === 'STAT' ? 'STAT ' : ''}ward collection — ${v.ward} ${v.bed}`, message: `${store.get('patients', rec.patientId).name}: ${tests.map((t) => t.name).join(', ')}`, refType: 'LABVISIT', refId: v.id, targetRoles: ['LAB'] });
    return v;
  });
}

// ---------------- collection ----------------
const mustLab = (user) => { if (!can('lab.work', user)) throw new Error('Only lab staff can do this.'); };
// callNo: running order of calls, so the token screen always shows the latest call first (even if clocks or demo times disagree).
export function callToken(id, user) { mustLab(user); return store.transaction(() => { const v = visit(id); const last = Math.max(0, ...store.all('labVisits').map((x) => x.callNo || 0));
  v.tokenStatus = 'CALLED'; v.calledAt = now(); v.calledBy = user.id; v.callNo = last + 1; return v; }); }
export function collectTube(id, code, user) {
  mustLab(user);
  const v = visit(id); if (!visitAccess(v).ok) throw new Error('Payment is not cleared. Send the patient to the main counter.');
  const t = v.tubes.find((x) => x.code === code); if (!t) throw new Error('This label does not belong to this patient. Check the tube.');
  if (t.collectedAt) return v;
  return store.transaction(() => {
    const at = now(); Object.assign(t, { collectedAt: at, collectedBy: user.id });
    t.orderIds.map((oid) => store.get('orders', oid)).filter((o) => o && o.status === 'READY').forEach((o) => {
      Object.assign(o.lab, { collectedAt: at, collectedBy: user.id }); o.status = 'SAMPLE_COLLECTED';
      svc(o.serviceId).lab.kits.forEach((k) => useForTest(k.kitId, k.qty, o.id, user, svc(o.serviceId).code));
    });
    useTube(t.container, t.code, user);
    if (v.tubes.filter((x) => x.orderIds.some((oid) => store.get('orders', oid)?.status !== 'CANCELLED')).every((x) => x.collectedAt)) v.tokenStatus = 'DONE';
    audit(user, 'LAB_TUBE_COLLECTED', 'LABVISIT', v.id, `${code} (${containers()[t.container]?.label})`);
    return v;
  });
}
export function receiveTube(code, user) {
  mustLab(user);
  const f = tubeOf(code); if (!f) throw new Error(`No tube with label ${code}.`);
  if (!f.t.collectedAt) throw new Error('This tube has not been collected yet.');
  if (f.t.receivedAt) return f;
  return store.transaction(() => { const at = now(); Object.assign(f.t, { receivedAt: at, receivedBy: user.id }); f.t.orderIds.forEach((oid) => { const o = store.get('orders', oid); if (o) Object.assign(o.lab, { receivedAt: at, receivedBy: user.id }); }); audit(user, 'LAB_TUBE_RECEIVED', 'LABVISIT', f.v.id, code); return f; });
}
export function rejectTube(code, reason, user) {
  mustLab(user);
  if (!reason?.trim()) throw new Error('Give the reason for rejecting the sample.');
  const f = tubeOf(code); if (!f) throw new Error(`No tube with label ${code}.`);
  return store.transaction(() => {
    f.t.rejected = { at: now(), by: user.id, reason: reason.trim(), count: (f.t.rejected?.count || 0) + 1 };
    Object.assign(f.t, { collectedAt: null, collectedBy: null, receivedAt: null, receivedBy: null });
    f.t.orderIds.map((oid) => store.get('orders', oid)).filter((o) => o && ['SAMPLE_COLLECTED', 'RESULTED'].includes(o.status)).forEach((o) => {
      o.status = 'READY'; o.lab.rejected = f.t.rejected; Object.assign(o.lab, { collectedAt: null, collectedBy: null, receivedAt: null, receivedBy: null, results: [], enteredBy: null, enteredAt: null });
      markRepeat(o.id);
    });
    markRepeat(code);
    f.v.tokenStatus = f.v.collectionPoint === 'OPD' ? 'WAITING' : f.v.tokenStatus;
    audit(user, 'LAB_TUBE_REJECTED', 'LABVISIT', f.v.id, `${code}: ${reason}`);
    notify({ type: 'SAMPLE_REJECTED', category: 'Laboratory', severity: 'warning', title: `Recollect sample — SID ${f.v.sid}`, message: `${store.get('patients', f.v.patientId).name}: ${reason}. ${f.v.source === 'IP' ? 'Ward: ' + f.v.ward + ' ' + f.v.bed : 'Call the patient back.'}`, refType: 'LABVISIT', refId: f.v.id, targetRoles: f.v.source === 'IP' ? ['LAB', 'SERVICE_COUNTER'] : ['LAB', 'RECEPTION'] });
    return f;
  });
}

/** After every verification: when the whole SID is complete, route the report (IP → record, others → ready to send). */
export function onOrderVerified(o, user) {
  const v = visitOfOrder(o); if (!v || !reportReadyAt(v)) return;
  if (v.source === 'IP') v.deliveries.push({ channel: 'WARD', to: `${v.ward} ${v.bed}`.trim(), at: now(), by: user.id, status: 'POSTED_TO_IP_RECORD' });
  const p = store.get('patients', v.patientId);
  // Ward order marked "send to the patient's WhatsApp too": with the WhatsApp server on it goes out now; otherwise it waits in "Ready to send".
  let waNote = '';
  if (wardWaPending(v)) {
    if (ms().provider === 'WA_CLOUD' && ms().cloud?.enabled) { try { deliverReport(v.id, 'WHATSAPP', {}, user); waNote = ' Sent to the patient on WhatsApp.'; } catch { waNote = ' Send it to the patient on WhatsApp.'; } }
    else waNote = ' Send it to the patient on WhatsApp.';
  }
  notify({ type: 'LAB_REPORT_READY', category: 'Laboratory', severity: 'success', title: `Report ready — SID ${v.sid}`, message: `${p.name}: ${visitOrders(v).map((x) => x.name).join(', ')}. ${v.source === 'IP' ? 'Posted to the IP record.' + waNote : 'Send it on WhatsApp or hand it over at the counter.'}`, refType: 'LABVISIT', refId: v.id, targetRoles: v.source === 'IP' ? ['LAB'] : ['LAB', 'RECEPTION'] });
}

/** After a released report is amended (F3): IP → posted to the record again; everyone holding an old copy must get the new one. */
export function onReportAmended(o, no, user) {
  const v = visitOfOrder(o); if (!v) return;
  if (v.source === 'IP') v.deliveries.push({ channel: 'WARD', to: `${v.ward} ${v.bed}`.trim(), at: now(), by: user.id, status: 'POSTED_TO_IP_RECORD', amended: no });
  const old = staleDeliveries(v).filter((d) => d.channel !== 'WARD');
  const p = store.get('patients', v.patientId);
  notify({ type: 'LAB_REPORT_AMENDED', category: 'Laboratory', severity: 'warning', title: `Amended report — SID ${v.sid}`, message: `${p?.name}: ${o.name} corrected after release.${old.length ? ` Send the corrected report to ${old.length} earlier recipient(s).` : ''}`, refType: 'LABVISIT', refId: v.id, targetRoles: ['SUPER_ADMIN', 'LAB'] });
}

// ---------------- pregnancy (reference ranges, F6) ----------------
/** Record whether the patient is pregnant. Re-applies the range band to tests not verified yet. */
export function setPregnant(id, value, user) {
  if (!can('lab.work', user) && !can('hbill.create', user)) throw new Error('You cannot change this.');
  const v = visit(id); const val = value === true || value === false ? value : null;
  return store.transaction(() => {
    v.pregnant = val;
    visitOrders(v).filter((o) => o.lab && o.status !== 'COMPLETED' && o.lab.params).forEach((o) => { o.lab.params = freshParams(o); });
    audit(user, 'LAB_PREGNANCY_SET', 'LABVISIT', v.id, `${v.sid}: pregnant = ${val === true ? 'Yes' : val === false ? 'No' : 'Not known'}`);
    return v;
  });
}
/** Ask about pregnancy? Only women aged 12–55 with a test that has a pregnancy range. */
export const asksPregnancy = (v) => mayBePregnant(store.get('patients', v.patientId)) && hasPregnancyBand(visitOrders(v).filter((o) => o.status !== 'CANCELLED').map((o) => svc(o.serviceId)).filter(Boolean));

// ---------------- report delivery ----------------
/** A ward (IP) report the ward asked to send to the patient's WhatsApp too, not sent yet. */
export const wardWaPending = (v) => v.source === 'IP' && !!v.sendToPatient && !!reportReadyAt(v) && !visitConfidential(v) && !v.deliveries.some((d) => d.channel === 'WHATSAPP' && !d.toDoctor && d.at >= (lastAmendAt(v) || ''));
/** The SID has a test marked "Confidential" in the Test Master (e.g. HIV): hand over in person only (F4). */
export const visitConfidential = (v) => visitOrders(v).some((o) => o.status !== 'CANCELLED' && isConfidential(o));
/** Latest amendment time across the SID's tests (copies sent before it are out of date). */
export const lastAmendAt = (v) => visitOrders(v).map((o) => o.lab?.amendedAt).filter(Boolean).sort().at(-1) || null;
/** Deliveries made before the latest amendment — the people who hold an out-of-date copy. */
export const staleDeliveries = (v) => { const a = lastAmendAt(v); return a ? v.deliveries.filter((d) => d.at < a) : []; };
export function reportVars(v, { toDoctor = false } = {}) {
  const p = store.get('patients', v.patientId); const s = store.settings();
  const base = ms().publicReportBaseUrl; const link = base ? `View / download: ${base.replace(/\/$/, '')}/r/${v.sid}\n` : '';
  return { name: p.name, sid: v.sid, hospital: s.hospitalName, tests: visitOrders(v).filter((o) => o.status !== 'CANCELLED').map((o) => o.name).join(', '), link, days: hs().lab.reportCollectDays, phone: ms().senderPhone || store.ph().receipt.phone || '', doctor: v.doctor || '', toDoctor };
}
export function deliverReport(id, channel, { toDoctor = false } = {}, user) {
  if (!can('lab.deliver', user)) throw new Error('You cannot send reports.');
  const v = visit(id); if (!reportReadyAt(v)) throw new Error('The report is not complete yet.');
  if (visitConfidential(v)) throw new Error('This report has a confidential test. Hand it over in person after post-test counselling — it cannot be sent by WhatsApp, SMS or email.');
  const p = store.get('patients', v.patientId);
  const rd = v.referralDoctorId && store.get('referralDoctors', v.referralDoctorId);
  const to = toDoctor ? rd?.phone : channel === 'EMAIL' ? p.email : p.phone;
  if (!to) throw new Error(toDoctor ? 'No phone number for the referring doctor.' : channel === 'EMAIL' ? 'No email address on the patient record. Add it in the patient profile.' : 'No mobile number on the patient record.');
  const body = fill(ms().templates[toDoctor ? 'REPORT_READY_DOCTOR' : 'REPORT_READY'], reportVars(v));
  return store.transaction(() => {
    let out;
    if (channel === 'WHATSAPP') out = sendWhatsApp({ to, body, patientId: v.patientId, refType: 'LABVISIT', refId: v.id, template: toDoctor ? 'REPORT_READY_DOCTOR' : 'REPORT_READY', toDoctor }, user);
    else if (channel === 'SMS') { logMessage({ channel: 'SMS', to, patientId: v.patientId, refType: 'LABVISIT', refId: v.id, template: 'REPORT_READY', body, status: 'OPENED_SMS', toDoctor }, user); out = { url: smsLink(to, body) }; }
    else { logMessage({ channel: 'EMAIL', to, patientId: v.patientId, refType: 'LABVISIT', refId: v.id, template: 'REPORT_READY', body, status: 'OPENED_MAIL', toDoctor }, user); out = { url: mailLink(to, `Lab report ${v.sid} — ${store.settings().hospitalName}`, body + '\n\n(The PDF report is attached.)') }; }
    v.deliveries.push({ channel, to, at: now(), by: user.id, status: out.queued ? 'QUEUED_FOR_SERVER' : channel === 'WHATSAPP' ? 'SENT_VIA_LINK' : channel === 'SMS' ? 'OPENED_SMS' : 'OPENED_MAIL', toDoctor });
    return { ...out, body };
  });
}
export function handOver(id, { collectedBy, name, counselled = false, authorised = false }, user) {
  if (!can('lab.deliver', user)) throw new Error('You cannot hand over reports.');
  const v = visit(id); if (!reportReadyAt(v)) throw new Error('The report is not complete yet.');
  if (!name?.trim()) throw new Error('Enter who is collecting the report.');
  const b = v.billId && store.get('hbills', v.billId);
  if (hs().lab.payBeforeHandover && b && hbillBalance(b) > 0.005 && v.source !== 'EMERGENCY') throw new Error(`₹${hbillBalance(b)} is still due on bill ${b.id}. Collect it before handing over the report.`);
  const conf = visitConfidential(v);
  if (conf && !counselled) throw new Error('Confidential test: tick that post-test counselling was done before handing over.');
  if (conf && (collectedBy || 'Self') !== 'Self' && !authorised) throw new Error('Confidential test: only the patient, or a person with the patient’s written authorisation, may collect it.');
  return store.transaction(() => {
    v.handover = { at: now(), by: user.id, collectedBy: collectedBy || 'Self', name: name.trim(), printCount: 1, ...(conf ? { counselled: true, authorised: !!authorised } : {}) };
    v.deliveries.push({ channel: 'COUNTER', to: name.trim(), at: now(), by: user.id, status: 'HANDED_OVER' });
    audit(user, 'LAB_REPORT_HANDED_OVER', 'LABVISIT', v.id, `${v.sid} to ${name} (${collectedBy})`);
    return v;
  });
}

// ---------------- referral doctors ----------------
export function saveReferralDoctor(d, user) {
  if (!can('referral.manage', user) && !can('catalog.manage', user)) throw new Error('You cannot add referral doctors.');
  if (!d.name?.trim()) throw new Error('Enter the doctor’s name.');
  if (d.phone && !/^[6-9]\d{9}$/.test(String(d.phone).replace(/\D/g, '').slice(-10))) throw new Error('Enter a valid 10-digit mobile number.');
  return store.transaction(() => {
    const ph = d.phone ? '+91 ' + String(d.phone).replace(/\D/g, '').slice(-10).replace(/(\d{5})(\d{5})/, '$1 $2') : '';
    const r = d.id ? store.update('referralDoctors', d.id, { name: d.name.trim(), qualification: d.qualification || '', clinic: d.clinic || '', phone: ph, active: d.active !== false })
      : store.insert('referralDoctors', { id: store.nextId('referralDoctors', 'RD-'), name: d.name.trim().replace(/^(?!Dr\.?\s)/i, 'Dr. '), qualification: d.qualification || '', clinic: d.clinic || '', phone: ph, city: 'Hosur', active: true, addedAt: now() });
    audit(user, 'REFERRAL_DOCTOR_SAVED', 'REFERRAL', r.id, r.name);
    return r;
  });
}
export function referralStats(from, to) {
  return store.all('referralDoctors').map((rd) => { const vs = store.all('labVisits').filter((v) => v.referralDoctorId === rd.id && businessDate(v.createdAt) >= from && businessDate(v.createdAt) <= to);
    const value = r2(vs.reduce((t, v) => t + visitOrders(v).filter((o) => o.status !== 'CANCELLED').reduce((s, o) => s + (svc(o.serviceId)?.price || 0), 0), 0)); return { rd, visits: vs.length, tests: vs.reduce((t, v) => t + visitOrders(v).length, 0), value }; });
}
export const criticalInVisit = (v) => visitOrders(v).some(isCritical);
