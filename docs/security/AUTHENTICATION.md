# Authentication (Phase 3)

Acadlyx has two separate identity spaces (blueprint §10):

| Identity      | Table            | Who                             | Signs in at                                      |
| ------------- | ---------------- | ------------------------------- | ------------------------------------------------ |
| Platform user | `platform_users` | Acadlyx staff (Platform Admin)  | Platform Admin web → `/api/v1/platform/auth/*`   |
| Tenant user   | `users`          | School staff, parents, students | School Admin web / mobile app → `/api/v1/auth/*` |

A tenant user belongs to exactly one school. The same email or phone may exist in several
schools; they are separate accounts. The school is always resolved from the request (`Host` or
`X-Acadlyx-Tenant-Key`), never from the request body.

## Account lifecycle

`PENDING_ACTIVATION → ACTIVE ⇄ SUSPENDED`, and `DISABLED`. Lockout is not a status: it is
`locked_until` on the account.

Platform users are created only with the CLI, and no default credentials exist:

```bash
PLATFORM_ADMIN_EMAIL=… PLATFORM_ADMIN_NAME="…" PLATFORM_ADMIN_PASSWORD=… pnpm --filter @acadlyx/backend platform:create-admin
```

Tenant users are created by a Platform Admin (Platform Admin → school → Users) in
PENDING_ACTIVATION. The user activates with a one-time code (OTP to their verified channel, or a
code issued by an admin) and chooses their own password or PIN. Admins never set credentials.

## Credentials

| Kind     | Who                                                        | Rules                                                                       |
| -------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| Password | Platform users, all staff roles                            | 8–128 chars (tenant), 12–128 (platform); no leading/trailing spaces         |
| PIN      | Only accounts whose every role allows it (PARENT, STUDENT) | exactly 6 digits; no repeated (111111) or sequential (123456 / 654321) PINs |

Hashing uses Argon2id (m=19 MiB, t=2, p=1), and a login transparently re-hashes when the
parameters change. The login ID can be an email, phone (E.164) or login ID (student or employee
ID), all normalised.

### Lockout (atomic)

The attempt counter is reserved under a `SELECT … FOR UPDATE` row lock before verification, so
parallel guesses cannot exceed the limit.

| Credential        | Threshold  | Lock                                       |
| ----------------- | ---------- | ------------------------------------------ |
| PIN               | 5 failures | 15 min; the 3rd lockout within 24 h → 24 h |
| Password (tenant) | 10         | 15 min                                     |
| Platform password | 5          | 30 min                                     |

