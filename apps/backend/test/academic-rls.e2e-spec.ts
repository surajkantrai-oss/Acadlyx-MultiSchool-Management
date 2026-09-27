import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfigService } from '../src/config/app-config.service.js';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  createFixtureSchools,
  createFixtureTenants,
  FIXTURE_LETTERS,
  type FixtureLetter,
  type FixtureTenant,
  purgeTenants,
} from './helpers/tenant-fixtures.js';

const PREFIX = 'ACRLS';

const ACADEMIC_TABLES = [
  'schools',
  'branches',
  'academic_years',
  'grades',
  'sections',
  'subjects',
  'grade_subjects',
] as const;

interface Rows {
  school: string;
  branch: string;
  year: string;
  grade: string;
  section: string;
  subject: string;
  gradeSubject: string;
}

/**
 * Raw SQL as the restricted role `acadlyx_app` against the Phase 4 tables — no application code
 * involved. Proves FORCE RLS, WITH CHECK, grants (no DELETE except the mapping, no INSERT on
 * schools, immutable scope columns) and composite (id, school_id, tenant_id) foreign keys.
 */
describe('Row Level Security on Phase 4 academic tables (direct database tests)', () => {
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

  /** Runs one statement expecting a PostgreSQL error; returns its message. */
  async function rejects(
    tenant: FixtureLetter,
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
      const branch = await prisma.branch.create({
        data: { ...scope, name: `B ${l}`, code: 'MAIN', timezone: 'Asia/Kolkata', isPrimary: true },
      });
      const year = await prisma.academicYear.create({
        data: {
          ...scope,
          name: '2026-27',
          startDate: new Date('2026-04-01'),
          endDate: new Date('2027-03-31'),
        },
      });
      const grade = await prisma.grade.create({
        data: { ...scope, name: 'Grade 1', code: 'G1', displayOrder: 0 },
      });
      const section = await prisma.section.create({
        data: {
          ...scope,
          branchId: branch.id,
          academicYearId: year.id,
          gradeId: grade.id,
          name: 'A',
          code: 'A',
          displayOrder: 0,
        },
      });
      const subject = await prisma.subject.create({
        data: { ...scope, name: 'English', code: 'ENG' },
      });
      const gs = await prisma.gradeSubject.create({
        data: { ...scope, gradeId: grade.id, subjectId: subject.id },
      });
      rows[l] = {
        school: schools[l],
        branch: branch.id,
        year: year.id,
        grade: grade.id,
        section: section.id,
        subject: subject.id,
        gradeSubject: gs.id,
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

  it('every Phase 4 table has ENABLE + FORCE RLS and a tenant_isolation policy', async () => {
    const res = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string[];
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              array(SELECT polname::text FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c WHERE c.relname = ANY($1::text[])`,
      [[...ACADEMIC_TABLES]],
    );
    expect(res.rows).toHaveLength(ACADEMIC_TABLES.length);
    for (const r of res.rows) {
      expect(r, r.relname).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        policies: ['tenant_isolation'],
      });
    }
  });

  it('fails closed without tenant context', async () => {
    for (const table of ACADEMIC_TABLES) {
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
      await asTenant(me, async (c) => {
        for (const table of ACADEMIC_TABLES) {
          const own = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
          expect(own.rows[0]?.n, `${table} own`).toBe(1);
          const theirs = await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
            [t[other].id],
          );
          expect(theirs.rows[0], `${table} other`).toEqual({ n: 0 });
        }
        const o = rows[other];
        const updates: [string, string][] = [
          ['UPDATE schools SET name = $1 WHERE id = $2', o.school],
          ['UPDATE branches SET name = $1 WHERE id = $2', o.branch],
          ['UPDATE academic_years SET name = $1 WHERE id = $2', o.year],
          ['UPDATE grades SET name = $1 WHERE id = $2', o.grade],
          ['UPDATE sections SET name = $1 WHERE id = $2', o.section],
          ['UPDATE subjects SET name = $1 WHERE id = $2', o.subject],
        ];
        for (const [sql, id] of updates)
          expect((await c.query(sql, ['pwned', id])).rowCount, sql).toBe(0);
        expect(
          (await c.query('DELETE FROM grade_subjects WHERE id = $1', [o.gradeSubject])).rowCount,
        ).toBe(0);
      });
      expect(
        (await prisma.school.findUniqueOrThrow({ where: { id: rows[other].school } })).name,
      ).not.toBe('pwned');
      expect(await prisma.gradeSubject.count({ where: { id: rows[other].gradeSubject } })).toBe(1);
    },
  );

  it('WITH CHECK refuses rows for another tenant; composite FKs refuse cross-tenant links', async () => {
    const a = rows.A;
    const b = rows.B;
    // Another tenant's tenant_id → RLS WITH CHECK.
    expect(
      await rejects(
        'A',
        "INSERT INTO subjects (id, tenant_id, school_id, name, code, updated_at) VALUES (gen_random_uuid(), $1, $2, 'X', 'X', now())",
        [t.B.id, b.school],
      ),
    ).toMatch(/row-level security/);
    // Own tenant_id but another tenant's parent ids → composite FK (and the parent is invisible).
    expect(
      await rejects(
        'A',
        "INSERT INTO subjects (id, tenant_id, school_id, name, code, updated_at) VALUES (gen_random_uuid(), $1, $2, 'X', 'X', now())",
        [t.A.id, b.school],
      ),
    ).toMatch(/foreign key/);
    expect(
      await rejects(
        'A',
        "INSERT INTO sections (id, tenant_id, school_id, branch_id, academic_year_id, grade_id, name, code, display_order, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'X', 'X', 9, now())",
        [t.A.id, a.school, b.branch, a.year, a.grade],
      ),
    ).toMatch(/foreign key/);
    expect(
      await rejects(
        'A',
        'INSERT INTO grade_subjects (id, tenant_id, school_id, grade_id, subject_id, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, now())',
        [t.A.id, a.school, a.grade, b.subject],
      ),
    ).toMatch(/foreign key/);
  });

  it('composite FKs also refuse links across two schools of the SAME tenant', async () => {
    // A second school in tenant A (the schema allows it; V1 UI uses one). Platform path only.
    const second = await prisma.school.create({
      data: { tenantId: t.A.id, name: 'Second', timezone: 'UTC', workingDays: ['MONDAY'] },
    });
    const grade2 = await prisma.grade.create({
      data: { tenantId: t.A.id, schoolId: second.id, name: 'G', code: 'G', displayOrder: 0 },
    });
    try {
      expect(
        await rejects(
          'A',
          "INSERT INTO sections (id, tenant_id, school_id, branch_id, academic_year_id, grade_id, name, code, display_order, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'X', 'X', 9, now())",
          [t.A.id, rows.A.school, rows.A.branch, rows.A.year, grade2.id],
        ),
      ).toMatch(/foreign key/);
    } finally {
      await prisma.grade.delete({ where: { id: grade2.id } });
      await prisma.school.delete({ where: { id: second.id } });
    }
  });

  it('grants: no INSERT on schools, no DELETE except grade_subjects, scope columns immutable', async () => {
    const a = rows.A;
    expect(
      await rejects(
        'A',
        "INSERT INTO schools (id, tenant_id, name, timezone, working_days, updated_at) VALUES (gen_random_uuid(), $1, 'X', 'UTC', '{MONDAY}', now())",
        [t.A.id],
      ),
    ).toMatch(/permission denied/);
    for (const table of [
      'schools',
      'branches',
      'academic_years',
      'grades',
      'sections',
      'subjects',
    ]) {
      expect(await rejects('A', `DELETE FROM ${table}`), table).toMatch(/permission denied/);
    }
    for (const [sql, params] of [
      ['UPDATE branches SET school_id = school_id', []],
      ['UPDATE sections SET branch_id = branch_id', []],
      ['UPDATE sections SET grade_id = grade_id', []],
      ['UPDATE sections SET academic_year_id = academic_year_id', []],
      ['UPDATE grades SET tenant_id = tenant_id', []],
      ['UPDATE schools SET id = id', []],
    ] as [string, unknown[]][]) {
      expect(await rejects('A', sql, params), sql).toMatch(/permission denied/);
    }
    // Allowed: normal column updates and mapping removal inside the own tenant.
    await asTenant('A', async (c) => {
      expect(
        (await c.query("UPDATE grades SET name = 'Grade One' WHERE id = $1", [a.grade])).rowCount,
      ).toBe(1);
      expect(
        (await c.query('SELECT id FROM schools WHERE id = $1 FOR UPDATE', [a.school])).rowCount,
      ).toBe(1);
    });
  });

  it('database invariants: one primary branch, one current (ACTIVE) year, no overlapping years, upper-case codes', async () => {
    const a = rows.A;
    expect(
      await rejects(
        'A',
        "INSERT INTO branches (id, tenant_id, school_id, name, code, timezone, is_primary, updated_at) VALUES (gen_random_uuid(), $1, $2, 'Two', 'TWO', 'UTC', true, now())",
        [t.A.id, a.school],
      ),
    ).toMatch(/branches_one_primary_per_school/);
    expect(
      await rejects('A', 'UPDATE branches SET is_active = false WHERE id = $1', [a.branch]),
    ).toMatch(/branches_primary_is_active/);
    expect(
      await rejects('A', 'UPDATE academic_years SET is_current = true WHERE id = $1', [a.year]),
    ).toMatch(/academic_years_current_is_active/);
    expect(
      await rejects(
        'A',
        "INSERT INTO academic_years (id, tenant_id, school_id, name, start_date, end_date, updated_at) VALUES (gen_random_uuid(), $1, $2, 'Overlap', '2027-03-31', '2028-03-30', now())",
        [t.A.id, a.school],
      ),
    ).toMatch(/academic_years_no_overlap/);
    expect(
      await rejects(
        'A',
        "INSERT INTO academic_years (id, tenant_id, school_id, name, start_date, end_date, updated_at) VALUES (gen_random_uuid(), $1, $2, 'Backwards', '2030-04-01', '2030-03-01', now())",
        [t.A.id, a.school],
      ),
    ).toMatch(/academic_years_dates_ordered/);
    expect(
      await rejects(
        'A',
        "INSERT INTO grades (id, tenant_id, school_id, name, code, display_order, updated_at) VALUES (gen_random_uuid(), $1, $2, 'x', 'lower', 5, now())",
        [t.A.id, a.school],
      ),
    ).toMatch(/grades_code_format/);
    expect(
      await rejects('A', 'UPDATE sections SET capacity = 0 WHERE id = $1', [a.section]),
    ).toMatch(/sections_capacity_positive/);
    // The same date range in ANOTHER tenant is fine (exclusion is per school).
    await asTenant('B', (c) =>
      c.query(
        "INSERT INTO academic_years (id, tenant_id, school_id, name, start_date, end_date, updated_at) VALUES (gen_random_uuid(), $1, $2, 'Other', '2030-04-01', '2031-03-31', now())",
        [t.B.id, rows.B.school],
      ),
    );
    await asTenant('A', (c) =>
      c.query(
        "INSERT INTO academic_years (id, tenant_id, school_id, name, start_date, end_date, updated_at) VALUES (gen_random_uuid(), $1, $2, 'Other', '2030-04-01', '2031-03-31', now())",
        [t.A.id, a.school],
      ),
    );
  });
});
