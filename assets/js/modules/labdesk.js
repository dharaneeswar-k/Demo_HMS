// Lab desk — the hospital lab pipeline on screen: collection queue (OPD tokens), ward rounds (IP), casualty,
// receive tubes by scan, results & verification queues, SID page, barcode labels, combined report and report desk
// with WhatsApp / SMS / email / counter hand-over, plus the token display for the waiting area.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { userName } from '../calculations.js';
import { svc, labParams, flagFor, refText, isCritical, markPrinted, hbillBalance } from '../hospital.js';
import { SOURCE, PRIORITY, VSTATUS, containers, visit, visitOrders, visitAccess, visitStatus, reportReadyAt, isUncollected, tubesFor, priorityRank, findBySid, tubeOf,
  callToken, collectTube, receiveTube, rejectTube, deliverReport, handOver, createIpOrder, criticalInVisit } from '../labflow.js';
import { CHANNEL_LABEL, STATUS_LABEL } from '../messaging.js';
import { businessDate } from '../pharmacy-calc.js';
import { patientAge } from '../patients.js';
import { attachmentURL } from '../attachment-store.js';
import { badge, dataTable, emptyState, openModal, confirmDialog, kpi, tabs, combo, exportTable } from '../components.js';
import { toast } from '../notifications.js';
import { barcodeSVG } from '../barcode.js';
import { letterhead, docMeta, signBlock } from '../docs.js';
import { setMeta } from '../app.js';
import { esc, icon, fmtNum, fmtDate, fmtDateTime, relTime, refreshIcons, ymd } from '../utils.js';

