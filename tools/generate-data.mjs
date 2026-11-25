// Seed-data generator for the Nallam Hospital HMS prototype.
// Produces the JSON files in /data. All records are FICTIONAL demonstration data.
// Usage: node tools/generate-data.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { priceBill, lineRefund, r2 } from '../assets/js/pricing.js';
import { buildClinical } from './generate-clinical.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (name, data) => {
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data', name), JSON.stringify(data, null, 2));
  console.log('wrote', name, Array.isArray(data) ? data.length + ' records' : '');
};

// deterministic PRNG
let seed = 20261123;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pad = (n, l = 4) => String(n).padStart(l, '0');
const iso = (d) => new Date(d).toISOString();

// ---------------- users / roles ----------------
const users = [
  { id: 'USR-0001', username: 'pharmacy', password: 'demo123', name: 'Kavitha Selvam', role: 'PHARMACY_STAFF', designation: 'Pharmacist', email: '', phone: '+91 90000 11111', active: true, createdAt: '2026-07-20T10:00:00.000Z' },
  { id: 'USR-0002', username: 'store', password: 'demo123', name: 'Arun Prakash', role: 'STORE_INCHARGE', designation: 'Store Incharge', email: '', phone: '+91 90000 22222', active: true, createdAt: '2026-07-20T10:00:00.000Z' },
  { id: 'USR-0003', username: 'owner', password: 'demo123', name: 'Dr. Meenakshi Sundaram', role: 'SUPER_ADMIN', designation: 'Hospital Owner / Director', email: '', phone: '+91 90000 33333', active: true, createdAt: '2026-07-20T10:00:00.000Z' },
  { id: 'USR-0004', username: 'ravi', password: 'demo123', name: 'Ravi Kumar', role: 'PHARMACY_STAFF', designation: 'Pharmacy Assistant', email: '', phone: '+91 90000 44444', active: true, createdAt: '2026-07-20T10:00:00.000Z' },
  { id: 'USR-0005', username: 'reception', password: 'demo123', name: 'Divya Shankar', role: 'RECEPTION', designation: 'Front Office Executive', email: '', phone: '+91 90000 55555', active: true, createdAt: '2026-07-20T10:00:00.000Z' }
];
const STAFF = 'USR-0001', MGR = 'USR-0002', OWNER = 'USR-0003', RAVI = 'USR-0004', RECEP = 'USR-0005';
const PH = 'LOC-01', STORE = 'LOC-02';

// Roles follow the BRD role map (Super Admin + department roles). Only modules built so far carry permissions.
const VIEW_STOCK = ['inventory.view', 'batch.view', 'movement.view', 'medicine.view', 'supplier.view', 'grn.view', 'alerts.view', 'reports.view', 'dashboard.view'];
const PHARMACY_PERMS = [...VIEW_STOCK, 'adjustment.view', 'adjustment.request', 'stockcount.do', 'labels.print', 'pharmacy.dashboard', 'pharmacy.bill', 'pharmacy.history',
  'pharmacy.payment.collect', 'pharmacy.return.request', 'pharmacy.cancel.request', 'pharmacy.closing', 'patient.view', 'patient.register', 'discount.request'];
const STORE_PERMS = [...VIEW_STOCK, 'grn.create', 'grn.verify', 'grn.post', 'grn.reject', 'batch.manage', 'adjustment.view', 'adjustment.request', 'adjustment.approve',
  'supplier.manage', 'medicine.manage', 'labels.print', 'store.transfer'];
const RECEPTION_PERMS = ['patient.view', 'patient.register', 'patient.edit', 'alerts.view'];
const OWNER_PERMS = [...new Set([...PHARMACY_PERMS, ...STORE_PERMS, ...RECEPTION_PERMS, 'grn.approve.exceptional', 'adjustment.approve.exceptional', 'alerts.all', 'audit.view', 'settings.manage',
  'pharmacy.return.approve', 'pharmacy.cancel', 'pharmacy.closing.all', 'pharmacy.closing.correct', 'pharmacy.closing.report', 'pharmacy.closing.verify', 'pharmacy.discount.owner',
  'pharmacy.refund.exceptional', 'pharmacy.batch.override', 'stockcount.review', 'network.manage', 'users.manage', 'discount.approve'])];
const roles = [
  { id: 'SUPER_ADMIN', name: 'Super Admin', description: 'Full access to all modules, discount approval above 10%, audit logs, reports and user accounts.', permissions: OWNER_PERMS },
  { id: 'RECEPTION', name: 'Reception', description: 'Patient registration, Patient ID and patient records.', permissions: RECEPTION_PERMS },
  { id: 'PHARMACY_STAFF', name: 'Pharmacy', description: 'Pharmacy stock and sales billing: bills, returns, daily stock count and day closing.', permissions: PHARMACY_PERMS },
  { id: 'STORE_INCHARGE', name: 'Store', description: 'Central store: supplier receipts, Store → Pharmacy transfers, stock corrections and masters.', permissions: STORE_PERMS }
];

// ---------------- masters ----------------
const categories = ['Analgesic', 'Antibiotic', 'Gastrointestinal', 'Antidiabetic', 'Cardiovascular', 'Respiratory', 'Vitamins & Supplements', 'Antiemetic', 'Dermatology', 'Ophthalmic / ENT', 'IV Fluids', 'Medical Consumables'];

// [brand, generic, composition, strength, form, manufacturer, category, unit, packSize, purchaseUnit, conversion, hsn, gst, reorder, min, storage, ptr, mrp]
const M = [
  ['Dolo 650', 'Paracetamol', 'Paracetamol IP 650 mg', '650 mg', 'Tablet', 'Micro Labs Ltd', 'Analgesic', 'Strip', '15 tablets/strip', 'Box (10 strips)', 10, '30049099', 12, 60, 30, 'Store below 30°C', 24.5, 33.6],
  ['Pan 40', 'Pantoprazole', 'Pantoprazole Sodium 40 mg', '40 mg', 'Tablet', 'Alkem Laboratories', 'Gastrointestinal', 'Strip', '15 tablets/strip', 'Box (10 strips)', 10, '30049099', 12, 50, 25, 'Store below 25°C, protect from moisture', 112, 160],
  ['Augmentin 625 Duo', 'Amoxicillin + Clavulanic Acid', 'Amoxicillin 500 mg + Clavulanic Acid 125 mg', '625 mg', 'Tablet', 'GSK Pharmaceuticals', 'Antibiotic', 'Strip', '10 tablets/strip', 'Box (5 strips)', 5, '30041030', 12, 30, 15, 'Store below 25°C', 168, 223.5],
  ['Azithral 500', 'Azithromycin', 'Azithromycin 500 mg', '500 mg', 'Tablet', 'Alembic Pharmaceuticals', 'Antibiotic', 'Strip', '5 tablets/strip', 'Box (10 strips)', 10, '30042019', 12, 30, 15, 'Store below 30°C', 86, 119.5],
  ['Glycomet 500', 'Metformin', 'Metformin Hydrochloride 500 mg', '500 mg', 'Tablet', 'USV Pvt Ltd', 'Antidiabetic', 'Strip', '20 tablets/strip', 'Box (10 strips)', 10, '30049099', 12, 50, 25, 'Store below 30°C', 21, 31],
  ['Telma 40', 'Telmisartan', 'Telmisartan 40 mg', '40 mg', 'Tablet', 'Glenmark Pharmaceuticals', 'Cardiovascular', 'Strip', '15 tablets/strip', 'Box (10 strips)', 10, '30049099', 12, 40, 20, 'Store below 30°C', 168, 239],
  ['Amlong 5', 'Amlodipine', 'Amlodipine Besylate 5 mg', '5 mg', 'Tablet', 'Micro Labs Ltd', 'Cardiovascular', 'Strip', '15 tablets/strip', 'Box (10 strips)', 10, '30049099', 12, 40, 20, 'Store below 30°C', 38, 54],
  ['Atorva 10', 'Atorvastatin', 'Atorvastatin Calcium 10 mg', '10 mg', 'Tablet', 'Zydus Lifesciences', 'Cardiovascular', 'Strip', '15 tablets/strip', 'Box (10 strips)', 10, '30049099', 12, 30, 15, 'Store below 25°C', 92, 130],
  ['Montair LC', 'Montelukast + Levocetirizine', 'Montelukast 10 mg + Levocetirizine 5 mg', '10 mg / 5 mg', 'Tablet', 'Cipla Ltd', 'Respiratory', 'Strip', '15 tablets/strip', 'Box (10 strips)', 10, '30049099', 12, 30, 15, 'Store below 30°C', 182, 259],
  ['Becosules', 'Vitamin B-Complex with Vitamin C', 'B-Complex + Vitamin C', 'Multi', 'Capsule', 'Pfizer Ltd', 'Vitamins & Supplements', 'Strip', '20 capsules/strip', 'Box (10 strips)', 10, '30045090', 12, 40, 20, 'Store in a cool dry place', 34, 49],
  ['Omez 20', 'Omeprazole', 'Omeprazole 20 mg', '20 mg', 'Capsule', "Dr. Reddy's Laboratories", 'Gastrointestinal', 'Strip', '20 capsules/strip', 'Box (10 strips)', 10, '30049099', 12, 40, 20, 'Store below 25°C', 58, 82],
  ['Mox 500', 'Amoxicillin', 'Amoxicillin Trihydrate 500 mg', '500 mg', 'Capsule', 'Sun Pharma', 'Antibiotic', 'Strip', '10 capsules/strip', 'Box (10 strips)', 10, '30041010', 12, 30, 15, 'Store below 25°C', 62, 88],
  ['Ascoril LS Syrup', 'Ambroxol + Levosalbutamol + Guaifenesin', 'Ambroxol 30 mg + Levosalbutamol 1 mg + Guaifenesin 50 mg / 5 ml', '100 ml', 'Syrup', 'Glenmark Pharmaceuticals', 'Respiratory', 'Bottle', '100 ml bottle', 'Carton (20 bottles)', 20, '30049099', 12, 25, 10, 'Store below 30°C, do not freeze', 92, 128],
  ['Calpol 250 Suspension', 'Paracetamol', 'Paracetamol 250 mg / 5 ml', '250 mg/5 ml', 'Syrup', 'GSK Pharmaceuticals', 'Analgesic', 'Bottle', '60 ml bottle', 'Carton (20 bottles)', 20, '30049099', 12, 20, 10, 'Store below 30°C', 42, 58],
  ['Digene Gel Mint', 'Antacid (Aluminium + Magnesium Hydroxide + Simethicone)', 'Dried Al(OH)3 + Mg(OH)2 + Simethicone', '200 ml', 'Syrup', 'Abbott India', 'Gastrointestinal', 'Bottle', '200 ml bottle', 'Carton (24 bottles)', 24, '30049099', 12, 20, 10, 'Store below 30°C', 128, 178],
  ['Benadryl Cough Formula', 'Diphenhydramine + Ammonium Chloride', 'Diphenhydramine 14.08 mg + Ammonium Chloride 138 mg / 5 ml', '150 ml', 'Syrup', 'Johnson & Johnson', 'Respiratory', 'Bottle', '150 ml bottle', 'Carton (24 bottles)', 24, '30049099', 12, 15, 8, 'Store below 30°C', 118, 165],
  ['Monocef 1g Injection', 'Ceftriaxone', 'Ceftriaxone Sodium 1 g', '1 g', 'Injection', 'Aristo Pharmaceuticals', 'Antibiotic', 'Vial', '1 vial + diluent', 'Box (25 vials)', 25, '30042013', 12, 40, 20, 'Store below 25°C, protect from light', 48, 68],
  ['Pantocid IV 40', 'Pantoprazole (IV)', 'Pantoprazole Sodium 40 mg for injection', '40 mg', 'Injection', 'Sun Pharma', 'Gastrointestinal', 'Vial', '1 vial', 'Box (25 vials)', 25, '30049099', 12, 30, 15, 'Store below 25°C', 39, 56],
  ['Human Mixtard 30/70', 'Insulin (Biphasic Isophane)', 'Human Insulin 30% Soluble + 70% Isophane, 40 IU/ml', '40 IU/ml, 10 ml', 'Injection', 'Novo Nordisk India', 'Antidiabetic', 'Vial', '10 ml vial', 'Box (10 vials)', 10, '30043110', 5, 15, 8, 'Refrigerate 2–8°C. Do not freeze', 136, 168],
  ['Emeset 4 Injection', 'Ondansetron', 'Ondansetron 2 mg/ml, 2 ml', '4 mg/2 ml', 'Injection', 'Cipla Ltd', 'Antiemetic', 'Ampoule', '2 ml ampoule', 'Box (50 ampoules)', 50, '30049099', 12, 50, 25, 'Store below 30°C, protect from light', 9.5, 14.2],
  ['Voveran 75 Injection', 'Diclofenac Sodium', 'Diclofenac Sodium 75 mg / 3 ml', '75 mg/3 ml', 'Injection', 'Novartis India', 'Analgesic', 'Ampoule', '3 ml ampoule', 'Box (50 ampoules)', 50, '30049099', 12, 40, 20, 'Store below 30°C, protect from light', 14, 19.8],
  ['Soframycin Skin Cream', 'Framycetin Sulphate', 'Framycetin Sulphate 1% w/w', '1% w/w, 30 g', 'Cream', 'Sanofi India', 'Dermatology', 'Tube', '30 g tube', 'Carton (20 tubes)', 20, '30049099', 12, 15, 8, 'Store below 25°C', 56, 79],
  ['Betnovate-N Cream', 'Betamethasone + Neomycin', 'Betamethasone 0.1% + Neomycin 0.5% w/w', '20 g', 'Cream', 'GSK Pharmaceuticals', 'Dermatology', 'Tube', '20 g tube', 'Carton (20 tubes)', 20, '30049099', 12, 15, 8, 'Store below 25°C', 28, 39.5],
  ['Candid Cream', 'Clotrimazole', 'Clotrimazole 1% w/w', '1% w/w, 15 g', 'Cream', 'Glenmark Pharmaceuticals', 'Dermatology', 'Tube', '15 g tube', 'Carton (20 tubes)', 20, '30049099', 12, 15, 8, 'Store below 30°C', 72, 101],
  ['Moxicip Eye Drops', 'Moxifloxacin', 'Moxifloxacin 0.5% w/v', '0.5%, 5 ml', 'Drops', 'Cipla Ltd', 'Ophthalmic / ENT', 'Bottle', '5 ml bottle', 'Carton (20 bottles)', 20, '30049099', 12, 15, 8, 'Store below 25°C. Discard 1 month after opening', 82, 115],
  ['Otrivin Nasal Drops', 'Xylometazoline', 'Xylometazoline 0.1% w/v', '0.1%, 10 ml', 'Drops', 'GSK Consumer Healthcare', 'Ophthalmic / ENT', 'Bottle', '10 ml bottle', 'Carton (20 bottles)', 20, '30049099', 12, 12, 6, 'Store below 30°C', 76, 106],
  ['Ciplox Eye/Ear Drops', 'Ciprofloxacin', 'Ciprofloxacin 0.3% w/v', '0.3%, 10 ml', 'Drops', 'Cipla Ltd', 'Ophthalmic / ENT', 'Bottle', '10 ml bottle', 'Carton (20 bottles)', 20, '30049099', 12, 15, 8, 'Store below 25°C', 14.5, 20.5],
  ['Dispovan Syringe 5 ml', 'Disposable Syringe with Needle', 'Sterile single-use syringe, 5 ml, 24G needle', '5 ml', 'Consumable', 'Hindustan Syringes & Medical Devices', 'Medical Consumables', 'Piece', '1 syringe', 'Box (100 pieces)', 100, '90183100', 12, 200, 100, 'Store in a clean dry place', 5.2, 9],
  ['Venflon IV Cannula 20G', 'IV Cannula', 'Sterile IV cannula with injection port, 20G', '20G', 'Consumable', 'BD India', 'Medical Consumables', 'Piece', '1 cannula', 'Box (50 pieces)', 50, '90183930', 12, 80, 40, 'Store in a clean dry place', 58, 145],
  ['Sterile Surgical Gloves 7.5', 'Latex Surgical Gloves', 'Sterile powder-free latex gloves, size 7.5', 'Size 7.5', 'Consumable', 'Kanam Latex Industries', 'Medical Consumables', 'Pair', '1 pair', 'Box (50 pairs)', 50, '40151100', 12, 100, 50, 'Store away from direct sunlight', 21, 38],
  ['Normal Saline 0.9% 500 ml', 'Sodium Chloride', 'Sodium Chloride 0.9% w/v IV infusion', '500 ml', 'IV Fluid', 'Baxter India', 'IV Fluids', 'Bottle', '500 ml FFS bottle', 'Carton (20 bottles)', 20, '30049099', 5, 60, 30, 'Store below 30°C', 24, 35],
  ['Absorbent Cotton Roll 500 g', 'Absorbent Cotton IP', 'Absorbent cotton wool IP', '500 g', 'Consumable', 'Jaycot Industries', 'Medical Consumables', 'Roll', '1 roll', 'Bundle (10 rolls)', 10, '30059090', 12, 10, 5, 'Store in a clean dry place', 118, 175]
];

