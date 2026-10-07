# E2E PASS 3.4 — PROJECT → CONTRACT/WARRANTY → PM SERVICE

Phase A read-only verification. Repo: C:\Projects\MEP-Projects. PWA source of truth: `MEP_PROJECTS_PWA/index.html` (md5 111b53dba91704f96b83dae96c7793c6, root `index.html` copy identical).

## PASS 3.4 STATUS
**PASS**

## Notification count reconciliation (pre-flight)

Re-derived directly from `MEP_PROJECTS_PWA/index.html` — every `notify(` call site (25 total in the whole PWA), filtered to Contract-creating code and ServiceCall (`DB.svcCalls`) code.

### Contract module

| # | PWA Function | File:Line | Trigger | Recipients | Content |
|---|---|---|---|---|---|
| 1 | `convertToService(id)` | index.html:2739 | Service Manager/Admin approves commissioning; Contract record pushed to `DB.contracts` immediately before this call | `["service_mgr","admin"]` | `Commissioning approved: "<project>" converted to Service project — 1 year warranty, quarterly PM scheduled.` |

`saveContract()` (manual AMC/Warranty path, index.html:3758-3766) contains **zero** `notify(` calls — verified by reading the full function body; no notify appears between `function saveContract(){` and its closing brace.

**Contract count = 1** (source-derived; manual creation path is asymmetrically silent — a DO-NOT-FIX PWA quirk).

NEW APP evidence: `new-app/backend/src/services/contractService.js:337` — exactly one `txnDeps.notificationRepo.create(...)` call, inside `convertProjectToContract`, matching text and target roles. `createManualContract` has no notification call. **MATCH.**

### ServiceCall module

| # | PWA Function | File:Line | Trigger | Recipients | Content |
|---|---|---|---|---|---|
| 1 | `saveCall(contractId)` — complaint branch | index.html:3613 | New walk-in complaint registered (`contractId` falsy) | `["service_mgr","admin"]` | `New complaint registered: PSC-<psc> — <customer> (<site>)` |
| 2 | `saveCall(contractId)` — PM branch | index.html:3613 (same line, ternary) | PM visit scheduled against a Contract (`contractId` truthy) | `["service_mgr","admin"]` | `PM scheduled: PSC-<psc> — <customer> (<site>)` |
| 3 | `assignCall(id)` | index.html:3671 | Engineer assigned/reassigned to a Service Call (fires whenever resulting `s.eng` is truthy, no dedup) | `["*"]` | `Service call PSC-<psc> (<customer>) assigned to <eng> for <date> <time>` |
| 4 | `saveReport(id,true)` — chargeable branch | index.html:3703 | Completion with `report.stype==="Chargeable" && report.amount>0` | `["finance"]` | `Chargeable service PSC-<psc> completed — <money> to collect from <customer>` |
| 5 | `saveReport(id,true)` — unconditional | index.html:3705 | Every completion, regardless of type/amount | `["service_mgr","admin"]` | `PSC-<psc> completed by <eng or actor name> — <customer>` |

**Literal PWA call-site count = 4** (line 3613 is a single ternary-driven `notify(` call shared by two distinct trigger events — complaint registration vs PM scheduling — which differ in recipient-visible text and business trigger). **Distinct-event/trigger count = 5.**

**Reconciled ServiceCall count = 5** (by distinct notification-worthy trigger, which is what "count per module" must mean for parity purposes — two different business events sharing one JS call site are still two notifications a user receives). This corrects the previously-documented "ServiceCall = 4" (which undercounted by collapsing the two `saveCall` branches into one) and confirms the "fresh grep-based derivation: ServiceCall = 5" as correct once branch-splitting is accounted for.

NEW APP evidence: `new-app/backend/src/services/serviceCallService.js` — `notificationRepo.create` at lines 305 (register-complaint branch), 373 (PM-scheduled branch), 576 (assignment), 720 (chargeable/finance), 733 (unconditional completion) = **5 calls**, one per distinct PWA-demonstrated trigger. **MATCH** (NEW APP correctly implements the two `saveCall` branches as two separate notification calls rather than collapsing them, which is the more literal representation of the two distinct PWA-visible messages).

### Reconciliation verdict
**Contract = 1, ServiceCall = 5** is the correct, source-derived count. The earlier "Contract = 2" documentation was not reproducible from source (no second Contract-tied notify call exists anywhere in the PWA) and is DOCUMENTATION GAP — corrected here. "ServiceCall = 4" underenumerated distinct triggers; corrected to 5.

