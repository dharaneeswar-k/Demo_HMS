// Shift management (BRD 12): start with an opening float, every collection and refund in the shift window is
// counted automatically (pharmacy + main counter), close with a denomination count, and hand over to the next person
// who accepts or rejects the cash. Expected cash = opening float + cash collected − cash refunded.
import { store } from './data-service.js';
import { can } from './auth.js';
import { audit } from './services.js';
import { notify } from './notifications.js';
import { r2 } from './pricing.js';
import { fmtINR } from './utils.js';

const now = () => new Date().toISOString();
export const MODES = ['CASH', 'UPI', 'CARD', 'OTHER'];
export const counterFor = (user) => (user?.role === 'PHARMACY_STAFF' ? 'PHARMACY' : 'MAIN');
export const COUNTER_LABEL = { PHARMACY: 'Pharmacy counter', MAIN: 'Main billing counter' };
export const SHIFT_LABEL = { OPEN: 'In progress', HANDOVER_PENDING: 'Handover pending', HANDED_OVER: 'Handed over', CLOSED: 'Closed', VERIFIED: 'Verified' };
export const SHIFT_TONE = { OPEN: 'info', HANDOVER_PENDING: 'warning', HANDED_OVER: 'success', CLOSED: 'neutral', VERIFIED: 'success' };

export const openShiftFor = (user) => (user ? store.all('shifts').find((s) => s.userId === user.id && s.status === 'OPEN') || null : null);
export const pendingHandoversFor = (user) => store.all('shifts').filter((s) => s.status === 'HANDOVER_PENDING' && s.handoverTo === user.id);

export function currentShiftName(d = new Date()) {
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const list = store.hs().shifts;
  return (list.find((x) => (x.start < x.end ? hm >= x.start && hm < x.end : hm >= x.start || hm < x.end)) || list[0]).name;
}

/** Every payment and refund the user handled inside the shift window. */
export function shiftTransactions(sh) {
  const end = sh.closedAt || now();
  const inWin = (p) => p.userId === sh.userId && p.at >= sh.startAt && p.at <= end;
  const ph = store.all('payments').filter(inWin).map((p) => ({ ...p, source: 'Pharmacy', ref: p.billId }));
  const hb = store.all('hbills').flatMap((b) => b.payments.map((p) => ({ ...p, billId: b.id }))).filter(inWin).map((p) => ({ ...p, source: 'Main counter', ref: p.billId }));
  return [...ph, ...hb].sort((a, b) => a.at.localeCompare(b.at));
}
export function shiftSummary(sh) {
  const tx = shiftTransactions(sh);
  const byMode = Object.fromEntries(MODES.map((m) => [m, { in: 0, out: 0, net: 0 }]));
  tx.forEach((p) => { const x = byMode[p.mode] || (byMode[p.mode] = { in: 0, out: 0, net: 0 }); if (p.kind === 'REFUND') x.out = r2(x.out + p.amount); else x.in = r2(x.in + p.amount); x.net = r2(x.in - x.out); });
  const expectedCash = r2(sh.openingFloat + byMode.CASH.net);
  return { tx, count: tx.filter((p) => p.kind === 'PAYMENT').length, refunds: tx.filter((p) => p.kind === 'REFUND').length, byMode, collected: r2(MODES.reduce((t, m) => t + byMode[m].in, 0)),
    refunded: r2(MODES.reduce((t, m) => t + byMode[m].out, 0)), online: r2(byMode.UPI.net + byMode.CARD.net + byMode.OTHER.net), expectedCash };
}
export const denomTotal = (d) => r2(Object.entries(d || {}).reduce((t, [k, n]) => t + Number(k) * (Number(n) || 0), 0));

/** Opening float suggested for the next shift: the cash this user accepted in a handover today, else the default float. */
export function suggestedFloat(user) {
  const today = new Date().toISOString().slice(0, 10);
  const h = store.all('shifts').filter((s) => s.handoverTo === user.id && s.status === 'HANDED_OVER' && (s.handoverAcceptedAt || '').slice(0, 10) === today).sort((a, b) => b.handoverAcceptedAt.localeCompare(a.handoverAcceptedAt))[0];
  return h ? { amount: h.handoverAmount, from: h } : { amount: store.hs().defaultOpeningFloat, from: null };
}

export function startShift({ openingFloat, denoms, shiftName }, user) {
  if (!can('shift.own', user)) throw new Error('Your role does not handle cash.');
  if (openShiftFor(user)) throw new Error('You already have a shift in progress.');
  if (pendingHandoversFor(user).length) throw new Error('Accept or reject the cash handed over to you first.');
  const amt = denoms && Object.keys(denoms).length ? denomTotal(denoms) : r2(openingFloat);
  if (!(amt >= 0)) throw new Error('Enter the opening cash.');
  return store.transaction(() => {
    const s = store.insert('shifts', { id: store.nextId('shifts', 'SFT-'), userId: user.id, counter: counterFor(user), shiftName: shiftName || currentShiftName(), startAt: now(), openingFloat: amt, openingDenoms: denoms || {},
      status: 'OPEN', closedAt: null, expectedCash: null, countedCash: null, countedDenoms: null, difference: null, handoverTo: null, handoverAmount: null, handoverAcceptedAt: null, handoverNote: '', note: '', verifiedBy: null });
    audit(user, 'SHIFT_STARTED', 'SHIFT', s.id, `${s.shiftName} · ${COUNTER_LABEL[s.counter]} · opening ${fmtINR(amt)}`);
    return s;
  });
}

