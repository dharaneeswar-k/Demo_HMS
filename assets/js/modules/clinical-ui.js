// Shared UI pieces for the OP / IP screens: patient search, patient strip, payment panel, vitals chips, print header.
import { store } from '../data-service.js';
import { can } from '../auth.js';
import { patientAge } from '../patients.js';
import { modeLabel, payModes, cs } from '../clinical.js';
import { vitalFlags } from '../clinical-rules.js';
import { openPatientForm } from './patients.js';
import { esc, icon, fmtINR, refreshIcons, debounce, avatarTone } from '../utils.js';
import { r2 } from '../pricing.js';

export const money = (v) => fmtINR(v);
export const ageSex = (p) => `${patientAge(p) ?? '—'} y · ${{ M: 'Male', F: 'Female', O: 'Other' }[p.gender] || p.gender}`;

/** Patient search box: name, Patient ID, mobile or a scanned patient card (exact Patient ID + Enter). */
export function patientSearch(host, { onPick, placeholder = 'Search name, Patient ID or mobile — or scan the patient card', allowRegister = can('patient.register'), filter } = {}) {
  host.innerHTML = `<div class="ps"><div class="input-icon">${icon('search')}<input class="input input-lg" data-ps autocomplete="off" placeholder="${esc(placeholder)}"></div><div class="ps-list hidden" data-pl></div></div>`;
  const input = host.querySelector('[data-ps]'); const list = host.querySelector('[data-pl]');
  let rows = []; let active = 0;
  const find = (q) => {
    q = q.trim().toLowerCase(); if (q.length < 2) return [];
    const digits = q.replace(/\D/g, '');
    return store.all('patients').filter((p) => p.active !== false && (!filter || filter(p)) && (p.name.toLowerCase().includes(q) || p.uhid.toLowerCase().includes(q) || (digits.length >= 4 && p.phone.replace(/\D/g, '').includes(digits)))).slice(0, 8);
  };
  const draw = () => {
    const q = input.value;
    list.innerHTML = rows.map((p, i) => `<button type="button" class="ps-item ${i === active ? 'active' : ''}" data-i="${i}"><span class="avatar ${avatarTone(p.name)}">${esc(p.name.split(' ').map((x) => x[0]).slice(0, 2).join(''))}</span>
      <span class="grow"><strong>${esc(p.name)}</strong><small>${esc(p.uhid)} · ${esc(ageSex(p))} · ${esc(p.phone)}</small></span>${p.allergies ? `<span class="tag tag-danger">Allergy</span>` : ''}</button>`).join('')
      + (q.trim().length >= 2 && !rows.length ? `<div class="ps-empty">${icon('user-x')}No patient found for “${esc(q)}”.</div>` : '')
      + (allowRegister && q.trim().length >= 2 ? `<button type="button" class="ps-item ps-new" data-new>${icon('user-plus')}<span class="grow"><strong>Register a new patient</strong><small>Creates a Patient ID, then continues here</small></span></button>` : '');
    list.classList.toggle('hidden', q.trim().length < 2);
    refreshIcons(list);
  };
  const choose = (p) => { list.classList.add('hidden'); input.value = ''; onPick(p); };
  input.addEventListener('input', debounce(() => { rows = find(input.value); active = 0; draw(); }, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(rows.length - 1, active + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const exact = store.all('patients').find((p) => p.uhid.toLowerCase() === input.value.trim().toLowerCase());
      if (exact) return choose(exact);
      rows = find(input.value); if (rows[active]) choose(rows[active]);
    }
    if (e.key === 'Escape') list.classList.add('hidden');
  });
  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const b = e.target.closest('[data-i]'); if (b) return choose(rows[+b.dataset.i]);
    if (e.target.closest('[data-new]')) {
      const q = input.value.trim(); list.classList.add('hidden');
      openPatientForm({ prefill: /^\d+$/.test(q.replace(/\s/g, '')) ? { phone: q.replace(/\D/g, '').slice(-10) } : { name: q }, onSaved: (p) => choose(p) });
    }
  });
  input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
  return { focus: () => input.focus() };
}

