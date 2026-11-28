// Home — one calm page per role: what to do, four key numbers, and what needs attention.
import { store } from '../data-service.js';
import { currentUser, can, roleLabel } from '../auth.js';
import { inventoryKPIs, userName, medicineStockMap } from '../calculations.js';
import { daySummary, businessDate, pendingClosings, closingFor, billModeLabel } from '../pharmacy-calc.js';
import { approvalItems, APPROVAL_TYPES } from '../approvals.js';
import { countForDate } from '../stock-count.js';
import { refillSuggestions } from './transfers.js';
import { badge, emptyState } from '../components.js';
import { clinicalHome, CLINICAL_ROLES } from './home-clinical.js';
import { esc, icon, fmtINR, fmtNum, relTime } from '../utils.js';
import { hospitalDaySummary, orderAccess, hbillBalance, isCritical } from '../hospital.js';
import { openShiftFor, pendingHandoversFor, shiftSummary } from '../shifts.js';
import { codingOverdue } from '../mrd.js';
import { stageById, stageOf, codesOf, onHold } from './lab/stages.js';
import { pat, liveOrders, liveTubes, minsSince, dur, ptypeCode, ptypeCell, ptype } from './lab/ui.js';
import { isUncollected } from '../labflow.js';
import { criticalCallOk, verifyState } from '../hospital.js';
import { canSign } from '../labrules.js';
import { labAttention, storeAttention } from '../labstock.js';
import { alertsFor } from '../alert-rules.js';

const tile = (href, ic, title, desc, tone = 'teal', count, pill) => `<a class="task-tile tone-${tone}" href="${href}">
  <span class="tt-icon">${icon(ic)}</span><span class="tt-text"><strong>${esc(title)}</strong>${pill ? `<span class="tt-pill tt-pill-${pill.tone || tone}">${esc(pill.text)}</span>` : `<small>${esc(desc)}</small>`}</span>
  ${count ? `<span class="tt-count">${count}</span>` : icon('chevron-right', 'tt-arrow')}</a>`;
const stat = (label, value, sub = '', href) => `<${href ? `a href="${href}"` : 'div'} class="stat">
  <span class="stat-label">${esc(label)}</span><span class="stat-value">${value}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</${href ? 'a' : 'div'}>`;

