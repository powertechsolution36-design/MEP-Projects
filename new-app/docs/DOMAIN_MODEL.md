# MEP Employee App — Domain Model
Source: read-only reverse engineering of `MEP_PROJECTS_PWA_original/index.html` (the original/desired PWA). This is the authoritative functional specification for the new, independent application. V2 and V3 were not consulted or referenced.

Conventions used below:
- **Authoritative backend ID**: a server-generated durable identifier (see ID DESIGN). Never the PWA's small sequential integer.
- **PWA LEGACY NAME REFERENCE**: a field that today stores a person's display *name* as a string instead of a foreign key, per the PWA. Flagged for conversion to a durable User ID reference.
- **UNSPECIFIED BY PWA**: the PWA does not define this; no rule is invented here.

---

## Divisions

The PWA operates over exactly three business divisions: **HVAC**, **Solar**, **MEP**. These are observed, fixed values (`STAGES`, `PM_DIV`, company `divs[]`, enquiry `seg`). Do not add divisions; do not merge MEP and HVAC — the PWA keeps them as distinct project-manager roles (`hvac_pm`, `solar_pm`, `mep_pm`) with distinct stage sequences.

---

## ID Design

- **Authoritative backend ID:** every entity gets a server-generated durable identifier (e.g. ObjectId/UUID) at creation. This is the only ID used for relationships, lookups, and API paths.
- **Human/business display sequence:** kept **in addition to** the authoritative ID, exactly where the PWA already relies on a human-facing number, scoped per company (tenant):
  - Sales Order number (`SO-<n>`, PWA field `sos.no`)
  - Service complaint number (`PSC-<n>`, PWA field `svcCalls.psc`)
  - Any other PWA field that is a small sequential integer used as a *counter*, not a foreign key (e.g. checklist point ordering) stays a simple ordinal, not an ID.
- The PWA's own `id` fields (small integers minted via `DB.seq.*`) are **not** carried forward as authoritative IDs — they are per-tenant, non-globally-unique, and not collision-safe. Where useful for continuity of the human-facing numbers above, they can inform the *starting value* of a new per-tenant display-sequence counter, nothing more.

---

## Security Design (documented as requirement — NOT implemented in this step)

