// Lab stock — reagents, cartridges, rapid cards, strips, QC material and tubes.
//
//   Supplier ──► CENTRAL STORE ──(lab request → store issues)──► LAB ──► used per test / QC / repeat / wastage
//
// One ledger (`kitMovements`) holds every movement with its place (STORE or LAB) and lot, so a balance is always
// the sum of its movements — never a number someone typed. Store stock goes down when the store ISSUES; lab stock
// goes up only when the lab confirms it RECEIVED, so anything lost on the way shows up as a shortage.
import { store } from './data-service.js';
import { can } from './auth.js';
import { audit } from './services.js';
import { notify } from './notifications.js';
import { businessDate } from './pharmacy-calc.js';

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const dayMs = 86400000;
const OWNER_ID = 'USR-0003';

// ---------------- vocabulary ----------------
export const KINDS = {
  REAGENT: { label: 'Analyser reagents', one: 'Reagent', icon: 'flask-conical', tone: 'teal' },
  CARTRIDGE: { label: 'Cartridges', one: 'Cartridge', icon: 'cpu', tone: 'info' },
  RAPID: { label: 'Rapid test cards', one: 'Rapid card', icon: 'credit-card', tone: 'purple' },
  STRIP: { label: 'Strips', one: 'Strip', icon: 'ruler', tone: 'warning' },
  CONTROL: { label: 'QC controls', one: 'QC control', icon: 'target', tone: 'navy' },
  CONSUMABLE: { label: 'Tubes & consumables', one: 'Consumable', icon: 'test-tube', tone: 'muted' }
};
export const STORAGE = { COLD: '2–8 °C fridge', ROOM: 'Room temperature', FROZEN: 'Freezer (−20 °C)' };
export const MOVE = {
  SUPPLIER_IN: { label: 'Received from supplier', loc: 'STORE', tone: 'success' },
  ISSUE_OUT: { label: 'Issued to lab', loc: 'STORE', tone: 'info' },
  STORE_WASTE: { label: 'Store wastage / expired', loc: 'STORE', tone: 'warning' },
  ISSUE_IN: { label: 'Received from store', loc: 'LAB', tone: 'success' },
  USED_TEST: { label: 'Used — patient test', loc: 'LAB', tone: 'info' },
  USED_QC: { label: 'Used — QC run', loc: 'LAB', tone: 'warning' },
  REPEAT: { label: 'Repeat test', loc: 'LAB', tone: 'warning' },
  WASTAGE: { label: 'Wastage', loc: 'LAB', tone: 'warning' },
  EXPIRED: { label: 'Expired — discarded', loc: 'LAB', tone: 'danger' },
  COUNT_ADJUST: { label: 'Count correction', loc: 'LAB', tone: 'danger' }
};
export const REQ_STATUS = {
  REQUESTED: { label: 'Waiting for store', tone: 'warning', icon: 'hourglass' },
  ISSUED: { label: 'On the way to lab', tone: 'info', icon: 'truck' },
  RECEIVED: { label: 'Received in lab', tone: 'success', icon: 'check-circle-2' },
  SHORT: { label: 'Received — short', tone: 'danger', icon: 'alert-triangle' },
  REJECTED: { label: 'Not issued', tone: 'muted', icon: 'x-circle' },
  CANCELLED: { label: 'Cancelled', tone: 'muted', icon: 'ban' }
};

// ---------------- who may do what ----------------
/** Lab staff run their stock: request, receive, open packs, record use, count. */
export const canRunLab = (user) => can('lab.kits', user) && can('lab.work', user);
/** Store incharge: receive from supplier and issue to the lab. */
export const canRunStore = (user) => can('labstock.issue', user);
/** Admin / Super Admin: keep the item list (names, pack sizes, levels). */
export const canEditItems = (user) => can('labtest.manage', user);

// ---------------- lookups ----------------
export const items = ({ all = false } = {}) => store.all('labKits').filter((k) => all || k.active !== false);
export const item = (id) => store.get('labKits', id);
export const lot = (id) => (id ? store.get('labLots', id) : null);
const mvOf = (kitId, loc) => store.all('kitMovements').filter((m) => m.kitId === kitId && (m.loc || 'LAB') === loc);
export const balanceAt = (kitId, loc) => mvOf(kitId, loc).reduce((t, m) => t + m.qty, 0);
export const labBalance = (kitId) => balanceAt(kitId, 'LAB');
export const storeBalance = (kitId) => balanceAt(kitId, 'STORE');
export const isExpired = (l) => !!l?.expiry && l.expiry < today();
export const daysLeft = (iso) => (iso ? Math.ceil((new Date(iso.length === 10 ? iso + 'T23:59:59' : iso) - Date.now()) / dayMs) : null);

