// Lab Stock (#/lab/stock) — User-friendly Inventory & Bench Care Workspace.
// Designed around progressive disclosure and plain human language:
//   1. Quick Overview Strip: 4 calm, clickable status filters (Need Attention, Expiry & Open Packs, Deliveries, All Stock).
//   2. Single Guided Next-Step Prompt: shown only when a delivery arrived or items need ordering.
//   3. Hybrid Shelf View: breathable human-friendly Reagent Cards by default + instant [Cards | Table] toggle,
//      storage zone filter (All / 2–8 °C Fridge / Room Temp), category pills, and instant search.
//   4. Focused Modals: Guided Order Wizard, Blind Count Sheet, Receive Verification, and Item Details.
import { store } from '../../data-service.js';
import { currentUser, can } from '../../auth.js';
import { userName } from '../../calculations.js';
import { dataTable, openModal, confirmDialog, tabs, exportTable } from '../../components.js';
import { toast } from '../../notifications.js';
import { esc, fmtNum, fmtDate, fmtDateTime, relTime, refreshIcons, ymd } from '../../utils.js';
import {
  KINDS, STORAGE, MOVE, items, item, lot, labBalance, storeBalance, labState, lotsAt, isExpired,
  nextExpiry, daysLeft, packsOf, unitTxt, packTxt, packInfo, plural, suggestion, labAttention, openPacks,
  daysOfStock, requestStock, cancelRequest, receiveRequest, submitCount, reviewCount,
  canRunLab, canEditItems, saveItem, validateItem, blankItem, testsUsing, kitReconciliation,
  pendingFor, openPack
} from '../../labstock.js';
import { kindIcon, statePill, coldTag, qtyBlock, levelBar, expiryTxt, lotChip, reqJourney, reqStatus, reqLines, openItem, useDialog } from './stockui.js';
import { icon, emptyState } from './bi.js';

export function renderLabStock(view, params, query) {
  const user = currentUser();
  const run = canRunLab(user);
  const S = {
    tab: query.tab === 'requests' ? 'requests' : (query.tab || 'stock'),
    viewMode: 'cards', // 'cards' | 'table'
    only: query.filter || '', // '' | 'low' | 'exp' | 'open'
    storage: '', // '' | 'COLD' | 'ROOM'
    kind: '',
    q: '',
    reqFilter: 'all',
    mvFilter: 'ALL'
  };

  view.innerHTML = `<div class="page-head">
      <div><p class="muted">Track reagents, test cards, open-pack stability, and restock from the central store.</p></div>
      <div class="page-actions" data-topacts></div>
    </div>
    <div class="ls">
      <div class="lsu-kpis" data-kpis></div>
      <div data-prompt></div>
      <section class="card ls-main">
        <div class="ls-tabs" data-tabs></div>
        <div data-body></div>
      </section>
    </div>`;

  // ---------- top action buttons ----------
  const drawTopActs = () => {
    const host = view.querySelector('[data-topacts]');
    if (!run) { host.innerHTML = ''; return; }
    const a = labAttention();
    host.innerHTML = `
      <button class="btn btn-secondary" data-top-count>${icon('clipboard-check')}Stock count</button>
      <button class="btn btn-secondary" data-top-use>${icon('minus-circle')}Log use</button>
      <button class="btn btn-primary" data-top-order>${icon('send')}${a.suggest.length ? `Order low stock (${a.suggest.length})` : 'New order'}</button>`;
    host.querySelector('[data-top-count]').onclick = () => countDialog(user, drawAll);
    host.querySelector('[data-top-use]').onclick = () => useDialog(items()[0]?.id, user, drawAll);
    host.querySelector('[data-top-order]').onclick = () => orderModal(user, drawAll);
  };

  // ---------- 4 calm clickable overview cards ----------
  const drawOverview = () => {
    const a = labAttention();
    const all = items();
    const issueCount = new Set([...a.expiring.map((x) => x.k.id), ...a.packsDue.map((p) => p.kitId)]).size;
    const transit = a.arriving.length + a.waiting.length;
    const tile = (id, ic, tone, count, title, sub, active) => `
      <button type="button" class="lsu-kpi lsu-kpi-${tone} ${active ? 'on' : ''}" data-ov="${id}">
        <span class="lsu-kpi-ic">${icon(ic)}</span>
        <div class="lsu-kpi-body">
          <div class="lsu-kpi-top"><strong>${count}</strong><span>${title}</span></div>
          <small>${sub}</small>
        </div>
      </button>`;

    view.querySelector('[data-kpis]').innerHTML = `
      ${tile('all', 'boxes', 'teal', all.length, 'Total lab items', `${all.filter((k) => labState(k) === 'OK').length} healthy on shelf`, S.tab === 'stock' && !S.only)}
      ${tile('low', 'trending-down', a.low.length ? 'danger' : 'ok', a.low.length, 'Running low / out', a.low.length ? 'Tap to filter low items' : 'All shelves stocked', S.tab === 'stock' && S.only === 'low')}
      ${tile('exp', 'calendar-clock', issueCount ? 'warning' : 'ok', issueCount, 'Expiry & open packs', issueCount ? 'Check bench & lots soon' : 'All lots within date', S.tab === 'stock' && ['exp', 'open'].includes(S.only))}
      ${tile('orders', 'truck', a.arriving.length ? 'info' : 'navy', transit, 'Store orders', a.arriving.length ? `${a.arriving.length} delivered — check & receive` : a.waiting.length ? `${a.waiting.length} waiting at store` : 'No pending orders', S.tab === 'requests')}`;

    view.querySelectorAll('[data-ov]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.ov;
        if (id === 'orders') { S.tab = 'requests'; S.only = ''; }
        else if (id === 'all') { S.tab = 'stock'; S.only = ''; }
        else { S.tab = 'stock'; S.only = S.only === id ? '' : id; }
        drawAll();
      };
    });
  };

  // ---------- single guided next-step prompt (never stacks messy banners) ----------
  const drawPrompt = () => {
    const host = view.querySelector('[data-prompt]');
    if (!run) { host.innerHTML = ''; return; }
    const a = labAttention();
    if (a.arriving.length) {
      const r = a.arriving[0];
      host.innerHTML = `<div class="lsu-guide lsu-guide-info">
        <span class="lsu-guide-ic">${icon('package-check')}</span>
        <div class="grow">
          <strong>Delivery arrived from Central Store (${esc(r.id)})</strong>
          <span>${r.issue.lines.length} lot${r.issue.lines.length > 1 ? 's' : ''} waiting to be checked in. Verify what arrived to add them to lab stock.</span>
        </div>
        <button class="btn btn-primary" data-guide-recv>${icon('check')}Check &amp; receive</button>
      </div>`;
      host.querySelector('[data-guide-recv]').onclick = () => {
        if (a.arriving.length === 1) receiveDialog(r.id, user, drawAll);
        else { S.tab = 'requests'; drawAll(); }
      };
      return;
    }
    if (a.suggest.length) {
      const names = a.suggest.slice(0, 2).map((x) => x.k.name.split(' (')[0]).join(', ');
      const extra = a.suggest.length > 2 ? ` and ${a.suggest.length - 2} more` : '';
      host.innerHTML = `<div class="lsu-guide lsu-guide-warn">
        <span class="lsu-guide-ic">${icon('send')}</span>
        <div class="grow">
          <strong>${a.suggest.length} item${a.suggest.length === 1 ? ' needs' : 's need'} restocking from Central Store</strong>
          <span>${esc(names)}${extra} ${a.suggest.length === 1 ? 'is' : 'are'} below reorder level. A pre-filled order is ready.</span>
        </div>
        <button class="btn btn-primary" data-guide-order>${icon('send')}Review &amp; order (${a.suggest.length})</button>
      </div>`;
      host.querySelector('[data-guide-order]').onclick = () => orderModal(user, drawAll);
      return;
    }
    host.innerHTML = '';
  };

  // ---------- workspace tabs ----------
  const drawTabs = () => {
    const open = store.all('labIndents').filter((r) => ['REQUESTED', 'ISSUED'].includes(r.status)).length;
    const pendingCounts = store.all('kitCounts').filter((c) => c.status === 'SUBMITTED').length;
    tabs(view.querySelector('[data-tabs]'), [
      { id: 'stock', label: 'Shelf inventory', icon: icon('boxes') },
      { id: 'requests', label: 'Orders & receiving', icon: icon('send'), count: open || null },
      { id: 'count', label: 'Physical counts', icon: icon('clipboard-check'), count: pendingCounts || null },
      { id: 'history', label: 'Usage log', icon: icon('history') },
      ...(canEditItems(user) ? [{ id: 'items', label: 'Manage items', icon: icon('settings-2') }] : []),
      ...(can('management.view', user) ? [{ id: 'recon', label: 'Used vs billed', icon: icon('scale') }] : [])
    ], S.tab, (t) => { S.tab = t; S.only = ''; drawAll(); });
  };

  const drawBody = () => {
    const body = view.querySelector('[data-body]');
    ({ stock: shelfTab, requests: requestsTab, count: countTab, history: historyTab, items: itemsTab, recon: reconTab })[S.tab]?.(body, user, S, drawAll);
    refreshIcons(body);
  };

  const drawAll = () => {
    drawTopActs();
    drawOverview();
    drawPrompt();
    drawTabs();
    drawBody();
    refreshIcons(view);
  };

  drawAll();
  if (query.item && item(query.item)) openItem(query.item, user, { onChange: drawAll, onRequest: (id) => orderModal(user, drawAll, id) });
}

