# PWA Coverage Audit — ServiceCall

Status: READ-ONLY AUDIT. No ServiceCall implementation (service/routes/controllers/tests) exists or was created by this audit.

## 1. Scope & source

**Audited**: `MEP_PROJECTS_PWA/index.html` (md5 `111b53dba91704f96b83dae96c7793c6`), the single source of functional/business truth for ServiceCall behavior. Every fact below was obtained by direct `grep -n` / `sed -n` reads of this file in this session — none is recalled from memory or from prior audits.

Functions traced directly: `pmDue()` (L1434), `msgReg()/msgDone()/msgPM()/msgPMdone()` (L3569–3572), `openCallsPanel()` (L3578), `vService()` (L3586), `mCall()` (L3597), `saveCall()` (L3606), `vCall()` (L3617), `showRegMsg()/showDoneMsg()` (L3665–3666), `assignCall()` (L3667), `initSig()/clearSig()` (L3676/3688), `saveReport()` (L3689), `pmDuePanel()` (L3711), `dlService()` (L3515), plus supporting globals: `SVC_CHK` (L228), `mine()` (L1265), `notify()`/`myNotifs()`/`unread()` (L1267–1275), `MENUS`/`ROLES`/`PM_DIV` (L1286–1301), `engDash()` (L1699), seed data `svcCalls:[...]` (L322–330) and `contracts:[...]` (L331+), and the sequence/dedup logic `syncSeq()` (L1005–1013).

