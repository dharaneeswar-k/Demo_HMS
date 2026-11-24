// Stored notifications (events such as "GRN posted") + transient toast messages.
import { store } from './data-service.js';
import { currentUser, can } from './auth.js';
import { esc, icon, refreshIcons } from './utils.js';

export function notify(n) {
  const id = store.nextId('notifications', 'NTF-');
  return store.insert('notifications', { id, readBy: [], status: 'OPEN', assignedTo: null, performedBy: currentUser()?.id ?? null, createdAt: new Date().toISOString(), ...n });
}
export function visibleNotifications(user = currentUser()) {
  if (!user) return [];
  return store.all('notifications')
    .filter((n) => can('alerts.all', user) || n.targetRoles?.includes(user.role) || n.assignedTo === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export const isRead = (n, user = currentUser()) => n.readBy?.includes(user?.id);
export const unreadCount = (user = currentUser()) => visibleNotifications(user).filter((n) => !isRead(n, user)).length;
export function markRead(id, user = currentUser()) {
  const n = store.get('notifications', id);
  if (n && !n.readBy.includes(user.id)) { n.readBy.push(user.id); store.commit(); }
}
export function markAllRead(user = currentUser()) {
  visibleNotifications(user).forEach((n) => { if (!n.readBy.includes(user.id)) n.readBy.push(user.id); });
  store.commit();
}
export function notificationLink(n) {
  if (n.refType === 'GRN') return '#/grn/' + n.refId;
  if (n.refType === 'ADJUSTMENT') return '#/adjustments?focus=' + n.refId;
  if (n.refType === 'BATCH') return '#/batches/' + n.refId;
  if (n.refType === 'MEDICINE') return '#/inventory/' + n.refId;
  if (n.refType === 'REPORT') return '#/reports?r=' + n.refId;
  if (n.refType === 'BILL') return '#/pharmacy/bills/' + n.refId;
  if (n.refType === 'RETURN') return '#/pharmacy/returns?focus=' + n.refId;
  if (n.refType === 'DISCOUNT') return '#/discounts?focus=' + n.refId;
  if (n.refType === 'TRANSFER') return '#/transfers?focus=' + n.refId;
  if (n.refType === 'STOCKCOUNT') return '#/stock-count?focus=' + n.refId;
  if (n.refType === 'CLOSING') return '#/pharmacy/closing-report?focus=' + n.refId;
  return '#/alerts';
}

// ---------------- toasts ----------------
const TOAST_ICON = { success: 'check-circle-2', error: 'x-circle', warning: 'alert-triangle', info: 'info' };
export function toast(message, type = 'success', title) {
  let host = document.getElementById('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(TOAST_ICON[type] || 'info')}<div><strong>${esc(title || { success: 'Success', error: 'Please check', warning: 'Attention', info: 'Note' }[type])}</strong><p>${esc(message)}</p></div><button class="toast-x" aria-label="Dismiss">${icon('x')}</button>`;
  host.appendChild(el);
  refreshIcons(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  el.querySelector('.toast-x').onclick = close;
  setTimeout(close, type === 'error' ? 7000 : 4200);
}
