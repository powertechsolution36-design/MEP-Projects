# Stage 7 — Step 0: Frontend Baseline Discovery

Status: DISCOVERY ONLY. No frontend code was written, no framework was chosen/scaffolded, no backend files were modified, no PWA files were touched. This document records the as-found state as of 2026-09-27 and proposes (for review, not execution) a pass breakdown for the actual Stage 7 build.

---

## 1. Current `new-app/frontend/` state

Full recursive listing of `new-app/frontend/`:

```
frontend/
└── README.md   (480 bytes)
```

That is the entirety of the directory. `README.md` content, verbatim:

> # new-app/frontend
>
> Placeholder only — no code yet.
>
> This will later become the new employee PWA, built against the new API (Phase 8 of the plan in `../docs/DOMAIN_MODEL.md`).
>
> `MEP_PROJECTS_PWA_original` (outside `new-app/`) remains the untouched functional reference and is never edited as part of this effort. The current, V2-adapted PWA at the repository root and under `MEP_PROJECTS_PWA/` is also untouched by this effort — it is a separate, already-in-progress project.

No `package.json`, no `node_modules`, no `src/`, no build config, no lockfile, no tests — nothing beyond the placeholder README. The Pass 3.5 finding ("frontend is empty except a placeholder README") is confirmed still true today.

## 2. Framework / tooling status

**Nothing has been chosen or scaffolded.** No React/Vue/Svelte/Angular, no plain-JS shell, no Vite/webpack/CRA config, no `.babelrc`, no `tsconfig.json`. This is a genuinely blank slate — Pass 1 of Stage 7 will need to make and record this decision (out of scope for this discovery pass).

## 3. Package manager

No lockfile exists anywhere under `new-app/frontend/`. The backend (`new-app/backend/`) uses **npm** (has `package-lock.json`), and the repo root also uses npm (`package-lock.json` at repo root, for the Expo/React Native app that is out of scope). No frontend-specific package manager decision has been made; npm is the path of least friction given the rest of the repo, but this is a Pass 1 decision, not made here.

## 4. Current routes

None. No routing library, no route table, no client-side router of any kind exists in `new-app/frontend/`.

## 5. Current components

None exist.

## 6. Current authentication / session handling

None exists in `new-app/frontend/`. (The *backend* already has a working auth foundation — see item 14 below — which the future frontend will need to call.)

## 7. Current API client

None exists in `new-app/frontend/`.

Worth noting for planning: the **PWA at the repository root** (`index.html`, V2-adapted, out of scope as an implementation source but relevant as prior art on *shape*) already contains its own fetch-based API client wired to the V2 backend (`API_BASE`, a `TOKEN` bearer-header wrapper called `api(method, path, body)`, a Socket.IO real-time layer, and a `loadFromAPI()` bulk loader). This is a V2-only concern (points at `api.mep-projects.spereon.codes` / `localhost:4001`) and must not be copied or reused as-is — the new-app frontend will need its own client against the 123-endpoint new-app contract — but its *existence* is a useful pattern reference for Pass 1 scaffolding (fetch wrapper shape, bearer token storage, error normalization).

## 8. Current state management

None exists in `new-app/frontend/`.

## 9. Current styling / design system

