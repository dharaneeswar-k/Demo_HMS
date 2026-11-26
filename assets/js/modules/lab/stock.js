// Lab Stock — the lab incharge's morning screen. What is in the lab, what is running low (with a ready-made request
// to the store), what the store has sent (receive it), what is expiring, and which packs are open on the analyser.
import { store } from '../../data-service.js';
import { currentUser, can } from '../../auth.js';
import { userName } from '../../calculations.js';
import { dataTable, openModal, confirmDialog, tabs, exportTable } from '../../components.js';
import { toast } from '../../notifications.js';
import { esc, fmtNum, fmtDate, fmtDateTime, relTime, refreshIcons, ymd } from '../../utils.js';
import {
  KINDS, STORAGE, MOVE, items, item, lot, labBalance, labState, lotsAt, nextExpiry, daysLeft, unitTxt, packTxt, packInfo, suggestion, labAttention, openPacks,
  daysOfStock, requestStock, cancelRequest, receiveRequest, submitCount, reviewCount, canRunLab, canEditItems, saveItem, validateItem, blankItem, testsUsing, kitReconciliation, pendingFor
} from '../../labstock.js';
import { kindIcon, statePill, coldTag, qtyBlock, levelBar, expiryTxt, lotChip, reqJourney, reqStatus, reqLines, openItem, useDialog } from './stockui.js';
import { icon, emptyState } from './bi.js';

