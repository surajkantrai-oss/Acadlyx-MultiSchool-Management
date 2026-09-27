import { authCookieOptions } from '@acadlyx/api-client';
import { type NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import {
  apiErrorResponse,
  authResultResponse,
  body,
  deviceFor,
  prepare,
  str,
} from '@/lib/server/bff';
import { COOKIE } from '@/lib/server/session';

/** Sets the first/new PIN or password using the grant cookie; activation also signs in. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = prepare(req);
  if ('rejected' in ctx) return ctx.rejected;
  const raw = req.cookies.get(COOKIE.grant)?.value ?? '';
  const [flow, grantToken] = [raw.split(':')[0], raw.slice(raw.indexOf(':') + 1)];
  if (!grantToken || (flow !== 'activation' && flow !== 'recovery')) {
    return NextResponse.json(
      { code: 'GRANT_EXPIRED', message: 'Please verify your code again' },
      { status: 401 },
    );
  }
  const b = await body(req);
  const type = str(b.credentialType) === 'PIN' ? 'PIN' : 'PASSWORD';
  try {
    const auth = ctx.api.auth('auth');
    if (flow === 'recovery') {
      await auth.completeRecovery(grantToken, type, str(b.secret));
      const res = NextResponse.json({ status: 'RESET' });
      res.cookies.set(COOKIE.grant, '', authCookieOptions(appConfig.secureCookies, 0));
      return res;
    }
    const device = deviceFor(req);
    const res = authResultResponse(
      await auth.completeActivation(grantToken, type, str(b.secret), device.device),
      device,
    );
    res.cookies.set(COOKIE.grant, '', authCookieOptions(appConfig.secureCookies, 0));
    return res;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
