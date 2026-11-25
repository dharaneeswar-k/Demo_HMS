// Shift management (BRD 12): My Shift (start, live collections, close with denomination count, handover) and the owner's Shift Register.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { userName } from '../calculations.js';
import { openShiftFor, pendingHandoversFor, shiftSummary, startShift, closeShift, respondHandover, verifyShift, suggestedFloat, currentShiftName, denomTotal, outsideShift, COUNTER_LABEL, SHIFT_LABEL, SHIFT_TONE, MODES } from '../shifts.js';
import { badge, openModal, confirmDialog, dataTable, emptyState, kpi, tabs, exportTable } from '../components.js';
import { toast } from '../notifications.js';
import { letterhead, docMeta, signBlock } from '../docs.js';
import { esc, icon, fmtINR, fmtNum, fmtDateTime, relTime, refreshIcons, ymd } from '../utils.js';

const DEN = () => store.hs().denominations;
const denomGrid = (vals = {}) => `<div class="denom-grid">${DEN().map((d) => `<label class="denom"><span>₹${d}</span><input class="input" type="number" min="0" step="1" data-den="${d}" value="${vals[d] || ''}" placeholder="0"><small data-sub="${d}">₹0</small></label>`).join('')}
  <div class="denom-total"><span>Total cash counted</span><strong data-dentotal>₹0.00</strong></div></div>`;
function wireDenoms(root, onChange) {
  const read = () => Object.fromEntries([...root.querySelectorAll('[data-den]')].filter((i) => Number(i.value) > 0).map((i) => [i.dataset.den, Math.floor(Number(i.value))]));
  const upd = () => { const v = read(); root.querySelectorAll('[data-den]').forEach((i) => { root.querySelector(`[data-sub="${i.dataset.den}"]`).textContent = fmtINR((Number(i.value) || 0) * Number(i.dataset.den), true); }); root.querySelector('[data-dentotal]').textContent = fmtINR(denomTotal(v)); onChange?.(v); };
  root.querySelectorAll('[data-den]').forEach((i) => i.addEventListener('input', upd)); upd();
  return read;
}
const toDenoms = (amt) => { const out = {}; let left = Math.round(amt); for (const d of DEN()) { const n = Math.floor(left / d); if (n) { out[d] = n; left -= n * d; } } return out; };

