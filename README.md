# Acadlyx

Acadlyx is a multi-tenant, white-label **School Operating Platform**. One shared backend and
shared web/mobile codebases serve many independent schools, and each school keeps its own
isolated data, users, configuration, branding, domain and mobile app.

> **Current status:** Phase 2 (Multi-Tenancy & Platform Super Admin) is implemented and awaiting
> review. Schools can be created and configured as isolated tenants. No school business modules
> (students, attendance, fees, …) exist yet. See [docs/PHASE_STATUS.md](docs/PHASE_STATUS.md).
> The planning blueprint (the "SchoolOS V1 Master Blueprint") is the source of truth.
> Wherever it says SchoolOS, read Acadlyx.

## Architecture overview

```
                     ACADLYX (pnpm monorepo)
                              │
     ┌────────────────────────┼─────────────────────────┐
  Backend (NestJS)     Web (Next.js)                Mobile (Expo)
  modular monolith     Platform Admin · School Admin  React Native
  PostgreSQL/Prisma
  Redis · BullMQ
                              │
   Shared packages: constants · types · validation · utils · api-client
                    web-ui · mobile-ui · permissions · tenant-config
```

Details: [docs/architecture/README.md](docs/architecture/README.md) and
[docs/architecture/MULTI_TENANCY.md](docs/architecture/MULTI_TENANCY.md) (tenant model, resolution,
context, RLS, isolation tests).

## Workspace structure

```
apps/
  backend/          NestJS API under /api/v1 (platform, tenancy, tenant-api, config, database, cache, queue, health, logging, security, common)
  platform-admin/   Next.js internal Acadlyx team portal        (port 4001)
  school-admin/     Next.js white-label school portal           (port 4002)
  mobile/           Expo React Native app                       (Metro 8081)
packages/           Shared libraries (built to dist/, consumed as @acadlyx/*)
infrastructure/     docker (optional compose), aws, terraform, github-actions (empty until their phases)
docs/               architecture, database, api, security, development, PHASE_STATUS.md
```

## Prerequisites

| Tool                             | Version                                             |
| -------------------------------- | --------------------------------------------------- |
| Node.js                          | 22.x (`.nvmrc` → 22.23.2). pnpm 11 needs ≥22.13.    |
| pnpm                             | 11.19.0 (pinned via `packageManager`; use corepack) |
| PostgreSQL                       | 17 (native Homebrew is the primary setup)           |
| Redis                            | 7+ (8.x used locally)                               |
| Xcode / Android Studio / Expo Go | optional, for running the mobile app                |

## Installation

```bash
nvm use            # Node 22
corepack enable
pnpm install
```

## Environment setup

Each app has a `.env.example` file. Copy it and fill in values. Never commit real `.env` files.

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/platform-admin/.env.example apps/platform-admin/.env.local
cp apps/school-admin/.env.example apps/school-admin/.env.local
cp apps/mobile/.env.example apps/mobile/.env
```

The backend validates its environment at startup and exits with a list of invalid keys (values
are never printed). See [docs/development/local-setup.md](docs/development/local-setup.md).

## Start PostgreSQL and Redis

```bash
brew services start postgresql@17
brew services start redis
```

For the one-time creation of the two database roles (`acadlyx` owner/platform, `acadlyx_app`
restricted tenant role) and the database, see [local setup](docs/development/local-setup.md). If you use Docker, an optional
`infrastructure/docker/docker-compose.yml` is also available.

## Prisma

```bash
pnpm prisma:generate     # generate the typed client (also runs automatically before dev/build/test)
pnpm db:migrate          # create + apply a dev migration (prisma migrate dev)
pnpm db:migrate:deploy   # apply committed migrations (staging/production)
pnpm db:status           # migration status
pnpm db:reset            # DESTRUCTIVE: drops and recreates the dev database
pnpm db:seed             # demo tenants SCHOOL_A/B/C (idempotent; refuses in production)
```

Migrations: `phase_2_multi_tenancy` (tenant tables, constraints, Row Level Security). See
[docs/database/README.md](docs/database/README.md).

## Running

```bash
pnpm dev                  # builds packages, then backend + both web apps in parallel
pnpm dev:backend          # http://localhost:4000/api/v1  (health: /api/v1/health)
pnpm dev:platform-admin   # http://localhost:4001
pnpm dev:school-admin     # http://localhost:4002
pnpm dev:mobile           # Expo Metro on :8081 (press i / a, or scan with Expo Go)
```

Run `pnpm build:packages` once before starting a single app on its own.

### Trying multi-tenancy locally

`*.localhost` host names resolve to 127.0.0.1 in browsers and curl, so no hosts-file edits are
needed. After `pnpm db:seed`:

| URL                            | Shows                                              |
| ------------------------------ | -------------------------------------------------- |
| http://localhost:4001          | Platform Admin: dashboard and school management    |
| http://school-a.localhost:4002 | School Admin branded as School A (blue)            |
| http://school-b.localhost:4002 | Same codebase branded as School B (green)          |
| http://school-c.localhost:4002 | “School unavailable”, HTTP 403 (School C is DRAFT) |
| http://unknown.localhost:4002  | “School not found”, HTTP 404                       |

```bash
curl -H 'Host: school-a.localhost' http://localhost:4000/api/v1/tenant/bootstrap
curl -H 'X-Acadlyx-Tenant-Key: SCHOOL_B' http://localhost:4000/api/v1/tenant/bootstrap
```

Mobile: set `EXPO_PUBLIC_TENANT_KEY=SCHOOL_A` in `apps/mobile/.env` to see School A branding.

### Signing in (Phase 3)

Authentication is required everywhere except public tenant bootstrap and health. See
[docs/security/AUTHENTICATION.md](docs/security/AUTHENTICATION.md),
[RBAC.md](docs/security/RBAC.md) and [SESSION_MANAGEMENT.md](docs/security/SESSION_MANAGEMENT.md).

```bash
pnpm --filter @acadlyx/backend auth:keys   # prints fresh key rings → paste into apps/backend/.env
PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_NAME="Your Name" PLATFORM_ADMIN_PASSWORD='<12+ chars>' \
  pnpm --filter @acadlyx/backend platform:create-admin     # first Platform Admin (TOTP enrolment forced at first sign-in)
