// Medical Records Department (BRD 11): episode records with ICD-10 coding, documents, discharge summaries
// (NABH AAC.14 contents) with prepare → review → final workflow, printing and a retrieval register.
import { store } from './data-service.js';
import { can } from './auth.js';
import { audit } from './services.js';
import { notify } from './notifications.js';
import { saveBlob } from './attachment-store.js';

const now = () => new Date().toISOString();
export const EPISODE = { IP: 'In-patient admission', DAYCARE: 'Day care', OP: 'Out-patient visit', EMERGENCY: 'Emergency' };
export const DS_LABEL = { DRAFT: 'Draft', PENDING_REVIEW: 'Waiting for review', FINAL: 'Final', RETURNED: 'Sent back' };
export const DS_TONE = { DRAFT: 'neutral', PENDING_REVIEW: 'warning', FINAL: 'success', RETURNED: 'danger' };
export const REC_LABEL = { OPEN: 'Patient admitted', DISCHARGED: 'Discharged — to code', FILED: 'Coded & filed', ISSUED: 'Issued out' };

// Common ICD-10 codes used in a multi-specialty hospital (searchable; any valid code can still be typed).
export const ICD10 = [
  ['A09', 'Infectious gastroenteritis and colitis'], ['A01.0', 'Typhoid fever'], ['A90', 'Dengue fever'], ['A91', 'Dengue haemorrhagic fever'], ['B50.9', 'Plasmodium falciparum malaria'],
  ['E11.9', 'Type 2 diabetes mellitus without complications'], ['E11.65', 'Type 2 diabetes with hyperglycaemia'], ['E86.0', 'Dehydration'], ['I10', 'Essential (primary) hypertension'],
  ['I21.9', 'Acute myocardial infarction'], ['I63.9', 'Cerebral infarction (stroke)'], ['I50.9', 'Heart failure'], ['J06.9', 'Acute upper respiratory infection'], ['J18.9', 'Pneumonia, unspecified organism'],
  ['J45.9', 'Asthma'], ['J44.1', 'COPD with acute exacerbation'], ['K35.80', 'Acute appendicitis'], ['K40.9', 'Inguinal hernia, unilateral'], ['K80.20', 'Gallstone without cholecystitis'],
  ['K29.7', 'Gastritis'], ['N39.0', 'Urinary tract infection'], ['N20.0', 'Kidney stone'], ['O80', 'Single spontaneous delivery'], ['O82', 'Delivery by caesarean section'],
  ['O14.9', 'Pre-eclampsia'], ['S52.50', 'Fracture of lower end of radius'], ['S72.00', 'Fracture of neck of femur'], ['S06.0', 'Concussion'], ['T14.9', 'Injury, unspecified'],
  ['R50.9', 'Fever, unspecified'], ['R10.4', 'Abdominal pain'], ['R55', 'Syncope and collapse'], ['Z00.0', 'General medical examination'], ['Z38.0', 'Single liveborn infant, born in hospital']
];

const mustManage = (user) => { if (!can('mrd.manage', user)) throw new Error('Only MRD staff can change medical records.'); };
export const recordStatus = (r) => (r.status === 'FILED' && r.issuedTo ? 'ISSUED' : r.status === 'OPEN' && r.dischargedAt ? 'DISCHARGED' : r.status);
export const codingOverdue = (r) => r.dischargedAt && !r.codedAt && (Date.now() - new Date(r.dischargedAt).getTime()) / 86400000 > (store.hs().mrd.codingDueDays || 5);

