// Stock Adjustments — controlled workflow; approved adjustments create ledger movements, never overwrite balances.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { PHARMACY, STORE_LOC, batchBalance, batchStatus, medName, userName, locationName } from '../calculations.js';
import { requestAdjustment, approveAdjustment, rejectAdjustment, canDecideAdjustment, adjustmentNeedsOwner } from '../services.js';
import { saveBlob, attachmentURL } from '../attachment-store.js';
import { badge, dataTable, exportTable, emptyState, openModal, confirmDialog, combo, kpi, dl, tabs } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtNum, fmtINR, fmtDate, fmtDateTime, ymd, refreshIcons } from '../utils.js';

const REASONS = ['Physical count variance', 'Damaged stock', 'Missing stock', 'Expired stock', 'Data correction', 'Other'];

export function render(view, params, query) {
  const user = currentUser();
  const all = () => [...store.all('adjustments')].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const toDecide = all().filter((a) => canDecideAdjustment(a, user));
  const approved = all().filter((a) => a.status === 'APPROVED');
  const monthKey = ymd().slice(0, 7);
  const valueAdj = approved.reduce((s, a) => s + a.difference * (store.get('batches', a.batchId)?.ptr || 0), 0);
  view.innerHTML = `
    <div class="page-head"><div><p class="muted">Every adjustment needs a reason. Approval creates a STOCK_ADJUSTMENT movement in the ledger. Sensitive adjustments (&gt; ${store.settings().approval.adjustmentQtyThreshold} units or &gt; ${fmtINR(store.settings().approval.adjustmentValueThreshold, true)}) require owner approval.</p></div>
      <div class="page-actions"><button class="btn btn-secondary" data-export>${icon('download')}Export CSV</button>${can('adjustment.request') ? `<button class="btn btn-primary" data-new>${icon('plus')}New Adjustment</button>` : ''}</div></div>
    <div class="kpis">
      ${kpi({ label: 'Awaiting your decision', value: fmtNum(toDecide.length), iconName: 'inbox', tone: toDecide.length ? 'warning' : 'success' })}
      ${kpi({ label: 'Pending (all)', value: fmtNum(all().filter((a) => a.status.startsWith('PENDING')).length), iconName: 'hourglass', tone: 'purple' })}
      ${kpi({ label: 'Approved this month', value: fmtNum(approved.filter((a) => (a.approvedAt || '').startsWith(monthKey)).length), iconName: 'check-check', tone: 'teal' })}
      ${kpi({ label: 'Net value adjusted', value: fmtINR(valueAdj, true), iconName: 'indian-rupee', tone: valueAdj < 0 ? 'danger' : 'success', sub: 'All approved adjustments at PTR' })}
    </div>
    <section class="card mt-2"><div data-tabs></div><div data-table></div></section>`;

  const columns = [
    { key: 'id', label: 'Adjustment', render: (a) => `<button class="link mono strong" data-view="${a.id}">${a.id}</button><div class="cell-sub">${fmtDate(a.requestedAt)}</div>` },
    { key: 'med', label: 'Medicine', value: (a) => medName(a.medicineId), render: (a) => `<a class="cell-main" href="#/inventory/${a.medicineId}">${esc(medName(a.medicineId))}</a>` },
    { key: 'loc', label: 'Location', value: (a) => locationName(a.locationId || PHARMACY()), render: (a) => esc(locationName(a.locationId || PHARMACY())) },
    { key: 'batch', label: 'Batch', value: (a) => store.get('batches', a.batchId)?.batchNo, render: (a) => `<a class="mono" href="#/batches/${a.batchId}">${esc(store.get('batches', a.batchId)?.batchNo)}</a>` },
    { key: 'systemQty', label: 'System Qty', align: 'right' },
    { key: 'physicalQty', label: 'Physical Qty', align: 'right' },
    { key: 'difference', label: 'Difference', align: 'right', render: (a) => `<strong class="${a.difference < 0 ? 'text-danger' : 'text-success'}">${a.difference > 0 ? '+' : '−'}${fmtNum(Math.abs(a.difference))}</strong>` },
    { key: 'type', label: 'Type', render: (a) => `<span class="tag ${a.type === 'IN' ? 'tag-success' : 'tag-danger'}">${a.type === 'IN' ? 'ADJUSTMENT IN' : 'ADJUSTMENT OUT'}</span>` },
    { key: 'reason', label: 'Reason', render: (a) => `${esc(a.reason)}<div class="cell-sub" style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(a.notes)}">${esc(a.notes)}</div>` },
    { key: 'requestedBy', label: 'Requested By', value: (a) => userName(a.requestedBy), render: (a) => esc(userName(a.requestedBy)) },
    { key: 'approvedBy', label: 'Approved By', value: (a) => userName(a.approvedBy), render: (a) => (a.approvedBy ? esc(userName(a.approvedBy)) : a.requiresOwner ? '<span class="cell-sub">Owner</span>' : '<span class="cell-sub">Manager</span>') },
    { key: 'status', label: 'Status', render: (a) => badge(a.status) },
    { key: '', label: 'Actions', sortable: false, csv: false, align: 'right', render: (a) => `<div class="row-actions">${canDecideAdjustment(a, user) ? `<button class="btn btn-danger-outline btn-sm" data-reject="${a.id}">Reject</button><button class="btn btn-primary btn-sm" data-approve="${a.id}">${icon('check')}Approve</button>` : `<button class="btn btn-ghost btn-sm" data-view="${a.id}">${icon('eye')}</button>`}</div>` }
  ];
  const table = dataTable({ columns, pageSize: 10, sort: { key: 'id', dir: 'desc' }, rowClass: (a) => (a.id === query.focus ? 'row-warning' : ''), empty: emptyState('scale', 'No adjustments here') });
  view.querySelector('[data-table]').appendChild(table.el);
  let current = query.status === 'PENDING' || toDecide.length ? 'pending' : 'all';
  const filterBy = (t) => all().filter((a) => t === 'all' || (t === 'pending' ? a.status.startsWith('PENDING') : a.status === t.toUpperCase()));
  const drawTabs = () => tabs(view.querySelector('[data-tabs]'), [
    { id: 'pending', label: 'Pending', icon: 'hourglass', count: filterBy('pending').length }, { id: 'approved', label: 'Approved', icon: 'check-circle-2', count: filterBy('approved').length },
    { id: 'rejected', label: 'Rejected', icon: 'x-circle', count: filterBy('rejected').length }, { id: 'all', label: 'All', icon: 'list', count: all().length }], current, (t) => { current = t; table.setRows(filterBy(t)); });
  drawTabs(); table.setRows(filterBy(current));
  const rerender = () => render(view, params, {});

  view.querySelector('[data-export]').onclick = () => { exportTable(`stock-adjustments-${ymd()}.csv`, columns, table.getRows()); toast('Adjustments exported.'); };
  view.querySelector('[data-new]')?.addEventListener('click', () => newAdjustment({}, rerender));
  view.querySelector('[data-table]').addEventListener('click', async (e) => {
    const ap = e.target.closest('[data-approve]'); const rj = e.target.closest('[data-reject]'); const vw = e.target.closest('[data-view]');
    try {
      if (ap) {
        const a = store.get('adjustments', ap.dataset.approve);
        const now = batchBalance(a.batchId, a.locationId || PHARMACY());
        if (!(await confirmDialog({ title: `Approve ${a.id}?`, iconName: 'check-circle-2', confirmLabel: 'Approve & post movement',
          message: `${esc(medName(a.medicineId))} · batch ${esc(store.get('batches', a.batchId).batchNo)}<br>Adjustment of <strong>${a.difference > 0 ? '+' : ''}${a.difference}</strong> (${esc(a.reason)}).${now !== a.systemQty ? `<div class="alert alert-warning mt-1">${icon('alert-triangle')}<div>System quantity changed from ${a.systemQty} to ${now} since the request. The difference of ${a.difference} will still be applied.</div></div>` : ''}` }))) return;
        approveAdjustment(a.id, user); toast(`${a.id} approved. Stock movement created and inventory updated.`); rerender();
      }
      if (rj) {
        const r = await confirmDialog({ title: `Reject ${rj.dataset.reject}?`, message: 'No stock movement will be created.', confirmLabel: 'Reject', tone: 'danger', reason: true, reasonLabel: 'Rejection reason', iconName: 'x-circle' });
        if (!r) return; rejectAdjustment(rj.dataset.reject, user, r.reason); toast(`${rj.dataset.reject} rejected.`, 'info'); rerender();
      }
      if (vw) viewAdjustment(store.get('adjustments', vw.dataset.view), rerender);
    } catch (err) { toast(err.message, 'error'); }
  });
  if (query.new && can('adjustment.request')) newAdjustment({ medicineId: query.med || store.get('batches', query.batch)?.medicineId, batchId: query.batch }, rerender);
  if (query.focus && store.get('adjustments', query.focus) && !query.new) viewAdjustment(store.get('adjustments', query.focus), rerender);
}

