import type { AccountState } from '@acadlyx/types';
import { currentAuth } from '../../auth/core/access.guard.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * People data scope (Phase 6, approved decision A).
 *
 * Holders of `people.read_all` (Principal, School Admin, Admission Officer, Accountant) read every
 * student/guardian/enrollment/roster of the school. Everyone else who can read people (Teachers)
 * sees only sections they ACTIVELY teach: an open (ended_at IS NULL) assignment on the section,
 * held through their own ACTIVE teacher profile. This is resource-level authorisation — list
 * filters AND direct-id lookups use it (out-of-scope ids are 404, like other tenants' ids).
 *
 * `null` means "no additional restriction".
 */
export function hasSchoolWidePeopleRead(): boolean {
  return currentAuth().permissions.includes('people.read_all');
}

function scopedUserId(): string | null {
  const auth = currentAuth();
  if (auth.permissions.includes('people.read_all')) return null;
  // Tenant sessions only reach these routes; a missing user id must never widen access.
  return auth.scope === 'TENANT' ? auth.userId : '00000000-0000-0000-0000-000000000000';
}

/** Sections the caller may see (null = all sections of the school). */
export function sectionScope(): Prisma.SectionWhereInput | null {
  const userId = scopedUserId();
  if (userId === null) return null;
  return { assignments: { some: { endedAt: null, teacher: { userId, status: 'ACTIVE' } } } };
}

/** Students the caller may see: ACTIVE enrollment in a section they actively teach. */
export function studentScope(): Prisma.StudentWhereInput | null {
  const sections = sectionScope();
  if (sections === null) return null;
  return { enrollments: { some: { status: 'ACTIVE', section: sections } } };
}

/** Parents/guardians the caller may see: guardians of students in scope. */
export function parentScope(): Prisma.ParentWhereInput | null {
  const students = studentScope();
  if (students === null) return null;
  return { children: { some: { student: students } } };
}

/** Combines a base filter with the (optional) scope without discarding either. */
export function withScope<W extends object>(where: W, scope: W | null): W {
  return scope === null ? where : ({ AND: [where, scope] } as W);
}

/** Login-account state filter on a profile's optional `user` relation. */
export function accountFilter(
  state: AccountState | undefined,
): { userId: null } | { user: { status: Exclude<AccountState, 'NONE'> } } | Record<string, never> {
  if (!state) return {};
  if (state === 'NONE') return { userId: null };
  return { user: { status: state } };
}
