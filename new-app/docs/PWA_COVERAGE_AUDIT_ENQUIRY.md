# PWA Coverage Audit — Enquiry Module

**Status: READ-ONLY AUDIT. No Enquiry implementation (model/service/route/controller) exists as a result of this document.**

## 1. Scope / Source

This audit covers the Enquiry module only, for the NEW APP (`new-app/`) documentation/schema layer. It does not touch, reference as an implementation template, or copy anything from `server/` (v1), `v2/`, or `v3/`. The device-connected PWA file (`MEP_PROJECTS_PWA/index.html`, md5 `111b53dba91704f96b83dae96c7793c6`, 4113 lines) is the authoritative functional source, as established and re-confirmed at the start of this task.

## 2. PWA Source Assumptions

- The PWA file contains a **V2-connection-patch API/TOKEN/SOCKET integration layer** (`API_BASE`, `API_MODE`, `TOKEN`, `api()`, `SOCKET`, `initWebSocket()`, and per-entity `*_OUT`/`*_IN` vocabulary-translation tables). Per explicit instruction, this layer is **excluded from this audit**. Every fact below is drawn from the PWA's own local, functional code path (the `else` / non-`API_MODE` branch of every function that has one), not from the API-sync branch.
- Concretely for Enquiry: `notify()` has an `if(API_MODE&&TOKEN){...POST /api/notifications...} else {DB.seq.notif++; DB.notifs.push(...)}` split — only the `else` branch is audited. `saveEnq`, `addFollow`, `markLost`/`doMarkLost`, `reopenEnq`, and the Enquiry→SO cascade (`saveSO`) have **no `API_MODE` branch at all** — they operate purely on the in-memory `DB` object and `save()` (a `localStorage` write), so the entirety of Enquiry's own read/write logic is in scope and was audited directly.
- **Important, newly-verified finding:** `ENQ_OUT`/`ENQ_IN` (line ~562) define a *5-value* status vocabulary for the V2 API layer: `Open↔new, Contacted↔contacted, Quoted↔quoted, Won↔won, Lost↔lost`. **`Contacted` and `Quoted` are V2-API-only values — they are never used anywhere in the PWA's own UI, `saveEnq`, `mEnq`, `vEnq`, `enqTable`, or `applyEnqFilt` code.** The PWA's actual, functional status enum is exactly **`{Open, Won, Lost}`**, confirmed by every status-setting call site (`status:"Open"` at creation, `x.status="Lost"` in `doMarkLost`, `x.status="Open"` in `reopenEnq`, `e.status="Won"` in `saveSO`) and every status-reading call site (badges, filters, dashboard KPIs, `segPanel`). This audit treats `Contacted`/`Quoted` as out-of-scope API-layer vocabulary, not as PWA-observed Enquiry states — do not add them to the new backend's enum.

## 3. Exact Field Inventory

Enquiry object shape, as constructed by `saveEnq()` (new-record branch, line 1990–1995) and as it appears in all 10 demo seed records (lines 293–309), cross-checked field-by-field:

