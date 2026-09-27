# Multi-tenancy (Phase 2)

Acadlyx uses **one PostgreSQL database with a shared schema and tenant-scoped rows** (blueprint
§3.3). There is no database-per-school, no backend-per-school and no frontend-per-school: one
tenant = one paying school organisation, and branding, domains, features and configuration decide
each school's experience.

The core guarantee is that **tenant A can never read, update, delete, query or infer tenant B's
data**. Several independent layers enforce it, and automated tests prove it.

```
Request ──▶ TenantResolutionMiddleware ──▶ TenantContext (AsyncLocalStorage)
                 │ Host / X-Acadlyx-Tenant-Key            │
                 ▼                                         ▼
          TenantResolverService                     TenantGuard (404/400/403)
          (platform role, read-only lookup)                │
                                                           ▼
                                   TenantPrismaService.run(tx => …)   role: acadlyx_app
                                     1. set_config('app.tenant_id', <ctx>, true)  (tx-local)
                                     2. scopeQueryArgs: tenant injected into where/data
                                                           ▼
                                   PostgreSQL RLS  (FORCE, policy tenant_isolation)
```

## Data model

| Table                   | Purpose                                  | Key constraints                                                                                       |
| ----------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `tenants`               | Identity + lifecycle                     | `key` unique + format CHECK, `slug` unique + format CHECK, `archived_at` set only when ARCHIVED       |
| `tenant_domains`        | Host names that resolve to the tenant    | `domain` globally unique, lower-case CHECK; one primary per (tenant, type) via a partial unique index |
| `tenant_brandings`      | White-label values (1:1)                 | `tenant_id` unique; hex colour CHECKs                                                                 |
| `tenant_features`       | Feature flags (`feature_key`, `enabled`) | unique (`tenant_id`, `feature_key`)                                                                   |
| `tenant_configurations` | Namespaced typed settings (JSONB)        | unique (`tenant_id`, `key`)                                                                           |

- IDs are **UUID v7**, the opaque primary key. `key` (e.g. `WORLD_WAY`) is the stable, immutable
  machine identifier. `slug` (e.g. `world-way`) is URL-friendly and locked after first activation.
  Display names are never used for resolution.
- Every child row has an FK to `tenants` with `ON DELETE RESTRICT`: deleting a tenant cannot
  cascade away its data. **No hard-delete API exists**. Lifecycle status is the only way to take a
  tenant offline. Hard deletion happens only in test cleanup helpers (`test/helpers/tenant-fixtures.ts`).
- Database naming: snake_case tables and columns (Prisma `@@map`/`@map`), PascalCase models.

## Lifecycle

```
DRAFT → ACTIVE | ARCHIVED
ACTIVE → SUSPENDED | INACTIVE
SUSPENDED → ACTIVE | INACTIVE
INACTIVE → ACTIVE | ARCHIVED
ARCHIVED → (terminal)
```

| Status    | Tenant routes (School Admin, mobile) | Platform Admin                  |
| --------- | ------------------------------------ | ------------------------------- |
| ACTIVE    | allowed                              | full management                 |
| DRAFT     | 403 `TENANT_UNAVAILABLE`             | full management                 |
| SUSPENDED | 403 `TENANT_UNAVAILABLE`             | full management                 |
| INACTIVE  | 403 `TENANT_UNAVAILABLE`             | full management                 |
| ARCHIVED  | 403 `TENANT_UNAVAILABLE`             | read + settings; no transitions |

The rules live in `@acadlyx/tenant-config` (`lifecycle.ts`) and are shared by the API and the UI.
Transitions use compare-and-set on the current status, so concurrent transitions cannot both
succeed. `first_activated_at` is set on first activation and locks the slug; `archived_at` is set
only on archive. There is no `deleted_at`.

## Request resolution

Approved precedence (`TenantResolverService`):

1. **Host header → `tenant_domains`.** The port is stripped and the host normalised. In
   production only **verified** domains resolve. In non-production, `*.localhost` domains also
   resolve while unverified, for local development.
2. **`X-Acadlyx-Tenant-Key`** is used only when the Host matched no tenant. It is the public
   identifier baked into branded mobile builds. It is **not a secret and never authentication**.
3. If the Host identifies a tenant and the key header is present, they must agree. Otherwise
   → **400 `TENANT_CONFLICT`**. The resolver never silently picks one.
4. Neither source matched → **404 `TENANT_NOT_FOUND`**.
5. Lifecycle is enforced after resolution: non-ACTIVE → **403 `TENANT_UNAVAILABLE`**.

There is no trusted-internal-header source in Phase 2. `tenant_id` from a body or query is never
trusted: DTOs reject unknown fields, and the tenant is derived only from the server-side resolution.

