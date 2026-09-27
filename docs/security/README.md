# Security

Phase 1 provided global security primitives. Phase 2 added tenant isolation. Phase 3 added
authentication, MFA, RBAC and session management:

- [AUTHENTICATION.md](AUTHENTICATION.md): identities, credentials, lockout, tokens, MFA, OTP,
  devices, rate limiting and audit.
- [RBAC.md](RBAC.md): permissions, roles and enforcement.
- [SESSION_MANAGEMENT.md](SESSION_MANAGEMENT.md): session lifetimes, rotation, revocation,
  web BFF cookies and CSRF, and mobile secure storage.

Every API route is protected by the global `AccessGuard` and fails closed without a declared
policy.

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