---

## Workflow coverage

### 1. Project → Contract/Warranty entry path
- PWA: conversion banner/button rendered only when `p.status==="Completed" && p.div!=="MEP"` (index.html:2189-2196), and only for `U.role==="service_mgr"||U.role==="admin"`. Action: `convertToService(id)` (index.html:2732-2745).
- MEP is doubly excluded: MEP's terminal `STAGES.MEP` value is literally `"Delivered"` (index.html:231), never the string `"Completed"`; `savePM()`'s completion gate (`if(p.stage==="Completed"&&p.status!=="In Service")`, index.html:2593) therefore can never set `p.status="Completed"` for an MEP project, so the conversion banner's `div!=="MEP"` check is a second, redundant safety net. Both facts re-verified directly from source this pass.
- NEW APP: `projectService.isEligibleForServiceConversion` (projectService.js:1273) = `status==='Completed' && division!=='MEP'`; `contractService.convertProjectToContract` (contractService.js:273-350) re-checks this and gates the actor role to `admin`/`service_mgr` (contractService.js:291-294). **MATCH.**
- Duplicate conversion: PWA has no guard against converting the same Project twice (two independent `DB.contracts.push` calls would result). NEW APP: `convertProjectToContract` has no duplicate-guard either (explicit Decision 9 in-code comment, contractService.js:98-99, re-verified: no query for an existing `originatingProjectId` exists anywhere in the function). **MATCH (INFRASTRUCTURE-ONLY: none needed, PWA quirk preserved).**
- Fields copied: `customer` (`p.customer||p.name`), `site` (`p.name`), `cap`→`capacity`, `fromProject`→`originatingProjectId`. Fields NOT copied: `phone`/`email` hardcoded to `""` (index.html:2737; contractService.js:329-330) — confirmed PWA quirk, preserved exactly.
- Defaults: `start=today()`, `end=start+1yr-1day`, `amcType="Quarterly"`, `cat="Warranty"`, `amount=0`, 4 quarterly visits. Project status after conversion: `"In Service"` (unconditional, no re-check).

### 2. MEP/non-MEP behavior
PWA behavior traced above (§1). NEW APP reproduces identically via `isEligibleForServiceConversion`. **MATCH** — no generalized division rule introduced; the exclusion is literally MEP-named, matching PWA's own `div!=="MEP"` string check.

### 3. Contract field-by-field parity

