// New OP Visit, the visit / consultation workspace, vitals modal and OP printouts (slip, prescription, bill).
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { businessDate } from '../pharmacy-calc.js';
import { activeDoctors, doctor, doctorName, department, deptName, patient, cbadge, label, doctorWorksOn, servicesFor, service, discountLimit, receiptsFor, modeLabel, pendingRequestFor, doctorForUser } from '../clinical.js';
import { createVisit, visitPolicy, doctorQueue, avgConsultMinutes, visit as getVisit, visitBills, opBillDue, opBillPaid, recordVitals, callVisit, skipVisit, backToQueue, saveConsultation, completeVisit,
  addAddendum, addServicesBill, collectOpBill, cancelVisit, payOpRefund, patientVisits, visitDue, consultPaid } from '../op.js';
import { patientAdmissions, activeAdmissionOf } from '../ip.js';
import { medicineStock } from '../calculations.js';
import { userName } from '../calculations.js';
import { patientSearch, patientStrip, payPanel, vitalsChips, vitalsForm, wireVitalsForm, docHead, docFoot, signLine, ageSex } from './clinical-ui.js';
import { openModal, confirmDialog, emptyState, card, combo } from '../components.js';
import { barcodeSVG } from '../barcode.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtDate, fmtDateTime, relTime, refreshIcons, ymd } from '../utils.js';
import { setMeta } from '../app.js';
import { navigate } from '../router.js';
import { typeTag } from './op-desk.js';

const FREQ = ['1-0-1', '1-1-1', '1-0-0', '0-0-1', '0-1-0', '1-1-1-1', '0-1-1', 'SOS', 'STAT'];
const TIMING = ['After food', 'Before food', 'Morning', 'Night', 'With food', 'Empty stomach', 'Local application', 'As directed'];
const perDay = (f) => (f === 'SOS' || f === 'STAT' ? 1 : f.split('-').reduce((t, x) => t + (Number(x) || 0), 0) || 1);
const perUnit = (m) => { const n = Number(String(m?.packSize || '').match(/\d+/)?.[0]); return m && (m.form === 'Tablet' || m.form === 'Capsule') ? (n || 10) : 1; };
export const rxQty = (medicineId, freq, days) => { const m = store.get('medicines', medicineId); if (!m) return 0; const u = perUnit(m); return u > 1 ? Math.max(1, Math.ceil(perDay(freq) * (Number(days) || 1) / u)) : 1; };

// ---------------- vitals modal ----------------
export function openVitals(visitId, after) {
  const v = getVisit(visitId); const p = patient(v.patientId);
  const m = openModal({ title: `Record vitals · ${v.token}`, subtitle: `${esc(p.name)} · ${esc(ageSex(p))} · ${esc(p.uhid)}`, size: 'lg', body: vitalsForm(v.vitals || {}),
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save vitals', cls: 'btn-primary', icon: 'heart-pulse', onClick: (close) => {
      try { recordVitals(visitId, read(), currentUser()); toast(`Vitals saved for ${v.token}.`, 'success'); close(); after?.(); } catch (e) { toast(e.message, 'error'); }
    } }] });
  const read = wireVitalsForm(m.el);
}