const pat = (id) => store.get('patients', id);
const srcTag = (v) => `<span class="tag tag-${SOURCE[v.source].tone}">${icon(SOURCE[v.source].icon, 'ic-inline')} ${SOURCE[v.source].short}</span>`;
const prTag = (v) => (v.priority === 'ROUTINE' ? '' : `<span class="tag tag-${PRIORITY[v.priority].tone} strong">${PRIORITY[v.priority].label}</span>`);
const vBadge = (v) => { const [l, t] = VSTATUS[visitStatus(v)]; return `<span class="badge badge-${t}"><span class="dot"></span>${l}</span>`; };
const tubeChip = (t) => { const c = containers()[t.container]; return `<span class="tube-chip" style="--tc:${c.color}"><i></i>${esc(c.label.split(' — ')[0])}</span>`; };
const mins = (a, b = new Date().toISOString()) => Math.round((new Date(b) - new Date(a)) / 60000);
const ageTxt = (m) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${Math.floor(m / 1440)} d`);
const byQueue = (a, b) => priorityRank(a) - priorityRank(b) || (a.token || 0) - (b.token || 0) || a.createdAt.localeCompare(b.createdAt);

// =====================================================================================================
export function renderDesk(view, params, query) {
  const user = currentUser(); const today = businessDate();
  let tab = query.tab || 'queue';
  view.innerHTML = `<div class="lab-top mb-2"><p class="page-intro" style="margin:0">One pipeline for every patient — OP, ward, casualty, outside prescription, self request and packages. Nothing is collected until payment, IP account, emergency or package clears it.</p>
      <div class="row"><a class="btn btn-ghost btn-sm" href="#/lab/display" target="_blank">${icon('monitor')}Token display</a>${can('lab.order.ip') ? `<a class="btn btn-secondary btn-sm" href="#/lab/ward-order">${icon('bed-double')}Ward order</a>` : ''}</div></div>
    <div class="kpis mb-2" data-k></div>
    <section class="card"><div class="row-between card-pad"><div data-tabs></div><div class="input-icon" style="width:300px">${icon('scan-barcode')}<input class="input" data-scan placeholder="Scan tube / SID, or search patient"></div></div><div data-list></div></section>`;
  const scanEl = view.querySelector('[data-scan]');
  const draw = () => {
    const q = scanEl.value.trim().toLowerCase();
    const all = store.all('labVisits').filter((v) => { if (!q) return true; const p = pat(v.patientId); return [v.sid, p?.name, p?.uhid, p?.phone, ...v.tubes.map((t) => t.code)].join(' ').toLowerCase().includes(q); });
    const st = (v) => visitStatus(v);
    const pendingCollect = (v) => ['WAITING', 'COLLECTING'].includes(st(v));
    const g = {
      queue: all.filter((v) => v.collectionPoint === 'OPD' && pendingCollect(v)).sort(byQueue),
      ward: all.filter((v) => v.collectionPoint === 'WARD' && pendingCollect(v)).sort(byQueue),
      casualty: all.filter((v) => v.collectionPoint === 'CASUALTY' && pendingCollect(v)).sort(byQueue),
      receive: all.flatMap((v) => v.tubes.filter((t) => t.collectedAt && !t.receivedAt).map((t) => ({ v, t }))),
      results: store.all('orders').filter((o) => o.category === 'LAB' && o.status === 'SAMPLE_COLLECTED' && o.lab.receivedAt && (!q || all.some((v) => v.id === o.labVisitId))),
      verify: store.all('orders').filter((o) => o.category === 'LAB' && o.status === 'RESULTED' && (!q || all.some((v) => v.id === o.labVisitId))),
      hold: all.filter((v) => st(v) === 'ON_HOLD')
    };
    const doneToday = store.all('labVisits').filter((v) => reportReadyAt(v) && businessDate(reportReadyAt(v)) === today);
    const tat = doneToday.map((v) => mins(v.createdAt, reportReadyAt(v))); const avg = tat.length ? Math.round(tat.reduce((a, b) => a + b, 0) / tat.length) : 0;
    view.querySelector('[data-k]').innerHTML = `${kpi({ label: 'Waiting for sample', value: fmtNum(g.queue.length + g.ward.length + g.casualty.length), iconName: 'test-tube', tone: 'warning', sub: `OPD ${g.queue.length} · Ward ${g.ward.length} · Casualty ${g.casualty.length}` })}
      ${kpi({ label: 'Tubes to receive', value: fmtNum(g.receive.length), iconName: 'scan-barcode', tone: 'info' })}
      ${kpi({ label: 'Results / verification', value: `${g.results.length} / ${g.verify.length}`, iconName: 'badge-check', tone: g.verify.some(isCritical) ? 'danger' : 'purple', sub: g.verify.filter(isCritical).length ? `${g.verify.filter(isCritical).length} critical` : 'to enter / to verify' })}
      ${kpi({ label: 'Reports ready today', value: fmtNum(doneToday.length), iconName: 'file-check-2', tone: 'teal', sub: avg ? `Avg turnaround ${ageTxt(avg)}` : '' })}`;
    tabs(view.querySelector('[data-tabs]'), [{ id: 'queue', label: 'OPD queue', icon: 'ticket', count: g.queue.length }, { id: 'ward', label: 'Ward rounds', icon: 'bed-double', count: g.ward.length }, { id: 'casualty', label: 'Casualty', icon: 'siren', count: g.casualty.length || null },
      { id: 'receive', label: 'Receive', icon: 'scan-barcode', count: g.receive.length }, { id: 'results', label: 'Results', icon: 'keyboard', count: g.results.length }, { id: 'verify', label: 'Verify', icon: 'badge-check', count: g.verify.length }, { id: 'hold', label: 'Payment pending', icon: 'lock', count: g.hold.length }], tab, (t) => { tab = t; draw(); });
    const L = view.querySelector('[data-list]');
    const vRow = (v, act) => { const p = pat(v.patientId); const a = visitAccess(v); return `<div class="work-row ${v.priority === 'STAT' ? 'crit' : ''}">
        <div class="wr-token">${v.token ? `<strong>${v.token}</strong><span>token</span>` : v.collectionPoint === 'WARD' ? `<strong class="small">${esc(v.bed || '—')}</strong><span>${esc(v.ward || '')}</span>` : `<strong>${icon('siren')}</strong><span>casualty</span>`}</div>
        <div class="wr-main"><strong><a href="#/lab/visit/${v.id}">${esc(p.name)}</a> <span class="mono small muted">SID ${v.sid}</span></strong><span>${esc(p.uhid)} · ${esc(p.gender)}/${patientAge(p) ?? '—'} · ${esc(visitOrders(v).filter((o) => o.status !== 'CANCELLED').map((o) => svc(o.serviceId).code).join(', '))}</span>
          <small>${srcTag(v)} ${prTag(v)} ${v.tubes.map(tubeChip).join(' ')} · ${esc(v.doctor || '—')}${v.tubes.some((t) => t.rejected && !t.collectedAt) ? ' · <span class="text-danger">Recollect</span>' : ''}${v.tokenStatus === 'CALLED' ? ' · <span class="text-success strong">Called</span>' : ''}</small></div>
        <div class="wr-meta"><span class="tag tag-${a.tone}">${a.label}</span><small class="muted">${icon('clock', 'ic-inline')} ${ageTxt(mins(v.createdAt))}</small></div><div class="wr-act">${act}</div></div>`; };
    if (['queue', 'ward', 'casualty', 'hold'].includes(tab)) {
      const rows = g[tab];
      L.innerHTML = rows.length ? `<div class="work-list">${rows.map((v) => vRow(v, tab === 'hold' ? '<span class="muted small">Send to main counter</span>' : `${tab === 'queue' && v.tokenStatus !== 'CALLED' ? `<button class="btn btn-ghost btn-sm" data-call="${v.id}">${icon('megaphone')}Call</button>` : ''}<button class="btn btn-primary btn-sm" data-collect="${v.id}">${icon('test-tube')}Collect</button>`)).join('')}</div>`
        : emptyState('check-circle-2', 'Nobody waiting', tab === 'ward' ? 'Ward orders appear here with ward and bed.' : 'Billed lab tests appear here automatically.');
    } else if (tab === 'receive') {
      L.innerHTML = g.receive.length ? `<div class="work-list">${g.receive.map(({ v, t }) => `<div class="work-row"><div class="wr-code">${barcodeSVG(t.code, { height: 24 })}<span class="mono">${t.code}</span></div>
        <div class="wr-main"><strong>${esc(pat(v.patientId).name)}</strong><span>${t.orderIds.map((id) => esc(store.get('orders', id)?.name)).join(', ')}</span><small>${tubeChip(t)} collected ${relTime(t.collectedAt)} by ${esc(userName(t.collectedBy))}</small></div>
        <div class="wr-meta">${srcTag(v)} ${prTag(v)}</div><div class="wr-act"><button class="btn btn-ghost btn-sm" data-rej="${t.code}">Reject</button><button class="btn btn-primary btn-sm" data-recv="${t.code}">${icon('check')}Receive</button></div></div>`).join('')}</div>`
        : emptyState('scan-barcode', 'No tubes in transit', 'Scan a tube label in the box above to receive it.');
    } else {
      const rows = g[tab].sort((a, b) => priorityRank(store.get('labVisits', a.labVisitId) || {}) - priorityRank(store.get('labVisits', b.labVisitId) || {}) || a.billedAt.localeCompare(b.billedAt));
      L.innerHTML = rows.length ? `<div class="work-list">${rows.map((o) => { const v = store.get('labVisits', o.labVisitId); const p = pat(o.patientId); return `<div class="work-row ${isCritical(o) ? 'crit' : ''}"><div class="wr-code">${barcodeSVG(o.accession, { height: 24 })}<span class="mono">${o.accession}</span></div>
        <div class="wr-main"><strong>${esc(o.name)}</strong><span>${esc(p.name)} · <span class="mono">${esc(p.uhid)}</span> · SID ${v?.sid || '—'}</span><small>${v ? srcTag(v) + ' ' + prTag(v) : ''} ${esc(o.doctor || '')}${isCritical(o) ? ' · <span class="text-danger strong">CRITICAL VALUE</span>' : ''}</small></div>
        <div class="wr-meta"><small class="muted">${icon('clock', 'ic-inline')} ${ageTxt(mins(o.billedAt))}</small></div><div class="wr-act"><a class="btn btn-primary btn-sm" href="#/lab/orders/${o.id}">${icon(tab === 'verify' ? 'badge-check' : 'keyboard')}${tab === 'verify' ? 'Review & verify' : 'Enter results'}</a></div></div>`; }).join('')}</div>` : emptyState('check-circle-2', 'Nothing waiting');
    }
    L.querySelectorAll('[data-call]').forEach((b) => { b.onclick = () => { callToken(b.dataset.call, user); toast(`Token ${visit(b.dataset.call).token} called to the collection room.`); draw(); }; });
    L.querySelectorAll('[data-collect]').forEach((b) => { b.onclick = () => openCollection(visit(b.dataset.collect), draw); });
    L.querySelectorAll('[data-recv]').forEach((b) => { b.onclick = () => { try { receiveTube(b.dataset.recv, user); toast(`${b.dataset.recv} received in the lab.`); draw(); } catch (e) { toast(e.message, 'error'); } }; });
    L.querySelectorAll('[data-rej]').forEach((b) => { b.onclick = () => rejectDialog(b.dataset.rej, draw); });
    refreshIcons(view);
  };
  scanEl.addEventListener('input', draw);
  scanEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return; const code = scanEl.value.trim(); if (!code) return;
    const f = tubeOf(code);
    if (f && f.t.collectedAt && !f.t.receivedAt && can('lab.work')) { try { receiveTube(code, user); toast(`${code} received.`); scanEl.value = ''; draw(); } catch (err) { toast(err.message, 'error'); } return; }
    const v = f?.v || findBySid(code); if (v) location.hash = `#/lab/visit/${v.id}`;
  });
  const unsub = store.subscribe(draw);
  draw(); setTimeout(() => scanEl.focus(), 50);
  return () => unsub();
}

