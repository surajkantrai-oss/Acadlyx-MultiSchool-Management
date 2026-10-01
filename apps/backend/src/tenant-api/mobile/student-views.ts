import type {
  MobileAttendanceDay,
  MobileClassInfo,
  MobileLesson,
  MobileStudentHome,
  MobileSubmission,
  MobileWorkItem,
  MobileWorkScope,
  SubmissionBlockedReason,
} from '@acadlyx/types';
import type { Paginated } from '@acadlyx/tenant-config';
import { localToday, weekdayOf } from '@acadlyx/validation';
import type { Prisma, School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { attendanceSummaryFor } from '../operations/attendance.service.js';
import {
  fromIsoDate,
  isoDate,
  personName,
  SECTION_OPS_INCLUDE,
  type SectionWithOps,
} from '../operations/ops-scope.js';
import { buildSectionWeek } from '../operations/timetable.service.js';
import { MOBILE_ERRORS } from './mobile-scope.js';

/*
 * Read models for ONE already-authorised student (the caller's own profile, or a parent's
 * verified child). Composes the Phase 7 domain (enrollment roster rule, attendance formula,
 * section timetable) — nothing here re-implements those rules.
 *
 * Recipient rule (decision G): a student receives a homework/assignment when they were enrolled
 * in its Section on its assigned_date (enrollment history: start ≤ assigned < end). Drafts are
 * never visible. Joining a class later does not make earlier work theirs; leaving keeps history.
 */

export type Viewer = 'STUDENT' | 'PARENT';
type Enrollment = Prisma.StudentEnrollmentGetPayload<{
  include: { section: { include: typeof SECTION_OPS_INCLUDE } };
}>;

const WORK_INCLUDE = {
  section: { include: SECTION_OPS_INCLUDE },
  subject: true,
  teacher: true,
} as const;
type WorkRow = Prisma.AssignmentGetPayload<{ include: typeof WORK_INCLUDE }>;

/** Visible statuses: current lists never mix in archived work; past = archived. */
const VISIBLE = {
  homework: { current: ['PUBLISHED'], past: ['ARCHIVED'] },
  assignments: { current: ['PUBLISHED', 'CLOSED'], past: ['ARCHIVED'] },
} as const;

export async function enrollmentsOf(
  tx: TenantTransaction,
  school: School,
  studentId: string,
): Promise<Enrollment[]> {
  return tx.studentEnrollment.findMany({
    where: { studentId, schoolId: school.id },
    include: { section: { include: SECTION_OPS_INCLUDE } },
    orderBy: { startDate: 'desc' },
    take: 50,
  });
}

const covers = (e: { startDate: Date; endDate: Date | null }, date: string) =>
  isoDate(e.startDate) <= date && (e.endDate === null || isoDate(e.endDate) > date);

/** The enrollment covering the branch-local today in the CURRENT academic year (or null). */
export function currentEnrollment(enrollments: Enrollment[]): Enrollment | null {
  return (
    enrollments.find(
      (e) => e.section.academicYear.isCurrent && covers(e, localToday(e.section.branch.timezone)),
    ) ?? null
  );
}

export function classInfo(section: SectionWithOps): MobileClassInfo {
  return {
    sectionId: section.id,
    className: `${section.grade.name} ${section.name}`,
    branchName: section.branch.name,
    timezone: section.branch.timezone,
    academicYearName: section.academicYear.name,
    today: localToday(section.branch.timezone),
  };
}

/** Prisma filter: work of the sections this student was in on each item's assigned date. */
function recipientWhere(enrollments: Enrollment[]) {
  if (enrollments.length === 0) return { id: { in: [] as string[] } };
  return {
    OR: enrollments.map((e) => ({
      sectionId: e.sectionId,
      assignedDate: {
        gte: e.startDate,
        ...(e.endDate ? { lt: e.endDate } : {}),
      },
    })),
  };
}

/** Branch-local calendar date of an instant. */
const localDateOf = (at: Date, timezone: string) => localToday(timezone, at);

export function toSubmission(
  s: {
    id: string;
    textContent: string | null;
    externalUrl: string | null;
    version: number;
    firstSubmittedAt: Date;
    lastSubmittedAt: Date;
  },
  dueDate: Date,
  timezone: string,
): MobileSubmission {
  return {
    id: s.id,
    textContent: s.textContent,
    externalUrl: s.externalUrl,
    version: s.version,
    firstSubmittedAt: s.firstSubmittedAt.toISOString(),
    lastSubmittedAt: s.lastSubmittedAt.toISOString(),
    // Decision D: lateness is fixed by the FIRST submission; later edits never change it.
    late: localDateOf(s.firstSubmittedAt, timezone) > isoDate(dueDate),
  };
}

/**
 * Whether the student may submit now (server clock + branch-local date; decisions E–G):
 * PUBLISHED, year not CLOSED, and CURRENTLY enrolled in the assignment's section.
 */
export function submissionBlock(
  row: { status: string; section: SectionWithOps },
  enrollments: Enrollment[],
  viewer: Viewer,
): SubmissionBlockedReason | null {
  if (viewer === 'PARENT') return 'READ_ONLY';
  if (row.status === 'CLOSED') return 'ASSIGNMENT_CLOSED';
  if (row.status === 'ARCHIVED') return 'ASSIGNMENT_ARCHIVED';
  if (row.section.academicYear.status === 'CLOSED') return 'ACADEMIC_YEAR_CLOSED';
  const today = localToday(row.section.branch.timezone);
  const inClass = enrollments.some((e) => e.sectionId === row.section.id && covers(e, today));
  return inClass ? null : 'NOT_IN_CLASS';
}

type SubmissionRow = Prisma.AssignmentSubmissionGetPayload<object>;

async function submissionsFor(tx: TenantTransaction, studentId: string, assignmentIds: string[]) {
  if (assignmentIds.length === 0) return new Map<string, SubmissionRow>();
  const rows = await tx.assignmentSubmission.findMany({
    where: { studentId, assignmentId: { in: assignmentIds } },
  });
  return new Map<string, SubmissionRow>(rows.map((r) => [r.assignmentId, r]));
}

async function toItems(
  tx: TenantTransaction,
  kind: 'homework' | 'assignments',
  rows: WorkRow[],
  studentId: string,
  enrollments: Enrollment[],
  viewer: Viewer,
): Promise<MobileWorkItem[]> {
  const subs =
    kind === 'assignments'
      ? await submissionsFor(
          tx,
          studentId,
          rows.map((r) => r.id),
        )
      : new Map<string, SubmissionRow>();
  // Phase 9 (decisions P/Q): only a PUBLISHED grade of the LATEST submission version is visible;
  // a draft, or a grade of an older version, never is ("awaiting grading" instead).
  const latestIds = [...subs.values()].map((x) => x.id);
  const grades = latestIds.length
    ? await tx.assignmentSubmissionGrade.findMany({
        where: { submissionId: { in: latestIds }, status: 'PUBLISHED' },
        include: { submissionVersion: { select: { version: true } } },
      })
    : [];
  return rows.map((r) => {
    const tz = r.section.branch.timezone;
    const sub = subs.get(r.id);
    const maxMarks =
      kind === 'assignments'
        ? ((r as { maxMarks?: { toFixed(n: number): string } | null }).maxMarks?.toFixed(2) ?? null)
        : null;
    const g = sub
      ? grades.find((x) => x.submissionId === sub.id && x.submissionVersion.version === sub.version)
      : undefined;
    const blocked = kind === 'assignments' ? submissionBlock(r, enrollments, viewer) : 'READ_ONLY';
    return {
      id: r.id,
      kind,
      title: r.title,
      instructions: r.instructions,
      subjectName: r.subject.name,
      className: `${r.section.grade.name} ${r.section.name}`,
      timezone: tz,
      teacherName: r.teacher ? personName(r.teacher) : null,
      assignedDate: isoDate(r.assignedDate),
      dueDate: isoDate(r.dueDate),
      status: r.status,
      overdue: localToday(tz) > isoDate(r.dueDate),
      submission: sub ? toSubmission(sub, r.dueDate, tz) : null,
      maxMarks,
      grade:
        g && g.publishedAt
          ? {
              submissionVersion: sub?.version ?? 0,
              marksAwarded: g.marksAwarded?.toFixed(2) ?? null,
              maxMarks,
              feedback: g.feedback,
              publishedAt: g.publishedAt.toISOString(),
            }
          : null,
      awaitingGrading: kind === 'assignments' && Boolean(sub) && !g,
      canSubmit: kind === 'assignments' && blocked === null,
      blockedReason: kind === 'assignments' ? blocked : null,
    };
  });
}

// Homework and Assignment share columns; one typed accessor keeps the query code single.
const model = (tx: TenantTransaction, kind: 'homework' | 'assignments') =>
  (kind === 'homework' ? tx.homework : tx.assignment) as unknown as typeof tx.assignment;

export async function workList(
  tx: TenantTransaction,
  school: School,
  studentId: string,
  viewer: Viewer,
  kind: 'homework' | 'assignments',
  scope: MobileWorkScope,
  page: number,
  pageSize: number,
): Promise<Paginated<MobileWorkItem>> {
  const enrollments = await enrollmentsOf(tx, school, studentId);
  const where = {
    schoolId: school.id,
    status: { in: [...VISIBLE[kind][scope]] },
    ...recipientWhere(enrollments),
  } as Prisma.AssignmentWhereInput;
  const [total, rows] = await Promise.all([
    model(tx, kind).count({ where }),
    model(tx, kind).findMany({
      where,
      include: WORK_INCLUDE,
      orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: await toItems(tx, kind, rows, studentId, enrollments, viewer),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** One visible item (non-draft, and this student is a recipient); anything else is 404. */
export async function workItem(
  tx: TenantTransaction,
  school: School,
  studentId: string,
  viewer: Viewer,
  kind: 'homework' | 'assignments',
  id: string,
): Promise<MobileWorkItem> {
  const enrollments = await enrollmentsOf(tx, school, studentId);
  const row = await model(tx, kind).findFirst({
    where: {
      id,
      schoolId: school.id,
      status: { not: 'DRAFT' },
      ...recipientWhere(enrollments),
    },
    include: WORK_INCLUDE,
  });
  if (!row) throw MOBILE_ERRORS.workNotFound(kind);
  const [item] = await toItems(tx, kind, [row], studentId, enrollments, viewer);
  if (!item) throw MOBILE_ERRORS.workNotFound(kind);
  return item;
}

export async function attendanceHistory(
  tx: TenantTransaction,
  school: School,
  studentId: string,
  page: number,
  pageSize: number,
): Promise<Paginated<MobileAttendanceDay>> {
  const where = { studentId, schoolId: school.id };
  const [total, rows] = await Promise.all([
    tx.attendanceRecord.count({ where }),
    tx.attendanceRecord.findMany({
      where,
      include: { session: { include: { section: { include: { grade: true } } } } },
      orderBy: [{ session: { date: 'desc' } }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: rows.map((r) => ({
      date: isoDate(r.session.date),
      className: `${r.session.section.grade.name} ${r.session.section.name}`,
      status: r.status,
      note: r.note,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function attendanceSummary(tx: TenantTransaction, school: School, studentId: string) {
  return attendanceSummaryFor(tx, school, studentId);
}

/** The student's CURRENT class timetable (read-only); 404 when not enrolled anywhere today. */
export async function timetable(tx: TenantTransaction, school: School, studentId: string) {
  const current = currentEnrollment(await enrollmentsOf(tx, school, studentId));
  if (!current) throw MOBILE_ERRORS.noCurrentClass();
  const week = await buildSectionWeek(tx, school, current.section);
  return { ...week, editable: false };
}

export async function home(
  tx: TenantTransaction,
  school: School,
  student: {
    id: string;
    firstName: string;
    middleName: string | null;
    lastName: string | null;
    admissionNumber: string;
  },
  viewer: Viewer,
): Promise<MobileStudentHome> {
  const enrollments = await enrollmentsOf(tx, school, student.id);
  const current = currentEnrollment(enrollments);
  let todayLessons: MobileLesson[] = [];
  if (current) {
    const week = await buildSectionWeek(tx, school, current.section);
    const day = weekdayOf(localToday(current.section.branch.timezone));
    todayLessons = week.entries
      .filter((e) => e.weekday === day)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((e) => ({
        id: e.id,
        periodName: e.periodName,
        startTime: e.startTime,
        endTime: e.endTime,
        subjectName: e.subjectName,
        teacherName: e.teacherName,
        sectionName: e.sectionName,
        branchName: e.branchName,
      }));
  }
  const today = current ? localToday(current.section.branch.timezone) : null;
  const recipients = recipientWhere(enrollments);
  const [summary, homeworkRows, dueRows] = await Promise.all([
    attendanceSummaryFor(tx, school, student.id),
    tx.homework.findMany({
      where: { schoolId: school.id, status: 'PUBLISHED', ...recipients },
      include: WORK_INCLUDE,
      orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
      take: 5,
    }),
    tx.assignment.findMany({
      where: {
        schoolId: school.id,
        status: 'PUBLISHED',
        ...recipients,
        ...(today ? { dueDate: { gte: fromIsoDate(today) } } : {}),
      },
      include: WORK_INCLUDE,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      take: 5,
    }),
  ]);
  return {
    studentId: student.id,
    name: personName(student),
    admissionNumber: student.admissionNumber,
    class: current ? classInfo(current.section) : null,
    todayLessons,
    attendance: summary
      ? {
          counts: summary.counts,
          attendanceRate: summary.attendanceRate,
          academicYearName: summary.academicYearName,
        }
      : null,
    homework: await toItems(
      tx,
      'homework',
      homeworkRows as unknown as WorkRow[],
      student.id,
      enrollments,
      viewer,
    ),
    assignmentsDue: await toItems(tx, 'assignments', dueRows, student.id, enrollments, viewer),
  };
}