export function renderLabStock(view, params, query) {
  const user = currentUser(); const run = canRunLab(user);
  const S = { tab: query.tab || 'stock', kind: '', q: '', only: query.filter || '', draft: null };
  view.innerHTML = `<div class="ls">
    <div class="ls-hello" data-hello></div>
    <div data-arrive></div>
    <div data-composer></div>
    <section class="card ls-main"><div class="ls-tabs" data-tabs></div><div data-body></div></section></div>`;

  // ---------- summary tiles (click = filter) ----------
  const hello = () => {
    const a = labAttention();
    const tile = (id, ic, tone, n, label, sub) => `<button class="ls-tile ls-t-${n ? tone : 'ok'} ${S.only === id ? 'on' : ''}" data-only="${id}"><span class="ls-tile-ic">${icon(n ? ic : 'check')}</span><span class="ls-tile-n">${n}</span><span class="ls-tile-l">${label}</span><small>${sub}</small></button>`;
    view.querySelector('[data-hello]').innerHTML = `
      ${tile('low', 'trending-down', 'warning', a.low.length, 'Running low / out', a.low.length ? 'Ask the store for more' : 'Everything is stocked')}
      ${tile('way', 'truck', 'info', a.arriving.length + a.waiting.length, 'Requests open', a.arriving.length ? `${a.arriving.length} sent by store — receive` : a.waiting.length ? 'Waiting at the store' : 'None open')}
      ${tile('exp', 'calendar-clock', 'danger', a.expiring.length, 'Expiring ≤ 30 days', a.expiring.length ? 'Use these first' : 'Nothing close to expiry')}
      ${tile('open', 'package-open', 'purple', a.packsDue.length, 'Open packs due', a.packsDue.length ? 'Past or near use-by' : `${openPacks().length} open, all fine`)}`;
    view.querySelectorAll('[data-only]').forEach((b) => { b.onclick = () => { const id = b.dataset.only; if (id === 'way') { S.tab = 'requests'; S.only = ''; } else { S.tab = 'stock'; S.only = S.only === id ? '' : id; } drawAll(); }; });
  };

  // ---------- banner: the store has sent something ----------
  const arrive = () => {
    const rs = store.all('labIndents').filter((r) => r.status === 'ISSUED');
    view.querySelector('[data-arrive]').innerHTML = rs.length && run ? `<div class="ls-arrive">${icon('truck')}<div class="grow"><b>The store has sent ${rs.length === 1 ? 'your request' : rs.length + ' requests'} — ${rs.map((r) => r.id).join(', ')}</b><span>Count the items when they reach the lab, then press Receive. Lab stock goes up only after you receive.</span></div>${rs.map((r) => `<button class="btn btn-primary" data-recv="${r.id}">${icon('package-check')}Receive ${r.id}</button>`).join('')}</div>` : '';
    view.querySelectorAll('[data-recv]').forEach((b) => { b.onclick = () => receiveDialog(b.dataset.recv, user, drawAll); });
  };

  // ---------- the request composer: pre-filled with what is running low ----------
  const composer = () => {
    const host = view.querySelector('[data-composer]');
    if (!run) { host.innerHTML = ''; return; }
    const sug = labAttention().suggest;
    if (!S.draft) S.draft = { lines: [], urgent: sug.some((x) => labBalance(x.k.id) <= 0), note: '', open: false };
    const d = S.draft;
    // keep the suggested lines in step with the stock: drop ones no longer low, add new ones (the user's own lines stay)
    d.lines = d.lines.filter((l) => !l.auto || sug.some((x) => x.k.id === l.kitId));
    sug.filter((x) => !d.lines.some((l) => l.kitId === x.k.id)).forEach((x) => d.lines.push({ kitId: x.k.id, packs: x.s.packs, on: true, auto: true }));
    if (!d.lines.length && !d.open) {
      const low = labAttention().low; const open = [...new Set(low.flatMap((k) => pendingFor(k.id).map((r) => r.id)))];
      host.innerHTML = `<div class="ls-allgood">${icon('badge-check')}<div class="grow"><b>${low.length ? `Everything running low is already asked for${open.length ? ` (${open.join(', ')})` : ''}.` : 'Nothing is running low.'}</b><span>${low.length ? 'Follow it under “Requests to store”. ' : ''}The system suggests a request here the moment something drops to its “ask for more” level.</span></div><button class="btn btn-secondary" data-newreq>${icon('plus')}New request to store</button></div>`;
      host.querySelector('[data-newreq]').onclick = () => { d.open = true; composer(); };
      refreshIcons(host); return;
    }
    const chosen = d.lines.filter((l) => l.on && l.packs > 0);
    host.innerHTML = `<section class="card ls-compose"><header class="ls-compose-head"><span class="ls-compose-ic">${icon('send')}</span><div class="grow"><h2>${d.lines.some((l) => l.auto) ? 'Running low — ask the store' : 'New request to the store'}</h2><p>${d.lines.some((l) => l.auto) ? 'The system worked out how much brings each item back to its “keep in lab” level. Change the numbers if you need to.' : 'Add the items you need and how many packs.'}</p></div></header>
      <div class="ls-lines">${d.lines.map((l, i) => { const k = item(l.kitId); const bal = labBalance(k.id); const pend = pendingFor(k.id);
        return `<div class="ls-line ${l.on ? '' : 'off'}" data-i="${i}"><label class="ls-check"><input type="checkbox" ${l.on ? 'checked' : ''} data-on></label>${kindIcon(k)}
          <div class="ls-line-name"><b>${esc(k.name)}</b><small><span class="${bal <= 0 ? 'text-danger' : bal <= k.reorderLevel ? 'text-warning' : ''}">${bal <= 0 ? 'None left' : `Only ${unitTxt(k, bal)} left`}</span> · keep ${k.parLevel} · ${esc(packInfo(k))}${pend.length ? ` · <span class="text-info">${pend.map((r) => r.id).join(', ')} already open</span>` : ''}</small></div>
          <div class="ls-step"><button class="icon-btn" data-dec aria-label="Fewer">${icon('minus')}</button><input class="input" type="number" min="1" value="${l.packs}" data-packs aria-label="Packs"><button class="icon-btn" data-inc aria-label="More">${icon('plus')}</button></div>
          <div class="ls-line-eq"><b>${packTxt(k, l.packs)}</b><small>= ${unitTxt(k, l.packs * k.packSize)}</small></div>
          ${l.auto ? '' : `<button class="icon-btn" data-del title="Remove">${icon('x')}</button>`}</div>`; }).join('')}</div>
      <div class="ls-compose-add"><select class="input" data-add><option value="">+ Add another item…</option>${Object.entries(KINDS).map(([kk, kd]) => `<optgroup label="${kd.label}">${items().filter((k) => k.kind === kk && !d.lines.some((l) => l.kitId === k.id)).map((k) => `<option value="${k.id}">${esc(k.name)} (${labBalance(k.id)} in lab)</option>`).join('')}</optgroup>`).join('')}</select></div>
      <footer class="ls-compose-foot"><label class="ls-urgent"><input type="checkbox" data-urgent ${d.urgent ? 'checked' : ''}><span>${icon('zap')}Urgent</span></label><input class="input grow" data-note placeholder="Note for the store (optional)" value="${esc(d.note)}">
        ${d.lines.some((l) => l.auto) ? '' : '<button class="btn btn-ghost" data-close>Close</button>'}<button class="btn btn-primary btn-lg" data-send ${chosen.length ? '' : 'disabled'}>${icon('send')}Send request${chosen.length ? ` · ${chosen.length} item${chosen.length > 1 ? 's' : ''}` : ''}</button></footer></section>`;
    host.querySelectorAll('.ls-line').forEach((row) => { const l = d.lines[+row.dataset.i];
      row.querySelector('[data-on]').onchange = (e) => { l.on = e.target.checked; composer(); };
      row.querySelector('[data-packs]').onchange = (e) => { l.packs = Math.max(1, Math.floor(+e.target.value || 1)); composer(); };
      row.querySelector('[data-inc]').onclick = () => { l.packs++; l.on = true; composer(); };
      row.querySelector('[data-dec]').onclick = () => { l.packs = Math.max(1, l.packs - 1); composer(); };
      row.querySelector('[data-del]')?.addEventListener('click', () => { d.lines.splice(+row.dataset.i, 1); composer(); }); });
    host.querySelector('[data-add]').onchange = (e) => { if (!e.target.value) return; const k = item(e.target.value); d.lines.push({ kitId: k.id, packs: suggestion(k)?.packs || 1, on: true, auto: false }); d.open = true; composer(); };
    host.querySelector('[data-urgent]').onchange = (e) => { d.urgent = e.target.checked; };
    host.querySelector('[data-note]').oninput = (e) => { d.note = e.target.value; };
    host.querySelector('[data-close]')?.addEventListener('click', () => { S.draft = { lines: [], urgent: false, note: '', open: false }; composer(); });
    host.querySelector('[data-send]').onclick = () => {
      try { const r = requestStock({ lines: chosen.map((l) => ({ kitId: l.kitId, packs: l.packs })), urgent: d.urgent, note: d.note }, user); S.draft = null; toast(`Request ${r.id} sent to the store.`, 'success', 'Request sent'); drawAll(); }
      catch (e) { toast(e.message, 'error'); }
    };
    refreshIcons(host);
  };
  const requestOne = (kitId) => { const d = S.draft || (S.draft = { lines: [], urgent: false, note: '', open: true }); const ex = d.lines.find((l) => l.kitId === kitId); if (ex) ex.on = true; else d.lines.push({ kitId, packs: suggestion(item(kitId))?.packs || 1, on: true, auto: false }); d.open = true; composer(); view.querySelector('[data-composer]').scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  // ---------- tabs ----------
  const body = view.querySelector('[data-body]');
  const drawTabs = () => {
    const open = store.all('labIndents').filter((r) => ['REQUESTED', 'ISSUED'].includes(r.status)).length;
    const pendingCounts = store.all('kitCounts').filter((c) => c.status === 'SUBMITTED').length;
    tabs(view.querySelector('[data-tabs]'), [{ id: 'stock', label: 'Stock in lab', icon: icon('boxes') }, { id: 'requests', label: 'Requests to store', icon: icon('send'), count: open || null }, { id: 'count', label: 'Counts', icon: icon('clipboard-check'), count: pendingCounts || null },
      { id: 'history', label: 'History', icon: icon('history') }, ...(canEditItems(user) ? [{ id: 'items', label: 'Item list', icon: icon('settings-2') }] : []), ...(can('management.view', user) ? [{ id: 'recon', label: 'Used vs billed', icon: icon('scale') }] : [])], S.tab, (t) => { S.tab = t; S.only = ''; drawBody(); });
  };
  const drawBody = () => {
    ({ stock: stockTab, requests: requestsTab, count: countTab, history: historyTab, items: itemsTab, recon: reconTab })[S.tab]?.(body, user, S, drawAll, requestOne);
    refreshIcons(body);
  };
  const drawAll = () => { hello(); arrive(); composer(); drawTabs(); drawBody(); refreshIcons(view); };
  drawAll();
  if (query.item && item(query.item)) openItem(query.item, user, { onChange: drawAll, onRequest: requestOne });
}

// ================= Stock tab =================
function stockTab(host, user, S, redraw, requestOne) {
  const a = labAttention();
  const filterIds = S.only === 'low' ? new Set(a.low.map((k) => k.id)) : S.only === 'exp' ? new Set(a.expiring.map((x) => x.k.id)) : S.only === 'open' ? new Set(a.packsDue.map((p) => p.kitId)) : null;
  const all = items();
  const rows = all.filter((k) => (!S.kind || k.kind === S.kind) && (!filterIds || filterIds.has(k.id)) && (!S.q || k.name.toLowerCase().includes(S.q.toLowerCase())))
    .sort((x, y) => ({ OUT: 0, LOW: 1, OK: 2 }[labState(x)] - { OUT: 0, LOW: 1, OK: 2 }[labState(y)]) || x.name.localeCompare(y.name));
  const chips = [['', 'All', all.length], ...Object.entries(KINDS).map(([k, d]) => [k, d.label, all.filter((x) => x.kind === k).length]).filter((x) => x[2])];
  host.innerHTML = `<div class="ls-toolbar"><div class="ls-chips">${chips.map(([k, l, n]) => `<button class="ls-chip ${S.kind === k ? 'on' : ''}" data-kind="${k}">${k ? icon(KINDS[k].icon) : ''}${l}<span>${n}</span></button>`).join('')}</div>
      <div class="ls-search">${icon('search')}<input class="input" placeholder="Find an item…" data-q value="${esc(S.q)}"></div></div>
    ${S.only ? `<div class="ls-filtered">${icon('filter')}Showing only: <b>${{ low: 'running low / out', exp: 'expiring within 30 days', open: 'open packs due' }[S.only]}</b><button class="btn btn-ghost btn-sm" data-clear>Show all</button></div>` : ''}
    ${rows.length ? `<div class="ls-list">${rows.map((k) => row(k)).join('')}</div>` : emptyState('package-search', 'Nothing matches', 'Try another filter or search.')}
    <p class="ls-legend muted small">${icon('info')}Stock goes down by itself when a sample is collected for a billed test. Record QC runs, repeats and wastage with “Record use”. The bar shows stock against the “keep in lab” level; the tick is where you should ask for more.</p>`;
  host.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => { S.kind = b.dataset.kind; stockTab(host, user, S, redraw, requestOne); refreshIcons(host); }; });
  const qi = host.querySelector('[data-q]'); qi.oninput = () => { S.q = qi.value; const pos = qi.selectionStart; stockTab(host, user, S, redraw, requestOne); refreshIcons(host); const n = host.querySelector('[data-q]'); n.focus(); n.setSelectionRange(pos, pos); };
  host.querySelector('[data-clear]')?.addEventListener('click', () => { S.only = ''; redraw(); });
  host.querySelectorAll('[data-item]').forEach((r) => { r.onclick = (e) => { if (e.target.closest('[data-req],[data-use]')) return; openItem(r.dataset.item, user, { onChange: redraw, onRequest: requestOne }); }; });
  host.querySelectorAll('[data-req]').forEach((b) => { b.onclick = () => requestOne(b.dataset.req); });
  host.querySelectorAll('[data-use]').forEach((b) => { b.onclick = () => useDialog(b.dataset.use, user, redraw); });

  function row(k) {
    const bal = labBalance(k.id); const st = labState(k); const ne = nextExpiry(k.id, 'LAB'); const op = openPacks(k.id)[0]; const dos = daysOfStock(k); const pend = pendingFor(k.id);
    return `<div class="ls-row ls-r-${st.toLowerCase()}" data-item="${k.id}" tabindex="0" role="button" aria-label="${esc(k.name)}">
      ${kindIcon(k)}
      <div class="ls-name"><b>${esc(k.name)}</b><small>${esc(packInfo(k))} ${coldTag(k)}</small></div>
      <div class="ls-level">${qtyBlock(k, bal)}${levelBar(k, bal)}<small class="muted">keep ${k.parLevel} · ask at ${k.reorderLevel}</small></div>
      <div class="ls-status">${statePill(st)}<small class="muted">${dos == null ? '' : dos <= 0 ? 'Used up' : `Lasts ~${dos} day${dos === 1 ? '' : 's'}`}</small>${pend.length ? `<small class="text-info">${icon(pend[0].status === 'ISSUED' ? 'truck' : 'hourglass')}${pend[0].status === 'ISSUED' ? 'On the way' : 'Asked'} · ${pend[0].id}</small>` : ''}</div>
      <div class="ls-when">${ne ? `${lotChip(ne)}${expiryTxt(ne, { short: true })}` : '<span class="muted small">—</span>'}${op ? `<small class="${daysLeft(op.useBy) < 0 ? 'text-danger' : daysLeft(op.useBy) <= 2 ? 'text-warning' : 'muted'}">${icon('package-open')}${daysLeft(op.useBy) < 0 ? 'Open pack past use-by' : `Open · use by ${fmtDate(op.useBy)}`}</small>` : k.openDays ? `<small class="muted">${icon('package')}No pack open</small>` : ''}</div>
      <div class="ls-acts">${canRunLab(user) ? `${st !== 'OK' && !pend.length ? `<button class="btn btn-primary btn-sm" data-req="${k.id}">${icon('send')}Request</button>` : ''}${bal > 0 ? `<button class="btn btn-ghost btn-sm" data-use="${k.id}" title="Record QC / repeat / wastage">${icon('minus-circle')}Use</button>` : ''}` : ''}${icon('chevron-right', 'ls-chev')}</div>
    </div>`;
  }
}

