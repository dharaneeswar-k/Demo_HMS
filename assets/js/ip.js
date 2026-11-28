// Inpatient (BRD module 03) — beds, admission, transfers, deposits, charges, ward medicine indents (pharmacy issue
// through the stock-movement ledger), insurance/TPA pre-authorisation, discharge clearances, final bill and settlement.
import { store } from './data-service.js';
import { can } from './auth.js';
import { audit, createMovement } from './services.js';
import { notify } from './notifications.js';
import { businessDate } from './pharmacy-calc.js';
import { PHARMACY, fefoBatches, medicineStock, medName, batchBalance } from './calculations.js';
import { r2 } from './pricing.js';
import { bedDayPlan, bedChargeLines, payerSplit } from './clinical-rules.js';
import { insertWardVisit, labTestsFor } from './labflow.js';
import { cs, doctor, service, labTestOf, ward, patient, bed, bedCategories, addReceipt, netReceived, receiptsFor, createRequest, discountNeedsApproval, yearOf, dayKey, hourOf, label } from './clinical.js';

const now = () => new Date().toISOString();
export const OPEN_STATES = ['ADMITTED', 'DISCHARGE_INITIATED', 'BILL_FINALISED'];
export const GROUPS = { ROOM: 'Room & bed', NURSING: 'Nursing care', DOCTOR: 'Doctor visits', PHARMACY: 'Pharmacy (ward indents)', INVESTIGATION: 'Investigations', PROCEDURE: 'Procedures & OT', SERVICE: 'Other services' };
export const GROUP_ORDER = Object.keys(GROUPS);

// ---------------- reads ----------------
export const admission = (id) => store.get('ipAdmissions', id);
export const openAdmissions = () => store.all('ipAdmissions').filter((a) => OPEN_STATES.includes(a.status));
export const staysOf = (admId) => store.all('ipStays').filter((s) => s.admissionId === admId).sort((a, b) => a.from.localeCompare(b.from));
export const currentStay = (admId) => staysOf(admId).find((s) => !s.to) || null;
export const currentBedId = (adm) => currentStay(adm.id)?.bedId || staysOf(adm.id).at(-1)?.bedId || null;
export const chargesOf = (admId) => store.all('ipCharges').filter((c) => c.admissionId === admId).sort((a, b) => a.at.localeCompare(b.at));
export const indentsOf = (admId) => store.all('ipIndents').filter((i) => i.admissionId === admId).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
export const finalBill = (adm) => (adm.finalBillId ? store.get('ipBills', adm.finalBillId) : null);
export const daysAdmitted = (adm) => Math.max(1, Math.round((new Date(dayKey(adm.discharge?.dischargedAt || now()) + 'T12:00:00') - new Date(dayKey(adm.admittedAt) + 'T12:00:00')) / 86400000) + 1);
export const patientAdmissions = (patientId) => store.all('ipAdmissions').filter((a) => a.patientId === patientId).sort((a, b) => b.admittedAt.localeCompare(a.admittedAt));
export const activeAdmissionOf = (patientId) => store.all('ipAdmissions').find((a) => a.patientId === patientId && OPEN_STATES.includes(a.status)) || null;

let bv = -1; let occ = null;
function occupancy() {
  if (bv === store.version && occ) return occ;
  bv = store.version; occ = {};
  const open = new Set(openAdmissions().map((a) => a.id));
  store.all('ipStays').forEach((s) => { if (!s.to && open.has(s.admissionId)) occ[s.bedId] = s.admissionId; });
  return occ;
}
export const bedAdmission = (bedId) => (occupancy()[bedId] ? admission(occupancy()[bedId]) : null);
export function bedStatus(b) {
  if (occupancy()[b.id]) return 'OCCUPIED';
  return { READY: 'AVAILABLE', CLEANING: 'CLEANING', BLOCKED: 'BLOCKED', RESERVED: 'RESERVED' }[b.state] || 'AVAILABLE';
}
export const availableBeds = (category) => store.all('beds').filter((b) => b.active && bedStatus(b) === 'AVAILABLE' && (!category || b.category === category));
export function bedSummary() {
  const beds = store.all('beds').filter((b) => b.active);
  const by = (s) => beds.filter((b) => bedStatus(b) === s).length;
  const occupied = by('OCCUPIED');
  return { total: beds.length, occupied, available: by('AVAILABLE'), cleaning: by('CLEANING'), blocked: by('BLOCKED'), reserved: by('RESERVED'), pct: beds.length ? Math.round(occupied / beds.length * 100) : 0 };
}

/** Bill lines: derived bed + nursing days, plus posted charges (indents, rounds, services), up to a time. */
export function billLines(adm, { upTo = now(), final = false } = {}) {
  const plan = bedDayPlan(staysOf(adm.id), upTo, { checkoutHour: Number(cs().ip.checkoutHour) || 12, final, dayKey, hourOf });
  const bedLines = bedChargeLines(plan, bedCategories()).map((l) => ({ ...l, nonPayable: false }));
  const ch = chargesOf(adm.id).filter((c) => !c.reversed && c.at <= upTo).map((c) => ({ group: c.group, description: c.description, qty: c.qty, rate: c.rate, amount: c.amount, nonPayable: !!c.nonPayable, at: c.at, chargeId: c.id }));
  return [...bedLines, ...ch];
}
export const groupTotals = (lines) => GROUP_ORDER.map((g) => ({ group: g, label: GROUPS[g], amount: r2(lines.filter((l) => l.group === g).reduce((t, l) => t + l.amount, 0)) })).filter((g) => g.amount !== 0);

