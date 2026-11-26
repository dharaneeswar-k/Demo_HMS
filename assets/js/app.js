// Application bootstrap: login screen, application shell (sidebar + header), routing and global widgets.
import { initData, store, resetDemoData } from './data-service.js';
import { login, logout, currentUser, can, roleLabel } from './auth.js';
import { resolve, navigate } from './router.js';
import { esc, icon, refreshIcons, initials, fmtDate, relTime, debounce, qs } from './utils.js';
import { toast, unreadCount, visibleNotifications, isRead, markRead, markAllRead, notificationLink } from './notifications.js';
import { destroyCharts, confirmDialog, openModal, emptyState, skeleton } from './components.js';
import { derivedAlerts, medName, supplierName } from './calculations.js';
import { approvalItems } from './approvals.js';

const app = document.getElementById('app');
let cleanup = null;
let currentMeta = null;

// ---------------- branding ----------------
export function brandMark(size = 'md') {
  const s = store.settings();
  if (s.logo) return `<img class="brand-logo brand-${size}" src="${esc(s.logo)}" alt="${esc(s.hospitalName)} logo">`;
  return `<div class="brand-text brand-${size}"><span class="brand-badge">${esc(initials(s.hospitalName).slice(0, 1))}</span><span class="brand-name">${esc(s.hospitalName)}</span></div>`;
}
function applyTheme() {
  const t = store.settings().theme || {};
  document.documentElement.style.setProperty('--navy', t.primary || '#023459');
  document.documentElement.style.setProperty('--teal', t.accent || '#049794');
  document.title = `${store.settings().hospitalName} · Hospital Management System`;
}

// ---------------- login ----------------
function renderLogin(redirect) {
  document.body.classList.add('is-login');
  const s = store.settings();
  const remembered = localStorage.getItem('nallam_hms_last_user') || '';
  const year = new Date().getFullYear();
  app.innerHTML = `
  <div class="login">
    <aside class="login-brand" style="${s.banner?.image ? `background-image:linear-gradient(160deg,rgba(2,52,89,.94),rgba(2,52,89,.80)),url('${esc(s.banner.image)}')` : ''}">
      <div class="login-pattern" aria-hidden="true"></div>
      <div class="login-brand-top">${brandMark('lg')}</div>
      <div class="login-hero">
        <h1>${esc(s.banner?.title || 'Hospital Management System')}</h1>
        <p>${esc(s.banner?.subtitle || '')}</p>
        <ul class="login-points">
          <li>${icon('receipt')}<div><strong>One billing desk</strong><span>Lab, services, packages and pharmacy — paid before anything is done</span></div></li>
          <li>${icon('flask-conical')}<div><strong>Lab to records</strong><span>Barcoded samples, verified reports, discharge summaries</span></div></li>
          <li>${icon('shield-check')}<div><strong>Nothing leaks</strong><span>Stock, kits, services and cash tally every shift</span></div></li>
        </ul>
      </div>
      <div class="login-foot"><span>${esc(s.hospitalName)}${s.city ? ' · ' + esc(s.city) : ''}</span><span>© ${year}</span></div>
    </aside>
    <main class="login-main">
      <form class="login-card" novalidate>
        <div class="login-mobile-brand">${brandMark('md')}</div>
        <div class="login-head"><h2>Sign in</h2><p class="muted">Use your hospital staff account to continue.</p></div>
        <div class="alert alert-danger hidden" data-err role="alert"></div>
        <div class="field"><label for="lg-user">Username</label>
          <div class="input-icon">${icon('user-round')}<input id="lg-user" class="input" name="username" autocomplete="username" value="${esc(remembered)}" placeholder="Enter your username"></div></div>
        <div class="field"><label for="lg-pass">Password</label>
          <div class="input-icon">${icon('key-round')}<input id="lg-pass" class="input" name="password" type="password" autocomplete="current-password" placeholder="Enter your password">
          <button type="button" class="input-suffix" data-toggle aria-label="Show password">${icon('eye')}</button></div></div>
        <div class="row-between">
          <label class="check"><input type="checkbox" name="remember" ${remembered ? 'checked' : ''}> Keep me signed in</label>
          <a href="#" data-forgot class="link small">Forgot password?</a>
        </div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Sign in ${icon('arrow-right')}</button>
        <p class="login-secure">${icon('shield-check')} Authorised hospital staff only. All activity is recorded.</p>
      </form>
      <p class="login-copy">${esc(s.hospitalName)} · Hospital Management System</p>
    </main>
  </div>`;
  refreshIcons(app);
  const form = qs('form', app); const err = qs('[data-err]', app);
  const showErr = (m) => { err.textContent = m; err.classList.remove('hidden'); };
  qs('[data-toggle]', app).onclick = (e) => {
    const p = form.password; p.type = p.type === 'password' ? 'text' : 'password';
    e.currentTarget.innerHTML = icon(p.type === 'password' ? 'eye' : 'eye-off'); e.currentTarget.setAttribute('aria-label', p.type === 'password' ? 'Show password' : 'Hide password'); refreshIcons(e.currentTarget);
  };
  qs('[data-forgot]', app).onclick = (e) => { e.preventDefault(); openModal({ title: 'Reset your password', size: 'sm', body: `<div class="confirm"><div class="confirm-ic">${icon('key-round')}</div><div class="confirm-msg">For security, passwords are reset by the hospital administrator. Please contact the hospital administrator (Super Admin) to receive a new password.</div></div>`, footer: [{ label: 'OK', cls: 'btn-primary', onClick: (c) => c() }] }); };
  form.addEventListener('submit', (e) => {
    e.preventDefault(); err.classList.add('hidden');
    const u = form.username.value.trim(); const p = form.password.value;
    form.username.closest('.field').classList.toggle('has-error', !u); form.password.closest('.field').classList.toggle('has-error', !p);
    if (!u || !p) return showErr(!u && !p ? 'Enter your username and password.' : !u ? 'Enter your username.' : 'Enter your password.');
    const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Signing in…';
    setTimeout(() => {
      const r = login(u, p, form.remember.checked);
      if (!r.ok) { btn.disabled = false; btn.innerHTML = 'Sign in ' + icon('arrow-right'); refreshIcons(btn); return showErr(r.error); }
      if (form.remember.checked) localStorage.setItem('nallam_hms_last_user', r.user.username); else localStorage.removeItem('nallam_hms_last_user');
      document.body.classList.remove('is-login');
      toast(`Signed in as ${r.user.name}.`, 'success', 'Welcome');
      navigate('#' + (redirect && redirect !== '/login' ? redirect : '/home'));
    }, 450);
  });
  (remembered ? form.password : form.username).focus();
}

