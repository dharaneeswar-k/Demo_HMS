// Lab Test Master — the single list of tests the hospital lab offers. Reception bills from it, the lab collects,
// enters and reports from it, ward orders and packages pick from it. Only Admin and Super Admin (permission
// `labtest.manage`) can change it; every change is validated, versioned, audited and announced to the counters.
// Past reports never change: before a test's format is edited, every order that already has results keeps a frozen
// copy of the format it was reported with.
import { store } from './data-service.js';
import { can } from './auth.js';
import { audit } from './services.js';
import { notify } from './notifications.js';
import { hs } from './hospital.js';
import { resolveParam, rangeCtx, bandProblems, NOTIFIABLE } from './labrules.js';

const now = () => new Date().toISOString();
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

export const DEFAULT_DEPARTMENTS = ['Haematology', 'Biochemistry', 'Clinical Pathology', 'Immunoassay', 'Serology', 'Microbiology', 'Histopathology'];
/** Sample types offered in the editor; each maps to the tube (container) the label and collection screen show. */
export const SAMPLE_TYPES = [
  { sample: 'Blood (EDTA)', container: 'EDTA' }, { sample: 'Blood (Plain)', container: 'PLAIN' }, { sample: 'Blood (Fluoride)', container: 'FLUORIDE' },
  { sample: 'Urine (random)', container: 'URINE' }, { sample: 'Urine (24 hours)', container: 'URINE' }, { sample: 'Stool', container: 'URINE' }, { sample: 'Sputum', container: 'URINE' }, { sample: 'Swab', container: 'PLAIN' }
];
export const labTests = ({ includeInactive = true } = {}) => store.all('services').filter((s) => s.category === 'LAB' && (includeInactive || s.active)).sort((a, b) => a.name.localeCompare(b.name));
export const departments = () => [...new Set([...DEFAULT_DEPARTMENTS, ...labTests().map((t) => t.lab.department)])].sort();
export const canManageTests = (user) => can('labtest.manage', user);
export const isQualitative = (p) => p.ref !== undefined && p.ref !== null;

/** How much the test is used — shown before deactivating and on the editor. */
export function labTestUsage(id) {
  const os = store.all('orders').filter((o) => o.serviceId === id);
  const pending = os.filter((o) => ['REQUESTED', 'ON_HOLD', 'READY', 'SAMPLE_COLLECTED', 'RESULTED'].includes(o.status));
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  return { total: os.filter((o) => o.status !== 'CANCELLED').length, last30: os.filter((o) => o.status !== 'CANCELLED' && (o.billedAt || o.requestedAt || '') >= since).length, pending: pending.length,
    packages: store.all('packages').filter((p) => (p.includes || []).some((x) => x.serviceId === id)) };
}

const AGE_MUL = { d: 1, m: 30, y: 365 };
const ageDays = (v, u = 'y') => (num(v) == null ? null : Math.round(num(v) * (AGE_MUL[u] || 365)));
/** Days → { value, unit } for the editor (whole years when possible). */
export const ageParts = (d) => (d == null ? { v: '', u: 'y' } : d % 365 === 0 && d > 0 ? { v: d / 365, u: 'y' } : d % 30 === 0 && d >= 30 && d < 365 ? { v: d / 30, u: 'm' } : d === 0 ? { v: 0, u: 'y' } : { v: d, u: 'd' });
/** Clean a draft from the editor into the stored shape. */
export function normalise(d) {
  const st = SAMPLE_TYPES.find((x) => x.sample === d.sample);
  return {
    code: String(d.code || '').trim().toUpperCase(), name: String(d.name || '').trim(), price: num(d.price), active: d.active !== false,
    lab: {
      department: String(d.department || '').trim(), sample: String(d.sample || '').trim(), container: d.container || st?.container || 'PLAIN',
      tatHours: num(d.tatHours), rxRequired: !!d.rxRequired, consentRequired: !!d.consentRequired, confidential: !!d.confidential, notifiable: NOTIFIABLE[d.notifiable] ? d.notifiable : null, method: String(d.method || '').trim(), note: String(d.note || '').trim(),
      kits: (d.kits || []).filter((k) => k.kitId).map((k) => ({ kitId: k.kitId, qty: num(k.qty) })),
      parameters: (d.parameters || []).filter((p) => String(p.name || '').trim()).map((p) => (p.type === 'TEXT'
        ? { name: p.name.trim(), unit: String(p.unit || '').trim(), ref: String(p.ref || '').trim() }
        : { name: p.name.trim(), unit: String(p.unit || '').trim(), low: num(p.low), high: num(p.high), critLow: num(p.critLow), critHigh: num(p.critHigh),
          ...((p.ranges || []).length ? { ranges: p.ranges.map((b) => ({ label: String(b.label || '').trim(), sex: ['M', 'F'].includes(b.sex) ? b.sex : 'ANY', ageFromDays: ageDays(b.ageFrom, b.ageFromUnit) ?? 0, ageToDays: ageDays(b.ageTo, b.ageToUnit),
            pregnant: b.pregnant === 'Y' || b.pregnant === true ? true : null, low: num(b.low), high: num(b.high), critLow: num(b.critLow), critHigh: num(b.critHigh) })) } : {}) }))
    }
  };
}

