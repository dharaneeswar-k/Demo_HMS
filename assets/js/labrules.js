// Lab safety & compliance rules that do not depend on the billing engine (see docs/LAB_COMPLIANCE_AUDIT.md):
//  • reference ranges by age / sex / pregnancy (F6, phase 2 P2-01) — pick the band that fits the patient
//  • who may sign (verify) a report (F1)
//  • confidential tests such as HIV (F4) and notifiable diseases such as TB (F5) — both are per-test switches in the
//    Lab Test Master, so the hospital decides which tests they apply to; an unticked test is handled like any other.
import { store } from './data-service.js';
import { can } from './auth.js';

const DAY = 86400000;
export const labCfg = () => store.hs().lab || {};
export const SEX = { ANY: 'Any', M: 'Male', F: 'Female' };
export const NOTIFIABLE = { TB: { label: 'TB — notify on Ni-kshay', short: 'TB', portal: 'Ni-kshay' }, IDSP: { label: 'IDSP — notify to IHIP', short: 'IDSP', portal: 'IHIP' } };

// ---------------- reference ranges ----------------
/** Age in whole days on a given date (collection time), from DOB or the recorded age in years. */
export function ageInDays(p, at) {
  if (!p) return null;
  const ref = new Date(at || Date.now());
  if (p.dob) { const d = new Date(p.dob + 'T00:00:00'); if (!Number.isNaN(d.getTime())) return Math.max(0, Math.floor((ref - d) / DAY)); }
  if (p.age !== '' && p.age != null && !Number.isNaN(Number(p.age))) return Math.round(Number(p.age) * 365);
  return null;
}
/** Text like "1–12 y" / "0–30 d" for a band's age limits. */
export function ageText(b) {
  const f = (d) => (d == null ? null : d < 365 ? `${d} d` : `${Math.round(d / 365)} y`);
  const a = f(b.ageFromDays ?? 0); const z = f(b.ageToDays);
  return z ? `${a} – ${z}` : (b.ageFromDays ? `${a} and above` : 'All ages');
}
const span = (b) => (b.ageToDays ?? 54750) - (b.ageFromDays ?? 0);
const exactSex = (b) => (b.sex && b.sex !== 'ANY' ? 1 : 0);
/** The most specific range band that matches (rules R1-2 / R1-3 of the phase 2 spec), or null for the default range. */
export function pickBand(param, ctx) {
  const bands = param?.ranges || []; if (!bands.length || !ctx) return null;
  const { sex, days, pregnant } = ctx;
  const m = bands.filter((b) => (!b.sex || b.sex === 'ANY' || b.sex === sex)
    && (days == null ? !b.ageFromDays && b.ageToDays == null : days >= (b.ageFromDays ?? 0) && (b.ageToDays == null || days <= b.ageToDays))
    && (b.pregnant == null || (b.pregnant ? pregnant === true : pregnant !== true)));
  m.sort((a, b) => span(a) - span(b) || (b.pregnant != null) - (a.pregnant != null) || exactSex(b) - exactSex(a));
  return m[0] || null;
}
/** The parameter as it applies to this patient: low / high / critical limits of the matching band + its label. */
export function resolveParam(p, ctx) {
  if (!p || p.ref !== undefined || !p.ranges?.length) { if (!p?.ranges) return p; const { ranges, ...rest } = p; return rest; }
  const { ranges, ...base } = p; const b = pickBand(p, ctx);
  if (!b) return { ...base, rangeLabel: 'Default range' };
  const pick = (k) => (b[k] != null && b[k] !== '' ? Number(b[k]) : base[k]);
  return { ...base, low: pick('low'), high: pick('high'), critLow: pick('critLow'), critHigh: pick('critHigh'), rangeLabel: b.label || 'Range' };
}
/** Who the order is for: sex, age in days on the collection date, pregnancy (asked at billing / on the SID page). */
export function rangeCtx(o) {
  const p = store.get('patients', o.patientId); if (!p) return null;
  const v = o.labVisitId ? store.get('labVisits', o.labVisitId) : null;
  return { sex: p.gender, days: ageInDays(p, o.lab?.collectedAt || o.billedAt || undefined), pregnant: v?.pregnant ?? null };
}
/** Does any of these tests have a pregnancy-specific band? (decides whether billing asks "Pregnant?") */
export const hasPregnancyBand = (tests) => tests.some((t) => (t.lab?.parameters || []).some((p) => (p.ranges || []).some((b) => b.pregnant === true)));
/** Women of child-bearing age (12–55) — the only patients asked about pregnancy. */
export function mayBePregnant(p) { if (!p || p.gender !== 'F') return false; const d = ageInDays(p); return d == null || (d >= 12 * 365 && d <= 55 * 365); }

/** Problems in a parameter's range bands (used by the Test Master validation). */
export function bandProblems(p, at) {
  const e = []; const bands = p.ranges || [];
  bands.forEach((b, i) => {
    const n = `${at}, range "${b.label || i + 1}"`;
    if (!String(b.label || '').trim()) e.push(`${at}: give every range a name (e.g. Child 1–12 y).`);
    if (b.low == null || b.high == null) e.push(`${n}: enter both low and high.`);
    else if (b.low > b.high) e.push(`${n}: low is more than high.`);
    if (b.ageFromDays != null && b.ageToDays != null && b.ageFromDays > b.ageToDays) e.push(`${n}: age "from" is after age "to".`);
    if (b.critLow != null && b.low != null && b.critLow >= b.low) e.push(`${n}: critical low must be below the low.`);
    if (b.critHigh != null && b.high != null && b.critHigh <= b.high) e.push(`${n}: critical high must be above the high.`);
  });
  // same sex + same pregnancy setting must not overlap in age (R1-6)
  bands.forEach((a, i) => bands.slice(i + 1).forEach((b) => {
    const sameSex = (a.sex || 'ANY') === (b.sex || 'ANY'); const samePreg = (a.pregnant ?? null) === (b.pregnant ?? null);
    const overlap = (a.ageFromDays ?? 0) <= (b.ageToDays ?? Infinity) && (b.ageFromDays ?? 0) <= (a.ageToDays ?? Infinity);
    if (sameSex && samePreg && overlap) e.push(`${at}: ranges "${a.label}" and "${b.label}" overlap in age for the same patients.`);
  }));
  return e;
}

// ---------------- who signs ----------------
/** May this user verify (sign) a report? Needs lab.verify, and — when the setting is on — to be an authorised signatory. */
export const canSign = (user) => can('lab.verify', user) && (!labCfg().signatoryOnly || !!user?.signatory);
/** Active users who may sign lab reports (the doctors the verify queue waits for). */
export const signatories = () => store.all('users').filter((u) => u.active !== false && canSign(u));
export const signatoryText = (u) => (u ? [u.qualification, u.regNo ? `Reg. No. ${u.regNo}` : ''].filter(Boolean).join(' · ') : '');

// ---------------- confidential & notifiable tests ----------------
const svcOf = (o) => store.get('services', o.serviceId);
export const isConfidential = (o) => !!svcOf(o)?.lab?.confidential;
export const notifiableOf = (o) => svcOf(o)?.lab?.notifiable || null;
/** Lab staff (and the owner, who has every permission) see confidential results; others see "Restricted". */
export const canSeeConfidential = (user) => can('lab.work', user) || can('lab.verify', user);
