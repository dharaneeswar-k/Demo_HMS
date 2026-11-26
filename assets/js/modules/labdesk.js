// Lab print & desk pages — barcode labels and request sheet, the combined SID report, the report desk (history and
// search), the waiting-room token display and the ward order form. The working screens live in ./lab/
// (workbench = the five steps, sid = one patient's visit, collect = the collection dialog).
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { userName } from '../calculations.js';
import { svc, labParams, flagFor, refText, isCritical, markPrinted, hbillBalance } from '../hospital.js';
import { SOURCE, PRIORITY, VSTATUS, containers, visit, visitOrders, visitAccess, visitStatus, reportReadyAt, isUncollected, tubesFor, priorityRank, findBySid, tubeOf,
  callToken, collectTube, receiveTube, rejectTube, deliverReport, handOver, createIpOrder, criticalInVisit } from '../labflow.js';
import { CHANNEL_LABEL, STATUS_LABEL } from '../messaging.js';
import { businessDate } from '../pharmacy-calc.js';
import { patientAge } from '../patients.js';
import { attachmentURL } from '../attachment-store.js';
import { badge, dataTable, openModal, confirmDialog, kpi, tabs, combo, exportTable } from '../components.js';
import { toast } from '../notifications.js';
import { barcodeSVG } from '../barcode.js';
import { letterhead, docMeta, signBlock } from '../docs.js';
import { setMeta } from '../app.js';
import { esc, fmtNum, fmtDate, fmtDateTime, relTime, refreshIcons, ymd } from '../utils.js';
import { icon, emptyState } from './lab/bi.js';

