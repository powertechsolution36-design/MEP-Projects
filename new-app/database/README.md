# new-app/database

Placeholder only — no collections created yet.

- Database: MongoDB.
- Planned: one collection per major business entity listed in `../docs/DOMAIN_MODEL.md` (Company, User, Enquiry, SalesOrder, Project, ServiceCall, Contract, Payment, Notification, ChecklistTemplate, InventoryCategory, InventoryLocation, InventoryItem, InventoryIssue, InventoryTransaction).
- Every collection carries a durable, server-generated ID as its primary key (never the original PWA's small sequential integers — see `../docs/DOMAIN_MODEL.md` → "ID Design") and a company/tenant reference for isolation.
- Nested/embedded structures (project checklist items, delivery challans, execution updates; payment part-payment ledger; contract visit schedule) are modeled as embedded documents within their parent, matching how the PWA already groups them, rather than flattened into separate collections.
- Indexes will be defined during the schema phase, not in this step.
- No connection to any existing V2/V3 database, and no data migration from either, is performed as part of this or any later step of this effort unless separately and explicitly authorized.
