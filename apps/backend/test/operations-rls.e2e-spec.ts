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

const PREFIX = 'OPRLS';
const TABLES = [
  'attendance_sessions',
  'attendance_records',
  'attendance_record_history',
  'homework',
  'assignments',
  'timetable_periods',
  'timetable_entries',
] as const;

interface Rows {
  school: string;
  ac: AcademicFixture;
  student: string;
  teacher: string;
  session: string;
  record: string;
  homework: string;
  draft: string;
  assignment: string;
  period: string;
  entry: string;
}

/**
 * Raw SQL as the restricted role `acadlyx_app` against the Phase 7 tables — no application code.
 * FORCE RLS (fail-closed), WITH CHECK, grants (append-only history, no attendance deletes,
 * draft-only deletes of class work), composite FKs across tenants and across schools of a tenant.
 */
describe('Row Level Security on Phase 7 operations tables (direct database tests)', () => {
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
      const teacher = await prisma.teacher.create({
        data: { ...scope, employeeId: 'R-T', firstName: 'Tee' },
      });
      const user = '00000000-0000-4000-8000-000000000001';
      const session = await prisma.attendanceSession.create({
        data: {
          ...scope,
          sectionId: ac.sectionA,
          academicYearId: ac.yearId,
          date: new Date('2026-09-01'),
          createdByUserId: user,
          updatedByUserId: user,
        },
      });
      const record = await prisma.attendanceRecord.create({
        data: { ...scope, sessionId: session.id, studentId: student.id, status: 'PRESENT' },
      });
      await prisma.attendanceRecordHistory.create({
        data: { ...scope, recordId: record.id, toStatus: 'PRESENT', changedByUserId: user },
      });
      const common = {
        ...scope,
        sectionId: ac.sectionA,
        subjectId: ac.mathId,
        title: 'T',
        assignedDate: new Date('2026-09-01'),
        dueDate: new Date('2026-09-02'),
        createdByUserId: user,
      };
      const homework = await prisma.homework.create({
        data: { ...common, status: 'PUBLISHED', publishedAt: new Date() },
      });
      const draft = await prisma.homework.create({ data: { ...common, status: 'DRAFT' } });
      const assignment = await prisma.assignment.create({
        data: { ...common, status: 'PUBLISHED', publishedAt: new Date() },
      });
      const period = await prisma.timetablePeriod.create({
        data: {
          ...scope,
          branchId: ac.branchId,
          academicYearId: ac.yearId,
          name: 'P1',
          type: 'INSTRUCTIONAL',
          startTime: new Date('1970-01-01T09:00:00Z'),
          endTime: new Date('1970-01-01T09:45:00Z'),
          displayOrder: 0,
        },
      });
      const [entry] = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO timetable_entries (id, tenant_id, school_id, branch_id, academic_year_id, section_id, period_id, period_type, start_time, end_time, weekday, subject_id, teacher_id, updated_at)
        VALUES (gen_random_uuid(), ${t[l].id}::uuid, ${schools[l]}::uuid, ${ac.branchId}::uuid, ${ac.yearId}::uuid, ${ac.sectionA}::uuid, ${period.id}::uuid, 'INSTRUCTIONAL', '09:00', '09:45', 'MONDAY', ${ac.mathId}::uuid, ${teacher.id}::uuid, now())
        RETURNING id`;
      rows[l] = {
        school: schools[l],
        ac,
        student: student.id,
        teacher: teacher.id,
        session: session.id,
        record: record.id,
        homework: homework.id,
        draft: draft.id,
        assignment: assignment.id,
        period: period.id,
        entry: entry?.id ?? '',
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

  it('every Phase 7 table has ENABLE + FORCE RLS and a tenant_isolation policy', async () => {
    const res = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string[];
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              array(SELECT polname::text FROM pg_policy p WHERE p.polrelid = c.oid ORDER BY polname) AS policies
         FROM pg_class c WHERE c.relname = ANY($1::text[])`,
      [[...TABLES]],
    );
    expect(res.rows).toHaveLength(TABLES.length);
    for (const r of res.rows) {
      expect(r, r.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      expect(r.policies, r.relname).toContain('tenant_isolation');
    }
  });

  it('fails closed without tenant context', async () => {
    for (const table of TABLES) {
      const res = await asTenant(null, (c) =>
        c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`),
      );
      expect(res.rows[0], table).toEqual({ n: 0 });
    }
  });

  it.each([
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'A'],
  ] as const)(
    'tenant %s sees only its own rows and cannot change tenant %s rows',
    async (me, other) => {
      const o = rows[other];
      await asTenant(me, async (c) => {
        for (const table of TABLES) {
          const theirs = await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
            [t[other].id],
          );
          expect(theirs.rows[0], table).toEqual({ n: 0 });
        }
        for (const [sql, id] of [
          ['UPDATE attendance_sessions SET version = version + 1 WHERE id = $1', o.session],
          ["UPDATE attendance_records SET status = 'ABSENT' WHERE id = $1", o.record],
          ["UPDATE homework SET title = 'pwned' WHERE id = $1", o.homework],
          ["UPDATE assignments SET title = 'pwned' WHERE id = $1", o.assignment],
          ["UPDATE timetable_periods SET name = 'pwned' WHERE id = $1", o.period],
          ["UPDATE timetable_entries SET weekday = 'TUESDAY' WHERE id = $1", o.entry],
          ['DELETE FROM homework WHERE id = $1', o.draft],
          ['DELETE FROM timetable_entries WHERE id = $1', o.entry],
        ] as [string, string][])
          expect((await c.query(sql, [id])).rowCount, sql).toBe(0);
      });
      expect((await prisma.homework.findUniqueOrThrow({ where: { id: o.homework } })).title).toBe(
        'T',
      );
      expect(await prisma.timetableEntry.count({ where: { id: o.entry } })).toBe(1);
    },
  );

  it('WITH CHECK and composite FKs refuse cross-tenant and cross-school references', async () => {
    const a = rows.A;
    const b = rows.B;
    const session =
      'INSERT INTO attendance_sessions (id, tenant_id, school_id, section_id, academic_year_id, date, created_by_user_id, updated_by_user_id, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, gen_random_uuid(), gen_random_uuid(), now())';
    expect(
      await rejects('A', session, [t.B.id, b.school, b.ac.sectionB, b.ac.yearId, '2026-09-02']),
    ).toMatch(/row-level security/);
    expect(
      await rejects('A', session, [t.A.id, a.school, b.ac.sectionB, b.ac.yearId, '2026-09-02']),
    ).toMatch(/foreign key/);
    expect(
      await rejects(
        'A',
        'INSERT INTO attendance_records (id, tenant_id, school_id, session_id, student_id, status, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())',
        [t.A.id, a.school, a.session, b.student, 'PRESENT'],
      ),
    ).toMatch(/foreign key/);
    const hw =
      "INSERT INTO homework (id, tenant_id, school_id, section_id, subject_id, title, assigned_date, due_date, created_by_user_id, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'x', '2026-09-01', '2026-09-02', gen_random_uuid(), now())";
    expect(await rejects('A', hw, [t.A.id, a.school, a.ac.sectionA, b.ac.mathId])).toMatch(
      /foreign key/,
    );
    // Same tenant, second school.
    const second = await prisma.school.create({
      data: { tenantId: t.A.id, name: 'Second', timezone: 'UTC', workingDays: ['MONDAY'] },
    });
    const other = await prisma.subject.create({
      data: { tenantId: t.A.id, schoolId: second.id, name: 'Other', code: 'OTH' },
    });
    try {
      expect(await rejects('A', hw, [t.A.id, a.school, a.ac.sectionA, other.id])).toMatch(
        /foreign key/,
      );
      expect(
        await rejects('A', session, [t.A.id, second.id, a.ac.sectionB, a.ac.yearId, '2026-09-03']),
      ).toMatch(/foreign key/);
    } finally {
      await prisma.subject.delete({ where: { id: other.id } });
      await prisma.school.delete({ where: { id: second.id } });
    }
  });

  it('grants: history append-only, attendance never deleted, only drafts deleted, scope columns immutable', async () => {
    const a = rows.A;
    expect(await rejects('A', "UPDATE attendance_record_history SET to_status = 'ABSENT'")).toMatch(
      /permission denied/,
    );
    expect(await rejects('A', 'DELETE FROM attendance_record_history')).toMatch(
      /permission denied/,
    );
    expect(await rejects('A', 'DELETE FROM attendance_records')).toMatch(/permission denied/);
    expect(await rejects('A', 'DELETE FROM attendance_sessions')).toMatch(/permission denied/);
    for (const sql of [
      'UPDATE attendance_sessions SET section_id = section_id',
      'UPDATE attendance_sessions SET date = date',
      'UPDATE attendance_records SET student_id = student_id',
      'UPDATE homework SET section_id = section_id',
      'UPDATE assignments SET created_by_user_id = created_by_user_id',
      'UPDATE timetable_periods SET branch_id = branch_id',
      'UPDATE timetable_entries SET section_id = section_id',
    ])
      expect(await rejects('A', sql), sql).toMatch(/permission denied/);
    await asTenant('A', async (c) => {
      expect((await c.query('DELETE FROM homework WHERE id = $1', [a.homework])).rowCount).toBe(0); // published
      expect(
        (await c.query('DELETE FROM assignments WHERE id = $1', [a.assignment])).rowCount,
      ).toBe(0);
      expect((await c.query('DELETE FROM homework WHERE id = $1', [a.draft])).rowCount).toBe(1);
    });
    expect(await prisma.homework.count({ where: { id: a.homework } })).toBe(1);
  });

  it('database invariants: one session per class+date, one record per student, instructional-only lessons, no teacher double-booking', async () => {
    const a = rows.A;
    expect(
      await rejects(
        'A',
        'INSERT INTO attendance_sessions (id, tenant_id, school_id, section_id, academic_year_id, date, created_by_user_id, updated_by_user_id, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, gen_random_uuid(), gen_random_uuid(), now())',
        [t.A.id, a.school, a.ac.sectionA, a.ac.yearId, '2026-09-01'],
      ),
    ).toMatch(/attendance_sessions_section_id_date_key/);
    expect(
      await rejects(
        'A',
        "INSERT INTO attendance_records (id, tenant_id, school_id, session_id, student_id, status, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ABSENT', now())",
        [t.A.id, a.school, a.session, a.student],
      ),
    ).toMatch(/attendance_records_session_id_student_id_key/);
    const entry =
      "INSERT INTO timetable_entries (id, tenant_id, school_id, branch_id, academic_year_id, section_id, period_id, period_type, start_time, end_time, weekday, subject_id, teacher_id, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'INSTRUCTIONAL', '09:00', '09:45', 'MONDAY', $7, $8, now())";
    expect(
      await rejects('A', entry, [
        t.A.id,
        a.school,
        a.ac.branchId,
        a.ac.yearId,
        a.ac.sectionB,
        a.period,
        a.ac.mathId,
        a.teacher,
      ]),
    ).toMatch(/timetable_entries_teacher_no_overlap/);
    expect(
      await rejects(
        'A',
        "UPDATE homework SET status = 'PUBLISHED', published_at = NULL WHERE id = $1",
        [a.homework],
      ),
    ).toMatch(/homework_published_at_set/);
  });
});
