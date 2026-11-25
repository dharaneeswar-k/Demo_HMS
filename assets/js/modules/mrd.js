// MRD (BRD 11): record register, episode file with ICD-10 coding & filing, documents, discharge summary
// (prepare → review → final → print, NABH AAC.14 contents) and the file retrieval register.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { userName } from '../calculations.js';
import { patientAge } from '../patients.js';
import { EPISODE, DS_LABEL, DS_TONE, ICD10, codingOverdue, createRecord, updateRecord, codeAndFile, addDocument, template, sectionLabel, createSummary, saveSummary, reviewSummary, markSummaryPrinted, issueRecord, returnRecord } from '../mrd.js';
import { attachmentURL } from '../attachment-store.js';
import { badge, dataTable, emptyState, openModal, confirmDialog, kpi, tabs, combo } from '../components.js';
import { toast } from '../notifications.js';
import { letterhead, docMeta, signBlock } from '../docs.js';
import { setMeta } from '../app.js';
import { esc, icon, fmtNum, fmtDate, fmtDateTime, relTime, refreshIcons, fileSize, localDateTimeValue } from '../utils.js';

const pat = (id) => store.get('patients', id);
const issuedOf = (rid) => store.all('mrdRetrievals').find((x) => x.recordId === rid && x.status === 'ISSUED');
const summaryOf = (rid) => store.all('dischargeSummaries').find((d) => d.recordId === rid);
function recBadge(r) {
  if (issuedOf(r.id)) return badge('PENDING', 'Issued out');
  if (r.status === 'FILED') return badge('COMPLETED', 'Coded & filed');
  if (r.dischargedAt) return badge(codingOverdue(r) ? 'REJECTED' : 'SUBMITTED', codingOverdue(r) ? 'Coding overdue' : 'To code & file');
  return badge('ACTIVE', 'Patient admitted');
}
const dsBadge = (d) => (d ? `<span class="badge badge-${DS_TONE[d.status]}"><span class="dot"></span>${DS_LABEL[d.status]}</span>` : '<span class="tag tag-neutral">No summary</span>');

