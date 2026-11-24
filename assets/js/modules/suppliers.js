// Supplier management — listing, add/edit, details with purchase history
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { grnTotals, userName, batchBalance, medName } from '../calculations.js';
import { audit } from '../services.js';
import { badge, dataTable, exportTable, openModal, emptyState, card, dl, kpi, chart } from '../components.js';
import { validateForm } from '../validation.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtNum, fmtINR, fmtCompactINR, fmtDate, fmtDateTime, ymd, debounce } from '../utils.js';
import { setMeta } from '../app.js';
import { navigate } from '../router.js';

const stats = (s) => {
  const grns = store.all('grns').filter((g) => g.supplierId === s.id);
  const posted = grns.filter((g) => g.status === 'POSTED');
  return { grns, posted, value: posted.reduce((v, g) => v + grnTotals(g).grand, 0), last: [...grns].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0] };
};

function supplierForm(s, done) {
  const user = currentUser();
  const v = (k) => esc(s?.[k] ?? '');
  openModal({ title: s ? `Edit ${s.name}` : 'Add supplier', size: 'lg',
    body: `<form class="form-grid" data-sf>
      <div class="field col-3"><label>Supplier Code</label><input class="input" value="${s ? v('code') : 'Auto-generated'}" readonly></div>
      <div class="field col-9"><label>Supplier Name <span class="req">*</span></label><input class="input" name="name" value="${v('name')}" data-rules="required"></div>
      <div class="field col-6"><label>Contact Person <span class="req">*</span></label><input class="input" name="contactPerson" value="${v('contactPerson')}" data-rules="required"></div>
      <div class="field col-6"><label>Phone Number <span class="req">*</span></label><input class="input" name="phone" value="${v('phone')}" data-rules="required,phone" placeholder="+91 94430 00000"></div>
      <div class="field col-6"><label>Email</label><input class="input" name="email" value="${v('email')}" data-rules="email"></div>
      <div class="field col-6"><label>GST Number <span class="req">*</span></label><input class="input" name="gstNumber" value="${v('gstNumber')}" data-rules="required,gstin" style="text-transform:uppercase"></div>
      <div class="field col-12"><label>Address <span class="req">*</span></label><textarea class="input" name="address" rows="2" data-rules="required">${v('address')}</textarea></div>
      <div class="field col-4"><label>Status</label><select class="input" name="status"><option ${s?.status !== 'INACTIVE' ? 'selected' : ''}>ACTIVE</option><option ${s?.status === 'INACTIVE' ? 'selected' : ''}>INACTIVE</option></select></div>
      <div class="field col-8"><label>Remarks</label><input class="input" name="remarks" value="${v('remarks')}"></div></form>`,
    onOpen: (w) => { const g = w.querySelector('[name=gstNumber]'); g.addEventListener('input', () => { g.value = g.value.toUpperCase(); }); },
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: s ? 'Save changes' : 'Add supplier', cls: 'btn-primary', icon: 'save', onClick: (close, wrap) => {
      const form = wrap.querySelector('[data-sf]'); if (!validateForm(form)) return;
      const d = Object.fromEntries(new FormData(form)); d.gstNumber = d.gstNumber.toUpperCase();
      const dup = store.all('suppliers').find((x) => x.gstNumber === d.gstNumber && x.id !== s?.id);
      if (dup) { toast(`GSTIN already registered for ${dup.name}.`, 'error', 'Duplicate supplier'); return; }
      store.transaction(() => {
        if (s) { store.update('suppliers', s.id, d); audit(user, 'SUPPLIER_UPDATED', 'SUPPLIER', s.id, d.name); }
        else { const id = store.nextId('suppliers', 'SUP-'); store.insert('suppliers', { id, code: id, ...d }); audit(user, 'SUPPLIER_CREATED', 'SUPPLIER', id, d.name); }
      });
      toast(s ? 'Supplier updated.' : `Supplier ${d.name} added.`); close(); done();
    } }] });
}

