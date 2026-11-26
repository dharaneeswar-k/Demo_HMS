// Shared pieces for the Lab Stock (lab) and Lab Supplies (store) screens: item icon, stock level bar, state pill,
// lot / expiry text, the request card with its 3-step journey, and the item detail dialog.
import { store } from '../../data-service.js';
import { userName } from '../../calculations.js';
import { openModal, confirmDialog } from '../../components.js';
import { toast } from '../../notifications.js';
import { esc, fmtDate, fmtDateTime, relTime, refreshIcons } from '../../utils.js';
import { icon } from './bi.js';
import {
  KINDS, STORAGE, MOVE, REQ_STATUS, item, lot, labBalance, storeBalance, labState, storeState, lotsAt, isExpired, daysLeft, packsOf, unitTxt, packTxt, packInfo,
  openPacks, plural, testsUsing, dailyUse, daysOfStock, canRunLab, openPack, closePack, discardExpiredLot, recordLabUse, onTheWay, requestedUnits
} from '../../labstock.js';

export const kindIcon = (k, size = '') => `<span class="ls-kind ls-k-${KINDS[k.kind]?.tone || 'muted'} ${size}" title="${esc(KINDS[k.kind]?.one || '')}">${icon(KINDS[k.kind]?.icon || 'box')}</span>`;
export const STATE_TXT = { OUT: ['Out of stock', 'danger'], LOW: ['Running low', 'warning'], OK: ['In stock', 'success'] };
export const statePill = (st) => `<span class="ls-state ls-s-${STATE_TXT[st][1]}"><i></i>${STATE_TXT[st][0]}</span>`;
export const coldTag = (k) => (k.storage === 'COLD' ? `<span class="ls-cold" title="${STORAGE.COLD}">${icon('snowflake')}2–8 °C</span>` : k.storage === 'FROZEN' ? `<span class="ls-cold" title="${STORAGE.FROZEN}">${icon('snowflake')}−20 °C</span>` : '');

/** Big number + packs, e.g. "2 cards" / "≈ 0.1 box". */
export function qtyBlock(k, n) {
  return `<div class="ls-qty"><strong class="${n <= 0 ? 'zero' : ''}">${n}</strong><span>${esc(plural(k.unit, n))}</span>${k.packSize > 1 && n > 0 ? `<small>≈ ${packsOf(k, n)} ${esc(plural(k.packLabel, packsOf(k, n)))}</small>` : ''}</div>`;
}
/** Bar from 0 to the "keep" level, with a tick where we ask for more. */
export function levelBar(k, n, { min = k.reorderLevel, par = k.parLevel } = {}) {
  const top = Math.max(par, n, 1); const pct = Math.min(100, Math.max(0, n / top * 100)); const tick = Math.min(100, min / top * 100);
  const tone = n <= 0 ? 'danger' : n <= min ? 'warning' : 'success';
  return `<div class="ls-bar" title="${n} of ${par} to keep · ask for more at ${min}"><span class="ls-bar-fill ls-b-${tone}" style="width:${pct}%"></span><span class="ls-bar-tick" style="left:${tick}%"></span></div>`;
}
export function expiryTxt(l, { short = false } = {}) {
  if (!l?.expiry) return '<span class="muted">No expiry</span>';
  const d = daysLeft(l.expiry);
  const tone = d < 0 ? 'danger' : d <= 30 ? 'warning' : '';
  return `<span class="ls-exp ${tone}">${d < 0 ? icon('alert-octagon') : d <= 30 ? icon('calendar-clock') : ''}${d < 0 ? 'Expired' : short ? 'Exp' : 'Expires'} ${fmtDate(l.expiry)}${d >= 0 && d <= 60 ? ` · ${d} d` : ''}</span>`;
}
export const lotChip = (l) => (l ? `<span class="ls-lot mono">Lot ${esc(l.lot)}</span>` : '<span class="ls-lot muted">No lot</span>');

