import { AUTH_COOKIES, authCookieOptions, cookieName, jwtExpiresAt } from '@acadlyx/api-client';
import type { AuthTokens } from '@acadlyx/types';
import { type NextRequest, NextResponse } from 'next/server';
import { hostForwardingFetch } from './lib/server-fetch';

const secure = process.env.NODE_ENV === 'production';
const API =
  process.env.ACADLYX_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';
const ACCESS = cookieName(AUTH_COOKIES.access, secure);
const REFRESH = cookieName(AUTH_COOKIES.refresh, secure);

/**
 * Keeps the school session fresh for page requests (Node runtime): when the access token is
 * missing/expiring and a refresh cookie exists, rotate it via the API (Host forwarded so the
 * token can only refresh in ITS school) and pass the new cookies to this render and the browser.
 * Pages decide themselves what to show when unauthenticated (branded login in place), so the
 * Phase 2 404/403 tenant semantics are untouched.
 */
export async function proxy(req: NextRequest): Promise<NextResponse> {
  const access = req.cookies.get(ACCESS)?.value;
  const refresh = req.cookies.get(REFRESH)?.value;
  const expiresAt = jwtExpiresAt(access);
  if (!refresh || (expiresAt !== null && expiresAt - Date.now() > 60_000))
    return NextResponse.next();

  const rotated = await hostForwardingFetch(`${API.replace(/\/+$/, '')}/auth/refresh`, {
    method: 'POST',
    headers: { host: req.headers.get('host') ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
  }).catch(() => null);
  if (!rotated?.ok) {
    const res = NextResponse.next();
    res.cookies.set(ACCESS, '', authCookieOptions(secure, 0));
    res.cookies.set(REFRESH, '', authCookieOptions(secure, 0));
    return res;
  }
  const tokens = (await rotated.json()) as AuthTokens;
  req.cookies.set(ACCESS, tokens.accessToken);
  req.cookies.set(REFRESH, tokens.refreshToken);
  const headers = new Headers(req.headers);
  headers.set('cookie', req.cookies.toString());
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(
    ACCESS,
    tokens.accessToken,
    authCookieOptions(secure, (Date.parse(tokens.accessTokenExpiresAt) - Date.now()) / 1000),
  );
  res.cookies.set(
    REFRESH,
    tokens.refreshToken,
    authCookieOptions(secure, (Date.parse(tokens.sessionExpiresAt) - Date.now()) / 1000),
  );
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|bff/).*)'],
};
