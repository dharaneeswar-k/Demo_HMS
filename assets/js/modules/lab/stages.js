// Lab stage registry — the five steps of the lab, in the order a sample moves through them.
// Each stage declares: which items belong to it (select), how one item is drawn (row) and what its buttons do (wire).
// The workbench only lays the stages out; adding or changing a step means editing this file alone.
import { store } from '../../data-service.js';
import { can } from '../../auth.js';
import { svc, isCritical } from '../../hospital.js';
import { visitStatus, visitAccess, reportReadyAt, priorityRank, tubeOf } from '../../labflow.js';
import { userName } from '../../calculations.js';
import { esc, icon } from '../../utils.js';
import { pat, liveOrders, liveTubes, whoBlock, marker, testChips, waitTag, cap, tubeInfo, clock, srcPill } from './ui.js';

const byQueue = (a, b) => priorityRank(a) - priorityRank(b) || (a.token || 0) - (b.token || 0) || a.createdAt.localeCompare(b.createdAt);
const critFirst = (a, b) => (liveOrders(b).some(isCritical) - liveOrders(a).some(isCritical)) || byQueue(a, b);
const matches = (v, q) => { if (!q) return true; const p = pat(v.patientId); return [v.sid, p.name, p.uhid, p.phone, v.token, v.bed, ...v.tubes.map((t) => t.code)].join(' ').toLowerCase().includes(q); };
const doctorLine = (v) => `<div class="lx-sub">${srcPill(v)}<span>${esc(v.doctor || 'Self request')}</span></div>`;

