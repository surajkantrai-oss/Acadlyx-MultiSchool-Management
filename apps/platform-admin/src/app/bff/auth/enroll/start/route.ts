import { type NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { apiErrorResponse, guardMutation } from '@/lib/server/bff';
import { COOKIE, publicApi } from '@/lib/server/session';

/**
 * Starts mandatory TOTP enrollment for a pending login. The setup secret is shown exactly once
 * (as a QR code rendered server-side plus the manual-entry key); nothing is cached.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rejected = guardMutation(req);
  if (rejected) return rejected;
  const mfaToken = req.cookies.get(COOKIE.mfa)?.value;
  if (!mfaToken)
    return NextResponse.json(
      { code: 'MFA_STEP_EXPIRED', message: 'Please sign in again' },
      { status: 401 },
    );
  try {
    const enrollment = await publicApi().auth('platform/auth').startPendingEnrollment(mfaToken);
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
