import { type NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse, body, prepare, str } from '@/lib/server/bff';
import { COOKIE, setSessionCookies } from '@/lib/server/session';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = prepare(req);
  if ('rejected' in ctx) return ctx.rejected;
  const mfaToken = req.cookies.get(COOKIE.mfa)?.value;
  if (!mfaToken)
    return NextResponse.json(
      { code: 'MFA_STEP_EXPIRED', message: 'Please sign in again' },
      { status: 401 },
    );
  const b = await body(req);
  const factor = str(b.recoveryCode)
    ? { recoveryCode: str(b.recoveryCode) }
    : { code: str(b.code) };
  try {
    const tokens = await ctx.api.auth('auth').verifyMfa(mfaToken, factor);
    const res = NextResponse.json({ status: 'AUTHENTICATED' });
    setSessionCookies(res, tokens);
    return res;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
