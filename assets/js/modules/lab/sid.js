// Patient screen for one lab visit (SID), in the hospital-software layout. Used in two places with the same look:
//  • the Lab Worklist, after clicking a row (mountSid)
//  • the full page #/lab/visit/:id (renderSid)
// Patient banner on top; the main box holds the tubes (while collecting / receiving), the result grid and sending,
// with ONE action bar at the bottom; a narrow side panel holds the sample tubes, visit facts and less-used links.
// Progress and the activity log open in a side drawer.
import { store } from '../../data-service.js';
import { currentUser, can } from '../../auth.js';
import { userName } from '../../calculations.js';
import { svc, labParams, flagFor, refText, isCritical, enterResults, verifyReport, hbillBalance, criticalCallOk, criticalText, logCriticalCall, amendReport, CALL_OUTCOME, verifyBlock, verifyState } from '../../hospital.js';
import { canSign, signatoryText, isConfidential, canSeeConfidential } from '../../labrules.js';
import { SOURCE, visit, visitAccess, visitStatus, reportReadyAt, isUncollected, tubesFor, deliverReport, handOver, collectTube, callToken, wardWaPending, visitConfidential, lastAmendAt, staleDeliveries, setPregnant, asksPregnancy } from '../../labflow.js';
import { CHANNEL_LABEL } from '../../messaging.js';
import { attachmentURL } from '../../attachment-store.js';
import { openModal, confirmDialog } from '../../components.js';
import { toast } from '../../notifications.js';
import { setMeta } from '../../app.js';
import { esc, fmtDate, fmtDateTime } from '../../utils.js';
import { icon, emptyState } from './bi.js';
import { pat, ageSex, liveOrders, liveTubes, statusPill, ptypeTag, cap, tubeInfo, clock, journey, nextAction, dur, minsSince, openDrawer } from './ui.js';
import { rejectTubeDialog, receiveCodes } from './collect.js';

const FLAG = { H: ['High', 'hi', 'arrow-up'], L: ['Low', 'lo', 'arrow-down'], HH: ['Critical high', 'crit', 'siren'], LL: ['Critical low', 'crit', 'siren'], A: ['Abnormal', 'abn', 'asterisk'] };
const flagTxt = (f) => (f ? `<span class="h-flag ${FLAG[f][1]}">${FLAG[f][0]}</span>` : '<span class="h-flag ok">Normal</span>');
const ORDER_STATE = (o) => ({ READY: ['Waiting for sample', 'info'], ON_HOLD: ['Payment pending', 'warning'], SAMPLE_COLLECTED: o.lab.receivedAt ? ['Results to enter', 'purple'] : ['On the way to the lab', 'info'], RESULTED: ['Waiting for verification', 'warning'], COMPLETED: ['Verified', 'success'], CANCELLED: ['Cancelled', 'muted'] }[o.status] || [o.status, 'muted']);
const prevOf = (o) => store.all('orders').filter((x) => x.serviceId === o.serviceId && x.patientId === o.patientId && x.id !== o.id && x.status === 'COMPLETED').sort((x, y) => y.lab.verifiedAt.localeCompare(x.lab.verifiedAt))[0];

export function renderSid(view, params, query = {}) {
  const v = visit(params.id);
  if (!v) { view.innerHTML = emptyState('flask-conical', 'Lab visit not found', 'Check the SID on the bill.', '<a class="btn btn-primary" href="#/lab">Back to the worklist</a>'); return; }
  const p = pat(v.patientId);
  setMeta({ title: `${p.name} — SID ${v.sid}`, crumbs: [{ label: 'Laboratory', href: '#/lab' }, `SID ${v.sid}`] });
  view.innerHTML = `<div class="h-lab h-ptview"><div class="h-ptnav"><a class="btn btn-secondary" href="#/lab">${icon('arrow-left')}Worklist</a></div><div data-host class="h-pthost"></div></div>`;
  return mountSid(view.querySelector('[data-host]'), v.id, { step: query.step }).cleanup;
}

