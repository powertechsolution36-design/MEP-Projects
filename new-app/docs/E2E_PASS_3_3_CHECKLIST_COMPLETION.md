# E2E Pass 3.3 — Project → Checklist → Completion

This file was not written to disk when Pass 3.3's Phase A verification ran
(that task's report was returned as text only, per its own instruction not
to create a doc file unless separately instructed). It is written here, at
the start of the Phase B fix task, from that Phase A report's content
(reproduced faithfully below, §1), followed by the Phase B fix record for
each finding (§2).

---

## §1. Phase A report (verbatim, as originally returned)

**Decision: BLOCKED 3.3.**

**PWA Source Map:** Constants `HVAC_CHK`/`SOLAR_CHK`/`MEP_CHK`
(MEP_PROJECTS_PWA/index.html lines 180-221), `STAGES` (line 222, MEP
terminal="Delivered", HVAC/Solar terminal="Completed"), `mkchk()` (233),
`seedChklists()` (236). Checklist Library: `chkLists()`, `defaultChkList()`,
`chkListById()`, `canEditChk()` (2744-2747); `vChecklists()` (2748);
`mNewChkList()`/`createChkList()` (2760-2775); `dupChkList()` (2776-2782);
`setDefChkList()` (2783-2787); `delChkList()` (2788-2794); `vChklist()`
(2795-2809); `mRenameChkList()`/`doRenameChkList()` (2810-2817);
`mChkPoint()`/`saveChkPoint()` (2818-2833); `rmChkPoint()` (2842);
`moveChkPoint()` (2843-2849); `mApplyChkList()`/`applyChkList()`
(2850-2868). SO->Project seeding: `saveSO()` (2050-2098) auto-creates
Project, seeds p.chk from defaultChkList(so.div). Project
checklist/timeline: `mTimeline()`/`autoFillTimeline()`/`saveTimeline()`
(2603-2669); `tickChk()` (2617-2632); `mItemDate()`/`saveItemDate()`;
`mEditProjChk()`/`saveProjChk()`; `rmChkItem()`; `addPhoto()`;
`chkRemark()`; `pmSign()`; `mAddChkItem()`/`addChkItem()`. Timeline helpers
all verbatim at lines 2277-2320: `daysBetween()`, `projPlanned()`(2286),
`timelineReady()`(2287), `delayedItems()`, `projTargetEnd()`,
`itemStatus()`, `runDelayCheck()`(2307), `saveTimeline()`(2669),
`tickChk()`(2617). Approval: `SIGN_ROLES`(2372), `canApprove()`(2373),
`mApprove()`/`doApprove()`(2374-2394). Completion: `savePM()`(2591-2601),
`convertToService()`(2732-2743).

**CHK-3.3-01 (P1): Checklist Template Library CRUD missing.** PWA evidence:
index.html lines 2748-2868, a full division/company-scoped role-gated
(canEditChk) admin feature with dedicated nav views ('checklists',
'chklist'), seeded via seedChklists() (3 companies x 3 divisions = 9
templates). NEW APP evidence: businessRepositories.mongoose.js lines
499-514 checklistTemplateRepo had ONLY findDefaultForDivision()/findById();
projectRoutes.js had no checklist-templates routes anywhere;
projectService.js lines 44-51 explicitly said "Library
management...is not part of this task's scope...Left for a future
ChecklistTemplate-CRUD task"; no seed script existed. Impact: no
application-level way to create/curate templates at all. Recommended:
FIX-3.3-01, full CRUD service+routes+model extension+tests.

**CHK-3.3-02 (P3):** PWA's savePM groups finance/admin/service_mgr
notifications under one `if(old!==p.stage)` guard — a same-value resave
fires none. NEW APP's setStage() had TWO independent conditions:
`if(old!==stage)` for finance/admin, and a separate `if(completionRan)`
for service_mgr — so a same-value resave of "Completed" still fired the
service_mgr notification. Files: new-app/backend/src/services/projectService.js,
setStage() function. Fix: gate completionRan's service_mgr notify also on
`old !== stage`.

