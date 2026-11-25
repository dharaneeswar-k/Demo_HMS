// Patient Management screens: patient list, registration, profile with history, patient ID card.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { userName } from '../calculations.js';
import { registerPatient, updatePatient, findDuplicates, validatePatient, patientHistory, patientStats, patientAge, nextUhid } from '../patients.js';
import { badge, dataTable, emptyState, openModal, kpi, card, dl, exportTable } from '../components.js';
import { barcodeSVG } from '../barcode.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, fmtDate, fmtDateTime, relTime, refreshIcons, debounce, ymd } from '../utils.js';
import { setMeta } from '../app.js';
import { navigate } from '../router.js';

const BLOOD = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** Registration / edit form markup. */
function formHTML(p = {}) {
  const v = (k, d = '') => esc(p[k] ?? d);
  const ph = String(p.phone || '').replace(/\D/g, '').slice(-10);
  return `<form class="pt-form" novalidate>
    <div class="pt-section"><div class="pt-sec-h">${icon('user-round')}Personal details</div><div class="form-grid">
      <div class="field col-8" data-f="name"><label>Full name <span class="req">*</span></label><input class="input" name="name" value="${v('name')}" placeholder="As on ID proof" autocomplete="off"></div>
      <div class="field col-4" data-f="gender"><label>Gender <span class="req">*</span></label><div class="seg seg-full" data-gender>${['Male', 'Female', 'Other'].map((g) => `<button type="button" class="seg-btn ${p.gender === g[0] || p.gender === g ? 'active' : ''}" data-g="${g[0] === 'O' ? 'O' : g[0]}">${g}</button>`).join('')}</div><input type="hidden" name="gender" value="${v('gender')}"></div>
      <div class="field col-4" data-f="age"><label>Date of birth</label><input class="input" type="date" name="dob" max="${ymd()}" value="${v('dob')}"></div>
      <div class="field col-2"><label>or Age</label><input class="input" type="number" min="0" max="120" name="age" value="${p.dob ? '' : v('age')}" placeholder="Years"></div>
      <div class="field col-3"><label>Blood group</label><select class="input" name="bloodGroup">${BLOOD.map((b) => `<option value="${b}" ${p.bloodGroup === b ? 'selected' : ''}>${b || 'Not known'}</option>`).join('')}</select></div>
      <div class="field col-3"><label>Known allergies</label><input class="input" name="allergies" value="${v('allergies')}" placeholder="e.g. Penicillin"></div>
    </div></div>
    <div class="pt-section"><div class="pt-sec-h">${icon('phone')}Contact</div><div class="form-grid">
      <div class="field col-4" data-f="phone"><label>Mobile number <span class="req">*</span></label><div class="input-prefix"><span>+91</span><input class="input" name="phone" inputmode="numeric" maxlength="10" value="${ph}" placeholder="10-digit mobile"></div></div>
      <div class="field col-4" data-f="altPhone"><label>Alternate number</label><input class="input" name="altPhone" inputmode="numeric" maxlength="10" value="${String(p.altPhone || '').replace(/\D/g, '').slice(-10)}" placeholder="Optional"></div>
      <div class="field col-4"><label>Guardian / attender</label><input class="input" name="guardianName" value="${v('guardianName')}" placeholder="Optional"></div>
      <div class="field col-6" data-f="address"><label>Address <span class="req">*</span></label><input class="input" name="address" value="${v('address')}" placeholder="Door no., street, area"></div>
      <div class="field col-3"><label>City</label><input class="input" name="city" value="${v('city', 'Hosur')}"></div>
      <div class="field col-3" data-f="pincode"><label>Pincode</label><input class="input" name="pincode" inputmode="numeric" maxlength="6" value="${v('pincode', '635109')}"></div>
    </div></div>
    <div data-dups></div>
  </form>`;
}
function readForm(form) {
  const d = Object.fromEntries(new FormData(form));
  d.name = (d.name || '').trim();
  return d;
}
function wireForm(form, { excludeId, onUseExisting }) {
  form.querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => { form.querySelectorAll('[data-g]').forEach((x) => x.classList.toggle('active', x === b)); form.gender.value = b.dataset.g; form.querySelector('[data-f="gender"]').classList.remove('has-error'); }; });
  form.dob.addEventListener('change', () => { if (form.dob.value) form.age.value = ''; });
  form.age.addEventListener('input', () => { if (form.age.value) form.dob.value = ''; });
  const checkDups = debounce(() => {
    const d = readForm(form); const host = form.querySelector('[data-dups]');
    if (!d.name && !d.phone) { host.innerHTML = ''; return; }
    const dups = findDuplicates(d, excludeId).slice(0, 4);
    host.innerHTML = dups.length ? `<div class="alert ${dups.some((x) => x.strong) ? 'alert-danger' : 'alert-warning'}">${icon('users-round')}<div><strong>${dups.some((x) => x.strong) ? 'This patient may already be registered' : 'Patients with the same mobile number or name'}</strong>
      <div class="dup-list">${dups.map(({ patient: p }) => `<div class="dup"><div><strong>${esc(p.name)}</strong> <span class="mono small">${esc(p.uhid)}</span><div class="small">${patientAge(p) ?? '—'} y · ${p.gender} · ${esc(p.phone)}</div></div>${onUseExisting ? `<button type="button" class="btn btn-secondary btn-sm" data-use="${p.id}">Use this patient</button>` : `<a class="btn btn-ghost btn-sm" href="#/patients/${p.id}">Open</a>`}</div>`).join('')}</div>
      <div class="small mt-1">Family members often share one number — register as new only if this is a different person.</div></div></div>` : '';
    refreshIcons(host);
    host.querySelectorAll('[data-use]').forEach((b) => { b.onclick = () => onUseExisting(store.get('patients', b.dataset.use)); });
  }, 250);
  ['name', 'phone', 'age', 'dob'].forEach((n) => form[n].addEventListener('input', checkDups));
  form.phone.addEventListener('input', () => { form.phone.value = form.phone.value.replace(/\D/g, '').slice(0, 10); });
  form.altPhone.addEventListener('input', () => { form.altPhone.value = form.altPhone.value.replace(/\D/g, '').slice(0, 10); });
  if (excludeId) checkDups();
}
function showErrors(form, errs) {
  form.querySelectorAll('.field').forEach((f) => { f.classList.remove('has-error'); f.querySelector('.field-error')?.remove(); });
  Object.entries(errs).forEach(([k, m]) => { const f = form.querySelector(`[data-f="${k}"]`); if (!f) return; f.classList.add('has-error'); const e = document.createElement('div'); e.className = 'field-error'; e.textContent = m; f.appendChild(e); });
  form.querySelector('.has-error input, .has-error button')?.focus();
}

