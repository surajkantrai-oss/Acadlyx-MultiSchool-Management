# Local development setup

## Ports

| Service        | URL                                 |
| -------------- | ----------------------------------- |
| Backend API    | http://localhost:4000/api/v1        |
| Health         | http://localhost:4000/api/v1/health |
| Platform Admin | http://localhost:4001               |
| School Admin   | http://localhost:4002               |
| Expo Metro     | http://localhost:8081               |
| PostgreSQL     | localhost:5432                      |
| Redis          | localhost:6379                      |

Ports 3000–3002 are left free on purpose so Acadlyx can run alongside other local projects.

## PostgreSQL (native Homebrew, primary)

```bash
brew services start postgresql@17
```

One-time creation of both roles and the database. Run it as a PostgreSQL superuser (with
Homebrew, that's your macOS user). It is idempotent, and you choose the passwords:

```bash
psql -h localhost -d postgres -v owner_password="'<owner-password>'" -v app_password="'<app-password>'" -f apps/backend/prisma/setup-roles.sql
```

Then set both URLs in `apps/backend/.env`:

```
DATABASE_URL=postgresql://acadlyx:<owner-password>@localhost:5432/acadlyx?schema=public
DATABASE_APP_URL=postgresql://acadlyx_app:<app-password>@localhost:5432/acadlyx?schema=public
```

Generate development auth keys (Phase 3) and paste the printed lines into `apps/backend/.env`
(never commit them):

```bash
pnpm --filter @acadlyx/backend auth:keys
```

Apply migrations and load the demo tenants. The dev user credentials come only from your
environment; without `DEV_SEED_PASSWORD` and `DEV_SEED_PIN`, users are created in
PENDING_ACTIVATION:

```bash
pnpm db:migrate:deploy
DEV_SEED_PASSWORD='<12+ chars>' DEV_SEED_PIN='<6 digits>' pnpm db:seed
```

Create the first Platform Admin (TOTP enrolment is forced at first sign-in on
http://localhost:4001/login):

```bash
PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_NAME="Your Name" PLATFORM_ADMIN_PASSWORD='<12+ chars>' \
  pnpm --filter @acadlyx/backend platform:create-admin
```

OTP codes for activation and recovery are written to the Redis dev outbox (`OTP_DELIVERY=dev`)
and are never sent anywhere.

## Local tenant domains

Browsers and curl resolve any `*.localhost` host name to 127.0.0.1, so no hosts-file changes are
needed. In non-production environments, unverified `*.localhost` tenant domains resolve (verified
domains only in production). The port is ignored during resolution, so `school-a.localhost` works
on both 4000 (API) and 4002 (School Admin).

- http://school-a.localhost:4002 and http://school-b.localhost:4002 show the same School Admin
  code with different tenant branding.
- API: `curl -H 'Host: school-a.localhost' http://localhost:4000/api/v1/tenant/bootstrap`
- Mobile: `EXPO_PUBLIC_TENANT_KEY=SCHOOL_A` in `apps/mobile/.env`, then restart Metro.

## Redis (native Homebrew, primary)

```bash
brew services start redis
redis-cli ping   # PONG
```

## Docker alternative (optional)

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

Stop the native services first, because the compose file uses the same ports.

## Mobile

- iOS Simulator: `pnpm dev:mobile`, then press `i`. Android emulator: press `a`.
- On a physical device, set `EXPO_PUBLIC_API_BASE_URL` in `apps/mobile/.env` to your machine's
  LAN IP (not `localhost`).
- Native `ios/` and `android/` folders are not committed. Prebuild and white-label builds come in a later phase.

## Troubleshooting

- `pnpm` errors with `node:sqlite`: you are on Node 20. Run `nvm use` (Node 22).
- `Invalid environment configuration`: the listed keys are missing or invalid in
  `apps/backend/.env`.
- `Cannot find module '@acadlyx/...'`: run `pnpm build:packages`.
- Health returns 503: check `brew services list` for postgresql@17 and redis.
