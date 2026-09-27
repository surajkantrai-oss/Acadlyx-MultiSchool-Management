import 'server-only';
import { ApiError, authCookieOptions, webDeviceLabel } from '@acadlyx/api-client';
import type { AuthResult, DeviceDescriptor } from '@acadlyx/types';
import { type NextRequest, NextResponse } from 'next/server';
import { appConfig } from '../config';
import { COOKIE, setSessionCookies, setShortCookie, tenantApi, trustedMutation } from './session';

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError)
    return NextResponse.json(error.body ?? { message: error.message }, { status: error.status });
  return NextResponse.json({ message: 'Service unavailable' }, { status: 502 });
}

/** CSRF/origin gate + the school API client for this request (Host forwarded). */
export function prepare(
  req: NextRequest,
): { rejected: NextResponse } | { api: ReturnType<typeof tenantApi> } {
  if (!trustedMutation(req))
    return {
      rejected: NextResponse.json(
        { code: 'CSRF_REJECTED', message: 'Request origin not allowed' },
        { status: 403 },
      ),
    };
  return { api: tenantApi(req.headers.get('host') ?? '', req.cookies.get(COOKIE.access)?.value) };
}

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

/** Turns an AuthResult into cookies; the browser only learns the next step. */
export function authResultResponse(
  result: AuthResult,
  device?: { device: DeviceDescriptor; isNew: boolean },
): NextResponse {
  const res = NextResponse.json({ status: result.status });
  if (device?.isNew)
    res.cookies.set(
      COOKIE.device,
      device.device.installationId,
      authCookieOptions(appConfig.secureCookies, 365 * 86_400),
    );
  if (result.status === 'AUTHENTICATED') setSessionCookies(res, result);
  else setShortCookie(res, COOKIE.mfa, result.mfaToken, result.mfaTokenExpiresAt);
  return res;
}

export async function body(req: NextRequest): Promise<Record<string, unknown>> {
  return (await req.json().catch(() => ({}))) as Record<string, unknown>;
}

export const str = (value: unknown): string => (typeof value === 'string' ? value : '');