const medicines = M.map((m, i) => ({
  id: 'MED-' + pad(i + 1), code: 'MED-' + pad(i + 1), brandName: m[0], genericName: m[1], composition: m[2], strength: m[3],
  form: m[4], manufacturer: m[5], category: m[6], unit: m[7], packSize: m[8], purchaseUnit: m[9], dispensingUnit: m[7],
  conversion: m[10], hsnCode: m[11], gstPct: m[12], reorderLevel: m[13], minStockLevel: m[14], storage: m[15],
  barcode: '8901' + pad(randInt(100000000, 999999999), 9), active: true, createdAt: '2026-07-15T10:00:00.000Z',
  refPtr: m[16], refMrp: m[17]
}));
// refPtr/refMrp are only used by the generator; they are stripped below (batch-level values only).

const suppliers = [
  { id: 'SUP-0001', code: 'SUP-0001', name: 'Sri Murugan Pharma Distributors', contactPerson: 'S. Senthil Kumar', phone: '+91 94430 10001', email: '', address: '14, Bagalur Road, Hosur, Krishnagiri Dt, Tamil Nadu 635109', gstNumber: '33AAKFS4821M1Z2', status: 'ACTIVE', remarks: 'Primary distributor for tablets and capsules. Delivers twice a week.' },
  { id: 'SUP-0002', code: 'SUP-0002', name: 'Krishna Medical Agencies', contactPerson: 'R. Gopinath', phone: '+91 94431 20002', email: '', address: '7/112, Gandhi Road, Krishnagiri, Tamil Nadu 635001', gstNumber: '33ABDPG7712K1Z9', status: 'ACTIVE', remarks: 'Injections and cold-chain items.' },
  { id: 'SUP-0003', code: 'SUP-0003', name: 'Lakshmi Surgicals & Consumables', contactPerson: 'Lakshmi Narayanan', phone: '+91 98450 30003', email: '', address: '221, Electronic City Phase 1, Bengaluru, Karnataka 560100', gstNumber: '29AAGFL5520D1Z4', status: 'ACTIVE', remarks: 'Surgical consumables, gloves, cannulas, syringes.' },
  { id: 'SUP-0004', code: 'SUP-0004', name: 'Sai Balaji Pharma', contactPerson: 'P. Venkatesh', phone: '+91 94860 40004', email: '', address: '3, Rayakottai Road, Hosur, Tamil Nadu 635109', gstNumber: '33BBTPV3319Q1Z1', status: 'ACTIVE', remarks: 'Syrups, creams and drops.' },
  { id: 'SUP-0005', code: 'SUP-0005', name: 'Kaveri Healthcare Distributors', contactPerson: 'M. Karthikeyan', phone: '+91 90030 50005', email: '', address: '56, Omalur Main Road, Salem, Tamil Nadu 636009', gstNumber: '33AAJFK9035H1Z7', status: 'ACTIVE', remarks: 'IV fluids and bulk items.' },
  { id: 'SUP-0006', code: 'SUP-0006', name: 'Annapoorna Medical Distributors', contactPerson: 'K. Annamalai', phone: '+91 94440 60006', email: '', address: '18, Anna Salai, Chennai, Tamil Nadu 600002', gstNumber: '33AAMFA2287C1Z3', status: 'INACTIVE', remarks: 'Inactive — credit terms under review.' }
];

const locations = [
  { id: 'LOC-01', name: 'Pharmacy', code: 'PHARM', type: 'PHARMACY', active: true, isDefault: false, description: 'Ground floor pharmacy counter — sells to patients' },
  { id: 'LOC-02', name: 'Central Store', code: 'STORE', type: 'STORE', active: true, isDefault: true, description: 'Receives all supplier deliveries and transfers stock to the pharmacy' },
  { id: 'LOC-03', name: 'Ward Sub-store (2nd Floor)', code: 'WARD2', type: 'SUB_STORE', active: false, isDefault: false, description: 'Configured for future use' }
]

// ---------------- simulation ----------------
const batches = [];
const movements = [];
const bal = {}; // batchId -> total qty (all locations)
const lbal = {}; // `${batchId}|${loc}` -> qty
const balAt = (b, loc) => lbal[b.id + '|' + loc] || 0;
let movSeq = 0;
function move(at, batch, type, qty, ref, userId, reason, loc = PH) {
  const prev = balAt(batch, loc);
  const isIn = ['OPENING_STOCK', 'PURCHASE_RECEIPT', 'STOCK_TRANSFER_IN', 'PATIENT_RETURN', 'STOCK_ADJUSTMENT_IN', 'SALE_CANCELLATION'].includes(type);
  const next = isIn ? prev + qty : prev - qty;
  if (next < 0) throw new Error('negative ' + batch.id + ' at ' + loc);
  lbal[batch.id + '|' + loc] = next;
  bal[batch.id] = (bal[batch.id] || 0) + (isIn ? qty : -qty);
  const m = { id: 'MOV-' + pad(++movSeq, 5), at: iso(at), medicineId: batch.medicineId, batchId: batch.id, type,
    qtyIn: isIn ? qty : 0, qtyOut: isIn ? 0 : qty, prevBalance: prev, newBalance: next, reference: ref, userId, reason, locationId: loc };
  movements.push(m);
  return m;
}
let batSeq = 0;
const batchCode = (med) => {
  const p = med.brandName.replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase();
  return p + String(randInt(1, 9)) + String.fromCharCode(65 + randInt(0, 25)) + pad(randInt(100, 9999), 4);
};
function mfgFor(batchNo, expiry, receivedAt) {
  const months = 20 + ([...String(batchNo)].reduce((t, c) => t + c.charCodeAt(0), 0) % 13);
  const d = new Date(expiry + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - months); d.setUTCDate(1);
  const rec = new Date(receivedAt);
  if (d > rec) d.setTime(rec.getTime() - 75 * 86400000);
  return d.toISOString().slice(0, 10);
}
function newBatch(med, { expiry, supplierId, grnId, receivedAt, qty, ptr, mrp, batchNo, mfgDate }) {
  const bn = batchNo || batchCode(med);
  const b = { id: 'BAT-' + pad(++batSeq), batchNo: bn, medicineId: med.id, mfgDate: mfgDate || mfgFor(bn, expiry, receivedAt), expiryDate: expiry, mrp, ptr,
    receivedQty: qty, supplierId, grnId: grnId || null, locationId: grnId ? STORE : PH, receivedAt: iso(receivedAt), quarantined: false, returned: false, notes: '' };
  batches.push(b);
  return b;
}
const vary = (v, p = 0.04) => Math.round(v * (1 + (rnd() * 2 - 1) * p) * 100) / 100;