// ---------------- request card (used on both sides) ----------------
const STEP = (on, done, ic, label, sub) => `<li class="${done ? 'done' : ''} ${on ? 'on' : ''}"><span>${done ? icon('check') : icon(ic)}</span><div><b>${label}</b><small>${sub || ''}</small></div></li>`;
export function reqJourney(r) {
  const issued = !!r.issue; const recv = !!r.receive; const stopped = ['REJECTED', 'CANCELLED'].includes(r.status);
  return `<ol class="ls-journey ${stopped ? 'stopped' : ''}">
    ${STEP(false, true, 'send', 'Requested', `${esc(userName(r.by))} · ${fmtDateTime(r.at)}`)}
    ${stopped ? STEP(true, false, r.status === 'REJECTED' ? 'x-circle' : 'ban', r.status === 'REJECTED' ? 'Store could not issue' : 'Cancelled by lab', r.reject ? `${esc(userName(r.reject.by))} · ${esc(r.reject.reason)}` : r.cancelled ? fmtDateTime(r.cancelled.at) : '')
      : `${STEP(r.status === 'REQUESTED', issued, 'warehouse', 'Issued by store', issued ? `${esc(userName(r.issue.by))} · ${fmtDateTime(r.issue.at)}` : 'Waiting for the store')}
         ${STEP(r.status === 'ISSUED', recv, 'package-check', 'Received in lab', recv ? `${esc(userName(r.receive.by))} · ${fmtDateTime(r.receive.at)}` : issued ? 'Check the items and press Receive' : '')}`}
  </ol>`;
}
export const reqStatus = (r) => { const s = REQ_STATUS[r.status]; return `<span class="ls-state ls-s-${s.tone}"><i></i>${s.label}</span>`; };
/** Lines of a request: what was asked, what the store sent (lot, expiry), what arrived. */
export function reqLines(r) {
  return `<table class="table dense ls-reqtable"><thead><tr><th>Item</th><th class="ta-right">Asked</th><th>Sent by store</th><th class="ta-right">Received</th></tr></thead><tbody>
    ${r.lines.map((l) => { const k = item(l.kitId); const sent = r.issue?.lines.filter((x) => x.kitId === l.kitId) || []; const got = r.receive?.lines.filter((x) => x.kitId === l.kitId) || [];
      const sentN = sent.reduce((t, x) => t + x.qty, 0); const gotN = got.reduce((t, x) => t + x.qty, 0);
      return `<tr><td><div class="ls-cell">${kindIcon(k, 'sm')}<div><strong>${esc(k.name)}</strong><small class="muted">${esc(packInfo(k))}</small></div></div></td>
        <td class="ta-right"><strong>${packTxt(k, l.packs)}</strong><div class="muted small">${unitTxt(k, l.packs * k.packSize)}</div></td>
        <td>${r.issue ? (sent.length ? sent.map((x) => `<div class="small">${unitTxt(k, x.qty)} · ${lotChip(lot(x.lotId))} ${expiryTxt(lot(x.lotId), { short: true })}</div>`).join('') : '<span class="muted small">Not sent</span>') : '<span class="muted small">—</span>'}</td>
        <td class="ta-right">${r.receive ? `<strong class="${gotN < sentN ? 'text-danger' : 'text-success'}">${unitTxt(k, gotN)}</strong>${gotN < sentN ? `<div class="small text-danger">${sentN - gotN} short</div>` : ''}` : '<span class="muted small">—</span>'}</td></tr>`; }).join('')}
  </tbody></table>
  ${r.note ? `<p class="ls-note">${icon('message-square')}<span><b>Lab:</b> ${esc(r.note)}</span></p>` : ''}${r.issue?.note ? `<p class="ls-note">${icon('warehouse')}<span><b>Store:</b> ${esc(r.issue.note)}</span></p>` : ''}${r.receive?.note ? `<p class="ls-note danger">${icon('alert-triangle')}<span><b>On arrival:</b> ${esc(r.receive.note)}</span></p>` : ''}`;
}