async function viewAdjustment(a, done) {
  const me = currentUser();
  const b = store.get('batches', a.batchId);
  const att = a.attachmentId && store.get('attachments', a.attachmentId);
  const url = att ? await attachmentURL(att) : null;
  openModal({ title: `Adjustment ${a.id}`, subtitle: `${esc(medName(a.medicineId))} · batch ${esc(b.batchNo)}`, size: 'md',
    body: `<div class="row mb-2">${badge(a.status)}${a.requiresOwner ? '<span class="tag tag-purple">Owner approval required</span>' : ''}</div>
      ${dl([['System Qty', fmtNum(a.systemQty)], ['Physical Qty', fmtNum(a.physicalQty)], ['Difference', `<strong class="${a.difference < 0 ? 'text-danger' : 'text-success'}">${a.difference > 0 ? '+' : ''}${a.difference}</strong>`], ['Value impact', fmtINR(a.difference * b.ptr)],
        ['Reason', esc(a.reason)], ['Requested By', `${esc(userName(a.requestedBy))}<div class="cell-sub">${fmtDateTime(a.requestedAt)}</div>`], ['Decided By', a.approvedBy ? `${esc(userName(a.approvedBy))}<div class="cell-sub">${fmtDateTime(a.approvedAt)}</div>` : '—'],
        ['Stock Movement', a.movementId ? `<a href="#/movements?ref=${a.id}" class="mono">${a.movementId}</a>` : '—']])}
      <div class="divider"></div><div class="section-title">Notes</div><p>${esc(a.notes)}</p>
      ${a.rejectionReason ? `<div class="alert alert-danger mt-2">${icon('x-circle')}<div><strong>Rejected:</strong> ${esc(a.rejectionReason)}</div></div>` : ''}
      ${att ? `<div class="divider"></div><div class="section-title">Attachment</div>${url && att.type.startsWith('image/') ? `<img src="${url}" class="preview-img" style="max-height:260px" alt="">` : `<a href="${url}" target="_blank">${esc(att.name)}</a>`}` : ''}`,
    footer: canDecideAdjustment(a, me) ? [
      { label: 'Reject', cls: 'btn-danger-outline', onClick: async (c) => { c(); const r = await confirmDialog({ title: `Reject ${a.id}?`, message: 'No stock will change.', confirmLabel: 'Reject', tone: 'danger', reason: true, reasonLabel: 'Rejection reason', iconName: 'x-circle' }); if (!r) return; try { rejectAdjustment(a.id, me, r.reason); toast(`${a.id} rejected.`, 'info'); done?.(); } catch (e) { toast(e.message, 'error'); } } },
      { label: 'Approve', cls: 'btn-primary', icon: 'check', onClick: (c) => { try { approveAdjustment(a.id, me); toast(`${a.id} approved. Stock updated.`); c(); done?.(); } catch (e) { toast(e.message, 'error'); } } }]
      : [{ label: 'Close', cls: 'btn-primary', onClick: (c) => c() }] });
}