/** Compact identity strip used at the top of visit / admission screens. */
export function patientStrip(p, { extra = '', dark = false } = {}) {
  return `<div class="pstrip ${dark ? 'pstrip-dark' : ''}"><span class="avatar avatar-lg ${avatarTone(p.name)}">${esc(p.name.split(' ').map((x) => x[0]).slice(0, 2).join(''))}</span>
    <div class="grow"><div class="pstrip-name">${esc(p.name)} <span class="pstrip-meta">${esc(ageSex(p))}</span></div>
    <div class="pstrip-sub"><span class="mono">${esc(p.uhid)}</span> · ${esc(p.phone)}${p.bloodGroup ? ` · Blood ${esc(p.bloodGroup)}` : ''}${p.guardianName ? ` · ${esc(p.guardianName)}` : ''}</div></div>
    ${p.allergies ? `<span class="allergy">${icon('alert-triangle')}Allergy: ${esc(p.allergies)}</span>` : `<span class="pill-soft">${icon('shield-check')}No known allergy</span>`}${extra}</div>`;
}

const VLABELS = [['bp', 'BP', 'mmHg'], ['pulse', 'Pulse', '/min'], ['temp', 'Temp', '°F'], ['spo2', 'SpO₂', '%'], ['rr', 'RR', '/min'], ['weight', 'Wt', 'kg'], ['height', 'Ht', 'cm'], ['bmi', 'BMI', ''], ['grbs', 'GRBS', 'mg/dL']];
export function vitalsChips(v, { compact = false } = {}) {
  if (!v) return '<span class="muted small">Vitals not recorded</span>';
  const f = vitalFlags(v);
  return `<div class="vchips ${compact ? 'compact' : ''}">${VLABELS.filter(([k]) => v[k] != null && v[k] !== '').map(([k, l, u]) => `<span class="vchip ${f[k] ? 'flag' : ''}" title="${f[k] ? esc(f[k]) : ''}"><small>${l}</small><strong>${esc(v[k])}</strong>${u && !compact ? `<em>${u}</em>` : ''}${f[k] ? icon('alert-triangle') : ''}</span>`).join('')}</div>`;
}
export const vitalsForm = (v = {}) => `<div class="form-grid vitals-form">
  ${[['bp', 'BP (mmHg)', 'text', '120/80'], ['pulse', 'Pulse (/min)', 'number', '72'], ['temp', 'Temp (°F)', 'number', '98.6'], ['spo2', 'SpO₂ (%)', 'number', '98'], ['rr', 'Resp. rate (/min)', 'number', '16'],
    ['weight', 'Weight (kg)', 'number', ''], ['height', 'Height (cm)', 'number', ''], ['grbs', 'GRBS (mg/dL)', 'number', '']].map(([k, l, t, ph]) => `<div class="field col-3"><label>${l}</label><input class="input" name="${k}" type="${t}" step="any" inputmode="${t === 'number' ? 'decimal' : 'text'}" value="${esc(v[k] ?? '')}" placeholder="${ph}"></div>`).join('')}
  <div class="col-12" data-vflags></div></div>`;
export function wireVitalsForm(root) {
  const read = () => Object.fromEntries([...root.querySelectorAll('.vitals-form input')].map((i) => [i.name, i.value]));
  const upd = () => { const f = vitalFlags(read()); const h = root.querySelector('[data-vflags]'); const w = Number(read().weight); const ht = Number(read().height) / 100;
    h.innerHTML = `${w && ht ? `<span class="pill-soft">BMI ${Math.round(w / ht / ht * 10) / 10}</span> ` : ''}${Object.entries(f).map(([k, m]) => `<span class="tag tag-danger">${esc(k.toUpperCase())}: ${esc(m)}</span>`).join(' ')}`; };
  root.querySelectorAll('.vitals-form input').forEach((i) => i.addEventListener('input', upd));
  upd();
  return read;
}

