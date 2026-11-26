// Lab Supplies — the store incharge's side of lab stock. Lab requests arrive here; the store issues them
// (earliest-expiry lot first, picked automatically), receives reagents from suppliers with lot, expiry and a
// cold-chain check, and sees what to reorder.
import { store } from '../../data-service.js';
import { currentUser } from '../../auth.js';
import { userName } from '../../calculations.js';
import { dataTable, openModal, confirmDialog, tabs, emptyState } from '../../components.js';
import { toast } from '../../notifications.js';
import { esc, icon, fmtDateTime, relTime, refreshIcons } from '../../utils.js';
import {
  KINDS, STORAGE, MOVE, items, item, lot, storeBalance, labBalance, storeState, lotsAt, nextExpiry, unitTxt, packTxt, packInfo, storeAttention,
  planIssue, issueRequest, rejectRequest, receiveFromSupplier, storeDiscard, canRunStore, requestedUnits
} from '../../labstock.js';
import { kindIcon, statePill, coldTag, qtyBlock, levelBar, expiryTxt, lotChip, reqJourney, reqStatus, reqLines, openItem } from './stockui.js';

export function renderStoreLab(view, params, query) {
  const user = currentUser(); const run = canRunStore(user);
  const S = { tab: query.tab || 'requests', kind: '', q: '' };
  view.innerHTML = `<div class="ls"><div class="ls-hello" data-hello></div><section class="card ls-main"><div class="ls-tabs-row"><div data-tabs></div>${run ? `<button class="btn btn-primary" data-supplier>${icon('package-plus')}Receive from supplier</button>` : ''}</div><div data-body></div></section></div>`;
  const body = view.querySelector('[data-body]');
  const drawAll = () => {
    const a = storeAttention();
    const tile = (id, ic, tone, n, label, sub) => `<button class="ls-tile ls-t-${n ? tone : 'ok'}" data-go="${id}"><span class="ls-tile-ic">${icon(n ? ic : 'check')}</span><span class="ls-tile-n">${n}</span><span class="ls-tile-l">${label}</span><small>${sub}</small></button>`;
    const sent = store.all('labIndents').filter((r) => r.status === 'ISSUED').length;
    view.querySelector('[data-hello]').innerHTML = `${tile('requests', 'inbox', 'warning', a.requests.length, 'Lab requests waiting', a.requests.some((r) => r.urgent) ? `${a.requests.filter((r) => r.urgent).length} urgent` : a.requests.length ? 'Issue them to the lab' : 'All issued')}
      ${tile('requests', 'truck', 'info', sent, 'Sent, not yet received', sent ? 'Lab will confirm on arrival' : 'Nothing in transit')}
      ${tile('stock', 'shopping-cart', 'danger', a.toOrder.length, 'Order from supplier', a.toOrder.length ? 'Store stock at or below reorder' : 'Store stock is fine')}
      ${tile('stock', 'calendar-clock', 'purple', a.expiring.length, 'Store lots expiring ≤ 60 d', a.expiring.length ? 'Issue these first' : 'Nothing close to expiry')}`;
    view.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.go; drawAll(); }; });
    tabs(view.querySelector('[data-tabs]'), [{ id: 'requests', label: 'Lab requests', icon: 'inbox', count: a.requests.length || null }, { id: 'stock', label: 'Lab items in store', icon: 'warehouse' }, { id: 'history', label: 'History', icon: 'history' }], S.tab, (t) => { S.tab = t; drawBody(); });
    drawBody(); refreshIcons(view);
  };
  const drawBody = () => { ({ requests: requestsTab, stock: stockTab, history: historyTab })[S.tab](body, user, S, drawAll); refreshIcons(body); };
  view.querySelector('[data-supplier]')?.addEventListener('click', () => supplierDialog(user, null, drawAll));
  drawAll();
}

