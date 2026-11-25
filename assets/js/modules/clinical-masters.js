// Doctors, Beds & Tariff (Super Admin): doctors and fees, service tariff, wards & beds, bed categories, OP / IP / cashier rules, TPAs.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { audit } from '../services.js';
import { deptName, cs, bedCategories, categoryLabel } from '../clinical.js';
import { bedStatus } from '../ip.js';
import { tabs, openModal, card } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, refreshIcons } from '../utils.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CATS = [['INVESTIGATION', 'Investigation', 'INVESTIGATION'], ['PROCEDURE', 'Procedure', 'PROCEDURE'], ['OT', 'OT & surgery', 'PROCEDURE'], ['NURSING_SERVICE', 'Nursing service', 'SERVICE'], ['OTHER', 'Other', 'SERVICE']];
const save = (fn, msg, action, id, detail) => { const u = currentUser(); if (!can('clinical.masters', u)) throw new Error('Only the Super Admin can change masters.'); store.transaction(() => { fn(); audit(u, action, 'MASTER', id, detail); }); toast(msg, 'success'); };

export function render(view, params, query) {
  let tab = query.tab || 'doctors';
  const draw = () => {
    view.innerHTML = `<div class="page-head"><div><p class="muted">Masters used by OP and IP: who consults and for how much, what each service costs, the beds, and the rules for follow-ups, deposits and cash counters. Every change is recorded in the audit log.</p></div></div>
      <section class="card flush"><div data-tabs></div><div class="card-body" data-body></div></section>`;
    tabs(view.querySelector('[data-tabs]'), [{ id: 'doctors', label: 'Doctors', icon: 'stethoscope' }, { id: 'tariff', label: 'Service tariff', icon: 'list' }, { id: 'beds', label: 'Wards & beds', icon: 'bed-double' }, { id: 'rules', label: 'Rules & payers', icon: 'sliders-horizontal' }], tab, (x) => { tab = x; body(); });
    const body = () => { const h = view.querySelector('[data-body]'); ({ doctors, tariff, beds, rules })[tab](h); refreshIcons(h); };
    body();
  };

  const doctors = (h) => {
    h.innerHTML = `<div class="row-between mb-2"><span class="muted small">Fees apply from the next visit. The free follow-up window counts from the last paid visit to the same doctor.</span><button class="btn btn-primary btn-sm" data-add>${icon('plus')}Add doctor</button></div>
      <div class="table-scroll"><table class="table"><thead><tr><th>Doctor</th><th>Department</th><th>Room & hours</th><th class="ta-right">New</th><th class="ta-right">Revisit</th><th class="ta-right">Free follow-up</th><th class="ta-right">IP visit</th><th>Login</th><th>Status</th><th></th></tr></thead><tbody>
      ${store.all('doctors').map((d) => `<tr><td><div class="cell-main">${esc(d.name)}</div><div class="cell-sub">${esc(d.qualification)} · ${esc(d.registrationNo)}</div></td><td>${esc(deptName(d.departmentId))}</td><td>${esc(d.room)} · ${esc(d.start)}–${esc(d.end)}<div class="cell-sub">${d.days.map((x) => DAYS[x]).join(', ')}</div></td>
        <td class="ta-right">${fmtINR(d.fees.new, true)}</td><td class="ta-right">${fmtINR(d.fees.revisit, true)}</td><td class="ta-right">${d.followUpDays} days</td><td class="ta-right">${fmtINR(d.ipVisitFee, true)}</td>
        <td class="small">${d.userId ? esc(store.get('users', d.userId)?.username || '') : '<span class="muted">—</span>'}</td><td>${d.active ? '<span class="badge badge-success"><span class="dot"></span>Active</span>' : '<span class="badge badge-muted"><span class="dot"></span>Inactive</span>'}</td><td><button class="btn btn-ghost btn-sm" data-edit="${d.id}">${icon('pencil')}</button></td></tr>`).join('')}</tbody></table></div>`;
    const edit = (d) => {
      const isNew = !d; d = d || { name: 'Dr. ', departmentId: 'DEP-01', qualification: '', registrationNo: '', room: '', fees: { new: 400, revisit: 250 }, followUpDays: cs().op.defaultFollowUpDays, ipVisitFee: 500, days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '13:00', userId: null, active: true };
      const docUsers = store.all('users').filter((x) => x.role === 'DOCTOR');
      const m = openModal({ title: isNew ? 'Add doctor' : `Edit ${d.name}`, size: 'lg', body: `<form class="form-grid">
        <div class="field col-6"><label>Name</label><input class="input" name="name" value="${esc(d.name)}"></div><div class="field col-6"><label>Department</label><select class="input" name="departmentId">${store.all('departments').map((x) => `<option value="${x.id}" ${x.id === d.departmentId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div class="field col-6"><label>Qualification</label><input class="input" name="qualification" value="${esc(d.qualification)}"></div><div class="field col-3"><label>Registration no.</label><input class="input" name="registrationNo" value="${esc(d.registrationNo)}"></div><div class="field col-3"><label>OP room</label><input class="input" name="room" value="${esc(d.room)}"></div>
        <div class="field col-3"><label>New visit fee</label><input class="input" type="number" min="0" name="new" value="${d.fees.new}"></div><div class="field col-3"><label>Revisit fee</label><input class="input" type="number" min="0" name="revisit" value="${d.fees.revisit}"></div>
        <div class="field col-3"><label>Free follow-up (days)</label><input class="input" type="number" min="0" name="followUpDays" value="${d.followUpDays}"></div><div class="field col-3"><label>IP visit fee</label><input class="input" type="number" min="0" name="ipVisitFee" value="${d.ipVisitFee}"></div>
        <div class="field col-6"><label>OP days</label><div class="row">${DAYS.map((x, i) => `<label class="check"><input type="checkbox" name="day${i}" ${d.days.includes(i) ? 'checked' : ''}> ${x}</label>`).join('')}</div></div>
        <div class="field col-3"><label>From</label><input class="input" type="time" name="start" value="${d.start}"></div><div class="field col-3"><label>To</label><input class="input" type="time" name="end" value="${d.end}"></div>
        <div class="field col-6"><label>Linked login (Doctor role)</label><select class="input" name="userId"><option value="">None</option>${docUsers.map((x) => `<option value="${x.id}" ${x.id === d.userId ? 'selected' : ''}>${esc(x.name)} (${esc(x.username)})</option>`).join('')}</select></div>
        <div class="field col-6"><label>Status</label><label class="check mt-1"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Active — appears for new visits</label></div></form>`,
        footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', cls: 'btn-primary', icon: 'save', onClick: (c) => {
          const f = m.el.querySelector('form'); const v = (k) => f[k].value;
          try {
            if (!v('name').replace(/^Dr\.?\s*/, '').trim()) throw new Error('Enter the doctor’s name.');
            if ([v('new'), v('revisit'), v('ipVisitFee'), v('followUpDays')].some((x) => x === '' || Number(x) < 0)) throw new Error('Fees and days must be zero or more.');
            const days = DAYS.map((_, i) => i).filter((i) => f['day' + i].checked);
            const patch = { name: v('name').trim(), departmentId: v('departmentId'), qualification: v('qualification').trim(), registrationNo: v('registrationNo').trim(), room: v('room').trim(), fees: { new: Number(v('new')), revisit: Number(v('revisit')) },
              followUpDays: Number(v('followUpDays')), ipVisitFee: Number(v('ipVisitFee')), days, start: v('start'), end: v('end'), userId: v('userId') || null, active: f.active.checked };
            save(() => { if (isNew) store.insert('doctors', { id: store.nextId('doctors', 'DOC-', 2), phone: '', ...patch }); else Object.assign(store.get('doctors', d.id), patch); }, 'Doctor saved.', isNew ? 'DOCTOR_ADDED' : 'DOCTOR_UPDATED', d.id || 'new', `${patch.name} new ₹${patch.fees.new} revisit ₹${patch.fees.revisit}`);
            c(); draw();
          } catch (e) { toast(e.message, 'error'); }
        } }] });
    };
    h.querySelector('[data-add]').onclick = () => edit(null);
    h.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => edit(store.get('doctors', b.dataset.edit)); });
  };

  const tariff = (h) => {
    h.innerHTML = `<div class="row-between mb-2"><span class="muted small">Rates apply to new charges only — bills already made keep their rates. Non-payable items are not covered by insurance and are charged to the patient.</span><button class="btn btn-primary btn-sm" data-add>${icon('plus')}Add service</button></div>
      <div class="table-scroll"><table class="table dense"><thead><tr><th>Code</th><th>Service</th><th>Category</th><th>Used in</th><th class="ta-right">Rate</th><th>Insurance</th><th>Status</th><th></th></tr></thead><tbody>
      ${store.all('services').map((s) => `<tr class="${s.active ? '' : 'reversed'}"><td class="mono">${esc(s.code)}</td><td>${esc(s.name)}</td><td>${esc(CATS.find((c) => c[0] === s.category)?.[1] || s.category)}</td><td>${s.applicableIn.join(' · ')}</td><td class="ta-right">${fmtINR(s.rate)}${s.unit !== 'each' ? `<span class="cell-sub"> /${esc(s.unit)}</span>` : ''}</td>
        <td>${s.nonPayable ? '<span class="tag tag-warning">Non-payable</span>' : '<span class="tag tag-success">Payable</span>'}</td><td>${s.active ? 'Active' : 'Inactive'}</td><td><button class="btn btn-ghost btn-sm" data-edit="${s.id}">${icon('pencil')}</button></td></tr>`).join('')}</tbody></table></div>`;
    const edit = (s) => {
      const isNew = !s; s = s || { code: '', name: '', category: 'INVESTIGATION', rate: 0, unit: 'each', applicableIn: ['OP', 'IP'], nonPayable: false, active: true };
      const m = openModal({ title: isNew ? 'Add service' : `Edit ${s.name}`, body: `<form class="form-grid"><div class="field col-4"><label>Code</label><input class="input" name="code" value="${esc(s.code)}" ${isNew ? '' : 'readonly'}></div><div class="field col-8"><label>Name</label><input class="input" name="name" value="${esc(s.name)}"></div>
        <div class="field col-6"><label>Category</label><select class="input" name="category">${CATS.map(([k, l]) => `<option value="${k}" ${k === s.category ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="field col-3"><label>Rate (₹)</label><input class="input" type="number" min="0" name="rate" value="${s.rate}"></div><div class="field col-3"><label>Unit</label><select class="input" name="unit">${['each', 'hour', 'day'].map((x) => `<option ${x === s.unit ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="field col-12"><label>Settings</label><div class="row"><label class="check"><input type="checkbox" name="op" ${s.applicableIn.includes('OP') ? 'checked' : ''}> OP</label><label class="check"><input type="checkbox" name="ip" ${s.applicableIn.includes('IP') ? 'checked' : ''}> IP</label><label class="check"><input type="checkbox" name="np" ${s.nonPayable ? 'checked' : ''}> Non-payable by insurance</label><label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Active</label></div></div></form>`,
        footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', cls: 'btn-primary', icon: 'save', onClick: (c) => {
          const f = m.el.querySelector('form');
          try {
            const code = f.code.value.trim().toUpperCase();
            if (!code || !f.name.value.trim()) throw new Error('Enter a code and a name.');
            if (isNew && store.all('services').some((x) => x.code === code)) throw new Error('That code is already used.');
            if (!(Number(f.rate.value) >= 0)) throw new Error('Enter a valid rate.');
            const applicableIn = [f.op.checked && 'OP', f.ip.checked && 'IP'].filter(Boolean); if (!applicableIn.length) throw new Error('Choose OP and/or IP.');
            const patch = { code, name: f.name.value.trim(), category: f.category.value, group: CATS.find((x) => x[0] === f.category.value)[2], rate: Number(f.rate.value), unit: f.unit.value, applicableIn, nonPayable: f.np.checked, active: f.active.checked };
            save(() => { if (isNew) store.insert('services', { id: store.nextId('services', 'SRV-', 3), ...patch }); else Object.assign(store.get('services', s.id), patch); }, 'Service saved.', 'TARIFF_UPDATED', s.id || code, `${patch.name} ₹${patch.rate}`);
            c(); draw();
          } catch (e) { toast(e.message, 'error'); }
        } }] });
    };
    h.querySelector('[data-add]').onclick = () => edit(null);
    h.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => edit(store.get('services', b.dataset.edit)); });
  };

  const beds = (h) => {
    const cats = bedCategories();
    h.innerHTML = `<h3 class="section-title">Bed categories & daily rates</h3><div class="table-scroll"><table class="table dense"><thead><tr><th>Category</th><th style="width:150px">Bed / day</th><th style="width:150px">Nursing / day</th><th style="width:170px">Suggested advance</th><th class="ta-right">Beds</th></tr></thead><tbody>
      ${Object.entries(cats).map(([k, c]) => `<tr><td><strong>${esc(c.label)}</strong></td><td><input class="input input-sm" type="number" min="0" data-c="${k}" data-f="rate" value="${c.rate}"></td><td><input class="input input-sm" type="number" min="0" data-c="${k}" data-f="nursing" value="${c.nursing}"></td><td><input class="input input-sm" type="number" min="0" data-c="${k}" data-f="advance" value="${c.advance}"></td><td class="ta-right">${store.all('beds').filter((b) => b.category === k && b.active).length}</td></tr>`).join('')}</tbody></table></div>
      <button class="btn btn-primary btn-sm mt-1" data-savecat>${icon('save')}Save rates</button><p class="muted small mt-1">New rates apply to every running bill from today (bed days are worked out when the bill is viewed) and are frozen in final bills.</p>
      <h3 class="section-title mt-3">Wards & beds</h3><div class="mast-grid">${store.all('wards').map((w) => { const bs = store.all('beds').filter((b) => b.wardId === w.id);
        return card(w.name, `<p class="muted small">${esc(w.floor)} · ${esc(categoryLabel(w.category))}</p><div class="chip-row mt-1">${bs.map((b) => `<span class="pill-soft ${b.active ? '' : 'muted'}" title="${b.active ? '' : 'Inactive'}">${esc(b.code)}${b.active && bedStatus(b) !== 'OCCUPIED' ? ` <button class="link small" data-off="${b.id}" title="Remove bed">×</button>` : ''}${!b.active ? ` <button class="link small" data-on="${b.id}">restore</button>` : ''}</span>`).join('')}</div>
          <div class="row mt-1"><input class="input input-sm grow" placeholder="New bed code" data-newbed="${w.id}"><button class="btn btn-secondary btn-sm" data-addbed="${w.id}">${icon('plus')}Add</button></div>`); }).join('')}</div>`;
    h.querySelector('[data-savecat]').onclick = () => {
      try {
        const vals = [...h.querySelectorAll('[data-c]')]; if (vals.some((x) => x.value === '' || Number(x.value) < 0)) throw new Error('Rates must be zero or more.');
        save(() => { vals.forEach((x) => { cs().ip.bedCategories[x.dataset.c][x.dataset.f] = Number(x.value); }); }, 'Bed rates saved.', 'BED_RATES_UPDATED', 'CATEGORIES', vals.map((x) => `${x.dataset.c}.${x.dataset.f}=${x.value}`).join(' '));
        draw();
      } catch (e) { toast(e.message, 'error'); }
    };
    h.onclick = (e) => {
      const a = e.target.closest('[data-addbed]'); const off = e.target.closest('[data-off]'); const on = e.target.closest('[data-on]');
      try {
        if (a) { const w = store.get('wards', a.dataset.addbed); const code = h.querySelector(`[data-newbed="${w.id}"]`).value.trim().toUpperCase(); if (!code) throw new Error('Enter a bed code.'); if (store.all('beds').some((b) => b.code === code)) throw new Error('That bed code exists.');
          save(() => store.insert('beds', { id: store.nextId('beds', 'BED-', 3), wardId: w.id, code, category: w.category, state: 'READY', note: '', updatedAt: new Date().toISOString(), updatedBy: currentUser().id, active: true }), `Bed ${code} added.`, 'BED_ADDED', code, w.name); draw(); }
        if (off) { const b = store.get('beds', off.dataset.off); save(() => { b.active = false; }, `Bed ${b.code} removed from service.`, 'BED_REMOVED', b.id, b.code); draw(); }
        if (on) { const b = store.get('beds', on.dataset.on); save(() => { b.active = true; b.state = 'READY'; }, `Bed ${b.code} restored.`, 'BED_RESTORED', b.id, b.code); draw(); }
      } catch (err) { toast(err.message, 'error'); }
    };
  };

  const rules = (h) => {
    const c = cs();
    h.innerHTML = `<div class="grid grid-2"><form class="card" data-r><header class="card-head"><h2>OP rules</h2></header><div class="card-body form-grid">
        <div class="field col-6"><label>Emergency consultation fee (₹)</label><input class="input" type="number" min="0" name="emergencyFee" value="${c.op.emergencyFee}"></div><div class="field col-6"><label>Default free follow-up (days)</label><input class="input" type="number" min="0" name="defaultFollowUpDays" value="${c.op.defaultFollowUpDays}"></div>
        <div class="field col-6"><label>Skipped token moves back (places)</label><input class="input" type="number" min="1" name="skipPlaces" value="${c.op.skipPlaces}"></div><div class="field col-6"><label>Skips before no-show</label><input class="input" type="number" min="0" name="maxSkips" value="${c.op.maxSkips}"></div>
        <div class="field col-6"><label>Token display refresh (sec)</label><input class="input" type="number" min="5" name="displayRefreshSec" value="${c.op.displayRefreshSec}"></div></div></form>
      <form class="card" data-r><header class="card-head"><h2>IP & cashier rules</h2></header><div class="card-body form-grid">
        <div class="field col-6"><label>Check-out hour (discharge day free before)</label><input class="input" type="number" min="0" max="23" name="checkoutHour" value="${c.ip.checkoutHour}"></div><div class="field col-6"><label>Low-deposit alert above (₹)</label><input class="input" type="number" min="0" name="lowDepositMargin" value="${c.ip.lowDepositMargin}"></div>
        <div class="field col-6"><label>Cash counter opening float (₹)</label><input class="input" type="number" min="0" name="openingFloat" value="${c.cashier.openingFloat}"></div><div class="field col-6"><label>Cash variance tolerance (₹)</label><input class="input" type="number" min="0" name="varianceTolerance" value="${c.cashier.varianceTolerance}"></div>
        <div class="col-12 muted small">Discount limit for staff (${store.ph().discountLimits?.staffPct ?? 10}%) is shared with pharmacy billing and set in Settings → Pharmacy & Billing.</div></div></form></div>
      <button class="btn btn-primary mt-2" data-saverules>${icon('save')}Save rules</button>
      <div class="grid grid-3 mt-3">${card('TPAs', `<ul class="list-plain">${c.tpas.map((t) => `<li class="list-row"><span>${esc(t.name)}</span><span class="muted small">${esc(t.phone || '')}</span></li>`).join('')}</ul>${addRow('tpa', 'Add TPA')}`)}
        ${card('Insurance companies', `<ul class="list-plain">${c.insurers.map((t) => `<li class="list-row"><span>${esc(t)}</span></li>`).join('')}</ul>${addRow('ins', 'Add insurer')}`)}
        ${card('Corporate tie-ups', `<ul class="list-plain">${c.corporates.map((t) => `<li class="list-row"><span>${esc(t)}</span></li>`).join('')}</ul>${addRow('corp', 'Add company')}`)}</div>`;
    h.querySelector('[data-saverules]').onclick = () => {
      try {
        const v = Object.fromEntries([...h.querySelectorAll('[data-r] input')].map((i) => [i.name, Number(i.value)]));
        if (Object.values(v).some((x) => !(x >= 0))) throw new Error('Values must be zero or more.');
        if (v.checkoutHour > 23) throw new Error('Check-out hour is 0–23.');
        save(() => { ['emergencyFee', 'defaultFollowUpDays', 'skipPlaces', 'maxSkips', 'displayRefreshSec'].forEach((k) => { c.op[k] = v[k]; }); c.ip.checkoutHour = v.checkoutHour; c.ip.lowDepositMargin = v.lowDepositMargin; c.cashier.openingFloat = v.openingFloat; c.cashier.varianceTolerance = v.varianceTolerance; }, 'Rules saved.', 'CLINICAL_RULES_UPDATED', 'RULES', JSON.stringify(v));
      } catch (e) { toast(e.message, 'error'); }
    };
    h.querySelectorAll('[data-addlist]').forEach((b) => { b.onclick = () => {
      const k = b.dataset.addlist; const val = h.querySelector(`[data-in="${k}"]`).value.trim(); if (!val) return toast('Enter a name.', 'warning');
      try { save(() => { if (k === 'tpa') c.tpas.push({ id: 'TPA-' + String(c.tpas.length + 1).padStart(2, '0'), name: val, phone: '' }); if (k === 'ins') c.insurers.push(val); if (k === 'corp') c.corporates.push(val); }, 'Added.', 'PAYER_MASTER_UPDATED', k, val); draw(); } catch (e) { toast(e.message, 'error'); }
    }; });
  };
  const addRow = (k, l) => `<div class="row mt-1"><input class="input input-sm grow" data-in="${k}" placeholder="${l}"><button class="btn btn-secondary btn-sm" data-addlist="${k}">${icon('plus')}</button></div>`;
  draw();
}
