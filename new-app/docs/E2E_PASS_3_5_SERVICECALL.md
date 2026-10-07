# PASS 3.5 — ServiceCall End-to-End Verification

Status: **PASS**
Date: 2026-09-24 (IST)

## Truncation note

The source task text was truncated after "Comp". It was reconstructed as
"Completion" and the remainder of the task built from this engagement's
established Pass 3.1–3.4 structure/vocabulary, per standing convention, as
instructed by the calling agent.

## Method

All facts below were re-derived directly from `MEP_PROJECTS_PWA/index.html`
(md5 `111b53dba91704f96b83dae96c7793c6`, 4113 lines) via the connected-device
shell, and compared against `new-app/backend/src/models/ServiceCall.js`,
`src/services/serviceCallService.js` (777 lines), `src/routes/serviceCallRoutes.js`,
and `tests/serviceCallService.test.js` (801 lines, 313 assertions in the full
suite). Prior docs (`PWA_COVERAGE_AUDIT_SERVICECALL.md`,
`SERVICECALL_DECISION_LOCK.md`, `E2E_PASS_3_4_PROJECT_CONTRACT_PM.md`) were
read only for format/pattern and as hints; every claim here was re-confirmed
against live source with file+line evidence, not copied from those docs.

## 1. Workflow coverage

### A. Complaint-initiated path (primary focus of this pass)

PWA evidence: `mCall()`/`saveCall()` (index.html L3599–3612), `vCall()`
(L3621–3670), `assignCall()` (L3665–3671), `saveReport()` (L3696–3708).

- **Who logs a complaint**: only `admin` / `service_mgr` — `mCall()` is only
  reachable from `vService()`/`openCallsPanel()`, both gated by `MENUS.admin`
  / `MENUS.service_mgr` containing `"service"` (L1296–1299). No other role's
  menu exposes the "+ Register Complaint" button.
- **Fields captured**: customer name, phone, site/address, free-text
  complaint details (`sc_c`) (L3599–3605).
- **Validation**: sole enforced rule is non-blank customer name —
  `if(!gv("sc_n")){toast("Customer name required");return}` (L3608).
- **Standalone vs. ServiceCall record**: a Complaint is created directly as a
  `DB.svcCalls` row (`type:"Complaint"`) — there is no separate Complaint
  entity (L3609–3613).
- **Project/Contract linkage**: `contractId:0` for a Complaint — no Project
  or Contract reference; a Complaint may be (and typically is) unrelated to
  any Contract (L3612).
- **Customer/site**: free text only, not a customer/account reference
  (confirmed no `DB.customers`/account table exists anywhere in the file).
- **Division**: none captured or filtered — `mine()` (L1265) filters only by
  `co` (company), never by division, for `DB.svcCalls` anywhere in the file.
- **Urgency/priority**: no such field or concept exists in the PWA for
ServiceCall.
- **Duplicate-complaint behavior**: none — no de-dup check anywhere in
  `saveCall()`.
- **Starting status**: `"Registered"` (L3611).

NEW APP evidence: `registerComplaint()` (serviceCallService.js L~246–292)
reproduces this exactly — `assertCanManageServiceCalls` (admin/service_mgr),
sole `customer` non-blank check, `contractId:null`, `status:'Registered'`,
notification `["service_mgr","admin"]`. **MATCH.**

### B. PM/Contract-initiated path

Already fully verified in Pass 3.4 (Contract → PM due → ServiceCall
creation/prefill → assignment → signature-gated completion → `due[0]`
Contract stamp → conditional Chargeable Payment → notifications). Re-cited
here, not re-derived.

**Same-code-path confirmation (new for this pass)**: both `mCall()` (no
argument) and `mCall(contractId)` route to the same `saveCall(contractId)`
function (index.html L3608–3614), which pushes to the same `DB.svcCalls`
array with only `type`/`status`/`date`/`time`/`complaint` differing by the
`contractId?...:...` ternary. There is no parallel implementation. On the
NEW APP side, `registerComplaint()` and `schedulePM()` both write through
the same `ServiceCall` model/`serviceCallRepo`, and both `assignEngineer()`,
`saveReportDraft()`, and `completeServiceCall()` are shared, type-agnostic
functions that operate identically regardless of `type`. **MATCH** — same
model, same code path, confirmed on both sides.

## 2. Field model (selected; full field list matches
`ServiceCall.js` 1:1 against `svcCalls` row shape at index.html L323–326,
L3609–3613, L3696–3699)

| PWA Field | Origin | NEW APP Field | Match |
|---|---|---|---|
| `psc` | both (shared `DB.seq.psc`) | `complaintNumber` (durable per-company counter) | INFRASTRUCTURE-ONLY DIFFERENCE |
| `type` (`"Complaint"`/`"PM"`) | creation call | `type` enum `['Complaint','PM']` | MATCH |
| `customer`,`phone`,`site` | both | same | MATCH |
| `complaint` | Complaint only | `complaintDescription` | MATCH |
| `date`,`time` | PM only (blank for Complaint) | `appointmentDate`,`appointmentTime` | MATCH |
| `status` | `Registered\|Scheduled\|Assigned\|Completed` | same enum | MATCH |
| `eng` (name string) | assignment | `engineerId` (ObjectId ref User) | INFRASTRUCTURE-ONLY DIFFERENCE |
| `regDate` | creation | `registeredDate` | MATCH |
| `report.{make,model,capacity,rtype,material,service,chk,stype,amount,remark,custRemark}` | report save | `report.{make,model,capacity,type,materialUsed,serviceDescription,checklistResults,serviceType,amount,engineerRemark,customerRemark}` | MATCH |
| `sig` (dataURL) | completion | `clientSignatureImage` | MATCH |
| `contractId` | PM only | `contractId` (ObjectId ref Contract, nullable) | INFRASTRUCTURE-ONLY DIFFERENCE |
| — (no customer-account entity) | — | — | NO RELATION DEMONSTRATED (customer is free text in PWA, unchanged in NEW APP) |

