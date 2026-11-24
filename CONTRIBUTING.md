# Working together on Nallam HMS

Two people (each with their own Claude Code chat) build modules in parallel. These rules keep the work from colliding.

## Who owns what

| Area | Owner | Branch |
|---|---|---|
| Patient Management (01), Pharmacy (04), Store (05), Discounts (09), Users (14) | Dharaneeswar | `main` / `feature/pharmacy-*` |
| OP Management (02) — visit registration, token, doctor queue, consultation billing | Friend | `feature/op-module` |
| IP Management (03) — admission, bed/ward, deposits, discharge billing, ward medicine indent | Friend | `feature/ip-module` |

## Branch workflow

1. Never commit straight to `main`. Create a branch: `git checkout -b feature/op-module`.
2. Pull often: `git pull origin main` (then `git merge main` into your branch) at least once a day.
3. Push your branch and open a Pull Request. The other person reviews and merges.
4. Run `node tools/generate-data.mjs` after merging if anyone changed the generator, and commit the regenerated `/data`.

## Where a new module plugs in

A new module should live mostly in **new files**. Only touch the shared files below, and keep each change small (one block per module) so merges are easy.

| Need | New files (yours) | Shared file (small edit only) |
|---|---|---|
| Screens | `assets/js/modules/op-*.js`, `ip-*.js` | `assets/js/router.js` — add routes |
| Sidebar items | — | `assets/js/app.js` `NAV` — add items under the `Billing`/`OP`/`IP` sections |
| Business logic | `assets/js/op.js`, `assets/js/ip.js` | — |
| New data collections | `data/op-visits.json`, `data/ip-admissions.json`… | `assets/js/data-service.js` `COLLECTIONS` — add lines |
| Sample data | a separate section/function in the generator | `tools/generate-data.mjs` — add your block at the end; bump `dataVersion` |
| Permissions | e.g. `op.register`, `ip.admit` | `tools/generate-data.mjs` role permission lists |
| Styles | `assets/css/op.css` / `ip.css` | `index.html` — add the `<link>` |

**Rules that must not break**

- Patients are shared: always link records with `patientId` from `patients.json`; never create a second patient list.
- The pharmacy counter sells only to a registered patient (Patient ID) or a walk-in. IP medicine charges come from a **ward indent** posted to the IP bill — not from the pharmacy counter screen.
- Stock changes only through stock movements (`services.js` → `createMovement`).
- Money is rounded with `pricing.js` helpers; dates use the business-date helpers in `pharmacy-calc.js`.

## Running locally

```powershell
python tools/serve.py 8080
```

Open <http://localhost:8080>. Logins are in `README.md` (password `demo123`).
