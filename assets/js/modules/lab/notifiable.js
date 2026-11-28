// Notification register (F5, docs/LAB_COMPLIANCE_AUDIT.md) — every positive result of a test marked "Notifiable" in the
// Lab Test Master (TB → Ni-kshay, other diseases → IDSP / IHIP). The lab reports it on the government portal and records
// the portal ID here; anything not reported within the set hours is overdue and alerts the lab and the owner.
import { store } from '../../data-service.js';
import { currentUser, can } from '../../auth.js';
import { userName } from '../../calculations.js';
import { markNotified, labParams, flagFor } from '../../hospital.js';
import { NOTIFIABLE } from '../../labrules.js';
import { openModal, downloadCSV } from '../../components.js';
import { toast } from '../../notifications.js';
import { setMeta } from '../../app.js';
import { esc, fmtDateTime, ymd } from '../../utils.js';
import { icon, emptyState } from './bi.js';

/** Orders on the register, newest first. */
export const notifications = () => store.all('orders').filter((o) => o.lab?.notification).sort((a, b) => b.lab.notification.at.localeCompare(a.lab.notification.at));
export const isOverdue = (o) => o.lab.notification.status === 'PENDING' && o.lab.notification.dueAt < new Date().toISOString();
export const pendingNotifications = () => notifications().filter((o) => o.lab.notification.status === 'PENDING');
const resultText = (o) => (o.lab.results || []).filter((r) => { const q = labParams(o).find((x) => x.name === r.param); return q && flagFor(q, r.value); }).map((r) => `${r.param}: ${r.value}`).join('; ') || (o.lab.results || []).map((r) => `${r.param}: ${r.value}`).join('; ');