export function createRecord(d, user) {
  mustManage(user);
  if (!d.patientId) throw new Error('Select the patient.');
  if (!d.admittedAt) throw new Error('Enter the admission / visit date.');
  if (d.dischargedAt && d.dischargedAt < d.admittedAt) throw new Error('Discharge cannot be before admission.');
  return store.transaction(() => {
    const id = store.nextId('medicalRecords', 'MRD-');
    const yr = new Date().getFullYear();
    const seq = store.all('medicalRecords').reduce((m, r) => Math.max(m, +String(r.mrdNo).split('/').pop() || 0), 0) + 1;
    const r = store.insert('medicalRecords', { id, mrdNo: `MRD/${yr}/${String(seq).padStart(5, '0')}`, patientId: d.patientId, episodeType: d.episodeType || 'IP', ipNo: d.ipNo || null, admittedAt: d.admittedAt, dischargedAt: d.dischargedAt || null,
      ward: d.ward || '', doctor: d.doctor || '', diagnosis: d.diagnosis || '', icd10: d.icd10 || '', procedures: d.procedures || '', documents: [], status: 'OPEN', location: 'With ward', codedBy: null, codedAt: null, createdAt: now(), createdBy: user.id, source: 'MANUAL' });
    audit(user, 'MRD_RECORD_CREATED', 'MRD', id, `${r.mrdNo} · ${store.get('patients', d.patientId).name}`);
    return r;
  });
}
export function updateRecord(id, patch, user) {
  mustManage(user);
  return store.transaction(() => { const r = store.update('medicalRecords', id, patch); audit(user, 'MRD_RECORD_UPDATED', 'MRD', id, Object.keys(patch).join(', ')); return r; });
}
export function codeAndFile(id, { diagnosis, icd10, procedures, location }, user) {
  mustManage(user);
  if (!diagnosis?.trim() || !icd10?.trim()) throw new Error('Enter the final diagnosis and its ICD-10 code.');
  if (!/^[A-Z]\d{2}(\.\d{1,2})?$/i.test(icd10.trim())) throw new Error('ICD-10 code looks wrong (example: J18.9).');
  if (!location?.trim()) throw new Error('Enter where the file is kept (rack / shelf).');
  const r = store.get('medicalRecords', id);
  if (!r.dischargedAt) throw new Error('Record the discharge date first.');
  return store.transaction(() => {
    Object.assign(r, { diagnosis: diagnosis.trim(), icd10: icd10.trim().toUpperCase(), procedures: procedures || '', location: location.trim(), status: 'FILED', codedBy: user.id, codedAt: now() });
    audit(user, 'MRD_CODED_FILED', 'MRD', id, `${r.icd10} · ${r.location}`);
    return r;
  });
}
export async function addDocument(id, file, user) {
  mustManage(user);
  if (file.size > (store.settings().maxFileSizeMB || 5) * 1048576) throw new Error(`${file.name} is larger than ${store.settings().maxFileSizeMB || 5} MB.`);
  const docId = `DOC-${Date.now().toString(36).toUpperCase()}`;
  await saveBlob(docId, file);
  return store.transaction(() => { const r = store.get('medicalRecords', id); r.documents.push({ id: docId, name: file.name, type: file.type, size: file.size, at: now(), by: user.id }); audit(user, 'MRD_DOCUMENT_ADDED', 'MRD', id, file.name); return r; });
}

