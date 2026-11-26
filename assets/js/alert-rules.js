// Who sees which live alert. Every alert belongs to one area of work and is shown only to users whose role has the
// permission for that area (or to the person it is assigned to). The Super Admin has every permission, so sees all.
// Lab, reception and MRD get their own alerts (kits, critical results, waiting samples, unpaid tests…) — never stock or
// pharmacy ones.
import { store } from './data-service.js';
import { can } from './auth.js';
import { derivedAlerts } from './calculations.js';
import { svc, isCritical, hbillBalance } from './hospital.js';
import { items, labBalance, labState, storeBalance, storeState, lotsAt, daysLeft, openPacks, unitTxt, item as labItem } from './labstock.js';
import { visitStatus, reportReadyAt, isUncollected } from './labflow.js';
import { codingOverdue } from './mrd.js';

/** Permission that makes an alert relevant, by category. */
export const ALERT_PERM = {
  // stock & pharmacy (Store, Pharmacy, Super Admin)
  'Low Stock': 'inventory.view', 'Out of Stock': 'inventory.view', 'Near Expiry': 'inventory.view', 'Expired Stock': 'inventory.view', 'Pharmacy Refill': 'inventory.view',
  'GRN Pending Verification': 'grn.verify', 'GRN Discrepancy': 'grn.approve.exceptional', 'Missing Documentation': 'grn.create',
  'Stock Adjustment Approval': 'adjustment.approve', 'Stock Shortage': 'stockcount.review',
  'Refund Approval': 'pharmacy.return.approve', 'Bill Cancellation': 'pharmacy.cancel', 'Daily Closing': 'pharmacy.closing.all', 'Cash Variance': 'pharmacy.closing.verify',
  // laboratory
  'Critical Result': 'lab.verify', 'Sample Waiting': 'lab.work', 'Lab Stock Low': 'lab.work', 'Lab Stock Expiring': 'lab.work', 'Open Pack Past Use-by': 'lab.work', 'Lab Stock Arrived': 'lab.work', 'Report Not Sent': 'lab.deliver', 'Report Not Collected': 'lab.deliver',
  // central store — lab supplies
  'Lab Request Waiting': 'labstock.issue', 'Lab Supplies to Order': 'labstock.issue',
  // reception / billing
  'Lab Payment Pending': 'hbill.collect', 'Advised, Not Billed': 'hbill.create', 'Credit Approval': 'credit.approve',
  // medical records
  'MRD Coding Overdue': 'mrd.manage'
};
/** Icon per category (alert chips and lists). */
export const ALERT_ICON = {
  'Low Stock': 'trending-down', 'Out of Stock': 'ban', 'Near Expiry': 'calendar-clock', 'Expired Stock': 'calendar-x', 'GRN Pending Verification': 'clipboard-check', 'GRN Discrepancy': 'shield-alert',
  'Stock Adjustment Approval': 'scale', 'Missing Documentation': 'file-warning', 'Stock Shortage': 'clipboard-x', 'Pharmacy Refill': 'arrow-right-left', 'Refund Approval': 'undo-2',
  'Bill Cancellation': 'circle-slash', 'Daily Closing': 'lock', 'Cash Variance': 'scale',
  'Critical Result': 'siren', 'Sample Waiting': 'test-tube', 'Lab Stock Low': 'boxes', 'Lab Stock Expiring': 'calendar-clock', 'Open Pack Past Use-by': 'package-open', 'Lab Stock Arrived': 'truck', 'Lab Request Waiting': 'inbox', 'Lab Supplies to Order': 'shopping-cart', 'Report Not Sent': 'send', 'Report Not Collected': 'file-clock',
  'Lab Payment Pending': 'lock', 'Advised, Not Billed': 'clipboard-list', 'Credit Approval': 'hand-coins', 'MRD Coding Overdue': 'file-code-2'
};

const mins = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;
const pname = (id) => store.get('patients', id)?.name || 'Patient';

