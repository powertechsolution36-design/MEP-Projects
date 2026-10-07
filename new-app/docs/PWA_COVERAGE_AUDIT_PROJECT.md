# PWA Coverage Audit — Project Execution

**Status: READ-ONLY AUDIT. No Project implementation was written or modified as part of this document.**

---

## 1. Scope / Source

This audit covers the full **Project Execution** module: the Project entity, its creation cascade, stage/status model, timeline, checklist execution and approval, completion gate, delivery challans, execution updates, engineer assignment, division behavior, SalesOrder/Payment relationship, Finance impact, Contract/Service conversion, commissioning, reports/dashboard/search, notifications, roles/authorization, and quirks.

**Authoritative source:** `MEP_PROJECTS_PWA/index.html` (4113 lines), specifically the `/* ================= PROJECTS ================= */` section (lines 2119–2742) plus every cross-reference from SalesOrder, Inventory, Finance, Service, Dashboard, and Checklist Library sections that touches `DB.projects`.

**Ignored as V2-connection-patch infrastructure (per instruction):** `API_BASE`, `TOKEN`, `SOCKET`, `API_MODE`, `fetch()`, `api()`, and the reader/writer functions in the "READERS: V2 document -> legacy PWA object" / "SAVE" / "SOCKET.IO" blocks (lines 608–1184). Where a field name only exists in that translation layer (e.g. `contractReference`), it is explicitly called out as **NOT a PWA functional fact**.

**Read for comparison only (not source of truth):** `new-app/docs/DOMAIN_MODEL.md`, `DATABASE_SCHEMA.md`, `OPEN_DECISIONS.md`, `PWA_COVERAGE_AUDIT_SALESORDER.md`, `new-app/backend/src/models/{Project,SalesOrder,ChecklistTemplate,Payment,Notification}.js`, `src/services/{salesOrderService,enquiryService}.js`.

## 2. PWA Assumptions

- A single global in-memory `DB` object (`DB.projects`, `DB.sos`, `DB.payments`, `DB.contracts`, `DB.invIssues`, `DB.chklists`, `DB.notifs`) persisted via `save()` to `localStorage`. There is no server-side authority in the local/functional code path; `mine(arr)` is the only "tenant" filter (`arr.filter(x => x.co===U.co)`).
- Every screen re-renders from `DB` on `nav()`; there is no optimistic-vs-committed state distinction.
- `U` is the logged-in user object (`U.co`, `U.role`, `U.name`); role-based UI gating is universally a **rendering** decision (`isPM`, `isEng`, `canPM()`, `canEditChk()`, ternary button visibility) — the underlying mutator functions (`savePM`, `tickChk`, `doApprove`, `saveDC`, `doReturn`, `addUpdate`, `saveTimeline`, `convertToService`, etc.) contain **no role check of their own**, confirmed by direct reading of every one of them (see §22 Roles/Authorization for the full per-function table).

## 3. Exact Project Entity Inventory

The Project object is assembled in exactly one place at creation time — `saveSO()` (line 2088) — and mutated in place thereafter by the functions listed in §4 onward. There is no separate "Project constructor" function; the shape below is the literal object literal passed to `DB.projects.push(...)`, plus every field added to it later by other functions.