// =====================================================================================================
// TAB 1: Shelf Inventory — Clean Cards (Default) + Table Toggle
// =====================================================================================================
function shelfTab(host, user, S, redraw) {
  const a = labAttention();
  const run = canRunLab(user);
  const all = items();
  const lowSet = new Set(a.low.map((k) => k.id));
  const openSet = new Set(a.packsDue.map((p) => p.kitId));
  const expSet = new Set([...a.expiring.map((x) => x.k.id), ...openSet]);

  const qLower = S.q.trim().toLowerCase();
  const rows = all.filter((k) => {
    if (S.only === 'low' && !lowSet.has(k.id)) return false;
    if (S.only === 'exp' && !expSet.has(k.id)) return false;
    if (S.only === 'open' && !openSet.has(k.id)) return false;
    if (S.storage && (S.storage === 'COLD' ? k.storage === 'ROOM' : k.storage !== 'ROOM')) return false;
    if (S.kind && k.kind !== S.kind) return false;
    if (qLower) {
      const tests = testsUsing(k.id).map((t) => `${t.code} ${t.name}`).join(' ');
      const lotTxt = lotsAt(k.id, 'LAB').map((x) => x.lot?.lot || '').join(' ');
      if (!`${k.name} ${KINDS[k.kind]?.label || ''} ${tests} ${lotTxt}`.toLowerCase().includes(qLower)) return false;
    }
    return true;
  }).sort((x, y) => ({ OUT: 0, LOW: 1, OK: 2 }[labState(x)] - { OUT: 0, LOW: 1, OK: 2 }[labState(y)]) || x.name.localeCompare(y.name));

  const chips = [['', 'All', all.length], ...Object.entries(KINDS).map(([k, d]) => [k, d.label, all.filter((x) => x.kind === k).length]).filter((x) => x[2])];

  host.innerHTML = `
    <div class="lsu-bar">
      <div class="ls-chips">
        ${chips.map(([k, l, n]) => `<button class="ls-chip ${S.kind === k ? 'on' : ''}" data-kind="${k}">${k ? icon(KINDS[k].icon) : ''}${l}<span>${n}</span></button>`).join('')}
      </div>
      <div class="lsu-tools">
        <div class="seg" role="group" aria-label="Storage filter">
          ${[['', 'All storage'], ['COLD', 'Fridge'], ['ROOM', 'Room']].map(([v, l]) => `<button class="seg-btn ${S.storage === v ? 'active' : ''}" data-stor="${v}">${l}</button>`).join('')}
        </div>
        <div class="ls-search lsu-search">${icon('search')}<input class="input" placeholder="Search item, test or lot…" data-q value="${esc(S.q)}"></div>
        <div class="seg" role="group" aria-label="View style">
          <button class="seg-btn ${S.viewMode === 'cards' ? 'active' : ''}" data-vm="cards" title="Card view">${icon('grid')}Cards</button>
          <button class="seg-btn ${S.viewMode === 'table' ? 'active' : ''}" data-vm="table" title="Table view">${icon('list')}Table</button>
        </div>
      </div>
    </div>
    ${S.only ? `<div class="ls-filtered">${icon('filter')}Showing: <b>${{ low: 'Items running low or out of stock', exp: 'Items expiring soon or with open packs due', open: 'Open packs due on bench' }[S.only]}</b><button class="btn btn-ghost btn-sm" data-clear>Show all items</button></div>` : ''}
    ${rows.length
      ? (S.viewMode === 'cards'
        ? `<div class="lsu-grid">${rows.map((k) => shelfCard(k)).join('')}</div>`
        : `<div class="table-scroll"><table class="table lsu-table"><thead><tr><th>Item</th><th style="width:210px">Current stock</th><th>Status &amp; runway</th><th>Bench &amp; expiry</th><th class="ta-right">Quick actions</th></tr></thead><tbody>${rows.map((k) => shelfRow(k)).join('')}</tbody></table></div>`)
      : emptyState('package-search', 'No items match your filters', 'Try clearing your search or switching storage filters.', '<button class="btn btn-secondary btn-sm" data-reset>Show all items</button>')}
  `;

  host.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => { S.kind = b.dataset.kind; shelfTab(host, user, S, redraw); refreshIcons(host); }; });
  host.querySelectorAll('[data-stor]').forEach((b) => { b.onclick = () => { S.storage = b.dataset.stor; shelfTab(host, user, S, redraw); refreshIcons(host); }; });
  host.querySelectorAll('[data-vm]').forEach((b) => { b.onclick = () => { S.viewMode = b.dataset.vm; shelfTab(host, user, S, redraw); refreshIcons(host); }; });
  host.querySelector('[data-clear]')?.addEventListener('click', () => { S.only = ''; redraw(); });
  host.querySelector('[data-reset]')?.addEventListener('click', () => { S.only = ''; S.kind = ''; S.storage = ''; S.q = ''; redraw(); });

  const qi = host.querySelector('[data-q]');
  qi.oninput = () => {
    S.q = qi.value; const pos = qi.selectionStart;
    shelfTab(host, user, S, redraw); refreshIcons(host);
    const n = host.querySelector('[data-q]'); n.focus(); n.setSelectionRange(pos, pos);
  };

  host.querySelectorAll('[data-open-item]').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest('button, a')) return;
      openItem(el.dataset.openItem, user, { onChange: redraw, onRequest: (id) => orderModal(user, redraw, id) });
    };
  });
  host.querySelectorAll('[data-details]').forEach((b) => {
    b.onclick = () => openItem(b.dataset.details, user, { onChange: redraw, onRequest: (id) => orderModal(user, redraw, id) });
  });
  host.querySelectorAll('[data-use]').forEach((b) => {
    b.onclick = () => useDialog(b.dataset.use, user, redraw);
  });
  host.querySelectorAll('[data-order]').forEach((b) => {
    b.onclick = () => orderModal(user, redraw, b.dataset.order);
  });
  host.querySelectorAll('[data-openpack]').forEach((b) => {
    b.onclick = async () => {
      const k = item(b.dataset.openpack);
      const ok = await confirmDialog({
        title: `Open a new ${k.kind === 'CONTROL' ? 'vial' : k.packLabel}?`,
        iconName: icon('package-open'),
        confirmLabel: 'Open pack',
        message: `Starts the ${k.openDays}-day stability timer on the bench using your oldest-expiry lot.`
      });
      if (!ok) return;
      try { openPack(k.id, user); toast(k.kind === 'CONTROL' ? 'Vial opened & 1 QC unit logged.' : 'Pack marked open on bench.', 'success'); redraw(); }
      catch (err) { toast(err.message, 'error'); }
    };
  });

  function itemHints(k) {
    const dos = daysOfStock(k);
    const op = openPacks(k.id)[0];
    const ne = nextExpiry(k.id, 'LAB');
    const pend = pendingFor(k.id);
    const hints = [];

    if (pend.length) {
      const p = pend[0];
      hints.push({ tone: 'info', ic: p.status === 'ISSUED' ? 'truck' : 'hourglass', text: p.status === 'ISSUED' ? `On the way · ${p.id}` : `Ordered · ${p.id}` });
    }
    if (op) {
      const d = daysLeft(op.useBy);
      if (d < 0) hints.push({ tone: 'danger', ic: 'alert-octagon', text: 'Open pack expired' });
      else if (d <= 2) hints.push({ tone: 'warning', ic: 'package-open', text: `Open pack · ${d === 0 ? 'use today' : `${d}d left`}` });
      else hints.push({ tone: 'neutral', ic: 'package-open', text: `Pack open · ${d}d left` });
    }
    if (ne?.expiry) {
      const d = daysLeft(ne.expiry);
      if (d < 0) hints.push({ tone: 'danger', ic: 'alert-triangle', text: `Lot ${ne.lot} expired` });
      else if (d <= 30) hints.push({ tone: 'warning', ic: 'calendar-clock', text: `Expires ${fmtDate(ne.expiry)} (${d}d)` });
    }
    if (!hints.length) {
      if (dos == null) hints.push({ tone: 'muted', ic: 'check-circle-2', text: 'Ready on shelf' });
      else if (dos <= 0) hints.push({ tone: 'danger', ic: 'alert-circle', text: 'Used up — restock needed' });
      else hints.push({ tone: 'muted', ic: 'clock', text: `Lasts ~${dos} day${dos === 1 ? '' : 's'} at current pace` });
    }
    return hints;
  }

  function shelfCard(k) {
    const bal = labBalance(k.id);
    const st = labState(k);
    const pend = pendingFor(k.id);
    const hints = itemHints(k).slice(0, 2);
    const needsOrder = st !== 'OK' && !pend.length;

    return `<article class="lsu-card lsu-c-${st.toLowerCase()}" data-open-item="${k.id}">
      <header class="lsu-c-head">
        ${kindIcon(k)}
        <div class="lsu-c-title">
          <strong>${esc(k.name)}</strong>
          <small>${esc(packInfo(k))}${k.storage !== 'ROOM' ? ` · ${coldTag(k)}` : ''}</small>
        </div>
      </header>

      <div class="lsu-c-stock">
        <div class="lsu-c-num">
          <b class="${bal <= 0 ? 'zero' : ''}">${bal}</b>
          <span>${esc(k.unit)}${bal === 1 ? '' : 's'}</span>
          ${k.packSize > 1 && bal > 0 ? `<small>≈ ${packsOf(k, bal)} ${k.packLabel}</small>` : ''}
        </div>
        ${statePill(st)}
      </div>

      <div class="lsu-c-meter">
        ${levelBar(k, bal)}
        <div class="lsu-c-caps"><span>Target: ${unitTxt(k, k.parLevel)}</span><span>Reorder at ${k.reorderLevel}</span></div>
      </div>

      <div class="lsu-c-hints">
        ${hints.map((h) => `<span class="lsu-hint lsu-h-${h.tone}">${icon(h.ic)}${esc(h.text)}</span>`).join('')}
      </div>

      <footer class="lsu-c-foot">
        <div class="lsu-c-acts">
          ${run && needsOrder ? `<button class="btn btn-primary btn-sm" data-order="${k.id}">${icon('send')}Order</button>` : ''}
          ${run && bal > 0 ? `<button class="btn btn-secondary btn-sm" data-use="${k.id}">${icon('minus-circle')}Log use</button>` : ''}
          ${run && k.openDays && bal > 0 ? `<button class="btn btn-ghost btn-sm" data-openpack="${k.id}">${icon('package-open')}Open ${k.kind === 'CONTROL' ? 'vial' : k.packLabel}</button>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" data-details="${k.id}">Details ${icon('chevron-right')}</button>
      </footer>
    </article>`;
  }

  function shelfRow(k) {
    const bal = labBalance(k.id); const st = labState(k); const pend = pendingFor(k);
    const hints = itemHints(k);
    return `<tr class="clickable" data-open-item="${k.id}">
      <td><div class="ls-cell">${kindIcon(k, 'sm')}<div><strong>${esc(k.name)}</strong><small class="muted">${esc(packInfo(k))} ${coldTag(k)}</small></div></div></td>
      <td>${qtyBlock(k, bal)}${levelBar(k, bal)}</td>
      <td>${statePill(st)}<div class="small muted" style="margin-top:3px">${hints[0] ? esc(hints[0].text) : ''}</div></td>
      <td>${hints[1] ? `<span class="lsu-hint lsu-h-${hints[1].tone}">${icon(hints[1].ic)}${esc(hints[1].text)}</span>` : (nextExpiry(k.id, 'LAB') ? expiryTxt(nextExpiry(k.id, 'LAB'), { short: true }) : '<span class="muted small">—</span>')}</td>
      <td class="ta-right"><div class="row-actions">${run && st !== 'OK' && !pend.length ? `<button class="btn btn-primary btn-sm" data-order="${k.id}">${icon('send')}Order</button>` : ''}${run && bal > 0 ? `<button class="btn btn-secondary btn-sm" data-use="${k.id}">Log use</button>` : ''}<button class="btn btn-ghost btn-sm" data-details="${k.id}">Details</button></div></td>
    </tr>`;
  }
}

// =====================================================================================================
// Guided Order Wizard Modal (clean, uncluttered, plenty of breathing room)
// =====================================================================================================
function orderModal(user, done, focusKitId = null) {
  const sug = labAttention().suggest;
  const lines = sug.map((x) => ({ kitId: x.k.id, packs: x.s.packs, on: true, auto: true }));
  if (focusKitId) {
    const ex = lines.find((l) => l.kitId === focusKitId);
    if (ex) ex.on = true;
    else lines.unshift({ kitId: focusKitId, packs: suggestion(item(focusKitId))?.packs || 1, on: true, auto: false });
  }
  const state = { lines, urgent: lines.some((l) => labBalance(l.kitId) <= 0), note: '' };

  const renderModal = (w, close) => {
    const chosen = state.lines.filter((l) => l.on && l.packs > 0);
    const remaining = items().filter((k) => !state.lines.some((l) => l.kitId === k.id));

    w.querySelector('.modal-body').innerHTML = `
      <div class="lsu-ord-wrap">
        ${state.lines.length ? `<div class="lsu-ord-list">${state.lines.map((l, i) => {
          const k = item(l.kitId); const bal = labBalance(k.id); const sb = storeBalance(k.id); const pend = pendingFor(k.id);
          return `<div class="lsu-ord-row ${l.on ? '' : 'off'}" data-i="${i}">
            <label class="ls-check"><input type="checkbox" ${l.on ? 'checked' : ''} data-on></label>
            ${kindIcon(k, 'sm')}
            <div class="grow">
              <strong>${esc(k.name)}</strong>
              <small class="muted">
                Lab: <b class="${bal <= 0 ? 'text-danger' : 'text-warning'}">${unitTxt(k, bal)}</b> · Target: ${k.parLevel} · Store has: <b>${unitTxt(k, sb)}</b>
                ${pend.length ? ` · <span class="text-info">${pend[0].id} open</span>` : ''}
              </small>
            </div>
            <div class="ls-step">
              <button type="button" class="icon-btn" data-dec aria-label="Decrease">${icon('minus')}</button>
              <input class="input" type="number" min="1" value="${l.packs}" data-packs aria-label="Packs">
              <button type="button" class="icon-btn" data-inc aria-label="Increase">${icon('plus')}</button>
            </div>
            <div class="lsu-ord-eq"><b>${packTxt(k, l.packs)}</b><small>${unitTxt(k, l.packs * k.packSize)}</small></div>
            ${!l.auto ? `<button type="button" class="icon-btn" data-del title="Remove">${icon('x')}</button>` : '<span></span>'}
          </div>`;
        }).join('')}</div>` : emptyState('package-plus', 'Nothing selected yet', 'Pick any reagent, card or tube below to request from central store.')}

        ${remaining.length ? `<div class="lsu-ord-add">
          <select class="input" data-add>
            <option value="">+ Add another item to this order…</option>
            ${Object.entries(KINDS).map(([kk, kd]) => {
              const g = remaining.filter((k) => k.kind === kk);
              return g.length ? `<optgroup label="${kd.label}">${g.map((k) => `<option value="${k.id}">${esc(k.name)} (${labBalance(k.id)} in lab · ${storeBalance(k.id)} in store)</option>`).join('')}</optgroup>` : '';
            }).join('')}
          </select>
        </div>` : ''}

        <div class="lsu-ord-opts">
          <label class="ls-urgent"><input type="checkbox" data-urgent ${state.urgent ? 'checked' : ''}><span>${icon('zap')}Urgent request</span></label>
          <input class="input grow" data-note placeholder="Add an optional note for the storekeeper…" value="${esc(state.note)}">
        </div>
      </div>`;

    const sendBtn = w.querySelector('[data-fi="1"]');
    if (sendBtn) {
      sendBtn.disabled = !chosen.length;
      sendBtn.innerHTML = `${icon('send')}Send order${chosen.length ? ` (${chosen.length} item${chosen.length > 1 ? 's' : ''})` : ''}`;
    }

    w.querySelectorAll('.lsu-ord-row').forEach((row) => {
      const l = state.lines[+row.dataset.i];
      row.querySelector('[data-on]').onchange = (e) => { l.on = e.target.checked; renderModal(w, close); };
      row.querySelector('[data-packs]').onchange = (e) => { l.packs = Math.max(1, Math.floor(+e.target.value || 1)); renderModal(w, close); };
      row.querySelector('[data-inc]').onclick = () => { l.packs++; l.on = true; renderModal(w, close); };
      row.querySelector('[data-dec]').onclick = () => { l.packs = Math.max(1, l.packs - 1); renderModal(w, close); };
      row.querySelector('[data-del]')?.addEventListener('click', () => { state.lines.splice(+row.dataset.i, 1); renderModal(w, close); });
    });
    w.querySelector('[data-add]')?.addEventListener('change', (e) => {
      if (!e.target.value) return;
      const k = item(e.target.value);
      state.lines.push({ kitId: k.id, packs: suggestion(k)?.packs || 1, on: true, auto: false });
      renderModal(w, close);
    });
    w.querySelector('[data-urgent]').onchange = (e) => { state.urgent = e.target.checked; };
    w.querySelector('[data-note]').oninput = (e) => { state.note = e.target.value; };
    refreshIcons(w);
  };

  openModal({
    title: 'Order lab stock from Central Store',
    subtitle: 'Quantities are calculated to refill each low item back up to its target shelf level.',
    size: 'lg',
    body: '<div></div>',
    footer: [
      { label: 'Cancel', onClick: (c) => c() },
      {
        label: 'Send order', cls: 'btn-primary', icon: icon('send'),
        onClick: (c) => {
          const chosen = state.lines.filter((l) => l.on && l.packs > 0);
          try {
            const r = requestStock({ lines: chosen.map((l) => ({ kitId: l.kitId, packs: l.packs })), urgent: state.urgent, note: state.note }, user);
            c();
            toast(`Order ${r.id} sent to central store.`, 'success', 'Order placed');
            done?.();
          } catch (err) { toast(err.message, 'error'); }
        }
      }
    ],
    onOpen: (w, c) => renderModal(w, c)
  });
}

// =====================================================================================================
// TAB 2: Orders & Receiving
// =====================================================================================================
function requestsTab(host, user, S, redraw) {
  const rank = (r) => ({ ISSUED: 0, REQUESTED: 1 }[r.status] ?? 2);
  const allReqs = store.all('labIndents').slice().sort((a, b) => rank(a) - rank(b) || b.at.localeCompare(a.at));
  const filtered = allReqs.filter((r) => S.reqFilter === 'all' || (S.reqFilter === 'active' ? ['REQUESTED', 'ISSUED'].includes(r.status) : !['REQUESTED', 'ISSUED'].includes(r.status)));
  const activeCount = allReqs.filter((r) => ['REQUESTED', 'ISSUED'].includes(r.status)).length;
  const doneCount = allReqs.length - activeCount;

  host.innerHTML = `
    <div class="ls-toolbar">
      <div class="ls-chips">
        ${[['all', 'All orders', allReqs.length], ['active', 'Open & arriving', activeCount], ['done', 'Completed', doneCount]].map(([k, l, n]) =>
          `<button class="ls-chip ${S.reqFilter === k ? 'on' : ''}" data-rf="${k}">${l}<span>${n}</span></button>`).join('')}
      </div>
      ${canRunLab(user) ? `<button class="btn btn-primary btn-sm" data-new-ord>${icon('plus')}New order</button>` : ''}
    </div>
    ${filtered.length ? `<div class="ls-reqs">${filtered.map((r) => `<article class="ls-req ls-req-${r.status.toLowerCase()}">
      <header>
        <div><h3>${esc(r.id)} ${r.urgent ? `<span class="ls-urg">${icon('zap')}Urgent</span>` : ''}</h3><small class="muted">${r.lines.length} item${r.lines.length > 1 ? 's' : ''} · ordered ${relTime(r.at)}</small></div>
        ${reqStatus(r)}
        <div class="ls-req-acts">
          ${canRunLab(user) && r.status === 'ISSUED' ? `<button class="btn btn-primary btn-sm" data-recv="${r.id}">${icon('package-check')}Check &amp; receive</button>` : ''}
          ${canRunLab(user) && r.status === 'REQUESTED' ? `<button class="btn btn-ghost btn-sm" data-cancel="${r.id}">Cancel order</button>` : ''}
        </div>
      </header>
      ${reqJourney(r)}${reqLines(r)}
    </article>`).join('')}</div>`
      : emptyState('send', 'No orders yet', 'When you order stock from the store, its live delivery progress appears here.')}`;

  host.querySelectorAll('[data-rf]').forEach((b) => { b.onclick = () => { S.reqFilter = b.dataset.rf; requestsTab(host, user, S, redraw); refreshIcons(host); }; });
  host.querySelector('[data-new-ord]')?.addEventListener('click', () => orderModal(user, redraw));
  host.querySelectorAll('[data-recv]').forEach((b) => { b.onclick = () => receiveDialog(b.dataset.recv, user, redraw); });
  host.querySelectorAll('[data-cancel]').forEach((b) => {
    b.onclick = async () => {
      const ok = await confirmDialog({ title: `Cancel ${b.dataset.cancel}?`, tone: 'danger', iconName: icon('ban'), confirmLabel: 'Cancel order', message: 'The central store will no longer see this order.' });
      if (!ok) return;
      try { cancelRequest(b.dataset.cancel, user); toast('Order cancelled.'); redraw(); } catch (e) { toast(e.message, 'error'); }
    };
  });
}

/** Lab verifies physical counts against what the store sent. */
export function receiveDialog(id, user, done) {
  const r = store.get('labIndents', id);
  openModal({
    title: `Check & receive ${id}`,
    subtitle: `Sent by ${esc(userName(r.issue.by))} ${relTime(r.issue.at)}. Confirm the exact quantity that reached the lab.`,
    size: 'lg',
    body: `<table class="table ls-recv"><thead><tr><th>Item</th><th>Lot &amp; expiry</th><th class="ta-right">Sent</th><th style="width:190px" class="ta-right">Received</th></tr></thead><tbody>
      ${r.issue.lines.map((x, i) => { const k = item(x.kitId); return `<tr data-row="${i}"><td><div class="ls-cell">${kindIcon(k, 'sm')}<div><strong>${esc(k.name)}</strong><small class="muted">${coldTag(k)}${k.storage === 'COLD' ? ' Put straight into fridge' : ''}</small></div></div></td><td>${lotChip(lot(x.lotId))}<div>${expiryTxt(lot(x.lotId))}</div></td>
        <td class="ta-right"><b>${unitTxt(k, x.qty)}</b>${k.packSize > 1 ? `<div class="muted small">${packTxt(k, x.qty / k.packSize)}</div>` : ''}</td><td class="ta-right"><div class="ls-arrived"><input class="input" type="number" min="0" max="${x.qty}" value="${x.qty}" data-got="${i}"><span>${esc(plural(k.unit, x.qty))}</span></div><small class="ls-diff" data-diff="${i}"></small></td></tr>`; }).join('')}
      </tbody></table>${r.issue.note ? `<p class="ls-note">${icon('warehouse')}<span><b>Store note:</b> ${esc(r.issue.note)}</span></p>` : ''}
      <div class="field mt-2 hidden" data-shortf><label>What was missing? <span class="req">*</span></label><input class="input" data-note placeholder="e.g. Box contained 20 cards instead of 25"></div>`,
    footer: [{ label: 'Not now', onClick: (c) => c() }, {
      label: 'Confirm received', cls: 'btn-primary', icon: icon('package-check'),
      onClick: (c, w) => {
        const got = Object.fromEntries([...w.querySelectorAll('[data-got]')].map((i) => [i.dataset.got, i.value]));
        try {
          const res = receiveRequest(id, got, user, w.querySelector('[data-note]').value);
          c();
          toast(res.status === 'SHORT' ? 'Received with shortage — store and admin notified.' : 'Received — lab shelf stock updated.', res.status === 'SHORT' ? 'warning' : 'success');
          done?.();
        } catch (e) { toast(e.message, 'error'); }
      }
    }],
    onOpen: (w) => {
      const upd = () => {
        let short = false;
        w.querySelectorAll('[data-got]').forEach((i) => {
          const sent = r.issue.lines[+i.dataset.got].qty; const d = sent - (+i.value || 0);
          const el = w.querySelector(`[data-diff="${i.dataset.got}"]`);
          el.textContent = d > 0 ? `${d} short` : d < 0 ? 'More than sent?' : '';
          el.className = 'ls-diff ' + (d ? 'text-danger' : '');
          if (d > 0) short = true;
        });
        w.querySelector('[data-shortf]').classList.toggle('hidden', !short);
      };
      w.querySelectorAll('[data-got]').forEach((i) => { i.oninput = upd; });
    }
  });
}

// =====================================================================================================
// TAB 3: Physical Counts
// =====================================================================================================
function countTab(host, user, S, redraw) {
  const cs = store.all('kitCounts').slice().sort((a, b) => b.at.localeCompare(a.at));
  host.innerHTML = `<div class="ls-count-head"><div>${icon('clipboard-check')}<div><b>Physical stock counts</b><span>Count what is physically on your bench and in the fridge. System quantities stay hidden until you submit to keep counts unbiased.</span></div></div>${canRunLab(user) ? `<button class="btn btn-primary" data-start>${icon('clipboard-check')}Start new count</button>` : ''}</div>
    ${cs.length ? `<div class="ls-counts">${cs.map((c) => { const short = c.lines.filter((l) => l.diff < 0); const over = c.lines.filter((l) => l.diff > 0); return `<article class="ls-countcard ${short.length ? 'bad' : 'good'}">
      <header><span class="ls-count-ic">${icon(short.length ? 'clipboard-x' : 'clipboard-check')}</span><div class="grow"><b>${c.id} · ${fmtDate(c.businessDate)}</b><small class="muted">${c.lines.length} items counted by ${esc(userName(c.countedBy))} · ${fmtDateTime(c.at)}</small></div>
        ${c.status === 'SUBMITTED' ? '<span class="ls-state ls-s-danger"><i></i>Shortage — needs review</span>' : c.status === 'REVIEWED' ? '<span class="ls-state ls-s-info"><i></i>Reviewed</span>' : '<span class="ls-state ls-s-success"><i></i>All matched</span>'}
        ${c.status === 'SUBMITTED' && can('credit.approve', user) ? `<button class="btn btn-secondary btn-sm" data-review="${c.id}">Review</button>` : ''}</header>
      ${short.length || over.length ? `<ul class="ls-difflist">${[...short, ...over].map((l) => `<li><span>${esc(item(l.kitId)?.name)}</span><span class="muted">expected ${l.system} · counted ${l.counted}</span><b class="${l.diff < 0 ? 'text-danger' : 'text-success'}">${l.diff > 0 ? '+' : ''}${l.diff}</b></li>`).join('')}</ul>` : ''}
      ${c.reviewNote ? `<p class="ls-note">${icon('message-square')}<span><b>${esc(userName(c.reviewedBy))}:</b> ${esc(c.reviewNote)}</span></p>` : ''}</article>`; }).join('')}</div>` : emptyState('clipboard-check', 'No physical counts recorded yet')}`;
  host.querySelector('[data-start]')?.addEventListener('click', () => countDialog(user, redraw));
  host.querySelectorAll('[data-review]').forEach((b) => { b.onclick = async () => { const r = await confirmDialog({ title: 'Review count shortage', reason: true, reasonLabel: 'Findings / note', confirmLabel: 'Mark reviewed', message: 'Note down why stock was short (e.g. unlogged repeats, damaged box).' }); if (!r) return; try { reviewCount(b.dataset.review, r.reason, user); toast('Marked reviewed.'); redraw(); } catch (e) { toast(e.message, 'error'); } }; });
}

function countDialog(user, done) {
  const groups = Object.entries(KINDS).map(([kk, kd]) => [kd, items().filter((k) => k.kind === kk)]).filter(([, ks]) => ks.length);
  openModal({
    title: 'New physical stock count',
    subtitle: 'Enter total units physically present (sealed packs × pack size + loose units). Leave blank to skip.',
    size: 'lg',
    body: `<div class="ls-countform">${groups.map(([kd, ks]) => `<fieldset><legend>${icon(kd.icon)}${kd.label}</legend>${ks.map((k) => `<label class="ls-countrow"><span>${esc(k.name)}<small class="muted">${esc(packInfo(k))}</small></span><span class="ls-countin"><input class="input" type="number" min="0" data-c="${k.id}" placeholder="—"><em>${esc(k.unit)}s</em></span></label>`).join('')}</fieldset>`).join('')}</div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, {
      label: 'Submit count', cls: 'btn-primary', icon: icon('check'),
      onClick: (c, w) => {
        try {
          const res = submitCount(Object.fromEntries([...w.querySelectorAll('[data-c]')].map((i) => [i.dataset.c, i.value])), user);
          c(); const short = res.lines.filter((l) => l.diff < 0);
          toast(short.length ? `${short.length} item(s) short — owner notified and stock adjusted.` : 'All counted items match system stock.', short.length ? 'warning' : 'success');
          done?.();
        } catch (e) { toast(e.message, 'error'); }
      }
    }]
  });
}

