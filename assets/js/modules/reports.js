// Reports — dynamic, filterable, exportable and print-friendly
import { store } from '../data-service.js';
import { currentUser } from '../auth.js';
import { medicineStockMap, stockStatus, batchStatus, batchBalance, daysUntil, medName, supplierName, userName, grnTotals, ledger, locationName } from '../calculations.js';
import { badge, movementBadge, downloadCSV, emptyState, kpi } from '../components.js';
import { toast } from '../notifications.js';
import { billModeLabel, billPaid, billBalance, modeLabel, daySummary } from '../pharmacy-calc.js';
import { esc, icon, fmtNum, fmtINR, fmtDate, fmtDateTime, ymd, refreshIcons, titleCase } from '../utils.js';

const med = (id) => store.get('medicines', id);
const inRange = (d, f) => (!f.from || ymd(d) >= f.from) && (!f.to || ymd(d) <= f.to);

// Each report: filters it supports, columns [label, html(row), csv(row), align], rows(filters), summary(rows)
const dayList = (f) => {
  const end = f.to || ymd(); const start = f.from || ymd(new Date(new Date(end + 'T00:00:00').getTime() - 29 * 86400000));
  const out = []; for (let d = new Date(end + 'T00:00:00'); ymd(d) >= start; d.setDate(d.getDate() - 1)) out.push(ymd(d));
  return out;
};
const REPORTS = [
  { id: 'purchase-vs-sales', title: 'Purchase vs Sales (Daily)', icon: 'scale', filters: ['from', 'to'],
    rows: (f) => dayList(f).map((d) => ({ d, s: daySummary(d) })).filter((r) => r.s.billCount || r.s.purchases),
    cols: [['Date', (r) => r.d, '', fmtDate], ['Stock received (purchase value)', (r) => r.s.purchases, 'r', fmtINR], ['Bills', (r) => r.s.liveBills, 'r'], ['Cost of medicines sold (PTR)', (r) => r.s.cost, 'r', fmtINR],
      ['Sold for (MRP)', (r) => r.s.salesIncGst, 'r', fmtINR], ['Sales excl. GST', (r) => r.s.salesExGst, 'r', fmtINR], ['Margin', (r) => r.s.margin, 'r', fmtINR], ['Margin %', (r) => r.s.marginPct + '%', 'r'],
      ['Patient sales', (r) => r.s.bySale.PATIENT.sales, 'r', fmtINR], ['Walk-in sales', (r) => r.s.bySale.WALKIN.sales, 'r', fmtINR]],
    summary: (rows) => { const t = (k) => rows.reduce((s, r) => s + r.s[k], 0); const ex = t('salesExGst'); return [['Days', rows.length], ['Stock received', fmtINR(t('purchases'))], ['Cost of sold', fmtINR(t('cost'))], ['Sold for', fmtINR(t('salesIncGst'))], ['Margin', fmtINR(t('margin'))], ['Margin %', (ex ? Math.round(t('margin') / ex * 1000) / 10 : 0) + '%']]; } },
  { id: 'pharmacy-sales', title: 'Pharmacy Sales Report', icon: 'receipt', filters: ['from', 'to', 'cashier', 'billType'],
    rows: (f) => store.all('bills').filter((b) => (!f.from || b.businessDate >= f.from) && (!f.to || b.businessDate <= f.to) && (!f.cashier || b.cashierId === f.cashier) && (!f.billType || b.saleType === f.billType)).sort((a, b) => b.at.localeCompare(a.at)),
    cols: [['Bill', (b) => b.id], ['Date', (b) => b.at, '', fmtDateTime], ['Patient', (b) => b.patientName], ['Customer', (b) => (b.saleType === 'WALKIN' ? 'Walk-in' : 'Patient')], ['Patient ID', (b) => b.uhid || '—'], ['Cashier', (b) => userName(b.cashierId)], ['Gross', (b) => b.gross, 'r', fmtINR], ['Discount', (b) => b.discountTotal, 'r', fmtINR], ['Taxable', (b) => b.taxable, 'r', fmtINR], ['GST', (b) => b.gst, 'r', fmtINR], ['Total', (b) => b.grandTotal, 'r', fmtINR], ['Paid', (b) => billPaid(b), 'r', fmtINR], ['Mode', (b) => billModeLabel(b)], ['Status', (b) => b.status, '', badge]],
    summary: (rows) => { const l = rows.filter((b) => b.status !== 'CANCELLED'); return [['Bills', `${l.length} (+${rows.length - l.length} cancelled)`], ['Gross', fmtINR(l.reduce((s, b) => s + b.gross, 0))], ['Discounts', fmtINR(l.reduce((s, b) => s + b.discountTotal, 0))], ['GST (incl.)', fmtINR(l.reduce((s, b) => s + b.gst, 0))], ['Sales', fmtINR(l.reduce((s, b) => s + b.grandTotal, 0))], ['Outstanding', fmtINR(l.reduce((s, b) => s + billBalance(b), 0))]]; } },
  { id: 'payment-collection', title: 'Payment Collection Report', icon: 'wallet', filters: ['from', 'to', 'cashier', 'payMode'],
    rows: (f) => store.all('payments').filter((p) => (!f.from || p.businessDate >= f.from) && (!f.to || p.businessDate <= f.to) && (!f.cashier || p.userId === f.cashier) && (!f.payMode || p.mode === f.payMode)).sort((a, b) => b.at.localeCompare(a.at)),
    cols: [['Txn', (p) => p.id], ['Date', (p) => p.at, '', fmtDateTime], ['Business Date', (p) => p.businessDate], ['Bill', (p) => p.billId], ['Type', (p) => p.kind], ['Mode', (p) => modeLabel(p.mode)], ['Reference', (p) => p.reference], ['Amount', (p) => (p.kind === 'REFUND' ? -p.amount : p.amount), 'r', fmtINR], ['By', (p) => userName(p.userId)]],
    summary: (rows) => ['CASH', 'UPI', 'CARD', 'OTHER'].map((m) => [modeLabel(m).split(' (')[0] + ' (net)', fmtINR(rows.filter((p) => p.mode === m).reduce((s, p) => s + (p.kind === 'REFUND' ? -p.amount : p.amount), 0))]).concat([['Net collection', fmtINR(rows.reduce((s, p) => s + (p.kind === 'REFUND' ? -p.amount : p.amount), 0))]]) },
  { id: 'returns-refunds', title: 'Pharmacy Returns & Refunds', icon: 'undo-2', filters: ['from', 'to'],
    rows: (f) => store.all('pReturns').filter((r) => (!f.from || r.businessDate >= f.from) && (!f.to || r.businessDate <= f.to)).sort((a, b) => b.at.localeCompare(a.at)),
    cols: [['Return', (r) => r.id], ['Date', (r) => r.at, '', fmtDateTime], ['Bill', (r) => r.billId], ['Reason', (r) => r.reason], ['Items', (r) => store.all('pReturnItems').filter((x) => x.returnId === r.id).map((x) => `${medName(x.medicineId)} ×${x.qty} (${x.disposition || 'pending'})`).join('; ')], ['Refund', (r) => r.refundAmount, 'r', fmtINR], ['Mode', (r) => r.refundMode], ['Requested By', (r) => userName(r.requestedBy)], ['Approved By', (r) => userName(r.approvedBy)], ['Status', (r) => r.status, '', badge]],
    summary: (rows) => [['Returns', rows.length], ['Refunded', fmtINR(rows.filter((r) => r.status === 'COMPLETED').reduce((s, r) => s + r.refundAmount, 0))], ['Pending', rows.filter((r) => r.status === 'PENDING_APPROVAL').length]] },
  { id: 'current-stock', title: 'Current Stock Report', icon: 'boxes', filters: ['medicine', 'category'],
    rows: (f) => store.all('medicines').filter((m) => m.active && (!f.medicine || m.id === f.medicine) && (!f.category || m.category === f.category)).map((m) => ({ m, s: medicineStockMap()[m.id] })).sort((a, b) => a.m.brandName.localeCompare(b.m.brandName)),
    cols: [['Code', (r) => r.m.code], ['Medicine', (r) => r.m.brandName], ['Generic', (r) => r.m.genericName], ['Category', (r) => r.m.category], ['Unit', (r) => r.m.unit], ['On Hand', (r) => r.s.onHand, 'r'], ['Available', (r) => r.s.available, 'r'], ['Expired', (r) => r.s.expired, 'r'], ['Batches', (r) => r.s.batchCount, 'r'], ['Reorder', (r) => r.m.reorderLevel, 'r'], ['Value (PTR)', (r) => r.s.value, 'r', fmtINR], ['Status', (r) => stockStatus(r.m, r.s.available), '', badge]],
    summary: (rows) => [['Medicines', rows.length], ['Units on hand', fmtNum(rows.reduce((s, r) => s + r.s.onHand, 0))], ['Available units', fmtNum(rows.reduce((s, r) => s + r.s.available, 0))], ['Stock value', fmtINR(rows.reduce((s, r) => s + r.s.value, 0))]] },
  { id: 'low-stock', title: 'Low Stock Report', icon: 'trending-down', filters: ['category'],
    rows: (f) => store.all('medicines').filter((m) => m.active && (!f.category || m.category === f.category) && stockStatus(m) === 'LOW_STOCK').map((m) => ({ m, s: medicineStockMap()[m.id] })).sort((a, b) => a.s.available / a.m.reorderLevel - b.s.available / b.m.reorderLevel),
    cols: [['Code', (r) => r.m.code], ['Medicine', (r) => r.m.brandName], ['Category', (r) => r.m.category], ['Available', (r) => r.s.available, 'r'], ['Reorder Level', (r) => r.m.reorderLevel, 'r'], ['Min Stock', (r) => r.m.minStockLevel, 'r'], ['Suggested Order', (r) => Math.max(0, r.m.reorderLevel * 2 - r.s.available), 'r'], ['Unit', (r) => r.m.unit], ['Last Supplier', (r) => supplierName([...store.all('batches')].filter((b) => b.medicineId === r.m.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]?.supplierId)]],
    summary: (rows) => [['Medicines low on stock', rows.length], ['Total suggested order units', fmtNum(rows.reduce((s, r) => s + Math.max(0, r.m.reorderLevel * 2 - r.s.available), 0))]] },
  { id: 'out-of-stock', title: 'Out of Stock Report', icon: 'ban', filters: ['category'],
    rows: (f) => store.all('medicines').filter((m) => m.active && (!f.category || m.category === f.category) && stockStatus(m) === 'OUT_OF_STOCK').map((m) => ({ m, s: medicineStockMap()[m.id], last: ledger().filter((x) => x.medicineId === m.id && x.qtyOut).at(-1) })),
    cols: [['Code', (r) => r.m.code], ['Medicine', (r) => r.m.brandName], ['Generic', (r) => r.m.genericName], ['Category', (r) => r.m.category], ['Blocked Qty (expired/quarantined)', (r) => r.s.expired + r.s.quarantined, 'r'], ['Reorder Level', (r) => r.m.reorderLevel, 'r'], ['Last Issue', (r) => (r.last ? fmtDateTime(r.last.at) : '—')]],
    summary: (rows) => [['Medicines out of stock', rows.length]] },
  { id: 'batch-stock', title: 'Batch-wise Stock Report', icon: 'layers', filters: ['medicine', 'supplier', 'category'],
    rows: (f) => store.all('batches').filter((b) => batchBalance(b.id) > 0 && (!f.medicine || b.medicineId === f.medicine) && (!f.supplier || b.supplierId === f.supplier) && (!f.category || med(b.medicineId).category === f.category)).sort((a, b) => medName(a.medicineId).localeCompare(medName(b.medicineId)) || a.expiryDate.localeCompare(b.expiryDate)),
    cols: [['Medicine', (b) => medName(b.medicineId)], ['Batch', (b) => b.batchNo], ['Expiry', (b) => b.expiryDate, '', fmtDate], ['MRP', (b) => b.mrp, 'r', fmtINR], ['PTR', (b) => b.ptr, 'r', fmtINR], ['Received', (b) => b.receivedQty, 'r'], ['Available', (b) => batchBalance(b.id), 'r'], ['Value', (b) => batchBalance(b.id) * b.ptr, 'r', fmtINR], ['Supplier', (b) => supplierName(b.supplierId)], ['GRN', (b) => b.grnId || 'Opening'], ['Location', (b) => locationName(b.locationId)], ['Status', (b) => batchStatus(b), '', badge]],
    summary: (rows) => [['Batches', rows.length], ['Units', fmtNum(rows.reduce((s, b) => s + batchBalance(b.id), 0))], ['Value', fmtINR(rows.reduce((s, b) => s + batchBalance(b.id) * b.ptr, 0))]] },
  { id: 'near-expiry', title: 'Near Expiry Report (next 90 days)', icon: 'calendar-clock', filters: ['medicine', 'supplier', 'days'],
    rows: (f) => store.all('batches').filter((b) => { const d = daysUntil(b.expiryDate); return batchBalance(b.id) > 0 && d >= 0 && d <= (Number(f.days) || 90) && (!f.medicine || b.medicineId === f.medicine) && (!f.supplier || b.supplierId === f.supplier); }).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)),
    cols: [['Medicine', (b) => medName(b.medicineId)], ['Batch', (b) => b.batchNo], ['Expiry', (b) => b.expiryDate, '', fmtDate], ['Days Left', (b) => daysUntil(b.expiryDate), 'r'], ['Available', (b) => batchBalance(b.id), 'r'], ['MRP', (b) => b.mrp, 'r', fmtINR], ['Value at Risk (PTR)', (b) => batchBalance(b.id) * b.ptr, 'r', fmtINR], ['Supplier', (b) => supplierName(b.supplierId)], ['Status', (b) => batchStatus(b), '', badge]],
    summary: (rows) => [['Batches expiring', rows.length], ['Units at risk', fmtNum(rows.reduce((s, b) => s + batchBalance(b.id), 0))], ['Value at risk', fmtINR(rows.reduce((s, b) => s + batchBalance(b.id) * b.ptr, 0))]] },
  { id: 'expired', title: 'Expired Stock Report', icon: 'calendar-x', filters: ['medicine', 'supplier'],
    rows: (f) => store.all('batches').filter((b) => daysUntil(b.expiryDate) < 0 && (!f.medicine || b.medicineId === f.medicine) && (!f.supplier || b.supplierId === f.supplier)).map((b) => ({ b, q: batchBalance(b.id), wo: ledger().filter((x) => x.batchId === b.id && x.type === 'EXPIRED_WRITE_OFF').reduce((s, x) => s + x.qtyOut, 0) })).filter((r) => r.q > 0 || r.wo > 0).sort((a, b) => a.b.expiryDate.localeCompare(b.b.expiryDate)),
    cols: [['Medicine', (r) => medName(r.b.medicineId)], ['Batch', (r) => r.b.batchNo], ['Expired On', (r) => r.b.expiryDate, '', fmtDate], ['Days Since', (r) => -daysUntil(r.b.expiryDate), 'r'], ['Qty on Shelf', (r) => r.q, 'r'], ['Written Off', (r) => r.wo, 'r'], ['Loss Value (PTR)', (r) => (r.q + r.wo) * r.b.ptr, 'r', fmtINR], ['Supplier', (r) => supplierName(r.b.supplierId)], ['Action', (r) => (r.q > 0 ? 'Segregate & write off' : 'Written off')]],
    summary: (rows) => [['Expired batches', rows.length], ['Units still on shelf', fmtNum(rows.reduce((s, r) => s + r.q, 0))], ['Total loss value', fmtINR(rows.reduce((s, r) => s + (r.q + r.wo) * r.b.ptr, 0))]] },
  { id: 'grn', title: 'GRN / Purchase Receipt Report', icon: 'package-check', filters: ['from', 'to', 'supplier', 'status'],
    rows: (f) => store.all('grns').filter((g) => inRange(g.receivedAt, f) && (!f.supplier || g.supplierId === f.supplier) && (!f.status || g.status === f.status)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    cols: [['GRN', (g) => g.id], ['Received', (g) => g.receivedAt, '', fmtDateTime], ['Supplier', (g) => supplierName(g.supplierId)], ['Invoice', (g) => g.invoiceNo], ['Received By', (g) => userName(g.receivedBy)], ['Lines', (g) => g.items.length, 'r'], ['Qty', (g) => grnTotals(g).totalQty, 'r'], ['Taxable', (g) => grnTotals(g).taxable, 'r', fmtINR], ['GST', (g) => grnTotals(g).gst, 'r', fmtINR], ['Total', (g) => grnTotals(g).grand, 'r', fmtINR], ['Status', (g) => g.status, '', badge]],
    summary: (rows) => { const p = rows.filter((g) => g.status === 'POSTED'); return [['GRNs', rows.length], ['Posted', p.length], ['Posted value', fmtINR(p.reduce((s, g) => s + grnTotals(g).grand, 0))], ['GST (posted)', fmtINR(p.reduce((s, g) => s + grnTotals(g).gst, 0))]]; } },
  { id: 'movements', title: 'Stock Movement Report', icon: 'arrow-left-right', filters: ['from', 'to', 'medicine', 'type'],
    rows: (f) => ledger().filter((x) => inRange(x.at, f) && (!f.medicine || x.medicineId === f.medicine) && (!f.type || x.type === f.type)).reverse(),
    cols: [['ID', (x) => x.id], ['Date', (x) => x.at, '', fmtDateTime], ['Medicine', (x) => medName(x.medicineId)], ['Batch', (x) => store.get('batches', x.batchId)?.batchNo], ['Type', (x) => x.type, '', movementBadge], ['In', (x) => x.qtyIn || '', 'r'], ['Out', (x) => x.qtyOut || '', 'r'], ['Balance', (x) => x.newBalance, 'r'], ['Reference', (x) => x.reference], ['By', (x) => userName(x.userId)]],
    summary: (rows) => [['Movements', rows.length], ['Total in', fmtNum(rows.reduce((s, x) => s + x.qtyIn, 0))], ['Total out', fmtNum(rows.reduce((s, x) => s + x.qtyOut, 0))]] },
  { id: 'adjustments', title: 'Stock Adjustment Report', icon: 'scale', filters: ['from', 'to', 'medicine'],
    rows: (f) => store.all('adjustments').filter((a) => inRange(a.requestedAt, f) && (!f.medicine || a.medicineId === f.medicine)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
    cols: [['ID', (a) => a.id], ['Requested', (a) => a.requestedAt, '', fmtDateTime], ['Medicine', (a) => medName(a.medicineId)], ['Batch', (a) => store.get('batches', a.batchId)?.batchNo], ['System', (a) => a.systemQty, 'r'], ['Physical', (a) => a.physicalQty, 'r'], ['Difference', (a) => a.difference, 'r'], ['Value', (a) => a.difference * (store.get('batches', a.batchId)?.ptr || 0), 'r', fmtINR], ['Reason', (a) => a.reason], ['Requested By', (a) => userName(a.requestedBy)], ['Approved By', (a) => userName(a.approvedBy)], ['Status', (a) => a.status, '', badge]],
    summary: (rows) => { const ap = rows.filter((a) => a.status === 'APPROVED'); return [['Adjustments', rows.length], ['Approved', ap.length], ['Net units (approved)', fmtNum(ap.reduce((s, a) => s + a.difference, 0))], ['Net value (approved)', fmtINR(ap.reduce((s, a) => s + a.difference * (store.get('batches', a.batchId)?.ptr || 0), 0))]]; } },
  { id: 'supplier-purchase', title: 'Supplier-wise Purchase Report', icon: 'truck', filters: ['from', 'to', 'supplier'],
    rows: (f) => store.all('suppliers').filter((s) => !f.supplier || s.id === f.supplier).map((s) => { const g = store.all('grns').filter((x) => x.supplierId === s.id && x.status === 'POSTED' && inRange(x.postedAt || x.receivedAt, f)); return { s, g, val: g.reduce((v, x) => v + grnTotals(x).grand, 0), gst: g.reduce((v, x) => v + grnTotals(x).gst, 0), qty: g.reduce((v, x) => v + grnTotals(x).totalQty, 0) }; }).sort((a, b) => b.val - a.val),
    cols: [['Code', (r) => r.s.code], ['Supplier', (r) => r.s.name], ['GSTIN', (r) => r.s.gstNumber], ['Posted GRNs', (r) => r.g.length, 'r'], ['Units', (r) => r.qty, 'r'], ['GST', (r) => r.gst, 'r', fmtINR], ['Purchase Value', (r) => r.val, 'r', fmtINR], ['Status', (r) => r.s.status, '', badge]],
    summary: (rows) => [['Suppliers', rows.length], ['Posted GRNs', rows.reduce((s, r) => s + r.g.length, 0)], ['Total purchase value', fmtINR(rows.reduce((s, r) => s + r.val, 0))]] }
];

export function render(view, params, query) {
  let current = REPORTS.find((r) => r.id === query.r) || REPORTS[0];
  const f = { from: '', to: '', supplier: '', medicine: '', category: '', status: '', type: '', days: '90', cashier: '', billType: '', payMode: '' };
  view.innerHTML = `<div class="report-grid">
    <section class="card report-nav no-print"><div class="report-list">${REPORTS.map((r) => `<button class="report-link" data-r="${r.id}">${icon(r.icon)}${esc(r.title)}</button>`).join('')}</div></section>
    <div data-report></div></div>`;
  const host = view.querySelector('[data-report]');
  const opts = {
    supplier: () => `<option value="">All suppliers</option>${store.all('suppliers').map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}`,
    medicine: () => `<option value="">All medicines</option>${[...store.all('medicines')].sort((a, b) => a.brandName.localeCompare(b.brandName)).map((m) => `<option value="${m.id}">${esc(m.brandName)}</option>`).join('')}`,
    category: () => `<option value="">All categories</option>${store.all('categories').map((c) => `<option>${esc(c)}</option>`).join('')}`,
    status: () => `<option value="">All statuses</option>${['DRAFT', 'VALIDATION_REQUIRED', 'SUBMITTED', 'PENDING_APPROVAL', 'POSTED', 'REJECTED', 'CANCELLED'].map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('')}`,
    type: () => `<option value="">All movement types</option>${['OPENING_STOCK', 'PURCHASE_RECEIPT', 'PHARMACY_SALE', 'PATIENT_RETURN', 'SUPPLIER_RETURN', 'STOCK_ADJUSTMENT_IN', 'STOCK_ADJUSTMENT_OUT', 'EXPIRED_WRITE_OFF', 'STOCK_TRANSFER_IN', 'STOCK_TRANSFER_OUT'].map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('')}`,
    cashier: () => `<option value="">All cashiers</option>${store.all('users').map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}`,
    billType: () => '<option value="">All customers</option><option value="PATIENT">Registered patients</option><option value="WALKIN">Walk-in customers</option>',
    payMode: () => `<option value="">All modes</option>${['CASH', 'UPI', 'CARD', 'OTHER'].map((m) => `<option value="${m}">${esc(modeLabel(m))}</option>`).join('')}`,
    days: () => [30, 60, 90, 180].map((d) => `<option value="${d}">Within ${d} days</option>`).join('')
  };
  function draw() {
    view.querySelectorAll('[data-r]').forEach((b) => b.classList.toggle('active', b.dataset.r === current.id));
    const rows = current.rows(f);
    const fl = current.filters.map((k) => (k === 'from' || k === 'to' ? `<span class="filter-label">${k === 'from' ? 'From' : 'To'}</span><input type="date" class="input" data-k="${k}" value="${f[k]}">` : `<select class="input" data-k="${k}">${opts[k]()}</select>`)).join('');
    const filterDesc = Object.entries(f).filter(([k, v]) => v && current.filters.includes(k)).map(([k, v]) => `${titleCase(k)}: ${k === 'supplier' ? supplierName(v) : k === 'medicine' ? medName(v) : k === 'cashier' ? userName(v) : v}`).join(' · ') || 'No filters';
    host.innerHTML = `<section class="card">
      <header class="card-head"><div><h2>${esc(current.title)}</h2><p class="muted small">Generated ${fmtDateTime(new Date())} by ${esc(currentUser().name)} · ${esc(filterDesc)}</p></div>
        <div class="card-actions"><button class="btn btn-secondary btn-sm" data-csv>${icon('download')}Export CSV</button><button class="btn btn-secondary btn-sm" data-print>${icon('printer')}Print</button></div></header>
      <div class="print-only" style="padding:0 0 10px"><strong>${esc(store.settings().hospitalName)}</strong> — ${esc(store.settings().city)}</div>
      ${current.filters.length ? `<div class="toolbar">${fl}<button class="btn btn-ghost btn-sm" data-reset>${icon('x')}Clear</button></div>` : ''}
      <div class="card-body"><div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">${current.summary(rows).map(([l, v]) => `<div class="kpi kpi-teal" style="padding:12px 14px"><div class="kpi-body"><div class="kpi-label">${esc(l)}</div><div class="kpi-value" style="font-size:19px">${v}</div></div></div>`).join('')}</div></div>
      ${rows.length ? `<div class="table-scroll"><table class="table dense"><thead><tr>${current.cols.map((c) => `<th class="${c[2] === 'r' ? 'ta-right' : ''}">${esc(c[0])}</th>`).join('')}</tr></thead><tbody>
        ${rows.map((r) => `<tr>${current.cols.map((c) => { const v = c[1](r); return `<td class="${c[2] === 'r' ? 'ta-right' : ''}">${c[3] ? c[3](v) : typeof v === 'number' ? fmtNum(v) : esc(v ?? '—')}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : emptyState('file-search', 'No data for these filters')}
      <div class="muted tiny" style="padding:12px 20px">${rows.length} row(s) · Figures are calculated from live records.</div></section>`;
    host.querySelectorAll('[data-k]').forEach((el) => { el.value = f[el.dataset.k]; el.onchange = () => { f[el.dataset.k] = el.value; draw(); }; });
    host.querySelector('[data-reset]')?.addEventListener('click', () => { Object.keys(f).forEach((k) => { f[k] = k === 'days' ? '90' : ''; }); draw(); });
    host.querySelector('[data-print]').onclick = () => window.print();
    host.querySelector('[data-csv]').onclick = () => {
      downloadCSV(`${current.id}-${ymd()}.csv`, current.cols.map((c) => c[0]), rows.map((r) => current.cols.map((c) => { const v = c[1](r); return typeof v === 'number' ? Math.round(v * 100) / 100 : v ?? ''; })));
      toast(`${current.title} exported.`);
    };
    refreshIcons(view);
  }
  view.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => { current = REPORTS.find((r) => r.id === b.dataset.r); history.replaceState(null, '', '#/reports?r=' + current.id); draw(); }; });
  draw();
}
