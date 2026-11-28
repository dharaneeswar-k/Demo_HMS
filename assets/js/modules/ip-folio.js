// IP Patients list and the Patient Folio (bill & charges, medicines, payments, bed history, notes & vitals, insurance).
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { patient, doctorName, deptName, bedCode, categoryLabel, cbadge, label, tpaName, servicesFor, service, modeLabel, receiptsFor, CLAIM_LABEL } from '../clinical.js';
import { admission, openAdmissions, ipPosition, groupTotals, GROUPS, GROUP_ORDER, daysAdmitted, currentBedId, staysOf, chargesOf, indentsOf, finalBill, addDeposit, postCharge, reverseCharge, addNote, raiseIndent,
  initiateDischarge, updatePreAuth, returnFromWard, returnableQty, stockFor, PREAUTH_STAGES, payerApproved, pendingIndentsOf } from '../ip.js';
import { medName, userName } from '../calculations.js';
import { ORDER_LABEL } from '../hospital.js';
// a lab test on the IP bill links to its lab visit (SID) and shows how far the lab has got
const labTag = (c) => { const o = c?.source === 'LAB' && store.get('orders', c.refId); const v = o && store.get('labVisits', o.labVisitId); return v ? ` <a class="tag tag-purple" href="#/lab/visit/${v.id}" title="Open in the lab">SID ${esc(v.sid)} · ${esc(ORDER_LABEL[o.status] || o.status)}</a>` : ''; };
import { patientStrip, payPanel, vitalsChips, vitalsForm, wireVitalsForm, ageSex } from './clinical-ui.js';
import { openTransfer } from './ip-beds.js';
import { dataTable, kpi, openModal, confirmDialog, emptyState, tabs, combo, exportTable } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, fmtDate, fmtDateTime, relTime, refreshIcons, debounce, localDateTimeValue, personAv } from '../utils.js';
import { setMeta } from '../app.js';
import { navigate } from '../router.js';

const payerTag = (a) => a.payer.type === 'SELF' ? '<span class="tag tag-success">Self</span>' : a.payer.type === 'INSURANCE' ? `<span class="tag tag-info" title="${esc(tpaName(a.payer.tpaId))}">TPA</span>` : '<span class="tag tag-purple">Corporate</span>';

