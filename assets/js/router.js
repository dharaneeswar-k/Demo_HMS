// Hash router with permission guards.
import { currentUser, can } from './auth.js';

export const ROUTES = [
  { path: '/home', mod: 'home', fn: 'render', perm: null, title: 'Home', crumbs: ['Home'], nav: 'home' },
  { path: '/patients', mod: 'patients', fn: 'renderList', perm: 'patient.view', title: 'Patients', crumbs: ['Patients'], nav: 'patients' },
  { path: '/patients/new', mod: 'patients', fn: 'renderNew', perm: 'patient.register', title: 'Register Patient', crumbs: ['Patients', 'Register'], nav: 'patient-new' },
  { path: '/patients/:id', mod: 'patients', fn: 'renderProfile', perm: 'patient.view', title: 'Patient', crumbs: ['Patients', 'Profile'], nav: 'patients' },
  { path: '/transfers', mod: 'transfers', fn: 'render', perm: 'inventory.view', title: 'Store → Pharmacy Transfers', crumbs: ['Stock', 'Transfers'], nav: 'transfers' },
  { path: '/discounts', mod: 'discounts', fn: 'render', perm: 'discount.approve', title: 'Discount Approvals', crumbs: ['Approvals', 'Discounts'], nav: 'discounts' },
  { path: '/users', mod: 'users', fn: 'render', perm: 'users.manage', title: 'User Accounts', crumbs: ['System', 'User Accounts'], nav: 'users' },
  { path: '/approvals', mod: 'approvals', fn: 'render', perm: 'grn.verify', title: 'Approvals', crumbs: ['Approvals'], nav: 'approvals' },
  { path: '/dashboard', mod: 'dashboard', fn: 'render', perm: 'dashboard.view', title: 'Stock Insights', crumbs: ['Business', 'Stock Insights'], nav: 'insights' },
  { path: '/grn', mod: 'grn', fn: 'renderList', perm: 'grn.view', title: 'Received Stock', crumbs: ['Stock', 'Received Stock'], nav: 'grn' },
  { path: '/grn/new', mod: 'grn', fn: 'renderWizard', perm: 'grn.create', title: 'Receive Stock', crumbs: ['Stock', 'Receive Stock'], nav: 'grn-new' },
  { path: '/grn/:id/edit', mod: 'grn', fn: 'renderWizard', perm: 'grn.create', title: 'Edit GRN', crumbs: ['Stock Receiving', 'All GRNs', 'Edit'], nav: 'grn' },
  { path: '/grn/:id', mod: 'grn', fn: 'renderDetails', perm: 'grn.view', title: 'GRN Details', crumbs: ['Stock Receiving', 'All GRNs', 'Details'], nav: 'grn' },
  { path: '/inventory', mod: 'inventory', fn: 'renderOverview', perm: 'inventory.view', title: 'Stock List', crumbs: ['Stock', 'Stock List'], nav: 'inventory' },
  { path: '/inventory/:id', mod: 'inventory', fn: 'renderMedicine', perm: 'inventory.view', title: 'Medicine Inventory', crumbs: ['Inventory', 'Stock Overview', 'Medicine'], nav: 'inventory' },
  { path: '/medicines', mod: 'medicines', fn: 'render', perm: 'medicine.view', title: 'Medicines', crumbs: ['Business', 'Medicines'], nav: 'medicines' },
  { path: '/batches', mod: 'batches', fn: 'renderList', perm: 'batch.view', title: 'Expiry & Batches', crumbs: ['Stock', 'Expiry & Batches'], nav: 'batches' },
  { path: '/batches/:id', mod: 'batches', fn: 'renderDetails', perm: 'batch.view', title: 'Batch Details', crumbs: ['Inventory', 'Batch Management', 'Batch'], nav: 'batches' },
  { path: '/stock-count', mod: 'stock-count', fn: 'render', perm: 'stockcount.do', title: 'Daily Stock Count', crumbs: ['Stock', 'Daily Stock Count'], nav: 'stock-count' },
  { path: '/labels', mod: 'labels', fn: 'render', perm: 'labels.print', title: 'Barcode Labels', crumbs: ['Stock', 'Barcode Labels'], nav: 'labels' },
  { path: '/movements', mod: 'movements', fn: 'render', perm: 'movement.view', title: 'Stock History', crumbs: ['Stock', 'Stock History'], nav: 'movements' },
  { path: '/adjustments', mod: 'adjustments', fn: 'render', perm: 'adjustment.view', title: 'Stock Corrections', crumbs: ['Stock', 'Stock Corrections'], nav: 'adjustments' },
  { path: '/pharmacy', mod: 'pharmacy-dashboard', fn: 'render', perm: 'pharmacy.dashboard', title: 'Sales Insights', crumbs: ['Business', 'Sales Insights'], nav: 'ph-dash' },
  { path: '/pharmacy/bill', mod: 'billing', fn: 'render', perm: 'pharmacy.bill', title: 'Pharmacy Sale', crumbs: ['Billing', 'Pharmacy Sale'], nav: 'ph-bill' },
  { path: '/pharmacy/bills', mod: 'bills', fn: 'renderList', perm: 'pharmacy.history', title: 'Pharmacy Bills', crumbs: ['Billing', 'Pharmacy Bills'], nav: 'ph-bills' },
  { path: '/pharmacy/bills/:id', mod: 'bills', fn: 'renderDetails', perm: 'pharmacy.history', title: 'Pharmacy Bill', crumbs: ['Billing', 'Pharmacy Bills', 'Bill'], nav: 'ph-bills' },
  { path: '/pharmacy/bills/:id/receipt', mod: 'bills', fn: 'renderReceipt', perm: 'pharmacy.history', title: 'Receipt', crumbs: ['Billing', 'Receipt'], nav: 'ph-bills' },
  { path: '/pharmacy/returns', mod: 'pharmacy-returns', fn: 'render', perm: 'pharmacy.return.request', title: 'Sales Returns & Refunds', crumbs: ['Billing', 'Sales Returns'], nav: 'ph-returns' },
  { path: '/pharmacy/closing', mod: 'closing', fn: 'render', perm: 'pharmacy.closing', title: 'Counter Closing', crumbs: ['Billing', 'Counter Closing'], nav: 'ph-closing' },
  { path: '/pharmacy/closing-report', mod: 'closing', fn: 'renderReport', perm: 'pharmacy.closing.report', title: 'Counter Closing Report', crumbs: ['Billing', 'Closing Report'], nav: 'ph-report' },
  { path: '/suppliers', mod: 'suppliers', fn: 'renderList', perm: 'supplier.view', title: 'Suppliers', crumbs: ['Suppliers'], nav: 'suppliers' },
  { path: '/suppliers/:id', mod: 'suppliers', fn: 'renderDetails', perm: 'supplier.view', title: 'Supplier Details', crumbs: ['Suppliers', 'Details'], nav: 'suppliers' },
  { path: '/alerts', mod: 'alerts', fn: 'render', perm: 'alerts.view', title: 'Alerts', crumbs: ['Alerts'], nav: 'alerts' },
  { path: '/reports', mod: 'reports', fn: 'render', perm: 'reports.view', title: 'Reports', crumbs: ['Reports'], nav: 'reports' },
  { path: '/settings', mod: 'settings', fn: 'render', perm: null, title: 'Settings', crumbs: ['Settings'], nav: 'settings' },
  { path: '/audit', mod: 'settings', fn: 'renderAudit', perm: 'audit.view', title: 'Audit Log', crumbs: ['Settings', 'Audit Log'], nav: 'audit' },
  { path: '/profile', mod: 'settings', fn: 'renderProfile', perm: null, title: 'My Profile', crumbs: ['My Profile'], nav: null },
  { path: '/help', mod: 'help', fn: 'render', perm: null, title: 'Help', crumbs: ['Help'], nav: 'help' },
  // Central billing counter (BRD 08) + packages (10)
  { path: '/hbill', mod: 'hbilling', fn: 'render', perm: 'hbill.create', title: 'Hospital Bill', crumbs: ['Billing', 'Hospital Bill'], nav: 'hb-new' },
  { path: '/hbills', mod: 'hbills', fn: 'renderList', perm: 'hbill.view', title: 'Hospital Bills', crumbs: ['Billing', 'Hospital Bills'], nav: 'hb-list' },
  { path: '/hbills/:id', mod: 'hbills', fn: 'renderDetail', perm: 'hbill.view', title: 'Hospital Bill', crumbs: ['Billing', 'Hospital Bills', 'Bill'], nav: 'hb-list' },
  { path: '/hbills/:id/receipt', mod: 'hbills', fn: 'renderReceipt', perm: 'hbill.view', title: 'Receipt', crumbs: ['Billing', 'Receipt'], nav: 'hb-list' },
  { path: '/packages', mod: 'packages', fn: 'render', perm: 'package.view', title: 'Packages', crumbs: ['Billing', 'Packages'], nav: 'packages' },
  { path: '/packages/enrolments/:id', mod: 'packages', fn: 'renderEnrolment', perm: 'package.view', title: 'Package', crumbs: ['Billing', 'Packages', 'Enrolment'], nav: 'packages' },
  // Shifts (BRD 12)
  { path: '/shifts', mod: 'shifts', fn: 'render', perm: 'shift.own', title: 'My Shift', crumbs: ['Billing', 'My Shift'], nav: 'shift' },
  { path: '/shifts/register', mod: 'shifts', fn: 'renderRegister', perm: 'shift.report', title: 'Shift Register', crumbs: ['Business', 'Shift Register'], nav: 'shift-reg' },
  { path: '/shifts/:id', mod: 'shifts', fn: 'renderDetail', perm: null, title: 'Shift Report', crumbs: ['Shifts', 'Report'], nav: 'shift' },
  // Laboratory (BRD 06)
  { path: '/lab', mod: 'lab', fn: 'renderWorklist', perm: 'lab.work', title: 'Lab Worklist', crumbs: ['Laboratory', 'Worklist'], nav: 'lab' },
  { path: '/lab/orders/:id', mod: 'lab', fn: 'renderOrder', perm: 'lab.view', title: 'Lab Test', crumbs: ['Laboratory', 'Test'], nav: 'lab' },
  { path: '/lab/report/:id', mod: 'lab', fn: 'renderReport', perm: 'lab.view', title: 'Lab Report', crumbs: ['Laboratory', 'Report'], nav: 'lab-reports' },
  { path: '/lab/reports', mod: 'lab', fn: 'renderReports', perm: 'lab.view', title: 'Lab Reports', crumbs: ['Laboratory', 'Reports'], nav: 'lab-reports' },
  { path: '/lab/kits', mod: 'lab', fn: 'renderKits', perm: 'lab.kits', title: 'Reagent Kits', crumbs: ['Laboratory', 'Reagent Kits'], nav: 'lab-kits' },
  // Service counter (BRD 07)
  { path: '/services', mod: 'service-counter', fn: 'render', perm: 'orders.view', title: 'Service Counter', crumbs: ['Services', 'Service Counter'], nav: 'svc' },
  { path: '/services/reconciliation', mod: 'service-counter', fn: 'renderRecon', perm: 'management.view', title: 'Services: Requested vs Billed vs Done', crumbs: ['Business', 'Service Reconciliation'], nav: 'svc-recon' },
  // MRD (BRD 11)
  { path: '/mrd', mod: 'mrd', fn: 'render', perm: 'mrd.view', title: 'Medical Records', crumbs: ['Medical Records'], nav: 'mrd' },
  { path: '/mrd/summary/:id', mod: 'mrd', fn: 'renderSummary', perm: 'mrd.view', title: 'Discharge Summary', crumbs: ['Medical Records', 'Discharge Summary'], nav: 'mrd' },
  { path: '/mrd/summary/:id/print', mod: 'mrd', fn: 'renderSummaryPrint', perm: 'mrd.view', title: 'Discharge Summary', crumbs: ['Medical Records', 'Print'], nav: 'mrd' },
  { path: '/mrd/:id', mod: 'mrd', fn: 'renderRecord', perm: 'mrd.view', title: 'Medical Record', crumbs: ['Medical Records', 'Record'], nav: 'mrd' },
  // Management (BRD 13) and setup
  { path: '/management', mod: 'management', fn: 'render', perm: 'management.view', title: 'Management Dashboard', crumbs: ['Business', 'Management Dashboard'], nav: 'mgmt' },
  { path: '/setup', mod: 'setup', fn: 'render', perm: 'catalog.manage', title: 'Hospital Setup', crumbs: ['System', 'Hospital Setup'], nav: 'setup' }
];

export function parseHash() {
  let raw = location.hash.replace(/^#/, '') || '/home';
  if (raw.startsWith('/issue')) raw = raw.replace('/issue', '/pharmacy/bill'); // legacy links
  const [path, qs = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}
export function match(path) {
  const parts = path.split('/').filter(Boolean);
  for (const r of ROUTES) {
    const rp = r.path.split('/').filter(Boolean);
    if (rp.length !== parts.length) continue;
    const params = {};
    if (rp.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(parts[i])), true) : p === parts[i]))) return { route: r, params };
  }
  return null;
}
export const navigate = (hash) => { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; };

/** Returns { status: 'login' | 'ok' | 'forbidden' | 'notfound', route, params, query } */
export function resolve() {
  const { path, query } = parseHash();
  if (path === '/login') return { status: 'login', query };
  if (!currentUser()) return { status: 'login', redirect: path, query };
  const m = match(path);
  if (!m) return { status: 'notfound', query };
  if (m.route.perm && !can(m.route.perm)) return { status: 'forbidden', ...m, query };
  return { status: 'ok', ...m, query };
}
