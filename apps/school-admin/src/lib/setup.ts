import 'server-only';
import { ApiError } from '@acadlyx/api-client';
import type { PermissionKey } from '@acadlyx/permissions';
import type { TenantBootstrap } from '@acadlyx/tenant-config';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { requireSchool } from './school-page';
import { currentSession } from './server/session';

/**
 * Per-request context for School Setup pages: tenant resolution FIRST (Phase 2 404/403
 * semantics), then the signed-in session (none → branded sign-in at /), then permissions.
 * Deduplicated per request so the layout and page share one /me lookup.
 */
export const setupContext = cache(async () => {
  const tenant = await requireSchool();
  if ('problem' in tenant) return { ok: false, problem: tenant } as const;
  const session = await currentSession();
  if (!session) redirect('/');
  const permissions = new Set(session.me.permissions);
  return {
    ok: true,
    tenant: tenant as TenantBootstrap,
    me: session.me,
    academic: session.api.academic,
    people: session.api.people,
    admin: session.api.admin,
    can: (permission: PermissionKey) => permissions.has(permission),
  } as const;
});

export type SetupContext = Extract<Awaited<ReturnType<typeof setupContext>>, { ok: true }>;

/** Loads server data and turns API failures into a status for an error state (never raw text). */
export async function load<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, status: error instanceof ApiError ? error.status : 500 };
  }
}