// ---------------- shell ----------------
// Role-aware navigation. Items listed in `more` for a role are tucked into a collapsed "More" group for that role
// so each person sees only what they use every day.
const STAFF = 'PHARMACY_STAFF', MANAGER = 'STORE_INCHARGE', OWNER = 'SUPER_ADMIN', RECEPTION = 'RECEPTION', LAB = 'LAB', MRD = 'MRD', SVC = 'SERVICE_COUNTER';
const NAV = [
  { id: 'home', label: 'Home', icon: 'home', href: '#/home' },
  { id: 'approvals', label: 'Approvals', icon: 'inbox', href: '#/approvals', perm: 'grn.verify', badge: 'approvals' },
  { id: 'discounts', label: 'Discount Approvals', icon: 'percent', href: '#/discounts', perm: 'discount.approve', more: [OWNER] },
  { id: 'alerts', label: 'Alerts', icon: 'bell-ring', href: '#/alerts', perm: 'alerts.view', badge: 'alerts' },
  { id: 'mgmt', label: 'Management Dashboard', icon: 'layout-dashboard', href: '#/management', perm: 'management.view' },
  { section: 'Patients' },
  { id: 'patient-new', label: 'Register Patient', icon: 'user-plus', href: '#/patients/new', perm: 'patient.register', more: [OWNER, STAFF] },
  { id: 'patients', label: 'Patients', icon: 'users-round', href: '#/patients', perm: 'patient.view' },
  { section: 'Billing · Main Counter' },
  { id: 'hb-new', label: 'Hospital Bill', icon: 'receipt', href: '#/hbill', perm: 'hbill.create', more: [OWNER] },
  { id: 'hb-list', label: 'Hospital Bills', icon: 'files', href: '#/hbills', perm: 'hbill.view' },
  { id: 'packages', label: 'Packages', icon: 'package', href: '#/packages', perm: 'package.view', more: [RECEPTION] },
  { id: 'shift', label: 'My Shift', icon: 'timer', href: '#/shifts', perm: 'shift.own', more: [OWNER] },
  { section: 'Billing · Pharmacy' },
  { id: 'ph-bill', label: 'Pharmacy Sale', icon: 'shopping-cart', href: '#/pharmacy/bill', perm: 'pharmacy.bill', more: [OWNER] },
  { id: 'ph-bills', label: 'Pharmacy Bills', icon: 'receipt-text', href: '#/pharmacy/bills', perm: 'pharmacy.history' },
  { id: 'ph-returns', label: 'Sales Returns', icon: 'undo-2', href: '#/pharmacy/returns', perm: 'pharmacy.return.request', more: [OWNER] },
  { id: 'ph-closing', label: 'Counter Closing', icon: 'lock', href: '#/pharmacy/closing', perm: 'pharmacy.closing', more: [OWNER] },
  { id: 'ph-report', label: 'Closing Report', icon: 'clipboard-list', href: '#/pharmacy/closing-report', perm: 'pharmacy.closing.report' },
  { section: 'Laboratory' },
  { id: 'lab', label: 'Lab Workbench', icon: 'test-tube', href: '#/lab', perm: 'lab.work', more: [OWNER] },
  { id: 'lab-reports', label: 'Report Desk', icon: 'send', href: '#/lab/reports', perm: 'lab.view', more: [OWNER, MRD] },
  { id: 'lab-ward', label: 'Ward Lab Order', icon: 'bed-double', href: '#/lab/ward-order', perm: 'lab.order.ip', more: [OWNER] },
  { id: 'lab-kits', label: 'Reagent Kits', icon: 'boxes', href: '#/lab/kits', perm: 'lab.kits', more: [OWNER] },
  { section: 'Services' },
  { id: 'svc', label: 'Service Counter', icon: 'syringe', href: '#/services', perm: 'orders.view', more: [OWNER, RECEPTION, LAB, MRD] },
  { section: 'Medical Records' },
  { id: 'mrd', label: 'Medical Records', icon: 'folder-open', href: '#/mrd', perm: 'mrd.view' },
  { section: 'Stock' },
  { id: 'grn-new', label: 'Receive Stock', icon: 'package-plus', href: '#/grn/new', perm: 'grn.create', more: [OWNER] },
  { id: 'grn', label: 'Received Stock', icon: 'package-check', href: '#/grn', perm: 'grn.view' },
  { id: 'stock-count', label: 'Daily Stock Count', icon: 'clipboard-check', href: '#/stock-count', perm: 'stockcount.do', more: [OWNER] },
  { id: 'transfers', label: 'Store → Pharmacy', icon: 'arrow-right-left', href: '#/transfers', perm: 'inventory.view' },
  { id: 'inventory', label: 'Stock List', icon: 'boxes', href: '#/inventory', perm: 'inventory.view' },
  { id: 'batches', label: 'Expiry & Batches', icon: 'calendar-clock', href: '#/batches', perm: 'batch.view' },
  { id: 'labels', label: 'Barcode Labels', icon: 'barcode', href: '#/labels', perm: 'labels.print', more: [OWNER] },
  { id: 'adjustments', label: 'Stock Corrections', icon: 'scale', href: '#/adjustments', perm: 'adjustment.view', more: [STAFF] },
  { id: 'movements', label: 'Stock History', icon: 'arrow-left-right', href: '#/movements', perm: 'movement.view', more: [STAFF, MANAGER, OWNER] },
  { section: 'Business' },
  { id: 'reports', label: 'Reports', icon: 'bar-chart-3', href: '#/reports', perm: 'reports.view', more: [STAFF] },
  { id: 'shift-reg', label: 'Shift Register', icon: 'calendar-clock', href: '#/shifts/register', perm: 'shift.report' },
  { id: 'svc-recon', label: 'Service Reconciliation', icon: 'scale', href: '#/services/reconciliation', perm: 'management.view', more: [OWNER] },
  { id: 'ph-dash', label: 'Sales Insights', icon: 'trending-up', href: '#/pharmacy', perm: 'pharmacy.dashboard', more: [STAFF] },
  { id: 'insights', label: 'Stock Insights', icon: 'line-chart', href: '#/dashboard', perm: 'dashboard.view', more: [STAFF, MANAGER] },
  { id: 'medicines', label: 'Medicines', icon: 'pill', href: '#/medicines', perm: 'medicine.view', more: [STAFF, MANAGER, OWNER] },
  { id: 'suppliers', label: 'Suppliers', icon: 'truck', href: '#/suppliers', perm: 'supplier.view', more: [STAFF, MANAGER] },
  { section: 'System' },
  { id: 'setup', label: 'Hospital Setup', icon: 'sliders-horizontal', href: '#/setup', perm: 'catalog.manage' },
  { id: 'settings', label: 'Settings', icon: 'settings', href: '#/settings', more: [STAFF, MANAGER, RECEPTION, LAB, MRD, SVC] },
  { id: 'users', label: 'User Accounts', icon: 'user-cog', href: '#/users', perm: 'users.manage' },
  { id: 'audit', label: 'Audit Log', icon: 'history', href: '#/audit', perm: 'audit.view' },
  { id: 'help', label: 'Help', icon: 'life-buoy', href: '#/help' }
];