// Opening stock on 1 Aug 2026 — profile per medicine: [qty, expiry]
const OPEN_DATE = new Date('2026-08-01T09:00:00+05:30');
const openProfile = {
  1: [[220, '2028-03-31'], [80, '2027-01-31']], 2: [[160, '2027-11-30']], 3: [[70, '2027-06-30']], 4: [[60, '2027-08-31'], [25, '2026-12-31']],
  5: [[180, '2028-01-31']], 6: [[110, '2027-12-31']], 7: [[120, '2028-02-29']], 8: [[52, '2027-09-30']], 9: [[90, '2027-10-31']],
  10: [[140, '2027-05-31']], 11: [[115, '2027-07-31']], 12: [[48, '2026-10-31'], [55, '2027-09-30']], 13: [[60, '2027-04-30']],
  14: [[45, '2027-02-15']], 15: [[24, '2027-08-31']], 16: [[30, '2026-11-15']], 17: [[150, '2028-05-31']], 18: [[90, '2027-12-31']],
  19: [[26, '2027-03-31']], 20: [[160, '2027-11-30']], 21: [[95, '2028-01-31']], 22: [[38, '2027-06-30']], 23: [[28, '2027-01-15']],
  24: [[16, '2027-09-30']], 25: [[22, '2027-07-31']], 26: [[14, '2027-05-31']], 27: [[30, '2026-12-20']], 28: [[600, '2030-06-30']],
  29: [[260, '2029-12-31']], 30: [[220, '2029-10-31']], 31: [[140, '2028-08-31']], 32: [[18, '2030-01-31']]
};
const supplierFor = (med) => ({ 'Medical Consumables': 'SUP-0003', 'IV Fluids': 'SUP-0005', Dermatology: 'SUP-0004', 'Ophthalmic / ENT': 'SUP-0004' }[med.category]
  || (med.form === 'Injection' ? 'SUP-0002' : med.form === 'Syrup' ? 'SUP-0004' : 'SUP-0001'));

const events = []; // {at, fn}
for (const [idx, list] of Object.entries(openProfile)) {
  const med = medicines[idx - 1];
  for (const [qty, exp] of list) {
    events.push({ at: OPEN_DATE, fn: () => {
      const b = newBatch(med, { expiry: exp, supplierId: supplierFor(med), receivedAt: OPEN_DATE, qty, ptr: vary(med.refPtr), mrp: med.refMrp });
      const shelf = Math.max(1, Math.round(qty * 0.4));
      move(OPEN_DATE, b, 'OPENING_STOCK', shelf, 'OPEN-2026-08', MGR, 'Opening balance — pharmacy shelf', PH);
      if (qty - shelf > 0) move(OPEN_DATE, b, 'OPENING_STOCK', qty - shelf, 'OPEN-2026-08', MGR, 'Opening balance — central store', STORE);
    } });
  }
}

// GRNs
const grns = [];
const attachments = [];
let attSeq = 0;
function attach(grnId, category, name, src, type, size, validation, userId, at) {
  const a = { id: 'ATT-' + pad(++attSeq), grnId, category, name, type, size, src, storage: 'static', validation, uploadedBy: userId, uploadedAt: iso(at) };
  attachments.push(a);
  return a.id;
}
let grnSeq = 0;
function makeGrn({ status, supplierId, date, by, lines, invNo, remarks = '', verifiedBy, approvedBy, postedBy, rejectedReason, noDocs, discrepancyNote, invoiceAmountDelta = 0 }) {
  const id = 'GRN-2026-' + pad(++grnSeq);
  const at = new Date(date);
  const items = lines.map((l, i) => {
    const med = medicines[l.m - 1];
    const ptr = l.ptr ?? vary(med.refPtr, 0.03);
    const bno = l.batchNo ?? batchCode(med);
    return { lineId: id + '-L' + (i + 1), medicineId: med.id, batchNo: bno, mfgDate: l.exp && bno ? mfgFor(bno, l.exp, at) : '', expiryDate: l.exp,
      invoiceQty: l.inv ?? l.q, receivedQty: l.q, freeQty: l.free || 0, ptr, mrp: l.mrp ?? med.refMrp, discountPct: l.disc ?? pick([0, 0, 2, 5]),
      gstPct: med.gstPct, remarks: l.remarks || '', batchId: null };
  });
  const subtotal = items.reduce((s, it) => {
    const g = it.receivedQty * it.ptr; const t = g - g * it.discountPct / 100; return s + t + t * it.gstPct / 100;
  }, 0);
  const g = { id, grnNumber: id, supplierId, invoiceNo: invNo, invoiceDate: new Date(at.getTime() - 86400000).toISOString().slice(0, 10),
    invoiceAmount: Math.round((subtotal + invoiceAmountDelta) * 100) / 100, poRef: rnd() > 0.4 ? 'PO-NH-' + pad(randInt(100, 999), 4) : '',
    locationId: STORE, receivedAt: iso(at), receivedBy: by, remarks, status, items, attachments: { invoice: null, photos: [] },
    verifiedBy: null, verifiedAt: null, approvedBy: null, approvedAt: null, postedBy: null, postedAt: null, rejectedReason: rejectedReason || null,
    requiresOwnerApproval: false, exceptionReasons: [], history: [], createdBy: by, createdAt: iso(at), updatedAt: iso(at) };
  if (!noDocs) {
    g.attachments.invoice = attach(id, 'INVOICE', `Invoice_${invNo.replace(/\//g, '-')}.jpg`, 'assets/images/sample-invoice.svg', 'image/svg+xml', 48211, 'INVOICE_DETECTED', by, at);
    g.attachments.photos.push(attach(id, 'DELIVERY_PHOTO', 'IMG_delivery_01.jpg', 'assets/images/sample-delivery-1.svg', 'image/svg+xml', 61210, 'PHOTO_UPLOADED', by, at));
    g.attachments.photos.push(attach(id, 'DELIVERY_PHOTO', 'IMG_delivery_02.jpg', 'assets/images/sample-delivery-2.svg', 'image/svg+xml', 58872, 'NEEDS_MANUAL_REVIEW', by, at));
  }
  const h = (st, user, mins, note) => g.history.push({ status: st, by: user, at: iso(at.getTime() + mins * 60000), note });
  h('DRAFT', by, 0, 'GRN created at receiving counter');
  if (discrepancyNote) g.exceptionReasons.push(discrepancyNote);
  if (['SUBMITTED', 'PENDING_APPROVAL', 'POSTED', 'REJECTED'].includes(status)) h('SUBMITTED', by, 25, 'Submitted for verification');
  if (status === 'VALIDATION_REQUIRED') h('VALIDATION_REQUIRED', by, 20, 'Submission blocked: missing mandatory details');
  if (status === 'PENDING_APPROVAL' || (status === 'POSTED' && approvedBy)) {
    g.verifiedBy = verifiedBy; g.verifiedAt = iso(at.getTime() + 60 * 60000); g.requiresOwnerApproval = true;
    h('PENDING_APPROVAL', verifiedBy, 60, 'Verified. Exceptional case escalated to owner: ' + discrepancyNote);
  }
  if (status === 'POSTED') {
    g.verifiedBy = verifiedBy; g.verifiedAt = g.verifiedAt || iso(at.getTime() + 60 * 60000);
    if (approvedBy) { g.approvedBy = approvedBy; g.approvedAt = iso(at.getTime() + 180 * 60000); h('APPROVED', approvedBy, 180, 'Approved by owner'); }
    g.postedBy = postedBy; g.postedAt = iso(at.getTime() + (approvedBy ? 190 : 70) * 60000);
    h('POSTED', postedBy, approvedBy ? 190 : 70, 'Stock posted to inventory');
  }
  if (status === 'REJECTED') { g.verifiedBy = verifiedBy; h('REJECTED', verifiedBy, 90, rejectedReason); }
  if (status === 'CANCELLED') h('CANCELLED', by, 40, remarks || 'Cancelled');
  grns.push(g);
  if (status === 'POSTED') {
    events.push({ at: new Date(g.postedAt), fn: () => {
      for (const it of g.items) {
        const med = medicines.find((m) => m.id === it.medicineId);
        const qty = it.receivedQty + it.freeQty;
        const b = newBatch(med, { expiry: it.expiryDate, supplierId, grnId: id, receivedAt: new Date(g.postedAt), qty, ptr: it.ptr, mrp: it.mrp, batchNo: it.batchNo, mfgDate: it.mfgDate });
        it.batchId = b.id;
        move(new Date(g.postedAt), b, 'PURCHASE_RECEIPT', qty, id, postedBy, `Goods receipt against invoice ${invNo}`, STORE);
      }
    } });
  }
  return g;
}

makeGrn({ status: 'POSTED', supplierId: 'SUP-0001', date: '2026-08-12T11:20:00+05:30', by: STAFF, verifiedBy: MGR, postedBy: MGR, invNo: 'SMP/26-27/1184',
  lines: [{ m: 1, q: 150, free: 10, exp: '2028-06-30' }, { m: 2, q: 100, exp: '2028-01-31' }, { m: 5, q: 120, exp: '2028-04-30' }, { m: 7, q: 80, exp: '2028-05-31' }] });
makeGrn({ status: 'POSTED', supplierId: 'SUP-0003', date: '2026-08-26T15:05:00+05:30', by: RAVI, verifiedBy: MGR, postedBy: MGR, invNo: 'LSC/BLR/0937',
  lines: [{ m: 28, q: 500, exp: '2030-12-31' }, { m: 29, q: 150, exp: '2030-03-31' }, { m: 30, q: 200, free: 20, exp: '2030-01-31' }] });
makeGrn({ status: 'POSTED', supplierId: 'SUP-0002', date: '2026-09-09T10:40:00+05:30', by: STAFF, verifiedBy: MGR, postedBy: MGR, invNo: 'KMA/2627/0412',
  lines: [{ m: 17, q: 100, exp: '2028-08-31' }, { m: 19, q: 20, exp: '2027-09-30', remarks: 'Received in cold box, temp log 4°C' }, { m: 20, q: 100, exp: '2028-02-29' }] });
makeGrn({ status: 'POSTED', supplierId: 'SUP-0004', date: '2026-09-24T12:15:00+05:30', by: STAFF, verifiedBy: MGR, postedBy: MGR, invNo: 'SBP/0688',
  lines: [{ m: 13, q: 40, exp: '2027-12-31' }, { m: 22, q: 20, exp: '2028-03-31' }, { m: 25, q: 20, exp: '2027-10-31' }, { m: 27, q: 20, exp: '2028-02-29' }] });