export const STAGES = [
  {
    id: 'collect', n: 1, label: 'Collect', title: 'Collect samples', icon: 'test-tube',
    hint: 'Patients whose tests are paid. Call the token, stick the labels in front of the patient and collect.',
    empty: ['users-round', 'Nobody waiting for a sample', 'Paid lab tests appear here the moment the counter bills them.'],
    filters: [{ id: 'all', label: 'All' }, { id: 'OPD', label: 'OPD tokens', icon: 'ticket' }, { id: 'WARD', label: 'Ward', icon: 'bed-double' }, { id: 'CASUALTY', label: 'Casualty', icon: 'siren' }],
    select: (q, f = 'all') => store.all('labVisits').filter((v) => ['WAITING', 'COLLECTING'].includes(visitStatus(v)) && (f === 'all' || v.collectionPoint === f) && matches(v, q)).sort(byQueue),
    filterCount: (id) => store.all('labVisits').filter((v) => ['WAITING', 'COLLECTING'].includes(visitStatus(v)) && (id === 'all' || v.collectionPoint === id)).length,
    row: (v) => { const redo = liveTubes(v).find((t) => t.rejected && !t.collectedAt); const part = liveTubes(v).filter((t) => t.collectedAt).length;
      return `<div class="lx-row ${v.priority === 'STAT' ? 'stat' : ''}">${marker(v)}
        ${whoBlock(v, { extra: doctorLine(v) })}
        <div class="lx-tests">${testChips(v)}${redo ? `<span class="lx-flagline danger">${icon('rotate-ccw')}Recollect — ${esc(redo.rejected.reason)}</span>` : part ? `<span class="lx-flagline">${part} of ${liveTubes(v).length} tubes collected</span>` : ''}${v.tokenStatus === 'CALLED' ? `<span class="lx-flagline ok">${icon('megaphone')}Called ${clock(v.calledAt)}</span>` : ''}</div>
        <div class="lx-when">${waitTag(v.createdAt, { label: 'Waiting' })}</div>
        <div class="lx-act">${v.collectionPoint === 'OPD' && v.tokenStatus !== 'CALLED' ? `<button class="btn btn-ghost btn-sm" data-call="${v.id}" title="Show the token on the waiting-room screen">${icon('megaphone')}Call</button>` : ''}<button class="btn btn-primary" data-collect="${v.id}">${icon('test-tube')}Collect</button></div></div>`; }
  },
  {
    id: 'receive', n: 2, label: 'Receive', title: 'Receive tubes in the lab', icon: 'scan-barcode',
    hint: 'Tubes collected but not yet at the bench. Scan each label in the box above — it is received instantly.',
    empty: ['scan-barcode', 'No tubes on the way', 'Collected tubes wait here until they are scanned in the lab.'],
    select: (q) => store.all('labVisits').filter((v) => matches(v, q)).flatMap((v) => liveTubes(v).filter((t) => t.collectedAt && !t.receivedAt).map((t) => ({ v, t }))).sort((a, b) => priorityRank(a.v) - priorityRank(b.v) || a.t.collectedAt.localeCompare(b.t.collectedAt)),
    bulk: (items) => (items.length > 1 ? `<button class="btn btn-secondary btn-sm" data-recv-all>${icon('check-check')}Receive all ${items.length}</button>` : ''),
    row: ({ v, t }) => { const ti = tubeInfo(t.container);
      return `<div class="lx-row ${v.priority === 'STAT' ? 'stat' : ''}"><div class="lx-mark tube">${cap(t.container, 'lg')}</div>
        ${whoBlock(v, { extra: `<div class="lx-sub"><span class="mono strong">${t.code}</span><span>${esc(ti.name)}</span></div>` })}
        <div class="lx-tests"><span class="lx-plain">${t.orderIds.map((id) => esc(store.get('orders', id)?.name)).join(', ')}</span></div>
        <div class="lx-when">${waitTag(t.collectedAt, { label: 'Collected' })}<small>by ${esc(userName(t.collectedBy))}</small></div>
        <div class="lx-act"><button class="btn btn-ghost btn-sm lx-danger-text" data-reject="${t.code}">Reject</button><button class="btn btn-primary" data-receive="${t.code}">${icon('check')}Receive</button></div></div>`; }
  },
  {
    id: 'results', n: 3, label: 'Results', title: 'Enter results', icon: 'keyboard',
    hint: 'Samples on the bench. Open a patient to type all their results on one screen — flags appear as you type.',
    empty: ['keyboard', 'No results to enter', 'Received samples appear here.'],
    select: (q) => store.all('labVisits').filter((v) => matches(v, q) && liveOrders(v).some((o) => o.status === 'SAMPLE_COLLECTED' && o.lab.receivedAt)).sort(byQueue),
    row: (v) => { const os = liveOrders(v); const todo = os.filter((o) => o.status === 'SAMPLE_COLLECTED' && o.lab.receivedAt); const firstIn = todo.map((o) => o.lab.receivedAt).sort()[0];
      return `<div class="lx-row ${v.priority === 'STAT' ? 'stat' : ''}">${marker(v)}${whoBlock(v, { extra: doctorLine(v) })}
        <div class="lx-tests">${testChips(v)}<span class="lx-flagline">${todo.length} of ${os.length} test${os.length > 1 ? 's' : ''} to enter</span></div>
        <div class="lx-when">${waitTag(firstIn, { label: 'On bench' })}</div>
        <div class="lx-act"><a class="btn btn-primary" href="#/lab/visit/${v.id}?step=results">${icon('keyboard')}Enter results</a></div></div>`; }
  },
  {
    id: 'verify', n: 4, label: 'Verify', title: 'Verify & release', icon: 'badge-check',
    hint: 'Results typed in and waiting for a final check. Critical values are listed first.',
    empty: ['badge-check', 'Nothing to verify', 'Entered results wait here for the final check.'],
    select: (q) => store.all('labVisits').filter((v) => matches(v, q) && liveOrders(v).some((o) => o.status === 'RESULTED')).sort(critFirst),
    row: (v) => { const os = liveOrders(v).filter((o) => o.status === 'RESULTED'); const crit = os.some(isCritical); const at = os.map((o) => o.lab.enteredAt).sort()[0];
      return `<div class="lx-row ${crit ? 'crit' : v.priority === 'STAT' ? 'stat' : ''}">${marker(v)}${whoBlock(v, { extra: doctorLine(v) })}
        <div class="lx-tests">${testChips(v)}<span class="lx-flagline ${crit ? 'danger' : ''}">${crit ? `${icon('siren')}Critical — call the doctor after verifying` : `${os.length} test${os.length > 1 ? 's' : ''} entered by ${esc(userName(os[0].lab.enteredBy))}`}</span></div>
        <div class="lx-when">${waitTag(at, { label: 'Entered' })}</div>
        <div class="lx-act"><a class="btn btn-primary" href="#/lab/visit/${v.id}?step=verify">${icon('badge-check')}Review & verify</a></div></div>`; }
  },
  {
    id: 'send', n: 5, label: 'Send', title: 'Send reports', icon: 'send',
    hint: 'Finished reports not sent yet. One click opens WhatsApp with the message ready. Ward reports go to the IP record by themselves.',
    empty: ['send', 'All reports are sent', 'Verified reports wait here until they reach the patient.'],
    select: (q) => store.all('labVisits').filter((v) => v.source !== 'IP' && visitStatus(v) === 'READY' && matches(v, q)).sort((a, b) => reportReadyAt(a).localeCompare(reportReadyAt(b))),
    row: (v) => { const p = pat(v.patientId);
      return `<div class="lx-row">${marker(v)}${whoBlock(v, { extra: `<div class="lx-sub">${icon('smartphone')}<span>${esc(p.phone || 'No mobile')}</span>${p.email ? `<span>· ${esc(p.email)}</span>` : ''}</div>` })}
        <div class="lx-tests">${testChips(v)}</div>
        <div class="lx-when">${waitTag(reportReadyAt(v), { label: 'Ready' })}</div>
        <div class="lx-act"><a class="btn btn-ghost btn-sm" href="#/lab/visit/${v.id}/report" title="Open / print the report">${icon('printer')}</a>${can('lab.deliver') ? `<button class="btn btn-wa" data-wa="${v.id}" ${p.phone ? '' : 'disabled'}>${icon('message-circle')}WhatsApp</button>` : ''}<a class="btn btn-secondary btn-sm" href="#/lab/visit/${v.id}?step=send">More</a></div></div>`; }
  }
];
export const stageById = (id) => STAGES.find((s) => s.id === id) || STAGES[0];

/** Patients the lab must not touch yet: billed but not paid. Shown as a note under Collect, not as a stage. */
export const onHold = () => store.all('labVisits').filter((v) => visitStatus(v) === 'ON_HOLD' && !visitAccess(v).ok);

/** What the scan box does with a code: receive a tube in transit, otherwise open its SID. */
export function scanTarget(code) {
  const c = String(code).trim(); if (!c) return null;
  const f = tubeOf(c);
  if (f && f.t.collectedAt && !f.t.receivedAt) return { kind: 'receive', code: f.t.code, v: f.v };
  const v = f?.v || store.all('labVisits').find((x) => x.sid === c);
  return v ? { kind: 'open', v } : null;
}
export const svcCode = (o) => svc(o.serviceId)?.code || o.name;
