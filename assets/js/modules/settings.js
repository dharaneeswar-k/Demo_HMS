// Settings (data-driven branding, thresholds, approval policy), Audit Log and My Profile
import { store, resetDemoData } from '../data-service.js';
import { currentUser, can, roleLabel } from '../auth.js';
import { userName, locationName } from '../calculations.js';
import { audit } from '../services.js';
import { card, dataTable, exportTable, confirmDialog, emptyState, badge, dl } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtDateTime, ymd, debounce, titleCase, initials, refreshIcons } from '../utils.js';
import { rerender, brandMark } from '../app.js';

function resizeImage(file, maxW, type = 'image/png', quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); return; }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL(type, quality)); URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = URL.createObjectURL(file);
  });
}

export function render(view) {
  const s = store.settings();
  const edit = can('settings.manage');
  const dis = edit ? '' : 'disabled';
  const ap = s.approval;
  const ph = store.ph();
  view.innerHTML = `
    <div class="page-head"><div><p class="muted">${edit ? 'Configuration is stored as data — changing it here updates the whole application without code changes.' : 'Only the Hospital Owner can change system settings. You can view the current configuration and update your profile.'}</p></div>
      <div class="page-actions"><a class="btn btn-secondary" href="#/profile">${icon('user-round')}My profile</a>${edit ? `<button class="btn btn-primary" data-save>${icon('save')}Save settings</button>` : ''}</div></div>
    <div class="grid grid-2">
      ${card('Hospital Branding', `<div class="form-grid">
        <div class="field col-6"><label>Hospital Name</label><input class="input" data-s="hospitalName" value="${esc(s.hospitalName)}" ${dis}></div>
        <div class="field col-6"><label>City / Address line</label><input class="input" data-s="city" value="${esc(s.city)}" ${dis}></div>
        <div class="field col-12"><label>Tagline</label><input class="input" data-s="tagline" value="${esc(s.tagline)}" ${dis}></div>
        <div class="field col-6"><label>Hospital Logo</label><div class="logo-preview" data-logo-prev>${brandMark('sm')}</div>
          ${edit ? `<div class="row mt-1"><label class="btn btn-secondary btn-sm">${icon('upload')}Upload logo<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden data-logo></label>${s.logo ? `<button class="btn btn-ghost btn-sm" data-rm-logo>Remove</button>` : ''}</div><span class="field-hint">Use the official logo file. Without a logo, a clean text mark is shown.</span>` : ''}</div>
        <div class="field col-6"><label>Login Banner Image</label><div class="logo-preview" style="background:${s.banner.image ? `url('${esc(s.banner.image)}') center/cover` : 'var(--navy)'}"><span class="small" style="color:#fff">${s.banner.image ? '' : 'Default gradient'}</span></div>
          ${edit ? `<div class="row mt-1"><label class="btn btn-secondary btn-sm">${icon('image')}Upload banner<input type="file" accept="image/*" hidden data-banner></label>${s.banner.image ? `<button class="btn btn-ghost btn-sm" data-rm-banner>Remove</button>` : ''}</div>` : ''}</div>
        <div class="field col-12"><label>Login Banner Title</label><input class="input" data-b="title" value="${esc(s.banner.title)}" ${dis}></div>
        <div class="field col-12"><label>Login Banner Subtitle</label><textarea class="input" rows="2" data-b="subtitle" ${dis}>${esc(s.banner.subtitle)}</textarea></div>
      </div>`)}
      <div>
      ${card('Theme Colours', `<div class="form-grid">
        <div class="field col-6"><label>Primary (sidebar, headings)</label><div class="row"><input type="color" class="swatch" data-t="primary" value="${s.theme.primary}" ${dis}><code>${s.theme.primary}</code></div></div>
        <div class="field col-6"><label>Accent (actions, active states)</label><div class="row"><input type="color" class="swatch" data-t="accent" value="${s.theme.accent}" ${dis}><code>${s.theme.accent}</code></div></div>
        ${edit ? `<div class="col-12"><button class="btn btn-ghost btn-sm" data-theme-reset>${icon('rotate-ccw')}Restore official Nallam palette (#023459 / #049794)</button></div>` : ''}</div>`)}
      ${card('Inventory Configuration', `<div class="form-grid">
        <div class="field col-6"><label>Near-expiry threshold (days)</label><input class="input" type="number" min="1" max="730" data-n="expiryThresholdDays" value="${s.expiryThresholdDays}" ${dis}><span class="field-hint">Batches expiring within this window are flagged Near Expiry</span></div>
        <div class="field col-6"><label>Critical expiry (days)</label><input class="input" type="number" min="1" data-n="criticalExpiryDays" value="${s.criticalExpiryDays}" ${dis}><span class="field-hint">Raises alert severity to critical</span></div>
        <div class="field col-6"><label>Low-stock basis</label><select class="input" data-s="lowStockBasis" ${dis}><option value="REORDER_LEVEL" ${s.lowStockBasis === 'REORDER_LEVEL' ? 'selected' : ''}>At/below reorder level</option><option value="MIN_STOCK_LEVEL" ${s.lowStockBasis === 'MIN_STOCK_LEVEL' ? 'selected' : ''}>At/below minimum stock level</option></select></div>
        <div class="field col-6"><label>Default inventory location</label><select class="input" data-s="defaultLocationId" ${dis}>${store.all('locations').filter((l) => l.active).map((l) => `<option value="${l.id}" ${l.id === s.defaultLocationId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
        <div class="field col-6"><label>Max delivery photos per GRN</label><input class="input" type="number" min="1" max="20" data-n="maxDeliveryPhotos" value="${s.maxDeliveryPhotos}" ${dis}></div>
        <div class="field col-6"><label>Max upload size (MB)</label><input class="input" type="number" min="1" max="20" data-n="maxFileSizeMB" value="${s.maxFileSizeMB}" ${dis}></div>
      </div>`)}
      </div>
    </div>
    <div class="grid grid-2">
      ${card('Approval Rules', `<div class="form-grid">
        <div class="col-12"><label class="switch"><input type="checkbox" data-a="ownerApprovalForExpiredOrShortDated" ${ap.ownerApprovalForExpiredOrShortDated ? 'checked' : ''} ${dis}> Owner approval for expired or short-dated deliveries</label></div>
        <div class="field col-6"><label>Short-dated if expiring within (days)</label><input class="input" type="number" min="0" data-an="shortDatedDays" value="${ap.shortDatedDays}" ${dis}></div>
        <div class="field col-6"><label>Invoice qty variance needing owner (%)</label><input class="input" type="number" min="0" data-an="discrepancyPctThreshold" value="${ap.discrepancyPctThreshold}" ${dis}></div>
        <div class="field col-6"><label>High-value GRN threshold (₹)</label><input class="input" type="number" min="0" data-an="highValueThreshold" value="${ap.highValueThreshold}" ${dis}></div>
        <div class="field col-6"><label>Adjustment qty needing owner (units)</label><input class="input" type="number" min="0" data-an="adjustmentQtyThreshold" value="${ap.adjustmentQtyThreshold}" ${dis}></div>
        <div class="field col-6"><label>Adjustment value needing owner (₹)</label><input class="input" type="number" min="0" data-an="adjustmentValueThreshold" value="${ap.adjustmentValueThreshold}" ${dis}></div>
        <div class="col-6" style="align-self:end"><label class="switch"><input type="checkbox" data-a="notifyOwnerOnPost" ${ap.notifyOwnerOnPost ? 'checked' : ''} ${dis}> Notify owner when stock is posted</label></div>
        <div class="col-12"><div class="ai-note">${icon('info')}<span>Routine receipts are verified and posted by the Pharmacy Manager. Only exceptions are escalated — the owner is not asked to approve every receipt.</span></div></div>
      </div>`)}
      ${card('Stock Locations', `<ul class="list-plain">${store.all('locations').map((l) => `<li class="list-row"><div><strong>${esc(l.name)}</strong> <span class="mono muted small">${esc(l.code)}</span>${l.id === s.defaultLocationId ? ' <span class="tag tag-success">Default</span>' : ''}<div class="cell-sub">${esc(l.description)}</div></div>
        ${edit ? `<label class="switch small"><input type="checkbox" data-loc="${l.id}" ${l.active ? 'checked' : ''} ${l.id === s.defaultLocationId ? 'disabled' : ''}> ${l.active ? 'Active' : 'Inactive'}</label>` : badge(l.active ? 'ACTIVE' : 'INACTIVE')}</li>`).join('')}</ul>
        ${edit ? `<div class="row mt-2"><input class="input" style="flex:1" placeholder="New location name, e.g. ICU Sub-store" data-newloc><button class="btn btn-secondary" data-addloc>${icon('plus')}Add</button></div>` : ''}
        <p class="muted small mt-1">Stock is currently managed at a single pharmacy location. Add more locations here when sub-stores are set up.</p>`)}
    </div>
    ${card('Pharmacy & Billing', `<div class="form-grid">
      <div class="field col-3"><label>Business day starts at (hour)</label><input class="input" type="number" min="0" max="12" data-p="businessDayStartHour" value="${ph.businessDayStartHour}" ${dis}><span class="field-hint">Bills before this hour belong to the previous accounting day</span></div>
      <div class="field col-3"><label>Opening cash float (₹)</label><input class="input" type="number" min="0" data-p="openingCashFloat" value="${ph.openingCashFloat}" ${dis}></div>
      <div class="field col-3"><label>Cash variance tolerance (₹)</label><input class="input" type="number" min="0" data-p="cashVarianceTolerance" value="${ph.cashVarianceTolerance}" ${dis}><span class="field-hint">Above this the owner gets a variance alert</span></div>
      <div class="field col-3"><label>Owner approval for refunds above (₹)</label><input class="input" type="number" min="0" data-pr="ownerApprovalAbove" value="${ph.refund.ownerApprovalAbove}" ${dis}></div>
      <div class="field col-6"><label>Maximum discount without owner approval (%)</label><input class="input" type="number" min="0" max="100" data-pd="staffPct" value="${ph.discountLimits.staffPct}" ${dis}><span class="field-hint">Applies to staff and managers. Anything higher needs the owner's approval at the counter.</span></div>
      <div class="field col-3"><label>Notify owner of discounts ≥ (%)</label><input class="input" type="number" min="0" max="100" data-p="largeDiscountNotifyPct" value="${ph.largeDiscountNotifyPct}" ${dis}></div>
      <div class="col-3" style="align-self:end"><label class="switch"><input type="checkbox" data-pc="allowCredit" ${ph.allowCredit ? 'checked' : ''} ${dis}> Allow credit to registered patients</label></div>
      <div class="col-12"><div class="section-title">Payment modes</div><div class="row">${ph.paymentModes.map((m) => `<label class="switch"><input type="checkbox" data-pm="${m.code}" ${m.active ? 'checked' : ''} ${dis || (m.code === 'CASH' ? 'disabled' : '')}> ${esc(m.label)}</label>`).join('<span style="width:16px"></span>')}</div></div>
      <div class="col-12 section-title mt-1">Receipt details</div>
      <div class="field col-6"><label>Address</label><input class="input" data-rc="address" value="${esc(ph.receipt.address)}" ${dis}></div>
      <div class="field col-3"><label>Phone</label><input class="input" data-rc="phone" placeholder="Pharmacy phone number" value="${esc(ph.receipt.phone)}" ${dis}></div>
      <div class="field col-3"><label>GSTIN</label><input class="input" data-rc="gstin" placeholder="15-character GSTIN" value="${esc(ph.receipt.gstin)}" ${dis}></div>
      <div class="field col-6"><label>Drug licence no.</label><input class="input" data-rc="drugLicense" placeholder="Form 20B / 21B licence numbers" value="${esc(ph.receipt.drugLicense)}" ${dis}></div>
      <div class="field col-6"><label>Thank-you message</label><input class="input" data-rc="footer" value="${esc(ph.receipt.footer)}" ${dis}></div>
      <div class="col-12"><div class="ai-note">${icon('info')}<span>Covers internal pharmacy sales tally and daily reconciliation. Not yet connected to Tally Prime, GST filing or bank reconciliation. Data is structured for a future accounting export.</span></div></div>
    </div>`, { cls: 'mt-2' })}
    ${card('Hospital Network Access', `<p class="muted mb-2">Staff and managers can sign in only from the hospital's own internet connections listed here. ${s.network?.ownerAnywhere ? 'The owner can sign in from anywhere.' : 'The owner is also restricted.'}</p>
      <div class="row mb-2" style="gap:24px">
        <label class="switch"><input type="checkbox" data-net="restrictStaff" ${s.network?.restrictStaff ? 'checked' : ''} ${can('network.manage') ? '' : 'disabled'}> Restrict staff and managers to these addresses</label>
        <label class="switch"><input type="checkbox" data-net="ownerAnywhere" ${s.network?.ownerAnywhere ? 'checked' : ''} ${can('network.manage') ? '' : 'disabled'}> Owner can sign in from anywhere</label></div>
      <table class="table dense"><thead><tr><th>Connection</th><th>IP address / range</th><th>Added</th><th>Status</th><th></th></tr></thead><tbody>
      ${(s.network?.allowed || []).map((n) => `<tr><td class="cell-main">${esc(n.label)}</td><td class="mono">${esc(n.address)}</td><td class="cell-sub">${esc(n.addedAt || '')}</td>
        <td>${can('network.manage') ? `<label class="switch small"><input type="checkbox" data-netact="${n.id}" ${n.active ? 'checked' : ''}> ${n.active ? 'Allowed' : 'Blocked'}</label>` : badge(n.active ? 'ACTIVE' : 'INACTIVE', n.active ? 'Allowed' : 'Blocked')}</td>
        <td class="ta-right">${can('network.manage') ? `<button class="btn btn-ghost btn-sm text-danger" data-netrm="${n.id}" title="Remove">${icon('trash-2')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">No connections added — staff cannot sign in until one is added.</td></tr>`}</tbody></table>
      ${can('network.manage') ? `<div class="row mt-2"><input class="input" style="flex:1;min-width:200px" data-netlabel placeholder="Name, e.g. Ground floor reception broadband"><input class="input mono" style="width:220px" data-netaddr placeholder="IP, e.g. 117.193.52.40 or 49.204.118.0/24"><button class="btn btn-secondary" data-netadd>${icon('plus')}Add connection</button></div>
        <p class="field-hint mt-1">Ask your internet provider for the hospital's static IP address. Use a range (…/24) for routers that change address.</p>` : ''}`, { cls: 'mt-2' })}
    <div class="grid grid-2">
      ${card('Users & Roles', `<table class="table dense"><thead><tr><th>User</th><th>Username</th><th>Role</th><th>Status</th></tr></thead><tbody>${store.all('users').map((u) => `<tr><td><div class="row"><span class="avatar">${esc(initials(u.name))}</span><div><div class="cell-main">${esc(u.name)}</div><div class="cell-sub">${esc(u.designation)}</div></div></div></td><td class="mono">${esc(u.username)}</td><td>${esc(store.get('roles', u.role).name)}</td><td>${badge(u.active ? 'ACTIVE' : 'INACTIVE')}</td></tr>`).join('')}</tbody></table>
        <p class="muted small" style="padding:12px 20px">${can('users.manage') ? '<a href="#/users">Manage user accounts →</a>' : 'Ask the Super Admin to change user accounts.'}</p>`, { cls: 'flush' })}
      ${card('Data & Backup', `<p class="muted mb-2">Download a full backup of pharmacy, stock and billing records, or restore the system to its initial data set.</p>
        <div class="row"><button class="btn btn-secondary" data-export-json>${icon('download')}Download backup</button><button class="btn btn-danger-outline" data-reset>${icon('rotate-ccw')}Restore initial data</button></div>`)}
    </div>`;

  const draft = JSON.parse(JSON.stringify(s));
  view.querySelectorAll('[data-s]').forEach((el) => { el.oninput = el.onchange = () => { draft[el.dataset.s] = el.value; }; });
  view.querySelectorAll('[data-n]').forEach((el) => { el.oninput = () => { draft[el.dataset.n] = Number(el.value); }; });
  view.querySelectorAll('[data-b]').forEach((el) => { el.oninput = () => { draft.banner[el.dataset.b] = el.value; }; });
  view.querySelectorAll('[data-t]').forEach((el) => { el.oninput = () => { draft.theme[el.dataset.t] = el.value; el.nextElementSibling.textContent = el.value; document.documentElement.style.setProperty(el.dataset.t === 'primary' ? '--h-navy' : '--h-brand', el.value); }; });
  view.querySelectorAll('[data-a]').forEach((el) => { el.onchange = () => { draft.approval[el.dataset.a] = el.checked; }; });
  view.querySelectorAll('[data-an]').forEach((el) => { el.oninput = () => { draft.approval[el.dataset.an] = Number(el.value); }; });
  const phd = JSON.parse(JSON.stringify(store.ph()));
  view.querySelectorAll('[data-p]').forEach((el) => { el.oninput = () => { phd[el.dataset.p] = Number(el.value); }; });
  view.querySelectorAll('[data-pr]').forEach((el) => { el.oninput = () => { phd.refund[el.dataset.pr] = Number(el.value); }; });
  view.querySelectorAll('[data-pd]').forEach((el) => { el.oninput = () => { phd.discountLimits.staffPct = Number(el.value); phd.discountLimits.managerPct = Number(el.value); }; });
  view.querySelectorAll('[data-pc]').forEach((el) => { el.onchange = () => { phd[el.dataset.pc] = el.checked; }; });
  view.querySelectorAll('[data-pm]').forEach((el) => { el.onchange = () => { phd.paymentModes.find((m) => m.code === el.dataset.pm).active = el.checked; }; });
  view.querySelectorAll('[data-rc]').forEach((el) => { el.oninput = () => { phd.receipt[el.dataset.rc] = el.value; }; });
  const saveNet = (msg) => { store.updateSettings({ network: JSON.parse(JSON.stringify(store.settings().network || { allowed: [] })) }); store.transaction(() => audit(currentUser(), 'NETWORK_ACCESS_UPDATED', 'SETTINGS', 'network', msg)); rerender(); };
  view.querySelectorAll('[data-net]').forEach((el) => { el.onchange = () => { store.settings().network[el.dataset.net] = el.checked; saveNet(`${el.dataset.net} = ${el.checked}`); toast('Network access updated.'); }; });
  view.querySelectorAll('[data-netact]').forEach((el) => { el.onchange = () => { const n = store.settings().network.allowed.find((x) => x.id === el.dataset.netact); n.active = el.checked; saveNet(`${n.address} ${el.checked ? 'allowed' : 'blocked'}`); toast(`${n.label} ${el.checked ? 'allowed' : 'blocked'}.`); }; });
  view.querySelectorAll('[data-netrm]').forEach((el) => { el.onclick = async () => { const net = store.settings().network; const n = net.allowed.find((x) => x.id === el.dataset.netrm); if (!(await confirmDialog({ title: 'Remove connection?', message: `Staff will no longer be able to sign in from <strong>${esc(n.label)}</strong> (${esc(n.address)}).`, confirmLabel: 'Remove', tone: 'danger', iconName: 'trash-2' }))) return; net.allowed = net.allowed.filter((x) => x.id !== n.id); saveNet(`Removed ${n.address}`); toast('Connection removed.'); }; });
  view.querySelector('[data-netadd]')?.addEventListener('click', () => {
    const label = view.querySelector('[data-netlabel]').value.trim(); const addr = view.querySelector('[data-netaddr]').value.trim();
    const ok = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/(3[0-2]|[12]?\d))?$/.test(addr);
    if (!label) { toast('Give the connection a name.', 'error'); return; }
    if (!ok) { toast('Enter a valid IPv4 address or range, e.g. 117.193.52.40 or 49.204.118.0/24.', 'error'); return; }
    const net = store.settings().network || (store.settings().network = { restrictStaff: true, ownerAnywhere: true, allowed: [] });
    if (net.allowed.some((x) => x.address === addr)) { toast('This address is already in the list.', 'error'); return; }
    net.allowed.push({ id: 'NET-' + String(Date.now()).slice(-6), label, address: addr, active: true, addedBy: currentUser().id, addedAt: new Date().toISOString().slice(0, 10) });
    saveNet(`Added ${addr} (${label})`); toast('Connection added.');
  });
  const user = currentUser();
  const saveNow = (msg) => { store.updatePh(phd); store.updateSettings(draft); store.transaction(() => audit(user, 'SETTINGS_UPDATED', 'SETTINGS', 'settings', msg)); };

  view.querySelector('[data-save]')?.addEventListener('click', () => {
    if (!draft.hospitalName.trim()) { toast('Hospital name is required.', 'error'); return; }
    if (draft.expiryThresholdDays < 1 || draft.criticalExpiryDays < 1) { toast('Expiry thresholds must be at least 1 day.', 'error'); return; }
    if (draft.criticalExpiryDays > draft.expiryThresholdDays) { toast('Critical expiry days cannot exceed the near-expiry threshold.', 'error'); return; }
    if (phd.businessDayStartHour < 0 || phd.businessDayStartHour > 12) { toast('Business day start hour must be between 0 and 12.', 'error'); return; }
    saveNow('General settings saved'); toast('Settings saved. All dashboards and alerts now use the new configuration.'); rerender();
  });
  view.querySelector('[data-theme-reset]')?.addEventListener('click', () => { draft.theme = { primary: '#023459', accent: '#049794' }; saveNow('Theme reset'); rerender(); });
  const upload = async (input, key) => {
    const f = input.files[0]; if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Please choose an image file.', 'error'); return; }
    try {
      const data = await resizeImage(f, key === 'logo' ? 480 : 1600, key === 'logo' ? 'image/png' : 'image/jpeg', 0.8);
      if (key === 'logo') draft.logo = data; else draft.banner.image = data;
      saveNow(key === 'logo' ? 'Logo updated' : 'Login banner updated'); toast(key === 'logo' ? 'Logo updated.' : 'Login banner updated.'); rerender();
    } catch (e) { toast(e.message, 'error'); }
  };
  view.querySelector('[data-logo]')?.addEventListener('change', (e) => upload(e.target, 'logo'));
  view.querySelector('[data-banner]')?.addEventListener('change', (e) => upload(e.target, 'banner'));
  view.querySelector('[data-rm-logo]')?.addEventListener('click', () => { draft.logo = null; saveNow('Logo removed'); rerender(); });
  view.querySelector('[data-rm-banner]')?.addEventListener('click', () => { draft.banner.image = null; saveNow('Banner removed'); rerender(); });
  view.querySelectorAll('[data-loc]').forEach((el) => { el.onchange = () => { store.transaction(() => { store.update('locations', el.dataset.loc, { active: el.checked }); audit(user, 'LOCATION_UPDATED', 'LOCATION', el.dataset.loc, el.checked ? 'Activated' : 'Deactivated'); }); toast(`${locationName(el.dataset.loc)} ${el.checked ? 'activated' : 'deactivated'}.`); rerender(); }; });
  view.querySelector('[data-addloc]')?.addEventListener('click', () => {
    const name = view.querySelector('[data-newloc]').value.trim(); if (!name) { toast('Enter a location name.', 'error'); return; }
    store.transaction(() => { const id = store.nextId('locations', 'LOC-', 2); store.insert('locations', { id, name, code: name.replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase(), type: 'SUB_STORE', active: true, isDefault: false, description: 'Added from Settings' }); audit(user, 'LOCATION_CREATED', 'LOCATION', id, name); });
    toast(`Location “${name}” added.`); rerender();
  });
  view.querySelector('[data-export-json]').onclick = () => {
    const dump = {}; ['users', 'roles', 'categories', 'medicines', 'suppliers', 'locations', 'grns', 'attachments', 'batches', 'movements', 'adjustments', 'notifications', 'audit', 'settings', 'patients', 'pharmacySettings', 'bills', 'billItems', 'payments', 'pReturns', 'pReturnItems', 'cancellations', 'closings', 'closingPayments'].forEach((k) => { dump[k] = store.all(k); });
    dump.users = dump.users.map(({ password, ...u }) => u);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })), download: `nallam-hms-data-${ymd()}.json` });
    a.click(); toast('Data backup downloaded.');
  };
  view.querySelector('[data-reset]').onclick = async () => {
    if (!(await confirmDialog({ title: 'Restore initial data?', message: 'All GRNs, stock movements, adjustments, settings, uploads and notifications created in this browser will be replaced with the original JSON data.', confirmLabel: 'Restore initial data', tone: 'danger', iconName: 'rotate-ccw' }))) return;
    await resetDemoData(); Object.keys(localStorage).filter((k) => k.startsWith('nallam_hms_acks_')).forEach((k) => localStorage.removeItem(k));
    toast('Initial data restored.'); rerender();
  };
}

