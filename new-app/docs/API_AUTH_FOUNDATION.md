# Foundation API — Authentication & Company Bootstrap

NEW BACKEND DESIGN. The PWA has no server/API of its own — nothing here is a
PWA fact, it is the new backend's own implementation of the PWA's functional
requirement ("username/password login, an authenticated employee session,
role-aware and company-aware access"). This document covers ONLY the four
endpoints implemented in this stage. No business-workflow API (enquiries,
sales orders, projects, inventory, service, payments, contracts,
notifications) is documented or implemented here.

Every endpoint is mounted under `/api` by `src/app.js`.

---

## POST /api/auth/login

- **PURPOSE:** authenticate an employee with username + password (+ company,
  for every role except `super`) and issue a signed session token.
- **AUTHENTICATION:** none (this is how a session is obtained).
- **AUTHORIZATION:** none.
- **REQUEST body (JSON):**
  ```json
  { "companyId": "<ObjectId string, omit/null for role=super>", "username": "string", "password": "string" }
  ```
- **RESPONSE 200:**
  ```json
  { "token": "<JWT>", "expiresAt": "<ISO date>", "user": { "id", "name", "username", "role", "companyId", "active" } }
  ```
  Never includes `passwordHash` or any secret.
- **RESPONSE 401:** `{ "error": "Invalid username or password." }` (or, only
  after a correct password match, `{ "error": "This account is inactive." }`)
  — the same generic message is used for "unknown username" and "wrong
  password" so a caller cannot distinguish which was the cause.
- **VALIDATION:** `username` and `password` required; `companyId` required
  for every role except `super` (usernames are only unique WITHIN a company —
  see USERNAME RULE — so a bare username cannot be resolved without it).

## POST /api/auth/logout

- **PURPOSE:** invalidate the caller's current session server-side (the
  bearer token stops working immediately, even though its JWT `exp` has not
  yet passed).
- **AUTHENTICATION:** required — `Authorization: Bearer <token>`.
- **AUTHORIZATION:** any authenticated role; a session can only ever revoke itself.
- **REQUEST:** no body.
- **RESPONSE 200:** `{ "ok": true }`. Idempotent — logging out twice is not an error.
- **VALIDATION:** none beyond authentication.

## GET /api/auth/me

- **PURPOSE:** return the authenticated caller's own safe profile/role/company.
- **AUTHENTICATION:** required — `Authorization: Bearer <token>`.
- **AUTHORIZATION:** any authenticated role (self only).
- **REQUEST:** no body.
- **RESPONSE 200:** `{ "user": { "id", "name", "username", "role", "companyId", "active" } }`
  — never a password hash, secret, or session-signing key.
- **RESPONSE 401:** `{ "error": "Authentication required." }` (no/invalid/expired token)
  or `{ "error": "Invalid or expired session." }` (token verifies but the
  backing session was revoked/expired, or the user no longer exists).

## POST /api/companies

- **PURPOSE:** bootstrap a new tenant — create a Company and its exactly-one
  initial admin-role User, with the admin's password hashed before storage
  (never the PWA's "show plaintext once" behavior).
- **AUTHENTICATION:** required — `Authorization: Bearer <token>`.
- **AUTHORIZATION:** `role=super` only.
- **REQUEST body (JSON):**
  ```json
  {
    "company": { "name": "string", "divisions": ["HVAC","Solar","MEP" /* subset */], "...": "other DATABASE_SCHEMA.md §1 fields" },
    "admin": { "name": "string", "username": "string", "password": "string" }
  }
  ```
- **RESPONSE 201:** `{ "company": {...}, "admin": { "id","name","username","role":"admin","companyId","active" } }`
  — `admin` never includes the plaintext password or its hash.
- **RESPONSE 400:** `{ "error": "<validation message>" }` — e.g. missing
  company name, missing admin fields, or username already taken within that company.
- **RESPONSE 403 (via requireRole):** caller is authenticated but not `super`.
- **VALIDATION:** company name and admin name/username/password required;
  admin username must not already exist within the new company
  (`{companyId, username}` uniqueness — DATABASE_SCHEMA.md §2); `admin` role
  is not a PM role, so no division-binding check applies, but the same
  `assertRoleAllowedForCompany` gate is still run for consistency.

---

## Deliberately not built at this stage

Full Company/User CRUD, password reset/change, multi-device session listing,
per-user permission overrides, and any business-workflow route. See the
FOUNDATION IMPLEMENTATION task's "NO BUSINESS WORKFLOW YET" scope.