async function rejectDialog(code, done) {
  const r = await confirmDialog({ title: `Reject tube ${code}`, tone: 'danger', confirmLabel: 'Reject & recollect', reason: true, reasonLabel: 'Reason', reasonPlaceholder: 'Haemolysed, clotted, insufficient, wrong container, unlabelled…', message: 'The kit used is logged as a repeat and the patient (or ward) is asked for a fresh sample.' });
  if (!r) return; try { rejectTube(code, r.reason, currentUser()); toast('Sample rejected. Recollection requested.', 'warning'); done?.(); } catch (e) { toast(e.message, 'error'); }
}

/** Collection: print labels, stick them in front of the patient, scan each tube to confirm. */
function openCollection(v, done) {
  const user = currentUser(); const p = pat(v.patientId); const a = visitAccess(v);
  if (!a.ok) return toast('Payment is not cleared. Send the patient to the main counter.', 'error');
  const draw = (w) => {
    const ts = tubesFor(visit(v.id));
    w.querySelector('[data-tubes]').innerHTML = ts.filter((t) => t.orders.some((o) => o.status !== 'CANCELLED')).map((t) => `<div class="coll-tube ${t.collectedAt ? 'ok' : ''}">${tubeChip(t)}<div class="grow"><strong class="mono">${t.code}</strong><small>${t.orders.map((o) => esc(o.name)).join(', ')}</small>${t.rejected && !t.collectedAt ? `<small class="text-danger">Recollect — ${esc(t.rejected.reason)}</small>` : ''}</div>
      ${t.collectedAt ? `<span class="tag tag-success">${icon('check', 'ic-inline')} ${fmtDateTime(t.collectedAt).split(', ')[1]}</span>` : `<button class="btn btn-secondary btn-sm" data-tube="${t.code}">Mark collected</button>`}</div>`).join('');
    w.querySelectorAll('[data-tube]').forEach((b) => { b.onclick = () => { try { collectTube(v.id, b.dataset.tube, user); draw(w); } catch (e) { toast(e.message, 'error'); } }; });
    refreshIcons(w);
  };
  openModal({ title: `Collect sample — SID ${v.sid}`, subtitle: `${esc(p.name)} · ${esc(p.uhid)} · ${esc(p.gender)}/${patientAge(p) ?? '—'}${v.collectionPoint === 'WARD' ? ` · ${esc(v.ward)} ${esc(v.bed)}` : ''}`, size: 'md',
    body: `<div class="row mb-2">${srcTag(v)} ${prTag(v)} <span class="tag tag-${a.tone}">${a.label}</span>${p.allergies ? ` <span class="tag tag-danger">Allergy: ${esc(p.allergies)}</span>` : ''}</div>
      <ol class="coll-steps"><li>Confirm name & Patient ID with the patient${v.collectionPoint === 'WARD' ? ' and the wrist band' : ''}.</li><li>Print the labels and stick one on each tube <strong>in front of the patient</strong>.</li><li>Scan each tube (or tap “Mark collected”).</li></ol>
      <div class="input-icon mb-2">${icon('scan-barcode')}<input class="input" data-scan placeholder="Scan tube label to confirm collection"></div><div data-tubes class="coll-list"></div>`,
    footer: [{ label: 'Print labels', icon: 'printer', onClick: () => window.open(`#/lab/visit/${v.id}/labels`, '_blank') }, { label: 'Done', cls: 'btn-primary', onClick: (c) => { c(); done?.(); } }],
    onOpen: (w) => { draw(w); const s = w.querySelector('[data-scan]'); s.focus(); s.addEventListener('keydown', (e) => { if (e.key === 'Enter') { try { collectTube(v.id, s.value.trim(), user); toast(`${s.value.trim()} collected.`); s.value = ''; draw(w); } catch (err) { toast(err.message, 'error'); s.select(); } } }); } });
}

