# Acadlyx architecture (Phase 1 foundation)

Source of truth: SchoolOS V1 Master Blueprint (§1, §3, §9, §21–23, §32). This document
describes what Phase 1 implements and the boundaries that later phases must respect.

## Why a monorepo

The backend, the two web portals and the mobile app share API types, validation rules,
constants, the HTTP client and, later, permission and tenant contracts (blueprint §22). With
one pnpm workspace these stay in lock-step: a single lockfile, one set of versions and one CI
run. Shared code lives in `packages/*` and is consumed as `@acadlyx/*` via `workspace:*`.

## Why a modular monolith

Blueprint §1.1 and §43 lock this decision: V1 runs as **one deployable NestJS backend** made
of well-bounded modules. Microservices, Kafka, CQRS, database-per-tenant and similar patterns
are explicitly out of scope. A module may be extracted later only when scale or team
structure justifies it.

## Backend layout (`apps/backend/src`)

| Module      | Responsibility                                                                              |
| ----------- | ------------------------------------------------------------------------------------------- |
| `config/`   | Loads env, validates it with zod (`env.schema.ts`) and exposes the typed `AppConfigService` |
| `database/` | `PrismaService` (Prisma 7 + `@prisma/adapter-pg`), lifecycle, health probe                  |
| `cache/`    | `RedisService`, the shared ioredis connection, lifecycle and health probe                   |
| `queue/`    | BullMQ root config (connection, `acadlyx` prefix, retry defaults). No queues yet.           |
| `health/`   | `GET /api/v1/health` returns 200/503 with application/database/redis status                 |
| `logging/`  | nestjs-pino structured logs, request-id correlation, secret redaction                       |
| `security/` | helmet headers, exact-match CORS, global rate-limit guard (throttler)                       |
| `common/`   | Global exception filter (standard error body) and the `AuditService` integration point      |
| `app/`      | Root module and `configureApp()`, which main.ts and the e2e tests both use                  |

Request pipeline: pino-http (request id) → helmet → CORS → body limit → throttler guard →
ValidationPipe (whitelist, forbid unknown fields) → controller → AllExceptionsFilter.

The backend is **ESM** (NestJS 12 is ESM-only), so relative imports use `.js` suffixes.

## Workspace boundaries

- Apps may depend on packages. Packages never depend on apps.
- Packages form a DAG: `api-client → constants, types, utils`. The other packages are leaves.
- `web-ui` is React DOM only. `mobile-ui` is React Native only. Neither imports the other.
- Business code never goes into `utils` or `constants`. It belongs to the backend module or
  package owned by its phase.

## Shared packages

| Package         | Phase 1 contents                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `constants`     | App name, `/api/v1` prefix, health path, request-id header, dev ports                                    |
| `types`         | `HealthResponse`, `ApiErrorResponse`, `AppEnvironment`, auth contracts (Phase 3)                         |
| `validation`    | zod plus env primitives (`originListSchema`, `portSchema`, `logLevelSchema`)                             |
| `utils`         | `joinUrl`, `assertNever`, `isNonEmptyString`                                                             |
| `api-client`    | `createApiClient({ baseUrl, getHeaders })`, `ApiError`, auth/platform/tenant clients, BFF cookie helpers |
| `web-ui`        | Unbranded `AppShell`, `Card`, `Button` (Tailwind classes)                                                |
| `mobile-ui`     | Unbranded `Screen`, `Heading`, `BodyText`                                                                |
| `permissions`   | RBAC registry: permissions, system roles, MFA/PIN/session policies (Phase 3)                             |
| `tenant-config` | Lifecycle rules, feature registry, configuration registry, tenant API contracts (Phase 2)                |

Packages compile with `tsc` to `dist/` (ESM + `.d.ts`). Run `pnpm build:packages` before
typechecking or starting an app. The root `dev`, `typecheck` and `test` scripts do this
automatically.

## Database foundation

PostgreSQL through Prisma 7 (`prisma-client` generator, ESM output in `src/generated/prisma`,
gitignored). The schema has **no models**. Tenant-aware models, `tenant_id` scoping and
Row Level Security arrive in Phase 2. See [../database/README.md](../database/README.md).

## Redis

A single shared ioredis connection (`RedisService`). It will later serve the tenant-config
cache, feature flags, permission cache, rate limiting and session metadata (blueprint §21.2).
No business caching exists yet.

## BullMQ

`QueueModule` registers the BullMQ root configuration only. Each feature phase registers its
own queues with `BullModule.registerQueue({ name })` and adds processors: notifications,
email/SMS/WhatsApp, imports, report cards, payment webhooks, analytics and scheduled notices
(blueprint §21.3). BullMQ opens its own Redis connections because workers use blocking
commands.

## Environment management

- Every app has a `.env.example`. Real `.env*` files are gitignored.
- The backend validates the environment at boot (`validateEnv`) and fails fast without echoing
  values.
- Frontends only read public values (`NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`), and these are bundled
  into the client.
- Production secrets will come from AWS Secrets Manager or the task environment (deployment
  phase).

## Multi-tenancy (Phase 2)

The backend has two scopes. `PlatformModule` (`/api/v1/platform`, platform DB role) manages
tenants. `TenantApiModule` (`/api/v1/tenant`) resolves the tenant per request and reaches the
database only through `TenantPrismaService` (restricted role, automatic scoping, PostgreSQL RLS).
See [MULTI_TENANCY.md](MULTI_TENANCY.md).

| Module              | Responsibility                                                                      |
| ------------------- | ----------------------------------------------------------------------------------- |
| `tenancy/`          | Resolver, AsyncLocalStorage context, guard, tenant Prisma client and scoping        |
| `tenant-api/`       | Tenant-scoped controllers (Phase 2: `GET /tenant/bootstrap`)                        |
| `platform/tenants/` | Platform Admin APIs: tenants, lifecycle, domains, branding, features, configuration |