| PWA field | Type / shape | Required? | Default at creation | Set by | Read by | User-entered vs system | Derived vs stored | Notes |
|---|---|---|---|---|---|---|---|---|
| `id` | Integer (per-company-sequence-like, but actually global `DB.seq.proj`) | yes | `++DB.seq.proj` | `saveSO` | everywhere (`nav('project',id)`) | system | stored | Global counter, not per-company (see §21 quirks — same class as SO numbering, but Project itself is never user-facing "numbered", so no report cites `p.id`). |
| `co` | Integer (company id) | yes | `U.co` | `saveSO` | `mine()` | system | stored | Tenant key. |
| `soNo` | Integer — the owning SalesOrder's `no` (display number, not a Mongo-style id) | yes (always present — see §4) | `so.no` | `saveSO` | `vSO`, `vProject`, `paySum`, `mRaise`, `dlProjects`, `projPayInfo` | system | stored (denormalized copy of SO's own number) | This is the **only** SalesOrder linkage; there is no `enquiryId` on Project at all. |
| `div` | String enum `HVAC\|Solar\|MEP` | yes | `so.div` | `saveSO` | `STAGES[p.div]`, `canPM`, `hasDiv`, notifications, checklist library | system (copied) | stored | Never independently editable at creation; can be **changed later** via the edit form (`p_stage` select is division-scoped by `p.div` at render time, but there is no `p_div` edit field in `vProject()` — **division itself is NOT editable in the Project detail form**, only `stage`, engineers, and vendor are). This corrects/refines the prior audit's "UNSPECIFIED BY PWA whether division is editable after creation" note for the *SalesOrder* form — for the **Project** record itself, division is never exposed as an editable field at all. |
| `name` | String | yes | `so.project` | `saveSO` | everywhere | system (copied from SO's `project` field) | stored | |
| `siteType` | String | no | `""` (always blank at creation — **verified literal**) | `saveSO` | detail view only (`vProject`) | never system-populated beyond `""`; no UI input to set it anywhere in the Project screens | stored | **PWA FACT, re-confirmed independently**: there is no `<input id="...siteType...">` anywhere in the Project/SO code; the field is permanently blank unless directly edited in `DB` (impossible via UI). Dead/write-once-never field in the PWA's own UI. |
| `cap` | String | no | `""` | `saveSO` | detail view | same as `siteType` — no UI to set it | stored | Same dead-field status as `siteType`. |
| `customer` | String | no | `(so.contacts[0]||{}).n||""` | `saveSO` | `vProject`, `printDC`, `projectReportRows` | system (copied from SO's first contact name) | stored | **Not** the Enquiry's name/phone — confirmed: `saveSO` never references `enqId`'s enquiry object when building the Project, only `so.contacts[0].n`. |
| `stage` | String, one of `STAGES[div]` | yes | `STAGES[so.div][0]` (first stage for the division) | `saveSO`; edited by `savePM` | `canPM`-gated select in `vProject`, badges everywhere, completion gate | user-entered (PM/admin) after creation | stored | See §5. |
| `start` | Date string | yes (copied) | `so.start` | `saveSO` | `vProject`, timeline auto-fill default | system (copied) | stored | Can be overwritten later by `saveTimeline` (`p.start=gv("tl_s")||p.start`). |
| `end` | Date string | no | `so.end` | `saveSO`; later set by `savePM` (`p.end=p.end||today()` on completion) and by `saveTimeline`/`saveItemDate` (`p.end=projTargetEnd(p)`) | `vProject`, reports | mixed — copied at creation, then **derived** (`projTargetEnd`) once a timeline exists, then **stamped** on completion | derived once timeline set; stored value | `end` is silently **overwritten** by `projTargetEnd(p)` (the latest checklist `plan` date) every time the timeline is saved or an item date is edited — the originally-copied SO `end` date is lost the moment a timeline exists. |
| `engs` | `[String]` — engineer **names**, not ids | no | `[]` | `saveSO`; edited by `savePM` (full-replace, not additive — see §12) | `vProject`, `projPanel`, `vProjects`, notifications | user-entered (PM/admin, multi-select) | stored | |
| `vendor` | String | no | `""` | `saveSO`; edited by `savePM` | `vProject` | user-entered | stored | Free text, no vendor entity. |
| `status` | String enum `Ongoing\|Completed\|In Service` | yes | `"Ongoing"` | `saveSO`; transitioned by `savePM` (→`Completed`) and `convertToService` (→`In Service`) | everywhere (badges, filters, completion banner) | system-derived from the stage/commissioning gates | stored | See §6. |
| `chkName` | String — display name of the checklist template applied | no | `cl?cl.name:""` (`cl` = `defaultChkList(div)`) | `saveSO`; overwritten by `applyChkList` | `vProject` badge | system (copied) then user-chosen | stored | **Display only** — never used to re-look-up a live ChecklistTemplate; editing the template later never touches projects that already copied it. |
| `chk` | `[ChecklistExecutionItem]` — see nested table | yes (may be empty array) | seeded from the resolved checklist (see §10) | `saveSO`; mutated by `applyChkList`, `addChkItem`, `rmChkItem`, `saveProjChk`, `tickChk`, `chkRemark`, `pmSign`, `doApprove`, `addPhoto`, `saveItemDate`/`saveTimeline` | `vProject`, `projectReportRows`, `dlProjects` | mixed | stored (embedded array) | See §8. |
| `updates` | `[ExecutionUpdate]` — see nested table | yes (may be empty array) | `[]` | `saveSO`; appended by `addUpdate` | `vProject`, `projPanel` (`lu = updates[updates.length-1]`), reports | user-entered | stored, **append-only** (no edit/delete function exists for an update entry) | See §11. |
| `dc` | `[DeliveryChallanItem]` — see nested table | yes (may be empty array) | `[]` | `saveSO`; appended by `saveDC`, edited by `saveDCItem`, removed by `rmDC`, mutated (`rqty`) by `doReturn` | `challanPanel`, `printDC`, `dlChallan`, `projectReportRows`, completion gate | user-entered | stored, embedded, mutable/deletable (unlike `updates`) | See §9/§10. |
| `timelineSet` | Boolean | no (absent until first `saveTimeline`) | not set at creation (`undefined`, falsy) | `saveTimeline` (`p.timelineSet=true`, **never reset false**) | `timelineReady(p)` | system flag | stored | Once true, permanently true — no function ever sets it back to false, even if all `plan` dates are later cleared. |
| `delayNotified` | Date string (today's date) | no | not set at creation | `runDelayCheck` | `runDelayCheck` itself (once-per-day throttle guard) | system | stored | Internal throttle marker, never rendered in any UI. |

### Nested: `ChecklistExecutionItem` (element of `p.chk[]`)

| Field | Type | Default | Set by | Notes |
|---|---|---|---|---|
| `text` | String | copied from template/legacy list | seed / `addChkItem` / `saveProjChk` | |
| `sign` | String enum `ENGINEER\|CLIENT\|SALES\|SERVICE` | copied | seed / `addChkItem` / `saveProjChk` | The `SIGN_ROLES` map (line ~2371) has a **5th key, `PM`**, mapped to `["hvac_pm","solar_pm","mep_pm","admin"]` — but no checklist point UI ever offers `PM` as a selectable `sign` value (`mAddChkItem`'s `<select>` and `mChkPoint`'s `<select>` both list only `ENGINEER/CLIENT/SALES/SERVICE`, and the checklist-template point editor is the same 4 options). **Re-verified independently**: `PM` is dead/unreachable as an item `sign` value. |
| `done` | Boolean | `false` | `tickChk` | |
| `date` | Date string, `""` when not done | `""` | `tickChk` (`c.date=val?today():""`) | Cleared back to `""` when un-ticked. |
| `pmSign` | Boolean | `false` | `pmSign()` (sets true; **no un-sign function exists**) | Independent from `appr` — see §7. |
| `remark` | String | `""` | `chkRemark` | |
| `photos` | `[String]` (base64 JPEG data URIs, downscaled to max width 480px, quality 0.6) | `[]` | `addPhoto` (push-only; **no remove-photo function exists**) | |
| `plan` | Date string, absent until timeline set | not present at seed | `saveTimeline`, `saveItemDate` (`autoFillTimeline` fills the input, not the model, until saved) | Optional even after `timelineSet=true` — see §5/§7 timeline looseness. |
| `appr` | Object or `null` | `null` (explicit) at seed and on un-tick | `doApprove()`; cleared by `tickChk` when un-ticking (`if(!val){c.pmSign=false;c.appr=null}`) | See §8. |

### Nested: `appr` object (approval)

| Field | Type | Notes |
|---|---|---|
| `by` | String | Free-typed name for CLIENT sign points (`gv("ap_n")`); otherwise `U.name` of the approving staff user. |
| `role` | String | Set to `c.sign` (the point's required sign responsibility), **not** `U.role` — i.e. `appr.role` records *which responsibility was satisfied*, not the approver's actual PWA role. |
| `date` | Date string | `today()`. |
| `remark` | String | `gv("ap_r")`, defaults to any existing `appr.remark`. |
| `sig` | String (base64 PNG data URI) or `""` | Only populated for CLIENT points (`_sg.cv.toDataURL(...)`); `""` for all other sign types. |
| `enteredBy` | String | Always `U.name` — the logged-in staff member who recorded this approval, **always distinct from `by` for CLIENT points**, identical to `by` for every other sign type. |

### Nested: `ExecutionUpdate` (element of `p.updates[]`)

| Field | Type | Notes |
|---|---|---|
| `d` | Date string | `today()` |
| `done` | String (free text — "Action Done") | Required (`if(!gv("up_done")){toast(...);return}`) |
| `next` | String (free text — "Next Action") | Optional |
| `nd` | Date string ("Next Action Date") | Optional |
| `by` | String | `U.name` |

There is **no** `photos`/attachment field on an update — confirmed by reading `addUpdate()` in full; the audit instruction's suspicion ("do not assume updates are ordinary notes") is correct in spirit (they drive the dashboard's "Next Action"/"Next Action Date" columns and the delay-adjacent `over` flag), but structurally they are exactly 5 plain fields with no attachments.

### Nested: `DeliveryChallanItem` (element of `p.dc[]`)

| Field | Type | Notes |
|---|---|---|
| `no` | String (auto-numbered per project via `nextDCNo`, 1-based, gaps not reused) | Same `no` value repeats across every item added to the same challan (`mDC(pid,_x,existingNo)` "add item to this DC" path). |
| `date` | Date string | Per-item, but all items in one "Save Challan" call share the same `dc_dt` input. |
| `item` | String (material name) | Required per row (rows with blank `item` are silently skipped in `saveDC`'s loop — `if(!it)continue`). |
| `qty` | Number | `Number(gv(...))||0` |
| `unit` | String, one of `Nos/Mtr/Kg/Set/Box/Roll/Ltr` | |
| `ret` | Boolean ("Returnable" vs "Consumable") | |
| `rqty` | Number — cumulative returned quantity | `0` at creation; incremented (never decremented) by `doReturn` (`d.rqty=(Number(d.rqty)||0)+q`, clamped to `d.qty`). |
| `by` | String — "Received By (site)" | Free text, shared per-challan-group in the UI, stored per-item. |
| `remark` | String | Per-item; `doReturn` **appends** a `" | Returned X on <date>..."` audit trail string onto this same field rather than using a separate log field. |

## 4. Project Creation

**Verified: there is exactly one function in the entire PWA that pushes into `DB.projects`** — `saveSO()`, line 2088 (`grep -n "DB.projects.push"` returns exactly one hit). There is **no standalone Project creation path** — no "+ New Project" button, no `mProject()`/`newProject()` function exists anywhere. A Project is created **only** as a side effect of `saveSO`, i.e. only as a side effect of SalesOrder creation, and **only** on create (not on SO edit — `saveSO`'s `if(id){...;return}` early-returns for edits before reaching the project-creation code).

Since `saveSO` itself supports both a standalone "+ New SO" call (`enqId` undefined) and an Enquiry-conversion call (`enqId` passed), **both SalesOrder creation paths produce a Project via the identical code path** — there is no divergent Project-creation logic between the two.

**Prerequisites:** none beyond a valid SO save (`so_pn` project-name field required). No Enquiry-status check gates Project creation (that gate, where it exists, is on the *Enquiry→SO* transition, already covered by the SalesOrder audit — Project creation itself has no additional precondition).

**Exact fields copied from SO at creation** (see §3 table): `soNo(=so.no)`, `div(=so.div)`, `name(=so.project)`, `start(=so.start)`, `end(=so.end)`, `customer(=so.contacts[0].n||"")`.

**Fields defaulted, not copied:** `siteType=""`, `cap=""`, `vendor=""`, `engs=[]`, `updates=[]`, `dc=[]`, `status="Ongoing"`.

**Fields derived from division, not copied verbatim:** `stage=STAGES[so.div][0]` (first stage for the division).

**Checklist initialization:** see §10 — full fallback chain, `chkName` and `chk[]` both set from the resolved template (or the legacy hardcoded fallback).

**Notifications fired at Project-creation time:** identical to the SalesOrder-creation notifications (already documented exactly in `PWA_COVERAGE_AUDIT_SALESORDER.md` §11) — there is **no separate, Project-specific notification** distinct from the two SO-creation notifications; both notifications are fired inside `saveSO`, immediately after the project/payments are pushed, in the same function call. Reproduced here verbatim for completeness:
1. `notify([<divisionPMrole>,"admin"], "New SO-"+so.no+" received from Sales: "+so.project+" ("+so.div+"). Project created — assign engineer.")`
2. `notify(["finance"], "New SO-"+so.no+" ("+so.project+"): payment terms added to pending payment list.")`

## 5. Project Stage Model

`STAGES` (line 229, re-verified byte-for-byte):
```js
const STAGES={
 HVAC:["Planning","Piping","Installation","Testing","Finishing","Completed"],
 Solar:["Planning","Fabrication","Installation","Wiring","Net Metering","Completed"],
 MEP:["Concept","Design In Progress","Internal Review","Client Review","Delivered"]
};
```
Matches the instruction's expected list exactly, and matches `new-app`'s `PROJECT_STAGES_BY_DIVISION` in `shared/enums.js` exactly (re-verified against the current file — **no schema gap**).

**Where `stage` is used:**
- **Displayed:** `vProject` header badge, `vProjects`/`projPanel` table cell (`bdg(p.stage, ...)`), `projectReportRows`/`printProjectReport`.
- **Edited:** only in `vProject`'s PM-gated `<select id="p_stage">`, populated from `STAGES[p.div]` — i.e. the dropdown itself is already scoped to the project's own division, so no cross-division stage value can be selected through the UI. Saved by `savePM()`.
- **Validated:** *not independently validated* by any function beyond "must be one of the `<option>` values rendered" — `savePM` reads `gv("p_stage")` and assigns it directly with **no server-side (or even client-side function-level) check** that the value is a legal member of `STAGES[p.div]`. (This matters once real forms/APIs exist — currently only the rendered `<select>` constrains it.)
- **Used in guards:** the completion gate (§8) is triggered **only** by `p.stage==="Completed"` (`savePM`, `if(p.stage==="Completed"&&p.status!=="In Service"){...}`) — this is a **literal string comparison**, not "last stage in `STAGES[div]`". Confirmed: MEP's `STAGES.MEP` terminal entry is the literal string `"Delivered"`, which never equals `"Completed"`, so **this branch is structurally unreachable for MEP** — not a documented policy, a mechanical fact of the string comparison. There is no alternate "MEP considered complete at its own terminal stage" logic anywhere; MEP projects can reach `stage==="Delivered"` and simply never trigger `status="Completed"`, `convertToService`, or any of the completion-adjacent notifications through this path. (§8, §16 elaborate the consequences.)
- **Used in notifications:** `savePM`'s stage-change block fires whenever `old!==p.stage` (any stage change, not just reaching "Completed") — see §19 for exact wording.
- **Used in reports/dashboard:** `projPanel`, `vProjects`, `dlProjects`, `delayPanel` (indirectly, via `p.status==="Ongoing"` and `delayedItems`, not `stage` directly), dashboard KPI counts (`p.status==="Ongoing"`/`"Completed"`, again **`status`-keyed, not `stage`-keyed** — see §6 for the important status/stage independence).

## 6. Project Status Model

**Values:** `"Ongoing"` (initial, default), `"Completed"`, `"In Service"`. There is **no** 4th value; `contractStatus()` (`Active`/`Expiring Soon`/`Expired`) is a **Contract**-level derived label, not a Project status.

**Transitions:**
- `Ongoing → Completed`: triggered only inside `savePM()`, only when the saved `stage` value is the literal string `"Completed"` AND current `status!=="In Service"`. Guarded by two independent `confirm()` overrides (pending returnable material; incomplete/unapproved checklist points — see §8). On success: `p.status="Completed"`, `p.end=p.end||today()` (only back-fills `end` if it was falsy — in practice `end` is already populated by `projTargetEnd` once a timeline exists, so this fallback mostly protects the case where a project reaches Completed with no timeline ever set at all).
- Any other saved stage while `status!=="In Service"`: `p.status="Ongoing"` (`else if(p.status!=="In Service")p.status="Ongoing"`) — this means **a project can move backward out of Completed** simply by a PM/admin changing `stage` away from `"Completed"` again in the same edit form; there is no guard preventing "un-completing" a project this way, and no reversal-specific notification (only the generic stage-change notifications fire).
- `Completed/(non-MEP) → In Service`: triggered only by `convertToService(id)`, itself only reachable from the `vProject()` "conversion banner", which is rendered **only when `p.status==="Completed" && p.div!=="MEP"`** — reconfirmed independently: because MEP can never reach `status==="Completed"` via the literal-stage-string mechanism above, the `p.div!=="MEP"` guard in the banner is functionally redundant defensive code, not an independent additional restriction — MEP projects are excluded from this entire path by construction, twice over (once mechanically via the stage-literal check, once by this explicit UI condition).
- `In Service` is terminal in the local code — no function ever reads or writes it back to `Ongoing`/`Completed`.

**Prerequisites/side effects per transition:** see §8 (Completed) and §17/§18 (In Service / commissioning / contract).

**Status vs stage independence — explicitly verified, not inferred:** `status` and `stage` are two independent stored fields that can disagree. Examples actually reachable through the UI: (a) a project with `stage==="Testing"` (HVAC) and `status==="Ongoing"` — completely normal, expected; (b) a project where `stage` was once `"Completed"` (so `status` became `"Completed"`) and is then edited back to e.g. `"Finishing"` — `status` reverts to `"Ongoing"` per the `else if` branch above, so the two stay in lockstep in that direction; but (c) once `status==="In Service"`, the `else if(p.status!=="In Service")` guard means **`stage` can still be freely changed via `savePM` without ever touching `status` again** — so an "In Service" project can display any stage value at all, fully decoupled from status. This is a genuine, verified quirk (see §21).

## 7. Timeline

Re-verifying the previously-established rule directly against source (`saveTimeline`, line 2679; `timelineReady`, line 2302; `tickChk`, line 2618):

- `projPlanned(p)` = count of checklist points with a truthy `plan`.
- `timelineReady(p)` = `!!p.timelineSet && projPlanned(p)>0` — i.e. **project-level readiness requires only that (a) the timeline was ever saved at all, and (b) at least one point (any point, not a specific one) currently has a target date.**
- `saveTimeline(pid)`: reads every `tl_d{i}` input into `c.plan`; counts `missing` (points left blank). **If `missing===p.chk.length` (literally zero points got a date), it blocks entirely** (`toast("Enter target dates before saving");return`) — confirms "blocks only when zero points have dates." **If `missing>0` but not all**, it only warns via `confirm(missing+" point(s) have no target date. Save anyway?")` and, if confirmed, proceeds — confirms "partial dates are allowed after warning." On success, `p.timelineSet=true` unconditionally (and stays true forever once set — no function ever resets it to `false`, even if every `plan` is later cleared by editing).
- `tickChk(id,i,val)`: the **only** gate checked when ticking is `if(val && !timelineReady(p))` — it does **not** check `p.chk[i].plan` (the specific point's own target date) at all. So a point with no target date of its own can be ticked, as long as the project overall has `timelineSet===true` and at least one (any) other point has a date. Re-confirmed independently, matching the prior audit's finding exactly.
- `autoFillTimeline` is a pure client-side convenience that fills the *input fields* (evenly spread dates between `tl_s` and `tl_e`) before save — it does not itself write to `p.chk`; only `saveTimeline` commits.
- `saveItemDate(pid,i)` (the single-point date editor, `mItemDate`) lets a PM change one point's `plan` independently after the timeline exists, and also recomputes `p.end=projTargetEnd(p)` — so editing one point's date can silently move the project's displayed "end" date.

**Fields storing timeline information:** `p.timelineSet` (Boolean), `p.chk[i].plan` (per-point target date), `p.chk[i].date` (per-point actual completion date, set by `tickChk`), `p.end` (derived overall target-end, `projTargetEnd`).

## 8. Checklist Execution

Structure: fully covered in §3 (`ChecklistExecutionItem`/`appr` nested tables). Key execution-level behaviors, verified directly:

- **Template application at creation:** see §10.
- **Re-application later** (`mApplyChkList`/`applyChkList`): a PM/admin can **Replace** (`p.chk=items;p.chkName=c.name`, discarding all prior ticks/dates/approvals/photos/remarks with only a client-side `confirm`-free warning banner shown when `doneCount>0` — there is **no `confirm()` call gating "Replace"** despite the on-screen warning text, meaning a PM can destroy completed-point history with a single click and no native confirmation dialog) or **Append** (`p.chk=p.chk.concat(items)`, purely additive, preserves everything).
- **Individual point actions:** `tickChk` (done/undone, clears `pmSign`/`appr` on un-tick), `chkRemark` (free text, always editable regardless of `done`/`tlOK` state — confirmed no gate on `chkRemark` itself, though the UI only renders the remark `<input>` when `can` is true), `addPhoto` (push-only, downscaled base64, gated by the same `can` flag as ticking), `mItemDate`/`saveItemDate` (target/completed date, PM-only in UI), `mEditProjChk`/`saveProjChk` (text + sign-responsibility edit, PM-only in UI, explicitly allowed **even after approval exists** — the modal shows a warning ("Changing the sign responsibility does not remove that approval") but does not block the edit), `rmChkItem` (delete, PM-only in UI, blocked only while `c.done` is true via the ternary that omits the "remove" button — **not** blocked at the function level: `rmChkItem` itself has no guard against removing a done/approved point if called directly).
- **Approval/completion state distinction (re-verified independently, exactly matching the prior audit's finding):** a checklist point's **CLIENT** approval captures a free-typed `by` (the on-site person's name, `gv("ap_n")`) plus a signature; the **system user who recorded it** is always `enteredBy: U.name`, a separate field. For any **non-CLIENT** sign type, `by` is set to `U.name` directly (no separate name prompt) — so `by` and `enteredBy` happen to be identical for ENGINEER/SALES/SERVICE points, but the fields remain structurally distinct in every case, confirming they must not be collapsed into one field in the new backend, and confirming a CLIENT approver must never be modeled as a `User` reference.
- **Reachable sign roles, re-verified independently:** `SIGN_ROLES = {SALES:[...], ENGINEER:[...], SERVICE:[...], CLIENT:[...], PM:[...]}` — `PM` is a real key with real role membership (`["hvac_pm","solar_pm","mep_pm","admin"]`), but **no UI path ever assigns `sign:"PM"` to a checklist point** (every point-creation/edit `<select>` — new point, template point, project point — offers exactly `ENGINEER/CLIENT/SALES/SERVICE`). `PM` is a dead/unused sign-role constant, confirmed independently, not to be treated as a functional checklist-point option.

## 9. Checklist Approval Workflow

- **Who can approve a point:** `canApprove(sign)` checks `U.role` against `SIGN_ROLES[sign]`. This is the **only** gate on the "Approve / Sign" button's visibility (`isEng||isPM` also factors into whether ticking/photo/remark controls show, but the Approve button's own visibility is governed purely by `canApprove(c.sign)` once `c.done` is true) — there is **no function-level check inside `doApprove()` itself**; calling `doApprove(pid,i)` directly (e.g. from a crafted request in a real backend) performs the approval unconditionally regardless of the caller's role. This is the same PWA-security-weakness pattern already established for SalesOrder/Payment (§22 makes the classification explicit).
- **Engineer signing:** reachable — `ENGINEER` sign role includes `engineer` plus all 3 PM roles plus `admin`.
- **Client signing:** reachable — a distinct on-screen-signature flow (`isClient` branch in `mApprove`/`doApprove`), gated to the same role set as ENGINEER (i.e. `CLIENT` sign-role membership in `SIGN_ROLES` is `["engineer","hvac_pm","solar_pm","mep_pm","service_eng","admin"]` — the **client themselves never has a PWA login**; "CLIENT approval" is always entered *by a staff member on the client's behalf*, on the client's physical signature).
- **Sales signing:** reachable — `SALES` sign role is `["sales","admin"]`; a checklist point can be authored with `sign:"SALES"` (confirmed via the seed data's VRF checklist example, `{text:"...crane lifting permission taken from society",sign:"SALES"}`), so this is a real, reachable workflow, not merely a theoretical option.
- **Service signing:** reachable — `SERVICE` sign role is `["service_mgr","service_eng","admin"]`.
- **PM counter-sign (`pmSign`):** a **separate**, independent boolean from `appr` — rendered only once `c.done && a.by` (an approval exists) and only for `isPM`; sets `c.pmSign=true` with **no un-sign function** and **no own remark/date/signature capture** — it is a bare boolean flag with no supporting metadata.
- **Signature canvas:** only for CLIENT approvals (`<canvas id="sig">`, `initSig()`/`clearSig()`/`_sg.cv.toDataURL(...)`); no signature capture for any other sign type.
- **Approval replacement/edit behavior:** `doApprove()` unconditionally **overwrites** `c.appr` with a brand-new object every time it is called — there is no append-only history of prior approvals; re-approving (if the UI allowed re-triggering it, which it normally does not once `a.by` is truthy and the Approve button disappears) would silently replace the prior approval record. Approval is therefore **not** append-only at the data level, even though the UI makes re-triggering it practically unreachable once approved.
- **Un-tick clears approval:** confirmed in §8 — `tickChk`'s un-tick branch nulls `c.appr` and resets `c.pmSign=false`, so unchecking a point destroys its approval and counter-sign in one step, with no confirmation prompt.
- **Notifications:** `doApprove` fires exactly one notification — `notify([<divisionPMrole>,"admin"], "Checklist point approved ("+c.sign+" by "+by+") on \""+p.name+"\": "+c.text.slice(0,60))`. There is no separate notification for `pmSign()` (counter-signing fires no notification at all).
- **Completion effects:** approval state feeds directly into the completion gate's `notAppr` count (§8) — a done-but-unapproved point blocks (with override) reaching `status="Completed"`.

## 10. Project Completion Gate

Traced exhaustively inside `savePM(id)` (line 2590), the **only** function that can set `p.status="Completed"`:

```js
if(p.stage==="Completed"&&p.status!=="In Service"){
 var pend=(p.dc||[]).filter(x=>x.ret).reduce((a,b)=>a+((Number(b.qty)||0)-(Number(b.rqty)||0)),0);
 var notAppr=p.chk.filter(c=>!c.done||!(c.appr&&c.appr.by)).length;
 if(pend>0 && !confirm(pend+" returnable material qty is still pending return to office. Mark project completed anyway?")){p.stage=old;save();nav('project',id);return}
 if(notAppr>0 && !confirm(notAppr+" checklist point(s) are not completed/approved. Mark project completed anyway?")){p.stage=old;save();nav('project',id);return}
 p.status="Completed"; p.end=p.end||today();
}
```

**Exact preconditions, literal:**
1. `p.stage==="Completed"` — the literal string, checked at the top of the block (see §5 for the MEP-unreachability consequence).
2. `p.status!=="In Service"` — an already-in-service project's stage can be freely changed to "Completed" text without re-triggering this block (already noted in §6).
3. **Returnable material check** is computed **only from `p.dc[]`** (the Project's own embedded delivery-challan array: sum of `(qty-rqty)` over rows where `ret===true`) — it does **not** consult `DB.invIssues` at all (see §11/§16 — the Inventory-Issue tracking system and the Project's own delivery-challan tracking system are two structurally separate, non-integrated material trackers, confirmed independently).
4. **Checklist check**: `notAppr` counts points that are `!done` **OR** `done` but lacking a truthy `appr.by` — i.e. a done-but-unapproved point counts against completion exactly the same as an undone point.
5. Both checks are **overridable** via a native `confirm()` dialog per check, independently — an admin/PM can force completion through both warnings with two clicks. If either `confirm()` is declined, `p.stage` is rolled back to its prior value (`old`) and the function returns early (no partial state is persisted).

**No other hidden guards were found** — no payment-completeness check, no engineer-assignment check, no timeline-completeness check gates completion at all (a project with `timelineSet` still false, or with several `delayedItems`, can still be marked Completed with no additional warning beyond the two above).

**On success:** `status="Completed"`; `end` back-filled only if previously falsy; **notifications** fire from the generic stage-change block that wraps this whole `if/else if` (see §19): `finance` (payment-milestone-due reminder), `admin` (generic stage-change note), and, specifically because the new stage is `"Completed"`, `service_mgr` ("...Approve commissioning to convert into 1-year warranty service project."). **Finance/payment effects:** the notification is advisory text only — no payment record is created, modified, or auto-raised by completion itself; Payment records remain exactly as they were (a PM must still separately use "Raise to Finance" per milestone, §14). **Service/contract effects:** none automatic — reaching `status="Completed"` only makes the `vProject()` conversion banner and button *appear* (for non-MEP); the actual Contract creation is a distinct, separately-triggered action (§16/§17).

## 11. Material / Inventory Relationship

Two structurally **separate** material-tracking mechanisms exist in the PWA, and Project participates in only one of them functionally:

1. **Project's own embedded `dc[]` (Delivery Challans)** — §9/§10 above and §12 below. This is what the completion gate actually reads.
2. **The standalone Inventory module** (`DB.invItems`, `DB.invIssues`, `DB.invTransactions`, `DB.invLocs`, `DB.invCats`) — `mIssue()`/`saveIssue()` lets an Inventory-role/Admin user issue stock to a staff member **for a "Site / Project"** picked from `siteList()`, which enumerates `mine(DB.projects)` (non-"In Service" ones) plus open ServiceCalls plus a generic "Office / Godown" entry. The chosen option's **display text** is copied into `invIssues[].site` (a free-text label, e.g. `"Rishab Showroom - Satara"`), and its **numeric project id** is separately stored as `invIssues[].projId`.

**Verified independently: `projId` is write-only in the PWA's own functional code.** `grep`-ing every use of `.projId`/`projId` in the file shows it is (a) set at issue time (`saveIssue`), (b) present in seed data, and (c) referenced **only** inside the out-of-scope V2-sync reader/writer layer (`serverRef(DB.projects,v)` / `localRef(DB.projects,x.projId)`, lines 813/859/977 — explicitly ignored per this audit's instructions). **No local/functional PWA code ever reads `invIssues[].projId` back** to filter, join, or display anything on the Project side, or to feed the completion gate, or to feed `projectReportRows`/`dlProjectReport`. The two systems are **not integrated** at the functional level — this reconfirms and sharpens the existing `OPEN_DECISIONS.md #8` finding ("Delivery Challan ↔ Inventory integration — not resolved") with an exact mechanism: it isn't merely "no integration was built," it's "a project-scoped foreign key (`projId`) already exists on the Issue record and is silently unused by every project-facing function."

**Fields/keys involved (My Material / Issue / Return, as they pertain to a Project):**
- `invIssues[].site` (free text, display only, copied at issue time from the picked site's label — never re-synced if the project is later renamed).
- `invIssues[].projId` (numeric, write-only as established above).
- `invIssues[].ret`/`rqty`/`used`/`retReq`/`retReqQty` drive `issBal(x)`/`issStatus(x)` (balance-with-staff / Issued|Part Returned|Returned|Consumed derivation) — entirely independent of any Project field.
- Damaged returns (`saveInvReturn`'s `Damaged — write off` condition) explicitly do **not** restock (`if(!damaged)moveStock(...)`) but still log an `invLog("Damage / Write-off", ...)` transaction and still increment `x.rqty` (so a damaged item still counts as "returned" for balance purposes, just not restocked) — this applies uniformly to any issue, whether or not it names a Project as its site.
- Staff-side self-request-return (`mReturnReq`/`saveReturnReq`, `retReq`/`retReqQty`/`retReqDate`/`retReqNote`) and Inventory-side reject (`rejectReturn`) are both independent of Project state.

**Conclusion for this audit:** Project's own "returnable material" concept (used by the completion gate) is **exclusively** the embedded `dc[]` array, not `DB.invIssues`. Do NOT implement Inventory in this task (per instruction) — this section documents the relationship as a non-relationship, precisely, for the eventual Inventory audit/implementation to build on.

## 12. Delivery Challans

Fully covered in §3 (nested table) and §9/§10 (completion-gate usage). Additional trace, field-complete:

- **Embedded, not separately persisted** — `p.dc` is a plain array property on the Project object; there is no `DB.deliveryChallans` collection anywhere in the PWA.
- **Numbering** (`nextDCNo(p)`): per-project, computed as `max(parseInt(d.no) over p.dc) + 1`, defaulting to `1` for an empty array. Purely numeric-string based (`String(d.no).replace(/\D/g,"")`), so a non-numeric `no` (never produced by the UI, but not structurally prevented) would be parsed as `0`.
- **Create (`mDC`/`saveDC`):** a modal with a fixed **3 starting rows** (`DCROWS=3`), expandable via **"+ Add another item"** (`addDCRow`, unbounded — unlike SalesOrder's hard 5-milestone cap, there is **no maximum row count** for a delivery challan). Each row needs only a truthy `item` name to be kept; blank-`item` rows are silently skipped (`if(!it)continue`). All rows saved in one call share the same `no`/`date`/`by`/`remark`.
- **Add items to an existing DC** (`mDC(pid,_x,existingNo)`): re-opens the same modal pre-filled from the first item already in that `no` group (`ex`), and any newly-entered rows are appended with the same `no`.
- **Edit (`mDCItem`/`saveDCItem`):** single-item edit only (date/receivedBy/type/material/qty/unit/remark) — there is no bulk/whole-challan edit.
- **Delete (`rmDC`):** single-item removal, `confirm()`-gated, `p.dc.splice(i,1)` — removes only that one line, not the whole DC group (a DC group with all its items removed simply disappears from the grouped display, since grouping is computed live from `p.dc`, not stored separately).
- **Print (`printDC`):** opens a new window with a fixed HTML/CSS print layout (letterhead from `co()`, project/SO/date/receivedBy/customer/division header block, item table, two blank signature lines "Delivered By / \<company name\>" and "Received By (Client / Site)"). Company header comes from `co()` (name/address/phone/email), **not** from any Project-level company snapshot.
- **Return (`mReturn`/`doReturn`):** only shown per-item where `d.ret` is true; increments `d.rqty` (clamped to `d.qty`), appends a free-text audit trail into the same `d.remark` field (no separate return-log array on the item), fires no notification (silent from a Notification standpoint — confirmed no `notify(...)` call inside `doReturn`).
- **Signatures:** none on a Delivery Challan itself in the app's data model — `printDC`'s two signature lines are print-layout-only blank lines, never captured back into `p.dc` as data.
- **Numbering/date/items/quantities/person/client details:** all covered in the field table (§3); "client details" specifically are **not** captured per-DC (no client name/signature field on a DC item) — only "Received By (site)" (`by`), a free-text staff/site-person name.
- **Export (`dlChallan`):** one project's full `dc[]` as CSV — `["DC No","Date","Material","Qty","Unit","Type","Returned Qty","Balance on Site","Received By","Remark"]`, one row per item (not per DC group).

## 13. Project Execution Updates

Fully covered in §3 (nested table). Additional confirmation:

- **Who can add:** UI-gated to `isPM||isEng` (`vProject`'s update-add form is only rendered for those two); `addUpdate(id)` itself has **no function-level role check** (same weakness pattern as everywhere else).
- **Append-only, confirmed exhaustively:** grepping every function touching `p.updates` shows exactly one mutator, `addUpdate` (`p.updates.push(...)`) — there is no edit or delete function for an existing update entry anywhere in the file.
- **No attachments/photos** on an update (only checklist points carry photos, §8).
- **Stage references:** an update does not itself reference `p.stage` — it is a free-standing progress note, correctly not to be modeled as tied to a specific stage value.
- **Notifications:** `addUpdate` itself fires **no notification** — however, indirectly, the `nd` (next-action date) field, once it becomes `<=today()` and no further update supersedes it, drives the "Next Action Date" `due`-styled cell in `projPanel`/`vProjects` (a purely visual/reporting effect, not a `notify()` call). The only notification connected to "next action" timing is the entirely separate delay-check mechanism (§7/§19), which is checklist-`plan`-date-based, not `updates`-based.

## 14. Engineer Assignment

- **Field:** `p.engs` — an array of **User `name` strings** (not ids), confirmed: `savePM` builds it from a multi-select whose `<option value="...">` is `esc(u.name)` (line: `'<option'+(p.engs.indexOf(u.name)>=0?" selected":"")+'>'+esc(u.name)+'</option>'` — the option's *text content* is what gets submitted since there's no explicit `value` attribute distinct from the visible name). **Identity mechanism, re-verified as a PWA fact:** engineer assignment is by **display name string match**, exactly like the Enquiry/SalesOrder audits already established for other "who did this" fields — this is consistent, not an isolated case.
- **Assignment/unassignment:** `savePM`'s multi-select is a **full replace** every save (`p.engs=engs`), **not additive** — re-saving the form with fewer names selected silently unassigns those engineers; there is no separate "add engineer"/"remove engineer" action.
- **Multi-engineer:** supported natively (multi-select, `size="3"`), no cap observed on the number of engineers.
- **Role checks:** the assignment control itself is only rendered for `isPM` (`canPM(p)` — admin or the project's own division's PM role); `savePM()` has no function-level check.
- **Engineer visibility:** the candidate list (`engineers`) is `mine(DB.users).filter(u => ["engineer","hvac_pm","solar_pm","mep_pm","service_eng"].indexOf(u.role)>=0)` — **company-wide**, not filtered to the project's own division; a solar PM could assign an HVAC engineer (or another division's PM name) to a project, and nothing prevents it.
- **Notifications:** `savePM` computes `newEngs` (names newly present that weren't in `p.engs` before the save) and fires `notify(["*"], "Engineer(s) "+newEngs.join(", ")+" assigned to project \""+p.name+"\"")` — targeted at **every role in the company** (`"*"`), not just the assigned engineers or their PM.
- **Project ownership:** there is no separate "owner" concept distinct from `engs[]`/`canPM`; `isEng = p.engs.indexOf(U.name)>=0` is how an engineer's own-work visibility/permission (ticking checklist points, adding updates) is computed, purely by name match against the current `engs[]` snapshot.

## 15. Project Division

- **Stage list:** division-specific, §5.
- **Checklist:** division-specific default/fallback, §10.
- **Permissions:** `canPM(p) = U.role==="admin" || PM_DIV[U.role]===p.div` — i.e. only the **matching** division's PM role (or admin) can edit stage/vendor/engineers/timeline/checklist-choice/checklist-point-add for that project. **However**, `canEditChk()` (used to gate the separate **Checklist Library** screen, not the in-project checklist) is defined as `U.role==="admin" || U.role in PM_DIV` — **any** of the three PM roles, regardless of division match — a genuine cross-division permission gap distinct from `canPM`, confirmed independently (see §21/§22).
- **Engineer assignment:** company-wide candidate pool, not division-filtered (§14) — a genuine division-crossing quirk.
- **Notifications:** every division-targeted notification resolves the PM role via the same inline ternary pattern (`p.div==="HVAC"?"hvac_pm":p.div==="Solar"?"solar_pm":"mep_pm"`), repeated verbatim in `saveSO`, `doRaise`(via project `mRaise`/`doRaise`), `savePM`, `tickChk`, `runDelayCheck`, `doApprove` — consistent everywhere, no division-name mismatch found.
- **Completion:** MEP is structurally excluded from the stage-literal completion path (§5/§6/§10) — this is the single most consequential division-specific behavioral difference in the whole module, not a cosmetic one.
- **Project views:** `vProjects`/`projPanel`/dashboard KPIs all apply `hasDiv(p.div)` (company subscription filter) plus, for PM-role dashboards, an additional `p.div===PM_DIV[U.role]` filter — but **only in list/dashboard contexts**. `vProject()` (the single-record detail view reached via `nav('project',id)`) has **no division check of any kind** — any authenticated company user who knows/guesses a project id can open its full detail page directly, regardless of their own role's division. This is a genuine, verified gap distinct from (and in addition to) the general "no function-level role check" pattern (§21/§22).
- **Reports:** `dlProjects()` restricts to `myDiv()` when the calling user has one (i.e. is a PM role), else all divisions the company has (`hasDiv`) — consistent with the list-view filtering, not the detail-view gap above.

## 16. SalesOrder / Payment Relationship

**Project → SalesOrder**, exact helpers:
- `mine(DB.sos).find(s => s.no===p.soNo)` is the **only** lookup mechanism used everywhere (`vProject`, `dlProjects`/`projPayInfo`, `mRaise`/`doRaise`, `projectReportRows`, `printProjectReport`) — the relationship is entirely by matching the SO's own **display number** (`no`), never by any Mongo-style/internal id. This is consistent with (and confirms, from the Project side) the SalesOrder audit's established "functional identity = SO number + milestone index" convention.
- Data pulled from the resolved SO into Project-facing views: `so.contacts[0].n`/`.ph` (customer name/phone, for `printDC`/notifications), `so.pay[]` (the milestone array itself — Project never stores its own copy of payment terms, always re-reads live from the SO), `so.project`/`so.div` (used only for cross-checks / DC print header, not re-copied).

**Project → Payment**, exact helpers:
- `paySum(so)` — `{tot, rcv, pen, pct}` computed by summing `so.pay[]`: for a milestone already flagged `x.rcv===true`, its full amount counts as received; otherwise, the **linked Payment record** (`DB.payments.find(p => p.soNo===so.no && p.mi===i)`) is looked up and `payRcvd(pr)` (sum of that Payment's `paid[]` entries) is added instead. This is the **same "dual received calculation"** quirk already flagged in the SalesOrder audit (list view trusts `so.pay[i].rcv` flags where already true; the Payment ledger is consulted only for milestones not yet flagged received) — reconfirmed here as the exact mechanism Project's own payment display uses too (`paySum` is shared code, not a Project-specific reimplementation).
- `payRecord(soNo,mi)` — the single canonical Payment lookup helper, used by both Project (`vProject`, `mRaise`/`doRaise`, `projPayInfo`) and Payment/Finance screens.
- `projPayInfo(p)` — Project-specific wrapper: `{so, rcv, pen, tot, pct, next}` where `next = so.pay.filter(x=>!x.rcv)[0]` (the **first** not-yet-received milestone in array order — not the earliest-due, not the smallest-balance; purely first-by-index). Used by `projPanel`/`vProjects`/`dlProjects` for the "Next Milestone Due" column.
- **Milestone index mapping:** identical to the SalesOrder audit's established convention — `mi` is the **array index** into `so.pay[]`, used as-is to find/create the matching Payment row; no durable milestone id exists anywhere.
- **`mRaise`/`doRaise`** (raise-to-finance, invoked from the Project detail's payment-milestone table): traced in full — if no Payment record yet exists for that `(soNo,mi)`, one is created on the fly (`DB.payments.push({..., paid:[]})` — note this creates `paid:[]`, not the Payment's alternate name variants used elsewhere; confirmed the Payment schema field is consistently `paid`). Sets `pr.raised={by,role,date,note,dueBy,priority}`, appends to `pr.disc`, and fires `notify(["finance","admin"], (pri==="Urgent"?"⚠ URGENT — ":"")+"Payment milestone raised by "+U.name+" for \""+p.name+"\" (SO-"+so.no+"): "+money(payBal(pr))+" due — "+note+". Collect by "+by+".")`. This is byte-for-byte the same function/wording already fully documented in the SalesOrder audit's §8 — reconfirmed here from the Project-side entry point (`mRaise` is invoked with a **Project** id and milestone index, then internally re-resolves to the SO, exactly mirroring the flow already audited).

## 17. Finance / Accounts Impact

Project is never independent of Finance — every one of these paths touches Finance-visible state or fires a Finance-targeted notification:
- Payment milestone display and next-due tracking on the Project detail page and every Project list/report (§16).
- Raise-to-finance from the Project detail page (§16), identical mechanism/wording to the SalesOrder-side raise (same `doRaise` function, same notification).
- **Stage-change notification always includes Finance**: `savePM`'s `notify(["finance"], "Project stage update: ... Check payment milestone due as per SO terms.")` fires on **every** stage change, not only reaching Completed — i.e. Finance is notified of routine stage progression (e.g. "Planning → Piping"), not just completion.
- **Completion reminder**: the completion-triggering stage change is itself just one more stage change, so it too fires the generic Finance notification above (there is no distinct, separate "project completed, please collect final payment" message — it's the same generic wording).
- **Payment state in project list**: `projPanel`/`vProjects`/dashboard all surface Received/Pending totals and Next-Milestone-Due directly (§16).
- **No completion gate is payment-related** — reconfirmed in §10, the completion gate checks only returnable material and checklist approval, never payment/milestone balance.

## 18. Contract / Service Conversion

- **Exact trigger:** `convertToService(id)`, called only from the `vProject()` conversion banner's button, itself rendered only when `p.status==="Completed" && p.div!=="MEP"`.
- **Prerequisites (function-level, re-verified — `convertToService` itself has no internal guard beyond what's implied by being reachable):** none beyond the banner's own render condition; there is **no function-level check inside `convertToService`** that `p.status` is actually `"Completed"` or that `p.div!=="MEP"` — calling it directly (e.g. via a crafted request) would succeed unconditionally for any project id, including an MEP one or a still-"Ongoing" one. This is the same UI-only-security pattern as every other mutator in this module.
- **Division restriction:** effectively MEP-only-excluded, for the mechanical reason established in §5/§6/§10 (MEP structurally cannot reach `status==="Completed"` through the normal stage path) — reconfirmed, not merely restated, by reading `convertToService` itself, which contains no division check of its own.
- **Commissioning requirement:** the button's own label is "Approve Commissioning → Convert to Service (1 yr warranty)" and the banner text says "On approval of commissioning by the Service team, this project converts..." — but there is **no separate "commissioning" data object or approval record created** (see §17 below — commissioning is a UI framing/label, not a distinct persisted entity; the single click of this one button *is* both "approving commissioning" and "converting to service" atomically).
- **Completion requirement:** yes, via the banner's render condition (`status==="Completed"`) as above.
- **Checklist requirement:** none beyond whatever was already required (with override) to reach `status==="Completed"` in the first place — no additional/independent checklist check inside `convertToService`.
- **Approval requirement:** the button is rendered only for `U.role==="service_mgr"||U.role==="admin"` (UI-only, no function-level check, as noted).
- **Contract creation, exact fields:** `{id, co, customer: p.customer||p.name, phone:"", email:"", site:p.name, cap:p.cap, start: today(), end: <exactly one year minus one day from today>, amcType:"Quarterly", cat:"Warranty", amount:0, svcs:[4 entries, one per calendar quarter starting this month, each {m:"YYYY-MM", done:""}], fromProject:p.id}`. Note: `phone`/`email` are hardcoded blank — never copied from the SO's contact info despite `p.customer` itself being sourced from the SO contact name; this is a genuine, verified data-loss quirk (the Contract has no phone/email even though the originating SO recorded a contact phone).
- **Warranty duration:** exactly 1 year (`end.setFullYear(end.getFullYear()+1); end.setDate(end.getDate()-1)` — i.e. inclusive one-year span ending the day before the anniversary).
- **PM schedule generation:** 4 quarterly entries, `amcType` fixed to `"Quarterly"` regardless of anything about the source project (there is no option to choose Half-Yearly/Monthly for a conversion — that choice only exists in the separate, independent `mContract()`/`saveContract()` manual-AMC-creation flow used elsewhere in the PM/AMC List screen).
- **Project status change:** `p.status="In Service"` (terminal, per §6).
- **Notifications:** exactly one — `notify(["service_mgr","admin"], "Commissioning approved: \""+p.name+"\" converted to Service project — 1 year warranty, quarterly PM scheduled.")`.
- **ServiceCall relationship:** `Contract.fromProject` is the **only** back-reference created by this conversion; there is no ServiceCall created at conversion time. Re-verified: `contractReference`/`contractRef` do **not** exist anywhere in the PWA's local functional code as a field name on ServiceCall — that name only appears in `new-app`'s own `DOMAIN_MODEL.md`/`ServiceCall.js` design as a **NEW BACKEND DESIGN** field, correctly distinct from any PWA fact. ServiceCalls are created independently later (register-complaint flow, or the Contract's own "PM due" panel scheduling a visit via `mCall(contractId)`), out of scope for this audit.

## 19. Commissioning

Re-verified directly, per the instruction's specific ask: **"commissioning" in the PWA is a label, not a data structure.** There is no `commissioningDate`, `commissioningApproval`, `commissionedBy`, or any similarly-named field anywhere in `DB.projects` or `DB.contracts`. The entire "commissioning" concept consists of:
- The `vProject()` banner's copy text ("On approval of commissioning by the Service team...").
- The single button, gated in the UI to `service_mgr`/`admin`, whose `onclick` calls `convertToService(id)` directly — clicking it **is** the entire "commissioning approval" act; no separate confirmation modal, no remark field, no signature.
- The resulting Contract's implicit "start date = today" and the one notification in §18.

**Data shape:** none beyond what §18 already documents (the Contract record itself, and the Project's `status` flip). There is nothing more granular to capture — "commissioning" produces zero bytes of its own persisted state beyond the Contract and the status change.

## 20. Reports / Dashboard / Search

**List screens:**
- `vProjects()` — full table, PM-role-scoped by `myDiv()` when applicable, else all company divisions (`hasDiv`); free-text search (`hit(p, [...])`, see below) plus a special-cased engineer-name substring match (`(p.engs||[]).join(" ").toLowerCase().indexOf(...)>=0`) OR'd into the same filter; sorted **newest-first by array order** (`.slice().reverse()` — i.e. reverse of creation/insertion order, not by any date field).
- `projPanel(div)` — compact dashboard variant, "Ongoing" projects only (`p.status!=="Completed"` — note: `In Service` projects **are** still included here, since the filter excludes only `"Completed"` by name, not "non-Ongoing"), with a totals row (`TOTAL` received/pending sums across the filtered set).
- `delayPanel()` — projects with `status==="Ongoing"` and at least one overdue (`delayedItems`) checklist point; shown to `sales`/`admin` company-wide and to each PM role scoped to their own division-filtered dashboard call.

**Detail screen:** `vProject()` — §3/§8/§10/§16 above; **no division/tenant scoping at all** beyond the object being found in `DB.projects` (company-scoping is implicit only in that the id itself would only be reachable via a same-company list — but the detail render function performs no explicit re-check).

**Search fields** (`hit(p,[...])` array, `vProjects`): `soNo`, `name`, `div`, `siteType`, `cap`, `customer`, `stage`, `status`, `vendor`, `chkName` — plus the special-cased `engs` substring match described above. (Note: this differs slightly from the audit-instruction's suggested field list, which is closer to the SalesOrder search fields — **re-verified independently against source**: Project's actual search field set is exactly the 9 named here, `+engs`, not the SalesOrder list.)

**Filters:** none beyond the implicit division scoping (`hasDiv`/`myDiv`) and the search text box — there is no dedicated stage/status/date-range filter UI for Projects (unlike Enquiry's richer filter bar).

**Sorting:** newest-first by reversed array order in `vProjects`; `projPanel`/dashboards render in natural `DB.projects` array order (oldest-first) with no explicit sort call.

**Dashboard panels/counters:** `vDash()` — role-branching KPI cards: PM-role or admin sees Ongoing/Completed/Delayed/"Timeline Not Set" counts (division-scoped for PM roles via `PM_DIV[U.role]`); `delayPanel()`+`projPanel(div)` for PM roles; admin additionally gets a company-wide `projPanel(null)` plus `pmDuePanel()` at the bottom of their dashboard. Sales/admin dashboards do **not** show project-count KPIs unless the viewing role is also a PM role or admin specifically (i.e., `sales` alone sees none of the project KPI cards).

**Engineer workload:** no dedicated "workload" view/count exists anywhere (the audit instruction asks to verify this) — an engineer's own dashboard (`engDash()`, outside the PROJECTS section, not modified here) is the closest analogue but is a separate function not covered by this audit's Project-section scope; no cross-engineer workload comparison view exists in the PWA at all.

**Division summaries:** `projPanel(div)` when called with an explicit division string is the closest analogue (used once per PM-role dashboard, and once with `div=null` for admin) — there is no separate "summary by division" report distinct from this.

**CSV exports:** `dlProjects()` (§ per column list already captured verbatim in §3/above), `dlChallan(pid)` (§12), `dlProjectReport(pid)` (§ full multi-section export: header block, checklist table, site-updates table, material tally table, payment-milestones table with totals — see the literal `projectReportRows` function already quoted). **Printable report:** `printProjectReport(pid)` — a separate, parallel HTML/print rendering of essentially the same sections as `dlProjectReport`, **not** generated from the same row-building function (`projectReportRows` vs. `printProjectReport`'s own inline HTML) — meaning the two outputs are maintained independently and could in principle drift out of sync with each other (a latent quirk worth flagging, though no actual discrepancy between the two was found on inspection).

## 21. Notifications

Every `notify(...)` call found anywhere that is triggered by Project-related code (including calls inside functions invoked from a Project screen, such as `doRaise`, which is Payment-domain code invoked from the Project detail page):

| # | Function | Trigger | Target roles | Exact message (verbatim, with concatenation resolved conceptually) | Notes |
|---|---|---|---|---|---|
| 1 | `saveSO` | Project (+SO) created | `[<divisionPMrole>, "admin"]` | `"New SO-"+so.no+" received from Sales: "+so.project+" ("+so.div+"). Project created — assign engineer."` | Already documented in the SalesOrder audit; reconfirmed as the Project-creation notification too, since it's the same event. |
| 2 | `saveSO` | Project (+SO) created | `["finance"]` | `"New SO-"+so.no+" ("+so.project+"): payment terms added to pending payment list."` | Same event. |
| 3 | `savePM` | Any stage change | `["finance"]` | `"Project stage update: \""+p.name+"\" moved "+old+" → "+p.stage+(p.soNo?" (SO-"+p.soNo+"). Check payment milestone due as per SO terms.":".")` | Every project always has a `soNo` (§4), so the `(SO-...)` branch is effectively always taken in practice. |
| 4 | `savePM` | Any stage change | `["admin"]` | `"\""+p.name+"\" stage: "+old+" → "+p.stage` | |
| 5 | `savePM` | Stage changed **to** `"Completed"` specifically | `["service_mgr"]` | `"Project \""+p.name+"\" marked Completed. Approve commissioning to convert into 1-year warranty service project."` | Fires in addition to #3/#4, not instead of. |
| 6 | `savePM` | One or more new engineers assigned (name newly present vs. prior `engs`) | `["*"]` (every role in company) | `"Engineer(s) "+newEngs.join(", ")+" assigned to project \""+p.name+"\""` | Broadcast to the whole company, not just PM/engineer/admin. |
| 7 | `tickChk` | A point ticked done **after** its target date (`v=daysBetween(plan,date)>0`) | `[<divisionPMrole>, "sales", "admin"]` | `"Delayed completion on \""+p.name+"\": \""+c.text.slice(0,50)+"\" done on "+c.date+", "+v+" day(s) after target "+c.plan+"."` | Per-point, fires every time a late point is ticked (not throttled). |
| 8 | `tickChk` | The **last** remaining undone point is ticked (`p.chk.every(c=>c.done)`) | `[<divisionPMrole>, "admin", "service_mgr"]` | `"All checklist points completed for \""+p.name+"\"."` | |
| 9 | `doApprove` | A checklist point approved | `[<divisionPMrole>, "admin"]` | `"Checklist point approved ("+c.sign+" by "+by+") on \""+p.name+"\": "+c.text.slice(0,60)` | |
| 10 | `saveTimeline` | **First-ever** timeline save for the project (`first = !p.timelineSet` before setting it true) | `["admin","sales",<divisionPMrole>]` | `"Timeline set for \""+p.name+"\" by "+U.name+" — target completion "+p.end+". Work can now start."` | **Not** fired on subsequent timeline edits — confirmed the `if(first)` guard means this is a one-time notification per project. |
| 11 | `runDelayCheck` | At most once per calendar day per project, while `Ongoing` and `timelineReady`, if any point is overdue | `[<divisionPMrole>, "sales", "admin"]` | `"⚠ PROJECT DELAYED — \""+p.name+"\" ("+p.div+(p.soNo?", SO-"+p.soNo:"")+"): "+late.length+" checklist point(s) past their target date, max delay "+worst+" day"+(worst>1?"s":"")+". Latest pending: "+late[0].text.slice(0,60)` | Throttled via `p.delayNotified===today()` guard; `late[0]` is simply the first-by-array-order overdue point, not necessarily the worst-delayed one (the "worst" number in the message text is computed separately via `.reduce`, but the *named* point is not that same worst one). |
| 12 | `doRaise` (Payment-domain, invoked from Project detail) | PM/admin raises a milestone to finance | `["finance","admin"]` | `(pri==="Urgent"?"⚠ URGENT — ":"")+"Payment milestone raised by "+U.name+" for \""+p.name+"\" (SO-"+so.no+"): "+money(payBal(pr))+" due — "+note+". Collect by "+by+"."` | Already fully documented in the SalesOrder audit; reconfirmed as reachable from the Project screen too. |
| 13 | `convertToService` | Commissioning "approved" | `["service_mgr","admin"]` | `"Commissioning approved: \""+p.name+"\" converted to Service project — 1 year warranty, quarterly PM scheduled."` | |

No notification was found to be fired **indirectly** through a helper that isn't itself listed above — every `notify(...)` call site touching Project-related flows has been enumerated exhaustively by direct `grep`.

## 22. Roles / Authorization

Per-action classification table (PWA visible/rendering intent vs. actual function-level enforcement vs. division/assignment restriction):

| Action | Visible role gate (UI) | Actual function-level gate | Division restriction | Assignment restriction | Classification |
|---|---|---|---|---|---|
| Create Project (via SO save) | `sales`/`admin` create the SO that creates the Project (SalesOrder audit) | none inside `saveSO`'s project-push code itself | none (division comes from the SO, unrestricted at this layer) | n/a | PWA functional intent = sales/admin (already locked as SalesOrder decision #22); PWA security weakness = no function-level check |
| Edit stage/vendor (`savePM`) | `isPM` = `canPM(p)` = admin or matching-division PM | none in `savePM` | `canPM` is the intended division restriction, UI-only | none | Intent: division-matching PM or admin. Weakness: unenforced at function level. |
| Assign/unassign engineers (`savePM`) | same `isPM` gate as stage edit | none | candidate list is company-wide, NOT division-filtered (§14) — a real, additional gap beyond "no server check" | none | Intent unclear/inconsistent even at the PWA's own UI level (division-gated to edit, but not division-filtered for whom you may assign) — flagged as an OPEN DECISION for the new backend (§27/§30), not simply "PWA weakness." |
| Add execution update (`addUpdate`) | `isPM \|\| isEng` | none | none beyond the render gate | `isEng` = name-match against `p.engs` | Intent: PM or an assigned engineer. Weakness: unenforced. |
| Tick checklist point (`tickChk`) | `(isEng\|\|isPM) && status!=="In Service" && timelineReady` | none beyond the `timelineReady` business-rule check (not a role check) | none | same `isEng` name-match | Intent: PM or assigned engineer. Weakness: unenforced (the one guard present, `timelineReady`, is a workflow rule, not a role/permission check). |
| Add remark (`chkRemark`) | rendered only when `can` (same as ticking) | **none at all**, not even the `timelineReady` check | none | none | Weakest of all — even the one business-rule guard present on ticking is absent here. |
| Add photo (`addPhoto`) | same `can` gate as ticking | none | none | none | Same as ticking. |
| Approve/sign a point (`doApprove`) | `canApprove(c.sign)` (role must be in `SIGN_ROLES[c.sign]`) once `c.done` | **none** | none | none | Intent: role must match the point's declared sign responsibility. Weakness: unenforced. |
| PM counter-sign (`pmSign`) | `isPM` | none | none | none | Intent: matching-division PM or admin. Weakness: unenforced. |
| Choose/replace checklist for a project (`mApplyChkList`/`applyChkList`) | `isPM` | none | none | none | Same pattern. |
| Add/edit/remove a project-level checklist point (`mAddChkItem`/`mEditProjChk`/`rmChkItem`) | `isPM` | none | none | none | Same pattern. |
| Manage the **Checklist Library** (`mNewChkList`/`createChkList`/`dupChkList`/`setDefChkList`/`delChkList`/point CRUD) | `canEditChk()` = admin **or any of the 3 PM roles** | none | **cross-division gap, confirmed**: `canEditChk` does not check that the PM's own division matches the checklist's `div` — a solar PM can open `nav('chklist', <an HVAC checklist id>)` directly and the edit controls render (§15/§21) | none | Genuine PWA-level division-scoping gap, distinct from the usual "UI intent exists but isn't enforced server-side" pattern — here the **UI's own stated intent is already division-blind** for this one screen. |
| Set/edit timeline (`mTimeline`/`saveTimeline`) | `isPM` | none | none | none | Same pattern as stage edit. |
| Create/edit/delete a Delivery Challan (`mDC`/`saveDC`/`mDCItem`/`saveDCItem`/`rmDC`) | `isPM\|\|isEng` (and `status!=="In Service"`) | none | none | none | Intent: PM or assigned engineer. Weakness: unenforced. |
| Return material via DC (`mReturn`/`doReturn`) | same as DC edit | none | none | none | Same pattern. |
| Raise milestone to Finance (`mRaise`/`doRaise`) | `isPM` | none | none | none | Already locked as SalesOrder decision #22 (division-matched PM or admin) — reconfirmed reachable identically from Project. |
| Convert to Service (`convertToService`) | `service_mgr`/`admin` (button render only) | none | none (see §18 — MEP excluded only mechanically, not by an explicit check) | none | Intent: service_mgr or admin. Weakness: unenforced, and the "division restriction" is emergent/accidental rather than a deliberate check. |
| View Project detail (`vProject`) | none — reachable via `nav('project',id)` for any authenticated company user | n/a (read path) | **none at all**, confirmed (§15) | none | This is a genuine visibility gap (not just a mutation-security gap): the PWA's own intent for divisional privacy in the **detail** view is effectively "none," distinct from every list view, which does filter. New backend must decide (open decision, §27/§30) whether to preserve this looseness or add real division-scoped view authorization — preserving it exactly would mean any company user (regardless of role/division) can fetch any project's full detail, which is unlikely to be desired even under "reproduce PWA behavior," since it is arguably an oversight rather than an intended capability; flagged explicitly rather than silently resolved either way. |
| View Project list/dashboard (`vProjects`/`projPanel`/dashboard KPIs) | `hasDiv`/`myDiv` scoping, per-role branches in `vDash` | n/a (read path), but the filtering itself **is** present in these functions, unlike the detail view | yes, consistently (§15/§20) | none | Genuine PWA functional intent, consistently applied across every list/dashboard entry point. |

**Roles NOT touching Project at all (11-role roster, for completeness):** `super` (cross-tenant only, no company-scoped Project access observed), `inventory` (interacts with `DB.invIssues`/`DB.invItems` only — no Project-mutating function; only reads `siteList()` which happens to enumerate projects for display purposes), `sales` (reads Project existence indirectly via SO detail's "Open Project →" link, and via `soStatusPanel`/dashboard, but has no Project-mutating capability anywhere), `finance` (reads Payment/SO milestone data that happens to be Project-adjacent, but never touches `DB.projects` fields directly).

## 23. Bugs / Quirks

Consolidated list of every verified PWA Project quirk/bug found in this audit (cross-referenced to the section that establishes it):

1. **Stage/completion mismatch — MEP structurally unreachable** (§5/§6/§10/§18): the completion gate's `p.stage==="Completed"` literal string check can never be satisfied by MEP's terminal stage `"Delivered"`. Not a policy choice — a mechanical fact of the source. Cascades into MEP being structurally excluded from `status="Completed"`, the commissioning banner, and Contract/Service conversion.
2. **`status` can desync from `stage` after `In Service`** (§6): once `status==="In Service"`, `stage` remains freely editable via `savePM` with zero effect on `status` thereafter (the `else if(p.status!=="In Service")` guard only prevents *regressing out of* In Service, not stage drift within it).
3. **Un-Completing a project has no confirmation and no notification of its own** (§6): editing `stage` away from `"Completed"` silently flips `status` back to `"Ongoing"` via the same generic `else if` branch used for every other non-Completed stage save.
4. **Replacing a project's checklist has a warning banner but no `confirm()` gate** (§8): `mApplyChkList`'s "Replace checklist" button calls `applyChkList(pid,false)` directly with no native confirmation dialog, despite on-screen text warning that completed points/dates/approvals will be lost.
5. **A checklist point's sign-responsibility can be changed after approval, with only a passive warning** (§8): `saveProjChk` allows editing `sign` on an already-approved point with no functional consequence to the existing `appr` record (which is not re-validated against the new `sign` value).
6. **`rmChkItem` has no protection at the function level against removing a done/approved point** — only the UI's ternary omits the "remove" button once `c.done` is true; the function itself performs the splice unconditionally if called.
7. **Un-ticking a checklist point destroys its approval and PM counter-sign with no confirmation** (§8): `tickChk`'s un-tick branch nulls `appr` and resets `pmSign` in the same call that un-marks `done`.
8. **Approval is overwrite-only, not append-only** (§9): `doApprove` always replaces `c.appr` wholesale; there is no history of prior approvals if a point is somehow re-approved.
9. **PM counter-sign (`pmSign`) has no un-sign function, no remark, no date, no signature** — a bare, one-way boolean.
10. **`PM` is a dead/unreachable `SIGN_ROLES` key** for checklist-point sign responsibility (§3/§8) — present in the role-mapping constant, never assignable through any UI.
11. **Engineer assignment is a full-replace, not additive, operation** (§14) — re-saving the assignment form with a shorter selection silently unassigns.
12. **Engineer candidate pool is company-wide, not division-filtered** (§14/§21) — any PM can assign any staff member from any division/role in the candidate list (`engineer`, any of the 3 PM roles, or `service_eng`) to their project.
13. **Checklist Library management (`canEditChk`) is not division-scoped at all** (§15/§21) — a genuine, distinct cross-division permission gap from the general "no server enforcement" pattern; here the PWA's own UI-level intent is already division-blind.
14. **Project detail view (`vProject`) has no division (or any) access check** (§15/§21) — any company user can open any project's full detail directly by id, unlike every list/dashboard entry point, which do filter by division.
15. **Delivery-Challan-based "returnable material" tracking and Inventory-Issue-based material tracking are two entirely separate, non-integrated systems** (§10/§11) — the completion gate consults only `p.dc[]`; `invIssues[].projId` is a write-only, functionally dead foreign key in the local PWA code (only referenced by the out-of-scope V2-sync layer).
16. **Contract created via commissioning conversion never copies the SO's contact phone/email** (§18) — `phone:""`, `email:""` are hardcoded blank even though `p.customer` (the same conversion's `customer` field) is itself sourced from that same SO contact's name.
17. **`dlProjectReport`/`projectReportRows` and `printProjectReport` are two independently-maintained code paths producing (currently) equivalent, but not code-shared, report content** (§20) — a latent drift risk, not a currently-observed discrepancy.
18. **The "worst delay" number and the "latest pending" point named in the delay-check notification are not necessarily the same point** (§21, notification #11) — `worst` is a reduce over all late items; `late[0]` is simply the first late item in array order.
19. **`end` date is silently overwritten by `projTargetEnd(p)`** (the latest checklist `plan` date) the moment a timeline is saved or a single item's date is edited (§3/§7) — the SO-copied initial `end` value is permanently lost from that point forward, even though it remains user-editable-looking on the field's origin.
20. **`timelineSet` is a one-way flag** (§7) — once true, never reset false by any function, even if every `plan` date is subsequently cleared, so `timelineReady`'s "at least one point has a date" half of its condition could in principle become false again while the "timeline was ever set" half stays permanently true (in practice this can't be forced through the UI, since there's no "clear date" control beyond re-editing an individual point's own date field — but the flag's one-way nature is worth recording precisely, since a future edit UI could expose this).
21. **A damaged material return still increments `rqty`** (counts as "returned" for balance-tracking purposes) even though it explicitly does not restock (§11) — consistent within Inventory's own logic, but worth flagging since "returned" and "back in usable stock" are not synonymous here.
22. **`invIssues[].site` is a frozen free-text label copied at issue time** — if the Project is later renamed, previously-issued material's displayed "site" does not follow the rename (again, moot for Project's own completion-gate logic per quirk #15, but relevant if Inventory integration is ever built).

## 24. Field-by-Field Coverage Table

(Consolidating §3's nested tables into the mandated single format; "New-App Representation" cites the current `Project.js` field, and "Coverage Status" is intentionally **not** a fix/implementation verdict — see §29 for that classification.)

| PWA Field | Type/Shape | Required? | Default | Create | Edit | Read Usage | Relationships | Side Effects | New-App Representation | Coverage Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `id` | Int | yes | seq++ | `saveSO` | never | nav/lookup key | n/a | n/a | Mongo `_id` (ObjectId) | COVERED (infra difference only) | |
| `co` | Int | yes | `U.co` | `saveSO` | never | `mine()` | Company | n/a | `companyId` | COVERED | |
| `soNo` | Int | yes | `so.no` | `saveSO` | never | everywhere | SalesOrder (by display number) | n/a | `salesOrderId` (ObjectId ref, unique index) | COVERED — **representation upgraded** from display-number match to a durable ref, consistent with already-locked SO/Payment identity conventions | |
| `div` | Enum | yes | `so.div` | `saveSO` | never (no UI field) | stage list, checklist, notifications | n/a | n/a | `division` (enum) | COVERED | |
| `name` | String | yes | `so.project` | `saveSO` | never | everywhere | n/a | n/a | `name` | COVERED | |
| `siteType` | String | no | `""` | `saveSO` | never (dead field) | detail view | n/a | n/a | `siteType` | COVERED (field exists; dead-field status should be documented, not "fixed") | |
| `cap` | String | no | `""` | `saveSO` | never (dead field) | detail view | n/a | n/a | `capacity` | COVERED | |
| `customer` | String | no | SO contact[0].name | `saveSO` | never | detail, DC print, reports | SalesOrder (indirect) | n/a | `customer` | COVERED | |
| `stage` | Enum (division-scoped) | yes | first stage | `saveSO` | `savePM` | everywhere | drives completion gate | notifications, completion | `stage` (division-aware validator) | COVERED | |
| `start` | Date | yes | `so.start` | `saveSO` | `saveTimeline` | detail, timeline default | n/a | n/a | `startDate` | COVERED | |
| `end` | Date | no | `so.end` | `saveSO` | `savePM` (completion fallback), `saveTimeline`/`saveItemDate` (derived) | detail, reports | n/a | overwritten by `projTargetEnd` | `endDate` | COVERED | quirk #19 |
| `engs` | `[String name]` | no | `[]` | `saveSO` | `savePM` (full replace) | everywhere | User (by name) | notification | `assignedEngineerIds` ([ObjectId ref]) | COVERED — representation upgraded to durable ref | quirk #11/#12 |
| `vendor` | String | no | `""` | `saveSO` | `savePM` | detail | n/a | n/a | `vendor` | COVERED | |
| `status` | Enum | yes | `"Ongoing"` | `saveSO` | `savePM`, `convertToService` | everywhere | n/a | notifications, Contract creation | `status` (enum) | COVERED | |
| `chkName` | String | no | resolved template name / `""` | `saveSO` | `applyChkList` | detail badge | ChecklistTemplate (display only) | n/a | `checklistTemplateName` | COVERED | |
| `chk[]` | Array (see below) | yes (may be `[]`) | resolved seed | `saveSO` | many (see §8) | everywhere | ChecklistTemplate (seed only) | notifications, completion | `checklist` ([subdoc]) | COVERED | |
| `chk[].text` | String | yes | copied | seed/`addChkItem`/`saveProjChk` | `saveProjChk` | display, reports | n/a | n/a | `checklist[].text` | COVERED | |
| `chk[].sign` | Enum 4-value | yes | copied | seed/`addChkItem`/`saveProjChk` | `saveProjChk` | approval gate | n/a | n/a | `checklist[].signResponsibility` | COVERED | `PM` key unreachable, quirk #10 |
| `chk[].done` | Bool | yes | `false` | seed | `tickChk` | everywhere | n/a | notifications, clears `appr`/`pmSign` | `checklist[].done` | COVERED | |
| `chk[].date` | Date/`""` | no | `""` | seed | `tickChk` | reports, `itemStatus` | n/a | n/a | `checklist[].completedDate` | COVERED | |
| `chk[].pmSign` | Bool | yes | `false` | seed | `pmSign` | display | n/a | none | `checklist[].pmSigned` | COVERED | quirk #9 |
| `chk[].remark` | String | no | `""` | seed | `chkRemark` | display, reports | n/a | n/a | `checklist[].remark` | COVERED | |
| `chk[].photos[]` | `[String dataURI]` | no | `[]` | seed | `addPhoto` (push-only) | display | n/a | n/a | `checklist[].photos` | COVERED | no remove function, PWA fact |
| `chk[].plan` | Date/absent | no | absent | `saveTimeline`/`saveItemDate` | same | timeline gate, delay calc | n/a | notifications (delay) | `checklist[].targetDate` | COVERED | |
| `chk[].appr` | Object/`null` | no | `null` | `doApprove` | `doApprove` (overwrite), nulled by `tickChk` un-tick | completion gate, display | n/a | notification | `checklist[].approval` | COVERED | quirk #8 |
| `chk[].appr.by` | String | — | — | `doApprove` | overwrite | display | n/a | n/a | `approval.approverName` | COVERED | |
| `chk[].appr.role` | String (=`c.sign`) | — | — | `doApprove` | overwrite | display | n/a | n/a | `approval.approvedByRole` | COVERED | Note: this is the satisfied sign-responsibility, not `U.role` — verify `new-app` field semantics match this exactly, not `U.role` |
| `chk[].appr.date` | Date | — | — | `doApprove` | overwrite | display, reports | n/a | n/a | `approval.approvedDate` | COVERED | |
| `chk[].appr.remark` | String | — | — | `doApprove` | overwrite | display | n/a | n/a | `approval.approvalRemark` | COVERED | |
| `chk[].appr.sig` | String/`""` | — | — | `doApprove` (CLIENT only) | overwrite | display | n/a | n/a | `approval.signatureImage` | COVERED | |
| `chk[].appr.enteredBy` | String | — | — | `doApprove` | overwrite | n/a | User (by name) | n/a | `approval.enteredByUserId` (ObjectId ref) | COVERED — representation upgraded | |
| `updates[]` | Array | yes (may be `[]`) | `[]` | `saveSO` | `addUpdate` (push-only) | display, reports | n/a | n/a | `executionUpdates` | COVERED | append-only, PWA fact |
| `updates[].d` | Date | yes | `today()` | `addUpdate` | never | display | n/a | n/a | `executionUpdates[].date` | COVERED | |
| `updates[].done` | String | yes | required input | `addUpdate` | never | display, "last update" logic | n/a | n/a | `executionUpdates[].actionDone` | COVERED | |
| `updates[].next` | String | no | `""` | `addUpdate` | never | display | n/a | n/a | `executionUpdates[].nextAction` | COVERED | |
| `updates[].nd` | Date | no | `""` | `addUpdate` | never | dashboard "next action date" | n/a | n/a | `executionUpdates[].nextActionDate` | COVERED | |
| `updates[].by` | String | yes | `U.name` | `addUpdate` | never | display | User (by name) | n/a | `executionUpdates[].enteredByUserId` (ObjectId ref) | COVERED — representation upgraded | |
| `dc[]` | Array | yes (may be `[]`) | `[]` | `saveSO` | `saveDC`/`saveDCItem`/`rmDC`/`doReturn` | everywhere (§12) | n/a | completion gate | `deliveryChallans` | COVERED | |
| `dc[].no` | String | yes | auto | `saveDC` | never (fixed per group) | display, print, export | n/a | n/a | `deliveryChallans[].challanNumber` | COVERED | |
| `dc[].date` | Date | yes | input | `saveDC` | `saveDCItem` | display | n/a | n/a | `deliveryChallans[].date` | COVERED | |
| `dc[].item` | String | yes | input | `saveDC` | `saveDCItem` | display, print, export | n/a | n/a | `deliveryChallans[].materialName` | COVERED | |
| `dc[].qty` | Number | yes | input | `saveDC` | `saveDCItem` | tally, completion gate | n/a | n/a | `deliveryChallans[].quantity` | COVERED | |
| `dc[].unit` | Enum-ish (7 fixed options, not a hard enum) | yes | input | `saveDC` | `saveDCItem` | display | n/a | n/a | `deliveryChallans[].unit` | COVERED (verify `new-app` doesn't over-strictly enum-lock this — PWA offers a fixed `<select>` list but the model itself is a plain string) | |
| `dc[].ret` | Bool | yes | input | `saveDC` | `saveDCItem` | completion gate, return eligibility | n/a | n/a | `deliveryChallans[].returnable` | COVERED | |
| `dc[].rqty` | Number | no | `0` | `saveDC` | `doReturn` (increment-only, clamped) | completion gate, balance calc | n/a | n/a | `deliveryChallans[].returnedQuantity` | COVERED | |
| `dc[].by` | String | no | input | `saveDC` | `saveDCItem` | display, print | n/a | n/a | `deliveryChallans[].recordedByUserId` (ObjectId ref) | COVERED — **representation upgraded, but note this is "Received By (site)", a free-text site-person name, not necessarily a system User** — same class of concern as SalesOrder's `contacts[].name` vs. a Payment's `enteredBy`; flag as an OPEN DECISION whether this can safely be forced into a `User` ref (§30) | |
| `dc[].remark` | String | no | input | `saveDC` | `saveDCItem`, appended-to by `doReturn` | display, print, export | n/a | n/a | `deliveryChallans[].remark` | COVERED | append-on-return behavior (quirk-adjacent) should be preserved, not modeled as a separate structured return log |
| `timelineSet` | Bool | no | absent/false | `saveTimeline` | `saveTimeline` (one-way true) | `timelineReady` | n/a | gates ticking | `timelineSet` | COVERED | quirk #20 |
| `delayNotified` | Date/absent | no | absent | `runDelayCheck` | `runDelayCheck` | throttle only | n/a | n/a | `lastDelayNotifiedDate` | COVERED | |

## 25. Workflow Coverage Table

| PWA Workflow | Trigger | Preconditions | State Changes | Related Entities | Notifications | Derived Values | New-App Coverage | Gap / Decision |
|---|---|---|---|---|---|---|---|---|
| Project creation | `saveSO` (either creation path) | valid SO save (project name required) | new Project row | SalesOrder, Payment(s), Notification(s) | #1, #2 (§21) | `stage`=first-for-division | Covered by the already-implemented `salesOrderCascade.js` | none — already implemented per the SalesOrder task |
| Stage progression | `savePM` | `isPM` (UI only) | `stage`, possibly `status`, possibly `end` | Notification | #3, #4, (#5 if →Completed) | `end` re-derived if timeline exists | NOT YET IMPLEMENTED (Project service doesn't exist yet — correctly out of scope per this task's instruction) | DESIGN DECISION: exact literal-string completion check vs. any "last stage" temptation — must preserve literal check (§5/§10) |
| Timeline set/edit | `mTimeline`/`saveTimeline` | none functionally (UI: `isPM`) | `p.chk[].plan`, `timelineSet`, `p.start`, `p.end` | Notification (first-time only) | #10 | `timelineReady`, `projTargetEnd` | NOT YET IMPLEMENTED | must preserve zero-vs-partial-dates distinction (§7) exactly |
| Engineer assignment | `savePM` | none functionally (UI: `isPM`) | `engs[]` (full replace) | Notification (broadcast `"*"`) | #6 | none | NOT YET IMPLEMENTED | OPEN DECISION: preserve company-wide (non-division-filtered) candidate pool, or is that considered a bug worth NOT reproducing? Flagged, not resolved (§30). |
| Checklist point tick | `tickChk` | `timelineReady` (business rule, not role) | `done`,`date`, clears `appr`/`pmSign` on un-tick | Notification (delay, all-done) | #7, #8 | `itemStatus` | NOT YET IMPLEMENTED | preserve the project-level (not point-level) timeline gate exactly (§7) |
| Checklist point approval | `mApprove`/`doApprove` | `canApprove(sign)` (UI only) | `appr` object (overwrite) | Notification | #9 | none | NOT YET IMPLEMENTED | preserve overwrite (non-append) semantics (§9) |
| PM counter-sign | `pmSign` | `isPM` (UI only) | `pmSign=true` | none | — | none | NOT YET IMPLEMENTED | one-way, no metadata (§9) |
| Project update (execution note) | `addUpdate` | `isPM\|\|isEng` (UI only) | append to `updates[]` | none | — | "last update" drives dashboard columns | NOT YET IMPLEMENTED | strictly append-only (§13) |
| Delivery Challan create/edit/delete | `saveDC`/`mDCItem`/`rmDC` | `isPM\|\|isEng`, `status!=="In Service"` (UI only) | `dc[]` push/edit/splice | completion gate input | none | tally figures | NOT YET IMPLEMENTED | unbounded row count (unlike SO's 5-milestone cap) — do not impose a cap (§12) |
| Material request (staff) | `mReturnReq`/`saveReturnReq` (Inventory module, Project only as a display label) | issued qty balance > 0 | `retReq`/`retReqQty`/`retReqDate`/`retReqNote` on `DB.invIssues` | Notification (inventory+admin) | separate list | none | OUT OF SCOPE (Inventory module) | confirms non-integration with Project completion gate (§11) |
| Material return (store-side) | `saveInvReturn`/`doReturn` (DC) / `mReturn`/`doReturn` (Project DC) — **two distinct functions, same name pattern, different entities** | balance > 0 | `rqty`/`used` on the respective record | Notification (`"*"`, Inventory path only — Project DC return fires none) | balance calc | none | OUT OF SCOPE (Inventory) / NOT YET IMPLEMENTED (Project DC) | must not conflate the two systems (§11/§23 quirk #15) |
| Completion | `savePM` (`stage==="Completed"`) | literal stage match, `status!=="In Service"`, two overridable confirms | `status="Completed"`, `end` back-fill | Notification (finance, admin, service_mgr) | #3, #4, #5 | `pend`, `notAppr` computed live | NOT YET IMPLEMENTED | preserve literal-string / MEP-unreachable behavior exactly (§5/§10) — DO NOT "fix" MEP |
| Commissioning / convert to Service | `convertToService` | UI: `status==="Completed"`, `div!=="MEP"`, `service_mgr`/`admin` | `status="In Service"`; new Contract row | Notification (#13) | none | Contract's derived `end` (1yr-1day), `svcs[]` (4 quarterly) | NOT YET IMPLEMENTED (Contract itself also out of scope per instruction) | preserve exact Contract field defaults, including the phone/email data-loss quirk (§18/§23 quirk #16), unless a future decision explicitly chooses to fix it (flag, don't silently fix) |
| Payment visibility / raise-to-finance (from Project) | `mRaise`/`doRaise` | UI: `isPM` | Payment record created-if-missing, `raised` set | Notification (#12) | `payBal` | ALREADY IMPLEMENTED (via the SalesOrder/Payment task's `raiseToFinance`) | none — confirm the existing implementation is invoked identically from a future Project detail endpoint, not reimplemented |
| Reporting / export | `dlProjects`/`dlProjectReport`/`dlChallan`/`printProjectReport` | UI: role-based menu visibility only | none (read-only) | n/a | n/a | many (see §20) | NOT YET IMPLEMENTED | preserve exact column order/content per §3/§12/§20; note the two-independent-report-paths quirk (§23 quirk #17) |

## 26. Relationship Matrix

| From | To | Cardinality | Trigger | Fields/Keys | Cascade/Side Effects | PWA Fact / New Design |
|---|---|---|---|---|---|---|
| Company | Project | 1:many | n/a | `co` | tenant scoping (`mine()`) | PWA FACT |
| SalesOrder | Project | 1:1 | `saveSO` (either creation path) | `soNo` (PWA: SO's own display number) ↔ `salesOrderId` (new-app: durable ref, already unique-indexed) | Project created exactly once per SO, never re-created on SO edit | PWA FACT (1:1, create-once) + NEW BACKEND DESIGN (durable ref instead of number match) — already implemented per the SalesOrder task |
| Project | Payment | 1:many (one Payment per populated milestone, keyed by `(soNo,mi)`, not directly by Project id) | `saveSO` cascade (creation); `mRaise`/`doRaise` (create-on-fly if missing) | `so.no`+`mi` — Project reaches Payment only by first resolving its own `soNo` back to the SalesOrder, then matching milestone index | none beyond what's already documented in the SalesOrder/Payment audit | PWA FACT — reconfirmed from the Project side; the relationship is mediated through SalesOrder, Project has no direct Payment foreign key of its own |
| Project | ChecklistTemplate | many:1, copy-on-create only | `saveSO` cascade / `applyChkList` | `chkName` (display only); no live template id stored on Project at all | template's later edits never affect a project's already-copied checklist | PWA FACT |
| Project | User (Engineer) | many:many (by name) | `savePM` | `engs[]` (name strings) | full-replace on each save; broadcast notification on new additions | PWA FACT (identity by name) + NEW BACKEND DESIGN (durable ObjectId refs) |
| Project | User (via `dc[].by`, `updates[].by`, `appr.by`/`appr.enteredBy`) | many:many (by name, mostly free text) | various | name strings | none | PWA FACT — `dc[].by` and `appr.by` (CLIENT) are frequently **not** system Users at all (site/client persons); only `updates[].by`, `appr.enteredBy`, and non-CLIENT `appr.by` are reliably system Users |
| Project | InventoryIssue | **none functionally** (write-only `projId` FK exists but is never read by Project-side code) | `saveIssue` | `invIssues[].projId`/`.site` | none | PWA FACT — confirmed non-integration (§11/§23 quirk #15); NOT to be treated as a real relationship for the completion gate or any Project-facing calculation |
| Project | Notification | 1:many (Project is the subject of many notifications, never itself a recipient) | every mutator listed in §21 | target roles/text | n/a | PWA FACT |
| Project | Contract | 1:1 (per conversion; a project converts at most once, since `status` becomes terminal `"In Service"` and the banner disappears) | `convertToService` | `fromProject` (Contract's own back-reference to Project's `id`) | new Contract row; Project `status` flips | PWA FACT |
| Contract | ServiceCall | out of scope for this audit (no creation happens as part of `convertToService`; PM-visit ServiceCalls are scheduled later via the Contract's own PM-due panel, `mCall`) | n/a here | n/a here | n/a here | out of scope — flagged only for completeness of the requested matrix |

## 27. PWA Fact vs New App

This section applies the classification discipline to every material finding above; entries not repeated here (the overwhelming majority of §3–§21) are straightforward **PWA FACT**, already labeled inline throughout. Called out specifically:

- **PWA FACT:** the entire stage/status model (§5/§6), the literal-string completion check and its MEP consequence (§5/§10), the timeline looseness rule (§7), the approval/enteredBy distinction (§8/§9), every notification's exact wording (§21), the non-integration between Project's `dc[]` and Inventory's `invIssues[]` (§11), the Contract-conversion field defaults including the phone/email loss (§18), the absence of any division check on `vProject()` (§15), the non-division-scoping of `canEditChk()` (§15), the company-wide (non-division-filtered) engineer candidate pool (§14).
- **PWA QUIRK/BUG (a subset of PWA FACT, called out because they read as unintended):** quirks #2, #3, #4, #5, #6, #7, #8, #16, #17, #18, #19, #20, #21, #22 in §23 — all genuinely reproducible PWA behavior, not to be "fixed" per this task's instruction, but flagged because a future reader might otherwise assume they're typos in this audit.
- **CURRENT NEW-APP IMPLEMENTATION:** none — no Project service/route/controller exists yet (confirmed in §28); `Project.js`'s schema is the only artifact to compare against, and it is examined in §28.
- **NEW BACKEND DESIGN (already-established conventions from prior tasks, reapplied here as comparison points, not new decisions):** MongoDB/ObjectId identity throughout; durable `assignedEngineerIds`/`enteredByUserId`/`recordedByUserId` refs replacing PWA name strings (already the established pattern from the Enquiry/SalesOrder tasks, and already reflected in the current `Project.js`); embedded (not referenced) checklist/updates/delivery-challans (already implemented, matches the PWA's own always-read-together grouping).
- **OPEN DECISION (net-new, surfaced by this audit, not yet resolved anywhere):** see §30 for the consolidated list — none of these should be treated as already-decided by the mere fact that `Project.js` already has a schema; a schema field existing is not the same as a workflow/authorization decision having been made.

## 28. Current New-App Comparison

Read directly (not modified): `new-app/backend/src/models/Project.js`, `ChecklistTemplate.js`, `Payment.js`, `Notification.js`, `SalesOrder.js`, `src/services/salesOrderService.js`, `src/services/enquiryService.js`, `src/models/shared/enums.js`.

**Covered fields:** every field in §3/§24 already has a corresponding schema field in the current `Project.js` (companyId, salesOrderId, division, name, siteType, capacity, customer, stage w/ division-aware validator, startDate, endDate, assignedEngineerIds, vendor, status enum, checklistTemplateName, checklist[] w/ full nested shape including approval, executionUpdates[], deliveryChallans[], timelineSet, lastDelayNotifiedDate). **No schema gap was found** — this is a strong result, and is called out explicitly rather than assumed: the schema was evidently written with this exact PWA source already in mind (matching stage lists verbatim, matching the approval `enteredByUserId`-vs-`approverName` distinction verbatim, matching the sign-responsibility 4-value enum verbatim including the dead `PM` key comment).

**Covered workflows:** none — there is no `projectService.js`, `projectRoutes.js`, or any Project-mutating code anywhere in `new-app/backend/src`, confirmed by directory listing. `salesOrderService.js`/`salesOrderCascade.js` create the Project row (already implemented, already audited/locked in the SalesOrder task) but contain no stage/timeline/checklist-execution/DC/update/completion/commissioning logic — entirely consistent with "STOP after SalesOrder + Payment" from the prior task.

**Assumptions currently made (in the existing schema, worth flagging even though no code acts on them yet):**
- `salesOrderId` is `required:true` with a **unique** compound index (`companyId+salesOrderId`) — this is correct and consistent with the PWA fact established in §4 (Project is created exactly once, only via SO save, and every Project always has a `soNo`); no schema mismatch.
- `deliveryChallanItemSchema` marks `challanNumber`, `date`, `materialName`, `quantity`, `unit`, `returnable` all `required:true` — consistent with `saveDC`'s own skip-if-blank-item behavior (a row without a material name is never persisted by the PWA either), so this is not an over-strict mismatch; however, `unit` being a plain `String` (not a Mongoose `enum`) correctly leaves room for the PWA's own non-enforced (merely `<select>`-suggested) unit list — worth explicitly confirming during implementation that no `enum:` constraint gets added there, since that would be a **new** restriction the PWA never had.
- `checklistExecutionItemSchema.signResponsibility` **is** a Mongoose `enum` restricted to the 4 reachable values (`SIGN_RESPONSIBILITIES`, presumably `['ENGINEER','CLIENT','SALES','SERVICE']`) — correct, since `PM` is genuinely unreachable in the PWA (§3/§23 quirk #10); this is a case where enum-restricting is **appropriate**, unlike the `unit` case above.
- No schema-level constraint exists (nor should one) forcing `stage==="Completed"` to also require `status==="Completed"`, or vice versa — correctly leaves room for the quirks in §6/§23 to be reproduced faithfully once a service layer is built.

**Schema mismatches:** none found.
**Workflow gaps:** total — no Project service/route exists (expected; this is a pre-implementation audit).
**Incorrect assumptions / misleading comments:** none found in `Project.js`'s existing comments — they are, if anything, unusually precise and already cite the exact PWA facts this audit independently re-derived (e.g. the `PM`-key-unreachable comment, the `approverName`-vs-`enteredByUserId` comment). No correction is needed to any existing comment.
**Undocumented backend design choices:** none found beyond what's already commented in the file.

## 29. Implementation Readiness

| Area | Classification |
|---|---|
| Project entity shape/schema | COVERED (schema already matches PWA fact exactly, §28) |
| Project creation cascade | COVERED (implemented as part of the SalesOrder task) |
| Stage model / division-scoped stage lists | COVERED (schema + enums already correct) — workflow (edit/transition logic) is IMPLEMENTATION GAP |
| Status model / transitions | SCHEMA GAP: none (enum already correct) / IMPLEMENTATION GAP: all transition logic |
| Timeline | IMPLEMENTATION GAP (schema fields exist; no logic) |
| Checklist execution (tick/remark/photo) | IMPLEMENTATION GAP |
| Checklist approval | IMPLEMENTATION GAP |
| PM counter-sign | IMPLEMENTATION GAP |
| Completion gate | IMPLEMENTATION GAP — and a DESIGN DECISION must explicitly confirm the literal-string / MEP-unreachable behavior is to be preserved verbatim (default assumption per the locked principle: yes) |
| Delivery Challans | IMPLEMENTATION GAP |
| Material/Inventory relationship | NOT APPLICABLE to this task (Inventory itself out of scope); DESIGN DECISION for a future Inventory audit: whether to finally integrate `dc[]` with `InventoryIssue`, or preserve the PWA's non-integration |
| Execution updates | IMPLEMENTATION GAP |
| Engineer assignment | IMPLEMENTATION GAP — plus an explicit DESIGN DECISION needed on the division-filtering question (§30) |
| Division behavior (stage/checklist/notifications) | COVERED at the schema/enum level; IMPLEMENTATION GAP at the workflow level |
| SalesOrder/Payment relationship reads from Project | COVERED (the underlying Payment/SalesOrder services already exist and already implement `paySum`/`payRecord`/`raiseToFinance` equivalents per the prior task) — a future Project service would call into these, not reimplement them |
| Finance/Accounts notification wiring from Project mutations | IMPLEMENTATION GAP (the notifications themselves are new, project-stage-triggered; the underlying Payment logic they reference already exists) |
| Contract/Service conversion | NOT APPLICABLE to this task (Contract/ServiceCall implementation explicitly out of scope) — DESIGN DECISION needed eventually on whether to preserve the phone/email data-loss quirk (§18/§23 #16) |
| Commissioning | NOT APPLICABLE (no distinct data shape exists to implement, §19) |
| Reports/dashboard/search | IMPLEMENTATION GAP |
| Notifications (13 distinct triggers, §21) | IMPLEMENTATION GAP |
| Roles/authorization | DESIGN DECISION required for every action in §22's table (server-side enforcement of the PWA's *visible* intent, per the already-locked overall principle) — plus two **additional, PWA-native** gaps that need an explicit decision rather than a mechanical "enforce the visible intent" answer: (a) engineer-assignment candidate pool division-scoping (§14/§23 #12), and (b) Checklist-Library management division-scoping (§15/§21/§23 #13), because in both cases the PWA's own *visible* intent is itself already inconsistent/blind, unlike every other action where the visible intent is at least internally consistent even though unenforced. |
| Bugs/quirks (§23, 22 items) | all PWA QUIRK/BUG — to be preserved verbatim per the locked principle unless/until a future task explicitly reopens one as a decision |

## 30. Final Gap / Decision List

Every item genuinely requiring a decision or flagged as unresolved by this audit (deliberately **not** resolved here, per instruction — this is a read-only audit):

1. **Project detail view (`vProject`) division/access scoping** (§15/§22/§23 #14): the PWA itself applies zero division (or any) check on direct single-project access, unlike every list/dashboard view. Decide: preserve exactly (any company user can view any project) vs. add real division-scoped view authorization as a "server-side authorization" infrastructure difference. Not resolved here.
2. **Engineer-assignment candidate pool division-scoping** (§14/§23 #12): the PWA's candidate list for `p.engs` is company-wide, not filtered to the project's own division. Decide: preserve exactly vs. treat as a bug to correct under "real server-side authorization." Not resolved here.
3. **Checklist-Library management division-scoping** (§15/§21/§23 #13): `canEditChk()` grants any PM role (not just the matching division's) full CRUD over any division's checklist templates. Decide: preserve exactly vs. correct. Not resolved here.
4. **MEP completion-path exclusion** (§5/§6/§10/§18): confirmed mechanical, not policy — must be preserved verbatim per the locked principle (this is closer to a "must preserve" confirmation than an open decision, but flagged since it is consequential enough that an implementer might be tempted to "fix" it without this audit's explicit warning).
5. **Un-Completing a project (`stage` edited away from `"Completed"`)** (§6/§23 #3): silently reverts `status` to `"Ongoing"` with no confirmation/notification distinct from a normal stage change. Preserve-or-flag decision, not resolved here.
6. **Checklist replace-vs-append `confirm()` gap** (§8/§23 #4): "Replace checklist" has no native confirmation despite a warning banner. Preserve-or-flag decision.
7. **`dc[].by` / `appr.by` (non-CLIENT) / `appr.enteredBy` as durable `User` refs** (§24): confirm these can safely be forced into ObjectId refs without loss, given `dc[].by` in particular is very often a **non-system, on-site person's name**, not a real User — same category of concern already raised for SalesOrder's contact fields. Not resolved here.
8. **`checklist[].photos[]` retention/size policy**: the PWA stores unbounded base64 photo arrays inline; no size/retention limit is specified anywhere in the PWA. Left as an infrastructure question (e.g., object storage vs. inline base64) rather than a business-behavior question, but flagged since it could affect document size limits in Mongo. Not resolved here.
9. **Delivery-Challan ↔ Inventory-Issue integration** (§11/§23 #15) — already an open item (`OPEN_DECISIONS.md #8`), reconfirmed here with the exact mechanism (`projId` is write-only). Not resolved here; explicitly out of scope for the eventual Project-execution implementation task too, unless a future decision says otherwise.
10. **Contract phone/email data-loss on commissioning conversion** (§18/§23 #16): preserve verbatim (blank fields) vs. fix by copying from the SO contact. Not resolved here; Contract implementation itself is out of scope for the next task per instruction.
11. **Two independently-maintained report code paths** (`projectReportRows`/`dlProjectReport` vs. `printProjectReport`, §20/§23 #17): decide whether the new backend should share one source of truth for both CSV and print output (a NEW BACKEND DESIGN simplification) or preserve the PWA's own duplication risk verbatim. Leaning toward the former is very likely fine under the "infrastructure difference" allowance (unifying report generation doesn't change observable business behavior, provided both outputs remain byte-for-byte equivalent to today's two independent PWA functions) — but explicitly left as a decision for the implementation task to make, not this audit.
12. **`timelineSet` one-way-flag edge case** (§7/§23 #20): confirm whether the new backend should also make it strictly one-way (matching the PWA, since no UI path ever resets it) or whether a "reset timeline" feature is ever desired — not indicated anywhere in the PWA, so the default should be to preserve one-way-ness unless a future instruction adds a reset feature explicitly.

**Explicitly NOT decided here, per instruction:** none of the above should be read as pre-answered; this document records the question, not the answer, for every item in this section.