A per-identifier Redis limiter and per-IP route throttles sit in front of this (see
[Rate limiting](#rate-limiting)). Error responses are generic: an unknown account, a wrong
secret and a suspended account all return `401 INVALID_CREDENTIALS`.

## Tokens

- **Access token:** a JWT signed with Ed25519 (EdDSA), valid for 10 minutes, with `kid` in the
  header and audience `acadlyx:tenant:access` or `acadlyx:platform:access`. Claims:
  `sub, sid, scope, tid` (tenant). There are **no roles or permissions in the token**.
- **Every request** re-checks the session server-side: the Redis cache (~30 s, explicitly
  invalidated on revoke) backed by PostgreSQL as the source of truth. A revoked session stops
  working immediately, even while its JWT is unexpired.
- **Refresh token:** 256-bit random, stored only as an HMAC, and rotated on every use. Reusing a
  rotated token revokes the whole session family (`REFRESH_TOKEN_REUSE` audit).
- **Key rings:** `AUTH_JWT_PRIVATE_KEYS`, `AUTH_ENCRYPTION_KEYS` and `AUTH_HMAC_KEYS` are JSON maps
  `{kid: base64}` with an `*_ACTIVE_KID`. Rotate by adding a new id, switching the active id, and
  removing the old one once it is unused. Generate with `pnpm --filter @acadlyx/backend auth:keys`.
  Never commit keys; CI generates throwaway rings per run.

The guard order (global `AccessGuard`) is: tenant resolution (404/400/403) → bearer token →
audience/scope → token tenant = request tenant (`TENANT_MISMATCH` 403) → live session → required
permissions. A route with no declared policy **fails closed**.

## MFA (TOTP)

- MFA is mandatory for PLATFORM_ADMIN, PRINCIPAL, SCHOOL_ADMIN and ACCOUNTANT. It is optional for
  other roles and **enforced at login once enrolled**.
- The first sign-in of a role that requires MFA returns `MFA_ENROLLMENT_REQUIRED`. The user
  enrols with a TOTP secret (QR plus manual key, shown once) and confirms a code, and only then
  is a session issued.
- The secret is encrypted with AES-256-GCM (key ring, AAD bound to the owner). Codes are
  single-use, including within their 30 s step (replay rejected).
- 10 recovery codes (`XXXXX-XXXXX`) are stored as HMACs and are single-use. They can be
  regenerated, which invalidates the old ones.
- The MFA step token is short-lived and bound to the pending login. On the web it lives in an
  HttpOnly `SameSite=Strict` cookie.

## OTP

Used for activation, recovery and identifier changes: 6 digits, 5-minute expiry, 5 attempts,
60 s resend cooldown, 5 sends per hour per target and 10 per hour per IP. Codes are stored as
HMAC-SHA256.

Delivery is **dev outbox only** in Phase 3 (a Redis key read by tests and developers).
`OTP_DELIVERY=none`, and production without a real provider, **fail closed**. No SMS or email
provider is wired yet.

Recovery never reveals whether an account exists.

## New devices

Each client sends a random installation id (web: an HttpOnly `acx_did` cookie; mobile: secure
storage). A login from an unseen installation is recorded in `user_devices` and audited as
`NEW_DEVICE_LOGIN`. **No OTP is enforced for new devices** (approved Phase 3 decision). Devices
can be listed and revoked, and revoking a device revokes its sessions.

## Rate limiting

Redis-backed throttling (`throttle:*`) applies to every route, with stricter named throttles on
login, OTP, MFA, refresh and recovery. There is also a per-identifier limiter (`auth:ident:*`).

**If Redis fails, limits do not disappear:** storage falls back to an in-memory
per-instance window (`memory-window.ts`), and the fallback is logged. Tested in
`auth-hardening.e2e-spec.ts`.

## Clients

- **Web (Platform Admin, School Admin):** a BFF. The browser never sees tokens; see
  [SESSION_MANAGEMENT.md](SESSION_MANAGEMENT.md#web-bff).
- **Mobile:** access token in memory, refresh token and installation id in `expo-secure-store`
  (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). **Never AsyncStorage.**

## Audit

`audit_logs` (tenant, RLS: insert and select only, never update or delete) and
`platform_audit_logs`. Actions include:

- LOGIN_SUCCESS, LOGIN_FAILED, ACCOUNT_LOCKED, NEW_DEVICE_LOGIN
- MFA_ENROLLED, MFA_FAILED, MFA_REMOVED, MFA_RECOVERY_CODE_USED, MFA_RECOVERY_CODES_REGENERATED
- LOGOUT, SESSION_REVOKED, DEVICE_REVOKED, REFRESH_TOKEN_REUSE
- PASSWORD_CHANGED, PIN_CHANGED, PASSWORD_RESET, PIN_RESET
- ACCOUNT_ACTIVATED, ACTIVATION_CODE_ISSUED, USER_ACTIVATION_RESET
- TENANT_USER_CREATED, TENANT_USER_UPDATED, ROLE_ASSIGNED, ROLE_REMOVED
- USER_SUSPENDED, USER_REACTIVATED, USER_DISABLED
- PLATFORM_USER_CREATED, plus the Phase 2 tenant-management actions

Records carry the actor, IP and user agent, and never secrets, codes or tokens (log redaction
is covered by `redaction.spec.ts`).
