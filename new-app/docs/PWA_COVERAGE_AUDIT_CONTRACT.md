# PWA Coverage Audit — Contract (AMC / Warranty)

## 1. Scope / Source

- **Read-only audit.** No implementation. This document is the ONLY new file this task creates.
- **Primary/authoritative source:** `MEP_PROJECTS_PWA/index.html` (the PWA), read directly with `grep -n`/`sed -n` — every claim below is traced to a literal line/function in that file, not to memory or to the new-app implementation.
- **Ignored as V2-connection-patch infrastructure** (per task instruction — not business logic): `API_BASE`, `TOKEN`, `SOCKET`, `API_MODE`, `fetch()`, `api()`, `fromV2Contract`, `legacyOf`, `serverRef`/`localRef`, `normalizeLegacyRefs`, the `contracts:{meta:true,...}` legacy sync-field-mapping block, and the `svcMonths` translation layer. These exist solely to bridge the PWA's local array-store to a V2 server and carry no Contract business rules of their own.
- **Comparison-only sources** (never modified, read only for gap analysis): `new-app/docs/DOMAIN_MODEL.md`, `new-app/docs/DATABASE_SCHEMA.md`, `new-app/docs/OPEN_DECISIONS.md`, `new-app/docs/PWA_COVERAGE_AUDIT_PROJECT.md`, `new-app/backend/src/models/Contract.js`, `new-app/backend/src/models/Project.js`, `new-app/backend/src/models/ServiceCall.js`, `new-app/backend/src/models/Notification.js`, `new-app/backend/src/services/projectService.js`.
- **Finding of note before starting:** the new-app repository already contains a `Contract.js` model, a `ServiceCall.js` model, and substantial Contract/ServiceCall documentation in `DOMAIN_MODEL.md`/`DATABASE_SCHEMA.md`/`OPEN_DECISIONS.md` (items #7, #33, #34) from the prior Project Execution audit's own research. This audit independently re-derived every fact from the literal PWA source per instruction, and cross-checks its own findings against those existing documents in §22-23 rather than assuming them correct. In every case checked, the existing documents' Contract-related facts matched the literal PWA source — with one exception noted in §9/§22 (DATABASE_SCHEMA.md's Contract lifecycle line says "created → **edited** → no delete observed", but no Contract-edit function of any kind exists in the PWA — only the fully-automatic `done` stamp on a `scheduledVisits[]` entry when a linked ServiceCall completes; see §9).

## 2. PWA Assumptions

- The whole `Contract` entity lives in the in-memory `DB.contracts` array (seeded, then mutated only via `save()` which persists the whole `DB` object to `localStorage`/the V2 patch's sync layer — irrelevant to business rules).
- There is no server in the PWA itself; every "permission" is a client-side rendering decision (menu visibility, an inline button ternary) unless stated otherwise. Function-level (in-code) role checks are called out explicitly wherever they exist; their absence is called out explicitly wherever a UI gate exists without one.
- Divisions (`HVAC`/`Solar`/`MEP`) do not appear anywhere in the Contract entity or its screens — Contract/AMC/PM is **not** division-scoped in the PWA.

## 3. Exact Contract Entity Inventory

Traced to the seed data (`MEP_PROJECTS_PWA/index.html` lines 329-338), `convertToService()` (line ~2732), and `saveContract()` (line ~3758).

| Field | Type / Shape | Required? | Default | Create Source | Update Source | Read Usage | Notes |
|---|---|---|---|---|---|---|---|
| `id` | Number | required | `++DB.seq.contract` | both creation paths | never | primary key throughout, `DB.contracts.find(x=>x.id===...)` | system-generated, immutable |
| `co` | Number (company id) | required | `U.co` (current user's company) | both | never | tenant scoping via `mine()` | system-generated, immutable |
| `customer` | String | optional (no PWA validation) | `p.customer\|\|p.name` (project path) / `gv("ct_n")` (manual, can be empty string) | both | never (no edit fn) | list/search/CSV/PM-call prefill | user-entered on manual path; copied from Project on conversion |
| `phone` | String | optional | **hardcoded `""`** (project path, always blank regardless of SO contact data) / `gv("ct_p")` (manual) | both | never | search, PM-call prefill, WhatsApp/SMS-preview `msgPM`/`msgPMdone` | **quirk**, see §3/§18 |
| `email` | String | optional | **hardcoded `""`** (project path) / `gv("ct_e")` (manual) | both | never | list display only (`<div class="subtle">`) | never used to send anything — no email-sending code path exists for AMC |
| `site` | String | optional (no client-side "required" enforced at code level despite `<label>Site Name</label>`) | `p.name` (project path) / `gv("ct_s")` (manual) | both | never | primary display key everywhere (list, PM-due panel, renewal panel, CSV); pre-fills `mCall()`'s `sc_s` | `saveContract()` DOES enforce non-empty site client-side: `if(!gv("ct_s")){toast("Site name required");return}` — this is the ONLY required-field check in either creation path |
| `cap` | String (free text, e.g. `"12"`, `"200"`) | optional | `p.cap` (project) / `gv("ct_c")` (manual) | both | never | display column ("Cap.") only, not used in any calculation | capacity label, never parsed numerically |
| `start` | String `"YYYY-MM-DD"` | required (implicitly — used to compute `end` and `svcs`) | `today()` (project path) / `gv("ct_sd")\|\|today()` (manual, date input defaults to today in the modal) | both | never | seeds `svcs[]` generation; displayed | plain ISO date string, no Date-object storage |
| `end` | String `"YYYY-MM-DD"` | required | computed: `start + 1 year - 1 day` (project path, hardcoded 1-year warranty) / raw `gv("ct_ed")` — **no default and no validation** (manual path: can be left blank, saved as `""`) | both | never | drives `contractStatus()` (Active/Expiring Soon/Expired) | **quirk**: manual-AMC `end` can be an empty string; `contractStatus()` then compares `""` against dates — see §6/§18 |
| `amcType` | String enum-by-convention: `"Quarterly"` \| `"Half-Yearly"` \| `"Monthly"` | required (select, defaults to first option `Quarterly`) | `"Quarterly"` (project path, hardcoded) / `gv("ct_t")` (manual select, default `Quarterly`) | both | never | drives visit-schedule cadence (§5); displayed in list/CSV as "Type" | Not a true enum at the code level — any other string value would fall into the schedule generator's `else` branch (behaves as Quarterly); the PWA itself never produces any other value since it's a fixed `<select>` |
| `cat` | String enum-by-convention: `"AMC"` \| `"Warranty"` | required (select, defaults to `AMC` in manual modal) | `"Warranty"` (project path, hardcoded) / `gv("ct_cat")` (manual select, default `AMC`) | both | never | badge color (`b-blu` for AMC, `b-prp` otherwise), renewal-opportunities framing ("Warranty → paid AMC") | Purely a display/labeling field with no downstream calculation difference from `amcType`/`amount` (see §4) |
| `amount` | Number | optional | `0` (project path, hardcoded) / `Number(gv("ct_a"))\|\|0` (manual) | both | never | displayed via `money()`; summed in CSV total; summed in `coStats()`/`vUsage()` cross-company usage report | **never flows into `DB.payments`** anywhere (see §17) |
| `svcs` | Array of `{m: String "YYYY-MM", done: String "" or "YYYY-MM-DD"}` | required (generated, always non-empty) | generated at creation (see §5) | both (generation only) | `svcs[i].done` is the ONLY field of any Contract ever mutated post-creation — set by `saveReport()` when a linked PM-type ServiceCall is completed (line ~3698-3699) | see §5, §9, §10, §18 for full mechanics | embedded array, `_id`-less objects |
| `fromProject` | Number (Project id) \| `undefined` | optional | `p.id` (project path only) | manual path never sets it (field is simply absent/`undefined`, not `null` or `0`) | never | powers nothing in the PWA's own UI beyond the raw stored value (no "view originating project" link is rendered from a Contract) | see §16 |

**Hidden/internal fields:** none beyond the V2-patch's own sync scaffolding (`legacy`/`svcMonths` translation), which is explicitly out of scope per the task's ground rules. No Contract field is ever marked internal-only or stripped from any read path.

**Immutable/mutable summary:** `id`/`co` are immutable by construction (no field ever reassigns them). `customer`/`phone`/`email`/`site`/`cap`/`start`/`end`/`amcType`/`cat`/`amount`/`fromProject` are all "mutable" only in the theoretical sense that JS objects can be reassigned — **the PWA contains zero UI or function that edits any of them after creation.** The only field actually mutated post-creation by any PWA code path is `svcs[i].done`.

**System-generated vs. user-entered:** `id`, `co` = system-generated. `phone`/`email`/`amcType`/`cat`/`amount`/`start`/`end`/`fromProject` = system-generated on the Project-conversion path (hardcoded/derived), user-entered on the manual path. `customer`/`site`/`cap` = user-entered on the manual path, copied (not re-entered) on the conversion path. `svcs[]` = always system-generated (never user-entered, never user-editable as a whole array); `svcs[i].done` = system-set (stamped `today()`), never user-entered as a date picker.

**Formatting:** dates stored as plain ISO `"YYYY-MM-DD"` strings (no Date objects); `svcs[i].m` stored as `"YYYY-MM"` (month-only, no day); currency displayed via `money()` = `"₹ " + n.toLocaleString("en-IN",{maximumFractionDigits:0})`, treating falsy amounts (0, `""`, `null`) as blank display.

## 4. All Contract Creation Paths

Exactly **two** creation paths exist in the entire PWA. No third path (no bulk import, no API-only creation visible in-app, no "duplicate contract" action) was found.

### Path A — `convertToService(id)` (Project → Contract, "Commissioning approval")
- **UI trigger:** a single button rendered inside `vProject()` (line ~2195): `<button class="btn grn" onclick="convertToService('+p.id+')">Approve Commissioning → Convert to Service (1 yr warranty)</button>` — rendered **only** when `p.status==="Completed" && p.div!=="MEP"` (the "conversion banner" block, line ~2194).
- **Role gate (UI-only):** the button itself is only rendered when `U.role==="service_mgr"||U.role==="admin"`; otherwise the banner shows a disabled-looking subtle message ("Awaiting Service Manager / Admin approval.").
- **Function-level check:** **none.** `convertToService(id)` (line 2732) performs **zero** role check, **zero** status/eligibility re-check (does not re-verify `p.status==="Completed"` or `p.div!=="MEP"` inside the function itself) — any authenticated user of any role, calling `convertToService(<id>)` directly from the browser console, can convert any project in their own company regardless of its actual stage/status/division. This is a PWA QUIRK-BUG (UI-only protection), consistent with the pattern already documented for other entities in `OPEN_DECISIONS.md` #22.
- **Prerequisites (as rendered, not as enforced in code):** Project `status==="Completed"` and `div!=="MEP"`.
- **Field defaults/mappings:**
  - `customer` = `p.customer||p.name`
  - `phone` = `""` (hardcoded — see §18 quirk)
  - `email` = `""` (hardcoded — see §18 quirk)
  - `site` = `p.name`
  - `cap` = `p.cap`
  - `start` = `today()`
  - `end` = `today() + 1 year - 1 day` (`new Date();end.setFullYear(+1);end.setDate(-1)`)
  - `amcType` = `"Quarterly"` (hardcoded — always 4-visit cadence regardless of project division/capacity/value)
  - `cat` = `"Warranty"` (hardcoded)
  - `amount` = `0` (hardcoded — a warranty contract is never billed)
  - `svcs` = 4 entries, 3 months apart, starting this month (see §5)
  - `fromProject` = `p.id`
- **Generated values:** `DB.seq.contract++` then push; no PSC/display number generated for the Contract itself.
- **Schedule generation:** always exactly 4 quarterly visits, regardless of `amcType` being hardcoded to `"Quarterly"` (consistent with §5's Quarterly rule).
- **Notifications:** `notify(["service_mgr","admin"], "Commissioning approved: \""+p.name+"\" converted to Service project — 1 year warranty, quarterly PM scheduled.")` — fires to `service_mgr`+`admin` roles only, regardless of who actually clicked the button.
- **Project changes:** `p.status="In Service"` (no re-check of prior status; can be called on a project not currently `"Completed"` since there's no guard, per the "no function-level check" finding above).
- **ServiceCall implications:** **none created directly.** No ServiceCall is spawned by conversion itself — PM ServiceCalls are only created later, on-demand, from the PM-due panel (`mCall(contractId)` → `saveCall(contractId)`).

### Path B — `saveContract()` (manual AMC/Warranty creation)
- **UI trigger:** `+ Add Contract` button in `vPM()` (the AMC/Warranty Contracts panel) → opens `mContract()` modal → `Save` button → `saveContract()`.
- **Role gate (UI-only):** the `pmlist` menu entry (which is the only way to reach `vPM()` through normal navigation) is present only for `admin` and `service_mgr` in `MENUS` (line ~1298).
- **Function-level check:** **none.** `saveContract()` performs no role check at all — same UI-only-protection pattern as Path A. `nav('pmlist')` itself also performs no role check (see §13).
- **Prerequisites:** none beyond the one client-side validation: non-empty `site` (`gv("ct_s")`), else `toast("Site name required")` and abort. No other field is validated (a fully blank customer/phone/dates/amount is accepted).
- **Field defaults/mappings:** all nine editable fields are taken directly from the modal's inputs (`ct_n`,`ct_p`,`ct_e`,`ct_s`,`ct_c`,`ct_sd`,`ct_ed`,`ct_t`,`ct_cat`,`ct_a`) with `start` falling back to `today()` if blank and `amount` falling back to `0` if non-numeric. `end` has **no fallback** — it is stored as whatever `gv("ct_ed")` returns, including `""` if the user never picked an end date.
- **Generated values:** `DB.seq.contract++` then push.
- **Schedule generation:** depends on the selected `amcType` (see §5); computed from the chosen `start`, not from `today()`.
- **Notifications:** **none.** `saveContract()` contains no `notify()` call whatsoever — unlike Path A, no one is notified when a manual AMC/Warranty contract is created. This is an asymmetry between the two creation paths (PWA FACT, not fixed).
- **Project changes:** none — `fromProject` is simply never set (stays `undefined`), and no Project record is touched.
- **ServiceCall implications:** none created directly, same as Path A.

**No other creation path exists.** There is no "duplicate this contract to renew it" action, no batch-import, and no separate "warranty creation" UI distinct from the two above (the manual modal's `Category` select just happens to also offer `Warranty` as an option alongside `AMC` — it is the same function/fields as a manual AMC, differing only in the `cat` value the user picks and in nothing else).

## 5. PM Service Schedule (`svcs[]` generation)

Two independent generator code paths exist (both produce the same `{m,done:""}` shape), traced line-by-line:

**Path A generator (`convertToService`, always Quarterly/4-visit, hardcoded):**
```
var svcs=[];for(var q=0;q<4;q++){var d=new Date();d.setMonth(d.getMonth()+q*3);svcs.push({m:d.toISOString().slice(0,7),done:""})}
```
- Always exactly 4 entries.
- Always 3 months apart.
- Always anchored to `new Date()` (today, at generation time) — **not** to the Contract's own `start` field (which is also `today()` in this path, so they coincide, but the generator does not read `start` at all).

**Path B generator (`saveContract`, driven by the selected `amcType`):**
```
var n = amcType==="Monthly" ? 12 : amcType==="Half-Yearly" ? 2 : 4;
var step = amcType==="Monthly" ? 1 : amcType==="Half-Yearly" ? 6 : 3;
var svcs=[]; for(i=0;i<n;i++){ d=new Date(base); d.setMonth(d.getMonth()+i*step); svcs.push({m:d.toISOString().slice(0,7),done:""}) }
```
where `base = new Date(sd)` and `sd = gv("ct_sd")||today()` (the Contract's own `start`).

**Re-verified cadence table (literal, per task instruction to re-verify rather than assume):**

| `amcType` | Visit count (`n`) | Interval (`step`) | Task's assumed cadence | Actual PWA cadence |
|---|---|---|---|---|
| `Monthly` | 12 | 1 month | "12 visits / 1 month" | **Matches**: 12 visits, 1 month apart |
| `Half-Yearly` | 2 | 6 months | "6 visits / 6 months" | **Does NOT match** — actual is **2 visits, 6 months apart** (i.e. exactly 1 year of coverage, visit at month 0 and month 6) |
| `Quarterly` (also the fallback/default for any other/unrecognized `amcType` value, and the value hardcoded by Path A) | 4 | 3 months | "4 visits / 3 months" | **Matches**: 4 visits, 3 months apart |

This is documented as a **PWA FACT** that the task prompt's own working assumption ("6 visits/6 months") was incorrect for `Half-Yearly` — the existing `DOMAIN_MODEL.md`/`DATABASE_SCHEMA.md` already state the correct 2-visit rule (independently corroborated during this audit, not merely copied).

- **Visit dates/months:** each `svcs[i].m` is a `"YYYY-MM"` string (day-of-month is discarded — `toISOString().slice(0,7)`); there is no `svcs[i].d` day field anywhere.
- **Done/due/overdue state:** `svcs[i].done` starts as `""` (falsy) at generation and is the sole indicator of completion — see §6/§10.
- **Schedule editing/regeneration:** **does not exist.** Once generated, `svcs[]` is never regenerated, resized, or reordered by any PWA function. There is no "add a visit" / "remove a visit" / "change cadence after creation" UI or function.
- **Visit deletion/addition:** not supported (confirmed absent — no `svcs.splice`/`svcs.push` call exists anywhere outside the two generators above).
- **Relationship to ServiceCall:** a `svcs[i]` entry is never itself a ServiceCall — it only becomes a real ServiceCall record when staff explicitly click "Schedule PM" from the PM-due panel (`mCall(contractId)`), at which point a brand-new `svcCalls` row (`type:"PM"`, `contractId:contractId`) is created (see §7). Multiple ServiceCalls could in principle be created against the same due `svcs[i]` slot (nothing prevents clicking "Schedule PM" twice), but completing any one of them only stamps the **first currently-due** slot (`pmDue(c)[0]`), not a specific slot tied to that particular ServiceCall — see §7/§10/§18 for the resulting quirk.

## 6. PM Due / Expiring Logic

Two pure functions carry all of this logic (`MEP_PROJECTS_PWA/index.html` lines 1434-1444):

```
function pmDue(c){ var out=[]; var tm=thisMonth();
 c.svcs.forEach(function(s,i){if(!s.done&&s.m<=tm)out.push(i)});
 return out; }
function contractStatus(c){
 var t=today();
 if(c.end<t)return"Expired";
 var d=new Date(c.end); d.setDate(d.getDate()-45);
 if(new Date(t)>=d)return"Expiring Soon";
 return"Active"; }
```
where `today()="new Date().toISOString().slice(0,10)"` and `thisMonth()="new Date().toISOString().slice(0,7)"` (both wall-clock local-to-UTC via `toISOString`, i.e. driven by the browser's UTC-converted date — a timezone-dependent boundary, not corrected for the user's own local timezone in either function).

**Re-verified literally, per task instruction:**
- **`pmDue(c)`**: a visit index `i` is "due" iff `!s.done` (not yet completed) **AND** `s.m <= tm` (string comparison of `"YYYY-MM"` against the current `"YYYY-MM"`) — confirms the task's stated rule ("PM due = not done AND month <= current month") exactly, including that a **future**-month visit is never "due" and a **past** uncompleted month stays due indefinitely (there is no upper bound / no "too late, drop it" logic — see overdue below).
- **`contractStatus(c)`**: confirms the task's stated rule ("Expiring Soon = 45-day threshold") exactly — `d = end - 45 days`; if `today >= d` (and `end >= today`, i.e. not already Expired), status is `"Expiring Soon"`.

**Additional literal behaviors, re-verified rather than assumed:**
- **Current-month visit:** a visit dated the current month and not yet done is due (`s.m <= tm` includes equality).
- **Future-month visit:** never due; displayed in the AMC list as a plain (non-highlighted) month.
- **Expired contract:** `pmDue()` is computed independently of `contractStatus()` — an Expired contract's still-not-done past-month visits **remain "due"** in `pmDue()`/the PM-due panel forever (no code excludes Expired contracts from the due-visit scan). This is a PWA FACT/quirk: an expired AMC can still show up on the "PM Due" dashboard panel.
- **Overdue vs. due distinction:** `pmDue()` itself makes no due/overdue distinction — both the PM-due panel (`pmDuePanel()`) and the AMC list separately re-derive "overdue" for display as `s.m < thisMonth()` (strictly earlier month than the current one), while a due visit whose month equals the current month is displayed as "due" but not "(overdue)". This overdue/due split exists **only** in the rendering layer, not in `pmDue()`'s own return value (which lumps both together as one array of indexes).
- **Completed-visit behavior:** once `s.done` is truthy (any non-empty string), that index is permanently excluded from `pmDue()`, regardless of month — a completed visit never becomes "due" again even if its own month recurs in a future year (moot in practice since months are absolute `"YYYY-MM"` strings, never reused).
- **Partial-schedule behavior:** if a contract's `svcs[]` array is shorter than the AMC list's fixed 4-column display (`vPM()`'s table always renders 4 visit columns, padding with `<td>-</td>` via `for(var k=c.svcs.length;k<4;k++)`), the pad cells show `-`; this matters for `Half-Yearly` (2 entries) and any contract with fewer than 4 visits — a `Monthly` contract's 12 entries are **not** all shown (the table structurally only has 4 visit `<th>` columns, so entries 5-12 are simply never rendered in this table at all — see §15/§18 quirk).
- **Yearly-rollover behavior:** since months are absolute `"YYYY-MM"` strings (not month-of-year), there is no rollover ambiguity within `pmDue()`/`contractStatus()` themselves — a schedule generated in November 2025 with a 3-month step correctly produces `2025-11, 2026-02, 2026-05, 2026-08` (verified against the seed data, e.g. contract id 6: `2025-10,2026-01,2026-04,2026-07`).
- **Timezone/date-assumption:** all date math uses `new Date()`/`toISOString()` in the browser's local execution context converted to UTC — a user in a timezone where local "today" and UTC "today" differ near midnight could see `pmDue()`/`contractStatus()` boundary behavior shift by a day; this is a PWA-wide pattern (not unique to Contract) and is not corrected anywhere.

## 7. Contract → ServiceCall Relationship

- **Contract does NOT store any ServiceCall ids/references.** There is no `svcCallIds[]` or similar array on the Contract entity — confirmed absent from both creation paths and the full seed data.
- **ServiceCall DOES store a Contract reference:** `contractId` (Number, the Contract's `id`) — set only for `type:"PM"` calls created via `mCall(contractId)`→`saveCall(contractId)`; `0` (falsy) for a `type:"Complaint"` call (register-complaint path, `contractId` omitted → defaults to `0` at push time: `contractId:contractId||0`).
- **Relationship direction: one-way only**, ServiceCall → Contract. Contract has no reverse/back-reference and no derived "service history" array — the PWA reconstructs any "this contract's service calls" view on demand by filtering `DB.svcCalls` for matching `contractId`, but the only place this actually happens is the completion side-effect (`saveReport`, see below) — there is no "Service History" panel/tab on the Contract's own display anywhere in `vPM()`.
- **PM visit generation → ServiceCall creation:** `mCall(contractId)` opens a modal pre-filled with the contract's `customer`/`phone`/`site`; `saveCall(contractId)` then creates a new `svcCalls` row with `type:"PM"`, `status:"Scheduled"`, `contractId:contractId`, and the entered appointment date/time. This is the **only** way a PM-type ServiceCall is created from a Contract; it is entirely staff-initiated (from the PM-due panel's "Schedule PM" button), never automatic.
- **Complaint registration:** entirely independent of Contract — `mCall()` (no `contractId` argument) opens the "Register Service Complaint" variant of the same modal; the resulting ServiceCall has `contractId:0`, `type:"Complaint"`.
- **ServiceCall-from-PM-visit → completion marking:** in `saveReport(id, complete=true)` (line ~3691-3699):
  ```
  if(s.contractId){
   var c=DB.contracts.find(function(x){return x.id===s.contractId});
   if(c){var due=pmDue(c); if(due.length) c.svcs[due[0]].done=today()}
  }
  ```
  This is the **entire** completion-linkage mechanism: on completing ANY ServiceCall that has a truthy `contractId`, the code re-computes `pmDue(c)` fresh (not tied to which specific `svcs[i]` this ServiceCall was originally scheduled against) and stamps the **first currently-due index** (`due[0]`) as done — see §10/§18 for the resulting quirk when multiple visits are simultaneously due or multiple ServiceCalls exist against the same contract.
- **Contract service history:** not persisted as a structured field on Contract; only the raw `svcs[].done` date stamps constitute "history," and the underlying ServiceCall rows that produced those stamps are never linked back from the Contract side.
- **Display numbers vs. internal ids:** ServiceCall has a genuine display sequence (`psc`, e.g. "PSC-401"); Contract has **no display sequence at all** — it is referenced everywhere only by its raw internal `id` (in `contractId` fields) or by customer/site name in the UI, never by a human-facing contract number.

## 8. Manual AMC Creation

(Fully detailed in §4 Path B; summarized here per the task's explicit "distinguish from Project-commissioning conversion" requirement.)

| | Manual AMC/Warranty (`saveContract`) | Project-commissioning conversion (`convertToService`) |
|---|---|---|
| Who can create (UI) | admin, service_mgr (via `pmlist` menu) | admin, service_mgr (via the completed-project banner) |
| Who can create (function-level) | anyone (no check) | anyone (no check) |
| Customer/contact/site | fully user-entered | copied from Project (`customer`, `site`←`p.name`); `phone`/`email` hardcoded blank |
| Amount | user-entered, defaults `0` | always `0` (hardcoded) |
| Type (`amcType`) | user-selected (Monthly/Quarterly/Half-Yearly) | always `Quarterly` (hardcoded) |
| Category (`cat`) | user-selected (AMC/Warranty) | always `Warranty` (hardcoded) |
| Service frequency / schedule | driven by selected `amcType` (12/2/4 visits — §5) | always 4 quarterly visits |
| Date calculations | `start`=user-entered (default today); `end`=raw user input, **no computed fallback** | `start`=today; `end`=today+1yr−1day (computed) |
| Notifications | **none** | `notify(["service_mgr","admin"], ...)` |
| Edit/delete after creation | **none exists for either path** — no edit, no delete | **none exists for either path** — no edit, no delete |

## 9. Contract Editing

**There is no Contract-edit function anywhere in the PWA.** Verified by exhaustive search: no `editContract`/`mEditContract`/`updateContract` function exists; the input-id set used by the "Add Contract" modal (`ct_n`,`ct_p`,`ct_e`,`ct_s`,`ct_c`,`ct_sd`,`ct_ed`,`ct_t`,`ct_cat`,`ct_a`) is referenced by exactly one modal-builder (`mContract()`) and one saver (`saveContract()`), both of which always create a brand-new row (`DB.seq.contract++; DB.contracts.push(...)`) — never look up or mutate an existing contract by id.

- **Editable fields:** effectively none, by any UI path, for `customer`/`phone`/`email`/`site`/`cap`/`start`/`end`/`amcType`/`cat`/`amount`.
- **The only field ever mutated post-creation:** `svcs[i].done`, and only indirectly, as an automatic side-effect of completing a linked PM ServiceCall (§7/§10) — there is no direct "mark this visit done" button/toggle on the Contract's own display; completion only happens through the ServiceCall completion flow.
- **Amount/AMC-type/category/date changes:** not supported once created, for either creation path.
- **Customer/contact changes:** not supported once created.
- **Project relationship:** `fromProject` is set once at conversion time and never subsequently read/written by any other function (no "re-link to a different project" action exists).
- **ServiceCall effects:** none beyond the completion stamp described in §7/§10.
- **Notifications:** none tied to "editing" a Contract, since editing does not exist.
- **Discrepancy with existing new-app docs (flagged, not corrected):** `DATABASE_SCHEMA.md` §7 states the Contract lifecycle as "created (manual or auto) → **edited** → no delete observed." This audit's independent, literal trace of the PWA source found **no edit capability of any kind** — only the fully-automatic `svcs[i].done` stamp described above, which is not a user-initiated "edit" in the sense the rest of that document uses the word (compare to, e.g., its own Payment section's genuine part-payment edit UI). This is recorded as a **DOC GAP** for a future documentation pass, not silently corrected here.

## 10. Service Visit Completion

- **Who can mark done:** effectively, whoever can complete the linked ServiceCall — `vCall()`'s report-editing section is shown to `isEng||isMgr` where `isEng = s.eng===U.name` (the assigned engineer) and `isMgr = U.role==="service_mgr"||U.role==="admin"`. There is no separate/direct "mark PM visit done" affordance on the Contract's own screen.
- **Date behavior:** `svcs[due[0]].done` is stamped `today()` (the moment of completion) — never the ServiceCall's own scheduled `appointmentDate`, and never user-editable/back-datable.
- **Notes:** the ServiceCall's own `report` object (make/model/capacity/type/materialUsed/serviceDescription/checklistResults/serviceType/amount/engineerRemark/customerRemark) is richly captured **on the ServiceCall**, but **none of it is copied onto the Contract** — the Contract only ever receives the bare `done` date stamp. Per task instruction, this audit does **not** invent a "service report at Contract level" since the PWA does not persist one there.
- **Service-call linkage:** as described in §7 — the completion handler looks up the Contract by `s.contractId`, re-computes `pmDue(c)`, and stamps `svcs[due[0]].done` (the first currently-due index by array order, not necessarily the index this particular ServiceCall was scheduled against).
- **Notifications on completion:**
  - If the underlying report is `stype==="Chargeable"` and `amount>0`: a new `payments` row is created and `notify(["finance"], "Chargeable service PSC-"+psc+" completed — "+money(amount)+" to collect from "+customer)` fires — but this is a general ServiceCall-completion notification, **not specific to a PM visit** (a `type:"PM"` call's report `stype` defaults to `"AMC"`, not `"Chargeable"`, so this branch is realistically only hit by non-PM/complaint calls, or a PM call whose engineer manually changed `stype` to `Chargeable`).
  - Always: `notify(["service_mgr","admin"], "PSC-"+psc+" completed by "+(eng||U.name)+" — "+customer)`.
  - A customer-facing message preview (`msgPMdone`/`msgDone`) is shown via `showMsg()` with a WhatsApp deep-link — manual, staff-triggered, not automated (consistent with `OPEN_DECISIONS.md` #11).
- **Next PM due:** automatically re-derives on next render of `pmDue(c)` (no separate "next due date" field is stored — it's always recomputed from `svcs[]`).
- **Contract status effect:** none — `contractStatus(c)` depends only on `end`, never on `svcs[]` completion state, so completing every visit does **not** change a Contract's Active/Expiring/Expired status.

## 11. Contract Status

- **Exact values:** `"Active"`, `"Expiring Soon"`, `"Expired"` — only these three strings are ever produced by `contractStatus(c)` (see §6 for the exact algorithm).
- **Distinguished from individual service-visit status:** a visit's own state is derived per-index by `pmDue(c)` (due/not-due) plus the rendering-layer overdue check (`s.m<thisMonth()`) — entirely separate from `contractStatus()`. A Contract can simultaneously be `"Active"` (far from its end date) while having overdue PM visits, or be `"Expired"` while still showing due/overdue visits in the PM-due panel (§6).
- **Distinguished from ServiceCall status:** ServiceCall has its own independent status enum (`Registered`/`Assigned`/`Scheduled`/`Completed`) that is never read by `contractStatus()` and never written by it.
- **"Completed-schedule-state":** the PWA has no explicit concept of "this contract's whole schedule is fully done" — `pmDue(c)` simply returns `[]` once every visit is marked done (for the current/past months); there is no separate boolean/label for "schedule complete," and a fully-serviced-but-not-yet-expired contract still just shows `"Active"`.

## 12. Notifications

Every Contract-related `notify()` call, exhaustively enumerated (grep-verified, no others exist):

| # | Trigger function | Recipients (`roles`) | Exact message text (verbatim, with substitutions shown) | Timing | Throttle | Relationship | One-time / repeatable |
|---|---|---|---|---|---|---|---|
| 1 | `convertToService(id)` | `["service_mgr","admin"]` | `Commissioning approved: "`+`p.name`+`" converted to Service project — 1 year warranty, quarterly PM scheduled.` | immediately on conversion | none (fires every call, no dedup) | Project→Contract | one-time per conversion call (but conversion itself is callable repeatedly — see §18) |
| 2 | `saveCall(contractId)` (PM path, `contractId` truthy) | `["service_mgr","admin"]` | `PM scheduled: PSC-`+`psc`+` — `+`customer`+` (`+`site`+`)` | on scheduling a PM visit's ServiceCall | none | Contract→ServiceCall (indirect, via scheduling) | one-time per scheduling action |
| 3 | `saveCall(contractId)` (Complaint path, `contractId` falsy — listed for completeness/contrast) | `["service_mgr","admin"]` | `New complaint registered: PSC-`+`psc`+` — `+`customer`+` (`+`site`+`)` | on registering a complaint | none | not Contract-related (no `contractId`) | one-time |
| 4 | `saveReport(id, true)` — chargeable branch | `["finance"]` | `Chargeable service PSC-`+`psc`+` completed — `+`money(amount)`+` to collect from `+`customer` | on completion, only if `report.stype==="Chargeable"&&report.amount>0` | none | may apply to a PM-type call if its report was manually re-typed to Chargeable (unusual) | one-time |
| 5 | `saveReport(id, true)` — always | `["service_mgr","admin"]` | `PSC-`+`psc`+` completed by `+`(eng||U.name)`+` — `+`customer` | on any service-call completion | none | applies to PM visits too — this is the general "your PM/complaint job is done" broadcast | one-time |
| 6 | `assignCall(id)` (listed for completeness — fires for PM-type ServiceCalls too, since assignment isn't type-gated) | `["*"]` (all company users) | `Service call PSC-`+`psc`+` (`+`customer`+`) assigned to `+`eng`+(optional `" for "+date+" "+time`) | on assigning an engineer/appointment | fires only if `s.eng` truthy after the save | applies to both PM and Complaint calls | one-time per assignment save |

**Never notified:** manual AMC/Warranty contract creation (`saveContract()` — no `notify()` call at all, confirmed absent); a Contract becoming `"Expiring Soon"`/`"Expired"` (purely a read-time dashboard/list computation, never a push notification); a PM visit becoming due (also purely pull/dashboard-based — no proactive alert fires when a `svcs[i].m` reaches the current month).

## 13. Roles / Authorization

For every Contract action, across all 11 roles (`super, admin, sales, hvac_pm, solar_pm, mep_pm, engineer, inventory, service_mgr, service_eng, finance`):

| Action | Visible role gate (UI) | Function-level gate (code) | Division restriction | PWA security weakness |
|---|---|---|---|---|
| View AMC/PM list (`pmlist`) | `MENUS` entry present only for `admin`, `service_mgr` | **none** — `nav('pmlist')` performs no auth check; `vPM()` performs no auth check | none (not division-scoped at all) | any authenticated role can call `nav('pmlist')` from the console and see every AMC contract in their company |
| Manual create (`saveContract`) | reachable only via the `pmlist` page's "+ Add Contract" button (same menu gate as above) | **none** | none | as above — no function-level role check on `saveContract()` |
| Project-conversion create (`convertToService`) | button rendered only for `service_mgr`/`admin` inside `vProject()` | **none** | none | as above — any role could call `convertToService(id)` directly |
| Edit | N/A — no edit function exists for any role | N/A | N/A | N/A |
| Delete | N/A — no delete function exists for any role | N/A | N/A | N/A |
| Mark PM visit complete | happens only via completing a ServiceCall, gated to `isEng` (the assigned engineer by name-match) or `isMgr` (`service_mgr`/`admin`) inside `vCall()`'s rendering | the actual write (`s.status="Completed"`, the `svcs[due[0]].done=` stamp) happens inside `saveReport()`, which itself performs **no** role check — reachable by anyone who can invoke it | none | UI-only gate again; `saveReport(id,true)` has no server (or even client function-level) role check |
| Create PM ServiceCall from Contract (`mCall`/`saveCall`) | "Schedule PM" button shown to whoever can see the PM-due panel (`admin`/`service_mgr` via menu) | **none** in `saveCall()` | none | same pattern |
| Reports/CSV export (`dlContracts`) | button shown on the `pmlist` page (same menu gate) | **none** in `dlContracts()` | none | same pattern |
| Schedule changes (regenerate/edit `svcs[]`) | N/A — feature does not exist | N/A | N/A | N/A |

**Summary weakness (consistent with the rest of the PWA, per `OPEN_DECISIONS.md` #22's already-documented pattern for SalesOrder/Payment):** every Contract-related mutation and view is protected **only** by menu-item visibility and inline button-rendering ternaries — there is **no** function-level (in-JS) role check anywhere in the Contract code path, and since the PWA has no server, there is also no server-side enforcement. This is preserved here as an observed PWA FACT/quirk, not fixed.

## 14. Search / List / Dashboard

- **Contract list (`vPM()`):** table columns `Customer, Contact (phone+email), Site, Cap., Start, End, Type, Category, Amount, Status, 1st, 2nd, 3rd, 4th` (only 4 visit columns are ever rendered, regardless of actual `svcs.length` — see §6/§18).
- **Search (`hit(c, [...])`)**: `vPM()` filters the contract rows via `hit(c,["customer","phone","email","site","cap","amcType","cat","start","end","amount"])` against the global search bar text (`srchBar`) — a case-insensitive substring match across all ten listed fields (confirmed via the generic `hit()` helper, shared across all entities).
- **Filters/sorting:** **none** beyond the free-text search above — no status filter, no date-range filter, no column-sort control anywhere on the AMC/PM list.
- **PM-due panel (`pmDuePanel()`):** a separate panel above the main list, titled `"🔁 PM Due — <Month Year> (incl. overdue)"`, listing one row per due visit-index pair (`{c,i}` — so a contract with 2 simultaneously-due visits appears twice), columns `Site, Customer, Phone, Type (cat), Service Due (month), [Schedule PM button]`. Not searchable/filterable itself.
- **Expiring/renewal panel:** `vPM()`'s bottom panel, `"⚠️ Renewal Opportunities"`, listing every contract whose `contractStatus(c)!=="Active"` (i.e. Expiring Soon or Expired), columns `Site, Customer·Phone, Category, End Date, Status`. Framed explicitly as "offer AMC renewal (warranty → paid AMC)" — but no "renew" action/button exists; it is purely informational (staff would presumably create a fresh manual AMC contract by hand).
- **Customer lookup:** no dedicated customer-search screen for Contracts — customer name is just one of the ten searchable fields above.
- **Project lookup:** no reverse lookup UI ("show me this Contract's originating Project") exists anywhere, despite `fromProject` being stored.
- **ServiceCall lookup:** no dedicated "this contract's service calls" view exists; the only cross-reference is the one-way `contractId` on ServiceCall rows (§7).
- **Cross-company dashboards (super-admin, unrelated to individual Contract detail but touching Contract counts):** `vUsage()`/`coStats()` aggregates a per-company `amc` count (`DB.contracts.filter(x=>x.co===id).length`) into the "Client Business & Usage" report (super role only) and the KPI cards on that page; `vExpiring()` (super role, titled "⏳ Expiring in Next 30 Days") is a **SaaS-subscription** expiry tracker (Company `subEnd`/`trialEnd`), entirely unrelated to AMC Contract expiry — flagged here explicitly to avoid confusing the two "expiring" concepts.

## 15. Reports / Export

Exactly one Contract-specific export function, `dlContracts()` (line ~3527-3539):

- **Filename:** `"amc-pm-list-"+today()+".csv"`.
- **Report header block:** `rptHead("AMC / Warranty & PM Report")` (the shared company-letterhead CSV header used by all reports).
- **Exact column order/headers:** `Customer, Phone, Email, Site, Capacity, Category, AMC Type, Amount, Start, End, Status, PM Due Now, 1st Due, 1st Done, 2nd Due, 2nd Done, 3rd Due, 3rd Done, 4th Due, 4th Done`.
- **Row values:** `customer, phone, email, site, cap, cat, amcType, amount||"", start, end, contractStatus(c), pmDue(c).length`, followed by exactly 4 pairs of `(svcs[i].m||"", svcs[i].done||"")` — **truncated to the first 4 schedule slots even for a Monthly (12-visit) contract**, mirroring the same 4-column limitation as the on-screen list (§6/§18 quirk — a Monthly contract's 5th-through-12th visits are never exported).
- **Totals row:** `["TOTAL", rows.length+" contracts", "", "", "", "", "", amt, "", "", "", due+" PM due/overdue"]` where `amt` sums `Number(c.amount)||0` across all filtered rows and `due` sums `pmDue(c).length` across all filtered rows.
- **Date formatting:** raw `"YYYY-MM-DD"` strings, unconverted (no locale reformatting for CSV, unlike the `money()`-formatted on-screen display).
- **Status labels:** the literal `contractStatus(c)` output string (`Active`/`Expiring Soon`/`Expired`).
- **PM schedule display:** as the 4 Due/Done column pairs above.
- **Source Project details:** **not included** — `fromProject` is never exported by `dlContracts()` (no "Originating Project" column exists in this report).
- **Filtering/scoping:** `mine(DB.contracts)` (current company only) further filtered by the same `hit(...)` search-bar predicate as the on-screen list — i.e. the CSV export respects whatever the user last typed into the search box, exporting only the currently-filtered rows, not necessarily the whole company's contract list.
- **No other Contract report/print/summary export exists** (no dedicated "AMC renewal report," no per-contract printable certificate, no PDF).

## 16. Project Relationship (`fromProject`)

- **Creation source:** set exclusively by `convertToService()` (Path A, §4); never set/settable by the manual path (Path B).
- **Cardinality:** at most one Project per Contract (`fromProject` holds a single Project id, not an array); a single Project could theoretically spawn multiple Contracts if `convertToService(id)` is invoked more than once for the same project (nothing prevents this — see §18 duplicate-conversion quirk), in which case multiple Contract rows would each independently store the same `fromProject` value (many-Contracts-to-one-Project is possible in practice, even though the conceptual intent is 1:1).
- **Lookup behavior:** none — no PWA function ever reads `fromProject` to look anything up (no "jump to originating project" link, no re-derivation of Project fields from it). It is write-only, exactly analogous to the already-documented `InventoryIssue.projId` "write-only, functionally dead foreign key" pattern noted in `OPEN_DECISIONS.md` #33 for a different entity.
- **Project status after conversion:** `p.status="In Service"` (set unconditionally by `convertToService`, with no re-check of the prior status — see §18).
- **Project detail behavior:** `vProject()` renders a distinct banner (`"🔁 In Service — converted to 1-year warranty service project. See AMC / PM List."`) whenever `p.status==="In Service"`, but this banner does not link to or display the specific Contract record created — it is purely informational text.
- **Whether Contract edits affect Project / vice versa:** Contract cannot be edited at all (§9), so this is moot in the "Contract→Project" direction. In the "Project→Contract" direction: no PWA function ever re-writes an existing Contract when its originating Project is later touched (e.g., editing the Project's `customer`/`cap`/`name` after conversion does **not** propagate to the already-created Contract's `customer`/`cap`/`site` — those were copied once, at conversion time, and never re-synced).

## 17. Payment/Finance Relationship (mandatory verification)

Verified literally by exhaustively grepping every `DB.payments.push`/`DB.seq.pay++` call site in the entire PWA (four total, all four inspected):

1. SO-milestone seeding (line ~2092) — from `so.pay[]`, unrelated to Contract.
2. SO-milestone-add-on-edit (line ~2351-2354) — from `saveSO`'s edit branch, unrelated to Contract.
3. Chargeable-service-completion (line ~3702) — from `saveReport()`, triggered by a ServiceCall's own `report.stype==="Chargeable"`+`amount>0` — **not** a Contract-amount trigger; this fires for any Chargeable service call (PM-type or Complaint-type) whose report was filled in that way, entirely independent of the Contract's own stored `amount` field.
4. Manual finance entry (line ~3977) — the "Add Pending Payment" form, unrelated to Contract.

**Conclusions (all re-verified, none assumed):**
- **Contract `amount` never creates or links to a Payment record anywhere in the PWA.** There is no AMC-billing screen, no "raise AMC invoice" action, no code path that reads `c.amount` and writes a `payments` row.
- **PM/service visit completion does not create a Payment**, unless that specific ServiceCall's own report happens to be filed as `Chargeable` with a positive amount — and that mechanism is generic to all ServiceCalls, not Contract-specific (a `type:"PM"` call defaults its report `stype` to `"AMC"`, not `"Chargeable"`, so this is not the normal PM-completion path).
- **Contract creation (either path) never creates a Payment.**
- **Contract renewal is not a distinct workflow at all** (§4/§14 — "renewal" is just a manual "Add Contract" with no linkage back to the expiring one), so it likewise never creates a Payment.
- **Reports:** `dlContracts()` sums `c.amount` into its own CSV total (§15) but this is a display/report-only aggregation — it does not pull from or reconcile against `DB.payments` in any way. The cross-company `vUsage()`/`coStats()` report separately tracks `billed`/`coll`/`out` from `DB.payments` and `amc` (contract count) from `DB.contracts` as two entirely independent columns — never cross-referenced.
- **Finance notifications:** the only Contract-adjacent notification reaching `finance` is the generic Chargeable-service-completion one (#4 in §12's table), which — as above — is not driven by Contract `amount` at all.
- **Raise/collection relationship:** none exists for AMC amounts (no "raise to finance" action is offered anywhere on a Contract, unlike SalesOrder milestones which do have that action per `DOMAIN_MODEL.md`'s Payment section).

This confirms, independently, the exact conclusion already recorded in `OPEN_DECISIONS.md` #7 and `DATABASE_SCHEMA.md` line 357 — **UNSPECIFIED BY PWA** whether AMC/warranty amounts should ever flow into the Payment ledger in the new system. This audit does not propose an answer; it is listed again in §25 as an open decision that a future Contract implementation task must resolve.

## 18. Edge Cases / Quirks / Bugs

Re-verified literally, per task instruction (documented, not fixed):

1. **45-day "Expiring Soon" threshold** — confirmed exact (`contractStatus`, §6).
2. **PM-due-month rule** (`not done && month <= current month`) — confirmed exact (`pmDue`, §6).
3. **12/6/4 schedule assumption was itself imprecise** — actual PWA is 12 visits/1-month (Monthly), **2** visits/6-month (Half-Yearly, not 6), 4 visits/3-month (Quarterly) (§5).
4. **Schedule date boundaries** — `svcs[i].m` is month-only (`YYYY-MM`), day-of-month discarded; visits are generated by repeated `setMonth()` calls off a single base `Date`, which correctly rolls year boundaries (JS `Date` semantics) — no off-by-one observed in the seed data.
5. **One-year end date (Project conversion)** — computed as `start + 1 calendar year − 1 day` (`setFullYear(+1)` then `setDate(-1)`), i.e. a contract starting `2026-01-01` ends `2026-12-31`, not `2027-01-01` — verified exact.
6. **Quarterly-schedule starting month** — both generators anchor the first visit to the contract's own effective start (Path A: `today()` at generation time since `start` is also `today()`; Path B: the user-chosen `start` date) — the first visit is always month `q=0`/`i=0`, i.e. the start month itself, not one interval later.
7. **Phone/email blank on Project conversion** — re-verified exact and unfixed: `convertToService()` hardcodes `phone:""`, `email:""` even though the originating Project's `customer` field (itself sourced from the SO's contact name during Project creation) implies real contact data existed upstream. Confirmed already flagged in `OPEN_DECISIONS.md` #34 as NOT APPLICABLE/deferred — this audit reconfirms the exact mechanism (hardcoded literal, not a lookup that failed) rather than assuming.
8. **Project status conversion has no guard** — `convertToService()` sets `p.status="In Service"` and creates a Contract with zero re-verification of the Project's actual current `status`/`div` inside the function itself (only the UI button's render condition checks this) — see §4/§13.
9. **Duplicate conversion** — nothing prevents calling `convertToService(id)` more than once for the same project id; each call independently increments `DB.seq.contract` and pushes a brand-new Contract row (with a fresh 1-year `start`/`end` window computed from "now," not from the first conversion's dates), so a Project could accumulate multiple `fromProject`-linked Contracts. Not guarded, not deduplicated.
10. **Duplicate contracts (manual path)** — nothing prevents creating two manual Contracts with identical `customer`/`site`/dates; no uniqueness check of any kind exists.
11. **Missing Project** — `convertToService(id)` does `DB.projects.find(x=>x.id===id)` with no existence check before reading `p.customer`/`p.name`/`p.cap`/`p.status` — calling it with a nonexistent id would throw a runtime error reading properties of `undefined` (unhandled).
12. **Missing customer/contact** — manual creation tolerates a fully blank `customer`/`phone`/`email` (only `site` is enforced); nothing downstream (search, CSV, PM-call prefill) guards against blank values beyond falling back to empty-string display.
13. **Expired contracts** — `pmDue()` still reports due/overdue visits for an already-`"Expired"` contract (§6) — the PM-due panel and Renewal-Opportunities panel can both list the same contract simultaneously (one for "still owes a visit," the other for "past its end date").
14. **Schedule completion** — marking every visit done does not change `contractStatus()` (§11) and does not trigger any "contract fully serviced" notification or flag.
15. **Manual-AMC-vs-Warranty differences** — verified there is **no** behavioral difference between `cat="AMC"` and `cat="Warranty"` beyond the stored label/badge color and the renewal-panel's framing text; schedule generation, `pmDue()`, `contractStatus()`, and every calculation treat both categories identically. The only place category matters at all is display.
16. **Role/UI-only protection** — pervasive throughout Contract (every action in §13 has zero function-level role enforcement).
17. **Date parsing** — all Contract dates are plain strings compared lexicographically (`c.end<t`, `s.m<=tm`) rather than parsed as `Date` objects for comparison — this works correctly only because `"YYYY-MM-DD"`/`"YYYY-MM"` strings sort identically to their chronological order; an `end` value in any other format (possible since the manual path's `gv("ct_ed")` is an unvalidated `<input type="date">` string, or blank) would silently break the comparison (e.g., `""` sorts before any real date, so a blank `end` would immediately read as `"Expired"` — verified by the string-comparison logic, not merely inferred).
18. **Stale/unused fields** — `fromProject` is write-only/never read (§16); `cap` is display-only, never used in any calculation.
19. **Operator-precedence bugs** — none found specific to Contract's own arithmetic/logic (unlike the already-documented InventoryIssue `used>0` precedence bug in `OPEN_DECISIONS.md` #16, which is a different entity). Contract's boolean logic (`!s.done&&s.m<=tm`, `c.end<t`, `new Date(t)>=d`) was traced operator-by-operator and found unambiguous.
20. **4-column display/export cap** — both the on-screen AMC list and the CSV export hardcode exactly 4 visit-slot columns, silently truncating a Monthly (12-visit) or any-longer-than-4 schedule's later entries from both the UI table and the report (§6/§15) — a genuine PWA limitation, not merely an audit assumption.
21. **No notification on manual contract creation** — asymmetric with the Project-conversion path, which does notify (§4/§12).
22. **`saveContract()`'s `end` field has no fallback/validation** whatsoever, unlike every other field in that function (§3/§17 quirk #17 above).

## 19. Field-by-Field Coverage Table

| PWA Field | Type/Shape | Required? | Default | Create | Edit | Read | Relationships | Side Effects | New-App Representation | Coverage Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `id` | Number | yes | `++seq.contract` | both paths | — | key everywhere | PK | none | Mongo `_id` (`Contract.js`) | COVERED | display sequence never existed — new app correctly omits one |
| `co` | Number | yes | `U.co` | both paths | — | tenant filter | Company | none | `companyId` ref | COVERED | |
| `customer` | String | no | `""`/copied | both | none | list/search/CSV | — | none | `customer: String` | COVERED | |
| `phone` | String | no | `""` (both: blank on conversion, user-entered manually) | both | none | list/search/CSV/msg-prefill | — | none | `phone: String` | COVERED (schema); conversion-blank quirk preserved as PWA FACT, not "fixed" | see §3/§18 #7 |
| `email` | String | no | `""` | both | none | list display | — | none | `email: String` | COVERED | never used for actual sending in PWA |
| `site` | String | no (but function-enforced non-empty on manual path) | copied/user-entered | both | none | display key/search/CSV | — | none | `site: { required: true }` | COVERED | schema's `required:true` is stricter than the PWA (PWA only enforces via a client-side `toast`, not a hard model constraint) — reasonable NEW BACKEND DESIGN tightening, not a behavior change worth flagging as a gap |
| `cap` | String | no | copied/user-entered | both | none | display only | — | none | `capacity: String` | COVERED | |
| `start` | String date | yes (implicit) | `today()`/user-entered | both | none | schedule-gen/display | — | seeds `svcs[]` | `startDate: Date, required` | COVERED (type upgraded string→Date, reasonable infra difference) | |
| `end` | String date | yes (implicit, but unvalidated on manual path) | computed/raw user input (no fallback) | both | none | `contractStatus()` | — | none | `endDate: Date, required` | COVERED (type upgraded); PWA's own lack-of-fallback quirk not separately modeled | see §18 #22 |
| `amcType` | String enum-by-convention | yes | `"Quarterly"`/user-selected | both | none | schedule-gen/display/CSV | — | drives `svcs[]` generation | `amcType: enum required` | COVERED | new app's real enum is stricter than PWA's convention-only string — reasonable |
| `cat` | String enum-by-convention | yes | `"Warranty"`/user-selected | both | none | badge/renewal framing/CSV | — | none (no calc difference — §18 #15) | `category: enum required` | COVERED | |
| `amount` | Number | no | `0` | both | none | display/CSV total/usage report | — | never → Payment (§17) | `amount: Number, default 0` | COVERED (schema); Payment-linkage is an OPEN DECISION, not a gap in representing the PWA | |
| `svcs[]` — `m` | String "YYYY-MM" | yes (generated) | generated | generation only | never | `pmDue()`/display/CSV | — | — | `scheduledVisits[].month: String, required` | COVERED | |
| `svcs[]` — `done` | String "" or "YYYY-MM-DD" | no | `""` | generation only | **only** via linked ServiceCall completion | `pmDue()`/display/CSV | ServiceCall (indirect) | stamped by `saveReport()` | `scheduledVisits[].completedDate: Date, default null` | COVERED (type upgraded string→Date/null) | |
| `fromProject` | Number \| undefined | no | `p.id` / unset | conversion path only | never | never read (write-only, §16) | Project | none | `originatingProjectId: ObjectId ref, default null` | COVERED | |

## 20. Workflow Coverage Table

| PWA Workflow | Trigger | Preconditions | State Changes | Related Entities | Notifications | Derived Values | New-App Coverage | Gap / Decision |
|---|---|---|---|---|---|---|---|---|
| Project→Warranty Contract | "Approve Commissioning" button (`convertToService`) | UI: `status==="Completed"&&div!=="MEP"`, role `service_mgr`/`admin`; code: **none enforced** | new Contract row; `Project.status="In Service"` | Project | `service_mgr`,`admin` | `end`=`start`+1yr−1day; `svcs`=4 quarterly | `projectService.js`'s `prepareServiceConversion` implements the eligibility check ONLY (deferred integration stub, per `OPEN_DECISIONS.md` #34); no Contract model write yet | Contract creation itself is out of scope pending a future task — this audit's job was only to document, which is done |
| Manual AMC creation | "+ Add Contract" → `saveContract()` | UI: `pmlist` menu (admin/service_mgr); code: only `site` non-empty enforced | new Contract row | none | **none** | `svcs` per `amcType` (§5) | `Contract.js` model exists; no service/route layer yet (explicitly out of scope this task) | role enforcement + validation strictness are OPEN DECISIONS for the future implementation task |
| Contract edit | N/A — does not exist | N/A | N/A | N/A | N/A | N/A | N/A | whether the new system SHOULD add editing (a real gap vs. the PWA, which has none) is itself a design decision |
| PM schedule generation | at Contract creation (either path) | none beyond creation itself | `svcs[]` populated once | — | none | 12/2/4-visit cadence (§5) | `scheduledVisits` schema field exists, generation logic not yet implemented (deferred) | cadence table (§5) should be the literal spec for a future generator function |
| PM due calculation | read-time, every dashboard/list render | none | none (pure read) | — | none | `pmDue()` (§6) | not yet implemented in new app (no service layer yet) | 45-day/month-boundary rules (§6) are the literal spec |
| PM visit completion | `saveReport(id,true)` when `s.contractId` truthy | linked ServiceCall must have signature captured, role `isEng`/`isMgr` (UI only) | `svcs[due[0]].done=today()` | ServiceCall | `service_mgr`,`admin` (+`finance` if Chargeable) | first-currently-due-index stamp (not id-specific — §7/§18) | `ServiceCall.js`'s `contractId` ref exists; the actual completion→stamp side-effect is not yet implemented (deferred) | the "stamps the first due index, not a specific visit" quirk (§7) must be preserved literally when this is eventually implemented |
| ServiceCall creation (PM) | "Schedule PM" button → `mCall(contractId)`→`saveCall(contractId)` | contract must have a due visit to appear in the panel (but nothing stops calling `mCall` on a non-due contract directly) | new ServiceCall row, `type:"PM"`,`status:"Scheduled"` | Contract (via `contractId`) | `service_mgr`,`admin` | — | ServiceCall model exists; route/service layer for Contract-linked creation not yet implemented | out of scope this task, per ground rules |
| Contract status | read-time | none | none (pure read) | — | none | Active/Expiring Soon (45d)/Expired (§6/§11) | not yet implemented | literal spec is §6/§11 |
| Search/filter (AMC list) | typing in the shared search bar | none | none | — | none | substring match over 10 fields (§14) | not yet implemented | literal field list is §14 |
| Reports/export | "⬇ Report" button → `dlContracts()` | none | none (read-only CSV) | — | none | totals (§15) | not yet implemented | exact column order/4-slot truncation (§15) is the literal spec |

## 21. Relationship Matrix

| From | To | Cardinality | Trigger | Fields/Keys | Cascade/Side Effects | PWA Fact / New Design |
|---|---|---|---|---|---|---|
| Project | Contract | 1 Project → 0..N Contracts (conceptually 1:1 via UI, but not enforced — §18 #9) | "Approve Commissioning" (`convertToService`) | `Contract.fromProject = Project.id` | `Project.status="In Service"`; no reverse write on Project (no "linked contract id" stored on Project) | PWA FACT |
| Contract | ServiceCall | 1 Contract → 0..N ServiceCalls | "Schedule PM" (`mCall`/`saveCall`) | `ServiceCall.contractId = Contract.id` | none automatic — always staff-initiated | PWA FACT |
| ServiceCall (PM, `contractId` truthy) | Contract | N ServiceCalls → 1 Contract (reverse of above) | on ServiceCall completion (`saveReport`) | lookup `Contract.svcs[pmDue(c)[0]]` | `Contract.svcs[i].done = today()` — not id-specific to which ServiceCall triggered it | PWA FACT + PWA QUIRK-BUG (§7/§18) |
| Contract | User/roles | N/A (not a stored relationship — purely access-control) | every Contract screen/action | UI: `MENUS`/inline role ternaries; code: none | none | PWA FACT (UI-only enforcement, §13) |
| Contract | Payment | **none** | N/A — never observed | N/A | N/A | UNSPECIFIED BY PWA (OPEN_DECISIONS.md #7, reconfirmed §17) |
| Contract | Notification | 1 Contract-related event → 0..N notifications (fan-out to roles, not a stored back-reference) | creation (conversion path only), PM scheduling, PM/service completion | `notify(roles, text)` — no id linkage stored on the Notification back to the Contract | none stored (Notification is a broadcast, not a durable Contract-child record) | PWA FACT |
| Contract | PM schedule (`svcs[]`) | 1 Contract → 1 embedded array (not a separate collection) | generation at creation only | embedded, not referenced | none post-creation except the `done` stamp | PWA FACT |

## 22. Current New-App Comparison

Compared against `new-app/backend/src/models/Contract.js`, `ServiceCall.js`, `Project.js`, `Notification.js`, `DOMAIN_MODEL.md`, `DATABASE_SCHEMA.md`, `OPEN_DECISIONS.md`, `projectService.js` (all read-only; none modified by this task).

- **`Contract.js` (existing model):** already matches this audit's field inventory closely — `companyId, customer, phone, email, site, capacity, startDate, endDate, amcType (enum Monthly/Quarterly/Half-Yearly), category (enum AMC/Warranty), amount, scheduledVisits[{month,completedDate}], originatingProjectId`. No discrepancy found between this model and the literal PWA source. Its own header comment ("status is derived at read time... therefore NOT a stored field") is independently confirmed correct by this audit (§11).
- **`ServiceCall.js` (existing model):** already matches — `contractId` ref exists, one-way as this audit independently confirmed (§7); `type` enum `Complaint|PM`; `status` enum matches exactly; `report` sub-schema matches the PWA's report object field-for-field, including the deliberate choice (documented in that file's own comment) not to constrain `checklistResults` keys to an enum, which this audit's own trace of `SVC_CHK` usage does not contradict.
- **`Project.js`/`projectService.js`:** `prepareServiceConversion`/`isEligibleForServiceConversion` (§4/§20) is a documented, intentionally minimal integration stub — this audit confirms its eligibility check (`status==="Completed"&&division!=="MEP"`) is byte-for-byte correct against the literal PWA render condition, and confirms (independently) that it correctly does NOT create a Contract, flip status, or notify — reserving all of that for a future task, exactly as its own comment states. **Not modified by this audit.**
- **`DOMAIN_MODEL.md` §7 (Contract):** matches this audit's findings on fields, required/optional split, relationships, status derivation, and the 12/2/4 visit-cadence rule (independently re-derived by this audit, not merely copied) — one line ("Update: by Service Manager/Admin") is **not supported** by the literal source (no edit function exists at all — §9/§22 DOC GAP, flagged not corrected).
- **`DATABASE_SCHEMA.md` §7 (`contracts`):** matches this audit's findings on fields, indexes, visit-generation rule, status derivation, and the "no delete" observation — its lifecycle line ("created → edited → no delete observed") is the same DOC GAP as above (§9).
- **`OPEN_DECISIONS.md` #7, #33, #34:** all three independently reconfirmed by this audit's own trace (§17 for #7; #33 is about Inventory, tangential; §4/§18 for #34's phone/email quirk) — no correction needed to any of the three.
- **Schema coverage:** essentially complete already (`Contract.js`/`ServiceCall.js` exist and match). **Workflow coverage: zero** — no `contractService.js`/`contractRoutes.js`/`serviceCallService.js`/`serviceCallRoutes.js` exist yet (confirmed absent from the file listing), consistent with these two entities being explicitly out of scope for every prior implementation task.
- **Unsupported assumptions found:** none in the existing models/docs beyond the single "Update: by Service Manager/Admin" DOC GAP noted above.
- **Misleading comments:** none found in `Contract.js`/`ServiceCall.js` — their inline "PWA FACT" annotations were all independently verified correct by this audit's own trace.
- **Future dependency issues:** a future Contract/ServiceCall implementation task will need to decide (not invent unilaterally) the items listed in §25 before writing `contractService.js`/`serviceCallService.js` — most importantly the Payment-linkage question (§17/OPEN_DECISIONS #7) and whether to preserve the "stamps the first-due index, not the specific triggering visit" completion quirk (§7/§18) verbatim.

## 23. PWA FACT vs New Backend Design Classification

- **PWA FACT:** the entire field inventory (§3), both creation paths and their exact defaults (§4), the visit-generation formulas and corrected 12/2/4 cadence (§5), `pmDue()`/`contractStatus()` algorithms verbatim (§6/§11), the one-way ServiceCall→Contract reference and the "stamp first-due-index" completion mechanism (§7/§10), all six enumerated `notify()` calls (§12), the total absence of edit/delete for Contract (§9), the total absence of function-level role checks (§13), the exact search fields and 4-column display/export truncation (§14/§15), the total absence of any Contract↔Payment linkage (§17).
- **PWA QUIRK-BUG:** phone/email hardcoded blank on conversion despite upstream contact data existing (§4/§18 #7); no re-check of Project eligibility inside `convertToService` (§4/§18 #8); duplicate-conversion possibility (§18 #9); completion stamping the first-due index rather than a specific visit (§7/§18); Expired contracts still surfacing in the PM-due panel (§6/§18 #13); manual-creation asymmetry of no notification vs. conversion's notification (§12/§18 #21); manual `end` field having no fallback/validation (§3/§18 #22); the AMC list/CSV's hardcoded 4-visit-column cap silently truncating longer schedules (§6/§15/§18 #20).
- **CURRENT NEW-APP IMPLEMENTATION:** `Contract.js` and `ServiceCall.js` models (schema only, no service/route layer); `projectService.js`'s `prepareServiceConversion` stub (eligibility check only, explicitly deferred).
- **NEW BACKEND DESIGN:** none proposed by this audit (out of scope — read-only audit); the existing `Contract.js`'s stricter Mongoose-level type/required constraints (e.g. `site: required: true`, real `Date` types, real enums) are pre-existing infrastructure differences already in the repo, not introduced here.
- **OPEN DECISION:** every item in §25 below.

## 24. Implementation Readiness Classification

- **COVERED (schema-level):** every Contract field (§19); the ServiceCall `contractId` link; the Notification model's generic role/text/read-tracking shape (sufficient to represent all six Contract-related `notify()` calls without any Contract-specific Notification field being needed).
- **DOC GAP:** `DOMAIN_MODEL.md`/`DATABASE_SCHEMA.md`'s "Update"/"edited" language for Contract, which this audit found unsupported by the literal source (§9/§22) — a future documentation pass should correct this wording (not this audit's job to edit those files).
- **SCHEMA GAP:** none found — `Contract.js`/`ServiceCall.js` already represent every field this audit traced.
- **IMPLEMENTATION GAP:** the entire service/route/controller layer for both Contract and ServiceCall (creation, listing, search, PM-due computation, status computation, completion side-effect, CSV export, notifications) — all explicitly out of scope for this read-only audit and for every prior implementation task.
- **DESIGN DECISION:** Payment-linkage for AMC amount (§17); whether to add a true Contract-edit capability where the PWA has none (§9); whether to fix or preserve the "stamps first-due-index, not the triggering visit" completion quirk (§7); whether to fix or preserve the 4-visit display/export cap for Monthly contracts (§6/§15); whether to add real server-side role enforcement for Contract actions, mirroring the pattern already resolved for SalesOrder/Payment in `OPEN_DECISIONS.md` #22 (this audit does not resolve it here, only flags the same pattern exists for Contract).
- **PWA QUIRK-BUG:** see §23's list — flagged for preserve-vs-fix decisions in §25, not resolved here.
- **NOT APPLICABLE:** any notion of a Contract display/reference number (never existed in the PWA — §7); a Contract-level service report (never persisted at that level, only on ServiceCall — §10); Contract deletion (never existed — §9).

## 25. Final Gap / Decision List

Every actual gap and every decision a future Contract/ServiceCall implementation task must make — remembering PWA quirks are preserved by default, backend security enforcement is infrastructure-only, and no business behavior is "fixed" without explicit future instruction:

1. **AMC/warranty `amount` → Payment linkage** (reconfirms `OPEN_DECISIONS.md` #7): should Contract `amount` ever generate a `payments` record (per visit? per term? never, matching the PWA exactly)? **UNRESOLVED — PWA shows no such linkage at all.**
2. **Contract editing:** the PWA has none. Should the new system (A) preserve this exactly (Contract becomes immutable after creation, matching the PWA byte-for-byte), or (B) add a genuine edit capability the PWA never had? **UNRESOLVED — a real design decision, not inferable from the PWA.**
3. **Contract deletion:** the PWA has none. Same A/B choice as above. **UNRESOLVED.**
4. **PM-completion stamping mechanism** (§7/§18): should a future implementation preserve the exact "stamp the first currently-due `scheduledVisits` index, regardless of which ServiceCall triggered completion" behavior (Choice A — bug-for-bug fidelity), or (Choice B) make the stamp specific to the particular visit the triggering ServiceCall was actually scheduled against (would require adding a `visitIndex` reference on ServiceCall, which does not exist in the PWA)? **UNRESOLVED.**
5. **4-visit display/export cap for Monthly (12-visit) contracts** (§6/§15/§18 #20): preserve the PWA's truncation exactly (Choice A), or show/export all scheduled visits regardless of count (Choice B)? **UNRESOLVED.**
6. **Function-level role enforcement for Contract actions** (§13): the PWA has zero function-level checks anywhere in the Contract code path (create both ways, mark-PM-complete, create-service-call, reports, schedule generation). Consistent with the pattern already resolved for SalesOrder/Payment (`OPEN_DECISIONS.md` #22, Choice A there — "enforce the PWA's own visible role intent, server-side"), a future task must decide whether to apply the same treatment here: enforce `admin`/`service_mgr` server-side for Contract create/PM-schedule/reports, and `isEng`(assigned)/`service_mgr`/`admin` for completion. **Not resolved by this read-only audit — flagged for the future implementation task to lock, following the same precedent.**
7. **Manual-creation notification asymmetry** (§12/§18 #21): should manual AMC creation gain a notification (matching the conversion path), or should the asymmetry be preserved exactly as observed? **UNRESOLVED.**
8. **Manual `end`-field validation** (§3/§18 #22): should a future implementation require a valid `end` date at creation (tightening past the PWA's own lack of validation), or preserve the PWA's own no-fallback/no-validation behavior (allowing an effectively-broken/blank `end`)? **UNRESOLVED** (the existing `Contract.js` already sets `endDate: required: true` at the Mongoose level, which is a reasonable infra tightening already in place — but the *business* question of what a future create-Contract form should require/validate is still open).
9. **Duplicate conversion** (§18 #9): should a future implementation guard against converting the same Project to a Contract more than once, or preserve the PWA's total lack of such a guard? **UNRESOLVED** (parallel to the already-resolved Enquiry "Won-transition guard," `OPEN_DECISIONS.md` #19, which chose to add real protection — a future task may want the same precedent here, but this audit does not decide it).
10. **Project-eligibility re-check inside conversion** (§4/§18 #8): should the future service-layer conversion function re-verify `Project.status==="Completed"&&division!=="MEP"` itself (defense-in-depth), given the PWA's own function performs no such re-check? (`projectService.js`'s existing `prepareServiceConversion` already does perform this re-check as part of its eligibility stub — so this is effectively already resolved in the direction of "add the check," but the full Contract-creation function that will eventually call it still needs to decide whether to trust that stub or re-verify independently.)
11. **Expired-contract PM-due visibility** (§6/§18 #13): preserve the PWA's behavior of still surfacing an Expired contract's overdue visits in the PM-due panel, or suppress Expired contracts from that panel? **UNRESOLVED.**
12. **Contract↔ServiceCall relationship direction** (§7/§21): the PWA is one-way (ServiceCall→Contract only). Should the new system add a reverse array/derived list on Contract (`serviceCallIds[]` or a virtual populate), or keep it one-way exactly as observed? **UNRESOLVED** (schema-wise, `Contract.js` currently has no such reverse field — consistent with "preserve one-way," but not explicitly locked as a decision anywhere yet).
13. **Contract display/reference number** (§7): the PWA never gives Contract a human-facing number (unlike ServiceCall's `PSC-` sequence). Should the new system add one? **UNRESOLVED — a genuine new-capability question, not inferable from the PWA.**
14. **`fromProject` reverse-lookup UI** (§16/§18 #18): the PWA never surfaces "which Contract did this Project spawn" or vice versa in its own UI, despite storing the forward link. Should the new system add that lookup UI/endpoint (an "infrastructure difference" in the sense of surfacing existing data more usefully), or leave it write-only as observed? **UNRESOLVED.**
15. **AMC-vs-Warranty category having zero behavioral difference** (§18 #15): should a future implementation introduce any behavioral distinction (e.g., different default cadences, different Payment treatment for AMC vs. free Warranty), or preserve the PWA's "label only" treatment exactly? **UNRESOLVED.**

</br>

*End of audit. No Contract, ServiceCall, Project, SalesOrder, Payment, or Inventory code was implemented, modified, or scaffolded as part of producing this document.*
