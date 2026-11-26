# Nallam Hospital HMS — Lab Module Compliance & Audit Review

**Scope:** BRD Module 06 Laboratory, as built in the demo (branch `feature_d`)
**Date:** 2026-11-27 · **Version:** 0.1 · **Status:** Review. No code was changed by this review.
**Read with:** [LAB_MODULE_SPECIFICATION.md](LAB_MODULE_SPECIFICATION.md), [LAB_PHASE2_SPECIFICATION.md](LAB_PHASE2_SPECIFICATION.md)

> **Not legal advice.** This review lists the Indian laws and standards that touch a hospital lab, and checks what the software must do for each. The hospital must confirm the final position with its legal adviser, the Tamil Nadu Clinical Establishments authority and (if it applies for accreditation) NABL. Where a source could not be fully confirmed, the table says **"confirm"**.

---

## 1. Summary

| Question | Answer |
|---|---|
| Is the lab flow complete? | Yes, for phase 1. |
| Is it legally ready for real patients? | **Not yet.** 6 items are **must fix before go-live** (§4.1). Most are small. |
| Is the audit trail good? | **Good for a demo, not enough for production.** Every key action is logged with who and when, but old → new values, report views and tamper-proofing are missing (§5). |

---

## 2. The rules that apply, in plain words

| # | Law / standard | Mandatory? | What it means for the lab software |
|---|---|---|---|
| L1 | **Tamil Nadu Clinical Establishments (Regulation) Act 1997** (amended 2018, 2019, 2021) + **TN Rules 2018** | **Yes** — every clinical establishment in TN must be registered | Lab tests (except simple urine albumin / sugar / Hb) must be done by a qualified lab technician (at least DMLT). The software should record staff qualifications and show the registration number on reports. |
| L2 | **Clinical Establishments Act 2010** (central) — minimum standards for labs | Applies where the state adopted it; TN has its own Act (L1), but the central minimum standards are the usual reference | Reports should be signed by a registered medical doctor. A pathologist (MD) should sign pathology reports, a microbiologist microbiology reports. A 2025 proposal asks for the signer's **full name, signature and registration number** on the report — *confirm if notified*. |
| L3 | **NMC / MCI Code of Medical Ethics Regulations 2002** | **Yes** for doctors | Medical records of in-patients kept at least **3 years**; copies given to the patient within **72 hours** of a request. No payment for referrals (affects P2-11). |
| L4 | **HIV and AIDS (Prevention and Control) Act 2017** + NACO guidelines | **Yes** | HIV test only with **informed consent** and counselling; the HIV status **must not be disclosed** without consent (narrow legal exceptions); data must be kept confidential and access restricted. |
| L5 | **TB notification** (MoHFW gazette, March 2018) | **Yes** — labs are named; non-notification is punishable (IPC 269/270, now the corresponding BNS sections) | Every TB diagnosis (e.g. positive AFB smear, CBNAAT / TrueNat) must be **notified to Ni-kshay**. Other notifiable diseases (dengue, malaria, cholera…) go to the state / IHIP. |
| L6 | **Digital Personal Data Protection Act 2023 + DPDP Rules 2025** (notified 13 Nov 2025; most duties start **18 months later, about May 2027**) | **Yes**, phased | Clear privacy notice and consent for each purpose (e.g. WhatsApp reports); reasonable security safeguards; access logs; **breach → inform patients and the Data Protection Board without delay, detailed report within 72 hours**; patients can ask for access / correction; delete when the purpose ends (but legal retention rules win). |
| L7 | **IT Act 2000 §43A + SPDI Rules 2011** | **Yes** until DPDP fully replaces it | Medical records are "sensitive personal data": reasonable security practices (ISO 27001-style), written consent for collection, no disclosure without consent. |
| L8 | **MoHFW EHR Standards 2016** | Recommended (expected for ABDM / government links) | Role-based access; **audit trail of every action including viewing** (ISO 27789); data once saved is not altered — changes are kept as a trail; SHA-256 hashing for integrity. |
| L9 | **NABL accreditation — ISO 15189:2022 + NABL 112** | **Voluntary**, but expected for a quality hospital lab and by insurers / NABH | Sample traceability, rejection criteria, QC with records, equipment calibration records, staff competence records, **critical value communication record**, **amended reports clearly marked with the reason and the original kept**, defined report content, record retention policy, complaint handling. |
| L10 | **NABH (hospital accreditation)** | Voluntary | Lab must meet the same as L9 at a basic level; critical results and turnaround time monitored as quality indicators. |
| L11 | **Bio-Medical Waste Management Rules 2016** (amended 2018, 2019) | **Yes** | Lab is a waste generator: segregation by colour category, barcoded bags handed to the CBWTF, **records of waste generated and handed over**, annual report to the pollution control board. Usually kept outside the LIS, but the software can hold the register. |
| L12 | **PC-PNDT Act 1994** | Only if prenatal genetic tests are done | Never record or reveal the sex of a foetus. Not relevant to the current test list — keep it that way. |
| L13 | **Consumer Protection Act 2019** | Yes | A wrong report is a "deficiency in service". The audit trail is the hospital's evidence — this is why §5 matters. |
| L14 | **GST law** | Yes | Healthcare services are exempt, but the bill must still be a proper document with a serial number (already done in billing). |

