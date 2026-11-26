// Lab worklist (#/lab) — the lab technician's home, in a plain hospital-software layout:
//   worklist  — one table of patients waiting at the chosen step (To collect · To receive · Enter results · To verify ·
//               Ready to send), one action button per row
//   patient   — click a row (or press Enter): patient banner, result grid, sample + visit side panel (sid.js → mountSid)
// One scan box on top: scanning a tube collects or receives it; scanning a SID opens that patient.
// Keys: / scan · ↑ ↓ row · Enter open · 1–5 step · Esc back to the worklist.
import { store } from '../../data-service.js';
import { currentUser, can } from '../../auth.js';
import { reportReadyAt, collectTube } from '../../labflow.js';
import { businessDate } from '../../pharmacy-calc.js';
import { openModal } from '../../components.js';
import { toast } from '../../notifications.js';
import { setMeta } from '../../app.js';
import { esc } from '../../utils.js';
import { icon } from './bi.js';
import { STAGES, stageById, stageOf, onHold, scanTarget, codesOf } from './stages.js';
import { receiveCodes, openCollection } from './collect.js';
import { pat, dur, minsSince, liveOrders, ageSex, PTYPES, ptypeCell, ptype } from './ui.js';
const ptypeCls = (v) => ptype(v).cls;
import { isCritical } from '../../hospital.js';
import { mountSid } from './sid.js';

const ACT = { collect: ['Collect', 'droplet-half'], receive: ['Receive', 'check2'], results: ['Enter results', 'keyboard'], verify: ['Verify', 'patch-check'], send: ['Send report', 'send'] };
const priTxt = (v) => (v.priority === 'STAT' ? '<span class="h-stat">STAT</span>' : v.priority === 'URGENT' ? '<span class="h-urg">Urgent</span>' : '<span class="h-muted">Routine</span>');

