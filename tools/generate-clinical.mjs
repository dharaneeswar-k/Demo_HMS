// Seed data for OP (BRD 02) and IP (BRD 03) — called at the end of tools/generate-data.mjs.
// All people, policies and amounts are FICTIONAL demonstration data. Deterministic: same output on every run.
// Uses its own PRNG so the existing pharmacy/store data stays byte-identical.
import { r2 } from '../assets/js/pricing.js';
import { bedDayPlan, bedChargeLines, payerSplit, priceServices, opVisitPolicy, bmi } from '../assets/js/clinical-rules.js';

let seed = 20261125;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const chance = (p) => rnd() < p;
const pad = (n, l = 4) => String(n).padStart(l, '0');

const TODAY = '2026-11-23';
const NOW = new Date('2026-11-23T13:30:00+05:30');
const ist = (day, hh, mm = 0) => new Date(`${day}T${pad(hh, 2)}:${pad(mm, 2)}:00+05:30`);
const iso = (d) => new Date(d).toISOString();
const dayKey = (t) => new Date(new Date(t).getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
const hourOf = (t) => new Date(new Date(t).getTime() + 5.5 * 3600000).getUTCHours();
const addDays = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMin = (d, m) => new Date(new Date(d).getTime() + m * 60000);
const dayIndexNow = (k) => Math.round((new Date(TODAY + 'T00:00:00Z') - new Date(k + 'T00:00:00Z')) / 86400000);
const weekday = (k) => new Date(k + 'T00:00:00Z').getUTCDay();

export function buildClinical(ctx) {
  const { patients, medicines, batches, movements, users, roles, notifications: N, audit, PH } = ctx;
  const RECEP = 'USR-0005', OWNER = 'USR-0003', STAFF = 'USR-0001', RAVI = 'USR-0004';
  const DOCU = 'USR-0006', NURSE = 'USR-0007', BILL = 'USR-0008';

  // ---------------- users & roles ----------------
  users.push(
    { id: DOCU, username: 'doctor', password: 'demo123', name: 'Dr. A. Ravichandran', role: 'DOCTOR', designation: 'Consultant Physician (General Medicine)', email: '', phone: '+91 90000 66666', active: true, createdAt: '2026-07-20T10:00:00.000Z' },
    { id: NURSE, username: 'nurse', password: 'demo123', name: 'Priya Ramesh', role: 'NURSE', designation: 'Staff Nurse (Ward In-charge)', email: '', phone: '+91 90000 77777', active: true, createdAt: '2026-07-20T10:00:00.000Z' },
    { id: BILL, username: 'billing', password: 'demo123', name: 'Suresh Kannan', role: 'BILLING', designation: 'Billing Executive', email: '', phone: '+91 90000 88888', active: true, createdAt: '2026-07-20T10:00:00.000Z' });
  const role = (id) => roles.find((r) => r.id === id);
  const add = (id, perms) => { const r = role(id); perms.forEach((p) => { if (!r.permissions.includes(p)) r.permissions.push(p); }); };
  add('RECEPTION', ['op.view', 'op.register', 'op.bill', 'op.cancel', 'ip.view', 'ip.admit', 'ip.deposit', 'ip.transfer', 'bed.manage', 'hospital.closing']);
  add('PHARMACY_STAFF', ['ip.view', 'ip.indents', 'ip.indent.issue', 'ip.clear.pharmacy']);
  role('RECEPTION').description = 'Front office: patient registration, OP visits and tokens, admissions, deposits and the hospital cash counter.';
  const DOCTOR_PERMS = ['patient.view', 'alerts.view', 'op.view', 'op.consult', 'ip.view', 'ip.round', 'ip.discharge.initiate', 'ip.summary'];
  const NURSE_PERMS = ['patient.view', 'alerts.view', 'op.view', 'op.vitals', 'ip.view', 'ip.nursing', 'ip.indents', 'ip.indent.raise', 'ip.charge', 'ip.transfer', 'ip.clear.nursing', 'bed.manage'];
  const BILLING_PERMS = ['patient.view', 'patient.register', 'alerts.view', 'op.view', 'op.register', 'op.bill', 'op.cancel', 'ip.view', 'ip.admit', 'ip.deposit', 'ip.charge', 'ip.transfer',
    'ip.bill.final', 'ip.tpa', 'hospital.closing'];
  roles.push(
    { id: 'DOCTOR', name: 'Doctor', description: 'Consultant: own OP queue, consultation and prescription, IP rounds, discharge and discharge summary.', permissions: DOCTOR_PERMS },
    { id: 'NURSE', name: 'Nurse', description: 'Vitals, nursing notes, ward medicine indents, bed transfers and housekeeping, nursing clearance.', permissions: NURSE_PERMS },
    { id: 'BILLING', name: 'Billing', description: 'OP and IP billing: fees, deposits, charges, interim and final bills, insurance/TPA desk and cash closing.', permissions: BILLING_PERMS });
  add('SUPER_ADMIN', [...new Set([...DOCTOR_PERMS, ...NURSE_PERMS, ...BILLING_PERMS, ...role('RECEPTION').permissions, 'ip.indent.issue', 'ip.clear.pharmacy',
    'hospital.approve', 'hospital.closing.verify', 'clinical.masters'])]);

  // ---------------- masters ----------------
  const departments = [
    { id: 'DEP-01', code: 'GM', name: 'General Medicine', active: true }, { id: 'DEP-02', code: 'OG', name: 'Obstetrics & Gynaecology', active: true },
    { id: 'DEP-03', code: 'OR', name: 'Orthopaedics', active: true }, { id: 'DEP-04', code: 'PD', name: 'Paediatrics', active: true },
    { id: 'DEP-05', code: 'SU', name: 'General Surgery', active: true }, { id: 'DEP-06', code: 'EN', name: 'ENT', active: true }];
  const doctors = [
    ['DOC-01', 'Dr. A. Ravichandran', 'DEP-01', 'MBBS, MD (General Medicine)', 'TNMC 45821', 'OP-1', 400, 250, 7, 500, '09:00', '13:00', DOCU],
    ['DOC-02', 'Dr. K. Sangeetha', 'DEP-02', 'MBBS, MS (OBG)', 'TNMC 51207', 'OP-2', 500, 300, 15, 700, '10:00', '14:00', null],
    ['DOC-03', 'Dr. M. Harish', 'DEP-03', 'MBBS, MS (Ortho)', 'TNMC 48833', 'OP-3', 500, 300, 7, 700, '09:30', '13:30', null],
    ['DOC-04', 'Dr. S. Nivetha', 'DEP-04', 'MBBS, DCH, MD (Paed)', 'TNMC 55190', 'OP-4', 400, 250, 7, 500, '09:00', '12:30', null],
    ['DOC-05', 'Dr. R. Balaji', 'DEP-05', 'MBBS, MS (General Surgery)', 'TNMC 42716', 'OP-5', 500, 300, 7, 700, '11:00', '14:00', null],
    ['DOC-06', 'Dr. P. Kavya', 'DEP-06', 'MBBS, MS (ENT)', 'TNMC 57342', 'OP-6', 400, 250, 7, 500, '16:00', '19:00', null]
  ].map(([id, name, departmentId, qualification, registrationNo, room, fNew, fRev, followUpDays, ipVisitFee, start, end, userId]) => ({
    id, name, departmentId, qualification, registrationNo, room, fees: { new: fNew, revisit: fRev }, followUpDays, ipVisitFee,
    days: id === 'DOC-06' ? [1, 3, 5] : [1, 2, 3, 4, 5, 6], start, end, userId, phone: '', active: true }));
  const docById = Object.fromEntries(doctors.map((d) => [d.id, d]));
  const deptById = Object.fromEntries(departments.map((d) => [d.id, d]));

  let sv = 0;
  const S = (code, name, category, group, rate, applicableIn, extra = {}) => ({ id: 'SRV-' + pad(++sv, 3), code, name, category, group, rate, unit: extra.unit || 'each', applicableIn, nonPayable: !!extra.nonPayable, active: true });
  const services = [
    S('CBC', 'Complete blood count (CBC)', 'INVESTIGATION', 'INVESTIGATION', 350, ['OP', 'IP']), S('ESR', 'ESR', 'INVESTIGATION', 'INVESTIGATION', 150, ['OP', 'IP']),
    S('RBS', 'Random blood sugar', 'INVESTIGATION', 'INVESTIGATION', 80, ['OP', 'IP']), S('HBA1C', 'HbA1c', 'INVESTIGATION', 'INVESTIGATION', 550, ['OP', 'IP']),
    S('LFT', 'Liver function test', 'INVESTIGATION', 'INVESTIGATION', 650, ['OP', 'IP']), S('RFT', 'Renal function test', 'INVESTIGATION', 'INVESTIGATION', 600, ['OP', 'IP']),
    S('LIPID', 'Lipid profile', 'INVESTIGATION', 'INVESTIGATION', 700, ['OP', 'IP']), S('URINE', 'Urine routine', 'INVESTIGATION', 'INVESTIGATION', 150, ['OP', 'IP']),
    S('NS1', 'Dengue NS1 antigen', 'INVESTIGATION', 'INVESTIGATION', 800, ['OP', 'IP']), S('ELEC', 'Serum electrolytes', 'INVESTIGATION', 'INVESTIGATION', 600, ['OP', 'IP']),
    S('XRAY', 'X-ray (single view)', 'INVESTIGATION', 'INVESTIGATION', 450, ['OP', 'IP']), S('ECG', 'ECG', 'INVESTIGATION', 'INVESTIGATION', 300, ['OP', 'IP']),
    S('USG', 'Ultrasound abdomen', 'INVESTIGATION', 'INVESTIGATION', 1200, ['OP', 'IP']), S('GROUP', 'Blood grouping & Rh', 'INVESTIGATION', 'INVESTIGATION', 150, ['OP', 'IP']),
    S('DRS', 'Dressing — small', 'PROCEDURE', 'PROCEDURE', 200, ['OP', 'IP']), S('DRL', 'Dressing — large', 'PROCEDURE', 'PROCEDURE', 400, ['OP', 'IP']),
    S('INJ', 'Injection administration', 'PROCEDURE', 'PROCEDURE', 100, ['OP', 'IP']), S('NEB', 'Nebulisation', 'PROCEDURE', 'PROCEDURE', 150, ['OP', 'IP']),
    S('SUT', 'Suturing (minor)', 'PROCEDURE', 'PROCEDURE', 800, ['OP', 'IP']), S('POP', 'Plaster of Paris application', 'PROCEDURE', 'PROCEDURE', 1500, ['OP', 'IP']),
    S('WAX', 'Ear wax removal', 'PROCEDURE', 'PROCEDURE', 300, ['OP']), S('CATH', 'Urinary catheterisation', 'PROCEDURE', 'PROCEDURE', 500, ['IP']),
    S('CVC', 'Central line insertion', 'PROCEDURE', 'PROCEDURE', 3500, ['IP']),
    S('OTMIN', 'OT charges — minor', 'OT', 'PROCEDURE', 3000, ['IP']), S('OTMAJ', 'OT charges — major', 'OT', 'PROCEDURE', 12000, ['IP']),
    S('ANAES', 'Anaesthesia charges', 'OT', 'PROCEDURE', 4000, ['IP']), S('SURGMAJ', 'Surgeon fee — major surgery', 'OT', 'PROCEDURE', 15000, ['IP']),
    S('SURGMIN', 'Surgeon fee — minor surgery', 'OT', 'PROCEDURE', 6000, ['IP']), S('LABOUR', 'Labour room charges', 'OT', 'PROCEDURE', 5000, ['IP']),
    S('NDEL', 'Obstetrician fee — normal delivery', 'OT', 'PROCEDURE', 8000, ['IP']),
    S('O2', 'Oxygen (per hour)', 'NURSING_SERVICE', 'SERVICE', 80, ['IP'], { unit: 'hour' }), S('MON', 'Cardiac monitor (per day)', 'NURSING_SERVICE', 'SERVICE', 600, ['IP'], { unit: 'day' }),
    S('PUMP', 'Infusion pump (per day)', 'NURSING_SERVICE', 'SERVICE', 300, ['IP'], { unit: 'day' }),
    S('ADM', 'Admission & registration charges', 'OTHER', 'SERVICE', 500, ['IP'], { nonPayable: true }), S('MRD', 'Medical records (MRD) charges', 'OTHER', 'SERVICE', 200, ['IP'], { nonPayable: true }),
    S('ATTD', 'Attender diet (per day)', 'OTHER', 'SERVICE', 250, ['IP'], { unit: 'day', nonPayable: true }), S('AMB', 'Ambulance — local', 'OTHER', 'SERVICE', 1000, ['OP', 'IP'])
  ];
  const svc = Object.fromEntries(services.map((s) => [s.code, s]));

  const clinicalSettings = {
    op: { defaultFollowUpDays: 7, emergencyFee: 600, skipPlaces: 3, maxSkips: 2, displayRefreshSec: 10, avgConsultMin: 8 },
    ip: {
      checkoutHour: 12, lowDepositMargin: 3000,
      bedCategories: {
        GENERAL: { label: 'General ward', rate: 800, nursing: 300, advance: 5000 },
        SEMI_PRIVATE: { label: 'Semi-private', rate: 1500, nursing: 400, advance: 10000 },
        PRIVATE: { label: 'Private room', rate: 2800, nursing: 500, advance: 15000 },
        ICU: { label: 'ICU', rate: 6000, nursing: 1200, advance: 25000 }
      }
    },
    cashier: { openingFloat: 2000, varianceTolerance: 100 },
    tpas: [{ id: 'TPA-01', name: 'Medi Assist India TPA', phone: '1800 425 9449' }, { id: 'TPA-02', name: 'Vidal Health TPA', phone: '1800 425 4033' },
      { id: 'TPA-03', name: 'Paramount Health Services TPA', phone: '1800 22 6655' }, { id: 'TPA-04', name: 'Health India Insurance TPA', phone: '1800 22 4566' }],
    insurers: ['Star Health & Allied Insurance', 'HDFC ERGO General Insurance', 'The New India Assurance', 'ICICI Lombard General Insurance', 'Niva Bupa Health Insurance', 'Care Health Insurance'],
    corporates: ['Ashok Leyland — Hosur Unit', 'TVS Motor Company — Hosur', 'Titan Company — Hosur'],
    receiptFooter: 'Thank you for choosing Nallam Hospital. Wishing you good health.'
  };
  const CAT = clinicalSettings.ip.bedCategories;

  const wardDefs = [
    ['WRD-01', 'General Ward — Male', 'GENERAL', 'Ground floor', 'GM', 8], ['WRD-02', 'General Ward — Female', 'GENERAL', 'Ground floor', 'GF', 8],
    ['WRD-03', 'Semi-private Rooms', 'SEMI_PRIVATE', 'First floor', 'SP', 8], ['WRD-04', 'Private Rooms', 'PRIVATE', 'First floor', 'PR', 5], ['WRD-05', 'Intensive Care Unit', 'ICU', 'Second floor', 'ICU', 5]];
  const wards = wardDefs.map(([id, name, category, floor, code]) => ({ id, name, category, floor, code, active: true }));
  const beds = []; let bedSeq = 0;
  for (const [wardId, , category, , code, n] of wardDefs) for (let i = 1; i <= n; i++) {
    const label = category === 'SEMI_PRIVATE' ? `SP-${100 + Math.ceil(i / 2)}${i % 2 ? 'A' : 'B'}` : category === 'PRIVATE' ? `PR-${200 + i}` : `${code}-${pad(i, 2)}`;
    beds.push({ id: 'BED-' + pad(++bedSeq, 3), wardId, code: label, category, state: 'READY', note: '', updatedAt: '2026-08-01T04:00:00.000Z', updatedBy: OWNER, active: true });
  }

  // ---------------- extra fictional patients ----------------
  const extra = [['Kumar Velu', 'M', 45], ['Saroja Mani', 'F', 63], ['Arjun Prakash', 'M', 6], ['Ganesh Murthy', 'M', 52], ['Priya Suresh', 'F', 32], ['Anand Rajan', 'M', 58],
    ['Meena Kumari', 'F', 41], ['Sekar Palani', 'M', 67], ['Harini Balaji', 'F', 4], ['Mohammed Riyaz', 'M', 35], ['Kalaivani Senthil', 'F', 29], ['Rajesh Gowda', 'M', 48],
    ['Deepa Narayanan', 'F', 38], ['Thirumalai Swamy', 'M', 72], ['Nandhini Arul', 'F', 26], ['Vijay Anand', 'M', 31], ['Sumathi Ravi', 'F', 55], ['Karthik Raja', 'M', 9],
    ['Bhavani Shankar', 'F', 44], ['Ravi Teja', 'M', 39], ['Jayanthi Krishnan', 'F', 60], ['Sathish Kumar', 'M', 27], ['Mary Joseph', 'F', 50], ['Dinesh Babu', 'M', 34],
    ['Lavanya Prabhu', 'F', 23], ['Chinnasamy Gounder', 'M', 69], ['Yamini Reddy', 'F', 7], ['Abdul Kareem', 'M', 57], ['Pushpa Latha', 'F', 46], ['Naveen Kumar', 'M', 12],
    ['Sangeetha Mohan', 'F', 35], ['Elango Murugan', 'M', 64], ['Tamilselvi Raj', 'F', 30], ['Vignesh Shankar', 'M', 3], ['Kavya Srinivas', 'F', 28], ['Ponnusamy Velu', 'M', 74]];
  const areas = ['Bagalur Road', 'Rayakottai Road', 'Mathigiri', 'Shanthi Nagar', 'Alasanatham', 'Zuzuvadi', 'Denkanikottai Road', 'Thally Road', 'Sipcot Phase II', 'Krishnagiri Road'];
  const groups = ['O+', 'B+', 'A+', 'AB+', 'O-', 'A-'];
  extra.forEach(([name, gender, age], j) => {
    const i = patients.length;
    const reg = new Date(Date.UTC(2026, 7 + (j % 3), 2 + (j % 26), 4, 15));
    patients.push({ id: 'PAT-' + pad(i + 1), uhid: 'NH-UH-' + pad(26101 + i * 37, 6), name, gender, age, dob: `${2026 - age}-${pad((j % 12) + 1, 2)}-${pad((j % 27) + 1, 2)}`,
      phone: '+91 9' + pad(randInt(100000000, 999999999), 9), altPhone: '', address: `${5 + j * 3}, ${areas[j % areas.length]}`, city: 'Hosur', pincode: '635109',
      guardianName: age < 18 ? `${pick(['Suresh', 'Lakshmi', 'Mohan', 'Revathi'])} (parent)` : age > 65 ? `${pick(['Senthil', 'Geetha', 'Arun'])} (son/daughter)` : '',
      bloodGroup: groups[j % groups.length], allergies: j % 7 === 3 ? 'Sulfa drugs' : j % 11 === 5 ? 'NSAIDs' : '', registeredAt: reg.toISOString(), registeredBy: RECEP, active: true });
  });
  const adults = patients.filter((p) => p.age >= 16); const kids = patients.filter((p) => p.age < 16);
  const women = adults.filter((p) => p.gender === 'F' && p.age < 50);

  // ---------------- clinical vocab ----------------
  const med = Object.fromEntries(medicines.map((m) => [m.id, m]));
  const perUnit = (m) => { const n = Number(String(m.packSize || '').match(/\d+/)?.[0]); return m.form === 'Tablet' || m.form === 'Capsule' ? (n || 10) : 1; };
  const rx = (id, dose, frequency, days, timing, route = 'Oral') => {
    const m = med[id]; const perDay = frequency.split('-').reduce((t, x) => t + (Number(x) || 0), 0) || 1;
    const qty = perUnit(m) > 1 ? Math.max(1, Math.ceil(perDay * days / perUnit(m))) : 1;
    return { medicineId: id, name: m.brandName, generic: m.genericName, dose, frequency, days, timing, route, qty, unit: m.unit, instructions: '' };
  };
  const OPDX = {
    'DEP-01': [['Fever with body ache for 3 days', 'Acute febrile illness', [['MED-0001', '1 tab', '1-1-1', 3, 'After food']], ['CBC', 'NS1']],
      ['Cough and cold for 4 days', 'Upper respiratory tract infection', [['MED-0004', '1 tab', '1-0-0', 3, 'After food'], ['MED-0009', '1 tab', '0-0-1', 5, 'After food']], []],
      ['Burning micturition', 'Urinary tract infection', [['MED-0003', '1 tab', '1-0-1', 5, 'After food']], ['URINE']],
      ['Headache and giddiness', 'Essential hypertension', [['MED-0006', '1 tab', '1-0-0', 30, 'Morning'], ['MED-0007', '1 tab', '0-0-1', 30, 'Night']], ['ECG', 'RFT']],
      ['Tiredness, increased thirst', 'Type 2 diabetes mellitus', [['MED-0005', '1 tab', '1-0-1', 30, 'After food'], ['MED-0008', '1 tab', '0-0-1', 30, 'Night']], ['HBA1C', 'LIPID']],
      ['Loose stools for 2 days', 'Acute gastroenteritis', [['MED-0011', '1 cap', '1-0-0', 5, 'Before food'], ['MED-0010', '1 cap', '1-0-0', 10, 'After food']], []],
      ['Burning epigastric pain', 'Acid peptic disease', [['MED-0002', '1 tab', '1-0-0', 14, 'Before breakfast'], ['MED-0015', '10 ml', '1-1-1', 7, 'After food']], []]],
    'DEP-02': [['Missed periods, nausea', 'Intrauterine pregnancy — antenatal check-up', [['MED-0010', '1 cap', '1-0-0', 30, 'After food']], ['USG', 'CBC', 'GROUP']],
      ['Lower abdominal pain', 'Pelvic inflammatory disease', [['MED-0003', '1 tab', '1-0-1', 7, 'After food'], ['MED-0001', '1 tab', '1-0-1', 3, 'After food']], ['USG']],
      ['Irregular periods', 'Polycystic ovarian syndrome', [['MED-0005', '1 tab', '0-0-1', 30, 'After dinner']], ['USG']],
      ['White discharge and itching', 'Vulvovaginal candidiasis', [['MED-0024', 'Apply', '1-0-1', 7, 'Local application', 'Topical']], []]],
    'DEP-03': [['Low back pain for 2 weeks', 'Lumbar spondylosis', [['MED-0001', '1 tab', '1-0-1', 5, 'After food'], ['MED-0002', '1 tab', '1-0-0', 5, 'Before food']], ['XRAY']],
      ['Knee pain on walking', 'Osteoarthritis — both knees', [['MED-0001', '1 tab', '1-0-1', 7, 'After food'], ['MED-0010', '1 cap', '1-0-0', 30, 'After food']], ['XRAY']],
      ['Fall on outstretched hand, wrist pain', 'Undisplaced distal radius fracture', [['MED-0001', '1 tab', '1-1-1', 5, 'After food']], ['XRAY', 'POP']],
      ['Neck pain radiating to arm', 'Cervical spondylosis', [['MED-0001', '1 tab', '1-0-1', 5, 'After food']], ['XRAY']]],
    'DEP-04': [['Fever and cough in child', 'Viral upper respiratory infection', [['MED-0014', '5 ml', '1-1-1', 3, 'After food']], []],
      ['Ear pain, crying at night', 'Acute otitis media', [['MED-0014', '5 ml', '1-1-1', 3, 'After food'], ['MED-0027', '2 drops', '1-1-1', 5, 'Ear', 'Topical']], []],
      ['Loose stools and vomiting', 'Acute gastroenteritis — mild dehydration', [['MED-0014', '5 ml', '1-0-1', 2, 'After food']], []],
      ['Cough with wheeze', 'Reactive airway disease', [['MED-0013', '5 ml', '1-1-1', 5, 'After food']], ['NEB']]],
    'DEP-05': [['Swelling in right groin', 'Right inguinal hernia', [['MED-0001', '1 tab', 'SOS', 3, 'After food']], ['USG']],
      ['Wound on left foot', 'Diabetic foot ulcer', [['MED-0003', '1 tab', '1-0-1', 7, 'After food'], ['MED-0022', 'Apply', '1-0-1', 7, 'Local', 'Topical']], ['RBS', 'DRL']],
      ['Painless lump on back', 'Sebaceous cyst', [], []],
      ['Cut injury on hand', 'Lacerated wound — hand', [['MED-0003', '1 tab', '1-0-1', 5, 'After food'], ['MED-0001', '1 tab', '1-0-1', 3, 'After food']], ['SUT', 'DRS']]],
    'DEP-06': [['Ear discharge for a month', 'Chronic suppurative otitis media', [['MED-0027', '3 drops', '1-1-1', 7, 'Ear', 'Topical']], []],
      ['Throat pain and fever', 'Acute tonsillitis', [['MED-0012', '1 cap', '1-1-1', 5, 'After food'], ['MED-0001', '1 tab', '1-1-1', 3, 'After food']], []],
      ['Nasal block and sneezing', 'Allergic rhinitis', [['MED-0009', '1 tab', '0-0-1', 10, 'Night'], ['MED-0026', '2 drops', '1-0-1', 5, 'Nasal', 'Nasal']], []],
      ['Blocked ear', 'Impacted wax — right ear', [], ['WAX']]]
  };
  const ADVICE = ['Plenty of oral fluids. Review if fever persists beyond 3 days.', 'Low-salt diet, regular walking, review BP after one week.', 'Diabetic diet, check sugars before review.',
    'Rest, avoid lifting weights. Physiotherapy advised.', 'Complete the antibiotic course. Review with reports.', 'Keep the wound dry. Dressing on alternate days.'];

  // ---------------- ledgers ----------------
  const opVisits = []; const opBills = []; const receipts = []; const requests = [];
  const vSeq = { n: 0 }; const bSeq = { n: 0 }; const rSeq = { n: 0 };
  const receipt = (o) => {
    const p = { id: 'HR-2026-' + pad(++rSeq.n, 6), kind: 'PAYMENT', mode: 'CASH', amount: 0, tendered: null, change: null, reference: '', note: '', ...o, at: iso(o.at), businessDate: dayKey(o.at) };
    if (p.mode === 'UPI' && !p.reference) p.reference = 'UPI' + pad(randInt(100000, 999999), 6) + pad(randInt(100000, 999999), 6);
    if (p.mode === 'CARD' && !p.reference) p.reference = 'XXXX-' + pad(randInt(1000, 9999), 4);
    if (p.mode === 'CASH' && p.kind !== 'REFUND') { p.tendered = Math.ceil(p.amount / 100) * 100; p.change = r2(p.tendered - p.amount); }
    receipts.push(p); return p;
  };
  const payMode = () => { const x = rnd(); return x < 0.55 ? 'CASH' : x < 0.9 ? 'UPI' : 'CARD'; };
  const history = {}; // patientId -> visits
  const cashierFor = (d) => (hourOf(d) >= 14 || chance(0.3) ? BILL : RECEP);

  function makeOpBill(visit, kind, lines, at, userId, { discountPct = 0, status = 'PAID', mode = payMode() } = {}) {
    const p = priceServices(lines, discountPct);
    const b = { id: 'OB-2026-' + pad(++bSeq.n, 5), visitId: visit.id, patientId: visit.patientId, kind, at: iso(at), businessDate: dayKey(at), lines: p.lines, gross: p.gross,
      discountPct: p.discountPct, discount: p.discount, roundOff: p.roundOff, total: p.total, paid: 0, status: p.total === 0 ? 'PAID' : status, createdBy: userId, requestId: null, cancelled: null };
    if (b.status === 'PAID' && b.total > 0) { receipt({ kind: 'PAYMENT', source: 'OP', refType: 'OP_BILL', refId: b.id, patientId: b.patientId, mode, amount: b.total, at, userId }); b.paid = b.total; }
    opBills.push(b); return b;
  }

  function makeVisit(day, doc, tokenNo, at, { status = 'COMPLETED', patient, emergency = false, vitals = true, consult = true } = {}) {
    const dept = deptById[doc.departmentId];
    const pool = doc.departmentId === 'DEP-04' ? kids : doc.departmentId === 'DEP-02' ? women : adults;
    const p = patient || pick(chance(0.55) ? pool.slice(0, Math.max(6, Math.floor(pool.length / 2))) : pool);
    const hist = (history[p.id] || []).filter((v) => v.status !== 'CANCELLED');
    const pol = opVisitPolicy({ history: hist.map((v) => ({ doctorId: v.doctorId, date: v.businessDate, visitType: v.visitType })), doctor: doc, today: day, emergency, emergencyFee: clinicalSettings.op.emergencyFee });
    const [complaint, diagnosis, meds, inv] = pick(OPDX[doc.departmentId]);
    const userId = cashierFor(at);
    const v = { id: 'OPV-2026-' + pad(++vSeq.n, 5), patientId: p.id, doctorId: doc.id, departmentId: doc.departmentId, businessDate: day, at: iso(at), tokenNo, token: `${dept.code}-${pad(tokenNo, 3)}`,
      visitType: pol.visitType, priority: emergency ? 'EMERGENCY' : 'NORMAL', mlc: false, referredBy: chance(0.15) ? pick(['Dr. Selvaraj Clinic, Bagalur', 'PHC Mathigiri', 'Self (family doctor)']) : '', chiefComplaint: complaint,
      status, skips: 0, calledAt: null, vitals: null, consultation: null, billIds: [], createdBy: userId, cancel: null, admissionId: null };
    if (vitals) {
      const kid = p.age < 16; const bpS = kid ? null : randInt(108, 162); const w = kid ? randInt(12, 32) : randInt(48, 88); const h = kid ? randInt(90, 140) : randInt(150, 178);
      v.vitals = { bp: bpS ? `${bpS}/${randInt(68, 98)}` : '', pulse: randInt(70, 104), temp: (diagnosis.includes('febrile') || complaint.includes('Fever') ? randInt(1000, 1028) : randInt(976, 990)) / 10,
        spo2: randInt(95, 99), rr: randInt(14, 22), weight: w, height: h, bmi: bmi(w, h), grbs: diagnosis.includes('diabetes') ? randInt(150, 260) : null, by: NURSE, at: iso(addMin(at, randInt(4, 12))) };
    }
    const fee = makeOpBill(v, 'CONSULTATION', [{ serviceId: null, code: 'CONSULT', name: `Consultation — ${doc.name} (${{ NEW: 'New', REVISIT: 'Revisit', FOLLOW_UP: 'Free follow-up', EMERGENCY: 'Emergency' }[pol.visitType]})`, category: 'CONSULTATION', qty: 1, rate: pol.fee }], at, userId);
    v.billIds.push(fee.id);
    if (consult) {
      const start = addMin(at, randInt(15, 50));
      v.calledAt = iso(start);
      v.consultation = { startedAt: iso(start), completedAt: status === 'IN_CONSULTATION' ? null : iso(addMin(start, randInt(6, 14))), complaints: complaint,
        history: pick(['No known comorbidities.', 'Known hypertensive on irregular medication.', 'Similar complaints 6 months back.', 'No drug allergy reported.']),
        examination: pick(['Conscious, oriented. Vitals stable.', 'Throat congested. Chest clear.', 'Tenderness present. No neurovascular deficit.', 'Abdomen soft, mild tenderness.']),
        diagnosis: [diagnosis], prescription: meds.map((m) => rx(...m)), investigations: inv.map((c) => ({ serviceId: svc[c].id, code: c, name: svc[c].name, status: 'ORDERED' })),
        advice: pick(ADVICE), followUpDate: chance(0.6) ? addDays(day, pick([5, 7, 10, 14])) : '', doctorId: doc.id, addenda: [] };
      if (inv.length && status === 'COMPLETED') {
        const sb = makeOpBill(v, 'SERVICES', inv.map((c) => ({ serviceId: svc[c].id, code: c, name: svc[c].name, category: svc[c].category, qty: 1, rate: svc[c].rate })), addMin(start, 16), cashierFor(start));
        v.billIds.push(sb.id);
      }
    }
    (history[p.id] ||= []).push(v);
    opVisits.push(v); return v;
  }

  // history: 12 days before today (OP closed on Sundays)
  for (let d = 12; d >= 1; d--) {
    const day = addDays(TODAY, -d);
    for (const doc of doctors) {
      if (!doc.days.includes(weekday(day))) continue;
      const n = doc.id === 'DOC-01' ? randInt(5, 7) : randInt(2, 4);
      const [h, m] = doc.start.split(':').map(Number);
      for (let t = 1; t <= n; t++) {
        const at = addMin(ist(day, h, m), (t - 1) * randInt(6, 12) - 20);
        const x = rnd();
        const status = x < 0.03 ? 'NO_SHOW' : x < 0.045 ? 'CANCELLED' : 'COMPLETED';
        const v = makeVisit(day, doc, t, at, { status, emergency: chance(0.04), vitals: status === 'COMPLETED', consult: status === 'COMPLETED' });
        if (status === 'CANCELLED') {
          const b = opBills.find((x2) => x2.id === v.billIds[0]);
          v.cancel = { at: iso(addMin(at, 25)), by: RECEP, reason: pick(['Patient left — personal emergency', 'Doctor called for emergency surgery']) };
          if (b.paid > 0) { const pay = receipts.find((r) => r.refId === b.id); receipt({ kind: 'REFUND', source: 'OP', refType: 'OP_BILL', refId: b.id, patientId: b.patientId, mode: pay.mode, amount: b.paid, at: addMin(at, 30), userId: RECEP, note: 'Visit cancelled — fee refunded' }); b.status = 'REFUNDED'; }
          else b.status = 'CANCELLED';
          b.cancelled = v.cancel;
        }
      }
    }
  }
  // today: a live morning session
  const todayPlan = { 'DOC-01': [9, 4], 'DOC-02': [4, 2], 'DOC-03': [5, 2], 'DOC-04': [5, 1], 'DOC-05': [2, 1] }; // [completed, waiting]
  for (const [docId, [done, waiting]] of Object.entries(todayPlan)) {
    const doc = docById[docId]; const [h, m] = doc.start.split(':').map(Number);
    let t = 0;
    for (let i = 0; i < done; i++) { t++; makeVisit(TODAY, doc, t, addMin(ist(TODAY, h, m), (t - 1) * 9 - 15)); }
    t++; makeVisit(TODAY, doc, t, addMin(ist(TODAY, h, m), (t - 1) * 9 - 15), { status: 'IN_CONSULTATION' });
    for (let i = 0; i < waiting; i++) { t++; const vd = i < waiting - 1; makeVisit(TODAY, doc, t, addMin(ist(TODAY, h, m), (t - 1) * 9 - 10), { status: vd ? 'VITALS_DONE' : 'WAITING', vitals: vd, consult: false }); }
  }
  // an emergency child waiting with Dr. Ravichandran
  const em = makeVisit(TODAY, docById['DOC-01'], opVisits.filter((v) => v.businessDate === TODAY && v.doctorId === 'DOC-01').length + 1, ist(TODAY, 12, 55),
    { status: 'VITALS_DONE', patient: patients.find((p) => p.name === 'Arjun Prakash'), emergency: true, consult: false });
  em.chiefComplaint = 'High fever with one episode of seizure at home';
  // OP discount request pending (senior citizen, poor) — bill held
  {
    const doc = docById['DOC-03']; const p = patients.find((x) => x.age >= 60 && !(history[x.id] || []).some((v) => v.doctorId === 'DOC-03'));
    const t = opVisits.filter((v) => v.businessDate === TODAY && v.doctorId === doc.id).length + 1;
    const at = ist(TODAY, 12, 40);
    const v = makeVisit(TODAY, doc, t, at, { status: 'WAITING', patient: p, vitals: false, consult: false });
    const b = opBills.find((x) => x.id === v.billIds[0]);
    const ri = receipts.findIndex((r) => r.refId === b.id);
    if (ri < 0) throw new Error('discount demo visit must be a paid visit');
    receipts.splice(ri, 1); rSeq.n--;
    const pr = priceServices(b.lines, 50);
    Object.assign(b, { discountPct: 50, discount: pr.discount, roundOff: pr.roundOff, total: pr.total, paid: 0, status: 'DISCOUNT_PENDING' });
    const rq = { id: 'HRQ-2026-0002', type: 'DISCOUNT', source: 'OP', refType: 'OP_BILL', refId: b.id, patientId: p.id, pct: 50, base: b.gross, amount: b.discount,
      reason: 'Senior citizen, daily-wage family — requested concession by Dr. Harish', status: 'PENDING', requestedBy: RECEP, requestedAt: iso(addMin(at, 2)), decidedBy: null, decidedAt: null, decisionNote: '' };
    b.requestId = rq.id; requests.push(rq);
  }
  // an older, already-decided request (history)
  {
    const b = opBills.find((x) => x.kind === 'CONSULTATION' && x.businessDate === addDays(TODAY, -6) && x.total >= 400);
    requests.unshift({ id: 'HRQ-2026-0001', type: 'DISCOUNT', source: 'OP', refType: 'OP_BILL', refId: b.id, patientId: b.patientId, pct: 20, base: b.gross, amount: r2(b.gross * 0.2),
      reason: 'Hospital staff family member', status: 'REJECTED', requestedBy: RECEP, requestedAt: iso(addMin(b.at, 1)), decidedBy: OWNER, decidedAt: iso(addMin(b.at, 9)), decisionNote: 'Staff family concession is 10% — apply within the limit.' });
  }

  // ---------------- IP ----------------
  // pharmacy ledger helpers: issue only what the existing ledger can spare from that moment on (never makes a later balance negative)
  const used = {};
  const phMoves = movements.filter((m) => (m.locationId || PH) === PH).sort((a, b) => a.at.localeCompare(b.at));
  const byBatch = {}; phMoves.forEach((m) => { (byBatch[m.batchId] ||= []).push(m); });
  const spare = (batchId, at) => {
    let bal = 0; let min = null; const t = iso(at);
    for (const m of byBatch[batchId] || []) { if (min === null && m.at >= t) min = bal; bal += m.qtyIn - m.qtyOut; if (min !== null) min = Math.min(min, bal); }
    if (min === null) min = bal;
    return Math.max(0, min - (used[batchId] || 0));
  };
  const IP_CAP = {}; // never take more than ~35% of a medicine's current pharmacy stock for demo history
  const curBal = {}; phMoves.forEach((m) => { curBal[m.batchId] = (curBal[m.batchId] || 0) + m.qtyIn - m.qtyOut; });
  medicines.forEach((m) => { IP_CAP[m.id] = Math.floor(batches.filter((b) => b.medicineId === m.id).reduce((t, b) => t + Math.max(0, curBal[b.id] || 0), 0) * 0.35); });
  let movSeq = Math.max(...movements.map((m) => Number(m.id.slice(4))));
  const newMoves = [];
  const issueFefo = (medicineId, qty, at, ref, userId) => {
    const out = []; let need = Math.min(qty, IP_CAP[medicineId] || 0);
    const cands = batches.filter((b) => b.medicineId === medicineId && !b.quarantined && b.expiryDate > dayKey(at) && b.receivedAt <= iso(at)).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    for (const b of cands) {
      if (need <= 0) break;
      const q = Math.min(need, spare(b.id, at)); if (q <= 0) continue;
      used[b.id] = (used[b.id] || 0) + q; need -= q; IP_CAP[medicineId] -= q;
      const mv = { id: 'MOV-' + pad(++movSeq, 5), at: iso(at), medicineId, batchId: b.id, type: 'IP_ISSUE', qtyIn: 0, qtyOut: q, prevBalance: 0, newBalance: 0, reference: ref, userId, reason: `Ward indent ${ref}`, locationId: PH };
      newMoves.push(mv); out.push({ batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: q, mrp: b.mrp, gstPct: med[medicineId].gstPct ?? 12, movementId: mv.id });
    }
    return out;
  };

  const admissions = []; const stays = []; const charges = []; const indents = []; const ipBills = [];
  let aSeq = 0, stSeq = 0, cSeq = 0, iSeq = 0, ibSeq = 0, nSeq = 0;
  const charge = (adm, at, group, description, qty, rate, extraC = {}) => {
    const c = { id: 'IPC-' + pad(++cSeq, 6), admissionId: adm.id, at: iso(at), businessDate: dayKey(at), group, serviceId: null, description, qty, rate, amount: r2(qty * rate),
      nonPayable: false, source: 'MANUAL', refId: null, postedBy: BILL, reversed: null, ...extraC };
    charges.push(c); return c;
  };
  const chargeSvc = (adm, at, code, qty = 1, by = BILL, source = 'MANUAL') => { const s = svc[code]; return charge(adm, at, s.group, s.name, qty, s.rate, { serviceId: s.id, nonPayable: s.nonPayable, postedBy: by, source }); };
  const note = (adm, at, kind, by, text, vitals = null) => { adm.notes.push({ id: 'NTE-' + pad(++nSeq, 5), at: iso(at), kind, by, text, vitals }); };
  const bedFreeAt = {}; beds.forEach((b) => { bedFreeAt[b.id] = '0000'; });
  const freeBed = (category, at, excludeWard) => beds.find((b) => b.category === category && bedFreeAt[b.id] <= iso(at) && b.wardId !== excludeWard && b.id !== 'BED-007');

  const IPDX = [
    ['DEP-01', 'Dengue fever without warning signs', 'GENERAL', [3, 5], ['CBC', 'NS1', 'LFT'], null],
    ['DEP-01', 'Community-acquired pneumonia', 'SEMI_PRIVATE', [4, 6], ['CBC', 'XRAY', 'RFT'], null],
    ['DEP-01', 'Diabetic ketoacidosis', 'ICU', [4, 6], ['RBS', 'ELEC', 'RFT', 'URINE'], 'GENERAL'],
    ['DEP-01', 'Acute gastroenteritis with moderate dehydration', 'GENERAL', [2, 3], ['CBC', 'ELEC'], null],
    ['DEP-01', 'Hypertensive urgency', 'ICU', [3, 4], ['ECG', 'RFT', 'ELEC'], 'SEMI_PRIVATE'],
    ['DEP-02', 'Term pregnancy — normal vaginal delivery', 'SEMI_PRIVATE', [2, 3], ['CBC', 'GROUP', 'USG'], null, ['LABOUR', 'NDEL']],
    ['DEP-02', 'Term pregnancy — normal vaginal delivery', 'PRIVATE', [2, 3], ['CBC', 'GROUP'], null, ['LABOUR', 'NDEL']],
    ['DEP-03', 'Fracture neck of femur — hemiarthroplasty', 'PRIVATE', [5, 7], ['CBC', 'XRAY', 'ECG', 'RFT'], null, ['OTMAJ', 'ANAES', 'SURGMAJ']],
    ['DEP-03', 'Distal radius fracture — closed reduction', 'GENERAL', [1, 2], ['XRAY', 'CBC'], null, ['OTMIN', 'SURGMIN', 'POP']],
    ['DEP-05', 'Acute appendicitis — laparoscopic appendicectomy', 'SEMI_PRIVATE', [3, 4], ['CBC', 'USG', 'RFT'], null, ['OTMAJ', 'ANAES', 'SURGMAJ']],
    ['DEP-05', 'Right inguinal hernia — mesh hernioplasty', 'GENERAL', [2, 3], ['CBC', 'ECG', 'RBS'], null, ['OTMAJ', 'ANAES', 'SURGMAJ']],
    ['DEP-05', 'Cellulitis left leg', 'GENERAL', [4, 6], ['CBC', 'RBS'], null, ['DRL']],
    ['DEP-04', 'Bronchiolitis', 'GENERAL', [2, 4], ['CBC', 'XRAY'], null, ['NEB']],
    ['DEP-06', 'Peritonsillar abscess — incision & drainage', 'GENERAL', [2, 3], ['CBC'], null, ['OTMIN', 'SURGMIN']]
  ];
  const INDENT_SETS = {
    GEN: [['MED-0031', 2, 3], ['MED-0017', 1, 2], ['MED-0018', 1, 1], ['MED-0029', 1, 1], ['MED-0028', 2, 4]],
    PAIN: [['MED-0021', 1, 2], ['MED-0020', 1, 2], ['MED-0001', 1, 1]],
    ORAL: [['MED-0002', 1, 1], ['MED-0001', 1, 1], ['MED-0003', 1, 1]],
    CONS: [['MED-0030', 2, 4], ['MED-0032', 1, 1], ['MED-0028', 2, 3]]
  };
  const relations = [['Husband', 'M'], ['Wife', 'F'], ['Son', 'M'], ['Daughter', 'F'], ['Father', 'M'], ['Mother', 'F'], ['Brother', 'M']];
  const attNames = { M: ['Senthil', 'Ravi', 'Arun', 'Mohan', 'Suresh', 'Karthik'], F: ['Lakshmi', 'Geetha', 'Revathi', 'Meena', 'Kavitha', 'Uma'] };
  const patientFreeAt = {};

  const startDay = addDays(TODAY, -20);
  const plan = [];
  for (let d = startDay; d <= TODAY; d = addDays(d, 1)) {
    const n = d === TODAY ? 3 : d >= addDays(TODAY, -5) ? randInt(4, 5) : d >= addDays(TODAY, -12) ? randInt(2, 3) : 1;
    for (let i = 0; i < n; i++) plan.push({ day: d, at: ist(d, randInt(8, 20), pick([0, 10, 20, 30, 40, 50])) });
  }
  plan.sort((a, b) => a.at - b.at);
  for (const pl of plan) {
    if (pl.at > NOW) continue;
    const dx = pl.day >= addDays(TODAY, -1) && chance(0.45) ? pick(IPDX.filter((x) => x[2] === 'ICU')) : pick(IPDX);
    const [deptId, diag, cat0, [l1, l2], invs, stepDown, procs = []] = dx;
    const doc = doctors.find((x) => x.departmentId === deptId);
    let cat = cat0;
    let bed = freeBed(cat, pl.at);
    if (!bed) { cat = cat0 === 'ICU' ? 'SEMI_PRIVATE' : 'GENERAL'; bed = freeBed(cat, pl.at); }
    if (!bed) continue;
    const pool = (deptId === 'DEP-04' ? kids : deptId === 'DEP-02' ? women : adults).filter((p) => (patientFreeAt[p.id] || '0000') <= iso(pl.at));
    if (!pool.length) continue;
    const p = pick(pool);
    const los = randInt(l1 + 1, l2 + 2);
    let dischargeAt = ist(addDays(pl.day, los), randInt(10, 15), pick([0, 15, 30, 45]));
    const current = dischargeAt > NOW;
    const payerRoll = rnd();
    const payerType = payerRoll < 0.28 ? 'INSURANCE' : payerRoll < 0.36 ? 'CORPORATE' : 'SELF';
    const [rel, rg] = pick(relations);
    const adm = {
      id: 'IPA-2026-' + pad(++aSeq), patientId: p.id, admittedAt: iso(pl.at), businessDate: dayKey(pl.at), admissionType: chance(0.35) ? 'EMERGENCY' : chance(0.5) ? 'FROM_OP' : 'PLANNED', opVisitId: null,
      doctorId: doc.id, departmentId: deptId, provisionalDiagnosis: diag, reason: diag, mlc: false,
      attender: { name: `${pick(attNames[rg])} ${p.name.split(' ').at(-1)}`, relation: rel, phone: '+91 9' + pad(randInt(100000000, 999999999), 9) },
      payer: { type: payerType, tpaId: null, insurer: '', corporate: '', policyNo: '', memberId: '', coPayPct: 0, preAuth: null, claim: null },
      status: current ? 'ADMITTED' : 'DISCHARGED', notes: [], clearances: { pharmacy: null, nursing: null }, discharge: null, finalBillId: null, createdBy: hourOf(pl.at) >= 14 ? BILL : RECEP, expectedDischarge: addDays(pl.day, los)
    };
    if (payerType === 'INSURANCE') {
      const tpa = pick(clinicalSettings.tpas);
      Object.assign(adm.payer, { tpaId: tpa.id, insurer: pick(clinicalSettings.insurers), policyNo: 'POL' + pad(randInt(1000000, 9999999), 7), memberId: 'M' + pad(randInt(10000, 99999), 5), coPayPct: pick([0, 0, 10, 20]) });
    }
    if (payerType === 'CORPORATE') Object.assign(adm.payer, { corporate: pick(clinicalSettings.corporates), memberId: 'EMP' + pad(randInt(10000, 99999), 5), coPayPct: 0 });
    patientFreeAt[p.id] = current ? '9999' : iso(addMin(dischargeAt, 60 * 24 * 3));
    adm._dAt = iso(dischargeAt);
    admissions.push(adm);
    // bed stays (ICU step-down after 1–2 days)
    const s1 = { id: 'BST-' + pad(++stSeq, 5), admissionId: adm.id, bedId: bed.id, category: cat, from: iso(pl.at), to: null, reason: 'Admission', by: adm.createdBy };
    stays.push(s1);
    let lastBed = bed;
    if (cat === 'ICU' && stepDown && los >= 3) {
      const tAt = ist(addDays(pl.day, randInt(1, 2)), randInt(10, 17), 0);
      const nb = tAt < NOW ? freeBed(stepDown, tAt) : null;
      if (nb) { s1.to = iso(tAt); bedFreeAt[bed.id] = iso(addMin(tAt, 90)); stays.push({ id: 'BST-' + pad(++stSeq, 5), admissionId: adm.id, bedId: nb.id, category: stepDown, from: iso(tAt), to: null, reason: 'Transfer: stepped down from ICU', by: NURSE }); lastBed = nb; }
    }
    bedFreeAt[lastBed.id] = current ? '9999' : iso(addMin(dischargeAt, 120));
    // payer approvals
    const advance = payerType === 'SELF' ? CAT[cat].advance : payerType === 'INSURANCE' ? Math.min(5000, CAT[cat].advance) : 0;
    // charges
    chargeSvc(adm, addMin(pl.at, 5), 'ADM', 1, adm.createdBy, 'ADMISSION');
    const endT = current ? NOW : dischargeAt;
    invs.forEach((c, k) => chargeSvc(adm, addMin(pl.at, 60 + k * 10), c, 1, NURSE));
    procs.forEach((c, k) => chargeSvc(adm, ist(addDays(pl.day, procs.length > 1 ? Math.min(1, los - 1) : 0), 11 + k, 0) < endT ? ist(addDays(pl.day, procs.length > 1 ? Math.min(1, los - 1) : 0), 11 + k, 0) : addMin(pl.at, 120), c, 1, BILL));
    if (cat === 'ICU') chargeSvc(adm, addMin(pl.at, 30), 'MON', Math.min(2, los), NURSE);
    if (cat === 'ICU' || diag.includes('pneumonia') || diag.includes('Bronchiolitis')) chargeSvc(adm, addMin(pl.at, 40), 'O2', randInt(6, 24), NURSE);
    if (cat === 'PRIVATE' && chance(0.6)) chargeSvc(adm, addMin(pl.at, 300), 'ATTD', Math.max(1, los - 1), BILL);
    // daily rounds + nursing notes + indents
    let dayIdx = 0;
    for (let d = pl.day; d <= dayKey(endT); d = addDays(d, 1), dayIdx++) {
      const roundAt = d === pl.day ? addMin(pl.at, 45) : ist(d, 9, randInt(0, 50));
      if (roundAt <= endT && !(d === dayKey(endT) && !current && d !== pl.day)) {
        note(adm, roundAt, 'ROUND', doc.userId || OWNER, dayIdx === 0 ? `Admitted with ${diag.toLowerCase()}. Plan: investigations, IV fluids, monitor vitals.` : pick(['Afebrile, tolerating orally. Continue same.', 'Improving. Reports reviewed. Continue IV antibiotics.', 'Vitals stable. Plan to mobilise.', 'Pain reduced. Wound healthy.']));
        charge(adm, roundAt, 'DOCTOR', `Consultant visit — ${doc.name}`, 1, doc.ipVisitFee, { postedBy: doc.userId || OWNER, source: 'ROUND' });
      }
      const nAt = d === pl.day ? addMin(pl.at, 30) : ist(d, 7, randInt(0, 40));
      if (nAt <= endT) note(adm, nAt, 'VITALS', NURSE, 'Vitals recorded.', { bp: `${randInt(110, 150)}/${randInt(70, 95)}`, pulse: randInt(72, 108), temp: randInt(978, 1012) / 10, spo2: randInt(94, 99), rr: randInt(14, 24) });
      // indent (once a day; items depend on the case)
      const indAt = d === pl.day ? addMin(pl.at, 50) : ist(d, 8, randInt(0, 50));
      if (indAt > endT || (!current && d === dayKey(endT) && d !== pl.day)) continue;
      const set = [...INDENT_SETS.GEN.slice(0, dayIdx === 0 ? 5 : 2), ...(procs.length ? INDENT_SETS.PAIN.slice(0, 2) : []), ...(dayIdx >= 2 ? INDENT_SETS.ORAL.slice(0, 2) : []), ...(dayIdx === 0 ? INDENT_SETS.CONS.slice(0, 2) : [])];
      const ind = { id: 'IND-2026-' + pad(++iSeq), admissionId: adm.id, patientId: p.id, bedId: (stays.filter((s) => s.admissionId === adm.id && s.from <= iso(indAt)).at(-1) || s1).bedId,
        raisedAt: iso(indAt), raisedBy: NURSE, priority: dayIdx === 0 && chance(0.4) ? 'STAT' : 'ROUTINE', status: 'ISSUED', items: [], issuedAt: iso(addMin(indAt, randInt(10, 35))), issuedBy: chance(0.5) ? STAFF : RAVI, note: '', returns: [] };
      for (const [mid, a, b] of set) {
        const qty = randInt(a, b);
        const issued = issueFefo(mid, qty, addMin(indAt, 20), ind.id, ind.issuedBy);
        const iq = issued.reduce((t, x) => t + x.qty, 0);
        ind.items.push({ medicineId: mid, qty, issuedQty: iq, batches: issued, returnedQty: 0 });
        issued.forEach((x) => charge(adm, ind.issuedAt, 'PHARMACY', `${med[mid].brandName} (${x.batchNo})`, x.qty, x.mrp, { source: 'INDENT', refId: ind.id, postedBy: ind.issuedBy, nonPayable: med[mid].category === 'Medical Consumables', medicineId: mid, batchId: x.batchId }));
      }
      const tot = ind.items.reduce((t, x) => t + x.issuedQty, 0);
      if (!tot) { iSeq--; continue; }
      ind.status = ind.items.every((x) => x.issuedQty >= x.qty) ? 'ISSUED' : 'PARTIAL';
      indents.push(ind);
    }
    // deposits
    if (advance) receipt({ kind: 'DEPOSIT', source: 'IP', refType: 'IP_ADMISSION', refId: adm.id, patientId: p.id, mode: chance(0.5) ? 'UPI' : payMode(), amount: advance, at: addMin(pl.at, 15), userId: adm.createdBy, note: 'Advance at admission' });
    if (payerType === 'SELF' && los >= 3 && (!current || dayKey(NOW) > addDays(pl.day, 1))) receipt({ kind: 'DEPOSIT', source: 'IP', refType: 'IP_ADMISSION', refId: adm.id, patientId: p.id, mode: payMode(), amount: cat === 'ICU' ? 25000 : pick([5000, 10000, 10000]), at: ist(addDays(pl.day, Math.min(2, Math.max(1, dayIndexNow(pl.day)))), 11, 30), userId: BILL, note: 'Additional deposit' });
  }

  // ---- totals helper (same rules as the app) ----
  const catMap = CAT;
  const runningLines = (adm, upTo, final) => {
    const st = stays.filter((s) => s.admissionId === adm.id);
    const plan2 = bedDayPlan(st, upTo, { checkoutHour: clinicalSettings.ip.checkoutHour, final, dayKey, hourOf });
    const bedLines = bedChargeLines(plan2, catMap).map((l) => ({ ...l, nonPayable: false }));
    const ch = charges.filter((c) => c.admissionId === adm.id && !c.reversed && c.at <= iso(upTo)).map((c) => ({ group: c.group, description: c.description, qty: c.qty, rate: c.rate, amount: c.amount, nonPayable: c.nonPayable, at: c.at, chargeId: c.id }));
    return [...bedLines, ...ch];
  };
  const paidFor = (admId) => r2(receipts.filter((r) => r.refId === admId).reduce((t, r) => t + (r.kind === 'REFUND' ? -r.amount : r.amount), 0));

  // payer pre-auth / claims
  for (const adm of admissions) {
    if (adm.payer.type === 'SELF') continue;
    const end = adm.status === 'DISCHARGED' ? null : NOW;
    const est = r2(runningLines(adm, end || NOW, false).reduce((t, l) => t + l.amount, 0));
    if (adm.payer.type === 'CORPORATE') { adm.payer.preAuth = { stage: 'APPROVED', requested: 50000, approved: 50000, refNo: 'CL-' + pad(randInt(1000, 9999)), history: [{ at: adm.admittedAt, by: BILL, stage: 'APPROVED', amount: 50000, refNo: '', note: 'Corporate credit letter received' }] }; continue; }
    const requested = Math.round(est * 1.4 / 1000) * 1000 + 10000;
    const h = [{ at: iso(addMin(adm.admittedAt, 40)), by: BILL, stage: 'PREAUTH_PENDING', amount: requested, refNo: '', note: 'Pre-authorisation form sent with admission notes' }];
    adm.payer.preAuth = { stage: 'PREAUTH_PENDING', requested, approved: 0, refNo: '', history: h };
    const admitted = new Date(adm.admittedAt);
    if (adm.id === admissions.filter((a) => a.payer.type === 'INSURANCE' && a.status === 'ADMITTED').at(-1)?.id && NOW - admitted < 86400000 * 2) continue; // newest stays pending
    const approved = Math.round(requested * pick([0.7, 0.85, 1]) / 500) * 500;
    const ref = 'PA-' + pad(randInt(10000, 99999), 5);
    h.push({ at: iso(addMin(admitted, 300)), by: BILL, stage: 'APPROVED', amount: approved, refNo: ref, note: 'Initial approval received by e-mail' });
    Object.assign(adm.payer.preAuth, { stage: 'APPROVED', approved, refNo: ref });
  }
  const insCurrent = admissions.filter((a) => a.payer.type === 'INSURANCE' && a.status === 'ADMITTED' && a.payer.preAuth?.stage === 'APPROVED');
  if (insCurrent[0]) { const pa = insCurrent[0].payer.preAuth; pa.stage = 'ENHANCEMENT_PENDING'; pa.history.push({ at: iso(ist(TODAY, 10, 20)), by: BILL, stage: 'ENHANCEMENT_PENDING', amount: pa.approved + 15000, refNo: pa.refNo, note: 'Enhancement requested: extended stay, additional antibiotics' }); }

  // discharged admissions: discharge summary, clearances, final bill, settlement, claims
  const fills = { course: ['Treated with IV fluids, antibiotics and supportive care. Responded well.', 'Underwent the planned procedure under anaesthesia. Post-operative period uneventful.', 'Managed conservatively. Symptoms resolved; tolerating orally.'],
    condition: ['Stable, afebrile, ambulant', 'Stable, wound healthy', 'Stable, vitals within normal limits'] };
  for (const adm of admissions) {
    if (adm.status !== 'DISCHARGED') continue;
    const st = stays.filter((s) => s.admissionId === adm.id);
    const last = st.at(-1);
    const dAt = new Date(adm._dAt);
    const initAt = addMin(dAt, -240); const billAt = addMin(dAt, -60);
    last.to = iso(dAt);
    const doc = docById[adm.doctorId];
    const lastInd = indents.filter((i) => i.admissionId === adm.id).at(-1);
    if (lastInd && chance(0.35)) { // ward return of one unopened item
      const it = lastInd.items.find((x) => x.batches.length && x.issuedQty > 1);
      if (it) {
        const b0 = it.batches[0]; const q = 1; const rAt = addMin(initAt, 30);
        const mv = { id: 'MOV-' + pad(++movSeq, 5), at: iso(rAt), medicineId: it.medicineId, batchId: b0.batchId, type: 'IP_RETURN', qtyIn: q, qtyOut: 0, prevBalance: 0, newBalance: 0, reference: lastInd.id, userId: STAFF, reason: `Ward return against ${lastInd.id}`, locationId: PH };
        newMoves.push(mv); it.returnedQty = q;
        lastInd.returns.push({ id: 'IRT-' + pad(lastInd.returns.length + 1 + iSeq * 10, 5), at: iso(rAt), by: STAFF, reason: 'Unused at discharge', lines: [{ medicineId: it.medicineId, batchId: b0.batchId, qty: q, mrp: b0.mrp, movementId: mv.id }] });
        charge(adm, rAt, 'PHARMACY', `Return: ${med[it.medicineId].brandName} (${b0.batchNo})`, -q, b0.mrp, { source: 'INDENT_RETURN', refId: lastInd.id, postedBy: STAFF, nonPayable: med[it.medicineId].category === 'Medical Consumables', medicineId: it.medicineId, batchId: b0.batchId });
      }
    }
    chargeSvc(adm, addMin(billAt, -5), 'MRD', 1, BILL);
    adm.clearances = { pharmacy: { by: STAFF, at: iso(addMin(initAt, 45)), note: 'No pending indents' }, nursing: { by: NURSE, at: iso(addMin(initAt, 70)), note: 'IV line removed, belongings handed over' } };
    adm.discharge = { initiatedAt: iso(initAt), initiatedBy: doc.userId || OWNER, type: 'NORMAL', expectedAt: iso(dAt),
      summary: { status: 'FINAL', finalDiagnosis: adm.provisionalDiagnosis, presentingComplaints: adm.reason, course: pick(fills.course), procedures: charges.filter((c) => c.admissionId === adm.id && c.group === 'PROCEDURE').map((c) => c.description).join('; '),
        investigations: charges.filter((c) => c.admissionId === adm.id && c.group === 'INVESTIGATION').map((c) => c.description).join(', '), condition: pick(fills.condition),
        medicines: 'Tab. Dolo 650 1-1-1 × 3 days (after food); Tab. Pan 40 1-0-0 × 5 days (before food)', advice: pick(ADVICE), followUpDate: addDays(dayKey(dAt), 7),
        finalisedBy: doc.userId || OWNER, finalisedAt: iso(addMin(initAt, 90)) },
      dischargedAt: iso(dAt), dischargedBy: BILL };
    // final bill
    const lines = runningLines(adm, billAt, true);
    const gross = r2(lines.reduce((t, l) => t + l.amount, 0));
    const discountPct = adm.payer.type === 'SELF' && chance(0.25) ? pick([5, 10]) : 0;
    const discount = r2(gross * discountPct / 100); const before = r2(gross - discount); const net = Math.round(before);
    const nonPayable = r2(lines.filter((l) => l.nonPayable).reduce((t, l) => t + l.amount, 0));
    if (adm.payer.type === 'INSURANCE' && adm.payer.preAuth) {
      const pa = adm.payer.preAuth;
      if (pa.stage === 'PREAUTH_PENDING') { pa.stage = 'APPROVED'; pa.approved = Math.round(pa.requested * 0.8 / 500) * 500; pa.refNo = 'PA-' + pad(randInt(10000, 99999), 5); pa.history.push({ at: iso(addMin(adm.admittedAt, 400)), by: BILL, stage: 'APPROVED', amount: pa.approved, refNo: pa.refNo, note: 'Approval received' }); }
      const fin = Math.min(pa.approved, Math.round((net - nonPayable) * (1 - adm.payer.coPayPct / 100)));
      pa.history.push({ at: iso(addMin(billAt, 10)), by: BILL, stage: 'FINAL_APPROVED', amount: fin, refNo: pa.refNo, note: 'Final approval on discharge summary and final bill' });
      Object.assign(pa, { stage: 'FINAL_APPROVED', approved: fin });
    }
    const selfPay = adm.payer.type === 'SELF' || !adm.payer.preAuth;
    const split = payerSplit({ net, nonPayable, approved: adm.payer.preAuth?.approved || 0, coPayPct: adm.payer.coPayPct, selfPay });
    const deposits = paidFor(adm.id);
    const ib = { id: 'IB-2026-' + pad(++ibSeq), admissionId: adm.id, patientId: adm.patientId, finalisedAt: iso(billAt), finalisedBy: BILL, upTo: iso(billAt), lines, gross, discountPct, discount, roundOff: r2(net - before), net, nonPayable,
      payer: { type: adm.payer.type, ...split }, patientPays: split.patientPays, paidBefore: deposits, status: 'SETTLED', settledAt: iso(addMin(billAt, 20)), settledBy: BILL, requestId: null };
    const bal = r2(split.patientPays - deposits);
    if (bal > 0) receipt({ kind: 'PAYMENT', source: 'IP', refType: 'IP_ADMISSION', refId: adm.id, patientId: adm.patientId, mode: payMode(), amount: bal, at: addMin(billAt, 20), userId: BILL, note: `Final settlement ${ib.id}` });
    if (bal < 0) receipt({ kind: 'REFUND', source: 'IP', refType: 'IP_ADMISSION', refId: adm.id, patientId: adm.patientId, mode: chance(0.6) ? 'CASH' : 'UPI', amount: -bal, at: addMin(billAt, 20), userId: BILL, note: `Excess deposit refunded on ${ib.id}` });
    ipBills.push(ib); adm.finalBillId = ib.id;
    if (!selfPay) {
      const old = dayKey(dAt) < addDays(TODAY, -8);
      adm.payer.claim = { status: old ? 'SETTLED' : 'SUBMITTED', submittedAt: iso(addMin(dAt, 60 * 24)), amount: split.payerPays, settledAmount: old ? split.payerPays : 0, settledAt: old ? iso(addMin(dAt, 60 * 24 * 7)) : null, reference: old ? 'UTR' + pad(randInt(10000000, 99999999), 8) : '' };
    }
  }

  // currently admitted: today's workflow states
  const cur = admissions.filter((a) => a.status === 'ADMITTED').sort((a, b) => a.admittedAt.localeCompare(b.admittedAt));
  const self = cur.filter((a) => a.payer.type === 'SELF');
  // 1) discharge initiated, pharmacy cleared, nursing pending
  if (self[0]) { const a = self[0]; a.status = 'DISCHARGE_INITIATED'; a.discharge = { initiatedAt: iso(ist(TODAY, 10, 5)), initiatedBy: docById[a.doctorId].userId || OWNER, type: 'NORMAL', expectedAt: iso(ist(TODAY, 15, 0)), summary: { status: 'DRAFT', finalDiagnosis: a.provisionalDiagnosis, presentingComplaints: a.reason, course: fills.course[0], procedures: '', investigations: '', condition: fills.condition[0], medicines: '', advice: ADVICE[0], followUpDate: addDays(TODAY, 7), finalisedBy: null, finalisedAt: null }, dischargedAt: null, dischargedBy: null }; a.clearances.pharmacy = { by: STAFF, at: iso(ist(TODAY, 10, 40)), note: 'No pending indents' }; }
  // 2) discharge initiated, nothing cleared yet
  if (self[1]) { const a = self[1]; a.status = 'DISCHARGE_INITIATED'; a.discharge = { initiatedAt: iso(ist(TODAY, 11, 15)), initiatedBy: docById[a.doctorId].userId || OWNER, type: 'NORMAL', expectedAt: iso(ist(TODAY, 17, 0)), summary: null, dischargedAt: null, dischargedBy: null }; }
  // 3) newest self-pay admission has a small deposit → low-deposit alert
  const low = self.at(-1);
  if (low && low !== self[0] && low !== self[1]) { receipts.filter((r) => r.refId === low.id && r.kind === 'DEPOSIT').forEach((r) => { r.amount = 2000; if (r.mode === 'CASH') { r.tendered = 2000; r.change = 0; } }); }
  // 4) today's raised indents awaiting pharmacy
  const pend = [cur.find((a) => a.payer.type !== 'SELF' && a.status === 'ADMITTED'), cur.filter((a) => a.status === 'ADMITTED').at(-2)].filter(Boolean);
  pend.forEach((a, k) => {
    const lastStay = stays.filter((s) => s.admissionId === a.id).at(-1);
    indents.push({ id: 'IND-2026-' + pad(++iSeq), admissionId: a.id, patientId: a.patientId, bedId: lastStay.bedId, raisedAt: iso(ist(TODAY, 12, 50 + k * 5)), raisedBy: NURSE, priority: k === 0 ? 'STAT' : 'ROUTINE',
      status: 'RAISED', items: (k === 0 ? [['MED-0017', 2], ['MED-0031', 2], ['MED-0020', 2]] : [['MED-0002', 1], ['MED-0001', 1]]).map(([medicineId, qty]) => ({ medicineId, qty, issuedQty: 0, batches: [], returnedQty: 0 })),
      issuedAt: null, issuedBy: null, note: k === 0 ? 'Patient spiked fever — start IV antibiotic' : '', returns: [] });
  });
  // bed states: cleaning after recent discharges, one blocked, one reserved
  const occupied = new Set(stays.filter((s) => !s.to && admissions.find((a) => a.id === s.admissionId).status !== 'DISCHARGED').map((s) => s.bedId));
  beds.forEach((b) => { if (!occupied.has(b.id) && bedFreeAt[b.id] > iso(NOW) && bedFreeAt[b.id] !== '9999') { b.state = 'CLEANING'; b.updatedAt = iso(addMin(NOW, -60)); b.updatedBy = NURSE; } });
  const blk = beds.find((b) => b.id === 'BED-007'); Object.assign(blk, { state: 'BLOCKED', note: 'Bed motor repair — service engineer visiting', updatedAt: iso(ist(addDays(TODAY, -2), 16, 0)), updatedBy: NURSE });
  const resv = beds.find((b) => b.category === 'ICU' && !occupied.has(b.id) && b.state === 'READY');
  if (resv) Object.assign(resv, { state: 'RESERVED', note: 'Reserved for post-op case (hernioplasty, 3 PM)', updatedAt: iso(ist(TODAY, 9, 30)), updatedBy: NURSE });
  const recentFree = beds.filter((b) => !occupied.has(b.id) && b.state === 'READY').slice(0, 2);
  recentFree.forEach((b) => { b.state = 'CLEANING'; b.updatedAt = iso(ist(TODAY, 11, 50)); b.updatedBy = NURSE; });

  admissions.forEach((a) => { delete a._dAt; });

  // ---- merge pharmacy movements and recompute stored running balances (ledger order) ----
  movements.push(...newMoves);
  movements.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const run = {};
  movements.forEach((m) => { const k = m.batchId + '|' + (m.locationId || PH); const prev = run[k] || 0; m.prevBalance = prev; m.newBalance = prev + m.qtyIn - m.qtyOut; run[k] = m.newBalance; if (m.newBalance < 0) throw new Error('negative stock after IP issue ' + m.id); });

  // ---------------- hospital cash closings (OP + IP receipts) ----------------
  const closings = [];
  const keys = [...new Set(receipts.map((r) => r.businessDate + '|' + r.userId))].sort();
  for (const k of keys) {
    const [date, cashier] = k.split('|');
    if (date >= TODAY) continue;
    const tx = receipts.filter((r) => r.businessDate === date && r.userId === cashier);
    const by = (m) => r2(tx.filter((r) => r.mode === m).reduce((t, r) => t + (r.kind === 'REFUND' ? -r.amount : r.amount), 0));
    const expected = { CASH: r2(clinicalSettings.cashier.openingFloat + by('CASH')), UPI: by('UPI'), CARD: by('CARD'), OTHER: by('OTHER') };
    const variance = chance(0.07) ? pick([-50, -100, 20]) : 0;
    const actual = { ...expected, CASH: r2(expected.CASH + variance) };
    const recent = date >= addDays(TODAY, -2);
    const at = ist(date, cashier === BILL ? 21 : 18, randInt(5, 50));
    closings.push({ id: 'HCL-2026-' + pad(closings.length + 1), businessDate: date, cashierId: cashier, submittedAt: iso(at), openingFloat: clinicalSettings.cashier.openingFloat, expected, actual,
      difference: r2(Object.values(actual).reduce((t, v) => t + v, 0) - Object.values(expected).reduce((t, v) => t + v, 0)), cashDifference: variance,
      totals: { receipts: tx.filter((r) => r.kind !== 'REFUND').length, collected: r2(tx.filter((r) => r.kind !== 'REFUND').reduce((t, r) => t + r.amount, 0)), refunds: r2(tx.filter((r) => r.kind === 'REFUND').reduce((t, r) => t + r.amount, 0)),
        op: r2(tx.filter((r) => r.source === 'OP' && r.kind !== 'REFUND').reduce((t, r) => t + r.amount, 0)), deposits: r2(tx.filter((r) => r.kind === 'DEPOSIT').reduce((t, r) => t + r.amount, 0)),
        settlements: r2(tx.filter((r) => r.source === 'IP' && r.kind === 'PAYMENT').reduce((t, r) => t + r.amount, 0)) },
      remarks: variance ? 'Cash short — recounted, reported to supervisor.' : 'Counter balanced.', status: recent ? 'SUBMITTED' : 'VERIFIED', verifiedBy: recent ? null : OWNER, verifiedAt: recent ? null : iso(addMin(at, 720)) });
  }

  // ---------------- notifications & audit ----------------
  const pushN = (o) => N.push({ id: '', readBy: [], status: 'OPEN', performedBy: null, assignedTo: null, ...o });
  const hrq = requests.find((r) => r.status === 'PENDING');
  pushN({ type: 'HOSPITAL_DISCOUNT_REQUEST', category: 'Discount Approval', severity: 'critical', title: `Approve ${hrq.pct}% OP discount`, message: `${patients.find((p) => p.id === hrq.patientId).name}: ₹${hrq.amount} off ₹${hrq.base}. Reason: ${hrq.reason}`,
    refType: 'HOSP_REQUEST', refId: hrq.id, createdAt: hrq.requestedAt, targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER, performedBy: RECEP });
  indents.filter((i) => i.status === 'RAISED').forEach((i) => pushN({ type: 'IP_INDENT_RAISED', category: 'Ward Indent', severity: i.priority === 'STAT' ? 'critical' : 'info', title: `${i.priority === 'STAT' ? 'STAT ' : ''}ward indent ${i.id}`,
    message: `${i.items.length} item(s) for ${patients.find((p) => p.id === i.patientId).name} · bed ${beds.find((b) => b.id === i.bedId).code}`, refType: 'IP_INDENT', refId: i.id, createdAt: i.raisedAt, targetRoles: ['PHARMACY_STAFF'], performedBy: NURSE }));
  admissions.filter((a) => a.status === 'DISCHARGE_INITIATED').forEach((a) => pushN({ type: 'IP_DISCHARGE_INITIATED', category: 'Discharge', severity: 'warning', title: `Discharge initiated — ${a.id}`,
    message: `${patients.find((p) => p.id === a.patientId).name}: clearances and final bill pending.`, refType: 'IP_ADMISSION', refId: a.id, createdAt: a.discharge.initiatedAt, targetRoles: ['BILLING', 'NURSE', 'PHARMACY_STAFF'], performedBy: a.discharge.initiatedBy }));
  closings.filter((c) => c.status === 'SUBMITTED').forEach((c) => pushN({ type: 'HOSPITAL_CLOSING_SUBMITTED', category: 'Cash Closing', severity: c.cashDifference ? 'warning' : 'success', title: `Hospital cash closing — ${c.businessDate}`,
    message: `${users.find((u) => u.id === c.cashierId).name} closed the OP/IP counter. Cash ${c.cashDifference ? 'difference ₹' + c.cashDifference : 'matched'}.`, refType: 'HOSP_CLOSING', refId: c.id, createdAt: c.submittedAt, targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER, performedBy: c.cashierId }));
  N.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach((n, i) => { n.id = 'NTF-' + pad(N.length - i); });

  const log = (at, userId, action, entity, entityId, details) => audit.push({ id: '', at, userId, action, entity, entityId, details });
  opVisits.filter((v) => v.businessDate >= addDays(TODAY, -3)).forEach((v) => log(v.at, v.createdBy, 'OP_VISIT_CREATED', 'OP_VISIT', v.id, `${v.token} · ${v.visitType}`));
  admissions.forEach((a) => { log(a.admittedAt, a.createdBy, 'IP_ADMITTED', 'IP_ADMISSION', a.id, a.provisionalDiagnosis); if (a.discharge?.dischargedAt) log(a.discharge.dischargedAt, BILL, 'IP_DISCHARGED', 'IP_ADMISSION', a.id, a.finalBillId); });
  ipBills.forEach((b) => log(b.finalisedAt, b.finalisedBy, 'IP_FINAL_BILL', 'IP_BILL', b.id, `Net ₹${b.net}, patient ₹${b.patientPays}`));
  audit.sort((a, b) => a.at.localeCompare(b.at)).forEach((a, i) => { a.id = 'AUD-' + pad(i + 1, 5); });

  return {
    'clinical-settings.json': clinicalSettings, 'departments.json': departments, 'doctors.json': doctors, 'service-tariff.json': services, 'wards.json': wards, 'beds.json': beds,
    'op-visits.json': opVisits, 'op-bills.json': opBills, 'ip-admissions.json': admissions, 'ip-bed-stays.json': stays, 'ip-charges.json': charges, 'ip-indents.json': indents, 'ip-bills.json': ipBills,
    'hospital-receipts.json': receipts, 'hospital-requests.json': requests, 'hospital-closings.json': closings
  };
}
