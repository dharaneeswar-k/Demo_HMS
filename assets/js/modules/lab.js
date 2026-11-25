// Laboratory (BRD 06): worklist driven by paid / approved bills only — sample collection with accession barcode,
// rejection & recollection, result entry with automatic H / L / critical flags, verification, branded report,
// and reagent-kit stock with "kits used vs tests billed" reconciliation.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { userName } from '../calculations.js';
import { svc, orderAccess, collectSample, rejectSample, enterResults, verifyReport, markPrinted, flagFor, refText, labParams, isCritical, kitBalance, kitStatus, receiveKits, recordKitUsage, submitKitCount, reviewKitCount, kitReconciliation, patientOf, hs } from '../hospital.js';
import { businessDate } from '../pharmacy-calc.js';
import { patientAge } from '../patients.js';
import { badge, dataTable, emptyState, openModal, confirmDialog, kpi, tabs, exportTable } from '../components.js';
import { toast } from '../notifications.js';
import { barcodeSVG } from '../barcode.js';
import { letterhead, docMeta, signBlock } from '../docs.js';
import { setMeta } from '../app.js';
import { esc, icon, fmtNum, fmtDate, fmtDateTime, relTime, refreshIcons, ymd } from '../utils.js';

const FLAG_TXT = { H: 'High', L: 'Low', HH: 'Critical high', LL: 'Critical low', A: 'Abnormal' };
const flagTag = (f) => (f ? `<span class="flag flag-${f.length === 2 ? 'crit' : f === 'A' ? 'abn' : f.toLowerCase()}">${f === 'A' ? '*' : f}</span>` : '');
const mins = (a, b = new Date().toISOString()) => Math.round((new Date(b) - new Date(a)) / 60000);
const ageTxt = (m) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${Math.floor(m / 1440)} d`);

export function renderWorklist(view, params, query) {
  const user = currentUser();
  const today = businessDate();
  const labOrders = () => store.all('orders').filter((o) => o.category === 'LAB' && o.billId);
  let tab = query.tab || 'collect';
  view.innerHTML = `<p class="page-intro">Tests appear here only after the main counter bills them. Payment is checked automatically — <strong>no cash is collected in the lab</strong>. Collect → enter results → verify → print.</p>
    <div class="kpis mb-2" data-k></div>
    <section class="card"><div class="row-between card-pad"><div data-tabs></div><div class="input-icon" style="width:280px">${icon('scan-barcode')}<input class="input" data-scan placeholder="Scan accession / search patient"></div></div><div data-list></div></section>`;
  const groups = () => {
    const all = labOrders(); const q = view.querySelector('[data-scan]').value.trim().toLowerCase();
    const m = (o) => !q || [o.accession, o.name, patientOf(o.patientId)?.name, patientOf(o.patientId)?.uhid].join(' ').toLowerCase().includes(q);
    return {
      collect: all.filter((o) => o.status === 'READY' && orderAccess(o).ok && m(o)),
      results: all.filter((o) => o.status === 'SAMPLE_COLLECTED' && m(o)),
      verify: all.filter((o) => o.status === 'RESULTED' && m(o)),
      hold: all.filter((o) => ['ON_HOLD', 'READY'].includes(o.status) && !orderAccess(o).ok && m(o)),
      done: all.filter((o) => o.status === 'COMPLETED' && businessDate(o.lab.verifiedAt) === today && m(o))
    };
  };
  const draw = () => {
    const g = groups();
    const tat = g.done.map((o) => mins(o.billedAt, o.lab.verifiedAt)); const avg = tat.length ? Math.round(tat.reduce((a, b) => a + b, 0) / tat.length) : 0;
    view.querySelector('[data-k]').innerHTML = `${kpi({ label: 'Waiting for sample', value: fmtNum(g.collect.length), iconName: 'test-tube', tone: g.collect.length ? 'warning' : 'success' })}
      ${kpi({ label: 'Results to enter', value: fmtNum(g.results.length), iconName: 'keyboard', tone: 'info' })}
      ${kpi({ label: 'To verify', value: fmtNum(g.verify.length), iconName: 'badge-check', tone: g.verify.length ? 'purple' : 'success', sub: g.verify.filter(isCritical).length ? `${g.verify.filter(isCritical).length} critical` : '' })}
      ${kpi({ label: 'Reports today', value: fmtNum(g.done.length), iconName: 'file-check-2', tone: 'teal', sub: avg ? `Avg turnaround ${ageTxt(avg)}` : '' })}`;
    tabs(view.querySelector('[data-tabs]'), [{ id: 'collect', label: 'Collect sample', icon: 'test-tube', count: g.collect.length }, { id: 'results', label: 'Enter results', icon: 'keyboard', count: g.results.length },
      { id: 'verify', label: 'Verify', icon: 'badge-check', count: g.verify.length }, { id: 'hold', label: 'Payment pending', icon: 'lock', count: g.hold.length }, { id: 'done', label: 'Done today', icon: 'check-check', count: g.done.length }], tab, (t) => { tab = t; draw(); });
    const rows = g[tab];
    view.querySelector('[data-list]').innerHTML = rows.length ? `<div class="work-list">${rows.sort((a, b) => a.billedAt.localeCompare(b.billedAt)).map((o) => {
      const p = patientOf(o.patientId); const a = orderAccess(o); const sv = svc(o.serviceId); const wait = mins(o.billedAt); const over = wait > sv.lab.tatHours * 60 && o.status !== 'COMPLETED';
      const act = tab === 'collect' ? `<button class="btn btn-primary btn-sm" data-collect="${o.id}">${icon('test-tube')}Collect</button>`
        : tab === 'results' ? `<a class="btn btn-primary btn-sm" href="#/lab/orders/${o.id}">${icon('keyboard')}Enter results</a>`
          : tab === 'verify' ? `<a class="btn btn-primary btn-sm" href="#/lab/orders/${o.id}">${icon('badge-check')}Review & verify</a>`
            : tab === 'done' ? `<a class="btn btn-secondary btn-sm" href="#/lab/report/${o.id}">${icon('printer')}Report</a>` : `<span class="muted small">Send patient to main counter</span>`;
      return `<div class="work-row ${isCritical(o) ? 'crit' : ''}"><div class="wr-code">${barcodeSVG(o.accession, { height: 26 })}<span class="mono">${o.accession}</span></div>
        <div class="wr-main"><strong>${esc(o.name)}</strong><span>${esc(p.name)} · <span class="mono">${esc(p.uhid)}</span> · ${esc(p.gender)}/${patientAge(p) ?? '—'}</span><small>${esc(sv.lab.sample)} · ${esc(o.doctor || 'No doctor')}${o.lab.rejected && o.status === 'READY' ? ` · <span class="text-danger">Recollect: ${esc(o.lab.rejected.reason)}</span>` : ''}${isCritical(o) ? ' · <span class="text-danger strong">CRITICAL VALUE</span>' : ''}</small></div>
        <div class="wr-meta"><span class="tag tag-${a.tone}">${a.label}</span><small class="${over ? 'text-danger' : 'muted'}">${icon('clock', 'ic-inline')} ${ageTxt(wait)}${over ? ' · over TAT' : ''}</small></div><div class="wr-act">${act}</div></div>`; }).join('')}</div>`
      : emptyState('check-circle-2', tab === 'hold' ? 'Nothing on hold' : 'Nothing waiting', tab === 'collect' ? 'New tests appear here as soon as they are billed.' : '');
    view.querySelectorAll('[data-collect]').forEach((b) => { b.onclick = () => openCollect(store.get('orders', b.dataset.collect), draw); });
    refreshIcons(view);
  };
  view.querySelector('[data-scan]').addEventListener('input', draw);
  view.querySelector('[data-scan]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const o = labOrders().find((x) => x.accession?.toLowerCase() === e.target.value.trim().toLowerCase()); if (o) location.hash = o.status === 'COMPLETED' ? `#/lab/report/${o.id}` : `#/lab/orders/${o.id}`; } });
  const unsub = store.subscribe(draw);
  draw();
  return () => unsub();
}

