import type { Paginated } from '@acadlyx/tenant-config';
import type { ImportJob, ImportRow, ImportTemplate, StudentDetail } from '@acadlyx/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { UnrecoverableError } from 'bullmq';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { ImportRunner } from '../src/tenant-api/imports/import-runner.js';
import { TenantContext } from '../src/tenancy/tenant-context.js';
import { createTestApp } from './helpers/app.js';
import { call, createTenantUser, resetRateLimits, syncRbac, tenantLogin } from './helpers/auth.js';
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

const PREFIX = 'IMP';
const PW = 'Import-pass-2026';

const PARENT_HEAD = 'parent_code,first_name,middle_name,last_name,email,phone';
const STUDENT_HEAD =
  'admission_number,first_name,middle_name,last_name,preferred_name,date_of_birth,admission_date,branch_code,academic_year,grade_code,section_code,guardian1_parent_code,guardian1_relationship,guardian1_primary,guardian1_pickup,guardian2_parent_code,guardian2_relationship,guardian2_primary,guardian2_pickup';

/**
 * Bulk onboarding (e2e, real BullMQ worker): upload → validate → preview → confirm → background
 * processing → result, plus file security, permissions, idempotency, tenant isolation of jobs and
 * worker context, and Redis outage behaviour.
 */
