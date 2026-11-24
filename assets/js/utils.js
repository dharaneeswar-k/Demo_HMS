// Generic formatting and DOM helpers (no business logic here).

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN');
export const fmtINR = (v, whole = false) => (whole ? inr0 : inr).format(Number(v) || 0);
export const fmtNum = (v) => num.format(Math.round((Number(v) || 0) * 100) / 100);
export const fmtCompactINR = (v) => {
  v = Number(v) || 0;
  if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr';
  if (v >= 1e5) return '₹' + (v / 1e5).toFixed(2) + ' L';
  return fmtINR(v, true);
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(d) {
  if (!d) return '—';
  const x = typeof d === 'string' && d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
  if (isNaN(x)) return '—';
  return `${String(x.getDate()).padStart(2, '0')} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
}
export function fmtDateTime(d) {
  if (!d) return '—';
  const x = new Date(d);
  if (isNaN(x)) return '—';
  let h = x.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${fmtDate(x)}, ${h}:${String(x.getMinutes()).padStart(2, '0')} ${ap}`;
}
export function relTime(d) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
  return fmtDate(d);
}
/** Local calendar date string YYYY-MM-DD */
export const ymd = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const localDateTimeValue = (d = new Date()) => {
  const x = new Date(d);
  return `${ymd(x)}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
export const titleCase = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const initials = (name) => String(name || '?').replace(/^Dr\.?\s*/i, '').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
export const icon = (name, cls = '') => `<i data-lucide="${name}" class="ic ${cls}"></i>`;
export function refreshIcons(root) {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.9 }, nameAttr: 'data-lucide', ...(root ? { root } : {}) });
}
export const fileSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