makeGrn({ status: 'POSTED', supplierId: 'SUP-0005', date: '2026-10-14T09:50:00+05:30', by: RAVI, verifiedBy: MGR, approvedBy: OWNER, postedBy: OWNER, invNo: 'KHD/SLM/2291',
  discrepancyNote: 'Invoice quantity mismatch above 10% on Normal Saline (ordered 200, received 160)',
  lines: [{ m: 31, q: 160, inv: 200, exp: '2028-10-31', remarks: '40 bottles short-supplied; supplier credit note awaited' }] });
makeGrn({ status: 'POSTED', supplierId: 'SUP-0001', date: '2026-11-05T16:30:00+05:30', by: STAFF, verifiedBy: MGR, postedBy: MGR, invNo: 'SMP/26-27/1402',
  lines: [{ m: 3, q: 40, exp: '2028-01-31' }, { m: 6, q: 60, exp: '2028-07-31' }, { m: 9, q: 50, exp: '2028-04-30' }, { m: 10, q: 60, exp: '2027-12-31' }, { m: 1, q: 100, exp: '2028-09-30' }] });
makeGrn({ status: 'SUBMITTED', supplierId: 'SUP-0002', date: '2026-11-20T11:00:00+05:30', by: STAFF, invNo: 'KMA/2627/0577',
  lines: [{ m: 18, q: 50, exp: '2028-06-30' }, { m: 21, q: 50, exp: '2028-09-30' }] });
makeGrn({ status: 'SUBMITTED', supplierId: 'SUP-0004', date: '2026-11-22T10:10:00+05:30', by: RAVI, invNo: 'SBP/0741',
  lines: [{ m: 14, q: 40, exp: '2028-01-31' }, { m: 15, q: 24, exp: '2028-02-29' }, { m: 16, q: 24, exp: '2028-03-31' }, { m: 26, q: 20, exp: '2028-05-31' }] });
makeGrn({ status: 'PENDING_APPROVAL', supplierId: 'SUP-0001', date: '2026-11-21T15:40:00+05:30', by: STAFF, verifiedBy: MGR, invNo: 'SMP/26-27/1466',
  discrepancyNote: 'Delivery contains a batch expiring within 30 days (Azithral 500)',
  lines: [{ m: 4, q: 60, exp: '2028-02-29' }, { m: 4, q: 20, exp: '2026-12-15', remarks: 'Short-dated batch supplied as replacement' }, { m: 8, q: 40, exp: '2028-03-31' }, { m: 11, q: 60, exp: '2028-05-31' }] });
makeGrn({ status: 'DRAFT', supplierId: 'SUP-0003', date: '2026-11-23T09:30:00+05:30', by: STAFF, invNo: 'LSC/BLR/1102', noDocs: true,
  lines: [{ m: 29, q: 100, exp: '2030-06-30' }, { m: 32, q: 20, exp: '2030-08-31' }] });
makeGrn({ status: 'VALIDATION_REQUIRED', supplierId: 'SUP-0005', date: '2026-11-22T17:20:00+05:30', by: RAVI, invNo: 'KHD/SLM/2340', noDocs: true,
  lines: [{ m: 31, q: 100, exp: '2028-11-30' }, { m: 12, q: 40, exp: '', batchNo: '' }] });
makeGrn({ status: 'REJECTED', supplierId: 'SUP-0006', date: '2026-10-28T13:00:00+05:30', by: STAFF, verifiedBy: MGR, invNo: 'AMD/CHN/7781',
  rejectedReason: 'Supplier inactive and items received without purchase order. Returned to supplier.',
  lines: [{ m: 24, q: 30, exp: '2027-06-30' }, { m: 23, q: 30, exp: '2027-08-31' }] });
makeGrn({ status: 'CANCELLED', supplierId: 'SUP-0001', date: '2026-11-10T12:00:00+05:30', by: RAVI, invNo: 'SMP/26-27/1420', remarks: 'Duplicate entry — invoice already recorded in GRN-2026-0006',
  lines: [{ m: 6, q: 60, exp: '2028-07-31' }] });

// ---------------- pharmacy billing (fictional patients & doctors) ----------------
const patients = [
  ['Selvi Rajendran', 'F', 54], ['Murugan Kannan', 'M', 61], ['Lakshmi Devi', 'F', 47], ['Ramesh Babu', 'M', 38], ['Anitha Shankar', 'F', 29],
  ['Prakash Natarajan', 'M', 45], ['Fathima Begum', 'F', 36], ['Joseph Dominic', 'M', 58], ['Kumaravel Pandian', 'M', 66], ['Revathi Mohan', 'F', 33],
  ['Syed Imran', 'M', 41], ['Geetha Venkat', 'F', 52], ['Manjunath Hegde', 'M', 49], ['Priyanka Ravi', 'F', 27], ['Venkatesan Thangavel', 'M', 70], ['Shalini Kumar', 'F', 31]
].map(([name, gender, age], i) => {
  const areas = ['Bagalur Road', 'Rayakottai Road', 'Mathigiri', 'Shanthi Nagar', 'Alasanatham', 'Zuzuvadi', 'Denkanikottai Road', 'Thally Road'];
  const groups = ['O+', 'B+', 'A+', 'AB+', 'O-', 'B-'];
  const reg = new Date(Date.UTC(2026, 6 + (i % 4), 3 + i, 4, 30));
  return { id: 'PAT-' + pad(i + 1), uhid: 'NH-UH-' + pad(26101 + i * 37, 6), name, gender, age, dob: `${2026 - age}-${pad((i % 12) + 1, 2)}-${pad((i % 27) + 1, 2)}`,
    phone: '+91 9' + pad(randInt(100000000, 999999999), 9), address: `${10 + i * 7}, ${areas[i % areas.length]}`, city: 'Hosur', pincode: '635109',
    guardianName: age > 60 || age < 18 ? `${['Ramesh', 'Lakshmi', 'Senthil', 'Geetha'][i % 4]} (${age > 60 ? 'son/daughter' : 'parent'})` : '', bloodGroup: groups[i % groups.length],
    allergies: i % 5 === 0 ? 'Penicillin' : '', registeredAt: reg.toISOString(), registeredBy: 'USR-0005', active: true };
});
const doctors = ['Dr. A. Ravichandran (General Medicine)', 'Dr. K. Sangeetha (Obstetrics & Gynaecology)', 'Dr. M. Harish (Orthopaedics)', 'Dr. S. Nivetha (Paediatrics)', 'Dr. R. Balaji (Surgery)', 'Dr. P. Kavya (ENT)'];
const bills = []; const billItems = []; const payments = []; const pReturns = []; const pReturnItems = []; const cancellations = [];
let billSeq = 0; let payItemSeq = 0; let paySeq = 0;
const bizDate = (t) => new Date(new Date(t).getTime() + 5.5 * 3600000).toISOString().slice(0, 10); // IST, business day starts 00:00
const txn = (bill, kind, mode, amount, at, userId, extra = {}) => {
  const p = { id: 'PAY-' + pad(++paySeq, 6), billId: bill.id, kind, mode, amount: r2(amount), tendered: null, change: null, reference: '', at: iso(at), businessDate: bizDate(at), userId, note: '', returnId: null, cancellationId: null, ...extra };
  if (mode === 'UPI' && !p.reference) p.reference = 'UPI' + pad(randInt(100000, 999999), 6) + pad(randInt(100000, 999999), 6);
  if (mode === 'CARD' && !p.reference) p.reference = 'XXXX-' + pad(randInt(1000, 9999), 4);
  payments.push(p);
  return p;
};
function setBillStatus(b) {
  if (b.status === 'CANCELLED') return;
  const paid = r2(payments.filter((p) => p.billId === b.id && p.kind === 'PAYMENT').reduce((s, p) => s + p.amount, 0));
  b.amountPaid = paid; b.balanceDue = r2(Math.max(0, b.grandTotal - paid));
  b.paymentStatus = paid >= b.grandTotal - 0.005 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
  const items = billItems.filter((i) => i.billId === b.id);
  const ret = pReturnItems.filter((ri) => pReturns.find((r) => r.id === ri.returnId && r.status === 'COMPLETED') && items.some((i) => i.id === ri.billItemId)).reduce((s, ri) => s + ri.qty, 0);
  const sold = items.reduce((s, i) => s + i.qty, 0);
  b.status = ret >= sold && sold > 0 ? 'RETURNED' : ret > 0 ? 'PARTIALLY_RETURNED' : b.paymentStatus === 'PAID' ? 'COMPLETED' : b.paymentStatus === 'PARTIALLY_PAID' ? 'PARTIALLY_PAID' : 'PENDING';
  b.paymentMode = [...new Set(payments.filter((p) => p.billId === b.id && p.kind === 'PAYMENT').map((p) => p.mode))].join(' + ') || '—';
}
function createBill(at, cashier, reqs, { patient, billDiscPct = 0, plan, discountAuthorizedBy = null, prescribed = !!patient }) {
  const saleType = patient ? 'PATIENT' : 'WALKIN';
  const lines = [];
  for (const { med, qty, discPct = 0 } of reqs) {
    let want = qty;
    const avail = batches.filter((b) => b.medicineId === med.id && balAt(b, PH) > 0 && new Date(b.expiryDate) > at && new Date(b.receivedAt) <= at)
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    for (const b of avail) {
      if (want <= 0) break;
      const q = Math.min(want, balAt(b, PH));
      lines.push({ medicineId: med.id, batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: q, unitPrice: b.mrp, discountPct: discPct, gstPct: med.gstPct, unit: med.unit });
      want -= q;
    }
  }
  if (!lines.length) return null;
  const priced = priceBill(lines, billDiscPct);
  const id = 'PB-2026-' + pad(++billSeq, 5);
  const b = { id, billNo: id, at: iso(at), businessDate: bizDate(at), saleType, patientId: patient?.id || null, patientName: patient?.name || 'Walk-in Customer', uhid: patient?.uhid || '',
    phone: patient?.phone || '', doctor: prescribed ? pick(doctors) : '', prescriptionRef: prescribed ? 'RX-' + pad(randInt(10000, 99999), 5) : '', cashierId: cashier,
    billDiscountPct: billDiscPct, ...priced.totals, lineCount: priced.lines.length, discountAuthorizedBy, status: 'COMPLETED', paymentStatus: 'PAID', paymentMode: '', amountPaid: 0, balanceDue: 0, remarks: '', createdAt: iso(at) };
  bills.push(b);
  priced.lines.forEach((l, i) => {
    billItems.push({ id: 'PBI-' + pad(++payItemSeq, 6), billId: id, lineNo: i + 1, medicineId: l.medicineId, batchId: l.batchId, batchNo: l.batchNo, expiryDate: l.expiryDate, qty: l.qty, unit: l.unit,
      unitPrice: l.unitPrice, discountPct: l.discountPct, gstPct: l.gstPct, gross: l.gross, itemDiscount: l.itemDiscount, billDiscountShare: l.billDiscountShare, taxableValue: l.taxableValue, gstAmount: l.gstAmount, netAmount: l.netAmount });
    const bt = batches.find((x) => x.id === l.batchId);
    move(at, bt, 'PHARMACY_SALE', l.qty, id, cashier, `Pharmacy sale ${id}`);
  });
  const T = b.grandTotal;
  if (plan === 'CASH') { const tendered = T <= 100 ? Math.ceil(T / 10) * 10 : T <= 500 ? Math.ceil(T / 50) * 50 : Math.ceil(T / 100) * 100; txn(b, 'PAYMENT', 'CASH', T, at, cashier, { tendered, change: r2(tendered - T) }); }
  if (plan === 'UPI' || plan === 'CARD') txn(b, 'PAYMENT', plan, T, at, cashier);
  if (plan === 'OTHER') txn(b, 'PAYMENT', 'OTHER', T, at, cashier, { reference: 'Insurance/TPA slip ' + pad(randInt(1000, 9999), 4), note: 'TPA / corporate' });
  if (plan === 'SPLIT') { const c = Math.max(10, Math.min(T - 1, Math.round(T * 0.4 / 10) * 10)); txn(b, 'PAYMENT', 'CASH', c, at, cashier, { tendered: c, change: 0 }); txn(b, 'PAYMENT', 'UPI', T - c, at, cashier); }
  if (plan === 'PARTIAL') { const c = Math.round(T / 2); txn(b, 'PAYMENT', 'CASH', c, at, cashier, { tendered: c, change: 0 }); }
  setBillStatus(b);
  return b;
}

