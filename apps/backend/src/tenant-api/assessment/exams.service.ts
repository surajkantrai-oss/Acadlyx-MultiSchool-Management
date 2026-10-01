import type {
  CreateExamRequest,
  ExamDetail,
  ExamSummary,
  ExamTransition,
  GradeBandInput,
  GradeScale,
  UpdateExamRequest,
} from '@acadlyx/types';
import type { Paginated } from '@acadlyx/tenant-config';
import { Injectable } from '@nestjs/common';
import type { AuditEvent } from '../../common/audit/audit.service.js';
import { isUniqueViolation } from '../../common/errors/domain-errors.js';
import { Prisma, type School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { AcademicStore } from '../academic/academic-store.js';
import { violates } from '../operations/ops-errors.js';
import { fromIsoDate, hhmm, isoDate } from '../operations/ops-scope.js';
import { ASSESSMENT_ERRORS as E } from './assessment-errors.js';
import {
  assertYearOpen,
  assessmentScope,
  authUserId,
  can,
  type ExamWithDetail,
  loadExam,
} from './assessment-scope.js';
import { bandsCoverScale } from './result-calc.js';
import { sheetOverview } from './sheets.js';

const D = Prisma.Decimal;
const money = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2));

/** Allowed forward steps (decision F). Results publication has its own endpoint. */
const NEXT: Record<string, { action: ExamTransition; to: Prisma.ExamUpdateInput['status'] }[]> = {
  DRAFT: [{ action: 'publish', to: 'PUBLISHED' }],
  PUBLISHED: [{ action: 'open-marks', to: 'MARKS_ENTRY' }],
  MARKS_ENTRY: [{ action: 'finalize-marks', to: 'MARKS_FINALIZED' }],
  RESULTS_PUBLISHED: [{ action: 'archive', to: 'ARCHIVED' }],
};

function audit(action: string, examId: string, metadata: Record<string, unknown> = {}): AuditEvent {
  return { action, resourceType: 'exam', resourceId: examId, metadata };
}

/**
 * Exams, their grade-level subjects, components and branch schedules, plus school grade scales.
 * Structure (subjects/components/max/pass) is editable only in DRAFT; schedules also while
 * PUBLISHED (before marks entry). A CLOSED academic year is read-only. Every change is audited
 * at exam level (no marks in the audit log).
 */
@Injectable()
export class ExamsService {
  constructor(private readonly store: AcademicStore) {}

  // ---- Grade scales -----------------------------------------------------------------------------

