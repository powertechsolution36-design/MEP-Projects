# Project Decision Lock

**Status: LOCKED. This document consolidates and formally locks the 12 Project Execution business decisions raised by `PWA_COVERAGE_AUDIT_PROJECT.md` §30 and already resolved individually in `OPEN_DECISIONS.md` #25–#36. It is a documentation consolidation, not a new implementation task — the Project schema (`Project.js`) and the Project workflow implementation (`src/services/projectService.js`, `src/routes/projectRoutes.js`) already exist and already reflect every rule below. Nothing in this document changes any PWA-observed behavior or any already-shipped backend behavior.**

Cross-references: `PWA_COVERAGE_AUDIT_PROJECT.md` (source audit, all section numbers below refer to it unless stated otherwise), `PWA_COVERAGE_AUDIT_CONTRACT.md` (Contract audit, for decision #10), `OPEN_DECISIONS.md` #25–#36 (individually resolved entries), `DOMAIN_MODEL.md` §5 Project, `DATABASE_SCHEMA.md` `projects` collection.

---

## How to read this document

Each of the 12 decisions below gives:
- **Exact PWA behavior** — the literal, source-verified fact from the audit.
- **What the new backend must do** — the rule already implemented (or, for #3/#9/#10, the rule to apply whenever that future work happens).
- **What it must NOT do** — the "fix" that is explicitly forbidden.
- **Infrastructure-only exceptions** — representation differences (durable IDs, storage medium, etc.) that are allowed because they don't change observable business behavior.
- **DO NOT FIX** callout — restated explicitly wherever a well-intentioned engineer might be tempted to "correct" the behavior.

None of this reopens the Project business rule already established elsewhere in this audit trail: **everything functional in the PWA is exactly how the business wants it.** These 12 items are confirmations of what was already built, not new work items.

---

## Decision 1 — Project detail access

**Exact PWA behavior:** `vProject()` (the Project detail screen) applies **zero** division or role-based access check — any authenticated user of the same company who has (or guesses) a project id can open its full detail page, regardless of their own role's division. This is distinct from every list/dashboard entry point (`vProjects`, `projPanel`, dashboard KPIs), which **do** filter by division for PM roles (§15, §22, §30 item 1).

**What the new backend must do:** `getProject` in `projectService.js` performs only a tenant/company match (`companyId`) — any authenticated user within the same company may fetch any project's detail if they know its id/reference. List/dashboard endpoints remain division-scoped for PM roles exactly as before.

**What it must NOT do:** Must NOT add a "PM-division-only" (or any other role/division) restriction to the single-project detail read path. Doing so would be a new restriction the PWA never had, not a bug fix.

**Infrastructure-only exceptions:** Tenant/company isolation (never serving another company's project) is mandatory backend infrastructure and is not a business-behavior change — the PWA's own `mine()`/`co` scoping already assumes single-tenant `DB`; multi-tenant separation is a baseline security requirement, not a PWA quirk being preserved or removed.

**DO NOT FIX:** Do not introduce PM-division-only detail access. This has been requested and explicitly declined multiple times across this audit trail (§15/§22/§30 item 1; `OPEN_DECISIONS.md` #25).

---

## Decision 2 — Engineer assignment candidate pool

**Exact PWA behavior:** The candidate list for `p.engs` (`engineers = mine(DB.users).filter(u => ["engineer","hvac_pm","solar_pm","mep_pm","service_eng"].indexOf(u.role)>=0)`) is **company-wide**, not filtered to the project's own division. Any PM (whose own edit access is division-matched) can assign any staff member from any division/role in that list to their project (§14, §23 quirk #12, §30 item 2).

**What the new backend must do:** `assignEngineers` in `projectService.js` uses `ENGINEER_CANDIDATE_ROLES` (`engineer`, `hvac_pm`, `solar_pm`, `mep_pm`, `service_eng`) with **no division filter** on the candidate pool. The action of assigning itself remains gated to the project's own matching-division PM (or admin) — only the *pool of who can be assigned* is company-wide, exactly mirroring the PWA's own split.

**What it must NOT do:** Must NOT division-filter the candidate pool. A "fix" that restricts the assignable list to the project's own division would silently remove a capability the PWA visibly offers today.

**Infrastructure-only exceptions:** Engineers are stored/returned as durable `User` ObjectId references (`assignedEngineerIds`) instead of the PWA's raw name-string array (`engs[]`) — an identity-representation upgrade only; the pool and its scope are otherwise unchanged.

**DO NOT FIX:** Do not division-filter the engineer candidate pool (`OPEN_DECISIONS.md` #26).

---

## Decision 3 — Checklist Library management

**Exact PWA behavior:** `canEditChk()` — the gate on the Checklist Library screen (create/edit/delete `ChecklistTemplate` documents, not a project's own copied checklist) — is `U.role==="admin" || U.role in PM_DIV`, i.e. **any** of the three PM roles, regardless of whether that PM's own division matches the checklist template's division. A solar PM can open and edit an HVAC checklist template directly. This is a genuine, PWA-native cross-division gap, distinct from the general "no server-side enforcement" pattern — here the PWA's own *UI-level intent* is already division-blind (§15, §21, §23 quirk #13, §30 item 3).

**What the new backend must do (business rule, locked now for whenever Checklist Library CRUD is implemented):** any PM role (any of the three division PM roles, or admin) may manage `ChecklistTemplate` documents across all divisions of their company — there is no matching-division restriction on Library management, matching the PWA exactly.

**What it must NOT do:** Must NOT introduce a matching-division-only restriction on Checklist Library management, now or when that CRUD surface is eventually built.

**Infrastructure-only exceptions:** none.

**Scope note:** Checklist Library CRUD (creating/editing/deleting `ChecklistTemplate` documents themselves) is **not yet implemented** in this backend — `projectService.js` only *reads* templates (`checklistTemplateRepo.findById` / `findDefaultForDivision`) to seed or apply a template to a project's own copied checklist; it never creates/edits/deletes a `ChecklistTemplate`. This decision locks the **business rule** now (`OPEN_DECISIONS.md` #27) so that whichever future task builds Checklist Library CRUD does not need to re-litigate it — it does not itself add that CRUD surface, and no source code changes accompany this documentation task.

**DO NOT FIX:** Do not introduce matching-division-only restrictions on Checklist Library management, in this task or the future one that implements it.

---

## Decision 4 — MEP completion

**Exact PWA behavior:** The completion gate inside `savePM()` is a **literal string comparison**: `if(p.stage==="Completed" && p.status!=="In Service"){...}`. MEP's `STAGES.MEP` terminal stage is the literal string `"Delivered"`, which never equals `"Completed"`. This is a mechanical fact of the source, not a policy choice — MEP projects are structurally excluded from ever reaching `status="Completed"`, the commissioning banner, and Contract/Service conversion through this path (§5, §6, §10, §18, §23 quirk #1, §30 item 4).

**What the new backend must do:** `setStage` in `projectService.js` uses the same literal `stage === 'Completed'` check. MEP's terminal stage remains `"Delivered"`.

**What it must NOT do:** Must NOT treat `"Delivered"` as equivalent to `"Completed"`. Must NOT add "MEP is considered complete once it reaches its own terminal stage" logic — no such logic exists in the PWA, and adding it would change real business behavior for every MEP project.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** This is explicitly, repeatedly flagged across the audit trail as a quirk that reads as unintended but must be preserved verbatim (`OPEN_DECISIONS.md` #28). Do not fix it.

---

## Decision 5 — Completed → Ongoing (un-completing)

**Exact PWA behavior:** If a project's `stage` is edited away from `"Completed"` while `status` is not `"In Service"`, the same generic `else if(p.status!=="In Service") p.status="Ongoing"` branch used for every other stage change silently reverts `status` back to `"Ongoing"` — no confirmation dialog, no notification distinct from the ordinary stage-change notifications (§6, §23 quirk #3, §30 item 5).

**What the new backend must do:** `setStage`'s `else if (project.status !== 'In Service') patch.status = 'Ongoing'` branch reproduces this exactly. The normal stage-change notifications (finance/admin, §21 notifications #3/#4) fire as usual; nothing extra fires.

**What it must NOT do:** Must NOT add a confirmation step, warning, or a distinct "un-completed" notification. That would be new business behavior the PWA never had.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** No confirmation dialog, no special notification (`OPEN_DECISIONS.md` #29).

---

## Decision 6 — Checklist Replace

**Exact PWA behavior:** `mApplyChkList`'s "Replace checklist" action calls `applyChkList(pid,false)` directly, which does `p.chk=items; p.chkName=c.name` — discarding all prior ticks, dates, approvals, and photos. The on-screen UI shows a warning banner when `doneCount>0`, but there is **no native `confirm()` call** gating the action at the function level — a single click destroys completed-point history (§8, §23 quirk #4, §30 item 6).

**What the new backend must do:** `applyChecklistTemplate` (mode `"replace"`) in `projectService.js` performs the replace with no server-side confirmation flag required. The "Append" mode (`p.chk=p.chk.concat(items)`) remains purely additive, as in the PWA.

**What it must NOT do:** Must NOT add a new confirmation step, an "are you sure" flag, or any transactional guard against replacing a checklist that has execution history. That would be new friction the PWA never imposed.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** Do not add a new confirmation step for checklist Replace (`OPEN_DECISIONS.md` #30). (Contrast with the completion gate's two genuinely business-critical `confirm()`-gated overrides in Decision 4's underlying mechanism and §10 — those ARE preserved; this one, which the PWA itself never gated, is not newly gated either.)

---

## Decision 7 — Person/actor identity

**Exact PWA behavior, per field:**
- **CLIENT checklist-point approval's `appr.by`:** a free-typed external/on-site person's name (`gv("ap_n")`) — the client never has a PWA login, so this can never be a system User.
- **Delivery Challan's `dc[].by` / `receivedByName`:** a free-typed "Received By (site)" name — very often a warehouse/site person with no system login at all.
- **Non-CLIENT checklist-point approval's `appr.by`:** set to `U.name` directly (the approving staff member's own display name) — no separate name prompt for ENGINEER/SALES/SERVICE points.
- **`appr.enteredBy`:** always `U.name` — the logged-in staff member who recorded the approval. For CLIENT points this is structurally distinct from `appr.by` (the client's name); for every other sign type it happens to equal `appr.by`, but the two fields remain structurally separate in every case (§3, §8, §24, §30 item 7).

**What the new backend must do:** Maintain durable `User` ObjectId references for actual system actors (e.g. `approval.enteredByUserId`, `deliveryChallans[].recordedByUserId`) **while preserving the original free-text/display-name fields** (`approval.approverName`, `deliveryChallans[].receivedByName`) exactly as the PWA captured them. The two are never collapsed into one field.

**What it must NOT do:** Must NOT replace a CLIENT approver's free-text name, or a Delivery Challan's "Received By (site)" name, with a forced `User` reference. Both are frequently not system Users at all, and forcing a reference would silently discard real data the PWA captured, or fail validation outright for a person with no account.

**Infrastructure-only exceptions:** Adding `enteredByUserId` / `recordedByUserId` alongside the preserved free-text fields is an additive, representation-fidelity change (durable identity for staff actors), not a business-behavior change — already implemented (`Project.js`'s `checklistExecutionItemSchema.approval.enteredByUserId` and `deliveryChallanItemSchema.recordedByUserId` + `receivedByName`, per `OPEN_DECISIONS.md` #31).

**DO NOT FIX:** Do not force `dc[].by` / CLIENT `appr.by` into `User` references. Do not collapse `appr.by` and `appr.enteredBy` into a single field.

---

## Decision 8 — Checklist photos

**Exact PWA behavior:** `addPhoto` is **push-only** — `c.photos.push(...)` — there is no remove-photo function anywhere in the PWA. Photos are base64 JPEG data URIs, downscaled client-side to a max width of 480px at quality 0.6, stored as a plain ordered array, all associated with the same checklist point that was photographed. No cap on count exists anywhere (§3, §8, §23 quirk-adjacent, §30 item 8).

**What the new backend must do:** `addChecklistItemPhoto` in `projectService.js` is push-only, preserves array order, keeps every photo associated with its originating checklist point, and imposes no artificial business limit on count.

**What it must NOT do:** Must NOT add a "remove photo" function, must NOT add a business-rule cap on the number of photos per point, and must NOT re-associate a photo with a different checklist point than the one it was added to.

**Infrastructure-only exception (this is an infrastructure constraint, not a business-behavior change):** The PWA's inline base64-string storage is a client-side-only optimization; the new backend MAY store photo bytes in file/object storage (e.g. S3-compatible storage) rather than inline base64 strings in MongoDB, purely to avoid unbounded document growth in Mongo. If/when that infrastructure change is made, the API/data behavior exposed to clients (ordered, append-only, no delete, no cap, one-to-one with the checklist point) must remain equivalent — callers see the same ordering/append/no-delete/no-cap semantics regardless of whether a photo entry is an inline base64 string or a storage-backend URL/reference. As shipped today, `Project.js`'s `checklistExecutionItemSchema.photos` remains `[String]` (inline base64), matching the PWA exactly, per `OPEN_DECISIONS.md` #32 — object storage is documented here as an available future infrastructure option, not a change made by this task.

**DO NOT FIX:** Do not add photo deletion. Do not add a photo-count cap. Any future storage-backend migration must be transparent to callers.

---

## Decision 9 — Delivery Challan ↔ Inventory

**Exact PWA behavior:** Two structurally separate material-tracking mechanisms exist. The Project's own embedded `dc[]` (Delivery Challans) is what the completion gate's "returnable material" check actually reads (`pend = sum of (qty-rqty) over dc[] rows where ret===true`). The standalone Inventory module (`DB.invItems`, `DB.invIssues`, etc.) has its own, entirely independent tracking, including a `invIssues[].projId` field that is **write-only** in the PWA's own functional code — set at issue time, but never read back by any Project-facing function (completion gate, reports, or anything else). The two systems are not integrated at the functional level (§10, §11, §16, §23 quirk #15, §30 item 9).

**What the new backend must do:** Project completion (`computePendingReturnableMaterial` in `projectService.js`) reads **only** `Project.deliveryChallans[]` for its returnable-material check, exactly as the PWA does.

**What it must NOT do:** Must NOT connect the completion gate (or any other Project-facing calculation) to `InventoryIssue`/`InventoryTransaction`. Must NOT treat `invIssues[].projId` as a live, read-back relationship for any Project computation.

**Infrastructure-only exceptions:** none — this is a business-behavior non-integration, not an infrastructure detail.

**OUT OF SCOPE:** Building real Delivery-Challan ↔ Inventory integration is explicitly **out of scope** for this task and for the already-completed Project Execution implementation task. The PWA's non-integration is preserved exactly (`OPEN_DECISIONS.md` #8, reconfirmed and given the exact mechanism by #33). This is **deferred to a future, dedicated Inventory audit/implementation task** — nothing here decides whether that future task should finally connect the two systems; it only guarantees today's backend does not connect them as a side effect of unrelated work.

**DO NOT FIX:** Do not wire `Project.deliveryChallans[]` to `InventoryIssue`/`InventoryTransaction` in this or any adjacent task without an explicit, separate decision from the business.

---

## Decision 10 — Contract phone/email

**Exact PWA behavior:** `convertToService(id)`'s Contract-creation object hardcodes `phone:""`, `email:""` — even though the same conversion's `customer` field is sourced from the originating SalesOrder's first contact name (`p.customer`, itself `so.contacts[0].n`). The phone/email are never copied from that same SO contact record, despite the data being available upstream. This is a genuine, verified data-loss quirk, not a lookup failure (§18, §23 quirk #16, §30 item 10; independently re-verified in `PWA_COVERAGE_AUDIT_CONTRACT.md` §4/§18 item #7, which confirms the mechanism is a hardcoded literal, not a failed lookup).

**What the new backend must do (whenever Contract implementation happens):** preserve the exact future-conversion behavior — the Contract record created by a Project→Service conversion must set `phone=""` and `email=""` and must NOT copy the SalesOrder's contact phone/email, even though `customer` is copied.

**What it must NOT do:** Must NOT "fix" this by copying the SO contact's phone/email into the new Contract, unless a future, explicit business decision reopens this specifically.

**Infrastructure-only exceptions:** none.

**OUT OF SCOPE:** Contract (and ServiceCall) business logic remains unimplemented and explicitly out of scope for this documentation task and for the Project Execution implementation task that preceded it. `projectService.js`'s `prepareServiceConversion` only exposes the eligibility check (`status==="Completed" && division!=="MEP"`) as a documented integration stub — it creates no Contract. This decision is locked as a **business rule for the future Contract implementation task**, not implemented here (`OPEN_DECISIONS.md` #34). Cross-referenced and independently re-verified in the separate Contract PWA Coverage Audit already completed — `new-app/docs/PWA_COVERAGE_AUDIT_CONTRACT.md`.

**DO NOT FIX:** When Contract implementation eventually happens, do not copy SO contact info into the converted Contract's phone/email fields.

---

## Decision 11 — Report generation

**Exact PWA behavior:** The PWA maintains **two independently-coded** report paths that currently produce equivalent output: `projectReportRows`/`dlProjectReport` (CSV export) and `printProjectReport` (a separate, parallel HTML/print rendering) — not generated from the same row-building function. This is a latent drift risk (no actual discrepancy was found on inspection), not a currently observed bug (§20, §23 quirk #17, §30 item 11).

**What the new backend must do:** `buildProjectReportSections` in `projectService.js` is the single source of truth consumed by both `getProjectReport` (JSON, for a future print view) and `exportProjectReportCsv` (CSV) — an infrastructure/code-sharing simplification that removes the PWA's own duplication risk, while keeping the CSV column order/content, print content, filters, and calculations functionally equivalent to what the PWA's two independent functions produce today.

**What it must NOT do:** Must NOT change any observable report content — columns, column order, filters, or calculations — as a side effect of unifying the code path. Sharing implementation is only acceptable because the outputs remain byte-for-byte equivalent in substance to the PWA's two originally-independent functions.

**Infrastructure-only exceptions:** Unifying the two code paths into one shared builder is exactly this kind of allowed infrastructure/implementation optimization (`OPEN_DECISIONS.md` #35) — it is not a business-behavior change provided equivalence holds.

**DO NOT FIX (i.e. do not "improve" beyond equivalence):** Do not use the code-sharing refactor as an opportunity to add/remove/reorder columns, change filters, or change calculations relative to what the PWA's original two functions produced.

---

## Decision 12 — Timeline flag

**Exact PWA behavior:** `p.timelineSet` is set `true` by `saveTimeline()` and **never** reset to `false` by any function in the PWA — even if every `plan`/target date on every checklist point is subsequently cleared by later edits, no UI path or function ever restores `timelineSet` to `false` (§7, §23 quirk #20, §30 item 12).

**What the new backend must do:** Once `timelineSet=true`, it remains `true` forever. `saveTimeline` in `projectService.js` only ever sets `timelineSet: true` (never `false`); there is no timeline-reset function anywhere in `projectService.js`.

**What it must NOT do:** Must NOT add a "reset timeline" feature, admin override, or any other function that flips `timelineSet` back to `false`.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** Do not add a reset-timeline feature (`OPEN_DECISIONS.md` #36).

---

## Final DO NOT FIX list

The following PWA quirks are business behavior, verified against source, and must never be "corrected." Full original catalogue: `PWA_COVERAGE_AUDIT_PROJECT.md` §23 (22 items) — every item there is preserved; the ones with direct bearing on the 12 locked decisions above are restated here for a single consolidated reference:

1. **MEP completion exclusion** — the literal `stage==="Completed"` string check can never match MEP's terminal stage `"Delivered"`; MEP is structurally excluded from `status="Completed"`, the commissioning banner, and Contract/Service conversion (§23 #1; Decision 4 above).
2. **`status`/`stage` decoupling once `status==="In Service"`** — `stage` remains freely editable via `savePM` with zero effect on `status` once status has reached the terminal `"In Service"` value; an In Service project can display any stage at all (§23 #2).
3. **Un-Completing has no confirmation and no distinct notification** — editing `stage` away from `"Completed"` silently reverts `status` to `"Ongoing"` via the generic stage-change path (§23 #3; Decision 5 above).
4. **Checklist Replace has a warning banner but no `confirm()` gate** — `applyChkList(pid,false)` runs unconditionally; only a passive on-screen warning exists (§23 #4; Decision 6 above).
5. **Checklist point sign-responsibility editable after approval, with only a passive warning** — `saveProjChk` allows changing `sign` on an already-approved point with no re-validation of the existing `appr` record (§23 #5).
6. **`rmChkItem` has no function-level protection** against removing a done/approved point — only the UI's ternary hides the button once `done` is true (§23 #6).
7. **Un-ticking clears approval and PM counter-sign in one step, no confirmation** — `tickChk`'s un-tick branch nulls `appr` and resets `pmSign` together with un-marking `done` (§23 #7).
8. **Approval is overwrite-only, not append-only** — `doApprove` always replaces `c.appr` wholesale; no history of prior approvals (§23 #8).
9. **PM counter-sign (`pmSign`) is a one-way boolean** — no un-sign function, no remark, no date, no signature, no notification of its own (§23 #9).
10. **`PM` is a dead/unreachable `SIGN_ROLES` key** for a checklist point's own `sign` value — present in the constant, never assignable through any UI (§23 #10).
11. **Engineer assignment is full-replace, not additive** — re-saving with fewer names silently unassigns (§23 #11).
12. **Engineer candidate pool is company-wide, not division-filtered** (§23 #12; Decision 2 above).
13. **Checklist Library management is not division-scoped** — any PM role may manage templates across all divisions (§23 #13; Decision 3 above).
14. **Project detail view has no division/access check at all** (§23 #14; Decision 1 above).
15. **Delivery Challan ↔ Inventory-Issue non-integration** — two entirely separate material trackers; `invIssues[].projId` is write-only and functionally dead in the PWA's own code (§23 #15; Decision 9 above).
16. **Contract created via commissioning conversion never copies SO contact phone/email** (§23 #16; Decision 10 above).
17. **`dlProjectReport`/`projectReportRows` and `printProjectReport` are two independently-maintained code paths** — equivalent today, but a latent drift risk in the original PWA (§23 #17; Decision 11 above — the new backend is permitted to unify the *implementation*, not the *content*).
18. **The delay-check notification's "worst delay" number and "latest pending" named point are not necessarily the same checklist point** — `worst` is a reduce over all late items; the named item is simply the first late item in array order (§23 #18).
19. **`end` date is silently overwritten by `projTargetEnd(p)`** the moment a timeline is saved or a single item's date is edited — the SO-copied initial `end` value is permanently lost from that point forward (§23 #19).
20. **`timelineSet` is a one-way flag** — once true, never reset false by any function (§23 #20; Decision 12 above).
21. **A damaged material return still increments `rqty`** (counts as "returned" for balance purposes) even though it does not restock — an Inventory-module-adjacent quirk relevant only if Inventory integration is ever built (§23 #21; out of scope, see Decision 9).
22. **`invIssues[].site` is a frozen free-text label** copied at issue time and never re-synced if the Project is later renamed — again relevant only to a future Inventory audit (§23 #22; out of scope, see Decision 9).

All notification wording and recipients (the full 13-entry trigger catalogue in `PWA_COVERAGE_AUDIT_PROJECT.md` §21, already implemented verbatim in `projectService.js`) and all report/search/filter semantics (§20) are likewise locked verbatim and must never be reworded, retargeted, reordered, or otherwise "cleaned up" as part of any future refactor.

**Any quirk in `PWA_COVERAGE_AUDIT_PROJECT.md` §23 not explicitly named above (there are none omitted — all 22 items are covered by the numbered list above) remains preserved by the same rule: nothing functional in the PWA is redesigned or fixed while documenting it.**