Checklist keys (`SVC_CHK`, index.html L228) —
`["Cooling Testing","Gas Pressure","Filter Clean","Indoor Coil","Outdoor Coil","Body Cleaning"]`
— match `CHECKLIST_KEYS` in serviceCallService.js verbatim, in order.
Service types (`r_st` select, L3645) —
`["Installation","Warranty","AMC","Chargeable"]` — match `SERVICE_TYPES`
verbatim, in order.

## 3. Assignment (both paths — re-confirmed)

PWA evidence (`assignCall()`, L3665–3671; `vCall()`'s manager block,
L3628–3630): eligible engineer pool =
`mine(DB.users).filter(role in ["service_eng","engineer","service_mgr"])`
(L3621) — **no division filter**, identical for Complaint and PM calls (the
candidate list is built once in `vCall()`, used for both types). Assigner =
`isMgr` (`admin`/`service_mgr`) only. `assignCall()` unconditionally
overwrites `eng`/`date`/`time`; status flips `Registered→Assigned` only
(PM calls start at `"Scheduled"` and never pass through this transition —
confirmed both types share the exact same `assignCall()` function, so this
asymmetry is a status-value condition, not a path split). Notification
`notify(["*"], ...)` fires on every save with a truthy `eng`, no dedup —
same for both types.

NEW APP: `assignEngineer()` reproduces all of the above exactly, including
the `Registered→Assigned`-only transition and no-dedup broadcast. **MATCH.**
No Complaint-vs-PM divergence found in either source.

## 4. Status lifecycle

| State | Trigger | PWA fn | Next | Side effects | NEW APP |
|---|---|---|---|---|---|
| (none)→Registered | `saveCall()`, no contractId | `saveCall` | Registered | notify service_mgr/admin | `registerComplaint` |
| (none)→Scheduled | `saveCall(contractId)` | `saveCall` | Scheduled | notify service_mgr/admin | `schedulePM` |
| Registered→Assigned | `assignCall()` w/ eng, only from Registered | `assignCall` | Assigned | notify `["*"]` | `assignEngineer` |
| Scheduled→Scheduled (eng set, no status change) | `assignCall()` | `assignCall` | unchanged | notify `["*"]` | `assignEngineer` |
| any non-Completed→Completed | `saveReport(id,true)` w/ signature | `saveReport` | Completed | sig write, conditional Contract stamp, conditional Payment, 2 notifies | `completeServiceCall` |

No Cancelled/reopen/delete state exists anywhere in the PWA for
ServiceCall — confirmed by absence of any such action in the file, and by
the explicit route-table comment in `serviceCallRoutes.js` restating this.
**MATCH.**

## 5. Service report / signature-gated completion

Re-confirmed for the Complaint path specifically: `vCall()`'s report block
(L3630–3651) is rendered `if(s.status!=="Completed"&&(isEng||isMgr))` — same
gate for Complaint and PM calls (`isEng = s.eng===U.name`). `saveReport()`
(L3696–3708) rebuilds and replaces the whole `report` object unconditionally
(no field validation) for both types; blank fields are allowed. The **sole**
hard completion guard, for both Complaint and PM calls, is:
`if(_sg&&_sg.empty){toast("Client signature required to complete the call");return}`
(L3698) — no different guard exists for either origination path. No
re-completion guard exists in the PWA for either type.

NEW APP: `saveReportDraft()`/`completeServiceCall()` implement the identical
gate (`assertCanEditReport` = manager OR assigned engineer) and the identical
sole guard (non-blank `signature`), type-agnostically. Concurrency safety for
retried/duplicate completion is added via an atomic
`completeIfNotCompleted` conditional update — an approved
infrastructure-only concurrency-protection exception, not a new business
guard (idempotent no-op, no rejection). **MATCH** (plus approved
infrastructure exception).

## 6. Chargeable service → Payment

Re-confirmed for the Complaint path: `saveReport()`'s chargeable branch
(L3701–3703) is reached identically regardless of `s.type` — it checks only
`s.report.stype==="Chargeable"&&s.report.amount>0`. Behavior is therefore
byte-identical between a chargeable Complaint-path call and a chargeable
PM-path call: `DB.payments.push({..., status:"Pending", soNo:"", ...})`
(no FK to the ServiceCall), then `notify(["finance"], ...)`.

NEW APP: `completeServiceCall()`'s Chargeable branch uses the same
`report.serviceType === 'Chargeable' && report.amount > 0` condition,
writes via `paymentRepo.create` with `status:'Pending'`, no reverse
reference, one-way only, and fires the finance notification with the same
text template. **MATCH.** Complaint-path and PM-path chargeable calls are
verified to behave identically on both PWA and NEW APP sides (same shared
function, no branch on `type`).

## 7. Inventory / parts used