/** Live hospital-side alerts (lab, reception, MRD), derived from the data like the stock alerts. */
export function hospitalAlerts() {
  const out = [];
  // lab stock (lab side)
  for (const k of items()) {
    const st = labState(k);
    if (st !== 'OK') out.push({ key: 'LST-' + k.id, category: 'Lab Stock Low', severity: st === 'OUT' ? 'critical' : 'warning', message: `${k.name}: ${unitTxt(k, labBalance(k.id))} left in the lab (ask at ${k.reorderLevel}). Request from the store.`, refType: 'LABITEM', refId: k.id, label: k.name, href: '#/lab/stock?item=' + k.id });
    lotsAt(k.id, 'LAB').filter((x) => x.lot?.expiry && daysLeft(x.lot.expiry) <= 30).forEach((x) => out.push({ key: `LEX-${k.id}-${x.lotId}`, category: 'Lab Stock Expiring', severity: daysLeft(x.lot.expiry) < 0 ? 'critical' : 'warning', message: `${k.name} lot ${x.lot.lot}: ${unitTxt(k, x.qty)} ${daysLeft(x.lot.expiry) < 0 ? 'EXPIRED — discard, do not use' : `expires in ${daysLeft(x.lot.expiry)} days — use first`}.`, refType: 'LABITEM', refId: k.id, label: k.name, date: x.lot.expiry, href: '#/lab/stock?item=' + k.id }));
    // lab supplies (store side)
    const ss = storeState(k);
    if (ss !== 'OK') out.push({ key: 'SST-' + k.id, category: 'Lab Supplies to Order', severity: ss === 'OUT' ? 'critical' : 'warning', message: `${k.name}: ${unitTxt(k, storeBalance(k.id))} in the store (reorder at ${k.storeMin}). Order from ${k.supplier || 'the supplier'}.`, refType: 'LABITEM', refId: k.id, label: k.name, href: '#/store/lab?tab=stock' });
  }
  for (const p of openPacks().filter((x) => daysLeft(x.useBy) < 0)) out.push({ key: 'OPK-' + p.id, category: 'Open Pack Past Use-by', severity: 'critical', message: `${labItem(p.kitId).name}: the open pack is past its use-by date. Replace it before running patient samples.`, refType: 'LABITEM', refId: p.kitId, label: labItem(p.kitId).name, date: p.useBy, href: '#/lab/stock?item=' + p.kitId });
  for (const r of store.all('labIndents')) {
    if (r.status === 'REQUESTED') out.push({ key: 'LRQ-' + r.id, category: 'Lab Request Waiting', severity: r.urgent ? 'critical' : 'warning', message: `${r.urgent ? 'URGENT — ' : ''}Lab asked for ${r.lines.length} item(s): ${r.lines.map((l) => labItem(l.kitId).name).join(', ')}.`, refType: 'LABINDENT', refId: r.id, label: r.id, date: r.at, href: '#/store/lab' });
    if (r.status === 'ISSUED') out.push({ key: 'LAR-' + r.id, category: 'Lab Stock Arrived', severity: 'info', message: `Store sent ${r.id}. Count the items and press Receive — lab stock goes up only after that.`, refType: 'LABINDENT', refId: r.id, label: r.id, date: r.issue.at, href: '#/lab/stock' });
  }
  for (const v of store.all('labVisits')) {
    const st = visitStatus(v); const p = pname(v.patientId);
    const crit = store.all('orders').filter((o) => o.labVisitId === v.id && o.status === 'RESULTED' && isCritical(o));
    if (crit.length) out.push({ key: 'CRIT-' + v.id, category: 'Critical Result', severity: 'critical', message: `${p}: critical value in ${crit.map((o) => svc(o.serviceId)?.code || o.name).join(', ')}. Verify and phone the doctor.`, refType: 'LABVISIT', refId: v.id, label: 'SID ' + v.sid, date: crit[0].lab.enteredAt, step: 'verify' });
    if (['WAITING', 'COLLECTING'].includes(st) && mins(v.createdAt) > 60) out.push({ key: 'WAIT-' + v.id, category: 'Sample Waiting', severity: v.priority === 'ROUTINE' ? 'warning' : 'critical', message: `${p} (${v.collectionPoint === 'WARD' ? `${v.ward} ${v.bed}` : v.token ? 'token ' + v.token : 'casualty'}) has waited ${Math.round(mins(v.createdAt) / 60 * 10) / 10} h for sample collection.`, refType: 'LABVISIT', refId: v.id, label: 'SID ' + v.sid, date: v.createdAt });
    if (st === 'READY' && v.source !== 'IP' && mins(reportReadyAt(v)) > 120 && !isUncollected(v)) out.push({ key: 'RNS-' + v.id, category: 'Report Not Sent', severity: 'warning', message: `${p}: report ready for ${Math.round(mins(reportReadyAt(v)) / 60)} h but not sent or handed over.`, refType: 'LABVISIT', refId: v.id, label: 'SID ' + v.sid, date: reportReadyAt(v), step: 'send' });
    if (isUncollected(v)) out.push({ key: 'RNC-' + v.id, category: 'Report Not Collected', severity: 'info', message: `${p}: report not collected for over ${store.hs().lab.reportCollectDays} days.`, refType: 'LABVISIT', refId: v.id, label: 'SID ' + v.sid, date: reportReadyAt(v) });
    if (st === 'ON_HOLD' && v.billId) { const b = store.get('hbills', v.billId); out.push({ key: 'LPP-' + v.id, category: 'Lab Payment Pending', severity: 'warning', message: `${p}: lab tests billed but ₹${b ? hbillBalance(b) : '—'} not paid — the lab cannot collect the sample.`, refType: 'HBILL', refId: v.billId, label: v.billId, date: v.createdAt }); }
  }
  const advised = store.all('orders').filter((o) => o.status === 'REQUESTED');
  const byPatient = {}; advised.forEach((o) => (byPatient[o.patientId] ||= []).push(o));
  Object.entries(byPatient).forEach(([pid, os]) => out.push({ key: 'ADV-' + pid, category: 'Advised, Not Billed', severity: 'warning', message: `${pname(pid)}: ${os.map((o) => o.name).join(', ')} advised by ${os[0].doctor || 'the doctor'} — not billed yet.`, refType: 'PATIENT_BILL', refId: pid, label: pname(pid), date: os[0].requestedAt }));
  for (const b of store.all('hbills').filter((x) => x.credit?.status === 'PENDING')) out.push({ key: 'CR-' + b.id, category: 'Credit Approval', severity: 'warning', message: `${b.patientName}: credit of ₹${hbillBalance(b)} requested — services wait for approval.`, refType: 'HBILL', refId: b.id, label: b.id, date: b.credit.requestedAt });
  for (const r of store.all('medicalRecords').filter(codingOverdue)) out.push({ key: 'MRD-' + r.id, category: 'MRD Coding Overdue', severity: 'warning', message: `${r.mrdNo}: discharged ${Math.floor((Date.now() - new Date(r.dischargedAt)) / 86400000)} days ago, not coded yet.`, refType: 'MRD', refId: r.id, label: r.mrdNo, date: r.dischargedAt });
  return out;
}

/** The live alerts this user should see. */
export function alertsFor(user) {
  if (!user) return [];
  return [...derivedAlerts(), ...hospitalAlerts()].filter((a) => a.assignee === user.id || can(ALERT_PERM[a.category] || 'alerts.all', user));
}
