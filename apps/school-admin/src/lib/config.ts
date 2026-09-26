/**
 * Public runtime configuration. NEXT_PUBLIC_* values are inlined at build time.
 */
export const appConfig = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1',
} as const;