/** Lots with stock at a place, earliest expiry first (FEFO). Unlotted stock (rare) comes last. */
export function lotsAt(kitId, loc) {
  const by = {};
  mvOf(kitId, loc).forEach((m) => { by[m.lotId || ''] = (by[m.lotId || ''] || 0) + m.qty; });
  return Object.entries(by).filter(([, q]) => q > 0).map(([lid, qty]) => ({ lot: lot(lid), lotId: lid || null, qty }))
    .sort((a, b) => (a.lot?.expiry || '9999').localeCompare(b.lot?.expiry || '9999'));
}
export const usableLots = (kitId, loc) => lotsAt(kitId, loc).filter((x) => !isExpired(x.lot));
export const nextExpiry = (kitId, loc) => lotsAt(kitId, loc).find((x) => x.lot?.expiry)?.lot || null;

// packs ↔ units
export const packsOf = (k, units) => (k.packSize > 1 ? Math.round(units / k.packSize * 10) / 10 : units);
export const unitTxt = (k, n) => `${n} ${plural(k.unit, n)}`;
export const plural = (w, n) => (n === 1 ? w : /(x|s|ch|sh)$/.test(w) ? w + 'es' : w + 's');
export const packTxt = (k, packs) => `${packs} ${plural(k.packLabel, packs)}`;
export const packInfo = (k) => (k.packSize > 1 ? `1 ${k.packLabel} = ${unitTxt(k, k.packSize)}` : `Issued per ${k.unit}`);

// requests
const openReqs = () => store.all('labIndents').filter((r) => ['REQUESTED', 'ISSUED'].includes(r.status));
/** Units already asked for (waiting at store) — so the lab is not told to ask twice. */
export const requestedUnits = (kitId) => store.all('labIndents').filter((r) => r.status === 'REQUESTED').flatMap((r) => r.lines).filter((l) => l.kitId === kitId).reduce((t, l) => t + l.packs * (item(kitId)?.packSize || 1), 0);
/** Units issued by the store but not yet received in the lab. */
export const onTheWay = (kitId) => store.all('labIndents').filter((r) => r.status === 'ISSUED').flatMap((r) => r.issue.lines).filter((l) => l.kitId === kitId).reduce((t, l) => t + l.qty, 0);
export const pendingFor = (kitId) => openReqs().filter((r) => r.lines.some((l) => l.kitId === kitId));

// ---------------- status ----------------
/** OUT · LOW · OK for the lab shelf. */
export function labState(k) {
  const b = labBalance(k.id);
  return b <= 0 ? 'OUT' : b <= k.reorderLevel ? 'LOW' : 'OK';
}
export function storeState(k) {
  const b = storeBalance(k.id);
  return b <= 0 ? 'OUT' : b <= k.storeMin ? 'LOW' : 'OK';
}
/** Kept for older callers (alerts, home, management). */
export const kitBalance = labBalance;
export const kitStatus = (k) => ({ OUT: 'OUT_OF_STOCK', LOW: 'LOW_STOCK', OK: 'IN_STOCK' })[labState(k)];

/** How many packs to ask for: fill the shelf back to its "keep" level, minus what is already asked for or on the way. */
export function suggestion(k) {
  const bal = labBalance(k.id); if (bal > k.reorderLevel) return null;
  const pending = requestedUnits(k.id) + onTheWay(k.id);
  const want = k.parLevel - bal - pending; if (want <= 0) return null;
  return { packs: Math.max(1, Math.ceil(want / (k.packSize || 1))), bal, pending };
}
/** Average used per day over the last 14 days (tests + QC + repeats + wastage). */
export function dailyUse(kitId) {
  const since = new Date(Date.now() - 14 * dayMs).toISOString();
  const used = mvOf(kitId, 'LAB').filter((m) => m.at >= since && ['USED_TEST', 'USED_QC', 'REPEAT', 'WASTAGE'].includes(m.type)).reduce((t, m) => t - m.qty, 0);
  return Math.round(used / 14 * 10) / 10;
}
export function daysOfStock(k) { const d = dailyUse(k.id); return d > 0 ? Math.floor(labBalance(k.id) / d) : null; }