None exists in `new-app/frontend/`. No CSS framework, no component library, no design tokens have been chosen for the new app. (The root PWA uses hand-rolled CSS with no framework — again, prior art only, not a source to copy from per the engagement's UI/UX-source-of-truth rule, which is about *behavior/structure* to reproduce, not implementation technique.)

## 10. Current empty / placeholder screens

None exist as code — the entire screen surface (all modules) is unbuilt.

## 11. Build / dev / test command results

`new-app/frontend/package.json` does not exist, so there is no `npm run build`, `npm run dev`, or `npm test` to invoke — attempting `npm run <anything>` in `new-app/frontend/` fails immediately with npm's "no package.json found" error. There is nothing to run yet. This is expected given the directory's state and is not a defect.

## 12. Existing frontend tests

None exist.

## 13. PWA UI structure (reconnaissance for planning, not a full re-audit)

Full functional coverage already lives in `STAGE_6_PWA_FUNCTION_COVERAGE.md` and `STAGE_6_API_CONTRACT_AUDIT.md` — this section is only the navigation/shape summary needed to plan Stage 7 pass boundaries.

**App shell.** Single-page app: a fixed left sidebar (`<nav id="menu">`, collapsible via a burger button on mobile) plus a top bar (title + notification bell) plus a `<div id="view">` that the router (`nav(v,p)`) swaps innerHTML into. A single global modal (`<div id="mwrap"><div id="mbox">`) is reused for every create/edit/detail form across all modules, opened via a shared `modal(html)` helper. A toast element handles transient messages. An offline banner (`#offbar`) and an "Install this PWA" prompt bar (`#instbar`) are also part of the persistent shell.

**Routing.** Hash-free, JS-variable-driven client router: a `VIEW`/`PARAM` pair and a `TITLES` map (view key → page title) drive a dispatch table `R` (view key → render function, e.g. `dash: vDash`, `enquiries: vEnquiries`, `enq: vEnq` for the enquiry detail view, `so`/`sos`, `project`/`projects`, `call`/`service`, etc.). List views and single-record "detail" views are distinct route keys (e.g. `enquiries` list vs. `enq` detail-with-param).

**Role-based navigation (11 roles, each a different menu):** `super`, `admin`, `sales`, `hvac_pm`, `solar_pm`, `mep_pm`, `engineer`, `inventory`, `service_mgr`, `service_eng`, `finance`. Each role's `MENUS[role]` entry is an ordered list of (route key, emoji-prefixed label) pairs — e.g. `sales` sees only Dashboard/Enquiries/Sales Orders/Lost Enquiries; `admin` sees a superset spanning every business module; `engineer`/`service_eng` see a minimal "My Work"/"My Service Jobs" + "My Material" pair; `super` (platform-level) sees Companies/Client Business/Revenue/Expiring/Locations/Reports instead of any tenant business module. This role→menu mapping is a direct, load-bearing spec for the new frontend's navigation/permission-gating and should be reproduced route-for-route, not just role-for-role.

**Screen hierarchy per module** (list → detail, consistent pattern across modules): Dashboard (role-specific KPI cards + panels, e.g. `superDash`, `invDash`, `engDash`, and a composed default dashboard assembling KPI tiles + panels conditionally by role) → Enquiries (list `vEnquiries` / detail `vEnq`, plus a separate Lost Enquiries list `vLost`) → Sales Orders (list `vSOs` / detail `vSO`) → Projects (list `vProjects` / detail `vProject`, with checklist sub-view `vChklist`) → Service Calls (list `vService` / detail `vCall`, plus AMC/PM list `vPM`) → Payments (`vPayments`) → Inventory (Stock `vStock`, Issue `vIssue`, Transfer `vTransfer`, Categories/Locations `vInvCats`, Transaction history `vInvHistory`, Returns `vReturns`, My Material `vMyMaterial`, single item `vInvItem`) → Users (`vUsers`) → Checklist Templates (`vChecklists`) → Notifications (`vNotifs`) → platform-only: Companies (`vCompanies`), Revenue (`vRevenue`), Expiring (`vExpiring`), Locations (`vLocations`), Reports (`vReports`), Usage (`vUsage`).

**UI patterns used throughout:** KPI "cards" strip at the top of most list/dashboard views (`kpi(n, label, colorClass)`); dashboard "panels" (bordered sections with a header + action button, e.g. low-stock panel, delay panel, follow-up panel); dense HTML `<table>` listings with clickable rows (`onclick="nav('detail-view', id)"`) rather than a client-side grid component; status/role badges (`bdg(text, colorClass)`); a single shared modal for every create/edit form and confirmation dialog (no per-module modal component); a shared "toast" for transient feedback; simple native HTML form inputs with inline `onchange`/`onclick` handlers rather than a form library.

**Auth screen.** A single login view outside the app shell (`#login`), with a dev-only "quick login" panel (11 seeded demo users, one per role, toggled via a Ctrl+D dev-mode shortcut) — this quick-login panel is explicitly a demo/dev affordance in the legacy PWA and should NOT be treated as a requirement to reproduce in the new app; the underlying single-login-form pattern (username/password → role-based landing view) is the actual UI/UX contract to preserve.

## 14. Backend dev-server readiness for frontend consumption

- A real entrypoint exists: `new-app/backend/src/server.js` calls `connectToDatabase()`, builds the Express app via `createApp(config)`, starts the delay-check scheduler, and listens on `config.port` (default `4000` per `.env.example`).
- It **requires a real MongoDB connection** (`MONGODB_URI` in `.env`) to start — `connectToDatabase()` is called unconditionally before the app is created. No real MongoDB replica set is reachable in this environment (per engagement ground rules), so `server.js` cannot actually be run here to serve a live frontend during this pass, and this was not attempted.
- The **test harness** (`new-app --test tests/*.test.js tests/auth/*.test.js`) uses an in-memory fake-repository layer and does not touch a real database — this is confirmed working (see below) but it does not expose an HTTP server a frontend could call; it exercises services directly.
- Running the full backend test suite (`node --test tests/*.test.js tests/auth/*.test.js`) got to **369 of ~373 tests passing (0 failures observed)** before being killed by an external timeout (170s) — the process itself did not exit cleanly / print a final summary within that window even after the visible tests had finished. This looks like a lingering open handle (e.g., an un-`unref`'d timer or an unclosed mock resource) rather than a test failure, since zero `not ok` lines appeared. **This does not block Stage 7 planning** (it's a backend-side loose end, out of scope to fix per this task's instructions), but it should be flagged to Suhas as something worth a quick look before Stage 7 relies on running backend tests routinely in CI, since a hanging test run needs an external kill.
- **Planning implication:** Stage 7 frontend development will need *something* to talk to. Options to raise with Suhas before Pass 1 (not decided here): (a) stand up a real MongoDB instance (local `mongod` or a free-tier Atlas cluster) so `server.js` can run for real during frontend dev, or (b) build a thin dev-only HTTP wrapper around the existing in-memory fake-repository test harness so the frontend has something to hit without a real database. This is a genuine open decision, not something to resolve unilaterally.

## 15. Module-by-module: what exists vs. what's fully empty

| Module | Backend (routes/services/models) | Frontend |
|---|---|---|
| Auth | Implemented (`authRoutes.js`, `authService.js`, `tokenService.js`, `passwordHasher.js`, `roleDivision.js`, `AuthSession` model) | Empty |
| Company | Implemented (`companyRoutes.js`, `companyService.js`, `Company` model) | Empty |
| Enquiry | Implemented (`enquiryRoutes.js`, `enquiryService.js`, `Enquiry` model) | Empty |
| SalesOrder | Implemented (`salesOrderRoutes.js`, `salesOrderService.js`, `salesOrderCascade.js`, `SalesOrder` model) | Empty |
| Payment | Implemented (`paymentRoutes.js`, `paymentService.js`, `Payment` model) | Empty |
| Checklist | Implemented (`checklistTemplateRoutes.js`, `checklistTemplateService.js`, `ChecklistTemplate` model, seed data) | Empty |
| Project | Implemented (`projectRoutes.js`, `projectService.js`, `Project` model) | Empty |
| Contract | Implemented (`contractRoutes.js`, `contractService.js`, `Contract` model) | Empty |
| ServiceCall | Implemented (`serviceCallRoutes.js`, `serviceCallService.js`, `ServiceCall` model) | Empty |
| Inventory | Implemented (`inventoryRoutes.js`, `inventoryService.js`, `InventoryCategory`/`InventoryItem`/`InventoryLocation`/`InventoryIssue`/`InventoryTransaction` models) | Empty |
| Notifications | Implemented (`notificationRoutes.js`, `notificationService.js`, `Notification` model) | Empty |
| Reports | Covered as endpoints within the 123-endpoint contract (export/report routes; see `API_CONTRACT.md`); no standalone `Report` model/service — reports are derived/export views | Empty |
| Users | Implemented (`userRoutes.js`, `userService.js`, `User` model) | Empty |

All 123 backend endpoints exist and are documented and tested (Stage 6, locked PASS). The entire frontend column is empty — there is no partially-built UI anywhere, for any module, including no user-management screens.

## 16. Proposed pass breakdown for the Stage 7 build (RECOMMENDATION — for Suhas's review, not started)

This groups modules by business-flow dependency (matching the PWA's own natural sequence: an enquiry becomes a sales order, which drives payments and spawns a project, which runs checklists/contracts, which feeds service calls and inventory) so each pass produces a coherent, demoable slice rather than a technically-neat but functionally-incomplete one.

1. **Pass 1 — Scaffolding, auth, and shell navigation.** Pick and scaffold the framework/build tool/package manager (a real decision to make with Suhas, not pre-empted here); build the API client wrapper against the 123-endpoint contract; implement login, session/token storage and restoration, and role-based route guarding; build the persistent app shell (sidebar menu driven by role, top bar, shared modal, toast, offline/install banners as applicable) with the 11 role→menu maps reproduced; stub role-specific dashboards with real KPI data once the API client works. No business-module CRUD screens yet beyond the dashboard.
2. **Pass 2 — Commercial flow: Enquiry → Sales Order → Payment.** The PWA's primary sales pipeline. List + detail screens for Enquiries (including Lost Enquiries), Sales Orders, and Payments, plus the enquiry→SO conversion flow.
3. **Pass 3 — Delivery flow: Project → Checklist → Contract.** Project list/detail, checklist template management and per-project checklist completion, and Contract/AMC-PM screens (including the PM-visit-due logic).
4. **Pass 4 — Field operations: Service Call → Inventory.** Service Call list/detail and the AMC/PM list view; the full Inventory surface (Stock, Issue, Transfer, Categories & Locations, Transaction history, Returns, My Material, single-item view) — the PWA's largest and most role-fragmented module set.
5. **Pass 5 — Users, Notifications, Reports, platform/cross-cutting.** User management CRUD (currently fully absent from the frontend); Notifications; Reports/export views; the `super`-role platform screens (Companies, Revenue, Expiring, Locations, Client Usage) if those are in scope for this engagement's frontend (worth confirming with Suhas, since they're platform/SaaS-admin rather than tenant-business screens).
6. **Pass 6 — Error sweep and cross-module polish.** End-to-end pass across all modules for error states, empty states, loading states, edge cases the PWA handles inline (e.g. subscription/division gating messages), and any preserved-quirk reconciliation against Stage 0's preserved-quirks list per the STAGED_IMPLEMENTATION_PLAN.md ground rules for Stage 7.

Open questions this breakdown surfaces for Suhas, ahead of Pass 1:
- Framework/build-tool/package-manager choice for the frontend (nothing is pre-committed).
- What the frontend talks to during development, given no real MongoDB is reachable here and `server.js` requires one (see §14) — real DB vs. a dev wrapper around the fake-repo test harness.
- Whether the `super`/platform-admin screens (Companies, Revenue, Locations, Client Usage) are in scope for this engagement's frontend at all, given the rest of the engagement's business-tenant focus.
- The backend test-suite hang (§14) — likely worth a quick look before it becomes a habitual "just add a timeout and ignore it" pattern in CI.

---

*This document is a discovery/planning artifact only. No frontend code, framework choice, or backend/PWA modification was made in producing it.*

---

## Update: Stage 7 Pass 1 complete

Pass 1 (dev backend wrapper, frontend scaffold, auth, role-based shell/nav)
is done and verified — see `new-app/docs/STAGE_7_PASS_1_FOUNDATION.md` for
full details and evidence. Business module screens are not yet built
(Pass 2+).
