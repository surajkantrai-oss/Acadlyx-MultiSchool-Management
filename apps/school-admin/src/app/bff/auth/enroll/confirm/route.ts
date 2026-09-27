import { type NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse, body, prepare, str } from '@/lib/server/bff';
import { COOKIE, setSessionCookies } from '@/lib/server/session';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = prepare(req);
  if ('rejected' in ctx) return ctx.rejected;
  const mfaToken = req.cookies.get(COOKIE.mfa)?.value;
  const code = str((await body(req)).code);
  try {
    const auth = ctx.api.auth('auth');
    const done = mfaToken
      ? await auth.confirmPendingEnrollment(mfaToken, code)
      : await auth.confirmTotp(code);
    const res = NextResponse.json({ recoveryCodes: done.recoveryCodes });
    if (done.auth) setSessionCookies(res, done.auth);
    return res;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