// =====================================================================================================
export function renderVisit(view, params) {
  const user = currentUser(); const v = visit(params.id);
  if (!v) { view.innerHTML = emptyState('flask-conical', 'Lab visit not found'); return; }
  const p = pat(v.patientId); const os = visitOrders(v); const ready = reportReadyAt(v); const a = visitAccess(v);
  const b = v.billId && store.get('hbills', v.billId); const rd = v.referralDoctorId && store.get('referralDoctors', v.referralDoctorId);
  setMeta({ title: `SID ${v.sid} — ${p.name}`, crumbs: [{ label: 'Laboratory', href: '#/lab' }, 'SID ' + v.sid] });
  const waits = ['WAITING', 'COLLECTING'].includes(visitStatus(v));
  view.innerHTML = `<div class="page-actions-row mb-2">${vBadge(v)} ${srcTag(v)} ${prTag(v)}<span class="grow"></span>
      ${waits && can('lab.work') ? `<button class="btn btn-primary" data-collect>${icon('test-tube')}Collect sample</button>` : ''}<a class="btn btn-secondary" href="#/lab/visit/${v.id}/labels" target="_blank">${icon('printer')}Labels & request sheet</a>
      ${ready ? `<a class="btn btn-primary" href="#/lab/visit/${v.id}/report">${icon('file-text')}Report</a>` : os.some((o) => o.status === 'COMPLETED') ? `<a class="btn btn-secondary" href="#/lab/visit/${v.id}/report">${icon('file-text')}Partial report</a>` : ''}</div>
    <div class="grid grid-3-1"><div>
      <section class="card"><header class="card-head"><h2>Tests & tubes</h2><span class="muted small">Report due ${fmtDateTime(v.reportDueAt)}</span></header>
        <table class="table"><thead><tr><th>Tube</th><th>Test</th><th>Status</th><th>Collected</th><th>Received</th><th></th></tr></thead><tbody>
        ${tubesFor(v).map((t) => t.orders.map((o, i) => `<tr>${i === 0 ? `<td rowspan="${t.orders.length}"><span class="mono strong">${t.code}</span><div>${tubeChip(t)}</div>${t.rejected ? `<div class="cell-sub text-danger">Rejected ×${t.rejected.count}: ${esc(t.rejected.reason)}</div>` : ''}</td>` : ''}
          <td><strong>${esc(o.name)}</strong>${o.lab.reportNo ? `<div class="cell-sub mono">${o.lab.reportNo}</div>` : ''}</td><td>${badge(o.status === 'COMPLETED' ? 'COMPLETED' : o.status === 'CANCELLED' ? 'CANCELLED' : o.status === 'RESULTED' ? 'PENDING' : 'SUBMITTED', { READY: 'Awaiting sample', ON_HOLD: 'Payment pending', SAMPLE_COLLECTED: t.receivedAt ? 'In analysis' : 'In transit', RESULTED: 'To verify', COMPLETED: 'Verified', CANCELLED: 'Cancelled' }[o.status])}${isCritical(o) ? ' <span class="tag tag-danger">Critical</span>' : ''}</td>
          ${i === 0 ? `<td rowspan="${t.orders.length}" class="small">${t.collectedAt ? fmtDateTime(t.collectedAt) + '<div class="cell-sub">' + esc(userName(t.collectedBy)) + '</div>' : '—'}</td><td rowspan="${t.orders.length}" class="small">${t.receivedAt ? fmtDateTime(t.receivedAt) : t.collectedAt && can('lab.work') ? `<button class="btn btn-secondary btn-sm" data-recv="${t.code}">Receive</button> <button class="btn btn-ghost btn-sm" data-rej="${t.code}">Reject</button>` : '—'}</td>` : ''}
          <td>${['SAMPLE_COLLECTED', 'RESULTED', 'COMPLETED'].includes(o.status) && t.receivedAt ? `<a class="btn btn-ghost btn-sm" href="#/lab/orders/${o.id}">${icon(o.status === 'COMPLETED' ? 'eye' : 'keyboard')}</a>` : ''}</td></tr>`).join('')).join('')}</tbody></table></section>
      ${ready && v.source !== 'IP' ? deliveryCard(v) : ''}
      <section class="card mt-2"><header class="card-head"><h2>Delivery log</h2></header><div class="card-body">${v.deliveries.length ? v.deliveries.slice().reverse().map((d) => `<div class="tl-item"><strong>${icon(d.channel === 'WHATSAPP' ? 'message-circle' : d.channel === 'COUNTER' ? 'hand' : d.channel === 'WARD' ? 'bed-double' : d.channel === 'EMAIL' ? 'mail' : 'smartphone', 'ic-inline')} ${CHANNEL_LABEL[d.channel]}${d.toDoctor ? ' (referring doctor)' : ''} — ${esc(d.to)}</strong><small>${STATUS_LABEL[d.status] || d.status} · ${fmtDateTime(d.at)} · ${esc(userName(d.by))}</small></div>`).join('') : '<p class="muted">Not delivered yet.</p>'}</div></section>
    </div><div>
      <section class="card"><div class="card-body"><div class="sample-label">${barcodeSVG(v.sid, { height: 34 })}<strong class="mono">SID ${v.sid}</strong>${v.token ? `<span>Token ${v.token} · ${fmtDate(v.tokenDay)}</span>` : ''}</div>
        <div class="kv mt-2"><span>Patient</span><a href="#/patients/${p.id}">${esc(p.name)}</a></div><div class="kv"><span>Patient ID</span><span class="mono">${esc(p.uhid)}</span></div><div class="kv"><span>Age / sex</span><span>${patientAge(p) ?? '—'} / ${esc(p.gender)}</span></div><div class="kv"><span>Mobile</span><span>${esc(p.phone)}</span></div>${p.email ? `<div class="kv"><span>Email</span><span class="small">${esc(p.email)}</span></div>` : ''}
        <div class="divider"></div><div class="kv"><span>Came as</span><span>${SOURCE[v.source].label}</span></div><div class="kv"><span>Doctor</span><span>${esc(v.doctor || '—')}</span></div>${rd ? `<div class="kv"><span>Clinic</span><span class="small">${esc(rd.clinic)}</span></div>` : ''}
        ${v.ipNo ? `<div class="kv"><span>IP no / bed</span><span>${esc(v.ipNo)} · ${esc(v.ward)} ${esc(v.bed)}</span></div>` : ''}
        <div class="kv"><span>Payment</span><span class="tag tag-${a.tone}">${a.label}</span></div>${b ? `<div class="kv"><span>Bill</span><a class="mono" href="#/hbills/${b.id}">${b.id}</a></div>` : v.billingRoute === 'IP_ACCOUNT' ? `<div class="kv"><span>Charges</span><span>On IP account ${esc(v.ipNo)}</span></div>` : ''}
        <div class="kv"><span>Prescription</span><span>${v.prescription ? `<button class="btn btn-ghost btn-sm" data-rx>${icon('file-image')}View</button>` : { DOCTOR_ORDER: 'Doctor order', SELF_REQUEST: 'Self request', PACKAGE: 'Package' }[v.rxBasis] || '—'}</span></div>
        ${v.consent ? `<div class="kv"><span>Consent</span><span class="tag tag-success">Signed</span></div>` : ''}${v.clinicalNotes ? `<div class="kv"><span>Notes</span><span class="small">${esc(v.clinicalNotes)}</span></div>` : ''}</div></section></div></div>`;
  const again = () => renderVisit(view, params);
  view.querySelector('[data-collect]')?.addEventListener('click', () => openCollection(v, again));
  view.querySelectorAll('[data-recv]').forEach((x) => { x.onclick = () => { try { receiveTube(x.dataset.recv, user); toast('Tube received.'); again(); } catch (e) { toast(e.message, 'error'); } }; });
  view.querySelectorAll('[data-rej]').forEach((x) => { x.onclick = () => rejectDialog(x.dataset.rej, again); });
  view.querySelector('[data-rx]')?.addEventListener('click', async () => { const url = v.prescription.demo ? null : await attachmentURL(v.prescription).catch(() => null); if (url) window.open(url, '_blank'); else toast('Sample record — uploaded prescriptions open here.', 'info'); });
  wireDelivery(view, v, again);
  refreshIcons(view);
}

