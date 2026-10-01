import type { Paginated } from '@acadlyx/tenant-config';
import type {
  MobileAttendanceDay,
  MobileChild,
  MobileMe,
  MobileRole,
  MobileStudentHome,
  MobileWorkItem,
  MobileWorkScope,
  PublishedResultSummary,
  ReportCard,
  StudentAttendanceSummary,
  TimetableWeek,
} from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { currentAuth } from '../../auth/core/access.guard.js';
import type { School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { AcademicStore } from '../academic/academic-store.js';
import { authUserId, personName } from '../operations/ops-scope.js';
import {
  parentProfile,
  requireChild,
  requireParent,
  requireStudent,
  studentProfile,
  teacherProfile,
} from './mobile-scope.js';
import * as views from './student-views.js';
import { publishedResultsFor, snapshotCard } from '../assessment/results.service.js';
import { ASSESSMENT_ERRORS } from '../assessment/assessment-errors.js';

const MOBILE_ROLES: readonly MobileRole[] = ['PARENT', 'STUDENT', 'TEACHER'];

/** Which student the request is about, resolved ONLY from the caller's own profile. */
type Subject = { kind: 'STUDENT' } | { kind: 'PARENT'; studentId: string };

/**
 * Phase 8 self-service reads (decision J). Parent and Student routes resolve the student from the
 * authenticated user (own profile / verified StudentGuardian link) and then call the shared
 * student read models. The mobile client never supplies identity or authorisation.
 */
@Injectable()
export class MobileService {
  constructor(private readonly store: AcademicStore) {}

  me(): Promise<MobileMe> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const auth = currentAuth();
      const [user, parent, student, teacher] = await Promise.all([
        tx.user.findFirst({ where: { id: authUserId() }, select: { displayName: true } }),
        parentProfile(tx, school),
        studentProfile(tx, school),
        teacherProfile(tx, school),
      ]);
      const roles: MobileRole[] = [];
      if (teacher) roles.push('TEACHER');
      if (parent) roles.push('PARENT');
      if (student) roles.push('STUDENT');
      return {
        userId: authUserId(),
        displayName: user?.displayName ?? '',
        schoolName: school.name,
        roles,
        otherRoles: auth.roles.filter((r) => !(MOBILE_ROLES as readonly string[]).includes(r)),
        parent: parent ? { parentId: parent.id, name: personName(parent) } : null,
        student: student
          ? {
              studentId: student.id,
              name: personName(student),
              admissionNumber: student.admissionNumber,
            }
          : null,
        teacher: teacher
          ? { teacherId: teacher.id, name: personName(teacher), employeeId: teacher.employeeId }
          : null,
      };
    });
  }

  children(): Promise<MobileChild[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const parent = await requireParent(tx, school);
      const links = await tx.studentGuardian.findMany({
        where: { parentId: parent.id, schoolId: school.id, student: { status: 'ACTIVE' } },
        include: { student: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 20,
      });
      return Promise.all(
        links.map(async (l) => {
          const current = views.currentEnrollment(
            await views.enrollmentsOf(tx, school, l.studentId),
          );
          return {
            studentId: l.studentId,
            name: personName(l.student),
            admissionNumber: l.student.admissionNumber,
            relationship: l.relationship,
            class: current ? views.classInfo(current.section) : null,
          };
        }),
      );
    });
  }

  /** Resolves the subject student under the caller's own profile, then runs `fn`. */
  private withStudent<T>(
    subject: Subject,
    fn: (
      tx: TenantTransaction,
      school: School,
      student: {
        id: string;
        firstName: string;
        middleName: string | null;
        lastName: string | null;
        admissionNumber: string;
      },
      viewer: views.Viewer,
    ) => Promise<T>,
  ): Promise<T> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      if (subject.kind === 'STUDENT') {
        return fn(tx, school, await requireStudent(tx, school), 'STUDENT');
      }
      const parent = await requireParent(tx, school);
      const link = await requireChild(tx, school, parent.id, subject.studentId);
      return fn(tx, school, link.student, 'PARENT');
    });
  }

  home(subject: Subject): Promise<MobileStudentHome> {
    return this.withStudent(subject, (tx, school, s, viewer) => views.home(tx, school, s, viewer));
  }

  attendance(subject: Subject): Promise<StudentAttendanceSummary | null> {
    return this.withStudent(subject, (tx, school, s) => views.attendanceSummary(tx, school, s.id));
  }

  attendanceDays(
    subject: Subject,
    page: number,
    pageSize: number,
  ): Promise<Paginated<MobileAttendanceDay>> {
    return this.withStudent(subject, (tx, school, s) =>
      views.attendanceHistory(tx, school, s.id, page, pageSize),
    );
  }

  work(
    subject: Subject,
    kind: 'homework' | 'assignments',
    scope: MobileWorkScope,
    page: number,
    pageSize: number,
  ): Promise<Paginated<MobileWorkItem>> {
    return this.withStudent(subject, (tx, school, s, viewer) =>
      views.workList(tx, school, s.id, viewer, kind, scope, page, pageSize),
    );
  }

  workItem(subject: Subject, kind: 'homework' | 'assignments', id: string) {
    return this.withStudent(subject, (tx, school, s, viewer) =>
      views.workItem(tx, school, s.id, viewer, kind, id),
    );
  }

  timetable(subject: Subject): Promise<TimetableWeek> {
    return this.withStudent(subject, (tx, school, s) => views.timetable(tx, school, s.id));
  }

  /** Phase 9: the student's CURRENT published results only (never live marks or drafts). */
  results(subject: Subject): Promise<PublishedResultSummary[]> {
    return this.withStudent(subject, (tx, school, s) => publishedResultsFor(tx, school, s.id));
  }

  /** Phase 9: report card = the current publication snapshot; unpublished → 404. */
  reportCard(subject: Subject, examId: string): Promise<ReportCard> {
    return this.withStudent(subject, async (tx, school, s) => {
      const found = await snapshotCard(tx, school, { examId, studentId: s.id });
      if (!found) throw ASSESSMENT_ERRORS.resultNotPublished();
      return found.card;
    });
  }
}
