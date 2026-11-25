// Bed Board — every ward and bed with live status; bed panel (admit here, transfer, cleaning, block, reserve).
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { patient, doctorName, bed as getBed, ward, bedCategories, categoryLabel, cbadge, label, tpaName } from '../clinical.js';
import { bedStatus, bedAdmission, bedSummary, ipSummary, ipPosition, daysAdmitted, availableBeds, transferBed, setBedState, currentBedId, pendingIndentsOf } from '../ip.js';
import { userName } from '../calculations.js';
import { patientStrip } from './clinical-ui.js';
import { kpi, openModal, confirmDialog } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, relTime, refreshIcons, debounce } from '../utils.js';
import { navigate } from '../router.js';

const LEG = [['AVAILABLE', 'var(--success)'], ['OCCUPIED', 'var(--info)'], ['CLEANING', 'var(--warning)'], ['RESERVED', 'var(--purple)'], ['BLOCKED', '#8FA3B3']];

export function bedCard(b, { selectable = false, selected = false } = {}) {
  const s = bedStatus(b); const adm = s === 'OCCUPIED' ? bedAdmission(b.id) : null;
  let body = '';
  if (adm) {
    const p = patient(adm.patientId); const pos = ipPosition(adm);
    body = `<span class="bedc-name">${esc(p.name)}</span><span class="bedc-sub">Day ${daysAdmitted(adm)} · ${esc(doctorName(adm.doctorId).replace('Dr. ', 'Dr '))}</span>
      <span class="bedc-flags">${adm.status !== 'ADMITTED' ? '<span class="tag tag-purple">Discharging</span>' : ''}${pos.low ? '<span class="tag tag-danger">Low deposit</span>' : ''}${adm.payer.type !== 'SELF' ? `<span class="tag tag-info">${adm.payer.type === 'INSURANCE' ? 'TPA' : 'Corp'}</span>` : ''}${pendingIndentsOf(adm.id).length ? '<span class="tag tag-warning">Indent</span>' : ''}${p.allergies ? '<span class="tag tag-danger">Allergy</span>' : ''}</span>`;
  } else {
    body = `<span class="bedc-name">${esc(label(s))}</span><span class="bedc-sub">${s === 'AVAILABLE' ? fmtINR(bedCategories()[b.category]?.rate, true) + ' / day' : esc(b.note || (b.updatedAt ? 'since ' + relTime(b.updatedAt) : ''))}</span>`;
  }
  return `<button type="button" class="bedc s-${s} ${selected ? 'sel' : ''}" data-bed="${b.id}" ${selectable && s !== 'AVAILABLE' && s !== 'RESERVED' ? 'disabled' : ''}><span class="bedc-code">${esc(b.code)}${icon(s === 'OCCUPIED' ? 'bed-double' : s === 'CLEANING' ? 'sparkles' : s === 'BLOCKED' ? 'wrench' : s === 'RESERVED' ? 'bookmark' : 'bed')}</span>${body}</button>`;
}

