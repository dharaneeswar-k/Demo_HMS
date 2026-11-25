// Mock authentication — demonstration only. Passwords live in users.json in plain text on purpose (demo data).
import { store } from './data-service.js';

const KEY = 'nallam_hms_session';

export function login(username, password, remember) {
  const u = store.all('users').find((x) => x.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!u || u.password !== password) return { ok: false, error: 'Invalid username or password.' };
  if (!u.active) return { ok: false, error: 'This account is inactive. Contact the hospital administrator.' };
  // BRD 14: staff may sign in only on a workstation set up for their role (Super Admin: anywhere)
  const ws = store.hs?.()?.workstations; let wsId = '';
  try { wsId = localStorage.getItem('nallam_hms_workstation') || ''; } catch { /* storage blocked */ }
  if (ws?.enforce && u.role !== 'SUPER_ADMIN') {
    const w = ws.list.find((x) => x.id === wsId);
    if (!w) return { ok: false, error: 'This computer is not registered as a hospital workstation. Ask the administrator.' };
    if (!w.roles.includes(u.role)) return { ok: false, error: `${w.name} is not set up for your role. Use your own counter's computer.` };
  }
  store.insert('audit', { id: store.nextId('audit', 'AUD-', 5), at: new Date().toISOString(), userId: u.id, action: 'USER_SIGNED_IN', entity: 'USER', entityId: u.id, details: wsId ? 'Workstation ' + wsId : 'No registered workstation' });
  store.commit();
  const session = JSON.stringify({ userId: u.id, at: new Date().toISOString() });
  (remember ? localStorage : sessionStorage).setItem(KEY, session);
  (remember ? sessionStorage : localStorage).removeItem(KEY);
  return { ok: true, user: u };
}
export function logout() { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); }
export function currentUser() {
  const raw = sessionStorage.getItem(KEY) || localStorage.getItem(KEY);
  if (!raw) return null;
  try { const { userId } = JSON.parse(raw); return store.get('users', userId); } catch { return null; }
}
export function role(user = currentUser()) { return user ? store.get('roles', user.role) : null; }
export function can(perm, user = currentUser()) { return !!role(user)?.permissions.includes(perm); }
export const roleLabel = (user = currentUser()) => role(user)?.name || '';