// ================= Lab requests =================
function requestsTab(host, user, S, redraw) {
  const { requests } = storeAttention();
  const others = store.all('labIndents').filter((r) => r.status !== 'REQUESTED').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  host.innerHTML = `${requests.length ? `<div class="ls-reqs">${requests.map((r) => issueCard(r, user)).join('')}</div>` : `<div class="ls-allgood">${icon('badge-check')}<div class="grow"><b>No lab requests waiting.</b><span>When the lab asks for stock, it appears here with the lots to send already picked (oldest expiry first).</span></div></div>`}
    ${others.length ? `<h3 class="ls-subhead">Earlier requests</h3><div class="ls-reqs">${others.map((r) => `<article class="ls-req ls-req-${r.status.toLowerCase()}"><header><div><h3>${esc(r.id)} ${r.urgent ? `<span class="ls-urg">${icon('zap')}Urgent</span>` : ''}</h3><small class="muted">from ${esc(userName(r.by))} · ${relTime(r.at)}</small></div>${reqStatus(r)}</header>${reqJourney(r)}${reqLines(r)}</article>`).join('')}</div>` : ''}`;
  host.querySelectorAll('[data-issue-card]').forEach((card) => {
    const r = store.get('labIndents', card.dataset.issueCard);
    const upd = () => { r.lines.forEach((l) => { const inp = card.querySelector(`[data-p="${l.kitId}"]`); const n = Math.max(0, Math.floor(+inp.value || 0)); const pl = planIssue(l.kitId, n); const k = item(l.kitId);
      card.querySelector(`[data-plan="${l.kitId}"]`).innerHTML = n === 0 ? '<span class="muted small">Not sending</span>' : pl.short > 0 ? `<span class="text-danger small">${icon('alert-triangle')}Store has only ${unitTxt(k, n * k.packSize - pl.short)} — send fewer or receive from supplier first</span>` : pl.lines.map((x) => `<div class="small">${unitTxt(k, x.qty)} from ${lotChip(lot(x.lotId))} ${expiryTxt(lot(x.lotId), { short: true })}</div>`).join(''); });
      refreshIcons(card); };
    card.querySelectorAll('[data-p]').forEach((i) => { i.oninput = upd; });
    card.querySelectorAll('[data-pm]').forEach((b) => { b.onclick = () => { const i = card.querySelector(`[data-p="${b.dataset.k}"]`); i.value = Math.max(0, (+i.value || 0) + (+b.dataset.pm)); upd(); }; });
    upd();
    card.querySelector('[data-go]')?.addEventListener('click', () => {
      const packs = Object.fromEntries(r.lines.map((l) => [l.kitId, card.querySelector(`[data-p="${l.kitId}"]`).value]));
      try { issueRequest(r.id, { packs, note: card.querySelector('[data-note]').value }, user); toast(`${r.id} issued. Store stock reduced — the lab will confirm when it arrives.`, 'success', 'Issued to lab'); redraw(); } catch (e) { toast(e.message, 'error'); }
    });
    card.querySelector('[data-no]')?.addEventListener('click', async () => {
      const res = await confirmDialog({ title: `Cannot issue ${r.id}?`, tone: 'danger', iconName: 'x-circle', reason: true, reasonLabel: 'Tell the lab why', reasonPlaceholder: 'e.g. Out of stock — ordered from supplier, expected Friday', confirmLabel: 'Send to lab' });
      if (!res) return; try { rejectRequest(r.id, res.reason, user); toast('The lab has been told.'); redraw(); } catch (e) { toast(e.message, 'error'); }
    });
  });
}
function issueCard(r, user) {
  const run = canRunStore(user);
  return `<article class="ls-req ls-req-requested ls-issue ${r.urgent ? 'urgent' : ''}" data-issue-card="${r.id}">
    <header><div><h3>${esc(r.id)} ${r.urgent ? `<span class="ls-urg">${icon('zap')}Urgent</span>` : ''}</h3><small class="muted">from ${esc(userName(r.by))} (Lab) · asked ${relTime(r.at)} · ${fmtDateTime(r.at)}</small></div>${reqStatus(r)}</header>
    ${r.note ? `<p class="ls-note">${icon('message-square')}<span><b>Lab:</b> ${esc(r.note)}</span></p>` : ''}
    <div class="ls-issue-lines">${r.lines.map((l) => { const k = item(l.kitId); const sb = storeBalance(k.id); return `<div class="ls-issue-line">
      ${kindIcon(k)}<div class="ls-line-name"><b>${esc(k.name)}</b><small>${esc(packInfo(k))} ${coldTag(k)} · lab has ${unitTxt(k, labBalance(k.id))}</small></div>
      <div class="ls-asked"><small>Lab asked</small><b>${packTxt(k, l.packs)}</b></div>
      <div class="ls-asked"><small>In store</small><b class="${sb < l.packs * k.packSize ? 'text-danger' : ''}">${k.packSize > 1 ? packTxt(k, Math.floor(sb / k.packSize)) : unitTxt(k, sb)}</b></div>
      ${run ? `<div class="ls-step"><button class="icon-btn" data-pm="-1" data-k="${k.id}" aria-label="Fewer">${icon('minus')}</button><input class="input" type="number" min="0" max="${l.packs}" value="${Math.min(l.packs, Math.floor(sb / k.packSize))}" data-p="${k.id}" aria-label="Packs to send"><button class="icon-btn" data-pm="1" data-k="${k.id}" aria-label="More">${icon('plus')}</button></div>` : ''}
      <div class="ls-plan" data-plan="${k.id}"></div></div>`; }).join('')}</div>
    ${run ? `<footer class="ls-compose-foot"><input class="input grow" data-note placeholder="Note for the lab (needed if you send less than asked)"><button class="btn btn-ghost" data-no>${icon('x-circle')}Cannot issue</button><button class="btn btn-primary btn-lg" data-go>${icon('send')}Issue to lab</button></footer>` : ''}
  </article>`;
}

