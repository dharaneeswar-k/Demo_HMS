// All derived numbers (balances, statuses, totals, KPIs, alerts) are computed here from the shared store.
// Nothing in the UI hardcodes totals. The stock-movement ledger is the source of truth for quantities.
import { store } from './data-service.js';
import { round2, ymd } from './utils.js';
import { pendingClosings } from './pharmacy-calc.js';

export const IN_TYPES = ['OPENING_STOCK', 'PURCHASE_RECEIPT', 'STOCK_TRANSFER_IN', 'PATIENT_RETURN', 'STOCK_ADJUSTMENT_IN', 'SALE_CANCELLATION'];
export const MOVEMENT_TYPES = ['OPENING_STOCK', 'PURCHASE_RECEIPT', 'PHARMACY_SALE', 'STOCK_TRANSFER_IN', 'STOCK_TRANSFER_OUT', 'PATIENT_RETURN', 'SUPPLIER_RETURN', 'STOCK_ADJUSTMENT_IN', 'STOCK_ADJUSTMENT_OUT', 'EXPIRED_WRITE_OFF', 'SALE_CANCELLATION'];
export const GRN_STATUSES = ['DRAFT', 'VALIDATION_REQUIRED', 'SUBMITTED', 'PENDING_APPROVAL', 'POSTED', 'REJECTED', 'CANCELLED'];
export const BATCH_STATUSES = ['ACTIVE', 'NEAR_EXPIRY', 'EXPIRED', 'QUARANTINED', 'RETURNED', 'DEPLETED'];

// ------------- memo keyed on store version -------------
let memoVersion = -1;
let memo = {};
function cached(key, fn) {
  if (memoVersion !== store.version || ymd() !== memo.__day) { memo = { __day: ymd() }; memoVersion = store.version; }
  if (!(key in memo)) memo[key] = fn();
  return memo[key];
}

// ------------- dates -------------
export const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d - todayStart()) / 86400000);
}
export const expiryThreshold = () => Number(store.settings().expiryThresholdDays) || 90;
export const isExpired = (dateStr) => dateStr && daysUntil(dateStr) < 0;

// ------------- batches -------------
// Stock is held per batch AND per location (Central Store, Pharmacy). Only Pharmacy stock can be sold.
export const PHARMACY = () => store.settings().pharmacyLocationId || 'LOC-01';
export const STORE_LOC = () => store.settings().storeLocationId || 'LOC-02';
const balanceMaps = () => cached('balances', () => {
  const total = {}; const byLoc = {};
  for (const mv of store.all('movements')) {
    const d = (mv.qtyIn || 0) - (mv.qtyOut || 0);
    total[mv.batchId] = (total[mv.batchId] || 0) + d;
    const k = mv.batchId + '|' + (mv.locationId || PHARMACY());
    byLoc[k] = (byLoc[k] || 0) + d;
  }
  return { total, byLoc };
});
export const batchBalances = () => balanceMaps().total;
/** Batch balance — all locations, or one location when `loc` is given. */
export const batchBalance = (batchId, loc) => (loc ? balanceMaps().byLoc[batchId + '|' + loc] || 0 : balanceMaps().total[batchId] || 0);

export function batchStatus(b) {
  const onHand = batchBalance(b.id);
  if (b.returned) return 'RETURNED';
  if (onHand <= 0) return 'DEPLETED';
  if (b.quarantined) return 'QUARANTINED';
  const d = daysUntil(b.expiryDate);
  if (d < 0) return 'EXPIRED';
  if (d <= expiryThreshold()) return 'NEAR_EXPIRY';
  return 'ACTIVE';
}
/** Batches usable for normal issue — never expired or quarantined. */
export const isIssuable = (b) => ['ACTIVE', 'NEAR_EXPIRY'].includes(batchStatus(b));

/** FEFO: First Expiry, First Out recommendation — sellable batches with stock at the given location (default: Pharmacy). */
export function fefoBatches(medicineId, loc = PHARMACY()) {
  return store.all('batches').filter((b) => b.medicineId === medicineId && isIssuable(b) && batchBalance(b.id, loc) > 0)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.receivedAt.localeCompare(b.receivedAt));
}

