// Central Billing counter (BRD 08): one bill per patient for lab tests, ECG, injection, nebulization, other services
// and packages. Package services are billed at ₹0, doctor requests raised at the service counter are picked up,
// and nothing reaches a department until the bill is paid or credit / emergency is approved.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { CATS, catLabel, catIcon, svc, pkg, activeEnrolments, packageUsage, priceHospitalDraft, validateHospitalDraft, completeHospitalBill, discountLimit, requestHospitalDiscount, patientOf } from '../hospital.js';
import { openShiftFor, shiftSummary } from '../shifts.js';
import { cancelDiscountRequest } from '../pharmacy-services.js';
import { combo, confirmDialog, emptyState, openModal } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, fmtDate, refreshIcons, relTime } from '../utils.js';
import { navigate } from '../router.js';
import { openPatientForm } from './patients.js';
import { patientAge } from '../patients.js';
import { openStartShift } from './shifts.js';
import { SOURCE, PRIORITY, saveReferralDoctor } from '../labflow.js';
import { saveBlob } from '../attachment-store.js';

const KEY = 'nallam_hms_hbill_draft';
const blank = () => ({ patientId: '', doctor: '', lines: [], discountPct: 0, discountRequestId: null, payMode: 'CASH', payments: [{ mode: 'CASH', amount: '', tendered: '', reference: '' }], credit: { type: '', reason: '' }, remarks: '', lab: { source: 'OP', referralDoctorId: '', priority: 'ROUTINE', prescription: null, consent: false, notes: '' } });
const PAY = [['CASH', 'Cash', 'banknote'], ['UPI', 'UPI', 'smartphone'], ['CARD', 'Card', 'credit-card'], ['SPLIT', 'Split', 'split'], ['CREDIT', 'Credit', 'hand-coins'], ['EMERGENCY', 'Emergency', 'siren']];