DEV_SEED_PASSWORD='<12+ chars>' DEV_SEED_PIN='<6 digits>' pnpm db:seed   # dev school users (credentials from env only)
```

There are no default credentials. OTP codes (activation and recovery) go to a development
outbox in Redis (`OTP_DELIVERY=dev`); production without a real provider fails closed.

### School setup (Phase 4)

Signed-in Principals and School Admins configure the school at
http://school-a.localhost:4002/settings/school: profile, branches (campuses), academic years,
grades and sections, subjects and academic settings. Teachers and other staff see read-only
views according to their permissions. The seed adds a fictional structure to each demo school.
See [docs/architecture/SCHOOL_ACADEMIC_MODEL.md](docs/architecture/SCHOOL_ACADEMIC_MODEL.md)
and [docs/api/ACADEMIC_CONFIGURATION.md](docs/api/ACADEMIC_CONFIGURATION.md).

### Attendance, homework, assignments & timetable (Phase 7)

The School Admin workspace now covers day-to-day academic operations:

- **Attendance:** daily class attendance with "Mark all present", a correction log and a 7-day
  teacher window.
- **Homework and assignments:** a draft → publish lifecycle.
- **Timetable:** a weekly timetable with branch bell schedules and database-enforced teacher and
  class conflict protection.

Teachers work only in the classes and subjects they are assigned. See
[docs/architecture/ATTENDANCE_MODEL.md](docs/architecture/ATTENDANCE_MODEL.md),
[docs/architecture/ACADEMIC_WORK_MODEL.md](docs/architecture/ACADEMIC_WORK_MODEL.md),
[docs/architecture/TIMETABLE_MODEL.md](docs/architecture/TIMETABLE_MODEL.md) and
[docs/api/ACADEMIC_OPERATIONS.md](docs/api/ACADEMIC_OPERATIONS.md).

### School Admin workspace (Phase 6)

Signing in at http://school-a.localhost:4002 opens the School Admin workspace:

- a dashboard with real counts for the chosen academic year and branch
- Classes (section rosters with their students, teachers and subjects)
- global search across students, guardians, teachers and classes
- a Login access list for profiles without an active login

Navigation follows your permissions. Teachers see only the classes they teach. See
[docs/architecture/SCHOOL_ADMIN_PORTAL.md](docs/architecture/SCHOOL_ADMIN_PORTAL.md).

### People & bulk onboarding (Phase 5)

http://school-a.localhost:4002/people manages students (with class placement, guardians and
status), parents and teachers (with subject/class-teacher assignments), and bulk imports from
CSV/XLSX templates (upload → preview → confirm → background processing on BullMQ). Accounts are
never created by imports; **Create account** on a profile starts the normal activation flow.
The seed adds fictional people to the demo schools. See
[docs/architecture/PEOPLE_AND_ENROLLMENT_MODEL.md](docs/architecture/PEOPLE_AND_ENROLLMENT_MODEL.md),
[docs/api/PEOPLE_ONBOARDING.md](docs/api/PEOPLE_ONBOARDING.md) and
[docs/development/BULK_IMPORT.md](docs/development/BULK_IMPORT.md).

## Quality

```bash
pnpm lint            # ESLint (zero warnings allowed)
pnpm typecheck       # strict TypeScript across all workspaces
pnpm test            # Vitest: packages + backend unit + e2e + tenant isolation/RLS (needs PostgreSQL + Redis, migrated)
pnpm build           # packages, backend, both web apps
pnpm validate:mobile # tsc + expo dependency check + iOS/Android bundle export
pnpm test:e2e:school-admin   # School Admin status codes + BFF auth (needs API on :4000 and `next start` on :4002)
pnpm test:e2e:platform-admin # Platform Admin auth/MFA/BFF (needs API on :4000 and `next start` on :4001)
pnpm format          # Prettier
```

CI (`.github/workflows/ci.yml`) runs the same gates on every push to `main` and on every pull
request: Node 22.23.2, pnpm 11.19.0, frozen install, PostgreSQL 17 and Redis 8 services, database
role setup and `migrate deploy`, throwaway per-run auth key rings, a committed-secret guard, and
the web auth e2e suites. It does not deploy.
