# PWA Coverage Audit — SalesOrder Module

**READ-ONLY audit. No SalesOrder implementation exists as a result of this document.**

## 1. Scope / Source

- **Authoritative source:** literal functional source of `MEP_PROJECTS_PWA/index.html` (md5
  `111b53dba91704f96b83dae96c7793c6`, unchanged by this task). Only the local/`else`-branch
  behavior is in scope — the `API_BASE`/`TOKEN`/`SOCKET`/`API_MODE`/`fetch`/`api()` backend-sync
  layer is explicitly excluded (V2-connection-patch material).
- **Read for comparison only, never as ground truth:** `PWA_COVERAGE_AUDIT_ENQUIRY.md`,
  `DOMAIN_MODEL.md`, `DATABASE_SCHEMA.md`, `OPEN_DECISIONS.md`,
  `new-app/backend/src/models/{SalesOrder.js, Project.js, Payment.js, Notification.js,
  ChecklistTemplate.js}`, `new-app/backend/src/services/enquiryService.js`.
- Every fact below was independently re-verified against `MEP_PROJECTS_PWA/index.html` in this
  task (line numbers cited are from that file as it exists at audit time). Where the existing
  `new-app` code/docs already stated the same fact, that agreement is noted — it is **not**
  treated as a substitute for verification.
- V1 (`server/`), V2 (`v2/`), V3 (`v3/`), and the current PWA were **not** used as architectural
  reference and were **not** modified. No source file was modified by this task.

## 2. PWA Assumptions Made Explicit

- The PWA has **no server-side authorization**. All "role" behavior below is UI-only: a menu
  item not rendered, a button not rendered, or a value blanked out in a view function. Nothing
  stops a user with browser devtools access (or a modified request in `API_MODE`, which is out of
  scope) from performing any action their role's UI merely hides. This audit calls out every case
  where a role check is UI-only rather than inferring a "real" restriction from a role's name.
- "SalesOrder" in this document means the PWA's in-memory `DB.sos` row shape (`so` object) and the
  functions in `MEP_PROJECTS_PWA/index.html` that create, edit, view, list, and report on it —
  not `new-app`'s `SalesOrder.js` Mongoose schema, which is compared against these facts in §19-20.
- The current Enquiry implementation (`enquiryService.js`) is **not** assumed correct because its
  tests pass. §5 re-derives the conversion cascade independently from PWA source and only then
  compares it against the existing code.
- Payment/milestone-status behavior is derived directly from `MEP_PROJECTS_PWA/index.html`
  (`payRcvd`, `payBal`, `syncPayStatus`, `addPayment`, `mRaise`/`doRaise`, `payPanel`,
  `mPayHistory`, etc.), **not** assumed from `new-app/backend/src/models/Payment.js`'s own
  comments/invariants, even where they happen to agree.

## 3. Exact Entity Inventory

The PWA's SalesOrder (`so` object, `DB.sos` array) has no explicit schema — it is whatever
`saveSO` (line 2075) assembles. Verified field-by-field from `mSO`/`saveSO`/`vSO`/`vSOs`/`dlSOs`:

| Field | Type / shape | Verified source |
|---|---|---|
| `id` | internal array index id, `Math.max(...DB.sos.map(id))+1` | `saveSO` L2083 |
| `co` | company id (tenant) | `saveSO` L2083 |
| `no` | display order number, `DB.seq.so` (company-wide counter, pre-incremented) | `saveSO` L2082-2083 |
| `div` | one of `HVAC`/`Solar`/`MEP` | `mSO` L2050-2051, `so_div` select restricted to `myDivs()` |
| `project` | project name (free text, required) | `saveSO` L2076 guard |
| `start` | date, defaults to `today()` on create | `mSO` L2050 |
| `end` | date, optional | `mSO`/`saveSO` |
| `addr` | site address, free text, optional | `mSO`/`saveSO` |
| `contacts` | array of exactly 2 slots `{n,dg,ph,em}` (name, designation, phone, email) — `em` is captured in the form model but **never has an input field in the modal** (always saved as `""`) | `mSO` L2054-2055, `saveSO` L2077 |
| `salesTeam` | free text, defaults to `U.name` (creating user) on new SO | `mSO`/`saveSO` |
| `projTeam` | free text, optional | `mSO`/`saveSO` |
| `crucial` | "Crucial Points" free text, optional | `mSO`/`saveSO` |
| `total` | Total Project Cost (number) | `mSO`/`saveSO` |
| `hsSell` | High Side Selling (number) | `mSO`/`saveSO` |
| `hsPur` | High Side Purchase (number) | `mSO`/`saveSO` |
| `lsCost` | Low Side Cost (number) | `mSO`/`saveSO` |
| `lsTarget` | Low Side Target Expense (number) | `mSO`/`saveSO` |
| `lsActual` | Low Side Actual Expense (number) | `mSO`/`saveSO` |
| `terms` | Terms & Conditions, defaults to fixed boilerplate on create, freely editable | `mSO` L2050 default string, `saveSO` |
| `pay` | array of **at most 5** milestone rows `{d,a,rcv}` (description, amount, received-flag) — only rows where **both** description and amount are truthy are kept; unfilled milestone slots (1-5) are silently dropped, never stored as empty placeholders | `saveSO` L2076 (`for(i<5){...if(d&&a)pay.push(...)}`) |

No `siteType`/`capacity`/`customer` field exists directly on the SalesOrder itself — those live
only on the spawned Project (customer is derived from `contacts[0].n` at Project-creation time,
see §9).