const saleRate = { 1: 6, 2: 4, 3: 2.2, 4: 2, 5: 4, 6: 2.5, 7: 2.4, 8: 1.4, 9: 1.8, 10: 2.4, 11: 2.2, 12: 1.6, 13: 1.3, 14: 1.6, 15: 0.9, 16: 1.1,
  17: 3, 18: 2, 19: 0.7, 20: 3.2, 21: 2, 22: 0.7, 23: 0.8, 24: 0.6, 25: 0.6, 26: 0.5, 27: 0.6, 28: 8, 29: 3, 30: 3.4, 31: 3.4, 32: 0.4 };
const creditBills = [];
for (let d = new Date('2026-08-02T00:00:00+05:30'); d <= new Date('2026-11-23T00:00:00+05:30'); d = new Date(d.getTime() + 86400000)) {
  const isToday = bizDate(d) === '2026-11-23';
  const demand = Object.keys(saleRate).filter(() => rnd() < (isToday ? 0.3 : 0.18)).map((mi) => ({ mi: +mi, qty: Math.max(1, Math.round(saleRate[mi] * (0.6 + rnd() * 0.8))) }));
  for (let i = demand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [demand[i], demand[j]] = [demand[j], demand[i]]; }
  const groups = [];
  while (demand.length) groups.push(demand.splice(0, randInt(1, 3)));
  groups.forEach((g) => {
    const minute = isToday ? randInt(9 * 60, 11 * 60 + 20) : randInt(9 * 60, 21 * 60);
    const at = new Date(d.getTime() + minute * 60000);
    const r = rnd();
    // kind of visit behind the purchase: prescribed (with/without approved credit) or a walk-in counter purchase
    const kind = r < 0.5 ? 'RX' : r < 0.7 ? 'RX_CREDIT' : 'WALKIN';
    const p = rnd();
    let plan = p < 0.42 ? 'CASH' : p < 0.78 ? 'UPI' : p < 0.88 ? 'CARD' : p < 0.94 ? 'SPLIT' : p < 0.96 ? 'OTHER' : 'CREDIT';
    if (plan === 'CREDIT' && kind !== 'RX_CREDIT') plan = 'CASH';
    const disc = rnd() < 0.12 ? pick([2, 5]) : 0;
    const cashier = pick([STAFF, STAFF, STAFF, RAVI, RAVI, STAFF]);
    events.push({ at, fn: () => {
      const b = createBill(at, cashier, g.map((x) => ({ med: medicines[x.mi - 1], qty: x.qty, discPct: kind === 'RX_CREDIT' ? 0 : disc })),
        { patient: kind === 'WALKIN' && rnd() < 0.6 ? null : pick(patients), plan, prescribed: kind !== 'WALKIN' });
      if (b && plan === 'CREDIT') creditBills.push(b);
    } });
  });
}
// most approved-credit sales are settled two days later (not the most recent ones)
const settleCredit = (b) => { const at = new Date(new Date(b.at).getTime() + 2 * 86400000 + 3600000); if (bizDate(at) >= '2026-11-22') return; txn(b, 'PAYMENT', pick(['CASH', 'UPI']), b.grandTotal, at, pick([STAFF, RAVI]), { note: 'Credit balance settled', tendered: null }); setBillStatus(b); };

// a large discount authorised by the manager
events.push({ at: new Date('2026-11-18T12:40:00+05:30'), fn: () => {
  const b = createBill(new Date('2026-11-18T12:40:00+05:30'), STAFF, [{ med: medicines[5], qty: 4 }, { med: medicines[7], qty: 3 }],
    { patient: patients[8], plan: 'UPI', billDiscPct: 12, discountAuthorizedBy: OWNER });
  b.discountRequestId = 'DR-2026-0002';
  discountRequests.push({ id: 'DR-2026-0002', status: 'USED', requestedBy: STAFF, requestedAt: '2026-11-18T07:02:00.000Z', reason: 'Senior citizen on long-term cardiac medicines; monthly regular patient',
    requestedPct: 12, snapshot: { patientName: b.patientName, saleType: 'PATIENT', lines: billItems.filter((x) => x.billId === b.id).map((x) => ({ medicineId: x.medicineId, qty: x.qty })), gross: b.gross, discount: b.discountTotal, grandTotal: b.grandTotal },
    decidedBy: OWNER, decidedAt: '2026-11-18T07:08:00.000Z', decisionNote: 'Approved for this visit.', billId: b.id });
} });
// an approved-credit sale to a registered patient (to be settled later)
events.push({ at: new Date('2026-11-22T19:20:00+05:30'), fn: () => {
  createBill(new Date('2026-11-22T19:20:00+05:30'), STAFF, [{ med: medicines[16], qty: 6 }, { med: medicines[19], qty: 6 }, { med: medicines[30], qty: 4 }], { patient: patients[14], plan: 'CREDIT' });
} });
const discountRequests = [{ id: 'DR-2026-0001', status: 'REJECTED', requestedBy: RAVI, requestedAt: '2026-11-12T10:15:00.000Z', reason: 'Relative of a staff member',
  requestedPct: 20, snapshot: { patientName: 'Walk-in Customer', saleType: 'WALKIN', lines: [{ medicineId: 'MED-0006', qty: 6 }], gross: 1434, discount: 286.8, grandTotal: 1147 },
  decidedBy: OWNER, decidedAt: '2026-11-12T10:40:00.000Z', decisionNote: 'Staff relatives get the standard 10% only.', billId: null }];
events.push({ at: new Date('2026-11-23T11:05:00+05:30'), fn: () => {
  discountRequests.push({ id: 'DR-2026-0003', status: 'PENDING', requestedBy: RAVI, requestedAt: '2026-11-23T05:35:00.000Z', reason: 'Long-term patient on monthly medicines; hospital welfare request',
    requestedPct: 15, snapshot: { patientName: patients[6].name, saleType: 'PATIENT', lines: [{ medicineId: 'MED-0003', qty: 2 }, { medicineId: 'MED-0009', qty: 2 }], gross: 965, discount: 144.75, grandTotal: 820 },
    decidedBy: null, decidedAt: null, decisionNote: '', billId: null });
} });
// a partially paid OP bill today
events.push({ at: new Date('2026-11-23T10:05:00+05:30'), fn: () => {
  createBill(new Date('2026-11-23T10:05:00+05:30'), RAVI, [{ med: medicines[2], qty: 2 }, { med: medicines[10], qty: 2 }], { patient: patients[3], plan: 'PARTIAL' });
} });

// ---- returns ----
let retSeq = 0; let retItemSeq = 0;
function makeReturn(atStr, { pickBill, reason, condition, disposition, status, requestedBy, approvedBy, refundMode, units = 1, notes }) {
  events.push({ at: new Date(atStr), fn: () => {
    const at = new Date(atStr);
    const b = bills.filter(pickBill).find((x) => billItems.some((i) => i.billId === x.id && i.qty >= units + 1));
    const it = billItems.find((i) => i.billId === b.id && i.qty >= units + 1);
    const refund = lineRefund(it, units);
    const id = 'PR-2026-' + pad(++retSeq, 4);
    const r = { id, billId: b.id, at: iso(at), businessDate: bizDate(at), requestedBy, reason, notes, refundMode, refundAmount: refund, status, requiresOwner: false,
      approvedBy: null, approvedAt: null, rejectionReason: null, refundTxnId: null };
    pReturns.push(r);
    const ri = { id: 'PRI-' + pad(++retItemSeq, 5), returnId: id, billItemId: it.id, medicineId: it.medicineId, batchId: it.batchId, qty: units, refundAmount: refund, condition, disposition: null, movementId: null };
    pReturnItems.push(ri);
    if (status === 'COMPLETED') {
      const apAt = new Date(at.getTime() + 20 * 60000);
      r.approvedBy = approvedBy; r.approvedAt = iso(apAt); ri.disposition = disposition;
      if (disposition === 'RESTOCK') ri.movementId = move(apAt, batches.find((x) => x.id === it.batchId), 'PATIENT_RETURN', units, id, approvedBy, `Return ${id} verified — restocked (${reason})`).id;
      r.refundTxnId = txn(b, 'REFUND', refundMode, refund, apAt, requestedBy, { returnId: id, note: 'Refund for ' + id }).id;
    }
    setBillStatus(b);
  } });
}
makeReturn('2026-11-15T14:10:00+05:30', { pickBill: (x) => x.businessDate >= '2026-11-12' && x.businessDate <= '2026-11-14' && x.paymentMode === 'CASH' && x.status === 'COMPLETED', reason: 'Excess quantity', condition: 'GOOD', disposition: 'RESTOCK', status: 'COMPLETED', requestedBy: STAFF, approvedBy: OWNER, refundMode: 'CASH', units: 2, notes: 'Unopened strips returned the next day; seals intact' });
makeReturn('2026-11-19T17:30:00+05:30', { pickBill: (x) => x.businessDate >= '2026-11-17' && x.businessDate <= '2026-11-19' && x.paymentMode === 'UPI' && x.status === 'COMPLETED', reason: 'Damaged item', condition: 'DAMAGED', disposition: 'WRITE_OFF', status: 'COMPLETED', requestedBy: RAVI, approvedBy: OWNER, refundMode: 'UPI', units: 1, notes: 'Bottle cap cracked — not fit for resale' });
makeReturn('2026-11-23T10:40:00+05:30', { pickBill: (x) => x.businessDate >= '2026-11-20' && x.businessDate <= '2026-11-22' && x.status === 'COMPLETED' && x.saleType === 'PATIENT', reason: 'Doctor changed prescription', condition: 'GOOD', status: 'PENDING_APPROVAL', requestedBy: STAFF, refundMode: 'CASH', units: 1, notes: 'Patient returned with revised prescription from OPD' });