export function render(view, params, query) {
  const user = currentUser();
  let d = (() => { try { return { ...blank(), ...JSON.parse(sessionStorage.getItem(KEY) || 'null') }; } catch { return blank(); } })();
  if (query.patient && query.patient !== d.patientId) d = { ...blank(), patientId: query.patient };
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(d));
  let cat = 'ALL';
  const doctors = store.ph().doctors || [];

  view.innerHTML = `
    <div class="row-between mb-2"><div class="bill-steps"><span><b>1</b>Patient</span>${icon('chevron-right')}<span><b>2</b>Services</span>${icon('chevron-right')}<span><b>3</b>Payment</span></div>
      <div class="row"><span data-shift></span><a class="btn btn-ghost btn-sm" href="#/hbills">${icon('history')}Hospital bills</a><button class="btn btn-ghost btn-sm" data-clear>${icon('eraser')}Clear</button></div></div>
    <div class="bill-grid">
      <div class="bill-left">
        <section class="card"><header class="card-head"><h2><span class="step-dot">1</span> Patient</h2><span class="muted small">Bills are raised against a Patient ID</span></header>
          <div class="card-body"><div class="form-grid">
            <div class="field col-12"><label>Patient <span class="req">*</span></label><div data-pat></div></div>
            <div class="col-12" data-pcard></div>
            <div class="field col-12"><label>Referring / ordering doctor</label><input class="input" data-doc list="hb-docs" placeholder="Doctor who advised the services"><datalist id="hb-docs">${doctors.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
            <div class="col-12" data-pkgs></div><div class="col-12" data-reqs></div>
          </div></div></section>
        <section class="card mt-2"><header class="card-head"><h2><span class="step-dot">2</span> Add services</h2></header>
          <div class="card-body"><div class="cat-chips" data-cats></div>
            <div class="input-icon mt-2">${icon('search')}<input class="input" data-q placeholder="Search test, service or package — e.g. CBC, ECG, dressing" autocomplete="off" style="height:42px"></div>
            <div class="svc-grid mt-2" data-results></div></div></section>
      </div>
      <div class="bill-right">
        <section class="card"><header class="card-head"><h2>${icon('receipt')} Bill</h2><span class="muted small" data-count></span></header><div data-lines></div><div class="bill-totals" data-totals></div></section>
        <section class="card mt-2 hidden" data-labcard><header class="card-head"><h2>${icon('flask-conical')} Lab request</h2><span class="muted small">How did the patient come for these tests?</span></header><div class="card-body" data-lab></div></section>
        <section class="card mt-2"><header class="card-head"><h2><span class="step-dot">3</span> Payment</h2></header><div class="card-body"><div class="pay-modes" data-modes></div><div data-pay class="mt-2"></div></div></section>
        <div class="bill-actions"><div data-msgs class="grow"></div><button class="btn btn-primary btn-lg" data-complete>${icon('check-circle-2')}Complete bill</button></div>
      </div>
    </div>`;
  const $ = (s) => view.querySelector(s);

  // ---------------- shift chip ----------------
  const drawShift = () => {
    const sh = openShiftFor(user);
    $('[data-shift]').innerHTML = can('discount.approve') ? '' : sh ? `<a class="shift-chip ok" href="#/shifts">${icon('timer')}${esc(sh.shiftName)} shift · drawer ${fmtINR(shiftSummary(sh).expectedCash, true)}</a>` : `<button class="shift-chip warn" data-startshift>${icon('play')}Start shift to bill</button>`;
    $('[data-startshift]')?.addEventListener('click', () => openStartShift(() => { drawShift(); drawMsgs(); }));
    refreshIcons($('[data-shift]'));
  };

  // ---------------- patient ----------------
  const pat = combo($('[data-pat]'), { options: () => store.all('patients').filter((p) => p.active !== false).map((p) => ({ value: p.id, label: p.name, sub: `${p.uhid} · ${p.gender}/${patientAge(p) ?? '—'} · ${p.phone}`, keywords: p.uhid + ' ' + p.phone.replace(/\D/g, '') })),
    value: d.patientId, placeholder: 'Search by name, Patient ID or mobile…',
    footer: can('patient.register') ? { html: `${icon('user-plus')} Register new patient`, onClick: () => openPatientForm({ onSaved: (p) => choose(p.id) }) } : null, onChange: (v) => choose(v) });
  function choose(pid) {
    if (pid !== d.patientId) { d.lines = d.lines.filter((l) => !l.orderIds?.length); d.lines.forEach((l) => { delete l.orderIds; }); }
    d.patientId = pid; pat.set(pid); save(); drawPatient(); drawAll();
  }
  $('[data-doc]').value = d.doctor; $('[data-doc]').oninput = (e) => { d.doctor = e.target.value; save(); };
  function drawPatient() {
    const p = d.patientId && patientOf(d.patientId);
    $('[data-pcard]').innerHTML = p ? `<div class="pat-chip">${icon('user-round')}<div class="grow"><strong>${esc(p.name)}</strong><span class="mono">${esc(p.uhid)}</span><span>${esc(p.gender)}/${patientAge(p) ?? '—'} · ${esc(p.phone)}</span></div><a class="btn btn-ghost btn-sm" href="#/patients/${p.id}" target="_blank">${icon('external-link')}Profile</a></div>${p.allergies ? `<div class="alert alert-danger mt-1">${icon('alert-triangle')}<div><strong>Allergy: ${esc(p.allergies)}</strong></div></div>` : ''}` : '';
    const en = p ? activeEnrolments(p.id) : [];
    $('[data-pkgs]').innerHTML = en.map((pp) => { const u = packageUsage(pp); const left = u.reduce((t, x) => t + x.remaining, 0); const tot = u.reduce((t, x) => t + x.included, 0);
      return `<div class="pkg-chip">${icon('package-check')}<div class="grow"><strong>${esc(pkg(pp.packageId).name)}</strong><span>${left} of ${tot} included services left · valid till ${fmtDate(pp.validUntil)}</span></div><a class="btn btn-ghost btn-sm" href="#/packages/enrolments/${pp.id}" target="_blank">Usage</a></div>`; }).join('');
    const reqs = p ? store.all('orders').filter((o) => o.patientId === p.id && o.status === 'REQUESTED') : [];
    const used = new Set(d.lines.flatMap((l) => l.orderIds || []));
    $('[data-reqs]').innerHTML = reqs.length ? `<div class="req-box"><div class="req-head">${icon('clipboard-list')}<strong>Advised by the doctor — not billed yet</strong></div>${reqs.map((o) => `<div class="req-row"><span>${icon(catIcon(o.category))}${esc(o.name)}<small>${esc(o.doctor || '—')} · ${relTime(o.requestedAt)}</small></span>${used.has(o.id) ? '<span class="tag tag-success">On this bill</span>' : `<button class="btn btn-secondary btn-sm" data-addreq="${o.id}">${icon('plus')}Add</button>`}</div>`).join('')}</div>` : '';
    $('[data-reqs]').querySelectorAll('[data-addreq]').forEach((b) => { b.onclick = () => { const o = store.get('orders', b.dataset.addreq); const ex = d.lines.find((l) => l.serviceId === o.serviceId); if (ex) { ex.qty = Number(ex.qty) + 1; (ex.orderIds ||= []).push(o.id); } else d.lines.push({ serviceId: o.serviceId, qty: 1, orderIds: [o.id] }); if (!d.doctor && o.doctor) { d.doctor = o.doctor; $('[data-doc]').value = o.doctor; } save(); drawPatient(); drawAll(); }; });
    refreshIcons(view);
  }

  // ---------------- catalog ----------------
  const covers = () => { const m = {}; if (d.patientId) activeEnrolments(d.patientId).forEach((pp) => packageUsage(pp).forEach((u) => { m[u.serviceId] = (m[u.serviceId] || 0) + u.remaining; })); return m; };
  function drawCats() {
    $('[data-cats]').innerHTML = [['ALL', 'All', 'layout-grid'], ...CATS().map((c) => [c.code, c.label, c.icon])].map(([c, l, ic]) => `<button class="chip ${cat === c ? 'active' : ''}" data-cat="${c}">${icon(ic)}${esc(l)}</button>`).join('');
    $('[data-cats]').querySelectorAll('[data-cat]').forEach((b) => { b.onclick = () => { cat = b.dataset.cat; drawCats(); drawResults(); }; });
    refreshIcons($('[data-cats]'));
  }
  function drawResults() {
    const q = $('[data-q]').value.trim().toLowerCase(); const cov = covers();
    const svcs = cat === 'PACKAGE' ? [] : store.all('services').filter((s) => s.active && (cat === 'ALL' || s.category === cat) && (!q || (s.name + ' ' + s.code).toLowerCase().includes(q)));
    const pkgs = cat === 'ALL' || cat === 'PACKAGE' ? store.all('packages').filter((p) => p.active && (!q || (p.name + ' ' + p.code).toLowerCase().includes(q))) : [];
    const card = (s) => `<button class="svc-card" data-add="${s.id}"><span class="svc-ic cat-${s.category.toLowerCase()}">${icon(catIcon(s.category))}</span><span class="svc-txt"><strong>${esc(s.name)}</strong><small>${esc(s.code)} · ${s.lab ? esc(s.lab.sample) + ' · ' + s.lab.tatHours + ' h' : catLabel(s.category)}</small></span><span class="svc-price">${cov[s.id] ? `<span class="tag tag-purple">In package</span>` : fmtINR(s.price, true)}</span></button>`;
    const pcard = (p) => `<button class="svc-card pkg" data-addpkg="${p.id}"><span class="svc-ic cat-package">${icon('package')}</span><span class="svc-txt"><strong>${esc(p.name)}</strong><small>${p.includes.length} services · valid ${p.validityDays} day(s)</small></span><span class="svc-price">${fmtINR(p.price, true)}</span></button>`;
    $('[data-results]').innerHTML = (pkgs.map(pcard).join('') + svcs.slice(0, 40).map(card).join('')) || emptyState('search-x', 'Nothing found', 'Try another name or code.');
    $('[data-results]').querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => addSvc(b.dataset.add); });
    $('[data-results]').querySelectorAll('[data-addpkg]').forEach((b) => { b.onclick = () => { if (!d.patientId) return toast('Select the patient first.', 'warning'); if (d.lines.some((l) => l.packageId === b.dataset.addpkg)) return toast('This package is already on the bill.', 'info'); d.lines.push({ packageId: b.dataset.addpkg, qty: 1 }); save(); drawAll(); }; });
    refreshIcons($('[data-results]'));
  }
  function addSvc(id) { const ex = d.lines.find((l) => l.serviceId === id); if (ex) ex.qty = Number(ex.qty) + 1; else d.lines.push({ serviceId: id, qty: 1 }); save(); drawAll(); $('[data-q]').select(); }
  $('[data-q]').addEventListener('input', drawResults);
  $('[data-q]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const f = $('[data-results] [data-add], [data-results] [data-addpkg]'); f?.click(); } });

  // ---------------- lines & totals ----------------
  function drawLines() {
    const t = priceHospitalDraft(d);
    $('[data-count]').textContent = d.lines.length ? `${d.lines.length} item(s)` : '';
    $('[data-lines]').innerHTML = d.lines.length ? `<table class="table dense bill-table"><thead><tr><th>Service</th><th class="ta-center">Qty</th><th class="ta-right">Rate</th><th class="ta-right">Amount</th><th></th></tr></thead><tbody>
      ${d.lines.map((l, i) => { const its = t.items.filter((x) => x.line === i); const amt = its.reduce((s, x) => s + x.gross, 0); const cov = its.filter((x) => x.coveredBy).reduce((s, x) => s + x.qty, 0); const s = l.packageId ? null : svc(l.serviceId);
        return `<tr><td><strong>${esc(l.packageId ? pkg(l.packageId).name : s.name)}</strong><div class="cell-sub">${icon(catIcon(l.packageId ? 'PACKAGE' : s.category), 'ic-inline')} ${catLabel(l.packageId ? 'PACKAGE' : s.category)}${l.orderIds?.length ? ' · doctor request' : ''}${cov ? ` · <span class="text-purple">${cov} in package</span>` : ''}</div></td>
          <td class="ta-center">${l.packageId ? '1' : `<div class="qty-step"><button data-dec="${i}">−</button><input data-qty="${i}" value="${l.qty}" inputmode="numeric"><button data-inc="${i}">+</button></div>`}</td>
          <td class="ta-right">${fmtINR(l.packageId ? pkg(l.packageId).price : s.price)}</td><td class="ta-right strong">${fmtINR(amt)}</td><td><button class="icon-btn" data-rm="${i}" aria-label="Remove">${icon('x')}</button></td></tr>`; }).join('')}</tbody></table>`
      : emptyState('clipboard-plus', 'No services yet', 'Pick a patient, then add tests, services or a package.');
    const lim = discountLimit(user); const req = d.discountRequestId && store.get('discountRequests', d.discountRequestId);
    $('[data-totals]').innerHTML = d.lines.length ? `<div class="kv"><span>Sub-total</span><strong>${fmtINR(t.gross)}</strong></div>
      ${t.covered ? `<div class="kv text-purple"><span>${icon('package-check', 'ic-inline')} Covered by package (not charged)</span><span>${fmtINR(t.covered)}</span></div>` : ''}
      <div class="kv"><span>Discount <input class="input input-sm disc-in" type="number" min="0" max="100" step="0.5" data-disc value="${d.discountPct || ''}" placeholder="0">% <small class="muted">limit ${lim}%</small></span><span>−${fmtINR(t.discountTotal)}</span></div>
      ${t.discountPct > lim ? `<div class="disc-req">${req ? `${icon(req.status === 'APPROVED' ? 'check-circle-2' : req.status === 'REJECTED' ? 'x-circle' : 'hourglass')}<span>${req.status === 'APPROVED' ? `Approved by ${esc(store.get('users', req.decidedBy)?.name)} — you can complete the bill.` : req.status === 'REJECTED' ? `Rejected: ${esc(req.decisionNote)}` : 'Waiting for the owner… this screen updates by itself.'}</span>${req.status === 'PENDING' ? '<button class="btn btn-ghost btn-sm" data-withdraw>Withdraw</button>' : ''}` : `${icon('shield-alert')}<span>Above ${lim}% needs Super Admin approval.</span><button class="btn btn-secondary btn-sm" data-askdisc>Request approval</button>`}</div>` : ''}
      ${t.roundOff ? `<div class="kv"><span>Round off</span><span>${t.roundOff > 0 ? '+' : ''}${fmtINR(t.roundOff)}</span></div>` : ''}
      <div class="kv grand"><span>Grand total</span><strong>${fmtINR(t.grandTotal)}</strong></div>` : '';
    const L = $('[data-lines]');
    L.querySelectorAll('[data-inc]').forEach((b) => { b.onclick = () => { d.lines[b.dataset.inc].qty = Number(d.lines[b.dataset.inc].qty) + 1; save(); drawAll(); }; });
    L.querySelectorAll('[data-dec]').forEach((b) => { b.onclick = () => { const l = d.lines[b.dataset.dec]; if (l.qty > 1) { l.qty -= 1; save(); drawAll(); } }; });
    L.querySelectorAll('[data-qty]').forEach((inp) => { inp.onchange = () => { d.lines[inp.dataset.qty].qty = Math.max(1, Math.floor(Number(inp.value) || 1)); save(); drawAll(); }; });
    L.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { d.lines.splice(+b.dataset.rm, 1); save(); drawAll(); drawPatient(); }; });
    const di = $('[data-totals] [data-disc]'); if (di) di.onchange = () => { d.discountPct = Math.max(0, Math.min(100, Number(di.value) || 0)); if (d.discountRequestId && store.get('discountRequests', d.discountRequestId)?.requestedPct !== d.discountPct) d.discountRequestId = null; save(); drawAll(); };
    $('[data-totals] [data-askdisc]')?.addEventListener('click', async () => {
      const r = await confirmDialog({ title: `Ask the owner for ${t.discountPct}% discount`, iconName: 'percent', confirmLabel: 'Send request', reason: true, reasonLabel: 'Reason', reasonPlaceholder: 'e.g. Senior citizen, hospital staff family, welfare case', message: `${fmtINR(t.discountTotal)} off ${fmtINR(t.gross)}. The bill stays here until the owner decides.` });
      if (!r) return; try { const rq = requestHospitalDiscount(d, r.reason, user); d.discountRequestId = rq.id; save(); drawAll(); toast('Request sent to the owner.', 'info'); } catch (e) { toast(e.message, 'error'); }
    });
    $('[data-totals] [data-withdraw]')?.addEventListener('click', () => { cancelDiscountRequest(d.discountRequestId, user); d.discountRequestId = null; save(); drawAll(); });
    refreshIcons(view);
  }

  // ---------------- payment ----------------
  function drawPay() {
    const T = priceHospitalDraft(d).grandTotal;
    $('[data-modes]').innerHTML = PAY.map(([m, l, ic]) => `<button class="pay-mode ${d.payMode === m ? 'active' : ''} ${m === 'EMERGENCY' ? 'danger' : ''}" data-mode="${m}">${icon(ic)}<span>${l}</span></button>`).join('');
    const p0 = d.payments[0] || {};
    let body = '';
    if (['CASH', 'UPI', 'CARD'].includes(d.payMode)) {
      d.payments = [{ mode: d.payMode, amount: T, tendered: p0.mode === 'CASH' ? p0.tendered : '', reference: p0.mode === d.payMode ? p0.reference : '' }];
      body = d.payMode === 'CASH' ? `<div class="form-grid"><div class="field col-4"><label>Amount</label><input class="input strong" readonly value="${fmtINR(T)}"></div><div class="field col-4"><label>Cash given</label><input class="input" type="number" min="0" data-tend value="${d.payments[0].tendered || ''}" placeholder="${T}"></div><div class="field col-4"><label>Return change</label><input class="input strong" readonly data-change value="${fmtINR(Math.max(0, (Number(d.payments[0].tendered) || T) - T))}"></div></div>`
        : `<div class="form-grid"><div class="field col-4"><label>Amount</label><input class="input strong" readonly value="${fmtINR(T)}"></div><div class="field col-8"><label>${d.payMode === 'UPI' ? 'UPI transaction ID / UTR' : 'Card last 4 digits / approval code'}</label><input class="input" data-ref value="${esc(d.payments[0].reference || '')}"></div></div>`;
    } else if (d.payMode === 'SPLIT') {
      if (d.payments.length < 2) d.payments = [{ mode: 'CASH', amount: '', reference: '' }, { mode: 'UPI', amount: '', reference: '' }];
      body = d.payments.map((p, i) => `<div class="row mb-1" data-pi="${i}"><select class="input" style="width:120px" data-pmode>${['CASH', 'UPI', 'CARD'].map((m) => `<option ${p.mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select><input class="input" style="width:130px" type="number" min="0" data-pamt value="${p.amount}" placeholder="Amount"><input class="input grow" data-pref value="${esc(p.reference || '')}" placeholder="Reference" ${p.mode === 'CASH' ? 'disabled' : ''}></div>`).join('') + `<div class="muted small">Total must equal ${fmtINR(T)}.</div>`;
    } else {
      const em = d.payMode === 'EMERGENCY';
      d.credit = { type: d.payMode, reason: d.credit?.reason || '' };
      if (d.payments.length !== 1 || !['CASH', 'UPI'].includes(d.payments[0].mode)) d.payments = [{ mode: 'CASH', amount: '', reference: '' }];
      body = `<div class="alert ${em ? 'alert-danger' : 'alert-warning'} mb-2">${icon(em ? 'siren' : 'hand-coins')}<div>${em ? '<strong>Emergency:</strong> services start immediately; the owner is alerted and the balance is collected later.' : '<strong>Credit:</strong> the bill goes to the owner for approval. Services stay on hold until approved.'}</div></div>
        <div class="form-grid"><div class="field col-12"><label>Reason <span class="req">*</span></label><input class="input" data-creason value="${esc(d.credit.reason)}" placeholder="${em ? 'e.g. Accident case — attender arranging money' : 'e.g. Long-term patient, family pays monthly'}"></div>
        <div class="field col-4"><label>Part payment now</label><select class="input" data-pmode0>${['CASH', 'UPI'].map((m) => `<option ${d.payments[0].mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div><div class="field col-8"><label>Amount received (optional)</label><input class="input" type="number" min="0" data-pamt0 value="${d.payments[0].amount}" placeholder="0"></div></div>`;
    }
    if (!['CREDIT', 'EMERGENCY'].includes(d.payMode)) d.credit = { type: '', reason: '' };
    $('[data-pay]').innerHTML = body;
    const P = $('[data-pay]');
    P.querySelector('[data-tend]')?.addEventListener('input', (e) => { d.payments[0].tendered = e.target.value; P.querySelector('[data-change]').value = fmtINR(Math.max(0, (Number(e.target.value) || T) - T)); save(); });
    P.querySelector('[data-ref]')?.addEventListener('input', (e) => { d.payments[0].reference = e.target.value; save(); });
    P.querySelectorAll('[data-pi]').forEach((row) => { const i = +row.dataset.pi; row.querySelector('[data-pmode]').onchange = (e) => { d.payments[i].mode = e.target.value; save(); drawPay(); }; row.querySelector('[data-pamt]').oninput = (e) => { d.payments[i].amount = e.target.value; save(); drawMsgs(); }; row.querySelector('[data-pref]').oninput = (e) => { d.payments[i].reference = e.target.value; save(); }; });
    P.querySelector('[data-creason]')?.addEventListener('input', (e) => { d.credit.reason = e.target.value; save(); drawMsgs(); });
    P.querySelector('[data-pmode0]')?.addEventListener('change', (e) => { d.payments[0].mode = e.target.value; save(); });
    P.querySelector('[data-pamt0]')?.addEventListener('input', (e) => { d.payments[0].amount = e.target.value; save(); drawMsgs(); });
    $('[data-modes]').querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { d.payMode = b.dataset.mode; if (d.payMode === 'SPLIT') d.payments = []; save(); drawPay(); drawLab(); drawMsgs(); }; });
    refreshIcons(view);
  }
  function drawMsgs() {
    const v = validateHospitalDraft(d, user);
    $('[data-msgs]').innerHTML = d.lines.length && v.errors.length ? `<div class="msg-err">${icon('alert-circle')}${esc(v.errors[0])}</div>` : v.warnings.length ? `<div class="msg-warn">${icon('info')}${esc(v.warnings[0])}</div>` : '';
    refreshIcons($('[data-msgs]'));
  }
  // ---------------- lab request (hospital multi-source design) ----------------
  function drawLab() {
    d.lab ||= blank().lab;
    const tests = d.lines.filter((l) => l.serviceId && svc(l.serviceId)?.category === 'LAB').map((l) => svc(l.serviceId));
    const cardEl = $('[data-labcard]'); cardEl.classList.toggle('hidden', !tests.length); if (!tests.length) return;
    if (d.lines.some((l) => l.orderIds?.length) && d.lab.source !== 'OP' && !d.lab.touched) d.lab.source = 'OP';
    const L = d.lab; const rd = L.referralDoctorId && store.get('referralDoctors', L.referralDoctorId);
    const rx = tests.filter((t) => t.lab.rxRequired); const cons = tests.filter((t) => t.lab.consentRequired);
    $('[data-lab]').innerHTML = d.payMode === 'EMERGENCY' ? `<div class="alert alert-danger">${icon('siren')}<div><strong>Emergency (STAT).</strong> Samples are collected in casualty and the report goes to the duty doctor first.</div></div>` : `
      <div class="src-pick">${['OP', 'REFERRAL', 'SELF'].map((k) => `<button class="src-opt ${L.source === k ? 'active' : ''}" data-src="${k}">${icon(SOURCE[k].icon)}<strong>${{ OP: 'Hospital doctor', REFERRAL: 'Outside prescription', SELF: 'Self request' }[k]}</strong><small>${{ OP: 'Ordered by our doctor — no prescription needed', REFERRAL: 'Upload or scan the prescription', SELF: 'No prescription — only allowed tests' }[k]}</small></button>`).join('')}</div>
      ${L.source === 'REFERRAL' ? `<div class="form-grid mt-2"><div class="field col-8"><label>Referring doctor <span class="req">*</span></label><div data-rd></div></div><div class="col-4" style="align-self:end"><button class="btn btn-secondary btn-block" data-addrd>${icon('user-plus')}New doctor</button></div>
        <div class="field col-12"><label>Prescription <span class="req">*</span></label>${L.prescription ? `<div class="rx-file">${icon(L.prescription.type.includes('pdf') ? 'file-text' : 'file-image')}<span class="grow"><strong>${esc(L.prescription.name)}</strong><small>${Math.round(L.prescription.size / 1024)} KB · attached</small></span><button class="btn btn-ghost btn-sm" data-rxrm>${icon('x')}</button></div>`
          : `<label class="rx-drop">${icon('upload-cloud')}<span><strong>Upload photo / PDF</strong><small>Phone photo, scanned copy or the image the patient sent on WhatsApp</small></span><input type="file" hidden accept="image/*,application/pdf" capture="environment" data-rx></label>`}</div></div>` : ''}
      ${L.source === 'SELF' && rx.length ? `<div class="alert alert-danger mt-2">${icon('ban')}<div><strong>${esc(rx.map((t) => t.name).join(', '))}</strong> needs a doctor's prescription. Remove it or choose “Outside prescription”.</div></div>` : ''}
      ${L.source === 'SELF' && !rx.length ? `<p class="muted small mt-1">${icon('info', 'ic-inline')} The report will say “Self” as the referrer.</p>` : ''}`;
    $('[data-lab]').innerHTML += `<div class="form-grid mt-2"><div class="field col-6"><label>Priority</label><div class="seg seg-full">${Object.entries(PRIORITY).reverse().map(([k, x]) => `<button class="seg-btn ${(d.payMode === 'EMERGENCY' ? 'STAT' : L.priority) === k ? 'active' : ''}" data-pri="${k}" ${d.payMode === 'EMERGENCY' ? 'disabled' : ''}>${x.label}</button>`).join('')}</div></div>
      <div class="field col-6"><label>Clinical notes</label><input class="input" data-lnotes value="${esc(L.notes || '')}" placeholder="Optional — e.g. fasting 12 h"></div>
      ${cons.length ? `<label class="check col-12 consent"><input type="checkbox" data-consent ${L.consent ? 'checked' : ''}> Signed consent taken for <strong>${esc(cons.map((t) => t.name).join(', '))}</strong> (pre-test counselling done)</label>` : ''}</div>`;
    const H = $('[data-lab]');
    H.querySelectorAll('[data-src]').forEach((b) => { b.onclick = () => { L.source = b.dataset.src; L.touched = true; save(); drawLab(); drawMsgs(); }; });
    H.querySelectorAll('[data-pri]').forEach((b) => { b.onclick = () => { L.priority = b.dataset.pri; save(); drawLab(); }; });
    H.querySelector('[data-lnotes]')?.addEventListener('input', (e) => { L.notes = e.target.value; save(); });
    H.querySelector('[data-consent]')?.addEventListener('change', (e) => { L.consent = e.target.checked; save(); drawMsgs(); });
    H.querySelector('[data-rxrm]')?.addEventListener('click', () => { L.prescription = null; save(); drawLab(); drawMsgs(); });
    H.querySelector('[data-rx]')?.addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 8 * 1048576) return toast('File is larger than 8 MB.', 'error');
      const id = 'RXF-' + Date.now().toString(36).toUpperCase(); await saveBlob(id, f); L.prescription = { id, name: f.name, type: f.type || 'image/jpeg', size: f.size, at: new Date().toISOString(), by: user.id }; save(); drawLab(); drawMsgs(); toast('Prescription attached.'); });
    if (H.querySelector('[data-rd]')) combo(H.querySelector('[data-rd]'), { value: L.referralDoctorId, options: () => store.all('referralDoctors').filter((r) => r.active).map((r) => ({ value: r.id, label: `${r.name}, ${r.qualification}`, sub: r.clinic, keywords: r.phone })), placeholder: 'Search referring doctor…', onChange: (v) => { L.referralDoctorId = v; const r = store.get('referralDoctors', v); d.doctor = `${r.name}, ${r.qualification}`; $('[data-doc]').value = d.doctor; save(); drawMsgs(); } });
    H.querySelector('[data-addrd]')?.addEventListener('click', () => openModal({ title: 'Add referring doctor', size: 'sm', body: `<div class="field"><label>Name</label><input class="input" data-n placeholder="Dr. …"></div><div class="form-grid mt-1"><div class="field col-6"><label>Qualification</label><input class="input" data-q placeholder="M.D (Gen Med)"></div><div class="field col-6"><label>Mobile</label><input class="input" data-ph inputmode="numeric" maxlength="10"></div></div><div class="field mt-1"><label>Clinic / hospital</label><input class="input" data-c></div>`,
      footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', cls: 'btn-primary', onClick: (c, w) => { try { const r = saveReferralDoctor({ name: w.querySelector('[data-n]').value, qualification: w.querySelector('[data-q]').value, phone: w.querySelector('[data-ph]').value, clinic: w.querySelector('[data-c]').value }, user); L.referralDoctorId = r.id; d.doctor = `${r.name}, ${r.qualification}`; $('[data-doc]').value = d.doctor; save(); c(); drawLab(); drawMsgs(); } catch (e) { toast(e.message, 'error'); } } }] }));
    refreshIcons(cardEl);
  }
  const drawAll = () => { drawLines(); drawLab(); drawPay(); drawMsgs(); drawResults(); };

  $('[data-clear]').onclick = async () => { if (d.lines.length && !(await confirmDialog({ title: 'Clear this bill?', message: 'All services on the bill will be removed.', confirmLabel: 'Clear', tone: 'danger' }))) return; d = blank(); save(); pat.set(''); $('[data-doc]').value = ''; drawPatient(); drawAll(); };
  $('[data-complete]').onclick = async () => {
    const v = validateHospitalDraft(d, user);
    if (v.errors.length) { if (v.errors[0].startsWith('Start your shift')) return openStartShift(() => { drawShift(); drawMsgs(); }); return toast(v.errors.join(' '), 'error', 'Bill cannot be completed'); }
    const t = v.totals; const p = patientOf(d.patientId);
    const ok = await confirmDialog({ title: 'Complete bill?', iconName: 'receipt', confirmLabel: 'Complete bill', message: `<strong>${esc(p.name)}</strong> · <span class="mono">${esc(p.uhid)}</span><br>${t.items.length} item(s) · Grand total <strong>${fmtINR(t.grandTotal)}</strong>${t.covered ? `<br><span class="text-purple">${fmtINR(t.covered)} covered by package</span>` : ''}<br>${v.paid ? 'Received ' + fmtINR(v.paid) : ''}${v.due > 0 ? ` <span class="text-warning">· ${d.payMode === 'EMERGENCY' ? 'Emergency' : 'Credit'} ${fmtINR(v.due)}</span>` : ''}${v.warnings.length ? `<ul class="small text-warning mt-1">${v.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}` });
    if (!ok) return;
    try { const b = completeHospitalBill({ ...d, lab: { ...d.lab, priority: d.payMode === 'EMERGENCY' ? 'STAT' : d.lab.priority, prescription: d.lab.source === 'REFERRAL' ? d.lab.prescription : null } }, user); sessionStorage.removeItem(KEY); toast(`Bill ${b.id} saved. Departments can see the services now.`); navigate(`#/hbills/${b.id}/receipt?new=1`); } catch (e) { toast(e.message, 'error'); }
  };

  const unsub = store.subscribe(() => { if (d.discountRequestId) drawLines(); drawShift(); });
  drawShift(); drawPatient(); drawCats(); drawAll();
  return () => unsub();
}