/** Modal registration (used from billing and the patient list). Calls onSaved(patient). */
export function openPatientForm({ patient = null, onSaved, prefill = {} } = {}) {
  const user = currentUser();
  const m = openModal({ title: patient ? `Edit patient — ${patient.uhid}` : 'Register new patient', subtitle: patient ? '' : `A Patient ID (${nextUhid()}) will be generated automatically.`, size: 'lg', body: formHTML({ ...prefill, ...(patient || {}) }),
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: patient ? 'Save changes' : 'Register patient', cls: 'btn-primary', icon: patient ? 'save' : 'user-plus', onClick: (close, w) => {
      const form = w.querySelector('form'); const d = readForm(form); const errs = validatePatient(d);
      if (Object.keys(errs).length) { showErrors(form, errs); return; }
      try { const p = patient ? updatePatient(patient.id, d, user) : registerPatient(d, user); toast(patient ? 'Patient details updated.' : `${p.name} registered — Patient ID ${p.uhid}.`, 'success', patient ? 'Saved' : 'Patient registered'); close(); onSaved?.(p); } catch (e) { toast(e.message, 'error'); }
    } }] });
  wireForm(m.el.querySelector('form'), { excludeId: patient?.id, onUseExisting: patient ? null : (p) => { m.close(); toast(`Using existing patient ${p.uhid}.`, 'info'); onSaved?.(p); } });
  return m;
}

