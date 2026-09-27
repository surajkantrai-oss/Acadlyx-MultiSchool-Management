import { type NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse, guardMutation } from '@/lib/server/bff';
import { COOKIE, publicApi, setSessionCookies } from '@/lib/server/session';

/** Second factor: TOTP code or one-time recovery code, using the HttpOnly MFA-step cookie. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rejected = guardMutation(req);
  if (rejected) return rejected;
  const mfaToken = req.cookies.get(COOKIE.mfa)?.value;
  if (!mfaToken)
    return NextResponse.json(
      { code: 'MFA_STEP_EXPIRED', message: 'Please sign in again' },
      { status: 401 },
    );
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; recoveryCode?: unknown };
  const factor =
    typeof body.recoveryCode === 'string' && body.recoveryCode.length > 0
      ? { recoveryCode: body.recoveryCode }
      : { code: typeof body.code === 'string' ? body.code : '' };
  try {
    const tokens = await publicApi().auth('platform/auth').verifyMfa(mfaToken, factor);
    const res = NextResponse.json({ status: 'AUTHENTICATED' });
    setSessionCookies(res, tokens);
    return res;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
