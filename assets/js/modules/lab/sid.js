// SID page (#/lab/visit/:id) — everything about one patient's lab visit on one screen:
// who the patient is, how far the sample has got (stepper), the ONE next thing to do, every tube with its tests and
// result entry (all tests together, flags as you type), verification, sending the report and the full activity log.
import { store } from '../../data-service.js';
import { currentUser, can } from '../../auth.js';
import { userName } from '../../calculations.js';
import { svc, labParams, flagFor, refText, isCritical, enterResults, verifyReport, hbillBalance } from '../../hospital.js';
import { SOURCE, visit, visitAccess, visitStatus, reportReadyAt, isUncollected, tubesFor, deliverReport, handOver } from '../../labflow.js';
import { CHANNEL_LABEL } from '../../messaging.js';
import { attachmentURL } from '../../attachment-store.js';
import { emptyState, openModal, confirmDialog } from '../../components.js';
import { toast } from '../../notifications.js';
import { barcodeSVG } from '../../barcode.js';
import { setMeta } from '../../app.js';
import { esc, icon, fmtDate, fmtDateTime, refreshIcons } from '../../utils.js';
import { pat, ageSex, initials, liveOrders, liveTubes, srcPill, priPill, statusPill, critPill, cap, tubeInfo, clock, stepper, nextAction, dur, minsSince } from './ui.js';
import { openCollection, rejectTubeDialog, receiveCodes } from './collect.js';

const FLAG = { H: ['High', 'hi'], L: ['Low', 'lo'], HH: ['Critical high', 'crit'], LL: ['Critical low', 'crit'], A: ['Abnormal', 'abn'] };
const flagPill = (f) => (f ? `<span class="lx-flag ${FLAG[f][1]}">${f.length === 2 ? icon('siren') : f === 'H' ? icon('arrow-up') : f === 'L' ? icon('arrow-down') : icon('asterisk')}${FLAG[f][0]}</span>` : '<span class="lx-flag ok">Normal</span>');
const ORDER_STATE = (o) => ({ READY: ['Waiting for sample', 'info'], ON_HOLD: ['Payment pending', 'warning'], SAMPLE_COLLECTED: o.lab.receivedAt ? ['Results to enter', 'purple'] : ['On the way to the lab', 'info'], RESULTED: ['Waiting for verification', 'warning'], COMPLETED: ['Verified', 'success'], CANCELLED: ['Cancelled', 'muted'] }[o.status] || [o.status, 'muted']);