// ---------------- item detail (lab view; the store sees store lots) ----------------
export function openItem(kitId, user, { side = 'LAB', onChange = () => {}, onRequest } = {}) {
  const k = item(kitId);
  const draw = (w) => {
    const bal = side === 'LAB' ? labBalance(k.id) : storeBalance(k.id); const st = side === 'LAB' ? labState(k) : storeState(k);
    const lots = lotsAt(k.id, side); const packs = side === 'LAB' ? openPacks(k.id) : [];
    const mv = store.all('kitMovements').filter((m) => m.kitId === k.id && (m.loc || 'LAB') === side).slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
    const tests = testsUsing(k.id); const run = canRunLab(user) && side === 'LAB'; const dos = daysOfStock(k);
    w.querySelector('.modal-body').innerHTML = `<div class="ls-item">
      <div class="ls-item-hero">${kindIcon(k, 'lg')}<div class="grow"><div class="ls-item-kind">${esc(KINDS[k.kind].one)} ${coldTag(k)}</div><h3>${esc(k.name)}</h3><p class="muted small">${esc(packInfo(k))} · ${esc(STORAGE[k.storage])}${k.openDays ? ` · usable ${k.openDays} days after opening` : ''}${k.supplier ? ` · ${esc(k.supplier)}` : ''}</p></div>
        <div class="ls-item-qty">${qtyBlock(k, bal)}${statePill(st)}</div></div>
      <div class="ls-facts">
        ${side === 'LAB' ? `<div><span>Ask for more at</span><b>${unitTxt(k, k.reorderLevel)}</b></div><div><span>Keep in lab</span><b>${unitTxt(k, k.parLevel)}</b></div><div><span>Used per day</span><b>${dailyUse(k.id) || '—'}</b></div><div><span>Lasts about</span><b>${dos == null ? '—' : dos + ' days'}</b></div>`
          : `<div><span>Order from supplier at</span><b>${unitTxt(k, k.storeMin)}</b></div><div><span>In lab</span><b>${unitTxt(k, labBalance(k.id))}</b></div><div><span>Asked by lab</span><b>${unitTxt(k, requestedUnits(k.id))}</b></div><div><span>On the way to lab</span><b>${unitTxt(k, onTheWay(k.id))}</b></div>`}
      </div>
      ${k.openDays && side === 'LAB' ? `<section class="ls-sec"><header><h4>${icon('package-open')}Open ${k.kind === 'CONTROL' ? 'vial' : 'pack'} on the bench</h4>${run ? `<button class="btn btn-secondary btn-sm" data-open>${icon('package-open')}Open a new ${k.kind === 'CONTROL' ? 'vial' : k.packLabel}</button>` : ''}</header>
        ${packs.length ? packs.map((p) => { const d = daysLeft(p.useBy); return `<div class="ls-pack ${d < 0 ? 'danger' : d <= 2 ? 'warning' : ''}"><div>${icon(d < 0 ? 'alert-octagon' : 'package-open')}<div><b>${lotChip(lot(p.lotId))} opened ${relTime(p.openedAt)}</b><small>by ${esc(userName(p.openedBy))} · ${fmtDateTime(p.openedAt)}</small></div></div>
          <div class="ls-pack-use"><b>${d < 0 ? 'Past its use-by — do not use' : `Use by ${fmtDate(p.useBy)}`}</b><small>${d < 0 ? fmtDate(p.useBy) : d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} left`}</small></div>${run ? `<button class="btn btn-ghost btn-sm" data-closepack="${p.id}">Finished</button>` : ''}</div>`; }).join('')
          : `<p class="muted small ls-empty-line">No ${k.kind === 'CONTROL' ? 'vial' : 'pack'} is open. When you load a new one on the analyser, press “Open a new ${k.kind === 'CONTROL' ? 'vial' : k.packLabel}” so the system knows its use-by date.</p>`}</section>` : ''}
      <section class="ls-sec"><header><h4>${icon('layers')}Lots ${side === 'LAB' ? 'in the lab' : 'in the store'}</h4><span class="muted small">Oldest expiry is used first</span></header>
        ${lots.length ? `<table class="table dense"><thead><tr><th>Lot</th><th>Expiry</th><th class="ta-right">Quantity</th><th></th></tr></thead><tbody>${lots.map((x, i) => `<tr class="${isExpired(x.lot) ? 'row-danger' : ''}"><td>${lotChip(x.lot)}${i === 0 && !isExpired(x.lot) ? ' <span class="ls-next">Use this first</span>' : ''}</td><td>${expiryTxt(x.lot)}</td><td class="ta-right"><b>${unitTxt(k, x.qty)}</b></td>
          <td class="ta-right">${run && isExpired(x.lot) ? `<button class="btn btn-danger btn-sm" data-discard="${x.lotId}">${icon('trash-2')}Discard</button>` : ''}</td></tr>`).join('')}</tbody></table>` : `<p class="muted small ls-empty-line">Nothing ${side === 'LAB' ? 'in the lab' : 'in the store'}.</p>`}</section>
      ${tests.length ? `<section class="ls-sec"><header><h4>${icon('list-checks')}Used by these tests</h4></header><div class="ls-tests">${tests.map((t) => `<span class="ls-test" title="${esc(t.name)}"><b>${esc(t.code)}</b>${t.lab.kits.find((x) => x.kitId === k.id).qty} ${esc(k.unit)}/test</span>`).join('')}</div></section>` : ''}
      <section class="ls-sec"><header><h4>${icon('history')}Recent movements</h4></header>
        ${mv.length ? `<ul class="ls-moves">${mv.map((m) => `<li><span class="ls-mv ${m.qty > 0 ? 'in' : 'out'}">${m.qty > 0 ? '+' : ''}${m.qty}</span><div><b>${esc(MOVE[m.type]?.label || m.type)}</b><small>${m.lotId ? lotChip(lot(m.lotId)) + ' · ' : ''}${esc(m.note || '')} ${m.ref ? `· <span class="mono">${esc(m.ref)}</span>` : ''}</small></div><time>${relTime(m.at)}<small>${esc(userName(m.by))}</small></time></li>`).join('')}</ul>` : '<p class="muted small ls-empty-line">No movements yet.</p>'}</section>
    </div>`;
    const re = () => { onChange(); draw(w); refreshIcons(w); };
    w.querySelector('[data-open]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: `Open a new ${k.kind === 'CONTROL' ? 'vial' : k.packLabel}?`, iconName: icon('package-open'), confirmLabel: 'Mark as opened', message: `The oldest-expiry lot in the lab is used. ${packs.length ? 'The pack open now is marked finished.' : ''} The use-by date is set to ${k.openDays} days from now (or the lot expiry, if sooner).` });
      if (!ok) return; try { openPack(k.id, user); toast(k.kind === 'CONTROL' ? 'Vial marked as opened — 1 vial used for QC.' : 'Pack marked as opened.'); re(); } catch (e) { toast(e.message, 'error'); }
    });
    w.querySelectorAll('[data-closepack]').forEach((b) => { b.onclick = () => { try { closePack(b.dataset.closepack, 'Finished', user); toast('Marked finished.'); re(); } catch (e) { toast(e.message, 'error'); } }; });
    w.querySelectorAll('[data-discard]').forEach((b) => { b.onclick = async () => {
      const x = lots.find((y) => y.lotId === b.dataset.discard);
      const ok = await confirmDialog({ title: 'Discard expired stock?', tone: 'danger', iconName: icon('trash-2'), confirmLabel: `Discard ${unitTxt(k, x.qty)}`, message: `Lot <b>${esc(x.lot.lot)}</b> expired on ${fmtDate(x.lot.expiry)}. Its ${unitTxt(k, x.qty)} will be written off as expired.` });
      if (!ok) return; try { discardExpiredLot(k.id, x.lotId, user); toast('Expired stock written off.'); re(); } catch (e) { toast(e.message, 'error'); }
    }; });
  };
  const run = canRunLab(user) && side === 'LAB';
  const m = openModal({ title: k.name, size: 'lg', body: '<div></div>',
    footer: [...(run ? [{ label: 'Record QC / wastage', icon: icon('minus-circle'), onClick: () => useDialog(k.id, user, () => { onChange(); draw(m.el); refreshIcons(m.el); }) }] : []),
      ...(run && onRequest ? [{ label: 'Request more', icon: icon('send'), cls: 'btn-primary', onClick: (c) => { c(); onRequest(k.id); } }] : []), { label: 'Close', onClick: (c) => c() }],
    onOpen: (w) => { draw(w); refreshIcons(w); } });
}

/** Record reagent used outside a billed patient test: QC run, repeat, wastage. */
export function useDialog(kitId, user, done, { type = 'USED_QC' } = {}) {
  const ks = store.all('labKits').filter((k) => k.active !== false && labBalance(k.id) > 0);
  const kind = (t) => `<label class="ls-choice"><input type="radio" name="ut" value="${t[0]}" ${t[0] === type ? 'checked' : ''}><span>${icon(t[2])}<b>${t[1]}</b><small>${t[3]}</small></span></label>`;
  openModal({ title: 'Record use without a patient test', subtitle: 'Every unit used must be either a billed test or recorded here — otherwise it shows as a shortage.', size: 'md',
    body: `<div class="ls-choices">${[['USED_QC', 'QC run', 'target', 'Daily controls'], ['REPEAT', 'Repeat test', 'rotate-ccw', 'Re-run, no new bill'], ['WASTAGE', 'Wastage', 'trash-2', 'Spilled, damaged, failed']].map(kind).join('')}</div>
      <div class="form-grid mt-2"><div class="field col-8"><label>Item</label><select class="input" data-k>${ks.map((k) => `<option value="${k.id}" ${k.id === kitId ? 'selected' : ''}>${esc(k.name)} — ${labBalance(k.id)} ${esc(k.unit)}s in lab</option>`).join('')}</select></div>
      <div class="field col-4"><label>Quantity</label><input class="input" type="number" min="1" value="1" data-q></div>
      <div class="field col-12"><label>Details <span class="req">*</span></label><input class="input" data-n placeholder="e.g. Level 1 & 2 controls, morning run"></div></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Record', cls: 'btn-primary', icon: icon('check'), onClick: (c, w) => {
      try { recordLabUse({ kitId: w.querySelector('[data-k]').value, qty: w.querySelector('[data-q]').value, type: w.querySelector('[name=ut]:checked').value, note: w.querySelector('[data-n]').value }, user); c(); toast('Recorded.'); done?.(); } catch (e) { toast(e.message, 'error'); }
    } }],
    onOpen: (w) => { const ph = { USED_QC: 'e.g. Level 1 & 2 controls, morning run', REPEAT: 'e.g. Haemolysed — re-run on same sample', WASTAGE: 'e.g. Card dropped / foil torn' }; w.querySelectorAll('[name=ut]').forEach((r) => { r.onchange = () => { w.querySelector('[data-n]').placeholder = ph[r.value]; }; }); }
  });
}