Searched the whole PWA source for any linkage between `DB.svcCalls` and
`DB.invIssues`/`DB.intTxns`. `fromV2InvIssue()` (index.html) ties an issue
to `x.project` only; there is no `callId`/`scId`/service-call reference
field anywhere in the inventory issue/transaction model, and no code path
issues, consumes, or returns material against a ServiceCall id. **NO
RELATION DEMONSTRATED** between ServiceCall and Inventory in the PWA. The
NEW APP correctly has no such linkage either — confirmed absent from
`ServiceCall.js` and `serviceCallService.js`. This matches; no gap.

## 8. Notifications

Grep of the full ServiceCall block (index.html L3596–3706) found exactly 4
literal `notify()` call sites:
1. `saveCall()` ternary — `(contractId?"PM scheduled":"New complaint registered")` → `["service_mgr","admin"]` (covers 2 distinct triggers, one per origination path).
2. `assignCall()` → `["*"]`.
3. Chargeable-Payment branch of `saveReport()` → `["finance"]`.
4. Unconditional completion notify in `saveReport()` → `["service_mgr","admin"]`.

Total distinct triggers = 5 (Contract=1 from Pass 3.4 + these 4 sites/5
triggers = the already-reconciled ServiceCall=5 count). **No 6th trigger was
found** in the Complaint path — the Complaint path uses the *same* ternary
site as the PM path (site #1 above), not a separate one. Count re-confirmed
to hold, unchanged, across both origination paths.

NEW APP: `registerComplaint`, `schedulePM`, `assignEngineer`, and
`completeServiceCall` fire the corresponding 5 notifications with matching
text templates and target-role arrays. **MATCH.**

## 9. Account / role connections

| Relation | PWA source | PWA read | PWA write | NEW APP | Tenant | Authz |
|---|---|---|---|---|---|---|
| Company→ServiceCall | `s.co` | `mine()` | `saveCall()` | `companyId` (ObjectId) | session-only | N/A |
| ServiceCall→engineer | `s.eng` (name) | `vCall()`,`engDash()` | `assignCall()` | `engineerId` (ObjectId) | scoped | role-checked candidate |
| ServiceCall→service manager | role gate only, no FK | menu gate | — | role gate only, no FK | — | MANAGE_ROLES |
| ServiceCall→customer | free text, no account entity | — | — | free text, no account entity | — | NO RELATION DEMONSTRATED |
| ServiceCall→Payment | one-way push, no FK | — | `saveReport()` chargeable branch | one-way `paymentRepo.create`, no FK | scoped | none (matches PWA) |
| ServiceCall→Project | none — no field | — | — | none | — | NO RELATION DEMONSTRATED |
| ServiceCall→Contract | `contractId` (PM only, nullable) | `pmDue()`/`saveReport()` | `saveCall(contractId)`,`saveReport()` due-stamp | `contractId` (ObjectId, nullable) | scoped | — |
| Notifications→users/roles | `roles` array, role-string match | `myNotifs()` | `notify()` | `targetRoles` array | scoped | role-string match |

All MATCH or approved INFRASTRUCTURE-ONLY DIFFERENCE (ObjectId refs in place
of name/co-id strings, tenant scoping via session).

## Findings

- **MATCH** (all core workflow, field model, assignment, status lifecycle,
  signature-gated completion, chargeable→Payment, notification-count
  reconciliation for the Complaint path).
- **INFRASTRUCTURE-ONLY DIFFERENCE**: `eng` name string → `engineerId`
  ObjectId; `psc`/`call` dual counters → single durable `complaintNumber`
  counter; `contractId` numeric id → ObjectId ref; atomic
  `completeIfNotCompleted` in place of the PWA's unguarded re-save (adds
  concurrency safety without adding a business rejection).
- **NO RELATION DEMONSTRATED**: ServiceCall↔Inventory; ServiceCall↔Project;
  ServiceCall↔customer-as-account (customer is always free text in the PWA).
- No FUNCTIONAL GAP, PWA/NEW APP INCONSISTENCY, SECURITY/TENANT GAP,
  AUTHORIZATION GAP, ATOMICITY/CONCURRENCY GAP, DOCUMENTATION GAP, or TEST
  COVERAGE GAP was found in this pass's scope.
- One **OPEN/NOT DETERMINABLE** item carried forward, not part of this
  pass's scope: **B2 — Company deletion/cascade**. Nothing in the
  ServiceCall PWA source references company deletion; it remains an
  independent, untouched parity item.

## Fix tasks

None. No implementation fixes required for ServiceCall.

## Tests

`npm test` in `new-app/backend/`: **313/313 passing, 0 failing** (observed
directly via device shell; run completed in ~157s, Node's built-in test
runner TAP output, `# pass 313 / # fail 0`).

## Files

Only `new-app/docs/E2E_PASS_3_5_SERVICECALL.md` created/updated. No
application source or test files were modified (Phase A, read-only).

## Deadline status

ON TRACK.

## Safety

- V2 drift: 37 files changed (`git diff --name-status -- v2` = 37 lines) —
  matches the existing, unchanged baseline.
- V3 drift: 0 files (`git diff --name-status -- v3` = empty).
- PWA md5: both `index.html` and `MEP_PROJECTS_PWA/index.html` =
  `111b53dba91704f96b83dae96c7793c6` — matches required value.
- Staged: `git diff --cached --name-status` = empty — nothing staged.
- Committed: no commits made this pass.
- (Note: `git status --short` shows a broad set of modified-but-unstaged
  files across the whole repo tree, consistent with this engagement's
  pre-existing working-tree state, not caused by this pass — no
  new-app/, v2/, or v3/ file was touched by this task.)

## Next gate

NEXT ALLOWED: PASS 3.6 — Inventory