export function renderSid(view, params, query = {}) {
  const user = currentUser(); const v = visit(params.id);
  if (!v) { view.innerHTML = emptyState('flask-conical', 'Lab visit not found', 'Check the SID on the bill.', '<a class="btn btn-primary" href="#/lab">Back to the lab</a>'); return; }
  const p = pat(v.patientId);
  setMeta({ title: `${p.name} — SID ${v.sid}`, crumbs: [{ label: 'Laboratory', href: '#/lab' }, `SID ${v.sid}`] });
  const editing = new Set(); // RESULTED tests the user chose to correct
  const draw = () => {
    const vv = visit(v.id); const nx = nextAction(vv); const ready = reportReadyAt(vv); const anyDone = liveOrders(vv).some((o) => o.status === 'COMPLETED');
    view.innerHTML = `<div class="sid">
      <section class="sid-hero">
        <span class="lx-avatar xl">${esc(initials(p.name))}</span>
        <div class="sid-who"><h1>${esc(p.name)}</h1><div class="sid-facts"><span>${esc(ageSex(p))}</span><span class="mono">${esc(p.uhid)}</span>${p.phone ? `<span>${icon('smartphone')}${esc(p.phone)}</span>` : ''}${p.allergies ? `<span class="danger">${icon('alert-triangle')}Allergy: ${esc(p.allergies)}</span>` : ''}</div>
          <div class="sid-pills">${statusPill(vv)}${srcPill(vv)}${priPill(vv)}${liveOrders(vv).some(isCritical) ? critPill() : ''}${vv.collectionPoint === 'WARD' ? `<span class="lx-pill lx-purple">${icon('bed-double')}${esc(vv.ward)} · ${esc(vv.bed)}</span>` : vv.token ? `<span class="lx-pill lx-neutral">${icon('ticket')}Token ${vv.token}</span>` : ''}</div></div>
        <div class="sid-id"><small>SID</small><strong class="mono">${vv.sid}</strong>${barcodeSVG(vv.sid, { height: 30 })}
          <div class="sid-id-act"><a class="btn btn-ghost btn-sm" href="#/lab/visit/${vv.id}/labels" target="_blank">${icon('tag')}Labels</a>${ready || anyDone ? `<a class="btn btn-secondary btn-sm" href="#/lab/visit/${vv.id}/report">${icon('file-text')}${ready ? 'Report' : 'Partial report'}</a>` : ''}</div></div>
      </section>
      <section class="sid-track">${stepper(vv)}</section>
      <section class="sid-next tone-${nx.tone}"><span class="sid-next-ic">${icon(nx.icon)}</span><div><small>Next step</small><strong>${esc(nx.title)}</strong><p>${esc(nx.text)}</p></div>
        ${nx.btn && canDo(nx.key) ? `<button class="btn ${nx.key === 'send' ? 'btn-wa' : 'btn-primary'} btn-lg" data-next="${nx.key}">${icon(nx.key === 'send' ? 'message-circle' : nx.icon)}${esc(nx.key === 'send' ? 'Send on WhatsApp' : nx.btn)}</button>` : nx.key === 'hold' && vv.billId ? `<a class="btn btn-secondary" href="#/hbills/${vv.billId}">${icon('receipt')}Open bill</a>` : ''}</section>
      <div class="sid-grid"><div class="sid-main">
        <section class="sid-card"><header class="sid-card-head"><h2>${icon('flask-conical')}Tests &amp; results</h2><div class="sid-legend"><span class="lx-flag hi">${icon('arrow-up')}High</span><span class="lx-flag lo">${icon('arrow-down')}Low</span><span class="lx-flag crit">${icon('siren')}Critical</span></div></header>
          ${tubesFor(vv).filter((t) => t.orders.some((o) => o.status !== 'CANCELLED')).map((t) => tubeBlock(vv, t)).join('')}
          <div class="sid-bar" data-bar></div></section>
      </div><aside class="sid-side">
        ${ready && vv.source !== 'IP' ? sendCard(vv) : ''}
        ${detailsCard(vv)}
        ${activityCard(vv)}
      </aside></div></div>`;
    wire(); refreshIcons(view);
  };
  const canDo = (k) => ({ collect: can('lab.work'), receive: can('lab.work'), results: can('lab.work'), verify: can('lab.verify'), send: can('lab.deliver') }[k] ?? false);

  // ----- one tube with its tests -----
  const tubeBlock = (vv, t) => { const ti = tubeInfo(t.container);
    const state = t.receivedAt ? `<span class="sid-tstate ok">${icon('check-circle-2')}In lab since ${clock(t.receivedAt)}</span>` : t.collectedAt ? `<span class="sid-tstate info">${icon('truck')}Collected ${clock(t.collectedAt)} · on the way</span>` : t.rejected ? `<span class="sid-tstate danger">${icon('rotate-ccw')}Rejected — ${esc(t.rejected.reason)}. Collect again.</span>` : `<span class="sid-tstate muted">${icon('hourglass')}Not collected yet</span>`;
    const acts = can('lab.work') && t.collectedAt && !t.receivedAt ? `<button class="btn btn-ghost btn-sm lx-danger-text" data-reject="${t.code}">Reject</button><button class="btn btn-secondary btn-sm" data-receive="${t.code}">${icon('check')}Receive</button>`
      : can('lab.work') && t.receivedAt && t.orders.some((o) => ['SAMPLE_COLLECTED', 'RESULTED'].includes(o.status)) ? `<button class="btn btn-ghost btn-sm lx-danger-text" data-reject="${t.code}">Reject sample</button>` : '';
    return `<div class="sid-tube"><div class="sid-tube-head">${cap(t.container)}<div><strong>${esc(ti.name)}</strong><span class="mono">${t.code}</span></div>${state}<span class="grow"></span>${acts}</div>
      ${t.orders.filter((o) => o.status !== 'CANCELLED').map((o) => testBlock(vv, t, o)).join('')}</div>`;
  };
  const prevOf = (o) => store.all('orders').filter((x) => x.serviceId === o.serviceId && x.patientId === o.patientId && x.id !== o.id && x.status === 'COMPLETED').sort((x, y) => y.lab.verifiedAt.localeCompare(x.lab.verifiedAt))[0];
  const testBlock = (vv, t, o) => {
    const [sl, st] = ORDER_STATE(o); const ps = labParams(o); const vals = Object.fromEntries((o.lab.results || []).map((r) => [r.param, r.value]));
    const input = can('lab.work') && o.lab.receivedAt && (o.status === 'SAMPLE_COLLECTED' || (o.status === 'RESULTED' && editing.has(o.id)));
    const show = input || ['RESULTED', 'COMPLETED'].includes(o.status);
    const prev = show ? prevOf(o) : null; const pv = (n) => prev?.lab.results.find((r) => r.param === n)?.value;
    return `<div class="sid-test ${isCritical(o) ? 'crit' : ''}" data-test="${o.id}"><div class="sid-test-head"><strong>${esc(o.name)}</strong><span class="lx-status lx-st-${st}"><i></i>${sl}</span>${o.lab.reportNo ? `<span class="mono muted small">${o.lab.reportNo}</span>` : ''}<span class="grow"></span>
        ${o.status === 'RESULTED' && !editing.has(o.id) && can('lab.work') ? `<button class="btn btn-ghost btn-sm" data-edit="${o.id}">${icon('pencil')}Correct</button>` : ''}
        ${o.status === 'RESULTED' && can('lab.verify') && !editing.has(o.id) ? `<button class="btn btn-secondary btn-sm" data-verify-one="${o.id}">${icon('badge-check')}Verify</button>` : ''}</div>
      ${show ? `<table class="sid-res"><thead><tr><th>Test</th><th class="w-res">Result</th><th>Unit</th><th>Normal range</th><th>Flag</th>${prev ? `<th class="muted">Last time · ${fmtDate(prev.lab.verifiedAt)}</th>` : ''}</tr></thead><tbody>
        ${ps.map((q) => { const f = flagFor(q, vals[q.name]); const qual = q.ref !== undefined; const dl = `dl-${o.id}-${q.name.replace(/\W/g, '')}`;
          return `<tr class="${f ? 'f-' + FLAG[f][1] : ''}" data-row="${esc(q.name)}"><td>${esc(q.name)}</td>
          <td>${input ? `<input class="sid-in" data-oid="${o.id}" data-p="${esc(q.name)}" value="${esc(vals[q.name] ?? '')}" ${qual ? `list="${dl}" placeholder="${esc(q.ref)}"` : 'inputmode="decimal" placeholder="—"'} autocomplete="off">${qual ? `<datalist id="${dl}"><option value="${esc(q.ref)}">${['Positive', 'Reactive', 'Present', 'Nil', 'Absent', 'Non-reactive', 'Negative'].filter((x) => x !== q.ref).map((x) => `<option value="${x}">`).join('')}</datalist>` : ''}` : `<strong class="sid-val">${esc(vals[q.name] ?? '—')}</strong>`}</td>
          <td class="muted">${esc(q.unit || '')}</td><td class="muted">${esc(refText(q))}${q.critLow != null || q.critHigh != null ? `<small class="sid-crit-lim">critical ${q.critLow != null ? '&lt; ' + q.critLow : ''}${q.critLow != null && q.critHigh != null ? ' / ' : ''}${q.critHigh != null ? '&gt; ' + q.critHigh : ''}</small>` : ''}</td>
          <td data-flag>${vals[q.name] != null && vals[q.name] !== '' ? flagPill(f) : ''}</td>${prev ? `<td class="muted">${esc(pv(q.name) ?? '—')}</td>` : ''}</tr>`; }).join('')}</tbody></table>
        ${o.lab.enteredBy ? `<p class="sid-test-foot">Entered by ${esc(userName(o.lab.enteredBy))} · ${fmtDateTime(o.lab.enteredAt)}${o.lab.verifiedBy ? ` &nbsp;·&nbsp; Verified by ${esc(userName(o.lab.verifiedBy))} · ${fmtDateTime(o.lab.verifiedAt)}` : ''}</p>` : ''}`
        : `<p class="sid-test-wait">${o.status === 'SAMPLE_COLLECTED' ? 'Receive the tube in the lab to enter results.' : o.status === 'READY' ? 'Collect the sample first.' : 'Waiting for payment.'}</p>`}</div>`;
  };

  // ----- bottom bar: save / verify -----
  const drawBar = () => {
    const vv = visit(v.id); const inputs = [...view.querySelectorAll('.sid-in')]; const toVerify = liveOrders(vv).filter((o) => o.status === 'RESULTED' && !editing.has(o.id));
    const filled = inputs.filter((i) => i.value.trim()).length;
    const bar = view.querySelector('[data-bar]');
    if (!inputs.length && !(toVerify.length && can('lab.verify'))) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = `<div class="sid-bar-info">${inputs.length ? `<div class="lc-bar"><i style="width:${(filled / inputs.length) * 100}%"></i></div><span><b>${filled}</b> of ${inputs.length} values typed</span><kbd>Enter</kbd><span class="muted">next box</span><kbd>Ctrl S</kbd><span class="muted">save</span>` : `<span>${icon('badge-check')}<b>${toVerify.length}</b> test${toVerify.length > 1 ? 's' : ''} waiting for verification</span>`}</div>
      <div class="sid-bar-act">${inputs.length ? `<button class="btn btn-primary" data-save>${icon('save')}Save results</button>` : ''}${toVerify.length && can('lab.verify') && !inputs.length ? `<button class="btn btn-primary" data-verify-all>${icon('badge-check')}Verify &amp; release ${toVerify.length > 1 ? `all ${toVerify.length}` : ''}</button>` : ''}</div>`;
    bar.querySelector('[data-save]')?.addEventListener('click', save);
    bar.querySelector('[data-verify-all]')?.addEventListener('click', () => verify(toVerify.map((o) => o.id)));
    refreshIcons(bar);
  };
  const save = () => {
    const by = {}; view.querySelectorAll('.sid-in').forEach((i) => { (by[i.dataset.oid] ||= {})[i.dataset.p] = i.value.trim(); });
    const todo = []; const half = [];
    Object.entries(by).forEach(([oid, vals]) => { const n = Object.values(vals).filter(Boolean).length; if (!n) return; if (n < Object.keys(vals).length) half.push(store.get('orders', oid)); else todo.push([oid, vals]); });
    if (half.length) { const o = half[0]; const first = view.querySelector(`.sid-in[data-oid="${o.id}"]:placeholder-shown`) || [...view.querySelectorAll(`.sid-in[data-oid="${o.id}"]`)].find((i) => !i.value.trim()); toast(`${o.name}: fill every value before saving (or clear it to save the others).`, 'error'); first?.focus(); return; }
    if (!todo.length) { toast('Type at least one complete test.', 'error'); view.querySelector('.sid-in')?.focus(); return; }
    try {
      todo.forEach(([oid, vals]) => { enterResults(oid, vals, user); editing.delete(oid); });
      const crit = todo.some(([oid]) => isCritical(store.get('orders', oid)));
      toast(crit ? 'Saved. CRITICAL value — the doctor and owner have been alerted.' : `Results saved for ${todo.length} test${todo.length > 1 ? 's' : ''}. Next: verify.`, crit ? 'warning' : 'success');
      draw();
    } catch (e) { toast(e.message, 'error'); }
  };
  const verify = async (ids) => {
    const os = ids.map((id) => store.get('orders', id)); const crit = os.filter(isCritical);
    const ok = await confirmDialog({ title: os.length > 1 ? `Verify ${os.length} tests and release?` : `Verify ${os[0].name}?`, iconName: 'badge-check', confirmLabel: 'Verify & release',
      message: `<strong>${os.map((o) => esc(o.name)).join(', ')}</strong><br>Once verified the result is final, gets a report number and goes to the patient's history.${crit.length ? `<div class="lx-note danger mt-1">${icon('siren')}Critical value in ${crit.map((o) => esc(o.name)).join(', ')} — phone the doctor after release.</div>` : ''}` });
    if (!ok) return;
    try { os.forEach((o) => verifyReport(o.id, user)); toast(reportReadyAt(visit(v.id)) ? (visit(v.id).source === 'IP' ? 'Report released and posted to the ward.' : 'Report released — ready to send to the patient.') : 'Verified.', 'success'); draw(); }
    catch (e) { toast(e.message, 'error'); draw(); }
  };

  // ----- send -----
  const send = async (ch) => {
    const vv = visit(v.id);
    if (ch === 'COUNTER') return handOverDialog(vv, draw);
    if (ch === 'PRINT') { location.hash = `#/lab/visit/${vv.id}/report`; return; }
    try { const out = deliverReport(vv.id, ch === 'DOCTOR' ? 'WHATSAPP' : ch, { toDoctor: ch === 'DOCTOR' }, user);
      if (out.url) { window.open(out.url, '_blank'); toast(ch === 'EMAIL' ? 'Mail opened — attach the PDF (Report → Save as PDF) and send.' : ch === 'SMS' ? 'SMS app opened — press Send.' : 'WhatsApp opened with the message — press Send.', 'info'); }
      else toast('Queued — the hospital server sends it with the PDF.', 'success');
      draw();
    } catch (e) { toast(e.message, 'error'); }
  };

  const wire = () => {
    view.querySelector('[data-next]')?.addEventListener('click', () => {
      const k = view.querySelector('[data-next]').dataset.next; const vv = visit(v.id);
      if (k === 'collect') openCollection(vv.id, draw);
      else if (k === 'receive') { receiveCodes(liveTubes(vv).filter((t) => t.collectedAt && !t.receivedAt).map((t) => t.code)); draw(); }
      else if (k === 'results') focusFirst();
      else if (k === 'verify') verify(liveOrders(vv).filter((o) => o.status === 'RESULTED').map((o) => o.id));
      else if (k === 'send') send('WHATSAPP');
    });
    view.querySelectorAll('[data-receive]').forEach((b) => { b.onclick = () => { receiveCodes([b.dataset.receive]); draw(); }; });
    view.querySelectorAll('[data-reject]').forEach((b) => { b.onclick = async () => { if (await rejectTubeDialog(b.dataset.reject)) draw(); }; });
    view.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { editing.add(b.dataset.edit); draw(); view.querySelector(`.sid-in[data-oid="${b.dataset.edit}"]`)?.focus(); }; });
    view.querySelectorAll('[data-verify-one]').forEach((b) => { b.onclick = () => verify([b.dataset.verifyOne]); });
    view.querySelectorAll('[data-send]').forEach((b) => { b.onclick = () => send(b.dataset.send); });
    view.querySelector('[data-rx]')?.addEventListener('click', async () => { const vv = visit(v.id); const url = vv.prescription.demo ? null : await attachmentURL(vv.prescription).catch(() => null); if (url) window.open(url, '_blank'); else toast('Sample record — an uploaded prescription opens here.', 'info'); });
    const ins = [...view.querySelectorAll('.sid-in')];
    ins.forEach((i, k) => {
      i.addEventListener('input', () => { const o = store.get('orders', i.dataset.oid); const q = labParams(o).find((x) => x.name === i.dataset.p); const f = flagFor(q, i.value); const tr = i.closest('tr');
        tr.className = f ? 'f-' + FLAG[f][1] : ''; tr.querySelector('[data-flag]').innerHTML = i.value.trim() ? flagPill(f) : ''; refreshIcons(tr); drawBar(); });
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const n = ins[k + 1]; if (n) { n.focus(); n.select(); } else view.querySelector('[data-save]')?.focus(); } });
    });
    drawBar();
  };
  const focusFirst = () => { const i = [...view.querySelectorAll('.sid-in')].find((x) => !x.value.trim()) || view.querySelector('.sid-in'); if (i) { i.scrollIntoView({ block: 'center', behavior: 'smooth' }); i.focus(); } };
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && view.querySelector('[data-save]')) { e.preventDefault(); save(); } };
  document.addEventListener('keydown', onKey);
  draw();
  if (query.step === 'results') setTimeout(focusFirst, 80);
  if (query.step === 'verify' || query.step === 'send') setTimeout(() => view.querySelector(query.step === 'send' ? '.sid-send' : '.sid-bar')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
  const dirty = () => [...view.querySelectorAll('.sid-in')].some((i) => i.value !== i.defaultValue);
  const unsub = store.subscribe(() => { if (!dirty() && !document.querySelector('.modal-backdrop')) draw(); });
  return () => { document.removeEventListener('keydown', onKey); unsub(); };
}

