// Ward Indents — nurses raise medicine requests for admitted patients; pharmacy issues them FEFO from pharmacy stock
// (IP_ISSUE movements) and takes back unused units (IP_RETURN). Charges post to the patient's IP bill at batch MRP.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { businessDate } from '../pharmacy-calc.js';
import { patient, bedCode, label } from '../clinical.js';
import { openAdmissions, issueIndent, cancelIndent, currentBedId, finalBill } from '../ip.js';
import { indentCard, openIndent, openReturn } from './ip-folio.js';
import { kpi, emptyState, tabs, openModal, confirmDialog } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, refreshIcons, debounce } from '../utils.js';

export function render(view, params, query) {
  const u = currentUser();
  let tab = query.tab || 'pending';
  const draw = () => {
    const all = store.all('ipIndents');
    const pending = all.filter((i) => i.status === 'RAISED').sort((a, b) => (a.priority === 'STAT' ? -1 : 0) - (b.priority === 'STAT' ? -1 : 0) || a.raisedAt.localeCompare(b.raisedAt));
    const today = all.filter((i) => i.issuedAt && businessDate(i.issuedAt) === businessDate());
    const valueToday = store.all('ipCharges').filter((c) => c.source === 'INDENT' && c.businessDate === businessDate()).reduce((t, c) => t + c.amount, 0);
    view.innerHTML = `<div class="page-head"><div><p class="muted">${can('ip.indent.issue') ? 'Issue ward requests from pharmacy stock. Batches are picked first-expiry-first-out and the value goes to the patient’s IP bill.' : 'Request medicines from the pharmacy for admitted patients. STAT requests are shown first.'}</p></div>
      <div class="page-actions">${can('ip.indent.raise') ? `<button class="btn btn-primary" data-new>${icon('plus')}Raise indent</button>` : ''}</div></div>
      <div class="kpis">${kpi({ label: 'Waiting for pharmacy', value: fmtNum(pending.length), iconName: 'hourglass', tone: pending.length ? 'warning' : 'success', sub: `${pending.filter((i) => i.priority === 'STAT').length} STAT` })}
        ${kpi({ label: 'Issued today', value: fmtNum(today.length), iconName: 'package-check', tone: 'teal' })}
        ${kpi({ label: 'Issued value today', value: fmtINR(valueToday, true), iconName: 'indian-rupee', tone: 'navy', sub: 'at MRP, charged to IP bills' })}</div>
      <section class="card flush mt-2"><div data-tabs></div><div class="card-body" data-body></div></section>`;
    tabs(view.querySelector('[data-tabs]'), [{ id: 'pending', label: 'Pending', count: pending.length }, { id: 'today', label: 'Issued today', count: today.length }, { id: 'all', label: 'All indents' }], tab, (x) => { tab = x; body(); });
    const body = () => {
      const list = tab === 'pending' ? pending : tab === 'today' ? today : [...all].sort((a, b) => b.raisedAt.localeCompare(a.raisedAt)).slice(0, 60);
      const h = view.querySelector('[data-body]');
      h.innerHTML = list.length ? `<div class="ind-grid">${list.map((i) => indentCard(i, { issue: can('ip.indent.issue'), canReturn: can('ip.indent.issue') && store.get('ipAdmissions', i.admissionId).status !== 'DISCHARGED' && !finalBill(store.get('ipAdmissions', i.admissionId)) })).join('')}</div>`
        : emptyState(tab === 'pending' ? 'party-popper' : 'pill', tab === 'pending' ? 'No pending indents' : 'Nothing here yet');
      refreshIcons(h);
    };
    body();
    refreshIcons(view);
  };
  view.onclick = async (e) => {
    const iss = e.target.closest('[data-issue]'); const can_ = e.target.closest('[data-cancel]'); const ret = e.target.closest('[data-ret]'); const nw = e.target.closest('[data-new]');
    try {
      if (iss) { const i = issueIndent(iss.dataset.issue, u); toast(i.status === 'ISSUED' ? `${i.id} issued in full.` : `${i.id} part issued — some items are short on the shelf.`, i.status === 'ISSUED' ? 'success' : 'warning'); draw(); }
      if (can_) { const r = await confirmDialog({ title: 'Cancel indent?', message: 'The ward will be told the request was cancelled.', confirmLabel: 'Cancel indent', tone: 'danger', reason: true }); if (r) { cancelIndent(can_.dataset.cancel, r.reason, u); toast('Indent cancelled.', 'success'); draw(); } }
      if (ret) openReturn(ret.dataset.ret, draw);
      if (nw) pickPatient();
    } catch (err) { toast(err.message, 'error'); }
  };
  const pickPatient = () => {
    const adms = openAdmissions().filter((a) => !finalBill(a));
    openModal({ title: 'Raise indent for…', body: adms.length ? `<div class="list-plain">${adms.map((a) => `<button class="ps-item" data-adm="${a.id}"><span class="avatar">${esc(bedCode(currentBedId(a)))}</span><span class="grow"><strong>${esc(patient(a.patientId).name)}</strong><small>${esc(a.id)} · ${esc(a.provisionalDiagnosis)} · ${esc(label(a.status))}</small></span></button>`).join('')}</div>` : emptyState('bed', 'No admitted patients'),
      footer: [{ label: 'Close', onClick: (c) => c() }], onOpen: (w, close) => { w.querySelectorAll('[data-adm]').forEach((b) => { b.onclick = () => { close(); openIndent(b.dataset.adm, draw); }; }); } });
  };
  draw();
  const off = store.subscribe(debounce(() => { if (!document.querySelector('.modal-backdrop')) draw(); }, 400));
  return () => { off(); view.onclick = null; };
}