---

# ADDENDUM (full-task extension, appended after coordinator supplied the untruncated original Pass 3.5 task text)

Everything above this line (PASS verdict, notification reconciliation, core
workflow coverage, tests, original safety check) stands unchanged and is
NOT redone here. This addendum adds the sections the truncated version of
the task did not request. Still Phase A: read-only, no application
source/test file was modified to produce this addendum.

## 10. Customer message templates (four PWA ServiceCall templates)

PWA evidence: `msgReg()`, `msgPM()`, `msgDone()`, `msgPMdone()`
(index.html, adjacent to `openCallsPanel()`, immediately above L3570), and
`showMsg()` (L3573–3575) which is the only place any of the four is ever
rendered to a user.

| Template | Trigger | Fields substituted | Recipient | Channel representation |
|---|---|---|---|---|
| `msgReg(psc)` | `saveCall()` completes for a Complaint (`contractId` falsy) — shown immediately via `showMsg()` after `saveCall()` | `psc`, `co().phone`, `co().email`, `co().name` (first word) | the complainant customer | text preview modal; a `wa.me/91<phone>` deep-link button ("Send via WhatsApp") and a "Copy Message" button — **no actual send** |
| `msgPM(psc,d,t)` | `saveCall(contractId)` completes for a PM visit — same `showMsg()` call site, PM branch | `psc`, appt `date`, appt `time`, company phone/email/name | the contract customer | same preview/WhatsApp-link/copy pattern, no send |
| `msgDone(psc)` | `saveReport(id,true)` completes a **Complaint**-type call (`s.type!=="PM"`) — invoked at the end of `saveReport()`'s completion branch | `psc` (note: `"PSC-"` hyphen here, the one documented punctuation inconsistency), company phone/email/name | the complainant customer | same pattern |
| `msgPMdone(psc,d,t)` | `saveReport(id,true)` completes a **PM**-type call (`s.type==="PM"`) — same call site, PM branch | `psc`, appt `date`, appt `time`, company phone/email/name | the contract customer | same pattern |

Two additional read-only preview entry points reuse these same four
functions without re-triggering any workflow: `showRegMsg(id)` and
`showDoneMsg(id)` (L3663–3664), each a "📩 ... message" button on the
`vCall()` detail page, letting a manager re-open the same preview at any
later time.

**Delivery scope (PWA FACT, verified by reading the whole file for any
SMS/email/WhatsApp API call)**: the PWA never performs actual delivery.
`showMsg()`'s only external actions are (a) a `mailto:`-free, API-free
`wa.me` link opened via `target="_blank"` (the WhatsApp Web/app deep link,
which still requires the human operator to press Send inside WhatsApp) and
(b) `navigator.clipboard.writeText()` for "Copy Message" (`copyMsg()`,
line adjacent to `showMsg()`). There is no SMS gateway, no email
transport, and no server-side messaging integration anywhere in the file.

NEW APP evidence: `msgReg`/`msgPM`/`msgDone`/`msgPMdone` in
`serviceCallService.js` (verbatim text, verbatim punctuation
inconsistency preserved) are returned as a `customerMessage` string field
in the `registerComplaint`/`schedulePM`/`completeServiceCall` responses
(see those functions' `return { ..., customerMessage }` statements). No
SMS/email/WhatsApp send is implemented, invoked, or scheduled anywhere in
`serviceCallService.js` or `serviceCallRoutes.js`. **MATCH** — NEW APP
preserves the PWA's exact functional scope (message-text generation only,
delivery left to a human operator/frontend, correctly not invented).

Classification: **MATCH**.

## 11. Reports / exports

| View | PWA fn | Filter | Fields | Role | Tenant | Sort/order | NEW APP |
|---|---|---|---|---|---|---|---|
| Service Call Register | `vService()` (L3582–3587) | 9-field `hit()` search (`psc,type,customer,phone,site,status,eng,regDate,date,complaint`) | PSC/type/regDate/customer/phone/site/appt/eng/status (row); full detail on click | admin, service_mgr (menu-gated) | `mine()` | `.slice().reverse()` — newest-inserted-first | `listServiceCalls()` |
| Open Service Calls (dashboard widget) | `openCallsPanel()` (L3579–3584) | `status!=="Completed"` only, no text filter | PSC/type/customer/site/eng/status | admin, service_mgr | `mine()` | natural (insertion) order, no reversal | `getOpenServiceCalls()` |
| CSV Export | `dlService()` (L3515–3526) | same 9-field `hit()` search as `vService()` | exact 22-column header (§4 of main doc); `Client Signed` Yes/No only; `TOTAL CALLS` footer row sums **every** report's `amount` regardless of `serviceType` | admin, service_mgr | `mine()` | natural order (NOT reversed — confirmed distinct from `vService()`) | `exportServiceCallsCsv()` |
| Call detail | `vCall()` (L3617–3662) | single record by id, **no company guard in the PWA** (flagged §20 of main doc / Finding below) | full record + report (if completed) + message-preview buttons | any authenticated user who can reach the URL (isEng/isMgr gates only the assignment/report *edit* blocks, not the read) | none in PWA; PWA FACT | n/a | `getServiceCall()` |
| PM Due panel | `pmDuePanel()` (cited, Pass 3.4) | `!s.done && s.m<=thisMonth()` per contract slot, all contracts regardless of status | site/customer/phone/type/due month/"Schedule PM" button | admin, service_mgr (same `service`/`pmlist` menu gate) | `mine()` | insertion order over contracts | Pass 3.4's Contract-PM-due listing; ServiceCall side is `schedulePM()` |
| AMC/Warranty & PM report (`dlContracts()`) | cited only — this is a **Contract** export, not a ServiceCall one; the two PM columns it prints (`1st Due/1st Done`...) come from `Contract.svcs`, not from `DB.svcCalls` | — | — | — | — | — | out of ServiceCall's own scope; Contract-side, already Pass-3.4 territory |

