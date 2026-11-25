// User Management & Access Control (BRD module 14) — individual accounts (max 10), roles, activation and password resets.
import { store } from '../data-service.js';
import { currentUser } from '../auth.js';
import { audit } from '../services.js';
import { badge, openModal, confirmDialog, kpi, card } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, initials, fmtDateTime, refreshIcons } from '../utils.js';

// What each permission unlocks, in plain words (used for the access matrix).
const MODULES = [
  ['Patients', 'users-round', 'patient.view'], ['OP visits & tokens', 'stethoscope', 'op.register'], ['OP consultation', 'notebook-pen', 'op.consult'], ['Vitals & nursing', 'heart-pulse', 'op.vitals'],
  ['Admit patients', 'hospital', 'ip.admit'], ['Ward indents (issue)', 'pill-bottle', 'ip.indent.issue'], ['IP final bill & settlement', 'receipt-text', 'ip.bill.final'], ['Insurance / TPA', 'shield-plus', 'ip.tpa'],
  ['Hospital cash counter', 'wallet', 'hospital.closing'], ['Doctors, beds & tariff', 'building-2', 'clinical.masters'],
  ['Pharmacy billing', 'receipt', 'pharmacy.bill'], ['Returns & refunds', 'undo-2', 'pharmacy.return.request'], ['Close the day', 'lock', 'pharmacy.closing'],
  ['Daily stock count', 'clipboard-check', 'stockcount.do'], ['Receive stock (GRN)', 'package-plus', 'grn.create'], ['Store → Pharmacy transfer', 'arrow-right-left', 'store.transfer'],
  ['Stock corrections', 'scale', 'adjustment.request'], ['Medicines & suppliers', 'pill', 'medicine.manage'], ['Reports', 'bar-chart-3', 'reports.view'],
  ['Approvals (discount, refunds, closings)', 'inbox', 'discount.approve'], ['Settings', 'settings', 'settings.manage'], ['User accounts', 'user-cog', 'users.manage'], ['Audit log', 'history', 'audit.view']
];
const maxUsers = () => Number(store.settings().maxUsers) || 10;
const lastActivity = (uid) => store.all('audit').filter((a) => a.userId === uid).map((a) => a.at).sort().at(-1) || null;

