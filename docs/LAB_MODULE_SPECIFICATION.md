# Nallam Hospital HMS — Laboratory Module Specification

**Module:** BRD Module 06 — Laboratory Management (with its dependencies on Module 01 Patient Management, Reception / Module 08 Central Billing, 02 OP, 03 IP, 07 Services, 09 Discount Approval, 10 Packages, 11 MRD, 12 Shift, 13 Dashboard and 14 User Management)
**Document type:** Functional + technical specification (build reference)
**Version:** 1.1 · **Status:** Baseline from the approved demo (branch `feature_d`), with the changes listed in [§38 Change log](#38-change-log) · **Audience:** product owner, backend & frontend developers, QA, the hospital's lab in-charge

> The demo (HTML/JS + JSON) is the **reference implementation** of every rule in this document. The production system must reproduce the same flow, the same states and the same rules on a real backend (Spring Boot + MySQL, as planned in the README). Where production must do *more* than the demo, it is marked **[PROD]**.

---

## Table of contents

1. [Purpose and scope](#1-purpose-and-scope)
2. [Glossary](#2-glossary)
3. [Status: demo vs production](#3-status-demo-vs-production)
4. [Module dependencies and contracts](#4-module-dependencies-and-contracts)
5. [Actors, roles and permissions](#5-actors-roles-and-permissions)
6. [Entry channels — how a patient reaches the lab](#6-entry-channels--how-a-patient-reaches-the-lab)
7. [End-to-end flow](#7-end-to-end-flow)
8. [Reception: patient identification and registration](#8-reception-patient-identification-and-registration)
9. [Billing and the payment gate](#9-billing-and-the-payment-gate)
10. [Identifiers: SID, token, tube codes, report numbers, barcodes](#10-identifiers-sid-token-tube-codes-report-numbers-barcodes)
11. [Sample collection](#11-sample-collection)
12. [Sample receipt, rejection and recollection](#12-sample-receipt-rejection-and-recollection)
13. [Result entry, flags, critical values and verification](#13-result-entry-flags-critical-values-and-verification)
14. [The lab report](#14-the-lab-report)
15. [Report delivery and messaging (WhatsApp / SMS / email)](#15-report-delivery-and-messaging-whatsapp--sms--email)
16. [Lab stock — reagents, cartridges, cards, strips, QC and tubes](#16-lab-stock--reagents-cartridges-cards-strips-qc-and-tubes)
17. [Turnaround time (TAT) and service levels](#17-turnaround-time-tat-and-service-levels)
18. [State machines](#18-state-machines)
19. [Business rules — consolidated list](#19-business-rules--consolidated-list)
20. [Notifications and alerts](#20-notifications-and-alerts)
21. [Audit trail](#21-audit-trail)
22. [Reports and dashboards](#22-reports-and-dashboards)
23. [Data model](#23-data-model)
24. [Database schema (MySQL proposal)](#24-database-schema-mysql-proposal)
25. [REST API specification](#25-rest-api-specification)
26. [Backend architecture](#26-backend-architecture)
27. [Screens and UI specification](#27-screens-and-ui-specification)
28. [Configuration (Hospital Setup)](#28-configuration-hospital-setup)
29. [Master data — test catalogue, containers, kits](#29-master-data--test-catalogue-containers-kits)
30. [Security, privacy and compliance](#30-security-privacy-and-compliance)
31. [Non-functional requirements](#31-non-functional-requirements)
32. [Edge cases and exception handling](#32-edge-cases-and-exception-handling)
33. [Acceptance test cases](#33-acceptance-test-cases)
34. [Future enhancements (phase 2+)](#34-future-enhancements-phase-2)
35. [Open questions for the hospital](#35-open-questions-for-the-hospital)
36. [Demo code map](#36-demo-code-map)
37. [Lab Test Master (managing the test list)](#37-lab-test-master-managing-the-test-list)
38. [Compliance controls (F1–F6)](#38-compliance-controls-f1f6)
39. [OP and IP modules → lab](#39-op-and-ip-modules--lab-one-pipeline)
40. [Change log](#40-change-log)

---

## 1. Purpose and scope

### 1.1 Purpose
The laboratory module manages every diagnostic test from the moment it is requested until the report reaches the patient or doctor, so that:

- **no test is done without a bill or an approved credit / emergency / IP / package route** (BRD rule *Billing & Payment Control*);
- **no cash is handled inside the lab** (BRD Module 06);
- every sample is **identified by barcode** from collection to report;
- results are **flagged automatically**, **verified** by an authorised person, and **reported in one combined report per visit**;
- reports are **delivered** on WhatsApp / SMS / email or handed over at the counter, with a log;
- **reagent kits used are compared with tests billed** to detect tests done without a bill (BRD Module 06, client meeting: "kits used vs billed").

### 1.2 In scope
| Area | Included |
|---|---|
| Entry channels | OP doctor order, IP ward order, emergency, outside prescription (referral), self request, health package |
| Reception | Quick registration, prescription capture, referral doctor, priority, consent |
| Billing | Lab lines on the central bill, payment gate, credit / emergency, discount approval, cancellation & refund |
| Collection | OPD token queue, waiting-room token display, ward rounds, casualty, tube grouping, labels, scan-to-collect |
| Lab processing | Tube receipt by scan, rejection & recollection, result entry, flags, critical values, verification |
| Reports | Combined report per SID, partial report, reprints, report numbering |
| Delivery | WhatsApp, SMS, email, referring doctor copy, counter hand-over, IP record posting, uncollected list |
| Inventory | Reagent kits, QC / repeat / wastage logging, physical counts, reconciliation |
| Control | Audit log, notifications, dashboards, TAT, referral statistics |

### 1.3 Out of scope (phase 1)
- Direct analyser interfacing (HL7 / ASTM) — designed for in §34, not built.
- Microbiology culture workflows, histopathology, blood bank — separate future modules.
- Outsourced (send-out) tests to an external reference lab — §34.
- Home sample collection booking — §34.
- Insurance / TPA pre-authorisation — belongs to Central Billing phase 2.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Patient ID / UHID** | Unique hospital ID of a person, e.g. `NH-UH-026175`. One per person for life. |
| **SID (Sample ID)** | One number per **lab visit** (one bill or one ward order), e.g. `04010063`. Printed on the bill and every label. |
| **Lab visit** | A group of lab tests ordered together for one patient at one time (one SID). |
| **Lab order** | One test inside a visit (e.g. CBC). Has its own results and report number. |
| **Tube / container** | A physical sample container. Tests that share a container type share one tube. |
| **Tube code** | `SID-n`, e.g. `04010063-2`. Printed as a barcode on the tube label. |
| **Accession** | Receiving a tube into the lab (scan). In the data the order's `accession` = its tube code. |
| **Entry channel / source** | How the request reached the lab: `OP`, `IP`, `EMERGENCY`, `REFERRAL`, `SELF`, `PACKAGE`. |
| **Billing route** | How the visit is paid: `COUNTER`, `IP_ACCOUNT`, `EMERGENCY`, `PACKAGE`. |
| **Payment gate** | The rule that blocks collection until the billing route is cleared. |
| **Priority** | `ROUTINE`, `URGENT`, `STAT` (immediate). |
| **TAT** | Turnaround time — from billing/order to verified report. |
| **Flag** | `H` high, `L` low, `HH` critical high, `LL` critical low, `A` abnormal (text result). |
| **Critical value** | A result so far out of range that the doctor must be told immediately. |
| **Verification** | Sign-off by the authorised person; the report becomes final and gets a report number. |
| **Referral doctor** | An **outside** doctor who sent the patient with a prescription. |
| **Kit / reagent** | Consumable used per test (cartridge, strip, reagent pack). |
| **QC** | Quality control runs that consume reagent but are not patient tests. |
| **Ward rounds** | The phlebotomist's list of IP patients to collect at the bedside. |

---

## 3. Status: demo vs production

The demo implements **100 % of the functional flow** in this document. Production must add the items in the right column.

| Capability | Demo (`feature_d`) | Production adds **[PROD]** |
|---|---|---|
| All 6 entry channels | ✅ | OP & IP orders come from modules 02 / 03 instead of the demo's request screen / MRD admissions |
| Quick registration, duplicate check | ✅ | Server-side duplicate check, Aadhaar/ABHA optional field |
| Prescription upload | ✅ stored in browser IndexedDB | Object storage (S3 / MinIO / server disk), virus scan, image compression |
| Central bill + payment gate | ✅ | Payment gateway / UPI QR reconciliation (optional) |
| SID, token, tube grouping, labels | ✅ Code 128 SVG | Direct printing to a 50 × 25 mm thermal label printer (ZPL / TSPL) |
| Token display | ✅ in-browser page | Separate TV device, audio announcement (text-to-speech), live push |
| Scan to collect / receive | ✅ keyboard-wedge scanner | Same (USB / Bluetooth scanner) |
| Results, flags, critical values, verification | ✅ incl. age / sex / pregnancy ranges, critical call log, signatories, correction history (§38) | Delta check rules per test, unit conversion, analyser interface |
| Amended reports, confidential tests, notifiable register | ✅ (§38) | Direct Ni-kshay / IHIP upload |
| Combined report per SID | ✅ HTML → browser PDF, signer qualification + Reg. No. + signature, AMENDED / duplicate copy, page numbers | Server-side PDF (digitally signed), QR verification code |
| Automated tests | ✅ 100 browser tests (§33.1) | JUnit / integration tests for the same rules |
| WhatsApp | ✅ click-to-send (`wa.me`) + outbox log | **WhatsApp Business Platform (Cloud API)** automatic sending with PDF via a server worker |
| SMS / email | ✅ opens device app | SMS gateway (DLT-registered templates, India) and SMTP/transactional email |
| Kits & reconciliation | ✅ | Lot / expiry per kit, link to Store purchases |
| Audit, notifications, dashboards | ✅ | Real-time push (WebSocket / SSE), retention policies |
| Data | JSON + localStorage | MySQL, backups, multi-user concurrency, row locking |

---

## 4. Module dependencies and contracts

```mermaid
flowchart LR
  PM[01 Patient Management] --> LAB[06 Laboratory]
  RC[Reception / 08 Central Billing] --> LAB
  OP[02 OP Management] -->|lab orders| RC
  IP[03 IP Management] -->|ward orders| LAB
  PKG[10 Packages] -->|covered tests| RC
  DISC[09 Discount Approval] --> RC
  SH[12 Shift] --> RC
  LAB -->|reports| MRD[11 MRD]
  LAB -->|IP charges| IP
  LAB -->|kits| INV[Reagent kit stock]
  LAB --> MSG[Messaging: WhatsApp / SMS / email]
  LAB --> DASH[13 Dashboard & Reports]
  USR[14 Users, roles, audit] --> LAB
```

### 4.1 Patient Management (Module 01) — **hard dependency**
| The lab needs | Provided by Patient Management |
|---|---|
| A registered patient for every visit | `patients` record with `id`, `uhid`, `name`, `gender`, `age` or `dob`, `phone`, optional `email`, `allergies` |
| Quick registration from the billing screen | `registerPatient()` — minimum fields: **name, gender, age (or DOB), 10-digit mobile**. Address, email, guardian, blood group are optional |
| Duplicate protection | `findDuplicates({ name, phone, dob, age })` — same mobile, or same name with age ± 1 year → warning "This patient may already be registered" |
| Patient timeline | Every completed lab order appears on the patient profile ("Lab report — CBC", report number, SID) |
| Allergy alert | Shown on the collection dialog and result screen |

Rules:
- **PM-1** A lab visit can never be created for an unregistered person. Walk-in lab patients are registered with the quick form (the standalone-lab practice: name, age, phone, email).
- **PM-2** Email is optional but required to send the report by email.
- **PM-3** Mobile must match `^[6-9]\d{9}$` (Indian mobile) — it is the WhatsApp number.

### 4.2 Reception / Central Billing (Module 08) — **hard dependency**
| The lab needs | Contract |
|---|---|
| Lab tests billed against a patient | Bill item `category = LAB`, one `orders` row per unit |
| The **lab request** context | `draft.lab = { source, referralDoctorId, priority, prescription, consent, notes }` |
| Visit creation | When the bill is saved, `createVisitForBill(bill, labOrders, lab, user)` creates **one SID** for all lab orders of that bill, groups tubes, assigns a token |
| Payment status | `billClears(bill)` = balance ≤ 0 **or** credit approved / emergency |
| Collection of balance later | `collectHospitalPayment()` → orders on hold become `READY` automatically |
| Cancellation | Owner-approved; allowed only while no test is resulted/completed; all orders → `CANCELLED`, refund recorded |

### 4.3 OP Management (Module 02) — **integration contract**
- The OP doctor orders tests during consultation. OP calls `requestServices({ patientId, serviceIds, doctor, note }, user)` → orders with status **`REQUESTED`** (not billed).
- Reception sees them on the billing screen under **"Advised by the doctor — not billed yet"**, adds them with one click; the bill links the existing order rows (no duplicates) and the visit gets `source = OP`.
- OP needs from the lab: the report for the consultation screen (`orders` where `patientId` and `status = COMPLETED`), and the critical-value alert.

### 4.4 IP Management (Module 03) — **integration contract**
- Ward orders do **not** pass the counter. IP calls `createIpOrder({ recordId, serviceIds, doctor, priority, notes }, user)`.
  - Demo: `recordId` = an open MRD admission record (`medicalRecords` with `episodeType = IP`, no discharge).
  - **[PROD]** replace with the IP admission id; ward and bed come from the bed allocation.
- Each IP order carries `ipCharge = { amount, ipNo, posted: false }`. **The IP final bill must read all unposted lab charges for the IP number, add them to the bill, and set `posted = true`.**
- Collection point is `WARD`; the visit appears in **Ward rounds** with ward and bed.
- When the whole SID is verified, the report is **posted to the IP record automatically** (delivery channel `WARD`).

### 4.5 Packages (Module 10)
- A package sold on a bill creates a patient enrolment. Package-covered lab tests are billed at ₹0 (`coveredBy = enrolmentId`), and the visit's `billingRoute = PACKAGE` when **all** lab orders are covered.
- Extras outside the package are billed normally.

### 4.6 Discount Approval (Module 09)
- Staff can give up to **10 %** on a bill. Above that, `requestHospitalDiscount(draft, reason)` → Super Admin approves / rejects → the counter completes the bill with the approved %.

### 4.7 Shift Management (Module 12)
- Every payment on a lab bill belongs to the cashier's open shift. Billing is blocked until the cashier starts a shift (except Super Admin).

### 4.8 MRD (Module 11)
- Lab reports within an admission window are listed on the MRD record ("Lab reports in this stay") and form part of the discharge summary's *Investigation results*.

### 4.9 Messaging
- Shared service `messaging.js` (outbox, templates, providers). The lab is its first user; pharmacy, OP appointment reminders and billing receipts can reuse it later.

### 4.10 Users, roles, audit (Module 14)
- Permissions in §5; every state change writes an audit event (§21); workstation restriction applies (lab users sign in only at the Laboratory workstation when enforcement is on).

---

## 5. Actors, roles and permissions

### 5.1 Actors
| Actor | Role code | Does |
|---|---|---|
| Front-office / billing executive | `RECEPTION` | Registers patients, raises lab bills, uploads prescriptions, collects balances, hands over reports, sends reports |
| Lab technician / phlebotomist | `LAB` | Calls tokens, collects samples, receives tubes, enters results, verifies (if allowed), sends reports, manages kits, places ward orders |
| Pathologist / lab in-charge | `LAB` (+ verification) or `SUPER_ADMIN` | Verifies and releases reports |
| Ward nurse / service counter | `SERVICE_COUNTER` | Records doctor requests, places ward lab orders |
| MRD officer | `MRD` | Reads reports for medical records |
| Hospital owner / director | `SUPER_ADMIN` | Approves credit, discounts, cancellations; reviews kit shortages; dashboards; setup |
| Doctor (OP / IP) | via OP / IP modules | Orders tests, reads reports, receives critical alerts |
| Outside referral doctor | not a user | Receives a WhatsApp copy of the report (optional) |
| Patient / attender | not a user | Receives WhatsApp / SMS / email; collects printed report |

### 5.2 Permission codes used by the lab
| Permission | Meaning |
|---|---|
| `patient.view` / `patient.register` / `patient.edit` | See / register / edit patients |
| `hbill.create`, `hbill.view`, `hbill.collect` | Create lab bills, view them, collect balance |
| `hbill.cancel.request`, `hbill.cancel` | Request / approve cancellation |
| `discount.request`, `discount.approve` | Ask for / approve a discount above 10 % |
| `credit.approve` | Approve credit, review emergency credit, review kit counts |
| `orders.view` | See service / lab order lists |
| `service.request` | Record a doctor's advice before billing |
| `lab.work` | Lab desk: call, collect, receive, reject, enter results |
| `lab.verify` | Verify and release reports |
| `lab.view` | Open SID pages and reports, report desk |
| `lab.deliver` | Send reports (WhatsApp / SMS / email) and hand over |
| `lab.kits` | Kit stock, receipts, QC/repeat/wastage, physical counts |
| `lab.order.ip` | Place a ward (IP) lab order |
| `referral.manage` | Add / edit referral doctors |
| `messaging.manage`, `catalog.manage` | Messaging settings, other services & prices |
| `labtest.view` | Open the Lab Test Master (read only) — §37 |
| `labtest.manage` | Add / edit / stop lab tests, prices, ranges and kits — Admin and Super Admin only (§37) |
| `shift.own` | Start / close own cash shift |

### 5.3 Role matrix (as built)
| Permission | Super Admin | Reception | Lab | Service Counter | MRD | Pharmacy |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| patient.register | ✅ | ✅ | — | — | — | ✅ |
| hbill.create / collect | ✅ | ✅ | — | — | — | — |
| hbill.cancel (approve) | ✅ | — | — | — | — | — |
| discount.approve / credit.approve | ✅ | — | — | — | — | — |
| service.request | ✅ | — | ✅ | ✅ | — | — |
| lab.work | ✅ | — | ✅ | — | — | — |
| lab.verify | ✅ | — | ✅ | — | — | — |
| lab.view | ✅ | ✅ | ✅ | — | ✅ | — |
| lab.deliver | ✅ | ✅ | ✅ | — | — | — |
| lab.kits | ✅ | — | ✅ | — | — | — |
| lab.order.ip | ✅ | — | ✅ | ✅ | — | — |
| referral.manage | ✅ | ✅ | — | — | — | — |
| shift.own | ✅ | ✅ | — | — | — | ✅ |
| labtest.view | ✅ | ✅ | ✅ | — | ✅ | — |
| labtest.manage | ✅ | — | — | — | — | — |
| labstock.issue (Store Incharge: receive lab supplies, issue to the lab — §16) | ✅ | — | — | — | — | — |

The **Admin** role (`ADMIN`) has `labtest.view`, `labtest.manage`, `lab.view`, `lab.kits`, `hbill.view`, `package.view`, `orders.view`, `patient.view`, `alerts.view` and `audit.view`. It keeps the Lab Test Master (§37) and has no billing, cash or result-entry rights.

**Who signs.** Having `lab.verify` is not enough: with the setting *Only authorised signatories* (on by default) the user must also be marked **Lab signatory** in User Management with a qualification and a council registration number (§38.1). In the demo only the owner (Dr. Meenakshi Sundaram, MD Pathology) signs; the lab technician has `lab.verify` but is not a signatory, so the verify queue shows him *With Dr. …*.

**[PROD]** Optionally add a dedicated `PATHOLOGIST` role; the signatory flag on the user already controls who signs.

---

## 6. Entry channels — how a patient reaches the lab

| # | Channel (`source`) | Who orders | Prescription | Registration | Billing route | Collection point | Report goes to |
|---|---|---|---|---|---|---|---|
| A | **OP** — hospital doctor | OP doctor (OP module) / service counter request | Not needed — the doctor's order is the prescription (`rxBasis = DOCTOR_ORDER`) | Already registered | `COUNTER` — pay first | OPD (token) | Patient (WhatsApp / counter) + OP doctor screen |
| B | **IP** — admitted | Ward doctor / nurse | Not needed | Registered + IP number, ward, bed | `IP_ACCOUNT` — no counter payment | Ward (bedside) | IP record automatically; ward |
| C | **EMERGENCY** — casualty | Duty doctor | Not needed | Minimum details, on the spot | `EMERGENCY` — collected later, owner alerted | Casualty | Duty doctor first |
| D | **REFERRAL** — outside prescription | Reception from the prescription | **Required**: photo / scan / WhatsApp copy + referring doctor (`rxBasis = OUTSIDE_PRESCRIPTION`) | Quick registration | `COUNTER` — pay first | OPD (token) | Patient + optional copy to the referring doctor |
| E | **SELF** — no prescription | Reception | None (`rxBasis = SELF_REQUEST`). Tests flagged *prescription required* are **blocked** | Quick registration | `COUNTER` — pay first | OPD (token) | Patient; report shows "Referred by: Self" |
| F | **PACKAGE** — health check-up | The package | Not needed (`rxBasis = PACKAGE`) | Registered | `PACKAGE` (₹0 for covered tests) | OPD (token) | Patient |

How the system decides the source when a bill is saved:
1. Pay mode **Emergency** → `EMERGENCY` (priority forced to `STAT`).
2. All lab lines covered by an active package → `PACKAGE`.
3. Otherwise the reception choice: **Hospital doctor (OP)** / **Outside prescription (REFERRAL)** / **Self request (SELF)**. If any line was added from a doctor's request, the default is `OP`.
4. IP visits never come from the bill — only from `createIpOrder` (ward order).

---

## 7. End-to-end flow

### 7.1 Master flow (all channels)
```mermaid
flowchart TD
  A[Patient arrives / doctor orders] --> B{Registered?}
  B -- No --> B1[Quick registration: name, age, gender, mobile, email] --> C
  B -- Yes --> C{Channel}
  C -- OP / Referral / Self / Package / Emergency --> D[Central billing: tests + lab request + payment]
  C -- IP ward --> W[Ward lab order: charged to IP account]
  D --> E[Lab visit created: SID + tubes grouped by container + token]
  W --> E
  E --> G{Payment gate cleared?}
  G -- No --> H[ON HOLD: send patient to main counter / await credit approval]
  H --> G
  G -- Yes --> I{Collection point}
  I -- OPD --> I1[Token queue -> Call -> collection room]
  I -- Ward --> I2[Ward rounds -> bedside]
  I -- Casualty --> I3[Casualty collection]
  I1 --> J[Print labels, stick in front of patient, scan each tube = collected; kits deducted]
  I2 --> J
  I3 --> J
  J --> K[Lab scans tube = received]
  K --> L{Sample acceptable?}
  L -- No --> L1[Reject with reason -> recollect; kit logged as repeat] --> I
  L -- Yes --> M[Enter results -> automatic flags; critical value alert]
  M --> N[Verify & release -> report number]
  N --> O{All tests in SID verified?}
  O -- No --> O1[Partial report available] --> M
  O -- Yes --> P{Source}
  P -- IP --> P1[Posted to IP record automatically]
  P -- Others --> Q[Report desk: WhatsApp / SMS / email / referring doctor / counter hand-over]
  Q --> R[Delivery log; uncollected after N days listed]
```

### 7.2 Channel D — outside prescription (step by step)
1. Patient shows a prescription from an outside doctor (paper, or sends it on the hospital WhatsApp).
2. Reception searches the patient (name / Patient ID / mobile). If new → **Register new patient** (quick form).
3. Reception adds the tests from the prescription (search by name or code; tests show sample type and TAT).
4. The **Lab request** card appears automatically when a lab test is on the bill:
   - *How did the patient come?* → **Outside prescription**.
   - **Referring doctor** (search the referral master, or **New doctor**: name, qualification, mobile, clinic).
   - **Prescription** → upload photo / PDF (phone camera, scanner, or the WhatsApp image). Mandatory.
   - **Priority** Routine / Urgent / STAT; **Clinical notes** (e.g. "fasting 12 h").
   - Consent tick-box if a test needs consent (HIV).
5. Payment: Cash / UPI / Card / Split (Credit and Emergency need a reason).
6. **Complete bill** → the system creates the bill, one order per test, **one SID**, groups tests into tubes, gives a **token**, computes the **report due time**.
7. Receipt prints: SID, token, "Please collect your report on <date/time>", "Reports should be collected within 15 days", tests and amount.
8. Patient waits; the token display shows the queue.
9. Lab: **Call** token → patient enters the collection room → **Collect**: confirm identity, print labels, stick on tubes in front of the patient, scan each tube.
10. Lab receives tubes (scan), runs the tests, enters results, verifies.
11. When all tests of the SID are verified → report ready → **WhatsApp** to the patient (and optionally the referring doctor) → patient may also collect the print at the counter (hand-over logged).

### 7.3 Channel A — OP doctor order
1. OP doctor orders tests in consultation (OP module) → `REQUESTED` orders.
2. Patient comes to the main counter; reception picks the patient → the billing screen lists **"Advised by the doctor — not billed yet"** → **Add**.
3. Source defaults to **Hospital doctor**; the ordering doctor fills automatically. No prescription upload.
4. Pay → SID + token → same collection / processing as §7.2.
5. Report: patient (WhatsApp / counter) and the OP doctor's screen.

### 7.4 Channel B — IP ward order
1. Ward doctor / nurse opens **Ward Lab Order**, picks the admitted patient (IP number, ward, bed), tests, priority (STAT for urgent cases) and notes.
2. No payment step — each test is charged to the IP account (`ipCharge.posted = false`).
3. The visit appears in **Lab Worklist → To collect** with the purple **IP · Ward** tag and *Bed S-4 · Surgical ward* instead of a token. It is **never** shown on the waiting-room token screen. STAT orders notify the lab.
4. Phlebotomist collects at the bedside, checks the wrist band, scans tubes.
5. Processing as usual. When complete → report posted to the IP record automatically.
   - If the ward ticked **"Also send the report to the patient's WhatsApp"** (`labVisit.sendToPatient = true`, ticked by default when the patient has a mobile), the report also waits in **Ready to send** until the lab presses **Send on WhatsApp** (with the WhatsApp server on, it is sent automatically at verification).
   - Any ward report can still be sent to the patient by WhatsApp / SMS / email from the patient screen; *Hand over at counter* is not offered for ward patients.
6. At discharge the IP module posts all lab charges to the final bill.

### 7.5 Channel C — emergency
1. Casualty registers the patient (minimum details) and raises the bill with pay mode **Emergency** and a reason.
2. Priority becomes **STAT**, collection point **Casualty**, the owner gets an emergency-credit alert, the lab gets a STAT alert.
3. Services start immediately; the balance is collected later (owner reviews in Approvals).

### 7.6 Channel E — self request
1. Patient asks for tests without a prescription (e.g. sugar, lipid).
2. Reception chooses **Self request**. Any test with *prescription required* (e.g. HIV) shows a red message and the bill cannot be completed.
3. The report shows "Referred by: Self".

### 7.7 Channel F — package
1. Package sold (or already active) for the patient. Covered tests appear at ₹0 with "In package".
2. If all lab tests are covered → `billingRoute = PACKAGE`; collection does not wait for payment.

---

## 8. Reception: patient identification and registration

### 8.1 Search
- One search box: name, Patient ID (`NH-UH-…`), or mobile digits. Results show `name · Patient ID · gender/age · mobile`.

### 8.2 Quick registration (lab walk-ins)
| Field | Rule |
|---|---|
| Full name | Required, ≥ 2 characters |
| Gender | Required (Male / Female / Other) |
| Date of birth **or** age | One of them required; age 0–120; DOB not in the future |
| Mobile | Required, 10 digits, starts 6–9 (WhatsApp number) |
| Email | Optional; validated if given — needed for email reports |
| Address, city, pincode | Optional (city defaults to Hosur) |
| Guardian / attender, blood group, allergies | Optional |

- Duplicate warning before saving (same mobile; or same name with age ± 1).
- Patient ID generated immediately: `NH-UH-` + 6 digits.
- **[PROD]** optional ABHA (Ayushman Bharat Health Account) number field.

---

## 9. Billing and the payment gate

### 9.1 Lab request card (billing screen)
Shown only when at least one `LAB` test is on the bill.

| Element | Values / rules |
|---|---|
| How did the patient come? | Hospital doctor (OP) · Outside prescription (REFERRAL) · Self request (SELF). Hidden when pay mode is Emergency (source = EMERGENCY). |
| Referring doctor | REFERRAL only — required. Search referral master or add new. Fills the bill's doctor field: `Dr. Name, Qualification`. |
| Prescription | REFERRAL only — required. Image or PDF ≤ 8 MB. Stored as a document linked to the visit. |
| Priority | Routine (default) · Urgent · STAT. Emergency forces STAT. |
| Clinical notes | Free text, printed on the request sheet. |
| Consent | Shown only if a test has `consentRequired` — must be ticked. |

### 9.2 Validation (bill cannot be completed if any fails)
| Code | Rule | Message |
|---|---|---|
| V-1 | Patient selected | "Select the registered patient…" |
| V-2 | At least one line | "Add at least one service, test or package." |
| V-3 | Cashier has an open shift (not Super Admin) | "Start your shift before billing…" |
| V-4 | REFERRAL needs a prescription | "Attach the outside prescription (photo, scan or the WhatsApp copy)." |
| V-5 | REFERRAL needs a referring doctor | "Choose the referring doctor." |
| V-6 | SELF cannot include `rxRequired` tests | "<test> cannot be done on a self request — a doctor's prescription is needed." |
| V-7 | Consent for `consentRequired` tests | "Get the patient's signed consent for <test> and tick the consent box." |
| V-8 | Discount ≤ 10 % unless approved request | "Discount above 10% needs Super Admin approval…" |
| V-9 | Payments ≤ bill total | "Payments … are more than the bill …" |
| V-10 | Unpaid balance needs Credit / Emergency + reason | "… is unpaid. Collect it, or mark the bill as Credit / Emergency with a reason." |
| V-11 | Emergency switched off in setup | "Emergency billing is switched off in Hospital Setup." |

### 9.3 Payment gate — when can the sample be collected?
| Situation | Gate status shown | Collect? |
|---|---|---|
| Bill fully paid | Paid | ✅ |
| Credit requested, owner not decided | Credit awaiting owner | ❌ (on hold) |
| Credit approved | Credit approved | ✅ |
| Emergency | Emergency | ✅ (owner alerted) |
| Part paid, no credit | Payment pending | ❌ |
| All tests covered by package | In package | ✅ |
| IP ward order | IP account | ✅ |
| Bill cancelled | Cancelled | ❌ |

The gate is evaluated live: collecting the balance or approving credit immediately moves the visit from **Payment pending** to the queue.

### 9.4 Receipt (lab part)
Printed under the bill (A5/A4):
- **Lab SID** (barcode on the bill header), **Token** number.
- **"Please collect your report on: <report due date & time>"** — the latest of (bill time + TAT of each test).
- **"Reports should be collected within <15> days. The report can also be sent on WhatsApp to <mobile>."**
- Test lines with rates, total, received, balance, PAID / CREDIT status, billed by (bill user).

### 9.5 Cancellation and refund
- Reception requests with a reason and refund mode; Super Admin approves.
- Blocked if any test on the bill is **resulted or completed** ("Completed services cannot be cancelled").
- On approval: all orders → `CANCELLED`, refund recorded against the requesting cashier's shift, visit status → Cancelled, kit usage already logged stays (reconciliation shows it).

---

## 10. Identifiers: SID, token, tube codes, report numbers, barcodes

| Identifier | Format | Example | Generated | Unique within |
|---|---|---|---|---|
| Patient ID | `NH-UH-` + 6 digits | `NH-UH-026175` | Registration | Hospital, forever |
| Hospital bill | `HB-YYYY-` + 5 digits | `HB-2026-00088` | Bill save | Year |
| Lab visit (internal) | `LV-` + 5 digits | `LV-00063` | Visit creation | Hospital |
| **SID** | 8-digit running number | `04010063` | Visit creation | Hospital, forever (never reused) |
| Token | Running number per business day (OPD visits only) | `9` | Visit creation | Business day |
| **Tube code** | `SID-n` (n = 1,2,3 by container group) | `04010063-2` | Visit creation | Hospital |
| Lab order | `ORD-` + 5 digits | `ORD-00164` | Order creation | Hospital |
| Report number | `LR-YYYY-` + 5 digits | `LR-2026-00091` | Verification of each test | Year |
| Message | `MSG-` + 5 digits | `MSG-00065` | Message logged | Hospital |
| Kit movement / count | `KMV-` + 5 / `KC-` + 4 | `KMV-00120` | Kit events | Hospital |

Barcodes:
- **Symbology:** Code 128 (subset B) — scanners read it in keyboard-wedge mode (types the code + Enter).
- Encoded on: bill (SID), tube labels (tube code), request sheet (SID), report header (SID), patient card (Patient ID).
- **[PROD]** add a QR code on the report linking to a verification page (`/r/<sid>?k=<token>`).

SID rule: **one SID per visit**, not per test (the standalone-lab practice observed: one SID on the bill covers CBC + CRP + thyroid). Each test still has its own order and report number.

---

## 11. Sample collection

### 11.1 OPD token queue
- Every OPD visit (OP, REFERRAL, SELF, PACKAGE) gets a token for the business day.
- Queue order: **priority (STAT → Urgent → Routine), then token number**.
- Lab presses **Call** → `tokenStatus = CALLED`, `calledAt`; the waiting-room display shows **"Now calling 7"** and the next tokens (priority tokens highlighted).
- Visits whose payment gate is not cleared do **not** appear in the queue (they are in the *Payment pending* tab).
- **Who appears on the waiting-room token screen** (`#/lab/display`) — only patients who were given a **counter token today** and still have to come to the collection room:
  - shown: OP, outside-doctor (referral), self-request and package patients with a token, payment cleared, at least one tube still to collect;
  - never shown: **ward (IP) orders** (collected at the bedside), casualty, cancelled visits, unpaid bills, and patients whose tubes are all collected (they drop off by themselves);
  - layout (scales with the screen size, TV or monitor): header with hospital name and a live clock; left — **Now calling** (latest called token, very large, flashes when it changes; an hourglass when nobody is called) and **Also called** (up to 3 earlier called tokens still not collected); right — **Next in line** with the count, up to 10 waiting tokens as tiles (Urgent / STAT tiles red, marked *Priority*) and **+N more** when the queue is longer. Tokens only — no names on the public screen.
  - **Full screen** button (or press **F**); the clock updates every 5 s and the board redraws every 30 s, and at once when the lab calls or collects (also from another browser tab).
- **[PROD]** audio announcement ("Token number 7, please come to sample collection") and a dedicated TV page with auto-refresh via server push.

### 11.2 Ward rounds (IP)
- IP visits waiting for collection appear in the same worklist with the **IP · Ward** tag and **bed and ward** instead of a token, sorted by priority. Filter *Patient type → IP — admitted (ward)* lists only them.
- Bedside identification: name + Patient ID + wrist band.

### 11.3 Casualty
- Emergency visits; always STAT; collected in casualty and sent to the lab immediately.

### 11.4 Tube grouping (containers)
Tests are grouped into one tube per **container type**:

| Container code | Label | Cap colour | Typical tests |
|---|---|---|---|
| `EDTA` | EDTA — lavender top | Lavender / purple | CBC, HbA1c |
| `PLAIN` | Plain / serum — red top | Red / yellow | LFT, RFT, lipid, thyroid, CRP, NS1, Widal, HIV |
| `FLUORIDE` | Fluoride — grey top | Grey | FBS, PPBS |
| `URINE` | Urine container | Yellow | Urine routine |

Example (the visit observed at the standalone lab): CBC + CRP + thyroid → **2 tubes**: `SID-1` EDTA (CBC), `SID-2` Plain (CRP + thyroid).

**[PROD]** per-test sample volume and a maximum number of tests per tube (split into `SID-3` when exceeded); separate containers for tests that need special handling (e.g. ESR citrate, coagulation citrate).

### 11.5 Labels and request sheet
- **Tube label** (50 × 25 mm): patient name, age+sex, Code 128 barcode of the tube code, tube code in text, test codes, container tag (coloured), Patient ID, date, priority if not routine.
- **Lab request sheet** (A4): letterhead, SID barcode, patient details, doctor, priority, requested time, token / ward-bed, table of tubes → container → tests → collected by / time, clinical notes, signature lines *Collected by* and *Received in lab*.
- Labels are printed and **stuck on the tube in front of the patient** (client requirement from the observed practice).

### 11.6 Collection steps (dialog)
1. Confirm the patient's name and Patient ID verbally (and wrist band for IP).
2. Print labels; stick one on each tube.
3. **Scan each tube** (or tap *Mark collected*). On each tube:
   - `tube.collectedAt/By` set; each order in it → `SAMPLE_COLLECTED`;
   - **reagent kits deducted** (`USED_TEST` movement per kit per test);
   - when all tubes are collected → `tokenStatus = DONE`.
4. Scanning a label that does not belong to this patient → error "This label does not belong to this patient. Check the tube." (wrong-patient protection).

---

## 12. Sample receipt, rejection and recollection

### 12.1 Receipt in the lab (accessioning)
- The lab scans the tube (Lab Workbench scan box or the *Receive* step). `tube.receivedAt/By` and each order's `lab.receivedAt/By` are set.
- **Results cannot be entered for a tube that has not been received** (rule LR-4).

### 12.2 Rejection
Allowed reasons (free text, suggested list): haemolysed, clotted, insufficient quantity, wrong container, unlabelled / mislabelled, sample too old, contaminated.

On rejection of a tube:
- `tube.rejected = { at, by, reason, count+1 }`; collection and receipt are cleared;
- each order in the tube returns to **`READY`** (awaiting recollection); entered results are cleared;
- reagent already used is **relabelled `REPEAT`** (not refunded) so reconciliation stays honest;
- OPD visit returns to the token queue (status *Recollect*); IP → ward rounds;
- notification to the lab and reception (or ward); **[PROD]** optional WhatsApp template `SAMPLE_REJECTED` to the patient.

---

## 13. Result entry, flags, critical values and verification

### 13.1 Result entry
- Screen per test: parameter, result input, unit, reference range, live flag, **previous result** of the same test for the same patient (delta view).
- Numeric parameters accept decimals; text parameters offer the expected value (e.g. *Negative*, *Nil*, *Pale yellow*).
- All parameters are mandatory before saving.
- Saving sets order status **`RESULTED`** (awaiting verification) and records `enteredBy/At`.

### 13.2 Flag logic (exact)
For a numeric parameter with `low`, `high`, optional `critLow`, `critHigh`:
```
if critLow  != null and value < critLow   -> 'LL'  (critical low)
if critHigh != null and value > critHigh  -> 'HH'  (critical high)
if value < low                            -> 'L'
if value > high                           -> 'H'
else                                      -> ''    (normal)
```
For a text parameter with expected `ref`: case-insensitive match → `''`, otherwise **`A`** (abnormal, printed as `*`).

### 13.3 Critical values
- On saving results with any `LL`/`HH`, a **critical alert** goes to the lab and the Super Admin: "Critical result — <patient>… Inform <doctor> now."
- The visit shows a pulsing *Critical value* tag; the Verify step lists it first and the SID page highlights the row in red.
- **Built (§38.6):** a logged call — *Informed* with read-back — is required before a critical result can be verified; failed tries are kept; the owner is alerted after 15 minutes. **[PROD]** also an SMS/WhatsApp to the ordering doctor.

### 13.4 Verification
- Only users with `lab.verify` **who are authorised signatories** (qualification + registration no., §38.1). Technicians see the patient as *With Dr. …*; the doctor is notified when results are saved (hand-off in §38.1). Setting **"report must be verified by a different person from the one who entered the results"** (`requireSecondPersonVerification`, default on).
- Saving changed results needs a reason and keeps the old values (§38.2). A released report is changed only by an **amendment** (§38.3).
- On verification: report number `LR-YYYY-NNNNN`, `verifiedBy/At`, order → **`COMPLETED`**, the order appears on the patient timeline.
- When **every non-cancelled order of the SID** is completed → visit **report ready** → IP: posted to the IP record; others: report desk + notification "Report ready — SID …".

---

## 14. The lab report

### 14.1 Combined report per SID
- One document per SID containing every verified test, grouped by test, each with its sample type and report number.
- If some tests are pending → title **"LABORATORY REPORT (PARTIAL)"** and a line "Pending: … will follow in a separate report."

### 14.2 Layout (A4 portrait)
1. **Letterhead**: logo, hospital name, tagline, address, phone; title *LABORATORY REPORT*, departments, **SID barcode**.
2. **Patient block**: name, Patient ID, age / sex, referred by (doctor or *Self*), SID, collected time, reported time, IP no / bed or patient type.
3. **Per test**: heading (test name · sample · report number), table *Investigation | Result | Unit | Biological reference interval*; abnormal rows bold with the flag (`H`, `L`, `HH (critical)`, `LL (critical)`, `*`).
4. Legend: "H = above range · L = below range · HH / LL = critical · * = abnormal finding. Results relate only to the sample received. Please correlate clinically."
5. **Signatures**: Lab technician (entered by), Verified by (pathologist / in-charge).
6. "— End of report —".

### 14.3 Printing
- Print / Save as PDF from the browser (demo). Every print increments `printCount` and is audited; reprints say **"Duplicate copy"**; pages are numbered "Page x of y" (§38.1, §38.3).
- The report also prints the Clinical Establishment Reg. No., the received time, the range used per row, the critical call, the signer's qualification, Reg. No. and signature, and *AMENDED* details (§38).
- **[PROD]** server-generated PDF (e.g. OpenPDF / iText / wkhtmltopdf / Puppeteer), digitally signed, stored with a hash; QR verification code.

---

## 15. Report delivery and messaging (WhatsApp / SMS / email)

### 15.1 Channels
| Channel | To | Demo behaviour | Production |
|---|---|---|---|
| **WhatsApp** | Patient mobile | Opens `https://wa.me/91XXXXXXXXXX?text=<message>` with the message filled in; staff press Send; logged as `SENT_VIA_LINK` | **WhatsApp Cloud API**: template message + PDF document, sent automatically by a server worker; status via webhooks (sent / delivered / read / failed) |
| **WhatsApp to referring doctor** | Referral doctor mobile | Same, template `REPORT_READY_DOCTOR` | Same as above |
| **SMS** | Patient mobile | Opens `sms:` link (works on phones) | SMS gateway with **DLT-registered** sender and template (mandatory in India) |
| **Email** | Patient email | Opens `mailto:`; staff attach the PDF | SMTP / transactional email with the PDF attached |
| **Counter hand-over** | Patient / attender | Records who collected; blocked if the bill has a balance (setting) | Same + signature pad (optional) |
| **IP record** | Ward / IP chart | Automatic delivery `WARD` when the SID is complete | Same, plus doctor notification in the IP module |
| **WhatsApp for a ward patient** | Patient / attender mobile | When the ward order has *send to the patient's WhatsApp* ticked, the report waits in **Ready to send** after it is posted to the ward; the lab presses **Send on WhatsApp**. Any ward report can also be sent from the patient screen | Sent automatically at verification by the WhatsApp Cloud API worker |

### 15.2 Message templates (editable in Hospital Setup → Messaging)
```
REPORT_READY
Dear {name},
Your lab report (SID {sid}) from {hospital} is ready.
Tests: {tests}
{link}Show this SID at the lab counter to collect the printed copy within {days} days.
— {hospital}, {phone}

REPORT_READY_DOCTOR
Dear {doctor},
The lab report of your patient {name} (SID {sid}) at {hospital} is ready.
Tests: {tests}
{link}— {hospital} Laboratory

SAMPLE_REJECTED
Dear {name},
Your sample for {tests} (SID {sid}) could not be processed. Please visit the {hospital} lab again for a new sample. We regret the inconvenience.
```
Placeholders: `{name} {sid} {tests} {hospital} {days} {phone} {doctor} {link}`. `{link}` is filled only when a public report URL is configured.

### 15.3 Why the demo cannot send automatically
Fully automatic WhatsApp needs the **WhatsApp Business Platform**: a Meta Business account, a verified business phone number, **pre-approved message templates**, and an **access token that must stay on a server**. A browser-only app must never hold that token. Therefore:
- Demo: provider `WA_LINK` (click-to-send) — works on any computer with WhatsApp Desktop / Web.
- Production: provider `WA_CLOUD` — the UI only **queues** messages (`QUEUED_FOR_SERVER`); the backend sends them.

### 15.4 Production WhatsApp design **[PROD]**
```mermaid
sequenceDiagram
  participant LAB as Lab user / verification
  participant API as HMS backend
  participant Q as Message queue (DB outbox)
  participant W as WhatsApp worker
  participant META as WhatsApp Cloud API
  participant P as Patient phone
  LAB->>API: verify last test of SID
  API->>API: generate signed PDF, store file
  API->>Q: insert outbox row (template REPORT_READY, PDF id)
  W->>Q: poll / consume
  W->>META: POST /{phone-number-id}/media (PDF) -> media id
  W->>META: POST /{phone-number-id}/messages (template + document)
  META-->>W: message id (wamid)
  META-->>API: webhook: sent / delivered / read / failed
  API->>Q: update status; on failure retry with backoff, then alert
  META->>P: WhatsApp message with PDF
```
Requirements:
- **Outbox pattern** (transactional): the message row is written in the same DB transaction as the verification; a worker sends it (no lost or double messages; idempotency key = visit id + template + recipient).
- **Retry**: exponential backoff (1 min, 5 min, 30 min, 2 h), then status `FAILED` + notification to the lab.
- **Webhook** endpoint verifies Meta's signature (`X-Hub-Signature-256`) and updates delivery status.
- **Opt-in**: patient consent to receive reports on WhatsApp captured at registration (checkbox, default yes for lab patients) — required by WhatsApp policy.
- **24-hour window**: outside a customer-initiated conversation only approved templates can be sent — the report notification is a *utility* template.
- **Report link** alternative: a short-lived signed URL (`/r/<sid>?k=<random 32 chars>`, valid e.g. 7 days, rate-limited, logs each download) for patients who cannot open attachments.
- Configuration: phone number id, business account id, template name/language, webhook verify token — stored server-side; the setup screen shows only non-secret fields.

### 15.5 Counter hand-over rules
- Search by SID (scan the bill barcode) or patient.
- **Pay before hand-over** (setting, default on): blocked if the bill still has a balance (emergency excepted).
- Record collected by (*Self / Attender / Referring doctor's staff*) and the person's name → delivery `COUNTER`, `HANDED_OVER`; report prints.
- **Uncollected list**: ready reports (non-IP) with no hand-over after **15 days** (setting).
- **Confidential tests** (§38.4): hand-over only, in person, after post-test counselling; written authorisation if someone else collects. No WhatsApp / SMS / email.

### 15.6 Visit report statuses (report desk tabs)
| Status | Meaning |
|---|---|
| Report ready | All tests verified, not yet sent to the patient |
| Partial report | Some tests verified, others pending |
| Report sent | Sent by WhatsApp / SMS / email (or posted to IP record) |
| Handed over | Printed copy collected at the counter |
| Not collected | Ready > 15 days, never handed over (non-IP) |

---

## 16. Lab stock — reagents, cartridges, cards, strips, QC and tubes

Lab stock follows the same rule as the pharmacy: **everything comes in through the Central Store**. The lab never buys or "adds" stock itself. It asks the store, the store issues, and the lab confirms what arrived. Stock then goes down by itself as tests are done.

```
Supplier ──► CENTRAL STORE ──(lab request → store issues, oldest expiry first)──► LAB ──► used per test / QC / repeat / wastage
            lot, expiry,                                                       lab confirms        blind physical count
            cold-chain check                                                   what arrived        (owner reviews shortages)
```

### 16.1 Who does what

| Who | Screen | Does |
|---|---|---|
| **Lab** (`lab.kits` + `lab.work`) | Lab Stock `#/lab/stock` | Sees stock in the lab; sends the ready-made request when something runs low; receives what the store sent; opens packs and QC vials; records QC runs, repeats and wastage; discards expired lots; does the blind count |
| **Store Incharge** (`labstock.issue`) | Lab Supplies `#/store/lab` | Receives from the supplier (lot, expiry, invoice, cold-chain check); issues lab requests (lots picked oldest expiry first); writes off damaged or expired store stock; sees what to reorder |
| **Admin / Super Admin** (`labtest.manage`) | Lab Stock → Item list | Adds and edits items: kind, pack size, storage, "ask for more" and "keep in lab" levels, store reorder level, opened life, tube type. Which test uses which item is set in the Test Master (§37) |
| **Super Admin** | Lab Stock → Used vs billed, Counts | Reviews count shortages and the used-vs-billed reconciliation |

Admin can see Lab Stock but cannot request, receive or use stock.

### 16.2 Kinds of items

| Kind | Examples | How it is used up |
|---|---|---|
| Analyser reagents | CBC pack, LFT / RFT / glucose / lipid kits, Widal | Per test, from a pack of N tests. Has an **opened life** once loaded on the analyser |
| Cartridges | HbA1c, thyroid, CRP | 1 per test |
| Rapid test cards | Dengue NS1, HIV 1 & 2 | 1 per test |
| Strips | Urine 10-parameter strips | 1 per test; the bottle has an opened life |
| QC controls | Haematology control, biochemistry control | **1 vial is used up when it is opened**; usable N days after opening; not billable |
| Tubes & consumables | EDTA, plain, fluoride tubes, urine container | **1 per tube collected** (matched by tube type) |

### 16.3 Item master (`labKits`)
`name, kind, unit (test / card / cartridge / strip / vial / tube), packLabel (pack / kit / box / bottle / set), packSize (units per pack), storage (ROOM / COLD 2–8 °C / FROZEN), openDays (usable after opening, or empty), reorderLevel ("ask for more at", units in lab), parLevel ("keep in lab", units), storeMin (store reorder level), unitCost, supplier, container (tube type, consumables only), active`.

Validation: name unique; pack size a whole number ≥ 1; keep-in-lab > ask-for-more; opened life ≥ 1 or empty. Items are stopped (`active=false`), never deleted.

### 16.4 Lots and the ledger
- **Lot** (`labLots`): `lot number, expiry, supplier, invoice, received at`. One lot can sit partly in the store and partly in the lab.
- **Movement** (`kitMovements`): `kitId, loc (STORE / LAB), lotId, type, qty (±), ref, by, at, note`. **Balance = Σ movements** for that item and place; nobody types a stock number.
- **First expiry, first out**: issuing to the lab and using in the lab always take the earliest-expiry lot that has not expired. Expired lots are never issued or used. If the lab runs a billed test with no stock on record, the use is still recorded (balance goes negative) — patient care never waits on the register; the next count fixes it.

| Type | Place | Sign | When |
|---|---|---|---|
| `SUPPLIER_IN` | Store | + | Store receives from the supplier |
| `ISSUE_OUT` | Store | − | Store issues a lab request |
| `STORE_WASTE` | Store | − | Damaged / warm / expired in the store (reason required) |
| `ISSUE_IN` | Lab | + | Lab confirms what arrived |
| `USED_TEST` | Lab | − | Automatically when a sample tube is collected (reagent per test + 1 tube) |
| `USED_QC` | Lab | − | QC runs (recorded) and QC control vials (when opened) |
| `REPEAT` | Lab | − | Repeat test (recorded, or automatic when a sample is rejected) |
| `WASTAGE` | Lab | − | Spilled / damaged / failed (reason required) |
| `EXPIRED` | Lab | − | Expired lot discarded |
| `COUNT_ADJUST` | Lab | ± | Physical count difference |

### 16.5 Request → issue → receive (`labIndents`)

| Status | Meaning | Next |
|---|---|---|
| `REQUESTED` | Lab sent the request (lines in **packs**; optional *Urgent* and note). Store is notified | Store issues or "cannot issue"; lab may cancel |
| `ISSUED` | Store sent it. **Store stock goes down now.** The store may send fewer packs than asked, but then must write a note | Lab receives |
| `RECEIVED` | Lab counted and confirmed. **Lab stock goes up now** | — |
| `SHORT` | Lab received less than the store sent (note required). The owner and store are alerted — the gap is visible, never hidden | Owner follows up |
| `REJECTED` | Store could not issue (reason sent to the lab) | Lab asks again later |
| `CANCELLED` | Lab cancelled before the store issued | — |

**The suggested request.** When an item in the lab falls to its "ask for more" level, Lab Stock shows a ready-made request at the top of the page. It asks for enough packs to bring the item back to "keep in lab", minus anything already requested or on the way:
```
packs = ceil( (parLevel − labBalance − requested − onTheWay) ÷ packSize )     (at least 1)
```
The lab can change the numbers, untick lines, add other items, mark it urgent and send it in one tap.

### 16.6 Open packs and vials (`labOpenPacks`)
Items with an opened life (analyser reagents, strip bottles, QC vials) record when a pack is opened. **Use-by = the earlier of (opened + openDays) and the lot expiry.** Opening a new pack marks the previous one finished. A pack past its use-by is a critical alert to the lab ("replace before running patient samples").

### 16.7 Physical count (blind)
The lab counts what is on the shelf and in the fridge. The system number is **not shown** while counting, so the count is honest. After submitting: matches are recorded; shortages are taken off the oldest lots (`COUNT_ADJUST`), the count is `SUBMITTED` and the owner is alerted ("check for tests run without a bill"); the owner reviews with a note → `REVIEWED`.

### 16.8 Alerts (each only to the role that acts on it — §20.1)

| Alert | To | When |
|---|---|---|
| Lab Stock Low | Lab | Lab balance ≤ ask-for-more level (critical when 0) |
| Lab Stock Expiring | Lab | A lab lot expires within 30 days (critical when expired) |
| Open Pack Past Use-by | Lab | An open pack or vial is past its use-by |
| Lab Stock Arrived | Lab | The store issued a request that the lab has not received |
| Lab Request Waiting | Store | A lab request is waiting (critical when urgent) |
| Lab Supplies to Order | Store | Store balance ≤ store reorder level |

### 16.9 Reconciliation (per item, per date range) — exact formulas
```
testsBilled   = Σ qtyPerTest over lab orders billed (or IP-charged) in range, not cancelled
testsRun      = Σ qtyPerTest over those orders whose sample was collected
usedForTests  = −Σ USED_TEST (lab) in range
qc, repeat, waste (WASTAGE + EXPIRED), countLoss = −Σ of the respective lab movement types
totalConsumed = usedForTests + qc + repeat + waste + countLoss
unexplained   = usedForTests − testsRun          (should be 0)
efficiency %  = testsRun ÷ totalConsumed × 100   ("billable tests per unit consumed")
```
A count shortage, unexplained use or a short receipt means stock went somewhere without a bill → leakage alert on the management dashboard.

### 16.10 Data model (production)
```sql
CREATE TABLE lab_item (id PK, name UNIQUE, kind, unit, pack_label, pack_size INT CHECK (pack_size >= 1), storage, open_days INT NULL,
  reorder_level INT, par_level INT CHECK (par_level > reorder_level), store_min INT, unit_cost NUMERIC(10,2), supplier_id FK NULL, container NULL, active BOOL);
CREATE TABLE lab_lot (id PK, item_id FK, lot_no, expiry DATE, supplier_id FK, invoice_no, received_at, UNIQUE (item_id, lot_no));
CREATE TABLE lab_stock_movement (id PK, item_id FK, location ENUM('STORE','LAB'), lot_id FK NULL, type, qty INT, ref, by_user FK, at, note);  -- append-only
CREATE TABLE lab_indent (id PK, requested_by FK, requested_at, urgent BOOL, note, status, issued_by, issued_at, issue_note, received_by, received_at, receive_note,
  rejected_by, rejected_at, reject_reason);
CREATE TABLE lab_indent_line (indent_id FK, item_id FK, packs_asked INT, packs_issued INT);
CREATE TABLE lab_indent_issue (indent_id FK, item_id FK, lot_id FK, qty_sent INT, qty_received INT NULL);
CREATE TABLE lab_open_pack (id PK, item_id FK, lot_id FK, opened_by, opened_at, use_by, closed_by NULL, closed_at NULL, closed_reason);
CREATE TABLE lab_count (id PK, counted_by, at, status, reviewed_by NULL, reviewed_at NULL, review_note);
CREATE TABLE lab_count_line (count_id FK, item_id FK, system_qty INT, counted_qty INT);
```
Balances are a view (`SUM(qty) GROUP BY item, location, lot`). Every write runs in one transaction with the audit row.

### 16.11 API (production)
| Method | Path | Who |
|---|---|---|
| GET | `/api/lab-stock?location=LAB\|STORE` | Lab, Store, Admin, Owner |
| POST | `/api/lab-indents` `{lines:[{itemId,packs}], urgent, note}` | Lab |
| POST | `/api/lab-indents/{id}/issue` `{packs:{itemId:n}, note}` → lots picked server-side (FEFO) | Store |
| POST | `/api/lab-indents/{id}/reject` `{reason}` · `/cancel` | Store · Lab |
| POST | `/api/lab-indents/{id}/receive` `{received:[qty per issue line], note}` | Lab |
| POST | `/api/lab-stock/supplier-receipts` `{itemId, packs, lotNo, expiry, supplier, invoiceNo, coldChainOk}` | Store |
| POST | `/api/lab-stock/use` `{itemId, qty, type: USED_QC\|REPEAT\|WASTAGE, note}` · `/discard-expired` · `/open-pack` | Lab |
| POST | `/api/lab-stock/counts` · `/counts/{id}/review` | Lab · Owner |
| POST/PUT | `/api/lab-items` | Admin, Super Admin |

### 16.12 Tests
| # | Case | Expected |
|---|---|---|
| S1 | Lab item falls to "ask for more" | Suggested request appears with packs = fill to "keep", minus requested / on the way |
| S2 | Lab sends request (urgent) | `REQUESTED`; store notified; store home and badge show it |
| S3 | Store issues fewer packs than asked without a note | Refused: "write a short note for the lab" |
| S4 | Store issues | Lots chosen oldest expiry first, expired lots skipped; store balance down; lab balance unchanged until received |
| S5 | Lab receives less than sent without a note | Refused; with a note → `SHORT`, owner and store alerted |
| S6 | Store receives a cold item without the cold-chain tick / an expired lot | Refused |
| S7 | Sample tube collected for a billed test | Reagent per test and 1 matching tube used from the oldest lab lot |
| S8 | Sample rejected | Its usage becomes `REPEAT` (not refunded) |
| S9 | QC vial opened | 1 vial used, use-by = min(opened + days, lot expiry), previous vial finished |
| S10 | Blind count with a shortage | System number hidden while counting; stock corrected; owner alerted; review closes it |
| S11 | Admin adds an item with keep ≤ ask level | Refused with a clear message |
| S12 | Lab login | No pharmacy / store alerts; store login: no lab-bench alerts (§20.1) |

---

## 17. Turnaround time (TAT) and service levels

- Each test has a target TAT in hours (catalogue). Visit `reportDueAt` = max(bill time + TAT of each test).
- Lab Workbench shows waiting time per visit and **"over TAT"** in red.
- KPIs: average TAT today, TAT report per test (count, target, average minutes, longest, over-target count).
- **[PROD]** separate TAT targets per priority (e.g. STAT ≤ 60 min).

| Test | Target TAT |
|---|---|
| Dengue NS1 | 1 h |
| FBS, PPBS, Urine routine, HIV | 2 h |
| Widal, CRP | 3 h |
| CBC | 4 h |
| LFT, RFT, HbA1c, Lipid | 6 h |
| Thyroid profile | 8 h |

---

## 18. State machines

### 18.1 Lab order (one test)
```mermaid
stateDiagram-v2
  [*] --> REQUESTED: doctor advice (not billed)
  [*] --> ON_HOLD: billed, payment not cleared
  [*] --> READY: billed & cleared / IP / package
  REQUESTED --> READY: billed & cleared
  REQUESTED --> CANCELLED: withdrawn
  ON_HOLD --> READY: paid / credit approved
  READY --> ON_HOLD: credit rejected
  READY --> SAMPLE_COLLECTED: tube collected (kits deducted)
  SAMPLE_COLLECTED --> READY: tube rejected (recollect)
  SAMPLE_COLLECTED --> RESULTED: results entered (tube received)
  RESULTED --> RESULTED: results corrected
  RESULTED --> READY: tube rejected
  RESULTED --> COMPLETED: verified (report number)
  READY --> CANCELLED: bill cancelled
  ON_HOLD --> CANCELLED: bill cancelled
  COMPLETED --> [*]
```

### 18.2 Tube
`created → collected (collectedAt) → received (receivedAt) → [rejected → created again]`. Results only after *received*.

### 18.3 Lab visit (derived, never stored)
Evaluated in this order:
1. All orders cancelled → **CANCELLED**
2. `handover` exists → **HANDED_OVER**
3. All orders completed → **SENT** if any patient delivery (WhatsApp / SMS / email / ward) else **READY**
4. Some orders completed → **PARTIAL**
5. Payment gate not cleared → **ON_HOLD**
6. All live tubes collected → **IN_LAB**
7. Some tubes collected → **COLLECTING**
8. Otherwise → **WAITING**

### 18.4 Token
`WAITING → CALLED → DONE` (DONE when every live tube is collected; back to WAITING if a tube is rejected for an OPD visit).

### 18.5 Delivery / message
`READY_TO_SEND → SENT_VIA_LINK | QUEUED_FOR_SERVER → (PROD) SENT → DELIVERED → READ | FAILED`; counter: `HANDED_OVER`; IP: `POSTED_TO_IP_RECORD`.

---

## 19. Business rules — consolidated list

| ID | Rule |
|---|---|
| **LR-1** | Every lab test belongs to a registered patient (Patient ID). |
| **LR-2** | A test reaches the lab only through a bill (OP, referral, self, package, emergency) or an IP ward order. No other way. |
| **LR-3** | No sample is collected until the payment gate is cleared (paid, credit approved, emergency, package, IP account). |
| **LR-4** | Results can be entered only after the tube is collected **and received** in the lab. |
| **LR-5** | All parameters of a test must have a result before saving. |
| **LR-6** | A report is final only after verification by a user with `lab.verify`; optional second-person rule. |
| **LR-7** | One SID per visit; one tube per container group; each tube barcode-labelled in front of the patient. |
| **LR-8** | Outside-prescription visits must have the prescription attached and a referring doctor. |
| **LR-9** | Self requests cannot include tests that require a prescription. |
| **LR-10** | Tests that require consent cannot be billed without the consent confirmation. |
| **LR-11** | Emergency visits are STAT, collected in casualty, and alert the owner. |
| **LR-12** | IP orders are charged to the IP account (`ipCharge.posted = false`) until the IP final bill posts them. |
| **LR-13** | A rejected sample returns its tests to *awaiting collection*; the used kit is logged as a repeat. |
| **LR-14** | A critical value alerts the lab and the owner immediately. |
| **LR-15** | The report is delivered per channel; every delivery is logged (channel, recipient, time, user, status). |
| **LR-16** | Printed report is handed over only if the bill has no balance (setting). |
| **LR-17** | Reports not collected within 15 days (setting) are listed as uncollected. |
| **LR-18** | Bills with any resulted/completed test cannot be cancelled. |
| **LR-19** | Every collection deducts reagent kits; kits used vs tests billed is reconciled; physical shortages alert the owner. |
| **LR-20** | Every action is written to the audit log with user and timestamp. |
| **LR-21** | Discounts above 10 % need Super Admin approval (BRD Module 09). |
| **LR-22** | Every payment belongs to the cashier's open shift (BRD Module 12). |
| **LR-23** | Only an authorised signatory (qualification + registration no.) verifies or amends; the person who entered the results cannot verify them (second-person rule). One function decides this for the service and every screen (`verifyBlock`, §38.1). |
| **LR-24** | Changing a saved result needs a reason; the old value is kept (§38.2). |
| **LR-25** | A released report is changed only by an amendment: reason required, previous version kept and viewable, earlier recipients listed for re-sending (§38.3). |
| **LR-26** | Tests marked *Confidential* in the Test Master: consent form at billing, results only for lab roles, hand-over in person after counselling, every view audited (§38.4). Unticked = normal test. |
| **LR-27** | A positive result of a test marked *Notifiable* goes on the notification register and must be reported to Ni-kshay / IHIP within 24 h (§38.5). |
| **LR-28** | A critical value must be phoned to the doctor and logged with read-back before the report is released; owner alerted after 15 min (§38.6). |
| **LR-29** | Reference range is chosen by the patient's sex, age on the collection date and pregnancy; the range used is frozen on the order (§38.6). |

---

## 20. Notifications and alerts

| Event | Severity | Sent to | Link |
|---|---|---|---|
| STAT lab request (bill) | critical | Lab | SID page |
| Ward collection (IP order) | info / critical if STAT | Lab | SID page |
| Credit requested (services on hold) | warning | Super Admin | Bill |
| Emergency credit | critical | Super Admin | Bill |
| Critical result | critical | Lab, Super Admin | Result entry |
| Sample rejected — recollect | warning | Lab + Reception (OPD) / Lab + Service counter (IP) | SID page |
| Report ready — SID | success | Lab + Reception (OPD) / Lab (IP) | SID page |
| Lab kit shortage in count | critical | Super Admin | Kits → counts |
| Service / test advised but not billed | warning | Super Admin, Reception | Billing |
| Discount approval requested | warning | Super Admin | Discounts |
| New lab test / lab price changed / test stopped or restarted | info / warning | Reception, Lab, Admin, Super Admin | Test Master (§37.7) |
| **Results to verify — <patient>** (`LAB_TO_SIGN`, closes when verified) | info | Each authorised signatory (assigned to the user) | SID page |
| Critical result in an amended report | critical | Lab, Super Admin | SID page |
| Notifiable disease positive — report on Ni-kshay / IHIP | critical | Lab, Super Admin | Notification register |
| Amended report — earlier copies to replace | warning | Lab | SID page |

**[PROD]** real-time push (WebSocket / Server-Sent Events) and optional WhatsApp alerts to the owner for critical events.

### 20.1 Live alerts are shown by role

Live alerts (the Alerts page, the sidebar badge and the Home "Needs your attention" count) are worked out from the data and **each user sees only the alerts for their own area of work**. Every alert category is tied to one permission; a user sees the alert only if their role has that permission (or the alert is assigned to them). The Super Admin has every permission and sees everything. Rules are in `assets/js/alert-rules.js`.

| Category | Shown to (permission) | Opens |
|---|---|---|
| Sample Waiting (over 1 h, not collected) | Lab (`lab.work`) | SID page |
| Critical Result (resulted, not verified) | Lab (`lab.verify`) | SID page, verify step |
| Critical Not Informed (critical value, no logged call after 15 min) | Signatories / owner (`lab.verify`) | SID page |
| Notifiable Not Reported (past the 24 h deadline) | Lab (`lab.work`) | SID page |
| Report Not Sent (ready over 2 h) / Report Not Collected | Lab (`lab.deliver`) | SID page, send step |
| Reagent Kit Low / out | Lab, Admin (`lab.kits`) | Kits |
| Lab Payment Pending (sample on hold for payment) | Reception (`hbill.collect`) | Bill |
| Advised, Not Billed | Reception (`hbill.create`) | Billing with the patient loaded |
| Credit Approval | Super Admin (`credit.approve`) | Bill |
| MRD Coding Overdue | MRD (`mrd.manage`) | Medical record |
| Stock: low / out / near expiry / expired / pharmacy refill | Store, Pharmacy (`inventory.view`) | Medicine / batch |
| GRN, adjustment, stock count, refund, cancellation, closing, cash variance | Store / Pharmacy by their approval rights | The record |

Lab, Reception and MRD never see stock or pharmacy alerts, and Pharmacy and Store never see lab or reception alerts.

---

## 21. Audit trail

Every row: `id, at (UTC), userId, action, entity, entityId, details`.

| Action | Entity | Details |
|---|---|---|
| `USER_SIGNED_IN` | USER | Workstation |
| `PATIENT_REGISTERED` / `PATIENT_UPDATED` | PATIENT | Patient ID, name |
| `HOSPITAL_BILL_CREATED` | HBILL | Patient, items, total, credit type |
| `HOSPITAL_PAYMENT_COLLECTED` | HBILL | Amount |
| `CREDIT_APPROVED` / `CREDIT_REJECTED` | HBILL | Note |
| `HOSPITAL_BILL_CANCEL_REQUESTED` / `HOSPITAL_BILL_CANCELLED` | HBILL | Reason |
| `DISCOUNT_REQUESTED` / `DISCOUNT_APPROVED` / `DISCOUNT_REJECTED` | DISCOUNT | %, amounts, reason |
| `SERVICE_REQUESTED` | ORDER | Patient, tests |
| `LAB_VISIT_CREATED` | LABVISIT | SID, source, tests, token |
| `LAB_IP_ORDER` | LABVISIT | SID, IP no, tests |
| `LAB_TUBE_COLLECTED` / `LAB_TUBE_RECEIVED` / `LAB_TUBE_REJECTED` | LABVISIT | Tube code, reason |
| `LAB_RESULTS_ENTERED` / `LAB_REPORT_VERIFIED` | ORDER | Tube code / report number |
| `MESSAGE_WHATSAPP` / `MESSAGE_SMS` / `MESSAGE_EMAIL` | LABVISIT | Template, recipient, status |
| `LAB_REPORT_HANDED_OVER` | LABVISIT | SID, name, relation |
| `LAB_KIT_RECEIVED` / `LAB_KIT_USED_QC` / `LAB_KIT_REPEAT` / `LAB_KIT_WASTAGE` / `LAB_KIT_COUNT` / `LAB_KIT_COUNT_REVIEWED` | KIT / KITCOUNT | Quantity, reason |
| `REFERRAL_DOCTOR_SAVED` | REFERRAL | Name |
| `HOSPITAL_SETUP_CHANGED` | SETUP | Area changed |
| `LAB_TEST_CREATED` / `LAB_TEST_UPDATED` / `LAB_TEST_DEACTIVATED` / `LAB_TEST_ACTIVATED` | SERVICE | Code, version, every change, reason (§37) |

Compliance actions (corrections with old → new, amendments, critical calls, report views / prints, notifiable register) are listed in §38.9.

**[PROD]** audit table append-only (no update/delete grants) with a hash chain.

---

## 22. Reports and dashboards

| Report | Contents | Who |
|---|---|---|
| Lab Workbench counts | Waiting for sample (OPD / ward / casualty), tubes to receive, results / verification pending, reports today + average TAT | Lab |
| Report desk | Ready, partial, sent, handed over, not collected; CSV export | Lab, Reception |
| Kits vs tests billed | Per kit: billed, run, used, QC, repeat, wastage, count shortage, unexplained, efficiency | Lab, Owner |
| Lab turnaround time | Per test: reports, target, average, longest, over target | Owner |
| Hospital collections by category | Daily lab revenue alongside ECG, injection, packages, pharmacy | Owner |
| Services: requested vs billed vs done | Lab row shows ordered, billed, cleared, completed | Owner |
| Referral doctors | Per outside doctor: patients, tests, value (last 30 days) | Owner |
| Management dashboard | Tests billed today, reports released, kits not matched, kit efficiency, critical results waiting | Owner |

**[PROD]** add: tests by entry channel, rejection rate per reason / per collector, critical value log, uncollected reports value, QC charts (Levey-Jennings), daily lab census (NABL register format).

---

## 23. Data model

### 23.1 Entity relationship
```mermaid
erDiagram
  PATIENT ||--o{ HOSPITAL_BILL : has
  PATIENT ||--o{ LAB_VISIT : has
  HOSPITAL_BILL ||--o{ BILL_ITEM : contains
  HOSPITAL_BILL ||--o{ PAYMENT : receives
  HOSPITAL_BILL ||--o| LAB_VISIT : creates
  LAB_VISIT ||--o{ TUBE : groups
  LAB_VISIT ||--o{ LAB_ORDER : contains
  TUBE ||--o{ LAB_ORDER : carries
  LAB_ORDER ||--o{ RESULT : has
  TEST ||--o{ LAB_ORDER : "ordered as"
  TEST ||--o{ TEST_PARAMETER : defines
  TEST ||--o{ TEST_KIT : consumes
  KIT ||--o{ TEST_KIT : "used by"
  KIT ||--o{ KIT_MOVEMENT : ledger
  LAB_VISIT ||--o{ DELIVERY : "delivered by"
  LAB_VISIT ||--o{ MESSAGE : notifies
  REFERRAL_DOCTOR ||--o{ LAB_VISIT : refers
  IP_ADMISSION ||--o{ LAB_VISIT : orders
  USER ||--o{ AUDIT_LOG : writes
```

### 23.2 Entities and fields (as built in the demo)

**patients** — `id`, `uhid`, `name`, `gender (M/F/O)`, `age`, `dob`, `phone`, `email`, `address`, `city`, `pincode`, `guardianName`, `bloodGroup`, `allergies`, `registeredAt`, `registeredBy`, `active`.

**services** (test catalogue, `category = LAB`) — `id`, `code`, `name`, `category`, `price`, `active`, `lab: { sample, container, department, tatHours, rxRequired, consentRequired, kits[{kitId, qty}], parameters[] }`.
Parameter: numeric `{ name, unit, low, high, critLow, critHigh }` or text `{ name, unit, ref }`.

**hbills** — `id`, `at`, `businessDate`, `patientId`, `patientName`, `uhid`, `phone`, `doctor`, `counterUserId`, `items[]`, `gross`, `discountPct`, `discountTotal`, `roundOff`, `grandTotal`, `discountRequestId`, `payments[]`, `credit`, `status (PAID/PARTIALLY_PAID/UNPAID/CANCELLED)`, `cancellation`, `shiftId`, `labVisitId`, `remarks`.
Item: `id, serviceId, packageId, category, name, qty, rate, listRate, gross, coveredBy`. Payment: `id, kind (PAYMENT/REFUND), mode, amount, at, userId, reference`. Credit: `type (CREDIT/EMERGENCY), reason, requestedBy/At, status (PENDING/APPROVED/EMERGENCY/REJECTED), decidedBy/At, note`.

**labVisits** — `id`, `sid`, `patientId`, `source`, `priority`, `billId`, `billingRoute`, `doctor`, `referralDoctorId`, `rxBasis`, `prescription { id, name, type, size, at, by }`, `consent { at, by }`, `token`, `tokenDay`, `tokenStatus`, `calledAt`, `collectionPoint (OPD/WARD/CASUALTY)`, `ipNo`, `ward`, `bed`, `recordId`, `clinicalNotes`, `createdAt`, `createdBy`, `reportDueAt`, `tubes[]`, `deliveries[]`, `handover`.
Tube: `code, container, orderIds[], collectedAt/By, receivedAt/By, rejected { at, by, reason, count }`.
Delivery: `channel (WHATSAPP/SMS/EMAIL/COUNTER/WARD), to, at, by, status, messageId, toDoctor`.
Hand-over: `at, by, collectedBy, name, printCount`.

**orders** (lab order = one test) — `id`, `billId`, `itemId`, `labVisitId`, `patientId`, `serviceId`, `category`, `name`, `doctor`, `requestedBy/At`, `billedAt`, `status`, `accession` (tube code), `coveredBy`, `ipCharge { amount, ipNo, posted }`, `performedBy/At`, `notes`, `lab { sampleType, tube, collectedAt/By, receivedAt/By, rejected, results[{param, value}], enteredBy/At, verifiedBy/At, reportNo, printedAt, printCount }`.

**referralDoctors** — `id`, `name`, `qualification`, `clinic`, `phone`, `city`, `active`, `addedAt`.

**messages** (outbox) — `id`, `channel`, `provider (WA_LINK/WA_CLOUD/DEVICE)`, `to`, `patientId`, `refType`, `refId`, `template`, `body`, `status`, `toDoctor`, `at`, `by`.

**labKits** — `id`, `name`, `unit`, `reorderLevel`, `active`. **kitMovements** — `id`, `at`, `kitId`, `type`, `qty (±)`, `ref`, `by`, `note`. **kitCounts** — `id`, `at`, `businessDate`, `countedBy`, `lines[{kitId, system, counted, diff}]`, `status`, `reviewedBy/At`, `reviewNote`.

Fields added for the compliance controls (signatory, history, amendments, critical calls, notification, ranges, consent, pregnancy) are listed in §38.8.

**hospitalSettings.lab** — `reportPrefix`, `accessionPrefix` (fallback only — a lab order's accession is its tube label), `requireSecondPersonVerification`, `signatoryOnly`, `criticalCallRequired`, `criticalEscalateMins`, `notifyWithinHours`, `establishmentRegNo`, `kitVarianceTolerance`, `reportCollectDays`, `payBeforeHandover`, `containers{code:{label,color}}`. **hospitalSettings.messaging** — `provider`, `countryCode`, `autoQueueOnReport`, `publicReportBaseUrl`, `senderPhone`, `cloud{enabled, phoneNumberId, businessAccountId, templateName, language}`, `templates{…}`.

---

## 24. Database schema (MySQL proposal)

> Normalised version of the demo collections. Use `utf8mb4`, InnoDB, `DATETIME(3)` in UTC, money as `DECIMAL(12,2)`. Every table also has `created_at`, `created_by`, `updated_at`, `updated_by`, `version INT` (optimistic locking).

```sql
CREATE TABLE patients (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  uhid VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  gender ENUM('M','F','O') NOT NULL,
  dob DATE NULL, age_years TINYINT UNSIGNED NULL,
  phone VARCHAR(15) NOT NULL, email VARCHAR(150) NULL,
  address VARCHAR(255) NULL, city VARCHAR(80) NULL, pincode CHAR(6) NULL,
  guardian_name VARCHAR(120) NULL, blood_group VARCHAR(4) NULL, allergies VARCHAR(255) NULL,
  whatsapp_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
  abha_number VARCHAR(20) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  INDEX ix_patients_phone (phone), INDEX ix_patients_name (name)
);

CREATE TABLE lab_containers (code VARCHAR(12) PRIMARY KEY, label VARCHAR(60) NOT NULL, color CHAR(7) NOT NULL);

CREATE TABLE lab_tests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(20) NOT NULL UNIQUE, name VARCHAR(150) NOT NULL,
  department VARCHAR(60) NOT NULL, sample_type VARCHAR(60) NOT NULL,
  container_code VARCHAR(12) NOT NULL REFERENCES lab_containers(code),
  price DECIMAL(10,2) NOT NULL, tat_hours SMALLINT NOT NULL,
  rx_required BOOLEAN NOT NULL DEFAULT FALSE, consent_required BOOLEAN NOT NULL DEFAULT FALSE,
  confidential BOOLEAN NOT NULL DEFAULT FALSE,              -- §38.4 (per-test choice)
  notifiable ENUM('TB','IDSP') NULL,                        -- §38.5
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE lab_test_parameters (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  test_id BIGINT NOT NULL REFERENCES lab_tests(id),
  seq SMALLINT NOT NULL, name VARCHAR(80) NOT NULL, unit VARCHAR(30) NULL,
  result_type ENUM('NUMERIC','TEXT') NOT NULL,
  ref_low DECIMAL(12,4) NULL, ref_high DECIMAL(12,4) NULL,
  crit_low DECIMAL(12,4) NULL, crit_high DECIMAL(12,4) NULL,
  ref_text VARCHAR(60) NULL,                                -- the default range is ref_low / ref_high
  UNIQUE KEY uq_param (test_id, name)
);

-- Age / sex / pregnancy ranges of a numeric parameter (§38.6). Most specific match wins; none = default range.
CREATE TABLE lab_reference_ranges (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  parameter_id BIGINT NOT NULL REFERENCES lab_test_parameters(id),
  label VARCHAR(60) NOT NULL, sex ENUM('ANY','M','F') NOT NULL DEFAULT 'ANY',
  age_from_days INT NOT NULL DEFAULT 0, age_to_days INT NULL, pregnant BOOLEAN NULL,   -- NULL = any; TRUE = pregnant only
  ref_low DECIMAL(12,4) NOT NULL, ref_high DECIMAL(12,4) NOT NULL, crit_low DECIMAL(12,4) NULL, crit_high DECIMAL(12,4) NULL
  -- no two ranges of one parameter may overlap in age for the same sex + pregnancy (checked by the service)
);

-- Signatory details on the users table (§38.1)
ALTER TABLE users ADD qualification VARCHAR(80) NULL, ADD council_reg_no VARCHAR(40) NULL,
  ADD lab_signatory BOOLEAN NOT NULL DEFAULT FALSE, ADD signature_file_id BIGINT NULL;   -- signatory requires qualification + reg no

CREATE TABLE lab_kits (id BIGINT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(120) NOT NULL, unit VARCHAR(20) NOT NULL, reorder_level INT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE lab_test_kits (test_id BIGINT NOT NULL REFERENCES lab_tests(id), kit_id BIGINT NOT NULL REFERENCES lab_kits(id), qty_per_test DECIMAL(8,2) NOT NULL, PRIMARY KEY (test_id, kit_id));

CREATE TABLE referral_doctors (id BIGINT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(120) NOT NULL, qualification VARCHAR(80) NULL, clinic VARCHAR(150) NULL, phone VARCHAR(15) NULL, city VARCHAR(80) NULL, active BOOLEAN NOT NULL DEFAULT TRUE);

CREATE TABLE lab_visits (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  sid CHAR(8) NOT NULL UNIQUE,
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  source ENUM('OP','IP','EMERGENCY','REFERRAL','SELF','PACKAGE') NOT NULL,
  priority ENUM('ROUTINE','URGENT','STAT') NOT NULL DEFAULT 'ROUTINE',
  bill_id BIGINT NULL, -- REFERENCES hospital_bills(id)
  billing_route ENUM('COUNTER','IP_ACCOUNT','EMERGENCY','PACKAGE') NOT NULL,
  doctor_name VARCHAR(150) NULL, doctor_user_id BIGINT NULL, referral_doctor_id BIGINT NULL REFERENCES referral_doctors(id),
  rx_basis ENUM('DOCTOR_ORDER','OUTSIDE_PRESCRIPTION','SELF_REQUEST','PACKAGE') NOT NULL,
  prescription_file_id BIGINT NULL, consent_at DATETIME(3) NULL, consent_by BIGINT NULL,
  consent_counsellor VARCHAR(120) NULL, consent_pre_test BOOLEAN NULL, consent_signed BOOLEAN NULL,   -- §38.4
  pregnant BOOLEAN NULL,                                                                              -- §38.6 (NULL = not known)
  token SMALLINT NULL, token_day DATE NULL, token_status ENUM('WAITING','CALLED','DONE') NOT NULL DEFAULT 'WAITING', called_at DATETIME(3) NULL,
  collection_point ENUM('OPD','WARD','CASUALTY') NOT NULL,
  ip_admission_id BIGINT NULL, ip_no VARCHAR(20) NULL, ward VARCHAR(60) NULL, bed VARCHAR(20) NULL,
  clinical_notes VARCHAR(500) NULL, report_due_at DATETIME(3) NOT NULL,
  handed_over_at DATETIME(3) NULL, handed_over_by BIGINT NULL, collected_by_relation VARCHAR(40) NULL, collected_by_name VARCHAR(120) NULL,
  post_test_counselled BOOLEAN NULL, authorisation_seen BOOLEAN NULL,                                 -- confidential hand-over
  UNIQUE KEY uq_token (token_day, token),
  INDEX ix_visit_patient (patient_id), INDEX ix_visit_queue (collection_point, token_status, priority)
);

CREATE TABLE lab_tubes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  visit_id BIGINT NOT NULL REFERENCES lab_visits(id),
  code VARCHAR(12) NOT NULL UNIQUE, container_code VARCHAR(12) NOT NULL REFERENCES lab_containers(code),
  collected_at DATETIME(3) NULL, collected_by BIGINT NULL, received_at DATETIME(3) NULL, received_by BIGINT NULL,
  rejected_count TINYINT NOT NULL DEFAULT 0, last_reject_reason VARCHAR(120) NULL, last_rejected_at DATETIME(3) NULL
);

CREATE TABLE lab_orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  visit_id BIGINT NULL REFERENCES lab_visits(id), tube_id BIGINT NULL REFERENCES lab_tubes(id),
  patient_id BIGINT NOT NULL REFERENCES patients(id), test_id BIGINT NOT NULL REFERENCES lab_tests(id),
  bill_id BIGINT NULL, bill_item_id BIGINT NULL, package_enrolment_id BIGINT NULL,
  ip_charge_amount DECIMAL(10,2) NULL, ip_charge_posted BOOLEAN NULL, ip_bill_id BIGINT NULL,
  status ENUM('REQUESTED','ON_HOLD','READY','SAMPLE_COLLECTED','RESULTED','COMPLETED','CANCELLED') NOT NULL,
  requested_by BIGINT NULL, requested_at DATETIME(3) NOT NULL, billed_at DATETIME(3) NULL,
  entered_by BIGINT NULL, entered_at DATETIME(3) NULL, verified_by BIGINT NULL, verified_at DATETIME(3) NULL,
  report_no VARCHAR(16) NULL UNIQUE, print_count SMALLINT NOT NULL DEFAULT 0, critical BOOLEAN NOT NULL DEFAULT FALSE,
  critical_since DATETIME(3) NULL,                          -- when the current critical values were set (a call must be after it)
  amended_at DATETIME(3) NULL, amended_by BIGINT NULL, amendment_no SMALLINT NOT NULL DEFAULT 0,
  params_snapshot JSON NULL,                                -- frozen format incl. the range used (range_label)
  INDEX ix_order_status (status), INDEX ix_order_patient (patient_id, test_id, verified_at)
);

CREATE TABLE lab_results (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL REFERENCES lab_orders(id), parameter_id BIGINT NOT NULL REFERENCES lab_test_parameters(id),
  value_text VARCHAR(60) NOT NULL, value_num DECIMAL(12,4) NULL, flag ENUM('','L','H','LL','HH','A') NOT NULL DEFAULT '',
  UNIQUE KEY uq_result (order_id, parameter_id)
);
-- Append-only. One row per changed value before release (§38.2).
CREATE TABLE lab_result_history (id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id BIGINT NOT NULL REFERENCES lab_orders(id), parameter_id BIGINT NOT NULL,
  old_value VARCHAR(60) NOT NULL, new_value VARCHAR(60) NOT NULL, reason VARCHAR(200) NOT NULL, changed_by BIGINT NOT NULL, changed_at DATETIME(3) NOT NULL);
-- Append-only. A released report changed after verification (§38.3); prev_results keeps the whole superseded version.
CREATE TABLE lab_report_amendments (id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id BIGINT NOT NULL REFERENCES lab_orders(id), amendment_no SMALLINT NOT NULL,
  reason VARCHAR(300) NOT NULL, changes JSON NOT NULL, prev_results JSON NOT NULL, prev_signed_by BIGINT NOT NULL, prev_signed_at DATETIME(3) NOT NULL,
  amended_by BIGINT NOT NULL, amended_at DATETIME(3) NOT NULL, UNIQUE KEY uq_amend (order_id, amendment_no));
-- Append-only. Every attempt, including "not reachable" (§38.6).
CREATE TABLE lab_critical_calls (id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id BIGINT NOT NULL REFERENCES lab_orders(id), to_name VARCHAR(120) NOT NULL,
  to_role ENUM('DOCTOR','WARD_NURSE','DUTY_DOCTOR') NOT NULL, phone VARCHAR(20) NULL, outcome ENUM('INFORMED','NOT_REACHABLE','LEFT_MESSAGE') NOT NULL,
  read_back BOOLEAN NOT NULL, note VARCHAR(200) NULL, critical_values VARCHAR(300) NOT NULL, called_by BIGINT NOT NULL, called_at DATETIME(3) NOT NULL,
  CHECK (outcome <> 'INFORMED' OR read_back = TRUE));
-- Notification register (§38.5)
CREATE TABLE lab_notifications (id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id BIGINT NOT NULL UNIQUE REFERENCES lab_orders(id), program ENUM('TB','IDSP') NOT NULL,
  status ENUM('PENDING','NOTIFIED') NOT NULL, positive_at DATETIME(3) NOT NULL, due_at DATETIME(3) NOT NULL,
  portal_ref VARCHAR(60) NULL, note VARCHAR(200) NULL, notified_by BIGINT NULL, notified_at DATETIME(3) NULL, INDEX ix_notif_status (status, due_at));

CREATE TABLE lab_deliveries (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, visit_id BIGINT NOT NULL REFERENCES lab_visits(id),
  channel ENUM('WHATSAPP','SMS','EMAIL','COUNTER','WARD') NOT NULL, to_doctor BOOLEAN NOT NULL DEFAULT FALSE,
  recipient VARCHAR(150) NOT NULL, status VARCHAR(30) NOT NULL, message_id BIGINT NULL, at DATETIME(3) NOT NULL, by_user BIGINT NULL,
  amendment_no SMALLINT NULL                                -- set when this delivery carries an amended report
);

CREATE TABLE message_outbox (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  channel ENUM('WHATSAPP','SMS','EMAIL') NOT NULL, provider VARCHAR(20) NOT NULL,
  recipient VARCHAR(150) NOT NULL, patient_id BIGINT NULL, ref_type VARCHAR(20) NOT NULL, ref_id BIGINT NOT NULL,
  template VARCHAR(40) NOT NULL, body TEXT NOT NULL, attachment_file_id BIGINT NULL,
  idempotency_key VARCHAR(80) NOT NULL UNIQUE,
  status ENUM('QUEUED','SENDING','SENT','DELIVERED','READ','FAILED','SENT_VIA_LINK') NOT NULL,
  provider_message_id VARCHAR(80) NULL, attempts TINYINT NOT NULL DEFAULT 0, next_attempt_at DATETIME(3) NULL, last_error VARCHAR(300) NULL,
  INDEX ix_outbox_status (status, next_attempt_at)
);

CREATE TABLE lab_kit_movements (id BIGINT PRIMARY KEY AUTO_INCREMENT, kit_id BIGINT NOT NULL REFERENCES lab_kits(id), at DATETIME(3) NOT NULL,
  type ENUM('RECEIVED','USED_TEST','USED_QC','REPEAT','WASTAGE','COUNT_ADJUST') NOT NULL, qty DECIMAL(10,2) NOT NULL, ref VARCHAR(40) NULL, lot_no VARCHAR(40) NULL, expiry DATE NULL, by_user BIGINT NOT NULL, note VARCHAR(200) NULL,
  INDEX ix_kit_ledger (kit_id, at));
CREATE TABLE lab_kit_counts (id BIGINT PRIMARY KEY AUTO_INCREMENT, business_date DATE NOT NULL, counted_by BIGINT NOT NULL, at DATETIME(3) NOT NULL, status ENUM('MATCHED','SUBMITTED','REVIEWED') NOT NULL, reviewed_by BIGINT NULL, reviewed_at DATETIME(3) NULL, review_note VARCHAR(300) NULL);
CREATE TABLE lab_kit_count_lines (count_id BIGINT NOT NULL REFERENCES lab_kit_counts(id), kit_id BIGINT NOT NULL, system_qty DECIMAL(10,2) NOT NULL, counted_qty DECIMAL(10,2) NOT NULL, PRIMARY KEY (count_id, kit_id));

CREATE TABLE files (id BIGINT PRIMARY KEY AUTO_INCREMENT, storage_key VARCHAR(255) NOT NULL, original_name VARCHAR(200) NOT NULL, mime VARCHAR(80) NOT NULL, size_bytes INT NOT NULL, sha256 CHAR(64) NOT NULL, uploaded_by BIGINT NOT NULL, uploaded_at DATETIME(3) NOT NULL);

CREATE TABLE audit_logs (id BIGINT PRIMARY KEY AUTO_INCREMENT, at DATETIME(3) NOT NULL, user_id BIGINT NULL, action VARCHAR(60) NOT NULL, entity VARCHAR(30) NOT NULL, entity_id VARCHAR(40) NOT NULL, details VARCHAR(500) NULL, before_json JSON NULL, after_json JSON NULL, workstation VARCHAR(20) NULL, ip VARCHAR(45) NULL,
  INDEX ix_audit_entity (entity, entity_id), INDEX ix_audit_user (user_id, at));
```

Sequences: SID, token, report number and bill number must come from a **locked counter table** (`SELECT … FOR UPDATE`) to stay gap-free and unique under concurrent billing.

---

## 25. REST API specification

Base path `/api/v1`. JSON. Auth: session cookie or JWT; every call checks the permission in brackets. Errors: `{ "error": { "code": "LR-3", "message": "Payment is not cleared…" } }` with HTTP 409 (business rule), 400 (validation), 403 (permission), 404.

### 25.1 Patients
| Method | Path | Purpose |
|---|---|---|
| GET | `/patients?q=` | Search by name / UHID / phone `[patient.view]` |
| POST | `/patients` | Quick or full registration `[patient.register]` → returns `uhid` |
| GET | `/patients/{id}/duplicates?name=&phone=&age=` | Duplicate check |
| GET | `/patients/{id}/timeline` | Bills, lab reports, services, admissions |

### 25.2 Billing (lab part)
| Method | Path | Purpose |
|---|---|---|
| GET | `/lab/tests?q=&active=true` | Catalogue for the billing screen |
| GET | `/patients/{id}/pending-orders` | Doctor requests not billed (OP) |
| POST | `/files` (multipart) | Upload prescription → `fileId` |
| POST | `/hospital-bills` | Create bill incl. `lab` block `[hbill.create]` |
| POST | `/hospital-bills/{id}/payments` | Collect balance `[hbill.collect]` |
| POST | `/hospital-bills/{id}/credit/decision` | Approve / reject credit `[credit.approve]` |
| POST | `/hospital-bills/{id}/cancellation` · `/decision` | Request / approve cancel |

Create bill request (example):
```json
{
  "patientId": 1207,
  "doctor": "Dr. M. Venkateswaran, M.D (Gen Med)",
  "lines": [{ "testCode": "CBC", "qty": 1 }, { "testCode": "CRP", "qty": 1 }, { "testCode": "THYROID", "qty": 1 }],
  "discountPct": 0,
  "payments": [{ "mode": "CASH", "amount": 1500, "tendered": 2000 }],
  "lab": { "source": "REFERRAL", "referralDoctorId": 1, "prescriptionFileId": 9981, "priority": "ROUTINE", "consent": false, "notes": "Fasting" }
}
```
Response:
```json
{ "billId": "HB-2026-00088", "status": "PAID", "grandTotal": 1500,
  "labVisit": { "sid": "04010063", "token": 9, "reportDueAt": "2026-11-26T15:10:00Z",
    "tubes": [{ "code": "04010063-1", "container": "EDTA", "tests": ["CBC"] }, { "code": "04010063-2", "container": "PLAIN", "tests": ["CRP", "THYROID"] }] } }
```

### 25.3 Lab desk
| Method | Path | Purpose |
|---|---|---|
| GET | `/lab/queue?point=OPD|WARD|CASUALTY` | Waiting visits, priority + token order `[lab.work]` |
| POST | `/lab/visits/{id}/call` | Call token |
| GET | `/lab/visits/{id}` | SID page (visit, tubes, orders, gate, deliveries) `[lab.view]` |
| GET | `/lab/visits/{id}/labels` | Label data / ZPL for the printer |
| POST | `/lab/visits/{id}/tubes/{code}/collect` | Collect tube (kits deducted) `[lab.work]` |
| POST | `/lab/tubes/{code}/receive` | Receive by scan |
| POST | `/lab/tubes/{code}/reject` | `{ reason }` |
| GET | `/lab/orders?status=SAMPLE_COLLECTED|RESULTED` | Results / verify queues |
| PUT | `/lab/orders/{id}/results` | `{ results: [{ parameterId, value }], reason? }` → flags and range computed server-side; `reason` required when a saved value changes (§38.2) |
| GET | `/lab/visits/{id}/verify-state` | `{ next: SIGN\|CALL\|WAIT_DOCTOR\|NONE, sign[], call[], doctors[] }` for the signed-in user — drives the buttons (§38.1) |
| POST | `/lab/orders/{id}/verify` | Verify → report number. Refused with the `verifyBlock` code: `NOT_SIGNATORY`, `OWN_ENTRY`, `CALL_NEEDED`, `NOT_ENTERED` `[lab.verify + signatory]` |
| POST | `/lab/orders/{id}/critical-calls` | `{ toName, toRole, phone, outcome, readBack, note }` — `INFORMED` needs `readBack: true` (§38.6) |
| POST | `/lab/orders/{id}/amendments` | `{ results, reason }` → new amendment; COMPLETED orders only `[signatory]` (§38.3) |
| GET | `/lab/orders/{id}/history` | Corrections and amendments with old / new values |
| PUT | `/lab/visits/{id}/pregnancy` | `{ pregnant: true\|false\|null }` — re-applies ranges to tests not yet released |
| POST | `/lab/ip-orders` | Ward order `[lab.order.ip]` |

### 25.4 Reports and delivery
| Method | Path | Purpose |
|---|---|---|
| GET | `/lab/visits/{id}/report.pdf?asOf=` | Combined report (partial allowed). `asOf` returns a superseded version with the watermark. Every call is audited (`LAB_REPORT_VIEWED` / `LAB_REPORT_PRINTED`); confidential reports return 403 to non-lab roles and audit `LAB_REPORT_VIEW_REFUSED` |
| GET | `/lab/notifications?status=PENDING\|NOTIFIED` · `/lab/notifications.csv` | Notification register (§38.5) |
| POST | `/lab/notifications/{id}/reported` | `{ portalRef, note }` |
| GET | `/lab/report-desk?tab=ready|partial|sent|handed|uncollected` | Report desk |
| POST | `/lab/visits/{id}/deliveries` | `{ channel, toDoctor }` → queues message / returns link |
| POST | `/lab/visits/{id}/handover` | `{ collectedBy, name, counselled, authorised }` — confidential tests need `counselled`, and `authorised` when not the patient |
| GET | `/r/{sid}?k=` | Public signed report link **[PROD]** (no login, rate-limited) |
| POST | `/webhooks/whatsapp` | Meta delivery status webhook **[PROD]** |

### 25.5 Kits and masters
`PUT /users/{id}/signatory` `{ qualification, councilRegNo, signatory, signatureFileId }`, `GET/PUT /settings/lab` (§38.7), `GET/POST /lab/kits`, `POST /lab/kits/{id}/receipts`, `POST /lab/kits/{id}/usage`, `POST /lab/kit-counts`, `POST /lab/kit-counts/{id}/review`, `GET /lab/kit-reconciliation?from=&to=`, `GET/POST/PUT /referral-doctors`, `GET/PUT /lab/tests/{id}`, `GET/PUT /settings/messaging`.

---

## 26. Backend architecture

### 26.1 Components
```mermaid
flowchart LR
  UI[Web UI - billing, lab desk, report desk] --> GW[Spring Boot REST API]
  TV[Token display TV] -->|SSE| GW
  GW --> SVC[Service layer: PatientService, BillingService, LabVisitService, LabResultService, DeliveryService, KitService]
  SVC --> DB[(MySQL)]
  SVC --> FS[(File storage: prescriptions, PDFs)]
  SVC --> OB[(Message outbox table)]
  WK[Messaging worker] --> OB
  WK --> WA[WhatsApp Cloud API]
  WK --> SMS[SMS gateway - DLT]
  WK --> SMTP[SMTP / email]
  WA -->|webhooks| GW
  PRN[Label printer] <-- ZPL --- GW
```

### 26.2 Transaction boundaries (same as the demo's `store.transaction` calls)
| Service method | Must be atomic |
|---|---|
| `BillingService.createBill` | bill + items + payments + orders + lab visit + tubes + token + package enrolment + discount request "used" + audit + notifications |
| `LabVisitService.collectTube` | tube collected + orders → SAMPLE_COLLECTED + kit movements + token status + audit |
| `LabVisitService.rejectTube` | tube reset + orders → READY + results cleared + kit movements → REPEAT + audit + notification |
| `LabResultService.verify` | report number + order COMPLETED + (visit complete → IP posting / outbox row) + audit |
| `DeliveryService.deliver` | outbox row + delivery row + audit |
| `KitService.submitCount` | count + lines + COUNT_ADJUST movements + audit + alert |

### 26.3 Concurrency
- Optimistic locking (`version`) on visits, tubes, orders, bills.
- Counters (SID, token, report no.) with `SELECT … FOR UPDATE` on a counters table.
- Idempotency keys on POSTs from scanners (double scan = no double collection).

### 26.4 Files
- Prescriptions, scanned documents and report PDFs in object storage; DB keeps metadata + SHA-256.
- Max 8 MB per upload; images converted to compressed JPEG; PDFs virus-scanned (ClamAV) **[PROD]**.

### 26.5 Printing
- Labels: 50 × 25 mm thermal (Zebra / TSC) via ZPL/TSPL sent from the server or a local print agent; fallback A4 label sheet.
- Reports: A4 PDF generated server-side, letterhead from settings.

### 26.6 Deployment (BRD pending item)
Cloud (recommended — owner wants remote access) or on-premise server: 4 vCPU, 8 GB RAM, 100 GB SSD, separate file storage, daily encrypted backups (DB + files), HTTPS only.

---

## 27. Screens and UI specification

| # | Screen (route in demo) | Users | Purpose | Key elements |
|---|---|---|---|---|
| S1 | Hospital Bill `#/hbill` | Reception | Bill lab tests | Patient search + register, doctor, pending doctor requests, catalogue (category chips, search, price, sample, TAT), bill lines, **Lab request card**, discount with approval, payment modes (Cash, UPI, Card, Split, Credit, Emergency), validation messages, shift chip |
| S2 | Bill receipt `#/hbills/{id}/receipt` | Reception | Print bill | SID, token, report date, 15-day note, department routing |
| S3 | Lab Worklist `#/lab?stage=…&v=…` | Lab | Daily work | Scan box (scan tube = collect / receive, scan SID = open, type = search); tabs **To collect · To receive · Enter results · To verify · Ready to send** with live counts; one table, one action button per row; columns **S.No · Type (OP / IP / CAS / REF / SELF / PKG) · Token / Bed · SID · Patient · Tests · Priority · Waiting**, plain text (§38); filters **Patient type** (with counts) and *STAT only*; "waiting for payment" as a button, not a step; clicking a row opens the patient screen (S5) in place, Esc goes back |
| S4 | Collection dialog | Lab | Collect tubes | Patient identity banner, 3 numbered steps, print labels, scan-to-confirm (wrong label refused), drawn tubes in cap colours, progress bar, closes itself when every tube is in |
| S5 | Patient screen (in the worklist, or full page `#/lab/visit/{id}`) | Lab, Reception | Everything for one visit | **Hospital-style layout (v1.1):** patient banner (name, age/sex, UHID, SID, token or bed, patient-type tag, doctor, waiting, priority, allergy / critical alerts); result grid Parameter · Result · Unit · Flag · Normal range · Previous; one action bar; side panel with sample tubes, visit facts and links (labels, report, progress, activity log, patient file). Behaviour kept from v1.0: patient header (name, age/sex, ID, mobile, allergy, SID barcode); 6-step progress (Paid → Collected → In lab → Results → Verified → Delivered); a **Next step** banner with one button; each tube with its tests and **result entry for all tests together** (live High / Low / Critical flags, previous result, Enter = next box, Ctrl+S = save, sticky save / verify bar); per-test Correct / Verify; send card; details; activity timeline |
| S6 | Labels & request sheet `#/lab/visit/{id}/labels` | Lab | Print | 50 × 25 mm labels + A4 request sheet |
| S7 | (old link) `#/lab/orders/{id}` | — | Redirect | Opens the SID page at the results / verify step — results are entered per patient, not per test |
| S8 | Combined report `#/lab/visit/{id}/report` | Lab, Reception, MRD | Print | Letterhead, patient block, per-test tables, flags, signatures |
| S9 | Report Desk `#/lab/reports` | Lab, Reception | Deliver | Tabs ready / partial / sent / handed / not collected; search by SID / phone; CSV |
| S10 | Token display `#/lab/display` | TV | Waiting area | Counter-token patients only (no ward / casualty — §11.1); Now calling (large, flashes on change), Also called, Next in line tiles with count and +N more, priority tiles in red, live clock, Full screen (F), auto-refresh; responsive |
| S11 | Ward Lab Order `#/lab/ward-order` | Nurse, Lab | IP orders | Admitted patient picker, doctor, priority, tests (with container), notes, **"Also send the report to the patient's WhatsApp"** (shows the number; ticked when the patient has a mobile), today's ward orders |
| S12 | Reagent Kits `#/lab/kits` | Lab, Owner | Inventory | Stock, kits vs tests billed, physical counts, ledger; receive, QC/repeat/wastage, count |
| S13 | Hospital Setup → Lab tests / Messaging / Referral doctors `#/setup` | Owner | Configure | Test formats, kit per test, messaging provider & templates with WhatsApp preview, referral doctor master with 30-day statistics |
| S14 | Management dashboard `#/management` | Owner | Oversight | Lab & MRD panel, reconciliation alerts |
| S15 | Lab Test Master list `#/lab/tests` | Admin, Super Admin (edit); Reception, Lab, MRD (read) | The test list | See §37.5 |
| S16 | Lab test editor `#/lab/tests/{id}` | Admin, Super Admin | Add / edit / stop a test | See §37.5 |

UI principles kept from the demo: plain language ("Waiting for sample", "Payment pending"), colour-coded tube chips, big touch-friendly buttons at counters, every list searchable and exportable, print layouts with the hospital letterhead.

---

## 28. Configuration (Hospital Setup)

| Setting | Default | Where |
|---|---|---|
| Report number prefix | `LR` | lab |
| Second-person verification | Off | Rules |
| Kit variance tolerance | 2 | Rules |
| Report collection window | 15 days | lab |
| Pay before hand-over | On | lab |
| Containers (label, colour) | EDTA, PLAIN, FLUORIDE, URINE | lab |
| Emergency billing allowed | On | Rules |
| Messaging provider | `WA_LINK` | Messaging |
| Country code | 91 | Messaging |
| Sender phone in messages | hospital number | Messaging |
| Public report link base URL | blank | Messaging |
| WhatsApp Cloud: phone number id, template name, enabled | blank / `lab_report_ready` / off | Messaging |
| Message templates | §15.2 | Messaging |
| Lab tests: name, code, price, sample, tube, ranges, rules, kits, offered / stopped | §29, §37 | **Lab Test Master** `#/lab/tests` (Admin, Super Admin) |
| Kit reorder levels | §29 | Lab kits |
| Referral doctors | 5 sample doctors | Referral doctors |
| Staff discount limit | 10 % | Settings (pharmacy & billing) |
| Workstation restriction | Off | Workstations |

Lab compliance rules (signatories, critical call, alert minutes, notifiable deadline, establishment Reg. No.) are in **Rules** — see §38.7.

---

## 29. Master data — test catalogue, containers, kits

The list below is the **starting data**. In the running system it is maintained in the **Lab Test Master** (§37) by the Admin / Super Admin.

### 29.1 Test catalogue (demo seed — replace with the hospital's list and ranges)
| Code | Test | ₹ | Sample | Container | Dept | TAT h | Rx req. | Consent |
|---|---|---|---|---|---|---|---|---|
| CBC | Complete Blood Count | 350 | Blood (EDTA) | EDTA | Haematology | 4 | – | – |
| LFT | Liver Function Test | 650 | Blood (Plain) | PLAIN | Biochemistry | 6 | – | – |
| RFT | Renal Function Test | 550 | Blood (Plain) | PLAIN | Biochemistry | 6 | – | – |
| FBS | Blood Sugar — Fasting | 80 | Blood (Fluoride) | FLUORIDE | Biochemistry | 2 | – | – |
| PPBS | Blood Sugar — Post Prandial | 80 | Blood (Fluoride) | FLUORIDE | Biochemistry | 2 | – | – |
| HBA1C | HbA1c | 550 | Blood (EDTA) | EDTA | Biochemistry | 6 | – | – |
| LIPID | Lipid Profile | 600 | Blood (Plain) | PLAIN | Biochemistry | 6 | – | – |
| THYROID | Thyroid Profile (T3, T4, TSH) | 700 | Blood (Plain) | PLAIN | Immunoassay | 8 | – | – |
| URINE | Urine Routine Examination | 150 | Urine | URINE | Clinical Pathology | 2 | – | – |
| NS1 | Dengue NS1 Antigen | 600 | Blood (Plain) | PLAIN | Serology | 1 | – | – |
| WIDAL | Widal Test | 250 | Blood (Plain) | PLAIN | Serology | 3 | – | – |
| CRP | C-Reactive Protein | 450 | Blood (Plain) | PLAIN | Immunoassay | 3 | – | – |
| HIV | HIV 1 & 2 Antibody (rapid) | 500 | Blood (Plain) | PLAIN | Serology | 2 | ✅ | ✅ |

### 29.2 Report parameters (demo seed)
| Test | Parameters (reference; critical) |
|---|---|
| CBC | Haemoglobin 12–17 g/dL (crit 7 / 20); Total WBC 4000–11000 cells/cumm (crit 2000 / 30000); Platelets 1.5–4.5 lakh/cumm (crit 0.5 / 10); RBC 4.2–5.9 million/cumm; PCV 36–50 %; Neutrophils 40–75 %; Lymphocytes 20–45 % |
| LFT | Total bilirubin 0.2–1.2 mg/dL; Direct bilirubin 0–0.3; SGOT 5–40 U/L; SGPT 7–56 U/L; ALP 44–147 U/L; Total protein 6–8.3 g/dL; Albumin 3.5–5 g/dL |
| RFT | Urea 15–40 mg/dL; Creatinine 0.6–1.3 (crit high 5); Uric acid 3.4–7; Sodium 135–145 mmol/L (crit 120 / 160); Potassium 3.5–5.1 (crit 2.5 / 6.5) |
| FBS / PPBS | Glucose 70–100 / 70–140 mg/dL (crit 40 / 400) |
| HbA1c | HbA1c 4–5.6 %; eAG 68–114 mg/dL |
| Lipid | Total cholesterol 0–200; TG 0–150; HDL 40–60; LDL 0–100; VLDL 5–40 mg/dL |
| Thyroid | T3 0.8–2 ng/mL; T4 5.1–14.1 µg/dL; TSH 0.27–4.2 µIU/mL |
| Urine | Colour *Pale yellow*; Appearance *Clear*; pH 4.6–8; Sugar *Nil*; Albumin *Nil*; Pus cells 0–5 /hpf; RBCs 0–2 /hpf |
| NS1 | *Negative* · Widal O/H *< 1:80* · CRP 0–6 mg/L · HIV *Non-reactive* |

> **Clinical sign-off required:** reference ranges in production must come from the hospital's pathologist and the analyser/kit inserts, with **age- and sex-specific ranges** (e.g. haemoglobin differs for men, women and children).

### 29.3 Kits (demo seed)
CBC reagent pack, LFT kit, RFT kit, glucose reagent/strips, HbA1c cartridge, lipid kit, thyroid cartridge, urine strips, dengue NS1 card, Widal kit, CRP cartridge, HIV 1&2 card — each with unit and reorder level.

---

## 30. Security, privacy and compliance

- **RBAC** per §5; every API checks permissions server-side (the UI hiding a button is not security).
- **Workstation restriction** (BRD 14): lab users sign in only on the Laboratory workstation when enforced; Super Admin anywhere. Combined with the allowed hospital network list. **[PROD]** enforced by the server (device token + IP allow-list).
- **Audit**: append-only, includes sign-ins and every lab action (§21).
- **Personal health data** is sensitive personal data under India's **Digital Personal Data Protection Act, 2023** — collect only what is needed, record consent (WhatsApp opt-in), allow correction, protect with encryption in transit (HTTPS/TLS 1.2+) and at rest (DB / disk encryption), restrict exports.
- **Report links** (if enabled): random, unguessable, expiring, rate-limited, every access logged; no patient data in URLs other than the SID.
- **WhatsApp tokens and SMTP/SMS credentials** only on the server (environment secrets / vault).
- **HIV and other sensitive tests**: consent before billing; reports delivered only to the patient (no referring-doctor auto copy without consent) **[PROD]**; restricted visibility role (open question).
- **Retention**: lab records and reports kept per hospital policy (commonly years for medico-legal reasons — confirm with the hospital); deleted only by policy, never by users.
- **Accreditation readiness**: NABL (ISO 15189) expects sample rejection logs, critical value communication logs, TAT monitoring, QC records and report authorisation — the data model above supports these.

---

## 31. Non-functional requirements

| Area | Requirement |
|---|---|
| Users | ~6 workstations, up to 10 user accounts (BRD) — design for 50 concurrent users |
| Performance | Billing / scan actions < 1 s; queue refresh < 2 s; report PDF < 3 s |
| Availability | 99.5 % during hospital hours; graceful offline message |
| Scanners | Keyboard-wedge Code 128 scanners; Enter key submits |
| Printers | 50 × 25 mm thermal labels; A4 laser for reports; A5/A4 receipts |
| Browsers | Latest Chrome / Edge on Windows; tablet-friendly lab screens |
| Backups | Daily DB + files, 30-day retention, monthly restore test |
| Time | Server UTC, display IST; business day per settings |
| Localisation | English UI; patient messages may need Tamil templates (open question) |
| Accessibility | Large text option on the token display, colour plus text for every status |

---

## 32. Edge cases and exception handling

| Case | Expected behaviour |
|---|---|
| Patient pays part, no credit | Visit **Payment pending**; not in queue; appears after balance is collected |
| Credit rejected after approval of nothing collected | Orders back to ON_HOLD; patient must pay |
| Wrong tube scanned in collection dialog | Error "This label does not belong to this patient" |
| Tube scanned twice | Ignored (already collected / received) |
| Results entered then sample found haemolysed | Reject tube → results cleared, orders back to READY, kit logged as REPEAT |
| Patient leaves before collection | Visit stays WAITING; cancellation through owner approval with refund |
| One test pending, others verified | Partial report allowed; full report when last test is verified |
| Critical value at night | Alert to lab + owner; **[PROD]** call log mandatory before verification |
| Patient has no smartphone / WhatsApp | SMS or counter hand-over |
| Patient has no email | Email button disabled with "No email on record" |
| Referral doctor not in master | "New doctor" from the billing screen |
| HIV on self request | Blocked (needs prescription) |
| HIV without consent tick | Blocked |
| IP patient discharged before report | Report still posted to the IP record; MRD lists it in the stay |
| Bill cancellation after a test is resulted | Blocked; use credit note / write-off policy (owner) |
| Duplicate registration | Warning with "Use this patient" |
| Two cashiers bill at once | Unique SID / token via locked counters |
| Message sending fails (PROD) | Retry with backoff, then FAILED + lab alert; staff can resend or hand over |
| Kit balance would go negative | Usage entry refused; collection still allowed but shortage appears in count/reconciliation (**[PROD]** decide: block or warn) |

---

## 33. Acceptance test cases

| # | Scenario | Steps | Expected |
|---|---|---|---|
| T1 | Referral without prescription | Bill CBC + CRP, source Outside prescription, no file | Blocked: "Attach the outside prescription…" |
| T2 | Self request with HIV | Bill HIV, source Self | Blocked: "…cannot be done on a self request…" |
| T3 | HIV without consent | Bill HIV, source Referral with prescription, consent unticked | Blocked: consent message |
| T4 | Referral full flow | Bill CBC + CRP + FBS with prescription, Urgent, cash | Bill PAID; 1 SID; 3 tubes (EDTA, PLAIN, FLUORIDE); token assigned; receipt shows SID, token, report date, 15-day note |
| T5 | Token call | Lab Workbench → Collect → Call | Token display shows "Now calling <token>" |
| T6 | Scan to collect | Collection dialog → scan each tube | Tubes collected; orders SAMPLE_COLLECTED; kits reduced by 1 each; token DONE |
| T7 | Wrong label | Scan another SID's tube in the dialog | Error, nothing changes |
| T8 | Results before receipt | Try to enter results for a collected, not received tube | Blocked: "Receive the tube in the lab…" |
| T9 | Reject & recollect | Receive tube 2 → Reject "Haemolysed" | Orders back to READY; kit movement REPEAT; visit COLLECTING; patient back in queue |
| T10 | Flags | Enter Hb 6.5 | Flag LL; critical alert to lab + owner |
| T11 | Verify all | Enter and verify every test | Report numbers assigned; visit READY; "Report ready" notification |
| T12 | WhatsApp | SID page → WhatsApp | Opens `wa.me/91<mobile>?text=…`; delivery + message logged; visit SENT |
| T13 | Doctor copy | SID page → Referring doctor | WhatsApp to the doctor's mobile with doctor template |
| T14 | Hand-over with balance | Bill with balance → Hand over | Blocked with amount due |
| T15 | Hand-over | Paid bill → Hand over (Self) | Visit HANDED_OVER; print opens |
| T16 | OP doctor request | Service counter records LIPID for patient → reception adds "Advised…" → bill | Source OP; the same order row is linked; no duplicate |
| T17 | Credit on hold | Bill with Credit + reason | Visit Payment pending (not in queue); owner approves → appears in queue |
| T18 | Emergency | Bill with Emergency | Source EMERGENCY, STAT, casualty, owner alert, collectable immediately |
| T19 | Package | Patient with Master Health Check-up → bill CBC | CBC at ₹0 "In package"; route PACKAGE when all covered |
| T20 | IP ward order | Ward Lab Order for admitted patient, STAT | Visit WARD with ward/bed; gate "IP account"; ipCharge posted=false; after verification delivery WARD |
| T21 | Cancellation blocked | Bill with a verified test → request cancel | Blocked |
| T22 | Cancellation approved | Unprocessed bill → request → owner approves | Orders CANCELLED; refund recorded; visit Cancelled |
| T23 | Kit count shortage | Count CBC reagent 2 less | Count SUBMITTED; owner alert; stock adjusted; appears in Approvals |
| T24 | Reconciliation | Kits vs tests billed for 7 days | Matches formulas §16.4 |
| T25 | Uncollected | Report ready > 15 days, not handed over | Listed in "Not collected" |
| T26 | Permissions | Sign in as Service Counter → open Lab Workbench | Access restricted; Ward Lab Order allowed |
| T27 | Shift | Reception without open shift → complete bill | Prompted to start shift |
| T28 | Audit | After T4–T15 | Audit rows for every step with user and time |

Lab Test Master tests T29–T36 are in §37.10; compliance tests T43–T54 in §38.12.

### 33.1 Automated test suite (116 tests, runs in the browser)

`tests/lab.tests.js` holds **116 automated tests (LT-001 … LT-116)** that call the same functions the screens use, plus a few that render the real screens. No install or build is needed. How to run them is in [tests/README.md](../tests/README.md). The run resets the demo data before and after.

| Group | IDs | What is checked |
|---|---|---|
| Seed | LT-001–008 | Signatory users, lab settings, test flags (confidential / notifiable), every test passes Test Master validation, no overlapping ranges, showcase data |
| Ranges | LT-009–021 | Child, adult female / male, pregnancy, newborn, infant ranges; default range; band validation; who is asked about pregnancy; same value normal for a child and low for an adult |
| Billing | LT-022–032 | Visit, SID, token, tubes, accession = tube label, tube grouping, self / referral / consent refusals, consent and pregnancy stored, unpaid bill refused |
| Sample | LT-033–043 | Token call, collect, wrong label, idempotent collect, receive rules, reject with reason and back to collect, kit used, ward (IP) order |
| Results | LT-044–055 | All parameters required, frozen range, audit with values, flags, correction reason and history, no-op save, critical detection and alert, doctor notified, frozen format |
| Verify | LT-056–068 | Signatory and second-person rules (and their settings), report number, notification closed, partial vs ready, verify state per user, patient history, report due time |
| Critical | LT-069–077 | Call required, read-back, not reachable, informed, correction keeps / needs call, setting off, owner alert after 15 min |
| Amend | LT-078–086 | Who / when / reason / change rules, old version and report no. kept, second amendment, stale recipients, ward re-post |
| Confidential | LT-087–094 | Roles, no WhatsApp / SMS / email, counselling and authorisation at hand-over, switch off = normal test, hidden in history, locked report page with audit |
| Notifiable | LT-095–098 | TB positive on the register (24 h), negative not listed, portal ID required, overdue alert |
| Master / Report | LT-099–100 | Overlapping range refused on save; printed report shows AMENDED, Reg. Nos., signer and range |
| OP / IP link | LT-101–116 | Tariff ↔ Lab Test Master link and one price; OP bill → lab visit (paid = ready, unpaid = on hold, paying releases, doctor's orders, cancel); full flow from an OP bill; ward order for an IP admission posts to the IP bill; folio charge → lab; reverse before / after collection; who may order; discharged / final-billed refused; screens (§39) |

**Last run:** 28 Nov 2026 — **116 / 116 passed** (Chrome, demo data version 13). The production team should port these to backend unit / integration tests (JUnit) against the same rules — the test names are written as the rule they prove.

---

## 34. Future enhancements (phase 2+)

> Legal / compliance gaps and the must-fix list before go-live are in [LAB_COMPLIANCE_AUDIT.md](LAB_COMPLIANCE_AUDIT.md). The must-fix items F1–F6 are built — see §38.
>
> The full phase 2 flows (data, rules, screens, tests and build order) are in [LAB_PHASE2_SPECIFICATION.md](LAB_PHASE2_SPECIFICATION.md).

1. **Analyser interface** — bidirectional HL7 v2 (ORM/ORU) or ASTM E1394 via a middleware (e.g. Mirth Connect): worklist download by tube barcode, automatic result upload, technician validates instead of typing.
2. ~~Age / sex / pregnancy-specific reference ranges~~ — **built (§38.6)**; units conversion still to do.
3. **Delta checks and auto-verification rules** for normal results (pathologist-approved).
4. ~~Critical value call log~~ — **built (§38.6)**.
5. **QC module** — control levels, Levey-Jennings charts, Westgard rules, block patient reporting when QC fails.
6. **Outsourced tests** — send-out to a reference lab with tracking and imported PDF.
7. **Home sample collection** — booking, phlebotomist route, payment link.
8. **Microbiology** (culture & sensitivity, multi-day preliminary/final reports), **histopathology**, **blood bank**.
9. **Patient portal / app** — reports history, downloads, ABHA (ABDM) linking for national health records.
10. **Tamil message templates** and Tamil report headings.
11. **Referral commission statements** (if the hospital adopts a policy).
12. **TV token audio announcements** and a second display at the main counter.

---

## 35. Open questions for the hospital

| # | Question | Affects |
|---|---|---|
| Q1 | Final test list, prices, **reference ranges (age/sex)**, critical limits and TAT per test | Catalogue, flags |
| Q2 | Who verifies and signs reports — pathologist, MD, lab in-charge? Name, registration number, signature image | Verification, report |
| Q3 | Sample report and bill format currently used (letterhead, NABL logo, disclaimers) | Report / receipt layout |
| Q4 | Label printer model and label size | Label printing |
| Q5 | Which tests need a prescription or consent (beyond HIV)? | Self requests |
| Q6 | IP lab charges: added to the IP final bill (assumed) or paid per test? | IP integration |
| Q7 | Do outside referral doctors receive a copy? Any commission policy? | Delivery, reports |
| Q8 | STAT for OP before payment — allowed? | Payment gate |
| Q9 | WhatsApp: hospital number to register with Meta; message language (English / Tamil) | Messaging |
| Q10 | Report collection window (15 days?) and retention policy | Uncollected list, archiving |
| Q11 | Token display needed? Audio announcements? | Hardware |
| Q12 | Analyser makes/models for future interfacing | Phase 2 |

---

## 36. Demo code map

| File | Responsibility |
|---|---|
| `assets/js/labflow.js` | Lab pipeline engine: sources, priorities, visit status, payment gate, SID & token, tube grouping, IP orders, collect / receive / reject, report routing, delivery, hand-over, referral doctors |
| `assets/js/hospital.js` | Central billing (validation, bill creation → lab visit), payment collection, credit, cancellation, order access, result entry, flags, verification, kit movements & reconciliation |
| `assets/js/messaging.js` | Messaging providers (WA_LINK / WA_CLOUD), templates, `wa.me` / `sms:` / `mailto:` links, outbox log |
| `assets/js/patients.js` + `modules/patients.js` | Registration (quick form, email), duplicates, timeline |
| `assets/js/modules/hbilling.js` | Billing screen incl. Lab request card |
| `assets/js/modules/hbills.js` | Bill list, detail, receipt (SID, token, report date) |
| `assets/js/modules/lab/ui.js` | Lab UI kit: patient line, tube caps, test chips, wait time, visit journey (stepper), next action |
| `assets/js/modules/lab/stages.js` | Stage registry — the five lab steps: what belongs to each, how a row looks, scan-box behaviour |
| `assets/js/modules/lab/workbench.js` | Lab Workbench screen (`#/lab`) |
| `assets/js/modules/lab/sid.js` | SID page: results for all tests, verification, sending, activity |
| `assets/js/modules/lab/collect.js` | Collection dialog, reject dialog, receive and token-call helpers |
| `assets/js/modules/labdesk.js` | Labels & request sheet, combined report, report desk, token display, ward order |
| `assets/js/modules/lab.js` | Reagent kits |
| `assets/css/lab.css` | Lab workspace styles |
| `assets/js/labstock.js` | Lab stock logic: one STORE / LAB ledger by lot, FEFO, request → issue → receive, supplier receipts, open packs, blind counts, suggested requests, reconciliation (§16) |
| `assets/js/modules/lab/stock.js` | Lab Stock screen `#/lab/stock` (lab): summary, ready-made request, receive, items, counts, history, item list, used vs billed |
| `assets/js/modules/lab/storeside.js` | Lab Supplies screen `#/store/lab` (store): lab requests to issue, receive from supplier, store lots, write-off |
| `assets/js/modules/lab/stockui.js` | Shared lab stock pieces: level bar, state pills, request journey, item detail dialog |
| `assets/js/labmaster.js` | Lab Test Master logic: validation, save with version history, freezing old report formats, stop / restart, usage, diff |
| `assets/js/modules/lab/master.js` | Lab Test Master screens: list (`#/lab/tests`) and editor (`#/lab/tests/{id}`) |
| `assets/js/modules/setup.js` | Kits, messaging settings, referral doctors (the lab tests tab links to the Test Master) |
| `assets/js/labrules.js` | Compliance rules: age / sex / pregnancy ranges, signatories, confidential and notifiable tests (§38.10) |
| `assets/js/modules/lab/notifiable.js` | Notification register `#/lab/notifiable` (§38.5) |
| `assets/js/docs.js` | Letterhead, document meta, signature blocks |
| `assets/js/barcode.js` | Code 128 SVG barcodes |
| `tools/hospital-data.mjs` | Seed data: catalogue, kits, packages, visits, messages, referral doctors |
| `tests/lab.tests.js`, `tests/README.md` | 116 automated lab tests run in the browser (§33.1) |
| `data/lab-visits.json`, `service-orders.json`, `hospital-services.json`, `lab-kits.json`, `lab-kit-movements.json`, `referral-doctors.json`, `messages.json`, `hospital-settings.json` | Demo data |

---

## 37. Lab Test Master (managing the test list)

### 37.1 What it is and why
The **Lab Test Master** is the single, hospital-wide list of every lab test the hospital offers. It is the **only source** of lab tests for every other screen:

| Who reads it | What they get from it |
|---|---|
| Reception — Hospital Bill (`#/hbill`) | The test catalogue (only tests marked *Offered*), name, code, **price**, sample and "ready in" hours; the Rx-required and consent rules used by bill validation (§9.2) |
| Lab — Workbench, SID page, labels | Tube / container (tube grouping §11.4), test code on the label, the **result rows** (parameters), units, normal and critical ranges, flags (§13.2) |
| Lab report | Investigation rows, reference ranges, **method** and **note** printed under the test |
| Ward lab order, packages, service counter | List of tests that may be ordered (*Offered* only) |
| Reagent kit reconciliation (§16.4) | Kits consumed per test |
| Management / referral statistics | Test value (price) |

There is exactly one record per test (`services` collection, `category = LAB`). Because every screen reads the same record, **a change made by the Admin is seen at reception and in the lab the moment it is saved** — there is no second price list to keep in sync. (Hospital Setup → *Services & prices* no longer lists lab tests; Hospital Setup → *Lab tests* links to the master.)

### 37.2 Who can do what
| Action | Super Admin | **Admin** (new role) | Reception | Lab | MRD | Others |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Open the master, search, filter, export CSV (`labtest.view`) | ✅ | ✅ | ✅ (read only) | ✅ (read only) | ✅ (read only) | — |
| Add a test, edit any field, stop / restart a test (`labtest.manage`) | ✅ | ✅ | — | — | — | — |

- **Admin role** (`ADMIN`, demo login `admin` / `demo123`, *Hospital Administrator*): keeps the Lab Test Master, sees lab reports, bills and packages (read only), reagent kits and the audit log. **No billing, no cash, no result entry.**
- The rule is enforced in the business logic (`saveLabTest`, `setLabTestActive` refuse with *"Only Admin or Super Admin can change the lab test master."*), not only by hiding buttons. **[PROD]** the API enforces `labtest.manage` on every write endpoint.
- Read-only users see the same screens with every field disabled and a grey note: *"Only the Admin or Super Admin can change it."*

### 37.3 Fields of a lab test
| Field | Required | Rules | Used by |
|---|:-:|---|---|
| Test name | ✅ | Unique among lab tests (case-insensitive) | Everywhere |
| Short code | ✅ | 2–12 characters A–Z, 0–9 or "-", upper-case, no spaces, **unique across all services** | Tube labels, chips, CSV |
| Department | ✅ | Pick from the list or type a new one (Haematology, Biochemistry, Clinical Pathology, Immunoassay, Serology, Microbiology, Histopathology…) | Report heading, filters |
| Price (₹) | ✅ | ≥ 0. GST-exempt (healthcare service) | Reception billing |
| Report ready in (hours) | ✅ | 1–720 | Report due date on the receipt, TAT tracking (§17) |
| Sample type | ✅ | Blood (EDTA / Plain / Fluoride), Urine (random / 24 h), Stool, Sputum, Swab | Collection screen, label |
| Tube / container | ✅ | One of the configured containers (EDTA, PLAIN, FLUORIDE, URINE); set automatically from the sample type, can be overridden | Tube grouping per SID |
| Method | – | Free text, e.g. *5-part haematology analyser*, *Rapid card* | Printed on the report |
| Note under the result | – | Free text, e.g. *Fasting sample of 10–12 hours preferred* | Printed under the test on the report |
| Prescription needed | – | Yes / No | Blocks a **self request** (§9.2) |
| Signed consent needed | – | Yes / No | Reception must confirm consent (§9.2) |
| Result rows (parameters) | ✅ ≥ 1 | See §37.4 | Result entry, flags, report |
| Reagent kits per test | – | Kit + quantity > 0, no kit twice | Kit consumption and reconciliation (§16) |
| Status | – | *Offered* / *Stopped* | Billing, ordering |
| Version, created / updated by & at, history | auto | See §37.6 | Audit, history panel |

### 37.4 Result rows (parameters)
Each test has one or more rows; the order on screen is the order on the report (rows can be moved up and down).

| Type | Fields | Validation | Flag logic |
|---|---|---|---|
| **Number** | Name, unit, normal low, normal high, critical low (optional), critical high (optional) | Low and high both required; low ≤ high; critical low **below** normal low; critical high **above** normal high; names unique within the test | L / H / LL / HH exactly as §13.2 |
| **Text** | Name, unit (optional), expected normal result (e.g. *Negative*, *Nil*, *Non-reactive*) | Expected result required | Anything different from the expected result is flagged `A` (*) |

The editor shows a **live report preview** (how the rows will print) and the reception line (*price · ready in · tube*) while typing.

### 37.5 Screens
**S15 — Test list `#/lab/tests`**
- Search box (name or code); filters *Offered / Stopped / All* with counts; department chips.
- Table: test name and code (with version and last change date), department, sample with a drawn tube cap, the first three result rows, ready-in hours, rules (Rx / Consent pills), price, status. Stopped tests are greyed out.
- *Export* → CSV of the full master (code, name, department, sample, tube, TAT, price, rules, parameters with ranges, status, version).
- *Add test* (editors only). Click a row to open the editor.

**S16 — Test editor `#/lab/tests/new` and `#/lab/tests/{id}`**
- Cards: *Test details*, *What the report shows* (parameter grid), *Reagent kits used per test*.
- Sticky bar at the bottom: live validation message (first problem and how many more, or *Ready to save*), **reason for change** (existing tests), Cancel, Save.
- Side panel: *Report preview*; *Usage* (done in the last 30 days, all time, in progress now, packages that include it) with *Stop offering this test* / *Offer this test again*; *Change history* (every version with reason, the exact changes, user and time).
- Leaving the page with unsaved edits asks for confirmation.

### 37.6 Saving rules (business logic `assets/js/labmaster.js`)
| # | Rule |
|---|---|
| TM-1 | Only `labtest.manage` (Admin, Super Admin) can create, edit, stop or restart a test. |
| TM-2 | All validations in §37.3 – §37.4 must pass; the first problem is shown in plain language and the save is refused. |
| TM-3 | Editing an existing test requires a **reason** (kept in the history and the audit log). Saving with no actual change is refused (*"Nothing was changed."*). |
| TM-4 | A **price change** asks for confirmation showing the old and new price. Bills already made keep their own line price; only new bills use the new price. |
| TM-5 | **Past reports never change.** Before a test's format is saved, every order of that test that already has results gets a frozen copy of the format it was reported with (`order.lab.params`). Result entry also freezes the format at the moment results are typed. Reports and SID pages always read the frozen copy first. |
| TM-6 | Every save increments `version` and appends a history entry `{version, at, by, reason, changes[]}`; `changes` is a human-readable diff (e.g. *Price ₹: 350 → 380*, *Haemoglobin: 12–17 g/dL → 12.5–17 g/dL*, *Parameter added: …*, *Kits: … → …*). |
| TM-7 | **No hard delete.** A test is *stopped* (inactive) with a reason. A stopped test disappears from the billing catalogue, ward orders, the packages picker and the service counter; tests already billed or in progress are still collected, resulted and reported. |
| TM-8 | A bill draft containing a test that was stopped meanwhile is refused at completion (*"… has been stopped in the master list. Remove it from the bill."*). A ward order for a stopped test is refused. |
| TM-9 | Stopping a test that is part of a package warns the user (package patients need a replacement). |
| TM-10 | A new test, a price change, a stop and a restart each **notify** Reception, Lab, Admin and Super Admin. Every save writes an audit row. |
| TM-11 | Changing the code does not break history: orders reference the test by its internal id, not its code. |

### 37.7 Notifications and audit
| Event | Notification (to Reception, Lab, Admin, Super Admin) | Audit action |
|---|---|---|
| Test added | *New lab test — {name}* · code, price, sample | `LAB_TEST_CREATED` |
| Test edited | Only when the price changed: *Lab price changed — {name}* · old → new price | `LAB_TEST_UPDATED` (version, all changes, reason) |
| Test stopped | *Lab test stopped — {name}* · reason (warning) | `LAB_TEST_DEACTIVATED` |
| Test restarted | *Lab test available again — {name}* · reason | `LAB_TEST_ACTIVATED` |

### 37.8 Data model additions
Lab rows in `services` gain: `version`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `history[]`, `lab.method`, `lab.note`.
`orders.lab` gains `params[]` — the frozen report format.

**[PROD] MySQL**
```sql
ALTER TABLE lab_test ADD COLUMN version INT NOT NULL DEFAULT 1,
  ADD COLUMN method VARCHAR(120) NULL, ADD COLUMN report_note VARCHAR(255) NULL,
  ADD COLUMN created_by BIGINT NULL, ADD COLUMN updated_by BIGINT NULL,
  ADD COLUMN updated_at DATETIME(3) NULL;

CREATE TABLE lab_test_version (            -- one row per saved version (history)
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  lab_test_id   BIGINT NOT NULL REFERENCES lab_test(id),
  version       INT NOT NULL,
  snapshot_json JSON NOT NULL,             -- the full test incl. parameters and kits at this version
  changes_json  JSON NOT NULL,             -- human-readable diff lines
  reason        VARCHAR(255) NOT NULL,
  changed_by    BIGINT NOT NULL REFERENCES app_user(id),
  changed_at    DATETIME(3) NOT NULL,
  UNIQUE (lab_test_id, version)
);
-- each order keeps the version it was reported with (instead of a copied params array)
ALTER TABLE lab_order ADD COLUMN lab_test_version INT NULL;
```
Production should store `lab_test_version` on each order when results are entered and render the report from `lab_test_version.snapshot_json`.

### 37.9 API **[PROD]**
| Method & path | Permission | Notes |
|---|---|---|
| `GET /api/lab/tests?status=&dept=&q=` | `labtest.view` | List; `status` = active, inactive or all |
| `GET /api/lab/tests/{id}` | `labtest.view` | Test with parameters, kits, usage |
| `GET /api/lab/tests/{id}/versions` | `labtest.view` | History |
| `POST /api/lab/tests` | `labtest.manage` | Create (validation §37.3–37.4) → `201` |
| `PUT /api/lab/tests/{id}` | `labtest.manage` | Body includes `reason` and `expectedVersion`; `409 Conflict` if someone else saved first (optimistic locking) |
| `POST /api/lab/tests/{id}/deactivate` and `/activate` | `labtest.manage` | Body `{reason}` |
| `GET /api/lab/tests/export.csv` | `labtest.view` | CSV |

The billing catalogue endpoint returns only active tests; the server re-checks `active` and the current price when a bill is saved (it never trusts a price sent by the browser).

### 37.10 Acceptance tests
| # | Scenario | Steps | Expected |
|---|---|---|---|
| T29 | Admin adds a test | `admin` → Test Master → Add test → *Serum Calcium*, CALCIUM, Biochemistry, ₹300, 6 h, Plain; row Calcium 8.5–10.5 mg/dL (critical 6 / 13); a kit → Save | Saved as version 1; reception and lab notified; audit `LAB_TEST_CREATED` |
| T30 | Reflected at reception | `reception` → Hospital Bill → Lab | *Serum Calcium · CALCIUM · Blood (Plain) · 6 h · ₹300* is listed |
| T31 | Validation | Code CBC; normal low above high; critical low not below normal low; no result row | Each refused with its own message |
| T32 | Price and range change | Edit CBC: ₹350 → ₹380 and Hb low 12 → 12.5, first without a reason, then with one | First refused (reason); then price confirmation; version 2; history shows both changes |
| T33 | Old reports unchanged | Open a CBC report verified before T32 | Still shows Hb 12–17; new results use 12.5–17 |
| T34 | Stop a test | Stop WIDAL with a reason | Gone from billing and ward orders; WIDAL tests in progress still finish; notification and audit row |
| T35 | Permissions | `reception` / `lab` open the Test Master; try `#/lab/tests/new` | List and editor are read only; *new* goes back to the list; the logic refuses writes |
| T36 | Super Admin | `owner` edits a test | Allowed, same rules as Admin |


## 38. Compliance controls (F1–F6)

The six must-fix items from the compliance review ([LAB_COMPLIANCE_AUDIT.md](LAB_COMPLIANCE_AUDIT.md) §4) are built in the demo. This section is the full rule book for them; §13–§15, §21 and §28 point here.

**In plain words.** A lab report is a legal medical document. It must say who is responsible for it (F1). Nobody may quietly change a result: every correction keeps the old value and the reason (F2). Once a report has gone out, it is fixed only by an *amended* report, and the old one stays on record (F3). Some tests, such as HIV, are private by law (F4). Some diseases, such as TB and dengue, must be reported to the government (F5). A dangerous (critical) value must be phoned to the doctor before the report is released, and the normal range must suit the patient's age, sex and pregnancy (F6).

### 38.1 F1 — Who signs the report

| Rule | Detail |
|---|---|
| Signatory | A user is an **authorised signatory** when User Management has *Lab signatory* ticked, plus a **qualification** (e.g. *MBBS, MD (Pathology)*) and a **registration no.** (e.g. *TNMC 61234*). The box cannot be ticked without both. |
| Signature image | Optional PNG/JPG/SVG ≤ 300 KB, uploaded in User Management, printed above the signer's name. *Remove* clears it. |
| Who may verify / amend | Setting **Only authorised signatories can verify and amend** (`hs.lab.signatoryOnly`, default **on**). On: needs `lab.verify` **and** `user.signatory`. Off: `lab.verify` alone, as before. A non-signatory sees "n tests waiting — only an authorised signatory (doctor) can verify" instead of the Verify button. |
| Second person | `requireSecondPersonVerification` now defaults to **on**: the person who entered the results cannot verify them. |
| On the report | Letterhead line **Clinical Establishment Reg. No.** (`hs.lab.establishmentRegNo`); **Received** time next to Collected / Reported; signature block: *Tested by* (technician name + qualification) and *Verified & signed* (signature image, name, qualification, Reg. No.). |
| Page numbers | Printed copies carry "Page x of y" (CSS `@page labrep`). |
| Confirm dialog | Verify says "It is signed as Dr. … — MBBS, MD (Pathology), Reg. No. TNMC 61234". |

**Verification hand-off (technician → doctor).** One rule, `verifyBlock(order, user)` in `hospital.js`, decides whether a user can verify a test; the service and every screen use it, so a Verify button is never shown that would then fail.

| `verifyBlock` code | Meaning | What the screens show |
|---|---|---|
| *(none)* | This user can sign | **Verify** (worklist row, patient screen, home) |
| `CALL_NEEDED` | Critical value, no *Informed + read back* call yet | **Log call** for lab staff and doctors; Verify stays blocked |
| `NOT_SIGNATORY` | User is not an authorised signatory | Worklist row: **With Dr. …** (no button); patient screen: "n tests waiting for Dr. … to verify — sent to their alerts"; home tile **With the doctor** |
| `OWN_ENTRY` | User entered these results (second-person check) | "Another doctor to sign" |
| `NOT_ENTERED` | Results not entered | — |

Workflow:
1. Technician saves the results → each signatory (except the person who entered them) gets a bell notification **"Results to verify — <patient>"** (`LAB_TO_SIGN`, one open notice per visit and doctor; opens the patient screen).
2. If a value is critical, the technician phones the treating doctor and logs the call (read back).
3. The signatory opens **Lab Worklist → To verify** (critical first) or the notification, checks the values and clicks **Verify & release**.
4. When no test of the visit is left waiting, the notification closes (`DONE`) and the report moves to **Ready to send**.

For a non-signatory the *To verify* tab is labelled as the **doctor's queue** ("Dr. … verifies. Your part: log the call for critical values."); patients waiting only for the doctor drop to the bottom of the home *Next patients* list.

Demo users: **owner** (Dr. Meenakshi Sundaram, *Director & Consultant Pathologist*, signatory with a sample signature) signs; **lab** (Vignesh Raj, DMLT) enters results but cannot verify.

### 38.2 F2 — Result corrections keep history

- Saving results again on a test that already has results compares old and new values. Unchanged → nothing happens.
- Any changed value needs a **reason** (dialog). Without one the save is refused: "give the reason for correcting the result".
- Stored in `order.lab.history[]`: `{ at, by, kind: 'CORRECTED', reason, changes: [{ param, from, to }] }`. Audit `LAB_RESULTS_CORRECTED` lists every *old → new*. First entry is audited `LAB_RESULTS_ENTERED` **with the values**.
- The results table marks a corrected value with a small *changed* tag; hovering shows the history.
- SID page → drawer → **Changes** tab lists every correction and amendment with old / new values, who, when and why.

### 38.3 F3 — Amended reports

| Step | Rule |
|---|---|
| Who | Signatories only (`canSign`). Status must be **COMPLETED** (released). |
| How | SID page → **Amend** on the test → change the value(s) → *Save amendment* → a reason is required (e.g. "Wrong value typed — 4.8 entered instead of 1.8"). |
| Stored | `order.lab.amendments[]`: `{ no, at, by, reason, changes, prev: { results, signedBy, signedAt } }`; `lab.amendedAt / amendedBy`. `verifiedAt` and the report number stay the same, so TAT figures do not move. Audit `LAB_REPORT_AMENDED`. |
| Report | Title **LABORATORY REPORT — AMENDED**; the changed rows say *amended*; under the test: "Amended <date> by <name>. Reason: …. Changed: Platelet count 4.8 → 1.8. This report replaces the one released on …". |
| Old copy | Never deleted. *Changes* tab → **View the report as it was before** opens `#/lab/visit/{id}/report?asof=<time>` — the old values with a grey **SUPERSEDED — not valid for clinical use** watermark. Viewing it is audited. |
| Who has the old copy | Every delivery made **before** the amendment is listed on the SID page: "Send the corrected report again. These people have the old copy: …". Send counts only deliveries after the amendment. Ward (IP) reports are re-posted to the ward automatically (`WARD` delivery with `amended: n`) and the lab is notified. |
| Reprints | Every print is counted and audited (`LAB_REPORT_PRINTED`). From the second print the report says **DUPLICATE COPY — printed n times before**. |
| Critical | If the amended value is critical, the critical-call rule (F6) applies again after release, and the owner is alerted if no call is logged. |

### 38.4 F4 — Confidential tests (e.g. HIV)

**The choice is the hospital's.** Test Master → test → **Confidential result** switch. Ticked: the rules below apply. **Not ticked: the test is treated like any other test** — WhatsApp, timeline, any role can open it. The demo ticks it only for HIV.

| Where | Rule when the test is confidential |
|---|---|
| Billing | Tests with *Signed consent needed* show a **consent form**: *Counselled by* (name, required), *Pre-test counselling done*, *Signed consent form received*. The bill cannot be saved until all three are filled. Stored on the visit: `consent { at, by, counsellor, preTest, signed }`. |
| Who sees the result | Only lab roles (`lab.work` or `lab.verify`). Other roles see "Confidential test — the result is visible to lab staff only"; the report page shows a lock; the patient timeline shows "Lab report — confidential test" with no link. Each refusal is audited `LAB_REPORT_VIEW_REFUSED`. (The bill itself still lists the test — the person who billed it already knows.) |
| Sending | WhatsApp, SMS, email and *Send to doctor* are not offered (and refused in code). The action bar offers **Hand over in person**. |
| Hand-over | Dialog needs **Post-test counselling done** ticked; if someone other than the patient collects, **Written authorisation from the patient seen** must also be ticked. Stored in `handover { counselled, authorised }`, audited. |
| Every view | Every opening of a confidential report is audited `LAB_REPORT_VIEWED … — confidential` (other reports: once per user per 10 minutes). |

### 38.5 F5 — Notifiable diseases

- Test Master → **Notifiable disease**: *No* / *TB — notify on Ni-kshay* / *IDSP — notify to IHIP*. Demo: Sputum AFB = TB, Dengue NS1 = IDSP.
- When such a test is verified (or amended) with a **positive** result (any flag, i.e. not the expected *Negative / Not seen*), `order.lab.notification = { program, status: 'PENDING', at, dueAt }` is set, audited `NOTIFIABLE_POSITIVE`, and the lab and owner are notified.
- **Notification register** (`#/lab/notifiable`, menu *Laboratory → Notification Register*, badge = pending count): tabs *To report / Reported / All*, search, S.No table, **Mark reported** (portal ID required, note optional → `status: 'NOTIFIED', refNo, notifiedAt, notifiedBy`, audit `NOTIFIABLE_REPORTED`), **Export CSV**.
- Deadline: `hs.lab.notifyWithinHours` (default **24**). Past `dueAt` → red *Overdue* and the live alert **Notifiable Not Reported** (lab and owner). Lab home "Fix these first" shows *Notifiable disease to report*.
- **[PROD]** direct Ni-kshay / IHIP API upload when the hospital gets credentials; until then the lab enters the case on the portal by hand and records the ID here.

### 38.6 F6 — Critical call log and age / sex / pregnancy ranges

**Critical call (read-back).**
- Setting **A critical value must be phoned to the doctor and logged** (`hs.lab.criticalCallRequired`, default **on**).
- A test with any `LL` / `HH` value cannot be verified until there is a call with outcome **Informed** and **Read back** ticked, logged **after** the current critical values were entered.
- *Log call* dialog: spoke to (name), role (doctor / ward nurse / duty doctor), phone, outcome (*Informed / Not reachable / Left a message*), read-back tick (required for *Informed*), note. Stored in `order.lab.criticalCalls[]`, audit `LAB_CRITICAL_CALL`. Failed attempts are kept too.
- Correcting a **normal** value does not cancel the call; changing a **critical** value does (`lab.criticalSince`).
- The SID page shows a red box per test ("Not released — phone … and log the call") or an amber one after a failed try; the report prints "Critical value informed to … at … (read back)".
- No call after `hs.lab.criticalEscalateMins` (default **15**) → live alert **Critical Not Informed** (verifiers and owner); lab home shows *Critical value — doctor not informed*.

**Reference ranges by age, sex and pregnancy.**
- Test Master → each numeric result row → **+ Age / sex / pregnancy range**: name, sex (*Any / Male / Female*), age from / to (days, months or years), *Pregnant only*, low, high, critical low, critical high (blank = same as the default row).
- The **most specific** matching range is used (narrowest age span, then pregnancy, then exact sex). A patient matching none gets the default row. Overlapping ranges for the same patient group are refused on save.
- Age is counted **on the collection date** from the date of birth (or the age given).
- **Pregnancy**: for women aged 12–55 whose tests have a pregnancy range, billing asks *Is the patient pregnant? Yes / No / Not known* (`visit.pregnant`); the SID page can change it until the report is released (audit `LAB_PREGNANCY_SET`, ranges re-applied).
- The range used is frozen on the order at result entry. The SID page and the report print its name, e.g. *12 – 15 (Adult female)*, *11 – 14 (Pregnancy)*, *11 – 14 (Child 1–12 y)*.

### 38.7 Settings (Hospital Setup → Rules)

| Setting | Key (`hospitalSettings.lab`) | Default |
|---|---|---|
| Report verified by a different person | `requireSecondPersonVerification` | on |
| Only authorised signatories verify and amend | `signatoryOnly` | on |
| Critical value must be phoned and logged | `criticalCallRequired` | on |
| Alert owner if critical not informed after (min) | `criticalEscalateMins` | 15 |
| Report notifiable disease within (hours) | `notifyWithinHours` | 24 |
| Clinical Establishment registration no. | `establishmentRegNo` | sample value |

### 38.8 Data model additions

```
users[]           + qualification, regNo, signatory (bool), signature (data URL)
labTest.lab       + confidential (bool), notifiable ('TB' | 'IDSP' | null)
parameter         + ranges[]: { label, sex 'ANY'|'M'|'F', ageFromDays, ageToDays|null, pregnant true|null,
                                low, high, critLow, critHigh }
labVisit          + consent { at, by, counsellor, preTest, signed }, pregnant (true|false|null),
                    handover + { counselled, authorised }, deliveries[] + { amended: n }
order.lab         + history[]        { at, by, kind:'CORRECTED', reason, changes[] }
                  + amendments[]     { no, at, by, reason, changes[], prev { results, signedBy, signedAt } }
                  + amendedAt, amendedBy, criticalSince
                  + criticalCalls[]  { at, by, toName, toRole, phone, outcome, readBack, note, parameters[] }
                  + notification     { program, status 'PENDING'|'NOTIFIED', at, dueAt, refNo, note, notifiedAt, notifiedBy }
                  + params[] carry rangeLabel (the range used)
```

**[PROD] tables:** `lab_result_history`, `lab_report_amendment` (with the full previous result set as JSON), `lab_critical_call`, `lab_notification`, `lab_reference_range` (FK to parameter); columns on `users` and `lab_test`. All append-only except `lab_notification.status`.

### 38.9 Audit actions added

`LAB_RESULTS_CORRECTED`, `LAB_REPORT_AMENDED`, `LAB_CRITICAL_CALL`, `LAB_PREGNANCY_SET`, `LAB_REPORT_PRINTED` (original / copy n), `LAB_REPORT_VIEWED`, `LAB_REPORT_VIEW_REFUSED`, `NOTIFIABLE_POSITIVE`, `NOTIFIABLE_REPORTED`; `USER_UPDATED` now records signatory changes; `LAB_RESULTS_ENTERED` now includes the values.

### 38.10 Code

| File | What |
|---|---|
| `assets/js/labrules.js` (new) | Range matching (`pickBand`, `resolveParam`, `rangeCtx`, `bandProblems`), pregnancy helpers, `canSign`, `signatoryText`, `isConfidential`, `canSeeConfidential`, `notifiableOf`, `NOTIFIABLE` |
| `assets/js/hospital.js` | `enterResults` (reason + history), `verifyReport` (signatory + call check), `logCriticalCall`, `criticalCallOk`, `criticalSince`, `amendReport`, `markNotified`, per-patient `labParams` |
| `assets/js/labflow.js` | Consent form check, `visitConfidential`, `staleDeliveries`, `lastAmendAt`, `onReportAmended`, `setPregnant`, hand-over counselling / authorisation, no WhatsApp for confidential |
| `assets/js/labmaster.js`, `modules/lab/master.js` | Confidential switch, Notifiable select, range table per parameter, validation |
| `assets/js/modules/lab/sid.js` | Critical box and *Log call* dialog, reason dialog, Amend, *Changes* tab, pregnancy switch, confidential sending |
| `assets/js/modules/labdesk.js` | Report: AMENDED, superseded view, duplicate copy, Reg. No., signatures, ranges, view / print audit, confidential lock |
| `assets/js/modules/lab/notifiable.js` (new) | Notification register |
| `assets/js/modules/users.js` | Qualification, Reg. No., signatory, signature upload |
| `assets/js/modules/hbilling.js` | Consent form, pregnancy question |
| `assets/js/alert-rules.js`, `modules/home.js`, `app.js`, `router.js`, `modules/setup.js`, `patients.js` | Alerts, home items, menu + badge, route, settings, timeline |

### 38.11 Demo data (reset demo data to see it)

| Patient | What it shows |
|---|---|
| Harini Suresh (new, girl, 4 y) | CBC: Hb 11.6 is **normal** on the *Child 1–12 y* range (would be low for an adult woman) |
| Priyanka Ravi | Pregnant = Yes: Hb 11.3 normal on the *Pregnancy* range; TSH judged on the pregnancy range |
| Joseph Dominic | RFT potassium 6.9 (critical); first call *Not reachable* — Verify blocked until an *Informed + read back* call is logged |
| Geetha Venkat | Sputum AFB *Seen (1+)* — on the notification register, **To report** on Ni-kshay |
| Revathi Mohan | Dengue NS1 positive 4 days ago — **Reported** on IHIP with an ID |
| Prakash Natarajan | HIV non-reactive, consent with counsellor Sr. Jency Mary — confidential, hand over only |
| Lakshmi Devi | CBC **amended** (platelets 4.8 → 1.8) after it went on WhatsApp — old recipient listed, superseded copy viewable, duplicate print |

### 38.12 Acceptance tests

| # | Scenario | Expected |
|---|---|---|
| T43 | Sign in as **lab**, open a test waiting for verification | No Verify button: "only an authorised signatory (doctor) can verify" |
| T44 | As **owner**, verify Joseph Dominic's RFT | Refused until a call is logged; *Informed* without *Read back* refused; after a proper call, verify works and the report prints the call |
| T45 | Correct a normal value on a critical test | Reason asked; history kept; the earlier call still counts. Change the critical value → a new call is needed |
| T46 | Amend Lakshmi Devi's CBC again | Reason required; amendment no. 2 is listed in *Changes*; *View the report as it was before* shows the superseded watermark |
| T47 | Sign in as **reception**, open Prakash Natarajan's report | Lock page; patient file shows "confidential test"; audit `LAB_REPORT_VIEW_REFUSED` |
| T48 | Test Master → HIV → untick *Confidential result* → save | HIV report can now be sent on WhatsApp and seen like any other test |
| T49 | Notification register → Geetha Venkat → Mark reported without an ID | Refused; with an ID → moves to *Reported*, badge drops, CSV has the row |
| T50 | Test Master → CBC → add an overlapping *Adult female* range | Save refused with the overlap message |
| T51 | Bill CBC for a woman of 25 | "Is the patient pregnant?" appears; *Yes* → report shows *(Pregnancy)* range |
| T52 | Bill HIV without the consent form filled | Bill refused with the consent message |
| T53 | As **lab**, open Lab Worklist → To verify | Rows show *With Dr. Meenakshi Sundaram* (no Verify button); the critical one shows *Log call*; note "Doctor's queue" above the table |
| T54 | As **lab**, save results for a patient | Owner's bell: "Results to verify — <patient>"; after the owner verifies all tests of that SID the notice closes |

---

## 39. OP and IP modules → lab (one pipeline)

Before this link only two screens fed the lab: the **Hospital Bill** and the **Ward Lab Order** (for Medical Records admissions). A test billed on the OP module's bill or charged on the IP module's folio was charged but never reached the lab. Now **every place a lab test is billed or charged creates the lab order**, whichever screen or login was used.

### 39.1 Where lab orders come from

| Entry point | Who | Lab visit | Payment gate |
|---|---|---|---|
| Hospital Bill (reception counter) | Reception, owner | SID + OPD token | Hospital Bill paid / credit approved / emergency |
| **OP bill** — services added at the billing desk, or tests the doctor orders in the consultation (module 02) | Reception, billing, owner | SID + OPD token, source OP, `billingRoute = OP_BILL` | **OP bill paid** — until then *Payment pending (OP bill)* and the sample cannot be collected |
| **IP folio → Post charge** with a lab test (module 03) | Nurse, billing, owner | SID, bedside collection, ward + bed from the current bed | None — charged to the IP bill |
| **Ward Lab Order** — patient admitted in the IP module | Nurse, doctor, lab, owner | SID, bedside collection | None — each test posted to the IP bill |
| Ward Lab Order — Medical Records admission only | as above | as above | IP account (`ipCharge.posted = false`, as before) |

### 39.2 Rules

- **LR-30 Link.** A tariff row (`service-tariff.json`) is a lab test when it has `labServiceId` → `hospital-services.json`. Saving a tariff row of category *Investigation* whose code matches a lab test links it automatically. X-ray, ECG and ultrasound are not lab tests and stay unlinked.
- **LR-31 One price.** A linked row always uses the **Lab Test Master price** (and is unavailable when the lab test is stopped). The rate box in *Doctors, Beds & Tariff* is read-only for these rows and shows *Lab price*. Bills already made keep their own rate.
- **LR-32 OP gate.** OP-billed tests are `ON_HOLD` until the OP bill is `PAID`, then `READY`. A discount waiting for approval keeps them on hold. Cancelling the visit or refunding the bill cancels the tests that were not collected yet.
- **LR-33 IP charge.** Each ward test is one IP charge (group *Investigations*, `source = LAB`, `refId` = order) at the lab price; the order keeps `ipCharge.chargeId`. Reversing the charge cancels the test **only before the sample is collected**; after that the charge stays.
- **LR-34 IP limits.** No lab order for a discharged patient or once the final IP bill is made (re-open the bill first).
- **LR-35 Who orders on the ward.** `lab.order.ip` is given to Doctor and Nurse (as well as Lab, Service counter and the owner); `ip.charge` also allows it.

### 39.3 Data added

| Where | Field | Meaning |
|---|---|---|
| tariff row | `labServiceId` | Lab test this row sells (null for non-lab services) |
| OP bill line | `labServiceId` | Copied from the tariff when billed |
| OP bill | `labVisitId` | Lab visit made from this bill |
| lab visit | `billingRoute = 'OP_BILL'`, `opBillId`, `opVisitId` | OP-billed visit and where it came from |
| lab visit | `admissionId` | IP admission (module 03) for ward orders |
| order | `opBillId` | OP bill that paid for the test |
| order | `ipCharge.chargeId` | IP charge that bills the test |
| IP charge | `source = 'LAB'`, `refId` | Charge made by a lab order |

Production schema: `lab_visits.billing_route` gets the value `OP_BILL` plus nullable `op_bill_id`, `op_visit_id`, `ip_admission_id`; `service_orders.op_bill_id`, `service_orders.ip_charge_id`; `tariff.lab_service_id` (FK, unique). One trigger / service method per entry point calls the same *create lab visit* routine.

### 39.4 Screens

- **IP folio** — a lab charge shows a tag *SID 0401xxxx · Ready* that opens the lab visit; posting a lab test says *Charge posted and sent to the lab — SID …*.
- **Lab visit** side panel — *Bill: OP bill OB-…* (opens the OP visit) or *Charges: IP bill IPA-…* (opens the folio).
- **Ward Lab Order** — lists the IP module's admitted patients with ward and bed first, then Medical Records admissions not already listed.
- **Lab home** counts critical results from every lab visit (ward and OP orders were missed before).

### 39.5 New tests in the lab master

ESR, Random blood sugar (RBS), Serum electrolytes and Blood grouping & Rh were added to the Lab Test Master so that every investigation the doctors order in OP / IP has a lab test behind it (demo data version 13).

### 39.6 Code

`assets/js/labflow.js` — `createVisitForOpBill`, `syncOpBillLab`, `opBillAccess`, `insertWardVisit`, `labTestsFor` · `assets/js/op.js` — `sendToLab`, sync in `refreshBill` / cancel / refund · `assets/js/ip.js` — `orderLabTests`, lab branch in `postCharge` / `reverseCharge` · `assets/js/clinical.js` — `labTestOf`, lab price in `service` / `servicesFor` · seed link in `tools/generate-clinical.mjs`.

---

## 40. Change log

### v1.3 — 28 Nov 2026

**OP and IP modules connected to the lab (§39).** OP bills and IP charges with lab tests now create the lab order; the Ward Lab Order lists IP admissions and posts to the IP bill; one price from the Lab Test Master; ESR, RBS, electrolytes and blood group added; doctors and nurses can order ward tests; Help page no longer crashes for roles without a guide. Tests: 116 / 116 (§33.1).

### v1.2 — 28 Nov 2026

**Compliance controls F1–F6 built** (from [LAB_COMPLIANCE_AUDIT.md](LAB_COMPLIANCE_AUDIT.md); full rules in §38):
- **F1** authorised signatories (qualification, Reg. No., signature image) — only they verify and amend; Clinical Establishment Reg. No., received time and page numbers on the report; second-person verification on by default.
- **F2** every result correction needs a reason and keeps old → new in the history; *Changes* tab on the SID page.
- **F3** amended reports: AMENDED title, reason, old version kept and viewable (superseded watermark), earlier recipients listed for re-sending, ward re-posted, reprints marked *Duplicate copy*.
- **F4** confidential tests — a **per-test choice** in the Test Master (*Confidential result* switch; unticked = normal test). Consent form with counsellor at billing; results hidden from non-lab roles; hand-over in person only, with post-test counselling; every view audited.
- **F5** notifiable diseases (TB → Ni-kshay, IDSP → IHIP) per test; Notification register with deadline, overdue alert and CSV.
- **F6** critical call log with read-back blocks verification; owner alerted after 15 min; reference ranges by age, sex and pregnancy, with a pregnancy question at billing.
- New settings in Hospital Setup → Rules (§38.7); demo data for each rule (§38.11, demo data version 11); acceptance tests T43–T52.
- **Verify hand-off:** one rule `verifyBlock` for service and screens; technicians see *With Dr. …* / *Log call* instead of a Verify button that could not work; signatories are notified when results are saved (§38.1).
- **Automated tests:** `tests/lab.tests.js` — 100 tests, 100 passed (§33.1).
- **Production docs updated:** database schema §24 (ranges, amendments, critical calls, notification register, signatory, consent, pregnancy), API §25, roles §5.3, rules LR-23…29, notifications §20.
- Not done yet: unit conversion (SI units), direct Ni-kshay / IHIP upload, digital signature of the PDF.

### v1.1 — 27 Nov 2026

**Look of the lab screens.** The lab module now uses a plain hospital-software layout: square corners, navy + teal, Bootstrap Icons. The old split *Lab Workbench* is now the **Lab Worklist** — one table per step, one action button per row; clicking a row opens the patient screen (S3, S5). Lab Stock, Test Master, Report Desk and Ward order keep their layout with the same colours and corners.

**Change 1 — WhatsApp for ward (IP) lab orders.**
- Ward Lab Order has a tick box **"Also send the report to the patient's WhatsApp"**, showing the mobile number. It is ticked by default when the patient has a mobile and disabled when there is none.
- Stored as `labVisit.sendToPatient` (boolean, default `false`).
- At verification the report is posted to the ward as before. When `sendToPatient` is on and no WhatsApp has gone to the patient yet, the visit also appears in **Ready to send** (marked *Ward asked for WhatsApp*), and the action bar shows **Send on WhatsApp**. With the WhatsApp Cloud API on, it is sent automatically.
- Every ward report shows *Send a copy to the patient* (WhatsApp, SMS, email, print) on the patient screen; counter hand-over is not offered for ward patients.
- Code: `labflow.js` (`createIpOrder`, `onOrderVerified`, `wardWaPending`), `lab/stages.js` (send step), `labdesk.js` (ward order form), `lab/sid.js` (send card and action bar).

**Change 2 — Patient type shown in the Lab Worklist.**
- The worklist starts with three plain columns: **S.No**, **Type** and **Token / Bed**. No colours, icons or stripes per row; only the Priority column is coloured (STAT red, Urgent amber).

| Source | Type | Token / Bed |
|---|---|---|
| OP | OP | 7 (· called) |
| IP | IP | S-4 Surgical ward |
| EMERGENCY | CAS | Casualty |
| REFERRAL | REF | 7 |
| SELF | SELF | 8 |
| PACKAGE | PKG | 9 |

- Filter **Patient type** lists each type with its count on the current step (types with none are greyed out).
- The patient banner shows the type in words (e.g. *IP — admitted (ward)*).
- Code: `lab/ui.js` (`PTYPES`, `ptypeCode`, `ptypeCell`, `ptypeTag`), `lab/workbench.js`, `lab/sid.js`, `css/lab2.css`.

**Change 3 — Token screen shows only counter-token patients.**
- Shown: today's counter tokens (OP, outside doctor, self, package) with payment cleared and a tube still to collect.
- Never shown: ward (IP) orders, casualty, cancelled, unpaid, already collected.
- New **Also called** row (up to 3 earlier called tokens not yet collected). Rules in §11.1.
- Code: `labdesk.js` (`renderDisplay`), `css/hospital.css`.

**Change 4 — Token screen redesign and fixes.**
- Bugs fixed: with nobody called, *Now calling* showed a huge white bar (a giant dash) — now an hourglass and "Please wait — your token will be called here"; the heading and clock wrapped onto two lines on smaller screens; all sizes were fixed pixels (did not fit a TV or a small monitor); the clock moved only every 15 s; a long queue was silently cut at 8 tokens.
- New layout: two halves (Now calling · Next in line), sizes scale with the screen, priority tokens marked, **+N more**, Full screen button / **F** key, the called token flashes when it changes.
- Code: `labdesk.js` (`renderDisplay`), `css/hospital.css` (`.tb2-*`).

**Change 5 — Demo data: one waiting patient for every way into the lab.** `tools/hospital-data.mjs` (regenerate with `node tools/generate-data.mjs`) now puts these in **To collect** today:

| SID (demo) | Way in | What it shows |
|---|---|---|
| 04010062 | IP ward order, STAT | Bed S-4 · Surgical ward, bedside collection |
| 04010068 | Casualty (emergency credit), STAT | No token, collected in casualty |
| 04010064 | OP — hospital doctor, STAT | Token 10, already **called** (Now calling on the token screen) |
| 04010069 | IP ward order, Urgent | Bed G-3 · General ward, **WhatsApp copy to the patient** ticked |
| 04010065 | Outside doctor prescription, Urgent | Token 11, 2 tubes (serum + urine), prescription on file |
| 04010059 | Outside doctor | Token 7, sample **rejected — recollect** |
| 04010060 / 04010066 | Self request | Tokens 8 and 12 |
| 04010063 | OP — hospital doctor | Token 9, routine |
| 04010067 | Health package (Diabetes Check-up) | Token 13, 4 tubes, paid through the package |
| 04010070 | OP — hospital doctor | Token 14, **partly collected** (EDTA done, fluoride pending — also in To receive) |
| (bill HB-…) | Credit waiting for the owner | Shown as *1 waiting for payment*, not collectable |

**Acceptance tests**

| # | Scenario | Steps | Expected |
|---|---|---|---|
| T37 | Ward report to WhatsApp | Ward Lab Order → admitted patient with a mobile → tick stays on → FBS → Send to lab; collect, receive, enter, verify | Report posted to the ward **and** listed in Ready to send with *Send on WhatsApp*; after sending it leaves the list |
| T38 | Ward report without WhatsApp | Same, tick box off | Report posted to the ward only; not in Ready to send; WhatsApp still possible from the patient screen |
| T39 | Patient type in the worklist | Open To collect with an OP, a ward and an outside-doctor patient | Blue / purple / amber icon and stripe with token or bed; *Patient type* filter shows only the chosen type |
| T40 | Token screen | Place a ward order and bill an OP test; call the OP token | Token screen shows the OP token only; the ward patient never appears; the token drops off once all its tubes are collected |
| T41 | Token screen, nobody called | Fresh day, tokens billed, none called | Hourglass and "Please wait" — no empty bar; Next in line shows the tokens with the count |
| T42 | Demo To collect | Reset demo data → Lab Worklist → To collect | 11 patients: ward ×2, casualty, OP ×3 (one called, one partly collected), outside doctor ×2 (one recollect), self ×2, package |

---

*End of specification. Any change to the lab flow must update this document and the demo together so the demo remains the living reference for the production build.*