function deliveryCard(v) {
  const p = pat(v.patientId); const rd = v.referralDoctorId && store.get('referralDoctors', v.referralDoctorId); const b = v.billId && store.get('hbills', v.billId);
  const due = b ? hbillBalance(b) : 0;
  return `<section class="card mt-2 deliver"><header class="card-head"><h2>${icon('send')} Send the report</h2>${v.handover ? `<span class="tag tag-success">Handed over to ${esc(v.handover.name)} · ${fmtDate(v.handover.at)}</span>` : isUncollected(v) ? '<span class="tag tag-danger">Not collected</span>' : ''}</header><div class="card-body">
    <div class="deliver-grid">
      <button class="dlv wa" data-dlv="WHATSAPP" ${can('lab.deliver') ? '' : 'disabled'}>${icon('message-circle')}<strong>WhatsApp</strong><small>${esc(p.phone)}</small></button>
      <button class="dlv" data-dlv="SMS" ${can('lab.deliver') ? '' : 'disabled'}>${icon('smartphone')}<strong>SMS</strong><small>${esc(p.phone)}</small></button>
      <button class="dlv" data-dlv="EMAIL" ${can('lab.deliver') && p.email ? '' : 'disabled'}>${icon('mail')}<strong>Email</strong><small>${esc(p.email || 'No email on record')}</small></button>
      ${rd ? `<button class="dlv" data-dlv="DOCTOR" ${can('lab.deliver') && rd.phone ? '' : 'disabled'}>${icon('stethoscope')}<strong>Referring doctor</strong><small>${esc(rd.name)}</small></button>` : ''}
      <button class="dlv" data-dlv="COUNTER" ${can('lab.deliver') && !v.handover ? '' : 'disabled'}>${icon('hand')}<strong>Hand over</strong><small>${due > 0 ? `₹${due} due on bill` : 'Printed copy at counter'}</small></button></div>
    <p class="muted small mt-1">${store.hs().messaging.provider === 'WA_CLOUD' && store.hs().messaging.cloud.enabled ? 'WhatsApp Business API: messages are queued to the hospital server, which sends the PDF automatically.' : 'WhatsApp opens with the number and message filled in — press Send. Automatic sending with the PDF attached is switched on once the hospital server and WhatsApp Business account are set up (Hospital Setup → Messaging).'}</p></div></section>`;
}
function wireDelivery(view, v, again) {
  const user = currentUser();
  view.querySelectorAll('[data-dlv]').forEach((b) => { b.onclick = async () => {
    const ch = b.dataset.dlv;
    if (ch === 'COUNTER') {
      openModal({ title: `Hand over report — SID ${v.sid}`, size: 'sm', body: `<div class="field"><label>Collected by</label><select class="input" data-who><option>Self</option><option>Attender / family</option><option>Referring doctor's staff</option></select></div><div class="field mt-1"><label>Name <span class="req">*</span></label><input class="input" data-n value="${esc(pat(v.patientId).name)}"></div><p class="muted small mt-1">Check the SID on the patient's bill before handing over.</p>`,
        footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Hand over & print', cls: 'btn-primary', icon: 'printer', onClick: (c, w) => { try { handOver(v.id, { collectedBy: w.querySelector('[data-who]').value, name: w.querySelector('[data-n]').value }, user); c(); toast('Handed over.'); location.hash = `#/lab/visit/${v.id}/report`; } catch (e) { toast(e.message, 'error'); } } }] });
      return;
    }
    try {
      const out = deliverReport(v.id, ch === 'DOCTOR' ? 'WHATSAPP' : ch, { toDoctor: ch === 'DOCTOR' }, user);
      if (out.url) { window.open(out.url, '_blank'); toast(ch === 'EMAIL' ? 'Mail app opened — attach the PDF (Report → Save as PDF) and send.' : 'WhatsApp opened with the message — press Send.', 'info'); }
      else toast('Queued for the hospital server — it sends the message with the PDF.', 'success');
      again();
    } catch (e) { toast(e.message, 'error'); }
  }; });
}

// =====================================================================================================
export function renderLabels(view, params) {
  const v = visit(params.id); if (!v) { view.innerHTML = emptyState('tag', 'Not found'); return; }
  const p = pat(v.patientId); const s = store.settings();
  setMeta({ title: `Labels — SID ${v.sid}`, crumbs: [{ label: 'Laboratory', href: '#/lab' }, 'Labels'] });
  view.innerHTML = `<div class="row mb-2 no-print" style="justify-content:center"><button class="btn btn-primary" data-print>${icon('printer')}Print labels & request sheet</button></div>
    <div class="label-sheet">${tubesFor(v).filter((t) => t.orders.some((o) => o.status !== 'CANCELLED')).map((t) => `<div class="tube-label"><div class="tl-top"><strong>${esc(p.name.slice(0, 22))}</strong><span>${patientAge(p) ?? '—'}${esc(p.gender)}</span></div>
      ${barcodeSVG(t.code, { height: 34 })}<div class="tl-code mono">${t.code}</div><div class="tl-bot"><span>${esc(t.orders.map((o) => svc(o.serviceId).code).join(' · '))}</span><span class="tl-c" style="--tc:${containers()[t.container].color}">${esc(t.container)}</span></div>
      <div class="tl-bot"><span>${esc(p.uhid)}</span><span>${fmtDate(v.createdAt)}${v.priority !== 'ROUTINE' ? ' · ' + v.priority : ''}</span></div></div>`).join('')}</div>
    <article class="doc mt-2">${letterhead('LAB REQUEST SHEET', { sub: SOURCE[v.source].label, code: v.sid })}
      ${docMeta([['Patient', esc(p.name)], ['Patient ID', `<span class="mono">${esc(p.uhid)}</span>`], ['Age / Sex', `${patientAge(p) ?? '—'} Y / ${esc(p.gender)}`], ['Mobile', esc(p.phone)], ['Doctor', esc(v.doctor || 'Self')], ['Priority', PRIORITY[v.priority].label], ['Requested', fmtDateTime(v.createdAt)], [v.ipNo ? 'Ward / bed' : 'Token', v.ipNo ? `${esc(v.ward)} ${esc(v.bed)}` : String(v.token || '—')]])}
      <table class="rc-table"><thead><tr><th>Tube</th><th>Container</th><th>Tests</th><th>Collected by / time</th></tr></thead><tbody>${tubesFor(v).map((t) => `<tr><td class="mono">${t.code}</td><td>${esc(containers()[t.container].label)}</td><td>${t.orders.map((o) => esc(o.name)).join('<br>')}</td><td>${t.collectedAt ? esc(userName(t.collectedBy)) + ' · ' + fmtDateTime(t.collectedAt) : ''}</td></tr>`).join('')}</tbody></table>
      ${v.clinicalNotes ? `<p class="mt-2"><strong>Clinical notes:</strong> ${esc(v.clinicalNotes)}</p>` : ''}${signBlock([['Collected by', ''], ['Received in lab', '']])}</article>`;
  view.querySelector('[data-print]').onclick = () => window.print();
  refreshIcons(view);
}

export function renderVisitReport(view, params) {
  const user = currentUser(); const v = visit(params.id); if (!v) { view.innerHTML = emptyState('file-x', 'Not found'); return; }
  const p = pat(v.patientId); const os = visitOrders(v).filter((o) => o.status === 'COMPLETED'); const pending = visitOrders(v).filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status));
  if (!os.length) { view.innerHTML = emptyState('hourglass', 'No verified results yet', 'The report is available after verification.'); return; }
  setMeta({ title: `Report — SID ${v.sid}`, crumbs: [{ label: 'Laboratory', href: '#/lab' }, { label: 'SID ' + v.sid, href: `#/lab/visit/${v.id}` }, 'Report'] });
  const depts = [...new Set(os.map((o) => svc(o.serviceId).lab.department))];
  const first = (k) => os.map((o) => o.lab[k]).filter(Boolean).sort()[0]; const last = (k) => os.map((o) => o.lab[k]).filter(Boolean).sort().at(-1);
  view.innerHTML = `<div class="row mb-2 no-print" style="justify-content:center"><button class="btn btn-primary" data-print>${icon('printer')}Print / Save PDF</button><a class="btn btn-ghost" href="#/lab/visit/${v.id}">${icon('arrow-left')}SID ${v.sid}</a></div>
    <article class="doc">${letterhead(pending.length ? 'LABORATORY REPORT (PARTIAL)' : 'LABORATORY REPORT', { sub: depts.join(' · '), code: v.sid })}
      ${docMeta([['Patient', esc(p.name)], ['Patient ID', `<span class="mono">${esc(p.uhid)}</span>`], ['Age / Sex', `${patientAge(p) ?? '—'} Y / ${esc(p.gender)}`], ['Referred by', esc(v.doctor || 'Self')],
        ['SID', `<span class="mono">${v.sid}</span>`], ['Collected', fmtDateTime(first('collectedAt'))], ['Reported', fmtDateTime(last('verifiedAt'))], [v.ipNo ? 'IP no / bed' : 'Patient type', v.ipNo ? `${esc(v.ipNo)} · ${esc(v.bed)}` : SOURCE[v.source].short]])}
      ${os.map((o) => `<h3 class="doc-h">${esc(o.name)} <small class="muted">· ${esc(o.lab.sampleType)} · ${o.lab.reportNo}</small></h3>
        <table class="rc-table lab-rep"><thead><tr><th>Investigation</th><th>Result</th><th>Unit</th><th>Biological reference interval</th></tr></thead><tbody>
        ${labParams(o).map((q) => { const val = o.lab.results.find((r) => r.param === q.name)?.value; const f = flagFor(q, val); return `<tr class="${f ? 'abn' : ''}"><td>${esc(q.name)}</td><td><strong>${esc(val ?? '—')}</strong> ${f ? `<span class="rep-flag">${f === 'A' ? '*' : f}${f.length === 2 ? ' (critical)' : ''}</span>` : ''}</td><td>${esc(q.unit)}</td><td>${esc(refText(q))}</td></tr>`; }).join('')}</tbody></table>`).join('')}
      ${pending.length ? `<p class="rep-pending">Pending: ${pending.map((o) => esc(o.name)).join(', ')} — will follow in a separate report.</p>` : ''}
      <p class="rc-small mt-2" style="text-align:left">H = above range · L = below range · HH / LL = critical · * = abnormal finding. Results relate only to the sample received. Please correlate clinically.</p>
      ${signBlock([['Lab technician', userName(os[0].lab.enteredBy)], ['Verified by', userName(os.at(-1).lab.verifiedBy)]])}
      <p class="rc-thanks">— End of report —</p></article>`;
  view.querySelector('[data-print]').onclick = () => { os.forEach((o) => markPrinted(o.id)); window.print(); };
  refreshIcons(view);
}
/** Older links to a single-test report open the combined SID report. */
export function renderOrderReport(view, params) { const o = store.get('orders', params.id); const v = o?.labVisitId; if (v) { location.replace(`#/lab/visit/${v}/report`); return; } view.innerHTML = emptyState('file-x', 'Report not found'); }

