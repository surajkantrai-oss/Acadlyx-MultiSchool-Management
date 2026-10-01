import type { PermissionKey } from '@acadlyx/permissions';
import { currentAuth } from '../../auth/core/access.guard.js';
import type { Prisma, School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { authUserId, isoDate, myAssignments } from '../operations/ops-scope.js';
import { ASSESSMENT_ERRORS } from './assessment-errors.js';

/*
 * Phase 9 scope. Leadership (people.read_all) acts school-wide. Everyone else only through their
 * OWN active teacher profile's OPEN TeacherAssignments (reused Phase 6/7 rule):
 *   - marks: an open SUBJECT_TEACHER assignment on exactly that Section + Subject;
 *   - class result overview + general remark: an open CLASS_TEACHER assignment on the Section.
 * Permissions (what) and scope (where) must both pass; out-of-scope ids are 404.
 */
export type AssessmentScope = {
  schoolWide: boolean;
  /** "sectionId:subjectId" pairs the teacher may enter marks for. */
  pairs: Set<string>;
  /** Sections where the caller is the class teacher. */
  classSections: Set<string>;
};

export async function assessmentScope(
  tx: TenantTransaction,
  school: School,
): Promise<AssessmentScope> {
  const scope = await myAssignments(tx, school);
  if (scope === null) return { schoolWide: true, pairs: new Set(), classSections: new Set() };
  const classRows = scope.teacherId
    ? await tx.teacherAssignment.findMany({
        where: {
          teacherId: scope.teacherId,
          schoolId: school.id,
          endedAt: null,
          type: 'CLASS_TEACHER',
        },
        select: { sectionId: true },
      })
    : [];
  return {
    schoolWide: false,
    pairs: scope.pairs,
    classSections: new Set(classRows.map((r) => r.sectionId)),
  };
}

export const can = (permission: PermissionKey) => currentAuth().permissions.includes(permission);

export const mayEnterMarks = (s: AssessmentScope, sectionId: string, subjectId: string) =>
  s.schoolWide || s.pairs.has(`${sectionId}:${subjectId}`);

export const maySeeClassResults = (s: AssessmentScope, sectionId: string) =>
  s.schoolWide || s.classSections.has(sectionId);

export function assertYearOpen(year: { status: string }) {
  if (year.status === 'CLOSED') throw ASSESSMENT_ERRORS.yearClosed();
}

export { authUserId };

// ---- Eligibility (decision H) -----------------------------------------------------------------

export type EnrollmentLite = {
  studentId: string;
  sectionId: string;
  startDate: Date;
  endDate: Date | null;
};

/** Enrolled in the section on that school-local date (start ≤ d < end). */
export const enrolledOn = (e: EnrollmentLite, date: string) =>
  isoDate(e.startDate) <= date && (e.endDate === null || isoDate(e.endDate) > date);

export async function enrollmentsFor(
  tx: TenantTransaction,
  school: School,
  sectionIds: string[],
): Promise<EnrollmentLite[]> {
  if (sectionIds.length === 0) return [];
  return tx.studentEnrollment.findMany({
    where: { schoolId: school.id, sectionId: { in: sectionIds } },
    select: { studentId: true, sectionId: true, startDate: true, endDate: true },
  });
}

export const EXAM_DETAIL_INCLUDE = {
  academicYear: true,
  gradeScale: { include: { bands: { orderBy: { displayOrder: 'asc' } } } },
  subjects: {
    include: {
      grade: true,
      subject: true,
      components: {
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        include: { schedules: { include: { branch: true } } },
      },
    },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  },
} as const satisfies Prisma.ExamInclude;
export type ExamWithDetail = Prisma.ExamGetPayload<{ include: typeof EXAM_DETAIL_INCLUDE }>;

export async function loadExam(
  tx: TenantTransaction,
  school: School,
  examId: string,
  lock = false,
): Promise<ExamWithDetail> {
  if (lock) await tx.$queryRaw`SELECT id FROM exams WHERE id = ${examId}::uuid FOR UPDATE`;
  const exam = await tx.exam.findFirst({
    where: { id: examId, schoolId: school.id },
    include: EXAM_DETAIL_INCLUDE,
  });
  if (!exam) throw ASSESSMENT_ERRORS.examNotFound();
  return exam;
}

/**
 * For each component, the students of a section who must sit it: enrolled in that section on
 * the paper date of the section's branch. A component without a schedule for that branch has
 * no eligible students (publication of the exam requires every schedule).
 */
export function eligibilityFor(
  exam: ExamWithDetail,
  examSubjectId: string,
  section: { id: string; branchId: string },
  enrollments: EnrollmentLite[],
): Map<string, Set<string>> {
  const subject = exam.subjects.find((s) => s.id === examSubjectId);
  const out = new Map<string, Set<string>>();
  for (const c of subject?.components ?? []) {
    const schedule = c.schedules.find((s) => s.branchId === section.branchId);
    const students = new Set<string>();
    if (schedule) {
      const date = isoDate(schedule.examDate);
      for (const e of enrollments)
        if (e.sectionId === section.id && enrolledOn(e, date)) students.add(e.studentId);
    }
    out.set(c.id, students);
  }
  return out;
}
