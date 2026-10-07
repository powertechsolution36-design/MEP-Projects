# Stage 7 Pass 3A — Acceptance Correction

**Date**: 2026-09-28
**Scope**: Close 5 evidence gaps identified in Pass 3A review, plus role/division verification and relationship-drift check.
**Result**: **PASS** — all gaps closed, 75/75 acceptance checks pass, 373/373 backend regression tests pass.

---

## 1. Evidence Gaps Addressed

### Gap 1: Project Completion Gate (FIX-7-01: none required)

**Test**: Walk HVAC project through all stages (Planning → Piping → Installation → Testing → Finishing → Completed).

| Check | Result |
|-------|--------|
| Project reaches Finishing stage | ✅ |
| Uncompleted checklist items exist (gate prerequisite) | ✅ |
| Completion WITHOUT confirm flags — stage remains Finishing (blocked) | ✅ |
| Completion WITH `confirmPendingMaterial + confirmIncompleteChecklist` — stage changes to Completed | ✅ |
| Completed stage persists on re-fetch | ✅ |

**Behavior preserved**: Literal `"Completed"` string check triggers both confirmation gates. Both are overridable. Service enforces the gate server-side.

### Gap 2: Timeline Readiness Gate (FIX-7-02: none required)

**Test**: Solar project with checklist, partial target dates, timeline save.

| Check | Result |
|-------|--------|
| Tick blocked before timeline ready (returns 4xx) | ✅ |
| `timelineReady` is false when `timelineSet=false` and no targetDates | ✅ |
| Timeline saved with `confirmPartialDates` (only 1 of N points has date) | ✅ |
| `timelineReady` becomes true after `timelineSet + projPlanned > 0` | ✅ |
| Tick succeeds after timeline ready | ✅ |
| Checklist item done flag persists | ✅ |

**Behavior preserved**: `timelineReady = !!timelineSet && projPlanned > 0`. Tick is a project-level gate (NOT per-point). `targetDates` must be parallel array to checklist. Partial dates require `confirmPartialDates` flag.

### Gap 3: Apply Checklist Template (FIX-7-03: none required)

**Test**: Create a template with 2 items, apply to project in both modes.

| Check | Result |
|-------|--------|
| Checklist template created via API | ✅ |
| Template has items (2 added) | ✅ |
| Replace mode succeeds | ✅ |
| Replace mode — checklist length matches template item count | ✅ |
| Replace mode — first item text matches template | ✅ |
| Append mode succeeds | ✅ |
| Append mode — checklist length increased by template item count | ✅ |
| Non-PM (engineer) cannot apply template — 403 | ✅ |

**Behavior preserved**: `mode: "replace"` replaces entire checklist. `mode: "append"` appends. PM-only access enforced.

### Gap 4: Photo Upload + Approval Signature (FIX-7-04: none required)

**Test**: Upload base64 photo, approve with both ENGINEER and CLIENT sign types.

| Check | Result |
|-------|--------|
| Photo upload (base64 data URI) succeeds (201) | ✅ |
| Photo persisted in checklist item photos array | ✅ |
| Photo is base64 data URI | ✅ |
| ENGINEER approval succeeds | ✅ |
| ENGINEER approval — approverName is actor's display name (not free-typed) | ✅ |
| ENGINEER approval — signatureImage is empty (PWA exact: non-CLIENT type) | ✅ |
| CLIENT approval with free-typed name + signature succeeds | ✅ |
| CLIENT approval — free-typed approverName persisted | ✅ |
| CLIENT approval — signature image (base64) persisted | ✅ |
| CLIENT approval — remark persisted | ✅ |
| Photo still present on re-fetch | ✅ |
| CLIENT signature still present on re-fetch | ✅ |

**PWA behavior clarification documented**: `signatureImage` is only stored for CLIENT sign type. For ENGINEER/SALES/SERVICE, `signatureImage` is always empty string. `approverName` for CLIENT is the free-typed on-site name; for all others it's the acting staff member's display name. This matches PWA `doApprove` exactly.

### Gap 5: Engineer-Candidate Authorization (FIX-7-05: FIXED)

**Problem**: `GET /api/projects/engineer-candidates` was accessible to any authenticated user, exposing the company employee pool to roles that have no business seeing it.

**PWA evidence**: Only PM roles (`isPM` = admin + division PM) can assign engineers (`saveProjectEngineers` is gated by `canPM(p)`). Therefore, the candidate list should be similarly restricted.

**Fix applied**: Added role check in `listEngineerCandidates()` — only `['admin', 'hvac_pm', 'solar_pm', 'mep_pm']` can access the endpoint. Others receive 403.

