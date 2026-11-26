// Lab workbench (#/lab) — the lab technician's home, as a split screen:
//   left  — the patients waiting at the chosen step (Collect · Receive · Results · Verify · Send)
//   right — the selected patient, where the work is done (sid.js → mountSid)
// One scan box on top: scanning a tube collects or receives it; scanning a SID opens that patient.
// Keys: / scan · ↑ ↓ patient · 1–5 step.
import { store } from '../../data-service.js';
import { currentUser, can } from '../../auth.js';
import { reportReadyAt, collectTube } from '../../labflow.js';
import { businessDate } from '../../pharmacy-calc.js';
import { openModal } from '../../components.js';
import { toast } from '../../notifications.js';
import { esc } from '../../utils.js';
import { icon, emptyState } from './bi.js';
import { STAGES, POINTS, stageById, stageOf, onHold, scanTarget, codesOf } from './stages.js';
import { receiveCodes } from './collect.js';
import { pat, dur, minsSince, priPill, critPill, liveOrders, avatar, placeTag, ageSex } from './ui.js';
import { isCritical } from '../../hospital.js';
import { mountSid } from './sid.js';

export function renderWorkbench(view, params, query) {
  let stage = stageById(query.stage || query.tab).id;
  let point = 'all';
  let sel = query.v || null;
  let panel = null; // { cleanup, focusFirst } of the mounted patient
  let mountedId = null;
  if (sel) { const v0 = store.get('labVisits', sel); if (v0 && stageOf(v0) && !stageById(stage).select('').some((x) => x.id === sel)) stage = stageOf(v0); }

  view.innerHTML = `<div class="l2 l2-wb">
    <header class="l2-top">
      <div class="l2-title"><h1>Lab Workbench</h1><p data-today></p></div>
      <label class="l2-scan">${icon('scan-barcode')}<input data-scan autocomplete="off" placeholder="Scan a tube or SID, or search name, token, mobile"><kbd>/</kbd></label>
      <div class="l2-tools"><span data-hold></span>${can('lab.order.ip') ? `<a class="btn btn-secondary" href="#/lab/ward-order">${icon('bed-double')}Ward order</a>` : ''}<a class="btn btn-secondary" href="#/lab/display" target="_blank" title="Open the token screen for the waiting area">${icon('monitor')}Token screen</a></div>
    </header>
    <nav class="l2-steps" data-steps aria-label="Lab steps"></nav>
    <div class="l2-split" data-split>
      <section class="l2-card l2-list"><div class="l2-chips" data-points></div><div class="l2-rows" data-rows></div></section>
      <section class="l2-card l2-panel" data-panel></section>
    </div></div>`;
  const scan = view.querySelector('[data-scan]');
  const q = () => scan.value.trim().toLowerCase();
  const items = () => stageById(stage).select(q(), point);

  const fit = () => { const s = view.querySelector('[data-split]'); if (s) s.style.height = `${Math.max(520, window.innerHeight - s.getBoundingClientRect().top - 20)}px`; };

  const drawTop = () => {
    const today = businessDate();
    const done = store.all('labVisits').filter((v) => reportReadyAt(v) && businessDate(reportReadyAt(v)) === today);
    const avg = done.length ? Math.round(done.reduce((t, v) => t + minsSince(v.createdAt, reportReadyAt(v)), 0) / done.length) : 0;
    view.querySelector('[data-today]').innerHTML = `${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · <b>${done.length}</b> report${done.length === 1 ? '' : 's'} today${avg ? ` · avg <b>${dur(avg)}</b>` : ''}`;
    const hold = onHold();
    view.querySelector('[data-hold]').innerHTML = hold.length ? `<button class="btn btn-secondary l2-warnbtn" data-hold-btn>${icon('lock')}${hold.length} waiting for payment</button>` : '';
    view.querySelector('[data-hold-btn]')?.addEventListener('click', showHold);
  };
  const drawSteps = () => {
    view.querySelector('[data-steps]').innerHTML = STAGES.map((s) => { const n = s.count(); const stat = s.select('').some((v) => v.priority === 'STAT');
      return `<button class="l2-step ${s.id === stage ? 'on' : ''}" data-stage="${s.id}" title="Step ${s.n} · press ${s.n}">${icon(s.icon)}${esc(s.label)}<span class="l2-badge ${stat && s.id !== stage ? 'red' : ''}">${n}</span></button>`; }).join('');
    view.querySelectorAll('[data-stage]').forEach((b) => { b.onclick = () => go(b.dataset.stage); });
  };
  const drawList = () => {
    const s = stageById(stage); const list = items();
    if (!list.some((v) => v.id === sel)) sel = list[0]?.id || null;
    view.querySelector('[data-points]').innerHTML = POINTS.map((p) => `<button class="l2-chipbtn ${p.id === point ? 'on' : ''}" data-point="${p.id}">${esc(p.label)}<span>${s.count(p.id)}</span></button>`).join('')
      + (stage === 'receive' && list.length > 1 && can('lab.work') ? `<button class="l2-chipbtn l2-right" data-recv-all>${icon('check-check')}Receive all</button>` : '');
    view.querySelector('[data-rows]').innerHTML = list.length ? list.map((v) => { const p = pat(v.patientId); const m = minsSince(s.since(v) || v.createdAt); const line = s.line(v);
      return `<div class="l2-row ${v.id === sel ? 'sel' : ''}" data-id="${v.id}" tabindex="-1">${avatar(p.name)}
        <div class="l2-rm"><div class="l2-rn"><b>${esc(p.name)}</b><small>${esc(ageSex(p).replace(' · ', ' '))}</small></div>
          <div class="l2-rs">${placeTag(v)}${codesOf(v).slice(0, 4).map((c) => `<span class="l2-tag code">${esc(c)}</span>`).join('')}${codesOf(v).length > 4 ? `<span class="l2-tag">+${codesOf(v).length - 4}</span>` : ''}</div>
          ${line ? `<div class="l2-rl">${line}</div>` : ''}</div>
        <div class="l2-rr">${priPill(v)}${stage !== 'verify' && liveOrders(v).some(isCritical) ? critPill() : ''}<span class="l2-wait ${m > s.late ? 'late' : ''}">${icon('clock')}${dur(m)}</span></div></div>`; }).join('')
      : (q() ? emptyState('search-x', 'No match', `Nobody at “${esc(s.label)}” matches “${esc(scan.value.trim())}”.`) : emptyState(...s.empty));
    view.querySelectorAll('[data-point]').forEach((b) => { b.onclick = () => { point = b.dataset.point; drawList(); drawPanel(); }; });
    view.querySelector('[data-recv-all]')?.addEventListener('click', () => { const codes = list.flatMap((v) => v.tubes.filter((t) => t.collectedAt && !t.receivedAt).map((t) => t.code)); receiveCodes(codes); });
    view.querySelectorAll('.l2-row').forEach((r) => { r.onclick = () => select(r.dataset.id); });
  };
  const drawPanel = (focus = false) => {
    if (sel === mountedId && panel) { if (focus && stage === 'results') panel.focusFirst(); return; }
    panel?.cleanup(); panel = null; mountedId = sel;
    const host = view.querySelector('[data-panel]');
    if (!sel) { host.innerHTML = `<div class="l2-scroll">${emptyState('user-round', 'No patient selected', 'Pick a patient on the left, or scan a tube.')}</div>`; return; }
    panel = mountSid(host, sel, { step: focus ? stage : null });
  };
  const select = (id, focus = true) => {
    sel = id; history.replaceState(null, '', `#/lab?stage=${stage}&v=${id}`);
    view.querySelectorAll('.l2-row').forEach((r) => r.classList.toggle('sel', r.dataset.id === id));
    view.querySelector('.l2-row.sel')?.scrollIntoView({ block: 'nearest' });
    drawPanel(focus);
  };
  const go = (id, keepSel = false) => { stage = id; point = 'all'; if (!keepSel) sel = null; drawSteps(); drawList(); drawPanel(); history.replaceState(null, '', `#/lab?stage=${stage}${sel ? `&v=${sel}` : ''}`); };
  const draw = () => { drawTop(); drawSteps(); drawList(); drawPanel(); };

  const showHold = () => {
    const hs = onHold();
    openModal({ title: 'Waiting for payment', subtitle: 'Do not collect these samples. Send the patient to the main counter.', size: 'md',
      body: `<div class="l2-holdlist">${hs.map((v) => `<a href="#/lab/visit/${v.id}">${avatar(pat(v.patientId).name)}<b>${esc(pat(v.patientId).name)}</b><span class="mono">SID ${v.sid}</span><span class="l2-muted">${esc(v.billId || '')}</span></a>`).join('')}</div>`,
      footer: [{ label: 'Close', onClick: (c) => c() }] });
  };

  // ----- scan box -----
  scan.addEventListener('input', () => { drawList(); drawPanel(); });
  scan.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { scan.value = ''; scan.blur(); drawList(); drawPanel(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); scan.blur(); move(1); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = scanTarget(scan.value);
    if (!t) { const l = items(); if (l.length) { const id = l[0].id; scan.value = ''; drawList(); select(id); } else toast('No tube, SID or patient matches that.', 'error'); return; }
    scan.value = '';
    if (t.kind === 'collect' && can('lab.work')) { try { collectTube(t.v.id, t.code, currentUser()); toast(`${t.code} collected.`); } catch (err) { toast(err.message, 'error'); } }
    else if (t.kind === 'receive' && can('lab.work')) receiveCodes([t.code]);
    const st = stageOf(t.v) || stage; sel = t.v.id; go(st, true); scan.focus();
  });
  const move = (d) => { const l = items(); const i = l.findIndex((v) => v.id === sel); const n = l[Math.max(0, Math.min(l.length - 1, i + d))]; if (n) select(n.id, false); };
  const onKey = (e) => {
    if (!view.isConnected) return;
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.querySelector('.modal-backdrop, .l2-drawer-wrap');
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); scan.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key >= '1' && e.key <= '5') { e.preventDefault(); go(STAGES[+e.key - 1].id); }
    else if (e.key === 'Enter' && stage === 'results' && panel && document.activeElement?.tagName !== 'BUTTON' && document.activeElement?.tagName !== 'A') { e.preventDefault(); panel.focusFirst(); }
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', fit);
  const unsub = store.subscribe(() => { drawTop(); drawSteps(); drawList(); drawPanel(); });
  draw(); fit();
  return () => { unsub(); panel?.cleanup(); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', fit); document.querySelector('.l2-drawer-wrap')?.remove(); };
}