// =====================================================================
export function renderList(view, params, query) {
  const all = () => [...store.all('patients')];
  const today = ymd();
  const regToday = all().filter((p) => ymd(p.registeredAt) === today).length;
  view.innerHTML = `
    <div class="page-head"><div><p class="muted">Every patient gets one Patient ID. All their bills and visits are kept under that ID.</p></div>
      <div class="page-actions"><button class="btn btn-secondary" data-export>${icon('download')}Export CSV</button>${can('patient.register') ? `<a class="btn btn-primary" href="#/patients/new">${icon('user-plus')}Register patient</a>` : ''}</div></div>
    <div class="kpis mb-2">
      ${kpi({ label: 'Registered patients', value: fmtNum(all().length), iconName: 'users-round', tone: 'navy' })}
      ${kpi({ label: 'Registered today', value: fmtNum(regToday), iconName: 'user-plus', tone: 'teal' })}
      ${kpi({ label: 'Visited this month', value: fmtNum(new Set(store.all('bills').filter((b) => b.patientId && b.at.slice(0, 7) === today.slice(0, 7)).map((b) => b.patientId)).size), iconName: 'calendar-check', tone: 'info' })}
      ${kpi({ label: 'With allergies noted', value: fmtNum(all().filter((p) => p.allergies).length), iconName: 'alert-triangle', tone: 'warning' })}
    </div>
    <section class="card"><div class="toolbar"><div class="search" style="max-width:420px">${icon('search')}<input class="input" type="search" placeholder="Search by name, Patient ID or mobile number…" data-q autofocus></div>
      <select class="input" data-gender><option value="">All genders</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></div><div data-table></div></section>`;
  const columns = [
    { key: 'uhid', label: 'Patient ID', render: (p) => `<a class="mono strong" href="#/patients/${p.id}">${esc(p.uhid)}</a>` },
    { key: 'name', label: 'Name', render: (p) => `<div class="cell-main">${esc(p.name)}</div>${p.allergies ? `<span class="tag tag-danger">Allergy: ${esc(p.allergies)}</span>` : ''}` },
    { key: 'age', label: 'Age / Gender', value: (p) => patientAge(p), render: (p) => `${patientAge(p) ?? '—'} y · ${esc(p.gender)}`, csv: (p) => `${patientAge(p)} ${p.gender}` },
    { key: 'phone', label: 'Mobile', render: (p) => `<span class="mono small">${esc(p.phone)}</span>` },
    { key: 'city', label: 'Area', render: (p) => `<span class="cell-sub">${esc(p.address)}, ${esc(p.city)}</span>`, csv: (p) => `${p.address}, ${p.city}` },
    { key: 'registeredAt', label: 'Registered', render: (p) => fmtDate(p.registeredAt), csv: (p) => fmtDate(p.registeredAt) },
    { key: 'last', label: 'Last visit', value: (p) => patientStats(p.id).lastVisit || '', render: (p) => { const l = patientStats(p.id).lastVisit; return l ? relTime(l) : '<span class="cell-sub">No visits yet</span>'; }, csv: (p) => patientStats(p.id).lastVisit || '' },
    { key: '', label: '', sortable: false, csv: false, align: 'right', render: (p) => `<div class="row-actions"><a class="btn btn-ghost btn-sm" href="#/patients/${p.id}">${icon('eye')}</a>${can('pharmacy.bill') ? `<a class="btn btn-secondary btn-sm" href="#/pharmacy/bill?patient=${p.id}">${icon('receipt')}Bill</a>` : ''}</div>` }
  ];
  const t = dataTable({ columns, pageSize: 25, sort: { key: 'registeredAt', dir: 'desc' }, onRowClick: (p) => navigate('#/patients/' + p.id),
    empty: emptyState('user-search', 'No patient found', 'Check the spelling or mobile number, or register a new patient.', can('patient.register') ? `<a class="btn btn-primary" href="#/patients/new">${icon('user-plus')}Register patient</a>` : '') });
  view.querySelector('[data-table]').appendChild(t.el);
  const apply = () => { const q = view.querySelector('[data-q]').value.trim().toLowerCase(); const qd = q.replace(/\D/g, ''); const g = view.querySelector('[data-gender]').value;
    t.setRows(all().filter((p) => (!q || p.name.toLowerCase().includes(q) || p.uhid.toLowerCase().includes(q) || (qd.length >= 4 && p.phone.replace(/\D/g, '').includes(qd))) && (!g || p.gender === g))); };
  view.querySelector('[data-q]').addEventListener('input', debounce(apply, 120));
  view.querySelector('[data-gender]').onchange = apply;
  view.querySelector('[data-export]').onclick = () => { exportTable(`patients-${ymd()}.csv`, columns, t.getRows()); toast('Patient list exported.'); };
  if (query.q) { view.querySelector('[data-q]').value = query.q; }
  apply();
}

