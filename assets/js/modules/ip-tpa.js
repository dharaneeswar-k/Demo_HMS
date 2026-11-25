// Insurance / TPA desk — pre-authorisation pipeline for admitted patients, final approvals at discharge, and claims receivable.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { patient, tpaName, cbadge, label, CLAIM_LABEL } from '../clinical.js';
import { ipPosition, finalBill, updateClaim, split } from '../ip.js';
import { openPreAuth } from './ip-folio.js';
import { kpi, tabs, emptyState, openModal } from '../components.js';
import { toast } from '../notifications.js';
import { esc, fmtINR, fmtNum, fmtDate, relTime, refreshIcons, debounce } from '../utils.js';

const STAGES = ['PREAUTH_PENDING', 'APPROVED', 'ENHANCEMENT_PENDING', 'FINAL_APPROVED'];
const flow = (pa) => `<div class="stage-flow">${pa.stage === 'REJECTED' ? '<span class="bad">Rejected</span>' : STAGES.map((s, i) => `<span class="${s === pa.stage ? 'on' : STAGES.indexOf(pa.stage) > i ? 'done' : ''}">${esc(label(s).replace(' received', ''))}</span>`).join('')}</div>`;

export function render(view, params, query) {
  const u = currentUser();
  let tab = query.tab || 'active';
  const draw = () => {
    const ins = store.all('ipAdmissions').filter((a) => a.payer.type !== 'SELF');
    const active = ins.filter((a) => a.status !== 'DISCHARGED');
    const claims = ins.filter((a) => a.finalBillId && finalBill(a)?.status === 'SETTLED');
    const receivable = claims.filter((a) => a.payer.claim?.status !== 'SETTLED').reduce((t, a) => { const fb = finalBill(a); return t + split(a, fb.net, fb.nonPayable).payerPays; }, 0);
    const cnt = (s) => active.filter((a) => a.payer.preAuth?.stage === s).length;
    view.innerHTML = `<div class="page-head"><div><p class="muted">Track every cashless case: pre-authorisation, enhancement, final approval at discharge and the claim settlement. Updates are recorded here; nothing is sent to the insurer automatically.</p></div></div>
      <div class="kpis">${kpi({ label: 'Pre-auth pending', value: fmtNum(cnt('PREAUTH_PENDING')), iconName: 'hourglass', tone: cnt('PREAUTH_PENDING') ? 'warning' : 'success' })}
        ${kpi({ label: 'Enhancement pending', value: fmtNum(cnt('ENHANCEMENT_PENDING')), iconName: 'trending-up', tone: 'purple' })}
        ${kpi({ label: 'Awaiting final approval', value: fmtNum(active.filter((a) => finalBill(a)?.status === 'AWAITING_TPA').length), iconName: 'shield-plus', tone: 'info' })}
        ${kpi({ label: 'Claims receivable', value: fmtINR(receivable, true), iconName: 'landmark', tone: 'navy', sub: `${claims.filter((a) => a.payer.claim?.status !== 'SETTLED').length} claim(s) open` })}</div>
      <section class="card flush mt-2"><div data-tabs></div><div data-body></div></section>`;
    tabs(view.querySelector('[data-tabs]'), [{ id: 'active', label: 'In hospital', count: active.length }, { id: 'claims', label: 'Claims', count: claims.length }], tab, (x) => { tab = x; body(); });
    const body = () => {
      const h = view.querySelector('[data-body]');
      if (tab === 'active') {
        h.innerHTML = active.length ? `<div class="table-scroll"><table class="table"><thead><tr><th>IP no.</th><th>Patient</th><th>Payer</th><th class="ta-right">Requested</th><th class="ta-right">Approved</th><th class="ta-right">Running bill</th><th>Stage</th><th></th></tr></thead><tbody>
          ${active.map((a) => { const pa = a.payer.preAuth; const pos = ipPosition(a); const over = pa && pa.approved && pos.net - pos.split.nonPayable > pa.approved;
            return `<tr><td><a class="mono" href="#/ip/admissions/${a.id}">${esc(a.id)}</a><div class="cell-sub">day ${Math.max(1, Math.round((Date.now() - new Date(a.admittedAt)) / 86400000) + 1)}</div></td><td><div class="cell-main">${esc(patient(a.patientId).name)}</div><div class="cell-sub">${esc(a.provisionalDiagnosis)}</div></td>
              <td>${a.payer.type === 'INSURANCE' ? `<div class="cell-main">${esc(tpaName(a.payer.tpaId))}</div><div class="cell-sub">${esc(a.payer.insurer)} · ${esc(a.payer.policyNo)}${a.payer.coPayPct ? ` · co-pay ${a.payer.coPayPct}%` : ''}</div>` : `<div class="cell-main">${esc(a.payer.corporate)}</div><div class="cell-sub">Corporate credit</div>`}</td>
              <td class="ta-right">${fmtINR(pa?.requested || 0, true)}</td><td class="ta-right">${pa?.approved ? fmtINR(pa.approved, true) : '—'}</td><td class="ta-right ${over ? 'text-danger strong' : ''}">${fmtINR(pos.net, true)}${over ? '<div class="cell-sub text-danger">over approval</div>' : ''}</td>
              <td>${pa ? flow(pa) : ''}<div class="cell-sub">${pa?.history?.length ? relTime(pa.history.at(-1).at) : ''}</div></td><td>${can('ip.tpa') && a.payer.type === 'INSURANCE' ? `<button class="btn btn-secondary btn-sm" data-pa="${a.id}">Update</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`
          : emptyState('shield-plus', 'No insurance or corporate patients in hospital');
      } else {
        h.innerHTML = claims.length ? `<div class="table-scroll"><table class="table"><thead><tr><th>Bill</th><th>Patient</th><th>Payer</th><th>Discharged</th><th class="ta-right">Claim amount</th><th>Status</th><th></th></tr></thead><tbody>
          ${claims.sort((x, y) => (y.discharge?.dischargedAt || '').localeCompare(x.discharge?.dischargedAt || '')).map((a) => { const fb = finalBill(a); const amt = split(a, fb.net, fb.nonPayable).payerPays; const cl = a.payer.claim || { status: 'NOT_SUBMITTED' };
            return `<tr><td><a class="mono" href="#/ip/print/${a.id}?doc=final">${esc(fb.id)}</a></td><td>${esc(patient(a.patientId).name)}<div class="cell-sub">${esc(a.id)}</div></td><td>${esc(a.payer.type === 'INSURANCE' ? tpaName(a.payer.tpaId) : a.payer.corporate)}</td>
              <td class="small">${fmtDate(a.discharge?.dischargedAt || fb.settledAt)}</td><td class="ta-right">${fmtINR(amt)}${cl.settledAmount && cl.settledAmount !== amt ? `<div class="cell-sub">settled ${fmtINR(cl.settledAmount)}</div>` : ''}</td>
              <td>${cbadge(cl.status === 'SETTLED' ? 'SETTLED' : cl.status === 'SUBMITTED' ? 'PENDING' : 'NOT_SUBMITTED', CLAIM_LABEL[cl.status])}${cl.reference ? `<div class="cell-sub">${esc(cl.reference)}</div>` : ''}</td>
              <td>${can('ip.tpa') && cl.status !== 'SETTLED' ? `<button class="btn btn-secondary btn-sm" data-claim="${a.id}">${cl.status === 'SUBMITTED' ? 'Record settlement' : 'Mark submitted'}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`
          : emptyState('landmark', 'No claims yet');
      }
      refreshIcons(h);
    };
    body();
    refreshIcons(view);
  };
  view.onclick = (e) => {
    const pa = e.target.closest('[data-pa]'); const cl = e.target.closest('[data-claim]');
    if (pa) openPreAuth(pa.dataset.pa, draw);
    if (cl) {
      const a = store.get('ipAdmissions', cl.dataset.claim); const st = a.payer.claim?.status || 'NOT_SUBMITTED';
      if (st !== 'SUBMITTED') { try { updateClaim(a.id, { status: 'SUBMITTED' }, u); toast('Claim marked as submitted.', 'success'); draw(); } catch (err) { toast(err.message, 'error'); } return; }
      const fb = finalBill(a);
      const m = openModal({ title: 'Record claim settlement', subtitle: `${esc(patient(a.patientId).name)} · ${esc(fb.id)}`, body: `<div class="form-grid"><div class="field col-6"><label>Amount received</label><div class="input-prefix"><span>₹</span><input class="input" type="number" data-amt value="${split(a, fb.net, fb.nonPayable).payerPays}"></div></div><div class="field col-6"><label>UTR / cheque no.</label><input class="input" data-ref></div></div>`,
        footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', cls: 'btn-primary', onClick: (c) => { try { updateClaim(a.id, { status: 'SETTLED', amount: m.el.querySelector('[data-amt]').value, reference: m.el.querySelector('[data-ref]').value }, u); toast('Claim settled.', 'success'); c(); draw(); } catch (err) { toast(err.message, 'error'); } } }] });
    }
  };
  draw();
  const off = store.subscribe(debounce(() => { if (!document.querySelector('.modal-backdrop')) draw(); }, 400));
  return () => { off(); view.onclick = null; };
}
