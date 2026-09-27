import { type NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse, body, prepare, str } from '@/lib/server/bff';
import { COOKIE, setShortCookie } from '@/lib/server/session';

/** Verifies an activation/recovery code; the single-use grant is kept in an HttpOnly cookie. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = prepare(req);
  if ('rejected' in ctx) return ctx.rejected;
  const b = await body(req);
  const flow = str(b.flow) === 'recovery' ? 'recovery' : 'activation';
  try {
    const auth = ctx.api.auth('auth');
    const grant =
      flow === 'recovery'
        ? await auth.verifyRecovery(str(b.identifier), str(b.code))
        : await auth.verifyActivation(str(b.identifier), str(b.code));
    const res = NextResponse.json({ status: 'VERIFIED' });
    setShortCookie(res, COOKIE.grant, `${flow}:${grant.grantToken}`, grant.grantExpiresAt);
    return res;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
