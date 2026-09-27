import type { NextRequest, NextResponse } from 'next/server';
import {
  apiErrorResponse,
  authResultResponse,
  body,
  deviceFor,
  prepare,
  str,
} from '@/lib/server/bff';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = prepare(req);
  if ('rejected' in ctx) return ctx.rejected;
  const b = await body(req);
  const device = deviceFor(req);
  try {
    return authResultResponse(
      await ctx.api.auth('auth').login(str(b.identifier), str(b.secret), device.device),
      device,
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
