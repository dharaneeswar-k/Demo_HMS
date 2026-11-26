// Sample collection dialog — three clear steps: confirm the patient, stick the labels in front of them,
// scan (or tick) each tube. Shows progress and closes itself with a confirmation when every tube is in.
// Also holds the reject dialog and "receive" helpers shared by the workbench and the SID page.
import { currentUser } from '../../auth.js';
import { visit, visitAccess, tubesFor, collectTube, receiveTube, rejectTube, callToken } from '../../labflow.js';
import { openModal, confirmDialog } from '../../components.js';
import { toast } from '../../notifications.js';
import { esc, refreshIcons } from '../../utils.js';
import { pat, ageSex, cap, tubeInfo, clock, srcPill, priPill } from './ui.js';
import { icon } from './bi.js';

export function openCollection(visitId, done) {
  const user = currentUser(); const v0 = visit(visitId); const p = pat(v0.patientId); const a = visitAccess(v0);
  if (!a.ok) { toast('Payment is not cleared. Send the patient to the main counter first.', 'error'); return; }
  const live = () => tubesFor(visit(visitId)).filter((t) => t.orders.some((o) => o.status !== 'CANCELLED'));
  let closeFn = null;
  const draw = (w) => {
    const ts = live(); const n = ts.filter((t) => t.collectedAt).length; const all = n === ts.length;
    w.querySelector('[data-prog]').innerHTML = `<div class="lc-bar"><i style="width:${ts.length ? (n / ts.length) * 100 : 0}%"></i></div><span><strong>${n} of ${ts.length}</strong> tube${ts.length > 1 ? 's' : ''} collected</span>`;
    w.querySelector('[data-tubes]').innerHTML = ts.map((t) => { const ti = tubeInfo(t.container); return `<div class="lc-tube ${t.collectedAt ? 'ok' : ''} ${t.rejected && !t.collectedAt ? 'redo' : ''}">
        ${cap(t.container, 'lg')}<div class="lc-tube-main"><strong>${esc(ti.name)}</strong><small>${esc(ti.sub)}</small><span class="mono">${t.code}</span>
        <em>${t.orders.filter((o) => o.status !== 'CANCELLED').map((o) => esc(o.name)).join(', ')}</em>${t.rejected && !t.collectedAt ? `<em class="lc-redo">${icon('rotate-ccw')}Recollect — ${esc(t.rejected.reason)}</em>` : ''}</div>
        ${t.collectedAt ? `<span class="lc-done">${icon('check-circle-2')}Collected ${clock(t.collectedAt)}</span>` : `<button class="btn btn-secondary btn-sm" data-tube="${t.code}">${icon('check')}Collected</button>`}</div>`; }).join('');
    w.querySelectorAll('[data-tube]').forEach((b) => { b.onclick = () => mark(w, b.dataset.tube); });
    const btn = w.querySelector('.modal-foot .btn-primary');
    if (btn) { btn.innerHTML = all ? `${icon('check-check')}All collected — done` : 'Done for now'; btn.classList.toggle('btn-success', all); }
    refreshIcons(w);
  };
  const mark = (w, code) => {
    try { collectTube(visitId, code.trim(), user); toast(`${code.trim()} collected.`); draw(w);
      if (live().every((t) => t.collectedAt)) setTimeout(() => { toast('All tubes collected. Send them to the lab.', 'success'); closeFn?.(); done?.(); }, 650);
    } catch (e) { toast(e.message, 'error'); }
  };
  openModal({ title: 'Collect sample', subtitle: `SID ${v0.sid}`, size: 'md',
    body: `<div class="lc">
      <div class="lc-patient"><span class="lx-avatar">${esc(p.name.split(' ').map((x) => x[0]).slice(0, 2).join(''))}</span><div><strong>${esc(p.name)}</strong><small>${esc(ageSex(p))} · <span class="mono">${esc(p.uhid)}</span>${v0.collectionPoint === 'WARD' ? ` · ${esc(v0.ward)} bed ${esc(v0.bed)}` : v0.token ? ` · Token ${v0.token}` : ''}</small></div><div class="lc-pills">${srcPill(v0)}${priPill(v0)}</div></div>
      ${p.allergies ? `<div class="lx-note danger">${icon('alert-triangle')}Allergy: ${esc(p.allergies)}</div>` : ''}
      <ol class="lc-how"><li><b>1</b>Ask the patient's name${v0.collectionPoint === 'WARD' ? ' and check the wrist band' : ''}. It must match the name above.</li><li><b>2</b>Print the labels and stick one on each tube <strong>in front of the patient</strong>.</li><li><b>3</b>Scan each tube after collection, or press <em>Collected</em>.</li></ol>
      <div class="lc-actions"><button class="btn btn-secondary" data-print>${icon('printer')}Print labels</button><div class="input-icon grow">${icon('scan-barcode')}<input class="input" data-scan placeholder="Scan the tube label here"></div></div>
      <div class="lc-prog" data-prog></div><div class="lc-tubes" data-tubes></div></div>`,
    footer: [{ label: 'Done for now', cls: 'btn-primary', onClick: (c) => { c(); done?.(); } }],
    onOpen: (w, close) => {
      closeFn = close;
      draw(w);
      w.querySelector('[data-print]').onclick = () => window.open(`#/lab/visit/${visitId}/labels`, '_blank');
      const s = w.querySelector('[data-scan]'); setTimeout(() => s.focus(), 60);
      s.addEventListener('keydown', (e) => { if (e.key === 'Enter' && s.value.trim()) { mark(w, s.value); s.value = ''; } });
    } });
}

export async function rejectTubeDialog(code, done) {
  const r = await confirmDialog({ title: `Reject tube ${code}?`, tone: 'danger', iconName: icon('x-circle'), confirmLabel: 'Reject & ask for new sample', reason: true, reasonLabel: 'Why is the sample rejected?', reasonPlaceholder: 'Haemolysed · clotted · not enough · wrong tube · no label',
    message: 'The patient (or the ward) is asked for a fresh sample. The kit already used is logged as a repeat test.' });
  if (!r) return false;
  try { rejectTube(code, r.reason, currentUser()); toast('Sample rejected — recollection requested.', 'warning'); done?.(); return true; } catch (e) { toast(e.message, 'error'); return false; }
}

export function receiveCodes(codes) {
  const user = currentUser(); let ok = 0;
  for (const c of codes) { try { receiveTube(c, user); ok++; } catch (e) { toast(e.message, 'error'); } }
  if (ok) toast(ok === 1 ? `${codes[0]} received in the lab.` : `${ok} tubes received in the lab.`);
  return ok;
}

export function callPatient(visitId) {
  try { const v = callToken(visitId, currentUser()); toast(`Token ${v.token} called to the collection room.`); } catch (e) { toast(e.message, 'error'); }
}
