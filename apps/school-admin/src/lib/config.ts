/**
 * Server-side configuration (BFF): only the Next.js server calls the API.
 */
export const appConfig = {
  apiBaseUrl:
    process.env.ACADLYX_API_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    'http://localhost:4000/api/v1',
  secureCookies: process.env.NODE_ENV === 'production',
} as const;
