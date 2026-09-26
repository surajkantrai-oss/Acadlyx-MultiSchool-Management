/**
 * Public runtime configuration. EXPO_PUBLIC_* values are inlined into the JS bundle —
 * never place secrets here. The per-school TENANT_KEY build variable (blueprint §4.3)
 * is added with white-label builds in a later phase.
 */
export const env = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1',
} as const;