function sidebarHTML() {
  const u = currentUser();
  const moreOpen = localStorage.getItem('nallam_hms_more') === '1';
  const item = (n) => `<a class="nav-link" href="${n.href}" data-nav="${n.id}" title="${esc(n.label)}">${icon(n.icon)}<span class="nav-label">${esc(n.label)}</span>${n.badge ? `<span class="nav-badge hidden" data-badge="${n.badge}"></span>` : ''}</a>`;
  const visible = (n) => !n.perm || can(n.perm);
  const main = []; const more = [];
  let section = null;
  for (const n of NAV) {
    if (n.section) { section = n.section; continue; }
    if (!visible(n)) continue;
    if (n.more?.includes(u.role)) { more.push(n); continue; }
    main.push({ ...n, section });
  }
  let html = ''; let last = null;
  for (const n of main) {
    if (n.section && n.section !== last) { html += `<div class="nav-section">${esc(n.section)}</div>`; last = n.section; }
    html += item(n);
  }
  if (more.length) html += `<div class="nav-group nav-more ${moreOpen ? 'open' : ''}" data-group="more"><button class="nav-link nav-group-btn" type="button" aria-expanded="${moreOpen}">${icon('more-horizontal')}<span class="nav-label">More</span>${icon('chevron-down', 'nav-caret')}</button><div class="nav-children">${more.map(item).join('')}</div></div>`;
  return html;
}

