# Nallam Hospital HMS — Stock Receiving (GRN) & Inventory Management

A frontend-only, fully interactive prototype for **Nallam Hospital, Hosur, Tamil Nadu**. Built with HTML5, CSS3 and vanilla ES modules — no framework, no backend. All records are **fictional demonstration data**.

## Run it

Browsers block `fetch()` of local JSON files when `index.html` is opened straight from disk, so serve the folder over HTTP. The bundled server sends no-cache headers so edits always show up:

```powershell
python tools/serve.py 8080
```

Then open <http://localhost:8080>. Any static server works (`python -m http.server`, `npx serve`, VS Code Live Server…), but those may cache old JS.

Chart.js, Lucide icons and the Inter font load from CDNs; the app still works offline but without charts/icons.

### Demo accounts (password `demo123`)

| Username   | Role                        | Highlights |
|------------|-----------------------------|-----------|
| `pharmacy` | Pharmacy Staff              | Creates GRNs, uploads documents, requests adjustments |
| `store`    | Store                       | Receives supplier stock, transfers to pharmacy, approves stock corrections |
| `reception`| Reception                   | Registers patients, Patient ID, patient records |
| `owner`    | Hospital Owner (SUPER_ADMIN)| Approves exceptions, sees all notifications, audit log, settings |

The login screen no longer lists these accounts, so type them in. To restore the original data, the owner uses **Settings → Data & Backup → Restore initial data**.

**Always-current sample data.** The JSON is anchored to the day it was generated. On every load all dates move forward by whole days so the last sample day is always *today*: today's sales, expiry alerts and pending closings stay meaningful whenever the system is opened.

## BRD alignment (Business Requirement Document v1.0)

| BRD module | Status |
|---|---|
| 01 Patient Management | Done — registration, unique Patient ID (`NH-UH-…`), duplicate check, profile with visit history, patient card with barcode, "Register new patient" inside billing. Consultations and admissions join the history when modules 02/03 are built. |
| 04 Pharmacy Management | Done — counter sale to a **registered patient (Patient ID)** or a **walk-in customer**, prescription details, returns, counter closing. |
| 05 Store Management | Done — supplier receipts go to the **Central Store**; **Store → Pharmacy** transfers move stock in one step (Store −qty, Pharmacy +qty); only Pharmacy stock can be billed. Full transfer history and printable transfer note. |
| 09 Discount Approval | Done — staff up to 10%; above that they send a request with a reason, the bill is held, the Super Admin approves/rejects from **Discount Approvals** (or at the counter), and the log keeps reason, requester, approver and time. |
| 14 User Management | Done — individual accounts (max 10), roles, activate/deactivate, password reset, role access matrix. |
| 12 Shift, 13 Dashboard | Partly — daily counter closing per cashier; dashboards cover pharmacy, store and patients. |
| 02, 03, 06, 07, 08, 10, 11 | Not built yet (OP, IP, Lab, Services, Central Billing, Packages, MRD). OP consultation billing and IP (admission/discharge) billing belong to those modules and are **not** part of the pharmacy screens. |

**Roles (BRD role map):** Super Admin (`owner`), Reception (`reception`), Pharmacy (`pharmacy`, `ravi`), Store (`store`). All passwords `demo123`.

## Client requirements added after requirement review

