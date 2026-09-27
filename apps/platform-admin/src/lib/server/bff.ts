import 'server-only';
import { ApiError, webDeviceLabel } from '@acadlyx/api-client';
import type { DeviceDescriptor } from '@acadlyx/types';
import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, trustedMutation } from './session';

/** Uniform JSON error from an API failure (keeps the API's safe error body). */
export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(error.body ?? { message: error.message }, { status: error.status });
  }
  return NextResponse.json({ message: 'Service unavailable' }, { status: 502 });
}

export function forbiddenCsrf(): NextResponse {
  return NextResponse.json(
    { code: 'CSRF_REJECTED', message: 'Request origin not allowed' },
    { status: 403 },
  );
}

/** Rejects cross-site mutations before touching the session. */
export function guardMutation(req: NextRequest): NextResponse | null {
  return trustedMutation(req) ? null : forbiddenCsrf();
}

/** Web device descriptor: a random per-browser installation id kept in an HttpOnly cookie. */
export function deviceFor(req: NextRequest): { device: DeviceDescriptor; isNew: boolean } {
  const existing = req.cookies.get(COOKIE.device)?.value;
  const installationId =
    existing && /^[A-Za-z0-9-]{16,64}$/.test(existing) ? existing : crypto.randomUUID();
  return {
    device: {
      installationId,
      platform: 'WEB',
      label: webDeviceLabel(req.headers.get('user-agent')),
    },
    isNew: installationId !== existing,
  };
}
