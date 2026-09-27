# Session management (Phase 3)

## Model

A **session** (`sessions`) is one sign-in on one device. It holds the owner (a tenant user or
platform user, never both; enforced by a CHECK), scope, device, IP and user agent, `last_active_at`,
`idle_expires_at`, `absolute_expires_at` and `revoked_at`/`revocation_reason`. **Refresh tokens**
(`refresh_tokens`) form the rotation chain of a session. Only HMACs are stored.

| Policy     | Applies to                                    | Idle   | Absolute |
| ---------- | --------------------------------------------- | ------ | -------- |
| PLATFORM   | Platform Admin                                | 30 min | 12 h     |
| PRIVILEGED | Principal, School Admin, Accountant           | 12 h   | 7 d      |
| STAFF      | Teacher, Admission Officer, Transport Manager | 7 d    | 30 d     |
| FAMILY     | Parent, Student                               | 30 d   | 90 d     |

The most restrictive policy applies across a user's roles. Activity means a successful refresh,
which extends the idle window but never goes past the absolute expiry.

## Lifecycle

1. **Login** creates a session and returns an access token (10 min) and a refresh token.
2. **Every API request** checks the session: the Redis cache (`auth:sess:*`, ~30 s) backed by
   PostgreSQL. A cache miss re-reads the database. Revocation deletes the cache entry.
3. **Refresh** rotates the token. Presenting an already-rotated token (reuse) revokes the entire
   session and is audited as `REFRESH_TOKEN_REUSE`. Concurrent refreshes with the same token
   result in exactly one winner.
4. **Revocation:**
   - Logout: the current session.
   - Logout-all: every session.
   - Revoking a session or device.
   - A password or PIN change revokes the user's **other** sessions; a reset revokes **all** of
     them.
   - Admin suspend, disable, activation reset or role assignment revokes all sessions.
   - Absolute or idle expiry.

Users can list and revoke their sessions and devices (School Admin → Security, Platform Admin →
Account security).

## Web BFF

The Next.js server is the only API client. The browser holds only HttpOnly cookies:

| Cookie      | Content                   | SameSite | Lifetime         |
| ----------- | ------------------------- | -------- | ---------------- |
| `acx_at`    | access token              | Lax      | token expiry     |
| `acx_rt`    | refresh token             | Lax      | session absolute |
| `acx_mfa`   | pending MFA step token    | Strict   | step expiry      |
| `acx_grant` | activation/recovery grant | Strict   | grant expiry     |
| `acx_did`   | installation id           | Lax      | 1 year           |

- In production (`next start`) cookies are `Secure` and use the `__Host-` prefix: exact host,
  `Path=/` and no `Domain`. A School A cookie is therefore never sent to School B, and a stolen
  token is still rejected by `TENANT_MISMATCH`. Tokens never appear in response bodies,
  `localStorage` or client JS.
- **CSRF:** every BFF mutation requires the `x-acadlyx-csrf: 1` header **and** an `Origin` (or
  `Referer`) exactly equal to the request's own origin. Otherwise the response is
  `403 CSRF_REJECTED`.
- **Proxy (`src/proxy.ts`):** on page requests, if the access token is missing or expires within
  60 s and a refresh cookie exists, the proxy rotates the token server-side and sets the new
  cookies on both the response and the forwarded request. Protected Platform Admin pages
  redirect to `/login` when no session is usable. School Admin shows the branded sign-in at `/`.
- **BFF API proxy (`/bff/api/*`):** an explicit allow-list of paths. Anything else is 404.
- Every API response sends `Cache-Control: no-store`.

## Mobile

- The access token is kept **in memory only**. The refresh token (per school) and the
  installation id are stored in `expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so
  they are not included in device backups. **AsyncStorage is never used.**
- **Restore on launch:** read the refresh token, rotate it and load `/me`. A 4xx response wipes
  local credentials and shows sign-in. A network error keeps the token and offers a retry.
- **Refresh** runs about 1 minute before access-token expiry and is single-flight, so a rotated
  token is never replayed (a replay would trigger reuse revocation).
- **Sign-out** revokes the session server-side on a best-effort basis and always wipes the local
  credentials.
- iOS note: Keychain items can outlive an app uninstall. The installation id is random, carries
  no personal data, and a reinstall simply looks like a known device.
