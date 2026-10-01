import type { AssignmentGrading, SaveGradeRequest } from '@acadlyx/types';
import { FEEDBACK_MAX, isMarks } from '@acadlyx/validation';
import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../common/errors/domain-errors.js';
import { Prisma, type School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { AcademicStore } from '../academic/academic-store.js';
import { violates } from '../operations/ops-errors.js';
import { personName, SECTION_OPS_INCLUDE } from '../operations/ops-scope.js';
import { toSubmission } from '../mobile/student-views.js';
import { ASSESSMENT_ERRORS as E } from './assessment-errors.js';
import { assertYearOpen, assessmentScope, authUserId, mayEnterMarks } from './assessment-scope.js';

const D = Prisma.Decimal;

/**
 * Assignment grading (decisions O–R; web only). A grade belongs to ONE immutable submission
 * version (assignment_submission_history row): a resubmission starts ungraded and never inherits
 * an older grade. DRAFT → PUBLISHED; a correction to a published grade stays published and is
 * appended to grade history. Only the Section + Subject teacher (or leadership) may grade.
 * The audit log never contains marks or feedback text.
 */
@Injectable()
export class GradingService {
  constructor(private readonly store: AcademicStore) {}

  grading(assignmentId: string): Promise<AssignmentGrading> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const a = await this.assignment(tx, school, assignmentId);
      const subs = await tx.assignmentSubmission.findMany({
        where: { assignmentId: a.id, schoolId: school.id },
        include: {
          student: true,
          history: { orderBy: { version: 'desc' }, take: 20, include: { grades: true } },
        },
      });
      return {
        assignmentId: a.id,
        title: a.title,
        className: `${a.section.grade.name} ${a.section.name}`,
        subjectName: a.subject.name,
        maxMarks: a.maxMarks?.toFixed(2) ?? null,
        rows: subs
          .map((s) => ({
            studentId: s.studentId,
            name: personName(s.student),
            admissionNumber: s.student.admissionNumber,
            submissionId: s.id,
            latestVersion: s.version,
            late: toSubmission(s, a.dueDate, a.section.branch.timezone).late,
            versions: s.history.map((h) => {
              const g = h.grades[0];
              return {
                version: h.version,
                submittedAt: h.submittedAt.toISOString(),
                textContent: h.textContent,
                externalUrl: h.externalUrl,
                grade: g
                  ? {
                      id: g.id,
                      status: g.status,
                      marksAwarded: g.marksAwarded?.toFixed(2) ?? null,
                      feedback: g.feedback,
                      version: g.version,
                      publishedAt: g.publishedAt?.toISOString() ?? null,
                    }
                  : null,
              };
            }),
          }))
          .sort((x, y) => x.name.localeCompare(y.name)),
      };
    });
  }

  /** Save a draft (or correct a published grade) for one exact submission version. */
  save(
    assignmentId: string,
    submissionId: string,
    version: number,
    body: SaveGradeRequest,
  ): Promise<AssignmentGrading> {
    return this.write(assignmentId, submissionId, version, body.expectedVersion, 'save', body);
  }

  publish(
    assignmentId: string,
    submissionId: string,
    version: number,
    expectedVersion: number,
  ): Promise<AssignmentGrading> {
    return this.write(assignmentId, submissionId, version, expectedVersion, 'publish', null);
  }

  private write(
    assignmentId: string,
    submissionId: string,
    version: number,
    expectedVersion: number,
    mode: 'save' | 'publish',
    body: SaveGradeRequest | null,
  ): Promise<AssignmentGrading> {
    return this.store
      .transact(async (tx, school, events) => {
        const a = await this.assignment(tx, school, assignmentId);
        assertYearOpen(a.section.academicYear);
        const history = await tx.assignmentSubmissionHistory.findFirst({
          where: { submissionId, version, schoolId: school.id, submission: { assignmentId: a.id } },
          include: { submission: true },
        });
        if (!history) throw E.submissionNotFound();
        // History is append-only (no UPDATE grant), so serialise on the parent submission row.
        await tx.$queryRaw`SELECT id FROM assignment_submissions WHERE id = ${history.submissionId}::uuid FOR UPDATE`;
        const existing = await tx.assignmentSubmissionGrade.findUnique({
          where: { submissionHistoryId: history.id },
        });
        if ((existing?.version ?? 0) !== expectedVersion) throw E.staleVersion('This grade');

        let marks: Prisma.Decimal | null = existing?.marksAwarded ?? null;
        let feedback: string | null = existing?.feedback ?? null;
        if (body) {
          if (body.marksAwarded !== undefined) {
            if (body.marksAwarded === null || body.marksAwarded === '') marks = null;
            else {
              if (a.maxMarks === null) throw E.gradeNotAllowed();
              if (!isMarks(body.marksAwarded)) throw E.gradeInvalid();
              marks = new D(body.marksAwarded);
              if (marks.lt(0) || marks.gt(a.maxMarks)) throw E.gradeInvalid();
            }
          }
          if (body.feedback !== undefined) {
            const text = body.feedback?.trim() ?? '';
            if (text.length > FEEDBACK_MAX) throw E.gradeInvalid();
            feedback = text || null;
          }
        } else if (!existing) throw E.gradeEmpty();
        if (marks === null && feedback === null) throw E.gradeEmpty();

        const status =
          mode === 'publish' || existing?.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';
        const now = new Date();
        let row;
        try {
          row = existing
            ? await tx.assignmentSubmissionGrade.update({
                where: { id: existing.id },
                data: {
                  status,
                  marksAwarded: marks,
                  feedback,
                  version: existing.version + 1,
                  gradedByUserId: authUserId(),
                  publishedAt: status === 'PUBLISHED' ? (existing.publishedAt ?? now) : null,
                },
              })
            : await tx.assignmentSubmissionGrade.create({
                data: {
                  tenantId: school.tenantId,
                  schoolId: school.id,
                  submissionHistoryId: history.id,
                  submissionId: history.submissionId,
                  assignmentId: a.id,
                  studentId: history.submission.studentId,
                  status,
                  marksAwarded: marks,
                  feedback,
                  gradedByUserId: authUserId(),
                  publishedAt: status === 'PUBLISHED' ? now : null,
                },
              });
        } catch (error) {
          if (isUniqueViolation(error)) throw E.staleVersion('This grade');
          if (violates(error, 'assignment_submission_grades_within_max')) throw E.gradeInvalid();
          throw error;
        }
        await tx.assignmentSubmissionGradeHistory.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            gradeId: row.id,
            version: row.version,
            status: row.status,
            marksAwarded: row.marksAwarded,
            feedback: row.feedback,
            changedByUserId: authUserId(),
          },
        });
        const action =
          mode === 'publish' && existing?.status !== 'PUBLISHED'
            ? 'ASSIGNMENT_GRADE_PUBLISHED'
            : existing?.status === 'PUBLISHED'
              ? 'ASSIGNMENT_GRADE_CORRECTED'
              : 'ASSIGNMENT_GRADE_DRAFTED';
        events.push({
          action,
          resourceType: 'assignment_grade',
          resourceId: row.id,
          // Ids + version only — never marks or feedback text.
          metadata: { assignmentId: a.id, sectionId: a.sectionId, submissionVersion: version },
        });
        return null;
      })
      .then(() => this.grading(assignmentId));
  }

  private async assignment(tx: TenantTransaction, school: School, id: string) {
    const scope = await assessmentScope(tx, school);
    const a = await tx.assignment.findFirst({
      where: { id, schoolId: school.id, status: { not: 'DRAFT' } },
      include: { section: { include: SECTION_OPS_INCLUDE }, subject: true },
    });
    if (!a || !mayEnterMarks(scope, a.sectionId, a.subjectId)) throw E.submissionNotFound();
    return a;
  }
}