// ---- cancellations ----
events.push({ at: new Date('2026-11-21T18:30:00+05:30'), fn: () => {
  const at = new Date('2026-11-21T18:30:00+05:30');
  const b = bills.find((x) => x.businessDate === '2026-11-21' && x.status === 'COMPLETED' && x.paymentMode === 'UPI') || bills.filter((x) => x.businessDate <= '2026-11-21' && x.status === 'COMPLETED' && !x.paymentMode.includes('+')).at(-1);
  const c = { id: 'BC-2026-0001', billId: b.id, requestedBy: RAVI, requestedAt: iso(new Date(at.getTime() - 15 * 60000)), reason: 'Duplicate bill created for the same prescription', status: 'APPROVED', approvedBy: OWNER, approvedAt: iso(at), rejectionReason: null, movementIds: [], refundTxnIds: [] };
  billItems.filter((i) => i.billId === b.id).forEach((i) => { c.movementIds.push(move(at, batches.find((x) => x.id === i.batchId), 'SALE_CANCELLATION', i.qty, b.id, OWNER, `Bill ${b.id} cancelled — stock reversed`).id); });
  payments.filter((p) => p.billId === b.id && p.kind === 'PAYMENT').forEach((p) => c.refundTxnIds.push(txn(b, 'REFUND', p.mode, p.amount, at, RAVI, { cancellationId: c.id, note: 'Refund on cancellation' }).id));
  b.status = 'CANCELLED'; b.cancellationId = c.id; b.cancelledAt = iso(at);
  cancellations.push(c);
} });
events.push({ at: new Date('2026-11-23T11:25:00+05:30'), fn: () => {
  const b = bills.filter((x) => x.businessDate === '2026-11-23' && x.status === 'COMPLETED' && x.cashierId === STAFF).at(-1) || bills.filter((x) => x.businessDate === '2026-11-23' && x.status === 'COMPLETED').at(-1);
  cancellations.push({ id: 'BC-2026-0002', billId: b.id, requestedBy: STAFF, requestedAt: '2026-11-23T05:55:00.000Z', reason: 'Patient decided to buy only part of the prescription; bill to be re-issued', status: 'PENDING', approvedBy: null, approvedAt: null, rejectionReason: null, movementIds: [], refundTxnIds: [] });
  b.cancellationId = 'BC-2026-0002';
} });
events.push({ at: new Date('2026-11-02T11:00:00+05:30'), fn: () => {
  const b = batches.find((x) => x.medicineId === 'MED-0012' && x.expiryDate === '2026-10-31');
  const loc = balAt(b, PH) >= balAt(b, STORE) ? PH : STORE;
  const q = Math.min(balAt(b, loc), 10);
  if (q > 0) move(new Date('2026-11-02T11:00:00+05:30'), b, 'EXPIRED_WRITE_OFF', q, 'WO-0001', MGR, 'Expired strips removed for destruction', loc);
} });
events.push({ at: new Date('2026-10-20T16:00:00+05:30'), fn: () => {
  const b = batches.find((x) => x.medicineId === 'MED-0031' && x.grnId === null);
  move(new Date('2026-10-20T16:00:00+05:30'), b, 'SUPPLIER_RETURN', 6, 'SRN-0001', MGR, 'Leaking bottles returned to supplier', STORE);
} });

// adjustments (approved ones create movements)
const adjustments = [];
function adj({ m, batchPick, delta, reason, notes, by, at, status, approver, requiresOwner }) {
  events.push({ at: new Date(at), fn: () => {
    const cands = batches.filter((x) => x.medicineId === medicines[m - 1].id).sort((a, c) => a.expiryDate.localeCompare(c.expiryDate));
    let loc = PH; let b = cands.filter((x) => balAt(x, PH) > Math.abs(delta))[batchPick || 0];
    if (!b) { loc = STORE; b = cands.filter((x) => balAt(x, STORE) > Math.abs(delta))[batchPick || 0]; }
    const sys = balAt(b, loc);
    const a = { id: 'ADJ-' + pad(adjustments.length + 1), medicineId: b.medicineId, batchId: b.id, systemQty: sys, physicalQty: sys + delta,
      difference: delta, type: delta > 0 ? 'IN' : 'OUT', locationId: loc, reason, notes, attachmentId: null, requestedBy: by, requestedAt: iso(at), status,
      requiresOwner: !!requiresOwner, approvedBy: null, approvedAt: null, rejectionReason: null, movementId: null };
    if (status === 'APPROVED') {
      a.approvedBy = approver; a.approvedAt = iso(new Date(at).getTime() + 3 * 3600000);
      const mv = move(new Date(a.approvedAt), b, delta > 0 ? 'STOCK_ADJUSTMENT_IN' : 'STOCK_ADJUSTMENT_OUT', Math.abs(delta), a.id, approver, reason + ' — ' + notes, loc);
      a.movementId = mv.id;
    }
    if (status === 'REJECTED') { a.approvedBy = approver; a.approvedAt = iso(new Date(at).getTime() + 5 * 3600000); a.rejectionReason = 'Recount done jointly; no variance found.'; }
    adjustments.push(a);
  } });
}
adj({ m: 20, delta: -4, reason: 'Damaged stock', notes: '4 ampoules broken during shelf rearrangement', by: STAFF, at: '2026-09-30T18:00:00+05:30', status: 'APPROVED', approver: MGR });
adj({ m: 28, delta: -12, reason: 'Physical count variance', notes: 'Monthly physical count — 12 syringes short', by: MGR, at: '2026-10-31T19:00:00+05:30', status: 'APPROVED', approver: MGR });
adj({ m: 10, delta: 3, reason: 'Data correction', notes: 'Patient return of 3 strips was not recorded on 12-Oct', by: STAFF, at: '2026-10-18T12:00:00+05:30', status: 'REJECTED', approver: MGR });
adj({ m: 29, delta: -60, reason: 'Missing stock', notes: 'Carton of 60 cannulas not traceable after OT transfer', by: MGR, at: '2026-11-21T17:30:00+05:30', status: 'PENDING_OWNER_APPROVAL', requiresOwner: true });
adj({ m: 2, delta: -2, reason: 'Damaged stock', notes: 'Strips damaged by water seepage near sink', by: STAFF, at: '2026-11-22T13:15:00+05:30', status: 'PENDING_APPROVAL' });

// Store → Pharmacy refills: every 3rd morning the store tops up the pharmacy shelf (FEFO from the store)
const transfers = [];
for (let d = new Date('2026-08-03T08:40:00+05:30'), k = 0; d <= new Date('2026-11-23T08:40:00+05:30'); d = new Date(d.getTime() + 86400000), k++) {
  if (k % 3) continue;
  const at = new Date(d);
  events.push({ at, fn: () => {
    const items = [];
    for (const med of medicines) {
      const live = batches.filter((b) => b.medicineId === med.id && new Date(b.expiryDate) > at && new Date(b.receivedAt) <= at);
      const shelf = live.reduce((t, b) => t + balAt(b, PH), 0);
      const target = Math.max(med.reorderLevel * 2, 20);
      if (shelf > med.reorderLevel * 1.2) continue;
      let want = target - shelf;
      for (const b of live.filter((x) => balAt(x, STORE) > 0 && (new Date(x.expiryDate) - at) > 45 * 86400000).sort((a, c) => a.expiryDate.localeCompare(c.expiryDate))) {
        if (want <= 0) break;
        const q = Math.min(want, balAt(b, STORE));
        items.push({ batchId: b.id, medicineId: med.id, qty: q });
        want -= q;
      }
    }
    if (!items.length) return;
    const id = 'TRF-2026-' + pad(transfers.length + 1, 4);
    items.forEach((it) => { const b = batches.find((x) => x.id === it.batchId);
      move(at, b, 'STOCK_TRANSFER_OUT', it.qty, id, MGR, 'Transfer to Pharmacy', STORE);
      move(at, b, 'STOCK_TRANSFER_IN', it.qty, id, MGR, 'Received from Central Store', PH); });
    transfers.push({ id, at: iso(at), businessDate: bizDate(at), fromLocationId: STORE, toLocationId: PH, items, totalQty: items.reduce((t, x) => t + x.qty, 0),
      value: r2(items.reduce((t, x) => t + x.qty * batches.find((b) => b.id === x.batchId).ptr, 0)), performedBy: MGR, receivedBy: pick([STAFF, RAVI]), status: 'COMPLETED', remarks: 'Routine pharmacy refill' });
  } });
}

// daily stock counts — counted at 8:50 pm on the last 6 days; one shortage for the owner to review
const stockCounts = [];
const FAST = [1, 2, 5, 28, 20, 17, 31, 6, 7, 11];
const COUNT_DAYS = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
COUNT_DAYS.forEach((day, di) => {
  const at = new Date(day + 'T20:50:00+05:30');
  events.push({ at, fn: () => {
    const dayStart = new Date(day + 'T00:00:00+05:30').getTime();
    const items = FAST.map((mi) => {
      const med = medicines[mi - 1];
      const bs = batches.filter((b) => b.medicineId === med.id && new Date(b.receivedAt) <= at && new Date(b.expiryDate) > at);
      const ids = new Set(bs.map((b) => b.id));
      const expected = bs.reduce((t, b) => t + balAt(b, PH), 0);
      const todays = movements.filter((m) => ids.has(m.batchId) && m.locationId === PH && new Date(m.at).getTime() >= dayStart && new Date(m.at) <= at);
      const billed = todays.filter((m) => m.type === 'PHARMACY_SALE').reduce((t, m) => t + m.qtyOut, 0);
      const received = todays.filter((m) => m.type === 'PURCHASE_RECEIPT' || m.type === 'STOCK_TRANSFER_IN').reduce((t, m) => t + m.qtyIn, 0);
      const net = todays.reduce((t, m) => t + m.qtyIn - m.qtyOut, 0);
      const avgPtr = bs.length ? bs.reduce((t, b) => t + b.ptr, 0) / bs.length : 0;
      let counted = expected;
      if (day === '2026-11-22' && mi === 1) counted = Math.max(0, expected - 2);
      if (day === '2026-11-22' && mi === 2) counted = Math.max(0, expected - 1);
      if (day === '2026-11-19' && mi === 28) counted = Math.max(0, expected - 3);
      return { medicineId: med.id, opening: expected - net, received, billed, otherNet: net - received + billed, expected, counted, difference: counted - expected, valueDifference: r2((counted - expected) * avgPtr) };
    });
    const short = items.filter((x) => x.difference < 0);
    const last = di === COUNT_DAYS.length - 1;
    stockCounts.push({ id: 'SC-2026-' + pad(stockCounts.length + 1, 4), businessDate: day, countedBy: di % 2 ? RAVI : STAFF, countedAt: iso(at), items,
      totals: { medicines: items.length, matched: items.length - short.length, shortItems: short.length, shortUnits: -short.reduce((t, x) => t + x.difference, 0), excessUnits: items.filter((x) => x.difference > 0).reduce((t, x) => t + x.difference, 0), valueDifference: r2(items.reduce((t, x) => t + x.valueDifference, 0)) },
      remarks: short.length ? 'Counted twice. Shortage reported to the Pharmacy Manager.' : 'All counted medicines matched.',
      status: short.length && last ? 'SUBMITTED' : 'REVIEWED', reviewedBy: short.length && last ? null : (short.length ? OWNER : null), reviewedAt: short.length && last ? null : (short.length ? iso(new Date(at.getTime() + 13 * 3600000)) : null),
      reviewNote: short.length && !last ? 'Recount confirmed the shortage. Staff counselled; manager to raise a stock correction.' : '' });
  } });
});

