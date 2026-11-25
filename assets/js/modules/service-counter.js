// Service Counter (BRD 07): ECG, injection, nebulization and other procedures are done only after the main counter
// bills them (or credit / emergency is approved). Doctor advice is recorded as a request so nothing escapes billing,
// and the reconciliation compares requested → billed → cleared → completed.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { userName } from '../calculations.js';
import { svc, orderAccess, completeService, requestServices, cancelRequest, serviceReconciliation, catLabel, catIcon, patientOf } from '../hospital.js';
import { businessDate } from '../pharmacy-calc.js';
import { patientAge } from '../patients.js';
import { combo, emptyState, openModal, confirmDialog, kpi, tabs, exportTable } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, fmtDateTime, relTime, refreshIcons, ymd } from '../utils.js';

const SVC_CATS = ['ECG', 'INJECTION', 'NEBULIZATION', 'OTHER'];

export function render(view, params, query) {
  const user = currentUser(); const today = businessDate();
  let tab = query.tab || 'ready';
  view.innerHTML = `<p class="page-intro">Do a service only when it shows <strong>Ready</strong> — that means the main counter has billed it and it is paid, in a package, or approved as credit / emergency. If a doctor advises something new, record it as a request; it goes to the main counter for billing.</p>
    <div class="kpis mb-2" data-k></div>
    <section class="card"><div class="row-between card-pad"><div data-tabs></div><div class="row"><div class="input-icon" style="width:240px">${icon('search')}<input class="input" data-q placeholder="Patient or Patient ID"></div>${can('service.request') ? `<button class="btn btn-secondary" data-req>${icon('clipboard-plus')}Doctor request</button>` : ''}</div></div><div data-list></div></section>`;
  const draw = () => {
    const q = view.querySelector('[data-q]').value.trim().toLowerCase();
    const m = (o) => { const p = patientOf(o.patientId); return !q || [p?.name, p?.uhid, o.name].join(' ').toLowerCase().includes(q); };
    const os = store.all('orders').filter((o) => SVC_CATS.includes(o.category) && m(o));
    const g = { ready: os.filter((o) => o.status === 'READY' && orderAccess(o).ok), hold: os.filter((o) => ['ON_HOLD', 'READY'].includes(o.status) && o.billId && !orderAccess(o).ok), req: os.filter((o) => o.status === 'REQUESTED'), done: os.filter((o) => o.status === 'COMPLETED' && businessDate(o.performedAt) === today) };
    view.querySelector('[data-k]').innerHTML = `${kpi({ label: 'Ready to do', value: fmtNum(g.ready.length), iconName: 'play-circle', tone: g.ready.length ? 'warning' : 'success' })}
      ${kpi({ label: 'Waiting for payment', value: fmtNum(g.hold.length), iconName: 'lock', tone: 'info' })}
      ${kpi({ label: 'Advised, not billed', value: fmtNum(g.req.length), iconName: 'alert-triangle', tone: g.req.length ? 'danger' : 'success', sub: 'Send patient to main counter' })}
      ${kpi({ label: 'Done today', value: fmtNum(g.done.length), iconName: 'check-check', tone: 'teal' })}`;
    tabs(view.querySelector('[data-tabs]'), [{ id: 'ready', label: 'Ready', icon: 'play-circle', count: g.ready.length }, { id: 'hold', label: 'Payment pending', icon: 'lock', count: g.hold.length }, { id: 'req', label: 'Not billed', icon: 'alert-triangle', count: g.req.length }, { id: 'done', label: 'Done today', icon: 'check-check', count: g.done.length }], tab, (t) => { tab = t; draw(); });
    const rows = g[tab].sort((a, b) => (a.billedAt || a.requestedAt).localeCompare(b.billedAt || b.requestedAt));
    view.querySelector('[data-list]').innerHTML = rows.length ? `<div class="work-list">${rows.map((o) => { const p = patientOf(o.patientId); const a = orderAccess(o);
      return `<div class="work-row"><div class="wr-ic cat-${o.category.toLowerCase()}">${icon(catIcon(o.category))}</div>
        <div class="wr-main"><strong>${esc(o.name)}</strong><span>${esc(p.name)} · <span class="mono">${esc(p.uhid)}</span> · ${esc(p.gender)}/${patientAge(p) ?? '—'}${p.allergies ? ` · <span class="text-danger">Allergy: ${esc(p.allergies)}</span>` : ''}</span><small>${esc(o.doctor || 'No doctor')} · ${o.billId ? `bill <a class="mono" href="#/hbills/${o.billId}">${o.billId}</a>` : 'requested ' + relTime(o.requestedAt) + ' by ' + esc(userName(o.requestedBy))}${o.status === 'COMPLETED' ? ` · done by ${esc(userName(o.performedBy))} ${fmtDateTime(o.performedAt).split(', ')[1]}${o.notes ? ' — ' + esc(o.notes) : ''}` : ''}</small></div>
        <div class="wr-meta"><span class="tag tag-${a.tone}">${a.label}</span><small class="muted">${icon('clock', 'ic-inline')} ${relTime(o.billedAt || o.requestedAt)}</small></div>
        <div class="wr-act">${tab === 'ready' && can('service.work') ? `<button class="btn btn-primary btn-sm" data-done="${o.id}">${icon('check')}Mark done</button>` : tab === 'req' && (can('service.request')) ? `<button class="btn btn-ghost btn-sm" data-wd="${o.id}">Withdraw</button>` : tab === 'req' && can('hbill.create') ? `<a class="btn btn-primary btn-sm" href="#/hbill?patient=${o.patientId}">Bill now</a>` : ''}</div></div>`; }).join('')}</div>`
      : emptyState('check-circle-2', 'Nothing here', tab === 'ready' ? 'Billed services appear here automatically.' : '');
    view.querySelectorAll('[data-done]').forEach((b) => { b.onclick = () => { const o = store.get('orders', b.dataset.done);
      openModal({ title: `Mark done — ${o.name}`, subtitle: esc(patientOf(o.patientId).name), size: 'sm', body: `<div class="field"><label>Notes / findings</label><textarea class="input" rows="3" data-n placeholder="${o.category === 'ECG' ? 'e.g. Normal sinus rhythm — report given to doctor' : o.category === 'INJECTION' ? 'e.g. Inj. Monocef 1 g IV given, no reaction' : 'e.g. Done, patient stable'}"></textarea></div>`,
        footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Done', cls: 'btn-primary', icon: 'check', onClick: (c, w) => { try { completeService(o.id, w.querySelector('[data-n]').value, user); c(); toast(`${o.name} completed.`); draw(); } catch (e) { toast(e.message, 'error'); } } }] }); }; });
    view.querySelectorAll('[data-wd]').forEach((b) => { b.onclick = async () => { const r = await confirmDialog({ title: 'Withdraw request?', reason: true, reasonLabel: 'Reason', confirmLabel: 'Withdraw', tone: 'danger', message: 'Use this only if the doctor cancelled the service.' }); if (!r) return; cancelRequest(b.dataset.wd, r.reason, user); toast('Request withdrawn.'); draw(); }; });
    refreshIcons(view);
  };
  view.querySelector('[data-q]').addEventListener('input', draw);
  view.querySelector('[data-req]')?.addEventListener('click', () => openRequest(draw));
  const unsub = store.subscribe(draw);
  draw();
  return () => unsub();
}

export function openRequest(done, presetPatient) {
  const user = currentUser(); let pid = presetPatient || '';
  const opts = store.all('services').filter((s) => s.active && (can('lab.work') ? true : s.category !== 'LAB'));
  openModal({ title: 'Record doctor-advised services', subtitle: 'They are sent to the main counter for billing', size: 'md',
    body: `<div class="field"><label>Patient</label><div data-p></div></div><div class="field mt-1"><label>Doctor</label><input class="input" data-d list="sr-docs" placeholder="Advising doctor"><datalist id="sr-docs">${(store.ph().doctors || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div class="field mt-1"><label>Services</label><div class="svc-pick">${opts.map((s) => `<label class="check"><input type="checkbox" value="${s.id}"> ${icon(catIcon(s.category), 'ic-inline')} ${esc(s.name)} <span class="muted small">${fmtINR(s.price, true)}</span></label>`).join('')}</div></div>
      <div class="field mt-1"><label>Note</label><input class="input" data-n placeholder="Optional"></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Send for billing', cls: 'btn-primary', icon: 'send', onClick: (c, w) => { try { requestServices({ patientId: pid, serviceIds: [...w.querySelectorAll('.svc-pick input:checked')].map((i) => i.value), doctor: w.querySelector('[data-d]').value, note: w.querySelector('[data-n]').value }, user); c(); toast('Sent to the main counter for billing.'); done?.(); } catch (e) { toast(e.message, 'error'); } } }],
    onOpen: (w) => { combo(w.querySelector('[data-p]'), { value: pid, options: () => store.all('patients').map((p) => ({ value: p.id, label: p.name, sub: `${p.uhid} · ${p.phone}`, keywords: p.uhid + p.phone })), placeholder: 'Search patient…', onChange: (v) => { pid = v; } }); } });
}

/** Requested → billed → cleared → completed (used in Reports and the management dashboard). */
export function renderRecon(view) {
  let from = ymd(new Date(Date.now() - 6 * 86400000)); let to = ymd();
  view.innerHTML = `<p class="page-intro">Every service a doctor advises should be billed, and every billed service should be done. Gaps here are revenue leakage or patients still waiting.</p><section class="card"><div class="toolbar"><label class="small">From <input type="date" class="input" data-from value="${from}"></label><label class="small">To <input type="date" class="input" data-to value="${to}"></label><button class="btn btn-secondary btn-sm" data-csv>${icon('download')}CSV</button></div><div data-b></div></section>`;
  const draw = () => {
    const r = serviceReconciliation(from, to);
    view.querySelector('[data-b]').innerHTML = `<div class="table-scroll"><table class="table"><thead><tr><th>Department</th><th class="ta-right">Requested / ordered</th><th class="ta-right">Not billed</th><th class="ta-right">Billed</th><th class="ta-right">Paid / approved</th><th class="ta-right">Completed</th><th class="ta-right">Still to do</th><th class="ta-right">Billed value</th></tr></thead><tbody>
      ${r.rows.map((x) => `<tr><td><strong>${icon(catIcon(x.category), 'ic-inline')} ${catLabel(x.category)}</strong></td><td class="ta-right">${x.requested}</td><td class="ta-right ${x.unbilled ? 'text-danger strong' : ''}">${x.unbilled || '—'}</td><td class="ta-right">${x.billed}</td><td class="ta-right">${x.cleared}</td><td class="ta-right">${x.completed}</td><td class="ta-right ${x.pending ? 'text-warning strong' : ''}">${x.pending || '—'}</td><td class="ta-right">${fmtINR(x.value, true)}</td></tr>`).join('')}</tbody></table></div>
      ${r.unbilled.length ? `<div class="card-pad"><div class="section-title">Advised but not billed</div><div class="todo-list">${r.unbilled.map((o) => `<a class="todo" href="#/hbill?patient=${o.patientId}"><span class="todo-ic sev-critical">${icon(catIcon(o.category))}</span><span class="todo-txt"><strong>${esc(o.name)} — ${esc(patientOf(o.patientId)?.name)}</strong><small>${esc(o.doctor || '')} · ${fmtDateTime(o.requestedAt)} · by ${esc(userName(o.requestedBy))}</small></span><span class="btn btn-secondary btn-sm">Bill</span></a>`).join('')}</div></div>` : ''}`;
    view.querySelector('[data-csv]').onclick = () => exportTable(`service-reconciliation-${from}-${to}.csv`, [{ label: 'Department', csv: (x) => catLabel(x.category) }, ...['requested', 'unbilled', 'billed', 'cleared', 'completed', 'pending', 'value'].map((k) => ({ label: k, key: k }))], r.rows);
    refreshIcons(view);
  };
  view.querySelector('[data-from]').onchange = (e) => { from = e.target.value; draw(); }; view.querySelector('[data-to]').onchange = (e) => { to = e.target.value; draw(); };
  draw();
}