- **Tenant isolation:** every business record carries a company/tenant reference; every query is scoped by it server-side (the PWA's `mine()` client-side filter must become a server-enforced constraint, not a UI convenience).
- **Hashed passwords:** see PASSWORDS below.
- **Server-side authorization:** every role/action pair observed in the PWA (Section "Roles" below) must be enforced in the backend, not only hidden in the UI. The PWA enforces everything via `canPM()`, `canStock()`, `canEditChk()`, `isPM`/`isEng`/`isMgr` checks that only control which buttons render — there is no server today, so there is no real enforcement today. This must change in the new backend.
- **Record ownership:** beyond role, some actions are additionally gated by assignment (e.g., only the checklist item's declared `sign` role may approve it; only a project's assigned engineer or its division PM may tick/edit its checklist; only the assigned service engineer or a service manager may file a service report). These are business rules, not just role gates.
- **Audit/history:** the PWA already keeps an implicit audit trail in specific places (inventory transaction ledger `invTxns`, payment `paid[]` entries with `editedBy`/`editedOn`, enquiry follow-up `log[]`, project `updates[]`). Whether a *general* audit log is needed beyond these entity-specific histories is UNSPECIFIED BY PWA.
- **Validation:** field-level required/optional rules are documented per entity below; deeper validation (e.g. phone/email format) is UNSPECIFIED BY PWA — the PWA does none beyond "field is non-empty".

## Passwords

The current PWA stores and displays **plaintext** passwords (`users.pw`, shown in the Team/Login screen and in the "company created" toast). This must **not** be carried forward.

**NEW BACKEND REQUIREMENT:** passwords must be securely hashed (e.g. bcrypt/argon2) at rest; plaintext passwords must never be stored, logged, or displayed. Authentication itself is not implemented in this step — this is a documented requirement only.

---

## Entities

Each entity below follows: Purpose · Fields · Required · Optional · Relationships · References · Status/Lifecycle · Create · Update · Delete/Archive · Role-dependent actions · Division relevance · Business rules · PWA screens.

### 1. Company (tenant)
- **Purpose:** one row per subscribing MEP contracting company (tenant). Managed exclusively by the `super` role; every other business record belongs to exactly one company.
- **Fields:** name, city, address, gstNumber, divisions[] (subset of HVAC/Solar/MEP — gates which divisions this tenant's admin can operate in), status (Trial | Active | Suspended), phone, email, tagline (used in customer-facing messages/reports), contacts[] (up to 2, each {name, phone}), subscriptionRate, subscriptionCycle (Monthly | Yearly), subscriptionStart, subscriptionEnd, trialEnd (auto = join date + 15 days), since (join date).
- **Required:** name; divisions (at least one); for status=Active: subscriptionRate and subscriptionStart.
- **Optional:** city, address, gstNumber, phone, email, tagline, contacts, subscriptionEnd.
- **Relationships:** parent of Users, Enquiries, SalesOrders, Projects, ServiceCalls, Contracts, Payments, Notifications, and the entire Inventory subsystem, all via the tenant reference.
- **References:** none upward (Company is the tenant root).
- **Status/Lifecycle:** Trial (15 days, auto-expiring, tracked by trialEnd) → Active (subscription dates/rate required) → Suspended (manual, reversible back to Active) → removable (cascades: PWA's `delCompany` also deletes that company's users/enquiries/sos/projects/svcCalls/contracts/payments/notifs — inventory collections were not observed being cascaded in the same function, UNSPECIFIED BY PWA whether that is intentional or an oversight in the original app).
- **Create:** by `super` only; creating a company also creates exactly one `admin`-role User for it (with a login and password set at creation time).
- **Update:** by `super` only (name/contacts/status/subscription/divisions).
- **Delete/Archive:** by `super` only, with confirmation; PWA guards a hard-coded demo company id from deletion — UNSPECIFIED BY PWA whether the new system needs an equivalent "protected tenant" concept.
- **Role-dependent actions:** only `super` sees or edits Company records at all.
- **Division relevance:** `divisions[]` is itself the mechanism that scopes which divisions the tenant (and therefore its users) may use.
- **Business rules demonstrated:**
  - Trial period is fixed at 15 days from `since`.
  - MRR = subscriptionRate if cycle=Monthly, else subscriptionRate/12 if cycle=Yearly; only counted while status=Active.
  - "Collected" revenue is an approximation based on elapsed billing cycles since subscriptionStart — not a real invoice/payment ledger for subscription billing (UNSPECIFIED BY PWA whether subscription billing needs its own ledger in the new system, distinct from the operational Payment entity below).
  - At least one division must be selected.
- **PWA screens:** Companies list, Add/Edit Company modal, Super Admin dashboard, Client Usage report, Revenue report, Expiring-soon report, Locations report.

### 2. User
- **Purpose:** a login belonging to a Company, with exactly one role.
- **Fields:** company reference, name (display name), role (see Roles below), username, password (PWA: plaintext — NEW BACKEND: hashed, see PASSWORDS).
- **Required:** company (except `super`, which is cross-tenant), name, role, username, password.
- **Optional:** none observed beyond the required set.
- **Relationships:** referenced **by name string** (PWA LEGACY NAME REFERENCE) from: `Project.assignedEngineers[]`, `ServiceCall.engineer`, `InventoryIssue.staff`. All three must become durable User-ID references in the new backend.
- **References:** Company.
- **Status/Lifecycle:** no PWA-demonstrated deactivation state — a login exists until deleted (`delUser`); UNSPECIFIED BY PWA whether the new system needs an explicit disable/deactivate state distinct from delete.
- **Create:** by `admin` (own company) or implicitly by `super` (one admin user per new company).
- **Update:** by `admin` (own company) — name/role/username/password.
- **Delete/Archive:** by `admin`; the PWA blocks a user from deleting their own currently-logged-in account.
- **Role-dependent actions:** role selection is filtered by division access — a role bound to a division (`hvac_pm`/`solar_pm`/`mep_pm`) is only offered if the company subscribes to that division.
- **Division relevance:** three roles (`hvac_pm`, `solar_pm`, `mep_pm`) are each bound to exactly one division.
- **Business rules demonstrated:** Username uniqueness is enforced only for the one admin login created via the Company screen, where the PWA checks usernames against existing tenant users. The regular Users/Team `saveUser` flow performs no username-uniqueness validation. Therefore the PWA does not demonstrate a consistent global or per-company username-uniqueness rule. The future backend should treat username uniqueness (its scope and enforcement) as a NEW BACKEND DESIGN DECISION, not a PWA rule — see OPEN_DECISIONS.md #12.
- **PWA screens:** Team Members & Logins list, Create/Edit Login modal.

#### Roles (fixed, observed set — 11 roles)
`super`, `admin`, `sales`, `hvac_pm`, `solar_pm`, `mep_pm`, `engineer`, `inventory`, `service_mgr`, `service_eng`, `finance`. Each has a fixed menu of accessible screens in the PWA; the new backend's authorization model must reproduce the same role→action matrix documented under "Role-dependent actions" in each entity above/below, enforced server-side. Per-user overrides beyond role are UNSPECIFIED BY PWA — not observed, not to be invented.

### 3. Enquiry
- **Purpose:** a sales lead, tracked through follow-up to Won (converted to a Sales Order) or Lost.
- **Fields:** company reference, name (project/address), siteType (Residential | Commercial | Factory | Banquet Hall | Hospital | Office), capacity, phone, referenceSource, segment (a division, or "AMC"), rating (1–5), estimatedValue, remark, lastReviewDate, lastActionDone, nextActionDescription, nextActionDate, status (Open | Won | Lost), followUpLog[] (each {date, text}), lostReason, lostDate.
- **Required:** name.
- **Optional:** siteType, capacity, phone, referenceSource, rating, estimatedValue, remark, lostReason.
- **Relationships:** on confirmation, spawns exactly one SalesOrder (Enquiry → SalesOrder), and status becomes Won. The exact field-by-field copy/transform/not-copied behavior of this conversion, and the full downstream cascade it triggers, is recorded under SalesOrder's "Create" bullet below — do not summarize this as merely "Enquiry converts to SalesOrder." **Verified: the PWA itself stores no back-reference from a SalesOrder to its originating Enquiry** (no such field exists in the PWA's in-memory SO object); linking is one-directional only, via the Enquiry's own `remark`/`followUpLog` text mentioning the new SO number. The new backend's current schema/model already carries a candidate `enquiryId` field on SalesOrder for this purpose (see SalesOrder's "References" bullet) — whether to keep/finalize/rename it as a durable back-reference is an explicit, UNDECIDED NEW BACKEND DESIGN DECISION, not a PWA fact — see OPEN_DECISIONS.md. **RESOLVED — locked decision #20=D** (ENQUIRY_BUSINESS_DECISION_SHEET.md): `enquiryId` is kept, populated automatically by the conversion cascade, and enforced unique at the database level (see SalesOrder.js and OPEN_DECISIONS.md #20).
- **References:** Company.
- **Status/Lifecycle:** Open → Won (via SO creation) or Lost (reason optional but offered from a fixed pick-list, plus free-text remark) → Lost is reopenable back to Open. The PWA's own functional status enum is exactly these three values (`Open`, `Won`, `Lost`) — verified against every status-setting/-reading call site. `Contacted` and `Quoted` appear only in the out-of-scope V2 API status-vocabulary mapping (`ENQ_OUT`/`ENQ_IN`) and are never used by the PWA's own UI, `saveEnq`, `mEnq`, `vEnq`, `enqTable`, or `applyEnqFilt` code. Do NOT add `Contacted`/`Quoted` to the Enquiry status model.
- **Create:** by `sales` only — **verified:** the "+ New Enquiry" button is explicitly hidden for `admin` (`U.role!=="admin"` gates it), so `admin` cannot create a new Enquiry via the PWA UI at all.
- **Update:** append a follow-up (updates lastActionDone/next/nextActionDate/lastReviewDate and appends to followUpLog).
- **Delete/Archive:** no delete observed; Lost is the terminal-but-reopenable state, not a delete.
- **Role-dependent actions:** `sales` creates, edits, follows up, marks Lost, reopens, and converts to SO on any Enquiry in the company; `admin` can do everything `sales` can **except create a new Enquiry** (verified — the create button alone is hidden for `admin`; edit/follow-up/mark-Lost/reopen/convert-to-SO buttons carry no role gate at all); PM roles do not interact with Enquiries directly (no menu access). **Verified: none of this is enforced server-side or at the code level in the PWA** — every restriction above is UI-rendering-only (no view function checks the current role before acting); the new backend must implement real, server-side role/tenant authorization for these actions rather than copying "no check" as a design.
- **Division relevance:** `segment` field is a division (or "AMC").
- **Business rules demonstrated:** marking Lost requires (optionally) a reason from a fixed list (Price too high / Lost to competitor / Client dropped the project / Budget not approved / No response from client / Other) plus free text. Reopening sets `status` back to `Open` and appends one log entry — **verified: it does NOT clear the existing `lostReason`/`lostDate` values**, which remain stored (merely hidden from the detail view while `status` is not `Lost`) until the Enquiry is marked Lost again (whose values then overwrite them) or indefinitely if it never is. Whether the new backend should preserve this stale-field retention or clear both fields on reopen is an explicit, UNDECIDED NEW BACKEND DESIGN DECISION — see OPEN_DECISIONS.md. **RESOLVED — locked decision #18=A** (ENQUIRY_BUSINESS_DECISION_SHEET.md): the PWA behavior is preserved exactly — reopen does NOT clear `lostReason`/`lostDate` (see OPEN_DECISIONS.md #18). A direct field edit (name/siteType/capacity/segment/phone/referenceSource/rating/estimatedValue/remark, via the Edit modal) creates **no `followUpLog` entry and no other history** — only follow-ups and the three status-transition actions (Lost/Reopen/Won-conversion) are ever logged; whether the new backend should add edit-history tracking is a separate, UNDECIDED NEW BACKEND DESIGN DECISION — see OPEN_DECISIONS.md. **STATUS — #17 = HOLD FOR #3** (ENQUIRY_BUSINESS_DECISION_SHEET.md): intentionally NOT finalized independently; no bespoke Enquiry edit-history mechanism has been built — this remains governed by the broader audit-retention decision, OPEN_DECISIONS.md #3. On conversion to Won, `remark` is **overwritten by the system** with `"Converted to SO-<no>"`, replacing whatever free text the user had previously entered there.
- **PWA screens:** Enquiry List, Lost Enquiries, New/Edit Enquiry modal, Enquiry detail + follow-up log, filter bar (segment/site type/rating/reference/status/value range/review date/next-action date), segment-wise summary panel, CSV export. The dashboard's "Follow-ups due today" panel (`followupPanel()`) is rendered for the `sales` role **only** — verified: `admin` does not see it on their dashboard, despite otherwise having full edit/lost/reopen/convert access to every Enquiry.

### 4. SalesOrder
- **Purpose:** the confirmed commercial agreement for a project — costing, contacts, and payment milestones — that atomically creates the linked Project.
- **Fields:** company reference, orderNumber (per-tenant display sequence — see ID DESIGN), division, projectName, startDate, endDate, siteAddress, contacts[] (up to 2, each {name, designation, phone, email}), salesTeam, projectTeam, crucialPoints, totalCost, highSideSelling, highSidePurchase, lowSideCost, lowSideTargetExpense, lowSideActualExpense, termsAndConditions, paymentMilestones[] (up to 5, each {description, amount, received:boolean}).
- **Required:** projectName; division; at least implied by creation flow: an enquiry reference OR a direct fresh SO.
- **Optional:** every costing field, contacts, crucialPoints, endDate.
- **Relationships:** SalesOrder → Project (1:1, created together); SalesOrder.paymentMilestones → Payment (one Payment row created per **unpaid** milestone at SO-creation time, linked back by milestone index).
- **References:** Company. **Verified: the PWA itself stores no reference field to an originating Enquiry at all on the SalesOrder** — there is no such field in the PWA's in-memory SO object; when a SO is created from an Enquiry conversion, the PWA's only trace of that link is one-directional, recorded on the Enquiry side (its `remark`/`followUpLog` text naming the new SO number), never on the SalesOrder itself. The new backend's current schema/model already includes a candidate `enquiryId` field on `salesOrders` for this purpose; whether to keep/finalize/rename it as a durable back-reference (and how it should be populated/enforced) is an explicit, UNDECIDED NEW BACKEND DESIGN DECISION, not a PWA fact — see OPEN_DECISIONS.md. **RESOLVED — locked decision #20=D** (ENQUIRY_BUSINESS_DECISION_SHEET.md): kept as `enquiryId`, populated automatically on conversion, never client-editable, and enforced unique+sparse at the database level (see OPEN_DECISIONS.md #20).
- **Status/Lifecycle:** no separate SO status beyond its milestones' received flags and the linked Project's own lifecycle.
- **Create:** by `sales`/`admin`; **cascade on create:** creates one Project (initial stage = division's first stage, checklist = division's default ChecklistTemplate — note the Project's own `siteType`/`capacity` are left blank, **not** copied from either the Enquiry or the SO), creates one Payment per unpaid milestone, notifies the division's PM role + admin + finance, and (if created from an Enquiry) marks that Enquiry Won, overwrites its `remark`, and appends one `followUpLog` entry (see Enquiry section). **When creating from an Enquiry, verified field-by-field pre-fill behavior (all remain user-editable before the SO is actually saved):** copied unchanged — Enquiry `name`→SO `projectName`, `phone`→`contacts[0].phone`, `estimatedValue`→`totalCost`; transformed — `segment`→`division` (the literal value `"AMC"` maps to `"HVAC"`; every other value passes through unchanged); defaulted, **not** from the Enquiry — `startDate` (today), `salesTeam` (the *converting* user's own name — Enquiry has no stored owner/salesperson field to copy from), `termsAndConditions` (fixed boilerplate text); **not copied at all** — `siteType`, `capacity`, `referenceSource`, `rating`, `remark`, `lastReviewDate`, `lastActionDone`, `nextActionDescription`, `nextActionDate`, `followUpLog`, `lostReason`, `lostDate`. This conversion has no precondition beyond the UI gate (Enquiry `status==="Open"`) — **verified: the underlying save logic does not itself check the Enquiry's current status**, and nothing prevents an unrelated, non-enquiry-linked fresh SO from being created later even for a company that already has a Won enquiry (no hard 1:1 is enforced). Whether the new backend should add a guard against converting a non-Open Enquiry is an explicit, UNDECIDED NEW BACKEND DESIGN DECISION — see OPEN_DECISIONS.md. **RESOLVED — locked decision #19=B** (ENQUIRY_BUSINESS_DECISION_SHEET.md): the new backend adds real, transaction-safe protection — an Enquiry must be `Open` to convert, a second conversion is rejected, and the guard is race-safe (atomic conditional update + a database-level unique index) — see OPEN_DECISIONS.md #19 and src/services/enquiryService.js.
- **Update:** by `sales`/`admin` — editing an existing SO does not re-trigger the creation cascade. **RESOLVED — locked decision #24=A** (SALESORDER DECISIONS ARE LOCKED / OPEN_DECISIONS.md #24): editing an existing SO's milestones preserves each milestone's `received` flag from the pre-edit SO's **same array index** — not by matching description/identity — reproducing the PWA's own index-based (not ID-based) preservation exactly, including the case where reordering/removing an earlier row shifts a later row's preserved flag onto the wrong milestone. **RESOLVED — locked decision #23=A** (OPEN_DECISIONS.md #23): an SO-side milestone amount edit updates only the SO's own copy of that milestone's amount — it does **not** push the new amount onto the linked Payment record (see Payment section below for the asymmetric other-direction sync).
- **Delete/Archive:** no delete observed for a saved SO.
- **Role-dependent actions:** costing fields (`totalCost`, `highSide*`, `lowSide*`, and their derived margins) are hidden from `engineer` and `service_eng` roles in the detail view. **RESOLVED — locked decision #22=A** (OPEN_DECISIONS.md #22): SalesOrder create/edit is enforced server-side as `sales`/`admin` only, reproducing the PWA's own visible role intent (menu/button gating) as a real backend rule, even though the PWA itself has zero function-level role checks for these actions.
- **Division relevance:** one division per SO; division cannot be changed after project creation without re-deriving stage/checklist (UNSPECIFIED BY PWA whether division is editable after creation — the edit form allows it but no re-cascade logic was observed for an existing SO's division change).
- **Business rules demonstrated:** margin = (highSideSelling − highSidePurchase) + (lowSideCost − (lowSideActualExpense OR lowSideTargetExpense)); up to 5 payment milestones per SO; each milestone with a description and amount both present becomes a Payment obligation unless already flagged received.
- **PWA screens:** Sales Order list, New/Edit SO modal, SO detail (costing hidden per role), live "Sales Orders — Live Project Status" dashboard panel, CSV export.

### 5. Project
- **Purpose:** the execution record for a division's work on a Sales Order — stage, assigned engineers, checklist, delivery challans, execution log.
- **Fields:** company reference, salesOrderNumber (display link back to the SO), division, name, siteType, capacity, customer, stage (from that division's fixed stage sequence — see exact values below), startDate, endDate, assignedEngineers[] — **PWA LEGACY NAME REFERENCE**, vendor, status (Ongoing | Completed | In Service), checklistTemplateName (display only), checklist[] (see below), executionUpdates[] (each {date, actionDone, nextAction, nextActionDate, enteredBy}), deliveryChallans[] (see below), timelineSet: boolean, lastDelayNotifiedDate.
- **Stage sequences (PWA FACT, verified — exact `STAGES` values, each division's own fixed list):**
  - HVAC: Planning → Piping → Installation → Testing → Finishing → **Completed**
  - Solar: Planning → Fabrication → Installation → Wiring → Net Metering → **Completed**
  - MEP: Concept → Design In Progress → Internal Review → Client Review → **Delivered**
  Note the MEP list's terminal value is **not** the literal string "Completed" — see the Completion gate correction below.
- **Checklist item fields:** text, signResponsibility (ENGINEER | CLIENT | SALES | SERVICE), done: boolean, completedDate, pmSigned: boolean, remark, photos[] (image references), targetDate, approval {approverName, approvedByRole, approvedDate, approvalRemark, signatureImage, enteredByUserId}. **Correction (verified against source):** `approverName` is a free-typed name — for a CLIENT-type sign point this is the person on site, who is *not* a system User and must never be modeled as a User reference; `enteredByUserId` is a separate, durable reference to the logged-in staff member who actually recorded the approval (for non-CLIENT sign points the two happen to be the same person, but the PWA still stores them as the two distinct fields `by`/`enteredBy`).
- **Delivery challan item fields:** challanNumber, date, materialName, quantity, unit, returnable: boolean, returnedQuantity, recordedBy, remark.
- **Required:** name, division, stage (defaulted from division's stage list at creation).
- **Optional:** siteType, capacity, customer, vendor, endDate.
- **Relationships:** created together with its SalesOrder (1:1 via salesOrderNumber); checklist seeded from a ChecklistTemplate; on Completed status + commissioning approval, spawns exactly one Contract (Project → Contract).
- **References:** Company, SalesOrder, ChecklistTemplate (at seed time only — the checklist itself is then copied/embedded on the project and edited independently).
- **Status/Lifecycle:** `stage` progresses through the division's fixed ordered stage list (see Stage sequences above). **Correction (verified against source):** the completion gate is triggered by the literal stage value `"Completed"` (`savePM()` checks `p.stage==="Completed"`), not by "reaching the division's terminal stage" in general. Since HVAC's and Solar's terminal stage is literally `"Completed"`, this gate applies to them; MEP's terminal stage is `"Delivered"`, so this stage-based completion branch is **structurally unreachable for MEP** — not merely excluded by policy, but by the mechanics of the source code (MEP's stage dropdown never offers the string "Completed" at all). When triggered (HVAC/Solar), it requires (with an explicit override-confirmation) that all returnable delivery-challan material has been returned AND all checklist points are done+approved; on success sets status=Completed. Completed (divisions other than MEP) is then eligible for Service-Manager/Admin "commissioning approval" → creates the linked Contract and sets status=In Service.
- **Create:** always via SalesOrder creation cascade (never created standalone in the PWA).
- **Update:** stage/assignedEngineers/vendor by the division PM or admin (`savePM`); checklist point tick/approve/remark/photo by engineer or PM per sign-responsibility gating; execution update append by PM or assigned engineer; delivery challan add/return by PM; timeline set/edit by PM.
- **Delete/Archive:** no delete observed.
- **Role-dependent actions:**
  - Only the division's PM (or admin) may change stage, reassign engineers, edit vendor, set/edit the timeline, apply a different checklist template, add/edit/remove checklist points, view SO payment milestones, and raise a milestone to finance.
  - An assigned engineer (name match in `assignedEngineers[]`) or the PM may tick a checklist point (subject to the timeline gate below) and add execution updates.
  - Only the role named in a checklist point's `signResponsibility` may approve that specific point (CLIENT approval additionally captures an on-screen signature).
  - Only Service Manager or Admin may approve commissioning (Project → Contract conversion).
- **Division relevance:** every field and workflow above is scoped to exactly one division; stage sequence itself is division-specific.
- **Business rules demonstrated:**
  - **Timeline gate (corrected, verified against source):** `saveTimeline()` blocks entirely only if **zero** checklist points received a target date; if some but not all points got a date, it warns via `confirm()` but still allows saving, and unconditionally sets `timelineSet=true`. `tickChk()`'s actual gate is project-level: `timelineSet===true AND at least one checklist point has a target date` (`timelineReady()`) — it does **not** check that the specific point being ticked has its own target date. An engineer CAN tick a checklist point that itself has no target date, as long as the project has `timelineSet=true` and at least one (any) point is dated. Do not model this as "every point must have a target date before any point can be ticked" — that is not what the PWA does. Passing a target date without completion auto-notifies the PM role + sales + admin, throttled to once per project per day.
  - **Completion gate:** blocked (with override-confirm) by pending returnable material or incomplete/unapproved checklist points — see the Status/Lifecycle correction above for the MEP-unreachable nuance of when this gate can even be reached.
  - **Checklist approval:** each point's declared sign role must approve it before the PM may counter-sign it.
  - **Photos:** any number of photos may be attached per checklist point.
  - **Delivery challan:** returnable material logged separately from the Inventory subsystem — **UNSPECIFIED BY PWA whether Delivery Challan should integrate with InventoryItem/InventoryIssue in the new system**; the PWA keeps them as two unconnected mechanisms.
  - **Commissioning conversion:** creates a 1-year warranty Contract with a PM visit schedule derived from a fixed quarterly cadence (see Contract).
- **PWA screens:** Projects list (per division / all for admin), Project detail (very large: stage/engineer/vendor edit, SO payment milestones, delivery challan panel, execution updates, timeline/delay banners, checklist with photo/signature/approval, completion report download + print), Project Timeline modal, Checklist point add/edit modals.
- **IMPLEMENTATION STATUS (Project Execution task, `PWA_COVERAGE_AUDIT_PROJECT.md`):** fully implemented in `src/services/projectService.js` / `src/routes/projectRoutes.js`, covering every workflow this section describes EXCEPT Inventory integration, Contract creation, and ServiceCall (all explicitly out of scope; see `prepareServiceConversion` for the sole, documented deferred integration point — an eligibility check only, no Contract is created). All 12 open decisions the coverage audit raised (§30) are now resolved and recorded in `OPEN_DECISIONS.md` #25-#36. `new-app/docs/PROJECT_IMPLEMENTATION_CONTRACT.md`, referenced as a "read first" doc by the task that authorized this work, does **not** exist in this repository — `PWA_COVERAGE_AUDIT_PROJECT.md` was used as the equivalent, pre-verified source of truth instead, per that same task's own fallback instruction. One additive, non-business schema change was made: `Project.js`'s `deliveryChallans[].receivedByName` (free text, alongside the existing `recordedByUserId` ref) — see `OPEN_DECISIONS.md` #31.

- **Project Decision Lock (formal consolidation):** the 12 Project decisions from `PWA_COVERAGE_AUDIT_PROJECT.md` §30, already individually resolved as `OPEN_DECISIONS.md` #25–#36, are now additionally consolidated into a single dedicated document, `new-app/docs/PROJECT_DECISION_LOCK.md` (cross-referenced there also as `OPEN_DECISIONS.md` #37–#48). It restates each decision's exact PWA behavior, what the backend must/must NOT do, and infrastructure-only exceptions, plus a consolidated "DO NOT FIX" list drawn from `PWA_COVERAGE_AUDIT_PROJECT.md` §23's full 22-item quirk catalogue. This is a documentation consolidation only — no change to `Project.js`, `projectService.js`, or `projectRoutes.js` accompanies it.

### 6. ServiceCall
- **Purpose:** a service complaint or a scheduled preventive-maintenance (PM) visit, from registration to completion with a signed report.
- **Fields:** company reference, complaintNumber (display sequence — see ID DESIGN), type (Complaint | PM), customer, phone, site, appointmentDate, appointmentTime, complaintDescription, status (Registered | Assigned | Scheduled | Completed), engineer — **PWA LEGACY NAME REFERENCE**, registeredDate, report {make, model, capacity, refrigerantOrUnitType, materialUsed, serviceDescription, checklistResults (map of fixed checklist item → free-text result), serviceType (Installation | Warranty | AMC | Chargeable), amount, engineerRemark, customerRemark}, clientSignatureImage, contractReference (present only for a PM visit spawned from a Contract).
- **Required:** customer.
- **Optional:** phone, site, complaintDescription (Complaint type) or appointmentDate/Time (PM type).
- **Relationships:** optionally spawned from a Contract (PM type); on completion with a Chargeable report + amount > 0, creates a Payment.
- **References:** Company, optionally Contract.
- **Status/Lifecycle:** Registered (complaint) or Scheduled (PM, pre-dated from the contract) → Assigned (engineer + appointment set) → Completed (report filled + client signature captured, mandatory before completion). Completing a PM visit also marks the corresponding scheduled month done on the parent Contract.
- **Create:** Complaint type by any role via "Register Complaint"; PM type auto-offered from the Contract's due-visit panel.
- **Update:** assignment (engineer/date/time) by Service Manager/Admin; report + signature by the assigned engineer or Service Manager.
- **Delete/Archive:** no delete observed.
- **Role-dependent actions:** only Service Manager/Admin assigns; only the assigned engineer or Service Manager fills the report and completes the call.
- **Division relevance:** not division-scoped (service applies across the business, not per HVAC/Solar/MEP).
- **Business rules demonstrated:**
  - Client signature is **mandatory** to mark a call Completed.
  - Completing with serviceType=Chargeable and amount>0 auto-creates a Payment and notifies finance.
  - Fixed customer-message templates exist for four moments (registration-complaint, completion-complaint, registration-PM, completion-PM), each with company name/phone/email interpolated, a WhatsApp deep-link, and a copy-to-clipboard action. This is a demonstrated business rule (canned message content), not just UI chrome — preserve the four message templates as configurable text in the new backend, not hard-coded.
- **PWA screens:** Service Call Register list, Register Complaint modal, Service Call detail (assignment + report + signature pad + message preview/send), CSV export.
- **Decision-lock addendum (ServiceCall):** the audit's open items are now resolved in `new-app/docs/SERVICECALL_DECISION_LOCK.md`, cross-indexed at `OPEN_DECISIONS.md` #64–#76. Two schema-relevant clarifications recorded there: (1) `report.checklistResults`'s six keys (matching the fixed `SVC_CHK` labels shown in the Fields line above) are enforced as a closed set at the service layer, since the PWA's own checklist UI never allows any other key — an infrastructure-only API-surface hardening, not a business-rule change (Decision 1). (2) the human-facing `complaintNumber` ("PSC") is generated per-company via the existing `Counter.js`/`getNextSequence` primitive, deliberately narrowing the PWA's own accidental global (non-per-tenant) PSC sequence (Decision 3). No schema or code change accompanies this addendum — `ServiceCall.js` already matches every rule restated in the decision lock except the checklist-key enforcement, which is a service-layer instruction for whoever implements ServiceCall.

### 7. Contract (AMC / Warranty)
- **Purpose:** a recurring maintenance agreement (either paid AMC or free 1-year warranty from a completed project) with a scheduled visit calendar.
- **Fields:** company reference, customer, phone, email, site, capacity, startDate, endDate, amcType (Monthly | Quarterly | Half-Yearly — sets visit cadence: 12/4/2 visits respectively), category (AMC | Warranty), amount, scheduledVisits[] (each {month "YYYY-MM", completedDate}), originatingProjectReference (set only when created via project-completion conversion).
- **Required:** site; startDate; amcType; category.
- **Optional:** customer, phone, email, capacity, amount (0 for Warranty-from-project by default).
- **Relationships:** optionally created from a completed Project (Project → Contract); spawns ServiceCall rows (PM type) for each due visit.
- **References:** Company, optionally Project.
- **Status/Lifecycle:** derived, not stored — Active / Expiring Soon / Expired, computed from `endDate` at read time. Expired/expiring contracts surface as renewal opportunities (Warranty → paid AMC upsell).
- **Create:** manually by Service Manager/Admin ("Add Contract"), or automatically on commissioning approval (see Project).
- **Update:** by Service Manager/Admin.
- **Delete/Archive:** no delete observed.
- **Role-dependent actions:** Service Manager/Admin only.
- **Division relevance:** not division-scoped.
- **Business rules demonstrated:** visit schedule is generated at creation from `amcType` and `startDate` (Monthly → 12 monthly entries; Half-Yearly → 2 entries 6 months apart; Quarterly → 4 entries 3 months apart); a visit becomes "due" once its month arrives and stays "due/overdue" until its linked ServiceCall (PM type) is completed.
- **PWA screens:** AMC/Warranty Contracts list + PM-Due panel + Renewal-Opportunities panel, Add Contract modal, CSV export.

### 8. Payment
- **Purpose:** a single billing/collection obligation (a SO milestone, a chargeable service amount, or a manual entry) tracked to full or partial receipt.
- **Fields:** company reference, projectOrReference (free-text label), personName, phone, amount, remark, lastCallDate, discussionNotes, nextCallDate, status (Pending | Received — derived from the part-payment ledger), salesOrderNumber + milestoneIndex (present only when linked to an SO milestone), partPayments[] (each {amount, date, mode (Bank Transfer/NEFT | Cheque | UPI | Cash | RTGS), reference, remark, invoiceIssued: boolean, enteredBy, editedBy, editedOn}), raisedToFinance {raisedBy, raisedDate, collectByDate, priority (Normal | Urgent), note} (present only once a PM has raised this milestone), receivedDate.
- **Required:** projectOrReference, amount, personName.
- **Optional:** phone, remark, salesOrderNumber/milestoneIndex, raisedToFinance.
- **Relationships:** optionally linked back to a SalesOrder milestone (keeps both records' "received" state in sync); optionally created from a ServiceCall's chargeable report.
- **References:** Company, optionally SalesOrder, optionally ServiceCall (implicitly, via how it was created — not a stored back-reference in the PWA).
- **Status/Lifecycle:** Pending until the running sum of `partPayments[]` amounts reaches `amount`, then Received; editing/removing a part-payment re-derives status (can move back to Pending).
- **Create:** automatic (SO milestone creation, chargeable service completion) or manual by finance ("Add Pending Payment").
- **Update:** add/edit/delete a part-payment entry (finance); edit the milestone itself — amount cannot be reduced below what is already received; follow-up notes (lastCall/nextCall/discussion) by finance.
- **Delete/Archive:** a payment not linked to an SO milestone can be deleted outright; an SO-linked one is not directly deletable from this screen (no delete control shown for SO-linked rows).
- **Role-dependent actions:** finance manages the ledger; a division PM may "raise to finance" (with urgency + collect-by date) or "remind finance" on an already-raised, still-unpaid milestone — a worklist signal only, not a status change. The observed PWA action notifies both **finance and admin** (`notify(["finance","admin"], ...)`) — finance is not the sole recipient. **RESOLVED — locked decision #22=A** (OPEN_DECISIONS.md #22): the payment ledger (part-payments, milestone edits, manual entries, deletes, reports) is enforced server-side as `finance`/`admin` only; "raise to finance" is enforced server-side as the SO's own division PM role or `admin` (a PM may not raise a milestone for another division's SO) — reproducing the PWA's own visible role intent as real backend enforcement, since the PWA itself has no function-level role check here at all.
- **Division relevance:** inherited from the linked SO's division; not itself division-typed.
- **Business rules demonstrated:**
  - Multiple partial payments accumulate against one milestone; status auto-settles to Received only once the balance reaches zero.
  - Editing a part-payment or the milestone amount re-syncs status and (if SO-linked) mirrors the received flag back onto that SO's milestone row. **RESOLVED — locked decision #23=A** (OPEN_DECISIONS.md #23): this Payment-side milestone-amount edit writes the new amount **forward** onto the linked SO's own milestone copy (`paymentMilestones[i].amount`) — but, per the same locked decision, an SO-side edit never writes back here (see SalesOrder section above); this asymmetry is preserved verbatim, not unified into a bidirectional sync. Also preserved verbatim: the PWA's own milestone-amount edit does not itself recompute payment `status`/received-flag — only a part-payment add/edit/delete re-syncs those.
  - AMC/warranty contract `amount` is **not** observed flowing into this Payment ledger anywhere in the PWA — **UNSPECIFIED BY PWA whether AMC/warranty billing should create Payment records in the new system.**
- **PWA screens:** Payments dashboard (KPIs, pending panel, receipts ledger, settled list), Add Payment / Payment History / Edit Payment Entry / Edit Milestone / Follow-up modals, Add Manual Pending Entry, CSV exports (pending+received, receipts ledger).

### 9. Notification
- **Purpose:** in-app, role/user-targeted messages generated by nearly every business action.
- **Fields:** company reference, text, date, targetRoles[] or targetUserIds[] or the literal "all company users" marker, readByUserIds[].
- **Required:** text, at least one target.
- **Optional:** none beyond target shape.
- **Relationships:** fanned out from essentially every other entity's mutating actions (see trigger catalogue below) — not a parent/child relationship, a cross-cutting side effect.
- **References:** Company; conceptually the triggering entity, but the PWA does not store a back-reference from the notification to what caused it.
- **Status/Lifecycle:** unread → read (per viewing user, tracked in `readByUserIds[]`); no delete/expiry observed.
- **Create:** side-effect of other actions (see trigger catalogue) — never created directly by a user.
- **Update:** only the read-state, per viewer, on viewing the Notifications screen.
- **Delete/Archive:** not observed. **UNSPECIFIED BY PWA: retention/expiry policy** — see OPEN_DECISIONS.md.
- **Role-dependent actions:** targeting is always by role-list, by "everyone in the company", or (implicitly) by the record's assigned person — never demonstrated as a raw arbitrary user pick.
- **Division relevance:** many triggers target a division's PM role specifically (`hvac_pm`/`solar_pm`/`mep_pm`), derived from the triggering record's division.
- **Business rules demonstrated — full trigger catalogue observed:** enquiry follow-up due; SO created (division PM + admin, and finance); project stage changed (finance + admin; service manager additionally on reaching Completed); engineer newly assigned to a project; checklist point completed late (delay); all checklist points completed; project timeline set; project delayed (daily-throttled); commissioning approved → converted to service; material issued to staff; low/out-of-stock; material returned; return request raised by staff; return request rejected; PM visit scheduled/completed; chargeable-service payment created; service call assigned; service call completed; payment received in full; payment received in part.
- **PWA screens:** Notifications list (mark-all-read-on-view).

### 10. ChecklistTemplate
- **Purpose:** a reusable, division-scoped, named list of checklist points that seeds a new Project's checklist.
- **Fields:** company reference, division, name, items[] (each {text, signResponsibility}), isDefault: boolean, createdBy, createdDate.
- **Required:** division, name.
- **Optional:** items (can start blank), isDefault.
- **Relationships:** ChecklistTemplate → Project.checklist (copied/embedded at Project creation, or applied later by a PM — see Project).
- **References:** Company.
- **Status/Lifecycle:** none beyond default/non-default; not deletable below one remaining template per division.
- **Create:** by Admin or the division's PM ("+ New Checklist"), optionally copied from an existing template.
- **Update:** rename; add/edit/remove/reorder points; set as the division's default (unsets any previous default).
- **Delete/Archive:** allowed only if more than one template remains for that division; existing projects keep their own already-copied checklist unaffected by a template's later deletion.
- **Role-dependent actions:** Admin or the relevant division PM manage templates; all other roles view read-only via the project they're assigned to.
- **Division relevance:** every template belongs to exactly one division.
- **Business rules demonstrated:** exactly one default template per division; creating an SO applies the division's default template to the new project; a PM may later replace (with a data-loss warning if points are already completed) or append a different template's points onto an in-progress project.
- **PWA screens:** Checklist Library (per division), New/Rename Checklist modal, Checklist points editor, Apply-Checklist-to-Project modal.

  > Per instruction: no separate "templates" entity is modeled — the PWA's legacy `DB.templates` blob is a superseded seed fallback with no user-facing management screen and is fully subsumed by ChecklistTemplate. It is not carried forward unless later evidence shows it is required.

  > **RESOLVED — locked decision #21=A** (SALESORDER DECISIONS ARE LOCKED / OPEN_DECISIONS.md #21): later evidence (the SalesOrder coverage audit) showed this fallback IS required — `saveSO` itself falls back to the legacy hardcoded `DB.templates[division]` list whenever a division has zero ChecklistTemplate rows at all. The new backend reproduces the full PWA chain exactly: default ChecklistTemplate → first ChecklistTemplate for the division → this legacy hardcoded list (verbatim point text/signResponsibility, `src/models/shared/legacyChecklists.js`) → empty only when none of those exist. This does not reopen the "no separate templates entity" modeling decision above — the legacy list is a hardcoded fallback constant, not a managed entity.

### 11. InventoryCategory
- **Purpose:** a simple named grouping for InventoryItem.
- **Fields:** company reference, name.
- **Required:** name. **Optional:** none.
- **Relationships:** InventoryCategory ← InventoryItem (many).
- **Lifecycle:** create/rename freely; delete blocked while any item still references it.
- **Role-dependent actions:** Inventory role or Admin.
- **PWA screens:** Categories & Locations panel.

### 12. InventoryLocation
- **Purpose:** a physical stock point (e.g. godown, site store, service van) — an item's stock is tracked per location.
- **Fields:** company reference, name.
- **Required:** name. **Optional:** none.
- **Relationships:** InventoryLocation ← InventoryItem.stock (many, as a per-location quantity map) and ← InventoryIssue.location / InventoryTransaction.from/to.
- **Lifecycle:** create/rename freely; delete blocked while any item still holds stock there.
- **Role-dependent actions:** Inventory role or Admin.
- **PWA screens:** Categories & Locations panel; Stock Transfer.

### 13. InventoryItem
- **Purpose:** a stock-keeping unit — tool/equipment (returnable) or consumable (non-returnable) — with per-location quantities.
- **Fields:** company reference, code, name, category reference, unit (Nos | Mtr | Kg | Set | Box | Roll | Ltr), returnable: boolean, minimumStockLevel, ratePerUnit, stockByLocation (map of InventoryLocation reference → quantity).
- **Required:** name.
- **Optional:** code, category, minimumStockLevel, ratePerUnit.
- **Relationships:** InventoryItem → InventoryIssue (many), InventoryItem → InventoryTransaction (many, the ledger).
- **Status/Lifecycle:** derived stock state — In Stock / Low Stock (≤ minimum) / Out of Stock (≤ 0) — computed from total quantity across locations, not stored.
- **Create/Update:** by Inventory role or Admin; creating a new item may set opening stock per location (each opening entry also writes an "Opening Stock" ledger transaction).
- **Delete/Archive:** delete allowed; transaction history is explicitly retained (not cascaded away).
- **Role-dependent actions:** Inventory role or Admin issue/adjust/edit; all roles can view stock.
- **Division relevance:** not division-scoped (shared pool across the tenant).
- **Business rules demonstrated:** `returnable` flag is the pivot for the entire issue/return workflow (see InventoryIssue); low/out-of-stock automatically notifies inventory + admin at the moment an issue pushes a level below minimum.
- **PWA screens:** Stock list, Add/Edit Item modal, Item detail (stock-by-location, issued/allocated, transaction history), Add/Adjust Stock modal, category-wise summary panel, CSV export.

### 14. InventoryIssue
- **Purpose:** one record of material handed to a staff member for a site/project — the core, stateful inventory transaction that tracks return/consumption over time.
- **Fields:** company reference, item reference, quantityIssued, staffName — **PWA LEGACY NAME REFERENCE**, site (free text, resolved at issue time from a picklist of open projects/service calls/"Office"), projectReference (optional), fromLocation reference, date, returnable: boolean (copied from the item at issue time), quantityReturned (cumulative), quantityUsed (cumulative, marked consumed-on-site), status (derived, see state machine), returnRequested: boolean + requestedQuantity + requestedDate + requestNote (staff-initiated), issuedBy.
- **Required:** item, quantityIssued, staffName, site.
- **Optional:** projectReference, remark.
- **Relationships:** InventoryItem → InventoryIssue; every mutation additionally writes an InventoryTransaction.
- **Status/Lifecycle — state machine, driven by `balance = quantityIssued − quantityReturned − quantityUsed`:**
  Issued → (staff requests a return) Return Requested → (inventory receives, in full or part) Partially Returned → (balance reaches zero via return and/or "mark used") Returned | Returned / Used | Consumed (fully used, nothing returned).
  **Documentation correction (see `INVENTORY_DECISION_LOCK.md` §24, `OPEN_DECISIONS.md` #78/#79):** the literal `"Returned"` outcome IS reachable by the PWA's own `issStatus()` derivation (fully returned, nothing marked used) — independently re-verified by direct execution in `PWA_COVERAGE_AUDIT_INVENTORY.md` §10/§25 item 9, correcting an earlier characterization at `OPEN_DECISIONS.md` #16 (preserved, marked superseded, not deleted). The combined status is spelled `"Returned / Used"` (with spaces), matching the PWA's literal source.
- **Create:** by Inventory role or Admin (Issue Material action) — reduces the source location's stock immediately.
- **Update:** staff may request a return (self-service, any quantity up to balance) or have the balance marked "used on site" (closes without a return); Inventory role receives/rejects the request, or records a direct return/partial return (with an optional "damaged — write off" path that logs the quantity but does **not** restock it), or marks the remaining balance used.
- **Delete/Archive:** no delete observed — the record persists through its full lifecycle to closure.
- **Role-dependent actions:** any staff member manages only their own issues (self-service return request, view via "My Material"); Inventory role/Admin perform the actual receive/reject/adjust actions.
- **Division relevance:** not division-typed; `site`/`projectReference` link it to whichever division's project it was issued for, but the record itself carries no division field.
- **Business rules demonstrated:** **any** issued material — returnable tool or leftover consumable — can be returned, fully or partially, at any time; the unreturned balance can alternatively be marked "used on site" to close the issue without a physical return; a damaged return is logged but excluded from restocking.
- **PWA screens:** Issue Material list/modal, My Material (staff self-service), Material Returns list/modal (receive/reject), Mark Used modal, CSV exports (issued material, returns).

### 15. InventoryTransaction
- **Purpose:** the immutable, append-only ledger underlying every stock-affecting action — the audit trail for the whole Inventory subsystem.
- **Fields:** company reference, date, type (Opening Stock | Purchase In | Damage / Write-off | Adjustment | Issue | Return | Transfer | Consumed), item reference, quantity, fromLocation reference (if applicable), toLocation reference (if applicable), recordedBy, referenceText (e.g. PO/bill number), remark.
- **Required:** type, item, quantity, recordedBy.
- **Optional:** fromLocation, toLocation, referenceText, remark (depends on type).
- **Relationships:** written by every mutation site in InventoryItem/InventoryIssue (opening stock, manual adjust/write-off, issue, return, transfer, consumption).
- **Status/Lifecycle:** append-only — never updated or deleted once written.
- **Create:** automatic, as a side effect of every inventory-affecting action; never created directly by a user.
- **Update/Delete:** none — by design, this is the audit ledger.
- **Role-dependent actions:** written by whichever role performed the underlying action; viewable by Inventory role/Admin (and per-item, by anyone viewing that item).
- **Division relevance:** none directly.
- **Business rules demonstrated:** this is the closest thing to a proper ledger in the whole PWA and should map directly to an immutable `inventory_transactions` collection in the new backend — every quantity change anywhere in Inventory must produce exactly one corresponding entry here.
- **PWA screens:** Inventory Transaction History (searchable), per-item transaction history panel, CSV export.

---

## Relationships (summary)

```
Company
 → User
 → Enquiry → SalesOrder
 → SalesOrder → Project
             → Payment (milestones)
 → Project → checklist items (embedded, seeded from ChecklistTemplate)
           → delivery challans (embedded)
           → execution updates (embedded)
           → (on Completed + commissioning approval) → Contract
 → Contract → ServiceCall (PM visits)
 → ServiceCall → Payment (when chargeable)
 → ChecklistTemplate → Project.checklist (initialization only; then independently edited per project)
 → InventoryItem → InventoryIssue
                 → InventoryTransaction
 → Notification (fanned out from nearly every entity's mutating actions — cross-cutting, not a strict parent/child edge)
```

**PWA LEGACY NAME REFERENCE fields requiring conversion to durable User IDs in the new backend:**
`Project.assignedEngineers[]`, `ServiceCall.engineer`, `InventoryIssue.staffName`.

---

## Workflow Specification (observed end-to-end; not redesigned)

1. **Enquiry → Sales Order:** a confirmed Open enquiry is converted via "Confirmed → Create SO"; the enquiry becomes Won.
2. **Sales Order → Project:** SO creation atomically creates the Project (division's first stage, division's default checklist template applied) and creates a Payment row per unpaid milestone; notifies the division PM + admin + finance.
3. **Project timeline → Checklist execution:** the PM sets target dates and saves the timeline. **Corrected:** saving only requires that at least one point received a date (zero dates blocks saving; partial dates only warn-and-allow); once `timelineSet=true`, any checklist point can be ticked as long as at least one point in the project has a target date — not that the ticked point itself does. Overdue targets auto-notify PM + sales + admin (throttled daily per project).
4. **Checklist approval:** the point's declared sign-responsibility role approves it (CLIENT capture includes an on-screen signature); the PM may then counter-sign. **Corrected:** the approval records a free-typed `approverName` (for CLIENT, a non-User person on site) separately from `enteredByUserId` (the logged-in staff member who recorded it, always a durable User reference).
5. **Project completion:** triggered only when `stage` is set to the literal value "Completed" — reachable for HVAC/Solar (whose terminal stage is named "Completed") but **structurally unreachable for MEP** (terminal stage "Delivered"); when reachable, blocked with an explicit override-confirmation by any pending returnable delivery-challan material or any incomplete/unapproved checklist point; on success sets status Completed and notifies finance (payment reminder) and (non-MEP) service manager (commissioning prompt).
6. **Project → Contract/service:** Service Manager/Admin approves commissioning; creates a 1-year warranty Contract with a visit schedule; project status becomes In Service.
7. **Contract → PM Service Call:** a due/overdue scheduled visit is turned into a PM-type ServiceCall from the contract's due-visits panel.
8. **Service complaint → completion:** register (auto customer message) → assign engineer/date → engineer files the report + checklist + client signature → complete (auto completion message); a Chargeable report with an amount auto-creates a Payment.
9. **Inventory issue → return/used:** issue reduces source-location stock and creates an Issue record; staff may self-request a return (full/partial) or have the balance marked used-on-site; Inventory role receives/rejects requests or records returns directly (with a damaged/write-off path); every movement writes an InventoryTransaction.
10. **Payment milestone → part-payment → received:** milestones arrive from SO creation (or a chargeable service call, or a manual finance entry); part-payments accumulate until the balance clears, auto-settling status and mirroring back to the SO milestone.
11. **PM raise-to-finance signal:** a division PM flags an overdue milestone to finance with an urgency level and a collect-by date — a worklist signal only, does not itself change payment status.
12. **Notifications:** fanned out automatically from nearly every action above per the full trigger catalogue documented under the Notification entity.

---

## Addendum — Contract (§7) Decision Lock Consolidation

**Status: LOCKED.** This addendum records, without modifying any text above, the outcome of the independent Contract Coverage Audit (`PWA_COVERAGE_AUDIT_CONTRACT.md`) and its formal decision consolidation (`CONTRACT_DECISION_LOCK.md`, `OPEN_DECISIONS.md` #49–#63). It supersedes nothing above by deletion — it clarifies two points and adds decision cross-references.

- **DOC GAP correction (does not delete the original text above):** §7's line `**Update:** by Service Manager/Admin.` describes only who is *authorized* to reach the AMC/PM screen — it does **not** mean a Contract-edit function exists. The Contract Coverage Audit's exhaustive source trace (`PWA_COVERAGE_AUDIT_CONTRACT.md` §9) found **no Contract-edit function of any kind** anywhere in the PWA: `customer`/`phone`/`email`/`site`/`cap`/`start`/`end`/`amcType`/`cat`/`amount` are all write-once at creation, for both creation paths. The only field ever mutated post-creation is `scheduledVisits[i].completedDate` (`svcs[i].done`), and only as an automatic side effect of completing a linked PM ServiceCall — never a direct user-initiated edit. **This is now locked as CONTRACT_DECISION_LOCK.md Decision 2 (Choice A): Contract is immutable after creation; no edit capability is to be added.**
- **DOC GAP correction:** relatedly, §7's `**Delete/Archive:** no delete observed.` is confirmed exact and is now locked as `CONTRACT_DECISION_LOCK.md` Decision 3 (Choice A): no delete capability is to be added for Contract.
- **PM cadence re-confirmation:** §7's cadence statement ("Monthly → 12 monthly entries; Half-Yearly → 2 entries 6 months apart; Quarterly → 4 entries 3 months apart") is independently re-verified, literal-source-correct, by the Contract Coverage Audit (§5) — **not** "6 visits/6 months" for Half-Yearly, which was a since-corrected working assumption that never appeared in this document. No change needed here.
- **Full decision set:** all 15 Contract/ServiceCall gap items from the audit's §25 are resolved (all "preserve PWA exactly" except the one server-side-role-enforcement infrastructure adaptation) in `new-app/docs/CONTRACT_DECISION_LOCK.md` and cross-indexed at `OPEN_DECISIONS.md` #49–#63. See that document for the full exact-behavior / must-do / must-NOT-do / DO NOT FIX write-up per decision.
- **No schema or code change accompanies this addendum.** `Contract.js`/`ServiceCall.js` already match this document's field inventory and the audit's findings; this is a documentation-only consolidation.

---

## Addendum — Contract (§7) Implementation Complete

**Status: IMPLEMENTED.** This addendum records that the Contract service/route layer described as "not yet implemented" throughout the Contract Coverage Audit and Decision Lock has now been built, in `new-app/backend/src/services/contractService.js` and `new-app/backend/src/routes/contractRoutes.js`, exactly per `CONTRACT_DECISION_LOCK.md`'s 15 locked decisions. It does not modify any text above or in the prior addendum — it only records completion and one storage-layer note.

- **What was built:** manual AMC/Warranty creation (`createManualContract`), Project→Warranty conversion (`convertProjectToContract`, reusing `projectService.isEligibleForServiceConversion` as its safety gate per Decision 10), read/list/search (`getContract`/`listContracts`), the PM-Due and Renewal-Opportunities dashboard panels, the exact 20-column/4-visit-slot-truncated CSV export (`exportContractsCsv`), and the Contract-facing half of the PM-visit-completion boundary (`completePmVisitForContract`, stamping the first currently-due index per Decision 4) for a future ServiceCall module to call. No edit/delete endpoint exists, per Decisions 2-3. No ServiceCall or Inventory business module was built.
- **Storage-layer note (Decision 8 reconciliation):** `Contract.js`'s `endDate` field was changed from `required: true` to `default: null`, so that a manual creation with no `end` date (which the PWA itself always accepted, with no fallback or validation) is never rejected at the storage layer. `contractService.js`'s status computation treats a null `endDate` as unconditionally "before any real date," reproducing the PWA's own blank-string-sorts-first outcome (immediately "Expired") exactly. This is a storage-representation necessity, not a business-rule change — see `Contract.js`'s own updated field comment and `contractService.js`'s class doc comment for the full reasoning.
- **Tests:** `new-app/backend/tests/contractService.test.js` (31 tests, all passing) covers both creation paths' exact field defaults, the 12/2/4 PM cadence formulas, the one-year-warranty end-date calculation, status/due computations (including the 45-day threshold and the Expired-still-shows-due-visits quirk), the first-due-index completion-stamping quirk, search/list/dashboard/report behavior, server-side role enforcement, and tenant isolation — plus the full existing regression suite (every other test file in `new-app/backend/tests/`) re-run and confirmed passing alongside it.
