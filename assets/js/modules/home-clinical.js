// Home additions for OP / IP: tiles, key numbers, to-dos and recent activity for Doctor, Nurse and Billing,
// plus OP / IP tiles for Reception. Used by home.js; returns plain HTML strings in the same shapes.
import { store } from '../data-service.js';
import { can } from '../auth.js';
import { businessDate } from '../pharmacy-calc.js';
import { doctorForUser, patient, cbadge, bedCode, pendingHospitalClosings } from '../clinical.js';
import { doctorQueue, opDaySummary } from '../op.js';
import { openAdmissions, ipPosition, bedSummary, ipSummary, currentBedId, finalBill } from '../ip.js';
import { esc, icon, fmtINR, fmtNum, relTime } from '../utils.js';

export const CLINICAL_ROLES = ['DOCTOR', 'NURSE', 'BILLING'];

export function clinicalHome(u, { tile, stat }) {
  const role = u.role; const today = businessDate();
  const op = opDaySummary(today); const beds = bedSummary(); const ip = ipSummary();
  const me = doctorForUser(u); const q = me ? doctorQueue(me.id, today) : null;
  const open = openAdmissions();
  const myPatients = me ? open.filter((a) => a.doctorId === me.id) : [];
  const pendingIndents = store.all('ipIndents').filter((i) => i.status === 'RAISED');
  const discharging = open.filter((a) => a.status !== 'ADMITTED');
  const T = {
    queue: tile('#/op/queue', 'list-ordered', 'My OP Queue', 'Today’s patients', 'teal', null, q?.waiting.length ? { text: `${q.waiting.length} waiting · now ${q.current[0]?.token || '—'}`, tone: 'teal' } : null),
    myIp: tile('#/ip/admissions', 'folder-heart', 'My Inpatients', `${myPatients.length} admitted under you`, 'navy', null, myPatients.length ? { text: `${myPatients.length} admitted`, tone: 'info' } : null),
    beds: tile('#/ip', 'bed-double', 'Bed Board', `${beds.occupied}/${beds.total} beds occupied`, 'info'),
    opDesk: tile('#/op', 'stethoscope', 'OP Desk', 'Patients at OP desk', 'teal', null, op.waiting ? { text: `${op.waiting} waiting`, tone: 'teal' } : null),
    indents: tile('#/ip/indents', 'pill-bottle', 'Ward Indents', 'Request medicines', 'warning', null, pendingIndents.length ? { text: `${pendingIndents.length} pending`, tone: 'warning' } : null),
    newVisit: tile('#/op/new', 'user-round-plus', 'New OP Visit', 'Token and consultation fee', 'teal'),
    admit: tile('#/ip/admit', 'hospital', 'Admit Patient', 'Bed, deposit and wristband', 'navy'),
    ipList: tile('#/ip/admissions', 'folder-heart', 'IP Patients', `${ip.admitted} in hospital`, 'info', null, ip.low ? { text: `${ip.low} low deposit`, tone: 'warning' } : null),
    discharge: tile('#/ip/admissions?tab=discharging', 'log-out', 'Discharges', 'None in progress', 'purple', null, discharging.length ? { text: `${discharging.length} in progress`, tone: 'purple' } : null),
    tpa: tile('#/ip/tpa', 'shield-plus', 'Insurance / TPA', 'Pre-auth, approvals, claims', 'info'),
    cash: tile('#/hospital/closing', 'wallet', 'Cash Closing', 'Close the OP / IP counter', 'purple')
  };
  const myRec = store.all('hospitalReceipts').filter((r) => r.userId === u.id && r.businessDate === today);
  const net = myRec.reduce((t, r) => t + (r.kind === 'REFUND' ? -r.amount : r.amount), 0);
  const res = { tiles: [], stats: [], todo: [], recent: null };
  if (role === 'DOCTOR') {
    res.tiles = [T.queue, T.myIp, T.beds];
    res.stats = [stat('Waiting for me', fmtNum(q?.waiting.length || 0), q?.waiting.filter((v) => v.priority === 'EMERGENCY').length ? `${q.waiting.filter((v) => v.priority === 'EMERGENCY').length} emergency` : 'in my OP queue', '#/op/queue'),
      stat('Seen today', fmtNum(q?.done.length || 0), 'consultations completed', '#/op/queue'), stat('My inpatients', fmtNum(myPatients.length), `${myPatients.filter((a) => a.status !== 'ADMITTED').length} being discharged`, '#/ip/admissions'),
      stat('Rounds due', fmtNum(myPatients.filter((a) => a.status === 'ADMITTED' && !a.notes.some((n) => n.kind === 'ROUND' && businessDate(n.at) === today)).length), 'no round note today', '#/ip/admissions')];
    q?.waiting.filter((v) => v.priority === 'EMERGENCY').forEach((v) => res.todo.push({ ic: 'siren', tone: 'danger', text: `Emergency: ${v.token} ${patient(v.patientId).name}`, sub: v.chiefComplaint || 'Priority patient', href: '#/op/visits/' + v.id, btn: 'See now' }));
    myPatients.filter((a) => a.status === 'ADMITTED' && !a.notes.some((n) => n.kind === 'ROUND' && businessDate(n.at) === today)).slice(0, 4).forEach((a) => res.todo.push({ ic: 'stethoscope', tone: 'info', text: `Round: ${patient(a.patientId).name} (${bedCode(currentBedId(a))})`, sub: a.provisionalDiagnosis, href: '#/ip/admissions/' + a.id, btn: 'Open' }));
    myPatients.filter((a) => a.status === 'DISCHARGE_INITIATED' && a.discharge?.summary?.status !== 'FINAL').forEach((a) => res.todo.push({ ic: 'file-text', tone: 'warning', text: `Finish discharge summary — ${patient(a.patientId).name}`, sub: 'Needed before the patient can leave', href: `#/ip/admissions/${a.id}/discharge`, btn: 'Write' }));
    res.recent = recentCard('Seen today', (q?.done || []).slice(0, 5).map((v) => [`#/op/visits/${v.id}`, 'stethoscope', `${v.token} · ${patient(v.patientId).name}`, (v.consultation?.diagnosis || [])[0] || '', cbadge(v.status)]), '#/op/queue');
  } else if (role === 'NURSE') {
    res.tiles = [T.opDesk, T.beds, T.indents, T.ipList];
    const noVitals = store.all('opVisits').filter((v) => v.businessDate === today && v.status === 'WAITING');
    const cleaning = store.all('beds').filter((b) => b.active && b.state === 'CLEANING');
    res.stats = [stat('OP waiting for vitals', fmtNum(noVitals.length), 'record before the doctor calls', '#/op'), stat('Patients in wards', fmtNum(open.length), `${beds.pct}% occupancy`, '#/ip'),
      stat('Indents pending', fmtNum(pendingIndents.length), `${pendingIndents.filter((i) => i.priority === 'STAT').length} STAT`, '#/ip/indents'), stat('Beds to clean', fmtNum(cleaning.length), 'mark ready after housekeeping', '#/ip')];
    discharging.filter((a) => !a.clearances?.nursing && a.status === 'DISCHARGE_INITIATED').forEach((a) => res.todo.push({ ic: 'log-out', tone: 'warning', text: `Nursing clearance — ${patient(a.patientId).name} (${bedCode(currentBedId(a))})`, sub: 'Discharge initiated by the doctor', href: `#/ip/admissions/${a.id}/discharge`, btn: 'Clear' }));
    noVitals.slice(0, 3).forEach((v) => res.todo.push({ ic: 'heart-pulse', tone: 'info', text: `Vitals for ${v.token} ${patient(v.patientId).name}`, sub: v.chiefComplaint || 'Waiting in OP', href: '#/op/visits/' + v.id, btn: 'Record' }));
    cleaning.slice(0, 2).forEach((b) => res.todo.push({ ic: 'sparkles', tone: 'info', text: `Bed ${b.code} is being cleaned`, sub: 'Mark it ready when done', href: '#/ip', btn: 'Bed board' }));
    res.recent = recentCard('Pending indents', pendingIndents.slice(0, 5).map((i) => [`#/ip/indents`, 'pill-bottle', `${i.id} · ${patient(i.patientId).name}`, `${i.items.length} item(s) · ${relTime(i.raisedAt)}`, cbadge(i.priority === 'STAT' ? 'STAT' : 'RAISED')]), '#/ip/indents');
  } else if (role === 'BILLING') {
    res.tiles = [T.newVisit, T.admit, T.ipList, T.discharge, T.tpa, T.cash];
    res.stats = [stat('Collected by me today', fmtInr(net), `${myRec.length} receipt(s)`, '#/hospital/closing'), stat('OP fees to collect', fmtInr(op.due), 'visits with money due', '#/op'),
      stat('Deposits held', fmtInr(ip.deposits), `${ip.admitted} patients in hospital`, '#/ip/admissions'), stat('Low deposits', fmtNum(ip.low), 'collect an additional deposit', '#/ip/admissions?tab=low')];
    discharging.forEach((a) => { const fb = finalBill(a); res.todo.push({ ic: 'receipt-text', tone: fb ? 'warning' : 'info', text: `${fb ? 'Settle' : 'Final bill for'} ${patient(a.patientId).name}`, sub: fb ? `${fb.id} · ${fb.status.replace(/_/g, ' ').toLowerCase()}` : 'Discharge initiated — waiting for clearances', href: `#/ip/admissions/${a.id}/discharge`, btn: 'Open' }); });
    open.filter((a) => ipPosition(a).low).slice(0, 3).forEach((a) => res.todo.push({ ic: 'wallet', tone: 'danger', text: `Low deposit — ${patient(a.patientId).name}`, sub: `${fmtInr(ipPosition(a).balance)} ahead of deposit`, href: '#/ip/admissions/' + a.id, btn: 'Collect' }));
    res.recent = recentCard('My receipts today', myRec.slice().reverse().slice(0, 5).map((r) => [r.refType === 'OP_BILL' ? `#/op/visits/${store.get('opBills', r.refId)?.visitId}` : `#/ip/admissions/${r.refId}`, r.kind === 'REFUND' ? 'undo-2' : 'receipt', `${patient(r.patientId)?.name || ''} · ${fmtInr(r.amount)}`, `${r.id} · ${r.source} ${r.kind.toLowerCase()} · ${r.mode}`, '']), '#/hospital/closing');
  } else if (role === 'RECEPTION') {
    res.tiles = [T.newVisit, T.admit, T.beds, T.cash];
    store.all('opVisits').filter((v) => v.status === 'REFERRED_IP' && !v.admissionId && v.businessDate >= today).forEach((v) => res.todo.push({ ic: 'hospital', tone: 'warning', text: `Admit ${patient(v.patientId).name}`, sub: `Advised by the doctor (${v.token})`, href: `#/ip/admit?visit=${v.id}`, btn: 'Admit' }));
  }
  if (can('ip.indent.issue') && role !== 'SUPER_ADMIN' && pendingIndents.length) res.todo.unshift({ ic: 'pill-bottle', tone: pendingIndents.some((i) => i.priority === 'STAT') ? 'danger' : 'warning', text: `${pendingIndents.length} ward indent(s) to issue`, sub: pendingIndents.some((i) => i.priority === 'STAT') ? 'Includes STAT requests' : 'Requested by the wards', href: '#/ip/indents', btn: 'Issue' });
  if (can('ip.clear.pharmacy') && role !== 'SUPER_ADMIN') discharging.filter((a) => a.status === 'DISCHARGE_INITIATED' && !a.clearances?.pharmacy).forEach((a) => res.todo.push({ ic: 'log-out', tone: 'warning', text: `Pharmacy clearance — ${patient(a.patientId).name}`, sub: 'Check pending indents and take back unused medicines', href: `#/ip/admissions/${a.id}/discharge`, btn: 'Clear' }));
  if (can('hospital.closing') && role !== 'SUPER_ADMIN') pendingHospitalClosings().filter((p) => p.cashierId === u.id).slice(0, 2).forEach((p) => res.todo.push({ ic: 'calendar-x', tone: 'warning', text: `Close your hospital counter for ${p.date}`, sub: 'OP / IP receipts not closed yet', href: `#/hospital/closing?date=${p.date}`, btn: 'Close now' }));
  return res;
}
const fmtInr = (v) => fmtINR(v, true);
function recentCard(title, rows, href) {
  return `<section class="card"><header class="card-head"><h2>${esc(title)}</h2><a class="btn btn-ghost btn-sm" href="${href}">Open ${icon('arrow-right')}</a></header>
    <div class="todo-list">${rows.length ? rows.map(([h, ic, t, s, b]) => `<a class="todo" href="${h}"><span class="todo-ic sev-info">${icon(ic)}</span><span class="todo-txt"><strong>${esc(t)}</strong><small>${esc(s)}</small></span>${b}</a>`).join('') : `<div class="empty">${icon('inbox')}<h3>Nothing yet</h3></div>`}</div></section>`;
}