// ------------- medicines -------------
export const medicineStockMap = () => cached('medStock', () => {
  const map = {};
  const PH = PHARMACY(); const ST = STORE_LOC();
  for (const m of store.all('medicines')) map[m.id] = { onHand: 0, available: 0, pharmacy: 0, store: 0, expired: 0, quarantined: 0, batchCount: 0, value: 0, nearestExpiry: null, nearExpiryQty: 0 };
  for (const b of store.all('batches')) {
    const s = map[b.medicineId]; if (!s) continue;
    const q = batchBalance(b.id); if (q <= 0) continue;
    const st = batchStatus(b);
    s.onHand += q; s.batchCount++; s.value += q * b.ptr;
    if (st === 'EXPIRED') s.expired += q;
    else if (st === 'QUARANTINED') s.quarantined += q;
    else if (st !== 'RETURNED') {
      s.available += q;
      s.pharmacy += batchBalance(b.id, PH); s.store += batchBalance(b.id, ST);
      if (!s.nearestExpiry || b.expiryDate < s.nearestExpiry) s.nearestExpiry = b.expiryDate;
      if (st === 'NEAR_EXPIRY') s.nearExpiryQty += q;
    }
  }
  Object.values(map).forEach((s) => { s.value = round2(s.value); });
  return map;
});
export const medicineStock = (id) => medicineStockMap()[id] || { onHand: 0, available: 0, pharmacy: 0, store: 0, expired: 0, quarantined: 0, batchCount: 0, value: 0 };

export function stockStatus(med, available = medicineStock(med.id).available) {
  if (available <= 0) return 'OUT_OF_STOCK';
  const level = store.settings().lowStockBasis === 'MIN_STOCK_LEVEL' ? med.minStockLevel : med.reorderLevel;
  if (available <= Number(level || 0)) return 'LOW_STOCK';
  return 'IN_STOCK';
}
export const medName = (id) => { const m = store.get('medicines', id); return m ? m.brandName : id; };
export const supplierName = (id) => store.get('suppliers', id)?.name || '—';
export const userName = (id) => store.get('users', id)?.name || (id ? id : '—');
export const locationName = (id) => store.get('locations', id)?.name || '—';

// ------------- GRN -------------
export function lineCalc(it) {
  const qty = Number(it.receivedQty) || 0;
  const free = Number(it.freeQty) || 0;
  const rate = Number(it.ptr) || 0;
  const gross = qty * rate;
  const discount = gross * (Number(it.discountPct) || 0) / 100;
  const taxable = gross - discount;
  const gst = taxable * (Number(it.gstPct) || 0) / 100;
  return { qty, free, totalQty: qty + free, gross: round2(gross), discount: round2(discount), taxable: round2(taxable), gst: round2(gst), total: round2(taxable + gst) };
}
export function grnTotals(grn) {
  const t = { lines: 0, medicines: 0, qty: 0, free: 0, totalQty: 0, gross: 0, discount: 0, taxable: 0, gst: 0, grand: 0 };
  const meds = new Set();
  for (const it of grn.items || []) {
    const c = lineCalc(it);
    t.lines++; if (it.medicineId) meds.add(it.medicineId);
    t.qty += c.qty; t.free += c.free; t.totalQty += c.totalQty;
    t.gross += c.gross; t.discount += c.discount; t.taxable += c.taxable; t.gst += c.gst; t.grand += c.total;
  }
  t.medicines = meds.size;
  ['gross', 'discount', 'taxable', 'gst', 'grand'].forEach((k) => { t[k] = round2(t[k]); });
  return t;
}

export function grnKPIs() {
  return cached('grnKpi', () => {
    const grns = store.all('grns');
    const today = ymd();
    const by = (s) => grns.filter((g) => g.status === s).length;
    const posted = grns.filter((g) => g.status === 'POSTED');
    return {
      total: grns.length,
      today: grns.filter((g) => ymd(g.receivedAt) === today).length,
      draft: by('DRAFT') + by('VALIDATION_REQUIRED'),
      pendingVerification: by('SUBMITTED'),
      pendingApproval: by('PENDING_APPROVAL'),
      posted: posted.length,
      rejectedCancelled: by('REJECTED') + by('CANCELLED'),
      receivedValue: round2(posted.reduce((s, g) => s + grnTotals(g).grand, 0)),
      statusCounts: Object.fromEntries(GRN_STATUSES.map((s) => [s, by(s)]))
    };
  });
}

// ------------- inventory KPIs -------------
export function inventoryKPIs() {
  return cached('invKpi', () => {
    const meds = store.all('medicines').filter((m) => m.active);
    const map = medicineStockMap();
    let onHand = 0, available = 0, value = 0, low = 0, out = 0;
    for (const m of meds) {
      const s = map[m.id];
      onHand += s.onHand; available += s.available; value += s.value;
      const st = stockStatus(m, s.available);
      if (st === 'LOW_STOCK') low++; if (st === 'OUT_OF_STOCK') out++;
    }
    let near = 0, expired = 0;
    for (const b of store.all('batches')) {
      const st = batchStatus(b);
      if (st === 'NEAR_EXPIRY') near++;
      if (st === 'EXPIRED') expired++;
    }
    return { medicines: meds.length, onHand, available, value: round2(value), low, out, near, expired };
  });
}