export function newAdjustment(pre, done) {
  const user = currentUser();
  let medId = pre.medicineId || ''; let batchId = pre.batchId || ''; let file = null;
  const body = document.createElement('div');
  body.innerHTML = `<form class="form-grid" data-af>
    <div class="field col-12"><label>Medicine <span class="req">*</span></label><div data-med></div></div>
    <div class="field col-4"><label>Location <span class="req">*</span></label><select class="input" data-loc>${can('store.transfer') || can('adjustment.approve.exceptional') ? `<option value="${STORE_LOC()}">Central Store</option>` : ''}<option value="${PHARMACY()}" ${can('store.transfer') ? '' : 'selected'}>Pharmacy</option></select></div>
    <div class="field col-8"><label>Batch <span class="req">*</span></label><select class="input" name="batchId" data-batch></select></div>
    <div class="field col-4"><label>Adjustment Type</label><input class="input" data-type readonly value="—"></div>
    <div class="field col-4"><label>System Quantity</label><input class="input" data-sys readonly></div>
    <div class="field col-4"><label>Physical Quantity <span class="req">*</span></label><input class="input" type="number" min="0" step="1" name="physicalQty" data-phys></div>
    <div class="field col-4"><label>Difference</label><input class="input strong" data-diff readonly></div>
    <div class="field col-6"><label>Reason <span class="req">*</span></label><select class="input" name="reason"><option value="">Select a reason…</option>${REASONS.map((r) => `<option>${r}</option>`).join('')}</select></div>
    <div class="field col-6"><label>Attachment (optional)</label><input class="input" type="file" accept="image/*,application/pdf" data-file style="padding-top:6px"></div>
    <div class="field col-12"><label>Details <span class="req">*</span></label><textarea class="input" name="notes" rows="2" placeholder="Explain what was found, e.g. 3 strips damaged by water leakage near sink"></textarea></div>
    <div class="col-12" data-policy></div>
    <div class="col-12"><div class="ai-note">${icon('info')}<span>Requested by <strong>${esc(user.name)}</strong>. Physical quantity must come from an actual count. The system balance is never overwritten — an approved adjustment posts the difference as a movement.</span></div></div>
  </form>`;
  const form = body.querySelector('[data-af]');
  const batchSel = form.querySelector('[data-batch]');
  const locSel = () => form.querySelector('[data-loc]').value;
  const fillBatches = () => {
    const list = store.all('batches').filter((b) => b.medicineId === medId && !b.returned).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    batchSel.innerHTML = list.length ? list.map((b) => `<option value="${b.id}" ${b.id === batchId ? 'selected' : ''}>${esc(b.batchNo)} · exp ${fmtDate(b.expiryDate)} · here ${batchBalance(b.id, locSel())} · ${batchStatus(b).replace('_', ' ')}</option>`).join('') : '<option value="">No batches for this medicine</option>';
    batchId = batchSel.value; calc();
  };
  const calc = () => {
    const b = store.get('batches', batchId);
    const sys = b ? batchBalance(b.id, locSel()) : 0;
    form.querySelector('[data-sys]').value = b ? sys : '';
    const p = form.querySelector('[data-phys]').value;
    const diff = p === '' ? null : Number(p) - sys;
    form.querySelector('[data-diff]').value = diff == null ? '' : (diff > 0 ? '+' : '') + diff;
    form.querySelector('[data-diff]').style.color = diff < 0 ? 'var(--danger)' : diff > 0 ? 'var(--success)' : '';
    form.querySelector('[data-type]').value = diff == null || diff === 0 ? '—' : diff > 0 ? 'STOCK ADJUSTMENT IN' : 'STOCK ADJUSTMENT OUT';
    const pol = form.querySelector('[data-policy]');
    if (b && diff) {
      const owner = adjustmentNeedsOwner(b, diff);
      const self = owner ? can('adjustment.approve.exceptional') : can('adjustment.approve');
      pol.innerHTML = `<div class="alert ${owner ? 'alert-info' : self ? 'alert-success' : 'alert-warning'}">${icon(owner ? 'shield-alert' : self ? 'check-circle-2' : 'hourglass')}<div>Value impact <strong>${fmtINR(diff * b.ptr)}</strong>. ${owner ? (self ? 'Sensitive adjustment — you are the approving authority; it will be posted on submission.' : 'Sensitive adjustment — will be sent to the <strong>Hospital Owner</strong> for approval.') : self ? 'Routine adjustment within your authority — it will be approved and posted immediately.' : 'Will be sent to the <strong>Pharmacy Manager</strong> for approval.'}</div></div>`;
    } else pol.innerHTML = '';
    refreshIcons(pol);
  };
  const medOpts = store.all('medicines').map((m) => ({ value: m.id, label: m.brandName, sub: `${m.genericName} · ${m.code}` }));
  openModal({ title: 'New stock adjustment', size: 'md', body,
    onOpen: () => {
      combo(form.querySelector('[data-med]'), { options: medOpts, value: medId, placeholder: 'Search medicine…', onChange: (v) => { medId = v; batchId = ''; fillBatches(); } });
      batchSel.onchange = () => { batchId = batchSel.value; calc(); };
      form.querySelector('[data-loc]').onchange = () => { if (medId) fillBatches(); else calc(); };
      form.querySelector('[data-phys]').oninput = calc;
      form.querySelector('[data-file]').onchange = (e) => { file = e.target.files[0] || null; if (file && file.size > store.settings().maxFileSizeMB * 1048576) { toast(`Attachment exceeds ${store.settings().maxFileSizeMB} MB.`, 'error'); e.target.value = ''; file = null; } };
      if (medId) fillBatches(); else batchSel.innerHTML = '<option value="">Select a medicine first</option>';
    },
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Submit adjustment', cls: 'btn-primary', icon: 'send', onClick: async (close) => {
      const d = Object.fromEntries(new FormData(form));
      const errs = [];
      if (!medId) errs.push('Select a medicine.');
      if (!batchId) errs.push('Select a batch.');
      if (d.physicalQty === '') errs.push('Enter the physical quantity.');
      if (!d.reason) errs.push('Select a reason.');
      if (!d.notes.trim()) errs.push('Describe the reason in the details field.');
      if (errs.length) { toast(errs.join(' '), 'error', 'Please complete the form'); return; }
      try {
        let attachmentId = null;
        if (file) {
          attachmentId = store.nextId('attachments', 'ATT-');
          await saveBlob(attachmentId, file);
          store.insert('attachments', { id: attachmentId, grnId: null, category: 'ADJUSTMENT', name: file.name, type: file.type, size: file.size, src: null, storage: 'idb', validation: 'PHOTO_UPLOADED', uploadedBy: user.id, uploadedAt: new Date().toISOString() });
        }
        const a = requestAdjustment({ batchId, physicalQty: d.physicalQty, reason: d.reason, notes: d.notes, attachmentId, locationId: locSel() }, user);
        toast(a.status === 'APPROVED' ? `${a.id} approved and posted. Inventory updated.` : `${a.id} submitted for ${a.requiresOwner ? 'owner' : 'manager'} approval.`, a.status === 'APPROVED' ? 'success' : 'info');
        close(); done?.();
      } catch (err) { toast(err.message, 'error'); }
    } }] });
}
