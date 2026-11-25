// Discharge workspace (clearances, discharge summary, final bill with payer split, settlement, discharge) and IP printouts.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { patient, doctor, doctorName, deptName, bedCode, categoryLabel, cbadge, label, tpaName, receiptsFor, modeLabel, pendingRequestFor } from '../clinical.js';
import { admission, ipPosition, groupTotals, GROUPS, GROUP_ORDER, daysAdmitted, currentBedId, staysOf, finalBill, dischargeChecklist, clearDept, saveSummary, finaliseBill, settleBill, reopenBill,
  completeDischarge, pendingIndentsOf, cancelDischarge, billLines } from '../ip.js';
import { userName } from '../calculations.js';
import { patientStrip, payPanel, docHead, docFoot, signLine, ageSex } from './clinical-ui.js';
import { openPreAuth } from './ip-folio.js';
import { emptyState, confirmDialog, card } from '../components.js';
import { barcodeSVG } from '../barcode.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtDate, fmtDateTime, relTime, refreshIcons, debounce, ymd } from '../utils.js';
import { setMeta } from '../app.js';

import { discountLimit } from '../clinical.js';

const SUMMARY_FIELDS = [['finalDiagnosis', 'Final diagnosis', 2, true], ['presentingComplaints', 'Presenting complaints', 2], ['course', 'Course in hospital', 4, true], ['procedures', 'Procedures / surgery', 2],
  ['investigations', 'Key investigations', 2], ['condition', 'Condition at discharge', 2, true], ['medicines', 'Medicines on discharge', 3], ['advice', 'Advice on discharge', 3, true]];

