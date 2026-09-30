# White-label mobile (Phase 8)

- **One React Native codebase** (`apps/mobile`). **One tenant per production build.** **No generic school picker** — not in release builds, not in development UI.
- The build's school comes from `ACADLYX_TENANT=<variant>` → `apps/mobile/white-label/<variant>.json`, read by `app.config.ts`.

## Variant file (native / build-time — needs a new binary)

| Field                                  | Example (School A)         |
| -------------------------------------- | -------------------------- |
| `tenantKey` (public id, never auth)    | `SCHOOL_A`                 |
| `displayName` (installed app name)     | `Demo School A`            |
| `iosBundleIdentifier`                  | `com.acadlyx.demo.schoola` |
| `androidPackage`                       | `com.acadlyx.demo.schoola` |
| `scheme`                               | `acadlyx-demo-school-a`    |
| `assets` (icon, splash, adaptive icon) | generic Acadlyx dev assets |

School B uses the same shape (`SCHOOL_B`, `com.acadlyx.demo.schoolb`). Production schools supply their own icon/splash files in the variant; no school assets are invented.

## Runtime / server-driven (no new build)

School name, logo, primary colour and theme come from `TenantBranding` via `GET /tenant/bootstrap` at launch.

## Fail closed

- Release builds (`ACADLYX_RELEASE=1` or EAS `production`/`preview`) without a valid variant **fail to build**; there is no default school.
- A variant contradicting `EXPO_PUBLIC_TENANT_KEY` fails the build.
- At runtime the bootstrap must return exactly the build's key and an ACTIVE tenant; otherwise a neutral "School unavailable" screen is shown (no internal status).
- A stored session whose `/auth/me` tenant differs from the build's key is discarded.

## Development

`apps/mobile/.env` (git-ignored): `ACADLYX_TENANT=school-a`. Run `ACADLYX_TENANT=school-b pnpm --filter @acadlyx/mobile dev` for School B.

## Secrets

No signing certificates, provisioning profiles, keystores or store credentials are in the repository; they belong to the build service (EAS secrets / CI).

## Device permissions

None requested. Camera, microphone, location and notification permissions are blocked on Android.