// ================= Lab items in store =================
function stockTab(host, user, S, redraw) {
  const all = items();
  const rows = all.filter((k) => (!S.kind || k.kind === S.kind) && (!S.q || k.name.toLowerCase().includes(S.q.toLowerCase()))).sort((x, y) => ({ OUT: 0, LOW: 1, OK: 2 }[storeState(x)] - { OUT: 0, LOW: 1, OK: 2 }[storeState(y)]) || x.name.localeCompare(y.name));
  const chips = [['', 'All', all.length], ...Object.entries(KINDS).map(([k, d]) => [k, d.label, all.filter((x) => x.kind === k).length]).filter((x) => x[2])];
  host.innerHTML = `<div class="ls-toolbar"><div class="ls-chips">${chips.map(([k, l, n]) => `<button class="ls-chip ${S.kind === k ? 'on' : ''}" data-kind="${k}">${k ? icon(KINDS[k].icon) : ''}${l}<span>${n}</span></button>`).join('')}</div><div class="ls-search">${icon('search')}<input class="input" placeholder="Find an item…" data-q value="${esc(S.q)}"></div></div>
    <div class="ls-list">${rows.map((k) => { const sb = storeBalance(k.id); const st = storeState(k); const ne = nextExpiry(k.id, 'STORE'); const lots = lotsAt(k.id, 'STORE');
      return `<div class="ls-row ls-r-${st.toLowerCase()}" data-item="${k.id}" tabindex="0" role="button">${kindIcon(k)}
        <div class="ls-name"><b>${esc(k.name)}</b><small>${esc(packInfo(k))} ${coldTag(k)}${k.supplier ? ` · ${esc(k.supplier)}` : ''}</small></div>
        <div class="ls-level">${qtyBlock(k, sb)}${levelBar(k, sb, { min: k.storeMin, par: k.storeMin * 2 })}<small class="muted">reorder at ${k.storeMin}</small></div>
        <div class="ls-status">${statePill(st)}<small class="muted">${lots.length} lot${lots.length === 1 ? '' : 's'} · lab has ${labBalance(k.id)}</small>${requestedUnits(k.id) ? `<small class="text-warning">${icon('inbox')}Lab asked ${unitTxt(k, requestedUnits(k.id))}</small>` : ''}</div>
        <div class="ls-when">${ne ? `${lotChip(ne)}${expiryTxt(ne, { short: true })}` : '<span class="muted small">—</span>'}</div>
        <div class="ls-acts">${canRunStore(user) ? `<button class="btn btn-secondary btn-sm" data-recv="${k.id}">${icon('package-plus')}Receive</button>` : ''}${icon('chevron-right', 'ls-chev')}</div></div>`; }).join('')}</div>`;
  host.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => { S.kind = b.dataset.kind; stockTab(host, user, S, redraw); refreshIcons(host); }; });
  const qi = host.querySelector('[data-q]'); qi.oninput = () => { S.q = qi.value; const p = qi.selectionStart; stockTab(host, user, S, redraw); refreshIcons(host); const n = host.querySelector('[data-q]'); n.focus(); n.setSelectionRange(p, p); };
  host.querySelectorAll('[data-recv]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); supplierDialog(user, b.dataset.recv, redraw); }; });
  host.querySelectorAll('[data-item]').forEach((r) => { r.onclick = (e) => { if (e.target.closest('[data-recv]')) return; storeItem(r.dataset.item, user, redraw); }; });
}
/** Store view of one item: its store lots, with write-off for damaged / expired stock. */
function storeItem(kitId, user, redraw) {
  openItem(kitId, user, { side: 'STORE', onChange: redraw });
  const w = [...document.querySelectorAll('.modal-backdrop')].at(-1);
  if (!canRunStore(user)) return;
  const foot = w.querySelector('.modal-foot');
  const b = document.createElement('button'); b.className = 'btn btn-secondary'; b.innerHTML = `${icon('trash-2')}Write off`; foot.prepend(b);
  const b2 = document.createElement('button'); b2.className = 'btn btn-primary'; b2.innerHTML = `${icon('package-plus')}Receive from supplier`; foot.insertBefore(b2, foot.lastChild);
  refreshIcons(foot);
  b2.onclick = () => supplierDialog(user, kitId, () => { redraw(); w.querySelector('[data-close]').click(); });
  b.onclick = () => {
    const k = item(kitId); const lots = lotsAt(kitId, 'STORE'); if (!lots.length) { toast('Nothing in the store to write off.', 'error'); return; }
    openModal({ title: `Write off ${k.name}`, subtitle: 'For damaged, warm (cold chain broken) or expired stock in the store.', size: 'sm',
      body: `<div class="field"><label>Lot</label><select class="input" data-l>${lots.map((x) => `<option value="${x.lotId}">Lot ${esc(x.lot?.lot || '—')} · ${x.qty} ${esc(k.unit)}s${x.lot?.expiry ? ' · exp ' + x.lot.expiry : ''}</option>`).join('')}</select></div>
        <div class="field mt-1"><label>Quantity (${esc(k.unit)}s)</label><input class="input" type="number" min="1" data-q value="${lots[0].qty}"></div><div class="field mt-1"><label>Reason <span class="req">*</span></label><input class="input" data-r placeholder="e.g. Expired in store / box crushed"></div>`,
      footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Write off', cls: 'btn-danger', onClick: (c, m) => { try { storeDiscard({ kitId, lotId: m.querySelector('[data-l]').value, qty: m.querySelector('[data-q]').value, reason: m.querySelector('[data-r]').value }, user); c(); toast('Written off.'); redraw(); w.querySelector('[data-close]').click(); } catch (e) { toast(e.message, 'error'); } } }] });
  };
}

/** Supplier delivery: item, packs, lot, expiry, invoice, and a cold-chain check for fridge items. */
function supplierDialog(user, kitId, done) {
  const ks = items(); const first = kitId || ks[0].id;
  openModal({ title: 'Receive lab stock from supplier', subtitle: 'Copy the lot number and expiry exactly as printed on the box.', size: 'md',
    body: `<div class="form-grid">
      <div class="field col-12"><label>Item</label><select class="input" data-k>${Object.entries(KINDS).map(([kk, kd]) => `<optgroup label="${kd.label}">${ks.filter((k) => k.kind === kk).map((k) => `<option value="${k.id}" ${k.id === first ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</optgroup>`).join('')}</select><small class="muted" data-pinfo></small></div>
      <div class="field col-4"><label>Packs received</label><input class="input" type="number" min="1" value="1" data-p><small class="muted" data-eq></small></div>
      <div class="field col-4"><label>Lot number <span class="req">*</span></label><input class="input mono" data-l placeholder="As on the box"></div>
      <div class="field col-4"><label>Expiry <span class="req">*</span></label><input class="input" type="date" data-e></div>
      <div class="field col-6"><label>Supplier</label><input class="input" data-s list="ls-sups"><datalist id="ls-sups">${[...new Set(store.all('labKits').map((k) => k.supplier).filter(Boolean))].map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
      <div class="field col-6"><label>Invoice / DC number</label><input class="input" data-i></div>
      <div class="field col-12 ls-coldcheck" data-coldf><label class="checkbox"><input type="checkbox" data-c> <span>${icon('snowflake')}<b>Arrived cold</b> — ice packs / cold box intact, items cool to touch. If not, do not accept.</span></label></div>
    </div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Add to store stock', cls: 'btn-primary', icon: 'package-plus', onClick: (c, w) => {
      const v = (s) => w.querySelector(s).value;
      try { const r = receiveFromSupplier({ kitId: v('[data-k]'), packs: v('[data-p]'), lotNo: v('[data-l]'), expiry: v('[data-e]'), supplier: v('[data-s]'), invoiceNo: v('[data-i]'), coldOk: w.querySelector('[data-c]').checked }, user); c(); toast(`${item(r.lot.kitId).name}: lot ${r.lot.lot} added to the store.`); done?.(); } catch (e) { toast(e.message, 'error'); }
    } }],
    onOpen: (w) => { const sync = () => { const k = item(w.querySelector('[data-k]').value); w.querySelector('[data-pinfo]').textContent = `${packInfo(k)} · ${STORAGE[k.storage]} · store has ${storeBalance(k.id)} ${k.unit}s`; w.querySelector('[data-coldf]').classList.toggle('hidden', k.storage === 'ROOM'); w.querySelector('[data-s]').value ||= k.supplier || ''; const p = +w.querySelector('[data-p]').value || 0; w.querySelector('[data-eq]').textContent = `= ${unitTxt(k, p * k.packSize)}`; };
      w.querySelector('[data-k]').onchange = () => { w.querySelector('[data-s]').value = ''; sync(); }; w.querySelector('[data-p]').oninput = sync; sync(); }
  });
}

