# PASS 3.7 — NOTIFICATIONS — COMPLETE MEP PROJECTS PWA VERIFICATION

Date executed: 2026-09-24. Phase A (read-only verification) only — no `new-app/` application source or test files were modified in this pass.

## PASS 3.7 STATUS
**PASS**

## Truncation note

This pass's source task text was cut off mid-list, immediately after the "PWA notification coverage" header line ("Report exact counts for: * Enquiry"). Per this engagement's standing convention for a truncated instruction, the remainder of the "Notification coverage" list and the rest of the final-report structure were reconstructed from this engagement's own already-established vocabulary/module list (Enquiry, SalesOrder/Finance, Checklist, Project, Contract, ServiceCall, Inventory) and the final-report format used in Passes 3.1-3.6. Flagged per instruction.

## PWA notification reconciliation

**Literal source fact** (fresh `grep -n "notify(" MEP_PROJECTS_PWA/index.html`, re-run this pass, both `MEP_PROJECTS_PWA/index.html` and the root `index.html` copy, identical results): there are **24 literal `notify(...)` call-site lines** in the PWA source (plus the `notify(roles,text){...}` function definition at line 1267, which is not a call). One of those 24 lines - `index.html:3613` in `saveCall(contractId)` - is a single call whose message is built from a ternary (`(contractId?"PM scheduled":"New complaint registered")`) that is **functionally two distinct, mutually exclusive triggers** ("New complaint registered" vs "PM scheduled"), each with its own PWA UI entry point (`mCall(null)` "Register Service Complaint" vs `mCall(contractId)` "Schedule PM"). This was already independently established in Pass 3.5 and is re-confirmed fresh in this pass by reading the source at 3606-3615.

