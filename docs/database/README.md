# Database (PostgreSQL + Prisma 7)

- Schema: `apps/backend/prisma/schema.prisma`
- Config: `apps/backend/prisma.config.ts`, which reads `DATABASE_URL` (owner role) from `apps/backend/.env`
- Generated client: `apps/backend/src/generated/prisma` (gitignored; regenerated before dev,
  build, lint, typecheck and test)
- Runtime driver: `@prisma/adapter-pg`

## Roles

| Role          | Used by                                                                       | Privileges                                                                                |
| ------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `acadlyx`     | Migrations, `PlatformPrismaService` (Platform Admin, tenant resolution), seed | Schema owner, `CREATEDB`, **BYPASSRLS**                                                   |
| `acadlyx_app` | `TenantPrismaService` only (`DATABASE_APP_URL`)                               | `SELECT` on `tenants`; `SELECT/INSERT/UPDATE/DELETE` on tenant child tables; RLS enforced |

Roles are created once by a superuser with `apps/backend/prisma/setup-roles.sql`, because role
creation and BYPASSRLS cannot run inside migrations. The migration grants table privileges to
`acadlyx_app`, so the role must exist **before** `migrate deploy`/`migrate dev`.

## Migrations

### `20260926141005_phase_2_multi_tenancy`

| Kind              | Objects                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enums             | `tenant_status` (DRAFT, ACTIVE, SUSPENDED, INACTIVE, ARCHIVED), `tenant_domain_type` (PLATFORM_SUBDOMAIN, CUSTOM, ADMIN)                                                                                                                 |
| Tables            | `tenants`, `tenant_domains`, `tenant_brandings`, `tenant_features`, `tenant_configurations`                                                                                                                                              |
| Unique indexes    | `tenants(key)`, `tenants(slug)`, `tenant_domains(domain)`, `tenant_brandings(tenant_id)`, `tenant_features(tenant_id, feature_key)`, `tenant_configurations(tenant_id, key)`, partial `tenant_domains(tenant_id, type) WHERE is_primary` |
| Indexes           | `tenants(status)`, `tenant_domains(tenant_id)` (other child `tenant_id` lookups use the composite unique indexes)                                                                                                                        |
| Foreign keys      | Every child `tenant_id` → `tenants(id)` **ON DELETE RESTRICT**                                                                                                                                                                           |
| CHECK constraints | key/slug format, `archived_at` iff ARCHIVED, lower-case domain without `/`, `:` or spaces, hex colours                                                                                                                                   |
| Function          | `app_current_tenant_id()` (reads the transaction-local `app.tenant_id`)                                                                                                                                                                  |
| RLS               | ENABLE + FORCE on all five tables; policy `tenant_isolation` FOR ALL TO `acadlyx_app` (USING + WITH CHECK)                                                                                                                               |
| Grants            | See the roles table above                                                                                                                                                                                                                |
| Triggers          | None                                                                                                                                                                                                                                     |

The SQL is Prisma-generated DDL plus a reviewed hand-written section (constraints, RLS, grants).
Prisma does not model RLS or partial indexes; `prisma migrate diff` reports no drift.

## Rules for future models (blueprint §3.3, §10.6)

- Every tenant-owned table has `tenant_id`, `created_at` and `updated_at`. Add `branch_id` and
  `academic_year_id` where relevant.
- Tenant isolation is enforced by `TenantPrismaService` (context + automatic scoping) **and** by
  PostgreSQL Row Level Security. New tenant tables must be added to `TENANT_SCOPED_MODELS`, get
  ENABLE + FORCE RLS, a `tenant_isolation` policy and grants to `acadlyx_app` in their migration.
  See [../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md).
- Use a single shared database/schema. Do not create a database per tenant.

## Commands (run from the repo root)

| Command                                                        | Purpose                                                             | Destructive?                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| `pnpm prisma:generate`                                         | Generate the typed client                                           | No                                        |
| `pnpm db:migrate`                                              | `prisma migrate dev`: create and apply a migration locally          | Dev DB only; may prompt to reset on drift |
| `pnpm --filter @acadlyx/backend db:migrate:create -- --name x` | Create a migration without applying it (review SQL first)           | No                                        |
| `pnpm db:migrate:deploy`                                       | `prisma migrate deploy`: apply committed migrations                 | No (forward-only)                         |
| `pnpm db:status`                                               | Show applied and pending migrations                                 | No                                        |
| `pnpm db:reset`                                                | `prisma migrate reset`: **drops all data** and reapplies migrations | **YES, dev only**                         |
| `pnpm db:seed`                                                 | Upsert demo tenants SCHOOL_A/B/C (refuses when NODE_ENV=production) | No (idempotent)                           |

## Production migration strategy

1. Migrations are created in development and committed. Review the SQL before merging.
2. CI/CD runs `prisma migrate deploy` once per release, before the new backend version takes
   traffic. Never run `migrate dev` or `migrate reset` against staging or production.
3. Prefer expand-and-contract changes (add, backfill, switch, then remove later) so the running
   version keeps working during a deploy.
4. Take a backup or snapshot before any migration that changes or drops data.

## Local database

See [../development/local-setup.md](../development/local-setup.md). `acadlyx` needs `CREATEDB`
because `migrate dev` creates a shadow database. The tenant tables use FORCE RLS, so running
queries as `acadlyx` without BYPASSRLS would return no rows.