// ---------------- list ----------------
export function renderList(view, params, query) {
  let tab = query.tab || 'admitted'; let q = '';
  const rowsFor = (t) => {
    const all = store.all('ipAdmissions');
    if (t === 'admitted') return all.filter((a) => a.status === 'ADMITTED');
    if (t === 'discharging') return all.filter((a) => ['DISCHARGE_INITIATED', 'BILL_FINALISED'].includes(a.status));
    if (t === 'low') return openAdmissions().filter((a) => ipPosition(a).low);
    if (t === 'discharged') return all.filter((a) => a.status === 'DISCHARGED');
    return all;
  };
  const open = openAdmissions(); const pos = open.map(ipPosition);
  view.innerHTML = `<div class="page-head"><div><p class="muted">Admitted patients with their bed, consultant, running bill and deposit position.</p></div>
    <div class="page-actions"><button class="btn btn-secondary" data-csv>${icon('download')}Export CSV</button>${can('ip.admit') ? `<a class="btn btn-primary" href="#/ip/admit">${icon('hospital')}Admit patient</a>` : ''}</div></div>
    <div class="kpis">${kpi({ label: 'In hospital', value: fmtNum(open.length), iconName: 'bed-double', tone: 'teal' })}
      ${kpi({ label: 'Running bills', value: fmtINR(pos.reduce((t, p) => t + p.net, 0), true), iconName: 'receipt-text', tone: 'navy', sub: 'bed, nursing, medicines, services' })}
      ${kpi({ label: 'Deposits held', value: fmtINR(pos.reduce((t, p) => t + p.paid, 0), true), iconName: 'wallet', tone: 'success' })}
      ${kpi({ label: 'Low deposit', value: fmtNum(pos.filter((p) => p.low).length), iconName: 'alert-triangle', tone: pos.some((p) => p.low) ? 'danger' : 'success' })}</div>
    <section class="card flush mt-2"><div data-tabs></div><div class="toolbar"><div class="search">${icon('search')}<input class="input" data-q placeholder="IP no., patient, Patient ID, bed, diagnosis…"></div></div><div data-table></div></section>`;
  const cols = [
    { key: 'id', label: 'IP no.', render: (a) => `<div class="cell-main mono">${esc(a.id)}</div><div class="cell-sub">${fmtDate(a.admittedAt)}</div>`, value: (a) => a.admittedAt, csv: (a) => a.id },
    { key: 'patient', label: 'Patient', value: (a) => patient(a.patientId).name, render: (a) => { const p = patient(a.patientId); return `<div class="who">${personAv(p.name)}<div><div class="cell-main">${esc(p.name)}</div><div class="cell-sub">${esc(p.uhid)} · ${esc(ageSex(p))}</div></div></div>`; } },
    { key: 'bed', label: 'Bed', value: (a) => bedCode(currentBedId(a)), render: (a) => `<span class="mono strong">${esc(bedCode(currentBedId(a)))}</span>` },
    { key: 'doc', label: 'Consultant', value: (a) => doctorName(a.doctorId), render: (a) => `<div class="cell-main">${esc(doctorName(a.doctorId))}</div><div class="cell-sub">${esc(a.provisionalDiagnosis)}</div>` },
    { key: 'payer', label: 'Payer', value: (a) => a.payer.type, render: payerTag },
    { key: 'days', label: 'Days', align: 'right', value: (a) => daysAdmitted(a), render: (a) => daysAdmitted(a) },
    { key: 'bill', label: 'Bill', align: 'right', value: (a) => ipPosition(a).net, render: (a) => fmtINR(ipPosition(a).net) },
    { key: 'paid', label: 'Paid', align: 'right', value: (a) => ipPosition(a).paid, render: (a) => fmtINR(ipPosition(a).paid) },
    { key: 'bal', label: 'Patient balance', align: 'right', value: (a) => ipPosition(a).balance, render: (a) => { const p = ipPosition(a); return `<span class="${p.balance > 0 ? (p.low ? 'text-danger strong' : 'text-warning') : 'text-success'}">${fmtINR(p.balance)}</span>`; } },
    { key: 'status', label: 'Status', value: (a) => a.status, render: (a) => cbadge(a.status) + (ipPosition(a).low ? ' <span class="tag tag-danger">Low deposit</span>' : '') }
  ];
  const t = dataTable({ columns: cols, rows: [], pageSize: 25, onRowClick: (a) => navigate('#/ip/admissions/' + a.id), sort: { key: 'id', dir: 'desc' } });
  view.querySelector('[data-table]').appendChild(t.el);
  const apply = () => { const s = q.trim().toLowerCase(); t.setRows(rowsFor(tab).filter((a) => !s || [a.id, patient(a.patientId).name, patient(a.patientId).uhid, bedCode(currentBedId(a)), a.provisionalDiagnosis].join(' ').toLowerCase().includes(s))); };
  const counts = { admitted: rowsFor('admitted').length, discharging: rowsFor('discharging').length, low: rowsFor('low').length, discharged: rowsFor('discharged').length };
  tabs(view.querySelector('[data-tabs]'), [{ id: 'admitted', label: 'Admitted', count: counts.admitted }, { id: 'discharging', label: 'Discharge in progress', count: counts.discharging }, { id: 'low', label: 'Low deposit', count: counts.low },
    { id: 'discharged', label: 'Discharged', count: counts.discharged }, { id: 'all', label: 'All' }], tab, (x) => { tab = x; apply(); });
  view.querySelector('[data-q]').addEventListener('input', debounce((e) => { q = e.target.value; apply(); }, 150));
  view.querySelector('[data-csv]').onclick = () => exportTable(`ip-patients-${tab}.csv`, cols, t.getRows());
  apply();
}

