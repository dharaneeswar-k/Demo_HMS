// Medicine Master — stable medicine information only. Batch, expiry, MRP and PTR live on batch records.
import { store } from '../data-service.js';
import { currentUser, can } from '../auth.js';
import { medicineStockMap, stockStatus } from '../calculations.js';
import { audit } from '../services.js';
import { badge, dataTable, exportTable, openModal, confirmDialog, emptyState } from '../components.js';
import { validateForm } from '../validation.js';
import { toast } from '../notifications.js';
import { esc, icon, fmtNum, ymd, debounce } from '../utils.js';
import { navigate } from '../router.js';

const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Cream', 'Ointment', 'Drops', 'IV Fluid', 'Powder', 'Inhaler', 'Consumable'];
const UNITS = ['Strip', 'Bottle', 'Vial', 'Ampoule', 'Tube', 'Piece', 'Pair', 'Box', 'Roll', 'Sachet'];

export function createMedicine(d, user) {
  return store.transaction(() => {
    const id = store.nextId('medicines', 'MED-');
    const dup = store.all('medicines').find((m) => m.brandName.trim().toLowerCase() === d.brandName.trim().toLowerCase() && String(m.strength).toLowerCase() === String(d.strength).toLowerCase());
    if (dup) throw new Error(`${dup.brandName} ${dup.strength} already exists (${dup.code}).`);
    const m = store.insert('medicines', {
      id, code: id, brandName: d.brandName.trim(), genericName: d.genericName.trim(), composition: d.composition || d.genericName, strength: d.strength, form: d.form,
      manufacturer: d.manufacturer, category: d.category, unit: d.unit, packSize: d.packSize || '', purchaseUnit: d.purchaseUnit || d.unit, dispensingUnit: d.unit,
      conversion: Number(d.conversion) || 1, hsnCode: d.hsnCode || '', gstPct: Number(d.gstPct) || 0, reorderLevel: Number(d.reorderLevel) || 0,
      minStockLevel: Number(d.minStockLevel) || Math.floor((Number(d.reorderLevel) || 0) / 2), storage: d.storage || '', barcode: d.barcode || ('20' + id.replace(/\D/g, '').padStart(11, '0')), active: true, createdAt: new Date().toISOString()
    });
    audit(user, 'MEDICINE_CREATED', 'MEDICINE', id, `${m.brandName} ${m.strength}`);
    return m;
  });
}