// ---------------- new visit ----------------
export function renderNew(view, params, query) {
  const u = currentUser();
  const st = { patient: query.patient ? patient(query.patient) : null, doctorId: query.doctor || '', emergency: query.er === '1', discount: 0 };
  view.innerHTML = `
    <div class="grid grid-3-1">
      <div class="col-stack">
        <section class="card"><header class="card-head"><div><h2>${icon('user-round', 'ic-inline')} 1 · Patient</h2><p class="muted small">Find the patient by name, Patient ID or mobile, or scan the patient card. New patients are registered here.</p></div></header>
          <div class="card-body"><div data-search></div><div data-pt class="mt-2"></div></div></section>
        <section class="card"><header class="card-head"><div><h2>${icon('stethoscope', 'ic-inline')} 2 · Doctor</h2><p class="muted small">Only doctors available today can be chosen. The fee shown is for this patient's visit type.</p></div></header>
          <div class="card-body"><div class="doc-pick" data-docs></div></div></section>
        <section class="card"><header class="card-head"><div><h2>${icon('clipboard-plus', 'ic-inline')} 3 · Visit details</h2></div></header>
          <div class="card-body"><div class="form-grid">
            <div class="field col-12"><label>Visit type</label><div class="row" data-type></div><div class="field-hint" data-type-hint></div></div>
            <div class="field col-6"><label>Chief complaint <span class="muted">(optional)</span></label><input class="input" name="complaint" placeholder="e.g. Fever for 3 days"></div>
            <div class="field col-4"><label>Referred by</label><input class="input" name="referredBy" placeholder="Self / doctor / clinic"></div>
            <div class="field col-2"><label>Medico-legal</label><label class="check mt-1"><input type="checkbox" name="mlc"> MLC case</label></div>
          </div></div></section>
      </div>
      <aside><div class="sticky-side"><div class="summary-box"><h3>Fee & payment</h3><div data-fee></div></div>
        <section class="card mt-2"><div class="card-body"><div data-disc></div><div data-pay class="mt-1"></div>
          <button class="btn btn-primary btn-lg btn-block mt-2" data-go>${icon('ticket')}Create visit & issue token</button>
          <p class="muted small mt-1">${icon('info', 'ic-inline')} The OP sheet is generated once the fee is paid. Discounts up to ${discountLimit()}% are allowed; above that the bill waits for Super Admin approval and the patient joins the queue after paying.</p></div></section></div></aside>
    </div>`;
  const q = (s) => view.querySelector(s);
  patientSearch(q('[data-search]'), { onPick: (p) => { st.patient = p; draw(); } });
  const pay = payPanel(q('[data-pay]'), { amount: 0 });
  q('[data-disc]').innerHTML = `<details class="collapsible"><summary>${icon('percent')}Give a discount</summary><div class="form-grid mt-1"><div class="field col-4"><label>%</label><input class="input" type="number" min="0" max="100" name="disc" value="0"></div>
    <div class="field col-8"><label>Reason</label><input class="input" name="discReason" placeholder="Required for any discount"></div></div></details>`;
  q('[name=disc]').addEventListener('input', () => { st.discount = Number(q('[name=disc]').value) || 0; drawFee(); });

  function drawPatient() {
    const host = q('[data-pt]');
    if (!st.patient) { host.innerHTML = `<div class="hint-box">${icon('scan-line')}<span>No patient selected yet. Search above, or scan the barcode on the patient card.</span></div>`; return; }
    const p = st.patient; const vs = patientVisits(p.id).slice(0, 3); const adm = activeAdmissionOf(p.id);
    host.innerHTML = patientStrip(p, { extra: `<button class="btn btn-ghost btn-sm" data-clear>${icon('x')}Change</button>` })
      + (adm ? `<div class="alert alert-warning mt-1">${icon('bed-double')}<div>This patient is currently admitted (<a href="#/ip/admissions/${adm.id}">${adm.id}</a>). An OP visit is usually not needed.</div></div>` : '')
      + (vs.length ? `<div class="mini-hist mt-1"><span class="lbl-sm">Recent visits</span>${vs.map((v) => `<span class="mh-item">${fmtDate(v.businessDate)} · ${esc(doctorName(v.doctorId))} · ${esc((v.consultation?.diagnosis || [])[0] || label(v.status))}</span>`).join('')}</div>` : '<div class="muted small mt-1">First visit to the OP.</div>');
    host.querySelector('[data-clear]').onclick = () => { st.patient = null; draw(); };
  }
  function drawDocs() {
    const today = businessDate();
    const docs = [...activeDoctors()].sort((a, b) => Number(doctorWorksOn(b, today)) - Number(doctorWorksOn(a, today)));
    q('[data-docs]').innerHTML = docs.map((d) => { const qd = doctorQueue(d.id, today); const on = doctorWorksOn(d, today); const pol = st.patient ? visitPolicy(st.patient.id, d.id, st.emergency) : null;
      return `<button type="button" class="doc-opt ${st.doctorId === d.id ? 'active' : ''} ${on ? '' : 'off'}" data-doc="${d.id}" ${on ? '' : 'disabled title="Not available today"'}><span class="doc-av">${esc(department(d.departmentId).code)}</span>
        <span class="grow"><strong>${esc(d.name)}</strong><small>${esc(deptName(d.departmentId))} · ${esc(d.room)} · ${on ? `${esc(d.start)}–${esc(d.end)}` : 'Not available today'}</small>
        <span class="doc-opt-foot"><span>${pol ? `<strong>${fmtINR(pol.fee, true)}</strong> ${esc(label(pol.visitType))}` : `New ${fmtINR(d.fees.new, true)} · Revisit ${fmtINR(d.fees.revisit, true)}`}</span><span class="tag tag-${qd.waiting.length > 5 ? 'warning' : 'info'}">${qd.waiting.length} waiting</span></span></span></button>`; }).join('');
    q('[data-docs]').querySelectorAll('[data-doc]').forEach((b) => { b.onclick = () => { st.doctorId = b.dataset.doc; draw(); }; });
  }
  function drawType() {
    const pol = st.patient && st.doctorId ? visitPolicy(st.patient.id, st.doctorId, false) : null;
    q('[data-type]').innerHTML = `<span class="seg"><button type="button" class="seg-btn ${!st.emergency ? 'active' : ''}" data-er="0">${pol ? esc(label(pol.visitType)) : 'Normal visit'}</button><button type="button" class="seg-btn ${st.emergency ? 'active' : ''}" data-er="1">${icon('siren')}Emergency</button></span>`;
    q('[data-type-hint]').innerHTML = !pol ? 'Choose the patient and doctor to see the visit type.' : st.emergency ? 'Emergency patients get a priority token at the top of the queue.'
      : pol.visitType === 'FOLLOW_UP' ? `${icon('badge-check', 'ic-inline')} Free follow-up — paid visit on ${fmtDate(pol.lastPaid.date)}, valid till ${fmtDate(pol.validTill)}.`
        : pol.visitType === 'REVISIT' ? `Seen before by this doctor${pol.lastPaid ? ` (last paid visit ${fmtDate(pol.lastPaid.date)}; free follow-up window of ${doctor(st.doctorId).followUpDays} days ${pol.followUpValid ? 'already used' : 'has ended'})` : ''}.` : 'First visit to this doctor.';
    q('[data-type]').querySelectorAll('[data-er]').forEach((b) => { b.onclick = () => { st.emergency = b.dataset.er === '1'; draw(); }; });
    refreshIcons(q('[data-type]'));
  }
  function drawFee() {
    const pol = st.patient && st.doctorId ? visitPolicy(st.patient.id, st.doctorId, st.emergency) : null;
    const fee = pol?.fee || 0; const disc = Math.round(fee * (st.discount || 0) / 100); const total = fee - disc;
    q('[data-fee]').innerHTML = pol ? `<div class="summary-row"><span>${esc(doctorName(st.doctorId))}</span></div><div class="summary-row"><span>Consultation (${esc(label(pol.visitType))})</span><b>${fmtINR(fee)}</b></div>
      ${disc ? `<div class="summary-row"><span>Discount ${st.discount}%</span><b>− ${fmtINR(disc)}</b></div>` : ''}<div class="summary-row total"><span>Payable</span><span>${fmtINR(total)}</span></div>
      ${st.discount > discountLimit() && !can('hospital.approve') ? '<div class="summary-note">Above the limit — sent for approval; collect after the decision.</div>' : ''}` : '<div class="summary-row"><span>Select patient and doctor</span></div>';
    pay.setAmount(st.discount > discountLimit() && !can('hospital.approve') ? 0 : total);
    q('[data-pay]').classList.toggle('hidden', !total);
  }
  function draw() { drawPatient(); drawDocs(); drawType(); drawFee(); refreshIcons(view); }
  draw();

  q('[data-go]').onclick = () => {
    if (!st.patient) return toast('Select or register the patient first.', 'warning');
    if (!st.doctorId) return toast('Choose the doctor.', 'warning');
    const pol = visitPolicy(st.patient.id, st.doctorId, st.emergency);
    const total = Math.round(pol.fee * (1 - (st.discount || 0) / 100));
    const pd = pay.get();
    if (total > 0 && !(st.discount > discountLimit() && !can('hospital.approve')) && pd.amount < total) return toast(`Collect the full fee of ${fmtINR(total)} before issuing the token.`, 'warning');
    try {
      const { visit: v, bill: b } = createVisit({ patientId: st.patient.id, doctorId: st.doctorId, emergency: st.emergency, mlc: q('[name=mlc]').checked, referredBy: q('[name=referredBy]').value, complaint: q('[name=complaint]').value,
        discountPct: st.discount, discountReason: q('[name=discReason]').value, pay: total > 0 ? pd : null }, u);
      tokenModal(v, b);
    } catch (e) { toast(e.message, 'error'); }
  };
}
function tokenModal(v, b) {
  const d = doctor(v.doctorId); const qd = doctorQueue(v.doctorId); const ahead = qd.waiting.findIndex((x) => x.id === v.id);
  if (!consultPaid(v)) {
    openModal({ title: 'Visit created — fee pending', size: 'sm', body: `<div class="token-issued"><div class="ti-label">Token (after payment)</div><div class="ti-token">${esc(v.token)}</div><div class="ti-sub">${esc(d.name)} · ${esc(d.room)}</div>
      <div class="ti-meta"><span>${cbadge('DISCOUNT_PENDING')}</span></div><p class="muted small mt-1">The OP sheet is generated and the patient joins the queue once the fee is paid at reception.</p></div>`,
      footer: [{ label: 'Open visit', onClick: (c) => { c(); navigate('#/op/visits/' + v.id); } }, { label: 'Next patient', cls: 'btn-primary', icon: 'user-round-plus', onClick: (c) => { c(); navigate('#/op/new?r=' + Date.now()); } }] });
    return;
  }
  openModal({ title: 'Fee paid — OP sheet ready', size: 'sm', body: `<div class="token-issued"><div class="ti-label">Token number</div><div class="ti-token">${esc(v.token)}</div>
    <div class="ti-sub">${esc(d.name)} · ${esc(d.room)}</div><div class="ti-meta"><span>${ahead > 0 ? `${ahead} ahead · about ${ahead * avgConsultMinutes(d.id)} min` : 'Next in line'}</span><span>${b.status === 'DISCOUNT_PENDING' ? cbadge('DISCOUNT_PENDING') : b.total ? `Paid ${fmtINR(opBillPaid(b))}` : 'No fee'}</span></div></div>`,
    footer: [{ label: 'Open visit', onClick: (c) => { c(); navigate('#/op/visits/' + v.id); } }, { label: 'Print OP sheet', cls: 'btn-secondary', icon: 'printer', onClick: (c) => { c(); navigate(`#/op/print/${v.id}?doc=slip`); } },
      { label: 'Next patient', cls: 'btn-primary', icon: 'user-round-plus', onClick: (c) => { c(); navigate('#/op/new?r=' + Date.now()); } }] });
}

