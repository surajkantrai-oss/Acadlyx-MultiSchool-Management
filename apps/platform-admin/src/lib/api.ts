import { createApiClient, CSRF_HEADER } from '@acadlyx/api-client';

/**
 * Browser-side client for client components. It talks only to this app's same-origin BFF
 * (/bff/api), which attaches the session from HttpOnly cookies; tokens never reach JavaScript.
 * Every call carries the CSRF header the BFF requires for mutations.
 */
export const api = createApiClient({
  baseUrl: '/bff/api',
  getHeaders: () => ({ [CSRF_HEADER]: '1' }),
});