**CHK-3.3-03 (P2):** projectRoutes.js POST /:id/delay-check ->
runDelayCheckForProject is a MANUAL per-project on-demand endpoint only;
route comment states "no scheduler wired up in this task." PWA's
runDelayCheck() runs client-side on every relevant page load for the
logged-in user's own projects (near-continuous during active use). Must
preserve: once-per-calendar-day behavior (p.delayNotified===today throttle
field, NEW APP's equivalent is lastDelayNotifiedDate), project eligibility
(Ongoing status, timelineReady), overdue point detection, notification
content, named overdue point behavior. Fix: add a scheduled job that
iterates eligible projects and invokes the equivalent of
runDelayCheckForProject per project, matching PWA's effectively-continuous
cadence WITHOUT being more aggressive than "check roughly as often as the
PWA would during a normal workday" — a reasonable interpretation is a
periodic job (e.g. hourly, since nothing more specific is
PWA-demonstrable) that is idempotent/safe against overlapping runs via the
existing per-project lastDelayNotifiedDate throttle (§21 atomicity
requirement).

**B1:** Full 23 PWA notify() call-site inventory (from
PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md §13): Enquiry 0 sites.
SalesOrder 2 (division PM/admin on creation; finance on creation — both
already firing as Notification.create() calls per salesOrderCascade.js).
Project 9 (this pass's N1-N8: saveTimeline first-save to
[admin,sales,pmRole]; tickChk late to [pmRole,sales,admin]; tickChk
all-done to [pmRole,admin,service_mgr]; doApprove to [pmRole,admin];
runDelayCheck daily to [pmRole,sales,admin]; savePM stage-change to
[finance]; savePM stage-change to [admin]; savePM stage->Completed to
[service_mgr]; plus convertToService's commissioning-approved notification
to [service_mgr,admin] which is DEFERRED TO PASS 3.4/Contract scope, not
part of this fix). Contract 2, ServiceCall 4, Payment 3, Inventory 5
(these five modules' notify() sites are OUT OF THIS TASK'S DIRECT
VERIFICATION SCOPE except that the notification SERVICE/INFRASTRUCTURE
built must work generically for all of them, since they already call
`notificationRepo.create()` the same way SalesOrder/Project do). NEW APP
evidence: notificationRepo (businessRepositories.mongoose.js ~492-497)
exposed only create(); no route/service/repo method anywhere lists,
reads, or marks-read a Notification document. Impact: created
notifications were permanently unreadable — no user or role could ever
retrieve them via any API.

---

## §2. Phase B fix record

Fix order (as instructed, dependency-first): FIX-3.3-01 → FIX-B1 →
FIX-3.3-03 → FIX-3.3-02. All four are reported below in that order.

### FIX-3.3-01 — Checklist Template Library CRUD (P1)

**Original finding:** CHK-3.3-01 (§1 above). **Original NEW APP gap:**
`checklistTemplateRepo` exposed only `findDefaultForDivision`/`findById`;
no service, no routes, no seed data.

**Changed files:**
- `src/repositories/businessRepositories.mongoose.js` — extended
  `checklistTemplateRepo` with `listByDivision`, `listByCompany`, `create`,
  `updateFields`, `unsetDefaultsForDivision`, `countByDivision`,
  `deleteById`. `findDefaultForDivision`/`findById` unchanged (still used
  by `salesOrderCascade.resolveChecklist`/`projectService.applyChecklistTemplate`).
- `src/services/checklistTemplateService.js` (new) — full CRUD business
  logic.
- `src/routes/checklistTemplateRoutes.js` (new) — `GET/POST
  /api/checklist-templates`, `GET/PATCH/DELETE /:id`, `POST
  /:id/duplicate`, `POST /:id/set-default`, `POST/PATCH/DELETE
  /:id/items[/:i]`, `POST /:id/items/:i/move`.
- `src/seeds/checklistTemplateSeed.js` (new) — verbatim HVAC/Solar/MEP
  item content traced from PWA `HVAC_CHK`/`SOLAR_CHK`/`MEP_CHK`, plus
  `seedStandardChecklistTemplates(companyId, userId, deps)`.
- `src/app.js` — mounted `createChecklistTemplateRouter` at
  `/api/checklist-templates` (`businessDeps` unchanged, router already
  received `checklistTemplateRepo`).
- `tests/enquiryFakes.js` — extended the in-memory `checklistTemplateRepo`
  fake with the same new methods.
- `tests/checklistTemplateService.test.js` (new) — 15 tests.
- `tests/audit-corrections.test.js` — updated the scope-guard test's
  allow-list to include `checklistTemplateRoutes.js`/`checklistTemplateService.js`
  (and the Notification files, see FIX-B1) — this is the SAME guard the
  original Pass 3.3 finding's "left for a future task" comment referred to;
  updating it (not removing it) is the established convention for each
  newly-authorized module in this engagement.

**Field mapping table (ChecklistTemplate):**

| PWA field | PWA meaning | NEW APP field | C/R/U/D | Match |
|---|---|---|---|---|
| `id` (numeric, in-memory) | template identity | `_id` (ObjectId) | C/R | Durable-ref upgrade, same convention as every other module |
| `co` | owning company | `companyId` | C/R (never client-writable — tenant guard) | Exact |
| `div` | HVAC/Solar/MEP | `division` | C/R | Exact |
| `name` | template name | `name` | C/R/U (rename) | Exact |
| `items[].text` | point description | `items[].text` | C/R/U | Exact |
| `items[].sign` | ENGINEER/CLIENT/SALES/SERVICE | `items[].signResponsibility` | C/R/U | Exact enum |
| `def` | one-per-division default flag | `isDefault` | C/R/U (set-default) | Exact, same one-default-per-division invariant |
| `by` | creator display name | `createdByUserId` (durable ref) | C/R | PWA FACT (name) → NEW BACKEND DESIGN (durable ref), same convention already locked for other modules |
| `date` | creation date | `createdDate` | C/R | Exact |
| *(none)* | — | `updatedAt`/`createdAt` (Mongoose timestamps) | R | Additive, non-PWA, does not change behavior |

**Duplication (`dupChkList`) traced and matched:** name → `name +
" (copy)"`; items copied by value (`text`/`signResponsibility` only, no
other fields); new identity (new `_id`); `isDefault` always `false` on the
duplicate; company/division carried over from the source; `createdByUserId`/`createdDate`
reset to the acting user/now; **zero** notifications (Checklist Library has
no `notify()` call sites in the PWA — confirmed by direct inspection of
lines 2744-2868, and preserved by `duplicateTemplate` calling no
`notificationRepo.create`).

**Reorder (`moveChkPoint`) traced and matched:** a plain adjacent swap
between index `i` and `i+direction` — NOT alphabetical or any other
ordering rule; an out-of-range move (`j<0||j>=items.length`) is a silent
no-op, matched exactly by `moveTemplateItem`. Copy-not-reference semantics
verified: because `applyChecklistTemplate`/`resolveChecklist` both copy
`items` into a brand-new plain-object checklist array at the moment of
copy, a later reorder (or any other edit) of the source template has zero
effect on an already-created project's checklist — verified directly by
`tests/checklistTemplateService.test.js`'s "compatibility" test.

**Set default (`setDefChkList`) traced and matched:** one-default-per-division,
enforced by always unsetting every sibling in the SAME division before
setting the new one (`unsetDefaultsForDivision` then `updateFields`, both
inside one transaction) — multiple defaults in the same division are
structurally unreachable through this code path, matching the PWA. A
different division's default is untouched. `defaultChkList()`'s existing
3-tier fallback chain in `salesOrderCascade.resolveChecklist` (isDefault →
first template → legacy hardcoded fallback) required NO changes — it
already called `findDefaultForDivision`/which now correctly finds
templates created/edited through this new CRUD layer.

**Delete (`delChkList`) traced and matched:** minimum 1 template per
division enforced (`countByDivision < 2` → refuse, same boundary as the
PWA's `chkLists(c.div).length<2`); deleting the division's current default
does NOT auto-promote another template to default (verified: the PWA's
`delChkList` never touches any other template's `def` flag — preserved
exactly, and covered by a dedicated test); deleting a template has zero
effect on any Project/SalesOrder that already copied its items by value
(the PWA's own `delChkList` comment says "Existing projects keep their own
copy" — there is no back-reference from template to project in either
system, so this is structurally guaranteed, not just observed).

**Role enforcement (`canEditChk`) traced and matched — PWA QUIRK preserved
exactly:** `admin || role in PM_DIV` — ANY division-PM role (hvac_pm,
solar_pm, mep_pm) may create/edit/rename/duplicate/delete/set-default a
template in ANY division, not just their own (there is no per-division
match check in the PWA's edit gate). This is implemented as
`canEditChecklistLibrary`/`assertCanEditChecklistLibrary` and covered by a
test that explicitly exercises a `solar_pm` editing an HVAC-division
template successfully. Viewing (list/detail) is unrestricted beyond
tenant scope for list-with-explicit-division-filter and for single-template
detail (matching the existing "detail view has no extra restriction"
convention already locked for `Project.getProject`); a division-PM's
*default* list view is scoped to their own division (`myDiv()`), while
every other role (admin included, and any non-PM role via the PWA's own
`myDiv()===null` quirk) sees all divisions by default.

**Tenant isolation:** every operation resolves `companyId` from
`actorAuth.companyId` (the authenticated session) only; the router chain
applies `requireCompanyContext`/`rejectClientSuppliedCompanyId` exactly as
every other module's router does; verified by a tenant-isolation test on
`getTemplate`.

**Seeded templates:** the "9 seeded templates" (3 companies × 3 divisions)
were traced from `seedChklists()` and the `HVAC_CHK`/`SOLAR_CHK`/`MEP_CHK`
constants (index.html lines 180-221) — item text and `sign` values
reproduced VERBATIM (not invented) in
`src/seeds/checklistTemplateSeed.js`'s `STANDARD_ITEMS_BY_DIVISION`, each
division's item count/text/sign spot-checked against a fresh read of the
PWA source during this task. No CLI seed-script or scripts/ directory
convention exists elsewhere in this codebase, so this module doubles as
(a) the data source for tests (`checklistTemplateService.test.js` asserts
the exact item counts/text/first item per division) and (b) a plain
function (`seedStandardChecklistTemplates(companyId, userId, deps)`) a
future provisioning flow can call once per company — consistent with
there being no existing CLI-seed pattern to follow instead.

**Targeted tests:** `tests/checklistTemplateService.test.js` (15 tests) —
role gate/quirk, list scoping, create/copy-from/default-unset, duplicate,
rename, set-default (cross-division isolation), delete (min-1 guard,
no-auto-promote), add/edit/remove item, move item (middle/first/last/no-op),
SO/Project compatibility + copy-not-reference, and the 9-seed-template
content check.

**Full regression:** 313/313 (see §3).

**Final re-verified result:** Checklist Template Library CRUD is fully
implemented (create/list/detail/rename/duplicate/set-default/delete/add-
edit-remove-move item), role/tenant-enforced, seed content traced verbatim
from the PWA, and verified compatible with the existing SO→Project
checklist-copy pipeline without any change to that pipeline's own code.
**CHK-3.3-01 is RESOLVED.**

---

### FIX-B1 — Notification persistence / delivery (cross-workflow)

**Original finding:** B1 (§1 above). **Original NEW APP gap:**
`notificationRepo` exposed only `create()`; no list/read/mark-read path
anywhere.

**Changed files:**
- `src/repositories/businessRepositories.mongoose.js` — extended
  `notificationRepo` with `listForRole(companyId, role, options)` and
  `markRead(companyId, id, userId)`. `create()` unchanged — no existing
  call site in any service was touched.
- `src/services/notificationService.js` (new) — `listNotifications`,
  `markNotificationRead`.
- `src/routes/notificationRoutes.js` (new) — `GET /api/notifications`,
  `PATCH /api/notifications/:id/read` (this exact path/verb already
  anticipated by the PWA's own `API_MODE` branch of `notify()`/`vNotifs()`,
  which calls `PATCH /api/notifications/:id/read`).
- `src/app.js` — mounted `createNotificationRouter` at `/api/notifications`.
- `tests/enquiryFakes.js` — extended the in-memory `notificationRepo` fake
  with `listForRole`/`markRead`.
- `tests/notificationService.test.js` (new) — 6 tests.

**PWA fields traced (`notify`/`myNotifs`/`unread`/`vNotifs`,
index.html ~1267-1866):** `roles` (array, or the literal `"*"` meaning
every role) → NEW APP `targetRoles` (already present, unchanged); `text`
→ `text` (unchanged); `date` → `date` (unchanged); `co` → `companyId`
(unchanged); `read` (append-only array of user ids) → `readByUserIds`
(already present in the `Notification` model before this task — no schema
change was needed). Recipient rule (`myNotifs`): a notification is visible
to a user when their OWN role is in `targetRoles`, or `targetRoles`
contains `"*"` — implemented exactly by `listForRole`'s `$in: [role, '*']`
query. Read tracking (`vNotifs`): the PWA marks every visible notification
read the moment the Notifications view opens, one `PATCH .../:id/read`
call per not-yet-read item — there is no separate "mark unread" action
anywhere in the PWA, matched by `markNotificationRead` being strictly
additive (`$addToSet`), idempotent, with no unread counterpart.

**Recipient fidelity verified:** role/company-scoped only, no universal
broadcast beyond the PWA's own `"*"` marker, no new dedup, no new
notification triggers (this fix touches zero existing `notificationRepo.create()`
call sites). Explicitly verified and preserved: Inventory's `transferStock`
and `markUsed` still create NO notification (test:
`tests/notificationService.test.js` "Inventory: transferStock and markUsed
have NO notification call").

**Generic applicability re-checked directly against source (not assumed):**
`notificationRepo.create(` was grepped in every module's service file —
present in `salesOrderCascade.js` (2 sites), `projectService.js` (9
sites), `contractService.js` (1 site — the original Phase A estimate of
"Contract 2" was not re-derived from source in this task and is flagged
here as a discrepancy worth reconciling in a future pass, not corrected
here since deep Contract-workflow tracing is out of this task's scope),
`serviceCallService.js` (5 sites — Phase A's estimate was "4", same
caveat), `paymentService.js` (3 sites, matches Phase A), `inventoryService.js`
(5 sites, matches Phase A). All of them already call `notificationRepo.create()`
the same way, so the new read-side (`listForRole`/`markRead`) works
generically for all of them with no per-module change — verified by a
test that asserts every one of those six service files contains a
`notificationRepo.create(` call.

**Targeted tests:** `tests/notificationService.test.js` (6 tests) —
recipient correctness (own role, `"*"` marker, multi-role notification),
tenant scoping (a different company's notification never appears), newest-
first ordering, mark-read (append, idempotent, per-user, tenant-isolated),
cross-module `notificationRepo.create()` presence check, and the Inventory
Transfer/Mark-Used absence check.

**Full regression:** 313/313 (see §3).

**Final re-verified result:** every notification created anywhere in the
system (SalesOrder, Project, and — generically, by construction —
Contract/ServiceCall/Payment/Inventory) is now retrievable via `GET
/api/notifications` (role/company-scoped) and markable read via `PATCH
/api/notifications/:id/read`, matching PWA `myNotifs()`/`vNotifs()`
exactly, with zero new notification triggers and zero changes to any
existing `create()` call site. **B1 is RESOLVED.**

---

### FIX-3.3-03 — Automatic delay-check scheduling (P2)

**Original finding:** CHK-3.3-03 (§1 above). **Original NEW APP gap:**
`POST /:id/delay-check` was manual/on-demand only; no scheduler existed
anywhere in the codebase (confirmed: `package.json` had no
cron/schedule dependency, and no `cron`/`schedule`/`setInterval` usage
existed anywhere under `src/` before this task).

**Changed files:**
- `src/jobs/delayCheckScheduler.js` (new) — `createDelayCheckScheduler(deps,
  options)` / `startDelayCheckScheduler(deps, options)`.
- `src/repositories/businessRepositories.mongoose.js` — added
  `projectRepo.listEligibleForDelayCheck()` (cross-company candidate query:
  `status:'Ongoing', timelineSet:true`).
- `tests/enquiryFakes.js` — added the matching fake
  `projectRepo.listEligibleForDelayCheck()`.
- `src/app.js` — exposed `app.startDelayCheckScheduler(options)` (a thin
  wrapper closing over the already-assembled `businessDeps`).
- `src/server.js` — calls `app.startDelayCheckScheduler()` once at process
  bootstrap (never during tests — `server.js`'s `start()` is not exercised
  by the test suite, matching the existing "no live database used in
  tests" convention).
- `tests/delayCheckScheduler.test.js` (new) — 4 tests.

**PWA semantics traced (`runDelayCheck`, index.html §7/§21 row 11) and
matched:** once-per-calendar-day throttle (`lastDelayNotifiedDate`, already
implemented in `runDelayCheckForProject` before this task — unchanged);
eligibility = `status==="Ongoing"` AND `timelineReady` (unchanged, and now
also the scheduler's own candidate filter); overdue-point detection =
`!done && targetDate` in the past (unchanged); notification content
unchanged; the "named overdue point" quirk (`late[0]`, the FIRST late item
in array order, not necessarily the worst-delay one) preserved and
explicitly covered by a new test.

**Interpretive choice (documented, per instruction):** the PWA's own
trigger has no fixed period (it runs on every relevant page render). This
job runs on a plain hourly `setInterval` by default — deliberately not an
aggressive interval, intended to approximate "checked roughly as often as
the PWA would during a normal workday" without inventing a tighter
schedule the PWA never demonstrates. No scheduler library
(`node-cron`/`node-schedule`/etc.) existed as a dependency already, and
none was added — a minimal internal `setInterval`-based runner was used
instead, per the task instruction's stated preference when nothing already
exists in the codebase to be consistent with.

**Atomicity (§21) verified:** `runDelayCheckForProject`'s own
read-then-transactionally-write throttle (unchanged by this fix) already
prevents a double notification within one project across repeated calls
the same day. This fix adds an in-process "one tick at a time" guard
(`running` flag in `delayCheckScheduler.js`) so two overlapping ticks of
the SAME process can never race each other over the same candidate list —
covered directly by a test that fires two ticks concurrently
(`Promise.all([scheduler.tick(), scheduler.tick()])`) and asserts exactly
one notification results, plus a third same-day tick asserting zero
further notifications.

**Targeted tests:** `tests/delayCheckScheduler.test.js` (4 tests) —
cross-company eligible-candidate reach with ineligible projects correctly
excluded (wrong status, timeline not ready, no overdue points), simulated
overlapping-tick throttle safety (both the in-process guard and the
per-project day-throttle), overdue detection/notification content
(worst-delay count and first-late-item naming quirk), and a start/stop
bootstrap smoke test.

**Full regression:** 313/313 (see §3).

**Final re-verified result:** projects are now checked automatically
(hourly, documented interpretive choice) without any user having to open
the PWA, `runDelayCheckForProject`'s existing PWA-matching behavior is
reused unmodified, and the once-per-day notification cap is proven safe
against same-process overlapping runs. **CHK-3.3-03 is RESOLVED**
(a second, independently-running server process remains a residual risk
the per-project transactional throttle mitigates but a single-process
`running` guard cannot fully eliminate — noted honestly, not claimed as
airtight for a multi-instance deployment, which this codebase has no
provision for elsewhere either).

---

### FIX-3.3-02 — Same-value stage resave notification fix (P3)

**Original finding:** CHK-3.3-02 (§1 above). **Original NEW APP gap:**
`setStage()`'s `service_mgr` notification fired on `if (completionRan)`
alone, independent of `old !== stage`, unlike the finance/admin
notifications a few lines above it which were already correctly gated on
`old !== stage`.

**Changed files:**
- `src/services/projectService.js` — `setStage()`: changed `if
  (completionRan)` to `if (completionRan && old !== stage)` around the
  `service_mgr` "Approve commissioning..." notification.
- `tests/projectService.test.js` — added one targeted regression test.

**Implementation:** the fix is a single added condition
(`old !== stage`), matching the SAME condition already used by the two
notifications directly above it in the same function — no other line was
touched, so no legitimate stage-change notification path changes:
finance/admin still fire on every genuine stage change, and service_mgr
still fires on a genuine transition into `Completed`.

**Targeted test:** `tests/projectService.test.js` — "setStage — FIX-3.3-02:
a genuine transition to Completed fires all three notifications (finance,
admin, service_mgr); a same-value resave of an already-Completed stage
fires none." Asserts exactly 3 notifications after the genuine
Finishing→Completed transition, and exactly 0 additional notifications
after resaving `stage:'Completed'` again on an already-Completed project.

**Full regression:** 313/313 (see §3).

**Final re-verified result:** a same-value resave of an already-Completed
project stage now fires zero notifications (finance, admin, and
service_mgr all correctly gated on `old !== stage`), while a genuine
transition into Completed still fires all three, exactly matching PWA
`savePM`'s single shared `if(old!==p.stage)` guard. **CHK-3.3-02 is
RESOLVED.**

---

## §3. Full regression

Command: `cd new-app/backend && node --test --test-concurrency=4
tests/*.test.js tests/auth/*.test.js` (the repository's own `npm test`
script, run with an explicit concurrency flag because the default
concurrency on this machine's connected-device bridge made a from-scratch
run take long enough to appear to hang — behavior, not correctness, and
unrelated to any change in this task; individual test files run
standalone in seconds).

Result: **313 / 313 passing** (baseline was 287; +26 new: 15
`checklistTemplateService.test.js`, 6 `notificationService.test.js`, 4
`delayCheckScheduler.test.js`, 1 added to `projectService.test.js` for
FIX-3.3-02). Zero existing tests were modified to force a pass, except the
one intentional, legitimate scope-guard allow-list update in
`tests/audit-corrections.test.js` (adding the two newly-authorized
modules to its exact-file-list assertion — the guard itself, and its
purpose of catching any UNAUTHORIZED module, is unchanged).

## §4. Safety

V2 drift: 37 files (unchanged by this task — same baseline before and
after). V3 drift: 0 files (unchanged). PWA md5 (`index.html` and
`MEP_PROJECTS_PWA/index.html`): `111b53dba91704f96b83dae96c7793c6`
(unchanged, both copies, before and after). Nothing staged or committed at
any point (`git add`/`git commit` were never run).

## §5. Overall Pass 3.3 status

**PASS 3.3 (post-fix).**

All four findings from the Phase A report (CHK-3.3-01, B1, CHK-3.3-03,
CHK-3.3-02) were implemented, tested, and re-verified against their
original PWA/NEW-APP evidence per §2 above. Full regression is 313/313.
V2/V3/PWA safety baselines are unchanged.
