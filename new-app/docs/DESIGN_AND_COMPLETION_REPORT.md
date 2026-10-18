# MEP PROJECTS NEW APP — Design + Final Completion Report

**Date:** 2026-10-13
**Scope:** `new-app/` only. Branch on your computer: `v3-foundation`, last commit `441b466`.
**Nothing was committed, pushed or deployed.** No production host, database, PM2 process, Nginx config or environment variable was touched.

---

## 1. Was Claude Design available, and was it used?

**Available: yes. Used to build this UI: no — and it could not have been.**

This account has five published Artifact types, including **Design** and **Design System**. Those produce hosted pages on claude.ai; they cannot emit React components and CSS into a Vite application in your repository, which is where this product's interface actually lives. Building the UI with them would have produced a mock-up beside the app, not the app.

So the interface was built the only way it can be: as a real design system in the codebase —
`new-app/frontend/src/styles/{tokens,base,layout,components,print}.css`, documented in
`new-app/docs/DESIGN_SYSTEM.md`.

If you would like the system as a browsable reference (tokens, components, live previews) to hand to a designer or another agent, say so and I will publish it as a Design System artifact that mirrors these files.

**Honest note on provenance:** when this session started, the working copy already contained an unverified design pass (tokens, base, layout, components, print, the shell, and ~45 restyled pages) that was *not* on your computer and had never been built, linted or tested. I did not assume it was good. I reviewed it, ran it, found and fixed defects in it (see §7), and only then delivered it.

---

## 2. The design system and what it changed

One token file is the source of truth for colour, type, space, radius, elevation and motion. Nothing else hard-codes a hex value.

- **Brand ramp** built around the app's established blue, plus a cool neutral ramp tuned for dense data screens, and four semantic families (ok / warn / bad / info).
- **Division accents** — HVAC, Solar, MEP and AMC each have a fixed chip colour, so division is readable at a glance on every screen.
- **Shell** — rail, header, page head, content column; below 1024px the rail becomes a drawer, below 640px the header compacts. Verified at 390px: no sideways scroll, drawer opens and closes.
- **Components** — panels, data tables (with group headers, row tints, overdue cells, sub-lines), KPI cards, status badges, filter panels, search bars, modals, alerts, empty states, spinners and skeletons.
- **Accessibility** — `:focus-visible` rings everywhere, larger hit areas on coarse pointers, `prefers-reduced-motion` respected, and status never carried by colour alone (every tint is paired with a word or a figure).
- **Print** — the quotation, the AMC document and the delivery challan now share one letterhead treatment, so what the customer receives looks like one family of documents.

Screens reach for these classes instead of inline styles. **No business rule, permission, workflow or terminology lives in the stylesheets.**

---

## 3. The five reported gaps — all closed

Each was specified from the PWA first (function and line numbers), then implemented, then tested.

| # | Gap | PWA source | What it now does |
|---|---|---|---|
| 1 | Lost Enquiries filters and KPIs | `vLost` 1889-1900, `enqFilterBar` 1851-1869, `enqTable` 1870-1880 | Two red KPI cards over the **unfiltered** lost set, the filtered `(N of M, ₹X)` heading, the full ten-control filter bar with **no** Status select, the thirteen `enqTable` columns with star ratings and segment chips, the TOTAL row, newest-first order, and a date-stamped export that carries the on-screen filters. The filter bar and table are now one shared module used by both enquiry screens, so they cannot drift apart again. |
| 2 | Sales order margins | `vSO` 2047, `dlSOs` 3426 | Equipment / Accessories / Total margin derived server-side (`lsActual \|\| lsTarget` fallback preserved), shown on the detail screen and exported, and **withheld from cost-hidden roles** along with the raw cost fields. |
| 3 | Payments and Projects columns | `vPayments` 3858-3889, `payPanel` 3705-3735, `vProjects` 2089-2109 | **Payments:** five KPI cards computed over all payments (not the search), the raised-to-finance banner with raiser, date, collect-by and urgency, the twelve PWA pending columns including SO sub-lines and overdue next-call flags, billed/received/balance badges and TOTAL row, the **Payment Receipts Ledger** (newest first, with who entered and who edited each receipt), settled milestones with a Parts column, and the PWA's search field set. **Projects:** all nineteen PWA columns, with SO number, engineer names, checklist progress, timeline readiness, target end, overdue count, next action, reconciled Received/Pending and pending returnable material — all derived server-side so the list, the dashboard and the CSV cannot disagree. |
| 4 | Timeline auto-fill | `autoFillTimeline` 2592-2602 | Points spread evenly between start and end, including the `span < 1` fallback, as a pure helper with the same UTC day basis the backend uses. |
| 5 | Delivery challan grouping and printing | `challanPanel` 2336-2370, `printDC` 2430-2446 | Lines grouped by challan number (numeric order, first row supplies the group header), a group header carrying date / receiver / remark with **+ add item to this DC** and **🖨 Print DC**, per-line balance, Returnable/Consumable chips, the TALLY row, the returnable banners, the unit list, three blank rows and a read-only auto DC number — and a real printed challan with your letterhead, project meta, item table and both signature blocks. |

