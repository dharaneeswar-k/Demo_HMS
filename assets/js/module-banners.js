// Maps every operational route to its own unique studio editorial artwork and mounts a minimal
// curved-wave banner at the top of the module view without disturbing module event bindings.
import { esc } from './utils.js';

const MODULE_ART = [
  [/^\/home$/, null], // Home renders its own full hero + overlapping dock
  [/(\/(print|receipt|display|labels)$|^\/lab\/(visit\/[^/]+\/report|report\/))/, null], // Keep paper / TV views clean
  [/^\/patients/, { img: 'assets/images/mod-patients.jpg', tag: 'Patient Registry', note: 'Unified patient profiles, UHID lookup and demographics' }],
  [/^\/op\/(queue|visits)/, { img: 'assets/images/mod-op-queue.jpg', tag: 'Outpatient Consultation', note: 'Live doctor queues, consultation notes and prescriptions' }],
  [/^\/op/, { img: 'assets/images/hero-clinical.jpg', tag: 'Outpatient Desk', note: 'Token flow, vitals capture and outpatient registration' }],
  [/^\/ip\/tpa/, { img: 'assets/images/mod-tpa.png', tag: 'Insurance & TPA', note: 'Cashless pre-authorisations, approvals and claim tracking' }],
  [/^\/ip/, { img: 'assets/images/mod-inpatient.png', tag: 'Inpatient Care', note: 'Live ward bed board, admissions, indents and discharge' }],
  [/^\/pharmacy\/closing/, { img: 'assets/images/mod-shifts.svg', tag: 'Counter Closing', note: 'End-of-day cash reconciliation and pharmacy handover' }],
  [/^\/pharmacy$/, { img: 'assets/images/mod-analytics.svg', tag: 'Sales Insights', note: 'Daily billing velocity, margins and payment mix' }],
  [/^\/pharmacy/, { img: 'assets/images/hero-pharmacy.jpg', tag: 'Pharmacy Desk', note: 'FEFO batch dispensing, bills and patient returns' }],
  [/^\/(hbill|packages|discounts|hospital\/approvals)/, { img: 'assets/images/mod-billing.jpg', tag: 'Central Billing', note: 'Lab, service counter, health packages and billing approvals' }],
  [/^\/(shifts|hospital\/closing)/, { img: 'assets/images/mod-shifts.svg', tag: 'Shifts & Closing', note: 'Drawer opening float, live receipts and shift handover' }],
  [/^\/(labels|medicines)/, { img: 'assets/images/mod-labels.svg', tag: 'Catalogue & Labels', note: 'Medicine formulary, batch barcodes and printable labels' }],
  [/^\/(grn|inventory|batches|stock-count|transfers|adjustments|movements|suppliers)/, { img: 'assets/images/mod-inventory.jpg', tag: 'Central Store & Stock', note: 'Supplier receipts, FEFO batches, stock transfers and audits' }],
  [/^\/services/, { img: 'assets/images/mod-services.jpg', tag: 'Clinical Services', note: 'ECG, injections, nebulization and service reconciliation' }],
  [/^\/lab\/(stock|kits)|^\/store\/lab/, { img: 'assets/images/mod-lab-stock.svg', tag: 'Lab Reagents & Kits', note: 'Reagent packs, open-pack use-by tracking and store indents' }],
  [/^\/lab\/(reports|notifiable|tests)/, { img: 'assets/images/mod-lab-reports.svg', tag: 'Lab Diagnostics & Reports', note: 'Verified reports, notifiable register and test reference ranges' }],
  [/^\/lab/, { img: 'assets/images/hero-lab.jpg', tag: 'Laboratory Workbench', note: 'Sample collection, receiving, results entry and sign-off' }],
  [/^\/mrd/, { img: 'assets/images/mod-mrd.svg', tag: 'Medical Records', note: 'Case coding, discharge summaries and record retrievals' }],
  [/^\/(management|reports|dashboard)/, { img: 'assets/images/mod-analytics.svg', tag: 'Executive Insights', note: 'Hospital-wide revenue, clinical activity and reconciliation' }],
  [/^\/(alerts|approvals)/, { img: 'assets/images/mod-alerts.svg', tag: 'Attention & Approvals', note: 'Priority exceptions, stock alerts and pending sign-offs' }],
  [/^\/(setup|settings|users|clinical\/masters|audit|profile|help)/, { img: 'assets/images/mod-setup.svg', tag: 'Hospital Configuration', note: 'Tariff masters, user access, branding and system audit' }]
];

export function bannerSpecFor(path) {
  for (const [re, spec] of MODULE_ART) if (re.test(path)) return spec;
  return { img: 'assets/images/hero-hospital.jpg', tag: 'Hospital Workspace', note: '' };
}

const WAVE_SVG = `<svg class="hb-waves" viewBox="0 0 1440 160" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0,115 C380,155 760,25 1440,90 L1440,160 L0,160 Z" fill="#E3F2F3" opacity="0.55"/>
  <path d="M0,136 C460,82 920,154 1440,42 L1440,160 L0,160 Z" fill="#D5ECEE" opacity="0.42"/>
</svg>`;

export function mountModuleBanner(view, route) {
  if (!view || !route) return;
  const spec = bannerSpecFor(route.path);
  if (!spec) return;
  if (view.querySelector('.mod-banner, .home-banner')) return;
  const first = view.firstElementChild;
  if (!first) return;
  if (first.classList.contains('empty') || first.matches('.doc, .receipt, .tv, .tb2, .label-sheet')) return;

  const banner = document.createElement('section');
  banner.className = 'mod-banner';
  banner.innerHTML = `${WAVE_SVG}<img class="mb-art" src="${spec.img}" alt="" aria-hidden="true">`;

  // Preserve live DOM & event handlers on .page-head, .page-intro, or lab's .h-head
  if (first.classList.contains('page-head') || first.classList.contains('page-intro')) {
    const eye = document.createElement('div');
    eye.className = 'mb-eyebrow';
    eye.textContent = spec.tag;
    banner.appendChild(eye);
    view.insertBefore(banner, first);
    banner.appendChild(first);
    return;
  }

  const labHead = first.classList.contains('h-lab') ? first.querySelector('.h-wl > .h-head') : null;
  if (labHead) {
    banner.classList.add('mod-banner-compact');
    const parent = labHead.parentNode;
    parent.insertBefore(banner, labHead);
    banner.appendChild(labHead);
    return;
  }

  // Modules without an explicit .page-head get a slim editorial header strip above their workspace
  banner.classList.add('mod-banner-slim');
  const copy = document.createElement('div');
  copy.className = 'mb-copy';
  copy.innerHTML = `<span class="mb-eyebrow">${esc(spec.tag)}</span><p class="muted">${esc(spec.note || route.title)}</p>`;
  banner.appendChild(copy);
  view.insertBefore(banner, first);
}
