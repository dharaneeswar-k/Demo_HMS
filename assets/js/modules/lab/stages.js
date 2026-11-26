// Lab stage registry — the five steps of the lab, in the order a sample moves through them.
// Each stage says which patient visits belong to it (select), how long they have waited (since) and one short
// line for the list (line). The workbench lists them; the patient panel (sid.js) does the work.
import { store } from '../../data-service.js';
import { svc, isCritical } from '../../hospital.js';
import { visitStatus, visitAccess, reportReadyAt, priorityRank, tubeOf } from '../../labflow.js';
import { userName } from '../../calculations.js';
import { esc } from '../../utils.js';
import { icon } from './bi.js';
import { pat, liveOrders, liveTubes, clock } from './ui.js';

const byQueue = (a, b) => priorityRank(a) - priorityRank(b) || (a.token || 0) - (b.token || 0) || a.createdAt.localeCompare(b.createdAt);
const critFirst = (a, b) => (liveOrders(b).some(isCritical) - liveOrders(a).some(isCritical)) || byQueue(a, b);
const matches = (v, q) => { if (!q) return true; const p = pat(v.patientId); return [v.sid, p.name, p.uhid, p.phone, v.token, v.bed, ...v.tubes.map((t) => t.code)].join(' ').toLowerCase().includes(q); };
const first = (xs) => xs.filter(Boolean).sort()[0];
export const POINTS = [{ id: 'all', label: 'All' }, { id: 'OPD', label: 'OPD' }, { id: 'WARD', label: 'Ward' }, { id: 'CASUALTY', label: 'Casualty' }];

const IN = {
  collect: (v) => ['WAITING', 'COLLECTING'].includes(visitStatus(v)),
  receive: (v) => liveTubes(v).some((t) => t.collectedAt && !t.receivedAt),
  results: (v) => liveOrders(v).some((o) => o.status === 'SAMPLE_COLLECTED' && o.lab.receivedAt),
  verify: (v) => liveOrders(v).some((o) => o.status === 'RESULTED'),
  send: (v) => v.source !== 'IP' && visitStatus(v) === 'READY'
};

const stage = (s) => ({
  ...s,
  select: (q = '', f = 'all') => store.all('labVisits').filter((v) => IN[s.id](v) && (f === 'all' || v.collectionPoint === f) && matches(v, q)).sort(s.sort || byQueue),
  count: (f = 'all') => store.all('labVisits').filter((v) => IN[s.id](v) && (f === 'all' || v.collectionPoint === f)).length
});

export const STAGES = [
  stage({ id: 'collect', n: 1, label: 'Collect', icon: 'test-tube', late: 30,
    empty: ['users-round', 'Nobody waiting for a sample', 'Paid lab tests appear here as soon as the counter bills them.'],
    since: (v) => v.createdAt,
    line: (v) => { const ts = liveTubes(v); const redo = ts.find((t) => t.rejected && !t.collectedAt); const part = ts.filter((t) => t.collectedAt).length;
      return redo ? `<span class="danger">${icon('rotate-ccw')}Recollect</span>` : part ? `${part} of ${ts.length} tubes collected` : v.tokenStatus === 'CALLED' ? `<span class="ok">${icon('megaphone')}Called ${clock(v.calledAt)}</span>` : ''; } }),
  stage({ id: 'receive', n: 2, label: 'Receive', icon: 'scan-barcode', late: 20,
    empty: ['scan-barcode', 'No tubes on the way', 'Collected tubes wait here until they are scanned at the bench.'],
    since: (v) => first(liveTubes(v).filter((t) => t.collectedAt && !t.receivedAt).map((t) => t.collectedAt)),
    sort: (a, b) => priorityRank(a) - priorityRank(b) || (first(liveTubes(a).map((t) => t.collectedAt)) || '').localeCompare(first(liveTubes(b).map((t) => t.collectedAt)) || ''),
    line: (v) => { const n = liveTubes(v).filter((t) => t.collectedAt && !t.receivedAt).length; return `${n} tube${n > 1 ? 's' : ''} on the way`; } }),
  stage({ id: 'results', n: 3, label: 'Results', icon: 'keyboard', late: 90,
    empty: ['keyboard', 'No results to enter', 'Samples appear here once they are received at the bench.'],
    since: (v) => first(liveOrders(v).filter((o) => o.status === 'SAMPLE_COLLECTED').map((o) => o.lab.receivedAt)),
    line: (v) => { const os = liveOrders(v); const n = os.filter((o) => o.status === 'SAMPLE_COLLECTED' && o.lab.receivedAt).length; return `${n} of ${os.length} test${os.length > 1 ? 's' : ''} to enter`; } }),
  stage({ id: 'verify', n: 4, label: 'Verify', icon: 'badge-check', late: 30, sort: critFirst,
    empty: ['badge-check', 'Nothing to verify', 'Entered results wait here for the final check.'],
    since: (v) => first(liveOrders(v).filter((o) => o.status === 'RESULTED').map((o) => o.lab.enteredAt)),
    line: (v) => { const os = liveOrders(v).filter((o) => o.status === 'RESULTED'); return os.some(isCritical) ? `<span class="danger">${icon('siren')}Critical value</span>` : `Entered by ${esc(userName(os[0].lab.enteredBy))}`; } }),
  stage({ id: 'send', n: 5, label: 'Send', icon: 'send', late: 60, sort: (a, b) => reportReadyAt(a).localeCompare(reportReadyAt(b)),
    empty: ['send', 'All reports are sent', 'Verified reports wait here until they reach the patient.'],
    since: (v) => reportReadyAt(v),
    line: (v) => esc(pat(v.patientId).phone || 'No mobile on record') })
];
export const stageById = (id) => STAGES.find((s) => s.id === id) || STAGES[0];
/** The first step this visit is waiting at, or null when nothing is left to do. */
export const stageOf = (v) => STAGES.find((s) => IN[s.id](v))?.id || null;
/** Test codes of a visit. */
export const codesOf = (v) => liveOrders(v).map((o) => svc(o.serviceId)?.code || o.name);

/** Patients the lab must not touch yet: billed but not paid. */
export const onHold = () => store.all('labVisits').filter((v) => visitStatus(v) === 'ON_HOLD' && !visitAccess(v).ok);

/** What a scanned code does: collect a tube still on the patient, receive a tube in transit, otherwise open its SID. */
export function scanTarget(code) {
  const c = String(code).trim(); if (!c) return null;
  const f = tubeOf(c);
  if (f && !f.t.collectedAt && IN.collect(f.v) && visitAccess(f.v).ok) return { kind: 'collect', code: f.t.code, v: f.v };
  if (f && f.t.collectedAt && !f.t.receivedAt) return { kind: 'receive', code: f.t.code, v: f.v };
  const v = f?.v || store.all('labVisits').find((x) => x.sid === c);
  return v ? { kind: 'open', v } : null;
}
export const svcCode = (o) => svc(o.serviceId)?.code || o.name;