// =====================================================================================================
export function renderReportDesk(view, params, query) {
  let tab = query.tab || 'ready';
  view.innerHTML = `<p class="page-intro">Every finished SID — send it on WhatsApp, SMS or email, or hand over the printed copy. In-patient reports go straight to the IP record. Reports not collected in ${store.hs().lab.reportCollectDays} days are listed separately.</p>
    <section class="card"><div class="row-between card-pad"><div data-tabs></div><div class="row"><div class="input-icon" style="width:280px">${icon('search')}<input class="input" data-q placeholder="SID, patient, mobile, Patient ID"></div><button class="btn btn-secondary btn-sm" data-csv>${icon('download')}CSV</button></div></div><div data-t></div></section>`;
  const cols = [
    { key: 'sid', label: 'SID', render: (v) => `<span class="mono strong">${v.sid}</span><div class="cell-sub">${fmtDateTime(v.createdAt)}</div>` },
    { key: 'patient', label: 'Patient', value: (v) => pat(v.patientId).name, render: (v) => `${esc(pat(v.patientId).name)}<div class="cell-sub">${esc(pat(v.patientId).phone)}</div>` },
    { key: 'tests', label: 'Tests', sortable: false, render: (v) => `<span class="small">${esc(visitOrders(v).map((o) => svc(o.serviceId).code).join(', '))}</span>${criticalInVisit(v) ? ' <span class="tag tag-danger">Critical</span>' : ''}`, csv: (v) => visitOrders(v).map((o) => o.name).join('; ') },
    { key: 'source', label: 'Came as', render: (v) => srcTag(v), csv: (v) => SOURCE[v.source].short }, { key: 'doctor', label: 'Doctor' },
    { key: 'ready', label: 'Ready', value: (v) => reportReadyAt(v) || '', render: (v) => (reportReadyAt(v) ? fmtDateTime(reportReadyAt(v)) : '—') },
    { key: 'sent', label: 'Delivered', sortable: false, render: (v) => v.deliveries.map((d) => `<span class="tag tag-neutral">${CHANNEL_LABEL[d.channel].split(' ')[0]}${d.toDoctor ? ' (Dr)' : ''}</span>`).join(' ') || '—', csv: (v) => v.deliveries.map((d) => d.channel).join('; ') },
    { key: 'status', label: 'Status', value: (v) => visitStatus(v), render: (v) => `${vBadge(v)}${isUncollected(v) ? ' <span class="tag tag-danger">Not collected</span>' : ''}` }];
  const t = dataTable({ rows: [], pageSize: 15, sort: { key: 'ready', dir: 'desc' }, columns: cols, onRowClick: (v) => { location.hash = `#/lab/visit/${v.id}`; } });
  view.querySelector('[data-t]').appendChild(t.el);
  const draw = () => {
    const q = view.querySelector('[data-q]').value.trim().toLowerCase();
    const all = store.all('labVisits').filter((v) => reportReadyAt(v) || visitOrders(v).some((o) => o.status === 'COMPLETED')).filter((v) => { const p = pat(v.patientId); return !q || [v.sid, p.name, p.phone, p.uhid].join(' ').toLowerCase().includes(q); });
    const g = { ready: all.filter((v) => visitStatus(v) === 'READY'), partial: all.filter((v) => visitStatus(v) === 'PARTIAL'), sent: all.filter((v) => visitStatus(v) === 'SENT'), handed: all.filter((v) => visitStatus(v) === 'HANDED_OVER'), uncollected: all.filter(isUncollected), all };
    tabs(view.querySelector('[data-tabs]'), [{ id: 'ready', label: 'Ready to send', icon: 'send', count: g.ready.length }, { id: 'partial', label: 'Partial', icon: 'hourglass', count: g.partial.length || null }, { id: 'sent', label: 'Sent', icon: 'message-circle', count: g.sent.length },
      { id: 'handed', label: 'Handed over', icon: 'hand', count: g.handed.length }, { id: 'uncollected', label: 'Not collected', icon: 'alert-triangle', count: g.uncollected.length || null }, { id: 'all', label: 'All' }], tab, (x) => { tab = x; draw(); });
    t.setRows(g[tab]);
  };
  view.querySelector('[data-q]').addEventListener('input', draw);
  view.querySelector('[data-csv]').onclick = () => exportTable(`lab-reports-${ymd()}.csv`, cols, t.getRows());
  draw(); refreshIcons(view);
}

