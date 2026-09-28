'use server';

import { cookies } from 'next/headers';
import { appConfig } from '@/lib/config';
import { CONTEXT_COOKIE } from '@/lib/context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Remembers the academic context for this browser session. Only well-formed ids are stored; they
 * are re-validated against the school on every read. Server Actions are same-origin only.
 */
export async function setAcademicContext(yearId: string | null, branchId: string | null) {
  const y = yearId && UUID.test(yearId) ? yearId : '';
  const b = branchId && UUID.test(branchId) ? branchId : 'all';
  (await cookies()).set(CONTEXT_COOKIE, `${y}.${b}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appConfig.secureCookies,
    path: '/',
  });
}