export function renderNew(view) {
  const user = currentUser();
  view.innerHTML = `<div class="pt-new"><section class="card"><header class="card-head"><div><h2>Register new patient</h2><p class="muted small">Patient ID <strong class="mono">${nextUhid()}</strong> will be generated when you save.</p></div></header>
    <div class="card-body">${formHTML({ city: 'Hosur' })}</div>
    <div class="pt-foot"><a class="btn btn-ghost" href="#/patients">Cancel</a><button class="btn btn-secondary" data-save-bill>${icon('receipt')}Register & create bill</button><button class="btn btn-primary" data-save>${icon('user-plus')}Register patient</button></div></section>
    <aside class="pt-aside card"><div class="card-body"><h3 class="section-title">How it works</h3><ol class="pt-steps"><li><strong>Enter details</strong><span>Name, gender, age and mobile are required.</span></li><li><strong>Check duplicates</strong><span>The system warns if the mobile or name already exists.</span></li><li><strong>Patient ID generated</strong><span>One ID for every bill and visit.</span></li><li><strong>Print patient card</strong><span>Barcode card for quick lookup next visit.</span></li></ol></div></aside></div>`;
  const form = view.querySelector('form');
  wireForm(form, { onUseExisting: (p) => navigate('#/patients/' + p.id) });
  const save = (thenBill) => {
    const d = readForm(form); const errs = validatePatient(d);
    if (Object.keys(errs).length) { showErrors(form, errs); return; }
    try { const p = registerPatient(d, user); toast(`${p.name} registered — Patient ID ${p.uhid}.`, 'success', 'Patient registered'); navigate(thenBill && can('pharmacy.bill') ? `#/pharmacy/bill?patient=${p.id}` : `#/patients/${p.id}?new=1`); } catch (e) { toast(e.message, 'error'); }
  };
  view.querySelector('[data-save]').onclick = () => save(false);
  const sb = view.querySelector('[data-save-bill]'); if (can('pharmacy.bill')) sb.onclick = () => save(true); else sb.remove();
  setTimeout(() => form.name.focus(), 50);
}