function renderShell() {
  const u = currentUser();
  const s = store.settings();
  document.body.classList.remove('is-login');
  document.body.classList.toggle('sb-collapsed', localStorage.getItem('nallam_hms_sb') === '1');
  app.innerHTML = `
  <div class="shell">
    <aside class="sidebar" aria-label="Main navigation">
      <div class="sb-brand"><a href="#/home" class="sb-brand-link">${brandMark('sm')}</a><span class="sb-sub">Hospital Management System</span></div>
      <nav class="sb-nav">${sidebarHTML()}</nav>
      <div class="sb-foot">
        <div class="sb-user"><span class="avatar">${esc(initials(u.name))}</span><div class="sb-user-txt"><strong>${esc(u.name)}</strong><span>${esc(roleLabel(u))}</span></div></div>
        <button class="nav-link sb-collapse" data-collapse title="Collapse sidebar">${icon('panel-left-close')}<span class="nav-label">Collapse</span></button>
      </div>
    </aside>
    <div class="sb-overlay" data-sb-close></div>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn mobile-only" data-sb-open aria-label="Open menu">${icon('menu')}</button>
        <div class="tb-title"><nav class="crumbs" aria-label="Breadcrumb" data-crumbs></nav><div class="tb-h" data-title></div></div>
        <div class="tb-search">
          ${icon('search')}<input class="input" type="search" placeholder="Search medicine, bill, patient, supplier…" data-gsearch aria-label="Global search">
          <div class="gs-results hidden" data-gresults></div>
        </div>
        <div class="tb-right">
          <div class="pop-wrap"><button class="icon-btn" data-bell aria-label="Notifications">${icon('bell')}<span class="bell-count hidden" data-bell-count></span></button><div class="popover notif-pop hidden" data-notif-pop></div></div>
          <div class="pop-wrap"><button class="profile-btn" data-profile><span class="avatar">${esc(initials(u.name))}</span><span class="pb-txt"><strong>${esc(u.name)}</strong><small>${esc(roleLabel(u))}</small></span>${icon('chevron-down')}</button>
            <div class="popover profile-pop hidden" data-profile-pop>
              <div class="pp-head"><span class="avatar avatar-lg">${esc(initials(u.name))}</span><div><strong>${esc(u.name)}</strong><div class="muted small">${esc(u.designation)}</div><span class="role-pill">${esc(roleLabel(u))}</span></div></div>
              <a class="pp-item" href="#/profile">${icon('user-round')}My profile</a>
              ${can('settings.manage') ? `<a class="pp-item" href="#/settings">${icon('settings')}Settings</a>` : ''}
              <a class="pp-item" href="#/help">${icon('life-buoy')}Help & Support</a>
              <button class="pp-item danger" data-logout>${icon('log-out')}Sign out</button>
            </div></div>
        </div>
      </header>
      <main class="view" id="view" tabindex="-1"></main>
    </div>
  </div>`;
  refreshIcons(app);
  wireShell();
}

