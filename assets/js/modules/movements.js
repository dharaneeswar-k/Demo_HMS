// Stock Movements — the ledger is the source of truth for every quantity in the system.
import { store } from '../data-service.js';
import { ledger, medName, userName, locationName, MOVEMENT_TYPES } from '../calculations.js';
import { dataTable, exportTable, movementBadge, emptyState, kpi } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtNum, fmtDateTime, ymd, debounce, titleCase } from '../utils.js';
import { refLink } from './inventory.js';

export function render(view, params, query) {
  const rows = ledger();
  view.innerHTML = `
    <div class="page-head"><div><p class="muted">Every stock change is a movement. Balances are never overwritten — they are the running sum of this ledger.</p></div>
      <div class="page-actions"><button class="btn btn-secondary" data-export>${icon('download')}Export CSV</button></div></div>
    <div class="kpis mb-2" data-kpis></div>
    <section class="card"><div class="toolbar">
      <div class="search">${icon('search')}<input class="input" type="search" placeholder="Reference number or reason…" data-f="q"></div>
      <select class="input" data-f="med"><option value="">All medicines</option>${[...store.all('medicines')].sort((a, b) => a.brandName.localeCompare(b.brandName)).map((m) => `<option value="${m.id}">${esc(m.brandName)}</option>`).join('')}</select>
      <select class="input" data-f="batch"><option value="">All batches</option></select>
      <select class="input" data-f="type"><option value="">All movement types</option>${MOVEMENT_TYPES.map((t) => `<option value="${t}">${titleCase(t)}</option>`).join('')}</select>
      <select class="input" data-f="user"><option value="">All users</option>${store.all('users').map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
      <span class="filter-label">From</span><input type="date" class="input" data-f="from"><span class="filter-label">To</span><input type="date" class="input" data-f="to">
      <button class="btn btn-ghost btn-sm" data-clear>${icon('x')}Clear</button>
    </div><div data-table></div></section>`;
  const columns = [
    { key: 'id', label: 'Movement ID', render: (x) => `<span class="mono">${x.id}</span>` },
    { key: 'at', label: 'Date & Time', render: (x) => fmtDateTime(x.at), csv: (x) => fmtDateTime(x.at) },
    { key: 'med', label: 'Medicine', value: (x) => medName(x.medicineId), render: (x) => `<a class="cell-main" href="#/inventory/${x.medicineId}">${esc(medName(x.medicineId))}</a>` },
    { key: 'batch', label: 'Batch', value: (x) => store.get('batches', x.batchId)?.batchNo, render: (x) => `<a class="mono" href="#/batches/${x.batchId}">${esc(store.get('batches', x.batchId)?.batchNo)}</a>` },
    { key: 'type', label: 'Movement Type', render: (x) => movementBadge(x.type) },
    { key: 'qtyIn', label: 'Qty In', align: 'right', render: (x) => (x.qtyIn ? `<span class="text-success strong">+${fmtNum(x.qtyIn)}</span>` : '') },
    { key: 'qtyOut', label: 'Qty Out', align: 'right', render: (x) => (x.qtyOut ? `<span class="text-danger strong">−${fmtNum(x.qtyOut)}</span>` : '') },
    { key: 'prevBalance', label: 'Previous Balance', align: 'right', render: (x) => fmtNum(x.prevBalance) },
    { key: 'newBalance', label: 'New Balance', align: 'right', render: (x) => `<strong>${fmtNum(x.newBalance)}</strong>` },
    { key: 'reference', label: 'Reference No.', render: (x) => refLink(x.reference) },
    { key: 'user', label: 'Performed By', value: (x) => userName(x.userId), render: (x) => esc(userName(x.userId)) },
    { key: 'reason', label: 'Reason', render: (x) => `<span class="cell-sub">${esc(x.reason)}</span>` },
    { key: 'loc', label: 'Location', value: (x) => locationName(x.locationId), render: (x) => `<span class="cell-sub">${esc(locationName(x.locationId))}</span>` }
  ];
  const table = dataTable({ columns, pageSize: 25, sort: { key: 'at', dir: 'desc' }, empty: emptyState('arrow-left-right', 'No movements match the filters'), dense: true });
  view.querySelector('[data-table]').appendChild(table.el);
  const f = (n) => view.querySelector(`[data-f="${n}"]`);
  const fillBatches = () => {
    const med = f('med').value; const cur = f('batch').value;
    f('batch').innerHTML = '<option value="">All batches</option>' + store.all('batches').filter((b) => !med || b.medicineId === med).map((b) => `<option value="${b.id}" ${b.id === cur ? 'selected' : ''}>${esc(b.batchNo)}${med ? '' : ' · ' + esc(medName(b.medicineId))}</option>`).join('');
  };
  if (query.med) f('med').value = query.med;
  fillBatches();
  if (query.batch) f('batch').value = query.batch;
  if (query.ref) f('q').value = query.ref;
  if (query.type) f('type').value = query.type;
  const apply = () => {
    const q = f('q').value.trim().toLowerCase();
    const res = rows.filter((x) => (!q || [x.reference, x.reason, x.id].join(' ').toLowerCase().includes(q)) && (!f('med').value || x.medicineId === f('med').value)
      && (!f('batch').value || x.batchId === f('batch').value) && (!f('type').value || x.type === f('type').value) && (!f('user').value || x.userId === f('user').value)
      && (!f('from').value || ymd(x.at) >= f('from').value) && (!f('to').value || ymd(x.at) <= f('to').value));
    table.setRows(res);
    const inn = res.reduce((s, x) => s + x.qtyIn, 0); const out = res.reduce((s, x) => s + x.qtyOut, 0);
    view.querySelector('[data-kpis]').innerHTML = kpi({ label: 'Movements', value: fmtNum(res.length), iconName: 'list', tone: 'navy' }) + kpi({ label: 'Total In', value: '+' + fmtNum(inn), iconName: 'arrow-down-to-line', tone: 'success' })
      + kpi({ label: 'Total Out', value: '−' + fmtNum(out), iconName: 'arrow-up-from-line', tone: 'danger' }) + kpi({ label: 'Net Change', value: (inn - out >= 0 ? '+' : '−') + fmtNum(Math.abs(inn - out)), iconName: 'sigma', tone: 'teal', sub: 'For the filtered movements' });
    if (window.lucide) window.lucide.createIcons();
  };
  view.querySelectorAll('[data-f]').forEach((el) => el.addEventListener(el.type === 'search' ? 'input' : 'change', debounce(() => { if (el.dataset.f === 'med') fillBatches(); apply(); }, 120)));
  view.querySelector('[data-clear]').onclick = () => { view.querySelectorAll('[data-f]').forEach((el) => { el.value = ''; }); fillBatches(); apply(); };
  view.querySelector('[data-export]').onclick = () => { exportTable(`stock-movements-${ymd()}.csv`, columns, table.getRows()); toast('Stock movements exported.'); };
  apply();
}
