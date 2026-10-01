import type { MarkSheetSummary } from '@acadlyx/types';
import { Prisma, type School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import {
  type AssessmentScope,
  eligibilityFor,
  enrollmentsFor,
  type ExamWithDetail,
  mayEnterMarks,
} from './assessment-scope.js';

/**
 * Every REQUIRED mark sheet of an exam = exam subject × active section of that grade in the exam
 * year that has at least one eligible student. Built from structure + enrollments only (no
 * marks): ≈ 3 bounded queries whatever the school size. Completion counts are then loaded ONLY
 * for the requested rows (`only`), one keys query restricted to those sheets — a list page never
 * reads every mark of the exam. `scope` null = everything (internal use).
 */
export async function sheetOverview(
  tx: TenantTransaction,
  school: School,
  exam: ExamWithDetail,
  scope: AssessmentScope | null,
  only?: { page: number; pageSize: number },
): Promise<{ items: MarkSheetSummary[]; total: number }> {
  const gradeIds = [...new Set(exam.subjects.map((s) => s.gradeId))];
  const sections = await tx.section.findMany({
    where: {
      schoolId: school.id,
      academicYearId: exam.academicYearId,
      gradeId: { in: gradeIds },
      isActive: true,
    },
    include: { grade: true, branch: true },
    orderBy: [{ grade: { displayOrder: 'asc' } }, { displayOrder: 'asc' }],
  });
  const [enrollments, sheets] = await Promise.all([
    enrollmentsFor(
      tx,
      school,
      sections.map((s) => s.id),
    ),
    tx.examMarkSheet.findMany({
      where: { examId: exam.id },
      select: { id: true, examSubjectId: true, sectionId: true, status: true, version: true },
    }),
  ]);
  const bySection = new Map<string, typeof enrollments>();
  for (const e of enrollments) {
    const list = bySection.get(e.sectionId);
    if (list) list.push(e);
    else bySection.set(e.sectionId, [e]);
  }
  const sheetBy = new Map(sheets.map((x) => [`${x.examSubjectId}:${x.sectionId}`, x]));

  type Row = {
    summary: MarkSheetSummary;
    sheetId: string | null;
    eligible: Map<string, Set<string>>;
  };
  const rows: Row[] = [];
  for (const subject of exam.subjects) {
    for (const section of sections) {
      if (section.gradeId !== subject.gradeId) continue;
      if (scope && !scope.schoolWide && !mayEnterMarks(scope, section.id, subject.subjectId))
        continue;
      const eligible = eligibilityFor(exam, subject.id, section, bySection.get(section.id) ?? []);
      let students = 0;
      let required = 0;
      const all = new Set<string>();
      for (const set of eligible.values()) {
        required += set.size;
        for (const id of set) all.add(id);
      }
      students = all.size;
      if (students === 0) continue;
      const sheet = sheetBy.get(`${subject.id}:${section.id}`);
      const editableState = !sheet || sheet.status === 'DRAFT' || sheet.status === 'REOPENED';
      rows.push({
        sheetId: sheet?.id ?? null,
        eligible,
        summary: {
          examSubjectId: subject.id,
          sectionId: section.id,
          className: `${section.grade.name} ${section.name}`,
          branchName: section.branch.name,
          subjectName: subject.subject.name,
          status: sheet?.status ?? 'NOT_STARTED',
          version: sheet?.version ?? 0,
          studentCount: students,
          enteredCount: 0,
          requiredCount: required,
          canEdit:
            exam.status === 'MARKS_ENTRY' &&
            editableState &&
            (scope === null || mayEnterMarks(scope, section.id, subject.subjectId)),
        },
      });
    }
  }

  const page = only ? rows.slice((only.page - 1) * only.pageSize, only.page * only.pageSize) : rows;
  const sheetIds = page.map((r) => r.sheetId).filter((x): x is string => x !== null);
  if (sheetIds.length) {
    // Only this page's sheets; RLS applies. Indexed by student_exam_marks_sheet_id_idx.
    const keys = await tx.$queryRaw<{ s: string; k: string }[]>(Prisma.sql`
      SELECT m.sheet_id::text AS s, m.component_id::text || ':' || m.student_id::text AS k
        FROM student_exam_marks m
       WHERE m.sheet_id IN (${Prisma.join(sheetIds.map((id) => Prisma.sql`${id}::uuid`))})
         AND m.school_id = ${school.id}::uuid`);
    const entered = new Map<string, Set<string>>();
    for (const { s: sid, k } of keys) {
      const set = entered.get(sid);
      if (set) set.add(k);
      else entered.set(sid, new Set([k]));
    }
    for (const r of page) {
      const got = r.sheetId ? entered.get(r.sheetId) : undefined;
      if (!got) continue;
      let done = 0;
      for (const [componentId, set] of r.eligible)
        for (const studentId of set) if (got.has(`${componentId}:${studentId}`)) done += 1;
      r.summary.enteredCount = done;
    }
  }
  return { items: page.map((r) => r.summary), total: rows.length };
}