// ---------------- visit workspace ----------------
export function renderVisit(view, params) {
  const u = currentUser();
  const draw = () => {
    const v = getVisit(params.id);
    if (!v) { view.innerHTML = emptyState('file-x', 'Visit not found', '', '<a class="btn btn-primary" href="#/op/visits">OP Register</a>'); return; }
    const p = patient(v.patientId); const d = doctor(v.doctorId);
    setMeta({ title: `${v.token} · ${p.name}`, crumbs: [{ label: 'Outpatient' }, { label: 'OP Register', href: '#/op/visits' }, v.id] });
    const isDoc = can('op.consult') && (!doctorForUser(u) || doctorForUser(u).id === v.doctorId);
    const editing = isDoc && v.status === 'IN_CONSULTATION';
    const c = v.consultation;
    const actions = [];
    if (isDoc && ['WAITING', 'VITALS_DONE'].includes(v.status)) actions.push(`<button class="btn btn-primary" data-act="call">${icon('door-open')}Call in & start consultation</button>`);
    if (can('op.vitals') && ['WAITING', 'VITALS_DONE', 'IN_CONSULTATION'].includes(v.status)) actions.push(`<button class="btn btn-secondary" data-act="vitals">${icon('heart-pulse')}${v.vitals ? 'Update vitals' : 'Record vitals'}</button>`);
    if (v.status === 'NO_SHOW' && (can('op.consult') || can('op.register'))) actions.push(`<button class="btn btn-secondary" data-act="requeue">${icon('rotate-ccw')}Put back in queue</button>`);
    if (can('op.cancel') && ['WAITING', 'VITALS_DONE'].includes(v.status)) actions.push(`<button class="btn btn-danger-outline" data-act="cancel">${icon('circle-slash')}Cancel visit</button>`);
    if (v.status === 'REFERRED_IP' && !v.admissionId && can('ip.admit')) actions.push(`<a class="btn btn-primary" href="#/ip/admit?visit=${v.id}">${icon('hospital')}Admit patient</a>`);
    if (v.admissionId) actions.push(`<a class="btn btn-secondary" href="#/ip/admissions/${v.admissionId}">${icon('folder-heart')}Open admission</a>`);
    if (consultPaid(v)) actions.push(`<a class="btn btn-ghost" href="#/op/print/${v.id}?doc=slip">${icon('ticket')}OP sheet</a>`);
    if (c && ['COMPLETED', 'REFERRED_IP'].includes(v.status)) actions.push(`<a class="btn btn-ghost" href="#/op/print/${v.id}?doc=rx">${icon('file-text')}Prescription</a>`);
    if (can('pharmacy.bill') && c?.prescription?.length && v.status === 'COMPLETED') actions.push(`<a class="btn btn-ghost" href="#/pharmacy/bill?patient=${p.id}">${icon('shopping-cart')}Pharmacy sale</a>`);

    const hist = patientVisits(p.id).filter((x) => x.id !== v.id).slice(0, 5);
    const adms = patientAdmissions(p.id).slice(0, 3);
    view.innerHTML = `
      <div class="visit-hero">${patientStrip(p)}
        <div class="vh-meta"><div><span class="lbl-sm">Token</span><strong class="token-mid">${esc(v.token)}</strong></div><div><span class="lbl-sm">Doctor</span><strong>${esc(d.name)}</strong><small>${esc(deptName(v.departmentId))} · ${esc(d.room)}</small></div>
          <div><span class="lbl-sm">Visit</span>${typeTag(v)}${v.mlc ? ' <span class="tag tag-danger">MLC</span>' : ''}<small>${fmtDateTime(v.at)}</small></div><div><span class="lbl-sm">Status</span>${cbadge(v.status)}${v.cancel ? `<small>${esc(v.cancel.reason)}</small>` : ''}</div></div>
        <div class="vh-actions">${actions.join('')}</div></div>
      <div class="grid grid-1-2 mt-2">
        <div class="col-stack">
          ${card('Vitals', vitalsChips(v.vitals) + (v.vitals ? `<p class="tiny muted mt-1">by ${esc(userName(v.vitals.by))} · ${relTime(v.vitals.at)}</p>` : ''), { sub: v.chiefComplaint ? `Complaint: ${esc(v.chiefComplaint)}` : '' })}
          ${card('Previous visits', hist.length || adms.length ? `<ul class="hist-list">${adms.map((a) => `<li><a href="#/ip/admissions/${a.id}">${icon('bed-double')}<span><strong>Admission ${esc(a.id)}</strong><small>${fmtDate(a.admittedAt)} · ${esc(a.provisionalDiagnosis)}</small></span></a></li>`).join('')}
            ${hist.map((x) => `<li><a href="#/op/visits/${x.id}">${icon('stethoscope')}<span><strong>${fmtDate(x.businessDate)} · ${esc(doctorName(x.doctorId))}</strong><small>${esc((x.consultation?.diagnosis || []).join('; ') || label(x.status))}</small></span></a></li>`).join('')}</ul>` : '<p class="muted small">No earlier visits.</p>')}
          <div data-bills></div>
        </div>
        <div data-consult></div>
      </div>`;
    drawConsult(view.querySelector('[data-consult]'), v, editing, isDoc);
    drawBills(view.querySelector('[data-bills]'), v);
    view.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => act(b.dataset.act, v); });
    refreshIcons(view);
  };
  const act = async (a, v) => {
    try {
      if (a === 'call') { callVisit(v.id, u); toast(`${v.token} called in.`, 'success'); }
      if (a === 'vitals') return openVitals(v.id, draw);
      if (a === 'requeue') { backToQueue(v.id, u); toast('Back in the queue.', 'success'); }
      if (a === 'cancel') { const r = await confirmDialog({ title: `Cancel ${v.token}?`, message: 'The token is cancelled. If a fee was paid it is refunded (after Super Admin approval when needed).', confirmLabel: 'Cancel visit', tone: 'danger', reason: true, reasonPlaceholder: 'e.g. Patient left, doctor unavailable' }); if (!r) return; cancelVisit(v.id, r.reason, u); toast('Visit cancelled.', 'success'); }
      draw();
    } catch (e) { toast(e.message, 'error'); }
  };
  draw();
}