// ---------------- folio ----------------
export function renderFolio(view, params, query) {
  const u = currentUser();
  let tab = query.tab || 'bill';
  const draw = () => {
    const a = admission(params.id);
    if (!a) { view.innerHTML = emptyState('file-x', 'Admission not found', '', '<a class="btn btn-primary" href="#/ip/admissions">IP Patients</a>'); return; }
    const p = patient(a.patientId); const pos = ipPosition(a); const open = a.status !== 'DISCHARGED'; const fb = finalBill(a);
    setMeta({ title: `${p.name} · ${a.id}`, crumbs: [{ label: 'Inpatient' }, { label: 'IP Patients', href: '#/ip/admissions' }, a.id] });
    const act = [];
    if (open && !fb && can('ip.indent.raise')) act.push(`<button class="btn btn-secondary" data-a="indent">${icon('pill-bottle')}Raise indent</button>`);
    if (open && can('ip.round')) act.push(`<button class="btn btn-secondary" data-a="round">${icon('stethoscope')}Round note</button>`);
    if (open && can('ip.nursing')) act.push(`<button class="btn btn-secondary" data-a="nursing">${icon('heart-pulse')}Vitals / nursing note</button>`);
    if (open && !fb && can('ip.charge')) act.push(`<button class="btn btn-secondary" data-a="charge">${icon('plus')}Add charge</button>`);
    if (open && can('ip.deposit')) act.push(`<button class="btn btn-secondary" data-a="deposit">${icon('wallet')}Deposit</button>`);
    if (open && !fb && a.status === 'ADMITTED' && can('ip.transfer')) act.push(`<button class="btn btn-secondary" data-a="transfer">${icon('arrow-right-left')}Transfer bed</button>`);
    act.push(`<a class="btn btn-secondary" href="#/ip/print/${a.id}?doc=${fb ? 'final' : 'interim'}">${icon('printer')}${fb ? 'Final bill' : 'Interim bill'}</a>`);
    if (a.status === 'ADMITTED' && can('ip.discharge.initiate')) act.push(`<button class="btn btn-primary" data-a="discharge">${icon('log-out')}Initiate discharge</button>`);
    if (a.status !== 'ADMITTED') act.push(`<a class="btn btn-primary" href="#/ip/admissions/${a.id}/discharge">${icon('clipboard-check')}${a.status === 'DISCHARGED' ? 'Discharge record' : 'Discharge workspace'}</a>`);
    const appr = payerApproved(a);
    view.innerHTML = `
      <div class="folio-hero">${patientStrip(p, { dark: true, extra: cbadge(a.status) })}
        <div class="folio-meta"><span>${icon('hash')}<strong class="mono">${esc(a.id)}</strong></span><span>${icon('bed-double')}Bed <strong>${esc(bedCode(currentBedId(a)))}</strong></span><span>${icon('stethoscope')}<strong>${esc(doctorName(a.doctorId))}</strong> · ${esc(deptName(a.departmentId))}</span>
          <span>${icon('calendar')}Admitted <strong>${fmtDateTime(a.admittedAt)}</strong> · day ${daysAdmitted(a)}</span><span>${icon('activity')}${esc(a.provisionalDiagnosis)}</span>
          <span>${icon('user-round')}Attender <strong>${esc(a.attender.name)}</strong> (${esc(a.attender.relation)}) · ${esc(a.attender.phone)}</span>${a.mlc ? '<span class="tag tag-danger">MLC</span>' : ''}${a.opVisitId ? `<span>${icon('link')}<a href="#/op/visits/${a.opVisitId}" style="color:#5fe0dc">${esc(a.opVisitId)}</a></span>` : ''}</div>
        <div class="folio-actions">${act.join('')}</div></div>
      <div class="money-strip mt-2">
        <div class="money-cell"><span>${fb ? 'Final bill (net)' : 'Running bill'}</span><strong>${fmtINR(pos.net)}</strong><small>${fb ? esc(fb.id) : 'bed & nursing up to today'}</small></div>
        <div class="money-cell"><span>Paid by patient</span><strong>${fmtINR(pos.paid)}</strong><small>deposits + payments − refunds</small></div>
        ${a.payer.type !== 'SELF' ? `<div class="money-cell"><span>${a.payer.type === 'INSURANCE' ? 'Insurer covers' : 'Company covers'}</span><strong>${fmtINR(pos.split.payerPays)}</strong><small>${appr ? `approved ${fmtINR(appr, true)}` : label(a.payer.preAuth?.stage)}${a.payer.coPayPct ? ` · co-pay ${a.payer.coPayPct}%` : ''}</small></div>` : ''}
        <div class="money-cell ${pos.balance > 0 ? (pos.low ? 'bad' : '') : 'good'}"><span>${pos.balance >= 0 ? 'Patient still to pay' : 'Refund due to patient'}</span><strong>${fmtINR(Math.abs(pos.balance))}</strong><small>${pos.low ? 'Low deposit — collect more' : a.payer.type !== 'SELF' ? `incl. non-payable ${fmtINR(pos.split.nonPayable, true)}` : ''}</small></div>
      </div>
      <section class="card flush mt-2"><div data-tabs></div><div data-tabbody class="card-body"></div></section>`;
    const tabItems = [{ id: 'bill', label: 'Bill & charges', icon: 'receipt-text' }, { id: 'meds', label: 'Medicines', icon: 'pill', count: indentsOf(a.id).length }, { id: 'pay', label: 'Payments', icon: 'wallet', count: receiptsFor(a.id).length },
      { id: 'beds', label: 'Bed & transfers', icon: 'bed-double', count: staysOf(a.id).length }, { id: 'notes', label: 'Notes & vitals', icon: 'notebook-pen', count: a.notes.length }, ...(a.payer.type !== 'SELF' ? [{ id: 'ins', label: 'Insurance', icon: 'shield-plus' }] : [])];
    tabs(view.querySelector('[data-tabs]'), tabItems, tab, (x) => { tab = x; drawTab(a); });
    drawTab(a);
    view.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => action(b.dataset.a, a); });
    refreshIcons(view);
  };
  const host = () => view.querySelector('[data-tabbody]');
  const drawTab = (a) => {
    const h = host(); const fb = finalBill(a); const open = a.status !== 'DISCHARGED';
    if (tab === 'bill') {
      const pos = ipPosition(a); const lines = pos.lines;
      h.innerHTML = `<div class="row-between mb-2"><div class="chip-row">${groupTotals(lines).map((g) => `<span class="pill-soft">${esc(g.label)} <strong>${fmtINR(g.amount, true)}</strong></span>`).join('')}</div>${fb ? `<span class="muted small">Frozen in ${esc(fb.id)} on ${fmtDateTime(fb.finalisedAt)}</span>` : ''}</div>
        <div class="table-scroll"><table class="table dense"><thead><tr><th>Date</th><th>Description</th><th class="ta-right">Qty</th><th class="ta-right">Rate</th><th class="ta-right">Amount</th><th>By</th><th></th></tr></thead><tbody>
        ${GROUP_ORDER.filter((g) => lines.some((l) => l.group === g)).map((g) => `<tr class="grp-row"><td colspan="7">${esc(GROUPS[g])}</td></tr>` + lines.filter((l) => l.group === g).map((l) => {
          const c = l.chargeId ? store.get('ipCharges', l.chargeId) : null;
          return `<tr><td class="small nowrap">${l.auto ? `${fmtDate(l.from)}${l.to !== l.from ? ' – ' + fmtDate(l.to) : ''}` : fmtDateTime(l.at).replace(', ', ' · ')}</td><td>${esc(l.description)}${labTag(c)}${l.auto ? ' <span class="tag tag-info">auto</span>' : ''}${l.nonPayable && a.payer.type !== 'SELF' ? ' <span class="tag tag-warning" title="Not covered by insurance">non-payable</span>' : ''}</td>
            <td class="ta-right">${l.qty}</td><td class="ta-right">${fmtINR(l.rate)}</td><td class="ta-right ${l.amount < 0 ? 'text-success' : ''}">${fmtINR(l.amount)}</td><td class="small">${c ? esc(userName(c.postedBy)) : ''}</td>
            <td>${c && !fb && open && can('ip.charge') && !['INDENT', 'INDENT_RETURN'].includes(c.source) ? `<button class="icon-btn" data-rev="${c.id}" title="Reverse charge">${icon('undo-2')}</button>` : ''}</td></tr>`; }).join('')).join('')}
        ${chargesOf(a.id).filter((c) => c.reversed).map((c) => `<tr class="reversed"><td class="small">${fmtDateTime(c.at)}</td><td>${esc(c.description)} <span class="tag tag-danger" style="text-decoration:none">reversed: ${esc(c.reversed.reason)}</span></td><td class="ta-right">${c.qty}</td><td class="ta-right">${fmtINR(c.rate)}</td><td class="ta-right">${fmtINR(c.amount)}</td><td class="small">${esc(userName(c.reversed.by))}</td><td></td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="4" class="ta-right strong">Gross</td><td class="ta-right strong">${fmtINR(pos.gross)}</td><td colspan="2"></td></tr>${pos.discount ? `<tr><td colspan="4" class="ta-right">Discount</td><td class="ta-right">− ${fmtINR(pos.discount)}</td><td colspan="2"></td></tr>` : ''}</tfoot></table></div>`;
      h.querySelectorAll('[data-rev]').forEach((b) => { b.onclick = async () => { const r = await confirmDialog({ title: 'Reverse this charge?', message: 'The charge stays in the history, struck through, and is removed from the bill.', confirmLabel: 'Reverse', tone: 'danger', reason: true }); if (!r) return; try { reverseCharge(b.dataset.rev, r.reason, u); toast('Charge reversed.', 'success'); draw(); } catch (e) { toast(e.message, 'error'); } }; });
    }
    if (tab === 'meds') {
      const ins = indentsOf(a.id);
      h.innerHTML = ins.length ? `<div class="ind-grid">${ins.map((i) => indentCard(i, { canReturn: open && !fb && can('ip.indent.issue') })).join('')}</div>` : emptyState('pill', 'No medicine indents yet', can('ip.indent.raise') ? 'Use “Raise indent” to request medicines from the pharmacy.' : '');
      h.querySelectorAll('[data-ret]').forEach((b) => { b.onclick = () => openReturn(b.dataset.ret, draw); });
    }
    if (tab === 'pay') {
      const rs = receiptsFor(a.id).slice().sort((x, y) => y.at.localeCompare(x.at));
      h.innerHTML = rs.length ? `<table class="table dense"><thead><tr><th>Receipt</th><th>Date</th><th>Type</th><th>Mode</th><th>Reference</th><th class="ta-right">Amount</th><th>By</th><th></th></tr></thead><tbody>
        ${rs.map((r) => `<tr><td class="mono">${esc(r.id)}</td><td class="small">${fmtDateTime(r.at)}</td><td>${r.kind === 'DEPOSIT' ? '<span class="tag tag-info">Deposit</span>' : r.kind === 'REFUND' ? '<span class="tag tag-warning">Refund</span>' : '<span class="tag tag-success">Settlement</span>'}</td><td>${esc(modeLabel(r.mode))}</td><td class="small">${esc(r.reference || '—')}</td>
          <td class="ta-right ${r.kind === 'REFUND' ? 'text-warning' : ''}">${r.kind === 'REFUND' ? '− ' : ''}${fmtINR(r.amount)}</td><td class="small">${esc(userName(r.userId))}</td><td><a class="btn btn-ghost btn-sm" href="#/ip/print/${a.id}?doc=deposit&r=${r.id}">${icon('printer')}</a></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="5" class="ta-right strong">Net received</td><td class="ta-right strong">${fmtINR(ipPosition(a).paid)}</td><td colspan="2"></td></tr></tfoot></table>` : emptyState('wallet', 'No deposits yet');
    }
    if (tab === 'beds') {
      const ss = staysOf(a.id);
      h.innerHTML = `<ul class="timeline">${ss.map((s) => `<li><span class="tl-dot ${s.to ? 'info' : 'success'}">${icon('bed-double')}</span><strong>${esc(bedCode(s.bedId))} · ${esc(categoryLabel(s.category))}</strong><p>${fmtDateTime(s.from)} → ${s.to ? fmtDateTime(s.to) : '<strong>now</strong>'} · ${esc(s.reason)}</p><p class="tiny">${esc(userName(s.by))}</p></li>`).join('')}</ul>
        <p class="muted small">Billing rule: each calendar day is charged at the bed occupied at the end of that day; the discharge day is free when the patient leaves before ${store.all('clinicalSettings').ip.checkoutHour}:00.</p>`;
    }
    if (tab === 'notes') {
      const ns = [...a.notes].sort((x, y) => y.at.localeCompare(x.at));
      h.innerHTML = ns.length ? `<div class="note-list">${ns.map((n) => `<div class="note-item"><span class="tl-dot ${n.kind === 'ROUND' ? 'info' : n.kind === 'VITALS' ? 'success' : 'warning'}">${icon(n.kind === 'ROUND' ? 'stethoscope' : n.kind === 'VITALS' ? 'heart-pulse' : 'notebook-pen')}</span>
        <div class="grow"><strong>${n.kind === 'ROUND' ? 'Doctor round' : n.kind === 'VITALS' ? 'Vitals' : 'Nursing note'} · ${esc(userName(n.by))}</strong> <span class="muted small">${fmtDateTime(n.at)}</span>${n.text ? `<p>${esc(n.text)}</p>` : ''}${n.vitals ? `<div class="mt-1">${vitalsChips(n.vitals, { compact: true })}</div>` : ''}</div></div>`).join('')}</div>` : emptyState('notebook-pen', 'No notes yet');
    }
    if (tab === 'ins') {
      const pa = a.payer.preAuth; const cl = a.payer.claim;
      h.innerHTML = `<div class="grid grid-2"><div>${[['Payer', esc(label(a.payer.type))], a.payer.type === 'INSURANCE' ? ['TPA', esc(tpaName(a.payer.tpaId))] : ['Company', esc(a.payer.corporate)], a.payer.type === 'INSURANCE' ? ['Insurer', esc(a.payer.insurer)] : null,
        a.payer.policyNo ? ['Policy no.', `<span class="mono">${esc(a.payer.policyNo)}</span>`] : null, ['Member / employee ID', esc(a.payer.memberId || '—')], ['Co-pay', `${a.payer.coPayPct}%`]].filter(Boolean).map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`).join('')}</div>
        <div>${pa ? [['Stage', cbadge(pa.stage === 'APPROVED' ? 'FINAL_APPROVED' : pa.stage, label(pa.stage))], ['Requested', fmtINR(pa.requested)], ['Approved', fmtINR(pa.approved)], ['Reference', esc(pa.refNo || '—')], cl ? ['Claim', `${esc(CLAIM_LABEL[cl.status])}${cl.reference ? ' · ' + esc(cl.reference) : ''}`] : null].filter(Boolean).map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`).join('') : ''}
          ${can('ip.tpa') && a.payer.type === 'INSURANCE' && open ? `<button class="btn btn-primary btn-sm mt-1" data-pa>${icon('shield-plus')}Update approval</button>` : ''}</div></div>
        ${pa ? `<h3 class="section-title mt-2">History</h3><ul class="timeline">${pa.history.slice().reverse().map((x) => `<li><span class="tl-dot info">${icon('shield-plus')}</span><strong>${esc(label(x.stage))}${x.amount ? ' · ' + fmtINR(x.amount, true) : ''}</strong><p>${esc(x.note || '')}${x.refNo ? ' · ref ' + esc(x.refNo) : ''}</p><p class="tiny">${fmtDateTime(x.at)} · ${esc(userName(x.by))}</p></li>`).join('')}</ul>` : ''}`;
      h.querySelector('[data-pa]')?.addEventListener('click', () => openPreAuth(a.id, draw));
    }
    refreshIcons(h);
  };
  const action = async (k, a) => {
    if (k === 'transfer') return openTransfer(a.id, draw);
    if (k === 'deposit') return openDeposit(a.id, draw);
    if (k === 'charge') return openCharge(a.id, draw);
    if (k === 'indent') return openIndent(a.id, draw);
    if (k === 'round' || k === 'nursing') return openNote(a.id, k, draw);
    if (k === 'discharge') return openInitiate(a.id);
  };
  draw();
  const off = store.subscribe(debounce(() => { if (!document.querySelector('.modal-backdrop')) draw(); }, 400));
  return () => off();
}

