// Reusable UI components: badges, KPI cards, data table, modal, confirm, combobox, dropzone, charts, CSV.
import { esc, icon, refreshIcons, titleCase, fmtNum } from './utils.js';

// ---------------- badges ----------------
const TONES = {
  DRAFT: 'neutral', VALIDATION_REQUIRED: 'warning', SUBMITTED: 'info', PENDING_APPROVAL: 'purple', POSTED: 'success', REJECTED: 'danger', CANCELLED: 'muted', APPROVED: 'success',
  IN_STOCK: 'success', LOW_STOCK: 'warning', OUT_OF_STOCK: 'danger',
  ACTIVE: 'success', NEAR_EXPIRY: 'warning', EXPIRED: 'danger', QUARANTINED: 'purple', RETURNED: 'muted', DEPLETED: 'muted', INACTIVE: 'muted',
  PENDING_OWNER_APPROVAL: 'purple', OPEN: 'warning', RESOLVED: 'success',
  COMPLETED: 'success', PARTIALLY_PAID: 'warning', PENDING: 'warning', PARTIALLY_RETURNED: 'info', PAID: 'success', UNPAID: 'danger', SUBMITTED_CLOSING: 'info', VERIFIED: 'success', CORRECTED: 'purple', VARIANCE: 'danger', NOT_SUBMITTED: 'warning',
  critical: 'danger', warning: 'warning', info: 'info', success: 'success'
};
const LABELS = {
  PENDING_OWNER_APPROVAL: 'Waiting for owner', VALIDATION_REQUIRED: 'Needs correction', PENDING_APPROVAL: 'Waiting for approval', SUBMITTED: 'Waiting for check',
  POSTED: 'Stock added', NEAR_EXPIRY: 'Expiring soon', DEPLETED: 'Empty', PARTIALLY_RETURNED: 'Part returned', PARTIALLY_PAID: 'Part paid', PENDING: 'Unpaid',
  IN_STOCK: 'In stock', LOW_STOCK: 'Low stock', OUT_OF_STOCK: 'Out of stock', UNPAID: 'Unpaid', PAID: 'Paid', NOT_SUBMITTED: 'Not closed'
};
export const badge = (status, label) => `<span class="badge badge-${TONES[status] || 'neutral'}"><span class="dot"></span>${esc(label || LABELS[status] || titleCase(status))}</span>`;
export const movementBadge = (type) => {
  const inn = ['OPENING_STOCK', 'PURCHASE_RECEIPT', 'STOCK_TRANSFER_IN', 'PATIENT_RETURN', 'STOCK_ADJUSTMENT_IN', 'SALE_CANCELLATION'].includes(type);
  const tone = type === 'EXPIRED_WRITE_OFF' ? 'danger' : type.startsWith('STOCK_ADJ') ? 'purple' : inn ? 'success' : 'info';
  return `<span class="tag tag-${tone}">${esc(type.replace(/_/g, ' '))}</span>`;
};

// ---------------- layout helpers ----------------
export function pageHeader({ title, subtitle, actions = '' }) {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ''}</div><div class="page-actions">${actions}</div></div>`;
}
export function kpi({ label, value, iconName, tone = 'teal', sub = '', href }) {
  const tag = href ? 'a' : 'div';
  return `<${tag} class="kpi kpi-${tone}" ${href ? `href="${href}"` : ''}>
    <div class="kpi-icon">${icon(iconName)}</div>
    <div class="kpi-body"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>
  </${tag}>`;
}
export const emptyState = (iconName, title, text = '', action = '') => `<div class="empty">${icon(iconName)}<h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${action}</div>`;
export const card = (title, body, { actions = '', cls = '', sub = '' } = {}) =>
  `<section class="card ${cls}">${title ? `<header class="card-head"><div><h2>${esc(title)}</h2>${sub ? `<p class="muted small">${sub}</p>` : ''}</div><div class="card-actions">${actions}</div></header>` : ''}<div class="card-body">${body}</div></section>`;
export const dl = (pairs) => `<dl class="dl">${pairs.filter(Boolean).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v ?? '—'}</dd></div>`).join('')}</dl>`;

