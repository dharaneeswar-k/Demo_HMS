// Lab workbench (#/lab) — the lab technician's home. One scan box at the top, the five lab steps as a numbered
// flow with live counts, and the list for the chosen step underneath. Every row has a single main button.
import { store } from '../../data-service.js';
import { currentUser, can } from '../../auth.js';
import { reportReadyAt, deliverReport } from '../../labflow.js';
import { businessDate } from '../../pharmacy-calc.js';
import { emptyState } from '../../components.js';
import { toast } from '../../notifications.js';
import { esc, icon, refreshIcons } from '../../utils.js';
import { STAGES, stageById, onHold, scanTarget } from './stages.js';
import { openCollection, rejectTubeDialog, receiveCodes, callPatient } from './collect.js';
import { pat, dur, minsSince } from './ui.js';

export function renderWorkbench(view, params, query) {
  let stage = stageById(query.stage || query.tab).id;
  let filter = 'all';
  view.innerHTML = `<div class="lw">
    <div class="lw-top">
      <label class="lw-scan">${icon('scan-barcode')}<input data-scan autocomplete="off" placeholder="Scan a tube or SID — or type a patient name, mobile or token"><kbd>Enter</kbd></label>
      <div class="lw-tools">${can('lab.order.ip') ? `<a class="btn btn-secondary" href="#/lab/ward-order">${icon('bed-double')}Ward order</a>` : ''}<a class="btn btn-ghost" href="#/lab/display" target="_blank" title="Open the token screen for the waiting area">${icon('monitor')}Token screen</a></div>
    </div>
    <div class="lw-today" data-today></div>
    <nav class="lw-flow" data-flow aria-label="Lab steps"></nav>
    <section class="lw-panel" data-panel></section></div>`;
  const scan = view.querySelector('[data-scan]');
  const q = () => scan.value.trim().toLowerCase();

  const drawToday = () => {
    const today = businessDate();
    const done = store.all('labVisits').filter((v) => reportReadyAt(v) && businessDate(reportReadyAt(v)) === today);
    const avg = done.length ? Math.round(done.reduce((t, v) => t + minsSince(v.createdAt, reportReadyAt(v)), 0) / done.length) : 0;
    const hold = onHold();
    view.querySelector('[data-today]').innerHTML = `<span>${icon('sun')}Today</span><b>${done.length}</b> report${done.length === 1 ? '' : 's'} finished${avg ? `<i></i>average <b>${dur(avg)}</b> from bill to report` : ''}${hold.length ? `<i></i><button class="lw-hold" data-hold>${icon('lock')}${hold.length} waiting for payment</button>` : ''}`;
    view.querySelector('[data-hold]')?.addEventListener('click', () => showHold());
  };
  const drawFlow = () => {
    view.querySelector('[data-flow]').innerHTML = STAGES.map((s) => { const n = s.select('').length;
      return `<button class="lw-step ${s.id === stage ? 'active' : ''} ${n ? '' : 'zero'}" data-stage="${s.id}"><span class="lw-num">${s.n}</span><span class="lw-step-txt"><small>Step ${s.n}</small><strong>${esc(s.label)}</strong></span><span class="lw-count">${n}</span></button>`; }).join('');
    view.querySelectorAll('[data-stage]').forEach((b) => { b.onclick = () => go(b.dataset.stage); });
  };
  const drawPanel = () => {
    const s = stageById(stage); const items = s.select(q(), filter);
    const P = view.querySelector('[data-panel]');
    P.innerHTML = `<header class="lw-head"><div class="lw-head-txt"><span class="lw-head-ic">${icon(s.icon)}</span><div><h2>${esc(s.title)} <span class="lw-head-n">${items.length}</span></h2><p>${esc(s.hint)}</p></div></div>
        <div class="lw-head-act">${s.bulk ? s.bulk(items) : ''}${s.id === 'send' ? `<a class="btn btn-ghost btn-sm" href="#/lab/reports">${icon('history')}All reports</a>` : ''}</div></header>
      ${s.filters ? `<div class="lw-filters">${s.filters.map((f) => `<button class="lw-filter ${f.id === filter ? 'active' : ''}" data-filter="${f.id}">${f.icon ? icon(f.icon) : ''}${esc(f.label)}<span>${s.filterCount(f.id)}</span></button>`).join('')}</div>` : ''}
      <div class="lx-list">${items.length ? items.map(s.row).join('') : emptyState(...(q() ? ['search-x', 'No match', `Nothing in “${esc(s.label)}” matches “${esc(scan.value.trim())}”.`] : s.empty))}</div>`;
    wire(P);
    refreshIcons(view);
  };
  const draw = () => { drawToday(); drawFlow(); drawPanel(); };
  const go = (id) => { stage = id; filter = 'all'; history.replaceState(null, '', `#/lab?stage=${id}`); draw(); };

  const wire = (P) => {
    P.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { filter = b.dataset.filter; drawPanel(); }; });
    P.querySelectorAll('[data-call]').forEach((b) => { b.onclick = () => callPatient(b.dataset.call); });
    P.querySelectorAll('[data-collect]').forEach((b) => { b.onclick = () => openCollection(b.dataset.collect); });
    P.querySelectorAll('[data-receive]').forEach((b) => { b.onclick = () => receiveCodes([b.dataset.receive]); });
    P.querySelectorAll('[data-reject]').forEach((b) => { b.onclick = () => rejectTubeDialog(b.dataset.reject); });
    P.querySelector('[data-recv-all]')?.addEventListener('click', () => receiveCodes(stageById('receive').select(q()).map((x) => x.t.code)));
    P.querySelectorAll('[data-wa]').forEach((b) => { b.onclick = () => { try { const out = deliverReport(b.dataset.wa, 'WHATSAPP', {}, currentUser()); if (out.url) { window.open(out.url, '_blank'); toast('WhatsApp opened with the message — press Send.', 'info'); } else toast('Queued — the hospital server sends it with the PDF.'); } catch (e) { toast(e.message, 'error'); } }; });
  };
  const showHold = () => {
    const hs = onHold();
    import('../../components.js').then(({ openModal }) => openModal({ title: 'Waiting for payment', subtitle: 'Do not collect these samples. Send the patient to the main counter.', size: 'md',
      body: `<div class="lx-list compact">${hs.map((v) => `<a class="lx-hold-row" href="#/lab/visit/${v.id}"><strong>${esc(pat(v.patientId).name)}</strong><span class="mono">SID ${v.sid}</span><span>${esc(v.billId || '')}</span></a>`).join('')}</div>`,
      footer: [{ label: 'Close', onClick: (c) => c() }] }));
  };

  scan.addEventListener('input', drawPanel);
  scan.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { scan.value = ''; drawPanel(); return; }
    if (e.key !== 'Enter') return;
    const t = scanTarget(scan.value);
    if (!t) { const s = stageById(stage).select(q(), filter); if (s.length === 1 && stage !== 'receive') location.hash = `#/lab/visit/${s[0].id}`; else if (!s.length) toast('No tube, SID or patient matches that.', 'error'); return; }
    if (t.kind === 'receive' && can('lab.work')) { scan.value = ''; if (!receiveCodes([t.code])) scan.value = t.code; drawPanel(); scan.focus(); return; }
    location.hash = `#/lab/visit/${t.v.id}`;
  });
  const unsub = store.subscribe(draw);
  draw(); setTimeout(() => scan.focus(), 60);
  return () => unsub();
}
