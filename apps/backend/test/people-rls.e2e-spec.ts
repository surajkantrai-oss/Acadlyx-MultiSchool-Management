import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfigService } from '../src/config/app-config.service.js';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import { createTenantUser } from './helpers/auth.js';
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

const PREFIX = 'PPRLS';

const PEOPLE_TABLES = [
  'students',
  'student_status_history',
  'parents',
  'student_guardians',
  'teachers',
  'student_enrollments',
  'teacher_assignments',
  'bulk_import_jobs',
  'bulk_import_rows',
] as const;

interface Rows {
  school: string;
  ac: AcademicFixture;
  user: string;
  student: string;
  parent: string;
  guardian: string;
  teacher: string;
  enrollment: string;
  assignment: string;
  job: string;
  row: string;
}

/**
 * Raw SQL as the restricted role `acadlyx_app` against the Phase 5 tables — no application code.
 * Proves FORCE RLS (fail-closed), WITH CHECK, grants (no DELETE except guardians, append-only
 * status history, immutable scope/identity columns), composite FKs across tenants AND across
 * schools of one tenant, profile→User same-tenant FK, partial-unique invariants and the
 * SECURITY DEFINER account function's guards.
 */
describe('Row Level Security on Phase 5 people tables (direct database tests)', () => {
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

  const insertStudent =
    "INSERT INTO students (id, tenant_id, school_id, admission_number, first_name, updated_at, user_id) VALUES (gen_random_uuid(), $1, $2, $3, 'X', now(), $4)";

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    t = await createFixtureTenants(prisma, PREFIX);
    const schools = await createFixtureSchools(prisma, t);
    for (const l of FIXTURE_LETTERS) {
      const tenantId = t[l].id;
      const scope = { tenantId, schoolId: schools[l] };
      const ac = await createAcademicFixture(prisma, tenantId, schools[l]);
      const user = await createTenantUser(app, {
        tenantId,
        roles: ['STUDENT'],
        loginId: 'S1',
        loginIdKind: 'STUDENT_ID',
      });
      const student = await prisma.student.create({
        data: { ...scope, admissionNumber: 'ADM-1', firstName: 'Kid' },
      });
      await prisma.studentStatusHistory.create({
        data: { ...scope, studentId: student.id, toStatus: 'ACTIVE' },
      });
      const parent = await prisma.parent.create({
        data: { ...scope, parentCode: 'P-1', firstName: 'Parent' },
      });
      const guardian = await prisma.studentGuardian.create({
        data: {
          ...scope,
          studentId: student.id,
          parentId: parent.id,
          relationship: 'MOTHER',
          isPrimary: true,
        },
      });
      const teacher = await prisma.teacher.create({
        data: { ...scope, employeeId: 'E-1', firstName: 'Teach' },
      });
      const enrollment = await prisma.studentEnrollment.create({
        data: {
          ...scope,
          studentId: student.id,
          sectionId: ac.sectionA,
          academicYearId: ac.yearId,
          startDate: new Date('2026-04-01'),
        },
      });
      const assignment = await prisma.teacherAssignment.create({
        data: { ...scope, teacherId: teacher.id, sectionId: ac.sectionA, type: 'CLASS_TEACHER' },
      });
      const job = await prisma.bulkImportJob.create({
        data: {
          ...scope,
          type: 'PARENTS',
          templateVersion: 1,
          originalFilename: 'p.csv',
          fileHash: 'a'.repeat(64),
          createdByUserId: user,
          status: 'READY',
        },
      });
      const row = await prisma.bulkImportRow.create({
        data: { ...scope, jobId: job.id, rowNumber: 2, status: 'VALID', data: { first_name: 'X' } },
      });
      rows[l] = {
        school: schools[l],
        ac,
        user,
        student: student.id,
        parent: parent.id,
        guardian: guardian.id,
        teacher: teacher.id,
        enrollment: enrollment.id,
        assignment: assignment.id,
        job: job.id,
        row: row.id,
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

  it('every Phase 5 table has ENABLE + FORCE RLS and a tenant_isolation policy', async () => {
    const res = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string[];
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              array(SELECT polname::text FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c WHERE c.relname = ANY($1::text[])`,
      [[...PEOPLE_TABLES]],
    );
    expect(res.rows).toHaveLength(PEOPLE_TABLES.length);
    for (const r of res.rows)
      expect(r, r.relname).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        policies: ['tenant_isolation'],
      });
  });

  it('fails closed without tenant context (reads and writes)', async () => {
    for (const table of PEOPLE_TABLES) {
      const res = await asTenant(null, (c) =>
        c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`),
      );
      expect(res.rows[0], table).toEqual({ n: 0 });
    }
    expect(await rejects(null, insertStudent, [t.A.id, rows.A.school, 'NOCTX', null])).toMatch(
      /row-level security/,
    );
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
        for (const table of PEOPLE_TABLES) {
          const own = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
          expect(own.rows[0]?.n, `${table} own`).toBe(1);
          const theirs = await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
            [t[other].id],
          );
          expect(theirs.rows[0], `${table} other`).toEqual({ n: 0 });
        }
        const updates: [string, string][] = [
          ["UPDATE students SET first_name = 'pwned' WHERE id = $1", o.student],
          ["UPDATE parents SET first_name = 'pwned' WHERE id = $1", o.parent],
          ["UPDATE teachers SET first_name = 'pwned' WHERE id = $1", o.teacher],
          ['UPDATE student_guardians SET is_primary = false WHERE id = $1', o.guardian],
          [
            "UPDATE student_enrollments SET status = 'WITHDRAWN', end_date = '2026-05-01' WHERE id = $1",
            o.enrollment,
          ],
          ['UPDATE teacher_assignments SET ended_at = now() WHERE id = $1', o.assignment],
          ["UPDATE bulk_import_jobs SET status = 'CANCELLED' WHERE id = $1", o.job],
          ["UPDATE bulk_import_rows SET status = 'FAILED' WHERE id = $1", o.row],
        ];
        for (const [sql, id] of updates) expect((await c.query(sql, [id])).rowCount, sql).toBe(0);
        expect(
          (await c.query('DELETE FROM student_guardians WHERE id = $1', [o.guardian])).rowCount,
        ).toBe(0);
      });
      expect((await prisma.student.findUniqueOrThrow({ where: { id: o.student } })).firstName).toBe(
        'Kid',
      );
      expect(
        (await prisma.studentEnrollment.findUniqueOrThrow({ where: { id: o.enrollment } })).status,
      ).toBe('ACTIVE');
      expect(await prisma.studentGuardian.count({ where: { id: o.guardian } })).toBe(1);
    },
  );

  it('WITH CHECK refuses another tenant id; composite FKs refuse cross-tenant links', async () => {
    const a = rows.A;
    const b = rows.B;
    expect(await rejects('A', insertStudent, [t.B.id, b.school, 'X1', null])).toMatch(
      /row-level security/,
    );
    expect(await rejects('A', insertStudent, [t.A.id, b.school, 'X2', null])).toMatch(
      /foreign key/,
    );
    // Profile → User must be the same tenant (composite FK), never another tenant's login.
    expect(await rejects('A', insertStudent, [t.A.id, a.school, 'X3', b.user])).toMatch(
      /foreign key/,
    );
    const guardian =
      "INSERT INTO student_guardians (id, tenant_id, school_id, student_id, parent_id, relationship, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'OTHER', now())";
    expect(await rejects('A', guardian, [t.A.id, a.school, a.student, b.parent])).toMatch(
      /foreign key/,
    );
    const enroll =
      "INSERT INTO student_enrollments (id, tenant_id, school_id, student_id, section_id, academic_year_id, start_date, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '2026-04-01', now())";
    expect(
      await rejects('A', enroll, [t.A.id, a.school, a.student, b.ac.sectionB, b.ac.yearId]),
    ).toMatch(/foreign key/);
    // Section and academic year must agree (denormalised year kept honest by the composite FK).
    expect(
      await rejects('A', enroll, [t.A.id, a.school, a.student, a.ac.sectionB, a.ac.closedYearId]),
    ).toMatch(/foreign key/);
    const assign =
      "INSERT INTO teacher_assignments (id, tenant_id, school_id, teacher_id, section_id, subject_id, type, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'SUBJECT_TEACHER', now())";
    expect(
      await rejects('A', assign, [t.A.id, a.school, a.teacher, a.ac.sectionB, b.ac.mathId]),
    ).toMatch(/foreign key/);
    const importRow =
      "INSERT INTO bulk_import_rows (id, tenant_id, school_id, job_id, row_number, status) VALUES (gen_random_uuid(), $1, $2, $3, 3, 'VALID')";
    expect(await rejects('A', importRow, [t.A.id, a.school, b.job])).toMatch(/foreign key/);
  });

  it('composite FKs also refuse links across two schools of the SAME tenant', async () => {
    const second = await prisma.school.create({
      data: { tenantId: t.A.id, name: 'Second', timezone: 'UTC', workingDays: ['MONDAY'] },
    });
    const p2 = await prisma.parent.create({
      data: { tenantId: t.A.id, schoolId: second.id, firstName: 'Other school' },
    });
    try {
      expect(
        await rejects(
          'A',
          "INSERT INTO student_guardians (id, tenant_id, school_id, student_id, parent_id, relationship, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'OTHER', now())",
          [t.A.id, rows.A.school, rows.A.student, p2.id],
        ),
      ).toMatch(/foreign key/);
      expect(
        await rejects(
          'A',
          "INSERT INTO student_enrollments (id, tenant_id, school_id, student_id, section_id, academic_year_id, start_date, end_date, status, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '2026-04-01', '2026-05-01', 'COMPLETED', now())",
          [t.A.id, second.id, rows.A.student, rows.A.ac.sectionB, rows.A.ac.yearId],
        ),
      ).toMatch(/foreign key/);
    } finally {
      await prisma.parent.delete({ where: { id: p2.id } });
      await prisma.school.delete({ where: { id: second.id } });
    }
  });

  it('grants: no DELETE except guardians, status history append-only, scope/identity columns immutable, no raw INSERT on users', async () => {
    for (const table of PEOPLE_TABLES.filter((x) => x !== 'student_guardians'))
      expect(await rejects('A', `DELETE FROM ${table}`), table).toMatch(/permission denied/);
    for (const sql of [
      "UPDATE student_status_history SET reason = 'x'",
      'UPDATE students SET tenant_id = tenant_id',
      'UPDATE students SET school_id = school_id',
      'UPDATE parents SET school_id = school_id',
      'UPDATE teachers SET tenant_id = tenant_id',
      'UPDATE student_guardians SET student_id = student_id',
      'UPDATE student_guardians SET parent_id = parent_id',
      'UPDATE student_enrollments SET section_id = section_id',
      'UPDATE student_enrollments SET student_id = student_id',
      'UPDATE teacher_assignments SET teacher_id = teacher_id',
      'UPDATE teacher_assignments SET subject_id = subject_id',
      'UPDATE bulk_import_jobs SET created_by_user_id = created_by_user_id',
      'UPDATE bulk_import_rows SET job_id = job_id',
    ])
      expect(await rejects('A', sql), sql).toMatch(/permission denied/);
    expect(
      await rejects(
        'A',
        "INSERT INTO users (id, tenant_id, display_name, status, updated_at) VALUES (gen_random_uuid(), $1, 'x', 'ACTIVE', now())",
        [t.A.id],
      ),
    ).toMatch(/permission denied/);
    // Allowed inside the own tenant: ordinary column updates and guardian unlink.
    await asTenant('A', async (c) => {
      expect(
        (
          await c.query("UPDATE students SET preferred_name = 'Kiddo' WHERE id = $1", [
            rows.A.student,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await c.query('UPDATE student_guardians SET pickup_authorized = true WHERE id = $1', [
            rows.A.guardian,
          ])
        ).rowCount,
      ).toBe(1);
    });
  });

  it('database invariants: one ACTIVE enrollment per year, one primary guardian, one class teacher, school-unique codes, formats', async () => {
    const a = rows.A;
    expect(
      await rejects(
        'A',
        "INSERT INTO student_enrollments (id, tenant_id, school_id, student_id, section_id, academic_year_id, start_date, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '2026-04-01', now())",
        [t.A.id, a.school, a.student, a.ac.sectionB, a.ac.yearId],
      ),
    ).toMatch(/student_enrollments_one_active_per_year/);
    const p2 = await asTenant('A', (c) =>
      c.query<{ id: string }>(
        "INSERT INTO parents (id, tenant_id, school_id, first_name, updated_at) VALUES (gen_random_uuid(), $1, $2, 'Second', now()) RETURNING id",
        [t.A.id, a.school],
      ),
    );
    expect(
      await rejects(
        'A',
        "INSERT INTO student_guardians (id, tenant_id, school_id, student_id, parent_id, relationship, is_primary, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'FATHER', true, now())",
        [t.A.id, a.school, a.student, p2.rows[0]?.id],
      ),
    ).toMatch(/student_guardians_one_primary/);
    expect(
      await rejects(
        'A',
        "INSERT INTO teacher_assignments (id, tenant_id, school_id, teacher_id, section_id, type, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'CLASS_TEACHER', now())",
        [t.A.id, a.school, a.teacher, a.ac.sectionA],
      ),
    ).toMatch(/teacher_assignments_one_class_teacher/);
    expect(
      await rejects(
        'A',
        "INSERT INTO teacher_assignments (id, tenant_id, school_id, teacher_id, section_id, type, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'SUBJECT_TEACHER', now())",
        [t.A.id, a.school, a.teacher, a.ac.sectionB],
      ),
    ).toMatch(/subject/);
    expect(await rejects('A', insertStudent, [t.A.id, a.school, 'ADM-1', null])).toMatch(
      /students_school_id_admission_number_key/,
    );
    expect(await rejects('A', insertStudent, [t.A.id, a.school, 'lower-case', null])).toMatch(
      /check constraint/,
    );
    expect(
      await rejects(
        'A',
        "INSERT INTO parents (id, tenant_id, school_id, parent_code, first_name, updated_at) VALUES (gen_random_uuid(), $1, $2, 'P-1', 'Dup', now())",
        [t.A.id, a.school],
      ),
    ).toMatch(/parents_school_parent_code_key/);
    expect(
      await rejects('A', "UPDATE parents SET email = 'Upper@Example.com' WHERE id = $1", [
        a.parent,
      ]),
    ).toMatch(/check constraint/);
    // The same codes in ANOTHER tenant are fine (uniqueness is per school).
    await asTenant('B', (c) => c.query(insertStudent, [t.B.id, rows.B.school, 'ADM-2', null]));
    await asTenant('A', (c) => c.query(insertStudent, [t.A.id, a.school, 'ADM-2', null]));
  });

  it('app_create_profile_account: needs tenant context, only STUDENT/PARENT/TEACHER, and writes only into the caller tenant', async () => {
    const call =
      'SELECT app_create_profile_account(gen_random_uuid(), gen_random_uuid(), $1, $2, NULL, NULL, NULL, $3)';
    expect(await rejects(null, call, ['X', 'x@acct.test', 'PARENT'])).toMatch(
      /tenant context required/,
    );
    for (const role of ['SCHOOL_ADMIN', 'PRINCIPAL', 'PLATFORM_SUPER_ADMIN'])
      expect(
        await rejects('A', call, ['X', `${role.toLowerCase()}@acct.test`, role]),
        role,
      ).toMatch(/cannot be granted/);
    await asTenant('A', (c) => c.query(call, ['Acct Parent', 'acct@acct.test', 'PARENT']));
    const created = await prisma.user.findFirstOrThrow({
      where: { email: 'acct@acct.test' },
      include: { roles: { include: { role: true } } },
    });
    expect(created).toMatchObject({
      tenantId: t.A.id,
      status: 'PENDING_ACTIVATION',
      credentialHash: null,
    });
    expect(created.roles.map((r) => r.role.key)).toEqual(['PARENT']);
  });
});
