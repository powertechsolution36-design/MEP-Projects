# FIX Status Reconciliation — FIX-3.6-01, FIX-3.7-01, FIX-3.7-02, FIX-3.7-03, FIX-3.7-04

Targeted verification task, run 2026-09-27, in response to a contradiction between
`docs/STAGE_6_PWA_FUNCTION_COVERAGE.md` (Workstream C pass, reports all five OPEN)
and a prior Phase B fix task (`docs/STEP_6_API_TEST_HARDENING.md`, 2026-09-26, reports
FIX-3.7-01/02/03/04 RESOLVED) plus a later same-day fix reflected in
`docs/STAGE_6_API_CONTRACT_AUDIT.md` (2026-09-27 19:11, reports FIX-3.6-01 RESOLVED).

## Step 0 — Safety check

- `git diff --name-status -- v2`: 37 files changed, all confirmed EOL-only (CRLF/LF)
  via `git diff --ignore-all-space`, no real content changes. Matches expected known drift.
- `git diff --name-status -- v3`: 0 files. Matches expected.
- `md5sum index.html MEP_PROJECTS_PWA/index.html`: both `111b53dba91704f96b83dae96c7793c6`.
  Matches expected.
- `git status --short`: ~95 modified-tracked entries. Verified these are EOL-only
  everywhere **except** `index.html` / `MEP_PROJECTS_PWA/index.html` themselves, which
  differ from git HEAD by ~92 real lines (an uncommitted "durable offline read-cache"
  feature layered on top of the same PWA business logic — `persistCache()`/`readCache()`/
  `finalizeOnlineLoad()`/cache-aware `load()`/auto-login). This is recorded as an
  **anomaly, not altered**: it does not touch any inventory, notification, or payment
  logic relevant to this reconciliation, and both PWA copies still hash identically to
  each other and to the expected md5, so the PWA remains internally consistent as the
  source of truth for this task's purposes.
- Untracked: `new-app/` (expected), plus two anomalies not part of this task's scope:
  `.tmp_lock_copy` (loose file, repo root) and `Claude outputs/` (directory containing
  `fix_domain_model_enquiry.py`, `refactor_enquiry_cascade.py`). Recorded, not altered.

## Step 1 — FIX-3.6-01 (inventory role over-grant)

**PWA fact:** `mep_pm`'s menu (`MENUS` L1289-1300) never includes "stock"; the PWA's
`invissue` (Issued Material) button is visible only to admin/inventory.

**Current source** (`new-app/backend/src/services/inventoryService.js`):
```
const STOCK_REPORT_ROLES  = Object.freeze(['admin', 'inventory', 'hvac_pm', 'solar_pm', 'service_mgr']);
const ISSUED_REPORT_ROLES = Object.freeze(['admin', 'inventory']);
```
`exportStockCsv()` calls `assertCanViewStockReport` (STOCK_REPORT_ROLES);
`exportIssuedCsv()` calls `assertCanViewIssuedReport` (ISSUED_REPORT_ROLES). `mep_pm` is
in neither set. Comment at line 82-88 explicitly attributes this split to FIX-3.6-01.

**Current test** (`tests/inventoryService.test.js`):
- `FIX-3.6-01 — exportStockCsv is reachable by hvac_pm/solar_pm/service_mgr ... but NOT mep_pm` — asserts success for the three allowed roles and `assert.rejects(..., /FORBIDDEN|not permitted/)` for `mep_pm`.
- `FIX-3.6-01 — exportIssuedCsv ... is admin/inventory only` — asserts success for admin, and rejection for `hvac_pm`, `solar_pm`, `mep_pm`, `service_mgr`.

**Result:** both tests pass (see Step 7). RESOLVED, confirmed at code and test level.

## Step 2 — FIX-3.7-01 (notification emoji/em-dash fidelity)

**PWA fact (byte-verified against `MEP_PROJECTS_PWA/index.html`):**
- L2318 (`runDelayCheck`): `"⚠ PROJECT DELAYED — \""+p.name+...`
- L3134 (`saveIssue`, low-stock): `"⚠ "+st.txt+": "+it.name+" — "+totQty(it)+...`
- L3416 (`saveReturnReq`): `"📥 Return request: "+U.name+" is returning "...`

