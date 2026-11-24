// Module 3 — derived pharmacy figures. Everything is computed from bills, bill items, payment transactions,
// returns and cancellations in the shared store. Nothing is hardcoded.
import { store } from './data-service.js';
import { ymd } from './utils.js';
import { r2 } from './pricing.js';

export const PAY_MODES = ['CASH', 'UPI', 'CARD', 'OTHER'];
export const BILL_STATUSES = ['COMPLETED', 'PARTIALLY_PAID', 'PENDING', 'CANCELLED', 'PARTIALLY_RETURNED', 'RETURNED'];
export const RETURN_REASONS = ['Wrong medicine', 'Excess quantity', 'Damaged item', 'Doctor changed prescription', 'Other'];
export const modeLabel = (m) => store.ph().paymentModes.find((x) => x.code === m)?.label || m;

let ver = -1; let idx = null;
function index() {
  if (ver === store.version && idx) return idx;
  ver = store.version;
  const itemsByBill = {}; const paysByBill = {}; const returnedByItem = {}; const pendingByItem = {};
  store.all('billItems').forEach((i) => { (itemsByBill[i.billId] ||= []).push(i); });
  store.all('payments').forEach((p) => { (paysByBill[p.billId] ||= []).push(p); });
  const retStatus = Object.fromEntries(store.all('pReturns').map((r) => [r.id, r.status]));
  store.all('pReturnItems').forEach((ri) => {
    const st = retStatus[ri.returnId];
    if (st === 'COMPLETED') returnedByItem[ri.billItemId] = (returnedByItem[ri.billItemId] || 0) + ri.qty;
    if (st === 'PENDING_APPROVAL') pendingByItem[ri.billItemId] = (pendingByItem[ri.billItemId] || 0) + ri.qty;
  });
  idx = { itemsByBill, paysByBill, returnedByItem, pendingByItem };
  return idx;
}

/** Accounting day: a transaction before the configured start hour belongs to the previous business date. */
export function businessDate(ts = new Date()) {
  const h = Number(store.ph().businessDayStartHour) || 0;
  return ymd(new Date(new Date(ts).getTime() - h * 3600000));
}
export const billItems = (billId) => index().itemsByBill[billId] || [];
export const billPayments = (billId) => index().paysByBill[billId] || [];
export const returnedQty = (itemId) => index().returnedByItem[itemId] || 0;
export const pendingReturnQty = (itemId) => index().pendingByItem[itemId] || 0;
export const eligibleReturnQty = (item) => Math.max(0, item.qty - returnedQty(item.id) - pendingReturnQty(item.id));
export const billPaid = (bill) => r2(billPayments(bill.id).filter((p) => p.kind === 'PAYMENT').reduce((s, p) => s + p.amount, 0));
export const billRefunded = (bill) => r2(billPayments(bill.id).filter((p) => p.kind === 'REFUND').reduce((s, p) => s + p.amount, 0));
export const billBalance = (bill) => (bill.status === 'CANCELLED' ? 0 : r2(Math.max(0, bill.grandTotal - billPaid(bill))));
export const billModes = (bill) => [...new Set(billPayments(bill.id).filter((p) => p.kind === 'PAYMENT').map((p) => p.mode))];
export const billModeLabel = (bill) => { const m = billModes(bill); return m.length > 1 ? 'SPLIT (' + m.join(' + ') + ')' : m[0] || (bill.status === 'CANCELLED' ? '—' : 'UNPAID'); };

/** Recompute stored bill status / payment snapshot after any payment, return or cancellation. */
export function refreshBill(bill) {
  const paid = billPaid(bill);
  bill.amountPaid = paid;
  bill.balanceDue = billBalance(bill);
  bill.paymentStatus = paid >= bill.grandTotal - 0.005 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
  bill.paymentMode = billModes(bill).join(' + ') || '—';
  if (bill.status === 'CANCELLED') return bill;
  const items = billItems(bill.id);
  const sold = items.reduce((s, i) => s + i.qty, 0); const ret = items.reduce((s, i) => s + returnedQty(i.id), 0);
  bill.status = ret >= sold && sold > 0 ? 'RETURNED' : ret > 0 ? 'PARTIALLY_RETURNED' : bill.paymentStatus === 'PAID' ? 'COMPLETED' : bill.paymentStatus === 'PARTIALLY_PAID' ? 'PARTIALLY_PAID' : 'PENDING';
  return bill;
}

/**
 * Day summary for a business date, optionally for one cashier.
 * Bills are attributed to the cashier who created them; payments/refunds to the user who handled the money.
 */