function wireShell() {
  const root = app;
  root.querySelectorAll('.nav-group-btn').forEach((b) => {
    b.onclick = () => {
      if (document.body.classList.contains('sb-collapsed')) { document.body.classList.remove('sb-collapsed'); localStorage.setItem('nallam_hms_sb', '0'); }
      const g = b.closest('.nav-group'); g.classList.toggle('open'); b.setAttribute('aria-expanded', g.classList.contains('open'));
      localStorage.setItem('nallam_hms_more', g.classList.contains('open') ? '1' : '0');
    };
  });
  qs('[data-collapse]', root).onclick = () => { const c = document.body.classList.toggle('sb-collapsed'); localStorage.setItem('nallam_hms_sb', c ? '1' : '0'); };
  qs('[data-sb-open]', root).onclick = () => document.body.classList.add('sb-mobile-open');
  qs('[data-sb-close]', root).onclick = () => document.body.classList.remove('sb-mobile-open');

  // popovers
  const bell = qs('[data-bell]', root); const np = qs('[data-notif-pop]', root);
  const prof = qs('[data-profile]', root); const pp = qs('[data-profile-pop]', root);
  bell.onclick = (e) => { e.stopPropagation(); pp.classList.add('hidden'); np.classList.toggle('hidden'); if (!np.classList.contains('hidden')) drawNotifPop(); };
  prof.onclick = (e) => { e.stopPropagation(); np.classList.add('hidden'); pp.classList.toggle('hidden'); };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pop-wrap')) { np.classList.add('hidden'); pp.classList.add('hidden'); }
    if (!e.target.closest('.tb-search')) qs('[data-gresults]')?.classList.add('hidden');
  });
  pp.addEventListener('click', (e) => { if (e.target.closest('a')) pp.classList.add('hidden'); });
  qs('[data-logout]', root).onclick = async () => {
    pp.classList.add('hidden');
    if (await confirmDialog({ title: 'Sign out?', message: 'You will be returned to the login screen.', confirmLabel: 'Sign out', iconName: 'log-out' })) { logout(); toast('You have been signed out.', 'info'); navigate('#/login'); }
  };

  // global search
  const gi = qs('[data-gsearch]', root); const gr = qs('[data-gresults]', root);
  const doSearch = debounce(() => drawSearch(gi.value, gr), 120);
  gi.addEventListener('input', doSearch);
  gi.addEventListener('focus', () => { if (gi.value.trim()) drawSearch(gi.value, gr); });
  gi.addEventListener('keydown', (e) => {
    const items = [...gr.querySelectorAll('.gs-item')]; let i = items.findIndex((x) => x.classList.contains('active'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[i]?.classList.remove('active'); i = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1); items[i]?.classList.add('active'); items[i]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter') { const a = items[i >= 0 ? i : 0]; if (a) { location.hash = a.getAttribute('href'); gr.classList.add('hidden'); gi.blur(); } }
    if (e.key === 'Escape') { gr.classList.add('hidden'); gi.blur(); }
  });
  gr.addEventListener('click', (e) => { if (e.target.closest('.gs-item')) { gr.classList.add('hidden'); gi.value = ''; } });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('.modal-backdrop')) { e.preventDefault(); gi.focus(); } });

  updateBadges();
}