function sendCard(v) {
  const p = pat(v.patientId); const rd = v.referralDoctorId && store.get('referralDoctors', v.referralDoctorId); const b = v.billId && store.get('hbills', v.billId); const due = b ? hbillBalance(b) : 0;
  const sent = (ch, dr = false) => v.deliveries.some((d) => d.channel === ch && !!d.toDoctor === dr);
  const dis = can('lab.deliver') ? '' : 'disabled';
  const opt = (k, ic, label, sub, on = true, done = false) => `<button class="sid-send-opt" data-send="${k}" ${on ? dis : 'disabled'}>${icon(ic)}<span><strong>${label}</strong><small>${esc(sub)}</small></span>${done ? `<em>${icon('check')}Sent</em>` : ''}</button>`;
  return `<section class="sid-card sid-send"><header class="sid-card-head"><h2>${icon('send')}Send the report</h2>${isUncollected(v) ? '<span class="lx-pill lx-danger">Not collected</span>' : ''}</header>
    <button class="btn btn-wa btn-block btn-lg" data-send="WHATSAPP" ${p.phone ? dis : 'disabled'}>${icon('message-circle')}WhatsApp to ${esc(p.phone || '—')}${sent('WHATSAPP') ? ' · again' : ''}</button>
    <div class="sid-send-list">
      ${opt('PRINT', 'printer', 'Print / save PDF', 'Open the report')}
      ${opt('COUNTER', 'hand', v.handover ? `Handed to ${v.handover.name}` : 'Hand over at counter', due > 0 ? `₹${due} still due on the bill` : 'Patient or attender collects it', !v.handover, !!v.handover)}
      ${opt('SMS', 'smartphone', 'SMS', p.phone || 'No mobile', !!p.phone, sent('SMS'))}
      ${opt('EMAIL', 'mail', 'Email', p.email || 'No email on record', !!p.email, sent('EMAIL'))}
      ${rd ? opt('DOCTOR', 'stethoscope', 'Referring doctor', `${rd.name}${rd.phone ? '' : ' · no mobile'}`, !!rd.phone, sent('WHATSAPP', true)) : ''}</div>
    <p class="sid-hint">${store.hs().messaging.provider === 'WA_CLOUD' && store.hs().messaging.cloud.enabled ? 'Automatic: the hospital server sends the PDF on WhatsApp.' : 'WhatsApp opens with the number and message ready — press Send. Automatic sending with the PDF starts when the hospital server is set up.'}</p></section>`;
}