**Current source, verified directly:**
- `projectService.js:1105`: `` `⚠ PROJECT DELAYED — "${project.name}" (${project.division}${soPart}): ...` `` — exact match.
- `inventoryService.js:511`: `` `⚠ ${state.label}: ${item.name} — ${totQty(updatedItem)} ${item.unit} left (min ${item.minimumStockLevel || 0})` `` — exact match.
- `inventoryService.js:545`: `` `📥 Return request: ${actorAuth.name || ''} is returning ...` `` — exact match.

**Current test:** `notificationService.test.js` "FIX-3.7-04" test asserts these three literal substrings exist in the respective source files (static source-text assertion, not a live-execution check of the rendered string — see Step 5 caveat).

**Result:** RESOLVED, confirmed by direct source comparison against the PWA (independent of the test).

## Step 3 — FIX-3.7-02 ("Collect by <date>" clause)

**PWA fact** (`doRaise`, L2360):
```
"Payment milestone raised by "+U.name+" for \""+p.name+"\" (SO-"+so.no+"): "+money(payBal(pr))+" due — "+note+". Collect by "+by+"."
```

**Current source** (`paymentService.js:441`, inside `raiseToFinance`):
```js
text: `${raisedToFinance.priority === 'Urgent' ? '⚠ URGENT — ' : ''}Payment milestone raised by ${actorAuth.name || actorAuth.role} for "${so.projectName}" (SO-${so.orderNumber}): ${money(computeBalance(updated))} due — ${note || ''}. Collect by ${dueByDate || ''}.`,
```
Trailing "Collect by `<date>`." clause is present; `dueByDate` is sourced from `raiseToFinance`'s own input and stored in `raisedToFinance.collectByDate` — matches PWA's `by` variable.