const pat = (id) => store.get('patients', id);
const srcTag = (v) => `<span class="tag tag-${SOURCE[v.source].tone}">${icon(SOURCE[v.source].icon, 'ic-inline')} ${SOURCE[v.source].short}</span>`;
const prTag = (v) => (v.priority === 'ROUTINE' ? '' : `<span class="tag tag-${PRIORITY[v.priority].tone} strong">${PRIORITY[v.priority].label}</span>`);
const vBadge = (v) => { const [l, t] = VSTATUS[visitStatus(v)]; return `<span class="badge badge-${t}"><span class="dot"></span>${l}</span>`; };
const tubeChip = (t) => { const c = containers()[t.container]; return `<span class="tube-chip" style="--tc:${c.color}"><i></i>${esc(c.label.split(' — ')[0])}</span>`; };
const mins = (a, b = new Date().toISOString()) => Math.round((new Date(b) - new Date(a)) / 60000);
const ageTxt = (m) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${Math.floor(m / 1440)} d`);
const byQueue = (a, b) => priorityRank(a) - priorityRank(b) || (a.token || 0) - (b.token || 0) || a.createdAt.localeCompare(b.createdAt);

// =====================================================================================================
export function renderLabels(view, params) {
  const v = visit(params.id); if (!v) { view.innerHTML = emptyState('tag', 'Not found'); return; }
  const p = pat(v.patientId); const s = store.settings();
  setMeta({ title: `Labels — SID ${v.sid}`, crumbs: [{ label: 'Laboratory', href: '#/lab' }, 'Labels'] });
  view.innerHTML = `<div class="row mb-2 no-print" style="justify-content:center"><button class="btn btn-primary" data-print>${icon('printer')}Print labels & request sheet</button></div>
    <div class="label-sheet">${tubesFor(v).filter((t) => t.orders.some((o) => o.status !== 'CANCELLED')).map((t) => `<div class="tube-label"><div class="tl-top"><strong>${esc(p.name.slice(0, 22))}</strong><span>${patientAge(p) ?? '—'}${esc(p.gender)}</span></div>
      ${barcodeSVG(t.code, { height: 34 })}<div class="tl-code mono">${t.code}</div><div class="tl-bot"><span>${esc(t.orders.map((o) => svc(o.serviceId).code).join(' · '))}</span><span class="tl-c" style="--tc:${containers()[t.container].color}">${esc(t.container)}</span></div>
      <div class="tl-bot"><span>${esc(p.uhid)}</span><span>${fmtDate(v.createdAt)}${v.priority !== 'ROUTINE' ? ' · ' + v.priority : ''}</span></div></div>`).join('')}</div>
    <article class="doc mt-2">${letterhead('LAB REQUEST SHEET', { sub: SOURCE[v.source].label, code: v.sid })}
      ${docMeta([['Patient', esc(p.name)], ['Patient ID', `<span class="mono">${esc(p.uhid)}</span>`], ['Age / Sex', `${patientAge(p) ?? '—'} Y / ${esc(p.gender)}`], ['Mobile', esc(p.phone)], ['Doctor', esc(v.doctor || 'Self')], ['Priority', PRIORITY[v.priority].label], ['Requested', fmtDateTime(v.createdAt)], [v.ipNo ? 'Ward / bed' : 'Token', v.ipNo ? `${esc(v.ward)} ${esc(v.bed)}` : String(v.token || '—')]])}
      <table class="rc-table"><thead><tr><th>Tube</th><th>Container</th><th>Tests</th><th>Collected by / time</th></tr></thead><tbody>${tubesFor(v).map((t) => `<tr><td class="mono">${t.code}</td><td>${esc(containers()[t.container].label)}</td><td>${t.orders.map((o) => esc(o.name)).join('<br>')}</td><td>${t.collectedAt ? esc(userName(t.collectedBy)) + ' · ' + fmtDateTime(t.collectedAt) : ''}</td></tr>`).join('')}</tbody></table>
      ${v.clinicalNotes ? `<p class="mt-2"><strong>Clinical notes:</strong> ${esc(v.clinicalNotes)}</p>` : ''}${signBlock([['Collected by', ''], ['Received in lab', '']])}</article>`;
  view.querySelector('[data-print]').onclick = () => window.print();
  refreshIcons(view);
}

export function renderVisitReport(view, params) {
  const user = currentUser(); const v = visit(params.id); if (!v) { view.innerHTML = emptyState('file-x', 'Not found'); return; }
  const p = pat(v.patientId); const os = visitOrders(v).filter((o) => o.status === 'COMPLETED'); const pending = visitOrders(v).filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status));
  if (!os.length) { view.innerHTML = emptyState('hourglass', 'No verified results yet', 'The report is available after verification.'); return; }
  setMeta({ title: `Report — SID ${v.sid}`, crumbs: [{ label: 'Laboratory', href: '#/lab' }, { label: 'SID ' + v.sid, href: `#/lab/visit/${v.id}` }, 'Report'] });
  const depts = [...new Set(os.map((o) => svc(o.serviceId).lab.department))];
  const first = (k) => os.map((o) => o.lab[k]).filter(Boolean).sort()[0]; const last = (k) => os.map((o) => o.lab[k]).filter(Boolean).sort().at(-1);
  view.innerHTML = `<div class="row mb-2 no-print" style="justify-content:center"><button class="btn btn-primary" data-print>${icon('printer')}Print / Save PDF</button><a class="btn btn-ghost" href="#/lab/visit/${v.id}">${icon('arrow-left')}SID ${v.sid}</a></div>
    <article class="doc">${letterhead(pending.length ? 'LABORATORY REPORT (PARTIAL)' : 'LABORATORY REPORT', { sub: depts.join(' · '), code: v.sid })}
      ${docMeta([['Patient', esc(p.name)], ['Patient ID', `<span class="mono">${esc(p.uhid)}</span>`], ['Age / Sex', `${patientAge(p) ?? '—'} Y / ${esc(p.gender)}`], ['Referred by', esc(v.doctor || 'Self')],
        ['SID', `<span class="mono">${v.sid}</span>`], ['Collected', fmtDateTime(first('collectedAt'))], ['Reported', fmtDateTime(last('verifiedAt'))], [v.ipNo ? 'IP no / bed' : 'Patient type', v.ipNo ? `${esc(v.ipNo)} · ${esc(v.bed)}` : SOURCE[v.source].short]])}
      ${os.map((o) => `<h3 class="doc-h">${esc(o.name)} <small class="muted">· ${esc(o.lab.sampleType)}${svc(o.serviceId)?.lab?.method ? ' · Method: ' + esc(svc(o.serviceId).lab.method) : ''} · ${o.lab.reportNo}</small></h3>
        <table class="rc-table lab-rep"><thead><tr><th>Investigation</th><th>Result</th><th>Unit</th><th>Biological reference interval</th></tr></thead><tbody>
        ${labParams(o).map((q) => { const val = o.lab.results.find((r) => r.param === q.name)?.value; const f = flagFor(q, val); return `<tr class="${f ? 'abn' : ''}"><td>${esc(q.name)}</td><td><strong>${esc(val ?? '—')}</strong> ${f ? `<span class="rep-flag">${f === 'A' ? '*' : f}${f.length === 2 ? ' (critical)' : ''}</span>` : ''}</td><td>${esc(q.unit)}</td><td>${esc(refText(q))}</td></tr>`; }).join('')}</tbody></table>${svc(o.serviceId)?.lab?.note ? `<p class="rc-small" style="text-align:left">Note: ${esc(svc(o.serviceId).lab.note)}</p>` : ''}`).join('')}
      ${pending.length ? `<p class="rep-pending">Pending: ${pending.map((o) => esc(o.name)).join(', ')} — will follow in a separate report.</p>` : ''}
      <p class="rc-small mt-2" style="text-align:left">H = above range · L = below range · HH / LL = critical · * = abnormal finding. Results relate only to the sample received. Please correlate clinically.</p>
      ${signBlock([['Lab technician', userName(os[0].lab.enteredBy)], ['Verified by', userName(os.at(-1).lab.verifiedBy)]])}
      <p class="rc-thanks">— End of report —</p></article>`;
  view.querySelector('[data-print]').onclick = () => { os.forEach((o) => markPrinted(o.id)); window.print(); };
  refreshIcons(view);
}
/** Older links to a single-test report open the combined SID report. */
export function renderOrderReport(view, params) { const o = store.get('orders', params.id); const v = o?.labVisitId; if (v) { location.replace(`#/lab/visit/${v}/report`); return; } view.innerHTML = emptyState('file-x', 'Report not found'); }