function openCollect(o, done) {
  const user = currentUser(); const p = patientOf(o.patientId); const sv = svc(o.serviceId);
  openModal({ title: 'Collect sample', subtitle: `${esc(o.name)} · ${esc(p.name)}`, size: 'sm',
    body: `<div class="sample-label">${barcodeSVG(o.accession, { height: 38 })}<strong class="mono">${o.accession}</strong><span>${esc(p.name)} · ${esc(p.uhid)}</span><span>${esc(sv.lab.sample)} · ${fmtDateTime(new Date())}</span></div>
      <ul class="check-list mt-2"><li>${icon('check')}Confirm the patient's name and Patient ID verbally</li><li>${icon('check')}Use a <strong>${esc(sv.lab.sample)}</strong> container</li><li>${icon('check')}Stick this label on the tube</li></ul>
      <p class="muted small mt-1">Kit stock is reduced when you confirm (${sv.lab.kits.map((k) => `${k.qty} × ${esc(store.get('labKits', k.kitId).name)}`).join(', ')}).</p>`,
    footer: [{ label: 'Reject sample…', cls: 'btn-ghost', onClick: async (c) => { c(); const r = await confirmDialog({ title: 'Reject / recollect', tone: 'danger', confirmLabel: 'Reject', reason: true, reasonLabel: 'Reason', reasonPlaceholder: 'Haemolysed, clotted, insufficient, wrong container, unlabelled…', message: 'The patient is asked to give a new sample.' }); if (!r) return; try { rejectSample(o.id, r.reason, user); toast('Sample rejected. Recollection pending.', 'warning'); done(); } catch (e) { toast(e.message, 'error'); } } },
      { label: 'Print label', icon: 'printer', onClick: () => window.print() },
      { label: 'Sample collected', cls: 'btn-primary', icon: 'check', onClick: (c) => { try { collectSample(o.id, user); c(); toast(`${o.accession} collected.`); done(); } catch (e) { toast(e.message, 'error'); } } }] });
}