| PWA Field | Source (conversion / manual) | Copied From | NEW APP Field | Write Path | Read Path | Match |
|---|---|---|---|---|---|---|
| `customer` | `p.customer\|\|p.name` / `gv("ct_n")` | Project / form | `customer` | contractService.js:329 / :253 | contractRepo.findById | MATCH |
| `phone` | `""` / `gv("ct_p")` | none / form | `phone` | :330 / :254 | same | MATCH (incl. blank quirk) |
| `email` | `""` / `gv("ct_e")` | none / form | `email` | :331 / :255 | same | MATCH |
| `site` | `p.name` / `gv("ct_s")` | Project / form (required) | `site` | :332 / :249-252 | same | MATCH |
| `cap` | `p.cap` / `gv("ct_c")` | Project / form | `capacity` | :333 / :256 | same | MATCH |
| `start` | `today()` / `gv("ct_sd")\|\|today()` | — | `startDate` | :327 / :246 | same | MATCH |
| `end` | `start+1yr-1day` / `gv("ct_ed")` (no fallback, may be blank) | — | `endDate` | :328 / :247 | same | MATCH incl. null-blank quirk (Decision 8 storage note) |
| `amcType` | `"Quarterly"` / `gv("ct_t")` | — | `amcType` | :330(hardcode)/:248 | same | MATCH |
| `cat` | `"Warranty"` / `gv("ct_cat")` | — | `category` | :334(hardcode)/:250 | same | MATCH |
| `amount` | `0` / `Number(gv("ct_a"))\|\|0` | — | `amount` | :335(hardcode)/:257 | same | MATCH |
| `svcs[]` | generated per amcType | — | `scheduledVisits[]` | generateScheduledVisits() | same | MATCH |
| `fromProject` | `p.id` / absent (0) | Project.id | `originatingProjectId` | :336 / null | same | MATCH |
| status (derived) | `contractStatus(c)` (not stored) | — | `computeContractStatus()` (not stored) | derived read-time | derived | MATCH |
| company | `co:U.co` | session | `companyId` | actorAuth.companyId (session-derived, never client-supplied) | tenant filter | INFRASTRUCTURE-ONLY DIFFERENCE (session-enforced tenant isolation vs PWA's client-held `U.co`) |
| id/identifiers | `DB.seq.contract++` | in-memory counter | Mongo `_id` + no separate display number (PWA has none either — Decision 13) | counterRepo not used for Contract (Mongo ObjectId) | — | MATCH (PWA never displays a Contract number either) |

No additional fields exist on either side beyond the above — verified against both `DB.contracts.push({...})` call sites and the `Contract` write shape in contractService.js.

### 4. Contract creation defaults
Verified above — reproduced exactly, including the asymmetry between the two creation paths (conversion hardcodes `amount=0,cat=Warranty,amcType=Quarterly`; manual path takes all four from the form with `Quarterly`/`AMC` as the `<select>`'s first `<option>` — i.e. the browser's default-selected option, reproduced in contractService.js:246/248 as `input.amcType || 'Quarterly'` / `input.category || 'AMC'`). **MATCH.**

### 5. Manual Contract/AMC path
PWA: `mContract()`/`saveContract()` (index.html:3748-3766), reachable from the PM/AMC list view; only client-side validation is non-empty `site`; zero notifications; no relation to Project or ServiceCall (`fromProject` absent); no Payment interaction. NEW APP: `createManualContract` (contractService.js:227-266) reproduces the single site-required validation, zero notifications, `originatingProjectId: null`, no Payment write. Role gate: PWA has **no** server-side/menu-role check visible in source for who can reach `mContract()` beyond general menu visibility; NEW APP adds `assertCanManageContracts` (admin/service_mgr) as the approved authorization-parity infrastructure exception (server-side enforcement of the PWA's own *visible* intent — the AMC/PM list and its buttons are only ever rendered for those roles in the surrounding view code). **INFRASTRUCTURE-ONLY DIFFERENCE**, not a functional gap.

### 6. Contract status
PWA `contractStatus(c)` (index.html:1439-1445): `Expired` if `c.end<today`; else `Expiring Soon` if `today>=end-45days`; else `Active`. Blank `end` (empty string) sorts before any real date, so it is always `Expired`. NEW APP `computeContractStatus` (contractService.js:194-208) reproduces this exactly, with a `null` endDate (the Mongo-necessary representation of a blank string, per Decision 8) treated as unconditionally before any real date → `Expired`. **MATCH.**

### 7. Contract PM cadence

| Cadence | Visits | Interval | First slot | Subsequent | Source |
|---|---|---|---|---|---|
| Monthly | 12 | 1 month | start month | start+1mo, +2mo, ... | index.html:3760 `n=12,step=1`; contractService.js `generateScheduledVisits` n=12/step=1 |
| Half-Yearly | 2 | 6 months | start month | start+6mo | index.html same line, `n=2,step=6` |
| Quarterly (incl. unrecognized amcType fallback) | 4 | 3 months | start month | start+3,6,9mo | index.html ternary fallback branch; NEW APP fallback branch (any non-Monthly/Half-Yearly value → 4/3) |

Conversion path always uses Quarterly (hardcoded), regardless of division/capacity/value. **MATCH.**

### 8. PM due logic
PWA `pmDue(c)` (index.html:1434-1438): a scheduled-visit index is due iff `!s.done && s.m<=thisMonth()` (string comparison of `"YYYY-MM"`). Independent of `contractStatus` — an Expired contract's overdue visits remain due forever (no filtering by status anywhere in `pmDue` or its callers `pmDuePanel`/`dlContracts`). NEW APP `computePmDueIndexes` (contractService.js:214-222) reproduces this exactly (string comparison, no status filter). Re-verified: `getPmDuePanel` (contractService.js:394-413) does not filter by `computeContractStatus`. **MATCH — Expired contracts still surface PM-due rows (DO NOT FIX preserved).**

### 9. Contract → ServiceCall
- PWA write: `DB.svcCalls.push({...,contractId:contractId||0})` (index.html:3607-3613) — ServiceCall stores a forward reference to Contract; Contract itself never stores any reference back (`DB.contracts` objects have no `svcCallIds` or similar array anywhere in the schema literal at either push site). Relationship is intentionally one-way.
- PWA read-back: `saveReport(id,true)` reads `s.contractId`, looks up the Contract, recomputes `pmDue(c)` fresh, and stamps `c.svcs[due[0]].done=today()` (index.html:3698-3701) — it does NOT record the ServiceCall's id on the Contract, and does NOT necessarily stamp the visit the ServiceCall was originally scheduled against (recomputed fresh, first-due-wins).
- NEW APP: `serviceCallService.completeServiceCall` calls `contractService.completePmVisitForContract(updated.contractId, ...)` (serviceCallService.js:667-670), which itself recomputes `computePmDueIndexes` fresh and stamps `due[0]` (contractService.js:518-519) — same "DO NOT FIX" quirk reproduced bug-for-bug. No reverse FK invented on Contract. **MATCH.**

### 10. PM ServiceCall creation
PWA `mCall(contractId)`/`saveCall(contractId)` (index.html:3597-3616): prefills customer/phone/site from the Contract when `contractId` is truthy; `type` = `"PM"` if `contractId` else `"Complaint"`; `status` = `"Scheduled"` if `contractId` else `"Registered"`; `psc`/`call` sequence counters increment; notification per branch (see reconciliation above). NEW APP: `serviceCallService.js` (createComplaint / createPmVisit or equivalent, lines ~280-380 per grep) reproduces prefill, type, status, and per-branch notification. Tenant/company enforced via `actorAuth.companyId` (session-only, infrastructure exception). **MATCH.**

### 11. PM assignment
PWA `assignCall(id)` (index.html:3666-3673): engineer candidate pool = `["service_eng","engineer","service_mgr"]` roles, no division filter; only `isMgr` (`service_mgr`/`admin`) sees the assignment form (no server-side enforcement in PWA); reassignment allowed pre-completion; unconditional overwrite (blank clears); status flips `Registered`→`Assigned` only from `Registered` (PM calls start at `Scheduled` and never pass through this transition); notifies `["*"]` on every save with a truthy resulting engineer, no dedup. NEW APP `assignEngineer` (serviceCallService.js:529-589) reproduces the exact candidate-role list (`ENGINEER_CANDIDATE_ROLES`), the `Registered`→`Assigned`-only transition, the unconditional overwrite, and the no-dedup broadcast notification; adds real server-side role enforcement (`assertCanManageServiceCalls`, admin/service_mgr) as the approved authorization-parity exception. **MATCH** (no PWA-undemonstrated division restriction applied).

### 12. Service report / signature-gated completion
PWA `saveReport(id,complete)` (index.html:3690-3712): report object always rebuilt/replaced wholesale, no field validation, draft save never touches `s.sig`; on `complete=true` the SOLE hard guard is a non-empty client signature (`if(_sg&&_sg.empty){toast(...);return}`) — engineer never signs, only the client/customer signs, via an on-screen canvas; on pass: `s.sig` written, `status="Completed"`, then the conditional Contract PM-slot update, conditional Chargeable Payment + finance notify, unconditional completion notify, then a customer message preview (WhatsApp/SMS, not `notify()`). No re-completion guard exists in the PWA (calling `saveReport` again on a Completed record is not blocked by any visible code path other than the view no longer rendering the form). NEW APP `completeServiceCall` (serviceCallService.js:634-745) reproduces the exact order and the sole signature guard (`MISSING_SIGNATURE`), and replaces the PWA's total absence of a re-completion guard with an ATOMIC idempotent no-op (`completeIfNotCompleted`) — this is a concurrency-safety INFRASTRUCTURE-ONLY difference (approved ground rule), not a new business rule: a second completion attempt is silently absorbed, never rejected with a business error, matching the PWA's observable single-completion outcome under a race. **MATCH.**

### 13. Chargeable ServiceCall → Payment
PWA (index.html:3702-3704): `report.stype==="Chargeable" && report.amount>0` → pushes a `DB.payments` record with `status:"Pending"`, `remark:"Chargeable service call"`, `project: site+" (PSC-"+psc+")"`, `soNo:""`, plus the finance notify. NEW APP: `paymentRepo.create` (serviceCallService.js:697-716, same transaction) reproduces the identical field mapping (`projectOrReference`, `personName`, `remark:'Chargeable service call'`, `status:'Pending'`, `salesOrderId:null`) and the same notify. Written directly via `paymentRepo`, bypassing `paymentService.createManualPayment`'s finance/admin gate — matching the PWA fact that the completing actor (engineer or manager), not finance, creates this Payment with no separate role check. **MATCH**, with atomicity (single Mongo transaction covering ServiceCall status + Contract slot + Payment + notifications) as the approved infrastructure exception.

### 14. Account/role connections (selected, workflow-relevant)

| Connection | PWA Source | NEW APP Source | Tenant | Authorization |
|---|---|---|---|---|
| Company→Contract | `co:U.co` on push | `companyId: actorAuth.companyId` | session-derived only | create: admin/service_mgr |
| Company→ServiceCall | `co:U.co` on push | `companyId: actorAuth.companyId` | session-derived only | create: any auth'd company member (PWA: any role can register a complaint) |
| Project→creating actor (conversion) | implicit (`U.role` gate at render) | `actorAuth.role` checked server-side | session | admin/service_mgr only |
| Contract→PM/service actor | none stored (Contract has no "owner" field) | none stored | — | NO RELATION DEMONSTRATED |
| ServiceCall→engineer | `s.eng` (name string) | `engineerId` (ref to User) | company-scoped candidate lookup | INFRASTRUCTURE-ONLY (name string → ObjectId ref) |
| ServiceCall→customer | `s.customer`/`s.phone` (free text) | same, free text fields | — | MATCH (no Customer entity in PWA or NEW APP) |
| ServiceCall→Payment | one-way write (Payment references ServiceCall only via free-text `project` string, no FK) | same (`projectOrReference` free text, no FK) | — | MATCH — WRITE-ONLY REFERENCE, no reverse FK invented |

### 15. Checklist participation
Project completion's checklist gate (`savePM`, index.html:2597-2599; `setStage`, projectService.js:371-390) is a **soft confirm** (`if(notAppr>0 && !confirm(...))`), not a hard block — a user can proceed past it. NEW APP reproduces this as a `confirmIncompleteChecklist` flag requiring explicit client resubmission rather than a silent `confirm()` dialog (a faithful server-side translation of a client-side `confirm()`, since the server cannot pop a dialog) — same functional outcome: completion is never unconditionally blocked by outstanding checklist points, it merely requires an explicit "yes, anyway." This directly affects Contract eligibility, since `isEligibleForServiceConversion` requires `status==='Completed'`. **MATCH — Checklist remains a soft gate on the path to Contract eligibility, never a hard block, in both systems.**

### 16. Project/Contract/ServiceCall status map

| Entity | State | Trigger | PWA Function | Next State | Side Effects | NEW APP |
|---|---|---|---|---|---|---|
| Project | Ongoing→Completed | stage set to literal `"Completed"` (HVAC/Solar only — impossible for MEP) | `savePM` | Completed | notifies finance/admin/service_mgr | `setStage` |
| Project | Completed→In Service | `convertToService` (service_mgr/admin, div≠MEP) | `convertToService` | In Service | Contract created, notify | `convertProjectToContract` |
| Contract | (none stored) Active/Expiring Soon/Expired | date-derived only, never persisted | `contractStatus` | — | — | `computeContractStatus` |
| ServiceCall | Registered→Assigned | `assignCall` with truthy engineer, only from Registered | `assignCall` | Assigned | notify `["*"]` | `assignEngineer` |
| ServiceCall | (Registered\|Assigned\|Scheduled)→Completed | `saveReport(id,true)` + non-blank signature | `saveReport` | Completed | Contract slot stamp, conditional Payment, notify | `completeServiceCall` |

No lifecycle state is invented beyond these PWA-demonstrated ones on either side.

---

## PWA evidence
**31 evidence records** traced to concrete file+line anchors in `MEP_PROJECTS_PWA/index.html` this pass (25 `notify(` call sites reviewed for the reconciliation, plus `convertToService`, `contractStatus`, `pmDue`, `saveContract`/`mContract`, `saveCall`/`mCall`, `assignCall`, `saveReport`, `STAGES`, `savePM`'s completion gate — each independently read from source, not from prior docs).

## NEW APP evidence
**27 evidence records** traced to concrete file+line anchors in `new-app/backend/src/services/contractService.js`, `projectService.js`, and `serviceCallService.js`, cross-checked against `app.js` route mounting and `contractRoutes.js`/`serviceCallRoutes.js` existence.

## Findings

**MATCH** (all core behaviors verified above): Project→Contract eligibility/MEP exclusion, Contract field defaults (both paths), Contract status derivation, PM cadence generation, PM due computation (incl. Expired-forever quirk), Contract→ServiceCall one-way relationship and due[0] stamping quirk, ServiceCall creation/prefill, PM assignment candidate pool and no-dedup broadcast, signature-gated completion (sole guard = client signature), chargeable→Payment field mapping, checklist soft-gate on completion, manual Contract path's silence (no notification, no Project/ServiceCall linkage).

**INFRASTRUCTURE-ONLY DIFFERENCE**: (1) `companyId` sourced from session only, never client-supplied, on Contract/ServiceCall/Payment writes. (2) Real server-side role enforcement (`assertCanManageContracts`, `assertCanManageServiceCalls`) reproducing the PWA's own UI-visible role intent, where the PWA itself has zero function-level checks. (3) `completeIfNotCompleted` atomic conditional transition replacing the PWA's complete absence of a re-completion guard, to prevent a double-fired Payment/notification/Contract-slot-write under a network retry or race — the single-completion *outcome* is unchanged. (4) Mongo transaction wrapping ServiceCall-completion + Contract-slot write + Payment write + notifications. (5) `endDate: null` schema representation of the PWA's blank-string `end` (Decision 8), with `computeContractStatus` treating null identically to "before any real date," preserving the PWA's observable Expired outcome.

**DOCUMENTATION GAP**: the previously-documented notification counts (Contract=2, ServiceCall=4) do not match direct source re-derivation (Contract=1 by call site; ServiceCall=5 by distinct trigger event, 4 by literal call site). Corrected in this document's reconciliation section above. No code change required — NEW APP already implements the correct 1/5 split.

**OPEN/NOT DETERMINABLE**: none identified as blocking. Company deletion/cascade (B2) remains untouched; no PWA source anywhere in the Contract/ServiceCall/Project conversion code path references company deletion, so it is correctly out of scope for this pass (kept visible below, not silently dropped).

No FUNCTIONAL GAP, PWA/NEW APP INCONSISTENCY, SECURITY/TENANT GAP, AUTHORIZATION GAP, ATOMICITY/CONCURRENCY GAP, or TEST COVERAGE GAP was found in this pass's scope.

## Fix tasks
None required. (B2 — Company deletion/cascade remains a known, independent, still-open PWA-parity item, confirmed via this pass's source review to be unconnected to the Project→Contract→PM workflow; no FIX-3.4-XX is raised for it here per instruction.)

## Tests
`npm test` in `new-app/backend/` via device shell: **313 pass / 313 total, 0 fail, 0 cancelled, 0 skipped** (`tests 313 / pass 313 / fail 0`). Matches the expected baseline exactly.

## Files
Only this document was created/modified: `new-app/docs/E2E_PASS_3_4_PROJECT_CONTRACT_PM.md`. No `new-app/` application source or test file was modified during this Phase A pass (read-only verification only, via `device_bash` reads/greps against the mounted repo).

## Deadline status
**ON TRACK.** Today (per environment) is 2026-09-24; hard target 2026-09-24 23:59 IST. Pass 3.4 verification completed with PASS and zero blocking findings, within the deadline window, without reducing PWA scope.

## Safety
- `git diff --name-status -- v2`: **37 files** modified (matches the documented existing 37-file drift; content not re-diffed line-by-line this pass, only file count confirmed against the required baseline).
- `git diff --name-status -- v3`: **0 files** — matches required (no V3 drift).
- `md5sum index.html MEP_PROJECTS_PWA/index.html`: both **111b53dba91704f96b83dae96c7793c6** — matches required.
- `git diff --cached --name-status`: empty — **nothing staged**.
- `git status --short`: confirms nothing staged/committed by this pass. Note (transparency, not a required-check failure): the working tree also shows pre-existing modifications outside v2/v3 (root-level files such as `README.md`, `CLAUDE.md`, `app.json`, `App.js`, `index.js`, `manifest.webmanifest`, plus `server/` (v1) files, and `MEP_PROJECTS_PWA/README.md`/`manifest.webmanifest` — but NOT `MEP_PROJECTS_PWA/index.html`, whose md5 matches exactly). These predate this session (this session made zero writes to any tracked file); `new-app/` itself is entirely untracked (`??`), consistent with it being in-progress, not-yet-committed work. None of this was touched by this Phase A task.

## Next gate
NEXT ALLOWED: PASS 3.5 — ServiceCall
