// Hospital Setup (Super Admin): service catalogue & prices, lab test formats, reagent kits, shift timings & cash rules,
// workstation restrictions (BRD 14) and approval rules — all changeable without touching code.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { audit } from '../services.js';
import { catLabel, catIcon, CATS, refText } from '../hospital.js';
import { tabs, openModal, emptyState, badge } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, refreshIcons } from '../utils.js';

export const WS_KEY = 'nallam_hms_workstation';
export const thisWorkstation = () => { try { return localStorage.getItem(WS_KEY) || ''; } catch { return ''; } };

export function render(view, params, query) {
  const user = currentUser(); const edit = can('catalog.manage');
  let tab = query.tab || 'services';
  view.innerHTML = `<p class="page-intro">Prices, test formats, kits, shift timings and workstation rules. Changes apply immediately at every counter and are recorded in the audit log.</p><section class="card"><div class="card-pad" data-tabs></div><div data-b></div></section>`;
  const save = (what, fn) => { try { store.transaction(() => { fn(); audit(user, 'HOSPITAL_SETUP_CHANGED', 'SETUP', what, ''); }); toast('Saved.'); draw(); } catch (e) { toast(e.message, 'error'); } };
  const draw = () => {
    tabs(view.querySelector('[data-tabs]'), [{ id: 'services', label: 'Services & prices', icon: 'tag' }, { id: 'lab', label: 'Lab tests', icon: 'flask-conical' }, { id: 'kits', label: 'Lab kits', icon: 'boxes' }, { id: 'shifts', label: 'Shifts & cash', icon: 'timer' }, { id: 'ws', label: 'Workstations', icon: 'monitor-check' }, { id: 'rules', label: 'Rules', icon: 'shield-check' }], tab, (t) => { tab = t; draw(); });
    const b = view.querySelector('[data-b]'); const hs = store.hs();
    if (tab === 'services') {
      const sv = store.all('services');
      b.innerHTML = `<div class="toolbar">${edit ? `<button class="btn btn-primary btn-sm" data-add>${icon('plus')}Add service</button>` : ''}<span class="muted small">Hospital services are GST-exempt. Lab test prices are edited here too.</span></div>
        <div class="table-scroll"><table class="table"><thead><tr><th>Code</th><th>Service</th><th>Department</th><th class="ta-right" style="width:140px">Price (₹)</th><th>Offered</th></tr></thead><tbody>
        ${CATS().filter((c) => c.code !== 'PACKAGE').map((c) => sv.filter((s) => s.category === c.code).map((s) => `<tr><td class="mono small">${esc(s.code)}</td><td><strong>${esc(s.name)}</strong></td><td>${icon(catIcon(s.category), 'ic-inline')} ${catLabel(s.category)}</td>
          <td class="ta-right">${edit ? `<input class="input input-sm ta-right" type="number" min="0" data-price="${s.id}" value="${s.price}">` : fmtINR(s.price)}</td><td>${edit ? `<label class="switch"><input type="checkbox" data-act="${s.id}" ${s.active ? 'checked' : ''}></label>` : s.active ? 'Yes' : 'No'}</td></tr>`).join('')).join('')}</tbody></table></div>`;
      b.querySelectorAll('[data-price]').forEach((i) => { i.onchange = () => { const v = Number(i.value); if (!(v >= 0)) return toast('Enter a valid price.', 'error'); save('price ' + i.dataset.price, () => store.update('services', i.dataset.price, { price: v })); }; });
      b.querySelectorAll('[data-act]').forEach((i) => { i.onchange = () => save('active ' + i.dataset.act, () => store.update('services', i.dataset.act, { active: i.checked })); });
      b.querySelector('[data-add]')?.addEventListener('click', () => openModal({ title: 'Add service', size: 'sm', body: `<div class="field"><label>Department</label><select class="input" data-c>${CATS().filter((c) => !['PACKAGE', 'LAB'].includes(c.code)).map((c) => `<option value="${c.code}">${esc(c.label)}</option>`).join('')}</select></div><div class="field mt-1"><label>Name</label><input class="input" data-n></div><div class="form-grid mt-1"><div class="field col-6"><label>Code</label><input class="input mono" data-code></div><div class="field col-6"><label>Price (₹)</label><input class="input" type="number" data-p></div></div>`,
        footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Add', cls: 'btn-primary', onClick: (c, w) => { const n = w.querySelector('[data-n]').value.trim(); const p = Number(w.querySelector('[data-p]').value); const code = (w.querySelector('[data-code]').value.trim() || n.replace(/[^A-Z]/gi, '').slice(0, 6)).toUpperCase(); if (!n || !(p >= 0)) return toast('Enter the name and price.', 'error'); if (store.all('services').some((s) => s.code === code)) return toast('That code is already used.', 'error'); c(); save('add ' + code, () => store.insert('services', { id: store.nextId('services', 'SRV-'), code, name: n, category: w.querySelector('[data-c]').value, price: p, active: true })); } }] }));
    } else if (tab === 'lab') {
      const tests = store.all('services').filter((s) => s.category === 'LAB');
      b.innerHTML = `<div class="table-scroll"><table class="table"><thead><tr><th>Test</th><th>Department</th><th>Sample</th><th>Turnaround</th><th>Report format</th><th>Kit per test</th><th class="ta-right">Price</th></tr></thead><tbody>
        ${tests.map((t) => `<tr class="clickable" data-view="${t.id}"><td><strong>${esc(t.name)}</strong><div class="cell-sub mono">${esc(t.code)}</div></td><td>${esc(t.lab.department)}</td><td>${esc(t.lab.sample)}</td><td>${t.lab.tatHours} h</td><td>${t.lab.parameters.length} parameter(s)</td><td class="small">${t.lab.kits.map((k) => `${k.qty} × ${esc(store.get('labKits', k.kitId)?.name)}`).join('<br>')}</td><td class="ta-right">${fmtINR(t.price, true)}</td></tr>`).join('')}</tbody></table></div>`;
      b.querySelectorAll('[data-view]').forEach((r) => { r.onclick = () => { const t = store.get('services', r.dataset.view); openModal({ title: t.name, subtitle: `${t.lab.department} · ${t.lab.sample}`, size: 'md', body: `<table class="table dense"><thead><tr><th>Parameter</th><th>Unit</th><th>Reference</th><th>Critical</th></tr></thead><tbody>${t.lab.parameters.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.unit)}</td><td>${esc(refText(p))}</td><td class="small">${p.critLow != null || p.critHigh != null ? `${p.critLow ?? '—'} / ${p.critHigh ?? '—'}` : '—'}</td></tr>`).join('')}</tbody></table>`, footer: [{ label: 'Close', cls: 'btn-primary', onClick: (c) => c() }] }); }; });
    } else if (tab === 'kits') {
      b.innerHTML = `<div class="table-scroll"><table class="table"><thead><tr><th>Kit / reagent</th><th>Unit</th><th style="width:140px">Reorder level</th><th>Used by</th></tr></thead><tbody>${store.all('labKits').map((k) => `<tr><td><strong>${esc(k.name)}</strong></td><td>${esc(k.unit)}</td><td>${edit ? `<input class="input input-sm" type="number" min="0" data-rl="${k.id}" value="${k.reorderLevel}">` : k.reorderLevel}</td><td class="small">${store.all('services').filter((s) => s.lab?.kits.some((x) => x.kitId === k.id)).map((s) => esc(s.code)).join(', ')}</td></tr>`).join('')}</tbody></table></div>`;
      b.querySelectorAll('[data-rl]').forEach((i) => { i.onchange = () => save('kit ' + i.dataset.rl, () => store.update('labKits', i.dataset.rl, { reorderLevel: Math.max(0, Math.floor(Number(i.value) || 0)) })); });
    } else if (tab === 'shifts') {
      b.innerHTML = `<div class="card-body"><div class="alert ${hs.shiftTimingsConfirmed ? 'alert-success' : 'alert-warning'} mb-2">${icon(hs.shiftTimingsConfirmed ? 'check-circle-2' : 'alert-triangle')}<div>${hs.shiftTimingsConfirmed ? 'Shift timings confirmed with the hospital.' : 'Shift timings are <strong>to be confirmed</strong> with the hospital (BRD pending item). Staff can still pick the shift name when they start.'}</div></div>
        <table class="table dense" style="max-width:560px"><thead><tr><th>Shift</th><th>Starts</th><th>Ends</th></tr></thead><tbody>${hs.shifts.map((s, i) => `<tr><td><strong>${esc(s.name)}</strong></td><td><input class="input input-sm" type="time" data-st="${i}" value="${s.start}" ${edit ? '' : 'disabled'}></td><td><input class="input input-sm" type="time" data-en="${i}" value="${s.end}" ${edit ? '' : 'disabled'}></td></tr>`).join('')}</tbody></table>
        <div class="form-grid mt-2" style="max-width:720px"><div class="field col-4"><label>Default opening float (₹)</label><input class="input" type="number" data-float value="${hs.defaultOpeningFloat}" ${edit ? '' : 'disabled'}></div><div class="field col-4"><label>Cash difference allowed without a note (₹)</label><input class="input" type="number" data-tol value="${hs.shiftVarianceTolerance}" ${edit ? '' : 'disabled'}></div>
          <div class="col-4" style="align-self:end"><label class="switch"><input type="checkbox" data-conf ${hs.shiftTimingsConfirmed ? 'checked' : ''} ${edit ? '' : 'disabled'}> Timings confirmed</label></div></div>
        ${edit ? `<button class="btn btn-primary mt-2" data-saveshift>${icon('save')}Save</button>` : ''}</div>`;
      b.querySelector('[data-saveshift]')?.addEventListener('click', () => save('shifts', () => store.updateHs({ shifts: hs.shifts.map((s, i) => ({ ...s, start: b.querySelector(`[data-st="${i}"]`).value, end: b.querySelector(`[data-en="${i}"]`).value })), defaultOpeningFloat: Number(b.querySelector('[data-float]').value) || 0, shiftVarianceTolerance: Number(b.querySelector('[data-tol]').value) || 0, shiftTimingsConfirmed: b.querySelector('[data-conf]').checked })));
    } else if (tab === 'ws') {
      const ws = hs.workstations; const mine = thisWorkstation(); const roles = store.all('roles');
      b.innerHTML = `<div class="card-body"><div class="ws-this">${icon('monitor')}<div class="grow"><strong>This computer: ${mine ? esc(ws.list.find((w) => w.id === mine)?.name || mine) : 'not registered'}</strong><span class="muted small">Registering marks this browser as a hospital workstation. Staff can sign in only on a workstation set up for their role when the restriction is on.</span></div>
          ${edit ? `<select class="input" style="width:auto" data-reg><option value="">— Not a workstation —</option>${ws.list.map((w) => `<option value="${w.id}" ${w.id === mine ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>` : ''}</div>
        <label class="switch mt-2"><input type="checkbox" data-enf ${ws.enforce ? 'checked' : ''} ${edit ? '' : 'disabled'}> Restrict staff sign-in to their workstations <span class="muted small">(Super Admin can always sign in, from anywhere)</span></label>
        <div class="table-scroll mt-2"><table class="table"><thead><tr><th>Workstation</th><th>Location</th>${roles.map((r) => `<th class="ta-center small">${esc(r.name)}</th>`).join('')}</tr></thead><tbody>
          ${ws.list.map((w, i) => `<tr><td><strong>${esc(w.name)}</strong><div class="cell-sub mono">${w.id}</div></td><td class="small">${esc(w.location)}</td>${roles.map((r) => `<td class="ta-center"><input type="checkbox" data-wr="${i}|${r.id}" ${w.roles.includes(r.id) ? 'checked' : ''} ${edit && r.id !== 'SUPER_ADMIN' ? '' : 'disabled'}></td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="muted small mt-1">Combined with the allowed hospital network addresses in Settings. The exact locking mechanism is listed as “to be confirmed” in the BRD; on the live server this check also runs on the server.</p></div>`;
      b.querySelector('[data-reg]')?.addEventListener('change', (e) => { try { if (e.target.value) localStorage.setItem(WS_KEY, e.target.value); else localStorage.removeItem(WS_KEY); } catch { /* storage blocked */ } audit(user, 'WORKSTATION_REGISTERED', 'SETUP', e.target.value || 'none', ''); store.commit(); toast(e.target.value ? 'This computer is now a registered workstation.' : 'Workstation registration removed.'); draw(); });
      b.querySelector('[data-enf]')?.addEventListener('change', (e) => save('workstation enforce', () => store.updateHs({ workstations: { ...ws, enforce: e.target.checked } })));
      b.querySelectorAll('[data-wr]').forEach((cb) => { cb.onchange = () => { const [i, r] = cb.dataset.wr.split('|'); const list = ws.list.map((w, k) => (k === +i ? { ...w, roles: cb.checked ? [...new Set([...w.roles, r])] : w.roles.filter((x) => x !== r) } : w)); save('workstation roles', () => store.updateHs({ workstations: { ...ws, list } })); }; });
    } else {
      b.innerHTML = `<div class="card-body"><div class="form-grid" style="max-width:820px">
        <label class="switch col-12"><input type="checkbox" data-r="em" ${hs.credit.emergencyAllowed ? 'checked' : ''} ${edit ? '' : 'disabled'}> Allow <strong>Emergency</strong> billing — services start before payment, owner alerted</label>
        <label class="switch col-12"><input type="checkbox" data-r="sec" ${hs.lab.requireSecondPersonVerification ? 'checked' : ''} ${edit ? '' : 'disabled'}> Lab report must be verified by a <strong>different person</strong> from the one who entered the results</label>
        <div class="field col-4"><label>Lab kit variance allowed</label><input class="input" type="number" data-r="kv" value="${hs.lab.kitVarianceTolerance}" ${edit ? '' : 'disabled'}></div>
        <div class="field col-4"><label>MRD coding due (days after discharge)</label><input class="input" type="number" data-r="cd" value="${hs.mrd.codingDueDays}" ${edit ? '' : 'disabled'}></div>
        <div class="field col-4"><label>Staff discount limit</label><div class="input-like">${store.ph().discountLimits.staffPct}% <a class="small" href="#/settings">change in Settings</a></div></div></div>
        ${edit ? `<button class="btn btn-primary mt-2" data-saverules>${icon('save')}Save rules</button>` : ''}
        <div class="section-title mt-2">Discharge summary formats</div><div class="tpl-list">${hs.dischargeTemplates.map((t) => `<div class="tpl"><strong>${esc(t.name)}</strong><small>${t.sections.length} sections</small></div>`).join('')}</div></div>`;
      b.querySelector('[data-saverules]')?.addEventListener('click', () => { const q = (k) => b.querySelector(`[data-r="${k}"]`); save('rules', () => store.updateHs({ credit: { ...hs.credit, emergencyAllowed: q('em').checked }, lab: { ...hs.lab, requireSecondPersonVerification: q('sec').checked, kitVarianceTolerance: Number(q('kv').value) || 0 }, mrd: { ...hs.mrd, codingDueDays: Math.max(1, Number(q('cd').value) || 5) } })); });
    }
    refreshIcons(view);
  };
  draw();
}
