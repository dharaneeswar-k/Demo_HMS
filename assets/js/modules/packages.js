// Package Management (BRD 10): fixed-price packages with included services and limits, patient enrolments,
// usage tracking (included services billed at ₹0, never twice), extras billed separately and final settlement.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { userName } from '../calculations.js';
import { svc, pkg, packageUsage, packageExtras, settlePackage, catLabel, catIcon, patientOf, hbillBalance } from '../hospital.js';
import { audit } from '../services.js';
import { badge, dataTable, emptyState, openModal, kpi, tabs, confirmDialog } from '../components.js';
import { toast } from '../notifications.js';
import { letterhead, docMeta, signBlock } from '../docs.js';
import { setMeta } from '../app.js';
import { esc, icon, fmtINR, fmtNum, fmtDate, fmtDateTime, refreshIcons } from '../utils.js';

const ST = { ACTIVE: ['ACTIVE', 'Active'], COMPLETED: ['COMPLETED', 'Settled'], CANCELLED: ['CANCELLED', 'Cancelled'] };
const listValue = (p) => p.includes.reduce((t, i) => t + (svc(i.serviceId)?.price || 0) * i.qty, 0);

export function render(view, params, query) {
  let tab = query.tab || 'enrol';
  const en = () => store.all('patientPackages').slice().sort((a, b) => b.startAt.localeCompare(a.startAt));
  view.innerHTML = `<p class="page-intro">A package is sold once at a fixed price. Services inside it are billed at ₹0 until their limit is used up; anything outside is billed normally. At the end the package is settled: package price + extras.</p>
    <div class="kpis mb-2">${kpi({ label: 'Active enrolments', value: fmtNum(en().filter((x) => x.status === 'ACTIVE').length), iconName: 'package-open', tone: 'teal' })}
      ${kpi({ label: 'Packages offered', value: fmtNum(store.all('packages').filter((p) => p.active).length), iconName: 'package', tone: 'navy' })}
      ${kpi({ label: 'Package revenue (30 days)', value: fmtINR(en().filter((x) => x.status !== 'CANCELLED' && Date.now() - new Date(x.startAt) < 30 * 86400000).reduce((t, x) => t + pkg(x.packageId).price, 0), true), iconName: 'indian-rupee', tone: 'info' })}
      ${kpi({ label: 'Extras billed outside packages', value: fmtINR(en().reduce((t, x) => t + packageExtras(x).reduce((s, e) => s + e.gross, 0), 0), true), iconName: 'plus-circle', tone: 'warning' })}</div>
    <section class="card"><div class="row-between card-pad"><div data-tabs></div>${can('package.manage') ? `<button class="btn btn-primary btn-sm" data-new>${icon('plus')}New package</button>` : ''}</div><div data-b></div></section>`;
  const draw = () => {
    tabs(view.querySelector('[data-tabs]'), [{ id: 'enrol', label: 'Patient enrolments', icon: 'users-round', count: en().filter((x) => x.status === 'ACTIVE').length }, { id: 'cat', label: 'Package catalogue', icon: 'package' }], tab, (t) => { tab = t; draw(); });
    const b = view.querySelector('[data-b]');
    if (tab === 'enrol') {
      b.innerHTML = '<div data-t></div>';
      const t = dataTable({ rows: en(), pageSize: 15, onRowClick: (x) => { location.hash = `#/packages/enrolments/${x.id}`; }, columns: [
        { key: 'id', label: 'Enrolment', render: (x) => `<span class="mono strong">${x.id}</span><div class="cell-sub">${fmtDate(x.startAt)}</div>` },
        { key: 'patient', label: 'Patient', value: (x) => patientOf(x.patientId)?.name, render: (x) => `${esc(patientOf(x.patientId)?.name)}<div class="cell-sub mono">${esc(patientOf(x.patientId)?.uhid)}</div>` },
        { key: 'pkg', label: 'Package', value: (x) => pkg(x.packageId).name, render: (x) => `${esc(pkg(x.packageId).name)}<div class="cell-sub">${fmtINR(pkg(x.packageId).price, true)}</div>` },
        { key: 'use', label: 'Used', sortable: false, render: (x) => { const u = packageUsage(x); const used = u.reduce((t, y) => t + Math.min(y.used, y.included), 0); const tot = u.reduce((t, y) => t + y.included, 0); return `<div class="bar" style="width:120px"><span style="width:${tot ? used / tot * 100 : 0}%"></span></div><div class="cell-sub">${used} of ${tot}</div>`; } },
        { key: 'extras', label: 'Extras', align: 'right', value: (x) => packageExtras(x).reduce((t, e) => t + e.gross, 0), render: (x) => fmtINR(packageExtras(x).reduce((t, e) => t + e.gross, 0), true) },
        { key: 'validUntil', label: 'Valid till', render: (x) => fmtDate(x.validUntil) },
        { key: 'status', label: 'Status', render: (x) => badge(...ST[x.status]) }] });
      b.querySelector('[data-t]').appendChild(t.el);
    } else {
      b.innerHTML = `<div class="pkg-cards">${store.all('packages').map((p) => { const lv = listValue(p); return `<article class="pkg-card ${p.active ? '' : 'off'}"><header><span class="svc-ic cat-package">${icon('package')}</span><div><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p></div></header>
        <div class="pkg-price"><strong>${fmtINR(p.price, true)}</strong>${lv > p.price ? `<s>${fmtINR(lv, true)}</s><span class="tag tag-success">Saves ${Math.round((1 - p.price / lv) * 100)}%</span>` : ''}<span class="muted small">Valid ${p.validityDays} day(s)</span></div>
        <ul class="pkg-incl">${p.includes.map((i) => `<li>${icon(catIcon(svc(i.serviceId)?.category), 'ic-inline')} ${esc(svc(i.serviceId)?.name)} <b>× ${i.qty}</b></li>`).join('')}${p.medicineAllowance ? `<li>${icon('pill', 'ic-inline')} Medicines up to ${fmtINR(p.medicineAllowance, true)} <span class="muted">(posted from the IP ward indent)</span></li>` : ''}</ul>
        <p class="small muted"><strong>Not included:</strong> ${esc(p.exclusions)}</p>
        ${can('package.manage') ? `<footer><button class="btn btn-secondary btn-sm" data-edit="${p.id}">${icon('pencil')}Edit</button></footer>` : ''}</article>`; }).join('')}</div>`;
      b.querySelectorAll('[data-edit]').forEach((x) => { x.onclick = () => editPackage(pkg(x.dataset.edit), draw); });
    }
    refreshIcons(view);
  };
  view.querySelector('[data-new]')?.addEventListener('click', () => editPackage(null, () => { tab = 'cat'; draw(); }));
  draw();
}

