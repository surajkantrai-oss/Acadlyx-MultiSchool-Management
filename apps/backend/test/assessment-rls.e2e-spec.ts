import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfigService } from '../src/config/app-config.service.js';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  type AcademicFixture,
  createAcademicFixture,
  createFixtureSchools,
  createFixtureTenants,
  FIXTURE_LETTERS,
  type FixtureLetter,
  type FixtureTenant,
  purgeTenants,
} from './helpers/tenant-fixtures.js';

const PREFIX = 'ASMRLS';
const USER = '00000000-0000-4000-8000-000000000001';
const TABLES = [
  'grade_scales',
  'grade_bands',
  'exams',
  'exam_subjects',
  'exam_components',
  'exam_component_schedules',
  'exam_mark_sheets',
  'exam_mark_sheet_events',
  'student_exam_marks',
  'student_exam_mark_history',
  'student_exam_remarks',
  'result_publications',
  'result_student_snapshots',
  'result_subject_snapshots',
  'result_component_snapshots',
  'assignment_submission_grades',
  'assignment_submission_grade_history',
] as const;

interface Rows {
  school: string;
  ac: AcademicFixture;
  student: string;
  exam: string;
  subject: string;
  component: string;
  sheet: string;
  mark: string;
  history: string;
  publication: string;
  snapshot: string;
  scale: string;
}

/**
 * Raw SQL as the restricted role `acadlyx_app` against the Phase 9 tables — no application code:
 * FORCE RLS (fail closed), WITH CHECK, least-privilege grants (append-only history/snapshots),
 * CHECKs, triggers (marks ≤ max), EXCLUDE constraints (bands, schedules), one current publication,
 * DRAFT-only exam delete, and composite FKs across tenants and across schools of one tenant.
 */