All five ServiceCall-owned views/exports (register, open-calls widget, CSV
export, detail, and PM-due trigger point) have a corresponding NEW APP
function with matching filter/role/tenant/sort semantics. **MATCH** on all
five, with one already-tracked exception:

**Finding (re-stated, not new): SECURITY/TENANT GAP in the PWA source
itself** — `vCall()`'s single-record lookup (`DB.svcCalls.find(x=>x.id===PARAM)`)
has no company/tenant check at all; any authenticated user of any company
who can guess/construct another company's numeric id can read that
record's full detail (customer, phone, signature image, report) in the
PWA. NEW APP's `getServiceCall()` closes this with `{ _id, companyId }`
scoping — an approved, MANDATORY infrastructure-only tenant-isolation
fix, not a new business rule (already documented in Pass 3.5's main body
§"Read/search/report" section; restated here because it belongs under
Reports too). This does not change PASS 3.5's verdict: it is the kind of
gap the "server-side authorization matching PWA-visible intent" approved
exception exists to close.

## 12. Error / edge cases (PWA-verified actual behavior, not assumptions)

| Case | PWA actual behavior (source-verified) | NEW APP behavior | Classification |
|---|---|---|---|
| Invalid/nonexistent Contract id passed to `mCall(contractId)` | `mCall()` looks up `c`; if not found, `c` is falsy and the modal silently renders the **Complaint**-style form (textarea, not date/time fields) — but the Save button's `onclick="saveCall(<contractId>)"` still carries the original truthy `contractId`, so `saveCall()` still sets `type:"PM"`, `status:"Scheduled"`, yet `date`/`time` come back `""` (the `sc_d`/`sc_t` inputs were never rendered) and `complaint` is force-blanked (`contractId?"":...`). A genuine PWA data-inconsistency quirk — but **unreachable via the UI in practice**: every real call site (`pmDuePanel()`'s "Schedule PM" button) always passes a live `x.c.id` from an already-enumerated contract, never an arbitrary id. | `schedulePM()` explicitly checks `contract` existence and throws `NOT_FOUND` (404) before writing anything. | INFRASTRUCTURE-ONLY DIFFERENCE — NEW APP is a strict superset of the PWA's practically-unreachable UI path; no PWA-visible behavior is changed since the UI never exercises this branch. |
| Invalid/nonexistent ServiceCall id | `vCall()`: `if(!s)return"Not found"` — plain string, no crash, no redirect. Same pattern for `assignCall()`/`saveReport()`, which would throw a TypeError on `undefined.eng=...` if given a bad id (no guard at all in those two — PWA FACT: unguarded). | `getServiceCall`/`assignEngineer`/`saveReportDraft`/`completeServiceCall` all explicitly `findById` first and throw `ServiceError('...not found', 'NOT_FOUND', 404)`. | INFRASTRUCTURE-ONLY DIFFERENCE — NEW APP adds the guard the PWA's `vCall()` had conceptually (a "Not found" message) but `assignCall()`/`saveReport()` structurally lacked; returning a clean 404 instead of crashing is required API-boundary behavior, not a new business rule. |
| Missing engineer at completion | Completion is allowed with `s.eng===""` throughout — the sole guard is the signature (§7/§5 of main doc). Completion notify text falls back to `U.name` (§ already documented). | Same — `completeServiceCall()` has no engineer-presence check. | MATCH |
| Reassignment (engineer already set, assign again) | `assignCall()` unconditionally overwrites `eng`/`date`/`time` regardless of prior value, fires the broadcast notify every time (no dedup), for any non-Completed status. | `assignEngineer()` — identical, verified in main doc §5. | MATCH |
| Blank optional report fields (make/model/capacity/material/service/remarks) | `saveReport()` accepts and stores blanks unconditionally — no field is required. | `buildReport()` defaults every field to `''`/`0` with no requiredness. | MATCH |
| Missing client signature | Sole hard completion guard, both draft-save (`complete=false`) and completion (`complete=true`) — draft save has **no** signature check at all; only `complete===true` checks `_sg.empty`. | `saveReportDraft()` has no signature check; `completeServiceCall()` requires non-blank `signature`. | MATCH |
| Duplicate/repeat completion | The report-edit UI block is only rendered `if(s.status!=="Completed"&&...)`, so a normal user cannot reach `saveReport(id,true)` again through navigation once Completed — but this is a **UI-only** gate; nothing in `saveReport()` itself checks `s.status`, so a second raw call (e.g., a stale open tab, a replayed request) would re-run the Contract-stamp and duplicate-Payment logic unguarded. | `completeServiceCall()` uses an atomic `completeIfNotCompleted` conditional transition — a losing/retried call is a silent idempotent no-op (no duplicate Payment, no duplicate Contract stamp), per the GENUINELY OPEN #1 decision already recorded in `serviceCallService.js`'s header comment and restated in main doc §7. | ATOMICITY/CONCURRENCY GAP in the PWA, closed by an approved infrastructure-only exception in NEW APP (adds safety, adds no new rejection/business rule) — not a functional gap requiring BLOCKED. |
| Zero charge (`amount===0`, `serviceType==="Chargeable"`) | `if(s.report.stype==="Chargeable"&&s.report.amount>0)` — `0>0` is false, so **no Payment is created** for a zero-amount Chargeable report; the report itself still saves with `stype:"Chargeable",amount:0`. | `completeServiceCall()`: `report.serviceType === 'Chargeable' && report.amount > 0` — identical. | MATCH |
| Negative charge (e.g. `amount:-500`) | `Number(gv("r_amt"))||0` stores `-500` in the report unconditionally (not rejected/clamped) — but the Payment-creation condition `amount>0` is false for `-500`, so **no Payment is created** either; only the (uncorrected) negative value sits in the saved report. | `buildReport()`: `Number(src.amount) || 0` stores `-500` unrejected (per its own comment, "negative is NOT rejected"); `completeServiceCall()`'s `report.amount > 0` check is likewise false for a negative value, so no Payment. | MATCH |
| Foreign-company record access (cross-tenant read) | See Finding in §11 above — `vCall()` has **no company check at all**; a foreign-company id is readable if guessed. `assignCall()`/`saveReport()` are likewise unguarded by company. | `getServiceCall`/`assignEngineer`/`saveReportDraft`/`completeServiceCall` are all `{ _id, companyId }`-scoped via `serviceCallRepo`. | SECURITY/TENANT GAP in the PWA, closed by the MANDATORY approved infrastructure-only tenant-isolation exception in NEW APP — already documented, does not change the PASS verdict. |
| PM-due edge cases (multiple months overdue at once) | `pmDue(c)` returns **every** un-done slot with `m<=thisMonth()`, i.e. all overdue months simultaneously, not just the nearest one — `pmDuePanel()` then lists one row per overdue slot with its own "Schedule PM" button (each calling `mCall(c.id)` — the *same* contract id regardless of which slot row was clicked, since `mCall()` takes no slot index). | `contractService.completePmVisitForContract()` (Pass 3.4, cited) stamps `due[0]` — the first/earliest due index found by a **fresh** `pmDue()`-equivalent recompute at completion time, not whichever slot the manager visually clicked when scheduling. This is the already-documented `due[0]` DO NOT FIX quirk. | MATCH (already reconciled in Pass 3.4; re-confirmed applicable identically from the ServiceCall side). |
| Expired Contract | `pmDuePanel()` lists PM-due rows from **every** company contract with no `contractStatus()`/expiry filter at all — an Expired contract's overdue slots still appear and are still schedulable. `mCall(contractId)`/`saveCall(contractId)` themselves also never check `contractStatus()` — existence of the contract record is the only check (already noted in main doc §"Creation: PM"). | `schedulePM()` checks only contract existence, no status/expiry check — confirmed by re-reading the function (main doc, "Creation: PM" section). | MATCH |
| Already-stamped due slot (re-completing a call whose Contract slot is already marked done) | `saveReport()`'s Contract-stamp branch (`if(c){var due=pmDue(c);if(due.length)c.svcs[due[0]].done=today()}`) recomputes `pmDue(c)` fresh each time; once a slot is marked done, it drops out of `pmDue()`'s un-done filter, so a second completion (if it could happen — see "Duplicate completion" row above) would stamp the **next** still-undone slot instead of re-stamping the same one, or do nothing if none remain. This is the single most important DO NOT FIX quirk (Pass 3.4/SERVICECALL_DECISION_LOCK.md §15), re-confirmed unchanged here. | `contractService.completePmVisitForContract()` reproduces this exact fresh-recompute-`due[0]` behavior (cited, Pass 3.4). Combined with NEW APP's `completeIfNotCompleted` atomicity, a retried/duplicate completion request on the SAME ServiceCall is now a no-op before it would ever reach the Contract-stamp code a second time — strictly safer than the PWA, not a behavior change for the first, legitimate completion. | MATCH (plus approved infrastructure exception). |

