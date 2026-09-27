import 'server-only';
import {
  AUTH_COOKIES,
  authCookieOptions,
  cookieName,
  createApiClient,
  isTrustedMutation,
} from '@acadlyx/api-client';
import type { AuthTokens } from '@acadlyx/types';
import { cookies, headers } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '../config';
import { hostForwardingFetch } from '../server-fetch';

const secure = appConfig.secureCookies;
export const COOKIE = {
  access: cookieName(AUTH_COOKIES.access, secure),
  refresh: cookieName(AUTH_COOKIES.refresh, secure),
  mfa: cookieName(AUTH_COOKIES.mfa, secure),
  device: cookieName(AUTH_COOKIES.device, secure),
  grant: cookieName('acx_grant', secure),
};

/**
 * API client for this request's school: forwards the browser's Host (tenant resolution happens
 * in the API exactly as for a direct request) and, when given, the session's access token.
 */
export function tenantApi(host: string, accessToken?: string) {
  return createApiClient({
    baseUrl: appConfig.apiBaseUrl,
    fetch: hostForwardingFetch,
    getHeaders: () => ({
      host,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    }),
  });
}

export async function requestHost(): Promise<string> {
  return (await headers()).get('host') ?? '';
}

/** The signed-in school user for this request, or null (no/invalid session). */
export async function currentSession() {
  const token = (await cookies()).get(COOKIE.access)?.value;
  if (!token) return null;
  const api = tenantApi(await requestHost(), token);
  const me = await api
    .auth('auth')
    .me()
    .catch(() => null);
  return me ? { me, api } : null;
}

export function setSessionCookies(res: NextResponse, tokens: AuthTokens): void {
  res.cookies.set(
    COOKIE.access,
    tokens.accessToken,
    authCookieOptions(secure, (Date.parse(tokens.accessTokenExpiresAt) - Date.now()) / 1000),
  );
  res.cookies.set(
    COOKIE.refresh,
    tokens.refreshToken,
    authCookieOptions(secure, (Date.parse(tokens.sessionExpiresAt) - Date.now()) / 1000),
  );
  res.cookies.set(COOKIE.mfa, '', authCookieOptions(secure, 0));
}

export function clearSessionCookies(res: NextResponse): void {
  for (const name of [COOKIE.access, COOKIE.refresh, COOKIE.mfa, COOKIE.grant])
    res.cookies.set(name, '', authCookieOptions(secure, 0));
}

export function setShortCookie(
  res: NextResponse,
  name: string,
  value: string,
  expiresAt: string,
): void {
  res.cookies.set(
    name,
    value,
    authCookieOptions(secure, (Date.parse(expiresAt) - Date.now()) / 1000, 'strict'),
  );
}

export function trustedMutation(req: NextRequest): boolean {
  return isTrustedMutation({
    method: req.method,
    origin: req.headers.get('origin'),
    referer: req.headers.get('referer'),
    host: req.headers.get('host'),
    protocol: req.nextUrl.protocol === 'https:' ? 'https' : 'http',
    csrfHeader: req.headers.get('x-acadlyx-csrf'),
  });
}