export function renderAudit(view, params, query) {
  const rows = [...store.all('audit')].sort((a, b) => b.at.localeCompare(a.at));
  const actions = [...new Set(rows.map((r) => r.action))].sort();
  view.innerHTML = `<div class="page-head"><div><p class="muted">Every important action records who did it and when. Audit entries cannot be edited or deleted.</p></div>
    <div class="page-actions"><button class="btn btn-secondary" data-export>${icon('download')}Export CSV</button></div></div>
    <section class="card"><div class="toolbar">
      <div class="search">${icon('search')}<input class="input" type="search" placeholder="Search entity ID or details…" data-f="q"></div>
      <select class="input" data-f="user"><option value="">All users</option>${store.all('users').map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
      <select class="input" data-f="action"><option value="">All actions</option>${actions.map((a) => `<option value="${a}">${titleCase(a)}</option>`).join('')}</select>
      <select class="input" data-f="entity"><option value="">All entities</option>${[...new Set(rows.map((r) => r.entity))].map((e) => `<option>${e}</option>`).join('')}</select>
      <span class="filter-label">From</span><input type="date" class="input" data-f="from"><span class="filter-label">To</span><input type="date" class="input" data-f="to">
    </div><div data-table></div></section>`;
  const link = (r) => ({ PATIENT: `#/patients/${r.entityId}`, TRANSFER: `#/transfers?focus=${r.entityId}`, DISCOUNT: `#/discounts?focus=${r.entityId}`, BILL: `#/pharmacy/bills/${r.entityId}`, GRN: `#/grn/${r.entityId}`, BATCH: `#/batches/${r.entityId}`, MEDICINE: `#/inventory/${r.entityId}`, ADJUSTMENT: `#/adjustments?focus=${r.entityId}`, SUPPLIER: `#/suppliers/${r.entityId}` }[r.entity]);
  const columns = [
    { key: 'id', label: 'Audit ID', render: (r) => `<span class="mono">${r.id}</span>` },
    { key: 'at', label: 'Timestamp', render: (r) => fmtDateTime(r.at), csv: (r) => fmtDateTime(r.at) },
    { key: 'user', label: 'User', value: (r) => userName(r.userId), render: (r) => esc(userName(r.userId)) },
    { key: 'action', label: 'Action', render: (r) => `<span class="tag tag-neutral">${esc(r.action.replace(/_/g, ' '))}</span>` },
    { key: 'entity', label: 'Entity' },
    { key: 'entityId', label: 'Reference', render: (r) => (link(r) ? `<a class="mono" href="${link(r)}">${esc(r.entityId)}</a>` : `<span class="mono">${esc(r.entityId)}</span>`) },
    { key: 'details', label: 'Details', render: (r) => `<span class="cell-sub">${esc(r.details)}</span>` }
  ];
  const t = dataTable({ columns, pageSize: 25, sort: { key: 'at', dir: 'desc' }, dense: true, empty: emptyState('history', 'No audit entries') });
  view.querySelector('[data-table]').appendChild(t.el);
  const f = (n) => view.querySelector(`[data-f="${n}"]`);
  const apply = () => { const q = f('q').value.trim().toLowerCase(); t.setRows(rows.filter((r) => (!q || [r.entityId, r.details].join(' ').toLowerCase().includes(q)) && (!f('user').value || r.userId === f('user').value) && (!f('action').value || r.action === f('action').value) && (!f('entity').value || r.entity === f('entity').value) && (!f('from').value || ymd(r.at) >= f('from').value) && (!f('to').value || ymd(r.at) <= f('to').value))); };
  view.querySelectorAll('[data-f]').forEach((el) => el.addEventListener(el.type === 'search' ? 'input' : 'change', debounce(apply, 120)));
  view.querySelector('[data-export]').onclick = () => { exportTable(`audit-log-${ymd()}.csv`, columns, t.getRows()); toast('Audit log exported.'); };
  apply();
}