export function render(view, params) {
  const u = currentUser();
  const draw = () => {
    const a = admission(params.id);
    if (!a) { view.innerHTML = emptyState('file-x', 'Admission not found'); return; }
    const p = patient(a.patientId);
    setMeta({ title: `Discharge · ${p.name}`, crumbs: [{ label: 'Inpatient' }, { label: a.id, href: '#/ip/admissions/' + a.id }, 'Discharge'] });
    if (a.status === 'ADMITTED') {
      view.innerHTML = emptyState('log-out', 'Discharge has not been initiated', 'The treating doctor starts the discharge from the patient folio.', `<a class="btn btn-primary" href="#/ip/admissions/${a.id}">Open folio</a>`);
      refreshIcons(view); return;
    }
    const list = dischargeChecklist(a); const fb = finalBill(a); const done = list.every((c) => c.done);
    const s = a.discharge.summary || {};
    const sumEditable = can('ip.summary') && s.status !== 'FINAL' && a.status !== 'DISCHARGED';
    view.innerHTML = `
      <div class="visit-hero">${patientStrip(p, { extra: cbadge(a.status) })}
        <div class="vh-meta"><div><span class="lbl-sm">IP number</span><strong class="mono">${esc(a.id)}</strong><small>Bed ${esc(bedCode(currentBedId(a)))} · day ${daysAdmitted(a)}</small></div>
          <div><span class="lbl-sm">Consultant</span><strong>${esc(doctorName(a.doctorId))}</strong><small>${esc(deptName(a.departmentId))}</small></div>
          <div><span class="lbl-sm">Discharge type</span><strong>${esc(label(a.discharge.type))}</strong><small>initiated ${relTime(a.discharge.initiatedAt)} by ${esc(userName(a.discharge.initiatedBy))}</small></div>
          <div><span class="lbl-sm">Payer</span><strong>${esc(label(a.payer.type))}</strong><small>${a.payer.type === 'INSURANCE' ? esc(tpaName(a.payer.tpaId)) : a.payer.corporate ? esc(a.payer.corporate) : ''}</small></div></div>
        <div class="vh-actions"><a class="btn btn-ghost" href="#/ip/admissions/${a.id}">${icon('arrow-left')}Folio</a>
          ${s.status === 'FINAL' ? `<a class="btn btn-secondary" href="#/ip/print/${a.id}?doc=summary">${icon('file-text')}Discharge summary</a>` : ''}
          ${fb ? `<a class="btn btn-secondary" href="#/ip/print/${a.id}?doc=final">${icon('receipt-text')}Final bill</a>` : `<a class="btn btn-secondary" href="#/ip/print/${a.id}?doc=interim">${icon('receipt-text')}Interim bill</a>`}
          ${a.status === 'DISCHARGE_INITIATED' && can('ip.discharge.initiate') ? `<button class="btn btn-ghost" data-x="canceldis">${icon('rotate-ccw')}Cancel discharge</button>` : ''}
          ${a.status !== 'DISCHARGED' && done && (can('ip.bill.final') || can('ip.admit')) ? `<button class="btn btn-primary" data-x="discharge">${icon('door-open')}Discharge patient</button>` : ''}</div></div>
      ${a.status === 'DISCHARGED' ? `<div class="alert alert-success mt-2">${icon('check-circle-2')}<div><strong>Discharged ${fmtDateTime(a.discharge.dischargedAt)}</strong> by ${esc(userName(a.discharge.dischargedBy))}. Bed released for cleaning.</div></div>` : ''}
      <div class="grid grid-3-1 mt-2"><div class="col-stack">
        ${card('Clearances', `<div class="checklist">${list.map((c) => `<div class="chk ${c.done ? 'done' : ''}"><span class="chk-ic">${icon(c.done ? 'check' : 'circle')}</span><div><strong>${esc(c.label)}</strong><small>${c.done ? `${esc(userName(c.by))} · ${fmtDateTime(c.at)}${c.note ? ' · ' + esc(c.note) : ''}` : hint(a, c.key)}</small></div>${clearBtn(a, c)}</div>`).join('')}</div>`, { sub: 'All five are needed before the patient leaves.' })}
        <section class="card"><header class="card-head"><div><h2>Discharge summary</h2><p class="muted small">${s.status === 'FINAL' ? `Finalised by ${esc(userName(s.finalisedBy))} · ${fmtDateTime(s.finalisedAt)}` : 'Pre-filled from the admission, procedures and investigations. The doctor completes and finalises it.'}</p></div>${cbadge(s.status === 'FINAL' ? 'FINAL' : 'DRAFT_SUMMARY', s.status === 'FINAL' ? 'Final' : 'Draft')}</header>
          <div class="card-body">${sumEditable ? `<form class="form-grid" data-sum>${SUMMARY_FIELDS.map(([k, l, rows, req]) => `<div class="field col-${rows > 2 ? 12 : 6}"><label>${l}${req ? ' <span class="req">*</span>' : ''}</label><textarea class="input" rows="${rows}" name="${k}">${esc(s[k] || '')}</textarea></div>`).join('')}
            <div class="field col-4"><label>Follow-up date</label><input class="input" type="date" name="followUpDate" min="${ymd()}" value="${esc(s.followUpDate || '')}"></div><div class="field col-4"><label>Discharge type</label><select class="input" name="type">${['NORMAL', 'LAMA', 'REFERRED', 'DEATH'].map((t) => `<option value="${t}" ${a.discharge.type === t ? 'selected' : ''}>${esc(label(t))}</option>`).join('')}</select></div>
            <div class="col-12 row"><button type="button" class="btn btn-secondary" data-x="sumsave">${icon('save')}Save draft</button><button type="button" class="btn btn-primary" data-x="sumfinal">${icon('check-circle-2')}Finalise summary</button></div></form>`
            : `<dl class="ds-grid">${SUMMARY_FIELDS.map(([k, l]) => `<dt>${l}</dt><dd>${esc(s[k] || '—')}</dd>`).join('')}<dt>Follow-up</dt><dd>${s.followUpDate ? fmtDate(s.followUpDate) : '—'}</dd></dl>`}</div></section>
      </div><aside><div class="sticky-side" data-bill></div></aside></div>`;
    drawBill(view.querySelector('[data-bill]'), a);
    refreshIcons(view);
  };
  const hint = (a, k) => {
    if (k === 'pharmacy') { const n = pendingIndentsOf(a.id).length; return n ? `${n} indent(s) still pending in pharmacy` : 'Pharmacy confirms no pending indents and receives unused medicines back'; }
    if (k === 'nursing') return 'Lines removed, belongings and documents handed over';
    if (k === 'summary') return 'Doctor finalises the discharge summary';
    if (k === 'billing') return 'Final bill made and settled with the patient';
    return '';
  };
  const clearBtn = (a, c) => {
    if (c.done || a.status === 'DISCHARGED') return '';
    if (c.key === 'pharmacy' && can('ip.clear.pharmacy')) return `<button class="btn btn-secondary btn-sm" data-clear="pharmacy">Give clearance</button>`;
    if (c.key === 'nursing' && can('ip.clear.nursing')) return `<button class="btn btn-secondary btn-sm" data-clear="nursing">Give clearance</button>`;
    return '';
  };
  function drawBill(host, a) {
    const fb = finalBill(a); const pos = ipPosition(a);
    if (!fb) {
      const ready = a.clearances?.pharmacy && a.clearances?.nursing;
      host.innerHTML = `<div class="summary-box"><h3>Bill so far</h3>${groupTotals(pos.lines).map((g) => `<div class="summary-row"><span>${esc(g.label)}</span><b>${fmtINR(g.amount)}</b></div>`).join('')}
        <div class="summary-row total"><span>Running total</span><span>${fmtINR(pos.net)}</span></div><div class="summary-row"><span>Paid by patient</span><b>${fmtINR(pos.paid)}</b></div></div>
        ${can('ip.bill.final') ? `<section class="card mt-2"><div class="card-body"><h3 class="section-title">Make the final bill</h3>${!ready ? `<div class="alert alert-warning">${icon('lock')}<div>Needs pharmacy and nursing clearance first, so no charge is missed.</div></div>` : ''}
          <div class="form-grid mt-1"><div class="field col-4"><label>Discount %</label><input class="input" type="number" min="0" max="100" value="0" data-disc ${ready ? '' : 'disabled'}></div><div class="field col-8"><label>Reason</label><input class="input" data-dr placeholder="Required for a discount" ${ready ? '' : 'disabled'}></div></div>
          <p class="muted small">Up to ${discountLimit()}% directly; above that the Super Admin approves. Bed days are frozen at this moment (discharge day free before ${store.all('clinicalSettings').ip.checkoutHour}:00).</p>
          <button class="btn btn-primary btn-block mt-1" data-x="final" ${ready ? '' : 'disabled'}>${icon('receipt-text')}Make final bill</button></div></section>` : ''}`;
      return;
    }
    const sp = pos.split; const rq = pendingRequestFor(fb.id);
    const bal = pos.balance;
    host.innerHTML = `<div class="summary-box"><h3>Final bill ${esc(fb.id)}</h3>${groupTotals(fb.lines).map((g) => `<div class="summary-row"><span>${esc(g.label)}</span><b>${fmtINR(g.amount)}</b></div>`).join('')}
      <div class="summary-row"><span>Gross</span><b>${fmtINR(fb.gross)}</b></div>${fb.discount ? `<div class="summary-row"><span>Discount ${fb.discountPct}%</span><b>− ${fmtINR(fb.discount)}</b></div>` : ''}
      <div class="summary-row total"><span>Net bill</span><span>${fmtINR(fb.net)}</span></div>
      ${a.payer.type !== 'SELF' ? `<div class="summary-row"><span>${a.payer.type === 'INSURANCE' ? 'Insurer' : 'Company'} pays</span><b>− ${fmtINR(sp.payerPays)}</b></div><div class="summary-row"><span>· non-payable items</span><b>${fmtINR(sp.nonPayable)}</b></div>${sp.coPay ? `<div class="summary-row"><span>· co-pay ${a.payer.coPayPct}%</span><b>${fmtINR(sp.coPay)}</b></div>` : ''}${sp.excess ? `<div class="summary-row"><span>· above approval</span><b>${fmtINR(sp.excess)}</b></div>` : ''}` : ''}
      <div class="summary-row"><span>Patient's share</span><b>${fmtINR(sp.patientPays)}</b></div><div class="summary-row"><span>Paid (deposits − refunds)</span><b>− ${fmtINR(pos.paid)}</b></div></div>
      <section class="card mt-2"><div class="card-body" data-settle>
        ${fb.status === 'SETTLED' ? `<div class="settle-box zero">${icon('check-circle-2')} Settled ${fmtDateTime(fb.settledAt)} by ${esc(userName(fb.settledBy))}</div>`
          : fb.status === 'DISCOUNT_PENDING' ? `<div class="alert alert-info">${icon('hourglass')}<div>${fb.discountPct}% discount waiting for the Super Admin${rq ? ` · “${esc(rq.reason)}”` : ''}.</div></div>`
          : fb.status === 'AWAITING_TPA' ? `<div class="alert alert-info">${icon('shield-plus')}<div>Send the final bill and discharge summary to ${esc(tpaName(a.payer.tpaId))}, then record the final approval amount. Current stage: <strong>${esc(label(a.payer.preAuth.stage))}</strong>.</div></div>${can('ip.tpa') ? `<button class="btn btn-primary btn-block mt-1" data-x="tpa">${icon('shield-plus')}Record TPA final approval</button>` : ''}`
          : `<div class="settle-box ${bal > 0 ? 'collect' : bal < 0 ? 'refund' : 'zero'}">${bal > 0 ? 'Collect from patient' : bal < 0 ? 'Refund to patient' : 'Nothing to collect'}<strong>${fmtINR(Math.abs(bal))}</strong></div>${can('ip.bill.final') ? `<div data-pp class="mt-1"></div><button class="btn btn-primary btn-block mt-1" data-x="settle">${icon(bal < 0 ? 'undo-2' : 'check')}${bal > 0 ? 'Collect & settle' : bal < 0 ? 'Refund & settle' : 'Mark settled'}</button>` : ''}`}
        ${fb.status !== 'SETTLED' && can('hospital.approve') ? `<button class="btn btn-ghost btn-sm mt-1" data-x="reopen">${icon('rotate-ccw')}Re-open bill</button>` : ''}</div></section>`;
    const pph = host.querySelector('[data-pp]');
    if (pph) { host._pay = payPanel(pph, { amount: Math.abs(bal), editable: false, refund: bal < 0, label: bal < 0 ? 'Refund amount' : 'Amount' }); if (!bal) pph.classList.add('hidden'); }
  }
  view.onclick = async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x; const cl = e.target.closest('[data-clear]')?.dataset.clear;
    const a = admission(params.id);
    try {
      if (cl) { const r = await confirmDialog({ title: `${cl === 'pharmacy' ? 'Pharmacy' : 'Nursing'} clearance`, message: cl === 'pharmacy' ? 'Confirm no medicines are pending and unused medicines have been taken back.' : 'Confirm IV lines removed, belongings and documents handed over.', confirmLabel: 'Give clearance', reason: true, reasonLabel: 'Note', reasonPlaceholder: 'e.g. 2 vials returned' }); if (!r) return; clearDept(a.id, cl, r.reason, u); toast('Clearance recorded.', 'success'); }
      if (x === 'sumsave' || x === 'sumfinal') {
        const f = view.querySelector('[data-sum]'); const d = Object.fromEntries(new FormData(f));
        if (x === 'sumfinal' && !(await confirmDialog({ title: 'Finalise discharge summary?', message: 'It can no longer be edited after this.', confirmLabel: 'Finalise' }))) return;
        saveSummary(a.id, d, x === 'sumfinal', u); toast(x === 'sumfinal' ? 'Discharge summary finalised.' : 'Draft saved.', 'success');
      }
      if (x === 'final') { const pct = Number(view.querySelector('[data-disc]').value) || 0; const fb = finaliseBill(a.id, { discountPct: pct, reason: view.querySelector('[data-dr]').value }, u); toast(fb.status === 'DISCOUNT_PENDING' ? `${fb.id} made — discount sent for approval.` : `Final bill ${fb.id} made.`, 'success'); }
      if (x === 'settle') { const pd = view.querySelector('[data-bill]')._pay?.get() || { mode: 'CASH' }; settleBill(a.id, pd, u); toast('Bill settled.', 'success'); }
      if (x === 'tpa') return openPreAuth(a.id, draw);
      if (x === 'reopen') { const r = await confirmDialog({ title: 'Re-open final bill?', message: 'The bill is cancelled and charges can be changed again. A new final bill must be made.', confirmLabel: 'Re-open', tone: 'danger', reason: true }); if (!r) return; reopenBill(a.id, r.reason, u); toast('Final bill re-opened.', 'success'); }
      if (x === 'canceldis') { const r = await confirmDialog({ title: 'Cancel discharge?', message: 'The patient stays admitted and clearances are reset.', confirmLabel: 'Cancel discharge', reason: true }); if (!r) return; cancelDischarge(a.id, r.reason, u); toast('Discharge cancelled.', 'success'); }
      if (x === 'discharge') { if (!(await confirmDialog({ title: 'Discharge patient?', message: 'The bed is released for cleaning and the admission is closed.', confirmLabel: 'Discharge', iconName: 'door-open' }))) return; completeDischarge(a.id, u); toast('Patient discharged. Bed sent for cleaning.', 'success'); }
      draw();
    } catch (err) { toast(err.message, 'error'); }
  };
  draw();
  const off = store.subscribe(debounce(() => { if (!document.querySelector('.modal-backdrop') && !view.querySelector('[data-sum]:focus-within')) draw(); }, 500));
  return () => { off(); view.onclick = null; };
}

