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
import { redirect } from 'next/navigation';
import type { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '../config';

const secure = appConfig.secureCookies;
export const COOKIE = {
  access: cookieName(AUTH_COOKIES.access, secure),
  refresh: cookieName(AUTH_COOKIES.refresh, secure),
  mfa: cookieName(AUTH_COOKIES.mfa, secure),
  device: cookieName(AUTH_COOKIES.device, secure),
};

/** Unauthenticated API client (login, refresh, MFA step). */
export function publicApi() {
  return createApiClient({ baseUrl: appConfig.apiBaseUrl });
}

/** API client carrying the caller's access token (server components / route handlers). */
export function apiWithToken(accessToken: string) {
  return createApiClient({
    baseUrl: appConfig.apiBaseUrl,
    getHeaders: () => ({ authorization: `Bearer ${accessToken}` }),
  });
}

/**
 * For protected server components: the signed-in client, or redirect to /login. A 401 from the
 * API (expired/revoked session) also redirects instead of rendering an error.
 */
export async function serverApi() {
  const token = (await cookies()).get(COOKIE.access)?.value;
  if (!token) redirect('/login');
  const guardedFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, { ...init, cache: 'no-store' });
    if (res.status === 401) redirect('/login');
    return res;
  };
  return createApiClient({
    baseUrl: appConfig.apiBaseUrl,
    getHeaders: () => ({ authorization: `Bearer ${token}` }),
    fetch: guardedFetch,
  });
}

export function setSessionCookies(res: NextResponse, tokens: AuthTokens): void {
  const refreshSeconds = (Date.parse(tokens.sessionExpiresAt) - Date.now()) / 1000;
  const accessSeconds = (Date.parse(tokens.accessTokenExpiresAt) - Date.now()) / 1000;
  res.cookies.set(COOKIE.access, tokens.accessToken, authCookieOptions(secure, accessSeconds));
  res.cookies.set(COOKIE.refresh, tokens.refreshToken, authCookieOptions(secure, refreshSeconds));
  res.cookies.delete(COOKIE.mfa);
}

export function clearSessionCookies(res: NextResponse): void {
  for (const name of [COOKIE.access, COOKIE.refresh, COOKIE.mfa]) {
    res.cookies.set(name, '', authCookieOptions(secure, 0));
  }
}

export function setMfaCookie(res: NextResponse, mfaToken: string, expiresAt: string): void {
  res.cookies.set(
    COOKIE.mfa,
    mfaToken,
    authCookieOptions(secure, (Date.parse(expiresAt) - Date.now()) / 1000, 'strict'),
  );
}

/** Same-origin + CSRF-header check for BFF mutations (see api-client web-auth). */
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

export async function currentUserAgent(): Promise<string | null> {
  return (await headers()).get('user-agent');
}