export function renderNotifiable(view, params, query = {}) {
  setMeta({ title: 'Notification register', crumbs: [{ label: 'Laboratory', href: '#/lab' }, 'Notification register'] });
  let tab = query.tab || 'PENDING'; let q = '';
  const draw = () => {
    const all = notifications(); const pend = all.filter((o) => o.lab.notification.status === 'PENDING');
    const list = all.filter((o) => (tab === 'ALL' || (tab === 'PENDING' ? o.lab.notification.status === 'PENDING' : o.lab.notification.status === 'NOTIFIED'))
      && (!q || `${store.get('patients', o.patientId)?.name} ${o.name} ${o.accession} ${o.lab.notification.refNo || ''}`.toLowerCase().includes(q)));
    view.innerHTML = `<div class="page-head"><div><p class="muted">Positive results of notifiable diseases. Report each one on the government portal (TB on <b>Ni-kshay</b>, others on <b>IHIP / IDSP</b>) within ${Number(store.hs().lab?.notifyWithinHours) || 24} hours and record the ID here. Which tests are notifiable is set in the Test Master.</p></div>
        <div class="page-actions"><button class="btn btn-secondary" data-csv>${icon('download')}Export CSV</button></div></div>
      <div class="h-tabs">${[['PENDING', `To report (${pend.length})`], ['NOTIFIED', 'Reported'], ['ALL', 'All']].map(([k, l]) => `<button class="h-tab ${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}<span class="h-grow"></span><input class="input input-sm" data-q placeholder="Search patient, test, ID" value="${esc(q)}" style="max-width:240px"></div>
      <section class="card">${list.length ? `<div class="h-tablewrap"><table class="h-table"><thead><tr><th class="h-sno" style="width:44px">S.No</th><th style="width:140px">Positive on</th><th>Patient</th><th>Test · result</th><th style="width:110px">Report to</th><th style="width:150px">Status</th><th style="width:150px"></th></tr></thead><tbody>
        ${list.map((o, i) => { const n = o.lab.notification; const p = store.get('patients', o.patientId); const late = isOverdue(o);
          return `<tr><td class="h-sno">${i + 1}</td><td>${fmtDateTime(n.at)}</td>
            <td><b>${esc(p?.name || '—')}</b><div class="h-line">${esc(p?.uhid || '')} · ${esc(p?.gender || '')} · ${esc(p?.phone || '')}</div></td>
            <td>${esc(o.name)}<div class="h-line">${esc(resultText(o))} · <a href="#/lab/visit/${o.labVisitId}">SID ${esc(store.get('labVisits', o.labVisitId)?.sid || '')}</a></div></td>
            <td>${esc(NOTIFIABLE[n.program]?.portal || n.program)}</td>
            <td>${n.status === 'NOTIFIED' ? `<span class="h-ok">Reported</span><div class="h-line">ID ${esc(n.refNo)} · ${esc(userName(n.notifiedBy))} · ${fmtDateTime(n.notifiedAt)}</div>` : late ? `<span class="danger">Overdue</span><div class="h-line">Due ${fmtDateTime(n.dueAt)}</div>` : `<span class="h-warn">To report</span><div class="h-line">By ${fmtDateTime(n.dueAt)}</div>`}</td>
            <td class="ta-right">${n.status === 'PENDING' && (can('lab.work') || can('lab.verify')) ? `<button class="btn btn-sm ${late ? 'btn-primary' : 'btn-secondary'}" data-mark="${o.id}">${icon('check')}Mark reported</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`
        : emptyState('check-circle-2', tab === 'PENDING' ? 'Nothing to report' : 'No entries', tab === 'PENDING' ? 'Every positive notifiable result has been reported.' : 'Positive results of notifiable tests appear here when they are verified.')}</section>`;
    view.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; draw(); }; });
    const qi = view.querySelector('[data-q]'); qi.oninput = () => { q = qi.value.trim().toLowerCase(); const pos = qi.selectionStart; draw(); const n = view.querySelector('[data-q]'); n.focus(); n.setSelectionRange(pos, pos); };
    view.querySelectorAll('[data-mark]').forEach((b) => { b.onclick = () => markDialog(b.dataset.mark, draw); });
    view.querySelector('[data-csv]').onclick = () => downloadCSV(`notification-register-${ymd()}.csv`, ['Positive on', 'Patient', 'Patient ID', 'Sex', 'Phone', 'Test', 'Result', 'Report to', 'Status', 'Portal ID', 'Reported by', 'Reported at'],
      all.map((o) => { const n = o.lab.notification; const p = store.get('patients', o.patientId); return [fmtDateTime(n.at), p?.name, p?.uhid, p?.gender, p?.phone, o.name, resultText(o), NOTIFIABLE[n.program]?.portal || n.program, n.status === 'NOTIFIED' ? 'Reported' : isOverdue(o) ? 'Overdue' : 'To report', n.refNo || '', n.notifiedBy ? userName(n.notifiedBy) : '', n.notifiedAt ? fmtDateTime(n.notifiedAt) : '']; }));
  };
  draw();
}

function markDialog(orderId, done) {
  const o = store.get('orders', orderId); const n = o.lab.notification; const portal = NOTIFIABLE[n.program]?.portal || n.program;
  openModal({ title: `Reported on ${portal}`, subtitle: `${store.get('patients', o.patientId)?.name} · ${o.name}`, size: 'sm',
    body: `<p class="muted small">Enter the case on the ${esc(portal)} portal first, then record its ID here.</p>
      <div class="field mt-1"><label>${esc(portal)} ID / acknowledgement no. <span class="req">*</span></label><input class="input mono" data-ref placeholder="e.g. ${n.program === 'TB' ? 'NIK-2026-0045571' : 'IHIP/TN/26/11/0042'}"></div>
      <div class="field mt-1"><label>Note</label><input class="input" data-note placeholder="Optional — e.g. reported by phone to the DTO"></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', cls: 'btn-primary', onClick: (c, w) => { try { markNotified(orderId, { refNo: w.querySelector('[data-ref]').value, note: w.querySelector('[data-note]').value }, currentUser()); c(); toast('Recorded as reported.', 'success'); done(); } catch (e) { toast(e.message, 'error'); } } }] });
}
