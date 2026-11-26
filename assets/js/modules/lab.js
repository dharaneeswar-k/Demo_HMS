// Laboratory reagent kits (BRD 06): kit stock, receipts, QC / wastage use, physical counts and
// "kits used vs tests billed" reconciliation. Sample work happens in ./lab/ (workbench and SID page).
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