/** The amount the payer has committed (approved pre-auth / corporate credit), or null for self-pay. */
export function payerApproved(adm) {
  const p = adm.payer;
  if (p.type === 'SELF' || !p.preAuth) return null;
  if (p.preAuth.stage === 'REJECTED' || p.preAuth.stage === 'PREAUTH_PENDING') return 0;
  return Number(p.preAuth.approved) || 0;
}
export function split(adm, net, nonPayable) {
  const appr = payerApproved(adm);
  return payerSplit({ net, nonPayable, approved: appr || 0, coPayPct: adm.payer.coPayPct, selfPay: appr == null });
}
/** Running financial position of an admission (live, or the final bill once made). */
export function ipPosition(adm) {
  const fb = finalBill(adm);
  if (fb && fb.status !== 'CANCELLED') {
    const sp = split(adm, fb.net, fb.nonPayable);
    const paid = netReceived(adm.id);
    return { lines: fb.lines, gross: fb.gross, discount: fb.discount, net: fb.net, nonPayable: fb.nonPayable, split: sp, paid, balance: r2(sp.patientPays - paid), final: true, low: false };
  }
  const lines = billLines(adm);
  const gross = r2(lines.reduce((t, l) => t + l.amount, 0));
  const nonPayable = r2(lines.filter((l) => l.nonPayable).reduce((t, l) => t + l.amount, 0));
  const sp = split(adm, gross, nonPayable);
  const paid = netReceived(adm.id);
  const balance = r2(sp.patientPays - paid);
  return { lines, gross, discount: 0, net: gross, nonPayable, split: sp, paid, balance, final: false, low: OPEN_STATES.includes(adm.status) && balance > (Number(cs().ip.lowDepositMargin) || 0) };
}
export function ipSummary() {
  const open = openAdmissions();
  const pos = open.map((a) => ({ a, p: ipPosition(a) }));
  return { admitted: open.length, discharging: open.filter((a) => a.status !== 'ADMITTED').length, low: pos.filter((x) => x.p.low).length,
    running: r2(pos.reduce((t, x) => t + x.p.net, 0)), deposits: r2(pos.reduce((t, x) => t + x.p.paid, 0)),
    pendingIndents: store.all('ipIndents').filter((i) => i.status === 'RAISED').length,
    admittedToday: store.all('ipAdmissions').filter((a) => a.businessDate === businessDate()).length,
    dischargedToday: store.all('ipAdmissions').filter((a) => a.discharge?.dischargedAt && businessDate(a.discharge.dischargedAt) === businessDate()).length };
}

// ---------------- helpers ----------------
function mustOpen(adm) { if (!adm) throw new Error('Admission not found.'); if (!OPEN_STATES.includes(adm.status)) throw new Error('This patient is already discharged.'); }
function mustNotFinal(adm) { const fb = finalBill(adm); if (fb && fb.status !== 'CANCELLED') throw new Error('The final bill is already made. Re-open it to change charges.'); }
function insertCharge(adm, c, user) {
  const id = store.nextId('ipCharges', 'IPC-', 6);
  return store.insert('ipCharges', { id, admissionId: adm.id, at: now(), businessDate: businessDate(), serviceId: null, nonPayable: false, source: 'MANUAL', refId: null, postedBy: user.id, reversed: null, ...c, amount: r2(c.qty * c.rate) });
}
function openStay(adm, bedId, reason, user) {
  const b = bed(bedId);
  return store.insert('ipStays', { id: store.nextId('ipStays', 'BST-', 5), admissionId: adm.id, bedId, category: b.category, from: now(), to: null, reason, by: user.id });
}