export function indentCard(i, { canReturn = false, issue = false } = {}) {
  const p = patient(i.patientId);
  return `<div class="ind-card ${i.priority === 'STAT' && i.status === 'RAISED' ? 'stat' : ''}"><div class="ind-head"><div><strong class="mono">${esc(i.id)}</strong> ${i.priority === 'STAT' ? cbadge('STAT') : ''}<div class="small muted">${esc(p.name)} · bed ${esc(bedCode(i.bedId))} · raised ${relTime(i.raisedAt)} by ${esc(userName(i.raisedBy))}</div></div>${cbadge(i.status)}</div>
    ${i.note ? `<div class="small">${icon('message-square', 'ic-inline')} ${esc(i.note)}</div>` : ''}
    <table class="table dense"><thead><tr><th>Medicine</th><th class="ta-right">Asked</th><th class="ta-right">${i.status === 'RAISED' ? 'On shelf' : 'Issued'}</th>${i.items.some((x) => x.returnedQty) ? '<th class="ta-right">Returned</th>' : ''}</tr></thead><tbody>
    ${i.items.map((x) => `<tr><td>${esc(medName(x.medicineId))}${x.batches.length ? `<div class="cell-sub">${x.batches.map((b) => `${esc(b.batchNo)} × ${b.qty} @ ${fmtINR(b.mrp)}`).join(', ')}</div>` : ''}</td><td class="ta-right">${x.qty}</td>
      <td class="ta-right">${i.status === 'RAISED' ? `<span class="${stockFor(x.medicineId) >= x.qty ? 'text-success' : 'text-danger'}">${stockFor(x.medicineId)}</span>` : x.issuedQty}</td>${i.items.some((y) => y.returnedQty) ? `<td class="ta-right">${x.returnedQty || ''}</td>` : ''}</tr>`).join('')}</tbody></table>
    ${i.cancel ? `<div class="small text-danger">Cancelled: ${esc(i.cancel.reason)}</div>` : ''}
    <div class="row">${issue && i.status === 'RAISED' ? `<button class="btn btn-primary btn-sm" data-issue="${i.id}">${icon('package-check')}Issue (FEFO)</button><button class="btn btn-ghost btn-sm" data-cancel="${i.id}">Cancel</button>` : ''}
      ${canReturn && ['ISSUED', 'PARTIAL'].includes(i.status) ? `<button class="btn btn-ghost btn-sm" data-ret="${i.id}">${icon('undo-2')}Ward return</button>` : ''}${i.issuedAt ? `<span class="muted small">Issued ${relTime(i.issuedAt)} by ${esc(userName(i.issuedBy))}</span>` : ''}</div></div>`;
}