export function renderWorkbench(view, params, query) {
  let stage = stageById(query.stage || query.tab).id;
  let ptf = ''; // patient-type filter ('' = all)
  let statOnly = false;
  let sel = null;            // highlighted row in the worklist
  let open = query.v || null; // patient on screen (null = worklist)
  let panel = null;
  if (open) { const v0 = store.get('labVisits', open); if (!v0) open = null; else if (stageOf(v0) && !stageById(stage).select('').some((x) => x.id === open)) stage = stageOf(v0); }

  view.innerHTML = `<div class="h-lab">
    <section data-wl class="h-wl">
      <header class="h-head">
        <div><h1>Lab Worklist</h1><p data-today></p></div>
        <label class="h-scan">${icon('upc-scan')}<input class="input" data-scan autocomplete="off" placeholder="Scan tube / SID, or type name, token, mobile"><kbd>/</kbd></label>
        <div class="h-tools"><span data-hold></span>${can('lab.order.ip') ? `<a class="btn btn-secondary" href="#/lab/ward-order">${icon('hospital')}Ward order</a>` : ''}<a class="btn btn-secondary" href="#/lab/display" target="_blank" title="Open the token screen for the waiting area">${icon('display')}Token screen</a></div>
      </header>
      <div class="h-box">
        <nav class="h-tabs" data-steps aria-label="Lab steps"></nav>
        <div class="h-filters"><label>Patient type <select class="input input-sm" data-ptype></select></label>
          <label class="h-check"><input type="checkbox" data-stat> STAT only</label><span data-bulk></span>
          <span class="h-hint">Click a row to open · <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>1</kbd>–<kbd>5</kbd> step</span></div>
        <div class="h-tablewrap"><table class="h-table h-wltable"><thead><tr><th style="width:210px">Patient type / where</th><th style="width:96px">SID</th><th>Patient</th><th>Tests</th><th style="width:78px">Priority</th><th style="width:96px">Waiting</th><th style="width:150px"></th></tr></thead><tbody data-rows></tbody></table></div>
      </div>
    </section>
    <section data-pt class="h-ptview" hidden>
      <div class="h-ptnav"><button class="btn btn-secondary" data-back>${icon('arrow-left')}Worklist</button><span class="h-muted" data-pos></span><span class="h-grow"></span>
        <button class="btn btn-secondary btn-sm" data-prev title="Previous patient">${icon('chevron-left')}Previous</button><button class="btn btn-secondary btn-sm" data-next title="Next patient">Next${icon('chevron-right')}</button></div>
      <div data-host class="h-pthost"></div>
    </section></div>`;
  const $ = (s) => view.querySelector(s);
  const scan = $('[data-scan]');
  const q = () => scan.value.trim().toLowerCase();
  const items = () => stageById(stage).select(q()).filter((v) => (!statOnly || v.priority === 'STAT') && (!ptf || v.source === ptf));
  const url = () => history.replaceState(null, '', `#/lab?stage=${stage}${open ? `&v=${open}` : ''}`);

  const drawTop = () => {
    const today = businessDate();
    const done = store.all('labVisits').filter((v) => reportReadyAt(v) && businessDate(reportReadyAt(v)) === today);
    const avg = done.length ? Math.round(done.reduce((t, v) => t + minsSince(v.createdAt, reportReadyAt(v)), 0) / done.length) : 0;
    $('[data-today]').innerHTML = `${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · ${done.length} report${done.length === 1 ? '' : 's'} today${avg ? ` · average turnaround ${dur(avg)}` : ''}`;
    const hold = onHold();
    $('[data-hold]').innerHTML = hold.length ? `<button class="btn btn-secondary h-warnbtn" data-hold-btn>${icon('lock')}${hold.length} waiting for payment</button>` : '';
    $('[data-hold-btn]')?.addEventListener('click', showHold);
  };
  const drawSteps = () => {
    $('[data-steps]').innerHTML = STAGES.map((s) => { const n = s.count(); const stat = s.select('').some((v) => v.priority === 'STAT');
      return `<button class="h-tab ${s.id === stage ? 'on' : ''}" data-stage="${s.id}" title="Press ${s.n}">${icon(ACT[s.id][1])}${esc(TAB[s.id])}<span class="h-c ${stat && s.id !== stage ? 'stat' : ''}">${n}</span></button>`; }).join('');
    view.querySelectorAll('[data-stage]').forEach((b) => { b.onclick = () => go(b.dataset.stage); });
  };
  const drawList = () => {
    const s = stageById(stage); const list = items();
    if (!list.some((v) => v.id === sel)) sel = list[0]?.id || null;
    $('[data-bulk]').innerHTML = stage === 'receive' && list.length > 1 && can('lab.work') ? `<button class="btn btn-secondary btn-sm" data-recv-all>${icon('check2-all')}Receive all ${list.length}</button>` : '';
    $('[data-recv-all]')?.addEventListener('click', () => receiveCodes(list.flatMap((v) => v.tubes.filter((t) => t.collectedAt && !t.receivedAt).map((t) => t.code))));
    const all = s.select(q()); const pt = $('[data-ptype]');
    pt.innerHTML = `<option value="">All (${all.length})</option>${PTYPES.map((t) => { const n = all.filter((v) => v.source === t.id).length; return `<option value="${t.id}" ${t.id === ptf ? 'selected' : ''} ${n ? '' : 'disabled'}>${esc(t.long)} (${n})</option>`; }).join('')}`;
    const [act] = ACT[stage];
    $('[data-rows]').innerHTML = list.length ? list.map((v) => { const p = pat(v.patientId); const m = minsSince(s.since(v) || v.createdAt); const line = s.line(v); const codes = codesOf(v);
      const crit = stage !== 'verify' && liveOrders(v).some(isCritical);
      return `<tr class="${v.id === sel ? 'sel' : ''}" data-id="${v.id}">
        <td class="h-wcell t-${ptypeCls(v)}">${ptypeCell(v)}</td><td class="mono">${v.sid}</td>
        <td class="h-pt"><b>${esc(p.name)}</b><small>${esc(ageSex(p))}</small></td>
        <td class="h-tests">${esc(codes.join(', '))}${line ? `<div class="h-line">${line}</div>` : ''}${crit ? '<div class="h-line"><span class="danger">Critical value</span></div>' : ''}</td>
        <td>${priTxt(v)}</td>
        <td class="${m > s.late ? 'h-late' : ''}">${dur(m)}</td>
        <td class="ta-right">${can(stage === 'verify' ? 'lab.verify' : stage === 'send' ? 'lab.deliver' : 'lab.work') ? `<button class="btn btn-sm ${v.id === sel ? 'btn-primary' : 'btn-secondary'}" data-act="${v.id}">${act}</button>` : ''}</td></tr>`; }).join('')
      : `<tr><td colspan="7" class="h-empty">${icon(q() ? 'search' : 'check2-circle')}<b>${q() ? 'No match' : esc(s.empty[1])}</b><span>${q() ? `Nobody here matches “${esc(scan.value.trim())}”.` : esc(s.empty[2])}</span></td></tr>`;
    view.querySelectorAll('[data-rows] tr[data-id]').forEach((r) => { r.onclick = (e) => { if (e.target.closest('[data-act]')) return; openPatient(r.dataset.id); }; });
    view.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => rowAction(b.dataset.act); });
  };
  const TAB = { collect: 'To collect', receive: 'To receive', results: 'Enter results', verify: 'To verify', send: 'Ready to send' };

  const rowAction = (id) => {
    sel = id;
    if (stage === 'collect') { openCollection(id, () => {}); return; }
    if (stage === 'receive') { const v = store.get('labVisits', id); receiveCodes(v.tubes.filter((t) => t.collectedAt && !t.receivedAt).map((t) => t.code)); return; }
    openPatient(id);
  };

  // ----- patient screen -----
  const openPatient = (id, focus = true) => {
    open = id; sel = id; url();
    $('[data-wl]').hidden = true; $('[data-pt]').hidden = false;
    panel?.cleanup();
    panel = mountSid($('[data-host]'), id, { step: focus ? stage : null });
    drawNav(); window.scrollTo(0, 0);
    const p = pat(store.get('labVisits', id).patientId); setMeta({ title: `${p.name} — Lab`, crumbs: [{ label: 'Laboratory', href: '#/lab' }, { label: 'Worklist', href: `#/lab?stage=${stage}` }, p.name] });
  };
  const drawNav = () => {
    const l = items(); const i = l.findIndex((v) => v.id === open);
    $('[data-pos]').textContent = i >= 0 ? `Patient ${i + 1} of ${l.length} in “${TAB[stage]}”` : `Done here — no longer in “${TAB[stage]}”`;
    $('[data-prev]').disabled = !(i > 0) && !(i < 0 && l.length);
    $('[data-next]').disabled = i >= 0 ? i >= l.length - 1 : !l.length;
  };
  const step = (d) => { const l = items(); const i = l.findIndex((v) => v.id === open); const n = i < 0 ? l[0] : l[i + d]; if (n) openPatient(n.id); };
  const back = () => {
    panel?.cleanup(); panel = null; open = null; url();
    $('[data-pt]').hidden = true; $('[data-wl]').hidden = false; $('[data-host]').innerHTML = '';
    document.querySelector('.l2-drawer-wrap')?.remove();
    setMeta({ title: 'Lab Worklist', crumbs: ['Laboratory', 'Worklist'] });
    draw();
  };
  $('[data-back]').onclick = back;
  $('[data-prev]').onclick = () => step(-1);
  $('[data-next]').onclick = () => step(1);

  const go = (id) => { stage = id; sel = null; drawSteps(); drawList(); url(); };
  const draw = () => { drawTop(); drawSteps(); drawList(); };

  const showHold = () => {
    const hs = onHold();
    openModal({ title: 'Waiting for payment', subtitle: 'Do not collect these samples. Send the patient to the main counter.', size: 'md',
      body: `<table class="h-table"><thead><tr><th>Patient</th><th>SID</th><th>Bill</th></tr></thead><tbody>${hs.map((v) => `<tr><td><a href="#/lab/visit/${v.id}">${esc(pat(v.patientId).name)}</a></td><td class="mono">${v.sid}</td><td class="mono">${esc(v.billId || '—')}</td></tr>`).join('')}</tbody></table>`,
      footer: [{ label: 'Close', onClick: (c) => c() }] });
  };

  // ----- filters, scan box, keys -----
  $('[data-ptype]').onchange = (e) => { ptf = e.target.value; sel = null; drawList(); };
  $('[data-stat]').onchange = (e) => { statOnly = e.target.checked; sel = null; drawList(); };
  scan.addEventListener('input', drawList);
  scan.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { scan.value = ''; scan.blur(); drawList(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); scan.blur(); move(1); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = scanTarget(scan.value);
    if (!t) { const l = items(); if (l.length === 1) { scan.value = ''; openPatient(l[0].id); } else if (!l.length) toast('No tube, SID or patient matches that.', 'error'); return; }
    scan.value = '';
    if (t.kind === 'collect' && can('lab.work')) { try { collectTube(t.v.id, t.code, currentUser()); toast(`${t.code} collected.`); } catch (err) { toast(err.message, 'error'); } }
    else if (t.kind === 'receive' && can('lab.work')) receiveCodes([t.code]);
    else { openPatient(t.v.id); return; }
    const st = stageOf(store.get('labVisits', t.v.id)) || stage; stage = st; sel = t.v.id; draw(); url(); scan.focus();
  });
  const move = (d) => { const l = items(); const i = l.findIndex((v) => v.id === sel); const n = l[Math.max(0, Math.min(l.length - 1, i + d))]; if (n) { sel = n.id; drawList(); view.querySelector('[data-rows] tr.sel')?.scrollIntoView({ block: 'nearest' }); } };
  const onKey = (e) => {
    if (!view.isConnected) return;
    if (document.querySelector('.modal-backdrop, .l2-drawer-wrap')) return;
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (open) { if (e.key === 'Escape' && !typing) { e.preventDefault(); back(); } return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); scan.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key >= '1' && e.key <= '5') { e.preventDefault(); go(STAGES[+e.key - 1].id); }
    else if (e.key === 'Enter' && sel && !['BUTTON', 'A'].includes(document.activeElement?.tagName)) { e.preventDefault(); openPatient(sel); }
  };
  document.addEventListener('keydown', onKey);
  const unsub = store.subscribe(() => { drawTop(); drawSteps(); if (open) drawNav(); else drawList(); });
  draw();
  if (open) openPatient(open, false);
  return () => { unsub(); panel?.cleanup(); document.removeEventListener('keydown', onKey); document.querySelector('.l2-drawer-wrap')?.remove(); };
}
