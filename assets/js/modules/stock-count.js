// Daily Stock Count — count what is physically on the shelf and compare it with the system.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { medName, userName } from '../calculations.js';
import { businessDate } from '../pharmacy-calc.js';
import { countRow, suggestedMedicines, countForDate, submitStockCount, reviewStockCount } from '../stock-count.js';
import { badge, tabs, emptyState, openModal, confirmDialog, combo, dataTable } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, fmtDate, fmtDateTime, refreshIcons } from '../utils.js';

const diffCell = (d) => (d === 0 ? '<span class="sc-ok">' + icon('check') + 'Matches</span>' : d < 0 ? `<span class="sc-short">${icon('alert-triangle')}${-d} missing</span>` : `<span class="sc-extra">${d} extra</span>`);

export function render(view, params, query) {
  const user = currentUser();
  let tab = query.focus ? 'history' : 'today';
  view.innerHTML = `<p class="page-intro">Count the medicines on the shelf at the end of the day. <strong>Start of day − billed + received</strong> is what should be there — any shortfall shows stock that left the pharmacy without a bill.</p>
    <section class="card"><div data-tabs></div><div data-body></div></section>`;
  const body = view.querySelector('[data-body]');
  const draw = () => {
    const pending = store.all('stockCounts').filter((c) => c.status === 'SUBMITTED').length;
    tabs(view.querySelector('[data-tabs]'), [{ id: 'today', label: "Today's count", icon: 'clipboard-check' }, { id: 'history', label: 'History', icon: 'history', count: pending ? pending + ' to review' : null }], tab, (t) => { tab = t; draw(); });
    tab === 'today' ? today(body, user, draw) : history(body, user, query.focus);
    refreshIcons(view);
  };
  draw();
}