---

## 3. Check against the demo

Legend: ✅ met · ⚠️ partly · ❌ missing · **Must** = before real patients · **Should** = soon / for NABL · **PROD** = only possible with the real backend

### 3.1 Patient identity, orders and samples
| Requirement | Source | Status | What the demo does / what is missing | Priority |
|---|---|---|---|---|
| Two identifiers on every sample and report | L9 | ✅ | Name + Patient ID + SID on labels and the report | — |
| Order basis recorded (doctor order, outside prescription, self) | L2, L9 | ✅ | `rxBasis`, prescription upload, referral doctor | — |
| Who collected / received, and when | L9 | ✅ | Per tube: `collectedBy/At`, `receivedBy/At` | — |
| Sample rejection with reason, recollection | L9 | ✅ | Reject reasons, recollect flow, audited | — |
| Received time on the report | L9 | ❌ | Report shows *Collected* and *Reported*, not *Received* | Should |
| Lot of reagent used for a result (traceability) | L9 | ⚠️ | Stock is tracked by lot (FEFO) but a result is not linked to the lot used | Should |

### 3.2 Results, verification and the report
| Requirement | Source | Status | What the demo does / what is missing | Priority |
|---|---|---|---|---|
| Report signed by a qualified doctor, with **qualification and registration number** | L2 | ❌ | *Verified by* prints the user's name only. No qualification, council registration no or signature image. Any user with `lab.verify` can verify, with no check that they are a doctor. | **Must** |
| Lab technician qualified (DMLT+) | L1 | ⚠️ | Users have no qualification field | Should |
| Age / sex / pregnancy reference ranges | L9 | ❌ | One range per parameter → wrong flags for children and pregnancy (phase 2 P2-01) | **Must** |
| Critical value phoned and logged before release | L9, L10 | ⚠️ | Alert only; no call log (phase 2 P2-02) | **Must** |
| Result corrections keep the old value | L8, L9, L13 | ❌ | Re-entering results **overwrites** the old values; the audit only says "results entered" | **Must** |
| Amended report after release (marked *Amended*, reason, original kept, recipients informed) | L9, L13 | ❌ | A completed (verified) order cannot be changed at all, so a wrong released report cannot be corrected inside the system | **Must** |
| Second-person verification | L9 (good practice) | ⚠️ | Setting exists (`requireSecondPersonVerification`) but is **off** by default | Should — switch on |
| Report format frozen (later master edits don't change old reports) | L9 | ✅ | Parameters copied into the order at entry; Test Master versioned | — |
| Partial report clearly marked | L9 | ✅ | "LABORATORY REPORT (PARTIAL)" + pending list | — |
| Report shows lab name, address, registration no, page x of y, reprint marking | L1, L9 | ⚠️ | Letterhead yes; no establishment registration no, no page numbers, reprints look identical to the original (`printCount` is stored but not printed) | Should |
| QC records, block release on failed QC | L9 | ❌ | Only QC material stock (phase 2 P2-04) | Should (Must for NABL) |
| Equipment calibration / maintenance log | L9 | ❌ | Not built | Should (NABL) |

### 3.3 Confidentiality, consent and disclosure
| Requirement | Source | Status | What the demo does / what is missing | Priority |
|---|---|---|---|---|
| HIV: informed consent + counselling recorded | L4 | ⚠️ | A tick box "signed consent taken" with time and user; no counsellor name, no pre/post-test counselling record | **Must** |
| HIV: result not sent by WhatsApp / SMS, not visible to all roles | L4 | ❌ | Consent tests are delivered like any other test (WhatsApp, SMS, email, referral doctor copy) and show on the patient timeline | **Must** |
| Notifiable diseases (TB → Ni-kshay, others → IHIP) | L5 | ❌ | No notifiable flag on tests, no notification register | **Must** |
| Consent / notice before sending reports on WhatsApp | L6, L7 | ❌ | Reports are sent to the number on file with no recorded consent for messaging | Should now, **Must by May 2027** |
| Patient copy of records within 72 h | L3 | ✅ | Report desk, print, WhatsApp | — |
| Role-based access | L7, L8 | ✅ | Permission codes checked in the logic files, access matrix in User Management | — |
| Copy to outside referral doctor only with consent | L6, L7 | ⚠️ | Sending to the referring doctor is a staff choice; no patient consent stored | Should |

### 3.4 Security and records
| Requirement | Source | Status | What the demo does / what is missing | Priority |
|---|---|---|---|---|
| Passwords stored hashed, lockout after failed tries | L6, L7 | ❌ | Demo stores plain passwords and has no lockout (fine for a demo) | **PROD** |
| Automatic sign-out after idle time at shared counters | L7, L8 | ❌ | Sessions stay open | Should (easy in demo) |
| Record retention policy, nothing deleted | L3, L9 | ⚠️ | Nothing is ever deleted (good); no written retention period or archiving rule | Should — hospital to decide |
| Breach response procedure | L6 | ❌ | Process, not software — needs a written SOP + a way to export who accessed what | PROD + SOP |
| Biomedical waste register | L11 | ❌ | Not in the software (often kept on paper / CBWTF portal) | Optional |

---

## 4. What to fix, in order

### 4.1 Must fix before real patients (all can be built in the demo on JSON)
| # | Fix | Size |
|---|---|---|
| F1 | **Signatory details**: add `qualification`, `councilRegNo`, `signatory: true`, signature image to users; only signatories can verify; report prints name, qualification, reg no and signature | S |
| F2 | **Result history**: keep every previous value (`results[].history[]` with old value, new value, who, when, reason); correction after first entry needs a reason; audit stores old → new | S |
| F3 | **Amended report**: Super Admin / signatory can *amend* a released report with a reason → new version, printed "AMENDED REPORT — replaces report LR-… of <date>. Reason: …", the original stays viewable, and everyone it was sent to is listed for re-sending | M |
| F4 | **HIV / confidential tests**: test flag `confidential: true`; consent record with counsellor name and pre-/post-test counselling; delivery only by hand at the counter (no WhatsApp / SMS / email / referral copy); hidden from the patient timeline for roles other than lab and the treating doctor; every view audited | M |
| F5 | **Notifiable diseases**: test flag `notifiable: 'TB' | 'IDSP'`; a positive verified result creates an entry in a **Notification register** (patient, test, result, date) with "Notified on Ni-kshay / IHIP — ID ___ — by ___" and an overdue alert after 24 h | S |
| F6 | **P2-01 ranges + P2-02 critical call log** (already designed in the phase 2 spec) | S + S |

### 4.2 Should do (quality / NABL / DPDP)
Second-person verification on by default; received time, establishment reg no, page numbers and "Reprint — copy n" on the report; staff qualification on user records; WhatsApp / referral-copy consent at registration with a privacy notice; idle auto sign-out; QC module (P2-04); equipment log; reagent lot on each result; written retention policy.

### 4.3 Production only
Hashed passwords, lockout, server time, an append-only audit table with a hash chain, backups, encryption, breach-response tooling, real OTP.

---

## 5. Is the audit trail "audit safe"?

### 5.1 What is good today
- One `audit()` call on every important lab action: visit created, IP order, tube collected / received / rejected, results entered, report verified, delivered (each message), handed over, referral doctor saved, Test Master create / edit / stop (with a list of changes and version), every lab stock movement, counts and reviews.
- Every entry has **who** (`userId`), **when** (`at`), **what** (`action`, `entity`, `entityId`) and a readable detail.
- Billing, credit, discount and cancellation approvals are audited with the approver.
- Sign-ins are audited; there is an audit viewer in Settings.
- Records are never hard-deleted; cancelled things stay with a reason.

### 5.2 What is missing
| Gap | Why it matters | Fix (demo) | Fix (production) |
|---|---|---|---|
| **No old → new values** on result changes and most edits | In a dispute you cannot prove what the report said before | F2; add `before` / `after` to `audit()` for results, patient edits and settings | Same, stored as JSON columns |
| **Viewing and printing are not logged** | EHR standard asks for view logging; HIV and other private results need it | Audit `REPORT_VIEWED`, `REPORT_PRINTED` (with copy number), `PATIENT_VIEWED` | Same |
| **Audit can be changed or wiped** — it lives in the browser; *Reset demo data* clears it; anyone with browser tools can edit it | Not acceptable as legal evidence | Add a **hash chain** (each entry stores the SHA-256 of the previous one) and a *Check audit integrity* button — shows the design | Append-only table, no UPDATE / DELETE rights for the app user, hash chain, off-site copy |
| **Time comes from the user's computer clock** | A wrong PC clock gives wrong times (we already see seed times ahead of the clock) | Note only | Server time (NTP) for every record |
| **No reason on some changes** (result re-entry, settings) | Auditors ask *why* | Required reason box on corrections | Same |
| **Audit not exportable per patient** | Needed for patient access requests and breach reports | Export a patient's audit trail as CSV | Same + report |

**Verdict:** the demo already logs the right events, which is what the production team needs to copy. To call it *audit safe* it needs F2, view / print logging and (in production) a tamper-proof store. The demo can show all of these except the server-side protection.

---

## 6. Questions for the hospital
| # | Question |
|---|---|
| CQ1 | TN Clinical Establishments registration number to print on reports? |
| CQ2 | Who signs reports — names, qualification, TN Medical Council registration numbers, signature images? |
| CQ3 | Which tests are treated as confidential (HIV only, or also HBsAg, HCV, VDRL, pregnancy)? |
| CQ4 | Who notifies TB on Ni-kshay and other diseases to IHIP — the lab or a nodal officer? |
| CQ5 | How long should lab reports, samples and audit records be kept? |
| CQ6 | Is NABL accreditation planned? (decides whether QC / equipment logs are *must*) |
| CQ7 | Approved wording for the patient privacy notice and WhatsApp consent |

---

## 7. Sources used
- TN Clinical Establishments Act 1997 & Rules 2018 — [Act (TN DMRHS)](https://tncea.dmrhs.tn.gov.in/pdf/cea/Tamil%20Nadu%20Private%20Clinical%20Establishments%20(Regulation)%20Act,%201997.pdf), [Rules 2018](https://tncea.dmrhs.tn.gov.in/pdf/cea/TAMIL%20NADU%20CLINICAL%20ESTABLISHMENTS%20(REGULATIONS)%20RULES_2018.pdf)
- Clinical Establishments Act — [Act 2010](https://www.indiacode.nic.in/bitstream/123456789/6794/1/clinical_est_act_2010.pdf), [signatory minutes](https://clinicalestablishments.mohfw.gov.in/sites/default/files/2022-06/6071.pdf), [2025 National Council minutes](https://clinicalestablishments.mohfw.gov.in/sites/default/files/2025-02/9091.pdf), [Rajya Sabha answer 2021](https://rsdebate.nic.in/bitstream/123456789/718742/1/PQ_254_20072021_S22_p43_p45.pdf)
- NMC Code of Medical Ethics 2002 — [nmc.org.in](https://www.nmc.org.in/rules-regulations/code-of-medical-ethics-regulations-2002/)
- HIV/AIDS Act 2017 — [Act text](https://www.indiacode.nic.in/bitstream/123456789/18467/1/act.pdf), [NACO data protection guidelines circular](https://goasacs.goa.gov.in/wp-content/uploads/2020/05/OM_Data_Protection_Guidelines22-5.pdf)
- TB notification — [Delhi Medical Council notice](https://delhimedicalcouncil.org/images/Latest-News/TB%20Advertisement%20for%20DMA.pdf), [Business Standard](https://business-standard.com/article/current-affairs/disquiet-as-govt-threatens-jail-for-doctors-chemists-not-reporting-tb-118032400749_1.html)
- DPDP Rules 2025 — [Bar & Bench](https://www.barandbench.com/view-point/meity-notifies-final-digital-personal-data-protection-rules-2025), [Khaitan & Co](https://www.khaitanco.com/sites/default/files/2025-11/ERGO%20-%20Digital%20Personal%20%20Data%20Protection%20Rules%20-%2015%20November%202025.pdf)
- EHR Standards 2016 — [MoHFW PDF](https://esanjeevani.mohfw.gov.in/assets/guidelines/ehr_guidlines.pdf), [ISO 27789 (NRCeS)](https://www.nrces.in/standards/iso/iso-27789)
- NABL / ISO 15189:2022 — [J Lab Physicians 2025 comparison](https://jlabphy.org/translating-global-standards-to-local-practice-comparing-international-organization-for-standardization-151892012-and-2022-with-implementation-insights-from-the-national-accreditation-board-for-test/) (check the current NABL 112 issue on nabl-india.org)
- Bio-Medical Waste — [Bar code guidelines](https://dste.py.gov.in/ppcc/pdf/Guidelines/Guidelines_for_Bar_Code_System_for_HCFs_and_CBWTFs.pdf)

---

## 8. Change log
| Date | Version | Change |
|---|---|---|
| 2026-11-27 | 0.1 | First compliance and audit review of the lab module. |
