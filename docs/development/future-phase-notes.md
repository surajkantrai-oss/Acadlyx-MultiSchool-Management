# Future-phase notes

Items noticed during Phase 1 that were intentionally **not** implemented.

## Phase 2 — Multi-Tenancy & Platform Super Admin

- First Prisma migration: Tenant, TenantDomain, TenantBranding, TenantFeature, configuration.
- Tenant resolver (web domain → tenant; mobile build `TENANT_KEY` → tenant) placed before controllers.
- PostgreSQL RLS policies plus cross-tenant negative tests in CI (blueprint §26.3).
- Fill `@acadlyx/tenant-config` (tenant key, theme tokens, feature flags).
- Tenant-config cache in Redis.

## Phase 3 — Authentication & RBAC

- Fill `@acadlyx/permissions` with the permission catalogue (blueprint §5.7).
- Stricter `@Throttle()` limits on login/OTP routes. Move throttler storage to Redis.
- Attach auth headers through `createApiClient({ getHeaders })`.
- Persist `AuditService` events to a tenant-scoped AuditLog table.

## CI/CD and deployment phases

- Deployment workflows (staging/production, blueprint §24.1). The quality gate already exists
  in `.github/workflows/ci.yml` and does not deploy.
- AWS/Terraform resources, Secrets Manager integration and CloudWatch/Sentry.
- White-label mobile build pipeline (blueprint §24.2).
