// Alerts & Tasks — live alerts derived from data + stored notifications
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { derivedAlerts, userName } from '../calculations.js';
import { visibleNotifications, isRead, markRead, markAllRead, notificationLink } from '../notifications.js';
import { badge, dataTable, tabs, emptyState, kpi } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtDate, fmtDateTime, relTime, refreshIcons } from '../utils.js';

const CATS = [['Low Stock', 'trending-down'], ['Out of Stock', 'ban'], ['Near Expiry', 'calendar-clock'], ['Expired Stock', 'calendar-x'], ['GRN Pending Verification', 'clipboard-check'], ['GRN Discrepancy', 'shield-alert'], ['Stock Adjustment Approval', 'scale'], ['Missing Documentation', 'file-warning'], ['Stock Shortage', 'clipboard-x'], ['Pharmacy Refill', 'arrow-right-left'], ['Refund Approval', 'undo-2'], ['Bill Cancellation', 'circle-slash'], ['Daily Closing', 'lock'], ['Cash Variance', 'scale']];
const SEV_ORDER = { critical: 0, warning: 1, info: 2, success: 3 };
const ackKey = (u) => 'nallam_hms_acks_' + u.id;
const getAcks = (u) => new Set(JSON.parse(localStorage.getItem(ackKey(u)) || '[]'));

function alertLink(a) {
  if (a.refType === 'TRANSFER') return '#/transfers';
  if (a.refType === 'STOCKCOUNT') return '#/stock-count?focus=' + a.refId;
  if (a.refType === 'CLOSING_PENDING') { const [d, c] = a.refId.split('|'); return `#/pharmacy/closing?date=${d}&cashier=${c}`; }
  return { MEDICINE: '#/inventory/' + a.refId, BATCH: '#/batches/' + a.refId, GRN: '#/grn/' + a.refId, ADJUSTMENT: '#/adjustments?focus=' + a.refId, RETURN: '#/pharmacy/returns?focus=' + a.refId, BILL: '#/pharmacy/bills/' + a.refId, CLOSING: '#/pharmacy/closing-report?focus=' + a.refId }[a.refType] || '#/alerts';
}
const refLabel = (a) => (a.refType === 'CLOSING_PENDING' ? a.refId.split('|')[0] : a.refType === 'MEDICINE' ? store.get('medicines', a.refId)?.brandName : a.refType === 'BATCH' ? store.get('batches', a.refId)?.batchNo : a.refId);