export function renderOrder(view, params) {
  const user = currentUser();
  const o = store.get('orders', params.id);
  if (!o || o.category !== 'LAB') { view.innerHTML = emptyState('flask-conical', 'Lab order not found'); return; }
  setMeta({ title: `${o.name}`, crumbs: [{ label: 'Laboratory', href: '#/lab' }, o.accession] });
  const p = patientOf(o.patientId); const params2 = labParams(o); const vals = Object.fromEntries((o.lab.results || []).map((r) => [r.param, r.value]));
  const editable = ['SAMPLE_COLLECTED', 'RESULTED'].includes(o.status) && can('lab.work');
  const prev = store.all('orders').filter((x) => x.serviceId === o.serviceId && x.patientId === o.patientId && x.id !== o.id && x.status === 'COMPLETED').sort((a, b) => b.lab.verifiedAt.localeCompare(a.lab.verifiedAt))[0];
  const prevVal = (n) => prev?.lab.results.find((r) => r.param === n)?.value;
  view.innerHTML = `
    <div class="grid grid-3-1">
      <section class="card"><header class="card-head"><div><h2>${esc(o.name)}</h2><p class="muted small">${esc(svc(o.serviceId).lab.department)} · ${esc(o.lab.sampleType)} · collected ${o.lab.collectedAt ? fmtDateTime(o.lab.collectedAt) + ' by ' + esc(userName(o.lab.collectedBy)) : '—'}</p></div>${badge(o.status === 'COMPLETED' ? 'COMPLETED' : o.status === 'RESULTED' ? 'PENDING' : 'SUBMITTED', { SAMPLE_COLLECTED: 'Results to enter', RESULTED: 'Awaiting verification', COMPLETED: 'Verified' }[o.status] || o.status)}</header>
        <table class="table result-table"><thead><tr><th>Test parameter</th><th style="width:170px">Result</th><th>Unit</th><th>Reference range</th><th>Flag</th>${prev ? `<th class="muted">Previous (${fmtDate(prev.lab.verifiedAt)})</th>` : ''}</tr></thead><tbody>
          ${params2.map((q) => `<tr><td class="strong">${esc(q.name)}</td><td>${editable ? `<input class="input input-sm" data-r="${esc(q.name)}" value="${esc(vals[q.name] ?? '')}" ${q.ref !== undefined ? `list="dl-${esc(q.name.replace(/\W/g, ''))}"` : 'inputmode="decimal"'}>${q.ref !== undefined ? `<datalist id="dl-${esc(q.name.replace(/\W/g, ''))}"><option value="${esc(q.ref)}"></datalist>` : ''}` : `<strong>${esc(vals[q.name] ?? '—')}</strong>`}</td>
            <td class="muted">${esc(q.unit)}</td><td class="muted">${esc(refText(q))}</td><td data-flag="${esc(q.name)}">${flagTag(flagFor(q, vals[q.name]))}</td>${prev ? `<td class="muted">${esc(prevVal(q.name) ?? '—')}</td>` : ''}</tr>`).join('')}</tbody></table>
        <div class="card-body row" style="justify-content:flex-end">
          ${o.status === 'SAMPLE_COLLECTED' && can('lab.work') ? `<button class="btn btn-ghost" data-reject>${icon('x-circle')}Reject sample</button>` : ''}
          ${editable ? `<button class="btn btn-secondary" data-save>${icon('save')}Save results</button>` : ''}
          ${o.status === 'RESULTED' && can('lab.verify') ? `<button class="btn btn-primary" data-verify>${icon('badge-check')}Verify & release report</button>` : ''}
          ${o.status === 'COMPLETED' ? `<a class="btn btn-primary" href="#/lab/report/${o.id}">${icon('printer')}Print report</a>` : ''}</div></section>
      <div><section class="card"><div class="card-body"><div class="sample-label">${barcodeSVG(o.accession, { height: 32 })}<strong class="mono">${o.accession}</strong></div>
        <div class="kv mt-2"><span>Patient</span><a href="#/patients/${p.id}">${esc(p.name)}</a></div><div class="kv"><span>Patient ID</span><span class="mono">${esc(p.uhid)}</span></div><div class="kv"><span>Age / sex</span><span>${patientAge(p) ?? '—'} / ${esc(p.gender)}</span></div>
        <div class="kv"><span>Doctor</span><span>${esc(o.doctor || '—')}</span></div><div class="kv"><span>Bill</span><a class="mono" href="#/hbills/${o.billId}">${o.billId}</a></div><div class="kv"><span>Payment</span><span class="tag tag-${orderAccess(o).tone}">${orderAccess(o).label}</span></div>
        ${o.lab.enteredBy ? `<div class="kv"><span>Results by</span><span>${esc(userName(o.lab.enteredBy))}</span></div>` : ''}${o.lab.verifiedBy ? `<div class="kv"><span>Verified by</span><span>${esc(userName(o.lab.verifiedBy))}</span></div>` : ''}</div></section>
        ${p.allergies ? `<div class="alert alert-danger mt-2">${icon('alert-triangle')}<div>Allergy: ${esc(p.allergies)}</div></div>` : ''}</div></div>`;
  const read = () => Object.fromEntries([...view.querySelectorAll('[data-r]')].map((i) => [i.dataset.r, i.value]));
  view.querySelectorAll('[data-r]').forEach((i) => i.addEventListener('input', () => { const q = params2.find((x) => x.name === i.dataset.r); view.querySelector(`[data-flag="${CSS.escape(i.dataset.r)}"]`).innerHTML = flagTag(flagFor(q, i.value)); }));
  view.querySelector('[data-save]')?.addEventListener('click', () => { try { enterResults(o.id, read(), user); toast(isCritical(o) ? 'Saved. CRITICAL value — the doctor and owner have been alerted.' : 'Results saved. Ready for verification.', isCritical(o) ? 'warning' : 'success'); renderOrder(view, params); } catch (e) { toast(e.message, 'error'); } });
  view.querySelector('[data-verify]')?.addEventListener('click', async () => { if (!(await confirmDialog({ title: 'Verify and release this report?', iconName: 'badge-check', confirmLabel: 'Verify & release', message: 'Once verified the report is final, gets a report number and is added to the patient\'s history.' }))) return; try { verifyReport(o.id, user); toast('Report released.'); location.hash = `#/lab/report/${o.id}`; } catch (e) { toast(e.message, 'error'); } });
  view.querySelector('[data-reject]')?.addEventListener('click', async () => { const r = await confirmDialog({ title: 'Reject sample', tone: 'danger', confirmLabel: 'Reject', reason: true, reasonLabel: 'Reason', message: 'The kit used is logged as a repeat and the patient is asked for a new sample.' }); if (!r) return; try { rejectSample(o.id, r.reason, user); toast('Sample rejected.', 'warning'); location.hash = '#/lab'; } catch (e) { toast(e.message, 'error'); } });
  refreshIcons(view);
}