export function renderProfile(view, params, query) {
  const p = store.get('patients', params.id);
  if (!p) { view.innerHTML = emptyState('user-x', 'Patient not found', '', '<a class="btn btn-primary" href="#/patients">All patients</a>'); return; }
  setMeta({ title: p.name, crumbs: [{ label: 'Patients', href: '#/patients' }, p.uhid] });
  const s = patientStats(p.id); const hist = patientHistory(p.id);
  const age = patientAge(p);
  view.innerHTML = `
    ${query.new ? `<div class="alert alert-success mb-2">${icon('check-circle-2')}<div><strong>Patient registered.</strong> Patient ID <span class="mono">${esc(p.uhid)}</span> is ready. Print the patient card for the next visit.</div></div>` : ''}
    <section class="pt-hero card"><div class="pt-avatar">${esc(p.name.split(' ').map((x) => x[0]).slice(0, 2).join(''))}</div>
      <div class="grow"><div class="row"><h1>${esc(p.name)}</h1>${p.allergies ? `<span class="tag tag-danger">${icon('alert-triangle', 'ic-inline')} Allergy: ${esc(p.allergies)}</span>` : ''}</div>
        <div class="pt-meta"><span class="mono strong">${esc(p.uhid)}</span><span>${age ?? '—'} years · ${p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : 'Other'}</span><span>${icon('phone', 'ic-inline')}${esc(p.phone)}</span>${p.bloodGroup ? `<span>${icon('droplet', 'ic-inline')}${esc(p.bloodGroup)}</span>` : ''}</div></div>
      <div class="page-actions">${can('patient.edit') || can('patient.register') ? `<button class="btn btn-secondary" data-edit>${icon('pencil')}Edit</button>` : ''}<button class="btn btn-secondary" data-card>${icon('id-card')}Patient card</button>${can('hbill.create') ? `<a class="btn btn-primary" href="#/hbill?patient=${p.id}">${icon('receipt')}Hospital bill</a>` : ''}${can('service.request') ? `<button class="btn btn-secondary" data-req>${icon('clipboard-plus')}Doctor request</button>` : ''}${can('pharmacy.bill') ? `<a class="btn btn-primary" href="#/pharmacy/bill?patient=${p.id}">${icon('receipt')}New bill</a>` : ''}</div></section>
    <div class="kpis mt-2">
      ${kpi({ label: 'Bills (all counters)', value: fmtNum(s.bills), iconName: 'receipt', tone: 'navy' })}
      ${kpi({ label: 'Total billed', value: fmtINR(s.spent, true), iconName: 'indian-rupee', tone: 'teal' })}
      ${kpi({ label: 'Balance due', value: fmtINR(s.due, true), iconName: 'hourglass', tone: s.due ? 'warning' : 'success' })}
      ${kpi({ label: 'Last visit', value: s.lastVisit ? fmtDate(s.lastVisit) : '—', iconName: 'calendar', tone: 'info', sub: s.lastVisit ? relTime(s.lastVisit) : 'No visits yet' })}
    </div>
    <div class="grid grid-1-2">
      ${card('Patient details', dl([['Patient ID', `<span class="mono">${esc(p.uhid)}</span>`], ['Date of birth', p.dob ? fmtDate(p.dob) : '—'], ['Age', age != null ? age + ' years' : '—'], ['Gender', p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : 'Other'],
        ['Mobile', esc(p.phone)], ['Alternate number', esc(p.altPhone || '—')], ['Address', `${esc(p.address)}, ${esc(p.city)} ${esc(p.pincode || '')}`], ['Guardian / attender', esc(p.guardianName || '—')],
        ['Blood group', esc(p.bloodGroup || 'Not known')], ['Allergies', p.allergies ? `<span class="text-danger strong">${esc(p.allergies)}</span>` : 'None noted'], ['Registered', `${fmtDateTime(p.registeredAt)}<div class="cell-sub">by ${esc(userName(p.registeredBy))}</div>`]]))}
      ${card('Visit history', hist.length ? `<ul class="timeline">${hist.map((h) => `<li><span class="tl-dot ${({ BILL: 'info', HBILL: 'info', RETURN: 'warning', LAB: 'purple', SERVICE: 'success', PACKAGE: 'purple', ADMISSION: 'warning' })[h.kind] || 'success'}">${icon(({ BILL: 'pill', HBILL: 'receipt', RETURN: 'undo-2', LAB: 'flask-conical', SERVICE: 'syringe', PACKAGE: 'package', ADMISSION: 'bed-double' })[h.kind] || 'user-plus')}</span>
        <div class="row-between"><strong>${h.ref ? `<a href="${({ BILL: '#/pharmacy/bills/', HBILL: '#/hbills/', RETURN: '#/pharmacy/returns?focus=', LAB: '#/lab/report/', SERVICE: '#/services?tab=done&x=', PACKAGE: '#/packages/enrolments/', ADMISSION: '#/mrd/' })[h.kind] + h.ref}">${esc(h.title)}</a>` : esc(h.title)}</strong>${h.amount != null ? `<span class="strong ${h.amount < 0 ? 'text-danger' : ''}">${fmtINR(h.amount)}</span>` : ''}</div>
        <p>${esc(h.detail)}${h.status ? ' · ' + badge(h.status) : ''}</p><p class="tiny">${fmtDateTime(h.at)}${h.by ? ' · ' + esc(userName(h.by)) : ''}</p></li>`).join('')}</ul>` : emptyState('history', 'No history yet'), { sub: 'All visits and bills under this Patient ID' })}
    </div>`;
  view.querySelector('[data-edit]')?.addEventListener('click', () => openPatientForm({ patient: p, onSaved: () => renderProfile(view, params, {}) }));
  view.querySelector('[data-card]').onclick = () => printCard(p);
  view.querySelector('[data-req]')?.addEventListener('click', async () => { (await import('./service-counter.js')).openRequest(() => renderProfile(view, params, {}), p.id); });
}

function printCard(p) {
  const s = store.settings();
  openModal({ title: 'Patient card', size: 'md', body: `<div class="pt-card-wrap"><div class="pt-card"><div class="pt-card-top"><strong>${esc(s.hospitalName)}</strong><span>${esc(s.city || '')}</span></div>
    <div class="pt-card-name">${esc(p.name)}</div><div class="pt-card-meta">${patientAge(p) ?? '—'} y · ${p.gender} · ${esc(p.phone)}${p.bloodGroup ? ' · ' + esc(p.bloodGroup) : ''}</div>
    <div class="pt-card-bar">${barcodeSVG(p.uhid, { height: 34 })}</div><div class="pt-card-id">${esc(p.uhid)}</div><div class="pt-card-foot">Please bring this card on every visit</div></div></div>`,
    footer: [{ label: 'Print', cls: 'btn-primary', icon: 'printer', onClick: () => { document.body.classList.add('printing-card'); setTimeout(() => { window.print(); document.body.classList.remove('printing-card'); }, 200); } }, { label: 'Close', onClick: (c) => c() }] });
}