No case in this table produces a FUNCTIONAL GAP, PWA/NEW APP
INCONSISTENCY, or AUTHORIZATION GAP. The two SECURITY/TENANT and
ATOMICITY/CONCURRENCY items are pre-existing PWA weaknesses that the
engagement's approved infrastructure-only exceptions were specifically
scoped to close, and NEW APP correctly closes them without adding any
PWA-invisible business rule.

## 13. Role matrix

Legend: V=View detail, C=Create (register Complaint / schedule PM),
A=Assign, R=Reassign (same action as Assign in the PWA — no separate
function), Rep=edit/save Report (draft), Comp=Complete (signature-gated),
Pay=trigger chargeable Payment creation (a side effect of Comp, not a
separate action), Fin=receive the chargeable-Payment notification,
Notif=receive assignment/completion/registration notifications.

| Role | View | Create | Assign/Reassign | Report draft | Complete | Payment trigger | Finance notif | Reg/PM/Assign/Complete notif |
|---|---|---|---|---|---|---|---|---|
| `admin` | Yes (menu: `service`) | Yes | Yes | Yes (isMgr) | Yes (isMgr) | Yes (via Comp) | Yes (targeted `["finance"]`? **No** — admin is not in the finance-targeted notify; admin IS in the reg/PM/complete `["service_mgr","admin"]` notifies) | Yes (reg/PM/complete) + Yes (assign, `["*"]` = everyone) |
| `service_mgr` | Yes (menu: `service`) | Yes | Yes | Yes (isMgr) | Yes (isMgr) | Yes (via Comp) | No (not in `["finance"]`) | Yes (reg/PM/complete) + Yes (assign, `["*"]`) |
| `service_eng` | Yes, but only own assigned calls reachable via `engDash()`'s "My Service Calls" list (`nav('call',id)`), OR any id if directly navigated (PWA has no read-side company/role check at all, per §11/§12 findings) | No (no menu path to `mCall()`) | No (assignment block gated `isMgr` only) | Yes, but only if `isEng` (`s.eng===U.name`) — i.e. only calls assigned to them | Yes, same `isEng` gate | Yes (via Comp, if they are the assigned engineer who completes) | No | Yes (assign `["*"]`, reg/PM/complete `["service_mgr","admin"]` — service_eng does NOT receive the latter two) |
| `engineer` | Same as `service_eng` — `engineer` is one of the three candidate roles and is treated identically by every ServiceCall function (`isEng`, `ENGINEER_CANDIDATE_ROLES`) | No | No | Yes, if `isEng` | Yes, if `isEng` | Yes (via Comp) | No | Yes (assign `["*"]` only) |
| `finance` | No — `finance`'s `MENUS` entry (`dash`,`payments`,`sos`) has no `service` item, and finance is not in `ENGINEER_CANDIDATE_ROLES`/`MANAGE_ROLES`, so no UI path reaches `vCall()`. (PWA's own missing read-guard means a finance user COULD still reach a call by direct nav — same PWA weakness noted in §11/§12, closed identically by NEW APP's tenant-scoped `getServiceCall`.) | No | No | No | No | No (not an actor) | **Yes** — sole recipient of the chargeable-Payment notify | No |
| `super` | No — `super`'s `MENUS` (`dash,companies,usage,revenue,expiring,locations,reports`) has no `service` item either; `super` is cross-company and not company-scoped, so it is structurally outside `mine()`'s per-company model for this feature. | No | No | No | No | No | No | No |
| `sales`, `hvac_pm`, `solar_pm`, `mep_pm`, `inventory` | No — none of these roles' `MENUS` include `service`, and none is in `ENGINEER_CANDIDATE_ROLES`. | No | No | No | No | No | No | No |

