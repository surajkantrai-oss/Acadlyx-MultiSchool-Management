import type { OpsSection } from '@acadlyx/types';
import { localToday } from '@acadlyx/validation';
import { currentAuth } from '../../auth/core/access.guard.js';
import type { Prisma, School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { OPS_ERRORS } from './ops-errors.js';

/**
 * Operations data scope (Phase 7). Reuses the approved Phase 6 rule: holders of
 * `people.read_all` (Principal, School Admin) act school-wide; everyone else acts only through
 * their OWN ACTIVE teacher profile's OPEN TeacherAssignments:
 *   - class-level operations (attendance, reading class work/timetables): any open assignment on
 *     the section (class teacher or subject teacher);
 *   - subject-level operations (creating/managing homework & assignments): an open
 *     SUBJECT_TEACHER assignment on exactly that section + subject.
 * Permission (what) and scope (where) must both pass; out-of-scope ids are 404.
 */
export function schoolWide(): boolean {
  return currentAuth().permissions.includes('people.read_all');
}

export function authUserId(): string {
  const auth = currentAuth();
  // Tenant routes only; a missing id can never widen access.
  return auth.scope === 'TENANT' ? auth.userId : '00000000-0000-0000-0000-000000000000';
}

/** Open assignments of the caller's own ACTIVE teacher profile (empty for school-wide users). */
export async function myAssignments(tx: TenantTransaction, school: School) {
  if (schoolWide()) return null;
  const teacher = await tx.teacher.findFirst({
    where: { schoolId: school.id, userId: authUserId(), status: 'ACTIVE' },
    select: { id: true },
  });
  if (!teacher) return { teacherId: null, sections: new Set<string>(), pairs: new Set<string>() };
  const rows = await tx.teacherAssignment.findMany({
    where: { teacherId: teacher.id, schoolId: school.id, endedAt: null },
    select: { sectionId: true, subjectId: true, type: true },
  });
  return {
    teacherId: teacher.id,
    sections: new Set(rows.map((r) => r.sectionId)),
    pairs: new Set(
      rows
        .filter((r) => r.type === 'SUBJECT_TEACHER' && r.subjectId)
        .map((r) => `${r.sectionId}:${r.subjectId ?? ''}`),
    ),
  };
}

export type Scope = Awaited<ReturnType<typeof myAssignments>>;

/** Section filter for list queries (null = whole school). */
export function sectionWhere(scope: Scope): Prisma.SectionWhereInput | null {
  if (scope === null) return null;
  return { id: { in: [...scope.sections] } };
}

export const SECTION_OPS_INCLUDE = { branch: true, academicYear: true, grade: true } as const;
export type SectionWithOps = Prisma.SectionGetPayload<{ include: typeof SECTION_OPS_INCLUDE }>;

/** Loads a section of THIS school that the caller may act on at class level; else 404. */
export async function scopedSection(
  tx: TenantTransaction,
  school: School,
  scope: Scope,
  sectionId: string,
): Promise<SectionWithOps> {
  if (scope !== null && !scope.sections.has(sectionId)) throw OPS_ERRORS.sectionNotFound();
  const section = await tx.section.findFirst({
    where: { id: sectionId, schoolId: school.id },
    include: SECTION_OPS_INCLUDE,
  });
  if (!section) throw OPS_ERRORS.sectionNotFound();
  return section;
}

export function toOpsSection(s: SectionWithOps): OpsSection {
  return {
    sectionId: s.id,
    sectionName: `${s.grade.name} ${s.name}`,
    branchId: s.branchId,
    branchName: s.branch.name,
    academicYearId: s.academicYearId,
    academicYearName: s.academicYear.name,
    academicYearStatus: s.academicYear.status,
    timezone: s.branch.timezone,
  };
}

export const sectionUsable = (s: SectionWithOps) =>
  s.isActive && s.branch.isActive && s.grade.isActive;
export const todayFor = (s: SectionWithOps) => localToday(s.branch.timezone);

/** Calendar-date helpers for @db.Date columns. */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const fromIsoDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
/**
 * @db.Time columns ↔ "HH:MM". The driver adapter may hand back a time either as a Date or as a
 * "HH:MM:SS" string, so reads normalise both and writes always use a fresh 1970-01-01 Date.
 */
export const hhmm = (d: Date | string) =>
  typeof d === 'string' ? d.slice(0, 5) : d.toISOString().slice(11, 16);
export const fromHhmm = (s: string) => new Date(`1970-01-01T${s}:00.000Z`);

export const personName = (p: {
  firstName: string;
  middleName: string | null;
  lastName: string | null;
}) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
