import { type NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { apiErrorResponse, prepare } from '@/lib/server/bff';
import { COOKIE } from '@/lib/server/session';

/** Mandatory TOTP enrollment for a pending privileged login, or optional enrollment when signed in. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = prepare(req);
  if ('rejected' in ctx) return ctx.rejected;
  const mfaToken = req.cookies.get(COOKIE.mfa)?.value;
  try {
    const auth = ctx.api.auth('auth');
    const enrollment = mfaToken
      ? await auth.startPendingEnrollment(mfaToken)
      : await auth.startTotp();
    const qrSvg = await QRCode.toString(enrollment.otpauthUri, {
      type: 'svg',
      margin: 1,
      width: 200,
    });
    return NextResponse.json({ secret: enrollment.secret, qrSvg });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