/** Draws one visit into `host` and keeps it live. Returns { cleanup, focusFirst, redraw }. */
export function mountSid(host, id, { step } = {}) {
  const user = currentUser();
  let alive = true; // false once this patient is closed — it must not draw any more
  const editing = new Set(); // RESULTED tests the user chose to correct, or COMPLETED tests being amended
  const canDo = (k) => ({ collect: can('lab.work'), receive: can('lab.work'), results: can('lab.work'), verify: canSign(user), send: can('lab.deliver') }[k] ?? false);
  const seeConf = canSeeConfidential(user);

  const draw = () => {
    if (!alive) return;
    const vv = visit(id); if (!vv) { host.innerHTML = emptyState('flask-conical', 'Lab visit not found'); return; }
    const p = pat(vv.patientId); const ready = reportReadyAt(vv); const os = liveOrders(vv); const a = visitAccess(vv);
    const anyDone = os.some((o) => o.status === 'COMPLETED'); const crit = os.some(isCritical);
    const tubes = tubesFor(vv).filter((t) => t.orders.some((o) => o.status !== 'CANCELLED'));
    const allIn = tubes.length && tubes.every((t) => t.receivedAt);
    const showResults = os.some((o) => o.lab.receivedAt || ['RESULTED', 'COMPLETED'].includes(o.status));
    const where = vv.collectionPoint === 'WARD' ? ['Ward / bed', `${esc(vv.bed || '—')} <small>${esc(vv.ward || '')}</small>`] : vv.collectionPoint === 'CASUALTY' ? ['Point', 'Casualty'] : ['Token', `${vv.token ?? '—'}${vv.tokenStatus === 'CALLED' ? ' <small>called</small>' : ''}`];
    const waited = ready ? ['Turnaround', dur(minsSince(vv.createdAt, ready))] : ['Waiting', dur(minsSince(vv.createdAt))];
    const critParams = os.filter(isCritical).flatMap((o) => (o.lab.results || []).filter((r) => { const q = labParams(o).find((x) => x.name === r.param); return q && ['LL', 'HH'].includes(flagFor(q, r.value)); }).map((r) => `${esc(r.param)} ${esc(r.value)}`));
    const redo = tubes.find((t) => t.rejected && !t.collectedAt);
    const pri = vv.priority === 'STAT' ? '<span class="h-stat">STAT</span>' : vv.priority === 'URGENT' ? '<span class="h-urg">Urgent</span>' : 'Routine';

    host.innerHTML = `<div class="h-banner">
        <div class="h-bn-name"><b>${esc(p.name)}</b><small>${esc(ageSex(p))} · UHID <span class="mono">${esc(p.uhid)}</span></small></div>
        <div><label>SID</label><span class="mono">${vv.sid}</span></div>
        <div><label>${where[0]}</label><span>${where[1]}</span></div>
        <div><label>Patient type</label><span>${ptypeTag(vv)}</span></div>
        <div class="h-bn-doc"><label>Referred by</label><span title="${esc(vv.doctor || 'Self request')}">${esc(vv.doctor || 'Self request')}</span></div>
        <div><label>${waited[0]}</label><span class="${!ready && minsSince(vv.createdAt) > 120 ? 'h-late' : ''}">${waited[1]}</span></div>
        <div><label>Priority</label><span>${pri}</span></div>
        <div class="h-bn-flags">${p.allergies ? `<span class="h-alert red">${icon('exclamation-triangle-fill')}Allergy: ${esc(p.allergies)}</span>` : ''}${crit ? `<span class="h-alert red">${icon('exclamation-diamond-fill')}Critical value</span>` : ''}${statusPill(vv)}</div>
      </div>
      <div class="h-ptbody">
        <section class="h-box h-main"><div class="h-scroll" data-scroll>
          ${!a.ok && visitStatus(vv) !== 'CANCELLED' ? `<div class="h-msg amber">${icon('lock-fill')}<div class="h-grow"><b>Waiting for payment.</b> ${esc(a.label)}. Do not collect the sample — send the patient to the main counter.</div>${vv.billId ? `<a class="btn btn-secondary btn-sm" href="#/hbills/${vv.billId}">${icon('receipt')}Open bill</a>` : ''}</div>` : ''}
          ${redo ? `<div class="h-msg amber">${icon('arrow-counterclockwise')}<div><b>Collect a fresh sample.</b> The earlier one was rejected: ${esc(redo.rejected.reason)}.</div></div>` : ''}
          ${crit ? critBox(vv) : ''}
          ${lastAmendAt(vv) ? `<div class="h-msg amber">${icon('pencil-square')}<div><b>Amended report.</b> A released result was corrected on ${fmtDateTime(lastAmendAt(vv))}. The report prints “AMENDED”; the earlier values stay in <a href="#" data-drawer="changes">Changes</a>.</div></div>` : ''}
          ${tubes.length && !(allIn && showResults) ? tubeSection(vv, tubes, a) : ''}
          ${showResults ? resultsSection(vv) : ''}
          ${ready ? sendSection(vv) : ''}
          ${!tubes.length && !showResults ? `<div class="h-empty">${icon('hourglass')}<b>Nothing to do here yet.</b></div>` : ''}
        </div><footer class="h-act" data-bar></footer></section>
        <aside class="h-side">
          <div class="h-box"><h3>Sample</h3>${tubes.map((t) => `<div class="h-tube">${cap(t.container)}<div class="h-grow"><span>${esc(tubeInfo(t.container).name)}</span><small class="mono">${t.code}</small></div>${t.receivedAt ? `<span class="h-ok">${icon('check-circle-fill')} In lab</span>` : t.collectedAt ? '<span class="h-info">Collected</span>' : t.rejected ? '<span class="danger">Rejected</span>' : '<span class="h-muted">Not collected</span>'}${allIn && showResults && can('lab.work') && t.orders.some((o) => ['SAMPLE_COLLECTED', 'RESULTED'].includes(o.status)) ? `<button class="h-link danger" data-reject="${t.code}" title="Reject this sample">Reject</button>` : ''}</div>`).join('') || '<p class="h-pad h-muted">No tubes.</p>'}</div>
          <div class="h-box"><h3>Visit</h3>${visitKv(vv)}</div>
          <div class="h-box h-links"><h3>More</h3>
            <a href="#/lab/visit/${vv.id}/labels" target="_blank">${icon('upc')}Reprint labels</a>
            ${ready || anyDone ? `<a href="#/lab/visit/${vv.id}/report">${icon('file-earmark-text')}${ready ? 'Report' : 'Partial report'}</a>` : ''}
            <a href="#" data-drawer="journey">${icon('signpost-2')}Progress</a>
            <a href="#" data-drawer="activity">${icon('clock-history')}Activity log</a>
            <a href="#/patients/${vv.patientId}">${icon('person-vcard')}Patient file</a></div>
        </aside>
      </div>`;
    wire();
  };

  // ----- visit facts (side panel) -----
  const visitKv = (v) => {
    const p = pat(v.patientId); const a = visitAccess(v); const b = v.billId && store.get('hbills', v.billId); const rd = v.referralDoctorId && store.get('referralDoctors', v.referralDoctorId);
    const row = (k, val) => (val ? `<dt>${k}</dt><dd>${val}</dd>` : '');
    return `<dl class="h-kv">${row('Mobile', esc(p.phone || '—'))}${row('Payment', `<span class="${a.ok ? 'h-ok' : 'h-warn'}">${esc(a.label)}</span>`)}
      ${b ? row('Bill', `<a class="mono" href="#/hbills/${b.id}">${b.id}</a>`) : v.billingRoute === 'OP_BILL' ? row('Bill', `OP bill <a class="mono" href="#/op/visits/${v.opVisitId}">${esc(v.opBillId)}</a>`) : v.billingRoute === 'IP_ACCOUNT' ? row('Charges', v.admissionId ? `IP bill <a class="mono" href="#/ip/admissions/${v.admissionId}">${esc(v.ipNo)}</a>` : `IP account ${esc(v.ipNo || '')}`) : ''}
      ${rd ? row('Clinic', esc(rd.clinic)) : ''}${row('Report due', fmtDateTime(v.reportDueAt))}
      ${row('Prescription', v.prescription ? '<button class="h-link" data-rx>View</button>' : esc({ DOCTOR_ORDER: 'Doctor order', SELF_REQUEST: 'Self request', PACKAGE: 'Package' }[v.rxBasis] || '—'))}
      ${v.consent ? row('Consent', `<span class="h-ok">Signed</span>${v.consent.counsellor ? `<small class="h-muted"> · counselled by ${esc(v.consent.counsellor)}</small>` : ''}`) : ''}${v.clinicalNotes ? row('Notes', esc(v.clinicalNotes)) : ''}
      ${asksPregnancy(v) ? row('Pregnant', liveOrders(v).every((o) => o.status === 'COMPLETED') || !can('lab.work') ? esc(v.pregnant === true ? 'Yes' : v.pregnant === false ? 'No' : 'Not known') : `<span class="h-seg">${[[true, 'Yes'], [false, 'No'], [null, 'Not known']].map(([k, l]) => `<button class="${(v.pregnant ?? null) === k ? 'on' : ''}" data-preg="${k}">${l}</button>`).join('')}</span>`) : ''}</dl>`;
  };

  // ----- tubes (collect / receive step) -----
  const tubeSection = (vv, tubes, a) => {
    const collectStep = tubes.some((t) => !t.collectedAt); const n = tubes.filter((t) => (collectStep ? t.collectedAt : t.receivedAt)).length;
    return `<div class="h-sech"><h2>Samples</h2><span class="h-muted">${collectStep ? 'Check the patient’s name, stick each label in front of them, then scan or mark each tube' : 'Scan each tube when it reaches the bench'}</span><span class="h-grow"></span>
      <span class="h-prog">${n} of ${tubes.length} ${collectStep ? 'collected' : 'received'}<i><b style="width:${(n / tubes.length) * 100}%"></b></i></span></div>
      <table class="h-table"><thead><tr><th style="width:34%">Tube</th><th>Tests</th><th style="width:150px">Status</th><th style="width:200px"></th></tr></thead><tbody>${tubes.map((t) => { const ti = tubeInfo(t.container); const tests = t.orders.filter((o) => o.status !== 'CANCELLED');
        const state = t.receivedAt ? `<span class="h-ok">In lab ${clock(t.receivedAt)}</span>` : t.collectedAt ? `<span class="h-info">Collected ${clock(t.collectedAt)}</span>` : t.rejected ? '<span class="danger">Rejected</span>' : '<span class="h-muted">Not collected</span>';
        const acts = !can('lab.work') ? '' : !t.collectedAt ? (a.ok ? `<button class="btn btn-secondary btn-sm" data-collect="${t.code}">${icon('check')}Mark collected</button>` : '')
          : !t.receivedAt ? `<button class="h-link danger" data-reject="${t.code}">Reject</button><button class="btn btn-secondary btn-sm" data-receive="${t.code}">${icon('check')}Receive</button>` : '';
        return `<tr><td><div class="h-tubecell">${cap(t.container)}<div><b>${esc(ti.name)}</b><small class="mono">${t.code}</small></div></div></td><td>${tests.map((o) => esc(o.name)).join(', ')}</td><td>${state}</td><td class="ta-right h-acts">${acts}</td></tr>`; }).join('')}</tbody></table>`;
  };

  // ----- results -----
  const resultsSection = (vv) => {
    const os = liveOrders(vv); let anyInput = false;
    const groups = os.map((o) => {
      const [sl, st] = ORDER_STATE(o); const ps = labParams(o); const vals = Object.fromEntries((o.lab.results || []).map((r) => [r.param, r.value]));
      const hidden = isConfidential(o) && !seeConf;
      const amending = o.status === 'COMPLETED' && editing.has(o.id);
      const input = !hidden && ((can('lab.work') && o.lab.receivedAt && (o.status === 'SAMPLE_COLLECTED' || (o.status === 'RESULTED' && editing.has(o.id)))) || amending);
      const show = input || ['RESULTED', 'COMPLETED'].includes(o.status); if (input) anyInput = true;
      const prev = show ? prevOf(o) : null; const pv = (n) => prev?.lab.results.find((r) => r.param === n)?.value;
      const who = o.lab.enteredBy ? `Entered by ${esc(userName(o.lab.enteredBy))} ${clock(o.lab.enteredAt)}${o.lab.verifiedBy ? ` · verified by ${esc(userName(o.lab.verifiedBy))}` : ''}${o.lab.amendedBy ? ` · amended by ${esc(userName(o.lab.amendedBy))}` : ''}` : '';
      const changed = new Map(); (o.lab.history || []).concat(o.lab.amendments || []).forEach((h) => h.changes.forEach((c) => (changed.get(c.param) || changed.set(c.param, []).get(c.param)).push(`${c.from || '—'} → ${c.to} · ${userName(h.by)} ${fmtDateTime(h.at)} · ${h.reason}`)));
      const head = `<tr class="g"><td colspan="6"><div class="h-grp"><b>${esc(o.name)}</b><span class="h-state ${st}">${sl}</span>${o.lab.reportNo ? `<span class="mono h-muted">${o.lab.reportNo}</span>` : ''}<span class="h-grow"></span><span class="h-muted">${who}</span>
        ${o.status === 'RESULTED' && !editing.has(o.id) && can('lab.work') ? `<button class="h-link" data-edit="${o.id}">${icon('pencil')}Correct</button>` : ''}
        ${!verifyBlock(o, user) && !editing.has(o.id) && os.filter((x) => x.status === 'RESULTED').length > 1 ? `<button class="h-link" data-verify-one="${o.id}">${icon('patch-check')}Verify this</button>` : ''}
        ${o.status === 'COMPLETED' && canSign(user) && !editing.has(o.id) && !hidden ? `<button class="h-link" data-amend="${o.id}" title="Correct a released report — it will print as AMENDED">${icon('pencil-square')}Amend</button>` : ''}
        ${amending ? `<button class="h-link" data-unedit="${o.id}">Cancel amend</button>` : ''}</div></td></tr>`;
      if (hidden) return head + `<tr><td colspan="6" class="h-muted h-note">${icon('lock-fill')} Confidential test — the result is visible to lab staff only.</td></tr>`;
      if (!show) return head + `<tr><td colspan="6" class="h-muted h-note">${o.status === 'SAMPLE_COLLECTED' ? 'Receive the tube at the bench to enter results.' : o.status === 'READY' ? 'Collect the sample first.' : 'Waiting for payment.'}</td></tr>`;
      return head + ps.map((q) => { const f = flagFor(q, vals[q.name]); const qual = q.ref !== undefined; const dl = `dl-${o.id}-${q.name.replace(/\W/g, '')}`; const has = vals[q.name] != null && vals[q.name] !== '';
        return `<tr class="${has && f ? 'f-' + FLAG[f][1] : ''}"><td>${esc(q.name)}</td>
          <td>${input ? `<input class="l2-in h-in" data-oid="${o.id}" data-p="${esc(q.name)}" value="${esc(vals[q.name] ?? '')}" ${qual ? `list="${dl}" placeholder="${esc(q.ref)}"` : 'inputmode="decimal"'} autocomplete="off">${qual ? `<datalist id="${dl}"><option value="${esc(q.ref)}">${['Positive', 'Reactive', 'Present', 'Nil', 'Absent', 'Non-reactive', 'Negative'].filter((x) => x !== q.ref).map((x) => `<option value="${x}">`).join('')}</datalist>` : ''}` : `<b class="h-val">${esc(vals[q.name] ?? '—')}</b>${changed.has(q.name) ? `<span class="h-chg" title="${esc(changed.get(q.name).join('\n'))}">changed</span>` : ''}`}</td>
          <td class="h-muted">${esc(q.unit || '')}</td>
          <td data-flag>${has ? flagTxt(f) : ''}</td>
          <td class="h-muted">${esc(refText(q))}${q.rangeLabel ? `<small class="h-critlim">${esc(q.rangeLabel)}</small>` : ''}${q.critLow != null || q.critHigh != null ? `<small class="h-critlim">critical ${q.critLow != null ? '&lt; ' + q.critLow : ''}${q.critLow != null && q.critHigh != null ? ' / ' : ''}${q.critHigh != null ? '&gt; ' + q.critHigh : ''}</small>` : ''}</td>
          <td class="h-prev">${prev ? `${esc(pv(q.name) ?? '—')} <small>${fmtDate(prev.lab.verifiedAt)}</small>` : '<small>—</small>'}</td></tr>`; }).join('');
    }).join('');
    return `<div class="h-sech"><h2>${anyInput ? 'Enter results' : 'Results'}</h2><span class="h-muted">${anyInput ? 'Enter moves to the next box · High / Low / Critical are marked as you type' : ''}</span></div>
      <table class="h-table h-res"><thead><tr><th>Parameter</th><th style="width:130px">Result</th><th style="width:80px">Unit</th><th style="width:100px">Flag</th><th style="width:170px">Normal range</th><th style="width:150px">Previous</th></tr></thead><tbody>${groups}</tbody></table>`;
  };

  // ----- send -----
  const sendSection = (vv) => {
    const p = pat(vv.patientId); const rd = vv.referralDoctorId && store.get('referralDoctors', vv.referralDoctorId); const b = vv.billId && store.get('hbills', vv.billId); const due = b ? hbillBalance(b) : 0;
    const since = lastAmendAt(vv) || ''; const sent = (ch, dr = false) => vv.deliveries.some((d) => d.channel === ch && !!d.toDoctor === dr && d.at >= since);
    const conf = visitConfidential(vv); const stale = staleDeliveries(vv).filter((d) => d.channel !== 'WARD');
    const dis = can('lab.deliver') ? '' : 'disabled';
    const opt = (k, ic, label, sub, on = true, done = false) => `<button class="h-opt" data-send="${k}" ${on ? dis : 'disabled'}>${icon(ic)}<span><b>${label}</b><small>${esc(sub)}</small></span>${done ? `<em>${icon('check2')}Sent</em>` : ''}</button>`;
    const ip = vv.source === 'IP';
    return `<div class="h-sech"><h2>${ip ? 'Send a copy to the patient' : 'Send the report'}</h2><span class="h-muted">Verified ${clock(reportReadyAt(vv))}${ip ? ' · already posted to the ward' : ''}</span>${isUncollected(vv) ? '<span class="danger">Not collected</span>' : ''}${wardWaPending(vv) ? '<span class="h-warn">Ward asked for WhatsApp</span>' : ''}</div>
      ${stale.length ? `<div class="h-msg amber">${icon('arrow-repeat')}<div><b>Send the corrected report again.</b> These people have the old copy: ${stale.map((d) => `${esc(CHANNEL_LABEL[d.channel] || d.channel)}${d.toDoctor ? ' (doctor)' : ''} — ${esc(d.to)}`).join(', ')}.</div></div>` : ''}
      ${conf ? `<div class="h-msg amber">${icon('lock-fill')}<div><b>Confidential test.</b> Hand the report to the patient in person after post-test counselling. It cannot be sent by WhatsApp, SMS, email or to the referring doctor.</div></div>` : ''}
      <div class="h-opts">${conf ? '' : opt('WHATSAPP', 'whatsapp', 'WhatsApp to patient', p.phone || 'No mobile', !!p.phone, sent('WHATSAPP'))}
        ${rd && !conf ? opt('DOCTOR', 'person-badge', 'Referring doctor', `${rd.name}${rd.phone ? '' : ' · no mobile'}`, !!rd.phone, sent('WHATSAPP', true)) : ''}
        ${opt('PRINT', 'printer', 'Print / save PDF', 'Open the report')}
        ${ip ? '' : opt('COUNTER', 'person-check', vv.handover && vv.handover.at >= since ? `Handed to ${vv.handover.name}` : 'Hand over at counter', due > 0 ? `₹${due} still due on the bill` : conf ? 'Patient only — after counselling' : 'Patient or attender collects', !(vv.handover && vv.handover.at >= since), !!(vv.handover && vv.handover.at >= since))}
        ${conf ? '' : opt('SMS', 'phone', 'SMS', p.phone || 'No mobile', !!p.phone, sent('SMS'))}
        ${conf ? '' : opt('EMAIL', 'envelope', 'Email', p.email || 'No email on record', !!p.email, sent('EMAIL'))}</div>`;
  };

  // ----- the action bar -----
  const drawBar = () => {
    if (!alive) return;
    const vv = visit(id); const bar = host.querySelector('[data-bar]'); if (!bar) return;
    const inputs = [...host.querySelectorAll('.l2-in')]; const os = liveOrders(vv); const resulted = os.filter((o) => o.status === 'RESULTED' && !editing.has(o.id));
    const blocked = resulted.filter((o) => !criticalCallOk(o)); const toVerify = resulted.filter((o) => !verifyBlock(o, user));
    const waiting = resulted.filter((o) => ['NOT_SIGNATORY', 'OWN_ENTRY'].includes(verifyBlock(o, user)?.code)); const vst = verifyState(vv.id, user);
    const waitText = () => { const n = waiting.length; const t = `${n} test${n > 1 ? 's' : ''}`;
      if (waiting.every((o) => verifyBlock(o, user).code === 'OWN_ENTRY')) return `${t} waiting — you entered ${n > 1 ? 'them' : 'it'}, so another signatory must verify (second-person check)`;
      return `${t} waiting for ${vst.doctors.length ? esc(vst.doctors.map((u) => u.name).join(' or ')) : 'an authorised signatory'} to verify — sent to their alerts`; }; const amendingNow = os.some((o) => o.status === 'COMPLETED' && editing.has(o.id));
    const nx = nextAction(vv); const tubes = liveTubes(vv); let status = ''; let sec = ''; let pri = '';
    if (inputs.length) {
      const filled = inputs.filter((i) => i.value.trim()).length; const crit = host.querySelectorAll('tr.f-crit .l2-in').length;
      status = `${crit ? `<span class="danger">${icon('siren')}${crit} critical</span><i>·</i>` : ''}<span class="h-prog">${filled} of ${inputs.length} entered<i><b style="width:${(filled / inputs.length) * 100}%"></b></i></span>`;
      sec = '<span class="h-keys"><kbd>Ctrl S</kbd> save</span>' + (toVerify.length && !amendingNow ? `<button class="btn btn-secondary" data-verify-all>${icon('badge-check')}Verify ${toVerify.length} entered</button>` : '');
      pri = `<button class="btn btn-primary" data-save>${icon('save')}${amendingNow ? 'Save amended report' : 'Save results'}</button>`;
    } else if (blocked.length && (can('lab.work') || can('lab.verify'))) {
      status = `<span class="danger">${icon('siren')}Critical value — log the call to the doctor before release</span>`;
      sec = toVerify.length ? `<button class="btn btn-secondary" data-verify-all>${icon('badge-check')}Verify the other ${toVerify.length}</button>` : '';
      pri = `<button class="btn btn-primary" data-call-log="${blocked[0].id}">${icon('telephone')}Log call to doctor</button>`;
    } else if (waiting.length && !toVerify.length) {
      status = `${icon('hourglass-split')}${waitText()}`;
    } else if (toVerify.length) {
      status = `${icon('badge-check')}${toVerify.length} test${toVerify.length > 1 ? 's' : ''} waiting for verification`;
      pri = `<button class="btn btn-primary" data-verify-all>${icon('badge-check')}Verify &amp; release${toVerify.length > 1 ? ` all ${toVerify.length}` : ''}</button>`;
    } else if (nx.key === 'collect' && canDo('collect')) {
      const n = tubes.filter((t) => t.collectedAt).length;
      status = `${icon('test-tube')}${n} of ${tubes.length} tube${tubes.length > 1 ? 's' : ''} collected`;
      sec = vv.collectionPoint === 'OPD' && vv.token && vv.tokenStatus !== 'CALLED' ? `<button class="btn btn-secondary" data-call>${icon('megaphone')}Call token ${vv.token}</button>` : '';
      pri = `<button class="btn btn-primary" data-collect-all>${icon('check-check')}${n ? `Collect remaining ${tubes.length - n}` : tubes.length > 1 ? `Collect all ${tubes.length}` : 'Mark collected'}</button>`;
    } else if (nx.key === 'receive' && canDo('receive')) {
      const n = tubes.filter((t) => t.collectedAt && !t.receivedAt).length;
      status = `${icon('scan-barcode')}${n} tube${n > 1 ? 's' : ''} on the way to the bench`;
      pri = `<button class="btn btn-primary" data-receive-all>${icon('check-check')}${n > 1 ? `Receive all ${n}` : 'Receive'}</button>`;
    } else if (wardWaPending(vv) && canDo('send')) {
      const p = pat(vv.patientId);
      status = `${icon('check-circle-2')}Posted to the ward · the ward asked to send it to the patient's WhatsApp`;
      pri = `<button class="btn btn-primary" data-send="WHATSAPP" ${p.phone ? '' : 'disabled'}>${icon('message-circle')}Send on WhatsApp</button>`;
    } else if (nx.key === 'send' && canDo('send')) {
      const p = pat(vv.patientId);
      status = `${icon('check-circle-2')}Report verified and ready`;
      pri = visitConfidential(vv) ? `<button class="btn btn-primary" data-send="COUNTER">${icon('person-check')}Hand over in person</button>`
        : `<button class="btn btn-primary" data-send="WHATSAPP" ${p.phone ? '' : 'disabled'}>${icon('message-circle')}Send on WhatsApp</button>`;
    } else {
      status = `${icon(nx.icon)}${esc(nx.title)}`;
      sec = reportReadyAt(vv) ? `<a class="btn btn-secondary" href="#/lab/visit/${vv.id}/report">${icon('printer')}Print report</a>` : '';
    }
    bar.innerHTML = `<div class="h-status">${status}</div><span class="h-grow"></span>${sec}${pri}`;
    bar.querySelector('[data-save]')?.addEventListener('click', save);
    bar.querySelector('[data-verify-all]')?.addEventListener('click', () => verify(toVerify.map((o) => o.id)));
    bar.querySelector('[data-collect-all]')?.addEventListener('click', () => collect(tubes.filter((t) => !t.collectedAt).map((t) => t.code)));
    bar.querySelector('[data-receive-all]')?.addEventListener('click', () => { receiveCodes(tubes.filter((t) => t.collectedAt && !t.receivedAt).map((t) => t.code)); draw(); });
    bar.querySelector('[data-call]')?.addEventListener('click', () => { try { callToken(vv.id, user); toast(`Token ${vv.token} called to the collection room.`); draw(); } catch (e) { toast(e.message, 'error'); } });
    bar.querySelector('[data-send]')?.addEventListener('click', (e) => send(e.currentTarget.dataset.send));
    bar.querySelector('[data-call-log]')?.addEventListener('click', (e) => callLogDialog(e.currentTarget.dataset.callLog, draw));
  };

  // ----- critical value box: who was phoned (F6 / P2-02) -----
  const critBox = (vv) => liveOrders(vv).filter((o) => ['RESULTED', 'COMPLETED'].includes(o.status) && isCritical(o)).map((o) => {
    const ok = criticalCallOk(o); const calls = o.lab.criticalCalls || []; const last = calls.at(-1);
    const done = calls.filter((c) => c.outcome === 'INFORMED' && c.readBack).at(-1);
    return `<div class="h-msg ${ok ? 'amber' : 'red'}">${icon(ok ? 'telephone-fill' : 'exclamation-diamond-fill')}<div class="h-grow"><b>Critical value — ${esc(criticalText(o).join(', '))}.</b>
      ${ok && done ? ` Informed to ${esc(done.toName)} at ${clock(done.at)} by ${esc(userName(done.by))} (read back).` : ` ${o.status === 'COMPLETED' ? 'Released' : 'Not released'} — phone ${esc(o.doctor || 'the doctor')} and log the call${o.status === 'RESULTED' ? ' before verifying' : ''}.`}
      ${last && !ok ? `<small>Last try: ${esc(CALL_OUTCOME[last.outcome])} — ${esc(last.toName)} at ${clock(last.at)}</small>` : ''}</div>
      ${can('lab.work') || can('lab.verify') ? `<button class="btn btn-sm ${ok ? 'btn-secondary' : 'btn-primary'}" data-call-log="${o.id}">${icon('telephone')}${ok ? 'Log another call' : 'Log call'}</button>` : ''}</div>`;
  }).join('');

  // ----- actions -----
  const collect = (codes) => {
    let ok = 0; for (const c of codes) { try { collectTube(id, c, user); ok++; } catch (e) { toast(e.message, 'error'); } }
    if (!ok) return;
    const left = liveTubes(visit(id)).filter((t) => !t.collectedAt).length;
    toast(left ? `${ok === 1 ? codes[0] : `${ok} tubes`} collected — ${left} left.` : 'All tubes collected. Send them to the lab.', left ? 'info' : 'success');
    draw();
  };
  const save = async () => {
    const by = {}; host.querySelectorAll('.l2-in').forEach((i) => { (by[i.dataset.oid] ||= {})[i.dataset.p] = i.value.trim(); });
    const todo = []; const half = [];
    Object.entries(by).forEach(([oid, vals]) => { const n = Object.values(vals).filter(Boolean).length; if (!n) return; if (n < Object.keys(vals).length) half.push(store.get('orders', oid)); else todo.push([oid, vals]); });
    if (half.length) { const o = half[0]; const first = [...host.querySelectorAll(`.l2-in[data-oid="${o.id}"]`)].find((i) => !i.value.trim()); toast(`${o.name}: fill every value before saving (or clear it to save the others).`, 'error'); first?.focus(); return; }
    if (!todo.length) { toast('Type at least one complete test.', 'error'); host.querySelector('.l2-in')?.focus(); return; }
    const diff = (o, vals) => (o.lab.results || []).length && Object.entries(vals).some(([k, v]) => String(o.lab.results.find((r) => r.param === k)?.value ?? '') !== v);
    const amends = todo.filter(([oid]) => store.get('orders', oid).status === 'COMPLETED');
    const fixes = todo.filter(([oid, vals]) => store.get('orders', oid).status !== 'COMPLETED' && diff(store.get('orders', oid), vals));
    if (amends.some(([oid, vals]) => !diff(store.get('orders', oid), vals))) { toast('Change at least one value to amend the report (or press Cancel amend).', 'error'); return; }
    let reason = '';
    if (amends.length || fixes.length) {
      const names = [...amends, ...fixes].map(([oid]) => esc(store.get('orders', oid).name)).join(', ');
      const r = await reasonDialog(amends.length ? 'Amend the released report' : 'Why is the result being changed?', amends.length
        ? `<strong>${names}</strong> was already released. The report will print <b>AMENDED REPORT</b> with your reason, the old values stay on record, and everyone who got the old copy is listed for re-sending.`
        : `<strong>${names}</strong>: the old value is kept with your name, the time and this reason.`, amends.length);
      if (!r) return; reason = r;
    }
    try {
      todo.forEach(([oid, vals]) => { if (store.get('orders', oid).status === 'COMPLETED') amendReport(oid, vals, reason, user); else enterResults(oid, vals, user, reason); editing.delete(oid); });
      const crit = todo.some(([oid]) => isCritical(store.get('orders', oid)));
      toast(amends.length ? 'Amended report saved. Send the corrected copy to everyone listed.' : crit ? 'Saved. CRITICAL value — phone the doctor and log the call before verifying.' : `Results saved for ${todo.length} test${todo.length > 1 ? 's' : ''}. Next: verify.`, crit || amends.length ? 'warning' : 'success');
      draw();
    } catch (e) { toast(e.message, 'error'); }
  };
  const verify = async (ids) => {
    const os = ids.map((x) => store.get('orders', x)); const crit = os.filter(isCritical);
    const ok = await confirmDialog({ title: os.length > 1 ? `Verify ${os.length} tests and release?` : `Verify ${os[0].name}?`, iconName: icon('badge-check'), confirmLabel: 'Verify & release',
      message: `<strong>${os.map((o) => esc(o.name)).join(', ')}</strong><br>Once verified the result is final, gets a report number and goes to the patient's history. It is signed as <b>${esc(user.name)}</b>${signatoryText(user) ? ` — ${esc(signatoryText(user))}` : ''}.${crit.length ? `<div class="h-msg amber" style="margin-top:12px">${icon('telephone-fill')}<div>Critical value in ${crit.map((o) => esc(o.name)).join(', ')} — the call to the doctor is logged.</div></div>` : ''}` });
    if (!ok) return;
    try { os.forEach((o) => verifyReport(o.id, user)); toast(reportReadyAt(visit(id)) ? (visit(id).source === 'IP' ? 'Report released and posted to the ward.' : 'Report released — ready to send.') : 'Verified.', 'success'); draw(); }
    catch (e) { toast(e.message, 'error'); draw(); }
  };
  const send = (ch) => {
    const vv = visit(id);
    if (ch === 'COUNTER') return handOverDialog(vv, draw);
    if (ch === 'PRINT') { location.hash = `#/lab/visit/${vv.id}/report`; return; }
    try { const out = deliverReport(vv.id, ch === 'DOCTOR' ? 'WHATSAPP' : ch, { toDoctor: ch === 'DOCTOR' }, user);
      if (out.url) { window.open(out.url, '_blank'); toast(ch === 'EMAIL' ? 'Mail opened — attach the PDF (Report → Save as PDF) and send.' : ch === 'SMS' ? 'SMS app opened — press Send.' : 'WhatsApp opened with the message — press Send.', 'info'); }
      else toast('Queued — the hospital server sends it with the PDF.', 'success');
      draw();
    } catch (e) { toast(e.message, 'error'); }
  };
  const details = (which) => {
    const vv = visit(id); const p = pat(vv.patientId);
    openDrawer({ head: `<div><b>${esc(p.name)}</b><small>${esc(ageSex(p))} · SID ${vv.sid}</small></div>`, active: which,
      tabs: [{ id: 'journey', label: 'Progress', html: journeyHtml(vv) }, { id: 'activity', label: 'Activity log', html: activityHtml(vv) }, { id: 'changes', label: 'Changes', html: changesHtml(vv) }] });
  };

  const wire = () => {
    host.querySelectorAll('[data-drawer]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); details(b.dataset.drawer); }; });
    host.querySelector('[data-rx]')?.addEventListener('click', async () => { const vv = visit(id); const url = vv.prescription.demo ? null : await attachmentURL(vv.prescription).catch(() => null); if (url) window.open(url, '_blank'); else toast('Sample record — an uploaded prescription opens here.', 'info'); });
    host.querySelectorAll('[data-collect]').forEach((b) => { b.onclick = () => collect([b.dataset.collect]); });
    host.querySelectorAll('[data-receive]').forEach((b) => { b.onclick = () => { receiveCodes([b.dataset.receive]); draw(); }; });
    host.querySelectorAll('[data-reject]').forEach((b) => { b.onclick = async () => { if (await rejectTubeDialog(b.dataset.reject)) draw(); }; });
    host.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { editing.add(b.dataset.edit); draw(); host.querySelector(`.l2-in[data-oid="${b.dataset.edit}"]`)?.focus(); }; });
    host.querySelectorAll('[data-verify-one]').forEach((b) => { b.onclick = () => verify([b.dataset.verifyOne]); });
    host.querySelectorAll('[data-amend]').forEach((b) => { b.onclick = () => { editing.add(b.dataset.amend); draw(); host.querySelector(`.l2-in[data-oid="${b.dataset.amend}"]`)?.focus(); }; });
    host.querySelectorAll('[data-unedit]').forEach((b) => { b.onclick = () => { editing.delete(b.dataset.unedit); draw(); }; });
    host.querySelectorAll('.h-main [data-call-log]').forEach((b) => { b.onclick = () => callLogDialog(b.dataset.callLog, draw); });
    host.querySelectorAll('[data-preg]').forEach((b) => { b.onclick = () => { try { setPregnant(id, b.dataset.preg === 'true' ? true : b.dataset.preg === 'false' ? false : null, user); toast('Saved — the normal ranges follow the answer.'); draw(); } catch (e) { toast(e.message, 'error'); } }; });
    host.querySelectorAll('.h-opts [data-send]').forEach((b) => { b.onclick = () => send(b.dataset.send); });
    const ins = [...host.querySelectorAll('.l2-in')];
    ins.forEach((i, k) => {
      i.addEventListener('input', () => { const o = store.get('orders', i.dataset.oid); const q = labParams(o).find((x) => x.name === i.dataset.p); const f = flagFor(q, i.value); const tr = i.closest('tr');
        tr.className = i.value.trim() && f ? 'f-' + FLAG[f][1] : ''; tr.querySelector('[data-flag]').innerHTML = i.value.trim() ? flagTxt(f) : ''; drawBar(); });
      i.addEventListener('focus', () => { host.querySelectorAll('tr.cur').forEach((r) => r.classList.remove('cur')); i.closest('tr').classList.add('cur'); });
      i.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key.toLowerCase() === 's')) { e.preventDefault(); save(); return; }
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); const n = ins[k + 1]; if (n) { n.focus(); n.select(); } else host.querySelector('[data-save]')?.focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); ins[k - 1]?.focus(); }
        if (e.key === 'Escape') i.blur();
      });
    });
    drawBar();
  };
  const focusFirst = () => { const i = [...host.querySelectorAll('.l2-in')].find((x) => !x.value.trim()) || host.querySelector('.l2-in'); if (i) { i.scrollIntoView({ block: 'center' }); i.focus(); } };
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && host.querySelector('[data-save]')) { e.preventDefault(); save(); } };
  document.addEventListener('keydown', onKey);
  draw();
  if (step === 'results') setTimeout(focusFirst, 80);
  const dirty = () => [...host.querySelectorAll('.l2-in')].some((i) => i.value !== i.defaultValue);
  const unsub = store.subscribe(() => { if (alive && host.isConnected && !dirty() && !document.querySelector('.modal-backdrop')) draw(); });
  return { cleanup: () => { alive = false; document.removeEventListener('keydown', onKey); unsub(); }, focusFirst, redraw: draw };
}

