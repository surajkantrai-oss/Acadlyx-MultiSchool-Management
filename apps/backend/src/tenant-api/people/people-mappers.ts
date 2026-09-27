import type { Paginated } from '@acadlyx/tenant-config';
import type {
  Enrollment,
  Placement,
  ProfileAccount,
  TeacherAssignment as TeacherAssignmentDto,
} from '@acadlyx/types';
import { badRequest } from '../../common/errors/domain-errors.js';
import { normalizeEmail, normalizePhone } from '../../auth/core/identifiers.js';
import type {
  AcademicYear,
  Branch,
  Grade,
  Section,
  StudentEnrollment,
  Subject,
  TeacherAssignment,
} from '../../generated/prisma/client.js';
import { isoDate } from '../academic/academic-store.js';

/** Section with the context needed to describe a placement. */
export const SECTION_CONTEXT = {
  include: { grade: true, branch: true, academicYear: true },
} as const;

export type SectionWithContext = Section & {
  grade: Grade;
  branch: Branch;
  academicYear: AcademicYear;
};

export const ACCOUNT_SELECT = { select: { id: true, status: true } } as const;

export function toAccount(
  user: { id: string; status: ProfileAccount['status'] } | null | undefined,
): ProfileAccount | null {
  return user ? { userId: user.id, status: user.status } : null;
}

export function toPlacement(e: StudentEnrollment & { section: SectionWithContext }): Placement {
  return {
    enrollmentId: e.id,
    sectionId: e.sectionId,
    sectionName: e.section.name,
    gradeId: e.section.gradeId,
    gradeName: e.section.grade.name,
    branchId: e.section.branchId,
    branchName: e.section.branch.name,
    academicYearId: e.academicYearId,
    academicYearName: e.section.academicYear.name,
  };
}

export function toEnrollment(e: StudentEnrollment & { section: SectionWithContext }): Enrollment {
  return {
    ...toPlacement(e),
    status: e.status,
    startDate: isoDate(e.startDate),
    endDate: e.endDate ? isoDate(e.endDate) : null,
  };
}

/** The ACTIVE enrollment in the current year, else the most recent ACTIVE one. */
export function currentPlacement(
  enrollments: (StudentEnrollment & { section: SectionWithContext })[],
): Placement | null {
  const active = enrollments.filter((e) => e.status === 'ACTIVE');
  const pick =
    active.find((e) => e.section.academicYear.isCurrent) ??
    [...active].sort(
      (a, b) => +b.section.academicYear.startDate - +a.section.academicYear.startDate,
    )[0];
  return pick ? toPlacement(pick) : null;
}

export function toAssignment(
  a: TeacherAssignment & { section: SectionWithContext; subject: Subject | null },
): TeacherAssignmentDto {
  return {
    id: a.id,
    teacherId: a.teacherId,
    type: a.type,
    sectionId: a.sectionId,
    sectionName: a.section.name,
    gradeName: a.section.grade.name,
    branchName: a.section.branch.name,
    academicYearName: a.section.academicYear.name,
    subjectId: a.subjectId,
    subjectName: a.subject?.name ?? null,
    startedAt: a.startedAt.toISOString(),
    endedAt: a.endedAt?.toISOString() ?? null,
  };
}

export function paging(query: { page?: number; pageSize?: number }) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): Paginated<T> {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Contact values normalised with the Phase 3 identifier rules (email lower-case, phone E.164).
 * `undefined` = unchanged, `null` = clear. Invalid values → 400 (never stored raw).
 */
export function normalizeContact(input: { email?: string | null; phone?: string | null }): {
  email?: string | null;
  phone?: string | null;
} {
  const out: { email?: string | null; phone?: string | null } = {};
  if (input.email !== undefined) {
    out.email = input.email === null ? null : normalizeEmail(input.email);
    if (input.email !== null && out.email === null)
      throw badRequest('INVALID_EMAIL', 'email is not a valid email address');
  }
  if (input.phone !== undefined) {
    out.phone = input.phone === null ? null : normalizePhone(input.phone);
    if (input.phone !== null && out.phone === null)
      throw badRequest(
        'INVALID_PHONE',
        'phone must be a valid mobile number (E.164 or 10-digit Indian)',
      );
  }
  return out;
}

/** Case-insensitive name search across the name columns. */
export function nameSearch(q: string) {
  return [
    { firstName: { contains: q, mode: 'insensitive' as const } },
    { middleName: { contains: q, mode: 'insensitive' as const } },
    { lastName: { contains: q, mode: 'insensitive' as const } },
  ];
}

/** "Asha Rao" → also match first+last across columns. */
export function fullNameSearch(q: string) {
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [];
  const [first, ...rest] = parts;
  return [
    {
      AND: [
        { firstName: { contains: first ?? '', mode: 'insensitive' as const } },
        { lastName: { contains: rest.join(' '), mode: 'insensitive' as const } },
      ],
    },
  ];
}