**Margin (derived, never stored):** `(hsSell-hsPur)+(lsCost-(lsActual||lsTarget))` — computed on
the fly in `vSO` (L2109) and in `dlSOs` (L3492), not persisted on the `so` object.

## 4. Creation Paths — TWO independent paths, not one

This is the most important structural finding of this audit. The PWA has **two** distinct ways to
create a SalesOrder, both funneling into the same `mSO(id, enqId)` / `saveSO(id, enqId)` pair:

1. **From an Enquiry conversion** — `mSO(0, enqId)` is called with an Enquiry id, pre-filling the
   form from that Enquiry (see §5) and, on save, transitioning the Enquiry to Won.
2. **Standalone — "+ New SO"** — the Sales Orders list (`vSOs`, L2035-2044) renders a
   `+ New SO` button, **visible only to `U.role==="sales"||U.role==="admin"`** (L2039), that calls
   `mSO()` with **no arguments at all** — `id` and `enqId` are both `undefined`/falsy. `mSO`'s own
   fallback object (L2051) then defaults every Enquiry-derived field to blank/`today()`/`U.name`
   with `e` = `null`, and `saveSO`'s `if(enqId){...}` block (L2091) simply does not run — no
   Enquiry is touched, ever.

**Fact, not a bug:** a SalesOrder — and therefore a Project — can be created with **no Enquiry
behind it at all**. `DOMAIN_MODEL.md`'s SalesOrder "Required" line already anticipates this
("an enquiry reference OR a direct fresh SO"), which this audit confirms is accurate. **The
current `new-app` implementation only builds the Enquiry-conversion path
(`convertEnquiryToSalesOrder`) — the standalone creation path has no implementation at all.** This
is a real gap, not scope creep to fix here (see §21).

Both paths share **all** subsequent creation-time cascade behavior (Project + Payments +
notifications) identically — the only difference is whether `enqId` is truthy.

## 5. Enquiry → SalesOrder Conversion Cascade — independently re-verified

Re-derived fresh from `mSO`/`saveSO` (L2050-2097), not from `enquiryService.js`:

**Pre-fill (`mSO(0, enqId)`, L2050-2051):**
- `div` = `e.seg==="AMC" ? "HVAC" : e.seg` (segment→division transform, `"AMC"` maps to `"HVAC"`,
  everything else passes through unchanged)
- `project` = `e.name`
- `contacts[0].ph` = `e.phone` (only the phone is pre-filled on contact 1; name/designation/email
  are blank)
- `total` = `e.value`
- `start` = `today()`, `salesTeam` = `U.name` (the **converting user**, not any stored Enquiry
  owner — the Enquiry schema has no owner/salesperson field to copy from)
- `terms` = the fixed boilerplate string (same default as the standalone path — **not** derived
  from the Enquiry in any way)
- Everything else (`end`, `addr`, `contacts[1]`, `projTeam`, `crucial`, `hsSell`, `hsPur`,
  `lsCost`, `lsTarget`, `lsActual`, `pay`) starts blank/empty regardless of path
- **Not copied at all** from the Enquiry: `siteType`, `capacity`, `referenceSource`, `rating`,
  `remark`, `lastReviewDate`, `lastActionDone`, `nextActionDescription`, `nextActionDate`,
  `followUpLog`, `lostReason`, `lostDate` — none of these have any SalesOrder-side counterpart
- All pre-filled values remain user-editable in the modal before save; nothing is locked

**On save (`saveSO(id, enqId)`, L2075-2097), only for a **new** SO (no pre-existing `id`):**
1. `DB.seq.so++`; `so.no` = the post-increment counter value (a straight, gapless-except-for-races
   integer counter, not zero-padded or prefixed by the PWA itself)