function formHTML(m = {}) {
  const v = (k, d = '') => esc(m[k] ?? d);
  const sel = (name, opts, cur) => `<select class="input" name="${name}">${opts.map((o) => `<option ${String(o) === String(cur) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  return `<form class="form-grid" data-mf>
    <div class="col-12 section-title">Identification</div>
    <div class="field col-3"><label>Medicine Code</label><input class="input" value="${v('code', 'Auto-generated')}" readonly></div>
    <div class="field col-5"><label>Brand Name <span class="req">*</span></label><input class="input" name="brandName" value="${v('brandName')}" data-rules="required"></div>
    <div class="field col-4"><label>Generic Name <span class="req">*</span></label><input class="input" name="genericName" value="${v('genericName')}" data-rules="required"></div>
    <div class="field col-8"><label>Composition</label><input class="input" name="composition" value="${v('composition')}" placeholder="e.g. Paracetamol IP 650 mg"></div>
    <div class="field col-4"><label>Strength <span class="req">*</span></label><input class="input" name="strength" value="${v('strength')}" data-rules="required"></div>
    <div class="field col-4"><label>Dosage Form</label>${sel('form', FORMS, m.form || 'Tablet')}</div>
    <div class="field col-4"><label>Category</label>${sel('category', store.all('categories'), m.category)}</div>
    <div class="field col-4"><label>Manufacturer <span class="req">*</span></label><input class="input" name="manufacturer" value="${v('manufacturer')}" data-rules="required"></div>
    <div class="col-12 section-title mt-1">Units & packing</div>
    <div class="field col-3"><label>Unit of Measurement</label>${sel('unit', UNITS, m.unit || 'Strip')}</div>
    <div class="field col-3"><label>Pack Size</label><input class="input" name="packSize" value="${v('packSize')}" placeholder="10 tablets/strip"></div>
    <div class="field col-3"><label>Purchase Unit</label><input class="input" name="purchaseUnit" value="${v('purchaseUnit')}" placeholder="Box (10 strips)"></div>
    <div class="field col-3"><label>Unit Conversion</label><input class="input" type="number" min="1" name="conversion" value="${v('conversion', 1)}" data-rules="nonNegInt"><span class="field-hint">Dispensing units per purchase unit</span></div>
    <div class="col-12 section-title mt-1">Tax & stock control</div>
    <div class="field col-3"><label>HSN Code</label><input class="input" name="hsnCode" value="${v('hsnCode')}"></div>
    <div class="field col-3"><label>GST %</label>${sel('gstPct', [0, 5, 12, 18, 28], m.gstPct ?? 12)}</div>
    <div class="field col-3"><label>Reorder Level <span class="req">*</span></label><input class="input" type="number" min="0" name="reorderLevel" value="${v('reorderLevel', 20)}" data-rules="required,nonNegInt"></div>
    <div class="field col-3"><label>Minimum Stock</label><input class="input" type="number" min="0" name="minStockLevel" value="${v('minStockLevel', 10)}" data-rules="nonNegInt"></div>
    <div class="field col-8"><label>Storage Instructions</label><input class="input" name="storage" value="${v('storage')}" placeholder="Store below 25°C"></div>
    <div class="field col-4"><label>Barcode (optional)</label><input class="input" name="barcode" value="${v('barcode')}"></div>
    <div class="col-12"><div class="ai-note">${icon('info')}<span>Batch number, expiry date, MRP and purchase rate are recorded per batch during GRN receiving — they are intentionally not part of the medicine master.</span></div></div>
  </form>`;
}

export function openMedicineForm(m, done) {
  const user = currentUser();
  openModal({ title: m ? `Edit ${m.brandName}` : 'Add medicine', size: 'lg', body: formHTML(m || {}),
    footer: [{ label: 'Cancel', onClick: (c) => c() }, { label: m ? 'Save changes' : 'Add medicine', cls: 'btn-primary', icon: 'save', onClick: (close, wrap) => {
      const form = wrap.querySelector('[data-mf]'); if (!validateForm(form)) return;
      const d = Object.fromEntries(new FormData(form));
      try {
        if (m) {
          store.transaction(() => {
            store.update('medicines', m.id, { ...d, dispensingUnit: d.unit, conversion: Number(d.conversion) || 1, gstPct: Number(d.gstPct), reorderLevel: Number(d.reorderLevel), minStockLevel: Number(d.minStockLevel) });
            audit(user, 'MEDICINE_UPDATED', 'MEDICINE', m.id, `${d.brandName} updated`);
          });
          toast(`${d.brandName} updated.`);
        } else { const nm = createMedicine(d, user); toast(`${nm.brandName} added as ${nm.code}.`); }
        close(); done?.();
      } catch (e) { toast(e.message, 'error'); }
    } }] });
}

export function render(view, params, query) {
  const manage = can('medicine.manage');
  const map = medicineStockMap();
  view.innerHTML = `
    <div class="page-head"><div><p class="muted">Stable medicine information. ${manage ? '' : '<span class="tag tag-neutral">Read-only for your role</span>'}</p></div>
      <div class="page-actions"><button class="btn btn-secondary" data-export>${icon('download')}Export CSV</button>${manage ? `<button class="btn btn-primary" data-add>${icon('plus')}Add Medicine</button>` : ''}</div></div>
    <section class="card"><div class="toolbar">
      <div class="search">${icon('search')}<input class="input" type="search" placeholder="Search brand, generic, code, manufacturer…" data-f="q"></div>
      <select class="input" data-f="category"><option value="">All categories</option>${store.all('categories').map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <select class="input" data-f="form"><option value="">All forms</option>${FORMS.map((f) => `<option>${f}</option>`).join('')}</select>
      <select class="input" data-f="active"><option value="">Active & inactive</option><option value="1" selected>Active only</option><option value="0">Inactive only</option></select>
    </div><div data-table></div></section>`;
  const columns = [
    { key: 'code', label: 'Code', render: (m) => `<span class="mono">${esc(m.code)}</span>` },
    { key: 'brandName', label: 'Brand Name', render: (m) => `<div class="cell-main">${esc(m.brandName)}</div><div class="cell-sub">${esc(m.composition)}</div>` },
    { key: 'genericName', label: 'Generic Name' },
    { key: 'strength', label: 'Strength' },
    { key: 'form', label: 'Form' },
    { key: 'category', label: 'Category' },
    { key: 'manufacturer', label: 'Manufacturer', render: (m) => `<span class="cell-sub">${esc(m.manufacturer)}</span>` },
    { key: 'unit', label: 'Unit', render: (m) => `${esc(m.unit)}<div class="cell-sub">${esc(m.packSize)}</div>`, csv: (m) => m.unit },
    { key: 'gstPct', label: 'GST %', align: 'right' },
    { key: 'reorderLevel', label: 'Reorder', align: 'right' },
    { key: 'stock', label: 'Stock', value: (m) => map[m.id].available, render: (m) => `${fmtNum(map[m.id].available)} ${badge(stockStatus(m, map[m.id].available))}`, csv: (m) => map[m.id].available },
    { key: 'active', label: 'Status', value: (m) => (m.active ? 'Active' : 'Inactive'), render: (m) => badge(m.active ? 'ACTIVE' : 'INACTIVE') },
    { key: '', label: 'Actions', sortable: false, csv: false, align: 'right', render: (m) => `<div class="row-actions"><a class="btn btn-ghost btn-sm" href="#/inventory/${m.id}" title="View">${icon('eye')}</a>${manage ? `<button class="btn btn-ghost btn-sm" data-edit="${m.id}" title="Edit">${icon('pencil')}</button><button class="btn btn-ghost btn-sm" data-toggle="${m.id}" title="${m.active ? 'Deactivate' : 'Activate'}">${icon(m.active ? 'toggle-right' : 'toggle-left')}</button>` : ''}</div>` }
  ];
  const table = dataTable({ columns, pageSize: 25, sort: { key: 'brandName' }, onRowClick: (m) => navigate('#/inventory/' + m.id), empty: emptyState('pill', 'No medicines found') });
  view.querySelector('[data-table]').appendChild(table.el);
  const f = (n) => view.querySelector(`[data-f="${n}"]`);
  const apply = () => {
    const q = f('q').value.trim().toLowerCase();
    table.setRows(store.all('medicines').filter((m) => (!q || [m.brandName, m.genericName, m.code, m.manufacturer, m.composition].join(' ').toLowerCase().includes(q))
      && (!f('category').value || m.category === f('category').value) && (!f('form').value || m.form === f('form').value)
      && (f('active').value === '' || String(+m.active) === f('active').value)));
  };
  view.querySelectorAll('[data-f]').forEach((el) => el.addEventListener(el.type === 'search' ? 'input' : 'change', debounce(apply, 120)));
  const rerender = () => render(view, params, {});
  view.querySelector('[data-add]')?.addEventListener('click', () => openMedicineForm(null, rerender));
  view.querySelector('[data-export]').onclick = () => { exportTable(`medicine-master-${ymd()}.csv`, columns, table.getRows()); toast('Medicine master exported.'); };
  view.querySelector('[data-table]').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'); const tg = e.target.closest('[data-toggle]');
    if (ed) openMedicineForm(store.get('medicines', ed.dataset.edit), rerender);
    if (tg) {
      const m = store.get('medicines', tg.dataset.toggle);
      const stock = map[m.id].onHand;
      if (!(await confirmDialog({ title: `${m.active ? 'Deactivate' : 'Activate'} ${m.brandName}?`, iconName: m.active ? 'toggle-left' : 'toggle-right', tone: m.active ? 'danger' : 'primary',
        message: m.active ? `Inactive medicines cannot be added to new GRNs.${stock ? ` Existing stock (${fmtNum(stock)} units) remains visible.` : ''}` : 'The medicine will be available for new GRNs again.', confirmLabel: m.active ? 'Deactivate' : 'Activate' }))) return;
      store.transaction(() => { m.active = !m.active; audit(currentUser(), m.active ? 'MEDICINE_ACTIVATED' : 'MEDICINE_DEACTIVATED', 'MEDICINE', m.id, m.brandName); });
      toast(`${m.brandName} ${m.active ? 'activated' : 'deactivated'}.`); rerender();
    }
  });
  apply();
  if (query.edit && manage && store.get('medicines', query.edit)) openMedicineForm(store.get('medicines', query.edit), rerender);
}
