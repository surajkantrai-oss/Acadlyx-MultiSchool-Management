import type { Paginated } from '@acadlyx/tenant-config';
import type { MarkSheet, MarkSheetSummary, SaveMarksRequest } from '@acadlyx/types';
import { isMarks, reasonSchema } from '@acadlyx/validation';
import { Injectable } from '@nestjs/common';
import { uuidv7 } from '../../common/ids/uuid.js';
import { Prisma, type School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { AcademicStore } from '../academic/academic-store.js';
import { violates } from '../operations/ops-errors.js';
import { isoDate, personName } from '../operations/ops-scope.js';
import { ASSESSMENT_ERRORS as E } from './assessment-errors.js';
import {
  assertYearOpen,
  assessmentScope,
  authUserId,
  can,
  eligibilityFor,
  enrollmentsFor,
  type ExamWithDetail,
  loadExam,
  mayEnterMarks,
} from './assessment-scope.js';
import { sheetOverview } from './sheets.js';

const D = Prisma.Decimal;
type SheetStatus = 'DRAFT' | 'SUBMITTED' | 'FINALIZED' | 'REOPENED';

/**
 * Mark sheets (Exam + Section + Subject; decision G). Teachers enter/save/submit only for an open
 * SUBJECT_TEACHER assignment on exactly that pair; leadership (marks.finalize) finalizes and may
 * reopen with a 3–500 character reason (decision I). Every mark change is appended to
 * student_exam_mark_history; every workflow step to exam_mark_sheet_events. The sheet row is
 * locked and version-checked, so concurrent edits/finalize/reopen are strictly ordered.
 */
@Injectable()
export class MarksService {
  constructor(private readonly store: AcademicStore) {}

  /** Paginated sheet list (summary rows; completion counts for this page only). */
  sheets(
    examId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<Paginated<MarkSheetSummary>> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const exam = await loadExam(tx, school, examId);
      const scope = await assessmentScope(tx, school);
      if (!scope.schoolWide && exam.status === 'DRAFT') throw E.examNotFound();
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 50;
      const { items, total } = await sheetOverview(tx, school, exam, scope, { page, pageSize });
      if (!scope.schoolWide && total === 0) throw E.examNotFound();
      return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
    });
  }

  sheet(examId: string, examSubjectId: string, sectionId: string): Promise<MarkSheet> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const ctx = await this.context(tx, school, examId, examSubjectId, sectionId);
      return this.view(tx, ctx);
    });
  }

  save(
    examId: string,
    examSubjectId: string,
    sectionId: string,
    body: SaveMarksRequest,
  ): Promise<MarkSheet> {
    return this.store
      .transact(async (tx, school, events) => {
        const ctx = await this.context(tx, school, examId, examSubjectId, sectionId, true);
        this.assertEntryOpen(ctx);
        const existed = ctx.sheet !== null;
        const sheet = await this.ensureSheet(tx, school, ctx);
        // expectedVersion 0 = "no sheet yet". A committed sheet is always ≥ 2 (the creating save
        // bumps it), so version 1 here means THIS transaction just created it.
        const fresh = !existed && sheet.version === 1;
        if (fresh ? body.expectedVersion !== 0 : sheet.version !== body.expectedVersion)
          throw E.staleVersion('This mark sheet');
        if (sheet.status !== 'DRAFT' && sheet.status !== 'REOPENED') throw E.sheetLocked();
        const reason =
          sheet.status === 'REOPENED'
            ? ((
                await tx.examMarkSheetEvent.findFirst({
                  where: { sheetId: sheet.id, toStatus: 'REOPENED' },
                  orderBy: { createdAt: 'desc' },
                })
              )?.reason ?? null)
            : null;
        const components = new Map(ctx.subject.components.map((c) => [c.id, c]));
        const seen = new Set<string>();
        const existing = await tx.studentExamMark.findMany({
          where: {
            componentId: { in: [...components.keys()] },
            studentId: { in: body.entries.map((e) => e.studentId) },
          },
        });
        const byKey = new Map(existing.map((m) => [`${m.componentId}:${m.studentId}`, m]));
        let changed = 0;
        const creates: Prisma.StudentExamMarkCreateManyInput[] = [];
        const updates: {
          prev: (typeof existing)[number];
          status: 'MARKED' | 'ABSENT' | 'EXEMPT';
          value: Prisma.Decimal | null;
        }[] = [];
        const history: Prisma.StudentExamMarkHistoryCreateManyInput[] = [];
        for (const e of body.entries) {
          const key = `${e.componentId}:${e.studentId}`;
          if (seen.has(key)) throw E.invalidMark('A student/component appears twice');
          seen.add(key);
          const component = components.get(e.componentId);
          if (!component) throw E.componentNotFound();
          if (!ctx.eligible.get(component.id)?.has(e.studentId)) throw E.studentNotEligible();
          let value: Prisma.Decimal | null = null;
          if (e.status === 'MARKED') {
            if (!e.marks || !isMarks(e.marks)) throw E.invalidMark();
            value = new D(e.marks);
            if (value.lt(0) || value.gt(component.maxMarks)) throw E.invalidMark();
          } else if (e.marks) throw E.invalidMark('Absent and exempt entries have no marks');
          const prev = byKey.get(key);
          if (
            prev &&
            prev.status === e.status &&
            (prev.marksObtained?.toString() ?? null) === (value?.toString() ?? null)
          )
            continue;
          changed += 1;
          const scope = { tenantId: school.tenantId, schoolId: school.id };
          if (prev) {
            updates.push({ prev, status: e.status, value });
          } else {
            const id = uuidv7();
            creates.push({
              ...scope,
              id,
              sheetId: sheet.id,
              examSubjectId: ctx.subject.id,
              componentId: component.id,
              studentId: e.studentId,
              status: e.status,
              marksObtained: value,
              updatedByUserId: authUserId(),
            });
            history.push({
              ...scope,
              markId: id,
              version: 1,
              fromStatus: null,
              fromMarks: null,
              toStatus: e.status,
              toMarks: value,
              reason,
              changedByUserId: authUserId(),
            });
          }
        }
        // Bounded writes: one INSERT for all new marks, one per changed existing mark (each row
        // gets its own value and version), then one INSERT for the whole history.
        try {
          if (creates.length) await tx.studentExamMark.createMany({ data: creates });
          for (const u of updates) {
            const row = await tx.studentExamMark.update({
              where: { id: u.prev.id },
              data: {
                status: u.status,
                marksObtained: u.value,
                version: u.prev.version + 1,
                updatedByUserId: authUserId(),
              },
              select: { version: true },
            });
            history.push({
              tenantId: school.tenantId,
              schoolId: school.id,
              markId: u.prev.id,
              version: row.version,
              fromStatus: u.prev.status,
              fromMarks: u.prev.marksObtained,
              toStatus: u.status,
              toMarks: u.value,
              reason,
              changedByUserId: authUserId(),
            });
          }
          if (history.length) await tx.studentExamMarkHistory.createMany({ data: history });
        } catch (error) {
          if (
            violates(error, 'student_exam_marks_within_max') ||
            violates(error, 'student_exam_marks_')
          )
            throw E.invalidMark();
          throw error;
        }
        await tx.examMarkSheet.update({
          where: { id: sheet.id },
          data: { version: sheet.version + 1 },
        });
        if (changed > 0)
          events.push({
            action: 'MARKS_SAVED',
            resourceType: 'exam_mark_sheet',
            resourceId: sheet.id,
            // Counts only — never the marks themselves.
            metadata: { examId, sectionId, examSubjectId, changed },
          });
        return ctx;
      })
      .then(() => this.sheet(examId, examSubjectId, sectionId));
  }

  /** Teacher (or leadership) submits a complete sheet: DRAFT/REOPENED → SUBMITTED. */
  submit(examId: string, examSubjectId: string, sectionId: string, expectedVersion: number) {
    return this.step(examId, examSubjectId, sectionId, expectedVersion, 'SUBMITTED', null);
  }

  /** Leadership: SUBMITTED → FINALIZED (marks locked). */
  finalize(examId: string, examSubjectId: string, sectionId: string, expectedVersion: number) {
    return this.step(examId, examSubjectId, sectionId, expectedVersion, 'FINALIZED', null);
  }

  /** Leadership: SUBMITTED/FINALIZED → REOPENED with a mandatory reason (decision I). */
  reopen(
    examId: string,
    examSubjectId: string,
    sectionId: string,
    expectedVersion: number,
    reason: string,
  ) {
    const parsed = reasonSchema.safeParse(reason);
    if (!parsed.success) throw E.invalidMark('A reopen reason of 3–500 characters is required');
    return this.step(examId, examSubjectId, sectionId, expectedVersion, 'REOPENED', parsed.data);
  }

  // ---- internals -------------------------------------------------------------------------------

  private step(
    examId: string,
    examSubjectId: string,
    sectionId: string,
    expectedVersion: number,
    to: SheetStatus,
    reason: string | null,
  ): Promise<MarkSheet> {
    const leadership = to === 'FINALIZED' || to === 'REOPENED';
    return this.store
      .transact(async (tx, school, events) => {
        if (leadership && !can('marks.finalize')) throw E.sheetNotFound();
        const ctx = await this.context(tx, school, examId, examSubjectId, sectionId, true);
        assertYearOpen(ctx.exam.academicYear);
        const sheet = ctx.sheet;
        if (!sheet) throw E.marksIncomplete();
        if (sheet.version !== expectedVersion) throw E.staleVersion('This mark sheet');
        const from = sheet.status;
        const ok =
          (to === 'SUBMITTED' && (from === 'DRAFT' || from === 'REOPENED')) ||
          (to === 'FINALIZED' && from === 'SUBMITTED') ||
          (to === 'REOPENED' && (from === 'SUBMITTED' || from === 'FINALIZED'));
        if (!ok) throw from === 'FINALIZED' ? E.marksFinalized() : E.invalidTransition();
        if (to === 'SUBMITTED' || to === 'FINALIZED') {
          if (ctx.exam.status !== 'MARKS_ENTRY') throw E.marksNotOpen();
          const done = await tx.studentExamMark.findMany({
            where: { sheetId: sheet.id },
            select: { componentId: true, studentId: true },
          });
          const have = new Set(done.map((d) => `${d.componentId}:${d.studentId}`));
          for (const [componentId, students] of ctx.eligible)
            for (const s of students)
              if (!have.has(`${componentId}:${s}`)) throw E.marksIncomplete();
        }
        if (to === 'REOPENED') {
          if (!['MARKS_ENTRY', 'MARKS_FINALIZED', 'RESULTS_PUBLISHED'].includes(ctx.exam.status))
            throw E.invalidTransition();
          // A correction takes the exam back to marks entry; the published version stays visible
          // until a corrected version is published (decision L).
          if (ctx.exam.status !== 'MARKS_ENTRY')
            await tx.exam.update({
              where: { id: ctx.exam.id },
              data: { status: 'MARKS_ENTRY', version: ctx.exam.version + 1 },
            });
        }
        const now = new Date();
        const updated = await tx.examMarkSheet.updateMany({
          where: { id: sheet.id, version: sheet.version, status: from },
          data: {
            status: to,
            version: sheet.version + 1,
            ...(to === 'SUBMITTED' ? { submittedByUserId: authUserId(), submittedAt: now } : {}),
            ...(to === 'FINALIZED' ? { finalizedByUserId: authUserId(), finalizedAt: now } : {}),
          },
        });
        if (updated.count !== 1) throw E.staleVersion('This mark sheet');
        await tx.examMarkSheetEvent.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            sheetId: sheet.id,
            fromStatus: from,
            toStatus: to,
            reason,
            actorUserId: authUserId(),
          },
        });
        const action = {
          SUBMITTED: 'MARK_SHEET_SUBMITTED',
          FINALIZED: 'MARK_SHEET_FINALIZED',
          REOPENED: 'MARK_SHEET_REOPENED',
          DRAFT: '',
        }[to];
        events.push({
          action,
          resourceType: 'exam_mark_sheet',
          resourceId: sheet.id,
          metadata: { examId, sectionId, examSubjectId, subjectName: ctx.subject.subject.name },
        });
        return null;
      })
      .then(() => this.sheet(examId, examSubjectId, sectionId));
  }

  private assertEntryOpen(ctx: SheetCtx) {
    assertYearOpen(ctx.exam.academicYear);
    if (ctx.exam.status !== 'MARKS_ENTRY') throw E.marksNotOpen();
  }

  private async context(
    tx: TenantTransaction,
    school: School,
    examId: string,
    examSubjectId: string,
    sectionId: string,
    lock = false,
  ): Promise<SheetCtx> {
    const exam = await loadExam(tx, school, examId, lock);
    const scope = await assessmentScope(tx, school);
    const subject = exam.subjects.find((s) => s.id === examSubjectId);
    if (!subject) throw E.sheetNotFound();
    if (!mayEnterMarks(scope, sectionId, subject.subjectId)) throw E.subjectNotAssigned();
    if (!scope.schoolWide && exam.status === 'DRAFT') throw E.sheetNotFound();
    const section = await tx.section.findFirst({
      where: {
        id: sectionId,
        schoolId: school.id,
        gradeId: subject.gradeId,
        academicYearId: exam.academicYearId,
      },
      include: { grade: true },
    });
    if (!section) throw E.sheetNotFound();
    if (lock)
      await tx.$queryRaw`SELECT id FROM exam_mark_sheets WHERE exam_subject_id = ${subject.id}::uuid AND section_id = ${section.id}::uuid FOR UPDATE`;
    const sheet = await tx.examMarkSheet.findUnique({
      where: { examSubjectId_sectionId: { examSubjectId: subject.id, sectionId: section.id } },
    });
    const enrollments = await enrollmentsFor(tx, school, [section.id]);
    const eligible = eligibilityFor(exam, subject.id, section, enrollments);
    return { exam, subject, section, sheet, eligible, school, scope };
  }

  private async ensureSheet(tx: TenantTransaction, school: School, ctx: SheetCtx) {
    if (ctx.sheet) return ctx.sheet;
    await tx.$executeRaw`
      INSERT INTO exam_mark_sheets (id, tenant_id, school_id, exam_subject_id, exam_id, grade_id,
        academic_year_id, section_id, status, version, created_at, updated_at)
      VALUES (gen_random_uuid(), ${school.tenantId}::uuid, ${school.id}::uuid, ${ctx.subject.id}::uuid,
        ${ctx.exam.id}::uuid, ${ctx.subject.gradeId}::uuid, ${ctx.exam.academicYearId}::uuid,
        ${ctx.section.id}::uuid, 'DRAFT', 1, now(), now())
      ON CONFLICT (exam_subject_id, section_id) DO NOTHING`;
    await tx.$queryRaw`SELECT id FROM exam_mark_sheets WHERE exam_subject_id = ${ctx.subject.id}::uuid AND section_id = ${ctx.section.id}::uuid FOR UPDATE`;
    const sheet = await tx.examMarkSheet.findUniqueOrThrow({
      where: {
        examSubjectId_sectionId: { examSubjectId: ctx.subject.id, sectionId: ctx.section.id },
      },
    });
    return sheet;
  }

  private async view(tx: TenantTransaction, ctx: SheetCtx): Promise<MarkSheet> {
    const studentIds = [...new Set([...ctx.eligible.values()].flatMap((s) => [...s]))];
    const [students, marks, events] = await Promise.all([
      tx.student.findMany({ where: { id: { in: studentIds } } }),
      ctx.sheet
        ? tx.studentExamMark.findMany({ where: { sheetId: ctx.sheet.id } })
        : Promise.resolve([]),
      ctx.sheet
        ? tx.examMarkSheetEvent.findMany({
            where: { sheetId: ctx.sheet.id },
            orderBy: { createdAt: 'asc' },
            take: 50,
          })
        : Promise.resolve([]),
    ]);
    const actors = await tx.user.findMany({
      where: { id: { in: [...new Set(events.map((e) => e.actorUserId))] } },
      select: { id: true, displayName: true },
    });
    const byKey = new Map(marks.map((m) => [`${m.componentId}:${m.studentId}`, m]));
    const status = ctx.sheet?.status ?? 'NOT_STARTED';
    const entryOpen =
      ctx.exam.status === 'MARKS_ENTRY' && ctx.exam.academicYear.status !== 'CLOSED';
    const leadership = can('marks.finalize') && ctx.exam.academicYear.status !== 'CLOSED';
    return {
      examId: ctx.exam.id,
      examName: ctx.exam.name,
      examStatus: ctx.exam.status,
      examSubjectId: ctx.subject.id,
      subjectName: ctx.subject.subject.name,
      sectionId: ctx.section.id,
      className: `${ctx.section.grade.name} ${ctx.section.name}`,
      status,
      version: ctx.sheet?.version ?? 0,
      components: ctx.subject.components.map((c) => {
        const sc = c.schedules.find((s) => s.branchId === ctx.section.branchId);
        return {
          id: c.id,
          name: c.name,
          maxMarks: c.maxMarks.toFixed(2),
          passMarks: c.passMarks?.toFixed(2) ?? null,
          examDate: sc ? isoDate(sc.examDate) : null,
        };
      }),
      students: students
        .map((s) => ({
          studentId: s.id,
          name: personName(s),
          admissionNumber: s.admissionNumber,
          entries: ctx.subject.components.map((c) => {
            const m = byKey.get(`${c.id}:${s.id}`);
            return {
              componentId: c.id,
              status: m?.status ?? null,
              marks: m?.marksObtained?.toFixed(2) ?? null,
              version: m?.version ?? 0,
              eligible: ctx.eligible.get(c.id)?.has(s.id) ?? false,
            };
          }),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      can: {
        edit:
          entryOpen && (status === 'NOT_STARTED' || status === 'DRAFT' || status === 'REOPENED'),
        submit: entryOpen && (status === 'DRAFT' || status === 'REOPENED'),
        finalize: entryOpen && leadership && status === 'SUBMITTED',
        reopen:
          leadership &&
          (status === 'SUBMITTED' || status === 'FINALIZED') &&
          ['MARKS_ENTRY', 'MARKS_FINALIZED', 'RESULTS_PUBLISHED'].includes(ctx.exam.status),
      },
      events: events.map((e) => ({
        at: e.createdAt.toISOString(),
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        reason: e.reason,
        actorName: actors.find((a) => a.id === e.actorUserId)?.displayName ?? null,
      })),
    };
  }
}

interface SheetCtx {
  exam: ExamWithDetail;
  subject: ExamWithDetail['subjects'][number];
  section: Prisma.SectionGetPayload<{ include: { grade: true } }>;
  sheet: Prisma.ExamMarkSheetGetPayload<object> | null;
  eligible: Map<string, Set<string>>;
  school: School;
  scope: Awaited<ReturnType<typeof assessmentScope>>;
}