Also fixed while in there: the payments and projects CSVs now open with the PWA's `rptHead` preamble (report title with your company name, who generated it and when, and the active filter), and both are date-stamped like the PWA's files.

---

## 4. Test results

Every command below was run; the numbers are from those runs, not from an earlier report.

| Check | Command | Result |
|---|---|---|
| Backend suite (cloud) | `npm test` | **485 tests — 483 pass, 0 fail, 2 skipped** |
| Backend suite (**your computer**) | `npm test` | **485 tests — 483 pass, 0 fail, 2 skipped** |
| Backend serial + database contracts | `MEP_TEST_MONGO_URI=… MEP_TEST_MONGO_DB=mep_test_final node --test --test-concurrency=1 tests/*.test.js tests/auth/*.test.js` | **500 tests — 498 pass, 0 fail, 2 skipped** |
| Frontend build (cloud) | `npm run build` | **PASS** |
| Frontend build (**your computer**) | `npm run build` | **PASS** (exit 0) |
| Frontend lint | `npx oxlint src` | **0 errors**, 41 warnings (unused catch params, set-state-in-effect) |
| Browser acceptance, 11 roles, Chromium | `node e2e/completion/run.js` | **68 checks — 68 pass, 0 fail** |

The two skipped tests are the real-MongoDB-only checks described in §6. The database contract runs used FerretDB 1.24 on `127.0.0.1:27018` with throwaway `mep_test_*` databases, dropped after each run. No live database was touched.

### Browser acceptance coverage (68 checks)

- Login with username and password only; a wrong password is refused.
- All eleven roles log in and open **every page in their menu** with no JS error and no 5xx: admin (16), sales (5), hvac_pm (5), solar_pm (5), mep_pm (4), engineer (2), inventory (7), service_mgr (4), service_eng (2), finance (4), super (8).
- Menu gating: Quotations only for admin/sales/finance; Company Profile only for admin; Subscriptions only for super.
- Super admin: dashboard KPIs, add a company through the modal, the new company's admin logs in, Renew/Edit prefills, and the six revenue/subscriber CSVs.
- Lost Enquiries: KPI cards, filter bar without Status, PWA columns, TOTAL row, and a filter narrowing the table while the cards keep the full picture.
- Payments: KPI cards, raised banner, SO sub-lines, totals, receipts ledger, settled panel, and the CSV preamble.
- Projects: nineteen columns with real derived values, overdue tinting, reconciled payments, PM division scoping.
- Delivery challans: grouping, group headers, badges, balances, TALLY, banner, and a populated printed challan containing only that challan's items.
- Modal sweep (added after a real defect, §7): the user modal opens and lists assignable roles.
- Responsive: at 390px the nav collapses, nothing scrolls sideways, the drawer opens.

Evidence screenshots were delivered into the chat (see §8).

---

## 5. Security and tenant isolation

| Finding | Status |
|---|---|
| **`GET /api/projects` had no role check** — any authenticated user (sales, finance, inventory, service staff) could read the whole company's project list, including customers, vendors, costs-adjacent fields and challans. The PWA shows Projects to admin and the three PM roles only. | **Fixed.** Admin and PM roles get the company list (PMs still scoped to their division); engineers and service engineers get **only their own assigned projects** (what the PWA's engineer dashboard showed them); every other role gets 403. Regression test added. |
| Internal MongoDB ids were being shown where the PWA showed names (payments "entered by", "raised by") | **Fixed** by resolving names server-side; a test asserts no id leaks into those fields. |
| Company detail response could have carried password material | **Verified clean** — a test asserts the response contains no `passwordHash`. |
| Cross-tenant reads | **Verified** — existing and new tests assert 403/empty across companies for payments, projects, subscriptions and enquiries. |
| Division entitlement | **Verified server-side** on enquiries, quotations, sales orders, projects and checklist templates; hiding a menu is never the only gate. |
| Cost redaction | **Extended** — the derived margins are now redacted for cost-hidden roles too, not just the raw cost fields. |

---

## 6. Blocked

