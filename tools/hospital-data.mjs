// Seed data for the hospital-side modules: Central Billing (08), Laboratory (06), Services (07),
// Packages (10), MRD (11), Shifts (12) and Workstations (14). All records are FICTIONAL.
// Uses its own random sequence so the pharmacy data in generate-data.mjs stays identical.

let s = 777123;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pad = (n, l = 4) => String(n).padStart(l, '0');
const r2 = (v) => Math.round(v * 100) / 100;
const ist = (day, hm) => new Date(`${day}T${hm}:00+05:30`).toISOString();
const addMin = (isoStr, m) => new Date(new Date(isoStr).getTime() + m * 60000).toISOString();

// ---------------- catalog ----------------
// Lab tests carry their report format (parameters + reference ranges) and kit usage per test.
// Lab stock items. Order matters: the first 12 are referenced by the tests below (K(1)…K(12)).
// [name, kind, unit, packLabel, packSize, storage, openDays, askAt, keepInLab, storeReorder, ₹/unit, supplier, tube]
const SUP_A = 'Hosur Diagnostics (Sysmex)', SUP_B = 'Krishna Scientific (Erba)', SUP_C = 'MedLine Agencies (Bio-Rad)', SUP_D = 'Sri Balaji Surgicals';
const KITS = [
  ['CBC reagent pack (haematology analyser)', 'REAGENT', 'test', 'pack', 500, 'ROOM', 30, 120, 500, 500, 6, SUP_A],
  ['LFT reagent kit (biochemistry)', 'REAGENT', 'test', 'kit', 100, 'COLD', 28, 40, 150, 200, 18, SUP_B],
  ['RFT reagent kit (biochemistry)', 'REAGENT', 'test', 'kit', 100, 'COLD', 28, 40, 150, 200, 15, SUP_B],
  ['Glucose reagent', 'REAGENT', 'test', 'kit', 200, 'COLD', 30, 80, 300, 400, 3, SUP_B],
  ['HbA1c cartridge', 'CARTRIDGE', 'cartridge', 'box', 25, 'COLD', null, 25, 70, 50, 210, SUP_C],
  ['Lipid profile reagent kit', 'REAGENT', 'test', 'kit', 100, 'COLD', 28, 30, 120, 200, 20, SUP_B],
  ['Thyroid (T3/T4/TSH) cartridge', 'CARTRIDGE', 'cartridge', 'box', 25, 'COLD', null, 15, 50, 50, 180, SUP_C],
  ['Urine reagent strips (10-parameter)', 'STRIP', 'strip', 'bottle', 100, 'ROOM', 90, 100, 190, 300, 9, SUP_B],
  ['Dengue NS1 rapid card', 'RAPID', 'card', 'box', 25, 'ROOM', null, 20, 50, 50, 95, SUP_B],
  ['Widal slide kit', 'REAGENT', 'test', 'kit', 50, 'COLD', null, 15, 50, 25, 12, SUP_B],
  ['CRP cartridge', 'CARTRIDGE', 'cartridge', 'box', 25, 'COLD', null, 25, 75, 50, 160, SUP_C],
  ['HIV 1 & 2 rapid card', 'RAPID', 'card', 'box', 25, 'ROOM', null, 8, 30, 25, 70, SUP_B],
  ['Haematology control (3 levels)', 'CONTROL', 'vial', 'set', 3, 'COLD', 7, 3, 9, 6, 900, SUP_A],
  ['Biochemistry control (2 levels)', 'CONTROL', 'vial', 'set', 2, 'COLD', 7, 2, 6, 4, 650, SUP_B],
  ['EDTA tube (lavender top)', 'CONSUMABLE', 'tube', 'pack', 100, 'ROOM', null, 50, 200, 300, 4, SUP_D, 'EDTA'],
  ['Plain / serum tube (red top)', 'CONSUMABLE', 'tube', 'pack', 100, 'ROOM', null, 50, 200, 300, 4, SUP_D, 'PLAIN'],
  ['Fluoride tube (grey top)', 'CONSUMABLE', 'tube', 'pack', 100, 'ROOM', null, 30, 100, 200, 4, SUP_D, 'FLUORIDE'],
  ['Urine container (sterile)', 'CONSUMABLE', 'container', 'pack', 100, 'ROOM', null, 30, 100, 200, 3, SUP_D, 'URINE']
];
const labKits = KITS.map(([name, kind, unit, packLabel, packSize, storage, openDays, reorderLevel, parLevel, storeMin, unitCost, supplier, container = ''], i) =>
  ({ id: 'KIT-' + pad(i + 1), name, kind, unit, packLabel, packSize, storage, openDays, reorderLevel, parLevel, storeMin, unitCost, supplier, container, active: true }));
const K = (n) => labKits[n - 1].id;

const P = (name, unit, low, high, critLow = null, critHigh = null) => ({ name, unit, low, high, critLow, critHigh });
const T = (name, unit, ref) => ({ name, unit, ref });
const LAB = [
  ['CBC', 'Complete Blood Count (CBC)', 350, 'Blood (EDTA)', 'Haematology', 4, [[1, 1]], [
    P('Haemoglobin', 'g/dL', 12, 17, 7, 20), P('Total WBC count', 'cells/cumm', 4000, 11000, 2000, 30000), P('Platelet count', 'lakh/cumm', 1.5, 4.5, 0.5, 10),
    P('RBC count', 'million/cumm', 4.2, 5.9), P('PCV', '%', 36, 50), P('Neutrophils', '%', 40, 75), P('Lymphocytes', '%', 20, 45)]],
  ['LFT', 'Liver Function Test (LFT)', 650, 'Blood (Plain)', 'Biochemistry', 6, [[2, 1]], [
    P('Total bilirubin', 'mg/dL', 0.2, 1.2), P('Direct bilirubin', 'mg/dL', 0, 0.3), P('SGOT (AST)', 'U/L', 5, 40), P('SGPT (ALT)', 'U/L', 7, 56),
    P('Alkaline phosphatase', 'U/L', 44, 147), P('Total protein', 'g/dL', 6, 8.3), P('Albumin', 'g/dL', 3.5, 5)]],
  ['RFT', 'Renal Function Test (RFT)', 550, 'Blood (Plain)', 'Biochemistry', 6, [[3, 1]], [
    P('Blood urea', 'mg/dL', 15, 40), P('Serum creatinine', 'mg/dL', 0.6, 1.3, null, 5), P('Uric acid', 'mg/dL', 3.4, 7), P('Sodium', 'mmol/L', 135, 145, 120, 160), P('Potassium', 'mmol/L', 3.5, 5.1, 2.5, 6.5)]],
  ['FBS', 'Blood Sugar — Fasting (FBS)', 80, 'Blood (Fluoride)', 'Biochemistry', 2, [[4, 1]], [P('Fasting blood glucose', 'mg/dL', 70, 100, 40, 400)]],
  ['PPBS', 'Blood Sugar — Post Prandial (PPBS)', 80, 'Blood (Fluoride)', 'Biochemistry', 2, [[4, 1]], [P('Post-prandial blood glucose', 'mg/dL', 70, 140, 40, 400)]],
  ['HBA1C', 'HbA1c (Glycated Haemoglobin)', 550, 'Blood (EDTA)', 'Biochemistry', 6, [[5, 1]], [P('HbA1c', '%', 4, 5.6), P('Estimated average glucose', 'mg/dL', 68, 114)]],
  ['LIPID', 'Lipid Profile', 600, 'Blood (Plain)', 'Biochemistry', 6, [[6, 1]], [
    P('Total cholesterol', 'mg/dL', 0, 200), P('Triglycerides', 'mg/dL', 0, 150), P('HDL cholesterol', 'mg/dL', 40, 60), P('LDL cholesterol', 'mg/dL', 0, 100), P('VLDL cholesterol', 'mg/dL', 5, 40)]],
  ['THYROID', 'Thyroid Profile (T3, T4, TSH)', 700, 'Blood (Plain)', 'Immunoassay', 8, [[7, 1]], [P('T3', 'ng/mL', 0.8, 2), P('T4', 'µg/dL', 5.1, 14.1), P('TSH', 'µIU/mL', 0.27, 4.2)]],
  ['URINE', 'Urine Routine Examination', 150, 'Urine (random)', 'Clinical Pathology', 2, [[8, 1]], [
    T('Colour', '', 'Pale yellow'), T('Appearance', '', 'Clear'), P('pH', '', 4.6, 8), T('Sugar', '', 'Nil'), T('Albumin', '', 'Nil'), P('Pus cells', '/hpf', 0, 5), P('RBCs', '/hpf', 0, 2)]],
  ['NS1', 'Dengue NS1 Antigen (rapid)', 600, 'Blood (Plain)', 'Serology', 1, [[9, 1]], [T('Dengue NS1 antigen', '', 'Negative')]],
  ['WIDAL', 'Widal Test (slide)', 250, 'Blood (Plain)', 'Serology', 3, [[10, 1]], [T('S. Typhi O', 'titre', '< 1:80'), T('S. Typhi H', 'titre', '< 1:80')]],
  ['CRP', 'C-Reactive Protein (CRP)', 450, 'Blood (Plain)', 'Immunoassay', 3, [[11, 1]], [P('CRP', 'mg/L', 0, 6)]],
  ['HIV', 'HIV 1 & 2 Antibody (rapid)', 500, 'Blood (Plain)', 'Serology', 2, [[12, 1]], [T('HIV 1 & 2 antibodies', '', 'Non-reactive')]]
];
// Tests that may not be done on a self request, and tests that need a signed consent form.
const RX_REQUIRED = new Set(['HIV']); const CONSENT = new Set(['HIV']);
const containerOf = (sample) => (/EDTA/.test(sample) ? 'EDTA' : /Fluoride/.test(sample) ? 'FLUORIDE' : /Urine/.test(sample) ? 'URINE' : 'PLAIN');
const OTHER = [
  ['ECG', 'ECG', 'ECG — 12 lead', 250], ['INJ', 'INJECTION', 'Injection administration (IM / IV)', 50], ['CANN', 'INJECTION', 'IV cannulation', 150], ['INF', 'INJECTION', 'IV infusion set-up', 200],
  ['NEB', 'NEBULIZATION', 'Nebulization (per session)', 150],
  ['DRS', 'OTHER', 'Dressing — small', 100], ['DRL', 'OTHER', 'Dressing — large', 250], ['SUT', 'OTHER', 'Suture removal', 150], ['MINOR', 'OTHER', 'Minor procedure', 1000],
  ['AMB', 'OTHER', 'Ambulance (within Hosur)', 800], ['CERT', 'OTHER', 'Medical certificate', 200], ['PRECON', 'OTHER', 'Pre-operative consultation', 500],
  ['SURG-HER', 'OTHER', "Surgeon's fee — hernia repair", 45000], ['OT', 'OTHER', 'Operation theatre charges', 20000], ['ANAES', 'OTHER', 'Anaesthesia charges', 10000],
  ['DCBED', 'OTHER', 'Day-care / recovery bed (per day)', 1500], ['HCCON', 'OTHER', 'Health check-up physician review', 500]
];
const services = [
  ...LAB.map(([code, name, price, sample, dept, tatHours, kits, params]) => ({ code, name, category: 'LAB', price, active: true,
    lab: { sample, container: containerOf(sample), department: dept, tatHours, rxRequired: RX_REQUIRED.has(code), consentRequired: CONSENT.has(code), kits: kits.map(([k, q]) => ({ kitId: K(k), qty: q })), parameters: params } })),
  ...OTHER.map(([code, category, name, price]) => ({ code, name, category, price, active: true }))
].map((x, i) => ({ id: 'SRV-' + pad(i + 1), ...x }));
const S = (code) => services.find((x) => x.code === code);