// ---------------- open packs (reagents and QC material that expire once opened) ----------------
export const openPacks = (kitId) => store.all('labOpenPacks').filter((p) => !p.closedAt && (!kitId || p.kitId === kitId));
export const packUseBy = (p) => p.useBy;
export const packExpired = (p) => p.useBy < now();

// ---------------- writing to the ledger ----------------
function move({ kitId, loc, lotId = null, type, qty, ref, user, note = '', at = now() }) {
  return store.insert('kitMovements', { id: store.nextId('kitMovements', 'KMV-', 5), at, kitId, loc, lotId, type, qty, ref, by: user.id, note });
}
/** Take `qty` from a place, earliest-expiry lot first. Returns the pieces taken. If stock is short, the rest is
 *  recorded without a lot (stock goes below zero) — patient care never waits on the stock register; the count fixes it. */
function take({ kitId, loc, qty, type, ref, user, note, at, allowShort = false, skipExpired = true }) {
  let left = qty; const pieces = [];
  for (const x of (skipExpired ? usableLots(kitId, loc) : lotsAt(kitId, loc))) {
    if (left <= 0) break; const q = Math.min(left, x.qty);
    pieces.push(move({ kitId, loc, lotId: x.lotId, type, qty: -q, ref, user, note, at })); left -= q;
  }
  if (left > 0) {
    if (!allowShort) throw new Error(`Only ${unitTxt(item(kitId), qty - left)} of ${item(kitId).name} available.`);
    pieces.push(move({ kitId, loc, lotId: null, type, qty: -left, ref, user, note, at }));
  }
  return pieces;
}

/** Called by the lab flow when a sample is collected: uses the reagent for that test (and the tube). Runs inside
 *  the caller's transaction. */
export function useForTest(kitId, qty, ref, user, note = '') {
  if (!item(kitId) || !(qty > 0)) return [];
  return take({ kitId, loc: 'LAB', qty, type: 'USED_TEST', ref, user, note, allowShort: true });
}
/** Tube / container consumable for a collected tube (one per tube). */
export function useTube(container, ref, user) {
  const k = items().find((x) => x.kind === 'CONSUMABLE' && x.container === container);
  return k ? take({ kitId: k.id, loc: 'LAB', qty: 1, type: 'USED_TEST', ref, user, note: 'Sample tube', allowShort: true }) : [];
}
/** A sample was rejected: what it used becomes a "repeat" (not refunded — it really was used). */
export function markRepeat(ref) {
  store.all('kitMovements').filter((m) => m.ref === ref && m.type === 'USED_TEST' && (m.loc || 'LAB') === 'LAB').forEach((m) => { m.type = 'REPEAT'; m.note = 'Sample rejected — test repeated'; });
}