// ---------------- admission ----------------
export function admit({ patientId, doctorId, bedId, admissionType = 'PLANNED', opVisitId = null, diagnosis, attender = {}, mlc = false, payer = { type: 'SELF' }, deposit }, user) {
  if (!can('ip.admit', user)) throw new Error('You are not allowed to admit patients.');
  const p = patient(patientId); if (!p) throw new Error('Select a registered patient.');
  if (activeAdmissionOf(patientId)) throw new Error(`${p.name} is already admitted (${activeAdmissionOf(patientId).id}).`);
  const d = doctor(doctorId); if (!d) throw new Error('Select the consultant.');
  const b = bed(bedId); if (!b) throw new Error('Select a bed.');
  if (bedStatus(b) !== 'AVAILABLE' && bedStatus(b) !== 'RESERVED') throw new Error(`Bed ${b.code} is not available.`);
  if (!String(diagnosis || '').trim()) throw new Error('Enter the provisional diagnosis / reason for admission.');
  if (!String(attender.name || '').trim() || !/^[6-9]\d{9}$/.test(String(attender.phone || '').replace(/\D/g, '').slice(-10))) throw new Error('Enter the attender’s name and a valid 10-digit mobile number.');
  if (payer.type === 'INSURANCE' && (!payer.tpaId || !payer.insurer || !String(payer.policyNo || '').trim())) throw new Error('Enter the TPA, insurer and policy number.');
  if (payer.type === 'CORPORATE' && !payer.corporate) throw new Error('Select the corporate company.');
  const coPay = Number(payer.coPayPct) || 0; if (coPay < 0 || coPay > 100) throw new Error('Co-pay must be 0–100%.');
  return store.transaction(() => {
    const id = store.nextId('ipAdmissions', `IPA-${yearOf()}-`);
    const adm = store.insert('ipAdmissions', {
      id, patientId, admittedAt: now(), businessDate: businessDate(), admissionType, opVisitId, doctorId, departmentId: d.departmentId, provisionalDiagnosis: diagnosis.trim(), reason: diagnosis.trim(), mlc: !!mlc,
      attender: { name: attender.name.trim(), relation: attender.relation || '', phone: '+91 ' + String(attender.phone).replace(/\D/g, '').slice(-10) },
      payer: { type: payer.type, tpaId: payer.tpaId || null, insurer: payer.insurer || '', corporate: payer.corporate || '', policyNo: (payer.policyNo || '').trim(), memberId: (payer.memberId || '').trim(), coPayPct: coPay,
        preAuth: payer.type === 'SELF' ? null : payer.type === 'CORPORATE'
          ? { stage: 'APPROVED', requested: Number(payer.requested) || 0, approved: Number(payer.requested) || 0, refNo: payer.refNo || '', history: [{ at: now(), by: user.id, stage: 'APPROVED', amount: Number(payer.requested) || 0, refNo: payer.refNo || '', note: 'Corporate credit letter' }] }
          : { stage: 'PREAUTH_PENDING', requested: Number(payer.requested) || 0, approved: 0, refNo: '', history: [{ at: now(), by: user.id, stage: 'PREAUTH_PENDING', amount: Number(payer.requested) || 0, refNo: '', note: 'Pre-authorisation requested at admission' }] },
        claim: null },
      status: 'ADMITTED', notes: [], clearances: { pharmacy: null, nursing: null }, discharge: null, finalBillId: null, createdBy: user.id, expectedDischarge: ''
    });
    openStay(adm, bedId, 'Admission', user);
    if (b.state !== 'READY') Object.assign(b, { state: 'READY', note: '', updatedAt: now(), updatedBy: user.id });
    const adm1 = store.all('tariff').find((s) => s.code === 'ADM' && s.active);
    if (adm1) insertCharge(adm, { group: adm1.group, serviceId: adm1.id, description: adm1.name, qty: 1, rate: adm1.rate, nonPayable: adm1.nonPayable, source: 'ADMISSION' }, user);
    if (opVisitId) { const v = store.get('opVisits', opVisitId); if (v) { v.admissionId = id; if (v.status !== 'COMPLETED') v.status = 'REFERRED_IP'; } }
    if (deposit && Number(deposit.amount) > 0) addReceipt({ kind: 'DEPOSIT', source: 'IP', refType: 'IP_ADMISSION', refId: id, patientId, mode: deposit.mode, amount: deposit.amount, tendered: deposit.tendered, reference: deposit.reference || '', note: 'Advance at admission' }, user);
    notify({ type: 'IP_ADMITTED', category: 'Admission', severity: 'info', title: `New admission — ${b.code}`, message: `${p.name} admitted under ${d.name}: ${diagnosis.trim()}.`, refType: 'IP_ADMISSION', refId: id, targetRoles: ['NURSE', 'DOCTOR'] });
    audit(user, 'IP_ADMITTED', 'IP_ADMISSION', id, `${p.uhid} · bed ${b.code} · ${payer.type}`);
    return adm;
  });
}

export function transferBed(admId, bedId, reason, user) {
  if (!can('ip.transfer', user)) throw new Error('You are not allowed to transfer beds.');
  const adm = admission(admId); mustOpen(adm); mustNotFinal(adm);
  const b = bed(bedId); if (!b || !['AVAILABLE', 'RESERVED'].includes(bedStatus(b))) throw new Error('Choose an available bed.');
  if (!String(reason || '').trim()) throw new Error('Give the reason for the transfer.');
  return store.transaction(() => {
    const s = currentStay(adm.id); const from = bed(s.bedId);
    s.to = now();
    Object.assign(from, { state: 'CLEANING', note: '', updatedAt: now(), updatedBy: user.id });
    openStay(adm, bedId, `Transfer: ${reason.trim()}`, user);
    if (b.state !== 'READY') Object.assign(b, { state: 'READY', note: '' });
    audit(user, 'IP_BED_TRANSFER', 'IP_ADMISSION', adm.id, `${from.code} → ${b.code}: ${reason}`);
    return adm;
  });
}
export function setBedState(bedId, state, note, user) {
  if (!can('bed.manage', user)) throw new Error('You are not allowed to change bed status.');
  const b = bed(bedId);
  if (bedStatus(b) === 'OCCUPIED') throw new Error('This bed is occupied.');
  if (['BLOCKED', 'RESERVED'].includes(state) && !String(note || '').trim()) throw new Error('Add a note (why it is blocked / who it is reserved for).');
  return store.transaction(() => { Object.assign(b, { state, note: state === 'READY' || state === 'CLEANING' ? '' : note.trim(), updatedAt: now(), updatedBy: user.id }); audit(user, 'BED_' + state, 'BED', b.id, `${b.code} ${note || ''}`); return b; });
}

