// Lab UI kit — small, reusable pieces every lab screen is built from, so the workbench, the SID page and the
// collection dialog all look and read the same: patient line, tube caps, test chips, wait time, the visit journey
// (stepper) and the single "next action" for a visit.
import { store } from '../../data-service.js';
import { SOURCE, PRIORITY, VSTATUS, containers, visitOrders, visitStatus, visitAccess, reportReadyAt } from '../../labflow.js';
import { svc, isCritical } from '../../hospital.js';
import { patientAge } from '../../patients.js';
import { esc, icon } from '../../utils.js';

export const pat = (id) => store.get('patients', id) || { name: 'Unknown patient', uhid: '—', gender: '', phone: '' };
export const liveOrders = (v) => visitOrders(v).filter((o) => o.status !== 'CANCELLED');
export const liveTubes = (v) => v.tubes.filter((t) => t.orderIds.some((id) => store.get('orders', id)?.status !== 'CANCELLED'));
export const initials = (name = '') => name.replace(/^(Dr|Mr|Mrs|Ms|Baby)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const ageSex = (p) => [p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : p.gender, patientAge(p) != null ? `${patientAge(p)} y` : ''].filter(Boolean).join(' · ');

// ---------- time ----------
export const minsSince = (a, b = new Date().toISOString()) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
export const dur = (m) => (m < 1 ? 'just now' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} m` : ''}`.trim() : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`);
export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');
/** Waiting time with a colour: grey under 30 min, amber under 1 h, red after. */
export function waitTag(iso, { label = '' } = {}) {
  const m = minsSince(iso); const tone = m >= 60 ? 'late' : m >= 30 ? 'slow' : '';
  return `<span class="lx-wait ${tone}">${icon('clock-3')}${label ? `${esc(label)} ` : ''}${dur(m)}</span>`;
}

// ---------- pills ----------
export const srcPill = (v) => { const s = SOURCE[v.source]; return `<span class="lx-pill lx-${s.tone}">${icon(s.icon)}${esc(s.short)}</span>`; };
export const priPill = (v) => (v.priority === 'ROUTINE' ? '' : `<span class="lx-pill lx-pri-${v.priority.toLowerCase()}">${v.priority === 'STAT' ? icon('zap') : icon('alarm-clock')}${PRIORITY[v.priority].label}</span>`);
export const statusPill = (v) => { const [l, t] = VSTATUS[visitStatus(v)]; return `<span class="lx-status lx-st-${t}"><i></i>${l}</span>`; };
export const critPill = () => `<span class="lx-pill lx-crit">${icon('siren')}Critical value</span>`;

// ---------- tubes & tests ----------
export const tubeInfo = (key) => { const c = containers()[key] || { label: key, color: '#8FA3B3' }; const [name, sub] = c.label.split(' — '); return { name, sub: sub || '', color: c.color }; };
/** A small drawn tube with the cap colour of its container. */
export const cap = (key, size = '') => `<span class="lx-tube ${size}" style="--tc:${tubeInfo(key).color}" title="${esc(tubeInfo(key).name)}"><b></b><i></i></span>`;
/** Test codes as chips, each marked with its tube colour. */
export function testChips(v, { max = 6 } = {}) {
  const os = liveOrders(v);
  const chips = os.slice(0, max).map((o) => { const s = svc(o.serviceId); return `<span class="lx-chip" style="--tc:${tubeInfo(s?.lab?.container).color}" title="${esc(o.name)}"><i></i>${esc(s?.code || o.name)}</span>`; });
  if (os.length > max) chips.push(`<span class="lx-chip more">+${os.length - max}</span>`);
  return `<span class="lx-chips">${chips.join('')}</span>`;
}

// ---------- the patient line used in every list ----------
export function whoBlock(v, { extra = '' } = {}) {
  const p = pat(v.patientId);
  return `<div class="lx-who"><div class="lx-name"><a href="#/lab/visit/${v.id}">${esc(p.name)}</a>${priPill(v)}${liveOrders(v).some(isCritical) ? critPill() : ''}</div>
    <div class="lx-meta">${esc(ageSex(p))}<span>·</span><span class="mono">${esc(p.uhid)}</span><span>·</span>SID <span class="mono">${v.sid}</span></div>${extra}</div>`;
}
/** Left marker of a row: OPD token, ward bed or casualty. */
export function marker(v) {
  if (v.collectionPoint === 'WARD') return `<div class="lx-mark ward">${icon('bed-double')}<strong>${esc(v.bed || '—')}</strong><small>${esc(v.ward || 'Ward')}</small></div>`;
  if (v.collectionPoint === 'CASUALTY') return `<div class="lx-mark cas">${icon('siren')}<small>Casualty</small></div>`;
  return `<div class="lx-mark tok ${v.tokenStatus === 'CALLED' ? 'called' : ''}"><small>Token</small><strong>${v.token ?? '—'}</strong></div>`;
}

// ---------- the journey of one visit ----------
const fst = (xs) => xs.filter(Boolean).sort()[0]; const lst = (xs) => xs.filter(Boolean).sort().at(-1);
/** Six steps every sample goes through; each is done, current or still to come. */
export function journey(v) {
  const os = liveOrders(v); const ts = liveTubes(v); const a = visitAccess(v); const ready = reportReadyAt(v);
  const all = (f) => os.length > 0 && os.every(f);
  const delivered = v.handover || v.deliveries.find((d) => !d.toDoctor);
  const steps = [
    { key: 'paid', label: v.billingRoute === 'IP_ACCOUNT' ? 'Ordered' : 'Paid', sub: a.ok ? a.label : 'Waiting at counter', done: a.ok, at: v.createdAt, icon: 'receipt' },
    { key: 'collect', label: 'Collected', sub: `${ts.filter((t) => t.collectedAt).length} of ${ts.length} tubes`, done: ts.length > 0 && ts.every((t) => t.collectedAt), at: lst(ts.map((t) => t.collectedAt)), icon: 'test-tube' },
    { key: 'receive', label: 'In lab', sub: `${ts.filter((t) => t.receivedAt).length} of ${ts.length} received`, done: ts.length > 0 && ts.every((t) => t.receivedAt), at: lst(ts.map((t) => t.receivedAt)), icon: 'scan-barcode' },
    { key: 'results', label: 'Results', sub: `${os.filter((o) => ['RESULTED', 'COMPLETED'].includes(o.status)).length} of ${os.length} tests`, done: all((o) => ['RESULTED', 'COMPLETED'].includes(o.status)), at: lst(os.map((o) => o.lab.enteredAt)), icon: 'keyboard' },
    { key: 'verify', label: 'Verified', sub: `${os.filter((o) => o.status === 'COMPLETED').length} of ${os.length} tests`, done: !!ready, at: ready, icon: 'badge-check' },
    { key: 'deliver', label: v.source === 'IP' ? 'Sent to ward' : 'Delivered', sub: delivered ? (v.handover ? 'Handed over' : delivered.channel === 'WARD' ? 'IP record' : delivered.channel === 'WHATSAPP' ? 'WhatsApp' : delivered.channel === 'EMAIL' ? 'Email' : delivered.channel === 'SMS' ? 'SMS' : delivered.channel) : 'Not yet', done: !!delivered, at: delivered?.at, icon: 'send' }
  ];
  const cur = steps.findIndex((s) => !s.done);
  steps.forEach((s, i) => { s.current = i === cur; });
  return steps;
}
export function stepper(v) {
  return `<ol class="lx-steps">${journey(v).map((s, i) => `<li class="${s.done ? 'done' : ''} ${s.current ? 'current' : ''}"><span class="lx-step-dot">${s.done ? icon('check') : i + 1}</span><div><strong>${esc(s.label)}</strong><small>${esc(s.sub)}${s.done && s.at ? ` · ${clock(s.at)}` : ''}</small></div></li>`).join('')}</ol>`;
}

/** The one thing to do next for this visit. */
export function nextAction(v) {
  const os = liveOrders(v); const ts = liveTubes(v); const st = visitStatus(v);
  if (st === 'CANCELLED') return { key: 'none', title: 'This visit was cancelled', text: 'All tests on this SID were cancelled at the counter.', tone: 'muted', icon: 'ban' };
  if (st === 'ON_HOLD') return { key: 'hold', title: 'Waiting for payment', text: `${visitAccess(v).label}. Do not collect the sample — send the patient to the main counter.`, tone: 'warning', icon: 'lock' };
  if (ts.some((t) => !t.collectedAt)) { const n = ts.filter((t) => !t.collectedAt).length; const re = ts.find((t) => t.rejected && !t.collectedAt);
    return { key: 'collect', title: re ? 'Collect a fresh sample' : `Collect ${n} tube${n > 1 ? 's' : ''}`, text: re ? `The earlier sample was rejected: ${re.rejected.reason}.` : `Stick the labels on the tubes in front of the patient, then scan each tube.`, tone: re ? 'danger' : 'info', icon: 'test-tube', btn: 'Collect sample' }; }
  if (ts.some((t) => !t.receivedAt)) { const n = ts.filter((t) => !t.receivedAt).length; return { key: 'receive', title: `Receive ${n} tube${n > 1 ? 's' : ''} in the lab`, text: 'Scan the tube label when it reaches the lab bench, or press Receive.', tone: 'info', icon: 'scan-barcode', btn: 'Receive all' }; }
  const toEnter = os.filter((o) => o.status === 'SAMPLE_COLLECTED');
  if (toEnter.length) return { key: 'results', title: `Enter results for ${toEnter.length} test${toEnter.length > 1 ? 's' : ''}`, text: toEnter.map((o) => o.name).join(', '), tone: 'purple', icon: 'keyboard', btn: 'Enter results' };
  const toVerify = os.filter((o) => o.status === 'RESULTED');
  if (toVerify.length) return { key: 'verify', title: `Check and verify ${toVerify.length} test${toVerify.length > 1 ? 's' : ''}`, text: toVerify.some(isCritical) ? 'Contains a CRITICAL value — inform the doctor after verifying.' : 'Read each value against the range, then release the report.', tone: toVerify.some(isCritical) ? 'danger' : 'purple', icon: 'badge-check', btn: 'Verify & release' };
  if (st === 'READY') return { key: 'send', title: 'Report ready — send it to the patient', text: 'WhatsApp, SMS or email the patient, or hand over the printed copy.', tone: 'success', icon: 'send', btn: 'Send report' };
  return { key: 'done', title: v.source === 'IP' ? 'Report posted to the ward' : v.handover ? `Handed over to ${v.handover.name}` : 'Report sent', text: 'Nothing left to do for this SID. You can still print or resend the report.', tone: 'success', icon: 'check-circle-2' };
}