| # | PWA field | Type/shape | Required? | Default | Created | Updated | Read | Derived? | User/system | Embedded? | Append-only? | Formatting/normalization | References other entity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | Integer | required | `DB.seq.enq` (post-increment) | `saveEnq` (create branch) | never | everywhere (key/lookup) | system-generated | system | no | no | none | primary key |
| 2 | `co` | Integer (company id) | required | `U.co` (current user's company) | `saveEnq` (create branch) | never | `mine()` filter everywhere | no | system | no | no | none | references Company by id |
| 3 | `name` | String | **required** (guarded: `if(!gv("e_n")){toast(...);return}`) | — | `saveEnq` | `saveEnq` (edit branch, free text) | list/detail/CSV/search blob | no | user-entered | no | no | `esc()` on render only | none |
| 4 | `siteType` | String, one of a fixed `<select>` list: `Residential,Commercial,Factory,Banquet Hall,Hospital,Office` | optional | `"Residential"` (form default when creating) | `saveEnq` | `saveEnq` | list/detail/filter/CSV | no | user-entered (picklist) | no | no | none | none |
| 5 | `cap` | String (free text, e.g. "20", "300 kW") | optional | `""` | `saveEnq` | `saveEnq` | list/detail/CSV | no | user-entered | no | no | none (not parsed as a number — stored/shown as raw string) | none |
| 6 | `phone` | String | optional | `""` | `saveEnq` | `saveEnq` | list ("Customer" column)/detail/CSV; copied into SO `contacts[0].ph` on conversion | no | user-entered | no | no | none (no phone format validation) | none (plain string, no user/contact entity link) |
| 7 | `ref` | String (free text, "Reference") | optional | `""` | `saveEnq` | `saveEnq` | list/detail/CSV/filter (`selFilt` builds its option list from **existing distinct `ref` values already in the data**, via `uniq()` — it is still a free-text input on the create/edit form, not a picklist there) | no | user-entered | no | no | none | none |
| 8 | `seg` | String — one of `myDivs().concat(["AMC"])`, i.e. the company's subscribed divisions plus the literal `"AMC"` | required (a `<select>`, always has a value; defaults to `"HVAC"` for a brand-new form) | `"HVAC"` | `saveEnq` | `saveEnq` | list/detail/filter/CSV/`segPanel`/dashboard KPIs; drives default SO division on conversion (`AMC`→`HVAC`, else same value) | no | user-entered (picklist, company-scoped) | no | no | none | conceptually references a Division (or the literal "AMC", which is not a Division) |
| 9 | `rating` | Number, 1–5 | optional (always has a value via `<select>` defaulting to 3) | `3` | `saveEnq` (`Number(gv("e_rt"))`) | `saveEnq` | list (star display)/detail/filter | no | user-entered (picklist 1–5) | no | no | rendered via `stars()` (★ repeat) | none |
| 10 | `value` | Number (₹) | optional | `0` (`Number(gv("e_v"))\|\|0`) | `saveEnq` | `saveEnq` | list/detail/CSV/dashboard KPIs (`Open Enquiry Value`, `Lost Enquiry Value`)/`segPanel` totals; copied into SO `total` as the pre-filled default on conversion (editable before SO save) | no | user-entered | no | no | rendered via `money()` | none |
| 11 | `remark` | String | optional | `""` | `saveEnq` | `saveEnq`; **also overwritten as a system-generated string** on Won conversion (`e.remark="Converted to SO-"+so.no`) | detail/CSV/search blob | partially (overwritten by conversion) | user-entered, but overwritten by system on conversion | no | no | none | none |
| 12 | `review` | String (date, `YYYY-MM-DD`) | required in the sense it is always system-set | `today()` at creation | `saveEnq` (create branch only) | `addFollow()` sets `x.review=today()` on every follow-up | filter (`from`/`to` review-date range), CSV ("Review Date") | **derived** (always "today" at the moment of creation or last follow-up — functions as a "last touched" timestamp, not a user-entered value) | system-generated | no | no | ISO date string | none |
| 13 | `done` | String ("Action Done") | optional | `""` at creation | `addFollow()` (`x.done=gv("f_done")`), guarded: `if(!gv("f_done")){toast("Enter action done");return}` | overwritten (not appended) on every follow-up | list/detail/CSV | no | user-entered | no | **no — overwritten**, only `log[]` is append-only | none | none |
| 14 | `next` | String ("Next Action Required") | optional | `""` at creation | `addFollow()` (`x.next=gv("f_next")`) | overwritten on every follow-up | list/detail/CSV/dashboard `followupPanel` | no | user-entered | no | no (overwritten) | none | none |
| 15 | `nextDate` | String (date) | optional | `""` at creation | `addFollow()` (`x.nextDate=gv("f_nd")`) | overwritten on every follow-up | list (overdue styling: `status==="Open"&&nextDate&&nextDate<=today()`)/filter (`ndFrom`/`ndTo`)/CSV/dashboard `followupPanel` (`nextDate<=today()`) | no | user-entered | no | no (overwritten) | ISO date string | none |
| 16 | `status` | String enum `Open \| Won \| Lost` | required | `"Open"` at creation | `saveEnq` (create only) | `doMarkLost` → `"Lost"`; `reopenEnq` → `"Open"`; `saveSO` (on SO creation from this enquiry) → `"Won"` | everywhere (badges, filters, dashboard, `segPanel`) | no (a direct state field, set by discrete transition functions, not computed) | system-set via transition functions | no | no | none | none |
| 17 | `log` | Array of `{d: String(date), t: String}` | required (initialized `[]`, never absent) | `[]` at creation | `saveEnq` (create only) | **append-only**: `addFollow` pushes `{d,t}`; `doMarkLost` pushes `{d,t:"Marked lost"+reason}`; `reopenEnq` pushes `{d,t:"Enquiry reopened"}`; `saveSO` pushes `{d,t:"Confirmed. SO-<no> created."}` — **direct field edits via `mEnq`/`saveEnq` (name/siteType/cap/seg/phone/ref/rating/value/remark) push NOTHING to `log`** | detail page (`x.log.slice().reverse()` — newest first) | no | mixed (user-entered text from follow-up, system-generated text for lost/reopen/won) | **yes**, embedded subdocument array | **yes** | none | none |
| 18 | `lostReason` | String | optional — **verified: the PWA never requires it.** `doMarkLost` builds `r=[gv("lr_s"),gv("lr_t")].filter(Boolean).join(" — ")` from a picklist (`""` / `Price too high` / `Lost to competitor` / `Client dropped the project` / `Budget not approved` / `No response from client` / `Other`) plus a free-text remark, and assigns `x.lostReason=r` unconditionally — `r` can be an empty string, and nothing blocks the "Mark Lost" action if both are blank | absent until first marked Lost | `doMarkLost` (create-on-first-use) | **overwritten (not cleared) if marked Lost again after a reopen** — see §12 quirk | detail page, shown only when `x.status==="Lost"` | no | system-assembled from user picklist + free text | no | no | joined with `" — "` separator when both parts present | none |
| 19 | `lostDate` | String (date) | optional (same lifecycle as `lostReason`) | absent until first marked Lost | `doMarkLost` (`x.lostDate=today()`) | overwritten on a subsequent Lost (see quirk) | detail page, shown only when `x.status==="Lost"` | no | system-generated | no | no | ISO date string | none |

**Total: 19 fields** (17 business fields + `id` + `co`).

## 4. Create / Edit / Save Audit

**`mEnq(id)`** (line 1975) builds the modal. For a new enquiry (`id` falsy) it seeds an in-memory draft object with only UI defaults (`siteType:"Residential", seg:"HVAC", rating:3, value:0`) — this draft is discarded if the user cancels; nothing is written to `DB` until Save.

**`saveEnq(id)`** (line 1990):
- Single validation guard: `name` (`e_n`) must be non-empty, else `toast("Project name required")` and abort. **No other field is validated** — `cap`/`phone`/`ref`/`remark` accept any string including empty; `rating` and `value` are coerced with `Number(...)` (falling back to `0` for `value` if `NaN`/empty, but **not** for `rating` — `Number(gv("e_rt"))` on the picklist can never actually be `NaN` since the `<select>` always has one of `"1".."5"` selected).
- **Create branch** (`id` falsy): `DB.seq.enq++` (a global, not company-scoped, counter — see §12); pushes a new object combining system fields (`id`, `co:U.co`, `review:today()`, `done:""`, `nextDate:""`, `next:""`, `status:"Open"`, `log:[]`) with the user-entered `d` object (`name, siteType, seg, phone, ref, rating, value, remark`; note `cap` is also in `d` via `gv("e_c")` — confirmed present in the modal form).
- **Edit branch** (`id` truthy): `Object.assign(existingRecord, d)` — merges only the same 8 user-entered fields; `id`, `co`, `review`, `done`, `next`, `nextDate`, `status`, `log`, `lostReason`, `lostDate` are all left untouched by an edit. **No log entry is created for a direct field edit** (see §11 quirk).
- ID generation: `id = ++DB.seq.enq`, a simple in-memory integer counter, **global to the whole PWA instance** (not scoped per company) — see §12.
- Company/tenant association: `co: U.co`, taken from the currently logged-in user, set only at creation, never re-settable via the edit form (not present in the `d` object saveEnq builds).
- Sales ownership/reference: **no explicit "owner"/"assigned salesperson" field exists on Enquiry at all** — there is no `salesUserId`/`createdBy` field. Any `sales`-role or `admin`-role user who can reach the record can edit/follow-up/convert it; ownership is implicit only through the `co` (company) scope, not per-user.
- All validation is client-side only (this being a pure PWA); there is no server round-trip in the local (non-`API_MODE`) branch, so nothing here maps to a "reject with 4xx" concept yet — that is exclusively a NEW BACKEND DESIGN concern to be decided when Enquiry is actually implemented (not in this task).
- Status changes: `saveEnq` never changes `status` itself (create always sets it to `"Open"`; edit never touches it).

## 5. Status Lifecycle

Confirmed reachable states and transitions, with the exact function and guard for each:

| Transition | Function | Precondition (UI-gated) | Fields changed |
|---|---|---|---|
| (none) → **Open** | `saveEnq` (create) | none | sets `status:"Open"`, all system defaults |
| **Open** → **Won** | `saveSO(id, enqId)` when `enqId` is truthy | reached only via the "✓ Confirmed → Create SO" button, which `vEnq()` renders only when `x.status==="Open"` | `status="Won"`; `remark="Converted to SO-"+so.no`; `log` gets one entry `{d:today(), t:"Confirmed. SO-<no> created."}` |
| **Open** → **Lost** | `doMarkLost(id)` | reached only via "Mark Lost", rendered only when `x.status==="Open"` | `status="Lost"`; `lostReason=r` (possibly `""`); `lostDate=today()`; `log` gets one entry |
| **Lost** → **Open** | `reopenEnq(id)` | reached only via "↺ Reopen Enquiry", rendered only when `x.status==="Lost"` | `status="Open"`; `log` gets one entry `{t:"Enquiry reopened"}`. **`lostReason`/`lostDate` are NOT cleared** (see §12 quirk) |
| **Won** → (anything) | **none exists** | — | Once `Won`, `vEnq()` renders no status-transition button at all (only "Edit" remains) — Won is a genuine dead end in the UI. There is no "unwin"/"revert" path. |

**Explicitly verified per the task's instruction:** `lostReason` is optional — `doMarkLost` never blocks on an empty reason. Do not add a mandatory-lost-reason rule to the new backend without an explicit new decision to diverge from the PWA.

There is no "in-progress"/"Contacted"/"Quoted" intermediate state anywhere in the PWA's own status field — see §2 (those two values exist only in the V2 API vocabulary table, out of scope).

## 6. Follow-up Behavior

- **`addFollow(id)`** (line 2016) is the entire follow-up mechanism. Guard: `f_done` (Action Done) must be non-empty, else `toast("Enter action done");return`. `f_next` (Next Action) and `f_nd` (Next Action Date) are both optional — no guard on either.
- On success: `x.done`, `x.next`, `x.nextDate` are **overwritten** (not accumulated) with the new values; `x.review=today()` is refreshed; one entry `{d:today(), t: gv("f_done") + (gv("f_next") ? " | Next: "+gv("f_next") : "")}` is **appended** to `x.log`.
- **History/logging:** `log[]` is the only durable history of what was said in each follow-up (via its `t` text); the "live" `done`/`next`/`nextDate` fields reflect only the most recent follow-up.
- **Overdue/derived calculations:** two independent call sites derive "overdue" from the same raw fields, not from a stored/derived field:
  - `enqTable()`: `var overdue = x.status==="Open" && x.nextDate && x.nextDate<=today()` — used to add a `class="due"` CSS style to the Next Date cell in enquiry list/lost tables.
  - `followupPanel()` (dashboard, `sales` role only): `mine(DB.enquiries).filter(x => x.status==="Open" && x.nextDate && x.nextDate<=today())` — a live re-filter, not a cached counter.
  - Neither is stored on the Enquiry record itself; both are computed fresh from `nextDate`/`status` on every render.
- **Counters/dashboard values:** `segPanel()` aggregates `Open`/`Won`/`Lost` counts and value-sums per `seg`, computed on every render (not cached). `vDash()` computes `Open Enquiries` count/value and `Lost Enquiries` count/value the same way, for `sales`/`admin` roles only.
- **UI/state side effects:** `addFollow` calls `save()` (persist), `closeModal()`... actually there is no modal here (the follow-up form is inline on the detail page, not a modal) — corrected: it calls `nav("enq", id)` (re-render the same detail page) and `toast("Follow-up added")`.
- No other PWA function reads or mutates `log`/`done`/`next`/`nextDate` besides the ones already listed (`addFollow`, the transition functions appending to `log`, and the read-only render/filter/CSV sites above).

## 7. Enquiry → SalesOrder Cascade

**Trigger:** the user clicks "✓ Confirmed → Create SO" on an `Open` enquiry's detail page, which calls `mSO(0, enqId)` to open the New SO modal, then the user clicks "Create SO & Send to Division + Finance", which calls `saveSO(0, enqId)`.

**Fields copied Enquiry → SO** (via `mSO`'s pre-fill of the draft, all editable before the user actually saves):
| Enquiry field | → | SO field | Transform |
|---|---|---|---|
| `name` | → | `project` | none |
| `phone` | → | `contacts[0].ph` | none (name/designation/email of contact 1, and all of contact 2, start empty) |
| `value` | → | `total` | none |
| `seg` | → | `div` | `"AMC"` → `"HVAC"`; every other value passes through unchanged |
| — | → | `start` | **not from Enquiry** — defaults to `today()` |
| — | → | `salesTeam` | **not from Enquiry** — defaults to the *current logged-in user's* `U.name` (i.e., whoever is converting it, not necessarily whoever created the enquiry — there is no enquiry-owner field to copy from anyway, see §4) |
| — | → | `terms` | **not from Enquiry** — a fixed boilerplate default string |

**Fields NOT copied at all:** `siteType`, `cap`, `ref`, `rating`, `remark`, `review`, `done`, `next`, `nextDate`, `log`, `lostReason`, `lostDate`, `co` (SO gets its own `co:U.co`, which is the same value in practice but is independently re-derived, not literally copied).

**Conditions required for conversion:** none beyond the UI gate (`status==="Open"`) — there is no additional guard in `saveSO` itself checking the enquiry's state; if `enqId` is truthy, the Won-transition block runs unconditionally, whatever the enquiry's current status happens to be at that moment (in practice always `Open`, since that's the only state the button is reachable from).

**Enquiry status update:** `status="Won"`, `remark` overwritten, one `log` entry appended (§5).

**Duplicate/repeat conversion behavior:** **verified PWA quirk — nothing prevents converting the same Enquiry to a second SO.** Once `Won`, the "Confirmed → Create SO" button disappears from that enquiry's own detail page (gated on `status==="Open"`), so the *direct* per-enquiry path is single-use in practice. However, `mSO()` with no `enqId` (a **fresh, non-enquiry-linked** SO) can still be created independently by `sales`/`admin` at any time via the SO list's "+ New SO" button — the PWA does not prevent a company from having more Enquiries than SOs or vice versa; there is no hard 1:1 enforced anywhere (already correctly noted as such in the existing `DATABASE_SCHEMA.md` §`salesOrders`).

**Relationship/reference created:** **verified — the SalesOrder record itself carries NO field pointing back to the originating Enquiry.** `saveSO`'s `d`/`so` object has no `enqId`/`enquiryId` field; the only place the link is recorded is the one-way pointer already established on the Enquiry side (`remark` text + `log` text mentioning the SO number) and matching `so.project === e.name` "by convention" (not a real foreign key). This is a genuine, verified PWA gap — the new backend should decide explicitly whether to add a durable `originatingEnquiryId` on SalesOrder (this is a natural NEW BACKEND DESIGN opportunity, not something to silently invent as if it were a PWA fact).

**Notifications triggered:** exactly two `notify()` calls fire, **on SO creation itself**, not distinctly "because" of the Enquiry conversion — they fire identically whether or not `enqId` was passed:
1. `notify([divisionPMRole, "admin"], "New SO-<no> received from Sales: <project> (<div>). Project created — assign engineer.")` where `divisionPMRole` is `hvac_pm`/`solar_pm`/`mep_pm` matched from `so.div`.
2. `notify(["finance"], "New SO-<no> (<project>): payment terms added to pending payment list.")`

**Downstream cascade (initiated by the same `saveSO` call, not gated on `enqId` either):**
- Exactly one **Project** is created: `{co, soNo:so.no, div:so.div, name:so.project, siteType:"", cap:"", customer:(contact1 name)||"", stage:STAGES[so.div][0], start:so.start, end:so.end, engs:[], vendor:"", status:"Ongoing", chkName, chk:[...from template...], updates:[], dc:[]}` — note `siteType`/`cap` are **not** carried over from either the Enquiry or the SO (left blank on the Project, even though the Enquiry had both).
- Zero or more **Payment** records: one per SO payment milestone where `!milestone.rcv` (not yet received) — `Won` conversion itself creates no Payment directly; it's the SO-save logic that does, and it runs whether or not the SO came from an Enquiry.
- No **Checklist**/**Contract** record is created directly at this point — the Project's `chk[]` array is populated inline from the division's default `ChecklistTemplate` (`defaultChkList`), not a separate document.

**Do not stop at "Enquiry creates SalesOrder":** confirmed — the full attributable cascade from a single "Create SO" click (when it happens to have come from an Enquiry) is: 1 Enquiry status mutation + 1 SalesOrder + 1 Project + 0..5 Payments + 2 notifications. Nothing else.

## 8. Role / Access Behavior

**Verified from `MENUS` (line 1289) and inline button/role checks — not inferred from role names:**

| Role | Sees "Enquiries"/"Lost Enquiries" menu items? | Can create (button visible)? | Can edit? | Can mark Lost? | Can reopen? | Can convert to SO? | Division-specific restriction? |
|---|---|---|---|---|---|---|---|
| `sales` | Yes (`enquiries`, `sos`, `lost`) | **Yes** (`U.role!=="admin"` → true) | Yes (no role gate on Edit button) | Yes (no role gate) | Yes (no role gate) | Yes (no role gate on the button itself, though `mSO`'s "+ New SO" list button is gated to `sales`/`admin` — the enquiry-detail conversion button has no separate gate) | none — `seg` options are limited to the company's subscribed divisions plus AMC, but this is a form-input constraint, not an access restriction |
| `admin` | Yes | **No** — `(U.role!=="admin" ? <button>...</button> : "")` explicitly hides the "+ New Enquiry" button for admin | Yes | Yes | Yes | Yes | none |
| `super` | **No** — `MENUS.super` has no `enquiries`/`lost`/`enq` entry at all; `super`'s dashboard is `superDash()`, a cross-company subscription/revenue view, not per-tenant business data | n/a | n/a (no menu path in; `mine()` also wouldn't apply since `super` operates across companies) | n/a | n/a | n/a | `super` operates above the company scope entirely (platform administration) |
| `hvac_pm`, `solar_pm`, `mep_pm` | No | No | No | No | No | No | Menus have no Enquiry-related entries at all |
| `engineer`, `inventory`, `service_mgr`, `service_eng`, `finance` | No | No | No | No | No | No | Menus have no Enquiry-related entries at all |

**Critical verified fact:** the PWA has **no server-side (or code-level) authorization check on the Enquiry view functions themselves.** `nav(v, p)` renders `R[v]()` unconditionally for whatever view name is passed — there is no `if (!allowed) return "Forbidden"` anywhere in `nav()`, `vEnq()`, `saveEnq()`, `addFollow()`, `doMarkLost()`, or `reopenEnq()`. **All of the role restrictions above are enforced purely by which buttons/menu-items the UI happens to render for a given role** — i.e., this is client-side-only, "security by absence of a link," not real authorization. This is a foundational fact the new backend MUST NOT copy: real server-side role/tenant enforcement must be added (the already-completed Foundation Implementation task's `requireRole`/tenant-guard middleware is the correct new-backend answer; it did not exist in any form in the PWA).

**Company/tenant filtering:** every Enquiry read path goes through `mine(DB.enquiries)` (`x.co===U.co||x.co===String(U.co)`), i.e., always scoped to the logged-in user's own company — this part is a genuine, consistent PWA fact across every view (list, lost, dashboard, `segPanel`, CSV export).

## 9. Notifications / Side Effects

**Zero `notify()` calls exist for Enquiry's own lifecycle events** — verified by inspecting every function in §4–§6 (`saveEnq`, `addFollow`, `doMarkLost`, `reopenEnq`): none of them call `notify()`. The **only** notifications attributable (indirectly) to an Enquiry are the two fired by `saveSO()` on SO creation, documented in full in §7 — and those fire identically for a from-Enquiry or a from-scratch SO; they are not really "Enquiry notifications," they are SO-creation notifications.

There is no notification on: Enquiry create, Enquiry edit, follow-up added, marked Lost, or reopened. There is no throttle/deduplication logic anywhere in `notify()` itself (it's an unconditional push to `DB.notifs`).

## 10. Search / Filter / Dashboard / Report Usage

Every observed place Enquiry data is listed, searched, filtered, counted, or displayed — a backend implementation must be able to reproduce all of these:

- **Enquiry List** (`vEnquiries`) — all non-Lost, company-scoped, filtered via `applyEnqFilt`, reverse-chronological (`.reverse()`, i.e. newest-created-first via array order, not sorted by any date field).
- **Lost Enquiries** (`vLost`) — all Lost, company-scoped, same filter mechanism, plus two KPI cards (count, total lost value).
- **Filter bar** (`enqFilterBar`/`applyEnqFilt`) — free-text search across `name+phone+ref+seg+siteType+next+done+remark+cap` (case-insensitive substring); exact-match filters on `seg`, `siteType`, `rating`, `status` (list/lost only), `ref`; range filters on `value` (`vmin`/`vmax`), `review` date (`from`/`to`), `nextDate` (`ndFrom`/`ndTo`).
- **CSV export** (`dlEnq`) — exports exactly: Sr(id), Project/Address, Site Type, Capacity, Customer Phone, Reference, Segment, Review Date, Rating, Action Done, Next Action Date, Next Action, Remark, Project Value, Status — plus a totals row. Filename `enquiries-<date>.csv` or `lost-enquiries-<date>.csv` depending on view. (`dlEnqReport` at line 3566 is just an alias calling `dlEnq()`.)
- **Dashboard KPIs** (`vDash`, `sales`/`admin` only): Open Enquiries count + value, Lost Enquiries count + value.
- **Segment-wise panel** (`segPanel`, `sales`/`admin` dashboard): per-segment (`seg`) totals of count/value split by Open/Won/Lost; clicking a row navigates to the filtered Enquiry List (`goSeg`).
- **Follow-ups due today panel** (`followupPanel`, `sales` role dashboard **only** — **not** shown to `admin`, verified: `if(U.role==="sales")h+=followupPanel()`): lists Open enquiries with `nextDate<=today()`.
- **Company-level admin rollup** (`coStats`, used by `super`'s `vCompanies`/`vUsage`): per-company enquiry count, open count, and total value — cross-tenant, `super`-only, reads `DB.enquiries` directly (not `mine()`, since `super` isn't scoped to one company).

## 11. Relationships / Dependencies

```
Company
  ↓ (co field, tenant scope)
User (no true "ownership" field on Enquiry — see §4)
  ↓ (creates/edits, but not referenced by ID on the record)
Enquiry
  ↓ (saveSO, one-directional — no back-reference exists on SalesOrder, see §7)
SalesOrder
  ↓ (created atomically with the SO, always — not specific to the Enquiry path)
Project
  ↓ (unpaid payment milestones only)
Payment
  ↓ (fires alongside SO/Project creation — not a further hop from Project)
Notification (division-PM/admin, finance)
```

Only relationships actually exercised by the PWA source are included above. There is no Enquiry → Checklist, Enquiry → Contract, or Enquiry → ServiceCall relationship of any kind.

## 12. Data Integrity / Edge Cases (literal behavior, not "fixed")

- **Empty optional values:** `cap`, `phone`, `ref`, `remark` can all be empty strings with no consequence; `value` falls back to `0`; these render as `"-"` via `x.field||"-"` at display time only — the stored value is genuinely `""`/`0`, not `null`/absent.
- **Repeated edits:** editing the same enquiry any number of times via `mEnq`/`saveEnq` overwrites the 8 editable fields each time with no history retained (no `log` entry, no prior-value snapshot) — see quirk below.
- **Reopen after Lost:** `reopenEnq` sets `status="Open"` and logs the reopen, but **does not clear `lostReason`/`lostDate`** — these two fields remain set (though hidden from the detail view while `status!=="Lost"`, since `vEnq()` only renders that block conditionally). If the enquiry is never marked Lost again, these stale fields persist indefinitely in the data.
- **Won conversion:** verified idempotency gap — `saveSO` unconditionally sets `status="Won"` when `enqId` is passed, with no check that the enquiry is currently `Open`. In practice this is unreachable via the UI (the button only appears for `Open` enquiries), but the function itself has no defensive guard.
- **Duplicate conversion attempts:** see §7 — not prevented at the data-model level, only discouraged by the button disappearing once `Won`.
- **Deleted/missing references:** `vEnq()` guards `if(!x)return"Not found"` for a missing enquiry id; `mSO(0, enqId)` does **not** guard — if `enqId` pointed at a since-deleted enquiry (impossible today since nothing deletes enquiries, but structurally unguarded), `e` would be `null` and every `e.xxx` access in `mSO`'s draft-object construction would throw. Not exploitable today only because nothing in the PWA ever deletes an Enquiry.
- **Missing users:** N/A — no user-reference field exists on Enquiry.
- **Missing company:** N/A within a single session (`U.co` always resolves to the logged-in user's own company).
- **Unusual statuses:** none reachable — the only three string literals ever assigned to `status` are `"Open"`, `"Won"`, `"Lost"` (verified by grepping every `.status=` assignment site for Enquiry).
- **Invalid dates:** `review`/`lostDate` are always `today()` (system-generated, always valid); `nextDate` is a raw `<input type="date">` value with no validation — an empty string is valid (treated as "no next action date" everywhere it's read) and no cross-check exists ensuring `nextDate >= today()` or `nextDate >= review`.

## 13. PWA Quirks / Bugs Requiring Explicit New-Backend Decision

Classified per instruction — **A. PWA fact**, **B. PWA bug/quirk**, **C. NEW BACKEND DESIGN DECISION** (nothing below has been silently resolved):

1. **(B)** Direct field edits (`name`/`siteType`/`cap`/`seg`/`phone`/`ref`/`rating`/`value`/`remark` via `mEnq`/`saveEnq`) create **no audit-log entry and no prior-value history** — only follow-ups, Lost, Reopen, and Won append to `log`. **(C)** Whether the new backend should add edit-history tracking for these fields, or preserve the PWA's fidelity of "only follow-up/status-change events are logged," is undecided.
2. **(B)** Reopening a Lost enquiry does **not** clear `lostReason`/`lostDate` — they remain in the record (merely hidden by status-gated UI) until the enquiry is marked Lost again (which then overwrites them) or forever if it never is. **(C)** Whether the new backend should clear these fields on reopen (cleaner data model) or preserve the PWA's literal stale-field behavior is an explicit open decision.
3. **(B)** `saveSO`'s Won-transition (`e.status="Won"`) has **no guard** verifying the enquiry's current status is `Open` before transitioning — unreachable via UI today, but not defended in the function itself. **(C)** Whether the new backend's conversion service should add this guard (recommended) is a decision, not a silent PWA fact to copy as-is.
4. **(A)** `id` generation (`DB.seq.enq++`) and, separately, SalesOrder's `no` generation (`DB.seq.so++`) are both driven by a **single, global (not per-company) in-memory counter object** (`DB.seq`), shared across every tenant in this single-instance demo app. This is consistent with the pattern already identified and already correctly resolved for `salesOrders.orderNumber` in the existing `DATABASE_SCHEMA.md` (**C**, already decided there: per-company counters via a `counters` collection). Enquiry itself has **no user-facing display sequence at all** (its PWA `id` is never shown as a formatted number to the user) — this audit finds **no new decision needed** for Enquiry specifically; flagged here only for completeness/consistency.
5. **(B)** SalesOrder carries **no back-reference to its originating Enquiry** (`enqId`/`enquiryId` is never stored on the SO record) — the only link is one-directional (Enquiry → its own `remark`/`log` text mentioning the SO number) plus an informal `project`-name match. **(C)** Whether the new backend should add a durable `originatingEnquiryId` (or equivalent) field on SalesOrder is an explicit, undecided design opportunity (distinct from copying a PWA fact, since the PWA has no such field to copy).
6. **(A)** Lost reason is optional, confirmed as instructed — no mandatory-reason rule exists or should be invented.
7. **(A)** There is no server-side/code-level authorization on any Enquiry action — every restriction in §8 is UI-rendering-only. **(C)** The new backend must design real server-side role/tenant authorization for Enquiry actions from scratch (using the already-implemented `requireRole`/tenant-guard middleware as the mechanism) — this is not something to be inferred from the PWA's absence of any such check, since "no check" is not a design to preserve.
8. **(A)** `admin` cannot create a new Enquiry via the UI (button hidden), but **can** edit/mark-lost/reopen/convert-to-SO any existing one, with no restriction. This nuance (create vs. every other action) should be reflected precisely — not simplified to "admin views across divisions" (see §14 DOC GAP).
9. **(A)** `followupPanel()` (the "Follow-ups due today" dashboard widget) is shown to `sales` only, **not** to `admin`, even though `admin` can otherwise fully interact with Enquiries. Not obviously a bug (may be intentional, since `admin` has broader cross-module dashboard content already), but flagged as a literal, verified fact that could otherwise be assumed symmetrical with `sales` and isn't.
10. **(A)** `Contacted`/`Quoted` are not real PWA Enquiry states — they exist solely in the out-of-scope V2 API vocabulary mapping (`ENQ_OUT`/`ENQ_IN`). Do not add them to the new backend's status enum under the belief they are PWA-observed states.

## 14. Field-by-Field Coverage Table

| PWA Field | Type/Shape | Required? | Default | PWA Create/Update Behavior | PWA Read Usage | Relationships | Side Effects | New-App Representation | Coverage Status | Notes / Decision |
|---|---|---|---|---|---|---|---|---|---|---|
| `id` | Integer | required | global counter | set once at creation | primary key everywhere | — | none | `_id` (ObjectId) | COVERED (existing DATABASE_SCHEMA.md §3) | id-generation scheme is not literally portable (global→per-company already the established pattern elsewhere); no new decision needed since no display sequence is shown for Enquiry |
| `co` | Integer | required | `U.co` | set once at creation | tenant filter everywhere | → Company | none | `companyId` (ObjectId ref) | COVERED | — |
| `name` | String | required | — | free text | list/detail/CSV/search | — | none | `name` | COVERED | — |
| `siteType` | String enum (6 values) | optional | `"Residential"` (form default only) | picklist | list/detail/filter/CSV | — | none | `siteType` enum | COVERED | existing doc's enum list matches exactly |
| `cap` | String | optional | `""` | free text | list/detail/CSV | — | none | `capacity` | COVERED | — |
| `phone` | String | optional | `""` | free text | list/detail/CSV; copied to SO contact | — | none | `phone` | COVERED | — |
| `ref` | String | optional | `""` | free text (filter dropdown built from existing values only) | list/detail/CSV/filter | — | none | `referenceSource` | COVERED | — |
| `seg` | String (division or "AMC") | required (always has a value) | `"HVAC"` | picklist, company-divisions + AMC | list/detail/filter/CSV/segPanel; drives SO default division | conceptually → Division | none | `segment` | COVERED | existing doc already notes "a division, or AMC" |
| `rating` | Number 1–5 | optional (always has a value) | `3` | picklist | list (stars)/detail/filter | — | none | `rating` | COVERED | — |
| `value` | Number | optional | `0` | numeric input | list/detail/CSV/dashboard/segPanel; copied to SO total | — | none | `estimatedValue` | COVERED | — |
| `remark` | String | optional | `""` | free text; **overwritten by system on Won conversion** | detail/CSV/search | — | overwritten on Won | `remark` | DOC GAP | existing DOMAIN_MODEL.md doesn't call out that Won conversion overwrites this field programmatically |
| `review` | Date | system, always set | `today()` | refreshed on every follow-up | filter/CSV | — | none | `lastReviewDate` | COVERED | existing doc already documents this |
| `done` | String | optional | `""` | **overwritten** (not appended) each follow-up | list/detail/CSV | — | none | `lastActionDone` | COVERED | existing doc's naming matches |
| `next` | String | optional | `""` | overwritten each follow-up | list/detail/CSV/followupPanel | — | none | `nextActionDescription` | COVERED | — |
| `nextDate` | Date | optional | `""` | overwritten each follow-up | list (overdue)/detail/filter/CSV/followupPanel | — | none | `nextActionDate` | COVERED | — |
| `status` | Enum `Open\|Won\|Lost` | required | `"Open"` | set only by transition functions | everywhere | drives SO creation | notifications (via SO, not directly) | `status` enum | DOC GAP | existing docs already correct on the 3-value enum but should explicitly note `Contacted`/`Quoted` are API-layer-only and must NOT be added |
| `log` | [{date,text}] embedded | required, `[]` default | `[]` | **append-only**; NOT appended on direct field edits | detail page, newest-first | — | — | `followUpLog` | DOC GAP | existing doc doesn't state that direct field edits leave no log trace (§13 item 1) |
| `lostReason` | String | optional (verified) | absent | set on Lost; **not cleared on reopen** | detail (Lost only) | — | — | `lostReason` | DOC GAP | existing doc doesn't mention the reopen-doesn't-clear quirk (§13 item 2) |
| `lostDate` | Date | optional | absent | set on Lost; not cleared on reopen | detail (Lost only) | — | — | `lostDate` | DOC GAP | same as above |

## 15. Workflow Coverage Table

| PWA Workflow | Trigger | Preconditions | State Changes | Related Entities | Notifications | Derived/Calculated Effects | New-App Coverage | Gap/Decision |
|---|---|---|---|---|---|---|---|---|
| Create Enquiry | `saveEnq(0)` | `name` non-empty; UI button hidden for `admin` | new Enquiry, `status="Open"` | Company (tenant scope) | none | none | DOC GAP | doc should state create is `sales`-only via UI (not "sales or admin") |
| Edit Enquiry | `saveEnq(id)` | `name` non-empty | 8 fields overwritten | — | none | none | DOC GAP | doc should note no log entry results from this |
| Add Follow-up | `addFollow(id)` | `f_done` non-empty | `done`/`next`/`nextDate`/`review` overwritten; `log` appended | — | none | overdue flag (computed at render, not stored) | COVERED | — |
| Mark Lost | `markLost`→`doMarkLost(id)` | UI-gated to `status==="Open"`; reason optional | `status="Lost"`, `lostReason`, `lostDate` set; `log` appended | — | none | — | COVERED (reason-optional already documented) | — |
| Reopen | `reopenEnq(id)` | UI-gated to `status==="Lost"` | `status="Open"`; `log` appended | — | none | — | DOC GAP | doc should note `lostReason`/`lostDate` are NOT cleared |
| Convert to Sales Order | `mSO(0,enqId)` → `saveSO(0,enqId)` | UI-gated to `status==="Open"` (not enforced in `saveSO` itself) | Enquiry: `status="Won"`, `remark`, `log`. Creates: 1 SalesOrder, 1 Project, 0–5 Payments | SalesOrder, Project, Payment | 2 (division PM+admin; finance) | checklist populated from division default template | DOC GAP | doc should note: no back-reference from SO to Enquiry exists; fields NOT copied; notifications are SO-creation notifications, not Enquiry-specific |
| Filter/Search | `applyEnqFilt` | — | none (read-only) | — | — | — | COVERED | — |
| CSV Export | `dlEnq()` | — | none (read-only) | — | — | — | COVERED | — |
| Dashboard/Segment Reporting | `vDash`, `segPanel`, `followupPanel`, `coStats` | role-gated (see §8/§10) | none (read-only) | — | — | live aggregation, not cached | DOC GAP | doc doesn't currently note `followupPanel` is `sales`-only (not `admin`) |

## 16. Implementation Readiness

- **COVERED:** `id`/`co`/`name`/`siteType`/`cap`/`phone`/`ref`/`seg`/`rating`/`value`/`review`/`done`/`next`/`nextDate` field shapes; Lost-reason-optional rule; Open↔Won↔Lost 3-value enum; append-only `log`; filter/search/CSV/dashboard read-paths; tenant scoping via `co`.
- **DOC GAP:** (1) "Create: by sales (or admin)" should read "Create: by `sales` only via the UI; `admin` cannot create but can edit/mark-lost/reopen/convert any enquiry"; (2) `remark` is programmatically overwritten on Won conversion; (3) direct field edits leave no audit trail; (4) reopen does not clear `lostReason`/`lostDate`; (5) SalesOrder has no back-reference to its originating Enquiry, and the exact copied/not-copied field list from §7 should be recorded; (6) `followupPanel` is `sales`-only, not `admin`; (7) explicitly exclude `Contacted`/`Quoted` from the status enum as V2-API-only vocabulary.
- **SCHEMA GAP:** none identified — the existing `enquiries` schema in `DATABASE_SCHEMA.md` already matches every field found in this audit; no model correction is required by this audit alone.
- **DESIGN DECISION (new, not previously recorded):** (a) whether to add edit-history tracking for direct field edits; (b) whether to clear `lostReason`/`lostDate` on reopen; (c) whether to guard the Won-transition against a non-Open current status; (d) whether to add a durable `originatingEnquiryId` back-reference on SalesOrder.
- **PWA BUG/QUIRK (preserve-or-change decision required, not silently chosen):** items 1–5 in §13.
- **NOT APPLICABLE:** `super` role (no Enquiry access at all); missing-user/missing-company edge cases (no such fields/scenarios exist for Enquiry).

## 17. Final Gap List

1. DOC GAP — `new-app/docs/DOMAIN_MODEL.md` §3 "Create: by `sales` (or `admin`)" is imprecise; should distinguish create (sales-only via UI) from all other actions (both sales and admin, ungated).
2. DOC GAP — neither `DOMAIN_MODEL.md` nor `DATABASE_SCHEMA.md` currently notes that `remark` is overwritten by the system on Won conversion.
3. DOC GAP — neither doc notes that direct field edits (via the edit modal) leave no `log`/history trace, unlike follow-ups and status transitions.
4. DOC GAP — neither doc notes that `reopenEnq` does not clear `lostReason`/`lostDate`.
5. DOC GAP — `DATABASE_SCHEMA.md`'s `salesOrders` section does not record which Enquiry fields are/aren't copied on conversion, nor that no back-reference to the Enquiry exists on the SO record.
6. DOC GAP — neither doc notes `followupPanel`'s dashboard visibility is `sales`-only (not `admin`).
7. DOC GAP — neither doc explicitly excludes `Contacted`/`Quoted` (V2-API-only vocabulary) from the Enquiry status enum; worth an explicit note given how easy it would be to import the wrong vocabulary from a superficial code read.
8. DESIGN DECISION — edit-history tracking for direct field edits: preserve PWA's no-history behavior, or add tracking? (undecided)
9. DESIGN DECISION — clear `lostReason`/`lostDate` on reopen, or preserve PWA's stale-field retention? (undecided)
10. DESIGN DECISION — guard the Won transition against a non-`Open` current status? (undecided; recommended but not decided here)
11. DESIGN DECISION — add a durable `originatingEnquiryId` back-reference on SalesOrder? (undecided)
12. SCHEMA GAP — none found; existing `enquiries` schema is already accurate.

**No Enquiry implementation (model/service/route/controller/frontend) exists as a result of this task.** This document is the complete deliverable.