/** Every rule a test must pass. Returns a list of plain-language problems (empty = OK). */
export function validateLabTest(t, id = null) {
  const e = [];
  if (!t.name) e.push('Enter the test name.');
  if (!t.code) e.push('Enter a short code (for example CBC).');
  else if (!/^[A-Z0-9][A-Z0-9-]{1,11}$/.test(t.code)) e.push('Code: 2–12 letters, numbers or “-”, no spaces.');
  else if (store.all('services').some((s) => s.code === t.code && s.id !== id)) e.push(`Code ${t.code} is already used by another service.`);
  if (t.name && store.all('services').some((s) => s.category === 'LAB' && s.id !== id && s.name.toLowerCase() === t.name.toLowerCase())) e.push('Another test already has this name.');
  if (t.price == null || t.price < 0) e.push('Enter a price of ₹0 or more.');
  if (!t.lab.department) e.push('Choose the department.');
  if (!t.lab.sample) e.push('Choose the sample type.');
  if (!hs().lab.containers[t.lab.container]) e.push('Choose a valid tube / container.');
  if (t.lab.tatHours == null || t.lab.tatHours <= 0 || t.lab.tatHours > 720) e.push('Turnaround must be between 1 and 720 hours.');
  if (!t.lab.parameters.length) e.push('Add at least one result parameter (what the report shows).');
  const seen = new Set();
  t.lab.parameters.forEach((p, i) => {
    const at = `Parameter ${i + 1} (${p.name})`;
    if (seen.has(p.name.toLowerCase())) e.push(`${at}: the name is repeated.`); seen.add(p.name.toLowerCase());
    if (isQualitative(p)) { if (!p.ref) e.push(`${at}: enter the normal result (for example Negative).`); return; }
    if (p.low == null || p.high == null) e.push(`${at}: enter both normal low and normal high.`);
    else if (p.low > p.high) e.push(`${at}: normal low is more than normal high.`);
    if (p.critLow != null && p.low != null && p.critLow >= p.low) e.push(`${at}: critical low must be below the normal low.`);
    if (p.critHigh != null && p.high != null && p.critHigh <= p.high) e.push(`${at}: critical high must be above the normal high.`);
    e.push(...bandProblems(p, at));
  });
  const kitIds = new Set();
  t.lab.kits.forEach((k) => { const kit = store.get('labKits', k.kitId); if (!kit) e.push('A reagent kit in the list no longer exists.'); else { if (kitIds.has(k.kitId)) e.push(`${kit.name} is listed twice.`); kitIds.add(k.kitId); if (k.qty == null || k.qty <= 0) e.push(`${kit.name}: quantity per test must be more than 0.`); } });
  return e;
}