function detailsCard(v) {
  const a = visitAccess(v); const b = v.billId && store.get('hbills', v.billId); const rd = v.referralDoctorId && store.get('referralDoctors', v.referralDoctorId);
  const row = (k, val) => (val ? `<div class="sid-kv"><span>${k}</span><span>${val}</span></div>` : '');
  return `<section class="sid-card"><header class="sid-card-head"><h2>${icon('info')}Details</h2></header><div class="sid-kvs">
    ${row('Came as', esc(SOURCE[v.source].label))}${row('Doctor', esc(v.doctor || 'Self'))}${rd ? row('Clinic', esc(rd.clinic)) : ''}${v.ipNo ? row('IP number', esc(v.ipNo)) : ''}
    ${row('Payment', `<span class="lx-pill lx-${a.tone === 'success' ? 'success' : a.tone}">${esc(a.label)}</span>`)}${b ? row('Bill', `<a class="mono" href="#/hbills/${b.id}">${b.id}</a>`) : v.billingRoute === 'IP_ACCOUNT' ? row('Charges', `On IP account ${esc(v.ipNo)}`) : ''}
    ${row('Prescription', v.prescription ? `<button class="btn btn-ghost btn-sm" data-rx>${icon('file-image')}View</button>` : esc({ DOCTOR_ORDER: 'Doctor order', SELF_REQUEST: 'Not needed (self request)', PACKAGE: 'Package' }[v.rxBasis] || '—'))}
    ${v.consent ? row('Consent', '<span class="lx-pill lx-success">Signed</span>') : ''}${row('Report due', fmtDateTime(v.reportDueAt))}${v.clinicalNotes ? row('Notes', esc(v.clinicalNotes)) : ''}
    <div class="sid-kv"><span>Patient file</span><a href="#/patients/${v.patientId}">Open profile ${icon('arrow-up-right')}</a></div></div></section>`;
}