export function renderList(view, params, query) {
  const manage = can('supplier.manage');
  view.innerHTML = `
    <div class="page-head"><div><p class="muted">Medicine and consumable suppliers with purchase history.</p></div>
      <div class="page-actions"><button class="btn btn-secondary" data-export>${icon('download')}Export CSV</button>${manage ? `<button class="btn btn-primary" data-add>${icon('plus')}Add Supplier</button>` : ''}</div></div>
    <section class="card"><div class="toolbar">
      <div class="search">${icon('search')}<input class="input" type="search" placeholder="Search name, code, contact, GSTIN, city…" data-f="q"></div>
      <select class="input" data-f="status"><option value="">All statuses</option><option>ACTIVE</option><option>INACTIVE</option></select>
    </div><div data-table></div></section>`;
  const columns = [
    { key: 'code', label: 'Code', render: (s) => `<span class="mono">${esc(s.code)}</span>` },
    { key: 'name', label: 'Supplier Name', render: (s) => `<a class="cell-main" href="#/suppliers/${s.id}">${esc(s.name)}</a><div class="cell-sub">${esc(s.address.split(',').slice(-2).join(',').trim())}</div>` },
    { key: 'contactPerson', label: 'Contact Person' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email', render: (s) => `<span class="cell-sub">${esc(s.email)}</span>` },
    { key: 'gstNumber', label: 'GST Number', render: (s) => `<span class="mono">${esc(s.gstNumber)}</span>` },
    { key: 'grns', label: 'GRNs', align: 'right', value: (s) => stats(s).grns.length, render: (s) => stats(s).grns.length },
    { key: 'value', label: 'Purchase Value', align: 'right', value: (s) => stats(s).value, render: (s) => fmtINR(stats(s).value, true) },
    { key: 'status', label: 'Status', render: (s) => badge(s.status) },
    { key: '', label: 'Actions', sortable: false, csv: false, align: 'right', render: (s) => `<div class="row-actions"><a class="btn btn-ghost btn-sm" href="#/suppliers/${s.id}">${icon('eye')}</a>${manage ? `<button class="btn btn-ghost btn-sm" data-edit="${s.id}">${icon('pencil')}</button>` : ''}</div>` }
  ];
  const table = dataTable({ columns, sort: { key: 'name' }, onRowClick: (s) => navigate('#/suppliers/' + s.id), empty: emptyState('truck', 'No suppliers found') });
  view.querySelector('[data-table]').appendChild(table.el);
  const f = (n) => view.querySelector(`[data-f="${n}"]`);
  const apply = () => { const q = f('q').value.trim().toLowerCase(); table.setRows(store.all('suppliers').filter((s) => (!q || [s.name, s.code, s.contactPerson, s.gstNumber, s.address, s.phone].join(' ').toLowerCase().includes(q)) && (!f('status').value || s.status === f('status').value))); };
  view.querySelectorAll('[data-f]').forEach((el) => el.addEventListener(el.type === 'search' ? 'input' : 'change', debounce(apply, 120)));
  const rerender = () => renderList(view, params, query);
  view.querySelector('[data-add]')?.addEventListener('click', () => supplierForm(null, rerender));
  view.querySelector('[data-table]').addEventListener('click', (e) => { const b = e.target.closest('[data-edit]'); if (b) supplierForm(store.get('suppliers', b.dataset.edit), rerender); });
  view.querySelector('[data-export]').onclick = () => { exportTable(`suppliers-${ymd()}.csv`, columns, table.getRows()); toast('Suppliers exported.'); };
  apply();
}

export function renderDetails(view, params) {
  const s = store.get('suppliers', params.id);
  if (!s) { view.innerHTML = emptyState('truck', 'Supplier not found', '', '<a class="btn btn-primary" href="#/suppliers">Back</a>'); return; }
  setMeta({ title: s.name, crumbs: [{ label: 'Suppliers', href: '#/suppliers' }, s.name] });
  const st = stats(s);
  const batches = store.all('batches').filter((b) => b.supplierId === s.id);
  const meds = {};
  st.posted.forEach((g) => g.items.forEach((it) => { meds[it.medicineId] = (meds[it.medicineId] || 0) + Number(it.receivedQty) + Number(it.freeQty || 0); }));
  view.innerHTML = `
    <div class="page-head"><div><div class="row"><h1>${esc(s.name)}</h1>${badge(s.status)}</div><p class="muted">${esc(s.code)} · GSTIN <span class="mono">${esc(s.gstNumber)}</span></p></div>
      <div class="page-actions">${can('supplier.manage') ? `<button class="btn btn-secondary" data-edit>${icon('pencil')}Edit</button>` : ''}${can('grn.create') && s.status === 'ACTIVE' ? `<a class="btn btn-primary" href="#/grn/new">${icon('plus')}New GRN</a>` : ''}</div></div>
    <div class="kpis">
      ${kpi({ label: 'Total GRNs', value: fmtNum(st.grns.length), iconName: 'files', tone: 'navy' })}
      ${kpi({ label: 'Posted GRNs', value: fmtNum(st.posted.length), iconName: 'check-check', tone: 'success' })}
      ${kpi({ label: 'Purchase Value', value: fmtCompactINR(st.value), iconName: 'indian-rupee', tone: 'teal' })}
      ${kpi({ label: 'Batches Supplied', value: fmtNum(batches.length), iconName: 'layers', tone: 'info', sub: `${batches.filter((b) => batchBalance(b.id) > 0).length} with stock` })}
      ${kpi({ label: 'Last Receipt', value: st.last ? fmtDate(st.last.receivedAt) : '—', iconName: 'calendar', tone: 'purple' })}
    </div>
    <div class="grid grid-1-2">
      ${card('Supplier Details', dl([['Contact Person', esc(s.contactPerson)], ['Phone', `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>`], ['Email', `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`], ['GST Number', `<span class="mono">${esc(s.gstNumber)}</span>`], ['Address', esc(s.address)], ['Remarks', esc(s.remarks || '—')]]))}
      ${card('Purchase History', '<div class="chart-box sm"><canvas id="ch-ph"></canvas></div>', { sub: 'Posted receipt value by month' })}
    </div>
    ${card('Associated GRNs', st.grns.length ? `<table class="table dense"><thead><tr><th>GRN</th><th>Invoice</th><th>Received</th><th>Received By</th><th class="ta-right">Items</th><th class="ta-right">Value</th><th>Status</th></tr></thead><tbody>${[...st.grns].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).map((g) => `<tr class="clickable" onclick="location.hash='#/grn/${g.id}'"><td class="cell-main">${g.id}</td><td class="mono">${esc(g.invoiceNo)}</td><td>${fmtDateTime(g.receivedAt)}</td><td>${esc(userName(g.receivedBy))}</td><td class="ta-right">${g.items.length}</td><td class="ta-right">${fmtINR(grnTotals(g).grand)}</td><td>${badge(g.status)}</td></tr>`).join('')}</tbody></table>` : emptyState('files', 'No GRNs yet'), { cls: 'flush mt-2' })}
    ${card('Medicines Supplied (posted)', Object.keys(meds).length ? `<ul class="list-plain" style="padding:0 20px">${Object.entries(meds).sort((a, b) => b[1] - a[1]).map(([id, q]) => `<li class="list-row"><a href="#/inventory/${id}">${esc(medName(id))}</a><strong>${fmtNum(q)} units</strong></li>`).join('')}</ul>` : emptyState('pill', 'Nothing posted yet'), { cls: 'flush mt-2' })}`;
  view.querySelector('[data-edit]')?.addEventListener('click', () => supplierForm(s, () => renderDetails(view, params)));
  const months = {};
  st.posted.forEach((g) => { const k = ymd(g.postedAt || g.receivedAt).slice(0, 7); months[k] = (months[k] || 0) + grnTotals(g).grand; });
  const keys = Object.keys(months).sort();
  chart(view.querySelector('#ch-ph'), { type: 'bar', data: { labels: keys.map((k) => new Date(k + '-01T00:00').toLocaleString('en-IN', { month: 'short', year: '2-digit' })), datasets: [{ label: 'Value', data: keys.map((k) => Math.round(months[k])), backgroundColor: '#049794', borderRadius: 6, maxBarThickness: 36 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtINR(c.raw) } } }, scales: { y: { beginAtZero: true, ticks: { callback: (v) => fmtCompactINR(v) } }, x: { grid: { display: false } } } } });
}
