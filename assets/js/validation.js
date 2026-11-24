// Validation rules for GRNs and master forms.
import { store } from './data-service.js';
import { daysUntil, grnTotals, lineCalc, medName } from './calculations.js';
import { ymd } from './utils.js';

/**
 * Validate a GRN.
 * errors   → block submission
 * warnings → shown on review, staff must acknowledge
 * exceptions → conditions that escalate the GRN to owner approval at posting time
 */
export function validateGrn(g) {
  const errors = []; const warnings = []; const exceptions = [];
  const s = store.settings(); const ap = s.approval || {};
  const E = (msg, step, line) => errors.push({ msg, step, line });
  const W = (msg, step, line) => warnings.push({ msg, step, line });

  // Step 1
  if (!g.supplierId) E('Supplier is required.', 1);
  const sup = g.supplierId && store.get('suppliers', g.supplierId);
  if (sup && sup.status !== 'ACTIVE') { W(`Supplier ${sup.name} is marked inactive.`, 1); exceptions.push(`Supplier ${sup.name} is inactive`); }
  if (!g.invoiceNo?.trim()) E('Supplier invoice number is required.', 1);
  if (!g.invoiceDate) E('Invoice date is required.', 1);
  else if (g.invoiceDate > ymd()) E('Invoice date cannot be in the future.', 1);
  if (!g.locationId) E('Receiving location is required.', 1);
  if (g.invoiceNo?.trim() && g.supplierId) {
    const dup = store.all('grns').find((x) => x.id !== g.id && x.supplierId === g.supplierId && x.invoiceNo.trim().toLowerCase() === g.invoiceNo.trim().toLowerCase() && !['CANCELLED', 'REJECTED'].includes(x.status));
    if (dup) E(`Duplicate GRN: invoice ${g.invoiceNo} from this supplier is already recorded in ${dup.id} (${dup.status}).`, 1);
  }

  // Step 2
  if (!g.attachments?.invoice) E('Supplier invoice document is mandatory.', 2);
  if (!g.attachments?.photos?.length) E('At least one delivery / stock photograph is mandatory.', 2);

  // Step 3
  const items = g.items || [];
  if (!items.length) E('Add at least one medicine line.', 3);
  const seen = new Map();
  items.forEach((it, i) => {
    const L = i + 1; const name = it.medicineId ? medName(it.medicineId) : `Line ${L}`;
    if (!it.medicineId) E(`Line ${L}: select a medicine.`, 3, L);
    if (!it.batchNo?.trim()) E(`Line ${L} (${name}): batch number is missing.`, 3, L);
    if (!it.expiryDate) E(`Line ${L} (${name}): expiry date is missing.`, 3, L);
    if (!it.mfgDate) E(`Line ${L} (${name}): manufacturing date is missing.`, 3, L);
    else if (it.mfgDate > ymd()) E(`Line ${L} (${name}): manufacturing date cannot be in the future.`, 3, L);
    else if (it.expiryDate && it.mfgDate >= it.expiryDate) E(`Line ${L} (${name}): manufacturing date must be before the expiry date.`, 3, L);
    const rq = Number(it.receivedQty); const fq = Number(it.freeQty || 0); const iq = Number(it.invoiceQty);
    if (!(rq > 0) || !Number.isInteger(rq)) E(`Line ${L} (${name}): received quantity must be a whole number greater than 0.`, 3, L);
    if (fq < 0 || !Number.isInteger(fq)) E(`Line ${L} (${name}): free quantity cannot be negative.`, 3, L);
    if (it.invoiceQty !== '' && it.invoiceQty != null && (iq < 0 || !Number.isInteger(iq))) E(`Line ${L} (${name}): invoice quantity is invalid.`, 3, L);
    if (!(Number(it.ptr) > 0)) E(`Line ${L} (${name}): purchase rate (PTR) must be greater than 0.`, 3, L);
    if (!(Number(it.mrp) > 0)) E(`Line ${L} (${name}): MRP must be greater than 0.`, 3, L);
    if (Number(it.ptr) > 0 && Number(it.mrp) > 0 && Number(it.ptr) > Number(it.mrp)) W(`Line ${L} (${name}): PTR is higher than MRP — please re-check the invoice.`, 3, L);
    const disc = Number(it.discountPct || 0); if (disc < 0 || disc > 100) E(`Line ${L} (${name}): discount must be between 0 and 100%.`, 3, L);
    if (it.expiryDate) {
      const d = daysUntil(it.expiryDate);
      if (d < 0) {
        W(`Line ${L} (${name}): batch ${it.batchNo || ''} is already EXPIRED (${it.expiryDate}). Owner approval is required and the batch will be blocked from issue.`, 3, L);
        exceptions.push(`${name} batch ${it.batchNo} delivered already expired (${it.expiryDate})`);
      }
      else if (d <= (ap.shortDatedDays || 30)) { W(`Line ${L} (${name}): short-dated batch — expires in ${d} day(s).`, 3, L); if (ap.ownerApprovalForExpiredOrShortDated) exceptions.push(`${name} batch ${it.batchNo} expires in ${d} day(s)`); }
      else if (d <= (s.expiryThresholdDays || 90)) W(`Line ${L} (${name}): near-expiry batch — expires in ${d} day(s).`, 3, L);
    }
    if (rq > 0 && it.invoiceQty !== '' && it.invoiceQty != null && iq !== rq) {
      const pct = iq ? Math.abs(rq - iq) / iq * 100 : 100;
      W(`Line ${L} (${name}): invoice quantity ${iq} vs received ${rq} (${pct.toFixed(1)}% variance).`, 3, L);
      if (pct > (ap.discrepancyPctThreshold || 10)) exceptions.push(`${name}: quantity variance ${pct.toFixed(1)}% (invoice ${iq}, received ${rq})`);
    }
    if (it.medicineId && it.batchNo?.trim()) {
      const k = it.medicineId + '|' + it.batchNo.trim().toUpperCase();
      if (seen.has(k)) E(`Line ${L} (${name}): duplicate batch ${it.batchNo} — already entered on line ${seen.get(k)}. Combine the quantities into one line.`, 3, L);
      else seen.set(k, L);
      const existing = store.all('batches').find((b) => b.medicineId === it.medicineId && b.batchNo.toUpperCase() === it.batchNo.trim().toUpperCase());
      if (existing && (existing.expiryDate !== it.expiryDate || Number(existing.mrp) !== Number(it.mrp)))
        W(`Line ${L} (${name}): batch ${it.batchNo} already exists in inventory with expiry ${existing.expiryDate} and MRP ₹${existing.mrp}. Values differ — verify with the physical pack.`, 3, L);
    }
    const med = it.medicineId && store.get('medicines', it.medicineId);
    if (med && !med.active) W(`Line ${L}: ${med.brandName} is marked inactive in the medicine master.`, 3, L);
  });

  const t = grnTotals(g);
  if (Number(g.invoiceAmount) > 0 && items.length) {
    const diff = Math.abs(t.grand - Number(g.invoiceAmount));
    if (diff > Math.max(1, Number(g.invoiceAmount) * 0.01)) W(`Invoice amount ₹${Number(g.invoiceAmount).toFixed(2)} differs from calculated grand total ₹${t.grand.toFixed(2)}.`, 4);
  }
  if (t.grand > (ap.highValueThreshold || Infinity)) exceptions.push(`High-value receipt (₹${t.grand.toFixed(0)} exceeds ₹${ap.highValueThreshold})`);
  return { errors, warnings, exceptions, ok: errors.length === 0 };
}