// =====================================================================================================
export function renderReportDesk(view, params, query) {
  let tab = query.tab || 'ready';
  view.innerHTML = `<section class="card"><div class="row-between card-pad"><div data-tabs></div><div class="row"><div class="input-icon" style="width:280px">${icon('search')}<input class="input" data-q placeholder="SID, patient, mobile, Patient ID"></div><button class="btn btn-secondary btn-sm" data-csv>${icon('download')}CSV</button></div></div><div data-t></div></section>`;
  const cols = [
    { key: 'sid', label: 'SID', render: (v) => `<span class="mono strong">${v.sid}</span><div class="cell-sub">${fmtDateTime(v.createdAt)}</div>` },
    { key: 'patient', label: 'Patient', value: (v) => pat(v.patientId).name, render: (v) => `${esc(pat(v.patientId).name)}<div class="cell-sub">${esc(pat(v.patientId).phone)}</div>` },
    { key: 'tests', label: 'Tests', sortable: false, render: (v) => `<span class="small">${esc(visitOrders(v).map((o) => svc(o.serviceId).code).join(', '))}</span>${criticalInVisit(v) ? ' <span class="tag tag-danger">Critical</span>' : ''}`, csv: (v) => visitOrders(v).map((o) => o.name).join('; ') },
    { key: 'source', label: 'Came as', render: (v) => srcTag(v), csv: (v) => SOURCE[v.source].short }, { key: 'doctor', label: 'Doctor' },
    { key: 'ready', label: 'Ready', value: (v) => reportReadyAt(v) || '', render: (v) => (reportReadyAt(v) ? fmtDateTime(reportReadyAt(v)) : '—') },
    { key: 'sent', label: 'Delivered', sortable: false, render: (v) => v.deliveries.map((d) => `<span class="tag tag-neutral">${CHANNEL_LABEL[d.channel].split(' ')[0]}${d.toDoctor ? ' (Dr)' : ''}</span>`).join(' ') || '—', csv: (v) => v.deliveries.map((d) => d.channel).join('; ') },
    { key: 'status', label: 'Status', value: (v) => visitStatus(v), render: (v) => `${vBadge(v)}${isUncollected(v) ? ' <span class="tag tag-danger">Not collected</span>' : ''}` }];
  const t = dataTable({ rows: [], pageSize: 15, sort: { key: 'ready', dir: 'desc' }, columns: cols, onRowClick: (v) => { location.hash = `#/lab/visit/${v.id}`; } });
  view.querySelector('[data-t]').appendChild(t.el);
  const draw = () => {
    const q = view.querySelector('[data-q]').value.trim().toLowerCase();
    const all = store.all('labVisits').filter((v) => reportReadyAt(v) || visitOrders(v).some((o) => o.status === 'COMPLETED')).filter((v) => { const p = pat(v.patientId); return !q || [v.sid, p.name, p.phone, p.uhid].join(' ').toLowerCase().includes(q); });
    const g = { ready: all.filter((v) => visitStatus(v) === 'READY'), partial: all.filter((v) => visitStatus(v) === 'PARTIAL'), sent: all.filter((v) => visitStatus(v) === 'SENT'), handed: all.filter((v) => visitStatus(v) === 'HANDED_OVER'), uncollected: all.filter(isUncollected), all };
    tabs(view.querySelector('[data-tabs]'), [{ id: 'ready', label: 'Ready to send', icon: icon('send'), count: g.ready.length }, { id: 'partial', label: 'Partial', icon: icon('hourglass'), count: g.partial.length || null }, { id: 'sent', label: 'Sent', icon: icon('message-circle'), count: g.sent.length },
      { id: 'handed', label: 'Handed over', icon: icon('hand'), count: g.handed.length }, { id: 'uncollected', label: 'Not collected', icon: icon('alert-triangle'), count: g.uncollected.length || null }, { id: 'all', label: 'All' }], tab, (x) => { tab = x; draw(); });
    t.setRows(g[tab]);
  };
  view.querySelector('[data-q]').addEventListener('input', draw);
  view.querySelector('[data-csv]').onclick = () => exportTable(`lab-reports-${ymd()}.csv`, cols, t.getRows());
  draw(); refreshIcons(view);
}

