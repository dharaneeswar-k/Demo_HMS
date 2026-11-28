// Lab icons — Bootstrap Icons (https://icons.getbootstrap.com), used by every lab screen.
// Lab code keeps calling icon('<name>') with the names it always used; this file maps each one to its
// Bootstrap Icons glyph. HTML passed in (already an icon) is returned unchanged, so it is safe to call twice.
import { esc } from '../../utils.js';

const MAP = {
  activity: 'activity', 'alarm-clock': 'alarm', 'alert-circle': 'exclamation-circle', 'alert-octagon': 'exclamation-octagon',
  'alert-triangle': 'exclamation-triangle', 'arrow-down': 'arrow-down', 'arrow-left': 'arrow-left', 'arrow-right': 'arrow-right',
  'arrow-up': 'arrow-up', 'arrow-up-right': 'box-arrow-up-right', asterisk: 'asterisk', 'badge-check': 'patch-check',
  ban: 'slash-circle', 'bed-double': 'hospital', bell: 'bell', box: 'box', boxes: 'boxes', 'calendar-clock': 'calendar-event',
  check: 'check-lg', 'check-check': 'check2-all', 'check-circle-2': 'check-circle', 'chevron-down': 'chevron-down',
  'chevron-left': 'chevron-left', 'chevron-right': 'chevron-right', 'chevron-up': 'chevron-up', 'clipboard-check': 'clipboard-check',
  'clock-3': 'clock', clock: 'clock', cpu: 'cpu', 'credit-card': 'credit-card-2-front', download: 'download', eye: 'eye',
  'file-image': 'file-earmark-image', 'file-text': 'file-earmark-text', 'file-x': 'file-earmark-x', filter: 'funnel',
  'flask-conical': 'clipboard2-pulse', hand: 'person-check', history: 'clock-history', hourglass: 'hourglass-split',
  inbox: 'inbox', 'indian-rupee': 'currency-rupee', info: 'info-circle', keyboard: 'keyboard', layers: 'layers',
  'list-checks': 'list-check', lock: 'lock', mail: 'envelope', megaphone: 'megaphone', 'message-circle': 'whatsapp',
  'message-square': 'chat-left-text', minus: 'dash-lg', 'minus-circle': 'dash-circle', monitor: 'display', package: 'box-seam',
  'package-check': 'box-seam-fill', 'package-open': 'box2', 'package-plus': 'plus-square', 'package-search': 'search',
  'pause-circle': 'pause-circle', 'pen-line': 'pen', pencil: 'pencil', 'play-circle': 'play-circle', plus: 'plus-lg',
  printer: 'printer', receipt: 'receipt', 'rotate-ccw': 'arrow-counterclockwise', ruler: 'rulers', save: 'floppy',
  scale: 'speedometer2', 'scan-barcode': 'upc-scan', search: 'search', 'search-x': 'search', send: 'send',
  'settings-2': 'sliders', siren: 'exclamation-diamond', smartphone: 'phone', snowflake: 'snow', stethoscope: 'person-badge',
  sun: 'brightness-high', tag: 'tag', target: 'bullseye', 'test-tube': 'droplet-half', ticket: 'ticket-perforated',
  'trash-2': 'trash3', 'trending-down': 'graph-down-arrow', truck: 'truck', upload: 'upload', 'user-round': 'person', 'users-round': 'people', warehouse: 'building',
  x: 'x-lg', 'x-circle': 'x-circle', zap: 'lightning-charge-fill', home: 'house', 'more-horizontal': 'three-dots',
  undo: 'arrow-return-left', 'sort-down': 'sort-down', 'person-lines': 'person-lines-fill', grid: 'grid', list: 'list-ul'
};

/** One Bootstrap icon. `name` is a lab icon name (mapped above) or a Bootstrap name prefixed with "bi-". */
export function icon(name, cls = '') {
  if (!name) return '';
  if (String(name).trimStart().startsWith('<')) return name;
  const bi = String(name).startsWith('bi-') ? name.slice(3) : MAP[name] || name;
  return `<i class="bi bi-${bi} ${cls}" aria-hidden="true"></i>`;
}

/** Bootstrap icons need no JS; kept so lab code can still call refreshIcons() for shared (lucide) parts. */
export { refreshIcons } from '../../utils.js';

/** Empty-state block in the lab style. */
export const emptyState = (name, title, text = '', action = '') =>
  `<div class="l2-empty">${icon(name)}<strong>${esc(title)}</strong>${text ? `<p>${text}</p>` : ''}${action}</div>`;

export const ICON_MAP = MAP;