function activityCard(v) {
  const ev = [{ at: v.createdAt, ic: 'receipt', t: v.billingRoute === 'IP_ACCOUNT' ? 'Ordered from the ward' : 'Billed at the counter', by: v.createdBy }];
  if (v.calledAt) ev.push({ at: v.calledAt, ic: 'megaphone', t: `Token ${v.token} called`, by: v.calledBy });
  v.tubes.forEach((t) => { if (t.rejected) ev.push({ at: t.rejected.at, ic: 'rotate-ccw', t: `${t.code} rejected — ${t.rejected.reason}`, by: t.rejected.by, tone: 'danger' }); if (t.collectedAt) ev.push({ at: t.collectedAt, ic: 'test-tube', t: `${t.code} collected`, by: t.collectedBy }); if (t.receivedAt) ev.push({ at: t.receivedAt, ic: 'scan-barcode', t: `${t.code} received in lab`, by: t.receivedBy }); });
  liveOrders(v).forEach((o) => { if (o.lab.enteredAt) ev.push({ at: o.lab.enteredAt, ic: 'keyboard', t: `${svc(o.serviceId)?.code || o.name} results entered`, by: o.lab.enteredBy }); if (o.lab.verifiedAt) ev.push({ at: o.lab.verifiedAt, ic: 'badge-check', t: `${svc(o.serviceId)?.code || o.name} verified`, by: o.lab.verifiedBy, tone: 'success' }); });
  v.deliveries.forEach((d) => ev.push({ at: d.at, ic: d.channel === 'WHATSAPP' ? 'message-circle' : d.channel === 'COUNTER' ? 'hand' : d.channel === 'WARD' ? 'bed-double' : d.channel === 'EMAIL' ? 'mail' : 'smartphone', t: `${CHANNEL_LABEL[d.channel] || d.channel}${d.toDoctor ? ' to doctor' : ''} — ${d.to}`, by: d.by, tone: 'success' }));
  ev.sort((a, b) => b.at.localeCompare(a.at));
  const total = reportReadyAt(v) ? dur(minsSince(v.createdAt, reportReadyAt(v))) : '';
  return `<section class="sid-card"><header class="sid-card-head"><h2>${icon('history')}Activity</h2>${total ? `<span class="muted small">Bill → report ${total}</span>` : ''}</header>
    <ol class="sid-tl">${ev.map((e) => `<li class="${e.tone || ''}"><span>${icon(e.ic)}</span><div><strong>${esc(e.t)}</strong><small>${fmtDateTime(e.at)}${e.by ? ' · ' + esc(userName(e.by)) : ''}</small></div></li>`).join('')}</ol></section>`;
}

