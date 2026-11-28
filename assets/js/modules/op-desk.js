// OP Desk (live day board), OP Register (all visits) and the waiting-area token display.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { businessDate } from '../pharmacy-calc.js';
import { activeDoctors, doctorName, department, deptName, patient, cbadge, label, doctorWorksOn, doctorForUser } from '../clinical.js';
import { doctorQueue, opDaySummary, visitDue, visitBilled, avgConsultMinutes, visitsOn, consultPaid } from '../op.js';
import { kpi, dataTable, emptyState, exportTable } from '../components.js';
import { esc, icon, fmtINR, fmtNum, fmtDateTime, refreshIcons, debounce, ymd } from '../utils.js';
import { openVitals } from './op-visit.js';
import { setMeta } from '../app.js';

const typeTag = (v) => v.priority === 'EMERGENCY' ? `<span class="tag tag-danger">${icon('siren')}Emergency</span>` : `<span class="tag tag-${v.visitType === 'NEW' ? 'info' : v.visitType === 'FOLLOW_UP' ? 'success' : 'purple'}">${esc(label(v.visitType))}</span>`;
export { typeTag };

export function render(view) {
  const u = currentUser(); const today = businessDate();
  const draw = () => {
    const s = opDaySummary(today);
    const docs = activeDoctors().filter((d) => doctorWorksOn(d, today) || visitsOn(today).some((v) => v.doctorId === d.id));
    view.innerHTML = `
      <div class="page-head"><div><p class="muted">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · live outpatient board. Tokens are issued per doctor; emergencies jump the queue.</p></div>
        <div class="page-actions"><a class="btn btn-secondary" href="#/op/display" target="_blank" rel="noopener">${icon('monitor')}Token display</a>${can('op.register') ? `<a class="btn btn-primary" href="#/op/new">${icon('user-round-plus')}New OP visit</a>` : ''}</div></div>
      <div class="kpis">
        ${kpi({ label: 'Visits today', value: fmtNum(s.visits), iconName: 'users-round', tone: 'teal', sub: `${s.newPatients} new · ${s.emergency} emergency` })}
        ${kpi({ label: 'Waiting', value: fmtNum(s.waiting), iconName: 'hourglass', tone: 'warning', sub: 'in all queues' })}
        ${kpi({ label: 'In consultation', value: fmtNum(s.inConsult), iconName: 'stethoscope', tone: 'purple' })}
        ${kpi({ label: 'Completed', value: fmtNum(s.completed), iconName: 'check-circle-2', tone: 'success' })}
        ${can('op.bill') || can('hospital.approve') ? kpi({ label: 'OP collection', value: fmtINR(s.collected, true), iconName: 'indian-rupee', tone: 'navy', sub: s.due ? `${fmtINR(s.due, true)} still to collect` : 'all collected' }) : ''}
      </div>
      <h2 class="home-h">Doctors on duty</h2>
      <div class="doc-board">${docs.length ? docs.map((d) => docCard(d, today)).join('') : emptyState('calendar-off', 'No doctors on duty today')}</div>
      <section class="card mt-2"><header class="card-head"><div><h2>Today's visits</h2><p class="muted small">Newest first. Click a row to open the visit.</p></div>
        <div class="card-actions"><div class="chip-row" data-chips>${['ALL', 'WAITING', 'VITALS_DONE', 'IN_CONSULTATION', 'COMPLETED', 'DUE'].map((c, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-c="${c}">${c === 'ALL' ? 'All' : c === 'DUE' ? 'Money to collect' : esc(label(c))}</button>`).join('')}</div></div></header>
        <div data-table></div></section>`;
    const rows = visitsOn(today).sort((a, b) => b.at.localeCompare(a.at));
    const cols = [
      { key: 'token', label: 'Token', render: (v) => `<strong class="mono">${esc(v.token)}</strong>`, value: (v) => v.at },
      { key: 'patient', label: 'Patient', value: (v) => patient(v.patientId)?.name, render: (v) => { const p = patient(v.patientId); return `<div class="cell-main">${esc(p.name)}</div><div class="cell-sub">${esc(p.uhid)} · ${esc(v.chiefComplaint || '')}</div>`; } },
      { key: 'doctor', label: 'Doctor', value: (v) => doctorName(v.doctorId), render: (v) => `<div class="cell-main">${esc(doctorName(v.doctorId))}</div><div class="cell-sub">${esc(deptName(v.departmentId))}</div>` },
      { key: 'type', label: 'Type', value: (v) => v.visitType, render: typeTag },
      { key: 'status', label: 'Status', value: (v) => v.status, render: (v) => ['WAITING', 'VITALS_DONE'].includes(v.status) && !consultPaid(v) ? cbadge('DISCOUNT_PENDING', 'Fee pending — not in queue') : cbadge(v.status) },
      { key: 'due', label: 'Billing', align: 'right', value: (v) => visitDue(v), render: (v) => { const d = visitDue(v); return d ? `<span class="text-danger strong">${fmtINR(d)} due</span>` : `<span class="muted">${fmtINR(visitBilled(v))}</span>`; } },
      { key: 'act', label: '', sortable: false, render: (v) => ['WAITING', 'VITALS_DONE'].includes(v.status) && can('op.vitals') ? `<button class="btn btn-secondary btn-sm" data-vitals="${v.id}">${icon('heart-pulse')}${v.vitals ? 'Edit vitals' : 'Vitals'}</button>` : '' }
    ];
    const t = dataTable({ columns: cols, rows, pageSize: 10, onRowClick: (v) => { location.hash = '#/op/visits/' + v.id; }, empty: emptyState('stethoscope', 'No OP visits yet today', can('op.register') ? 'Create the first visit with “New OP visit”.' : '') });
    view.querySelector('[data-table]').appendChild(t.el);
    view.querySelector('[data-chips]').addEventListener('click', (e) => {
      const c = e.target.closest('[data-c]'); if (!c) return;
      view.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('active', x === c));
      const k = c.dataset.c;
      t.setRows(k === 'ALL' ? rows : k === 'DUE' ? rows.filter((v) => visitDue(v) > 0) : rows.filter((v) => v.status === k || (k === 'COMPLETED' && v.status === 'REFERRED_IP')));
    });
    view.onclick = (e) => { const b = e.target.closest('[data-vitals]'); if (b) openVitals(b.dataset.vitals, draw); };
    refreshIcons(view);
  };
  draw();
  const off = store.subscribe(debounce(draw, 300));
  const tick = setInterval(draw, 60000);
  return () => { off(); clearInterval(tick); view.onclick = null; };
}

function docCard(d, date) {
  const q = doctorQueue(d.id, date);
  const cur = q.current[0]; const next = q.waiting.slice(0, 3);
  const seen = q.done.length; const total = q.total - q.other.length;
  const mins = avgConsultMinutes(d.id);
  const me = doctorForUser(currentUser())?.id === d.id;
  return `<a class="doc-card ${me ? 'mine' : ''}" href="#/op/queue?doctor=${d.id}">
    <div class="doc-card-head"><span class="doc-av">${esc(department(d.departmentId).code)}</span><div class="grow"><strong>${esc(d.name)}</strong><small>${esc(deptName(d.departmentId))} · ${esc(d.room)} · ${esc(d.start)}–${esc(d.end)}</small></div>
      ${q.waiting.length ? `<span class="badge badge-warning"><span class="dot"></span>${q.waiting.length} waiting</span>` : '<span class="badge badge-success"><span class="dot"></span>No queue</span>'}</div>
    <div class="doc-card-body"><div><span class="lbl-sm">Now serving</span><div class="token-big ${cur ? '' : 'muted'}">${cur ? esc(cur.token) : '—'}</div></div>
      <div class="grow"><span class="lbl-sm">Next</span>${next.length ? next.map((v) => `<div class="next-row"><span class="mono">${esc(v.token)}</span> ${esc(patient(v.patientId).name.split(' ')[0])} ${v.priority === 'EMERGENCY' ? '<span class="tag tag-danger">ER</span>' : v.status === 'VITALS_DONE' ? '<span class="tag tag-info">Vitals ✓</span>' : ''}</div>`).join('') : '<div class="muted small">Nobody waiting</div>'}</div></div>
    <div class="progress"><span style="width:${total ? Math.round(seen / total * 100) : 0}%"></span></div>
    <div class="doc-card-foot"><span>${seen} of ${total} seen</span><span>~${mins} min / patient${q.waiting.length ? ` · next wait ~${q.waiting.length * mins} min` : ''}</span></div></a>`;
}

// ---------------- OP register ----------------
export function renderRegister(view, params, query) {
  const today = businessDate();
  const st = { from: query.from || ymd(new Date(Date.now() - 6 * 86400000)), to: query.to || today, doctor: query.doctor || '', status: query.status || '', type: '', q: '' };
  view.innerHTML = `<div class="page-head"><div><p class="muted">Every OP visit with its token, doctor, diagnosis and billing. Use the filters and export to CSV for reports.</p></div>
    <div class="page-actions"><button class="btn btn-secondary" data-csv>${icon('download')}Export CSV</button></div></div>
    <section class="card flush"><div class="toolbar">
      <div class="search">${icon('search')}<input class="input" data-q placeholder="Token, visit no., patient, Patient ID, diagnosis…"></div>
      <label class="filter-label">From <input class="input" type="date" data-from value="${st.from}"></label><label class="filter-label">To <input class="input" type="date" data-to value="${st.to}"></label>
      <select class="input" data-doc><option value="">All doctors</option>${store.all('doctors').map((d) => `<option value="${d.id}" ${st.doctor === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      <select class="input" data-st><option value="">All statuses</option>${['WAITING', 'VITALS_DONE', 'IN_CONSULTATION', 'COMPLETED', 'REFERRED_IP', 'NO_SHOW', 'CANCELLED'].map((s) => `<option value="${s}" ${st.status === s ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select>
      <select class="input" data-type><option value="">All visit types</option>${['NEW', 'REVISIT', 'FOLLOW_UP', 'EMERGENCY'].map((s) => `<option value="${s}">${esc(label(s))}</option>`).join('')}</select>
    </div><div data-sum class="reg-sum"></div><div data-table></div></section>`;
  const cols = [
    { key: 'id', label: 'Visit', render: (v) => `<div class="cell-main mono">${esc(v.id)}</div><div class="cell-sub">${fmtDateTime(v.at)}</div>`, value: (v) => v.at, csv: (v) => v.id },
    { key: 'date', label: 'Date', value: (v) => v.businessDate, render: (v) => esc(v.businessDate), csv: (v) => v.businessDate },
    { key: 'token', label: 'Token', render: (v) => `<span class="mono strong">${esc(v.token)}</span>` },
    { key: 'patient', label: 'Patient', value: (v) => patient(v.patientId)?.name, render: (v) => { const p = patient(v.patientId); return `<div class="cell-main">${esc(p.name)}</div><div class="cell-sub">${esc(p.uhid)}</div>`; }, csv: (v) => `${patient(v.patientId).name} (${patient(v.patientId).uhid})` },
    { key: 'doctor', label: 'Doctor', value: (v) => doctorName(v.doctorId), render: (v) => esc(doctorName(v.doctorId)) },
    { key: 'type', label: 'Type', value: (v) => label(v.visitType), render: typeTag },
    { key: 'dx', label: 'Diagnosis', value: (v) => (v.consultation?.diagnosis || []).join('; '), render: (v) => `<span class="small">${esc((v.consultation?.diagnosis || []).join('; ') || '—')}</span>` },
    { key: 'status', label: 'Status', value: (v) => label(v.status), render: (v) => cbadge(v.status) },
    { key: 'billed', label: 'Billed', align: 'right', value: (v) => visitBilled(v), render: (v) => fmtINR(visitBilled(v)) + (visitDue(v) ? `<div class="cell-sub text-danger">${fmtINR(visitDue(v))} due</div>` : '') }
  ];
  const t = dataTable({ columns: cols, rows: [], pageSize: 25, onRowClick: (v) => { location.hash = '#/op/visits/' + v.id; }, sort: { key: 'id', dir: 'desc' } });
  view.querySelector('[data-table]').appendChild(t.el);
  const apply = () => {
    const q = st.q.trim().toLowerCase();
    const rows = store.all('opVisits').filter((v) => v.businessDate >= st.from && v.businessDate <= st.to && (!st.doctor || v.doctorId === st.doctor) && (!st.status || v.status === st.status) && (!st.type || v.visitType === st.type)
      && (!q || [v.id, v.token, patient(v.patientId)?.name, patient(v.patientId)?.uhid, ...(v.consultation?.diagnosis || [])].join(' ').toLowerCase().includes(q)));
    t.setRows(rows);
    const billed = rows.reduce((s, v) => s + visitBilled(v), 0);
    view.querySelector('[data-sum]').innerHTML = `<span><strong>${fmtNum(rows.length)}</strong> visits</span><span><strong>${fmtNum(rows.filter((v) => v.visitType === 'NEW').length)}</strong> new patients</span><span><strong>${fmtNum(rows.filter((v) => v.status === 'REFERRED_IP').length)}</strong> referred to IP</span><span>Billed <strong>${fmtINR(billed, true)}</strong></span>`;
  };
  const on = (s, k, ev = 'change') => view.querySelector(s).addEventListener(ev, (e) => { st[k] = e.target.value; apply(); });
  on('[data-from]', 'from'); on('[data-to]', 'to'); on('[data-doc]', 'doctor'); on('[data-st]', 'status'); on('[data-type]', 'type');
  view.querySelector('[data-q]').addEventListener('input', debounce((e) => { st.q = e.target.value; apply(); }, 150));
  view.querySelector('[data-csv]').onclick = () => exportTable(`op-register-${st.from}-to-${st.to}.csv`, cols, t.getRows());
  apply();
}

// ---------------- token display (TV) ----------------
export function renderDisplay(view) {
  document.body.classList.add('tv-mode');
  setMeta({ title: 'Token Display' });
  const s = store.settings();
  const draw = () => {
    const today = businessDate();
    const docs = activeDoctors().filter((d) => visitsOn(today).some((v) => v.doctorId === d.id));
    const t = new Date();
    view.innerHTML = `<div class="tv">
      <header class="tv-head"><div class="tv-brand"><span class="rc-mark">${esc(s.hospitalName.slice(0, 1))}</span><div><strong>${esc(s.hospitalName)}</strong><small>Outpatient Department</small></div></div>
        <div class="tv-clock"><strong>${t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</strong><small>${t.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</small></div>
        <a class="btn btn-ghost tv-exit no-print" href="#/op">${icon('x')}Exit</a></header>
      <div class="tv-grid">${docs.length ? docs.map((d) => { const q = doctorQueue(d.id, today); const cur = q.current[0];
        return `<div class="tv-card"><div class="tv-room">${esc(d.room)}</div><div class="tv-doc">${esc(d.name)}<small>${esc(deptName(d.departmentId))}</small></div>
          <div class="tv-now"><small>Now serving</small><span>${cur ? esc(cur.token) : '—'}</span>${cur ? `<b class="tv-name">${esc(patient(cur.patientId).name)}</b>` : ''}</div>
          <div class="tv-next"><small>Next</small>${q.waiting.slice(0, 4).map((v) => `<div class="tv-row"><span class="${v.priority === 'EMERGENCY' ? 'er' : ''}">${esc(v.token)}</span><b>${esc(patient(v.patientId).name)}</b></div>`).join('') || '<em>—</em>'}</div></div>`; }).join('') : '<div class="tv-empty">OP will begin shortly.</div>'}</div>
      <footer class="tv-foot">Please wait until your name and token number appear, then hand your OP sheet to the attendant at the doctor's room. Emergency patients are seen first.</footer></div>`;
    refreshIcons(view);
  };
  draw();
  const off = store.subscribe(debounce(draw, 200));
  const iv = setInterval(draw, (Number(store.all('clinicalSettings').op.displayRefreshSec) || 10) * 1000);
  return () => { off(); clearInterval(iv); document.body.classList.remove('tv-mode'); };
}