export function renderReport(view, params) {
  const o = store.get('orders', params.id);
  if (!o || o.status !== 'COMPLETED' || !o.lab) { view.innerHTML = emptyState('file-x', 'Report not available', 'The report is printed only after verification.'); return; }
  setMeta({ title: o.lab.reportNo, crumbs: [{ label: 'Laboratory', href: '#/lab' }, 'Report'] });
  const p = patientOf(o.patientId); const sv = svc(o.serviceId);
  view.innerHTML = `<div class="row mb-2 no-print" style="justify-content:center"><button class="btn btn-primary" data-print>${icon('printer')}Print / Save PDF</button><a class="btn btn-ghost" href="#/lab">${icon('arrow-left')}Worklist</a><a class="btn btn-ghost" href="#/patients/${p.id}">${icon('user-round')}Patient</a></div>
    <article class="doc">${letterhead('LABORATORY REPORT', { sub: sv.lab.department, code: o.accession })}
      ${docMeta([['Patient', esc(p.name)], ['Patient ID', `<span class="mono">${esc(p.uhid)}</span>`], ['Age / Sex', `${patientAge(p) ?? '—'} Y / ${esc(p.gender)}`], ['Referred by', esc(o.doctor || 'Self')],
        ['Sample', esc(o.lab.sampleType)], ['Collected', fmtDateTime(o.lab.collectedAt)], ['Reported', fmtDateTime(o.lab.verifiedAt)], ['Report no', `<span class="mono">${esc(o.lab.reportNo)}</span>`]])}
      <h3 class="doc-h">${esc(sv.name)}</h3>
      <table class="rc-table lab-rep"><thead><tr><th>Investigation</th><th>Result</th><th>Unit</th><th>Biological reference interval</th></tr></thead><tbody>
        ${labParams(o).map((q) => { const v = o.lab.results.find((r) => r.param === q.name)?.value; const f = flagFor(q, v); return `<tr class="${f ? 'abn' : ''}"><td>${esc(q.name)}</td><td><strong>${esc(v ?? '—')}</strong> ${f ? `<span class="rep-flag">${f === 'A' ? '*' : f}${f.length === 2 ? ' (critical)' : ''}</span>` : ''}</td><td>${esc(q.unit)}</td><td>${esc(refText(q))}</td></tr>`; }).join('')}</tbody></table>
      <p class="rc-small mt-2" style="text-align:left">H = above range · L = below range · HH / LL = critical · * = abnormal finding. Results relate only to the sample received. Please correlate clinically.</p>
      ${signBlock([['Lab technician', userName(o.lab.enteredBy)], ['Verified by', userName(o.lab.verifiedBy)]])}
      <p class="rc-thanks">— End of report —</p></article>`;
  view.querySelector('[data-print]').onclick = () => { markPrinted(o.id); window.print(); };
  refreshIcons(view);
}