// =====================================================================================================
export function renderDisplay(view) {
  document.body.classList.add('token-mode');
  const draw = () => {
    const today = businessDate();
    const vs = store.all('labVisits').filter((v) => v.tokenDay === today && v.collectionPoint === 'OPD');
    const called = vs.filter((v) => v.tokenStatus === 'CALLED').sort((a, b) => (b.calledAt || '').localeCompare(a.calledAt || ''));
    const waiting = vs.filter((v) => v.tokenStatus === 'WAITING' && visitAccess(v).ok).sort(byQueue);
    view.innerHTML = `<div class="token-board"><header>${esc(store.settings().hospitalName)} — Laboratory sample collection<span>${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></header>
      <div class="tb-now"><span>Now calling</span><strong>${called[0]?.token ?? '—'}</strong><em>${called[0] ? 'Please go to the sample collection room' : 'Please wait for your token'}</em></div>
      <div class="tb-next"><span>Next</span><div>${waiting.slice(0, 8).map((v) => `<b class="${v.priority !== 'ROUTINE' ? 'pri' : ''}">${v.token}</b>`).join('') || '<em>No one waiting</em>'}</div></div>
      <footer>Keep your bill with the SID number ready. Reports can be received on WhatsApp.</footer></div>`;
  };
  const unsub = store.subscribe(draw); const timer = setInterval(draw, 15000);
  draw();
  return () => { unsub(); clearInterval(timer); document.body.classList.remove('token-mode'); };
}