export function render(view, params, query) {
  const st = { ward: query.ward || '', status: '' };
  const draw = () => {
    const s = bedSummary(); const ip = ipSummary();
    const wards = store.all('wards').filter((w) => w.active);
    view.innerHTML = `
      <div class="page-head"><div><p class="muted">Live view of every bed. Click a bed for details and actions. Bed and nursing charges are worked out automatically from each patient's stay.</p></div>
        <div class="page-actions">${can('ip.admit') ? `<a class="btn btn-primary" href="#/ip/admit">${icon('hospital')}Admit patient</a>` : ''}</div></div>
      <div class="kpis">
        ${kpi({ label: 'Occupancy', value: s.pct + '%', iconName: 'activity', tone: s.pct > 85 ? 'danger' : 'teal', sub: `${s.occupied} of ${s.total} beds` })}
        ${kpi({ label: 'Available now', value: fmtNum(s.available), iconName: 'bed', tone: 'success', sub: `${s.cleaning} cleaning · ${s.reserved} reserved · ${s.blocked} blocked` })}
        ${kpi({ label: 'Admissions today', value: fmtNum(ip.admittedToday), iconName: 'log-in', tone: 'navy', sub: `${ip.dischargedToday} discharged today` })}
        ${kpi({ label: 'Discharges in progress', value: fmtNum(ip.discharging), iconName: 'log-out', tone: 'purple', href: '#/ip/admissions?tab=discharging' })}
        ${kpi({ label: 'Low deposit', value: fmtNum(ip.low), iconName: 'wallet', tone: ip.low ? 'danger' : 'success', sub: 'bill running ahead of deposit', href: '#/ip/admissions?tab=low' })}
      </div>
      <div class="row-between mt-2 mb-2"><div class="chip-row">${['', ...wards.map((w) => w.id)].map((id) => `<button class="chip ${st.ward === id ? 'active' : ''}" data-w="${id}">${id ? esc(ward(id).name) : 'All wards'}</button>`).join('')}</div>
        <div class="bed-legend">${LEG.map(([k, c]) => `<span><i style="background:${c}"></i>${esc(label(k))}</span>`).join('')}</div></div>
      ${wards.filter((w) => !st.ward || w.id === st.ward).map((w) => {
        const beds = store.all('beds').filter((b) => b.wardId === w.id && b.active);
        const occ = beds.filter((b) => bedStatus(b) === 'OCCUPIED').length; const cat = bedCategories()[w.category];
        return `<section class="card ward-block"><header class="ward-head"><div><h2>${icon(w.category === 'ICU' ? 'heart-pulse' : 'building')}${esc(w.name)}</h2><p class="muted small">${esc(w.floor)} · ${esc(categoryLabel(w.category))} · ${fmtINR(cat.rate, true)}/day + nursing ${fmtINR(cat.nursing, true)}/day</p></div>
          <div class="row"><span class="small muted">${occ}/${beds.length} occupied</span><div class="progress"><span style="width:${beds.length ? occ / beds.length * 100 : 0}%"></span></div></div></header>
          <div class="beds">${beds.map((b) => bedCard(b)).join('')}</div></section>`;
      }).join('')}`;
    view.querySelectorAll('[data-w]').forEach((c) => { c.onclick = () => { st.ward = c.dataset.w; draw(); }; });
    refreshIcons(view);
  };
  view.onclick = (e) => { const b = e.target.closest('[data-bed]'); if (b) bedPanel(b.dataset.bed, draw); };
  draw();
  const off = store.subscribe(debounce(draw, 300));
  return () => { off(); view.onclick = null; };
}

export function bedPanel(bedId, after) {
  const u = currentUser(); const b = getBed(bedId); const s = bedStatus(b); const adm = s === 'OCCUPIED' ? bedAdmission(bedId) : null;
  const w = ward(b.wardId); const cat = bedCategories()[b.category];
  let body; const footer = [];
  if (adm) {
    const p = patient(adm.patientId); const pos = ipPosition(adm);
    body = `${patientStrip(p)}<div class="grid grid-2 mt-2"><div>${[['IP number', `<a href="#/ip/admissions/${adm.id}" class="mono">${esc(adm.id)}</a>`], ['Consultant', esc(doctorName(adm.doctorId))], ['Admitted', `${relTime(adm.admittedAt)} · day ${daysAdmitted(adm)}`], ['Diagnosis', esc(adm.provisionalDiagnosis)], ['Status', cbadge(adm.status)]].map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`).join('')}</div>
      <div>${[['Payer', adm.payer.type === 'INSURANCE' ? `${esc(tpaName(adm.payer.tpaId))}` : esc(label(adm.payer.type))], ['Running bill', fmtINR(pos.net)], ['Paid so far', fmtINR(pos.paid)], ['Patient balance', `<strong class="${pos.balance > 0 ? 'text-danger' : 'text-success'}">${fmtINR(pos.balance)}</strong>`], ['Attender', `${esc(adm.attender.name)} (${esc(adm.attender.relation)})`]].map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`).join('')}</div></div>
      ${pos.low ? `<div class="alert alert-danger mt-1">${icon('wallet')}<div>The bill is ${fmtINR(pos.balance)} ahead of the deposit. Ask the attender for an additional deposit.</div></div>` : ''}`;
    footer.push({ label: 'Open folio', cls: 'btn-primary', icon: 'folder-heart', onClick: (c) => { c(); navigate('#/ip/admissions/' + adm.id); } });
    if (can('ip.transfer') && adm.status === 'ADMITTED') footer.unshift({ label: 'Transfer bed', icon: 'arrow-right-left', onClick: (c) => { c(); openTransfer(adm.id, after); } });
  } else {
    body = `<div class="kv"><span>Ward</span><span>${esc(w.name)} · ${esc(w.floor)}</span></div><div class="kv"><span>Category</span><span>${esc(cat.label)} · ${fmtINR(cat.rate, true)}/day + nursing ${fmtINR(cat.nursing, true)}</span></div>
      <div class="kv"><span>Status</span><span>${cbadge(s)}</span></div>${b.note ? `<div class="kv"><span>Note</span><span>${esc(b.note)}</span></div>` : ''}<div class="kv"><span>Last change</span><span>${relTime(b.updatedAt)} · ${esc(userName(b.updatedBy))}</span></div>`;
    const set = (state, needNote, title) => async (c) => {
      let note = '';
      if (needNote) { const r = await confirmDialog({ title, message: `Bed ${esc(b.code)}`, confirmLabel: title, reason: true, reasonLabel: state === 'RESERVED' ? 'Reserved for' : 'Reason' }); if (!r) return; note = r.reason; }
      try { setBedState(b.id, state, note, u); toast(`Bed ${b.code}: ${label(state === 'READY' ? 'AVAILABLE' : state)}.`, 'success'); c(); after?.(); } catch (e) { toast(e.message, 'error'); }
    };
    if (can('bed.manage')) {
      if (s === 'CLEANING') footer.push({ label: 'Mark ready', cls: 'btn-primary', icon: 'sparkles', onClick: set('READY') });
      if (s === 'BLOCKED' || s === 'RESERVED') footer.push({ label: s === 'BLOCKED' ? 'Unblock' : 'Release reservation', icon: 'unlock', onClick: set('READY') });
      if (s === 'AVAILABLE') { footer.push({ label: 'Block', icon: 'wrench', onClick: set('BLOCKED', true, 'Block bed') }); footer.push({ label: 'Reserve', icon: 'bookmark', onClick: set('RESERVED', true, 'Reserve bed') }); }
    }
    if (can('ip.admit') && (s === 'AVAILABLE' || s === 'RESERVED')) footer.push({ label: 'Admit here', cls: 'btn-primary', icon: 'hospital', onClick: (c) => { c(); navigate(`#/ip/admit?bed=${b.id}`); } });
  }
  openModal({ title: `Bed ${b.code}`, subtitle: `${esc(w.name)} · ${esc(cat.label)}`, size: adm ? 'lg' : 'md', body, footer: footer.length ? [{ label: 'Close', onClick: (c) => c() }, ...footer] : [{ label: 'Close', onClick: (c) => c() }] });
}

