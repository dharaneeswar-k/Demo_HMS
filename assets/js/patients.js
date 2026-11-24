// Patient Management (BRD module 01) — registration, unique Patient ID (UHID), duplicate check and visit history.
import { store } from './data-service.js';
import { can } from './auth.js';
import { audit } from './services.js';

const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
export const ageFromDob = (dob) => { if (!dob) return null; const d = new Date(dob + 'T00:00:00'); const n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--; return a; };
export const patientAge = (p) => ageFromDob(p.dob) ?? p.age ?? null;

export function nextUhid() {
  const max = store.all('patients').reduce((m, p) => Math.max(m, Number(String(p.uhid).replace(/\D/g, '')) || 0), 26000);
  return 'NH-UH-' + String(max + 1).padStart(6, '0');
}

/** Possible duplicates: same mobile number (families often share one) or same name + age. */
export function findDuplicates({ name, phone, dob, age }, excludeId) {
  const n = String(name || '').trim().toLowerCase(); const ph = digits(phone);
  const a = ageFromDob(dob) ?? (age === '' || age == null ? null : Number(age));
  return store.all('patients').filter((p) => p.id !== excludeId && ((ph && digits(p.phone) === ph) || (n && p.name.toLowerCase() === n && (a == null || Math.abs((patientAge(p) ?? -99) - a) <= 1))))
    .map((p) => ({ patient: p, strong: !!(ph && digits(p.phone) === ph && p.name.toLowerCase() === n) }));
}

export function validatePatient(d) {
  const errs = {};
  if (!String(d.name || '').trim() || String(d.name).trim().length < 2) errs.name = 'Enter the patient’s full name.';
  if (!d.gender) errs.gender = 'Select gender.';
  if (!d.dob && (d.age === '' || d.age == null)) errs.age = 'Enter date of birth or age.';
  if (d.dob && d.dob > new Date().toISOString().slice(0, 10)) errs.age = 'Date of birth cannot be in the future.';
  if (d.age !== '' && d.age != null && (!Number.isInteger(Number(d.age)) || Number(d.age) < 0 || Number(d.age) > 120)) errs.age = 'Enter a valid age (0–120).';
  if (!/^[6-9]\d{9}$/.test(digits(d.phone))) errs.phone = 'Enter a valid 10-digit mobile number.';
  if (d.altPhone && !/^\d{10}$/.test(digits(d.altPhone))) errs.altPhone = 'Enter a valid 10-digit number.';
  if (!String(d.address || '').trim()) errs.address = 'Enter the address.';
  if (d.pincode && !/^\d{6}$/.test(d.pincode)) errs.pincode = 'Pincode must be 6 digits.';
  return errs;
}

const fmtPhone = (p) => { const x = digits(p); return x ? `+91 ${x.slice(0, 5)} ${x.slice(5)}` : ''; };

export function registerPatient(d, user) {
  if (!can('patient.register', user)) throw new Error('You are not allowed to register patients.');
  const errs = validatePatient(d); if (Object.keys(errs).length) throw new Error(Object.values(errs)[0]);
  return store.transaction(() => {
    const id = store.nextId('patients', 'PAT-');
    const p = store.insert('patients', { id, uhid: nextUhid(), name: d.name.trim().replace(/\s+/g, ' '), gender: d.gender, dob: d.dob || '', age: d.dob ? ageFromDob(d.dob) : Number(d.age),
      phone: fmtPhone(d.phone), altPhone: d.altPhone ? fmtPhone(d.altPhone) : '', address: d.address.trim(), city: d.city || 'Hosur', pincode: d.pincode || '', guardianName: d.guardianName || '',
      bloodGroup: d.bloodGroup || '', allergies: d.allergies || '', registeredAt: new Date().toISOString(), registeredBy: user.id, active: true });
    audit(user, 'PATIENT_REGISTERED', 'PATIENT', id, `${p.uhid} · ${p.name}`);
    return p;
  });
}
export function updatePatient(id, d, user) {
  if (!can('patient.edit', user) && !can('patient.register', user)) throw new Error('You are not allowed to edit patients.');
  const errs = validatePatient(d); if (Object.keys(errs).length) throw new Error(Object.values(errs)[0]);
  return store.transaction(() => {
    const p = store.get('patients', id);
    const before = `${p.name} / ${p.phone}`;
    Object.assign(p, { name: d.name.trim(), gender: d.gender, dob: d.dob || '', age: d.dob ? ageFromDob(d.dob) : Number(d.age), phone: fmtPhone(d.phone), altPhone: d.altPhone ? fmtPhone(d.altPhone) : '',
      address: d.address.trim(), city: d.city || 'Hosur', pincode: d.pincode || '', guardianName: d.guardianName || '', bloodGroup: d.bloodGroup || '', allergies: d.allergies || '', updatedAt: new Date().toISOString(), updatedBy: user.id });
    audit(user, 'PATIENT_UPDATED', 'PATIENT', id, `${before} → ${p.name} / ${p.phone}`);
    return p;
  });
}

/** Everything that happened to a patient, newest first. Consultations and admissions join this list when those modules go live. */
export function patientHistory(patientId) {
  const p = store.get('patients', patientId); if (!p) return [];
  const bills = store.all('bills').filter((b) => b.patientId === patientId);
  const billIds = new Set(bills.map((b) => b.id));
  const items = [{ kind: 'REGISTERED', at: p.registeredAt, title: 'Patient registered', detail: `Patient ID ${p.uhid}`, by: p.registeredBy }];
  bills.forEach((b) => items.push({ kind: 'BILL', at: b.at, title: `Pharmacy sale ${b.id}`, detail: `${b.lineCount} item(s)${b.doctor ? ' · ' + b.doctor : ''}`, amount: b.grandTotal, status: b.status, ref: b.id, by: b.cashierId }));
  store.all('pReturns').filter((r) => billIds.has(r.billId)).forEach((r) => items.push({ kind: 'RETURN', at: r.at, title: `Medicine return ${r.id}`, detail: `Against ${r.billId} · ${r.reason}`, amount: -r.refundAmount, status: r.status, ref: r.id, by: r.requestedBy }));
  return items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
export function patientStats(patientId) {
  const bills = store.all('bills').filter((b) => b.patientId === patientId && b.status !== 'CANCELLED');
  return { bills: bills.length, spent: bills.reduce((t, b) => t + b.grandTotal, 0), due: bills.reduce((t, b) => t + (b.balanceDue || 0), 0), lastVisit: bills.map((b) => b.at).sort().at(-1) || null };
}
