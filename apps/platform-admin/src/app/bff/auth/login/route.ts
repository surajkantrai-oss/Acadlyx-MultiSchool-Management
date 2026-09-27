import { type NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse, deviceFor, guardMutation } from '@/lib/server/bff';
import { COOKIE, publicApi, setMfaCookie, setSessionCookies } from '@/lib/server/session';
import { authCookieOptions } from '@acadlyx/api-client';
import { appConfig } from '@/lib/config';

/** Password step. Tokens stay in HttpOnly cookies; the browser only learns the next step. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rejected = guardMutation(req);
  if (rejected) return rejected;
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json({ message: 'Email and password are required' }, { status: 400 });
  }
  const { device, isNew } = deviceFor(req);
  try {
    const result = await publicApi().auth('platform/auth').login(body.email, body.password, device);
    const res = NextResponse.json({ status: result.status });
    if (isNew)
      res.cookies.set(
        COOKIE.device,
        device.installationId,
        authCookieOptions(appConfig.secureCookies, 365 * 86_400),
      );
    if (result.status === 'AUTHENTICATED') setSessionCookies(res, result);
    else setMfaCookie(res, result.mfaToken, result.mfaTokenExpiresAt);
    return res;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