// ----- drawer content -----
function journeyHtml(v) {
  const total = reportReadyAt(v) ? `<p class="l2-muted" style="margin:0 0 14px">Bill to report: <b>${dur(minsSince(v.createdAt, reportReadyAt(v)))}</b></p>` : '';
  return `${total}<ol class="l2-tl">${journey(v).map((s) => `<li class="${s.done ? 'd' : ''} ${s.current ? 'cur' : ''}"><span class="l2-tl-ic">${icon(s.done ? 'check' : s.icon)}</span><div><b>${esc(s.label)}</b><small>${esc(s.sub)}</small></div><span class="l2-tl-t">${s.done && s.at ? clock(s.at) : ''}</span></li>`).join('')}</ol>`;
}
function activityHtml(v) {
  const ev = [{ at: v.createdAt, ic: 'receipt', t: v.billingRoute === 'IP_ACCOUNT' ? 'Ordered from the ward' : 'Billed at the counter', by: v.createdBy }];
  if (v.calledAt) ev.push({ at: v.calledAt, ic: 'megaphone', t: `Token ${v.token} called`, by: v.calledBy });
  v.tubes.forEach((t) => { if (t.rejected) ev.push({ at: t.rejected.at, ic: 'rotate-ccw', t: `${t.code} rejected — ${t.rejected.reason}`, by: t.rejected.by, tone: 'danger' }); if (t.collectedAt) ev.push({ at: t.collectedAt, ic: 'test-tube', t: `${t.code} collected`, by: t.collectedBy }); if (t.receivedAt) ev.push({ at: t.receivedAt, ic: 'scan-barcode', t: `${t.code} received in lab`, by: t.receivedBy }); });
  liveOrders(v).forEach((o) => { if (o.lab.enteredAt) ev.push({ at: o.lab.enteredAt, ic: 'keyboard', t: `${svc(o.serviceId)?.code || o.name} results entered`, by: o.lab.enteredBy }); if (o.lab.verifiedAt) ev.push({ at: o.lab.verifiedAt, ic: 'badge-check', t: `${svc(o.serviceId)?.code || o.name} verified`, by: o.lab.verifiedBy, tone: 'd' }); });
  liveOrders(v).forEach((o) => { const c = svc(o.serviceId)?.code || o.name;
    (o.lab.criticalCalls || []).forEach((k) => ev.push({ at: k.at, ic: 'telephone', t: `${c}: critical value — ${CALL_OUTCOME[k.outcome]} ${k.toName}${k.readBack ? ' (read back)' : ''}`, by: k.by, tone: k.outcome === 'INFORMED' ? 'd' : 'danger' }));
    (o.lab.history || []).forEach((h) => ev.push({ at: h.at, ic: 'pencil', t: `${c} corrected: ${h.changes.map((x) => `${x.param} ${x.from} → ${x.to}`).join(', ')} — ${h.reason}`, by: h.by }));
    (o.lab.amendments || []).forEach((h) => ev.push({ at: h.at, ic: 'pencil-square', t: `${c} AMENDED after release: ${h.changes.map((x) => `${x.param} ${x.from} → ${x.to}`).join(', ')} — ${h.reason}`, by: h.by, tone: 'danger' }));
    if (o.lab.notification) ev.push({ at: o.lab.notification.notifiedAt || o.lab.notification.at, ic: 'megaphone', t: o.lab.notification.status === 'NOTIFIED' ? `${c}: notified on ${o.lab.notification.program} — ID ${o.lab.notification.refNo}` : `${c}: positive — notifiable disease, not reported yet`, by: o.lab.notification.notifiedBy, tone: o.lab.notification.status === 'NOTIFIED' ? 'd' : 'danger' }); });
  v.deliveries.forEach((d) => ev.push({ at: d.at, ic: d.channel === 'WHATSAPP' ? 'message-circle' : d.channel === 'COUNTER' ? 'hand' : d.channel === 'WARD' ? 'bed-double' : d.channel === 'EMAIL' ? 'mail' : 'smartphone', t: `${CHANNEL_LABEL[d.channel] || d.channel}${d.toDoctor ? ' to doctor' : ''} — ${d.to}`, by: d.by, tone: 'd' }));
  ev.sort((a, b) => b.at.localeCompare(a.at));
  return `<ol class="l2-tl">${ev.map((e) => `<li class="d ${e.tone === 'danger' ? 'danger' : ''}"><span class="l2-tl-ic">${icon(e.ic)}</span><div><b>${esc(e.t)}</b><small>${e.by ? esc(userName(e.by)) : ''}</small></div><span class="l2-tl-t">${fmtDateTime(e.at)}</span></li>`).join('')}</ol>`;
}

