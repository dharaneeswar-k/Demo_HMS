// Branded print documents (bill, lab report, discharge summary, shift report) share one hospital letterhead.
import { store } from './data-service.js';
import { barcodeSVG } from './barcode.js';
import { esc } from './utils.js';

export function letterhead(title, { sub = '', code = '' } = {}) {
  const s = store.settings(); const rc = store.ph().receipt;
  return `<header class="doc-head">
    <div class="doc-brand">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : `<div class="doc-mark">${esc(s.hospitalName.slice(0, 1))}</div>`}
      <div><h2>${esc(s.hospitalName)}</h2><p>${esc(s.tagline || 'Multi-speciality Hospital')}</p><p>${esc(rc.address || s.city || '')}${rc.phone ? ' · Ph: ' + esc(rc.phone) : ''}</p></div></div>
    <div class="doc-title"><strong>${esc(title)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}${code ? `<div class="doc-code">${barcodeSVG(code, { height: 30 })}<small class="mono">${esc(code)}</small></div>` : ''}</div>
  </header>`;
}
export const docMeta = (pairs) => `<div class="doc-meta">${pairs.filter(Boolean).map(([k, v]) => `<div><span>${esc(k)}</span><strong>${v ?? '—'}</strong></div>`).join('')}</div>`;
export const docFoot = (left, right) => `<footer class="doc-foot"><div>${left || ''}</div><div>${right || ''}</div></footer>`;
export const signBlock = (labels) => `<div class="doc-signs">${labels.map(([role, name]) => `<div><div class="sig-line"></div><strong>${esc(name || '')}</strong><span>${esc(role)}</span></div>`).join('')}</div>`;