export function closeShift(id, { denoms, handoverTo, note }, user) {
  const sh = store.get('shifts', id);
  if (!sh || sh.userId !== user.id) throw new Error('You can close only your own shift.');
  if (sh.status !== 'OPEN') throw new Error('This shift is already closed.');
  const counted = denomTotal(denoms);
  const sum = shiftSummary(sh);
  const diff = r2(counted - sum.expectedCash);
  const tol = Number(store.hs().shiftVarianceTolerance) || 0;
  if (Math.abs(diff) > tol && !note?.trim()) throw new Error(`Cash differs by ${fmtINR(diff)}. Write the reason before closing.`);
  if (store.hs().handoverRequired && !handoverTo && sh.counter === 'MAIN' && store.all('users').some((u) => u.active && u.id !== user.id && u.role === user.role)) {
    // allowed: last shift of the day — cash goes to the owner / bank; only warn in the UI
  }
  if (handoverTo && handoverTo === user.id) throw new Error('Choose another person for the handover.');
  return store.transaction(() => {
    Object.assign(sh, { closedAt: now(), expectedCash: sum.expectedCash, countedCash: counted, countedDenoms: denoms, difference: diff, handoverTo: handoverTo || null, handoverAmount: counted,
      status: handoverTo ? 'HANDOVER_PENDING' : 'CLOSED', note: note || '', summary: { collected: sum.collected, refunded: sum.refunded, online: sum.online, byMode: sum.byMode, count: sum.count } });
    audit(user, 'SHIFT_CLOSED', 'SHIFT', id, `Expected ${fmtINR(sum.expectedCash)} · counted ${fmtINR(counted)} · diff ${fmtINR(diff)}${handoverTo ? ' · handover to ' + store.get('users', handoverTo).name : ''}`);
    if (handoverTo) notify({ type: 'SHIFT_HANDOVER', category: 'Shift handover', severity: 'info', title: `Cash handover from ${user.name}`, message: `${fmtINR(counted)} from the ${sh.shiftName.toLowerCase()} shift. Count it and accept or reject.`, refType: 'SHIFT', refId: id, targetRoles: [], assignedTo: handoverTo });
    notify({ type: 'SHIFT_CLOSED', category: 'Shift closing', severity: Math.abs(diff) > tol ? 'critical' : 'info', title: `${sh.shiftName} shift closed — ${user.name}`,
      message: `${COUNTER_LABEL[sh.counter]}: cash ${fmtINR(sum.byMode.CASH.net)} · online ${fmtINR(sum.online)} · refunds ${fmtINR(sum.refunded)} · ${diff === 0 ? 'cash matched' : 'cash ' + (diff > 0 ? 'excess ' : 'short ') + fmtINR(Math.abs(diff))}.`, refType: 'SHIFT', refId: id, targetRoles: ['SUPER_ADMIN'], assignedTo: 'USR-0003' });
    return sh;
  });
}

export function respondHandover(id, accept, note, user) {
  const sh = store.get('shifts', id);
  if (sh.handoverTo !== user.id || sh.status !== 'HANDOVER_PENDING') throw new Error('This handover is not waiting for you.');
  if (!accept && !note?.trim()) throw new Error('Say what is wrong with the cash (for example the amount you counted).');
  return store.transaction(() => {
    if (accept) Object.assign(sh, { status: 'HANDED_OVER', handoverAcceptedAt: now(), handoverNote: note || '' });
    else Object.assign(sh, { status: 'OPEN', closedAt: null, handoverTo: null, handoverAmount: null, handoverNote: `Rejected by ${user.name}: ${note}`, countedCash: null, countedDenoms: null, difference: null, expectedCash: null });
    audit(user, accept ? 'SHIFT_HANDOVER_ACCEPTED' : 'SHIFT_HANDOVER_REJECTED', 'SHIFT', id, note || '');
    notify({ type: 'SHIFT_HANDOVER_REPLY', category: 'Shift handover', severity: accept ? 'success' : 'critical', title: accept ? `${user.name} accepted your cash` : `${user.name} rejected your cash handover`,
      message: accept ? `${fmtINR(sh.handoverAmount)} received.` : `Recount and close the shift again. Note: ${note}`, refType: 'SHIFT', refId: id, targetRoles: accept ? [] : ['SUPER_ADMIN'], assignedTo: sh.userId });
    return sh;
  });
}

export function verifyShift(id, user) {
  if (!can('shift.report', user)) throw new Error('Only the Super Admin verifies shifts.');
  return store.transaction(() => { const sh = store.get('shifts', id); sh.verifiedBy = user.id; sh.verifiedAt = now(); if (sh.status === 'CLOSED') sh.status = 'VERIFIED'; audit(user, 'SHIFT_VERIFIED', 'SHIFT', id, ''); return sh; });
}

/** Payments taken while the user had no open shift (should be zero). */
export function outsideShift(from, to) {
  const shifts = store.all('shifts');
  const all = [...store.all('payments').map((p) => ({ ...p, source: 'Pharmacy' })), ...store.all('hbills').flatMap((b) => b.payments.map((p) => ({ ...p, billId: b.id, source: 'Main counter' })))];
  return all.filter((p) => p.at.slice(0, 10) >= from && p.at.slice(0, 10) <= to && !shifts.some((s) => s.userId === p.userId && p.at >= s.startAt && p.at <= (s.closedAt || now())));
}