function saveUser(d, existing, actor) {
  const users = store.all('users');
  const uname = String(d.username || '').trim().toLowerCase();
  if (!String(d.name || '').trim()) throw new Error('Enter the person’s full name.');
  if (!/^[a-z][a-z0-9._]{2,19}$/.test(uname)) throw new Error('Username: 3–20 lowercase letters or numbers, starting with a letter.');
  if (users.some((u) => u.username === uname && u.id !== existing?.id)) throw new Error(`Username "${uname}" is already taken.`);
  if (!store.get('roles', d.role)) throw new Error('Select a role.');
  if (d.phone && !/^[+\d][\d\s-]{9,15}$/.test(d.phone)) throw new Error('Enter a valid phone number.');
  if (!existing) {
    if (users.filter((u) => u.active).length >= maxUsers()) throw new Error(`The licence allows ${maxUsers()} active user accounts. Deactivate an account first.`);
    if (!d.password || d.password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (d.password !== d.confirm) throw new Error('Passwords do not match.');
  }
  if (existing && existing.role === 'SUPER_ADMIN' && d.role !== 'SUPER_ADMIN' && users.filter((u) => u.role === 'SUPER_ADMIN' && u.active).length <= 1) throw new Error('At least one active Super Admin is required.');
  return store.transaction(() => {
    if (existing) {
      const before = `${existing.role}`;
      Object.assign(existing, { name: d.name.trim(), username: uname, role: d.role, designation: d.designation || '', phone: d.phone || '' });
      audit(actor, 'USER_UPDATED', 'USER', existing.id, `${existing.name} (${uname}) role ${before} → ${d.role}`);
      return existing;
    }
    const u = store.insert('users', { id: store.nextId('users', 'USR-'), username: uname, password: d.password, name: d.name.trim(), role: d.role, designation: d.designation || '', email: '', phone: d.phone || '', active: true, createdAt: new Date().toISOString(), createdBy: actor.id });
    audit(actor, 'USER_CREATED', 'USER', u.id, `${u.name} (${uname}) as ${store.get('roles', d.role).name}`);
    return u;
  });
}

function userForm(u, onDone) {
  const me = currentUser();
  const roles = store.all('roles');
  const m = openModal({ title: u ? `Edit ${u.name}` : 'Add user account', subtitle: u ? `Account ${u.id}` : `${store.all('users').filter((x) => x.active).length} of ${maxUsers()} accounts in use`, size: 'md',
    body: `<form class="form-grid" data-uf novalidate>
      <div class="field col-12"><label>Full name <span class="req">*</span></label><input class="input" name="name" value="${esc(u?.name || '')}"></div>
      <div class="field col-6"><label>Username <span class="req">*</span></label><input class="input mono" name="username" value="${esc(u?.username || '')}" autocomplete="off" placeholder="e.g. lab1"></div>
      <div class="field col-6"><label>Phone</label><input class="input" name="phone" value="${esc(u?.phone || '')}" placeholder="+91 90000 00000"></div>
      <div class="field col-12"><label>Role <span class="req">*</span></label><div class="role-pick">${roles.map((r) => `<label class="role-opt"><input type="radio" name="role" value="${r.id}" ${u?.role === r.id || (!u && r.id === 'PHARMACY_STAFF') ? 'checked' : ''}><span><strong>${esc(r.name)}</strong><small>${esc(r.description)}</small></span></label>`).join('')}</div></div>
      <div class="field col-12"><label>Designation</label><input class="input" name="designation" value="${esc(u?.designation || '')}" placeholder="e.g. Pharmacist, Store Incharge"></div>
      ${u ? '' : `<div class="field col-6"><label>Temporary password <span class="req">*</span></label><input class="input" type="password" name="password" autocomplete="new-password"></div>
      <div class="field col-6"><label>Confirm password <span class="req">*</span></label><input class="input" type="password" name="confirm" autocomplete="new-password"></div>
      <div class="col-12 field-hint">Share the temporary password with the person directly. Each person must use their own account — every action is recorded under it.</div>`}
    </form>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: u ? 'Save changes' : 'Create account', cls: 'btn-primary', icon: u ? 'save' : 'user-plus', onClick: (close, w) => {
      const d = Object.fromEntries(new FormData(w.querySelector('[data-uf]')));
      if (u && u.id === me.id && d.role !== u.role) { toast('You cannot change your own role.', 'error'); return; }
      try { const x = saveUser(d, u, me); toast(u ? 'User updated.' : `Account created for ${x.name}.`); close(); onDone(); } catch (e) { toast(e.message, 'error'); }
    } }] });
  m.el.querySelector('[name=username]').addEventListener('input', (e) => { e.target.value = e.target.value.toLowerCase().replace(/\s/g, ''); });
}

export function render(view) {
  const me = currentUser();
  const draw = () => {
    const users = [...store.all('users')].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    const active = users.filter((u) => u.active).length;
    const roles = store.all('roles');
    view.innerHTML = `<div class="page-head"><div><p class="muted">Every staff member signs in with their own account. Each role sees only its own screens, and every action is recorded under the person who did it.</p></div>
        <div class="page-actions"><button class="btn btn-primary" data-add ${active >= maxUsers() ? 'disabled' : ''}>${icon('user-plus')}Add user</button></div></div>
      <div class="kpis mb-2">
        ${kpi({ label: 'Active accounts', value: `${active} / ${maxUsers()}`, iconName: 'users-round', tone: active >= maxUsers() ? 'warning' : 'teal', sub: 'Licence limit' })}
        ${kpi({ label: 'Roles in use', value: new Set(users.filter((u) => u.active).map((u) => u.role)).size, iconName: 'shield-check', tone: 'navy' })}
        ${kpi({ label: 'Deactivated', value: users.length - active, iconName: 'user-x', tone: 'danger' })}
      </div>
      ${card('User accounts', `<table class="table"><thead><tr><th>Person</th><th>Username</th><th>Role</th><th>Phone</th><th>Last activity</th><th>Status</th><th></th></tr></thead><tbody>
        ${users.map((u) => { const last = lastActivity(u.id); return `<tr class="${u.active ? '' : 'row-muted'}"><td><div class="row"><span class="avatar">${esc(initials(u.name))}</span><div><div class="cell-main">${esc(u.name)}${u.id === me.id ? ' <span class="tag tag-info">You</span>' : ''}</div><div class="cell-sub">${esc(u.designation || '')}</div></div></div></td>
          <td class="mono">${esc(u.username)}</td><td>${esc(store.get('roles', u.role)?.name || u.role)}</td><td class="small">${esc(u.phone || '—')}</td><td class="small">${last ? fmtDateTime(last) : 'No activity yet'}</td>
          <td>${badge(u.active ? 'ACTIVE' : 'INACTIVE', u.active ? 'Active' : 'Deactivated')}</td>
          <td><div class="row-actions"><button class="btn btn-ghost btn-sm" data-edit="${u.id}" title="Edit">${icon('pencil')}</button><button class="btn btn-ghost btn-sm" data-pw="${u.id}" title="Reset password">${icon('key-round')}</button>${u.id !== me.id ? `<button class="btn btn-ghost btn-sm" data-toggle="${u.id}" title="${u.active ? 'Deactivate' : 'Activate'}">${icon(u.active ? 'user-x' : 'user-check')}</button>` : ''}</div></td></tr>`; }).join('')}</tbody></table>`, { cls: 'flush' })}
      ${card('What each role can open', `<div class="table-scroll"><table class="table dense access-matrix"><thead><tr><th>Screen</th>${roles.map((r) => `<th class="ta-center">${esc(r.name)}</th>`).join('')}</tr></thead><tbody>
        ${MODULES.map(([label, ic, perm]) => `<tr><td>${icon(ic, 'ic-inline')} ${esc(label)}</td>${roles.map((r) => `<td class="ta-center">${r.permissions.includes(perm) ? `<span class="am-yes">${icon('check')}</span>` : '<span class="am-no">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="muted small" style="padding:12px 20px">Roles follow the hospital's role map: Super Admin, Reception, Doctor, Nurse, Billing, Pharmacy and Store. Lab, MRD and Service Counter roles are added with their modules.</p>`, { cls: 'flush mt-2' })}`;
    refreshIcons(view);
    view.querySelector('[data-add]').onclick = () => userForm(null, draw);
    view.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => userForm(store.get('users', b.dataset.edit), draw); });
    view.querySelectorAll('[data-pw]').forEach((b) => { b.onclick = () => resetPassword(store.get('users', b.dataset.pw), draw); });
    view.querySelectorAll('[data-toggle]').forEach((b) => { b.onclick = async () => {
      const u = store.get('users', b.dataset.toggle);
      if (u.active && u.role === 'SUPER_ADMIN' && store.all('users').filter((x) => x.role === 'SUPER_ADMIN' && x.active).length <= 1) { toast('At least one active Super Admin is required.', 'error'); return; }
      if (!u.active && store.all('users').filter((x) => x.active).length >= maxUsers()) { toast(`The licence allows ${maxUsers()} active accounts.`, 'error'); return; }
      if (!(await confirmDialog({ title: `${u.active ? 'Deactivate' : 'Activate'} ${u.name}?`, iconName: u.active ? 'user-x' : 'user-check', tone: u.active ? 'danger' : 'primary', confirmLabel: u.active ? 'Deactivate' : 'Activate',
        message: u.active ? 'They will not be able to sign in. Their past bills and records stay unchanged.' : 'They will be able to sign in again.' }))) return;
      store.transaction(() => { u.active = !u.active; audit(me, u.active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'USER', u.id, u.name); });
      toast(`${u.name} ${u.active ? 'activated' : 'deactivated'}.`); draw();
    }; });
  };
  draw();
}

function resetPassword(u, done) {
  const me = currentUser();
  openModal({ title: `Reset password — ${u.name}`, subtitle: `Username ${u.username}`, size: 'sm',
    body: `<form class="form-grid" data-pf><div class="field col-12"><label>New password</label><input class="input" type="password" name="p1" autocomplete="new-password"></div><div class="field col-12"><label>Confirm password</label><input class="input" type="password" name="p2" autocomplete="new-password"></div><div class="col-12 field-hint">At least 6 characters. Give it to the person directly.</div></form>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Reset password', cls: 'btn-primary', onClick: (close, w) => {
      const f = w.querySelector('[data-pf]');
      if (f.p1.value.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }
      if (f.p1.value !== f.p2.value) { toast('Passwords do not match.', 'error'); return; }
      store.transaction(() => { u.password = f.p1.value; audit(me, 'USER_PASSWORD_RESET', 'USER', u.id, u.name); });
      toast(`Password reset for ${u.name}.`); close(); done();
    } }] });
}