  gradeScales(academicYearId: string): Promise<GradeScale[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const rows = await tx.gradeScale.findMany({
        where: { schoolId: school.id, academicYearId },
        include: {
          bands: { orderBy: { displayOrder: 'asc' } },
          exams: { select: { status: true } },
        },
        orderBy: { name: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        academicYearId: r.academicYearId,
        name: r.name,
        version: r.version,
        bands: r.bands.map((b) => ({
          label: b.label,
          minPercentage: b.minPercentage.toFixed(2),
          maxPercentage: b.maxPercentage.toFixed(2),
          displayOrder: b.displayOrder,
        })),
        inUse: r.exams.some((e) => e.status !== 'DRAFT'),
      }));
    });
  }

  /** Create (id = null) or replace a scale's bands atomically. Bands must tile 0–100. */
  saveGradeScale(
    id: string | null,
    body: {
      academicYearId: string;
      name: string;
      bands: GradeBandInput[];
      expectedVersion?: number;
    },
  ): Promise<GradeScale[]> {
    const labels = body.bands.map((b) => b.label.trim().toLowerCase());
    if (
      new Set(labels).size !== labels.length ||
      !bandsCoverScale(body.bands.map((b) => ({ min: b.minPercentage, max: b.maxPercentage })))
    )
      throw E.gradeScaleInvalid();
    return this.store
      .mutate(async (tx, school, events) => {
        const year = await tx.academicYear.findFirst({
          where: { id: body.academicYearId, schoolId: school.id },
        });
        if (!year) throw E.examNotFound();
        assertYearOpen(year);
        let scaleId = id;
        try {
          if (scaleId === null) {
            const created = await tx.gradeScale.create({
              data: {
                tenantId: school.tenantId,
                schoolId: school.id,
                academicYearId: year.id,
                name: body.name.trim(),
              },
            });
            scaleId = created.id;
          } else {
            const existing = await tx.gradeScale.findFirst({
              where: { id: scaleId, schoolId: school.id, academicYearId: year.id },
              include: { exams: { select: { status: true } } },
            });
            if (!existing) throw E.gradeScaleNotFound();
            if (existing.exams.some((e) => e.status !== 'DRAFT')) throw E.gradeScaleInUse();
            if (body.expectedVersion !== existing.version) throw E.staleVersion('This grade scale');
            await tx.gradeScale.update({
              where: { id: existing.id },
              data: { name: body.name.trim(), version: existing.version + 1 },
            });
            await tx.gradeBand.deleteMany({ where: { gradeScaleId: existing.id } });
          }
          const sorted = [...body.bands].sort((a, b) =>
            new D(b.minPercentage).comparedTo(new D(a.minPercentage)),
          );
          await tx.gradeBand.createMany({
            data: sorted.map((b, i) => ({
              tenantId: school.tenantId,
              schoolId: school.id,
              gradeScaleId: scaleId ?? '',
              label: b.label.trim(),
              minPercentage: new D(b.minPercentage),
              maxPercentage: new D(b.maxPercentage),
              displayOrder: i,
            })),
          });
        } catch (error) {
          if (isUniqueViolation(error) && (error as Error).message.includes('grade_scales'))
            throw E.gradeScaleNameTaken();
          if (violates(error, 'grade_bands_no_overlap') || violates(error, 'grade_bands'))
            throw E.gradeScaleInvalid();
          if (isUniqueViolation(error)) throw E.gradeScaleNameTaken();
          throw error;
        }
        events.push({
          action: 'GRADE_SCALE_SAVED',
          resourceType: 'grade_scale',
          resourceId: scaleId,
          metadata: { bands: body.bands.length },
        });
        return year.id;
      })
      .then((yearId) => this.gradeScales(yearId));
  }

  deleteGradeScale(id: string): Promise<null> {
    return this.store.mutate(async (tx, school, events) => {
      const scale = await tx.gradeScale.findFirst({
        where: { id, schoolId: school.id },
        include: { exams: { select: { id: true } }, academicYear: true },
      });
      if (!scale) throw E.gradeScaleNotFound();
      assertYearOpen(scale.academicYear);
      if (scale.exams.length > 0) throw E.gradeScaleInUse();
      await tx.gradeBand.deleteMany({ where: { gradeScaleId: id } });
      await tx.gradeScale.delete({ where: { id } });
      events.push({ action: 'GRADE_SCALE_DELETED', resourceType: 'grade_scale', resourceId: id });
      return null;
    });
  }

  // ---- Exams ------------------------------------------------------------------------------------

  list(query: {
    academicYearId?: string;
    status?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Paginated<ExamSummary>> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const teacherGrades = await this.teacherGrades(tx, school);
      const where: Prisma.ExamWhereInput = {
        schoolId: school.id,
        ...(teacherGrades
          ? { status: { not: 'DRAFT' }, subjects: { some: { gradeId: { in: teacherGrades } } } }
          : {}),
        ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
        ...(query.status ? { status: query.status as Prisma.EnumExamStatusFilter['equals'] } : {}),
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.exam.count({ where }),
        tx.exam.findMany({
          where,
          include: {
            academicYear: true,
            subjects: { select: { grade: { select: { name: true, displayOrder: true } } } },
            publications: { where: { isCurrent: true }, select: { version: true } },
          },
          orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          academicYearId: r.academicYearId,
          academicYearName: r.academicYear.name,
          academicYearStatus: r.academicYear.status,
          startDate: isoDate(r.startDate),
          endDate: isoDate(r.endDate),
          status: r.status,
          version: r.version,
          gradeNames: [
            ...new Map(
              r.subjects
                .map((s) => s.grade)
                .sort((a, b) => a.displayOrder - b.displayOrder)
                .map((g) => [g.name, g.name]),
            ).keys(),
          ],
          currentPublicationVersion: r.publications[0]?.version ?? null,
        })),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    });
  }

  get(id: string): Promise<ExamDetail> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const exam = await loadExam(tx, school, id);
      const teacherGrades = await this.teacherGrades(tx, school);
      if (
        teacherGrades &&
        (exam.status === 'DRAFT' || !exam.subjects.some((s) => teacherGrades.includes(s.gradeId)))
      )
        throw E.examNotFound();
      return this.toDetail(tx, school, exam);
    });
  }

  /** Teachers see only non-draft exams of grades they teach (null = school-wide caller). */
  private async teacherGrades(tx: TenantTransaction, school: School): Promise<string[] | null> {
    const scope = await assessmentScope(tx, school);
    if (scope.schoolWide) return null;
    const sectionIds = [
      ...new Set([...[...scope.pairs].map((p) => p.split(':')[0] ?? ''), ...scope.classSections]),
    ];
    const rows = await tx.section.findMany({
      where: { id: { in: sectionIds }, schoolId: school.id },
      select: { gradeId: true },
    });
    return [...new Set(rows.map((r) => r.gradeId))];
  }

  create(body: CreateExamRequest): Promise<ExamDetail> {
    return this.store
      .transact(async (tx, school, events) => {
        const year = await tx.academicYear.findFirst({
          where: { id: body.academicYearId, schoolId: school.id },
        });
        if (!year) throw E.examNotFound();
        assertYearOpen(year);
        this.checkDates(year, body.startDate, body.endDate);
        if (body.gradeScaleId) await this.scaleOf(tx, school, body.gradeScaleId, year.id);
        try {
          const row = await tx.exam.create({
            data: {
              tenantId: school.tenantId,
              schoolId: school.id,
              academicYearId: year.id,
              gradeScaleId: body.gradeScaleId ?? null,
              name: body.name.trim(),
              description: body.description?.trim() || null,
              startDate: fromIsoDate(body.startDate),
              endDate: fromIsoDate(body.endDate),
              createdByUserId: authUserId(),
            },
          });
          events.push(audit('EXAM_CREATED', row.id));
          return row.id;
        } catch (error) {
          if (isUniqueViolation(error)) throw E.examNameTaken();
          throw error;
        }
      })
      .then((id) => this.get(id));
  }

  update(id: string, body: UpdateExamRequest): Promise<ExamDetail> {
    return this.store
      .transact(async (tx, school, events) => {
        const exam = await loadExam(tx, school, id, true);
        assertYearOpen(exam.academicYear);
        if (exam.status !== 'DRAFT') throw E.examNotEditable();
        if (body.expectedVersion !== exam.version) throw E.staleVersion('This exam');
        const start = body.startDate ?? isoDate(exam.startDate);
        const end = body.endDate ?? isoDate(exam.endDate);
        this.checkDates(exam.academicYear, start, end);
        if (body.gradeScaleId)
          await this.scaleOf(tx, school, body.gradeScaleId, exam.academicYearId);
        for (const s of exam.subjects)
          for (const c of s.components)
            for (const sc of c.schedules)
              if (isoDate(sc.examDate) < start || isoDate(sc.examDate) > end)
                throw E.scheduleInvalid();
        try {
          await tx.exam.update({
            where: { id },
            data: {
              ...(body.name !== undefined ? { name: body.name.trim() } : {}),
              ...(body.description !== undefined
                ? { description: body.description?.trim() || null }
                : {}),
              ...(body.gradeScaleId !== undefined ? { gradeScaleId: body.gradeScaleId } : {}),
              startDate: fromIsoDate(start),
              endDate: fromIsoDate(end),
              version: exam.version + 1,
            },
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw E.examNameTaken();
          throw error;
        }
        events.push({
          ...audit('EXAM_UPDATED', id),
          changedFields: Object.keys(body).filter((k) => k !== 'expectedVersion'),
        });
        return id;
      })
      .then((examId) => this.get(examId));
  }

  /** Only a DRAFT exam with no marks/sheets may be deleted (approved rule 8). */
  remove(id: string): Promise<null> {
    return this.store.transact(async (tx, school, events) => {
      const exam = await loadExam(tx, school, id, true);
      assertYearOpen(exam.academicYear);
      if (exam.status !== 'DRAFT') throw E.examHasData();
      const sheets = await tx.examMarkSheet.count({ where: { examId: id } });
      if (sheets > 0) throw E.examHasData();
      const componentIds = exam.subjects.flatMap((s) => s.components.map((c) => c.id));
      await tx.examComponentSchedule.deleteMany({ where: { componentId: { in: componentIds } } });
      await tx.examComponent.deleteMany({ where: { id: { in: componentIds } } });
      await tx.examSubject.deleteMany({ where: { examId: id } });
      await tx.studentExamRemark.deleteMany({ where: { examId: id } });
      await tx.exam.delete({ where: { id } });
      events.push(audit('EXAM_DELETED', id));
      return null;
    });
  }

  transition(id: string, action: ExamTransition, expectedVersion: number): Promise<ExamDetail> {
    return this.store
      .transact(async (tx, school, events) => {
        const exam = await loadExam(tx, school, id, true);
        assertYearOpen(exam.academicYear);
        if (expectedVersion !== exam.version) throw E.staleVersion('This exam');
        const step = (NEXT[exam.status] ?? []).find((n) => n.action === action);
        if (!step) throw E.invalidTransition();
        if (action === 'publish') await this.assertStructureComplete(tx, school, exam);
        if (action === 'finalize-marks') {
          const { items: sheets } = await sheetOverview(tx, school, exam, null);
          if (sheets.some((s) => s.status !== 'FINALIZED')) throw E.sheetsNotFinalized();
          if (sheets.some((s) => s.enteredCount < s.requiredCount)) throw E.marksIncomplete();
        }
        const now = new Date();
        const updated = await tx.exam.updateMany({
          where: { id, version: exam.version, status: exam.status },
          data: {
            status: step.to as never,
            version: exam.version + 1,
            ...(action === 'publish' ? { publishedAt: now } : {}),
            ...(action === 'archive' ? { archivedAt: now } : {}),
          },
        });
        if (updated.count !== 1) throw E.staleVersion('This exam');
        const names: Record<ExamTransition, string> = {
          publish: 'EXAM_PUBLISHED',
          'open-marks': 'EXAM_MARKS_ENTRY_OPENED',
          'finalize-marks': 'EXAM_MARKS_FINALIZED',
          archive: 'EXAM_ARCHIVED',
        };
        events.push(audit(names[action], id, { examName: exam.name }));
        return id;
      })
      .then((examId) => this.get(examId));
  }

  // ---- Structure (DRAFT only) --------------------------------------------------------------------

  addSubject(
    examId: string,
    body: { gradeId: string; subjectId: string; passMarks?: string | null; displayOrder?: number },
  ): Promise<ExamDetail> {
    return this.structure(examId, 'draft', async (tx, school, exam) => {
      const mapping = await tx.gradeSubject.findFirst({
        where: { gradeId: body.gradeId, subjectId: body.subjectId, schoolId: school.id },
      });
      if (!mapping) throw E.subjectNotInGrade();
      try {
        await tx.examSubject.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            examId: exam.id,
            academicYearId: exam.academicYearId,
            gradeId: body.gradeId,
            subjectId: body.subjectId,
            passMarks: body.passMarks ? new D(body.passMarks) : null,
            displayOrder: body.displayOrder ?? mapping.displayOrder,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw E.subjectExists();
        throw error;
      }
    });
  }

  updateSubject(
    examId: string,
    examSubjectId: string,
    body: { passMarks?: string | null; displayOrder?: number },
  ): Promise<ExamDetail> {
    return this.structure(examId, 'draft', async (tx, _school, exam) => {
      const s = exam.subjects.find((x) => x.id === examSubjectId);
      if (!s) throw E.examSubjectNotFound();
      if (body.passMarks) {
        const total = s.components.reduce((a, c) => a.add(c.maxMarks), new D(0));
        if (s.components.length && new D(body.passMarks).gt(total)) throw E.passMarksInvalid();
      }
      await tx.examSubject.update({
        where: { id: s.id },
        data: {
          ...(body.passMarks !== undefined
            ? { passMarks: body.passMarks ? new D(body.passMarks) : null }
            : {}),
          ...(body.displayOrder !== undefined ? { displayOrder: body.displayOrder } : {}),
        },
      });
    });
  }

  removeSubject(examId: string, examSubjectId: string): Promise<ExamDetail> {
    return this.structure(examId, 'draft', async (tx, _school, exam) => {
      const s = exam.subjects.find((x) => x.id === examSubjectId);
      if (!s) throw E.examSubjectNotFound();
      const ids = s.components.map((c) => c.id);
      await tx.examComponentSchedule.deleteMany({ where: { componentId: { in: ids } } });
      await tx.examComponent.deleteMany({ where: { id: { in: ids } } });
      await tx.examSubject.delete({ where: { id: s.id } });
    });
  }

  addComponent(
    examId: string,
    examSubjectId: string,
    body: { name: string; maxMarks: string; passMarks?: string | null; displayOrder?: number },
  ): Promise<ExamDetail> {
    return this.structure(examId, 'draft', async (tx, school, exam) => {
      const s = exam.subjects.find((x) => x.id === examSubjectId);
      if (!s) throw E.examSubjectNotFound();
      this.checkPass(body.maxMarks, body.passMarks);
      try {
        await tx.examComponent.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            examSubjectId: s.id,
            examId: exam.id,
            gradeId: s.gradeId,
            name: body.name.trim(),
            maxMarks: new D(body.maxMarks),
            passMarks: body.passMarks ? new D(body.passMarks) : null,
            displayOrder: body.displayOrder ?? s.components.length,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw E.componentNameTaken();
        throw error;
      }
    });
  }

  updateComponent(
    examId: string,
    componentId: string,
    body: { name?: string; maxMarks?: string; passMarks?: string | null; displayOrder?: number },
  ): Promise<ExamDetail> {
    return this.structure(examId, 'draft', async (tx, _school, exam) => {
      const c = exam.subjects.flatMap((s) => s.components).find((x) => x.id === componentId);
      if (!c) throw E.componentNotFound();
      const max = body.maxMarks ?? c.maxMarks.toFixed(2);
      const pass = body.passMarks !== undefined ? body.passMarks : money(c.passMarks);
      this.checkPass(max, pass);
      try {
        await tx.examComponent.update({
          where: { id: c.id },
          data: {
            ...(body.name !== undefined ? { name: body.name.trim() } : {}),
            maxMarks: new D(max),
            passMarks: pass ? new D(pass) : null,
            ...(body.displayOrder !== undefined ? { displayOrder: body.displayOrder } : {}),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw E.componentNameTaken();
        if (violates(error, 'student_exam_marks_within_max')) throw E.invalidMark();
        throw error;
      }
    });
  }

  removeComponent(examId: string, componentId: string): Promise<ExamDetail> {
    return this.structure(examId, 'draft', async (tx, _school, exam) => {
      const c = exam.subjects.flatMap((s) => s.components).find((x) => x.id === componentId);
      if (!c) throw E.componentNotFound();
      await tx.examComponentSchedule.deleteMany({ where: { componentId: c.id } });
      await tx.examComponent.delete({ where: { id: c.id } });
    });
  }

  /** Branch schedule of a component (decision E): DRAFT or PUBLISHED (before marks entry). */
  setSchedule(
    examId: string,
    componentId: string,
    branchId: string,
    body: { examDate: string; startTime: string; endTime: string },
  ): Promise<ExamDetail> {
    return this.structure(examId, 'schedule', async (tx, school, exam) => {
      const c = exam.subjects.flatMap((s) => s.components).find((x) => x.id === componentId);
      if (!c) throw E.componentNotFound();
      const branch = await tx.branch.findFirst({ where: { id: branchId, schoolId: school.id } });
      if (!branch) throw E.branchNotFound();
      if (
        body.examDate < isoDate(exam.startDate) ||
        body.examDate > isoDate(exam.endDate) ||
        body.endTime <= body.startTime
      )
        throw E.scheduleInvalid();
      try {
        // Raw SQL for TIME columns (the project's Prisma time workaround, same transaction/RLS).
        await tx.$executeRaw`
          INSERT INTO exam_component_schedules (id, tenant_id, school_id, component_id, exam_id, grade_id,
            branch_id, exam_date, start_time, end_time, created_at, updated_at)
          VALUES (gen_random_uuid(), ${school.tenantId}::uuid, ${school.id}::uuid, ${c.id}::uuid,
            ${exam.id}::uuid, ${c.gradeId}::uuid, ${branch.id}::uuid, ${body.examDate}::date,
            ${body.startTime}::time, ${body.endTime}::time, now(), now())
          ON CONFLICT (component_id, branch_id) DO UPDATE SET exam_date = EXCLUDED.exam_date,
            start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, updated_at = now()`;
      } catch (error) {
        if (violates(error, 'exam_component_schedules_no_overlap')) throw E.scheduleConflict();
        throw error;
      }
    });
  }

  removeSchedule(examId: string, componentId: string, branchId: string): Promise<ExamDetail> {
    return this.structure(examId, 'schedule', async (tx, school) => {
      await tx.examComponentSchedule.deleteMany({
        where: { componentId, branchId, schoolId: school.id },
      });
    });
  }

  // ---- helpers -----------------------------------------------------------------------------------

  private structure(
    examId: string,
    mode: 'draft' | 'schedule',
    fn: (tx: TenantTransaction, school: School, exam: ExamWithDetail) => Promise<void>,
  ): Promise<ExamDetail> {
    return this.store
      .transact(async (tx, school, events) => {
        const exam = await loadExam(tx, school, examId, true);
        assertYearOpen(exam.academicYear);
        const allowed = mode === 'draft' ? ['DRAFT'] : ['DRAFT', 'PUBLISHED'];
        if (!allowed.includes(exam.status)) throw E.examNotEditable();
        await fn(tx, school, exam);
        await tx.exam.update({ where: { id: exam.id }, data: { version: exam.version + 1 } });
        events.push(audit('EXAM_STRUCTURE_CHANGED', exam.id));
        return exam.id;
      })
      .then((id) => this.get(id));
  }

  private checkDates(year: { startDate: Date; endDate: Date }, start: string, end: string) {
    if (end < start || start < isoDate(year.startDate) || end > isoDate(year.endDate))
      throw E.datesInvalid();
  }

  private checkPass(max: string, pass: string | null | undefined) {
    if (new D(max).lte(0)) throw E.passMarksInvalid();
    if (pass && (new D(pass).lt(0) || new D(pass).gt(new D(max)))) throw E.passMarksInvalid();
  }

  private async scaleOf(tx: TenantTransaction, school: School, id: string, yearId: string) {
    const scale = await tx.gradeScale.findFirst({
      where: { id, schoolId: school.id, academicYearId: yearId },
    });
    if (!scale) throw E.gradeScaleNotFound();
    return scale;
  }

  /** Active sections of each exam grade in the exam year → the branches needing schedules. */
  private async branchesByGrade(tx: TenantTransaction, school: School, exam: ExamWithDetail) {
    const gradeIds = [...new Set(exam.subjects.map((s) => s.gradeId))];
    const sections = await tx.section.findMany({
      where: {
        schoolId: school.id,
        academicYearId: exam.academicYearId,
        gradeId: { in: gradeIds },
        isActive: true,
      },
      include: { branch: true },
    });
    return gradeIds.map((gradeId) => ({
      gradeId,
      branches: [
        ...new Map(
          sections
            .filter((s) => s.gradeId === gradeId)
            .map((s) => [s.branchId, { id: s.branchId, name: s.branch.name }]),
        ).values(),
      ],
    }));
  }

  private async assertStructureComplete(
    tx: TenantTransaction,
    school: School,
    exam: ExamWithDetail,
  ) {
    if (exam.subjects.length === 0) throw E.structureIncomplete('Add at least one subject');
    const branches = await this.branchesByGrade(tx, school, exam);
    for (const s of exam.subjects) {
      if (s.components.length === 0)
        throw E.structureIncomplete(`${s.subject.name} needs at least one component`);
      const total = s.components.reduce((a, c) => a.add(c.maxMarks), new D(0));
      if (s.passMarks && s.passMarks.gt(total)) throw E.passMarksInvalid();
      const needed = branches.find((b) => b.gradeId === s.gradeId)?.branches ?? [];
      for (const c of s.components)
        for (const b of needed)
          if (!c.schedules.some((sc) => sc.branchId === b.id))
            throw E.structureIncomplete(
              `${s.subject.name} · ${c.name} needs a schedule for ${b.name}`,
            );
    }
  }

  private async toDetail(
    tx: TenantTransaction,
    school: School,
    exam: ExamWithDetail,
  ): Promise<ExamDetail> {
    const [branches, current] = await Promise.all([
      this.branchesByGrade(tx, school, exam),
      tx.resultPublication.findFirst({ where: { examId: exam.id, isCurrent: true } }),
    ]);
    const manage = can('exam.manage') && exam.academicYear.status !== 'CLOSED';
    const hasSheets =
      exam.status === 'DRAFT'
        ? (await tx.examMarkSheet.count({ where: { examId: exam.id } })) > 0
        : true;
    return {
      id: exam.id,
      name: exam.name,
      description: exam.description,
      academicYearId: exam.academicYearId,
      academicYearName: exam.academicYear.name,
      academicYearStatus: exam.academicYear.status,
      startDate: isoDate(exam.startDate),
      endDate: isoDate(exam.endDate),
      status: exam.status,
      version: exam.version,
      gradeNames: [...new Set(exam.subjects.map((s) => s.grade.name))],
      currentPublicationVersion: current?.version ?? null,
      gradeScale: exam.gradeScale ? { id: exam.gradeScale.id, name: exam.gradeScale.name } : null,
      subjects: exam.subjects.map((s) => ({
        id: s.id,
        gradeId: s.gradeId,
        gradeName: s.grade.name,
        subjectId: s.subjectId,
        subjectName: s.subject.name,
        passMarks: money(s.passMarks),
        totalMaxMarks: s.components.reduce((a, c) => a.add(c.maxMarks), new D(0)).toFixed(2),
        displayOrder: s.displayOrder,
        components: s.components.map((c) => ({
          id: c.id,
          name: c.name,
          maxMarks: c.maxMarks.toFixed(2),
          passMarks: money(c.passMarks),
          displayOrder: c.displayOrder,
          schedules: c.schedules.map((sc) => ({
            branchId: sc.branchId,
            branchName: sc.branch.name,
            examDate: isoDate(sc.examDate),
            startTime: hhmm(sc.startTime),
            endTime: hhmm(sc.endTime),
          })),
        })),
      })),
      branchesByGrade: branches,
      can: {
        edit: manage && exam.status === 'DRAFT',
        transitions: manage ? (NEXT[exam.status] ?? []).map((n) => n.action) : [],
        delete: manage && exam.status === 'DRAFT' && !hasSheets,
        publishResults:
          can('results.publish') &&
          exam.academicYear.status !== 'CLOSED' &&
          exam.status === 'MARKS_FINALIZED',
      },
    };
  }
}
