# Execution Control and Deadline — Verification vs. Fix Protocol

**Purpose:** this document is the controlling clarification for how STEP 3 (and, by the same protocol, any later step) verification work and any resulting fix work are handled from this point forward. It resolves a conflict in prior instructions between "stop and wait for a human" and "just fix it" by defining a single, explicit two-phase protocol (Phase A = verification, Phase B = fix), and it sets the project's hard deadline checkpoints. It is a documentation/execution-control document only — it does not itself execute, resume, or advance any verification pass, and it does not implement any application change.

**Produced:** 2026-09-23, as a documentation-only control-update task. Today is 2026-09-23; the deadline this document sets is **2026-09-24, 23:59 IST** — a next-day deadline.

**Governs:** every future STEP 3 pass (3.2–3.8) and any STEP 4–8 work that follows the same verify → fix discipline. Per `DOCUMENT_AUTHORITY.md`, this document does not re-sequence `STAGED_IMPLEMENTATION_PLAN.md`'s STEP 0–8 order or `E2E_WORKFLOW_VERIFICATION_PLAN.md`'s pass sequence (3.0–3.8) — both remain frozen and authoritative for *what* is verified and *in what order*. This document governs *how* a verification pass's outcome is handled once produced, and adds deadline checkpoints on top of that unchanged sequence.

---

## 1. The conflict this document resolves

