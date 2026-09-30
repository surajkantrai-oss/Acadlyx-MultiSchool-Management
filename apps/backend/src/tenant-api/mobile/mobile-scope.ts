import { badRequest, conflict, notFound } from '../../common/errors/domain-errors.js';
import { ForbiddenException } from '@nestjs/common';
import { currentAuth } from '../../auth/core/access.guard.js';
import type { School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { authUserId } from '../operations/ops-scope.js';

/**
 * Phase 8 self-service scope (decision J). Parent and Student hold no school-level read
 * permissions; their routes are authorised by the AUTHENTICATED user's own profile:
 *   Parent  = the caller's active Parent profile → StudentGuardian → Student
 *   Student = the caller's active Student profile → own data only
 * The role must be granted server-side AND the profile must exist; client "active role" values
 * are never consulted. Unrelated ids are 404 (no existence oracle). RLS stays defence in depth.
 */
export const MOBILE_ERRORS = {
  roleRequired: () =>
    new ForbiddenException({
      code: 'MOBILE_ROLE_REQUIRED',
      message: 'This account cannot use this part of the app',
    }),
  studentNotFound: () => notFound('STUDENT_NOT_FOUND', 'Student not found'),
  workNotFound: (kind: string) =>
    notFound(kind === 'homework' ? 'HOMEWORK_NOT_FOUND' : 'ASSIGNMENT_NOT_FOUND', 'Not found'),
  noCurrentClass: () => notFound('NO_CURRENT_CLASS', 'No current class for this student'),
  assignmentClosed: () =>
    conflict('ASSIGNMENT_CLOSED', 'This assignment is closed and no longer accepts work'),
  assignmentArchived: () => conflict('ASSIGNMENT_ARCHIVED', 'This assignment is archived'),
  yearClosed: () => conflict('ACADEMIC_YEAR_CLOSED', 'That academic year is closed'),
  notAllowed: () =>
    new ForbiddenException({
      code: 'SUBMISSION_NOT_ALLOWED',
      message: 'You can no longer submit to this assignment',
    }),
  stale: () =>
    conflict('SUBMISSION_STALE', 'Your submission changed elsewhere. Reload and try again.'),
  invalid: (messages: string[]) => badRequest('SUBMISSION_INVALID', messages),
};

const hasRole = (role: string) => currentAuth().roles.includes(role);

export async function parentProfile(tx: TenantTransaction, school: School) {
  if (!hasRole('PARENT')) return null;
  return tx.parent.findFirst({
    where: { schoolId: school.id, userId: authUserId(), isActive: true },
  });
}

export async function studentProfile(tx: TenantTransaction, school: School) {
  if (!hasRole('STUDENT')) return null;
  return tx.student.findFirst({
    where: { schoolId: school.id, userId: authUserId(), status: 'ACTIVE' },
  });
}

export async function teacherProfile(tx: TenantTransaction, school: School) {
  if (!hasRole('TEACHER')) return null;
  return tx.teacher.findFirst({
    where: { schoolId: school.id, userId: authUserId(), status: 'ACTIVE' },
  });
}

export async function requireParent(tx: TenantTransaction, school: School) {
  const parent = await parentProfile(tx, school);
  if (!parent) throw MOBILE_ERRORS.roleRequired();
  return parent;
}

export async function requireStudent(tx: TenantTransaction, school: School) {
  const student = await studentProfile(tx, school);
  if (!student) throw MOBILE_ERRORS.roleRequired();
  return student;
}

/**
 * The parent's linked child — ONLY through this parent's StudentGuardian row in this school.
 * Anything else (another family's child, another school's, a guessed id) is 404.
 */
export async function requireChild(
  tx: TenantTransaction,
  school: School,
  parentId: string,
  studentId: string,
) {
  const link = await tx.studentGuardian.findFirst({
    where: { parentId, studentId, schoolId: school.id, student: { status: 'ACTIVE' } },
    include: { student: true },
  });
  if (!link) throw MOBILE_ERRORS.studentNotFound();
  return link;
}
