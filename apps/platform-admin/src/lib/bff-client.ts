import { CSRF_HEADER } from '@acadlyx/api-client';

/** POST to this app's BFF auth routes (same origin, CSRF header). Throws with the API message. */
export async function bffPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
    body: body === undefined ? null : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string | string[] } & T;
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(' · ') : data.message;
    throw new Error(message ?? 'Request failed');
  }
  return data;
}
