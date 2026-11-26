// Lab Test Master screens — #/lab/tests (the list) and #/lab/tests/:id | new (the editor).
// Everyone in the lab and at reception can read it; Admin and Super Admin can add, edit, stop and restart tests.
import { store } from '../../data-service.js';
import { currentUser } from '../../auth.js';
import { userName } from '../../calculations.js';
import { refText } from '../../hospital.js';
import { labTests, departments, SAMPLE_TYPES, canManageTests, labTestUsage, saveLabTest, setLabTestActive, toDraft, normalise, validateLabTest, isQualitative } from '../../labmaster.js';
import { containers } from '../../labflow.js';
import { openModal, confirmDialog, downloadCSV } from '../../components.js';
import { toast } from '../../notifications.js';
import { setMeta } from '../../app.js';
import { navigate } from '../../router.js';
import { esc, fmtINR, fmtDate, fmtDateTime, refreshIcons, ymd } from '../../utils.js';
import { cap, tubeInfo } from './ui.js';
import { icon, emptyState } from './bi.js';

// =====================================================================================================
export function renderTestList(view, params, query) {
  const edit = canManageTests();
  let dept = query.dept || 'all'; let status = 'active';
  view.innerHTML = `<div class="tm">
    <div class="tm-top"><label class="lw-scan tm-search">${icon('search')}<input data-q placeholder="Search test name or code" autocomplete="off"></label>
      <div class="lw-tools"><button class="btn btn-ghost" data-csv>${icon('download')}Export</button>${edit ? `<a class="btn btn-primary" href="#/lab/tests/new">${icon('plus')}Add test</a>` : ''}</div></div>
    <div class="tm-note ${edit ? '' : 'ro'}">${icon(edit ? 'shield-check' : 'eye')}<span>${edit ? 'You can change this list. Reception bills from it and the lab reports from it — <b>changes apply at every counter immediately</b>. Bills and reports already made never change.' : 'This is the hospital’s list of lab tests, prices and normal ranges. Only the Admin or Super Admin can change it.'}</span></div>
    <section class="lw-panel"><div class="lw-filters" data-f></div><div data-list></div></section></div>`;
  const qEl = view.querySelector('[data-q]');
  const draw = () => {
    const q = qEl.value.trim().toLowerCase(); const all = labTests();
    const inStatus = (t) => status === 'all' || (status === 'active' ? t.active : !t.active);
    const rows = all.filter((t) => inStatus(t) && (dept === 'all' || t.lab.department === dept) && (!q || `${t.name} ${t.code}`.toLowerCase().includes(q)));
    const depts = [...new Set(all.map((t) => t.lab.department))].sort();
    view.querySelector('[data-f]').innerHTML = `${[['active', 'Offered'], ['inactive', 'Stopped'], ['all', 'All']].map(([k, l]) => `<button class="lw-filter ${status === k ? 'active' : ''}" data-st="${k}">${l}<span>${all.filter((t) => k === 'all' || (k === 'active' ? t.active : !t.active)).length}</span></button>`).join('')}
      <span class="tm-sep"></span>${['all', ...depts].map((d) => `<button class="lw-filter ${dept === d ? 'active' : ''}" data-dept="${esc(d)}">${d === 'all' ? 'All departments' : esc(d)}</button>`).join('')}`;
    view.querySelector('[data-list]').innerHTML = rows.length ? `<div class="table-scroll"><table class="table tm-table"><thead><tr><th>Test</th><th>Department</th><th>Sample / tube</th><th>Report shows</th><th>Ready in</th><th>Rules</th><th class="ta-right">Price</th><th>Status</th></tr></thead><tbody>
      ${rows.map((t) => { const ti = tubeInfo(t.lab.container); return `<tr class="clickable ${t.active ? '' : 'tm-off'}" data-open="${t.id}">
        <td><strong>${esc(t.name)}</strong><div class="cell-sub"><span class="mono">${esc(t.code)}</span>${t.version > 1 ? ` · v${t.version}, changed ${fmtDate(t.updatedAt)}` : ''}</div></td>
        <td>${esc(t.lab.department)}</td><td><span class="tm-tube">${cap(t.lab.container)}<span>${esc(t.lab.sample)}<small>${esc(ti.name)}</small></span></span></td>
        <td class="small">${t.lab.parameters.slice(0, 3).map((p) => esc(p.name)).join(', ')}${t.lab.parameters.length > 3 ? ` <span class="muted">+${t.lab.parameters.length - 3} more</span>` : ''}</td>
        <td>${t.lab.tatHours} h</td><td>${t.lab.rxRequired ? `<span class="lx-pill lx-warning" title="Not allowed on a self request">${icon('file-text')}Rx</span> ` : ''}${t.lab.consentRequired ? `<span class="lx-pill lx-purple" title="Signed consent needed">${icon('pen-line')}Consent</span>` : ''}${!t.lab.rxRequired && !t.lab.consentRequired ? '<span class="muted">—</span>' : ''}</td>
        <td class="ta-right strong">${fmtINR(t.price)}</td><td>${t.active ? '<span class="lx-status lx-st-success"><i></i>Offered</span>' : '<span class="lx-status lx-st-muted"><i></i>Stopped</span>'}</td></tr>`; }).join('')}</tbody></table></div>`
      : emptyState('flask-conical', q ? 'No test matches' : 'No tests here', q ? `Nothing matches “${esc(qEl.value)}”.` : '', edit ? '<a class="btn btn-primary" href="#/lab/tests/new">Add a test</a>' : '');
    view.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => { status = b.dataset.st; draw(); }; });
    view.querySelectorAll('[data-dept]').forEach((b) => { b.onclick = () => { dept = b.dataset.dept; draw(); }; });
    view.querySelectorAll('[data-open]').forEach((r) => { r.onclick = () => { location.hash = `#/lab/tests/${r.dataset.open}`; }; });
    refreshIcons(view);
  };
  qEl.addEventListener('input', draw);
  view.querySelector('[data-csv]').onclick = () => downloadCSV(`lab-test-master-${ymd()}.csv`, ['Code', 'Test', 'Department', 'Sample', 'Tube', 'Turnaround (h)', 'Price', 'Prescription needed', 'Consent needed', 'Parameters', 'Status', 'Version'],
    labTests().map((t) => [t.code, t.name, t.lab.department, t.lab.sample, t.lab.container, t.lab.tatHours, t.price, t.lab.rxRequired ? 'Yes' : 'No', t.lab.consentRequired ? 'Yes' : 'No', t.lab.parameters.map((p) => `${p.name} [${refText(p)}${p.unit ? ' ' + p.unit : ''}]`).join('; '), t.active ? 'Offered' : 'Stopped', t.version || 1]));
  const unsub = store.subscribe(draw);
  draw(); setTimeout(() => qEl.focus(), 50);
  return () => unsub();
}

