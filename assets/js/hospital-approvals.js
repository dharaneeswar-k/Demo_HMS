// Super Admin decisions on OP / IP billing requests (discounts above the limit, OP refunds).
import { store } from './data-service.js';
import { can } from './auth.js';
import { audit } from './services.js';
import { notify } from './notifications.js';
import { applyOpDecision } from './op.js';
import { applyIpDecision } from './ip.js';

export const pendingHospitalRequests = () => store.all('hospitalRequests').filter((r) => r.status === 'PENDING').sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

export function decideHospitalRequest(id, approve, note, user) {
  if (!can('hospital.approve', user)) throw new Error('Only the Super Admin can decide billing requests.');
  const rq = store.get('hospitalRequests', id);
  if (!rq || rq.status !== 'PENDING') throw new Error('This request has already been decided.');
  if (!approve && !String(note || '').trim()) throw new Error('Give a reason for rejecting.');
  return store.transaction(() => {
    Object.assign(rq, { status: approve ? 'APPROVED' : 'REJECTED', decidedBy: user.id, decidedAt: new Date().toISOString(), decisionNote: String(note || '').trim() });
    if (rq.refType === 'OP_BILL') applyOpDecision(rq, approve, user);
    if (rq.refType === 'IP_BILL') applyIpDecision(rq, approve, user);
    notify({ type: 'HOSPITAL_REQUEST_DECIDED', category: rq.type === 'DISCOUNT' ? 'Discount Approval' : 'Refund Approval', severity: approve ? 'success' : 'warning',
      title: `${rq.type === 'DISCOUNT' ? `${rq.pct}% discount` : 'Refund'} ${approve ? 'approved' : 'rejected'}`, message: `${rq.refId}${rq.decisionNote ? ' — ' + rq.decisionNote : ''}`,
      refType: 'HOSP_REQUEST', refId: rq.id, targetRoles: [], assignedTo: rq.requestedBy });
    audit(user, `HOSPITAL_${rq.type}_${approve ? 'APPROVED' : 'REJECTED'}`, 'HOSP_REQUEST', rq.id, rq.decisionNote);
    return rq;
  });
}