// =====================================================================================================
// TAB 4: Usage Log
// =====================================================================================================
function historyTab(host, user, S) {
  const allRows = store.all('kitMovements').filter((m) => (m.loc || 'LAB') === 'LAB').slice();
  const FILTERS = [
    ['ALL', 'All activity', () => true],
    ['USED_TEST', 'Patient tests', (m) => m.type === 'USED_TEST'],
    ['QC', 'QC & Repeats', (m) => ['USED_QC', 'REPEAT'].includes(m.type)],
    ['ISSUE_IN', 'Store deliveries', (m) => m.type === 'ISSUE_IN'],
    ['WASTE', 'Wastage & Expiry', (m) => ['WASTAGE', 'EXPIRED', 'COUNT_ADJUST'].includes(m.type)]
  ];
  const activeFn = FILTERS.find((f) => f[0] === S.mvFilter)?.[2] || (() => true);
  const rows = allRows.filter(activeFn);

  host.innerHTML = `
    <div class="ls-toolbar">
      <div class="ls-chips">${FILTERS.map(([k, l, fn]) => `<button class="ls-chip ${S.mvFilter === k ? 'on' : ''}" data-mvf="${k}">${l}<span>${allRows.filter(fn).length}</span></button>`).join('')}</div>
    </div>
    <div data-t></div>`;

  const t = dataTable({
    rows, pageSize: 25, sort: { key: 'at', dir: 'desc' },
    columns: [
      { key: 'at', label: 'When', render: (m) => `${fmtDateTime(m.at)}` },
      { key: 'item', label: 'Item', value: (m) => item(m.kitId)?.name, render: (m) => `<div class="ls-cell">${kindIcon(item(m.kitId), 'sm')}<span>${esc(item(m.kitId)?.name)}</span></div>` },
      { key: 'type', label: 'Activity', value: (m) => MOVE[m.type]?.label, render: (m) => `<span class="tag tag-${MOVE[m.type]?.tone || 'neutral'}">${esc(MOVE[m.type]?.label || m.type)}</span>` },
      { key: 'qty', label: 'Qty', align: 'right', render: (m) => `<b class="${m.qty > 0 ? 'text-success' : ''}">${m.qty > 0 ? '+' : ''}${m.qty}</b>` },
      { key: 'lot', label: 'Lot', value: (m) => lot(m.lotId)?.lot || '', render: (m) => (m.lotId ? lotChip(lot(m.lotId)) : '<span class="muted">—</span>') },
      { key: 'ref', label: 'Ref', render: (m) => `<span class="mono small">${esc(m.ref)}</span>` },
      { key: 'note', label: 'Note', render: (m) => `<span class="small">${esc(m.note || '')}</span>` },
      { key: 'by', label: 'By', value: (m) => userName(m.by) }
    ]
  });
  host.querySelector('[data-t]').appendChild(t.el);
  host.querySelectorAll('[data-mvf]').forEach((b) => { b.onclick = () => { S.mvFilter = b.dataset.mvf; historyTab(host, user, S); refreshIcons(host); }; });
}