/** Human-readable list of what changed between two versions (for the history and the audit log). */
export function diffLabTest(a, b) {
  if (!a) return ['Test created'];
  const c = []; const ch = (label, x, y) => { if (JSON.stringify(x ?? '') !== JSON.stringify(y ?? '')) c.push(`${label}: ${x === '' || x == null ? '—' : x} → ${y === '' || y == null ? '—' : y}`); };
  ch('Name', a.name, b.name); ch('Code', a.code, b.code); ch('Price ₹', a.price, b.price);
  ch('Department', a.lab.department, b.lab.department); ch('Sample', a.lab.sample, b.lab.sample); ch('Tube', a.lab.container, b.lab.container); ch('Turnaround (h)', a.lab.tatHours, b.lab.tatHours);
  ch('Prescription needed', a.lab.rxRequired ? 'Yes' : 'No', b.lab.rxRequired ? 'Yes' : 'No'); ch('Consent needed', a.lab.consentRequired ? 'Yes' : 'No', b.lab.consentRequired ? 'Yes' : 'No');
  ch('Confidential', a.lab.confidential ? 'Yes' : 'No', b.lab.confidential ? 'Yes' : 'No'); ch('Notifiable disease', a.lab.notifiable || 'No', b.lab.notifiable || 'No');
  ch('Method', a.lab.method, b.lab.method); ch('Report note', a.lab.note, b.lab.note);
  const fmtP = (p) => (isQualitative(p) ? `${p.ref}` : `${p.low}–${p.high}${p.unit ? ' ' + p.unit : ''}${p.critLow != null || p.critHigh != null ? ` (critical ${p.critLow ?? '—'}/${p.critHigh ?? '—'})` : ''}${(p.ranges || []).length ? ` + ${p.ranges.length} age/sex range(s): ${p.ranges.map((b) => `${b.label} ${b.low}–${b.high}`).join(', ')}` : ''}`);
  const am = new Map(a.lab.parameters.map((p) => [p.name, p])); const bm = new Map(b.lab.parameters.map((p) => [p.name, p]));
  bm.forEach((p, n) => { if (!am.has(n)) c.push(`Parameter added: ${n} ${fmtP(p)}`); else if (JSON.stringify(am.get(n)) !== JSON.stringify(p)) c.push(`${n}: ${fmtP(am.get(n))} → ${fmtP(p)}`); });
  am.forEach((p, n) => { if (!bm.has(n)) c.push(`Parameter removed: ${n}`); });
  if (c.length === 0 && JSON.stringify(a.lab.parameters.map((p) => p.name)) !== JSON.stringify(b.lab.parameters.map((p) => p.name))) c.push('Parameter order changed');
  const kn = (ks) => ks.map((k) => `${k.qty} × ${store.get('labKits', k.kitId)?.name || k.kitId}`).join(', ') || 'none';
  if (kn(a.lab.kits) !== kn(b.lab.kits)) c.push(`Kits: ${kn(a.lab.kits)} → ${kn(b.lab.kits)}`);
  if (a.active !== b.active) c.push(b.active ? 'Made available again' : 'Stopped (inactive)');
  return c;
}

/** Freeze the current format into every order of this test that already has results, so old reports stay as printed. */
function freezeReportedOrders(id) {
  const cur = store.get('services', id)?.lab?.parameters || [];
  store.all('orders').filter((o) => o.serviceId === id && o.lab && !o.lab.params && (o.lab.results || []).length).forEach((o) => { const ctx = rangeCtx(o); o.lab.params = cur.map((p) => resolveParam(p, ctx)); });
}

/** Create or update a test. `reason` is required when changing an existing test. */
export function saveLabTest(draft, { id = null, reason = '' } = {}, user) {
  if (!canManageTests(user)) throw new Error('Only Admin or Super Admin can change the lab test master.');
  const t = normalise(draft); const errs = validateLabTest(t, id);
  if (errs.length) { const err = new Error(errs[0]); err.list = errs; throw err; }
  const before = id ? store.get('services', id) : null;
  if (id && !before) throw new Error('This test no longer exists.');
  const changes = diffLabTest(before, { ...t, active: before ? before.active : t.active });
  if (before && !changes.length) throw new Error('Nothing was changed.');
  if (before && !String(reason).trim()) throw new Error('Write the reason for this change (it is kept in the history).');
  return store.transaction(() => {
    const entry = { at: now(), by: user.id, version: (before?.version || 1) + (before ? 1 : 0), reason: before ? reason.trim() : 'New test', changes };
    let rec;
    if (before) {
      freezeReportedOrders(id);
      rec = store.update('services', id, { code: t.code, name: t.name, price: t.price, lab: t.lab, version: entry.version, updatedAt: entry.at, updatedBy: user.id, history: [...(before.history || []), entry] });
    } else {
      rec = store.insert('services', { id: store.nextId('services', 'SRV-'), code: t.code, name: t.name, category: 'LAB', price: t.price, active: t.active, lab: t.lab, version: 1, createdAt: entry.at, createdBy: user.id, updatedAt: entry.at, updatedBy: user.id, history: [entry] });
    }
    audit(user, before ? 'LAB_TEST_UPDATED' : 'LAB_TEST_CREATED', 'SERVICE', rec.id, `${rec.code} v${rec.version}: ${changes.join('; ')}${before ? ` — ${reason.trim()}` : ''}`);
    const priceMoved = before && before.price !== t.price;
    if (!before || priceMoved) notify({ type: 'LAB_MASTER_CHANGED', category: 'Laboratory', severity: 'info', title: before ? `Lab price changed — ${rec.name}` : `New lab test — ${rec.name}`,
      message: before ? `₹${before.price} → ₹${t.price} from now. Bills already made keep the old price.` : `${rec.code} · ₹${rec.price} · ${rec.lab.sample}. Available for billing now.`, refType: 'SERVICE', refId: rec.id, targetRoles: ['RECEPTION', 'LAB', 'SUPER_ADMIN', 'ADMIN'] });
    return rec;
  });
}