- **Two database tests still require a real MongoDB replica set** and are skipped with a stated reason: the company-delete cascade (needs transactions) and the concurrent-stock-issue race (needs atomic conditional updates). FerretDB supports neither. Before deploying, run them against a throwaway replica set:
  ```
  MEP_TEST_MONGO_URI=mongodb://<throwaway-replset> MEP_TEST_MONGO_DB=mep_test_predeploy MEP_TEST_REAL_MONGODB=1 \
    node --test tests/completion-mongoose-contract.test.js tests/stage7-mongoose-contract.test.js
  ```
- **Binary files cannot be written to your computer through this session's file bridge** — it converts line endings, which corrupts images. The three acceptance screenshots were therefore sent into the chat instead, and the corrupted copies were moved to `new-app/e2e/completion/_to_delete/` for you to delete.
- `new-app/frontend/src/pages/enquiries/enquiry.css` is **no longer used** (every page now uses the design system) and was removed in this working copy, but the bridge cannot delete files on your computer, so the dead file is still in your project. Safe to delete.

---

## 7. Defects found and fixed in the pre-existing design pass

The design pass that was already in the working copy had not been run. Checking it found:

1. **`UserManagement.jsx` referenced an undefined `roleOptions` inside the user modal** — creating or editing a user would have thrown. The modal is a separate component and was reading a variable from the list component's scope. Fixed by deriving the division-filtered role list inside the modal, and a browser check was added that opens modals so this class of defect is caught in future.
2. **Table rows ballooned to several times their height** wherever a row had more than two action buttons (worst on Payments), because the button row wrapped inside a narrow cell. Fixed in the design system: action rows inside a data table never wrap.

---

## 8. Files changed (74, all inside `new-app/`)

- **Backend (10):** `services/paymentService.js`, `services/projectService.js`, `services/salesOrderService.js`, `services/reportHeader.js` *(new)*, `routes/paymentRoutes.js`, `routes/projectRoutes.js`, and four test files.
- **Frontend (55):** the five design-system stylesheets *(new)* and `index.css`, `index.html`, the shell, `utils/divisions.js` and `utils/timeline.js` *(new)*, `pages/enquiries/EnquiryFilterPanel.jsx` *(new)*, `pages/projects/DeliveryChallanPanel.jsx` *(new)*, and the restyled/rebuilt screens across enquiries, projects, payments, sales orders, quotations, contracts, service, inventory, checklists, company, admin and users.
- **Docs (3):** `DESIGN_SYSTEM.md` *(new)*, this report *(new)*, and `FINAL_COMPLETION_ORDER_REPORT.md` updated so its gap table no longer claims these five items are open.
- **Acceptance harness (4):** `e2e/completion/{run.js, server.js, fixture.js, results.json}` — the fixture seeds realistic business data so the screens are actually exercised rather than rendering empty.

Every delivered file was verified byte-for-byte against this session's copy after writing.

---

## 9. Decisions that need your approval

1. **Stock shortage (carried over, still open).** The app refuses an issue that exceeds stock; the PWA silently clamped the location to zero. Preserved as-is per your instruction — please confirm the refusal is what you want.
2. **Projects list access.** Engineers and service engineers can now read only their own assigned projects, and sales/finance/inventory/service managers cannot read the projects list at all. This matches the PWA's menus, but it is a new server-side restriction — confirm no one in your team needs broader access.
3. **Lost Enquiries keeps two extra columns** (Lost Reason, Lost On) that the PWA shows only on the enquiry detail screen. They were already shipped and they are the point of the screen, so they are appended after the PWA's thirteen columns rather than removed.
4. **Printed delivery challan uses the brand blue** heading rule rather than the PWA's red, so it matches the quotation and AMC documents. Content and wording are unchanged.
5. **Report CSV filenames changed** to the PWA's date-stamped pattern (`payments-2026-10-13.csv`, `projects-HVAC-2026-10-13.csv`) and the files now open with the report preamble. If anything of yours consumes these files by name, it will need updating.

---

## 10. Confirmations

- No commit, no push, no deployment. Your repository's working tree holds the changes; `441b466` is still the last commit.
- Protected reference files untouched: root `index.html`, `MEP_PROJECTS_PWA/index.html`, and the V2/V3 copies.
- No production database, VPS, PM2 service, Nginx config, DNS, TLS or environment variable was read or changed. All testing used in-memory fakes or throwaway `mep_test_*` databases.
- No test was weakened. Four test expectations changed because the behaviour they asserted was corrected (CSV preamble rows, the counter list, the stock clamp becoming a refusal), and each change is documented in place. The two real-MongoDB checks are skipped with a stated reason, not deleted.