// ---------------- prints ----------------
export function renderPrint(view, params, query) {
  const a = admission(params.id); if (!a) { view.innerHTML = emptyState('file-x', 'Admission not found'); return; }
  const p = patient(a.patientId); const d = doctor(a.doctorId); const doc = query.doc || 'interim';
  const titles = { admission: 'Admission Form', wristband: 'Wristband', deposit: 'Receipt', interim: 'Interim Bill', final: 'Final Bill', summary: 'Discharge Summary' };
  setMeta({ title: titles[doc] || 'Print', crumbs: [{ label: 'Inpatient' }, { label: a.id, href: '#/ip/admissions/' + a.id }, 'Print'] });
  const meta = `<div class="rc-meta"><div><span>Patient</span><strong>${esc(p.name)}</strong></div><div><span>Patient ID</span><strong class="mono">${esc(p.uhid)}</strong></div><div><span>Age / Sex</span><strong>${esc(ageSex(p))}</strong></div><div><span>IP number</span><strong class="mono">${esc(a.id)}</strong></div>
    <div><span>Consultant</span><strong>${esc(d.name)}</strong></div><div><span>Department</span><strong>${esc(deptName(a.departmentId))}</strong></div><div><span>Admitted</span><strong>${fmtDateTime(a.admittedAt)}</strong></div><div><span>Bed</span><strong>${esc(bedCode(currentBedId(a)))}</strong></div></div>`;
  let body = '';
  if (doc === 'wristband') {
    body = `<div class="wristband ${p.allergies ? 'allergic' : ''}"><div class="wb-id"><strong>${esc(p.name)}</strong><span>${esc(ageSex(p))} · ${esc(p.bloodGroup || '')} · ${esc(p.uhid)} · ${esc(a.id)}</span><span>${esc(d.name)} · admitted ${fmtDate(a.admittedAt)}</span></div>
      ${p.allergies ? `<span class="wb-flag">ALLERGY: ${esc(p.allergies)}</span>` : ''}<div style="margin-left:auto">${barcodeSVG(p.uhid, { height: 40 })}</div></div><p class="muted small center no-print">Print on a wristband label (260 × 40 mm). A red border means the patient has a known allergy.</p>`;
  } else if (doc === 'admission') {
    const pay = a.payer;
    body = `<article class="receipt doc-a4">${docHead('ADMISSION FORM')}${meta}
      <div class="doc-sec-title">Admission</div><dl class="ds-grid"><dt>Type</dt><dd>${esc(label(a.admissionType))}${a.mlc ? ' · Medico-legal case' : ''}</dd><dt>Provisional diagnosis</dt><dd>${esc(a.provisionalDiagnosis)}</dd><dt>Ward / bed</dt><dd>${esc(bedCode(staysOf(a.id)[0].bedId))} · ${esc(categoryLabel(staysOf(a.id)[0].category))}</dd>${a.opVisitId ? `<dt>Referred from OP</dt><dd>${esc(a.opVisitId)}</dd>` : ''}</dl>
      <div class="doc-sec-title">Patient & attender</div><dl class="ds-grid"><dt>Address</dt><dd>${esc(p.address)}, ${esc(p.city)} ${esc(p.pincode || '')}</dd><dt>Mobile</dt><dd>${esc(p.phone)}</dd><dt>Allergies</dt><dd>${esc(p.allergies || 'None known')}</dd><dt>Attender</dt><dd>${esc(a.attender.name)} (${esc(a.attender.relation)}) · ${esc(a.attender.phone)}</dd></dl>
      <div class="doc-sec-title">Payer</div><dl class="ds-grid"><dt>Payer</dt><dd>${esc(label(pay.type))}</dd>${pay.type === 'INSURANCE' ? `<dt>TPA / insurer</dt><dd>${esc(tpaName(pay.tpaId))} · ${esc(pay.insurer)}</dd><dt>Policy / member</dt><dd>${esc(pay.policyNo)} · ${esc(pay.memberId)} · co-pay ${pay.coPayPct}%</dd>` : ''}${pay.type === 'CORPORATE' ? `<dt>Company</dt><dd>${esc(pay.corporate)} · ${esc(pay.memberId)}</dd>` : ''}</dl>
      <div class="doc-sec-title">Consent</div><p class="small">I consent to admission and to such investigations and treatment as the treating doctors consider necessary. I have been informed of the hospital's tariff, the advance deposit policy and that the final bill is settled before discharge.</p>
      ${signLine(['Patient / attender', 'Admitting staff', d.name])}${docFoot()}</article>`;
  } else if (doc === 'deposit') {
    const r = (query.r && store.get('hospitalReceipts', query.r)) || receiptsFor(a.id).filter((x) => x.kind === 'DEPOSIT').at(-1);
    body = r ? `<article class="receipt">${docHead(r.kind === 'REFUND' ? 'REFUND VOUCHER' : r.kind === 'DEPOSIT' ? 'ADVANCE DEPOSIT RECEIPT' : 'PAYMENT RECEIPT')}
      <div class="rc-meta"><div><span>Receipt No</span><strong class="mono">${esc(r.id)}</strong></div><div><span>Date & time</span><strong>${fmtDateTime(r.at)}</strong></div><div><span>Patient</span><strong>${esc(p.name)}</strong></div><div><span>IP number</span><strong class="mono">${esc(a.id)}</strong></div>
        <div><span>Mode</span><strong>${esc(modeLabel(r.mode))}</strong></div><div><span>Reference</span><strong>${esc(r.reference || '—')}</strong></div><div><span>Received by</span><strong>${esc(userName(r.userId))}</strong></div><div><span>Note</span><strong>${esc(r.note || '')}</strong></div></div>
      <div class="slip-token" style="margin:18px auto;max-width:280px;padding:10px"><span>${r.kind === 'REFUND' ? 'AMOUNT REFUNDED' : 'AMOUNT RECEIVED'}</span><strong>${fmtINR(r.amount)}</strong></div>
      <p class="rc-small">${r.kind === 'DEPOSIT' ? 'This advance is adjusted against the final bill. Any excess is refunded at discharge on producing this receipt.' : ''}</p>${signLine(['Cashier'])}${docFoot()}</article>` : emptyState('receipt', 'No deposit receipt');
  } else if (doc === 'summary') {
    const s = a.discharge?.summary;
    body = s ? `<article class="receipt doc-a4">${docHead(s.status === 'FINAL' ? 'DISCHARGE SUMMARY' : 'DISCHARGE SUMMARY — DRAFT', `${esc(d.name)} · ${esc(d.qualification)} · Reg. ${esc(d.registrationNo)}`)}${meta}
      <dl class="ds-grid mt-1"><dt>Discharged</dt><dd>${a.discharge.dischargedAt ? fmtDateTime(a.discharge.dischargedAt) : 'Pending'} · ${esc(label(a.discharge.type))}</dd><dt>Length of stay</dt><dd>${daysAdmitted(a)} day(s)</dd></dl>
      ${SUMMARY_FIELDS.map(([k, l]) => `<div class="doc-sec-title">${l}</div><p class="small" style="white-space:pre-wrap">${esc(s[k] || '—')}</p>`).join('')}
      <div class="doc-sec-title">Follow-up</div><p class="small">${s.followUpDate ? `Review with ${esc(d.name)} on ${fmtDate(s.followUpDate)} (OP, ${esc(d.room)}). Bring this summary.` : 'As advised.'} In case of emergency, contact the hospital immediately.</p>
      ${signLine([`${d.name} (${d.qualification})`])}${docFoot()}</article>` : emptyState('file-text', 'Summary not started');
  } else {
    const fb = doc === 'final' ? finalBill(a) : null;
    const pos = ipPosition(a); const lines = fb ? fb.lines : billLines(a); const sp = pos.split;
    body = `<article class="receipt doc-a4">${docHead(fb ? 'FINAL BILL' : 'INTERIM BILL', fb ? `Bill No ${esc(fb.id)} · ${fmtDateTime(fb.finalisedAt)}` : `As on ${fmtDateTime(new Date())} — provisional, subject to change`)}${meta}
      <table class="rc-table"><thead><tr><th>Date</th><th>Particulars</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
      ${GROUP_ORDER.filter((g) => lines.some((l) => l.group === g)).map((g) => `<tr><td colspan="5" style="font-weight:700;color:var(--navy);padding-top:10px">${esc(GROUPS[g])}</td></tr>${lines.filter((l) => l.group === g).map((l) => `<tr><td>${l.auto ? `${fmtDate(l.from).slice(0, 6)}–${fmtDate(l.to).slice(0, 6)}` : fmtDate(l.at)}</td><td>${esc(l.description)}${l.nonPayable && a.payer.type !== 'SELF' ? ' *' : ''}</td><td class="r">${l.qty}</td><td class="r">${fmtINR(l.rate)}</td><td class="r">${fmtINR(l.amount)}</td></tr>`).join('')}
        <tr><td></td><td colspan="3" style="text-align:right;font-size:11px;color:#6b7c89">Sub-total ${esc(GROUPS[g])}</td><td class="r"><strong>${fmtINR(lines.filter((l) => l.group === g).reduce((t, l) => t + l.amount, 0))}</strong></td></tr>`).join('')}</tbody></table>
      <div class="rc-foot"><div class="rc-gst"><strong>Payments received</strong>${receiptsFor(a.id).map((r) => `<div>${r.kind === 'REFUND' ? 'Refund' : r.kind === 'DEPOSIT' ? 'Deposit' : 'Payment'} ${esc(r.id)} · ${fmtDate(r.at)} · ${esc(modeLabel(r.mode))} · ${r.kind === 'REFUND' ? '−' : ''}${fmtINR(r.amount)}</div>`).join('') || '<div>None</div>'}
        ${a.payer.type !== 'SELF' ? `<div class="mt-1">* Not payable by the ${a.payer.type === 'INSURANCE' ? 'insurer' : 'company'}. ${a.payer.type === 'INSURANCE' ? `${esc(tpaName(a.payer.tpaId))} · ${esc(a.payer.insurer)} · policy ${esc(a.payer.policyNo)} · ${esc(label(a.payer.preAuth?.stage))}` : esc(a.payer.corporate)}</div>` : ''}<div class="tiny">Healthcare services are exempt from GST; medicines are billed at MRP (GST inclusive).</div></div>
        <div class="rc-totals"><div class="kv"><span>Gross</span><span>${fmtINR(fb ? fb.gross : pos.gross)}</span></div>${fb?.discount ? `<div class="kv"><span>Discount ${fb.discountPct}%</span><span>− ${fmtINR(fb.discount)}</span></div>` : ''}${fb?.roundOff ? `<div class="kv"><span>Round off</span><span>${fmtINR(fb.roundOff)}</span></div>` : ''}
          <div class="kv strong"><span>Net bill</span><span>${fmtINR(pos.net)}</span></div>${a.payer.type !== 'SELF' ? `<div class="kv"><span>Payable by ${a.payer.type === 'INSURANCE' ? 'insurer' : 'company'}</span><span>− ${fmtINR(sp.payerPays)}</span></div><div class="kv"><span>Patient's share</span><span>${fmtINR(sp.patientPays)}</span></div>` : ''}
          <div class="kv"><span>Paid</span><span>− ${fmtINR(pos.paid)}</span></div><div class="kv strong"><span>${pos.balance >= 0 ? 'Balance payable' : 'Refundable'}</span><span>${fmtINR(Math.abs(pos.balance))}</span></div></div></div>
      ${signLine(['Patient / attender', 'Billing'])}${docFoot()}</article>`;
  }
  view.innerHTML = `<div class="row mb-2 no-print print-bar"><button class="btn btn-primary" data-print>${icon('printer')}Print</button><a class="btn btn-ghost" href="#/ip/admissions/${a.id}">${icon('arrow-left')}Back to folio</a></div>${body}`;
  view.querySelector('[data-print]').onclick = () => window.print();
  refreshIcons(view);
}