- **10% discount lock** — staff and managers can give at most 10% (Settings → Pharmacy & Billing). Anything higher needs the owner to approve at the counter with their own login, and the owner is notified.
- **Daily Stock Count** (`#/stock-count`) — at the end of the day staff count the fast-moving medicines. *Start of day − billed + received* is what should be on the shelf; any shortfall (stock given without a bill) alerts the owner, who reviews it from Approvals. Counts never change stock; corrections go through Stock Corrections.
- **Registered patient / Walk-in split** — shown in Counter Closing, the Closing Report, Sales Insights and the owner's closing notification. Credit is given only to registered patients, so every unpaid balance is tied to a Patient ID.
- **Barcodes** — the billing search accepts a barcode scanner (it types and presses Enter). A manufacturer barcode adds the medicine using FEFO; a hospital sticker (`NH…`) adds that exact batch, and expired batches are refused. **Barcode Labels** (`#/labels`) prints Code 128 stickers per batch or per stock receipt.
- **Manufacturing date** — captured on every stock-receipt line, validated against today and the expiry, stored on the batch and printed on labels.
- **Purchase cost vs sales value** — the cost (PTR) of what was sold against what it sold for, with margin: on Sales Insights, the owner's Home and the *Purchase vs Sales (Daily)* report.
- **Hospital network access** (Settings, owner) — a list of allowed hospital IP addresses for staff and manager sign-in. The list is stored here; the hosting server enforces it.

## Simple, role-based experience

- **Home** (`#/home`) is the landing page for everyone: big task tiles, four key numbers and a short "Needs your attention" list for that role.
- **Approvals** (`#/approvals`, manager & owner) collects every pending decision in one inbox: stock receipts, special approvals, stock corrections, refunds, bill cancellations and day closings.
- **Sidebar** uses plain words grouped into Billing / Stock / Business / System. Pages a role rarely uses are under **More** (configured per role in `NAV` in `assets/js/app.js`).
- Lists show quick filter chips instead of rows of KPI cards; detailed charts live in **Sales Insights** and **Stock Insights**.
- Forms show the essential fields first; optional fields (doctor, UHID, invoice qty, discount, GST…) open with one click.
- Status badges use plain language ("Waiting for check", "Stock added", "Expiring soon", "Unpaid").

## Architecture

```
index.html
assets/css/        styles.css (tokens, layout) · components.css · responsive.css (+ print)
assets/js/
  app.js           bootstrap, login, shell (sidebar/header/search/notifications), routing
  router.js        hash routes + permission guards
  data-service.js  central store: loads /data/*.json, persists to localStorage, reset
  attachment-store.js  uploaded file binaries in IndexedDB (only metadata in the store)
  calculations.js  ALL derived values: balances, statuses, totals, KPIs, alerts
  validation.js    GRN + form validation rules
  services.js      business transactions (post GRN, adjustments, issue, returns, audit)
  notifications.js stored notifications + toasts
  components.js    data table, modal, confirm, combobox, dropzone, charts, CSV, tabs
  modules/         dashboard, grn, inventory, medicines, batches, movements,
                   adjustments, dispense (demo issue), suppliers, alerts, reports,
                   settings (+ audit, profile), help
data/              JSON source of truth for the initial demo state
tools/generate-data.mjs   regenerates /data deterministically (node tools/generate-data.mjs)
```

### Key rules implemented

- **Medicine ≠ batch.** Expiry, MRP and PTR live on batch records only.
- **The stock-movement ledger is the source of truth.** Batch balances are the sum of movements; nothing overwrites a balance. Every movement stores previous/new balance.
- **Stock changes only on posting.** Draft, submitted, rejected or cancelled GRNs never affect inventory. Posted GRNs are locked; corrections use supplier returns or adjustments.
- **Configurable approval policy** (Settings): routine receipts are posted by the manager; expired/short-dated deliveries, invoice-quantity variance above a %, or high-value receipts escalate to the owner. The owner is notified of every posted receipt.
- **Adjustments** require a reason, create `STOCK_ADJUSTMENT_IN/OUT` movements on approval, cannot be self-approved by staff, and sensitive ones need the owner.
- **Expiry** uses the real current date and a configurable threshold (default 90 days). Expired/quarantined batches are excluded from available stock and blocked from issue. FEFO is the default issue recommendation.
- **Document checks are simulated.** No real OCR/AI runs; statuses are deterministic demo results and staff must verify physical stock.

### Quantities and units