// ---------------- discharge summaries ----------------
export const template = (id) => store.hs().dischargeTemplates.find((t) => t.id === id);
export const sectionLabel = (k) => store.hs().dischargeSections[k] || k;
export function createSummary(recordId, templateId, user) {
  mustManage(user);
  if (store.all('dischargeSummaries').some((d) => d.recordId === recordId)) throw new Error('This record already has a discharge summary.');
  const r = store.get('medicalRecords', recordId);
  return store.transaction(() => {
    const id = store.nextId('dischargeSummaries', 'DS-');
    const sections = Object.fromEntries(template(templateId).sections.map((k) => [k, '']));
    if (sections.diagnosis !== undefined && r.diagnosis) sections.diagnosis = r.diagnosis + (r.icd10 ? ` (${r.icd10})` : '');
    if (sections.procedures !== undefined && r.procedures) sections.procedures = r.procedures;
    const d = store.insert('dischargeSummaries', { id, recordId, patientId: r.patientId, templateId, sections, status: 'DRAFT', preparedBy: user.id, preparedAt: now(), reviewedBy: null, reviewedAt: null, finalizedAt: null, printCount: 0, history: [{ at: now(), by: user.id, action: 'Started' }] });
    audit(user, 'DISCHARGE_SUMMARY_STARTED', 'DS', id, template(templateId).name);
    return d;
  });
}
export function saveSummary(id, sections, user, submit = false) {
  mustManage(user);
  const d = store.get('dischargeSummaries', id);
  if (d.status === 'FINAL') throw new Error('A final summary cannot be edited.');
  if (submit) { const empty = Object.entries({ ...d.sections, ...sections }).filter(([, v]) => !String(v || '').trim()).map(([k]) => sectionLabel(k)); if (empty.length) throw new Error(`Fill every section before sending for review: ${empty.join(', ')}.`); }
  return store.transaction(() => {
    d.sections = { ...d.sections, ...sections };
    if (submit) { d.status = 'PENDING_REVIEW'; d.history.push({ at: now(), by: user.id, action: 'Sent for review' }); notify({ type: 'DS_REVIEW', category: 'Discharge summary', severity: 'info', title: `Discharge summary to review — ${store.get('patients', d.patientId).name}`, message: `${id} is ready for review and sign-off.`, refType: 'DS', refId: id, targetRoles: ['SUPER_ADMIN'] }); }
    else d.history.push({ at: now(), by: user.id, action: 'Saved' });
    audit(user, submit ? 'DISCHARGE_SUMMARY_SUBMITTED' : 'DISCHARGE_SUMMARY_SAVED', 'DS', id, '');
    return d;
  });
}
export function reviewSummary(id, approve, note, user) {
  if (!can('mrd.review', user)) throw new Error('Only the reviewing doctor / Super Admin can finalise a summary.');
  if (!approve && !note?.trim()) throw new Error('Say what needs to change.');
  return store.transaction(() => {
    const d = store.get('dischargeSummaries', id);
    if (d.status !== 'PENDING_REVIEW') throw new Error('This summary is not waiting for review.');
    Object.assign(d, { status: approve ? 'FINAL' : 'RETURNED', reviewedBy: user.id, reviewedAt: now(), finalizedAt: approve ? now() : null });
    d.history.push({ at: now(), by: user.id, action: approve ? 'Reviewed & finalised' : 'Sent back: ' + note });
    audit(user, approve ? 'DISCHARGE_SUMMARY_FINALISED' : 'DISCHARGE_SUMMARY_RETURNED', 'DS', id, note || '');
    if (!approve) notify({ type: 'DS_RETURNED', category: 'Discharge summary', severity: 'warning', title: `Discharge summary sent back — ${id}`, message: note, refType: 'DS', refId: id, targetRoles: ['MRD'] });
    return d;
  });
}
export function markSummaryPrinted(id, user) { return store.transaction(() => { const d = store.get('dischargeSummaries', id); d.printCount = (d.printCount || 0) + 1; d.history.push({ at: now(), by: user.id, action: 'Printed' }); audit(user, 'DISCHARGE_SUMMARY_PRINTED', 'DS', id, `copy ${d.printCount}`); return d; }); }

// ---------------- retrieval register ----------------
export function issueRecord(recordId, { reason, requestedBy }, user) {
  mustManage(user);
  if (!reason) throw new Error('Choose the reason for retrieval.');
  const r = store.get('medicalRecords', recordId);
  if (store.all('mrdRetrievals').some((x) => x.recordId === recordId && x.status === 'ISSUED')) throw new Error('This file is already issued out.');
  return store.transaction(() => {
    const x = store.insert('mrdRetrievals', { id: store.nextId('mrdRetrievals', 'RTV-'), recordId, requestedBy: requestedBy || user.id, reason, at: now(), issuedBy: user.id, issuedAt: now(), returnedAt: null, status: 'ISSUED' });
    audit(user, 'MRD_FILE_ISSUED', 'MRD', recordId, `${r.mrdNo} · ${reason}`);
    return x;
  });
}
export function returnRecord(retrievalId, user) {
  mustManage(user);
  return store.transaction(() => { const x = store.get('mrdRetrievals', retrievalId); Object.assign(x, { status: 'RETURNED', returnedAt: now() }); audit(user, 'MRD_FILE_RETURNED', 'MRD', x.recordId, ''); return x; });
}