function changesHtml(v) {
  const rows = liveOrders(v).flatMap((o) => [...(o.lab.history || []).map((h) => ({ ...h, o, kind: 'Corrected before release' })), ...(o.lab.amendments || []).map((h) => ({ ...h, o, kind: `Amendment ${h.no} — after release` }))]).sort((a, b) => b.at.localeCompare(a.at));
  if (!rows.length) return '<p class="l2-muted">No result has been changed. Every correction (with the old value, who, when and why) and every amendment of a released report is listed here.</p>';
  return rows.map((h) => `<div class="h-chgcard"><div class="h-chghead"><b>${esc(h.o.name)}</b><span>${esc(h.kind)}</span></div>
    <table class="h-table"><thead><tr><th>Result</th><th>Old</th><th>New</th></tr></thead><tbody>${h.changes.map((c) => `<tr><td>${esc(c.param)}</td><td><s>${esc(c.from || '—')}</s></td><td><b>${esc(c.to)}</b></td></tr>`).join('')}</tbody></table>
    <small>${esc(userName(h.by))} · ${fmtDateTime(h.at)} · Reason: ${esc(h.reason)}</small>${h.prev ? `<a class="h-link" href="#/lab/visit/${v.id}/report?asof=${encodeURIComponent(h.at)}">View the report as it was before</a>` : ''}</div>`).join('');
}