// =====================================================================================================
// TAB 5 & 6: Manage Items & Used vs Billed (Admin / Owner)
// =====================================================================================================
function itemsTab(host, user, S, redraw) {
  const ks = items({ all: true });
  host.innerHTML = `<div class="ls-count-head"><div>${icon('settings-2')}<div><b>Lab item catalogue</b><span>Configure reagents, pack sizes, storage conditions and reorder triggers. Test links are set in <a href="#/lab/tests">Test Master</a>.</span></div></div><button class="btn btn-primary" data-add>${icon('plus')}Add item</button></div>
    <div class="table-scroll"><table class="table"><thead><tr><th>Item</th><th>Pack</th><th>Storage</th><th class="ta-right">Reorder at</th><th class="ta-right">Target keep</th><th class="ta-right">Store min</th><th>Opened life</th><th>Linked tests</th><th></th></tr></thead><tbody>
    ${ks.map((k) => `<tr class="${k.active === false ? 'muted' : ''}"><td><div class="ls-cell">${kindIcon(k, 'sm')}<div><strong>${esc(k.name)}</strong><small class="muted">${esc(KINDS[k.kind]?.one)}${k.active === false ? ' · inactive' : ''}</small></div></div></td><td>${esc(packInfo(k))}</td><td>${esc(STORAGE[k.storage])}</td>
      <td class="ta-right">${k.reorderLevel}</td><td class="ta-right">${k.parLevel}</td><td class="ta-right">${k.storeMin}</td><td>${k.openDays ? k.openDays + ' days' : '—'}</td><td class="small">${testsUsing(k.id).map((t) => esc(t.code)).join(', ') || (k.container ? 'Every ' + esc(k.container) + ' tube' : '—')}</td>
      <td><button class="btn btn-ghost btn-sm" data-edit="${k.id}">${icon('pencil')}Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  host.querySelector('[data-add]').onclick = () => itemEditor(null, user, redraw);
  host.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => itemEditor(b.dataset.edit, user, redraw); });
}