export function daySummary(date, cashierId = null) {
  const bills = store.all('bills').filter((b) => b.businessDate === date && (!cashierId || b.cashierId === cashierId));
  const live = bills.filter((b) => b.status !== 'CANCELLED');
  const tx = store.all('payments').filter((p) => p.businessDate === date && (!cashierId || p.userId === cashierId));
  const sumTx = (kind, mode) => r2(tx.filter((p) => p.kind === kind && (!mode || p.mode === mode)).reduce((s, p) => s + p.amount, 0));
  const rets = store.all('pReturns').filter((r) => r.status === 'COMPLETED' && r.approvedAt && businessDate(r.approvedAt) === date && (!cashierId || r.approvedBy === cashierId));
  const byMode = Object.fromEntries(PAY_MODES.map((m) => [m, { payments: sumTx('PAYMENT', m), refunds: sumTx('REFUND', m), net: r2(sumTx('PAYMENT', m) - sumTx('REFUND', m)) }]));
  const sales = r2(live.reduce((s, b) => s + b.grandTotal, 0));
  const returns = r2(rets.reduce((s, r) => s + r.refundAmount, 0));
  return {
    date, cashierId, billCount: bills.length, liveBills: live.length,
    cancelledBills: bills.length - live.length, cancelledValue: r2(bills.filter((b) => b.status === 'CANCELLED').reduce((s, b) => s + b.grandTotal, 0)),
    gross: r2(live.reduce((s, b) => s + b.gross, 0)), discounts: r2(live.reduce((s, b) => s + b.discountTotal, 0)), gst: r2(live.reduce((s, b) => s + b.gst, 0)),
    sales, returns, returnCount: rets.length, netSales: r2(sales - returns),
    refunds: sumTx('REFUND'), collections: sumTx('PAYMENT'), netCollection: r2(sumTx('PAYMENT') - sumTx('REFUND')),
    pending: r2(live.reduce((s, b) => s + billBalance(b), 0)),
    splitBills: live.filter((b) => billModes(b).length > 1).length, splitValue: r2(live.filter((b) => billModes(b).length > 1).reduce((s, b) => s + b.grandTotal, 0)),
    unitsDispensed: live.reduce((s, b) => s + billItems(b.id).reduce((t, i) => t + i.qty, 0), 0),
    bySale: Object.fromEntries(['PATIENT', 'WALKIN'].map((t) => { const L = live.filter((b) => b.saleType === t); return [t, { bills: L.length, sales: r2(L.reduce((s, b) => s + b.grandTotal, 0)) }]; })),
    ...costOfSales(live),
    purchases: r2(store.all('grns').filter((g) => g.status === 'POSTED' && g.postedAt && businessDate(g.postedAt) === date).reduce((s, g) => s + g.items.reduce((t, it) => { const gross = Number(it.receivedQty) * Number(it.ptr); const tx = gross - gross * (Number(it.discountPct) || 0) / 100; return t + tx + tx * (Number(it.gstPct) || 0) / 100; }, 0), 0)),
    byMode, bills, transactions: tx
  };
}

/** Purchase cost (batch PTR) of what was actually sold vs what it sold for — net of returns. */
export function costOfSales(liveBills) {
  let cost = 0; let salesExGst = 0; let salesIncGst = 0;
  for (const b of liveBills) for (const i of billItems(b.id)) {
    const kept = i.qty - returnedQty(i.id); if (kept <= 0) continue;
    const batch = store.get('batches', i.batchId);
    cost += kept * (batch ? Number(batch.ptr) : 0);
    salesExGst += i.taxableValue * kept / i.qty;
    salesIncGst += i.netAmount * kept / i.qty;
  }
  cost = r2(cost); salesExGst = r2(salesExGst);
  const margin = r2(salesExGst - cost);
  return { cost, salesExGst, salesIncGst: r2(salesIncGst), margin, marginPct: salesExGst ? r2(margin / salesExGst * 100) : 0 };
}

export function dailySalesSeries(days = 14, end = businessDate()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end + 'T00:00:00'); d.setDate(d.getDate() - i);
    const k = ymd(d);
    const live = store.all('bills').filter((b) => b.businessDate === k && b.status !== 'CANCELLED');
    out.push({ date: k, sales: r2(live.reduce((s, b) => s + b.grandTotal, 0)), bills: live.length });
  }
  return out;
}
export function hourlySeries(date) {
  const h = Array.from({ length: 24 }, () => ({ bills: 0, sales: 0 }));
  store.all('bills').filter((b) => b.businessDate === date && b.status !== 'CANCELLED').forEach((b) => { const x = h[new Date(b.at).getHours()]; x.bills++; x.sales = r2(x.sales + b.grandTotal); });
  return h;
}
export function topSelling(days = 30, limit = 8) {
  const since = Date.now() - days * 86400000; const res = {};
  const live = new Set(store.all('bills').filter((b) => b.status !== 'CANCELLED' && new Date(b.at).getTime() >= since).map((b) => b.id));
  store.all('billItems').filter((i) => live.has(i.billId)).forEach((i) => {
    const r = (res[i.medicineId] ||= { qty: 0, value: 0 }); r.qty += i.qty - returnedQty(i.id); r.value = r2(r.value + i.netAmount);
  });
  return Object.entries(res).sort((a, b) => b[1].value - a[1].value).slice(0, limit);
}
export function outstandingBills() { return store.all('bills').filter((b) => b.status !== 'CANCELLED' && billBalance(b) > 0); }

/** (date, cashier) pairs that had activity but no submitted closing — excludes the current business date. */
export function pendingClosings() {
  const today = businessDate(); const keys = new Set();
  store.all('bills').forEach((b) => keys.add(b.businessDate + '|' + b.cashierId));
  store.all('payments').forEach((p) => keys.add(p.businessDate + '|' + p.userId));
  const closed = new Set(store.all('closings').map((c) => c.businessDate + '|' + c.cashierId));
  return [...keys].filter((k) => !closed.has(k) && k.split('|')[0] < today).map((k) => { const [date, cashierId] = k.split('|'); return { date, cashierId }; }).sort((a, b) => b.date.localeCompare(a.date));
}
export const closingFor = (date, cashierId) => store.all('closings').find((c) => c.businessDate === date && c.cashierId === cashierId) || null;
export const isDayClosed = (date, cashierId) => !!closingFor(date, cashierId);

/** How a pharmacy sale is described everywhere: a registered patient (Patient ID) or a walk-in customer. */
export const saleLabel = (t) => (t === 'WALKIN' ? 'Walk-in customer' : 'Registered patient');