/** Stock in vs out per month for the last n months. */
export function monthlyInOut(n = 6) {
  const now = new Date();
  const keys = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const inn = Object.fromEntries(keys.map((k) => [k, 0])); const out = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const m of store.all('movements')) {
    const k = ymd(m.at).slice(0, 7);
    if (k in inn) { inn[k] += m.qtyIn; out[k] += m.qtyOut; }
  }
  return { labels: keys.map((k) => new Date(k + '-01T00:00:00').toLocaleString('en-IN', { month: 'short', year: '2-digit' })), inn: keys.map((k) => inn[k]), out: keys.map((k) => out[k]) };
}

export function categoryDistribution() {
  const map = medicineStockMap(); const res = {};
  for (const m of store.all('medicines')) res[m.category] = (res[m.category] || 0) + map[m.id].value;
  return Object.entries(res).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}

export function fastMovers(days = 30, limit = 8) {
  const since = Date.now() - days * 86400000; const res = {};
  for (const m of store.all('movements')) {
    if (m.type !== 'PHARMACY_SALE' || new Date(m.at).getTime() < since) continue;
    res[m.medicineId] = (res[m.medicineId] || 0) + m.qtyOut;
  }
  return Object.entries(res).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** Ledger with running balance per batch (movement prev/new balances are recomputed from the ledger). */
export function ledger() {
  return cached('ledger', () => {
    const running = {};
    return [...store.all('movements')].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).map((m) => {
      const key = m.batchId + '|' + (m.locationId || PHARMACY());
      const prev = running[key] || 0;
      const next = prev + m.qtyIn - m.qtyOut;
      running[key] = next;
      return { ...m, prevBalance: prev, newBalance: next };
    });
  });
}