// ================= Requests tab =================
function requestsTab(host, user, S, redraw) {
  const rank = (r) => ({ ISSUED: 0, REQUESTED: 1 }[r.status] ?? 2);
  const rs = store.all('labIndents').slice().sort((a, b) => rank(a) - rank(b) || b.at.localeCompare(a.at));
  host.innerHTML = rs.length ? `<div class="ls-reqs">${rs.map((r) => `<article class="ls-req ls-req-${r.status.toLowerCase()}">
      <header><div><h3>${esc(r.id)} ${r.urgent ? `<span class="ls-urg">${icon('zap')}Urgent</span>` : ''}</h3><small class="muted">${r.lines.length} item${r.lines.length > 1 ? 's' : ''} · asked ${relTime(r.at)}</small></div>${reqStatus(r)}
        <div class="ls-req-acts">${canRunLab(user) && r.status === 'ISSUED' ? `<button class="btn btn-primary btn-sm" data-recv="${r.id}">${icon('package-check')}Receive</button>` : ''}${canRunLab(user) && r.status === 'REQUESTED' ? `<button class="btn btn-ghost btn-sm" data-cancel="${r.id}">Cancel request</button>` : ''}</div></header>
      ${reqJourney(r)}${reqLines(r)}</article>`).join('')}</div>`
    : emptyState('send', 'No requests yet', 'When something runs low, the request appears at the top of this page — one tap sends it to the store.');
  host.querySelectorAll('[data-recv]').forEach((b) => { b.onclick = () => receiveDialog(b.dataset.recv, user, redraw); });
  host.querySelectorAll('[data-cancel]').forEach((b) => { b.onclick = async () => { const ok = await confirmDialog({ title: `Cancel ${b.dataset.cancel}?`, tone: 'danger', iconName: icon('ban'), confirmLabel: 'Cancel request', message: 'The store will no longer see this request.' }); if (!ok) return; try { cancelRequest(b.dataset.cancel, user); toast('Request cancelled.'); redraw(); } catch (e) { toast(e.message, 'error'); } }; });
}