// ---------------- lab: request → store: issue → lab: receive ----------------
export function requestStock({ lines, urgent = false, note = '' }, user) {
  if (!canRunLab(user)) throw new Error('Only lab staff can request lab stock.');
  lines = (lines || []).map((l) => ({ kitId: l.kitId, packs: Math.floor(Number(l.packs)) })).filter((l) => l.kitId && l.packs > 0);
  if (!lines.length) throw new Error('Choose at least one item and how many to ask for.');
  const dup = lines.find((l, i) => lines.findIndex((x) => x.kitId === l.kitId) !== i); if (dup) throw new Error(`${item(dup.kitId).name} is in the list twice.`);
  const big = lines.find((l) => l.packs > 50); if (big) throw new Error(`${big.packs} ${item(big.kitId).packLabel}s of ${item(big.kitId).name} looks like a mistake — check the number.`);
  return store.transaction(() => {
    const id = store.nextId('labIndents', 'IND-');
    const r = store.insert('labIndents', { id, at: now(), by: user.id, urgent: !!urgent, note: note.trim(), status: 'REQUESTED', lines, issue: null, receive: null, reject: null });
    audit(user, 'LAB_STOCK_REQUESTED', 'LABINDENT', id, lines.map((l) => `${l.packs} × ${item(l.kitId).name}`).join(', '));
    notify({ type: 'LAB_STOCK_REQUEST', category: 'Lab stock', severity: urgent ? 'critical' : 'warning', title: `${urgent ? 'URGENT — ' : ''}Lab needs ${lines.length} item${lines.length > 1 ? 's' : ''} (${id})`, message: lines.map((l) => `${packTxt(item(l.kitId), l.packs)} ${item(l.kitId).name}`).join(', ') + (note ? ` — ${note}` : ''), refType: 'LABINDENT', refId: id, targetRoles: ['STORE_INCHARGE'] });
    return r;
  });
}
export function cancelRequest(id, user) {
  if (!canRunLab(user)) throw new Error('Only lab staff can cancel a lab request.');
  const r = store.get('labIndents', id); if (r?.status !== 'REQUESTED') throw new Error('Only a request still waiting at the store can be cancelled.');
  return store.transaction(() => { r.status = 'CANCELLED'; r.cancelled = { at: now(), by: user.id }; audit(user, 'LAB_STOCK_REQUEST_CANCELLED', 'LABINDENT', id, ''); return r; });
}
/** Plan which lots the store will send (earliest expiry first), without saving. */
export function planIssue(kitId, packs) {
  const k = item(kitId); let left = packs * (k.packSize || 1); const out = [];
  for (const x of usableLots(kitId, 'STORE')) { if (left <= 0) break; const q = Math.min(left, x.qty); out.push({ kitId, lotId: x.lotId, qty: q }); left -= q; }
  return { lines: out, short: left };
}
export function issueRequest(id, { packs = {}, note = '' }, user) {
  if (!canRunStore(user)) throw new Error('Only the store can issue lab stock.');
  const r = store.get('labIndents', id); if (r?.status !== 'REQUESTED') throw new Error('This request is not waiting for the store.');
  const plan = r.lines.map((l) => ({ l, n: Math.floor(Number(packs[l.kitId] ?? l.packs)) }));
  if (plan.some((p) => !(p.n >= 0))) throw new Error('Enter how many to issue (0 if none).');
  if (plan.every((p) => p.n === 0)) throw new Error('Nothing to issue. Use “Cannot issue” to turn the request down.');
  if (plan.some((p) => p.n > p.l.packs) ) throw new Error('You cannot issue more than the lab asked for.');
  if (plan.some((p) => p.n < p.l.packs) && !note.trim()) throw new Error('You are sending less than asked — write a short note for the lab.');
  const lines = [];
  for (const p of plan.filter((x) => x.n > 0)) { const pl = planIssue(p.l.kitId, p.n); if (pl.short > 0) throw new Error(`The store has only ${unitTxt(item(p.l.kitId), p.n * item(p.l.kitId).packSize - pl.short)} of ${item(p.l.kitId).name} that is not expired.`); lines.push(...pl.lines); }
  return store.transaction(() => {
    const at = now();
    lines.forEach((x) => move({ kitId: x.kitId, loc: 'STORE', lotId: x.lotId, type: 'ISSUE_OUT', qty: -x.qty, ref: id, user, note: 'To lab', at }));
    r.status = 'ISSUED'; r.issue = { at, by: user.id, note: note.trim(), packs: Object.fromEntries(plan.map((p) => [p.l.kitId, p.n])), lines };
    audit(user, 'LAB_STOCK_ISSUED', 'LABINDENT', id, lines.map((x) => `${x.qty} ${item(x.kitId).name} lot ${lot(x.lotId)?.lot}`).join(', '));
    notify({ type: 'LAB_STOCK_ISSUED', category: 'Lab stock', severity: 'info', title: `Store sent your request ${id}`, message: 'Check the items when they reach the lab and press Receive.', refType: 'LABINDENT', refId: id, targetRoles: ['LAB'] });
    return r;
  });
}
export function rejectRequest(id, reason, user) {
  if (!canRunStore(user)) throw new Error('Only the store can turn down a lab request.');
  if (!reason?.trim()) throw new Error('Tell the lab why it cannot be issued.');
  const r = store.get('labIndents', id); if (r?.status !== 'REQUESTED') throw new Error('This request is not waiting for the store.');
  return store.transaction(() => {
    r.status = 'REJECTED'; r.reject = { at: now(), by: user.id, reason: reason.trim() };
    audit(user, 'LAB_STOCK_REQUEST_REJECTED', 'LABINDENT', id, reason);
    notify({ type: 'LAB_STOCK_REJECTED', category: 'Lab stock', severity: 'warning', title: `Store could not issue ${id}`, message: reason.trim(), refType: 'LABINDENT', refId: id, targetRoles: ['LAB'] });
    return r;
  });
}
/** Lab confirms what actually arrived. `got` = { [index of issue line]: qty }. Less than sent → shortage, owner told. */
export function receiveRequest(id, got, user, note = '') {
  if (!canRunLab(user)) throw new Error('Only lab staff can receive lab stock.');
  const r = store.get('labIndents', id); if (r?.status !== 'ISSUED') throw new Error('Nothing is on the way for this request.');
  const lines = r.issue.lines.map((x, i) => ({ ...x, sent: x.qty, qty: Math.floor(Number(got?.[i] ?? x.qty)) }));
  if (lines.some((x) => !(x.qty >= 0))) throw new Error('Enter the quantity that arrived (0 if none).');
  if (lines.some((x) => x.qty > x.sent)) throw new Error('More than the store sent — check the count.');
  const short = lines.filter((x) => x.qty < x.sent);
  if (short.length && !note.trim()) throw new Error('Some items are short — write what happened.');
  return store.transaction(() => {
    const at = now();
    lines.filter((x) => x.qty > 0).forEach((x) => move({ kitId: x.kitId, loc: 'LAB', lotId: x.lotId, type: 'ISSUE_IN', qty: x.qty, ref: id, user, note: 'From store', at }));
    r.status = short.length ? 'SHORT' : 'RECEIVED'; r.receive = { at, by: user.id, lines, note: note.trim() };
    audit(user, 'LAB_STOCK_RECEIVED', 'LABINDENT', id, short.length ? `Short: ${short.map((x) => `${item(x.kitId).name} ${x.sent - x.qty}`).join(', ')}` : 'All received');
    if (short.length) notify({ type: 'LAB_STOCK_SHORT', category: 'Lab stock', severity: 'critical', title: `Lab stock short on arrival — ${id}`, message: short.map((x) => `${item(x.kitId).name}: sent ${x.sent}, received ${x.qty}`).join('; ') + `. ${note}`, refType: 'LABINDENT', refId: id, targetRoles: ['SUPER_ADMIN', 'STORE_INCHARGE'], assignedTo: OWNER_ID });
    return r;
  });
}