/** Modal used by billing screens and Home when a cashier has no open shift. */
export function openStartShift(onDone) {
  const user = currentUser();
  const sug = suggestedFloat(user);
  const pend = pendingHandoversFor(user);
  if (pend.length) { openHandover(pend[0], () => openStartShift(onDone)); return; }
  let read;
  openModal({ title: 'Start your shift', subtitle: `${COUNTER_LABEL[user.role === 'PHARMACY_STAFF' ? 'PHARMACY' : 'MAIN']} · ${currentShiftName()} shift`, size: 'md',
    body: `<p class="muted mb-2">Count the cash in the drawer before your first bill. ${sug.from ? `You accepted <strong>${fmtINR(sug.amount)}</strong> from ${esc(userName(sug.from.userId))}.` : `Standard opening float is <strong>${fmtINR(sug.amount)}</strong>.`}</p>
      <div class="field mb-2"><label>Shift</label><select class="input" data-name>${store.hs().shifts.map((s) => `<option ${s.name === currentShiftName() ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      ${denomGrid(toDenoms(sug.amount))}`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Start shift', cls: 'btn-primary', icon: 'play', onClick: (c, w) => {
      try { const denoms = read(); startShift({ denoms, shiftName: w.querySelector('[data-name]').value }, user); c(); toast(`Shift started with ${fmtINR(denomTotal(denoms))} opening cash.`); onDone?.(); } catch (e) { toast(e.message, 'error'); }
    } }],
    onOpen: (w) => { read = wireDenoms(w); } });
}

export function openHandover(sh, onDone) {
  const user = currentUser();
  openModal({ title: `Cash handover from ${userName(sh.userId)}`, subtitle: `${sh.shiftName} shift · closed ${relTime(sh.closedAt)}`, size: 'md',
    body: `<div class="handover-amt"><span>Amount handed over</span><strong>${fmtINR(sh.handoverAmount)}</strong></div>
      <table class="table dense mt-2"><thead><tr><th>Note / coin</th><th class="ta-right">Count</th><th class="ta-right">Value</th></tr></thead><tbody>${Object.entries(sh.countedDenoms || {}).sort((a, b) => b[0] - a[0]).map(([d, n]) => `<tr><td>₹${d}</td><td class="ta-right">${n}</td><td class="ta-right">${fmtINR(d * n)}</td></tr>`).join('')}</tbody></table>
      <p class="muted small mt-2">Count the cash yourself. Accept only if it matches. If it does not, reject with the amount you counted — the cashier recounts and the owner is told.</p>
      <div class="field mt-2"><label>Note (required when rejecting)</label><input class="input" data-note placeholder="e.g. Counted ₹2,300 — ₹50 short"></div>`,
    footer: [{ label: 'Reject', cls: 'btn-danger-outline', onClick: (c, w) => { try { respondHandover(sh.id, false, w.querySelector('[data-note]').value, user); c(); toast('Handover rejected. The cashier has been told to recount.', 'warning'); onDone?.(); } catch (e) { toast(e.message, 'error'); } } },
      { label: 'Accept cash', cls: 'btn-primary', icon: 'check', onClick: (c, w) => { try { respondHandover(sh.id, true, w.querySelector('[data-note]').value, user); c(); toast(`${fmtINR(sh.handoverAmount)} accepted.`); onDone?.(); } catch (e) { toast(e.message, 'error'); } } }] });
}

const modeTable = (sum) => `<table class="table dense"><thead><tr><th>Mode</th><th class="ta-right">Collected</th><th class="ta-right">Refunded</th><th class="ta-right">Net</th></tr></thead><tbody>
  ${MODES.map((m) => `<tr><td class="strong">${m === 'OTHER' ? 'Other' : m === 'CASH' ? 'Cash' : m}</td><td class="ta-right">${fmtINR(sum.byMode[m].in)}</td><td class="ta-right">${sum.byMode[m].out ? '−' + fmtINR(sum.byMode[m].out) : '—'}</td><td class="ta-right strong">${fmtINR(sum.byMode[m].net)}</td></tr>`).join('')}
  <tr class="recon-total"><td>Total</td><td class="ta-right">${fmtINR(sum.collected)}</td><td class="ta-right">${sum.refunded ? '−' + fmtINR(sum.refunded) : '—'}</td><td class="ta-right">${fmtINR(sum.collected - sum.refunded)}</td></tr></tbody></table>`;

export function renderMine(view) {
  const user = currentUser();
  const draw = () => {
    const sh = openShiftFor(user); const pend = pendingHandoversFor(user);
    const mine = store.all('shifts').filter((s) => s.userId === user.id).sort((a, b) => b.startAt.localeCompare(a.startAt));
    let body = '';
    if (pend.length) body += `<div class="alert alert-warning mb-2">${icon('hand-coins')}<div><strong>${esc(userName(pend[0].userId))} handed over ${fmtINR(pend[0].handoverAmount)}.</strong> Count it and accept or reject before you start.</div><button class="btn btn-primary btn-sm" data-hand="${pend[0].id}">Count & accept</button></div>`;
    if (!sh) {
      body += `<section class="card shift-start"><div class="card-body"><div class="ss-icon">${icon('sunrise')}</div><div><h2>No shift in progress</h2><p class="muted">Start your shift before taking any payment. Every bill and refund you handle is added to it automatically.</p></div><button class="btn btn-primary btn-lg" data-start>${icon('play')}Start shift</button></div></section>`;
    } else {
      const sum = shiftSummary(sh);
      body += `<div class="kpis mb-2">
        ${kpi({ label: 'Cash expected in drawer', value: fmtINR(sum.expectedCash), iconName: 'banknote', tone: 'teal', sub: `Opening ${fmtINR(sh.openingFloat)} + cash ${fmtINR(sum.byMode.CASH.net)}` })}
        ${kpi({ label: 'UPI / card / other', value: fmtINR(sum.online), iconName: 'smartphone', tone: 'navy', sub: 'Not in the drawer' })}
        ${kpi({ label: 'Payments taken', value: fmtNum(sum.count), iconName: 'receipt', tone: 'info', sub: `${sum.refunds} refund(s)` })}
        ${kpi({ label: 'Shift running for', value: relTime(sh.startAt).replace(' ago', ''), iconName: 'timer', tone: 'warning', sub: `${sh.shiftName} · since ${fmtDateTime(sh.startAt).split(', ')[1]}` })}</div>
        <div class="grid grid-2"><section class="card"><header class="card-head"><h2>Collections by mode</h2></header><div class="card-body">${modeTable(sum)}</div></section>
        <section class="card"><header class="card-head"><h2>Transactions in this shift</h2><span class="muted small">${sum.tx.length}</span></header><div class="card-body tx-scroll">${sum.tx.length ? `<table class="table dense"><tbody>${sum.tx.slice().reverse().map((p) => `<tr><td class="small">${fmtDateTime(p.at).split(', ')[1]}</td><td><span class="mono small">${esc(p.ref)}</span><div class="cell-sub">${p.source}</div></td><td>${p.mode}</td><td class="ta-right strong ${p.kind === 'REFUND' ? 'text-danger' : ''}">${p.kind === 'REFUND' ? '−' : ''}${fmtINR(p.amount)}</td></tr>`).join('')}</tbody></table>` : emptyState('receipt', 'No payments yet')}</div></section></div>
        <div class="row mt-2" style="justify-content:flex-end"><button class="btn btn-primary btn-lg" data-close>${icon('lock')}Close shift & hand over</button></div>`;
    }
    view.innerHTML = `<p class="page-intro">Your cash drawer for this shift. Open with the cash you have, close with a note-by-note count and hand it to the next person. Expected cash = opening + cash collected − cash refunded.</p>${body}
      <section class="card mt-2"><header class="card-head"><h2>My recent shifts</h2></header><div data-hist></div></section>`;
    const t = dataTable({ rows: mine, pageSize: 8, columns: histCols(), onRowClick: (s) => location.hash = `#/shifts/${s.id}` }); view.querySelector('[data-hist]').appendChild(t.el);
    view.querySelector('[data-start]')?.addEventListener('click', () => openStartShift(draw));
    view.querySelector('[data-hand]')?.addEventListener('click', (e) => openHandover(store.get('shifts', e.currentTarget.dataset.hand), draw));
    view.querySelector('[data-close]')?.addEventListener('click', () => openClose(sh, draw));
    refreshIcons(view);
  };
  draw();
}
const histCols = (who = false) => [
  { key: 'startAt', label: 'Started', render: (s) => `${fmtDateTime(s.startAt)}<div class="cell-sub">${esc(s.shiftName)} · ${COUNTER_LABEL[s.counter]}</div>` },
  ...(who ? [{ key: 'userId', label: 'Cashier', value: (s) => userName(s.userId), render: (s) => esc(userName(s.userId)) }] : []),
  { key: 'openingFloat', label: 'Opening', align: 'right', render: (s) => fmtINR(s.openingFloat) },
  { key: 'expectedCash', label: 'Expected cash', align: 'right', render: (s) => (s.expectedCash != null ? fmtINR(s.expectedCash) : '—') },
  { key: 'countedCash', label: 'Counted', align: 'right', render: (s) => (s.countedCash != null ? fmtINR(s.countedCash) : '—') },
  { key: 'difference', label: 'Difference', align: 'right', render: (s) => (s.difference == null ? '—' : `<strong class="${s.difference ? 'text-danger' : 'text-success'}">${s.difference > 0 ? '+' : ''}${fmtINR(s.difference)}</strong>`) },
  { key: 'handoverTo', label: 'Handed to', render: (s) => (s.handoverTo ? `${esc(userName(s.handoverTo))}${s.handoverAcceptedAt ? `<div class="cell-sub">accepted ${fmtDateTime(s.handoverAcceptedAt).split(', ')[1]}</div>` : ''}` : '—') },
  { key: 'status', label: 'Status', render: (s) => badge(SHIFT_TONE[s.status] === 'success' ? 'COMPLETED' : SHIFT_TONE[s.status] === 'warning' ? 'PENDING' : SHIFT_TONE[s.status] === 'info' ? 'SUBMITTED' : 'CLOSED', SHIFT_LABEL[s.status]) }
];

function openClose(sh, done) {
  const user = currentUser(); const sum = shiftSummary(sh);
  const others = store.all('users').filter((u) => u.active && u.id !== user.id && can('shift.own', u) && (u.role === user.role || u.role === 'SUPER_ADMIN'));
  const tol = store.hs().shiftVarianceTolerance;
  let read;
  openModal({ title: 'Close shift', subtitle: `${sh.shiftName} · started ${fmtDateTime(sh.startAt)}`, size: 'lg',
    body: `<div class="grid grid-2"><div><div class="section-title">1. Count the cash in the drawer</div>${denomGrid()}</div>
      <div><div class="section-title">2. Check</div><div class="close-check"><div class="kv"><span>Opening cash</span><strong>${fmtINR(sh.openingFloat)}</strong></div><div class="kv"><span>Cash collected</span><strong>${fmtINR(sum.byMode.CASH.in)}</strong></div><div class="kv"><span>Cash refunded</span><strong>−${fmtINR(sum.byMode.CASH.out)}</strong></div>
        <div class="kv total"><span>Expected in drawer</span><strong>${fmtINR(sum.expectedCash)}</strong></div><div class="kv"><span>Counted</span><strong data-counted>₹0.00</strong></div><div class="kv total"><span>Difference</span><strong data-diff>—</strong></div></div>
        <p class="muted small mt-1">UPI / card / other ${fmtINR(sum.online)} is not in the drawer — it is matched with the bank statement.</p>
        <div class="section-title mt-2">3. Hand over</div><div class="field"><label>Hand the cash to</label><select class="input" data-to><option value="">— Last shift of the day: deposit with the owner / bank —</option>${others.map((u) => `<option value="${u.id}">${esc(u.name)} (${esc(store.get('roles', u.role).name)})</option>`).join('')}</select></div>
        <div class="field mt-1"><label>Note <span class="muted small">(required if the difference is above ${fmtINR(tol, true)})</span></label><input class="input" data-note placeholder="Reason for any difference"></div></div></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Close shift', cls: 'btn-primary', icon: 'lock', onClick: (c, w) => {
      try { closeShift(sh.id, { denoms: read(), handoverTo: w.querySelector('[data-to]').value, note: w.querySelector('[data-note]').value }, user); c(); toast('Shift closed. The owner has the summary.'); location.hash = `#/shifts/${sh.id}`; done?.(); } catch (e) { toast(e.message, 'error'); }
    } }],
    onOpen: (w) => { read = wireDenoms(w, (v) => { const cnt = denomTotal(v); const diff = cnt - sum.expectedCash; w.querySelector('[data-counted]').textContent = fmtINR(cnt); const el = w.querySelector('[data-diff]'); el.textContent = (diff > 0 ? '+' : '') + fmtINR(diff); el.className = Math.abs(diff) < 0.005 ? 'text-success' : 'text-danger'; }); } });
}

