# Database (PostgreSQL + Prisma 7)

- Schema: `apps/backend/prisma/schema.prisma`
- Config: `apps/backend/prisma.config.ts`, which reads `DATABASE_URL` from `apps/backend/.env`
- Generated client: `apps/backend/src/generated/prisma` (gitignored; regenerated before dev,
  build, lint, typecheck and test)
- Runtime driver: `@prisma/adapter-pg`

## Phase 1 state

The schema defines **no models** and there are **no migrations**. This is intentional.
`prisma migrate dev` reports "Already in sync", and `pnpm db:status` reports "No migration
found" and exits non-zero until the first migration exists. The first migration is created in
Phase 2 (Tenant, TenantDomain, ...).

## Rules for future models (blueprint §3.3, §10.6)

- Every tenant-owned table has `tenant_id`, `created_at` and `updated_at`. Add `branch_id` and
  `academic_year_id` where relevant.
- Tenant isolation is enforced in the service layer **and** with PostgreSQL Row Level Security
  (Phase 2).
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

## Production migration strategy

1. Migrations are created in development and committed. Review the SQL before merging.
2. CI/CD runs `prisma migrate deploy` once per release, before the new backend version takes
   traffic. Never run `migrate dev` or `migrate reset` against staging or production.
3. Prefer expand-and-contract changes (add, backfill, switch, then remove later) so the running
   version keeps working during a deploy.
4. Take a backup or snapshot before any migration that changes or drops data.

## Local database

The role `acadlyx` (with `CREATEDB`, which `migrate dev` needs for its shadow database) owns
the `acadlyx` database. See [../development/local-setup.md](../development/local-setup.md).
