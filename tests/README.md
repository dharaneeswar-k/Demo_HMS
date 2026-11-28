# Lab module tests

`lab.tests.js` holds **116 automated acceptance tests** for the Laboratory module (LT-001 … LT-116). They run inside the demo in the browser, so nothing needs installing or building.

## How to run

1. Serve the project folder with any static server (for example the VS Code *Live Server*, or `npx serve .`) and open the demo.
2. Sign in with any user (e.g. `owner` / `demo123`).
3. Open the browser console (F12) and run:

   ```js
   await (await import('./tests/lab.tests.js')).runLabTests()
   ```

4. The console prints a table with one row per test (PASS / FAIL and the error) and returns `{ summary, failed, results }`.

**The run resets the demo data** before it starts (so every run begins from the same seed) and again when it finishes. To keep the data the tests created, for example to look at it on the screens, pass `{ keepData: true }`. Your sign-in is restored afterwards; reload the page to see fresh screens.

## What is covered

| Group | Tests | Area |
|---|---|---|
| Seed | 8 | Users, settings, test flags, master validation |
| Ranges | 13 | Age / sex / pregnancy reference ranges |
| Billing | 11 | Lab request rules, SID, tubes, consent, pregnancy |
| Sample | 11 | Token, collect, receive, reject, kit use, ward orders |
| Results | 12 | Entry, flags, corrections with reason, critical alerts, doctor notified |
| Verify | 13 | Signatory, second person, report number, hand-off |
| Critical | 9 | Critical call log with read-back |
| Amend | 9 | Amended reports, previous versions, re-sending |
| Confidential | 8 | HIV-type tests: roles, hand-over, audit, per-test switch |
| Notifiable | 4 | TB / IDSP notification register |
| Master / Report | 2 | Test Master range check, printed report content |
| OP / IP link | 16 | OP bills and IP charges with lab tests reach the lab; one price; ward orders on the IP bill |

The full list with what each group proves is in [docs/LAB_MODULE_SPECIFICATION.md §33.1](../docs/LAB_MODULE_SPECIFICATION.md#331-automated-test-suite-100-tests-runs-in-the-browser).

## Writing a new test

```js
T('LT-101', 'Group', 'What the rule is, in one sentence', () => {
  const { o } = ready(P('Fathima Begum'), 'FBS');        // bill → collect → receive → enter
  eq(o.status, 'RESULTED');                              // eq / ok / throws helpers
});
```

The helpers `bill`, `ready`, `done`, `enter`, `informed` and `view` are at the top of `lab.tests.js`. Keep one rule per test and name the test after the rule. Then the list doubles as the rule book for the production test suite.
