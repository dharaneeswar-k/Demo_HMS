// Central data service.
// JSON files in /data are the source of truth for the initial demo state.
// localStorage persists every change made in the browser. Uploaded file binaries live in IndexedDB
// (see attachment-store.js) — only attachment metadata is kept in the JSON-shaped store.
import { clone } from './utils.js';

const COLLECTIONS = {
  users: 'users.json',
  roles: 'roles.json',
  categories: 'medicine-categories.json',
  medicines: 'medicines.json',
  suppliers: 'suppliers.json',
  locations: 'stock-locations.json',
  grns: 'grns.json',
  attachments: 'attachments.json',
  batches: 'batches.json',
  movements: 'stock-movements.json',
  adjustments: 'adjustments.json',
  notifications: 'notifications.json',
  audit: 'audit-logs.json',
  settings: 'settings.json',
  // Module 3 — Pharmacy Operations & Billing
  patients: 'patients.json',
  pharmacySettings: 'pharmacy-settings.json',
  bills: 'pharmacy-bills.json',
  billItems: 'pharmacy-bill-items.json',
  payments: 'payment-transactions.json',
  pReturns: 'pharmacy-returns.json',
  pReturnItems: 'pharmacy-return-items.json',
  cancellations: 'bill-cancellations.json',
  closings: 'daily-closings.json',
  closingPayments: 'daily-closing-payments.json',
  stockCounts: 'stock-counts.json',
  transfers: 'stock-transfers.json',
  discountRequests: 'discount-requests.json',
  // Hospital modules — central billing, lab, services, packages, MRD, shifts
  services: 'hospital-services.json',
  labKits: 'lab-kits.json',
  packages: 'packages.json',
  hospitalSettings: 'hospital-settings.json',
  hbills: 'hospital-bills.json',
  orders: 'service-orders.json',
  kitMovements: 'lab-kit-movements.json',
  kitCounts: 'lab-kit-counts.json',
  patientPackages: 'patient-packages.json',
  medicalRecords: 'medical-records.json',
  dischargeSummaries: 'discharge-summaries.json',
  mrdRetrievals: 'mrd-retrievals.json',
  shifts: 'shifts.json'
};
const LS_KEY = 'nallam_hms_store_v1';

let seed = null;
let db = null;
const listeners = new Set();
let version = 0;

async function loadSeed() {
  const entries = await Promise.all(Object.entries(COLLECTIONS).map(async ([key, file]) => {
    // retry a few times so a single dropped request never blocks sign-in
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch('data/' + file, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`Could not load data/${file} (${res.status})`);
        return [key, await res.json()];
      } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 300 * (attempt + 1))); }
    }
    throw lastErr;
  }));
  return Object.fromEntries(entries);
}

// ---------------------------------------------------------------------------
// Keep sample records current: the data set is anchored to the day it was generated.
// On every load all dates move forward by whole days so that the last sample day is
// always "today" — dashboards, expiry alerts and closings stay meaningful on any date.
// ---------------------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function addDays(ymdStr, n) { const d = new Date(ymdStr + 'T12:00:00'); d.setDate(d.getDate() + n); return localDay(d); }
function shiftValue(v, days) {
  if (typeof v === 'string') {
    if (DATE_RE.test(v)) return addDays(v, days);
    if (DATETIME_RE.test(v)) return new Date(new Date(v).getTime() + days * 86400000).toISOString();
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => shiftValue(x, days));
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = shiftValue(v[k], days); return v; }
  return v;
}
function rollForward(data) {
  const meta = data.settings.demo || (data.settings.demo = {});
  const anchor = meta.anchorDate || meta.generatedAt;
  const today = localDay();
  if (!anchor || anchor >= today) { meta.anchorDate = anchor || today; return; }
  const days = Math.round((new Date(today + 'T12:00:00') - new Date(anchor + 'T12:00:00')) / 86400000);
  for (const key of Object.keys(data)) {
    if (key === 'settings') continue;
    data[key] = shiftValue(data[key], days);
  }
  meta.anchorDate = today;
}

export async function initData() {
  seed = await loadSeed();
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed?.settings?.demo?.dataVersion === seed.settings.demo.dataVersion) db = parsed;
    } catch { /* corrupt — fall back to seed */ }
  }
  if (!db) db = clone(seed);
  rollForward(db);
  persist(false);
  // keep several open tabs in sync
  window.addEventListener('storage', (e) => {
    if (e.key === LS_KEY && e.newValue) { db = JSON.parse(e.newValue); version++; emit(); }
  });
}

function persist(notify = true) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch (err) {
    console.error(err);
    window.dispatchEvent(new CustomEvent('hms:storage-error', { detail: err }));
  }
  version++;
  if (notify) emit();
}
function emit() { listeners.forEach((fn) => { try { fn(version); } catch (e) { console.error(e); } }); }

export const store = {
  get version() { return version; },
  all(col) { return db[col]; },
  get(col, id) { return db[col].find((r) => r.id === id) || null; },
  where(col, pred) { return db[col].filter(pred); },
  insert(col, rec) { db[col].push(rec); return rec; },
  update(col, id, patch) {
    const r = this.get(col, id);
    if (!r) throw new Error(`${col}/${id} not found`);
    Object.assign(r, typeof patch === 'function' ? patch(clone(r)) : patch);
    return r;
  },
  /** Run several mutations then persist once (all-or-nothing in memory). */
  transaction(fn) {
    const backup = JSON.stringify(db);
    try { const result = fn(this); persist(); return result; }
    catch (e) { db = JSON.parse(backup); version++; throw e; }
  },
  commit() { persist(); },
  /** Invalidate derived caches without persisting (used inside transactions). */
  touch() { version++; },
  settings() { return db.settings; },
  ph() { return db.pharmacySettings; },
  updatePh(patch) { db.pharmacySettings = { ...db.pharmacySettings, ...patch }; persist(); },
  updateSettings(patch) { db.settings = { ...db.settings, ...patch }; persist(); },
  hs() { return db.hospitalSettings; },
  updateHs(patch) { db.hospitalSettings = { ...db.hospitalSettings, ...patch }; persist(); },
  nextId(col, prefix, width = 4) {
    const re = new RegExp('^' + prefix.replace(/[-]/g, '\\-') + '(\\d+)$');
    const max = db[col].reduce((m, r) => { const k = re.exec(r.id); return k ? Math.max(m, +k[1]) : m; }, 0);
    return prefix + String(max + 1).padStart(width, '0');
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  seedSettings() { return seed.settings; }
};

export async function resetDemoData() {
  const { clearAllBlobs } = await import('./attachment-store.js');
  await clearAllBlobs().catch(() => {});
  Object.keys(localStorage).filter((k) => k.startsWith('nallam_hms_acks_')).forEach((k) => localStorage.removeItem(k));
  db = clone(seed);
  rollForward(db);
  persist();
}