export function render(view, params, query) {
  const user = currentUser();
  let tab = query.tab || 'records';
  const recs = () => store.all('medicalRecords').slice().sort((a, b) => b.admittedAt.localeCompare(a.admittedAt));
  view.innerHTML = `<p class="page-intro">One file per admission or day-care episode. After discharge the MRD codes the diagnosis (ICD-10) within ${store.hs().mrd.codingDueDays} days, files it on a rack, and keeps the discharge summary. Every file taken out is logged.</p>
    <div class="kpis mb-2" data-k></div>
    <section class="card"><div class="row-between card-pad"><div data-tabs></div><div class="row"><div class="input-icon" style="width:260px">${icon('search')}<input class="input" data-q placeholder="Patient, MRD no, IP no, diagnosis"></div>${can('mrd.manage') ? `<button class="btn btn-primary" data-new>${icon('folder-plus')}New record</button>` : ''}</div></div><div data-b></div></section>`;
  const draw = () => {
    const R = recs(); const ds = store.all('dischargeSummaries');
    view.querySelector('[data-k]').innerHTML = `${kpi({ label: 'Patients admitted (open files)', value: fmtNum(R.filter((r) => !r.dischargedAt).length), iconName: 'bed-double', tone: 'info' })}
      ${kpi({ label: 'To code & file', value: fmtNum(R.filter((r) => r.dischargedAt && r.status !== 'FILED').length), iconName: 'file-code-2', tone: R.some(codingOverdue) ? 'danger' : 'warning', sub: R.filter(codingOverdue).length ? `${R.filter(codingOverdue).length} overdue` : 'None overdue' })}
      ${kpi({ label: 'Summaries to review', value: fmtNum(ds.filter((d) => d.status === 'PENDING_REVIEW').length), iconName: 'file-signature', tone: 'purple' })}
      ${kpi({ label: 'Files issued out', value: fmtNum(store.all('mrdRetrievals').filter((x) => x.status === 'ISSUED').length), iconName: 'folder-output', tone: 'navy' })}`;
    tabs(view.querySelector('[data-tabs]'), [{ id: 'records', label: 'Records', icon: 'folder-open' }, { id: 'summaries', label: 'Discharge summaries', icon: 'file-text', count: ds.filter((d) => d.status !== 'FINAL').length || null }, { id: 'retrieval', label: 'Retrieval register', icon: 'folder-output' }], tab, (t) => { tab = t; draw(); });
    const q = view.querySelector('[data-q]').value.trim().toLowerCase();
    const mr = (r) => !q || [pat(r.patientId)?.name, pat(r.patientId)?.uhid, r.mrdNo, r.ipNo, r.diagnosis, r.icd10].join(' ').toLowerCase().includes(q);
    const b = view.querySelector('[data-b]'); b.innerHTML = '<div data-t></div>';
    let t;
    if (tab === 'records') t = dataTable({ rows: R.filter(mr), pageSize: 15, onRowClick: (r) => { location.hash = `#/mrd/${r.id}`; }, columns: [
      { key: 'mrdNo', label: 'MRD no', render: (r) => `<span class="mono strong">${esc(r.mrdNo)}</span><div class="cell-sub">${EPISODE[r.episodeType]}${r.ipNo ? ' · ' + esc(r.ipNo) : ''}</div>` },
      { key: 'patient', label: 'Patient', value: (r) => pat(r.patientId)?.name, render: (r) => `${esc(pat(r.patientId)?.name)}<div class="cell-sub mono">${esc(pat(r.patientId)?.uhid)}</div>` },
      { key: 'admittedAt', label: 'Admitted', render: (r) => fmtDate(r.admittedAt) }, { key: 'dischargedAt', label: 'Discharged', render: (r) => (r.dischargedAt ? fmtDate(r.dischargedAt) : '—') },
      { key: 'diagnosis', label: 'Diagnosis', render: (r) => `${esc(r.diagnosis || '—')}${r.icd10 ? ` <span class="tag tag-info mono">${esc(r.icd10)}</span>` : ''}` },
      { key: 'ds', label: 'Summary', sortable: false, render: (r) => dsBadge(summaryOf(r.id)) }, { key: 'status', label: 'File', render: recBadge }] });
    else if (tab === 'summaries') t = dataTable({ rows: ds.filter((d) => mr(store.get('medicalRecords', d.recordId))).sort((a, b2) => b2.preparedAt.localeCompare(a.preparedAt)), pageSize: 15, onRowClick: (d) => { location.hash = `#/mrd/summary/${d.id}`; }, columns: [
      { key: 'id', label: 'Summary', render: (d) => `<span class="mono strong">${d.id}</span><div class="cell-sub">${esc(template(d.templateId)?.name)}</div>` },
      { key: 'patient', label: 'Patient', value: (d) => pat(d.patientId)?.name, render: (d) => esc(pat(d.patientId)?.name) },
      { key: 'rec', label: 'MRD no', value: (d) => store.get('medicalRecords', d.recordId)?.mrdNo, render: (d) => `<span class="mono">${esc(store.get('medicalRecords', d.recordId)?.mrdNo)}</span>` },
      { key: 'preparedBy', label: 'Prepared by', value: (d) => userName(d.preparedBy), render: (d) => `${esc(userName(d.preparedBy))}<div class="cell-sub">${relTime(d.preparedAt)}</div>` },
      { key: 'reviewedBy', label: 'Reviewed by', render: (d) => (d.reviewedBy ? esc(userName(d.reviewedBy)) : '—') }, { key: 'printCount', label: 'Printed', align: 'right' }, { key: 'status', label: 'Status', render: dsBadge }] });
    else t = dataTable({ rows: store.all('mrdRetrievals').slice().sort((a, b2) => b2.at.localeCompare(a.at)), pageSize: 15, columns: [
      { key: 'at', label: 'Requested', render: (x) => fmtDateTime(x.at) }, { key: 'rec', label: 'File', value: (x) => store.get('medicalRecords', x.recordId)?.mrdNo, render: (x) => `<a class="mono" href="#/mrd/${x.recordId}">${esc(store.get('medicalRecords', x.recordId)?.mrdNo)}</a><div class="cell-sub">${esc(pat(store.get('medicalRecords', x.recordId)?.patientId)?.name)}</div>` },
      { key: 'reason', label: 'Reason' }, { key: 'requestedBy', label: 'For', value: (x) => userName(x.requestedBy), render: (x) => esc(userName(x.requestedBy)) }, { key: 'issuedBy', label: 'Issued by', value: (x) => userName(x.issuedBy), render: (x) => esc(userName(x.issuedBy)) },
      { key: 'returnedAt', label: 'Returned', render: (x) => (x.returnedAt ? fmtDateTime(x.returnedAt) : `<span class="text-warning">Out · ${relTime(x.issuedAt)}</span>`) },
      { key: 'act', label: '', sortable: false, render: (x) => (x.status === 'ISSUED' && can('mrd.manage') ? `<button class="btn btn-secondary btn-sm" data-ret="${x.id}">Mark returned</button>` : '') }] });
    b.querySelector('[data-t]').appendChild(t.el);
    b.querySelectorAll('[data-ret]').forEach((x) => { x.onclick = () => { returnRecord(x.dataset.ret, user); toast('File returned to the rack.'); draw(); }; });
    refreshIcons(view);
  };
  view.querySelector('[data-q]').addEventListener('input', draw);
  view.querySelector('[data-new]')?.addEventListener('click', () => openRecordForm(null, (r) => { location.hash = `#/mrd/${r.id}`; }));
  draw();
}