// =====================================================================================================
export function renderWardOrder(view) {
  const user = currentUser();
  const admitted = store.all('medicalRecords').filter((r) => !r.dischargedAt && r.episodeType === 'IP');
  let rid = ''; const sel = new Set();
  view.innerHTML = `<p class="page-intro">For admitted patients. No payment at the counter — the tests are charged to the patient's IP account and settled with the final IP bill. The lab sees the order in <strong>Ward rounds</strong> with the ward and bed.</p>
    <div class="grid grid-3-1"><section class="card"><div class="card-body"><div class="form-grid">
      <div class="field col-12"><label>Admitted patient <span class="req">*</span></label><div data-p></div><p class="field-hint">${admitted.length} patient(s) in the wards. When the IP module goes live, its orders arrive here automatically.</p></div>
      <div class="field col-6"><label>Ordering doctor</label><input class="input" data-doc list="wo-docs"><datalist id="wo-docs">${(store.ph().doctors || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div class="field col-6"><label>Priority</label><div class="seg seg-full" data-pri>${Object.entries(PRIORITY).reverse().map(([k, x]) => `<button type="button" class="seg-btn ${k === 'ROUTINE' ? 'active' : ''}" data-v="${k}">${x.label}</button>`).join('')}</div></div>
      <div class="field col-12"><label>Tests</label><div class="svc-pick">${store.all('services').filter((s) => s.category === 'LAB' && s.active).map((s) => `<label class="check"><input type="checkbox" value="${s.id}"> ${esc(s.name)} <span class="muted small">${esc(containers()[s.lab.container].label.split(' — ')[0])}</span></label>`).join('')}</div></div>
      <div class="field col-12"><label>Clinical notes</label><input class="input" data-notes placeholder="e.g. Post-op day 1, fever spike"></div></div>
      <div class="row mt-2" style="justify-content:flex-end"><button class="btn btn-primary" data-save>${icon('send')}Send to lab</button></div></div></section>
      <section class="card"><header class="card-head"><h2>Today's ward orders</h2></header><div class="card-body" data-recent></div></section></div>`;
  let pri = 'ROUTINE';
  combo(view.querySelector('[data-p]'), { options: () => admitted.map((r) => ({ value: r.id, label: pat(r.patientId).name, sub: `${r.ipNo} · ${r.ward}` })), placeholder: admitted.length ? 'Search admitted patient…' : 'No admitted patients', onChange: (v) => { rid = v; const r = store.get('medicalRecords', v); view.querySelector('[data-doc]').value = r.doctor || ''; } });
  view.querySelectorAll('[data-pri] [data-v]').forEach((b) => { b.onclick = () => { pri = b.dataset.v; view.querySelectorAll('[data-pri] [data-v]').forEach((x) => x.classList.toggle('active', x === b)); }; });
  const recent = () => { view.querySelector('[data-recent]').innerHTML = store.all('labVisits').filter((v) => v.source === 'IP').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6).map((v) => `<a class="kv" href="#/lab/visit/${v.id}"><span>${esc(pat(v.patientId).name)}<small class="muted"> · ${esc(v.bed)}</small></span>${vBadge(v)}</a>`).join('') || '<p class="muted">None.</p>'; refreshIcons(view); };
  view.querySelector('[data-save]').onclick = () => {
    try { const v = createIpOrder({ recordId: rid, serviceIds: [...view.querySelectorAll('.svc-pick input:checked')].map((i) => i.value), doctor: view.querySelector('[data-doc]').value, priority: pri, notes: view.querySelector('[data-notes]').value }, user);
      toast(`SID ${v.sid} sent to the lab — ${v.ward} ${v.bed}. Charged to ${v.ipNo}.`); location.hash = `#/lab/visit/${v.id}`; } catch (e) { toast(e.message, 'error'); }
  };
  recent();
}