export function renderReports(view) {
  const rows = () => store.all('orders').filter((o) => o.category === 'LAB' && o.status === 'COMPLETED').sort((a, b) => b.lab.verifiedAt.localeCompare(a.lab.verifiedAt));
  view.innerHTML = `<section class="card"><div class="toolbar"><div class="input-icon grow">${icon('search')}<input class="input" data-q placeholder="Patient, Patient ID, accession or report no"></div><input type="date" class="input" data-from><input type="date" class="input" data-to></div><div data-t></div></section>`;
  const t = dataTable({ rows: rows(), pageSize: 15, onRowClick: (o) => { location.hash = `#/lab/report/${o.id}`; }, columns: [
    { key: 'reportNo', label: 'Report', value: (o) => o.lab.reportNo, render: (o) => `<span class="mono strong">${o.lab.reportNo}</span><div class="cell-sub mono">${o.accession}</div>` },
    { key: 'verifiedAt', label: 'Reported', value: (o) => o.lab.verifiedAt, render: (o) => fmtDateTime(o.lab.verifiedAt) },
    { key: 'patient', label: 'Patient', value: (o) => patientOf(o.patientId)?.name, render: (o) => `${esc(patientOf(o.patientId)?.name)}<div class="cell-sub mono">${esc(patientOf(o.patientId)?.uhid)}</div>` },
    { key: 'name', label: 'Test' }, { key: 'doctor', label: 'Doctor' },
    { key: 'flags', label: 'Findings', sortable: false, render: (o) => { const n = labParams(o).filter((q) => flagFor(q, o.lab.results.find((r) => r.param === q.name)?.value)).length; return isCritical(o) ? '<span class="tag tag-danger">Critical</span>' : n ? `<span class="tag tag-warning">${n} abnormal</span>` : '<span class="tag tag-success">Normal</span>'; } },
    { key: 'print', label: 'Printed', align: 'right', value: (o) => o.lab.printCount, render: (o) => fmtNum(o.lab.printCount || 0) }] });
  view.querySelector('[data-t]').appendChild(t.el);
  const apply = () => { const q = view.querySelector('[data-q]').value.trim().toLowerCase(); const f = view.querySelector('[data-from]').value; const to = view.querySelector('[data-to]').value;
    t.setRows(rows().filter((o) => (!q || [o.accession, o.lab.reportNo, o.name, patientOf(o.patientId)?.name, patientOf(o.patientId)?.uhid].join(' ').toLowerCase().includes(q)) && (!f || businessDate(o.lab.verifiedAt) >= f) && (!to || businessDate(o.lab.verifiedAt) <= to))); };
  view.querySelectorAll('input').forEach((i) => i.addEventListener('input', apply));
  refreshIcons(view);
}