/** Ask for the reason of a correction / amendment. Resolves to the text, or '' when cancelled. */
function reasonDialog(title, message, amend) {
  const REASONS = amend ? ['Wrong value typed', 'Analyser re-run gave a different value', 'Wrong patient / sample mix-up found', 'Unit or decimal error', 'Other'] : ['Typing mistake', 'Machine re-run', 'Recollected sample', 'Other'];
  return new Promise((resolve) => { let done = false;
    openModal({ title, size: 'sm', body: `<p>${message}</p><div class="field mt-2"><label>Reason <span class="req">*</span></label><select class="input" data-r>${REASONS.map((r) => `<option>${r}</option>`).join('')}</select></div>
      <div class="field mt-1"><label>Details ${amend ? '<span class="req">*</span>' : '(optional)'}</label><input class="input" data-n placeholder="${amend ? 'e.g. 1.25 typed instead of 12.5' : 'Optional note'}"></div>`,
      footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: amend ? 'Save amended report' : 'Save', cls: 'btn-primary', onClick: (c, w) => { const r = w.querySelector('[data-r]').value; const n = w.querySelector('[data-n]').value.trim();
        if ((amend || r === 'Other') && !n) { toast('Write the details of the change.', 'error'); w.querySelector('[data-n]').focus(); return; } done = true; c(); resolve(n ? `${r} — ${n}` : r); } }],
      onClose: () => { if (!done) resolve(''); } }); });
}