/** The lab checks what physically arrived against what the store sent. */
export function receiveDialog(id, user, done) {
  const r = store.get('labIndents', id);
  openModal({ title: `Receive ${id} from the store`, subtitle: `Sent by ${esc(userName(r.issue.by))} ${relTime(r.issue.at)}. Count each item; if something is missing, change the number.`, size: 'lg',
    body: `<table class="table ls-recv"><thead><tr><th>Item</th><th>Lot · expiry</th><th class="ta-right">Sent</th><th style="width:170px" class="ta-right">Arrived</th></tr></thead><tbody>
      ${r.issue.lines.map((x, i) => { const k = item(x.kitId); return `<tr data-row="${i}"><td><div class="ls-cell">${kindIcon(k, 'sm')}<div><strong>${esc(k.name)}</strong><small class="muted">${coldTag(k)}${k.storage === 'COLD' ? ' Put in the fridge at once' : ''}</small></div></div></td><td>${lotChip(lot(x.lotId))}<div>${expiryTxt(lot(x.lotId))}</div></td>
        <td class="ta-right"><b>${unitTxt(k, x.qty)}</b>${k.packSize > 1 ? `<div class="muted small">${packTxt(k, x.qty / k.packSize)}</div>` : ''}</td><td class="ta-right"><div class="ls-arrived"><input class="input" type="number" min="0" max="${x.qty}" value="${x.qty}" data-got="${i}"><span>${esc(k.unit)}s</span></div><small class="ls-diff" data-diff="${i}"></small></td></tr>`; }).join('')}
      </tbody></table>${r.issue.note ? `<p class="ls-note">${icon('warehouse')}<span><b>Store note:</b> ${esc(r.issue.note)}</span></p>` : ''}
      <div class="field mt-2 hidden" data-shortf><label>What happened to the missing items? <span class="req">*</span></label><input class="input" data-note placeholder="e.g. Box had 20 cards, not 25 — told the store"></div>`,
    footer: [{ label: 'Not now', onClick: (c) => c() }, { label: 'Confirm received', cls: 'btn-primary', icon: icon('package-check'), onClick: (c, w) => {
      const got = Object.fromEntries([...w.querySelectorAll('[data-got]')].map((i) => [i.dataset.got, i.value]));
      try { const res = receiveRequest(id, got, user, w.querySelector('[data-note]').value); c(); toast(res.status === 'SHORT' ? 'Received. The shortage was reported to the owner and the store.' : 'Received — lab stock updated.', res.status === 'SHORT' ? 'warning' : 'success'); done?.(); } catch (e) { toast(e.message, 'error'); }
    } }],
    onOpen: (w) => { const upd = () => { let short = false; w.querySelectorAll('[data-got]').forEach((i) => { const sent = r.issue.lines[+i.dataset.got].qty; const d = sent - (+i.value || 0); const el = w.querySelector(`[data-diff="${i.dataset.got}"]`); el.textContent = d > 0 ? `${d} short` : d < 0 ? 'More than sent?' : ''; el.className = 'ls-diff ' + (d ? 'text-danger' : ''); if (d > 0) short = true; }); w.querySelector('[data-shortf]').classList.toggle('hidden', !short); }; w.querySelectorAll('[data-got]').forEach((i) => { i.oninput = upd; }); }
  });
}