## Request context

`TenantContext` (`src/tenancy/tenant-context.ts`) is an `AsyncLocalStorage` store created per
request by `TenantResolutionMiddleware`. It carries `{ id, key, slug, status }`, is concurrency-safe
and has no global mutable state. Code reads it with `TenantContext.getTenant()`,
`requireActiveTenant()` or `getTenantId()`. Calling these outside a tenant request fails closed
(500), and a non-ACTIVE tenant fails with 403.

## Platform vs tenant routes

| Scope    | Prefix                 | Module            | DB access                                           | Tenant resolution |
| -------- | ---------------------- | ----------------- | --------------------------------------------------- | ----------------- |
| Platform | `/api/v1/platform/...` | `PlatformModule`  | `PlatformPrismaService` (role `acadlyx`, BYPASSRLS) | never             |
| Tenant   | `/api/v1/tenant/...`   | `TenantApiModule` | `TenantPrismaService` (role `acadlyx_app`, RLS)     | always            |
| Health   | `/api/v1/health`       | `HealthModule`    | platform (SELECT 1)                                 | never             |

New tenant-scoped controllers must be registered in `TENANT_CONTROLLERS` in
`tenant-api.module.ts` (which applies the middleware) and decorated with `@TenantScoped()` (the
guard). ESLint forbids importing `PlatformPrismaService` or `DatabaseModule` from
`src/tenant-api/**`.

## Tenant-scoped database access

`TenantPrismaService.run(fn)`:

1. Takes the tenant **only** from `TenantContext`. Callers cannot pass a tenant id.
2. Opens a Prisma interactive transaction, pinned to one pooled connection, as the restricted
   role `acadlyx_app`.
3. Runs `SELECT set_config('app.tenant_id', $1, true)`. The value is a bound parameter and the
   setting is **transaction-local**, so it is discarded at COMMIT/ROLLBACK and never leaks to the
   next borrower of the connection.
4. Every model query passes through `scopeQueryArgs` (a Prisma client extension). It injects the
   tenant into `where` clauses and create payloads, rejects explicit attempts to target another
   tenant (`TenantScopeViolationError`) and refuses unregistered models.

Developers therefore write `tx.tenantFeature.findMany({ where: { enabled: true } })` without
tenant filters. For creates, pass `tenantId: TenantContext.getTenantId()`, which Prisma's types
require; the scoping layer verifies it.

## PostgreSQL Row Level Security

Defined in the `phase_2_multi_tenancy` migration:

- `ENABLE` + **`FORCE ROW LEVEL SECURITY`** on all five tenant tables.
- `app_current_tenant_id()` returns `NULLIF(current_setting('app.tenant_id', true), '')::uuid`.
  When the setting is missing it returns NULL, which matches no rows (fail closed).
- Policy `tenant_isolation` `FOR ALL TO acadlyx_app`: `USING` and `WITH CHECK`
  `tenant_id = app_current_tenant_id()` (`id = …` on `tenants`).
- Grants: `acadlyx_app` has `SELECT` on `tenants` and `SELECT/INSERT/UPDATE/DELETE` on the four
  child tables. It is not an owner, not a superuser and has no BYPASSRLS.
- `acadlyx` (the owner, used by migrations and the platform path) has **BYPASSRLS**. This is
  required because FORCE also applies to owners. It is granted by `prisma/setup-roles.sql`, which a
  superuser runs once.

## Defense in depth, and what each layer protects

| Layer                          | Protects against                                                           |
| ------------------------------ | -------------------------------------------------------------------------- |
| Resolver (verified domains)    | Arbitrary/unverified hosts being trusted in production                     |
| Guard                          | Unknown, conflicting or non-ACTIVE tenants reaching handlers               |
| TenantContext (ALS)            | Context bleeding between concurrent requests                               |
| Role separation + ESLint rule  | Tenant code using the RLS-bypassing platform client                        |
| `scopeQueryArgs` extension     | Forgotten tenant filters; explicit cross-tenant queries (fails before SQL) |
| RLS (FORCE)                    | Any query on the tenant role, including raw SQL and application bugs       |
| Transaction-local `set_config` | Tenant id leaking across pooled connections                                |

Negative controls were run during Phase 2. With `set_config` removed, the application-path tests
fail, which shows RLS takes part in real requests. With the scoping extension disabled, RLS alone
still blocks every cross-tenant read, update and delete.

## Feature registry and configuration

- `FEATURE_REGISTRY` (`@acadlyx/tenant-config`) lists the 20 known modules as UPPER_SNAKE keys.
  Flags are rows (`feature_key`, `enabled`); a missing row means disabled. Adding a module needs
  no migration. **Flags are configuration only.** No module is implemented in Phase 2.