function handOverDialog(v, done) {
  openModal({ title: 'Hand over the printed report', subtitle: `SID ${v.sid}`, size: 'sm',
    body: `<div class="field"><label>Who is collecting?</label><div class="seg seg-full" data-who>${['Self', 'Attender / family', 'Doctor’s staff'].map((x, i) => `<button type="button" class="seg-btn ${i ? '' : 'active'}" data-v="${x}">${x}</button>`).join('')}</div></div>
      <div class="field mt-1"><label>Name <span class="req">*</span></label><input class="input" data-n value="${esc(pat(v.patientId).name)}"></div><p class="muted small mt-1">Match the SID on the patient's bill before handing over.</p>`,
    onOpen: (w) => w.querySelectorAll('[data-who] [data-v]').forEach((b) => { b.onclick = () => { w.querySelectorAll('[data-who] [data-v]').forEach((x) => x.classList.toggle('active', x === b)); const n = w.querySelector('[data-n]'); n.value = b.dataset.v === 'Self' ? pat(v.patientId).name : ''; n.focus(); }; }),
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Hand over & print', cls: 'btn-primary', icon: 'printer', onClick: (c, w) => { try { handOver(v.id, { collectedBy: w.querySelector('[data-who] .active').dataset.v, name: w.querySelector('[data-n]').value }, currentUser()); c(); toast('Handed over.'); location.hash = `#/lab/visit/${v.id}/report`; } catch (e) { toast(e.message, 'error'); } } }] });
}

/** Old single-test links (#/lab/orders/:id) open the patient's SID page at that test. */
export function renderOrderRedirect(view, params) {
  const o = store.get('orders', params.id);
  if (o?.labVisitId) { location.replace(`#/lab/visit/${o.labVisitId}?step=${o.status === 'RESULTED' ? 'verify' : 'results'}`); return; }
  view.innerHTML = emptyState('flask-conical', 'Lab test not found');
}