// =====================================================================================================
export function renderDisplay(view) {
  document.body.classList.add('token-mode');
  let lastNow = null; // token shown as "Now calling" last time, to flash when it changes
  const clock = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const draw = () => {
    const today = businessDate();
    // Only patients who were given a counter token today and still have to come to the collection room.
    // Never shown: ward (IP) orders — collected at the bedside — casualty, cancelled visits, unpaid bills, patients already collected.
    const vs = store.all('labVisits').filter((v) => v.tokenDay === today && v.token && v.collectionPoint === 'OPD' && v.source !== 'IP'
      && visitStatus(v) !== 'CANCELLED' && visitAccess(v).ok && tubesFor(v).some((t) => !t.collectedAt && t.orders.some((o) => o.status !== 'CANCELLED')));
    const called = vs.filter((v) => v.tokenStatus === 'CALLED').sort((a, b) => (b.calledAt || '').localeCompare(a.calledAt || ''));
    const waiting = vs.filter((v) => v.tokenStatus === 'WAITING').sort(byQueue);
    const now = called[0]; const MAX = 10; const more = waiting.length - MAX;
    const flash = now && now.token !== lastNow; lastNow = now?.token ?? null;
    view.innerHTML = `<div class="tb2">
      <header class="tb2-head"><div class="tb2-brand"><b>${esc(store.settings().hospitalName)}</b><span>Laboratory · Sample collection</span></div>
        <div class="tb2-clock" data-clock>${clock()}</div>
        <button class="tb2-fs" data-fs title="Full screen (F)">⛶ Full screen</button></header>
      <main class="tb2-main">
        <section class="tb2-now ${now ? '' : 'idle'} ${flash ? 'flash' : ''}">
          <span class="tb2-label">Now calling</span>
          ${now ? `<strong class="tb2-token">${now.token}</strong><p>Please come to the <b>sample collection room</b></p>`
            : `<i class="bi bi-hourglass-split tb2-idle" aria-hidden="true"></i><p>${waiting.length ? 'Please wait — your token will be called here' : 'No one is waiting right now'}</p>`}
          ${called.length > 1 ? `<div class="tb2-also"><span>Also called</span>${called.slice(1, 4).map((v) => `<b>${v.token}</b>`).join('')}</div>` : ''}
        </section>
        <section class="tb2-next">
          <span class="tb2-label">Next in line <em>${waiting.length}</em></span>
          <div class="tb2-list">${waiting.slice(0, MAX).map((v) => `<b class="${v.priority !== 'ROUTINE' ? 'pri' : ''}">${v.token}${v.priority !== 'ROUTINE' ? '<small>Priority</small>' : ''}</b>`).join('') || '<p class="tb2-empty">No tokens waiting</p>'}
            ${more > 0 ? `<b class="more">+${more}<small>more</small></b>` : ''}</div>
        </section>
      </main>
      <footer class="tb2-foot">Keep your bill with the SID number ready · Reports can be received on WhatsApp</footer></div>`;
    view.querySelector('[data-fs]').onclick = toggleFs;
  };
  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); };
  const onKey = (e) => { if (e.key === 'f' || e.key === 'F') toggleFs(); };
  const unsub = store.subscribe(draw);
  const tick = setInterval(() => { const c = view.querySelector('[data-clock]'); if (c) c.textContent = clock(); }, 5000);
  const timer = setInterval(draw, 30000); // the day can roll over and tokens age out even when nothing is saved
  document.addEventListener('keydown', onKey);
  draw();
  return () => { unsub(); clearInterval(timer); clearInterval(tick); document.removeEventListener('keydown', onKey); document.body.classList.remove('token-mode'); if (document.fullscreenElement) document.exitFullscreen?.(); };
}