export function render(view) {
  const u = currentUser();
  const role = u.role;
  const today = businessDate();
  const all = daySummary(today);
  const mine = daySummary(today, u.id);
  const inv = inventoryKPIs();
  const approvals = approvalItems(u);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = u.name.startsWith('Dr') ? u.name.split(' ').slice(0, 2).join(' ') : u.name.split(' ')[0];
  const dateLine = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // ---------------- tiles ----------------
  const T = {
    bill: tile('#/pharmacy/bill', 'shopping-cart', 'Pharmacy Sale', 'Bill medicines to a patient or walk-in customer', 'teal'),
    receive: tile('#/grn/new', 'package-plus', 'Receive Stock', 'Enter a supplier delivery', 'navy'),
    find: tile('#/inventory', 'search', 'Find Medicine', 'Check stock and expiry', 'info'),
    ret: tile('#/pharmacy/returns', 'undo-2', 'Return / Refund', 'Take back medicines from a bill', 'warning'),
    close: tile('#/pharmacy/closing', 'lock', 'Counter Closing', closingFor(today, u.id) ? 'Your counter is closed today' : 'Count cash and submit', 'purple', null, closingFor(today, u.id) ? { text: 'Closed today', tone: 'success' } : null),
    approvals: tile('#/approvals', 'inbox', 'Approvals', 'Nothing waiting', approvals.length ? 'danger' : 'success', null, approvals.length ? { text: `${approvals.length} waiting`, tone: 'danger' } : null),
    reports: tile('#/reports', 'bar-chart-3', 'Reports', 'Sales, stock and expiry reports', 'info'),
    closings: tile('#/pharmacy/closing-report', 'clipboard-list', 'Day Closings', 'Cash and collection by staff', 'purple'),
    sales: tile('#/pharmacy', 'trending-up', 'Sales Today', 'Charts and payment modes', 'teal'),
    stockAlerts: tile('#/alerts', 'bell-ring', 'Stock Alerts', 'Low stock and expiry', 'warning'),
    settings: tile('#/settings', 'settings', 'Settings', 'Limits, approvals, branding', 'navy'),
    register: tile('#/patients/new', 'user-plus', 'Register Patient', 'New patient — generates Patient ID', 'teal'),
    findPatient: tile('#/patients', 'user-search', 'Find Patient', 'Search by name, ID or mobile', 'info'),
    transfer: tile('#/transfers', 'arrow-right-left', 'Send to Pharmacy', 'Store → Pharmacy transfer', 'navy', null, refillSuggestions().length ? { text: `${refillSuggestions().length} to refill`, tone: 'warning' } : null),
    grnList: tile('#/grn', 'package-check', 'Received Stock', 'Supplier deliveries and status', 'info'),
    users: tile('#/users', 'user-cog', 'User Accounts', 'Staff logins and roles', 'navy'),
    mgmt: tile('#/management', 'layout-dashboard', 'Management Dashboard', 'Whole hospital — billing, lab, stock, cash', 'navy'),
    hbill: tile('#/hbill', 'receipt', 'Hospital Bill', 'Lab tests, ECG, injection, services, packages', 'teal'),
    hbills: tile('#/hbills', 'files', 'Hospital Bills', 'Collect balance, receipts, cancellations', 'info'),
    shift: tile('#/shifts', 'timer', 'My Shift', 'Opening cash, collections, handover', 'purple', null, pendingHandoversFor(u).length ? { text: `${pendingHandoversFor(u).length} handover`, tone: 'warning' } : null),
    packages: tile('#/packages', 'package', 'Packages', 'Health check-ups and surgery packages', 'warning'),
    lab: tile('#/lab', 'test-tube', 'Lab Worklist', 'Collect → receive → results → verify → send', 'teal'),
    labReports: tile('#/lab/reports', 'file-check-2', 'Lab Reports', 'Find and reprint reports', 'info'),
    kits: tile('#/lab/stock', 'boxes', 'Lab Stock', 'Reagents, cards, tubes, QC', labAttention().low.length ? 'danger' : 'navy', labAttention().arriving.length || null, labAttention().low.length ? { text: `${labAttention().low.length} item${labAttention().low.length === 1 ? '' : 's'} low`, tone: 'danger' } : null),
    labSupplies: tile('#/store/lab', 'flask-conical', 'Lab Supplies', 'Lab requests and reagent stock', storeAttention().requests.length ? 'danger' : 'purple', null, storeAttention().requests.length ? { text: `${storeAttention().requests.length} lab request${storeAttention().requests.length > 1 ? 's' : ''}`, tone: 'danger' } : null),
    labTests: tile('#/lab/tests', 'list-checks', 'Lab Test Master', 'Tests, prices, normal ranges, kits', 'purple'),
    addTest: tile('#/lab/tests/new', 'plus-circle', 'Add a Lab Test', 'New test — billable at reception at once', 'teal'),
    audit: tile('#/audit', 'history', 'Audit Log', 'Who changed what, and when', 'navy'),
    svc: tile('#/services', 'syringe', 'Service Counter', 'ECG, injection, nebulization', 'teal'),
    mrd: tile('#/mrd', 'folder-open', 'Medical Records', 'Code, file and retrieve records', 'teal'),
    dsum: tile('#/mrd?tab=summaries', 'file-text', 'Discharge Summaries', 'Prepare and print', 'info')
  };
  T.receive = tile('#/grn/new', 'package-plus', 'Receive Stock', 'Enter a supplier delivery into the store', 'teal');
  const clin = clinicalHome(u, { tile, stat }); // OP / IP (modules 02, 03)
  const isClin = CLINICAL_ROLES.includes(role);
  const tiles = isClin ? clin.tiles : role === 'SUPER_ADMIN' ? [T.approvals, T.mgmt, T.sales, T.closings, T.labTests, T.users]
    : role === 'STORE_INCHARGE' ? [T.receive, T.transfer, T.labSupplies, T.approvals, T.find, T.grnList]
      : role === 'RECEPTION' ? [T.hbill, T.register, T.findPatient, ...clin.tiles, T.hbills, T.shift]
        : role === 'LAB' ? [T.lab, T.labReports, T.kits, T.findPatient]
          : role === 'SERVICE_COUNTER' ? [T.svc, T.findPatient]
            : role === 'MRD' ? [T.mrd, T.dsum, T.labReports, T.findPatient]
              : role === 'ADMIN' ? [T.labTests, T.addTest, T.labReports, T.audit]
              : [T.bill, T.findPatient, T.find, T.ret, T.close, T.shift];

  // ---------------- numbers ----------------
  const float = store.ph().openingCashFloat;
  const stockIssues = inv.low + inv.out;
  const hsum = hospitalDaySummary(today); const mysh = openShiftFor(u);
  const labQ = store.all('orders').filter((o) => o.category === 'LAB' && (o.billId || o.labVisitId));
  const svcQ = store.all('orders').filter((o) => ['ECG', 'INJECTION', 'NEBULIZATION', 'OTHER'].includes(o.category));
  const stats = isClin ? clin.stats : role === 'RECEPTION' ? [
    stat('Billed today', fmtINR(hsum.billed, true), `${hsum.bills} hospital bill(s)`, '#/hbills'),
    stat('Cash in my drawer', mysh ? fmtINR(shiftSummary(mysh).expectedCash, true) : '—', mysh ? `${mysh.shiftName} shift` : 'Shift not started', '#/shifts'),
    stat('Balance to collect', fmtINR(store.all('hbills').reduce((t, b) => t + hbillBalance(b), 0), true), 'credit & part-paid', '#/hbills?status=DUE'),
    stat('Registered today', fmtNum(store.all('patients').filter((p) => (p.registeredAt || '').slice(0, 10) === today).length), 'new patients', '#/patients')
  ] : role === 'LAB' ? [
    stat('Waiting for sample', fmtNum(stageById('collect').select('').length), 'patients to collect', '#/lab?stage=collect'),
    stat('Results to enter', fmtNum(stageById('results').select('').length), 'patients on the bench', '#/lab?stage=results'),
    stat(canSign(u) ? 'To verify' : 'With the doctor', fmtNum(stageById('verify').select('').length), canSign(u) ? `${labQ.filter((o) => o.status === 'RESULTED' && isCritical(o)).length} critical` : 'waiting for the signature', '#/lab?stage=verify'),
    stat('Reports to send', fmtNum(stageById('send').select('').length), 'WhatsApp or hand over', '#/lab?stage=send')
  ] : role === 'SERVICE_COUNTER' ? [
    stat('Ready to do', fmtNum(svcQ.filter((o) => o.status === 'READY' && orderAccess(o).ok).length), 'billed & paid', '#/services'),
    stat('Waiting for payment', fmtNum(svcQ.filter((o) => o.billId && ['READY', 'ON_HOLD'].includes(o.status) && !orderAccess(o).ok).length), 'on hold', '#/services?tab=hold'),
    stat('Advised, not billed', fmtNum(svcQ.filter((o) => o.status === 'REQUESTED').length), 'send to main counter', '#/services?tab=req'),
    stat('Done today', fmtNum(svcQ.filter((o) => o.status === 'COMPLETED' && (o.performedAt || '').slice(0, 10) === today).length), 'services', '#/services?tab=done')
  ] : role === 'MRD' ? [
    stat('Open files', fmtNum(store.all('medicalRecords').filter((r) => !r.dischargedAt).length), 'patients admitted', '#/mrd'),
    stat('To code & file', fmtNum(store.all('medicalRecords').filter((r) => r.dischargedAt && r.status !== 'FILED').length), `${store.all('medicalRecords').filter(codingOverdue).length} overdue`, '#/mrd'),
    stat('Summaries in progress', fmtNum(store.all('dischargeSummaries').filter((d) => d.status !== 'FINAL').length), 'draft / review', '#/mrd?tab=summaries'),
    stat('Files issued out', fmtNum(store.all('mrdRetrievals').filter((x) => x.status === 'ISSUED').length), 'to be returned', '#/mrd?tab=retrieval')
  ] : role === 'ADMIN' ? [
    stat('Lab tests offered', fmtNum(store.all('services').filter((s) => s.category === 'LAB' && s.active).length), `${store.all('services').filter((s) => s.category === 'LAB' && !s.active).length} stopped`, '#/lab/tests'),
    stat('Master changes (30 days)', fmtNum(store.all('services').flatMap((s) => s.history || []).filter((h) => h.version > 1 && Date.now() - new Date(h.at) < 30 * 86400000).length), 'prices, ranges, kits', '#/lab/tests'),
    stat('Lab tests billed today', fmtNum(store.all('orders').filter((o) => o.category === 'LAB' && o.billedAt && businessDate(o.billedAt) === today).length), 'all counters', '#/lab/reports'),
    stat('Lab items low / out', fmtNum(labAttention().low.length), 'request from store', '#/lab/stock')
  ] : role === 'SUPER_ADMIN' ? [
    stat('Billed today (all counters)', fmtINR(all.sales + hsum.billed, true), `Pharmacy ${fmtINR(all.sales, true)} · Main counter ${fmtINR(hsum.billed, true)}`, '#/management'),
    stat('Money collected today', fmtINR(all.netCollection + hsum.collected - hsum.refunds, true), `Cash ${fmtINR(all.byMode.CASH.net + hsum.byMode.CASH, true)} · UPI ${fmtINR(all.byMode.UPI.net + hsum.byMode.UPI, true)}`, '#/management'),
    stat('Waiting for you', fmtNum(approvals.length), approvals.length ? 'approvals' : 'all caught up', '#/approvals'),
    stat('Margin today', fmtINR(all.margin, true), `Cost ${fmtINR(all.cost, true)} → sold ${fmtINR(all.salesIncGst, true)}`, '#/pharmacy')
  ] : role === 'STORE_INCHARGE' ? [
    stat('Units in central store', fmtNum(store.all('medicines').reduce((t, m) => t + (medicineStockMap()[m.id]?.store || 0), 0)), 'Ready to send to pharmacy', '#/inventory'),
    stat('Pharmacy needs refill', fmtNum(refillSuggestions().length), 'medicines low on the shelf', '#/transfers'),
    stat('Waiting for you', fmtNum(approvals.length), 'stock receipts & corrections', '#/approvals'),
    stat('Medicines to reorder', fmtNum(stockIssues), `${inv.out} out of stock`, '#/inventory?status=LOW_STOCK')
  ] : role === 'RECEPTION_OLD' ? [
    stat('Registered today', fmtNum(store.all('patients').filter((p) => (p.registeredAt || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length), 'new patients', '#/patients'),
    stat('Total patients', fmtNum(store.all('patients').length), 'with a Patient ID', '#/patients'),
    stat('Registered by me', fmtNum(store.all('patients').filter((p) => p.registeredBy === u.id).length), 'all time', '#/patients'),
    stat('Patients visited today', fmtNum(new Set(store.all('bills').filter((b) => b.businessDate === today && b.patientId).map((b) => b.patientId)).size), 'pharmacy visits', '#/patients')
  ] : [
    stat('My sales today', fmtINR(mine.sales, true), `${mine.liveBills} bills`, '#/pharmacy/bills'),
    stat('Cash in my drawer', fmtINR(float + mine.byMode.CASH.net, true), `incl. ${fmtINR(float, true)} opening cash`),
    stat('UPI / Card today', fmtINR(mine.byMode.UPI.net + mine.byMode.CARD.net, true), `UPI ${fmtINR(mine.byMode.UPI.net, true)} · Card ${fmtINR(mine.byMode.CARD.net, true)}`),
    stat('Medicines to reorder', fmtNum(stockIssues), `${inv.out} out of stock`, '#/inventory?status=LOW_STOCK')
  ];

  // ---------------- attention list ----------------
  const todo = [];
  if (can('shift.own') && role !== 'SUPER_ADMIN') {
    pendingHandoversFor(u).forEach((h) => todo.push({ ic: 'hand-coins', tone: 'warning', text: `Accept cash handover of ${fmtINR(h.handoverAmount)}`, sub: `From ${userName(h.userId)} · ${h.shiftName} shift`, href: '#/shifts', btn: 'Count' }));
    if (!mysh) todo.push({ ic: 'play', tone: 'info', text: 'Start your shift', sub: 'Count the opening cash before the first payment', href: '#/shifts', btn: 'Start' });
  }
  if (role === 'RECEPTION') store.all('orders').filter((o) => o.status === 'REQUESTED').slice(0, 3).forEach((o) => todo.push({ ic: 'clipboard-list', tone: 'danger', text: `Bill ${o.name} for ${store.get('patients', o.patientId)?.name}`, sub: `Advised by ${o.doctor || 'doctor'} · not billed yet`, href: `#/hbill?patient=${o.patientId}`, btn: 'Bill' }));
  if (role === 'LAB') { const la = labAttention();
    la.arriving.forEach((r) => todo.push({ ic: 'truck', tone: 'info', text: `Store sent ${r.id} — receive it`, sub: `${r.issue.lines.length} lot(s) on the way. Count them and confirm.`, href: '#/lab/stock', btn: 'Receive' }));
    if (la.suggest.length) todo.push({ ic: 'trending-down', tone: 'warning', text: `${la.suggest.length} lab item(s) running low`, sub: la.suggest.slice(0, 3).map((x) => x.k.name).join(', ') + ' — the request is ready', href: '#/lab/stock', btn: 'Request' });
    if (la.packsDue.length) todo.push({ ic: 'package-open', tone: 'danger', text: `${la.packsDue.length} open pack(s) at or past use-by`, sub: 'Replace before running patient samples', href: '#/lab/stock?filter=open', btn: 'Check' }); }
  if (role === 'STORE_INCHARGE') storeAttention().requests.forEach((r) => todo.push({ ic: r.urgent ? 'zap' : 'inbox', tone: r.urgent ? 'danger' : 'warning', text: `${r.urgent ? 'URGENT: ' : ''}Lab requests ${r.lines.length} item(s) — ${r.id}`, sub: `Asked by ${userName(r.by)}`, href: '#/store/lab', btn: 'Issue' }));
  if (role === 'LAB') labQ.filter((o) => o.status === 'RESULTED' && isCritical(o)).forEach((o) => todo.push({ ic: 'siren', tone: 'danger', text: `Critical result — ${o.name}`, sub: `${store.get('patients', o.patientId)?.name} · verify and inform the doctor`, href: `#/lab/orders/${o.id}`, btn: 'Open' }));
  if (role === 'MRD') store.all('medicalRecords').filter(codingOverdue).forEach((r) => todo.push({ ic: 'file-code-2', tone: 'danger', text: `Code ${r.mrdNo}`, sub: 'Overdue after discharge', href: `#/mrd/${r.id}`, btn: 'Code' }));
  approvals.slice(0, 4).forEach((a) => todo.push({ ic: APPROVAL_TYPES[a.type].icon, tone: a.tone, text: a.title, sub: `${a.detail}${a.amount ? ' · ' + fmtINR(a.amount) : ''}`, href: a.href, btn: a.action }));
  if (approvals.length > 4) todo.push({ ic: 'inbox', tone: 'info', text: `${approvals.length - 4} more approval(s)`, sub: 'Open the Approvals inbox', href: '#/approvals', btn: 'Open' });
  if (role !== 'SUPER_ADMIN' && can('stockcount.do') && !countForDate(today)) todo.push({ ic: 'clipboard-check', tone: hour >= 17 ? 'warning' : 'info', text: "Do today's stock count", sub: 'Count the fast-moving medicines on the shelf before closing', href: '#/stock-count', btn: 'Start count' });
  const myPend = pendingClosings().filter((p) => p.cashierId === u.id);
  myPend.slice(0, 2).forEach((p) => todo.push({ ic: 'calendar-x', tone: 'warning', text: `Close your counter for ${p.date}`, sub: 'This day was not closed yet', href: `#/pharmacy/closing?date=${p.date}`, btn: 'Close now' }));
  store.all('grns').filter((g) => ['DRAFT', 'VALIDATION_REQUIRED'].includes(g.status) && g.receivedBy === u.id).slice(0, 2).forEach((g) => todo.push({ ic: 'file-pen-line', tone: g.status === 'VALIDATION_REQUIRED' ? 'warning' : 'info', text: `Finish stock entry ${g.id}`, sub: g.status === 'VALIDATION_REQUIRED' ? 'Needs correction before it can be sent' : 'Saved as draft', href: `#/grn/${g.id}/edit`, btn: 'Continue' }));
  const unpaid = store.all('bills').filter((b) => b.status !== 'CANCELLED' && b.balanceDue > 0 && (role !== 'PHARMACY_STAFF' || b.cashierId === u.id));
  if (unpaid.length && can('pharmacy.bill') && role !== 'SUPER_ADMIN') todo.push({ ic: 'hourglass', tone: 'warning', text: `${unpaid.length} bill(s) with money still to collect`, sub: fmtINR(unpaid.reduce((s, b) => s + b.balanceDue, 0)) + ' pending', href: '#/pharmacy/bills?status=PENDING', btn: 'View' });
  if (role === 'STORE_INCHARGE' && refillSuggestions().length) todo.unshift({ ic: 'arrow-right-left', tone: 'warning', text: `${refillSuggestions().length} medicine(s) low on the pharmacy shelf`, sub: 'Available in the central store — send them to the pharmacy', href: '#/transfers', btn: 'Transfer' });
  todo.push(...clin.todo);
  const hosp = ['RECEPTION', 'LAB', 'MRD', 'SERVICE_COUNTER', 'ADMIN', 'DOCTOR', 'NURSE', 'BILLING'].includes(role);
  if (inv.expired && role !== 'SUPER_ADMIN' && !hosp) todo.push({ ic: 'calendar-x', tone: 'danger', text: `${inv.expired} expired batch(es) on the shelf`, sub: 'Remove them — they cannot be sold', href: '#/batches?status=EXPIRED', btn: 'View' });
  if (inv.out && !hosp) todo.push({ ic: 'ban', tone: 'danger', text: `${inv.out} medicine(s) out of stock`, sub: 'Order from the supplier', href: '#/inventory?status=OUT_OF_STOCK', btn: 'View' });
  const alertsCount = alertsFor(u).length;

  // ---------------- lab: what to do next (replaces the generic attention / recent lists for the lab) ----------------
  let labPanels = '';
  if (role === 'LAB') {
    const ACT = { collect: 'Collect', receive: 'Receive', results: 'Enter results', verify: 'Verify', send: 'Send report' };
    const work = store.all('labVisits').map((v) => {
      const st = stageOf(v); if (!st) return null;
      const s = stageById(st); const m = minsSince(s.since(v) || v.createdAt);
      // verify step: what THIS user can do — sign, log a critical call, or nothing (waiting for the doctor)
      const vs = st === 'verify' ? verifyState(v.id, u) : null;
      return { v, s, m, late: m > s.late, vs, wait: vs?.next === 'WAIT_DOCTOR', crit: st === 'verify' && liveOrders(v).some((o) => o.status === 'RESULTED' && isCritical(o)) };
    }).filter(Boolean);
    const rank = (w) => (w.wait ? 9 : w.crit ? 0 : w.v.priority === 'STAT' ? 1 : w.v.priority === 'URGENT' ? 2 : w.late ? 3 : 4);
    const next = work.slice().sort((a, b) => rank(a) - rank(b) || b.m / b.s.late - a.m / a.s.late).slice(0, 8);
    const pri = (v) => (v.priority === 'STAT' ? '<span class="h-stat">STAT</span>' : v.priority === 'URGENT' ? '<span class="h-urg">Urgent</span>' : '<span class="h-muted">Routine</span>');
    const rows = next.map((w, i) => {
      const p = pat(w.v.patientId); const href = `#/lab?stage=${w.s.id}&v=${w.v.id}`;
      return `<tr data-href="${href}"><td class="h-sno">${i + 1}</td><td class="h-type" title="${esc(ptype(w.v).long)}">${ptypeCode(w.v)}</td><td>${ptypeCell(w.v)}</td>
        <td><b>${esc(p.name)}</b><div class="h-line">${esc(codesOf(w.v).join(', '))}</div></td>
        <td>${w.vs?.next === 'CALL' ? '<span class="h-stat">Critical — call doctor</span>' : w.wait ? '<span class="h-muted">With doctor to verify</span>' : w.crit ? '<span class="h-stat">Critical — verify</span>' : esc(w.s.label)}</td><td>${pri(w.v)}</td>
        <td class="${w.late ? 'h-late' : ''}">${dur(w.m)}${w.late ? ' · late' : ''}</td>
        <td class="ta-right"><a class="btn btn-sm ${i === 0 && !w.wait ? 'btn-primary' : 'btn-secondary'}" href="${href}">${w.vs?.next === 'CALL' ? 'Log call' : w.wait ? 'View' : ACT[w.s.id]}</a></td></tr>`;
    }).join('');
    const lateN = work.filter((w) => w.late).length;
    const redo = store.all('labVisits').filter((v) => liveTubes(v).some((t) => t.rejected && !t.collectedAt));
    const crit = work.filter((w) => w.crit && w.vs?.next === 'SIGN');
    const hold = onHold(); const notCollected = store.all('labVisits').filter(isUncollected);
    const la = labAttention();
    const noCall = store.all('orders').filter((o) => o.lab && ['RESULTED', 'COMPLETED'].includes(o.status) && isCritical(o) && !criticalCallOk(o));
    const toNotify = store.all('orders').filter((o) => o.lab?.notification?.status === 'PENDING');
    const issues = [
      noCall.length && { n: noCall.length, t: 'Critical value — doctor not informed', s: 'Phone the doctor and log the call (read back)', href: `#/lab/visit/${noCall[0].labVisitId}`, b: 'Log call', red: true },
      toNotify.length && { n: toNotify.length, t: 'Notifiable disease to report', s: toNotify.slice(0, 2).map((o) => `${o.name.split(' (')[0]} — ${pat(o.patientId).name}`).join(', '), href: '#/lab/notifiable', b: 'Report', red: true },
      crit.length && { n: crit.length, t: 'Critical result to verify', s: 'Verify and phone the doctor now', href: `#/lab?stage=verify&v=${crit[0].v.id}`, b: 'Verify', red: true },
      redo.length && { n: redo.length, t: 'Sample rejected — collect again', s: redo.slice(0, 2).map((v) => pat(v.patientId).name).join(', '), href: `#/lab?stage=collect&v=${redo[0].id}`, b: 'Recollect', red: true },
      lateN && { n: lateN, t: 'Patients past the target time', s: 'Waiting longer than the step allows', href: '#/lab', b: 'Open', red: true },
      la.packsDue.length && { n: la.packsDue.length, t: 'Open pack at or past use-by', s: 'Replace before running patient samples', href: '#/lab/stock?filter=open', b: 'Check', red: true },
      la.arriving.length && { n: la.arriving.length, t: 'Store delivery on the way', s: 'Count the lots and confirm receipt', href: '#/lab/stock', b: 'Receive' },
      la.suggest.length && { n: la.suggest.length, t: 'Lab item running low', s: la.suggest.slice(0, 2).map((x) => x.k.name).join(', ') + ' — request is ready', href: '#/lab/stock', b: 'Request' },
      hold.length && { n: hold.length, t: 'Waiting for payment', s: 'Cannot collect until the counter clears the bill', href: '#/lab', b: 'View' },
      notCollected.length && { n: notCollected.length, t: 'Report not collected', s: 'Ready for days — send on WhatsApp or call', href: '#/lab/reports', b: 'Send' }
    ].filter(Boolean);
    labPanels = `<div class="home-lab">
      <section class="card"><header class="card-head"><h2>Next patients</h2><span class="muted small">Critical, STAT and longest waiting first</span><a class="btn btn-ghost btn-sm" style="margin-left:auto" href="#/lab">Open worklist ${icon('arrow-right')}</a></header>
        ${rows ? `<div class="h-tablewrap"><table class="h-table h-wltable home-next"><thead><tr><th class="h-sno" style="width:40px">S.No</th><th style="width:44px">Type</th><th style="width:118px">Token / Bed</th><th>Patient · tests</th><th style="width:96px">Step</th><th style="width:62px">Priority</th><th style="width:84px">Waiting</th><th style="width:104px"></th></tr></thead><tbody>${rows}</tbody></table></div>`
          : emptyState('check-circle-2', 'No patients waiting', 'New paid tests appear here as soon as they are billed.')}
        ${work.length > next.length ? `<div class="pager">${work.length - next.length} more in the worklist</div>` : ''}</section>
      <section class="card"><header class="card-head"><h2>Fix these first</h2></header>
        ${issues.length ? `<div class="home-issues">${issues.map((x) => `<a class="home-issue" href="${x.href}"><b class="${x.red ? 'red' : ''}">${x.n}</b><span><strong>${esc(x.t)}</strong><small>${esc(x.s)}</small></span><span class="btn btn-secondary btn-sm">${esc(x.b)}</span></a>`).join('')}</div>`
          : emptyState('check-circle-2', 'All clear', 'No critical results, rejected samples, late patients or stock problems.')}</section></div>`;
  }

  // ---------------- recent ----------------
  const recent = [...store.all('bills')].filter((b) => role === 'PHARMACY_STAFF' ? b.cashierId === u.id : true).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  const hrecent = [...store.all('hbills')].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  const workRecent = role === 'MRD' ? store.all('medicalRecords').slice().sort((a, b) => (b.dischargedAt || b.admittedAt).localeCompare(a.dischargedAt || a.admittedAt)).slice(0, 5).map((r) => `<a class="todo" href="#/mrd/${r.id}"><span class="todo-ic sev-info">${icon('folder-open')}</span><span class="todo-txt"><strong>${esc(store.get('patients', r.patientId)?.name)} · ${esc(r.diagnosis || '—')}</strong><small>${esc(r.mrdNo)} · ${r.dischargedAt ? 'discharged ' + relTime(r.dischargedAt) : 'admitted ' + relTime(r.admittedAt)}</small></span></a>`)
    : store.all('orders').filter((o) => (role === 'LAB' ? o.category === 'LAB' : o.category !== 'LAB') && o.status === 'COMPLETED').sort((a, b) => (b.performedAt || '').localeCompare(a.performedAt || '')).slice(0, 5).map((o) => `<a class="todo" href="${o.category === 'LAB' ? '#/lab/report/' + o.id : '#/services?tab=done'}"><span class="todo-ic sev-success">${icon('check')}</span><span class="todo-txt"><strong>${esc(o.name)} · ${esc(store.get('patients', o.patientId)?.name)}</strong><small>${o.lab?.reportNo || o.id} · ${relTime(o.performedAt)}</small></span></a>`);
  const recentCard = hosp && !can('hbill.view') ? `<section class="card"><header class="card-head"><h2>Recently completed</h2></header><div class="todo-list">${workRecent.join('') || emptyState('inbox', 'Nothing yet')}</div></section>` : hosp ? `<section class="card"><header class="card-head"><h2>Latest hospital bills</h2><a class="btn btn-ghost btn-sm" href="#/hbills">All ${icon('arrow-right')}</a></header>
        <div class="todo-list">${hrecent.map((b) => `<a class="todo" href="#/hbills/${b.id}"><span class="todo-ic sev-info">${icon('receipt')}</span><span class="todo-txt"><strong>${esc(b.patientName)} · ${fmtINR(b.grandTotal)}</strong><small>${b.id} · ${esc(b.items.map((x) => x.name).slice(0, 2).join(', '))} · ${relTime(b.at)}</small></span>${badge(b.status === 'PAID' ? 'PAID' : b.status === 'CANCELLED' ? 'CANCELLED' : 'UNPAID', b.status === 'PAID' ? 'Paid' : b.status === 'CANCELLED' ? 'Cancelled' : b.credit ? 'Credit' : 'Due')}</a>`).join('')}</div></section>` : null;

  const heroImg = ['LAB', 'ADMIN'].includes(role) ? 'assets/images/hero-lab.jpg'
    : ['DOCTOR', 'NURSE'].includes(role) ? 'assets/images/hero-clinical.jpg'
    : ['PHARMACY_STAFF', 'STORE_INCHARGE'].includes(role) ? 'assets/images/hero-pharmacy.jpg'
    : 'assets/images/hero-hospital.jpg';

  view.innerHTML = `
    <section class="home-banner">
      <svg class="hb-waves" viewBox="0 0 1440 220" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0,150 C360,210 720,40 1440,120 L1440,220 L0,220 Z" fill="#E3F2F3" opacity="0.55"/>
        <path d="M0,180 C440,110 880,210 1440,60 L1440,220 L0,220 Z" fill="#D5ECEE" opacity="0.45"/>
      </svg>
      <img class="hb-art" src="${heroImg}" alt="" aria-hidden="true">
      <div class="home-hero"><div><h1>${greet}, ${esc(first)}</h1><p>${dateLine} · ${esc(roleLabel())}</p></div>
        ${role !== 'SUPER_ADMIN' && closingFor(today, u.id) ? `<span class="pill-soft">${icon('lock')} Your counter is closed for today</span>` : ''}</div>
    </section>
    <div class="home-dock">
      <div class="task-grid n${tiles.length}">${tiles.join('')}</div>
    </div>
    <h2 class="home-h">Today at a glance</h2>
    <div class="stat-grid">${stats.join('')}</div>
    ${labPanels || `<div class="home-cols">
      <section class="card"><header class="card-head"><h2>Needs your attention</h2><a class="btn btn-ghost btn-sm" href="#/alerts">All alerts (${alertsCount}) ${icon('arrow-right')}</a></header>
        <div class="todo-list">${todo.length ? todo.slice(0, 7).map((t) => `<a class="todo" href="${t.href}"><span class="todo-ic sev-${t.tone === 'danger' ? 'critical' : t.tone}">${icon(t.ic)}</span><span class="todo-txt"><strong>${esc(t.text)}</strong><small>${esc(t.sub)}</small></span><span class="btn btn-secondary btn-sm">${esc(t.btn)}</span></a>`).join('')
          : emptyState('party-popper', 'All caught up', 'Nothing needs your attention right now.')}</div></section>
      ${recentCard || clin.recent || `<section class="card"><header class="card-head"><h2>${role === 'PHARMACY_STAFF' ? 'My recent bills' : 'Recent bills'}</h2><a class="btn btn-ghost btn-sm" href="#/pharmacy/bills">All bills ${icon('arrow-right')}</a></header>
        <div class="todo-list">${recent.length ? recent.map((b) => `<a class="todo" href="#/pharmacy/bills/${b.id}"><span class="todo-ic sev-info">${icon('receipt')}</span><span class="todo-txt"><strong>${esc(b.patientName)} · ${fmtINR(b.grandTotal)}</strong><small>${b.id} · ${esc(billModeLabel(b))} · ${relTime(b.at)}${role !== 'PHARMACY_STAFF' ? ' · ' + esc(userName(b.cashierId)) : ''}</small></span>${badge(b.status)}</a>`).join('') : emptyState('receipt', 'No bills yet', 'Your bills will appear here.')}</div></section>`}
    </div>`}`;
  view.querySelectorAll('.home-next tr[data-href]').forEach((tr) => { tr.onclick = (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }; });
}