const packages = [
  { id: 'PKG-0001', code: 'HERNIA', name: 'Hernia Surgery Package', price: 100000, validityDays: 30, active: true,
    description: 'Open hernia repair with pre-operative work-up, surgery, anaesthesia, recovery and follow-up dressings.',
    includes: [['PRECON', 2], ['CBC', 1], ['RFT', 1], ['FBS', 1], ['ECG', 1], ['SURG-HER', 1], ['OT', 1], ['ANAES', 1], ['DCBED', 3], ['DRS', 3], ['SUT', 1], ['INJ', 6], ['CANN', 1]].map(([c, qty]) => ({ serviceId: S(c).id, qty })),
    medicineAllowance: 8000, exclusions: 'Implants / mesh above standard, extra stay beyond 3 days, ICU care, treatment of complications.' },
  { id: 'PKG-0002', code: 'MHC', name: 'Master Health Check-up', price: 2500, validityDays: 2, active: true,
    description: 'Complete annual health check with physician review.',
    includes: [['CBC', 1], ['LFT', 1], ['RFT', 1], ['LIPID', 1], ['FBS', 1], ['PPBS', 1], ['HBA1C', 1], ['THYROID', 1], ['URINE', 1], ['ECG', 1], ['HCCON', 1]].map(([c, qty]) => ({ serviceId: S(c).id, qty })),
    medicineAllowance: 0, exclusions: 'Any test or consultation not listed.' },
  { id: 'PKG-0003', code: 'DIAB', name: 'Diabetes Check-up', price: 1200, validityDays: 2, active: true,
    description: 'Sugar control and kidney / lipid screening for diabetic patients.',
    includes: [['FBS', 1], ['PPBS', 1], ['HBA1C', 1], ['RFT', 1], ['LIPID', 1], ['URINE', 1], ['HCCON', 1]].map(([c, qty]) => ({ serviceId: S(c).id, qty })),
    medicineAllowance: 0, exclusions: 'Medicines and any test not listed.' }
];

// ---------------- settings ----------------
const DISCHARGE_SECTIONS = [
  ['reason', 'Reason for admission / presenting complaints'], ['history', 'Significant history & examination findings'], ['investigations', 'Investigation results'],
  ['diagnosis', 'Final diagnosis'], ['procedures', 'Procedures / surgery performed'], ['treatment', 'Treatment given'], ['course', 'Course in hospital'],
  ['condition', 'Condition at discharge'], ['medications', 'Medicines on discharge (dose, frequency, duration)'], ['advice', 'Advice, diet & activity'],
  ['followup', 'Follow-up'], ['urgent', 'When and how to get urgent care']
];
const hospitalSettings = {
  billPrefix: 'HB',
  categories: [
    { code: 'LAB', label: 'Laboratory', icon: 'flask-conical' }, { code: 'ECG', label: 'ECG', icon: 'activity' }, { code: 'INJECTION', label: 'Injection', icon: 'syringe' },
    { code: 'NEBULIZATION', label: 'Nebulization', icon: 'wind' }, { code: 'OTHER', label: 'Other services', icon: 'stethoscope' }, { code: 'PACKAGE', label: 'Packages', icon: 'package' }],
  shifts: [{ id: 'MORNING', name: 'Morning', start: '08:00', end: '14:00' }, { id: 'EVENING', name: 'Evening', start: '14:00', end: '20:00' }, { id: 'NIGHT', name: 'Night', start: '20:00', end: '08:00' }],
  shiftTimingsConfirmed: false, defaultOpeningFloat: 1000, shiftVarianceTolerance: 50, handoverRequired: true,
  denominations: [500, 200, 100, 50, 20, 10, 5, 2, 1],
  credit: { emergencyAllowed: true, creditNeedsOwner: true },
  cancellation: { reasonRequired: true, ownerApproves: true },
  lab: { reportPrefix: 'LR', accessionPrefix: 'LAB', requireSecondPersonVerification: false, kitVarianceTolerance: 2, reportCollectDays: 15, payBeforeHandover: true,
    containers: { EDTA: { label: 'EDTA — lavender top', color: '#8E6BBF' }, PLAIN: { label: 'Plain / serum — red top', color: '#D64541' }, FLUORIDE: { label: 'Fluoride — grey top', color: '#7D8A93' }, URINE: { label: 'Urine container', color: '#E0A526' } } },
  messaging: { provider: 'WA_LINK', countryCode: '91', autoQueueOnReport: true, publicReportBaseUrl: '', senderPhone: '+91 4344 220 000',
    cloud: { enabled: false, phoneNumberId: '', businessAccountId: '', templateName: 'lab_report_ready', language: 'en' },
    templates: {
      REPORT_READY: 'Dear {name},\nYour lab report (SID {sid}) from {hospital} is ready.\nTests: {tests}\n{link}Show this SID at the lab counter to collect the printed copy within {days} days.\n— {hospital}, {phone}',
      REPORT_READY_DOCTOR: 'Dear {doctor},\nThe lab report of your patient {name} (SID {sid}) at {hospital} is ready.\nTests: {tests}\n{link}— {hospital} Laboratory',
      SAMPLE_REJECTED: 'Dear {name},\nYour sample for {tests} (SID {sid}) could not be processed. Please visit the {hospital} lab again for a new sample. We regret the inconvenience.' } },
  mrd: { codingDueDays: 5, retrievalReasons: ['Patient follow-up visit', 'Insurance / TPA claim', 'Legal / medico-legal request', 'Doctor review', 'Patient copy request', 'Audit'] },
  dischargeTemplates: [
    { id: 'TPL-GEN', name: 'General Medicine', sections: DISCHARGE_SECTIONS.filter(([k]) => k !== 'procedures').map(([k]) => k) },
    { id: 'TPL-SUR', name: 'Surgery', sections: DISCHARGE_SECTIONS.map(([k]) => k) },
    { id: 'TPL-DC', name: 'Day Care', sections: ['reason', 'diagnosis', 'procedures', 'treatment', 'condition', 'medications', 'advice', 'followup', 'urgent'] },
    { id: 'TPL-DEATH', name: 'Death Summary', sections: ['reason', 'history', 'investigations', 'diagnosis', 'treatment', 'course', 'cause'] }],
  dischargeSections: Object.fromEntries([...DISCHARGE_SECTIONS, ['cause', 'Cause of death (immediate, antecedent, underlying)']]),
  workstations: {
    enforce: false,
    list: [
      { id: 'WS-01', name: 'Main Reception & Billing Counter', location: 'Ground floor, entrance', roles: ['RECEPTION', 'SUPER_ADMIN'] },
      { id: 'WS-02', name: 'Pharmacy Counter', location: 'Ground floor, pharmacy', roles: ['PHARMACY_STAFF', 'SUPER_ADMIN'] },
      { id: 'WS-03', name: 'Central Store', location: 'First floor, store room', roles: ['STORE_INCHARGE', 'SUPER_ADMIN'] },
      { id: 'WS-04', name: 'Laboratory', location: 'Ground floor, lab', roles: ['LAB', 'SUPER_ADMIN'] },
      { id: 'WS-05', name: 'Service Counter (ECG / Injection / Nebulization)', location: 'Ground floor, procedure room', roles: ['SERVICE_COUNTER', 'SUPER_ADMIN'] },
      { id: 'WS-06', name: 'Medical Records (MRD)', location: 'First floor, records room', roles: ['MRD', 'SUPER_ADMIN'] }] }
};

