// Module 1 — Stock Receiving / Goods Receipt Note (GRN)
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { grnKPIs, grnTotals, lineCalc, supplierName, userName, medName, locationName, daysUntil, batchStatus, GRN_STATUSES } from '../calculations.js';
import { validateGrn } from '../validation.js';
import { newGrnDraft, saveGrn, submitGrn, verifyAndPost, approveGrn, rejectGrn, cancelGrn, sendBackGrn, supplierReturn } from '../services.js';
import { saveBlob, deleteBlob, attachmentURL } from '../attachment-store.js';
import { kpi, card, badge, dataTable, chart, PALETTE, exportTable, confirmDialog, openModal, combo, dropzone, emptyState, dl } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, refreshIcons, fmtINR, fmtNum, fmtDate, fmtDateTime, fmtCompactINR, fileSize, ymd, clone, titleCase, debounce } from '../utils.js';
import { setMeta } from '../app.js';
import { navigate } from '../router.js';
import { batchBalance, STORE_LOC } from '../calculations.js';

const VALIDATION_LABEL = {
  WAITING: ['Waiting for validation', 'neutral'], CHECKING: ['Checking document type…', 'info'], INVOICE_DETECTED: ['Invoice detected', 'success'],
  INVOICE_REVIEW: ['Invoice document needs review', 'warning'], PHOTO_UPLOADED: ['Delivery photograph uploaded', 'success'],
  NEEDS_MANUAL_REVIEW: ['Image needs manual verification', 'warning'], FAILED: ['Validation failed', 'danger']
};
const vBadge = (s) => { const [l, t] = VALIDATION_LABEL[s] || [titleCase(s), 'neutral']; return `<span class="badge badge-${t === 'neutral' ? 'neutral' : t}">${s === 'CHECKING' ? '<span class="spinner spinner-dark" style="width:10px;height:10px;border-width:2px"></span>' : '<span class="dot"></span>'}${esc(l)}</span>`; };

// =====================================================================
// LIST
// =====================================================================
export function renderList(view, params, query) {
  const k = grnKPIs();
  view.innerHTML = `
    <div class="page-head"><div><p class="muted">Every supplier delivery entered in the system. Stock is added only after a manager checks it.</p></div>
      <div class="page-actions"><button class="btn btn-secondary" data-export>${icon('download')}Export CSV</button>${can('grn.create') ? `<a class="btn btn-primary" href="#/grn/new">${icon('plus')}Receive Stock</a>` : ''}</div></div>
    <div class="chip-row" data-chips></div>
    <section class="card"><div class="toolbar">
      <div class="search">${icon('search')}<input class="input" type="search" placeholder="Search GRN, invoice or supplier…" data-f="q"></div><input type="hidden" data-f="status">
      <select class="input" data-f="supplier"><option value="">All suppliers</option>${store.all('suppliers').map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <button class="more-toggle" data-more>${icon('sliders-horizontal')}Dates</button>
      <span class="collapsible closed row" data-dates><span class="filter-label">From</span><input type="date" class="input" data-f="from"><span class="filter-label">To</span><input type="date" class="input" data-f="to"></span>
      <span class="spacer"></span><button class="btn btn-ghost btn-sm" data-clear>${icon('x')}Clear</button>
    </div><div data-table></div></section>`;

  const columns = [
    { key: 'id', label: 'GRN No.', render: (g) => `<a class="cell-main" href="#/grn/${g.id}">${esc(g.id)}</a>${g.requiresOwnerApproval ? `<div class="cell-sub">${icon('shield-alert', 'text-warning')} exception</div>` : ''}` },
    { key: 'supplier', label: 'Supplier', value: (g) => supplierName(g.supplierId), render: (g) => `${esc(supplierName(g.supplierId))}` },
    { key: 'invoiceNo', label: 'Invoice No.', render: (g) => `<span class="mono">${esc(g.invoiceNo || '—')}</span>` },
    { key: 'receivedAt', label: 'Received Date', value: (g) => g.receivedAt, render: (g) => fmtDateTime(g.receivedAt), csv: (g) => fmtDateTime(g.receivedAt) },
    { key: 'receivedBy', label: 'Received By', value: (g) => userName(g.receivedBy), render: (g) => esc(userName(g.receivedBy)) },
    { key: 'items', label: 'Items', align: 'right', value: (g) => g.items.length, render: (g) => g.items.length },
    { key: 'qty', label: 'Total Qty', align: 'right', value: (g) => grnTotals(g).totalQty, render: (g) => fmtNum(grnTotals(g).totalQty) },
    { key: 'value', label: 'Total Value', align: 'right', value: (g) => grnTotals(g).grand, render: (g) => `<strong>${fmtINR(grnTotals(g).grand)}</strong>` },
    { key: 'status', label: 'Status', render: (g) => badge(g.status) },
    { key: '', label: 'Actions', sortable: false, csv: false, align: 'right', render: (g) => `<div class="row-actions">
        <a class="btn btn-ghost btn-sm" href="#/grn/${g.id}" title="View details">${icon('eye')}</a>
        ${['DRAFT', 'VALIDATION_REQUIRED'].includes(g.status) && can('grn.create') ? `<a class="btn btn-secondary btn-sm" href="#/grn/${g.id}/edit">${icon('pencil')}Continue</a>` : ''}
        ${g.status === 'SUBMITTED' && can('grn.verify') ? `<a class="btn btn-primary btn-sm" href="#/grn/${g.id}">${icon('clipboard-check')}Verify</a>` : ''}
        ${g.status === 'PENDING_APPROVAL' && can('grn.approve.exceptional') ? `<a class="btn btn-primary btn-sm" href="#/grn/${g.id}">${icon('shield-check')}Review</a>` : ''}</div>` }
  ];
  const table = dataTable({ columns, pageSize: 10, sort: { key: 'receivedAt', dir: 'desc' }, onRowClick: (g) => navigate('#/grn/' + g.id),
    rowClass: (g) => (g.status === 'PENDING_APPROVAL' || g.status === 'VALIDATION_REQUIRED' ? 'row-warning' : ''),
    empty: emptyState('package-search', 'No GRNs match your filters', 'Clear the filters or create a new GRN.', can('grn.create') ? `<a class="btn btn-primary" href="#/grn/new">${icon('plus')}Create New GRN</a>` : '') });
  view.querySelector('[data-table]').appendChild(table.el);
  const f = (n) => view.querySelector(`[data-f="${n}"]`);
  const GROUPS = { DRAFTS: ['DRAFT', 'VALIDATION_REQUIRED'], CLOSED: ['REJECTED', 'CANCELLED'] };
  const CHIPS = [['', 'All'], ['DRAFTS', 'Drafts'], ['SUBMITTED', 'Waiting for check'], ['PENDING_APPROVAL', 'Waiting for owner'], ['POSTED', 'Stock added'], ['CLOSED', 'Rejected / cancelled']];
  const cnt = (c) => store.all('grns').filter((g) => !c || (GROUPS[c] ? GROUPS[c].includes(g.status) : g.status === c)).length;
  const drawChips = () => { view.querySelector('[data-chips]').innerHTML = CHIPS.map(([c, l]) => `<button class="chip ${f('status').value === c ? 'active' : ''}" data-chip="${c}">${l} <strong>${cnt(c)}</strong></button>`).join(''); };
  if (query.status) f('status').value = query.status === 'DRAFT' || query.status === 'VALIDATION_REQUIRED' ? 'DRAFTS' : query.status;
  if (query.supplier) f('supplier').value = query.supplier;
  const apply = () => {
    const q = f('q').value.trim().toLowerCase(); const st = f('status').value; const sp = f('supplier').value; const from = f('from').value; const to = f('to').value;
    table.setRows(store.all('grns').filter((g) => (!q || [g.id, g.invoiceNo, supplierName(g.supplierId), g.poRef, userName(g.receivedBy)].join(' ').toLowerCase().includes(q))
      && (!st || (GROUPS[st] ? GROUPS[st].includes(g.status) : g.status === st)) && (!sp || g.supplierId === sp)
      && (!from || ymd(g.receivedAt) >= from) && (!to || ymd(g.receivedAt) <= to)));
    drawChips();
  };
  view.querySelector('[data-chips]').addEventListener('click', (e) => { const c = e.target.closest('[data-chip]'); if (c) { f('status').value = c.dataset.chip; apply(); } });
  view.querySelector('[data-more]').onclick = () => view.querySelector('[data-dates]').classList.toggle('closed');
  view.querySelectorAll('[data-f]').forEach((el) => el.addEventListener(el.type === 'search' ? 'input' : 'change', debounce(apply, 120)));
  view.querySelector('[data-clear]').onclick = () => { view.querySelectorAll('[data-f]').forEach((el) => { el.value = ''; }); query.status = ''; apply(); };
  view.querySelector('[data-export]').onclick = () => { exportTable(`grn-list-${ymd()}.csv`, columns, table.getRows()); toast('GRN list exported as CSV.'); };
  apply();
}

// =====================================================================
// WIZARD
// =====================================================================
const STEPS = [
  { n: 1, t: 'Receiving Information', s: 'Supplier & invoice' },
  { n: 2, t: 'Upload Documents', s: 'Invoice & photos' },
  { n: 3, t: 'Medicine Entry', s: 'Items & batches' },
  { n: 4, t: 'Review & Verify', s: 'Check warnings' },
  { n: 5, t: 'Submit & Post', s: 'Finish' }
];

