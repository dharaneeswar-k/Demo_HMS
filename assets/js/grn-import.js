// Supplier invoice import (BRD 05 / client request): distributors send the invoice as a CSV / Excel export.
// Each row becomes a GRN line — medicine matched by name or code, batch, mfg & expiry, quantity, free, PTR, MRP, discount, GST.
// Rows that cannot be matched are reported so the store keeper maps them by hand; nothing is posted until verified.
import { store } from './data-service.js';
import { downloadCSV } from './components.js';

const HEAD = {
  name: ['product', 'item', 'medicine', 'description', 'product name', 'item name', 'particulars'], code: ['code', 'item code', 'product code', 'medicine code'],
  batch: ['batch', 'batch no', 'batch number', 'batchno'], mfg: ['mfg', 'mfg date', 'mfd', 'manufacturing date'], exp: ['exp', 'expiry', 'exp date', 'expiry date'],
  qty: ['qty', 'quantity', 'billed qty', 'received qty'], free: ['free', 'free qty', 'sch', 'scheme'], ptr: ['ptr', 'rate', 'purchase rate', 'price'], mrp: ['mrp'], disc: ['disc', 'disc %', 'discount', 'discount %', 'cd %'], gst: ['gst', 'gst %', 'tax %', 'igst %']
};
function splitCSV(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if ((c === ',' || c === '\t' || c === ';') && !q) { out.push(cur.trim()); cur = ''; } else cur += c; }
  out.push(cur.trim()); return out;
}
/** dd/mm/yyyy, dd-mm-yy, mm/yy, mm/yyyy, yyyy-mm-dd → yyyy-mm-dd (month-only expiry = last day of that month). */
export function parseDate(v, endOfMonth = false) {
  v = String(v || '').trim(); if (!v) return '';
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  if ((m = /^(\d{1,2})[/.-](\d{2,4})$/.exec(v))) { const y = +(m[2].length === 2 ? '20' + m[2] : m[2]); const mo = +m[1]; const d = endOfMonth ? new Date(y, mo, 0).getDate() : 1; return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  return '';
}
const num = (v) => { const n = Number(String(v ?? '').replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : 0; };

export function matchMedicine(name, code) {
  const meds = store.all('medicines').filter((m) => m.active !== false);
  const c = String(code || '').trim().toLowerCase(); const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (c) { const byCode = meds.find((m) => [m.id, m.code, m.barcode].filter(Boolean).some((x) => String(x).toLowerCase() === c)); if (byCode) return byCode; }
  if (!n) return null;
  return meds.find((m) => m.brandName.toLowerCase() === n) || meds.find((m) => n.startsWith(m.brandName.toLowerCase())) || meds.find((m) => m.brandName.toLowerCase().startsWith(n)) || null;
}

export function parseInvoiceCSV(text) {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (rows.length < 2) throw new Error('The file has no item rows.');
  const head = splitCSV(rows[0]).map((h) => h.toLowerCase().replace(/[.:]/g, '').trim());
  const col = Object.fromEntries(Object.entries(HEAD).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
  if (col.name < 0 && col.code < 0) throw new Error('Could not find the product / item column. Use the sample format.');
  if (col.qty < 0) throw new Error('Could not find the quantity column.');
  const lines = []; const unmatched = [];
  rows.slice(1).forEach((r, i) => {
    const c = splitCSV(r); const g = (k) => (col[k] >= 0 ? c[col[k]] : '');
    if (!g('name') && !g('code')) return;
    const med = matchMedicine(g('name'), g('code'));
    const line = { row: i + 2, name: g('name') || g('code'), medicineId: med?.id || '', batchNo: g('batch').toUpperCase(), mfgDate: parseDate(g('mfg')), expiryDate: parseDate(g('exp'), true),
      invoiceQty: num(g('qty')), receivedQty: num(g('qty')), freeQty: num(g('free')), ptr: num(g('ptr')), mrp: num(g('mrp')), discountPct: num(g('disc')), gstPct: col.gst >= 0 ? num(g('gst')) : (med?.gstPct ?? 12) };
    (med ? lines : unmatched).push(line);
  });
  return { lines, unmatched };
}

export function downloadSampleInvoice() {
  const meds = store.all('medicines').slice(0, 4);
  downloadCSV('supplier-invoice-format.csv', ['Product', 'Batch', 'Mfg', 'Expiry', 'Qty', 'Free', 'PTR', 'MRP', 'Disc %', 'GST %'],
    meds.map((m, i) => [m.brandName, `B${24 + i}A${100 + i}`, '08/2026', '07/2028', 20 + i * 10, i % 2 ? 2 : 0, '', '', 0, m.gstPct]));
}