**Files modified**:
- `backend/src/services/projectService.js` — added PM_ROLES check with ServiceError(FORBIDDEN, 403)

| Check | Result |
|-------|--------|
| admin can list candidates | ✅ |
| hvac_pm can list candidates | ✅ |
| solar_pm can list candidates | ✅ |
| mep_pm can list candidates | ✅ |
| engineer CANNOT list candidates (403) | ✅ |
| sales CANNOT list candidates (403) | ✅ |
| inventory CANNOT list candidates (403) | ✅ |
| service_mgr CANNOT list candidates (403) | ✅ |
| service_eng CANNOT list candidates (403) | ✅ |
| finance CANNOT list candidates (403) | ✅ |
| Candidates include engineer role | ✅ |
| Candidates include service_eng role | ✅ |
| Candidates do NOT include sales role | ✅ |
| Each candidate has id, name, role | ✅ |

## 2. Role/Division Checks

| Check | Result |
|-------|--------|
| hvac_pm sees only HVAC projects in list | ✅ |
| solar_pm sees only Solar projects in list | ✅ |
| mep_pm sees only MEP projects in list | ✅ |
| admin sees all projects | ✅ |
| engineer can view project list | ✅ |
| sales can view project list | ✅ |
| engineer can view project detail | ✅ |
| sales can view project detail | ✅ |
| engineer CANNOT change stage (403) | ✅ |
| hvac_pm CANNOT change Solar project stage (403) | ✅ |
| solar_pm CAN change Solar project stage | ✅ |
| admin CAN change any project stage | ✅ |

**PM Division Mapping verified**: hvac_pm → HVAC, solar_pm → Solar, mep_pm → MEP, admin → All.

## 3. Relationship Drift Check

**Method**: Backend sequential tests (373/373 PASS) include model reference validation that checks all declared ref fields point to valid targets. Test #373 ("reference fields declare the correct ref target") explicitly validates no unsupported FK relationships exist.

**Result**: No drift detected. No new relationships were added in this pass.

## 4. Final Browser Check (18 items)

| # | Check | Result |
|---|-------|--------|
| BC1 | Project list page loads | ✅ |
| BC2 | Project rows visible in list | ✅ |
| BC3 | No New Project button (PWA exact) | ✅ |
| BC4 | Search input present on list page | ✅ |
| BC5 | Project detail page loads | ✅ |
| BC6 | Division shown in detail | ✅ |
| BC7 | Stage shown in detail | ✅ |
| BC8 | Status shown in detail | ✅ |
| BC9 | SO link/reference present | ✅ |
| BC10 | Checklist section visible | ✅ |
| BC11 | Engineers section visible | ✅ |
| BC12 | Updates section visible | ✅ |
| BC13 | Delivery Challan section visible | ✅ |
| BC14 | Timeline section visible | ✅ |
| BC15 | Vendor field visible | ✅ |
| BC16 | Stage control present | ✅ |
| BC17 | Navigate back to project list | ✅ |
| BC18 | CSV export button visible for admin | ✅ |

## 5. Test Results

### Acceptance Correction Test (this pass)
```
75 / 75 PASS
  Gap 1 (Completion Gate):     5/5 ✅
  Gap 2 (Timeline Gate):       6/6 ✅
  Gap 3 (Template Apply):      8/8 ✅
  Gap 4 (Photo + Signature):  12/12 ✅
  Gap 5 (Eng-Candidate Auth): 14/14 ✅
  Gap 6 (Role/Division):      12/12 ✅
  Browser Check:              18/18 ✅
```

### Backend Sequential Tests (regression)
```
373 / 373 PASS
```

### Previous Pass 3A Browser Journey (baseline, not re-run — no regression risk)
```
38 / 38 PASS
```

## 6. FIX Log

| ID | Description | Files Changed |
|----|-------------|---------------|
| FIX-7-05 | Restrict `listEngineerCandidates()` to PM roles (admin, hvac_pm, solar_pm, mep_pm). Non-PM roles now receive 403 instead of the company employee pool. | `backend/src/services/projectService.js` |

## 7. Final Verdict

### **PASS**

All 5 evidence gaps are closed with passing tests. The one code change (FIX-7-05: engineer-candidate authorization restriction) is an infrastructure tightening — it does not change any PWA-observable behavior (only PMs could assign engineers anyway; the candidate list is now gated to the same roles). Backend regression tests confirm no breakage.

Stage 7 Pass 3A is fully accepted. **Do NOT start Pass 3B Contract.**
