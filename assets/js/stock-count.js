// Daily stock count — end-of-day shelf count of selected (usually fast-moving) medicines.
// Opening − billed + received ± other changes = what should be on the shelf. A shortfall means stock left
// the pharmacy without a bill. Counts never change stock by themselves; corrections go through Stock Corrections.
import { store } from './data-service.js';
import { can } from './auth.js';
import { PHARMACY, fefoBatches, medicineStock, medName } from './calculations.js';
import { audit } from './services.js';
import { notify } from './notifications.js';
import { businessDate, topSelling } from './pharmacy-calc.js';
import { r2 } from './pricing.js';

/** Live expected figures for each medicine on a business date (today = up to now). */
export function countRow(medicineId, date = businessDate()) {
  const batches = store.all('batches').filter((b) => b.medicineId === medicineId);
  const ids = new Set(fefoBatches(medicineId).map((b) => b.id));
  const todays = store.all('movements').filter((m) => ids.has(m.batchId) && (m.locationId || PHARMACY()) === PHARMACY() && businessDate(m.at) === date);
  const billed = todays.filter((m) => m.type === 'PHARMACY_SALE').reduce((t, m) => t + m.qtyOut, 0);
  const received = todays.filter((m) => m.type === 'PURCHASE_RECEIPT' || m.type === 'STOCK_TRANSFER_IN').reduce((t, m) => t + m.qtyIn, 0);
  const net = todays.reduce((t, m) => t + m.qtyIn - m.qtyOut, 0);
  const expected = medicineStock(medicineId).pharmacy;
  const live = batches.filter((b) => ids.has(b.id));
  const avgPtr = live.length ? live.reduce((t, b) => t + Number(b.ptr), 0) / live.length : 0;
  return { medicineId, opening: expected - net, received, billed, otherNet: net - received + billed, expected, avgPtr };
}

export const suggestedMedicines = (n = 10) => {
  const top = topSelling(30, n).map(([id]) => id);
  return top.length ? top : store.all('medicines').filter((m) => m.active).slice(0, n).map((m) => m.id);
};
export const countForDate = (date = businessDate()) => store.all('stockCounts').filter((c) => c.businessDate === date).sort((a, b) => b.countedAt.localeCompare(a.countedAt))[0] || null;

export function submitStockCount({ items, remarks }, user) {
  if (!can('stockcount.do', user)) throw new Error('You are not allowed to submit stock counts.');
  const date = businessDate();
  if (countForDate(date)) throw new Error(`Today's stock count has already been submitted.`);
  if (!items.length) throw new Error('Add at least one medicine to count.');
  items.forEach((x) => { if (x.counted === '' || x.counted == null || !Number.isInteger(Number(x.counted)) || Number(x.counted) < 0) throw new Error(`Enter the counted quantity for ${medName(x.medicineId)}.`); });
  const rows = items.map((x) => {
    const r = countRow(x.medicineId, date); const counted = Number(x.counted); const diff = counted - r.expected;
    return { medicineId: x.medicineId, opening: r.opening, received: r.received, billed: r.billed, otherNet: r.otherNet, expected: r.expected, counted, difference: diff, valueDifference: r2(diff * r.avgPtr) };
  });
  const short = rows.filter((x) => x.difference < 0);
  const totals = { medicines: rows.length, matched: rows.filter((x) => x.difference === 0).length, shortItems: short.length,
    shortUnits: -short.reduce((t, x) => t + x.difference, 0), excessUnits: rows.filter((x) => x.difference > 0).reduce((t, x) => t + x.difference, 0),
    valueDifference: r2(rows.reduce((t, x) => t + x.valueDifference, 0)) };
  if ((short.length || totals.excessUnits) && !remarks?.trim()) throw new Error('Please add a remark explaining the difference.');
  return store.transaction(() => {
    const c = store.insert('stockCounts', { id: store.nextId('stockCounts', `SC-${date.slice(0, 4)}-`), businessDate: date, countedBy: user.id, countedAt: new Date().toISOString(),
      items: rows, totals, remarks: remarks || '', status: short.length || totals.excessUnits ? 'SUBMITTED' : 'REVIEWED', reviewedBy: null, reviewedAt: null, reviewNote: '' });
    audit(user, 'STOCK_COUNT_SUBMITTED', 'STOCKCOUNT', c.id, `${rows.length} medicines · ${totals.shortUnits} short · ${totals.excessUnits} extra`);
    if (short.length) notify({ type: 'STOCK_SHORTAGE', category: 'Stock Shortage', severity: 'critical', title: `Stock shortage in daily count — ${date}`,
      message: `${short.length} medicine(s), ${totals.shortUnits} unit(s) less than the system stock (₹${Math.abs(totals.valueDifference).toLocaleString('en-IN')}). ${short.map((x) => `${medName(x.medicineId)} ${x.difference}`).join(', ')}.`,
      refType: 'STOCKCOUNT', refId: c.id, targetRoles: ['SUPER_ADMIN'], assignedTo: 'USR-0003' });
    else notify({ type: 'STOCK_COUNT_OK', category: 'Daily Stock Count', severity: totals.excessUnits ? 'warning' : 'success', title: `Daily stock count ${totals.excessUnits ? 'has extra units' : 'matched'} — ${date}`,
      message: `${rows.length} medicines counted by ${user.name}. ${totals.excessUnits ? totals.excessUnits + ' extra unit(s) found.' : 'Shelf stock matches the system.'}`, refType: 'STOCKCOUNT', refId: c.id, targetRoles: ['SUPER_ADMIN'], assignedTo: 'USR-0003' });
    return c;
  });
}

export function reviewStockCount(id, note, user) {
  if (!can('stockcount.review', user)) throw new Error('Only the Hospital Owner can review stock counts.');
  if (!note?.trim()) throw new Error('Add a review note.');
  return store.transaction(() => {
    const c = store.get('stockCounts', id);
    Object.assign(c, { status: 'REVIEWED', reviewedBy: user.id, reviewedAt: new Date().toISOString(), reviewNote: note });
    audit(user, 'STOCK_COUNT_REVIEWED', 'STOCKCOUNT', id, note);
    return c;
  });
}