// ---------------- modals ----------------
export function openDeposit(admId, after) {
  const a = admission(admId);
  const pos = ipPosition(a);
  const m = openModal({ title: 'Collect deposit', subtitle: `${esc(patient(a.patientId).name)} · ${a.id} · patient balance ${fmtINR(pos.balance)}`, body: '<div data-pp></div>',
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save deposit', cls: 'btn-primary', icon: 'check', onClick: (c) => { try { const r = addDeposit(admId, pp.get(), currentUser()); toast(`Deposit ${r.id} saved.`, 'success'); c(); after?.(); } catch (e) { toast(e.message, 'error'); } } }] });
  const pp = payPanel(m.el.querySelector('[data-pp]'), { amount: Math.max(0, Math.ceil(pos.balance / 1000) * 1000) || 5000, label: 'Deposit amount' });
}
function openCharge(admId, after) {
  const opts = servicesFor('IP');
  const cats = [['INVESTIGATION', 'Investigations'], ['PROCEDURE', 'Procedures'], ['OT', 'OT & surgery'], ['NURSING_SERVICE', 'Nursing services'], ['OTHER', 'Other']];
  const m = openModal({ title: 'Add charge', subtitle: `Posted to ${admId}. Bed, nursing and doctor rounds are added automatically.`, body: `<div class="form-grid"><div class="field col-9"><label>Service</label><select class="input" data-s><option value="">Choose…</option>${cats.map(([k, l]) => `<optgroup label="${l}">${opts.filter((s) => s.category === k).map((s) => `<option value="${s.id}">${esc(s.name)} — ${fmtINR(s.rate, true)}${s.unit !== 'each' ? '/' + s.unit : ''}${s.nonPayable ? ' (non-payable)' : ''}</option>`).join('')}</optgroup>`).join('')}</select></div>
    <div class="field col-3"><label>Quantity</label><input class="input" type="number" min="1" value="1" data-q></div></div><div class="kv strong mt-1"><span>Amount</span><span data-amt>₹0.00</span></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Post charge', cls: 'btn-primary', icon: 'plus', onClick: (c) => { try { const pc = postCharge(admId, { serviceId: m.el.querySelector('[data-s]').value, qty: m.el.querySelector('[data-q]').value }, currentUser()); const lv = pc.source === 'LAB' && store.get('labVisits', store.get('orders', pc.refId)?.labVisitId); toast(lv ? `Charge posted and sent to the lab — SID ${lv.sid}, collect at the bedside.` : 'Charge posted.', 'success'); c(); after?.(); } catch (e) { toast(e.message, 'error'); } } }] });
  const upd = () => { const s = service(m.el.querySelector('[data-s]').value); m.el.querySelector('[data-amt]').textContent = fmtINR(s ? s.rate * (Number(m.el.querySelector('[data-q]').value) || 0) : 0); };
  m.el.addEventListener('input', upd); m.el.addEventListener('change', upd);
}
function openNote(admId, kind, after) {
  const isRound = kind === 'round';
  const m = openModal({ title: isRound ? 'Doctor round' : 'Vitals / nursing note', subtitle: isRound ? 'A consultant visit charge is added to the bill.' : '', size: 'lg',
    body: `${isRound ? '' : vitalsForm()}<div class="field mt-1"><label>${isRound ? 'Round notes / plan' : 'Nursing note'}</label><textarea class="input" rows="3" data-t placeholder="${isRound ? 'Findings, plan, orders' : 'Optional — intake/output, care given, observations'}"></textarea></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', cls: 'btn-primary', icon: 'save', onClick: (c) => {
      const vit = read ? read() : null; const hasV = vit && Object.values(vit).some((x) => x !== '');
      try { addNote(admId, { kind: isRound ? 'ROUND' : hasV ? 'VITALS' : 'NURSING', text: m.el.querySelector('[data-t]').value, vitals: hasV ? Object.fromEntries(Object.entries(vit).filter(([, x]) => x !== '').map(([k, x]) => [k, k === 'bp' ? x : Number(x)])) : null }, currentUser()); toast('Saved.', 'success'); c(); after?.(); } catch (e) { toast(e.message, 'error'); }
    } }] });
  const read = isRound ? null : wireVitalsForm(m.el);
}
export function openIndent(admId, after) {
  const rows = [{ medicineId: '', qty: 1 }]; let priority = 'ROUTINE';
  const a = admission(admId);
  const opts = store.all('medicines').filter((x) => x.active).map((x) => ({ value: x.id, label: x.brandName, sub: `${x.genericName} · ${x.form} · on pharmacy shelf: ${stockFor(x.id)} ${x.unit}`, keywords: x.genericName }));
  const m = openModal({ title: 'Raise ward indent', subtitle: `${esc(patient(a.patientId).name)} · bed ${esc(bedCode(currentBedId(a)))} · ${a.id}`, size: 'lg',
    body: `<table class="table dense"><thead><tr><th>Medicine</th><th style="width:110px">Quantity</th><th style="width:110px" class="ta-right">On shelf</th><th></th></tr></thead><tbody data-rows></tbody></table>
      <button class="btn btn-ghost btn-sm mt-1" data-add>${icon('plus')}Add medicine</button>
      <div class="form-grid mt-2"><div class="field col-4"><label>Priority</label><div class="seg seg-full"><button type="button" class="seg-btn active" data-p="ROUTINE">Routine</button><button type="button" class="seg-btn" data-p="STAT">${icon('siren')}STAT</button></div></div>
      <div class="field col-8"><label>Note to pharmacy</label><input class="input" data-note placeholder="Optional"></div></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Send to pharmacy', cls: 'btn-primary', icon: 'send', onClick: (c) => { try { const i = raiseIndent(admId, { items: rows, priority, note: m.el.querySelector('[data-note]').value }, currentUser()); toast(`${i.id} sent to pharmacy.`, 'success'); c(); after?.(); } catch (e) { toast(e.message, 'error'); } } }] });
  const draw = () => {
    const tb = m.el.querySelector('[data-rows]');
    tb.innerHTML = rows.map((r, i) => `<tr data-i="${i}"><td><div data-med></div></td><td><input class="input input-sm" type="number" min="1" step="1" value="${r.qty}" data-q></td><td class="ta-right">${r.medicineId ? `<span class="${stockFor(r.medicineId) >= r.qty ? 'text-success' : 'text-danger'}">${stockFor(r.medicineId)}</span>` : '—'}</td><td><button class="icon-btn" data-rm="${i}">${icon('x')}</button></td></tr>`).join('');
    tb.querySelectorAll('tr').forEach((tr) => { const i = +tr.dataset.i;
      combo(tr.querySelector('[data-med]'), { options: opts, value: rows[i].medicineId, placeholder: 'Search medicine…', onChange: (id) => { rows[i].medicineId = id; setTimeout(draw); } });
      tr.querySelector('[data-q]').addEventListener('change', (e) => { rows[i].qty = Number(e.target.value); setTimeout(draw); }); });
    refreshIcons(tb);
  };
  m.el.querySelector('[data-add]').onclick = () => { rows.push({ medicineId: '', qty: 1 }); draw(); };
  m.el.addEventListener('click', (e) => { const r = e.target.closest('[data-rm]'); if (r && rows.length > 1) { rows.splice(+r.dataset.rm, 1); draw(); } const p = e.target.closest('[data-p]'); if (p) { priority = p.dataset.p; m.el.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('active', x === p)); } });
  draw();
}
export function openReturn(indentId, after) {
  const ind = store.get('ipIndents', indentId);
  const lines = ind.items.flatMap((x) => x.batches.map((b) => ({ medicineId: x.medicineId, batchId: b.batchId, batchNo: b.batchNo, max: returnableQty(ind, x.medicineId, b.batchId), qty: 0 }))).filter((l) => l.max > 0);
  const m = openModal({ title: `Ward return · ${ind.id}`, subtitle: 'Only unopened, undamaged units go back to pharmacy stock. The patient’s bill gets a credit at the same MRP.', size: 'lg',
    body: lines.length ? `<table class="table dense"><thead><tr><th>Medicine</th><th>Batch</th><th class="ta-right">Can return</th><th style="width:110px">Return</th></tr></thead><tbody>${lines.map((l, i) => `<tr><td>${esc(medName(l.medicineId))}</td><td class="mono">${esc(l.batchNo)}</td><td class="ta-right">${l.max}</td><td><input class="input input-sm" type="number" min="0" max="${l.max}" value="0" data-i="${i}"></td></tr>`).join('')}</tbody></table>
      <div class="field mt-1"><label>Reason</label><input class="input" data-r value="Unused at discharge / stopped by doctor"></div>` : '<p class="muted">Everything issued has already been returned.</p>',
    footer: [{ label: 'Cancel', onClick: (c) => c() }, ...(lines.length ? [{ label: 'Receive return', cls: 'btn-primary', icon: 'undo-2', onClick: (c) => {
      m.el.querySelectorAll('[data-i]').forEach((x) => { lines[+x.dataset.i].qty = Number(x.value) || 0; });
      try { returnFromWard(indentId, lines, m.el.querySelector('[data-r]').value, currentUser()); toast('Return received. Stock added back and bill credited.', 'success'); c(); after?.(); } catch (e) { toast(e.message, 'error'); }
    } }] : [])] });
}
function openInitiate(admId) {
  const m = openModal({ title: 'Initiate discharge', subtitle: 'Pharmacy, nursing and billing are notified. Write the discharge summary from the discharge workspace.',
    body: `<div class="form-grid"><div class="field col-6"><label>Discharge type</label><select class="input" data-type>${['NORMAL', 'LAMA', 'REFERRED', 'DEATH'].map((t) => `<option value="${t}">${esc(label(t))}</option>`).join('')}</select></div>
      <div class="field col-6"><label>Expected discharge time</label><input class="input" type="datetime-local" data-at value="${localDateTimeValue(new Date(Date.now() + 3 * 3600000))}"></div>
      <div class="field col-12"><label>Note</label><input class="input" data-note placeholder="Optional — e.g. review reports before leaving"></div></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Initiate discharge', cls: 'btn-primary', icon: 'log-out', onClick: (c) => {
      try { initiateDischarge(admId, { type: m.el.querySelector('[data-type]').value, expectedAt: m.el.querySelector('[data-at]').value, note: m.el.querySelector('[data-note]').value }, currentUser()); toast('Discharge initiated. Departments notified.', 'success'); c(); navigate(`#/ip/admissions/${admId}/discharge`); } catch (e) { toast(e.message, 'error'); }
    } }] });
}
export function openPreAuth(admId, after) {
  const a = admission(admId); const pa = a.payer.preAuth;
  const m = openModal({ title: 'Update insurance approval', subtitle: `${esc(tpaName(a.payer.tpaId))} · ${esc(a.payer.insurer)} · policy ${esc(a.payer.policyNo)}`,
    body: `<div class="form-grid"><div class="field col-6"><label>Stage</label><select class="input" data-st>${PREAUTH_STAGES.map((s) => `<option value="${s}" ${s === pa.stage ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select></div>
      <div class="field col-6"><label>Amount</label><div class="input-prefix"><span>₹</span><input class="input" type="number" min="0" data-amt value="${pa.stage === 'PREAUTH_PENDING' ? pa.requested : pa.approved}"></div><div class="field-hint">Requested amount for pre-auth / enhancement; approved amount for approvals.</div></div>
      <div class="field col-6"><label>Approval reference</label><input class="input" data-ref value="${esc(pa.refNo || '')}"></div>
      <div class="field col-6"><label>Note</label><input class="input" data-note placeholder="e.g. Approval mail received; query raised for ICU notes"></div></div>
      <div class="stage-flow mt-2">${['PREAUTH_PENDING', 'APPROVED', 'ENHANCEMENT_PENDING', 'FINAL_APPROVED'].map((s) => `<span class="${s === pa.stage ? 'on' : ''}">${esc(label(s))}</span>`).join('→')}</div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', cls: 'btn-primary', icon: 'save', onClick: (c) => {
      try { updatePreAuth(admId, { stage: m.el.querySelector('[data-st]').value, amount: m.el.querySelector('[data-amt]').value, refNo: m.el.querySelector('[data-ref]').value, note: m.el.querySelector('[data-note]').value }, currentUser()); toast('Approval updated.', 'success'); c(); after?.(); } catch (e) { toast(e.message, 'error'); }
    } }] });
}
export const pendingCount = (a) => pendingIndentsOf(a.id).length;