function itemEditor(id, user, done) {
  const k = id ? item(id) : null; const d = k ? { ...k, openDays: k.openDays ?? '', unitCost: k.unitCost ?? '' } : blankItem();
  const opt = (obj, v) => Object.entries(obj).map(([key, x]) => `<option value="${key}" ${key === v ? 'selected' : ''}>${esc(x.label || x)}</option>`).join('');
  const conts = store.hs().lab.containers;
  openModal({
    title: k ? `Edit ${k.name}` : 'Add lab item', size: 'lg',
    body: `<div class="form-grid">
      <div class="field col-8"><label>Name <span class="req">*</span></label><input class="input" data-f="name" value="${esc(d.name)}" placeholder="e.g. Malaria Pf/Pv rapid card"></div>
      <div class="field col-4"><label>Kind</label><select class="input" data-f="kind">${opt(KINDS, d.kind)}</select></div>
      <div class="field col-3"><label>Unit</label><input class="input" data-f="unit" value="${esc(d.unit)}" placeholder="card / test / strip"></div>
      <div class="field col-3"><label>Pack label</label><input class="input" data-f="packLabel" value="${esc(d.packLabel)}" placeholder="box / pack / kit"></div>
      <div class="field col-3"><label>Units per pack</label><input class="input" type="number" min="1" data-f="packSize" value="${esc(d.packSize)}"></div>
      <div class="field col-3"><label>Storage</label><select class="input" data-f="storage">${opt(STORAGE, d.storage)}</select></div>
      <div class="field col-3"><label>Reorder at (lab)</label><input class="input" type="number" min="0" data-f="reorderLevel" value="${esc(d.reorderLevel)}"><small class="muted">units in lab</small></div>
      <div class="field col-3"><label>Target keep (lab)</label><input class="input" type="number" min="1" data-f="parLevel" value="${esc(d.parLevel)}"><small class="muted">fills up to this</small></div>
      <div class="field col-3"><label>Store reorder at</label><input class="input" type="number" min="0" data-f="storeMin" value="${esc(d.storeMin)}"><small class="muted">units in store</small></div>
      <div class="field col-3"><label>Opened stability</label><input class="input" type="number" min="1" data-f="openDays" value="${esc(d.openDays)}" placeholder="days, if any"></div>
      <div class="field col-4"><label>Usual supplier</label><input class="input" data-f="supplier" value="${esc(d.supplier || '')}"></div>
      <div class="field col-4"><label>Cost per unit (₹)</label><input class="input" type="number" min="0" step="0.01" data-f="unitCost" value="${esc(d.unitCost)}"></div>
      <div class="field col-4" data-contf><label>Tube type (1 per tube)</label><select class="input" data-f="container"><option value="">—</option>${Object.entries(conts).map(([c, x]) => `<option value="${c}" ${c === d.container ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
      ${k ? `<div class="field col-12"><label class="checkbox"><input type="checkbox" data-f="active" ${d.active !== false ? 'checked' : ''}> Active in lab catalogue</label></div>` : ''}
    </div><div class="tm-err hidden mt-2" data-err></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, {
      label: k ? 'Save changes' : 'Add item', cls: 'btn-primary', icon: icon('check'),
      onClick: (c, w) => {
        const v = {}; w.querySelectorAll('[data-f]').forEach((i) => { v[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value; });
        const errs = validateItem(v, id); const el = w.querySelector('[data-err]');
        if (errs.length) { el.innerHTML = errs.map((x) => `<div>${icon('alert-circle')}${esc(x)}</div>`).join(''); el.classList.remove('hidden'); refreshIcons(el); return; }
        try { saveItem(v, user, id); c(); toast(k ? 'Item updated.' : 'Item added.'); done?.(); } catch (e) { toast(e.message, 'error'); }
      }
    }],
    onOpen: (w) => { const sync = () => w.querySelector('[data-contf]').classList.toggle('hidden', w.querySelector('[data-f=kind]').value !== 'CONSUMABLE'); w.querySelector('[data-f=kind]').onchange = sync; sync(); }
  });
}

function reconTab(host, user, S, redraw) {
  S.from ||= ymd(new Date(Date.now() - 6 * 86400000)); S.to ||= ymd();
  const rec = kitReconciliation(S.from, S.to);
  host.innerHTML = `<div class="toolbar"><label class="small">From <input type="date" class="input" data-from value="${S.from}"></label><label class="small">To <input type="date" class="input" data-to value="${S.to}"></label><button class="btn btn-secondary btn-sm" data-csv>${icon('download')}CSV</button></div>
    <div class="table-scroll"><table class="table"><thead><tr><th>Item</th><th class="ta-right">Billed</th><th class="ta-right">Run</th><th class="ta-right">Used</th><th class="ta-right">QC</th><th class="ta-right">Repeats</th><th class="ta-right">Waste / Exp</th><th class="ta-right">Shortage</th><th class="ta-right">Unmatched</th><th class="ta-right">Efficiency</th></tr></thead><tbody>
    ${rec.map((r) => `<tr class="${r.unexplained > 0 || r.countLoss > 0 ? 'row-danger' : ''}"><td><strong>${esc(r.kit.name)}</strong><div class="cell-sub">${esc(r.tests)}</div></td><td class="ta-right">${r.billed}</td><td class="ta-right">${r.performed}</td><td class="ta-right">${r.used}</td><td class="ta-right">${r.qc}</td><td class="ta-right">${r.repeat}</td><td class="ta-right">${r.waste}</td><td class="ta-right ${r.countLoss > 0 ? 'text-danger' : ''}">${r.countLoss}</td><td class="ta-right ${r.unexplained > 0 ? 'text-danger' : ''}"><b>${r.unexplained}</b></td><td class="ta-right">${r.efficiency}%</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small card-pad">Tests run should match units consumed for patient tests. QC, repeats and wastage are logged with reasons; count shortages highlight unbilled usage.</p>`;
  host.querySelector('[data-from]').onchange = (e) => { S.from = e.target.value; reconTab(host, user, S, redraw); refreshIcons(host); };
  host.querySelector('[data-to]').onchange = (e) => { S.to = e.target.value; reconTab(host, user, S, redraw); refreshIcons(host); };
  host.querySelector('[data-csv]').onclick = () => exportTable(`lab-used-vs-billed-${S.from}-${S.to}.csv`, [{ label: 'Item', csv: (r) => r.kit.name }, ...['billed', 'performed', 'used', 'qc', 'repeat', 'waste', 'countLoss', 'unexplained', 'efficiency'].map((k) => ({ label: k, csv: (r) => r[k] }))], rec);
}