**Ignored as infrastructure noise** (per task instructions): `API_MODE`/`TOKEN`/`api()` fetch calls inside `notify()`, the V2 bulk-load/patch code (`loadFromAPI`, `fromV2Svc`, `normalizeLegacyRefs`, `SRC`/`V2_RES` maps, `apiId()`), WebSocket sync, and any other V2-connection-patch code. These exist only to bridge the PWA to a live V2 backend and carry no ServiceCall business rule of their own — they were read only far enough to confirm they are infra (e.g. confirming `syncSeq()`'s counter-recompute-on-load is a load-time safety net, not a business rule).

**Method**: exact line-numbered reads of the literal source; every quoted string (customer messages, checklist item labels, field names) is copied verbatim, not paraphrased.

## 2. Safety baseline

Executed before any audit reasoning, exactly as required:

| Check | Result | Expected | Match |
|---|---|---|---|
| `git diff --name-status -- v2` | 37 files | 37 (pre-existing baseline drift) | ✅ |
| `git diff --name-status -- v3` | 0 files | 0 | ✅ |
| `md5sum MEP_PROJECTS_PWA/index.html` | `111b53dba91704f96b83dae96c7793c6` | `111b53dba91704f96b83dae96c7793c6` | ✅ |
| `md5sum index.html` (root copy) | `111b53dba91704f96b83dae96c7793c6` | `111b53dba91704f96b83dae96c7793c6` | ✅ |
| ServiceCall implementation search (`find new-app -iname "*servicecall*"`) | Only `new-app/backend/src/models/ServiceCall.js` (a schema file, no service/route/controller/test) | Schema only, no implementation | ✅ |

No unexpected baseline was found. Auditing proceeded.

## 3. Entity/field inventory

Verified directly from the seed data at L322–330, `saveCall()` (L3606–3615), `assignCall()` (L3667–3671), and `saveReport()` (L3689–3709). The complete persisted ServiceCall record shape is exactly the candidate list given in the task, **plus `complaint` and `report`/`sig` sub-shapes** — no additional top-level fields exist beyond: `id, co, psc, type, customer, phone, site, date, time, complaint, status, eng, regDate, report, sig, contractId`.

| Field | Meaning | Type (as observed) | Required/Optional | Default | Empty/null behavior | Created/Updated | Staleness | Deletable | Relationships | Displayed/Searchable/Exported |
|---|---|---|---|---|---|---|---|---|---|---|
| `id` | Internal record id, PWA-wide integer, used for navigation (`nav('call', id)`) | Number | Required, immutable | `DB.seq.call` (post-increment) | Never empty | Set once at `saveCall()`, never changed | N/A | No delete action exists anywhere in the source | Primary key referenced by `PARAM` in `vCall()` | Not directly displayed (PSC is shown instead); used in `onclick="nav('call',s.id)"` links |
| `co` | Tenant/company id | Number (or numeric string) | Required | `U.co` (current user's company) | Never empty | Set once at creation | N/A | No | Used by `mine()` for tenant filtering everywhere | Not displayed; filtering only |
| `psc` | Human-facing "PSC number" | Number | Required | `DB.seq.psc` (post-increment, see §4) | Never empty | Set once at creation, never changed | N/A | No | The identity customers/engineers refer to in every message and UI label (`"PSC-"+s.psc`) | Displayed everywhere (`PSC-###`), searchable (`hit()` includes `"psc"`), exported in `dlService()` as `"PSC No"` |
| `type` | Complaint vs. scheduled PM | String enum `"Complaint"` \| `"PM"` | Required | Derived from whether `mCall()` was called with a `contractId` | Never empty | Set once at creation, never changed | N/A | No | Drives which fields the register modal shows and which message templates fire | Displayed as a colored badge, searchable, exported |
| `customer` | Customer name | String | Required (UI blocks save with `toast("Customer name required")` if blank) | Pre-filled from Contract if PM (`c.customer`) | Empty allowed only for the Complaint path if somehow bypassed (UI enforces non-blank) | Set at creation, editable only via the register modal (not editable after creation — no edit-customer path found) | N/A | No | Free text, no link to any Customer entity (none exists in this PWA) | Displayed, searchable, exported |
| `phone` | Customer phone | String | Optional (no validation found) | Pre-filled from Contract if PM | Blank tolerated; used as WhatsApp link build and message-preview gate (`phone?...`) | Set at creation only | N/A | No | — | Displayed, searchable, exported |
| `site` | Site/address | String | Optional (no validation found) | Pre-filled from Contract if PM | Blank tolerated | Set at creation only | N/A | No | — | Displayed, searchable, exported |
| `date` | Appointment date | String (`type="date"` input value, e.g. `"2026-06-10"`) | Optional | `""` for Complaint at creation; captured from `sc_d` for PM | Blank string tolerated everywhere (`s.date||""`) | Set at creation (PM only) or later via `assignCall()` for either type | Can go stale (no reminder/expiry logic) | No | Used verbatim in PM customer messages | Displayed, exported |
| `time` | Appointment time | Free-text String (e.g. `"03:00 PM"`, placeholder-guided, not a real time-typed input) | Optional | `""` for Complaint at creation | Blank tolerated | Same as `date` | Same as `date` | No | Same as `date` | Displayed, exported |
| `complaint` | Complaint description (Complaint type only) | String (textarea) | Optional (no required-field check) | `""` implicitly for PM type (field omitted from PM branch of `saveCall()` — literally set to `""` via the ternary `contractId?"":gv("sc_c")`) | Blank tolerated | Set at creation only; no edit path | N/A | No | — | Displayed in `vCall()` detail only if truthy; exported as `"Complaint"` column |
| `status` | Workflow status | String enum: `"Registered"`, `"Assigned"`, `"Scheduled"`, `"Completed"` | Required | `"Scheduled"` if PM (`contractId` truthy), else `"Registered"` | Never empty | Registered/Scheduled at creation; `"Assigned"` set by `assignCall()` **only if** `s.eng` becomes truthy AND current status is exactly `"Registered"` (PM calls, already `"Scheduled"`, never become `"Assigned"` even once an engineer is set); `"Completed"` set by `saveReport(id,true)` | N/A | No | Drives badge coloring, dashboard KPI filters (`status!=="Completed"`), `openCallsPanel()` inclusion | Displayed as badge, searchable, exported |
| `eng` | Assigned engineer, **stored as the engineer's display name string**, not an id | String | Optional | `""` at creation | Blank means unassigned; `openCallsPanel`/`vCall` render `"—"` for blank | Set/cleared via `assignCall()`'s `sa_e` select (`""` option available → can be cleared) | Can go stale if the named user is renamed/deleted (no referential integrity — plain string) | No dedicated clear action beyond re-saving assignment with blank select | Ownership check `isEng = s.eng===U.name` is a **string equality against the logged-in user's display name** | Displayed, searchable, exported |
| `regDate` | Registration date | String (`YYYY-MM-DD`, from `today()`) | Required, immutable | `today()` | Never empty | Set once at creation | N/A | No | Used in customer-message context (not shown in message text itself, but shown in detail view/report) | Displayed, exported |
| `report` | Nested service/commissioning report object (see §8) | Object or `null` | Optional until an engineer/manager files it | `null` at creation | `null` until first `saveReport()` call (draft or complete) | Created/overwritten wholesale on every `saveReport()` call (draft or complete) — **not merged, the entire object is replaced** | Can be repeatedly overwritten (drafts) with no history/versioning | No delete path; only overwrite | `report.stype`/`report.amount` drive Payment creation (§14) | Displayed fully once present, in both editable (pre-completion) and read-only (post-completion) forms; exported flattened into CSV columns |
| `sig` | Client signature | String — base64 PNG data URI (`canvas.toDataURL("image/png")`) or `""` | Mandatory to reach `"Completed"` status (see §10/§11); optional otherwise | `""` at creation | `""` (falsy) blocks completion; only ever set non-empty inside the `complete` branch of `saveReport()` | Set once at completion time; can be **overwritten** on a later `saveReport(id,true)` call if the record is somehow re-completed (no guard preventing re-running the complete branch on an already-Completed record via direct call, though the UI hides the report/signature form once `status==="Completed"`) | Never cleared once set (no clear-after-complete action; `clearSig()` only clears the in-progress canvas before saving) | No | Rendered as `<img src="s.sig">` in the completed view | Displayed (image) in completed detail view only; exported as a Yes/No flag (`"Client Signed"` column), never as raw data in the CSV |
| `contractId` | Link to originating Contract, for PM calls | Number (Contract `id`) or `0` | Set at creation from `mCall(contractId)` argument; `0` for Complaint-type calls (falsy, used as "no contract" sentinel, not `null`) | `0` | `0`/falsy means "not a PM call sourced from a contract" | Set once at creation, never changed | N/A | No | Used in `saveReport()`'s completion branch to locate and update the Contract's due PM slot (§12) | Not directly displayed as a raw id; implicit in the PM badge and in the completion-time Contract update |

Total: **15 top-level persisted fields** (matches the 15-field candidate list exactly — none fewer, none more at the top level; `report` internally carries 10 further sub-fields, itemized in §8).

## 4. ID/PSC numbering

Traced via `saveCall()` (L3607: `DB.seq.psc++;DB.seq.call++;`) and `syncSeq()` (L1005–1013).

- **Two entirely separate counters.** `id` comes from `DB.seq.call`; `psc` comes from `DB.seq.psc`. They are incremented together on every `saveCall()` (both `++` on the same line) but are conceptually and numerically independent — the seed data proves this: record `id:3` has `psc:270` (lower than record `id:2`'s `psc:401`), because PSC numbers were seeded from a pre-existing legacy sequence unrelated to `id` order.
- **Where each increments**: both increment **only** in `saveCall()`. No other function increments either counter for a ServiceCall. (`assignCall()` and `saveReport()` mutate existing records, never create new `id`/`psc` values.)
- **Reuse potential**: `syncSeq()` recomputes both `DB.seq.call` and `DB.seq.psc` as `Math.max(currently-stored-seq, max-id/psc-actually-present-in-DB.svcCalls)` on every load. This is a client-side, single-device, non-atomic pattern — if two devices/tabs create ServiceCalls concurrently before either syncs, both could independently compute the same next-PSC value and produce **duplicate PSC numbers** (a genuine PWA-level race; verified by the mechanism itself, not merely inferred — there is no locking or server-arbitrated allocation in this pattern).
- **PSC is global, not per-tenant.** `syncSeq()`'s max-PSC scan (`(DB.svcCalls||[]).forEach(...)`) iterates the **entire** `DB.svcCalls` array with no `mine()`/`co` filter — so the PSC sequence is shared across every company/tenant in the same PWA instance, not scoped per company. This is a distinct fact from `id`'s tenant behavior (§20) and must be recorded precisely as observed, not assumed to be per-tenant like other counters.
- **Editability**: neither `id` nor `psc` is ever editable through any UI form found in this source.
- **Where PSC displays**: everywhere a ServiceCall is shown to a human — list rows (`vService()`, `openCallsPanel()`), detail header (`vCall()`: `"PSC-"+s.psc+" — "+s.customer`), CSV export (`"PSC No"` column), and all four customer message templates (`msgReg`/`msgDone`/`msgPM`/`msgPMdone`), which use **only** `psc`, never `id`.
- **PSC is the human-facing identity.** Confirmed: reports and every customer-facing message reference `PSC-<psc>` exclusively; `id` never appears in any user-visible text.
- **Duplicate-PSC possibility in PWA terms**: yes, structurally possible under the concurrent-device race described above, and additionally the PSC sequence being global-not-per-tenant means two different companies' service calls could theoretically be allocated the same PSC number if their local `DB.seq.psc` states diverge and both get reconciled from a shared `DB.svcCalls` array (this depends on how multi-tenant storage is actually shared at the infra layer, which is out of PWA-source scope to resolve).
- **Sole allowed infra adaptation** (per task instructions, not a redesign choice made here): a durable, server-generated ObjectId for `id`-equivalent (already the Mongo `_id`) plus a concurrency-safe, per-company atomic counter for the human-facing PSC-equivalent number. The `new-app` Counter model (`new-app/backend/src/models/Counter.js`) already declares `'serviceCall'` as one of its two `COUNTER_NAMES` and is `companyId`-scoped (unique index on `{companyId, name}`), i.e. it deliberately narrows PSC to per-tenant rather than reproducing the PWA's accidental global sharing — this is documented here as an infra design fact already present in `new-app`, not decided by this audit.

## 5. Type model

Only two `type` values exist in the source: `"Complaint"` and `"PM"`. No third value was found anywhere (`grep`-level trace of every `s.type`/`x.type` usage in the ServiceCall context, plus the ternary in `saveCall()` — `contractId?"PM":"Complaint"` — is the only place `type` is ever assigned).

| Aspect | Complaint | PM |
|---|---|---|
| Creation path | `mCall()` with no `contractId` argument (invoked from `+ Register Complaint` buttons in `vService()`/`openCallsPanel()`) | `mCall(contractId)` invoked from `pmDuePanel()`'s "Schedule PM" button, always passing the Contract's `id` |
| Initial status | `"Registered"` | `"Scheduled"` |
| Relevant fields captured at creation | `customer, phone, site, complaint` | `customer, phone, site` (pre-filled from Contract), `date, time` (from the modal's date/time inputs) |
| Engineer assignment | Not set at creation (`eng:""`); assigned later via `assignCall()` | Same — not set at creation even though it originates from a Contract; assignment is a separate, later manual step |
| Completion behavior | `saveReport(id,true)` — no Contract side effect (`contractId` is falsy, so the `if(s.contractId)` block in `saveReport()` is skipped) | `saveReport(id,true)` — additionally runs the Contract PM-slot-marking logic (§12) because `contractId` is truthy |
| Notifications | `notify(["service_mgr","admin"], "New complaint registered: PSC-...")` | `notify(["service_mgr","admin"], "PM scheduled: PSC-...")` — same `notify()` call, text branches on the ternary `(contractId?"PM scheduled":"New complaint registered")` |
| Customer message | `msgReg(psc)` | `msgPM(psc, date, time)` |

## 6. Creation workflows

Traced exactly from `mCall()` (L3597–3605) and `saveCall()` (L3606–3615).

**`mCall(contractId)`** — opens a modal. If `contractId` is truthy, it looks up the Contract by id (`DB.contracts.find(x=>x.id===contractId)`) and renders "Schedule PM — <site>" with `customer`/`phone`/`site` inputs **pre-filled** from the Contract's own `customer`/`phone`/`site` fields (not copied into the ServiceCall until save), plus Appointment Date/Time inputs. If `contractId` is falsy/omitted, it renders "Register Service Complaint" with `customer`/`phone`/`site` inputs blank and a Complaint Details textarea instead of date/time inputs. There is **no server-side or client-side field validation beyond the customer-name check performed at save time** — the modal itself validates nothing.

**`saveCall(contractId)`** (exact order):
1. `if(!gv("sc_n")){toast("Customer name required");return}` — the **only** enforced validation for either Complaint or PM creation. Phone, site, complaint text, and (for PM) date/time are all optional and unchecked.
2. `DB.seq.psc++;DB.seq.call++;` — both counters incremented together (§4).
3. Object literal built exactly as: `{id:DB.seq.call, co:U.co, psc:DB.seq.psc, type:contractId?"PM":"Complaint", customer:gv("sc_n"), phone:gv("sc_p"), site:gv("sc_s"), date:contractId?gv("sc_d"):"", time:contractId?gv("sc_t"):"", complaint:contractId?"":gv("sc_c"), status:contractId?"Scheduled":"Registered", eng:"", regDate:today(), report:null, sig:"", contractId:contractId||0}`.
   - Engineer (`eng`), report, and signature are **always** initialized empty/null regardless of type — never defaulted from the Contract or any other source.
4. `DB.svcCalls.push(s)`.
5. `notify(["service_mgr","admin"], (contractId?"PM scheduled":"New complaint registered")+": PSC-"+s.psc+" — "+s.customer+" ("+s.site+")")` — fired **after** the push, **before** `save()`.
6. `save();closeModal();nav("call",s.id);` — persists, closes the modal, and navigates straight to the new call's detail view.
7. `showMsg("Registration confirmation — PSC "+s.psc, contractId?msgPM(s.psc,s.date,s.time):msgReg(s.psc), s.phone)` — shows the customer-facing message **preview** modal (see §16), fired last, after navigation.

**Exact registration notification text** (internal, role-targeted, not customer-facing):
- Complaint: `"New complaint registered: PSC-"+s.psc+" — "+s.customer+" ("+s.site+")"`
- PM: `"PM scheduled: PSC-"+s.psc+" — "+s.customer+" ("+s.site+")"`

**Exact customer-facing registration messages** (verbatim, quoted from source, `co()` interpolates the current company's `name`/`phone`/`email`):

Complaint (`msgReg`):
```
Thank you for contacting {CompanyFirstWord}!

We are always here to help you. Please be rest assured that your service call has been registered with us, and your complaint will be attended within working 48 hr.

Service call registration no – PSC {psc}

If any query feel free to contact us.
{companyPhone}
{companyEmail}

Thank you, and have a great day.

Best Regards,
Team {CompanyFirstWord}!
```

PM (`msgPM`):
```
Thank you for your time!

We are always here to give quality service to make your AC system maintenance free.

Your AC system servicing call has been registered with us.

Service call registration no – PSC {psc}
Service call date – {date}
Service call time – {time}

If any query feel free to contact us.
{companyPhone}
{companyEmail}

Thank you, and have a great day.

Best Regards,
Team {CompanyFirstWord}!
```
(`{CompanyFirstWord}` = `c.name.split(" ")[0]`, exactly as coded — not the full company name.)

## 7. Assignment workflow

Traced from `vCall()`'s assignment block (L3627–3630) and `assignCall()` (L3667–3671).

- **Who sees the assignment control**: `isMgr = U.role==="service_mgr"||U.role==="admin"`, and the block only renders `if(isMgr && s.status!=="Completed")`. So only Service Manager and Admin roles can assign/reassign, and only while the call is not yet Completed. No engineer-self-assignment path exists.
- **Engineer candidate pool** (traced independently, see §19 for the dedicated fact): `mine(DB.users).filter(u => ["service_eng","engineer","service_mgr"].indexOf(u.role) >= 0)` — company-scoped via `mine()`, **no division filtering at all** (unlike Project's engineer assignment, which this audit does not assume matches — verified independently here).
- **Date/time requirement**: none enforced. `sa_d`/`sa_t` inputs are optional; `assignCall()` writes whatever `gv()` returns (possibly empty strings) with no validation.
- **Status transition condition**: `if(s.eng && s.status==="Registered")s.status="Assigned"` — status only flips to `"Assigned"` when (a) an engineer name is now truthy AND (b) the call's current status is **exactly** `"Registered"`. This means:
  - A PM call (status `"Scheduled"` at creation) **never** becomes `"Assigned"` through this function, no matter how many times an engineer is set/changed — it stays `"Scheduled"` until completed.
  - Re-running `assignCall()` on an already-`"Assigned"` Complaint call (e.g. to change engineer or date/time) leaves status at `"Assigned"` (the condition's second clause is false, so no re-transition, which is harmless here since it's already the target state).
- **Notification**: `if(s.eng)notify(["*"], "Service call PSC-"+s.psc+" ("+s.customer+") assigned to "+s.eng+(s.date?" for "+s.date+" "+s.time:""))` — sent to **all roles** (`"*"`) but **only if `s.eng` is truthy after the save** (i.e. clearing the engineer to blank suppresses the notification entirely; there is no "unassigned" notification).
- **Sent on every save?**: Yes — every call to `assignCall()` that results in a truthy `s.eng` fires a fresh notification, **even if the engineer/date/time did not actually change** from the previous save (no diff/dedup check exists). Repeated saves of the same assignment produce repeated notifications.
- **Behavior when engineer/date/time cleared**: `assignCall()` unconditionally overwrites `s.eng`, `s.date`, `s.time` with whatever the form fields currently hold — so selecting the blank `""` option in `sa_e` clears the engineer (and, per the notification condition above, no notification fires for a clear). Status does **not** revert from `"Assigned"` back to `"Registered"` if the engineer is subsequently cleared (no such downgrade logic exists).
- **PWA fact recorded separately**: `isEng = s.eng===U.name` (L3620) is a **plain string equality between the stored engineer name and the logged-in user's display `name`**. This is the mechanism by which an engineer sees/edits their own assigned calls (report-editing visibility in §18) and by which `engDash()`/dashboards filter "my calls" (`s.eng===U.name`). It has no user-id linkage whatsoever.
- **Flagged (not resolved) infra adaptation**: mapping this name-string identity to a durable User ObjectId reference, while preserving the same visible ownership semantics (an engineer sees exactly the calls currently bearing their name/id), is listed as Open Decision §26.1.

## 8. Report model

Traced from the report-editing form in `vCall()` (L3634–3646) and `saveReport()` (L3689–3699), plus the default-object literal at L3634:

```
var r=s.report||{make:"",model:"",capacity:"",rtype:"",material:"",service:"",chk:{},stype:s.type==="PM"?"AMC":"Chargeable",amount:0,remark:"",custRemark:""};
```

| Field | Meaning | Input type | Default | Optional/Required | Persistence | Editable before completion | Editable after completion |
|---|---|---|---|---|---|---|---|
| `make` | Unit make/brand | Text input (`r_make`) | `""` | Optional (no validation) | Set on every `saveReport()` (draft or complete) | Yes (form re-renders with current value each visit) | No — completed view is read-only text, no form is rendered once `status==="Completed"` |
| `model` | Unit model | Text input (`r_model`) | `""` | Optional | Same | Yes | No |
| `capacity` | Unit capacity | Text input (`r_cap`) | `""` | Optional | Same | Yes | No |
| `rtype` | Refrigerant/unit type (labelled "Type" in the UI) | Text input (`r_type`) | `""` | Optional | Same | Yes | No |
| `material` | Material used | Text input (`r_mat`) | `""` | Optional | Same | Yes | No |
| `service` | Service done (free-text description) | Textarea, 2 rows (`r_svc`) | `""` | Optional | Same | Yes | No |
| `chk` | Checklist results, see §9 | Object keyed by `SVC_CHK` item text | `{}` | Optional — **no item is required to be filled** (verified: `saveReport()` unconditionally builds `chk` from whatever the six inputs currently hold, blank or not, with no gate) | Same | Yes | No |
| `stype` | Service Type (billing category) | `<select>` (`r_st`), options exactly `["Installation","Warranty","AMC","Chargeable"]` | `s.type==="PM"?"AMC":"Chargeable"` (i.e. defaults differ by call type, but only as an **initial render default** — not persisted until first save) | User-changeable, no restriction on which of the 4 options a PM or Complaint call may end up with | Same | Yes | No |
| `amount` | Chargeable amount | `<input type="number">` (`r_amt`) | `0` (falsy → `Number(gv("r_amt"))||0`, so a non-numeric or blank input silently becomes `0`) | Optional; **no minimum enforced** — `Number("-5")` would pass through as `-5` (no `min` attribute, no server-side clamp) | Same | Yes | No |
| `remark` | Engineer remark | Text input (`r_rem`) | `""` | Optional | Same | Yes | No |
| `custRemark` | Customer remark | Text input (`r_crem`) | `""` | Optional | Same | Yes | No |

**Whole-object replacement**: every `saveReport()` call — draft or complete — **replaces `s.report` entirely** with a freshly built object from the current form state (`s.report={make:gv(...),...}`), rather than merging into the existing object. There is no history/versioning of prior drafts.

## 9. Checklist

`SVC_CHK` (L228), the fixed, ordered array — quoted verbatim, in exact order:
```
["Cooling Testing","Gas Pressure","Filter Clean","Indoor Coil","Outdoor Coil","Body Cleaning"]
```
- **Input type**: each item renders as a free-text `<input>` (id `r_c0`..`r_c5`) with placeholder `"OK / value / done"` — there is **no checkbox/boolean model**; every checklist "result" is an arbitrary string (seed data shows values like `"OK"`, `"120 PSI"`, `"Done"`, `"Cleaned"` — inconsistent free text, not a controlled vocabulary).
- **Default**: empty string per item if not previously filled (`r.chk[k]||""`).
- **Optional/required**: entirely optional; `saveReport()` builds `chk` from all six inputs unconditionally, blank values included, with **no gate preventing completion with an entirely blank checklist**.
- **Persistence**: stored as `report.chk`, an object keyed by the exact `SVC_CHK` label strings (not by index) — e.g. `{"Cooling Testing":"OK","Gas Pressure":"120 PSI",...}`.
- **Editability**: editable pre-completion via the same free-text inputs on every visit to the report form; not editable post-completion (the completed view at L3652–3657 renders the six values as plain read-only table cells, one `<th>`/`<td>` pair per `SVC_CHK` item, in the same fixed order).
- Names are used **exactly as given** in both the edit form and the read-only table — this audit does not rename them.

## 10. Signature

Traced from `initSig()` (L3676–3686), `clearSig()` (L3688), and the signature-handling lines inside `saveReport()` (L3691, L3693).

- **Format**: HTML5 `<canvas id="sig">`, drawn via `mousedown/mousemove/mouseup` and `touchstart/touchmove/touchend` listeners; captured as `_sg.cv.toDataURL("image/png")` — a base64 `data:image/png;base64,...` string.
- **Storage location**: the resulting data URI string is stored directly on the ServiceCall record as `s.sig` (a plain string field, no separate file/blob store, no compression).
- **Mandatory-for-completion condition — verified directly**: `if(_sg&&_sg.empty){toast("Client signature required to complete the call");return}` inside the `complete` branch of `saveReport()`. This **is** enforced exactly as the task expected: a non-empty signature is required to reach `"Completed"` status. `_sg.empty` starts `true` and flips to `false` on the first `mousemove` while `drawing` is true (i.e. any actual stroke clears the empty flag); `clearSig()` resets `empty` back to `true`.
- **Whether blank is allowed on draft save**: yes — the signature check (`if(_sg&&_sg.empty)`) is **only** inside the `if(complete)` branch; `saveReport(id,false)` (Save Draft) never touches `s.sig` at all and never checks `_sg`.
- **Clearable/replaceable before completion**: yes, via the "Clear signature" button (`onclick="clearSig()"`) which wipes the canvas and resets `_sg.empty=true`; the signer can redraw any number of times before hitting Complete.
- **Editable after completion**: no — once `status==="Completed"`, `vCall()` no longer renders the report/signature editing form at all (`if(s.status!=="Completed"&&(isEng||isMgr))` gates the entire editable block), so there is no UI path to re-sign a completed call. (As noted in §3, nothing in the code technically prevents a direct/scripted re-invocation of `saveReport(id,true)` against an already-Completed record from overwriting `sig` again, since `saveReport()` itself has no `if(s.status==="Completed")return` guard — this is a code-level observation, not a claim that the UI exposes this path.)
- **Display of completed signature**: `s.sig?'<label>Client Signature</label><img src="'+s.sig+'" ...>':""` — rendered as an inline `<img>` using the data URI directly, only in the completed detail view.

## 11. Completion workflow

Traced exactly, line by line, from `saveReport(id,true)` (L3689–3709). The **actual enforced order of effects** is:

1. Rebuild `chk` from the six checklist inputs (no gate).
2. Rebuild and assign the entire `s.report` object from current form values (no gate on any report field).
3. **Signature validation**: `if(_sg&&_sg.empty){toast(...);return}` — if this fails, execution stops here; nothing below runs, and `s.report` has **already been overwritten** in step 2 even though completion did not proceed (i.e. a failed completion attempt still persists the draft report data in memory, though `save()` has not yet been called at this point — see step 8).
4. **Signature persistence**: `s.sig=_sg?_sg.cv.toDataURL("image/png"):""`.
5. **Status change**: `s.status="Completed"`.
6. **Contract PM update** (only `if(s.contractId)`): look up the Contract by `s.contractId`; if found, compute `pmDue(c)` and, `if(due.length)`, set `c.svcs[due[0]].done=today()` — see the exact quirk documented in §12.
7. **Chargeable Payment creation** (only `if(s.report.stype==="Chargeable"&&s.report.amount>0)`): increments `DB.seq.pay`, pushes a new Payment record, then `notify(["finance"], ...)`.
8. **Completion notification** (unconditional, runs regardless of steps 6/7): `notify(["service_mgr","admin"], "PSC-"+s.psc+" completed by "+(s.eng||U.name)+" — "+s.customer)`.
9. `save();nav("call",id);` — persists everything and re-renders the detail view.
10. `showMsg(...)` — customer completion message preview shown last: `msgPMdone(...)` if `type==="PM"`, else `msgDone(...)`.

This is the **verified actual order** — note that it is: signature-check → signature-write → status-write → Contract-update → Payment-create-and-notify → completion-notify → save → customer-message-preview. The Payment-creation notification (step 7) fires **before** the general completion notification (step 8), and both fire **before** `save()` is called (step 9) — i.e. all in-memory notification records are appended before the whole `DB` blob is persisted in one shot; there is no partial-persistence risk in this single-threaded client model, but this ordering is exactly why the cross-module atomicity concern is flagged in §14/§26 for a real backend with separate writes.

**Completion guards actually enforced** (and only these — nothing more is enforced):
- Non-empty client signature (`_sg` not empty).
That is the **only** hard guard. Specifically **not enforced**, verified by absence of any corresponding check in the code:
- No checklist completeness gate.
- No mandatory report field (make/model/capacity/etc. can all be blank).
- No mandatory appointment date/time gate.
- No mandatory engineer-assigned gate (a call with `eng:""` can still be completed by anyone who can see the report form, i.e. `isMgr`, even with no engineer ever assigned).
- No mandatory `amount` gate beyond the Chargeable-Payment creation condition itself (a Chargeable-type report with `amount:0` completes fine, it simply does not create a Payment).
- No Contract-validity check (e.g. no check that the Contract still exists/is not expired before marking a PM slot done — the code only checks `if(c)` for existence, not contract status).

## 12. Contract relationship

Traced from `saveReport()`'s completion branch (L3703–3706), `mCall()` (L3597–3600), `pmDue()` (L1434–1438), and the Contract seed shape (L331+, `svcs:[{m:"YYYY-MM",done:""|"YYYY-MM-DD"}]`).

- **Who creates the PM ServiceCall**: any user who can reach `pmDuePanel()`'s "Schedule PM" button (visible to `service_mgr`/`admin` roles per the dashboard/menu wiring in §18) calls `mCall(contractId)`, which then calls `saveCall(contractId)`.
- **Exact fields copied from Contract at creation**: `customer`, `phone`, `site` — copied into the modal's pre-filled inputs, then into the new ServiceCall record only if the user does not edit them. **Not copied**: `capacity`/`cap`, `email`, `amcType`, `category`/`cat`, `amount` — none of these Contract fields transfer to the ServiceCall at all (the report's own `capacity`/`rtype` fields are filled independently, later, by whoever files the report — seed record `id:3` shows `report.capacity:"12"` matching the Contract's `cap:"12"` only because it was manually entered to match, not because of any copy logic).
- **Contract reverse-reference**: verified **no** — `Contract` objects (`DB.contracts`) have no field listing ServiceCall ids that reference them; the relationship is entirely one-directional via `ServiceCall.contractId`.
- **Multiple ServiceCalls per Contract**: yes, structurally unrestricted — `mCall(contractId)` can be invoked repeatedly against the same Contract (e.g. once per quarter, or accidentally twice for the same due slot) with no uniqueness check.
- **How due PM slots are found**: `pmDue(c)` — `c.svcs.forEach((s,i)=>{if(!s.done && s.m<=thisMonth()) out.push(i)})` — returns the **indexes** of every scheduled visit in `c.svcs` that is not yet marked done and whose month (`s.m`, format `"YYYY-MM"`) is less than or equal to the current month (i.e. currently due **or overdue** — both included in the same result set, distinguished only by an `overdue` CSS/label flag in `pmDuePanel()`'s rendering, not by any separate data field).
- **What happens on PM ServiceCall completion**: exactly the code documented in §11 step 6.
- **CRITICAL QUIRK — verified precisely as suspected**: `var due=pmDue(c); if(due.length)c.svcs[due[0]].done=today();`. This marks **`due[0]`** — the **first currently-due-or-overdue slot found by re-running `pmDue(c)` at completion time** — as done. It does **not** use `s.contractId`'s originating slot index (indeed, the ServiceCall record itself never stores *which* slot index it was created against — only the Contract id, not the slot index). Consequences, verified by direct reasoning over the code (not assumed):
  - If a Contract has two overdue slots when a PM call for slot A is scheduled, and slot B becomes/remains "first due" by the time the call is completed (e.g. because slot B was due earlier chronologically, since `svcs` is stored/iterated in array order and `pmDue` returns indexes in that same order), completing the call for slot A's visit will instead mark **slot B** done, leaving slot A still showing as due.
  - This is **not fixed or worked around anywhere else in the source** — no other function reconciles slot identity with ServiceCall identity.
  - This audit does **not** propose a fix; it is recorded as a PWA quirk/bug (§21) and an open decision (§26.9).

## 13. PM due interaction

Traced from `pmDuePanel()` (L3711–3719) and `pmDue()`.

- **Due slots displayed**: `pmDuePanel()` iterates every Contract in `mine(DB.contracts)` and every index returned by `pmDue(c)`, rendering one row per (contract, due-slot) pair — so a Contract with two due slots at once produces two separate rows.
- **Overdue-still-schedulable**: yes — `pmDue()` includes both currently-due (`s.m===thisMonth()`) and overdue (`s.m<thisMonth()`) slots in the same result array; both render the same "Schedule PM" button, distinguished only by an `overdue` CSS class/label (`x.c.svcs[x.i].m<thisMonth()`) with the literal text `" (overdue)"` appended.
- **Multiple-PM-calls-against-same-slot possibility**: yes — `mCall(contractId)` never checks for an existing open/scheduled PM ServiceCall against the same contract or slot before opening the registration modal; a manager can click "Schedule PM" repeatedly for the same due slot and create multiple `ServiceCall` records, all with the same `contractId`.
- **Duplicate prevention**: **absent** — no uniqueness constraint, no "already has an open PM call" check anywhere in `mCall()`/`saveCall()`/`pmDuePanel()`.
- **Out-of-order completion behavior**: since completion always marks `due[0]` (§12), completing service calls out of chronological order relative to their scheduled slots produces the exact quirk in §12 — whichever slot is "first due" at completion time gets marked, regardless of which call/appointment the engineer actually attended.
- **Two-PM-calls-same-Contract behavior**: both calls independently run the full completion logic; the second one to be completed will (per §12's quirk) mark whatever slot is `due[0]` **at that later point in time** — which, if the first completion already cleared the originally-first-due slot, is now a *different* slot than the first completion cleared. This is a mechanical consequence of the quirk, not a separately-coded feature.
- **PWA fact vs. new-backend concurrency note**: the PWA has no duplicate-prevention or locking of any kind because it is a single-device, synchronous, in-memory model — this audit does not invent a business duplicate-prevention rule (e.g. "only one open PM call per slot") that the PWA does not itself enforce. The only note appropriate here is an **infra/concurrency** one: a real multi-user backend completing two PM ServiceCalls concurrently against the same Contract needs a transaction/lock around the read-modify-write of `contract.scheduledVisits[i].done` to avoid a lost update — this is a concurrency-safety concern, not a new business rule, and is listed in §26.9.

## 14. Payment interaction

Traced from `saveReport()`'s Payment-creation block (L3705–3706) and the report's `stype` select options (L3641).

- **Exact allowed service types**: `["Installation","Warranty","AMC","Chargeable"]` — confirmed the literal array in the `<select>` options, no others exist.
- **Default per type**: `stype:s.type==="PM"?"AMC":"Chargeable"` — this is only the **initial render default** shown the first time the report form is opened for a given call (PM → defaults to "AMC"; Complaint → defaults to "Chargeable"); it is not enforced afterward.
- **User-changeability**: fully changeable via the `<select id="r_st">` — a PM call's report can be set to "Chargeable" (e.g. AMC visit with extra billable material) and a Complaint's report can be set to "AMC"/"Warranty"/"Installation" with no restriction tying `type` to `stype`.
- **Amount behavior**: `Number(gv("r_amt"))||0` — a non-numeric/blank input silently becomes `0` (no error shown to the user); **zero is allowed** (simply skips Payment creation, per the condition below); **negative is possible** — nothing in `Number()` or the surrounding code rejects a negative number typed into the `type="number"` input (which has no `min` attribute), so a value like `-500` would pass through unchanged.
- **Exact condition for Payment creation — verified directly**: `if(s.report.stype==="Chargeable"&&s.report.amount>0)`. Confirmed exactly as expected in the task: both the type must be literally `"Chargeable"` **and** amount must be strictly greater than zero.
- **Exact Payment fields created**:
  ```
  {id:DB.seq.pay, co:U.co, project:s.site+" (PSC-"+s.psc+")", person:s.customer, phone:s.phone,
   amount:s.report.amount, remark:"Chargeable service call", lastCall:"", disc:"", nextCall:"",
   status:"Pending", soNo:""}
  ```
  - `project` field (a free-text project/reference label on Payment) is set to `<site> (PSC-<psc>)` — this is how a ServiceCall-originated Payment cross-references its ServiceCall, entirely as a text string, not a real foreign key.
  - `remark` is a hardcoded literal string `"Chargeable service call"`, not derived from the report's own `remark`/`custRemark` fields.
  - `soNo` (Sales Order number field on Payment) is always `""` for a ServiceCall-originated Payment — never populated.
  - `status` is always created as `"Pending"`.
- **Payment notification**: `notify(["finance"], "Chargeable service PSC-"+s.psc+" completed — "+money(s.report.amount)+" to collect from "+s.customer)`.
- **This audit does not redesign this.** The **cross-module atomicity concern** — ServiceCall completion (status write + Contract slot write) and chargeable Payment creation happening as separate, non-transactional writes in the PWA's single in-memory `DB` blob — is flagged purely as an **infra/concurrency note** for the new backend (i.e. these related writes should be wrapped in one transaction/idempotent operation so a failure partway through cannot leave a Completed ServiceCall with no Payment, or a Payment with no matching completed ServiceCall). This is not a business-rule change; see §26.8.

## 15. Notifications

Complete catalogue, each verified directly against its call site (all use the same `notify(roles, text)` helper, L1267–1272, which appends `{id, co, roles, text, date:today(), read:[]}` to `DB.notifs` — every notification is company-scoped via `co:U.co` and targeted by a list of role strings or the literal `"*"` for all roles):

| Event | Trigger | Recipients (role targeting) | Exact text (verbatim) | Before/after persistence | Duplication on repeated save |
|---|---|---|---|---|---|
| Complaint registered | `saveCall()`, `contractId` falsy | `["service_mgr","admin"]` | `"New complaint registered: PSC-"+psc+" — "+customer+" ("+site+")"` | Appended to in-memory `DB.notifs` **before** `save()` is called | N/A — creation happens once per `saveCall()` invocation (one record = one notification) |
| PM scheduled | `saveCall()`, `contractId` truthy | `["service_mgr","admin"]` | `"PM scheduled: PSC-"+psc+" — "+customer+" ("+site+")"` | Same as above | Same |
| Assignment | `assignCall()`, only if `s.eng` is truthy after the write | `["*"]` (every role) | `"Service call PSC-"+psc+" ("+customer+") assigned to "+eng+(date?" for "+date+" "+time:"")` | Before `save()` | **Yes** — every `assignCall()` call with a resulting non-blank engineer re-fires this notification, even for a no-op re-save of the identical assignment; no dedup exists |
| Chargeable Payment creation | `saveReport(id,true)`, only if `report.stype==="Chargeable" && report.amount>0` | `["finance"]` | `"Chargeable service PSC-"+psc+" completed — "+money(amount)+" to collect from "+customer` | Before `save()` (fires after the Payment record is pushed, within the same completion call) | Would duplicate if `saveReport(id,true)` were somehow re-invoked on an already-completed record (no re-completion guard exists, see §11) — not reachable via normal UI navigation since the report form disappears once Completed |
| ServiceCall completed | `saveReport(id,true)`, unconditional (runs regardless of contract/payment branches) | `["service_mgr","admin"]` | `"PSC-"+psc+" completed by "+(eng||U.name)+" — "+customer` | Before `save()` | Same re-invocation caveat as above |

No other ServiceCall-related notification exists in the source (confirmed by a full grep of every `notify(` call site touching `svcCalls`/service-call variables).

## 16. Customer messages

Traced from `msgReg`/`msgPM`/`msgDone`/`msgPMdone` (L3569–3572) and `showMsg()` (L3573–3575), plus their call sites in `saveCall()` (L3615), `saveReport()` (L3708), `showRegMsg()`/`showDoneMsg()` (L3665–3666).

- **`msgReg(psc)`**: builds the Complaint registration text (quoted in full in §6). Triggered immediately after a Complaint `saveCall()` completes, and again on demand via the "📩 Registration message" button (`showRegMsg`) in `vCall()`.
- **`msgPM(psc,d,t)`**: builds the PM registration text (quoted in full in §6), parameterized by the call's own `date`/`time`. Same two trigger points (auto after `saveCall()` for a PM call; on demand via the same "📩 Registration message" button, which itself branches on `s.type==="PM"`).
- **`msgDone(psc)`**: Complaint completion text — quoted verbatim:
  ```
  Thank you for your patience!

  Congratulations your call is attended and solved successfully against your service call registered with us.

  Please give us your valuable feedback.

  Service call registration no – PSC-{psc}

  If any query feel free to contact us.
  {companyPhone}
  {companyEmail}

  Thank you, and have a great day.

  Best Regards,
  Team {CompanyFirstWord}!
  ```
  (Note the literal `"PSC-"` with a hyphen directly against the number here, vs. `"PSC "` with a space in `msgReg`/`msgPM`/`msgPMdone` — this inconsistency is copied exactly as found, not corrected.)
- **`msgPMdone(psc,d,t)`**: PM completion text (verbatim):
  ```
  Thank you for your time!

  Congratulations, your AC system is serviced and ready to use against your service call registered.

  Please give us your valuable feedback.

  Service call registration no – PSC {psc}
  Service call date – {date}
  Service call time – {time}

  If any query feel free to contact us.
  {companyPhone}
  {companyEmail}

  Thank you, and have a great day.

  Best Regards,
  Team {CompanyFirstWord}!
  ```
- Both completion-message functions are triggered automatically at the end of `saveReport(id,true)` (§11 step 10), and on demand via the "📩 Completion message" button (`showDoneMsg`), which only renders once `status==="Completed"`.
- **`showMsg(title, body, phone)`** — this is the **complete extent of "sending"**: it opens a modal titled with the given title, subtitled literally `"SMS / Email preview — sent to customer"` (note: the word "sent" appears in the UI copy, but nothing is actually transmitted by this code), displays the message body as escaped text, and offers exactly two actions: a "Copy Message" button (`copyMsg()`, which writes the text to the clipboard via `navigator.clipboard.writeText`) and, only if a phone number is present, a "Send via WhatsApp" `<a>` link to `https://wa.me/91<phone>?text=<urlencoded body>` opened in a new tab.
- **Important distinction, verified**: there is **no SMS/email provider integration anywhere in this code path** — no `fetch`/`api()` call to any messaging service is made by `showMsg`, `copyMsg`, `msgReg`, `msgDone`, `msgPM`, or `msgPMdone`. This is purely a **preview-and-manual-action UI** (copy-to-clipboard or hand off to WhatsApp's own web/app share link) — it must not be characterized as an automated delivery system, despite the modal's own "sent to customer" subtitle wording.
- **Customer-phone dependency**: the WhatsApp link only renders `if(phone)`; the Copy button and the message preview itself render regardless of whether a phone number exists.

## 17. List/search/report behavior

Traced from `vService()` (L3586–3596), `openCallsPanel()` (L3578–3585), `vCall()` (L3617–3664), `dlService()` (L3515–3527).

**Service Call Register (`vService()`)**:
- Data source: `mine(DB.svcCalls)` (company-scoped, all statuses including Completed).
- Filter/search: `hit(x, ["psc","type","customer","phone","site","status","eng","regDate","date","complaint"])` — free-text search across exactly these nine fields via the shared `hit()`/`srchVal()` mechanism (case-insensitive substring match, per `hit()`'s implementation pattern used elsewhere in the file).
- Sorting: `.slice().reverse()` — the filtered array is reversed, i.e. **most-recently-pushed record first** (since `DB.svcCalls` is append-only in creation order, this yields newest-first by insertion order — **not** a true date-based sort; no explicit sort-by-field/direction control exists in the UI).
- Columns: PSC No, Type, Reg. Date, Customer, Phone, Site, Appt. Date/Time (combined), Engineer, Status.
- Completed/open visibility: **both** shown together in this register (no status filter applied) — every ServiceCall regardless of status appears here.
- Access: reachable via the "service" menu item, present for `admin` and `service_mgr` roles only (§18).
- Actions: "+ Register Complaint" button (`mCall()`), "⬇ Report" button (`dlService()`), and each row is clickable (`onclick="nav('call',s.id)"`) to the detail view.

**Open Service Calls panel (`openCallsPanel()`)**:
- Data source: `mine(DB.svcCalls).filter(s => s.status!=="Completed")` — **excludes** Completed calls explicitly.
- Included statuses: Registered, Assigned, Scheduled (i.e. anything not yet Completed).
- Fields shown: PSC, Type, Customer, Site, Engineer, Status (a narrower column set than the full register).
- Registration control: the same "+ Register Complaint" button is present here too.
- Where it renders: only inside `service_mgr`'s dashboard (`vDash()`'s `if(U.role==="service_mgr")h+=pmDuePanel()+openCallsPanel()`).

**Detail view (`vCall()`)**:
- Header: `"PSC-"+psc+" — "+customer` plus type badge and status badge.
- Fields shown to everyone who can view: Registered date, Phone, Site, Appt. Date, Appt. Time, Engineer, and (Complaint only) the Complaint text.
- Message buttons: "📩 Registration message" always available; "📩 Completion message" only once `status==="Completed"`.
- Assignment block: only `isMgr` (`service_mgr`/`admin`) and only `status!=="Completed"`.
- Editable report form: only `if(s.status!=="Completed"&&(isEng||isMgr))` — i.e. the assigned engineer (`isEng`, by name-match) or a manager/admin, and only while not yet Completed.
- Read-only completed report + signature image: only `if(s.report&&s.status==="Completed")`.
- No pagination anywhere in `vService()`/`openCallsPanel()` — the entire filtered/reversed array is rendered in one table; this audit does not invent pagination that is absent from the source.

**CSV report (`dlService()`)**:
- Same filter (`hit()` over the same nine fields) as `vService()`, but **not** reversed — exported in natural `DB.svcCalls` array order.
- Exact columns: `["PSC No","Type","Registered On","Customer","Phone","Site","Appt Date","Appt Time","Engineer","Status","Complaint","Make","Model","Capacity","Unit Type","Material Used","Service Done","Service Type","Amount","Engineer Remark","Customer Remark","Client Signed"]` — the full report sub-object is flattened into columns, plus a `"Client Signed"` column computed as `x.sig?"Yes":"No"` (a boolean indicator only — the raw signature data is never exported).
- Total-amount behavior: `amt+=Number(r.amount)||0` accumulated across every exported row (regardless of `stype`/Payment-eligibility — this is a raw sum of every report's `amount` field, chargeable or not), then appended as a trailing summary row `["TOTAL CALLS", rows.length, "","","","","","","","","","","","","","","","", amt]`.
- Search/filter interaction: the same search box value used elsewhere in the app (`hit()` reads the shared search state) filters which rows are included in the export — i.e. the CSV reflects whatever the current on-screen filter is, not always the full unfiltered set.

## 18. Roles/access

Traced from `MENUS` (L1289–1301), `ROLES` (L1286), role checks inside `vCall()`/`assignCall()`/`vDash()`/`engDash()`, and `PM_DIV` (L1287).

| Role | Register (menu: "service") | Complaint register button | Schedule PM (`pmDuePanel`) | Assignment | Report editing | Report completion | Completed-report viewing |
|---|---|---|---|---|---|---|---|
| `admin` | Yes (`MENUS.admin` includes `["service",...]`) | Yes | Yes (`vDash` shows `pmDuePanel()+openCallsPanel()` only for `service_mgr`, **not** `admin`'s dashboard — but `admin` reaches the PM list via the `"pmlist"` menu item, which also renders `pmDuePanel()` inside `vPM()`) | Yes (`isMgr` includes `admin`) | Yes (`isMgr` includes `admin`, gate is `isEng||isMgr`) | Yes | Yes |
| `service_mgr` | Yes (`MENUS.service_mgr` includes `["service",...]` and `["pmlist",...]`) | Yes | Yes | Yes | Yes | Yes | Yes |
| `service_eng` | **No** — `MENUS.service_eng` is only `[["dash",...],["mymaterial",...]]`, no `"service"` or `"pmlist"` menu item at all; access to a specific call is only via direct `nav('call',id)` navigation from `engDash()`'s own list (their assigned calls) | No (no register button reachable) | No | No (assignment block requires `isMgr`) | Yes, **only for their own assigned calls** (`isEng = s.eng===U.name`, gate `isEng||isMgr`) | Yes, only for own assigned calls (same gate governs the Save Draft/Complete buttons since they're inside the same conditional block) | Yes — the completed-report read-only block (`if(s.report&&s.status==="Completed")`) has **no role gate at all**, so anyone who can reach `vCall()` for that record (including via direct `nav()` with a known id, see §20) can view a completed report |
| `engineer` | No (same menu shape as `service_eng`, no `"service"`/`"pmlist"` item) | No | No | No | Yes, only for own assigned calls (same `isEng` name-match — `engineer` role is explicitly included in the engineer-candidate pool per §19, so this is reachable) | Yes, same condition | Yes, same as above |
| `finance` | No | No | No | No | No | No | Yes, if they can reach the record (no gate on the read-only view) |
| `sales`, `hvac_pm`, `solar_pm`, `mep_pm`, `inventory`, `super` | No menu access to Service Calls at all | No | No | No | No | No | Same as above — the completed-view block itself has no role gate, so it is a **client-side navigation restriction only** (no menu link), not a genuine access boundary |

**PWA UI visibility vs. server-side enforcement**: every one of the above checks (`isMgr`, `isEng`, menu presence) is **client-side JavaScript only** — there is no server enforcing any of this in the PWA itself (it is a static single-page app operating on an in-memory/local `DB`). This audit records the PWA's **visible intent** precisely as above; the note that a real backend must enforce this same visible intent server-side (since client-side gating is not a security boundary) is the only new-backend-design statement made here, and it does **not** invent broader or narrower permissions than what is listed in the table.

## 19. Engineer candidate pool

Traced independently from `vCall()` L3628: `mine(DB.users).filter(function(u){return["service_eng","engineer","service_mgr"].indexOf(u.role)>=0})`.

- **Exact candidate roles**: `service_eng`, `engineer`, `service_mgr` — confirmed exactly these three, no others.
- **PM roles appear?**: No — `hvac_pm`, `solar_pm`, `mep_pm` (the Project-management roles) are **not** included in this list; ServiceCall's engineer pool is entirely separate from Project's engineer-assignment pool. This is recorded as an independently-verified fact per the task's explicit instruction not to assume parity with Project.
- **Division filtering**: **absent** — `mine(DB.users)` is only company-scoped (via `co`), with no additional `.div`/division check applied anywhere in this filter chain, unlike Project assignment which (per `PM_DIV`/division-aware logic elsewhere in the file, out of this audit's scope) does appear to consider division. ServiceCall assignment candidates include every user in the company holding one of the three roles above, regardless of any division field on that user.
- **Company filtering**: yes, via `mine()` — candidates are scoped to `U.co` (the current user's company), same as every other `mine()`-filtered list.
- **Cross-division visibility**: since there is no division filter, all engineers across all divisions (to the extent divisions even apply to `service_eng`/`engineer`/`service_mgr` roles, which are not part of `PM_DIV`'s HVAC/Solar/MEP mapping in the first place) are visible as candidates.
- **`service_mgr` as an assignment candidate**: notably, a Service Manager can be assigned to a call as its "engineer" (the role appears in the candidate list) — this is recorded as an observed fact, not a bug, since nothing in the source treats this as invalid.

## 20. Tenant behavior

Traced from `mine()` (L1265), every ServiceCall-related list/filter, and `syncSeq()`'s PSC-scan (§4).

- **Every list/panel path uses `mine(DB.svcCalls)` or an equivalent company filter**: confirmed for `vService()`, `openCallsPanel()`, `dlService()`, `engDash()`'s `myS`, `vDash()`'s KPI counts, and the seed-data superset (`vCompanies`'s per-company detail at L1494 uses a direct `DB.svcCalls.filter(x=>x.co===id)`, an equivalent manual company filter, not `mine()` itself, but functionally identical in effect).
- **Direct detail access (`vCall()`) company guard**: **verified absent**. `vCall()` (L3618): `var s=DB.svcCalls.find(function(x){return x.id===PARAM});if(!s)return"Not found";` — this lookup is **global across the entire `DB.svcCalls` array with no `co===U.co` check whatsoever**. Any logged-in user who can navigate to `call` view with a guessed/known `id` (e.g. via `nav('call', <id>)` or a bookmarked/shared link carrying that `PARAM`) can view **any company's ServiceCall detail**, including another tenant's customer name, phone, site, complaint, full service report, and client signature image — this is a genuine, directly-verified cross-company data exposure in the PWA's client-side code (mitigated in the real product only to the extent any actual backend API enforces tenant scoping server-side, which is out of this audit's PWA-only scope to assess).
- **This is recorded as the one mandatory server-enforced infra requirement** per the task's explicit instruction: the new backend's ServiceCall detail/get-by-id endpoint **must** enforce company/tenant scoping server-side (unlike the PWA's client-only `mine()` pattern), precisely because this PWA weakness is directly demonstrated in the code, not hypothesized.
- **PSC global-sequence tenant leakage** (§4) is the other tenant-adjacent fact: `syncSeq()`'s psc-max-scan has no `co` filter, so the PSC counter itself is shared across tenants at the PWA's storage layer, distinct from the per-record `co` field itself (which is present and correct on every record).

## 21. PWA quirks/bugs (each independently verified)

1. **Separate `id`/`psc` sequences**, incremented together but numerically unrelated (seed data proves out-of-order values) — §4.
2. **Global (non-per-tenant) PSC sequence recomputation** in `syncSeq()` — §4/§20.
3. **Client-side-only, non-atomic sequence generation** (`DB.seq.x++`) — races possible across concurrent devices/tabs — §4.
4. **Name-string engineer-assignment identity** (`s.eng===U.name`), not a user-id reference — no referential integrity if a user is renamed or removed — §3/§7.
5. **No division filtering in the engineer candidate pool**, unlike (by inference, not asserted equal) Project's assignment — §19.
6. **`service_mgr` is itself a valid "engineer" assignment candidate** — §19.
7. **PM-type calls never transition to `"Assigned"` status** via `assignCall()` — the status-transition condition only fires from `"Registered"`, and PM calls start at `"Scheduled"`, so they visually stay `"Scheduled"` even after an engineer is assigned — §7.
8. **Assignment notification duplicates on every re-save** with a non-blank engineer, with no diff/dedup check — §7/§15.
9. **Blank appointment date/time tolerated everywhere**, no validation ever enforced on `date`/`time` — §3/§6/§7.
10. **Draft reports allowed with entirely blank/optional fields**, including a fully blank checklist — §8/§9/§11.
11. **Signature mandatory only at completion time**, never on draft save — §10/§11 (this is the expected/designed behavior, not a bug, but recorded per the task's explicit ask to verify it).
12. **Chargeable Payment created only when `stype==="Chargeable" && amount>0`** — a Chargeable report with `amount:0` (or a negative amount, which is not rejected) completes with no Payment or an invalid negative Payment respectively — §8/§14.
13. **Negative report amounts are not rejected** by any validation — §8/§14.
14. **Direct, un-mediated Payment creation** from inside `saveReport()` — no separate Payment-service abstraction exists in the PWA; the ServiceCall completion code pushes directly onto `DB.payments` — §14.
15. **No re-completion guard**: `saveReport(id,true)` has no `if(s.status==="Completed")return` check — a scripted/direct re-invocation on an already-completed record would re-run the entire completion branch (re-mark a Contract PM slot, potentially create a second duplicate Payment, re-fire notifications) — §11/§14/§15 (not reachable through the normal UI, which hides the report form once Completed, but present in the code as written).
16. **PM due-slot stamping quirk**: completion marks `pmDue(c)[0]` — the first currently-due-or-overdue slot **at completion time** — rather than the specific slot the PM ServiceCall was originally scheduled against (no slot index is even stored on the ServiceCall) — §12 (verified precisely as the task suspected).
17. **No reverse Contract→ServiceCall list** — Contracts never store which ServiceCall ids reference them — §12.
18. **No duplicate-PM-call prevention** — multiple ServiceCalls can be scheduled against the same due Contract slot with no check — §13.
19. **Notification duplication on repeated assignment saves** — §7/§15 (same as item 8, restated for completeness in this catalogue).
20. **Customer message is preview + copy/WhatsApp-handoff only** — no real SMS/email provider is called despite the modal subtitle saying "sent to customer" — §16.
21. **Absence of any delete/cancel/reopen action for a ServiceCall** — verified NOT PRESENT anywhere in the source (no `delete`/`cancel`/`reopen` function or button touching `DB.svcCalls` was found by a full trace of every function that mutates a ServiceCall record: only `saveCall`, `assignCall`, `saveReport` touch it, and none removes/cancels/reopens one). This is recorded as an absence, not invented as a feature.
22. **Cross-company detail exposure**: `vCall()`'s lookup has no company guard — §20 (the single most significant PWA-source weakness found in this module).
23. **CSV total-amount sums every report's `amount`**, not only Chargeable/Payment-eligible amounts — §17.
24. **List sorting is insertion-order-reverse, not a true date sort** — §17.
25. **Inconsistent PSC-prefix punctuation** across message templates (`"PSC "` with a space vs. `"PSC-"` with a hyphen in `msgDone` specifically) — §16.

## 22. Relationship matrix

| From | To | Cardinality | Trigger | Fields/Keys | Cascade/Side Effects | PWA Fact / New Design |
|---|---|---|---|---|---|---|
| Contract | ServiceCall | 1 : N (unbounded, no uniqueness) | `mCall(contractId)` → `saveCall(contractId)` | `ServiceCall.contractId` → `Contract.id` (one-directional; Contract has no reverse list) | On ServiceCall completion: `pmDue(c)[0]` slot's `done` is stamped — **not necessarily the originating slot** (§12 quirk) | PWA FACT (verbatim, quirk included, not corrected) |
| ServiceCall | User (engineer) | N : 1, by name-string, mutable | `assignCall()` | `ServiceCall.eng` (string) === `User.name` (string) | Status transitions to `"Assigned"` only from `"Registered"` (§7); notification to `"*"` on every non-blank save | PWA FACT: name-string identity → **New Design flag**: durable `User` ObjectId reference recommended, preserving identical visible ownership semantics (§26.1) |
| ServiceCall | Payment | 1 : 0..1, created at most once per completion event (no guard against more via re-completion, §21.15) | `saveReport(id,true)` when `report.stype==="Chargeable"&&report.amount>0` | `Payment.project` = `<site> (PSC-<psc>)` (free text only — no real FK) | `notify(["finance"], ...)` fired same call | PWA FACT: text-only cross-reference, no schema-level FK — **New Design flag**: cross-module write atomicity (§26.8) |
| ServiceCall | Notification | 1 : N, generated as a side effect of registration/assignment/completion/payment-creation | See §15 | `Notification.roles` (role-list or `"*"`), `text` (free text), `co` | Append-only, no dedup, no read-tracking per-notification beyond `read:[]` array of user ids | PWA FACT — no delivery channel beyond in-app; New Design should consider idempotency for repeated requests (§26.10) |

## 23. Workflow matrix

| PWA Workflow | Trigger | Preconditions | State Changes | Related Entities | Notifications | Derived Values | New-App Coverage | Gap/Decision |
|---|---|---|---|---|---|---|---|---|
| Complaint registration | User clicks "+ Register Complaint", fills modal, `saveCall()` | Customer name non-blank (only enforced check) | New ServiceCall, `status:"Registered"`, `type:"Complaint"` | None (standalone) | `["service_mgr","admin"]` internal + customer preview (`msgReg`) | `id`,`psc` from counters | Schema exists (`ServiceCall.js`); no service/route implements this workflow yet | IMPLEMENTATION GAP |
| PM scheduling from Contract | User clicks "Schedule PM" in `pmDuePanel()`, fills modal (pre-filled customer/phone/site), `saveCall(contractId)` | Customer name non-blank; Contract must exist (looked up, but no validity/status check) | New ServiceCall, `status:"Scheduled"`, `type:"PM"`, `contractId` set | Contract (read-only at this point, not yet mutated) | `["service_mgr","admin"]` internal + customer preview (`msgPM`) | `id`,`psc` from counters | Contract side already has `computePmDueIndexes`/`getPmDuePanel` in `contractService.js`, directly reusable | DOC GAP / IMPLEMENTATION GAP (ServiceCall-side creation not built) |
| Assignment | Manager fills Assign Engineer/date/time, `assignCall()` | `isMgr` role, call not Completed | `eng`,`date`,`time` overwritten; `status` → `"Assigned"` only if from `"Registered"` and `eng` now truthy | User (candidate pool: `service_eng`,`engineer`,`service_mgr`) | `["*"]` if `eng` truthy after save (fires on every re-save, no dedup) | none | Not implemented | IMPLEMENTATION GAP + DESIGN DECISION (name→id mapping, §26.1) |
| Report drafting | Engineer/manager fills report form, "Save Draft", `saveReport(id,false)` | `isEng` (name-match) or `isMgr`; call not Completed | `report` object wholly replaced | none | none | none | Not implemented | IMPLEMENTATION GAP |
| Completion | "✓ Complete Call & Send Message", `saveReport(id,true)` | Non-empty signature (only hard guard) | `report` replaced, `sig` set, `status:"Completed"`; conditionally Contract slot + Payment | Contract (conditionally), Payment (conditionally), Notification (always) | `["service_mgr","admin"]` always; `["finance"]` if Chargeable+amount>0; customer preview (`msgDone`/`msgPMdone`) | none | Contract-side `completePmVisitForContract()` already reproduces the exact `due[0]` quirk and is reusable; Payment creation logic not yet built as a reusable service call from ServiceCall's perspective | PARTIALLY COVERED (Contract side) / IMPLEMENTATION GAP (ServiceCall + Payment orchestration) |
| Chargeable payment creation | Inside completion, conditional | `stype==="Chargeable"&&amount>0` | New Payment record, `status:"Pending"` | Payment | `["finance"]` | none | `paymentService.createManualPayment` exists but is a general-purpose manual-payment path, not wired to ServiceCall completion | DOC GAP / IMPLEMENTATION GAP + DESIGN DECISION (atomicity, §26.8) |
| Customer messaging | Auto after registration/completion, or on-demand via 📩 buttons | Message preview shown regardless of phone; WhatsApp link only if phone present | none (no persisted state change) | none | none (this is the customer-facing side, distinct from internal Notification records) | message text templates (verbatim, §6/§16) | Not implemented; no messaging/preview UI exists in new-app yet (out of backend-only scope for this audit anyway) | NOT APPLICABLE to backend audit / DESIGN DECISION for eventual UI |
| Search/list/report | `vService()`/`openCallsPanel()`/`dlService()` | none | none (read-only) | none | none | CSV total, Client-Signed flag | Not implemented | IMPLEMENTATION GAP |

## 24. NEW APP gap analysis

Inspected only `new-app` (no modification made):

- **ServiceCall schema** (`new-app/backend/src/models/ServiceCall.js`): **PARTIALLY COVERED**. The schema exists and captures all 15 top-level PWA fields (renamed to backend conventions: `complaintNumber`↔`psc`, `engineerId`↔`eng`, `registeredDate`↔`regDate`, `clientSignatureImage`↔`sig`, `appointmentDate`/`appointmentTime`↔`date`/`time`, `complaintDescription`↔`complaint`) plus a `reportSchema` sub-document covering all 10 report fields (with `checklistResults` deliberately modeled as an unconstrained `Map<String,String>` rather than an enum of the six `SVC_CHK` keys, per its own inline comment — this is a reasonable, explicitly-justified design choice already made, not left ambiguous). No service/route/controller/test exists yet — confirmed by `find new-app -iname "*servicecall*"` returning only this one model file.
- **Contract exposure for ServiceCall's needs** (`contractService.js`/`Contract.js`): **COVERED** for the PM-slot-marking logic. `computePmDueIndexes()` and `completePmVisitForContract()` already exist, already exported for reuse, and `completePmVisitForContract()` already reproduces the exact `due[0]`-quirk documented in §12 verbatim (confirmed by direct read: `const due = computePmDueIndexes(contract); if (!due.length) return contract; ... setVisitCompleted(..., due[0], todayDate())`). A ServiceCall completion service can call this directly rather than re-implementing Contract-slot logic. Contract's own `originatingProjectId`-style field pattern (a lightweight cross-reference) is a precedent a ServiceCall↔Contract link could mirror if desired, but that is a design choice, not asserted as decided.
- **Payment service exposure** (`paymentService.js`/`Payment.js`): **PARTIALLY COVERED**. `createManualPayment` exists as a general entry point and the `Payment` schema already supports every field the PWA's Chargeable-Payment object needs (`projectOrReference`, `personName`, phone, amount, remark, status, `soNo`-equivalent, etc. — confirmed by the model's own field-mapping comment block). However, there is no ServiceCall-specific wiring (e.g. no existing helper that takes a completed ServiceCall and produces the exact `project:"<site> (PSC-<psc>)"`/`remark:"Chargeable service call"` shape) — that orchestration does not exist yet.
- **Notification infra**: **PARTIALLY COVERED**. The `Notification` model exists and already matches the PWA's role/`"*"`-targeting and append-only read-tracking shape exactly (confirmed by its own inline comments referencing `notify()`/`myNotifs()`). However, no reusable `notificationService.js` (or equivalent) was found — `contractService.js` itself contains no `Notification`-model calls, meaning even the already-built Contract module does not yet wire up notification-sending; this same gap would apply to ServiceCall.
- **Durable User IDs**: **COVERED**. `User.js` exists with a `role` enum from `shared/enums.js` (`ROLES`, matching the PWA's 11 roles exactly) and standard Mongoose ObjectId identity — a ServiceCall's `engineerId` field can already reference it as `new-app/backend/src/models/ServiceCall.js` already declares (`ref: 'User'`).
- **Reusable repository/sequence primitives**: **COVERED**. `new-app/backend/src/models/Counter.js` and `new-app/backend/src/db/counters.js` already implement a concurrency-safe, **per-company** atomic counter, with `'serviceCall'` already declared as one of exactly two `COUNTER_NAMES` (the other being `'salesOrder'`) — this is a ready-made, already-reasoned replacement for the PWA's non-atomic, cross-tenant `DB.seq.psc` pattern (§4), requiring no new schema work, only a route/service to call `getNextSequence(companyId, 'serviceCall')`.
- **Routes/controllers**: **MISSING**. No `serviceCallRoutes.js` exists (`routes/` contains only `authRoutes.js, companyRoutes.js, contractRoutes.js, enquiryRoutes.js, paymentRoutes.js, projectRoutes.js, salesOrderRoutes.js`); there is no `controllers/` directory at all in this codebase (route handlers appear to live directly in the route files or in the `services/*.js` files themselves, based on the pattern of `contractService.js`/`paymentService.js` both existing as the apparent business-logic layer with no separate controller layer).

## 25. Facts vs new-backend decisions

### (A) PWA FACTS
- All 15 top-level fields and their exact behaviors (§3).
- Separate, together-incremented `id`/`psc` counters; PSC scanned/recomputed globally, not per-tenant, in `syncSeq()` (§4).
- Exactly two `type` values, `"Complaint"`/`"PM"`, with the exact creation/status/notification/message differences in §5/§6.
- The single enforced creation validation (customer name non-blank) and the exact object literal built by `saveCall()` (§6).
- The exact assignment condition, candidate-pool roles, notification condition/text, and the name-string identity mechanism (§7/§19).
- The exact report sub-object shape, the six fixed `SVC_CHK` labels in their exact order, and their free-text (non-boolean) nature (§8/§9).
- The exact signature mandatory-at-completion-only rule and its storage as a raw base64 PNG data URI (§10).
- The exact completion-branch order of effects and the single enforced completion guard (signature non-empty) — and the explicit absence of every other conceivable guard (§11).
- The exact `due[0]` PM-slot-stamping quirk, verified precisely (§12).
- The exact Chargeable-Payment creation condition, fields, and hardcoded `remark` literal (§14).
- The complete notification catalogue with verbatim text (§15).
- The complete customer-message catalogue with verbatim text, and the preview/copy/WhatsApp-only nature of "sending" (§16).
- The exact list/search/CSV column sets and sort behavior (§17).
- The exact role-visibility matrix, all client-side only (§18).
- The cross-company `vCall()` lookup weakness, directly demonstrated (§20).
- The complete quirks/bugs catalogue (§21), each independently verified against source line numbers.

### (B) NEW BACKEND DESIGN DECISIONS / OPEN QUESTIONS
Per the task's explicit constraint, only the following already-approved infra-only adaptation categories are assumed available, and nothing broader:
- MongoDB / Mongoose document modeling (already used throughout `new-app`).
- Durable ObjectIds in place of PWA integer ids (already used: `_id`, `companyId`, `engineerId`, `contractId` as `ObjectId` refs in `ServiceCall.js`).
- Server-generated, concurrency-safe, per-company human-facing counters in place of `DB.seq.*` (already built: `Counter.js`/`counters.js`, with `'serviceCall'` already registered).
- Hashed passwords (applies to `User`, not directly to ServiceCall — noted for completeness only).
- Tenant isolation enforced server-side (directly required by the §20 finding — the PWA's own `vCall()` gap is the concrete justification, not a hypothetical).
- Server-side authorization matching the PWA's visible role intent (§18) — no broader, no narrower.
- Transaction/concurrency safety for multi-write sequences (ServiceCall completion + Contract slot update + Payment creation, §11/§14/§26.8/§26.9) — a safety wrapper around the *same* writes the PWA already performs, not a new business rule.
- Storage adaptation where required (e.g. the signature's base64 data URI — see §26.7 for whether it stays inline or moves to object storage; this is a storage-representation question, not a business-rule change).

No other schema/API "improvement" (e.g. inventing a delete/cancel workflow, inventing duplicate-PM-call prevention, inventing division filtering for ServiceCall engineers, inventing a stricter completion-guard set) is assumed authorized by this audit. Every such possibility is instead listed as an open decision below, for business review.

## 26. Final open-decision list

1. **Engineer identity mapping**: how to translate the PWA's `eng===U.name` string-equality ownership check into a durable `User` ObjectId reference (`ServiceCall.engineerId`, already scaffolded in the schema) while preserving identical visible ownership semantics for engineers viewing "their" calls.
2. **Division-scoping of ServiceCall engineer candidates**: whether the new backend should introduce division filtering for the `service_eng`/`engineer`/`service_mgr` candidate pool (the PWA has none — §19) or deliberately preserve the PWA's company-wide, non-division-filtered pool.
3. **Direct ServiceCall detail access / tenant scoping**: how the new backend's get-by-id endpoint enforces company scoping (mandatory, per §20's directly-demonstrated PWA gap) — specifically, what error/behavior results for a cross-tenant id (404 vs 403, etc.) is not specified by the PWA and needs a decision.
4. **Completed ServiceCall editability**: the PWA UI hides the edit form once Completed, but the underlying `saveReport()` function has no `status==="Completed"` guard (§11/§21.15) — whether the new backend should add a genuine server-side lock against re-completion/re-editing (recommended, but a decision, not assumed).
5. **Deletion/cancellation semantics**: no PWA action exists for deleting, cancelling, or reopening a ServiceCall (§21.21, verified absent) — whether the new backend should introduce any such action is entirely open; this audit records only that nothing analogous exists to preserve.
6. **Report/signature storage strategy**: whether `report` stays a single nested subdocument (as currently schemed) or evolves a draft-history/versioning model beyond the PWA's overwrite-in-place behavior (§8).
7. **Large/base64 signature storage adaptation**: whether `clientSignatureImage` (currently a plain `String` in the schema, mirroring the PWA's raw data-URI approach) should instead move to a dedicated object-storage reference for size/performance reasons — a storage-representation question only, not a business-rule change.
8. **Chargeable Payment atomicity/idempotency**: how to guarantee the ServiceCall-completion + Contract-slot-update + Payment-creation sequence either fully succeeds or fully rolls back, and how to prevent a duplicate Payment if the completion request is retried (§11/§14).
9. **PM due-slot stamping and concurrency**: whether the new backend preserves the PWA's exact `due[0]`-at-completion-time quirk (already replicated in `contractService.js`'s `completePmVisitForContract`, confirmed) as-is for behavioral parity, or whether this specific quirk should be raised to business stakeholders as a candidate for correction before ServiceCall is built on top of it (§12/§21.16) — this audit takes no position, only flags it.
10. **Notification idempotency on repeated requests**: whether the new backend should dedupe assignment/completion notifications when the same action is retried or resubmitted (the PWA has no such dedup at all, §7/§15/§21.8).
11. **Reverse Payment reference on ServiceCall**: the PWA never stores a Payment id back on the ServiceCall record (the link is one-directional, text-only, from Payment→ServiceCall via the `project` free-text field) — whether the new backend should add a genuine `paymentId` field on `ServiceCall` for referential integrity is open.
12. **Customer-message delivery**: whether the new backend/eventual UI should remain a preview+copy/WhatsApp-handoff pattern exactly like the PWA (§16), or whether a genuine SMS/email/WhatsApp-API integration is now in scope — the PWA gives zero evidence of real delivery, so this is a green-field product decision, not something to infer from source.
13. **`report.checklistResults` key strictness**: the schema already models this as an unconstrained `Map<String,String>` rather than an enum of the six `SVC_CHK` labels (already decided in the model's own comment) — whether that remains correct once ServiceCall's actual service/validation layer is built, or whether the six keys should be enforced at the service layer even though the PWA itself enforces nothing here, is worth re-confirming with the team building on top of this schema.

## 27. Implementation readiness assessment

| Finding | Classification |
|---|---|
| 15-field entity shape, verified complete | COVERED (schema) |
| Separate id/psc counters + non-atomic client-side generation | PWA QUIRK-BUG → COVERED by infra design (`Counter.js`/`getNextSequence`) |
| Global (non-per-tenant) PSC scan in PWA | PWA QUIRK-BUG (already narrowed correctly to per-company in new schema's Counter design) |
| Two `type` values and their exact creation/status/notification differences | DOC GAP (documented here; no service implements it yet) |
| Complaint/PM creation validation (customer-name-only) | IMPLEMENTATION GAP |
| Assignment workflow, name-string identity, no-division-filter pool | IMPLEMENTATION GAP + DESIGN DECISION (§26.1/§26.2) |
| Report/checklist model, free-text checklist values | COVERED (schema) / IMPLEMENTATION GAP (service logic) |
| Signature mandatory-at-completion rule | DOC GAP (rule documented; not yet enforced by any service code) |
| Completion order-of-effects and sole enforced guard | IMPLEMENTATION GAP |
| PM due-slot `due[0]` stamping quirk | PWA QUIRK-BUG, already faithfully replicated in `contractService.completePmVisitForContract` — DESIGN DECISION open on whether to keep it (§26.9) |
| No reverse Contract→ServiceCall list | NOT APPLICABLE (PWA does not have this; nothing to implement unless a future decision adds it) |
| Chargeable Payment creation condition/fields | SCHEMA GAP (Payment schema supports the fields; no ServiceCall-specific orchestration exists) — see §26.8 |
| Complete notification catalogue | SCHEMA GAP (Notification model exists; no notificationService/wiring exists anywhere yet, including in already-built Contract/Payment modules) |
| Customer message templates + preview-only delivery | DESIGN DECISION (§26.12) — no backend implementation implied by the PWA beyond text templates to reuse verbatim if desired |
| List/search/CSV export behavior | IMPLEMENTATION GAP |
| Role/access matrix | DOC GAP (documented; server-side enforcement not yet implemented) |
| Engineer candidate pool (3 roles, no division filter) | DOC GAP |
| Cross-company `vCall()` detail-access weakness | PWA QUIRK-BUG — MANDATORY infra fix for new backend (tenant scoping), not optional (§20/§25B) |
| Absence of delete/cancel/reopen | NOT APPLICABLE (confirmed absent in PWA; no implementation implied) |
| Durable User id availability for `engineerId` | COVERED (`User.js` already supports this) |
| Reusable Contract PM-slot-completion logic | COVERED (`completePmVisitForContract`, already faithful to the PWA quirk) |
| Routes/controllers for ServiceCall | IMPLEMENTATION GAP (none exist) |
