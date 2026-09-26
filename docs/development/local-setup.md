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

One-time creation of the role and database (choose your own password):

```bash
psql -h localhost -d postgres -c "CREATE ROLE acadlyx LOGIN CREATEDB PASSWORD '<password>';"
psql -h localhost -d postgres -c "CREATE DATABASE acadlyx OWNER acadlyx;"
```

Then set `DATABASE_URL=postgresql://acadlyx:<password>@localhost:5432/acadlyx?schema=public`
in `apps/backend/.env`.

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
