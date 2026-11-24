// Pharmacy counter billing — fast bill creation with FEFO batch suggestion, live GST-inclusive pricing and split payments.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { PHARMACY, fefoBatches, batchBalance, batchStatus, medicineStock, stockStatus, daysUntil, isIssuable } from '../calculations.js';
import { completeBill, validateBillDraft, priceDraft, paymentPlan, discountLimit, verifyAuthorizer, effectiveDiscountPct, requestDiscount, cancelDiscountRequest } from '../pharmacy-services.js';
import { businessDate, closingFor, modeLabel, topSelling } from '../pharmacy-calc.js';
import { badge, combo, openModal, confirmDialog, emptyState } from '../components.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtINR, fmtNum, fmtDate, refreshIcons, debounce, relTime } from '../utils.js';
import { navigate } from '../router.js';
import { r2 } from '../pricing.js';
import { batchIdFromLabel } from '../barcode.js';
import { openPatientForm } from './patients.js';
import { patientAge } from '../patients.js';

const KEY = 'nallam_hms_bill_draft';
const blank = () => ({ saleType: 'PATIENT', patientId: '', patientName: '', uhid: '', phone: '', doctor: '', prescriptionRef: '', lines: [], billDiscountPct: 0, payMode: 'CASH', payments: [{ mode: 'CASH', amount: '', tendered: '', reference: '' }], authorizerId: null, remarks: '' });