// ---------------- money ----------------
export function addDeposit(admId, pay, user) {
  if (!can('ip.deposit', user)) throw new Error('You are not allowed to take deposits.');
  const adm = admission(admId); mustOpen(adm);
  return store.transaction(() => { const r = addReceipt({ kind: 'DEPOSIT', source: 'IP', refType: 'IP_ADMISSION', refId: adm.id, patientId: adm.patientId, mode: pay.mode, amount: pay.amount, tendered: pay.tendered, reference: pay.reference || '', note: pay.note || 'Additional deposit' }, user); audit(user, 'IP_DEPOSIT', 'IP_ADMISSION', adm.id, `₹${r.amount} ${r.mode}`); return r; });
}
export function postCharge(admId, { serviceId, qty = 1, description, rate, group }, user) {
  if (!can('ip.charge', user)) throw new Error('You are not allowed to post charges.');
  const adm = admission(admId); mustOpen(adm); mustNotFinal(adm);
  qty = Number(qty); if (!(qty > 0)) throw new Error('Quantity must be more than zero.');
  const lt = serviceId && labTestOf(store.get('tariff', serviceId));
  if (lt) { if (!Number.isInteger(qty)) throw new Error('Lab tests are charged in whole numbers.'); return orderLabTests(admId, { serviceIds: Array(qty).fill(lt.id) }, user).charges[0]; }
  return store.transaction(() => {
    let c;
    if (serviceId) { const s = service(serviceId); c = insertCharge(adm, { group: s.group, serviceId: s.id, description: s.name, qty, rate: s.rate, nonPayable: s.nonPayable }, user); }
    else {
      if (!can('hospital.approve', user)) throw new Error('Only the Super Admin can post a charge outside the tariff.');
      if (!String(description || '').trim() || !(Number(rate) > 0)) throw new Error('Enter a description and rate.');
      c = insertCharge(adm, { group: group || 'SERVICE', description: description.trim(), qty, rate: r2(rate) }, user);
    }
    audit(user, 'IP_CHARGE_POSTED', 'IP_ADMISSION', adm.id, `${c.description} × ${qty} = ₹${c.amount}`);
    return c;
  });
}
export function reverseCharge(chargeId, reason, user) {
  if (!can('ip.charge', user)) throw new Error('You are not allowed to reverse charges.');
  const c = store.get('ipCharges', chargeId); const adm = admission(c.admissionId); mustOpen(adm); mustNotFinal(adm);
  if (['INDENT', 'INDENT_RETURN'].includes(c.source)) throw new Error('Medicine charges are corrected by a ward return, not reversed.');
  if (!String(reason || '').trim()) throw new Error('Give a reason.');
  const lo = c.source === 'LAB' && store.get('orders', c.refId);
  if (lo && !['READY', 'ON_HOLD', 'CANCELLED'].includes(lo.status)) throw new Error('The lab has already collected this sample, so the charge stays.');
  return store.transaction(() => { if (lo && lo.status !== 'CANCELLED') { lo.status = 'CANCELLED'; lo.notes = `Charge reversed: ${reason.trim()}`; } c.reversed = { by: user.id, at: now(), reason: reason.trim() }; audit(user, 'IP_CHARGE_REVERSED', 'IP_ADMISSION', adm.id, `${c.description}: ${reason}`); return c; });
}

/**
 * Ward lab order for an admitted patient (module 03 → lab). One SID for all the tests, bedside collection, no counter payment:
 * each test is posted to the IP bill (Investigations) at the Lab Test Master price and the order carries the charge id.
 */
export function orderLabTests(admId, { serviceIds, priority = 'ROUTINE', notes = '', doctor: orderedBy = '', sendToPatient = false }, user) {
  if (!can('lab.order.ip', user) && !can('ip.charge', user)) throw new Error('You cannot place ward lab orders.');
  const adm = admission(admId); mustOpen(adm); mustNotFinal(adm);
  const tests = labTestsFor(serviceIds || []);
  return store.transaction(() => {
    const b = bed(currentBedId(adm)); const w = b && ward(b.wardId);
    const { v, orders } = insertWardVisit({ patientId: adm.patientId, ipNo: adm.id, ward: w?.name || '', bed: b?.code || '', doctor: String(orderedBy || '').trim() || doctor(adm.doctorId)?.name || '', tests, priority, notes, sendToPatient, admissionId: adm.id }, user);
    const charges = orders.map((o) => {
      const t = store.all('tariff').find((x) => x.labServiceId === o.serviceId && x.active);
      const c = insertCharge(adm, { group: 'INVESTIGATION', serviceId: t?.id || null, description: o.name, qty: 1, rate: tests.find((s) => s.id === o.serviceId).price, source: 'LAB', refId: o.id }, user);
      o.ipCharge = { amount: c.amount, ipNo: adm.id, posted: true, chargeId: c.id };
      return c;
    });
    audit(user, 'IP_LAB_ORDERED', 'IP_ADMISSION', adm.id, `SID ${v.sid} · ${tests.map((t) => t.code).join(', ')} · ₹${r2(charges.reduce((s, c) => s + c.amount, 0))} posted`);
    return { visit: v, orders, charges };
  });
}

// ---------------- clinical notes ----------------
export function addNote(admId, { kind, text, vitals }, user) {
  const adm = admission(admId); mustOpen(adm);
  if (kind === 'ROUND' && !can('ip.round', user)) throw new Error('Only a doctor can record a round.');
  if (kind !== 'ROUND' && !can('ip.nursing', user) && !can('ip.round', user)) throw new Error('You are not allowed to add notes.');
  if (!String(text || '').trim() && !vitals) throw new Error('Write the note.');
  return store.transaction(() => {
    const n = { id: 'NTE-' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(), at: now(), kind, by: user.id, text: String(text || '').trim(), vitals: vitals || null };
    adm.notes.push(n);
    if (kind === 'ROUND' && !finalBill(adm)) {
      const d = store.all('doctors').find((x) => x.userId === user.id) || doctor(adm.doctorId);
      insertCharge(adm, { group: 'DOCTOR', description: `Consultant visit — ${d.name}`, qty: 1, rate: d.ipVisitFee, source: 'ROUND', refId: n.id }, user);
    }
    audit(user, 'IP_NOTE_' + kind, 'IP_ADMISSION', adm.id, n.text.slice(0, 80));
    return n;
  });
}