// ================= History =================
function historyTab(host) {
  const rows = store.all('kitMovements').filter((m) => m.loc === 'STORE').slice();
  host.innerHTML = rows.length ? '<div data-t></div>' : emptyState('history', 'No store movements yet');
  if (!rows.length) return;
  const t = dataTable({ rows, pageSize: 25, sort: { key: 'at', dir: 'desc' }, columns: [
    { key: 'at', label: 'When', render: (m) => fmtDateTime(m.at) },
    { key: 'item', label: 'Item', value: (m) => item(m.kitId)?.name, render: (m) => `<div class="ls-cell">${kindIcon(item(m.kitId), 'sm')}<span>${esc(item(m.kitId)?.name)}</span></div>` },
    { key: 'type', label: 'What', value: (m) => MOVE[m.type]?.label, render: (m) => `<span class="tag tag-${MOVE[m.type]?.tone || 'neutral'}">${esc(MOVE[m.type]?.label || m.type)}</span>` },
    { key: 'qty', label: 'Qty', align: 'right', render: (m) => `<b class="${m.qty > 0 ? 'text-success' : ''}">${m.qty > 0 ? '+' : ''}${m.qty}</b> <span class="muted small">${esc(item(m.kitId)?.unit)}s</span>` },
    { key: 'lot', label: 'Lot', value: (m) => lot(m.lotId)?.lot || '', render: (m) => (m.lotId ? `${lotChip(lot(m.lotId))}` : '—') },
    { key: 'ref', label: 'Reference', render: (m) => `<span class="mono small">${esc(m.ref)}</span>` },
    { key: 'by', label: 'By', value: (m) => userName(m.by) }] });
  host.querySelector('[data-t]').appendChild(t.el);
}
