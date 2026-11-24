// One list of "things waiting for my decision", shared by Home, the Approvals inbox and the sidebar badge.
import { store } from './data-service.js';
import { can, currentUser } from './auth.js';
import { canDecideAdjustment } from './services.js';
import { canDecideReturn } from './pharmacy-services.js';
import { grnTotals, supplierName, userName, medName } from './calculations.js';

export const APPROVAL_TYPES = {
  GRN: { label: 'Stock receipts', icon: 'package-check' },
  GRN_OWNER: { label: 'Special stock receipts', icon: 'shield-alert' },
  ADJUSTMENT: { label: 'Stock corrections', icon: 'scale' },
  RETURN: { label: 'Returns & refunds', icon: 'undo-2' },
  CANCEL: { label: 'Bill cancellations', icon: 'circle-slash' },
  CLOSING: { label: 'Day closings', icon: 'lock' },
  STOCKCOUNT: { label: 'Stock shortages', icon: 'clipboard-x' },
  DISCOUNT: { label: 'Discounts', icon: 'percent' }
};

export function approvalItems(user = currentUser()) {
  if (!user) return [];
  const out = [];
  if (can('grn.verify', user)) store.all('grns').filter((g) => g.status === 'SUBMITTED').forEach((g) => out.push({
    type: 'GRN', id: g.id, title: `Check stock received from ${supplierName(g.supplierId)}`, detail: `${g.id} · ${g.items.length} item(s) · invoice ${g.invoiceNo}`,
    who: userName(g.receivedBy), at: g.updatedAt, amount: grnTotals(g).grand, href: `#/grn/${g.id}`, action: 'Check & add stock', tone: 'info' }));
  if (can('grn.approve.exceptional', user)) store.all('grns').filter((g) => g.status === 'PENDING_APPROVAL').forEach((g) => out.push({
    type: 'GRN_OWNER', id: g.id, title: `Special approval: stock from ${supplierName(g.supplierId)}`, detail: (g.exceptionReasons || [])[0] || g.id,
    who: userName(g.verifiedBy), at: g.updatedAt, amount: grnTotals(g).grand, href: `#/grn/${g.id}`, action: 'Review', tone: 'danger' }));
  store.all('adjustments').filter((a) => canDecideAdjustment(a, user)).forEach((a) => out.push({
    type: 'ADJUSTMENT', id: a.id, title: `Stock correction for ${medName(a.medicineId)}`, detail: `${a.difference > 0 ? '+' : ''}${a.difference} units · ${a.reason}`,
    who: userName(a.requestedBy), at: a.requestedAt, amount: null, href: `#/adjustments?focus=${a.id}`, action: 'Review', tone: a.requiresOwner ? 'danger' : 'warning' }));
  store.all('pReturns').filter((r) => canDecideReturn(r, user)).forEach((r) => out.push({
    type: 'RETURN', id: r.id, title: `Refund for returned medicine`, detail: `${r.billId} · ${r.reason}`,
    who: userName(r.requestedBy), at: r.at, amount: r.refundAmount, href: `#/pharmacy/returns?focus=${r.id}`, action: 'Verify', tone: 'warning' }));
  if (can('pharmacy.cancel', user)) store.all('cancellations').filter((c) => c.status === 'PENDING').forEach((c) => out.push({
    type: 'CANCEL', id: c.id, title: `Cancel bill ${c.billId}`, detail: c.reason,
    who: userName(c.requestedBy), at: c.requestedAt, amount: store.get('bills', c.billId)?.grandTotal, href: `#/pharmacy/bills/${c.billId}`, action: 'Review', tone: 'warning' }));
  if (can('pharmacy.closing.verify', user)) {
    const tol = store.ph().cashVarianceTolerance;
    store.all('closings').filter((c) => c.status === 'SUBMITTED' || c.status === 'CORRECTED').forEach((c) => out.push({
      type: 'CLOSING', id: c.id, title: `Day closing by ${userName(c.cashierId)}`, detail: `${c.businessDate} · cash ${c.cashDifference === 0 ? 'matched' : (c.cashDifference > 0 ? '+' : '') + '₹' + c.cashDifference}`,
      who: userName(c.submittedBy), at: c.submittedAt, amount: c.totalActual - c.openingFloat, href: `#/pharmacy/closing-report?focus=${c.id}`, action: 'Review', tone: Math.abs(c.cashDifference) > tol ? 'danger' : 'success' }));
  }
  if (can('stockcount.review', user)) store.all('stockCounts').filter((c) => c.status === 'SUBMITTED').forEach((c) => out.push({
    type: 'STOCKCOUNT', id: c.id, title: c.totals.shortItems ? `Stock shortage found in daily count` : 'Extra stock found in daily count', detail: `${c.businessDate} · ${c.totals.shortUnits} unit(s) missing, ${c.totals.excessUnits} extra`,
    who: userName(c.countedBy), at: c.countedAt, amount: Math.abs(c.totals.valueDifference) || null, href: `#/stock-count?focus=${c.id}`, action: 'Review', tone: c.totals.shortItems ? 'danger' : 'warning' }));
  if (can('discount.approve', user)) store.all('discountRequests').filter((r) => r.status === 'PENDING').forEach((r) => out.push({
    type: 'DISCOUNT', id: r.id, title: `${r.requestedPct}% discount for ${r.snapshot.patientName}`, detail: `“${r.reason}” · bill on hold at the counter`,
    who: userName(r.requestedBy), at: r.requestedAt, amount: r.snapshot.discount, href: `#/discounts?focus=${r.id}`, action: 'Decide', tone: 'danger' }));
  const rank = { danger: 0, warning: 1, info: 2, success: 3 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone] || String(b.at).localeCompare(String(a.at)));
}