export const lineIssues = (g, lineNo) => {
  const v = validateGrn(g);
  return { errors: v.errors.filter((e) => e.line === lineNo), warnings: v.warnings.filter((w) => w.line === lineNo) };
};

// Simple field validators used by master forms
export const rules = {
  required: (v) => (String(v ?? '').trim() ? null : 'This field is required.'),
  phone: (v) => (!v || /^[+\d][\d\s-]{7,16}$/.test(v) ? null : 'Enter a valid phone number.'),
  email: (v) => (!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Enter a valid email address.'),
  gstin: (v) => (!v || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v) ? null : 'GSTIN format: 33AAAAA0000A1Z5'),
  nonNegInt: (v) => (v === '' || (Number.isInteger(Number(v)) && Number(v) >= 0) ? null : 'Enter a whole number ≥ 0.'),
  positive: (v) => (Number(v) > 0 ? null : 'Must be greater than 0.')
};
/** Validate a <form> whose inputs carry data-rules="required,email". Shows inline errors. */
export function validateForm(form) {
  let ok = true;
  form.querySelectorAll('[data-rules]').forEach((inp) => {
    const field = inp.closest('.field');
    const msg = inp.dataset.rules.split(',').map((r) => rules[r.trim()]?.(inp.value)).find(Boolean);
    field?.classList.toggle('has-error', !!msg);
    let e = field?.querySelector('.field-error');
    if (msg && field) { if (!e) { e = document.createElement('div'); e.className = 'field-error'; field.appendChild(e); } e.textContent = msg; }
    else e?.remove();
    if (msg) ok = false;
  });
  if (!ok) form.querySelector('.has-error input, .has-error select, .has-error textarea')?.focus();
  return ok;
}
export { lineCalc };