// ---------------- store: receive from supplier ----------------
export function receiveFromSupplier({ kitId, lotNo, expiry, packs, supplier, invoiceNo, coldOk }, user) {
  if (!canRunStore(user)) throw new Error('Only the store receives lab stock from suppliers.');
  const k = item(kitId); if (!k) throw new Error('Choose the item.');
  packs = Math.floor(Number(packs));
  if (!(packs > 0)) throw new Error('Enter how many packs arrived.');
  if (!lotNo?.trim()) throw new Error('Enter the lot number printed on the box.');
  if (!expiry) throw new Error('Enter the expiry date printed on the box.');
  if (expiry <= today()) throw new Error('This lot is already expired — do not accept it.');
  if (daysLeft(expiry) < 30 && !invoiceNo?.trim()) throw new Error('Expires in under 30 days — note the invoice so it can be returned.');
  if (k.storage === 'COLD' && !coldOk) throw new Error('Cold items must arrive cold. If the box was warm, do not accept it — return it to the supplier.');
  const existing = store.all('labLots').find((l) => l.kitId === kitId && l.lot.toLowerCase() === lotNo.trim().toLowerCase());
  if (existing && existing.expiry !== expiry) throw new Error(`Lot ${lotNo} was received before with expiry ${existing.expiry}. Check the box.`);
  return store.transaction(() => {
    const l = existing || store.insert('labLots', { id: store.nextId('labLots', 'LOT-'), kitId, lot: lotNo.trim(), expiry, supplier: supplier?.trim() || k.supplier || '', receivedAt: now(), invoiceNo: invoiceNo?.trim() || '', verified: false });
    const m = move({ kitId, loc: 'STORE', lotId: l.id, type: 'SUPPLIER_IN', qty: packs * (k.packSize || 1), ref: invoiceNo?.trim() || 'SUPPLIER', user, note: `${packTxt(k, packs)} · ${supplier || k.supplier || ''}` });
    audit(user, 'LAB_STOCK_SUPPLIER_IN', 'LABITEM', kitId, `${packTxt(k, packs)} lot ${l.lot} exp ${expiry}`);
    return { lot: l, move: m };
  });
}
export function storeDiscard({ kitId, lotId, qty, reason }, user) {
  if (!canRunStore(user)) throw new Error('Only the store can write off store stock.');
  qty = Math.floor(Number(qty)); if (!(qty > 0)) throw new Error('Enter the quantity.');
  if (!reason?.trim()) throw new Error('Give the reason.');
  const have = lotsAt(kitId, 'STORE').find((x) => x.lotId === lotId)?.qty || 0; if (qty > have) throw new Error(`Only ${have} in that lot.`);
  return store.transaction(() => { const m = move({ kitId, loc: 'STORE', lotId, type: 'STORE_WASTE', qty: -qty, ref: 'STORE-WO', user, note: reason.trim() }); audit(user, 'LAB_STOCK_STORE_WASTE', 'LABITEM', kitId, `${qty} · ${reason}`); return m; });
}