// ================= Counts tab =================
function countTab(host, user, S, redraw) {
  const cs = store.all('kitCounts').slice().sort((a, b) => b.at.localeCompare(a.at));
  host.innerHTML = `<div class="ls-count-head"><div>${icon('clipboard-check')}<div><b>Physical count</b><span>Count what is really on the shelf and in the fridge. You will not see the system number until you submit — so the count is honest. Any shortage is reported to the owner.</span></div></div>${canRunLab(user) ? `<button class="btn btn-primary" data-start>${icon('clipboard-check')}Start a count</button>` : ''}</div>
    ${cs.length ? `<div class="ls-counts">${cs.map((c) => { const short = c.lines.filter((l) => l.diff < 0); const over = c.lines.filter((l) => l.diff > 0); return `<article class="ls-countcard ${short.length ? 'bad' : 'good'}">
      <header><span class="ls-count-ic">${icon(short.length ? 'clipboard-x' : 'clipboard-check')}</span><div class="grow"><b>${c.id} · ${fmtDate(c.businessDate)}</b><small class="muted">${c.lines.length} items counted by ${esc(userName(c.countedBy))} · ${fmtDateTime(c.at)}</small></div>
        ${c.status === 'SUBMITTED' ? '<span class="ls-state ls-s-danger"><i></i>Shortage — owner to review</span>' : c.status === 'REVIEWED' ? '<span class="ls-state ls-s-info"><i></i>Reviewed</span>' : '<span class="ls-state ls-s-success"><i></i>All matched</span>'}
        ${c.status === 'SUBMITTED' && can('credit.approve', user) ? `<button class="btn btn-secondary btn-sm" data-review="${c.id}">Review</button>` : ''}</header>
      ${short.length || over.length ? `<ul class="ls-difflist">${[...short, ...over].map((l) => `<li><span>${esc(item(l.kitId)?.name)}</span><span class="muted">system ${l.system} · counted ${l.counted}</span><b class="${l.diff < 0 ? 'text-danger' : 'text-success'}">${l.diff > 0 ? '+' : ''}${l.diff}</b></li>`).join('')}</ul>` : ''}
      ${c.reviewNote ? `<p class="ls-note">${icon('message-square')}<span><b>${esc(userName(c.reviewedBy))}:</b> ${esc(c.reviewNote)}</span></p>` : ''}</article>`; }).join('')}</div>` : emptyState('clipboard-check', 'No counts yet')}`;
  host.querySelector('[data-start]')?.addEventListener('click', () => countDialog(user, redraw));
  host.querySelectorAll('[data-review]').forEach((b) => { b.onclick = async () => { const r = await confirmDialog({ title: 'Review count shortage', reason: true, reasonLabel: 'What did you find?', confirmLabel: 'Mark reviewed', message: 'Write the explanation (e.g. repeats not logged, breakage) or the action taken.' }); if (!r) return; try { reviewCount(b.dataset.review, r.reason, user); toast('Reviewed.'); redraw(); } catch (e) { toast(e.message, 'error'); } }; });
}
function countDialog(user, done) {
  const groups = Object.entries(KINDS).map(([kk, kd]) => [kd, items().filter((k) => k.kind === kk)]).filter(([, ks]) => ks.length);
  openModal({ title: 'Count lab stock', subtitle: 'Count sealed packs × pack size + loose units. Leave an item empty to skip it.', size: 'lg',
    body: `<div class="ls-countform">${groups.map(([kd, ks]) => `<fieldset><legend>${icon(kd.icon)}${kd.label}</legend>${ks.map((k) => `<label class="ls-countrow"><span>${esc(k.name)}<small class="muted">${esc(packInfo(k))}</small></span><span class="ls-countin"><input class="input" type="number" min="0" data-c="${k.id}" placeholder="—"><em>${esc(k.unit)}s</em></span></label>`).join('')}</fieldset>`).join('')}</div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Submit count', cls: 'btn-primary', icon: icon('check'), onClick: (c, w) => {
      try { const res = submitCount(Object.fromEntries([...w.querySelectorAll('[data-c]')].map((i) => [i.dataset.c, i.value])), user); c(); const short = res.lines.filter((l) => l.diff < 0);
        toast(short.length ? `${short.length} item(s) short — the owner has been told. Stock corrected to your count.` : 'Count matches the system.', short.length ? 'warning' : 'success'); done?.(); } catch (e) { toast(e.message, 'error'); }
    } }] });
}

// ================= History tab =================
function historyTab(host) {
  const rows = store.all('kitMovements').filter((m) => (m.loc || 'LAB') === 'LAB').slice();
  host.innerHTML = '<div data-t></div>';
  const t = dataTable({ rows, pageSize: 25, sort: { key: 'at', dir: 'desc' }, columns: [
    { key: 'at', label: 'When', render: (m) => `${fmtDateTime(m.at)}` },
    { key: 'item', label: 'Item', value: (m) => item(m.kitId)?.name, render: (m) => `<div class="ls-cell">${kindIcon(item(m.kitId), 'sm')}<span>${esc(item(m.kitId)?.name)}</span></div>` },
    { key: 'type', label: 'What', value: (m) => MOVE[m.type]?.label, render: (m) => `<span class="tag tag-${MOVE[m.type]?.tone || 'neutral'}">${esc(MOVE[m.type]?.label || m.type)}</span>` },
    { key: 'qty', label: 'Qty', align: 'right', render: (m) => `<b class="${m.qty > 0 ? 'text-success' : ''}">${m.qty > 0 ? '+' : ''}${m.qty}</b>` },
    { key: 'lot', label: 'Lot', value: (m) => lot(m.lotId)?.lot || '', render: (m) => (m.lotId ? lotChip(lot(m.lotId)) : '<span class="muted">—</span>') },
    { key: 'ref', label: 'Reference', render: (m) => `<span class="mono small">${esc(m.ref)}</span>` },
    { key: 'note', label: 'Note', render: (m) => `<span class="small">${esc(m.note || '')}</span>` },
    { key: 'by', label: 'By', value: (m) => userName(m.by) }] });
  host.querySelector('[data-t]').appendChild(t.el);
}

// ================= Item list (Admin / Super Admin) =================
function itemsTab(host, user, S, redraw) {
  const ks = items({ all: true });
  host.innerHTML = `<div class="ls-count-head"><div>${icon('settings-2')}<div><b>Lab item list</b><span>Every reagent, cartridge, card, strip, QC control and tube the lab stocks. Pack size, how it is stored, and the levels that trigger a request. Which test uses which item is set in the <a href="#/lab/tests">Test Master</a>.</span></div></div><button class="btn btn-primary" data-add>${icon('plus')}Add item</button></div>
    <div class="table-scroll"><table class="table"><thead><tr><th>Item</th><th>Pack</th><th>Stored</th><th class="ta-right">Ask at</th><th class="ta-right">Keep in lab</th><th class="ta-right">Store reorder</th><th>Opened life</th><th>Used by</th><th></th></tr></thead><tbody>
    ${ks.map((k) => `<tr class="${k.active === false ? 'muted' : ''}"><td><div class="ls-cell">${kindIcon(k, 'sm')}<div><strong>${esc(k.name)}</strong><small class="muted">${esc(KINDS[k.kind]?.one)}${k.active === false ? ' · not in use' : ''}</small></div></div></td><td>${esc(packInfo(k))}</td><td>${esc(STORAGE[k.storage])}</td>
      <td class="ta-right">${k.reorderLevel}</td><td class="ta-right">${k.parLevel}</td><td class="ta-right">${k.storeMin}</td><td>${k.openDays ? k.openDays + ' days' : '—'}</td><td class="small">${testsUsing(k.id).map((t) => esc(t.code)).join(', ') || (k.container ? 'Every ' + esc(k.container) + ' tube' : '—')}</td>
      <td><button class="btn btn-ghost btn-sm" data-edit="${k.id}">${icon('pencil')}Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  host.querySelector('[data-add]').onclick = () => itemEditor(null, user, redraw);
  host.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => itemEditor(b.dataset.edit, user, redraw); });
}
function itemEditor(id, user, done) {
  const k = id ? item(id) : null; const d = k ? { ...k, openDays: k.openDays ?? '', unitCost: k.unitCost ?? '' } : blankItem();
  const opt = (obj, v) => Object.entries(obj).map(([key, x]) => `<option value="${key}" ${key === v ? 'selected' : ''}>${esc(x.label || x)}</option>`).join('');
  const conts = store.hs().lab.containers;
  openModal({ title: k ? `Edit ${k.name}` : 'Add a lab item', size: 'lg',
    body: `<div class="form-grid">
      <div class="field col-8"><label>Name <span class="req">*</span></label><input class="input" data-f="name" value="${esc(d.name)}" placeholder="e.g. Malaria Pf/Pv rapid card"></div>
      <div class="field col-4"><label>Kind</label><select class="input" data-f="kind">${opt(KINDS, d.kind)}</select></div>
      <div class="field col-3"><label>One unit is a…</label><input class="input" data-f="unit" value="${esc(d.unit)}" placeholder="card / test / strip"></div>
      <div class="field col-3"><label>Store gives a…</label><input class="input" data-f="packLabel" value="${esc(d.packLabel)}" placeholder="box / pack / kit"></div>
      <div class="field col-3"><label>Units in one pack</label><input class="input" type="number" min="1" data-f="packSize" value="${esc(d.packSize)}"></div>
      <div class="field col-3"><label>Stored</label><select class="input" data-f="storage">${opt(STORAGE, d.storage)}</select></div>
      <div class="field col-3"><label>Ask for more at</label><input class="input" type="number" min="0" data-f="reorderLevel" value="${esc(d.reorderLevel)}"><small class="muted">units in lab</small></div>
      <div class="field col-3"><label>Keep in lab</label><input class="input" type="number" min="1" data-f="parLevel" value="${esc(d.parLevel)}"><small class="muted">the request fills up to this</small></div>
      <div class="field col-3"><label>Store reorder at</label><input class="input" type="number" min="0" data-f="storeMin" value="${esc(d.storeMin)}"><small class="muted">units in store</small></div>
      <div class="field col-3"><label>Usable after opening</label><input class="input" type="number" min="1" data-f="openDays" value="${esc(d.openDays)}" placeholder="days, if any"></div>
      <div class="field col-4"><label>Usual supplier</label><input class="input" data-f="supplier" value="${esc(d.supplier || '')}"></div>
      <div class="field col-4"><label>Cost per unit (₹)</label><input class="input" type="number" min="0" step="0.01" data-f="unitCost" value="${esc(d.unitCost)}"></div>
      <div class="field col-4" data-contf><label>Tube type (used one per tube)</label><select class="input" data-f="container"><option value="">—</option>${Object.entries(conts).map(([c, x]) => `<option value="${c}" ${c === d.container ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
      ${k ? `<div class="field col-12"><label class="checkbox"><input type="checkbox" data-f="active" ${d.active !== false ? 'checked' : ''}> In use (untick to stop stocking it — history is kept)</label></div>` : ''}
    </div><div class="tm-err hidden mt-2" data-err></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: k ? 'Save changes' : 'Add item', cls: 'btn-primary', icon: icon('check'), onClick: (c, w) => {
      const v = {}; w.querySelectorAll('[data-f]').forEach((i) => { v[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value; });
      const errs = validateItem(v, id); const el = w.querySelector('[data-err]');
      if (errs.length) { el.innerHTML = errs.map((x) => `<div>${icon('alert-circle')}${esc(x)}</div>`).join(''); el.classList.remove('hidden'); refreshIcons(el); return; }
      try { saveItem(v, user, id); c(); toast(k ? 'Item updated.' : 'Item added.'); done?.(); } catch (e) { toast(e.message, 'error'); }
    } }],
    onOpen: (w) => { const sync = () => w.querySelector('[data-contf]').classList.toggle('hidden', w.querySelector('[data-f=kind]').value !== 'CONSUMABLE'); w.querySelector('[data-f=kind]').onchange = sync; sync(); }
  });
}

// ================= Used vs billed (owner) =================
function reconTab(host, user, S, redraw) {
  S.from ||= ymd(new Date(Date.now() - 6 * 86400000)); S.to ||= ymd();
  const rec = kitReconciliation(S.from, S.to);
  host.innerHTML = `<div class="toolbar"><label class="small">From <input type="date" class="input" data-from value="${S.from}"></label><label class="small">To <input type="date" class="input" data-to value="${S.to}"></label><button class="btn btn-secondary btn-sm" data-csv>${icon('download')}CSV</button></div>
    <div class="table-scroll"><table class="table"><thead><tr><th>Item</th><th class="ta-right">Tests billed</th><th class="ta-right">Tests run</th><th class="ta-right">Used for tests</th><th class="ta-right">QC</th><th class="ta-right">Repeats</th><th class="ta-right">Wastage / expired</th><th class="ta-right">Count shortage</th><th class="ta-right">Not matched</th><th class="ta-right">Efficiency</th></tr></thead><tbody>
    ${rec.map((r) => `<tr class="${r.unexplained > 0 || r.countLoss > 0 ? 'row-danger' : ''}"><td><strong>${esc(r.kit.name)}</strong><div class="cell-sub">${esc(r.tests)}</div></td><td class="ta-right">${r.billed}</td><td class="ta-right">${r.performed}</td><td class="ta-right">${r.used}</td><td class="ta-right">${r.qc}</td><td class="ta-right">${r.repeat}</td><td class="ta-right">${r.waste}</td><td class="ta-right ${r.countLoss > 0 ? 'text-danger' : ''}">${r.countLoss}</td><td class="ta-right ${r.unexplained > 0 ? 'text-danger' : ''}"><b>${r.unexplained}</b></td><td class="ta-right">${r.efficiency}%</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small card-pad">Tests run should equal units used for tests. QC, repeats and wastage are recorded with a reason. A count shortage means stock went somewhere without a bill.</p>`;
  host.querySelector('[data-from]').onchange = (e) => { S.from = e.target.value; reconTab(host, user, S, redraw); refreshIcons(host); };
  host.querySelector('[data-to]').onchange = (e) => { S.to = e.target.value; reconTab(host, user, S, redraw); refreshIcons(host); };
  host.querySelector('[data-csv]').onclick = () => exportTable(`lab-used-vs-billed-${S.from}-${S.to}.csv`, [{ label: 'Item', csv: (r) => r.kit.name }, ...['billed', 'performed', 'used', 'qc', 'repeat', 'waste', 'countLoss', 'unexplained', 'efficiency'].map((k) => ({ label: k, csv: (r) => r[k] }))], rec);
}
