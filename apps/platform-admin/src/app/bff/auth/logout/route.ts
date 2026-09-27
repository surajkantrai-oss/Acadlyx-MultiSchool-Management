import { type NextRequest, NextResponse } from 'next/server';
import { guardMutation } from '@/lib/server/bff';
import { apiWithToken, clearSessionCookies, COOKIE } from '@/lib/server/session';

/** Ends the session server-side (and optionally all sessions), then clears the cookies. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rejected = guardMutation(req);
  if (rejected) return rejected;
  const all = req.nextUrl.searchParams.get('all') === '1';
  const token = req.cookies.get(COOKIE.access)?.value;
  if (token) {
    const auth = apiWithToken(token).auth('platform/auth');
    await (all ? auth.logoutAll() : auth.logout()).catch(() => undefined);
  }
  const res = NextResponse.json({ status: 'SIGNED_OUT' });
  clearSessionCookies(res);
  return res;
}