function today(host, user, redraw) {
  const date = businessDate();
  const done = countForDate(date);
  if (done) { host.innerHTML = `<div class="card-body">${resultView(done, user)}</div>`; wireResult(host, done, user, redraw); return; }
  if (!can('stockcount.do', user)) { host.innerHTML = emptyState('clipboard-check', 'Not counted yet today', 'Pharmacy staff submit the daily count at the end of the day.'); return; }
  let meds = suggestedMedicines(10);
  const counted = {};
  host.innerHTML = `<div class="card-body">
    <div class="row-between mb-2"><div><h3 style="font-size:15px">Count for ${fmtDate(date)}</h3><p class="muted small">Suggested: the medicines that sell most. Add any other medicine you want to check.</p></div>
      <div class="row"><div data-add style="width:300px"></div></div></div>
    <div class="table-scroll"><table class="table sc-table"><thead><tr><th>Medicine</th><th class="ta-right">Start of day</th><th class="ta-right">Received today</th><th class="ta-right">Billed today</th><th class="ta-right">Other changes</th><th class="ta-right">Should be on shelf</th><th style="width:150px">Counted on shelf</th><th>Result</th><th></th></tr></thead><tbody data-rows></tbody></table></div>
    <div class="sc-summary" data-sum></div>
    <div class="field mt-2"><label>Remarks <span class="muted small">(required if anything does not match)</span></label><textarea class="input" rows="2" data-remarks placeholder="e.g. Counted twice with the manager present"></textarea></div>
    <div class="row mt-2" style="justify-content:flex-end"><button class="btn btn-primary btn-lg" data-submit>${icon('send')}Submit count to owner</button></div></div>`;
  const rowsEl = host.querySelector('[data-rows]');
  const drawRows = () => {
    rowsEl.innerHTML = meds.map((id) => { const r = countRow(id, date); const m = store.get('medicines', id); const c = counted[id];
      return `<tr data-id="${id}"><td><div class="cell-main">${esc(m.brandName)}</div><div class="cell-sub">${esc(m.strength)} · ${esc(m.unit)}</div></td>
        <td class="ta-right">${fmtNum(r.opening)}</td><td class="ta-right">${r.received ? '+' + fmtNum(r.received) : '—'}</td><td class="ta-right">${r.billed ? '−' + fmtNum(r.billed) : '—'}</td>
        <td class="ta-right">${r.otherNet ? (r.otherNet > 0 ? '+' : '') + fmtNum(r.otherNet) : '—'}</td><td class="ta-right strong">${fmtNum(r.expected)}</td>
        <td><input class="input ta-right" type="number" min="0" step="1" data-c value="${c ?? ''}" placeholder="Count"></td><td data-res>${c === undefined || c === '' ? '<span class="muted small">—</span>' : diffCell(Number(c) - r.expected)}</td>
        <td><button class="btn btn-ghost btn-sm" data-rm title="Remove">${icon('x')}</button></td></tr>`; }).join('');
    refreshIcons(rowsEl); sum();
  };
  const sum = () => {
    let entered = 0; let short = 0; let extra = 0; let value = 0;
    meds.forEach((id) => { const c = counted[id]; if (c === undefined || c === '') return; entered++; const r = countRow(id, date); const d = Number(c) - r.expected; if (d < 0) short += -d; if (d > 0) extra += d; value += d * r.avgPtr; });
    host.querySelector('[data-sum]').innerHTML = `<div><span>Counted</span><strong>${entered} / ${meds.length}</strong></div><div><span>Missing units</span><strong class="${short ? 'text-danger' : ''}">${short}</strong></div><div><span>Extra units</span><strong>${extra}</strong></div><div><span>Value difference</span><strong class="${value < 0 ? 'text-danger' : ''}">${fmtINR(value)}</strong></div>`;
  };
  rowsEl.addEventListener('input', (e) => { const tr = e.target.closest('tr[data-id]'); if (!tr || !e.target.matches('[data-c]')) return; counted[tr.dataset.id] = e.target.value; const r = countRow(tr.dataset.id, date); tr.querySelector('[data-res]').innerHTML = e.target.value === '' ? '<span class="muted small">—</span>' : diffCell(Number(e.target.value) - r.expected); refreshIcons(tr); sum(); });
  rowsEl.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && e.target.closest('[data-rm]')) { meds = meds.filter((x) => x !== tr.dataset.id); delete counted[tr.dataset.id]; drawRows(); } });
  combo(host.querySelector('[data-add]'), { options: () => store.all('medicines').filter((m) => m.active && !meds.includes(m.id)).map((m) => ({ value: m.id, label: m.brandName, sub: `${m.genericName} · ${m.code}`, keywords: m.barcode })), placeholder: 'Add a medicine to count…', onChange: (v) => { meds.push(v); drawRows(); } });
  host.querySelector('[data-submit]').onclick = async () => {
    const missing = meds.filter((id) => counted[id] === undefined || counted[id] === '');
    if (missing.length) { toast(`Enter the count for ${missing.length} medicine(s) — e.g. ${medName(missing[0])}.`, 'error'); return; }
    const short = meds.filter((id) => Number(counted[id]) < countRow(id, date).expected).length;
    if (!(await confirmDialog({ title: 'Submit today’s stock count?', iconName: 'clipboard-check', confirmLabel: 'Submit count', message: short ? `<strong>${short} medicine(s) are short</strong>. The owner will be alerted immediately.` : 'All counted medicines match the system. The owner will be informed.' }))) return;
    try { submitStockCount({ items: meds.map((id) => ({ medicineId: id, counted: counted[id] })), remarks: host.querySelector('[data-remarks]').value }, user); toast(short ? 'Count submitted. Shortage reported to the owner.' : 'Count submitted. Everything matched.', short ? 'warning' : 'success'); redraw(); } catch (e) { toast(e.message, 'error'); }
  };
  drawRows();
}

