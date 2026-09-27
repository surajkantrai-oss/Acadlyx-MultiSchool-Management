import { type NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse, guardMutation } from '@/lib/server/bff';
import { COOKIE, publicApi, setSessionCookies } from '@/lib/server/session';

/** Confirms enrollment with a first valid code; returns the one-time recovery codes. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rejected = guardMutation(req);
  if (rejected) return rejected;
  const mfaToken = req.cookies.get(COOKIE.mfa)?.value;
  if (!mfaToken)
    return NextResponse.json(
      { code: 'MFA_STEP_EXPIRED', message: 'Please sign in again' },
      { status: 401 },
    );
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  try {
    const done = await publicApi()
      .auth('platform/auth')
      .confirmPendingEnrollment(mfaToken, typeof body.code === 'string' ? body.code : '');
    const res = NextResponse.json({ recoveryCodes: done.recoveryCodes });
    if (done.auth) setSessionCookies(res, done.auth);
    return res;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
