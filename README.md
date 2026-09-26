# Acadlyx

Acadlyx is a multi-tenant, white-label **School Operating Platform**. One shared backend and
shared web/mobile codebases serve many independent schools, and each school keeps its own
isolated data, users, configuration, branding, domain and mobile app.

> **Current status:** Phase 1 (Project Foundation & Infrastructure) is complete. No school
> business functionality exists yet. See [docs/PHASE_STATUS.md](docs/PHASE_STATUS.md).
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

Details: [docs/architecture/README.md](docs/architecture/README.md).

## Workspace structure

```
apps/
  backend/          NestJS API under /api/v1 (config, database, cache, queue, health, logging, security, common)
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

For the one-time database and role creation, see
[local setup](docs/development/local-setup.md). If you use Docker, an optional
`infrastructure/docker/docker-compose.yml` is also available.

## Prisma

```bash
pnpm prisma:generate     # generate the typed client (also runs automatically before dev/build/test)
pnpm db:migrate          # create + apply a dev migration (prisma migrate dev)
pnpm db:migrate:deploy   # apply committed migrations (staging/production)
pnpm db:status           # migration status
pnpm db:reset            # DESTRUCTIVE: drops and recreates the dev database
```

The Phase 1 schema has no models, so no migrations exist yet. See
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

## Quality

```bash
pnpm lint            # ESLint (zero warnings allowed)
pnpm typecheck       # strict TypeScript across all workspaces
pnpm test            # Vitest: packages + backend unit + backend e2e (needs PostgreSQL + Redis)
pnpm build           # packages, backend, both web apps
pnpm validate:mobile # tsc + expo dependency check + iOS/Android bundle export
pnpm format          # Prettier
```

CI (`.github/workflows/ci.yml`) runs the same gates on every push to `main` and on every pull
request: Node 22.23.2, pnpm 11.19.0, frozen install, with PostgreSQL 17 and Redis 8 services.
It does not deploy.