// ---------------- lab: daily use outside patient tests ----------------
const USE_TYPES = { USED_QC: 'QC run', REPEAT: 'Repeat test', WASTAGE: 'Wastage' };
export function recordLabUse({ kitId, qty, type, note }, user) {
  if (!canRunLab(user)) throw new Error('Only lab staff can record lab stock use.');
  if (!USE_TYPES[type]) throw new Error('Choose what it was used for.');
  qty = Math.floor(Number(qty)); if (!(qty > 0)) throw new Error('Enter the quantity used.');
  if (!note?.trim()) throw new Error(type === 'USED_QC' ? 'Write the QC level / run (e.g. “Level 1 & 2, morning”).' : 'Give the reason.');
  if (qty > labBalance(kitId)) throw new Error(`Only ${unitTxt(item(kitId), labBalance(kitId))} in the lab.`);
  return store.transaction(() => { const ps = take({ kitId, loc: 'LAB', qty, type, ref: type + '-' + businessDate(), user, note: note.trim() }); audit(user, 'LAB_KIT_' + type, 'LABITEM', kitId, `${qty} · ${note}`); return ps; });
}
/** Throw away what is left of an expired lot in the lab. */
export function discardExpiredLot(kitId, lotId, user) {
  if (!canRunLab(user)) throw new Error('Only lab staff can discard lab stock.');
  const x = lotsAt(kitId, 'LAB').find((y) => y.lotId === lotId); if (!x) throw new Error('Nothing left in that lot.');
  if (!isExpired(x.lot)) throw new Error('This lot has not expired.');
  return store.transaction(() => { const m = move({ kitId, loc: 'LAB', lotId, type: 'EXPIRED', qty: -x.qty, ref: 'EXP-' + businessDate(), user, note: `Lot ${x.lot.lot} expired ${x.lot.expiry}` }); audit(user, 'LAB_STOCK_EXPIRED', 'LABITEM', kitId, `${x.qty} lot ${x.lot.lot}`); return m; });
}
/** Mark a new pack / vial as opened (loaded on the analyser). Its "use by" is the shorter of opened-stability and lot expiry. */
export function openPack(kitId, user, { lotId } = {}) {
  if (!canRunLab(user)) throw new Error('Only lab staff can open packs.');
  const k = item(kitId); if (!k.openDays) throw new Error(`${k.name} does not need an opened date.`);
  const x = lotId ? usableLots(kitId, 'LAB').find((y) => y.lotId === lotId) : usableLots(kitId, 'LAB')[0];
  if (!x) throw new Error(`No unexpired ${k.name} in the lab to open.`);
  return store.transaction(() => {
    const at = now();
    openPacks(kitId).forEach((p) => Object.assign(p, { closedAt: at, closedBy: user.id, closedReason: 'Finished — new pack opened' }));
    const exp = x.lot?.expiry ? new Date(x.lot.expiry + 'T23:59:59').toISOString() : null;
    const byStab = new Date(Date.now() + k.openDays * dayMs).toISOString();
    const p = store.insert('labOpenPacks', { id: store.nextId('labOpenPacks', 'OPK-'), kitId, lotId: x.lotId, openedAt: at, openedBy: user.id, useBy: exp && exp < byStab ? exp : byStab, closedAt: null, closedBy: null, closedReason: '' });
    // a QC control vial is used up the moment it is opened (reagent packs are used per test instead)
    if (k.kind === 'CONTROL') move({ kitId, loc: 'LAB', lotId: x.lotId, type: 'USED_QC', qty: -1, ref: p.id, user, note: 'Control vial opened for QC', at });
    audit(user, 'LAB_PACK_OPENED', 'LABITEM', kitId, `Lot ${x.lot?.lot || '—'} · use by ${p.useBy.slice(0, 10)}`);
    return p;
  });
}
export function closePack(id, reason, user) {
  if (!canRunLab(user)) throw new Error('Only lab staff can close packs.');
  const p = store.get('labOpenPacks', id); if (!p || p.closedAt) throw new Error('This pack is already closed.');
  return store.transaction(() => { Object.assign(p, { closedAt: now(), closedBy: user.id, closedReason: reason || 'Finished' }); audit(user, 'LAB_PACK_CLOSED', 'LABITEM', p.kitId, reason || 'Finished'); return p; });
}