/** Stop or restart offering a test. Pending orders still finish; reception just can't bill it any more. */
export function setLabTestActive(id, active, reason, user) {
  if (!canManageTests(user)) throw new Error('Only Admin or Super Admin can change the lab test master.');
  const t = store.get('services', id); if (!t) throw new Error('This test no longer exists.');
  if (t.active === active) return t;
  if (!String(reason || '').trim()) throw new Error(active ? 'Write why the test is being restarted.' : 'Write why the test is being stopped.');
  return store.transaction(() => {
    const entry = { at: now(), by: user.id, version: (t.version || 1) + 1, reason: reason.trim(), changes: [active ? 'Made available again' : 'Stopped (inactive)'] };
    const rec = store.update('services', id, { active, version: entry.version, updatedAt: entry.at, updatedBy: user.id, history: [...(t.history || []), entry] });
    audit(user, active ? 'LAB_TEST_ACTIVATED' : 'LAB_TEST_DEACTIVATED', 'SERVICE', id, `${t.code}: ${reason.trim()}`);
    notify({ type: 'LAB_MASTER_CHANGED', category: 'Laboratory', severity: active ? 'info' : 'warning', title: `${active ? 'Lab test available again' : 'Lab test stopped'} — ${t.name}`, message: reason.trim(), refType: 'SERVICE', refId: id, targetRoles: ['RECEPTION', 'LAB', 'SUPER_ADMIN', 'ADMIN'] });
    return rec;
  });
}

/** A draft for the editor from a stored test (or a blank one). */
export function toDraft(t) {
  if (!t) return { code: '', name: '', price: '', active: true, department: '', sample: 'Blood (Plain)', container: 'PLAIN', tatHours: 6, rxRequired: false, consentRequired: false, confidential: false, notifiable: '', method: '', note: '', kits: [], parameters: [{ type: 'NUM', name: '', unit: '', low: '', high: '', critLow: '', critHigh: '', ranges: [] }] };
  return { code: t.code, name: t.name, price: t.price, active: t.active, department: t.lab.department, sample: t.lab.sample, container: t.lab.container, tatHours: t.lab.tatHours, rxRequired: !!t.lab.rxRequired, consentRequired: !!t.lab.consentRequired, confidential: !!t.lab.confidential, notifiable: t.lab.notifiable || '', method: t.lab.method || '', note: t.lab.note || '',
    kits: t.lab.kits.map((k) => ({ ...k })), parameters: t.lab.parameters.map((p) => (isQualitative(p) ? { type: 'TEXT', name: p.name, unit: p.unit || '', ref: p.ref } : { type: 'NUM', name: p.name, unit: p.unit || '', low: p.low ?? '', high: p.high ?? '', critLow: p.critLow ?? '', critHigh: p.critHigh ?? '',
      ranges: (p.ranges || []).map((b) => { const f = ageParts(b.ageFromDays ?? 0); const z = ageParts(b.ageToDays); return { label: b.label || '', sex: b.sex || 'ANY', ageFrom: f.v, ageFromUnit: f.u, ageTo: z.v, ageToUnit: z.u, pregnant: b.pregnant ? 'Y' : '', low: b.low ?? '', high: b.high ?? '', critLow: b.critLow ?? '', critHigh: b.critHigh ?? '' }; }) })) };
}