export function renderDetail(view, params) {
  const sh = store.get('shifts', params.id);
  if (!sh) { view.innerHTML = emptyState('timer', 'Shift not found'); return; }
  const me = currentUser();
  if (!can('shift.report') && sh.userId !== me.id && sh.handoverTo !== me.id) { view.innerHTML = emptyState('lock', 'Not your shift', 'You can open only your own shift reports.'); return; }
  const sum = shiftSummary(sh);
  view.innerHTML = `<div class="row mb-2 no-print"><button class="btn btn-primary" data-print>${icon('printer')}Print shift report</button>${can('shift.report') && !sh.verifiedBy && sh.closedAt ? `<button class="btn btn-secondary" data-verify>${icon('badge-check')}Mark verified</button>` : ''}<a class="btn btn-ghost" href="#/shifts">${icon('arrow-left')}Back</a></div>
    <article class="doc">${letterhead('Shift Closing Report', { sub: `${sh.shiftName} shift · ${COUNTER_LABEL[sh.counter]}`, code: sh.id })}
      ${docMeta([['Cashier', esc(userName(sh.userId))], ['Started', fmtDateTime(sh.startAt)], ['Closed', sh.closedAt ? fmtDateTime(sh.closedAt) : 'In progress'], ['Status', SHIFT_LABEL[sh.status]], ['Opening float', fmtINR(sh.openingFloat)], ['Expected cash', fmtINR(sh.expectedCash ?? sum.expectedCash)], ['Counted cash', sh.countedCash != null ? fmtINR(sh.countedCash) : '—'], ['Difference', sh.difference != null ? fmtINR(sh.difference) : '—']])}
      <div class="grid grid-2 mt-2"><div><h3 class="doc-h">Collections</h3>${modeTable(sum)}</div><div><h3 class="doc-h">Cash count</h3>${sh.countedDenoms ? `<table class="table dense"><tbody>${Object.entries(sh.countedDenoms).sort((a, b) => b[0] - a[0]).map(([d, n]) => `<tr><td>₹${d} × ${n}</td><td class="ta-right">${fmtINR(d * n)}</td></tr>`).join('')}<tr class="recon-total"><td>Total</td><td class="ta-right">${fmtINR(sh.countedCash)}</td></tr></tbody></table>` : '<p class="muted">Not counted yet.</p>'}
        <h3 class="doc-h mt-2">Handover</h3><p>${sh.handoverTo ? `To <strong>${esc(userName(sh.handoverTo))}</strong> — ${sh.handoverAcceptedAt ? 'accepted ' + fmtDateTime(sh.handoverAcceptedAt) : 'waiting for acceptance'}` : sh.closedAt ? 'Deposited with the owner / bank' : '—'}</p>${sh.note ? `<p class="small">Note: ${esc(sh.note)}</p>` : ''}${sh.handoverNote ? `<p class="small">${esc(sh.handoverNote)}</p>` : ''}</div></div>
      <h3 class="doc-h mt-2">Transactions (${sum.tx.length})</h3><table class="table dense"><thead><tr><th>Time</th><th>Bill</th><th>Counter</th><th>Mode</th><th>Reference</th><th class="ta-right">Amount</th></tr></thead><tbody>${sum.tx.map((p) => `<tr><td>${fmtDateTime(p.at).split(', ')[1]}</td><td class="mono">${esc(p.ref)}</td><td>${p.source}</td><td>${p.mode}</td><td class="small">${esc(p.reference || '')}</td><td class="ta-right ${p.kind === 'REFUND' ? 'text-danger' : ''}">${p.kind === 'REFUND' ? '−' : ''}${fmtINR(p.amount)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No transactions</td></tr>'}</tbody></table>
      ${signBlock([['Cashier', userName(sh.userId)], ['Received by', sh.handoverTo ? userName(sh.handoverTo) : ''], ['Verified by', sh.verifiedBy ? userName(sh.verifiedBy) : '']])}
    </article>`;
  view.querySelector('[data-print]').onclick = () => window.print();
  view.querySelector('[data-verify]')?.addEventListener('click', () => { verifyShift(sh.id, currentUser()); toast('Shift verified.'); renderDetail(view, params); });
  refreshIcons(view);
}

export function renderRegister(view) {
  const from = ymd(new Date(Date.now() - 6 * 86400000)); const to = ymd();
  const all = () => store.all('shifts').slice().sort((a, b) => b.startAt.localeCompare(a.startAt));
  const closed = all().filter((s) => s.closedAt && s.startAt.slice(0, 10) >= from);
  const short = closed.filter((s) => s.difference < 0);
  const outside = outsideShift(from, to);
  let tab = 'all';
  view.innerHTML = `<p class="page-intro">Every cash drawer opened and closed in the hospital — pharmacy and main counter — with the cash count, the difference and who received the handover.</p>
    <div class="kpis mb-2">${kpi({ label: 'Shifts in progress', value: fmtNum(all().filter((s) => s.status === 'OPEN').length), iconName: 'timer', tone: 'info' })}
      ${kpi({ label: 'Handovers not accepted', value: fmtNum(all().filter((s) => s.status === 'HANDOVER_PENDING').length), iconName: 'hand-coins', tone: 'warning' })}
      ${kpi({ label: 'Cash short (7 days)', value: fmtINR(-short.reduce((t, s) => t + s.difference, 0)), iconName: 'trending-down', tone: short.length ? 'danger' : 'success', sub: `${short.length} shift(s)` })}
      ${kpi({ label: 'Payments outside a shift', value: fmtNum(outside.length), iconName: 'alert-triangle', tone: outside.length ? 'danger' : 'success', sub: outside.length ? fmtINR(outside.reduce((t, p) => t + p.amount, 0)) : 'All inside shifts' })}</div>
    <section class="card"><div class="row-between card-pad"><div data-tabs></div><button class="btn btn-secondary btn-sm" data-csv>${icon('download')}Export CSV</button></div><div data-t></div></section>`;
  const cols = histCols(true);
  const t = dataTable({ rows: all(), pageSize: 15, columns: cols, onRowClick: (s) => location.hash = `#/shifts/${s.id}` });
  view.querySelector('[data-t]').appendChild(t.el);
  const set = () => t.setRows(all().filter((s) => tab === 'all' || (tab === 'open' && s.status === 'OPEN') || (tab === 'pending' && s.status === 'HANDOVER_PENDING') || (tab === 'var' && s.difference)));
  tabs(view.querySelector('[data-tabs]'), [{ id: 'all', label: 'All shifts' }, { id: 'open', label: 'In progress' }, { id: 'pending', label: 'Handover pending' }, { id: 'var', label: 'With difference' }], tab, (x) => { tab = x; set(); });
  view.querySelector('[data-csv]').onclick = () => exportTable(`shift-register-${ymd()}.csv`, cols.map((c) => ({ ...c, csv: (s) => (c.key === 'userId' ? userName(s.userId) : c.key === 'handoverTo' ? userName(s.handoverTo) : s[c.key]) })), t.getRows());
  refreshIcons(view);
}

export function render(view) { return renderMine(view); }