function drawSearch(q, host) {
  q = q.trim().toLowerCase();
  if (q.length < 2) { host.classList.add('hidden'); return; }
  const meds = can('inventory.view') ? store.all('medicines').filter((m) => [m.brandName, m.genericName, m.code, m.manufacturer].join(' ').toLowerCase().includes(q)).slice(0, 5) : [];
  const bats = can('batch.view') ? store.all('batches').filter((b) => b.batchNo.toLowerCase().includes(q)).slice(0, 5) : [];
  const bills = can('pharmacy.history') ? store.all('bills').filter((b) => [b.id, b.patientName, b.phone, b.uhid].join(' ').toLowerCase().includes(q)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5) : [];
  const grns = can('grn.view') ? store.all('grns').filter((g) => [g.id, g.invoiceNo, supplierName(g.supplierId)].join(' ').toLowerCase().includes(q)).slice(0, 5) : [];
  const sups = can('supplier.view') ? store.all('suppliers').filter((s) => [s.name, s.code, s.contactPerson, s.gstNumber].join(' ').toLowerCase().includes(q)).slice(0, 4) : [];
  const sec = (title, ic, rows) => rows.length ? `<div class="gs-sec"><div class="gs-h">${icon(ic)}${title}</div>${rows.join('')}</div>` : '';
  const html = sec('Medicines', 'pill', meds.map((m) => `<a class="gs-item" href="#/inventory/${m.id}"><strong>${esc(m.brandName)}</strong><span>${esc(m.genericName)} · ${esc(m.code)}</span></a>`))
    + sec('Batches', 'layers', bats.map((b) => `<a class="gs-item" href="#/batches/${b.id}"><strong>${esc(b.batchNo)}</strong><span>${esc(medName(b.medicineId))} · Exp ${fmtDate(b.expiryDate)}</span></a>`))
    + sec('GRNs', 'package-check', grns.map((g) => `<a class="gs-item" href="#/grn/${g.id}"><strong>${esc(g.id)}</strong><span>${esc(supplierName(g.supplierId))} · Inv ${esc(g.invoiceNo)}</span></a>`))
    + sec('Pharmacy Bills', 'receipt', bills.map((b) => `<a class="gs-item" href="#/pharmacy/bills/${b.id}"><strong>${esc(b.id)}</strong><span>${esc(b.patientName)} · ${fmtDate(b.at)}</span></a>`))
    + sec('Suppliers', 'truck', sups.map((s) => `<a class="gs-item" href="#/suppliers/${s.id}"><strong>${esc(s.name)}</strong><span>${esc(s.code)} · ${esc(s.contactPerson)}</span></a>`));
  host.innerHTML = html || `<div class="gs-empty">${icon('search-x')}No results for “${esc(q)}”</div>`;
  host.classList.remove('hidden');
  refreshIcons(host);
}

function drawNotifPop() {
  const pop = qs('[data-notif-pop]'); const u = currentUser();
  const list = visibleNotifications(u).slice(0, 8);
  pop.innerHTML = `<div class="np-head"><strong>Notifications</strong><button class="link small" data-allread>Mark all as read</button></div>
    <div class="np-list">${list.length ? list.map((n) => `<a class="np-item ${isRead(n, u) ? '' : 'unread'}" href="${notificationLink(n)}" data-nid="${n.id}">
      <span class="np-ic sev-${n.severity}">${icon({ success: 'check-circle-2', critical: 'alert-octagon', warning: 'alert-triangle', info: 'info' }[n.severity] || 'bell')}</span>
      <div><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><small>${relTime(n.createdAt)}${n.performedBy ? ' · by ' + esc(store.get('users', n.performedBy)?.name || '') : ''}</small></div></a>`).join('') : emptyState('bell-off', 'No notifications')}</div>
    <a class="np-foot" href="#/alerts?tab=notifications">View all notifications ${icon('arrow-right')}</a>`;
  refreshIcons(pop);
  qs('[data-allread]', pop).onclick = (e) => { e.stopPropagation(); markAllRead(u); drawNotifPop(); };
  pop.querySelectorAll('[data-nid]').forEach((a) => { a.onclick = () => { markRead(a.dataset.nid, u); pop.classList.add('hidden'); }; });
}

