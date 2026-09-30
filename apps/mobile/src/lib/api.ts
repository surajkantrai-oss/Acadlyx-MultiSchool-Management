import { ApiError, createApiClient } from '@acadlyx/api-client';
import { TENANT_KEY_HEADER } from '@acadlyx/tenant-config';
import { env } from '../config/env';

/** In-memory only; never persisted (the refresh token lives in secure storage). */
let accessToken: string | null = null;
/** Set by the session: rotates the access token (single-flight). */
let refreshHandler: (() => Promise<boolean>) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setRefreshHandler(handler: (() => Promise<boolean>) | null): void {
  refreshHandler = handler;
}

const baseFetch = globalThis.fetch.bind(globalThis);

/**
 * One retry after an EXPIRED access token only: the server rejected the request before running
 * it, so repeating it — including a mutation — cannot double-apply. Any other failure (network,
 * 4xx, 5xx) surfaces to the screen; mutations are never queued or silently replayed.
 */
const fetchWithRefresh: typeof fetch = async (input, init) => {
  const first = await baseFetch(input, init);
  if (first.status !== 401 || !refreshHandler || !accessToken) return first;
  const body = (await first
    .clone()
    .json()
    .catch(() => null)) as { code?: string } | null;
  if (body?.code !== 'TOKEN_EXPIRED' || !(await refreshHandler())) return first;
  const headers = new Headers(init?.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return baseFetch(input, { ...init, headers });
};

/** Shared API client: every request names this build's school and carries the session. */
export const api = createApiClient({
  baseUrl: env.apiBaseUrl,
  fetch: fetchWithRefresh,
  getHeaders: (): Record<string, string> => ({
    ...(env.tenantKey ? { [TENANT_KEY_HEADER]: env.tenantKey } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }),
});

export { ApiError };