// ---------------- lab: physical count (blind — the system number is shown only after submitting) ----------------
export function submitCount(counted, user) {
  if (!canRunLab(user)) throw new Error('Only lab staff can count lab stock.');
  const lines = items().filter((k) => counted[k.id] !== '' && counted[k.id] != null).map((k) => { const sys = labBalance(k.id); const c = Math.floor(Number(counted[k.id])); return { kitId: k.id, system: sys, counted: c, diff: c - sys }; });
  if (!lines.length) throw new Error('Enter the counted quantity for at least one item.');
  if (lines.some((l) => !(l.counted >= 0))) throw new Error('Counts must be 0 or more.');
  return store.transaction(() => {
    const id = store.nextId('kitCounts', 'KC-'); const short = lines.filter((l) => l.diff < 0);
    const c = store.insert('kitCounts', { id, at: now(), businessDate: businessDate(), countedBy: user.id, lines, status: short.length ? 'SUBMITTED' : 'MATCHED', reviewedBy: null, reviewedAt: null, reviewNote: '' });
    lines.filter((l) => l.diff < 0).forEach((l) => take({ kitId: l.kitId, loc: 'LAB', qty: -l.diff, type: 'COUNT_ADJUST', ref: id, user, note: 'Physical count shortage', allowShort: true, skipExpired: false }));
    lines.filter((l) => l.diff > 0).forEach((l) => move({ kitId: l.kitId, loc: 'LAB', lotId: lotsAt(l.kitId, 'LAB').at(-1)?.lotId || null, type: 'COUNT_ADJUST', qty: l.diff, ref: id, user, note: 'Physical count excess' }));
    audit(user, 'LAB_KIT_COUNT', 'KITCOUNT', id, short.length ? `${short.length} item(s) short` : 'All matched');
    if (short.length) notify({ type: 'KIT_VARIANCE', category: 'Lab stock', severity: 'critical', title: `Lab stock short in count — ${short.length} item(s)`, message: short.map((l) => `${item(l.kitId).name}: ${l.diff}`).join('; ') + '. Check for tests run without a bill.', refType: 'KITCOUNT', refId: id, targetRoles: ['SUPER_ADMIN'], assignedTo: OWNER_ID });
    return c;
  });
}
export function reviewCount(id, note, user) {
  if (!can('credit.approve', user)) throw new Error('Only the Super Admin reviews count shortages.');
  if (!note?.trim()) throw new Error('Write what was found.');
  return store.transaction(() => { const c = store.get('kitCounts', id); Object.assign(c, { status: 'REVIEWED', reviewedBy: user.id, reviewedAt: now(), reviewNote: note.trim() }); audit(user, 'LAB_KIT_COUNT_REVIEWED', 'KITCOUNT', id, note); return c; });
}

// ---------------- item list (Admin / Super Admin) ----------------
export const blankItem = () => ({ name: '', kind: 'RAPID', unit: 'card', packLabel: 'box', packSize: 25, storage: 'ROOM', openDays: '', reorderLevel: 10, parLevel: 40, storeMin: 50, unitCost: '', supplier: '', container: '', active: true });
export function validateItem(d, id) {
  const e = [];
  if (!d.name?.trim()) e.push('Give the item a name.');
  else if (items({ all: true }).some((k) => k.id !== id && k.name.trim().toLowerCase() === d.name.trim().toLowerCase())) e.push('An item with this name already exists.');
  if (!KINDS[d.kind]) e.push('Choose the kind of item.');
  if (!d.unit?.trim()) e.push('Say what one unit is (test, card, strip, tube…).');
  if (!d.packLabel?.trim()) e.push('Say what the store hands over (box, pack, kit…).');
  const n = (x) => Number(x);
  if (!(n(d.packSize) >= 1 && Number.isInteger(n(d.packSize)))) e.push('Units per pack must be a whole number, 1 or more.');
  if (!(n(d.reorderLevel) >= 0)) e.push('“Ask for more at” must be 0 or more.');
  if (!(n(d.parLevel) > n(d.reorderLevel))) e.push('“Keep in lab” must be more than “Ask for more at”.');
  if (!(n(d.storeMin) >= 0)) e.push('Store reorder level must be 0 or more.');
  if (d.openDays !== '' && d.openDays != null && !(n(d.openDays) >= 1)) e.push('Days usable after opening must be 1 or more (leave empty if not needed).');
  if (!STORAGE[d.storage]) e.push('Choose how it is stored.');
  return e;
}
export function saveItem(d, user, id) {
  if (!canEditItems(user)) throw new Error('Only the Admin or Super Admin can change the lab item list.');
  const e = validateItem(d, id); if (e.length) throw new Error(e[0]);
  const rec = { name: d.name.trim(), kind: d.kind, unit: d.unit.trim().toLowerCase(), packLabel: d.packLabel.trim().toLowerCase(), packSize: Math.floor(Number(d.packSize)), storage: d.storage, openDays: d.openDays === '' || d.openDays == null ? null : Math.floor(Number(d.openDays)),
    reorderLevel: Math.floor(Number(d.reorderLevel)), parLevel: Math.floor(Number(d.parLevel)), storeMin: Math.floor(Number(d.storeMin)), unitCost: d.unitCost === '' ? null : Number(d.unitCost), supplier: (d.supplier || '').trim(), container: d.kind === 'CONSUMABLE' ? (d.container || '') : '', active: d.active !== false };
  return store.transaction(() => {
    if (id) { const k = store.update('labKits', id, rec); audit(user, 'LAB_ITEM_UPDATED', 'LABITEM', id, rec.name); return k; }
    const nid = store.nextId('labKits', 'KIT-'); const k = store.insert('labKits', { id: nid, ...rec }); audit(user, 'LAB_ITEM_CREATED', 'LABITEM', nid, rec.name); return k;
  });
}
/** Tests that use an item (from the Lab Test Master). */
export const testsUsing = (kitId) => store.all('services').filter((s) => s.category === 'LAB' && s.lab?.kits?.some((x) => x.kitId === kitId));