function updateBadges() {
  const u = currentUser(); if (!u) return;
  const c = unreadCount(u); const b = qs('[data-bell-count]');
  if (b) { b.textContent = c > 99 ? '99+' : c; b.classList.toggle('hidden', !c); }
  const a = qs('[data-badge="alerts"]');
  if (a) { const n = derivedAlerts().filter((x) => x.severity === 'critical').length; a.textContent = n; a.classList.toggle('hidden', !n); }
  const ap = qs('[data-badge="approvals"]');
  if (ap) { const n = approvalItems(u).length; ap.textContent = n; ap.classList.toggle('hidden', !n); }
}
function tickClock() {
  const el = qs('[data-clock]'); if (!el) return;
  const d = new Date();
  el.innerHTML = `${icon('calendar-clock')}<span><strong>${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</strong><small>${d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</small></span>`;
  refreshIcons(el);
}

export function setMeta({ title, crumbs }) {
  const t = qs('[data-title]'); const c = qs('[data-crumbs]');
  if (title && t) { t.textContent = title; document.title = `${title} · ${store.settings().hospitalName}`; }
  if (crumbs && c) c.innerHTML = crumbs.map((x, i) => (typeof x === 'string' ? `<span>${esc(x)}</span>` : `<a href="${x.href}">${esc(x.label)}</a>`) + (i < crumbs.length - 1 ? icon('chevron-right') : '')).join('');
  refreshIcons(c);
}

// ---------------- routing ----------------
async function route() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  destroyCharts();
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
  document.body.classList.remove('modal-open', 'sb-mobile-open');
  const r = resolve();
  if (r.status === 'login') {
    if (currentUser()) { navigate('#/home'); return; }
    if (r.redirect && location.hash !== '#/login') { history.replaceState(null, '', '#/login'); }
    renderLogin(r.redirect);
    return;
  }
  if (!qs('.shell')) renderShell();
  applyTheme();
  const view = qs('#view');
  app.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === r.route?.nav));
  app.querySelectorAll('.nav-group').forEach((g) => { if (g.querySelector('.nav-link.active')) g.classList.add('open'); });
  if (r.status === 'notfound' || r.status === 'forbidden') {
    setMeta({ title: r.status === 'notfound' ? 'Page not found' : 'Access restricted', crumbs: ['Error'] });
    view.innerHTML = r.status === 'notfound'
      ? emptyState('map-pin-off', 'Page not found', 'The page you are looking for does not exist.', '<a class="btn btn-primary" href="#/home">Go to Home</a>')
      : emptyState('shield-alert', 'You do not have access to this page', `Your role (<strong>${esc(roleLabel())}</strong>) is not permitted to open “${esc(r.route.title)}”.`, '<a class="btn btn-primary" href="#/home">Go to Home</a>');
    refreshIcons(view);
    return;
  }
  currentMeta = r;
  setMeta({ title: r.route.title, crumbs: r.route.crumbs });
  view.innerHTML = skeleton(8);
  try {
    const mod = await import(`./modules/${r.route.mod}.js`);
    if (currentMeta !== r) return; // navigated away while loading
    view.innerHTML = '';
    cleanup = (await mod[r.route.fn](view, r.params, r.query)) || null;
    refreshIcons(view);
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    view.innerHTML = emptyState('alert-octagon', 'Could not load this page', esc(err.message), '<a class="btn btn-secondary" href="#/dashboard">Back to Dashboard</a>');
    refreshIcons(view);
  }
}
export const rerender = () => route();

// ---------------- boot ----------------
async function boot() {
  app.innerHTML = `<div class="boot"><div class="spinner spinner-lg"></div><p>Loading Nallam HMS…</p></div>`;
  try {
    await initData();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="boot boot-error"><h2>Unable to load application data</h2><p>${esc(err.message)}</p>
      <p class="muted">Browsers block <code>fetch()</code> of local JSON files when <code>index.html</code> is opened directly from disk. Start a local web server in the project folder, for example:</p>
      <pre>python -m http.server 8080</pre><p class="muted">then open <code>http://localhost:8080</code>. See README.md for details.</p></div>`;
    return;
  }
  applyTheme();
  try { (await import('./pharmacy-services.js')).runDailyChecks(); } catch (e) { console.error(e); }
  store.subscribe(() => { updateBadges(); applyTheme(); });
  window.addEventListener('hashchange', route);
  window.addEventListener('hms:storage-error', () => toast('Browser storage is full. Remove some uploaded photos or contact the administrator.', 'error', 'Storage limit reached'));
  setInterval(updateBadges, 60000);
  route();
}
boot();
