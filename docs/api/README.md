# API conventions

- Base path: **`/api/v1`**. Every route is versioned. Unprefixed paths return 404.
- Format: JSON REST. Future APIs are tenant-aware (the tenant is derived by the server, never
  trusted from the client), permission-aware and validated with DTOs (blueprint §20).
- Parent and student APIs use relationship-aware routes (`/me/children`, ...) rather than open
  lookups.

## Phase 1 endpoints

| Method | Path             | Description                                                                     |
| ------ | ---------------- | ------------------------------------------------------------------------------- |
| GET    | `/api/v1/health` | 200 when PostgreSQL and Redis are up, 503 otherwise. Exempt from rate limiting. |

```json
{
  "status": "ok",
  "timestamp": "2026-09-26T13:33:08.050Z",
  "checks": { "application": "up", "database": "up", "redis": "up" }
}
```

## Error format

Every error uses `ApiErrorResponse` from `@acadlyx/types`:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Cannot GET /api/v1/x",
  "requestId": "4c6f4f63-9c3c-460f-9875-54e237aa8bdf",
  "timestamp": "2026-09-26T13:28:51.042Z",
  "path": "/api/v1/x"
}
```

- `message` may be a string array for validation errors. Detailed validation messages are
  turned off in production.
- 5xx responses always say `Internal server error`. Stack traces, SQL and driver details are
  logged but never returned.

## Request correlation

Clients may send `x-request-id` (1–128 characters from `[A-Za-z0-9._-]`). Otherwise the server
generates a UUID. The id is echoed in the response header, the error body and every log line
for that request.

## Rate limiting

A global limit (`RATE_LIMIT_MAX` requests per `RATE_LIMIT_TTL_MS` window) applies. Stricter
per-route limits for login and OTP are added in Phase 3.