describe('Row Level Security on Phase 9 assessment tables (direct database tests)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let pool: pg.Pool;
  const rows = {} as Record<FixtureLetter, Rows>;

  async function asTenant<T>(
    tenant: FixtureLetter | null,
    fn: (c: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (tenant)
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [t[tenant].id]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async function rejects(
    tenant: FixtureLetter | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<string> {
    try {
      await asTenant(tenant, (c) => c.query(sql, params));
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error(`Expected failure: ${sql}`);
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    t = await createFixtureTenants(prisma, PREFIX);
    const schools = await createFixtureSchools(prisma, t);
    for (const l of FIXTURE_LETTERS) {
      const scope = { tenantId: t[l].id, schoolId: schools[l] };
      const ac = await createAcademicFixture(prisma, t[l].id, schools[l]);
      const student = await prisma.student.create({
        data: { ...scope, admissionNumber: 'R-1', firstName: 'Kid' },
      });
      const scale = await prisma.gradeScale.create({
        data: { ...scope, academicYearId: ac.yearId, name: 'S' },
      });
      await prisma.gradeBand.create({
        data: {
          ...scope,
          gradeScaleId: scale.id,
          label: 'A',
          minPercentage: 50,
          maxPercentage: 100,
          displayOrder: 0,
        },
      });
      const exam = await prisma.exam.create({
        data: {
          ...scope,
          academicYearId: ac.yearId,
          name: 'Mid',
          startDate: new Date('2026-10-01'),
          endDate: new Date('2026-10-20'),
          status: 'MARKS_ENTRY',
          publishedAt: new Date(),
          createdByUserId: USER,
        },
      });
      const subject = await prisma.examSubject.create({
        data: {
          ...scope,
          examId: exam.id,
          academicYearId: ac.yearId,
          gradeId: ac.gradeId,
          subjectId: ac.mathId,
        },
      });
      const component = await prisma.examComponent.create({
        data: {
          ...scope,
          examSubjectId: subject.id,
          examId: exam.id,
          gradeId: ac.gradeId,
          name: 'Written',
          maxMarks: 50,
        },
      });
      const sheet = await prisma.examMarkSheet.create({
        data: {
          ...scope,
          examSubjectId: subject.id,
          examId: exam.id,
          gradeId: ac.gradeId,
          academicYearId: ac.yearId,
          sectionId: ac.sectionA,
        },
      });
      const mark = await prisma.studentExamMark.create({
        data: {
          ...scope,
          sheetId: sheet.id,
          examSubjectId: subject.id,
          componentId: component.id,
          studentId: student.id,
          status: 'MARKED',
          marksObtained: 40,
          updatedByUserId: USER,
        },
      });
      const history = await prisma.studentExamMarkHistory.create({
        data: {
          ...scope,
          markId: mark.id,
          version: 1,
          toStatus: 'MARKED',
          toMarks: 40,
          changedByUserId: USER,
        },
      });
      const publication = await prisma.resultPublication.create({
        data: {
          ...scope,
          examId: exam.id,
          version: 1,
          schoolName: 'S',
          examName: 'Mid',
          academicYearName: 'Y',
          publishedByUserId: USER,
          publishedAt: new Date(),
        },
      });
      const snapshot = await prisma.resultStudentSnapshot.create({
        data: {
          ...scope,
          publicationId: publication.id,
          studentId: student.id,
          sectionId: ac.sectionA,
          studentName: 'Kid',
          admissionNumber: 'R-1',
          gradeName: 'G5',
          sectionName: 'A',
          totalObtained: 40,
          totalMax: 50,
          outcome: 'PASS',
        },
      });
      rows[l] = {
        school: schools[l],
        ac,
        student: student.id,
        exam: exam.id,
        subject: subject.id,
        component: component.id,
        sheet: sheet.id,
        mark: mark.id,
        history: history.id,
        publication: publication.id,
        snapshot: snapshot.id,
        scale: scale.id,
      };
    }
    pool = new pg.Pool({
      connectionString: app.get(AppConfigService).get('DATABASE_APP_URL'),
      max: 2,
    });
  });

  afterAll(async () => {
    await pool.end();
    await purgeTenants(prisma, PREFIX);
    await app.close();
  });

  it('all 17 Phase 9 tables have ENABLE + FORCE RLS and a tenant_isolation policy', async () => {
    const res = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string[];
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              array(SELECT polname::text FROM pg_policy p WHERE p.polrelid = c.oid ORDER BY polname) AS policies
         FROM pg_class c WHERE c.relname = ANY($1::text[]) AND c.relkind = 'r'`,
      [[...TABLES]],
    );
    expect(res.rows).toHaveLength(TABLES.length);
    for (const r of res.rows) {
      expect(r, r.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      expect(r.policies, r.relname).toContain('tenant_isolation');
    }
  });

  it('fails closed without a tenant; each tenant sees only its own rows', async () => {
    for (const table of TABLES) {
      const res = await asTenant(null, (c) =>
        c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`),
      );
      expect(res.rows[0], table).toEqual({ n: 0 });
    }
    const seen = await asTenant('A', (c) =>
      c.query<{ id: string }>('SELECT id FROM student_exam_marks'),
    );
    expect(seen.rows.map((r) => r.id)).toEqual([rows.A.mark]);
  });

  it('wrong tenant: SELECT/UPDATE/DELETE see nothing; INSERT is refused by WITH CHECK', async () => {
    for (const [table, id] of [
      ['exams', rows.A.exam],
      ['student_exam_marks', rows.A.mark],
      ['result_student_snapshots', rows.A.snapshot],
    ] as const) {
      const read = await asTenant('B', (c) =>
        c.query(`SELECT id FROM ${table} WHERE id = $1`, [id]),
      );
      expect(read.rowCount, table).toBe(0);
    }
    const upd = await asTenant('B', (c) =>
      c.query('UPDATE student_exam_marks SET marks_obtained = 1 WHERE id = $1', [rows.A.mark]),
    );
    expect(upd.rowCount).toBe(0);
    const del = await asTenant('B', (c) =>
      c.query('DELETE FROM student_exam_remarks WHERE exam_id = $1', [rows.A.exam]),
    );
    expect(del.rowCount).toBe(0);
    expect(
      await rejects(
        'B',
        `INSERT INTO exams (id, tenant_id, school_id, academic_year_id, name, start_date, end_date, created_by_user_id, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'Hijack', '2026-10-01', '2026-10-02', $4, now())`,
        [t.A.id, rows.A.school, rows.A.ac.yearId, USER],
      ),
    ).toMatch(/row-level security/);
    // Own tenant row pointing at another tenant's student → composite FK.
    expect(
      await rejects(
        'B',
        `INSERT INTO student_exam_marks (id, tenant_id, school_id, sheet_id, exam_subject_id, component_id, student_id, status, marks_obtained, updated_by_user_id, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'MARKED', 1, $7, now())`,
        [
          t.B.id,
          rows.B.school,
          rows.B.sheet,
          rows.B.subject,
          rows.B.component,
          rows.A.student,
          USER,
        ],
      ),
    ).toMatch(/foreign key|violates/);
  });

  it('grants: history and snapshots are append-only; marks/sheets never deleted; identity immutable', async () => {
    expect(
      await rejects('A', 'DELETE FROM student_exam_marks WHERE id = $1', [rows.A.mark]),
    ).toMatch(/permission denied/);
    expect(
      await rejects('A', 'DELETE FROM exam_mark_sheets WHERE id = $1', [rows.A.sheet]),
    ).toMatch(/permission denied/);
    expect(
      await rejects('A', 'UPDATE student_exam_mark_history SET to_marks = 1 WHERE id = $1', [
        rows.A.history,
      ]),
    ).toMatch(/permission denied/);
    expect(
      await rejects('A', 'DELETE FROM student_exam_mark_history WHERE id = $1', [rows.A.history]),
    ).toMatch(/permission denied/);
    expect(
      await rejects('A', "UPDATE result_student_snapshots SET outcome = 'FAIL' WHERE id = $1", [
        rows.A.snapshot,
      ]),
    ).toMatch(/permission denied/);
    expect(
      await rejects('A', 'DELETE FROM result_publications WHERE id = $1', [rows.A.publication]),
    ).toMatch(/permission denied/);
    expect(
      await rejects('A', 'UPDATE result_publications SET version = 9 WHERE id = $1', [
        rows.A.publication,
      ]),
    ).toMatch(/permission denied/);
    expect(
      await rejects('A', 'UPDATE student_exam_marks SET student_id = student_id WHERE id = $1', [
        rows.A.mark,
      ]),
    ).toMatch(/permission denied/);
    // A non-draft exam can never be deleted (restrictive policy → 0 rows, not an error).
    const del = await asTenant('A', (c) =>
      c.query('DELETE FROM exams WHERE id = $1', [rows.A.exam]),
    );
    expect(del.rowCount).toBe(0);
  });

  it('database invariants: marks ≤ max (trigger), state ↔ value, bands and schedules never overlap, one current publication', async () => {
    const setMark = (status: string, marks: string | null) =>
      rejects(
        'A',
        'UPDATE student_exam_marks SET status = $2::mark_status, marks_obtained = $3 WHERE id = $1',
        [rows.A.mark, status, marks],
      );
    expect(await setMark('MARKED', '50.01')).toMatch(/exceed/);
    expect(await setMark('MARKED', '-1')).toMatch(/student_exam_marks_non_negative/);
    expect(await setMark('ABSENT', '0')).toMatch(/student_exam_marks_state_value/);
    expect(await setMark('MARKED', null)).toMatch(/student_exam_marks_state_value/);
    expect(
      await rejects(
        'A',
        `INSERT INTO grade_bands (id, tenant_id, school_id, grade_scale_id, label, min_percentage, max_percentage, display_order)
        VALUES (gen_random_uuid(), $1, $2, $3, 'B', 60, 70, 1)`,
        [t.A.id, rows.A.school, rows.A.scale],
      ),
    ).toMatch(/grade_bands_no_overlap/);
    await asTenant('A', (c) =>
      c.query(
        `INSERT INTO exam_component_schedules (id, tenant_id, school_id, component_id, exam_id, grade_id, branch_id, exam_date, start_time, end_time, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, '2026-10-06', '09:00', '11:00', now())`,
        [
          t.A.id,
          rows.A.school,
          rows.A.component,
          rows.A.exam,
          rows.A.ac.gradeId,
          rows.A.ac.branchId,
        ],
      ),
    );
    const other = await prisma.examComponent.create({
      data: {
        tenantId: t.A.id,
        schoolId: rows.A.school,
        examSubjectId: rows.A.subject,
        examId: rows.A.exam,
        gradeId: rows.A.ac.gradeId,
        name: 'Oral',
        maxMarks: 10,
      },
    });
    expect(
      await rejects(
        'A',
        `INSERT INTO exam_component_schedules (id, tenant_id, school_id, component_id, exam_id, grade_id, branch_id, exam_date, start_time, end_time, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, '2026-10-06', '10:00', '12:00', now())`,
        [t.A.id, rows.A.school, other.id, rows.A.exam, rows.A.ac.gradeId, rows.A.ac.branchId],
      ),
    ).toMatch(/exam_component_schedules_no_overlap/);
    expect(
      await rejects(
        'A',
        `INSERT INTO result_publications (id, tenant_id, school_id, exam_id, version, is_current, school_name, exam_name, academic_year_name, published_by_user_id, published_at)
        VALUES (gen_random_uuid(), $1, $2, $3, 2, true, 'S', 'Mid', 'Y', $4, now())`,
        [t.A.id, rows.A.school, rows.A.exam, USER],
      ),
    ).toMatch(/result_publications_one_current/);
    expect(
      await rejects(
        'A',
        `INSERT INTO exam_mark_sheet_events (id, tenant_id, school_id, sheet_id, from_status, to_status, reason, actor_user_id)
        VALUES (gen_random_uuid(), $1, $2, $3, 'FINALIZED', 'REOPENED', 'no', $4)`,
        [t.A.id, rows.A.school, rows.A.sheet, USER],
      ),
    ).toMatch(/exam_mark_sheet_events_reopen_reason/);
  });

  it('same tenant, second school: composite FKs refuse cross-school links', async () => {
    const second = await prisma.school.create({
      data: { tenantId: t.A.id, name: 'Second', timezone: 'Asia/Kolkata', workingDays: ['MONDAY'] },
    });
    const other = await createAcademicFixture(prisma, t.A.id, second.id);
    // Sheet of school A's exam subject bound to school B's section.
    expect(
      await rejects(
        'A',
        `INSERT INTO exam_mark_sheets (id, tenant_id, school_id, exam_subject_id, exam_id, grade_id, academic_year_id, section_id, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now())`,
        [
          t.A.id,
          rows.A.school,
          rows.A.subject,
          rows.A.exam,
          rows.A.ac.gradeId,
          rows.A.ac.yearId,
          other.sectionA,
        ],
      ),
    ).toMatch(/foreign key|violates/);
    // An exam subject using the other school's subject.
    expect(
      await rejects(
        'A',
        `INSERT INTO exam_subjects (id, tenant_id, school_id, exam_id, academic_year_id, grade_id, subject_id, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())`,
        [t.A.id, rows.A.school, rows.A.exam, rows.A.ac.yearId, rows.A.ac.gradeId, other.mathId],
      ),
    ).toMatch(/foreign key|violates/);
  });
});
