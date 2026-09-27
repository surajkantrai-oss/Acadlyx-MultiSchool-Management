import { AUTH_COOKIES, authCookieOptions, cookieName, jwtExpiresAt } from '@acadlyx/api-client';
import type { AuthTokens } from '@acadlyx/types';
import { type NextRequest, NextResponse } from 'next/server';

const secure = process.env.NODE_ENV === 'production';
const API =
  process.env.ACADLYX_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';
const ACCESS = cookieName(AUTH_COOKIES.access, secure);
const REFRESH = cookieName(AUTH_COOKIES.refresh, secure);
const PUBLIC_PATHS = ['/login'];

/**
 * Session upkeep for page requests (Node runtime):
 *   - access token missing/expiring and a refresh cookie exists → rotate via the API, set new
 *     cookies on the response AND on the forwarded request so this render already sees them;
 *   - no usable session on a protected page → redirect to /login.
 */
export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const access = req.cookies.get(ACCESS)?.value;
  const refresh = req.cookies.get(REFRESH)?.value;
  const expiresAt = jwtExpiresAt(access);
  const fresh = expiresAt !== null && expiresAt - Date.now() > 60_000;

  if (!fresh && refresh) {
    const rotated = await fetch(`${API.replace(/\/+$/, '')}/platform/auth/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
      },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: 'no-store',
    }).catch(() => null);
    if (rotated?.ok) {
      const tokens = (await rotated.json()) as AuthTokens;
      const headers = new Headers(req.headers);
      req.cookies.set(ACCESS, tokens.accessToken);
      req.cookies.set(REFRESH, tokens.refreshToken);
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
    if (!isPublic) {
      const res = NextResponse.redirect(new URL('/login', req.url));
      res.cookies.set(ACCESS, '', authCookieOptions(secure, 0));
      res.cookies.set(REFRESH, '', authCookieOptions(secure, 0));
      return res;
    }
  }
  if (!fresh && !refresh && !isPublic) return NextResponse.redirect(new URL('/login', req.url));
  // /login is always reachable: it verifies the real session itself (a locally "fresh" token may
  // belong to a session revoked server-side), which avoids redirect loops.
  return NextResponse.next();
}

export const config = {
  // Pages only: never static assets or the BFF routes (which authenticate themselves).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|bff/).*)'],
};
