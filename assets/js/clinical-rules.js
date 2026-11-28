// OP / IP business rules as PURE functions — shared by the app and the seed-data generator (like pricing.js).
// No store access here: callers pass in the records and settings they need.
import { r2 } from './pricing.js';

// ---------------- dates (calendar-day keys, timezone supplied by the caller) ----------------
const addDayKey = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

/**
 * Bed-day plan for an admission.
 * Rule (configurable): every calendar day of the stay is charged once, at the rate of the bed the patient was in
 * at the END of that day (so a mid-day ICU → ward transfer bills the day as ward). The day of discharge is not
 * charged when the patient leaves before the check-out hour — unless it is also the admission day (minimum 1 day).
 *
 * @param stays   [{ bedId, category, from, to|null }] sorted or unsorted
 * @param endTs   ISO time the bill is calculated up to (now for a running bill, discharge/finalisation time for a final bill)
 * @param opts    { checkoutHour, final, dayKey(ts) → 'YYYY-MM-DD', hourOf(ts) → 0..23 }
 * @returns [{ date, bedId, category }]
 */
export function bedDayPlan(stays, endTs, { checkoutHour = 12, final = false, dayKey, hourOf }) {
  const list = [...stays].sort((a, b) => a.from.localeCompare(b.from));
  if (!list.length) return [];
  const first = dayKey(list[0].from); const last = dayKey(endTs);
  const days = [];
  for (let d = first; d <= last; d = addDayKey(d, 1)) {
    let cur = null;
    for (const s of list) if (dayKey(s.from) <= d) cur = s;
    if (!cur) continue;
    days.push({ date: d, bedId: cur.bedId, category: cur.category });
  }
  if (final && days.length > 1 && hourOf(endTs) < checkoutHour) days.pop();
  return days;
}

/** Group a bed-day plan into bill lines: one ROOM line and one NURSING line per bed category. */
export function bedChargeLines(plan, categories) {
  const by = {};
  for (const d of plan) {
    const c = categories[d.category] || { label: d.category, rate: 0, nursing: 0 };
    const k = d.category;
    by[k] ||= { category: d.category, label: c.label, days: 0, rate: c.rate, nursingRate: c.nursing, from: d.date, to: d.date };
    by[k].days++; by[k].to = d.date;
  }
  const lines = [];
  for (const g of Object.values(by)) {
    lines.push({ group: 'ROOM', description: `${g.label} — bed charges`, qty: g.days, rate: g.rate, amount: r2(g.days * g.rate), from: g.from, to: g.to, auto: true });
    if (g.nursingRate) lines.push({ group: 'NURSING', description: `${g.label} — nursing care`, qty: g.days, rate: g.nursingRate, amount: r2(g.days * g.nursingRate), from: g.from, to: g.to, auto: true });
  }
  return lines;
}

/**
 * Insurance / TPA / corporate payer split.
 *   claimable      = net bill − non-payable items
 *   co-pay         = claimable × co-pay %
 *   payer pays     = min(approved amount, claimable − co-pay)
 *   patient pays   = net bill − payer pays   (co-pay + non-payable + anything above the approved amount)
 */
export function payerSplit({ net, nonPayable = 0, approved = 0, coPayPct = 0, selfPay = false }) {
  net = r2(net); nonPayable = r2(Math.min(net, Math.max(0, nonPayable)));
  if (selfPay) return { net, nonPayable, claimable: 0, coPay: 0, payerPays: 0, excess: 0, patientPays: net };
  const claimable = r2(net - nonPayable);
  const coPay = r2(claimable * (Number(coPayPct) || 0) / 100);
  const payerPays = r2(Math.max(0, Math.min(Number(approved) || 0, claimable - coPay)));
  const excess = r2(Math.max(0, claimable - coPay - payerPays));
  return { net, nonPayable, claimable, coPay, payerPays, excess, patientPays: r2(net - payerPays) };
}

/** Simple service bill: Σ qty × rate, a bill-level discount %, rounded to the rupee (healthcare services carry no GST). */
export function priceServices(lines, discountPct = 0) {
  const priced = lines.map((l) => ({ ...l, qty: Number(l.qty) || 0, rate: r2(l.rate), amount: r2((Number(l.qty) || 0) * (Number(l.rate) || 0)) }));
  const gross = r2(priced.reduce((s, l) => s + l.amount, 0));
  const discount = r2(gross * (Number(discountPct) || 0) / 100);
  const beforeRound = r2(gross - discount);
  const total = Math.round(beforeRound);
  return { lines: priced, gross, discountPct: Number(discountPct) || 0, discount, roundOff: r2(total - beforeRound), total };
}

/**
 * OP visit type and fee. A visit to the same doctor within `followUpDays` of the last PAID consultation is a free
 * follow-up (one free follow-up per paid visit); otherwise a patient seen before by that doctor is a revisit.
 * @param history [{ doctorId, date, visitType, status }] earlier visits of this patient (not cancelled)
 */
export function opVisitPolicy({ history, doctor, today, emergency = false, emergencyFee = 0 }) {
  const mine = history.filter((v) => v.doctorId === doctor.id).sort((a, b) => b.date.localeCompare(a.date));
  const lastPaid = mine.find((v) => v.visitType !== 'FOLLOW_UP');
  const freeUsed = lastPaid ? mine.some((v) => v.visitType === 'FOLLOW_UP' && v.date >= lastPaid.date) : false;
  const days = lastPaid ? dayDiff(lastPaid.date, today) : null;
  const followUpValid = !!lastPaid && days <= (doctor.followUpDays || 0) && !freeUsed;
  const validTill = lastPaid ? addDayKey(lastPaid.date, doctor.followUpDays || 0) : null;
  if (emergency) return { visitType: 'EMERGENCY', fee: Math.max(emergencyFee, doctor.fees.new), followUpValid, validTill, lastPaid };
  if (followUpValid) return { visitType: 'FOLLOW_UP', fee: 0, followUpValid, validTill, lastPaid };
  if (mine.length) return { visitType: 'REVISIT', fee: doctor.fees.revisit, followUpValid, validTill, lastPaid };
  return { visitType: 'NEW', fee: doctor.fees.new, followUpValid, validTill, lastPaid };
}

export const bmi = (wKg, hCm) => { const w = Number(wKg); const h = Number(hCm) / 100; return w > 0 && h > 0 ? Math.round(w / (h * h) * 10) / 10 : null; };

/** Flags for out-of-range adult vitals (screening only — the doctor decides). */
export function vitalFlags(v = {}) {
  const f = {};
  const [sys, dia] = String(v.bp || '').split('/').map(Number);
  if (sys && dia) { if (sys >= 140 || dia >= 90) f.bp = 'High'; else if (sys < 90 || dia < 60) f.bp = 'Low'; }
  const p = Number(v.pulse); if (p) { if (p > 100) f.pulse = 'High'; else if (p < 60) f.pulse = 'Low'; }
  const t = Number(v.temp); if (t) { if (t >= 100.4) f.temp = 'Fever'; else if (t < 95) f.temp = 'Low'; }
  const s = Number(v.spo2); if (s && s < 94) f.spo2 = 'Low';
  const r = Number(v.rr); if (r) { if (r > 22) f.rr = 'High'; else if (r < 10) f.rr = 'Low'; }
  const g = Number(v.grbs); if (g) { if (g > 200) f.grbs = 'High'; else if (g < 70) f.grbs = 'Low'; }
  return f;
}