// ---------------- data table ----------------
export function dataTable({ columns, rows = [], pageSize = 10, onRowClick, empty, sort, rowClass, id, dense }) {
  const st = { rows, page: 1, pageSize, sortKey: sort?.key || null, sortDir: sort?.dir || 'asc' };
  const el = document.createElement('div');
  el.className = 'table-wrap';
  if (id) el.id = id;

  const sorted = () => {
    if (!st.sortKey) return st.rows;
    const col = columns.find((c) => c.key === st.sortKey);
    const val = col?.value || ((r) => r[st.sortKey]);
    return [...st.rows].sort((a, b) => {
      const x = val(a); const y = val(b);
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'en', { numeric: true });
      return st.sortDir === 'asc' ? r : -r;
    });
  };
  function render() {
    const all = sorted();
    const pages = Math.max(1, Math.ceil(all.length / st.pageSize));
    st.page = Math.min(st.page, pages);
    const slice = all.slice((st.page - 1) * st.pageSize, st.page * st.pageSize);
    const head = columns.map((c) => {
      const sortable = c.sortable !== false && c.key;
      const active = st.sortKey === c.key;
      return `<th class="${c.align ? 'ta-' + c.align : ''} ${sortable ? 'sortable' : ''} ${active ? 'sorted' : ''}" ${sortable ? `data-sort="${c.key}"` : ''} style="${c.width ? 'width:' + c.width : ''}">
        ${esc(c.label)}${sortable ? `<span class="sort-ic">${active ? (st.sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>` : ''}</th>`;
    }).join('');
    const body = slice.length
      ? slice.map((r, i) => `<tr data-i="${(st.page - 1) * st.pageSize + i}" class="${onRowClick ? 'clickable' : ''} ${rowClass ? rowClass(r) : ''}">${columns.map((c) => `<td class="${c.align ? 'ta-' + c.align : ''} ${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${columns.length}">${empty || emptyState('inbox', 'No records found', 'Try changing the search or filters.')}</td></tr>`;
    const from = all.length ? (st.page - 1) * st.pageSize + 1 : 0; const to = Math.min(all.length, st.page * st.pageSize);
    const nums = [];
    for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - st.page) <= 1) nums.push(p); else if (nums.at(-1) !== '…') nums.push('…');
    el.innerHTML = `<div class="table-scroll"><table class="table ${dense ? 'dense' : ''}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="pager"><span class="muted small">Showing ${fmtNum(from)}–${fmtNum(to)} of ${fmtNum(all.length)}</span>
        <div class="pager-ctrl">
          <select class="input input-sm" data-size aria-label="Rows per page">${[10, 25, 50, 100].map((n) => `<option ${n === st.pageSize ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm" data-pg="prev" ${st.page === 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevron-left')}</button>
          ${nums.map((p) => p === '…' ? '<span class="muted">…</span>' : `<button class="btn btn-sm ${p === st.page ? 'btn-primary' : 'btn-ghost'}" data-pg="${p}">${p}</button>`).join('')}
          <button class="btn btn-ghost btn-sm" data-pg="next" ${st.page === pages ? 'disabled' : ''} aria-label="Next page">${icon('chevron-right')}</button>
        </div></div>`;
    refreshIcons(el);
  }
  el.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const k = th.dataset.sort; st.sortDir = st.sortKey === k && st.sortDir === 'asc' ? 'desc' : 'asc'; st.sortKey = k; render(); return; }
    const pg = e.target.closest('[data-pg]');
    if (pg) { const v = pg.dataset.pg; st.page = v === 'prev' ? st.page - 1 : v === 'next' ? st.page + 1 : +v; render(); return; }
    if (e.target.closest('a, button, input, select, label')) return;
    const tr = e.target.closest('tr[data-i]');
    if (tr && onRowClick) onRowClick(sorted()[+tr.dataset.i]);
  });
  el.addEventListener('change', (e) => { if (e.target.matches('[data-size]')) { st.pageSize = +e.target.value; st.page = 1; render(); } });
  render();
  return { el, setRows(r) { st.rows = r; st.page = 1; render(); }, getRows: sorted, refresh: render };
}

// ---------------- modal / confirm ----------------
export function openModal({ title, body, size = 'md', footer = [], onOpen, onClose, subtitle }) {
  const prevFocus = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal modal-${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header class="modal-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p class="muted small">${subtitle}</p>` : ''}</div><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></header>
    <div class="modal-body"></div>
    ${footer.length ? `<footer class="modal-foot">${footer.map((b, i) => `<button class="btn ${b.cls || 'btn-secondary'}" data-fi="${i}" ${b.disabled ? 'disabled' : ''}>${b.icon ? icon(b.icon) : ''}${esc(b.label)}</button>`).join('')}</footer>` : ''}
  </div>`;
  const bodyEl = wrap.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  document.body.appendChild(wrap);
  document.body.classList.add('modal-open');
  const close = (v) => {
    wrap.classList.add('out');
    setTimeout(() => { wrap.remove(); if (!document.querySelector('.modal-backdrop')) document.body.classList.remove('modal-open'); prevFocus?.focus?.(); }, 160);
    document.removeEventListener('keydown', onKey);
    onClose?.(v);
  };
  const onKey = (e) => { if (e.key === 'Escape' && wrap === [...document.querySelectorAll('.modal-backdrop')].at(-1)) close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-close]').onclick = () => close();
  wrap.querySelectorAll('[data-fi]').forEach((b) => { b.onclick = () => footer[+b.dataset.fi].onClick?.(close, wrap, b); });
  refreshIcons(wrap);
  onOpen?.(wrap, close);
  setTimeout(() => (wrap.querySelector('[autofocus]') || wrap.querySelector('input,select,textarea,.modal-foot .btn:last-child'))?.focus(), 30);
  return { el: wrap, close };
}

/** Promise-based confirmation. Resolves to false, or { reason } when confirmed. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', tone = 'primary', reason = false, reasonLabel = 'Reason', reasonPlaceholder = '', iconName }) {
  return new Promise((resolve) => {
    let done = false;
    const body = `<div class="confirm ${tone}">${iconName ? `<div class="confirm-ic">${icon(iconName)}</div>` : ''}<div class="confirm-msg">${message}</div></div>
      ${reason ? `<div class="field mt-2"><label>${esc(reasonLabel)} <span class="req">*</span></label><textarea class="input" rows="3" data-reason placeholder="${esc(reasonPlaceholder)}"></textarea><div class="field-error hidden">Please provide a ${esc(reasonLabel.toLowerCase())}.</div></div>` : ''}`;
    openModal({
      title, body, size: 'sm',
      footer: [
        { label: 'Cancel', cls: 'btn-secondary', onClick: (close) => close() },
        { label: confirmLabel, cls: tone === 'danger' ? 'btn-danger' : 'btn-primary', onClick: (close, wrap) => {
          const r = wrap.querySelector('[data-reason]');
          if (r && !r.value.trim()) { r.closest('.field').classList.add('has-error'); r.closest('.field').querySelector('.field-error').classList.remove('hidden'); r.focus(); return; }
          done = true; close(); resolve({ reason: r ? r.value.trim() : '' });
        } }
      ],
      onClose: () => { if (!done) resolve(false); }
    });
  });
}

// ---------------- searchable combobox ----------------
export function combo(host, { options, value = '', placeholder = 'Search…', onChange, footer, disabled }) {
  host.classList.add('combo');
  host.innerHTML = `<div class="combo-input"><input class="input" type="text" placeholder="${esc(placeholder)}" autocomplete="off" ${disabled ? 'disabled' : ''} role="combobox" aria-expanded="false"/>${icon('chevrons-up-down', 'combo-caret')}</div><div class="combo-list hidden" role="listbox"></div>`;
  const input = host.querySelector('input'); const list = host.querySelector('.combo-list');
  let current = value; let active = 0; let filtered = [];
  const opts = () => (typeof options === 'function' ? options() : options);
  const labelOf = (v) => opts().find((o) => o.value === v)?.label || '';
  input.value = labelOf(current);
  function draw(q = '') {
    const s = q.trim().toLowerCase();
    filtered = opts().filter((o) => !s || (o.label + ' ' + (o.sub || '') + ' ' + (o.keywords || '')).toLowerCase().includes(s)).slice(0, 60);
    active = Math.min(active, Math.max(0, filtered.length - 1));
    list.innerHTML = (filtered.length ? filtered.map((o, i) => `<div class="combo-opt ${i === active ? 'active' : ''} ${o.disabled ? 'disabled' : ''}" data-v="${esc(o.value)}" role="option"><div>${esc(o.label)}</div>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</div>`).join('') : '<div class="combo-empty">No matches</div>')
      + (footer ? `<div class="combo-foot">${footer.html}</div>` : '');
    refreshIcons(list);
  }
  const open = () => { draw(''); list.classList.remove('hidden'); input.setAttribute('aria-expanded', 'true'); input.select(); };
  const closeList = () => { list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); input.value = labelOf(current); };
  const choose = (v) => { const o = opts().find((x) => x.value === v); if (!o || o.disabled) return; current = v; closeList(); onChange?.(v, o); };
  input.addEventListener('focus', open);
  input.addEventListener('input', () => { active = 0; draw(input.value); list.classList.remove('hidden'); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(filtered.length - 1, active + 1); draw(input.value); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(input.value); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) choose(filtered[active].value); }
    else if (e.key === 'Escape') closeList();
  });
  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const o = e.target.closest('.combo-opt'); if (o) choose(o.dataset.v);
    if (e.target.closest('.combo-foot') && footer) { closeList(); footer.onClick(); }
  });
  input.addEventListener('blur', () => setTimeout(closeList, 120));
  return { get value() { return current; }, set(v) { current = v; input.value = labelOf(v); }, focus: () => input.focus() };
}

// ---------------- dropzone ----------------
export function dropzone({ accept = 'image/*,application/pdf', multiple = false, label = 'Drag & drop files here', hint = '', onFiles, disabled }) {
  const el = document.createElement('label');
  el.className = 'dropzone' + (disabled ? ' disabled' : '');
  el.innerHTML = `${icon('upload-cloud')}<strong>${esc(label)}</strong><span class="muted small">or <u>browse files</u>${hint ? ' · ' + esc(hint) : ''}</span><input type="file" accept="${accept}" ${multiple ? 'multiple' : ''} ${disabled ? 'disabled' : ''} hidden>`;
  const input = el.querySelector('input');
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => el.addEventListener(t, (e) => { e.preventDefault(); if (!disabled) el.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => el.addEventListener(t, (e) => { e.preventDefault(); el.classList.remove('over'); }));
  el.addEventListener('drop', (e) => { if (!disabled && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
  return el;
}

// ---------------- charts ----------------
const charts = new Set();
export const PALETTE = ['#0A7C86', '#0F2C44', '#1D5FB4', '#C27C0E', '#1E7B45', '#C4281C', '#7A5AF8', '#5BB8B4', '#8FA3B3', '#B86E00', '#2F6F9F', '#9BC53D'];
export function chart(canvas, config) {
  if (!window.Chart) { canvas.replaceWith(Object.assign(document.createElement('div'), { className: 'muted small', textContent: 'Charts unavailable offline (Chart.js not loaded).' })); return null; }
  const Chart = window.Chart;
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = '#4A5866';
  Chart.defaults.borderColor = '#E7EBEF';
  const c = new Chart(canvas, { ...config, options: { responsive: true, maintainAspectRatio: false, ...config.options, plugins: { legend: { labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } }, ...config.options?.plugins } } });
  charts.add(c);
  return c;
}
export function destroyCharts() { charts.forEach((c) => c.destroy()); charts.clear(); }

// ---------------- CSV ----------------
export function downloadCSV(filename, headers, rows) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [headers.map(q).join(','), ...rows.map((r) => r.map(q).join(','))].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/** Export the currently filtered + sorted rows of a dataTable using column csv() accessors. */
export function exportTable(filename, columns, rows) {
  const cols = columns.filter((c) => c.csv !== false && c.label);
  downloadCSV(filename, cols.map((c) => c.label), rows.map((r) => cols.map((c) => (typeof c.csv === 'function' ? c.csv(r) : (c.value ? c.value(r) : r[c.key])))));
}

// ---------------- tabs ----------------
export function tabs(host, items, active, onChange) {
  host.innerHTML = `<div class="tabs" role="tablist">${items.map((t) => `<button role="tab" class="tab ${t.id === active ? 'active' : ''}" data-tab="${t.id}" aria-selected="${t.id === active}">${t.icon ? icon(t.icon) : ''}${esc(t.label)}${t.count != null ? `<span class="tab-count">${t.count}</span>` : ''}</button>`).join('')}</div>`;
  host.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { host.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); }); onChange(b.dataset.tab); }; });
  refreshIcons(host);
}

export function skeleton(lines = 6) {
  return `<div class="skeleton-wrap">${Array.from({ length: lines }, (_, i) => `<div class="skeleton" style="width:${90 - (i % 3) * 15}%"></div>`).join('')}</div>`;
}