function editPackage(p, done) {
  const user = currentUser();
  const sv = store.all('services').filter((s) => s.active);
  const inc = Object.fromEntries((p?.includes || []).map((i) => [i.serviceId, i.qty]));
  openModal({ title: p ? `Edit ${p.name}` : 'New package', size: 'lg',
    body: `<div class="form-grid"><div class="field col-6"><label>Name</label><input class="input" data-name value="${esc(p?.name || '')}"></div><div class="field col-3"><label>Price (₹)</label><input class="input" type="number" data-price value="${p?.price || ''}"></div><div class="field col-3"><label>Valid (days)</label><input class="input" type="number" data-days value="${p?.validityDays || 1}"></div>
      <div class="field col-12"><label>Description</label><input class="input" data-desc value="${esc(p?.description || '')}"></div>
      <div class="field col-6"><label>Medicine allowance (₹, optional)</label><input class="input" type="number" data-med value="${p?.medicineAllowance || 0}"></div><div class="field col-6"><label>Not included</label><input class="input" data-exc value="${esc(p?.exclusions || '')}"></div>
      <div class="col-12"><div class="section-title">Included services (quantity)</div><div class="inc-grid">${sv.map((s) => `<label><span>${icon(catIcon(s.category), 'ic-inline')} ${esc(s.name)} <small class="muted">${fmtINR(s.price, true)}</small></span><input class="input input-sm" type="number" min="0" data-inc="${s.id}" value="${inc[s.id] || ''}" placeholder="0"></label>`).join('')}</div></div>
      <label class="check col-12"><input type="checkbox" data-active ${p?.active !== false ? 'checked' : ''}> Offered at the billing counter</label></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save package', cls: 'btn-primary', onClick: (c, w) => {
      const v = (s) => w.querySelector(s).value;
      const includes = [...w.querySelectorAll('[data-inc]')].filter((i) => Number(i.value) > 0).map((i) => ({ serviceId: i.dataset.inc, qty: Math.floor(Number(i.value)) }));
      if (!v('[data-name]').trim() || !(Number(v('[data-price]')) > 0) || !includes.length) return toast('Enter a name, a price and at least one included service.', 'error');
      store.transaction(() => {
        const data = { name: v('[data-name]').trim(), price: Number(v('[data-price]')), validityDays: Math.max(1, Number(v('[data-days]')) || 1), description: v('[data-desc]'), medicineAllowance: Number(v('[data-med]')) || 0, exclusions: v('[data-exc]'), includes, active: w.querySelector('[data-active]').checked };
        if (p) { store.update('packages', p.id, data); audit(user, 'PACKAGE_UPDATED', 'PACKAGE', p.id, `${data.name} ₹${data.price}`); }
        else { const id = store.nextId('packages', 'PKG-'); store.insert('packages', { id, code: data.name.replace(/[^A-Z]/gi, '').slice(0, 6).toUpperCase(), ...data }); audit(user, 'PACKAGE_CREATED', 'PACKAGE', id, `${data.name} ₹${data.price}`); }
      });
      c(); toast('Package saved.'); done();
    } }] });
}

export function renderEnrolment(view, params) {
  const user = currentUser();
  const pp = store.get('patientPackages', params.id);
  if (!pp) { view.innerHTML = emptyState('package-x', 'Enrolment not found'); return; }
  const p = pkg(pp.packageId); const pt = patientOf(pp.patientId);
  setMeta({ title: `${p.name} — ${pt.name}`, crumbs: [{ label: 'Packages', href: '#/packages' }, pp.id] });
  const use = pp.settlement?.usage || packageUsage(pp); const extras = packageExtras(pp); const extraTotal = extras.reduce((t, e) => t + e.gross, 0);
  const unpaid = [...new Set(extras.map((e) => e.billId))].map((id) => store.get('hbills', id)).filter((b) => b && hbillBalance(b) > 0);
  view.innerHTML = `<div class="row mb-2 no-print">${pp.status === 'ACTIVE' && (can('package.manage') || can('hbill.create')) ? `<button class="btn btn-primary" data-settle>${icon('badge-check')}Final settlement</button>` : ''}<button class="btn btn-secondary" data-print>${icon('printer')}Print statement</button>${pp.status === 'ACTIVE' && can('hbill.create') ? `<a class="btn btn-ghost" href="#/hbill?patient=${pt.id}">${icon('plus')}Bill a service</a>` : ''}</div>
    <article class="doc">${letterhead('PACKAGE STATEMENT', { sub: p.name, code: pp.id })}
      ${docMeta([['Patient', esc(pt.name)], ['Patient ID', `<span class="mono">${esc(pt.uhid)}</span>`], ['Package', esc(p.name)], ['Package price', fmtINR(p.price)], ['Started', fmtDateTime(pp.startAt)], ['Valid till', fmtDate(pp.validUntil)], ['Sold on bill', `<a class="mono" href="#/hbills/${pp.billId}">${pp.billId}</a>`], ['Status', ST[pp.status][1]]])}
      <h3 class="doc-h">Included services</h3>
      <table class="rc-table"><thead><tr><th>Service</th><th class="r">Included</th><th class="r">Used</th><th class="r">Remaining</th><th>Usage</th></tr></thead><tbody>
        ${use.map((u) => `<tr><td>${esc(u.name)}</td><td class="r">${u.included}</td><td class="r">${u.used}</td><td class="r">${u.remaining}</td><td><div class="bar" style="width:120px"><span style="width:${Math.min(100, u.used / u.included * 100)}%"></span></div></td></tr>`).join('')}
        ${p.medicineAllowance ? `<tr><td>Medicines (allowance)</td><td class="r">${fmtINR(p.medicineAllowance, true)}</td><td class="r" colspan="3"><span class="muted small">Posted from the IP ward indent when the IP module goes live</span></td></tr>` : ''}</tbody></table>
      <h3 class="doc-h">Extras outside the package</h3>
      ${extras.length ? `<table class="rc-table"><thead><tr><th>Date</th><th>Bill</th><th>Service</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead><tbody>${extras.map((e) => `<tr><td>${fmtDate(e.at)}</td><td class="mono">${e.billId}</td><td>${esc(e.name)}</td><td class="r">${e.qty}</td><td class="r">${fmtINR(e.gross)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No extra services billed.</p>'}
      <div class="settle-box"><div class="kv"><span>Package price</span><strong>${fmtINR(p.price)}</strong></div><div class="kv"><span>Extras</span><strong>${fmtINR(extraTotal)}</strong></div><div class="kv grand"><span>Total for this episode</span><strong>${fmtINR(p.price + extraTotal)}</strong></div>${unpaid.length ? `<div class="kv text-danger"><span>Balance still due on ${unpaid.map((b) => b.id).join(', ')}</span><strong>${fmtINR(unpaid.reduce((t, b) => t + hbillBalance(b), 0))}</strong></div>` : ''}</div>
      <p class="small muted">Not included in this package: ${esc(p.exclusions)}</p>
      ${pp.status === 'COMPLETED' ? signBlock([['Settled by', userName(pp.settledBy)], ['Patient / attender', '']]) : ''}</article>`;
  view.querySelector('[data-print]').onclick = () => window.print();
  view.querySelector('[data-settle]')?.addEventListener('click', async () => {
    const left = use.reduce((t, u) => t + u.remaining, 0);
    if (!(await confirmDialog({ title: 'Final settlement', iconName: 'badge-check', confirmLabel: 'Settle package', message: `Package ${fmtINR(p.price)} + extras ${fmtINR(extraTotal)} = <strong>${fmtINR(p.price + extraTotal)}</strong>.${left ? `<br><span class="text-warning">${left} included service(s) were not used and lapse on settlement.</span>` : ''}` }))) return;
    try { settlePackage(pp.id, user); toast('Package settled.'); renderEnrolment(view, params); } catch (e) { toast(e.message, 'error'); }
  });
  refreshIcons(view);
}
