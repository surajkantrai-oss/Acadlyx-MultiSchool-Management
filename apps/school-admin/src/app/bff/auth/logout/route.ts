import { type NextRequest, NextResponse } from 'next/server';
import { prepare } from '@/lib/server/bff';
import { clearSessionCookies, COOKIE } from '@/lib/server/session';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = prepare(req);
  if ('rejected' in ctx) return ctx.rejected;
  if (req.cookies.get(COOKIE.access)?.value) {
    const auth = ctx.api.auth('auth');
    await (req.nextUrl.searchParams.get('all') === '1' ? auth.logoutAll() : auth.logout()).catch(
      () => undefined,
    );
  }
  const res = NextResponse.json({ status: 'SIGNED_OUT' });
  clearSessionCookies(res);
  return res;
}