/** Log the phone call for a critical value: who, number, what happened, read back. */
function callLogDialog(orderId, done) {
  const o = store.get('orders', orderId); const v = visit(o.labVisitId); const rd = v?.referralDoctorId && store.get('referralDoctors', v.referralDoctorId);
  const ward = v?.source === 'IP';
  openModal({ title: 'Log the call to the doctor', subtitle: `${o.name} · ${criticalText(o).join(', ')}`, size: 'sm',
    body: `<p class="muted small">Phone now, tell the value, and ask the doctor (or ward nurse) to read it back to you.</p>
      <div class="form-grid mt-1"><div class="field col-12"><label>Spoke to <span class="req">*</span></label><input class="input" data-to value="${esc(o.doctor || rd?.name || '')}"></div>
      <div class="field col-6"><label>Role</label><select class="input" data-role><option value="DOCTOR">Doctor</option><option value="WARD_NURSE" ${ward ? 'selected' : ''}>Ward nurse</option><option value="DUTY_DOCTOR">Duty doctor</option></select></div>
      <div class="field col-6"><label>Phone</label><input class="input" data-ph value="${esc(rd?.phone || '')}"></div>
      <div class="field col-12"><label>What happened <span class="req">*</span></label><div class="seg seg-full" data-out>${Object.entries(CALL_OUTCOME).map(([k, l], i) => `<button type="button" class="seg-btn ${i ? '' : 'active'}" data-v="${k}">${l}</button>`).join('')}</div></div>
      <label class="check col-12"><input type="checkbox" data-rb> The doctor read the value back to me</label>
      <div class="field col-12"><label>Note</label><input class="input" data-note placeholder="e.g. Will see the patient now"></div></div>`,
    onOpen: (w) => w.querySelectorAll('[data-out] [data-v]').forEach((b) => { b.onclick = () => w.querySelectorAll('[data-out] [data-v]').forEach((x) => x.classList.toggle('active', x === b)); }),
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save call', cls: 'btn-primary', onClick: (c, w) => {
      try { const out = w.querySelector('[data-out] .active').dataset.v;
        logCriticalCall(orderId, { toName: w.querySelector('[data-to]').value, toRole: w.querySelector('[data-role]').value, phone: w.querySelector('[data-ph]').value, outcome: out, readBack: w.querySelector('[data-rb]').checked, note: w.querySelector('[data-note]').value }, currentUser());
        c(); toast(out === 'INFORMED' ? 'Call logged — the report can be verified now.' : 'Call logged. Try again or call the duty doctor — the owner is alerted after 15 minutes.', out === 'INFORMED' ? 'success' : 'warning'); done();
      } catch (e) { toast(e.message, 'error'); } } }] });
}

