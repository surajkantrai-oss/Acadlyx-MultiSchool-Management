# Security

Phase 1 provided global security primitives. Phase 2 added tenant isolation. Phase 3 added
authentication, MFA, RBAC and session management:

- [AUTHENTICATION.md](AUTHENTICATION.md): identities, credentials, lockout, tokens, MFA, OTP,
  devices, rate limiting and audit.
- [RBAC.md](RBAC.md): permissions, roles and enforcement.
- [SESSION_MANAGEMENT.md](SESSION_MANAGEMENT.md): session lifetimes, rotation, revocation,
  web BFF cookies and CSRF, and mobile secure storage.

Every API route is protected by the global `AccessGuard` and fails closed without a declared
policy. Phase 4 academic tables follow the same layers (permission per route, TenantContext,
`acadlyx_app` + scoping, FORCE RLS) plus composite `(id, school_id, tenant_id)` foreign keys —
see [../architecture/SCHOOL_ACADEMIC_MODEL.md](../architecture/SCHOOL_ACADEMIC_MODEL.md).

Phase 5 people tables add:

- Composite FKs to `users (id, tenant_id)`, so a profile can never link another tenant's login.
- The SECURITY DEFINER `app_create_profile_account`. It is tenant-bound, allows only
  STUDENT/PARENT/TEACHER, and is the only user-insert path for `acadlyx_app`.
- An append-only status history.
- Import hardening:
  - size and row limits
  - a ZIP-bomb guard
  - formula cells rejected
  - CSV-injection-safe error reports
  - raw files never stored
  - a worker that re-resolves the tenant and runs under RLS

See [../architecture/PEOPLE_AND_ENROLLMENT_MODEL.md](../architecture/PEOPLE_AND_ENROLLMENT_MODEL.md).

Phase 7 extends the teacher scope to attendance, homework, assignments and timetables (assigned sections and, for class work, the exact subject). It keeps attendance history append-only and adds database-enforced timetable conflict protection. Phase 6 adds the teacher data scope (`people.read_all`, resource-level) and a leadership-only activity feed (`school_activity.read`) that shows humanised AuditLog events without raw payloads. It also adds global search,
which never returns or matches contact fields and is bounded to 2–64 characters and 6 results per
type. The academic-context cookie holds ids only and is re-validated against the school on every
request. See [../architecture/SCHOOL_ADMIN_PORTAL.md](../architecture/SCHOOL_ADMIN_PORTAL.md).

| Control            | Implementation                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security headers   | helmet, with a `default-src 'none'` CSP for the JSON API; `x-powered-by` disabled                                                                        |
| CORS               | Exact-match allow-list from `CORS_ORIGINS`. Wildcards are rejected by env validation. Requests without an Origin (mobile, server-to-server) are allowed. |
| Payload validation | Global `ValidationPipe`: whitelist, forbid unknown properties (mass-assignment protection), transform                                                    |
| Request size       | `BODY_LIMIT` (default 1mb) for JSON and urlencoded bodies                                                                                                |
| Env validation     | zod schema at boot. The app fails fast without printing values.                                                                                          |
| Secrets            | Only in `.env` (gitignored) locally and in Secrets Manager in production. Never in source.                                                               |
| Safe errors        | Global filter. 5xx responses never expose internals.                                                                                                     |
| Log redaction      | Authorization, cookies, API keys, `password`/`pin`/`otp`/`code`/`token`/`secret` fields and auth key rings are redacted (tested)                         |
| Rate limiting      | `@nestjs/throttler` with Redis storage (shared across instances) and stricter auth-route throttles; in-memory fallback if Redis fails (never unlimited)  |
| Audit logging      | Persisted to `audit_logs` (tenant, RLS, append-only) and `platform_audit_logs`, with real actor identity. Never secrets or codes.                        |
| Caching of auth    | `Cache-Control: no-store` on every API response                                                                                                          |
| Proxy awareness    | `TRUST_PROXY` for correct client IPs behind a load balancer                                                                                              |

## Tenant isolation (Phase 2)

Full design: [../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md).

- **How tenant context is established:** `TenantResolutionMiddleware` resolves the tenant from
  `Host` (verified domains; unverified `*.localhost` only outside production) or, as a fallback,
  the public `X-Acadlyx-Tenant-Key`. Conflicts are rejected. The result is stored in a
  per-request `AsyncLocalStorage` context, and `TenantGuard` enforces 404/400/403.
- **How context reaches the database:** `TenantPrismaService.run()` opens a transaction as
  `acadlyx_app` and binds the tenant id with the transaction-local
  `set_config('app.tenant_id', $1, true)`.
- **What prevents cross-tenant access:** automatic query scoping (which also rejects explicit
  cross-tenant targets), then PostgreSQL RLS with FORCE on every tenant table. A missing context
  yields zero rows.
- **What RLS protects:** every statement issued as `acadlyx_app`, including raw SQL and buggy
  application code. It cannot be disabled by that role (`row_security = off` errors).
- **What application guards protect:** unknown, conflicting or non-ACTIVE tenants never reach
  handlers, and tenant code cannot obtain the platform client (module wiring plus an ESLint rule).
- **How leaks are avoided:** the setting is transaction-scoped, so pooled connections carry
  nothing between requests. Tests alternate A/B/A/B on one pooled connection and run up to 60
  concurrent mixed-tenant requests.
- **Platform path:** `acadlyx` has BYPASSRLS by design. It is used only by platform routes and
  tenant resolution. Never pass it into tenant-scoped modules.
- **Public data only:** the tenant bootstrap returns no internal ids, domains or private settings.
  Branding values are validated (https URLs, hex colours, text without `<` or `>`), and School
  Admin applies only validated colours as CSS variables.

## Conventions for later phases

- Never accept `tenant_id` from a client body or query. It is derived on the server
  (blueprint §4.1).
- Every DTO uses class-validator decorators. Unknown fields are rejected globally.
- Never log raw credentials, OTPs or tokens. Add new sensitive field names to `REDACT_PATHS`.
- Serve files only through authorized or signed URLs (blueprint §21.1).

## Phase 8 — mobile self-service

- Parent access is relationship-scoped (own Parent profile → StudentGuardian); Student access is self-only; Teachers use Phase 7 permissions + Section/Subject scope. No broad reads are granted to Parents/Students.
- The in-app active role is presentation only; the server authorises every request.
- Tenant-bound builds: the tenant key is public identification, never auth. A session for another tenant is rejected (403) and discarded by the app.
- SecureStore holds the refresh token and non-sensitive per-school preferences; the access token and academic data live in memory; sign-out clears them all.
- Submission URLs are https-only, stored as text and never fetched server-side; submission content never enters the AuditLog.

## Phase 9 — assessment

- **Permission and scope must both pass.** Out-of-scope ids return 404. A student id from the client is never proof of access: the parent's child is verified through StudentGuardian, and the student through their own profile.
- **Parents and students read only the current published snapshot.** Live marks, draft sheets, previews and draft grades are never returned to them.
- **Marks cannot be overwritten silently.** They are validated in the service and again by database triggers/CHECKs. Every change is versioned; a stale version returns 409.
- **History is append-only.** Mark history, sheet events, grade history and result snapshots are SELECT/INSERT only for the app role.
- **The AuditLog holds ids, counts and version numbers only.** It never stores marks, snapshots, remarks or feedback text. The activity feed is exam/class level only.
- **Negative controls (2026-09-30):**
  - Removing teacher scope, the parent relationship check, student ownership, the unpublished gate, the mark-range check or the sheet version check made the tests fail.
  - Removing the app tenant filter left every Phase 9 isolation test passing, because RLS still enforced isolation.
