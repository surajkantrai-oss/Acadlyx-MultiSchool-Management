import { type NextRequest, NextResponse } from 'next/server';
import { forbiddenCsrf } from '@/lib/server/bff';
import { COOKIE, trustedMutation } from '@/lib/server/session';
import { appConfig } from '@/lib/config';

/**
 * Authenticated API proxy for client components: /bff/api/<path> → API /api/v1/<path> with the
 * session's bearer token. Only platform/* paths are reachable; mutations require same-origin +
 * CSRF header. The browser never sees a token.
 */
/** Self-service auth endpoints reachable through the proxy (login/refresh/MFA-step/logout use dedicated cookie-managing routes). */
const SELF_SERVICE = new Set(['me', 'sessions', 'devices', 'credentials', 'mfa']);
const BLOCKED_MFA = new Set(['verify', 'enroll']);

function allowedPath(path: string[]): boolean {
  if (path[0] !== 'platform' || path.some((p) => p === '..' || p === '.' || p === '')) return false;
  if (path[1] !== 'auth') return true;
  const section = path[2] ?? '';
  return SELF_SERVICE.has(section) && !(section === 'mfa' && BLOCKED_MFA.has(path[3] ?? ''));
}

async function forward(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (!trustedMutation(req)) return forbiddenCsrf();
  const { path } = await ctx.params;
  if (!allowedPath(path)) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  const token = req.cookies.get(COOKIE.access)?.value;
  if (!token)
    return NextResponse.json(
      { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      { status: 401 },
    );
  const target = `${appConfig.apiBaseUrl.replace(/\/+$/, '')}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const upstream = await fetch(target, {
    method: req.method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
      'user-agent': req.headers.get('user-agent') ?? '',
    },
    body: hasBody ? await req.text() : null,
    cache: 'no-store',
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: 'Service unavailable' }, { status: 502 });
  const text = await upstream.text();
  return new NextResponse(text.length > 0 ? text : null, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