2. `so` pushed to `DB.sos`
3. **Project** created immediately (`DB.seq.proj++`): `soNo` = the new SO's `no`, `div` = SO's
   `div`, `name` = SO's `project`, **`siteType:""`, `cap:""`** (verified: literally hardcoded empty
   strings — never read from the Enquiry or the SO, even though the SO form has no such fields to
   read from either), `customer` = `(so.contacts[0]||{}).n||""` (i.e. **the SO's contact-1 name**,
   which for a conversion is blank unless the user typed one in — **not** the Enquiry's own
   `name`/`phone`), `stage` = `STAGES[so.div][0]` (division's first stage), `chkName`/`chk` seeded
   from `defaultChkList(so.div)` (falling back to `DB.templates[so.div]` legacy templates if no
   ChecklistTemplate exists — see §8), `status:"Ongoing"`, `engs:[]`, `vendor:""`, `updates:[]`,
   `dc:[]`
4. **Payments** — one `DB.payments` row created **per milestone that is not already `rcv:true`**
   (on a brand-new SO every milestone is fresh so this is simply "one per milestone present"):
   `project` = `so.project`, `person`/`phone` = `(so.contacts[0]||{}).n` / `.ph` (again, SO
   contact-1, not the Enquiry), `amount` = the milestone amount, `remark` =
   `"SO "+so.no+" milestone "+(i+1)+": "+p.d"` (exact literal), `status:"Pending"`, `soNo` =
   `so.no`, `mi` = the milestone's array index — **no `paid`/`raised` keys are set at all on
   creation** (both start `undefined`, treated as empty by `payRcvd`/`payBal`)
5. **Only if `enqId` is truthy:** the source Enquiry is fetched, `status` set to `"Won"`,
   `remark` overwritten to `"Converted to SO-"+so.no` (exact literal, **replacing** whatever
   remark was there before — not appended), and one `followUpLog` entry `{d:today(),
   t:"Confirmed. SO-"+so.no+" created."}` appended (exact literal text)
6. **Two notifications, always** (whether or not `enqId` was set — these fire for a standalone
   "+ New SO" too):
   - to `[so.div==="HVAC"?"hvac_pm":so.div==="Solar"?"solar_pm":"mep_pm", "admin"]`:
     `"New SO-"+so.no+" received from Sales: "+so.project+" ("+so.div+"). Project created — assign
     engineer."` (exact literal)
   - to `["finance"]`: `"New SO-"+so.no+" ("+so.project+"): payment terms added to pending
     payment list."` (exact literal)
7. **No status/precondition check on the Enquiry at all before conversion.** The "Convert" UI
   action (see Enquiry audit) only ever renders `mSO(0, enqId)` when the Enquiry's status is
   `Open`, but `saveSO` itself never re-checks `e.status` before overwriting it to `Won` — a
   second call with the same `enqId` (e.g. two browser tabs) would silently re-run steps 3-6
   again, creating a **second** Project and **second** set of Payments for the same Enquiry, with
   no duplicate/1:1 guard anywhere in the PWA. This matches — and is the literal PWA source for —
   the already-locked decision #19 in `OPEN_DECISIONS.md`.

**Comparison with `enquiryService.js`'s `convertEnquiryToSalesOrder`:** independently verified to
match this re-derivation field-for-field, including the not-copied `siteType`/`capacity`, the
`contacts[0]` (not Enquiry) sourcing of Project `customer` and Payment `person`/`phone`, the exact
literal remark/log/notification text, and the fixed terms boilerplate. The one deliberate,
already-locked deviation is decision #19=B (a real Open-status + duplicate-conversion guard was
added server-side, where the PWA has none) and decision #20=D (`enquiryId` populated, which the
PWA has no equivalent of at all). **No new discrepancy was found in the existing Enquiry-side
conversion code during this audit.**

## 6. Editing

