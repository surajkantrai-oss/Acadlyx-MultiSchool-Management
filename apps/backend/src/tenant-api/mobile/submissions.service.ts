import type {
  AssignmentSubmissionList,
  MobileWorkItem,
  SubmitAssignmentRequest,
} from '@acadlyx/types';
import { submissionSchema } from '@acadlyx/validation';
import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../common/errors/domain-errors.js';
import { AcademicStore } from '../academic/academic-store.js';
import { OPS_ERRORS } from '../operations/ops-errors.js';
import {
  authUserId,
  fromIsoDate,
  isoDate,
  myAssignments,
  personName,
  SECTION_OPS_INCLUDE,
} from '../operations/ops-scope.js';
import { MOBILE_ERRORS, requireStudent } from './mobile-scope.js';
import { enrollmentsOf, submissionBlock, toSubmission, workItem } from './student-views.js';

/**
 * Assignment submissions (Phase 8, decisions C–L).
 *  - Only the Student owns/creates a submission; identity comes from the session, never the body.
 *  - Allowed while the assignment is PUBLISHED and the student is a recipient (enrolled on the
 *    assigned date) AND currently enrolled in its section; after the due date it is accepted and
 *    derived as late. CLOSED/ARCHIVED (or a CLOSED year) are read-only — server state decides.
 *  - One current row per assignment + student (unique index). Optimistic `expectedVersion`
 *    (0 = first submission) makes double taps and races deterministic: exactly one wins, the
 *    other gets 409 SUBMISSION_STALE. Every accepted version is appended to history in the
 *    same transaction; the AuditLog records the event without any content.
 *  - The assignment row is share-locked for the transaction, so a concurrent CLOSE is ordered
 *    strictly before or after the submission — never interleaved.
 */
@Injectable()
export class SubmissionsService {
  constructor(private readonly store: AcademicStore) {}

  submit(assignmentId: string, body: SubmitAssignmentRequest): Promise<MobileWorkItem> {
    const parsed = submissionSchema.safeParse({ text: body.text, url: body.url });
    if (!parsed.success) throw MOBILE_ERRORS.invalid(parsed.error.issues.map((i) => i.message));
    const content = { textContent: parsed.data.text, externalUrl: parsed.data.url };

    return this.store
      .transact(async (tx, school, events) => {
        const student = await requireStudent(tx, school);
        await tx.$queryRaw`SELECT id FROM assignments WHERE id = ${assignmentId}::uuid FOR SHARE`;
        // Visibility (non-draft + recipient) first — anything else is an indistinguishable 404.
        await workItem(tx, school, student.id, 'STUDENT', 'assignments', assignmentId);
        const assignment = await tx.assignment.findFirstOrThrow({
          where: { id: assignmentId, schoolId: school.id },
          include: { section: { include: SECTION_OPS_INCLUDE } },
        });
        const blocked = submissionBlock(
          assignment,
          await enrollmentsOf(tx, school, student.id),
          'STUDENT',
        );
        if (blocked === 'ASSIGNMENT_CLOSED') throw MOBILE_ERRORS.assignmentClosed();
        if (blocked === 'ASSIGNMENT_ARCHIVED') throw MOBILE_ERRORS.assignmentArchived();
        if (blocked === 'ACADEMIC_YEAR_CLOSED') throw MOBILE_ERRORS.yearClosed();
        if (blocked !== null) throw MOBILE_ERRORS.notAllowed();

        const now = new Date();
        const existing = await tx.assignmentSubmission.findUnique({
          where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
        });
        let submissionId: string;
        let version: number;
        if (!existing) {
          if (body.expectedVersion !== 0) throw MOBILE_ERRORS.stale();
          try {
            const row = await tx.assignmentSubmission.create({
              data: {
                tenantId: school.tenantId,
                schoolId: school.id,
                assignmentId,
                studentId: student.id,
                ...content,
                version: 1,
                firstSubmittedAt: now,
                lastSubmittedAt: now,
              },
            });
            submissionId = row.id;
            version = 1;
          } catch (error) {
            if (isUniqueViolation(error)) throw MOBILE_ERRORS.stale();
            throw error;
          }
        } else {
          if (body.expectedVersion !== existing.version) throw MOBILE_ERRORS.stale();
          const updated = await tx.assignmentSubmission.updateMany({
            where: { id: existing.id, version: existing.version },
            data: { ...content, version: existing.version + 1, lastSubmittedAt: now },
          });
          if (updated.count !== 1) throw MOBILE_ERRORS.stale();
          submissionId = existing.id;
          version = existing.version + 1;
        }
        await tx.assignmentSubmissionHistory.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            submissionId,
            version,
            ...content,
            submittedAt: now,
            submittedByUserId: authUserId(),
          },
        });
        events.push({
          action: version === 1 ? 'ASSIGNMENT_SUBMITTED' : 'ASSIGNMENT_RESUBMITTED',
          resourceType: 'assignment_submission',
          resourceId: submissionId,
          // Never the submitted text or link.
          metadata: { assignmentId, sectionId: assignment.sectionId, version },
        });
        return student.id;
      })
      .then((studentId) =>
        this.store.run(async (tx) =>
          workItem(
            tx,
            await this.store.school(tx),
            studentId,
            'STUDENT',
            'assignments',
            assignmentId,
          ),
        ),
      );
  }

  /**
   * Read-only submission list for staff who may MANAGE the assignment (school-wide leadership,
   * or the teacher holding the exact Section + Subject pair). No grading/feedback (Phase 9).
   */
  list(assignmentId: string): Promise<AssignmentSubmissionList> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const scope = await myAssignments(tx, school);
      const a = await tx.assignment.findFirst({
        where: { id: assignmentId, schoolId: school.id, status: { not: 'DRAFT' } },
        include: { section: { include: SECTION_OPS_INCLUDE }, subject: true },
      });
      if (!a || (scope !== null && !scope.pairs.has(`${a.sectionId}:${a.subjectId}`)))
        throw OPS_ERRORS.classworkNotFound('assignments');
      const assigned = isoDate(a.assignedDate);
      const [recipients, submissions] = await Promise.all([
        tx.studentEnrollment.findMany({
          where: {
            sectionId: a.sectionId,
            schoolId: school.id,
            startDate: { lte: fromIsoDate(assigned) },
            OR: [{ endDate: null }, { endDate: { gt: fromIsoDate(assigned) } }],
          },
          include: { student: true },
        }),
        tx.assignmentSubmission.findMany({
          where: { assignmentId: a.id },
          include: { student: true },
        }),
      ]);
      const byStudent = new Map(submissions.map((s) => [s.studentId, s]));
      const people = new Map(recipients.map((r) => [r.studentId, r.student]));
      for (const s of submissions) people.set(s.studentId, s.student);
      const rows = [...people.values()]
        .map((p) => {
          const sub = byStudent.get(p.id);
          return {
            studentId: p.id,
            name: personName(p),
            admissionNumber: p.admissionNumber,
            submission: sub ? toSubmission(sub, a.dueDate, a.section.branch.timezone) : null,
          };
        })
        .sort((x, y) => x.name.localeCompare(y.name));
      return {
        assignmentId: a.id,
        title: a.title,
        className: `${a.section.grade.name} ${a.section.name}`,
        subjectName: a.subject.name,
        dueDate: isoDate(a.dueDate),
        timezone: a.section.branch.timezone,
        status: a.status,
        submittedCount: submissions.length,
        recipientCount: people.size,
        rows,
      };
    });
  }
}