function resultView(c, user) {
  const t = c.totals;
  return `<div class="sc-banner ${t.shortItems ? 'bad' : 'good'}">${icon(t.shortItems ? 'alert-octagon' : 'check-circle-2')}<div><strong>${t.shortItems ? `${t.shortUnits} unit(s) missing across ${t.shortItems} medicine(s)` : 'Shelf stock matches the system'}</strong>
      <span>Counted by ${esc(userName(c.countedBy))} on ${fmtDateTime(c.countedAt)} · ${t.medicines} medicines · ${badge(c.status === 'REVIEWED' ? 'RESOLVED' : 'OPEN', c.status === 'REVIEWED' ? 'Reviewed' : 'Waiting for owner review')}</span></div></div>
    <div class="table-scroll mt-2"><table class="table dense"><thead><tr><th>Medicine</th><th class="ta-right">Start of day</th><th class="ta-right">Received</th><th class="ta-right">Billed</th><th class="ta-right">Should be</th><th class="ta-right">Counted</th><th>Result</th><th class="ta-right">Value</th>${can('adjustment.request', user) ? '<th></th>' : ''}</tr></thead><tbody>
    ${c.items.map((x) => `<tr class="${x.difference < 0 ? 'row-danger' : ''}"><td class="cell-main">${esc(medName(x.medicineId))}</td><td class="ta-right">${fmtNum(x.opening)}</td><td class="ta-right">${x.received || '—'}</td><td class="ta-right">${x.billed || '—'}</td><td class="ta-right strong">${fmtNum(x.expected)}</td><td class="ta-right strong">${fmtNum(x.counted)}</td><td>${diffCell(x.difference)}</td><td class="ta-right ${x.valueDifference < 0 ? 'text-danger' : ''}">${x.valueDifference ? fmtINR(x.valueDifference) : '—'}</td>
      ${can('adjustment.request', user) ? `<td>${x.difference ? `<a class="btn btn-ghost btn-sm" href="#/adjustments?new=1&med=${x.medicineId}">Correct stock</a>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    ${c.remarks ? `<p class="mt-2"><strong>Remarks:</strong> ${esc(c.remarks)}</p>` : ''}
    ${c.reviewNote ? `<div class="alert alert-teal mt-2">${icon('shield-check')}<div><strong>Owner review</strong> by ${esc(userName(c.reviewedBy))}, ${fmtDateTime(c.reviewedAt)}: ${esc(c.reviewNote)}</div></div>` : ''}
    ${c.status === 'SUBMITTED' && can('stockcount.review', user) ? `<div class="row mt-2" style="justify-content:flex-end"><button class="btn btn-primary" data-review>${icon('shield-check')}Mark as reviewed</button></div>` : ''}`;
}
function wireResult(host, c, user, done) {
  host.querySelector('[data-review]')?.addEventListener('click', async () => {
    const r = await confirmDialog({ title: 'Mark count as reviewed', reason: true, reasonLabel: 'Review note', reasonPlaceholder: 'e.g. Recounted with manager; shortage written off and staff counselled', confirmLabel: 'Save review', iconName: 'shield-check' });
    if (!r) return; try { reviewStockCount(c.id, r.reason, user); toast('Stock count reviewed.'); done(); } catch (e) { toast(e.message, 'error'); }
  });
}

function history(host, user, focus) {
  host.innerHTML = '<div data-t></div>';
  const show = (c) => { const m = openModal({ title: `Stock count — ${fmtDate(c.businessDate)}`, subtitle: c.id, size: 'xl', body: resultView(c, user), footer: [{ label: 'Close', cls: 'btn-primary', onClick: (x) => x() }] }); wireResult(m.el, c, user, () => { m.close(); history(host, user); }); };
  const t = dataTable({ rows: store.all('stockCounts'), pageSize: 15, sort: { key: 'businessDate', dir: 'desc' }, onRowClick: show, rowClass: (c) => (c.totals.shortItems ? 'row-danger' : ''), empty: emptyState('clipboard-check', 'No stock counts yet'),
    columns: [
      { key: 'businessDate', label: 'Date', render: (c) => `<strong>${fmtDate(c.businessDate)}</strong>` },
      { key: 'countedBy', label: 'Counted by', value: (c) => userName(c.countedBy), render: (c) => esc(userName(c.countedBy)) },
      { key: 'meds', label: 'Medicines', align: 'right', value: (c) => c.totals.medicines, render: (c) => c.totals.medicines },
      { key: 'matched', label: 'Matched', align: 'right', value: (c) => c.totals.matched, render: (c) => c.totals.matched },
      { key: 'short', label: 'Missing units', align: 'right', value: (c) => c.totals.shortUnits, render: (c) => (c.totals.shortUnits ? `<strong class="text-danger">${c.totals.shortUnits}</strong>` : '0') },
      { key: 'value', label: 'Value difference', align: 'right', value: (c) => c.totals.valueDifference, render: (c) => (c.totals.valueDifference ? `<span class="text-danger">${fmtINR(c.totals.valueDifference)}</span>` : '—') },
      { key: 'status', label: 'Status', render: (c) => (c.status === 'REVIEWED' ? badge('RESOLVED', c.totals.shortItems ? 'Reviewed' : 'Matched') : badge('OPEN', 'Waiting for review')) }
    ] });
  host.querySelector('[data-t]').appendChild(t.el);
  if (focus && store.get('stockCounts', focus)) show(store.get('stockCounts', focus));
}