// =====================================================================================================
export function renderTestEditor(view, params) {
  const user = currentUser(); const isNew = params.id === 'new' || !params.id;
  const t = isNew ? null : store.get('services', params.id);
  if (!isNew && (!t || t.category !== 'LAB')) { view.innerHTML = emptyState('flask-conical', 'Test not found', '', '<a class="btn btn-primary" href="#/lab/tests">Back to the test list</a>'); return; }
  const edit = canManageTests();
  if (isNew && !edit) { location.replace('#/lab/tests'); return; }
  setMeta({ title: isNew ? 'Add lab test' : t.name, crumbs: [{ label: 'Laboratory', href: '#/lab' }, { label: 'Test Master', href: '#/lab/tests' }, isNew ? 'New test' : t.code] });
  const d = toDraft(t); let dirty = false;
  const dis = edit ? '' : 'disabled';
  const kits = store.all('labKits').filter((k) => k.active !== false);
  const draw = () => {
    const use = t ? labTestUsage(t.id) : null;
    view.innerHTML = `<div class="tm-ed">
      <div class="tm-main">
        <section class="sid-card"><header class="sid-card-head"><h2>${icon('flask-conical')}Test details</h2>${t ? `<span class="muted small">Version ${t.version || 1}${t.updatedAt ? ` · last changed ${fmtDateTime(t.updatedAt)} by ${esc(userName(t.updatedBy))}` : ''}</span>` : ''}</header>
          <div class="tm-form">
            <div class="field tm-c8"><label>Test name <span class="req">*</span></label><input class="input" data-k="name" value="${esc(d.name)}" placeholder="e.g. Serum Calcium" ${dis}></div>
            <div class="field tm-c4"><label>Short code <span class="req">*</span></label><input class="input mono" data-k="code" value="${esc(d.code)}" placeholder="e.g. CALCIUM" maxlength="12" ${dis}><small class="field-hint">Printed on tube labels</small></div>
            <div class="field tm-c4"><label>Department <span class="req">*</span></label><input class="input" data-k="department" list="tm-depts" value="${esc(d.department)}" placeholder="Choose or type" ${dis}><datalist id="tm-depts">${departments().map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
            <div class="field tm-c4"><label>Price (₹) <span class="req">*</span></label><input class="input" type="number" min="0" step="1" data-k="price" value="${esc(d.price)}" ${dis}><small class="field-hint">Reception bills this amount</small></div>
            <div class="field tm-c4"><label>Report ready in (hours) <span class="req">*</span></label><input class="input" type="number" min="1" data-k="tatHours" value="${esc(d.tatHours)}" ${dis}><small class="field-hint">Printed as the report date on the bill</small></div>
            <div class="field tm-c6"><label>Sample type <span class="req">*</span></label><select class="input" data-k="sample" ${dis}>${[...new Set([...SAMPLE_TYPES.map((x) => x.sample), d.sample].filter(Boolean))].map((x) => `<option ${x === d.sample ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
            <div class="field tm-c6"><label>Tube / container</label><div class="tm-tubes">${Object.entries(containers()).map(([k]) => `<button type="button" class="tm-tubeopt ${d.container === k ? 'active' : ''}" data-tube="${k}" ${dis}>${cap(k)}<span>${esc(tubeInfo(k).name)}</span></button>`).join('')}</div></div>
            <div class="field tm-c6"><label>Method <span class="muted">(optional, printed on report)</span></label><input class="input" data-k="method" value="${esc(d.method)}" placeholder="e.g. Automated analyser, Rapid card" ${dis}></div>
            <div class="field tm-c6"><label>Note under the result <span class="muted">(optional)</span></label><input class="input" data-k="note" value="${esc(d.note)}" placeholder="e.g. Fasting sample of 10–12 hours preferred" ${dis}></div>
            <div class="tm-c12 tm-rules"><label class="switch"><input type="checkbox" data-k="rxRequired" ${d.rxRequired ? 'checked' : ''} ${dis}> <span><strong>Prescription needed</strong><small>Cannot be billed as a self request</small></span></label>
              <label class="switch"><input type="checkbox" data-k="consentRequired" ${d.consentRequired ? 'checked' : ''} ${dis}> <span><strong>Signed consent needed</strong><small>Reception must confirm consent before billing</small></span></label></div>
          </div></section>

        <section class="sid-card"><header class="sid-card-head"><h2>${icon('list-checks')}What the report shows</h2><span class="muted small">One row per result. Numbers get High / Low / Critical flags automatically.</span></header>
          <div class="table-scroll"><table class="tm-params"><thead><tr><th></th><th>Result name</th><th>Type</th><th>Unit</th><th>Normal low</th><th>Normal high</th><th>Critical low</th><th>Critical high</th><th></th></tr></thead><tbody data-params></tbody></table></div>
          ${edit ? `<div class="tm-add"><button class="btn btn-ghost btn-sm" data-addp="NUM">${icon('plus')}Number result</button><button class="btn btn-ghost btn-sm" data-addp="TEXT">${icon('plus')}Text result (e.g. Negative)</button></div>` : ''}</section>

        <section class="sid-card"><header class="sid-card-head"><h2>${icon('boxes')}Reagent kits used per test</h2><span class="muted small">Used for “kits used vs tests billed”.</span></header>
          <div class="tm-kits" data-kits></div>${edit ? `<div class="tm-add"><button class="btn btn-ghost btn-sm" data-addk>${icon('plus')}Add kit</button></div>` : ''}</section>
        ${edit ? `<div class="tm-bar"><div class="tm-bar-msg" data-msg></div>${!isNew ? `<input class="input" data-reason placeholder="Reason for this change (required) — e.g. Price revised by management">` : ''}<a class="btn btn-secondary" href="#/lab/tests">Cancel</a><button class="btn btn-primary" data-save>${icon('save')}${isNew ? 'Add test' : 'Save changes'}</button></div>` : ''}
      </div>
      <aside class="tm-side">
        <section class="sid-card"><header class="sid-card-head"><h2>${icon('eye')}Report preview</h2></header><div class="tm-preview" data-preview></div></section>
        ${t ? `<section class="sid-card"><header class="sid-card-head"><h2>${icon('activity')}Usage</h2></header><div class="sid-kvs">
          <div class="sid-kv"><span>Status</span><span>${t.active ? '<span class="lx-status lx-st-success"><i></i>Offered</span>' : '<span class="lx-status lx-st-muted"><i></i>Stopped</span>'}</span></div>
          <div class="sid-kv"><span>Done in last 30 days</span><strong>${use.last30}</strong></div><div class="sid-kv"><span>All time</span><span>${use.total}</span></div>
          <div class="sid-kv"><span>In progress now</span><span>${use.pending}</span></div><div class="sid-kv"><span>In packages</span><span>${use.packages.map((p) => esc(p.name)).join(', ') || '—'}</span></div></div>
          ${edit ? `<div class="tm-side-act">${t.active ? `<button class="btn btn-ghost btn-sm lx-danger-text" data-active="0">${icon('pause-circle')}Stop offering this test</button>` : `<button class="btn btn-secondary btn-sm" data-active="1">${icon('play-circle')}Offer this test again</button>`}</div>` : ''}</section>
        <section class="sid-card"><header class="sid-card-head"><h2>${icon('history')}Change history</h2></header><ol class="sid-tl tm-hist">${(t.history || []).slice().reverse().map((h) => `<li><span>${h.version}</span><div><strong>${esc(h.reason)}</strong>${(h.changes || []).map((c) => `<small class="tm-chg">${esc(c)}</small>`).join('')}<small>${fmtDateTime(h.at)} · ${esc(userName(h.by))}</small></div></li>`).join('') || '<li><div><small>No changes since the system was set up.</small></div></li>'}</ol></section>` : ''}
      </aside></div>`;
    drawParams(); drawKits(); drawPreview(); wire(); refreshIcons(view);
  };
  const drawParams = () => {
    const tb = view.querySelector('[data-params]');
    tb.innerHTML = d.parameters.map((p, i) => `<tr data-i="${i}"><td class="tm-move">${edit ? `<button class="icon-btn" data-up="${i}" ${i ? '' : 'disabled'} title="Move up">${icon('chevron-up')}</button><button class="icon-btn" data-down="${i}" ${i < d.parameters.length - 1 ? '' : 'disabled'} title="Move down">${icon('chevron-down')}</button>` : i + 1}</td>
      <td><input class="input input-sm" data-p="name" value="${esc(p.name)}" placeholder="e.g. Haemoglobin" ${dis}></td>
      <td><select class="input input-sm" data-p="type" ${dis}><option value="NUM" ${p.type === 'NUM' ? 'selected' : ''}>Number</option><option value="TEXT" ${p.type === 'TEXT' ? 'selected' : ''}>Text</option></select></td>
      <td><input class="input input-sm tm-unit" data-p="unit" value="${esc(p.unit)}" placeholder="g/dL" ${dis}></td>
      ${p.type === 'TEXT' ? `<td colspan="4"><input class="input input-sm" data-p="ref" value="${esc(p.ref || '')}" placeholder="Normal result, e.g. Negative / Nil / Non-reactive" ${dis}></td>`
        : ['low', 'high', 'critLow', 'critHigh'].map((k) => `<td><input class="input input-sm tm-num ${k.startsWith('crit') ? 'crit' : ''}" type="number" step="any" data-p="${k}" value="${esc(p[k])}" placeholder="${k.startsWith('crit') ? 'optional' : ''}" ${dis}></td>`).join('')}
      <td>${edit ? `<button class="icon-btn lx-danger-text" data-delp="${i}" title="Remove" ${d.parameters.length > 1 ? '' : 'disabled'}>${icon('trash-2')}</button>` : ''}</td></tr>`).join('');
    tb.querySelectorAll('[data-p]').forEach((el) => { el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { const i = +el.closest('tr').dataset.i; const k = el.dataset.p; d.parameters[i][k] = el.value; dirty = true; if (k === 'type') { drawParams(); refreshIcons(tb); } drawPreview(); check(); }); });
    tb.querySelectorAll('[data-up],[data-down]').forEach((b) => { b.onclick = () => { const i = +(b.dataset.up ?? b.dataset.down); const j = b.dataset.up != null ? i - 1 : i + 1; [d.parameters[i], d.parameters[j]] = [d.parameters[j], d.parameters[i]]; dirty = true; drawParams(); drawPreview(); refreshIcons(tb); }; });
    tb.querySelectorAll('[data-delp]').forEach((b) => { b.onclick = () => { d.parameters.splice(+b.dataset.delp, 1); dirty = true; drawParams(); drawPreview(); refreshIcons(tb); }; });
  };
  const drawKits = () => {
    const el = view.querySelector('[data-kits]');
    el.innerHTML = d.kits.length ? d.kits.map((k, i) => `<div class="tm-kit" data-i="${i}"><select class="input input-sm" data-kk="kitId" ${dis}><option value="">Choose kit…</option>${kits.map((x) => `<option value="${x.id}" ${x.id === k.kitId ? 'selected' : ''}>${esc(x.name)} (${esc(x.unit)})</option>`).join('')}</select>
      <input class="input input-sm" type="number" min="0" step="any" data-kk="qty" value="${esc(k.qty)}" ${dis}><span class="muted small">per test</span>${edit ? `<button class="icon-btn lx-danger-text" data-delk="${i}">${icon('trash-2')}</button>` : ''}</div>`).join('') : '<p class="muted small tm-empty">No reagent kit linked — the kit check will not track this test.</p>';
    el.querySelectorAll('[data-kk]').forEach((x) => { x.addEventListener('input', () => { d.kits[+x.closest('.tm-kit').dataset.i][x.dataset.kk] = x.value; dirty = true; check(); }); x.addEventListener('change', () => { d.kits[+x.closest('.tm-kit').dataset.i][x.dataset.kk] = x.value; }); });
    el.querySelectorAll('[data-delk]').forEach((b) => { b.onclick = () => { d.kits.splice(+b.dataset.delk, 1); dirty = true; drawKits(); refreshIcons(el); }; });
  };
  const drawPreview = () => {
    const n = normalise(d);
    view.querySelector('[data-preview]').innerHTML = `<div class="tm-pv-h">${esc(n.name || 'Test name')}<small>${esc(n.lab.sample)}${n.lab.method ? ' · ' + esc(n.lab.method) : ''}</small></div>
      <table class="tm-pv"><thead><tr><th>Investigation</th><th>Result</th><th>Unit</th><th>Normal range</th></tr></thead><tbody>${n.lab.parameters.map((p) => `<tr><td>${esc(p.name)}</td><td class="muted">—</td><td>${esc(p.unit)}</td><td>${esc(isQualitative(p) ? p.ref : `${p.low ?? '?'} – ${p.high ?? '?'}`)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Add a result row</td></tr>'}</tbody></table>
      ${n.lab.note ? `<p class="tm-pv-note">Note: ${esc(n.lab.note)}</p>` : ''}<p class="tm-pv-foot">${icon('receipt')}Reception: <b>${n.price != null ? fmtINR(n.price) : '₹ —'}</b> · ready in ${n.lab.tatHours || '—'} h · ${esc(tubeInfo(n.lab.container).name)} tube</p>`;
    refreshIcons(view.querySelector('[data-preview]'));
  };
  const check = () => { const m = view.querySelector('[data-msg]'); if (!m) return; const errs = validateLabTest(normalise(d), t?.id || null); m.innerHTML = errs.length ? `<span class="tm-err">${icon('alert-circle')}${esc(errs[0])}${errs.length > 1 ? ` <em>+${errs.length - 1} more</em>` : ''}</span>` : `<span class="tm-ok">${icon('check-circle-2')}Ready to save</span>`; refreshIcons(m); };
  const wire = () => {
    view.querySelectorAll('[data-k]').forEach((el) => { el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const k = el.dataset.k; d[k] = el.type === 'checkbox' ? el.checked : el.value; dirty = true;
      if (k === 'sample') { const st = SAMPLE_TYPES.find((x) => x.sample === el.value); if (st) { d.container = st.container; view.querySelectorAll('[data-tube]').forEach((b) => b.classList.toggle('active', b.dataset.tube === d.container)); } }
      if (k === 'code') el.value = el.value.toUpperCase().replace(/\s/g, '');
      drawPreview(); check(); }); });
    view.querySelectorAll('[data-tube]').forEach((b) => { b.onclick = () => { d.container = b.dataset.tube; dirty = true; view.querySelectorAll('[data-tube]').forEach((x) => x.classList.toggle('active', x === b)); drawPreview(); }; });
    view.querySelectorAll('[data-addp]').forEach((b) => { b.onclick = () => { d.parameters.push(b.dataset.addp === 'TEXT' ? { type: 'TEXT', name: '', unit: '', ref: '' } : { type: 'NUM', name: '', unit: '', low: '', high: '', critLow: '', critHigh: '' }); drawParams(); refreshIcons(view); view.querySelector(`[data-params] tr:last-child [data-p=name]`).focus(); check(); }; });
    view.querySelector('[data-addk]')?.addEventListener('click', () => { d.kits.push({ kitId: '', qty: 1 }); drawKits(); refreshIcons(view); });
    view.querySelector('[data-save]')?.addEventListener('click', save);
    view.querySelectorAll('[data-active]').forEach((b) => { b.onclick = () => toggleActive(b.dataset.active === '1'); });
    check();
  };
  const save = async () => {
    const reason = view.querySelector('[data-reason]')?.value || '';
    const n = normalise(d);
    const errs = validateLabTest(n, t?.id || null); if (errs.length) { toast(errs[0], 'error'); return; }
    if (t && !reason.trim()) { toast('Write the reason for this change (it is kept in the history).', 'error'); view.querySelector('[data-reason]')?.focus(); return; }
    if (t && n.price !== t.price && !(await confirmDialog({ title: 'Change the price?', iconName: icon('indian-rupee'), confirmLabel: 'Yes, change price', message: `<strong>${esc(t.name)}</strong>: ${fmtINR(t.price)} → <strong>${fmtINR(n.price)}</strong><br>Reception bills the new price from now. Bills already made keep the old price.` }))) return;
    try { const rec = saveLabTest(d, { id: t?.id || null, reason }, user); dirty = false; toast(t ? `${rec.name} saved — version ${rec.version}. Reception and lab see it now.` : `${rec.name} added. Reception can bill it now.`, 'success'); navigate(`#/lab/tests/${rec.id}`); }
    catch (e) { toast(e.message, 'error'); if (e.message.startsWith('Write the reason')) view.querySelector('[data-reason]')?.focus(); }
  };
  const toggleActive = async (on) => {
    const u = labTestUsage(t.id);
    const r = await confirmDialog({ title: on ? `Offer ${t.name} again?` : `Stop offering ${t.name}?`, tone: on ? 'primary' : 'danger', iconName: on ? 'play-circle' : 'pause-circle', confirmLabel: on ? 'Offer again' : 'Stop test', reason: true, reasonLabel: 'Reason', reasonPlaceholder: on ? 'e.g. Kits received' : 'e.g. Kit not available, analyser under repair',
      message: on ? 'Reception can bill it again immediately.' : `Reception will not be able to bill it. ${u.pending ? `<strong>${u.pending} test(s) already in progress</strong> will still be finished.` : ''}${u.packages.length ? `<div class="lx-note danger mt-1">It is part of ${u.packages.map((p) => esc(p.name)).join(', ')}. Package patients will need it replaced.</div>` : ''} Old reports are not affected.` });
    if (!r) return;
    try { setLabTestActive(t.id, on, r.reason, user); toast(on ? 'Test is offered again.' : 'Test stopped — reception can no longer bill it.', on ? 'success' : 'warning'); navigate(`#/lab/tests/${t.id}`); } catch (e) { toast(e.message, 'error'); }
  };
  const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  draw();
  return () => window.removeEventListener('beforeunload', beforeUnload);
}