`mSO(id)` with a truthy `id` and no `enqId` opens the same modal pre-filled from the existing SO
row (`DB.sos.find(...)`), including pre-filling all 5 milestone rows via `payRow(i, s.pay[i])`.
`saveSO(id, ...)` (L2077-2078, the `if(id){...}` branch) does a plain field merge
(`Object.assign(DB.sos.find(...), d)`) and **returns immediately** — no Project re-creation, no
new Payments, no notifications, no Enquiry interaction of any kind on edit. Division can be
changed via the edit form with **no re-derivation** of the linked Project's stage or checklist
(`DOMAIN_MODEL.md`'s existing note on this is accurate).

**Milestone edit-preservation rule** (`saveSO` L2076): when re-collecting the 5 milestone input
rows on an edit, each row's `rcv` flag is preserved from the **existing** SO's same-index milestone
(`(id&&DB.sos.find(...).pay[i]||{}).rcv||false`) — editing milestone amounts/descriptions never
resets a milestone that was already marked received back to unreceived, but it also means
**reordering or removing an earlier milestone row shifts every later row's preserved `rcv` flag
onto the wrong milestone** (index-based, not identity-based) — a genuine PWA quirk (see §16).
There is no synchronization back to the linked Payment record's `amount` when a milestone's
amount is edited this way (`mPayEdit`/`savePayEdit`, the Payment-side edit, does write back to
`so.pay[x.mi].a` — see §7 — but the SO-side edit modal does **not** write forward to the Payment
row's `amount`). This is a one-way desync risk between the two independently-editable copies of a
milestone's amount.

## 7. Commercial / Milestone Behavior

- Milestones are capped at exactly 5 rows in the UI (`payRow` loop, `i<5`); a milestone requires
  **both** a non-empty description and a non-zero amount to be kept — a description with no
  amount (or vice versa) is silently dropped on save, not rejected with an error.
- `rcv` (received) starts `false` for every milestone created via the SO save flow (§5 step 4);
  it becomes `true` only via `syncPayStatus` (§8), never edited directly on the SO record itself
  in any UI the audit found.
- Margin fields (`hsSell`, `hsPur`, `lsCost`, `lsTarget`, `lsActual`, and `total`) are pure numeric
  inputs with no validation beyond `Number(...)||0` — negative values, and a `lsActual` that
  contradicts `lsTarget`, are both silently accepted.

## 8. Payment Relationship — full finance trace (standing hard requirement, not a future module)

The SalesOrder↔Payment relationship is bidirectional and involves **two independent flags for the
same fact** that must be kept in sync by application code, never by the database:

- **On the SO side:** `so.pay[i].rcv` (boolean) — read by `vSOs`/`vSO`/`dlSOs` to render
  "Received"/"Pending" per milestone and the SO-level received/pending totals.
- **On the Payment side:** `payment.status` (`"Pending"`/`"Received"`, derived) and
  `payment.paid[]` (the actual part-payment ledger: `{amt, date, mode, ref, remark, inv, by,
  editedBy?, editedOn?}`).

**The single synchronization point is `syncPayStatus(x)`** (L3877-3882), called after every
mutation to a Payment's `paid[]` array (`addPayment`, `saveEditPayment`, `delPayment`) and after a
milestone-amount edit (`savePayEdit`):
```
bal = payBal(x)              // x.amount - sum(x.paid[].amt)
if (bal <= 0):
    x.status = "Received"; x.rcvDate = last paid[].date (or today() if paid[] empty)
    if x.soNo: so.pay[x.mi].rcv = true      // writes BACK to the SO
else:
    x.status = "Pending"; x.rcvDate = ""
    if x.soNo: so.pay[x.mi].rcv = false     // writes BACK to the SO (can flip back to false!)
```
This confirms **`rcv` can be un-set** — removing a `paid[]` entry (`delPayment`) or editing one
down below the milestone amount re-runs `syncPayStatus` and can flip a milestone from
"Received" back to "Pending" on the SO after the fact.

**Full lifecycle, verified function-by-function:**
- `payRcvd(x)` = sum of `x.paid[].amt`. `payBal(x)` = `max(0, x.amount - payRcvd(x))`.
- **Part-payment ledger (`addPayment`, L3813-3831):** appends `{amt, date, mode, ref, remark,
  inv, by:U.name}` to `x.paid[]`; **no cap on number of part-payments**; if the entered amount
  exceeds the current balance the UI asks for `confirm(...)` but still allows it (over-payment is
  possible and not blocked). Two different notifications fire depending on whether the resulting
  balance is fully cleared: `"Payment fully received..."` vs `"Part payment received..."`
  — both to `["admin","sales"]` (**not** to `finance`, the role that manages the panel itself).
- **Editing a part-payment entry (`mEditPayment`/`saveEditPayment`, L3846-3872):** any field
  (amount/date/mode/ref/remark/invoice) can be changed after the fact; stamps `editedBy`/
  `editedOn`; re-runs `syncPayStatus`. No cap check against "other entries total" is enforced —
  the modal displays a "max for this entry" hint but `saveEditPayment` does not actually reject an
  over-max value.
- **Deleting a part-payment entry (`delPayment`, L3913-3919):** removes one `paid[]` entry after a
  `confirm()`, re-runs `syncPayStatus`. **Deleting the whole Payment record (`delPayRow`,
  L3908-3912) is only offered in `mPayEdit`'s UI when `!x.soNo`** — an SO-linked Payment has no
  delete path anywhere in the PWA (confirms the existing `Payment.js` documentation).
- **Editing the milestone itself (`mPayEdit`/`savePayEdit`, L3878-3911):** lets a user change
  `project`/`amount`/`person`/`phone`/`remark`/`lastCall`/`nextCall`/`disc` on the Payment record
  directly; **rejects reducing `amount` below what's already received** (`if(amt<r)`); if
  `x.soNo` is set, writes the new amount **forward** onto `so.pay[x.mi].a` (the one place the
  Payment side pushes a change back onto the SO's own milestone array) — the reverse direction
  (editing the SO's own milestone amount) does **not** push forward to the Payment record (§6).
- **Raising a milestone to Finance (`mRaise`/`doRaise`, L2335-2360):** a Project-side action
  (visible to the PM), **not gated to any specific role check in code beyond menu access** (any
  role that can open a Project can call it), that either finds the existing Payment record for
  `(so.no, mi)` or **creates it on the fly if missing** (`if(!pr){...}`, same field shape as the
  original creation), then stamps `pr.raised = {by, role, date, note, dueBy, priority}`, appends a
  `disc` note, and notifies `["finance","admin"]` with an `⚠ URGENT` prefix if priority is Urgent.
  This means a Payment record page (§ "raised") can exist for a milestone even if the original
  SO-creation cascade's Payment row was somehow missing.
- **Follow-up on a pending payment (`mPayFollow`, seen via `nav("payments")` call sites, not fully
  quoted here since it is a plain `lastCall`/`disc`/`nextCall` field edit with no SO-side effect)
  — same shape as Enquiry follow-ups but on the `Payment` collection, no `rcv` interaction.**
- **Reports:** `dlPayments()`/`dlReceipts()` (Pending & Received Payments / Receipts Ledger CSVs)
  both trace the full `soNo` back-reference and `payBal`/`payRcvd` per row — confirmed the SO
  milestone ledger is fully reconstructable from Payment records alone via `soNo`+`mi`.

**`new-app` status:** **none of this synchronization exists yet.** `Payment.js` (model only, no
service) and `paymentMilestones[].received` on `SalesOrder.js` are both schema-only. The
`enquiryService.js` conversion cascade correctly creates the initial unreceived Payment rows
(§5), but there is no `syncPayStatus` equivalent, no add/edit/delete-part-payment logic, and no
`mRaise`/`doRaise` equivalent anywhere in `new-app`. This is the single largest functional gap
found by this audit (see §21) — Payment is not an "isolated future module" relative to
SalesOrder; the two are inseparable in the PWA and must be designed together.

## 9. Project Relationship

Already substantially traced in §5 step 3. Additional verified facts:
- `Project.soNo` links back by **display number** (`so.no`), not by internal id — matches
  `Project.js`'s documented unique index shape `{companyId, salesOrderId}` only if `new-app`
  intends `salesOrderId` to mean "the SO's id", which differs from the PWA's own by-`no` linkage;
  this is a **new-app internal modeling choice**, not a PWA fact, and is not itself a problem
  since `new-app`'s SalesOrder has a real `_id` to reference — flagged only so it is not mistaken
  for a literal PWA field name.
- Exactly one Project is ever created per SalesOrder, at SO-creation time only — confirmed no
  other code path pushes to `DB.projects` keyed by a `soNo` (Project is never created standalone,
  matching `DOMAIN_MODEL.md`'s existing claim).
- `projPayInfo(p)` (L2359-2364) is the read path Projects use to show Received/Pending/Next-due
  columns — it locates the SO by `soNo`, calls `paySum(so)` (§10), and additionally derives
  `next` = the first not-yet-`rcv` milestone, used for the Projects list's "Next Milestone Due"
  column.

## 10. Checklist Relationship

- `defaultChkList(div)` = `chkLists(div).filter(c=>c.def)[0] || chkLists(div)[0] || null` — i.e.
  "the template flagged default for this division, else whichever template for this division
  comes first, else none." Confirmed exact match with the already-implemented
  `checklistTemplateRepo.findDefaultForDivision` semantics used by `enquiryService.js`.
  **New/independently-verified fact:** if no ChecklistTemplate exists for the division at all,
  `saveSO` falls back to `DB.templates[so.div]` — a **separate, legacy, non-ChecklistTemplate
  hardcoded template object** (`chkName` left as `""` in that fallback case). This legacy
  `DB.templates` fallback has **no equivalent at all in `new-app`** (current code: `template ?
  template.items : []`, i.e. it falls back to an **empty checklist**, not the PWA's legacy
  hardcoded list) — a real, if minor, fidelity gap (§21).
- Checklist items are copied (not referenced) onto the Project at creation time — editing the
  ChecklistTemplate afterward never affects already-created Projects (confirms
  `DOMAIN_MODEL.md`'s "copied/embedded... then edited independently" note).

## 11. Notifications

Both SO-creation notifications (§5 step 6) go through the same local `notify(roles,text)` (L1267)
already documented for Enquiry: `{id:DB.seq.notif++, co:U.co, roles, text, date:today(), read:[]}`.
`roles` is always an array of literal role-name strings here (never the `"*"` wildcard, which is
used elsewhere in the PWA for company-wide broadcasts but not by any SO-related call site found).
Finance-related notifications (§8: full/part payment received, milestone raised) also go through
`notify()` — no distinct notification mechanism exists for Payments vs. SalesOrders.

## 12. Roles / Access — verified at the code level, not inferred from role names

| Action | PWA gate | Verified how |
|---|---|---|
| See "Sales Orders" menu item at all | `admin, sales, hvac_pm, solar_pm, mep_pm, finance` (`MENUS`, L1290-1301) | menu array membership, checked client-side only (`nav`'s `allowed` check, L1388) |
| "+ New SO" button rendered | `U.role==="sales"\|\|U.role==="admin"` | `vSOs` L2039 |
| "Edit" button rendered on SO detail | `U.role==="sales"\|\|U.role==="admin"` | `vSO` L2101 |
| Costing block rendered on SO detail | `U.role!=="engineer"&&U.role!=="service_eng"` (i.e. shown to everyone else, including `hvac_pm`/`solar_pm`/`mep_pm`/`finance`/`sales`/`admin`) | `vSO` L2102 `showCost` |
| Convert Enquiry → SO (renders `mSO(0,enqId)`) | gated the same way the Enquiry "Convert" button is gated (see Enquiry audit — `sales`/`admin`) | cross-checked, not re-derived here |
| `saveSO` itself (the actual write) | **no role check in the function body at all** — any role that can reach the modal (or call the function directly) can save | `saveSO` L2075-2097, no `U.role` reference anywhere in it |
| `mRaise`/`doRaise` (raise milestone to finance) | **no role check in the function body** — gated only by whichever menu exposes the "Raise" button on a Project | L2335-2360 |
| `addPayment`/`mEditPayment`/`delPayment` (Payment ledger mutation) | **no role check in the function body** — gated only by `payments` menu visibility (`admin`, `finance`) | L3799-3922 |
| CSV export (`dlSOs`) | same visibility as the "Sales Orders" screen itself | button rendered inline in `vSOs`/`payPanel`'s parent |

**Conclusion, stated explicitly per the task's instruction not to infer restrictions from role
names:** every SalesOrder/Payment-related restriction in the PWA is a **rendering** decision
(menu array membership or an inline ternary in an HTML-building function), never a check inside
the mutating function itself. There is **no** function-level enforcement anywhere in this module —
this is a stronger and more absolute statement than "some roles are UI-hidden": literally none of
`saveSO`, `mRaise`, `doRaise`, `addPayment`, `saveEditPayment`, `delPayment`, `savePayEdit` inspect
`U.role` at all. Any authenticated user of any role who can reach these functions (e.g. via
devtools) can call them successfully. The already-authorized `enquiryService.js` module explicitly
does **not** copy this weakness (it enforces `CREATE_ROLES`/`MANAGE_ROLES` server-side) — this
audit confirms that same discipline must extend to any future SalesOrder/Payment implementation:
reproducing the PWA's *visible* role gates (sales/admin for create+edit, finance+admin for
payment collection) is correct fidelity; reproducing its *absence of enforcement* would not be —
that absence is a PWA weakness, not a PWA requirement, exactly as `enquiryService.js`'s own header
comment already states the principle for Enquiry.

## 13. List / Search / Filter / Dashboard

- `vSOs()` (§3/§4 above): scoped by `mine()` (tenant) + `hasDiv()` (role's allowed divisions —
  `super` sees all divisions, everyone else only their own via `myDivs()`/`coDivs()`), searchable
  over `["no","project","div","addr","salesTeam","projTeam","start","total"]` via the generic
  `hit()` helper, sorted newest-first (`.reverse()`), no pagination (renders the full filtered set).
- Per-row computed columns: `rcv` = sum of `rcv:true` milestone amounts, `pen` = sum of the rest —
  **note this is the SO's own `pay[].rcv` flags, not `paySum()`'s Payment-record-aware
  calculation** — i.e. the list view and the CSV report (`dlSOs`, which does use `paySum`) can
  disagree if a Payment's part-payment ledger has cleared a milestone but `syncPayStatus` hasn't
  yet flipped `so.pay[i].rcv` for some reason (there is no code path where this desync can persist
  under normal operation since `syncPayStatus` runs synchronously, but it is a structural
  double-source-of-truth worth naming explicitly, distinct from `paySum`'s more careful
  reconciliation).
- Projects list (`vProjects`) and the delay/dashboard panels (`delayPanel`, `projPanel`) both pull
  `pi=projPayInfo(p)` for Received/Pending/Next-due columns — i.e. financial status is visible
  from the Project screen too, always via `paySum`, not the row-level `rcv` flags.
- No SalesOrder-specific dashboard KPIs were found distinct from what `vSOs`/`vPayments`/
  `projPanel` already surface.

## 14. Reports / Export

- **`dlSOs()`** (L3484-3496, "⬇ Report" button on the Sales Orders list): one CSV,
  `sales-orders-<date>.csv`, columns exactly: SO No, Division, Project, Site Address, Start, End,
  Sales Team, Project Team, Contact 1, Phone 1, Contact 2, Phone 2, Total Cost, High Side Selling,
  High Side Purchase, Low Side Cost, Low Side Target Exp, Low Side Actual Exp, Total Margin,
  Received, Pending, Terms — plus a header block (`rptHead`: title, "Generated <date> by <user>
  (<role>)", active search filter if any) and a TOTAL row summing Total Cost/Received/Pending.
  Scoped by the same `mine()+hasDiv()+hit()` filter as the list view (i.e. exports exactly what's
  currently on screen, search included).
- **`dlPayments()`/`dlReceipts()`** (§8) are the Payment-side reports; both trace `soNo` back to
  the originating SO on every row.
- **`dlProjects()`** includes `Payment Received`/`Payment Pending` columns per project (via
  `projPayInfo`), i.e. a de facto second SO-financial report reachable from the Projects screen.
- No PDF/print export specific to SalesOrder was found (there is a `printDC`/`printProjectReport`
  pair for delivery challans and project reports, but neither touches SO fields beyond what
  `dlProjects` already covers).

## 15. Numbering / Sequencing — re-verified, not assumed from prior docs

- `DB.seq.so` is a single per-company... **correction, verified from source:** `DB.seq` is a
  **global, not per-company, counter object** (`DB.seq.so`, no `co` keying anywhere in its
  read/write sites: `DB.seq.so++` in `saveSO`, and the legacy-import line `DB.seq.so=Math.max(...)`
  at L1014). **This means `so.no` (the display "SO No") is a single sequence shared across every
  tenant in the PWA's local `DB`**, not scoped per company. This is consistent with the PWA being a
  single-tenant-per-browser-session local prototype where `DB` itself is the whole local dataset,
  but it is an important fact for `new-app`, which is explicitly multi-tenant: `new-app`'s existing
  `Counter.js` model (`{companyId, name, value}`) already scopes sequences per company **by
  design**, correctly departing from this PWA behavior rather than reproducing a cross-tenant
  counter — this is a deliberate, already-established NEW BACKEND DESIGN choice (visible in
  `Counter.js` and reused by `enquiryService.js`'s `counterRepo.getNextSequence(companyId,
  'salesOrder', session)`), not a fidelity gap, and this audit records it as CONFIRMED CORRECT
  rather than re-opening it as a decision.
- The counter is incremented **before** being read (`DB.seq.so++` then `so.no=DB.seq.so`, i.e.
  1-based, no SO ever gets `no=0`). `new-app`'s `getNextSequence` semantics were not re-derived in
  this audit (out of scope — Counter.js/counters.js belong to the auth/company foundation, already
  established) but the "increment-then-assign, 1-based" contract is the one the PWA demonstrates
  and the one the existing conversion cascade must continue to honor.
- No gap-filling, re-sequencing, or per-division sub-numbering was found — `so.no` is a flat
  integer display number, full stop.

## 16. Edge Cases / Bugs / Quirks (recorded literally, not fixed)

1. **No 1:1 SO↔Enquiry enforcement in the PWA** (§5.7) — already the literal PWA source for
   locked decision #19; recorded here again as a SalesOrder-side fact for completeness.
2. **Standalone SO creation exists** (§4) and is entirely undocumented as a distinct path in the
   PWA's own UI copy (the button just says "+ New SO" with no indication that it's a fundamentally
   different, Enquiry-free flow) — not a bug, but an easy detail to miss when reading only the
   Enquiry-conversion code.
3. **Milestone `rcv`-flag index-based preservation on edit** (§6) can silently misattribute a
   "received" flag to the wrong milestone if rows are reordered/removed during an edit.
4. **One-way milestone-amount sync** (§6/§8): `mPayEdit`→`savePayEdit` writes the new amount
   forward onto `so.pay[x.mi].a`, but the SO's own edit modal never writes back to the linked
   Payment's `amount` — editing a milestone from the SO side can desync it from the Payment side's
   `amount` field indefinitely.
5. **Double source of truth for "received"** on the SO list view vs. the CSV report (§13):
   `vSOs`'s inline `rcv`/`pen` totals trust `so.pay[].rcv` directly; `dlSOs`'s totals go through
   `paySum` (which reconciles against the live Payment record). They agree in every normal
   operation traced in this audit (since `syncPayStatus` keeps `rcv` current), but they are two
   separately-computed values, not one shared calculation, so a defect in either code path could
   make the list and the report disagree without either being individually "wrong" in isolation.
6. **Contact `em` (email) field is captured in code but has no input in the UI** (§3) — always
   saved empty; dead field.
7. **Over-payment is allowed** (§8: `addPayment` only asks for confirmation, never blocks an
   amount greater than the outstanding balance) and **milestone-amount reduction below the
   received sum is blocked** (§8: `savePayEdit`'s `if(amt<r)` guard) — these two safeguards are
   asymmetric and neither is a schema-level constraint, both are inline UI checks only.
8. **No role check inside any SalesOrder/Payment mutating function** (§12) — the PWA's entire
   protection model for this module is client-side rendering, confirmed absolute (zero exceptions
   found).
9. **Legacy `DB.templates[div]` checklist fallback has no `new-app` equivalent** (§10) — a fresh
   SO in a division with zero ChecklistTemplate rows gets an **empty** checklist in `new-app`
   versus the PWA's hardcoded legacy fallback list. Low-severity (only matters until a company
   sets up at least one ChecklistTemplate per division it uses) but a real, named gap.

None of the above were altered by this task — they are recorded as literal PWA behavior for a
future business decision, exactly as the Enquiry audit's own §12/§13 did for its module.

## 17. Field-by-Field Coverage Table

| PWA field (`so.*`) | Present in `new-app` `SalesOrder.js`? | Notes |
|---|---|---|
| `id` (array index) | — (Mongo `_id` used instead) | NEW BACKEND DESIGN, not a gap |
| `co` | `companyId` | ✅ |
| `no` | `orderNumber` | ✅ (PWA fact: display number; NEW BACKEND DESIGN: per-tenant Counter-based generation, correctly departing from the PWA's global counter — see §15) |
| `div` | `division` | ✅ |
| `project` | `projectName` | ✅ |
| `start` | `startDate` | ✅ |
| `end` | `endDate` | ✅ |
| `addr` | `siteAddress` | ✅ |
| `contacts[2]{n,dg,ph,em}` | `contacts[≤2]{name,designation,phone,email}` | ✅ (cap enforced as a schema validator, matching the PWA's fixed 2-slot form) |
| `salesTeam` | `salesTeam` | ✅ |
| `projTeam` | `projectTeam` | ✅ |
| `crucial` | `crucialPoints` | ✅ |
| `total` | `totalCost` | ✅ |
| `hsSell`/`hsPur` | `highSideSelling`/`highSidePurchase` | ✅ |
| `lsCost`/`lsTarget`/`lsActual` | `lowSideCost`/`lowSideTargetExpense`/`lowSideActualExpense` | ✅ |
| `terms` | `termsAndConditions` | ✅ |
| `pay[≤5]{d,a,rcv}` | `paymentMilestones[≤5]{description,amount,received}` | ✅ shape; ⚠ no synchronization logic exists yet (§8) |
| *(none — PWA has no such field)* | `enquiryId` | NEW BACKEND DESIGN, locked #20=D, already implemented and correctly labeled |

**Total PWA-demonstrated SalesOrder fields: 17** (counting `contacts` and `pay` each as one
compound field, per the same convention the Enquiry audit used). **All 17 have a corresponding,
correctly-typed `new-app` field.** No schema gap was found — `SalesOrder.js` needs no changes as a
result of this audit.

## 18. Workflow Coverage Table

| Workflow | PWA-verified | `new-app` implementation | Status |
|---|---|---|---|
| Create SO from Enquiry conversion | ✅ §5 | `convertEnquiryToSalesOrder` | ✅ implemented, independently re-verified as correct |
| Create standalone SO (no Enquiry) | ✅ §4 | none | ❌ gap |
| Edit an existing SO | ✅ §6 | none | ❌ gap |
| View SO detail (role-gated costing) | ✅ §3/§12 | none (no read endpoint/service) | ❌ gap |
| List/search/filter SOs | ✅ §13 | none | ❌ gap |
| SO CSV report (`dlSOs`) | ✅ §14 | none | ❌ gap |
| Add/edit/delete part-payment | ✅ §8 | none (`Payment.js` model only) | ❌ gap |
| Milestone received-flag sync (`syncPayStatus`) | ✅ §8 | none | ❌ gap |
| Raise milestone to Finance (`mRaise`/`doRaise`) | ✅ §8 | none | ❌ gap |
| Payment reports (`dlPayments`/`dlReceipts`) | ✅ §8/§14 | none | ❌ gap |
| Project creation cascade (as part of SO creation) | ✅ §5/§9 | implemented (inside `convertEnquiryToSalesOrder` only) | ⚠ partial — works for conversion path, not for a future standalone-SO path |
| Notifications on SO creation | ✅ §5/§11 | implemented (inside `convertEnquiryToSalesOrder` only) | ⚠ same partial status |

**Total PWA-demonstrated SalesOrder-module workflows: 12.** **2 fully implemented (as a byproduct
of the already-authorized Enquiry conversion), 2 partially implemented (only reachable via that
same conversion path), 8 not implemented at all.**

## 19. Relationship Matrix

| From | To | Cardinality | Trigger | Verified |
|---|---|---|---|---|
| Enquiry | SalesOrder | 0/1 : 1 (locked #19=B enforces at most one) | Enquiry conversion (`saveSO` with `enqId`) | §5 |
| *(standalone)* | SalesOrder | — | "+ New SO" (`saveSO` with no `enqId`) | §4 |
| SalesOrder | Project | 1 : 1, always, at creation time | either creation path | §9 |
| SalesOrder | ChecklistTemplate | many : 1 (lookup only, copied not referenced after) | Project creation, via `defaultChkList(div)` | §10 |
| SalesOrder | Payment | 1 : 0..5, one per non-empty milestone | either creation path | §8 |
| SalesOrder | Notification | 1 : 2, always | either creation path | §5/§11 |
| Payment | SalesOrder | many : 1 via `(soNo, mi)`, keeps `so.pay[mi].rcv` in sync | `syncPayStatus` after any `paid[]` mutation | §8 |

## 20. PWA Fact vs. New Backend Design vs. Current Implementation

- **PWA FACT, fully implemented and independently re-verified as correct:** the entire
  Enquiry-conversion cascade (§5) — field copy/transform/default rules, Project creation, Payment
  creation, exact notification text, checklist template lookup.
- **PWA FACT, not yet implemented:** standalone SO creation (§4), SO editing (§6), SO
  list/detail/report reads (§13/§14), the entire Payment ledger/sync workflow (§8), milestone-raise
  workflow (§8), Payment reports (§14).
- **PWA QUIRK, recorded not fixed:** items in §16 (index-based `rcv` preservation, one-way
  milestone-amount sync, dual received-total sources, dead `em` field, asymmetric over/under
  payment guards, zero function-level role enforcement).
- **NEW BACKEND DESIGN, already locked and correctly implemented:** `enquiryId` (#20=D), the
  Open/duplicate-conversion guard (#19=B), per-tenant Counter-based `orderNumber` generation
  (correctly departing from the PWA's global counter, §15 — confirmed correct, not re-opened as a
  decision).
- **NEW BACKEND DESIGN, not yet decided (see §21):** whether to reproduce the PWA's legacy
  `DB.templates[div]` fallback when no ChecklistTemplate exists (§10 item 9), and whether/how to
  add function-level role enforcement to the not-yet-built SalesOrder/Payment mutating operations
  (an extension of the same discipline `enquiryService.js` already established, not a new open
  question about *whether* to enforce roles — only about the concrete rule for actions this audit
  found have **no** role gate at all in the PWA, e.g. `mRaise`/`doRaise` and the Payment ledger
  mutations, where "reproduce PWA fidelity" and "add reasonable protection" point in different
  directions and the business should confirm the intended rule before it is built).
- **Re-checked specifically per this task's instruction:** no other field on `SalesOrder.js`,
  `Project.js`, `Payment.js`, `Notification.js`, or `ChecklistTemplate.js` carries a `PWA FACT`
  label that this audit found to be mislabeled — `enquiryId` (already corrected in the prior task)
  was the only such case, and it remains correctly labeled as at the end of this audit.

## 21. Implementation Readiness

The SalesOrder module is **partially implementation-ready**:
- The schema (`SalesOrder.js`) needs **no changes** — §17 found full field coverage.
- The Enquiry-conversion creation path is **already implemented and verified correct** — no
  rework needed.
- A full SalesOrder implementation additionally requires: standalone SO creation, SO editing, SO
  read/list/search/report, and — inseparably — the complete Payment ledger and
  milestone-received-synchronization layer (§8), since no realistic SalesOrder feature set can
  ship without a working "is this milestone paid" answer. Project.js/Notification.js need no
  schema changes; Payment.js needs no schema changes either (its shape already matches §8).
- Two design questions should be resolved by the business **before** that implementation begins
  (see §20's "not yet decided" bullet): the ChecklistTemplate-fallback question, and the
  role-enforcement rule for the specific actions this audit found have zero PWA-side gating.

## 22. Final Gap / Decision List

1. **Standalone SalesOrder creation** (no Enquiry) is a real, undecided-nowhere-but-undocumented
   PWA path with no `new-app` implementation. Not a decision — a confirmed scope item for the next
   SalesOrder implementation task.
2. **Full Payment ledger + `syncPayStatus` synchronization** has no `new-app` implementation at
   all. Not a decision — a confirmed scope item, and the largest one found.
3. **Milestone-raise-to-Finance workflow** (`mRaise`/`doRaise`) has no `new-app` implementation.
   Confirmed scope item.
4. **NEW BACKEND DESIGN DECISION — not a PWA fact:** whether the new backend should reproduce the
   PWA's legacy `DB.templates[div]` hardcoded-checklist fallback (Choice A) or leave a fresh SO's
   Project with an empty checklist when no ChecklistTemplate exists for its division (Choice B,
   `new-app`'s current — untested, since no SalesOrder-standalone code exists yet — implicit
   behavior). Left to the business; no fallback data has been added pending this decision.
5. **NEW BACKEND DESIGN DECISION — not a PWA fact:** for the specific SalesOrder/Payment actions
   this audit found have **zero** function-level role gating in the PWA (`mRaise`/`doRaise`, and
   every Payment-ledger mutation: `addPayment`/`mEditPayment`/`delPayment`/`savePayEdit`), should
   the new backend (A) enforce the same *visible* role gates the PWA's menus imply (e.g.
   PM-or-admin for raising, finance-or-admin for recording payments) even though the PWA itself
   never checks them in code, or (B) something narrower/broader. Left to the business; no
   enforcement rule has been chosen or implemented for these specific actions.
6. **Milestone-amount one-way-sync quirk** (§16 item 4) and **index-based `rcv` preservation on
   edit** (§16 item 3) are recorded as literal PWA behavior for the business to decide whether to
   preserve, fix, or redesign when SO editing is implemented — not decided or implemented here.

No SalesOrder service, route, controller, or workflow code was written as part of this task.
