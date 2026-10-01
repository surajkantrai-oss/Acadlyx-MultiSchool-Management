import type {
  ClassResults,
  PublishedResultSummary,
  ReportCard,
  ResultPublicationSummary,
  SubjectResultView,
} from '@acadlyx/types';
import { REMARK_MAX } from '@acadlyx/validation';
import { Injectable } from '@nestjs/common';
import { uuidv7 } from '../../common/ids/uuid.js';
import { Prisma, type School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { AcademicStore } from '../academic/academic-store.js';
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
  maySeeClassResults,
} from './assessment-scope.js';
import { type CalcMark, calculateStudent, display2, type StudentResult } from './result-calc.js';

type Computed = {
  studentId: string;
  name: string;
  admissionNumber: string;
  sectionId: string;
  sectionName: string;
  gradeName: string;
  result: StudentResult;
};

const s2 = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2));
const s6 = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(6));
/** Publishing snapshots a whole exam atomically (≈ 5,000 students → ~125k rows): 60 s budget. */
const PUBLISH_TX = { timeout: 60_000 };

/**
 * Results (decisions J–N, S, V). Pre-publication results are CALCULATED ON DEMAND by the
 * canonical engine (result-calc.ts) — never stored, so recalculation can't create duplicates.
 * Publication snapshots the exact calculated output into an immutable, versioned publication
 * (decision L); parents/students only ever read the current published snapshot.
 */
@Injectable()
export class ResultsService {
  constructor(private readonly store: AcademicStore) {}

