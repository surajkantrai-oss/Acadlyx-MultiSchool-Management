# Database (PostgreSQL + Prisma 7)

- Schema: `apps/backend/prisma/schema.prisma`
- Config: `apps/backend/prisma.config.ts`, which reads `DATABASE_URL` (owner role) from `apps/backend/.env`
- Generated client: `apps/backend/src/generated/prisma` (gitignored; regenerated before dev,
  build, lint, typecheck and test)
- Runtime driver: `@prisma/adapter-pg`

## Roles

| Role          | Used by                                                                       | Privileges                                                                                                    |
| ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `acadlyx`     | Migrations, `PlatformPrismaService` (Platform Admin, tenant resolution), seed | Schema owner, `CREATEDB`, **BYPASSRLS**                                                                       |
| `acadlyx_app` | `TenantPrismaService` only (`DATABASE_APP_URL`)                               | `SELECT` on `tenants`; per-table least-privilege grants on tenant tables (Phase 3/4 migrations); RLS enforced |

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

### `20260926165455_phase_3_authentication_rbac_security`

Identity, RBAC, sessions, MFA, OTP and audit tables. See
[../security/AUTHENTICATION.md](../security/AUTHENTICATION.md).

### `20260927042714_phase_4_school_academic_configuration`

Model: [../architecture/SCHOOL_ACADEMIC_MODEL.md](../architecture/SCHOOL_ACADEMIC_MODEL.md).

| Kind               | Objects                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension          | `btree_gist` (trusted; used by the academic-year exclusion constraint)                                                                                                                    |
| Enums              | `school_board`, `weekday`, `academic_year_status` (PLANNED, ACTIVE, CLOSED)                                                                                                               |
| Tables             | `schools`, `branches`, `academic_years`, `grades`, `sections`, `subjects`, `grade_subjects`                                                                                               |
| Composite keys/FKs | `UNIQUE (id, school_id, tenant_id)` on parents; children reference `(…_id, school_id, tenant_id)`; `schools (id, tenant_id)`; every FK **ON DELETE RESTRICT**                             |
| Unique             | codes per school (branches, grades, subjects), year name per school, section code per (branch, year, grade), `grade_subjects (grade_id, subject_id)`, partial `schools (tenant_id, code)` |
| Partial unique     | one primary branch per school; one current academic year per school                                                                                                                       |
| Deferrable unique  | `grades (school_id, display_order)`, `sections (branch_id, academic_year_id, grade_id, display_order)`                                                                                    |
| Exclusion          | `academic_years_no_overlap` — `(school_id WITH =, daterange(start_date, end_date, '[]') WITH &&)`                                                                                         |
| CHECK              | upper-case code format, start < end, current ⇒ ACTIVE, primary ⇒ active, capacity > 0, display_order ≥ 0, board_name only for OTHER, ISO country, start month 1–12, ≥ 1 working day       |
| RLS                | ENABLE + FORCE on all 7 tables; `tenant_isolation` FOR ALL TO `acadlyx_app`                                                                                                               |
| Grants             | SELECT all; INSERT all except `schools`; column-level UPDATE (no id/tenant/school/scope columns); DELETE only on `grade_subjects`                                                         |
| Backfill           | One School per existing tenant (name from branding, defaults from tenant configuration)                                                                                                   |

Migrations are immutable once applied to a persistent database. Corrections go in a new
migration.

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
5. **Required extension (Phase 4+):** the PostgreSQL server must provide `btree_gist` (bundled
   with standard PostgreSQL contrib and available on Amazon RDS/Aurora). The Phase 4 migration
   runs `CREATE EXTENSION IF NOT EXISTS btree_gist` as the database owner (trusted extension, no
   superuser needed) for the academic-year no-overlap exclusion constraint.

## Local database

See [../development/local-setup.md](../development/local-setup.md). `acadlyx` needs `CREATEDB`
because `migrate dev` creates a shadow database. The tenant tables use FORCE RLS, so running
queries as `acadlyx` without BYPASSRLS would return no rows.
