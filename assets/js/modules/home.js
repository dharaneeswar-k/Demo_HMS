// Home — one calm page per role: what to do, four key numbers, and what needs attention.
import { store } from '../data-service.js';
import { currentUser, can, roleLabel } from '../auth.js';
import { inventoryKPIs, derivedAlerts, userName, medicineStockMap } from '../calculations.js';
import { daySummary, businessDate, pendingClosings, closingFor, billModeLabel } from '../pharmacy-calc.js';
import { approvalItems, APPROVAL_TYPES } from '../approvals.js';
import { countForDate } from '../stock-count.js';
import { refillSuggestions } from './transfers.js';
import { badge, emptyState } from '../components.js';
import { clinicalHome, CLINICAL_ROLES } from './home-clinical.js';
import { esc, icon, fmtINR, fmtNum, relTime } from '../utils.js';

const tile = (href, ic, title, desc, tone = 'teal', count) => `<a class="task-tile tone-${tone}" href="${href}">
  <span class="tt-icon">${icon(ic)}</span><span class="tt-text"><strong>${esc(title)}</strong><small>${esc(desc)}</small></span>
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
    close: tile('#/pharmacy/closing', 'lock', 'Counter Closing', closingFor(today, u.id) ? 'Your counter is closed today' : 'Count cash and submit', 'purple'),
    approvals: tile('#/approvals', 'inbox', 'Approvals', approvals.length ? 'Waiting for your decision' : 'Nothing waiting', approvals.length ? 'danger' : 'success', approvals.length || null),
    reports: tile('#/reports', 'bar-chart-3', 'Reports', 'Sales, stock and expiry reports', 'info'),
    closings: tile('#/pharmacy/closing-report', 'clipboard-list', 'Day Closings', 'Cash and collection by staff', 'purple'),
    sales: tile('#/pharmacy', 'trending-up', 'Sales Today', 'Charts and payment modes', 'teal'),
    stockAlerts: tile('#/alerts', 'bell-ring', 'Stock Alerts', 'Low stock and expiry', 'warning'),
    settings: tile('#/settings', 'settings', 'Settings', 'Limits, approvals, branding', 'navy'),
    register: tile('#/patients/new', 'user-plus', 'Register Patient', 'New patient — generates Patient ID', 'teal'),
    findPatient: tile('#/patients', 'user-search', 'Find Patient', 'Search by name, ID or mobile', 'info'),
    transfer: tile('#/transfers', 'arrow-right-left', 'Send to Pharmacy', 'Store → Pharmacy transfer', 'navy', refillSuggestions().length || null),
    grnList: tile('#/grn', 'package-check', 'Received Stock', 'Supplier deliveries and status', 'info'),
    users: tile('#/users', 'user-cog', 'User Accounts', 'Staff logins and roles', 'navy')
  };
  T.receive = tile('#/grn/new', 'package-plus', 'Receive Stock', 'Enter a supplier delivery into the store', 'teal');
  const clin = clinicalHome(u, { tile, stat }); // OP / IP (modules 02, 03)
  const isClin = CLINICAL_ROLES.includes(role);
  const tiles = isClin ? clin.tiles : role === 'SUPER_ADMIN' ? [T.approvals, T.sales, T.closings, T.stockAlerts, T.reports, T.users]
    : role === 'STORE_INCHARGE' ? [T.receive, T.transfer, T.approvals, T.find, T.grnList, T.reports]
      : role === 'RECEPTION' ? [T.register, T.findPatient, ...clin.tiles]
        : [T.bill, T.findPatient, T.find, T.ret, T.close];

  // ---------------- numbers ----------------
  const float = store.ph().openingCashFloat;
  const stockIssues = inv.low + inv.out;
  const stats = isClin ? clin.stats : role === 'SUPER_ADMIN' ? [
    stat("Today's sales", fmtINR(all.sales, true), `Patients ${fmtINR(all.bySale.PATIENT.sales, true)} · Walk-in ${fmtINR(all.bySale.WALKIN.sales, true)}`, '#/pharmacy'),
    stat('Money collected today', fmtINR(all.netCollection, true), `Cash ${fmtINR(all.byMode.CASH.net, true)} · UPI ${fmtINR(all.byMode.UPI.net, true)}`, '#/pharmacy'),
    stat('Waiting for you', fmtNum(approvals.length), approvals.length ? 'approvals' : 'all caught up', '#/approvals'),
    stat('Margin today', fmtINR(all.margin, true), `Cost ${fmtINR(all.cost, true)} → sold ${fmtINR(all.salesIncGst, true)}`, '#/pharmacy')
  ] : role === 'STORE_INCHARGE' ? [
    stat('Units in central store', fmtNum(store.all('medicines').reduce((t, m) => t + (medicineStockMap()[m.id]?.store || 0), 0)), 'Ready to send to pharmacy', '#/inventory'),
    stat('Pharmacy needs refill', fmtNum(refillSuggestions().length), 'medicines low on the shelf', '#/transfers'),
    stat('Waiting for you', fmtNum(approvals.length), 'stock receipts & corrections', '#/approvals'),
    stat('Medicines to reorder', fmtNum(stockIssues), `${inv.out} out of stock`, '#/inventory?status=LOW_STOCK')
  ] : role === 'RECEPTION' ? [
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
  if (inv.expired && role !== 'SUPER_ADMIN' && role !== 'RECEPTION' && can('batch.view')) todo.push({ ic: 'calendar-x', tone: 'danger', text: `${inv.expired} expired batch(es) on the shelf`, sub: 'Remove them — they cannot be sold', href: '#/batches?status=EXPIRED', btn: 'View' });
  if (inv.out && role !== 'RECEPTION' && can('inventory.view')) todo.push({ ic: 'ban', tone: 'danger', text: `${inv.out} medicine(s) out of stock`, sub: 'Order from the supplier', href: '#/inventory?status=OUT_OF_STOCK', btn: 'View' });
  const alertsCount = derivedAlerts().length;

  // ---------------- recent ----------------
  const recent = [...store.all('bills')].filter((b) => role === 'PHARMACY_STAFF' ? b.cashierId === u.id : true).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);

  view.innerHTML = `
    <div class="home-hero"><div><h1>${greet}, ${esc(first)}</h1><p>${dateLine} · ${esc(roleLabel())}</p></div>
      ${role !== 'SUPER_ADMIN' && closingFor(today, u.id) ? `<span class="pill-soft">${icon('lock')} Your counter is closed for today</span>` : ''}</div>
    <h2 class="home-h">What would you like to do?</h2>
    <div class="task-grid n${tiles.length}">${tiles.join('')}</div>
    <h2 class="home-h">Today at a glance</h2>
    <div class="stat-grid">${stats.join('')}</div>
    <div class="home-cols">
      <section class="card"><header class="card-head"><h2>Needs your attention</h2><a class="btn btn-ghost btn-sm" href="#/alerts">All alerts (${alertsCount}) ${icon('arrow-right')}</a></header>
        <div class="todo-list">${todo.length ? todo.slice(0, 7).map((t) => `<a class="todo" href="${t.href}"><span class="todo-ic sev-${t.tone === 'danger' ? 'critical' : t.tone}">${icon(t.ic)}</span><span class="todo-txt"><strong>${esc(t.text)}</strong><small>${esc(t.sub)}</small></span><span class="btn btn-secondary btn-sm">${esc(t.btn)}</span></a>`).join('')
          : emptyState('party-popper', 'All caught up', 'Nothing needs your attention right now.')}</div></section>
      ${clin.recent || `<section class="card"><header class="card-head"><h2>${role === 'PHARMACY_STAFF' ? 'My recent bills' : 'Recent bills'}</h2><a class="btn btn-ghost btn-sm" href="#/pharmacy/bills">All bills ${icon('arrow-right')}</a></header>
        <div class="todo-list">${recent.length ? recent.map((b) => `<a class="todo" href="#/pharmacy/bills/${b.id}"><span class="todo-ic sev-info">${icon('receipt')}</span><span class="todo-txt"><strong>${esc(b.patientName)} · ${fmtINR(b.grandTotal)}</strong><small>${b.id} · ${esc(billModeLabel(b))} · ${relTime(b.at)}${role !== 'PHARMACY_STAFF' ? ' · ' + esc(userName(b.cashierId)) : ''}</small></span>${badge(b.status)}</a>`).join('') : emptyState('receipt', 'No bills yet', 'Your bills will appear here.')}</div></section>`}
    </div>`;
}