  /** Live results of every eligible student of an exam (optionally one section). */
  async compute(
    tx: TenantTransaction,
    school: School,
    exam: ExamWithDetail,
    sectionId?: string,
  ): Promise<Computed[]> {
    const gradeIds = [...new Set(exam.subjects.map((s) => s.gradeId))];
    const sections = await tx.section.findMany({
      where: {
        schoolId: school.id,
        academicYearId: exam.academicYearId,
        gradeId: { in: gradeIds },
        ...(sectionId ? { id: sectionId } : {}),
      },
      include: { grade: true },
    });
    const enrollments = await enrollmentsFor(
      tx,
      school,
      sections.map((s) => s.id),
    );
    // Per student: eligible components (across sections — a mid-exam transfer keeps each paper
    // with the class the student sat it in) and the section of the latest paper.
    const bySection = new Map<string, typeof enrollments>();
    for (const e of enrollments) {
      const list = bySection.get(e.sectionId);
      if (list) list.push(e);
      else bySection.set(e.sectionId, [e]);
    }
    const perStudent = new Map<
      string,
      { components: Set<string>; section: (typeof sections)[number]; date: string }
    >();
    for (const subject of exam.subjects)
      for (const section of sections.filter((s) => s.gradeId === subject.gradeId)) {
        const eligible = eligibilityFor(exam, subject.id, section, bySection.get(section.id) ?? []);
        for (const component of subject.components) {
          const date = component.schedules.find((x) => x.branchId === section.branchId);
          for (const studentId of eligible.get(component.id) ?? []) {
            const d = date ? isoDate(date.examDate) : '';
            const cur = perStudent.get(studentId);
            if (!cur)
              perStudent.set(studentId, { components: new Set([component.id]), section, date: d });
            else {
              cur.components.add(component.id);
              if (d > cur.date) Object.assign(cur, { section, date: d });
            }
          }
        }
      }
    const ids = [...perStudent.keys()];
    const [students, marks] = await Promise.all([
      tx.student.findMany({ where: { id: { in: ids }, schoolId: school.id } }),
      tx.studentExamMark.findMany({
        where: { sheet: { examId: exam.id }, studentId: { in: ids } },
        select: { studentId: true, componentId: true, status: true, marksObtained: true },
      }),
    ]);
    const marksBy = new Map<string, Map<string, CalcMark>>();
    for (const m of marks) {
      const map = marksBy.get(m.studentId) ?? new Map<string, CalcMark>();
      map.set(m.componentId, { status: m.status, marks: m.marksObtained });
      marksBy.set(m.studentId, map);
    }
    const bands =
      exam.gradeScale?.bands.map((b) => ({
        label: b.label,
        min: b.minPercentage,
        max: b.maxPercentage,
      })) ?? null;
    const subjects = exam.subjects.map((s) => ({
      examSubjectId: s.id,
      subjectName: s.subject.name,
      passMarks: s.passMarks,
      displayOrder: s.displayOrder,
      components: s.components.map((c) => ({
        id: c.id,
        name: c.name,
        maxMarks: c.maxMarks,
        passMarks: c.passMarks,
        displayOrder: c.displayOrder,
      })),
    }));
    return students
      .map((st) => {
        const info = perStudent.get(st.id);
        if (!info) return null;
        return {
          studentId: st.id,
          name: personName(st),
          admissionNumber: st.admissionNumber,
          sectionId: info.section.id,
          sectionName: info.section.name,
          gradeName: info.section.grade.name,
          result: calculateStudent({
            subjects,
            marks: marksBy.get(st.id) ?? new Map(),
            eligible: info.components,
            bands,
          }),
        };
      })
      .filter((x): x is Computed => x !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  classResults(
    examId: string,
    query: { sectionId?: string; page?: number; pageSize?: number },
  ): Promise<ClassResults> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const exam = await loadExam(tx, school, examId);
      const scope = await assessmentScope(tx, school);
      if (!scope.schoolWide) {
        // Class teachers: only their own section, and never a draft exam.
        if (
          !query.sectionId ||
          !maySeeClassResults(scope, query.sectionId) ||
          exam.status === 'DRAFT'
        )
          throw E.examNotFound();
      }
      // Always computed across the whole exam (a mid-exam transfer keeps each paper with the class
      // it was sat in), then listed under the student's section of their latest paper.
      const all = (await this.compute(tx, school, exam)).filter(
        (c) => !query.sectionId || c.sectionId === query.sectionId,
      );
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 50;
      return {
        examId: exam.id,
        examName: exam.name,
        examStatus: exam.status,
        rows: all.slice((page - 1) * pageSize, page * pageSize).map((c) => ({
          studentId: c.studentId,
          name: c.name,
          admissionNumber: c.admissionNumber,
          className: `${c.gradeName} ${c.sectionName}`,
          obtained: c.result.obtained.toFixed(2),
          maxMarks: c.result.maxMarks.toFixed(2),
          percentageDisplay: display2(c.result.percentage),
          grade: c.result.grade,
          status: c.result.status,
        })),
        total: all.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
        incompleteCount: all.filter((c) => c.result.status === 'INCOMPLETE').length,
        canPublish:
          scope.schoolWide &&
          can('results.publish') &&
          exam.status === 'MARKS_FINALIZED' &&
          exam.academicYear.status !== 'CLOSED',
      };
    });
  }

  /** Staff live preview of one student's (unpublished) result — scoped like classResults. */
  preview(examId: string, studentId: string): Promise<ReportCard> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const exam = await loadExam(tx, school, examId);
      const scope = await assessmentScope(tx, school);
      const all = await this.compute(tx, school, exam);
      const c = all.find((x) => x.studentId === studentId);
      if (
        !c ||
        (!scope.schoolWide && (exam.status === 'DRAFT' || !maySeeClassResults(scope, c.sectionId)))
      )
        throw E.studentNotFound();
      const remark = await tx.studentExamRemark.findUnique({
        where: { examId_studentId: { examId, studentId } },
      });
      return {
        preview: true,
        publicationVersion: null,
        publishedAt: null,
        schoolName: school.name,
        examName: exam.name,
        academicYearName: exam.academicYear.name,
        studentName: c.name,
        admissionNumber: c.admissionNumber,
        gradeName: c.gradeName,
        sectionName: c.sectionName,
        subjects: c.result.subjects.map((s) => ({
          subjectName: s.subjectName,
          obtained: s2(s.obtained),
          maxMarks: s2(s.maxMarks),
          passMarks: s2(s.passMarks),
          percentage: s6(s.percentage),
          percentageDisplay: display2(s.percentage),
          grade: s.grade,
          outcome: s.outcome,
          components: s.components.map((x) => ({
            name: x.name,
            maxMarks: x.maxMarks.toFixed(2),
            passMarks: s2(x.passMarks),
            status: x.status,
            marks: s2(x.marks),
            passed: x.passed,
          })),
        })),
        obtained: c.result.obtained.toFixed(2),
        maxMarks: c.result.maxMarks.toFixed(2),
        percentage: s6(c.result.percentage),
        percentageDisplay: display2(c.result.percentage),
        grade: c.result.grade,
        status: c.result.status,
        remark: remark?.remark ?? null,
      };
    });
  }

  /**
   * Publish (results.publish; decision L). Serialised by the exam row lock: exactly one of two
   * simultaneous requests succeeds (the other sees RESULTS_PUBLISHED → invalid transition).
   * Blocked while any result is INCOMPLETE. Creates version n+1 and makes it the only current one.
   */
  publish(examId: string, expectedVersion: number): Promise<ResultPublicationSummary[]> {
    return this.store
      .transact(async (tx, school, events) => {
        const exam = await loadExam(tx, school, examId, true);
        assertYearOpen(exam.academicYear);
        if (exam.version !== expectedVersion) throw E.staleVersion('This exam');
        if (exam.status !== 'MARKS_FINALIZED') throw E.invalidTransition();
        const all = await this.compute(tx, school, exam);
        if (all.length === 0 || all.some((c) => c.result.status === 'INCOMPLETE'))
          throw E.resultsIncomplete();
        const remarks = new Map(
          (await tx.studentExamRemark.findMany({ where: { examId } })).map((x) => [
            x.studentId,
            x.remark,
          ]),
        );
        const last = await tx.resultPublication.findFirst({
          where: { examId },
          orderBy: { version: 'desc' },
        });
        const version = (last?.version ?? 0) + 1;
        await tx.resultPublication.updateMany({
          where: { examId, isCurrent: true },
          data: { isCurrent: false },
        });
        const publicationId = uuidv7();
        const scope = { tenantId: school.tenantId, schoolId: school.id };
        await tx.resultPublication.create({
          data: {
            ...scope,
            id: publicationId,
            examId,
            version,
            isCurrent: true,
            schoolName: school.name,
            examName: exam.name,
            academicYearName: exam.academicYear.name,
            publishedByUserId: authUserId(),
            publishedAt: new Date(),
          },
        });
        const studentRows: Prisma.ResultStudentSnapshotCreateManyInput[] = [];
        const subjectRows: Prisma.ResultSubjectSnapshotCreateManyInput[] = [];
        const componentRows: Prisma.ResultComponentSnapshotCreateManyInput[] = [];
        for (const c of all) {
          const studentSnapshotId = uuidv7();
          const r = c.result;
          studentRows.push({
            ...scope,
            id: studentSnapshotId,
            publicationId,
            studentId: c.studentId,
            sectionId: c.sectionId,
            studentName: c.name,
            admissionNumber: c.admissionNumber,
            gradeName: c.gradeName,
            sectionName: c.sectionName,
            totalObtained: r.obtained,
            totalMax: r.maxMarks,
            percentage: r.percentage,
            gradeLabel: r.grade,
            outcome: r.status as 'PASS' | 'FAIL' | 'EXEMPT',
            remark: remarks.get(c.studentId) ?? null,
          });
          for (const s of r.subjects) {
            const subjectSnapshotId = uuidv7();
            subjectRows.push({
              ...scope,
              id: subjectSnapshotId,
              studentSnapshotId,
              subjectName: s.subjectName,
              displayOrder: s.displayOrder,
              obtained: s.obtained,
              maxMarks: s.maxMarks,
              passMarks: s.passMarks,
              percentage: s.percentage,
              gradeLabel: s.grade,
              outcome: s.outcome as 'PASS' | 'FAIL' | 'EXEMPT',
            });
            for (const x of s.components)
              componentRows.push({
                ...scope,
                subjectSnapshotId,
                componentName: x.name,
                displayOrder: x.displayOrder,
                maxMarks: x.maxMarks,
                passMarks: x.passMarks,
                status: x.status ?? 'EXEMPT',
                marksObtained: x.marks,
                passed: x.passed,
              });
          }
        }
        await tx.resultStudentSnapshot.createMany({ data: studentRows });
        await tx.resultSubjectSnapshot.createMany({ data: subjectRows });
        await tx.resultComponentSnapshot.createMany({ data: componentRows });
        const moved = await tx.exam.updateMany({
          where: { id: examId, version: exam.version, status: 'MARKS_FINALIZED' },
          data: { status: 'RESULTS_PUBLISHED', version: exam.version + 1 },
        });
        if (moved.count !== 1) throw E.staleVersion('This exam');
        events.push({
          action: 'RESULTS_PUBLISHED',
          resourceType: 'exam',
          resourceId: examId,
          // Counts only — never marks or snapshots.
          metadata: { examName: exam.name, version, students: all.length },
        });
        return null;
        // One atomic snapshot of the whole exam (thousands of rows at school scale): bounded by
        // the exam's size, so it gets an explicit, longer transaction budget.
      }, PUBLISH_TX)
      .then(() => this.publications(examId));
  }

  publications(examId: string): Promise<ResultPublicationSummary[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      await loadExam(tx, school, examId);
      const scope = await assessmentScope(tx, school);
      if (!scope.schoolWide) throw E.examNotFound();
      const rows = await tx.resultPublication.findMany({
        where: { examId },
        orderBy: { version: 'desc' },
        include: { _count: { select: { students: true } } },
      });
      const users = await tx.user.findMany({
        where: { id: { in: rows.map((r) => r.publishedByUserId) } },
        select: { id: true, displayName: true },
      });
      return rows.map((r) => ({
        id: r.id,
        version: r.version,
        isCurrent: r.isCurrent,
        publishedAt: r.publishedAt.toISOString(),
        publishedByName: users.find((u) => u.id === r.publishedByUserId)?.displayName ?? null,
        studentCount: r._count.students,
      }));
    });
  }

  /** Staff: a published (any version) report card. */
  publishedCard(publicationId: string, studentId: string): Promise<ReportCard> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const scope = await assessmentScope(tx, school);
      const card = await snapshotCard(tx, school, { publicationId, studentId });
      if (!card || (!scope.schoolWide && !maySeeClassResults(scope, card.sectionId)))
        throw E.resultNotPublished();
      return card.card;
    });
  }

  /** General remark by the student's class teacher (or leadership) — decision N. */
  setRemark(examId: string, studentId: string, remark: string | null): Promise<ReportCard> {
    const text = remark?.trim() ?? '';
    if (text.length > REMARK_MAX) throw E.invalidMark(`At most ${String(REMARK_MAX)} characters`);
    return this.store
      .transact(async (tx, school, events) => {
        const exam = await loadExam(tx, school, examId, true);
        assertYearOpen(exam.academicYear);
        if (exam.status === 'DRAFT' || exam.status === 'ARCHIVED') throw E.examNotEditable();
        const scope = await assessmentScope(tx, school);
        const c = (await this.compute(tx, school, exam)).find((x) => x.studentId === studentId);
        if (!c) throw E.studentNotFound();
        if (!scope.schoolWide && !scope.classSections.has(c.sectionId)) throw E.remarkNotAllowed();
        const existing = await tx.studentExamRemark.findUnique({
          where: { examId_studentId: { examId, studentId } },
        });
        if (!text) {
          if (existing) await tx.studentExamRemark.delete({ where: { id: existing.id } });
        } else if (existing)
          await tx.studentExamRemark.update({
            where: { id: existing.id },
            data: { remark: text, version: existing.version + 1, updatedByUserId: authUserId() },
          });
        else
          await tx.studentExamRemark.create({
            data: {
              tenantId: school.tenantId,
              schoolId: school.id,
              examId,
              studentId,
              remark: text,
              updatedByUserId: authUserId(),
            },
          });
        events.push({
          action: 'EXAM_REMARK_SAVED',
          resourceType: 'exam',
          resourceId: examId,
          metadata: { sectionId: c.sectionId }, // never the remark text
        });
        return null;
      })
      .then(() => this.preview(examId, studentId));
  }
}