// ---------------- ward indents ----------------
export function raiseIndent(admId, { items, priority = 'ROUTINE', note = '' }, user) {
  if (!can('ip.indent.raise', user)) throw new Error('You are not allowed to raise indents.');
  const adm = admission(admId); mustOpen(adm); mustNotFinal(adm);
  if (adm.status !== 'ADMITTED' && adm.status !== 'DISCHARGE_INITIATED') throw new Error('Indents cannot be raised now.');
  const lines = items.filter((i) => i.medicineId && Number(i.qty) > 0);
  if (!lines.length) throw new Error('Add at least one medicine with a quantity.');
  if (lines.some((i) => !Number.isInteger(Number(i.qty)))) throw new Error('Quantities must be whole units.');
  return store.transaction(() => {
    const id = store.nextId('ipIndents', `IND-${yearOf()}-`);
    const ind = store.insert('ipIndents', { id, admissionId: adm.id, patientId: adm.patientId, bedId: currentBedId(adm), raisedAt: now(), raisedBy: user.id, priority, status: 'RAISED',
      items: lines.map((i) => ({ medicineId: i.medicineId, qty: Number(i.qty), issuedQty: 0, batches: [], returnedQty: 0 })), issuedAt: null, issuedBy: null, note: note.trim(), returns: [] });
    if (adm.clearances?.pharmacy) adm.clearances.pharmacy = null; // a new indent re-opens pharmacy clearance
    notify({ type: 'IP_INDENT_RAISED', category: 'Ward Indent', severity: priority === 'STAT' ? 'critical' : 'info', title: `${priority === 'STAT' ? 'STAT ' : ''}ward indent ${id}`,
      message: `${lines.length} item(s) for ${patient(adm.patientId).name} · bed ${bed(ind.bedId)?.code || ''}`, refType: 'IP_INDENT', refId: id, targetRoles: ['PHARMACY_STAFF'] });
    audit(user, 'IP_INDENT_RAISED', 'IP_INDENT', id, `${lines.length} item(s) ${priority}`);
    return ind;
  });
}
/** Issue an indent from pharmacy stock, FEFO. Short items are issued partially. Charges post at batch MRP. */
export function issueIndent(indentId, user) {
  if (!can('ip.indent.issue', user)) throw new Error('Only pharmacy staff can issue indents.');
  const ind = store.get('ipIndents', indentId);
  if (ind.status !== 'RAISED') throw new Error('This indent is already processed.');
  const adm = admission(ind.admissionId); mustOpen(adm); mustNotFinal(adm);
  return store.transaction(() => {
    let issuedAny = false;
    for (const it of ind.items) {
      let need = it.qty;
      for (const b of fefoBatches(it.medicineId, PHARMACY())) {
        if (need <= 0) break;
        const q = Math.min(need, batchBalance(b.id, PHARMACY())); if (q <= 0) continue;
        const mv = createMovement({ batchId: b.id, type: 'IP_ISSUE', qty: q, reference: ind.id, user, reason: `Ward indent ${ind.id}`, locationId: PHARMACY() });
        it.batches.push({ batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: q, mrp: b.mrp, gstPct: store.get('medicines', it.medicineId)?.gstPct ?? 12, movementId: mv.id });
        insertCharge(adm, { group: 'PHARMACY', description: `${medName(it.medicineId)} (${b.batchNo})`, qty: q, rate: b.mrp, source: 'INDENT', refId: ind.id, medicineId: it.medicineId, batchId: b.id,
          nonPayable: store.get('medicines', it.medicineId)?.category === 'Medical Consumables' }, user);
        need -= q; it.issuedQty += q; issuedAny = true;
      }
    }
    if (!issuedAny) throw new Error('None of these medicines are in pharmacy stock. Transfer stock from the store first.');
    ind.status = ind.items.every((i) => i.issuedQty >= i.qty) ? 'ISSUED' : 'PARTIAL';
    Object.assign(ind, { issuedAt: now(), issuedBy: user.id });
    audit(user, 'IP_INDENT_ISSUED', 'IP_INDENT', ind.id, ind.items.map((i) => `${medName(i.medicineId)} ${i.issuedQty}/${i.qty}`).join(', '));
    return ind;
  });
}
export function cancelIndent(indentId, reason, user) {
  if (!can('ip.indent.raise', user) && !can('ip.indent.issue', user)) throw new Error('Not allowed.');
  const ind = store.get('ipIndents', indentId);
  if (ind.status !== 'RAISED') throw new Error('Only a pending indent can be cancelled.');
  if (!String(reason || '').trim()) throw new Error('Give a reason.');
  return store.transaction(() => { Object.assign(ind, { status: 'CANCELLED', cancel: { by: user.id, at: now(), reason: reason.trim() } }); audit(user, 'IP_INDENT_CANCELLED', 'IP_INDENT', ind.id, reason); return ind; });
}
export const returnableQty = (ind, medicineId, batchId) => {
  const it = ind.items.find((i) => i.medicineId === medicineId); if (!it) return 0;
  const issued = it.batches.filter((b) => b.batchId === batchId).reduce((t, b) => t + b.qty, 0);
  const back = ind.returns.flatMap((r) => r.lines).filter((l) => l.medicineId === medicineId && l.batchId === batchId).reduce((t, l) => t + l.qty, 0);
  return issued - back;
};
/** Unused, unopened medicines returned from the ward: stock comes back (IP_RETURN) and the IP bill gets a credit line. */
export function returnFromWard(indentId, lines, reason, user) {
  if (!can('ip.indent.issue', user)) throw new Error('Pharmacy receives ward returns.');
  const ind = store.get('ipIndents', indentId); const adm = admission(ind.admissionId); mustOpen(adm); mustNotFinal(adm);
  const ls = lines.filter((l) => Number(l.qty) > 0);
  if (!ls.length) throw new Error('Enter the quantity returned.');
  for (const l of ls) if (Number(l.qty) > returnableQty(ind, l.medicineId, l.batchId)) throw new Error(`Return for ${medName(l.medicineId)} is more than was issued.`);
  return store.transaction(() => {
    const rt = { id: 'IRT-' + Date.now().toString(36).toUpperCase(), at: now(), by: user.id, reason: String(reason || 'Unused medicine returned').trim(), lines: [] };
    for (const l of ls) {
      const it = ind.items.find((i) => i.medicineId === l.medicineId); const ib = it.batches.find((b) => b.batchId === l.batchId);
      const mv = createMovement({ batchId: l.batchId, type: 'IP_RETURN', qty: Number(l.qty), reference: ind.id, user, reason: `Ward return against ${ind.id}`, locationId: PHARMACY() });
      rt.lines.push({ medicineId: l.medicineId, batchId: l.batchId, qty: Number(l.qty), mrp: ib.mrp, movementId: mv.id });
      it.returnedQty = (it.returnedQty || 0) + Number(l.qty);
      insertCharge(adm, { group: 'PHARMACY', description: `Return: ${medName(l.medicineId)} (${ib.batchNo})`, qty: -Number(l.qty), rate: ib.mrp, source: 'INDENT_RETURN', refId: ind.id, medicineId: l.medicineId, batchId: l.batchId,
        nonPayable: store.get('medicines', l.medicineId)?.category === 'Medical Consumables' }, user);
    }
    ind.returns.push(rt);
    audit(user, 'IP_WARD_RETURN', 'IP_INDENT', ind.id, rt.lines.map((l) => `${medName(l.medicineId)} ${l.qty}`).join(', '));
    return rt;
  });
}
export const stockFor = (medicineId) => medicineStock(medicineId).pharmacy;