- `CONFIGURATION_REGISTRY` defines namespaced keys (`general.timezone`, `general.locale`,
  `general.academic_year_start_month`), each with a zod schema, a default and `public`
  visibility. Unknown keys and invalid values are rejected, and there is no raw JSON editing.
  Only `public` keys appear in the tenant bootstrap.

## Tenant bootstrap (public-safe)

```
GET /api/v1/tenant/bootstrap
Host: school-a.localhost            (or X-Acadlyx-Tenant-Key: SCHOOL_A)

{ "key": "SCHOOL_A", "slug": "school-a", "displayName": "Acadlyx Demo School A",
  "branding": { "schoolName": "…", "primaryColor": "#1D4ED8", … },
  "enabledFeatures": ["ATTENDANCE", …],
  "settings": { "general.timezone": "Asia/Kolkata", "general.locale": "en-IN" } }
```

It exposes no internal ids, domains or private configuration.

## White-label clients

- **School Admin** (one codebase): the Next.js server forwards the browser's `Host` to the API. It
  uses a `node:http` fetch because undici drops a caller-supplied Host header. The page renders the
  tenant's name, colours (validated hex, as CSS variables), features and footer. HTTP semantics
  match the API: an unknown school returns **404** via `notFound()` → `app/not-found.tsx`, and a
  DRAFT/SUSPENDED/INACTIVE/ARCHIVED school returns **403** via `forbidden()` → `app/forbidden.tsx`.
  `forbidden()` needs the `experimental.authInterrupts` Next.js flag. Next.js delivers these
  boundary UIs in the response's RSC payload with the real status code. Nothing is cached across
  requests. Covered by `apps/school-admin/test/tenant-http-status.e2e.test.ts`
  (`pnpm test:e2e:school-admin`, run against a live API and `next start`, and in CI).
- **Mobile**: `EXPO_PUBLIC_TENANT_KEY` (the development stand-in for the per-build `TENANT_KEY`)
  loads public branding through `X-Acadlyx-Tenant-Key`.

## Audit

`AuditService` records `TENANT_CREATED`, `TENANT_UPDATED`, `TENANT_ACTIVATED`, `TENANT_SUSPENDED`,
`TENANT_DEACTIVATED`, `TENANT_ARCHIVED`, `TENANT_DOMAIN_ADDED|UPDATED|REMOVED|VERIFICATION_CHANGED`,
`TENANT_BRANDING_UPDATED`, `TENANT_FEATURE_ENABLED|DISABLED` and `TENANT_CONFIGURATION_UPDATED`
to the structured log. Each record carries the request id, tenant id and key, the names of changed
fields (never their values) and a timestamp. Since Phase 3 these events are persisted to
`platform_audit_logs` with the authenticated Platform Admin as actor. Tenant auth events go to
`audit_logs` (see [../security/AUTHENTICATION.md](../security/AUTHENTICATION.md#audit)).

## Caching

None in Phase 2. Resolution reads PostgreSQL on every tenant request (correctness first). Redis
caching keyed by normalised domain or key, with invalidation on update, is a future optimisation.

## Testing strategy

| Suite                                           | Proves                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/rls.e2e-spec.ts`                          | Raw SQL as `acadlyx_app`: FORCE RLS on; zero rows without context; A→B, B→C, C→A SELECT/UPDATE/DELETE/INSERT blocked; cannot move rows or disable RLS; no leak on a reused pooled connection; concurrent isolation                                        |
| `test/tenant-isolation.e2e-spec.ts`             | Same attacks through `TenantPrismaService`; explicit cross-tenant queries rejected; fail-closed without context; alternating and 45 concurrent transactions                                                                                               |
| `test/tenant-resolution.e2e-spec.ts`            | Host → A/B/C; unknown → 404; key fallback; conflict → 400; DRAFT/SUSPENDED/INACTIVE/ARCHIVED → 403; unverified custom domains ignored; production mode ignores unverified `*.localhost`; public-safe payload; alternating and 60 concurrent HTTP requests |
| `test/platform-tenants.e2e-spec.ts`             | Platform API: create/get/update, duplicates (409), validation, immutability, lifecycle rules, domains, branding safety, features, configuration, search/filter/pagination, stats                                                                          |
| unit (`tenant-scope`, `tenant.guard`, packages) | Scoping rules, guard outcomes, host parsing, lifecycle matrix, validation schemas                                                                                                                                                                         |

Three fixture tenants (`<PREFIX>_A/B/C`) are created per suite and purged afterwards. Suites use
distinct key prefixes, so they never touch seed data.