export function render(view, params, query) {
  const user = currentUser();
  let d = (() => { try { return { ...blank(), ...JSON.parse(sessionStorage.getItem(KEY) || 'null') }; } catch { return blank(); } })();
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(d));
  const canBatch = can('pharmacy.batch.override');
  const ph = store.ph();
  const date = businessDate();
  const closed = closingFor(date, user.id);

  view.innerHTML = `
    ${closed ? `<div class="alert alert-danger mb-2">${icon('lock')}<div><strong>Your counter for ${fmtDate(date)} is closed</strong> (closing ${esc(closed.id)}). New bills cannot be created for this business day.</div></div>` : ''}
    <div class="row-between mb-2"><div class="bill-steps"><span><b>1</b>Customer</span>${icon('chevron-right')}<span><b>2</b>Add medicines</span>${icon('chevron-right')}<span><b>3</b>Take payment</span></div>
      <div class="row"><a class="btn btn-ghost btn-sm" href="#/pharmacy/bills">${icon('history')}Pharmacy bills</a><button class="btn btn-ghost btn-sm" data-clear>${icon('eraser')}Clear bill</button></div></div>
    <div class="bill-grid">
      <div class="bill-left">
        <section class="card"><header class="card-head"><h2><span class="step-dot">1</span> Customer</h2><div class="seg" data-types>${[['PATIENT', 'Registered patient', 'id-card'], ['WALKIN', 'Walk-in customer', 'footprints']].map(([t, l, ic]) => `<button class="seg-btn" data-type="${t}">${icon(ic)}${l}</button>`).join('')}</div></header>
          <div class="card-body"><div class="form-grid">
            <div class="field col-12" data-only="PATIENT"><label>Patient <span class="req">*</span></label><div data-pat></div></div>
            <div class="col-12" data-only="PATIENT" data-pcard></div>
            <div class="field col-7" data-only="WALKIN"><label>Customer name</label><input class="input" data-k="patientName" placeholder="Optional"></div>
            <div class="field col-5" data-only="WALKIN"><label>Mobile</label><input class="input" data-k="phone" placeholder="Optional"></div>
            <div class="col-12" data-allergy></div>
            <div class="col-12"><div class="rx-box"><div class="rx-head">${icon('file-text')}<strong>Prescription (Rx)</strong><button type="button" class="more-toggle" data-moredet>${icon('plus')}Add details</button></div>
              <div class="form-grid collapsible closed" data-det><div class="field col-7"><label>Prescribing doctor</label><input class="input" data-k="doctor" list="doc-list" placeholder="Doctor's name"><datalist id="doc-list">${(ph.doctors || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
              <div class="field col-5"><label>Prescription no.</label><input class="input" data-k="prescriptionRef" placeholder="e.g. RX-12345"></div></div></div></div>
          </div></div></section>
        <section class="card mt-2"><header class="card-head"><h2><span class="step-dot">2</span> Add medicines</h2><select class="input input-sm" style="width:auto" data-cat><option value="">All categories</option>${store.all('categories').map((c) => `<option>${esc(c)}</option>`).join('')}</select></header>
          <div class="card-body"><div class="input-icon">${icon('scan-barcode')}<input class="input" data-q placeholder="Scan barcode or type medicine name, then press Enter" autocomplete="off" style="height:42px"></div>
          <div class="med-results mt-2" data-results></div></div></section>
      </div>
      <div class="bill-right">
        <section class="card"><header class="card-head"><h2>${icon('receipt')} Bill</h2><span class="muted small" data-count></span></header><div data-lines></div>
          <div class="bill-totals" data-totals></div></section>
        <section class="card mt-2"><header class="card-head"><h2><span class="step-dot">3</span> Payment</h2><div class="seg" data-modes></div></header><div class="card-body" data-pay></div></section>
        <div class="bill-actions"><div data-msgs class="grow"></div><button class="btn btn-primary btn-lg" data-complete ${closed ? 'disabled' : ''}>${icon('check-circle-2')}Complete Bill</button></div>
      </div>
    </div>`;

  const $ = (s) => view.querySelector(s);
  // ---------------- patient ----------------
  const choosePatient = (p) => { Object.assign(d, { saleType: 'PATIENT', patientId: p.id, patientName: p.name, uhid: p.uhid, phone: p.phone }); pat.set(p.id); fillPatient(); save(); drawPay(); drawMsgs(); };
  const pat = combo($('[data-pat]'), { options: () => store.all('patients').filter((p) => p.active !== false).map((p) => ({ value: p.id, label: p.name, sub: `${p.uhid} · ${p.gender}/${patientAge(p) ?? '—'} · ${p.phone}${p.allergies ? ' · Allergy: ' + p.allergies : ''}`, keywords: p.uhid + ' ' + p.phone.replace(/\D/g, '') })), value: d.patientId, placeholder: 'Search by name, Patient ID or mobile…',
    footer: can('patient.register') ? { html: `${icon('user-plus')} Register new patient`, onClick: () => openPatientForm({ onSaved: choosePatient }) } : null,
    onChange: (v) => choosePatient(store.get('patients', v)) });
  const toggleDet = (open) => { view.querySelectorAll('[data-det]').forEach((x) => x.classList.toggle('closed', !open)); $('[data-moredet]').classList.toggle('hidden', open); };
  if (!['PATIENT', 'WALKIN'].includes(d.saleType)) d.saleType = d.patientId ? 'PATIENT' : 'WALKIN';
  $('[data-moredet]').onclick = () => toggleDet(true);
  function fillPatient() {
    view.querySelectorAll('[data-k]').forEach((i) => { i.value = d[i.dataset.k] || ''; });
    if (d.doctor || d.prescriptionRef) toggleDet(true);
    const pp = d.patientId && store.get('patients', d.patientId);
    $('[data-allergy]').innerHTML = pp && pp.allergies ? `<div class="alert alert-danger">${icon('alert-triangle')}<div><strong>Allergy: ${esc(pp.allergies)}</strong> — check every medicine on this bill.</div></div>` : '';
    refreshIcons($('[data-allergy]'));
    view.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b.dataset.type === d.saleType));
    view.querySelectorAll('[data-only]').forEach((x) => x.classList.toggle('hidden', x.dataset.only !== d.saleType));
    $('[data-pcard]').innerHTML = pp ? `<div class="pat-chip">${icon('user-round')}<div class="grow"><strong>${esc(pp.name)}</strong><span class="mono">${esc(pp.uhid)}</span><span>${esc(pp.gender)}/${patientAge(pp) ?? '—'} · ${esc(pp.phone)}</span></div><a class="btn btn-ghost btn-sm" href="#/patients/${pp.id}" target="_blank">${icon('external-link')}Profile</a></div>` : '';
    refreshIcons($('[data-pcard]'));
  }
  view.querySelectorAll('[data-k]').forEach((i) => i.addEventListener('input', () => { d[i.dataset.k] = i.value; save(); drawMsgs(); }));
  view.querySelectorAll('[data-type]').forEach((b) => { b.onclick = () => { if (d.saleType === b.dataset.type) return; d.saleType = b.dataset.type; Object.assign(d, { patientId: '', patientName: '', uhid: '', phone: '' }); if (d.payMode === 'CREDIT' && d.saleType === 'WALKIN') d.payMode = 'CASH'; pat.set(''); fillPatient(); save(); drawPay(); drawMsgs(); }; });

  // ---------------- search ----------------
  const qEl = $('[data-q]'); const catEl = $('[data-cat]');
  const inDraft = (batchId) => d.lines.filter((l) => l.batchId === batchId).reduce((s, l) => s + Number(l.qty || 0), 0);
  const freeInBatch = (b) => batchBalance(b.id, PHARMACY()) - inDraft(b.id);
  const freeForMed = (mid) => fefoBatches(mid).reduce((s, b) => s + Math.max(0, freeInBatch(b)), 0);
  let results = [];
  function drawResults() {
    const q = qEl.value.trim().toLowerCase(); const cat = catEl.value;
    let meds = store.all('medicines').filter((m) => m.active && (!cat || m.category === cat));
    if (q) meds = meds.filter((m) => [m.brandName, m.genericName, m.code, m.composition, m.barcode].join(' ').toLowerCase().includes(q)).sort((a, b) => (b.brandName.toLowerCase().startsWith(q) ? 1 : 0) - (a.brandName.toLowerCase().startsWith(q) ? 1 : 0));
    else meds = topSelling(30, 8).map(([id]) => store.get('medicines', id)).filter((m) => m && (!cat || m.category === cat));
    results = meds.slice(0, 10);
    $('[data-results]').innerHTML = (!q ? '<div class="section-title">Frequently billed</div>' : '') + (results.length ? results.map((m, i) => {
      const s = medicineStock(m.id); const st = stockStatus(m, s.available); const fb = fefoBatches(m.id); const first = fb[0];
      const blocked = store.all('batches').filter((b) => b.medicineId === m.id && batchBalance(b.id, PHARMACY()) > 0 && !isIssuable(b)).length;
      const free = freeForMed(m.id);
      return `<div class="med-row ${i === 0 && q ? 'first' : ''} ${st === 'OUT_OF_STOCK' ? 'oos' : ''}" data-add="${m.id}">
        <div class="grow" style="min-width:0"><div class="row"><strong>${esc(m.brandName)}</strong><span class="muted small">${esc(m.strength)} · ${esc(m.form)}</span>${st !== 'IN_STOCK' ? badge(st) : ''}${first && daysUntil(first.expiryDate) <= store.settings().expiryThresholdDays ? '<span class="tag tag-warning">Near expiry</span>' : ''}</div>
          <div class="cell-sub">${esc(m.genericName)} · ${esc(m.code)} · ${esc(m.category)}</div>
          <div class="cell-sub">${first ? `Batch <span class="mono">${esc(first.batchNo)}</span> · Exp ${fmtDate(first.expiryDate)} · ${fb.length} eligible batch(es)` : '<span class="text-danger">No eligible batch</span>'}${blocked ? ` · <span class="text-danger">${blocked} blocked (expired/quarantined)</span>` : ''}</div></div>
        <div class="ta-right"><div class="strong">${first ? fmtINR(first.mrp) : '—'}</div><div class="cell-sub">MRP / ${esc(m.unit)}</div><div class="small ${free ? 'text-success' : 'text-danger'}">${fmtNum(free)} on shelf</div>${!free && s.store ? `<div class="cell-sub">${fmtNum(s.store)} in store</div>` : ''}</div>
        <button class="btn btn-sm ${free ? 'btn-primary' : 'btn-secondary'}" ${free ? '' : 'disabled'} title="${free ? 'Add to bill' : 'Out of stock'}">${icon(free ? 'plus' : 'ban')}</button></div>`;
    }).join('') : emptyState('search-x', 'No medicine found', 'Try the generic name or medicine code.'));
    refreshIcons($('[data-results]'));
  }
  qEl.addEventListener('input', debounce(drawResults, 100));
  catEl.onchange = drawResults;
  // Barcode scanners type the code and press Enter. A hospital batch sticker (NH…) adds that exact batch;
  // a manufacturer barcode adds the medicine using FEFO.
  qEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = qEl.value.trim();
    const bid = batchIdFromLabel(code);
    if (bid) { addBatch(bid); return; }
    const byCode = code && store.all('medicines').find((m) => m.barcode && m.barcode === code);
    if (byCode) { addMedicine(byCode.id); return; }
    if (results[0]) addMedicine(results[0].id);
    else if (code) toast(`No medicine found for "${code}".`, 'error', 'Not found');
  });
  $('[data-results]').addEventListener('click', (e) => { const r = e.target.closest('[data-add]'); if (r) addMedicine(r.dataset.add); });

  function addBatch(batchId) {
    const b = store.get('batches', batchId);
    if (!b) { toast('This label does not match any batch in stock.', 'error', 'Unknown label'); qEl.select(); return; }
    const m = store.get('medicines', b.medicineId);
    if (!isIssuable(b)) { toast(`${m.brandName} batch ${b.batchNo} is ${batchStatus(b).replace('_', ' ').toLowerCase()} and cannot be sold.`, 'error', 'Blocked batch'); qEl.select(); return; }
    if (freeInBatch(b) <= 0) { toast(`No more units of batch ${b.batchNo} available.`, 'error', 'Not available'); qEl.select(); return; }
    const line = d.lines.find((l) => l.batchId === b.id);
    if (line) line.qty = Number(line.qty) + 1; else d.lines.push({ medicineId: b.medicineId, batchId: b.id, qty: 1, discountPct: 0 });
    save(); drawLines(); qEl.value = ''; drawResults(); qEl.focus();
  }
  function addMedicine(mid, qty = 1) {
    const m = store.get('medicines', mid);
    if (!fefoBatches(mid).length || freeForMed(mid) <= 0) { const st = medicineStock(mid).store; toast(st ? `${m.brandName} is not on the pharmacy shelf. ${st} ${m.unit}(s) are in the central store — ask the Store to transfer.` : `${m.brandName} is out of stock${medicineStock(mid).pharmacy ? ' (all shelf units are already on this bill)' : ''}.`, 'error', 'Not available'); return; }
    let want = qty;
    for (const b of fefoBatches(mid)) {
      if (want <= 0) break;
      const free = freeInBatch(b); if (free <= 0) continue;
      const take = Math.min(free, want);
      const line = d.lines.find((l) => l.batchId === b.id);
      if (line) line.qty = Number(line.qty) + take; else d.lines.push({ medicineId: mid, batchId: b.id, qty: take, discountPct: 0 });
      want -= take;
    }
    save(); drawLines(); drawResults();
    qEl.value = ''; drawResults(); qEl.focus();
  }

  // ---------------- lines ----------------
  function batchOptions(l) {
    const all = store.all('batches').filter((b) => b.medicineId === l.medicineId && batchBalance(b.id, PHARMACY()) > 0).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    const fefo = fefoBatches(l.medicineId)[0];
    return all.map((b) => { const ok = isIssuable(b); const free = batchBalance(b.id, PHARMACY()) - inDraft(b.id) + (b.id === l.batchId ? Number(l.qty) : 0);
      return `<option value="${b.id}" ${b.id === l.batchId ? 'selected' : ''} ${ok && (free > 0 || b.id === l.batchId) ? '' : 'disabled'}>${esc(b.batchNo)} · exp ${fmtDate(b.expiryDate)} · ${ok ? free + ' free' : batchStatus(b).replace('_', ' ') + ' — blocked'}${b.id === fefo?.id ? ' · FEFO' : ''}</option>`; }).join('');
  }
  function drawLines() {
    const host = $('[data-lines]');
    $('[data-count]').textContent = d.lines.length ? `${d.lines.length} line(s)` : '';
    if (!d.lines.length) { host.innerHTML = emptyState('shopping-cart', 'No medicines on this bill', 'Search on the left and press Enter or click + to add.'); refreshIcons(host); drawTotals(); return; }
    const priced = priceDraft(d);
    host.innerHTML = `<div class="table-scroll"><table class="table dense bill-table"><thead><tr><th>#</th><th>Medicine & Batch</th><th class="ta-center">Qty</th><th class="ta-right">Unit Price</th><th class="ta-right">Disc %</th><th class="ta-right">GST</th><th class="ta-right">Line Total</th><th></th></tr></thead><tbody>
      ${d.lines.map((l, i) => {
        const m = store.get('medicines', l.medicineId); const b = store.get('batches', l.batchId); const p = priced.lines[i];
        const max = batchBalance(l.batchId, PHARMACY()) - inDraft(l.batchId) + Number(l.qty);
        const dte = daysUntil(b.expiryDate); const fefo = fefoBatches(l.medicineId)[0]?.id === b.id;
        return `<tr data-i="${i}"><td>${i + 1}</td>
          <td><div class="cell-main">${esc(m.brandName)} <span class="muted small">${esc(m.strength)}</span></div>
            ${canBatch ? `<select class="input input-sm mt-1" data-batch style="max-width:220px">${batchOptions(l)}</select>` : `<div class="cell-sub">Batch <span class="mono">${esc(b.batchNo)}</span> · Exp ${fmtDate(b.expiryDate)} ${fefo ? '<span class="tag tag-success">FEFO</span>' : ''} <button class="link small" data-alts>alternatives</button></div>`}
            ${dte <= store.settings().expiryThresholdDays ? `<div class="cell-sub text-warning">${icon('calendar-clock')} expires in ${dte} days</div>` : ''}</td>
          <td class="ta-center"><div class="qty-ctrl"><button class="btn btn-ghost btn-sm" data-dec>−</button><input class="input input-sm" type="number" min="1" step="1" data-qty value="${l.qty}"><button class="btn btn-ghost btn-sm" data-inc ${Number(l.qty) >= max ? 'disabled' : ''}>+</button></div><div class="cell-sub">${max} max · ${esc(m.unit)}</div></td>
          <td class="ta-right">${fmtINR(p.unitPrice)}</td>
          <td class="ta-right"><input class="input input-sm ta-right" style="width:64px" type="number" min="0" max="100" step="0.5" data-disc value="${l.discountPct || 0}"></td>
          <td class="ta-right">${p.gstPct}%<div class="cell-sub">${fmtINR(p.gstAmount)}</div></td>
          <td class="ta-right strong">${fmtINR(p.netAmount)}${p.itemDiscount + p.billDiscountShare ? `<div class="cell-sub">−${fmtINR(p.itemDiscount + p.billDiscountShare)}</div>` : ''}</td>
          <td><button class="btn btn-ghost btn-sm text-danger" data-rm title="Remove">${icon('x')}</button></td></tr>`;
      }).join('')}</tbody></table></div>`;
    refreshIcons(host); drawTotals();
  }
  $('[data-lines]').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]'); if (!tr) return; const i = +tr.dataset.i; const l = d.lines[i];
    if (e.target.closest('[data-rm]')) { d.lines.splice(i, 1); save(); drawLines(); drawResults(); }
    if (e.target.closest('[data-inc]')) setQty(i, Number(l.qty) + 1);
    if (e.target.closest('[data-dec]')) { if (Number(l.qty) <= 1) { d.lines.splice(i, 1); save(); drawLines(); drawResults(); } else setQty(i, Number(l.qty) - 1); }
    if (e.target.closest('[data-alts]')) showAlternatives(l.medicineId);
  });
  $('[data-lines]').addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-i]'); if (!tr) return; const i = +tr.dataset.i;
    if (e.target.matches('[data-qty]')) setQty(i, e.target.value);
    if (e.target.matches('[data-disc]')) { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); d.lines[i].discountPct = v; save(); drawLines(); }
    if (e.target.matches('[data-batch]')) { const l = d.lines[i]; const nb = e.target.value; const other = d.lines.findIndex((x, k) => k !== i && x.batchId === nb);
      if (other >= 0) { d.lines[other].qty = Number(d.lines[other].qty) + Number(l.qty); d.lines.splice(i, 1); } else l.batchId = nb;
      if (other < 0 && Number(l.qty) > batchBalance(nb, PHARMACY())) { l.qty = batchBalance(nb, PHARMACY()); toast(`Quantity reduced to ${l.qty} — the selected batch has no more stock.`, 'warning'); }
      save(); drawLines(); }
  });
  /** Quantity above the selected batch spills into the next FEFO batch; above total availability it is capped. */
  function setQty(i, v) {
    const l = d.lines[i]; let q = Math.floor(Number(v)); const m = store.get('medicines', l.medicineId);
    if (!(q > 0)) { toast('Quantity must be at least 1.', 'error'); drawLines(); return; }
    const batchMax = batchBalance(l.batchId, PHARMACY()) - inDraft(l.batchId) + Number(l.qty);
    if (q <= batchMax) { l.qty = q; save(); drawLines(); drawResults(); return; }
    const extra = q - batchMax; const freeElsewhere = freeForMed(l.medicineId) - Math.max(0, batchBalance(l.batchId, PHARMACY()) - inDraft(l.batchId));
    l.qty = batchMax;
    if (freeElsewhere <= 0) { toast(`Only ${batchMax} ${m.unit}(s) of ${m.brandName} available. Quantity capped.`, 'error', 'Insufficient stock'); save(); drawLines(); return; }
    const add = Math.min(extra, freeElsewhere); save(); addMedicineSilently(l.medicineId, add);
    if (add < extra) toast(`Only ${batchMax + add} ${m.unit}(s) of ${m.brandName} available. Quantity capped.`, 'error', 'Insufficient stock');
    else toast(`${add} more taken from the next FEFO batch.`, 'info');
  }
  function addMedicineSilently(mid, qty) {
    let want = qty;
    for (const b of fefoBatches(mid)) { if (want <= 0) break; const free = freeInBatch(b); if (free <= 0) continue; const t = Math.min(free, want); const line = d.lines.find((x) => x.batchId === b.id); if (line) line.qty = Number(line.qty) + t; else d.lines.push({ medicineId: mid, batchId: b.id, qty: t, discountPct: 0 }); want -= t; }
    save(); drawLines(); drawResults();
  }
  function showAlternatives(mid) {
    const all = store.all('batches').filter((b) => b.medicineId === mid && batchBalance(b.id, PHARMACY()) > 0).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    openModal({ title: `Batches — ${store.get('medicines', mid).brandName}`, subtitle: 'FEFO order. Only a Pharmacy Manager can override the suggested batch.', size: 'md',
      body: all.map((b, i) => `<div class="fefo-pick ${isIssuable(b) ? (i === 0 ? 'first' : '') : 'blocked'} mb-2"><div><span class="mono strong">${esc(b.batchNo)}</span> ${badge(batchStatus(b))}<div class="cell-sub">Exp ${fmtDate(b.expiryDate)} · MRP ${fmtINR(b.mrp)}${isIssuable(b) ? '' : ' · cannot be dispensed'}</div></div><span class="qty-pill">${batchBalance(b.id, PHARMACY())}<small>on hand</small></span></div>`).join(''),
      footer: [{ label: 'Close', cls: 'btn-primary', onClick: (c) => c() }] });
  }

  // ---------------- totals & discount ----------------
  function drawTotals() {
    const host = $('[data-totals]');
    if (!d.lines.length) { host.innerHTML = ''; drawPay(); return; }
    const t = priceDraft(d).totals; const eff = effectiveDiscountPct(t); const lim = discountLimit(user);
    const auth = d.authorizerId && store.get('users', d.authorizerId);
    const req = d.discountRequestId && store.get('discountRequests', d.discountRequestId);
    const needAuth = eff > lim + 0.001 && !(auth && discountLimit(auth) >= eff);
    host.innerHTML = `<div class="bt-grid"><div>
        <div class="row"><label class="small strong">Bill discount %</label><input class="input input-sm" style="width:80px" type="number" min="0" max="100" step="0.5" data-bdisc value="${d.billDiscountPct || 0}"><span class="muted small">${lim >= 100 ? 'Owner — no limit' : `Limit ${lim}% · above needs owner approval`}</span></div>
        ${needAuth && req && req.status === 'PENDING' ? `<div class="alert alert-info mt-1"><span class="spinner spinner-dark" style="width:14px;height:14px"></span><div><strong>Waiting for owner approval</strong> — ${req.requestedPct}% requested ${relTime(req.requestedAt)} (${req.id}). This bill is on hold. <button class="link" data-withdraw>Withdraw request</button></div></div>`
          : needAuth && req && req.status === 'APPROVED' && req.requestedPct + 0.001 >= eff ? `<div class="alert alert-success mt-1">${icon('shield-check')}<div><strong>Approved by ${esc(store.get('users', req.decidedBy)?.name || 'owner')}</strong> — ${req.requestedPct}% discount. You can complete the bill.${req.decisionNote ? ` <span class="muted">“${esc(req.decisionNote)}”</span>` : ''}</div></div>`
          : needAuth && req && req.status === 'REJECTED' ? `<div class="alert alert-danger mt-1">${icon('x-circle')}<div><strong>Owner rejected the ${req.requestedPct}% discount.</strong> ${esc(req.decisionNote || '')} Reduce the discount to ${lim}% or less. <button class="link" data-clearreq>OK</button></div></div>`
          : needAuth ? `<div class="alert alert-warning mt-1">${icon('shield-alert')}<div>Discount ${eff}% is above the ${lim}% limit — the owner must approve it.<div class="row mt-1"><button class="btn btn-primary btn-sm" data-request>${icon('send')}Request owner approval</button><button class="link small" data-auth>Owner is at the counter?</button></div></div></div>` : auth && eff > lim ? `<div class="alert alert-teal mt-1">${icon('shield-check')}<div>Discount ${eff}% approved by <strong>${esc(auth.name)}</strong> (Owner) <button class="link small" data-unauth>remove</button></div></div>` : ''}
      </div><div class="bt-sum">
        <div class="kv"><span>Subtotal (MRP)</span><span>${fmtINR(t.gross)}</span></div>
        ${t.itemDiscount ? `<div class="kv"><span>Item discounts</span><span>− ${fmtINR(t.itemDiscount)}</span></div>` : ''}
        ${t.billDiscount ? `<div class="kv"><span>Bill discount (${d.billDiscountPct}%)</span><span>− ${fmtINR(t.billDiscount)}</span></div>` : ''}
        <div class="kv"><span>Taxable value</span><span>${fmtINR(t.taxable)}</span></div>
        <div class="kv"><span>GST (included)</span><span>${fmtINR(t.gst)}</span></div>
        ${t.roundOff ? `<div class="kv"><span>Round off</span><span>${t.roundOff > 0 ? '+' : '−'} ${fmtINR(Math.abs(t.roundOff))}</span></div>` : ''}
        <div class="kv bt-grand"><span>Grand Total</span><span>${fmtINR(t.grandTotal)}</span></div></div></div>`;
    refreshIcons(host);
    host.querySelector('[data-bdisc]').onchange = (e) => { d.billDiscountPct = Math.max(0, Math.min(100, Number(e.target.value) || 0)); save(); drawLines(); };
    host.querySelector('[data-auth]')?.addEventListener('click', () => authorise(eff));
    host.querySelector('[data-request]')?.addEventListener('click', async () => {
      const r = await confirmDialog({ title: `Request ${eff}% discount`, iconName: 'send', confirmLabel: 'Send to owner', reason: true, reasonLabel: 'Reason for discount', reasonPlaceholder: 'e.g. Senior citizen on long-term medicines',
        message: `${fmtINR(t.discountTotal)} off ${fmtINR(t.gross)}. The owner will be notified and can approve or reject from anywhere. The bill stays on hold until then.` });
      if (!r) return;
      try { const rq = requestDiscount(d, r.reason, user); d.discountRequestId = rq.id; save(); toast('Request sent to the owner.', 'info', 'Discount approval'); drawTotals(); } catch (e) { toast(e.message, 'error'); }
    });
    host.querySelector('[data-withdraw]')?.addEventListener('click', () => { cancelDiscountRequest(d.discountRequestId, user); d.discountRequestId = null; save(); drawTotals(); });
    host.querySelector('[data-clearreq]')?.addEventListener('click', () => { d.discountRequestId = null; save(); drawTotals(); });
    host.querySelector('[data-unauth]')?.addEventListener('click', () => { d.authorizerId = null; save(); drawTotals(); });
    drawPay();
  }
  function authorise(eff) {
    openModal({ title: 'Owner approval needed', subtitle: `A discount of ${eff}% is above the ${discountLimit(user)}% limit. Only the Hospital Owner can approve it.`, size: 'sm',
      body: `<div class="form-grid"><div class="field col-12"><label>Owner username</label><input class="input" data-u autocomplete="off"></div><div class="field col-12"><label>Password</label><input class="input" type="password" data-p autocomplete="off"></div>
        <div class="col-12 ai-note">${icon('info')}<span>The owner enters their own login on this counter. Every approved discount above the limit is recorded and shown to the owner.</span></div></div>`,
      footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Approve discount', cls: 'btn-primary', onClick: (close, w) => {
        try { const a = verifyAuthorizer(w.querySelector('[data-u]').value, w.querySelector('[data-p]').value, eff); d.authorizerId = a.id; save(); close(); drawTotals(); toast(`Discount approved by ${a.name}.`); } catch (e) { toast(e.message, 'error'); }
      } }] });
  }

  // ---------------- payment ----------------
  const MODES = [...ph.paymentModes.filter((m) => m.active).map((m) => m.code), 'SPLIT', ...(ph.allowCredit ? ['CREDIT'] : [])];
  const MAIN_MODES = ['CASH', 'UPI', 'CARD', 'SPLIT'];
  let showAllModes = false;
  function grand() { return d.lines.length ? priceDraft(d).totals.grandTotal : 0; }
  function syncSingle() {
    const T = grand();
    if (['CASH', 'UPI', 'CARD', 'OTHER'].includes(d.payMode)) {
      const p = d.payments[0] && d.payments.length === 1 && d.payments[0].mode === d.payMode ? d.payments[0] : { mode: d.payMode, amount: '', tendered: '', reference: '' };
      p.amount = T; if (d.payMode === 'CASH' && (p.tendered === '' || Number(p.tendered) < T)) p.tendered = p.tendered === '' ? '' : p.tendered;
      d.payments = [p];
    }
  }
  function drawPay() {
    const avail = MODES.filter((m) => m !== 'CREDIT' || d.saleType === 'PATIENT');
    const shown = avail.filter((m) => showAllModes || MAIN_MODES.includes(m) || m === d.payMode);
    $('[data-modes]').innerHTML = shown.map((m) => `<button class="seg-btn ${d.payMode === m ? 'active' : ''}" data-mode="${m}">${m === 'SPLIT' ? 'Split' : m === 'CREDIT' ? 'Credit / Pending' : esc(modeLabel(m).split(' (')[0])}</button>`).join('') + (shown.length < avail.length ? `<button class="seg-btn" data-moremodes>More…</button>` : '');
    syncSingle();
    const T = grand(); const host = $('[data-pay]');
    const plan = paymentPlan({ ...d, authorizer: null }, T);
    const cash = d.payments.find((p) => p.mode === 'CASH');
    let body = '';
    if (d.payMode === 'CASH') body = `<div class="form-grid"><div class="field col-4"><label>Amount due</label><input class="input strong" value="${fmtINR(T)}" readonly></div>
      <div class="field col-4"><label>Cash tendered</label><input class="input" type="number" min="0" step="1" data-tend value="${cash?.tendered ?? ''}" placeholder="${T}"></div>
      <div class="field col-4"><label>Change to return</label><input class="input strong" value="${fmtINR(Math.max(0, (Number(cash?.tendered) || T) - T))}" readonly data-change></div>
      <div class="col-12 row">${[T, Math.ceil(T / 50) * 50, Math.ceil(T / 100) * 100, Math.ceil(T / 500) * 500].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => `<button class="chip" data-quick="${v}">₹${fmtNum(v)}</button>`).join('')}</div></div>`;
    else if (['UPI', 'CARD', 'OTHER'].includes(d.payMode)) body = `<div class="form-grid"><div class="field col-4"><label>Amount</label><input class="input strong" value="${fmtINR(T)}" readonly></div>
      <div class="field col-8"><label>${d.payMode === 'UPI' ? 'UPI transaction ID / UTR' : d.payMode === 'CARD' ? 'Card last 4 digits / approval code' : 'Reference (TPA, cheque, wallet)'}</label><input class="input" data-ref value="${esc(d.payments[0]?.reference || '')}" placeholder="${d.payMode === 'UPI' ? 'e.g. 4321 0987 6543' : d.payMode === 'CARD' ? 'e.g. XXXX-4821' : 'Reference'}"></div></div>`;
    else body = `<div class="split-rows">${d.payments.map((p, i) => `<div class="row mb-2" data-pi="${i}"><select class="input" style="width:150px" data-pmode>${ph.paymentModes.filter((m) => m.active).map((m) => `<option value="${m.code}" ${p.mode === m.code ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
        <input class="input" style="width:130px" type="number" min="0" step="0.01" data-pamt value="${p.amount}" placeholder="Amount"><input class="input grow" data-pref value="${esc(p.reference || '')}" placeholder="${p.mode === 'CASH' ? 'Cash' : 'Reference'}" ${p.mode === 'CASH' ? 'disabled' : ''}>
        <button class="btn btn-ghost btn-sm" data-prm ${d.payments.length < 2 && d.payMode === 'SPLIT' ? 'disabled' : ''}>${icon('x')}</button></div>`).join('')}
      <div class="row"><button class="btn btn-secondary btn-sm" data-padd>${icon('plus')}Add payment</button>${d.payMode === 'SPLIT' && plan.due > 0 ? `<button class="btn btn-ghost btn-sm" data-fill>Fill remaining ${fmtINR(plan.due)}</button>` : ''}</div></div>
      ${d.payMode === 'CREDIT' ? `<div class="ai-note mt-1">${icon('info')}<span>Credit is given only to registered patients; the balance stays on their Patient ID until it is collected. Enter any part payment received now (or none).</span></div>` : ''}`;
    const status = !T ? '—' : plan.due <= 0.005 ? 'PAID' : plan.applied > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
    host.innerHTML = body + `<div class="pay-summary"><div><span>Bill total</span><strong>${fmtINR(T)}</strong></div><div><span>Amount received</span><strong>${fmtINR(plan.applied + plan.change)}</strong></div>
      <div><span>${plan.change > 0 ? 'Change due' : 'Balance due'}</span><strong class="${plan.due > 0.005 ? 'text-danger' : ''}">${fmtINR(plan.change > 0 ? plan.change : Math.max(0, plan.due))}</strong></div><div><span>Payment status</span>${T ? badge(status) : '—'}</div></div>`;
    refreshIcons(host);
    $('[data-modes] [data-moremodes]')?.addEventListener('click', () => { showAllModes = true; drawPay(); });
    view.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => {
      d.payMode = b.dataset.mode;
      if (d.payMode === 'SPLIT') d.payments = [{ mode: 'CASH', amount: '', tendered: '', reference: '' }, { mode: 'UPI', amount: '', reference: '' }];
      else if (d.payMode === 'CREDIT') d.payments = [{ mode: 'CASH', amount: '', tendered: '', reference: '' }];
      else d.payments = [{ mode: d.payMode, amount: '', tendered: '', reference: '' }];
      save(); drawPay(); drawMsgs();
    }; });
    host.querySelector('[data-tend]')?.addEventListener('input', (e) => { d.payments[0].tendered = e.target.value; save(); const ch = Math.max(0, (Number(e.target.value) || T) - T); host.querySelector('[data-change]').value = fmtINR(ch); drawMsgs(); });
    host.querySelectorAll('[data-quick]').forEach((b) => { b.onclick = () => { d.payments[0].tendered = b.dataset.quick; save(); drawPay(); drawMsgs(); }; });
    host.querySelector('[data-ref]')?.addEventListener('input', (e) => { d.payments[0].reference = e.target.value; save(); drawMsgs(); });
    host.querySelectorAll('[data-pi]').forEach((row) => { const i = +row.dataset.pi;
      row.querySelector('[data-pmode]').onchange = (e) => { d.payments[i].mode = e.target.value; save(); drawPay(); drawMsgs(); };
      row.querySelector('[data-pamt]').onchange = (e) => { d.payments[i].amount = e.target.value === '' ? '' : r2(e.target.value); if (d.payments[i].mode === 'CASH') d.payments[i].tendered = d.payments[i].amount; save(); drawPay(); drawMsgs(); };
      row.querySelector('[data-pref]').oninput = (e) => { d.payments[i].reference = e.target.value; save(); drawMsgs(); };
      row.querySelector('[data-prm]').onclick = () => { d.payments.splice(i, 1); save(); drawPay(); drawMsgs(); };
    });
    host.querySelector('[data-padd]')?.addEventListener('click', () => { const used = new Set(d.payments.map((p) => p.mode)); d.payments.push({ mode: ['UPI', 'CARD', 'CASH', 'OTHER'].find((m) => !used.has(m)) || 'UPI', amount: '', reference: '' }); save(); drawPay(); });
    host.querySelector('[data-fill]')?.addEventListener('click', () => { const p = d.payments.find((x) => !Number(x.amount)) || d.payments.at(-1); p.amount = r2(Number(p.amount || 0) + plan.due); if (p.mode === 'CASH') p.tendered = p.amount; save(); drawPay(); drawMsgs(); });
    drawMsgs();
  }
  function drawMsgs() {
    const host = $('[data-msgs]'); if (!d.lines.length) { host.innerHTML = ''; return; }
    const v = validateBillDraft({ ...d, authorizer: d.authorizerId ? store.get('users', d.authorizerId) : null }, user);
    host.innerHTML = v.errors.length ? `<div class="small text-danger">${icon('alert-circle')} ${esc(v.errors[0])}${v.errors.length > 1 ? ` (+${v.errors.length - 1} more)` : ''}</div>` : v.warnings.length ? `<div class="small text-warning">${icon('alert-triangle')} ${esc(v.warnings[0])}</div>` : `<div class="small text-success">${icon('check')} Ready to complete</div>`;
    refreshIcons(host);
  }

  // ---------------- complete ----------------
  async function complete() {
    if (closed) return;
    const draft = { ...d, authorizer: d.authorizerId ? store.get('users', d.authorizerId) : null };
    const v = validateBillDraft(draft, user);
    if (v.errors.length) { toast(v.errors.join(' '), 'error', 'Bill cannot be completed'); return; }
    const t = v.priced.totals; const plan = paymentPlan(draft, t.grandTotal);
    const ok = await confirmDialog({ title: 'Complete bill?', iconName: 'receipt', confirmLabel: 'Complete Bill',
      message: `${d.saleType === 'WALKIN' ? `<strong>Walk-in customer</strong>${d.patientName ? ` · ${esc(d.patientName)}` : ''}` : `<strong>${esc(d.patientName)}</strong> · <span class="mono">${esc(d.uhid)}</span>`}<br>${v.priced.lines.length} line(s), ${fmtNum(t.qty)} unit(s) · Grand total <strong>${fmtINR(t.grandTotal)}</strong>
        <div class="mt-1">${draft.payments.filter((p) => Number(p.amount) > 0).map((p) => `${esc(modeLabel(p.mode))}: ${fmtINR(p.amount)}${p.reference ? ` <span class="muted small">(${esc(p.reference)})</span>` : ''}`).join('<br>') || '<span class="text-warning">No payment received</span>'}</div>
        ${plan.change > 0 ? `<div class="mt-1">Return change: <strong>${fmtINR(plan.change)}</strong></div>` : ''}${plan.due > 0.005 ? `<div class="mt-1 text-warning">Pending balance: <strong>${fmtINR(plan.due)}</strong></div>` : ''}
        ${v.warnings.length ? `<ul class="small text-warning">${v.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}<p class="small muted mt-1">Stock will be deducted from the selected batches only after the bill is saved.</p>` });
    if (!ok) return;
    try {
      const bill = completeBill(draft, user);
      sessionStorage.removeItem(KEY);
      toast(`${bill.id} completed — ${fmtINR(bill.grandTotal)}.`, 'success', 'Bill saved');
      navigate(`#/pharmacy/bills/${bill.id}/receipt?new=1`);
    } catch (e) { toast(e.message, 'error', 'Bill not saved — no stock was deducted'); drawLines(); drawResults(); }
  }
  $('[data-complete]').onclick = complete;
  const onKey = (e) => { if (e.key === 'F9') { e.preventDefault(); complete(); } };
  // refresh when the owner decides a discount request (from another device/tab)
  let lastReqStatus = d.discountRequestId && store.get('discountRequests', d.discountRequestId)?.status;
  const unsub = store.subscribe(() => { const st = d.discountRequestId && store.get('discountRequests', d.discountRequestId)?.status; if (st && st !== lastReqStatus) { lastReqStatus = st; drawLines(); if (st === 'APPROVED') toast('The owner approved the discount. You can complete the bill.', 'success', 'Discount approved'); if (st === 'REJECTED') toast('The owner rejected the discount request.', 'warning', 'Discount rejected'); } });
  document.addEventListener('keydown', onKey);
  $('[data-clear]').onclick = async () => { if (!d.lines.length || await confirmDialog({ title: 'Clear current bill?', message: 'All medicines and payment details on this unsaved bill will be removed.', confirmLabel: 'Clear', tone: 'danger', iconName: 'eraser' })) { d = blank(); save(); pat.set(''); fillPatient(); drawLines(); drawResults(); } };

  fillPatient(); drawResults(); drawLines();
  if (query.patient && store.get('patients', query.patient)) choosePatient(store.get('patients', query.patient));
  if (query.med) addMedicine(query.med);
  setTimeout(() => qEl.focus(), 50);
  return () => { document.removeEventListener('keydown', onKey); unsub(); };
}
