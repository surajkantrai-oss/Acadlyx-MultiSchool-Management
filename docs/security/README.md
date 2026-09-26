# Security foundation (Phase 1)

Phase 1 provides global security primitives only. Authentication, MFA and RBAC are Phase 3.
Tenant isolation and RLS are Phase 2.

| Control            | Implementation                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security headers   | helmet, with a `default-src 'none'` CSP for the JSON API; `x-powered-by` disabled                                                                        |
| CORS               | Exact-match allow-list from `CORS_ORIGINS`. Wildcards are rejected by env validation. Requests without an Origin (mobile, server-to-server) are allowed. |
| Payload validation | Global `ValidationPipe`: whitelist, forbid unknown properties (mass-assignment protection), transform                                                    |
| Request size       | `BODY_LIMIT` (default 1mb) for JSON and urlencoded bodies                                                                                                |
| Env validation     | zod schema at boot. The app fails fast without printing values.                                                                                          |
| Secrets            | Only in `.env` (gitignored) locally and in Secrets Manager in production. Never in source.                                                               |
| Safe errors        | Global filter. 5xx responses never expose internals.                                                                                                     |
| Log redaction      | Authorization, cookies, API keys and `password`/`pin`/`otp`/`token`/`secret` fields are redacted                                                         |
| Rate limiting      | `@nestjs/throttler` global guard (in-memory; switch to Redis storage before running more than one instance)                                              |
| Audit logging      | `AuditService.record()` integration point. It writes to structured logs until the AuditLog table exists.                                                 |
| Proxy awareness    | `TRUST_PROXY` for correct client IPs behind a load balancer                                                                                              |

## Conventions for later phases

- Never accept `tenant_id` from a client body or query. It is derived on the server
  (blueprint §4.1).
- Every DTO uses class-validator decorators. Unknown fields are rejected globally.
- Never log raw credentials, OTPs or tokens. Add new sensitive field names to `REDACT_PATHS`.
- Serve files only through authorized or signed URLs (blueprint §21.1).
