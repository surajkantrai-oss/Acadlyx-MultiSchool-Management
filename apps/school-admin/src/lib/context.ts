import 'server-only';
import type { AcademicYear, Branch } from '@acadlyx/types';
import { cookies } from 'next/headers';
import { load, type SetupContext } from './setup';

/** Non-sensitive UI preference cookie: ids only, browser-session lifetime (approved decision C). */
export const CONTEXT_COOKIE = 'acx_ctx';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AcademicContext {
  years: AcademicYear[];
  branches: Branch[];
  /** Selected academic year (default: the school's current year; null if none configured). */
  year: AcademicYear | null;
  /** Selected branch (default: all branches — approved decision B). */
  branch: Branch | null;
  /** True when the selector may be shown (the user can read years and branches). */
  selectable: boolean;
  /** Setup gap worth surfacing: no current academic year. */
  noCurrentYear: boolean;
}

export function parseContextCookie(raw: string | undefined): { y?: string; b?: string } {
  if (!raw) return {};
  const [y, b] = raw.split('.');
  return {
    ...(y && UUID.test(y) ? { y } : {}),
    ...(b && (b === 'all' || UUID.test(b)) ? { b } : {}),
  };
}

/**
 * Resolves the working context: URL (`year`, `branch`) first, then the session cookie, then
 * defaults. Every id is checked against THIS school's own lists — unknown/foreign ids are
 * ignored, never forwarded. The backend re-validates again and derives tenant, school and
 * permissions itself; the context only filters.
 */
export async function academicContext(
  ctx: SetupContext,
  sp: { year?: string | undefined; branch?: string | undefined },
): Promise<AcademicContext> {
  const selectable = ctx.can('academic_year.read') && ctx.can('branch.read');
  const [years, branches] = await Promise.all([
    ctx.can('academic_year.read') ? load(() => ctx.academic.academicYears()) : null,
    ctx.can('branch.read') ? load(() => ctx.academic.branches()) : null,
  ]);
  const yearList = years?.ok ? years.data : [];
  const branchList = branches?.ok ? branches.data : [];
  const cookie = parseContextCookie((await cookies()).get(CONTEXT_COOKIE)?.value);
  const wantYear = sp.year ?? cookie.y;
  const wantBranch = sp.branch ?? cookie.b;
  const current = yearList.find((y) => y.isCurrent) ?? null;
  return {
    years: yearList,
    branches: branchList,
    year: yearList.find((y) => y.id === wantYear) ?? current,
    branch:
      wantBranch && wantBranch !== 'all'
        ? (branchList.find((b) => b.id === wantBranch) ?? null)
        : null,
    selectable,
    noCurrentYear: ctx.can('academic_year.read') && !current,
  };
}

/** Query for workspace APIs: only ids that were validated above (and only non-defaults). */
export function contextQuery(c: AcademicContext): { academicYearId?: string; branchId?: string } {
  return {
    ...(c.year ? { academicYearId: c.year.id } : {}),
    ...(c.branch ? { branchId: c.branch.id } : {}),
  };
}
