import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfigService } from '../src/config/app-config.service.js';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  createAcademicFixture,
  createFixtureSchools,
  createFixtureTenants,
  FIXTURE_LETTERS,
  type FixtureLetter,
  type FixtureTenant,
  purgeTenants,
} from './helpers/tenant-fixtures.js';

const PREFIX = 'SUBRLS';
const TABLES = ['assignment_submissions', 'assignment_submission_history'] as const;
const USER = '00000000-0000-4000-8000-000000000001';

interface Rows {
  school: string;
  student: string;
  assignment: string;
  submission: string;
  history: string;
}

/**
 * Raw SQL as the restricted role `acadlyx_app` against the Phase 8 submission tables — no
 * application code: FORCE RLS (fail closed), WITH CHECK, least-privilege grants (no deletes,
 * append-only history, immutable identity columns), content CHECKs (HTTPS only, not empty),
 * one row per assignment + student, and composite FKs across tenants and schools.
 */
describe('Row Level Security on Phase 8 submission tables (direct database tests)', () => {
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
        data: { ...scope, admissionNumber: 'S-1', firstName: 'Kid' },
      });
      const assignment = await prisma.assignment.create({
        data: {
          ...scope,
          sectionId: ac.sectionA,
          subjectId: ac.mathId,
          title: 'Essay',
          assignedDate: new Date('2026-09-01'),
          dueDate: new Date('2026-09-10'),
          status: 'PUBLISHED',
          publishedAt: new Date(),
          createdByUserId: USER,
        },
      });
      const now = new Date();
      const submission = await prisma.assignmentSubmission.create({
        data: {
          ...scope,
          assignmentId: assignment.id,
          studentId: student.id,
          textContent: 'Answer',
          firstSubmittedAt: now,
          lastSubmittedAt: now,
        },
      });
      const history = await prisma.assignmentSubmissionHistory.create({
        data: {
          ...scope,
          submissionId: submission.id,
          version: 1,
          textContent: 'Answer',
          submittedAt: now,
          submittedByUserId: USER,
        },
      });
      rows[l] = {
        school: schools[l],
        student: student.id,
        assignment: assignment.id,
        submission: submission.id,
        history: history.id,
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

  it('both tables have ENABLE + FORCE RLS and a tenant_isolation policy', async () => {
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

  it('fails closed without tenant context; each tenant sees only its own rows', async () => {
    for (const table of TABLES) {
      const none = await asTenant(null, (c) =>
        c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`),
      );
      expect(none.rows[0], table).toEqual({ n: 0 });
    }
    for (const l of FIXTURE_LETTERS) {
      const seen = await asTenant(l, (c) =>
        c.query<{ id: string }>('SELECT id FROM assignment_submissions'),
      );
      expect(seen.rows.map((r) => r.id)).toEqual([rows[l].submission]);
    }
  });

  it('wrong tenant: SELECT sees nothing, UPDATE touches nothing, INSERT is refused', async () => {
    const read = await asTenant('B', (c) =>
      c.query('SELECT id FROM assignment_submissions WHERE id = $1', [rows.A.submission]),
    );
    expect(read.rowCount).toBe(0);
    const upd = await asTenant('B', (c) =>
      c.query("UPDATE assignment_submissions SET text_content = 'hijack' WHERE id = $1", [
        rows.A.submission,
      ]),
    );
    expect(upd.rowCount).toBe(0);
    // Row claims tenant A while the context is B → WITH CHECK refuses it.
    expect(
      await rejects(
        'B',
        `INSERT INTO assignment_submissions (id, tenant_id, school_id, assignment_id, student_id, text_content, first_submitted_at, last_submitted_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'x', now(), now(), now())`,
        [t.A.id, rows.A.school, rows.A.assignment, rows.A.student],
      ),
    ).toMatch(/row-level security/);
    // Own tenant row pointing at another tenant's assignment/student → composite FK.
    expect(
      await rejects(
        'B',
        `INSERT INTO assignment_submissions (id, tenant_id, school_id, assignment_id, student_id, text_content, first_submitted_at, last_submitted_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'x', now(), now(), now())`,
        [t.B.id, rows.B.school, rows.A.assignment, rows.B.student],
      ),
    ).toMatch(/foreign key|violates/);
  });

  it('grants: no deletes; identity columns immutable; history append-only', async () => {
    expect(
      await rejects('A', 'DELETE FROM assignment_submissions WHERE id = $1', [rows.A.submission]),
    ).toMatch(/permission denied/);
    expect(
      await rejects(
        'A',
        'UPDATE assignment_submissions SET student_id = student_id WHERE id = $1',
        [rows.A.submission],
      ),
    ).toMatch(/permission denied/);
    expect(
      await rejects(
        'A',
        'UPDATE assignment_submissions SET first_submitted_at = now() WHERE id = $1',
        [rows.A.submission],
      ),
    ).toMatch(/permission denied/);
    expect(
      await rejects(
        'A',
        "UPDATE assignment_submission_history SET text_content = 'x' WHERE id = $1",
        [rows.A.history],
      ),
    ).toMatch(/permission denied/);
    expect(
      await rejects('A', 'DELETE FROM assignment_submission_history WHERE id = $1', [
        rows.A.history,
      ]),
    ).toMatch(/permission denied/);
  });

  it('database invariants: one row per assignment + student; HTTPS only; never empty', async () => {
    const insert = (text: string | null, url: string | null) =>
      rejects(
        'A',
        `INSERT INTO assignment_submissions (id, tenant_id, school_id, assignment_id, student_id, text_content, external_url, first_submitted_at, last_submitted_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now(), now(), now())`,
        [t.A.id, rows.A.school, rows.A.assignment, rows.A.student, text, url],
      );
    expect(await insert('Again', null)).toMatch(
      /assignment_submissions_assignment_id_student_id_key/,
    );
    const other = await prisma.student.create({
      data: { tenantId: t.A.id, schoolId: rows.A.school, admissionNumber: 'S-2', firstName: 'Two' },
    });
    const forOther = (text: string | null, url: string | null) =>
      rejects(
        'A',
        `INSERT INTO assignment_submissions (id, tenant_id, school_id, assignment_id, student_id, text_content, external_url, first_submitted_at, last_submitted_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now(), now(), now())`,
        [t.A.id, rows.A.school, rows.A.assignment, other.id, text, url],
      );
    expect(await forOther(null, null)).toMatch(/assignment_submissions_content_present/);
    expect(await forOther('   ', null)).toMatch(/assignment_submissions/);
    for (const url of [
      'http://e.com',
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///x',
      'ftp://e.com',
    ])
      expect(await forOther(null, url), url).toMatch(/assignment_submissions_url_https/);
    expect(await forOther('x'.repeat(5001), null)).toMatch(/too long|value too long/);
  });

  it('same tenant, second school: composite FKs refuse a cross-school submission', async () => {
    const second = await prisma.school.create({
      data: { tenantId: t.A.id, name: 'Second', timezone: 'Asia/Kolkata', workingDays: ['MONDAY'] },
    });
    const kid = await prisma.student.create({
      data: { tenantId: t.A.id, schoolId: second.id, admissionNumber: 'S-X', firstName: 'X' },
    });
    try {
      // School-A assignment with a school-B student (and vice versa via the school column).
      expect(
        await rejects(
          'A',
          `INSERT INTO assignment_submissions (id, tenant_id, school_id, assignment_id, student_id, text_content, first_submitted_at, last_submitted_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'x', now(), now(), now())`,
          [t.A.id, rows.A.school, rows.A.assignment, kid.id],
        ),
      ).toMatch(/foreign key|violates/);
      expect(
        await rejects(
          'A',
          `INSERT INTO assignment_submissions (id, tenant_id, school_id, assignment_id, student_id, text_content, first_submitted_at, last_submitted_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'x', now(), now(), now())`,
          [t.A.id, second.id, rows.A.assignment, kid.id],
        ),
      ).toMatch(/foreign key|violates/);
    } finally {
      await prisma.student.delete({ where: { id: kid.id } });
    }
  });
});