// ---- Published snapshots (shared with the mobile self-service routes) ---------------------------

const CARD_INCLUDE = {
  publication: true,
  subjects: {
    orderBy: { displayOrder: 'asc' },
    include: { components: { orderBy: { displayOrder: 'asc' } } },
  },
} as const satisfies Prisma.ResultStudentSnapshotInclude;

/**
 * A report card from a publication snapshot. `current` restricts to the exam's CURRENT version
 * (parents/students); staff may open any version by publication id. Never reads live marks.
 */
export async function snapshotCard(
  tx: TenantTransaction,
  school: School,
  where: { publicationId: string; studentId: string } | { examId: string; studentId: string },
): Promise<{ card: ReportCard; sectionId: string } | null> {
  const row = await tx.resultStudentSnapshot.findFirst({
    where: {
      schoolId: school.id,
      studentId: where.studentId,
      ...('publicationId' in where
        ? { publicationId: where.publicationId }
        : { publication: { examId: where.examId, isCurrent: true } }),
    },
    include: CARD_INCLUDE,
  });
  if (!row) return null;
  const subjects: SubjectResultView[] = row.subjects.map((s) => ({
    subjectName: s.subjectName,
    obtained: s2(s.obtained),
    maxMarks: s2(s.maxMarks),
    passMarks: s2(s.passMarks),
    percentage: s6(s.percentage),
    percentageDisplay: display2(s.percentage),
    grade: s.gradeLabel,
    outcome: s.outcome,
    components: s.components.map((c) => ({
      name: c.componentName,
      maxMarks: c.maxMarks.toFixed(2),
      passMarks: s2(c.passMarks),
      status: c.status,
      marks: s2(c.marksObtained),
      passed: c.passed,
    })),
  }));
  return {
    sectionId: row.sectionId,
    card: {
      preview: false,
      publicationVersion: row.publication.version,
      publishedAt: row.publication.publishedAt.toISOString(),
      schoolName: row.publication.schoolName,
      examName: row.publication.examName,
      academicYearName: row.publication.academicYearName,
      studentName: row.studentName,
      admissionNumber: row.admissionNumber,
      gradeName: row.gradeName,
      sectionName: row.sectionName,
      subjects,
      obtained: row.totalObtained.toFixed(2),
      maxMarks: row.totalMax.toFixed(2),
      percentage: s6(row.percentage),
      percentageDisplay: display2(row.percentage),
      grade: row.gradeLabel,
      status: row.outcome,
      remark: row.remark,
    },
  };
}

/** Current published results of one student (bounded: newest first, max 50). */
export async function publishedResultsFor(
  tx: TenantTransaction,
  school: School,
  studentId: string,
): Promise<PublishedResultSummary[]> {
  const rows = await tx.resultStudentSnapshot.findMany({
    where: { schoolId: school.id, studentId, publication: { isCurrent: true } },
    include: { publication: true },
    orderBy: { publication: { publishedAt: 'desc' } },
    take: 50,
  });
  return rows.map((r) => ({
    examId: r.publication.examId,
    examName: r.publication.examName,
    academicYearName: r.publication.academicYearName,
    publishedAt: r.publication.publishedAt.toISOString(),
    version: r.publication.version,
    percentageDisplay: display2(r.percentage),
    grade: r.gradeLabel,
    status: r.outcome,
  }));
}
