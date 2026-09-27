import { createApiClient } from '@acadlyx/api-client';
import { env } from '../config/env';

/** In-memory only; never persisted (the refresh token lives in secure storage). */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Shared API client; attaches the bearer access token when signed in. */
export const api = createApiClient({
  baseUrl: env.apiBaseUrl,
  getHeaders: (): Record<string, string> =>
    accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
});
