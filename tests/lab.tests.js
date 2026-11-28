// Lab module — 100 automated acceptance tests that run inside the demo in the browser (no install, no build).
//
// How to run: open the demo, sign in (any user), open the browser console and type
//     await (await import('./tests/lab.tests.js')).runLabTests()
// or open  #/  and then  tests/run.html  (see tests/README.md).
// The run RESETS the demo data first (so every run starts from the same seed) and resets it again at the end.
// Each test calls the same functions the screens call (assets/js/*.js), so a passing run proves the business rules;
// a few tests (group L) also render the real screens and read the text on them.
//
// The test IDs (LT-001 …) are listed with their expected result in docs/LAB_MODULE_SPECIFICATION.md §33.1.
import { store, resetDemoData } from '../assets/js/data-service.js';
import * as A from '../assets/js/auth.js';
import * as H from '../assets/js/hospital.js';
import * as F from '../assets/js/labflow.js';
import * as R from '../assets/js/labrules.js';
import * as M from '../assets/js/labmaster.js';
import * as S from '../assets/js/labstock.js';
import { hospitalAlerts } from '../assets/js/alert-rules.js';
import { stageOf } from '../assets/js/modules/lab/stages.js';
import { patientHistory } from '../assets/js/patients.js';

// ---------------- tiny harness ----------------
const TESTS = [];
const T = (id, group, name, fn) => TESTS.push({ id, group, name, fn });
class Fail extends Error {}
const ok = (cond, msg = 'expected true') => { if (!cond) throw new Fail(msg); };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Fail(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const throws = (fn, re, msg = '') => { try { fn(); } catch (e) { if (e instanceof Fail) throw e; if (re && !re.test(e.message)) throw new Fail(`${msg} wrong error: ${e.message}`); return e; } throw new Fail(`${msg} expected an error, none thrown`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- helpers on top of the real lab functions ----------------
const U = (username) => store.all('users').find((u) => u.username === username);
const owner = () => U('owner'); const lab = () => U('lab'); const rec = () => U('reception');
const SV = (code) => store.all('services').find((s) => s.code === code);
const P = (name) => store.all('patients').find((p) => p.name === name);
const ordersOf = (v) => store.all('orders').filter((o) => o.labVisitId === v.id);
const order = (v, code) => ordersOf(v).find((o) => o.serviceId === SV(code).id);
const fresh = (o) => store.get('orders', o.id);
const lastAudit = (action) => store.all('audit').filter((a) => a.action === action).at(-1);
const setLab = (patch) => store.updateHs({ lab: { ...store.hs().lab, ...patch } });
const DOC = 'Dr. A. Ravichandran (General Medicine)';

/** Bill lab tests the way the billing screen does (owner bills: no shift needed) and return the new lab visit. */
function bill(patient, codes, labPatch = {}, { pay = true, credit = null } = {}) {
  const draft = { patientId: patient.id, doctor: DOC, lines: codes.map((c) => ({ serviceId: SV(c).id, qty: 1 })), discountPct: 0, discountRequestId: null, payMode: 'CASH',
    payments: [{ mode: 'CASH', amount: '', tendered: '', reference: '' }], credit: credit || { type: '', reason: '' }, remarks: '',
    lab: { source: 'OP', referralDoctorId: '', priority: 'ROUTINE', prescription: null, consent: { counsellor: '', preTest: false, signed: false }, pregnant: null, notes: '', ...labPatch } };
  const total = H.priceHospitalDraft(draft).grandTotal;
  if (pay) draft.payments = [{ mode: 'CASH', amount: total, tendered: total, reference: '' }];
  const b = H.completeHospitalBill(draft, owner());
  const v = store.all('labVisits').find((x) => x.billId === b.id);
  return { b, v };
}
const collectAll = (v) => F.visit(v.id).tubes.forEach((t) => F.collectTube(v.id, t.code, lab()));
const receiveAll = (v) => F.visit(v.id).tubes.forEach((t) => F.receiveTube(t.code, lab()));
/** Values for every parameter: normal by default, overridden by `vals`. */
const valuesFor = (o, vals = {}) => Object.fromEntries(H.labParams(fresh(o)).map((p) => [p.name, vals[p.name] ?? (p.ref !== undefined ? p.ref : String(Math.round(((Number(p.low) + Number(p.high)) / 2) * 10) / 10))]));
const enter = (o, vals = {}, user = lab(), reason = '') => H.enterResults(o.id, valuesFor(o, vals), user, reason);
/** Bill → collect → receive → enter, ready to verify. */
function ready(patient, code, vals = {}, labPatch = {}) { const { v, b } = bill(patient, [code], labPatch); collectAll(v); receiveAll(v); const o = order(v, code); enter(o, vals); return { v: F.visit(v.id), o: fresh(o), b }; }
const informed = (o) => H.logCriticalCall(o.id, { toName: DOC, outcome: 'INFORMED', readBack: true }, lab());
const done = (patient, code, vals = {}, labPatch = {}) => { const r = ready(patient, code, vals, labPatch); if (H.isCritical(r.o)) informed(r.o); H.verifyReport(r.o.id, owner()); return { v: F.visit(r.v.id), o: fresh(r.o), b: r.b }; };
async function view(hash, wait = 700) { location.hash = '#/home'; await sleep(150); location.hash = hash; await sleep(wait); return document.querySelector('main')?.innerText || ''; }

// =====================================================================================================
// A. Seed data and settings (8)
// =====================================================================================================
T('LT-001', 'Seed', 'Owner is an authorised signatory with qualification, Reg. No. and signature', () => {
  const o = owner(); ok(o.signatory === true); ok(o.qualification.includes('MD')); ok(/TNMC/.test(o.regNo)); ok(String(o.signature).startsWith('data:image/'));
});
T('LT-002', 'Seed', 'Lab technician is not a signatory but can do lab work', () => { ok(!R.canSign(lab())); ok(A.can('lab.work', lab())); eq(lab().qualification, 'DMLT'); });
T('LT-003', 'Seed', 'Lab compliance settings default on', () => {
  const l = store.hs().lab; ok(l.requireSecondPersonVerification); ok(l.signatoryOnly); ok(l.criticalCallRequired); eq(l.criticalEscalateMins, 15); eq(l.notifyWithinHours, 24); ok(l.establishmentRegNo);
});
T('LT-004', 'Seed', 'HIV is confidential, needs consent and a prescription', () => { const l = SV('HIV').lab; ok(l.confidential && l.consentRequired && l.rxRequired); });
T('LT-005', 'Seed', 'NS1 is notifiable (IDSP) and Sputum AFB is notifiable (TB)', () => { eq(SV('NS1').lab.notifiable, 'IDSP'); eq(SV('AFB').lab.notifiable, 'TB'); eq(SV('CBC').lab.notifiable, null); });
T('LT-006', 'Seed', 'Every lab test passes the Test Master validation', () => {
  M.labTests().forEach((t) => { const e = M.validateLabTest(M.normalise(M.toDraft(t)), t.id); eq(e, [], t.code); });
});
T('LT-007', 'Seed', 'No overlapping or broken range bands in any test', () => {
  M.labTests().forEach((t) => t.lab.parameters.forEach((p) => eq(R.bandProblems(p, p.name), [], `${t.code} ${p.name}`)));
});
T('LT-008', 'Seed', 'Showcase patients for each compliance rule exist', () => {
  ['Harini Suresh', 'Priyanka Ravi', 'Joseph Dominic', 'Geetha Venkat', 'Revathi Mohan', 'Prakash Natarajan', 'Lakshmi Devi'].forEach((n) => ok(store.all('labVisits').some((v) => store.get('patients', v.patientId)?.name === n), n));
  ok(store.all('orders').some((o) => o.lab?.amendments?.length), 'amended report'); ok(store.all('orders').some((o) => o.lab?.notification?.status === 'PENDING'), 'pending notification');
});

// =====================================================================================================
// B. Reference ranges by age / sex / pregnancy (13)
// =====================================================================================================
const hb = () => SV('CBC').lab.parameters.find((p) => p.name === 'Haemoglobin');
const rp = (param, sex, days, pregnant = null) => R.resolveParam(param, { sex, days, pregnant });
T('LT-009', 'Ranges', 'Child of 4 years gets the child Hb range 11–14', () => { const r = rp(hb(), 'F', 4 * 365); eq([r.low, r.high, r.rangeLabel], [11, 14, 'Child (1–12 y)']); });
T('LT-010', 'Ranges', 'Adult woman gets 12–15', () => { const r = rp(hb(), 'F', 30 * 365); eq([r.low, r.high, r.rangeLabel], [12, 15, 'Adult female']); });
T('LT-011', 'Ranges', 'Pregnant woman gets the pregnancy range 11–14', () => { const r = rp(hb(), 'F', 27 * 365, true); eq([r.low, r.high, r.rangeLabel], [11, 14, 'Pregnancy']); });
T('LT-012', 'Ranges', 'Adult man gets 13–17', () => { const r = rp(hb(), 'M', 40 * 365); eq([r.low, r.high], [13, 17]); });
T('LT-013', 'Ranges', 'Newborn (10 days) gets 14–22 with its own critical limits', () => { const r = rp(hb(), 'M', 10); eq([r.low, r.high, r.critLow, r.critHigh], [14, 22, 10, 24]); });
T('LT-014', 'Ranges', 'Infant (6 months) gets the infant range', () => { eq(rp(hb(), 'F', 180).rangeLabel, 'Infant (1–12 m)'); });
T('LT-015', 'Ranges', 'Band without critical limits keeps the default critical limits', () => { const r = rp(hb(), 'F', 30 * 365); eq([r.critLow, r.critHigh], [7, 20]); });
T('LT-016', 'Ranges', 'No matching band → default range', () => { const tsh = SV('THYROID').lab.parameters.find((p) => p.name === 'TSH'); const r = rp(tsh, 'M', 40 * 365); eq([r.low, r.high, r.rangeLabel], [0.27, 4.2, 'Default range']); });
T('LT-017', 'Ranges', 'Parameter without bands is unchanged', () => { const p = SV('LFT').lab.parameters[0]; const r = rp(p, 'M', 40 * 365); eq([r.low, r.high, r.rangeLabel], [p.low, p.high, undefined]); });
T('LT-018', 'Ranges', 'bandProblems catches overlap, low > high and bad critical limits', () => {
  const p = { name: 'X', ranges: [{ label: 'A', sex: 'ANY', ageFromDays: 0, ageToDays: 100, pregnant: null, low: 5, high: 3, critLow: null, critHigh: null }, { label: 'B', sex: 'ANY', ageFromDays: 50, ageToDays: 200, pregnant: null, low: 1, high: 2, critLow: 1.5, critHigh: null }] };
  const e = R.bandProblems(p, 'X').join(' | '); ok(/overlap/.test(e)); ok(/low is more than high/.test(e)); ok(/critical low must be below/.test(e));
});
T('LT-019', 'Ranges', 'Pregnancy is asked only for women of 12–55', () => {
  ok(R.mayBePregnant({ gender: 'F', age: 30 })); ok(!R.mayBePregnant({ gender: 'F', age: 60 })); ok(!R.mayBePregnant({ gender: 'M', age: 30 })); ok(!R.mayBePregnant({ gender: 'F', age: 8 }));
});
T('LT-020', 'Ranges', 'Pregnancy question only for tests with a pregnancy band', () => { ok(R.hasPregnancyBand([SV('CBC')])); ok(!R.hasPregnancyBand([SV('LFT')])); });
T('LT-021', 'Ranges', 'Same Hb 11.6 is normal for the child and Low for an adult woman', () => { eq(H.flagFor(rp(hb(), 'F', 4 * 365), '11.6'), ''); eq(H.flagFor(rp(hb(), 'F', 30 * 365), '11.6'), 'L'); });

// =====================================================================================================
// C. Billing and the lab request (11)
// =====================================================================================================
T('LT-022', 'Billing', 'OP bill for CBC creates a lab visit with SID, token, tube and a READY order', () => {
  const { v } = bill(P('Selvi Rajendran'), ['CBC']); ok(/^\d{8}$/.test(v.sid)); ok(v.token); ok(v.tubes.length === 1); eq(order(v, 'CBC').status, 'READY');
});
T('LT-023', 'Billing', 'Each lab order\'s accession is its tube label (SID-n), printed on the tube', () => { const { v } = bill(P('Selvi Rajendran'), ['FBS']); const o = order(v, 'FBS'); eq(o.accession, `${v.sid}-1`); eq(o.accession, v.tubes[0].code); });
T('LT-024', 'Billing', 'Tests on the same tube type share one tube (CBC + HbA1c → 1 EDTA tube)', () => { const { v } = bill(P('Selvi Rajendran'), ['CBC', 'HBA1C']); eq(v.tubes.length, 1); eq(v.tubes[0].orderIds.length, 2); });
T('LT-025', 'Billing', 'Different tube types get separate tubes (CBC + LFT → 2)', () => { const { v } = bill(P('Selvi Rajendran'), ['CBC', 'LFT']); eq(v.tubes.length, 2); });
T('LT-026', 'Billing', 'Self request for HIV is refused (prescription needed)', () => { throws(() => bill(P('Ramesh Babu'), ['HIV'], { source: 'SELF', consent: { counsellor: 'X', preTest: true, signed: true } }), /prescription is needed/); });
T('LT-027', 'Billing', 'Outside-doctor request without the prescription is refused', () => { throws(() => bill(P('Ramesh Babu'), ['CBC'], { source: 'REFERRAL', referralDoctorId: store.all('referralDoctors')[0].id }), /outside prescription/); });
T('LT-028', 'Billing', 'Outside-doctor request without the doctor is refused', () => { throws(() => bill(P('Ramesh Babu'), ['CBC'], { source: 'REFERRAL', prescription: { name: 'rx.jpg' } }), /referring doctor/); });
T('LT-029', 'Billing', 'HIV without the consent form is refused', () => { throws(() => bill(P('Ramesh Babu'), ['HIV']), /consent form/); });
T('LT-030', 'Billing', 'HIV with consent form is billed and the consent is stored with the counsellor', () => {
  const { v } = bill(P('Ramesh Babu'), ['HIV'], { consent: { counsellor: 'Sr. Jency Mary', preTest: true, signed: true } }); eq(v.consent.counsellor, 'Sr. Jency Mary'); ok(v.consent.preTest && v.consent.signed);
});
T('LT-031', 'Billing', 'Pregnancy answer is stored on the visit', () => { const { v } = bill(P('Shalini Kumar'), ['CBC'], { pregnant: true }); eq(v.pregnant, true); });
T('LT-032', 'Billing', 'Unpaid bill without credit / emergency is refused', () => { throws(() => bill(P('Ramesh Babu'), ['CBC'], {}, { pay: false }), /unpaid/); });

// =====================================================================================================
// D. Collection, receipt, rejection (11)
// =====================================================================================================
T('LT-033', 'Sample', 'Calling a token marks it CALLED', () => { const { v } = bill(P('Anitha Shankar'), ['CBC']); F.callToken(v.id, lab()); eq(F.visit(v.id).tokenStatus, 'CALLED'); });
T('LT-034', 'Sample', 'Collecting the tube moves its tests to SAMPLE_COLLECTED and audits it', () => {
  const { v } = bill(P('Anitha Shankar'), ['CBC']); collectAll(v); const o = order(v, 'CBC'); eq(fresh(o).status, 'SAMPLE_COLLECTED'); ok(fresh(o).lab.collectedAt); eq(lastAudit('LAB_TUBE_COLLECTED').entityId, v.id);
});
T('LT-035', 'Sample', 'A label from another patient is refused', () => { const { v } = bill(P('Anitha Shankar'), ['CBC']); throws(() => F.collectTube(v.id, 'XX-NOT-A-TUBE', lab()), /does not belong/); });
T('LT-036', 'Sample', 'Collecting the same tube twice changes nothing', () => { const { v } = bill(P('Anitha Shankar'), ['CBC']); collectAll(v); const at = F.visit(v.id).tubes[0].collectedAt; collectAll(v); eq(F.visit(v.id).tubes[0].collectedAt, at); });
T('LT-037', 'Sample', 'Receiving a tube that was not collected is refused', () => { const { v } = bill(P('Anitha Shankar'), ['CBC']); throws(() => F.receiveTube(v.tubes[0].code, lab()), /not been collected/); });
T('LT-038', 'Sample', 'Receiving sets the received time on the tests', () => { const { v } = bill(P('Anitha Shankar'), ['CBC']); collectAll(v); receiveAll(v); ok(fresh(order(v, 'CBC')).lab.receivedAt); });
T('LT-039', 'Sample', 'Results cannot be entered before the tube is received', () => { const { v } = bill(P('Anitha Shankar'), ['CBC']); collectAll(v); throws(() => enter(order(v, 'CBC')), /Receive the tube/); });
T('LT-040', 'Sample', 'Rejecting a sample needs a reason', () => { const { v } = bill(P('Anitha Shankar'), ['CBC']); collectAll(v); throws(() => F.rejectTube(v.tubes[0].code, ' ', lab()), /reason/); });
T('LT-041', 'Sample', 'Rejected sample sends the patient back to To collect with the reason kept', () => {
  const { v } = bill(P('Anitha Shankar'), ['CBC']); collectAll(v); receiveAll(v); F.rejectTube(v.tubes[0].code, 'Clotted sample', lab());
  const o = fresh(order(v, 'CBC')); eq(o.status, 'READY'); eq(o.lab.rejected.reason, 'Clotted sample'); eq(stageOf(F.visit(v.id)), 'collect');
});
T('LT-042', 'Sample', 'Collecting a test uses its kit from lab stock', () => {
  const kit = SV('CBC').lab.kits[0]; if (!kit) return; const before = S.labBalance(kit.kitId); const { v } = bill(P('Anitha Shankar'), ['CBC']); collectAll(v); ok(S.labBalance(kit.kitId) < before, 'balance went down');
});
T('LT-043', 'Sample', 'Ward (IP) order for an admitted patient creates a ward visit', () => {
  const v = F.createIpOrder({ recordId: 'MRD-0001', serviceIds: [SV('CBC').id], doctor: DOC, priority: 'STAT' }, owner()); eq(v.source, 'IP'); eq(v.priority, 'STAT');
  throws(() => F.createIpOrder({ recordId: 'MRD-0002', serviceIds: [SV('CBC').id], doctor: DOC }, owner()), /admitted/);
});

// =====================================================================================================
// E. Results, flags and corrections (12)
// =====================================================================================================
T('LT-044', 'Results', 'All parameters must be entered', () => { const { v } = bill(P('Fathima Begum'), ['LFT']); collectAll(v); receiveAll(v); throws(() => H.enterResults(order(v, 'LFT').id, { 'Total bilirubin': '1' }, lab()), /Enter all results/); });
T('LT-045', 'Results', 'Saving results sets RESULTED, who / when and freezes the range used', () => {
  const { o } = ready(P('Fathima Begum'), 'CBC'); eq(o.status, 'RESULTED'); eq(o.lab.enteredBy, lab().id); eq(o.lab.params.find((p) => p.name === 'Haemoglobin').rangeLabel, 'Adult female');
});
T('LT-046', 'Results', 'First entry is audited with the values', () => { const { o } = ready(P('Fathima Begum'), 'FBS'); const a = lastAudit('LAB_RESULTS_ENTERED'); eq(a.entityId, o.id); ok(/Fasting blood glucose 85/.test(a.details), a.details); });
T('LT-047', 'Results', 'Flags: H, L, HH, LL and * for text', () => {
  const p = { low: 10, high: 20, critLow: 5, critHigh: 30 }; eq([H.flagFor(p, '25'), H.flagFor(p, '8'), H.flagFor(p, '31'), H.flagFor(p, '4'), H.flagFor(p, '15')], ['H', 'L', 'HH', 'LL', '']);
  eq(H.flagFor({ ref: 'Negative' }, 'Positive'), 'A'); eq(H.flagFor({ ref: 'Negative' }, 'negative'), '');
});
T('LT-048', 'Results', 'Correcting a value without a reason is refused', () => { const { o } = ready(P('Fathima Begum'), 'FBS'); throws(() => enter(o, { 'Fasting blood glucose': '90' }), /reason/); });
T('LT-049', 'Results', 'Correction keeps old → new, who and why in the history and the audit', () => {
  const { o } = ready(P('Fathima Begum'), 'FBS'); enter(o, { 'Fasting blood glucose': '92' }, lab(), 'Typing mistake'); const h = fresh(o).lab.history;
  eq(h.length, 1); eq(h[0].changes, [{ param: 'Fasting blood glucose', from: '85', to: '92' }]); eq(h[0].reason, 'Typing mistake'); ok(/85 → 92/.test(lastAudit('LAB_RESULTS_CORRECTED').details));
});
T('LT-050', 'Results', 'Saving the same values again changes nothing', () => { const { o } = ready(P('Fathima Begum'), 'FBS'); const at = o.lab.enteredAt; enter(o); eq(fresh(o).lab.enteredAt, at); eq(fresh(o).lab.history, undefined); });
T('LT-051', 'Results', 'Critical value is detected and its text built', () => { const { o } = ready(P('Syed Imran'), 'RFT', { Potassium: '6.9' }); ok(H.isCritical(o)); eq(H.criticalText(o), ['Potassium 6.9 mmol/L (HH)']); });
T('LT-052', 'Results', 'Critical value sends a critical notification to the lab and owner', () => { const { o } = ready(P('Syed Imran'), 'RFT', { Potassium: '7.1' }); const n = store.all('notifications').filter((x) => x.type === 'CRITICAL_RESULT').at(-1); eq(n.refId, o.id); ok(n.targetRoles.includes('SUPER_ADMIN')); });
T('LT-053', 'Results', 'Saved results notify each signatory "Results to verify" (not the person who entered)', () => {
  const { v } = ready(P('Fathima Begum'), 'LIPID'); const n = store.all('notifications').filter((x) => x.type === 'LAB_TO_SIGN' && x.refId === v.id); eq(n.map((x) => x.assignedTo), [owner().id]); eq(n[0].status, 'OPEN');
});
T('LT-054', 'Results', 'Master changes after entry do not change the entered test (frozen format)', () => {
  const { o } = ready(P('Fathima Begum'), 'CRP'); const d = M.toDraft(SV('CRP')); d.parameters[0].high = '9'; M.saveLabTest(d, { id: SV('CRP').id, reason: 'test' }, owner());
  eq(H.labParams(fresh(o))[0].high, 6); eq(SV('CRP').lab.parameters[0].high, 9);
});
T('LT-055', 'Results', 'Reference text shows range and text values', () => { eq(H.refText({ low: 3.5, high: 5.1 }), '3.5 – 5.1'); eq(H.refText({ ref: 'Negative' }), 'Negative'); });

// =====================================================================================================
// F. Verification (13)
// =====================================================================================================
T('LT-056', 'Verify', 'Technician cannot verify (not a signatory)', () => { const { o } = ready(P('Kumaravel Pandian'), 'FBS'); eq(H.verifyBlock(o, lab()).code, 'NOT_SIGNATORY'); throws(() => H.verifyReport(o.id, lab()), /signatory/); });
T('LT-057', 'Verify', 'Signatory can verify results entered by someone else', () => { const { o } = ready(P('Kumaravel Pandian'), 'FBS'); eq(H.verifyBlock(o, owner()), null); });
T('LT-058', 'Verify', 'Second-person rule: the signatory cannot verify their own entry', () => {
  const { v } = bill(P('Kumaravel Pandian'), ['FBS']); collectAll(v); receiveAll(v); const o = order(v, 'FBS'); enter(o, {}, owner()); eq(H.verifyBlock(fresh(o), owner()).code, 'OWN_ENTRY');
});
T('LT-059', 'Verify', 'With the second-person rule off, own entry can be verified', () => {
  const { v } = bill(P('Kumaravel Pandian'), ['FBS']); collectAll(v); receiveAll(v); const o = order(v, 'FBS'); enter(o, {}, owner());
  setLab({ requireSecondPersonVerification: false }); try { eq(H.verifyBlock(fresh(o), owner()), null); } finally { setLab({ requireSecondPersonVerification: true }); }
});
T('LT-060', 'Verify', 'With "signatories only" off, any user with lab.verify can sign', () => { setLab({ signatoryOnly: false }); try { ok(R.canSign(lab())); } finally { setLab({ signatoryOnly: true }); } ok(!R.canSign(lab())); });
T('LT-061', 'Verify', 'Verify sets COMPLETED with a report number LR-YYYY-NNNNN and audits it', () => {
  const { o } = done(P('Kumaravel Pandian'), 'FBS'); eq(o.status, 'COMPLETED'); ok(new RegExp(`^LR-${new Date().getFullYear()}-\\d{5}$`).test(o.lab.reportNo), o.lab.reportNo); eq(o.lab.verifiedBy, owner().id); eq(lastAudit('LAB_REPORT_VERIFIED').entityId, o.id);
});
T('LT-062', 'Verify', 'Report numbers are unique and go up', () => { const a = done(P('Kumaravel Pandian'), 'FBS').o.lab.reportNo; const b = done(P('Kumaravel Pandian'), 'PPBS').o.lab.reportNo; ok(+b.split('-').pop() === +a.split('-').pop() + 1, `${a} ${b}`); });
T('LT-063', 'Verify', 'Verifying the last test closes the "Results to verify" notification', () => { const { v } = done(P('Kumaravel Pandian'), 'LIPID'); ok(store.all('notifications').filter((n) => n.type === 'LAB_TO_SIGN' && n.refId === v.id).every((n) => n.status === 'DONE')); });
T('LT-064', 'Verify', 'Report is ready only when every test of the SID is verified', () => {
  const { v } = bill(P('Kumaravel Pandian'), ['FBS', 'LFT']); collectAll(v); receiveAll(v); enter(order(v, 'FBS')); enter(order(v, 'LFT')); H.verifyReport(order(v, 'FBS').id, owner());
  ok(!F.reportReadyAt(F.visit(v.id))); H.verifyReport(order(v, 'LFT').id, owner()); ok(F.reportReadyAt(F.visit(v.id)));
});
T('LT-065', 'Verify', 'verifyState says what each user does next', () => {
  const { v } = ready(P('Kumaravel Pandian'), 'FBS'); eq(H.verifyState(v.id, owner()).next, 'SIGN'); eq(H.verifyState(v.id, lab()).next, 'WAIT_DOCTOR'); eq(H.verifyState(v.id, lab()).doctors.map((u) => u.id), [owner().id]);
});
T('LT-066', 'Verify', 'A test without results cannot be verified', () => { const { v } = bill(P('Kumaravel Pandian'), ['FBS']); eq(H.verifyBlock(order(v, 'FBS'), owner()).code, 'NOT_ENTERED'); });
T('LT-067', 'Verify', 'Verified test appears in the patient history', () => { const { o } = done(P('Kumaravel Pandian'), 'CRP'); ok(patientHistory(o.patientId).some((i) => i.ref === o.id)); });
T('LT-068', 'Verify', 'Report due time is set on the visit from the TAT', () => { const { v } = bill(P('Kumaravel Pandian'), ['CBC']); ok(v.reportDueAt || v.dueAt || F.visit(v.id).reportDueAt, 'due time'); });

// =====================================================================================================
// G. Critical value call log (9)
// =====================================================================================================
T('LT-069', 'Critical', 'Critical test cannot be verified before the call is logged', () => { const { o } = ready(P('Venkatesan Thangavel'), 'RFT', { Potassium: '6.8' }); eq(H.verifyBlock(o, owner()).code, 'CALL_NEEDED'); throws(() => H.verifyReport(o.id, owner()), /log the call/); });
T('LT-070', 'Critical', '"Informed" without read-back is refused', () => { const { o } = ready(P('Venkatesan Thangavel'), 'RFT', { Potassium: '6.8' }); throws(() => H.logCriticalCall(o.id, { toName: DOC, outcome: 'INFORMED', readBack: false }, lab()), /read the value back/); });
T('LT-071', 'Critical', '"Not reachable" is logged but verify stays blocked', () => {
  const { o } = ready(P('Venkatesan Thangavel'), 'RFT', { Potassium: '6.8' }); H.logCriticalCall(o.id, { toName: DOC, outcome: 'NOT_REACHABLE' }, lab()); eq(fresh(o).lab.criticalCalls.length, 1); ok(!H.criticalCallOk(fresh(o)));
});
T('LT-072', 'Critical', '"Informed" with read-back unblocks verify and is audited', () => { const { o } = ready(P('Venkatesan Thangavel'), 'RFT', { Potassium: '6.8' }); informed(o); ok(H.criticalCallOk(fresh(o))); eq(H.verifyBlock(fresh(o), owner()), null); ok(/read back/.test(lastAudit('LAB_CRITICAL_CALL').details)); });
T('LT-073', 'Critical', 'Correcting a normal value keeps the call valid', async () => {
  const { o } = ready(P('Venkatesan Thangavel'), 'RFT', { Potassium: '6.8' }); informed(o); await sleep(5); enter(fresh(o), { Potassium: '6.8', 'Uric acid': '6.1' }, lab(), 'typo'); ok(H.criticalCallOk(fresh(o)));
});
T('LT-074', 'Critical', 'Changing the critical value needs a new call', async () => {
  const { o } = ready(P('Venkatesan Thangavel'), 'RFT', { Potassium: '6.8' }); informed(o); await sleep(5); enter(fresh(o), { Potassium: '7.4' }, lab(), 'rerun'); ok(!H.criticalCallOk(fresh(o)));
});
T('LT-075', 'Critical', 'With the call rule off, critical tests verify without a call', () => {
  const { o } = ready(P('Venkatesan Thangavel'), 'RFT', { Potassium: '6.8' }); setLab({ criticalCallRequired: false }); try { eq(H.verifyBlock(o, owner()), null); } finally { setLab({ criticalCallRequired: true }); }
});
T('LT-076', 'Critical', 'A call cannot be logged for a test without a critical value', () => { const { o } = ready(P('Venkatesan Thangavel'), 'FBS'); throws(() => informed(o), /no critical value/); });
T('LT-077', 'Critical', 'Owner alert "Critical Not Informed" for the seeded patient waiting > 15 min', () => { ok(hospitalAlerts().some((a) => a.category === 'Critical Not Informed')); });

// =====================================================================================================
// H. Amended reports (9)
// =====================================================================================================
const amendable = () => done(P('Manjunath Hegde'), 'FBS');
T('LT-078', 'Amend', 'Technician cannot amend a released report', () => { const { o } = amendable(); throws(() => H.amendReport(o.id, valuesFor(o, { 'Fasting blood glucose': '99' }), 'x', lab()), /signatory/); });
T('LT-079', 'Amend', 'Only a released (verified) report can be amended', () => { const { o } = ready(P('Manjunath Hegde'), 'FBS'); throws(() => H.amendReport(o.id, valuesFor(o), 'x', owner()), /./); });
T('LT-080', 'Amend', 'Amendment needs a reason', () => { const { o } = amendable(); throws(() => H.amendReport(o.id, valuesFor(o, { 'Fasting blood glucose': '99' }), ' ', owner()), /reason/i); });
T('LT-081', 'Amend', 'Amendment needs at least one changed value', () => { const { o } = amendable(); throws(() => H.amendReport(o.id, valuesFor(o), 'nothing', owner()), /change/i); });
T('LT-082', 'Amend', 'Amendment keeps the old report, report no. and verified time', () => {
  const { o } = amendable(); const before = fresh(o).lab; H.amendReport(o.id, valuesFor(o, { 'Fasting blood glucose': '99' }), 'Wrong value typed', owner()); const l = fresh(o).lab;
  eq(l.amendments.length, 1); eq(l.amendments[0].prev.results.find((r) => r.param === 'Fasting blood glucose').value, '85'); eq(l.reportNo, before.reportNo); eq(l.verifiedAt, before.verifiedAt); ok(l.amendedAt); eq(lastAudit('LAB_REPORT_AMENDED').entityId, o.id);
});
T('LT-083', 'Amend', 'Second amendment is number 2 and points to the first as the previous version', () => {
  const { o } = amendable(); H.amendReport(o.id, valuesFor(o, { 'Fasting blood glucose': '99' }), 'one', owner()); H.amendReport(o.id, valuesFor(fresh(o), { 'Fasting blood glucose': '98' }), 'two', owner());
  const a = fresh(o).lab.amendments; eq(a.map((x) => x.no), [1, 2]); eq(a[1].prev.results.find((r) => r.param === 'Fasting blood glucose').value, '99');
});
T('LT-084', 'Amend', 'People who got the old report are listed for re-sending', () => {
  const { v, o } = amendable(); F.deliverReport(v.id, 'WHATSAPP', {}, owner()); eq(F.staleDeliveries(F.visit(v.id)).length, 0); H.amendReport(o.id, valuesFor(o, { 'Fasting blood glucose': '99' }), 'fix', owner()); eq(F.staleDeliveries(F.visit(v.id)).length, 1);
});
T('LT-085', 'Amend', 'Seeded amended report (Lakshmi Devi) has a stale WhatsApp copy', () => { const v = store.all('labVisits').find((x) => store.get('patients', x.patientId)?.name === 'Lakshmi Devi' && ordersOf(x).some((o) => o.lab?.amendments)); ok(F.staleDeliveries(v).length >= 1); ok(F.lastAmendAt(v)); });
T('LT-086', 'Amend', 'Amended ward (IP) report is re-posted to the ward', () => {
  const v = F.createIpOrder({ recordId: 'MRD-0001', serviceIds: [SV('FBS').id], doctor: DOC }, owner()); collectAll(v); receiveAll(v); const o = order(v, 'FBS'); enter(o); H.verifyReport(o.id, owner());
  H.amendReport(o.id, valuesFor(fresh(o), { 'Fasting blood glucose': '99' }), 'fix', owner()); ok(F.visit(v.id).deliveries.some((d) => d.channel === 'WARD' && d.amended === 1));
});

// =====================================================================================================
// I. Confidential tests (8)
// =====================================================================================================
const hivDone = () => done(P('Prakash Natarajan'), 'HIV', {}, { consent: { counsellor: 'Sr. Jency Mary', preTest: true, signed: true } });
T('LT-087', 'Confidential', 'HIV order is confidential; only lab roles may see it', () => { const { o } = hivDone(); ok(R.isConfidential(o)); ok(R.canSeeConfidential(lab())); ok(R.canSeeConfidential(owner())); ok(!R.canSeeConfidential(rec())); });
T('LT-088', 'Confidential', 'Confidential report cannot be sent on WhatsApp / SMS / email', () => { const { v } = hivDone(); ['WHATSAPP', 'SMS', 'EMAIL'].forEach((c) => throws(() => F.deliverReport(v.id, c, {}, owner()), /confidential/)); });
T('LT-089', 'Confidential', 'Hand-over needs post-test counselling', () => { const { v } = hivDone(); throws(() => F.handOver(v.id, { collectedBy: 'Self', name: 'Prakash Natarajan' }, owner()), /counselling/); });
T('LT-090', 'Confidential', 'Someone else collecting needs the patient\'s written authorisation', () => { const { v } = hivDone(); throws(() => F.handOver(v.id, { collectedBy: 'Attender / family', name: 'Brother', counselled: true }, owner()), /authorisation/); });
T('LT-091', 'Confidential', 'Patient in person after counselling: handed over and recorded', () => { const { v } = hivDone(); F.handOver(v.id, { collectedBy: 'Self', name: 'Prakash Natarajan', counselled: true }, owner()); ok(F.visit(v.id).handover.counselled); eq(F.visitStatus(F.visit(v.id)), 'HANDED_OVER'); });
T('LT-092', 'Confidential', 'Unticking "Confidential" in the Test Master makes HIV a normal test', () => {
  const id = SV('HIV').id; const d = M.toDraft(SV('HIV')); d.confidential = false; M.saveLabTest(d, { id, reason: 'hospital decision' }, owner());
  try { const { v, o } = hivDone(); ok(!R.isConfidential(o)); F.deliverReport(v.id, 'WHATSAPP', {}, owner()); ok(F.visit(v.id).deliveries.length === 1); }
  finally { const d2 = M.toDraft(SV('HIV')); d2.confidential = true; M.saveLabTest(d2, { id, reason: 'back' }, owner()); }
  ok(SV('HIV').lab.confidential);
});
T('LT-093', 'Confidential', 'Patient history hides the confidential test from reception', () => {
  const { o } = hivDone(); A.logout(); A.login('reception', 'demo123', false);
  try { const item = patientHistory(o.patientId).find((i) => i.kind === 'LAB' && i.at === o.lab.verifiedAt); eq(item.title, 'Lab report — confidential test'); eq(item.ref, null); } finally { A.logout(); A.login('owner', 'demo123', false); }
});
T('LT-094', 'Confidential', 'Report page is locked for reception and the refusal is audited', async () => {
  const { v } = hivDone(); A.logout(); A.login('reception', 'demo123', false);
  try { const t = await view(`#/lab/visit/${v.id}/report`); ok(/Confidential report/.test(t), t.slice(0, 120)); ok(!/Non-reactive/.test(t)); eq(lastAudit('LAB_REPORT_VIEW_REFUSED').entityId, v.id); } finally { A.logout(); A.login('owner', 'demo123', false); }
});

// =====================================================================================================
// J. Notifiable diseases (5)
// =====================================================================================================
T('LT-095', 'Notifiable', 'Positive AFB (TB) goes on the register, due in 24 h, audited', () => {
  const { o } = done(P('Geetha Venkat'), 'AFB', { 'Acid-fast bacilli (AFB)': 'Seen (2+)' }); const n = o.lab.notification; eq([n.program, n.status], ['TB', 'PENDING']);
  eq(Math.round((Date.parse(n.dueAt) - Date.parse(n.at)) / 3600000), 24); eq(lastAudit('NOTIFIABLE_POSITIVE').entityId, o.id);
});
T('LT-096', 'Notifiable', 'Negative dengue NS1 is not put on the register', () => { const { o } = done(P('Geetha Venkat'), 'NS1'); eq(o.lab.notification, undefined); });
T('LT-097', 'Notifiable', 'Marking reported needs the portal ID, then moves to Reported', () => {
  const { o } = done(P('Geetha Venkat'), 'NS1', { 'Dengue NS1 antigen': 'Positive' }); eq(o.lab.notification.program, 'IDSP'); throws(() => H.markNotified(o.id, { refNo: ' ' }, lab()), /ID/i);
  H.markNotified(o.id, { refNo: 'IHIP/TN/26/11/09999' }, lab()); const n = fresh(o).lab.notification; eq(n.status, 'NOTIFIED'); eq(n.notifiedBy, lab().id); eq(lastAudit('NOTIFIABLE_REPORTED').entityId, o.id);
});
T('LT-098', 'Notifiable', 'Past the deadline → "Notifiable Not Reported" alert', () => {
  const { o } = done(P('Geetha Venkat'), 'AFB', { 'Acid-fast bacilli (AFB)': 'Seen (1+)' }); fresh(o).lab.notification.dueAt = new Date(Date.now() - 60000).toISOString(); store.commit();
  ok(hospitalAlerts().some((a) => a.category === 'Notifiable Not Reported' && a.key === 'NNR-' + o.id));
});

// =====================================================================================================
// K. Pregnancy, Test Master and delivery (2)
// =====================================================================================================
T('LT-099', 'Master', 'Overlapping range in the Test Master is refused on save', () => {
  const d = M.toDraft(SV('CBC')); const hbRow = d.parameters.find((p) => p.name === 'Haemoglobin'); hbRow.ranges.push({ label: 'Clash', sex: 'F', ageFrom: '20', ageFromUnit: 'y', ageTo: '', ageToUnit: 'y', pregnant: '', low: '12', high: '15', critLow: '', critHigh: '' });
  throws(() => M.saveLabTest(d, { id: SV('CBC').id, reason: 'x' }, owner()), /overlap/);
});
T('LT-100', 'Report', 'Printed report shows AMENDED, Reg. Nos., signer and the range used', async () => {
  const v = store.all('labVisits').find((x) => store.get('patients', x.patientId)?.name === 'Lakshmi Devi' && ordersOf(x).some((o) => o.lab?.amendments));
  const t = await view(`#/lab/visit/${v.id}/report`);
  ['LABORATORY REPORT — AMENDED', 'Clinical Establishment Reg. No.', 'REG. NO. TNMC 61234', 'MBBS, MD (PATHOLOGY)', '(Adult female)', 'Reason: Wrong value typed'].forEach((s) => ok(t.includes(s), `missing "${s}"`));
});

// ---------------- runner ----------------
export async function runLabTests({ keepData = false } = {}) {
  const session = { s: sessionStorage.getItem('nallam_hms_session'), l: localStorage.getItem('nallam_hms_session') };
  await resetDemoData(); A.logout(); A.login('owner', 'demo123', false);
  const results = [];
  for (const t of TESTS) {
    const t0 = performance.now();
    try { await t.fn(); results.push({ id: t.id, group: t.group, name: t.name, pass: true, ms: Math.round(performance.now() - t0) }); }
    catch (e) { results.push({ id: t.id, group: t.group, name: t.name, pass: false, error: e instanceof Fail ? e.message : `${e.name}: ${e.message}` }); }
  }
  if (!keepData) await resetDemoData();
  A.logout(); if (session.s) sessionStorage.setItem('nallam_hms_session', session.s); if (session.l) localStorage.setItem('nallam_hms_session', session.l);
  const failed = results.filter((r) => !r.pass);
  const summary = { total: results.length, passed: results.length - failed.length, failed: failed.length };
  console.table(results.map(({ id, group, name, pass, error }) => ({ id, group, name, result: pass ? 'PASS' : 'FAIL', error: error || '' })));
  return { summary, failed, results };
}
export const testCount = () => TESTS.length;
