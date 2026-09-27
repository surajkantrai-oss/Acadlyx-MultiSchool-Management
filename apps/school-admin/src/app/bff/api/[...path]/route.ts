import { type NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { hostForwardingFetch } from '@/lib/server-fetch';
import { COOKIE, trustedMutation } from '@/lib/server/session';

/**
 * School-scoped API proxy for client components. Forwards the browser's Host (tenant resolution)
 * and the session bearer token. Only self-service auth, public OTP-start and the Phase 4 school
 * setup endpoints are reachable; token-producing steps use dedicated cookie-managing routes.
 */
const ALLOWED: RegExp[] = [
  /^auth\/(me|sessions(\/[\w-]+)?|devices(\/[\w-]+)?|credentials\/change|identifiers\/change\/(start|verify)|mfa\/totp\/remove|mfa\/recovery-codes\/regenerate)$/,
  /^auth\/(activation|recovery)\/start$/,
  /^tenant\/(workspace|settings)$/,
  // Phase 4 — school & academic configuration (permissions enforced by the API).
  /^school(\/(setup-status|academic-settings))?$/,
  /^(branches|academic-years|grades|sections|subjects)(\/[\w-]+){0,3}$/,
];

async function forward(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (!trustedMutation(req))
    return NextResponse.json(
      { code: 'CSRF_REJECTED', message: 'Request origin not allowed' },
      { status: 403 },
    );
  const joined = (await ctx.params).path.join('/');
  if (!ALLOWED.some((re) => re.test(joined)))
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  const token = req.cookies.get(COOKIE.access)?.value;
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const upstream = await hostForwardingFetch(
    `${appConfig.apiBaseUrl.replace(/\/+$/, '')}/${joined}${req.nextUrl.search}`,
    {
      method: req.method,
      headers: {
        host: req.headers.get('host') ?? '',
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        'user-agent': req.headers.get('user-agent') ?? '',
      },
      ...(hasBody ? { body: await req.text() } : {}),
    },
  ).catch(() => null);
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
