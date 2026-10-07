# Test Strategy — New MEP Employee App (future categories, not implemented in this step)

This document lists the test categories the new backend/API will need once implementation begins. No test infrastructure is created in this step.

1. **Unit tests** — pure business-rule functions in isolation (e.g. inventory balance/state-machine derivation, payment status derivation, contract visit-schedule generation, checklist delay computation), mirroring the real-code-extraction technique already used to verify the current PWA's PWA-only patches.
2. **API tests** — request/response contract tests per documented endpoint (once Phase 7 documents them): status codes, payload shape, required/optional field validation.
3. **Authorization tests** — every role × action pair in DOMAIN_MODEL.md's "Role-dependent actions" sections, both allow and deny cases; assignment-based checks (checklist sign-role, project engineer assignment, service-call engineer assignment) tested as their own category, not folded into plain role tests.
4. **Business workflow tests** — each of the 12 end-to-end workflows in DOMAIN_MODEL.md's Workflow Specification, exercised start-to-finish (e.g. Enquiry → SO → Project → timeline → checklist → completion → Contract → PM visit → completion).
5. **Inventory ledger tests** — every InventoryItem/InventoryIssue mutation path produces exactly one correct InventoryTransaction entry; balance math (`issued − returned − used`) under partial return, damaged write-off, and mark-used-on-site paths.
6. **Payment reconciliation tests** — part-payment accumulation, status auto-settling (Pending↔Received), SO-milestone mirroring, milestone-amount-cannot-go-below-received guard.
7. **Multi-tenant isolation tests** — no cross-company data leakage on any list/detail/report endpoint; company-scoped uniqueness rules (once decided, see OPEN_DECISIONS.md #12) enforced correctly.
8. **PWA integration tests** — once the PWA is reconnected to the new API (Phase 8), the same kind of extraction-based, real-code test harness already used for the current PWA's boot/cache patches should be re-pointed at the new API calls instead of the old V2-adapter calls.
9. **Offline read-cache tests** — for the approved READ CACHE ONLY scope: ownership/ownership-mismatch handling, stale-cache fallback, ordinary online-boot behavior unaffected — following the same pattern as the durable local read cache already implemented and tested (39 assertions) for the current, V2-adapted PWA.