// =====================================================================================================
export function renderWardOrder(view) {
  const user = currentUser();
  const admitted = store.all('medicalRecords').filter((r) => !r.dischargedAt && r.episodeType === 'IP');
  let rid = ''; const sel = new Set();
  view.innerHTML = `<p class="page-intro">For admitted patients. No payment at the counter — the tests are charged to the patient's IP account and settled with the final IP bill. The lab sees the order in <strong>Ward rounds</strong> with the ward and bed.</p>
    <div class="grid grid-3-1"><section class="card"><div class="card-body"><div class="form-grid">
      <div class="field col-12"><label>Admitted patient <span class="req">*</span></label><div data-p></div><p class="field-hint">${admitted.length} patient(s) in the wards. When the IP module goes live, its orders arrive here automatically.</p></div>
      <div class="field col-6"><label>Ordering doctor</label><input class="input" data-doc list="wo-docs"><datalist id="wo-docs">${(store.ph().doctors || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div class="field col-6"><label>Priority</label><div class="seg seg-full" data-pri>${Object.entries(PRIORITY).reverse().map(([k, x]) => `<button type="button" class="seg-btn ${k === 'ROUTINE' ? 'active' : ''}" data-v="${k}">${x.label}</button>`).join('')}</div></div>
      <div class="field col-12"><label>Tests</label><div class="svc-pick">${store.all('services').filter((s) => s.category === 'LAB' && s.active).map((s) => `<label class="check"><input type="checkbox" value="${s.id}"> ${esc(s.name)} <span class="muted small">${esc(containers()[s.lab.container].label.split(' — ')[0])}</span></label>`).join('')}</div></div>
      <div class="field col-12"><label>Clinical notes</label><input class="input" data-notes placeholder="e.g. Post-op day 1, fever spike"></div>
      <div class="field col-12"><label class="check wo-wa"><input type="checkbox" data-wa> ${icon('whatsapp')}Also send the report to the patient's WhatsApp <span class="muted small" data-wa-no>— choose a patient</span></label><p class="field-hint">The report always goes to the ward. Tick this to send a copy to the patient's (or attender's) mobile when it is verified.</p></div></div>
      <div class="row mt-2" style="justify-content:flex-end"><button class="btn btn-primary" data-save>${icon('send')}Send to lab</button></div></div></section>
      <section class="card"><header class="card-head"><h2>Today's ward orders</h2></header><div class="card-body" data-recent></div></section></div>`;
  let pri = 'ROUTINE';
  combo(view.querySelector('[data-p]'), { options: () => admitted.map((r) => ({ value: r.id, label: pat(r.patientId).name, sub: `${r.ipNo} · ${r.ward}` })), placeholder: admitted.length ? 'Search admitted patient…' : 'No admitted patients', onChange: (v) => { rid = v; const r = store.get('medicalRecords', v); view.querySelector('[data-doc]').value = r.doctor || ''; const ph = pat(r.patientId).phone; const wa = view.querySelector('[data-wa]'); wa.disabled = !ph; wa.checked = !!ph; view.querySelector('[data-wa-no]').textContent = ph ? `— ${ph}` : '— no mobile number on the patient record'; } });
  view.querySelectorAll('[data-pri] [data-v]').forEach((b) => { b.onclick = () => { pri = b.dataset.v; view.querySelectorAll('[data-pri] [data-v]').forEach((x) => x.classList.toggle('active', x === b)); }; });
  const recent = () => { view.querySelector('[data-recent]').innerHTML = store.all('labVisits').filter((v) => v.source === 'IP').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6).map((v) => `<a class="kv" href="#/lab/visit/${v.id}"><span>${esc(pat(v.patientId).name)}<small class="muted"> · ${esc(v.bed)}</small></span>${vBadge(v)}</a>`).join('') || '<p class="muted">None.</p>'; refreshIcons(view); };
  view.querySelector('[data-save]').onclick = () => {
    try { const v = createIpOrder({ recordId: rid, serviceIds: [...view.querySelectorAll('.svc-pick input:checked')].map((i) => i.value), doctor: view.querySelector('[data-doc]').value, priority: pri, notes: view.querySelector('[data-notes]').value, sendToPatient: view.querySelector('[data-wa]').checked }, user);
      toast(`SID ${v.sid} sent to the lab — ${v.ward} ${v.bed}. Charged to ${v.ipNo}.`); location.hash = `#/lab/visit/${v.id}`; } catch (e) { toast(e.message, 'error'); }
  };
  recent();
}