// run
events.sort((a, b) => a.at - b.at).forEach((e) => e.fn());
movements.sort((a, b) => a.at.localeCompare(b.at));
// keep ids in chronological order
const idMap = {};
movements.forEach((m, i) => { idMap[m.id] = 'MOV-' + pad(i + 1, 5); m.id = idMap[m.id]; });
adjustments.forEach((a) => { if (a.movementId) a.movementId = idMap[a.movementId]; });
adjustments.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)).forEach((a, i) => {
  const nid = 'ADJ-' + pad(i + 1);
  movements.forEach((m) => { if (m.reference === a.id) m.reference = nid; });
  a.id = nid;
});
// returned flag for batch fully returned? (none fully returned) — quarantine one batch for demo
const q = batches.find((b) => b.medicineId === 'MED-0013');
q.quarantined = true; q.notes = 'Quarantined: cap seal defects reported on 3 bottles; awaiting supplier inspection';

medicines.forEach((m) => { delete m.refPtr; delete m.refMrp; });

// ---------------- post-run: settle credit sales, daily closings ----------------
creditBills.forEach(settleCredit);
payments.sort((a, b) => a.at.localeCompare(b.at)).forEach((p, i) => {
  const nid = 'PAY-' + pad(i + 1, 6);
  pReturns.forEach((r) => { if (r.refundTxnId === p.id) r.refundTxnId = nid; });
  cancellations.forEach((c) => { c.refundTxnIds = c.refundTxnIds.map((x) => (x === p.id ? nid : x)); });
  p.id = nid;
});
cancellations.forEach((c) => { c.movementIds = c.movementIds.map((x) => idMap[x] || x); });
pReturnItems.forEach((ri) => { if (ri.movementId) ri.movementId = idMap[ri.movementId] || ri.movementId; });

const pharmacySettings = {
  businessDayStartHour: 0, openingCashFloat: 2000, cashVarianceTolerance: 100,
  paymentModes: [{ code: 'CASH', label: 'Cash', active: true }, { code: 'UPI', label: 'UPI', active: true }, { code: 'CARD', label: 'Card', active: true }, { code: 'OTHER', label: 'Other (TPA / Cheque / Wallet)', active: true }],
  refundModes: ['CASH', 'UPI', 'CARD'], allowCredit: true,
  discountLimits: { staffPct: 10, managerPct: 10 }, largeDiscountNotifyPct: 10,
  refund: { staffNeedsApproval: true, ownerApprovalAbove: 1000 }, cancellation: { staffMustRequest: true },
  roundToRupee: true, billPrefix: 'PB',
  receipt: { address: 'Hosur, Krishnagiri District, Tamil Nadu', phone: '', gstin: '', drugLicense: '', footer: 'Thank you for choosing Nallam Hospital Pharmacy. Get well soon!' }
};

const dailyClosings = []; const closingPayments = [];
const MODES = ['CASH', 'UPI', 'CARD', 'OTHER'];
const keys = new Set();
bills.forEach((b) => keys.add(b.businessDate + '|' + b.cashierId));
payments.forEach((p) => keys.add(p.businessDate + '|' + p.userId));
[...keys].sort().forEach((k) => {
  const [date, cashier] = k.split('|');
  if (date >= '2026-11-23') return;
  if (date === '2026-11-22' && cashier === RAVI) return; // left pending on purpose
  const tx = payments.filter((p) => p.businessDate === date && p.userId === cashier);
  const by = (kind, m) => r2(tx.filter((p) => p.kind === kind && p.mode === m).reduce((s, p) => s + p.amount, 0));
  const myBills = bills.filter((b) => b.businessDate === date && b.cashierId === cashier);
  const live = myBills.filter((b) => b.status !== 'CANCELLED');
  const expected = Object.fromEntries(MODES.map((m) => [m, r2(by('PAYMENT', m) - by('REFUND', m))]));
  const float = pharmacySettings.openingCashFloat;
  const variance = rnd() < 0.06 ? pick([-50, -120, 20, -10, -200]) : 0;
  const actual = { CASH: r2(float + expected.CASH + variance), UPI: expected.UPI, CARD: expected.CARD, OTHER: expected.OTHER };
  const recent = date >= '2026-11-16';
  const id = 'DC-2026-' + pad(dailyClosings.length + 1, 4);
  const submittedAt = new Date(date + 'T21:' + pad(randInt(10, 55), 2) + ':00+05:30');
  const totalExpected = r2(float + MODES.reduce((s, m) => s + expected[m], 0));
  const totalActual = r2(MODES.reduce((s, m) => s + actual[m], 0));
  const returnsVal = r2(pReturns.filter((r) => r.status === 'COMPLETED' && r.businessDate === date && r.approvedBy === cashier).reduce((s, r) => s + r.refundAmount, 0));
  dailyClosings.push({ id, businessDate: date, cashierId: cashier, submittedBy: cashier, submittedAt: iso(submittedAt), openingFloat: float,
    summary: { bills: myBills.length, cancelledBills: myBills.length - live.length, gross: r2(live.reduce((s, b) => s + b.gross, 0)), discounts: r2(live.reduce((s, b) => s + b.discountTotal, 0)),
      sales: r2(live.reduce((s, b) => s + b.grandTotal, 0)), returns: returnsVal, refunds: r2(tx.filter((p) => p.kind === 'REFUND').reduce((s, p) => s + p.amount, 0)),
      netSales: r2(live.reduce((s, b) => s + b.grandTotal, 0) - returnsVal), splitBills: live.filter((b) => b.paymentMode.includes('+')).length,
      pending: r2(live.reduce((s, b) => s + b.balanceDue, 0)), collections: r2(tx.filter((p) => p.kind === 'PAYMENT').reduce((s, p) => s + p.amount, 0)),
      bySale: Object.fromEntries(['PATIENT', 'WALKIN'].map((t) => [t, { bills: live.filter((b) => b.saleType === t).length, sales: r2(live.filter((b) => b.saleType === t).reduce((s, b) => s + b.grandTotal, 0)) }])) },
    expectedCash: r2(float + expected.CASH), actualCash: actual.CASH, cashDifference: variance,
    totalExpected, totalActual, totalDifference: r2(totalActual - totalExpected), remarks: variance ? (variance < 0 ? 'Short in cash drawer — recounted twice.' : 'Excess cash, change not given to a customer.') : 'Counter balanced.',
    status: recent ? 'SUBMITTED' : 'VERIFIED', verifiedBy: recent ? null : OWNER, verifiedAt: recent ? null : iso(new Date(submittedAt.getTime() + 12 * 3600000)), corrections: [] });
  MODES.forEach((m) => closingPayments.push({ id: 'DCP-' + pad(closingPayments.length + 1, 5), closingId: id, mode: m, recorded: by('PAYMENT', m), refunds: by('REFUND', m),
    expected: m === 'CASH' ? r2(float + expected.CASH) : expected[m], actual: actual[m], difference: r2(actual[m] - (m === 'CASH' ? float + expected.CASH : expected[m])) }));
});

// ---------------- notifications ----------------
const N = [];
const note = (o) => N.push({ id: 'NTF-' + pad(N.length + 1), readBy: [], status: 'OPEN', ...o });
for (const g of grns.filter((x) => x.status === 'POSTED')) {
  note({ type: 'GRN_POSTED', category: 'GRN', severity: 'success', title: `Stock receipt posted — ${g.id}`,
    message: `${g.items.length} item line(s) from ${suppliers.find((s) => s.id === g.supplierId).name} posted to Main Pharmacy.`,
    refType: 'GRN', refId: g.id, createdAt: g.postedAt, targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER, readBy: g.postedAt < '2026-11-01' ? [OWNER] : [], status: 'RESOLVED' });
}
for (const g of grns.filter((x) => x.status === 'SUBMITTED')) {
  note({ type: 'GRN_PENDING_VERIFICATION', category: 'GRN Pending Verification', severity: 'warning', title: `GRN awaiting verification — ${g.id}`,
    message: `Submitted by ${users.find((u) => u.id === g.receivedBy).name}. Please verify quantities and batch details.`, refType: 'GRN', refId: g.id,
    createdAt: g.history.at(-1).at, targetRoles: ['STORE_INCHARGE', 'SUPER_ADMIN'], assignedTo: MGR });
}
const pa = grns.find((x) => x.status === 'PENDING_APPROVAL');
note({ type: 'GRN_APPROVAL_REQUIRED', category: 'GRN Discrepancy', severity: 'critical', title: `Owner approval required — ${pa.id}`, message: pa.exceptionReasons[0],
  refType: 'GRN', refId: pa.id, createdAt: pa.verifiedAt, targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER });
const pd = grns.find((x) => x.id === 'GRN-2026-0005');
note({ type: 'GRN_DISCREPANCY', category: 'GRN Discrepancy', severity: 'warning', title: `Quantity discrepancy — ${pd.id}`, message: pd.exceptionReasons[0],
  refType: 'GRN', refId: pd.id, createdAt: pd.verifiedAt, targetRoles: ['STORE_INCHARGE', 'SUPER_ADMIN'], assignedTo: MGR, readBy: [MGR, OWNER], status: 'RESOLVED' });
const vr = grns.find((x) => x.status === 'VALIDATION_REQUIRED');
note({ type: 'MISSING_DOCUMENTATION', category: 'Missing Documentation', severity: 'warning', title: `Missing documents — ${vr.id}`,
  message: 'Supplier invoice and delivery photographs are not attached. Batch number and expiry missing on 1 line.', refType: 'GRN', refId: vr.id,
  createdAt: vr.history.at(-1).at, targetRoles: ['STORE_INCHARGE'], assignedTo: RAVI });
for (const a of adjustments.filter((x) => x.status.startsWith('PENDING'))) {
  const med = medicines.find((m) => m.id === a.medicineId);
  note({ type: 'ADJUSTMENT_APPROVAL', category: 'Stock Adjustment Approval', severity: a.requiresOwner ? 'critical' : 'warning',
    title: `Adjustment approval — ${a.id}`, message: `${med.brandName}: ${a.difference} ${med.unit}(s). Reason: ${a.reason}.`, refType: 'ADJUSTMENT', refId: a.id,
    createdAt: a.requestedAt, targetRoles: a.requiresOwner ? ['SUPER_ADMIN'] : ['STORE_INCHARGE', 'SUPER_ADMIN'], assignedTo: a.requiresOwner ? OWNER : MGR });
}
const rj = grns.find((x) => x.status === 'REJECTED');
note({ type: 'GRN_REJECTED', category: 'GRN', severity: 'info', title: `GRN rejected — ${rj.id}`, message: rj.rejectedReason, refType: 'GRN', refId: rj.id,
  createdAt: rj.history.at(-1).at, targetRoles: ['PHARMACY_STAFF', 'SUPER_ADMIN'], assignedTo: STAFF, readBy: [STAFF, OWNER], status: 'RESOLVED' });
note({ type: 'EXPIRY_ALERT', category: 'Expired Stock', severity: 'critical', title: 'Expired batches on shelf', message: 'Benadryl Cough Formula and Mox 500 have expired batches with remaining stock. Segregate and write off.',
  refType: 'REPORT', refId: 'expired', createdAt: '2026-11-16T08:00:00.000Z', targetRoles: ['PHARMACY_STAFF', 'STORE_INCHARGE', 'SUPER_ADMIN'], assignedTo: MGR });
note({ type: 'EXPIRY_ALERT', category: 'Near Expiry', severity: 'warning', title: 'Batches expiring within 90 days', message: 'Several batches expire before February 2027. Review the Near Expiry report and prioritise FEFO issue.',
  refType: 'REPORT', refId: 'near-expiry', createdAt: '2026-11-20T08:00:00.000Z', targetRoles: ['PHARMACY_STAFF', 'STORE_INCHARGE', 'SUPER_ADMIN'], assignedTo: STAFF });