NEW APP server-side authorization (`serviceCallService.js`):
`MANAGE_ROLES = ['admin','service_mgr']` gates View-list/Create/Assign/
Export exactly as the PWA's menu gate does; `ENGINEER_CANDIDATE_ROLES =
['service_eng','engineer','service_mgr']` gates the assignable-engineer
pool exactly as `vCall()`'s candidate list does; `assertCanEditReport` =
manager OR assigned engineer, exactly as `isEng||isMgr`; `getServiceCall`
(single-record read) is intentionally **not** role-gated beyond company
membership — reproducing the PWA's own lack of a role gate on `vCall()`'s
read path (while correctly adding the tenant scope the PWA lacked). No
role outside `admin`/`service_mgr`/`service_eng`/`engineer` has any
ServiceCall-related permission in either source — `finance`, `super`,
`sales`, `hvac_pm`, `solar_pm`, `mep_pm`, `inventory` are all correctly
excluded on both sides. **MATCH** across the full role matrix; V3's role
rules were not consulted or used as a reference for this table (per
engagement rule).

Classification: **MATCH** (role matrix). The read-path's absence of a
role gate is the same pre-existing PWA characteristic noted as a
SECURITY/TENANT (not AUTHORIZATION) gap in §11/§12 — the PWA never
intended a role gate on that specific read, only a tenant boundary, and
NEW APP reproduces that intent precisely while adding the missing tenant
scope.

## 14. Explicit connection classification

- **Complaint → ServiceCall**: **EMBEDDED DATA**. A "Complaint" is not a
  separate PWA entity or collection — it is the `type:"Complaint"` value
  of a `DB.svcCalls` row, created directly by `saveCall()` with no
  intermediate object. There is nothing to reference; the complaint *is*
  the ServiceCall record (customer/phone/site/complaint-text fields are
  embedded directly in that same row). NEW APP reproduces this exactly:
  `registerComplaint()` writes directly into the same `ServiceCall`
  collection/model used by `schedulePM()`, with `type:'Complaint'` and no
  separate Complaint schema. **MATCH.**
- **ServiceCall → Contract (forward)**: **DIRECT REFERENCE** — a PM-type
  ServiceCall carries `contractId` (PWA: numeric row id; NEW APP:
  `Schema.Types.ObjectId ref:'Contract'`), nullable, set once at creation
  and never reassigned.
- **ServiceCall → Contract (reverse: does a Contract know its
  ServiceCalls?)**: **NO RELATION DEMONSTRATED**. `Contract.svcs` is an
  array of PM **schedule slots** (`{m,done,eng,notes}` — the AMC/warranty
  due-month calendar), not a list of ServiceCall ids; nowhere in the PWA
  does a Contract record hold, push to, or read back an array of
  ServiceCall references, and `DB.svcCalls` is never filtered/joined
  against a specific contract's own field to reconstruct "all ServiceCalls
  for this Contract" — the only Contract-side artifact of a completed PM
  visit is the `due[0]` slot's `done` date stamp (already covered, §12).
  NEW APP's `Contract` model likewise has no `serviceCalls`/`svcCallIds`
  array — confirmed absent from `contractService.js`/the Contract schema.
  This is the same "No reverse Contract->ServiceCall list" DO NOT FIX item
  already named in `serviceCallService.js`'s own header comment; restated
  here with the precise required vocabulary. **MATCH** (both sides
  correctly have no reverse relation).

## FRONTEND BUILD READINESS

*(Inspection/reporting only — not permission to build or change frontend
behavior; no frontend code was written or modified.)*

**PWA UI screens/features discovered** (menu items × role, from
`MENUS` object, index.html L1296–1307, cross-checked against each
screen's render function):

| Domain | PWA screens/features (menu label → render fn) |
|---|---|
| Accounts | `👥 Users` (admin only) → user list/create/edit; role assignment |
| Enquiry | `📋 Enquiries`, `❌ Lost Enquiries` (admin, sales) |
| SalesOrder | `🧾 Sales Orders` (admin, sales, hvac_pm, solar_pm, mep_pm, finance) |
| Finance/Payments | `💰 Payments` (admin), `💰 Pending Payments` (finance) |
| Checklist | `✅ Checklists` (admin — register/manage), `✅ Checklist Template` (hvac_pm/solar_pm/mep_pm — per-division template) |
| Project | `🏗️ Projects` (admin, hvac_pm, solar_pm, mep_pm); `🏠 My Work` (engineer) |
| Contract | `🔁 AMC / PM List` (admin, service_mgr) |
| ServiceCall | `🛠️ Service Calls` (admin, service_mgr); `🏠 My Service Jobs` (service_eng); the register, open-calls widget, PM-due panel, and CSV export documented in §11 above |
| Inventory | `📦 Stock`, `📤 Issue Material`, `📥 Material Returns`, `🔄 Stock Transfer`, `🗂 Categories & Locations`, `🧾 Transactions`/`Inventory Log` (inventory role + admin); `📦 My Material` (engineer, service_eng) |
| Notifications | bell icon / `myNotifs()` — present for every role, not a menu item |
| Reports/Exports | `📊 Reports` (super); per-module `⬇ Report` CSV buttons scattered across Enquiry/SO/Project/ServiceCall/Contract/Payments/Inventory screens |

**NEW APP frontend**:
- **Existing application structure**: `new-app/frontend/` contains
  exactly one file — `README.md` — which states in its own words:
  *"Placeholder only — no code yet... will later become the new employee
  PWA... Phase 8 of the plan."* `find frontend -type f` returns only that
  one file. There is no `package.json`, no source directory, no build
  tooling, nothing else, confirmed by direct directory listing.
- **Implemented screens**: **NONE.** Zero screens of any kind exist under
  `new-app/frontend/`.
- **Missing screens**: **ALL of them** — every screen/feature listed in
  the table above (Accounts/Users, Enquiry, SalesOrder, Finance/Payments,
  Checklist, Project, Contract, ServiceCall [register, detail, assign,
  report, complete, CSV export, PM-due panel, open-calls widget],
  Inventory, Notifications, Reports/Exports) is missing from the frontend.
  This is stated plainly and not softened, per instruction.
- **API bindings available**: the backend (`new-app/backend/src/routes/`)
  exposes REST endpoints for: `authRoutes` (login/logout/me),
  `companyRoutes` (company create), `enquiryRoutes`, `salesOrderRoutes`,
  `projectRoutes`, `contractRoutes`, `serviceCallRoutes` (all 9 endpoints
  documented in the main doc's §"Routes"), `paymentRoutes`,
  `inventoryRoutes`, `checklistTemplateRoutes`, `notificationRoutes`. A
  frontend build for Enquiry, SalesOrder, Project, Contract, ServiceCall,
  Payment, Inventory, Checklist, and Notification screens has a real API
  to bind against today.
- **API bindings missing**: there is **no user-management route file at
  all** — `ls src/routes/` lists no `userRoutes.js`, and neither
  `companyRoutes.js` nor `authRoutes.js` exposes any create/list/update
  endpoint for `User` records (only `companyRoutes.js`'s single
  `POST /` company-create, and `authRoutes.js`'s login/logout/me). The
  PWA's `👥 Users` screen (admin: create/edit/disable users, assign
  roles) therefore has **no backend API to bind to yet** — this is a real,
  pre-existing gap the frontend cannot work around, independent of
  ServiceCall. There is also no dedicated Reports/Dashboard aggregation
  endpoint (the PWA's `super`-only `📊 Reports`/`📈 Client Business`/
  `💵 Revenue` screens) — each PWA report is a client-side CSV built from
  already-fetched per-module lists, so this is not necessarily a missing
  binding so much as an undecided one; flagged as **OPEN/NOT
  DETERMINABLE** rather than assumed either way, since no `new-app/docs`
  file was found deciding it.
- **Highest-priority integration gaps** (ranked, factual — not a build
  recommendation):
  1. **No frontend exists at all** — this blocks every other item; the
     backend is materially ahead of the frontend for every module
     inspected in this pass.
  2. **No User-management API** — blocks the Accounts/Users screen
     specifically, and is also a prerequisite most other screens need
     indirectly (engineer-candidate pickers, PM/manager assignment
     dropdowns, "assigned by" displays all read User records — the
     ServiceCall assignment UI itself needs a users-list endpoint that
     does not yet exist as a general-purpose route, only as the narrow
     `userRepoForEnquiry` internal dependency used by services like
     `serviceCallService.js`/`enquiryService`, not exposed over HTTP).
  3. **ServiceCall's own frontend** (register, assign, report/signature
     pad, complete, CSV export, PM-due trigger) has full backend support
     already (9 routes, verified in this pass) and is ready to build
     against as soon as a frontend project exists — no backend blocker
     specific to ServiceCall was found.

---