describe('Bulk import (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let school: Record<FixtureLetter, string>;
  const ac = {} as Record<FixtureLetter, AcademicFixture>;
  const token = {} as Record<FixtureLetter, string>;
  let aoToken = '';
  let teacherToken = '';

  const api = (l: FixtureLetter, bearer = token[l]) =>
    call(app, { host: t[l].domain, token: bearer });
  const upload = (
    l: FixtureLetter,
    type: string,
    name: string,
    content: string | Buffer,
    bearer = token[l],
  ) =>
    api(l, bearer)
      .post('/api/v1/imports')
      .field('type', type)
      .attach('file', Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), name);

  async function waitFor(
    l: FixtureLetter,
    id: string,
    statuses: string[] = ['COMPLETED', 'FAILED'],
  ): Promise<ImportJob> {
    for (let i = 0; i < 120; i += 1) {
      const job = (await api(l).get(`/api/v1/imports/${id}`).expect(200)).body as ImportJob;
      if (statuses.includes(job.status)) return job;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`import ${id} did not finish`);
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    await resetRateLimits(app);
    await syncRbac(app);
    t = await createFixtureTenants(prisma, PREFIX);
    school = await createFixtureSchools(prisma, t);
    for (const l of FIXTURE_LETTERS) {
      ac[l] = await createAcademicFixture(prisma, t[l].id, school[l]);
      const email = `principal@imp-${l.toLowerCase()}.test`;
      await createTenantUser(app, { tenantId: t[l].id, roles: ['PRINCIPAL'], email, secret: PW });
      token[l] = (await tenantLogin(app, t[l].domain, email, PW)).tokens.accessToken;
    }
    // Tenant B gets a branch code that does not exist in A (cross-tenant reference test).
    await prisma.branch.create({
      data: {
        tenantId: t.B.id,
        schoolId: school.B,
        name: 'Only B',
        code: 'ONLYB',
        timezone: 'UTC',
      },
    });
    await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['ADMISSION_OFFICER'],
      email: 'ao@imp-a.test',
      secret: PW,
    });
    aoToken = (await tenantLogin(app, t.A.domain, 'ao@imp-a.test', PW)).tokens.accessToken;
    await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['TEACHER'],
      email: 'teacher@imp-a.test',
      secret: PW,
    });
    teacherToken = (await tenantLogin(app, t.A.domain, 'teacher@imp-a.test', PW)).tokens
      .accessToken;
  }, 180_000);

  beforeEach(async () => {
    await resetRateLimits(app);
  });

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await app.close();
  });

  it('serves templates generated from the validation schema', async () => {
    const tpl = (await api('A').get('/api/v1/imports/templates/STUDENTS').expect(200))
      .body as ImportTemplate;
    expect(tpl.version).toBe(1);
    expect(tpl.columns.map((c) => c.name).join(',')).toBe(STUDENT_HEAD);
    const csv = await api('A').get('/api/v1/imports/templates/PARENTS/file?format=csv').expect(200);
    expect(csv.text.trim()).toBe(PARENT_HEAD);
    expect(csv.headers['content-disposition']).toMatch(
      /attachment; filename="acadlyx-parents-template-v1\.csv"/,
    );
    const xlsx = await api('A')
      .get('/api/v1/imports/templates/TEACHERS/file?format=xlsx')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          chunks.push(c);
        });
        res.on('end', () => {
          cb(null, Buffer.concat(chunks));
        });
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Data', 'Instructions']);
    expect(wb.getWorksheet('Data')?.getRow(1).values).toEqual([
      undefined,
      'employee_id',
      'first_name',
      'middle_name',
      'last_name',
      'email',
      'phone',
      'joining_date',
    ]);
    await api('A').get('/api/v1/imports/templates/FEES').expect(400);
  });

  it('parents: upload validates and previews WITHOUT creating anything; confirm processes in the background', async () => {
    const before = await prisma.parent.count({ where: { schoolId: school.A } });
    const csv = [
      PARENT_HEAD,
      'PAR-1,Meera,,Sharma,Meera@Example.com,98111 00001',
      'PAR-2,Arjun,,Sharma,,9811100001',
      ',NoCode,,Singh,,',
      'PAR-3,,,Missing,,',
      'PAR-1,Dup,,InFile,,',
      'PAR-4,Bad,,Email,not-an-email,',
    ].join('\n');
    const job = (await upload('A', 'PARENTS', 'parents.csv', csv).expect(201)).body as ImportJob;
    expect(job).toMatchObject({
      type: 'PARENTS',
      status: 'READY',
      totalRows: 6,
      validRows: 3,
      invalidRows: 3,
      processedRows: 0,
    });
    expect(await prisma.parent.count({ where: { schoolId: school.A } })).toBe(before); // nothing created yet
    const invalid = (
      await api('A').get(`/api/v1/imports/${job.id}/rows?status=INVALID`).expect(200)
    ).body as Paginated<ImportRow>;
    expect(invalid.items.map((r) => [r.rowNumber, r.errors[0]?.code])).toEqual([
      [5, 'REQUIRED'],
      [6, 'DUPLICATE_IN_FILE'],
      [7, 'INVALID_EMAIL'],
    ]);
    const valid = (await api('A').get(`/api/v1/imports/${job.id}/rows?status=VALID`).expect(200))
      .body as Paginated<ImportRow>;
    expect(valid.items[0]?.data).toMatchObject({
      parent_code: 'PAR-1',
      email: 'meera@example.com',
      phone: '+919811100001',
    });

    await api('A').post(`/api/v1/imports/${job.id}/confirm`).expect(200);
    const done = await waitFor('A', job.id);
    expect(done).toMatchObject({
      status: 'COMPLETED',
      processedRows: 3,
      succeededRows: 3,
      failedRows: 0,
    });
    expect(await prisma.parent.count({ where: { schoolId: school.A } })).toBe(before + 3);
    const succeeded = await prisma.bulkImportRow.findMany({
      where: { jobId: job.id, status: 'SUCCEEDED' },
    });
    expect(succeeded.every((r) => r.entityId && JSON.stringify(r.data) === '{}')).toBe(true); // data minimised
    await api('A').post(`/api/v1/imports/${job.id}/confirm`).expect(409); // already done
    // Re-uploading the same file: every keyed row is now a duplicate of existing data.
    const again = (await upload('A', 'PARENTS', 'parents.csv', csv).expect(201)).body as ImportJob;
    expect(again.validRows).toBe(1); // only the code-less row (codes are the only dedup key)
  });

  it('students: placements and guardian links resolve inside the school only; row errors are reported safely', async () => {
    await prisma.student.create({
      data: {
        tenantId: t.A.id,
        schoolId: school.A,
        admissionNumber: 'EXIST-1',
        firstName: 'Existing',
      },
    });
    const rows = [
      STUDENT_HEAD,
      'S-100,Aarav,,Sharma,,2016-05-01,,MAIN,2026–27,G5,A,PAR-1,MOTHER,yes,yes,PAR-2,FATHER,no,no',
      's-101,Diya,,Sharma,,2017-01-15,,main,2026–27,g5,b,PAR-1,MOTHER,no,no,,,,',
      'S-102,Kabir,,,,,,,,,,,,,,,,,',
      'EXIST-1,Dup,,,,,,,,,,,,,,,,,',
      'S-100,DupFile,,,,,,,,,,,,,,,,,',
      'S-103,Zed,,,,,,MAIN,2026–27,G5,Z,,,,,,,,',
      'S-104,Cross,,,,,,ONLYB,2026–27,G5,A,,,,,,,,',
      'S-105,Closed,,,,,,MAIN,2025–26,G5,A,,,,,,,,',
      'S-106,Half,,,,,,MAIN,,G5,A,,,,,,,,',
      'S-107,BadDob,,,,2016-02-30,,,,,,,,,,,,,',
      'S-108,NoParent,,,,,,,,,,PAR-404,MOTHER,no,no,,,,',
      'S-109,TwoPrimary,,,,,,,,,,PAR-1,MOTHER,yes,no,PAR-2,FATHER,yes,no',
      'S-110,=HYPERLINK("http://x"),,,,,,,,,,,,,,,,,',
    ].join('\r\n');
    const up = await upload('A', 'STUDENTS', 'students.csv', rows);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const job = up.body as ImportJob;
    expect(
      job,
      JSON.stringify(
        (
          (await api('A').get(`/api/v1/imports/${job.id}/rows?pageSize=50`))
            .body as Paginated<ImportRow>
        ).items.map((r) => [r.rowNumber, r.status, r.errors.map((e) => e.code)]),
      ),
    ).toMatchObject({ totalRows: 13, validRows: 4, invalidRows: 9 });
    const errs = (
      await api('A').get(`/api/v1/imports/${job.id}/rows?status=INVALID&pageSize=50`).expect(200)
    ).body as Paginated<ImportRow>;
    const codes = Object.fromEntries(
      errs.items.map((r) => [r.rowNumber, r.errors.map((e) => e.code)]),
    );
    expect(codes).toMatchObject({
      5: ['DUPLICATE_EXISTING'],
      6: ['DUPLICATE_IN_FILE'],
      7: ['UNKNOWN_SECTION'],
      8: ['UNKNOWN_SECTION'], // tenant B's branch code is never resolved from tenant A
      9: ['SECTION_UNAVAILABLE'],
      10: ['PLACEMENT_INCOMPLETE'],
      11: ['INVALID_DATE'],
      12: ['UNKNOWN_PARENT'],
      13: ['MULTIPLE_PRIMARY'],
    });
    expect(JSON.stringify(errs.items)).not.toMatch(/prisma|constraint|sql/i);
    // Error report: CSV with formula-injection protection.
    const report = await api('A').get(`/api/v1/imports/${job.id}/errors.csv`).expect(200);
    expect(report.headers['content-type']).toMatch(/text\/csv/);
    expect(report.text.split('\r\n')[0]).toBe('row_number,status,field,code,message');
    // RFC 4180: the message is quoted and its inner quotes doubled.
    expect(report.text).toContain('"Unknown section ""G5-Z (MAIN, 2026–27)"""');
    // Row 14 is valid text: a name starting with "=" is stored as data, never evaluated.
    await api('A').post(`/api/v1/imports/${job.id}/confirm`).expect(200);
    const done = await waitFor('A', job.id);
    expect(done).toMatchObject({ status: 'COMPLETED', succeededRows: 4, failedRows: 0 });
    const aarav = await prisma.student.findFirstOrThrow({
      where: { schoolId: school.A, admissionNumber: 'S-100' },
      include: { guardians: true, enrollments: true },
    });
    expect(
      aarav.guardians.map((g) => [g.relationship, g.isPrimary, g.pickupAuthorized]).sort(),
    ).toEqual([
      ['FATHER', false, false],
      ['MOTHER', true, true],
    ]);
    expect(aarav.enrollments.map((e) => [e.sectionId, e.status])).toEqual([
      [ac.A.sectionA, 'ACTIVE'],
    ]);
    const diya = (
      await api('A')
        .get(
          `/api/v1/students/${(await prisma.student.findFirstOrThrow({ where: { admissionNumber: 'S-101', schoolId: school.A } })).id}`,
        )
        .expect(200)
    ).body as StudentDetail;
    expect(diya.currentPlacement?.sectionName).toBe('B');
    const evil = await prisma.student.findFirstOrThrow({
      where: { schoolId: school.A, admissionNumber: 'S-110' },
    });
    expect(evil.firstName).toBe('=HYPERLINK("http://x")');
    const audits = await prisma.auditLog.findMany({
      where: { tenantId: t.A.id, metadata: { path: ['importJobId'], equals: job.id } },
    });
    expect(audits.filter((a) => a.action === 'STUDENT_CREATED')).toHaveLength(4);
    expect(new Set(audits.map((a) => a.action))).toEqual(
      new Set([
        'IMPORT_STARTED',
        'STUDENT_CREATED',
        'ENROLLMENT_CREATED',
        'GUARDIAN_LINKED',
        'IMPORT_COMPLETED',
      ]),
    );
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: t.A.id,
          resourceId: job.id,
          action: { in: ['IMPORT_UPLOADED', 'IMPORT_VALIDATED', 'IMPORT_CONFIRMED'] },
        },
      }),
    ).toBe(3);
  });

  it('xlsx: date cells become dates, formula cells are rejected (never evaluated)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow([
      'employee_id',
      'first_name',
      'middle_name',
      'last_name',
      'email',
      'phone',
      'joining_date',
    ]);
    ws.addRow([
      'X-1',
      'Ravi',
      null,
      'Kumar',
      'ravi@imp-a.test',
      '9876500001',
      new Date(Date.UTC(2024, 5, 1)),
    ]);
    ws.addRow(['X-2', { formula: 'CONCAT("A","B")', result: 'AB' }, null, null, null, null, null]);
    ws.addRow(['X-3', 'Asha', null, null, null, null, '2025-07-01']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const up = await upload('A', 'TEACHERS', 'teachers.xlsx', buf);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const job = up.body as ImportJob;
    expect(job).toMatchObject({ totalRows: 3, validRows: 2, invalidRows: 1 });
    const bad = (await api('A').get(`/api/v1/imports/${job.id}/rows?status=INVALID`).expect(200))
      .body as Paginated<ImportRow>;
    expect(bad.items[0]?.errors.map((e) => e.code)).toContain('FORMULA_NOT_ALLOWED');
    await api('A').post(`/api/v1/imports/${job.id}/confirm`).expect(200);
    await waitFor('A', job.id);
    const ravi = await prisma.teacher.findFirstOrThrow({
      where: { schoolId: school.A, employeeId: 'X-1' },
    });
    expect(ravi.joiningDate?.toISOString().slice(0, 10)).toBe('2024-06-01');
    expect(ravi.phone).toBe('+919876500001');
  });

  it('rejects unsafe or malformed files before anything is stored', async () => {
    const jobsBefore = await prisma.bulkImportJob.count({ where: { tenantId: t.A.id } });
    const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
    expect(code(await upload('A', 'PARENTS', 'p.txt', 'a,b').expect(400))).toBe('IMPORT_FILE_TYPE');
    expect(code(await upload('A', 'PARENTS', 'p.xlsx', 'not a zip').expect(400))).toBe(
      'IMPORT_FILE_UNREADABLE',
    );
    expect(
      code(
        await upload('A', 'PARENTS', 'p.csv', 'first_name,favourite_colour\nA,blue').expect(400),
      ),
    ).toBe('IMPORT_HEADERS_INVALID');
    expect(code(await upload('A', 'PARENTS', 'p.csv', PARENT_HEAD).expect(400))).toBe(
      'IMPORT_EMPTY',
    );
    expect(
      code(
        await upload('A', 'PARENTS', 'p.csv', Buffer.from([0xff, 0xfe, 0x00, 0x41])).expect(400),
      ),
    ).toBe('IMPORT_FILE_UNREADABLE');
    const many = [
      PARENT_HEAD,
      ...Array.from({ length: 5_001 }, (_, i) => `M-${String(i)},N${String(i)},,,,`),
    ].join('\n');
    expect(code(await upload('A', 'PARENTS', 'many.csv', many).expect(400))).toBe(
      'IMPORT_TOO_MANY_ROWS',
    );
    await upload('A', 'PARENTS', 'huge.csv', Buffer.alloc(5 * 1024 * 1024 + 10, 'a')).expect(413);
    await api('A').post('/api/v1/imports').field('type', 'PARENTS').expect(400); // no file
    expect(await prisma.bulkImportJob.count({ where: { tenantId: t.A.id } })).toBe(jobsBefore);
  });

  it('enforces permissions per import type', async () => {
    const teachersCsv =
      'employee_id,first_name,middle_name,last_name,email,phone,joining_date\nP-1,x,,,,,';
    await upload('A', 'TEACHERS', 't.csv', teachersCsv, aoToken).expect(403); // AO: no teacher.manage
    await upload('A', 'PARENTS', 'p.csv', `${PARENT_HEAD}\n,AO,,,,`, aoToken).expect(201);
    await upload('A', 'PARENTS', 'p.csv', `${PARENT_HEAD}\n,T,,,,`, teacherToken).expect(403);
    await call(app, { host: t.A.domain, token: teacherToken }).get('/api/v1/imports').expect(403);
  });

  it('confirm is exactly-once under concurrency; cancel only before confirmation', async () => {
    const job = (
      await upload('B', 'PARENTS', 'p.csv', `${PARENT_HEAD}\nC-1,One,,,,\nC-2,Two,,,,`).expect(201)
    ).body as ImportJob;
    const res = await Promise.all(
      Array.from({ length: 5 }, () => api('B').post(`/api/v1/imports/${job.id}/confirm`)),
    );
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(4);
    await waitFor('B', job.id);
    expect(
      await prisma.parent.count({
        where: { schoolId: school.B, parentCode: { in: ['C-1', 'C-2'] } },
      }),
    ).toBe(2);
    await api('B').post(`/api/v1/imports/${job.id}/cancel`).expect(409);
    const other = (
      await upload('B', 'PARENTS', 'p2.csv', `${PARENT_HEAD}\nC-9,Nine,,,,`).expect(201)
    ).body as ImportJob;
    expect(
      ((await api('B').post(`/api/v1/imports/${other.id}/cancel`).expect(200)).body as ImportJob)
        .status,
    ).toBe('CANCELLED');
    await api('B').post(`/api/v1/imports/${other.id}/confirm`).expect(409);
    const rows = await prisma.bulkImportRow.findMany({ where: { jobId: other.id } });
    expect(rows.every((r) => JSON.stringify(r.data) === '{}')).toBe(true);
  });

  it('worker is idempotent: concurrent/retried runs never duplicate records', async () => {
    const csv = [
      PARENT_HEAD,
      ...Array.from({ length: 250 }, (_, i) => `,Idem ${String(i)},,,,`),
    ].join('\n'); // no codes → no unique key
    const job = (await upload('C', 'PARENTS', 'idem.csv', csv).expect(201)).body as ImportJob;
    // Simulate BullMQ delivering the job twice at the same time (stalled-job recovery).
    await prisma.bulkImportJob.update({
      where: { id: job.id },
      data: { status: 'QUEUED', confirmedAt: new Date() },
    });
    const runner = app.get(ImportRunner);
    const tenant = { id: t.C.id, key: t.C.key, slug: t.C.slug, status: 'ACTIVE' as const };
    const run = () =>
      TenantContext.run({ outcome: 'resolved', tenant, source: 'tenant-key' }, () =>
        runner.run(job.id),
      );
    await Promise.all([run(), run(), run()]);
    await run(); // a late retry after completion is a no-op
    const done = (await api('C').get(`/api/v1/imports/${job.id}`).expect(200)).body as ImportJob;
    expect(done).toMatchObject({
      status: 'COMPLETED',
      processedRows: 250,
      succeededRows: 250,
      failedRows: 0,
    });
    expect(
      await prisma.parent.count({
        where: { schoolId: school.C, firstName: { startsWith: 'Idem ' } },
      }),
    ).toBe(250);
  });

  it('a worker in tenant B context cannot process tenant A jobs (and imports are invisible across tenants)', async () => {
    const job = (
      await upload('A', 'PARENTS', 'x.csv', `${PARENT_HEAD}\nXT-1,Cross,,,,`).expect(201)
    ).body as ImportJob;
    await prisma.bulkImportJob.update({
      where: { id: job.id },
      data: { status: 'QUEUED', confirmedAt: new Date() },
    });
    const runner = app.get(ImportRunner);
    const tenantB = { id: t.B.id, key: t.B.key, slug: t.B.slug, status: 'ACTIVE' as const };
    await expect(
      TenantContext.run({ outcome: 'resolved', tenant: tenantB, source: 'tenant-key' }, () =>
        runner.run(job.id),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await prisma.bulkImportJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'QUEUED',
      processedRows: 0,
    });
    expect(await prisma.parent.count({ where: { parentCode: 'XT-1' } })).toBe(0);
    for (const [me, v] of [
      ['B', 'A'],
      ['C', 'B'],
      ['A', 'C'],
    ] as const) {
      const theirs = await prisma.bulkImportJob.findFirst({ where: { tenantId: t[v].id } });
      if (!theirs) continue;
      for (const [method, path] of [
        ['get', `/api/v1/imports/${theirs.id}`],
        ['get', `/api/v1/imports/${theirs.id}/rows`],
        ['get', `/api/v1/imports/${theirs.id}/errors.csv`],
        ['post', `/api/v1/imports/${theirs.id}/confirm`],
        ['post', `/api/v1/imports/${theirs.id}/cancel`],
      ] as const) {
        expect((await api(me)[method](path)).status, `${me}→${v} ${path}`).toBe(404);
      }
      const list = (await api(me).get('/api/v1/imports?pageSize=100').expect(200))
        .body as Paginated<ImportJob>;
      expect(list.items.some((j) => j.id === theirs.id)).toBe(false);
    }
  });

  it('processes a 1,000-row file in the background', async () => {
    const csv = [
      PARENT_HEAD,
      ...Array.from({ length: 1_000 }, (_, i) => `BIG-${String(i)},Bulk ${String(i)},,Family,,`),
    ].join('\n');
    const started = Date.now();
    const job = (await upload('C', 'PARENTS', 'big.csv', csv).expect(201)).body as ImportJob;
    expect(Date.now() - started).toBeLessThan(15_000); // upload + validation only
    await api('C').post(`/api/v1/imports/${job.id}/confirm`).expect(200);
    const done = await waitFor('C', job.id);
    expect(done).toMatchObject({ status: 'COMPLETED', succeededRows: 1_000 });
    expect(
      await prisma.parent.count({
        where: { schoolId: school.C, parentCode: { startsWith: 'BIG-' } },
      }),
    ).toBe(1_000);
  }, 60_000);

  it('Redis/BullMQ outage: confirm fails clearly, the import stays READY, nothing is created', async () => {
    const job = (
      await upload('A', 'PARENTS', 'outage.csv', `${PARENT_HEAD}\nOUT-1,Outage,,,,`).expect(201)
    ).body as ImportJob;
    const down = await createTestApp({ overrides: { REDIS_URL: 'redis://127.0.0.1:1/0' } });
    try {
      const res = await call(down, { host: t.A.domain, token: token.A }).post(
        `/api/v1/imports/${job.id}/confirm`,
      );
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'IMPORT_QUEUE_UNAVAILABLE' });
    } finally {
      await down.close();
    }
    expect((await prisma.bulkImportJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'READY',
    );
    expect(await prisma.parent.count({ where: { parentCode: 'OUT-1' } })).toBe(0);
    // Once Redis is back the same import can be confirmed normally.
    await api('A').post(`/api/v1/imports/${job.id}/confirm`).expect(200);
    expect((await waitFor('A', job.id)).succeededRows).toBe(1);
  }, 60_000);
});