// ------------- live alerts (derived from data, not stored) -------------
export function derivedAlerts() {
  return cached('alerts', () => {
    const out = [];
    const map = medicineStockMap();
    for (const m of store.all('medicines').filter((x) => x.active)) {
      const st = stockStatus(m, map[m.id].available);
      if (st === 'OUT_OF_STOCK') out.push({ key: 'OOS-' + m.id, category: 'Out of Stock', severity: 'critical', message: `${m.brandName} is out of stock (reorder level ${m.reorderLevel} ${m.unit}).`, refType: 'MEDICINE', refId: m.id, assignee: 'USR-0002' });
      else if (st === 'LOW_STOCK') out.push({ key: 'LOW-' + m.id, category: 'Low Stock', severity: 'warning', message: `${m.brandName}: ${map[m.id].available} ${m.unit}(s) available — at/below reorder level ${m.reorderLevel}.`, refType: 'MEDICINE', refId: m.id, assignee: 'USR-0002' });
    }
    for (const m of store.all('medicines').filter((x) => x.active)) {
      const st = map[m.id];
      if (st.store > 0 && st.pharmacy <= m.reorderLevel) out.push({ key: 'RF-' + m.id, category: 'Pharmacy Refill', severity: st.pharmacy === 0 ? 'critical' : 'warning', message: `${m.brandName}: only ${st.pharmacy} ${m.unit}(s) on the pharmacy shelf, ${st.store} in the central store. Transfer stock to the pharmacy.`, refType: 'TRANSFER', refId: m.id, assignee: 'USR-0002' });
    }
    for (const b of store.all('batches')) {
      const st = batchStatus(b); const q = batchBalance(b.id);
      if (st === 'EXPIRED') out.push({ key: 'EXP-' + b.id, category: 'Expired Stock', severity: 'critical', message: `Batch ${b.batchNo} of ${medName(b.medicineId)} expired on ${b.expiryDate} — ${q} unit(s) on shelf. Blocked from issue.`, refType: 'BATCH', refId: b.id, assignee: 'USR-0002', date: b.expiryDate });
      if (st === 'NEAR_EXPIRY') { const d = daysUntil(b.expiryDate); out.push({ key: 'NEX-' + b.id, category: 'Near Expiry', severity: d <= (store.settings().criticalExpiryDays || 30) ? 'critical' : 'warning', message: `Batch ${b.batchNo} of ${medName(b.medicineId)} expires in ${d} day(s) — ${q} unit(s) remaining.`, refType: 'BATCH', refId: b.id, assignee: 'USR-0001', date: b.expiryDate }); }
    }
    for (const g of store.all('grns')) {
      if (g.status === 'SUBMITTED') out.push({ key: 'GPV-' + g.id, category: 'GRN Pending Verification', severity: 'warning', message: `${g.id} from ${supplierName(g.supplierId)} awaits verification.`, refType: 'GRN', refId: g.id, assignee: 'USR-0002', date: g.updatedAt });
      if (g.status === 'PENDING_APPROVAL') out.push({ key: 'GPA-' + g.id, category: 'GRN Discrepancy', severity: 'critical', message: `${g.id} needs owner approval: ${(g.exceptionReasons || []).join('; ')}`, refType: 'GRN', refId: g.id, assignee: 'USR-0003', date: g.updatedAt });
      if (['DRAFT', 'VALIDATION_REQUIRED', 'SUBMITTED'].includes(g.status) && (!g.attachments?.invoice || !g.attachments?.photos?.length)) out.push({ key: 'DOC-' + g.id, category: 'Missing Documentation', severity: 'info', message: `${g.id}: ${!g.attachments?.invoice ? 'supplier invoice' : 'delivery photographs'} not uploaded.`, refType: 'GRN', refId: g.id, assignee: g.receivedBy, date: g.updatedAt });
    }
    for (const a of store.all('adjustments')) {
      if (a.status.startsWith('PENDING')) out.push({ key: 'ADJ-' + a.id, category: 'Stock Adjustment Approval', severity: a.requiresOwner ? 'critical' : 'warning', message: `${a.id}: ${medName(a.medicineId)} ${a.difference > 0 ? '+' : ''}${a.difference} (${a.reason}) awaiting ${a.requiresOwner ? 'owner' : 'manager'} approval.`, refType: 'ADJUSTMENT', refId: a.id, assignee: a.requiresOwner ? 'USR-0003' : 'USR-0002', date: a.requestedAt });
    }
    for (const c of store.all('stockCounts').filter((x) => x.status === 'SUBMITTED' && x.totals.shortItems)) out.push({ key: 'SC-' + c.id, category: 'Stock Shortage', severity: 'critical', message: `Daily count on ${c.businessDate}: ${c.totals.shortUnits} unit(s) missing (₹${Math.abs(c.totals.valueDifference)}). Possible items given without a bill.`, refType: 'STOCKCOUNT', refId: c.id, assignee: 'USR-0003', date: c.countedAt });
    // Module 3 — pharmacy tasks
    const users = (id) => store.get('users', id)?.name || id;
    for (const r of store.all('pReturns').filter((x) => x.status === 'PENDING_APPROVAL')) out.push({ key: 'RFA-' + r.id, category: 'Refund Approval', severity: r.requiresOwner ? 'critical' : 'warning', message: `${r.id}: refund ₹${r.refundAmount} against ${r.billId} (${r.reason}) awaiting ${r.requiresOwner ? 'owner' : 'manager'} verification.`, refType: 'RETURN', refId: r.id, assignee: r.requiresOwner ? 'USR-0003' : 'USR-0002', date: r.at });
    for (const c of store.all('cancellations').filter((x) => x.status === 'PENDING')) out.push({ key: 'BCR-' + c.id, category: 'Bill Cancellation', severity: 'warning', message: `Cancellation of ${c.billId} requested by ${users(c.requestedBy)}: ${c.reason}`, refType: 'BILL', refId: c.billId, assignee: 'USR-0002', date: c.requestedAt });
    for (const p of pendingClosings()) out.push({ key: 'DCP-' + p.date + p.cashierId, category: 'Daily Closing', severity: 'warning', message: `Counter of ${users(p.cashierId)} for ${p.date} has not been closed.`, refType: 'CLOSING_PENDING', refId: `${p.date}|${p.cashierId}`, assignee: p.cashierId, date: p.date });
    const tol = store.ph().cashVarianceTolerance;
    for (const c of store.all('closings').filter((x) => x.status !== 'VERIFIED' && Math.abs(x.cashDifference) > tol)) out.push({ key: 'CV-' + c.id, category: 'Cash Variance', severity: 'critical', message: `${c.businessDate} · ${users(c.cashierId)}: cash variance ₹${c.cashDifference} (tolerance ₹${tol}) not yet verified.`, refType: 'CLOSING', refId: c.id, assignee: 'USR-0003', date: c.submittedAt });
    return out;
  });
}