function openRecordForm(rec, done) {
  const user = currentUser(); let pid = rec?.patientId || '';
  openModal({ title: rec ? `Edit ${rec.mrdNo}` : 'New medical record', subtitle: 'Admissions are entered here until the IP module posts them automatically', size: 'lg',
    body: `<div class="form-grid"><div class="field col-8"><label>Patient <span class="req">*</span></label><div data-p></div></div><div class="field col-4"><label>Episode</label><select class="input" data-type>${Object.entries(EPISODE).map(([k, v]) => `<option value="${k}" ${rec?.episodeType === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field col-4"><label>IP number</label><input class="input" data-ip value="${esc(rec?.ipNo || '')}" placeholder="e.g. IP-2026-0150"></div><div class="field col-4"><label>Admitted <span class="req">*</span></label><input class="input" type="datetime-local" data-adm value="${rec ? localDateTimeValue(rec.admittedAt) : localDateTimeValue()}"></div><div class="field col-4"><label>Discharged</label><input class="input" type="datetime-local" data-dis value="${rec?.dischargedAt ? localDateTimeValue(rec.dischargedAt) : ''}"></div>
      <div class="field col-6"><label>Ward / bed</label><input class="input" data-ward value="${esc(rec?.ward || '')}"></div><div class="field col-6"><label>Treating doctor</label><input class="input" data-doc list="mrd-docs" value="${esc(rec?.doctor || '')}"><datalist id="mrd-docs">${(store.ph().doctors || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div class="field col-12"><label>Provisional diagnosis</label><input class="input" data-dx value="${esc(rec?.diagnosis || '')}"></div></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: rec ? 'Save' : 'Create record', cls: 'btn-primary', onClick: (c, w) => {
      const v = (s) => w.querySelector(s).value; const iso = (x) => (x ? new Date(x).toISOString() : null);
      const d = { patientId: pid, episodeType: v('[data-type]'), ipNo: v('[data-ip]'), admittedAt: iso(v('[data-adm]')), dischargedAt: iso(v('[data-dis]')), ward: v('[data-ward]'), doctor: v('[data-doc]'), diagnosis: v('[data-dx]') };
      try { const r = rec ? updateRecord(rec.id, d, user) : createRecord(d, user); c(); toast(rec ? 'Record updated.' : `Record ${r.mrdNo} created.`); done?.(r); } catch (e) { toast(e.message, 'error'); }
    } }],
    onOpen: (w) => combo(w.querySelector('[data-p]'), { value: pid, disabled: !!rec, options: () => store.all('patients').map((p) => ({ value: p.id, label: p.name, sub: `${p.uhid} · ${p.phone}`, keywords: p.uhid + p.phone })), placeholder: 'Search patient…', onChange: (v) => { pid = v; } }) });
}

export function renderRecord(view, params) {
  const user = currentUser();
  const r = store.get('medicalRecords', params.id);
  if (!r) { view.innerHTML = emptyState('folder-x', 'Record not found'); return; }
  const p = pat(r.patientId); const ds = summaryOf(r.id); const iss = issuedOf(r.id);
  setMeta({ title: r.mrdNo, crumbs: [{ label: 'Medical Records', href: '#/mrd' }, r.mrdNo] });
  const labs = store.all('orders').filter((o) => o.patientId === p.id && o.category === 'LAB' && o.status === 'COMPLETED' && o.lab.verifiedAt >= r.admittedAt.slice(0, 10) && (!r.dischargedAt || o.lab.verifiedAt <= r.dischargedAt));
  view.innerHTML = `<div class="row mb-2">${can('mrd.manage') ? `<button class="btn btn-secondary" data-edit>${icon('pencil')}Edit episode</button>${r.dischargedAt && r.status !== 'FILED' ? `<button class="btn btn-primary" data-code>${icon('file-code-2')}Code & file</button>` : ''}${r.status === 'FILED' ? (iss ? `<button class="btn btn-secondary" data-return>${icon('folder-input')}Mark returned</button>` : `<button class="btn btn-secondary" data-issue>${icon('folder-output')}Issue file</button>`) : ''}` : ''}</div>
    <div class="grid grid-3-1"><div>
      <section class="card"><header class="card-head"><div><h2>${EPISODE[r.episodeType]}</h2><p class="muted small">${esc(r.ward || '—')} · ${esc(r.doctor || '—')}</p></div>${recBadge(r)}</header><div class="card-body">
        <div class="dl-grid"><div><span>Admitted</span><strong>${fmtDateTime(r.admittedAt)}</strong></div><div><span>Discharged</span><strong>${r.dischargedAt ? fmtDateTime(r.dischargedAt) : 'Still admitted'}</strong></div><div><span>IP number</span><strong class="mono">${esc(r.ipNo || '—')}</strong></div><div><span>Length of stay</span><strong>${r.dischargedAt ? Math.max(1, Math.round((new Date(r.dischargedAt) - new Date(r.admittedAt)) / 86400000)) + ' day(s)' : '—'}</strong></div>
          <div class="span2"><span>Diagnosis</span><strong>${esc(r.diagnosis || '—')} ${r.icd10 ? `<span class="tag tag-info mono">ICD-10 ${esc(r.icd10)}</span>` : ''}</strong></div><div class="span2"><span>Procedures</span><strong>${esc(r.procedures || '—')}</strong></div>
          <div><span>Coded by</span><strong>${r.codedBy ? esc(userName(r.codedBy)) + ' · ' + fmtDate(r.codedAt) : codingOverdue(r) ? '<span class="text-danger">Overdue</span>' : '—'}</strong></div><div><span>File location</span><strong>${esc(r.location || '—')}${iss ? ` <span class="tag tag-warning">Out: ${esc(iss.reason)}</span>` : ''}</strong></div></div></div></section>
      <section class="card mt-2"><header class="card-head"><h2>Discharge summary</h2>${dsBadge(ds)}</header><div class="card-body">${ds ? `<div class="row"><a class="btn btn-primary" href="#/mrd/summary/${ds.id}">${icon(ds.status === 'FINAL' ? 'eye' : 'pencil')}${ds.status === 'FINAL' ? 'Open' : 'Continue'} ${ds.id}</a>${ds.status === 'FINAL' ? `<a class="btn btn-secondary" href="#/mrd/summary/${ds.id}/print">${icon('printer')}Print</a>` : ''}<span class="muted small">${esc(template(ds.templateId)?.name)} · prepared by ${esc(userName(ds.preparedBy))}</span></div>`
        : can('mrd.manage') ? `<div class="row"><select class="input" style="width:auto" data-tpl>${store.hs().dischargeTemplates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><button class="btn btn-primary" data-ds>${icon('file-plus')}Prepare discharge summary</button></div>` : '<p class="muted">Not prepared yet.</p>'}</div></section>
      <section class="card mt-2"><header class="card-head"><h2>Documents</h2>${can('mrd.manage') ? `<label class="btn btn-secondary btn-sm">${icon('upload')}Add document<input type="file" hidden data-file accept="application/pdf,image/*"></label>` : ''}</header><div class="card-body">${r.documents.length ? `<div class="doc-list">${r.documents.map((d) => `<button class="doc-item" data-open="${d.id}">${icon(d.type.includes('pdf') ? 'file-text' : 'image')}<span><strong>${esc(d.name)}</strong><small>${fileSize(d.size)} · ${fmtDate(d.at)} · ${esc(userName(d.by))}</small></span></button>`).join('')}</div>` : '<p class="muted">No documents scanned yet.</p>'}</div></section>
    </div><div>
      <section class="card"><div class="card-body"><a class="strong" href="#/patients/${p.id}">${esc(p.name)}</a><div class="mono small">${esc(p.uhid)}</div><div class="small muted">${esc(p.gender)}/${patientAge(p) ?? '—'} · ${esc(p.phone)}</div>${p.allergies ? `<div class="tag tag-danger mt-1">Allergy: ${esc(p.allergies)}</div>` : ''}<div class="divider"></div><div class="kv"><span>MRD no</span><strong class="mono">${esc(r.mrdNo)}</strong></div><div class="kv"><span>Created</span><span>${fmtDate(r.createdAt)} · ${esc(userName(r.createdBy))}</span></div></div></section>
      <section class="card mt-2"><header class="card-head"><h2>Lab reports in this stay</h2></header><div class="card-body">${labs.length ? labs.map((o) => `<a class="kv" href="#/lab/report/${o.id}"><span>${esc(o.name)}</span><span class="mono small">${o.lab.reportNo}</span></a>`).join('') : '<p class="muted small">None.</p>'}</div></section></div></div>`;
  const again = () => renderRecord(view, params);
  view.querySelector('[data-edit]')?.addEventListener('click', () => openRecordForm(r, again));
  view.querySelector('[data-code]')?.addEventListener('click', () => openModal({ title: 'Code & file', subtitle: r.mrdNo, size: 'md',
    body: `<div class="field"><label>Final diagnosis</label><input class="input" data-dx value="${esc(r.diagnosis)}"></div><div class="form-grid mt-1"><div class="field col-5"><label>ICD-10 code</label><input class="input mono" data-icd list="icd-list" value="${esc(r.icd10 || '')}" placeholder="e.g. J18.9"><datalist id="icd-list">${ICD10.map(([c, d]) => `<option value="${c}">${esc(d)}</option>`).join('')}</datalist></div><div class="field col-7"><label>File location (rack / shelf)</label><input class="input" data-loc value="${esc(r.location === 'With ward' ? '' : r.location)}" placeholder="e.g. Rack B-4, Shelf 2"></div></div><div class="field mt-1"><label>Procedures</label><input class="input" data-proc value="${esc(r.procedures)}"></div><div class="muted small mt-1" data-icdhelp></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Code & file', cls: 'btn-primary', onClick: (c, w) => { try { codeAndFile(r.id, { diagnosis: w.querySelector('[data-dx]').value, icd10: w.querySelector('[data-icd]').value, procedures: w.querySelector('[data-proc]').value, location: w.querySelector('[data-loc]').value }, user); c(); toast('Coded and filed.'); again(); } catch (e) { toast(e.message, 'error'); } } }],
    onOpen: (w) => { const i = w.querySelector('[data-icd]'); const h = () => { const m = ICD10.find(([c]) => c === i.value.trim().toUpperCase()); w.querySelector('[data-icdhelp]').textContent = m ? `${m[0]} — ${m[1]}` : ''; }; i.addEventListener('input', h); h(); } }));
  view.querySelector('[data-issue]')?.addEventListener('click', () => openModal({ title: 'Issue file', subtitle: r.mrdNo, size: 'sm', body: `<div class="field"><label>Reason</label><select class="input" data-r>${store.hs().mrd.retrievalReasons.map((x) => `<option>${esc(x)}</option>`).join('')}</select></div><div class="field mt-1"><label>Issued to</label><select class="input" data-u>${store.all('users').filter((u) => u.active).map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>`,
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Issue', cls: 'btn-primary', onClick: (c, w) => { try { issueRecord(r.id, { reason: w.querySelector('[data-r]').value, requestedBy: w.querySelector('[data-u]').value }, user); c(); toast('File issued and logged.'); again(); } catch (e) { toast(e.message, 'error'); } } }] }));
  view.querySelector('[data-return]')?.addEventListener('click', () => { returnRecord(iss.id, user); toast('File returned.'); again(); });
  view.querySelector('[data-ds]')?.addEventListener('click', () => { try { const d = createSummary(r.id, view.querySelector('[data-tpl]').value, user); location.hash = `#/mrd/summary/${d.id}`; } catch (e) { toast(e.message, 'error'); } });
  view.querySelector('[data-file]')?.addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; try { await addDocument(r.id, f, user); toast('Document added.'); again(); } catch (err) { toast(err.message, 'error'); } });
  view.querySelectorAll('[data-open]').forEach((b) => { b.onclick = async () => { const d = r.documents.find((x) => x.id === b.dataset.open); const url = d.demo ? null : await attachmentURL(d).catch(() => null); if (url) window.open(url, '_blank'); else toast('This sample document has no scanned file. Uploaded documents open here.', 'info'); }; });
  refreshIcons(view);
}

export function renderSummary(view, params) {
  const user = currentUser();
  const d = store.get('dischargeSummaries', params.id);
  if (!d) { view.innerHTML = emptyState('file-x', 'Summary not found'); return; }
  const r = store.get('medicalRecords', d.recordId); const p = pat(d.patientId); const tpl = template(d.templateId);
  setMeta({ title: `Discharge summary ${d.id}`, crumbs: [{ label: 'Medical Records', href: '#/mrd' }, { label: r.mrdNo, href: `#/mrd/${r.id}` }, d.id] });
  const editable = d.status !== 'FINAL' && d.status !== 'PENDING_REVIEW' && can('mrd.manage');
  view.innerHTML = `<div class="row mb-2">${dsBadge(d)}<span class="muted small">${esc(tpl.name)} · ${esc(p.name)} · ${esc(r.mrdNo)}</span><span class="grow"></span>
      ${editable ? `<button class="btn btn-secondary" data-save>${icon('save')}Save draft</button><button class="btn btn-primary" data-submit>${icon('send')}Send for review</button>` : ''}
      ${d.status === 'PENDING_REVIEW' && can('mrd.review') ? `<button class="btn btn-danger-outline" data-back>Send back</button><button class="btn btn-primary" data-final>${icon('badge-check')}Approve & finalise</button>` : ''}
      ${d.status === 'FINAL' ? `<a class="btn btn-primary" href="#/mrd/summary/${d.id}/print">${icon('printer')}Print</a>` : ''}</div>
    <div class="grid grid-3-1"><section class="card"><div class="card-body ds-form">${tpl.sections.map((k) => `<div class="field"><label>${esc(sectionLabel(k))}</label>${editable ? `<textarea class="input" rows="${['medications', 'investigations', 'course', 'treatment'].includes(k) ? 4 : 2}" data-s="${k}">${esc(d.sections[k] || '')}</textarea>` : `<div class="ds-read">${esc(d.sections[k] || '—').replace(/\n/g, '<br>')}</div>`}</div>`).join('')}</div></section>
      <div><section class="card"><header class="card-head"><h2>History</h2></header><div class="card-body">${d.history.slice().reverse().map((h) => `<div class="tl-item"><strong>${esc(h.action)}</strong><small>${esc(userName(h.by))} · ${fmtDateTime(h.at)}</small></div>`).join('')}</div></section>
        <section class="card mt-2"><div class="card-body small muted">Contents follow NABH AAC.14: identifiers, dates, reason for admission, significant findings, investigation results, final diagnosis, procedures, treatment, condition at discharge, medicines, follow-up and when to seek urgent care.</div></section></div></div>`;
  const read = () => Object.fromEntries([...view.querySelectorAll('[data-s]')].map((t) => [t.dataset.s, t.value]));
  view.querySelector('[data-save]')?.addEventListener('click', () => { try { saveSummary(d.id, read(), user); toast('Draft saved.'); } catch (e) { toast(e.message, 'error'); } });
  view.querySelector('[data-submit]')?.addEventListener('click', () => { try { saveSummary(d.id, read(), user, true); toast('Sent for review.'); renderSummary(view, params); } catch (e) { toast(e.message, 'error'); } });
  view.querySelector('[data-final]')?.addEventListener('click', async () => { if (!(await confirmDialog({ title: 'Finalise this discharge summary?', iconName: 'badge-check', confirmLabel: 'Finalise', message: 'A final summary cannot be edited and is ready to print for the patient.' }))) return; reviewSummary(d.id, true, '', user); toast('Summary finalised.'); renderSummary(view, params); });
  view.querySelector('[data-back]')?.addEventListener('click', async () => { const res = await confirmDialog({ title: 'Send back for correction', reason: true, reasonLabel: 'What needs to change?', confirmLabel: 'Send back', tone: 'danger', message: 'The MRD officer is notified.' }); if (!res) return; try { reviewSummary(d.id, false, res.reason, user); toast('Sent back.'); renderSummary(view, params); } catch (e) { toast(e.message, 'error'); } });
  refreshIcons(view);
}

export function renderSummaryPrint(view, params) {
  const user = currentUser();
  const d = store.get('dischargeSummaries', params.id);
  if (!d || d.status !== 'FINAL') { view.innerHTML = emptyState('file-x', 'Only a final summary can be printed'); return; }
  const r = store.get('medicalRecords', d.recordId); const p = pat(d.patientId); const tpl = template(d.templateId);
  setMeta({ title: `Print ${d.id}`, crumbs: [{ label: 'Medical Records', href: '#/mrd' }, d.id, 'Print'] });
  view.innerHTML = `<div class="row mb-2 no-print" style="justify-content:center"><button class="btn btn-primary" data-print>${icon('printer')}Print / Save PDF</button><a class="btn btn-ghost" href="#/mrd/summary/${d.id}">${icon('arrow-left')}Back</a></div>
    <article class="doc">${letterhead(d.templateId === 'TPL-DEATH' ? 'DEATH SUMMARY' : 'DISCHARGE SUMMARY', { sub: tpl.name, code: r.mrdNo.replace(/\//g, '-') })}
      ${docMeta([['Patient', esc(p.name)], ['Patient ID', `<span class="mono">${esc(p.uhid)}</span>`], ['Age / Sex', `${patientAge(p) ?? '—'} Y / ${esc(p.gender)}`], ['IP no', esc(r.ipNo || '—')], ['Admitted', fmtDateTime(r.admittedAt)], ['Discharged', r.dischargedAt ? fmtDateTime(r.dischargedAt) : '—'], ['Ward', esc(r.ward || '—')], ['Treating doctor', esc(r.doctor || '—')]])}
      ${tpl.sections.map((k) => `<section class="ds-sec"><h4>${esc(sectionLabel(k))}</h4><p>${esc(d.sections[k] || '—').replace(/\n/g, '<br>')}</p></section>`).join('')}
      ${p.allergies ? `<section class="ds-sec"><h4>Known allergies</h4><p><strong>${esc(p.allergies)}</strong></p></section>` : ''}
      ${signBlock([['Prepared by (MRD)', userName(d.preparedBy)], ['Treating doctor', r.doctor || ''], ['Reviewed & approved', userName(d.reviewedBy)]])}
      <p class="rc-small">In an emergency call the hospital or come to the casualty immediately. Bring this summary on every follow-up visit.</p></article>`;
  view.querySelector('[data-print]').onclick = () => { markSummaryPrinted(d.id, user); window.print(); };
  refreshIcons(view);
}