Stock is held in each medicine's dispensing unit (strip, bottle, vial, piece…). GRN quantities and rates are entered in that unit. The master also records the purchase unit and conversion for future use.

## Module 3 — Pharmacy Operations & Billing

Navigation: **Billing · Pharmacy → Pharmacy Sale · Pharmacy Bills · Sales Returns · Counter Closing · Closing Report** (report: owner). The section is named *Billing* so OP and IP billing can sit beside it when those modules are built; pharmacy charges for admitted patients will then post to the IP bill through ward indents.

| File | Purpose |
|------|---------|
| `assets/js/pricing.js` | Bill maths shared by the app **and** the seed generator |
| `assets/js/pharmacy-calc.js` | Business date, bill status, day summaries, pending closings |
| `assets/js/pharmacy-services.js` | Complete bill, collect balance, cancel, return/refund, daily closing — each in one store transaction |
| `modules/billing.js` · `bills.js` · `pharmacy-returns.js` · `closing.js` · `pharmacy-dashboard.js` | Screens |
| `data/pharmacy-bills.json`, `pharmacy-bill-items.json`, `payment-transactions.json`, `pharmacy-returns.json`, `pharmacy-return-items.json`, `bill-cancellations.json`, `daily-closings.json`, `daily-closing-payments.json`, `pharmacy-settings.json`, `patients.json` | Seed data (fictional) |

**Pricing.** Selling price = batch MRP, which is GST-inclusive (Indian retail convention). GST is back-calculated from each line (`taxable = net × 100 / (100 + GST%)`), never added on top. Item discounts apply per line; a bill discount is shared across lines pro rata; the grand total is rounded to the rupee with the round-off shown.

**Rules implemented**
- FEFO batch suggestion; expired/quarantined batches are never offered. Quantities above a batch spill into the next FEFO batch; above total availability they are capped. Batch override is manager-only.
- *Complete Bill* re-validates stock, then creates bill, items, payment transactions and `PHARMACY_SALE` movements in one transaction — a failure leaves no partial stock deduction.
- Payments: Cash (tendered/change), UPI, Card, Other, split across modes, and credit/pending for registered patients only (configurable). Every payment and refund is its own transaction record.
- Discount limits per role (staff 5 %, manager 15 %, owner unlimited) with a simulated supervisor override; the owner is notified of large discounts.
- Returns reference the original bill item, cannot exceed the eligible quantity, and never edit the bill. A verifier chooses Restock (only unopened units of a still-sellable batch → `PATIENT_RETURN` movement), Quarantine or Write-off (no stock added). Refunds above a threshold need the owner.
- Cancellation: staff request, manager/owner approve. Stock is reversed with `SALE_CANCELLATION` movements and payments are refunded; the bill stays in history. Bills on an already-closed counter day cannot be cancelled (use a return).
- Daily closing per cashier and **business date** (configurable day-start hour, not just browser midnight). Expected cash = opening float + cash payments − cash refunds. After submission the closing is locked, billing for that counter/day is blocked, the owner is notified (plus a variance alert above tolerance), and corrections need a manager and are audited. The report re-checks every closing against live transactions.
- Owner notifications: stock posted, closing submitted, cash variance, large discount, refund approval, cancellation request, low/out of stock, critical expiry — each with reference, time and performed-by.

**Accounting scope.** This is an internal pharmacy sales tally and daily payment reconciliation. It does **not** integrate with Tally Prime, GST filing software or bank reconciliation; the payment-transaction and closing records are structured for a future export.

## Backend integration notes

Each JSON file maps to a future REST resource / MySQL table (`medicines`, `medicine_batches`, `goods_receipts` + `goods_receipt_items`, `stock_movements`, `stock_adjustments`, `notifications`, `audit_logs`, `settings`…). `services.js` holds the transaction boundaries that should become Spring Boot service methods; `data-service.js` is the single place to swap localStorage for API calls.