export function openTransfer(admId, after) {
  const u = currentUser();
  const adm = store.get('ipAdmissions', admId); const from = getBed(currentBedId(adm));
  let cat = from.category; let pick = null;
  const m = openModal({ title: 'Transfer bed', subtitle: `${esc(patient(adm.patientId).name)} · now in ${esc(from.code)} (${esc(categoryLabel(from.category))})`, size: 'lg',
    body: `<div class="seg" data-cats></div><div class="bed-pick mt-2" data-beds></div><div class="field mt-2"><label>Reason <span class="req">*</span></label><input class="input" data-reason placeholder="e.g. Stepped down from ICU, patient request for private room"></div>
      <p class="muted small mt-1">From today the bill uses the new bed's rate (each day is charged at the bed the patient is in at the end of the day). The old bed goes to Cleaning.</p>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Transfer', cls: 'btn-primary', icon: 'arrow-right-left', onClick: (c) => {
      if (!pick) return toast('Choose the new bed.', 'warning');
      try { transferBed(admId, pick, m.el.querySelector('[data-reason]').value, u); toast(`Moved to ${getBed(pick).code}.`, 'success'); c(); after?.(); } catch (e) { toast(e.message, 'error'); }
    } }] });
  const draw = () => {
    m.el.querySelector('[data-cats]').innerHTML = Object.entries(bedCategories()).map(([k, c]) => `<button type="button" class="seg-btn ${k === cat ? 'active' : ''}" data-c="${k}">${esc(c.label)} · ${fmtINR(c.rate, true)} (${availableBeds(k).length})</button>`).join('');
    const beds = store.all('beds').filter((b) => b.category === cat && b.active && ['AVAILABLE', 'RESERVED'].includes(bedStatus(b)));
    m.el.querySelector('[data-beds]').innerHTML = beds.length ? `<div class="beds">${beds.map((b) => bedCard(b, { selectable: true, selected: b.id === pick })).join('')}</div>` : '<p class="muted">No free bed in this category.</p>';
    m.el.querySelectorAll('[data-c]').forEach((x) => { x.onclick = () => { cat = x.dataset.c; pick = null; draw(); }; });
    m.el.querySelectorAll('[data-bed]').forEach((x) => { x.onclick = () => { pick = x.dataset.bed; draw(); }; });
    refreshIcons(m.el);
  };
  draw();
}