/** Payment panel: mode, amount, cash tendered → change, UPI/card reference. Returns { get(), setAmount(n) }. */
export function payPanel(host, { amount = 0, label = 'Amount received', editable = true, refund = false } = {}) {
  const modes = refund ? ['CASH', 'UPI', 'CARD'] : payModes();
  let mode = modes[0];
  host.innerHTML = `<div class="paypanel">
    <div class="seg seg-full" data-modes>${modes.map((m) => `<button type="button" class="seg-btn ${m === mode ? 'active' : ''}" data-m="${m}">${icon({ CASH: 'banknote', UPI: 'smartphone', CARD: 'credit-card', OTHER: 'wallet' }[m] || 'wallet')}${esc(modeLabel(m).split(' (')[0])}</button>`).join('')}</div>
    <div class="form-grid mt-1"><div class="field col-6"><label>${esc(label)}</label><div class="input-prefix"><span>₹</span><input class="input" data-amt type="number" min="0" step="0.01" value="${amount}" ${editable ? '' : 'readonly'}></div></div>
      <div class="field col-6" data-cash><label>Cash given by patient</label><div class="input-prefix"><span>₹</span><input class="input" data-tend type="number" min="0" step="1" placeholder="${amount}"></div><div class="field-hint" data-change></div></div>
      <div class="field col-6 hidden" data-ref><label>${refund ? 'Reference (optional)' : 'Transaction reference'}</label><input class="input" data-refv placeholder="UPI / card reference"></div></div></div>`;
  const q = (s) => host.querySelector(s);
  const sync = () => {
    q('[data-cash]').classList.toggle('hidden', mode !== 'CASH' || refund); q('[data-ref]').classList.toggle('hidden', mode === 'CASH');
    const a = Number(q('[data-amt]').value) || 0; const t = Number(q('[data-tend]').value);
    q('[data-change]').innerHTML = mode === 'CASH' && t ? (t >= a ? `Return change: <strong>${fmtINR(r2(t - a))}</strong>` : `<span class="text-danger">Short by ${fmtINR(r2(a - t))}</span>`) : '';
  };
  host.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { mode = b.dataset.m; host.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('active', x === b)); sync(); }; });
  ['[data-amt]', '[data-tend]'].forEach((s) => q(s).addEventListener('input', sync));
  sync(); refreshIcons(host);
  return {
    get: () => ({ mode, amount: Number(q('[data-amt]').value) || 0, tendered: q('[data-tend]').value === '' ? null : Number(q('[data-tend]').value), reference: q('[data-refv]').value.trim() }),
    setAmount: (n) => { q('[data-amt]').value = n; q('[data-tend]').placeholder = n; sync(); }
  };
}

/** Printed document header (shares the pharmacy receipt look). */
export function docHead(title, sub = '') {
  const s = store.settings(); const rc = store.ph().receipt || {};
  return `<header class="rc-head"><div class="rc-brand">${s.logo ? `<img src="${esc(s.logo)}" alt="" style="max-height:44px">` : `<div class="rc-mark">${esc(s.hospitalName.slice(0, 1))}</div>`}
    <div><h2>${esc(s.hospitalName)}</h2><p>${esc(rc.address || s.city || '')}${rc.phone ? ' · ' + esc(rc.phone) : ''}</p>${sub ? `<p>${sub}</p>` : ''}</div></div><div class="rc-title">${esc(title)}</div></header>`;
}
export const docFoot = (note = cs().receiptFooter) => `<p class="rc-thanks">${esc(note)}</p><p class="rc-small">This is a computer-generated document.</p>`;
export const signLine = (labels) => `<div class="sign-row">${labels.map((l) => `<div class="sign"><span></span>${esc(l)}</div>`).join('')}</div>`;
export function printBar(view, extra = '') {
  const bar = `<div class="row mb-2 no-print print-bar"><button class="btn btn-primary" data-print>${icon('printer')}Print</button>${extra}</div>`;
  return bar;
}
export function wirePrint(view) { view.querySelector('[data-print]')?.addEventListener('click', () => window.print()); }

/** Small modal helper result: read a form's named fields. */
export const formData = (root) => Object.fromEntries([...root.querySelectorAll('[name]')].map((i) => [i.name, i.type === 'checkbox' ? i.checked : i.value]));
export const stepper = (steps, active) => `<div class="stepper">${steps.map((s, i) => `<div class="step ${i === active ? 'active' : i < active ? 'done' : ''}"><span class="step-num">${i < active ? icon('check') : i + 1}</span><span class="step-txt"><strong>${esc(s[0])}</strong><small>${esc(s[1])}</small></span></div>`).join('')}</div>`;