**Current test:**
- `notificationService.test.js` FIX-3.7-04 test: static source-substring assertion that the `.` Collect by `${dueByDate || ''}.`` `` clause literal exists.
- `paymentService.test.js` "raiseToFinance" test: **runtime** test, but only asserts `/URGENT/.test(n.text)` and role targets — it does **not** assert the "Collect by" clause appears in the actual generated notification text at runtime.

**Result:** RESOLVED at the source level (byte-identical to PWA), with a genuine **test-coverage gap**: no runtime test currently exercises `raiseToFinance` and asserts the literal "Collect by `<date>`." substring in the resulting notification object. The static source-check is not equivalent to executing the code path.

## Step 4 — FIX-3.7-03 (money() formatting on payment notifications)

**PWA fact** (`money()`, L1258): `` "₹ "+n.toLocaleString("en-IN",{maximumFractionDigits:0}) ``; used at L3828/L3831 for both fully- and part-received notifications.

**Current source** (`paymentService.js:24-27`): local `money()` reproduces the exact same formatting (`₹ ` + `en-IN` locale string, 0 fraction digits). Used at line 207 (`Payment fully received: ${money(updated.amount)} — ...`) and line 218 (`Part payment received: ${money(amt)} for ...Balance ${money(balanceAfter)}.`).

**Current test** (`paymentService.test.js`, runtime, not just static):
- "addPartPayment — part payment..." test asserts `assert.match(notif.text, /Balance ₹ 60,000/)` against the **actually generated** notification text (real execution, real comma-grouped currency formatting) — this is a genuine runtime exact-format check, the strongest evidence available for this fix.
- "addPartPayment — full payment..." test asserts `/fully received/.test(n.text)` (existence only for this one, but the money() call site is shared code exercised by the part-payment test above).

**Result:** RESOLVED, confirmed by both source comparison and a live runtime test that actually exercises the formatting output (₹ 60,000 with comma grouping — not raw `60000`).

## Step 5 — FIX-3.7-04 (exact notification text regression coverage)

Inventory of the actual assertions:

| Test file | Test | Assertion type | Notification covered |
|---|---|---|---|
| `notificationService.test.js` | `FIX-3.7-04: exact notification text fidelity...` | **Static source-text substring** (reads `.js` files with `fs.readFileSync`, asserts `String.includes()` against the literal template string in source) | Project delay (row 3), Inventory low-stock (row 15), Inventory return-request (row 18), Payment raised-to-finance (rows 4/24/25 — "by <name>", money(), "Collect by" clause), Payment fully/part received (money()) |
| `paymentService.test.js` | `addPartPayment — part payment...` | **Runtime regex on actual generated text**, includes real currency formatting (`₹ 60,000`) | Part payment received (row 25) |
| `paymentService.test.js` | `addPartPayment — full payment...` | Runtime regex, existence only (`/fully received/`) | Payment fully received (row 24) |
| `paymentService.test.js` | `raiseToFinance — ...` | Runtime regex, existence only (`/URGENT/`) + recipient check | Payment milestone raised (row 4) — does **not** runtime-check the "Collect by" clause or money() output for this specific notification |
| `inventoryService.test.js` | various issue/return tests | Runtime, substring/`includes` on generated text (per Phase B's own note: `startsWith` loosened to `includes('Return request:')`) | Inventory return-request (row 18), low-stock (row 15) — existence-level, not full exact-text |

**Conclusion:** genuine regression coverage exists for all 6 content-fidelity fixes, but it is
a mix of (a) static source-text checks — a real but weaker signal than execution, and
(b) runtime tests that are mostly substring/regex rather than full exact-string equality,
with one strong exception (the `₹ 60,000` runtime formatting check). The single concrete
gap: no runtime test asserts the literal "Collect by `<date>`." clause appears in the actual
notification object produced by `raiseToFinance`. This is a test-coverage refinement
opportunity, not evidence that the fix itself is missing (the source-level comparison in
Steps 2-3 independently confirms the code is correct).

## Step 6 — The Workstream C contradiction

**Classification: A — stale documentation / stale reference.**

Evidence:
- `docs/STEP_6_API_TEST_HARDENING.md` (2026-09-26, Phase B fix task) explicitly marks
  FIX-3.7-01, FIX-3.7-02, FIX-3.7-03, FIX-3.7-04 **RESOLVED**, with source line
  citations and a "365/365, 0 failed" full-regression result. It also honestly states,
  at that time, that **FIX-3.6-01 "remains open and untouched"** — i.e. FIX-3.6-01 was
  genuinely not yet fixed as of 2026-09-26.
- `docs/STAGE_6_API_CONTRACT_AUDIT.md` (2026-09-27 19:11, same day, **earlier** in the
  Workstream C session than the coverage doc below) explicitly re-confirms: *"Confirmed
  the FIX-3.6-01 report-role split (`STOCK_REPORT_ROLES` vs `ISSUED_REPORT_ROLES`)
  exists in source exactly as documented, including `mep_pm` correctly excluded."* This
  means FIX-3.6-01 was fixed sometime between 2026-09-26 and 2026-09-27 19:11, and the
  Workstream C author's own API-contract pass **already verified this fix that same day**.
- `docs/STAGE_6_PWA_FUNCTION_COVERAGE.md` (2026-09-27 19:19 — only 8 minutes **after**
  the API-contract-audit document above, same Workstream C session) nonetheless reports
  all five as **Open**, citing `E2E_PASS_3_6_INVENTORY.md` / `E2E_PASS_3_7_NOTIFICATIONS.md`
  (both dated 2026-09-24, i.e. written *before* the Phase B fixes and before the
  FIX-3.6-01 fix even existed). The coverage-matrix rows and the closing findings table
  reuse the pre-fix finding language verbatim ("STOCK_VIEW_ROLES over-grants mep_pm" —
  a constant name, `STOCK_VIEW_ROLES`, that no longer exists anywhere in current source)
  without re-deriving status from current code, current tests, or even its own sibling
  document written minutes earlier in the same pass.

This session's own direct inspection of current source (Steps 1-4) and a live test run
(Step 7) confirm the code and tests match the Phase B/API-contract-audit RESOLVED claims,
not the stale Workstream C coverage-doc OPEN claims. The Workstream C "OPEN" status is a
stale-documentation artifact: it never re-read the current `inventoryService.js`,
`paymentService.js`, `projectService.js`, or their tests, and cited two-to-three-day-old
E2E pass documents that predate the fixes.

## Step 7 — Targeted test results

Ran exactly: `node --test tests/inventoryService.test.js tests/notificationService.test.js tests/paymentService.test.js`

```
1..70
# tests 70
# suites 0
# pass 70
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Specifically, all five named fix tests pass:
- `ok 45 - FIX-3.6-01 — exportStockCsv is reachable by hvac_pm/solar_pm/service_mgr ... but NOT mep_pm`
- `ok 46 - FIX-3.6-01 — exportIssuedCsv (Issued Material report) is admin/inventory only ...`
- `ok 59 - FIX-3.7-04: exact notification text fidelity for the 6 content-fidelity fixes from Pass 3.7`
- Plus the runtime `paymentService.test.js` tests covering FIX-3.7-02/03/01-adjacent notification content (all passing, part of the same 70/70).

