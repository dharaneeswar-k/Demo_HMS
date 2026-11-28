// Admission wizard: 1 Patient & consultant · 2 Bed · 3 Payer & advance deposit. Prefills from an OP referral (?visit=) or a bed (?bed=).
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { activeDoctors, doctorName, deptName, patient, bed as getBed, bedCategories, categoryLabel, cs, label } from '../clinical.js';
import { admit, availableBeds, bedStatus, activeAdmissionOf } from '../ip.js';
import { patientSearch, patientStrip, payPanel, stepper } from './clinical-ui.js';
import { bedCard } from './ip-beds.js';
import { openModal } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, refreshIcons } from '../utils.js';
import { navigate } from '../router.js';

const RELATIONS = ['Husband', 'Wife', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Relative', 'Friend', 'Guardian'];

export function render(view, params, query) {
  const u = currentUser();
  const v = query.visit ? store.get('opVisits', query.visit) : null;
  const pre = query.bed ? getBed(query.bed) : null;
  const st = { step: 0, patient: v ? patient(v.patientId) : query.patient ? patient(query.patient) : null, doctorId: v?.doctorId || '', type: v ? 'FROM_OP' : 'PLANNED',
    diagnosis: v ? (v.consultation?.diagnosis || []).join('; ') || v.referral?.reason || '' : '', mlc: !!v?.mlc, attender: { name: '', relation: '', phone: '' },
    category: pre?.category || 'GENERAL', bedId: pre && ['AVAILABLE', 'RESERVED'].includes(bedStatus(pre)) ? pre.id : null,
    payer: { type: 'SELF', tpaId: '', insurer: '', policyNo: '', memberId: '', coPayPct: 0, requested: '', corporate: '', refNo: '' } };
  let pay = null;

  const draw = () => {
    const steps = [['Patient & consultant', 'Who, why and the attender'], ['Bed', 'Ward, room and bed'], ['Payer & advance', 'Self-pay, insurance or corporate']];
    view.innerHTML = `${stepper(steps, st.step)}
      <div class="grid grid-3-1"><div data-body class="col-stack"></div><aside><div class="sticky-side"><div class="summary-box" data-sum></div>
        <div class="row mt-2">${st.step > 0 ? `<button class="btn btn-secondary" data-back>${icon('arrow-left')}Back</button>` : ''}<span class="grow"></span>
          ${st.step < 2 ? `<button class="btn btn-primary" data-next>Next ${icon('arrow-right')}</button>` : `<button class="btn btn-primary btn-lg" data-admit>${icon('hospital')}Admit patient</button>`}</div></div></aside></div>`;
    const body = view.querySelector('[data-body]');
    if (st.step === 0) stepPatient(body); if (st.step === 1) stepBed(body); if (st.step === 2) stepPayer(body);
    drawSummary();
    view.querySelector('[data-back]')?.addEventListener('click', () => { st.step--; draw(); });
    view.querySelector('[data-next]')?.addEventListener('click', () => { const err = validate(st.step); if (err) return toast(err, 'warning'); st.step++; draw(); });
    view.querySelector('[data-admit]')?.addEventListener('click', submit);
    refreshIcons(view);
  };
  const drawSummary = () => {
    const c = bedCategories()[st.category]; const b = st.bedId ? getBed(st.bedId) : null;
    view.querySelector('[data-sum]').innerHTML = `<h3>Admission summary</h3>
      <div class="summary-row"><span>Patient</span><b>${st.patient ? esc(st.patient.name) : '—'}</b></div>
      <div class="summary-row"><span>Consultant</span><b>${st.doctorId ? esc(doctorName(st.doctorId)) : '—'}</b></div>
      <div class="summary-row"><span>Type</span><b>${esc(label(st.type))}</b></div>
      ${v ? `<div class="summary-row"><span>From OP</span><b>${esc(v.id)}</b></div>` : ''}
      <div class="summary-row"><span>Bed</span><b>${b ? `${esc(b.code)} · ${esc(c.label)}` : '—'}</b></div>
      <div class="summary-row"><span>Bed + nursing / day</span><b>${fmtINR(c.rate + c.nursing, true)}</b></div>
      <div class="summary-row"><span>Payer</span><b>${esc(label(st.payer.type))}</b></div>
      <div class="summary-row total"><span>Suggested advance</span><span>${fmtINR(suggested(), true)}</span></div>`;
  };
  const suggested = () => { const a = bedCategories()[st.category].advance; return st.payer.type === 'SELF' ? a : st.payer.type === 'INSURANCE' ? Math.min(5000, a) : 0; };

  function stepPatient(body) {
    body.innerHTML = `<section class="card"><header class="card-head"><h2>Patient</h2></header><div class="card-body"><div data-psearch></div><div data-pt class="mt-2"></div></div></section>
      <section class="card"><header class="card-head"><h2>Admission details</h2></header><div class="card-body"><div class="form-grid">
        <div class="field col-6"><label>Consultant <span class="req">*</span></label><select class="input" name="doctorId"><option value="">Choose…</option>${activeDoctors().map((d) => `<option value="${d.id}" ${st.doctorId === d.id ? 'selected' : ''}>${esc(d.name)} — ${esc(deptName(d.departmentId))}</option>`).join('')}</select></div>
        <div class="field col-6"><label>Admission type</label><div class="seg seg-full">${['PLANNED', 'EMERGENCY', 'FROM_OP'].map((t) => `<button type="button" class="seg-btn ${st.type === t ? 'active' : ''}" data-t="${t}">${esc(label(t))}</button>`).join('')}</div></div>
        <div class="field col-9"><label>Provisional diagnosis / reason for admission <span class="req">*</span></label><input class="input" name="diagnosis" value="${esc(st.diagnosis)}" placeholder="e.g. Dengue fever with thrombocytopenia"></div>
        <div class="field col-3"><label>Medico-legal</label><label class="check mt-1"><input type="checkbox" name="mlc" ${st.mlc ? 'checked' : ''}> MLC case</label></div>
        <div class="field col-5"><label>Attender name <span class="req">*</span></label><input class="input" name="attName" value="${esc(st.attender.name)}"></div>
        <div class="field col-3"><label>Relation</label><select class="input" name="attRel">${RELATIONS.map((r) => `<option ${st.attender.relation === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
        <div class="field col-4"><label>Attender mobile <span class="req">*</span></label><div class="input-prefix"><span>+91</span><input class="input" name="attPhone" maxlength="10" inputmode="numeric" value="${esc(st.attender.phone)}"></div></div>
      </div></div></section>`;
    const drawPt = () => {
      const host = body.querySelector('[data-pt]');
      if (!st.patient) { host.innerHTML = `<div class="hint-box">${icon('scan-line')}<span>Search or scan the patient card. Unregistered patients can be registered from the search.</span></div>`; return; }
      const a = activeAdmissionOf(st.patient.id);
      host.innerHTML = patientStrip(st.patient, { extra: `<button class="btn btn-ghost btn-sm" data-clear>${icon('x')}Change</button>` }) + (a ? `<div class="alert alert-danger mt-1">${icon('bed-double')}<div>Already admitted as <a href="#/ip/admissions/${a.id}">${a.id}</a>.</div></div>` : '');
      host.querySelector('[data-clear]').onclick = () => { st.patient = null; drawPt(); drawSummary(); };
      if (!st.attender.name && st.patient.guardianName) st.attender.name = st.patient.guardianName.replace(/\s*\(.*\)$/, '');
      refreshIcons(host);
    };
    patientSearch(body.querySelector('[data-psearch]'), { onPick: (p) => { st.patient = p; drawPt(); drawSummary(); body.querySelector('[name=attName]').value = st.attender.name || ''; } });
    drawPt();
    body.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { st.type = b.dataset.t; body.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('active', x === b)); drawSummary(); }; });
    const sync = () => { st.doctorId = body.querySelector('[name=doctorId]').value; st.diagnosis = body.querySelector('[name=diagnosis]').value; st.mlc = body.querySelector('[name=mlc]').checked;
      st.attender = { name: body.querySelector('[name=attName]').value, relation: body.querySelector('[name=attRel]').value, phone: body.querySelector('[name=attPhone]').value.replace(/\D/g, '') }; drawSummary(); };
    body.addEventListener('input', sync); body.addEventListener('change', sync);
  }
  function stepBed(body) {
    const beds = store.all('beds').filter((b) => b.active && b.category === st.category && ['AVAILABLE', 'RESERVED'].includes(bedStatus(b)));
    body.innerHTML = `<section class="card"><header class="card-head"><div><h2>Choose a bed</h2><p class="muted small">Only available and reserved beds are shown. Rates are per calendar day; nursing is charged with the bed.</p></div></header><div class="card-body">
      <div class="seg seg-full">${Object.entries(bedCategories()).map(([k, c]) => `<button type="button" class="seg-btn ${k === st.category ? 'active' : ''}" data-c="${k}">${esc(c.label)}<br><small>${fmtINR(c.rate, true)} + ${fmtINR(c.nursing, true)} · ${availableBeds(k).length} free</small></button>`).join('')}</div>
      <div class="bed-pick mt-2">${beds.length ? `<div class="beds">${beds.map((b) => bedCard(b, { selectable: true, selected: b.id === st.bedId })).join('')}</div>` : `<div class="hint-box">${icon('bed')}No free ${esc(categoryLabel(st.category))} bed right now. Choose another category, or ask the nurse to mark a cleaned bed ready.</div>`}</div></div></section>`;
    body.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => { st.category = b.dataset.c; st.bedId = null; draw(); }; });
    body.querySelectorAll('[data-bed]').forEach((b) => { b.onclick = () => { st.bedId = b.dataset.bed; draw(); }; });
  }
  function stepPayer(body) {
    const c = cs();
    body.innerHTML = `<section class="card"><header class="card-head"><div><h2>Who pays?</h2><p class="muted small">Insurance and corporate cases are recorded here. Approvals are updated on the Insurance / TPA desk; nothing is sent to the insurer automatically.</p></div></header><div class="card-body">
      <div class="seg seg-full">${['SELF', 'INSURANCE', 'CORPORATE'].map((t) => `<button type="button" class="seg-btn ${st.payer.type === t ? 'active' : ''}" data-p="${t}">${icon({ SELF: 'user-round', INSURANCE: 'shield-plus', CORPORATE: 'building-2' }[t])}${esc(label(t))}</button>`).join('')}</div>
      ${st.payer.type === 'INSURANCE' ? `<div class="form-grid mt-2">
        <div class="field col-6"><label>TPA <span class="req">*</span></label><select class="input" name="tpaId"><option value="">Choose…</option>${c.tpas.map((t) => `<option value="${t.id}" ${st.payer.tpaId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
        <div class="field col-6"><label>Insurance company <span class="req">*</span></label><select class="input" name="insurer"><option value="">Choose…</option>${c.insurers.map((t) => `<option ${st.payer.insurer === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div class="field col-4"><label>Policy number <span class="req">*</span></label><input class="input" name="policyNo" value="${esc(st.payer.policyNo)}"></div>
        <div class="field col-3"><label>Member / card ID</label><input class="input" name="memberId" value="${esc(st.payer.memberId)}"></div>
        <div class="field col-2"><label>Co-pay %</label><input class="input" type="number" min="0" max="100" name="coPayPct" value="${st.payer.coPayPct}"></div>
        <div class="field col-3"><label>Pre-auth amount requested</label><div class="input-prefix"><span>₹</span><input class="input" type="number" min="0" name="requested" value="${esc(st.payer.requested)}"></div></div></div>`
      : st.payer.type === 'CORPORATE' ? `<div class="form-grid mt-2">
        <div class="field col-6"><label>Company <span class="req">*</span></label><select class="input" name="corporate"><option value="">Choose…</option>${c.corporates.map((t) => `<option ${st.payer.corporate === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div class="field col-3"><label>Employee ID</label><input class="input" name="memberId" value="${esc(st.payer.memberId)}"></div>
        <div class="field col-3"><label>Credit letter limit</label><div class="input-prefix"><span>₹</span><input class="input" type="number" min="0" name="requested" value="${esc(st.payer.requested)}"></div></div>
        <div class="field col-6"><label>Credit letter reference</label><input class="input" name="refNo" value="${esc(st.payer.refNo)}"></div></div>` : ''}
    </div></section>
    <section class="card"><header class="card-head"><div><h2>Advance deposit</h2><p class="muted small">Suggested ${fmtINR(suggested(), true)} for ${esc(categoryLabel(st.category))}${st.payer.type !== 'SELF' ? ' (lower for insurance / corporate — the patient pays co-pay and non-payable items)' : ''}. It is adjusted against the final bill; any excess is refunded at discharge.</p></div></header>
      <div class="card-body"><div data-pay></div></div></section>`;
    body.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { readPayer(body); st.payer.type = b.dataset.p; draw(); }; });
    body.addEventListener('change', () => { readPayer(body); drawSummary(); });
    pay = payPanel(body.querySelector('[data-pay]'), { amount: suggested(), label: 'Deposit amount' });
  }
  const readPayer = (body) => { ['tpaId', 'insurer', 'policyNo', 'memberId', 'coPayPct', 'requested', 'corporate', 'refNo'].forEach((k) => { const el = body.querySelector(`[name=${k}]`); if (el) st.payer[k] = el.value; }); };
  const validate = (step) => {
    if (step === 0) {
      if (!st.patient) return 'Select the patient.';
      if (activeAdmissionOf(st.patient.id)) return 'This patient is already admitted.';
      if (!st.doctorId) return 'Choose the consultant.';
      if (!st.diagnosis.trim()) return 'Enter the provisional diagnosis.';
      if (!st.attender.name.trim() || !/^[6-9]\d{9}$/.test(st.attender.phone)) return 'Enter the attender name and a valid 10-digit mobile.';
    }
    if (step === 1 && !st.bedId) return 'Choose a bed.';
    return null;
  };
  function submit() {
    readPayer(view);
    const d = pay.get();
    try {
      const adm = admit({ patientId: st.patient.id, doctorId: st.doctorId, bedId: st.bedId, admissionType: st.type, opVisitId: v?.id || null, diagnosis: st.diagnosis, attender: st.attender, mlc: st.mlc,
        payer: st.payer, deposit: d.amount > 0 ? d : null }, u);
      const b = getBed(st.bedId);
      openModal({ title: 'Patient admitted', size: 'sm', body: `<div class="token-issued"><div class="ti-label">IP number</div><div class="ti-token" style="font-size:36px">${esc(adm.id)}</div><div class="ti-sub">${esc(st.patient.name)} · bed ${esc(b.code)}</div>
        <div class="ti-meta"><span>${esc(doctorName(adm.doctorId))}</span><span>${d.amount > 0 ? `Deposit ${fmtINR(d.amount)}` : 'No deposit taken'}</span></div></div>
        <div class="row mt-2" style="justify-content:center"><a class="btn btn-secondary btn-sm" href="#/ip/print/${adm.id}?doc=admission">${icon('file-text')}Admission form</a><a class="btn btn-secondary btn-sm" href="#/ip/print/${adm.id}?doc=wristband">${icon('scan-line')}Wristband</a>${d.amount > 0 ? `<a class="btn btn-secondary btn-sm" href="#/ip/print/${adm.id}?doc=deposit">${icon('receipt')}Deposit receipt</a>` : ''}</div>`,
        footer: [{ label: 'Open folio', cls: 'btn-primary', icon: 'folder-heart', onClick: (c) => { c(); navigate('#/ip/admissions/' + adm.id); } }] });
      refreshIcons(document.body);
      toast(`${st.patient.name} admitted to ${b.code}.`, 'success', 'Admitted');
    } catch (e) { toast(e.message, 'error'); }
  }
  if (!can('ip.admit')) { view.innerHTML = ''; return; }
  draw();
}