// ---------------- insurance / TPA ----------------
export const PREAUTH_STAGES = ['PREAUTH_PENDING', 'APPROVED', 'ENHANCEMENT_PENDING', 'FINAL_APPROVED', 'REJECTED'];
export function updatePreAuth(admId, { stage, amount, refNo = '', note = '' }, user) {
  if (!can('ip.tpa', user)) throw new Error('You are not allowed to update insurance approvals.');
  const adm = admission(admId);
  if (adm.payer.type !== 'INSURANCE') throw new Error('This admission is not under insurance.');
  const pa = adm.payer.preAuth;
  if (!PREAUTH_STAGES.includes(stage)) throw new Error('Choose a stage.');
  amount = Number(amount) || 0;
  if (['APPROVED', 'FINAL_APPROVED', 'ENHANCEMENT_PENDING'].includes(stage) && !(amount > 0)) throw new Error('Enter the amount.');
  if (['APPROVED', 'FINAL_APPROVED'].includes(stage) && !String(refNo || pa.refNo || '').trim()) throw new Error('Enter the approval reference number.');
  if (stage === 'REJECTED' && !String(note).trim()) throw new Error('Note the reason the insurer gave.');
  return store.transaction(() => {
    pa.history.push({ at: now(), by: user.id, stage, amount, refNo: refNo || pa.refNo, note: String(note).trim() });
    pa.stage = stage; if (refNo) pa.refNo = refNo.trim();
    if (stage === 'PREAUTH_PENDING') pa.requested = amount || pa.requested;
    if (['APPROVED', 'FINAL_APPROVED'].includes(stage)) pa.approved = amount;
    if (stage === 'REJECTED') pa.approved = 0;
    refreshFinalBill(adm);
    audit(user, 'TPA_' + stage, 'IP_ADMISSION', adm.id, `₹${amount} ${refNo || ''} ${note}`.trim());
    return pa;
  });
}
export function updateClaim(admId, { status, amount, reference = '' }, user) {
  if (!can('ip.tpa', user)) throw new Error('You are not allowed to update claims.');
  const adm = admission(admId);
  if (!adm.finalBillId || adm.payer.type === 'SELF') throw new Error('No claim for this admission.');
  return store.transaction(() => {
    const fb = finalBill(adm); const sp = split(adm, fb.net, fb.nonPayable);
    adm.payer.claim ||= { status: 'NOT_SUBMITTED', submittedAt: null, amount: sp.payerPays, settledAmount: 0, settledAt: null, reference: '' };
    if (status === 'SUBMITTED') Object.assign(adm.payer.claim, { status, submittedAt: now(), amount: sp.payerPays });
    if (status === 'SETTLED') { if (!(Number(amount) > 0) || !String(reference).trim()) throw new Error('Enter the settled amount and the UTR / cheque reference.'); Object.assign(adm.payer.claim, { status, settledAt: now(), settledAmount: r2(amount), reference: reference.trim() }); }
    audit(user, 'CLAIM_' + status, 'IP_ADMISSION', adm.id, `${amount || ''} ${reference}`.trim());
    return adm.payer.claim;
  });
}