export function render(view, params, query) {
  const u = currentUser();
  let tab = query.tab || 'alerts';
  const alerts = derivedAlerts();
  const notes = visibleNotifications(u);
  const acks = getAcks(u);
  const mine = alerts.filter((a) => a.assignee === u.id);
  view.innerHTML = `
    <div class="page-head"><div><p class="muted">Problems that need action (stock, expiry, approvals) and messages about things that happened.</p></div></div>
    <div class="chip-row">${CATS.filter(([c]) => alerts.some((a) => a.category === c)).map(([c, ic]) => { const n = alerts.filter((a) => a.category === c).length; const crit = alerts.some((a) => a.category === c && a.severity === 'critical'); return `<button class="chip" data-cat="${c}">${icon(ic)}${c} <strong class="${crit ? 'text-danger' : ''}">${n}</strong></button>`; }).join('') || '<span class="muted">No alerts — everything looks fine.</span>'}</div>
    <section class="card"><div data-tabs></div><div data-body></div></section>`;
  const body = view.querySelector('[data-body]');
  let catFilter = '';

  function drawTabs() {
    tabs(view.querySelector('[data-tabs]'), [
      { id: 'alerts', label: 'Live Alerts', icon: 'siren', count: alerts.length },
      { id: 'tasks', label: 'My Tasks', icon: 'list-checks', count: mine.filter((a) => !acks.has(a.key)).length },
      { id: 'notifications', label: 'Notifications', icon: 'bell', count: notes.filter((n) => !isRead(n, u)).length }
    ], tab, (t) => { tab = t; catFilter = ''; draw(); });
  }
  function alertTable(rows) {
    body.innerHTML = `<div class="toolbar"><select class="input" data-fc><option value="">All categories</option>${CATS.map(([c]) => `<option ${c === catFilter ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <select class="input" data-fs><option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select>
      <label class="check small"><input type="checkbox" data-fa> Hide acknowledged</label><span class="spacer"></span><span class="muted small">Acknowledging hides an alert from your task list; it reappears only if the condition is still true for others.</span></div><div data-t></div>`;
    const t = dataTable({ pageSize: 25, sort: { key: 'sev', dir: 'asc' }, empty: emptyState('check-circle-2', 'No alerts', 'Nothing needs attention right now.'), rowClass: (a) => (acks.has(a.key) ? '' : a.severity === 'critical' ? 'row-danger' : a.severity === 'warning' ? 'row-warning' : ''),
      columns: [
        { key: 'sev', label: 'Severity', value: (a) => SEV_ORDER[a.severity], render: (a) => badge(a.severity, a.severity[0].toUpperCase() + a.severity.slice(1)) },
        { key: 'category', label: 'Category' },
        { key: 'message', label: 'Message', render: (a) => `<span class="${acks.has(a.key) ? 'muted' : ''}">${esc(a.message)}</span>` },
        { key: 'ref', label: 'Reference', value: refLabel, render: (a) => `<a href="${alertLink(a)}" class="mono">${esc(refLabel(a))}</a>` },
        { key: 'date', label: 'Date', value: (a) => a.date || '', render: (a) => (a.date ? (a.date.length === 10 ? fmtDate(a.date) : relTime(a.date)) : '<span class="cell-sub">Live</span>') },
        { key: 'assignee', label: 'Assigned To', value: (a) => userName(a.assignee), render: (a) => esc(userName(a.assignee)) },
        { key: 'status', label: 'Status', value: (a) => (acks.has(a.key) ? 'Acknowledged' : 'Open'), render: (a) => (acks.has(a.key) ? badge('RESOLVED', 'Acknowledged') : badge('OPEN', 'Open')) },
        { key: '', label: '', sortable: false, align: 'right', render: (a) => `<div class="row-actions"><a class="btn btn-ghost btn-sm" href="${alertLink(a)}">${icon('arrow-right')}</a>${acks.has(a.key) ? '' : `<button class="btn btn-ghost btn-sm" data-ack="${a.key}" title="Acknowledge">${icon('check')}</button>`}</div>` }
      ] });
    body.querySelector('[data-t]').appendChild(t.el);
    const apply = () => {
      const c = body.querySelector('[data-fc]').value; const s = body.querySelector('[data-fs]').value; const h = body.querySelector('[data-fa]').checked;
      t.setRows(rows.filter((a) => (!c || a.category === c) && (!s || a.severity === s) && (!h || !acks.has(a.key))));
    };
    body.querySelectorAll('[data-fc],[data-fs],[data-fa]').forEach((el) => { el.onchange = apply; });
    body.onclick = (e) => {
      const b = e.target.closest('[data-ack]'); if (!b) return;
      acks.add(b.dataset.ack); localStorage.setItem(ackKey(u), JSON.stringify([...acks])); toast('Alert acknowledged.', 'info'); apply(); drawTabs();
    };
    apply();
  }
  function notificationsList() {
    let unreadOnly = false;
    const draw2 = () => {
      const list = visibleNotifications(u).filter((n) => !unreadOnly || !isRead(n, u));
      body.innerHTML = `<div class="toolbar"><label class="check small"><input type="checkbox" data-uo ${unreadOnly ? 'checked' : ''}> Unread only</label><span class="spacer"></span>
        ${can('alerts.all') ? '<span class="tag tag-purple">Owner view — all notifications</span>' : ''}<button class="btn btn-secondary btn-sm" data-all>${icon('check-check')}Mark all as read</button></div>
        <div class="np-list" style="max-height:none">${list.length ? list.map((n) => `<div class="np-item ${isRead(n, u) ? '' : 'unread'}" style="align-items:center">
          <span class="np-ic sev-${n.severity}">${icon({ success: 'check-circle-2', critical: 'alert-octagon', warning: 'alert-triangle', info: 'info' }[n.severity] || 'bell')}</span>
          <div class="grow"><strong>${esc(n.title)}</strong><p style="-webkit-line-clamp:unset">${esc(n.message)}</p><small>${fmtDateTime(n.createdAt)} · ${esc(n.category)}${n.performedBy ? ' · performed by ' + esc(userName(n.performedBy)) : ''}${n.assignedTo ? ' · assigned to ' + esc(userName(n.assignedTo)) : ''}</small></div>
          <div class="row">${n.refType ? `<a class="btn btn-ghost btn-sm" href="${notificationLink(n)}" data-open="${n.id}">Open ${icon('arrow-right')}</a>` : ''}${isRead(n, u) ? '<span class="muted small">Read</span>' : `<button class="btn btn-secondary btn-sm" data-read="${n.id}">Mark read</button>`}</div></div>`).join('') : emptyState('bell-off', 'No notifications')}</div>`;
      refreshIcons(body);
      body.querySelector('[data-uo]').onchange = (e) => { unreadOnly = e.target.checked; draw2(); };
      body.querySelector('[data-all]').onclick = () => { markAllRead(u); toast('All notifications marked as read.', 'info'); draw2(); drawTabs(); };
      body.querySelectorAll('[data-read]').forEach((b) => { b.onclick = () => { markRead(b.dataset.read, u); draw2(); drawTabs(); }; });
      body.querySelectorAll('[data-open]').forEach((b) => { b.addEventListener('click', () => markRead(b.dataset.open, u)); });
    };
    draw2();
  }
  function draw() {
    drawTabs();
    body.onclick = null;
    if (tab === 'notifications') notificationsList();
    else alertTable((tab === 'tasks' ? mine : alerts).slice().sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]));
    if (catFilter) { const s = body.querySelector('[data-fc]'); if (s) { s.value = catFilter; s.onchange(); } }
    refreshIcons(view);
  }
  view.querySelectorAll('[data-cat]').forEach((b) => { b.onclick = () => { tab = 'alerts'; catFilter = b.dataset.cat; draw(); }; });
  draw();
}
