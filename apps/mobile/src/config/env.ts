/**
 * Public runtime configuration. EXPO_PUBLIC_* values are inlined into the JS bundle — never put
 * secrets here.
 *
 * EXPO_PUBLIC_TENANT_KEY is set at build time from the white-label variant (app.config.ts,
 * ACADLYX_TENANT). It is PUBLIC tenant identification sent as X-Acadlyx-Tenant-Key — never
 * authentication. A release build without it refuses to start (no default school, no picker).
 */
const key = process.env.EXPO_PUBLIC_TENANT_KEY?.trim();

export const env = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000/api/v1',
  tenantKey: key && /^[A-Z][A-Z0-9_]{1,62}$/.test(key) ? key : null,
  release: !__DEV__,
} as const;