// ---------------- reagent kits ----------------
const MV_LABEL = { RECEIVED: 'Received', USED_TEST: 'Used for test', USED_QC: 'Quality control', REPEAT: 'Repeat test', WASTAGE: 'Wastage', COUNT_ADJUST: 'Count adjustment' };
export function renderKits(view, params, query) {
  const user = currentUser();
  let tab = query.tab || 'stock';
  const from0 = ymd(new Date(Date.now() - 6 * 86400000)); let from = from0; let to = ymd();
  view.innerHTML = `<p class="page-intro">Every test uses reagent. If more kits are used than tests billed, a test was run without a bill — the reconciliation shows it, and the daily physical count confirms it.</p>
    <div class="kpis mb-2" data-k></div><section class="card"><div class="row-between card-pad"><div data-tabs></div><div class="row" data-acts></div></div><div data-body></div></section>`;
  const draw = () => {
    const kits = store.all('labKits').filter((k) => k.active);
    const rec = kitReconciliation(from, to);
    const unexpl = rec.reduce((t, r) => t + Math.max(0, r.unexplained) + r.countLoss, 0);
    const openCount = store.all('kitCounts').filter((c) => c.status === 'SUBMITTED');
    view.querySelector('[data-k]').innerHTML = `${kpi({ label: 'Kits low / out', value: fmtNum(kits.filter((k) => kitStatus(k) !== 'IN_STOCK').length), iconName: 'package-x', tone: kits.some((k) => kitStatus(k) !== 'IN_STOCK') ? 'warning' : 'success' })}
      ${kpi({ label: 'Tests billed (7 days)', value: fmtNum(rec.reduce((t, r) => t + r.billed, 0)), iconName: 'receipt', tone: 'teal' })}
      ${kpi({ label: 'Kits not matched to a bill', value: fmtNum(unexpl), iconName: 'alert-octagon', tone: unexpl ? 'danger' : 'success', sub: 'Count shortages + unexplained use' })}
      ${kpi({ label: 'Kit efficiency', value: (rec.reduce((t, r) => t + r.total, 0) ? Math.round(rec.reduce((t, r) => t + r.performed, 0) / rec.reduce((t, r) => t + r.total, 0) * 100) : 100) + '%', iconName: 'gauge', tone: 'info', sub: 'Billable tests ÷ kits consumed' })}`;
    tabs(view.querySelector('[data-tabs]'), [{ id: 'stock', label: 'Kit stock', icon: 'boxes' }, { id: 'recon', label: 'Kits vs tests billed', icon: 'scale' }, { id: 'count', label: 'Physical counts', icon: 'clipboard-check', count: openCount.length || null }, { id: 'ledger', label: 'Kit ledger', icon: 'list' }], tab, (t) => { tab = t; draw(); });
    const acts = view.querySelector('[data-acts]'); const body = view.querySelector('[data-body]');
    acts.innerHTML = can('lab.kits') ? `<button class="btn btn-secondary btn-sm" data-usage>${icon('minus-circle')}Record QC / repeat / wastage</button><button class="btn btn-secondary btn-sm" data-count>${icon('clipboard-check')}Count kits</button><button class="btn btn-primary btn-sm" data-receive>${icon('package-plus')}Receive kits</button>` : '';
    if (tab === 'stock') {
      body.innerHTML = '<div data-t></div>';
      const t = dataTable({ rows: kits, pageSize: 25, columns: [{ key: 'name', label: 'Kit / reagent', render: (k) => `<strong>${esc(k.name)}</strong><div class="cell-sub">${store.all('services').filter((s) => s.lab?.kits.some((x) => x.kitId === k.id)).map((s) => s.code).join(', ')}</div>` },
        { key: 'bal', label: 'In stock', align: 'right', value: (k) => kitBalance(k.id), render: (k) => `<strong>${fmtNum(kitBalance(k.id))}</strong> <span class="muted small">${esc(k.unit)}s</span>` }, { key: 'reorderLevel', label: 'Reorder at', align: 'right' },
        { key: 'st', label: 'Status', value: (k) => kitStatus(k), render: (k) => badge(kitStatus(k)) }] });
      body.querySelector('[data-t]').appendChild(t.el);
    } else if (tab === 'recon') {
      body.innerHTML = `<div class="toolbar"><label class="small">From <input type="date" class="input" data-from value="${from}"></label><label class="small">To <input type="date" class="input" data-to value="${to}"></label><button class="btn btn-secondary btn-sm" data-csv>${icon('download')}CSV</button></div>
        <div class="table-scroll"><table class="table"><thead><tr><th>Kit</th><th class="ta-right">Tests billed</th><th class="ta-right">Tests run</th><th class="ta-right">Kits used for tests</th><th class="ta-right">QC</th><th class="ta-right">Repeats</th><th class="ta-right">Wastage</th><th class="ta-right">Count shortage</th><th class="ta-right">Not matched to a bill</th><th class="ta-right">Efficiency</th></tr></thead><tbody>
        ${rec.map((r) => `<tr class="${r.unexplained > 0 || r.countLoss > 0 ? 'row-danger' : ''}"><td><strong>${esc(r.kit.name)}</strong><div class="cell-sub">${esc(r.tests)}</div></td><td class="ta-right">${r.billed}</td><td class="ta-right">${r.performed}</td><td class="ta-right">${r.used}</td><td class="ta-right">${r.qc || '—'}</td><td class="ta-right">${r.repeat || '—'}</td><td class="ta-right">${r.waste || '—'}</td><td class="ta-right ${r.countLoss > 0 ? 'text-danger strong' : ''}">${r.countLoss || '—'}</td><td class="ta-right ${r.unexplained > 0 ? 'text-danger strong' : ''}">${r.unexplained > 0 ? r.unexplained : '—'}</td><td class="ta-right">${r.efficiency}%</td></tr>`).join('')}</tbody></table></div>
        <p class="muted small card-pad">Tests run should equal kits used for tests. QC, repeats and wastage are logged with a reason. A shortage in the physical count means kits went somewhere without a bill.</p>`;
      body.querySelector('[data-from]').onchange = (e) => { from = e.target.value; draw(); }; body.querySelector('[data-to]').onchange = (e) => { to = e.target.value; draw(); };
      body.querySelector('[data-csv]').onclick = () => exportTable(`lab-kit-reconciliation-${from}-${to}.csv`, [{ label: 'Kit', csv: (r) => r.kit.name }, ...['billed', 'performed', 'used', 'qc', 'repeat', 'waste', 'countLoss', 'unexplained', 'efficiency'].map((k) => ({ label: k, key: k }))], rec);
    } else if (tab === 'count') {
      const cs = store.all('kitCounts').slice().sort((a, b) => b.at.localeCompare(a.at));
      body.innerHTML = cs.length ? `<div class="todo-list">${cs.map((c) => { const short = c.lines.filter((l) => l.diff < 0); return `<div class="todo"><span class="todo-ic sev-${short.length ? 'critical' : 'success'}">${icon(short.length ? 'clipboard-x' : 'clipboard-check')}</span><span class="todo-txt"><strong>${fmtDate(c.businessDate)} · ${short.length ? short.map((l) => `${esc(store.get('labKits', l.kitId).name)} ${l.diff}`).join(', ') : 'All kits matched'}</strong><small>Counted by ${esc(userName(c.countedBy))} · ${fmtDateTime(c.at)}${c.reviewNote ? ' · Owner: ' + esc(c.reviewNote) : ''}</small></span>${c.status === 'SUBMITTED' && can('credit.approve') ? `<button class="btn btn-primary btn-sm" data-review="${c.id}">Review</button>` : badge(c.status === 'REVIEWED' ? 'RESOLVED' : c.status === 'MATCHED' ? 'COMPLETED' : 'PENDING', c.status === 'MATCHED' ? 'Matched' : c.status === 'REVIEWED' ? 'Reviewed' : 'Waiting for owner')}</div>`; }).join('')}</div>` : emptyState('clipboard-check', 'No counts yet');
      body.querySelectorAll('[data-review]').forEach((b) => { b.onclick = async () => { const r = await confirmDialog({ title: 'Review kit shortage', reason: true, reasonLabel: 'What did you find?', confirmLabel: 'Mark reviewed', message: 'Record the explanation. The stock has already been corrected to the physical count.' }); if (!r) return; reviewKitCount(b.dataset.review, r.reason, user); toast('Reviewed.'); draw(); }; });
    } else {
      body.innerHTML = '<div data-t></div>';
      const t = dataTable({ rows: store.all('kitMovements').slice(), pageSize: 20, sort: { key: 'at', dir: 'desc' }, columns: [{ key: 'at', label: 'Date', render: (m) => fmtDateTime(m.at) }, { key: 'kit', label: 'Kit', value: (m) => store.get('labKits', m.kitId)?.name, render: (m) => esc(store.get('labKits', m.kitId)?.name) },
        { key: 'type', label: 'Type', render: (m) => `<span class="tag tag-${m.qty > 0 ? 'success' : m.type === 'USED_TEST' ? 'info' : m.type === 'COUNT_ADJUST' ? 'danger' : 'warning'}">${MV_LABEL[m.type]}</span>` }, { key: 'qty', label: 'Qty', align: 'right', render: (m) => `<strong>${m.qty > 0 ? '+' : ''}${m.qty}</strong>` },
        { key: 'ref', label: 'Reference', render: (m) => `<span class="mono small">${esc(m.ref)}</span>` }, { key: 'note', label: 'Note', render: (m) => `<span class="small">${esc(m.note || '')}</span>` }, { key: 'by', label: 'By', value: (m) => userName(m.by), render: (m) => esc(userName(m.by)) }] });
      body.querySelector('[data-t]').appendChild(t.el);
    }
    const kitOpts = kits.map((k) => `<option value="${k.id}">${esc(k.name)} (${kitBalance(k.id)})</option>`).join('');
    acts.querySelector('[data-receive]')?.addEventListener('click', () => openModal({ title: 'Receive reagent kits', size: 'sm', body: `<div class="field"><label>Kit</label><select class="input" data-k>${kitOpts}</select></div><div class="form-grid mt-1"><div class="field col-4"><label>Quantity (tests)</label><input class="input" type="number" min="1" data-q></div><div class="field col-4"><label>Lot no</label><input class="input" data-l></div><div class="field col-4"><label>Expiry</label><input class="input" type="date" data-e></div></div>`,
      footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Add to stock', cls: 'btn-primary', onClick: (c, w) => { try { receiveKits({ kitId: w.querySelector('[data-k]').value, qty: w.querySelector('[data-q]').value, lot: w.querySelector('[data-l]').value, expiry: w.querySelector('[data-e]').value }, user); c(); toast('Kits added.'); draw(); } catch (e) { toast(e.message, 'error'); } } }] }));
    acts.querySelector('[data-usage]')?.addEventListener('click', () => openModal({ title: 'Record kit use without a patient test', size: 'sm', body: `<div class="field"><label>Kit</label><select class="input" data-k>${kitOpts}</select></div><div class="form-grid mt-1"><div class="field col-6"><label>Type</label><select class="input" data-t><option value="USED_QC">Quality control</option><option value="REPEAT">Repeat test</option><option value="WASTAGE">Wastage / damaged</option></select></div><div class="field col-6"><label>Quantity</label><input class="input" type="number" min="1" data-q value="1"></div></div><div class="field mt-1"><label>Reason</label><input class="input" data-n placeholder="e.g. QC level 1 & 2, haemolysed sample, card damaged"></div>`,
      footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Record', cls: 'btn-primary', onClick: (c, w) => { try { recordKitUsage({ kitId: w.querySelector('[data-k]').value, type: w.querySelector('[data-t]').value, qty: w.querySelector('[data-q]').value, note: w.querySelector('[data-n]').value }, user); c(); toast('Recorded.'); draw(); } catch (e) { toast(e.message, 'error'); } } }] }));
    acts.querySelector('[data-count]')?.addEventListener('click', () => openModal({ title: 'Physical kit count', subtitle: 'Count what is on the shelf / in the analyser', size: 'md', body: `<table class="table dense"><thead><tr><th>Kit</th><th class="ta-right">System</th><th style="width:120px">Counted</th></tr></thead><tbody>${kits.map((k) => `<tr><td>${esc(k.name)}</td><td class="ta-right muted">${kitBalance(k.id)}</td><td><input class="input input-sm" type="number" min="0" data-c="${k.id}"></td></tr>`).join('')}</tbody></table><p class="muted small mt-1">Leave blank to skip a kit. Shortages alert the owner and the stock is set to the counted quantity.</p>`,
      footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Submit count', cls: 'btn-primary', onClick: (c, w) => { try { const res = submitKitCount(Object.fromEntries([...w.querySelectorAll('[data-c]')].map((i) => [i.dataset.c, i.value])), user); c(); toast(res.status === 'MATCHED' ? 'All kits matched.' : 'Shortage reported to the owner.', res.status === 'MATCHED' ? 'success' : 'warning'); tab = 'count'; draw(); } catch (e) { toast(e.message, 'error'); } } }] }));
    refreshIcons(view);
  };
  draw();
}

export function render(view, params, query) { return renderWorklist(view, params, query); }