// ---------------- what needs attention (used by the page, home and alerts) ----------------
export function labAttention() {
  const ks = items();
  return {
    low: ks.filter((k) => labState(k) !== 'OK'),
    suggest: ks.map((k) => ({ k, s: suggestion(k) })).filter((x) => x.s),
    arriving: store.all('labIndents').filter((r) => r.status === 'ISSUED'),
    waiting: store.all('labIndents').filter((r) => r.status === 'REQUESTED'),
    expiring: ks.flatMap((k) => lotsAt(k.id, 'LAB').filter((x) => x.lot?.expiry && daysLeft(x.lot.expiry) <= 30).map((x) => ({ k, ...x }))),
    packsDue: openPacks().filter((p) => daysLeft(p.useBy) <= 2)
  };
}
export function storeAttention() {
  const ks = items();
  return {
    requests: store.all('labIndents').filter((r) => r.status === 'REQUESTED').sort((a, b) => (b.urgent - a.urgent) || a.at.localeCompare(b.at)),
    toOrder: ks.filter((k) => storeState(k) !== 'OK'),
    expiring: ks.flatMap((k) => lotsAt(k.id, 'STORE').filter((x) => x.lot?.expiry && daysLeft(x.lot.expiry) <= 60).map((x) => ({ k, ...x })))
  };
}

// ---------------- reconciliation: used vs billed (owner) ----------------
export function kitReconciliation(from, to) {
  const inR = (iso) => { const d = businessDate(iso); return (!from || d >= from) && (!to || d <= to); };
  return items().filter((k) => k.kind !== 'CONSUMABLE').map((k) => {
    const tests = testsUsing(k.id);
    const per = (sid) => tests.find((t) => t.id === sid)?.lab.kits.find((x) => x.kitId === k.id)?.qty || 0;
    const os = store.all('orders').filter((o) => (o.billId || o.ipCharge) && o.status !== 'CANCELLED' && tests.some((t) => t.id === o.serviceId) && inR(o.billedAt));
    const billed = os.reduce((t, o) => t + per(o.serviceId), 0);
    const performed = os.filter((o) => o.lab?.collectedAt).reduce((t, o) => t + per(o.serviceId), 0);
    const mv = mvOf(k.id, 'LAB').filter((m) => inR(m.at));
    const sum = (type) => -mv.filter((m) => m.type === type).reduce((t, m) => t + m.qty, 0);
    const used = sum('USED_TEST'); const qc = sum('USED_QC'); const repeat = sum('REPEAT'); const waste = sum('WASTAGE') + sum('EXPIRED'); const countLoss = sum('COUNT_ADJUST');
    const total = used + qc + repeat + waste + countLoss;
    return { kit: k, tests: tests.map((t) => t.code).join(', '), billed, performed, used, qc, repeat, waste, countLoss, total, unexplained: Math.round((used - performed) * 100) / 100, efficiency: total ? Math.round(performed / total * 100) : 100, balance: labBalance(k.id) };
  });
}