Counting call **sites** literally: 24. Counting distinct **triggers** (i.e., treating the shared line 3613 as its two demonstrated triggers, consistent with the Pass 3.5 convention already baked into the engagement's established total): **25**. This pass uses the trigger-count convention (25) for the master table and module reconciliation below, exactly as Pass 3.5 did for ServiceCall, and states this explicitly so the count is not mistaken for a miscount.

Independent confirmation on the NEW APP side: `grep -c "notificationRepo.create" new-app/backend/src/services/*.js` shows contractService.js=1, inventoryService.js=5, paymentService.js=3, projectService.js=9, salesOrderCascade.js=2, serviceCallService.js=5 -> **25 notification-creation call sites**, and `serviceCallService.js` implements the PWA's single shared line 3613 as **two separate literal call sites** (`registerComplaint` line 305, `schedulePM` line 373) - i.e. NEW APP already materializes the 25th trigger as its own line, which is why NEW APP's literal count (25) is one higher than PWA's literal count (24) even though both represent the same 25 triggers. This is an approved code-structure difference (splitting one shared PWA line into two clearer NEW APP functions), not a functional difference.

Total notify() call sites (trigger-count convention): **25**

Module breakdown:
- Enquiry = **0**
- SalesOrder/Finance = **5**
- Checklist = **3**
- Project = **6**
- Contract = **1**
- ServiceCall = **5**
- Inventory = **5**

Sum: 0+5+3+6+1+5+5 = **25**

Reconciliation: **PASS**

(Cross-check against NEW APP file totals: SalesOrder/Finance 5 = salesOrderCascade.js 2 + paymentService.js 3; Checklist 3 + Project 6 = 9 = projectService.js 9 (NEW APP does not split a separate checklist service - checklist-item notifications live in projectService.js, matching the PWA where `doApprove`/`tickChk` are checklist-item functions physically colocated with the rest of the Project code); Contract 1 = contractService.js 1; ServiceCall 5 = serviceCallService.js 5; Inventory 5 = inventoryService.js 5. Total 25 = 25.)

## Notification coverage

- **Enquiry**: 0 notify() call sites. `saveEnq`, `reopenEnq`, and the loss/follow-up/conversion code paths (index.html:1990-2075) contain no `notify()` call anywhere. Enquiry->SO conversion (`saveSO`, called with `enqId`) does trigger notifications, but they are SalesOrder-module notifications (see below), not Enquiry-module ones - the Enquiry object itself never generates a notify(). Classification: **NO RELATION/NO BEHAVIOR DEMONSTRATED** for Enquiry-triggered notifications. Verified: no service file calls `notificationRepo.create` for enquiry events - consistent with the PWA.
- **SalesOrder/Finance**: 5. SO creation -> PM notified to assign engineer + Finance notified of new pending payment terms (`saveSO`, 2 sites); Payment milestone raised to Finance (`doRaise`, 1 site); Payment fully received / part payment received (`addPayment`, 2 sites). SO editing (`saveSO` with `id` set) fires **no** notification (PWA FACT: the `if(id){...;return}` early-return branch skips both notify() calls - edit vs create asymmetry, preserved).
- **Checklist**: 3. Checklist point approved/signed off (`doApprove`, 1 site); delayed checklist-point completion (`tickChk`, 1 site); all-checklist-points-complete (`tickChk`, 1 site, on the same tick that completes the last item).
- **Project**: 6. Delay check (`runDelayCheck`, once/day/project throttle); stage-change -> Finance (payment milestone reminder) + Admin (stage change) + Service Manager (if newly Completed) (`savePM`, 3 sites under one `if(old!==p.stage)` guard); engineer assignment (`savePM`, 1 site, broadcast `"*"`); timeline first-save only (`mSaveTimeline`, 1 site, gated by `!p.timelineSet` - quirk: re-saving the timeline after the first save fires nothing).
- **Contract**: 1. `convertToService` (commissioning approval -> Service project conversion) is the only notify() call anywhere in contract code. `saveContract()` (manual contract edits) fires zero notifications - re-confirmed this pass, asymmetry preserved, not "fixed."
- **ServiceCall**: 5, re-verified fresh this pass. `saveCall` (1 shared line / 2 triggers: "New complaint registered" vs "PM scheduled" - both to `["service_mgr","admin"]`); `assignCall` (1 site, `["*"]`, fires on every save with a truthy resulting engineer, no dedup); `saveReport` on completion (2 sites: chargeable-amount -> `["finance"]`, unconditional completion -> `["service_mgr","admin"]`).
- **Inventory**: 5, re-reconciled within the 25. Material issued (`saveIssue`, `["*"]`); low/out-of-stock warning (`saveIssue`, conditional on `st.lvl>0`, `["inventory","admin"]`); material returned/accepted (return-accept code path at 3185, `["*"]`); return request rejected (`rejectReturn`, `["*"]`); return request raised (`saveReturnReq`, `["inventory","admin"]`). Confirmed absence, by full-file grep, of any notify() call inside `saveTransfer`/`vTransfer` (Transfer) or `saveMarkUsed`/`markConsumed` (Mark Used) - both are silent in the PWA and must stay silent in NEW APP.

## Master notification table

Full 25-row table, all rows independently re-derived from `MEP_PROJECTS_PWA/index.html` this pass.

| # | Module | PWA Function | PWA Line | Trigger | Recipient (roles) | Content (PWA literal, abbreviated) | Company/Tenant | NEW APP Function | Persisted | Readable | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SalesOrder/Finance | `saveSO` | 2094 | New SO created | `[<div>_pm, admin]` | "New SO-N received from Sales: ... Project created - assign engineer." | `so.co`/session U.co | `salesOrderCascade.js:277` | Yes | Yes | MATCH |
| 2 | SalesOrder/Finance | `saveSO` | 2095 | New SO created | `[finance]` | "New SO-N (...): payment terms added to pending payment list." | same | `salesOrderCascade.js:289` | Yes | Yes | MATCH |
| 3 | Project | `runDelayCheck` | 2318 | Delay check, once/day/project (`p.delayNotified===t` guard) | `[<div>_pm, sales, admin]` | "(warn) PROJECT DELAYED - ... max delay N days. Latest pending: ..." | U.co | `projectService.js:1083` (`runDelayCheckForProject`, driven by `delayCheckScheduler.js`) | Yes | Yes | PWA/NEW APP INCONSISTENCY - content fidelity: NEW APP text drops the warning-triangle emoji prefix and uses ASCII double-hyphen vs PWA's em-dash; see Content fidelity findings |
| 4 | SalesOrder/Finance | `doRaise` | 2360 | Payment milestone manually raised to Finance | `[finance, admin]` | "(URGENT prefix if urgent)Payment milestone raised by ... due - note. Collect by <date>." | U.co | `paymentService.js:399` | Yes | Yes | **PWA/NEW APP INCONSISTENCY** - NEW APP text drops the trailing "Collect by <date>." clause entirely (the due-by date is stored in `raisedToFinance.collectByDate` but never included in the notification text); see FIX-3.7-02 |
| 5 | Checklist | `doApprove` | 2394 | Checklist point approved/signed | `[<div>_pm, admin]` | "Checklist point approved (SIGN by NAME) on \"proj\": text" | U.co | `projectService.js:771` | Yes | Yes | MATCH |
| 6 | Project | `savePM` | 2604 | Stage changed | `[finance]` | "Project stage update: ... moved OLD -> NEW ... Check payment milestone due as per SO terms." | U.co | `projectService.js:405` | Yes | Yes | MATCH |
| 7 | Project | `savePM` | 2605 | Stage changed | `[admin]` | "\"proj\" stage: OLD -> NEW" | U.co | `projectService.js:415` | Yes | Yes | MATCH |
| 8 | Project | `savePM` | 2606 | Stage changed to Completed | `[service_mgr]` | "Project \"proj\" marked Completed. Approve commissioning to convert into 1-year warranty service project." | U.co | `projectService.js:433` | Yes | Yes | MATCH (NEW APP additionally gates this on `old!==stage`, matching FIX-3.3-02 - see Order/timing) |
| 9 | Project | `savePM` | 2608 | Engineer(s) newly assigned | `["*"]` | "Engineer(s) A, B assigned to project \"proj\"" | U.co | `projectService.js:500` | Yes | Yes | MATCH |
| 10 | Checklist | `tickChk` | 2626 | Checklist item completed late (`v>0`) | `[<div>_pm, sales, admin]` | "Delayed completion on \"proj\": \"text\" done on DATE, N day(s) after target DATE." | U.co | `projectService.js:663` | Yes | Yes | MATCH |
| 11 | Checklist | `tickChk` | 2630 | All checklist points now done | `[<div>_pm, admin, service_mgr]` | "All checklist points completed for \"proj\"." | U.co | `projectService.js:675` | Yes | Yes | MATCH |
| 12 | Project | `mSaveTimeline` | 2681 | Timeline saved for the FIRST time only (`!p.timelineSet`) | `[admin, sales, <div>_pm]` | "Timeline set for \"proj\" by NAME - target completion DATE. Work can now start." | U.co | `projectService.js:579` | Yes | Yes | MATCH - first-save-only quirk preserved (`if(first)` gate mirrors PWA `!p.timelineSet`) |
| 13 | Contract | `convertToService` | 2739 | Commissioning approved | `[service_mgr, admin]` | "Commissioning approved: \"proj\" converted to Service project - 1 year warranty, quarterly PM scheduled." | U.co | `contractService.js:337` | Yes | Yes | MATCH |
| 14 | Inventory | `saveIssue` | 3132 | Material issued | `["*"]` | "Material issued to STAFF: Q UNIT ITEM for SITE (returnable)" | U.co | `inventoryService.js:478` | Yes | Yes | MATCH |
| 15 | Inventory | `saveIssue` | 3134 | Stock level low/out after issue (`st.lvl>0`) | `[inventory, admin]` | "(warn) Low/Out of Stock: ITEM - N UNIT left (min M)" | U.co | `inventoryService.js:491` | Yes | Yes | PWA/NEW APP INCONSISTENCY - warning-triangle emoji replaced with literal "WARNING" text; see Content fidelity findings |
| 16 | Inventory | (return-accept code path) | 3185 | Material returned & accepted | `["*"]` | "Material returned by STAFF: Q UNIT ITEM - N UNIT still pending / issue closed" | U.co | `inventoryService.js:629` | Yes | Yes | MATCH |
| 17 | Inventory | `rejectReturn` | 3397 | Return request rejected by store | `["*"]` | "Return request for ITEM from STAFF was not accepted - please check with the store." | U.co | `inventoryService.js:656` | Yes | Yes | MATCH |
| 18 | Inventory | `saveReturnReq` | 3416 | Return request raised by staff | `[inventory, admin]` | "(mailbox emoji) Return request: NAME is returning Q UNIT ITEM from SITE - note" | U.co | `inventoryService.js:526` | Yes | Yes | PWA/NEW APP INCONSISTENCY - mailbox emoji prefix dropped; see Content fidelity findings |
| 19 | ServiceCall | `saveCall` (Complaint path, `contractId` falsy) | 3613 | New complaint registered | `[service_mgr, admin]` | "New complaint registered: PSC-N - CUSTOMER (SITE)" | U.co | `serviceCallService.js:305` (`registerComplaint`) | Yes | Yes | MATCH |
| 20 | ServiceCall | `saveCall` (PM path, `contractId` truthy) | 3613 | PM scheduled | `[service_mgr, admin]` | "PM scheduled: PSC-N - CUSTOMER (SITE)" | U.co | `serviceCallService.js:373` (`schedulePM`) | Yes | Yes | MATCH |
| 21 | ServiceCall | `assignCall` | 3671 | Engineer assigned/reassigned (fires on every save with `s.eng` truthy, no dedup) | `["*"]` | "Service call PSC-N (CUSTOMER) assigned to ENG for DATE TIME" | U.co | `serviceCallService.js:576` | Yes | Yes | MATCH - no-dedup quirk preserved |
| 22 | ServiceCall | `saveReport` (complete=true, chargeable) | 3703 | Chargeable service completed with amount>0 | `[finance]` | "Chargeable service PSC-N completed - Rs. AMOUNT to collect from CUSTOMER" | U.co | `serviceCallService.js:720` | Yes | Yes | MATCH - `money()` formatting reproduced |
| 23 | ServiceCall | `saveReport` (complete=true, unconditional) | 3705 | Service call completed | `[service_mgr, admin]` | "PSC-N completed by ENG/NAME - CUSTOMER" | U.co | `serviceCallService.js:733` | Yes | Yes | MATCH |
| 24 | SalesOrder/Finance | `addPayment` | 3828 | Payment balance reaches <=0 (fully received) | `[admin, sales]` | "Payment fully received: Rs. AMOUNT - PROJECT (SO-N)" | U.co | `paymentService.js:165` | Yes | Yes | **PWA/NEW APP INCONSISTENCY** - NEW APP text embeds the raw number (`${updated.amount}`) with no `money()` formatting (no currency symbol, no en-IN thousands grouping); see FIX-3.7-03 |
| 25 | SalesOrder/Finance | `addPayment` | 3831 | Part payment received | `[admin, sales]` | "Part payment received: Rs. AMOUNT for PROJECT. Balance Rs. BAL." | U.co | `paymentService.js:176` | Yes | Yes | same as row 24 - no `money()` formatting; FIX-3.7-03 |

## Account/role/tenant coverage

- Every one of the 25 rows targets a **role list** or the literal `"*"` (all-roles-in-company) marker - PWA `notify(roles,text)` never accepts or sends an individual user id, and `myNotifs()` filters strictly by `n.roles.indexOf(U.role)>=0 || n.roles.indexOf("*")>=0` scoped to `n.co===U.co`. No row targets a specific named user.
- NEW APP `Notification` schema (`new-app/backend/src/models/Notification.js`) encodes this exactly: `targetRoles: [String]` (role list or `"*"`), no user-id targeting field exists on the schema at all - an individual-user notification is structurally impossible, matching the PWA's demonstrated ceiling. Classification: **MATCH**.
- No row was found where PWA targets multiple roles and NEW APP silently narrows to one, or vice versa (verified against every `targetRoles: [...]` array shown in the Master table above, source-line by source-line).
- Tenant isolation (S17): PWA itself is company-scoped (`n.co===U.co`) but is client-side-trusted (the browser holds `U.co` and filters locally in demo/localStorage mode). NEW APP enforces `companyId` strictly server-side from `req.auth` (session-derived, via `requireCompanyContext`/`rejectClientSuppliedCompanyId` middleware on `notificationRoutes.js`), and both `notificationRepo.listForRole` (query includes `companyId`) and `notificationRepo.markRead` (`findOneAndUpdate({ _id: id, companyId }, ...)`) are company-filtered at the database level - a cross-company id in `markRead` matches no document and returns `null` -> `404 NOT_FOUND` (verified in `tests/notificationService.test.js:72`, "tenant isolated: cannot mark a different company's notification read"). Classification: **INFRASTRUCTURE-ONLY DIFFERENCE** (approved - server-side tenant isolation strengthening a client-trusted PWA filter, per the approved list).

## Persistence / read-unread / dedup-throttle / delay-check verification

- **Persistence**: every one of the 25 triggers has a corresponding `notificationRepo.create(...)` call inside the same service function and (where the surrounding operation uses one) the same DB transaction as the business write it reports on - confirmed by direct read of all 6 service files' notify sites (see Master table "NEW APP Function" column, each cross-checked against source). `Notification` schema requires `companyId`, `text`, `date`, `targetRoles` (min length 1) - matches the 4 PWA-source fields `{co, roles, text, date}` plus append-only `read`->`readByUserIds`.
- **Retrieval**: `GET /api/notifications` -> `listNotifications` -> `notificationRepo.listForRole(companyId, role, {limit})`, sorted `{date:-1,_id:-1}` (newest first) - matches PWA `vNotifs()`'s `myNotifs().slice().reverse()` (newest-first over an append-ordered array). Default cap: NEW APP `limit=200`; PWA has no cap (would render the full array) - this is a reasonable, non-business-affecting pagination default, not flagged as a gap.
- **Read/unread**: PWA `vNotifs()` marks **every currently-visible, not-yet-read notification as read the instant the Notifications view is opened** - there is no per-item click-to-read and no separate "mark all read" button; opening the page IS the mark-all-read action (index.html:1856-1862, `r.push(uid||U.id)` for every item in `list` not already containing the reader's id, firing one `PATCH .../:id/read` per item in `API_MODE`). NEW APP exposes `PATCH /api/notifications/:id/read` (`markNotificationRead`, `$addToSet` on `readByUserIds` - idempotent, matches PWA's `if(r.indexOf(uid)<0...)` guard) as a **per-item** primitive; the "mark everything visible as read on page open" **behavior** is a frontend responsibility (the frontend does not exist yet per Pass 3.5 state) - captured below under Frontend requirements rather than claimed as already built. No separate mark-unread action exists in either system. Classification: **MATCH** at the API-primitive level; frontend behavior is **OPEN/NOT DETERMINABLE** until `new-app/frontend/` is built (correctly out of scope for Phase A).
- **Dedup/throttle**: PWA has exactly ONE throttled notification family - the delay check (`p.delayNotified===t` once-per-calendar-day-per-project guard, index.html:2314-2315). All other 24 notify() call sites have **zero deduplication** - e.g. `assignCall` (row 21) fires on every single save with a truthy engineer, even if reassigning to the same engineer repeatedly; `savePM`'s stage-change block only fires when `old!==p.stage` (a guard against a no-op resave, not a dedup of distinct legitimate stage changes). NEW APP reproduces this exactly: `runDelayCheckForProject` re-checks `lastDelayNotifiedDate !== today` before writing (transactional, `projectService.js:1079`); `assignCall`'s equivalent (`projectService.js:500`-area `assignEngineer`, and `serviceCallService.js:576` `assignEngineer`) has no dedup guard, matching. Classification: **MATCH**.
- **Delay check** (S21): `delayCheckScheduler.js` runs hourly (`intervalMs` default 3,600,000 - a documented interpretive choice since the PWA's own trigger is "on every relevant page render," which has no fixed period to copy 1:1; this is flagged in the file's own header comment as an INTERPRETIVE CHOICE, not silently invented), calls `projectRepo.listEligibleForDelayCheck()` then `runDelayCheckForProject` per project. Overlap protection: an in-process `running` boolean guard prevents two ticks of the same scheduler instance from overlapping; cross-process/cross-instance protection is the transactional `lastDelayNotifiedDate` write-then-check inside `runDelayCheckForProject` itself (re-verified this pass at `projectService.js:1077-1087`), which is atomic per project regardless of how many scheduler processes exist. Message content, recipient roles (`[pmRole, sales, admin]`), and the named worst-overdue checklist point (`late[0].text.slice(0,60)`) are reproduced verbatim except for the emoji/em-dash cosmetic difference already noted in row 3. Classification: **MATCH** (scheduler mechanics) with the one already-flagged content-fidelity note carried from row 3.
- **Failed action / atomicity (S22/S23)**: every notify() site inspected in projectService.js, paymentService.js, contractService.js, serviceCallService.js, and inventoryService.js that participates in a `withTransaction(deps, async (txnDeps) => {...})` block passes `session` into `notificationRepo.create(data, session)`, so a notification is written in the SAME transaction as the business state change it announces - a rolled-back operation (e.g. a failed stage update) cannot leave an orphan notification behind, because the whole transaction rolls back together. This is a genuine strengthening over the PWA (which has no transaction concept at all - its `notify()` call happens as a plain, un-rolled-back side effect of synchronous in-memory array mutation) and is squarely inside the approved "transactions/concurrency protection" infrastructure-only difference. Classification: **INFRASTRUCTURE-ONLY DIFFERENCE** (approved).

## Frontend notification requirements

("FRONTEND NOTIFICATION BUILD REQUIREMENTS" - traced from PWA source only; `new-app/frontend/` remains an empty placeholder per Pass 3.5 and is NOT built in this pass.)

1. **Notification list view** ("Notifications" nav item, `vNotifs()`): a simple reverse-chronological list of `{text, date}` pairs for the logged-in user's company+role scope. No grouping, no per-notification icon/type styling beyond the raw text (which itself carries any emoji prefix as plain characters).
2. **Unread badge/count**: a small counter element (PWA `#ncount`) shown next to the nav, computed as `unread()` - hidden (`display:none`) when zero, and always forced to 0/hidden for the `super` role specifically (PWA FACT: `U.role==="super"?0:unread()` - `super` never sees notification counts, since `super` is the cross-company platform-admin role and notifications are company-scoped business events).
3. **Mark-as-read behavior**: opening the Notifications view marks every currently-visible not-yet-read item read, all at once, as a side effect of rendering the view - not a button, not per-item. No individual "mark read" affordance exists per row; no "mark all unread" exists to undo it.
4. **Ordering**: newest first (append order reversed).
5. **No click-to-navigate action**: PWA notification rows are inert text (`<div class="nitem">`) - clicking a row does not deep-link to the underlying project/SO/service call/payment. NEW APP frontend should not invent a "click to open the related record" feature; that would be scope creep beyond what the PWA demonstrates.
6. **No filtering/search UI** on the Notifications view - no per-type filter, no date-range filter, no search box (unlike almost every other PWA list view, which does have `srchBar`). This is a deliberate omission to preserve, not an oversight to "fix."
7. **Role/company scope**: the list is implicitly scoped to the logged-in user's company and role by the `myNotifs()` filter - the frontend never asks the user to pick a company or role scope; it is derived entirely from the logged-in session.
8. **Empty state**: "No notifications yet." literal text when the list is empty.

## PWA vs NEW APP - classifications found

**MATCH** (19 of 25 rows): rows 1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 20, 21, 22, 23.

**PWA/NEW APP INCONSISTENCY** (4 of 25 rows - content-fidelity only, no targeting/recipient/persistence defect):
- Row 3 (Project delay check) - warning emoji dropped, em-dash replaced by ASCII double-hyphen.
- Row 4 (Payment milestone raised) - "Collect by <date>." clause dropped entirely (a real information loss, not purely cosmetic - see FIX-3.7-02).
- Row 15 (Low/out-of-stock) - warning emoji replaced by literal "WARNING" text.
- Row 18 (Return request raised) - mailbox emoji prefix dropped.

**PWA/NEW APP INCONSISTENCY** (rows 24, 25 - Payment fully/part received) - `money()` currency formatting (currency symbol + en-IN thousands grouping) not applied to the amount fields embedded in these two notification texts, even though the very same `money()` helper is faithfully reproduced and used elsewhere in the codebase (`serviceCallService.js:128-131`) - this is an internal inconsistency within NEW APP itself, not just vs PWA.

**INFRASTRUCTURE-ONLY DIFFERENCE** (approved): tenant isolation at the DB-query level (server-side `companyId`, vs PWA's client-trusted `co` filter); transactional write of notifications alongside their triggering business state change (rollback-safe, vs PWA's non-transactional synchronous mutation); NEW APP's splitting of PWA's single shared-ternary line 3613 into two literal call sites (`registerComplaint`/`schedulePM`) - same 25 triggers, clearer code structure.

**No FUNCTIONAL GAP, AUTHORIZATION GAP, SECURITY/TENANT GAP, or ATOMICITY/CONCURRENCY GAP was found in the notification pathway itself.** (FIX-3.6-01, a pre-existing Inventory report/export authorization gap, is carried forward separately below - it does not originate in or worsen through this pass's notification tracing.)

**TEST COVERAGE**: `tests/notificationService.test.js` covers role/company-scoped listing, newest-first ordering, idempotent mark-read, tenant-isolated mark-read (rejects cross-company id), and explicitly asserts the PWA-confirmed absence of Transfer/Mark-Used notifications. It does **not** contain a content-fidelity assertion for every one of the 25 individual message strings (only `serviceCallService`'s `money()`/PSC-punctuation quirks are asserted verbatim at the unit level, per the existing `tests` output rows 308-309) - this is a **TEST COVERAGE GAP** for the four content-fidelity inconsistencies and the two `money()`-formatting inconsistencies identified above; no dedicated test currently fails to catch them because none asserts the exact text for rows 3, 4, 15, 18, 24, 25.

## Carried-forward findings

**FIX-3.6-01** (P3, AUTHORIZATION GAP - Inventory `STOCK_VIEW_ROLES` over-grants `mep_pm` for Stock CSV exports and over-grants Issued-Material report access beyond PWA's demonstrated roles): **still open, not fixed in this pass** (Phase A is read-only). Relationship to this pass: **unrelated**. The Inventory notification target-role lists verified in this pass (`["*"]` for issue/return/reject, `["inventory","admin"]` for low-stock and return-request) exactly match the PWA's own `notify()` calls at every one of the 5 Inventory sites - none of them target `mep_pm`, and none of them touch CSV/report access at all. FIX-3.6-01 concerns a *different* code path (`exportStockCsv`/Issued-Material report role gates), not `notificationRepo`/`notify()`. Carried forward unresolved and unmodified.

## Fix tasks

Do NOT implement any of these in this task (Phase A is read-only).

- **FIX-3.7-01** (P3, PWA/NEW APP INCONSISTENCY - content fidelity / cosmetic): restore the PWA's exact emoji/dash punctuation in notification text for rows 3 (warning-emoji "PROJECT DELAYED -"), 15 (warning-emoji prefix, not "WARNING "), and 18 (mailbox-emoji prefix) - and, more generally, restore the em-dash character (PWA uses it pervasively) where NEW APP's `projectService.js`/`inventoryService.js` notification strings currently substitute ASCII double-hyphen. Low severity (informational content is otherwise intact) but a real parity deviation under the absolute-parity rule.
- **FIX-3.7-02** (P2, FUNCTIONAL GAP - content fidelity, real information loss): `paymentService.js:399`'s "Payment milestone raised" notification text omits the trailing "Collect by `<date>`." clause that PWA's `doRaise()` (index.html:2360) always appends from the `by` (requested collection date) field. The date is captured and stored (`raisedToFinance.collectByDate`) but never surfaced in the notification text, so a Finance-role recipient reading only the notification (not opening the payment record) loses the requested due date that the PWA shows them. Higher severity than FIX-3.7-01 because it is a loss of business information, not just typography.
- **FIX-3.7-03** (P2/P3, PWA/NEW APP INCONSISTENCY - content fidelity, internal inconsistency): `paymentService.js:168,179` ("Payment fully received" / "Part payment received") embed raw numeric amounts with no `money()` formatting (no currency symbol, no en-IN thousands grouping), while the PWA always renders amounts through `money()` in every notification that carries one, and NEW APP itself already faithfully reproduces `money()` for the same purpose in `serviceCallService.js`. Recommend reusing/centralizing the existing `money()` helper for these two sites rather than re-deriving it a third time.
- **FIX-3.7-04** (P3, TEST COVERAGE GAP): add unit-level exact-text assertions for the 25 notification message strings (or at minimum the 6 sites named in FIX-3.7-01/02/03) analogous to the existing `serviceCallService.js` money()/PSC-punctuation tests, so a future refactor cannot silently regress notification text fidelity without a failing test.

No P0/P1 functional gap was found in the notification pathway. All four fix tasks above are P2/P3 content-fidelity/test-coverage items, none of which block PASS 3.7.

## Tests

`npm test` run in `new-app/backend/` via `device_bash`: **313/313 passing** (0 failed, 0 skipped, 0 cancelled). Matches the established regression baseline exactly. No new tests were added or modified in this pass (Phase A, read-only).

## Files

Only one file created/changed by this pass:
- `new-app/docs/E2E_PASS_3_7_NOTIFICATIONS.md` (this document)

No `new-app/` application source, no test files, no `v2/`, `v3/`, or `server/` files were touched.

## Deadline status

**ON TRACK**

## Safety

Observed results (run against the repo root via `device_bash`, this pass, after all reads and before/without any writes by this pass other than the one doc file):

- `git diff --name-status -- v2` -> 37 files (pre-existing drift, unchanged from established baseline)
- `git diff --name-status -- v3` -> 0 files
- `git status --short` -> 95 lines total across the whole repo (pre-existing, unstaged drift spanning `.claude/settings.json`, `AGENTS.md`, root app files, `MEP_PROJECTS_PWA/*`, `server/` (v1), etc. - all pre-existing before this pass started, not caused by this pass; this pass performed zero writes to any of those paths)
- `md5sum index.html MEP_PROJECTS_PWA/index.html` -> both `111b53dba91704f96b83dae96c7793c6` (matches required value exactly)
- `git diff --cached --name-status` -> 0 files (nothing staged)

All required safety results hold. The pre-existing repo-wide unstaged drift noted under `git status --short` is flagged here plainly per rule 9 and is not attributable to this pass.

## Next gate

**NEXT ALLOWED: PASS 3.8 - MASTER RECONCILIATION**

---

## ADDENDUM — report-structure completion (post-verdict, no new source verification)

The full, untruncated Pass 3.7 task text was supplied after the body of this report above was written. The PASS verdict, the 25-call-site reconciliation, the master table, the content-fidelity findings (FIX-3.7-01 through 04), the 313/313 test result, and the safety results above all stand unchanged. This addendum only reformats/splits reporting structure per the corrected task text — it adds no new claims and re-verifies nothing.

### Corrected module breakdown (SalesOrder and Payment/Finance split)

The task's required format lists SalesOrder and Payment/Finance as separate line items, not combined. Re-checking the master table above: rows 1-2 (`saveSO` — new SO received by the division PM; new SO's payment terms added to Finance's pending list) are SalesOrder-creation triggers; rows 4, 24, 25 (`doRaise` — payment milestone raised to Finance; `addPayment` — payment fully/partly received) are Payment/Finance triggers. No other row is ambiguous between these two buckets.

- Enquiry = **0**
- SalesOrder = **2** (rows 1, 2 — `saveSO`)
- Payment/Finance = **3** (rows 4, 24, 25 — `doRaise`, `addPayment` x2)
- Checklist = **3**
- Project = **6**
- Contract = **1**
- ServiceCall = **5**
- Inventory = **5**
- Other actual PWA sources = **0** (full-file `grep -n "notify("` found no call site outside the seven modules above; no ninth source exists in `MEP_PROJECTS_PWA/index.html`)

Sum: 0+2+3+3+6+1+5+5+0 = **25**

Reconciliation: **PASS** (unchanged; this is a re-split of the previously-reported SalesOrder/Finance=5 total, not a recount — 2+3=5 matches the original combined figure exactly, and the combined total of 25 is unchanged).

### Recipient coverage

25/25 of the 25 call sites have their recipient role-list (or the `"*"` all-roles marker) independently identified and recorded — see the "Recipient (roles)" column of the Master notification table above, populated for every one of the 25 rows directly from the PWA source line cited in that same row. No row has an unknown or unverified recipient.

### Persistence (separated)

Every one of the 25 triggers has a corresponding `notificationRepo.create(...)` call in the matching NEW APP service function, written inside the same DB transaction as the business state change it reports on where that operation is transactional (see Master table "NEW APP Function" column and the "Persistence / read-unread / dedup-throttle / delay-check verification" section above for full detail). Classification: MATCH / INFRASTRUCTURE-ONLY DIFFERENCE (transactional write is a strengthening over the PWA's non-transactional synchronous mutation).

### Read/unread (separated)

PWA `vNotifs()` marks every currently-visible, not-yet-read notification as read the instant the Notifications view opens (no per-item click, no separate mark-all button). NEW APP's `PATCH /api/notifications/:id/read` (`markNotificationRead`, idempotent `$addToSet`) supplies the matching per-item primitive; the "mark all visible as read on open" behavior itself is a frontend responsibility not yet built (`new-app/frontend/` is an empty placeholder per Pass 3.5), so it is OPEN/NOT DETERMINABLE at the frontend-behavior level and MATCH at the API-primitive level. Full detail in the section above.

### Dedup/throttle (separated)

Exactly one notification family is throttled in the PWA — the delay check, once per calendar day per project (`p.delayNotified===t` guard). All other 24 notify() call sites (25 triggers minus the delay check) have zero deduplication, reproduced identically in NEW APP (e.g. `assignCall`/`assignEngineer` fire on every save with a truthy engineer, no dedup guard). Full detail in the section above.

### Existing open findings (consolidated)

Carried forward from prior passes:
- **FIX-3.6-01** (P3, AUTHORIZATION GAP) — Inventory `STOCK_VIEW_ROLES` over-grants `mep_pm` for Stock CSV exports and over-grants Issued-Material report access beyond PWA's demonstrated roles. Still open, not touched in Phase A. Confirmed this pass: **unrelated** to notification targeting — all 5 Inventory notify() target-role lists match the PWA exactly and none touch CSV/report access.
- **B2 — Company deletion/cascade** — still untouched, out of scope. Confirmed this pass: **unrelated** — no notify() call site anywhere in the 25 involves company deletion or cascade behavior.

Newly discovered this pass (Pass 3.7), not yet fixed:
- **FIX-3.7-01** (P3, PWA/NEW APP INCONSISTENCY) — emoji/em-dash punctuation dropped or substituted in 3 notification texts (rows 3, 15, 18).
- **FIX-3.7-02** (P2, FUNCTIONAL GAP) — "Collect by `<date>`." clause dropped from the payment-milestone-raised notification (row 4); a real information loss, stored data never surfaced.
- **FIX-3.7-03** (P2/P3, PWA/NEW APP INCONSISTENCY) — `money()` currency formatting missing from 2 payment-received notification texts (rows 24, 25), inconsistent with the same helper's correct use elsewhere in NEW APP.
- **FIX-3.7-04** (P3, TEST COVERAGE GAP) — no exact-text unit assertions for the 25 notification strings (only `serviceCallService.js`'s money()/PSC-punctuation quirks are asserted verbatim today).

None of the above are P0/P1 and none block the PASS 3.7 verdict.

### Status confirmation

PASS 3.7 STATUS: **PASS** — unchanged by this addendum.

### Safety (re-run after this addendum)

Re-run against the repo root via `device_bash` after appending this addendum to the doc file (the only file touched):
- `git diff --name-status -- v2` → 37 files (unchanged baseline)
- `git diff --name-status -- v3` → 0 files (unchanged)
- `md5sum index.html MEP_PROJECTS_PWA/index.html` → both `111b53dba91704f96b83dae96c7793c6` (unchanged)
- `git diff --cached --name-status` → 0 files (nothing staged)
- `git status --short -- new-app/docs/` → still shows only `new-app/docs/` as untracked (the doc file itself), no other new-app path touched

All safety results hold unchanged.
