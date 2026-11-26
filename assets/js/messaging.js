// Patient & doctor messaging: WhatsApp, SMS and email with an outbox log.
//
// Two providers:
//  • WA_LINK  (works now, no server)   — opens WhatsApp / SMS / mail app with the number and message filled in; staff press Send.
//  • WA_CLOUD (production)             — WhatsApp Business Platform (Cloud API). Needs the hospital's backend server, a Meta
//                                        business account, a verified number and an approved template. The access token must
//                                        live on the server, never in the browser — so here messages are only queued for it.
import { store } from './data-service.js';
import { audit } from './services.js';

const now = () => new Date().toISOString();
export const ms = () => store.hs().messaging;
export const CHANNEL_LABEL = { WHATSAPP: 'WhatsApp', SMS: 'SMS', EMAIL: 'Email', COUNTER: 'Handed over at counter', WARD: 'Posted to IP record', DOCTOR: 'Doctor' };
export const STATUS_LABEL = { SENT_VIA_LINK: 'Sent (WhatsApp app)', QUEUED_FOR_SERVER: 'Queued for server', READY_TO_SEND: 'Ready to send', OPENED_MAIL: 'Opened in mail app', OPENED_SMS: 'Opened in SMS app', FAILED: 'Failed', HANDED_OVER: 'Handed over', POSTED_TO_IP_RECORD: 'Posted to IP record' };

export const digits = (p) => String(p || '').replace(/\D/g, '');
/** International number for WhatsApp (India default): 10-digit mobile → 91XXXXXXXXXX. */
export function intlNumber(phone) { const d = digits(phone); if (d.length === 10) return (ms().countryCode || '91') + d; if (d.length === 12 && d.startsWith('91')) return d; return d; }
export const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

export const waLink = (phone, text) => `https://wa.me/${intlNumber(phone)}?text=${encodeURIComponent(text)}`;
export const smsLink = (phone, text) => `sms:+${intlNumber(phone)}?body=${encodeURIComponent(text)}`;
export const mailLink = (email, subject, text) => `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

/** Log a message in the outbox. Call inside a store.transaction(). */
export function logMessage({ channel, to, patientId, refType, refId, template, body, status, toDoctor = false }, user) {
  const m = store.insert('messages', { id: store.nextId('messages', 'MSG-', 5), channel, provider: channel === 'WHATSAPP' ? ms().provider : 'DEVICE', to, patientId, refType, refId, template, body, status, toDoctor, at: now(), by: user?.id || null });
  audit(user, 'MESSAGE_' + channel, refType, refId, `${template} → ${to} (${status})`);
  return m;
}

/**
 * Send a WhatsApp message. Returns { url } to open (WA_LINK) or { queued: true } (WA_CLOUD).
 * WA_LINK cannot attach the PDF automatically — the message carries the SID and, once the hospital is hosted, a secure report link.
 */
export function sendWhatsApp({ to, body, patientId, refType, refId, template, toDoctor }, user) {
  if (!/^\d{10,13}$/.test(intlNumber(to))) throw new Error('No valid mobile number for WhatsApp.');
  const cloud = ms().provider === 'WA_CLOUD' && ms().cloud?.enabled;
  const m = logMessage({ channel: 'WHATSAPP', to, patientId, refType, refId, template, body, status: cloud ? 'QUEUED_FOR_SERVER' : 'SENT_VIA_LINK', toDoctor }, user);
  return cloud ? { queued: true, message: m } : { url: waLink(to, body), message: m };
}
