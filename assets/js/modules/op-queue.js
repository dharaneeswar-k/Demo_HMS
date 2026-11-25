// Doctor Queue — the doctor's own live queue (now serving, call next, skip), or any doctor's queue for staff.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { businessDate } from '../pharmacy-calc.js';
import { activeDoctors, doctor, deptName, patient, cbadge, doctorForUser, doctorWorksOn } from '../clinical.js';
import { doctorQueue, callVisit, skipVisit, avgConsultMinutes } from '../op.js';
import { patientStrip, vitalsChips, ageSex } from './clinical-ui.js';
import { openVitals } from './op-visit.js';
import { typeTag } from './op-desk.js';
import { emptyState } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, relTime, refreshIcons, debounce, fmtDateTime } from '../utils.js';
import { setMeta } from '../app.js';
import { navigate } from '../router.js';

export function render(view, params, query) {
  const u = currentUser();
  const mine = doctorForUser(u);
  const today = businessDate();
  let docId = mine?.id || query.doctor || (activeDoctors().find((d) => doctorWorksOn(d, today)) || activeDoctors()[0])?.id;
  const draw = () => {
    const d = doctor(docId); const q = doctorQueue(docId, today);
    setMeta({ title: mine ? 'My Queue' : `Queue · ${d.name}`, crumbs: ['Outpatient', 'Doctor Queue'] });
    const cur = q.current[0]; const canCall = can('op.consult') && (!mine || mine.id === docId);
    const mins = avgConsultMinutes(docId);
    view.innerHTML = `
      <div class="page-head"><div><p class="muted">${esc(d.name)} · ${esc(deptName(d.departmentId))} · ${esc(d.room)} · ${esc(d.start)}–${esc(d.end)}</p></div>
        <div class="page-actions">${!mine ? `<select class="input" data-doc>${activeDoctors().map((x) => `<option value="${x.id}" ${x.id === docId ? 'selected' : ''}>${esc(x.name)} — ${esc(deptName(x.departmentId))}</option>`).join('')}</select>` : ''}
          <a class="btn btn-secondary" href="#/op/display" target="_blank" rel="noopener">${icon('monitor')}Token display</a></div></div>
      <div class="queue-grid">
        <section class="now-card">${cur ? `<div class="now-top"><div><span class="lbl-sm">Now serving</span><div class="now-token">${esc(cur.token)}</div></div><div class="now-time">${icon('clock')} in since ${relTime(cur.calledAt)}</div></div>
            ${patientStrip(patient(cur.patientId), { dark: true })}<div class="now-vitals">${vitalsChips(cur.vitals, { compact: true })}</div>
            ${cur.chiefComplaint ? `<p class="now-cc">${icon('message-square')}${esc(cur.chiefComplaint)}</p>` : ''}
            <div class="row mt-2"><a class="btn btn-primary" href="#/op/visits/${cur.id}">${icon('notebook-pen')}Open case sheet</a>${canCall ? `<button class="btn btn-ghost-light" data-skip="${cur.id}">${icon('skip-forward')}Send back</button>` : ''}</div>`
          : `<div class="now-empty">${icon('armchair')}<h3>No patient with the doctor</h3><p>${q.waiting.length ? `${q.waiting.length} waiting · next is <strong>${esc(q.waiting[0].token)}</strong>` : 'Nobody is waiting.'}</p>
            ${canCall && q.waiting.length ? `<button class="btn btn-primary btn-lg" data-call="${q.waiting[0].id}">${icon('door-open')}Call ${esc(q.waiting[0].token)}</button>` : ''}</div>`}</section>
        <section class="card"><header class="card-head"><div><h2>Waiting (${q.waiting.length})</h2><p class="muted small">Emergency first, then token order. A skipped token moves ${store.all('clinicalSettings').op.skipPlaces} places back; ${store.all('clinicalSettings').op.maxSkips + 1} skips mark it a no-show.</p></div>
          <div class="card-actions"><span class="pill-soft">${icon('timer')}~${mins} min per patient</span></div></header>
          <div class="table-scroll"><table class="table"><thead><tr><th>Token</th><th>Patient</th><th>Type</th><th>Vitals</th><th>Waiting</th><th></th></tr></thead><tbody>
          ${q.waiting.map((v, i) => { const p = patient(v.patientId); return `<tr class="${v.priority === 'EMERGENCY' ? 'row-er' : ''}"><td><strong class="mono">${esc(v.token)}</strong>${v.skips ? `<div class="cell-sub">skipped ${v.skips}×</div>` : ''}</td>
            <td><a href="#/op/visits/${v.id}" class="cell-main">${esc(p.name)}</a><div class="cell-sub">${esc(ageSex(p))}${p.allergies ? ' · <span class="text-danger">allergy</span>' : ''}${v.chiefComplaint ? ' · ' + esc(v.chiefComplaint) : ''}</div></td>
            <td>${typeTag(v)}</td><td>${v.vitals ? vitalsChips(v.vitals, { compact: true }) : can('op.vitals') ? `<button class="btn btn-ghost btn-sm" data-vit="${v.id}">${icon('heart-pulse')}Record</button>` : '<span class="muted small">Pending</span>'}</td>
            <td class="small">${relTime(v.at)}<div class="cell-sub">~${i * mins} min to go</div></td>
            <td class="ta-right nowrap">${canCall ? `<button class="btn btn-${i === 0 && !cur ? 'primary' : 'secondary'} btn-sm" data-call="${v.id}">${icon('door-open')}Call</button> <button class="btn btn-ghost btn-sm" data-skip="${v.id}" title="Patient not present">${icon('skip-forward')}</button>` : ''}</td></tr>`; }).join('')
            || `<tr><td colspan="6">${emptyState('party-popper', 'Queue is clear', 'New tokens appear here as soon as they are issued.')}</td></tr>`}</tbody></table></div></section>
      </div>
      <section class="card mt-2"><header class="card-head"><h2>Seen today (${q.done.length})</h2>${q.other.length ? `<span class="muted small">${q.other.length} no-show / cancelled</span>` : ''}</header>
        <div class="done-list">${q.done.map((v) => `<a class="done-item" href="#/op/visits/${v.id}"><strong class="mono">${esc(v.token)}</strong><span>${esc(patient(v.patientId).name)}</span><small>${esc((v.consultation?.diagnosis || [])[0] || '')}</small>${cbadge(v.status)}<small>${v.consultation?.completedAt ? fmtDateTime(v.consultation.completedAt).split(', ')[1] : ''}</small></a>`).join('') || '<p class="muted small" style="padding:16px 20px">Nobody seen yet today.</p>'}
          ${q.other.map((v) => `<a class="done-item dim" href="#/op/visits/${v.id}"><strong class="mono">${esc(v.token)}</strong><span>${esc(patient(v.patientId).name)}</span><small></small>${cbadge(v.status)}<small></small></a>`).join('')}</div></section>`;
    view.querySelector('[data-doc]')?.addEventListener('change', (e) => { docId = e.target.value; draw(); });
    refreshIcons(view);
  };
  view.onclick = (e) => {
    const c = e.target.closest('[data-call]'); const s = e.target.closest('[data-skip]'); const vt = e.target.closest('[data-vit]');
    try {
      if (c) { const v = callVisit(c.dataset.call, u); toast(`${v.token} — please come to ${doctor(v.doctorId).room}.`, 'success', 'Called in'); navigate('#/op/visits/' + v.id); }
      if (s) { const v = skipVisit(s.dataset.skip, u); toast(v.status === 'NO_SHOW' ? `${v.token} marked as no-show.` : `${v.token} moved back in the queue.`, 'info'); draw(); }
      if (vt) openVitals(vt.dataset.vit, draw);
    } catch (err) { toast(err.message, 'error'); }
  };
  draw();
  const off = store.subscribe(debounce(draw, 300));
  const iv = setInterval(draw, 30000);
  return () => { off(); clearInterval(iv); view.onclick = null; };
}
