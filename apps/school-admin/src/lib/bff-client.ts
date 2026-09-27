import { CSRF_HEADER } from '@acadlyx/api-client';

/** POST/GET/DELETE to this app's same-origin BFF (CSRF header included). Throws with the API message. */
export async function bff<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
    body: init.body === undefined ? null : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string | string[] } & T;
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(' · ') : data.message;
    throw new Error(message ?? 'Request failed');
  }
  return data;
}

/** An API failure with HTTP status and stable error code (never shown raw to users). */
export class BffError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly messages: string[],
  ) {
    super(messages[0] ?? 'Request failed');
    this.name = 'BffError';
  }
}

/**
 * Calls the school API through this app's BFF proxy (`/bff/api/<path>`): HttpOnly session
 * cookie, same-origin + CSRF header. Throws BffError on failure.
 */
export async function bffApi<T = unknown>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/bff/api/${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
    body: init.body === undefined ? null : JSON.stringify(init.body),
    credentials: 'same-origin',
  }).catch(() => null);
  if (!res) throw new BffError(0, 'NETWORK', []);
  const data = (await res.json().catch(() => null)) as
    { code?: string; message?: string | string[] } | T | null;
  if (!res.ok) {
    const body = (data ?? {}) as { code?: string; message?: string | string[] };
    const list = Array.isArray(body.message) ? body.message : body.message ? [body.message] : [];
    throw new BffError(res.status, body.code, list);
  }
  return data as T;
}

/**
 * User-facing text for an API failure. Domain (409/400/404) messages from the API are written to
 * be safe; everything else maps to generic copy — no stack traces, SQL or internal codes.
 */
export function friendlyError(error: unknown): string[] {
  if (!(error instanceof BffError)) return ['Something went wrong. Please try again.'];
  if (error.status === 0)
    return ['Could not reach the server. Check your connection and try again.'];
  if (error.status === 401) return ['Your session has ended. Please sign in again.'];
  if (error.status === 403) return ['You do not have permission to do this.'];
  if (error.status === 429) return ['Too many requests. Please wait a moment and try again.'];
  if (error.status >= 500) return ['Something went wrong on our side. Please try again.'];
  if (error.status === 404 && !error.code) return ['This item no longer exists. Refresh the page.'];
  return error.messages.length > 0 ? error.messages : ['The request could not be completed.'];
}
