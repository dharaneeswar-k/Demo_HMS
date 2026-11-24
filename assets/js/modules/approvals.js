// Approvals inbox — every decision waiting for the manager/owner in one simple list.
import { currentUser } from '../auth.js';
import { approvalItems, APPROVAL_TYPES } from '../approvals.js';
import { tabs, emptyState } from '../components.js';
import { esc, icon, fmtINR, relTime, refreshIcons } from '../utils.js';

export function render(view, params, query) {
  const items = approvalItems(currentUser());
  const types = Object.keys(APPROVAL_TYPES).filter((t) => items.some((i) => i.type === t));
  let tab = query.type && types.includes(query.type) ? query.type : 'ALL';
  view.innerHTML = `<p class="page-intro">Everything waiting for your decision, most urgent first. Open an item to review the details and approve or reject it.</p>
    <section class="card"><div data-tabs></div><div data-list></div></section>`;
  const draw = () => {
    tabs(view.querySelector('[data-tabs]'), [{ id: 'ALL', label: 'All', count: items.length }, ...types.map((t) => ({ id: t, label: APPROVAL_TYPES[t].label, icon: APPROVAL_TYPES[t].icon, count: items.filter((i) => i.type === t).length }))], tab, (t) => { tab = t; draw(); });
    const list = items.filter((i) => tab === 'ALL' || i.type === tab);
    view.querySelector('[data-list]').innerHTML = list.length ? `<div class="todo-list">${list.map((a) => `<a class="todo" href="${a.href}">
        <span class="todo-ic sev-${a.tone === 'danger' ? 'critical' : a.tone}">${icon(APPROVAL_TYPES[a.type].icon)}</span>
        <span class="todo-txt"><strong>${esc(a.title)}</strong><small>${esc(a.detail)}</small><small>From ${esc(a.who)} · ${relTime(a.at)}</small></span>
        ${a.amount != null ? `<span class="todo-amt">${fmtINR(a.amount)}</span>` : ''}<span class="btn ${a.tone === 'danger' ? 'btn-primary' : 'btn-secondary'} btn-sm">${esc(a.action)}</span></a>`).join('')}</div>`
      : emptyState('check-circle-2', 'All caught up', 'There is nothing waiting for your approval.');
    refreshIcons(view);
  };
  draw();
}
