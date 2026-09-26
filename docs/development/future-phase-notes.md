# Future-phase notes

Items noticed during Phase 1 that were intentionally **not** implemented.

## Noted during Phase 2 (deliberately not implemented)

- Redis caching of tenant resolution/bootstrap (keyed by normalised domain/key, invalidated on
  update). Correctness first: every tenant request currently reads PostgreSQL.
- Automated DNS verification of custom domains (`verified_at` is set manually today).
- Media uploads for logos/images (branding stores https URLs only).
- Per-feature configuration payloads (flags are boolean today).
- Tenant branches (blueprint §3.1): later school-structure phase.
- Branded native mobile builds per tenant (app id, icons, store listing): white-label build phase.

## Phase 3 — Authentication & RBAC

- Fill `@acadlyx/permissions` with the permission catalogue (blueprint §5.7).
- Stricter `@Throttle()` limits on login/OTP routes. Move throttler storage to Redis.
- Attach auth headers through `createApiClient({ getHeaders })`.
- Persist `AuditService` events to a tenant-scoped AuditLog table, with real actor identity
  replacing `unauthenticated-platform-dev`.
- Protect `/api/v1/platform/*` and the Platform Admin app (Platform Super Admin role + MFA).

## CI/CD and deployment phases

- Deployment workflows (staging/production, blueprint §24.1). The quality gate already exists
  in `.github/workflows/ci.yml` and does not deploy.
- AWS/Terraform resources, Secrets Manager integration and CloudWatch/Sentry.
- White-label mobile build pipeline (blueprint §24.2).