function drawConsult(host, v, editing, isDoc) {
  const u = currentUser();
  const c = v.consultation;
  if (!c) {
    host.innerHTML = card('Consultation', emptyState('stethoscope', v.status === 'CANCELLED' ? 'Visit cancelled' : v.status === 'NO_SHOW' ? 'Patient did not come in' : 'Waiting for the doctor',
      ['WAITING', 'VITALS_DONE'].includes(v.status) ? (isDoc ? 'Call the patient in to start the case sheet.' : `Position in queue: ${doctorQueue(v.doctorId).waiting.findIndex((x) => x.id === v.id) + 1 || '—'}`) : ''));
    return;
  }
  if (!editing) {
    const rx = c.prescription || [];
    host.innerHTML = `<section class="card"><header class="card-head"><div><h2>Case sheet</h2><p class="muted small">${esc(doctorName(c.doctorId))} · ${c.completedAt ? 'completed ' + fmtDateTime(c.completedAt) : 'started ' + fmtDateTime(c.startedAt)}</p></div>
      <div class="card-actions">${isDoc && v.status !== 'IN_CONSULTATION' ? `<button class="btn btn-ghost btn-sm" data-add>${icon('pen-line')}Add addendum</button>` : ''}</div></header><div class="card-body cs-read">
      <div class="cs-grid"><div><span class="lbl-sm">Chief complaints</span><p>${esc(c.complaints || '—')}</p></div><div><span class="lbl-sm">History</span><p>${esc(c.history || '—')}</p></div><div><span class="lbl-sm">Examination</span><p>${esc(c.examination || '—')}</p></div></div>
      <span class="lbl-sm">Diagnosis</span><div class="dx-chips">${(c.diagnosis || []).map((x) => `<span class="dx">${esc(x)}</span>`).join('') || '<span class="muted">—</span>'}</div>
      <span class="lbl-sm mt-2">Prescription</span>${rx.length ? `<table class="table dense"><thead><tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Days</th><th>When</th><th class="ta-right">Qty</th></tr></thead><tbody>${rx.map((r) => `<tr><td><div class="cell-main">${esc(r.name)}</div><div class="cell-sub">${esc(r.generic || '')}</div></td><td>${esc(r.dose)}</td><td class="mono">${esc(r.frequency)}</td><td>${r.days}</td><td>${esc(r.timing)}</td><td class="ta-right">${r.qty ? `${r.qty} ${esc(r.unit || '')}` : '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No medicines prescribed.</p>'}
      <div class="cs-grid mt-2"><div><span class="lbl-sm">Investigations</span><p>${(c.investigations || []).map((i) => esc(i.name)).join(', ') || '—'}</p></div><div><span class="lbl-sm">Advice</span><p>${esc(c.advice || '—')}</p></div><div><span class="lbl-sm">Follow-up</span><p>${c.followUpDate ? fmtDate(c.followUpDate) : '—'}</p></div></div>
      ${v.referral ? `<div class="alert alert-info mt-2">${icon('hospital')}<div><strong>Admission advised:</strong> ${esc(v.referral.reason)}</div></div>` : ''}
      ${(c.addenda || []).map((a) => `<div class="addendum">${icon('pen-line')}<div><strong>Addendum · ${fmtDateTime(a.at)} · ${esc(userName(a.by))}</strong><p>${esc(a.text)}</p></div></div>`).join('')}</div></section>`;
    host.querySelector('[data-add]')?.addEventListener('click', () => {
      openModal({ title: 'Add addendum', body: '<div class="field"><label>Addendum</label><textarea class="input" rows="4" data-t placeholder="Corrections or additional notes. The original case sheet is kept as it is."></textarea></div>',
        footer: [{ label: 'Cancel', onClick: (cl) => cl() }, { label: 'Save', cls: 'btn-primary', onClick: (cl, w) => { try { addAddendum(v.id, w.querySelector('[data-t]').value, u); cl(); location.hash = location.hash; window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) { toast(e.message, 'error'); } } }] });
    });
    return;
  }
  // ---- editable case sheet ----
  const st = { dx: [...(c.diagnosis || [])], rx: (c.prescription || []).map((r) => ({ ...r })), inv: [...(c.investigations || [])] };
  const dxSuggest = [...new Set(store.all('opVisits').flatMap((x) => x.consultation?.diagnosis || []))].sort();
  const invOptions = servicesFor('OP').filter((s) => ['INVESTIGATION', 'PROCEDURE'].includes(s.category));
  host.innerHTML = `<section class="card cs-edit"><header class="card-head"><div><h2>${icon('notebook-pen', 'ic-inline')} Case sheet</h2><p class="muted small">Started ${relTime(c.startedAt)} · saved automatically when you click Save draft or Complete.</p></div>
    <div class="card-actions"><button class="btn btn-ghost btn-sm" data-skip>${icon('skip-forward')}Send back to queue</button></div></header><div class="card-body">
    <div class="form-grid">
      <div class="field col-12"><label>Chief complaints</label><textarea class="input" rows="2" name="complaints">${esc(c.complaints || '')}</textarea></div>
      <div class="field col-6"><label>History</label><textarea class="input" rows="2" name="history" placeholder="Past history, medication, comorbidities">${esc(c.history || '')}</textarea></div>
      <div class="field col-6"><label>Examination findings</label><textarea class="input" rows="2" name="examination">${esc(c.examination || '')}</textarea></div>
      <div class="field col-12"><label>Diagnosis <span class="req">*</span></label><div class="dx-input"><div class="dx-chips" data-dx></div><input class="input" list="dx-list" data-dxin placeholder="Type a diagnosis and press Enter"><datalist id="dx-list">${dxSuggest.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div></div>
    </div>
    <div class="rx-head mt-2"><h3>${icon('pill', 'ic-inline')} Prescription</h3><span class="muted small">Pick from the pharmacy list (shows shelf stock) or type any medicine.</span></div>
    <div class="table-scroll"><table class="table dense rx-table"><thead><tr><th style="width:30%">Medicine</th><th>Dose</th><th>Frequency</th><th style="width:70px">Days</th><th>When</th><th style="width:80px">Qty</th><th></th></tr></thead><tbody data-rx></tbody></table></div>
    <button class="btn btn-ghost btn-sm mt-1" data-addrx>${icon('plus')}Add medicine</button>
    <div class="form-grid mt-2">
      <div class="field col-12"><label>Investigations / procedures <span class="muted">(billed at the counter)</span></label><div class="dx-chips" data-inv></div><select class="input" data-invsel><option value="">+ Add investigation or procedure…</option>${invOptions.map((s) => `<option value="${s.id}">${esc(s.name)} — ${fmtINR(s.rate, true)}</option>`).join('')}</select></div>
      <div class="field col-8"><label>Advice</label><textarea class="input" rows="2" name="advice">${esc(c.advice || '')}</textarea></div>
      <div class="field col-4"><label>Follow-up date</label><input class="input" type="date" name="followUpDate" min="${ymd()}" value="${esc(c.followUpDate || '')}"><div class="row mt-1">${[3, 7, 14, 30].map((n) => `<button type="button" class="chip" data-fu="${n}">${n} d</button>`).join('')}</div></div>
    </div></div>
    <footer class="cs-foot"><button class="btn btn-secondary" data-save>${icon('save')}Save draft</button><button class="btn btn-secondary" data-refer>${icon('hospital')}Advise admission</button><span class="grow"></span><button class="btn btn-primary" data-done>${icon('check-circle-2')}Complete consultation</button></footer></section>`;
  const q = (s) => host.querySelector(s);
  const drawDx = () => { q('[data-dx]').innerHTML = st.dx.map((x, i) => `<span class="dx">${esc(x)}<button type="button" data-rmdx="${i}" aria-label="Remove">×</button></span>`).join(''); };
  const drawInv = () => { q('[data-inv]').innerHTML = st.inv.map((x, i) => `<span class="dx inv">${esc(service(x.serviceId)?.name || x.name)}<button type="button" data-rminv="${i}" aria-label="Remove">×</button></span>`).join('') || '<span class="muted small">None ordered</span>'; };
  const medOpts = store.all('medicines').filter((m) => m.active).map((m) => ({ value: m.id, label: m.brandName, sub: `${m.genericName} · ${m.strength} · shelf ${medicineStock(m.id).pharmacy} ${m.unit}`, keywords: m.genericName }));
  const drawRx = () => {
    const tb = q('[data-rx]');
    tb.innerHTML = st.rx.map((r, i) => `<tr data-i="${i}"><td><div data-med></div>${!r.medicineId ? `<input class="input input-sm mt-1" data-free placeholder="or type medicine name" value="${esc(r.name || '')}">` : ''}</td>
      <td><input class="input input-sm" data-k="dose" value="${esc(r.dose || '')}" placeholder="1 tab"></td>
      <td><select class="input input-sm" data-k="frequency">${FREQ.map((f) => `<option ${r.frequency === f ? 'selected' : ''}>${f}</option>`).join('')}</select></td>
      <td><input class="input input-sm" type="number" min="1" data-k="days" value="${r.days || ''}"></td>
      <td><select class="input input-sm" data-k="timing">${TIMING.map((f) => `<option ${r.timing === f ? 'selected' : ''}>${f}</option>`).join('')}</select></td>
      <td><input class="input input-sm" type="number" min="0" data-k="qty" value="${r.qty || ''}" title="${esc(r.unit || '')}"></td>
      <td><button class="icon-btn" data-rmrx="${i}" aria-label="Remove">${icon('trash-2')}</button></td></tr>`).join('') || `<tr><td colspan="7" class="muted small">No medicines yet.</td></tr>`;
    tb.querySelectorAll('tr[data-i]').forEach((tr) => {
      const i = +tr.dataset.i; const r = st.rx[i];
      combo(tr.querySelector('[data-med]'), { options: medOpts, value: r.medicineId || '', placeholder: 'Search medicine…', onChange: (id) => {
        const m = store.get('medicines', id); Object.assign(r, { medicineId: id, name: m.brandName, generic: m.genericName, unit: m.unit, dose: r.dose || (perUnit(m) > 1 ? `1 ${m.form === 'Capsule' ? 'cap' : 'tab'}` : m.form === 'Syrup' ? '5 ml' : 'As directed'), route: ['Cream', 'Drops'].includes(m.form) ? 'Topical' : m.form === 'Injection' ? 'IM/IV' : 'Oral' });
        r.qty = rxQty(id, r.frequency, r.days); setTimeout(drawRx); } });
      tr.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('change', () => { r[el.dataset.k] = el.dataset.k === 'days' || el.dataset.k === 'qty' ? Number(el.value) : el.value; if (['days', 'frequency'].includes(el.dataset.k) && r.medicineId) { r.qty = rxQty(r.medicineId, r.frequency, r.days); tr.querySelector('[data-k=qty]').value = r.qty; } }));
      tr.querySelector('[data-free]')?.addEventListener('input', (e) => { r.name = e.target.value; });
    });
    refreshIcons(tb);
  };
  drawDx(); drawInv(); drawRx();
  q('[data-dxin]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const x = e.target.value.trim(); if (x && !st.dx.includes(x)) st.dx.push(x); e.target.value = ''; drawDx(); } });
  q('[data-dxin]').addEventListener('change', (e) => { const x = e.target.value.trim(); if (x && dxSuggest.includes(x) && !st.dx.includes(x)) { st.dx.push(x); e.target.value = ''; drawDx(); } });
  host.addEventListener('click', (e) => {
    const t = e.target.closest('[data-rmdx],[data-rminv],[data-rmrx],[data-fu]'); if (!t) return;
    if (t.dataset.rmdx) { st.dx.splice(+t.dataset.rmdx, 1); drawDx(); }
    if (t.dataset.rminv) { st.inv.splice(+t.dataset.rminv, 1); drawInv(); }
    if (t.dataset.rmrx) { st.rx.splice(+t.dataset.rmrx, 1); drawRx(); }
    if (t.dataset.fu) { const d = new Date(); d.setDate(d.getDate() + Number(t.dataset.fu)); q('[name=followUpDate]').value = ymd(d); }
  });
  q('[data-invsel]').addEventListener('change', (e) => { const id = e.target.value; if (id && !st.inv.some((x) => x.serviceId === id)) st.inv.push({ serviceId: id, name: service(id).name, status: 'ORDERED' }); e.target.value = ''; drawInv(); });
  q('[data-addrx]').onclick = () => { st.rx.push({ medicineId: null, name: '', dose: '', frequency: '1-0-1', days: 5, timing: 'After food', qty: 0 }); drawRx(); };
  const pendingDx = () => { const x = q('[data-dxin]').value.trim(); if (x && !st.dx.includes(x)) st.dx.push(x); q('[data-dxin]').value = ''; };
  const data = () => { pendingDx(); return { complaints: q('[name=complaints]').value, history: q('[name=history]').value, examination: q('[name=examination]').value, diagnosis: st.dx, prescription: st.rx, investigations: st.inv, advice: q('[name=advice]').value, followUpDate: q('[name=followUpDate]').value }; };
  const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  q('[data-save]').onclick = () => { try { saveConsultation(v.id, data(), u); toast('Case sheet saved.', 'success'); drawDx(); } catch (e) { toast(e.message, 'error'); } };
  q('[data-done]').onclick = async () => {
    const d = data();
    if (!(await confirmDialog({ title: 'Complete consultation?', message: `${d.diagnosis.length} diagnosis · ${d.prescription.filter((r) => r.name).length} medicine(s) · ${d.investigations.length} investigation(s). Investigations become a bill at the counter. The case sheet is locked; later changes go in as addenda.`, confirmLabel: 'Complete', iconName: 'check-circle-2' }))) return;
    try { completeVisit(v.id, d, u); toast(`${v.token} completed.`, 'success'); const next = doctorQueue(v.doctorId).waiting[0]; if (next) toast(`Next: ${next.token} — ${patient(next.patientId).name}`, 'info', 'Queue'); navigate('#/op/queue'); } catch (e) { toast(e.message, 'error'); }
  };
  q('[data-refer]').onclick = async () => {
    const r = await confirmDialog({ title: 'Advise admission?', message: 'The visit is completed and marked “Referred to IP”. The front office is notified to allot a bed.', confirmLabel: 'Refer to IP', reason: true, reasonLabel: 'Reason for admission', reasonPlaceholder: 'e.g. Dengue with thrombocytopenia — needs IV fluids and monitoring', iconName: 'hospital' });
    if (!r) return;
    try { completeVisit(v.id, data(), u, { referToIp: true, referReason: r.reason }); toast('Admission advised. Front office notified.', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  q('[data-skip]').onclick = () => { try { skipVisit(v.id, u); toast(`${v.token} sent back to the queue.`, 'info'); navigate('#/op/queue'); } catch (e) { toast(e.message, 'error'); } };
}

function drawBills(host, v) {
  const u = currentUser();
  const bills = visitBills(v);
  const due = visitDue(v);
  host.innerHTML = `<section class="card"><header class="card-head"><div><h2>Bills & payments</h2><p class="muted small">${due ? `<span class="text-danger strong">${fmtINR(due)} to collect</span>` : 'Nothing due'}</p></div>
    <div class="card-actions">${can('op.bill') && !['CANCELLED'].includes(v.status) ? `<button class="btn btn-ghost btn-sm" data-svc>${icon('plus')}Add services</button>` : ''}</div></header><div class="card-body">
    ${bills.map((b) => { const rq = pendingRequestFor(b.id); const recs = receiptsFor(b.id);
      return `<div class="bill-mini"><div class="row-between"><div><strong class="mono">${esc(b.id)}</strong> <span class="muted small">${b.kind === 'CONSULTATION' ? 'Consultation' : 'Services'}</span></div>${cbadge(b.status)}</div>
        <ul class="bm-lines">${b.lines.map((l) => `<li><span>${esc(l.name)}${l.qty > 1 ? ` × ${l.qty}` : ''}</span><span>${fmtINR(l.amount)}</span></li>`).join('')}${b.discount ? `<li><span>Discount ${b.discountPct}%</span><span>− ${fmtINR(b.discount)}</span></li>` : ''}<li class="bm-total"><span>Total</span><span>${fmtINR(b.total)}</span></li></ul>
        ${recs.map((r) => `<div class="tiny muted">${r.kind === 'REFUND' ? 'Refunded' : 'Paid'} ${fmtINR(r.amount)} · ${esc(modeLabel(r.mode))} · ${esc(userName(r.userId))} · ${relTime(r.at)}</div>`).join('')}
        ${rq ? `<div class="tiny text-warning mt-1">${icon('hourglass', 'ic-inline')} ${rq.type === 'DISCOUNT' ? `${rq.pct}% discount` : 'Refund'} waiting for Super Admin · “${esc(rq.reason)}”</div>` : ''}
        <div class="row mt-1">${opBillDue(b) > 0 && can('op.bill') ? `<button class="btn btn-primary btn-sm" data-collect="${b.id}">${icon('indian-rupee')}Collect ${fmtINR(opBillDue(b))}</button>` : ''}
          ${b.status === 'REFUND_APPROVED' && can('op.bill') ? `<button class="btn btn-primary btn-sm" data-refund="${b.id}">${icon('undo-2')}Pay refund ${fmtINR(opBillPaid(b))}</button>` : ''}
          <a class="btn btn-ghost btn-sm" href="#/op/print/${v.id}?doc=bill&bill=${b.id}">${icon('printer')}Receipt</a></div></div>`; }).join('') || '<p class="muted small">No bills.</p>'}</div></section>`;
  host.querySelectorAll('[data-collect]').forEach((b) => { b.onclick = () => collectModal(b.dataset.collect); });
  host.querySelectorAll('[data-refund]').forEach((b) => { b.onclick = async () => { const ok = await confirmDialog({ title: 'Pay approved refund?', message: `Hand over ${fmtINR(opBillPaid(store.get('opBills', b.dataset.refund)))} to the patient. It is recorded on your counter.`, confirmLabel: 'Refund paid', iconName: 'undo-2' }); if (!ok) return; try { payOpRefund(b.dataset.refund, null, u); toast('Refund recorded.', 'success'); window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) { toast(e.message, 'error'); } }; });
  host.querySelector('[data-svc]')?.addEventListener('click', () => servicesModal(v));
}
function collectModal(billId) {
  const b = store.get('opBills', billId); const due = opBillDue(b);
  const m = openModal({ title: `Collect payment · ${b.id}`, subtitle: `${esc(patient(b.patientId).name)} · due ${fmtINR(due)}`, body: '<div data-pp></div>',
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save payment', cls: 'btn-primary', icon: 'check', onClick: (close) => { try { collectOpBill(billId, pp.get(), currentUser()); toast('Payment recorded.', 'success'); close(); window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) { toast(e.message, 'error'); } } }] });
  const pp = payPanel(m.el.querySelector('[data-pp]'), { amount: due });
}
function servicesModal(v) {
  const opts = servicesFor('OP');
  const items = [];
  const m = openModal({ title: 'Bill OP services', subtitle: `${esc(patient(v.patientId).name)} · ${v.token}`, size: 'lg',
    body: `<div class="row"><select class="input grow" data-add><option value="">+ Add service…</option>${['INVESTIGATION', 'PROCEDURE', 'OTHER'].map((cat) => `<optgroup label="${esc(cat === 'OTHER' ? 'Other' : cat[0] + cat.slice(1).toLowerCase() + 's')}">${opts.filter((s) => s.category === cat).map((s) => `<option value="${s.id}">${esc(s.name)} — ${fmtINR(s.rate, true)}</option>`).join('')}</optgroup>`).join('')}</select></div>
      <table class="table dense mt-1"><thead><tr><th>Service</th><th style="width:90px">Qty</th><th class="ta-right">Rate</th><th class="ta-right">Amount</th><th></th></tr></thead><tbody data-rows></tbody></table>
      <div class="form-grid mt-1"><div class="field col-3"><label>Discount %</label><input class="input" type="number" min="0" max="100" value="0" data-disc></div><div class="field col-9"><label>Discount reason</label><input class="input" data-dr placeholder="Required for a discount"></div></div>
      <div class="kv strong mt-1"><span>Total</span><span data-tot>₹0</span></div><div data-pp class="mt-1"></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Create bill', cls: 'btn-primary', icon: 'receipt', onClick: (close) => {
      try { const disc = Number(m.el.querySelector('[data-disc]').value) || 0; const b = addServicesBill(v.id, { items, discountPct: disc, discountReason: m.el.querySelector('[data-dr]').value, pay: pp.get().amount > 0 ? pp.get() : null }, currentUser()); toast(`${b.id} created.`, 'success'); close(); window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) { toast(e.message, 'error'); }
    } }] });
  const pp = payPanel(m.el.querySelector('[data-pp]'), { amount: 0 });
  const total = () => { const g = items.reduce((t, i) => t + service(i.serviceId).rate * i.qty, 0); const d = Number(m.el.querySelector('[data-disc]').value) || 0; return Math.round(g * (1 - d / 100)); };
  const draw = () => {
    m.el.querySelector('[data-rows]').innerHTML = items.map((i, k) => { const s = service(i.serviceId); return `<tr><td>${esc(s.name)}</td><td><input class="input input-sm" type="number" min="1" value="${i.qty}" data-q="${k}"></td><td class="ta-right">${fmtINR(s.rate)}</td><td class="ta-right">${fmtINR(s.rate * i.qty)}</td><td><button class="icon-btn" data-rm="${k}">${icon('x')}</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted small">Add services above.</td></tr>';
    const t = total(); m.el.querySelector('[data-tot]').textContent = fmtINR(t);
    const d = Number(m.el.querySelector('[data-disc]').value) || 0; pp.setAmount(d > discountLimit() && !can('hospital.approve') ? 0 : t);
    refreshIcons(m.el);
  };
  m.el.querySelector('[data-add]').onchange = (e) => { if (e.target.value) { const ex = items.find((i) => i.serviceId === e.target.value); if (ex) ex.qty++; else items.push({ serviceId: e.target.value, qty: 1 }); } e.target.value = ''; draw(); };
  m.el.addEventListener('change', (e) => { if (e.target.dataset.q != null) { items[+e.target.dataset.q].qty = Math.max(1, Number(e.target.value) || 1); setTimeout(draw); } if (e.target.matches('[data-disc]')) draw(); });
  m.el.addEventListener('click', (e) => { const r = e.target.closest('[data-rm]'); if (r) { items.splice(+r.dataset.rm, 1); draw(); } });
  draw();
}

// ---------------- prints ----------------
export function renderPrint(view, params, query) {
  const v = getVisit(params.id); if (!v) { view.innerHTML = emptyState('file-x', 'Visit not found'); return; }
  const p = patient(v.patientId); const d = doctor(v.doctorId); const doc = query.doc || 'slip';
  setMeta({ title: { slip: 'OP Sheet', rx: 'Prescription', bill: 'OP Receipt' }[doc] || 'Print', crumbs: [{ label: 'Outpatient' }, { label: v.token, href: '#/op/visits/' + v.id }, 'Print'] });
  const back = `<a class="btn btn-ghost" href="#/op/visits/${v.id}">${icon('arrow-left')}Back to visit</a>`;
  let body = '';
  if (doc === 'slip' && !consultPaid(v)) {
    body = emptyState('hourglass', 'OP sheet not generated yet', 'The OP sheet is generated after the consultation fee is paid at reception.', `<a class="btn btn-primary" href="#/op/visits/${v.id}">Open visit</a>`);
  } else if (doc === 'slip') {
    const b = visitBills(v).find((x) => x.kind === 'CONSULTATION');
    body = `<article class="receipt doc-slip">${docHead('OP SHEET')}
      <div class="slip-main"><div><div class="rc-meta slip-meta"><div><span>Patient</span><strong>${esc(p.name)}</strong></div><div><span>Patient ID</span><strong class="mono">${esc(p.uhid)}</strong></div><div><span>Age / Sex</span><strong>${esc(ageSex(p))}</strong></div><div><span>Mobile</span><strong>${esc(p.phone)}</strong></div>
        <div><span>Doctor</span><strong>${esc(d.name)}</strong></div><div><span>Department / Room</span><strong>${esc(deptName(v.departmentId))} · ${esc(d.room)}</strong></div><div><span>Visit</span><strong>${esc(label(v.visitType))}${v.mlc ? ' · MLC' : ''}</strong></div><div><span>Date & time</span><strong>${fmtDateTime(v.at)}</strong></div></div></div>
        <div class="slip-token"><span>TOKEN</span><strong>${esc(v.token)}</strong></div></div>
      <div class="rc-foot"><div class="rc-gst">${barcodeSVG(v.id, { height: 34 })}<span class="mono">${esc(v.id)}</span></div><div class="rc-totals"><div class="kv"><span>Consultation fee</span><span>${fmtINR(b?.gross || 0)}</span></div>${b?.discount ? `<div class="kv"><span>Discount</span><span>− ${fmtINR(b.discount)}</span></div>` : ''}<div class="kv strong"><span>Paid</span><span>${fmtINR(b ? opBillPaid(b) : 0)}</span></div></div></div>
      <p class="rc-small">Wait until your name and token appear on the display, then hand this OP sheet to the attendant at the doctor's room. Bring your patient card on every visit. ${d.followUpDays ? `Free follow-up with the same doctor within ${d.followUpDays} days of a paid visit.` : ''}</p></article>`;
  } else if (doc === 'rx') {
    const c = v.consultation || {};
    body = `<article class="receipt doc-a4 rx-doc">${docHead('PRESCRIPTION', `${esc(d.name)} · ${esc(d.qualification)} · Reg. ${esc(d.registrationNo)}`)}
      <div class="rc-meta"><div><span>Patient</span><strong>${esc(p.name)}</strong></div><div><span>Patient ID</span><strong class="mono">${esc(p.uhid)}</strong></div><div><span>Age / Sex</span><strong>${esc(ageSex(p))}</strong></div><div><span>Date</span><strong>${fmtDate(v.businessDate)} · ${esc(v.token)}</strong></div></div>
      ${v.vitals ? `<div class="rx-vitals">${vitalsChips(v.vitals, { compact: true })}</div>` : ''}${p.allergies ? `<div class="rx-allergy">Allergy: ${esc(p.allergies)}</div>` : ''}
      <div class="rx-sec"><span>Complaints</span><p>${esc(c.complaints || '—')}</p></div><div class="rx-sec"><span>Diagnosis</span><p><strong>${esc((c.diagnosis || []).join('; ') || '—')}</strong></p></div>
      <div class="rx-symbol">℞</div><table class="rc-table"><thead><tr><th>#</th><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Instructions</th><th class="r">Qty</th></tr></thead><tbody>
        ${(c.prescription || []).map((r, i) => `<tr><td>${i + 1}</td><td><strong>${esc(r.name)}</strong><div class="tiny">${esc(r.generic || '')}</div></td><td>${esc(r.dose)}</td><td class="mono">${esc(r.frequency)}</td><td>${r.days} day(s)</td><td>${esc(r.timing)}</td><td class="r">${r.qty ? `${r.qty} ${esc(r.unit || '')}` : ''}</td></tr>`).join('') || '<tr><td colspan="7">No medicines prescribed.</td></tr>'}</tbody></table>
      <div class="rx-sec mt-2"><span>Investigations</span><p>${(c.investigations || []).map((i) => esc(i.name)).join(', ') || '—'}</p></div><div class="rx-sec"><span>Advice</span><p>${esc(c.advice || '—')}</p></div>
      <div class="rx-sec"><span>Follow-up</span><p>${c.followUpDate ? fmtDate(c.followUpDate) : 'As needed'}</p></div>
      ${signLine([`${d.name} (${d.qualification})`])}${docFoot()}</article>`;
  } else {
    const b = store.get('opBills', query.bill) || visitBills(v)[0];
    const recs = receiptsFor(b.id);
    body = `<article class="receipt">${docHead(b.status === 'CANCELLED' ? 'CANCELLED BILL' : 'OP BILL / RECEIPT')}
      <div class="rc-meta"><div><span>Bill No</span><strong class="mono">${esc(b.id)}</strong></div><div><span>Date & time</span><strong>${fmtDateTime(b.at)}</strong></div><div><span>Patient</span><strong>${esc(p.name)}</strong></div><div><span>Patient ID</span><strong class="mono">${esc(p.uhid)}</strong></div>
        <div><span>Doctor</span><strong>${esc(d.name)}</strong></div><div><span>Visit / Token</span><strong>${esc(v.id)} · ${esc(v.token)}</strong></div><div><span>Status</span><strong>${esc(label(b.status))}</strong></div><div><span>Billed by</span><strong>${esc(userName(b.createdBy))}</strong></div></div>
      <table class="rc-table"><thead><tr><th>#</th><th>Service</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${b.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td class="r">${l.qty}</td><td class="r">${fmtINR(l.rate)}</td><td class="r">${fmtINR(l.amount)}</td></tr>`).join('')}</tbody></table>
      <div class="rc-foot"><div class="rc-gst"><strong>Payments</strong>${recs.map((r) => `<div>${r.kind === 'REFUND' ? 'Refund' : 'Paid'} ${fmtINR(r.amount)} · ${esc(modeLabel(r.mode))}${r.reference ? ' · ' + esc(r.reference) : ''} · ${fmtDateTime(r.at)} · ${esc(r.id)}</div>`).join('') || '<div>No payment yet</div>'}<div class="tiny">Healthcare services are exempt from GST.</div></div>
        <div class="rc-totals"><div class="kv"><span>Gross</span><span>${fmtINR(b.gross)}</span></div>${b.discount ? `<div class="kv"><span>Discount ${b.discountPct}%</span><span>− ${fmtINR(b.discount)}</span></div>` : ''}${b.roundOff ? `<div class="kv"><span>Round off</span><span>${fmtINR(b.roundOff)}</span></div>` : ''}
          <div class="kv strong"><span>Total</span><span>${fmtINR(b.total)}</span></div><div class="kv"><span>Paid</span><span>${fmtINR(opBillPaid(b))}</span></div><div class="kv"><span>Balance</span><span>${fmtINR(opBillDue(b))}</span></div></div></div>
      ${b.kind === 'SERVICES' && opBillDue(b) === 0 && b.status === 'PAID' ? '<p class="rc-thanks">Show this receipt at the lab / test counter to have the test done and collect the report.</p>' : ''}${docFoot()}</article>`;
  }
  view.innerHTML = `<div class="row mb-2 no-print print-bar"><button class="btn btn-primary" data-print>${icon('printer')}Print</button>${back}</div>${body}`;
  view.querySelector('[data-print]').onclick = () => window.print();
}
