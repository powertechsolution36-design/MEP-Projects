# new-app/backend

Placeholder only — no runtime code yet.

- Independent API and service layer for the new application — no dependency on v2/ or v3/ code, schemas, APIs, database, authentication, or permissions.
- Database: MongoDB (see `../database/README.md`).
- Planned layered architecture: routes → controllers → services → data-access layer, so that every business rule documented in `../docs/DOMAIN_MODEL.md` is enforced server-side, not only in client UI (as it is today in the PWA).
- Authentication and authorization are not implemented yet — see `../docs/DOMAIN_MODEL.md` ("Security Design", "Passwords") for the documented requirements to build against in a later step.
- Passwords must be securely hashed; plaintext passwords (as currently stored in the PWA) must never be carried into this backend.