Prior instructions to this engagement have said, in different tasks, both "stop at a blocked pass and wait for a decision" (`E2E_WORKFLOW_VERIFICATION_PLAN.md` §5's default framing of a gap as "hand back for a decision") and, separately, "the company workflow is stopped, move fast, do not introduce unnecessary human waiting." Both are legitimate concerns — traceability/discipline on one side, urgency on the other — and they read as contradictory if left unresolved. This document is the single rule that reconciles them: **verification and fixing remain two separately recorded phases (so nothing is silently mixed), but the fix phase for a genuine implementation gap starts immediately after a BLOCKED verdict, without an unnecessary human pause in between**, per §5 below. "No unnecessary stop" is about not waiting; it is never permission to skip the phase boundary itself.

---

## 2. Phase A — Verification (unchanged gate, restated here for this document's own completeness)

Every verification pass (STEP 3 passes 3.0–3.8, and any later STEP's own verification work) follows this gate, exactly as `E2E_WORKFLOW_VERIFICATION_PLAN.md` §1 already defines it:

```
READ SOURCE → TRACE PWA → TRACE NEW APP → COMPARE → DOCUMENT EVIDENCE → CLASSIFY FINDINGS → TEST → PASS / BLOCKED
```

Rules that apply to Phase A without exception:

- **No application source changes are permitted during Phase A.** A verification pass reads `new-app/backend/src/*`, the PWA source, and the docs — it never edits `new-app/backend/src/*`, never edits a test file, and never touches `v1/`, `v2/`, `v3/`, or either PWA copy. This is identical to the standing rule already governing every prior pass; this document does not relax it.
- **A verification pass must finish with either PASS or BLOCKED** — never left open, never implied, never inferred from "no error reported" or from a later step's success (`STAGED_IMPLEMENTATION_PLAN.md`'s Gate Rule, restated). There is no third state.
- Phase A produces a pass report using the exact template in `E2E_WORKFLOW_VERIFICATION_PLAN.md` §9, with every substantive finding source-evidenced per that document's §2 evidence standard.

---

## 3. Phase B — Fix (only entered when Phase A produces a genuine blocking implementation gap)

If Phase A produces a **blocking** implementation gap (see §7's P0/P1 definition — not every finding blocks; a non-blocking fidelity/documentation issue stays a documented finding, not a Phase B trigger), the following separate phase begins:

```
PASS A → BLOCKED FINDING IDENTIFIED → CREATE EXPLICIT FIX TASK → IMPLEMENT FIX → TARGETED TESTS → FULL REGRESSION → SAFETY CHECK → RE-VERIFY ORIGINAL FINDING
```

**Key distinction — stated explicitly because this is the crux of the conflict this document resolves:**

> **A verification pass never silently fixes its own findings.** A fix is a separate implementation phase that follows immediately after the failed (BLOCKED) verification — never folded into the verification pass's own report, never performed as an undocumented side effect of "just checking one more thing." The verification report records the gap; a distinct, explicitly identified fix task (§6's `FIX-<PASS>-<NUMBER>` identifier) records the remediation. This separation is what keeps traceability intact — anyone reading the history later can see exactly which task found a gap and exactly which task closed it, with its own evidence, its own tests, and its own safety check.

Phase B is application-source work. Only a task explicitly operating as a Phase B fix task may touch `new-app/backend/src/*` or add/modify tests (additive-only, per `STAGED_IMPLEMENTATION_PLAN.md` STEP 6's own rule on test changes) — Phase A verification tasks and this control-update task itself do neither.

---

## 4. No unnecessary human stop (urgency vs. discipline, reconciled)

Because the company workflow is currently stopped and the deadline (§12–§13) is urgent, **do not introduce unnecessary waiting** between: verification → documented blocker → fix task → targeted test → regression → re-verification. A BLOCKED verdict with a P0/P1 classification (§7) should move directly into creating its `FIX-<PASS>-<NUMBER>` task and implementing it, rather than pausing for a round of confirmation that adds no new information.

This does **not** mean:
- Mixing an unrecorded source edit into a verification report. The fix is still a separately identifiable implementation action, with its own task identifier, its own evidence citation back to the blocking finding, its own targeted tests, and its own full-regression + safety-check run — never a same-report patch.
- Skipping the BLOCKED declaration itself to "save a step." The gate in §2 still applies in full; speed comes from not waiting *after* the gate, not from softening the gate.
- Reclassifying a P0/P1 finding as non-blocking merely to avoid triggering Phase B (§15 of the deadline rules below is explicit on this).

---

## 5. Blocked-pass report — required fields

When a pass (or any later STEP's verification work) is declared BLOCKED, its report must include, for each blocking finding:

```
BLOCKING FINDING
- Issue ID:
- PWA Evidence:            (source file + function/handler + line range/anchor, per E2E_WORKFLOW_VERIFICATION_PLAN.md §2.1)
- NEW APP Evidence:        (source file + function/route/model + line range, per §2.2)
- Required Behavior:       (what the PWA demonstrates the system must do)
- Current Behavior:        (what NEW APP actually does today)
- Exact Gap:                (the precise delta between Required and Current — not a restatement of either alone)
- Impact:                   (what breaks, for whom, under what condition, if left unfixed)
- Required Fix:             (what implementation change would close the gap — described, not yet performed)
```

Each `BLOCKING FINDING` gets its own fix task identifier: **`FIX-<PASS>-<NUMBER>`** (e.g. `FIX-3.1-01`, `FIX-3.1-02`, `FIX-3.2-01`). The fix task must reference the exact `Issue ID` and evidence (PWA Evidence + NEW APP Evidence) from the blocked report that caused it — a fix task with no traceable originating finding is not valid under this protocol.

---

## 6. Fix task identifier format

```
FIX-<PASS>-<NUMBER>
```

- `<PASS>` is the pass number that found the gap (e.g. `3.1`, `3.2`, `3.6`), or the STEP number for non-STEP-3 verification work (e.g. `FIX-4-01` for a STEP 4 security finding).
- `<NUMBER>` is a two-digit, per-pass sequential counter starting at `01` (e.g. the first fix task from Pass 3.1 is `FIX-3.1-01`, the second is `FIX-3.1-02`).
- A fix task's own record must cite the exact `Issue ID` and both evidence fields from §5 that it is closing — never a paraphrase.

---

## 7. Fix priority (execution-priority classification — not a quality ranking)

```
P0 — Prevents core company workflow
P1 — Breaks a major PWA workflow/connection
P2 — Breaks important PWA functionality
P3 — Non-blocking fidelity/documentation issue
```

This is a classification of **how urgently** a finding must be closed before deployment, not a judgment of how well the code is written. **P0 and P1 findings must be resolved (fixed, targeted-tested, regression-tested, and re-verified per §8) before the pass that raised them can be declared PASS.** P2 findings should be resolved before the hard deadline where feasible but do not, by themselves, block a pass from PASS if explicitly carried forward as an open, documented item (consistent with how B1/B2/Checklist-Library are already carried forward — §10). P3 findings may remain open, documented, after functional deployment, per §15.

---

## 8. Re-verification rule

After a fix is implemented, **"Fixed" alone is not a sufficient closing statement.** The original evidence that produced the BLOCKED verdict must be explicitly rechecked. A re-verification record must show all of the following:

```
Original PWA Evidence:          (unchanged — re-cited from the blocked report, not re-derived)
Original NEW APP Gap Evidence:  (unchanged — re-cited from the blocked report, showing what was wrong)
Changed NEW APP Evidence:       (the new source file + function/route + line range that now implements the required behavior)
Targeted Test:                   (the specific test(s) added/run that exercise exactly this fix)
Full Regression:                 (the full suite result, e.g. N/N passing, run after the fix)
Final Result:                    (the re-checked behavior against the Original PWA Evidence)
```

Only once all six fields are recorded may the pass's status change from **BLOCKED** to **PASS**. A fix without this re-verification record does not close the finding, regardless of how confident the implementation appears.

---

## 9. PWA parity rule remains absolute

Every fix must move NEW APP **toward** PWA functional behavior — never away from it. Specifically, a gap must never be closed by:

- Removing PWA functionality
- Simplifying the workflow
- Deleting fields
- Removing checklist behavior
- Removing notifications
- Removing reports
- Removing exports
- Removing roles/actions
- Removing edge cases
- Changing a documented PWA quirk (e.g. any item in `STAGED_IMPLEMENTATION_PLAN.md`'s "Current known PWA quirks intentionally preserved" list)

**Approved infrastructure-only differences remain the only exception**, exactly as already locked in `E2E_WORKFLOW_VERIFICATION_PLAN.md` §0: MongoDB/ObjectIds replacing numeric/array-index ids, bcrypt-hashed passwords, explicit server-side tenant (`co`) isolation, explicit server-side authorization checks, DB-transaction/concurrency-safety additions, and durable server-side counters/storage adaptations replacing the PWA's in-memory `DB` object. **Everything else requires an explicit comparison against the PWA before it can be treated as acceptable** — nothing is assumed equivalent by default.

---

## 10. Known blockers — carried forward explicitly (not fixed by this task)

This control-update task does **not** fix any of the following. They remain open, documented findings, to be resolved only by a separately issued Phase B fix task (with its own `FIX-<PASS>-<NUMBER>` identifier) and closed only via the §8 re-verification record:

- **B1 — Notifications.** PWA has 23 independently-enumerated `notify()` call sites (Enquiry 0, SalesOrder 2, Project 9, Contract 2, ServiceCall 4, Payment 3, Inventory 5 — `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md` §13). NEW APP has a `Notification.js` model but no `notificationService.js`, no notification routes, and no wired write-path anywhere (re-confirmed by grep in the `E2E_WORKFLOW_VERIFICATION_PLAN.md` setup task, §7.2). This remains a known gap — targeted for formal re-trace in Pass 3.7 — until a separate fix task addresses and re-verifies it.
- **B2 — Company deletion.** PWA demonstrates company deletion via `delCompany(id)` (line 1811) with a documented cascade. NEW APP's `companyService.js` (88 lines) has no delete/remove/cascade function (re-confirmed same session). This remains a known gap until separately addressed and re-verified — it is not one of the 12 STEP 3 workflows, so it does not block STEP 3's own exit criteria, but it does block deployment readiness per §15 below (data integrity / core workflow considerations) unless explicitly accepted as a documented deployment-blocking exception.
- **Checklist-Library** — previously documented partial Checklist-Library (`ChecklistTemplate`) CRUD, per `PROJECT_DECISION_LOCK.md` Decision 3 (Checklist Library management is cross-division-permissive to any PM role — a locked PWA-fidelity decision) and the master audit's note that Template-CRUD implementation completeness was "deliberately-deferred" (`PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md` §16 CHECKLIST COVERAGE line). This must remain visible and must be resolved according to **actual PWA behavior**, not silently accepted as-is nor silently removed/simplified.

None of B1, B2, or Checklist-Library is fixed, started, or re-verified by this control-update task. They are carried forward exactly as already documented in `E2E_WORKFLOW_VERIFICATION_PLAN.md` §5 and its Acceleration Protocol section.

---

## 11. Fast-track rule (accelerated workflow diagram)

```
PASS 3.X verification
      │
      ▼
  PASS or BLOCKED?
      │
      ├── PASS ──────────────────────────────────────► next pass (3.X+1)
      │
      └── BLOCKED ──► fix task(s) created (FIX-3.X-01, FIX-3.X-02, …)
                            │
                            ▼
                      targeted test(s)
                            │
                            ▼
                      full regression
                            │
                            ▼
                      re-verify original finding (§8)
                            │
                            ▼
                      pass status BLOCKED → PASS
                            │
                            ▼
                      next pass (3.X+1)
```

Explicit rules governing this diagram:

- **Do NOT skip a blocked pass just to meet the deadline.** A pass that is BLOCKED stays BLOCKED — and blocks every later pass per `E2E_WORKFLOW_VERIFICATION_PLAN.md` §13's dependency order — until its P0/P1 findings are fixed and re-verified per §7–§8 above. The deadline is a reason to fix faster, never a reason to advance past an unresolved block.
- **Do NOT leave a blocking PWA gap hidden until final reconciliation (Pass 3.8).** Every BLOCKED finding is surfaced, fix-tasked, and re-verified at the pass where it was found — Pass 3.8's master reconciliation is a final cross-check of already-resolved passes, not the first place a P0/P1 gap is allowed to surface.

---

## 12. Tomorrow deadline

**Hard project target: September 24, 2026, 23:59 IST** — the deployment deadline checkpoint.

**Objective by that checkpoint:** full required MEP Projects PWA functional parity + critical security/tenant protection + critical data integrity + frontend connected + full regression + deployed.

**Explicit rule:** the deadline is never interpreted as permission to reduce PWA coverage. Speed comes from faster execution of the same scope (parallelized read-only evidence gathering per the Acceleration Protocol, immediate fix-task creation on BLOCKED per §4, no unnecessary human pause) — never from reduced scope, silently downgraded findings, or skipped tracing.

---

## 13. Deadline checkpoints

These checkpoints are also added, verbatim, to `new-app/docs/STAGED_IMPLEMENTATION_PLAN.md` (new "DEADLINE CHECKPOINTS" section, appended without reordering or removing STEP 0–8 or the EXACT EXECUTION ORDER section).

- **CHECKPOINT 1 — September 24, 2026, 09:00 IST.** Required state: STEP 3 E2E verification substantially advanced; all discovered P0/P1 gaps identified; no unknown major PWA workflow areas.
- **CHECKPOINT 2 — September 24, 2026, 13:00 IST.** Required state: core PWA workflows verified; major cross-module gaps identified; critical fixes in progress/completed.
- **CHECKPOINT 3 — September 24, 2026, 17:00 IST.** Required state: STEP 3 master reconciliation (Pass 3.8) substantially complete; critical PWA gaps resolved or explicitly blocking deployment; frontend integration (STEP 7) operational.
- **CHECKPOINT 4 — September 24, 2026, 20:00 IST.** Required state: production candidate; full regression executed; security/tenant checks (STEP 4) completed; deployment validation underway.
- **HARD DEADLINE — September 24, 2026, 23:59 IST.** Required final state: DEPLOYED, unless a genuine blocking issue prevents safe deployment. Never declare deployment complete if critical functionality is known to be broken.

---

## 14. Deadline status model

At every checkpoint, report status using **exactly one** of these four values — no other wording:

```
ON TRACK
AT RISK
BLOCKED
DEPLOYED
```

No vague language ("almost done", "mostly done", "nearly ready", "probably ready", or similar) is permitted in any checkpoint status report.

---

## 15. Deadline blocking conditions

The project **cannot** be declared deployment-ready while any P0/P1 issue remains open in any of the following areas:

- Core PWA workflow
- Cross-module relationship
- Checklist behavior
- Payment/finance flow
- Authentication
- Tenant isolation
- Authorization
- Data integrity
- Critical notification workflow
- Critical inventory stock mutation

**Non-blocking documentation issues** (P3, or a P2 explicitly accepted as a documented open item) may remain documented after functional deployment **only** when they do not affect PWA behavior or safe operation. **Do not classify a functional PWA gap as non-blocking merely to meet the deadline** — the priority classification (§7) is determined by the gap's actual effect on core workflow/security/data integrity, never by how close the deadline is.

---

## 16. PWA completeness checkpoint (pre-deployment completeness checklist)

**Note on this section:** the checklist below completes an item list whose source instruction was cut off mid-item during this task's own input; it is filled in using this engagement's own already-established completeness categories (the same categories `E2E_WORKFLOW_VERIFICATION_PLAN.md` §14's STEP 3 Exit Criteria and `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md`'s coverage-summary lines already use), not invented content, and using the exact counts this engagement has already independently verified (15/15 entities, 12/12 workflows, 23/23 notification call sites, 11/11 roles — all per `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md` and `E2E_WORKFLOW_VERIFICATION_PLAN.md` §10's Known Baseline Counts) rather than any new, unverified number.

```
[ ] 15/15 PWA entities accounted for (PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md §1, §19)
[ ] 12/12 PWA workflows accounted for (PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md §16; E2E_WORKFLOW_VERIFICATION_PLAN.md §8)
[ ] All demonstrated PWA connections reconciled against NEW APP (per Pass 3.8's master reconciliation scope)
[ ] All checklist flows (template / SalesOrder checklist / Project checklist / approval) traced and classified (Pass 3.3, dedicated checklist pass)
[ ] All 23 known PWA notification call sites traced and classified (Pass 3.7; re-confirms B1)
[ ] All 11 PWA roles' behavior compared against NEW APP enforcement (PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md §4, §16 ROLE COVERAGE line)
[ ] All P0/P1 findings resolved or explicitly accepted as blocking deployment (§7, §15 above — never silently downgraded)
[ ] Full regression suite passing (287/287 baseline as of this task; re-verify the live count at each checkpoint, do not assume it is still current)
[ ] Safety baseline unchanged (V2 = 37-file drift, V3 = 0 files, both PWA copies md5 111b53dba91704f96b83dae96c7793c6, nothing staged/committed)
```

This checklist is the final gate for the HARD DEADLINE checkpoint (§13) — every row must be checked, with its supporting evidence document named, before DEPLOYED may be declared per §14's status model.

---

## 17. Relationship to existing control documents (no re-sequencing)

This document does not change, reorder, remove, or duplicate the substantive content of:

- `STAGED_IMPLEMENTATION_PLAN.md`'s STEP 0–8 sequence, its Gate Rule, or its Frozen Dependency Order — those remain exactly as written; this document only appends the deadline checkpoints (§13) to that file.
- `E2E_WORKFLOW_VERIFICATION_PLAN.md`'s pass sequence (3.0–3.8), Mandatory Pass Gate, source-evidence standard, finding classification list, or Acceleration Protocol — this document's Phase A (§2) restates that same gate for completeness but does not alter it; this document's Phase B (§3) is new, filling the gap that document's §5 left open ("hand back for a decision" without specifying how fast or in what recorded shape).
- `API_CONTRACT.md`'s endpoint contract, or `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md`'s workflow/entity/connection facts — both remain the respective authorities for those questions per `DOCUMENT_AUTHORITY.md`.

Per `DOCUMENT_AUTHORITY.md` (updated alongside this document), `EXECUTION_CONTROL_AND_DEADLINE.md` is now the authority specifically for: (a) how a Phase A verification pass's BLOCKED outcome is handled and by what recorded shape a fix is executed and re-verified (§3–§9), and (b) the deadline checkpoints and status-reporting model for the remainder of this engagement (§12–§16). It is not authority for pass sequencing, API contract content, or PWA functional facts — those remain governed exactly as `DOCUMENT_AUTHORITY.md` already states.

---

## 18. This task's own status

This is a documentation/execution-control-update task. It did **not** execute, resume, or advance Pass 3.2 (the next unstarted STEP 3 pass) or any other pass. It did not touch `new-app/backend/src/*`, any test file, `v1/`, `v2/`, `v3/`, or either PWA copy. It staged and committed nothing. See the accompanying session report for exact before/after safety-check and `npm test` results.
