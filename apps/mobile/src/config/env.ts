/**
 * Public runtime configuration. EXPO_PUBLIC_* values are inlined into the JS bundle —
 * never place secrets here.
 *
 * EXPO_PUBLIC_TENANT_KEY is the development stand-in for the per-school build-time TENANT_KEY
 * (blueprint §4.3). It is a PUBLIC identifier sent as X-Acadlyx-Tenant-Key to load public
 * branding/feature configuration only — never authentication. Branded store builds come later.
 */
export const env = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1',
  tenantKey: process.env.EXPO_PUBLIC_TENANT_KEY ?? null,
} as const;
