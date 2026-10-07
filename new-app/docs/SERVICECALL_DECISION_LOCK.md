# ServiceCall Decision Lock

Status: DOCUMENTATION-ONLY. No ServiceCall implementation (service/routes/controllers/tests) exists or was created by this task. This document formally resolves every open item raised by `new-app/docs/PWA_COVERAGE_AUDIT_SERVICECALL.md` §26, so that a future implementation task has no ambiguity left to interpret on its own.

## 1. Purpose

`PWA_COVERAGE_AUDIT_SERVICECALL.md` produced 13 open items (§26) that a future ServiceCall implementation would otherwise have to interpret unsupervised. This document closes that gap: for every item, it records the PWA fact, the resolved decision, its classification, the concrete implementation consequence, and the reason — following the same "decision lock" pattern already established by `PROJECT_DECISION_LOCK.md` and `CONTRACT_DECISION_LOCK.md`. The governing default principle, applied throughout: **PWA behavior is preserved exactly unless the deviation falls into an already-approved infrastructure-only category** (MongoDB storage, durable ObjectIds, concurrency-safe server counters, hashed passwords, tenant isolation, real server-side authorization matching the PWA's own visible intent, transaction/concurrency safety, or storage adaptation genuinely required by the platform change). A bug or an awkward PWA behavior is not automatically fixed by appearing in this document — nothing is silently improved.

## 2. Source authority

- **Primary source of truth (unchanged):** `MEP_PROJECTS_PWA/index.html` (md5 `111b53dba91704f96b83dae96c7793c6`), via `PWA_COVERAGE_AUDIT_SERVICECALL.md` (558 lines, re-read in full for this task, not sampled).
- **Secondary sources consulted (read-only):** `new-app/docs/OPEN_DECISIONS.md` (current highest entry: #63, from the Contract consolidation), `new-app/docs/DOMAIN_MODEL.md` §6 (ServiceCall) and §7 (Contract), `new-app/docs/DATABASE_SCHEMA.md` §6 (`serviceCalls`) and §7 (`contracts`), `new-app/backend/src/models/ServiceCall.js`, `Contract.js`, `Payment.js`, `Notification.js`, `new-app/backend/src/services/contractService.js` (specifically `MANAGE_ROLES`, `assertCanManageContracts`, `assertCanCompletePmVisit`, `completePmVisitForContract`, `computePmDueIndexes`), `new-app/backend/src/services/paymentService.js` (specifically `LEDGER_ROLES`, `createManualPayment`, the `session`/transaction pattern used by `addPartPayment`), and `new-app/backend/src/repositories/businessRepositories.mongoose.js` (the `{ _id, companyId }` tenant-scoping pattern and the `session`-threaded write pattern used by every existing repository method).
- `ARCHITECTURE.md` was checked and does **not** exist in `new-app/docs/`; no substitute was needed since `DOMAIN_MODEL.md`/`DATABASE_SCHEMA.md` already carry the architectural facts this task needs.
- No PWA source line was re-derived from memory; every fact restated below is traceable to a specific line-numbered citation already captured in `PWA_COVERAGE_AUDIT_SERVICECALL.md`.

## 3. Safety constraints

This task is documentation-only, exactly as constrained:
- No `serviceCallService.js`, `serviceCallRoutes.js`, controller, or test file may be created.
- `Contract.js`, `Payment.js`, `Notification.js`, `ServiceCall.js`, `contractService.js`, `paymentService.js`, `businessRepositories.mongoose.js`, and every other source file outside `new-app/docs/` remain untouched.
- `MEP_PROJECTS_PWA/index.html` and the root `index.html` copy remain untouched (md5 `111b53dba91704f96b83dae96c7793c6` verified unchanged both before and after, §26 below).
- `v2/` and `v3/` remain untouched (git diff counts re-verified unchanged, §26 below).
- Files created/updated by this task: `new-app/docs/SERVICECALL_DECISION_LOCK.md` (new), `new-app/docs/OPEN_DECISIONS.md` (appended, #64 onward), `new-app/docs/DOMAIN_MODEL.md` and `new-app/docs/DATABASE_SCHEMA.md` (narrow, ServiceCall-specific additions only — no unrelated section touched).
- Nothing is staged or committed by this task.

## 4. Entity lock

The 15-field ServiceCall entity shape documented in the audit's §3 is locked as-is; no field is added, removed, or renamed beyond what the existing schema (`ServiceCall.js`) already reflects. Specifically locked:
- `id`/`co`/`psc` → `_id`/`companyId`/`complaintNumber` (already the schema's naming, PRESERVE PWA semantics, INFRASTRUCTURE-ONLY storage form).
- `type`, `status` enums locked exactly as the PWA's two/four values (`Complaint`/`PM`; `Registered`/`Assigned`/`Scheduled`/`Completed`) — no additional enum value is authorized by this document.
- `eng` → `engineerId` (Decision #4 below).
- `report` remains a single nullable nested subdocument, wholesale-replaced on every save (PRESERVE PWA — no draft history/versioning is authorized here; see Decision #6 in the audit's own open list, left genuinely open, §25).
- `contractId` remains a plain one-directional reference (PRESERVE PWA — no reverse array on Contract, consistent with `CONTRACT_DECISION_LOCK.md` Decision 12).

## 5. PSC numbering lock

- **PWA fact:** `id`/`psc` are two separate, together-incremented, client-side, non-atomic counters (`DB.seq.call`/`DB.seq.psc`); `syncSeq()`'s PSC-max scan has no `co` filter, so PSC is effectively a global (non-per-tenant) sequence at the PWA's storage layer.
- **Decision:** the durable Mongo `_id` replaces `id`; `complaintNumber` (PSC-equivalent) is generated via the existing `Counter.js`/`getNextSequence(companyId, 'serviceCall')` primitive, which is **already** `companyId`-scoped (per-tenant), not global.
- **Classification:** INFRASTRUCTURE-ONLY (approved category: concurrency-safe server counters).
- **Implementation consequence:** every company gets its own PSC sequence starting from 1 (or from whatever seed/migration value is chosen at implementation time — that seeding question is out of scope for this document). The PWA's accidental cross-tenant sharing is **not** reproduced; this is the one place the human-facing number's exact numeric value necessarily diverges from what the PWA would have produced in a genuinely multi-tenant deployment, because the PWA's own behavior here was already a bug, not an intentional numbering scheme. The **observable format** (`"PSC-"+n` or `"PSC "+n` depending on template, §17 below) and the **monotonic, gapless-per-company, never-reused** nature of the number are preserved.
- **Reason:** tenant-scoped, atomic sequence generation is explicitly in the pre-approved infra list; preserving the PWA's global-sequence bug would conflict with the separately-mandatory tenant-isolation requirement (§20 lock below) and serves no business purpose — nothing in the PWA ties PSC numbers across companies to any observable business rule (customers never compare PSC numbers across companies).

## 6. Complaint workflow lock

- **PWA fact (§5/§6):** `mCall()` with no `contractId` → "Register Service Complaint" modal → `saveCall()` with only `customer` name required (blank-tolerated `phone`/`site`/`complaint`) → new record with `type:"Complaint"`, `status:"Registered"`, `eng:""`, `report:null`, `sig:""`.
- **Decision:** PRESERVE PWA exactly. The only enforced creation validation is a non-blank customer name; no other field is required.
- **Classification:** PRESERVE PWA.
- **Implementation consequence:** the future `createServiceCall`-equivalent function must reject only a blank/missing `customer`, and must not require `phone`, `site`, or `complaintDescription`.
- **Reason:** this is a demonstrated, deliberate PWA business rule (the UI's own single `toast()` guard), not an oversight to be hardened.

## 7. PM workflow lock

- **PWA fact (§5/§6/§12):** `mCall(contractId)` → "Schedule PM" modal, pre-filled `customer`/`phone`/`site` from the Contract (copied only on save, not linked live) → `saveCall(contractId)` → new record with `type:"PM"`, `status:"Scheduled"`, `contractId` set, `date`/`time` captured from the modal (optional, unvalidated).
- **Decision:** PRESERVE PWA exactly, including the lack of any Contract-validity/status check at PM-call-creation time (the PWA only checks `if(c)` existence, never expiry) and the lack of any duplicate-PM-call-against-the-same-slot prevention.
- **Classification:** PRESERVE PWA.
- **Implementation consequence:** the future PM-creation path may reuse `contractService.js`'s existing `getContract`/`getPmDuePanel` for the "which contracts have due slots" listing (already `COVERED` per the audit's §24), but must not add a Contract-status gate or a duplicate-slot guard beyond what those existing Contract-side functions already do incidentally.
- **Reason:** the audit (§13) explicitly verified both the absent-validity-check and absent-duplicate-guard as PWA facts, not omissions worth correcting; §26.5 of the audit already flags "no PWA action exists for deletion/cancellation" as an open, not a defect to silently fix — the same principle applies here to duplicate-prevention.

## 8. Assignment lock

- **PWA fact (§7):** only `service_mgr`/`admin` (`isMgr`) can assign, only while `status!=="Completed"`; candidate pool is `service_eng`/`engineer`/`service_mgr`, company-scoped, no division filter; status flips `"Registered"→"Assigned"` only from `"Registered"` (so PM calls, starting at `"Scheduled"`, never visually become `"Assigned"`); `notify(["*"], ...)` fires on every save where the resulting `eng` is truthy, with no dedup.
- **Decision:** PRESERVE PWA for every one of the above semantics. The storage mechanism for "who is assigned" moves from a name-string match to a durable `engineerId` ObjectId (already scaffolded on `ServiceCall.js`, `ref: 'User'`), mirroring the precedent already set for Project's engineer assignment (`OPEN_DECISIONS.md`/`DOMAIN_MODEL.md`'s "User Reference Migration" pattern) — but the **visible behavior** an engineer experiences (seeing exactly the calls currently assigned to them) must be identical to the PWA's `s.eng===U.name` outcome.
- **Classification:** PRESERVE PWA (semantics: candidate-pool composition, no-division-filter, status-transition quirk, notification-fan-out-and-duplication behavior) / INFRASTRUCTURE-ONLY (storage: name-string → `engineerId` ObjectId).
- **Implementation consequence:** the assignment function must (a) restrict itself to `MANAGE_ROLES`-equivalent (`admin`/`service_mgr`) callers, mirroring `contractService.js`'s `assertCanManageContracts` pattern exactly; (b) resolve the candidate pool as every company user whose role is in `['service_eng','engineer','service_mgr']` with **no** division filter; (c) apply the `"Registered"→"Assigned"` transition rule verbatim, including the fact that PM calls never transition through this path; (d) fire an all-roles (`"*"`) notification on every save that leaves `engineerId` non-null, with no deduplication against a prior identical assignment.
- **Reason:** items #4, #5, #6, #7, #8/#19 of the audit's §21 quirks list are each independently verified PWA facts, not defects; the engineer-identity storage change is the one explicitly pre-approved infra category (durable ObjectIds), already established as precedent for Project.

## 9. Report lock

- **PWA fact (§8):** the report subdocument (`make`, `model`, `capacity`, `rtype`/`type`, `material`/`materialUsed`, `service`/`serviceDescription`, `chk`/`checklistResults`, `stype`/`serviceType`, `amount`, `remark`/`engineerRemark`, `custRemark`/`customerRemark`) is optional in every field except that `stype` has an initial render-time default (`"AMC"` for PM, `"Chargeable"` for Complaint) which is not enforced afterward; every `saveReport()` call — draft or complete — replaces the entire subdocument, never merges.
- **Decision:** PRESERVE PWA exactly: no field is made mandatory beyond what the PWA enforces (none, at the report-field level); whole-object replacement semantics are preserved (no partial-field-merge API is to be built); the `stype` default-by-type is preserved as a client-presentation default only, not a server-enforced rule tying `type` to `serviceType`.
- **Classification:** PRESERVE PWA.
- **Implementation consequence:** a "save draft" operation must accept a full report object and overwrite the existing one wholesale (not `$set` per-field merge in a way that would leave stale fields from a prior draft); no field-level required-validators beyond the schema's existing type/enum constraints are to be added at the service layer.
- **Reason:** directly verified in §8/§11 of the audit; inventing field-level requirements the PWA never had would be a silent business-rule addition, explicitly forbidden by the task's default principle.

## 10. Checklist lock

- **PWA fact (§9):** `SVC_CHK` is the fixed, ordered 6-item array `["Cooling Testing","Gas Pressure","Filter Clean","Indoor Coil","Outdoor Coil","Body Cleaning"]`; each item is a free-text result (not boolean/checkbox), entirely optional, with no gate preventing a blank checklist at completion.
- **Decision:** the six keys are locked as the **only** keys the checklist form is intended to populate, but — confirmed by re-reading the audit's §9/§24/§26.13 — the PWA itself never rejects or filters out an arbitrary key, because the checklist UI only ever renders exactly six fixed inputs (`r_c0`..`r_c5`) bound to those six exact labels; there is no code path by which a seventh key could even be submitted through the PWA's own UI. Given that, enforcing the six keys as a closed `enum` at the schema/service layer does not narrow anything a real PWA user could do — it only closes a door that a raw/scripted API call could otherwise open, which the PWA's own UI never exposed.
- **Classification:** INFRASTRUCTURE-ONLY (schema validation / API-surface hardening, not a business-rule change, since the PWA's UI never allowed anything but these six keys).
- **Implementation consequence:** `report.checklistResults` should be validated (at the service layer, when ServiceCall is eventually implemented) against the fixed six-key set, rejecting or ignoring any other key submitted via the API — this is a **change from the current schema comment**, which deliberately left the `Map<String,String>` unconstrained; this document overrides that comment's stated rationale now that the full PWA source has been independently re-verified to show the six keys are exhaustive at the UI layer. Values remain free-text strings (not boolean), exactly as the PWA has them — only the **key set** is locked, not the value type.
- **Reason:** confirmed per the coordinator's specific instruction to verify the PWA doesn't allow arbitrary keys before locking this way — re-reading §9 of the audit shows the six-input form is the sole write path in the PWA, so constraining keys server-side reproduces the PWA's own closed set rather than inventing a new restriction.

## 11. Signature lock

- **PWA fact (§10):** signature is a base64 PNG data URI captured from an HTML canvas, stored directly as `s.sig`; mandatory only at completion (`if(_sg&&_sg.empty){toast(...);return}` inside the `complete` branch), never checked on draft save; clearable/redrawable any number of times pre-completion via `clearSig()`; no size limit, no compression, no separate blob store.
- **Decision:** PRESERVE PWA's observable behavior — signature required only to complete, not to draft-save; no artificial size cap or format restriction beyond what a PNG data URI already implies. The **storage location** of the image data (inline in the document vs. a dedicated object-storage reference) is left as an infrastructure choice for whoever implements ServiceCall, exactly as already flagged for Project's checklist photos (`PROJECT_DECISION_LOCK.md` Decision 8's precedent) — but whichever storage is chosen, the API-observable behavior (append/persist a signature at completion, no business-level size limit, no delete/clear-after-complete function) must remain equivalent.
- **Classification:** INFRASTRUCTURE-ONLY (storage representation) with PRESERVE PWA (observable behavior: mandatory-at-completion-only, no size limit, no post-completion clearing).
- **Implementation consequence:** whether `clientSignatureImage` stays a plain `String` (as `ServiceCall.js` currently has it) or moves to an object-storage reference is an implementation-time choice, not fixed by this document; either way, the completion-guard behavior described above and the absence of a "clear signature after completion" function are both locked as PRESERVE PWA.
- **Reason:** matches the audit's own §26.7 framing and the coordinator's explicit classification for this item.

## 12. Completion lock

- **PWA fact (§11):** the verified order of effects is: rebuild `chk` (no gate) → rebuild/replace `report` (no gate) → signature check (sole hard guard) → set `sig` → set `status="Completed"` → conditionally update Contract's `due[0]` slot (`if(contractId)`) → conditionally create Chargeable Payment (`if(stype==="Chargeable"&&amount>0)`) → unconditional internal notification → `save()` → customer-message preview. No other guard exists (no checklist-completeness gate, no mandatory report field, no mandatory appointment date/time, no mandatory engineer-assigned gate, no mandatory nonzero amount beyond the Payment-creation condition itself, no Contract-validity check).
- **Decision:** PRESERVE PWA's guard set exactly — the **only** hard business guard for completion is a non-empty client signature. No additional guard (checklist completeness, mandatory engineer assignment, mandatory report fields, Contract validity) is to be introduced.
- **Classification:** PRESERVE PWA (guard set and business-visible order of effects) / INFRASTRUCTURE-ONLY (the underlying writes becoming one atomic transaction instead of the PWA's single in-memory blob write — see Decision #13/#15 below).
- **Implementation consequence:** the future completion function's only business-rule rejection path is "signature missing/empty"; every other condition (blank checklist, blank report, unassigned engineer completing, Contract already expired) must be **allowed to proceed**, exactly as the PWA allows it.
- **Reason:** directly and exhaustively verified in §11 of the audit ("Completion guards actually enforced ... and only these").

## 13. Chargeable-payment lock

- **PWA fact (§14):** Payment is created only `if(report.stype==="Chargeable"&&report.amount>0)`, with the exact fields `{project:"<site> (PSC-<psc>)", person:customer, phone, amount, remark:"Chargeable service call", lastCall:"", disc:"", nextCall:"", status:"Pending", soNo:""}`, and a `notify(["finance"], ...)` call; a negative or non-numeric amount is not rejected (silently coerces to `0` for non-numeric, or passes through unchanged if numerically negative).
- **Decision:** PRESERVE PWA's exact trigger condition, field values (including the hardcoded literal `remark` and the always-empty `soNo`), and the fact that negative amounts are not rejected at the business-rule level (the schema's `amount: { type: Number }` on `Payment.js` has no `min: 0` validator, and none is to be added as a business rule here — only a data-quality/UI-level warning, if any, would be a separate future decision, not this one). The **write itself** must go through the existing `paymentService.js`/`Payment` schema rather than any new bespoke insertion path.
- **Classification:** PRESERVE PWA (trigger condition, field values, amount-sign tolerance) / INFRASTRUCTURE-ONLY (wrapping the ServiceCall-status-write + Contract-slot-write + Payment-creation-write in one transaction, using the same `session`-threaded pattern already established in `paymentService.js`'s `addPartPayment`/`businessRepositories.mongoose.js`, so a partial failure cannot leave a Completed ServiceCall with no Payment or vice versa).
- **Implementation consequence:** the completion function must build the Payment record with `projectOrReference = "<site> (PSC-<complaintNumber>)"`, `personName = customer`, `remark = "Chargeable service call"` (literal), `salesOrderId = null`, `status = "Pending"`, and must not add a `min: 0` amount guard; the surrounding writes (ServiceCall status update, Contract slot update via `completePmVisitForContract`, Payment creation, both notifications) should be wrapped in a single Mongo transaction using the repository layer's existing `session` parameter convention.
- **Reason:** this is precisely the pre-approved "transaction/concurrency safety" infra category named in the original ServiceCall audit task instructions — it changes only how the writes are committed, not what they contain or when they fire.

## 14. Contract integration lock

- **PWA fact (§12):** at PM-ServiceCall creation, only `customer`/`phone`/`site` are copied from the Contract (one-time, not live-linked); Contract has no reverse ServiceCall list; multiple ServiceCalls per Contract are unrestricted; `contractService.js`'s existing `completePmVisitForContract` already exists as the Contract-facing half of completion.
- **Decision:** PRESERVE PWA exactly — no reverse `serviceCallIds[]` array is added to `Contract.js` (consistent with `CONTRACT_DECISION_LOCK.md` Decision 12); the future ServiceCall completion function must call the **existing** `contractService.completePmVisitForContract(contractId, actorAuth, deps, { assignedEngineerUserId })` rather than reimplementing Contract-slot logic — this function is already built, already reproduces the exact PWA quirk (§15 below), and is exported for this reuse.
- **Classification:** COVERED / PRESERVE PWA (no new code needed here beyond calling the existing function).
- **Implementation consequence:** the ServiceCall completion service, when built, takes a dependency on `contractService.js` and calls `completePmVisitForContract` exactly as its own doc comment (already present in `contractService.js`, "DEFERRED: SERVICECALL-FACING BOUNDARY") describes; no `contractRoutes.js` route is to be added exposing this directly, per that same existing comment.
- **Reason:** this integration point was already designed and built ahead of ServiceCall's own implementation, specifically to be called this way; re-verified present and correct in `contractService.js` lines 493–520 during this task.

## 15. PM due-slot lock

- **PWA fact (§12, the audit's own "CRITICAL QUIRK"):** `pmDue(c)` is recomputed **fresh at completion time**, and `due[0]` — the first currently-due-or-overdue slot **at that moment**, not the slot the ServiceCall was originally scheduled against — is the one stamped done. No slot index is ever stored on the ServiceCall itself.
- **Decision:** PRESERVE PWA exactly, bug-for-bug. This is the single most important "DO NOT FIX" in this entire document. `contractService.js`'s existing `completePmVisitForContract` **already implements this precisely** (confirmed: `computePmDueIndexes(contract); ...; due[0]`) — no change is needed or authorized to make the stamped slot "smarter" (e.g. by adding a `visitIndex` reference on ServiceCall to make the stamp specific to the triggering visit).
- **Classification:** PRESERVE PWA — explicit DO NOT FIX.
- **Implementation consequence:** a future ServiceCall schema must **not** add a `visitIndex`/`scheduledVisitIndex` field intended to make Contract-slot completion specific to the originating visit; any implementer must call `completePmVisitForContract` exactly as built, accepting that out-of-order completions can mark the "wrong" (in a business-intuitive sense) slot, exactly as the PWA does.
- **Reason:** already locked once, from the Contract side, as `CONTRACT_DECISION_LOCK.md` Decision 4 and `OPEN_DECISIONS.md` #52 — this entry is a ServiceCall-side cross-reference confirming no ServiceCall-side change should ever be made to defeat that lock (e.g. by giving ServiceCall a slot pointer that a future ServiceCall-side implementer might be tempted to use instead of calling the shared function as designed).

## 16. Notification lock

- **PWA fact (§15):** five distinct notification events (complaint-registered, PM-scheduled, assignment, chargeable-payment-created, completion), each using the shared `notify(roles, text)` mechanism (role-list or `"*"`, company-scoped, appended to `DB.notifs` before `save()`), with verbatim exact text as catalogued in the audit; no dedup on any of them.
- **Decision:** PRESERVE PWA exactly — recipients (`["service_mgr","admin"]`, `["*"]`, `["finance"]` as appropriate per event), exact text templates (substituting real values), and the complete absence of deduplication are all locked as-is. The underlying **mechanism** (a `Notification` document with `targetRoles`/`text`/`companyId`, matching the `Notification.js` schema already built) is the same mechanism already used — or, per the audit's own §24 finding, **not yet wired up even for Contract** — by every other implemented module; ServiceCall's eventual implementation should use whatever shared notification-creation helper is adopted project-wide (there being no such helper actually wired into `contractService.js` yet, despite the `Notification` model already existing) rather than inventing a ServiceCall-specific one.
- **Classification:** RESOLVED — EXISTING PROJECT RULE (the notification-recipient-resolution shape — role-list-or-`"*"`, company-scoped, append-only, no dedup — is the same shape already designed into the shared `Notification` schema, not a new ServiceCall-specific mechanism) combined with PRESERVE PWA (exact recipients/wording per event).
- **Implementation consequence:** whichever notification-creation call ServiceCall's future implementation uses, it must pass exactly the role sets and text templates documented in the audit's §15 table, unchanged, and must not add deduplication logic that the PWA itself does not have.
- **Reason:** the coordinator's classification is confirmed correct on re-reading §15/§24 of the audit: the `Notification` model's shape already matches the PWA's `notify()` semantics field-for-field; only the wiring (a service actually calling `Notification.create`) remains unbuilt anywhere in the codebase, including for the already-implemented Contract/Payment modules — this is a pre-existing project-wide gap, not something specific to ServiceCall to solve differently.

## 17. Customer-message lock

- **PWA fact (§16):** four verbatim templates (`msgReg`, `msgPM`, `msgDone`, `msgPMdone`); "sending" is exclusively a preview modal with a copy-to-clipboard button and, if a phone number is present, a WhatsApp deep-link (`https://wa.me/91<phone>?text=...`) — there is **no** SMS/email provider integration anywhere in this code path, despite the modal's own subtitle claiming "sent to customer." `msgDone` uses `"PSC-"+psc` (hyphen) while `msgReg`/`msgPM`/`msgPMdone` use `"PSC "+psc` (space) — an inconsistency, not a rule.
- **Decision:** PRESERVE PWA verbatim — the four message bodies are locked exactly as quoted in the audit's §6/§16, including the `"PSC-"` vs `"PSC "` inconsistency, which is **not** to be normalized. The preview + copy/WhatsApp-handoff delivery model is preserved; no automated SMS/email/WhatsApp-API send is authorized by this document (that remains the genuinely open, green-field product question already recorded as the audit's §26.12 and cross-indexed at `DATABASE_SCHEMA.md` §6's existing note and `OPEN_DECISIONS.md` #11).
- **Classification:** PRESERVE PWA — explicit DO NOT FIX (the punctuation inconsistency specifically).
- **Implementation consequence:** if/when message templates are exposed as backend-configurable text (already proposed as a storage-representation idea in `DATABASE_SCHEMA.md` §6, not decided here), the **default seed content** for `msgDone` must retain `"PSC-"` and the other three must retain `"PSC "`, unless a human product decision is separately made to normalize them — this document does not make that call.
- **Reason:** matches the coordinator's explicit instruction and the audit's own §21 item 25 characterization of this as a demonstrated PWA inconsistency, not a business rule.

## 18. Search/report lock

- **PWA fact (§17):** `vService()` searches nine fields (`psc,type,customer,phone,site,status,eng,regDate,date,complaint`) case-insensitively, reversed (newest-insertion-first, not a true date sort); `openCallsPanel()` excludes Completed calls; `dlService()` exports 22 exact columns in natural (non-reversed) order, sums every report's `amount` regardless of `stype` into a trailing TOTAL row, and reflects whatever search filter is currently active.
- **Decision:** PRESERVE PWA exactly — the same nine searchable fields, the same insertion-order-reverse "sort" (not a real date sort), the same 22-column CSV shape, and the same all-amounts-regardless-of-type CSV total behavior.
- **Classification:** PRESERVE PWA.
- **Implementation consequence:** a future list/search endpoint must not introduce true date-based sorting as a silent "improvement" over insertion-order; a future CSV export must sum every report's `amount` field into its total, not only Chargeable-and-Payment-eligible ones, exactly as the PWA does.
- **Reason:** directly verified in §17/§21 items 23–24 of the audit.

## 19. Role/access lock

- **PWA fact (§18):** register/complaint-button/PM-schedule/assignment are `admin`/`service_mgr` only; report editing/completion is the assigned engineer (name-match) or `admin`/`service_mgr`; the completed-report **read-only view has no role gate at all** once a user can reach the record; every check is client-side only.
- **Decision:** PRESERVE PWA's visible role intent exactly, enforced server-side instead of client-side-only (the mandatory infra adaptation), with no broader and no narrower permission than the table in §18 describes. Concretely: creation/assignment/PM-scheduling restricted to `admin`/`service_mgr` (an equivalent `MANAGE_ROLES`-style constant, mirroring `contractService.js`'s own `MANAGE_ROLES = ['admin','service_mgr']`); report editing/completion open to the assigned engineer or `admin`/`service_mgr` (mirroring `contractService.js`'s own `assertCanCompletePmVisit` pattern verbatim); the completed-report **read** path gets **no additional role restriction** beyond the mandatory tenant scoping (§20 below) — i.e. do not add a role gate to viewing a completed report that the PWA itself never had, beyond requiring the viewer be authenticated within the same company.
- **Classification:** INFRASTRUCTURE-ONLY (moving an already-visible-in-the-PWA role intent from client-only to server-enforced) — same precedent already applied to SalesOrder/Payment (`OPEN_DECISIONS.md` #22) and to Contract (`CONTRACT_DECISION_LOCK.md` Decision 6).
- **Implementation consequence:** reuse the exact role-constant pattern already established in `contractService.js` (`MANAGE_ROLES`, `assertCanManageContracts`, `assertCanCompletePmVisit`) rather than inventing a new authorization scheme for ServiceCall.
- **Reason:** this is the identical, already-precedented infra pattern the coordinator named, and re-reading §18 confirms the PWA's own intent is exactly reproduced by that existing pattern with no extension.

## 20. Tenant/security lock

- **PWA fact (§20, "the single most significant PWA-source weakness found in this module"):** `vCall()`'s lookup (`DB.svcCalls.find(x=>x.id===PARAM)`) has **no** `co===U.co` check whatsoever — any authenticated user, regardless of company, can view any other tenant's ServiceCall detail (customer name, phone, site, complaint, full report, signature image) by navigating to a known/guessed id.
- **Decision:** mandatory server-side company/tenant scoping on every ServiceCall read/list/detail endpoint, using the same `{ _id: id, companyId }` repository-query pattern already used by every other implemented module (`Payment.findOneAndUpdate({ _id: id, companyId }, ...)`, `Contract`'s equivalent, etc.). A cross-tenant id lookup must behave the same way the codebase's existing pattern already behaves elsewhere (a `{ _id, companyId }` compound query naturally yields "not found" for a wrong-company id — no separate 403-vs-404 design decision is needed beyond following the existing repository convention already established for every other collection).
- **Classification:** INFRASTRUCTURE-ONLY — mandatory, non-optional (tenant isolation is in the pre-approved list, and this PWA weakness is directly demonstrated in the source, not hypothesized). This document does **not** turn this into any new business-facing restriction beyond company scoping — no additional visibility narrowing (e.g. by division, by "only my own calls") is introduced here.
- **Implementation consequence:** every ServiceCall repository method must take and apply `companyId` exactly as `businessRepositories.mongoose.js`'s existing methods for Contract/Payment/Project already do; this closes §26.3 of the audit ("what error/behavior results for a cross-tenant id") by simply following the existing project-wide convention rather than inventing a ServiceCall-specific one.
- **Reason:** directly demonstrated cross-tenant exposure in the PWA's own code, and the fix is not a new pattern — it is the same pattern already used everywhere else in `new-app`.

## 21. PWA quirks explicitly preserved

The following, each independently verified in the audit's §21, are locked as **explicit DO NOT FIX** items — a future implementation must reproduce each exactly, not "improve" it:

1. Separate `id`/`psc` counters, numerically unrelated (superseded in numeric-value terms only by the per-company Counter migration, §5 above — the *behavior* of "two independent-feeling sequences" is not something to reconcile further).
2. PM-type calls never transition to `"Assigned"` status via the assignment function (§8 above) — status stays `"Scheduled"` even after an engineer is set.
3. Assignment notification fires on every re-save with a non-blank engineer, with no dedup (§8/§16 above).
4. `service_mgr` is itself a valid "engineer" assignment candidate (§8 above).
5. No division filtering in the ServiceCall engineer candidate pool (§8 above) — left this way pending the genuinely open Decision in §25 below (item 2), not silently narrowed or widened.
6. Draft reports and completion are allowed with an entirely blank checklist, blank report fields, no engineer assigned, and no valid appointment date/time (§9/§12 above) — the only hard guard is a non-empty signature.
7. Negative or non-numeric report amounts are not rejected (§13 above).
8. The `due[0]` PM-slot-stamping quirk (§15 above) — the single most important DO NOT FIX in this document.
9. No reverse Contract→ServiceCall list, and no duplicate-PM-call prevention (§7/§14 above).
10. No re-completion guard exists in the PWA's own code (`saveReport(id,true)` has no `if(status==="Completed")return`) — this specific absence is recorded as a genuinely open decision (§25 item 4 below), not silently locked either way, because unlike the other items in this list it represents an unintentional code gap the PWA's own UI happens to mask, rather than a demonstrated deliberate behavior with clear customer/business-facing consequences either way.
11. CSV total sums every report's `amount`, not only Chargeable/Payment-eligible ones (§18 above).
12. List sorting is insertion-order-reverse, not a true date sort (§18 above).
13. The `"PSC-"` (hyphen, in `msgDone` only) vs. `"PSC "` (space, everywhere else) inconsistency (§17 above).
14. No delete/cancel/reopen action of any kind exists for a ServiceCall — this absence is preserved; no such action is introduced.
15. "Sent to customer" messaging is preview + copy/WhatsApp-handoff only; no real delivery integration is added by this document.

## 22. Infrastructure-only adaptations

The complete, closed list of infrastructure-only adaptations authorized for ServiceCall by this document — nothing broader is authorized:

1. MongoDB/Mongoose document modeling (already reflected in `ServiceCall.js`).
2. Durable ObjectIds in place of PWA integer ids (`_id`, `companyId`, `engineerId`, `contractId` — already present in the schema).
3. Server-generated, concurrency-safe, per-company `complaintNumber` counter via the existing `Counter.js`/`getNextSequence` primitive (§5 above), narrowing the PWA's accidental global PSC sharing to per-tenant.
4. Server-side authorization matching the PWA's own visible role intent (§19 above), reusing the existing `MANAGE_ROLES`/`assertCanManageContracts`/`assertCanCompletePmVisit` pattern from `contractService.js`.
5. Mandatory server-side tenant/company scoping on every read/list/detail path (§20 above), reusing the existing `{ _id, companyId }` repository-query convention.
6. Transaction/concurrency safety around the ServiceCall-status + Contract-slot + Payment-creation write sequence at completion (§13 above), reusing the existing `session`-threaded pattern from `paymentService.js`/`businessRepositories.mongoose.js`.
7. Storage-representation choice for the client signature image (inline string vs. object-storage reference), provided the observable API behavior stays equivalent (§11 above).
8. Enforcing the six fixed `SVC_CHK` keys as a closed set at the schema/service layer for `report.checklistResults` (§10 above), since the PWA's own UI never permitted any other key.
9. Hashed passwords / durable `User` identity for the engineer-identity mapping underlying `engineerId` (§8 above) — already established company-wide via the existing Auth foundation, not a new ServiceCall-specific decision.

## 23. Explicitly forbidden redesigns

The following are explicitly **not** authorized by this document, regardless of how reasonable they might seem as improvements — a future implementer must not introduce any of these without a separate, explicit business decision:

1. Adding a checklist-completeness gate to completion.
2. Adding a mandatory-engineer-assigned gate to completion.
3. Adding a mandatory-report-field gate (make/model/capacity/etc.) to completion.
4. Adding a Contract-validity/expiry check before marking a PM slot done.
5. Adding a `visitIndex` field on ServiceCall to make Contract-slot completion specific to the originating visit (this would defeat the explicitly-locked `due[0]` quirk, §15 above).
6. Adding a reverse `serviceCallIds[]` array or virtual populate on `Contract`.
7. Adding duplicate-PM-call prevention against an already-scheduled slot.
8. Adding a `min: 0` validator or any other business-level rejection of a negative/zero Chargeable amount.
9. Normalizing the `"PSC-"` vs `"PSC "` punctuation inconsistency across message templates.
10. Introducing true date-based sorting in place of the PWA's insertion-order-reverse list behavior.
11. Narrowing the CSV total to only Chargeable/Payment-eligible amounts.
12. Adding division filtering to the ServiceCall engineer candidate pool.
13. Adding any delete/cancel/reopen action for a ServiceCall.
14. Adding real SMS/email/WhatsApp-API automated delivery in place of the preview + copy/WhatsApp-handoff model.
15. Adding a role gate to the completed-report **read** path beyond ordinary company-tenant scoping.

## 24. Final resolved decision table

Restates the audit's own 13-item §26 list, each individually re-verified against the audit and the current `new-app` codebase during this task, per the required Decision-format.

**Decision 1 — SVC_CHK enum enforcement**
Question: should `report.checklistResults` keys be constrained to the six fixed `SVC_CHK` labels, or remain an unconstrained `Map<String,String>` as currently modeled?
PWA fact: the checklist form renders exactly six fixed inputs (`r_c0`..`r_c5`) bound to the six `SVC_CHK` labels; no PWA code path can submit any other key.
Decision: enforce the six keys as a closed set at the schema/service layer.
Classification: INFRASTRUCTURE-ONLY.
Implementation consequence: `checklistResults` validation rejects/ignores any key outside the fixed six; values remain free-text strings.
Reason: closes an API surface the PWA's own UI never exposed; not a business-rule narrowing since no genuine PWA user flow is affected.

**Decision 2 — Cross-tenant read exposure in `vCall()`**
Question: how should the new backend prevent the PWA's demonstrated cross-tenant ServiceCall detail exposure?
PWA fact: `vCall()`'s lookup has no `co===U.co` check.
Decision: mandatory `{ _id, companyId }` scoping on every read/list/detail path, following the existing project-wide repository convention.
Classification: INFRASTRUCTURE-ONLY, mandatory.
Implementation consequence: no new business restriction is added beyond company scoping; no division/role-based read-narrowing is introduced.
Reason: directly demonstrated PWA weakness; fix reuses an existing pattern, invents nothing new.

**Decision 3 — Per-company atomic PSC counter vs. PWA's global resequencing**
Question: should the human-facing PSC-equivalent (`complaintNumber`) be generated globally (matching the PWA's actual, buggy behavior) or per-company?
PWA fact: `syncSeq()`'s PSC-max scan has no `co` filter, making PSC global at the PWA's storage layer, distinct from the `co` field's own correct per-record tenant tagging.
Decision: per-company, via the existing `Counter.js`/`getNextSequence(companyId,'serviceCall')` primitive (already built, already registered).
Classification: INFRASTRUCTURE-ONLY.
Implementation consequence: PSC numbering diverges numerically from what a genuinely multi-tenant PWA deployment would have produced (each company now gets its own 1-based sequence); the observable format (`PSC-<n>`/`PSC <n>`) and monotonic-never-reused nature are unaffected.
Reason: the PWA's global sharing was itself an accident of its single-shared-array storage model, not an intentional numbering scheme with any observed business consequence; per-company atomic counters are in the pre-approved infra list.

**Decision 4 — Durable `engineerId` vs. name-string matching**
Question: how should engineer ownership be stored and checked?
PWA fact: `s.eng===U.name`, a plain string equality with no referential integrity.
Decision: durable `engineerId` ObjectId (already scaffolded), preserving identical visible ownership semantics (an engineer sees exactly the calls currently assigned to their `engineerId`).
Classification: INFRASTRUCTURE-ONLY (storage mechanism) / PRESERVE PWA (visible semantics) — same precedent as Project's engineer assignment.
Implementation consequence: "my calls" queries filter by `engineerId === currentUser._id` instead of by name string; no other behavior changes.
Reason: matches the already-established, already-precedented Project pattern exactly.

**Decision 5 — `service_mgr` as a valid engineer-candidate role**
Question: should `service_mgr` remain eligible for assignment as "the engineer" on a ServiceCall?
PWA fact: `["service_eng","engineer","service_mgr"]` is the exact candidate list.
Decision: preserve exactly — `service_mgr` remains a valid candidate.
Classification: PRESERVE PWA.
Implementation consequence: no role is excluded from the candidate pool beyond what the PWA itself excludes (i.e. the PM-division roles and all non-service roles remain excluded, exactly as observed).
Reason: directly verified in §19 of the audit; not a bug, an observed intentional inclusion.

**Decision 6 — PM-type calls never visually transitioning to "Assigned"**
Question: should this status-transition gap be fixed so PM calls show "Assigned" once an engineer is set?
PWA fact: the transition condition only fires from `"Registered"`; PM calls start at `"Scheduled"` and never pass through it.
Decision: preserve exactly — do NOT fix.
Classification: PRESERVE PWA — explicit DO NOT FIX.
Implementation consequence: a PM ServiceCall's `status` field remains `"Scheduled"` right up until `"Completed"`, even with a non-null `engineerId`, in the new backend.
Reason: this is a demonstrated, verified PWA quirk; the coordinator's instruction and the audit's own §21 item 7 agree this is not to be silently corrected.

**Decision 7 — Concurrency-safe simultaneous signature/report submission**
Question: what happens if two report/completion submissions race against the same ServiceCall?
PWA fact: the PWA is single-device/in-memory and has no concurrency handling of any kind for this.
Decision: the new backend must use an atomic, session-guarded update (matching the existing `paymentService.js` transaction pattern) so a race does not corrupt `report`/`sig`/`status` into an inconsistent mixed state.
Classification: INFRASTRUCTURE-ONLY.
Implementation consequence: report/completion writes use the same `session`-threaded, atomic-update pattern already established elsewhere in the codebase; no new business rule (e.g. optimistic-locking rejection surfaced to the user) is introduced beyond what "the write succeeds atomically" requires.
Reason: pre-approved transaction/concurrency-safety category; the PWA gives no business-rule guidance here because it never faced this scenario.

**Decision 8 — Signature image storage adaptation**
Question: does the signature stay an inline base64 string or move to object storage?
PWA fact: raw base64 PNG data URI, inline, no size cap, no compression.
Decision: implementation-time storage choice (inline `String` or object-storage reference), left open as a technical choice — not a business decision — provided the observable behavior (append/persist a signature at completion; no business size limit; no post-completion clearing) stays equivalent.
Classification: INFRASTRUCTURE-ONLY.
Implementation consequence: `ServiceCall.js`'s current `clientSignatureImage: String` may remain as-is, or be swapped for a reference field, without this being treated as a business-behavior change either way.
Reason: pure storage-representation question, matching the precedent already set for Project's checklist photos.

**Decision 9 — Hashed-password/user-auth alignment for engineer identity**
Question: does resolving `engineerId` require any new authentication-layer decision specific to ServiceCall?
PWA fact: N/A directly (the PWA has no password hashing at all; this is purely a new-backend infra question).
Decision: no ServiceCall-specific decision needed — this is already resolved company-wide by the existing Auth foundation (`API_AUTH_FOUNDATION.md`/`User.js`'s hashed-password model), which every other module (Contract, Payment, Project) already relies on for actor identity.
Classification: RESOLVED — EXISTING PROJECT RULE.
Implementation consequence: none specific to ServiceCall; it simply consumes the existing `User` model and auth middleware like every other module.
Reason: this was never a ServiceCall-specific open question; it is a project-wide foundation already in place.

**Decision 10 — Chargeable-payment transactionality with the status update**
Question: should the ServiceCall-completion write, Contract-slot write, and Payment-creation write be wrapped in one transaction?
PWA fact: the PWA performs all of these as in-memory object mutations followed by a single `save()` of the whole `DB` blob — there is no meaningful "partial failure" scenario in that single-process model, but a real multi-write backend does have one.
Decision: yes — wrap the sequence in one Mongo transaction using the existing `session`-threaded pattern.
Classification: INFRASTRUCTURE-ONLY.
Implementation consequence: same as Decision 7/§13 lock above — a failure partway through must not leave a Completed ServiceCall with no Payment, or an updated Contract slot with no corresponding ServiceCall completion.
Reason: explicitly pre-approved as a concurrency concern in the original ServiceCall audit task instructions, not a business-rule change — the *conditions and field values* for Payment creation are unchanged (§13 lock above).

**Decision 11 — Notification fan-out role resolution**
Question: should ServiceCall notifications use a new mechanism or the existing project-wide one?
PWA fact: all five ServiceCall notification events use the same shared `notify(roles, text)` helper already used everywhere else in the PWA.
Decision: reuse the same notification-recipient-resolution mechanism (role-list-or-`"*"`, company-scoped) already designed into the `Notification` model, preserving the PWA's exact recipients and wording per event (§16 lock above).
Classification: RESOLVED — EXISTING PROJECT RULE (mechanism) with PRESERVE PWA (exact recipients/wording).
Implementation consequence: no ServiceCall-specific notification schema/mechanism is introduced; the exact text templates and role targets from §15/§16 of the audit are used verbatim.
Reason: matches the audit's §24 finding that the `Notification` model already mirrors the PWA's `notify()`/`myNotifs()` shape field-for-field.

**Decision 12 — `"PSC-"` vs. `"PSC "` string inconsistency**
Question: should this punctuation inconsistency across message templates be normalized?
PWA fact: `msgDone` alone uses `"PSC-"` (hyphen); `msgReg`/`msgPM`/`msgPMdone` use `"PSC "` (space).
Decision: preserve verbatim — do NOT fix.
Classification: PRESERVE PWA — explicit DO NOT FIX.
Implementation consequence: the four message template bodies are ported character-for-character, inconsistency included.
Reason: a demonstrated PWA inconsistency, not a business rule; normalizing it would be a silent, unauthorized text change.

**Decision 13 — ObjectId durability for `contractId`**
Question: should `contractId` be a durable ObjectId reference?
PWA fact: `contractId` is a plain integer Contract id (or `0` as a falsy "no contract" sentinel).
Decision: `contractId: ObjectId ref 'Contract', default: null` (already the schema's shape), replacing the `0`-sentinel with `null`.
Classification: INFRASTRUCTURE-ONLY.
Implementation consequence: no code interprets `contractId` truthiness any differently than the PWA's `if(s.contractId)` check — `null` is simply the new falsy sentinel in place of `0`.
Reason: consistent with how Contract/Project already reference each other (`originatingProjectId`), and already the schema's current shape — this document only confirms it, it does not change it.

## 25. Remaining unresolved decisions

Re-reading the full audit end-to-end for this task surfaced exactly one item from the original 13 that resists being folded cleanly into PRESERVE PWA / INFRASTRUCTURE-ONLY / RESOLVED-EXISTING-RULE, plus the audit's own separately-noted genuinely-open items are restated here for completeness (they were already open in the audit and remain open — this document does not force a resolution the PWA's own source gives no basis for):

1. **Completed-ServiceCall re-completion guard** (audit §26.4/§21.15): the PWA's own `saveReport()` has no `if(status==="Completed")return` guard in its code, even though the UI never exposes a path to trigger it. Whether the new backend should add a genuine server-side lock preventing re-completion/re-editing of an already-Completed ServiceCall is a real, unresolved business/security question — the PWA gives no signal either way (it never had a scenario where this mattered, since the code path is UI-unreachable there but would be directly reachable via a real API). **Left OPEN — REQUIRES BUSINESS/SECURITY DECISION.** (Recommended default for a real API surface would be to add this guard, since an API has no "hidden form" to rely on for protection the way the PWA's single-page UI does — but this document does not decide it, since it is a genuine new safeguard, not a preservation of any PWA behavior.)
2. **Division-scoping of the ServiceCall engineer candidate pool** (audit §26.2): whether the new backend should introduce division filtering (the PWA has none) or deliberately keep the pool company-wide/undivided. This is listed in §21 above as a preserved-as-is quirk for now, but the audit itself frames this as a live open question for business review, not something this document can resolve from PWA source alone — the PWA simply never had a division concept apply to service-role users at all, so there is no "PWA fact" either way to preserve or contradict. **Left OPEN — REQUIRES BUSINESS DECISION**, pending explicit product input on whether ServiceCall should ever become division-aware.
3. **Report/signature draft-history model** (audit §26.6): whether `report` remains a single overwrite-in-place subdocument forever, or eventually gains a versioned draft history beyond what the PWA ever had. The PWA's whole-object-replacement behavior is locked as the *current* preserved behavior (§9 lock above); whether to ever add history is a forward-looking product question the PWA gives no basis to answer. **Left OPEN — REQUIRES BUSINESS DECISION** (not blocking initial implementation, since "no history" is already the locked default).
4. **Reverse Payment reference on ServiceCall** (audit §26.11): whether to add a `paymentId` field on `ServiceCall` for referential integrity, given the PWA's text-only, one-directional cross-reference (`Payment.project` = `"<site> (PSC-<psc>)"`). Adding such a field would be a genuine new capability, not a preservation of anything the PWA has — it is intentionally **not** authorized by §22 (infrastructure-only list) or forbidden by §23, because it is a real, undecided design question rather than a clear redesign to reject. **Left OPEN — REQUIRES BUSINESS DECISION.**
5. **Customer-message automated delivery** (audit §26.12, already cross-indexed at `OPEN_DECISIONS.md` #11): whether real SMS/email/WhatsApp-API delivery is now in scope, versus preserving the PWA's preview+copy/WhatsApp-handoff-only model forever. The PWA gives zero evidence of real delivery ever having existed, so this is a green-field product decision, not something inferable from source. **Left OPEN — REQUIRES BUSINESS DECISION** (already tracked project-wide at `OPEN_DECISIONS.md` #11; not duplicated as a new number here).

## 26. Implementation readiness

| Area | Status | Notes |
|---|---|---|
| Entity/schema shape | LOCKED, already built | `ServiceCall.js` matches this document's field lock (§4); one schema-comment override is recorded here (§10, checklist-key enforcement) that a future service layer must implement, not the schema file itself. |
| PSC numbering | LOCKED, primitive already built | `Counter.js`/`getNextSequence('serviceCall')` ready to use as-is (§5). |
| Creation workflows (Complaint/PM) | LOCKED, not yet implemented | §6/§7 — no service/route exists; validation rule (customer-name-only) fully specified. |
| Assignment workflow | LOCKED, not yet implemented | §8 — role/candidate-pool/status-transition/notification rules fully specified; reuse `contractService.js`'s `MANAGE_ROLES` pattern. |
| Report/checklist | LOCKED (with one schema-layer change needed: §10), not yet implemented | §9/§10 — whole-object-replace semantics and six-key checklist enforcement both specified. |
| Signature | LOCKED, not yet implemented | §11 — mandatory-at-completion-only rule specified; storage representation is an open implementation choice, not a blocker. |
| Completion | LOCKED, not yet implemented | §12 — exact guard set and order of effects specified; must call existing `contractService.completePmVisitForContract`. |
| Chargeable Payment | LOCKED, partially built | §13 — trigger/fields fully specified; `paymentService.js`/`Payment.js` already support every needed field; ServiceCall-specific orchestration and the transaction wrapper remain to be built. |
| Contract integration | LOCKED, Contract-side already built | §14/§15 — `completePmVisitForContract` exists, tested indirectly via Contract's own test suite, ready for ServiceCall to call. |
| Notifications | LOCKED, mechanism exists, wiring absent project-wide | §16 — `Notification.js` schema ready; no notification-creation service exists yet anywhere in the codebase (a pre-existing, cross-module gap, not ServiceCall-specific). |
| Customer messages | LOCKED (content), not implemented (delivery UI) | §17 — verbatim templates locked; delivery mechanism explicitly out of scope for a backend-only implementation. |
| Search/list/CSV | LOCKED, not yet implemented | §18 — exact field set, sort behavior, and CSV shape specified. |
| Roles/access | LOCKED, pattern exists in `contractService.js` | §19 — reuse `MANAGE_ROLES`/`assertCanManageContracts`/`assertCanCompletePmVisit` pattern directly. |
| Tenant/security | LOCKED, mandatory, pattern exists everywhere else | §20 — reuse `{ _id, companyId }` repository convention already used by every other collection. |
| Genuinely open decisions | 5 items, explicitly not resolved here | §25 — flagged for business/product review before or during implementation, not blocking a first cut of the other locked behavior. |

**Overall readiness**: documentation is now complete enough that a future implementation task could build `serviceCallService.js`/`serviceCallRoutes.js` directly from this document plus the underlying audit, without needing further PWA-source spelunking, except to resolve the 5 items in §25 (which do not block building the rest). No ServiceCall code has been written by this task or the audit that preceded it.
