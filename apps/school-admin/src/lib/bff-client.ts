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