note({ type: 'LOW_STOCK', category: 'Low Stock', severity: 'warning', title: 'Weekly low-stock digest', message: 'Medicines at or below reorder level need purchase orders. See Stock Overview › Low Stock.',
  refType: 'REPORT', refId: 'low-stock', createdAt: '2026-11-18T08:00:00.000Z', targetRoles: ['STORE_INCHARGE', 'SUPER_ADMIN'], assignedTo: MGR, readBy: [OWNER] });
note({ type: 'SYSTEM', category: 'System', severity: 'info', title: 'Pharmacy & Inventory system is live', message: 'Billing, stock receiving, inventory and daily closing are available. Open Help for quick guides.',
  refType: null, refId: null, createdAt: '2026-08-01T09:00:00.000Z', targetRoles: ['PHARMACY_STAFF', 'STORE_INCHARGE', 'SUPER_ADMIN'], assignedTo: null, readBy: [STAFF, MGR, OWNER], status: 'RESOLVED' });

// pharmacy notifications for the owner
dailyClosings.filter((c) => c.businessDate >= '2026-11-20').forEach((c) => note({ type: 'DAILY_CLOSING_SUBMITTED', category: 'Daily Closing', severity: 'info', title: `Daily closing submitted — ${c.businessDate}`,
  message: `${users.find((u) => u.id === c.cashierId).name}: registered patients ₹${c.summary.bySale.PATIENT.sales.toLocaleString('en-IN')} · walk-in ₹${c.summary.bySale.WALKIN.sales.toLocaleString('en-IN')} · cash variance ₹${c.cashDifference}.`, refType: 'CLOSING', refId: c.id, createdAt: c.submittedAt,
  targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER, performedBy: c.cashierId, readBy: c.businessDate < '2026-11-22' ? [OWNER] : [], status: 'RESOLVED' }));
dailyClosings.filter((c) => Math.abs(c.cashDifference) >= 50 && c.businessDate >= '2026-10-15').forEach((c) => note({ type: 'CASH_VARIANCE', category: 'Cash Variance', severity: 'critical', title: `Cash variance ₹${c.cashDifference} — ${c.businessDate}`,
  message: `Expected cash ₹${c.expectedCash}, counted ₹${c.actualCash} by ${users.find((u) => u.id === c.cashierId).name}.`, refType: 'CLOSING', refId: c.id, createdAt: c.submittedAt, targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER, performedBy: c.cashierId, readBy: [OWNER] }));
const bigDisc = bills.find((b) => b.discountAuthorizedBy);
if (bigDisc) note({ type: 'LARGE_DISCOUNT', category: 'Large Discount', severity: 'warning', title: `Large discount ${bigDisc.billDiscountPct}% — ${bigDisc.id}`, message: `Discount of ₹${bigDisc.discountTotal} approved by the owner (request DR-2026-0002) on a bill by Kavitha Selvam.`, refType: 'BILL', refId: bigDisc.id, createdAt: bigDisc.at, targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER, performedBy: OWNER, readBy: [OWNER] });
pReturns.filter((r) => r.status === 'PENDING_APPROVAL').forEach((r) => note({ type: 'REFUND_APPROVAL', category: 'Refund Approval', severity: 'warning', title: `Refund approval requested — ${r.id}`, message: `₹${r.refundAmount} refund against ${r.billId} (${r.reason}).`, refType: 'RETURN', refId: r.id, createdAt: r.at, targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER, performedBy: r.requestedBy }));
cancellations.filter((c) => c.status === 'PENDING').forEach((c) => note({ type: 'CANCELLATION_REQUEST', category: 'Bill Cancellation', severity: 'warning', title: `Bill cancellation requested — ${c.billId}`, message: c.reason, refType: 'BILL', refId: c.billId, createdAt: c.requestedAt, targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER, performedBy: c.requestedBy }));
stockCounts.filter((c) => c.totals.shortItems).forEach((c) => note({ type: 'STOCK_SHORTAGE', category: 'Stock Shortage', severity: 'critical', title: `Stock shortage in daily count — ${c.businessDate}`,
  message: `${c.totals.shortItems} medicine(s), ${c.totals.shortUnits} unit(s) less than the system stock (₹${Math.abs(c.totals.valueDifference)}). Possible items given without a bill.`, refType: 'STOCKCOUNT', refId: c.id, createdAt: c.countedAt,
  targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER, performedBy: c.countedBy, readBy: c.status === 'REVIEWED' ? [OWNER] : [] }));
discountRequests.filter((r) => r.status === 'PENDING').forEach((r) => note({ type: 'DISCOUNT_REQUEST', category: 'Discount Approval', severity: 'warning', title: `Discount approval requested — ${r.requestedPct}%`,
  message: `${r.snapshot.patientName}: ₹${r.snapshot.discount} off ₹${r.snapshot.gross}. Reason: ${r.reason}`, refType: 'DISCOUNT', refId: r.id, createdAt: r.requestedAt, targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER, performedBy: r.requestedBy }));
N.forEach((n) => { if (!('performedBy' in n)) n.performedBy = null; });
N.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach((n, i) => { n.id = 'NTF-' + pad(N.length - i); });

// ---------------- audit ----------------
const audit = [];
const log = (at, userId, action, entity, entityId, details) => audit.push({ id: '', at, userId, action, entity, entityId, details });
log('2026-08-01T03:30:00.000Z', MGR, 'OPENING_STOCK_IMPORTED', 'INVENTORY', 'OPEN-2026-08', 'Opening balances loaded for 32 medicines');
for (const g of grns) for (const h of g.history) log(h.at, h.by, 'GRN_' + h.status, 'GRN', g.id, h.note);
for (const a of adjustments) {
  log(a.requestedAt, a.requestedBy, 'ADJUSTMENT_REQUESTED', 'ADJUSTMENT', a.id, `${a.reason}: ${a.difference}`);
  if (a.status === 'APPROVED') log(a.approvedAt, a.approvedBy, 'ADJUSTMENT_APPROVED', 'ADJUSTMENT', a.id, 'Movement ' + a.movementId);
  if (a.status === 'REJECTED') log(a.approvedAt, a.approvedBy, 'ADJUSTMENT_REJECTED', 'ADJUSTMENT', a.id, a.rejectionReason);
}
log(iso('2026-11-10T10:00:00+05:30'), MGR, 'BATCH_QUARANTINED', 'BATCH', q.id, q.notes);
for (const r of pReturns) { log(r.at, r.requestedBy, 'RETURN_REQUESTED', 'RETURN', r.id, `${r.billId}: ${r.reason}`); if (r.approvedBy) log(r.approvedAt, r.approvedBy, 'RETURN_APPROVED', 'RETURN', r.id, `Refund ₹${r.refundAmount} (${r.refundMode})`); }
for (const c of cancellations) { log(c.requestedAt, c.requestedBy, 'BILL_CANCEL_REQUESTED', 'BILL', c.billId, c.reason); if (c.approvedBy) log(c.approvedAt, c.approvedBy, 'BILL_CANCELLED', 'BILL', c.billId, c.reason); }
for (const c of dailyClosings.filter((x) => x.businessDate >= '2026-11-01')) log(c.submittedAt, c.cashierId, 'DAILY_CLOSING_SUBMITTED', 'CLOSING', c.id, `${c.businessDate} cash variance ${c.cashDifference}`);
audit.sort((a, b) => a.at.localeCompare(b.at)).forEach((a, i) => { a.id = 'AUD-' + pad(i + 1, 5); });

const settings = {
  hospitalName: 'Nallam Hospital', tagline: 'Hospital Management System', city: 'Hosur, Tamil Nadu', logo: null,
  banner: { title: 'Pharmacy & Inventory Management', subtitle: 'Receive stock, track every batch and never miss an expiry — all in one place.', image: null },
  theme: { primary: '#023459', accent: '#049794' },
  expiryThresholdDays: 90, criticalExpiryDays: 30, lowStockBasis: 'REORDER_LEVEL', defaultLocationId: 'LOC-02', pharmacyLocationId: 'LOC-01', storeLocationId: 'LOC-02', maxUsers: 10,
  maxDeliveryPhotos: 10, maxFileSizeMB: 5,
  network: { restrictStaff: true, ownerAnywhere: true, allowed: [
    { id: 'NET-01', label: 'Hospital broadband (main line)', address: '117.193.52.40', active: true, addedBy: 'USR-0003', addedAt: '2026-08-01' },
    { id: 'NET-02', label: 'Backup 4G router — pharmacy', address: '49.204.118.0/24', active: true, addedBy: 'USR-0003', addedAt: '2026-09-12' }] },
  approval: { ownerApprovalForExpiredOrShortDated: true, shortDatedDays: 30, discrepancyPctThreshold: 10, highValueThreshold: 250000,
    adjustmentQtyThreshold: 50, adjustmentValueThreshold: 5000, notifyOwnerOnPost: true },
  demo: { dataVersion: 7, generatedAt: '2026-11-23' }
};

// ---------------- OP & IP (modules 02, 03) — see tools/generate-clinical.mjs ----------------
const clinical = buildClinical({ patients, medicines, batches, movements, users, roles, notifications: N, audit, PH });

out('users.json', users);
out('roles.json', roles);
out('medicine-categories.json', categories);
out('medicines.json', medicines);
out('suppliers.json', suppliers);
out('stock-locations.json', locations);
out('grns.json', grns);
out('attachments.json', attachments);
out('batches.json', batches);
out('stock-movements.json', movements);
out('adjustments.json', adjustments);
out('notifications.json', N);
out('audit-logs.json', audit);
out('settings.json', settings);
out('patients.json', patients);
out('pharmacy-settings.json', { ...pharmacySettings, doctors });
out('pharmacy-bills.json', bills);
out('pharmacy-bill-items.json', billItems);
out('payment-transactions.json', payments);
out('pharmacy-returns.json', pReturns);
out('pharmacy-return-items.json', pReturnItems);
out('bill-cancellations.json', cancellations);
out('daily-closings.json', dailyClosings);
out('daily-closing-payments.json', closingPayments);
out('stock-counts.json', stockCounts);
out('stock-transfers.json', transfers);
out('discount-requests.json', discountRequests);
for (const [file, data] of Object.entries(clinical)) out(file, data);
console.log('bills today', bills.filter((b) => b.businessDate === '2026-11-23').length, 'sales today', bills.filter((b) => b.businessDate === '2026-11-23' && b.status !== 'CANCELLED').reduce((s, b) => s + b.grandTotal, 0));

// summary
const byMed = {};
batches.forEach((b) => { byMed[b.medicineId] = (byMed[b.medicineId] || 0) + (new Date(b.expiryDate) > new Date('2026-11-23') && !b.quarantined ? balAt(b, PH) + balAt(b, STORE) : 0); });
console.log('transfers', transfers.length, 'pharmacy units', Object.keys(lbal).filter((k) => k.endsWith(PH)).reduce((t, k) => t + lbal[k], 0), 'store units', Object.keys(lbal).filter((k) => k.endsWith(STORE)).reduce((t, k) => t + lbal[k], 0));
medicines.forEach((m) => { const v = byMed[m.id] || 0; const s = v === 0 ? 'OUT' : v <= m.reorderLevel ? 'LOW' : 'ok'; if (s !== 'ok') console.log(s, m.brandName, v, '/', m.reorderLevel); });
console.log('batches', batches.length, 'movements', movements.length);
