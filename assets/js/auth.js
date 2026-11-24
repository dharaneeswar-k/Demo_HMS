// Mock authentication — demonstration only. Passwords live in users.json in plain text on purpose (demo data).
import { store } from './data-service.js';

const KEY = 'nallam_hms_session';

export function login(username, password, remember) {
  const u = store.all('users').find((x) => x.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!u || u.password !== password) return { ok: false, error: 'Invalid username or password.' };
  if (!u.active) return { ok: false, error: 'This account is inactive. Contact the hospital administrator.' };
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