function handOverDialog(v, done) {
  const conf = visitConfidential(v);
  openModal({ title: 'Hand over the printed report', subtitle: `SID ${v.sid}`, size: 'sm',
    body: `${conf ? `<div class="h-msg amber" style="margin-bottom:10px">${icon('lock-fill')}<div><b>Confidential test.</b> Give it to the patient in person after post-test counselling.</div></div>` : ''}<div class="field"><label>Who is collecting?</label><div class="seg seg-full" data-who>${['Self', 'Attender / family', 'Doctor’s staff'].map((x, i) => `<button type="button" class="seg-btn ${i ? '' : 'active'}" data-v="${x}">${x}</button>`).join('')}</div></div>
      <div class="field mt-1"><label>Name <span class="req">*</span></label><input class="input" data-n value="${esc(pat(v.patientId).name)}"></div><p class="muted small mt-1">Match the SID on the patient's bill before handing over.</p>
      ${conf ? `<label class="check mt-1"><input type="checkbox" data-cns> Post-test counselling done</label><label class="check"><input type="checkbox" data-auth> Not the patient: written authorisation from the patient seen</label>` : ''}`,
    onOpen: (w) => w.querySelectorAll('[data-who] [data-v]').forEach((b) => { b.onclick = () => { w.querySelectorAll('[data-who] [data-v]').forEach((x) => x.classList.toggle('active', x === b)); const n = w.querySelector('[data-n]'); n.value = b.dataset.v === 'Self' ? pat(v.patientId).name : ''; n.focus(); }; }),
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Hand over & print', cls: 'btn-primary', icon: icon('printer'), onClick: (c, w) => { try { handOver(v.id, { collectedBy: w.querySelector('[data-who] .active').dataset.v, name: w.querySelector('[data-n]').value, counselled: !!w.querySelector('[data-cns]')?.checked, authorised: !!w.querySelector('[data-auth]')?.checked }, currentUser()); c(); toast('Handed over.'); location.hash = `#/lab/visit/${v.id}/report`; } catch (e) { toast(e.message, 'error'); } } }] });
}

/** Old single-test links (#/lab/orders/:id) open the patient's SID page at that test. */
export function renderOrderRedirect(view, params) {
  const o = store.get('orders', params.id);
  if (o?.labVisitId) { location.replace(`#/lab/visit/${o.labVisitId}?step=${o.status === 'RESULTED' ? 'verify' : 'results'}`); return; }
  view.innerHTML = emptyState('flask-conical', 'Lab test not found');
}