No regression, no failure, no source-code change was made during this task — verification only, per the stop condition.

## Table

| Fix | Previous status | Current source | Current test | Current status | Reason |
|-----|-----------------|-----------------|---------------|-----------------|--------|
| FIX-3.6-01 | RESOLVED (per STAGE_6_API_CONTRACT_AUDIT.md, 09-27) | `STOCK_REPORT_ROLES`/`ISSUED_REPORT_ROLES` split, `mep_pm` excluded from both — matches PWA menu gating exactly | 2 dedicated tests pass (roles allowed/denied both directions) | **RESOLVED** | Workstream C cited stale 09-24 E2E doc referencing a `STOCK_VIEW_ROLES` constant that no longer exists in source |
| FIX-3.7-01 | RESOLVED (per STEP_6_API_TEST_HARDENING.md, 09-26) | `⚠ PROJECT DELAYED — "..."`, `⚠ <label>: ... — ...`, `📥 Return request: ...` all byte-match PWA source | Static source-text assertions confirm exact literal restored | **RESOLVED** | Same stale-reference issue |
| FIX-3.7-02 | RESOLVED (per STEP_6_API_TEST_HARDENING.md, 09-26) | Trailing `. Collect by ${dueByDate \|\| ''}.` clause present in `raiseToFinance`, byte-matches PWA's `doRaise` | Static source-text check only; no runtime assertion of this exact clause in the generated notification (coverage gap noted) | **RESOLVED** (source-confirmed); test-coverage refinement recommended | Same stale-reference issue; test gap is pre-existing, not a regression |
| FIX-3.7-03 | RESOLVED (per STEP_6_API_TEST_HARDENING.md, 09-26) | Local `money()` helper (₹, en-IN, 0 decimals) used on both fully- and part-received notification amounts | Runtime test asserts actual `₹ 60,000` formatted output | **RESOLVED** | Same stale-reference issue |
| FIX-3.7-04 | RESOLVED (per STEP_6_API_TEST_HARDENING.md, 09-26) | N/A (test-coverage fix) | Dedicated exact-text test exists (mixed static-source + runtime substring assertions across 6 sites) | **RESOLVED** | Same stale-reference issue |

## Final verdict

**TARGETED FIX RECONCILIATION = PASS.**

All five fixes are present in current source and supported by current tests (70/70
targeted tests passing, 0 failures). **Workstream C contradiction = STALE
DOCUMENTATION/STALE EVIDENCE (classification A)** — the Workstream C PWA-function-coverage
pass reused finding language from two-to-three-day-old E2E documents (09-24) instead of
re-deriving status from current source/tests, and did so despite its own sibling
API-contract-audit document (written minutes earlier, same session) already confirming
FIX-3.6-01 fixed. Workstream C may be treated as PASS for these five items, subject to
the separately-documented Finance raw-PWA overpayment/rollback caveat it already flagged
(classification E, unrelated to this reconciliation).

One residual, non-blocking recommendation for a future task: add a runtime test on
`raiseToFinance` that asserts the literal "Collect by `<date>`." substring in the actual
generated notification object, closing the one test-coverage gap identified in Step 5 —
this does not block Stage 6 since the underlying source is independently confirmed
correct by direct comparison against the PWA.
