import 'server-only';

/**
 * Server-side configuration. The browser never calls the API directly (BFF pattern): only the
 * Next.js server does, so the API URL is not a NEXT_PUBLIC_ value.
 */
export const appConfig = {
  apiBaseUrl:
    process.env.ACADLYX_API_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    'http://localhost:4000/api/v1',
  secureCookies: process.env.NODE_ENV === 'production',
} as const;