export function renderWizard(view, params) {
  const user = currentUser();
  let g;
  if (params.id) {
    const ex = store.get('grns', params.id);
    if (!ex) { view.innerHTML = emptyState('file-question', 'GRN not found', '', '<a class="btn btn-primary" href="#/grn">Back to GRNs</a>'); return; }
    if (!['DRAFT', 'VALIDATION_REQUIRED', 'SUBMITTED'].includes(ex.status)) {
      view.innerHTML = emptyState('lock', `${ex.id} is ${titleCase(ex.status)}`, 'Posted, rejected or cancelled GRNs cannot be edited. Use a supplier return or stock adjustment for corrections.', `<a class="btn btn-primary" href="#/grn/${ex.id}">View GRN</a>`);
      return;
    }
    if (ex.status === 'SUBMITTED' && !can('grn.verify') && ex.receivedBy !== user.id) { view.innerHTML = emptyState('lock', 'Submitted GRNs can only be edited by the submitter or a manager'); return; }
    g = clone(ex);
    setMeta({ title: `Edit ${g.id}`, crumbs: [{ label: 'Stock Receiving', href: '#/grn' }, { label: 'All GRNs', href: '#/grn' }, g.id] });
  } else {
    g = newGrnDraft(user);
  }
  const pending = new Map(); // attachment id -> metadata (not yet saved)
  const openMore = new Set(); // line indexes showing the optional fields
  const metaOf = (id) => pending.get(id) || store.get('attachments', id);
  let step = 1; let dirty = false; let confirmed = false; let finished = null;
  const markDirty = () => { dirty = true; };
  const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  view.innerHTML = `<div class="stepper" data-stepper></div><div data-step></div>
    <div class="wizard-foot" data-foot>
      <div class="row"><button class="btn btn-ghost" data-act="discard">${icon('x')}${g.isNew ? 'Discard' : 'Close'}</button><span class="muted small" data-dirty></span></div>
      <div class="row"><button class="btn btn-secondary" data-act="draft">${icon('save')}Save as Draft</button>
      <button class="btn btn-secondary" data-act="back">${icon('arrow-left')}Back</button>
      <button class="btn btn-primary" data-act="next">Next${icon('arrow-right')}</button></div>
    </div>`;
  const stepHost = view.querySelector('[data-step]');

  function drawStepper() {
    const v = validateGrn(g);
    view.querySelector('[data-stepper]').innerHTML = STEPS.map((s) => {
      const err = s.n < 4 && v.errors.some((e) => e.step === s.n) && (s.n < step || s.n === 4);
      const done = s.n < step && !err;
      return `<button class="step ${s.n === step ? 'active' : ''} ${done ? 'done' : ''} ${err ? 'err' : ''}" data-go="${s.n}" ${finished ? 'disabled' : ''}><span class="step-num">${done ? icon('check') : err ? icon('alert-triangle') : s.n}</span><span class="step-txt"><strong>${s.t}</strong><small>${s.s}</small></span></button>`;
    }).join('');
    view.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(+b.dataset.go); });
    refreshIcons(view.querySelector('[data-stepper]'));
  }
  function drawFoot() {
    const foot = view.querySelector('[data-foot]');
    foot.classList.toggle('hidden', !!finished);
    foot.querySelector('[data-act=back]').disabled = step === 1;
    foot.querySelector('[data-act=next]').classList.toggle('hidden', step === 5);
    foot.querySelector('[data-dirty]').textContent = dirty ? 'Unsaved changes' : (g.isNew ? 'Not saved yet' : `Saved · ${fmtDateTime(g.updatedAt)}`);
  }
  function go(n) {
    if (finished) return;
    step = Math.max(1, Math.min(5, n));
    drawStepper(); drawFoot();
    stepHost.innerHTML = '';
    [null, step1, step2, step3, step4, step5][step]();
    refreshIcons(stepHost);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  view.querySelector('[data-foot]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'back') go(step - 1);
    if (a === 'next') {
      const v = validateGrn(g);
      const errs = v.errors.filter((x) => x.step === step);
      if (errs.length && step < 4) toast(`${errs.length} issue(s) on this step — you can continue, but they must be fixed before submission.`, 'warning', errs[0].msg);
      go(step + 1);
    }
    if (a === 'draft') doSave();
    if (a === 'discard') {
      if (dirty && !(await confirmDialog({ title: 'Leave without saving?', message: 'You have unsaved changes on this GRN. They will be lost.', confirmLabel: 'Leave', tone: 'danger', iconName: 'alert-triangle' }))) return;
      dirty = false;
      for (const id of pending.keys()) deleteBlob(id).catch(() => {});
      navigate(g.isNew ? '#/grn' : '#/grn/' + g.id);
    }
  });

  function persistPending() {
    const refs = new Set([g.attachments.invoice, ...g.attachments.photos].filter(Boolean));
    for (const [id, m] of pending) {
      if (refs.has(id) && !['WAITING', 'CHECKING'].includes(m.validation)) { store.insert('attachments', { ...m, grnId: g.id }); pending.delete(id); }
    }
  }
  function doSave(silent) {
    if ([...pending.values()].some((m) => ['WAITING', 'CHECKING'].includes(m.validation))) { toast('Please wait for uploads to finish validating.', 'warning'); return null; }
    try {
      persistPending();
      const saved = saveGrn(g, user, 'Draft saved from wizard');
      const wasNew = g.isNew;
      g = clone(saved); dirty = false;
      if (!silent) toast(`${g.id} saved as ${titleCase(g.status)}.`, 'success', 'Draft saved');
      if (wasNew) history.replaceState(null, '', `#/grn/${g.id}/edit`);
      setMeta({ title: `Edit ${g.id}`, crumbs: [{ label: 'Stock Receiving', href: '#/grn' }, { label: 'All GRNs', href: '#/grn' }, g.id] });
      drawFoot(); drawStepper();
      return g;
    } catch (err) { toast(err.message, 'error'); return null; }
  }

  // ---------------- Step 1 ----------------
  function step1() {
    const sups = store.all('suppliers');
    const locs = store.all('locations').filter((l) => l.active || l.id === g.locationId);
    stepHost.innerHTML = `<div class="grid grid-3-1">
      ${card('Receiving Information', `<div class="form-grid">
        <div class="field col-4"><label>GRN Number</label><input class="input" value="${esc(g.id)}" readonly><span class="field-hint">Auto-generated</span></div>
        <div class="field col-4"><label>Date & Time</label><input class="input" value="${esc(fmtDateTime(g.receivedAt))}" readonly><span class="field-hint">Captured automatically</span></div>
        <div class="field col-4"><label>Received By</label><input class="input" value="${esc(userName(g.receivedBy))}" readonly></div>
        <div class="field col-8" data-fld="supplier"><label>Supplier <span class="req">*</span></label><div data-sup></div></div>
        <div class="field col-4"><label>Receiving Location <span class="req">*</span></label><select class="input" data-k="locationId">${locs.map((l) => `<option value="${l.id}" ${l.id === g.locationId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select><span class="field-hint">${store.all('locations').length - locs.length} more location(s) configurable in Settings</span></div>
        <div class="field col-4" data-fld="invoiceNo"><label>Supplier Invoice Number <span class="req">*</span></label><input class="input" data-k="invoiceNo" value="${esc(g.invoiceNo)}" placeholder="e.g. SMP/26-27/1500"></div>
        <div class="field col-4" data-fld="invoiceDate"><label>Invoice Date <span class="req">*</span></label><input class="input" type="date" data-k="invoiceDate" max="${ymd()}" value="${esc(g.invoiceDate)}"></div>
        <div class="field col-4"><label>Invoice Amount (₹)</label><input class="input" type="number" min="0" step="0.01" data-k="invoiceAmount" value="${esc(g.invoiceAmount)}" placeholder="Grand total on invoice"><span class="field-hint">Used to check against calculated total</span></div>
        <div class="field col-4"><label>Purchase Reference No.</label><input class="input" data-k="poRef" value="${esc(g.poRef)}" placeholder="Optional, e.g. PO-NH-0123"></div>
        <div class="field col-8"><label>Remarks</label><input class="input" data-k="remarks" value="${esc(g.remarks)}" placeholder="Delivery condition, transporter, temperature log…"></div>
      </div><div data-s1-errs class="mt-2"></div>`)}
      <div data-supinfo></div></div>`;
    combo(stepHost.querySelector('[data-sup]'), {
      options: sups.map((s) => ({ value: s.id, label: s.name, sub: `${s.code} · ${s.status === 'ACTIVE' ? s.contactPerson : 'INACTIVE'}`, disabled: s.status !== 'ACTIVE' && s.id !== g.supplierId, keywords: s.gstNumber })),
      value: g.supplierId, placeholder: 'Search supplier by name or code…',
      onChange: (v) => { g.supplierId = v; markDirty(); drawSupInfo(); drawFoot(); checkS1(); }
    });
    stepHost.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('input', () => { g[inp.dataset.k] = inp.value; markDirty(); drawFoot(); checkS1(); }));
    drawSupInfo(); checkS1(true);
  }
  function checkS1(initial) {
    const host = stepHost.querySelector('[data-s1-errs]'); if (!host) return;
    const errs = validateGrn(g).errors.filter((e) => e.step === 1);
    const dup = errs.find((e) => e.msg.startsWith('Duplicate'));
    host.innerHTML = dup ? `<div class="alert alert-danger">${icon('copy-x')}<div>${esc(dup.msg)}</div></div>` : (!initial && errs.length ? '' : '');
    refreshIcons(host);
  }
  function drawSupInfo() {
    const host = stepHost.querySelector('[data-supinfo]'); const s = store.get('suppliers', g.supplierId);
    if (!s) { host.innerHTML = card('Supplier', emptyState('truck', 'No supplier selected', 'Choose the supplier who delivered this consignment.')); refreshIcons(host); return; }
    const last = store.all('grns').filter((x) => x.supplierId === s.id && x.status === 'POSTED').sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
    host.innerHTML = card('Supplier', `<div class="cell-main">${esc(s.name)}</div><div class="cell-sub mb-2">${esc(s.address)}</div>
      <div class="kv"><span>Code</span><span>${esc(s.code)}</span></div><div class="kv"><span>Contact</span><span>${esc(s.contactPerson)}</span></div>
      <div class="kv"><span>Phone</span><span>${esc(s.phone)}</span></div><div class="kv"><span>GSTIN</span><span class="mono">${esc(s.gstNumber)}</span></div>
      <div class="kv"><span>Status</span><span>${badge(s.status)}</span></div><div class="kv"><span>Last posted GRN</span><span>${last ? `<a href="#/grn/${last.id}">${last.id}</a>` : '—'}</span></div>`);
    refreshIcons(host);
  }

  // ---------------- Step 2 ----------------
  function step2() {
    const s = store.settings();
    stepHost.innerHTML = `<div class="alert alert-info mb-2">${icon('info')}<div><strong>Attach the supplier invoice and photos of the delivery.</strong> Each file is checked automatically for type, size and readability. Quantities, batch numbers and expiry dates must still be checked against the actual packs received.</div></div>
      <div class="grid grid-2">
        ${card('A. Supplier Invoice', `<div data-inv></div>`, { sub: 'Image (JPG, PNG, WEBP) or PDF · one file · max ' + s.maxFileSizeMB + ' MB' })}
        ${card('B. Delivery / Stock Photographs', `<div data-photos></div>`, { sub: `Multiple images · up to ${s.maxDeliveryPhotos} photos · max ${s.maxFileSizeMB} MB each` })}
      </div>`;
    drawInvoice(); drawPhotos();
  }
  function nextAttId(offset = 0) {
    const all = [...store.all('attachments').map((a) => a.id), ...pending.keys()];
    const max = all.reduce((m, id) => Math.max(m, +(id.split('-')[1]) || 0), 0);
    return 'ATT-' + String(max + 1 + offset).padStart(4, '0');
  }
  function acceptFile(file, category) {
    const s = store.settings();
    const okTypes = category === 'INVOICE' ? ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf'] : ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/heic'];
    if (!okTypes.includes(file.type)) return `${file.name}: unsupported file type (${file.type || 'unknown'}). ${category === 'INVOICE' ? 'Use an image or PDF.' : 'Use JPG, PNG or WEBP images.'}`;
    if (file.size > s.maxFileSizeMB * 1048576) return `${file.name}: ${fileSize(file.size)} exceeds the ${s.maxFileSizeMB} MB limit.`;
    if (file.size === 0) return `${file.name}: file is empty.`;
    return null;
  }
  async function ingest(file, category, onTick) {
    const id = nextAttId();
    const meta = { id, grnId: 'PENDING', category, name: file.name, type: file.type, size: file.size, src: null, storage: 'idb', validation: 'WAITING', uploadedBy: user.id, uploadedAt: new Date().toISOString(), progress: 0 };
    pending.set(id, meta);
    await saveBlob(id, file);
    // upload progress + automatic file checks (type, size, image resolution)
    for (let p = 20; p <= 100; p += 20) { await new Promise((r) => setTimeout(r, 140)); meta.progress = p; onTick(); }
    meta.validation = 'CHECKING'; onTick();
    await new Promise((r) => setTimeout(r, 900));
    let result;
    if (category === 'INVOICE') result = file.type === 'application/pdf' || /inv|bill|tax/i.test(file.name) ? 'INVOICE_DETECTED' : 'INVOICE_REVIEW';
    else {
      result = 'PHOTO_UPLOADED';
      if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
        const dims = await new Promise((r) => { const img = new Image(); img.onload = () => r([img.naturalWidth, img.naturalHeight]); img.onerror = () => r([0, 0]); img.src = URL.createObjectURL(file); });
        if (Math.min(...dims) < 480) result = 'NEEDS_MANUAL_REVIEW';
      }
    }
    meta.validation = result; delete meta.progress; markDirty(); onTick();
    return id;
  }
  function fileCard(id, removable = true) {
    const m = metaOf(id); if (!m) return '';
    const isPdf = m.type === 'application/pdf';
    return `<div class="file-card"><div class="file-thumb" data-preview="${id}">${isPdf ? icon('file-text') : `<img data-src="${id}" alt="">`}</div>
      <div class="file-meta"><strong title="${esc(m.name)}">${esc(m.name)}</strong><div class="muted small">${isPdf ? 'PDF document' : 'Image'} · ${fileSize(m.size)}</div>
      <div class="ai-status mt-1">${m.progress != null && m.progress < 100 ? `<div class="progress grow"><span style="width:${m.progress}%"></span></div><span class="small muted">${m.progress}%</span>` : vBadge(m.validation)}</div></div>
      <div class="row" style="flex-direction:column">${removable ? `<button class="btn btn-ghost btn-sm" data-preview="${id}" title="Preview">${icon('maximize-2')}</button><button class="btn btn-ghost btn-sm text-danger" data-remove="${id}" title="Remove">${icon('trash-2')}</button>` : ''}</div></div>`;
  }
  async function hydrateThumbs(host) {
    for (const img of host.querySelectorAll('img[data-src]')) { const url = await attachmentURL(metaOf(img.dataset.src)); if (url) img.src = url; }
  }
  function drawInvoice() {
    const host = stepHost.querySelector('[data-inv]'); if (!host) return;
    const id = g.attachments.invoice;
    host.innerHTML = '';
    if (id) {
      host.innerHTML = fileCard(id) + `<div class="ai-note mt-1">${icon('info')}<span>Keep the original invoice with the delivery file. Values on this screen must match the invoice.</span></div>
        <button class="btn btn-secondary btn-sm mt-1" data-replace>${icon('replace')}Replace invoice</button>`;
      host.querySelector('[data-replace]').onclick = pickReplace;
    } else {
      host.appendChild(dropzone({ label: 'Drop the supplier invoice here', hint: 'Image or PDF', onFiles: (files) => handleInvoice(files[0]) }));
    }
    wireFileActions(host, 'INVOICE'); refreshIcons(host); hydrateThumbs(host);
  }
  function pickReplace() {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*,application/pdf' });
    inp.onchange = () => inp.files[0] && handleInvoice(inp.files[0]);
    inp.click();
  }
  async function handleInvoice(file) {
    const err = acceptFile(file, 'INVOICE');
    if (err) { toast(err, 'error', 'Upload rejected'); return; }
    const old = g.attachments.invoice;
    if (old && pending.has(old)) { pending.delete(old); deleteBlob(old).catch(() => {}); }
    const p = ingest(file, 'INVOICE', () => drawInvoice());
    g.attachments.invoice = [...pending.keys()].at(-1); // ingest() registers the id synchronously
    drawInvoice();
    await p; drawInvoice(); drawStepper(); drawFoot();
    toast(`${file.name} uploaded.`, 'success', 'Invoice attached');
  }
  function drawPhotos() {
    const host = stepHost.querySelector('[data-photos]'); if (!host) return;
    const max = store.settings().maxDeliveryPhotos;
    const ids = g.attachments.photos;
    host.innerHTML = `<div class="row-between mb-2"><span class="small"><strong>${ids.length}</strong> / ${max} photographs</span>${ids.length ? `<span class="small muted">Click a photo to preview</span>` : ''}</div>
      ${ids.length ? `<div class="photo-grid mb-2">${ids.map((id) => { const m = metaOf(id); return `<div class="photo" data-preview="${id}">${m?.type === 'application/pdf' ? icon('file-text') : `<img data-src="${id}" alt="${esc(m?.name)}">`}
        <button class="photo-x" data-remove="${id}" title="Remove photo">${icon('x')}</button><div class="photo-status">${m?.progress != null && m.progress < 100 ? `<div class="progress"><span style="width:${m.progress}%"></span></div>` : vBadge(m?.validation)}</div></div>`; }).join('')}</div>` : ''}`;
    host.appendChild(dropzone({ label: ids.length >= max ? 'Photo limit reached' : 'Drop delivery photographs here', hint: 'JPG, PNG or WEBP', multiple: true, disabled: ids.length >= max, onFiles: handlePhotos }));
    wireFileActions(host, 'PHOTO'); refreshIcons(host); hydrateThumbs(host);
  }
  async function handlePhotos(files) {
    const max = store.settings().maxDeliveryPhotos;
    const room = max - g.attachments.photos.length;
    if (files.length > room) toast(`Only ${room} more photo(s) can be added (limit ${max}).`, 'warning');
    const jobs = [];
    for (const f of files.slice(0, Math.max(0, room))) {
      const err = acceptFile(f, 'PHOTO');
      if (err) { toast(err, 'error', 'Upload rejected'); continue; }
      const p = ingest(f, 'DELIVERY_PHOTO', () => drawPhotos());
      g.attachments.photos.push([...pending.keys()].at(-1));
      jobs.push(p);
    }
    drawPhotos();
    if (jobs.length) { await Promise.all(jobs); drawPhotos(); drawStepper(); drawFoot(); toast(`${jobs.length} photograph(s) uploaded.`, 'success'); }
  }
  function wireFileActions(host, kind) {
    host.querySelectorAll('[data-remove]').forEach((b) => { b.onclick = async (e) => {
      e.stopPropagation();
      const id = b.dataset.remove;
      if (!(await confirmDialog({ title: 'Remove file?', message: `Remove <strong>${esc(metaOf(id)?.name)}</strong> from this GRN?`, confirmLabel: 'Remove', tone: 'danger', iconName: 'trash-2' }))) return;
      if (kind === 'INVOICE') g.attachments.invoice = null; else g.attachments.photos = g.attachments.photos.filter((x) => x !== id);
      if (pending.has(id)) { pending.delete(id); deleteBlob(id).catch(() => {}); }
      markDirty(); kind === 'INVOICE' ? drawInvoice() : drawPhotos(); drawStepper(); drawFoot();
    }; });
    host.querySelectorAll('[data-preview]').forEach((b) => { b.onclick = (e) => { if (e.target.closest('[data-remove]')) return; previewAttachment(metaOf(b.dataset.preview)); }; });
  }

  // ---------------- Step 3 ----------------
  function step3() {
    stepHost.innerHTML = `<div class="grid grid-3-1"><div>
        <div class="row-between mb-2"><div><h2>Medicine Line Items</h2><p class="muted small">One GRN can hold many medicines; the same medicine can be added again for each batch received.</p></div>
        <button class="btn btn-primary" data-add>${icon('plus')}Add Medicine</button></div>
        <div data-lines></div>
        <button class="btn btn-secondary btn-block" data-add>${icon('plus')}Add another medicine</button>
      </div><div><div class="sticky-side" data-summary></div></div></div>`;
    drawLines(); drawSummary();
    stepHost.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => addLine(); });
  }
  const blankLine = (medicineId = '') => {
    const m = medicineId && store.get('medicines', medicineId);
    const last = m && [...store.all('batches')].filter((b) => b.medicineId === m.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
    return { lineId: g.id + '-L' + (Math.max(0, ...g.items.map((i) => +(i.lineId.split('-L')[1]) || 0)) + 1), medicineId, batchNo: '', mfgDate: '', expiryDate: '', invoiceQty: '', receivedQty: '', freeQty: 0,
      ptr: last ? last.ptr : '', mrp: last ? last.mrp : '', discountPct: 0, gstPct: m ? m.gstPct : 12, remarks: '', batchId: null };
  };
  function addLine(medicineId = '', afterIndex) {
    const line = blankLine(medicineId);
    if (afterIndex != null) g.items.splice(afterIndex + 1, 0, line); else g.items.push(line);
    markDirty(); drawLines(); drawSummary(); drawFoot();
    const idx = afterIndex != null ? afterIndex + 1 : g.items.length - 1;
    setTimeout(() => { const el = stepHost.querySelectorAll('.line-card')[idx]; el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); (medicineId ? el?.querySelector('[data-k=batchNo]') : el?.querySelector('.combo input'))?.focus(); }, 60);
  }
  function lineHTML(it, i) {
    const m = it.medicineId && store.get('medicines', it.medicineId);
    const c = lineCalc(it);
    const f = (k, label, type = 'text', extra = '', col = 'col-2', req) => `<div class="field ${col}"><label>${label}${req ? ' <span class="req">*</span>' : ''}</label><input class="input" type="${type}" data-k="${k}" value="${esc(it[k] ?? '')}" ${extra}></div>`;
    const sameMed = m ? g.items.filter((x) => x.medicineId === m.id).length : 0;
    return `<div class="line-card" data-line="${i}">
      <div class="line-head"><div class="row"><span class="line-no">${i + 1}</span><strong>${m ? esc(m.brandName) : 'New line item'}</strong>${m ? `<span class="muted small">${esc(m.code)}</span>` : ''}${sameMed > 1 ? `<span class="tag tag-info">${sameMed} batches of this medicine</span>` : ''}</div>
        <div class="row"><span class="small muted">Line total</span><span class="line-total" data-lt>${fmtINR(c.total)}</span>
        ${m ? `<button class="btn btn-ghost btn-sm" data-dup title="Add another batch of this medicine">${icon('copy-plus')}Another batch</button>` : ''}
        <button class="btn btn-ghost btn-sm text-danger" data-del title="Remove line">${icon('trash-2')}</button></div></div>
      <div class="line-body">
        <div class="field col-12"><label>Medicine <span class="req">*</span></label><div data-med></div>${m ? `<div class="cell-sub mt-1">${esc(m.genericName)} · ${esc(m.strength)} · ${esc(m.form)} · ${esc(m.manufacturer)} · ${esc(m.packSize)}</div>` : ''}</div>
        ${f('batchNo', 'Batch No.', 'text', 'placeholder="As on pack" style="text-transform:uppercase"', 'col-3', true)}
        ${f('mfgDate', 'Mfg. date', 'date', `max="${ymd()}"`, 'col-3', true)}
        ${f('expiryDate', 'Expiry date', 'date', '', 'col-3', true)}
        ${f('receivedQty', 'Qty received', 'number', 'min="1" step="1" placeholder="Counted"', 'col-3', true)}
        ${f('freeQty', 'Free qty', 'number', 'min="0" step="1"', 'col-3')}
        ${f('ptr', 'Purchase rate (PTR) ₹', 'number', 'min="0" step="0.01"', 'col-3', true)}
        ${f('mrp', 'MRP ₹', 'number', 'min="0" step="0.01"', 'col-3', true)}
        <div class="col-12"><button type="button" class="more-toggle" data-linemore>${icon(openMore.has(i) ? 'minus' : 'plus')}${openMore.has(i) ? 'Hide extra details' : 'Invoice qty, discount, GST, remarks'}</button></div>
        <div class="col-12 line-extra ${openMore.has(i) ? '' : 'collapsible closed'}"><div class="line-body" style="padding:0">
          ${f('invoiceQty', 'Qty on invoice', 'number', 'min="0" step="1" placeholder="Billed"', 'col-2')}
          ${f('discountPct', 'Discount %', 'number', 'min="0" max="100" step="0.1"', 'col-2')}
          <div class="field col-2"><label>GST %</label><select class="input" data-k="gstPct">${[0, 5, 12, 18, 28].map((r) => `<option ${Number(it.gstPct) === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
          <div class="field col-2"><label>Total qty</label><input class="input" data-tq value="${c.totalQty}" readonly></div>
          <div class="field col-2"><label>Line total ₹</label><input class="input strong" data-ltv value="${c.total.toFixed(2)}" readonly></div>
          ${f('remarks', 'Remarks', 'text', 'placeholder="Optional"', 'col-2')}
          <div class="line-meta" data-meta>${metaLine(it, m)}</div>
        </div></div>
      </div>
      <div class="line-issues" data-issues></div></div>`;
  }
  function metaLine(it, m) {
    const c = lineCalc(it); const d = it.expiryDate ? daysUntil(it.expiryDate) : null;
    return `<span>Gross <b>${fmtINR(c.gross)}</b></span><span>Discount <b>${fmtINR(c.discount)}</b></span><span>Taxable <b>${fmtINR(c.taxable)}</b></span><span>GST <b>${fmtINR(c.gst)}</b></span>
      ${m ? `<span>Stock units: <b>${fmtNum(c.totalQty)} ${esc(m.unit)}(s)</b></span>` : ''}${d != null ? `<span>Expiry: <b class="${d < 0 ? 'text-danger' : d <= store.settings().expiryThresholdDays ? 'text-warning' : 'text-success'}">${d < 0 ? 'EXPIRED' : d + ' days left'}</b></span>` : ''}
      ${Number(it.mrp) > 0 && Number(it.ptr) > 0 ? `<span>Margin on MRP <b>${(((it.mrp - it.ptr) / it.mrp) * 100).toFixed(1)}%</b></span>` : ''}`;
  }
  function drawLines() {
    const host = stepHost.querySelector('[data-lines]'); if (!host) return;
    host.innerHTML = g.items.length ? g.items.map(lineHTML).join('') : `<div class="card">${emptyState('pill', 'No medicines added yet', 'Add each medicine and batch exactly as received in the delivery.', `<button class="btn btn-primary" data-add-empty>${icon('plus')}Add Medicine</button>`)}</div>`;
    host.querySelector('[data-add-empty]')?.addEventListener('click', () => addLine());
    host.querySelectorAll('[data-line]').forEach((el) => wireLine(el, +el.dataset.line));
    refreshIcons(host);
    drawIssues();
  }
  function medOptions() {
    return store.all('medicines').filter((m) => m.active).map((m) => ({ value: m.id, label: m.brandName, sub: `${m.genericName} · ${m.strength} · ${m.form} · ${m.code}`, keywords: m.manufacturer + ' ' + m.barcode }));
  }
  function wireLine(el, i) {
    const it = g.items[i];
    el.querySelector('[data-linemore]').onclick = () => { openMore.has(i) ? openMore.delete(i) : openMore.add(i); drawLines(); };
    combo(el.querySelector('[data-med]'), {
      options: medOptions, value: it.medicineId, placeholder: 'Search medicine master…',
      footer: can('medicine.manage') ? { html: `${icon('plus-circle')} Create new medicine`, onClick: () => quickMedicine((id) => { setMedicine(i, id); }) } : null,
      onChange: (v) => setMedicine(i, v)
    });
    el.querySelectorAll('[data-k]').forEach((inp) => {
      inp.addEventListener('input', () => {
        let v = inp.value;
        if (inp.dataset.k === 'batchNo') v = v.toUpperCase();
        it[inp.dataset.k] = inp.type === 'number' || inp.tagName === 'SELECT' ? (v === '' ? '' : Number(v)) : v;
        markDirty();
        const c = lineCalc(it);
        el.querySelector('[data-lt]').textContent = fmtINR(c.total);
        el.querySelector('[data-ltv]').value = c.total.toFixed(2);
        el.querySelector('[data-tq]').value = c.totalQty;
        el.querySelector('[data-meta]').innerHTML = metaLine(it, store.get('medicines', it.medicineId));
        drawSummary(); drawFoot(); debIssues();
      });
      if (inp.dataset.k === 'batchNo') inp.addEventListener('blur', () => { inp.value = inp.value.trim().toUpperCase(); it.batchNo = inp.value; });
    });
    el.querySelector('[data-del]').onclick = async () => {
      if ((it.medicineId || it.batchNo) && !(await confirmDialog({ title: 'Remove line?', message: `Remove line ${i + 1}${it.medicineId ? ` (${esc(medName(it.medicineId))})` : ''} from this GRN?`, confirmLabel: 'Remove', tone: 'danger', iconName: 'trash-2' }))) return;
      g.items.splice(i, 1); markDirty(); drawLines(); drawSummary(); drawFoot();
    };
    el.querySelector('[data-dup]')?.addEventListener('click', () => addLine(it.medicineId, i));
  }
  function setMedicine(i, id) {
    const it = g.items[i]; const m = store.get('medicines', id);
    it.medicineId = id; it.gstPct = m.gstPct;
    const last = [...store.all('batches')].filter((b) => b.medicineId === id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
    if (last && !it.ptr) it.ptr = last.ptr;
    if (last && !it.mrp) it.mrp = last.mrp;
    markDirty(); drawLines(); drawSummary();
    setTimeout(() => stepHost.querySelectorAll('.line-card')[i]?.querySelector('[data-k=batchNo]')?.focus(), 30);
  }
  const debIssues = debounce(drawIssues, 350);
  function drawIssues() {
    const v = validateGrn(g);
    stepHost.querySelectorAll('[data-line]').forEach((el) => {
      const L = +el.dataset.line + 1;
      const errs = v.errors.filter((e) => e.line === L); const warns = v.warnings.filter((w) => w.line === L);
      const touched = g.items[L - 1].batchNo || g.items[L - 1].receivedQty !== '';
      el.classList.toggle('has-err', touched && errs.length > 0);
      el.querySelector('[data-issues]').innerHTML = (touched ? errs : []).map((e) => `<div class="alert alert-danger">${icon('alert-circle')}<span>${esc(e.msg.replace(/^Line \d+ \([^)]*\): /, ''))}</span></div>`).join('')
        + warns.map((w) => `<div class="alert alert-warning">${icon('alert-triangle')}<span>${esc(w.msg.replace(/^Line \d+ \([^)]*\): /, ''))}</span></div>`).join('');
      refreshIcons(el.querySelector('[data-issues]'));
    });
  }
  function drawSummary() {
    const host = stepHost.querySelector('[data-summary]'); if (!host) return;
    const t = grnTotals(g);
    const inv = Number(g.invoiceAmount) || 0;
    host.innerHTML = `<div class="summary-box"><h3>Live Calculation Summary</h3>
      <div class="summary-row"><span>Line items</span><b>${t.lines}</b></div>
      <div class="summary-row"><span>Distinct medicines</span><b>${t.medicines}</b></div>
      <div class="summary-row"><span>Total received qty</span><b>${fmtNum(t.qty)}</b></div>
      <div class="summary-row"><span>Total free qty</span><b>${fmtNum(t.free)}</b></div>
      <div class="summary-row"><span>Subtotal (gross)</span><b>${fmtINR(t.gross)}</b></div>
      <div class="summary-row"><span>Discount</span><b>− ${fmtINR(t.discount)}</b></div>
      <div class="summary-row"><span>Taxable value</span><b>${fmtINR(t.taxable)}</b></div>
      <div class="summary-row"><span>GST</span><b>+ ${fmtINR(t.gst)}</b></div>
      <div class="summary-row total"><span>Grand total</span><span>${fmtINR(t.grand)}</span></div>
      ${inv ? `<div class="summary-row"><span>Invoice amount</span><b>${fmtINR(inv)}</b></div><div class="summary-row"><span>Difference</span><b style="color:${Math.abs(inv - t.grand) > Math.max(1, inv * 0.01) ? '#ffc27a' : '#8ee3df'}">${fmtINR(t.grand - inv)}</b></div>` : ''}
    </div>
    <div class="ai-note mt-2">${icon('calculator')}<span>Line total = (Received Qty × PTR − Discount) + GST. Free quantity adds stock at no cost. MRP is stored on the batch for reference only.</span></div>`;
    refreshIcons(host);
  }
  function quickMedicine(onCreated) {
    const cats = store.all('categories');
    openModal({ title: 'Create new medicine', subtitle: 'Adds a medicine to the master. Batch, expiry, MRP and PTR are captured on the GRN line, not here.', size: 'lg',
      body: `<form class="form-grid" data-qm>
        <div class="field col-6"><label>Brand Name <span class="req">*</span></label><input class="input" name="brandName" data-rules="required"></div>
        <div class="field col-6"><label>Generic Name <span class="req">*</span></label><input class="input" name="genericName" data-rules="required"></div>
        <div class="field col-4"><label>Strength <span class="req">*</span></label><input class="input" name="strength" data-rules="required" placeholder="e.g. 500 mg"></div>
        <div class="field col-4"><label>Dosage Form</label><select class="input" name="form">${['Tablet', 'Capsule', 'Syrup', 'Injection', 'Cream', 'Drops', 'IV Fluid', 'Consumable', 'Ointment', 'Powder'].map((x) => `<option>${x}</option>`).join('')}</select></div>
        <div class="field col-4"><label>Category</label><select class="input" name="category">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field col-6"><label>Manufacturer <span class="req">*</span></label><input class="input" name="manufacturer" data-rules="required"></div>
        <div class="field col-3"><label>Stock Unit</label><select class="input" name="unit">${['Strip', 'Bottle', 'Vial', 'Ampoule', 'Tube', 'Piece', 'Pair', 'Box', 'Roll'].map((x) => `<option>${x}</option>`).join('')}</select></div>
        <div class="field col-3"><label>GST %</label><select class="input" name="gstPct">${[0, 5, 12, 18, 28].map((x) => `<option ${x === 12 ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="field col-4"><label>Pack Size</label><input class="input" name="packSize" placeholder="e.g. 10 tablets/strip"></div>
        <div class="field col-4"><label>Reorder Level <span class="req">*</span></label><input class="input" type="number" name="reorderLevel" value="20" data-rules="required,nonNegInt"></div>
        <div class="field col-4"><label>HSN Code</label><input class="input" name="hsnCode" value="30049099"></div>
      </form>`,
      footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Create medicine', cls: 'btn-primary', icon: 'plus', onClick: async (close, wrap) => {
        const form = wrap.querySelector('[data-qm]');
        const { validateForm } = await import('../validation.js');
        if (!validateForm(form)) return;
        const d = Object.fromEntries(new FormData(form));
        const { createMedicine } = await import('./medicines.js');
        const med = createMedicine(d, user);
        toast(`${med.brandName} added to medicine master (${med.code}).`);
        close(); onCreated(med.id);
      } }] });
  }

  // ---------------- Step 4 ----------------
  function step4() {
    const v = validateGrn(g); const t = grnTotals(g); const s = store.get('suppliers', g.supplierId);
    const inv = g.attachments.invoice; const photos = g.attachments.photos;
    stepHost.innerHTML = `
      ${v.errors.length ? `<div class="alert alert-danger mb-2">${icon('octagon-x')}<div><strong>${v.errors.length} issue(s) must be fixed before this GRN can be submitted</strong><ul>${v.errors.map((e) => `<li>${esc(e.msg)} <button class="link small" data-go="${e.step}">Go to step ${e.step}</button></li>`).join('')}</ul></div></div>`
        : `<div class="alert alert-success mb-2">${icon('check-circle-2')}<div><strong>All mandatory checks passed.</strong> Review the warnings below, confirm physical verification, then continue to submit.</div></div>`}
      ${v.warnings.length ? `<div class="alert alert-warning mb-2">${icon('alert-triangle')}<div><strong>${v.warnings.length} warning(s) to review</strong><ul>${v.warnings.map((w) => `<li>${esc(w.msg)}</li>`).join('')}</ul></div></div>` : ''}
      ${v.exceptions.length ? `<div class="alert alert-info mb-2">${icon('shield-alert')}<div><strong>Owner approval will be required at posting</strong> (configurable approval policy):<ul>${v.exceptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>` : ''}
      <div class="grid grid-3">
        ${card('Supplier', s ? `<div class="cell-main">${esc(s.name)}</div><div class="cell-sub">${esc(s.address)}</div><div class="kv mt-1"><span>GSTIN</span><span class="mono">${esc(s.gstNumber)}</span></div><div class="kv"><span>Contact</span><span>${esc(s.contactPerson)} · ${esc(s.phone)}</span></div>` : '<span class="text-danger">Not selected</span>', { actions: `<button class="btn btn-ghost btn-sm" data-go="1">${icon('pencil')}Edit</button>` })}
        ${card('Invoice Details', `<div class="kv"><span>GRN</span><strong>${esc(g.id)}</strong></div><div class="kv"><span>Invoice No.</span><span class="mono">${esc(g.invoiceNo || '—')}</span></div><div class="kv"><span>Invoice Date</span><span>${fmtDate(g.invoiceDate)}</span></div><div class="kv"><span>Invoice Amount</span><span>${g.invoiceAmount ? fmtINR(g.invoiceAmount) : '—'}</span></div><div class="kv"><span>PO Reference</span><span>${esc(g.poRef || '—')}</span></div><div class="kv"><span>Location</span><span>${esc(locationName(g.locationId))}</span></div>`, { actions: `<button class="btn btn-ghost btn-sm" data-go="1">${icon('pencil')}Edit</button>` })}
        ${card('Documents', `<div class="kv"><span>Supplier invoice</span><span>${inv ? vBadge(metaOf(inv)?.validation) : '<span class="badge badge-danger">Missing</span>'}</span></div><div class="kv"><span>Delivery photos</span><span>${photos.length ? `<strong>${photos.length}</strong> uploaded` : '<span class="badge badge-danger">Missing</span>'}</span></div>
          <div class="photo-grid mt-1" style="grid-template-columns:repeat(4,1fr)">${[inv, ...photos].filter(Boolean).slice(0, 8).map((id) => `<div class="photo" data-preview="${id}">${metaOf(id)?.type === 'application/pdf' ? icon('file-text') : `<img data-src="${id}" alt="">`}</div>`).join('')}</div>`, { actions: `<button class="btn btn-ghost btn-sm" data-go="2">${icon('pencil')}Edit</button>` })}
      </div>
      ${card('Medicines & Batches', reviewTable(g, v), { cls: 'flush mt-2', actions: `<button class="btn btn-ghost btn-sm" data-go="3">${icon('pencil')}Edit lines</button>` })}
      <div class="grid grid-3-1 mt-2">
        <section class="card"><div class="card-body">
          <label class="check"><input type="checkbox" data-confirm ${confirmed ? 'checked' : ''}> <span><strong>I confirm the physical verification.</strong> I have counted the received quantities and checked batch numbers, expiry dates and MRP against the actual packs delivered — not only against the invoice.</span></label>
        </div></section>
        <div class="summary-box"><div class="summary-row"><span>Lines / Medicines</span><b>${t.lines} / ${t.medicines}</b></div><div class="summary-row"><span>Received + Free</span><b>${fmtNum(t.qty)} + ${fmtNum(t.free)}</b></div><div class="summary-row"><span>Taxable</span><b>${fmtINR(t.taxable)}</b></div><div class="summary-row"><span>GST</span><b>${fmtINR(t.gst)}</b></div><div class="summary-row total"><span>Grand total</span><span>${fmtINR(t.grand)}</span></div></div>
      </div>`;
    stepHost.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(+b.dataset.go); });
    stepHost.querySelector('[data-confirm]').onchange = (e) => { confirmed = e.target.checked; };
    stepHost.querySelectorAll('[data-preview]').forEach((b) => { b.onclick = () => previewAttachment(metaOf(b.dataset.preview)); });
    hydrateThumbs(stepHost);
  }

  // ---------------- Step 5 ----------------
  function step5() {
    const v = validateGrn(g);
    const canPost = can('grn.post');
    const needsOwner = v.exceptions.length > 0 && !can('grn.approve.exceptional');
    stepHost.innerHTML = `<div class="grid grid-3-1">
      ${card('Submit & Post', `
        <p class="muted mb-2">Choose what to do with <strong>${esc(g.id)}</strong>. Stock is added to inventory <strong>only</strong> when the GRN is posted — drafts, submitted or rejected GRNs never change available stock.</p>
        ${!v.ok ? `<div class="alert alert-danger mb-2">${icon('octagon-x')}<div>${v.errors.length} validation issue(s) remain. You can save a draft, but submission is blocked. <button class="link" data-go="4">Review issues</button></div></div>` : ''}
        ${!confirmed && v.ok ? `<div class="alert alert-warning mb-2">${icon('square-check')}<div>Tick the physical-verification confirmation on the Review step before submitting. <button class="link" data-go="4">Go to review</button></div></div>` : ''}
        <div class="grid grid-2">
          <div class="card"><div class="card-body"><h3>${icon('save')} Save as Draft</h3><p class="muted small mt-1 mb-2">Keep working later. Does not notify anyone.</p><button class="btn btn-secondary btn-block" data-do="draft">Save as Draft</button></div></div>
          <div class="card"><div class="card-body"><h3>${icon('send')} Submit for Verification</h3><p class="muted small mt-1 mb-2">Sends the GRN to the Pharmacy Manager for checking.</p><button class="btn btn-navy btn-block" data-do="submit" ${!v.ok || !confirmed ? 'disabled' : ''}>Submit for Verification</button></div></div>
          ${canPost ? `<div class="card" style="border-color:#bfe3e1"><div class="card-body"><h3>${icon('package-check')} ${needsOwner ? 'Verify & Send for Owner Approval' : 'Verify & Post Stock'}</h3><p class="muted small mt-1 mb-2">${needsOwner ? 'Exceptions found — the owner must approve before stock is posted.' : 'Adds stock to batches, records movements and notifies the owner.'}</p><button class="btn btn-primary btn-block" data-do="post" ${!v.ok || !confirmed ? 'disabled' : ''}>${needsOwner ? 'Verify & Escalate' : 'Post Stock'}</button></div></div>`
            : `<div class="card"><div class="card-body"><h3>${icon('lock')} Post Stock</h3><p class="muted small mt-1">Only a Pharmacy Manager or the Owner can verify and post stock.</p></div></div>`}
          <div class="card"><div class="card-body"><h3>${icon('circle-slash')} Cancel GRN</h3><p class="muted small mt-1 mb-2">${g.isNew ? 'Discard this unsaved GRN.' : 'Mark as cancelled with a reason (kept for audit).'}</p><button class="btn btn-danger-outline btn-block" data-do="cancel">Cancel GRN</button></div></div>
        </div>`)}
      ${card('Approval Policy', `<ul class="list-plain small">
          <li class="list-row"><span>Routine receipts</span><span>Manager posts</span></li>
          <li class="list-row"><span>Expired / short-dated (≤ ${store.settings().approval.shortDatedDays} d)</span><span>Owner approval</span></li>
          <li class="list-row"><span>Qty variance > ${store.settings().approval.discrepancyPctThreshold}%</span><span>Owner approval</span></li>
          <li class="list-row"><span>Value > ${fmtINR(store.settings().approval.highValueThreshold, true)}</span><span>Owner approval</span></li>
          <li class="list-row"><span>On posting</span><span>Owner notified</span></li></ul>
          ${v.exceptions.length ? `<div class="alert alert-info mt-1">${icon('shield-alert')}<div>This GRN has ${v.exceptions.length} exception(s).</div></div>` : `<div class="alert alert-success mt-1">${icon('check')}<div>Routine receipt — no owner approval needed.</div></div>`}`)}
    </div>`;
    stepHost.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(+b.dataset.go); });
    stepHost.querySelectorAll('[data-do]').forEach((b) => { b.onclick = () => finish(b.dataset.do, b); });
  }
  async function finish(action, btn) {
    if (action === 'draft') { if (doSave()) navigate('#/grn/' + g.id); return; }
    if (action === 'cancel') {
      if (g.isNew) { if (await confirmDialog({ title: 'Discard GRN?', message: 'This GRN has not been saved. Discard it?', confirmLabel: 'Discard', tone: 'danger', iconName: 'trash-2' })) { dirty = false; for (const id of pending.keys()) deleteBlob(id).catch(() => {}); navigate('#/grn'); } return; }
      const r = await confirmDialog({ title: `Cancel ${g.id}?`, message: 'The GRN will be marked CANCELLED. It stays in the records for audit and cannot be posted.', confirmLabel: 'Cancel GRN', tone: 'danger', reason: true, reasonLabel: 'Cancellation reason', iconName: 'circle-slash' });
      if (!r) return;
      try { cancelGrn(g.id, user, r.reason); dirty = false; toast(`${g.id} cancelled.`, 'info'); navigate('#/grn/' + g.id); } catch (e) { toast(e.message, 'error'); }
      return;
    }
    const v = validateGrn(g);
    if (action === 'post') {
      const t = grnTotals(g);
      const needsOwner = v.exceptions.length && !can('grn.approve.exceptional');
      const ok = await confirmDialog({ title: needsOwner ? 'Verify and escalate?' : 'Post stock to inventory?', iconName: needsOwner ? 'shield-alert' : 'package-check',
        message: needsOwner ? `The GRN will be verified and sent to the Hospital Owner for approval because:<ul>${v.exceptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<strong>${t.lines}</strong> batch line(s), <strong>${fmtNum(t.totalQty)}</strong> units worth <strong>${fmtINR(t.grand)}</strong> will be added to inventory. A posted GRN cannot be edited.`,
        confirmLabel: needsOwner ? 'Verify & Escalate' : 'Post Stock' });
      if (!ok) return;
    }
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Working…';
    await new Promise((r) => setTimeout(r, 400));
    if ([...pending.values()].some((m) => ['WAITING', 'CHECKING'].includes(m.validation))) { toast('Uploads are still validating.', 'warning'); go(5); return; }
    persistPending();
    const res = submitGrn(g, user);
    g = clone(res.grn); dirty = false;
    if (!res.ok) { toast(`${res.validation.errors.length} issue(s) need fixing. Status set to Validation Required.`, 'error', 'Submission blocked'); go(4); return; }
    if (action === 'submit') { finished = { kind: 'submitted' }; drawDone(); return; }
    try {
      const r = verifyAndPost(g.id, user);
      g = clone(r.grn); finished = { kind: r.posted ? 'posted' : 'escalated', exceptions: r.exceptions };
      drawDone();
    } catch (e) { toast(e.message, 'error'); navigate('#/grn/' + g.id); }
  }
  function drawDone() {
    window.removeEventListener('beforeunload', beforeUnload);
    history.replaceState(null, '', `#/grn/${g.id}/edit`); // a refresh no longer re-opens a blank "new GRN"
    drawStepper(); drawFoot();
    const t = grnTotals(g);
    const conf = {
      submitted: ['send', 'GRN submitted for verification', `${g.id} has been sent to the Pharmacy Manager. Stock will be added once it is verified and posted.`, 'info'],
      posted: ['check-circle-2', 'Stock posted to inventory', `${g.id} is posted. ${t.lines} batch line(s) and ${fmtNum(t.totalQty)} units were added, stock movements were recorded and the owner has been notified.`, 'success'],
      escalated: ['shield-alert', 'Sent for owner approval', `${g.id} was verified and escalated to the Hospital Owner. Stock will be posted after approval.`, 'purple']
    }[finished.kind];
    stepHost.innerHTML = `<section class="card"><div class="card-body"><div class="empty" style="padding:48px 20px">
      <div class="kpi-icon" style="width:64px;height:64px;border-radius:50%;background:var(--${conf[3] === 'success' ? 'success' : conf[3] === 'info' ? 'info' : 'purple'}-50);color:var(--${conf[3] === 'success' ? 'success' : conf[3] === 'info' ? 'info' : 'purple'})">${icon(conf[0])}</div>
      <h2 style="font-size:20px;margin-top:10px">${conf[1]}</h2><p style="max-width:560px">${esc(conf[2])}</p>
      ${finished.kind === 'posted' ? `<div class="row mt-2" style="justify-content:center">${g.items.map((it) => `<a class="chip" href="#/batches/${it.batchId}">${icon('layers')}${esc(medName(it.medicineId))} · ${esc(it.batchNo)}</a>`).join('')}</div>` : ''}
      <div class="row mt-3" style="justify-content:center"><a class="btn btn-primary" href="#/grn/${g.id}">${icon('eye')}View GRN</a>
      ${finished.kind === 'posted' ? `<a class="btn btn-secondary" href="#/inventory">${icon('boxes')}View Inventory</a><a class="btn btn-secondary" href="#/movements?ref=${g.id}">${icon('arrow-left-right')}Stock Movements</a>` : ''}
      <a class="btn btn-ghost" href="#/grn/new" data-new>${icon('plus')}Create another GRN</a></div></div></div></section>`;
    stepHost.querySelector('[data-new]').onclick = (e) => { e.preventDefault(); navigate('#/grn/new'); };
    refreshIcons(stepHost);
    toast(conf[1], conf[3] === 'purple' ? 'info' : conf[3]);
  }

  go(1);
  return () => window.removeEventListener('beforeunload', beforeUnload);
}

function reviewTable(g, v) {
  if (!g.items.length) return emptyState('pill', 'No medicine lines');
  return `<div class="table-scroll"><table class="table dense"><thead><tr><th>#</th><th>Medicine</th><th>Batch</th><th>Mfg</th><th>Expiry</th><th class="ta-right">Inv Qty</th><th class="ta-right">Rcvd</th><th class="ta-right">Free</th><th class="ta-right">PTR</th><th class="ta-right">MRP</th><th class="ta-right">Disc%</th><th class="ta-right">GST%</th><th class="ta-right">Line Total</th>${g.status === 'POSTED' ? '<th>Batch</th>' : '<th>Checks</th>'}</tr></thead><tbody>
    ${g.items.map((it, i) => {
      const m = store.get('medicines', it.medicineId); const c = lineCalc(it); const d = it.expiryDate ? daysUntil(it.expiryDate) : null;
      const errs = v ? v.errors.filter((e) => e.line === i + 1).length : 0; const warns = v ? v.warnings.filter((w) => w.line === i + 1).length : 0;
      const mismatch = it.invoiceQty !== '' && it.invoiceQty != null && Number(it.invoiceQty) !== Number(it.receivedQty);
      return `<tr class="${errs ? 'row-danger' : warns ? 'row-warning' : ''}"><td>${i + 1}</td><td><div class="cell-main">${esc(m?.brandName || '—')}</div><div class="cell-sub">${esc(m ? `${m.genericName} · ${m.strength} · ${m.form}` : '')}</div></td>
        <td class="mono">${esc(it.batchNo || '—')}</td><td>${it.mfgDate ? fmtDate(it.mfgDate) : '<span class="text-warning">—</span>'}</td><td>${fmtDate(it.expiryDate)}${d != null ? `<div class="cell-sub ${d < 0 ? 'text-danger' : d <= store.settings().expiryThresholdDays ? 'text-warning' : ''}">${d < 0 ? 'Expired' : d + ' d'}</div>` : ''}</td>
        <td class="ta-right">${it.invoiceQty === '' || it.invoiceQty == null ? '—' : fmtNum(it.invoiceQty)}</td><td class="ta-right ${mismatch ? 'text-warning strong' : ''}">${fmtNum(it.receivedQty)}</td><td class="ta-right">${fmtNum(it.freeQty || 0)}</td>
        <td class="ta-right">${fmtINR(it.ptr)}</td><td class="ta-right">${fmtINR(it.mrp)}</td><td class="ta-right">${it.discountPct || 0}</td><td class="ta-right">${it.gstPct}</td><td class="ta-right strong">${fmtINR(c.total)}</td>
        <td>${g.status === 'POSTED' && it.batchId ? `<a href="#/batches/${it.batchId}">${badge(batchStatus(store.get('batches', it.batchId)))}</a>` : errs ? `<span class="badge badge-danger">${errs} error</span>` : warns ? `<span class="badge badge-warning">${warns} warning</span>` : '<span class="badge badge-success">OK</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

export async function previewAttachment(m) {
  if (!m) return;
  const url = await attachmentURL(m);
  if (!url) { toast('This file is no longer available in browser storage.', 'warning'); return; }
  const isPdf = m.type === 'application/pdf';
  openModal({ title: m.name, subtitle: `${m.category === 'INVOICE' ? 'Supplier invoice' : 'Delivery photograph'} · ${fileSize(m.size)} · uploaded ${fmtDateTime(m.uploadedAt)} by ${esc(userName(m.uploadedBy))}`, size: 'xl',
    body: isPdf ? `<iframe class="preview-frame" src="${url}" title="${esc(m.name)}"></iframe>` : `<img class="preview-img" src="${url}" alt="${esc(m.name)}">`,
    footer: [{ label: 'Open in new tab', icon: 'external-link', onClick: () => window.open(url, '_blank') }, { label: 'Close', cls: 'btn-primary', onClick: (c) => c() }] });
}

// =====================================================================
// DETAILS
// =====================================================================
export function renderDetails(view, params) {
  const g = store.get('grns', params.id);
  if (!g) { view.innerHTML = emptyState('file-question', 'GRN not found', `No GRN with number ${esc(params.id)}.`, '<a class="btn btn-primary" href="#/grn">Back to GRNs</a>'); return; }
  const user = currentUser();
  setMeta({ title: g.id, crumbs: [{ label: 'Stock Receiving', href: '#/grn' }, { label: 'All GRNs', href: '#/grn' }, g.id] });
  const t = grnTotals(g); const s = store.get('suppliers', g.supplierId);
  const v = !['POSTED', 'CANCELLED', 'REJECTED'].includes(g.status) ? validateGrn(g) : null;
  const editable = ['DRAFT', 'VALIDATION_REQUIRED'].includes(g.status) || (g.status === 'SUBMITTED' && (can('grn.verify') || g.receivedBy === user.id));

  const actions = [];
  if (editable && can('grn.create')) actions.push(`<a class="btn btn-secondary" href="#/grn/${g.id}/edit">${icon('pencil')}${g.status === 'SUBMITTED' ? 'Edit' : 'Continue editing'}</a>`);
  if (g.status === 'SUBMITTED' && can('grn.verify')) actions.push(`<button class="btn btn-secondary" data-a="sendback">${icon('undo-2')}Return for correction</button>`, `<button class="btn btn-danger-outline" data-a="reject">${icon('x-circle')}Reject</button>`, `<button class="btn btn-primary" data-a="post">${icon('package-check')}Verify & Post</button>`);
  if (g.status === 'PENDING_APPROVAL' && can('grn.approve.exceptional')) actions.push(`<button class="btn btn-danger-outline" data-a="reject">${icon('x-circle')}Reject</button>`, `<button class="btn btn-primary" data-a="approve">${icon('shield-check')}Approve & Post</button>`);
  if (['DRAFT', 'VALIDATION_REQUIRED', 'SUBMITTED'].includes(g.status) && (g.receivedBy === user.id || can('grn.verify'))) actions.push(`<button class="btn btn-ghost" data-a="cancel">${icon('circle-slash')}Cancel GRN</button>`);
  if (g.status === 'POSTED' && can('labels.print')) actions.push(`<a class="btn btn-secondary" href="#/labels?grn=${g.id}">${icon('barcode')}Print labels</a>`);
  actions.push(`<button class="btn btn-ghost" data-a="print">${icon('printer')}Print</button>`);

  const flow = ['DRAFT', 'SUBMITTED', ...(g.requiresOwnerApproval || g.status === 'PENDING_APPROVAL' ? ['PENDING_APPROVAL'] : []), 'POSTED'];
  const reached = new Set(g.history.map((h) => h.status === 'APPROVED' ? 'PENDING_APPROVAL' : h.status));
  const bad = ['REJECTED', 'CANCELLED'].includes(g.status);
  const flowHTML = `<div class="status-flow">${flow.map((st, i) => { const done = reached.has(st) && st !== g.status; const cur = st === g.status || (st === 'DRAFT' && g.status === 'VALIDATION_REQUIRED');
    return `${i ? `<span class="sf-line ${reached.has(st) ? 'done' : ''}"></span>` : ''}<span class="sf-step ${done ? 'done' : ''} ${cur ? 'current' : ''}"><span class="sf-dot">${done ? icon('check') : i + 1}</span>${titleCase(st === 'PENDING_APPROVAL' ? 'Owner approval' : st)}</span>`; }).join('')}
    ${bad ? `<span class="sf-line"></span><span class="sf-step bad"><span class="sf-dot">${icon('x')}</span>${titleCase(g.status)}</span>` : ''}</div>`;

  const auditRows = store.all('audit').filter((a) => a.entityId === g.id).sort((a, b) => b.at.localeCompare(a.at));
  const tlIcon = { DRAFT: ['file-plus', ''], SUBMITTED: ['send', 'info'], VALIDATION_REQUIRED: ['alert-triangle', 'warning'], PENDING_APPROVAL: ['shield-alert', 'purple'], APPROVED: ['shield-check', 'success'], POSTED: ['package-check', 'success'], REJECTED: ['x', 'danger'], CANCELLED: ['circle-slash', 'danger'] };

  view.innerHTML = `
    <div class="page-head"><div><div class="row"><h1>${esc(g.id)}</h1>${badge(g.status)}${g.requiresOwnerApproval ? '<span class="tag tag-purple">Exception case</span>' : ''}</div>
      <p class="muted">${esc(s?.name || '—')} · Invoice <span class="mono">${esc(g.invoiceNo)}</span> · ${fmtDateTime(g.receivedAt)}</p></div>
      <div class="page-actions">${actions.join('')}</div></div>
    <section class="card mb-2"><div class="card-body row-between">${flowHTML}<div class="row"><span class="muted small">Grand total</span><strong style="font-size:20px;color:var(--navy)">${fmtINR(t.grand)}</strong></div></div></section>
    ${g.status === 'PENDING_APPROVAL' ? `<div class="alert alert-info mb-2">${icon('shield-alert')}<div><strong>Awaiting owner approval.</strong> ${(g.exceptionReasons || []).map(esc).join('; ')}${can('grn.approve.exceptional') ? '' : ' — the Hospital Owner has been notified.'}</div></div>` : ''}
    ${g.status === 'REJECTED' ? `<div class="alert alert-danger mb-2">${icon('x-circle')}<div><strong>Rejected:</strong> ${esc(g.rejectedReason)}</div></div>` : ''}
    ${g.status === 'POSTED' ? `<div class="alert alert-success mb-2">${icon('lock')}<div>Posted GRNs are locked. For corrections, use <strong>Supplier return</strong> on a batch line below or raise a <a href="#/adjustments">stock adjustment</a>.</div></div>` : ''}
    ${v && (v.errors.length || v.warnings.length) ? `<div class="alert ${v.errors.length ? 'alert-danger' : 'alert-warning'} mb-2">${icon('alert-triangle')}<div><strong>${v.errors.length} error(s), ${v.warnings.length} warning(s)</strong><ul>${[...v.errors, ...v.warnings].slice(0, 6).map((x) => `<li>${esc(x.msg)}</li>`).join('')}</ul></div></div>` : ''}
    <div class="grid grid-3-1">
      <div>
        ${card('GRN Summary', dl([
          ['GRN Number', esc(g.id)], ['Received Date', fmtDateTime(g.receivedAt)], ['Received By', esc(userName(g.receivedBy))], ['Location', esc(locationName(g.locationId))],
          ['Supplier Invoice', `<span class="mono">${esc(g.invoiceNo)}</span>`], ['Invoice Date', fmtDate(g.invoiceDate)], ['Invoice Amount', g.invoiceAmount ? fmtINR(g.invoiceAmount) : '—'], ['PO Reference', esc(g.poRef || '—')],
          ['Verified By', g.verifiedBy ? `${esc(userName(g.verifiedBy))}<div class="cell-sub">${fmtDateTime(g.verifiedAt)}</div>` : '—'],
          ['Approved By', g.approvedBy ? `${esc(userName(g.approvedBy))}<div class="cell-sub">${fmtDateTime(g.approvedAt)}</div>` : g.requiresOwnerApproval ? 'Pending' : 'Not required'],
          ['Posted By', g.postedBy ? `${esc(userName(g.postedBy))}<div class="cell-sub">${fmtDateTime(g.postedAt)}</div>` : '—'], ['Remarks', esc(g.remarks || '—')]
        ]))}
        ${card(`Items (${t.lines})`, reviewTable(g, v) + `<div class="row-between" style="padding:14px 20px;border-top:1px solid var(--border)"><div class="row small muted"><span>Received <b>${fmtNum(t.qty)}</b></span><span>Free <b>${fmtNum(t.free)}</b></span><span>Subtotal <b>${fmtINR(t.gross)}</b></span><span>Discount <b>${fmtINR(t.discount)}</b></span><span>GST <b>${fmtINR(t.gst)}</b></span></div><strong>Grand total ${fmtINR(t.grand)}</strong></div>`,
          { cls: 'flush', actions: g.status === 'POSTED' && can('batch.manage') ? `<button class="btn btn-secondary btn-sm" data-a="return">${icon('undo-2')}Supplier return</button>` : '' })}
        <div class="grid grid-2">
          ${card('Supplier Invoice', `<div data-inv>${g.attachments?.invoice ? '' : emptyState('file-x', 'No invoice uploaded')}</div>`)}
          ${card(`Delivery Photographs (${g.attachments?.photos?.length || 0})`, `<div data-ph>${g.attachments?.photos?.length ? '' : emptyState('image-off', 'No photographs uploaded')}</div>`)}
        </div>
      </div>
      <div>
        ${card('Supplier', s ? `<a class="cell-main" href="#/suppliers/${s.id}">${esc(s.name)}</a><div class="cell-sub mb-2">${esc(s.address)}</div><div class="kv"><span>Contact</span><span>${esc(s.contactPerson)}</span></div><div class="kv"><span>Phone</span><span>${esc(s.phone)}</span></div><div class="kv"><span>GSTIN</span><span class="mono">${esc(s.gstNumber)}</span></div><div class="kv"><span>Status</span>${badge(s.status)}</div>` : '—')}
        ${card('Status Timeline', `<ul class="timeline">${[...g.history].reverse().map((h) => { const [ic, tone] = tlIcon[h.status] || ['dot', '']; return `<li><span class="tl-dot ${tone}">${icon(ic)}</span><strong>${titleCase(h.status)}</strong><p>${esc(h.note || '')}</p><p class="tiny">${esc(userName(h.by))} · ${fmtDateTime(h.at)}</p></li>`; }).join('')}</ul>`)}
        ${card('Activity Log', auditRows.length ? `<ul class="list-plain small">${auditRows.map((a) => `<li class="list-row" style="align-items:flex-start"><div><strong>${titleCase(a.action)}</strong><div class="muted">${esc(a.details)}</div></div><div class="ta-right tiny muted" style="white-space:nowrap">${esc(userName(a.userId))}<br>${fmtDateTime(a.at)}</div></li>`).join('')}</ul>` : '<p class="muted small">No activity recorded.</p>')}
      </div>
    </div>`;

  // attachments
  (async () => {
    const inv = store.get('attachments', g.attachments?.invoice);
    const ih = view.querySelector('[data-inv]');
    if (inv && ih) {
      const url = await attachmentURL(inv);
      ih.innerHTML = `<div class="file-card"><div class="file-thumb" data-pv="${inv.id}">${inv.type === 'application/pdf' ? icon('file-text') : `<img src="${url || ''}" alt="">`}</div><div class="file-meta"><strong>${esc(inv.name)}</strong><div class="muted small">${fileSize(inv.size)} · ${fmtDateTime(inv.uploadedAt)}</div><div class="mt-1">${vBadge(inv.validation)}</div></div><button class="btn btn-secondary btn-sm" data-pv="${inv.id}">${icon('maximize-2')}Preview</button></div>`;
    }
    const ph = view.querySelector('[data-ph]');
    if (ph && g.attachments?.photos?.length) {
      const items = await Promise.all(g.attachments.photos.map(async (id) => { const m = store.get('attachments', id); return m ? `<div class="photo" data-pv="${id}"><img src="${(await attachmentURL(m)) || ''}" alt="${esc(m.name)}"><div class="photo-status">${vBadge(m.validation)}</div></div>` : ''; }));
      ph.innerHTML = `<div class="photo-grid">${items.join('')}</div>`;
    }
    view.querySelectorAll('[data-pv]').forEach((b) => { b.onclick = () => previewAttachment(store.get('attachments', b.dataset.pv)); });
    refreshIcons(view);
  })();

  const rerender = () => renderDetails(view, params);
  view.querySelectorAll('[data-a]').forEach((b) => { b.onclick = async () => {
    const a = b.dataset.a;
    try {
      if (a === 'print') window.print();
      if (a === 'post') {
        const vv = validateGrn(g);
        if (!vv.ok) { toast(vv.errors[0].msg, 'error', 'Cannot post — validation errors'); return; }
        const needsOwner = vv.exceptions.length && !can('grn.approve.exceptional');
        if (!(await confirmDialog({ title: needsOwner ? 'Verify & escalate to owner?' : 'Verify and post stock?', iconName: 'package-check',
          message: needsOwner ? `Exceptions found:<ul>${vv.exceptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>The GRN will be sent to the Hospital Owner for approval.` : `Confirm that quantities, batches and expiry dates were physically verified. <strong>${fmtNum(t.totalQty)}</strong> units worth <strong>${fmtINR(t.grand)}</strong> will be added to inventory.`,
          confirmLabel: needsOwner ? 'Verify & Escalate' : 'Post Stock' }))) return;
        const r = verifyAndPost(g.id, user);
        toast(r.posted ? `${g.id} posted. Inventory updated and owner notified.` : `${g.id} escalated for owner approval.`, r.posted ? 'success' : 'info');
        rerender();
      }
      if (a === 'approve') {
        if (!(await confirmDialog({ title: 'Approve and post?', iconName: 'shield-check', message: `You are approving these exceptions:<ul>${(g.exceptionReasons || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>Stock will be posted immediately. Expired batches stay blocked from issue.`, confirmLabel: 'Approve & Post' }))) return;
        approveGrn(g.id, user); toast(`${g.id} approved and posted.`); rerender();
      }
      if (a === 'reject') {
        const r = await confirmDialog({ title: `Reject ${g.id}?`, message: 'The GRN will be rejected and no stock will be added. The submitter will be notified.', confirmLabel: 'Reject GRN', tone: 'danger', reason: true, reasonLabel: 'Rejection reason', iconName: 'x-circle' });
        if (!r) return; rejectGrn(g.id, user, r.reason); toast(`${g.id} rejected.`, 'info'); rerender();
      }
      if (a === 'sendback') {
        const r = await confirmDialog({ title: 'Return for correction?', message: 'The GRN goes back to the submitter with status Validation Required.', confirmLabel: 'Return', reason: true, reasonLabel: 'What needs correcting', iconName: 'undo-2' });
        if (!r) return; sendBackGrn(g.id, user, r.reason); toast(`${g.id} returned for correction.`, 'info'); rerender();
      }
      if (a === 'cancel') {
        const r = await confirmDialog({ title: `Cancel ${g.id}?`, message: 'The GRN will be marked CANCELLED and kept for audit.', confirmLabel: 'Cancel GRN', tone: 'danger', reason: true, reasonLabel: 'Cancellation reason', iconName: 'circle-slash' });
        if (!r) return; cancelGrn(g.id, user, r.reason); toast(`${g.id} cancelled.`, 'info'); rerender();
      }
      if (a === 'return') supplierReturnDialog(g, user, rerender);
    } catch (e) { toast(e.message, 'error'); }
  }; });
}

function supplierReturnDialog(g, user, done) {
  const lines = g.items.filter((it) => it.batchId && batchBalance(it.batchId, STORE_LOC()) > 0);
  if (!lines.length) { toast('No stock from this GRN remains to return.', 'info'); return; }
  openModal({ title: `Supplier return — ${g.id}`, subtitle: 'Creates a SUPPLIER_RETURN stock movement. The posted GRN itself is not modified.', size: 'md',
    body: `<form class="form-grid" data-sr>
      <div class="field col-12"><label>Batch line <span class="req">*</span></label><select class="input" name="batchId">${lines.map((it) => { const b = store.get('batches', it.batchId); return `<option value="${b.id}">${esc(medName(it.medicineId))} — ${esc(b.batchNo)} (in store ${batchBalance(b.id, STORE_LOC())})</option>`; }).join('')}</select></div>
      <div class="field col-4"><label>Quantity <span class="req">*</span></label><input class="input" type="number" min="1" step="1" name="qty" data-rules="required,positive"></div>
      <div class="field col-8"><label>Reason <span class="req">*</span></label><input class="input" name="reason" data-rules="required" placeholder="e.g. Damaged in transit, short expiry"></div></form>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Record return', cls: 'btn-primary', icon: 'undo-2', onClick: async (close, wrap) => {
      const { validateForm } = await import('../validation.js');
      const form = wrap.querySelector('[data-sr]'); if (!validateForm(form)) return;
      const d = Object.fromEntries(new FormData(form));
      try { supplierReturn(d.batchId, Number(d.qty), d.reason, user, STORE_LOC()); toast('Supplier return recorded. Inventory updated.'); close(); done(); } catch (e) { toast(e.message, 'error'); }
    } }] });
}