// ---------------- discharge ----------------
export function initiateDischarge(admId, { type = 'NORMAL', expectedAt = '', note = '' }, user) {
  if (!can('ip.discharge.initiate', user)) throw new Error('Only the treating doctor can initiate discharge.');
  const adm = admission(admId); mustOpen(adm);
  if (adm.status !== 'ADMITTED') throw new Error('Discharge is already in progress.');
  return store.transaction(() => {
    adm.status = 'DISCHARGE_INITIATED';
    adm.discharge = { initiatedAt: now(), initiatedBy: user.id, type, expectedAt: expectedAt ? new Date(expectedAt).toISOString() : '', note: note.trim(),
      summary: { status: 'DRAFT', finalDiagnosis: adm.provisionalDiagnosis, presentingComplaints: adm.reason, course: '', procedures: chargesOf(adm.id).filter((c) => c.group === 'PROCEDURE' && !c.reversed).map((c) => c.description).join('; '),
        investigations: chargesOf(adm.id).filter((c) => c.group === 'INVESTIGATION' && !c.reversed).map((c) => c.description).join(', '), condition: '', medicines: '', advice: '', followUpDate: '', finalisedBy: null, finalisedAt: null },
      dischargedAt: null, dischargedBy: null };
    notify({ type: 'IP_DISCHARGE_INITIATED', category: 'Discharge', severity: 'warning', title: `Discharge initiated — ${bed(currentBedId(adm))?.code || adm.id}`,
      message: `${patient(adm.patientId).name} (${label(type)}): pharmacy & nursing clearance and the final bill are pending.`, refType: 'IP_ADMISSION', refId: adm.id, targetRoles: ['BILLING', 'NURSE', 'PHARMACY_STAFF'] });
    audit(user, 'IP_DISCHARGE_INITIATED', 'IP_ADMISSION', adm.id, label(type));
    return adm;
  });
}
export function cancelDischarge(admId, reason, user) {
  if (!can('ip.discharge.initiate', user)) throw new Error('Only the doctor can cancel a discharge.');
  const adm = admission(admId);
  if (adm.status !== 'DISCHARGE_INITIATED') throw new Error('Discharge can be cancelled only before the final bill.');
  return store.transaction(() => { adm.status = 'ADMITTED'; adm.discharge.cancelled = { at: now(), by: user.id, reason }; adm.clearances = { pharmacy: null, nursing: null }; audit(user, 'IP_DISCHARGE_CANCELLED', 'IP_ADMISSION', adm.id, reason); return adm; });
}
export const pendingIndentsOf = (admId) => store.all('ipIndents').filter((i) => i.admissionId === admId && i.status === 'RAISED');
export function clearDept(admId, dept, note, user) {
  const perm = { pharmacy: 'ip.clear.pharmacy', nursing: 'ip.clear.nursing' }[dept];
  if (!can(perm, user)) throw new Error(`You cannot give ${dept} clearance.`);
  const adm = admission(admId);
  if (adm.status !== 'DISCHARGE_INITIATED') throw new Error('Clearance is given after the doctor initiates discharge.');
  if (dept === 'pharmacy' && pendingIndentsOf(admId).length) throw new Error('Issue or cancel the pending indents first.');
  return store.transaction(() => { adm.clearances[dept] = { by: user.id, at: now(), note: String(note || '').trim() }; audit(user, `IP_${dept.toUpperCase()}_CLEARANCE`, 'IP_ADMISSION', adm.id, note || ''); return adm; });
}
export function saveSummary(admId, data, finalise, user) {
  if (!can('ip.summary', user)) throw new Error('Only the doctor can write the discharge summary.');
  const adm = admission(admId);
  if (!adm.discharge) throw new Error('Initiate discharge first.');
  const s = adm.discharge.summary ||= {};
  if (s.status === 'FINAL') throw new Error('The summary is already finalised.');
  const fields = ['finalDiagnosis', 'presentingComplaints', 'course', 'procedures', 'investigations', 'condition', 'medicines', 'advice', 'followUpDate'];
  const d = Object.fromEntries(fields.map((f) => [f, String(data[f] ?? '').trim()]));
  if (finalise) for (const [f, l] of [['finalDiagnosis', 'final diagnosis'], ['course', 'course in hospital'], ['condition', 'condition at discharge'], ['advice', 'advice on discharge']]) if (!d[f]) throw new Error(`Enter the ${l}.`);
  return store.transaction(() => {
    Object.assign(s, d);
    if (finalise) Object.assign(s, { status: 'FINAL', finalisedBy: user.id, finalisedAt: now() }); else s.status = 'DRAFT';
    if (data.type) adm.discharge.type = data.type;
    audit(user, finalise ? 'IP_SUMMARY_FINALISED' : 'IP_SUMMARY_SAVED', 'IP_ADMISSION', adm.id, d.finalDiagnosis);
    return s;
  });
}
function refreshFinalBill(adm) {
  const fb = finalBill(adm); if (!fb || ['CANCELLED', 'SETTLED', 'DISCOUNT_PENDING'].includes(fb.status)) return;
  const sp = split(adm, fb.net, fb.nonPayable);
  fb.payer = { type: adm.payer.type, ...sp }; fb.patientPays = sp.patientPays;
  fb.status = adm.payer.type === 'INSURANCE' && !['FINAL_APPROVED', 'REJECTED'].includes(adm.payer.preAuth?.stage) ? 'AWAITING_TPA' : 'PENDING_SETTLEMENT';
}
/** Freeze the bill (bed days up to now, all charges) after pharmacy and nursing clearance. */
export function finaliseBill(admId, { discountPct = 0, reason = '' }, user) {
  if (!can('ip.bill.final', user)) throw new Error('You are not allowed to make the final bill.');
  const adm = admission(admId);
  if (adm.status !== 'DISCHARGE_INITIATED') throw new Error('The doctor has to initiate discharge first.');
  if (!adm.clearances.pharmacy || !adm.clearances.nursing) throw new Error('Pharmacy and nursing clearance are needed before the final bill.');
  const pct = Number(discountPct) || 0; if (pct < 0 || pct > 100) throw new Error('Discount must be 0–100%.');
  if (pct > 0 && !String(reason).trim()) throw new Error('Give a reason for the discount.');
  return store.transaction(() => {
    const upTo = now();
    const lines = billLines(adm, { upTo, final: true });
    const gross = r2(lines.reduce((t, l) => t + l.amount, 0));
    const discount = r2(gross * pct / 100); const before = r2(gross - discount); const net = Math.round(before);
    const nonPayable = r2(lines.filter((l) => l.nonPayable).reduce((t, l) => t + l.amount, 0));
    const id = store.nextId('ipBills', `IB-${yearOf()}-`);
    const fb = store.insert('ipBills', { id, admissionId: adm.id, patientId: adm.patientId, finalisedAt: upTo, finalisedBy: user.id, upTo, lines, gross, discountPct: pct, discount, discountReason: reason.trim(), roundOff: r2(net - before), net, nonPayable,
      payer: null, patientPays: 0, paidBefore: netReceived(adm.id), status: 'PENDING_SETTLEMENT', settledAt: null, settledBy: null, requestId: null });
    adm.finalBillId = id; adm.status = 'BILL_FINALISED';
    refreshFinalBill(adm);
    if (pct > 0 && discountNeedsApproval(pct, user)) {
      const rq = createRequest({ type: 'DISCOUNT', source: 'IP', refType: 'IP_BILL', refId: id, patientId: adm.patientId, pct, base: gross, amount: discount, reason }, user);
      fb.status = 'DISCOUNT_PENDING'; fb.requestId = rq.id;
    }
    audit(user, 'IP_FINAL_BILL', 'IP_BILL', id, `Net ₹${net} · discount ${pct}%`);
    return fb;
  });
}
export function reopenBill(admId, reason, user) {
  if (!can('hospital.approve', user)) throw new Error('Only the Super Admin can re-open a final bill.');
  const adm = admission(admId); const fb = finalBill(adm);
  if (!fb || fb.status === 'SETTLED') throw new Error('A settled bill cannot be re-opened.');
  if (!String(reason || '').trim()) throw new Error('Give a reason.');
  return store.transaction(() => { fb.status = 'CANCELLED'; fb.cancel = { by: user.id, at: now(), reason: reason.trim() }; adm.finalBillId = null; adm.status = 'DISCHARGE_INITIATED'; audit(user, 'IP_BILL_REOPENED', 'IP_BILL', fb.id, reason); return adm; });
}
/** Collect the patient's balance, or refund excess deposit. Bill becomes SETTLED when nothing is left. */
export function settleBill(admId, pay, user) {
  if (!can('ip.bill.final', user)) throw new Error('You are not allowed to settle bills.');
  const adm = admission(admId); const fb = finalBill(adm);
  if (!fb) throw new Error('Make the final bill first.');
  if (fb.status === 'DISCOUNT_PENDING') throw new Error('Waiting for the Super Admin to decide the discount.');
  if (fb.status === 'AWAITING_TPA') throw new Error('Enter the TPA final approval (Insurance / TPA) before settling the patient share.');
  if (fb.status === 'SETTLED') throw new Error('Already settled.');
  return store.transaction(() => {
    const pos = ipPosition(adm);
    if (pos.balance > 0.005) addReceipt({ kind: 'PAYMENT', source: 'IP', refType: 'IP_ADMISSION', refId: adm.id, patientId: adm.patientId, mode: pay.mode, amount: pos.balance, tendered: pay.tendered, reference: pay.reference || '', note: `Final settlement ${fb.id}` }, user);
    else if (pos.balance < -0.005) addReceipt({ kind: 'REFUND', source: 'IP', refType: 'IP_ADMISSION', refId: adm.id, patientId: adm.patientId, mode: pay.mode, amount: -pos.balance, reference: pay.reference || '', note: `Excess deposit refunded on ${fb.id}` }, user);
    Object.assign(fb, { status: 'SETTLED', settledAt: now(), settledBy: user.id });
    if (adm.payer.type !== 'SELF') adm.payer.claim ||= { status: 'NOT_SUBMITTED', submittedAt: null, amount: fb.payer.payerPays, settledAmount: 0, settledAt: null, reference: '' };
    audit(user, 'IP_BILL_SETTLED', 'IP_BILL', fb.id, `${pos.balance >= 0 ? 'collected' : 'refunded'} ₹${Math.abs(pos.balance)}`);
    return fb;
  });
}
export function dischargeChecklist(adm) {
  const fb = finalBill(adm);
  return [
    { key: 'initiated', label: 'Discharge initiated by doctor', done: !!adm.discharge, by: adm.discharge?.initiatedBy, at: adm.discharge?.initiatedAt },
    { key: 'pharmacy', label: 'Pharmacy clearance', done: !!adm.clearances?.pharmacy, by: adm.clearances?.pharmacy?.by, at: adm.clearances?.pharmacy?.at, note: adm.clearances?.pharmacy?.note },
    { key: 'nursing', label: 'Nursing clearance', done: !!adm.clearances?.nursing, by: adm.clearances?.nursing?.by, at: adm.clearances?.nursing?.at, note: adm.clearances?.nursing?.note },
    { key: 'summary', label: 'Discharge summary finalised', done: adm.discharge?.summary?.status === 'FINAL', by: adm.discharge?.summary?.finalisedBy, at: adm.discharge?.summary?.finalisedAt },
    { key: 'billing', label: 'Final bill settled', done: fb?.status === 'SETTLED', by: fb?.settledBy, at: fb?.settledAt }
  ];
}
export function completeDischarge(admId, user) {
  if (!can('ip.bill.final', user) && !can('ip.admit', user)) throw new Error('You are not allowed to discharge patients.');
  const adm = admission(admId);
  const pending = dischargeChecklist(adm).filter((c) => !c.done);
  if (pending.length) throw new Error('Still pending: ' + pending.map((c) => c.label.toLowerCase()).join(', ') + '.');
  return store.transaction(() => {
    const s = currentStay(adm.id); if (s) s.to = now();
    const b = bed(s?.bedId); if (b) Object.assign(b, { state: 'CLEANING', note: '', updatedAt: now(), updatedBy: user.id });
    adm.status = 'DISCHARGED'; Object.assign(adm.discharge, { dischargedAt: now(), dischargedBy: user.id });
    notify({ type: 'IP_DISCHARGED', category: 'Discharge', severity: 'success', title: `Discharged — bed ${b?.code || ''} needs cleaning`, message: `${patient(adm.patientId).name} discharged. Mark the bed ready after housekeeping.`, refType: 'IP_ADMISSION', refId: adm.id, targetRoles: ['NURSE'] });
    audit(user, 'IP_DISCHARGED', 'IP_ADMISSION', adm.id, adm.finalBillId);
    return adm;
  });
}

// ---------------- decisions (called from hospital approvals) ----------------
export function applyIpDecision(rq, approve) {
  const fb = store.get('ipBills', rq.refId); if (!fb) return;
  const adm = admission(fb.admissionId);
  if (!approve) { const before = fb.gross; fb.net = Math.round(before); Object.assign(fb, { discountPct: 0, discount: 0, roundOff: r2(fb.net - before) }); }
  fb.status = 'PENDING_SETTLEMENT';
  refreshFinalBill(adm);
}
export const depositReceipts = (admId) => receiptsFor(admId);