export function renderProfile(view) {
  const u = currentUser(); const role = store.get('roles', u.role);
  const mine = store.all('audit').filter((a) => a.userId === u.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  view.innerHTML = `<div class="grid grid-1-2">
    <section class="card"><div class="card-body" style="text-align:center"><span class="avatar" style="width:80px;height:80px;font-size:26px;margin:0 auto">${esc(initials(u.name))}</span>
      <h2 class="mt-2" style="font-size:19px">${esc(u.name)}</h2><p class="muted">${esc(u.designation)}</p><span class="role-pill">${esc(roleLabel(u))}</span>
      <div class="divider"></div>${dl([['Username', `<span class="mono">${esc(u.username)}</span>`], ['Email', esc(u.email)], ['Phone', esc(u.phone)], ['User ID', esc(u.id)]])}
      <div class="alert alert-info mt-2" style="text-align:left">${icon('key-round')}<div>Passwords are managed by the hospital administrator. Contact them if you need to change it.</div></div></div></section>
    <div>${card(`Role: ${role.name}`, `<p class="muted mb-2">${esc(role.description)}</p><div class="row">${role.permissions.map((p) => `<span class="tag tag-info">${esc(p)}</span>`).join('')}</div>`)}
      ${card('My Recent Activity', mine.length ? `<ul class="list-plain">${mine.map((a) => `<li class="list-row"><div><strong>${titleCase(a.action)}</strong> <span class="mono small">${esc(a.entityId)}</span><div class="cell-sub">${esc(a.details)}</div></div><span class="tiny muted">${fmtDateTime(a.at)}</span></li>`).join('')}</ul>` : '<p class="muted">No recorded activity yet.</p>', { cls: 'mt-2' })}</div></div>`;
  refreshIcons(view);
}