export function buildHospitalData({ patients, doctors, pharmacyPayments, USERS }) {
  const { OWNER, RECEP, RECEP2, LABU, MRDU, SERVU, STAFF, RAVI, MGR } = USERS;
  // Lab Test Master metadata: version, who set it up and the change history (CRP price revised once, as a sample).
  const METHOD = { CBC: '5-part automated haematology analyser', LFT: 'Semi-auto biochemistry analyser', RFT: 'Semi-auto biochemistry analyser', FBS: 'GOD-POD', PPBS: 'GOD-POD', HBA1C: 'HPLC', LIPID: 'Enzymatic', THYROID: 'CLIA', NS1: 'Rapid card (immunochromatography)', HIV: 'Rapid card (immunochromatography)', CRP: 'Turbidimetry' };
  const NOTE = { FBS: 'Fasting sample of 8–12 hours.', LIPID: 'Fasting sample of 10–12 hours preferred.', HIV: 'A reactive rapid result must be confirmed by a supplementary test.' };
  services.filter((x) => x.category === 'LAB').forEach((x) => {
    const setUp = { at: '2026-08-01T04:30:00.000Z', by: OWNER, version: 1, reason: 'Initial test list set up', changes: ['Test created'] };
    Object.assign(x.lab, { method: METHOD[x.code] || '', note: NOTE[x.code] || '' });
    Object.assign(x, { version: 1, createdAt: setUp.at, createdBy: OWNER, updatedAt: setUp.at, updatedBy: OWNER, history: [setUp] });
    if (x.code === 'CRP') { const ch = { at: '2026-11-10T05:10:00.000Z', by: OWNER, version: 2, reason: 'New reagent lot costs more — price revised', changes: ['Price ₹: 400 → 450'] }; Object.assign(x, { version: 2, updatedAt: ch.at, history: [setUp, ch] }); }
  });
  const bills = []; const orders = []; const kitMoves = []; const kitCounts = []; const patientPackages = []; const discountRequests = [];
  const DAYS = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'];
  const TODAY = DAYS.at(-1);
  let billNo = 0; let ordNo = 0; let kmNo = 0; let payNo = 0; let lrNo = 0;

  // ---- lab stock: one ledger, STORE and LAB, every movement tied to a lot ----
  const labLots = []; const labIndents = []; const labOpenPacks = []; const labLotOf = {};
  const mv = (at, kitId, loc, lotId, type, qty, ref, by, note = '') => kitMoves.push({ id: 'KMV-' + pad(++kmNo, 5), at, kitId, loc, lotId, type, qty, ref, by, note });
  const kitMove = (at, kitId, type, qty, ref, by, note = '') => mv(at, kitId, 'LAB', labLotOf[kitId] || null, type, qty, ref, by, note);
  const newLot = (kitId, no, expiry, at, inv) => { const l = { id: 'LOT-' + pad(labLots.length + 1), kitId, lot: no, expiry, supplier: labKits.find((k) => k.id === kitId).supplier, receivedAt: at, invoiceNo: inv, verified: true }; labLots.push(l); return l; };
  // per item: [lab opening (units), store keeps (units), lot expiry]
  const OPEN = [[500, 1000, '2027-04-30'], [200, 300, '2027-03-31'], [200, 300, '2027-03-31'], [600, 600, '2027-01-10'], [25, 50, '2027-02-28'], [200, 300, '2027-05-31'], [100, 75, '2027-02-28'], [100, 500, '2027-08-31'],
    [25, 25, '2027-06-30'], [50, 50, '2026-12-11'], [25, 100, '2027-01-31'], [50, 50, '2027-09-30'], [9, 9, '2027-01-15'], [6, 6, '2027-02-15'], [300, 500, '2028-06-30'], [300, 500, '2028-06-30'], [200, 300, '2028-06-30'], [200, 300, '2028-06-30']];
  const LOTP = ['SX', 'ER', 'ER', 'ER', 'BR', 'ER', 'BR', 'UR', 'JM', 'TW', 'BR', 'HV', 'HC', 'BC', 'ED', 'PL', 'FL', 'UC'];
  const rcvAt = ist('2026-10-28', '11:00');
  labKits.forEach((k, i) => { const [lab, keep, exp] = OPEN[i]; const l = newLot(k.id, `${LOTP[i]}${2610 + i * 7}`, exp, rcvAt, 'INV/' + (4410 + i));
    labLotOf[k.id] = l.id; mv(rcvAt, k.id, 'STORE', l.id, 'SUPPLIER_IN', lab + keep, l.invoiceNo, MGR, `${(lab + keep) / k.packSize} ${k.packLabel}(s) · ${k.supplier}`); });
  // a newer CBC lot arrived mid-month (stays in the store until the first is used)
  const cbcB = newLot(labKits[0].id, 'SX2702', '2027-07-31', ist('2026-11-15', '12:00'), 'INV/4561'); mv(cbcB.receivedAt, labKits[0].id, 'STORE', cbcB.id, 'SUPPLIER_IN', 500, cbcB.invoiceNo, MGR, '1 pack · ' + SUP_A);
  // IND-0001: the month's opening request — asked, issued and received the same morning
  { const at = ist('2026-11-01', '09:00'); const iss = ist('2026-11-01', '09:25'); const rc = ist('2026-11-01', '09:40');
    const lines = labKits.map((k, i) => ({ kitId: k.id, packs: OPEN[i][0] / k.packSize })); const il = labKits.map((k, i) => ({ kitId: k.id, lotId: labLotOf[k.id], qty: OPEN[i][0] }));
    il.forEach((x) => mv(iss, x.kitId, 'STORE', x.lotId, 'ISSUE_OUT', -x.qty, 'IND-0001', MGR, 'To lab'));
    il.forEach((x) => mv(rc, x.kitId, 'LAB', x.lotId, 'ISSUE_IN', x.qty, 'IND-0001', LABU, 'From store'));
    labIndents.push({ id: 'IND-0001', at, by: LABU, urgent: false, note: 'Monthly opening stock', status: 'RECEIVED', lines, issue: { at: iss, by: MGR, note: '', packs: Object.fromEntries(lines.map((l) => [l.kitId, l.packs])), lines: il }, receive: { at: rc, by: LABU, lines: il.map((x) => ({ ...x, sent: x.qty })), note: '' }, reject: null }); }
  // packs loaded on the analysers that morning
  const openAt = ist('2026-11-01', '10:00');
  labKits.filter((k) => k.openDays && k.kind !== 'CONTROL').forEach((k) => labOpenPacks.push({ id: 'OPK-' + pad(labOpenPacks.length + 1), kitId: k.id, lotId: labLotOf[k.id], openedAt: openAt, openedBy: LABU, useBy: new Date(new Date(openAt).getTime() + k.openDays * 86400000).toISOString(), closedAt: null, closedBy: null, closedReason: '' }));
  // QC control vials: a new vial each week (a vial is used up when it is opened)
  [['2026-11-01', 13], ['2026-11-08', 13], ['2026-11-15', 13], ['2026-11-06', 14], ['2026-11-13', 14], ['2026-11-20', 14]].forEach(([d, n]) => { const k = labKits[n - 1]; const at2 = ist(d, '08:00');
    labOpenPacks.filter((p) => p.kitId === k.id && !p.closedAt).forEach((p) => Object.assign(p, { closedAt: at2, closedBy: LABU, closedReason: 'Finished — new pack opened' }));
    labOpenPacks.push({ id: 'OPK-' + pad(labOpenPacks.length + 1), kitId: k.id, lotId: labLotOf[k.id], openedAt: at2, openedBy: LABU, useBy: new Date(new Date(at2).getTime() + k.openDays * 86400000).toISOString(), closedAt: null, closedBy: null, closedReason: '' });
    kitMove(at2, k.id, 'USED_QC', -1, 'QC-' + d, LABU, 'Control vial opened for QC'); });

  const resultFor = (p) => {
    if (p.ref !== undefined) return rnd() < 0.85 ? p.ref : ({ Negative: 'Positive', Nil: 'Trace', 'Pale yellow': 'Dark yellow', Clear: 'Turbid', '< 1:80': '1:160' }[p.ref] || p.ref);
    const span = p.high - p.low || p.high || 1;
    const r = rnd();
    let v = r < 0.8 ? p.low + span * (0.1 + rnd() * 0.8) : r < 0.9 ? p.high + span * (0.05 + rnd() * 0.3) : Math.max(0, p.low - span * (0.05 + rnd() * 0.2));
    const dp = span < 2 ? 2 : span < 20 ? 1 : 0;
    return String(Math.round(v * 10 ** dp) / 10 ** dp);
  };

  function makeBill(at, counterUserId, patient, lines, { doctor, discountPct = 0, pay = 'CASH', credit = null, packageEnrol = null, coverWith = null, done = true, status: forceStatus } = {}) {
    const id = `HB-2026-${pad(++billNo, 5)}`;
    const items = lines.map(([code, qty = 1], i) => {
      const isPkg = code.startsWith('PKG:');
      const pkg = isPkg ? packages.find((p) => p.code === code.slice(4)) : null;
      const sv = isPkg ? null : S(code);
      const covered = !!(coverWith && sv && coverWith.includes(code));
      const rate = isPkg ? pkg.price : sv.price;
      const gross = covered ? 0 : rate * qty;
      return { id: `${id}-${i + 1}`, serviceId: sv?.id || null, packageId: pkg?.id || null, category: isPkg ? 'PACKAGE' : sv.category, name: isPkg ? pkg.name : sv.name, qty, rate: covered ? 0 : rate, listRate: rate, gross, coveredBy: covered ? packageEnrol : null };
    });
    const gross = items.reduce((t, x) => t + x.gross, 0);
    const discount = r2(gross * discountPct / 100);
    const net = gross - discount; const grand = Math.round(net);
    const bill = { id, at, businessDate: at.slice(0, 10) === at.slice(0, 10) ? new Date(new Date(at).getTime() + 5.5 * 3600000).toISOString().slice(0, 10) : '', patientId: patient.id, patientName: patient.name, uhid: patient.uhid, phone: patient.phone,
      doctor: doctor || pick(doctors), counterUserId, items, gross, discountPct, discountTotal: discount, roundOff: r2(grand - net), grandTotal: grand, discountRequestId: null,
      payments: [], credit: null, status: 'PAID', cancellation: null, remarks: '' };
    if (credit) {
      bill.credit = { type: credit.type, reason: credit.reason, requestedBy: counterUserId, requestedAt: at, status: credit.status, decidedBy: credit.status === 'PENDING' ? null : OWNER, decidedAt: credit.status === 'PENDING' ? null : addMin(at, credit.type === 'EMERGENCY' ? 240 : 25), note: credit.note || '' };
    } else if (grand > 0) {
      const modes = pay === 'SPLIT' ? [['CASH', Math.round(grand * 0.4)], ['UPI', grand - Math.round(grand * 0.4)]] : [[pay, grand]];
      modes.forEach(([mode, amount]) => bill.payments.push({ id: 'HPY-' + pad(++payNo, 6), kind: 'PAYMENT', mode, amount, at, userId: counterUserId, reference: mode === 'UPI' ? 'UTR' + randInt(10000000, 99999999) : mode === 'CARD' ? 'XXXX-' + randInt(1000, 9999) : '' }));
    }
    const paid = bill.payments.reduce((t, p) => t + (p.kind === 'PAYMENT' ? p.amount : -p.amount), 0);
    bill.status = forceStatus || (grand === 0 ? 'PAID' : paid >= grand ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID');
    bills.push(bill);
    // orders for every department service (lab, ECG, injection, nebulization, other)
    items.filter((x) => x.serviceId).forEach((x) => {
      const sv = services.find((q) => q.id === x.serviceId);
      for (let n = 0; n < x.qty; n++) {
        const ok = bill.status === 'PAID' || ['APPROVED', 'EMERGENCY'].includes(bill.credit?.status);
        const o = { id: 'ORD-' + pad(++ordNo, 5), billId: id, itemId: x.id, patientId: patient.id, serviceId: sv.id, category: sv.category, name: sv.name, doctor: bill.doctor,
          requestedBy: counterUserId, requestedAt: at, billedAt: at, status: ok ? 'READY' : 'ON_HOLD', accession: null, performedBy: null, performedAt: null, notes: '', lab: null, coveredBy: x.coveredBy };
        if (sv.category === 'LAB') {
          o.accession = `LAB-${bill.businessDate.replace(/-/g, '').slice(2)}-${pad(ordNo, 4)}`;
          o.lab = { sampleType: sv.lab.sample, collectedAt: null, collectedBy: null, receivedAt: null, receivedBy: null, rejected: null, results: [], enteredBy: null, enteredAt: null, verifiedBy: null, verifiedAt: null, reportNo: null, printedAt: null, printCount: 0 };
          if (ok && done) {
            const c = addMin(at, randInt(5, 25)); const rcv = addMin(c, randInt(5, 15)); const ent = addMin(rcv, randInt(40, 150)); const ver = addMin(ent, randInt(10, 40));
            Object.assign(o.lab, { collectedAt: c, collectedBy: LABU, receivedAt: rcv, receivedBy: LABU, results: sv.lab.parameters.map((p) => ({ param: p.name, value: resultFor(p) })), enteredBy: LABU, enteredAt: ent, verifiedBy: rnd() < 0.7 ? OWNER : LABU, verifiedAt: ver, reportNo: `LR-2026-${pad(++lrNo, 5)}`, printedAt: addMin(ver, 20), printCount: 1 });
            o.status = 'COMPLETED'; o.performedBy = LABU; o.performedAt = ver;
            sv.lab.kits.forEach((k) => kitMove(c, k.kitId, 'USED_TEST', -k.qty, o.id, LABU, sv.code));
          }
        } else if (ok && done) { o.status = 'COMPLETED'; o.performedBy = SERVU; o.performedAt = addMin(at, randInt(8, 30)); o.notes = sv.category === 'ECG' ? pick(['Normal sinus rhythm', 'Sinus tachycardia', 'No acute changes', 'Report handed to doctor']) : 'Done'; }
        orders.push(o);
      }
    });
    return bill;
  }

  // ---- history: 6 days of routine work at the main counter ----
  const routine = [['CBC'], ['CBC', 'CRP'], ['FBS', 'PPBS'], ['HBA1C', 'FBS'], ['LFT'], ['RFT', 'URINE'], ['LIPID'], ['THYROID'], ['ECG'], ['INJ'], ['NEB'], ['NS1', 'CBC'], ['WIDAL', 'CBC'], ['DRS'], ['ECG', 'CBC'], ['URINE'], ['INJ', 'CANN'], ['CERT']];
  DAYS.slice(0, -1).forEach((day, di) => {
    const n = randInt(9, 14);
    for (let i = 0; i < n; i++) {
      const h = 8 + Math.floor((i / n) * 11); const m = randInt(0, 59);
      const evening = h >= 14;
      const by = evening ? RECEP2 : RECEP;
      const pay = pick(['CASH', 'CASH', 'CASH', 'UPI', 'UPI', 'CARD', 'SPLIT']);
      makeBill(ist(day, `${pad(h, 2)}:${pad(m, 2)}`), by, pick(patients), pick(routine).map((c) => [c, c === 'INJ' ? randInt(1, 2) : 1]), { pay, discountPct: rnd() < 0.15 ? pick([5, 10]) : 0 });
    }
    // reagent used for QC every morning, occasional repeat / wastage
    kitMove(ist(day, '08:15'), K(1), 'USED_QC', -2, 'QC-' + day, LABU, 'Daily QC — 2 levels');
    kitMove(ist(day, '08:20'), K(4), 'USED_QC', -2, 'QC-' + day, LABU, 'Daily QC — glucometer control');
    if (di === 2) kitMove(ist(day, '15:40'), K(2), 'REPEAT', -1, 'RPT-' + day, LABU, 'Haemolysed sample — test repeated');
    if (di === 4) kitMove(ist(day, '17:05'), K(9), 'WASTAGE', -1, 'WST-' + day, LABU, 'Card damaged while opening');
  });

  // ---- packages ----
  const p6 = patients[5]; const p2 = patients[1]; const p11 = patients[10];
  // Master health check sold two days ago, fully used
  const mhcBill = makeBill(ist('2026-11-21', '08:40'), RECEP, p6, [['PKG:MHC']], { pay: 'UPI' });
  patientPackages.push({ id: 'PP-0001', packageId: 'PKG-0002', patientId: p6.id, billId: mhcBill.id, startAt: mhcBill.at, validUntil: '2026-11-23', status: 'COMPLETED', settledAt: ist('2026-11-22', '18:00'), settledBy: OWNER, settlement: { packagePrice: 2500, extras: 450 } });
  makeBill(ist('2026-11-21', '08:45'), RECEP, p6, packages[1].includes.map((x) => [services.find((q) => q.id === x.serviceId).code, x.qty]), { coverWith: packages[1].includes.map((x) => services.find((q) => q.id === x.serviceId).code), packageEnrol: 'PP-0001', pay: 'CASH' });
  makeBill(ist('2026-11-21', '11:30'), RECEP, p6, [['CRP']], { pay: 'CASH' }); // extra outside the package
  // Hernia surgery package — active, partly used
  const herBill = makeBill(ist('2026-11-20', '10:05'), RECEP, p2, [['PKG:HERNIA']], { pay: 'CARD', doctor: doctors[4] });
  herBill.payments = [{ id: 'HPY-' + pad(++payNo, 6), kind: 'PAYMENT', mode: 'CARD', amount: 60000, at: herBill.at, userId: RECEP, reference: 'XXXX-4471' }, { id: 'HPY-' + pad(++payNo, 6), kind: 'PAYMENT', mode: 'UPI', amount: 40000, at: ist('2026-11-21', '09:10'), userId: RECEP, reference: 'UTR58120044' }];
  patientPackages.push({ id: 'PP-0002', packageId: 'PKG-0001', patientId: p2.id, billId: herBill.id, startAt: herBill.at, validUntil: '2026-12-20', status: 'ACTIVE', settledAt: null, settledBy: null, settlement: null });
  const herCodes = ['PRECON', 'CBC', 'RFT', 'FBS', 'ECG', 'SURG-HER', 'OT', 'ANAES', 'DCBED', 'INJ', 'CANN'];
  makeBill(ist('2026-11-20', '10:20'), RECEP, p2, [['PRECON'], ['CBC'], ['RFT'], ['FBS'], ['ECG']], { coverWith: herCodes, packageEnrol: 'PP-0002', doctor: doctors[4] });
  makeBill(ist('2026-11-21', '07:30'), RECEP, p2, [['SURG-HER'], ['OT'], ['ANAES'], ['DCBED'], ['INJ', 2], ['CANN']], { coverWith: herCodes, packageEnrol: 'PP-0002', doctor: doctors[4] });
  makeBill(ist('2026-11-22', '09:00'), RECEP, p2, [['DCBED'], ['INJ', 2], ['DRS'], ['DRL']], { coverWith: [...herCodes, 'DRS'], packageEnrol: 'PP-0002', doctor: doctors[4], pay: 'CASH' }); // large dressing is an extra

  // ---- emergency credit (approved) and a credit waiting for the owner ----
  makeBill(ist('2026-11-22', '22:40'), RECEP2, patients[13], [['ECG'], ['CBC'], ['INJ', 2], ['NEB']], { credit: { type: 'EMERGENCY', reason: 'Night emergency — breathlessness, attender arranging money', status: 'EMERGENCY', note: 'Collect before discharge' }, doctor: doctors[0] });
  const pendingCredit = makeBill(ist(TODAY, '10:25'), RECEP, patients[14], [['LFT'], ['RFT'], ['URINE']], { credit: { type: 'CREDIT', reason: 'Long-term patient — family pays monthly', status: 'PENDING' }, done: false, doctor: doctors[0] });

  // ---- today: open work queues ----
  const todayPlan = [
    ['08:35', ['CBC', 'CRP'], 'CASH'], ['08:50', ['FBS', 'PPBS', 'HBA1C'], 'UPI'], ['09:15', ['ECG'], 'CASH'], ['09:40', ['THYROID'], 'CARD'], ['10:05', ['NEB'], 'CASH'],
    ['10:40', ['LIPID', 'LFT'], 'UPI'], ['11:20', ['INJ', 'CANN'], 'CASH'], ['11:45', ['NS1', 'CBC'], 'UPI'], ['12:10', ['URINE'], 'CASH'], ['12:30', ['ECG', 'RFT'], 'SPLIT']];
  todayPlan.forEach(([hm, codes, pay], i) => {
    const b = makeBill(ist(TODAY, hm), RECEP, patients[(i * 3 + 2) % patients.length], codes.map((c) => [c, 1]), { pay, done: i < 4 });
    // stagger the lab queue: some collected, one awaiting result entry, one awaiting verification
    orders.filter((o) => o.billId === b.id && o.status === 'READY' && o.category === 'LAB').forEach((o, k) => {
      const sv = services.find((q) => q.id === o.serviceId);
      if (i === 5 || (i === 7 && k === 1)) { const c = addMin(b.at, 12); Object.assign(o.lab, { collectedAt: c, collectedBy: LABU, receivedAt: addMin(c, 6), receivedBy: LABU }); o.status = 'SAMPLE_COLLECTED'; sv.lab.kits.forEach((kk) => kitMove(c, kk.kitId, 'USED_TEST', -kk.qty, o.id, LABU, sv.code)); }
      if (i === 4 || (i === 7 && k === 0)) { const c = addMin(b.at, 10); Object.assign(o.lab, { collectedAt: c, collectedBy: LABU, receivedAt: addMin(c, 5), receivedBy: LABU, results: sv.lab.parameters.map((p) => ({ param: p.name, value: resultFor(p) })), enteredBy: LABU, enteredAt: addMin(c, 70) }); o.status = 'RESULTED'; sv.lab.kits.forEach((kk) => kitMove(c, kk.kitId, 'USED_TEST', -kk.qty, o.id, LABU, sv.code)); }
    });
  });
  // a sample rejected this morning (haemolysed) — recollection pending
  const rej = orders.find((o) => o.category === 'LAB' && o.status === 'READY' && bills.find((b) => b.id === o.billId)?.businessDate === TODAY);
  if (rej) rej.lab.rejected = { at: ist(TODAY, '09:05'), by: LABU, reason: 'Haemolysed sample', count: 1 };
  kitMove(ist(TODAY, '08:15'), K(1), 'USED_QC', -2, 'QC-' + TODAY, LABU, 'Daily QC — 2 levels');

  // ---- services requested by a doctor but never billed (leakage check) ----
  [['2026-11-22', '16:10', 'ECG', patients[9]], [TODAY, '11:05', 'NEB', patients[4]], [TODAY, '12:20', 'INJ', patients[7]]].forEach(([d, hm, code, p]) => {
    const sv = S(code);
    orders.push({ id: 'ORD-' + pad(++ordNo, 5), billId: null, itemId: null, patientId: p.id, serviceId: sv.id, category: sv.category, name: sv.name, doctor: pick(doctors),
      requestedBy: SERVU, requestedAt: ist(d, hm), billedAt: null, status: 'REQUESTED', accession: null, performedBy: null, performedAt: null, notes: 'Doctor advised — patient sent to main counter for billing', lab: null, coveredBy: null });
  });

  // ---- a large discount that needed the Super Admin ----
  const disc = bills.find((b) => b.discountPct === 0 && b.gross >= 600 && b.businessDate === '2026-11-19' && !b.credit);
  if (disc) {
    disc.discountPct = 20; disc.discountTotal = r2(disc.gross * 0.2); const net = disc.gross - disc.discountTotal; disc.grandTotal = Math.round(net); disc.roundOff = r2(disc.grandTotal - net);
    disc.payments = [{ ...disc.payments[0], mode: 'CASH', amount: disc.grandTotal, reference: '' }]; disc.discountRequestId = 'DR-2026-0101';
    discountRequests.push({ id: 'DR-2026-0101', source: 'HOSPITAL', status: 'USED', requestedBy: disc.counterUserId, requestedAt: addMin(disc.at, -6), reason: 'Senior citizen on pension — hospital welfare scheme', requestedPct: 20,
      snapshot: { patientName: disc.patientName, saleType: 'PATIENT', lines: disc.items.map((x) => ({ name: x.name, qty: x.qty })), gross: disc.gross, discount: disc.discountTotal, grandTotal: disc.grandTotal },
      decidedBy: OWNER, decidedAt: addMin(disc.at, -2), decisionNote: '', billId: disc.id });
  }

  // ---- a cancellation request waiting for the owner ----
  const toCancel = bills.find((b) => b.businessDate === TODAY && b.status === 'PAID' && orders.filter((o) => o.billId === b.id).every((o) => o.status === 'READY'));
  if (toCancel) toCancel.cancellation = { status: 'PENDING', reason: 'Doctor cancelled the test after review', requestedBy: RECEP, requestedAt: ist(TODAY, '12:45'), decidedBy: null, decidedAt: null, refundMode: toCancel.payments[0]?.mode || 'CASH', note: '' };

  // ---- kit count yesterday: CBC short by 3 (tests run without a bill?) ----
  const kitBal = (kitId, until) => kitMoves.filter((m) => m.kitId === kitId && m.at <= until).reduce((t, m) => t + m.qty, 0);
  const cAt = ist('2026-11-22', '19:30');
  const lines = labKits.map((k) => { const sys = kitBal(k.id, cAt); const counted = k.id === K(1) ? sys - 3 : sys; return { kitId: k.id, system: sys, counted, diff: counted - sys }; });
  kitCounts.push({ id: 'KC-0001', at: cAt, businessDate: '2026-11-22', countedBy: LABU, lines, status: 'REVIEWED', reviewedBy: OWNER, reviewedAt: ist('2026-11-22', '21:00'), reviewNote: 'Explained: 3 repeat CBCs not logged as repeats. Lab told to log every repeat.' });
  kitMove(cAt, K(1), 'COUNT_ADJUST', -3, 'KC-0001', LABU, 'Physical count shortage');

  // ---- lab stock requests in progress ----
  // IND-0002: asked yesterday, store issued in the evening — on the way, the lab has not received it yet
  { const at = ist('2026-11-22', '10:15'); const iss = ist('2026-11-22', '16:40'); const lines = [{ kitId: K(5), packs: 2 }, { kitId: K(8), packs: 1 }];
    const il = [{ kitId: K(5), lotId: labLotOf[K(5)], qty: 50 }, { kitId: K(8), lotId: labLotOf[K(8)], qty: 100 }];
    il.forEach((x) => mv(iss, x.kitId, 'STORE', x.lotId, 'ISSUE_OUT', -x.qty, 'IND-0002', MGR, 'To lab'));
    labIndents.push({ id: 'IND-0002', at, by: LABU, urgent: false, note: '', status: 'ISSUED', lines, issue: { at: iss, by: MGR, note: '', packs: { [K(5)]: 2, [K(8)]: 1 }, lines: il }, receive: null, reject: null }); }
  // IND-0003: this morning, urgent — waiting at the store
  labIndents.push({ id: 'IND-0003', at: ist(TODAY, '09:40'), by: LABU, urgent: true, note: 'Dengue cases rising — 6 NS1 tests already this morning', status: 'REQUESTED', lines: [{ kitId: K(9), packs: 2 }, { kitId: K(12), packs: 1 }], issue: null, receive: null, reject: null });

  // ---- lab visits: one SID per visit, tubes grouped by container (BRD 06, hospital multi-source design) ----
  const referralDoctors = [
    ['Dr. M. Venkateswaran', 'M.D (Gen Med)', 'Venkat Clinic, Bagalur Road', '+91 98431 20011'], ['Dr. S. Kalaivani', 'M.B.B.S, D.G.O', 'Kalai Women’s Clinic, Mathigiri', '+91 94433 51200'],
    ['Dr. R. Senthil Kumar', 'M.D (Paed)', 'Senthil Child Clinic, Shanthi Nagar', '+91 90037 44110'], ['Dr. A. Imran Khan', 'M.B.B.S', 'City Family Clinic, Rayakottai Road', '+91 99402 18877'],
    ['Dr. P. Lakshmi Narayanan', 'M.S (Ortho)', 'LN Bone & Joint Centre, Denkanikottai Road', '+91 97890 33445']
  ].map(([name, qual, clinic, phone], i) => ({ id: 'RD-' + pad(i + 1), name, qualification: qual, clinic, phone, city: 'Hosur', active: true, addedAt: '2026-08-05T10:00:00.000Z' }));
  const labVisits = []; const messages = []; let sidN = 0; let msgN = 0; const tokenByDay = {};
  const svcOf = (o) => services.find((x) => x.id === o.serviceId);
  const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
  const sendMsg = (at, v, to, kind = 'REPORT_READY') => { const id = 'MSG-' + pad(++msgN, 5); const pt = patients.find((x) => x.id === v.patientId);
    messages.push({ id, channel: 'WHATSAPP', provider: 'WA_LINK', to, patientId: v.patientId, refType: 'LABVISIT', refId: v.id, template: kind, status: 'SENT_VIA_LINK', at, by: LABU,
      body: fill(hospitalSettings.messaging.templates[kind], { name: pt.name, sid: v.sid, hospital: 'Nallam Hospital', tests: orders.filter((o) => o.labVisitId === v.id).map((o) => o.name).join(', '), link: '', days: 15, phone: hospitalSettings.messaging.senderPhone, doctor: v.doctor }) }); return id; };
  function makeVisit(b, lo, { source, ipNo = null, ward = null, bed = null, doctor = '', priority = 'ROUTINE', at = b?.at, createdBy = b?.counterUserId, route }) {
    const id = 'LV-' + pad(++sidN, 5); const sid = String(4010000 + sidN).padStart(8, '0'); const day = new Date(new Date(at).getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
    const opd = !['IP', 'EMERGENCY'].includes(source);
    const tok = opd ? (tokenByDay[day] = (tokenByDay[day] || 0) + 1) : null;
    const groups = {}; lo.forEach((o) => (groups[svcOf(o).lab.container] ||= []).push(o));
    const tubes = Object.entries(groups).map(([c, os], k) => { const code = `${sid}-${k + 1}`; const col = os.map((o) => o.lab.collectedAt).filter(Boolean).sort()[0] || null; const rcv = os.map((o) => o.lab.receivedAt).filter(Boolean).sort()[0] || null;
      const rj = os.find((o) => o.lab.rejected)?.lab.rejected || null;
      os.forEach((o) => { o.labVisitId = id; o.accession = code; o.lab.tube = code; if (doctor) o.doctor = doctor; });
      return { code, container: c, orderIds: os.map((o) => o.id), collectedAt: col, collectedBy: col ? LABU : null, receivedAt: rcv, receivedBy: rcv ? LABU : null, rejected: rj }; });
    const due = new Date(Math.max(...lo.map((o) => new Date(at).getTime() + svcOf(o).lab.tatHours * 3600000))).toISOString();
    const refDoc = source === 'REFERRAL' ? referralDoctors[sidN % referralDoctors.length] : null;
    const v = { id, sid, patientId: lo[0].patientId, source, priority, billId: b?.id || null, billingRoute: route || (source === 'IP' ? 'IP_ACCOUNT' : source === 'EMERGENCY' ? 'EMERGENCY' : source === 'PACKAGE' ? 'PACKAGE' : 'COUNTER'),
      doctor: refDoc ? `${refDoc.name}, ${refDoc.qualification}` : source === 'SELF' ? 'Self' : doctor || b?.doctor || '', referralDoctorId: refDoc?.id || null,
      rxBasis: { OP: 'DOCTOR_ORDER', IP: 'DOCTOR_ORDER', EMERGENCY: 'DOCTOR_ORDER', REFERRAL: 'OUTSIDE_PRESCRIPTION', SELF: 'SELF_REQUEST', PACKAGE: 'PACKAGE' }[source],
      prescription: source === 'REFERRAL' ? { id: 'RXF-' + sid, name: `prescription-${sid}.jpg`, type: 'image/jpeg', size: randInt(180, 900) * 1024, at, by: createdBy, demo: true } : null, consent: null,
      token: tok, tokenDay: opd ? day : null, tokenStatus: tubes.every((t) => t.collectedAt) ? 'DONE' : 'WAITING', calledAt: null, collectionPoint: source === 'IP' ? 'WARD' : source === 'EMERGENCY' ? 'CASUALTY' : 'OPD',
      ipNo, ward, bed, clinicalNotes: '', createdAt: at, createdBy, reportDueAt: due, tubes, deliveries: [], handover: null };
    if (refDoc || source === 'SELF') { if (b) b.doctor = v.doctor; }
    labVisits.push(v); return v;
  }
  bills.forEach((b, bi) => {
    const lo = orders.filter((o) => o.billId === b.id && o.category === 'LAB'); if (!lo.length) return;
    const source = b.credit?.type === 'EMERGENCY' ? 'EMERGENCY' : lo.every((o) => o.coveredBy) ? 'PACKAGE' : ['OP', 'REFERRAL', 'SELF', 'OP', 'REFERRAL', 'OP'][bi % 6];
    const v = makeVisit(b, lo, { source, priority: source === 'EMERGENCY' ? 'STAT' : bi % 9 === 0 ? 'URGENT' : 'ROUTINE' });
    const done = lo.every((o) => o.status === 'COMPLETED');
    if (done) {
      const last = lo.map((o) => o.lab.verifiedAt).sort().at(-1); const pt = patients.find((x) => x.id === v.patientId);
      const mid = sendMsg(addMin(last, 6), v, pt.phone);
      v.deliveries.push({ channel: 'WHATSAPP', to: pt.phone, at: addMin(last, 6), by: LABU, status: 'SENT_VIA_LINK', messageId: mid });
      if (source === 'REFERRAL' && bi % 2) { const rd = referralDoctors.find((r) => r.id === v.referralDoctorId); const m2 = sendMsg(addMin(last, 8), v, rd.phone, 'REPORT_READY_DOCTOR'); v.deliveries.push({ channel: 'WHATSAPP', to: rd.phone, at: addMin(last, 8), by: LABU, status: 'SENT_VIA_LINK', messageId: m2, toDoctor: true }); }
      if (bi % 3 !== 0 && b.businessDate < TODAY) { v.handover = { at: addMin(last, 60 * randInt(3, 20)), by: pick([RECEP, RECEP2]), collectedBy: bi % 4 ? 'Self' : 'Attender', name: bi % 4 ? pt.name : 'Family member', printCount: 1 }; v.deliveries.push({ channel: 'COUNTER', to: v.handover.name, at: v.handover.at, by: v.handover.by, status: 'HANDED_OVER' }); }
    }
  });
  // in-patient ward orders: no counter payment, charged to the IP account
  const ipPt = patients[1];
  const ipOrder = (code, at, st) => { const sv = S(code); const o = { id: 'ORD-' + pad(++ordNo, 5), billId: null, itemId: null, patientId: ipPt.id, serviceId: sv.id, category: 'LAB', name: sv.name, doctor: doctors[4], requestedBy: SERVU, requestedAt: at, billedAt: at, status: st, accession: null, performedBy: null, performedAt: null, notes: '', coveredBy: null,
    ipCharge: { amount: sv.price, ipNo: 'IP-2026-0141', posted: false }, lab: { sampleType: sv.lab.sample, collectedAt: null, collectedBy: null, receivedAt: null, receivedBy: null, rejected: null, results: [], enteredBy: null, enteredAt: null, verifiedBy: null, verifiedAt: null, reportNo: null, printedAt: null, printCount: 0 } };
    if (st === 'COMPLETED') { const c = addMin(at, 20); Object.assign(o.lab, { collectedAt: c, collectedBy: LABU, receivedAt: addMin(c, 10), receivedBy: LABU, results: sv.lab.parameters.map((q) => ({ param: q.name, value: resultFor(q) })), enteredBy: LABU, enteredAt: addMin(c, 70), verifiedBy: OWNER, verifiedAt: addMin(c, 90), reportNo: `LR-2026-${pad(++lrNo, 5)}`, printCount: 0 }); o.performedBy = LABU; o.performedAt = o.lab.verifiedAt; sv.lab.kits.forEach((k) => kitMove(c, k.kitId, 'USED_TEST', -k.qty, o.id, LABU, sv.code)); }
    orders.push(o); return o; };
  const ipA = ['CBC', 'RFT'].map((c) => ipOrder(c, ist('2026-11-22', '06:30'), 'COMPLETED'));
  const vA = makeVisit(null, ipA, { source: 'IP', ipNo: 'IP-2026-0141', ward: 'Surgical ward', bed: 'S-4', doctor: doctors[4], priority: 'ROUTINE', at: ist('2026-11-22', '06:30'), createdBy: SERVU });
  vA.deliveries.push({ channel: 'WARD', to: 'Surgical ward — Bed S-4', at: ipA[0].lab.verifiedAt, by: LABU, status: 'POSTED_TO_IP_RECORD' });
  const ipB = ['CBC', 'CRP'].map((c) => ipOrder(c, ist(TODAY, '07:10'), 'READY'));
  makeVisit(null, ipB, { source: 'IP', ipNo: 'IP-2026-0141', ward: 'Surgical ward', bed: 'S-4', doctor: doctors[4], priority: 'STAT', at: ist(TODAY, '07:10'), createdBy: SERVU });

  // ---- MRD ----
  const medicalRecords = []; const dischargeSummaries = []; const retrievals = [];
  const ep = (i, p, type, adm, dis, ward, doc, dx, icd, proc, files) => medicalRecords.push({ id: 'MRD-' + pad(i), mrdNo: `MRD/2026/${pad(310 + i, 5)}`, patientId: p.id, episodeType: type, ipNo: type === 'IP' ? `IP-2026-${pad(140 + i, 4)}` : null,
    admittedAt: adm, dischargedAt: dis, ward, doctor: doc, diagnosis: dx, icd10: icd, procedures: proc, documents: files.map((f, k) => ({ id: `DOC-${pad(i)}-${k + 1}`, name: f, type: 'application/pdf', size: randInt(80, 900) * 1024, at: dis || adm, by: MRDU, demo: true })),
    status: dis ? 'FILED' : 'OPEN', location: dis ? `Rack ${pick(['A', 'B', 'C'])}-${randInt(1, 9)}, Shelf ${randInt(1, 5)}` : 'With ward', codedBy: dis ? MRDU : null, codedAt: dis ? addMin(dis, 60 * 26) : null, createdAt: adm, createdBy: MRDU, source: 'MANUAL' });
  ep(1, patients[1], 'IP', ist('2026-11-21', '07:00'), null, 'Surgical ward — Bed S-4', doctors[4], 'Right inguinal hernia', 'K40.9', 'Open hernioplasty with mesh', ['Consent form.pdf', 'Anaesthesia record.pdf']);
  ep(2, patients[8], 'IP', ist('2026-11-12', '18:20'), ist('2026-11-16', '11:00'), 'General ward — Bed G-7', doctors[0], 'Community acquired pneumonia', 'J18.9', '', ['Chest X-ray report.pdf', 'Case sheet.pdf']);
  ep(3, patients[3], 'IP', ist('2026-11-14', '09:10'), ist('2026-11-17', '10:30'), 'Maternity ward — Bed M-2', doctors[1], 'Term pregnancy, normal vaginal delivery', 'O80', 'Normal vaginal delivery', ['Partograph.pdf', 'Baby record.pdf']);
  ep(4, patients[12], 'IP', ist('2026-11-18', '21:00'), ist('2026-11-22', '12:00'), 'General ward — Bed G-2', doctors[0], 'Dengue fever without warning signs', 'A90', '', ['Platelet trend.pdf']);
  ep(5, patients[6], 'DAYCARE', ist('2026-11-20', '09:00'), ist('2026-11-20', '17:00'), 'Day care — Bay 1', doctors[2], 'Closed fracture distal radius, right', 'S52.50', 'Closed reduction and cast', ['X-ray wrist.pdf']);
  const sum = (i, recIdx, tpl, status, sections, by, rev) => { const r = medicalRecords[recIdx]; dischargeSummaries.push({ id: 'DS-' + pad(i), recordId: r.id, patientId: r.patientId, templateId: tpl, sections, status,
    preparedBy: by, preparedAt: r.dischargedAt || r.admittedAt, reviewedBy: rev, reviewedAt: rev ? addMin(r.dischargedAt, -30) : null, finalizedAt: status === 'FINAL' ? addMin(r.dischargedAt, -20) : null, printCount: status === 'FINAL' ? 2 : 0, history: [{ at: r.dischargedAt || r.admittedAt, by, action: 'Prepared' }, ...(rev ? [{ at: addMin(r.dischargedAt, -30), by: rev, action: status === 'FINAL' ? 'Reviewed & finalised' : 'Sent back' }] : [])] }); };
  sum(1, 1, 'TPL-GEN', 'FINAL', { reason: 'Fever with cough and breathlessness for 4 days.', history: 'Crepitations right lower zone. SpO2 92% on room air.', investigations: 'TLC 14,600; CRP 48 mg/L; Chest X-ray: right lower lobe consolidation.', diagnosis: 'Community acquired pneumonia (J18.9)', treatment: 'IV Ceftriaxone 1 g BD × 4 days, nebulization, oxygen for 24 h, paracetamol SOS.', course: 'Afebrile from day 2, oxygen weaned on day 2. Improved.', condition: 'Stable, afebrile, SpO2 98% on room air.', medications: 'Tab. Augmentin 625 BD × 5 days; Tab. Montair LC HS × 5 days; Tab. Dolo 650 SOS.', advice: 'Plenty of fluids, steam inhalation, avoid cold drinks.', followup: 'Review in General Medicine OPD after 7 days with CBC.', urgent: 'Return immediately or call the hospital if breathlessness, high fever or chest pain.' }, MRDU, OWNER);
  sum(2, 2, 'TPL-SUR', 'FINAL', { reason: 'Term pregnancy in labour.', history: 'G2P1L1, 39 weeks, uneventful antenatal period.', investigations: 'Hb 11.4 g/dL; blood group B+; USG normal.', diagnosis: 'Term pregnancy — normal vaginal delivery (O80)', procedures: 'Normal vaginal delivery with episiotomy. Live female baby 3.1 kg.', treatment: 'Oxytocin, IV fluids, analgesics.', course: 'Uneventful post-natal recovery.', condition: 'Mother and baby stable.', medications: 'Iron and calcium tablets × 3 months; Tab. Dolo 650 SOS.', advice: 'Breastfeeding, perineal hygiene, adequate rest.', followup: 'Review after 6 weeks; baby vaccination as per schedule.', urgent: 'Come immediately for heavy bleeding, fever or foul-smelling discharge.' }, MRDU, OWNER);
  sum(3, 3, 'TPL-GEN', 'PENDING_REVIEW', { reason: 'Fever, body ache and headache for 3 days.', history: 'No warning signs. Hydration fair.', investigations: 'NS1 antigen positive. Platelets 98,000 → 1,42,000 at discharge.', diagnosis: 'Dengue fever without warning signs (A90)', treatment: 'IV fluids, paracetamol, platelet monitoring.', course: 'Platelets improved from day 3.', condition: 'Afebrile, platelets rising.', medications: 'Tab. Dolo 650 SOS (max 3/day) × 3 days.', advice: 'Oral fluids 3 litres/day. Avoid painkillers other than paracetamol.', followup: 'CBC after 3 days.', urgent: 'Return for bleeding, abdominal pain, vomiting or drowsiness.' }, MRDU, null);
  sum(4, 4, 'TPL-DC', 'DRAFT', { reason: 'Fall on outstretched hand.', diagnosis: 'Closed fracture distal radius, right (S52.50)', procedures: 'Closed reduction under sedation, below-elbow cast.', treatment: '', condition: '', medications: '', advice: '', followup: '', urgent: '' }, MRDU, null);
  retrievals.push({ id: 'RTV-0001', recordId: 'MRD-0002', requestedBy: OWNER, reason: 'Insurance / TPA claim', at: ist('2026-11-19', '11:00'), issuedBy: MRDU, issuedAt: ist('2026-11-19', '11:20'), returnedAt: ist('2026-11-20', '16:00'), status: 'RETURNED' });
  retrievals.push({ id: 'RTV-0002', recordId: 'MRD-0003', requestedBy: 'USR-0003', reason: 'Patient copy request', at: ist(TODAY, '10:00'), issuedBy: MRDU, issuedAt: ist(TODAY, '10:15'), returnedAt: null, status: 'ISSUED' });

  // ---- shifts (Module 12) ----
  // Collections are worked out from the transactions in each shift window; the seed only records start/close and counted cash.
  const shifts = []; let sh = 0;
  const hospPays = (uid, a, b) => bills.flatMap((x) => x.payments).filter((p) => p.userId === uid && p.at >= a && p.at <= b);
  const phPays = (uid, a, b) => pharmacyPayments.filter((p) => p.userId === uid && p.at >= a && p.at <= b);
  const cashIn = (uid, a, b) => [...hospPays(uid, a, b), ...phPays(uid, a, b)].filter((p) => p.mode === 'CASH').reduce((t, p) => t + (p.kind === 'REFUND' ? -p.amount : p.amount), 0);
  const denom = (amt) => { const out = {}; let left = Math.round(amt); for (const d of hospitalSettings.denominations) { const n = Math.floor(left / d); if (n) { out[d] = n; left -= n * d; } } return out; };
  const addShift = (uid, counter, name, start, end, open, handTo, variance = 0, acceptedAt = null) => {
    const expected = r2(open + cashIn(uid, start, end));
    const counted = r2(expected + variance);
    shifts.push({ id: 'SFT-' + pad(++sh), userId: uid, counter, shiftName: name, startAt: start, openingFloat: open, openingDenoms: denom(open), status: end ? (handTo ? (acceptedAt ? 'HANDED_OVER' : 'HANDOVER_PENDING') : 'CLOSED') : 'OPEN',
      closedAt: end, expectedCash: end ? expected : null, countedCash: end ? counted : null, countedDenoms: end ? denom(counted) : null, difference: end ? r2(counted - expected) : null,
      handoverTo: handTo, handoverAmount: end ? counted : null, handoverAcceptedAt: acceptedAt, handoverNote: '', note: variance ? 'Short by ₹' + Math.abs(variance) + ' — coins given as change not recorded' : '', verifiedBy: end && acceptedAt ? OWNER : null });
    return counted;
  };
  // pharmacy cashiers: one drawer per person per day, covering every payment they took that day
  const phWindow = (uid, d) => { const ts = pharmacyPayments.filter((p) => p.userId === uid && p.at >= ist(d, '00:00') && p.at <= ist(d, '23:59')).map((p) => p.at).sort(); return ts.length ? [addMin(ts[0], -12), addMin(ts.at(-1), 9)] : null; };
  DAYS.slice(0, -1).forEach((d, i) => {
    const m = addShift(RECEP, 'MAIN', 'Morning', ist(d, '07:55'), ist(d, '14:00'), 1000, RECEP2, i === 3 ? -20 : 0, ist(d, '14:01'));
    addShift(RECEP2, 'MAIN', 'Evening', ist(d, '14:00'), ist(d, '23:59'), m, RECEP, 0, ist(DAYS[i + 1], '07:54'));
    [STAFF, RAVI].forEach((uid) => { const w = phWindow(uid, d); if (w) addShift(uid, 'PHARMACY', uid === STAFF ? 'Morning' : 'Evening', w[0], w[1], 2000, null, 0); });
  });
  addShift(RECEP, 'MAIN', 'Morning', ist(TODAY, '07:55'), null, 1000, null);
  [STAFF, RAVI].forEach((uid) => { const w = phWindow(uid, TODAY); addShift(uid, 'PHARMACY', uid === STAFF ? 'Morning' : 'Evening', w ? w[0] : ist(TODAY, '07:52'), null, 2000, null); });

  // ---- notifications & audit entries for the new modules ----
  const notes = [];
  if (pendingCredit) notes.push({ type: 'CREDIT_REQUEST', category: 'Credit approval', severity: 'warning', title: `Credit requested — ${pendingCredit.patientName}`, message: `${pendingCredit.id}: ₹${pendingCredit.grandTotal} · Long-term patient — family pays monthly. Tests are on hold until you decide.`, refType: 'HBILL', refId: pendingCredit.id, targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER, performedBy: RECEP, createdAt: ist(TODAY, '10:26') });
  notes.push({ type: 'KIT_VARIANCE', category: 'Lab kits', severity: 'critical', title: 'Lab kit shortage — CBC reagent short by 3', message: 'Physical count is 3 tests lower than the system. Check for tests run without a bill.', refType: 'KITCOUNT', refId: 'KC-0001', targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER, performedBy: LABU, createdAt: cAt });
  notes.push({ type: 'UNBILLED_SERVICE', category: 'Services', severity: 'warning', title: 'Service requested but not billed — ECG', message: `${patients[9].name}: ECG advised yesterday is still not billed at the main counter.`, refType: 'ORDER', refId: orders.find((o) => o.status === 'REQUESTED')?.id, targetRoles: ['SUPER_ADMIN', 'RECEPTION'], assignedTo: null, performedBy: null, createdAt: ist(TODAY, '08:00') });

  return {
    services, labKits, labLots, labIndents, labOpenPacks, packages, hospitalSettings, labVisits, referralDoctors, messages, hospitalBills: bills, orders, kitMovements: kitMoves, kitCounts, patientPackages, medicalRecords, dischargeSummaries, mrdRetrievals: retrievals, shifts,
    extraDiscountRequests: discountRequests, extraNotifications: notes
  };
}
